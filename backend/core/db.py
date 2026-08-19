"""MongoDB connection and shared helpers."""
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Reads always strip the internal Mongo _id — we use our own uuid `id`.
NO_ID = {"_id": 0}


async def ensure_indexes() -> None:
    # email is optional now (drivers can log in with a `username` — e.g. their
    # employee number — instead), so the index must be sparse: a non-sparse
    # unique index would reject every user after the first that omits email.
    # Older DBs still have the original non-sparse index under the same
    # name/keys; create_index() can't alter an existing index's options, so
    # fall back to drop-and-recreate the one time this hits an old index.
    try:
        await db.users.create_index("email", unique=True, sparse=True)
    except Exception:
        await db.users.drop_index("email_1")
        await db.users.create_index("email", unique=True, sparse=True)
    await db.users.create_index("username", unique=True, sparse=True)
    await db.users.create_index([("company_id", 1), ("role", 1)])
    for coll in [
        "vehicles", "drivers", "containers", "routes", "collection_tasks",
        "incidents", "depots", "facilities", "customers", "zones",
        "gps_positions", "notifications", "audit_logs", "route_stops",
        "tracking_sessions", "route_templates",
    ]:
        await db[coll].create_index([("company_id", 1)])
    await db.route_templates.create_index("name")
    await db.route_templates.create_index("active")
    await db.route_templates.create_index([("company_id", 1), ("active", 1)])
    await db.gps_positions.create_index([("vehicle_id", 1), ("timestamp", -1)])
    await db.gps_positions.create_index([("tracking_session_id", 1), ("timestamp", 1)])
    # sparse: only recorded-trajectory points carry a point_uuid — live nav
    # positions (routers/gps.py) never set one and must not collide on it.
    await db.gps_positions.create_index("point_uuid", unique=True, sparse=True)
    await db.collection_tasks.create_index([("route_id", 1)])
    await db.collection_tasks.create_index([("stop_id", 1)])
    await db.containers.create_index([("company_id", 1), ("id", 1)])
    await db.route_stops.create_index([("route_id", 1), ("sequence", 1)])
    await db.tracking_sessions.create_index([("driver_id", 1), ("status", 1)])
