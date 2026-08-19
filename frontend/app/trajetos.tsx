import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border, radius, trackingSessionStatus } from "@/src/theme";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Trajetos() {
  const router = useRouter();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get<any[]>("/tracking-sessions").then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.flex}>
      <ScreenHeader title="TRAJETOS GRAVADOS" subtitle={items ? `${items.length} TRAJETOS` : "SISTEMA"} back />
      {!items ? <Loading /> : items.length === 0 ? (
        <Empty text="Ainda não há nenhum trajeto gravado por um motorista" icon="recording-outline" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((s) => {
            const st = trackingSessionStatus[s.status] || trackingSessionStatus.recording;
            return (
              <Pressable key={s.id} testID={`tracking-row-${s.id}`} onPress={() => router.push(`/trajeto/${s.id}` as any)} style={styles.row}>
                <View style={[styles.stBar, { backgroundColor: st.color }]} />
                <View style={{ flex: 1 }}>
                  <Txt variant="monoBold">{s.driver_name || "Motorista"} · {s.vehicle_plate || "—"}</Txt>
                  <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>{formatWhen(s.started_at)}</Txt>
                  <Txt variant="label" style={{ marginTop: 2 }}>
                    {(s.distance_km || 0).toFixed(1).replace(".", ",")} km · {s.point_count || 0} pontos
                    {s.duration_min ? ` · ${Math.round(s.duration_min)} min` : ""}
                    {s.route_id ? " · com rota associada" : ""}
                  </Txt>
                </View>
                <View style={[styles.st, { backgroundColor: st.color }]}>
                  <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface,
  },
  stBar: { width: 4, alignSelf: "stretch", borderRadius: radius.pill },
  st: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
});
