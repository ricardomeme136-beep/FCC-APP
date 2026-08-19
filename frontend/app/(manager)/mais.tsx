import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Txt } from "@/src/components/ui";
import { colors, spacing, border, radius, roleLabels } from "@/src/theme";

type Item = { label: string; icon: keyof typeof Ionicons.glyphMap; route: string };
const CATEGORIES: { title: string; items: Item[] }[] = [
  {
    title: "Gestão",
    items: [
      { label: "Utilizadores", icon: "person-circle", route: "/utilizadores" },
      { label: "Motoristas", icon: "people", route: "/motoristas" },
      { label: "Viaturas", icon: "bus", route: "/viaturas" },
      { label: "Contentores", icon: "cube", route: "/(manager)/contentores" },
    ],
  },
  {
    title: "Operação",
    items: [
      { label: "Rotas", icon: "navigate", route: "/(manager)/rotas" },
      { label: "Trajetos gravados", icon: "recording", route: "/trajetos" },
      { label: "Ocorrências", icon: "warning", route: "/ocorrencias" },
    ],
  },
  {
    title: "Empresa",
    items: [
      { label: "Clientes", icon: "briefcase", route: "/clientes" },
      { label: "Depósitos", icon: "business", route: "/depositos" },
      { label: "Centros de tratamento", icon: "leaf", route: "/centros" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { label: "Estatísticas", icon: "stats-chart", route: "/estatisticas" },
      { label: "Assistente IA", icon: "sparkles", route: "/assistente" },
      { label: "Definições", icon: "settings", route: "/definicoes" },
    ],
  },
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
            <Txt variant="title" color={colors.onBrand}>{(user?.name || "?")[0]}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="title" numberOfLines={1}>{user?.name}</Txt>
            <Txt variant="label">{roleLabels[user?.role || ""] || user?.role}</Txt>
            <Txt variant="mono" color={colors.muted} numberOfLines={1} style={{ fontSize: 12 }}>{user?.company?.name}</Txt>
          </View>
        </View>

        {CATEGORIES.map((cat) => (
          <View key={cat.title} style={styles.category}>
            <Txt variant="label" style={{ paddingHorizontal: spacing.xs }}>{cat.title.toUpperCase()}</Txt>
            <View style={styles.list}>
              {cat.items.map((it, i) => (
                <Pressable
                  key={it.route}
                  testID={`menu-${it.label}`}
                  style={[styles.row, i < cat.items.length - 1 ? styles.rowBorder : null]}
                  onPress={() => router.push(it.route as any)}
                >
                  <Ionicons name={it.icon} size={16} color={colors.onSurfaceSecondary} style={{ width: 20 }} />
                  <Txt variant="mono" style={{ flex: 1, fontSize: 13 }} color={colors.onSurface}>{it.label}</Txt>
                  <Ionicons name="chevron-forward" size={14} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Btn testID="logout-full-button" title="TERMINAR SESSÃO" variant="dark" icon="log-out-outline" onPress={logout} style={{ marginTop: spacing.sm }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["2xl"] },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  avatar: { width: 44, height: 44, backgroundColor: colors.brand, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  category: { gap: spacing.xs },
  list: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, height: 42 },
  rowBorder: { borderBottomWidth: border.width, borderBottomColor: colors.divider },
});
