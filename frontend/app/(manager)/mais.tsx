import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Txt } from "@/src/components/ui";
import { colors, spacing, border, roleLabels } from "@/src/theme";

const ITEMS: { label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { label: "Viaturas", icon: "bus", route: "/viaturas" },
  { label: "Motoristas", icon: "people", route: "/motoristas" },
  { label: "Clientes", icon: "briefcase", route: "/clientes" },
  { label: "Depósitos", icon: "business", route: "/depositos" },
  { label: "Centros", icon: "leaf", route: "/centros" },
  { label: "Ocorrências", icon: "warning", route: "/ocorrencias" },
  { label: "Estatísticas", icon: "stats-chart", route: "/estatisticas" },
  { label: "Assistente IA", icon: "sparkles", route: "/assistente" },
  { label: "Definições", icon: "settings", route: "/definicoes" },
];

export default function Mais() {
  const router = useRouter();
  const { user, logout } = useAuth();
  return (
    <View style={styles.flex}>
      <ScreenHeader title="MAIS" subtitle="MENU PRINCIPAL" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Txt variant="display" color={colors.onBrand}>{(user?.name || "?")[0]}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="title" numberOfLines={1}>{user?.name}</Txt>
            <Txt variant="label">{roleLabels[user?.role || ""] || user?.role}</Txt>
            <Txt variant="mono" color={colors.muted} numberOfLines={1}>{user?.company?.name}</Txt>
          </View>
        </View>

        <View style={styles.grid}>
          {ITEMS.map((it) => (
            <Pressable key={it.route} testID={`menu-${it.label}`} style={styles.tile} onPress={() => router.push(it.route as any)}>
              <Ionicons name={it.icon} size={26} color={colors.onSurface} />
              <Txt variant="monoBold" style={{ fontSize: 12, marginTop: spacing.sm }}>{it.label}</Txt>
            </Pressable>
          ))}
        </View>

        <Btn testID="logout-full-button" title="TERMINAR SESSÃO" variant="dark" icon="log-out-outline" onPress={logout} style={{ marginTop: spacing.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["2xl"] },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  avatar: { width: 56, height: 56, backgroundColor: colors.brand, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    width: "31%", aspectRatio: 1, borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, padding: spacing.sm,
  },
});
