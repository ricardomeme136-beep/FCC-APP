import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border, taskStatus, wasteLabels } from "@/src/theme";

const TODAY = new Date().toISOString().slice(0, 10);

export default function DriverRecolhas() {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get<any[]>(`/collection-tasks?mine=true&date=${TODAY}`).then(setTasks); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.flex}>
      <ScreenHeader title="RECOLHAS DE HOJE" subtitle={tasks ? `${tasks.length} TAREFAS` : ""} />
      {!tasks ? <Loading /> : tasks.length === 0 ? <Empty text="Sem recolhas atribuídas hoje" icon="list-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {tasks.map((t) => {
            const st = taskStatus[t.status] || taskStatus.scheduled;
            return (
              <View key={t.id} style={styles.row} testID={`task-row-${t.id}`}>
                <View style={styles.seq}><Txt variant="monoBold" color="#fff">{t.sequence}</Txt></View>
                <View style={{ flex: 1 }}>
                  <Txt variant="mono" numberOfLines={1}>{t.address || "Sem morada"}</Txt>
                  <Txt variant="label">{wasteLabels[t.waste_type] || t.waste_type}</Txt>
                </View>
                <View style={[styles.st, { backgroundColor: st.color }]}><Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt></View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing["2xl"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.sm },
  seq: { width: 34, height: 34, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center" },
  st: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
});
