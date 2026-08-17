"""Optional, idempotent backfill: persist route_stops for routes created
before the paragem model existed.

Not required for correctness — GET /routes/{id} already computes virtual
(unpersisted) stops on the fly for routes without route_stops. Run this only
if you want those older routes to have real, editable route_stops documents
(e.g. before using the future stop-reorder/move endpoints on them).

Never deletes or overwrites existing data; skips any route that already has
route_stops.

Run:  python backfill_stops.py
"""
import asyncio
import uuid
from datetime import datetime, timezone

from core.db import db
from services.stops import cluster_into_stops


def iso():
    return datetime.now(timezone.utc).isoformat()


async def backfill_route(route: dict) -> int:
    rid = route["id"]
    existing = await db.route_stops.count_documents({"route_id": rid})
    if existing:
        return 0

    tasks = await db.collection_tasks.find(
        {"route_id": rid}, {"_id": 0}).sort("sequence", 1).to_list(2000)
    if not tasks:
        return 0

    grouped = cluster_into_stops([
        {"id": t["id"], "lat": t["lat"], "lng": t["lng"], "waste_type": t["waste_type"],
         "load_kg": t.get("load_kg") or 0, "priority": False, "address": t.get("address", "")}
        for t in tasks
    ])
    tasks_by_id = {t["id"]: t for t in tasks}
    created = 0
    for i, g in enumerate(grouped):
        stop_id = str(uuid.uuid4())
        task_ids = [tid for tid in g["container_ids"] if tid in tasks_by_id]
        await db.route_stops.insert_one({
            "id": stop_id, "company_id": route.get("company_id"), "route_id": rid,
            "sequence": i + 1, "lat": g["lat"], "lng": g["lng"],
            "address": g["address"], "waste_types": g["waste_types"],
            "task_ids": task_ids, "created_at": iso(),
        })
        for tid in task_ids:
            await db.collection_tasks.update_one({"id": tid}, {"$set": {"stop_id": stop_id}})
        created += 1
    return created


async def main():
    routes = await db.routes.find({}, {"_id": 0}).to_list(20000)
    total_routes = 0
    total_stops = 0
    for r in routes:
        n = await backfill_route(r)
        if n:
            total_routes += 1
            total_stops += n
    print(f"Paragens criadas para {total_routes} rota(s), {total_stops} paragens no total.")
    print("Rotas que já tinham route_stops ou sem tarefas foram ignoradas (nada apagado).")


if __name__ == "__main__":
    asyncio.run(main())
