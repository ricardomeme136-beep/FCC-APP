"""Real user account management (Fase PROD1).

Self-signup is intentionally not exposed — only admin/dispatcher-tier roles
can create accounts, matching the existing multi-tenant model. Creating a
`super_admin` is deliberately impossible through this API; that only ever
happens via the `create_admin.py` CLI script, run directly against the
database by whoever operates the platform.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from core.db import db, NO_ID
from core.models import UserCreateIn, UserUpdateIn, PasswordResetIn
from core.security import (current_user, require_roles, tenant_query, write_audit,
                           hash_password, MANAGEMENT_ROLES, ROLES)

router = APIRouter(prefix="/users", tags=["users"])

CREATABLE_ROLES = ROLES - {"super_admin"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_users(user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    return await db.users.find(
        tenant_query(user), {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).to_list(2000)


@router.post("")
async def create_user(body: UserCreateIn, request: Request,
                      user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    if body.role not in CREATABLE_ROLES:
        raise HTTPException(400, "Função inválida")
    if not user.get("company_id"):
        raise HTTPException(403, "Utilizador sem empresa associada")

    if body.driver_id:
        already = await db.users.find_one(
            tenant_query(user, {"driver_id": body.driver_id}), NO_ID)
        if already:
            raise HTTPException(400, "Este motorista já tem uma conta associada")

    doc = {
        "id": str(uuid.uuid4()), "email": body.email.lower(), "name": body.name,
        "role": body.role, "company_id": user["company_id"],
        "driver_id": body.driver_id, "customer_id": body.customer_id,
        "password_hash": hash_password(body.password), "disabled": False,
        "created_at": now_iso(),
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, "Já existe uma conta com este email")

    await write_audit(user, "create", "user", doc["id"], request,
                      new={"email": doc["email"], "role": doc["role"]})
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@router.patch("/{uid}")
async def update_user(uid: str, body: UserUpdateIn, request: Request,
                      user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    changes = {k: v for k, v in body.dict().items() if v is not None}
    if "role" in changes and changes["role"] not in CREATABLE_ROLES:
        raise HTTPException(400, "Função inválida")
    if not changes:
        raise HTTPException(400, "Nada para atualizar")

    r = await db.users.update_one(tenant_query(user, {"id": uid}), {"$set": changes})
    if not r.matched_count:
        raise HTTPException(404, "Utilizador não encontrado")
    await write_audit(user, "update", "user", uid, request, new=changes)
    return await db.users.find_one(tenant_query(user, {"id": uid}), {"_id": 0, "password_hash": 0})


@router.post("/{uid}/reset-password")
async def reset_password(uid: str, body: PasswordResetIn, request: Request,
                         user: dict = Depends(require_roles(*MANAGEMENT_ROLES))):
    r = await db.users.update_one(
        tenant_query(user, {"id": uid}),
        {"$set": {"password_hash": hash_password(body.new_password)}})
    if not r.matched_count:
        raise HTTPException(404, "Utilizador não encontrado")
    await write_audit(user, "reset_password", "user", uid, request)
    return {"ok": True}
