"""GPS ingestion and live fleet positions."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.db import db, NO_ID
from core.models import GpsIn
from core.security import current_user, tenant_query
from routers.entities import now_iso

router = APIRouter(tags=["gps"])


@router.post("/gps/location")
async def post_location(body: GpsIn, user: dict = Depends(current_user)):
    """A driver can only ever report a position for the vehicle on their own
    in_progress route — the vehicle_id is resolved server-side from the
    authenticated driver, never trusted from the request body. Non-driver
    roles (e.g. an admin tool) may still target an explicit vehicle_id."""
    vehicle_id = body.vehicle_id
    if user["role"] == "driver":
        if not user.get("driver_id"):
            raise HTTPException(403, "Esta conta não está associada a um motorista")
        route = await db.routes.find_one(
            tenant_query(user, {"driver_id": user["driver_id"], "status": "in_progress"}), NO_ID)
        if not route or not route.get("vehicle_id"):
            raise HTTPException(400, "Sem rota em curso com viatura atribuída")
        vehicle_id = route["vehicle_id"]

    vehicle = await db.vehicles.find_one(tenant_query(user, {"id": vehicle_id}), NO_ID)
    if not vehicle:
        raise HTTPException(404, "Viatura não encontrada")

    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"],
           "vehicle_id": vehicle_id, "lat": body.lat, "lng": body.lng,
           "speed": body.speed, "heading": body.heading, "status": body.status,
           "source": "device", "timestamp": now_iso()}
    await db.gps_positions.insert_one(doc)
    await db.vehicles.update_one(
        tenant_query(user, {"id": vehicle_id}),
        {"$set": {"status": body.status if body.status else "en_route"}})
    doc.pop("_id", None)
    return doc


@router.get("/gps/live")
async def live_positions(user: dict = Depends(current_user)):
    """Latest position for every vehicle in the tenant."""
    vehicles = await db.vehicles.find(tenant_query(user), NO_ID).to_list(2000)
    out = []
    for v in vehicles:
        pos = await db.gps_positions.find_one(
            {"vehicle_id": v["id"]}, NO_ID, sort=[("timestamp", -1)])
        if pos:
            driver = None
            if v.get("driver_id"):
                driver = await db.drivers.find_one(
                    tenant_query(user, {"id": v["driver_id"]}), NO_ID)
            out.append({**pos, "plate": v.get("plate"),
                        "vehicle_status": v.get("status"),
                        "driver_name": driver["name"] if driver else None})
    return out


@router.get("/gps/history/{vehicle_id}")
async def gps_history(vehicle_id: str, date: str = None,
                      user: dict = Depends(current_user)):
    q = {"vehicle_id": vehicle_id, "company_id": user.get("company_id")}
    if user["role"] == "super_admin":
        q.pop("company_id")
    positions = await db.gps_positions.find(q, NO_ID).sort("timestamp", 1).to_list(5000)
    if date:
        positions = [p for p in positions if p["timestamp"][:10] == date]
    return positions
