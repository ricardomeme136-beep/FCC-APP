import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";

import { useAuth, homeForRole } from "@/src/auth/AuthContext";
import { Btn, Txt, useToast } from "@/src/components/ui";
import { colors, fonts, spacing, border } from "@/src/theme";

const DEMO = [
  { label: "Administrador", email: "admin@wasteflow.pt" },
  { label: "Despachante", email: "despachante@wasteflow.pt" },
  { label: "Motorista", email: "motorista@wasteflow.pt" },
  { label: "Cliente", email: "cliente@wasteflow.pt" },
];

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [email, setEmail] = useState("admin@wasteflow.pt");
  const [password, setPassword] = useState("WasteFlow2026!");
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    setBusy(true);
    try {
      await login(email, password);
      const me = await (await import("@/src/api")).api.get<any>("/auth/me");
      router.replace(homeForRole(me.role) as any);
    } catch (e: any) {
      toast(e?.message || "Falha na autenticação", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Txt variant="display" color={colors.onBrand} style={{ fontSize: 26 }}>W</Txt>
          </View>
          <View>
            <Txt variant="display" style={{ fontSize: 28 }}>WASTEFLOW</Txt>
            <Txt variant="label">GESTÃO DE RECOLHA DE RESÍDUOS</Txt>
          </View>
        </View>

        <Image
          source={{ uri: "https://images.unsplash.com/photo-1650535716978-eb644a8cf898?crop=entropy&cs=srgb&fm=jpg&w=1000&q=80" }}
          style={styles.hero}
          contentFit="cover"
        />

        <View style={styles.form}>
          <Txt variant="label">EMAIL</Txt>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="email@empresa.pt"
            placeholderTextColor={colors.muted}
          />
          <Txt variant="label" style={{ marginTop: spacing.md }}>PALAVRA-PASSE</Txt>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
          />

          <Btn
            testID="login-submit-button"
            title="ENTRAR"
            size="lg"
            loading={busy}
            onPress={onLogin}
            style={{ marginTop: spacing.lg }}
          />

          <Txt variant="label" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>ACESSO RÁPIDO (DEMO)</Txt>
          <View style={styles.demoWrap}>
            {DEMO.map((d) => (
              <Pressable
                key={d.email}
                testID={`demo-${d.label}`}
                style={styles.demoChip}
                onPress={() => {
                  setEmail(d.email);
                  setPassword("WasteFlow2026!");
                }}
              >
                <Txt variant="monoBold" style={{ fontSize: 11 }}>{d.label}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoMark: {
    width: 52, height: 52, backgroundColor: colors.brand,
    borderWidth: border.width, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  hero: { width: "100%", height: 150, borderWidth: border.width, borderColor: colors.borderStrong },
  form: { gap: spacing.xs },
  input: {
    borderWidth: border.width, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md, height: 50, fontFamily: fonts.mono,
    fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface,
  },
  demoWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  demoChip: {
    borderWidth: border.width, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
  },
});
