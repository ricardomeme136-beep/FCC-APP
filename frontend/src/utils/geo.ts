// Client-side geo helpers — mirrors backend/services/geo.py + services/stops.py
// closely enough for instant UI feedback (an "approximate" stop count) while
// the admin is still picking containers. The backend's own clustering is the
// source of truth once a route is actually generated.

const EARTH_KM = 6371.0;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const DEFAULT_THRESHOLD_M = 25;

// Greedy proximity clustering — same idea as cluster_into_stops() server-side.
// Only used to estimate "~N paragens" while picking containers; not
// authoritative (the label in the UI says "aproximadamente" on purpose).
export function estimateStopCount(
  points: { lat: number; lng: number }[],
  thresholdM: number = DEFAULT_THRESHOLD_M
): number {
  const remaining = points.slice();
  let stops = 0;
  while (remaining.length) {
    const seed = remaining.shift()!;
    stops += 1;
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (haversineKm(seed, remaining[i]) * 1000 <= thresholdM) {
        remaining.splice(i, 1);
      }
    }
  }
  return stops;
}

export type RoutePoint = { latitude: number; longitude: number };

function haversineKmLL(a: RoutePoint, b: RoutePoint): number {
  return haversineKm({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
}

// Local flat-earth projection (accurate enough at city/route scale) used to
// find the perpendicular distance from `pos` to the segment a-b, and how far
// along that segment (0..1) the closest point falls.
function pointToSegmentKm(pos: { lat: number; lng: number }, a: RoutePoint, b: RoutePoint) {
  const cos = Math.cos((pos.lat * Math.PI) / 180);
  const toXY = (p: { lat: number; lng: number }) => ({ x: p.lng * 111.32 * cos, y: p.lat * 110.57 });
  const P = toXY(pos);
  const A = toXY({ lat: a.latitude, lng: a.longitude });
  const B = toXY({ lat: b.latitude, lng: b.longitude });
  const abx = B.x - A.x, aby = B.y - A.y;
  const lenSq = abx * abx + aby * aby;
  let frac = lenSq > 0 ? ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq : 0;
  frac = Math.max(0, Math.min(1, frac));
  const closest = { x: A.x + abx * frac, y: A.y + aby * frac };
  return { distKm: Math.hypot(P.x - closest.x, P.y - closest.y), frac };
}

// Distance remaining ALONG the route geometry (not straight-line): projects
// `pos` onto its nearest segment of `coords`, then sums that partial segment
// plus every segment after it. Also returns how far `pos` currently is from
// the line itself (useful later for off-route detection).
export function distanceAlongRoute(
  pos: { lat: number; lng: number },
  coords: RoutePoint[]
): { remainingKm: number; offRouteKm: number; nearestIndex: number } {
  if (!coords || coords.length < 2) return { remainingKm: 0, offRouteKm: 0, nearestIndex: 0 };

  let best = { distKm: Infinity, index: 0, frac: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const { distKm, frac } = pointToSegmentKm(pos, coords[i], coords[i + 1]);
    if (distKm < best.distKm) best = { distKm, index: i, frac };
  }

  const segKm = haversineKmLL(coords[best.index], coords[best.index + 1]);
  let remainingKm = segKm * (1 - best.frac);
  for (let i = best.index + 1; i < coords.length - 1; i++) {
    remainingKm += haversineKmLL(coords[i], coords[i + 1]);
  }
  return { remainingKm, offRouteKm: best.distKm, nearestIndex: best.index };
}
