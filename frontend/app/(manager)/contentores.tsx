import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Txt } from "@/src/components/ui";
import { colors, spacing, border, wasteColors, wasteLabels } from "@/src/theme";

const CHIPS = [
  { key: "", label: "TODOS" },
  { key: "general", label: "INDIFERENCIADOS" },
  { key: "paper", label: "PAPEL" },
  { key: "plastic", label: "PLÁSTICO" },
  { key: "glass", label: "VIDRO" },
  { key: "organic", label: "ORGÂNICOS" },
  { key: "food", label: "ALIMENTARES" },
  { key: "commercial", label: "COMERCIAIS" },
];

export default function Contentores() {
  const router = useRouter();
  const [all, setAll] = useState<any[] | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const c = await api.get<any[]>("/containers?limit=1000");
    setAll(c);
  }, []);

  useEffect(() => { load(); }, [load]);

  const data = all ? (filter ? all.filter((c) => c.waste_type === filter) : all) : [];

  return (
    <View style={styles.flex}>
      <ScreenHeader title="CONTENTORES" subtitle={all ? `${all.length} REGISTADOS` : "A CARREGAR"} />
      <View style={styles.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CHIPS.map((c) => {
            const on = filter === c.key;
            return (
              <Pressable key={c.key || "all"} testID={`filter-${c.key || "all"}`} onPress={() => setFilter(c.key)} style={[styles.chip, on ? styles.chipOn : null]}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{c.label}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!all ? (
        <Loading />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          renderItem={({ item }) => (
            <Pressable testID={`container-${item.id}`} onPress={() => router.push(`/container/${item.id}` as any)}>
              <View style={styles.row}>
                <View style={[styles.wasteBar, { backgroundColor: wasteColors[item.waste_type] || colors.info }]} />
                <View style={{ flex: 1 }}>
                  <Txt variant="monoBold">{item.qr_code}</Txt>
                  <Txt variant="mono" color={colors.muted} numberOfLines={1}>{item.address}</Txt>
                  <Txt variant="label" style={{ marginTop: 2 }}>
                    {wasteLabels[item.waste_type]} · {item.container_type} · {item.capacity_kg}kg
                  </Txt>
                </View>
                <View style={[styles.statusDot, { backgroundColor: item.status === "active" ? colors.success : colors.muted }]} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  chipWrap: { borderBottomWidth: border.width, borderBottomColor: colors.borderStrong },
  chipRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, justifyContent: "center", flexShrink: 0, paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.onSurface },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  wasteBar: { width: 6, alignSelf: "stretch" },
  statusDot: { width: 12, height: 12 },
});
