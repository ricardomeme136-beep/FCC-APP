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
    await db.users.create_index("email", unique=True)
    await db.users.create_index([("company_id", 1), ("role", 1)])
    for coll in [
        "vehicles", "drivers", "containers", "routes", "collection_tasks",
        "incidents", "depots", "facilities", "customers", "zones",
        "gps_positions", "notifications", "audit_logs",
    ]:
        await db[coll].create_index([("company_id", 1)])
    await db.gps_positions.create_index([("vehicle_id", 1), ("timestamp", -1)])
    await db.collection_tasks.create_index([("route_id", 1)])
    await db.containers.create_index([("company_id", 1), ("id", 1)])
