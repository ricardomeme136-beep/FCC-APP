"""Create the first real administrator account — interactive CLI.

This is the only way to mint a super_admin account (the /users API
deliberately refuses to create one). It's also a normal way to create a
company_admin without going through the app's own "criar utilizador" form.

Run:  python create_admin.py

Nothing is hardcoded — name/email/password/company are all typed
interactively. The password is hidden while typing (getpass) and only its
bcrypt hash is ever stored.
"""
import asyncio
import getpass
import uuid
from datetime import datetime, timezone

from core.db import db
from core.security import hash_password


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _pick_company() -> str:
    companies = await db.companies.find({}, {"_id": 0}).to_list(100)
    if companies:
        print("\nEmpresas existentes:")
        for i, c in enumerate(companies):
            print(f"  {i + 1}. {c['name']} ({c['slug']})")
        print("  0. Criar nova empresa")
        choice = input("Escolha o número (ou 0 para criar uma nova): ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(companies):
            return companies[int(choice) - 1]["id"]

    name = input("Nome da nova empresa: ").strip()
    slug = input("Identificador curto (slug, ex. 'fcc'): ").strip().lower()
    cid = str(uuid.uuid4())
    await db.companies.insert_one({"id": cid, "slug": slug, "name": name, "created_at": now_iso()})
    print(f"Empresa '{name}' criada.")
    return cid


async def main() -> None:
    print("=== Criar administrador — FCC-APP ===\n")
    name = input("Nome: ").strip()
    email = input("Email: ").strip().lower()

    while True:
        password = getpass.getpass("Password (mín. 8 caracteres): ")
        confirm = getpass.getpass("Confirmar password: ")
        if password != confirm:
            print("As passwords não coincidem. Tente novamente.\n")
            continue
        if len(password) < 8:
            print("A password tem de ter pelo menos 8 caracteres.\n")
            continue
        break

    existing = await db.users.find_one({"email": email})
    if existing:
        print(f"\nJá existe uma conta com o email '{email}'. Nada foi criado.")
        return

    kind = input("\nTipo de conta — [1] Administrador da empresa  [2] Super Administrador (todas as empresas): ").strip()
    if kind == "2":
        company_id = None
        role = "super_admin"
    else:
        company_id = await _pick_company()
        role = "company_admin"

    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "name": name, "role": role,
        "company_id": company_id, "driver_id": None, "customer_id": None,
        "password_hash": hash_password(password), "disabled": False,
        "created_at": now_iso(),
    })
    print(f"\nConta criada: {email} ({role}). Já pode fazer login na app.")


if __name__ == "__main__":
    asyncio.run(main())
