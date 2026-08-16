"""Auth: password hashing, JWT, and role/tenant dependencies."""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.db import db, NO_ID

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
TOKEN_DAYS = int(os.getenv("ACCESS_TOKEN_DAYS", "30"))

ROLES = {
    "super_admin", "company_admin", "dispatcher", "driver",
    "operations_manager", "maintenance_manager", "customer",
}

# Management roles that can see the operations dashboard.
MANAGEMENT_ROLES = {
    "super_admin", "company_admin", "dispatcher",
    "operations_manager", "maintenance_manager",
}

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def issue_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "role": user["role"],
        "company_id": user.get("company_id"),
        "iat": now,
        "exp": now + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> dict:
    unauthorized = HTTPException(status_code=401, detail="Autenticação inválida")
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        claims = jwt.decode(
            credentials.credentials, JWT_SECRET,
            algorithms=[JWT_ALGORITHM], options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        raise unauthorized
    user = await db.users.find_one(
        {"id": claims["sub"], "disabled": {"$ne": True}}, {"_id": 0, "password_hash": 0}
    )
    if not user:
        raise unauthorized
    return user


def require_roles(*allowed: str):
    async def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in allowed:
            raise HTTPException(status_code=403, detail="Permissão insuficiente")
        return user
    return dependency


def tenant_query(user: dict, extra: Optional[dict] = None) -> dict:
    """Every tenant-scoped read/write MUST start here."""
    extra = dict(extra or {})
    if user["role"] == "super_admin":
        return extra
    if not user.get("company_id"):
        raise HTTPException(status_code=403, detail="Utilizador sem empresa associada")
    extra["company_id"] = user["company_id"]
    return extra


async def write_audit(user: dict, action: str, entity: str,
                      entity_id: str = "", request: Optional[Request] = None,
                      old: Optional[dict] = None, new: Optional[dict] = None) -> None:
    import uuid
    ip = ""
    if request and request.client:
        ip = request.client.host
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "company_id": user.get("company_id"),
        "user_id": user["id"],
        "user_name": user.get("name", user.get("email")),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "ip": ip,
        "old_value": old,
        "new_value": new,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
