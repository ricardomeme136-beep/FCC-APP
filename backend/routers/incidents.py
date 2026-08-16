"""Incident / ticket management."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db, NO_ID
from core.models import IncidentIn, IncidentUpdate
from core.security import current_user, tenant_query, write_audit
from routers.entities import now_iso

router = APIRouter(tags=["incidents"])


@router.get("/incidents")
async def list_incidents(status: str = None, user: dict = Depends(current_user)):
    q = tenant_query(user)
    if user["role"] == "customer":
        q["customer_id"] = user.get("customer_id")
    if status:
        q["status"] = status
    return await db.incidents.find(q, NO_ID).sort("created_at", -1).to_list(2000)


@router.get("/incidents/{iid}")
async def get_incident(iid: str, user: dict = Depends(current_user)):
    inc = await db.incidents.find_one(tenant_query(user, {"id": iid}), NO_ID)
    if not inc:
        raise HTTPException(404, "Ocorrência não encontrada")
    return inc


@router.post("/incidents")
async def create_incident(body: IncidentIn, request: Request,
                          user: dict = Depends(current_user)):
    iid = str(uuid.uuid4())
    doc = {"id": iid, "company_id": user["company_id"],
           "status": "open", "assigned_to": None,
           "reported_by": user["id"],
           "created_at": now_iso(), "resolved_at": None, **body.dict()}
    if user["role"] == "customer":
        doc["customer_id"] = user.get("customer_id")
    await db.incidents.insert_one(doc)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "company_id": user["company_id"],
        "kind": "new_incident", "title": "Nova ocorrência",
        "body": f"{body.kind} — {body.description[:60]}",
        "target_user_id": None, "read": False, "created_at": now_iso()})
    await write_audit(user, "create", "incident", iid, request, new=body.dict())
    doc.pop("_id", None)
    return doc


@router.patch("/incidents/{iid}")
async def update_incident(iid: str, body: IncidentUpdate, request: Request,
                          user: dict = Depends(current_user)):
    changes = {k: v for k, v in body.dict().items() if v is not None}
    if changes.get("status") in ("resolved", "closed"):
        changes["resolved_at"] = now_iso()
    r = await db.incidents.update_one(
        tenant_query(user, {"id": iid}), {"$set": changes})
    if not r.matched_count:
        raise HTTPException(404, "Ocorrência não encontrada")
    await write_audit(user, "update", "incident", iid, request, new=changes)
    return await db.incidents.find_one(tenant_query(user, {"id": iid}), NO_ID)
