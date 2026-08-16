import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Badge, Txt } from "@/src/components/ui";
import { colors, spacing, border, vehicleStatus, wasteLabels } from "@/src/theme";

export default function Viaturas() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api.get<any[]>("/vehicles").then(setItems); }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="VIATURAS" subtitle="FROTA" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem viaturas" icon="bus-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((v) => {
            const st = vehicleStatus[v.status] || vehicleStatus.offline;
            return (
              <View key={v.id} style={styles.card} testID={`vehicle-row-${v.id}`}>
                <View style={styles.head}>
                  <Txt variant="displaySm">{v.plate}</Txt>
                  <Badge label={st.label} color={st.color} />
                </View>
                <Txt variant="mono" color={colors.muted}>{v.brand} {v.model} · {v.year}</Txt>
                <View style={styles.metaRow}>
                  <Txt variant="label">CAP {v.capacity_kg}kg</Txt>
                  <Txt variant="label">KM {v.mileage_km?.toLocaleString?.("pt-PT") || "—"}</Txt>
                  <Txt variant="label">COMB {v.fuel_pct ?? "—"}%</Txt>
                </View>
                {v.allowed_waste_types?.length ? (
                  <Txt variant="label">RESÍDUOS: {v.allowed_waste_types.map((w: string) => wasteLabels[w]).join(", ")}</Txt>
                ) : <Txt variant="label">TODOS OS RESÍDUOS</Txt>}
              </View>
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
  card: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
});
