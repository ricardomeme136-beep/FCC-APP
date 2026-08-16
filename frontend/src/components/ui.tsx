import React, { createContext, useCallback, useContext, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewStyle,
  TextStyle,
  PressableProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, spacing, radius, shadows } from "@/src/theme";

// ---------- Text ----------
type TxtProps = TextProps & {
  variant?: "display" | "displaySm" | "title" | "mono" | "monoBold" | "label" | "body";
  color?: string;
};
export function Txt({ variant = "body", color, style, ...rest }: TxtProps) {
  return <Text {...rest} style={[txtVariants[variant], color ? { color } : null, style]} />;
}

// ---------- Badge ----------
export function Badge({ label, color = colors.info, tone = "soft", testID }:
  { label: string; color?: string; tone?: "soft" | "solid"; testID?: string }) {
  const soft = tone === "soft";
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: soft ? colors.surfaceSecondary : color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeTxt, { color: soft ? colors.onSurfaceSecondary : "#fff" }]}>{label}</Text>
    </View>
  );
}

// ---------- Card ----------
export function Card({ children, style, testID }:
  { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

// ---------- Button ----------
type BtnProps = PressableProps & {
  title: string;
  variant?: "primary" | "dark" | "success" | "error" | "warning" | "outline";
  icon?: keyof typeof Ionicons.glyphMap;
  size?: "md" | "lg" | "xl";
  loading?: boolean;
  style?: ViewStyle;
};
const btnBg: Record<string, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.brand, fg: colors.onBrand },
  dark: { bg: colors.onSurface, fg: "#fff" },
  success: { bg: colors.success, fg: "#fff" },
  error: { bg: colors.error, fg: "#fff" },
  warning: { bg: colors.warning, fg: colors.onWarning },
  outline: { bg: colors.surface, fg: colors.onSurface, border: colors.border },
};
export function Btn({ title, variant = "primary", icon, size = "md", loading, style, disabled, ...rest }: BtnProps) {
  const c = btnBg[variant];
  const h = size === "xl" ? 68 : size === "lg" ? 54 : 48;
  const fontSize = size === "xl" ? 18 : size === "lg" ? 16 : 15;
  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant !== "outline" ? shadows.sm : null,
        { backgroundColor: c.bg, height: h, opacity: disabled ? 0.5 : pressed ? 0.9 : 1 },
        c.border ? { borderWidth: 1.5, borderColor: c.border } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={fontSize + 3} color={c.fg} /> : null}
          <Text style={[styles.btnTxt, { color: c.fg, fontSize }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------- Stat card ----------
export function StatCard({ label, value, accent, icon, testID }:
  { label: string; value: string | number; accent?: string; icon?: keyof typeof Ionicons.glyphMap; testID?: string }) {
  return (
    <View testID={testID} style={styles.stat}>
      {icon ? (
        <View style={[styles.statIcon, { backgroundColor: (accent || colors.onSurface) + "18" }]}>
          <Ionicons name={icon} size={16} color={accent || colors.onSurface} />
        </View>
      ) : null}
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ---------- Loading / Empty ----------
export function Loading({ text = "A carregar..." }: { text?: string }) {
  return (
    <View style={styles.center} testID="loading-view">
      <ActivityIndicator color={colors.brand} size="large" />
      <Text style={styles.centerTxt}>{text}</Text>
    </View>
  );
}
export function Empty({ text, icon = "cube-outline" }: { text: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.center} testID="empty-view">
      <View style={styles.emptyIcon}><Ionicons name={icon} size={40} color={colors.muted} /></View>
      <Text style={styles.centerTxt}>{text}</Text>
    </View>
  );
}

// ---------- Toast ----------
type Toast = { id: number; msg: string; kind: "info" | "success" | "error" };
const ToastCtx = createContext<(msg: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <View pointerEvents="none" style={styles.toastWrap}>
        {toasts.map((t) => (
          <View key={t.id} style={[styles.toast, shadows.card, {
            backgroundColor: t.kind === "error" ? colors.error : t.kind === "success" ? colors.success : colors.onSurface,
          }]}>
            <Text style={styles.toastTxt}>{t.msg}</Text>
          </View>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}

const txtVariants: Record<string, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 28, color: colors.onSurface, letterSpacing: -0.5 },
  displaySm: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, letterSpacing: -0.3 },
  title: { fontFamily: fonts.displayMedium, fontSize: 16, color: colors.onSurface },
  mono: { fontFamily: fonts.mono, fontSize: 14, color: colors.onSurfaceSecondary },
  monoBold: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.onSurface },
  label: { fontFamily: fonts.monoMedium, fontSize: 11, color: colors.muted, letterSpacing: 0.6, textTransform: "uppercase" },
  body: { fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface },
};

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeDot: { width: 7, height: 7, borderRadius: radius.pill },
  badgeTxt: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...(shadows.card as object) },
  btn: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnTxt: { fontFamily: fonts.monoBold, letterSpacing: 0.3 },
  stat: { flex: 1, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, gap: 2, ...(shadows.card as object) },
  statIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValue: { fontFamily: fonts.display, fontSize: 28, color: colors.onSurface, letterSpacing: -0.5 },
  statLabel: { fontFamily: fonts.monoMedium, fontSize: 10.5, color: colors.muted, letterSpacing: 0.4, textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyIcon: { width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  centerTxt: { fontFamily: fonts.monoMedium, fontSize: 13, color: colors.muted, textAlign: "center" },
  toastWrap: { position: "absolute", bottom: 100, left: 16, right: 16, gap: 8, alignItems: "center" },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, maxWidth: "100%" },
  toastTxt: { fontFamily: fonts.monoBold, fontSize: 13, color: "#fff" },
});
