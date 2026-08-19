import { api } from "@/src/api";

// Best-effort reverse geocoding for a map tap — never throws, so a tap can
// always proceed even if the lookup fails or finds nothing (the admin can
// still type/edit the address manually either way).
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await api.get<{ address: string | null }>(`/geocode/reverse?lat=${lat}&lng=${lng}`);
    return res.address || "";
  } catch {
    return "";
  }
}
