"""Idempotent QA-fixture seeder for the automated test suite.

*** DEVELOPMENT/TEST TOOL ONLY — NEVER RUN THIS AGAINST A PRODUCTION DATABASE. ***

The automated pytest suite (tests/conftest.py) needs a stable, always-present
set of accounts/companies/data to log into and assert against. Historically
it used seed_data.py's demo data for this — but that data is meant to be
disposable (see cleanup_demo_data.py) and gets wiped once a real company
starts using the app for real. This script creates a SEPARATE, permanent
fixture dataset the test suite owns exclusively, tagged `"test_fixture": True`
(never `"demo": True`), so cleanup_demo_data.py — which only ever touches
`demo: true` documents — can never delete it, and it can never be confused
with a real company's data.

Run:  python seed_test_fixtures.py            (seeds only if missing)
      python seed_test_fixtures.py --force    (wipes fixture data and reseeds)

Fixture password for every account: WasteFlowTest2026!
"""
import asyncio
import random
import sys
import uuid
from datetime import datetime, timezone, timedelta

from core.db import db
from core.security import hash_password
from services.optimizer import generate_routes

random.seed(1337)
NOW = datetime.now(timezone.utc)
TODAY = NOW.date().isoformat()
PW = hash_password("WasteFlowTest2026!")

LISBON = (38.7223, -9.1393)

WASTE_CODES = ["general", "paper", "plastic", "glass", "organic", "food", "commercial"]
STREETS = ["Rua Augusta", "Av. da Liberdade", "Rua do Ouro", "Av. Almirante Reis",
           "Rua da Prata", "Av. de Roma", "Rua Castilho", "Av. da República"]

MAIN_SLUG = "qa-main"
SECONDARY_SLUG = "qa-secondary"


def iso(dt):
    return dt.isoformat()


def rand_coord(spread=0.055):
    return (LISBON[0] + random.uniform(-spread, spread),
            LISBON[1] + random.uniform(-spread, spread))


async def _wipe():
    for c in ["companies", "users", "drivers", "vehicles", "containers", "routes",
              "collection_tasks", "collections", "incidents", "depots", "facilities",
              "customers", "zones", "gps_positions", "notifications", "audit_logs",
              "ai_conversations"]:
        await db[c].delete_many({"test_fixture": True})


async def seed_company(name, slug, is_main=False):
    cid = str(uuid.uuid4())
    await db.companies.insert_one({
        "id": cid, "slug": slug, "name": name,
        "created_at": iso(NOW), "test_fixture": True})

    n_drivers = 6 if is_main else 2
    n_vehicles = 6 if is_main else 2
    n_containers = 60 if is_main else 15

    depots = []
    depot_defs = [("Depósito QA Central", 38.74, -9.15), ("Depósito QA Sul", 38.70, -9.12)]
    for i, (dn, la, ln) in enumerate(depot_defs[: (2 if is_main else 1)]):
        d = {"id": str(uuid.uuid4()), "company_id": cid, "name": dn,
             "address": f"{dn}, Lisboa", "lat": la, "lng": ln,
             "hours": "06:00 - 22:00", "capacity": "50 viaturas", "test_fixture": True}
        await db.depots.insert_one(d)
        depots.append(d)

    facilities = []
    fac_defs = [
        ("Aterro QA", "landfill", 38.78, -9.10, ["general", "commercial"]),
        ("Centro de Reciclagem QA", "recycling", 38.76, -9.18, ["paper", "plastic", "glass"]),
        ("Estação de Transferência QA", "transfer", 38.77, -9.16, WASTE_CODES),
        ("Centro de Tratamento Orgânico QA", "treatment", 38.69, -9.19, ["organic", "food"]),
    ]
    for fn, kind, la, ln, acc in fac_defs:
        f = {"id": str(uuid.uuid4()), "company_id": cid, "name": fn, "kind": kind,
             "address": f"{fn}, Lisboa", "lat": la, "lng": ln,
             "accepted_waste_types": acc, "hours": "06:00 - 20:00",
             "contact": "+351 21 000 0000", "test_fixture": True}
        await db.facilities.insert_one(f)
        facilities.append(f)

    zones = []
    for zn in ["Zona QA Centro", "Zona QA Norte"] if is_main else ["Zona QA Única"]:
        z = {"id": str(uuid.uuid4()), "company_id": cid, "name": zn,
             "frequency": "diária", "team": "Equipa QA", "test_fixture": True}
        await db.zones.insert_one(z)
        zones.append(z)

    customers = []
    cust_names = ["QA Câmara Municipal", "QA Hospital Central", "QA Universidade",
                  "QA Restaurante", "QA Hotel", "QA Escola"]
    for cn in (cust_names if is_main else cust_names[:2]):
        c = {"id": str(uuid.uuid4()), "company_id": cid, "name": cn,
             "email": f"{cn.split()[1].lower()}@qa-cliente.test", "phone": "+351 21 111 2222",
             "address": f"{random.choice(STREETS)}, Lisboa", "created_at": iso(NOW), "test_fixture": True}
        await db.customers.insert_one(c)
        customers.append(c)

    driver_names = ["QA Motorista Um", "QA Motorista Dois", "QA Motorista Três",
                    "QA Motorista Quatro", "QA Motorista Cinco", "QA Motorista Seis"]
    drivers = []
    for i in range(n_drivers):
        d = {"id": str(uuid.uuid4()), "company_id": cid,
             "name": driver_names[i % len(driver_names)],
             "phone": f"+351 91{random.randint(1000000, 9999999)}",
             "license_number": f"L-{random.randint(100000, 999999)}",
             "license_type": "C+E", "vehicle_id": None, "status": "available",
             "employment_status": "ativo",
             "created_at": iso(NOW), "test_fixture": True}
        await db.drivers.insert_one(d)
        drivers.append(d)

    vehicles = []
    brands = [("Mercedes", "Econic"), ("Volvo", "FE"), ("Scania", "P320"), ("MAN", "TGS")]
    for i in range(n_vehicles):
        br, mo = random.choice(brands)
        allowed = [] if random.random() < 0.6 else random.sample(WASTE_CODES, 3)
        v = {"id": str(uuid.uuid4()), "company_id": cid,
             "plate": f"QA-{random.randint(10, 99)}-{random.randint(10, 99)}",
             "brand": br, "model": mo, "year": random.randint(2016, 2024),
             "capacity_kg": random.choice([8000, 10000, 12000, 16000]),
             "allowed_waste_types": allowed, "driver_id": None,
             "status": "available", "mileage_km": random.randint(50000, 300000),
             "fuel_pct": random.randint(30, 100),
             "created_at": iso(NOW), "test_fixture": True}
        await db.vehicles.insert_one(v)
        vehicles.append(v)

    containers = []
    freqs = ["diária", "dias alternados", "semanal", "quinzenal"]
    for i in range(n_containers):
        la, ln = rand_coord()
        wt = random.choice(WASTE_CODES)
        c = {"id": str(uuid.uuid4()), "company_id": cid,
             "qr_code": f"QA-{uuid.uuid4().hex[:8].upper()}",
             "address": f"{random.choice(STREETS)}, {random.randint(1, 250)}, Lisboa",
             "lat": la, "lng": ln, "waste_type": wt,
             "container_type": random.choice(["120L", "240L", "800L", "1100L", "Molok"]),
             "capacity_kg": random.choice([120, 240, 500, 800, 1100]),
             "customer_id": random.choice(customers)["id"] if customers else None,
             "zone_id": random.choice(zones)["id"], "frequency": random.choice(freqs),
             "schedule_days": random.sample(["Seg", "Ter", "Qua", "Qui", "Sex"], 3),
             "status": "active", "priority": random.random() < 0.05,
             "installed_at": iso(NOW - timedelta(days=random.randint(30, 900))),
             "last_collection": iso(NOW - timedelta(days=random.randint(1, 5))),
             "next_collection": TODAY, "photos": [], "notes": "",
             "created_at": iso(NOW), "test_fixture": True}
        await db.containers.insert_one(c)
        containers.append(c)

    if is_main:
        await _build_routes(cid, containers, vehicles, drivers, depots, facilities)

    return cid, drivers, customers, vehicles


async def _build_routes(cid, containers, vehicles, drivers, depots, facilities):
    depot = (depots[0]["lat"], depots[0]["lng"])
    facility_for = {}
    for wt in WASTE_CODES:
        m = next((f for f in facilities if wt in f["accepted_waste_types"]), facilities[0])
        facility_for[wt] = (m["lat"], m["lng"])
    trucks = [{"id": v["id"], "capacity_kg": v["capacity_kg"],
               "allowed_waste_types": v["allowed_waste_types"]} for v in vehicles[:4]]
    stops = [{"id": c["id"], "lat": c["lat"], "lng": c["lng"],
              "waste_type": c["waste_type"], "load_kg": c["capacity_kg"] * 0.7,
              "priority": c.get("priority", False), "address": c["address"]}
             for c in containers]
    plan = generate_routes(stops, trucks, depot, facility_for)

    for i, p in enumerate(plan):
        if not p["stops"]:
            continue
        rid = str(uuid.uuid4())
        drv = drivers[i] if i < len(drivers) else None
        end_fac = next((f for f in facilities
                        if p["waste_type"] in f["accepted_waste_types"]), facilities[0])
        in_progress = i < 2
        route = {"id": rid, "company_id": cid, "code": f"R-QA{101 + i:03d}",
                 "date": TODAY, "zone_id": None,
                 "driver_id": drv["id"] if drv else None,
                 "driver_name": drv["name"] if drv else None,
                 "vehicle_id": p["truck_id"], "start_depot_id": depots[0]["id"],
                 "end_facility_id": end_fac["id"], "waste_type": p["waste_type"],
                 "num_stops": p["num_stops"], "distance_km": p["distance_km"],
                 "duration_min": p["duration_min"],
                 "capacity_utilization": p["capacity_utilization"],
                 "load_kg": p["load_kg"],
                 "actual_distance_km": None, "actual_duration_min": None,
                 "status": "in_progress" if in_progress else "scheduled",
                 "started_at": iso(NOW - timedelta(hours=2)) if in_progress else None,
                 "created_at": iso(NOW), "test_fixture": True}
        await db.routes.insert_one(route)

        n = len(p["stops"])
        for seq, s in enumerate(p["stops"]):
            status = "scheduled"
            completed_at = None
            load = None
            fail_reason = None
            if in_progress:
                frac = seq / max(n, 1)
                if frac < 0.45:
                    status = "collected"
                    completed_at = iso(NOW - timedelta(minutes=(n - seq) * 4))
                    load = round(random.uniform(150, 900), 1)
                    if random.random() < 0.12:
                        status = "failed"
                        fail_reason = random.choice(
                            ["Acesso bloqueado", "Contentor cheio", "Estrada bloqueada"])
                        load = None
                elif frac < 0.5:
                    status = "en_route"
            await db.collection_tasks.insert_one({
                "id": str(uuid.uuid4()), "company_id": cid, "route_id": rid,
                "container_id": s["id"], "driver_id": drv["id"] if drv else None,
                "vehicle_id": p["truck_id"], "sequence": seq + 1,
                "waste_type": s["waste_type"], "address": s.get("address", ""),
                "lat": s["lat"], "lng": s["lng"], "status": status,
                "scheduled_date": TODAY, "load_kg": load,
                "arrived_at": None, "completed_at": completed_at,
                "gps": None, "photo_url": None, "notes": "",
                "fail_reason": fail_reason, "test_fixture": True})
            if status == "failed":
                await db.incidents.insert_one({
                    "id": str(uuid.uuid4()), "company_id": cid,
                    "kind": "failed_collection", "priority": "high",
                    "description": f"Recolha falhada: {fail_reason}",
                    "container_id": s["id"], "customer_id": None, "route_id": rid,
                    "driver_id": drv["id"] if drv else None,
                    "lat": s["lat"], "lng": s["lng"], "photo_url": None,
                    "status": "open", "assigned_to": None,
                    "created_at": completed_at or iso(NOW), "resolved_at": None,
                    "test_fixture": True})

        vstatus = "en_route" if in_progress else "assigned"
        await db.vehicles.update_one({"id": p["truck_id"]},
                                     {"$set": {"status": vstatus,
                                               "driver_id": drv["id"] if drv else None}})
        if drv:
            await db.drivers.update_one({"id": drv["id"]},
                                        {"$set": {"status": "assigned",
                                                  "vehicle_id": p["truck_id"]}})
        first = p["stops"][0]
        start_pt = depot if in_progress else (first["lat"], first["lng"])
        await db.gps_positions.insert_one({
            "id": str(uuid.uuid4()), "company_id": cid, "vehicle_id": p["truck_id"],
            "lat": start_pt[0] + random.uniform(-0.01, 0.01),
            "lng": start_pt[1] + random.uniform(-0.01, 0.01),
            "speed": random.uniform(15, 40) if in_progress else 0,
            "heading": random.uniform(0, 360),
            "status": vstatus, "timestamp": iso(NOW), "test_fixture": True})

    for _ in range(3):
        la, ln = rand_coord()
        await db.incidents.insert_one({
            "id": str(uuid.uuid4()), "company_id": cid,
            "kind": random.choice(["container_damaged", "container_full", "vehicle_breakdown"]),
            "priority": random.choice(["low", "medium", "high"]),
            "description": "Ocorrência de teste (fixture QA).",
            "container_id": random.choice(containers)["id"], "customer_id": None,
            "route_id": None, "driver_id": None, "lat": la, "lng": ln,
            "photo_url": None, "status": random.choice(["open", "assigned", "in_progress"]),
            "assigned_to": None, "created_at": iso(NOW - timedelta(hours=random.randint(1, 20))),
            "resolved_at": None, "test_fixture": True})


async def main(force=False):
    existing = await db.companies.find_one({"slug": MAIN_SLUG, "test_fixture": True})
    if existing and not force:
        print("Dados de teste (fixture QA) já existem. Use --force para recriar.")
        return
    await _wipe()

    main_id, main_drivers, main_customers, _ = await seed_company("WasteFlow QA Co", MAIN_SLUG, is_main=True)
    secondary_id, _, _, _ = await seed_company("WasteFlow QA Co B", SECONDARY_SLUG, is_main=False)

    users = [
        ("qa-admin@wasteflow-test.internal", "QA Administrador", "company_admin", main_id, None, None),
        ("qa-dispatcher@wasteflow-test.internal", "QA Despachante", "dispatcher", main_id, None, None),
        ("qa-driver@wasteflow-test.internal", main_drivers[0]["name"], "driver", main_id, main_drivers[0]["id"], None),
        ("qa-manager@wasteflow-test.internal", "QA Gestor de Operações", "operations_manager", main_id, None, None),
        ("qa-customer@wasteflow-test.internal", main_customers[0]["name"], "customer", main_id, None, main_customers[0]["id"]),
        ("qa-admin-b@wasteflow-test.internal", "QA Administrador B", "company_admin", secondary_id, None, None),
    ]
    for email, name, role, comp, drv, cust in users:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": email, "name": name, "role": role,
            "company_id": comp, "driver_id": drv, "customer_id": cust,
            "password_hash": PW, "disabled": False, "created_at": iso(NOW), "test_fixture": True})

    print("Fixture QA concluída (dados marcados como test_fixture — nunca apagados por cleanup_demo_data.py).")
    print(f"  Empresas: {await db.companies.count_documents({'test_fixture': True})}")
    print(f"  Utilizadores: {await db.users.count_documents({'test_fixture': True})}")
    print(f"  Contentores: {await db.containers.count_documents({'test_fixture': True})}")
    print(f"  Rotas: {await db.routes.count_documents({'test_fixture': True})}")


if __name__ == "__main__":
    force = "--force" in sys.argv
    asyncio.run(main(force))
