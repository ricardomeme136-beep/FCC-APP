import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Badge, Txt } from "@/src/components/ui";
import { colors, spacing, border, wasteLabels } from "@/src/theme";

const KIND: Record<string, string> = {
  landfill: "ATERRO", recycling: "RECICLAGEM", treatment: "TRATAMENTO", transfer: "TRANSFERÊNCIA",
};

export default function Centros() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api.get<any[]>("/facilities").then(setItems); }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="CENTROS DE TRATAMENTO" subtitle="ATERROS · RECICLAGEM" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem centros" icon="leaf-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((f) => (
            <View key={f.id} style={styles.card} testID={`facility-row-${f.id}`}>
              <View style={styles.head}>
                <Txt variant="title" style={{ flex: 1 }}>{f.name}</Txt>
                <Badge label={KIND[f.kind] || f.kind} color={colors.success} />
              </View>
              <Txt variant="mono" color={colors.muted}>{f.address}</Txt>
              <Txt variant="label">ACEITA: {(f.accepted_waste_types || []).map((w: string) => wasteLabels[w] || w).join(", ")}</Txt>
              <Txt variant="label">HORÁRIO {f.hours}</Txt>
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
});
