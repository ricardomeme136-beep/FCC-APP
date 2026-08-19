"""Reverse geocoding (lat/lng -> a human address) via OpenStreetMap Nominatim.

No API key needed — Nominatim's public endpoint is free for low-volume,
non-bulk use, which is exactly this: an admin manually tapping a point on
the map, at most a few times a minute. Never blocks or breaks the map-tap
flow — any error (network, rate limit, no result) just returns an empty
address, and the admin types it in manually, exactly like before this
endpoint existed.
"""
import httpx
from fastapi import APIRouter, Depends, Query

from core.security import current_user

router = APIRouter(prefix="/geocode", tags=["geocode"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
# Nominatim's usage policy requires a real identifying User-Agent — requests
# without one get blocked.
USER_AGENT = "WasteFlow-FCC-App/1.0 (local deployment, contact via app admin)"


@router.get("/reverse")
async def reverse(lat: float = Query(...), lng: float = Query(...),
                  user: dict = Depends(current_user)):
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(NOMINATIM_URL, params={
                "format": "jsonv2", "lat": lat, "lon": lng,
                "zoom": 18, "addressdetails": 1,
            }, headers={"User-Agent": USER_AGENT})
        if resp.status_code != 200:
            return {"address": None}
        data = resp.json()
        addr = data.get("address", {})
        road = addr.get("road") or addr.get("pedestrian") or addr.get("footway")
        house = addr.get("house_number")
        place = (addr.get("village") or addr.get("town") or addr.get("city")
                 or addr.get("municipality"))
        if road:
            first = f"{road} {house}" if house else road
            parts = [first] + ([place] if place else [])
            return {"address": ", ".join(parts)}
        if data.get("display_name"):
            return {"address": data["display_name"]}
        return {"address": None}
    except Exception:
        return {"address": None}
