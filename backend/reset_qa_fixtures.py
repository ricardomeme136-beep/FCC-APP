"""Wipe and re-seed the QA test-fixture companies (WasteFlow QA Co / Co B).

The automated pytest suite creates disposable throwaway accounts/drivers/
routes on every run (prefixed TEST_/test_) inside these two companies and
never cleans them up — after many runs that adds up to a lot of clutter.
Because a super_admin account sees data across every company, that clutter
shows up in the real admin's app too, even though it's fully isolated from
real company data.

This script deletes EVERYTHING scoped to the two QA company_ids (fixtures
and accumulated test junk alike — the fixture data is fully described by
seed_test_fixtures.py, so nothing here is precious) and then re-seeds a
clean baseline via seed_test_fixtures.py --force. It never touches any
other company.

Run:  python reset_qa_fixtures.py             (dry-run — reports only)
      python reset_qa_fixtures.py --confirm   (actually wipes + reseeds)
"""
import asyncio
import sys

from core.db import db
import seed_test_fixtures

COLLECTIONS = [
    "users", "drivers", "vehicles", "containers", "routes",
    "collection_tasks", "collections", "incidents", "depots", "facilities",
    "customers", "zones", "gps_positions", "notifications", "audit_logs",
    "ai_conversations",
]


async def main(confirm: bool) -> None:
    companies = await db.companies.find(
        {"slug": {"$in": [seed_test_fixtures.MAIN_SLUG, seed_test_fixtures.SECONDARY_SLUG]}},
        {"_id": 0},
    ).to_list(10)
    ids = [c["id"] for c in companies]
    if not ids:
        print("Nenhuma empresa QA encontrada — nada a limpar. A semear do zero...")
    else:
        print(f"Empresas QA encontradas: {[c['name'] for c in companies]}")
        total = 0
        for coll in COLLECTIONS:
            n = await db[coll].count_documents({"company_id": {"$in": ids}})
            total += n
            if n:
                print(f"  {coll}: {n} registo(s)")
        print(f"Total a apagar: {total} registo(s) + {len(ids)} empresa(s)")

        if not confirm:
            print("\n(dry-run — nada apagado. Corra com --confirm para apagar e voltar a semear.)")
            return

        for coll in COLLECTIONS:
            await db[coll].delete_many({"company_id": {"$in": ids}})
        await db.companies.delete_many({"id": {"$in": ids}})
        print("Limpo.")

    if confirm:
        await seed_test_fixtures.main(force=True)


if __name__ == "__main__":
    asyncio.run(main(confirm="--confirm" in sys.argv))
