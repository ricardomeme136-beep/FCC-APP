import React, { createContext, useCallback, useContext, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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

// Thinner variant for dense lists (Motoristas, Viaturas, Contentores...) —
// same tokens as Card, just less padding and a lighter shadow.
export function CompactCard({ children, style, testID }:
  { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[styles.compactCard, style]}>{children}</View>;
}

// ---------- Button ----------
type BtnProps = PressableProps & {
  title: string;
  variant?: "primary" | "dark" | "success" | "error" | "warning" | "outline";
  icon?: keyof typeof Ionicons.glyphMap;
  size?: "sm" | "md" | "lg" | "xl";
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
  const h = size === "xl" ? 68 : size === "lg" ? 54 : size === "sm" ? 32 : 40;
  const fontSize = size === "xl" ? 18 : size === "lg" ? 16 : size === "sm" ? 12 : 14;
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

// ---------- DashboardStat (compact KPI — painel redesign) ----------
export function DashboardStat({ icon, value, label, tone = "neutral", testID }:
  { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string;
    tone?: "blue" | "green" | "warning" | "error" | "neutral"; testID?: string }) {
  const toneColor = { blue: colors.fccBlue, green: colors.fccGreen, warning: colors.warning, error: colors.error, neutral: colors.onSurfaceSecondary }[tone];
  return (
    <View testID={testID} style={styles.dashStat}>
      <View style={[styles.dashStatIcon, { backgroundColor: toneColor + "18" }]}>
        <Ionicons name={icon} size={15} color={toneColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="display" style={{ fontSize: 18 }} numberOfLines={1}>{value}</Txt>
        <Txt variant="label" numberOfLines={1}>{label}</Txt>
      </View>
    </View>
  );
}

// ---------- SectionHeader ----------
export function SectionHeader({ title, action, onPressAction, testID }:
  { title: string; action?: string; onPressAction?: () => void; testID?: string }) {
  return (
    <View style={styles.sectionHeader} testID={testID}>
      <Txt variant="label">{title}</Txt>
      {action ? (
        <Pressable onPress={onPressAction} hitSlop={8}>
          <Txt variant="label" color={colors.fccBlue}>{action}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- MapToolbar (compact map-layer toggles) ----------
export type MapToolbarItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap };
export function MapToolbar({ items, active, onToggle }:
  { items: MapToolbarItem[]; active: Record<string, boolean>; onToggle: (key: string) => void }) {
  return (
    <View style={styles.mapToolbar}>
      {items.map((it) => {
        const on = active[it.key];
        return (
          <Pressable key={it.key} testID={`maptoolbar-${it.key}`} onPress={() => onToggle(it.key)}
            style={[styles.mapToolbarChip, on ? styles.mapToolbarChipOn : null]}>
            <Ionicons name={it.icon} size={12} color={on ? colors.onFccBlue : colors.onSurfaceSecondary} />
            <Text style={[styles.mapToolbarText, { color: on ? colors.onFccBlue : colors.onSurfaceSecondary }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- LiveDriverRow ----------
// `meta` is a single pre-formatted line (e.g. "EM ROTA · R-105 · AA-12-BB",
// "ATIVO NA APP · sem rota", or just "OFFLINE") — the caller decides exactly
// what belongs on it per status, since that varies (an offline driver has
// no "sem rota" to show, an online one does, on_route shows real route info).
export function LiveDriverRow({ name, meta, statusColor, agoLabel, testID }: {
  name: string; meta: string; statusColor: string; agoLabel?: string; testID?: string;
}) {
  return (
    <View testID={testID} style={styles.liveRow}>
      <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="monoBold" style={{ fontSize: 13 }} numberOfLines={1}>{name}</Txt>
        <Txt variant="label" color={statusColor} numberOfLines={1}>{meta}</Txt>
      </View>
      {agoLabel ? <Txt variant="label" style={{ fontSize: 9 }}>{agoLabel}</Txt> : null}
    </View>
  );
}

// ---------- AlertRow ----------
export function AlertRow({ title, description, tone = "warning", testID }:
  { title: string; description?: string; tone?: "warning" | "error"; testID?: string }) {
  const c = tone === "error" ? colors.error : colors.warning;
  return (
    <View testID={testID} style={[styles.alertRow, { borderLeftColor: c }]}>
      <Ionicons name="warning" size={14} color={c} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="monoBold" style={{ fontSize: 12 }} numberOfLines={1}>{title}</Txt>
        {description ? <Txt variant="mono" color={colors.muted} style={{ fontSize: 11 }} numberOfLines={2}>{description}</Txt> : null}
      </View>
    </View>
  );
}

// ---------- IncidentRow ----------
export function IncidentRow({ title, description, statusLabel, statusColor, agoLabel, onPress, testID }: {
  title: string; description?: string; statusLabel: string; statusColor: string;
  agoLabel?: string; onPress?: () => void; testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={styles.liveRow}>
      <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="monoBold" style={{ fontSize: 13 }} numberOfLines={1}>{title}</Txt>
        <Txt variant="mono" color={colors.muted} style={{ fontSize: 11 }} numberOfLines={1}>
          {description}{agoLabel ? ` · ${agoLabel}` : ""}
        </Txt>
      </View>
      <Badge label={statusLabel} color={statusColor} />
    </Pressable>
  );
}

// ---------- SearchInput ----------
export function SearchInput({ value, onChangeText, placeholder = "Pesquisar...", testID }:
  { value: string; onChangeText: (v: string) => void; placeholder?: string; testID?: string }) {
  return (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={16} color={colors.muted} />
      <TextInput
        testID={testID}
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- ActionMenu ----------
export type ActionMenuItem = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
};
export function ActionMenu({ visible, onClose, title, items }:
  { visible: boolean; onClose: () => void; title?: string; items: ActionMenuItem[] }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {title ? <Text style={[txtVariants.displaySm, { marginBottom: spacing.xs }]}>{title}</Text> : null}
          {items.map((it, i) => (
            <Pressable
              key={i}
              testID={it.testID}
              disabled={it.disabled}
              onPress={() => { onClose(); it.onPress(); }}
              style={[styles.menuRow, it.disabled ? { opacity: 0.4 } : null]}
            >
              <Text style={[txtVariants.monoBold, it.destructive ? { color: colors.error } : null]}>{it.label}</Text>
              {it.icon ? <Ionicons name={it.icon} size={18} color={it.destructive ? colors.error : colors.onSurface} /> : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- ConfirmModal ----------
export function ConfirmModal({ visible, title, message, destructive, confirmLabel = "CONFIRMAR", cancelLabel = "CANCELAR", loading, onConfirm, onCancel, children }: {
  visible: boolean; title: string; message?: string; destructive?: boolean;
  confirmLabel?: string; cancelLabel?: string; loading?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={txtVariants.displaySm}>{title}</Text>
          {message ? <Text style={[txtVariants.mono, { color: colors.muted, marginTop: spacing.sm }]}>{message}</Text> : null}
          {children ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Btn title={cancelLabel} variant="outline" style={{ flex: 1 }} onPress={onCancel} />
            <Btn title={confirmLabel} variant={destructive ? "error" : "primary"} style={{ flex: 1 }} loading={loading} onPress={onConfirm} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  compactCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, ...(shadows.sm as object) },
  btn: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnTxt: { fontFamily: fonts.monoBold, letterSpacing: 0.3 },
  stat: { flex: 1, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, gap: 2, ...(shadows.sm as object) },
  statIcon: { width: 24, height: 24, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, letterSpacing: -0.3 },
  statLabel: { fontFamily: fonts.monoMedium, fontSize: 9.5, color: colors.muted, letterSpacing: 0.3, textTransform: "uppercase" },
  dashStat: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, minWidth: 128, flexGrow: 1,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  dashStatIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mapToolbar: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  mapToolbarChip: {
    flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 9, borderRadius: radius.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  mapToolbarChipOn: { backgroundColor: colors.fccBlue, borderColor: colors.fccBlue },
  mapToolbarText: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.2 },
  liveRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface,
  },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill },
  alertRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radius.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
  },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  menuRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyIcon: { width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  centerTxt: { fontFamily: fonts.monoMedium, fontSize: 13, color: colors.muted, textAlign: "center" },
  toastWrap: { position: "absolute", bottom: 100, left: 16, right: 16, gap: 8, alignItems: "center" },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, maxWidth: "100%" },
  toastTxt: { fontFamily: fonts.monoBold, fontSize: 13, color: "#fff" },
});
