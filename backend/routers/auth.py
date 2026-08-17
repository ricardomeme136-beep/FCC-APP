"""Authentication endpoints."""
from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import LoginIn
from core.security import current_user, issue_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginIn):
    ident = body.identifier.strip().lower()
    user = await db.users.find_one({"$or": [{"email": ident}, {"username": ident}]})
    valid = user and verify_password(body.password, user["password_hash"])
    if not valid:
        # constant-ish time on missing user
        if not user:
            verify_password(body.password, "$2b$12$C6UzMDM.H6dfI/f/IKcEe.")
        raise HTTPException(status_code=401, detail="Credenciais incorretas")
    if user.get("disabled"):
        raise HTTPException(status_code=401, detail="Esta conta está desativada. Contacte o administrador.")
    token = issue_token(user)
    company = None
    if user.get("company_id"):
        company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "username": user.get("username"),
            "name": user.get("name"),
            "role": user["role"],
            "company_id": user.get("company_id"),
            "driver_id": user.get("driver_id"),
            "customer_id": user.get("customer_id"),
            "company": company,
        },
    }


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    company = None
    if user.get("company_id"):
        company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    return {**user, "company": company}
