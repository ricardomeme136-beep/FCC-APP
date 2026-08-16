"""Collection task endpoints (driver flow) + geofencing + offline-safe sync."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from core.db import db, NO_ID
from core.models import TaskCompleteIn, TaskFailIn
from core.security import current_user, tenant_query
from services.geo import haversine
from routers.entities import now_iso

router = APIRouter(tags=["tasks"])

GEOFENCE_MAX_M = 120  # configurable max distance to allow a collection


async def _notify(company_id, kind, title, body, target_user_id=None):
    import uuid
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "company_id": company_id, "kind": kind,
        "title": title, "body": body, "target_user_id": target_user_id,
        "read": False, "created_at": now_iso(),
    })


@router.get("/collection-tasks")
async def list_tasks(
    user: dict = Depends(current_user),
    route_id: str = Query(None),
    status: str = Query(None),
    date: str = Query(None),
    mine: bool = Query(False),
):
    q = tenant_query(user)
    if route_id:
        q["route_id"] = route_id
    if status:
        q["status"] = status
    if date:
        q["scheduled_date"] = date
    if mine and user.get("driver_id"):
        q["driver_id"] = user["driver_id"]
    return await db.collection_tasks.find(q, NO_ID).sort("sequence", 1).to_list(5000)


@router.get("/collection-tasks/{tid}")
async def get_task(tid: str, user: dict = Depends(current_user)):
    t = await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not t:
        raise HTTPException(404, "Tarefa não encontrada")
    container = await db.containers.find_one(
        tenant_query(user, {"id": t["container_id"]}), NO_ID)
    t["container"] = container
    return t


def _authorize_driver(user, task):
    if user["role"] == "driver" and task.get("driver_id") != user.get("driver_id"):
        raise HTTPException(403, "Esta recolha não está atribuída a si")


@router.post("/collection-tasks/{tid}/complete")
async def complete_task(tid: str, body: TaskCompleteIn,
                        user: dict = Depends(current_user)):
    task = await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not task:
        raise HTTPException(404, "Tarefa não encontrada")
    _authorize_driver(user, task)
    # idempotent: already collected -> return it (offline retries)
    if task["status"] == "collected":
        return task

    # geofence
    if body.lat is not None and body.lng is not None:
        dist_m = haversine((body.lat, body.lng), (task["lat"], task["lng"])) * 1000
        if dist_m > GEOFENCE_MAX_M:
            raise HTTPException(
                status_code=409,
                detail=f"Está a aproximadamente {int(dist_m)} metros do contentor.")

    ts = now_iso()
    changes = {
        "status": "collected", "completed_at": ts,
        "load_kg": body.weight_kg, "photo_url": body.photo_url,
        "notes": body.notes,
        "gps": {"lat": body.lat, "lng": body.lng} if body.lat is not None else None,
    }
    await db.collection_tasks.update_one(
        tenant_query(user, {"id": tid}), {"$set": changes})
    await db.containers.update_one(
        tenant_query(user, {"id": task["container_id"]}),
        {"$set": {"last_collection": ts}})
    # record a collection event
    import uuid
    await db.collections.insert_one({
        "id": str(uuid.uuid4()), "company_id": task["company_id"],
        "task_id": tid, "container_id": task["container_id"],
        "driver_id": task.get("driver_id"), "vehicle_id": task.get("vehicle_id"),
        "route_id": task.get("route_id"), "weight_kg": body.weight_kg,
        "gps": changes["gps"], "timestamp": ts,
    })
    return await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)


@router.post("/collection-tasks/{tid}/fail")
async def fail_task(tid: str, body: TaskFailIn, user: dict = Depends(current_user)):
    task = await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not task:
        raise HTTPException(404, "Tarefa não encontrada")
    _authorize_driver(user, task)
    if task["status"] == "failed":
        return task

    ts = now_iso()
    await db.collection_tasks.update_one(
        tenant_query(user, {"id": tid}),
        {"$set": {"status": "failed", "fail_reason": body.reason,
                  "photo_url": body.photo_url, "notes": body.notes,
                  "completed_at": ts,
                  "gps": {"lat": body.lat, "lng": body.lng} if body.lat is not None else None}})
    # auto-create incident
    import uuid
    inc_id = str(uuid.uuid4())
    await db.incidents.insert_one({
        "id": inc_id, "company_id": task["company_id"],
        "kind": "failed_collection", "priority": "high",
        "description": f"Recolha falhada: {body.reason}. {body.notes}".strip(),
        "container_id": task["container_id"], "customer_id": None,
        "route_id": task.get("route_id"), "driver_id": task.get("driver_id"),
        "lat": body.lat, "lng": body.lng, "photo_url": body.photo_url,
        "status": "open", "assigned_to": None,
        "created_at": ts, "resolved_at": None,
    })
    await _notify(task["company_id"], "failed_collection",
                  "Recolha falhada",
                  f"Contentor não recolhido — {body.reason}")
    return await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)


@router.post("/collection-tasks/{tid}/arrived")
async def arrived(tid: str, user: dict = Depends(current_user)):
    task = await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not task:
        raise HTTPException(404, "Tarefa não encontrada")
    _authorize_driver(user, task)
    if task["status"] in ("collected", "failed"):
        return task
    await db.collection_tasks.update_one(
        tenant_query(user, {"id": tid}),
        {"$set": {"status": "arrived", "arrived_at": now_iso()}})
    return await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)


@router.post("/collection-tasks/{tid}/ignore")
async def ignore_task(tid: str, user: dict = Depends(current_user)):
    task = await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)
    if not task:
        raise HTTPException(404, "Tarefa não encontrada")
    _authorize_driver(user, task)
    if task["status"] in ("collected", "failed"):
        return task
    await db.collection_tasks.update_one(
        tenant_query(user, {"id": tid}),
        {"$set": {"status": "ignored", "completed_at": now_iso()}})
    return await db.collection_tasks.find_one(tenant_query(user, {"id": tid}), NO_ID)


@router.post("/collection-tasks/sync")
async def sync_offline(events: list, user: dict = Depends(current_user)):
    """Batch sync from the driver app after being offline. Each event:
    {task_id, type: 'complete'|'fail', payload}. Idempotent by task status."""
    results = []
    for ev in events:
        tid = ev.get("task_id")
        try:
            if ev.get("type") == "complete":
                r = await complete_task(tid, TaskCompleteIn(**ev.get("payload", {})), user)
            else:
                r = await fail_task(tid, TaskFailIn(**ev.get("payload", {})), user)
            results.append({"task_id": tid, "ok": True, "status": r["status"]})
        except HTTPException as e:
            results.append({"task_id": tid, "ok": False, "error": e.detail})
    return {"results": results}
