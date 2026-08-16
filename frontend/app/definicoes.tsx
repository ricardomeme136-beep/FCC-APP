import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Card, Txt } from "@/src/components/ui";
import { colors, spacing, roleLabels } from "@/src/theme";

export default function Definicoes() {
  const { user, logout } = useAuth();
  return (
    <View style={styles.flex}>
      <ScreenHeader title="DEFINIÇÕES" subtitle="CONFIGURAÇÃO" back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={{ gap: spacing.sm }}>
          <Txt variant="label">APLICAÇÃO</Txt>
          <Row k="Nome" v="WasteFlow" />
          <Row k="Versão" v="1.0.0 (MVP)" />
          <Row k="Distância máx. geofencing" v="120 m" />
        </Card>
        <Card style={{ gap: spacing.sm }}>
          <Txt variant="label">CONTA</Txt>
          <Row k="Utilizador" v={user?.name || "—"} />
          <Row k="Email" v={user?.email || "—"} />
          <Row k="Perfil" v={roleLabels[user?.role || ""] || user?.role || "—"} />
          <Row k="Empresa" v={user?.company?.name || "—"} />
        </Card>
        <Btn testID="settings-logout" title="TERMINAR SESSÃO" variant="dark" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Txt variant="mono" color={colors.muted}>{k}</Txt>
      <Txt variant="monoBold">{v}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
