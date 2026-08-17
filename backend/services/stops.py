"""Group nearby containers into physical stops (paragens).

A stop represents one physical location — several containers standing at the
same address/curb generate one stop with several collection tasks, instead of
one route entry per container.
"""
from typing import Dict, List

from services.geo import haversine

DEFAULT_THRESHOLD_M = 25.0  # ~one street frontage


def cluster_into_stops(containers: List[dict], threshold_m: float = DEFAULT_THRESHOLD_M) -> List[Dict]:
    """containers: [{id, lat, lng, waste_type, load_kg, priority, address}, ...]

    Returns stop-shaped dicts (order not meaningful yet — sequencing happens in
    the optimizer): {lat, lng, address, waste_types, load_kg, priority,
    container_ids}. Greedy nearest-based clustering: O(n^2) but container
    counts here are in the hundreds, matching the optimizer's own complexity.
    """
    remaining = containers[:]
    stops: List[Dict] = []
    while remaining:
        seed = remaining.pop(0)
        group = [seed]
        seed_pt = (seed["lat"], seed["lng"])
        still_remaining = []
        for c in remaining:
            if haversine(seed_pt, (c["lat"], c["lng"])) * 1000 <= threshold_m:
                group.append(c)
            else:
                still_remaining.append(c)
        remaining = still_remaining

        lat = sum(c["lat"] for c in group) / len(group)
        lng = sum(c["lng"] for c in group) / len(group)
        stops.append({
            "lat": lat,
            "lng": lng,
            "address": group[0].get("address", ""),
            "waste_types": sorted({c["waste_type"] for c in group}),
            "load_kg": sum(c.get("load_kg", 0) for c in group),
            "priority": any(c.get("priority") for c in group),
            "container_ids": [c["id"] for c in group],
            "containers": group,
        })
    return stops
