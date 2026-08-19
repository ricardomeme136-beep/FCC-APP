import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Txt, Badge } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, wasteColors, wasteLabels, routeStatus } from "@/src/theme";
import { agoLabel } from "@/src/utils/time";

const LAYERS = [
  { key: "routes", label: "ROTAS", icon: "git-network" as const },
  { key: "trucks", label: "MOTORISTAS", icon: "walk" as const },
  { key: "containers", label: "CONTENTORES", icon: "cube" as const },
  { key: "incidents", label: "OCORRÊNCIAS", icon: "warning" as const },
  { key: "places", label: "DEPÓSITOS", icon: "business" as const },
];

const ROUTE_PALETTE = ["#F97316", "#0EA5E9", "#16A34A", "#A855F7", "#EF4444", "#EAB308"];
const PENDING_STATUSES = ["scheduled", "en_route", "arrived"];
// A driver only ever appears on the live map while their route is genuinely
// in_progress (Objetivo 2) — never just because they logged in. Beyond
// STALE_WARN_S the marker is shown but dimmed ("desatualizado"); beyond
// STALE_HIDE_S it's dropped entirely rather than showing a frozen, possibly
// misleading position. The background task reports at least every ~8s while
// active, so 45s already means several missed reports, not just "stopped".
const STALE_WARN_S = 45;
const STALE_HIDE_S = 150;
const TODAY = new Date().toISOString().slice(0, 10);

export default function Mapa() {
  const [live, setLive] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [places, setPlaces] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [routeLines, setRouteLines] = useState<any[]>([]);
  const [active, setActive] = useState<Record<string, boolean>>({ routes: true, trucks: true, containers: false, incidents: true, places: true });
  const [selected, setSelected] = useState<any | null>(null);
  const [, forceTick] = useState(0);

  const refreshRoutes = useCallback(async () => {
    const rs = await api.get<any[]>("/routes").catch(() => []);
    setRoutes(rs);
    const inProg = rs.filter((r) => r.status === "in_progress").slice(0, 6);
    const geos = await Promise.all(
      inProg.map((r) => api.get<any>(`/routes/${r.id}/geometry`).catch(() => null))
    );
    setRouteLines(
      geos.map((g, i) => (g && g.coordinates?.length ? { coordinates: g.coordinates, color: ROUTE_PALETTE[i % ROUTE_PALETTE.length], width: 4 } : null)).filter(Boolean)
    );
  }, []);

  useEffect(() => {
    (async () => {
      const [c, inc, dep, fac] = await Promise.all([
        api.get<any[]>(`/containers?limit=500&for_date=${TODAY}`),
        api.get<any[]>("/incidents?status=open"),
        api.get<any[]>("/depots"),
        api.get<any[]>("/facilities"),
      ]);
      setContainers(c);
      setIncidents(inc);
      setPlaces([
        ...dep.map((d) => ({
          id: `dep-${d.id}`, lat: d.lat, lng: d.lng,
          color: d.is_primary ? colors.brand : colors.onSurface,
          kind: "depot", label: d.is_primary ? "★" : "C",
        })),
        ...fac.map((f) => ({ id: `fac-${f.id}`, lat: f.lat, lng: f.lng, color: colors.success, kind: "facility" })),
      ]);
    })();
  }, []);

  // Route status changes far less often than GPS position — a separate,
  // slower poll keeps "quem está em rota" fresh (so a driver disappears the
  // moment their route finishes) without adding load on every 4s GPS tick.
  useFocusEffect(
    useCallback(() => {
      refreshRoutes();
      const t = setInterval(refreshRoutes, 9000);
      return () => clearInterval(t);
    }, [refreshRoutes])
  );

  useFocusEffect(
    useCallback(() => {
      api.get<any[]>("/gps/live").then(setLive).catch(() => {});
      const t = setInterval(() => api.get<any[]>("/gps/live").then(setLive).catch(() => {}), 4000);
      return () => clearInterval(t);
    }, [])
  );

  // Only used to re-render the "há Xs" text in the detail panel between
  // polls — never drives any data fetch.
  useEffect(() => {
    if (!selected || selected.kind !== "driver") return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [selected]);

  const routeByVehicle: Record<string, any> = {};
  for (const r of routes) {
    if (r.status === "in_progress" && r.vehicle_id) routeByVehicle[r.vehicle_id] = r;
  }

  const driverMarkers = live
    .filter((p) => routeByVehicle[p.vehicle_id])
    .map((p) => {
      const ageSec = (Date.now() - new Date(p.timestamp).getTime()) / 1000;
      if (ageSec > STALE_HIDE_S) return null;
      return {
        id: `drv-${p.vehicle_id}`, lat: p.lat, lng: p.lng, color: colors.brand,
        kind: "driver" as const, label: p.driver_name || p.plate || "Motorista",
        heading: p.heading, stale: ageSec > STALE_WARN_S,
      };
    })
    .filter((m): m is NonNullable<typeof m> => !!m);

  // TEMPORARY debug — remove once the "no name / generic dot" report is
  // confirmed fixed. Proves whether this bundle (with kind:"driver") is the
  // one actually running on the device, and what /gps/live is really
  // sending per position (driver_name in particular).
  if (__DEV__) {
    console.log("[mapa] live raw:", JSON.stringify(live));
    console.log("[mapa] routeByVehicle keys:", Object.keys(routeByVehicle));
    console.log("[mapa] driverMarkers:", JSON.stringify(driverMarkers));
  }

  const markers: any[] = [];
  if (active.places) markers.push(...places);
  if (active.containers)
    markers.push(...containers.map((c) => ({
      id: `c-${c.id}`, lat: c.lat, lng: c.lng, color: wasteColors[c.waste_type] || colors.info, kind: "waste_bin",
    })));
  if (active.incidents)
    markers.push(...incidents.filter((i) => i.lat).map((i) => ({ id: `i-${i.id}`, lat: i.lat, lng: i.lng, color: colors.error, kind: "incident" })));
  if (active.trucks) markers.push(...driverMarkers);

  const onMarker = async (id: string) => {
    if (id.startsWith("drv-")) {
      const vid = id.slice(4);
      const pos = live.find((p) => p.vehicle_id === vid);
      const route = routeByVehicle[vid];
      if (!pos || !route) { setSelected(null); return; }
      setSelected({ kind: "driver", pos, route, progress: null });
      try {
        const full = await api.get<any>(`/routes/${route.id}`);
        const stops: any[] = full.stops || [];
        const currentIdx = stops.findIndex((s) => (s.tasks || []).some((t: any) => PENDING_STATUSES.includes(t.status)));
        const progress = stops.length ? { current: currentIdx >= 0 ? currentIdx + 1 : stops.length, total: stops.length } : null;
        setSelected((sel: any) => (sel && sel.kind === "driver" && sel.pos.vehicle_id === vid) ? { ...sel, progress } : sel);
      } catch {}
    } else if (id.startsWith("c-")) {
      const cid = id.slice(2);
      const c = containers.find((x) => x.id === cid);
      if (c) setSelected({ kind: "container", container: c });
    } else if (id.startsWith("dep-")) {
      const did = id.slice(4);
      try {
        const d = await api.get<any>(`/depots/${did}`);
        setSelected({ ...d, kind: "depot" });
      } catch {}
    } else {
      setSelected(null);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="MAPA EM TEMPO REAL" subtitle="MONITORIZAÇÃO GPS" />
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {LAYERS.map((l) => {
            const on = active[l.key];
            return (
              <Pressable
                key={l.key}
                testID={`layer-${l.key}`}
                onPress={() => setActive((s) => ({ ...s, [l.key]: !s[l.key] }))}
                style={[styles.chip, on ? styles.chipOn : null]}
              >
                <Ionicons name={l.icon} size={14} color={on ? colors.onSurfaceInverse : colors.onSurface} />
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{l.label}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.mapFill}>
        <FleetMap markers={markers} polylines={active.routes ? routeLines : []} onPressMarker={onMarker} center={{ lat: 41.28, lng: -8.28 }} />
      </View>

      {selected && selected.kind === "depot" && (
        <View style={styles.detail} testID="depot-detail">
          <View style={styles.detailHead}>
            <View style={{ flex: 1 }}>
              <Txt variant="displaySm">{selected.name}</Txt>
              <Txt variant="label" color={colors.muted}>{selected.address}</Txt>
            </View>
            <Pressable testID="close-detail" onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          {selected.is_primary ? <Badge label="★ DEPÓSITO PRINCIPAL" color={colors.brand} /> : <Badge label="ATIVO" color={colors.success} />}
          <View style={styles.detailGrid}>
            <Detail label="ESTADO" value="Ativo" />
            <Detail label="ROTAS A SAIR HOJE" value={String(selected.routes_today ?? 0)} />
            <Detail label="VIATURAS NO DEPÓSITO" value={String(selected.vehicles_at_depot ?? 0)} />
            <Detail label="HORÁRIO" value={selected.hours || "—"} />
          </View>
        </View>
      )}

      {selected && selected.kind === "driver" && (
        <View style={styles.detail} testID="driver-detail">
          <View style={styles.detailHead}>
            <View style={{ flex: 1 }}>
              <Txt variant="displaySm">{selected.pos.driver_name || "Motorista"}</Txt>
              <Txt variant="label" color={colors.muted}>{selected.route.code}</Txt>
            </View>
            <Pressable testID="close-detail" onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <Badge label={(routeStatus[selected.route.status] || routeStatus.in_progress).label} color={(routeStatus[selected.route.status] || routeStatus.in_progress).color} />
          <View style={styles.detailGrid}>
            {selected.pos.plate ? <Detail label="VIATURA" value={selected.pos.plate} /> : null}
            {selected.progress ? <Detail label="PRÓXIMA PARAGEM" value={`${selected.progress.current} de ${selected.progress.total}`} /> : null}
            {selected.pos.speed != null ? <Detail label="VELOCIDADE" value={`${Math.round(selected.pos.speed)} km/h`} /> : null}
            <Detail label="ÚLTIMA ATUALIZAÇÃO" value={agoLabel(selected.pos.timestamp)} />
          </View>
        </View>
      )}

      {selected && selected.kind === "container" && (
        <View style={styles.detail} testID="container-detail">
          <View style={styles.detailHead}>
            <View style={{ flex: 1 }}>
              <Txt variant="displaySm">{selected.container.qr_code}</Txt>
              <Txt variant="label" color={colors.muted}>{wasteLabels[selected.container.waste_type] || selected.container.waste_type}</Txt>
            </View>
            <Pressable testID="close-detail" onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <Badge label={selected.container.status === "active" ? "ATIVO" : (selected.container.status || "—").toUpperCase()}
            color={selected.container.status === "active" ? colors.success : colors.muted} />
          <View style={styles.detailGrid}>
            <Detail label="ÚLTIMA RECOLHA" value={selected.container.last_collection ? selected.container.last_collection.slice(0, 10) : "—"} />
            <Detail label="PRÓXIMA RECOLHA" value={selected.container.next_collection ? selected.container.next_collection.slice(0, 10) : "—"} />
            {selected.container.available === false && selected.container.unavailable_reason?.startsWith("Já atribuído")
              ? <Detail label="ROTA ASSOCIADA" value={selected.container.unavailable_reason.replace("Já atribuído à ", "")} />
              : null}
          </View>
        </View>
      )}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailCell}>
      <Txt variant="label">{label}</Txt>
      <Txt variant="monoBold" style={{ fontSize: 15 }}>{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  chipRowWrap: { borderBottomWidth: border.width, borderBottomColor: colors.borderStrong },
  chipRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "center" },
  chip: {
    height: 36, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0,
    paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.onSurface },
  mapFill: { flex: 1, padding: spacing.md },
  detail: {
    position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md,
    backgroundColor: colors.surface, borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    padding: spacing.lg, gap: spacing.sm,
  },
  detailHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap" },
  detailCell: { width: "50%", paddingVertical: spacing.xs },
});
