import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border, wasteColors, wasteLabels } from "@/src/theme";

export default function CustomerRecolhas() {
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get<any[]>("/containers").then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.flex}>
      <ScreenHeader title="RECOLHAS" subtitle="HORÁRIOS E HISTÓRICO" />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem dados de recolha" icon="time-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((c) => (
            <View key={c.id} style={styles.card} testID={`customer-schedule-${c.id}`}>
              <View style={styles.head}>
                <View style={[styles.dot, { backgroundColor: wasteColors[c.waste_type] }]} />
                <Txt variant="monoBold" style={{ flex: 1 }}>{c.qr_code}</Txt>
              </View>
              <Txt variant="label">{wasteLabels[c.waste_type]} · {(c.schedule_days || []).join(", ")}</Txt>
              <View style={styles.times}>
                <View><Txt variant="label">ÚLTIMA</Txt><Txt variant="mono">{c.last_collection ? c.last_collection.slice(0, 10) : "—"}</Txt></View>
                <View><Txt variant="label">PRÓXIMA</Txt><Txt variant="mono">{c.next_collection || "—"}</Txt></View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 14, height: 14 },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
