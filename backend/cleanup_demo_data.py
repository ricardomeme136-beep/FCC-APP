"""Report and, only if explicitly confirmed, remove demo/seed data.

Only ever touches documents tagged `demo: true` — the tag `seed_data.py`
stamps on everything it creates. Real data created through the app (or via
create_admin.py) is never tagged and this script will never see it,
regardless of what it's named or which company it belongs to.

Never runs automatically — nothing in the app calls this. You run it
yourself, on purpose, when you're ready to clear demo data out of an
environment that's moving to real use.

Run:  python cleanup_demo_data.py             (dry-run — reports only, default)
      python cleanup_demo_data.py --confirm    (actually deletes)
"""
import asyncio
import sys

from core.db import db

COLLECTIONS = [
    "companies", "users", "drivers", "vehicles", "containers", "routes",
    "collection_tasks", "collections", "incidents", "depots", "facilities",
    "customers", "zones", "gps_positions", "notifications", "audit_logs",
    "ai_conversations", "tracking_sessions",
]


async def main(confirm: bool) -> None:
    print("=== Limpeza de dados demo — FCC-APP ===")
    print("(dry-run — nada será apagado)\n" if not confirm else
          "(--confirm ativo — os registos abaixo VÃO ser apagados)\n")

    counts = {}
    total = 0
    for coll in COLLECTIONS:
        n = await db[coll].count_documents({"demo": True})
        counts[coll] = n
        total += n
        if n:
            print(f"  {coll}: {n} registo(s) demo")

    if total == 0:
        print("\nNenhum dado demo encontrado (nada marcado com demo: true).")
        return

    print(f"\nTotal: {total} registo(s) marcados como demo.")
    if not confirm:
        print("\nNenhuma alteração foi feita. Corra com --confirm para apagar estes registos:")
        print("  python cleanup_demo_data.py --confirm")
        return

    for coll, n in counts.items():
        if not n:
            continue
        result = await db[coll].delete_many({"demo": True})
        print(f"  {coll}: {result.deleted_count} apagado(s)")
    print("\nConcluído.")


if __name__ == "__main__":
    asyncio.run(main(confirm="--confirm" in sys.argv))
