import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { reverseGeocode } from "@/src/utils/geocode";
import { colors, spacing, radius, border, shadows, wasteColors, wasteLabels } from "@/src/theme";

type Place = { id: string; name: string; lat: number; lng: number; is_primary?: boolean };
type Vehicle = { id: string; plate: string; status: string };
type Driver = { id: string; name: string; status: string };
type Endpoint = { lat: number; lng: number; depotId?: string; facilityId?: string; name?: string };
type Stop = { tempId: string; lat: number; lng: number; address: string; containerId?: string };
type ContainerOpt = { id: string; qr_code: string; address: string; lat: number; lng: number; waste_type: string; status: string };

function nextDays(n: number) {
  const out: { date: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? "HOJE" : i === 1 ? "AMANHÃ" : d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
    out.push({ date: iso, label });
  }
  return out;
}
const DATE_OPTIONS = nextDays(14);
let tempSeq = 0;
const newTempId = () => `tmp-${Date.now()}-${tempSeq++}`;

export default function MapaRota() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [depots, setDepots] = useState<Place[]>([]);
  const [facilities, setFacilities] = useState<Place[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [containers, setContainers] = useState<ContainerOpt[]>([]);
  const [pickingContainers, setPickingContainers] = useState(false);
  const [containerSearch, setContainerSearch] = useState("");

  const [date, setDate] = useState(DATE_OPTIONS[0].date);
  const [start, setStart] = useState<Endpoint | null>(null);
  const [end, setEnd] = useState<Endpoint | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [tapMode, setTapMode] = useState<"start" | "end" | "stop">("start");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [editAddress, setEditAddress] = useState("");

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);

  const [geoLine, setGeoLine] = useState<any[]>([]);
  const [geoProvider, setGeoProvider] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [loadingGeo, setLoadingGeo] = useState(false);

  const [optimizePreview, setOptimizePreview] = useState<{ order: string[]; before: number; after: number } | null>(null);
  const [mode, setMode] = useState<"manual" | "optimized" | "manual_after_optimization">("manual");
  const [saving, setSaving] = useState(false);
  const geoTimer = useRef<any>(null);

  const startSetRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      Promise.all([
        api.get<Place[]>("/depots"),
        api.get<Place[]>("/facilities"),
        api.get<Vehicle[]>("/vehicles"),
        api.get<Driver[]>("/drivers"),
        api.get<ContainerOpt[]>(`/containers?status=active&limit=2000`),
      ]).then(([d, f, v, dr, c]) => {
        setDepots(d);
        setFacilities(f);
        setVehicles(v.filter((x) => x.status === "available" || x.status === "assigned"));
        setDrivers(dr.filter((x: any) => x.status === "available" || x.status === "assigned"));
        setContainers(c);
        // The truck always leaves from the depósito principal — default to it
        // automatically instead of making the admin pick it every time. Only
        // ever auto-set this once — a refocus refresh must never clobber a
        // start the admin already changed manually.
        if (!startSetRef.current) {
          const primary = d.find((dep) => dep.is_primary) || (d.length === 1 ? d[0] : null);
          if (primary) {
            setStart({ lat: primary.lat, lng: primary.lng, depotId: primary.id, name: primary.name });
            setTapMode("stop");
            startSetRef.current = true;
          }
        }
      });
    }, [])
  );

  const primaryDepot = useMemo(() => depots.find((d) => d.is_primary) || null, [depots]);

  // Debounced live road geometry — recalculated after edits settle, never on
  // every drag frame (keeps ORS usage low, per the plan).
  useEffect(() => {
    if (geoTimer.current) clearTimeout(geoTimer.current);
    if (!start || stops.length === 0) {
      setGeoLine([]);
      setDistanceKm(null);
      setDurationMin(null);
      return;
    }
    geoTimer.current = setTimeout(async () => {
      setLoadingGeo(true);
      try {
        const points = [start, ...stops, ...(end ? [end] : [])].map((p) => ({ lat: p.lat, lng: p.lng }));
        const geo = await api.post<any>("/routes/preview-geometry", { points });
        setGeoLine(geo.coordinates || []);
        setGeoProvider(geo.provider || null);
        setDistanceKm(Math.round((geo.distance_m / 1000) * 10) / 10);
        setDurationMin(Math.round(geo.duration_s / 60));
      } catch {
        // stay on last known geometry — never crash the editor over a preview call
      } finally {
        setLoadingGeo(false);
      }
    }, 800);
    return () => clearTimeout(geoTimer.current);
  }, [start, end, stops]);

  // Nobody wants to type a street name after tapping a point — best-effort
  // reverse geocode fills it in automatically once it resolves; the admin
  // can still edit it afterwards if it's not quite right.
  const detectStartName = (lat: number, lng: number) => {
    reverseGeocode(lat, lng).then((a) => { if (a) setStart((s) => (s ? { ...s, name: a } : s)); });
  };
  const detectEndName = (lat: number, lng: number) => {
    reverseGeocode(lat, lng).then((a) => { if (a) setEnd((e) => (e ? { ...e, name: a } : e)); });
  };
  const detectStopAddress = (tempId: string, lat: number, lng: number) => {
    reverseGeocode(lat, lng).then((a) => {
      if (a) setStops((list) => list.map((s) => (s.tempId === tempId ? { ...s, address: a } : s)));
    });
  };

  const onMapPress = useCallback((lat: number, lng: number) => {
    if (tapMode === "start") {
      setStart({ lat, lng });
      setTapMode("stop");
      detectStartName(lat, lng);
    } else if (tapMode === "end") {
      setEnd({ lat, lng });
      setTapMode("stop");
      detectEndName(lat, lng);
    } else {
      const tempId = newTempId();
      setStops((s) => [...s, { tempId, lat, lng, address: "" }]);
      setMode((m) => (m === "manual" ? "manual" : "manual_after_optimization"));
      detectStopAddress(tempId, lat, lng);
    }
  }, [tapMode]);

  const onDragMarker = useCallback((id: string, lat: number, lng: number) => {
    if (id === "start") { setStart((s) => (s ? { ...s, lat, lng } : s)); detectStartName(lat, lng); }
    else if (id === "end") { setEnd((e) => (e ? { ...e, lat, lng } : e)); detectEndName(lat, lng); }
    else { setStops((list) => list.map((s) => (s.tempId === id ? { ...s, lat, lng } : s))); detectStopAddress(id, lat, lng); }
    setOptimizePreview(null);
    setMode((m) => (m === "manual" ? "manual" : "manual_after_optimization"));
  }, []);

  const onPressMarker = useCallback((id: string) => {
    if (id.startsWith("avail-")) {
      const c = containers.find((x) => x.id === id.slice(6));
      if (c) addContainerStop(c);
      return;
    }
    setSelectedId(id);
    const stop = stops.find((s) => s.tempId === id);
    if (stop) { setEditingStop(stop); setEditAddress(stop.address); }
  }, [stops, containers]);

  const moveStop = (i: number, dir: -1 | 1) => {
    setStops((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const copy = list.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    setOptimizePreview(null);
    setMode((m) => (m === "manual" ? "manual" : "manual_after_optimization"));
  };
  const addedContainerIds = useMemo(() => new Set(stops.map((s) => s.containerId).filter(Boolean)), [stops]);
  const addContainerStop = (c: ContainerOpt) => {
    if (addedContainerIds.has(c.id)) return;
    setStops((s) => [...s, { tempId: newTempId(), lat: c.lat, lng: c.lng, address: c.address, containerId: c.id }]);
    setMode((m) => (m === "manual" ? "manual" : "manual_after_optimization"));
  };
  const removeStop = (tempId: string) => {
    setStops((list) => list.filter((s) => s.tempId !== tempId));
    setEditingStop(null);
    setOptimizePreview(null);
  };
  const saveStopAddress = () => {
    if (editingStop) {
      setStops((list) => list.map((s) => (s.tempId === editingStop.tempId ? { ...s, address: editAddress } : s)));
    }
    setEditingStop(null);
  };

  const runOptimize = async () => {
    if (!start || stops.length < 2) { toast("Adicione pelo menos 2 paragens", "error"); return; }
    try {
      const body = {
        start: { lat: start.lat, lng: start.lng },
        end: { lat: (end || start).lat, lng: (end || start).lng },
        stops: stops.map((s) => ({ id: s.tempId, lat: s.lat, lng: s.lng })),
      };
      const res = await api.post<any>("/routes/preview-optimize", body);
      setOptimizePreview({ order: res.order, before: res.distance_km_before, after: res.distance_km });
    } catch (e: any) {
      toast(e?.message || "Erro ao otimizar", "error");
    }
  };
  const acceptOptimize = () => {
    if (!optimizePreview) return;
    const byId = Object.fromEntries(stops.map((s) => [s.tempId, s]));
    setStops(optimizePreview.order.map((id) => byId[id]).filter(Boolean));
    setMode("optimized");
    setOptimizePreview(null);
  };

  const save = async () => {
    if (!start) { toast("Defina o ponto de início", "error"); return; }
    if (stops.length === 0) { toast("Adicione pelo menos uma paragem", "error"); return; }
    setSaving(true);
    try {
      const body: any = {
        date,
        start: start.depotId ? { depot_id: start.depotId } : { lat: start.lat, lng: start.lng },
        stops: stops.map((s) => ({ lat: s.lat, lng: s.lng, address: s.address, container_id: s.containerId })),
        mode,
      };
      if (end) {
        body.end = end.facilityId ? { facility_id: end.facilityId }
          : end.depotId ? { depot_id: end.depotId }
          : { lat: end.lat, lng: end.lng };
      }
      if (vehicleId) body.vehicle_id = vehicleId;
      if (driverId) body.driver_id = driverId;

      const route = await api.post<any>("/routes/manual", body);
      toast(`Rota ${route.code} guardada`, "success");
      router.replace(`/route/${route.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Erro ao guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const markers = useMemo(() => {
    const out: any[] = [];
    // Every available container shows up as a small muted dot the moment
    // the map loads — tapping it adds it as the next numbered stop, no need
    // to open the list picker first.
    containers.forEach((c) => {
      if (addedContainerIds.has(c.id)) return;
      out.push({ id: `avail-${c.id}`, lat: c.lat, lng: c.lng, color: wasteColors[c.waste_type] || colors.muted, kind: "container" });
    });
    if (start) out.push({
      id: "start", lat: start.lat, lng: start.lng, color: colors.onSurface, label: "I",
      draggable: !start.depotId, selected: selectedId === "start",
    });
    stops.forEach((s, i) => out.push({
      id: s.tempId, lat: s.lat, lng: s.lng, color: colors.brand, label: String(i + 1),
      draggable: true, selected: selectedId === s.tempId,
    }));
    if (end) out.push({
      id: "end", lat: end.lat, lng: end.lng, color: colors.success, label: "F",
      draggable: !end.depotId && !end.facilityId, selected: selectedId === "end",
    });
    return out;
  }, [start, stops, end, selectedId, containers, addedContainerIds]);

  const polylines = geoLine.length ? [{ coordinates: geoLine, color: colors.brand, width: 5 }] : [];

  const availableCount = containers.filter((c) => !addedContainerIds.has(c.id)).length;
  const tapHint = tapMode === "start" ? "Toque no mapa para definir o INÍCIO"
    : tapMode === "end" ? "Toque no mapa para definir o DESTINO"
    : `Toque num ponto para adicionar — ${availableCount} contentor(es) disponível(is) no mapa`;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="CRIAR ROTA NO MAPA" subtitle={tapHint} back />
      <View style={styles.body}>
        <View style={styles.mapCol}>
          <FleetMap
            markers={markers}
            polylines={polylines}
            center={primaryDepot ? { lat: primaryDepot.lat, lng: primaryDepot.lng } : undefined}
            onPressMarker={onPressMarker}
            onDragMarker={onDragMarker}
            onMapPress={onMapPress}
            style={styles.map}
          />
          {loadingGeo && (
            <View style={styles.geoBadge}><Txt variant="label" color="#fff">A calcular percurso...</Txt></View>
          )}
          {!loadingGeo && geoProvider === "straight" && geoLine.length > 0 && (
            <View testID="creator-straight-line-warning" style={styles.strawBanner}>
              <Ionicons name="construct" size={15} color="#fff" />
              <Txt variant="mono" color="#fff" numberOfLines={2} style={{ flex: 1, fontSize: 11 }}>
                MODO DESENVOLVIMENTO — percurso em linha reta (falta configurar ORS_API_KEY no backend). Distância/duração abaixo não são reais.
              </Txt>
            </View>
          )}
        </View>

        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
          <Txt variant="label">DATA</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {DATE_OPTIONS.slice(0, 7).map((d) => (
              <Pressable key={d.date} onPress={() => setDate(d.date)} style={[styles.chip, date === d.date ? styles.chipOn : null]}>
                <Txt variant="monoBold" style={{ fontSize: 10 }} color={date === d.date ? colors.onSurfaceInverse : colors.onSurface}>{d.label}</Txt>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.summaryCard}>
            <SummaryCell label="PARAGENS" value={stops.length} />
            <SummaryCell label="DISTÂNCIA" value={distanceKm != null ? `${distanceKm}km` : "—"} />
            <SummaryCell label="DURAÇÃO" value={durationMin != null ? `${Math.floor(durationMin / 60)}h${durationMin % 60}` : "—"} />
          </View>

          <Txt variant="label">INÍCIO</Txt>
          {!start ? (
            <>
              <Pressable style={[styles.chip, styles.chipOn]} onPress={() => setTapMode("start")}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={colors.onSurfaceInverse}>TOCAR NO MAPA</Txt>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {depots.map((d) => (
                  <Pressable key={d.id} style={styles.chip} onPress={() => { setStart({ lat: d.lat, lng: d.lng, depotId: d.id, name: d.name }); setTapMode("stop"); }}>
                    <Txt variant="monoBold" style={{ fontSize: 11 }}>{d.is_primary ? `★ ${d.name}` : d.name}</Txt>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : (
            <Pressable style={styles.row} onPress={() => setSelectedId("start")}>
              <View style={[styles.dot, { backgroundColor: colors.onSurface }]} />
              <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>{start.name || "Ponto no mapa"}</Txt>
              <Pressable onPress={() => { setStart(null); setTapMode("start"); }} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            </Pressable>
          )}

          <View style={styles.stopsHead}>
            <Txt variant="label">PARAGENS ({stops.length})</Txt>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Pressable testID="open-container-picker" onPress={() => setPickingContainers(true)}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={colors.brand}>+ CONTENTOR</Txt>
              </Pressable>
              <Pressable onPress={() => setTapMode("stop")} disabled={!start}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={start ? colors.brand : colors.muted}>+ TOCAR NO MAPA</Txt>
              </Pressable>
            </View>
          </View>
          {stops.map((s, i) => (
            <Pressable key={s.tempId} style={[styles.row, selectedId === s.tempId ? styles.rowSelected : null]} onPress={() => setSelectedId(s.tempId)}>
              <View style={styles.seq}><Txt variant="monoBold" color="#fff" style={{ fontSize: 11 }}>{i + 1}</Txt></View>
              {s.containerId ? <Ionicons name="cube" size={14} color={colors.brand} /> : null}
              <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>{s.address || `Paragem ${i + 1}`}</Txt>
              <Pressable onPress={() => moveStop(i, -1)} disabled={i === 0} hitSlop={6}><Ionicons name="chevron-up" size={16} color={i === 0 ? colors.muted : colors.onSurface} /></Pressable>
              <Pressable onPress={() => moveStop(i, 1)} disabled={i === stops.length - 1} hitSlop={6}><Ionicons name="chevron-down" size={16} color={i === stops.length - 1 ? colors.muted : colors.onSurface} /></Pressable>
              <Pressable onPress={() => { setEditingStop(s); setEditAddress(s.address); }} hitSlop={6}><Ionicons name="create-outline" size={16} color={colors.onSurface} /></Pressable>
            </Pressable>
          ))}

          <Txt variant="label">DESTINO FINAL</Txt>
          {!end ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable style={styles.chip} onPress={() => setTapMode("end")}>
                <Txt variant="monoBold" style={{ fontSize: 11 }}>TOCAR NO MAPA</Txt>
              </Pressable>
              <Pressable style={styles.chip} onPress={() => start?.depotId && setEnd({ ...start })}>
                <Txt variant="monoBold" style={{ fontSize: 11 }}>MESMO DEPÓSITO</Txt>
              </Pressable>
              {facilities.map((f) => (
                <Pressable key={f.id} style={styles.chip} onPress={() => setEnd({ lat: f.lat, lng: f.lng, facilityId: f.id, name: f.name })}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }}>{f.name}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable style={styles.row} onPress={() => setSelectedId("end")}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>{end.name || "Ponto no mapa"}</Txt>
              <Pressable onPress={() => setEnd(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            </Pressable>
          )}

          <Txt variant="label">VIATURA (OPCIONAL)</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {vehicles.map((v) => (
              <Pressable key={v.id} style={[styles.chip, vehicleId === v.id ? styles.chipOn : null]} onPress={() => setVehicleId((id) => (id === v.id ? null : v.id))}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={vehicleId === v.id ? colors.onSurfaceInverse : colors.onSurface}>{v.plate}</Txt>
              </Pressable>
            ))}
          </ScrollView>

          <Txt variant="label">MOTORISTA (OPCIONAL)</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {drivers.map((d) => (
              <Pressable key={d.id} style={[styles.chip, driverId === d.id ? styles.chipOn : null]} onPress={() => setDriverId((id) => (id === d.id ? null : d.id))}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={driverId === d.id ? colors.onSurfaceInverse : colors.onSurface}>{d.name}</Txt>
              </Pressable>
            ))}
          </ScrollView>

          {optimizePreview ? (
            <View style={styles.optimizeCard}>
              <Txt variant="monoBold">Antes: {optimizePreview.before}km → Depois: {optimizePreview.after}km</Txt>
              <Txt variant="mono" color={colors.success}>Poupança: {Math.round((optimizePreview.before - optimizePreview.after) * 10) / 10}km</Txt>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
                <Btn title="ACEITAR" size="md" variant="success" style={{ flex: 1 }} onPress={acceptOptimize} />
                <Btn title="MANTER" size="md" variant="outline" style={{ flex: 1 }} onPress={() => setOptimizePreview(null)} />
              </View>
            </View>
          ) : (
            <Btn title="OTIMIZAR ORDEM" icon="git-network" variant="outline" onPress={runOptimize} disabled={stops.length < 2} />
          )}

          <Btn title="GUARDAR ROTA" icon="checkmark" size="lg" loading={saving} onPress={save} style={{ marginTop: spacing.sm }} />
        </ScrollView>
      </View>

      <Modal visible={pickingContainers} animationType="slide" onRequestClose={() => setPickingContainers(false)}>
        <View style={[styles.flex, { paddingTop: insets.top }]}>
          <View style={styles.pickerHeader}>
            <Txt variant="displaySm">ADICIONAR CONTENTORES</Txt>
            <Pressable testID="close-container-picker" onPress={() => setPickingContainers(false)} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, { margin: spacing.lg, marginBottom: spacing.sm }]}
            placeholder="Pesquisar por morada ou código"
            placeholderTextColor={colors.muted}
            value={containerSearch}
            onChangeText={setContainerSearch}
          />
          <Txt variant="mono" color={colors.muted} style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, fontSize: 12 }}>
            Toca para adicionar — ficam pela ordem em que tocares. {stops.length} paragem(ns) já adicionada(s).
          </Txt>
          <FlatList
            data={containers.filter((c) =>
              !containerSearch.trim() ||
              c.address.toLowerCase().includes(containerSearch.toLowerCase()) ||
              c.qr_code.toLowerCase().includes(containerSearch.toLowerCase()))}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.sm }}
            renderItem={({ item }) => {
              const added = addedContainerIds.has(item.id);
              return (
                <Pressable testID={`pick-container-${item.id}`} onPress={() => addContainerStop(item)} disabled={added}
                  style={[styles.pickerRow, added ? styles.pickerRowAdded : null]}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="monoBold">{item.qr_code}</Txt>
                    <Txt variant="mono" color={colors.muted} numberOfLines={1}>{item.address}</Txt>
                    <Txt variant="label">{wasteLabels[item.waste_type] || item.waste_type}</Txt>
                  </View>
                  {added ? <Ionicons name="checkmark-circle" size={22} color={colors.success} /> : <Ionicons name="add-circle-outline" size={22} color={colors.brand} />}
                </Pressable>
              );
            }}
          />
          <View style={{ padding: spacing.lg }}>
            <Btn testID="finish-container-picking" title="CONCLUÍDO" onPress={() => setPickingContainers(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={!!editingStop} transparent animationType="fade" onRequestClose={() => setEditingStop(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEditingStop(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">EDITAR PARAGEM</Txt>
            <TextInput
              style={styles.input}
              placeholder="Morada / referência (opcional)"
              placeholderTextColor={colors.muted}
              value={editAddress}
              onChangeText={setEditAddress}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Btn title="GUARDAR" style={{ flex: 1 }} onPress={saveStopAddress} />
              <Btn title="ELIMINAR" variant="error" style={{ flex: 1 }} onPress={() => editingStop && removeStop(editingStop.tempId)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SummaryCell({ label, value }: { label: string; value: any }) {
  return (<View style={{ flex: 1, alignItems: "center" }}><Txt variant="monoBold" style={{ fontSize: 16 }}>{value}</Txt><Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, flexDirection: "row" },
  mapCol: { flex: 0.72 },
  map: { flex: 1, borderRadius: 0 },
  geoBadge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: "rgba(17,24,39,0.85)", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  strawBanner: {
    position: "absolute", top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center",
    gap: spacing.sm, backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, ...(shadows.float as object),
  },
  panel: { flex: 0.28, minWidth: 220, backgroundColor: colors.surface, borderLeftWidth: border.width, borderLeftColor: colors.border, ...(shadows.float as object) },
  panelContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing["2xl"] },
  chipRow: { gap: spacing.xs, paddingVertical: 2 },
  chip: { height: 32, justifyContent: "center", paddingHorizontal: spacing.sm, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.onSurface },
  summaryCard: { flexDirection: "row", borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, padding: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, backgroundColor: colors.surface },
  rowSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  dot: { width: 10, height: 10, borderRadius: 5 },
  seq: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  stopsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  optimizeCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, gap: 2 },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  pickerRowAdded: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  input: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular", fontSize: 14, color: colors.onSurface },
});
