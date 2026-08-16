import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { Card, Loading, StatCard, Txt } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, incidentStatus, incidentKindLabels } from "@/src/theme";

type Dash = {
  kpis: Record<string, number>;
  active_routes: number;
  delayed_routes: number;
  pending: number;
  recent_incidents: any[];
  alerts: { type: string; severity: string; message: string }[];
};

export default function Painel() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [dash, setDash] = useState<Dash | null>(null);
  const [live, setLive] = useState<any[]>([]);
  const [places, setPlaces] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatic = useCallback(async () => {
    const [depots, facilities] = await Promise.all([
      api.get<any[]>("/depots"),
      api.get<any[]>("/facilities"),
    ]);
    setPlaces([
      ...depots.map((d) => ({ id: `dep-${d.id}`, lat: d.lat, lng: d.lng, color: colors.onSurface })),
      ...facilities.map((f) => ({ id: `fac-${f.id}`, lat: f.lat, lng: f.lng, color: colors.success })),
    ]);
  }, []);

  const loadDash = useCallback(async () => {
    const [d, l] = await Promise.all([
      api.get<Dash>("/analytics/dashboard"),
      api.get<any[]>("/gps/live"),
    ]);
    setDash(d);
    setLive(l);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatic();
      loadDash();
      const t = setInterval(() => api.get<any[]>("/gps/live").then(setLive).catch(() => {}), 5000);
      return () => clearInterval(t);
    }, [loadDash, loadStatic])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDash();
    setRefreshing(false);
  };

  const truckMarkers = live.map((p) => ({ id: `v-${p.vehicle_id}`, lat: p.lat, lng: p.lng, color: colors.brand }));

  if (!dash) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="PAINEL" subtitle={user?.company?.name || "WASTEFLOW"} />
        <Loading />
      </View>
    );
  }

  const k = dash.kpis;
  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="PAINEL"
        subtitle={user?.company?.name || "WASTEFLOW"}
        right={
          <Pressable testID="logout-button" onPress={logout} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.kpiGrid}>
          <StatCard testID="kpi-active-trucks" icon="bus" label="Camiões Ativos" value={k.active_trucks} accent={colors.brand} />
          <StatCard testID="kpi-collections-today" icon="cube" label="Recolhas Hoje" value={k.collections_today} accent={colors.info} />
        </View>
        <View style={styles.kpiGrid}>
          <StatCard testID="kpi-completed" icon="checkmark-circle" label="Concluídas" value={k.completed} accent={colors.success} />
          <StatCard testID="kpi-failed" icon="close-circle" label="Falhadas" value={k.failed} accent={colors.error} />
        </View>
        <View style={styles.kpiGrid}>
          <StatCard testID="kpi-overdue" icon="time" label="Em Atraso" value={k.overdue} accent={colors.warning} />
          <StatCard testID="kpi-incidents" icon="warning" label="Ocorrências Ativas" value={k.active_incidents} accent={colors.error} />
        </View>

        <Pressable testID="open-full-map" onPress={() => router.push("/(manager)/mapa")}>
          <View style={styles.mapBox}>
            <FleetMap markers={[...places, ...truckMarkers]} />
            <View style={styles.mapTag}>
              <Txt variant="monoBold" color="#fff" style={{ fontSize: 10 }}>
                {live.length} VIATURAS · TEMPO REAL
              </Txt>
            </View>
          </View>
        </Pressable>

        <View style={styles.rowSplit}>
          <View style={[styles.miniStat, { borderColor: colors.brand }]}>
            <Txt variant="displaySm" color={colors.brand}>{dash.active_routes}</Txt>
            <Txt variant="label">Rotas Ativas</Txt>
          </View>
          <View style={[styles.miniStat, { borderColor: colors.warning }]}>
            <Txt variant="displaySm" color={colors.warning}>{dash.delayed_routes}</Txt>
            <Txt variant="label">Rotas Atrasadas</Txt>
          </View>
        </View>

        {dash.alerts.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Txt variant="label">ALERTAS INTELIGENTES</Txt>
            {dash.alerts.map((a, i) => (
              <View key={i} style={styles.alert} testID={`alert-${i}`}>
                <Ionicons name="warning" size={18} color={colors.warning} />
                <Txt variant="mono" style={{ flex: 1 }}>{a.message}</Txt>
              </View>
            ))}
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          <Txt variant="label">OCORRÊNCIAS RECENTES</Txt>
          {dash.recent_incidents.length === 0 ? (
            <Card><Txt variant="mono" color={colors.muted}>Sem ocorrências recentes.</Txt></Card>
          ) : (
            dash.recent_incidents.map((inc) => {
              const st = incidentStatus[inc.status] || incidentStatus.open;
              return (
                <Pressable key={inc.id} testID={`incident-${inc.id}`} onPress={() => router.push(`/incident/${inc.id}` as any)}>
                  <View style={styles.incidentRow}>
                    <View style={[styles.dot, { backgroundColor: st.color }]} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="monoBold">{incidentKindLabels[inc.kind] || inc.kind}</Txt>
                      <Txt variant="mono" color={colors.muted} numberOfLines={1}>{inc.description}</Txt>
                    </View>
                    <Txt variant="label" color={st.color}>{st.label}</Txt>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  kpiGrid: { flexDirection: "row", gap: spacing.md },
  mapBox: { height: 240, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  mapTag: { position: "absolute", bottom: 8, left: 8, backgroundColor: colors.onSurface, paddingHorizontal: 8, paddingVertical: 4 },
  rowSplit: { flexDirection: "row", gap: spacing.md },
  miniStat: { flex: 1, borderWidth: border.width, padding: spacing.md, backgroundColor: colors.surface },
  alert: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: border.width, borderColor: colors.warning, backgroundColor: "#FFFBEB", padding: spacing.md },
  incidentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md, backgroundColor: colors.surface },
  dot: { width: 12, height: 12 },
});
