import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Badge, Btn, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, incidentStatus, incidentKindLabels } from "@/src/theme";

const NEXT: Record<string, { status: string; label: string; variant: any }[]> = {
  open: [{ status: "assigned", label: "ATRIBUIR", variant: "primary" }],
  assigned: [{ status: "in_progress", label: "EM TRATAMENTO", variant: "primary" }],
  in_progress: [{ status: "resolved", label: "RESOLVER", variant: "success" }],
  resolved: [{ status: "closed", label: "FECHAR", variant: "dark" }],
};

export default function IncidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [inc, setInc] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setInc(await api.get<any>(`/incidents/${id}`)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!inc) return (<View style={styles.flex}><ScreenHeader title="OCORRÊNCIA" back /><Loading /></View>);
  const st = incidentStatus[inc.status] || incidentStatus.open;

  const move = async (status: string) => {
    setBusy(true);
    try { await api.patch(`/incidents/${id}`, { status }); toast("Estado atualizado", "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); } finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="OCORRÊNCIA" subtitle={st.label} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.head}>
            <Txt variant="displaySm" style={{ flex: 1 }}>{incidentKindLabels[inc.kind] || inc.kind}</Txt>
            <Badge label={st.label} color={st.color} />
          </View>
          <Badge label={`PRIORIDADE ${(inc.priority || "").toUpperCase()}`} color={inc.priority === "high" ? colors.error : inc.priority === "medium" ? colors.warning : colors.muted} />
          <Txt variant="mono">{inc.description || "Sem descrição."}</Txt>
          <Txt variant="label">CRIADA {inc.created_at?.slice(0, 16).replace("T", " ")}</Txt>
          {inc.resolved_at ? <Txt variant="label">RESOLVIDA {inc.resolved_at.slice(0, 16).replace("T", " ")}</Txt> : null}
        </View>

        {(NEXT[inc.status] || []).map((a) => (
          <Btn key={a.status} testID={`incident-action-${a.status}`} title={a.label} variant={a.variant} loading={busy} onPress={() => move(a.status)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
