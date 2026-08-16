"""Geographic helpers."""
import math
from typing import Tuple

EARTH_KM = 6371.0


def haversine(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Distance in km between (lat, lng) points."""
    lat1, lon1 = a
    lat2, lon2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def bearing(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def move_towards(a: Tuple[float, float], b: Tuple[float, float], km: float) -> Tuple[float, float]:
    """Move point a towards b by km (approx, small distances)."""
    d = haversine(a, b)
    if d < 1e-6 or km >= d:
        return b
    frac = km / d
    return (a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac)
