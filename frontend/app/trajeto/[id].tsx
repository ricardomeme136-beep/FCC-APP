import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, radius, trackingSessionStatus } from "@/src/theme";

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function TrajetoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [session, setSession] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (id) api.get<any>(`/tracking-sessions/${id}`).then(setSession).catch(() => setSession(null));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createTemplate = async () => {
    if (!name.trim()) { toast("Indique um nome", "error"); return; }
    setCreating(true);
    try {
      // The recording itself (gps_positions, tracking_sessions) is never
      // touched by this — only a brand-new, independent route_template gets
      // written. See routers/tracking.py::save_session_as_template.
      const t = await api.post<any>(`/tracking-sessions/${id}/save-as-template`, {
        name: name.trim(), description,
      });
      setCreateOpen(false);
      router.push(`/template/${t.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Não foi possível criar a rota", "error");
    } finally {
      setCreating(false);
    }
  };

  if (!session) {
    return (<View style={styles.flex}><ScreenHeader title="TRAJETO" back /><Loading /></View>);
  }

  const points: any[] = session.points || [];
  const line = points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  const first = points[0];
  const last = points[points.length - 1];
  const avgSpeedKmh = session.duration_min > 0 ? (session.distance_km / (session.duration_min / 60)) : null;
  const st = trackingSessionStatus[session.status] || trackingSessionStatus.recording;

  const markers = [
    ...(first ? [{ id: "start", lat: first.lat, lng: first.lng, color: colors.success, kind: "container" as const, size: 22, label: "I" }] : []),
    ...(last && last !== first ? [{ id: "end", lat: last.lat, lng: last.lng, color: colors.error, kind: "container" as const, size: 22, label: "F" }] : []),
  ];

  const planned = session.planned;
  const plannedLine = planned?.coordinates?.length ? planned.coordinates : null;
  const plannedKm = planned?.distance_m != null ? planned.distance_m / 1000 : null;
  const plannedMin = planned?.duration_s != null ? planned.duration_s / 60 : null;
  const diffKm = plannedKm != null ? (session.distance_km || 0) - plannedKm : null;
  const diffMin = plannedMin != null && session.duration_min ? session.duration_min - plannedMin : null;
  const fmtSigned = (n: number, unit: string) => `${n >= 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")} ${unit}`;

  const polylines = [
    ...(plannedLine ? [{ coordinates: plannedLine, color: colors.muted, width: 3 }] : []),
    ...(line.length >= 2 ? [{ coordinates: line, color: colors.brand, width: 5 }] : []),
  ];

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={session.driver_name || "Trajeto"}
        subtitle={`${session.vehicle_plate || ""} · ${formatTime(session.started_at)}`.trim()}
        back
      />
      <View style={styles.mapBox}>
        {line.length >= 2 ? (
          <FleetMap markers={markers} polylines={polylines} style={{ flex: 1 }} />
        ) : (
          <View style={styles.mapEmpty}><Txt variant="mono" color={colors.muted}>Sem pontos GPS suficientes para desenhar o trajeto</Txt></View>
        )}
      </View>
      {plannedLine && (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.muted }]} /><Txt variant="label">PLANEADA</Txt></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brand }]} /><Txt variant="label">REAL</Txt></View>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.stBadge, { backgroundColor: st.color }]}>
          <Txt variant="monoBold" color="#fff" style={{ fontSize: 11 }}>{st.label}</Txt>
        </View>
        <View style={styles.grid}>
          <Cell label="DISTÂNCIA" value={`${(session.distance_km || 0).toFixed(1).replace(".", ",")} km`} />
          <Cell label="DURAÇÃO" value={session.duration_min ? `${Math.round(session.duration_min)} min` : "—"} />
          <Cell label="VELOC. MÉDIA" value={avgSpeedKmh != null ? `${avgSpeedKmh.toFixed(0)} km/h` : "—"} />
          <Cell label="PONTOS GPS" value={String(session.point_count || 0)} />
          <Cell label="INÍCIO" value={formatTime(session.started_at)} />
          <Cell label="FIM" value={formatTime(session.ended_at)} />
        </View>
        <Btn testID="create-template-from-trajeto" title="CRIAR ROTA A PARTIR DESTE TRAJETO" icon="git-network"
             variant="outline" disabled={points.length < 2} onPress={() => setCreateOpen(true)} />

        {!session.route_id && (
          <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>
            Este trajeto não está associado a nenhuma rota planeada.
          </Txt>
        )}
        {plannedKm != null && (
          <View style={styles.compareBox}>
            <Txt variant="label">PLANEADO VS REAL</Txt>
            <View style={styles.compareRow}>
              <Txt variant="mono" color={colors.muted}>Planeado</Txt>
              <Txt variant="monoBold">{plannedKm.toFixed(1).replace(".", ",")} km</Txt>
            </View>
            <View style={styles.compareRow}>
              <Txt variant="mono" color={colors.muted}>Real</Txt>
              <Txt variant="monoBold">{(session.distance_km || 0).toFixed(1).replace(".", ",")} km</Txt>
            </View>
            <View style={styles.compareRow}>
              <Txt variant="mono" color={colors.muted}>Diferença</Txt>
              <Txt variant="monoBold" color={diffKm != null && diffKm > 0 ? colors.warning : colors.success}>
                {diffKm != null ? fmtSigned(diffKm, "km") : "—"}
              </Txt>
            </View>
            {diffMin != null && (
              <View style={styles.compareRow}>
                <Txt variant="mono" color={colors.muted}>Diferença de duração</Txt>
                <Txt variant="monoBold" color={diffMin > 0 ? colors.warning : colors.success}>{fmtSigned(diffMin, "min")}</Txt>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCreateOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">CRIAR ROTA A PARTIR DO TRAJETO</Txt>
            <Txt variant="mono" color={colors.muted} style={{ marginTop: spacing.xs, fontSize: 12 }}>
              A gravação original não é alterada. A geometria é copiada dos pontos GPS; as paragens começam vazias — adicione-as depois no editor.
            </Txt>
            <Txt variant="label" style={{ marginTop: spacing.md }}>NOME</Txt>
            <TextInput testID="trajeto-template-name-input" style={styles.input} value={name} onChangeText={setName}
                      placeholder="Nome da rota" placeholderTextColor={colors.muted} autoFocus />
            <Txt variant="label" style={{ marginTop: spacing.md }}>DESCRIÇÃO (OPCIONAL)</Txt>
            <TextInput testID="trajeto-template-description-input" style={[styles.input, { height: 70 }]} value={description} onChangeText={setDescription}
                      placeholder="Descrição" placeholderTextColor={colors.muted} multiline />
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Btn testID="cancel-trajeto-template" title="CANCELAR" variant="outline" style={{ flex: 1 }} onPress={() => setCreateOpen(false)} />
              <Btn testID="confirm-trajeto-template" title="CRIAR E EDITAR" style={{ flex: 1 }} loading={creating} onPress={createTemplate} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (<View style={styles.cell}><Txt variant="display" style={{ fontSize: 18 }}>{value}</Txt><Txt variant="label">{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  mapBox: { height: 260, borderBottomWidth: border.width, borderBottomColor: colors.divider },
  mapEmpty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  stBadge: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  cell: {
    width: "30%", padding: spacing.md, backgroundColor: colors.surface, borderWidth: border.width,
    borderColor: colors.border, borderRadius: radius.md, gap: 2,
  },
  legendRow: { flexDirection: "row", gap: spacing.lg, padding: spacing.sm, justifyContent: "center", backgroundColor: colors.surface },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 10, height: 3, borderRadius: radius.pill },
  compareBox: {
    gap: spacing.xs, padding: spacing.md, backgroundColor: colors.surface, borderWidth: border.width,
    borderColor: colors.border, borderRadius: radius.md,
  },
  compareRow: { flexDirection: "row", justifyContent: "space-between" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg, marginTop: spacing.xs,
  },
});
