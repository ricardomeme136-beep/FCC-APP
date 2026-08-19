import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, Pressable, useWindowDimensions } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import {
  CompactCard, Loading, DashboardStat, SectionHeader, MapToolbar, MapToolbarItem,
  LiveDriverRow, AlertRow, IncidentRow, Txt,
} from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, radius, incidentStatus, incidentKindLabels } from "@/src/theme";
import { agoLabel } from "@/src/utils/time";

type ActiveDriver = {
  id: string; name: string; activity_status: string;
  current_route_code: string | null; current_vehicle_plate: string | null;
  last_seen_at: string | null;
};
type Dash = {
  kpis: Record<string, number>;
  active_routes: number;
  delayed_routes: number;
  pending: number;
  recent_incidents: any[];
  active_drivers_list: ActiveDriver[];
  alerts: { type: string; severity: string; message: string }[];
};

const DESKTOP_BREAKPOINT = 768;
// A driver whose live GPS hasn't updated in a while is a real, data-backed
// distinction (not an invented state) — same threshold family as the admin
// live map (mapa.tsx). Only "on_route" drivers ever get checked against it.
const GPS_STALE_WARN_S = 45;

const MAP_LAYERS: MapToolbarItem[] = [
  { key: "trucks", label: "MOTORISTAS", icon: "walk" },
  { key: "containers", label: "CONTENTORES", icon: "cube" },
  { key: "routes", label: "ROTAS", icon: "git-network" },
  { key: "places", label: "DEPÓSITOS", icon: "business" },
];

// Presença (heartbeat/last_seen_at) vs. GPS (rota in_progress) são
// deliberadamente independentes — ver core/activity.py. "ATIVO NA APP" e
// "OFFLINE" nunca implicam nem dependem de posição GPS; só "EM ROTA" (e a
// sua variante "GPS DESATUALIZADO") cruza com /gps/live, e só porque nesse
// caso o motorista já está, de qualquer forma, autorizado a aparecer no mapa.
function driverPresence(d: ActiveDriver, live: any[]): { color: string; meta: string } {
  if (d.activity_status === "on_route") {
    const pos = d.current_vehicle_plate ? live.find((p) => p.plate === d.current_vehicle_plate) : null;
    const gpsStale = pos?.timestamp ? (Date.now() - new Date(pos.timestamp).getTime()) / 1000 > GPS_STALE_WARN_S : false;
    const label = gpsStale ? "GPS DESATUALIZADO" : "EM ROTA";
    const route = [d.current_route_code, d.current_vehicle_plate].filter(Boolean).join(" · ");
    return { color: gpsStale ? colors.warning : colors.fccGreen, meta: `${label}${route ? ` · ${route}` : ""}` };
  }
  if (d.activity_status === "online") {
    return { color: colors.fccBlue, meta: "ATIVO NA APP · sem rota" };
  }
  return { color: colors.muted, meta: "OFFLINE" };
}

export default function Painel() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const mapHeight = isDesktop ? (width >= 1400 ? 520 : 460) : 240;

  const [dash, setDash] = useState<Dash | null>(null);
  const [live, setLive] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [places, setPlaces] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [mapLayers, setMapLayers] = useState<Record<string, boolean>>({ trucks: true, containers: false, routes: false, places: true });

  const loadStatic = useCallback(async () => {
    const [depots, facilities, cs] = await Promise.all([
      api.get<any[]>("/depots"),
      api.get<any[]>("/facilities"),
      api.get<any[]>("/containers?limit=500"),
    ]);
    setContainers(cs);
    setPlaces([
      ...depots.map((d) => ({ id: `dep-${d.id}`, lat: d.lat, lng: d.lng, color: d.is_primary ? colors.fccBlue : colors.onSurface, kind: "depot" as const, label: d.is_primary ? "★" : "C" })),
      ...facilities.map((f) => ({ id: `fac-${f.id}`, lat: f.lat, lng: f.lng, color: colors.fccGreen, kind: "facility" as const })),
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

  if (!dash) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="WasteFlow" subtitle="Painel Operacional" />
        <Loading />
      </View>
    );
  }

  const k = dash.kpis;

  // Same privacy rule as the full admin map (mapa.tsx): a live pin only ever
  // shows for a driver genuinely on_route right now — reuses
  // active_drivers_list (already filtered server-side) instead of an extra
  // /routes fetch just for this.
  const onRoutePlates = new Set(
    dash.active_drivers_list.filter((d) => d.activity_status === "on_route" && d.current_vehicle_plate).map((d) => d.current_vehicle_plate)
  );
  const mapMarkers: any[] = [];
  if (mapLayers.places) mapMarkers.push(...places);
  if (mapLayers.containers) mapMarkers.push(...containers.map((c) => ({ id: `c-${c.id}`, lat: c.lat, lng: c.lng, color: colors.fccBlueLight, kind: "waste_bin" as const })));
  if (mapLayers.trucks) mapMarkers.push(...live.filter((p) => onRoutePlates.has(p.plate)).map((p) => ({ id: `v-${p.vehicle_id}`, lat: p.lat, lng: p.lng, color: colors.fccBlue, kind: "driver" as const, label: p.driver_name || p.plate || "Motorista", heading: p.heading })));

  const mapCard = (
    <View style={[styles.mapCard, { height: mapHeight }]}>
      <View style={styles.mapHead}>
        <View style={styles.mapHeadLeft}>
          <Ionicons name="map" size={14} color={colors.fccBlue} />
          <Txt variant="monoBold" style={{ fontSize: 12 }}>MAPA OPERACIONAL</Txt>
          <Txt variant="label" style={{ fontSize: 10 }}>{live.length} AO VIVO</Txt>
        </View>
        <MapToolbar items={MAP_LAYERS} active={mapLayers} onToggle={(key) => setMapLayers((s) => ({ ...s, [key]: !s[key] }))} />
      </View>
      <Pressable style={styles.mapBody} onPress={() => router.push("/(manager)/mapa")}>
        <FleetMap markers={mapMarkers} />
      </Pressable>
    </View>
  );

  const opsPanel = (
    <View style={[styles.opsPanel, isDesktop ? { width: 320 } : null]}>
      <SectionHeader title="MOTORISTAS" action="VER TODOS" onPressAction={() => router.push("/motoristas" as any)} testID="drivers-see-all" />
      {dash.active_drivers_list.length === 0 ? (
        <CompactCard><Txt variant="mono" color={colors.muted} style={{ fontSize: 13 }}>Nenhum motorista com atividade registada.</Txt></CompactCard>
      ) : (
        <View style={{ gap: spacing.xs }}>
          {dash.active_drivers_list.map((d) => {
            const st = driverPresence(d, live);
            return (
              <LiveDriverRow key={d.id} testID={`active-driver-${d.id}`}
                name={d.name} meta={st.meta} statusColor={st.color} agoLabel={agoLabel(d.last_seen_at)} />
            );
          })}
        </View>
      )}

      {dash.alerts.length > 0 && (
        <>
          <SectionHeader title="ALERTAS" />
          <View style={{ gap: spacing.xs }}>
            {dash.alerts.map((a, i) => (
              <AlertRow key={i} testID={`alert-${i}`} title={a.message}
                tone={a.severity === "high" || a.severity === "error" ? "error" : "warning"} />
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="WasteFlow"
        subtitle="Painel Operacional"
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
          <DashboardStat testID="kpi-active-drivers" icon="people" tone="blue" value={k.drivers_on_route} label="Motoristas em rota" />
          <DashboardStat testID="kpi-active-trucks" icon="bus" tone="blue" value={k.active_trucks} label="Viaturas em rota" />
          <DashboardStat testID="kpi-collections-today" icon="cube" tone="blue" value={k.collections_today} label="Recolhas hoje" />
          <DashboardStat testID="kpi-completed" icon="checkmark-circle" tone="green" value={k.completed} label="Concluídas" />
          <DashboardStat testID="kpi-failed" icon="close-circle" tone="error" value={k.failed} label="Falhadas" />
          <DashboardStat testID="kpi-overdue" icon="time" tone="warning" value={k.overdue} label="Em atraso" />
          <DashboardStat testID="kpi-incidents" icon="warning" tone="error" value={k.active_incidents} label="Ocorrências" />
        </View>

        <View style={isDesktop ? styles.mapRow : null}>
          <View style={isDesktop ? { flex: 1 } : null}>{mapCard}</View>
          {isDesktop ? opsPanel : null}
        </View>
        {!isDesktop ? opsPanel : null}

        <View style={styles.routeMiniRow}>
          <View style={[styles.miniStat, { borderColor: colors.fccBlue }]}>
            <Txt variant="title" color={colors.fccBlue}>{dash.active_routes}</Txt>
            <Txt variant="label">Rotas Ativas</Txt>
          </View>
          <View style={[styles.miniStat, { borderColor: colors.warning }]}>
            <Txt variant="title" color={colors.warning}>{dash.delayed_routes}</Txt>
            <Txt variant="label">Rotas Atrasadas</Txt>
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <SectionHeader title="OCORRÊNCIAS RECENTES" />
          {dash.recent_incidents.length === 0 ? (
            <CompactCard><Txt variant="mono" color={colors.muted} style={{ fontSize: 13 }}>Sem ocorrências recentes.</Txt></CompactCard>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {dash.recent_incidents.map((inc) => {
                const st = incidentStatus[inc.status] || incidentStatus.open;
                return (
                  <IncidentRow key={inc.id} testID={`incident-${inc.id}`}
                    title={incidentKindLabels[inc.kind] || inc.kind} description={inc.description}
                    statusLabel={st.label} statusColor={st.color}
                    onPress={() => router.push(`/incident/${inc.id}` as any)} />
                );
              })}
            </View>
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
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mapRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  mapCard: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface,
    overflow: "hidden",
  },
  mapHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: border.width, borderBottomColor: colors.divider,
  },
  mapHeadLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  mapBody: { flex: 1 },
  opsPanel: { gap: spacing.sm },
  routeMiniRow: { flexDirection: "row", gap: spacing.sm },
  miniStat: { flex: 1, borderWidth: border.width, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface },
});
