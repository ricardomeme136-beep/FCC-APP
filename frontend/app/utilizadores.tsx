import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Badge, Btn, Empty, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius, roleLabels } from "@/src/theme";

const CREATABLE_ROLES = ["company_admin", "dispatcher", "operations_manager", "maintenance_manager", "driver", "customer"];

export default function Utilizadores() {
  const toast = useToast();
  const [users, setUsers] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState("dispatcher");

  const load = useCallback(async () => {
    const list = await api.get<any[]>("/users");
    setUsers(list);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(""); setEmail(""); setPassword(""); setConfirm(""); setRole("dispatcher");
  };

  const createUser = async () => {
    if (!name.trim() || !email.trim() || !password) {
      toast("Preencha nome, email e password", "error");
      return;
    }
    if (password !== confirm) {
      toast("As passwords não coincidem", "error");
      return;
    }
    if (password.length < 8) {
      toast("A password deve ter pelo menos 8 caracteres", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post("/users", { name, email, password, role });
      toast("Utilizador criado", "success");
      resetForm();
      setCreating(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao criar utilizador", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleDisabled = async (u: any) => {
    setBusy(true);
    try {
      await api.patch(`/users/${u.id}`, { disabled: !u.disabled });
      toast(u.disabled ? "Utilizador reativado" : "Utilizador desativado", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!users) {
    return (<View style={styles.flex}><ScreenHeader title="UTILIZADORES" back /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="UTILIZADORES" subtitle={`${users.length} conta(s)`} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!creating ? (
          <Btn testID="start-create-user" title="CRIAR UTILIZADOR" icon="person-add" onPress={() => setCreating(true)} />
        ) : (
          <View style={styles.form}>
            <View style={styles.formHead}>
              <Txt variant="label">NOVO UTILIZADOR</Txt>
              <Pressable testID="cancel-create-user" onPress={() => { setCreating(false); resetForm(); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Txt variant="label">NOME</Txt>
            <TextInput testID="user-name-input" style={styles.input} value={name} onChangeText={setName} placeholder="Nome completo" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.sm }}>EMAIL</Txt>
            <TextInput testID="user-email-input" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="email@empresa.pt" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.sm }}>PASSWORD INICIAL</Txt>
            <TextInput testID="user-password-input" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.sm }}>CONFIRMAR PASSWORD</Txt>
            <TextInput testID="user-confirm-input" style={styles.input} value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.sm }}>FUNÇÃO</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {CREATABLE_ROLES.map((r) => (
                <Pressable key={r} testID={`role-chip-${r}`} onPress={() => setRole(r)} style={[styles.chip, role === r ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={role === r ? colors.onSurfaceInverse : colors.onSurface}>
                    {(roleLabels[r] || r).toUpperCase()}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>

            <Btn testID="confirm-create-user" title="CRIAR" loading={busy} onPress={createUser} style={{ marginTop: spacing.md }} />
          </View>
        )}

        {users.length === 0 ? (
          <Empty text="Sem utilizadores." icon="people-outline" />
        ) : (
          users.map((u) => (
            <View key={u.id} style={styles.row} testID={`user-row-${u.id}`}>
              <View style={{ flex: 1 }}>
                <Txt variant="monoBold">{u.name}</Txt>
                <Txt variant="mono" color={colors.muted}>{u.email || (u.username ? `Nº ${u.username}` : "—")}</Txt>
                <Txt variant="label">{(roleLabels[u.role] || u.role).toUpperCase()}</Txt>
              </View>
              <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
                <Badge label={u.disabled ? "DESATIVADO" : "ATIVO"} color={u.disabled ? colors.muted : colors.success} />
                <Pressable testID={`toggle-user-${u.id}`} disabled={busy} onPress={() => toggleDisabled(u)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={u.disabled ? colors.success : colors.error}>
                    {u.disabled ? "REATIVAR" : "DESATIVAR"}
                  </Txt>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  form: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  formHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg,
  },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: { height: 34, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
});
