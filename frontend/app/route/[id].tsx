import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, routeStatus, taskStatus, wasteLabels } from "@/src/theme";

export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [route, setRoute] = useState<any | null>(null);
  const [geo, setGeo] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<any>(`/routes/${id}`);
    setRoute(r);
    api.get<any>(`/routes/${id}/geometry`).then(setGeo).catch(() => {});
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!route) return (<View style={styles.flex}><ScreenHeader title="ROTA" back /><Loading /></View>);

  const st = routeStatus[route.status] || routeStatus.scheduled;
  const tasks = route.tasks || [];
  const markers = tasks.map((t: any, i: number) => ({
    id: t.id, lat: t.lat, lng: t.lng, kind: "container" as const,
    color: t.status === "collected" ? colors.success : t.status === "failed" ? colors.error : colors.brand,
  }));
  const line = geo?.coordinates?.length ? geo.coordinates : tasks.map((t: any) => ({ latitude: t.lat, longitude: t.lng }));

  const reoptimize = async () => {
    setBusy(true);
    try { await api.post(`/routes/${id}/reoptimize`); toast("Rota reotimizada", "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); } finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true);
    try { await api.post(`/routes/${id}/start`); toast("Rota iniciada", "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); } finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title={route.code} subtitle={st.label} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.mapBox}><FleetMap markers={markers} polylines={[{ coordinates: line, color: colors.brand, width: 4 }]} /></View>

        <View style={styles.statsRow}>
          <Cell label="RECOLHAS" value={route.num_stops} />
          <Cell label="DISTÂNCIA" value={`${route.distance_km}km`} />
          <Cell label="DURAÇÃO" value={`${Math.round(route.duration_min)}min`} />
          <Cell label="CAP." value={`${route.capacity_utilization}%`} />
        </View>
        <Txt variant="mono" color={colors.muted}>
          {route.driver_name || "Sem motorista"} · {wasteLabels[route.waste_type] || route.waste_type}
        </Txt>

        <View style={styles.actions}>
          {route.status === "scheduled" && <Btn testID="start-route" title="INICIAR" variant="success" icon="play" style={{ flex: 1 }} loading={busy} onPress={start} />}
          <Btn testID="reoptimize-route" title="REOTIMIZAR" variant="primary" icon="git-network" style={{ flex: 1 }} loading={busy} onPress={reoptimize} />
        </View>

        <Txt variant="label">SEQUÊNCIA DE RECOLHAS ({tasks.length})</Txt>
        {tasks.map((t: any) => {
          const ts = taskStatus[t.status] || taskStatus.scheduled;
          return (
            <View key={t.id} style={styles.task}>
              <View style={styles.seq}><Txt variant="monoBold" color="#fff">{t.sequence}</Txt></View>
              <View style={{ flex: 1 }}>
                <Txt variant="mono" numberOfLines={1}>{t.address || "Sem morada"}</Txt>
                <Txt variant="label">{wasteLabels[t.waste_type] || t.waste_type}</Txt>
              </View>
              <View style={[styles.tstatus, { backgroundColor: ts.color }]}><Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{ts.label}</Txt></View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: any }) {
  return (<View style={styles.cell}><Txt variant="monoBold" style={{ fontSize: 16 }}>{value}</Txt><Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  mapBox: { height: 200, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  statsRow: { flexDirection: "row", borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  cell: { flex: 1, padding: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border, alignItems: "center" },
  actions: { flexDirection: "row", gap: spacing.md },
  task: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.sm },
  seq: { width: 32, height: 32, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center" },
  tstatus: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
});
