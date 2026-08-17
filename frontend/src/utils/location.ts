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
