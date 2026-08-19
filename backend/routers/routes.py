"""Route management + optimization."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import (OptimizeIn, StopReorderIn, StopMoveIn, StopCreateIn,
                         PreviewGeometryIn, PreviewOptimizeIn, ManualRouteIn,
                         RouteAssignmentIn, RouteStartIn, RouteFinishIn, RouteDeleteIn,
                         SaveRouteAsTemplateIn)
from core.security import current_user, require_roles, tenant_query, write_audit, verify_password, MANAGEMENT_ROLES
from services.optimizer import generate_routes, optimize_single, _route_distance, AVG_SPEED_KMH, SERVICE_MIN_PER_STOP
from services.routing import road_route
from services.stops import cluster_into_stops
from routers.entities import now_iso

router = APIRouter(tags=["routes"])


def _route_code(n: int) -> str:
    return f"R-{100 + n:03d}"


def _stop_id(route_id: str, index: int) -> str:
    """Deterministic id for the i-th proximity-grouped stop of a route —
    shared by the virtual-stops view and the on-demand backfill so an id a
    client saw before a backfill is still the right id after one."""
    return f"{route_id}-stop-{index}"


async def _stops_for_route(user: dict, route_id: str, tasks: list) -> list:
    """Persisted route_stops for this route if they exist, each with its
    `tasks` attached. Falls back to *virtual* (computed, never persisted)
    stops grouped by proximity for routes created before route_stops
    existed — so old data keeps working without any migration."""
    stops = await db.route_stops.find(
        tenant_query(user, {"route_id": route_id}), NO_ID).sort("sequence", 1).to_list(2000)
    if stops:
        by_stop: dict = {}
        for t in tasks:
            by_stop.setdefault(t.get("stop_id"), []).append(t)
        for s in stops:
            s["tasks"] = by_stop.get(s["id"], [])
        return stops

    if not tasks:
        return []
    grouped = cluster_into_stops([
        {"id": t["id"], "lat": t["lat"], "lng": t["lng"], "waste_type": t["waste_type"],
         "load_kg": t.get("load_kg") or 0, "priority": False, "address": t.get("address", "")}
        for t in tasks
    ])
    tasks_by_id = {t["id"]: t for t in tasks}
    virtual = []
    for i, g in enumerate(grouped):
        s_tasks = [tasks_by_id[tid] for tid in g["container_ids"] if tid in tasks_by_id]
        virtual.append({
            # Deterministic — the SAME id _ensure_persisted_stops() will use
            # when it backfills these into real route_stops, so an id a
            # client saw from this virtual view stays valid after an edit
            # triggers the backfill (no stale-id 400 on the very next call).
            "id": _stop_id(route_id, i), "company_id": user.get("company_id"),
            "route_id": route_id, "sequence": i + 1,
            "lat": g["lat"], "lng": g["lng"], "address": g["address"],
            "waste_types": g["waste_types"], "task_ids": [t["id"] for t in s_tasks],
            "virtual": True, "tasks": s_tasks,
        })
    return virtual


async def _ensure_persisted_stops(user: dict, route: dict) -> None:
    """If this route only has virtual (unpersisted) stops — created before
    route_stops existed — persist them now, on first edit attempt, so the
    stop-editing endpoints below always have something real to work with."""
    rid = route["id"]
    existing = await db.route_stops.count_documents(tenant_query(user, {"route_id": rid}))
    if existing:
        return
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
    if not tasks:
        return
    grouped = cluster_into_stops([
        {"id": t["id"], "lat": t["lat"], "lng": t["lng"], "waste_type": t["waste_type"],
         "load_kg": t.get("load_kg") or 0, "priority": False, "address": t.get("address", "")}
        for t in tasks
    ])
    for i, g in enumerate(grouped):
        stop_id = _stop_id(rid, i)
        task_ids = g["container_ids"]  # cluster_into_stops was fed tasks, so these are task ids
        await db.route_stops.insert_one({
            "id": stop_id, "company_id": route.get("company_id"), "route_id": rid,
            "sequence": i + 1, "lat": g["lat"], "lng": g["lng"], "address": g["address"],
            "waste_types": g["waste_types"], "task_ids": task_ids, "created_at": now_iso(),
        })
        await db.collection_tasks.update_many(
            tenant_query(user, {"id": {"$in": task_ids}}), {"$set": {"stop_id": stop_id}})


async def _apply_stop_order(user: dict, rid: str, ordered_stops: list) -> None:
    """Writes route_stops.sequence for the given full ordered list, then
    cascades to collection_tasks.sequence — but only for tasks still pending;
    already collected/failed/ignored tasks keep their sequence untouched
    (same rule reoptimize() already follows)."""
    for i, s in enumerate(ordered_stops):
        await db.route_stops.update_one(
            tenant_query(user, {"id": s["id"]}), {"$set": {"sequence": i + 1}})
    all_tasks = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid}), NO_ID).to_list(2000)
    tasks_by_stop: dict = {}
    for t in all_tasks:
        tasks_by_stop.setdefault(t.get("stop_id"), []).append(t)
    seq = 0
    for s in ordered_stops:
        for t in sorted(tasks_by_stop.get(s["id"], []), key=lambda x: x["sequence"]):
            if t["status"] in ("collected", "failed", "ignored"):
                continue
            seq += 1
            await db.collection_tasks.update_one(
                tenant_query(user, {"id": t["id"]}), {"$set": {"sequence": seq}})


def _driver_scope(user: dict, extra: Optional[dict] = None) -> dict:
    """A driver only ever sees their own routes — never another driver's by
    guessing/enumerating ids. Every other role keeps the normal tenant scope."""
    q = tenant_query(user, extra)
    if user["role"] == "driver":
        q["driver_id"] = user.get("driver_id")
    return q


# A completed/cancelled route is historical record — its shape (which stops,
# in what order, with which containers) must never change after the fact, or
# every "actual vs planned" comparison and audit trail built on top of it
# becomes unreliable. in_progress is a middle ground: reoptimize() was built
# specifically to be safe mid-route (it only ever resequences tasks still
# scheduled/en_route/arrived — anything collected/failed is left exactly
# where it is), so it stays allowed; a blind manual reorder/move/add/remove
# was not built with "the driver is currently out on this route" in mind, so
# those are blocked by default while in_progress too.
STRUCTURAL_EDIT_STATUSES = {"scheduled"}
REOPTIMIZE_STATUSES = {"scheduled", "in_progress"}
_STATUS_LABEL_PT = {"in_progress": "em curso", "completed": "concluída", "cancelled": "arquivada/eliminada"}


def assert_route_editable(route: dict, *, for_reoptimize: bool = False) -> None:
    """Single guard for every stop-structure-changing endpoint below (reorder,
    move, add, remove stop) plus reoptimize()'s structural resequencing.
    Never used for task-level actions (complete/fail/ignore), route
    start/finish, or tracking — those have their own, unrelated status rules."""
    allowed = REOPTIMIZE_STATUSES if for_reoptimize else STRUCTURAL_EDIT_STATUSES
    if route["status"] not in allowed:
        label = _STATUS_LABEL_PT.get(route["status"], route["status"])
        raise HTTPException(409, f"Esta rota está {label} — já não é possível alterar a sua estrutura")


@router.get("/routes")
async def list_routes(user: dict = Depends(current_user)):
    routes = await db.routes.find(_driver_scope(user), NO_ID).sort("created_at", -1).to_list(1000)
    return routes


@router.get("/routes/{rid}")
async def get_route(rid: str, user: dict = Depends(current_user)):
    r = await db.routes.find_one(_driver_scope(user, {"id": rid}), NO_ID)
    if not r:
        raise HTTPException(404, "Rota não encontrada")
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
    r["tasks"] = tasks
    r["stops"] = await _stops_for_route(user, rid, tasks)
    return r


@router.patch("/routes/{rid}/assignment")
async def update_assignment(rid: str, body: RouteAssignmentIn, request: Request,
                            user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Assign or swap the driver and/or vehicle on an existing route (Fase
    PROD2) — never recreates the route, never duplicates tasks. Cascades to
    every not-yet-actioned task so the old driver stops seeing it and the
    new one starts seeing it on their very next request; already
    collected/failed tasks keep their original driver_id/vehicle_id as a
    historical record of who actually did the work."""
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")

    updates: dict = {}
    task_updates: dict = {}

    if body.driver_id is not None and body.driver_id != route.get("driver_id"):
        new_driver = await db.drivers.find_one(tenant_query(user, {"id": body.driver_id}), NO_ID)
        if not new_driver:
            raise HTTPException(400, "Motorista inválido")
        old_name = route.get("driver_name")
        updates["driver_id"] = body.driver_id
        updates["driver_name"] = new_driver["name"]
        task_updates["driver_id"] = body.driver_id
        if route.get("driver_id"):
            await db.drivers.update_one(tenant_query(user, {"id": route["driver_id"]}),
                                        {"$set": {"status": "available"}})
        await db.drivers.update_one(tenant_query(user, {"id": body.driver_id}),
                                    {"$set": {"status": "assigned"}})
        msg = f"Motorista da rota {route['code']} alterado de {old_name or 'ninguém'} para {new_driver['name']}."
        await write_audit(user, "reassign_driver", "route", rid, request,
                          old={"driver_name": old_name},
                          new={"driver_name": new_driver["name"], "message": msg})

    if body.vehicle_id is not None and body.vehicle_id != route.get("vehicle_id"):
        new_vehicle = await db.vehicles.find_one(tenant_query(user, {"id": body.vehicle_id}), NO_ID)
        if not new_vehicle:
            raise HTTPException(400, "Viatura inválida")
        old_plate = None
        if route.get("vehicle_id"):
            old_v = await db.vehicles.find_one(tenant_query(user, {"id": route["vehicle_id"]}), NO_ID)
            old_plate = old_v["plate"] if old_v else None
            await db.vehicles.update_one(tenant_query(user, {"id": route["vehicle_id"]}),
                                         {"$set": {"status": "available"}})
        updates["vehicle_id"] = body.vehicle_id
        task_updates["vehicle_id"] = body.vehicle_id
        await db.vehicles.update_one(tenant_query(user, {"id": body.vehicle_id}),
                                     {"$set": {"status": "assigned"}})
        msg = f"Viatura da rota {route['code']} alterada de {old_plate or 'nenhuma'} para {new_vehicle['plate']}."
        await write_audit(user, "reassign_vehicle", "route", rid, request,
                          old={"vehicle_plate": old_plate},
                          new={"vehicle_plate": new_vehicle["plate"], "message": msg})

    if not updates:
        return await get_route(rid, user)

    await db.routes.update_one(tenant_query(user, {"id": rid}), {"$set": updates})
    if task_updates:
        await db.collection_tasks.update_many(
            tenant_query(user, {"route_id": rid, "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
            {"$set": task_updates})

    return await get_route(rid, user)


@router.post("/routes/optimize")
async def optimize(body: OptimizeIn, request: Request,
                   user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    company_id = user["company_id"]
    date = body.date or datetime.now(timezone.utc).date().isoformat()

    if body.container_ids:
        cq = tenant_query(user, {"id": {"$in": body.container_ids}})
    else:
        cq = tenant_query(user, {"status": "active"})
        if body.waste_types:
            cq["waste_type"] = {"$in": body.waste_types}
        if body.zones:
            cq["zone_id"] = {"$in": body.zones}
    containers = await db.containers.find(cq, NO_ID).to_list(5000)
    if not containers:
        raise HTTPException(400, "Sem contentores para otimizar com estes filtros")

    # Explicit container_ids bypasses the status="active" filter above — an
    # archived container must still never end up on a new route.
    if body.container_ids:
        archived = sorted({c.get("qr_code", c["id"]) for c in containers if c.get("status") != "active"})
        if archived:
            raise HTTPException(400, f"Contentor(es) arquivado(s), não podem ser usados: {', '.join(archived)}")

    # Don't double-book a container that already has a pending pickup that day.
    dup_tasks = await db.collection_tasks.find(
        tenant_query(user, {"container_id": {"$in": [c["id"] for c in containers]},
                            "scheduled_date": date,
                            "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
        NO_ID).to_list(5000)
    skipped_duplicate = sorted({t["container_id"] for t in dup_tasks})
    if skipped_duplicate:
        containers = [c for c in containers if c["id"] not in skipped_duplicate]
    if not containers:
        raise HTTPException(400, "Todos os contentores selecionados já têm recolhas agendadas para esta data.")

    depots = await db.depots.find(tenant_query(user), NO_ID).to_list(500)
    facilities = await db.facilities.find(tenant_query(user), NO_ID).to_list(20)
    if not depots:
        raise HTTPException(400, "Nenhum depósito configurado")
    depot_doc = next((d for d in depots if d.get("is_primary")), depots[0])
    if body.depot_id:
        depot_doc = next((d for d in depots if d["id"] == body.depot_id), None)
        if not depot_doc:
            raise HTTPException(400, "Depósito inválido")
    depot = (depot_doc["lat"], depot_doc["lng"])

    chosen_facility = None
    if body.facility_id:
        chosen_facility = next((f for f in facilities if f["id"] == body.facility_id), None)
        if not chosen_facility:
            raise HTTPException(400, "Centro de tratamento inválido")

    facility_for = {}
    for wt in {c["waste_type"] for c in containers}:
        if chosen_facility:
            facility_for[wt] = (chosen_facility["lat"], chosen_facility["lng"])
            continue
        match = next((f for f in facilities
                      if not f.get("accepted_waste_types") or wt in f["accepted_waste_types"]), None)
        if match:
            facility_for[wt] = (match["lat"], match["lng"])

    # available trucks + drivers
    if body.vehicle_ids:
        vehicles = await db.vehicles.find(
            tenant_query(user, {"id": {"$in": body.vehicle_ids}}), NO_ID).to_list(500)
        if len(vehicles) != len(set(body.vehicle_ids)):
            raise HTTPException(400, "Uma ou mais viaturas não foram encontradas")
        not_eligible = next((v for v in vehicles if v.get("status") not in ("available", "assigned")), None)
        if not_eligible:
            raise HTTPException(400, f"Viatura {not_eligible.get('plate')} não está disponível")
    else:
        vehicles = await db.vehicles.find(
            tenant_query(user, {"status": {"$in": ["available", "assigned"]}}), NO_ID).to_list(500)
        vehicles = vehicles[: body.num_trucks] if vehicles else []
    if not vehicles:
        raise HTTPException(400, "Sem viaturas disponíveis")

    if body.driver_ids:
        drivers = await db.drivers.find(
            tenant_query(user, {"id": {"$in": body.driver_ids}}), NO_ID).to_list(500)
        not_eligible_d = next((d for d in drivers if d.get("status") not in ("available", "assigned")), None)
        if not_eligible_d:
            raise HTTPException(400, f"Motorista {not_eligible_d.get('name')} não está disponível")
    else:
        drivers = await db.drivers.find(
            tenant_query(user, {"status": {"$in": ["available", "assigned"]}}), NO_ID).to_list(500)

    trucks = [{"id": v["id"], "capacity_kg": v.get("capacity_kg", 10000),
               "allowed_waste_types": v.get("allowed_waste_types", [])} for v in vehicles]
    container_inputs = [{"id": c["id"], "lat": c["lat"], "lng": c["lng"],
                         "waste_type": c["waste_type"],
                         "load_kg": c.get("capacity_kg", 400) * 0.7,
                         "priority": c.get("priority", False),
                         "address": c.get("address", "")} for c in containers]
    # Group containers standing at (or very near) the same location into a
    # single paragem before handing them to the optimizer — a truck visits
    # the location once, not once per container.
    paragens = cluster_into_stops(container_inputs)

    plan = generate_routes(paragens, trucks, depot, facility_for)

    created = []
    for i, p in enumerate(plan):
        if not p["stops"]:
            continue
        rid = str(uuid.uuid4())
        drv = drivers[i] if i < len(drivers) else None
        if chosen_facility:
            end_facility = chosen_facility
        else:
            end_facility = next((f for f in facilities
                                 if not f.get("accepted_waste_types")
                                 or p["waste_type"] in f.get("accepted_waste_types", [])), None)
        # num_stops keeps meaning "number of collections" (containers), not
        # "number of physical locations" — same figure the UI already shows.
        num_collections = sum(len(st["containers"]) for st in p["stops"])
        route_doc = {
            "id": rid, "company_id": company_id,
            "code": _route_code(await db.routes.count_documents({"company_id": company_id})),
            "date": date, "zone_id": None,
            "driver_id": drv["id"] if drv else None,
            "driver_name": drv["name"] if drv else None,
            "vehicle_id": p["truck_id"],
            "start_depot_id": depot_doc["id"],
            "end_facility_id": end_facility["id"] if end_facility else None,
            "waste_type": p["waste_type"],
            "num_stops": num_collections,
            "distance_km": p["distance_km"],
            "duration_min": p["duration_min"],
            "capacity_utilization": p["capacity_utilization"],
            "load_kg": p["load_kg"],
            "actual_distance_km": None, "actual_duration_min": None,
            "template_id": None,
            "status": "scheduled", "created_at": now_iso(),
        }
        await db.routes.insert_one(route_doc)
        # create one route_stop per physical location, one collection_task
        # per container at that location (task-level behaviour is unchanged —
        # each container keeps its own task and history).
        task_seq = 0
        for stop_seq, st in enumerate(p["stops"]):
            stop_id = str(uuid.uuid4())
            task_ids = []
            for sc in st["containers"]:
                task_seq += 1
                tid = str(uuid.uuid4())
                task_ids.append(tid)
                await db.collection_tasks.insert_one({
                    "id": tid, "company_id": company_id,
                    "route_id": rid, "container_id": sc["id"], "stop_id": stop_id,
                    "driver_id": drv["id"] if drv else None,
                    "vehicle_id": p["truck_id"],
                    "sequence": task_seq, "waste_type": sc["waste_type"],
                    "address": sc.get("address", ""), "lat": sc["lat"], "lng": sc["lng"],
                    "status": "scheduled", "scheduled_date": date,
                    "load_kg": None, "arrived_at": None, "completed_at": None,
                    "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
                })
            await db.route_stops.insert_one({
                "id": stop_id, "company_id": company_id, "route_id": rid,
                "sequence": stop_seq + 1, "lat": st["lat"], "lng": st["lng"],
                "address": st.get("address", ""), "waste_types": st["waste_types"],
                "task_ids": task_ids, "created_at": now_iso(),
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
    return {"routes": created, "count": len(created), "skipped_duplicate": skipped_duplicate}


@router.post("/routes/{rid}/reoptimize")
async def reoptimize(rid: str, request: Request,
                     user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    assert_route_editable(route, for_reoptimize=True)
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

    # Reoptimize at paragem granularity when the route has persisted stops for
    # every remaining task; cascade the new order down to each stop's tasks.
    # Routes created before route_stops existed fall back to the old
    # per-task behaviour unchanged.
    remaining_stop_ids = {t.get("stop_id") for t in remaining if t.get("stop_id")}
    persisted_stops = []
    if remaining_stop_ids:
        persisted_stops = await db.route_stops.find(
            tenant_query(user, {"route_id": rid, "id": {"$in": list(remaining_stop_ids)}}),
            NO_ID).to_list(2000)

    if persisted_stops and len(persisted_stops) == len(remaining_stop_ids):
        units = [{"id": s["id"], "lat": s["lat"], "lng": s["lng"], "priority": False}
                 for s in persisted_stops]
        res = optimize_single(start, end, units)
        tasks_by_stop: dict = {}
        for t in remaining:
            tasks_by_stop.setdefault(t.get("stop_id"), []).append(t)
        seq = 0
        for stop_seq, s in enumerate(res["order"]):
            await db.route_stops.update_one(
                tenant_query(user, {"id": s["id"]}), {"$set": {"sequence": stop_seq + 1}})
            for t in tasks_by_stop.get(s["id"], []):
                seq += 1
                await db.collection_tasks.update_one(
                    tenant_query(user, {"id": t["id"]}), {"$set": {"sequence": seq}})
    else:
        units = [{"id": t["id"], "lat": t["lat"], "lng": t["lng"],
                  "priority": False} for t in remaining]
        res = optimize_single(start, end, units)
        for seq, s in enumerate(res["order"]):
            await db.collection_tasks.update_one(
                tenant_query(user, {"id": s["id"]}), {"$set": {"sequence": seq + 1}})

    await db.routes.update_one(tenant_query(user, {"id": rid}),
                               {"$set": {"distance_km": res["distance_km"],
                                         "duration_min": res["duration_min"],
                                         "geometry_cache": None}})
    await write_audit(user, "reoptimize", "route", rid, request)
    return await get_route(rid, user)


@router.patch("/routes/{rid}/stops/reorder")
async def reorder_stops(rid: str, body: StopReorderIn, request: Request,
                        user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    assert_route_editable(route)
    await _ensure_persisted_stops(user, route)

    stops = await db.route_stops.find(tenant_query(user, {"route_id": rid}), NO_ID).to_list(2000)
    by_id = {s["id"]: s for s in stops}
    if set(body.stop_ids) != set(by_id.keys()):
        raise HTTPException(400, "A lista tem de conter exatamente todas as paragens da rota")

    ordered = [by_id[sid] for sid in body.stop_ids]
    await _apply_stop_order(user, rid, ordered)
    await db.routes.update_one(tenant_query(user, {"id": rid}), {"$set": {"geometry_cache": None}})
    await write_audit(user, "reorder", "route_stops", rid, request, new={"order": body.stop_ids})
    return await get_route(rid, user)


@router.post("/routes/{rid}/stops/{sid}/move")
async def move_stop(rid: str, sid: str, body: StopMoveIn, request: Request,
                    user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    source = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not source:
        raise HTTPException(404, "Rota de origem não encontrada")
    assert_route_editable(source)
    target = await db.routes.find_one(tenant_query(user, {"id": body.target_route_id}), NO_ID)
    if not target:
        raise HTTPException(404, "Rota de destino não encontrada")
    assert_route_editable(target)
    if target["id"] == source["id"]:
        raise HTTPException(400, "A paragem já está nesta rota")
    if target["date"] != source["date"]:
        raise HTTPException(400, "A rota de destino tem de ser da mesma data")

    await _ensure_persisted_stops(user, source)
    stop = await db.route_stops.find_one(tenant_query(user, {"id": sid, "route_id": rid}), NO_ID)
    if not stop:
        raise HTTPException(404, "Paragem não encontrada")
    tasks = await db.collection_tasks.find(tenant_query(user, {"stop_id": sid}), NO_ID).to_list(200)
    if any(t["status"] in ("collected", "failed") for t in tasks):
        raise HTTPException(409, "Não é possível mover: há tarefas já concluídas ou falhadas nesta paragem.")

    target_vehicle = None
    if target.get("vehicle_id"):
        target_vehicle = await db.vehicles.find_one(
            tenant_query(user, {"id": target["vehicle_id"]}), NO_ID)
    if target_vehicle:
        stop_types = set(stop.get("waste_types", []))
        allowed = set(target_vehicle.get("allowed_waste_types") or [])
        if allowed and not stop_types.issubset(allowed):
            raise HTTPException(400, "A viatura de destino não aceita todos os tipos de resíduo desta paragem.")
        containers = await db.containers.find(
            tenant_query(user, {"id": {"$in": [t["container_id"] for t in tasks]}}), NO_ID).to_list(200)
        stop_load = sum((c.get("capacity_kg", 400) * 0.7) for c in containers)
        if (target.get("load_kg") or 0) + stop_load > target_vehicle.get("capacity_kg", 10000):
            raise HTTPException(400, "A viatura de destino não tem capacidade livre suficiente.")

    target_stops = await db.route_stops.find(tenant_query(user, {"route_id": target["id"]}), NO_ID).to_list(2000)
    next_stop_seq = max((s["sequence"] for s in target_stops), default=0) + 1
    target_tasks = await db.collection_tasks.find(tenant_query(user, {"route_id": target["id"]}), NO_ID).to_list(2000)
    next_task_seq = max((t["sequence"] for t in target_tasks), default=0) + 1

    await db.route_stops.update_one(
        tenant_query(user, {"id": sid}),
        {"$set": {"route_id": target["id"], "sequence": next_stop_seq}})
    for i, t in enumerate(sorted(tasks, key=lambda x: x["sequence"])):
        await db.collection_tasks.update_one(
            tenant_query(user, {"id": t["id"]}),
            {"$set": {"route_id": target["id"], "vehicle_id": target.get("vehicle_id"),
                      "driver_id": target.get("driver_id"), "sequence": next_task_seq + i}})

    await db.routes.update_one(tenant_query(user, {"id": rid}), {"$set": {"geometry_cache": None}})
    await db.routes.update_one(tenant_query(user, {"id": target["id"]}), {"$set": {"geometry_cache": None}})
    src_count = await db.collection_tasks.count_documents(tenant_query(user, {"route_id": rid}))
    tgt_count = await db.collection_tasks.count_documents(tenant_query(user, {"route_id": target["id"]}))
    await db.routes.update_one(tenant_query(user, {"id": rid}), {"$set": {"num_stops": src_count}})
    await db.routes.update_one(tenant_query(user, {"id": target["id"]}), {"$set": {"num_stops": tgt_count}})

    await write_audit(user, "move", "route_stop", sid, request,
                      old={"route_id": rid}, new={"route_id": target["id"]})
    return await get_route(rid, user)


@router.post("/routes/{rid}/stops")
async def add_stop(rid: str, body: StopCreateIn, request: Request,
                   user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    assert_route_editable(route)
    if not body.container_ids:
        raise HTTPException(400, "Selecione pelo menos um contentor")

    containers = await db.containers.find(
        tenant_query(user, {"id": {"$in": body.container_ids}}), NO_ID).to_list(500)
    if len(containers) != len(set(body.container_ids)):
        raise HTTPException(404, "Um ou mais contentores não foram encontrados")

    dup_tasks = await db.collection_tasks.find(
        tenant_query(user, {"container_id": {"$in": body.container_ids},
                            "scheduled_date": route["date"],
                            "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
        NO_ID).to_list(500)
    dup_ids = {t["container_id"] for t in dup_tasks}
    containers = [c for c in containers if c["id"] not in dup_ids]
    if not containers:
        raise HTTPException(400, "Todos os contentores selecionados já têm recolhas agendadas para esta data.")

    await _ensure_persisted_stops(user, route)

    container_inputs = [{"id": c["id"], "lat": c["lat"], "lng": c["lng"],
                         "waste_type": c["waste_type"],
                         "load_kg": c.get("capacity_kg", 400) * 0.7,
                         "priority": c.get("priority", False),
                         "address": c.get("address", "")} for c in containers]
    grouped = cluster_into_stops(container_inputs)

    existing_stops = await db.route_stops.count_documents(tenant_query(user, {"route_id": rid}))
    existing_tasks = await db.collection_tasks.find(tenant_query(user, {"route_id": rid}), NO_ID).to_list(2000)
    task_seq = max((t["sequence"] for t in existing_tasks), default=0)

    for i, g in enumerate(grouped):
        stop_id = str(uuid.uuid4())
        task_ids = []
        for sc in g["containers"]:
            task_seq += 1
            tid = str(uuid.uuid4())
            task_ids.append(tid)
            await db.collection_tasks.insert_one({
                "id": tid, "company_id": route["company_id"],
                "route_id": rid, "container_id": sc["id"], "stop_id": stop_id,
                "driver_id": route.get("driver_id"), "vehicle_id": route.get("vehicle_id"),
                "sequence": task_seq, "waste_type": sc["waste_type"],
                "address": sc.get("address", ""), "lat": sc["lat"], "lng": sc["lng"],
                "status": "scheduled", "scheduled_date": route["date"],
                "load_kg": None, "arrived_at": None, "completed_at": None,
                "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
            })
        await db.route_stops.insert_one({
            "id": stop_id, "company_id": route["company_id"], "route_id": rid,
            "sequence": existing_stops + i + 1, "lat": g["lat"], "lng": g["lng"],
            "address": g.get("address", ""), "waste_types": g["waste_types"],
            "task_ids": task_ids, "created_at": now_iso(),
        })

    total_tasks = await db.collection_tasks.count_documents(tenant_query(user, {"route_id": rid}))
    await db.routes.update_one(tenant_query(user, {"id": rid}),
                               {"$set": {"num_stops": total_tasks, "geometry_cache": None}})
    await write_audit(user, "add", "route_stop", rid, request, new={"container_ids": body.container_ids})
    return await get_route(rid, user)


@router.delete("/routes/{rid}/stops/{sid}")
async def remove_stop(rid: str, sid: str, request: Request,
                      user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    assert_route_editable(route)
    await _ensure_persisted_stops(user, route)

    stop = await db.route_stops.find_one(tenant_query(user, {"id": sid, "route_id": rid}), NO_ID)
    if not stop:
        raise HTTPException(404, "Paragem não encontrada")
    tasks = await db.collection_tasks.find(tenant_query(user, {"stop_id": sid}), NO_ID).to_list(200)
    if any(t["status"] in ("collected", "failed") for t in tasks):
        raise HTTPException(
            409, "Não é possível remover: há contentores já recolhidos ou com recolha falhada nesta paragem.")

    await db.collection_tasks.delete_many(tenant_query(user, {"stop_id": sid}))
    await db.route_stops.delete_one(tenant_query(user, {"id": sid}))

    total_tasks = await db.collection_tasks.count_documents(tenant_query(user, {"route_id": rid}))
    await db.routes.update_one(tenant_query(user, {"id": rid}),
                               {"$set": {"num_stops": total_tasks, "geometry_cache": None}})
    await write_audit(user, "remove", "route_stop", sid, request, old={"task_count": len(tasks)})
    return await get_route(rid, user)


@router.delete("/routes/{rid}")
async def delete_route(rid: str, request: Request, body: Optional[RouteDeleteIn] = None,
                       user: dict = Depends(current_user)):
    """Discard a route. Two paths share this one endpoint on purpose:

    1. Trivial discard — undo a just-generated batch the admin/dispatcher
       hasn't left the preview screen for yet, or clear an empty/wrong
       scheduled route. No real work recorded, route never started: no
       password needed, any management role may do it (unchanged from
       before Fase UI/SEC 1).
    2. Sensitive delete/archive (Fase UI/SEC 1) — a route with any
       collected/failed task, or that was already started, is never
       hard-deleted; it's archived instead (status -> cancelled), keeping
       every task/stop/GPS record as proof of real work. This path requires
       the caller to re-type their own password (verified server-side —
       current_user() deliberately excludes password_hash, so this does a
       fresh lookup) and is restricted to company_admin/super_admin —
       dispatcher can never delete or archive a route with real history."""
    if user["role"] not in MANAGEMENT_ROLES:
        raise HTTPException(403, "Sem permissão para eliminar rotas")

    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")

    tasks = await db.collection_tasks.find(tenant_query(user, {"route_id": rid}), NO_ID).to_list(2000)
    has_real_work = any(t["status"] in ("collected", "failed") for t in tasks)
    already_started = route.get("status") == "in_progress"
    needs_confirmation = has_real_work or already_started

    if needs_confirmation and user["role"] not in ("super_admin", "company_admin"):
        raise HTTPException(403, "Só administradores podem eliminar ou arquivar uma rota com histórico")

    if body and body.password:
        full_user = await db.users.find_one({"id": user["id"]}, NO_ID)
        if not full_user or not verify_password(body.password, full_user["password_hash"]):
            raise HTTPException(401, "Password incorreta")
    elif needs_confirmation:
        raise HTTPException(400, "Esta rota já tem histórico — confirme a sua password para continuar")

    admin_name = user.get("name") or "Um administrador"

    if needs_confirmation:
        await db.routes.update_one(tenant_query(user, {"id": rid}), {"$set": {"status": "cancelled"}})
        action, message = "archive", f"{admin_name} arquivou a Rota {route.get('code')}."
    else:
        await db.collection_tasks.delete_many(tenant_query(user, {"route_id": rid}))
        await db.route_stops.delete_many(tenant_query(user, {"route_id": rid}))
        await db.routes.delete_one(tenant_query(user, {"id": rid}))
        action, message = "delete", f"{admin_name} eliminou a Rota {route.get('code')}."

    if route.get("vehicle_id"):
        await db.vehicles.update_one(tenant_query(user, {"id": route["vehicle_id"]}),
                                     {"$set": {"status": "available"}})
    if route.get("driver_id"):
        await db.drivers.update_one(tenant_query(user, {"id": route["driver_id"]}),
                                    {"$set": {"status": "available"}})

    await write_audit(user, action, "route", rid, request,
                      old={"code": route.get("code"), "status": route.get("status")},
                      new={"message": message})
    return {"ok": True, "action": action}


@router.post("/routes/preview-geometry")
async def preview_geometry(body: PreviewGeometryIn,
                           user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Road-following geometry for an ad-hoc, not-yet-saved list of points —
    powers the live line in the visual map route builder. Writes nothing."""
    points = [(p.lat, p.lng) for p in body.points]
    return await road_route(points)


@router.post("/routes/preview-optimize")
async def preview_optimize(body: PreviewOptimizeIn,
                           user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Reorders an ad-hoc list of stops (start -> stops -> end) without
    saving anything — the map editor's OTIMIZAR ORDEM button uses this to
    show a before/after comparison the admin can accept or discard."""
    start = (body.start.lat, body.start.lng)
    end = (body.end.lat, body.end.lng)
    stops = [{"id": s.id, "lat": s.lat, "lng": s.lng, "priority": False} for s in body.stops]
    before_km = round(_route_distance([start] + [(s["lat"], s["lng"]) for s in stops] + [end]), 2)
    res = optimize_single(start, end, stops)
    return {
        "order": [s["id"] for s in res["order"]],
        "distance_km": res["distance_km"],
        "duration_min": res["duration_min"],
        "distance_km_before": before_km,
    }


@router.post("/routes/manual")
async def create_manual_route(body: ManualRouteIn, request: Request,
                              user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Save a route drawn point-by-point on the map (Fase B2.1). Produces the
    exact same routes/route_stops/collection_tasks shape optimize() does —
    stop reorder/move/remove, reoptimize, geofencing and the driver app all
    work on it unchanged. Stops start with zero containers; attaching them
    is Fase B2.2."""
    company_id = user["company_id"]
    if not body.stops:
        raise HTTPException(400, "Defina pelo menos uma paragem")

    # Stops built from real containers (selected from a list, not tapped
    # blank on the map) get a real collection_task each, so the driver app
    # has something to act on — closes the "20 paragens, 0 contentores" gap.
    container_ids = [s.container_id for s in body.stops if s.container_id]
    containers_by_id: dict = {}
    if container_ids:
        found = await db.containers.find(
            tenant_query(user, {"id": {"$in": container_ids}}), NO_ID).to_list(5000)
        containers_by_id = {c["id"]: c for c in found}
        missing = set(container_ids) - set(containers_by_id)
        if missing:
            raise HTTPException(400, f"{len(missing)} contentor(es) selecionado(s) não foram encontrados")
        archived = sorted({c["qr_code"] for c in containers_by_id.values() if c.get("status") != "active"})
        if archived:
            raise HTTPException(400, f"Contentor(es) arquivado(s), não podem ser usados: {', '.join(archived)}")

        dup_tasks = await db.collection_tasks.find(
            tenant_query(user, {"container_id": {"$in": container_ids}, "scheduled_date": body.date,
                                "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
            NO_ID).to_list(5000)
        if dup_tasks:
            names = sorted({containers_by_id[t["container_id"]]["qr_code"] for t in dup_tasks
                            if t["container_id"] in containers_by_id})
            raise HTTPException(400, f"Já têm recolha agendada para esta data: {', '.join(names)}")

    start_depot = None
    start_lat = start_lng = None
    if body.start.depot_id:
        start_depot = await db.depots.find_one(tenant_query(user, {"id": body.start.depot_id}), NO_ID)
        if not start_depot:
            raise HTTPException(400, "Depósito de início inválido")
        start_lat, start_lng = start_depot["lat"], start_depot["lng"]
    elif body.start.lat is not None and body.start.lng is not None:
        start_lat, start_lng = body.start.lat, body.start.lng
    else:
        # No explicit start — fall back to the company's primary depot
        # instead of failing, so the admin never has to pick it manually.
        depots = await db.depots.find(tenant_query(user), NO_ID).to_list(500)
        start_depot = next((d for d in depots if d.get("is_primary")), depots[0] if depots else None)
        if not start_depot:
            raise HTTPException(400, "Defina o ponto de início")
        start_lat, start_lng = start_depot["lat"], start_depot["lng"]

    end = body.end
    end_facility = None
    end_lat = end_lng = None
    if end.facility_id:
        end_facility = await db.facilities.find_one(tenant_query(user, {"id": end.facility_id}), NO_ID)
        if not end_facility:
            raise HTTPException(400, "Centro de tratamento de destino inválido")
        end_lat, end_lng = end_facility["lat"], end_facility["lng"]
    elif end.depot_id:
        end_depot = await db.depots.find_one(tenant_query(user, {"id": end.depot_id}), NO_ID)
        if not end_depot:
            raise HTTPException(400, "Depósito de destino inválido")
        end_lat, end_lng = end_depot["lat"], end_depot["lng"]
    elif end.lat is not None and end.lng is not None:
        end_lat, end_lng = end.lat, end.lng
    else:
        end_lat, end_lng = start_lat, start_lng  # round trip back to the start

    vehicle = None
    if body.vehicle_id:
        vehicle = await db.vehicles.find_one(tenant_query(user, {"id": body.vehicle_id}), NO_ID)
        if not vehicle:
            raise HTTPException(400, "Viatura inválida")
    driver = None
    if body.driver_id:
        driver = await db.drivers.find_one(tenant_query(user, {"id": body.driver_id}), NO_ID)
        if not driver:
            raise HTTPException(400, "Motorista inválido")

    points = [(start_lat, start_lng)] + [(s.lat, s.lng) for s in body.stops] + [(end_lat, end_lng)]
    dist_km = round(_route_distance(points), 2)
    duration_min = round(dist_km / AVG_SPEED_KMH * 60 + len(body.stops) * SERVICE_MIN_PER_STOP, 1)

    rid = str(uuid.uuid4())
    route_doc = {
        "id": rid, "company_id": company_id,
        "code": _route_code(await db.routes.count_documents({"company_id": company_id})),
        "date": body.date, "zone_id": None,
        "driver_id": driver["id"] if driver else None,
        "driver_name": driver["name"] if driver else None,
        "vehicle_id": vehicle["id"] if vehicle else None,
        "start_depot_id": start_depot["id"] if start_depot else None,
        "start_lat": None if start_depot else start_lat,
        "start_lng": None if start_depot else start_lng,
        "end_facility_id": end_facility["id"] if end_facility else None,
        "end_lat": None if end_facility else end_lat,
        "end_lng": None if end_facility else end_lng,
        "waste_type": None, "num_stops": len(container_ids),
        "distance_km": dist_km, "duration_min": duration_min,
        "capacity_utilization": 0, "load_kg": 0,
        "actual_distance_km": None, "actual_duration_min": None,
        "mode": body.mode, "template_id": None,
        "status": "scheduled", "created_at": now_iso(),
    }
    await db.routes.insert_one(route_doc)

    task_seq = 0
    for i, s in enumerate(body.stops):
        stop_id = _stop_id(rid, i)
        task_ids = []
        waste_types = []
        if s.container_id:
            c = containers_by_id[s.container_id]
            task_seq += 1
            tid = str(uuid.uuid4())
            task_ids.append(tid)
            waste_types.append(c["waste_type"])
            await db.collection_tasks.insert_one({
                "id": tid, "company_id": company_id,
                "route_id": rid, "container_id": c["id"], "stop_id": stop_id,
                "driver_id": driver["id"] if driver else None,
                "vehicle_id": vehicle["id"] if vehicle else None,
                "sequence": task_seq, "waste_type": c["waste_type"],
                "address": s.address or c.get("address", ""), "lat": s.lat, "lng": s.lng,
                "status": "scheduled", "scheduled_date": body.date,
                "load_kg": None, "arrived_at": None, "completed_at": None,
                "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
            })
        await db.route_stops.insert_one({
            "id": stop_id, "company_id": company_id, "route_id": rid,
            "sequence": i + 1, "lat": s.lat, "lng": s.lng, "address": s.address,
            "waste_types": waste_types, "task_ids": task_ids, "created_at": now_iso(),
        })

    if vehicle:
        await db.vehicles.update_one(tenant_query(user, {"id": vehicle["id"]}),
                                     {"$set": {"status": "assigned"}})
    if driver:
        await db.drivers.update_one(tenant_query(user, {"id": driver["id"]}),
                                    {"$set": {"status": "assigned", "vehicle_id": vehicle["id"] if vehicle else None}})

    route_doc.pop("_id", None)
    await write_audit(user, "create_manual", "route", rid, request,
                      new={"stops": len(body.stops), "mode": body.mode})
    return route_doc


@router.get("/routes/{rid}/geometry")
async def route_geometry(rid: str, user: dict = Depends(current_user)):
    """Road-following geometry (depot -> stops in sequence -> facility) with
    turn-by-turn steps. Cached on the route document."""
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    if route.get("geometry_cache"):
        return route["geometry_cache"]

    # Persisted route_stops (if any) are the authoritative stop points — a
    # manually-drawn route (Fase B2.1) can have stops with zero
    # collection_tasks yet, so falling back to tasks alone would drop them.
    # Routes older than Fase A never got route_stops — they keep the
    # original tasks-based path unchanged.
    persisted_stops = await db.route_stops.find(
        tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
    if persisted_stops:
        mid_points = [(s["lat"], s["lng"]) for s in persisted_stops]
    else:
        tasks = await db.collection_tasks.find(
            tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
        mid_points = [(t["lat"], t["lng"]) for t in tasks]

    stops: list = []
    depot = None
    if route.get("start_depot_id"):
        depot = await db.depots.find_one(tenant_query(user, {"id": route["start_depot_id"]}), NO_ID)
    if depot:
        stops.append((depot["lat"], depot["lng"]))
    elif route.get("start_lat") is not None and route.get("start_lng") is not None:
        stops.append((route["start_lat"], route["start_lng"]))

    stops.extend(mid_points)

    fac = None
    if route.get("end_facility_id"):
        fac = await db.facilities.find_one(tenant_query(user, {"id": route["end_facility_id"]}), NO_ID)
    if fac:
        stops.append((fac["lat"], fac["lng"]))
    elif route.get("end_lat") is not None and route.get("end_lng") is not None:
        stops.append((route["end_lat"], route["end_lng"]))

    geo = await road_route(stops)
    await db.routes.update_one(tenant_query(user, {"id": rid}),
                               {"$set": {"geometry_cache": geo}})
    return geo


@router.post("/routes/navigate")
async def navigate(payload: dict, user: dict = Depends(current_user)):
    """Road route between two points for driver navigation.
    payload: {from_lat, from_lng, to_lat, to_lng}"""
    try:
        stops = [(float(payload["from_lat"]), float(payload["from_lng"])),
                 (float(payload["to_lat"]), float(payload["to_lng"]))]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Coordenadas inválidas")
    return await road_route(stops)


@router.post("/routes/{rid}/start")
async def start_route(rid: str, body: Optional[RouteStartIn] = None,
                      user: dict = Depends(current_user)):
    """Starts the route (scheduled -> in_progress). A driver can only start
    their own route — _driver_scope keeps this consistent with GET
    /routes/{id}'s visibility rule from Fase PROD2. Admin/dispatcher keep
    starting any route in the tenant, unchanged. Optionally records the
    device's GPS position at the moment of starting (Fase PROD3, point 15)."""
    route = await db.routes.find_one(_driver_scope(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")

    updates = {"status": "in_progress", "started_at": now_iso()}
    if body and body.lat is not None and body.lng is not None:
        updates["actual_start_lat"] = body.lat
        updates["actual_start_lng"] = body.lng
    await db.routes.update_one(_driver_scope(user, {"id": rid}), {"$set": updates})
    return {"ok": True}


@router.post("/routes/{rid}/finish")
async def finish_route(rid: str, request: Request, body: Optional[RouteFinishIn] = None,
                       user: dict = Depends(current_user)):
    """Finishes the route (in_progress -> completed), Fase PROD4. Same
    _driver_scope restriction as /start: a driver can only finish their own
    route. Records completed_at, real elapsed duration (wall-clock from
    started_at — always available), real distance (road distance through the
    actual start position + every collected stop, in visiting order, plus the
    end point — only computable when /start captured a GPS position; falls
    back to the route's planned distance_km otherwise, e.g. admin-started
    routes), and collected/failed/ignored/pending task counts, feeding the
    future route-history screen (Fase F)."""
    route = await db.routes.find_one(_driver_scope(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")
    if route.get("status") != "in_progress":
        raise HTTPException(400, "A rota tem de estar em curso para ser finalizada")

    tasks = await db.collection_tasks.find(tenant_query(user, {"route_id": rid}), NO_ID).to_list(2000)
    collected = [t for t in tasks if t["status"] == "collected"]
    failed = [t for t in tasks if t["status"] == "failed"]
    ignored = [t for t in tasks if t["status"] == "ignored"]
    pending = [t for t in tasks if t["status"] not in ("collected", "failed", "ignored")]

    completed_at = now_iso()
    duration_min = None
    if route.get("started_at"):
        try:
            t0 = datetime.fromisoformat(route["started_at"])
            t1 = datetime.fromisoformat(completed_at)
            duration_min = round((t1 - t0).total_seconds() / 60, 1)
        except ValueError:
            duration_min = None

    distance_km = route.get("distance_km")  # fallback: planned distance
    if route.get("actual_start_lat") is not None and route.get("actual_start_lng") is not None:
        points = [(route["actual_start_lat"], route["actual_start_lng"])]
        points += [(t["lat"], t["lng"]) for t in sorted(collected, key=lambda t: t.get("sequence", 0))]
        if body and body.lat is not None and body.lng is not None:
            points.append((body.lat, body.lng))
        elif route.get("end_facility_id"):
            fac = await db.facilities.find_one(tenant_query(user, {"id": route["end_facility_id"]}), NO_ID)
            if fac:
                points.append((fac["lat"], fac["lng"]))
        elif route.get("end_lat") is not None and route.get("end_lng") is not None:
            points.append((route["end_lat"], route["end_lng"]))
        if len(points) >= 2:
            geo = await road_route(points)
            distance_km = round(geo["distance_m"] / 1000, 2)

    updates = {
        "status": "completed",
        "completed_at": completed_at,
        "actual_distance_km": distance_km,
        "actual_duration_min": duration_min,
        "collected_count": len(collected),
        "failed_count": len(failed),
        "ignored_count": len(ignored),
        "pending_count": len(pending),
    }
    if body and body.lat is not None and body.lng is not None:
        updates["actual_end_lat"] = body.lat
        updates["actual_end_lng"] = body.lng

    await db.routes.update_one(_driver_scope(user, {"id": rid}), {"$set": updates})

    if route.get("driver_id"):
        await db.drivers.update_one(tenant_query(user, {"id": route["driver_id"]}),
                                    {"$set": {"status": "available"}})
    if route.get("vehicle_id"):
        await db.vehicles.update_one(tenant_query(user, {"id": route["vehicle_id"]}),
                                     {"$set": {"status": "available"}})

    await write_audit(user, "finish_route", "route", rid, request,
                      old={"status": "in_progress"}, new=updates)
    return {"ok": True, **updates}


@router.post("/routes/{rid}/save-as-template")
async def save_route_as_template(rid: str, body: SaveRouteAsTemplateIn, request: Request,
                                 user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Fase 1 — copies only planning data (stops/geometry/planned distance
    and duration) into a brand-new, independent route_template document.
    Deliberately excludes status, date, started_at/completed_at, actual_*
    metrics, and collection counts — none of that is "the plan", it's what
    happened on one specific day. driver_id/vehicle_id are also NOT carried
    over as the template's defaults: who's currently assigned to a route is
    an operational fact, not a planning one — the admin can set
    default_driver_id/default_vehicle_id explicitly afterward if they want
    one. The source route itself is never modified."""
    route = await db.routes.find_one(tenant_query(user, {"id": rid}), NO_ID)
    if not route:
        raise HTTPException(404, "Rota não encontrada")

    tasks = await db.collection_tasks.find(
        tenant_query(user, {"route_id": rid}), NO_ID).sort("sequence", 1).to_list(2000)
    source_stops = await _stops_for_route(user, rid, tasks)

    template_stops = [{
        "id": str(uuid.uuid4()), "sequence": i + 1,
        "lat": s["lat"], "lng": s["lng"], "address": s.get("address", ""),
        "waste_types": s.get("waste_types", []),
        "container_ids": [t["container_id"] for t in s.get("tasks", [])],
    } for i, s in enumerate(source_stops)]

    geo = route.get("geometry_cache") or await route_geometry(rid, user)

    tid = str(uuid.uuid4())
    doc = {
        "id": tid, "company_id": route["company_id"],
        "name": body.name, "description": body.description, "code": None,
        "zone_id": route.get("zone_id"), "waste_type": route.get("waste_type"),
        "start_depot_id": route.get("start_depot_id"), "end_facility_id": route.get("end_facility_id"),
        "start_lat": route.get("start_lat"), "start_lng": route.get("start_lng"),
        "end_lat": route.get("end_lat"), "end_lng": route.get("end_lng"),
        "stops": template_stops, "geometry": geo,
        "distance_km": route.get("distance_km") or 0.0, "duration_min": route.get("duration_min") or 0.0,
        "default_driver_id": None, "default_vehicle_id": None,
        "active": True, "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.route_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "save_as_template", "route_template", tid, request,
                      old={"source_route_id": rid}, new={"name": body.name})
    return doc
