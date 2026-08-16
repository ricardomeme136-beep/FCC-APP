import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border, incidentStatus, incidentKindLabels } from "@/src/theme";

export default function Ocorrencias() {
  const router = useRouter();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get<any[]>("/incidents").then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <View style={styles.flex}>
      <ScreenHeader title="OCORRÊNCIAS" subtitle="SISTEMA DE TICKETS" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem ocorrências" icon="checkmark-circle-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((i) => {
            const st = incidentStatus[i.status] || incidentStatus.open;
            const pr = i.priority === "high" ? colors.error : i.priority === "medium" ? colors.warning : colors.muted;
            return (
              <Pressable key={i.id} testID={`incident-row-${i.id}`} onPress={() => router.push(`/incident/${i.id}` as any)}>
                <View style={styles.card}>
                  <View style={[styles.bar, { backgroundColor: pr }]} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="monoBold">{incidentKindLabels[i.kind] || i.kind}</Txt>
                    <Txt variant="mono" color={colors.muted} numberOfLines={2}>{i.description}</Txt>
                  </View>
                  <View style={[styles.st, { backgroundColor: st.color }]}>
                    <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  bar: { width: 6, alignSelf: "stretch" },
  st: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
});
