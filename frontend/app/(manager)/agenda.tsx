import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { ActionMenu, Btn, ConfirmModal, Empty, Loading, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius, routeStatus } from "@/src/theme";

const DESKTOP_BREAKPOINT = 768;
const MONTHS_PT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
// 0=segunda .. 6=domingo — same convention as the backend's `weekdays` field.
const WEEKDAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];
const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "once", label: "UMA VEZ" },
  { value: "weekly", label: "DIAS DA SEMANA" },
  { value: "weekdays", label: "DIAS ÚTEIS" },
  { value: "daily", label: "TODOS OS DIAS" },
];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function mondayOf(d: Date) {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  const m = addDays(d, diff);
  m.setHours(0, 0, 0, 0);
  return m;
}
function todayIso() {
  return isoDate(new Date());
}

export default function Agenda() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [items, setItems] = useState<any[] | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);

  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpDate, setJumpDate] = useState("");

  const [cardMenuFor, setCardMenuFor] = useState<any | null>(null);
  const [cancelFor, setCancelFor] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTemplateId, setFormTemplateId] = useState<string | null>(null);
  const [formRecurrence, setFormRecurrence] = useState("once");
  const [formWeekdays, setFormWeekdays] = useState<number[]>([]);
  const [formStartDate, setFormStartDate] = useState(todayIso());
  const [formHasEnd, setFormHasEnd] = useState(false);
  const [formEndDate, setFormEndDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formDriverId, setFormDriverId] = useState<string | null>(null);
  const [formVehicleId, setFormVehicleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = isoDate(weekDates[0]);
  const rangeEnd = isoDate(weekDates[6]);
  const today = todayIso();

  const loadCalendar = useCallback(async () => {
    const res = await api.get<{ items: any[] }>(`/schedule/calendar?start=${rangeStart}&end=${rangeEnd}`);
    setItems(res.items);
  }, [rangeStart, rangeEnd]);
  useFocusEffect(useCallback(() => { loadCalendar(); }, [loadCalendar]));

  useEffect(() => {
    (async () => {
      const [t, d, v] = await Promise.all([
        api.get<any[]>("/route-templates?active=true"),
        api.get<any[]>("/drivers"),
        api.get<any[]>("/vehicles"),
      ]);
      setTemplates(t);
      setDrivers(d);
      setVehicles(v);
    })();
  }, []);

  const itemsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    (items || []).forEach((it) => { (map[it.date] ||= []).push(it); });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.planned_start_time || "99:99").localeCompare(b.planned_start_time || "99:99")));
    return map;
  }, [items]);

  const weekLabel = `${weekDates[0].getDate()} ${MONTHS_PT[weekDates[0].getMonth()]} – ${weekDates[6].getDate()} ${MONTHS_PT[weekDates[6].getMonth()]} ${weekDates[6].getFullYear()}`;

  const goToday = () => { setWeekStart(mondayOf(new Date())); setSelectedDayIdx(0); };
  const jumpToDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jumpDate.trim())) { toast("Data inválida — use o formato AAAA-MM-DD", "error"); return; }
    const d = new Date(jumpDate.trim() + "T00:00:00");
    if (isNaN(d.getTime())) { toast("Data inválida", "error"); return; }
    setWeekStart(mondayOf(d));
    setJumpOpen(false);
  };

  const openCreateSchedule = (prefillDate?: string) => {
    setEditingId(null);
    setFormTemplateId(templates[0]?.id || null);
    setFormRecurrence("once");
    setFormWeekdays([]);
    setFormStartDate(prefillDate || today);
    setFormHasEnd(false);
    setFormEndDate("");
    setFormTime("");
    setFormDriverId(null);
    setFormVehicleId(null);
    setFormOpen(true);
  };

  const openEditSchedule = async (scheduleId: string) => {
    setCardMenuFor(null);
    try {
      const s = await api.get<any>(`/route-schedules/${scheduleId}`);
      setEditingId(s.id);
      setFormTemplateId(s.template_id);
      setFormRecurrence(s.recurrence_type);
      setFormWeekdays(s.weekdays || []);
      setFormStartDate(s.start_date);
      setFormHasEnd(!!s.end_date);
      setFormEndDate(s.end_date || "");
      setFormTime(s.planned_start_time || "");
      setFormDriverId(s.driver_id || null);
      setFormVehicleId(s.vehicle_id || null);
      setFormOpen(true);
    } catch (e: any) {
      toast(e?.message || "Erro ao carregar agendamento", "error");
    }
  };

  const submitForm = async () => {
    if (!formTemplateId) { toast("Escolha uma rota", "error"); return; }
    if (formTime.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(formTime.trim())) { toast("Hora inválida — use o formato HH:MM", "error"); return; }
    if (formRecurrence === "weekly" && formWeekdays.length === 0) { toast("Escolha pelo menos um dia da semana", "error"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formStartDate.trim())) { toast("Data de início inválida — use o formato AAAA-MM-DD", "error"); return; }

    setSaving(true);
    try {
      const body: any = {
        template_id: formTemplateId, recurrence_type: formRecurrence,
        start_date: formStartDate.trim(), end_date: formHasEnd && formEndDate.trim() ? formEndDate.trim() : null,
        weekdays: formWeekdays, planned_start_time: formTime.trim() || null,
        driver_id: formDriverId, vehicle_id: formVehicleId,
      };
      const res = editingId
        ? await api.patch<any>(`/route-schedules/${editingId}`, body)
        : await api.post<any>(`/route-schedules`, body);
      setFormOpen(false);
      const created = res.materialized?.length || 0;
      const conflictDates = Object.keys(res.conflicts || {});
      toast(
        `${created} execução(ões) ${editingId ? "atualizada(s)" : "criada(s)"}` +
        (conflictDates.length ? ` · ${conflictDates.length} com aviso de conflito` : ""),
        conflictDates.length ? "info" : "success"
      );
      await loadCalendar();
    } catch (e: any) {
      toast(e?.message || "Erro ao guardar agendamento", "error");
    } finally {
      setSaving(false);
    }
  };

  const deactivateSchedule = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.patch(`/route-schedules/${editingId}`, { active: false });
      toast("Agendamento desativado — as execuções futuras já criadas mantêm-se", "success");
      setFormOpen(false);
      await loadCalendar();
    } catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setSaving(false); }
  };

  const cancelFutureExecutions = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.post(`/route-schedules/${editingId}/cancel-future-executions`, {});
      toast("Execuções futuras (ainda agendadas) canceladas", "success");
      setFormOpen(false);
      await loadCalendar();
    } catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setSaving(false); }
  };

  const deleteSchedule = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await api.del<{ action: string }>(`/route-schedules/${editingId}`);
      setDeleteConfirmOpen(false);
      toast(res.action === "archive" ? "Agendamento arquivado (tem execuções associadas)" : "Agendamento eliminado", "success");
      setFormOpen(false);
      await loadCalendar();
    } catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setSaving(false); }
  };

  const openCard = (item: any) => router.push(`/route/${item.id}` as any);

  const formatDatePt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };

  const openCancel = (item: any) => { setCardMenuFor(null); setCancelFor(item); };

  const confirmCancel = async () => {
    if (!cancelFor) return;
    setCancelling(true);
    const target = cancelFor;
    try {
      if (target.schedule_id) {
        const res = await api.post<{ removed_route: boolean }>(
          `/route-schedules/${target.schedule_id}/cancel-occurrence`, { date: target.date });
        toast(res.removed_route ? "Execução cancelada" : "Data excluída da recorrência", "success");
      } else {
        await api.del(`/routes/${target.id}`);
        toast("Execução cancelada", "success");
      }
      setCancelFor(null);
      await loadCalendar();
    } catch (e: any) {
      // Real history (in_progress/completed/collected work) — both backend
      // paths refuse the trivial cancel here on purpose and point back at
      // /route/{id}'s own password-gated archive flow (point 8: reuse the
      // existing safe rules rather than a second, divergent confirmation
      // dialog for the sensitive case).
      setCancelFor(null);
      toast(e?.message || "Não foi possível cancelar — abra a rota para arquivar com confirmação", "error");
      router.push(`/route/${target.id}` as any);
    } finally {
      setCancelling(false);
    }
  };

  if (!items) {
    return (<View style={styles.flex}><ScreenHeader title="AGENDA" subtitle="PLANEAMENTO SEMANAL" /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="AGENDA" subtitle="PLANEAMENTO SEMANAL"
        right={
          <Btn testID="agenda-add-button" title="+ AGENDAR ROTA" size="sm" icon="calendar" onPress={() => openCreateSchedule()} />
        }
      />

      <View style={styles.navRow}>
        <Pressable testID="agenda-prev-week" onPress={() => setWeekStart((w) => addDays(w, -7))} style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
          <Txt variant="monoBold" style={{ fontSize: 11 }}>SEMANA ANTERIOR</Txt>
        </Pressable>
        <Pressable testID="agenda-week-label" onPress={() => { setJumpDate(rangeStart); setJumpOpen(true); }} style={styles.weekLabelBtn}>
          <Txt variant="displaySm" style={{ fontSize: 14 }}>{weekLabel}</Txt>
        </Pressable>
        <Pressable testID="agenda-next-week" onPress={() => setWeekStart((w) => addDays(w, 7))} style={styles.navBtn} hitSlop={8}>
          <Txt variant="monoBold" style={{ fontSize: 11 }}>SEMANA SEGUINTE</Txt>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="agenda-today" onPress={goToday} style={styles.todayBtn}>
          <Txt variant="monoBold" style={{ fontSize: 11 }} color={colors.fccBlue}>HOJE</Txt>
        </Pressable>
      </View>

      {isDesktop ? (
        <View style={styles.grid}>
          {weekDates.map((d, i) => {
            const iso = isoDate(d);
            const dayItems = itemsByDate[iso] || [];
            const isToday = iso === today;
            return (
              <View key={iso} style={[styles.col, isToday ? styles.colToday : null]}>
                <View style={styles.colHead}>
                  <Txt variant="label" color={isToday ? colors.fccBlue : colors.muted}>{WEEKDAY_LABELS[i]}</Txt>
                  <Txt variant="monoBold" style={{ fontSize: 13 }} color={isToday ? colors.fccBlue : colors.onSurface}>{d.getDate()}</Txt>
                </View>
                <ScrollView contentContainerStyle={styles.colBody}>
                  {dayItems.length === 0 ? (
                    <Txt variant="label" color={colors.muted} style={{ textAlign: "center", marginTop: spacing.md }}>Sem rotas</Txt>
                  ) : dayItems.map((it) => (
                    <AgendaCard key={it.id} item={it} onPress={() => setCardMenuFor(it)} />
                  ))}
                  <Pressable testID={`agenda-add-day-${iso}`} onPress={() => openCreateSchedule(iso)} style={styles.addDayBtn}>
                    <Ionicons name="add" size={14} color={colors.fccBlue} />
                    <Txt variant="label" color={colors.fccBlue}>AGENDAR</Txt>
                  </Pressable>
                </ScrollView>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.flex}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayTabs}>
            {weekDates.map((d, i) => {
              const iso = isoDate(d);
              const isToday = iso === today;
              const on = selectedDayIdx === i;
              const count = (itemsByDate[iso] || []).length;
              return (
                <Pressable key={iso} testID={`agenda-day-tab-${iso}`} onPress={() => setSelectedDayIdx(i)}
                          style={[styles.dayTab, on ? styles.dayTabOn : null]}>
                  <Txt variant="label" color={on ? colors.onSurfaceInverse : (isToday ? colors.fccBlue : colors.muted)}>{WEEKDAY_LABELS[i]}</Txt>
                  <Txt variant="monoBold" style={{ fontSize: 15 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{d.getDate()}</Txt>
                  {count > 0 && <View style={[styles.countDot, on ? { backgroundColor: "#fff" } : null]}><Txt variant="monoBold" style={{ fontSize: 9 }} color={on ? colors.fccBlue : "#fff"}>{count}</Txt></View>}
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.scroll}>
            {(itemsByDate[isoDate(weekDates[selectedDayIdx])] || []).length === 0 ? (
              <Empty text="Sem rotas agendadas para este dia." icon="calendar-outline" />
            ) : (itemsByDate[isoDate(weekDates[selectedDayIdx])] || []).map((it) => (
              <AgendaCard key={it.id} item={it} wide onPress={() => setCardMenuFor(it)} />
            ))}
            <Btn testID="agenda-add-day-mobile" title="AGENDAR ROTA PARA ESTE DIA" variant="outline" icon="add"
                 onPress={() => openCreateSchedule(isoDate(weekDates[selectedDayIdx]))} />
          </ScrollView>
        </View>
      )}

      <ActionMenu
        visible={!!cardMenuFor} onClose={() => setCardMenuFor(null)}
        title={cardMenuFor ? `${cardMenuFor.code || cardMenuFor.template_name || "EXECUÇÃO"} · ${formatDatePt(cardMenuFor.date)}` : ""}
        items={cardMenuFor ? [
          { label: "Editar esta execução", icon: "create-outline", onPress: () => openCard(cardMenuFor), testID: "agenda-menu-edit-execution" },
          { label: "Cancelar esta execução", icon: "close-circle-outline", destructive: true,
            onPress: () => openCancel(cardMenuFor), testID: "agenda-menu-cancel-execution" },
          ...(cardMenuFor.schedule_id ? [{
            label: "Editar recorrência", icon: "repeat" as const,
            onPress: () => openEditSchedule(cardMenuFor.schedule_id), testID: "agenda-menu-edit-recurrence",
          }] : []),
        ] : []}
      />

      <ConfirmModal
        visible={!!cancelFor} title="Cancelar esta execução?"
        message={cancelFor
          ? (cancelFor.schedule_id
              ? `Esta ação cancela apenas a execução de ${formatDatePt(cancelFor.date)}. A recorrência continua nas próximas datas.`
              : `A execução ${cancelFor.code || ""} de ${formatDatePt(cancelFor.date)} vai ser cancelada.`)
          : undefined}
        destructive confirmLabel="CANCELAR EXECUÇÃO" cancelLabel="VOLTAR" loading={cancelling}
        onConfirm={confirmCancel} onCancel={() => setCancelFor(null)}
      />

      <Modal visible={jumpOpen} transparent animationType="fade" onRequestClose={() => setJumpOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setJumpOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">IR PARA DATA</Txt>
            <TextInput testID="agenda-jump-input" style={styles.input} value={jumpDate} onChangeText={setJumpDate}
                      placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} maxLength={10} />
            <Btn testID="agenda-jump-confirm" title="IR" onPress={jumpToDate} style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFormOpen(false)}>
          <Pressable style={[styles.sheet, { maxHeight: "88%", paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">{editingId ? "EDITAR AGENDAMENTO" : "AGENDAR ROTA"}</Txt>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              <Txt variant="label">ROTA (TEMPLATE)</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {templates.map((t) => {
                  const on = formTemplateId === t.id;
                  return (
                    <Pressable key={t.id} testID={`agenda-form-template-${t.id}`} onPress={() => setFormTemplateId(t.id)}
                              style={[styles.chip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{t.name}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Txt variant="label" style={{ marginTop: spacing.sm }}>RECORRÊNCIA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {RECURRENCE_OPTIONS.map((o) => {
                  const on = formRecurrence === o.value;
                  return (
                    <Pressable key={o.value} testID={`agenda-form-recurrence-${o.value}`} onPress={() => setFormRecurrence(o.value)}
                              style={[styles.chip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{o.label}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {formRecurrence === "weekly" && (
                <>
                  <Txt variant="label" style={{ marginTop: spacing.sm }}>DIAS DA SEMANA</Txt>
                  <View style={styles.chipRow}>
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const on = formWeekdays.includes(idx);
                      return (
                        <Pressable key={idx} testID={`agenda-form-weekday-${idx}`}
                                  onPress={() => setFormWeekdays((s) => on ? s.filter((x) => x !== idx) : [...s, idx].sort())}
                                  style={[styles.chip, on ? styles.chipOn : null]}>
                          <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{label}</Txt>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Txt variant="label" style={{ marginTop: spacing.sm }}>{formRecurrence === "once" ? "DATA" : "INÍCIO DA RECORRÊNCIA"}</Txt>
              <TextInput testID="agenda-form-start-date" style={styles.input} value={formStartDate} onChangeText={setFormStartDate}
                        placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} maxLength={10} />

              {formRecurrence !== "once" && (
                <>
                  <View style={styles.formHeadRow}>
                    <Txt variant="label">FIM (OPCIONAL)</Txt>
                    <Pressable testID="agenda-form-toggle-end" onPress={() => setFormHasEnd((v) => !v)}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={colors.fccBlue}>{formHasEnd ? "SEM FIM" : "DEFINIR FIM"}</Txt>
                    </Pressable>
                  </View>
                  {formHasEnd && (
                    <TextInput testID="agenda-form-end-date" style={styles.input} value={formEndDate} onChangeText={setFormEndDate}
                              placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} maxLength={10} />
                  )}
                </>
              )}

              <Txt variant="label" style={{ marginTop: spacing.sm }}>HORA PREVISTA (OPCIONAL)</Txt>
              <TextInput testID="agenda-form-time" style={styles.input} value={formTime} onChangeText={setFormTime}
                        placeholder="Ex: 06:00" placeholderTextColor={colors.muted} maxLength={5} />

              <Txt variant="label" style={{ marginTop: spacing.sm }}>MOTORISTA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <Pressable testID="agenda-form-driver-none" onPress={() => setFormDriverId(null)} style={[styles.chip, !formDriverId ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!formDriverId ? colors.onSurfaceInverse : colors.onSurface}>SEM MOTORISTA</Txt>
                </Pressable>
                {drivers.map((d) => {
                  const on = formDriverId === d.id;
                  return (
                    <Pressable key={d.id} testID={`agenda-form-driver-${d.id}`} onPress={() => setFormDriverId(d.id)} style={[styles.chip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{d.name}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Txt variant="label" style={{ marginTop: spacing.sm }}>VIATURA</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <Pressable testID="agenda-form-vehicle-none" onPress={() => setFormVehicleId(null)} style={[styles.chip, !formVehicleId ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={!formVehicleId ? colors.onSurfaceInverse : colors.onSurface}>SEM VIATURA</Txt>
                </Pressable>
                {vehicles.map((v) => {
                  const on = formVehicleId === v.id;
                  return (
                    <Pressable key={v.id} testID={`agenda-form-vehicle-${v.id}`} onPress={() => setFormVehicleId(v.id)} style={[styles.chip, on ? styles.chipOn : null]}>
                      <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{v.plate}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Btn testID="agenda-form-submit" title={editingId ? "GUARDAR AGENDAMENTO" : "CRIAR AGENDAMENTO"} icon="calendar" size="lg"
                   loading={saving} onPress={submitForm} style={{ marginTop: spacing.md }} />

              {editingId && (
                <View style={styles.editActions}>
                  <Pressable testID="agenda-form-deactivate" disabled={saving} onPress={deactivateSchedule} style={styles.editActionBtn}>
                    <Ionicons name="pause-circle-outline" size={16} color={colors.onSurface} />
                    <Txt variant="monoBold" style={{ fontSize: 12 }}>DESATIVAR REGRA</Txt>
                  </Pressable>
                  <Pressable testID="agenda-form-cancel-future" disabled={saving} onPress={cancelFutureExecutions} style={styles.editActionBtn}>
                    <Ionicons name="close-circle-outline" size={16} color={colors.warning} />
                    <Txt variant="monoBold" style={{ fontSize: 12 }} color={colors.warning}>CANCELAR FUTURAS</Txt>
                  </Pressable>
                  <Pressable testID="agenda-form-delete" disabled={saving} onPress={() => setDeleteConfirmOpen(true)} style={styles.editActionBtn}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Txt variant="monoBold" style={{ fontSize: 12 }} color={colors.error}>ELIMINAR</Txt>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={deleteConfirmOpen} title="Eliminar este agendamento?" destructive
        message="Se já tiver execuções associadas, fica arquivado em vez de eliminado. O histórico nunca é apagado."
        confirmLabel="ELIMINAR" loading={saving}
        onConfirm={deleteSchedule} onCancel={() => setDeleteConfirmOpen(false)}
      />
    </View>
  );
}

function AgendaCard({ item, onPress, wide }: { item: any; onPress: () => void; wide?: boolean }) {
  const st = routeStatus[item.status] || routeStatus.scheduled;
  return (
    <Pressable testID={`agenda-card-${item.id}`} onPress={onPress} style={[styles.card, wide ? styles.cardWide : null]}>
      <View style={styles.cardTop}>
        <View style={styles.cardTime}>
          <Ionicons name="time-outline" size={12} color={colors.muted} />
          <Txt variant="monoBold" style={{ fontSize: 12 }}>{item.planned_start_time || "—"}</Txt>
        </View>
        {item.schedule_id && (
          <View testID={`agenda-recurrent-${item.id}`}>
            <Ionicons name="repeat" size={14} color={colors.fccBlue} />
          </View>
        )}
      </View>
      <Txt variant="monoBold" numberOfLines={1} style={{ fontSize: 13 }}>{item.template_name || item.code}</Txt>
      <View style={styles.cardMetaRow}>
        <Ionicons name="people" size={11} color={colors.muted} />
        <Txt variant="mono" style={{ fontSize: 11 }} color={colors.muted} numberOfLines={1}>{item.driver_name || "Sem motorista"}</Txt>
      </View>
      <View style={styles.cardMetaRow}>
        <Ionicons name="bus" size={11} color={colors.muted} />
        <Txt variant="mono" style={{ fontSize: 11 }} color={colors.muted} numberOfLines={1}>{item.vehicle_plate || "Sem viatura"}</Txt>
      </View>
      <View style={[styles.stTag, { backgroundColor: st.color }]}>
        <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>{st.label}</Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  weekLabelBtn: { flex: 1, alignItems: "center" },
  todayBtn: { borderWidth: border.width, borderColor: colors.fccBlue, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },

  grid: { flex: 1, flexDirection: "row", paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs },
  col: { flex: 1, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: "hidden" },
  colToday: { borderColor: colors.fccBlue, borderWidth: 1.5 },
  colHead: { alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: border.width, borderBottomColor: colors.border },
  colBody: { padding: spacing.xs, gap: spacing.xs, flexGrow: 1 },
  addDayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.sm },

  dayTabs: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  dayTab: { alignItems: "center", gap: 2, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 56, backgroundColor: colors.surface },
  dayTabOn: { backgroundColor: colors.fccBlue, borderColor: colors.fccBlue },
  countDot: { position: "absolute", top: -4, right: -4, backgroundColor: colors.fccBlue, borderRadius: radius.pill, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },

  card: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.bg, padding: spacing.sm, gap: 3 },
  cardWide: { backgroundColor: colors.surface },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTime: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  stTag: { alignSelf: "flex-start", borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg, marginTop: spacing.xs,
  },
  chipRow: { gap: spacing.sm, paddingVertical: 2, flexWrap: "wrap" },
  chip: {
    height: 34, justifyContent: "center", paddingHorizontal: spacing.md,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.fccBlue, borderColor: colors.fccBlue },
  formHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  editActions: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg, borderTopWidth: border.width, borderTopColor: colors.border, paddingTop: spacing.md },
  editActionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
});
