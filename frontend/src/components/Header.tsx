import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/src/theme";
import { Txt } from "@/src/components/ui";

type Props = {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  dark?: boolean;
};

export function ScreenHeader({ title, subtitle, back, right, dark }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bg = dark ? colors.onSurface : colors.surface;
  const fg = dark ? "#fff" : colors.onSurface;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm, backgroundColor: bg }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {back ? (
            <Pressable testID="header-back" onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: dark ? "#ffffff22" : colors.surfaceSecondary }]} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color={fg} />
            </Pressable>
          ) : null}
          <View style={{ flexShrink: 1 }}>
            {subtitle ? <Txt variant="label" color={dark ? "#9CA3AF" : colors.muted}>{subtitle}</Txt> : null}
            <Txt variant="display" color={fg} style={styles.title} numberOfLines={1}>{title}</Txt>
          </View>
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  left: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  backBtn: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginLeft: -4 },
  title: { fontSize: 24 },
});
