"""Reusable route templates (Fase 1) — a route_template is the reusable,
editable PLAN for a route: stops, geometry, planned distance/duration. It
deliberately has no operational fields at all (no date, no status, no
started_at/completed_at, no actual_* metrics, no collected/failed counts) —
those belong only to an execution (`routes`, unchanged by this file).

Architecture choice: template stops are EMBEDDED in the route_template
document (a `stops` array), not a separate collection like `route_stops`.
Reasons: (1) a template is a single cohesive planning unit, edited as a
whole in one screen — there is no cross-template stop query that would
benefit from a separate collection; (2) templates are small (tens of stops,
not the thousands `route_stops` deals with across every execution ever
created); (3) reorder/add/remove/update-stop all become a single atomic
document update instead of multiple document writes that could leave a
template in a half-edited state between them. This also keeps the very
first invariant of the whole templates plan trivially true: a template's
stops are physically independent documents from any `routes`/`route_stops`
created from it — an execution copies plain dicts, never references back.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import (RouteTemplateCreateIn, RouteTemplateUpdateIn, TemplateStopReorderIn,
                         TemplateStopCreateIn, TemplateStopUpdateIn)
from core.security import current_user, require_roles, tenant_query, write_audit, MANAGEMENT_ROLES
from services.routing import road_route
from services.stops import cluster_into_stops
from services.optimizer import SERVICE_MIN_PER_STOP

router = APIRouter(prefix="/route-templates", tags=["route-templates"])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_template_or_404(user: dict, tid: str) -> dict:
    t = await db.route_templates.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not t:
        raise HTTPException(404, "Rota (template) não encontrada")
    return t


async def _validate_containers(user: dict, container_ids: list) -> list:
    if not container_ids:
        return []
    found = await db.containers.find(
        tenant_query(user, {"id": {"$in": container_ids}}), NO_ID).to_list(500)
    if len(found) != len(set(container_ids)):
        raise HTTPException(404, "Um ou mais contentores não foram encontrados")
    return found


def _stop_doc(sequence: int, lat: float, lng: float, address: str, containers: list) -> dict:
    return {
        "id": str(uuid.uuid4()), "sequence": sequence, "lat": lat, "lng": lng,
        "address": address, "waste_types": sorted({c["waste_type"] for c in containers}),
        "container_ids": [c["id"] for c in containers],
    }


async def _resolve_endpoints(user: dict, template: dict):
    start = None
    if template.get("start_depot_id"):
        depot = await db.depots.find_one(tenant_query(user, {"id": template["start_depot_id"]}), NO_ID)
        if depot:
            start = (depot["lat"], depot["lng"])
    elif template.get("start_lat") is not None and template.get("start_lng") is not None:
        start = (template["start_lat"], template["start_lng"])

    end = None
    if template.get("end_facility_id"):
        fac = await db.facilities.find_one(tenant_query(user, {"id": template["end_facility_id"]}), NO_ID)
        if fac:
            end = (fac["lat"], fac["lng"])
    elif template.get("end_lat") is not None and template.get("end_lng") is not None:
        end = (template["end_lat"], template["end_lng"])
    return start, end


async def _recompute_geometry(user: dict, template: dict) -> dict:
    """Eager (not lazily cached like routes.py's GET .../geometry) — a
    template's stop count is small and this keeps distance_km/duration_min
    always correct in the list view without a second request per row.
    duration_min = ORS driving time + SERVICE_MIN_PER_STOP per stop, the same
    composition create_manual_route() already uses for a planned estimate."""
    start, end = await _resolve_endpoints(user, template)
    stops_sorted = sorted(template.get("stops", []), key=lambda s: s["sequence"])
    points = []
    if start:
        points.append(start)
    points.extend((s["lat"], s["lng"]) for s in stops_sorted)
    if end:
        points.append(end)
    if len(points) < 2:
        return {"geometry": None, "distance_km": 0.0, "duration_min": 0.0}
    geo = await road_route(points)
    duration_min = round(geo["duration_s"] / 60 + len(stops_sorted) * SERVICE_MIN_PER_STOP, 1)
    return {"geometry": geo, "distance_km": round(geo["distance_m"] / 1000, 2), "duration_min": duration_min}


async def _save_with_fresh_geometry(user: dict, template: dict) -> dict:
    geo_fields = await _recompute_geometry(user, template)
    updates = {**geo_fields, "updated_at": now_iso()}
    await db.route_templates.update_one(tenant_query(user, {"id": template["id"]}), {"$set": {
        "stops": template["stops"], **updates,
    }})
    template.update(updates)
    return template


@router.get("")
async def list_templates(active: Optional[bool] = None, user: dict = Depends(current_user)):
    q = tenant_query(user)
    if active is not None:
        q["active"] = active
    templates = await db.route_templates.find(q, NO_ID).sort("updated_at", -1).to_list(1000)
    return templates


@router.get("/{tid}")
async def get_template(tid: str, user: dict = Depends(current_user)):
    return await _get_template_or_404(user, tid)


@router.post("")
async def create_template(body: RouteTemplateCreateIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    stops = []
    for i, s in enumerate(body.stops):
        containers = await _validate_containers(user, s.container_ids)
        stops.append(_stop_doc(i + 1, s.lat, s.lng, s.address, containers))

    doc = {
        "id": str(uuid.uuid4()), "company_id": user["company_id"],
        "name": body.name, "description": body.description, "code": body.code,
        "zone_id": body.zone_id, "waste_type": body.waste_type,
        "start_depot_id": body.start_depot_id, "end_facility_id": body.end_facility_id,
        "start_lat": body.start_lat, "start_lng": body.start_lng,
        "end_lat": body.end_lat, "end_lng": body.end_lng,
        "stops": stops, "geometry": None, "distance_km": 0.0, "duration_min": 0.0,
        "default_driver_id": body.default_driver_id, "default_vehicle_id": body.default_vehicle_id,
        "active": True, "created_at": now_iso(), "updated_at": now_iso(),
    }
    geo_fields = await _recompute_geometry(user, doc)
    doc.update(geo_fields)
    await db.route_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "create", "route_template", doc["id"], request, new={"name": doc["name"]})
    return doc


@router.patch("/{tid}")
async def update_template(tid: str, body: RouteTemplateUpdateIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    template = await _get_template_or_404(user, tid)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items()}
    if not updates:
        return template

    endpoint_fields = {"start_depot_id", "end_facility_id", "start_lat", "start_lng", "end_lat", "end_lng"}
    needs_regeometry = bool(endpoint_fields & updates.keys())

    updates["updated_at"] = now_iso()
    await db.route_templates.update_one(tenant_query(user, {"id": tid}), {"$set": updates})
    template.update(updates)

    if needs_regeometry:
        template = await _save_with_fresh_geometry(user, template)

    await write_audit(user, "update", "route_template", tid, request, new=updates)
    return await _get_template_or_404(user, tid)


@router.delete("/{tid}")
async def delete_template(tid: str, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Hard-delete when nothing was ever created from this template; archive
    (active -> False) instead when at least one execution (routes.template_id)
    references it — same "never destroy real history" principle as
    routers/routes.py::delete_route. No execution-creation endpoint exists
    yet (Fase 2), so today this always hard-deletes — the check is here so
    that guarantee holds automatically once Fase 2 adds it, with no further
    change needed here."""
    template = await _get_template_or_404(user, tid)
    in_use = await db.routes.count_documents(tenant_query(user, {"template_id": tid}))
    if in_use:
        await db.route_templates.update_one(tenant_query(user, {"id": tid}),
                                            {"$set": {"active": False, "updated_at": now_iso()}})
        await write_audit(user, "archive", "route_template", tid, request,
                          new={"message": f"Rota (template) '{template['name']}' arquivada (tem execuções associadas)."})
        return {"ok": True, "action": "archive"}

    await db.route_templates.delete_one(tenant_query(user, {"id": tid}))
    await write_audit(user, "delete", "route_template", tid, request, old={"name": template["name"]})
    return {"ok": True, "action": "delete"}


@router.post("/{tid}/duplicate")
async def duplicate_template(tid: str, request: Request, body: Optional[dict] = None,
                             user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    source = await _get_template_or_404(user, tid)
    new_name = (body or {}).get("name") or f"{source['name']} (cópia)"
    doc = {
        **source,
        "id": str(uuid.uuid4()), "name": new_name,
        "stops": [{**s, "id": str(uuid.uuid4())} for s in source["stops"]],
        "active": True, "created_at": now_iso(), "updated_at": now_iso(),
    }
    doc.pop("_id", None)
    await db.route_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "duplicate", "route_template", doc["id"], request,
                      old={"source_id": tid}, new={"name": new_name})
    return doc


@router.patch("/{tid}/stops/reorder")
async def reorder_template_stops(tid: str, body: TemplateStopReorderIn, request: Request,
                                 user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    template = await _get_template_or_404(user, tid)
    by_id = {s["id"]: s for s in template["stops"]}
    if set(body.stop_ids) != set(by_id.keys()):
        raise HTTPException(400, "A lista tem de conter exatamente todas as paragens do template")

    for i, sid in enumerate(body.stop_ids):
        by_id[sid]["sequence"] = i + 1
    template["stops"] = [by_id[sid] for sid in body.stop_ids]
    template = await _save_with_fresh_geometry(user, template)
    await write_audit(user, "reorder", "route_template_stops", tid, request, new={"order": body.stop_ids})
    return template


@router.post("/{tid}/stops")
async def add_template_stop(tid: str, body: TemplateStopCreateIn, request: Request,
                            user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    template = await _get_template_or_404(user, tid)
    next_seq = max((s["sequence"] for s in template["stops"]), default=0) + 1

    new_stops = []
    if body.container_ids:
        containers = await _validate_containers(user, body.container_ids)
        grouped = cluster_into_stops([{"id": c["id"], "lat": c["lat"], "lng": c["lng"],
                                       "waste_type": c["waste_type"], "load_kg": 0,
                                       "priority": False, "address": c.get("address", "")}
                                      for c in containers])
        for i, g in enumerate(grouped):
            new_stops.append(_stop_doc(next_seq + i, g["lat"], g["lng"], g.get("address", ""), g["containers"]))
    elif body.lat is not None and body.lng is not None:
        new_stops.append(_stop_doc(next_seq, body.lat, body.lng, body.address, []))
    else:
        raise HTTPException(400, "Indique contentores ou uma posição no mapa")

    template["stops"] = template["stops"] + new_stops
    template = await _save_with_fresh_geometry(user, template)
    await write_audit(user, "add", "route_template_stop", tid, request,
                      new={"container_ids": body.container_ids, "count": len(new_stops)})
    return template


@router.patch("/{tid}/stops/{sid}")
async def update_template_stop(tid: str, sid: str, body: TemplateStopUpdateIn, request: Request,
                               user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Reposition a stop on the map and/or change which containers it
    represents (associar/desassociar contentores) — a single stop's fields,
    never its sequence (use .../stops/reorder for that)."""
    template = await _get_template_or_404(user, tid)
    stop = next((s for s in template["stops"] if s["id"] == sid), None)
    if not stop:
        raise HTTPException(404, "Paragem não encontrada")

    if body.lat is not None:
        stop["lat"] = body.lat
    if body.lng is not None:
        stop["lng"] = body.lng
    if body.address is not None:
        stop["address"] = body.address
    if body.container_ids is not None:
        containers = await _validate_containers(user, body.container_ids)
        stop["container_ids"] = [c["id"] for c in containers]
        stop["waste_types"] = sorted({c["waste_type"] for c in containers})

    template = await _save_with_fresh_geometry(user, template)
    await write_audit(user, "update", "route_template_stop", sid, request, new=body.dict(exclude_unset=True))
    return template


@router.delete("/{tid}/stops/{sid}")
async def remove_template_stop(tid: str, sid: str, request: Request,
                               user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    template = await _get_template_or_404(user, tid)
    remaining = [s for s in template["stops"] if s["id"] != sid]
    if len(remaining) == len(template["stops"]):
        raise HTTPException(404, "Paragem não encontrada")
    for i, s in enumerate(remaining):
        s["sequence"] = i + 1
    template["stops"] = remaining
    template = await _save_with_fresh_geometry(user, template)
    await write_audit(user, "remove", "route_template_stop", sid, request)
    return template
