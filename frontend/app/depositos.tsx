import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border } from "@/src/theme";

export default function Depositos() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api.get<any[]>("/depots").then(setItems); }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="DEPÓSITOS" subtitle="BASES OPERACIONAIS" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem depósitos" icon="business-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((d) => (
            <View key={d.id} style={styles.card} testID={`depot-row-${d.id}`}>
              <Txt variant="title">{d.name}</Txt>
              <Txt variant="mono" color={colors.muted}>{d.address}</Txt>
              <View style={styles.metaRow}>
                <Txt variant="label">HORÁRIO {d.hours}</Txt>
                <Txt variant="label">CAP {d.capacity}</Txt>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
});
