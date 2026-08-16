import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Txt, Badge } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, wasteColors, vehicleStatus } from "@/src/theme";

const LAYERS = [
  { key: "trucks", label: "VIATURAS", icon: "bus" as const },
  { key: "containers", label: "CONTENTORES", icon: "cube" as const },
  { key: "incidents", label: "OCORRÊNCIAS", icon: "warning" as const },
  { key: "places", label: "DEPÓSITOS", icon: "business" as const },
];

export default function Mapa() {
  const [live, setLive] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [places, setPlaces] = useState<any[]>([]);
  const [active, setActive] = useState<Record<string, boolean>>({ trucks: true, containers: false, incidents: true, places: true });
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const [c, inc, dep, fac] = await Promise.all([
        api.get<any[]>("/containers?limit=500"),
        api.get<any[]>("/incidents?status=open"),
        api.get<any[]>("/depots"),
        api.get<any[]>("/facilities"),
      ]);
      setContainers(c);
      setIncidents(inc);
      setPlaces([
        ...dep.map((d) => ({ id: `dep-${d.id}`, lat: d.lat, lng: d.lng, color: colors.onSurface })),
        ...fac.map((f) => ({ id: `fac-${f.id}`, lat: f.lat, lng: f.lng, color: colors.success })),
      ]);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      api.get<any[]>("/gps/live").then(setLive).catch(() => {});
      const t = setInterval(() => api.get<any[]>("/gps/live").then(setLive).catch(() => {}), 4000);
      return () => clearInterval(t);
    }, [])
  );

  const markers: any[] = [];
  if (active.places) markers.push(...places);
  if (active.containers)
    markers.push(...containers.map((c) => ({ id: `c-${c.id}`, lat: c.lat, lng: c.lng, color: wasteColors[c.waste_type] || colors.info })));
  if (active.incidents)
    markers.push(...incidents.filter((i) => i.lat).map((i) => ({ id: `i-${i.id}`, lat: i.lat, lng: i.lng, color: colors.error })));
  if (active.trucks)
    markers.push(...live.map((p) => ({ id: `v-${p.vehicle_id}`, lat: p.lat, lng: p.lng, color: colors.brand })));

  const onMarker = async (id: string) => {
    if (id.startsWith("v-")) {
      const vid = id.slice(2);
      try {
        const v = await api.get<any>(`/vehicles/${vid}`);
        setSelected({ ...v, live: live.find((p) => p.vehicle_id === vid) });
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
        <FleetMap markers={markers} onPressMarker={onMarker} />
      </View>

      {selected && (
        <View style={styles.detail} testID="vehicle-detail">
          <View style={styles.detailHead}>
            <View>
              <Txt variant="displaySm">{selected.plate}</Txt>
              <Txt variant="label">{selected.brand} {selected.model}</Txt>
            </View>
            <Pressable testID="close-detail" onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <Badge label={(vehicleStatus[selected.status] || vehicleStatus.offline).label} color={(vehicleStatus[selected.status] || vehicleStatus.offline).color} />
          <View style={styles.detailGrid}>
            <Detail label="VELOCIDADE" value={`${Math.round(selected.live?.speed || 0)} km/h`} />
            <Detail label="DIREÇÃO" value={`${Math.round(selected.live?.heading || 0)}°`} />
            <Detail label="CAPACIDADE" value={`${selected.capacity_kg} kg`} />
            <Detail label="COMBUSTÍVEL" value={`${selected.fuel_pct ?? "—"}%`} />
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
  flex: { flex: 1, backgroundColor: colors.surface },
  chipRowWrap: { borderBottomWidth: border.width, borderBottomColor: colors.borderStrong },
  chipRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "center" },
  chip: {
    height: 36, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0,
    paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.onSurface },
  mapFill: { flex: 1, padding: spacing.md },
  detail: {
    position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md,
    backgroundColor: colors.surface, borderWidth: border.width, borderColor: colors.borderStrong,
    padding: spacing.lg, gap: spacing.sm,
  },
  detailHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap" },
  detailCell: { width: "50%", paddingVertical: spacing.xs },
});
