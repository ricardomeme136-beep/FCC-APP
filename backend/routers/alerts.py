"""Persisted, deduplicated operational alerts (Fase 1 — alertas).

One document per (company_id, type, container_id) for the lifetime of that
container/problem — never a document per failure event. Currently the only
type is "repeated_failure". Documents are only ever written from
routers/tasks.py (fail_task() upserts, complete_task() auto-resolves) —
this router is read + manual-resolve only, a client can never fabricate an
alert via POST here.

Distinct on purpose from `incidents`: an incident is one ticket per
reported event (still created per-failure in fail_task(), unchanged); an
alert is the aggregated, deduplicated signal of a recurring problem.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import AlertResolveIn
from core.security import current_user, require_roles, tenant_query, write_audit, MANAGEMENT_ROLES
from routers.entities import now_iso

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(status: str = "open", user: dict = Depends(current_user)):
    q = tenant_query(user)
    if status != "all":
        q["status"] = status
    return await db.alerts.find(q, NO_ID).sort("last_failure_at", -1).to_list(500)


@router.post("/{aid}/resolve")
async def resolve_alert(aid: str, request: Request, body: Optional[AlertResolveIn] = None,
                        user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    alert = await db.alerts.find_one(tenant_query(user, {"id": aid}), NO_ID)
    if not alert:
        raise HTTPException(404, "Alerta não encontrado")
    if alert["status"] == "resolved":
        # Idempotent — a second click (or a slow double-tap) is a no-op,
        # never a duplicate resolution_history entry.
        return alert

    ts = now_iso()
    entry = {
        "resolved_at": ts, "resolved_by": user["id"], "resolution_type": "manual",
        "occurrence_count_at_resolution": alert["occurrence_count"],
    }
    if body and body.resolution_note:
        entry["resolution_note"] = body.resolution_note

    await db.alerts.update_one(
        tenant_query(user, {"id": aid}),
        {"$set": {"status": "resolved", "resolved_at": ts, "resolved_by": user["id"], "updated_at": ts},
         "$push": {"resolution_history": entry}})
    await write_audit(user, "resolve", "alert", aid, request, new={"resolution_type": "manual"})
    return await db.alerts.find_one(tenant_query(user, {"id": aid}), NO_ID)
