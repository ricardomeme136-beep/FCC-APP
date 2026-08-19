// Registered at module load time — imported once, as a side effect, from
// app/_layout.tsx BEFORE any component renders. TaskManager requires this:
// the task definition must exist unconditionally so the OS can find and
// invoke it even when it relaunches the app headlessly (no UI, no screens
// mounted) just to deliver a queued location update after the app was
// killed while a route/recording was still active.
//
// This is the ONLY place that ever writes a captured GPS reading anywhere
// (POST /gps/location for a live route, or the recording queue for a
// tracking_session) — see activeContext.ts's header comment for why a
// second, independent watcher (e.g. inside a screen component) must never
// also do this while this task is registered, or every reading would be
// recorded twice.
import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";

import { api } from "@/src/api";
import { WASTEFLOW_BACKGROUND_LOCATION } from "@/src/tracking/constants";
import { getRouteVehicleId, getTrackingSessionId } from "@/src/tracking/activeContext";
import { appendPoint, flushQueue } from "@/src/tracking/recordingEngine";

TaskManager.defineTask(WASTEFLOW_BACKGROUND_LOCATION, async ({ data, error }) => {
  if (error) return;
  const { locations } = (data as { locations?: LocationObject[] }) || {};
  if (!locations || !locations.length) return;

  const [routeVehicleId, trackingSessionId] = await Promise.all([
    getRouteVehicleId(), getTrackingSessionId(),
  ]);
  // Neither purpose is active — nothing to record. The subscription itself
  // should already have been stopped by maybeStopBackgroundTracking() by
  // this point; this is only a safety net against a stale registration.
  if (!routeVehicleId && !trackingSessionId) return;

  const last = locations[locations.length - 1];
  const reading = {
    lat: last.coords.latitude, lng: last.coords.longitude,
    speed: last.coords.speed, heading: last.coords.heading,
    accuracy: last.coords.accuracy, altitude: last.coords.altitude,
  };

  if (routeVehicleId) {
    // Live fleet position — best-effort, fire-and-forget, exactly like the
    // pre-MOBILE-1 foreground behavior. Not queued: it is a "where is the
    // vehicle right now" ping, not historical data that must never be lost.
    api.post("/gps/location", {
      vehicle_id: routeVehicleId, lat: reading.lat, lng: reading.lng,
      speed: reading.speed ?? 0, heading: reading.heading ?? 0, status: "en_route",
    }).catch(() => {});
  }

  if (trackingSessionId) {
    await appendPoint(trackingSessionId, reading);
    await flushQueue(trackingSessionId);
  }
});
