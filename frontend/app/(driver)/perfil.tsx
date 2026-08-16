import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Card, Txt } from "@/src/components/ui";
import { colors, spacing, border } from "@/src/theme";

export default function DriverPerfil() {
  const { user, logout } = useAuth();
  return (
    <View style={styles.flex}>
      <ScreenHeader title="PERFIL" subtitle="MOTORISTA" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.avatar}><Txt variant="display" color={colors.onBrand} style={{ fontSize: 34 }}>{(user?.name || "?")[0]}</Txt></View>
          <Txt variant="display">{user?.name}</Txt>
          <Txt variant="label">{user?.company?.name}</Txt>
        </View>
        <Card style={{ gap: spacing.sm }}>
          <Txt variant="label">CONTA</Txt>
          <Row k="Email" v={user?.email || "—"} />
          <Row k="Perfil" v="Motorista" />
        </Card>
        <Btn testID="driver-logout" title="TERMINAR SESSÃO" variant="dark" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<View style={styles.row}><Txt variant="mono" color={colors.muted}>{k}</Txt><Txt variant="monoBold">{v}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  hero: { alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  avatar: { width: 72, height: 72, backgroundColor: colors.brand, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", justifyContent: "space-between" },
});
