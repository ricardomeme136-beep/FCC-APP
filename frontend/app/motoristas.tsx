import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Badge, Txt } from "@/src/components/ui";
import { colors, spacing, border } from "@/src/theme";

export default function Motoristas() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api.get<any[]>("/drivers").then(setItems); }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="MOTORISTAS" subtitle="EQUIPA" back />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem motoristas" icon="people-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((d) => (
            <View key={d.id} style={styles.card} testID={`driver-row-${d.id}`}>
              <View style={styles.head}>
                <View style={styles.avatar}><Txt variant="title" color="#fff">{d.name[0]}</Txt></View>
                <View style={{ flex: 1 }}>
                  <Txt variant="title">{d.name}</Txt>
                  <Txt variant="mono" color={colors.muted}>{d.phone}</Txt>
                </View>
                <Badge label={d.status === "assigned" ? "ATRIBUÍDO" : "DISPONÍVEL"} color={d.status === "assigned" ? colors.brand : colors.success} />
              </View>
              <Txt variant="label">CARTA {d.license_type} · {d.license_number}</Txt>
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
  card: { borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 44, height: 44, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center" },
});
