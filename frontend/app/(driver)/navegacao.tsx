import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { watchPosition, watchDeviceHeading, LocationError, PositionUpdate, HeadingUpdate } from "@/src/utils/location";
import { markRouteFinished } from "@/src/tracking/activeContext";
import { distanceAlongRoute } from "@/src/utils/geo";
import { getManeuverPresentation } from "@/src/utils/maneuvers";
import { fuseHeading, smoothHeading, pickCompassHeading } from "@/src/utils/heading";
import { Badge, Btn, Loading, Txt, useToast } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, radius, border, shadows, wasteLabels, taskStatus } from "@/src/theme";

const TODAY = new Date().toISOString().slice(0, 10);
const AVG_SPEED_KMH = 28; // matches backend/services/optimizer.py — used only if a leg has no ORS duration yet
const GEOFENCE_MAX_M = 120; // mirrors backend/routers/tasks.py — never claim "chegou" beyond what the backend would accept
const OFF_ROUTE_THRESHOLD_M = 70; // perpendicular distance from the leg polyline that counts as "off route"
const RECALC_COOLDOWN_MS = 25000; // floor between recalculations, however many times a deviation is detected
const LEG_CACHE_TTL_MS = 20000; // reuse a recent leg fetch instead of re-hitting ORS for a near-identical position
// Single centralized estimate — someone still has to get out and empty the
// container, driving time alone isn't the whole job. Per-waste-type values
// (vidro=5, papel=3, ...) are a documented future step, not built now — every
// ETA calc below reads only this one constant, so that's a one-line change.
const DEFAULT_CONTAINER_SERVICE_MIN = 4;
const MANEUVER_IMMINENT_M = 20; // below this, show "AGORA" instead of a distance number
// Compass events can fire many times a second — recomputing the fused/
// smoothed heading on a fixed ticker (instead of once per raw event) is the
// simplest way to keep the marker responsive without a re-render storm.
const HEADING_TICK_MS = 150;
const HEADING_SMOOTH_ALPHA = 0.35;
const PENDING_STATUSES = ["scheduled", "en_route", "arrived"];
const FAIL_REASONS = [
  "Acesso bloqueado", "Contentor desaparecido", "Contentor danificado",
  "Estrada bloqueada", "Localização insegura", "Contentor cheio",
  "Contentor errado", "Avaria do veículo", "Problema com o cliente", "Outro",
];
const GENERAL_PROBLEM_REASONS: { label: string; kind: string }[] = [
  { label: "Avaria do veículo", kind: "vehicle_breakdown" },
  { label: "Acidente de trânsito", kind: "other" },
  { label: "Estrada intransitável", kind: "other" },
  { label: "Outro", kind: "other" },
];

// Bottom panel heights — collapsed/half are fixed, expanded scales with the
// screen (capped) so a stop with many containers still gets real room.
// Collapsed is a fixed size (not proportional — the content it shows is a
// constant amount of text regardless of screen size). Half/expanded scale
// with the real window height (useWindowDimensions, inside the component)
// so a short Android phone never gets an oversized panel that swallows the
// map, and a tall one still gets a usably large expanded view.
const PANEL_COLLAPSED_H = 150;
const PANEL_ANIM_MS = 220;

type PanelState = "collapsed" | "half" | "expanded";

function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// "1h14" once past an hour, otherwise "42 min" — used for the operational
// ETAs (driving + service), never for the raw per-leg driving-only distance.
function formatEtaLong(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// ~55m buckets — coarse enough to absorb GPS jitter between reads, fine
// enough that real movement still busts the cache and triggers a fresh fetch.
function roundCoord(n: number): number {
  return Math.round(n * 2000) / 2000;
}

function stopTaskSummary(stop: any): { label: string; color: string } {
  const tasks: any[] = stop.tasks || [];
  if (tasks.length === 0) return { label: "SEM CONTENTORES", color: colors.muted };
  if (tasks.some((t) => PENDING_STATUSES.includes(t.status))) return { label: "PENDENTE", color: colors.info };
  if (tasks.some((t) => t.status === "failed")) return { label: "COM PROBLEMAS", color: colors.warning };
  return { label: "CONCLUÍDA", color: colors.success };
}

export default function Navegacao() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { height: winH } = useWindowDimensions();
  // Revised down from an earlier round (was 60-65%) — the map must stay
  // dominant (~65-75% of the screen) most of the time, so even EXPANDED,
  // with many containers, relies on internal scroll rather than height.
  const panelHalfH = Math.round(Math.min(winH * 0.26, 260));
  const panelExpandedH = Math.round(Math.min(winH * 0.38, 380));

  // navegacao.tsx lives under (driver)/_layout.tsx's <Tabs> like every other
  // driver screen (it isn't an explicit Tabs.Screen, but Expo Router still
  // registers it as one) — during real GPS navigation, the bottom tab bar
  // just steals ~70px of a screen that's already fighting for vertical
  // space. Hidden only while this screen is focused; the Tabs navigator's
  // own default tabBarStyle takes back over the moment we leave.
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: { display: "none" } });
    return () => { navigation.setOptions({ tabBarStyle: undefined }); };
  }, [navigation]);

  const [tasks, setTasks] = useState<any[] | null>(null);
  const [route, setRoute] = useState<any | null>(null);
  const [fullGeo, setFullGeo] = useState<any | null>(null);
  const [legGeo, setLegGeo] = useState<any | null>(null);
  const [containersById, setContainersById] = useState<Record<string, any>>({});
  const [position, setPosition] = useState<PositionUpdate | null>(null);
  const [visualHeading, setVisualHeading] = useState<number | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [routeInfoOpen, setRouteInfoOpen] = useState(false);
  const [allStopsOpen, setAllStopsOpen] = useState(false);
  const [generalProblemOpen, setGeneralProblemOpen] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>("collapsed");
  const [failFor, setFailFor] = useState<any | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deviated, setDeviated] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const watchRef = useRef<{ remove: () => void } | null>(null);
  const headingWatchRef = useRef<{ remove: () => void } | null>(null);
  const positionRef = useRef<PositionUpdate | null>(null);
  const compassRef = useRef<HeadingUpdate | null>(null);
  const visualHeadingRef = useRef<number | null>(null);
  const legForStopId = useRef<string | null>(null);
  const stepProgressRef = useRef(0); // highest step index reached for the current leg — never regresses (GPS jitter shouldn't un-consume an instruction)
  const autoOpenedForStop = useRef<string | null>(null);
  const offRouteStreak = useRef(0); // consecutive off-route reads — 1 noisy GPS blip shouldn't trigger a deviation
  const lastRecalcAt = useRef(0);
  const legCacheRef = useRef<Map<string, { geo: any; at: number }>>(new Map());
  const panelAnim = useRef(new Animated.Value(PANEL_COLLAPSED_H)).current;

  const load = useCallback(async () => {
    // The active route is found via GET /routes (status=in_progress), NOT by
    // inferring it from collection_tasks — a route can legitimately have zero
    // tasks (e.g. drawn on the map without containers attached to any stop
    // yet), and a task-based lookup would silently never find it, making a
    // real in-progress route look like "no route at all".
    const [t, routes] = await Promise.all([
      api.get<any[]>(`/collection-tasks?mine=true&date=${TODAY}`),
      api.get<any[]>("/routes"),
    ]);
    setTasks(t);
    const active = routes.find((r) => r.status === "in_progress" && r.date === TODAY)
      || routes.find((r) => r.status === "in_progress");
    if (active) {
      const r = await api.get<any>(`/routes/${active.id}`);
      setRoute(r);
      api.get<any>(`/routes/${active.id}/geometry`).then(setFullGeo).catch(() => {});
    } else {
      setRoute(null);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    api.get<any[]>("/containers?limit=2000")
      .then((list) => setContainersById(Object.fromEntries(list.map((c) => [c.id, c]))))
      .catch(() => {});
  }, []);

  // Continuous GPS while this screen is open — drives ONLY this screen's own
  // UI (map follow, turn-by-turn, geofence arrival, ETA). Reporting the
  // driver's position to the backend (POST /gps/location, for the admin's
  // live map) is no longer done here — since FASE MOBILE 1 that is the
  // WASTEFLOW_BACKGROUND_LOCATION task's job (src/tracking/
  // backgroundLocationTask.ts), which keeps running whether this screen is
  // open or not. Posting it from both places would double-report every
  // reading — see activeContext.ts's header comment.
  useEffect(() => {
    let cancelled = false;
    watchPosition(
      (pos) => {
        if (cancelled) return;
        setPosition(pos);
        setLocError(null);
      },
      (err: LocationError) => { if (!cancelled) setLocError(err.message); }
    ).then((sub) => { if (!cancelled) watchRef.current = sub; else sub.remove(); });
    return () => { cancelled = true; watchRef.current?.remove(); watchRef.current = null; };
  }, []);

  useEffect(() => { positionRef.current = position; }, [position]);

  // Device compass, for THIS screen's marker only — never sent to the
  // backend, never touches WASTEFLOW_BACKGROUND_LOCATION (see
  // src/tracking/backgroundLocationTask.ts). Starts/stops with this screen,
  // same lifecycle as the GPS watch above. A fixed-rate ticker (not a
  // setState per raw compass event, which can fire many times a second)
  // recomputes fuseHeading()+smoothHeading() — parado: bússola; em
  // movimento: GPS com a bússola como reserva — and only re-renders when the
  // result actually moved by a visible amount.
  useEffect(() => {
    let cancelled = false;
    watchDeviceHeading((h) => { if (!cancelled) compassRef.current = h; })
      .then((sub) => { if (!cancelled) headingWatchRef.current = sub; else sub.remove(); });
    const tick = setInterval(() => {
      const compassDeg = pickCompassHeading(compassRef.current);
      const gpsDeg = positionRef.current?.heading ?? null;
      const speed = positionRef.current?.speed ?? null;
      const fused = fuseHeading(compassDeg, gpsDeg, speed);
      const smoothed = smoothHeading(visualHeadingRef.current, fused, HEADING_SMOOTH_ALPHA);
      if (smoothed == null) return;
      if (visualHeadingRef.current == null || Math.abs(smoothed - visualHeadingRef.current) >= 1) {
        visualHeadingRef.current = smoothed;
        setVisualHeading(smoothed);
      }
    }, HEADING_TICK_MS);
    return () => { cancelled = true; clearInterval(tick); headingWatchRef.current?.remove(); headingWatchRef.current = null; };
  }, []);

  const refreshRoute = useCallback(async () => {
    if (!route?.id) return;
    const r = await api.get<any>(`/routes/${route.id}`);
    setRoute(r);
  }, [route?.id]);

  const stops: any[] = route?.stops || [];
  // A stop with zero tasks (e.g. a manually-drawn stop with no containers
  // attached yet — Fase B2.2 isn't built) is neither "pending" nor "done":
  // it has nothing to act on, but it also was never completed. Conflating
  // it with "done" is exactly what produced the "Sem paragens pendentes"
  // bug on routes drawn on the map — treat it as its own explicit case.
  const emptyStops = useMemo(() => stops.filter((s) => (s.tasks || []).length === 0), [stops]);
  const currentStop = useMemo(
    () => stops.find((s) => (s.tasks || []).some((t: any) => PENDING_STATUSES.includes(t.status))),
    [stops]
  );
  const stopIndex = currentStop ? stops.indexOf(currentStop) : -1;
  const pendingTasks = (currentStop?.tasks || []).filter((t: any) => PENDING_STATUSES.includes(t.status));

  // Cached wrapper around POST /routes/navigate — a recalculation triggered
  // right after the leg-start fetch (e.g. a deviation flagged moments after
  // arriving at a new leg) would otherwise ask ORS the same from->to twice
  // within seconds. Keyed by destination stop + a coarse position bucket, not
  // just cooldown/debounce (which only limit how OFTEN we call, not whether
  // an identical call is wasted).
  const fetchLeg = useCallback(async (stopId: string, lat: number, lng: number, toLat: number, toLng: number) => {
    const key = `${stopId}:${roundCoord(lat)}:${roundCoord(lng)}`;
    const cached = legCacheRef.current.get(key);
    if (cached && Date.now() - cached.at < LEG_CACHE_TTL_MS) return cached.geo;
    const geo = await api.post<any>("/routes/navigate", { from_lat: lat, from_lng: lng, to_lat: toLat, to_lng: toLng });
    legCacheRef.current.set(key, { geo, at: Date.now() });
    return geo;
  }, []);

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
    fetchLeg(currentStop.id, position.lat, position.lng, currentStop.lat, currentStop.lng).then(setLegGeo).catch(() => {});
  }, [position, currentStop, fetchLeg]);

  const { remainingKm, offRouteKm } = useMemo(() => {
    if (!position || !legGeo?.coordinates?.length) return { remainingKm: null as number | null, offRouteKm: null as number | null };
    const d = distanceAlongRoute(position, legGeo.coordinates);
    return { remainingKm: d.remainingKm, offRouteKm: d.offRouteKm };
  }, [position, legGeo]);

  // navigation_eta — driving only, current leg. Live from ORS's duration_s
  // for this exact leg, scaled down by how much of it is already behind us.
  const etaMin = useMemo(() => {
    if (remainingKm == null) return null;
    if (legGeo?.distance_m && legGeo?.duration_s) {
      const totalKm = legGeo.distance_m / 1000;
      const frac = totalKm > 0 ? Math.min(1, remainingKm / totalKm) : 0;
      return Math.max(0, Math.round((legGeo.duration_s * frac) / 60));
    }
    return Math.max(0, Math.round((remainingKm / AVG_SPEED_KMH) * 60));
  }, [remainingKm, legGeo]);

  // All still-pending tasks across the WHOLE route (current stop included) —
  // PENDING_STATUSES already excludes collected/failed/ignored, so a
  // finished stop never counts towards remaining service time.
  const allPendingTasks = useMemo(
    () => stops.flatMap((s) => (s.tasks || []).filter((t: any) => PENDING_STATUSES.includes(t.status))),
    [stops]
  );

  // navigation_eta for the WHOLE remaining route: the current leg uses the
  // live ORS number above (etaMin) — the most accurate figure available.
  // Legs AFTER the current stop have no live ORS data, and point 11 of the
  // spec explicitly rules out extra ORS requests just to get one — so they
  // fall back to the route's own planned duration_min (services/optimizer.py,
  // computed once at creation/optimize time), apportioned evenly across the
  // remaining stops. This is an approximation, not a second live source.
  const remainingStopsAfterCurrent = Math.max(0, stops.length - stopIndex - 1);
  const plannedMinPerStop = stops.length > 0 && route?.duration_min ? route.duration_min / stops.length : 0;
  const drivingEtaRemainingMin = (etaMin ?? 0) + plannedMinPerStop * remainingStopsAfterCurrent;

  // service_eta = pending containers × the single centralized per-container
  // estimate (point 5). operational_eta = navigation_eta + service_eta.
  const nextStopServiceMin = pendingTasks.length * DEFAULT_CONTAINER_SERVICE_MIN;
  const routeServiceMin = allPendingTasks.length * DEFAULT_CONTAINER_SERVICE_MIN;
  const nextStopOperationalMin = etaMin != null ? etaMin + nextStopServiceMin : null;
  const routeOperationalMin = drivingEtaRemainingMin + routeServiceMin;

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

  // PT-PT presentation (icon/title/street) for the current step, and a
  // preview of the next one when it exists — pure lookup, no extra requests.
  const maneuver = useMemo(() => stepInfo ? getManeuverPresentation(stepInfo.step) : null, [stepInfo]);
  const nextManeuver = useMemo(() => {
    if (!stepInfo) return null;
    const steps: any[] = legGeo?.steps || [];
    const next = steps[stepInfo.index + 1];
    return next ? getManeuverPresentation(next) : null;
  }, [stepInfo, legGeo]);

  const arrived = remainingKm != null && remainingKm * 1000 <= GEOFENCE_MAX_M;

  // Off-route detection: perpendicular distance from the leg polyline, 2
  // consecutive reads over the threshold (not 1 — avoids a single GPS
  // glitch flagging a deviation that isn't real). Suppressed once arrived,
  // where "off route" from the final approach line is expected and normal —
  // and suppressed while legGeo is a straight-line fallback (no ORS key),
  // since "off route" is meaningless when there's no real route to be off.
  useEffect(() => {
    if (arrived || offRouteKm == null || legGeo?.provider === "straight") {
      offRouteStreak.current = 0; setDeviated(false); return;
    }
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
      const geo = await fetchLeg(currentStop.id, position.lat, position.lng, currentStop.lat, currentStop.lng);
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

  // Collapse the panel whenever the target stop changes (moving on to stop B
  // shouldn't leave stop A's panel expanded), then auto-expand it once per
  // stop as soon as the driver is actually within range — the driver never
  // has to go looking for the containers, and never leaves this screen.
  useEffect(() => { setPanelState("collapsed"); }, [currentStop?.id]);
  useEffect(() => {
    if (arrived && currentStop && autoOpenedForStop.current !== currentStop.id) {
      autoOpenedForStop.current = currentStop.id;
      setPanelState("expanded");
    }
  }, [arrived, currentStop]);

  const panelTargetHeight = !currentStop
    ? panelExpandedH * 0.55
    : panelState === "expanded" ? panelExpandedH : panelState === "half" ? panelHalfH : PANEL_COLLAPSED_H;
  useEffect(() => {
    Animated.timing(panelAnim, { toValue: panelTargetHeight, duration: PANEL_ANIM_MS, useNativeDriver: false }).start();
  }, [panelTargetHeight, panelAnim]);

  const cyclePanel = () => {
    setPanelState((s) => (s === "collapsed" ? "half" : s === "half" ? "expanded" : "collapsed"));
  };

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

  const reportGeneralProblem = async (reason: { label: string; kind: string }) => {
    setGeneralProblemOpen(false);
    setMenuOpen(false);
    setActionBusy(true);
    try {
      await api.post("/incidents", { kind: reason.kind, description: reason.label, ...gpsPayload });
      toast("Problema reportado", "success");
    } catch (e: any) {
      toast(e?.message || "Erro ao reportar", "error");
    } finally {
      setActionBusy(false);
    }
  };

  const finishRoute = async () => {
    if (!route?.id) return;
    setFinishing(true);
    try {
      const gps = position ? { lat: position.lat, lng: position.lng } : {};
      await api.post(`/routes/${route.id}/finish`, gps);
      watchRef.current?.remove();
      await markRouteFinished();
      toast("Rota finalizada", "success");
      router.replace("/(driver)/rota");
    } catch (e: any) {
      toast(e?.message || "Erro ao finalizar a rota", "error");
    } finally {
      setFinishing(false);
    }
  };

  const exit = () => { setMenuOpen(false); watchRef.current?.remove(); headingWatchRef.current?.remove(); router.back(); };
  const openExternal = () => {
    setMenuOpen(false);
    if (!currentStop) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${currentStop.lat},${currentStop.lng}`;
    Linking.openURL(url).catch(() => toast("Não foi possível abrir a aplicação externa", "error"));
  };

  if (!tasks) {
    return (<View style={styles.flex}><Loading text="A PREPARAR NAVEGAÇÃO..." /></View>);
  }
  if (!route) {
    return (
      <View style={[styles.flex, styles.center]}>
        <Ionicons name="checkmark-done-circle" size={64} color={colors.success} />
        <Txt variant="displaySm" style={{ textAlign: "center" }}>Sem paragens pendentes</Txt>
        <Btn title="VOLTAR" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  // Nothing left to navigate to, but the route may still need to be closed
  // out — stays on this exact screen (map still visible) instead of a
  // separate fullscreen state, per point 12/13 of the spec.
  let doneTitle: string | null = null;
  if (!currentStop) {
    if (stops.length === 0) doneTitle = "Esta rota não tem paragens definidas.";
    else if (emptyStops.length === stops.length) doneTitle = `Esta rota não tem nenhum contentor atribuído (${stops.length} paragem${stops.length === 1 ? "" : "s"} sem contentores).`;
    else if (emptyStops.length > 0) doneTitle = `Todas as paragens foram concluídas. ${emptyStops.length} paragem${emptyStops.length === 1 ? "" : "s"} sem contentores atribuídos.`;
    else doneTitle = "TODAS AS PARAGENS CONCLUÍDAS";
  }
  const canFinish = route.status === "in_progress";

  // visualHeading (compass+GPS fused, smoothed) drives the marker's rotation
  // whenever it's available — it's responsive even while stationary, which
  // raw position.heading (GPS course-over-ground) never is. Falls back to
  // the plain GPS heading only until the first compass/ticker reading lands;
  // never invents a direction when neither source is usable (undefined =
  // no rotation, not a fake one).
  const truckMarker = position ? [{
    id: "truck", lat: position.lat, lng: position.lng, color: colors.onSurface, kind: "truck" as const,
    heading: visualHeading != null ? visualHeading
      : (position.heading != null && position.heading >= 0 ? position.heading : undefined),
  }] : [];
  // Only stops still ahead get drawn — already-visited stops behind the
  // truck would just clutter a screen meant to read like a real GPS app.
  // Sequence numbers are the stop's actual position in the route (1-based),
  // not a re-count of what's left, so they always match "PARAGEM X DE Y".
  const stopMarkers = stops
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.id !== currentStop?.id && i > stopIndex)
    .map(({ s, i }) => ({ id: s.id, lat: s.lat, lng: s.lng, color: colors.onSurface, kind: "container" as const, label: String(i + 1), size: 26 }));
  const nextMarker = currentStop
    ? [{ id: currentStop.id + "-active", lat: currentStop.lat, lng: currentStop.lng, color: colors.brand, kind: "next" as const, label: String(stopIndex + 1), size: 34 }]
    : [];

  const polylines = [
    ...(fullGeo?.coordinates?.length ? [{ coordinates: fullGeo.coordinates, color: colors.muted, width: 2 }] : []),
    ...(legGeo?.coordinates?.length ? [{ coordinates: legGeo.coordinates, color: colors.brand, width: 6 }] : []),
  ];

  // Never let a missing ORS_API_KEY pass as real routing silently — the
  // backend already tells us when it fell back to straight segments
  // (services/routing.py::_straight, provider: "straight"). This is treated
  // as its own blocking state (not just a banner over fake navigation): no
  // turn-by-turn, no deviation detection, a clear "ROUTING INDISPONÍVEL"
  // card with a retry action in the exact slot the real instruction would
  // occupy, so it's never mistaken for valid navigation.
  const routingUnavailable = !!currentStop && !arrived && legGeo?.provider === "straight";
  const routeProgressPct = stops.length > 0 ? Math.round((Math.max(stopIndex, 0) / stops.length) * 100) : 0;
  const instructionBarTop = insets.top + spacing.sm + 52;
  const hasTopCard = !!currentStop && !arrived && (routingUnavailable || !!stepInfo || deviated);
  const showEtaFooter = !!currentStop && !arrived;
  const etaBarTop = instructionBarTop + (hasTopCard ? 84 : 0);
  const locErrorTop = etaBarTop + (showEtaFooter ? 52 : 0);

  return (
    <View style={styles.flex}>
      <FleetMap
        markers={[...truckMarker, ...nextMarker, ...stopMarkers]}
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

      {routingUnavailable && (
        <View testID="nav-routing-unavailable" style={[styles.instructionBar, { top: instructionBarTop, backgroundColor: colors.error, borderLeftColor: "#7F1D1D" }]}>
          <View style={styles.instructionIconWrap}>
            <Ionicons name="alert-circle" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="display" color="#fff" numberOfLines={1} style={{ fontSize: 17 }}>ROUTING INDISPONÍVEL</Txt>
            <Txt variant="mono" color="#FCA5A5" numberOfLines={2} style={{ fontSize: 11 }}>Não foi possível calcular percurso pela estrada.</Txt>
          </View>
          <Pressable testID="nav-retry-routing" onPress={recalculate} disabled={recalculating} style={styles.recalcBtn}>
            <Txt variant="monoBold" style={{ fontSize: 11 }}>{recalculating ? "..." : "TENTAR"}</Txt>
          </Pressable>
        </View>
      )}

      {currentStop && !arrived && !routingUnavailable && deviated && (
        <View testID="nav-deviated" style={[styles.instructionBar, { top: instructionBarTop, backgroundColor: colors.warning }]}>
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

      {currentStop && !arrived && !routingUnavailable && !deviated && stepInfo && maneuver && (
        <View testID="nav-instruction" style={[styles.instructionBar, { top: instructionBarTop, flexDirection: "column", alignItems: "stretch" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={styles.instructionIconWrap}>
              <Ionicons name={maneuver.icon} size={28} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="display" color="#fff" numberOfLines={1} style={{ fontSize: 18 }}>{maneuver.title}</Txt>
              <Txt variant="display" color={colors.brand} style={{ fontSize: 20 }}>
                {stepInfo.distanceToManeuverM < MANEUVER_IMMINENT_M ? "AGORA" : formatDistance(stepInfo.distanceToManeuverM)}
              </Txt>
              {maneuver.street && (
                <Txt variant="mono" color="#9CA3AF" numberOfLines={1} style={{ fontSize: 11 }}>{maneuver.street}</Txt>
              )}
            </View>
          </View>
          {nextManeuver && stepInfo.distanceToManeuverM >= MANEUVER_IMMINENT_M && (
            <View style={styles.nextManeuverRow}>
              <Ionicons name={nextManeuver.icon} size={13} color="#9CA3AF" />
              <Txt variant="mono" color="#9CA3AF" numberOfLines={1} style={{ fontSize: 11, flex: 1 }}>
                Próxima: {nextManeuver.title.toLowerCase()} · {formatDistance(nextManeuver.distanceM)}
              </Txt>
            </View>
          )}
        </View>
      )}

      {/* Operational ETA — always visible at the top while navigating,
          regardless of which primary card (instruction/deviated/routing
          unavailable) is showing above it, or none. navigation_eta +
          service_eta, point 12 of the spec (kept simple in the UI). */}
      {showEtaFooter && (
        <View testID="nav-eta-footer" style={[styles.etaBar, { top: etaBarTop }]}>
          <View style={styles.etaCell}>
            <Txt variant="label" color="#9CA3AF" style={{ fontSize: 9 }}>PRÓXIMA PARAGEM</Txt>
            <Txt variant="monoBold" color="#fff" style={{ fontSize: 14 }}>
              {nextStopOperationalMin != null ? formatEtaLong(nextStopOperationalMin) : "—"}
            </Txt>
          </View>
          <View style={styles.etaDivider} />
          <View style={styles.etaCell}>
            <Txt variant="label" color="#9CA3AF" style={{ fontSize: 9 }}>ROTA RESTANTE</Txt>
            <Txt variant="monoBold" color="#fff" style={{ fontSize: 14 }}>{formatEtaLong(routeOperationalMin)}</Txt>
          </View>
        </View>
      )}

      {locError && (
        <View style={[styles.warnBanner, { top: locErrorTop }]}>
          <Ionicons name="warning" size={16} color="#fff" />
          <Txt variant="mono" color="#fff" style={{ flex: 1, fontSize: 12 }}>{locError}</Txt>
        </View>
      )}

      {/* TEMPORARY — debug de investigação (routing + layout + painel).
          Remover depois de confirmado no Android. */}
      {__DEV__ && (
        <View testID="nav-debug-routing" pointerEvents="none" style={[styles.debugBadge, { bottom: insets.bottom + PANEL_COLLAPSED_H + spacing.sm }]}>
          {legGeo && (
            <Txt variant="mono" color="#fff" style={{ fontSize: 9 }}>
              {legGeo.provider === "openrouteservice" ? "ORS" : "STRAIGHT"} · coords:{legGeo.coordinates?.length ?? 0} · steps:{legGeo.steps?.length ?? 0}
              {stepInfo ? ` · step:${stepInfo.index + 1}/${stepInfo.total}` : ""}
            </Txt>
          )}
          <Txt variant="mono" color="#fff" style={{ fontSize: 9 }}>
            stop:{currentStop ? "✓" : "✗"} arrived:{String(arrived)} deviated:{String(deviated)} routing:{routingUnavailable ? "down" : "ok"} stepInfo:{stepInfo ? "true" : "false"} top:{Math.round(instructionBarTop)}
          </Txt>
          <Txt variant="mono" color="#fff" style={{ fontSize: 9 }}>
            panel:{!currentStop ? "done" : panelState} tasks:{(currentStop?.tasks || []).length} pending:{pendingTasks.length} targetH:{Math.round(panelTargetHeight)}
          </Txt>
          <Txt variant="mono" color="#fff" style={{ fontSize: 9 }}>
            driveETA:{etaMin ?? "-"} serviceETA:{nextStopServiceMin} operationalETA:{nextStopOperationalMin ?? "-"} pendingContainers:{allPendingTasks.length}
          </Txt>
          <Txt variant="mono" color="#fff" style={{ fontSize: 9 }}>
            compass:{pickCompassHeading(compassRef.current) ?? "-"}° gps:{position?.heading ?? "-"}° visual:{visualHeading ?? "-"}° speed:{position?.speed != null ? position.speed.toFixed(1) : "-"}
          </Txt>
          {stepInfo && maneuver && (
            <Txt variant="mono" color="#fff" numberOfLines={2} style={{ fontSize: 9 }}>
              type:{stepInfo.step.type ?? "-"} raw:"{(stepInfo.step.text || "").slice(0, 40)}" → "{maneuver.title}" dist:{Math.round(stepInfo.distanceToManeuverM)}m
            </Txt>
          )}
        </View>
      )}

      {/* Bottom panel — always the SAME screen, map always visible behind it.
          3 states while there's an active stop (collapsed/half/expanded);
          a fixed "route wrap-up" card once there's nothing left to navigate to. */}
      <Animated.View style={[styles.panel, { height: panelAnim, paddingBottom: insets.bottom + spacing.sm }]}>
        {!currentStop ? (
          <View style={styles.doneCard} testID="nav-all-done">
            <Ionicons name="checkmark-done-circle" size={40} color={colors.success} />
            <Txt variant="displaySm" style={{ textAlign: "center", fontSize: 17 }}>{doneTitle}</Txt>
            {canFinish ? (
              <Btn testID="nav-finish-route" title="FINALIZAR ROTA" icon="flag" size="lg" variant="success"
                loading={finishing} onPress={finishRoute} style={{ marginTop: spacing.sm, alignSelf: "stretch" }} />
            ) : (
              <Btn title="VOLTAR" onPress={() => router.back()} style={{ marginTop: spacing.sm, alignSelf: "stretch" }} />
            )}
          </View>
        ) : (
          <>
            <Pressable testID="nav-panel-handle" onPress={cyclePanel} style={styles.panelHandleArea}>
              <View style={styles.panelHandle} />
            </Pressable>

            <View testID="nav-route-progress" style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${routeProgressPct}%` }]} />
              </View>
              <Txt variant="label" color={colors.muted} style={{ fontSize: 10 }}>{routeProgressPct}%</Txt>
            </View>

            {panelState === "collapsed" && (
              <View testID="nav-panel-collapsed" style={styles.collapsedRow}>
                {arrived ? (
                  <View style={{ flex: 1 }}>
                    <Txt variant="label" color={colors.success}>CHEGOU À PARAGEM {stopIndex + 1}</Txt>
                    <Txt variant="monoBold" numberOfLines={1}>{pendingTasks.length} contentor(es) por recolher</Txt>
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Txt variant="label" color={colors.muted}>PRÓXIMA PARAGEM</Txt>
                    <Txt variant="monoBold" style={{ fontSize: 14 }} numberOfLines={1}>PARAGEM {stopIndex + 1} DE {stops.length}</Txt>
                    {currentStop.address ? (
                      <Txt variant="mono" color={colors.muted} numberOfLines={1} style={{ fontSize: 11 }}>{currentStop.address}</Txt>
                    ) : null}
                    <Txt variant="label" style={{ marginTop: 2 }}>{pendingTasks.length} contentor{pendingTasks.length === 1 ? "" : "es"}</Txt>
                  </View>
                )}
                <Btn testID="nav-view-container-btn" title="VER CONTENTOR" size="sm" variant="outline" onPress={() => setPanelState("expanded")} />
              </View>
            )}

            {panelState === "half" && (
              <>
                <View style={styles.panelHeadRow}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="label">{arrived ? `CHEGOU À PARAGEM ${stopIndex + 1}` : `PARAGEM ${stopIndex + 1} DE ${stops.length}`}</Txt>
                    <Txt variant="displaySm" numberOfLines={1} style={{ fontSize: 16 }}>{currentStop.address || "Localização definida no mapa"}</Txt>
                  </View>
                  <Pressable testID="nav-panel-expand" onPress={() => setPanelState("expanded")} hitSlop={8}>
                    <Ionicons name="chevron-expand" size={20} color={colors.brand} />
                  </Pressable>
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.xs }}>
                  {(currentStop.tasks || []).map((t: any) => {
                    const c = containersById[t.container_id];
                    const st = taskStatus[t.status] || taskStatus.scheduled;
                    return (
                      <Pressable key={t.id} onPress={() => setPanelState("expanded")} style={styles.compactTaskRow}>
                        <View style={{ flex: 1 }}>
                          <Txt variant="monoBold" style={{ fontSize: 12 }}>{c?.qr_code || `#${t.container_id.slice(0, 8).toUpperCase()}`}</Txt>
                          <Txt variant="label">{wasteLabels[t.waste_type] || t.waste_type}</Txt>
                        </View>
                        <Badge label={st.label} color={st.color} />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {panelState === "expanded" && (
              <>
                <View style={styles.panelHeadRow}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="label" color={arrived ? colors.success : colors.muted}>
                      {arrived ? `CHEGOU À PARAGEM ${stopIndex + 1}` : `PARAGEM ${stopIndex + 1} DE ${stops.length}`}
                    </Txt>
                    <Txt variant="displaySm" numberOfLines={1} style={{ fontSize: 16 }}>{currentStop.address || "Localização definida no mapa"}</Txt>
                  </View>
                  <Pressable testID="nav-panel-collapse" onPress={() => setPanelState("collapsed")} hitSlop={8}>
                    <Ionicons name="chevron-collapse" size={20} color={colors.muted} />
                  </Pressable>
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
                  {pendingTasks.length > 1 && (
                    <Btn testID="nav-collect-all" title="RECOLHER TODOS" icon="checkmark-done" size="sm" variant="success" loading={actionBusy} onPress={completeAll} />
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
                            <Txt variant="monoBold" style={{ fontSize: 13 }}>{c?.qr_code || `#${t.container_id.slice(0, 8).toUpperCase()}`}</Txt>
                            <Txt variant="mono" color={colors.muted} style={{ fontSize: 12 }}>{wasteLabels[t.waste_type] || t.waste_type}</Txt>
                          </View>
                          {isPending ? (
                            <View style={styles.taskActions}>
                              <Pressable testID={`nav-complete-${t.id}`} disabled={actionBusy} onPress={() => completeTask(t.id)} style={[styles.taskActionBtn, { backgroundColor: colors.success }]}>
                                <Ionicons name="checkmark" size={15} color="#fff" />
                                <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>RECOLHIDO</Txt>
                              </Pressable>
                              <Pressable testID={`nav-fail-${t.id}`} disabled={actionBusy} onPress={() => setFailFor(t)} style={[styles.taskActionBtn, { backgroundColor: colors.error }]}>
                                <Ionicons name="warning" size={15} color="#fff" />
                                <Txt variant="monoBold" color="#fff" style={{ fontSize: 9 }}>PROBLEMA</Txt>
                              </Pressable>
                              <Pressable testID={`nav-ignore-${t.id}`} disabled={actionBusy} onPress={() => ignoreTask(t.id)} style={[styles.taskActionBtn, { backgroundColor: colors.surfaceSecondary }]}>
                                <Ionicons name="play-skip-forward" size={15} color={colors.onSurface} />
                                <Txt variant="monoBold" style={{ fontSize: 9 }}>IGNORAR</Txt>
                              </Pressable>
                            </View>
                          ) : (
                            <Badge label={st.label} color={st.color} />
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </>
        )}
      </Animated.View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">OPÇÕES</Txt>
            <Pressable testID="nav-route-info" style={styles.menuRow} onPress={() => { setMenuOpen(false); setRouteInfoOpen(true); }}>
              <Ionicons name="information-circle-outline" size={18} color={colors.onSurface} />
              <Txt variant="monoBold" style={{ flex: 1 }}>Informação da rota</Txt>
            </Pressable>
            <Pressable testID="nav-all-stops" style={styles.menuRow} onPress={() => { setMenuOpen(false); setAllStopsOpen(true); }}>
              <Ionicons name="list-outline" size={18} color={colors.onSurface} />
              <Txt variant="monoBold" style={{ flex: 1 }}>Ver todas as paragens</Txt>
            </Pressable>
            <Pressable testID="nav-open-external" style={styles.menuRow} onPress={openExternal}>
              <Ionicons name="open-outline" size={18} color={colors.onSurface} />
              <Txt variant="monoBold" style={{ flex: 1 }}>Abrir no Google Maps</Txt>
            </Pressable>
            <Pressable testID="nav-report-general" style={styles.menuRow} onPress={() => { setMenuOpen(false); setGeneralProblemOpen(true); }}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <Txt variant="monoBold" color={colors.error} style={{ flex: 1 }}>Reportar problema geral</Txt>
            </Pressable>
            <Pressable testID="nav-exit-menu" style={styles.menuRow} onPress={exit}>
              <Ionicons name="log-out-outline" size={18} color={colors.onSurface} />
              <Txt variant="monoBold" style={{ flex: 1 }}>Sair da navegação</Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={routeInfoOpen} transparent animationType="fade" onRequestClose={() => setRouteInfoOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRouteInfoOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">{route.code}</Txt>
            <InfoRow label="Data" value={route.date} />
            <InfoRow label="Estado" value={route.status} />
            <InfoRow label="Paragens" value={String(stops.length)} />
            <InfoRow label="Contentores" value={String(stops.reduce((n, s) => n + (s.tasks || []).length, 0))} />
            <InfoRow label="Distância planeada" value={`${route.distance_km} km`} />
            <InfoRow label="Duração planeada" value={`${Math.round(route.duration_min)} min`} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={allStopsOpen} transparent animationType="slide" onRequestClose={() => setAllStopsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAllStopsOpen(false)}>
          <Pressable style={[styles.sheet, { maxHeight: "75%", paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">TODAS AS PARAGENS ({stops.length})</Txt>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              {stops.map((s, i) => {
                const sst = stopTaskSummary(s);
                return (
                  <View key={s.id} style={[styles.menuRow, s.id === currentStop?.id ? { borderColor: colors.brand } : null]}>
                    <Txt variant="monoBold" style={{ width: 24 }}>{i + 1}</Txt>
                    <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>{s.address || "Sem morada"}</Txt>
                    <Badge label={sst.label} color={sst.color} />
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={generalProblemOpen} transparent animationType="slide" onRequestClose={() => setGeneralProblemOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setGeneralProblemOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Txt variant="displaySm">PROBLEMA GERAL DA ROTA</Txt>
            {GENERAL_PROBLEM_REASONS.map((r) => (
              <Pressable key={r.label} testID={`nav-general-reason-${r.label}`} style={styles.menuRow} onPress={() => reportGeneralProblem(r)}>
                <Txt variant="monoBold" style={{ flex: 1 }}>{r.label}</Txt>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Txt variant="mono" color={colors.muted}>{label}</Txt>
      <Txt variant="monoBold">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  // elevation (Android) + zIndex (all platforms) on every overlay — without
  // an explicit elevation, react-native-webview's Android view can end up
  // compositing above sibling Views regardless of JSX order (see FleetMap.tsx).
  topBar: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", justifyContent: "space-between", zIndex: 20, elevation: 20 },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", ...(shadows.float as object),
  },
  instructionBar: {
    position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.onSurface, borderRadius: radius.lg, padding: spacing.md,
    borderLeftWidth: 5, borderLeftColor: colors.brand, zIndex: 20, elevation: 20, ...(shadows.float as object),
  },
  instructionIconWrap: {
    width: 46, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  nextManeuverRow: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs, paddingTop: spacing.xs,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)",
  },
  recalcBtn: {
    backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  etaBar: {
    position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center",
    backgroundColor: colors.onSurface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    zIndex: 20, elevation: 20, ...(shadows.float as object),
  },
  etaCell: { flex: 1, alignItems: "center", gap: 1 },
  etaDivider: { width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.2)" },
  warnBanner: {
    position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.error, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    zIndex: 20, elevation: 20,
  },
  debugBadge: {
    position: "absolute", left: spacing.md, backgroundColor: "rgba(17,24,39,0.85)", borderRadius: radius.xs,
    paddingHorizontal: spacing.sm, paddingVertical: 3, zIndex: 30, elevation: 30,
  },
  panel: {
    position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, overflow: "hidden", zIndex: 20, elevation: 20, ...(shadows.float as object),
  },
  panelHandleArea: { alignItems: "center", paddingVertical: spacing.xs },
  panelHandle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.xs },
  progressTrack: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.brand },
  collapsedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelHeadRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingBottom: spacing.sm },
  doneCard: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "space-between", borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  compactTaskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, backgroundColor: colors.bg },
  taskCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.surface },
  taskPhoto: { width: "100%", height: 100, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  taskHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  taskActions: { flexDirection: "row", gap: 6 },
  taskActionBtn: { width: 62, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 1 },
});
