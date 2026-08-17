import * as Location from "expo-location";

// Thrown for every location failure — permission denial, no GPS fix, timeout,
// or any unexpected error from expo-location. Always caught by the caller's
// existing error handling (never an unhandled crash).
export class LocationError extends Error {
  reason: "permission_denied" | "unavailable";
  constructor(message: string, reason: "permission_denied" | "unavailable") {
    super(message);
    this.reason = reason;
  }
}

const TIMEOUT_MS = 12000;

// Requests foreground permission, then reads a fresh GPS fix. Works on native
// and web (expo-location's web implementation wraps navigator.geolocation) —
// no Platform.OS branching needed.
export async function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  let status: Location.PermissionStatus;
  try {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  } catch {
    throw new LocationError("Não foi possível pedir permissão de localização.", "unavailable");
  }

  if (status !== "granted") {
    throw new LocationError(
      "Permissão de localização negada. Ative o GPS nas definições para confirmar recolhas.",
      "permission_denied"
    );
  }

  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new LocationError("Não foi possível obter a localização a tempo. Tente novamente.", "unavailable")),
          TIMEOUT_MS
        )
      ),
    ]);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (e) {
    if (e instanceof LocationError) throw e;
    throw new LocationError("Não foi possível obter a localização. Verifique se o GPS está ativo.", "unavailable");
  }
}

export type PositionUpdate = {
  lat: number; lng: number;
  heading: number | null; speed: number | null; accuracy: number | null;
};

// Continuous tracking for the in-app navigation screen — distinct from
// getCurrentLocation() (a one-shot high-accuracy fix used only to confirm a
// collection). Balanced accuracy + a distance/time floor keeps battery and
// data use reasonable while a route is actively being driven. Callers MUST
// call .remove() when navigation ends (e.g. on screen unmount).
export async function watchPosition(
  onUpdate: (pos: PositionUpdate) => void,
  onError: (err: LocationError) => void
): Promise<{ remove: () => void }> {
  let status: Location.PermissionStatus;
  try {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  } catch {
    onError(new LocationError("Não foi possível pedir permissão de localização.", "unavailable"));
    return { remove: () => {} };
  }
  if (status !== "granted") {
    onError(new LocationError("Permissão de localização negada. Ative o GPS para navegar.", "permission_denied"));
    return { remove: () => {} };
  }
  try {
    return await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5000 },
      (pos) => {
        onUpdate({
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          heading: pos.coords.heading ?? null, speed: pos.coords.speed ?? null,
          accuracy: pos.coords.accuracy ?? null,
        });
      }
    );
  } catch {
    onError(new LocationError("Não foi possível iniciar o rastreio de localização.", "unavailable"));
    return { remove: () => {} };
  }
}
