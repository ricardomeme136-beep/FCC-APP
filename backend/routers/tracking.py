"""Recorded driver trajectories ("GRAVAR TRAJETO") — an explicit, driver-
initiated recording distinct from the always-on live GPS feed in
routers/gps.py. Never runs on its own: a session only exists between a
driver's own POST .../start and .../finish (or /cancel), matching the
privacy rule that GPS is only ever recorded while a route is in_progress OR
while a recording is explicitly active — never continuously.

Points are written into the *same* gps_positions collection as live nav GPS
(tagged with tracking_session_id/route_id/driver_id/point_uuid) rather than a
separate collection — one source of truth for "where has this vehicle been",
reusable by GET /gps/history, and it means a recorded trajectory naturally
also updates the admin's live map like any other real device position.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.db import db, NO_ID
from core.models import TrackingSessionStartIn, TrackingPointsIn
from core.security import current_user, tenant_query
from routers.entities import now_iso
from routers.routes import route_geometry
from services.geo import haversine

router = APIRouter(prefix="/tracking-sessions", tags=["tracking"])


def _driver_scope(user: dict, extra: dict) -> dict:
    q = tenant_query(user, extra)
    q["driver_id"] = user.get("driver_id")
    return q


async def _own_recording(sid: str, user: dict) -> dict:
    session = await db.tracking_sessions.find_one(_driver_scope(user, {"id": sid}), NO_ID)
    if not session:
        raise HTTPException(404, "Sessão de gravação não encontrada")
    return session


@router.post("/start")
async def start_session(body: TrackingSessionStartIn, user: dict = Depends(current_user)):
    """Only a driver can start a recording of their own trajectory — this is
    an explicit, physical action ("carrega GRAVAR TRAJETO"), not something an
    admin can trigger remotely on someone else's phone."""
    if user["role"] != "driver":
        raise HTTPException(403, "Só um motorista pode iniciar uma gravação de trajeto")
    if not user.get("driver_id"):
        raise HTTPException(403, "Esta conta não está associada a um motorista")

    already = await db.tracking_sessions.find_one(
        _driver_scope(user, {"status": "recording"}), NO_ID)
    if already:
        raise HTTPException(400, "Já tem uma gravação em curso")

    driver = await db.drivers.find_one(tenant_query(user, {"id": user["driver_id"]}), NO_ID)
    route = await db.routes.find_one(
        tenant_query(user, {"driver_id": user["driver_id"], "status": "in_progress"}), NO_ID)
    vehicle_id = (route or {}).get("vehicle_id") or (driver or {}).get("vehicle_id")
    if not vehicle_id:
        raise HTTPException(400, "Sem viatura atribuída — não é possível gravar o trajeto")

    doc = {
        "id": str(uuid.uuid4()), "company_id": user["company_id"],
        "driver_id": user["driver_id"], "vehicle_id": vehicle_id,
        "route_id": route["id"] if route else None,
        "started_at": now_iso(), "ended_at": None, "status": "recording",
        "distance_km": 0.0, "duration_min": 0.0, "point_count": 0,
        "last_lat": body.lat, "last_lng": body.lng,
    }
    await db.tracking_sessions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/{sid}/points")
async def add_points(sid: str, body: TrackingPointsIn, user: dict = Depends(current_user)):
    """Idempotent batch insert — a resent batch (retried after a dropped
    response) never double-inserts a point or double-counts its distance,
    keyed on the client-generated point_uuid."""
    if user["role"] != "driver":
        raise HTTPException(403, "Só o motorista pode adicionar pontos à sua gravação")
    session = await _own_recording(sid, user)
    if session["status"] != "recording":
        raise HTTPException(400, "Esta gravação já foi terminada")
    if not body.points:
        return {"inserted": 0, "point_count": session["point_count"]}

    points_sorted = sorted(body.points, key=lambda p: p.timestamp)
    prev_lat, prev_lng = session.get("last_lat"), session.get("last_lng")
    dist_km_delta = 0.0
    inserted = 0
    for p in points_sorted:
        doc = {
            "id": str(uuid.uuid4()), "point_uuid": p.point_uuid,
            "company_id": user["company_id"], "vehicle_id": session["vehicle_id"],
            "driver_id": user["driver_id"], "route_id": session.get("route_id"),
            "tracking_session_id": sid,
            "lat": p.lat, "lng": p.lng, "speed": p.speed, "heading": p.heading,
            "accuracy": p.accuracy, "altitude": p.altitude,
            "source": "device", "status": "en_route", "timestamp": p.timestamp,
        }
        result = await db.gps_positions.update_one(
            {"point_uuid": p.point_uuid}, {"$setOnInsert": doc}, upsert=True)
        # Only a NEWLY inserted point contributes distance — a duplicate from
        # a retried batch must not be counted twice. Its coordinates still
        # become the new "prev" anchor either way, since the vehicle really
        # did pass through that point.
        if result.upserted_id is not None:
            inserted += 1
            if prev_lat is not None:
                dist_km_delta += haversine((prev_lat, prev_lng), (p.lat, p.lng))
        prev_lat, prev_lng = p.lat, p.lng

    await db.tracking_sessions.update_one({"id": sid}, {
        "$inc": {"distance_km": round(dist_km_delta, 3), "point_count": inserted},
        "$set": {"last_lat": prev_lat, "last_lng": prev_lng},
    })
    updated = await db.tracking_sessions.find_one({"id": sid}, NO_ID)
    return {"inserted": inserted, "point_count": updated["point_count"], "distance_km": updated["distance_km"]}


@router.post("/{sid}/finish")
async def finish_session(sid: str, user: dict = Depends(current_user)):
    if user["role"] != "driver":
        raise HTTPException(403, "Só o motorista pode terminar a sua gravação")
    session = await _own_recording(sid, user)
    if session["status"] != "recording":
        raise HTTPException(400, "Esta gravação já foi terminada")
    ended_at = now_iso()
    started = datetime.fromisoformat(session["started_at"])
    ended = datetime.fromisoformat(ended_at)
    duration_min = round((ended - started).total_seconds() / 60, 1)
    await db.tracking_sessions.update_one({"id": sid}, {"$set": {
        "status": "completed", "ended_at": ended_at, "duration_min": duration_min,
    }})
    doc = await db.tracking_sessions.find_one({"id": sid}, NO_ID)
    return doc


@router.post("/{sid}/cancel")
async def cancel_session(sid: str, user: dict = Depends(current_user)):
    """For an accidental start — the recording and its points are kept (not
    deleted), just marked cancelled so it never shows as a real completed
    trajectory in the admin history."""
    if user["role"] != "driver":
        raise HTTPException(403, "Só o motorista pode cancelar a sua gravação")
    session = await _own_recording(sid, user)
    if session["status"] != "recording":
        raise HTTPException(400, "Esta gravação já foi terminada")
    await db.tracking_sessions.update_one({"id": sid}, {"$set": {
        "status": "cancelled", "ended_at": now_iso(),
    }})
    doc = await db.tracking_sessions.find_one({"id": sid}, NO_ID)
    return doc


@router.get("")
async def list_sessions(user: dict = Depends(current_user)):
    q = tenant_query(user)
    if user["role"] == "driver":
        if not user.get("driver_id"):
            return []
        q["driver_id"] = user["driver_id"]
    sessions = await db.tracking_sessions.find(q, NO_ID).sort("started_at", -1).to_list(500)

    driver_ids = {s["driver_id"] for s in sessions}
    vehicle_ids = {s["vehicle_id"] for s in sessions}
    drivers = await db.drivers.find(tenant_query(user, {"id": {"$in": list(driver_ids)}}), NO_ID).to_list(2000)
    vehicles = await db.vehicles.find(tenant_query(user, {"id": {"$in": list(vehicle_ids)}}), NO_ID).to_list(2000)
    driver_by_id = {d["id"]: d for d in drivers}
    vehicle_by_id = {v["id"]: v for v in vehicles}
    for s in sessions:
        s["driver_name"] = driver_by_id.get(s["driver_id"], {}).get("name")
        s["vehicle_plate"] = vehicle_by_id.get(s["vehicle_id"], {}).get("plate")
    return sessions


@router.get("/{sid}")
async def get_session(sid: str, user: dict = Depends(current_user)):
    q = tenant_query(user, {"id": sid})
    if user["role"] == "driver":
        q["driver_id"] = user.get("driver_id")
    session = await db.tracking_sessions.find_one(q, NO_ID)
    if not session:
        raise HTTPException(404, "Sessão de gravação não encontrada")
    points = await db.gps_positions.find(
        tenant_query(user, {"tracking_session_id": sid}), NO_ID
    ).sort("timestamp", 1).to_list(20000)
    driver = await db.drivers.find_one(tenant_query(user, {"id": session["driver_id"]}), NO_ID)
    vehicle = await db.vehicles.find_one(tenant_query(user, {"id": session["vehicle_id"]}), NO_ID)

    # Planned vs real (point 15 of the spec) — only when this recording is
    # tied to a managed route. Reuses the same cached geometry the driver's
    # own navigation screen and the admin route map already show, so the
    # "planned" line here is guaranteed to be the exact same one everywhere.
    planned = None
    if session.get("route_id"):
        try:
            planned = await route_geometry(session["route_id"], user)
        except HTTPException:
            planned = None

    return {
        **session,
        "driver_name": driver["name"] if driver else None,
        "vehicle_plate": vehicle["plate"] if vehicle else None,
        "points": points,
        "planned": planned,
    }
