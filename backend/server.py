"""WasteFlow API — multi-tenant waste-collection management platform."""
import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core.db import db, ensure_indexes, NO_ID
from core.security import current_user
from services.geo import haversine, bearing, move_towards
from routers import auth, entities, routes as routes_router, tasks, gps, incidents, analytics, ai, users, geocode, tracking, route_templates, route_schedules, alerts

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("wasteflow")

app = FastAPI(title="WasteFlow API")

api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"service": "WasteFlow", "status": "ok"}


@api.get("/health")
async def health():
    return {"status": "healthy", "time": datetime.now(timezone.utc).isoformat()}


api.include_router(auth.router)
api.include_router(entities.router)
api.include_router(routes_router.router)
api.include_router(tasks.router)
api.include_router(gps.router)
api.include_router(incidents.router)
api.include_router(analytics.router)
api.include_router(ai.router)
api.include_router(users.router)
api.include_router(geocode.router)
api.include_router(tracking.router)
api.include_router(route_templates.router)
api.include_router(route_schedules.router)
api.include_router(route_schedules.calendar_router)
api.include_router(alerts.router)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_sim_task = None


async def _simulate_gps():
    """Move in-progress vehicles towards their next stop, emitting GPS pings.
    Gives the real-time map a live feel without external services."""
    while True:
        try:
            vehicles = await db.vehicles.find({}, NO_ID).to_list(2000)
            for v in vehicles:
                if v.get("status") not in ("en_route", "assigned"):
                    continue
                last = await db.gps_positions.find_one(
                    {"vehicle_id": v["id"]}, NO_ID, sort=[("timestamp", -1)])
                if not last:
                    continue
                if last.get("source") == "device":
                    # A real driver is actively reporting GPS for this
                    # vehicle — never fight it with fake positions.
                    seen = datetime.fromisoformat(last["timestamp"])
                    if (datetime.now(timezone.utc) - seen).total_seconds() < 180:
                        continue
                cur = (last["lat"], last["lng"])
                # find next pending task on an in-progress/scheduled route
                task = await db.collection_tasks.find_one(
                    {"vehicle_id": v["id"],
                     "status": {"$in": ["scheduled", "en_route", "arrived"]}},
                    NO_ID, sort=[("sequence", 1)])
                if not task:
                    continue
                target = (task["lat"], task["lng"])
                step_km = random.uniform(0.06, 0.14)
                nxt = move_towards(cur, target, step_km)
                spd = 0 if nxt == target else random.uniform(18, 42)
                await db.gps_positions.insert_one({
                    "id": str(uuid.uuid4()), "company_id": v.get("company_id"),
                    "vehicle_id": v["id"], "lat": nxt[0], "lng": nxt[1],
                    "speed": round(spd, 1), "heading": round(bearing(cur, target), 1),
                    "status": "en_route", "source": "simulated",
                    "timestamp": datetime.now(timezone.utc).isoformat()})
                if v.get("status") != "en_route":
                    await db.vehicles.update_one({"id": v["id"]},
                                                 {"$set": {"status": "en_route"}})
        except Exception as e:  # keep the loop alive
            logger.warning("sim loop: %s", e)
        await asyncio.sleep(5)


@app.on_event("startup")
async def on_startup():
    global _sim_task
    await ensure_indexes()
    _sim_task = asyncio.create_task(_simulate_gps())
    logger.info("WasteFlow API ready")


@app.on_event("shutdown")
async def on_shutdown():
    if _sim_task:
        _sim_task.cancel()
