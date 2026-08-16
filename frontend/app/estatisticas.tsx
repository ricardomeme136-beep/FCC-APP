import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Card, Loading, StatCard, Txt } from "@/src/components/ui";
import { colors, spacing, wasteColors, wasteLabels } from "@/src/theme";

export default function Estatisticas() {
  const [stats, setStats] = useState<any | null>(null);
  useEffect(() => { api.get<any>("/analytics/stats").then(setStats); }, []);
  if (!stats) return (<View style={styles.flex}><ScreenHeader title="ESTATÍSTICAS" subtitle="ANÁLISE" back /><Loading /></View>);

  const t = stats.totals;
  const maxWaste = Math.max(1, ...Object.values(stats.waste_breakdown as Record<string, number>));
  return (
    <View style={styles.flex}>
      <ScreenHeader title="ESTATÍSTICAS" subtitle="ANÁLISE OPERACIONAL" back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.grid}><StatCard label="Recolhas Totais" value={t.total} /><StatCard label="Concluídas" value={t.completed} accent={colors.success} /></View>
        <View style={styles.grid}><StatCard label="Falhadas" value={t.failed} accent={colors.error} /><StatCard label="Taxa Conclusão" value={`${t.completion_rate}%`} accent={colors.brand} /></View>
        <View style={styles.grid}><StatCard label="Distância" value={`${t.distance_km} km`} /><StatCard label="Resíduos" value={`${(t.weight_kg / 1000).toFixed(1)} t`} /></View>
        <View style={styles.grid}><StatCard label="Combustível" value={`${t.fuel_l} L`} /><StatCard label="CO₂ Estimado" value={`${(t.co2_kg / 1000).toFixed(1)} t`} /></View>
        <View style={styles.grid}><StatCard label="Custo Total" value={`${t.cost_eur}€`} /><StatCard label="Custo / Recolha" value={`${t.cost_per_collection}€`} /></View>

        <Card style={{ gap: spacing.md }}>
          <Txt variant="label">RESÍDUOS POR TIPO (kg)</Txt>
          {Object.entries(stats.waste_breakdown as Record<string, number>).map(([k, v]) => (
            <View key={k} style={{ gap: 4 }}>
              <View style={styles.barHead}>
                <Txt variant="mono">{wasteLabels[k] || k}</Txt>
                <Txt variant="monoBold">{Math.round(v)}</Txt>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${(v / maxWaste) * 100}%`, backgroundColor: wasteColors[k] || colors.info }]} />
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Txt variant="label">DESEMPENHO DOS MOTORISTAS</Txt>
          {stats.drivers.map((d: any, i: number) => (
            <View key={d.id} style={styles.driverRow}>
              <Txt variant="monoBold" style={{ width: 22 }}>{i + 1}</Txt>
              <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>{d.name}</Txt>
              <Txt variant="mono" color={colors.muted}>{d.completed}✓ {d.failed}✗</Txt>
              <Txt variant="monoBold" color={colors.success} style={{ width: 54, textAlign: "right" }}>{d.completion_rate}%</Txt>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  grid: { flexDirection: "row", gap: spacing.md },
  barHead: { flexDirection: "row", justifyContent: "space-between" },
  barTrack: { height: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.borderStrong },
  barFill: { height: "100%" },
  driverRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
});
