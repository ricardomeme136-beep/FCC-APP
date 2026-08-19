import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, border } from "@/src/theme";

// Screens that exist but aren't Tabs.Screen entries — still worth a
// permanent shortcut on desktop instead of only being reachable via "Mais".
const SHORTCUTS: { label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
  { label: "Motoristas", icon: "people", href: "/motoristas" },
  { label: "Viaturas", icon: "bus", href: "/viaturas" },
  { label: "Ocorrências", icon: "warning", href: "/ocorrencias" },
  { label: "Estatísticas", icon: "stats-chart", href: "/estatisticas" },
];

const WIDTH_EXPANDED = 208;
const WIDTH_COLLAPSED = 64;

export default function Sidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const width = collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED;

  return (
    <View style={[styles.wrap, { width, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.logoRow}>
        <Image source={require("@/assets/images/fcc-logo.png")} style={styles.logo} contentFit="contain" />
      </View>

      <View style={styles.items}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = (options.title ?? route.name) as string;
          const focused = state.index === index;
          const icon = options.tabBarIcon;
          return (
            <Pressable
              key={route.key}
              testID={`sidebar-${route.name}`}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={[styles.item, focused ? styles.itemActive : null]}
            >
              {icon ? icon({ focused, color: focused ? colors.fccBlue : colors.muted, size: 18 }) : null}
              {!collapsed && <Txt variant="monoBold" style={{ fontSize: 12 }} color={focused ? colors.fccBlue : colors.onSurfaceSecondary}>{label}</Txt>}
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        {SHORTCUTS.map((it) => {
          const focused = pathname === it.href;
          return (
            <Pressable
              key={it.href}
              testID={`sidebar-shortcut-${it.label}`}
              onPress={() => router.push(it.href as any)}
              style={[styles.item, focused ? styles.itemActive : null]}
            >
              <Ionicons name={it.icon} size={18} color={focused ? colors.fccBlue : colors.muted} />
              {!collapsed && <Txt variant="monoBold" style={{ fontSize: 12 }} color={focused ? colors.fccBlue : colors.onSurfaceSecondary}>{it.label}</Txt>}
            </Pressable>
          );
        })}
      </View>

      <Pressable testID="sidebar-collapse-toggle" onPress={() => setCollapsed((c) => !c)} style={styles.collapseBtn}>
        <Ionicons name={collapsed ? "chevron-forward" : "chevron-back"} size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: "100%", backgroundColor: colors.surface, borderRightWidth: border.width, borderRightColor: colors.divider,
    paddingHorizontal: spacing.sm, gap: spacing.md,
  },
  logoRow: { alignItems: "center", paddingBottom: spacing.md, borderBottomWidth: border.width, borderBottomColor: colors.divider, marginBottom: spacing.xs },
  logo: { width: 48, height: 48, borderRadius: radius.sm },
  items: { gap: 2, flex: 1 },
  item: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, height: 38,
    borderRadius: radius.sm, borderLeftWidth: 3, borderLeftColor: "transparent",
  },
  itemActive: { backgroundColor: colors.fccBlueSoft, borderLeftColor: colors.fccBlue },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  collapseBtn: { alignSelf: "center", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
});
