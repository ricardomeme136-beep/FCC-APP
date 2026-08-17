import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { getCurrentLocation } from "@/src/utils/location";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius, routeStatus } from "@/src/theme";

const TODAY = new Date().toISOString().slice(0, 10);
const STATUS_PRIORITY: Record<string, number> = { in_progress: 0, scheduled: 1, completed: 2, cancelled: 3 };

export default function DriverRota() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [routesToday, setRoutesToday] = useState<any[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const all = await api.get<any[]>("/routes");
    const mine = all
      .filter((r) => r.date === TODAY)
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
    setRoutesToday(mine);
    if (mine.length === 1) setSelectedId(mine[0].id);
    else if (mine.length > 1 && !selectedId) setSelectedId(mine[0].id);
  }, [selectedId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    api.get<any>(`/routes/${selectedId}`).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  const beginRoute = async () => {
    if (!detail) return;
    setStarting(true);
    try {
      let gps: any = {};
      try {
        const pos = await getCurrentLocation();
        gps = { lat: pos.lat, lng: pos.lng };
      } catch {
        toast("Não foi possível obter a localização inicial — a rota vai iniciar na mesma", "info");
      }
      await api.post(`/routes/${detail.id}/start`, gps);
      router.replace("/(driver)/navegacao");
    } catch (e: any) {
      toast(e?.message || "Erro ao iniciar a rota", "error");
    } finally {
      setStarting(false);
    }
  };

  const continueRoute = () => router.replace("/(driver)/navegacao");

  if (!routesToday) {
    return (<View style={styles.flex}><ScreenHeader title="A SUA ROTA DE HOJE" subtitle="MOTORISTA" dark /><Loading text="A PROCURAR ROTA..." /></View>);
  }

  if (routesToday.length === 0) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="A SUA ROTA DE HOJE" subtitle="MOTORISTA" dark />
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={64} color={colors.muted} />
          <Txt variant="displaySm" style={{ textAlign: "center" }}>Não tem nenhuma rota atribuída para hoje.</Txt>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="A SUA ROTA DE HOJE" subtitle="MOTORISTA" dark />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        {routesToday.length > 1 && (
          <>
            <Txt variant="label">AS SUAS ROTAS DE HOJE</Txt>
            <View style={styles.list}>
              {routesToday.map((r) => {
                const st = routeStatus[r.status] || routeStatus.scheduled;
                return (
                  <Pressable key={r.id} testID={`today-route-${r.id}`} onPress={() => setSelectedId(r.id)}
                    style={[styles.listRow, selectedId === r.id ? styles.listRowActive : null]}>
                    <Txt variant="monoBold">{r.code}</Txt>
                    <View style={[styles.stTag, { backgroundColor: st.color }]}>
                      <Txt variant="monoBold" color="#fff" style={{ fontSize: 10 }}>{st.label}</Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {!detail ? (
          <Loading />
        ) : (
          <View style={styles.summary}>
            <Txt variant="display" color={colors.brand}>{detail.code}</Txt>
            <Row label="Viatura" value={detail.vehicle_id ? (detail.vehicle_plate || "Atribuída") : "Sem viatura"} />
            <Row label="Estado" value={(routeStatus[detail.status] || routeStatus.scheduled).label} />
            <View style={styles.summaryGrid}>
              <SumCell label="PARAGENS" value={(detail.stops || []).length} />
              <SumCell label="CONTENTORES" value={(detail.tasks || []).length} />
              <SumCell label="DISTÂNCIA" value={`${detail.distance_km}km`} />
              <SumCell label="ESTIMADO" value={`${Math.floor(detail.duration_min / 60)}h${Math.round(detail.duration_min % 60)}`} />
            </View>

            {detail.status === "scheduled" && (
              <Btn testID="begin-route" title="COMEÇAR ROTA" icon="play" size="xl" loading={starting} onPress={beginRoute} style={{ marginTop: spacing.lg }} />
            )}
            {detail.status === "in_progress" && (
              <Btn testID="continue-route" title="CONTINUAR ROTA" icon="navigate" size="xl" variant="success" onPress={continueRoute} style={{ marginTop: spacing.lg }} />
            )}
            {(detail.status === "completed" || detail.status === "cancelled") && (
              <View style={styles.doneBox}>
                <Ionicons name="checkmark-done-circle" size={40} color={colors.success} />
                <Txt variant="monoBold" color={colors.muted}>{(routeStatus[detail.status] || routeStatus.scheduled).label}</Txt>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.row}>
      <Txt variant="mono" color="#A1A1AA">{label}</Txt>
      <Txt variant="monoBold" color="#fff">{value}</Txt>
    </View>
  );
}

function SumCell({ label, value }: { label: string; value: any }) {
  return (<View style={styles.sumCell}><Txt variant="monoBold" color="#FFFFFF" style={{ fontSize: 18 }}>{value}</Txt><Txt variant="label" color="#A1A1AA">{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  list: { gap: spacing.sm },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  listRowActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  stTag: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 8 },
  summary: { backgroundColor: colors.onSurface, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  sumCell: { width: "47%" },
  doneBox: { alignItems: "center", gap: spacing.xs, marginTop: spacing.lg },
});
