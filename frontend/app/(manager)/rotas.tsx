import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Card, Empty, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, routeStatus, wasteLabels } from "@/src/theme";

export default function Rotas() {
  const router = useRouter();
  const toast = useToast();
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [trucks, setTrucks] = useState(4);
  const [optimizing, setOptimizing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<any[]>("/routes");
    setRoutes(r);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    setOptimizing(true);
    try {
      const res = await api.post<{ count: number }>("/routes/optimize", { num_trucks: trucks });
      toast(`${res.count} rotas otimizadas geradas`, "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Falha na otimização", "error");
    } finally {
      setOptimizing(false);
    }
  };

  if (!routes) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="ROTAS" subtitle="GESTÃO DE ROTAS" />
        <Loading />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="ROTAS" subtitle="GESTÃO DE ROTAS" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Card style={{ gap: spacing.md }}>
          <Txt variant="label">OTIMIZAÇÃO AUTOMÁTICA</Txt>
          <View style={styles.stepperRow}>
            <Txt variant="mono">Nº de camiões</Txt>
            <View style={styles.stepper}>
              <Pressable testID="trucks-minus" onPress={() => setTrucks((t) => Math.max(1, t - 1))} style={styles.stepBtn}>
                <Ionicons name="remove" size={20} color={colors.onSurface} />
              </Pressable>
              <Txt variant="monoBold" style={{ fontSize: 18, minWidth: 30, textAlign: "center" }}>{trucks}</Txt>
              <Pressable testID="trucks-plus" onPress={() => setTrucks((t) => Math.min(6, t + 1))} style={styles.stepBtn}>
                <Ionicons name="add" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
          <Btn testID="generate-routes-button" title="GERAR ROTAS OTIMIZADAS" icon="git-network" loading={optimizing} onPress={generate} />
        </Card>

        {routes.length === 0 ? (
          <Empty text="Nenhuma rota criada. Gere rotas otimizadas acima." icon="navigate-outline" />
        ) : (
          routes.map((r) => {
            const st = routeStatus[r.status] || routeStatus.scheduled;
            return (
              <Pressable key={r.id} testID={`route-${r.id}`} onPress={() => router.push(`/route/${r.id}` as any)}>
                <View style={styles.routeCard}>
                  <View style={styles.routeHead}>
                    <Txt variant="displaySm">{r.code}</Txt>
                    <View style={[styles.stTag, { backgroundColor: st.color }]}>
                      <Txt variant="monoBold" color="#fff" style={{ fontSize: 10 }}>{st.label}</Txt>
                    </View>
                  </View>
                  <Txt variant="mono" color={colors.muted}>
                    {r.driver_name || "Sem motorista"} · {wasteLabels[r.waste_type] || r.waste_type}
                  </Txt>
                  <View style={styles.routeStats}>
                    <Stat label="RECOLHAS" value={r.num_stops} />
                    <Stat label="DISTÂNCIA" value={`${r.distance_km} km`} />
                    <Stat label="DURAÇÃO" value={`${Math.round(r.duration_min)} min`} />
                    <Stat label="CAPACIDADE" value={`${r.capacity_utilization}%`} />
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="monoBold" style={{ fontSize: 15 }}>{value}</Txt>
      <Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  stepBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  routeCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  routeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stTag: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  routeStats: { flexDirection: "row", marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
