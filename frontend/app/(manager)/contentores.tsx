import { useCallback, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Btn, ConfirmModal, Loading, SearchInput, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { reverseGeocode } from "@/src/utils/geocode";
import { colors, spacing, border, radius, wasteColors, wasteLabels } from "@/src/theme";

const ADMIN_ROLES = ["super_admin", "company_admin"];
const CONTAINER_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "ATIVO", color: colors.success },
  archived: { label: "ARQUIVADO", color: colors.muted },
  inactive: { label: "INATIVO", color: colors.muted },
};

const CHIPS = [
  { key: "", label: "TODOS" },
  { key: "general", label: "INDIFERENCIADOS" },
  { key: "paper", label: "PAPEL" },
  { key: "plastic", label: "PLÁSTICO" },
  { key: "glass", label: "VIDRO" },
  { key: "organic", label: "ORGÂNICOS" },
  { key: "food", label: "ALIMENTARES" },
  { key: "commercial", label: "COMERCIAIS" },
];
const WASTE_TYPES = Object.keys(wasteLabels);
const CONTAINER_TYPES = ["120L", "240L", "800L", "1100L", "Molok"];
const FREQUENCIES = [
  { key: "diaria", label: "DIÁRIA" },
  { key: "dias_alternados", label: "DIAS ALTERNADOS" },
  { key: "semanal", label: "SEMANAL" },
  { key: "quinzenal", label: "QUINZENAL" },
];

export default function Contentores() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(user?.role || "");
  const [all, setAll] = useState<any[] | null>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [zones, setZones] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [actionsFor, setActionsFor] = useState<any | null>(null);
  const [confirmArchiveFor, setConfirmArchiveFor] = useState<any | null>(null);
  const [passwordFor, setPasswordFor] = useState<any | null>(null);
  const [password, setPassword] = useState("");

  const [address, setAddress] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [wasteType, setWasteType] = useState("general");
  const [containerType, setContainerType] = useState("1100L");
  const [capacity, setCapacity] = useState("1100");
  const [frequency, setFrequency] = useState("semanal");
  const [zoneId, setZoneId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, z] = await Promise.all([
      api.get<any[]>("/containers?limit=1000"),
      api.get<any[]>("/zones"),
    ]);
    setAll(c);
    setZones(z);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setAddress(""); setPoint(null); setWasteType("general"); setContainerType("1100L");
    setCapacity("1100"); setFrequency("semanal"); setZoneId(null);
  };

  const setPointAndDetectAddress = (lat: number, lng: number) => {
    setPoint({ lat, lng });
    setLocating(true);
    reverseGeocode(lat, lng).then((a) => { if (a) setAddress(a); }).finally(() => setLocating(false));
  };

  const createContainer = async () => {
    if (!address.trim()) { toast("Indique a morada", "error"); return; }
    if (!point) { toast("Toque no mapa para definir a localização", "error"); return; }
    setBusy(true);
    try {
      await api.post("/containers", {
        address: address.trim(), lat: point.lat, lng: point.lng,
        waste_type: wasteType, container_type: containerType,
        capacity_kg: capacity ? Number(capacity) : undefined,
        frequency, zone_id: zoneId || undefined,
      });
      toast("Contentor criado", "success");
      resetForm();
      setCreating(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao criar contentor", "error");
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (c: any) => {
    setActionsFor(null);
    setConfirmArchiveFor(c);
  };

  const attemptDelete = async () => {
    const c = confirmArchiveFor;
    if (!c) return;
    setConfirmArchiveFor(null);
    setBusy(true);
    try {
      const res = await api.del<{ action: "delete" | "archive" }>(`/containers/${c.id}`);
      toast(res.action === "archive" ? "Contentor arquivado — histórico mantido" : "Contentor eliminado", "success");
      await load();
    } catch (e: any) {
      if (e?.status === 400) {
        // No history — this is a permanent deletion, needs password confirmation.
        setPasswordFor(c);
      } else {
        toast(e?.message || "Erro ao eliminar", "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!passwordFor) return;
    if (!password) { toast("Introduza a password", "error"); return; }
    setBusy(true);
    try {
      const res = await api.del<{ action: "delete" | "archive" }>(`/containers/${passwordFor.id}`, { password });
      setPasswordFor(null);
      setPassword("");
      toast(res.action === "archive" ? "Contentor arquivado" : "Contentor eliminado", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Password incorreta", "error");
    } finally {
      setBusy(false);
    }
  };

  const viewOnMap = (c: any) => {
    setActionsFor(null);
    Linking.openURL(`https://www.google.com/maps?q=${c.lat},${c.lng}`);
  };

  const data = (all || [])
    .filter((c) => !filter || c.waste_type === filter)
    .filter((c) => !search || c.address?.toLowerCase().includes(search.toLowerCase()) || c.qr_code?.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={styles.flex}>
      <ScreenHeader title="CONTENTORES" subtitle={all ? `${all.length} REGISTADOS` : "A CARREGAR"} />

      {!creating ? (
        <View style={styles.addRow}>
          <Btn testID="start-create-container" title="NOVO CONTENTOR" icon="add-circle" size="sm" onPress={() => setCreating(true)} />
          {all && all.length > 0 && (
            <SearchInput testID="search-containers" value={search} onChangeText={setSearch} placeholder="Pesquisar por morada ou código..." />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.form}>
          <View style={styles.formHead}>
            <Txt variant="label">NOVO CONTENTOR</Txt>
            <Pressable testID="cancel-create-container" onPress={() => { setCreating(false); resetForm(); }} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <Txt variant="label" style={{ marginTop: spacing.md }}>LOCALIZAÇÃO — TOQUE NO MAPA</Txt>
          <View style={styles.mapBox}>
            <FleetMap
              markers={point ? [{ id: "new-container", lat: point.lat, lng: point.lng, color: wasteColors[wasteType], draggable: true }] : []}
              center={point || { lat: 41.28, lng: -8.28 }}
              onMapPress={setPointAndDetectAddress}
              onDragMarker={(_id, lat, lng) => setPointAndDetectAddress(lat, lng)}
            />
          </View>
          <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>
            {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Ainda sem localização definida"}
          </Txt>

          <Txt variant="label" style={{ marginTop: spacing.md }}>MORADA {locating ? "(A DETETAR...)" : "(DETETADA AUTOMATICAMENTE — PODES EDITAR)"}</Txt>
          <TextInput testID="container-address-input" style={styles.input} value={address} onChangeText={setAddress}
            placeholder="Toca no mapa para detetar automaticamente" placeholderTextColor={colors.muted} />

          <Txt variant="label" style={{ marginTop: spacing.md }}>TIPO DE RESÍDUO</Txt>
          <View style={styles.chipRow}>
            {WASTE_TYPES.map((wt) => {
              const on = wasteType === wt;
              return (
                <Pressable key={wt} testID={`container-waste-${wt}`} style={[styles.chip, on ? { backgroundColor: wasteColors[wt] } : null]} onPress={() => setWasteType(wt)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{wasteLabels[wt]}</Txt>
                </Pressable>
              );
            })}
          </View>

          <Txt variant="label" style={{ marginTop: spacing.md }}>TIPO DE CONTENTOR</Txt>
          <View style={styles.chipRow}>
            {CONTAINER_TYPES.map((ct) => {
              const on = containerType === ct;
              return (
                <Pressable key={ct} testID={`container-type-${ct}`} style={[styles.chip, on ? styles.chipOn : null]} onPress={() => setContainerType(ct)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{ct}</Txt>
                </Pressable>
              );
            })}
          </View>

          <Txt variant="label" style={{ marginTop: spacing.md }}>CAPACIDADE (KG)</Txt>
          <TextInput testID="container-capacity-input" style={styles.input} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />

          <Txt variant="label" style={{ marginTop: spacing.md }}>FREQUÊNCIA DE RECOLHA</Txt>
          <View style={styles.chipRow}>
            {FREQUENCIES.map((f) => {
              const on = frequency === f.key;
              return (
                <Pressable key={f.key} testID={`container-freq-${f.key}`} style={[styles.chip, on ? styles.chipOn : null]} onPress={() => setFrequency(f.key)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{f.label}</Txt>
                </Pressable>
              );
            })}
          </View>

          {zones.length > 0 && (
            <>
              <Txt variant="label" style={{ marginTop: spacing.md }}>ZONA (OPCIONAL)</Txt>
              <View style={styles.chipRow}>
                <Pressable testID="container-zone-none" style={[styles.chip, !zoneId ? styles.chipOn : null]} onPress={() => setZoneId(null)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!zoneId ? colors.onSurfaceInverse : colors.onSurface}>NENHUMA</Txt>
                </Pressable>
                {zones.map((z) => {
                  const on = zoneId === z.id;
                  return (
                    <Pressable key={z.id} testID={`container-zone-${z.id}`} style={[styles.chip, on ? styles.chipOn : null]} onPress={() => setZoneId(z.id)}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{z.name}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <Btn testID="confirm-create-container" title="CRIAR" loading={busy} onPress={createContainer} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      )}

      <View style={styles.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowFilter}>
          {CHIPS.map((c) => {
            const on = filter === c.key;
            return (
              <Pressable key={c.key || "all"} testID={`filter-${c.key || "all"}`} onPress={() => setFilter(c.key)} style={[styles.chip, on ? styles.chipOn : null]}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{c.label}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!all ? (
        <Loading />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          renderItem={({ item }) => {
            const st = CONTAINER_STATUS[item.status] || CONTAINER_STATUS.active;
            const zone = zones.find((z) => z.id === item.zone_id);
            const hasGps = typeof item.lat === "number" && typeof item.lng === "number";
            return (
              <Pressable testID={`container-${item.id}`} onPress={() => router.push(`/container/${item.id}` as any)}>
                <View style={styles.row}>
                  <View style={[styles.wasteBar, { backgroundColor: wasteColors[item.waste_type] || colors.info }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                      <Txt variant="monoBold" style={{ fontSize: 13 }}>{item.qr_code}</Txt>
                      <View style={[styles.statusPill, { backgroundColor: st.color }]}>
                        <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt>
                      </View>
                    </View>
                    <Txt variant="mono" color={colors.muted} numberOfLines={1} style={{ fontSize: 12 }}>{item.address}</Txt>
                    {!hasGps && (
                      <Txt variant="label" color={colors.error} style={{ marginTop: 2 }}>⚠ SEM LOCALIZAÇÃO GPS</Txt>
                    )}
                    <Txt variant="label" style={{ marginTop: 2 }}>
                      {wasteLabels[item.waste_type]} · {item.container_type} · {zone ? zone.name : "SEM ZONA"}
                    </Txt>
                    <Txt variant="label" style={{ marginTop: 2 }}>
                      ÚLT. RECOLHA {item.last_collection ? item.last_collection.slice(0, 10) : "—"} · PRÓX. {item.next_collection ? item.next_collection.slice(0, 10) : "—"}
                    </Txt>
                  </View>
                  <Pressable testID={`container-actions-${item.id}`} onPress={() => setActionsFor(item)} hitSlop={8} style={styles.actionsBtn}>
                    <Ionicons name="ellipsis-vertical" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <ActionMenu
        visible={!!actionsFor}
        onClose={() => setActionsFor(null)}
        title={actionsFor?.qr_code}
        items={[
          { label: "Editar", icon: "create-outline" as const, testID: "action-edit-container",
            onPress: () => router.push(`/container/${actionsFor.id}` as any) },
          { label: "Ver no mapa", icon: "map-outline" as const, testID: "action-view-map",
            onPress: () => viewOnMap(actionsFor) },
          ...(isAdmin ? [{
            label: "Arquivar / eliminar", icon: "trash-outline" as const, destructive: true,
            testID: "action-delete-container", onPress: () => requestDelete(actionsFor),
          }] : []),
        ]}
      />

      <ConfirmModal
        visible={!!confirmArchiveFor}
        title="Eliminar contentor"
        message={`Tem a certeza de que pretende eliminar o contentor ${confirmArchiveFor?.qr_code}? Se já tiver histórico de recolhas, será arquivado em vez de eliminado.`}
        destructive
        confirmLabel="CONTINUAR"
        loading={busy}
        onConfirm={attemptDelete}
        onCancel={() => setConfirmArchiveFor(null)}
      />

      <ConfirmModal
        visible={!!passwordFor}
        title="Eliminação permanente"
        message={`O contentor ${passwordFor?.qr_code} nunca foi usado numa rota — pode ser eliminado permanentemente. Confirme a sua password para continuar.`}
        destructive
        confirmLabel="ELIMINAR"
        loading={busy}
        onConfirm={confirmPermanentDelete}
        onCancel={() => { setPasswordFor(null); setPassword(""); }}
      >
        <TextInput
          testID="container-delete-password-input"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor={colors.muted}
        />
      </ConfirmModal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  addRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: spacing.sm },
  form: { padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface, borderBottomWidth: border.width, borderBottomColor: colors.borderStrong },
  formHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg,
  },
  mapBox: { height: 220, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs },
  chipWrap: { borderBottomWidth: border.width, borderBottomColor: colors.borderStrong },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingVertical: 2 },
  chipRowFilter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm, alignItems: "center" },
  chip: { height: 32, justifyContent: "center", flexShrink: 0, paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.onSurface },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing["2xl"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface, overflow: "hidden" },
  wasteBar: { width: 5, alignSelf: "stretch", borderRadius: radius.xs },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs },
  actionsBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
