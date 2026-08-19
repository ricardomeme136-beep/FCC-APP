import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Badge, Btn, CompactCard, Empty, Loading, SearchInput, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius, activityStatus } from "@/src/theme";

const EMPLOYMENT_STATUS: Record<string, { label: string; color: string }> = {
  ativo: { label: "ATIVO", color: colors.success },
  inativo: { label: "INATIVO", color: colors.muted },
  ferias: { label: "FÉRIAS", color: colors.info },
  baixa: { label: "BAIXA", color: colors.warning },
  indisponivel: { label: "INDISPONÍVEL", color: colors.error },
};

export default function Motoristas() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [drivers, setDrivers] = useState<any[] | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionsFor, setActionsFor] = useState<any | null>(null);
  const [resetFor, setResetFor] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseType, setLicenseType] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, v] = await Promise.all([
      api.get<any[]>("/drivers"),
      api.get<any[]>("/vehicles"),
    ]);
    setDrivers(d);
    setVehicles(v);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(""); setEmployeeNumber(""); setPhone(""); setEmail(""); setPassword(""); setConfirm("");
    setLicenseNumber(""); setLicenseType(""); setLicenseExpiry(""); setNotes(""); setVehicleId(null);
  };

  const createDriver = async () => {
    if (!name.trim()) { toast("Indique o nome completo", "error"); return; }
    if ((password || confirm) && password !== confirm) { toast("As passwords não coincidem", "error"); return; }
    if (password && password.length < 8) { toast("A password deve ter pelo menos 8 caracteres", "error"); return; }
    if (password && !email.trim() && !employeeNumber.trim()) {
      toast("Indique um email ou um número de motorista para criar o acesso", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post("/drivers", {
        name, employee_number: employeeNumber, phone,
        email: email || undefined, password: password || undefined,
        license_number: licenseNumber, license_type: licenseType,
        license_expiry: licenseExpiry || undefined, notes,
        vehicle_id: vehicleId || undefined,
      });
      toast((email || employeeNumber) && password ? "Motorista criado — já pode fazer login" : "Motorista criado", "success");
      resetForm();
      setCreating(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao criar motorista", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (d: any) => {
    setActionsFor(null);
    setBusy(true);
    try {
      const active = d.employment_status !== "inativo";
      await api.post(`/drivers/${d.id}/${active ? "disable" : "enable"}`);
      toast(active ? "Motorista desativado" : "Motorista reativado", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async () => {
    if (!resetFor) return;
    if (newPassword.length < 8) { toast("A password deve ter pelo menos 8 caracteres", "error"); return; }
    setBusy(true);
    try {
      await api.post(`/drivers/${resetFor.id}/reset-password`, { new_password: newPassword });
      toast("Password reposta", "success");
      setResetFor(null);
      setNewPassword("");
    } catch (e: any) {
      toast(e?.message || "Este motorista não tem conta de acesso associada", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!drivers) {
    return (<View style={styles.flex}><ScreenHeader title="MOTORISTAS" back /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="MOTORISTAS" subtitle={`${drivers.length} na equipa`} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!creating ? (
          <Btn testID="start-create-driver" title="NOVO MOTORISTA" icon="person-add" size="sm" onPress={() => setCreating(true)} />
        ) : (
          <View style={styles.form}>
            <View style={styles.formHead}>
              <Txt variant="label">NOVO MOTORISTA</Txt>
              <Pressable testID="cancel-create-driver" onPress={() => { setCreating(false); resetForm(); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Field label="NOME COMPLETO" value={name} onChangeText={setName} />
            <Field label="Nº DE FUNCIONÁRIO" value={employeeNumber} onChangeText={setEmployeeNumber} />
            <Field label="TELEFONE" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

            <Txt variant="label" style={{ marginTop: spacing.md }}>ACESSO À APLICAÇÃO (OPCIONAL)</Txt>
            <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>
              O motorista pode entrar com o email ou com o Nº DE FUNCIONÁRIO acima — só precisa de um dos dois.
            </Txt>
            <Field label="EMAIL" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Field label="PASSWORD INICIAL" value={password} onChangeText={setPassword} secureTextEntry />
            <Field label="CONFIRMAR PASSWORD" value={confirm} onChangeText={setConfirm} secureTextEntry />

            <Txt variant="label" style={{ marginTop: spacing.md }}>CARTA DE CONDUÇÃO</Txt>
            <Field label="NÚMERO" value={licenseNumber} onChangeText={setLicenseNumber} />
            <Field label="TIPO" value={licenseType} onChangeText={setLicenseType} placeholder="ex. C+E" />
            <Field label="VALIDADE (AAAA-MM-DD)" value={licenseExpiry} onChangeText={setLicenseExpiry} placeholder="2027-06-30" />

            <Txt variant="label" style={{ marginTop: spacing.md }}>OBSERVAÇÕES</Txt>
            <TextInput style={[styles.input, { height: 70 }]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.md }}>VIATURA HABITUAL (OPCIONAL)</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable style={[styles.chip, !vehicleId ? styles.chipOn : null]} onPress={() => setVehicleId(null)}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={!vehicleId ? colors.onSurfaceInverse : colors.onSurface}>NENHUMA</Txt>
              </Pressable>
              {vehicles.map((v) => (
                <Pressable key={v.id} style={[styles.chip, vehicleId === v.id ? styles.chipOn : null]} onPress={() => setVehicleId(v.id)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={vehicleId === v.id ? colors.onSurfaceInverse : colors.onSurface}>{v.plate}</Txt>
                </Pressable>
              ))}
            </ScrollView>

            <Btn testID="confirm-create-driver" title="CRIAR" loading={busy} onPress={createDriver} style={{ marginTop: spacing.md }} />
          </View>
        )}

        {drivers.length > 0 && !creating && (
          <SearchInput testID="search-drivers" value={search} onChangeText={setSearch} placeholder="Pesquisar por nome..." />
        )}

        {drivers.length === 0 ? (
          <Empty text="Sem motoristas" icon="people-outline" />
        ) : (
          drivers
            .filter((d) => !search || d.name?.toLowerCase().includes(search.toLowerCase()))
            .map((d) => {
              const emp = EMPLOYMENT_STATUS[d.employment_status] || EMPLOYMENT_STATUS.ativo;
              const act = activityStatus[d.activity_status] || activityStatus.offline;
              return (
                <Pressable key={d.id} testID={`driver-row-${d.id}`} onPress={() => setActionsFor(d)}>
                  <CompactCard style={styles.card}>
                    <View style={styles.head}>
                      <View style={styles.avatar}><Txt variant="monoBold" color="#fff">{d.name[0]}</Txt></View>
                      <View style={{ flex: 1 }}>
                        <Txt variant="monoBold">{d.name}</Txt>
                        <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>{d.phone || "Sem telefone"}</Txt>
                      </View>
                      <Badge label={emp.label} color={emp.color} />
                    </View>
                    <View style={styles.activityRow}>
                      <View style={[styles.activityDot, { backgroundColor: act.color }]} />
                      <Txt variant="label" color={act.color}>
                        {act.label}
                        {d.activity_status === "on_route" && d.current_route_code ? ` · ${d.current_route_code}` : ""}
                        {d.activity_status === "on_route" && d.current_vehicle_plate ? ` · ${d.current_vehicle_plate}` : ""}
                      </Txt>
                    </View>
                  </CompactCard>
                </Pressable>
              );
            })
        )}
      </ScrollView>

      <ActionMenu
        visible={!!actionsFor}
        onClose={() => setActionsFor(null)}
        title={actionsFor?.name}
        items={[
          {
            label: "Resetar password", icon: "key-outline", testID: "action-reset-password",
            onPress: () => setResetFor(actionsFor),
          },
          {
            label: actionsFor?.employment_status === "inativo" ? "Reativar motorista" : "Desativar motorista",
            icon: actionsFor?.employment_status === "inativo" ? "checkmark-circle-outline" : "close-circle-outline",
            destructive: actionsFor?.employment_status !== "inativo",
            testID: "action-toggle-active",
            onPress: () => actionsFor && toggleActive(actionsFor),
          },
        ]}
      />

      <Modal visible={!!resetFor} transparent animationType="fade" onRequestClose={() => setResetFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setResetFor(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">RESETAR PASSWORD</Txt>
            <Txt variant="mono" color={colors.muted}>{resetFor?.name}</Txt>
            <TextInput
              testID="reset-password-input"
              style={[styles.input, { marginTop: spacing.md }]}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="Nova password (mín. 8 caracteres)"
              placeholderTextColor={colors.muted}
            />
            <Btn testID="confirm-reset-password" title="DEFINIR NOVA PASSWORD" loading={busy} onPress={confirmReset} style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Field({ label, ...rest }: any) {
  return (
    <>
      <Txt variant="label" style={{ marginTop: spacing.xs }}>{label}</Txt>
      <TextInput style={styles.input} placeholderTextColor={colors.muted} {...rest} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { gap: spacing.xs },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  activityDot: { width: 7, height: 7, borderRadius: radius.pill },
  avatar: { width: 36, height: 36, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
});
