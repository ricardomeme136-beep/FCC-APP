import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Empty, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, fonts, spacing, border, incidentStatus, incidentKindLabels } from "@/src/theme";

const KINDS = [
  { key: "container_full", label: "Contentor cheio" },
  { key: "container_damaged", label: "Contentor danificado" },
  { key: "failed_collection", label: "Recolha não efetuada" },
  { key: "new_container", label: "Pedido de novo contentor" },
  { key: "other", label: "Outro problema" },
];

export default function CustomerOcorrencias() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("container_full");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.get<any[]>("/incidents").then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/incidents", { kind, description: desc, priority: "medium" });
      toast("Ocorrência comunicada", "success");
      setOpen(false); setDesc(""); setKind("container_full");
      await load();
    } catch (e: any) { toast(e?.message || "Erro", "error"); } finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="OCORRÊNCIAS" subtitle="COMUNICAR PROBLEMAS" />
      {!items ? <Loading /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Btn testID="report-button" title="COMUNICAR PROBLEMA" icon="add" onPress={() => setOpen(true)} />
          {items.length === 0 ? <Empty text="Sem ocorrências comunicadas" icon="checkmark-circle-outline" /> : items.map((i) => {
            const st = incidentStatus[i.status] || incidentStatus.open;
            return (
              <View key={i.id} style={styles.card} testID={`customer-incident-${i.id}`}>
                <View style={styles.head}>
                  <Txt variant="monoBold" style={{ flex: 1 }}>{incidentKindLabels[i.kind] || i.kind}</Txt>
                  <View style={[styles.st, { backgroundColor: st.color }]}><Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt></View>
                </View>
                <Txt variant="mono" color={colors.muted} numberOfLines={2}>{i.description}</Txt>
                <Txt variant="label">{i.created_at?.slice(0, 10)}</Txt>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">COMUNICAR PROBLEMA</Txt>
            <Txt variant="label" style={{ marginTop: spacing.md }}>TIPO</Txt>
            <View style={styles.kinds}>
              {KINDS.map((k) => (
                <Pressable key={k.key} testID={`kind-${k.key}`} style={[styles.kind, kind === k.key ? styles.kindOn : null]} onPress={() => setKind(k.key)}>
                  <Txt variant="monoBold" style={{ fontSize: 12 }} color={kind === k.key ? colors.onSurfaceInverse : colors.onSurface}>{k.label}</Txt>
                </Pressable>
              ))}
            </View>
            <Txt variant="label" style={{ marginTop: spacing.md }}>DESCRIÇÃO</Txt>
            <TextInput
              testID="report-desc"
              style={styles.input}
              value={desc}
              onChangeText={setDesc}
              multiline
              placeholder="Descreva o problema..."
              placeholderTextColor={colors.muted}
            />
            <Btn testID="submit-report" title="ENVIAR" loading={busy} onPress={submit} style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  st: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg },
  kinds: { gap: spacing.sm, marginTop: spacing.sm },
  kind: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  kindOn: { backgroundColor: colors.onSurface },
  input: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md, minHeight: 90, fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface, textAlignVertical: "top", marginTop: spacing.sm },
});
