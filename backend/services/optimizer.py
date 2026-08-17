"""Geographic route optimization.

Real optimization engine (not LLM-based): capacity- and waste-type-aware
clustering across trucks, then nearest-neighbour construction + 2-opt local
search to minimise total driving distance per route.
"""
from typing import Dict, List, Tuple

from services.geo import haversine

AVG_SPEED_KMH = 28.0          # urban collection average
SERVICE_MIN_PER_STOP = 3.0    # minutes handling each container


def _route_distance(points: List[Tuple[float, float]]) -> float:
    return sum(haversine(points[i], points[i + 1]) for i in range(len(points) - 1))


def _nearest_neighbour(start: Tuple[float, float], stops: List[dict]) -> List[dict]:
    remaining = stops[:]
    order: List[dict] = []
    cur = start
    while remaining:
        nxt = min(remaining, key=lambda s: haversine(cur, (s["lat"], s["lng"])))
        order.append(nxt)
        remaining.remove(nxt)
        cur = (nxt["lat"], nxt["lng"])
    return order


def _two_opt(start: Tuple[float, float], end: Tuple[float, float],
             order: List[dict]) -> List[dict]:
    def full(seq):
        pts = [start] + [(s["lat"], s["lng"]) for s in seq] + [end]
        return _route_distance(pts)

    best = order[:]
    best_d = full(best)
    improved = True
    passes = 0
    while improved and passes < 12:
        improved = False
        passes += 1
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                d = full(cand)
                if d + 1e-9 < best_d:
                    best, best_d = cand, d
                    improved = True
    return best


def optimize_single(start: Tuple[float, float], end: Tuple[float, float],
                    stops: List[dict]) -> Dict:
    """Order a set of stops. Each stop: {id, lat, lng, load_kg, priority}."""
    if not stops:
        pts = [start, end]
        dist = _route_distance(pts)
        return {"order": [], "distance_km": round(dist, 2),
                "duration_min": round(dist / AVG_SPEED_KMH * 60, 1)}
    # Priority stops are pinned to the front, rest optimized.
    priority = [s for s in stops if s.get("priority")]
    normal = [s for s in stops if not s.get("priority")]
    nn = _nearest_neighbour(start, normal)
    opt = _two_opt(start, end, nn) if len(nn) > 2 else nn
    order = priority + opt
    pts = [start] + [(s["lat"], s["lng"]) for s in order] + [end]
    dist = _route_distance(pts)
    duration = dist / AVG_SPEED_KMH * 60 + len(order) * SERVICE_MIN_PER_STOP
    return {"order": order, "distance_km": round(dist, 2),
            "duration_min": round(duration, 1)}


def generate_routes(stops: List[dict], trucks: List[dict],
                    depot: Tuple[float, float],
                    facility_for: Dict[str, Tuple[float, float]]) -> List[Dict]:
    """Cluster stops across trucks respecting capacity + waste-type, then
    optimize each cluster.

    stops: [{id, lat, lng, waste_type(s), load_kg, priority}] — either raw
        containers (legacy single `waste_type` str) or grouped paragens
        (`waste_types` list, several containers per stop). Both shapes are
        accepted so existing callers keep working unchanged.
    trucks: [{id, capacity_kg, allowed_waste_types}]
    facility_for: waste_type -> (lat,lng) compatible disposal facility
    """
    if not trucks:
        return []

    # Bucket stops a truck can legally carry, seeded round-robin by a
    # geographic sweep (angle from depot) for balanced, contiguous clusters.
    import math
    stops = sorted(
        stops,
        key=lambda c: math.atan2(c["lat"] - depot[0], c["lng"] - depot[1]),
    )

    clusters: List[List[dict]] = [[] for _ in trucks]
    loads = [0.0 for _ in trucks]
    for c in stops:
        types = set(_waste_types(c))
        candidates = [
            i for i, t in enumerate(trucks)
            if (not t.get("allowed_waste_types")
                or types.issubset(set(t["allowed_waste_types"])))
            and loads[i] + c.get("load_kg", 0) <= t["capacity_kg"]
        ]
        if not candidates:
            candidates = list(range(len(trucks)))
        # pick least-loaded compatible truck, tie-broken by proximity to its last stop
        idx = min(candidates, key=lambda i: (loads[i], _cluster_dist(clusters[i], c)))
        clusters[idx].append(c)
        loads[idx] += c.get("load_kg", 0)

    routes = []
    for i, (t, cluster) in enumerate(zip(trucks, clusters)):
        # choose end facility based on dominant waste type in cluster
        wt = _dominant_waste(cluster)
        end = facility_for.get(wt, depot)
        res = optimize_single(depot, end, cluster)
        util = round(loads[i] / t["capacity_kg"] * 100, 1) if t["capacity_kg"] else 0
        routes.append({
            "truck_id": t["id"],
            "stops": res["order"],
            "num_stops": len(res["order"]),
            "distance_km": res["distance_km"],
            "duration_min": res["duration_min"],
            "load_kg": round(loads[i], 1),
            "capacity_utilization": util,
            "waste_type": wt,
        })
    return routes


def _cluster_dist(cluster: List[dict], c: dict) -> float:
    if not cluster:
        return 0.0
    last = cluster[-1]
    return haversine((last["lat"], last["lng"]), (c["lat"], c["lng"]))


def _waste_types(stop: dict) -> List[str]:
    """Accepts either a raw container (`waste_type` str) or a grouped stop
    (`waste_types` list) — lets generate_routes() take both shapes."""
    if "waste_types" in stop:
        return stop["waste_types"]
    return [stop["waste_type"]]


def _dominant_waste(cluster: List[dict]) -> str:
    if not cluster:
        return "general"
    counts: Dict[str, int] = {}
    for c in cluster:
        # weight by container count so a 1-container stop doesn't outrank a
        # 3-container stop of a different type
        weight = len(c["container_ids"]) if "container_ids" in c else 1
        for wt in _waste_types(c):
            counts[wt] = counts.get(wt, 0) + weight
    return max(counts, key=counts.get)
