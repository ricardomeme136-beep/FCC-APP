import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Badge, Btn, Empty, Loading, SearchInput, Txt, useToast } from "@/src/components/ui";
import { agoLabel } from "@/src/utils/time";
import { colors, spacing, border, radius } from "@/src/theme";

type Filter = "active" | "archived" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "active", label: "ATIVAS" },
  { key: "archived", label: "ARQUIVADAS" },
  { key: "all", label: "TODAS" },
];

export default function RouteTemplates() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [templates, setTemplates] = useState<any[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [menuFor, setMenuFor] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await api.get<any[]>("/route-templates");
    setTemplates(t);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => {
    if (!templates) return [];
    return templates
      .filter((t) => filter === "all" || (filter === "active" ? t.active : !t.active))
      .filter((t) => !search || t.name?.toLowerCase().includes(search.toLowerCase()));
  }, [templates, filter, search]);

  const createTemplate = async () => {
    if (!newName.trim()) { toast("Indique um nome", "error"); return; }
    setCreating(true);
    try {
      const t = await api.post<any>("/route-templates", { name: newName.trim(), description: newDesc, stops: [] });
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      router.push(`/template/${t.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Erro ao criar rota", "error");
    } finally {
      setCreating(false);
    }
  };

  const duplicate = async (t: any) => {
    setMenuFor(null);
    setBusy(true);
    try {
      const dup = await api.post<any>(`/route-templates/${t.id}/duplicate`, {});
      toast("Rota duplicada", "success");
      await load();
      router.push(`/template/${dup.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Erro ao duplicar", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (t: any) => {
    setMenuFor(null);
    setBusy(true);
    try {
      await api.patch(`/route-templates/${t.id}`, { active: !t.active });
      toast(t.active ? "Rota arquivada" : "Rota reativada", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!templates) {
    return (<View style={styles.flex}><ScreenHeader title="ROTAS" subtitle="BIBLIOTECA DE ROTAS" /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="ROTAS" subtitle="BIBLIOTECA DE ROTAS REUTILIZÁVEIS" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <SearchInput testID="search-templates" value={search} onChangeText={setSearch} placeholder="Pesquisar rota..." />
          <Btn testID="new-template-button" title="+ NOVA ROTA" icon="add" size="sm" onPress={() => setCreateOpen(true)} />
        </View>

        <View style={styles.chipRow}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} testID={`template-filter-${f.key}`} onPress={() => setFilter(f.key)}
              style={[styles.chip, filter === f.key ? styles.chipOn : null]}>
              <Txt variant="monoBold" style={{ fontSize: 11 }} color={filter === f.key ? colors.onSurfaceInverse : colors.onSurface}>{f.label}</Txt>
            </Pressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <Empty text="Nenhuma rota reutilizável ainda." icon="git-network-outline" />
        ) : (
          visible.map((t) => {
            const stops = t.stops || [];
            const totalContainers = stops.reduce((n: number, s: any) => n + (s.container_ids || []).length, 0);
            return (
              <Pressable key={t.id} testID={`template-${t.id}`} onPress={() => router.push(`/template/${t.id}` as any)} style={styles.card}>
                <View style={styles.cardIcon}>
                  <Ionicons name="git-network" size={18} color={colors.fccBlue} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.cardHead}>
                    <Txt variant="displaySm" numberOfLines={1} style={{ fontSize: 15, flex: 1 }}>{t.name}</Txt>
                    <Badge label={t.active ? "ATIVA" : "ARQUIVADA"} color={t.active ? colors.success : colors.muted} />
                  </View>
                  {t.description ? <Txt variant="mono" color={colors.muted} numberOfLines={1} style={{ fontSize: 12 }}>{t.description}</Txt> : null}
                  <View style={styles.statsRow}>
                    <Stat icon="location" value={`${stops.length} paragens`} />
                    <Stat icon="cube" value={`${totalContainers} contentores`} />
                    <Stat icon="navigate" value={`${t.distance_km || 0} km`} />
                    <Stat icon="time" value={`${Math.round(t.duration_min || 0)} min`} />
                  </View>
                  <Txt variant="label" color={colors.muted} style={{ marginTop: 2 }}>ATUALIZADA {agoLabel(t.updated_at)}</Txt>
                </View>
                <Pressable testID={`template-menu-${t.id}`} onPress={() => setMenuFor(t)} hitSlop={10} style={styles.menuBtn}>
                  <Ionicons name="ellipsis-vertical" size={18} color={colors.muted} />
                </Pressable>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <ActionMenu
        visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}
        items={menuFor ? [
          { label: "Abrir", icon: "open-outline", onPress: () => router.push(`/template/${menuFor.id}` as any) },
          { label: "Duplicar", icon: "copy-outline", disabled: busy, onPress: () => duplicate(menuFor) },
          { label: menuFor.active ? "Arquivar" : "Reativar", icon: "archive-outline", disabled: busy, onPress: () => toggleArchive(menuFor) },
        ] : []}
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCreateOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">NOVA ROTA REUTILIZÁVEL</Txt>
            <Txt variant="label" style={{ marginTop: spacing.md }}>NOME</Txt>
            <TextInput testID="new-template-name-input" style={styles.input} value={newName} onChangeText={setNewName}
                      placeholder="Ex: Circuito Lustosa - Segunda" placeholderTextColor={colors.muted} autoFocus />
            <Txt variant="label" style={{ marginTop: spacing.md }}>DESCRIÇÃO (OPCIONAL)</Txt>
            <TextInput testID="new-template-description-input" style={[styles.input, { height: 70 }]} value={newDesc} onChangeText={setNewDesc}
                      placeholder="Descrição" placeholderTextColor={colors.muted} multiline />
            <Txt variant="mono" color={colors.muted} style={{ marginTop: spacing.sm, fontSize: 12 }}>
              Paragens e depósito definem-se a seguir, no editor da rota.
            </Txt>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Btn testID="cancel-new-template" title="CANCELAR" variant="outline" style={{ flex: 1 }} onPress={() => setCreateOpen(false)} />
              <Btn testID="confirm-new-template" title="CRIAR E EDITAR" style={{ flex: 1 }} loading={creating} onPress={createTemplate} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={11} color={colors.muted} />
      <Txt variant="label" style={{ fontSize: 10 }}>{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  topRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  chipRow: { flexDirection: "row", gap: spacing.sm },
  chip: {
    height: 30, justifyContent: "center", paddingHorizontal: spacing.md,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.fccBlue, borderColor: colors.fccBlue },
  card: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: border.width,
    borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.fccBlueSoft,
    alignItems: "center", justifyContent: "center",
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: 4 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  menuBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg, marginTop: spacing.xs,
  },
});
