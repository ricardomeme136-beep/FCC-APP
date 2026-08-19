// Central source of truth for "should background GPS be running right now,
// and for what". Read by the background task (backgroundLocationTask.ts) on
// every location update; written by rota.tsx/navegacao.tsx (a route is
// in_progress) and gravar.tsx (a tracking_session is recording). Background
// tracking runs whenever EITHER flag is set, and stops the moment BOTH are
// clear — mirrors the server-side privacy rule (GPS only ever accepted
// while a route is in_progress or a tracking_session is "recording"), so
// there is never a window where location is collected for no active reason.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { WASTEFLOW_BACKGROUND_LOCATION } from "@/src/tracking/constants";

const ROUTE_KEY = "wf_active_route_vehicle_id";
const SESSION_KEY = "wf_active_tracking_session_id";

export async function getRouteVehicleId(): Promise<string | null> {
  return (await AsyncStorage.getItem(ROUTE_KEY)) || null;
}

export async function getTrackingSessionId(): Promise<string | null> {
  return (await AsyncStorage.getItem(SESSION_KEY)) || null;
}

// Idempotent — safe to call every time a screen learns a route is
// in_progress (on start AND on every resume/focus), even if background
// tracking is already running for it.
export async function markRouteActive(vehicleId: string): Promise<boolean> {
  await AsyncStorage.setItem(ROUTE_KEY, vehicleId);
  return ensureBackgroundTrackingStarted();
}

export async function markRouteFinished(): Promise<void> {
  await AsyncStorage.removeItem(ROUTE_KEY);
  await maybeStopBackgroundTracking();
}

export async function markRecordingActive(sessionId: string): Promise<boolean> {
  await AsyncStorage.setItem(SESSION_KEY, sessionId);
  return ensureBackgroundTrackingStarted();
}

export async function markRecordingStopped(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
  await maybeStopBackgroundTracking();
}

// Returns true if background permission was granted — false means only
// foreground tracking (screen open, app active) will actually work, and the
// caller should say so rather than silently claiming full background
// coverage. Foreground permission denied is treated the same as before
// this phase (the existing watchPosition() error path already handles it).
// Background location tasks are a native-only concept — expo-location's web
// implementation doesn't support them at all. Every branch here is
// best-effort and never throws into the caller (rota.tsx/gravar.tsx run on
// web too, via `expo export --platform web`), matching how getCurrentLocation
// / watchPosition already degrade gracefully elsewhere in this codebase.
export async function ensureBackgroundTrackingStarted(): Promise<boolean> {
  try {
    const already = await Location.hasStartedLocationUpdatesAsync(WASTEFLOW_BACKGROUND_LOCATION);
    if (already) return true;

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    const bg = await Location.requestBackgroundPermissionsAsync();

    // Android 13+ (API 33) requires this separate runtime permission or the
    // foreground-service notification below is silently suppressed — the
    // service still runs, but the required "GPS ativo" visibility (point 10)
    // would quietly disappear on modern phones without this. iOS has no
    // such permission (its own background-location indicator is system-
    // level, already covered by showsBackgroundLocationIndicator).
    if (Platform.OS === "android") {
      await Notifications.requestPermissionsAsync().catch(() => {});
    }

    await Location.startLocationUpdatesAsync(WASTEFLOW_BACKGROUND_LOCATION, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 20,
      timeInterval: 8000,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "WasteFlow — GPS ativo",
        notificationBody: "A localização está a ser partilhada enquanto a rota ou gravação estiver ativa.",
        notificationColor: "#F97316",
      },
    });
    return bg.status === "granted";
  } catch {
    return false;
  }
}

export async function maybeStopBackgroundTracking(): Promise<void> {
  try {
    const [routeId, sessionId] = await Promise.all([getRouteVehicleId(), getTrackingSessionId()]);
    if (routeId || sessionId) return; // still needed for the other purpose
    const already = await Location.hasStartedLocationUpdatesAsync(WASTEFLOW_BACKGROUND_LOCATION);
    if (already) await Location.stopLocationUpdatesAsync(WASTEFLOW_BACKGROUND_LOCATION);
  } catch {
    // Not available on this platform (e.g. web) — nothing to stop.
  }
}
