import { useCallback, useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, wasteColors, wasteLabels } from "@/src/theme";

const FAIL_REASONS = [
  "Acesso bloqueado", "Contentor desaparecido", "Contentor danificado",
  "Estrada bloqueada", "Localização insegura", "Contentor cheio",
  "Contentor errado", "Avaria do veículo", "Problema com o cliente", "Outro",
];

const TODAY = new Date().toISOString().slice(0, 10);

export default function DriverRota() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [route, setRoute] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [failOpen, setFailOpen] = useState(false);

  const load = useCallback(async () => {
    const t = await api.get<any[]>(`/collection-tasks?mine=true&date=${TODAY}`);
    setTasks(t);
    const rid = t[0]?.route_id;
    if (rid) {
      try { setRoute(await api.get<any>(`/routes/${rid}`)); } catch {}
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const next = useMemo(
    () => (tasks || []).find((t) => ["scheduled", "en_route", "arrived"].includes(t.status)),
    [tasks]
  );
  const done = (tasks || []).filter((t) => t.status === "collected").length;
  const remaining = (tasks || []).filter((t) => ["scheduled", "en_route", "arrived"].includes(t.status)).length;

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg, "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); } finally { setBusy(false); }
  };

  const collect = () => next && act(() => api.post(`/collection-tasks/${next.id}/complete`, {}), "Recolha registada");
  const ignore = () => next && act(() => api.post(`/collection-tasks/${next.id}/ignore`), "Recolha ignorada");
  const fail = (reason: string) => {
    setFailOpen(false);
    if (next) act(() => api.post(`/collection-tasks/${next.id}/fail`, { reason }), "Problema comunicado");
  };
  const navigate = () => {
    if (!next) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`;
    Linking.openURL(url).catch(() => toast("Não foi possível abrir a navegação", "error"));
  };

  if (!tasks) {
    return (<View style={styles.flex}><ScreenHeader title="A MINHA ROTA DE HOJE" subtitle="MOTORISTA" dark /><Loading text="A SINCRONIZAR ROTA..." /></View>);
  }

  if (!next) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="A MINHA ROTA DE HOJE" subtitle="MOTORISTA" dark />
        <View style={styles.done}>
          <Ionicons name="checkmark-done-circle" size={72} color={colors.success} />
          <Txt variant="display" style={{ textAlign: "center" }}>O SEU TURNO TERMINOU</Txt>
          <Txt variant="mono" color={colors.muted}>{done} recolhas concluídas hoje.</Txt>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="A MINHA ROTA DE HOJE" subtitle={route?.code || "MOTORISTA"} dark />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        {route && (
          <View style={styles.summary}>
            <Txt variant="display" color={colors.brand}>{route.code}</Txt>
            <View style={styles.summaryRow}>
              <SumCell label="RECOLHAS" value={route.num_stops} />
              <SumCell label="DISTÂNCIA" value={`${route.distance_km}km`} />
              <SumCell label="ESTIMADO" value={`${Math.floor(route.duration_min / 60)}h${Math.round(route.duration_min % 60)}`} />
            </View>
            <Txt variant="monoBold" color={colors.brand}>{done} concluídas · {remaining} restantes</Txt>
          </View>
        )}

        <Txt variant="label">PRÓXIMA RECOLHA</Txt>
        <View style={styles.nextCard}>
          <View style={styles.nextHead}>
            <View style={[styles.wasteBadge, { backgroundColor: wasteColors[next.waste_type] }]}>
              <Txt variant="monoBold" color="#fff" style={{ fontSize: 10 }}>#{next.sequence}</Txt>
            </View>
            <Txt variant="mono" color={colors.muted}>{wasteLabels[next.waste_type] || next.waste_type}</Txt>
          </View>
          <Txt variant="displaySm" numberOfLines={2}>{next.address || "Sem morada"}</Txt>
        </View>

        <View style={styles.grid}>
          <BigBtn testID="btn-navegar" title="NAVEGAR" icon="navigate" bg={colors.brand} fg={colors.onBrand} onPress={navigate} disabled={busy} />
          <BigBtn testID="btn-recolhido" title="RECOLHIDO" icon="checkmark" bg={colors.success} fg="#fff" onPress={collect} disabled={busy} />
          <BigBtn testID="btn-problema" title="PROBLEMA" icon="warning" bg={colors.error} fg="#fff" onPress={() => setFailOpen(true)} disabled={busy} />
          <BigBtn testID="btn-ignorar" title="IGNORAR" icon="play-skip-forward" bg={colors.surfaceSecondary} fg={colors.onSurface} onPress={ignore} disabled={busy} />
        </View>
      </ScrollView>

      <Modal visible={failOpen} transparent animationType="slide" onRequestClose={() => setFailOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFailOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">MOTIVO DO PROBLEMA</Txt>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              {FAIL_REASONS.map((r) => (
                <Pressable key={r} testID={`fail-${r}`} style={styles.reason} onPress={() => fail(r)}>
                  <Txt variant="monoBold">{r}</Txt>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SumCell({ label, value }: { label: string; value: any }) {
  return (<View><Txt variant="monoBold" color="#FFFFFF" style={{ fontSize: 18 }}>{value}</Txt><Txt variant="label" color="#A1A1AA">{label}</Txt></View>);
}

function BigBtn({ title, icon, bg, fg, onPress, disabled, testID }: any) {
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.big, { backgroundColor: bg, opacity: disabled ? 0.6 : pressed ? 0.85 : 1 }]}>
      <Ionicons name={icon} size={34} color={fg} />
      <Txt variant="monoBold" color={fg} style={{ fontSize: 16, marginTop: spacing.xs }}>{title}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  summary: { backgroundColor: colors.onSurface, borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.sm },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  nextCard: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  nextHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wasteBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  big: { width: "47%", flexGrow: 1, height: 110, borderWidth: border.width, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  done: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg },
  reason: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md },
});
