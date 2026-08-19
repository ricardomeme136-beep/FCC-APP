"""CRUD endpoints for core entities (tenant-scoped)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from pymongo.errors import DuplicateKeyError

from core.db import db, NO_ID
from core.models import (VehicleIn, DriverIn, ContainerIn, ContainerUpdate, ContainerDeleteIn,
                         DepotIn, FacilityIn, CustomerIn, PasswordResetIn, HeartbeatIn)
from core.security import (current_user, require_roles, tenant_query, write_audit,
                           hash_password, verify_password, MANAGEMENT_ROLES)
from core.activity import annotate_driver_activity
from services.geo import haversine

router = APIRouter(tags=["entities"])


def now_iso():
    return datetime.now(timezone.utc).isoformat()


WASTE_TYPES = [
    {"code": "general", "label": "Resíduos indiferenciados", "color": "#3F3F46"},
    {"code": "paper", "label": "Papel e cartão", "color": "#2563EB"},
    {"code": "plastic", "label": "Plástico", "color": "#F59E0B"},
    {"code": "glass", "label": "Vidro", "color": "#059669"},
    {"code": "organic", "label": "Orgânicos", "color": "#92400E"},
    {"code": "food", "label": "Resíduos alimentares", "color": "#B45309"},
    {"code": "commercial", "label": "Resíduos comerciais", "color": "#7C2D12"},
    {"code": "other", "label": "Outros", "color": "#0A0A0A"},
]


@router.get("/waste-types")
async def waste_types(user: dict = Depends(current_user)):
    return WASTE_TYPES


# ---------------- Vehicles ----------------
@router.get("/vehicles")
async def list_vehicles(user: dict = Depends(current_user)):
    return await db.vehicles.find(tenant_query(user), NO_ID).to_list(2000)


@router.get("/vehicles/{vid}")
async def get_vehicle(vid: str, user: dict = Depends(current_user)):
    v = await db.vehicles.find_one(tenant_query(user, {"id": vid}), NO_ID)
    if not v:
        raise HTTPException(404, "Viatura não encontrada")
    pos = await db.gps_positions.find_one(
        {"vehicle_id": vid}, NO_ID, sort=[("timestamp", -1)])
    v["last_position"] = pos
    return v


@router.get("/vehicles/{vid}/location")
async def vehicle_location(vid: str, user: dict = Depends(current_user)):
    await get_vehicle(vid, user)  # tenant check
    pos = await db.gps_positions.find_one(
        {"vehicle_id": vid}, NO_ID, sort=[("timestamp", -1)])
    if not pos:
        raise HTTPException(404, "Sem posição GPS")
    return pos


@router.post("/vehicles")
async def create_vehicle(body: VehicleIn, request: Request,
                         user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"],
           "created_at": now_iso(), **body.dict()}
    await db.vehicles.insert_one(doc)
    await write_audit(user, "create", "vehicle", doc["id"], request, new=body.dict())
    doc.pop("_id", None)
    return doc


@router.patch("/vehicles/{vid}")
async def update_vehicle(vid: str, body: VehicleIn, request: Request,
                         user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    r = await db.vehicles.update_one(
        tenant_query(user, {"id": vid}), {"$set": body.dict()})
    if not r.matched_count:
        raise HTTPException(404, "Viatura não encontrada")
    await write_audit(user, "update", "vehicle", vid, request, new=body.dict())
    return await db.vehicles.find_one(tenant_query(user, {"id": vid}), NO_ID)


# ---------------- Drivers ----------------
@router.get("/drivers")
async def list_drivers(user: dict = Depends(current_user)):
    drivers = await db.drivers.find(tenant_query(user), NO_ID).to_list(2000)
    return await annotate_driver_activity(user, drivers)


@router.post("/drivers/me/heartbeat")
async def driver_heartbeat(body: Optional[HeartbeatIn] = None,
                           user: dict = Depends(current_user)):
    """Lightweight presence signal — the driver app calls this every 30-60s
    while open. Only ever touches the authenticated user's own account: the
    driver is resolved from the token, never from a client-supplied
    driver_id, so a driver can never update someone else's presence."""
    if not user.get("driver_id"):
        raise HTTPException(403, "Esta conta não está associada a um motorista")
    updates = {"last_seen_at": now_iso()}
    if body and body.route_id:
        updates["current_route_id"] = body.route_id
    if body and body.vehicle_id:
        updates["current_vehicle_id"] = body.vehicle_id
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return {"ok": True}


@router.get("/drivers/{did}")
async def get_driver(did: str, user: dict = Depends(current_user)):
    d = await db.drivers.find_one(tenant_query(user, {"id": did}), NO_ID)
    if not d:
        raise HTTPException(404, "Motorista não encontrado")
    await annotate_driver_activity(user, [d])
    # performance from tasks
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"driver_id": did}), NO_ID).to_list(5000)
    done = [t for t in tasks if t["status"] == "collected"]
    failed = [t for t in tasks if t["status"] == "failed"]
    total = len(tasks) or 1
    d["performance"] = {
        "total_tasks": len(tasks),
        "completed": len(done),
        "failed": len(failed),
        "completion_rate": round(len(done) / total * 100, 1),
        "failure_rate": round(len(failed) / total * 100, 1),
    }
    return d


@router.post("/drivers")
async def create_driver(body: DriverIn, request: Request,
                        user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Creates the driver record. If `password` is given together with
    `email` and/or `employee_number`, also creates the linked login account
    in the same call (Fase PROD1) — the driver never needs a second,
    separate step to be able to log in. The login identifier doesn't have
    to be an email: a driver can log in with their employee number instead
    (or both, whichever they type). Omitted, behaves exactly as before
    (driver-only, no account)."""
    driver_fields = body.dict(exclude={"password"})
    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"],
           "created_at": now_iso(), **driver_fields}
    await db.drivers.insert_one(doc)

    user_created = False
    if body.password:
        if not body.email and not body.employee_number:
            await db.drivers.delete_one({"id": doc["id"]})
            raise HTTPException(400, "Indique um email ou um número de motorista para criar o acesso")
        user_doc = {
            "id": str(uuid.uuid4()), "name": body.name,
            "role": "driver", "company_id": user["company_id"],
            "driver_id": doc["id"], "customer_id": None,
            "password_hash": hash_password(body.password), "disabled": False,
            "created_at": now_iso(),
        }
        if body.email:
            user_doc["email"] = body.email.lower()
        if body.employee_number:
            user_doc["username"] = body.employee_number.strip().lower()
        try:
            await db.users.insert_one(user_doc)
            user_created = True
        except DuplicateKeyError:
            await db.drivers.delete_one({"id": doc["id"]})  # no orphan driver left behind
            raise HTTPException(400, "Já existe uma conta com este email ou número de motorista")

    await write_audit(user, "create", "driver", doc["id"], request, new=driver_fields)
    doc.pop("_id", None)
    doc["user_created"] = user_created
    return doc


@router.patch("/drivers/{did}")
async def update_driver(did: str, body: DriverIn, request: Request,
                        user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    # `password` is write-only on creation — never persisted here; use
    # POST /drivers/{did}/reset-password to change a driver's login password.
    changes = body.dict(exclude={"password"})
    r = await db.drivers.update_one(
        tenant_query(user, {"id": did}), {"$set": changes})
    if not r.matched_count:
        raise HTTPException(404, "Motorista não encontrado")

    # Keep the linked account's login number in sync — but only if the
    # driver already logs in with one; changing employee_number never
    # silently grants number-login to a driver who only had email before.
    if body.employee_number:
        linked = await db.users.find_one(tenant_query(user, {"driver_id": did}), NO_ID)
        new_username = body.employee_number.strip().lower()
        if linked and linked.get("username") and linked["username"] != new_username:
            try:
                await db.users.update_one(tenant_query(user, {"id": linked["id"]}),
                                          {"$set": {"username": new_username}})
            except DuplicateKeyError:
                raise HTTPException(400, "Já existe uma conta com este número de motorista")

    await write_audit(user, "update", "driver", did, request, new=changes)
    return await db.drivers.find_one(tenant_query(user, {"id": did}), NO_ID)


@router.post("/drivers/{did}/disable")
async def disable_driver(did: str, request: Request,
                         user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Blocks login and marks the driver unavailable — never deletes routes,
    tasks, incidents or GPS history tied to them."""
    d = await db.drivers.find_one(tenant_query(user, {"id": did}), NO_ID)
    if not d:
        raise HTTPException(404, "Motorista não encontrado")
    await db.drivers.update_one(tenant_query(user, {"id": did}),
                                {"$set": {"employment_status": "inativo"}})
    linked = await db.users.find_one(tenant_query(user, {"driver_id": did}), NO_ID)
    if linked:
        await db.users.update_one(tenant_query(user, {"id": linked["id"]}),
                                  {"$set": {"disabled": True}})
    await write_audit(user, "disable", "driver", did, request)
    return {"ok": True}


@router.post("/drivers/{did}/enable")
async def enable_driver(did: str, request: Request,
                        user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    d = await db.drivers.find_one(tenant_query(user, {"id": did}), NO_ID)
    if not d:
        raise HTTPException(404, "Motorista não encontrado")
    await db.drivers.update_one(tenant_query(user, {"id": did}),
                                {"$set": {"employment_status": "ativo"}})
    linked = await db.users.find_one(tenant_query(user, {"driver_id": did}), NO_ID)
    if linked:
        await db.users.update_one(tenant_query(user, {"id": linked["id"]}),
                                  {"$set": {"disabled": False}})
    await write_audit(user, "enable", "driver", did, request)
    return {"ok": True}


@router.post("/drivers/{did}/reset-password")
async def reset_driver_password(did: str, body: PasswordResetIn, request: Request,
                                user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    linked = await db.users.find_one(tenant_query(user, {"driver_id": did}), NO_ID)
    if not linked:
        raise HTTPException(404, "Este motorista não tem conta de acesso associada")
    await db.users.update_one(tenant_query(user, {"id": linked["id"]}),
                              {"$set": {"password_hash": hash_password(body.new_password)}})
    await write_audit(user, "reset_password", "driver", did, request)
    return {"ok": True}


# ---------------- Containers ----------------
async def _annotate_availability(user: dict, containers: list, for_date: str) -> None:
    """Mutates each container in place with `available`/`unavailable_reason`
    for the given date — never silently drops a container from the response,
    always explains why it can't be picked (Fase: contentores no criador de
    rotas)."""
    if not containers:
        return
    ids = [c["id"] for c in containers]
    tasks = await db.collection_tasks.find(
        tenant_query(user, {"container_id": {"$in": ids}, "scheduled_date": for_date,
                            "status": {"$in": ["scheduled", "en_route", "arrived"]}}),
        NO_ID).to_list(5000)
    route_ids = list({t["route_id"] for t in tasks if t.get("route_id")})
    routes_by_id = {}
    if route_ids:
        routes = await db.routes.find(tenant_query(user, {"id": {"$in": route_ids}}), NO_ID).to_list(2000)
        routes_by_id = {r["id"]: r for r in routes}
    route_by_container = {t["container_id"]: routes_by_id.get(t.get("route_id")) for t in tasks}

    for c in containers:
        has_gps = isinstance(c.get("lat"), (int, float)) and isinstance(c.get("lng"), (int, float))
        route = route_by_container.get(c["id"])
        if c.get("status") != "active":
            c["available"] = False
            c["unavailable_reason"] = "Arquivado" if c.get("status") == "archived" else "Inativo"
        elif not has_gps:
            c["available"] = False
            c["unavailable_reason"] = "Sem localização GPS"
        elif route:
            c["available"] = False
            c["unavailable_reason"] = f"Já atribuído à Rota {route.get('code')} nesta data"
        else:
            c["available"] = True
            c["unavailable_reason"] = None


@router.get("/containers")
async def list_containers(
    user: dict = Depends(current_user),
    waste_type: str = Query(None),
    zone_id: str = Query(None),
    status: str = Query(None),
    for_date: str = Query(None),
    limit: int = Query(2000),
):
    q = tenant_query(user)
    if user["role"] == "customer":
        q["customer_id"] = user.get("customer_id")
    if waste_type:
        q["waste_type"] = waste_type
    if zone_id:
        q["zone_id"] = zone_id
    if status:
        q["status"] = status
    containers = await db.containers.find(q, NO_ID).to_list(limit)
    if for_date:
        await _annotate_availability(user, containers, for_date)
    return containers


@router.get("/containers/{cid}")
async def get_container(cid: str, user: dict = Depends(current_user)):
    c = await db.containers.find_one(tenant_query(user, {"id": cid}), NO_ID)
    if not c:
        raise HTTPException(404, "Contentor não encontrado")
    if user["role"] == "customer" and c.get("customer_id") != user.get("customer_id"):
        raise HTTPException(403, "Sem acesso a este contentor")
    hist = await db.collection_tasks.find(
        tenant_query(user, {"container_id": cid}), NO_ID
    ).sort("scheduled_date", -1).to_list(50)
    c["history"] = hist
    return c


@router.post("/containers")
async def create_container(body: ContainerIn, request: Request,
                           user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    cid = str(uuid.uuid4())
    doc = {"id": cid, "company_id": user["company_id"],
           "qr_code": f"WF-{cid[:8].upper()}",
           "created_at": now_iso(), "installed_at": now_iso(),
           "last_collection": None, "next_collection": None,
           "photos": [], **body.dict()}
    await db.containers.insert_one(doc)
    await write_audit(user, "create", "container", cid, request, new=body.dict())
    doc.pop("_id", None)
    return doc


@router.patch("/containers/{cid}")
async def update_container(cid: str, body: ContainerUpdate, request: Request,
                           user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    changes = {k: v for k, v in body.dict().items() if v is not None}
    if not changes:
        raise HTTPException(400, "Nada para atualizar")
    r = await db.containers.update_one(
        tenant_query(user, {"id": cid}), {"$set": changes})
    if not r.matched_count:
        raise HTTPException(404, "Contentor não encontrado")
    await write_audit(user, "update", "container", cid, request, new=changes)
    return await db.containers.find_one(tenant_query(user, {"id": cid}), NO_ID)


@router.delete("/containers/{cid}")
async def delete_container(cid: str, request: Request, body: Optional[ContainerDeleteIn] = None,
                           user: dict = Depends(current_user)):
    """Container with any real history (collection_tasks or incidents ever
    referencing it — including still-pending ones on a future route) is
    ARCHIVED, never hard-deleted, so past collection proof is never lost.
    Only a container that was never used anywhere can be permanently
    deleted, and only after the admin re-enters their password (verified
    server-side, same pattern as DELETE /routes/{rid})."""
    if user["role"] not in ("super_admin", "company_admin"):
        raise HTTPException(403, "Só administradores podem eliminar ou arquivar um contentor")
    c = await db.containers.find_one(tenant_query(user, {"id": cid}), NO_ID)
    if not c:
        raise HTTPException(404, "Contentor não encontrado")

    has_tasks = await db.collection_tasks.count_documents(tenant_query(user, {"container_id": cid})) > 0
    has_incidents = await db.incidents.count_documents(tenant_query(user, {"container_id": cid})) > 0
    has_history = has_tasks or has_incidents

    admin_name = user.get("name") or "Um administrador"
    if has_history:
        await db.containers.update_one(tenant_query(user, {"id": cid}), {"$set": {"status": "archived"}})
        action = "archive"
        message = f"{admin_name} arquivou o contentor {c.get('qr_code')}."
    else:
        if not body or not body.password:
            raise HTTPException(400, "Confirme a sua password para eliminar permanentemente")
        full_user = await db.users.find_one({"id": user["id"]}, NO_ID)
        if not full_user or not verify_password(body.password, full_user["password_hash"]):
            raise HTTPException(401, "Password incorreta")
        await db.containers.delete_one(tenant_query(user, {"id": cid}))
        action = "delete"
        message = f"{admin_name} eliminou o contentor {c.get('qr_code')}."

    await write_audit(user, action, "container", cid, request,
                      old={"status": c.get("status")}, new={"message": message})
    return {"ok": True, "action": action}


# ---------------- Depots ----------------
@router.get("/depots")
async def list_depots(user: dict = Depends(current_user)):
    return await db.depots.find(tenant_query(user), NO_ID).to_list(500)


@router.get("/depots/{did}")
async def get_depot(did: str, user: dict = Depends(current_user)):
    d = await db.depots.find_one(tenant_query(user, {"id": did}), NO_ID)
    if not d:
        raise HTTPException(404, "Depósito não encontrado")
    today = now_iso()[:10]
    d["routes_today"] = await db.routes.count_documents(
        tenant_query(user, {"start_depot_id": did, "date": today}))
    vehicles = await db.vehicles.find(tenant_query(user), NO_ID).to_list(2000)
    vehicles_at_depot = 0
    for v in vehicles:
        pos = await db.gps_positions.find_one(
            {"vehicle_id": v["id"]}, NO_ID, sort=[("timestamp", -1)])
        if pos and haversine((pos["lat"], pos["lng"]), (d["lat"], d["lng"])) <= 0.3:
            vehicles_at_depot += 1
    d["vehicles_at_depot"] = vehicles_at_depot
    return d


@router.post("/depots")
async def create_depot(body: DepotIn, request: Request,
                       user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"], **body.dict()}
    if doc["is_primary"]:
        await db.depots.update_many(tenant_query(user), {"$set": {"is_primary": False}})
    await db.depots.insert_one(doc)
    await write_audit(user, "create", "depot", doc["id"], request, new=body.dict())
    doc.pop("_id", None)
    return doc


@router.patch("/depots/{did}")
async def update_depot(did: str, body: DepotIn, request: Request,
                       user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """A company has at most one primary depot: marking this one primary
    unmarks every other depot in the same tenant in the same call."""
    changes = body.dict()
    if changes["is_primary"]:
        await db.depots.update_many(
            tenant_query(user, {"id": {"$ne": did}}), {"$set": {"is_primary": False}})
    r = await db.depots.update_one(tenant_query(user, {"id": did}), {"$set": changes})
    if not r.matched_count:
        raise HTTPException(404, "Depósito não encontrado")
    await write_audit(user, "update", "depot", did, request, new=changes)
    return await db.depots.find_one(tenant_query(user, {"id": did}), NO_ID)


# ---------------- Facilities ----------------
@router.get("/facilities")
async def list_facilities(user: dict = Depends(current_user)):
    return await db.facilities.find(tenant_query(user), NO_ID).to_list(500)


@router.post("/facilities")
async def create_facility(body: FacilityIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"], **body.dict()}
    await db.facilities.insert_one(doc)
    await write_audit(user, "create", "facility", doc["id"], request)
    doc.pop("_id", None)
    return doc


# ---------------- Customers ----------------
@router.get("/customers")
async def list_customers(user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    return await db.customers.find(tenant_query(user), NO_ID).to_list(2000)


@router.post("/customers")
async def create_customer(body: CustomerIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"],
           "created_at": now_iso(), **body.dict()}
    await db.customers.insert_one(doc)
    await write_audit(user, "create", "customer", doc["id"], request)
    doc.pop("_id", None)
    return doc


# ---------------- Zones ----------------
@router.get("/zones")
async def list_zones(user: dict = Depends(current_user)):
    return await db.zones.find(tenant_query(user), NO_ID).to_list(500)


# ---------------- Notifications ----------------
@router.get("/notifications")
async def list_notifications(user: dict = Depends(current_user)):
    q = tenant_query(user, {"$or": [
        {"target_user_id": user["id"]},
        {"target_user_id": None},
    ]})
    return await db.notifications.find(q, NO_ID).sort("created_at", -1).to_list(100)


@router.post("/notifications/{nid}/read")
async def read_notification(nid: str, user: dict = Depends(current_user)):
    await db.notifications.update_one(
        tenant_query(user, {"id": nid}), {"$set": {"read": True}})
    return {"ok": True}


# ---------------- Audit logs ----------------
@router.get("/audit-logs")
async def audit_logs(user: dict = Depends(require_roles(
        "super_admin", "company_admin"))):
    return await db.audit_logs.find(
        tenant_query(user), NO_ID).sort("timestamp", -1).to_list(200)
