"""Route management + optimization."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import OptimizeIn
from core.security import current_user, require_roles, tenant_query, write_audit, MANAGEMENT_ROLES
from services.optimizer import generate_routes, optimize_single
from routers.entities import now_iso

router = APIRouter(tags=["routes"])


def _route_code(n: int) -> str:
    return f"R-{100 + n:03d}"


@router.get("/routes")
async def list_routes(user: dict = Depends(current_user)):
    routes = await db.routes.find(tenant_query(user), NO_ID).sort("created_at", -1).to_list(1000)
    return routes


@router.get("/routes/{rid}")
async def get_route(rid: str, user: dict = Depends(current_user)):
    r = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not r:
        raise HTTPException(404, "Rota não encontrada")
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
    r["tasks"] = tasks
    return r


@router.post("/routes/optimize")
async def optimize(body: OptimizeIn, request: Request,
                   user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    company_id = user["company_id"]
    date = body.date or datetime.now(timezone.utc).date().isoformat()

    cq = tenant_query(user, {"status": "active"})
    if body.waste_types:
        cq["waste_type"] = {"$in": body.waste_types}
    if body.zones:
        cq["zone_id"] = {"$in": body.zones}
    containers = await db.containers.find(cq, NO_ID).to_list(5000)
    if not containers:
        raise HTTPException(400, "Sem contentores para otimizar com estes filtros")

    depots = await db.depots.find(tenant_query(user), NO_ID).to_list(10)
    facilities = await db.facilities.find(tenant_query(user), NO_ID).to_list(20)
    if not depots:
        raise HTTPException(400, "Nenhum depósito configurado")
    depot = (depots[0]["lat"], depots[0]["lng"])

    facility_for = {}
    for wt in {c["waste_type"] for c in containers}:
        match = next((f for f in facilities
                      if not f.get("accepted_waste_types") or wt in f["accepted_waste_types"]), None)
        if match:
            facility_for[wt] = (match["lat"], match["lng"])

    # available trucks + drivers
    vehicles = await db.vehicles.find(
        tenant_query(user, {"status": {"$in": ["available", "assigned"]}}), NO_ID).to_list(500)
    vehicles = vehicles[: body.num_trucks] if vehicles else []
    if not vehicles:
        raise HTTPException(400, "Sem viaturas disponíveis")
    drivers = await db.drivers.find(
        tenant_query(user, {"status": {"$in": ["available", "assigned"]}}), NO_ID).to_list(500)

    trucks = [{"id": v["id"], "capacity_kg": v.get("capacity_kg", 10000),
               "allowed_waste_types": v.get("allowed_waste_types", [])} for v in vehicles]
    stops = [{"id": c["id"], "lat": c["lat"], "lng": c["lng"],
              "waste_type": c["waste_type"],
              "load_kg": c.get("capacity_kg", 400) * 0.7,
              "priority": c.get("priority", False),
              "address": c.get("address", "")} for c in containers]

    plan = generate_routes(stops, trucks, depot, facility_for)

    created = []
    for i, p in enumerate(plan):
        if not p["stops"]:
            continue
        rid = str(uuid.uuid4())
        drv = drivers[i] if i < len(drivers) else None
        end_facility = next((f for f in facilities
                             if not f.get("accepted_waste_types")
                             or p["waste_type"] in f.get("accepted_waste_types", [])), None)
        route_doc = {
            "id": rid, "company_id": company_id,
            "code": _route_code(await db.routes.count_documents({"company_id": company_id})),
            "date": date, "zone_id": None,
            "driver_id": drv["id"] if drv else None,
            "driver_name": drv["name"] if drv else None,
            "vehicle_id": p["truck_id"],
            "start_depot_id": depots[0]["id"],
            "end_facility_id": end_facility["id"] if end_facility else None,
            "waste_type": p["waste_type"],
            "num_stops": p["num_stops"],
            "distance_km": p["distance_km"],
            "duration_min": p["duration_min"],
            "capacity_utilization": p["capacity_utilization"],
            "load_kg": p["load_kg"],
            "actual_distance_km": None, "actual_duration_min": None,
            "status": "scheduled", "created_at": now_iso(),
        }
        await db.routes.insert_one(route_doc)
        # create tasks
        for seq, s in enumerate(p["stops"]):
            await db.collection_tasks.insert_one({
                "id": str(uuid.uuid4()), "company_id": company_id,
                "route_id": rid, "container_id": s["id"],
                "driver_id": drv["id"] if drv else None,
                "vehicle_id": p["truck_id"],
                "sequence": seq + 1, "waste_type": s["waste_type"],
                "address": s.get("address", ""), "lat": s["lat"], "lng": s["lng"],
                "status": "scheduled", "scheduled_date": date,
                "load_kg": None, "arrived_at": None, "completed_at": None,
                "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
            })
        # assign vehicle/driver
        await db.vehicles.update_one(tenant_query(user, {"id": p["truck_id"]}),
                                     {"$set": {"status": "assigned"}})
        if drv:
            await db.drivers.update_one(tenant_query(user, {"id": drv["id"]}),
                                        {"$set": {"status": "assigned", "vehicle_id": p["truck_id"]}})
        route_doc.pop("_id", None)
        created.append(route_doc)

    await write_audit(user, "optimize", "routes", "", request,
                      new={"count": len(created), "date": date})
    return {"routes": created, "count": len(created)}


@router.post("/routes/{rid}/reoptimize")
async def reoptimize(rid: str, request: Request,
                     user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    remaining = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid,
                            "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
        NO_ID).to_list(2000)
    if len(remaining) < 2:
        return {"message": "Nada para reotimizar", "route": route}

    depot = await db.depots.find_one(tenant_query(user, {"id": route["start_depot_id"]}), NO_ID)
    start = (depot["lat"], depot["lng"]) if depot else (remaining[0]["lat"], remaining[0]["lng"])
    end = start
    if route.get("end_facility_id"):
        fac = await db.facilities.find_one(tenant_query(user, {"id": route["end_facility_id"]}), NO_ID)
        if fac:
            end = (fac["lat"], fac["lng"])

    stops = [{"id": t["id"], "lat": t["lat"], "lng": t["lng"],
              "priority": False} for t in remaining]
    res = optimize_single(start, end, stops)
    for seq, s in enumerate(res["order"]):
        await db.collection_tasks.update_one(
            tenant_query(user, {"id": s["id"]}), {"$set": {"sequence": seq + 1}})
    await db.routes.update_one(tenant_query(user, {"id": rid}),
                               {"$set": {"distance_km": res["distance_km"],
                                         "duration_min": res["duration_min"]}})
    await write_audit(user, "reoptimize", "route", rid, request)
    return await get_route(rid, user)


@router.post("/routes/{rid}/start")
async def start_route(rid: str, user: dict = Depends(current_user)):
    r = await db.routes.update_one(tenant_query(user, {"id": rid}),
                                   {"$set": {"status": "in_progress",
                                             "started_at": now_iso()}})
    if not r.matched_count:
        raise HTTPException(404, "Rota não encontrada")
    return {"ok": True}
