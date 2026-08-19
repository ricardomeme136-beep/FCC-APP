import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Badge, Btn, Empty, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { reverseGeocode } from "@/src/utils/geocode";
import { colors, spacing, border, radius } from "@/src/theme";

export default function Depositos() {
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [hours, setHours] = useState("06:00 - 22:00");
  const [capacity, setCapacity] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  const load = useCallback(async () => {
    const d = await api.get<any[]>("/depots");
    setItems(d);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(""); setAddress(""); setPoint(null); setHours("06:00 - 22:00"); setCapacity(""); setIsPrimary(false);
  };

  const makePrimary = async (id: string) => {
    const target = items?.find((d) => d.id === id);
    if (!target) return;
    try {
      await api.patch(`/depots/${id}`, {
        name: target.name, address: target.address, lat: target.lat, lng: target.lng,
        hours: target.hours, capacity: target.capacity, is_primary: true,
      });
      toast("Depósito principal atualizado", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao atualizar", "error");
    }
  };

  const setPointAndDetectAddress = (lat: number, lng: number) => {
    setPoint({ lat, lng });
    setLocating(true);
    reverseGeocode(lat, lng).then((a) => { if (a) setAddress(a); }).finally(() => setLocating(false));
  };

  const createDepot = async () => {
    if (!name.trim()) { toast("Indique o nome do depósito", "error"); return; }
    if (!point) { toast("Toque no mapa para definir a localização exata", "error"); return; }
    setBusy(true);
    try {
      await api.post("/depots", {
        name: name.trim(), address: address.trim(), lat: point.lat, lng: point.lng,
        hours, capacity, is_primary: isPrimary,
      });
      toast("Depósito criado", "success");
      resetForm();
      setCreating(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao criar depósito", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!items) {
    return (<View style={styles.flex}><ScreenHeader title="DEPÓSITOS" subtitle="BASES OPERACIONAIS" back /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="DEPÓSITOS" subtitle="BASES OPERACIONAIS" back />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!creating ? (
          <Btn testID="start-create-depot" title="NOVO DEPÓSITO" icon="add-circle" onPress={() => setCreating(true)} />
        ) : (
          <View style={styles.form}>
            <View style={styles.formHead}>
              <Txt variant="label">NOVO DEPÓSITO</Txt>
              <Pressable testID="cancel-create-depot" onPress={() => { setCreating(false); resetForm(); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Txt variant="label" style={{ marginTop: spacing.xs }}>NOME</Txt>
            <TextInput testID="depot-name-input" style={styles.input} value={name} onChangeText={setName}
              placeholder="ex. Depósito Central" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.md }}>LOCALIZAÇÃO — TOQUE NO MAPA PARA MARCAR O PONTO EXATO</Txt>
            <View style={styles.mapBox}>
              <FleetMap
                markers={point ? [{ id: "new-depot", lat: point.lat, lng: point.lng, color: colors.brand, draggable: true }] : []}
                center={point || { lat: 41.28, lng: -8.28 }}
                onMapPress={setPointAndDetectAddress}
                onDragMarker={(_id, lat, lng) => setPointAndDetectAddress(lat, lng)}
              />
            </View>
            <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>
              {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Ainda sem localização definida"}
            </Txt>

            <Txt variant="label" style={{ marginTop: spacing.md }}>MORADA {locating ? "(A DETETAR...)" : "(DETETADA AUTOMATICAMENTE — PODES EDITAR)"}</Txt>
            <TextInput testID="depot-address-input" style={styles.input} value={address} onChangeText={setAddress}
              placeholder="Toca no mapa para detetar automaticamente" placeholderTextColor={colors.muted} />

            <Txt variant="label" style={{ marginTop: spacing.md }}>HORÁRIO</Txt>
            <TextInput testID="depot-hours-input" style={styles.input} value={hours} onChangeText={setHours} />

            <Txt variant="label" style={{ marginTop: spacing.md }}>CAPACIDADE (OPCIONAL)</Txt>
            <TextInput testID="depot-capacity-input" style={styles.input} value={capacity} onChangeText={setCapacity} placeholder="ex. 20 viaturas" placeholderTextColor={colors.muted} />

            <Pressable testID="depot-primary-toggle" style={styles.primaryToggle} onPress={() => setIsPrimary((v) => !v)}>
              <Ionicons name={isPrimary ? "checkbox" : "square-outline"} size={20} color={isPrimary ? colors.brand : colors.muted} />
              <View style={{ flex: 1 }}>
                <Txt variant="monoBold" style={{ fontSize: 13 }}>Depósito principal / ponto de saída</Txt>
                <Txt variant="mono" color={colors.muted} style={{ fontSize: 11 }}>
                  Usado por defeito como início e fim de todas as rotas. Só pode haver um.
                </Txt>
              </View>
            </Pressable>

            <Btn testID="confirm-create-depot" title="CRIAR" loading={busy} onPress={createDepot} style={{ marginTop: spacing.lg }} />
          </View>
        )}

        {items.length === 0 ? (
          <Empty text="Sem depósitos" icon="business-outline" />
        ) : (
          items.map((d) => (
            <View key={d.id} style={styles.card} testID={`depot-row-${d.id}`}>
              <View style={styles.head}>
                <Txt variant="title" style={{ flex: 1 }}>{d.name}</Txt>
                {d.is_primary ? <Badge label="★ PRINCIPAL" color={colors.brand} /> : null}
              </View>
              <Txt variant="mono" color={colors.muted}>{d.address}</Txt>
              <Txt variant="label" color={colors.muted}>{d.lat?.toFixed(5)}, {d.lng?.toFixed(5)}</Txt>
              <View style={styles.metaRow}>
                <Txt variant="label">HORÁRIO {d.hours}</Txt>
                <Txt variant="label">CAP {d.capacity || "—"}</Txt>
              </View>
              {!d.is_primary && (
                <Pressable testID={`depot-make-primary-${d.id}`} onPress={() => makePrimary(d.id)}>
                  <Txt variant="label" color={colors.brand} style={{ marginTop: spacing.xs }}>TORNAR PRINCIPAL</Txt>
                </Pressable>
              )}
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
  card: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  primaryToggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm },
  form: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  formHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg,
  },
  mapBox: { height: 220, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs },
});
