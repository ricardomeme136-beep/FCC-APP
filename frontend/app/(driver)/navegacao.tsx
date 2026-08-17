import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { watchPosition, LocationError, PositionUpdate } from "@/src/utils/location";
import { distanceAlongRoute } from "@/src/utils/geo";
import { Badge, Btn, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, radius, border, shadows, wasteLabels, taskStatus } from "@/src/theme";

const TODAY = new Date().toISOString().slice(0, 10);
const AVG_SPEED_KMH = 28; // matches backend/services/optimizer.py — used only if a leg has no ORS duration yet
const GEOFENCE_MAX_M = 120; // mirrors backend/routers/tasks.py — never claim "chegou" beyond what the backend would accept
const OFF_ROUTE_THRESHOLD_M = 70; // perpendicular distance from the leg polyline that counts as "off route"
const RECALC_COOLDOWN_MS = 25000; // floor between recalculations, however many times a deviation is detected
const PENDING_STATUSES = ["scheduled", "en_route", "arrived"];
const FAIL_REASONS = [
  "Acesso bloqueado", "Contentor desaparecido", "Contentor danificado",
  "Estrada bloqueada", "Localização insegura", "Contentor cheio",
  "Contentor errado", "Avaria do veículo", "Problema com o cliente", "Outro",
];

function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function maneuverIcon(text: string): keyof typeof Ionicons.glyphMap {
  const t = (text || "").toLowerCase();
  if (t.includes("destino") || t.includes("chegou")) return "flag";
  if (t.includes("rotunda")) return "sync";
  if (t.includes("esquerda")) return "arrow-back";
  if (t.includes("direita")) return "arrow-forward";
  if (t.includes("frente") || t.includes("continue")) return "arrow-up";
  return "navigate";
}

export default function Navegacao() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [tasks, setTasks] = useState<any[] | null>(null);
  const [route, setRoute] = useState<any | null>(null);
  const [fullGeo, setFullGeo] = useState<any | null>(null);
  const [legGeo, setLegGeo] = useState<any | null>(null);
  const [containersById, setContainersById] = useState<Record<string, any>>({});
  const [position, setPosition] = useState<PositionUpdate | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopPanelOpen, setStopPanelOpen] = useState(false);
  const [failFor, setFailFor] = useState<any | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deviated, setDeviated] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const watchRef = useRef<{ remove: () => void } | null>(null);
  const legForStopId = useRef<string | null>(null);
  const stepProgressRef = useRef(0); // highest step index reached for the current leg — never regresses (GPS jitter shouldn't un-consume an instruction)
  const autoOpenedForStop = useRef<string | null>(null);
  const offRouteStreak = useRef(0); // consecutive off-route reads — 1 noisy GPS blip shouldn't trigger a deviation
  const lastRecalcAt = useRef(0);

  const load = useCallback(async () => {
    const t = await api.get<any[]>(`/collection-tasks?mine=true&date=${TODAY}`);
    setTasks(t);
    const rid = t[0]?.route_id;
    if (rid) {
      const r = await api.get<any>(`/routes/${rid}`);
      setRoute(r);
      api.get<any>(`/routes/${rid}/geometry`).then(setFullGeo).catch(() => {});
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    api.get<any[]>("/containers?limit=2000")
      .then((list) => setContainersById(Object.fromEntries(list.map((c) => [c.id, c]))))
      .catch(() => {});
  }, []);

  // Continuous GPS while this screen is open — never on for any other screen.
  useEffect(() => {
    let cancelled = false;
    watchPosition(
      (pos) => { if (!cancelled) { setPosition(pos); setLocError(null); } },
      (err: LocationError) => { if (!cancelled) setLocError(err.message); }
    ).then((sub) => { if (!cancelled) watchRef.current = sub; else sub.remove(); });
    return () => { cancelled = true; watchRef.current?.remove(); watchRef.current = null; };
  }, []);

  const refreshRoute = useCallback(async () => {
    if (!route?.id) return;
    const r = await api.get<any>(`/routes/${route.id}`);
    setRoute(r);
  }, [route?.id]);

  const stops: any[] = route?.stops || [];
  const currentStop = useMemo(
    () => stops.find((s) => (s.tasks || []).some((t: any) => PENDING_STATUSES.includes(t.status))),
    [stops]
  );
  const stopIndex = currentStop ? stops.indexOf(currentStop) : -1;
  const pendingTasks = (currentStop?.tasks || []).filter((t: any) => PENDING_STATUSES.includes(t.status));

  // Road geometry for the CURRENT leg (live position -> next stop) — fetched
  // once when the leg starts and again only if the target stop changes, not
  // on every GPS tick (keeps ORS usage low).
  useEffect(() => {
    if (!position || !currentStop) return;
    if (legForStopId.current === currentStop.id) return;
    legForStopId.current = currentStop.id;
    stepProgressRef.current = 0;
    offRouteStreak.current = 0;
    setDeviated(false);
    api.post<any>("/routes/navigate", {
      from_lat: position.lat, from_lng: position.lng,
      to_lat: currentStop.lat, to_lng: currentStop.lng,
    }).then(setLegGeo).catch(() => {});
  }, [position, currentStop]);

  const { remainingKm, offRouteKm } = useMemo(() => {
    if (!position || !legGeo?.coordinates?.length) return { remainingKm: null as number | null, offRouteKm: null as number | null };
    const d = distanceAlongRoute(position, legGeo.coordinates);
    return { remainingKm: d.remainingKm, offRouteKm: d.offRouteKm };
  }, [position, legGeo]);

  const etaMin = useMemo(() => {
    if (remainingKm == null) return null;
    if (legGeo?.distance_m && legGeo?.duration_s) {
      const totalKm = legGeo.distance_m / 1000;
      const frac = totalKm > 0 ? Math.min(1, remainingKm / totalKm) : 0;
      return Math.max(0, Math.round((legGeo.duration_s * frac) / 60));
    }
    return Math.max(0, Math.round((remainingKm / AVG_SPEED_KMH) * 60));
  }, [remainingKm, legGeo]);

  // Turn-by-turn: the backend already returns ORS `steps` per leg (text,
  // distance_m, name) — consumed here purely client-side by comparing
  // distance travelled so far against each step's length, so advancing
  // through instructions costs zero extra requests to OpenRouteService.
  const stepInfo = useMemo(() => {
    const steps: any[] = legGeo?.steps || [];
    if (!steps.length || remainingKm == null || !legGeo?.distance_m) return null;
    const traveledM = Math.max(0, legGeo.distance_m - remainingKm * 1000);

    let cum = 0;
    let idx = steps.length - 1;
    for (let i = 0; i < steps.length; i++) {
      const stepEnd = cum + (steps[i].distance_m || 0);
      if (traveledM < stepEnd) { idx = i; break; }
      cum = stepEnd;
    }
    idx = Math.max(idx, stepProgressRef.current);
    stepProgressRef.current = idx;

    let cumUpToIdx = 0;
    for (let i = 0; i < idx; i++) cumUpToIdx += steps[i].distance_m || 0;
    const distanceToManeuverM = Math.max(0, cumUpToIdx + (steps[idx].distance_m || 0) - traveledM);
    return { step: steps[idx], distanceToManeuverM, index: idx, total: steps.length };
  }, [legGeo, remainingKm]);

  const arrived = remainingKm != null && remainingKm * 1000 <= GEOFENCE_MAX_M;

  // Off-route detection: perpendicular distance from the leg polyline, 2
  // consecutive reads over the threshold (not 1 — avoids a single GPS
  // glitch flagging a deviation that isn't real). Suppressed once arrived,
  // where "off route" from the final approach line is expected and normal.
  useEffect(() => {
    if (arrived || offRouteKm == null) { offRouteStreak.current = 0; setDeviated(false); return; }
    if (offRouteKm * 1000 > OFF_ROUTE_THRESHOLD_M) {
      offRouteStreak.current += 1;
      if (offRouteStreak.current >= 2) setDeviated(true);
    } else {
      offRouteStreak.current = 0;
      setDeviated(false);
    }
  }, [offRouteKm, arrived]);

  const recalculate = async () => {
    if (!position || !currentStop) return;
    const now = Date.now();
    if (now - lastRecalcAt.current < RECALC_COOLDOWN_MS) {
      toast("Aguarde um momento antes de recalcular outra vez", "info");
      return;
    }
    lastRecalcAt.current = now;
    setRecalculating(true);
    try {
      const geo = await api.post<any>("/routes/navigate", {
        from_lat: position.lat, from_lng: position.lng,
        to_lat: currentStop.lat, to_lng: currentStop.lng,
      });
      setLegGeo(geo);
      stepProgressRef.current = 0;
      offRouteStreak.current = 0;
      setDeviated(false);
      toast("Rota recalculada", "success");
    } catch (e: any) {
      toast(e?.message || "Não foi possível recalcular", "error");
    } finally {
      setRecalculating(false);
    }
  };

  // Close the container panel whenever the target stop changes (moving on
  // to stop B shouldn't leave stop A's panel open), then auto-open it once
  // per stop as soon as the driver is actually within range — point 7/8:
  // the driver never has to go looking for it.
  useEffect(() => { setStopPanelOpen(false); }, [currentStop?.id]);
  useEffect(() => {
    if (arrived && currentStop && autoOpenedForStop.current !== currentStop.id) {
      autoOpenedForStop.current = currentStop.id;
      setStopPanelOpen(true);
    }
  }, [arrived, currentStop]);

  const act = async (fn: () => Promise<any>, msg?: string) => {
    setActionBusy(true);
    try { await fn(); if (msg) toast(msg, "success"); await refreshRoute(); }
    catch (e: any) { toast(e?.message || "Erro", "error"); }
    finally { setActionBusy(false); }
  };
  const gpsPayload = position ? { lat: position.lat, lng: position.lng } : {};
  const completeTask = (taskId: string) => act(() => api.post(`/collection-tasks/${taskId}/complete`, gpsPayload), "Recolha registada");
  const ignoreTask = (taskId: string) => act(() => api.post(`/collection-tasks/${taskId}/ignore`), "Recolha ignorada");
  const failTask = (reason: string) => {
    const taskId = failFor?.id;
    setFailFor(null);
    if (taskId) act(() => api.post(`/collection-tasks/${taskId}/fail`, { reason, ...gpsPayload }), "Problema comunicado");
  };
  const completeAll = () => act(async () => {
    for (const t of pendingTasks) {
      await api.post(`/collection-tasks/${t.id}/complete`, gpsPayload);
    }
  }, "Recolhas registadas");

  const finishRoute = async () => {
    if (!route?.id) return;
    setFinishing(true);
    try {
      const gps = position ? { lat: position.lat, lng: position.lng } : {};
      await api.post(`/routes/${route.id}/finish`, gps);
      watchRef.current?.remove();
      toast("Rota finalizada", "success");
      router.replace("/(driver)/rota");
    } catch (e: any) {
      toast(e?.message || "Erro ao finalizar a rota", "error");
    } finally {
      setFinishing(false);
    }
  };

  const exit = () => { watchRef.current?.remove(); router.back(); };
  const openExternal = () => {
    setMenuOpen(false);
    if (!currentStop) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${currentStop.lat},${currentStop.lng}`;
    Linking.openURL(url).catch(() => toast("Não foi possível abrir a aplicação externa", "error"));
  };

  if (!tasks) {
    return (<View style={styles.flex}><Loading text="A PREPARAR NAVEGAÇÃO..." /></View>);
  }
  if (!route || !currentStop) {
    const canFinish = route?.status === "in_progress";
    return (
      <View style={[styles.flex, styles.center]}>
        <Ionicons name="checkmark-done-circle" size={64} color={colors.success} />
        <Txt variant="displaySm" style={{ textAlign: "center" }}>
          {canFinish ? "Todas as paragens foram tratadas" : "Sem paragens pendentes"}
        </Txt>
        {canFinish ? (
          <Btn testID="nav-finish-route" title="FINALIZAR ROTA" icon="flag" size="xl" variant="success"
            loading={finishing} onPress={finishRoute} style={{ marginTop: spacing.lg }} />
        ) : (
          <Btn title="VOLTAR" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
        )}
      </View>
    );
  }

  const truckMarker = position ? [{
    id: "truck", lat: position.lat, lng: position.lng, color: colors.onSurface,
    heading: position.heading != null && position.heading >= 0 ? position.heading : undefined,
  }] : [];
  const stopMarkers = stops
    .filter((s) => s.id !== currentStop.id)
    .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, color: colors.muted, kind: "container" as const }));
  const nextMarker = { id: currentStop.id + "-active", lat: currentStop.lat, lng: currentStop.lng, color: colors.brand, kind: "next" as const };

  const polylines = [
    ...(fullGeo?.coordinates?.length ? [{ coordinates: fullGeo.coordinates, color: colors.muted, width: 2 }] : []),
    ...(legGeo?.coordinates?.length ? [{ coordinates: legGeo.coordinates, color: colors.brand, width: 6 }] : []),
  ];

  return (
    <View style={styles.flex}>
      <FleetMap
        markers={[...truckMarker, nextMarker, ...stopMarkers]}
        polylines={polylines}
        followMarkerId={position ? "truck" : undefined}
        style={StyleSheet.absoluteFillObject as any}
      />

      <View style={[styles.topBar, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable testID="nav-exit" onPress={exit} style={styles.roundBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="nav-menu" onPress={() => setMenuOpen(true)} style={styles.roundBtn}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {!arrived && deviated && (
        <View testID="nav-deviated" style={[styles.instructionBar, { top: insets.top + spacing.sm + 52, backgroundColor: colors.warning }]}>
          <Ionicons name="alert-circle" size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Txt variant="displaySm" color="#fff" style={{ fontSize: 16 }}>DESVIO DA ROTA</Txt>
            <Txt variant="mono" color="#fff" style={{ fontSize: 12 }}>Já não está na rota planeada</Txt>
          </View>
          <Pressable testID="nav-recalculate" onPress={recalculate} disabled={recalculating} style={styles.recalcBtn}>
            {recalculating
              ? <Txt variant="monoBold" style={{ fontSize: 12 }}>...</Txt>
              : <Txt variant="monoBold" style={{ fontSize: 12 }}>RECALCULAR</Txt>}
          </Pressable>
        </View>
      )}

      {!arrived && !deviated && stepInfo && (
        <View testID="nav-instruction" style={[styles.instructionBar, { top: insets.top + spacing.sm + 52 }]}>
          <Ionicons name={maneuverIcon(stepInfo.step.text)} size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Txt variant="displaySm" color="#fff" numberOfLines={2} style={{ fontSize: 18 }}>
              {stepInfo.step.text || "Siga em frente"}
            </Txt>
            <Txt variant="monoBold" color="#D1D5DB">{formatDistance(stepInfo.distanceToManeuverM)}</Txt>
          </View>
        </View>
      )}

      {locError && (
        <View style={[styles.warnBanner, { top: insets.top + spacing.sm + 52 + (!arrived && (stepInfo || deviated) ? 84 : 0) }]}>
          <Ionicons name="warning" size={16} color="#fff" />
          <Txt variant="mono" color="#fff" style={{ flex: 1, fontSize: 12 }}>{locError}</Txt>
        </View>
      )}

      <View style={[styles.bottomCard, { paddingBottom: insets.bottom + spacing.md }]}>
        {arrived ? (
          <>
            <View style={styles.arrivedRow}>
              <Ionicons name="location" size={20} color={colors.success} />
              <Txt variant="label" color={colors.success}>CHEGOU À PARAGEM</Txt>
            </View>
            <Txt variant="displaySm" numberOfLines={1}>{currentStop.address || "Localização definida no mapa"}</Txt>
            <Btn testID="nav-view-stop" title="VER CONTENTORES" icon="cube" size="lg" onPress={() => setStopPanelOpen(true)} style={{ marginTop: spacing.xs }} />
          </>
        ) : (
          <>
            <Txt variant="label">PRÓXIMA PARAGEM · {stopIndex + 1} DE {stops.length}</Txt>
            <Txt variant="displaySm" numberOfLines={1}>{currentStop.address || "Localização definida no mapa"}</Txt>
            <View style={styles.statsRow}>
              <Stat icon="navigate" value={remainingKm != null ? `${remainingKm < 1 ? Math.round(remainingKm * 1000) + "m" : remainingKm.toFixed(1) + "km"}` : "—"} label="DISTÂNCIA" />
              <Stat icon="time" value={etaMin != null ? `${etaMin} min` : "—"} label="ETA" />
              <Stat icon="cube" value={String(pendingTasks.length)} label="CONTENTORES" />
            </View>
            {pendingTasks.length > 0 && (
              <Txt variant="mono" color={colors.muted} numberOfLines={1}>
                {pendingTasks.map((t: any) => wasteLabels[t.waste_type] || t.waste_type).join(", ")}
              </Txt>
            )}
          </>
        )}
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">OPÇÕES</Txt>
            <Pressable testID="nav-open-external" style={styles.menuRow} onPress={openExternal}>
              <Ionicons name="open-outline" size={18} color={colors.onSurface} />
              <Txt variant="monoBold">Abrir em aplicação externa</Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={stopPanelOpen} animationType="slide" onRequestClose={() => setStopPanelOpen(false)}>
        <View style={[styles.flex, { paddingTop: insets.top }]}>
          <View style={styles.panelHeader}>
            <View style={{ flex: 1 }}>
              <Txt variant="label">PARAGEM {stopIndex + 1} DE {stops.length}</Txt>
              <Txt variant="displaySm" numberOfLines={2}>{currentStop.address || "Localização definida no mapa"}</Txt>
            </View>
            <Pressable testID="close-stop-panel" onPress={() => setStopPanelOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.panelScroll, { paddingBottom: insets.bottom + spacing.lg }]}>
            {pendingTasks.length > 1 && (
              <Btn testID="nav-collect-all" title="RECOLHER TODOS" icon="checkmark-done" variant="success" loading={actionBusy} onPress={completeAll} />
            )}
            {(currentStop.tasks || []).map((t: any) => {
              const c = containersById[t.container_id];
              const st = taskStatus[t.status] || taskStatus.scheduled;
              const isPending = PENDING_STATUSES.includes(t.status);
              return (
                <View key={t.id} style={styles.taskCard} testID={`nav-task-${t.id}`}>
                  {c?.photo_url ? <Image source={{ uri: c.photo_url }} style={styles.taskPhoto} contentFit="cover" /> : null}
                  <View style={styles.taskHead}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="monoBold">{c?.qr_code || `#${t.container_id.slice(0, 8).toUpperCase()}`}</Txt>
                      <Txt variant="mono" color={colors.muted}>{wasteLabels[t.waste_type] || t.waste_type}</Txt>
                      {c?.notes ? <Txt variant="label" numberOfLines={2}>{c.notes}</Txt> : null}
                    </View>
                    <Badge label={st.label} color={st.color} />
                  </View>
                  {isPending && (
                    <View style={styles.taskActions}>
                      <Pressable testID={`nav-complete-${t.id}`} disabled={actionBusy} onPress={() => completeTask(t.id)} style={[styles.taskActionBtn, { backgroundColor: colors.success }]}>
                        <Ionicons name="checkmark" size={20} color="#fff" />
                        <Txt variant="monoBold" color="#fff" style={{ fontSize: 11 }}>RECOLHIDO</Txt>
                      </Pressable>
                      <Pressable testID={`nav-fail-${t.id}`} disabled={actionBusy} onPress={() => setFailFor(t)} style={[styles.taskActionBtn, { backgroundColor: colors.error }]}>
                        <Ionicons name="warning" size={20} color="#fff" />
                        <Txt variant="monoBold" color="#fff" style={{ fontSize: 11 }}>PROBLEMA</Txt>
                      </Pressable>
                      <Pressable testID={`nav-ignore-${t.id}`} disabled={actionBusy} onPress={() => ignoreTask(t.id)} style={[styles.taskActionBtn, { backgroundColor: colors.surfaceSecondary }]}>
                        <Ionicons name="play-skip-forward" size={20} color={colors.onSurface} />
                        <Txt variant="monoBold" style={{ fontSize: 11 }}>IGNORAR</Txt>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!failFor} transparent animationType="slide" onRequestClose={() => setFailFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setFailFor(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">MOTIVO DO PROBLEMA</Txt>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
              {FAIL_REASONS.map((r) => (
                <Pressable key={r} testID={`nav-fail-reason-${r}`} style={styles.menuRow} onPress={() => failTask(r)}>
                  <Txt variant="monoBold">{r}</Txt>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({ icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <View style={styles.statCell}>
      <Ionicons name={icon} size={16} color={colors.brand} />
      <Txt variant="monoBold" style={{ fontSize: 16 }}>{value}</Txt>
      <Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  topBar: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", justifyContent: "space-between" },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", ...(shadows.float as object),
  },
  instructionBar: {
    position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.onSurface, borderRadius: radius.lg, padding: spacing.md, ...(shadows.float as object),
  },
  recalcBtn: {
    backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  warnBanner: {
    position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.error, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  bottomCard: {
    position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, gap: spacing.xs, ...(shadows.float as object),
  },
  arrivedRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statsRow: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: border.width, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.sm },
  statCell: { alignItems: "center", gap: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  menuRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  panelHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.lg, borderBottomWidth: border.width, borderBottomColor: colors.border },
  panelScroll: { padding: spacing.lg, gap: spacing.md },
  taskCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  taskPhoto: { width: "100%", height: 140, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  taskHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  taskActions: { flexDirection: "row", gap: spacing.sm },
  taskActionBtn: { flex: 1, height: 56, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 2 },
});
