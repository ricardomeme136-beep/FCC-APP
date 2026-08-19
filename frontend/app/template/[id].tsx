import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Badge, Btn, ConfirmModal, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import ContainerPicker from "@/src/components/ContainerPicker";
import { agoLabel } from "@/src/utils/time";
import { colors, spacing, border, radius, wasteLabels } from "@/src/theme";

function nextDays(n: number) {
  const out: { date: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? "HOJE" : i === 1 ? "AMANHÃ" : d.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" }).toUpperCase();
    out.push({ date: iso, label });
  }
  return out;
}
const DATE_OPTIONS = nextDays(14);

export default function TemplateDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [template, setTemplate] = useState<any | null>(null);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [containersById, setContainersById] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addSelection, setAddSelection] = useState<string[]>([]);
  const [editStopFor, setEditStopFor] = useState<any | null>(null);
  const [editStopSelection, setEditStopSelection] = useState<string[]>([]);
  const [assignFor, setAssignFor] = useState<"driver" | "vehicle" | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedDate, setSchedDate] = useState(DATE_OPTIONS[0].date);
  const [schedTime, setSchedTime] = useState("");
  const [schedDriverId, setSchedDriverId] = useState<string | null>(null);
  const [schedVehicleId, setSchedVehicleId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [sameDateRoutes, setSameDateRoutes] = useState<any[]>([]);

  const load = useCallback(async () => {
    const [t, d, v, containers] = await Promise.all([
      api.get<any>(`/route-templates/${id}`),
      api.get<any[]>("/drivers"),
      api.get<any[]>("/vehicles"),
      api.get<any[]>("/containers?limit=2000"),
    ]);
    setTemplate(t);
    setDrivers(d);
    setVehicles(v);
    setContainersById(Object.fromEntries(containers.map((c) => [c.id, c])));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Same lightweight, non-blocking conflict check route/[id].tsx already
  // uses for reassigning a driver/vehicle — a warning label next to each
  // option, never a hard block. Re-fetched whenever the picked date changes.
  useEffect(() => {
    if (!scheduleOpen) return;
    api.get<any[]>("/routes").then((all) => setSameDateRoutes(
      all.filter((r) => r.date === schedDate && r.status !== "completed" && r.status !== "cancelled")
    )).catch(() => setSameDateRoutes([]));
  }, [scheduleOpen, schedDate]);

  if (!template) return (<View style={styles.flex}><ScreenHeader title="ROTA" back /><Loading /></View>);

  const stops = template.stops || [];
  const driver = drivers.find((d) => d.id === template.default_driver_id);
  const vehicle = vehicles.find((v) => v.id === template.default_vehicle_id);
  const totalContainers = stops.reduce((n: number, s: any) => n + (s.container_ids || []).length, 0);
  const geo = template.geometry;
  const markers = stops.map((s: any, i: number) => ({
    id: s.id, lat: s.lat, lng: s.lng, kind: "container" as const, label: String(i + 1),
    color: colors.fccBlue, draggable: true,
  }));
  const line = geo?.coordinates?.length ? geo.coordinates : stops.map((s: any) => ({ latitude: s.lat, longitude: s.lng }));

  const act = async (fn: () => Promise<any>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg, "success"); await load(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setBusy(false); }
  };

  const openRename = () => { setNameDraft(template.name); setDescDraft(template.description || ""); setRenameOpen(true); };
  const saveRename = () => {
    if (!nameDraft.trim()) { toast("O nome não pode ficar vazio", "error"); return; }
    setRenameOpen(false);
    act(() => api.patch(`/route-templates/${id}`, { name: nameDraft.trim(), description: descDraft }), "Rota atualizada");
  };

  const moveStop = (dir: -1 | 1, index: number) => {
    const order = stops.map((s: any) => s.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    act(() => api.patch(`/route-templates/${id}/stops/reorder`, { stop_ids: order }));
  };

  const removeStop = (stopId: string) => act(() => api.del(`/route-templates/${id}/stops/${stopId}`), "Paragem removida");

  const confirmAddStop = () => {
    const ids = addSelection;
    setAddOpen(false);
    setAddSelection([]);
    if (!ids.length) return;
    act(() => api.post(`/route-templates/${id}/stops`, { container_ids: ids }), "Paragem adicionada");
  };

  const openEditStop = (stop: any) => { setEditStopSelection(stop.container_ids || []); setEditStopFor(stop); };
  const confirmEditStop = () => {
    const stopId = editStopFor.id;
    setEditStopFor(null);
    act(() => api.patch(`/route-templates/${id}/stops/${stopId}`, { container_ids: editStopSelection }), "Contentores atualizados");
  };

  const onDragMarker = (stopId: string, lat: number, lng: number) => {
    act(() => api.patch(`/route-templates/${id}/stops/${stopId}`, { lat, lng }));
  };

  const assignDriver = (driverId: string) => { setAssignFor(null); act(() => api.patch(`/route-templates/${id}`, { default_driver_id: driverId }), "Motorista padrão definido"); };
  const assignVehicle = (vehicleId: string) => { setAssignFor(null); act(() => api.patch(`/route-templates/${id}`, { default_vehicle_id: vehicleId }), "Viatura padrão definida"); };

  const duplicate = async () => {
    setBusy(true);
    try {
      const dup = await api.post<any>(`/route-templates/${id}/duplicate`, {});
      toast("Rota duplicada", "success");
      router.replace(`/template/${dup.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Erro ao duplicar", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = () => {
    setArchiveConfirmOpen(false);
    act(() => api.patch(`/route-templates/${id}`, { active: !template.active }),
      template.active ? "Rota arquivada" : "Rota reativada");
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const res = await api.del<{ action: "delete" | "archive" }>(`/route-templates/${id}`);
      setDeleteConfirmOpen(false);
      toast(res.action === "archive" ? "Rota arquivada (tem execuções associadas)" : "Rota eliminada", "success");
      router.back();
    } catch (e: any) {
      toast(e?.message || "Erro ao eliminar", "error");
    } finally {
      setBusy(false);
    }
  };

  const openSchedule = () => {
    setSchedDate(DATE_OPTIONS[0].date);
    setSchedTime("");
    setSchedDriverId(template.default_driver_id || null);
    setSchedVehicleId(template.default_vehicle_id || null);
    setScheduleOpen(true);
  };

  const driverAvailability = (d: any) => {
    const busyRoute = sameDateRoutes.find((r) => r.driver_id === d.id);
    if (busyRoute) return { label: `JÁ TEM ROTA ${busyRoute.code}`, color: colors.warning };
    return { label: "DISPONÍVEL", color: colors.success };
  };
  const vehicleAvailability = (v: any) => {
    const busyRoute = sameDateRoutes.find((r) => r.vehicle_id === v.id);
    if (busyRoute) return { label: `JÁ TEM ROTA ${busyRoute.code}`, color: colors.warning };
    return { label: "DISPONÍVEL", color: colors.success };
  };

  const createExecution = async () => {
    if (schedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedTime.trim())) {
      toast("Hora inválida — use o formato HH:MM", "error");
      return;
    }
    setScheduling(true);
    try {
      const body: any = { date: schedDate };
      if (schedTime.trim()) body.start_time = schedTime.trim();
      if (schedDriverId) body.driver_id = schedDriverId;
      if (schedVehicleId) body.vehicle_id = schedVehicleId;
      const res = await api.post<{ route: any; warnings: string[] }>(`/route-templates/${id}/create-execution`, body);
      setScheduleOpen(false);
      if (res.warnings?.length) toast(res.warnings.join(" "), "info");
      toast("Execução criada", "success");
      router.replace(`/route/${res.route.id}` as any);
    } catch (e: any) {
      toast(e?.message || "Erro ao criar execução", "error");
    } finally {
      setScheduling(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={template.name} subtitle={template.active ? "TEMPLATE DE ROTA" : "TEMPLATE ARQUIVADO"} back
        right={
          <Pressable testID="template-actions-menu" onPress={() => setActionsOpen(true)} hitSlop={10} style={styles.headerIconBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.onSurface} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.mapBox}>
          <FleetMap markers={markers} polylines={[{ coordinates: line, color: colors.fccBlue, width: 4 }]}
                    onDragMarker={onDragMarker} />
        </View>

        <View style={styles.titleRow}>
          <Ionicons name="git-network" size={18} color={colors.fccBlue} />
          <Txt variant="displaySm" style={{ flex: 1, fontSize: 17 }} numberOfLines={1}>{template.name}</Txt>
          <Pressable testID="template-rename" onPress={openRename} hitSlop={8}>
            <Ionicons name="create-outline" size={18} color={colors.fccBlue} />
          </Pressable>
        </View>
        {template.description ? <Txt variant="mono" color={colors.muted}>{template.description}</Txt> : null}
        <Badge label={template.active ? "ATIVA" : "ARQUIVADA"} color={template.active ? colors.success : colors.muted} />

        <View style={styles.assignRow}>
          <Pressable testID="change-default-driver" style={styles.assignChip} onPress={() => setAssignFor("driver")}>
            <Ionicons name="people" size={14} color={colors.onSurfaceSecondary} />
            <Txt variant="mono" color={colors.muted}>{driver?.name || "Sem motorista padrão"}</Txt>
            <Ionicons name="create-outline" size={14} color={colors.fccBlue} />
          </Pressable>
          <Pressable testID="change-default-vehicle" style={styles.assignChip} onPress={() => setAssignFor("vehicle")}>
            <Ionicons name="bus" size={14} color={colors.onSurfaceSecondary} />
            <Txt variant="mono" color={colors.muted}>{vehicle?.plate || "Sem viatura padrão"}</Txt>
            <Ionicons name="create-outline" size={14} color={colors.fccBlue} />
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Cell label="PARAGENS" value={stops.length} />
          <Cell label="CONTENTORES" value={totalContainers} />
          <Cell label="DISTÂNCIA" value={`${template.distance_km || 0}km`} />
          <Cell label="DURAÇÃO" value={`${Math.round(template.duration_min || 0)}min`} />
        </View>
        <Txt variant="label" color={colors.muted}>ATUALIZADA {agoLabel(template.updated_at)}</Txt>

        <Btn testID="schedule-execution-button" title="AGENDAR / CRIAR EXECUÇÃO" icon="calendar" size="lg"
             disabled={!template.active} onPress={openSchedule} />
        {!template.active && (
          <Txt variant="label" color={colors.muted}>Reative esta rota para poder criar uma execução.</Txt>
        )}

        <Btn testID="add-template-stop-button" title="ADICIONAR PARAGEM" variant="outline" icon="add" loading={busy} onPress={() => setAddOpen(true)} />

        <Txt variant="label">PARAGENS ({stops.length})</Txt>
        {stops.length === 0 ? (
          <Txt variant="mono" color={colors.muted}>Sem paragens ainda — adicione contentores ou arraste um ponto no mapa.</Txt>
        ) : stops.map((stop: any, i: number) => (
          <View key={stop.id} style={styles.stopCard} testID={`template-stop-${stop.id}`}>
            <View style={styles.stopHead}>
              <View style={styles.seq}><Txt variant="monoBold" color="#fff">{stop.sequence}</Txt></View>
              <View style={{ flex: 1 }}>
                <Txt variant="displaySm" numberOfLines={1} style={{ fontSize: 15 }}>PARAGEM {stop.sequence}</Txt>
                <Txt variant="mono" color={colors.muted} numberOfLines={1}>{stop.address || "Sem morada"}</Txt>
              </View>
              <View style={styles.stopMoveBtns}>
                <Pressable testID={`template-up-${stop.id}`} disabled={i === 0 || busy} onPress={() => moveStop(-1, i)} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="chevron-up" size={18} color={i === 0 ? colors.muted : colors.onSurface} />
                </Pressable>
                <Pressable testID={`template-down-${stop.id}`} disabled={i === stops.length - 1 || busy} onPress={() => moveStop(1, i)} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="chevron-down" size={18} color={i === stops.length - 1 ? colors.muted : colors.onSurface} />
                </Pressable>
              </View>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {(stop.container_ids || []).map((cid: string) => {
                const c = containersById[cid];
                return (
                  <View key={cid} style={styles.containerChip}>
                    <Ionicons name="cube" size={11} color={colors.onSurfaceSecondary} />
                    <Txt variant="mono" style={{ fontSize: 11 }} numberOfLines={1}>
                      {c?.qr_code || `#${cid.slice(0, 6).toUpperCase()}`} · {wasteLabels[c?.waste_type] || c?.waste_type || ""}
                    </Txt>
                  </View>
                );
              })}
              {(stop.container_ids || []).length === 0 && (
                <Txt variant="label" color={colors.muted}>Sem contentores associados</Txt>
              )}
            </View>

            <View style={styles.stopActions}>
              <Pressable testID={`template-edit-containers-${stop.id}`} disabled={busy} onPress={() => openEditStop(stop)} style={styles.stopActionBtn}>
                <Ionicons name="cube-outline" size={16} color={colors.onSurface} />
                <Txt variant="monoBold" style={{ fontSize: 12 }}>CONTENTORES</Txt>
              </Pressable>
              <Pressable testID={`template-remove-stop-${stop.id}`} disabled={busy} onPress={() => removeStop(stop.id)} style={styles.stopActionBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Txt variant="monoBold" style={{ fontSize: 12 }} color={colors.error}>REMOVER</Txt>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={[styles.flex, { paddingTop: insets.top }]}>
          <ScreenHeader title="ADICIONAR PARAGEM" subtitle="ESCOLHER CONTENTORES" right={
            <Pressable testID="close-add-template-stop" onPress={() => setAddOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          } />
          <ScrollView contentContainerStyle={styles.scroll}>
            <ContainerPicker value={addSelection} onChange={setAddSelection} />
            <Btn testID="confirm-add-template-stop" title="CONFIRMAR" onPress={confirmAddStop} disabled={!addSelection.length} />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!editStopFor} animationType="slide" onRequestClose={() => setEditStopFor(null)}>
        <View style={[styles.flex, { paddingTop: insets.top }]}>
          <ScreenHeader title="CONTENTORES DA PARAGEM" subtitle={editStopFor ? `PARAGEM ${editStopFor.sequence}` : ""} right={
            <Pressable testID="close-edit-template-stop" onPress={() => setEditStopFor(null)} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          } />
          <ScrollView contentContainerStyle={styles.scroll}>
            <ContainerPicker value={editStopSelection} onChange={setEditStopSelection} />
            <Btn testID="confirm-edit-template-stop" title="GUARDAR" onPress={confirmEditStop} />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRenameOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">EDITAR ROTA</Txt>
            <Txt variant="label" style={{ marginTop: spacing.md }}>NOME</Txt>
            <TextInput testID="template-name-input" style={styles.input} value={nameDraft} onChangeText={setNameDraft}
                      placeholder="Nome da rota" placeholderTextColor={colors.muted} />
            <Txt variant="label" style={{ marginTop: spacing.md }}>DESCRIÇÃO</Txt>
            <TextInput testID="template-description-input" style={[styles.input, { height: 80 }]} value={descDraft} onChangeText={setDescDraft}
                      placeholder="Descrição (opcional)" placeholderTextColor={colors.muted} multiline />
            <Btn testID="save-template-rename" title="GUARDAR" onPress={saveRename} style={{ marginTop: spacing.lg }} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">{assignFor === "driver" ? "MOTORISTA PADRÃO" : "VIATURA PADRÃO"}</Txt>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              {assignFor === "driver"
                ? drivers.map((d) => (
                    <Pressable key={d.id} testID={`assign-default-driver-${d.id}`} style={styles.reason} onPress={() => assignDriver(d.id)}>
                      <Txt variant="monoBold">{d.name}</Txt>
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  ))
                : vehicles.map((v) => (
                    <Pressable key={v.id} testID={`assign-default-vehicle-${v.id}`} style={styles.reason} onPress={() => assignVehicle(v.id)}>
                      <Txt variant="monoBold">{v.plate}</Txt>
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={scheduleOpen} transparent animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setScheduleOpen(false)}>
          <Pressable style={[styles.sheet, { maxHeight: "85%", paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">CRIAR EXECUÇÃO</Txt>
            <Txt variant="mono" color={colors.muted} style={{ fontSize: 12, marginTop: 2 }}>A partir de "{template.name}"</Txt>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              <Txt variant="label">DATA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
                {DATE_OPTIONS.map((d) => (
                  <Pressable key={d.date} testID={`sched-date-${d.date}`} onPress={() => setSchedDate(d.date)}
                    style={[styles.chip, schedDate === d.date ? styles.chipOn : null]}>
                    <Txt variant="monoBold" style={{ fontSize: 11 }} color={schedDate === d.date ? colors.onSurfaceInverse : colors.onSurface}>{d.label}</Txt>
                  </Pressable>
                ))}
              </ScrollView>

              <Txt variant="label" style={{ marginTop: spacing.sm }}>HORA PREVISTA (OPCIONAL)</Txt>
              <TextInput testID="sched-time-input" style={styles.input} value={schedTime} onChangeText={setSchedTime}
                        placeholder="Ex: 06:00" placeholderTextColor={colors.muted} maxLength={5} />

              <Txt variant="label" style={{ marginTop: spacing.sm }}>MOTORISTA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
                <Pressable testID="sched-driver-none" onPress={() => setSchedDriverId(null)} style={[styles.chip, !schedDriverId ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!schedDriverId ? colors.onSurfaceInverse : colors.onSurface}>SEM MOTORISTA</Txt>
                </Pressable>
                {drivers.map((d) => {
                  const on = schedDriverId === d.id;
                  const av = driverAvailability(d);
                  return (
                    <Pressable key={d.id} testID={`sched-driver-${d.id}`} onPress={() => setSchedDriverId(d.id)} style={[styles.pickChip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{d.name}</Txt>
                      <Txt variant="label" color={on ? "#D1D5DB" : av.color}>{av.label}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Txt variant="label" style={{ marginTop: spacing.sm }}>VIATURA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
                <Pressable testID="sched-vehicle-none" onPress={() => setSchedVehicleId(null)} style={[styles.chip, !schedVehicleId ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!schedVehicleId ? colors.onSurfaceInverse : colors.onSurface}>SEM VIATURA</Txt>
                </Pressable>
                {vehicles.map((v) => {
                  const on = schedVehicleId === v.id;
                  const av = vehicleAvailability(v);
                  return (
                    <Pressable key={v.id} testID={`sched-vehicle-${v.id}`} onPress={() => setSchedVehicleId(v.id)} style={[styles.pickChip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{v.plate}</Txt>
                      <Txt variant="label" color={on ? "#D1D5DB" : av.color}>{av.label}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Btn testID="confirm-schedule-execution" title="CRIAR EXECUÇÃO" icon="calendar" size="lg" loading={scheduling}
                   onPress={createExecution} style={{ marginTop: spacing.md }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ActionMenu
        visible={actionsOpen} onClose={() => setActionsOpen(false)} title="AÇÕES"
        items={[
          { label: "Duplicar", icon: "copy-outline", onPress: duplicate, testID: "template-action-duplicate" },
          { label: template.active ? "Arquivar" : "Reativar", icon: "archive-outline",
            onPress: () => setArchiveConfirmOpen(true), testID: "template-action-archive" },
          { label: "Eliminar", icon: "trash-outline", destructive: true,
            onPress: () => setDeleteConfirmOpen(true), testID: "template-action-delete" },
        ]}
      />

      <ConfirmModal
        visible={archiveConfirmOpen} title={template.active ? "Arquivar esta rota?" : "Reativar esta rota?"}
        message={template.active ? "Deixa de aparecer como opção ativa para novas execuções." : undefined}
        confirmLabel={template.active ? "ARQUIVAR" : "REATIVAR"} loading={busy}
        onConfirm={toggleArchive} onCancel={() => setArchiveConfirmOpen(false)}
      />
      <ConfirmModal
        visible={deleteConfirmOpen} title="Eliminar esta rota?" destructive
        message="Se já tiver execuções associadas, fica arquivada em vez de eliminada."
        confirmLabel="ELIMINAR" loading={busy}
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirmOpen(false)}
      />
    </View>
  );
}

function Cell({ label, value }: { label: string; value: any }) {
  return (<View style={styles.cell}><Txt variant="monoBold" style={{ fontSize: 15 }} numberOfLines={1}>{value}</Txt><Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  mapBox: { height: 220, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, overflow: "hidden" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  assignRow: { flexDirection: "row", gap: spacing.sm },
  assignChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: border.width, borderColor: colors.border, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  statsRow: { flexDirection: "row", borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  cell: { flex: 1, padding: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border, alignItems: "center" },
  stopCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  stopHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stopMoveBtns: { flexDirection: "row" },
  iconBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  seq: { width: 32, height: 32, backgroundColor: colors.fccBlue, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  containerChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.bg },
  stopActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  stopActionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  reason: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md },
  headerIconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg, marginTop: spacing.xs,
  },
  chip: {
    height: 34, justifyContent: "center", paddingHorizontal: spacing.md,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  pickChip: {
    minWidth: 150, gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.fccBlue, borderColor: colors.fccBlue },
});
