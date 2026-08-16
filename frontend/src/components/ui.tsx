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
import { colors, fonts, spacing, border } from "@/src/theme";

// ---------- Text ----------
type TxtProps = TextProps & {
  variant?: "display" | "displaySm" | "title" | "mono" | "monoBold" | "label" | "body";
  color?: string;
};
export function Txt({ variant = "body", color, style, ...rest }: TxtProps) {
  return <Text {...rest} style={[styles.txtBase, txtVariants[variant], color ? { color } : null, style]} />;
}

// ---------- Badge ----------
export function Badge({ label, color = colors.info, filled = true, testID }:
  { label: string; color?: string; filled?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={[styles.badge, filled ? { backgroundColor: color } : { borderColor: color, borderWidth: 2, backgroundColor: "transparent" }]}>
      <Text style={[styles.badgeTxt, { color: filled ? "#fff" : color }]}>{label}</Text>
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
const btnBg: Record<string, { bg: string; fg: string }> = {
  primary: { bg: colors.brand, fg: colors.onBrand },
  dark: { bg: colors.onSurface, fg: colors.onSurfaceInverse },
  success: { bg: colors.success, fg: "#fff" },
  error: { bg: colors.error, fg: "#fff" },
  warning: { bg: colors.warning, fg: colors.onWarning },
  outline: { bg: colors.surface, fg: colors.onSurface },
};
export function Btn({ title, variant = "primary", icon, size = "md", loading, style, disabled, ...rest }: BtnProps) {
  const c = btnBg[variant];
  const h = size === "xl" ? 72 : size === "lg" ? 56 : 48;
  const fontSize = size === "xl" ? 20 : size === "lg" ? 17 : 15;
  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: c.bg, height: h, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "outline" ? { borderWidth: border.width, borderColor: colors.borderStrong } : null,
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
export function StatCard({ label, value, accent, testID }:
  { label: string; value: string | number; accent?: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.stat}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ---------- Loading / Empty ----------
export function Loading({ text = "A CARREGAR DADOS..." }: { text?: string }) {
  return (
    <View style={styles.center} testID="loading-view">
      <ActivityIndicator color={colors.onSurface} size="large" />
      <Text style={styles.centerTxt}>{text}</Text>
    </View>
  );
}
export function Empty({ text, icon = "cube-outline" }: { text: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.center} testID="empty-view">
      <Ionicons name={icon} size={48} color={colors.muted} />
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
          <View key={t.id} style={[styles.toast, {
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
  display: { fontFamily: fonts.display, fontSize: 30, color: colors.onSurface, letterSpacing: -0.5 },
  displaySm: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface, letterSpacing: -0.3 },
  title: { fontFamily: fonts.displayMedium, fontSize: 16, color: colors.onSurface },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurfaceSecondary },
  monoBold: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.onSurface },
  label: { fontFamily: fonts.monoMedium, fontSize: 11, color: colors.muted, letterSpacing: 1, textTransform: "uppercase" },
  body: { fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface },
};

const styles = StyleSheet.create({
  txtBase: {},
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeTxt: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderWidth: border.width, borderColor: colors.borderStrong, padding: spacing.lg },
  btn: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnTxt: { fontFamily: fonts.monoBold, letterSpacing: 0.5 },
  stat: { flex: 1, padding: spacing.md, backgroundColor: colors.surface, borderWidth: border.width, borderColor: colors.borderStrong },
  statValue: { fontFamily: fonts.display, fontSize: 30, color: colors.onSurface, letterSpacing: -0.5 },
  statLabel: { fontFamily: fonts.monoMedium, fontSize: 10, color: colors.muted, letterSpacing: 0.8, marginTop: 2, textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  centerTxt: { fontFamily: fonts.monoMedium, fontSize: 13, color: colors.muted, letterSpacing: 1, textAlign: "center" },
  toastWrap: { position: "absolute", bottom: 100, left: 16, right: 16, gap: 8, alignItems: "center" },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderWidth: 2, borderColor: colors.borderStrong, maxWidth: "100%" },
  toastTxt: { fontFamily: fonts.monoBold, fontSize: 13, color: "#fff" },
});
