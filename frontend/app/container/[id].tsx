import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Badge, Btn, ConfirmModal, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { reverseGeocode } from "@/src/utils/geocode";
import { colors, spacing, border, radius, wasteColors, wasteLabels, taskStatus } from "@/src/theme";

const ADMIN_ROLES = ["super_admin", "company_admin"];
const WASTE_TYPES = Object.keys(wasteLabels);
const CONTAINER_TYPES = ["120L", "240L", "800L", "1100L", "Molok"];
const CONTAINER_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "ATIVO", color: colors.success },
  archived: { label: "ARQUIVADO", color: colors.muted },
  inactive: { label: "INATIVO", color: colors.muted },
};

export default function ContainerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(user?.role || "");

  const [c, setC] = useState<any | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");

  const [address, setAddress] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [wasteType, setWasteType] = useState("general");
  const [containerType, setContainerType] = useState("1100L");
  const [capacity, setCapacity] = useState("");
  const [zoneId, setZoneId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cd, z] = await Promise.all([api.get<any>(`/containers/${id}`), api.get<any[]>("/zones")]);
    setC(cd);
    setZones(z);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startEdit = () => {
    setActionsOpen(false);
    setAddress(c.address || "");
    setPoint(typeof c.lat === "number" && typeof c.lng === "number" ? { lat: c.lat, lng: c.lng } : null);
    setWasteType(c.waste_type || "general");
    setContainerType(c.container_type || "1100L");
    setCapacity(String(c.capacity_kg ?? ""));
    setZoneId(c.zone_id || null);
    setEditing(true);
  };

  const setPointAndDetectAddress = (lat: number, lng: number) => {
    setPoint({ lat, lng });
    setLocating(true);
    reverseGeocode(lat, lng).then((a) => { if (a) setAddress(a); }).finally(() => setLocating(false));
  };

  const saveEdit = async () => {
    if (!address.trim()) { toast("Indique a morada", "error"); return; }
    if (!point) { toast("Defina a localização GPS", "error"); return; }
    setBusy(true);
    try {
      await api.patch(`/containers/${id}`, {
        address: address.trim(), lat: point.lat, lng: point.lng,
        waste_type: wasteType, container_type: containerType,
        capacity_kg: capacity ? Number(capacity) : undefined,
        zone_id: zoneId,
      });
      toast("Contentor atualizado", "success");
      setEditing(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao atualizar", "error");
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = () => {
    setActionsOpen(false);
    setConfirmDelete(true);
  };

  const attemptDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const res = await api.del<{ action: "delete" | "archive" }>(`/containers/${id}`);
      if (res.action === "delete") {
        toast("Contentor eliminado", "success");
        router.back();
      } else {
        toast("Contentor arquivado — histórico mantido", "success");
        await load();
      }
    } catch (e: any) {
      if (e?.status === 400) {
        setPasswordOpen(true);
      } else {
        toast(e?.message || "Erro ao eliminar", "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!password) { toast("Introduza a password", "error"); return; }
    setBusy(true);
    try {
      await api.del(`/containers/${id}`, { password });
      setPasswordOpen(false);
      setPassword("");
      toast("Contentor eliminado", "success");
      router.back();
    } catch (e: any) {
      toast(e?.message || "Password incorreta", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!c) return (<View style={styles.flex}><ScreenHeader title="CONTENTOR" back /><Loading /></View>);

  const st = CONTAINER_STATUS[c.status] || CONTAINER_STATUS.active;
  const hasGps = typeof c.lat === "number" && typeof c.lng === "number";

  if (editing) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="EDITAR CONTENTOR" back={false} right={
          <Pressable testID="cancel-edit-container" onPress={() => setEditing(false)} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
        } />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Txt variant="label">LOCALIZAÇÃO — TOQUE NO MAPA</Txt>
          <View style={styles.mapBox}>
            <FleetMap
              markers={point ? [{ id: "edit-container", lat: point.lat, lng: point.lng, color: wasteColors[wasteType], draggable: true }] : []}
              center={point || { lat: 41.28, lng: -8.28 }}
              onMapPress={setPointAndDetectAddress}
              onDragMarker={(_pid, lat, lng) => setPointAndDetectAddress(lat, lng)}
            />
          </View>
          <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>
            {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Sem localização — toca no mapa"}
          </Txt>

          <Txt variant="label" style={{ marginTop: spacing.md }}>MORADA {locating ? "(A DETETAR...)" : ""}</Txt>
          <TextInput testID="edit-container-address" style={styles.input} value={address} onChangeText={setAddress} placeholderTextColor={colors.muted} />

          <Txt variant="label" style={{ marginTop: spacing.md }}>TIPO DE RESÍDUO</Txt>
          <View style={styles.chipRow}>
            {WASTE_TYPES.map((wt) => {
              const on = wasteType === wt;
              return (
                <Pressable key={wt} style={[styles.chip, on ? { backgroundColor: wasteColors[wt] } : null]} onPress={() => setWasteType(wt)}>
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
                <Pressable key={ct} style={[styles.chip, on ? styles.chipOn : null]} onPress={() => setContainerType(ct)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{ct}</Txt>
                </Pressable>
              );
            })}
          </View>

          <Txt variant="label" style={{ marginTop: spacing.md }}>CAPACIDADE (KG)</Txt>
          <TextInput testID="edit-container-capacity" style={styles.input} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />

          {zones.length > 0 && (
            <>
              <Txt variant="label" style={{ marginTop: spacing.md }}>ZONA</Txt>
              <View style={styles.chipRow}>
                <Pressable style={[styles.chip, !zoneId ? styles.chipOn : null]} onPress={() => setZoneId(null)}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!zoneId ? colors.onSurfaceInverse : colors.onSurface}>NENHUMA</Txt>
                </Pressable>
                {zones.map((z) => (
                  <Pressable key={z.id} style={[styles.chip, zoneId === z.id ? styles.chipOn : null]} onPress={() => setZoneId(z.id)}>
                    <Txt variant="monoBold" style={{ fontSize: 11 }} color={zoneId === z.id ? colors.onSurfaceInverse : colors.onSurface}>{z.name}</Txt>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Btn testID="save-container-edit" title="GUARDAR" loading={busy} onPress={saveEdit} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title={c.qr_code} subtitle="CONTENTOR" back right={
        <Pressable testID="container-actions-menu" onPress={() => setActionsOpen(true)} hitSlop={10} style={styles.headerIconBtn}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.onSurface} />
        </Pressable>
      } />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.qrCard}>
          <QRCode value={c.qr_code} size={130} />
          <Txt variant="label" style={{ marginTop: spacing.sm }}>CÓDIGO QR ÚNICO</Txt>
        </View>

        <View style={styles.tagsRow}>
          <View style={styles.wasteTag}>
            <View style={[styles.wasteDot, { backgroundColor: wasteColors[c.waste_type] }]} />
            <Txt variant="monoBold">{wasteLabels[c.waste_type] || c.waste_type}</Txt>
          </View>
          <Badge label={st.label} color={st.color} />
        </View>

        {!hasGps && (
          <View style={styles.gpsWarning}>
            <Ionicons name="warning" size={16} color={colors.error} />
            <Txt variant="mono" color={colors.error} style={{ flex: 1, fontSize: 12 }}>
              Sem localização GPS — este contentor não pode ser usado numa rota. Toca em "Editar" para definir a localização.
            </Txt>
          </View>
        )}

        <View style={styles.infoCard}>
          <Row k="Morada" v={c.address} />
          <Row k="Tipo" v={c.container_type} />
          <Row k="Capacidade" v={`${c.capacity_kg} kg`} />
          <Row k="Frequência" v={c.frequency} />
          <Row k="Dias" v={(c.schedule_days || []).join(", ") || "—"} />
          <Row k="Última recolha" v={c.last_collection ? c.last_collection.slice(0, 10) : "—"} />
          <Row k="Próxima recolha" v={c.next_collection ? c.next_collection.slice(0, 10) : "—"} />
          <Row k="Coordenadas" v={hasGps ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : "—"} />
        </View>

        {hasGps && (
          <View style={styles.mapBox}>
            <FleetMap markers={[{ id: c.id, lat: c.lat, lng: c.lng, color: wasteColors[c.waste_type] }]} />
          </View>
        )}

        <Txt variant="label">HISTÓRICO DE RECOLHAS ({(c.history || []).length})</Txt>
        {(c.history || []).length === 0 ? (
          <Txt variant="mono" color={colors.muted}>Sem histórico — nunca foi usado numa rota.</Txt>
        ) : (
          (c.history || []).slice(0, 20).map((h: any) => {
            const ts = taskStatus[h.status] || taskStatus.scheduled;
            return (
              <View key={h.id} style={styles.histRow}>
                <Txt variant="mono" color={colors.muted}>{h.scheduled_date}</Txt>
                <Badge label={ts.label} color={ts.color} />
              </View>
            );
          })
        )}
      </ScrollView>

      <ActionMenu
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={c.qr_code}
        items={[
          { label: "Editar", icon: "create-outline" as const, testID: "action-edit", onPress: startEdit },
          ...(isAdmin && c.status !== "archived" ? [{
            label: "Arquivar / eliminar", icon: "trash-outline" as const, destructive: true,
            testID: "action-delete", onPress: requestDelete,
          }] : []),
        ]}
      />

      <ConfirmModal
        visible={confirmDelete}
        title="Eliminar contentor"
        message={`Tem a certeza de que pretende eliminar o contentor ${c.qr_code}? Se já tiver histórico de recolhas, será arquivado em vez de eliminado.`}
        destructive
        confirmLabel="CONTINUAR"
        loading={busy}
        onConfirm={attemptDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        visible={passwordOpen}
        title="Eliminação permanente"
        message={`O contentor ${c.qr_code} nunca foi usado numa rota — pode ser eliminado permanentemente. Confirme a sua password para continuar.`}
        destructive
        confirmLabel="ELIMINAR"
        loading={busy}
        onConfirm={confirmPermanentDelete}
        onCancel={() => { setPasswordOpen(false); setPassword(""); }}
      >
        <TextInput
          testID="delete-password-input"
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

function Row({ k, v }: { k: string; v: string }) {
  return (<View style={styles.row}><Txt variant="mono" color={colors.muted}>{k}</Txt><Txt variant="monoBold" style={{ flex: 1, textAlign: "right" }} numberOfLines={1}>{v}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  headerIconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  qrCard: { alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, backgroundColor: colors.surface },
  tagsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wasteTag: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wasteDot: { width: 16, height: 16, borderRadius: radius.xs },
  gpsWarning: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: border.width, borderColor: colors.error, backgroundColor: colors.errorSoft, borderRadius: radius.md, padding: spacing.sm },
  infoCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  mapBox: { height: 160, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  histRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingVertical: 2 },
  chip: { height: 34, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.onSurface },
});
