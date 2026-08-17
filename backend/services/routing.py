"""Road routing via OpenRouteService (ORS) with a straight-line fallback.

The ORS API key lives ONLY on the backend (env ORS_API_KEY). If it is not
configured, we degrade gracefully to straight segments between stops so the
app keeps working without a key.
"""
import os
from typing import List, Dict, Tuple

import httpx

from services.geo import haversine

ORS_API_KEY = os.environ.get("ORS_API_KEY", "").strip()
ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/json"
AVG_SPEED_KMH = 28.0


def _decode_polyline(encoded: str) -> List[Dict[str, float]]:
    points, index, lat, lng = [], 0, 0, 0
    n = len(encoded)
    while index < n:
        result, shift = 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += ~(result >> 1) if (result & 1) else (result >> 1)
        result, shift = 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += ~(result >> 1) if (result & 1) else (result >> 1)
        points.append({"latitude": lat / 1e5, "longitude": lng / 1e5})
    return points


def _straight(stops: List[Tuple[float, float]]) -> Dict:
    coords = [{"latitude": s[0], "longitude": s[1]} for s in stops]
    dist_m = sum(haversine(stops[i], stops[i + 1]) for i in range(len(stops) - 1)) * 1000
    return {
        "coordinates": coords,
        "distance_m": round(dist_m, 1),
        "duration_s": round(dist_m / 1000 / AVG_SPEED_KMH * 3600, 1),
        "steps": [],
        "provider": "straight",
    }


async def road_route(stops: List[Tuple[float, float]]) -> Dict:
    """stops: list of (lat, lng). Returns geometry coordinates + steps."""
    if len(stops) < 2:
        return _straight(stops if len(stops) == 2 else stops * 2)
    if not ORS_API_KEY:
        return _straight(stops)

    # ORS caps stops; keep within a safe multi-point limit.
    stops = stops[:50]
    body = {
        "coordinates": [[s[1], s[0]] for s in stops],  # ORS = [lng, lat]
        "instructions": True,
        "instructions_format": "text",
        "language": "pt",  # the app is PT-PT throughout — steps must match
        "geometry": True,
        "units": "m",
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                ORS_URL,
                headers={"Authorization": ORS_API_KEY, "Content-Type": "application/json"},
                json=body,
            )
        if resp.status_code >= 400:
            return _straight(stops)
        data = resp.json()
        route = data["routes"][0]
        coords = _decode_polyline(route["geometry"])
        steps = []
        for seg in route.get("segments", []):
            for st in seg.get("steps", []):
                steps.append({
                    "text": st.get("instruction", ""),
                    "distance_m": st.get("distance"),
                    "duration_s": st.get("duration"),
                    "name": st.get("name"),
                })
        return {
            "coordinates": coords,
            "distance_m": round(route["summary"]["distance"], 1),
            "duration_s": round(route["summary"]["duration"], 1),
            "steps": steps,
            "provider": "openrouteservice",
        }
    except Exception:
        return _straight(stops)
