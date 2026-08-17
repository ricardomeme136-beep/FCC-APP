import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    if (!identifier.trim() || !password) {
      toast("Introduza o email ou número e a palavra-passe", "error");
      return;
    }
    setBusy(true);
    try {
      await login(identifier, password);
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
          <Image source={require("@/assets/images/fcc-logo.png")} style={styles.logoMark} contentFit="contain" />
          <View>
            <Txt variant="label">GESTÃO DE RECOLHA DE RESÍDUOS</Txt>
          </View>
        </View>

        <Image
          source={{ uri: "https://images.unsplash.com/photo-1650535716978-eb644a8cf898?crop=entropy&cs=srgb&fm=jpg&w=1000&q=80" }}
          style={styles.hero}
          contentFit="cover"
        />

        <View style={styles.form}>
          <Txt variant="label">EMAIL OU Nº DE MOTORISTA</Txt>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            placeholder="email@empresa.pt ou nº de motorista"
            placeholderTextColor={colors.muted}
          />
          <Txt variant="label" style={{ marginTop: spacing.md }}>PALAVRA-PASSE</Txt>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
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

          <Txt variant="label" style={{ marginTop: spacing.lg, textAlign: "center" }} color={colors.muted}>
            ESQUECEU-SE DA PALAVRA-PASSE? CONTACTE O ADMINISTRADOR
          </Txt>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoMark: {
    width: 108, height: 51, borderRadius: 12, overflow: "hidden",
    borderWidth: border.width, borderColor: colors.border,
  },
  hero: { width: "100%", height: 150, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  form: { gap: spacing.xs },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    paddingHorizontal: spacing.md, height: 50, fontFamily: fonts.mono,
    fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface,
  },
});
