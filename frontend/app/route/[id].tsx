import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import ContainerPicker from "@/src/components/ContainerPicker";
import { colors, spacing, border, routeStatus, taskStatus, wasteLabels } from "@/src/theme";

export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [route, setRoute] = useState<any | null>(null);
  const [geo, setGeo] = useState<any | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [sameDateRoutes, setSameDateRoutes] = useState<any[]>([]);
  const [containersById, setContainersById] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSelection, setAddSelection] = useState<string[]>([]);
  const [moveFor, setMoveFor] = useState<any | null>(null);
  const [otherRoutes, setOtherRoutes] = useState<any[]>([]);
  const [assignFor, setAssignFor] = useState<"driver" | "vehicle" | null>(null);

  const load = useCallback(async () => {
    const [r, v, d, containers, allRoutes] = await Promise.all([
      api.get<any>(`/routes/${id}`),
      api.get<any[]>("/vehicles"),
      api.get<any[]>("/drivers"),
      api.get<any[]>("/containers?limit=2000"),
      api.get<any[]>("/routes"),
    ]);
    setRoute(r);
    setVehicles(v);
    setDrivers(d);
    setContainersById(Object.fromEntries(containers.map((c) => [c.id, c])));
    setSameDateRoutes(allRoutes.filter((x) => x.date === r.date && x.id !== id
      && x.status !== "completed" && x.status !== "cancelled"));
    api.get<any>(`/routes/${id}/geometry`).then(setGeo).catch(() => {});
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!route) return (<View style={styles.flex}><ScreenHeader title="ROTA" back /><Loading /></View>);

  const st = routeStatus[route.status] || routeStatus.scheduled;
  const stops = route.stops || [];
  const tasks = route.tasks || [];
  const vehicle = vehicles.find((v) => v.id === route.vehicle_id);
  const markers = tasks.map((t: any) => ({
    id: t.id, lat: t.lat, lng: t.lng, kind: "container" as const,
    color: t.status === "collected" ? colors.success : t.status === "failed" ? colors.error : colors.brand,
  }));
  const line = geo?.coordinates?.length ? geo.coordinates : tasks.map((t: any) => ({ latitude: t.lat, longitude: t.lng }));

  const act = async (fn: () => Promise<any>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg, "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setBusy(false); }
  };

  const reoptimize = () => act(() => api.post(`/routes/${id}/reoptimize`), "Rota reotimizada");
  const start = () => act(() => api.post(`/routes/${id}/start`), "Rota iniciada");

  const moveStop = (dir: -1 | 1, index: number) => {
    const order = stops.map((s: any) => s.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    act(() => api.patch(`/routes/${id}/stops/reorder`, { stop_ids: order }));
  };

  const removeStop = (stopId: string) => {
    act(() => api.del(`/routes/${id}/stops/${stopId}`), "Paragem removida");
  };

  const openMove = async (stop: any) => {
    const all = await api.get<any[]>("/routes");
    setOtherRoutes(all.filter((r) => r.id !== id && r.date === route.date));
    setMoveFor(stop);
  };
  const confirmMove = (targetRouteId: string) => {
    const stopId = moveFor.id;
    setMoveFor(null);
    act(() => api.post(`/routes/${id}/stops/${stopId}/move`, { target_route_id: targetRouteId }), "Paragem movida");
  };

  const confirmAdd = () => {
    const ids = addSelection;
    setAddOpen(false);
    setAddSelection([]);
    if (!ids.length) return;
    act(() => api.post(`/routes/${id}/stops`, { container_ids: ids }), "Paragem adicionada");
  };

  const assignDriver = (driverId: string) => {
    setAssignFor(null);
    act(() => api.patch(`/routes/${id}/assignment`, { driver_id: driverId }), "Motorista atualizado");
  };
  const assignVehicle = (vehicleId: string) => {
    setAssignFor(null);
    act(() => api.patch(`/routes/${id}/assignment`, { vehicle_id: vehicleId }), "Viatura atualizada");
  };

  const driverAvailability = (d: any) => {
    if (d.employment_status && d.employment_status !== "ativo") {
      return { label: "INDISPONÍVEL", color: colors.error };
    }
    const busyRoute = sameDateRoutes.find((r) => r.driver_id === d.id);
    if (busyRoute) return { label: `JÁ TEM ROTA ${busyRoute.code}`, color: colors.warning };
    return { label: "DISPONÍVEL", color: colors.success };
  };
  const vehicleAvailability = (v: any) => {
    if (v.status && v.status !== "available" && v.status !== "assigned") {
      return { label: "INDISPONÍVEL", color: colors.error };
    }
    const busyRoute = sameDateRoutes.find((r) => r.vehicle_id === v.id);
    if (busyRoute) return { label: `JÁ TEM ROTA ${busyRoute.code}`, color: colors.warning };
    return { label: "DISPONÍVEL", color: colors.success };
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title={route.code} subtitle={st.label} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.mapBox}><FleetMap markers={markers} polylines={[{ coordinates: line, color: colors.brand, width: 4 }]} /></View>

        <View style={styles.assignRow}>
          <Pressable testID="change-driver" style={styles.assignChip} onPress={() => setAssignFor("driver")}>
            <Txt variant="mono" color={colors.muted}>{route.driver_name || "Sem motorista"}</Txt>
            <Ionicons name="create-outline" size={14} color={colors.brand} />
          </Pressable>
          <Pressable testID="change-vehicle" style={styles.assignChip} onPress={() => setAssignFor("vehicle")}>
            <Txt variant="mono" color={colors.muted}>{vehicle?.plate || "Sem viatura"}</Txt>
            <Ionicons name="create-outline" size={14} color={colors.brand} />
          </Pressable>
        </View>
        <View style={styles.statsRow}>
          <Cell label="ESTADO" value={st.label} />
          <Cell label="DISTÂNCIA" value={`${route.distance_km}km`} />
          <Cell label="DURAÇÃO" value={`${Math.round(route.duration_min)}min`} />
        </View>
        <View style={styles.statsRow}>
          <Cell label="PARAGENS" value={stops.length} />
          <Cell label="CONTENTORES" value={tasks.length} />
          <Cell label="CAP." value={`${route.capacity_utilization}%`} />
        </View>

        {route.status === "completed" && (
          <>
            <Txt variant="label">REAL (VS. PLANEADO)</Txt>
            <View style={styles.statsRow}>
              <Cell label="DISTÂNCIA REAL" value={route.actual_distance_km != null ? `${route.actual_distance_km}km` : "—"} />
              <Cell label="DURAÇÃO REAL" value={route.actual_duration_min != null ? `${Math.round(route.actual_duration_min)}min` : "—"} />
            </View>
            <View style={styles.statsRow}>
              <Cell label="RECOLHIDOS" value={route.collected_count ?? 0} />
              <Cell label="FALHADOS" value={route.failed_count ?? 0} />
              <Cell label="IGNORADOS" value={route.ignored_count ?? 0} />
            </View>
          </>
        )}

        <View style={styles.actions}>
          {route.status === "scheduled" && <Btn testID="start-route" title="INICIAR" variant="success" icon="play" style={{ flex: 1 }} loading={busy} onPress={start} />}
          <Btn testID="reoptimize-route" title="REOTIMIZAR" variant="primary" icon="git-network" style={{ flex: 1 }} loading={busy} onPress={reoptimize} />
        </View>
        <Btn testID="add-stop-button" title="ADICIONAR PARAGEM" variant="outline" icon="add" loading={busy} onPress={() => setAddOpen(true)} />

        <Txt variant="label">PARAGENS ({stops.length})</Txt>
        {stops.map((stop: any, i: number) => (
          <View key={stop.id} style={styles.stopCard} testID={`stop-${stop.id}`}>
            <View style={styles.stopHead}>
              <View style={styles.seq}><Txt variant="monoBold" color="#fff">{stop.sequence}</Txt></View>
              <View style={{ flex: 1 }}>
                <Txt variant="displaySm" numberOfLines={1} style={{ fontSize: 16 }}>PARAGEM {stop.sequence}</Txt>
                <Txt variant="mono" color={colors.muted} numberOfLines={1}>{stop.address || "Sem morada"}</Txt>
              </View>
              <View style={styles.stopMoveBtns}>
                <Pressable testID={`up-${stop.id}`} disabled={i === 0 || busy} onPress={() => moveStop(-1, i)} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="chevron-up" size={18} color={i === 0 ? colors.muted : colors.onSurface} />
                </Pressable>
                <Pressable testID={`down-${stop.id}`} disabled={i === stops.length - 1 || busy} onPress={() => moveStop(1, i)} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="chevron-down" size={18} color={i === stops.length - 1 ? colors.muted : colors.onSurface} />
                </Pressable>
              </View>
            </View>

            <Txt variant="label">{(stop.tasks || []).length} CONTENTORES</Txt>
            {(stop.tasks || []).map((t: any) => {
              const ts = taskStatus[t.status] || taskStatus.scheduled;
              const c = containersById[t.container_id];
              return (
                <View key={t.id} style={styles.taskRow}>
                  <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>
                    {c?.qr_code || t.container_id.slice(0, 8).toUpperCase()} — {wasteLabels[t.waste_type] || t.waste_type}
                  </Txt>
                  <View style={[styles.tstatus, { backgroundColor: ts.color }]}>
                    <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{ts.label}</Txt>
                  </View>
                </View>
              );
            })}

            <View style={styles.stopActions}>
              <Pressable testID={`move-${stop.id}`} disabled={busy} onPress={() => openMove(stop)} style={styles.stopActionBtn}>
                <Ionicons name="swap-horizontal" size={16} color={colors.onSurface} />
                <Txt variant="monoBold" style={{ fontSize: 12 }}>MOVER</Txt>
              </Pressable>
              <Pressable testID={`remove-${stop.id}`} disabled={busy} onPress={() => removeStop(stop.id)} style={styles.stopActionBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Txt variant="monoBold" style={{ fontSize: 12 }} color={colors.error}>REMOVER</Txt>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={[styles.flex, { paddingTop: insets.top }]}>
          <ScreenHeader title="ADICIONAR PARAGEM" subtitle="ESCOLHER CONTENTORES" right={
            <Pressable testID="close-add-stop" onPress={() => setAddOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          } />
          <ScrollView contentContainerStyle={styles.scroll}>
            <ContainerPicker value={addSelection} onChange={setAddSelection} />
            <Btn testID="confirm-add-stop" title="CONFIRMAR" onPress={confirmAdd} disabled={!addSelection.length} />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!moveFor} transparent animationType="slide" onRequestClose={() => setMoveFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMoveFor(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">MOVER PARA...</Txt>
            <Txt variant="mono" color={colors.muted}>Rotas da mesma data ({route.date})</Txt>
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              {otherRoutes.length === 0 ? (
                <Txt variant="mono" color={colors.muted}>Sem outras rotas nesta data.</Txt>
              ) : (
                otherRoutes.map((r) => (
                  <Pressable key={r.id} testID={`move-target-${r.id}`} style={styles.reason} onPress={() => confirmMove(r.id)}>
                    <Txt variant="monoBold">{r.code} — {r.driver_name || "Sem motorista"}</Txt>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">{assignFor === "driver" ? "ALTERAR MOTORISTA" : "ALTERAR VIATURA"}</Txt>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              {assignFor === "driver"
                ? drivers.map((d) => {
                    const av = driverAvailability(d);
                    return (
                      <Pressable key={d.id} testID={`assign-driver-${d.id}`} style={styles.reason} onPress={() => assignDriver(d.id)}>
                        <View>
                          <Txt variant="monoBold">{d.name}</Txt>
                          <Txt variant="label" color={av.color}>{av.label}</Txt>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                      </Pressable>
                    );
                  })
                : vehicles.map((v) => {
                    const av = vehicleAvailability(v);
                    return (
                      <Pressable key={v.id} testID={`assign-vehicle-${v.id}`} style={styles.reason} onPress={() => assignVehicle(v.id)}>
                        <View>
                          <Txt variant="monoBold">{v.plate}</Txt>
                          <Txt variant="label" color={av.color}>{av.label}</Txt>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                      </Pressable>
                    );
                  })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: any }) {
  return (<View style={styles.cell}><Txt variant="monoBold" style={{ fontSize: 15 }} numberOfLines={1}>{value}</Txt><Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  mapBox: { height: 200, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  assignRow: { flexDirection: "row", gap: spacing.sm },
  assignChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: border.width, borderColor: colors.border, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statsRow: { flexDirection: "row", borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  cell: { flex: 1, padding: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border, alignItems: "center" },
  actions: { flexDirection: "row", gap: spacing.md },
  stopCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  stopHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stopMoveBtns: { flexDirection: "row" },
  iconBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  seq: { width: 32, height: 32, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: border.width, borderColor: colors.border, borderRadius: 12, padding: spacing.sm },
  tstatus: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 8 },
  stopActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  stopActionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  reason: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md },
});
