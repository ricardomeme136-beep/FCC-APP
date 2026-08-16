import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Loading, Empty, Txt } from "@/src/components/ui";
import { colors, spacing, border, wasteColors, wasteLabels } from "@/src/theme";

export default function CustomerContentores() {
  const router = useRouter();
  const { logout } = useAuth();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get<any[]>("/containers").then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="OS MEUS CONTENTORES"
        subtitle="PORTAL DO CLIENTE"
        right={<Pressable testID="customer-logout" onPress={logout} hitSlop={10}><Ionicons name="log-out-outline" size={22} color={colors.onSurface} /></Pressable>}
      />
      {!items ? <Loading /> : items.length === 0 ? <Empty text="Sem contentores associados" icon="cube-outline" /> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((c) => (
            <Pressable key={c.id} testID={`customer-container-${c.id}`} onPress={() => router.push(`/container/${c.id}` as any)}>
              <View style={styles.row}>
                <View style={[styles.bar, { backgroundColor: wasteColors[c.waste_type] }]} />
                <View style={{ flex: 1 }}>
                  <Txt variant="monoBold">{c.qr_code}</Txt>
                  <Txt variant="mono" color={colors.muted} numberOfLines={1}>{c.address}</Txt>
                  <Txt variant="label">{wasteLabels[c.waste_type]} · {c.frequency}</Txt>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  bar: { width: 6, alignSelf: "stretch" },
});
