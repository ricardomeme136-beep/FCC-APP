import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border } from "@/src/theme";

export default function Clientes() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api.get<any[]>("/customers").then(setItems).catch(() => setItems([])); }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="CLIENTES" subtitle="CARTEIRA" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem clientes" icon="briefcase-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((c) => (
            <View key={c.id} style={styles.card} testID={`customer-row-${c.id}`}>
              <Txt variant="title">{c.name}</Txt>
              <Txt variant="mono" color={colors.muted}>{c.email}</Txt>
              <Txt variant="mono" color={colors.muted}>{c.phone} · {c.address}</Txt>
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
});
