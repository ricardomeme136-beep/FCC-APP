"""Idempotent demo data seeder for WasteFlow.

Run:  python seed_data.py            (seeds only if empty)
      python seed_data.py --force    (wipes tenant data and reseeds)

Demo password for every account: WasteFlow2026!
"""
import asyncio
import random
import sys
import uuid
from datetime import datetime, timezone, timedelta

from core.db import db
from core.security import hash_password
from services.optimizer import generate_routes

random.seed(42)
NOW = datetime.now(timezone.utc)
TODAY = NOW.date().isoformat()
PW = hash_password("WasteFlow2026!")

LISBON = (38.7223, -9.1393)

WASTE_CODES = ["general", "paper", "plastic", "glass", "organic", "food", "commercial"]
STREETS = ["Rua Augusta", "Av. da Liberdade", "Rua do Ouro", "Av. Almirante Reis",
           "Rua da Prata", "Av. de Roma", "Rua Castilho", "Av. da República",
           "Rua Garrett", "Av. Fontes Pereira de Melo", "Rua de São Bento",
           "Av. Infante Santo", "Rua Morais Soares", "Av. Estados Unidos"]


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
        await db[c].delete_many({})


async def seed_company(name, slug, is_main=False):
    cid = str(uuid.uuid4())
    await db.companies.insert_one({
        "id": cid, "slug": slug, "name": name,
        "created_at": iso(NOW)})

    n_drivers = 8 if is_main else 2
    n_vehicles = 8 if is_main else 2
    n_containers = 140 if is_main else 20

    # Depots
    depots = []
    depot_defs = [("Depósito Central", 38.74, -9.15), ("Depósito Sul", 38.70, -9.12)]
    for i, (dn, la, ln) in enumerate(depot_defs[: (2 if is_main else 1)]):
        d = {"id": str(uuid.uuid4()), "company_id": cid, "name": dn,
             "address": f"{dn}, Lisboa", "lat": la, "lng": ln,
             "hours": "06:00 - 22:00", "capacity": "50 viaturas"}
        await db.depots.insert_one(d)
        depots.append(d)

    # Facilities
    facilities = []
    fac_defs = [
        ("Aterro de Beirolas", "landfill", 38.78, -9.10, ["general", "commercial"]),
        ("Centro de Reciclagem de Lisboa", "recycling", 38.76, -9.18, ["paper", "plastic", "glass"]),
        ("Estação de Transferência Norte", "transfer", 38.77, -9.16, WASTE_CODES),
        ("Centro de Tratamento Orgânico", "treatment", 38.69, -9.19, ["organic", "food"]),
    ]
    for fn, kind, la, ln, acc in fac_defs:
        f = {"id": str(uuid.uuid4()), "company_id": cid, "name": fn, "kind": kind,
             "address": f"{fn}, Lisboa", "lat": la, "lng": ln,
             "accepted_waste_types": acc, "hours": "06:00 - 20:00",
             "contact": "+351 21 000 0000"}
        await db.facilities.insert_one(f)
        facilities.append(f)

    # Zones
    zones = []
    for zn in ["Zona Centro", "Zona Norte", "Zona Oriental"] if is_main else ["Zona Única"]:
        z = {"id": str(uuid.uuid4()), "company_id": cid, "name": zn,
             "frequency": "diária", "team": "Equipa A"}
        await db.zones.insert_one(z)
        zones.append(z)

    # Customers
    customers = []
    cust_names = ["Câmara Municipal de Lisboa", "Continente Colombo", "Hospital de Santa Maria",
                  "Universidade de Lisboa", "El Corte Inglés", "Padaria Central",
                  "Restaurante O Fado", "Hotel Avenida", "Escola Secundária Camões",
                  "Mercado da Ribeira", "Ginásio Fitness Hut", "Farmácia Central"]
    for cn in (cust_names if is_main else cust_names[:3]):
        c = {"id": str(uuid.uuid4()), "company_id": cid, "name": cn,
             "email": f"{cn.split()[0].lower()}@cliente.pt", "phone": "+351 21 111 2222",
             "address": f"{random.choice(STREETS)}, Lisboa", "created_at": iso(NOW)}
        await db.customers.insert_one(c)
        customers.append(c)

    # Drivers
    driver_names = ["João Silva", "Maria Santos", "Carlos Ferreira", "Ana Costa",
                    "Pedro Oliveira", "Sofia Rodrigues", "Miguel Almeida", "Rita Marques",
                    "Tiago Sousa", "Inês Pereira"]
    drivers = []
    for i in range(n_drivers):
        d = {"id": str(uuid.uuid4()), "company_id": cid,
             "name": driver_names[i % len(driver_names)],
             "phone": f"+351 91{random.randint(1000000, 9999999)}",
             "license_number": f"L-{random.randint(100000, 999999)}",
             "license_type": "C+E", "vehicle_id": None, "status": "available",
             "created_at": iso(NOW)}
        await db.drivers.insert_one(d)
        drivers.append(d)

    # Vehicles
    vehicles = []
    brands = [("Mercedes", "Econic"), ("Volvo", "FE"), ("Scania", "P320"),
              ("MAN", "TGS"), ("Renault", "D Wide"), ("Iveco", "Stralis")]
    for i in range(n_vehicles):
        br, mo = random.choice(brands)
        allowed = [] if random.random() < 0.6 else random.sample(WASTE_CODES, 3)
        v = {"id": str(uuid.uuid4()), "company_id": cid,
             "plate": f"{random.randint(10, 99)}-{random.choice(['AB','CD','EF','GH'])}-{random.randint(10, 99)}",
             "brand": br, "model": mo, "year": random.randint(2016, 2024),
             "capacity_kg": random.choice([8000, 10000, 12000, 16000]),
             "allowed_waste_types": allowed, "driver_id": None,
             "status": "available", "mileage_km": random.randint(50000, 300000),
             "fuel_pct": random.randint(30, 100),
             "created_at": iso(NOW)}
        await db.vehicles.insert_one(v)
        vehicles.append(v)

    # Containers
    containers = []
    freqs = ["diária", "dias alternados", "semanal", "quinzenal"]
    for i in range(n_containers):
        la, ln = rand_coord()
        wt = random.choice(WASTE_CODES)
        c = {"id": str(uuid.uuid4()), "company_id": cid,
             "qr_code": f"WF-{uuid.uuid4().hex[:8].upper()}",
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
             "created_at": iso(NOW)}
        await db.containers.insert_one(c)
        containers.append(c)

    # Routes via optimizer (main company only, richer)
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
               "allowed_waste_types": v["allowed_waste_types"]} for v in vehicles[:6]]
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
        # first 3 routes in progress, rest scheduled
        in_progress = i < 3
        route = {"id": rid, "company_id": cid, "code": f"R-{101 + i:03d}",
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
                 "created_at": iso(NOW)}
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
                "fail_reason": fail_reason})
            if status == "failed":
                await db.incidents.insert_one({
                    "id": str(uuid.uuid4()), "company_id": cid,
                    "kind": "failed_collection", "priority": "high",
                    "description": f"Recolha falhada: {fail_reason}",
                    "container_id": s["id"], "customer_id": None, "route_id": rid,
                    "driver_id": drv["id"] if drv else None,
                    "lat": s["lat"], "lng": s["lng"], "photo_url": None,
                    "status": "open", "assigned_to": None,
                    "created_at": completed_at or iso(NOW), "resolved_at": None})

        # vehicle / driver state
        vstatus = "en_route" if in_progress else "assigned"
        await db.vehicles.update_one({"id": p["truck_id"]},
                                     {"$set": {"status": vstatus,
                                               "driver_id": drv["id"] if drv else None}})
        if drv:
            await db.drivers.update_one({"id": drv["id"]},
                                        {"$set": {"status": "assigned",
                                                  "vehicle_id": p["truck_id"]}})
        # seed a GPS position near the depot / first stop
        first = p["stops"][0]
        start_pt = depot if in_progress else (first["lat"], first["lng"])
        await db.gps_positions.insert_one({
            "id": str(uuid.uuid4()), "company_id": cid, "vehicle_id": p["truck_id"],
            "lat": start_pt[0] + random.uniform(-0.01, 0.01),
            "lng": start_pt[1] + random.uniform(-0.01, 0.01),
            "speed": random.uniform(15, 40) if in_progress else 0,
            "heading": random.uniform(0, 360),
            "status": vstatus, "timestamp": iso(NOW)})

    # a few standalone incidents
    for _ in range(4):
        la, ln = rand_coord()
        await db.incidents.insert_one({
            "id": str(uuid.uuid4()), "company_id": cid,
            "kind": random.choice(["container_damaged", "container_full", "vehicle_breakdown"]),
            "priority": random.choice(["low", "medium", "high"]),
            "description": "Ocorrência reportada pela operação.",
            "container_id": random.choice(containers)["id"], "customer_id": None,
            "route_id": None, "driver_id": None, "lat": la, "lng": ln,
            "photo_url": None, "status": random.choice(["open", "assigned", "in_progress"]),
            "assigned_to": None, "created_at": iso(NOW - timedelta(hours=random.randint(1, 20))),
            "resolved_at": None})

    # notifications
    for title, body, kind in [
        ("Recolha falhada", "Contentor não recolhido na Rota R-101", "failed_collection"),
        ("Camião atrasado", "A viatura da Rota R-102 está atrasada", "delay"),
        ("Alerta de capacidade", "Viatura da Rota R-103 a 85% da capacidade", "capacity"),
    ]:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "company_id": cid, "kind": kind,
            "title": title, "body": body, "target_user_id": None, "read": False,
            "created_at": iso(NOW - timedelta(minutes=random.randint(5, 120)))})


async def main(force=False):
    existing = await db.companies.count_documents({})
    if existing and not force:
        print("Já existem dados. Use --force para recriar.")
        return
    await _wipe()

    fcc_id, fcc_drivers, fcc_customers, _ = await seed_company("FCC Ambiente", "fcc", is_main=True)
    suma_id, _, _, _ = await seed_company("SUMA", "suma", is_main=False)
    await seed_company("Resíduos Norte", "norte", is_main=False)

    users = [
        ("super@wasteflow.pt", "Super Administrador", "super_admin", None, None, None),
        ("admin@wasteflow.pt", "Administrador FCC", "company_admin", fcc_id, None, None),
        ("despachante@wasteflow.pt", "Despachante FCC", "dispatcher", fcc_id, None, None),
        ("motorista@wasteflow.pt", fcc_drivers[0]["name"], "driver", fcc_id, fcc_drivers[0]["id"], None),
        ("gestor@wasteflow.pt", "Gestor de Operações", "operations_manager", fcc_id, None, None),
        ("manutencao@wasteflow.pt", "Gestor de Manutenção", "maintenance_manager", fcc_id, None, None),
        ("cliente@wasteflow.pt", fcc_customers[0]["name"], "customer", fcc_id, None, fcc_customers[0]["id"]),
        ("admin@suma.pt", "Administrador SUMA", "company_admin", suma_id, None, None),
    ]
    for email, name, role, comp, drv, cust in users:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": email, "name": name, "role": role,
            "company_id": comp, "driver_id": drv, "customer_id": cust,
            "password_hash": PW, "disabled": False, "created_at": iso(NOW)})
    # link driver record to the driver user
    await db.drivers.update_one({"id": fcc_drivers[0]["id"]},
                                {"$set": {"user_email": "motorista@wasteflow.pt"}})

    print("Seed concluído.")
    print(f"  Empresas: {await db.companies.count_documents({})}")
    print(f"  Utilizadores: {await db.users.count_documents({})}")
    print(f"  Contentores: {await db.containers.count_documents({})}")
    print(f"  Rotas: {await db.routes.count_documents({})}")
    print(f"  Tarefas: {await db.collection_tasks.count_documents({})}")


if __name__ == "__main__":
    force = "--force" in sys.argv
    asyncio.run(main(force))
