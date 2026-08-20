"""Weekly scheduling / recurrence (Fase 3) — a route_schedule is a
PLANNING RULE ("this template runs every Mon/Wed/Fri at 06:00"), never an
execution itself. It never touches drivers directly at runtime: it
materializes ordinary `routes` documents ahead of time (via the exact same
snapshot logic Fase 2 already built, `route_templates._build_execution_from_template`)
so a driver's day-to-day experience is completely unchanged — they still
just see `routes` filtered to `mine=true`, with no idea a schedule exists.

Two collections, two different lifetimes:
- route_schedules = intention/rule. Editable, deactivatable, deletable.
- routes (schedule_id set) = concrete, historical execution once created.
  Only ever rewritten while status == "scheduled" (never started) and only
  by this file's own materialization — the same invariant
  assert_route_editable() enforces for manual edits elsewhere.

Materialization window: [today, today + MATERIALIZE_HORIZON_DAYS], capped by
the schedule's own [start_date, end_date]. Deliberately bounded — an
open-ended recurrence must never create routes forever in one call. Runs are
idempotent both at the application level (skip if a route with this
schedule_id+date already exists) and at the database level (unique partial
index on routes.(schedule_id, date) in core/db.py), so calling materialize
twice, or two overlapping calendar requests racing, can never duplicate an
execution.
"""
import uuid
from datetime import datetime, timedelta, timezone, date as date_cls
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import RouteScheduleCreateIn, RouteScheduleUpdateIn
from core.security import current_user, require_roles, tenant_query, write_audit, MANAGEMENT_ROLES
from routers.route_templates import _TIME_RE, _build_execution_from_template

router = APIRouter(prefix="/route-schedules", tags=["route-schedules"])
calendar_router = APIRouter(prefix="/schedule", tags=["route-schedules"])

MATERIALIZE_HORIZON_DAYS = 30


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date_cls:
    return datetime.now(timezone.utc).date()


def _parse_date(s: str) -> date_cls:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(400, "Data inválida — use o formato YYYY-MM-DD")


def _normalize_weekdays(recurrence_type: str, weekdays: list) -> list:
    if recurrence_type == "once":
        return []
    if recurrence_type == "weekdays":
        return [0, 1, 2, 3, 4]
    if recurrence_type == "daily":
        return [0, 1, 2, 3, 4, 5, 6]
    if recurrence_type == "weekly":
        cleaned = sorted({int(d) for d in weekdays})
        if not cleaned or any(d < 0 or d > 6 for d in cleaned):
            raise HTTPException(400, "Indique pelo menos um dia da semana válido (0=segunda .. 6=domingo)")
        return cleaned
    raise HTTPException(400, "recurrence_type inválido — use once, weekly, weekdays ou daily")


def _occurrence_dates(schedule: dict, floor_d: date_cls, ceiling_d: date_cls):
    start = _parse_date(schedule["start_date"])
    end = _parse_date(schedule["end_date"]) if schedule.get("end_date") else None
    lo = max(floor_d, start)
    hi = min(ceiling_d, end) if end else ceiling_d
    if schedule["recurrence_type"] == "once":
        if lo <= start <= hi:
            yield start
        return
    weekdays = set(schedule.get("weekdays") or [])
    d = lo
    while d <= hi:
        if d.weekday() in weekdays:
            yield d
        d += timedelta(days=1)


async def _get_schedule_or_404(user: dict, sid: str) -> dict:
    s = await db.route_schedules.find_one(tenant_query(user, {"id": sid}), NO_ID)
    if not s:
        raise HTTPException(404, "Agendamento não encontrado")
    return s


async def _materialize(user: dict, schedule: dict) -> tuple:
    """Create every not-yet-existing occurrence of `schedule` in the
    materialization window. Returns (created_routes, {date: [warnings]}).
    Silently produces nothing (not an error) when the schedule is inactive
    or its template has been archived — both are legitimate, common states,
    not failures."""
    if not schedule.get("active", True):
        return [], {}
    template = await db.route_templates.find_one(
        tenant_query(user, {"id": schedule["template_id"]}), NO_ID)
    if not template or not template.get("active", True):
        return [], {}

    ceiling = _today() + timedelta(days=MATERIALIZE_HORIZON_DAYS)
    created, conflicts = [], {}
    for d in _occurrence_dates(schedule, _today(), ceiling):
        d_str = d.isoformat()
        exists = await db.routes.find_one(
            tenant_query(user, {"schedule_id": schedule["id"], "date": d_str}), NO_ID)
        if exists:
            continue
        try:
            route_doc, warnings = await _build_execution_from_template(
                user, template, date=d_str, start_time=schedule.get("planned_start_time"),
                driver_id=schedule.get("driver_id"), vehicle_id=schedule.get("vehicle_id"),
                schedule_id=schedule["id"])
        except HTTPException:
            # A container referenced by the template was deleted, or some
            # other per-date validation failure — skip this occurrence
            # rather than aborting the whole batch; the next materialize
            # call (or template fix) will pick it up again since nothing
            # was inserted for this date.
            continue
        created.append(route_doc)
        if warnings:
            conflicts[d_str] = warnings
    return created, conflicts


async def _discard_future_scheduled(user: dict, schedule_id: str) -> None:
    """Remove only the routes this schedule created that are still
    `scheduled` (never started, zero real work) and dated today or later.
    in_progress/completed/cancelled routes are permanent history and are
    never touched — same status model as assert_route_editable() elsewhere.
    Safe to hard-delete (not archive) because a never-started scheduled
    route has no tasks/tracking worth keeping — identical to delete_route()'s
    no-confirmation-needed path for a route with no real work."""
    today = _today().isoformat()
    stale = await db.routes.find(tenant_query(user, {
        "schedule_id": schedule_id, "status": "scheduled", "date": {"$gte": today},
    }), NO_ID).to_list(500)
    for r in stale:
        await db.collection_tasks.delete_many(tenant_query(user, {"route_id": r["id"]}))
        await db.route_stops.delete_many(tenant_query(user, {"route_id": r["id"]}))
        await db.routes.delete_one(tenant_query(user, {"id": r["id"]}))
        if r.get("vehicle_id"):
            await db.vehicles.update_one(tenant_query(user, {"id": r["vehicle_id"]}),
                                         {"$set": {"status": "available"}})
        if r.get("driver_id"):
            await db.drivers.update_one(tenant_query(user, {"id": r["driver_id"]}),
                                        {"$set": {"status": "available"}})


@router.get("")
async def list_schedules(active: Optional[bool] = None, user: dict = Depends(current_user)):
    q = tenant_query(user)
    if active is not None:
        q["active"] = active
    return await db.route_schedules.find(q, NO_ID).sort("updated_at", -1).to_list(1000)


@router.get("/{sid}")
async def get_schedule(sid: str, user: dict = Depends(current_user)):
    return await _get_schedule_or_404(user, sid)


@router.post("")
async def create_schedule(body: RouteScheduleCreateIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    template = await db.route_templates.find_one(tenant_query(user, {"id": body.template_id}), NO_ID)
    if not template:
        raise HTTPException(404, "Rota (template) não encontrada")
    if not template.get("active", True):
        raise HTTPException(400, "Este template está arquivado — reative-o antes de agendar")
    if body.planned_start_time and not _TIME_RE.match(body.planned_start_time):
        raise HTTPException(400, "Hora inválida — use o formato HH:MM")
    _parse_date(body.start_date)
    if body.end_date:
        _parse_date(body.end_date)
        if _parse_date(body.end_date) < _parse_date(body.start_date):
            raise HTTPException(400, "'end_date' tem de ser posterior ou igual a 'start_date'")
    weekdays = _normalize_weekdays(body.recurrence_type, body.weekdays)

    if body.driver_id:
        d = await db.drivers.find_one(tenant_query(user, {"id": body.driver_id}), NO_ID)
        if not d:
            raise HTTPException(400, "Motorista inválido")
    if body.vehicle_id:
        v = await db.vehicles.find_one(tenant_query(user, {"id": body.vehicle_id}), NO_ID)
        if not v:
            raise HTTPException(400, "Viatura inválida")

    doc = {
        "id": str(uuid.uuid4()), "company_id": user["company_id"],
        "template_id": body.template_id, "name": body.name or template["name"],
        "recurrence_type": body.recurrence_type, "start_date": body.start_date,
        "end_date": body.end_date, "weekdays": weekdays,
        "planned_start_time": body.planned_start_time,
        "driver_id": body.driver_id, "vehicle_id": body.vehicle_id,
        "active": True, "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.route_schedules.insert_one(doc)
    doc.pop("_id", None)

    created, conflicts = await _materialize(user, doc)
    await write_audit(user, "create", "route_schedule", doc["id"], request,
                      new={"name": doc["name"], "materialized": len(created)})
    return {"schedule": doc, "materialized": created, "conflicts": conflicts}


@router.patch("/{sid}")
async def update_schedule(sid: str, body: RouteScheduleUpdateIn, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    schedule = await _get_schedule_or_404(user, sid)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items()}
    if not updates:
        return {"schedule": schedule, "materialized": [], "conflicts": {}}

    was_active = schedule.get("active", True)

    if "recurrence_type" in updates or "weekdays" in updates:
        rt = updates.get("recurrence_type", schedule["recurrence_type"])
        wd = updates.get("weekdays", schedule.get("weekdays", []))
        updates["weekdays"] = _normalize_weekdays(rt, wd)
    if "planned_start_time" in updates and updates["planned_start_time"] and not _TIME_RE.match(updates["planned_start_time"]):
        raise HTTPException(400, "Hora inválida — use o formato HH:MM")
    if "start_date" in updates:
        _parse_date(updates["start_date"])
    if "end_date" in updates and updates["end_date"]:
        _parse_date(updates["end_date"])
    if updates.get("template_id"):
        t = await db.route_templates.find_one(tenant_query(user, {"id": updates["template_id"]}), NO_ID)
        if not t:
            raise HTTPException(404, "Rota (template) não encontrada")
    if "driver_id" in updates and updates["driver_id"]:
        d = await db.drivers.find_one(tenant_query(user, {"id": updates["driver_id"]}), NO_ID)
        if not d:
            raise HTTPException(400, "Motorista inválido")
    if "vehicle_id" in updates and updates["vehicle_id"]:
        v = await db.vehicles.find_one(tenant_query(user, {"id": updates["vehicle_id"]}), NO_ID)
        if not v:
            raise HTTPException(400, "Viatura inválida")

    rule_fields = {"template_id", "recurrence_type", "start_date", "end_date",
                   "weekdays", "planned_start_time", "driver_id", "vehicle_id"}
    rule_changed = bool(rule_fields & updates.keys())
    reactivated = updates.get("active") is True and not was_active

    updates["updated_at"] = now_iso()
    await db.route_schedules.update_one(tenant_query(user, {"id": sid}), {"$set": updates})
    schedule.update(updates)

    created, conflicts = [], {}
    if (rule_changed or reactivated) and schedule.get("active", True):
        if rule_changed:
            await _discard_future_scheduled(user, sid)
        created, conflicts = await _materialize(user, schedule)

    await write_audit(user, "update", "route_schedule", sid, request, new=updates)
    return {"schedule": schedule, "materialized": created, "conflicts": conflicts}


@router.delete("/{sid}")
async def delete_schedule(sid: str, request: Request,
                          user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Hard-delete only when nothing was ever materialized from this rule;
    archive (active -> False) instead when at least one route.schedule_id
    references it — same "never destroy real history" principle as
    route_templates.delete_template."""
    schedule = await _get_schedule_or_404(user, sid)
    in_use = await db.routes.count_documents(tenant_query(user, {"schedule_id": sid}))
    if in_use:
        await db.route_schedules.update_one(tenant_query(user, {"id": sid}),
                                            {"$set": {"active": False, "updated_at": now_iso()}})
        await write_audit(user, "archive", "route_schedule", sid, request,
                          new={"message": f"Agendamento '{schedule['name']}' arquivado (tem execuções associadas)."})
        return {"ok": True, "action": "archive"}

    await db.route_schedules.delete_one(tenant_query(user, {"id": sid}))
    await write_audit(user, "delete", "route_schedule", sid, request, old={"name": schedule["name"]})
    return {"ok": True, "action": "delete"}


@router.post("/{sid}/materialize")
async def materialize_endpoint(sid: str, request: Request,
                               user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    schedule = await _get_schedule_or_404(user, sid)
    created, conflicts = await _materialize(user, schedule)
    if created:
        await write_audit(user, "materialize", "route_schedule", sid, request, new={"count": len(created)})
    return {"materialized": created, "conflicts": conflicts}


@router.post("/{sid}/cancel-future-executions")
async def cancel_future_executions(sid: str, request: Request,
                                   user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    """Point 8 — distinct from deactivating: this cancels the future
    `scheduled` routes already materialized, without touching the rule
    itself (call PATCH {active:false} separately, or together, to also stop
    future materialization)."""
    await _get_schedule_or_404(user, sid)
    await _discard_future_scheduled(user, sid)
    await write_audit(user, "cancel_future_executions", "route_schedule", sid, request)
    return {"ok": True}


@calendar_router.get("/calendar")
async def get_calendar(start: str, end: str, user: dict = Depends(current_user)):
    """Enriched, N+1-free calendar view (point 21). Auto-materializes every
    active schedule whose window intersects [start, min(end, horizon)] before
    querying — this is what keeps the agenda fresh without a background
    job/cron: viewing the calendar is itself the trigger."""
    start_d, end_d = _parse_date(start), _parse_date(end)
    if end_d < start_d:
        raise HTTPException(400, "'end' tem de ser posterior ou igual a 'start'")

    horizon_cap = _today() + timedelta(days=MATERIALIZE_HORIZON_DAYS)
    schedules = await db.route_schedules.find(tenant_query(user, {"active": True}), NO_ID).to_list(500)
    for s in schedules:
        s_start = _parse_date(s["start_date"])
        s_end = _parse_date(s["end_date"]) if s.get("end_date") else None
        if s_start > min(end_d, horizon_cap) or (s_end and s_end < start_d):
            continue
        await _materialize(user, s)

    routes = await db.routes.find(tenant_query(user, {"date": {"$gte": start, "$lte": end}}), NO_ID).to_list(2000)

    template_ids = {r["template_id"] for r in routes if r.get("template_id")}
    driver_ids = {r["driver_id"] for r in routes if r.get("driver_id")}
    vehicle_ids = {r["vehicle_id"] for r in routes if r.get("vehicle_id")}
    schedule_ids = {r["schedule_id"] for r in routes if r.get("schedule_id")}

    templates = {t["id"]: t for t in (await db.route_templates.find(
        tenant_query(user, {"id": {"$in": list(template_ids)}}), NO_ID).to_list(500) if template_ids else [])}
    drivers = {d["id"]: d for d in (await db.drivers.find(
        tenant_query(user, {"id": {"$in": list(driver_ids)}}), NO_ID).to_list(500) if driver_ids else [])}
    vehicles = {v["id"]: v for v in (await db.vehicles.find(
        tenant_query(user, {"id": {"$in": list(vehicle_ids)}}), NO_ID).to_list(500) if vehicle_ids else [])}
    schedules_by_id = {s["id"]: s for s in (await db.route_schedules.find(
        tenant_query(user, {"id": {"$in": list(schedule_ids)}}), NO_ID).to_list(500) if schedule_ids else [])}

    items = []
    for r in routes:
        tpl = templates.get(r.get("template_id"))
        drv = drivers.get(r.get("driver_id"))
        veh = vehicles.get(r.get("vehicle_id"))
        items.append({
            "id": r["id"], "code": r.get("code"), "date": r["date"],
            "planned_start_time": r.get("planned_start_time"), "status": r["status"],
            "template_id": r.get("template_id"), "template_name": tpl["name"] if tpl else None,
            "driver_id": r.get("driver_id"), "driver_name": (drv["name"] if drv else r.get("driver_name")),
            "vehicle_id": r.get("vehicle_id"), "vehicle_plate": veh["plate"] if veh else None,
            "schedule_id": r.get("schedule_id"),
            "recurrent": bool(r.get("schedule_id") and r["schedule_id"] in schedules_by_id),
            "duration_min": r.get("duration_min"), "num_stops": r.get("num_stops"),
        })
    items.sort(key=lambda i: (i["date"], i["planned_start_time"] or "99:99"))
    return {"items": items}
