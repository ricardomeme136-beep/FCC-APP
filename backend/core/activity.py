"""Driver presence/activity — Fase ACTIVITY 1.

Separate from `employment_status` (HR availability, set by admins —
see DriverIn in core/models.py). `activity_status` is derived only from
real signals: login (routers/auth.py), the periodic heartbeat
(POST /drivers/me/heartbeat in routers/entities.py), and real route status.
It is NEVER fed by the simulated GPS loop in server.py::_simulate_gps.
"""
from datetime import datetime, timezone
from typing import Optional

from core.db import db, NO_ID
from core.security import tenant_query

# ~3x the expected 30-60s heartbeat/GPS interval before a driver is
# considered to have gone quiet.
OFFLINE_TIMEOUT_SECONDS = 180


def activity_status(last_seen_at: Optional[str], on_route: bool) -> str:
    if not last_seen_at:
        return "offline"
    try:
        seen = datetime.fromisoformat(last_seen_at)
    except ValueError:
        return "offline"
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - seen).total_seconds()
    if elapsed > OFFLINE_TIMEOUT_SECONDS:
        return "offline"
    return "on_route" if on_route else "online"


async def annotate_driver_activity(user: dict, drivers: list) -> list:
    """Mutates each dict in `drivers` in place, adding last_seen_at,
    activity_status and (when on_route) current_route_code /
    current_vehicle_plate. Returns the same list for convenience."""
    if not drivers:
        return drivers
    driver_ids = [d["id"] for d in drivers]
    linked_users = await db.users.find(
        tenant_query(user, {"driver_id": {"$in": driver_ids}}), NO_ID).to_list(2000)
    users_by_driver = {u["driver_id"]: u for u in linked_users}

    in_progress = await db.routes.find(
        tenant_query(user, {"driver_id": {"$in": driver_ids}, "status": "in_progress"}),
        NO_ID).to_list(2000)
    routes_by_driver = {r["driver_id"]: r for r in in_progress}

    vehicle_ids = [r["vehicle_id"] for r in in_progress if r.get("vehicle_id")]
    vehicles_by_id = {}
    if vehicle_ids:
        vs = await db.vehicles.find(
            tenant_query(user, {"id": {"$in": vehicle_ids}}), NO_ID).to_list(2000)
        vehicles_by_id = {v["id"]: v for v in vs}

    for d in drivers:
        u = users_by_driver.get(d["id"])
        last_seen = u.get("last_seen_at") if u else None
        r = routes_by_driver.get(d["id"])
        d["last_seen_at"] = last_seen
        d["activity_status"] = activity_status(last_seen, r is not None)
        d["current_route_code"] = r.get("code") if r else None
        veh = vehicles_by_id.get(r.get("vehicle_id")) if r else None
        d["current_vehicle_plate"] = veh.get("plate") if veh else None
    return drivers
