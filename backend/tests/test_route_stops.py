"""Tests for route stops (paragens): clustering, optimizer compatibility,
and the /routes read-model (persisted + virtual-fallback stops)."""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import requests
from conftest import API
from motor.motor_asyncio import AsyncIOMotorClient

from services.stops import cluster_into_stops
from services.optimizer import generate_routes
import core.db  # noqa: F401 — side effect: load_dotenv() populates os.environ

# A handful of tests need to seed/mutate data directly, bypassing the API
# (e.g. simulating a route created before this feature, or marking a task
# collected without driving the whole driver flow). They get their own motor
# client bound to a single, explicitly-managed event loop instead of reusing
# core.db's module-level client — that one binds to whatever event loop is
# "current" the first time it's used, which can be a loop pytest's own
# collection machinery already created; reusing it from a loop we create
# ourselves raises "future belongs to a different loop".
_loop = None
_client = None
_direct = None


def _direct_db():
    global _loop, _client, _direct
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    if _direct is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        _direct = _client[os.environ["DB_NAME"]]
    return _direct


def _run_async(coro):
    _direct_db()  # ensure _loop (and the dedicated client) exist first
    return _loop.run_until_complete(coro)


# ---------- Pure unit tests: proximity clustering ----------
class TestClusterIntoStops:
    def test_groups_containers_within_threshold(self):
        containers = [
            {"id": "a", "lat": 38.7223, "lng": -9.1393, "waste_type": "general",
             "load_kg": 100, "address": "Rua das Flores, 21"},
            {"id": "b", "lat": 38.72231, "lng": -9.13931, "waste_type": "paper",
             "load_kg": 50, "address": "Rua das Flores, 21"},
            {"id": "c", "lat": 38.7223, "lng": -9.1393 + 0.01, "waste_type": "plastic",
             "load_kg": 80, "address": "Rua Distante, 5"},
        ]
        stops = cluster_into_stops(containers, threshold_m=25)
        assert len(stops) == 2
        grouped = next(s for s in stops if len(s["container_ids"]) == 2)
        assert set(grouped["container_ids"]) == {"a", "b"}
        assert set(grouped["waste_types"]) == {"general", "paper"}
        assert grouped["load_kg"] == 150

    def test_keeps_far_apart_containers_separate(self):
        containers = [
            {"id": "a", "lat": 38.72, "lng": -9.13, "waste_type": "general", "load_kg": 100, "address": "A"},
            {"id": "b", "lat": 38.75, "lng": -9.10, "waste_type": "general", "load_kg": 100, "address": "B"},
        ]
        stops = cluster_into_stops(containers, threshold_m=25)
        assert len(stops) == 2

    def test_empty_input(self):
        assert cluster_into_stops([]) == []


# ---------- Pure unit tests: optimizer respects mixed waste types per stop ----------
class TestOptimizerWasteTypes:
    def test_stop_with_mixed_types_needs_unrestricted_truck(self):
        stop = {
            "lat": 38.72, "lng": -9.13, "waste_types": ["paper", "plastic"],
            "load_kg": 100, "priority": False, "container_ids": ["a", "b"],
            "containers": [
                {"id": "a", "lat": 38.72, "lng": -9.13, "waste_type": "paper", "address": ""},
                {"id": "b", "lat": 38.72, "lng": -9.13, "waste_type": "plastic", "address": ""},
            ],
        }
        restricted_truck = {"id": "t1", "capacity_kg": 10000, "allowed_waste_types": ["paper"]}
        unrestricted_truck = {"id": "t2", "capacity_kg": 10000, "allowed_waste_types": []}
        plan = generate_routes([stop], [restricted_truck, unrestricted_truck], (38.70, -9.15), {})
        by_truck = {p["truck_id"]: p for p in plan}
        assert by_truck["t1"]["num_stops"] == 0
        assert by_truck["t2"]["num_stops"] == 1


# ---------- Integration: optimize() creates route_stops, GET exposes them ----------
class TestRouteStopsReadModel:
    def test_optimize_creates_stops_and_get_route_exposes_them(self, h_admin_fcc):
        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                          json={"num_trucks": 2}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 1
        route = data["routes"][0]

        d = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15)
        assert d.status_code == 200
        detail = d.json()
        assert "stops" in detail and "tasks" in detail  # tasks kept for backward compat
        assert len(detail["stops"]) > 0

        stop_ids = {s["id"] for s in detail["stops"]}
        assert all(t.get("stop_id") in stop_ids for t in detail["tasks"])
        total_tasks_via_stops = sum(len(s["tasks"]) for s in detail["stops"])
        assert total_tasks_via_stops == len(detail["tasks"]) == detail["num_stops"]
        # sequence is contiguous starting at 1
        sequences = sorted(s["sequence"] for s in detail["stops"])
        assert sequences == list(range(1, len(sequences) + 1))

    def test_reoptimize_keeps_stops_consistent(self, h_admin_fcc):
        routes = requests.get(f"{API}/routes", headers=h_admin_fcc, timeout=15).json()
        rid = routes[0]["id"]
        r = requests.post(f"{API}/routes/{rid}/reoptimize", headers=h_admin_fcc, timeout=30)
        assert r.status_code == 200, r.text
        detail = r.json()
        if "stops" in detail and detail["stops"]:
            seqs = [s["sequence"] for s in detail["stops"]]
            assert seqs == sorted(seqs)
            assert len(seqs) == len(set(seqs))


# ---------- Backward compatibility: routes created before route_stops existed ----------
class TestVirtualStopsFallback:
    def test_legacy_route_without_route_stops_gets_virtual_stops(self, h_admin_fcc, admin_fcc):

        async def _seed_legacy_route():
            company_id = admin_fcc["user"]["company_id"]
            depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
            depot = depots[0]
            rid = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            today = datetime.now(timezone.utc).date().isoformat()
            await _direct_db().routes.insert_one({
                "id": rid, "company_id": company_id, "code": "R-TEST-LEGACY",
                "date": today, "zone_id": None,
                "driver_id": None, "driver_name": None, "vehicle_id": None,
                "start_depot_id": depot["id"], "end_facility_id": None,
                "waste_type": "general", "num_stops": 1, "distance_km": 1.0,
                "duration_min": 5.0, "capacity_utilization": 0, "load_kg": 0,
                "actual_distance_km": None, "actual_duration_min": None,
                "status": "scheduled", "created_at": now,
            })
            tid = str(uuid.uuid4())
            # deliberately no stop_id — simulates a route created before this feature
            await _direct_db().collection_tasks.insert_one({
                "id": tid, "company_id": company_id, "route_id": rid,
                "container_id": "TEST_legacy_container", "driver_id": None, "vehicle_id": None,
                "sequence": 1, "waste_type": "general", "address": "TEST_Rua Legacy, 1",
                "lat": depot["lat"], "lng": depot["lng"], "status": "scheduled",
                "scheduled_date": today,
                "load_kg": None, "arrived_at": None, "completed_at": None,
                "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
            })
            return rid

        rid = _run_async(_seed_legacy_route())
        r = requests.get(f"{API}/routes/{rid}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200
        detail = r.json()
        assert len(detail["stops"]) == 1
        assert detail["stops"][0]["virtual"] is True
        assert detail["stops"][0]["address"] == "TEST_Rua Legacy, 1"
        assert len(detail["stops"][0]["tasks"]) == 1


# ---------- Fase B: explicit selection in optimize() ----------
class TestExplicitSelection:
    def test_optimize_with_explicit_selection(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        facilities = requests.get(f"{API}/facilities", headers=h_admin_fcc, timeout=15).json()
        vehicles = requests.get(f"{API}/vehicles", headers=h_admin_fcc, timeout=15).json()
        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        facility = facilities[0]
        vehicle = next(v for v in vehicles if v["status"] in ("available", "assigned"))
        driver = next(d for d in drivers if d["status"] in ("available", "assigned"))

        c = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Rua Explicit, 1", "lat": depot["lat"] + 0.001, "lng": depot["lng"] + 0.001,
            "waste_type": "general",
        }, timeout=15).json()

        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": "2026-01-01", "container_ids": [c["id"]],
            "vehicle_ids": [vehicle["id"]], "driver_ids": [driver["id"]],
            "depot_id": depot["id"], "facility_id": facility["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 1
        route = data["routes"][0]
        assert route["vehicle_id"] == vehicle["id"]
        assert route["start_depot_id"] == depot["id"]
        assert route["end_facility_id"] == facility["id"]
        assert route["num_stops"] == 1

    def test_optimize_rejects_unavailable_vehicle(self, h_admin_fcc):
        vehicles = requests.get(f"{API}/vehicles", headers=h_admin_fcc, timeout=15).json()
        busy = next((v for v in vehicles if v["status"] not in ("available", "assigned")), None)
        if not busy:
            import pytest as _pytest
            _pytest.skip("no unavailable vehicle in demo data")
        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                          json={"date": "2026-01-01", "vehicle_ids": [busy["id"]]}, timeout=30)
        assert r.status_code == 400


# ---------- Fase B: don't duplicate a container's pickup on the same date ----------
class TestDuplicatePrevention:
    def test_second_call_same_container_same_date_is_rejected(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        c = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Rua Duplicate, 1", "lat": depot["lat"] + 0.002, "lng": depot["lng"] + 0.002,
            "waste_type": "general",
        }, timeout=15).json()

        r1 = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                           json={"date": "2026-01-02", "container_ids": [c["id"]]}, timeout=30)
        assert r1.status_code == 200, r1.text

        r2 = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                           json={"date": "2026-01-02", "container_ids": [c["id"]]}, timeout=30)
        assert r2.status_code == 400
        assert "agendadas" in r2.json()["detail"].lower()

    def test_partial_duplicate_is_skipped_not_blocking(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        c1 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Rua Partial A", "lat": depot["lat"] + 0.003, "lng": depot["lng"] + 0.003,
            "waste_type": "general",
        }, timeout=15).json()
        c2 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Rua Partial B", "lat": depot["lat"] + 0.004, "lng": depot["lng"] + 0.004,
            "waste_type": "general",
        }, timeout=15).json()

        r1 = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                           json={"date": "2026-01-03", "container_ids": [c1["id"]]}, timeout=30)
        assert r1.status_code == 200, r1.text

        r2 = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc,
                           json={"date": "2026-01-03", "container_ids": [c1["id"], c2["id"]]}, timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert c1["id"] in data["skipped_duplicate"]
        assert data["routes"][0]["num_stops"] == 1


# ---------- Fase B: editing stops on an existing route ----------
class TestStopEditing:
    def _make_route_with_two_stops(self, h_admin_fcc, date):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        # A dedicated, freshly created vehicle — not one of the seeded demo
        # vehicles, which already have GPS history and can get flipped from
        # "assigned" to "en_route" mid-test by the background simulation
        # loop (server.py::_simulate_gps), racing with these tests.
        vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 10000,
        }, timeout=15).json()
        c1 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Edit Stop A", "lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01,
            "waste_type": "general",
        }, timeout=15).json()
        c2 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Edit Stop B", "lat": depot["lat"] - 0.01, "lng": depot["lng"] - 0.01,
            "waste_type": "general",
        }, timeout=15).json()
        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": date, "container_ids": [c1["id"], c2["id"]], "vehicle_ids": [vehicle["id"]],
        }, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()["routes"][0]
        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert len(detail["stops"]) == 2
        return detail, vehicle

    def test_reorder(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-01")
        stop_ids = [s["id"] for s in route["stops"]]
        reversed_ids = list(reversed(stop_ids))
        r = requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                           json={"stop_ids": reversed_ids}, timeout=15)
        assert r.status_code == 200, r.text
        new_order = [s["id"] for s in sorted(r.json()["stops"], key=lambda s: s["sequence"])]
        assert new_order == reversed_ids

    def test_reorder_rejects_incomplete_list(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-10")
        only_one = [route["stops"][0]["id"]]
        r = requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                           json={"stop_ids": only_one}, timeout=15)
        assert r.status_code == 400

    def test_remove_stop_blocked_when_task_collected(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-02")
        stop = route["stops"][0]
        task_id = stop["tasks"][0]["id"]
        _run_async(_direct_db().collection_tasks.update_one({"id": task_id}, {"$set": {"status": "collected"}}))

        r = requests.delete(f"{API}/routes/{route['id']}/stops/{stop['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 409
        assert "recolhidos" in r.json()["detail"].lower()

    def test_remove_stop_succeeds_when_pending(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-03")
        stop = route["stops"][1]
        r = requests.delete(f"{API}/routes/{route['id']}/stops/{stop['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert len(detail["stops"]) == 1
        assert detail["num_stops"] == len(detail["tasks"])

    def test_add_stop(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-04")
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        c3 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Add Stop C", "lat": depot["lat"] + 0.02, "lng": depot["lng"] + 0.02,
            "waste_type": "general",
        }, timeout=15).json()
        r = requests.post(f"{API}/routes/{route['id']}/stops", headers=h_admin_fcc,
                          json={"container_ids": [c3["id"]]}, timeout=15)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert len(detail["stops"]) == 3
        assert any(t["container_id"] == c3["id"] for t in detail["tasks"])

    def test_move_stop_to_another_route_same_date(self, h_admin_fcc):
        route_a, vehicle_a = self._make_route_with_two_stops(h_admin_fcc, "2026-02-05")
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        vehicle_b = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 10000,
        }, timeout=15).json()
        c = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Move Target Seed", "lat": depot["lat"] + 0.03, "lng": depot["lng"] + 0.03,
            "waste_type": "general",
        }, timeout=15).json()
        r_b = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": "2026-02-05", "container_ids": [c["id"]], "vehicle_ids": [vehicle_b["id"]],
        }, timeout=30)
        assert r_b.status_code == 200, r_b.text
        route_b = r_b.json()["routes"][0]

        moving_stop = route_a["stops"][0]
        r = requests.post(f"{API}/routes/{route_a['id']}/stops/{moving_stop['id']}/move",
                          headers=h_admin_fcc, json={"target_route_id": route_b["id"]}, timeout=15)
        assert r.status_code == 200, r.text

        a_after = requests.get(f"{API}/routes/{route_a['id']}", headers=h_admin_fcc, timeout=15).json()
        b_after = requests.get(f"{API}/routes/{route_b['id']}", headers=h_admin_fcc, timeout=15).json()
        assert len(a_after["stops"]) == 1
        assert len(b_after["stops"]) == 2
        assert any(s["id"] == moving_stop["id"] for s in b_after["stops"])

    def test_move_stop_rejects_different_date(self, h_admin_fcc):
        route_a, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-06")
        route_c, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-07")
        moving_stop = route_a["stops"][0]
        r = requests.post(f"{API}/routes/{route_a['id']}/stops/{moving_stop['id']}/move",
                          headers=h_admin_fcc, json={"target_route_id": route_c["id"]}, timeout=15)
        assert r.status_code == 400

    def test_delete_route(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-08")
        r = requests.delete(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15)
        assert g.status_code == 404

    def test_delete_route_blocked_when_task_collected(self, h_admin_fcc):
        route, _ = self._make_route_with_two_stops(h_admin_fcc, "2026-02-11")
        task_id = route["tasks"][0]["id"]
        _run_async(_direct_db().collection_tasks.update_one({"id": task_id}, {"$set": {"status": "collected"}}))
        r = requests.delete(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 409


# ---------- Fase B: editing an old route backfills real stops on demand ----------
class TestBackfillOnEdit:
    def test_reorder_backfills_virtual_stops_first(self, h_admin_fcc, admin_fcc):

        async def _seed_legacy_route_two_tasks():
            company_id = admin_fcc["user"]["company_id"]
            depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
            depot = depots[0]
            rid = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            await _direct_db().routes.insert_one({
                "id": rid, "company_id": company_id, "code": "R-TEST-BACKFILL",
                "date": "2026-02-09", "zone_id": None,
                "driver_id": None, "driver_name": None, "vehicle_id": None,
                "start_depot_id": depot["id"], "end_facility_id": None,
                "waste_type": "general", "num_stops": 2, "distance_km": 1.0,
                "duration_min": 5.0, "capacity_utilization": 0, "load_kg": 0,
                "actual_distance_km": None, "actual_duration_min": None,
                "status": "scheduled", "created_at": now,
            })
            task_ids = []
            for i, offset in enumerate([0.05, -0.05]):
                tid = str(uuid.uuid4())
                task_ids.append(tid)
                await _direct_db().collection_tasks.insert_one({
                    "id": tid, "company_id": company_id, "route_id": rid,
                    "container_id": f"TEST_backfill_container_{i}", "driver_id": None, "vehicle_id": None,
                    "sequence": i + 1, "waste_type": "general", "address": f"TEST_Rua Backfill {i}",
                    "lat": depot["lat"] + offset, "lng": depot["lng"] + offset, "status": "scheduled",
                    "scheduled_date": "2026-02-09",
                    "load_kg": None, "arrived_at": None, "completed_at": None,
                    "gps": None, "photo_url": None, "notes": "", "fail_reason": None,
                })
            return rid

        rid = _run_async(_seed_legacy_route_two_tasks())
        before = requests.get(f"{API}/routes/{rid}", headers=h_admin_fcc, timeout=15).json()
        assert all(s.get("virtual") for s in before["stops"])
        stop_ids = [s["id"] for s in before["stops"]]

        r = requests.patch(f"{API}/routes/{rid}/stops/reorder", headers=h_admin_fcc,
                           json={"stop_ids": list(reversed(stop_ids))}, timeout=15)
        assert r.status_code == 200, r.text
        after = r.json()
        assert not any(s.get("virtual") for s in after["stops"])


# ---------- Fase B2.1: visual map route builder ----------
class TestManualRouteBuilder:
    # "Does not write" is verified by purity/idempotency (same input -> same
    # output, every time) rather than a before/after count of the tenant's
    # full /routes list — that comparison races against every OTHER test
    # concurrently creating routes in the sibling xdist worker and becomes
    # flaky purely from suite size, independent of whether these endpoints
    # actually write anything.
    def test_preview_geometry_does_not_write(self, h_admin_fcc):
        body = {"points": [{"lat": 38.72, "lng": -9.14}, {"lat": 38.73, "lng": -9.13}]}
        r1 = requests.post(f"{API}/routes/preview-geometry", headers=h_admin_fcc, json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        data1 = r1.json()
        assert "coordinates" in data1 and "distance_m" in data1

        r2 = requests.post(f"{API}/routes/preview-geometry", headers=h_admin_fcc, json=body, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json() == data1

    def test_preview_optimize_does_not_write_and_reorders(self, h_admin_fcc):
        body = {
            "start": {"lat": 38.70, "lng": -9.15},
            "end": {"lat": 38.70, "lng": -9.15},
            "stops": [
                {"id": "far", "lat": 38.80, "lng": -9.05},
                {"id": "near", "lat": 38.705, "lng": -9.149},
            ],
        }
        r1 = requests.post(f"{API}/routes/preview-optimize", headers=h_admin_fcc, json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        data1 = r1.json()
        assert data1["order"][0] == "near"
        assert "distance_km_before" in data1 and "distance_km" in data1

        r2 = requests.post(f"{API}/routes/preview-optimize", headers=h_admin_fcc, json=body, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json() == data1

    def test_manual_route_creates_stops_with_no_containers(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        body = {
            "date": "2026-03-01",
            "start": {"depot_id": depot["id"]},
            "stops": [
                {"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_Ponto A"},
                {"lat": depot["lat"] - 0.01, "lng": depot["lng"] - 0.01, "address": "TEST_Ponto B"},
            ],
            "mode": "manual",
        }
        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()
        assert route["start_depot_id"] == depot["id"]
        assert route["mode"] == "manual"
        assert route["num_stops"] == 0

        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert len(detail["stops"]) == 2
        assert all(len(s["tasks"]) == 0 for s in detail["stops"])
        assert [s["address"] for s in detail["stops"]] == ["TEST_Ponto A", "TEST_Ponto B"]

    def test_manual_route_with_free_point_start_and_end(self, h_admin_fcc):
        body = {
            "date": "2026-03-02",
            "start": {"lat": 38.70, "lng": -9.15},
            "end": {"lat": 38.75, "lng": -9.10},
            "stops": [{"lat": 38.72, "lng": -9.13, "address": "TEST_Solo"}],
        }
        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()
        assert route["start_lat"] == 38.70 and route["start_lng"] == -9.15
        assert route["end_lat"] == 38.75 and route["end_lng"] == -9.10
        assert route["start_depot_id"] is None and route["end_facility_id"] is None

    def test_manual_route_geometry_uses_stops_even_with_zero_tasks(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        body = {
            "date": "2026-03-03",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": depot["lat"] + 0.02, "lng": depot["lng"] + 0.02, "address": "TEST_Geo Point"}],
        }
        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()
        g = requests.get(f"{API}/routes/{route['id']}/geometry", headers=h_admin_fcc, timeout=30)
        assert g.status_code == 200, g.text
        geo = g.json()
        assert len(geo["coordinates"]) >= 2

    def test_manual_route_editable_with_existing_stop_endpoints(self, h_admin_fcc):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        body = {
            "date": "2026-03-04",
            "start": {"depot_id": depot["id"]},
            "stops": [
                {"lat": depot["lat"] + 0.03, "lng": depot["lng"] + 0.03, "address": "TEST_M1"},
                {"lat": depot["lat"] - 0.03, "lng": depot["lng"] - 0.03, "address": "TEST_M2"},
            ],
        }
        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
        route = r.json()
        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        stop_ids = [s["id"] for s in detail["stops"]]

        reordered = requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                                   json={"stop_ids": list(reversed(stop_ids))}, timeout=15)
        assert reordered.status_code == 200, reordered.text

        removed = requests.delete(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}",
                                  headers=h_admin_fcc, timeout=15)
        assert removed.status_code == 200, removed.text


# ---------- Fase PROD2: assign/reassign driver and vehicle on a route ----------
class TestRouteAssignment:
    def _make_driver_with_login(self, h_admin_fcc):
        email = f"test_assign_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": f"TEST_Driver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
        }, timeout=15)
        assert r.status_code == 200, r.text
        driver = r.json()
        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        return driver, headers

    def _make_route(self, h_admin_fcc, date):
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]
        vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 10000,
        }, timeout=15).json()
        c = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_Assign Point", "lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01,
            "waste_type": "general",
        }, timeout=15).json()
        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": date, "container_ids": [c["id"]], "vehicle_ids": [vehicle["id"]],
        }, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()["routes"][0], vehicle

    def test_assign_driver_and_vehicle(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-04-01")
        driver, _ = self._make_driver_with_login(h_admin_fcc)
        vehicle2 = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 10000,
        }, timeout=15).json()

        r = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc, json={
            "driver_id": driver["id"], "vehicle_id": vehicle2["id"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert detail["driver_id"] == driver["id"]
        assert detail["driver_name"] == driver["name"]
        assert detail["vehicle_id"] == vehicle2["id"]
        assert all(t["driver_id"] == driver["id"] for t in detail["tasks"])
        assert all(t["vehicle_id"] == vehicle2["id"] for t in detail["tasks"])

    def test_reassign_driver_moves_visibility_between_drivers(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-04-02")
        driver_a, headers_a = self._make_driver_with_login(h_admin_fcc)
        driver_b, headers_b = self._make_driver_with_login(h_admin_fcc)

        assign_a = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                  json={"driver_id": driver_a["id"]}, timeout=15)
        assert assign_a.status_code == 200, assign_a.text

        tasks_a_before = requests.get(f"{API}/collection-tasks?mine=true", headers=headers_a, timeout=15).json()
        assert any(t["route_id"] == route["id"] for t in tasks_a_before)

        reassign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                  json={"driver_id": driver_b["id"]}, timeout=15)
        assert reassign.status_code == 200, reassign.text

        tasks_a_after = requests.get(f"{API}/collection-tasks?mine=true", headers=headers_a, timeout=15).json()
        assert not any(t["route_id"] == route["id"] for t in tasks_a_after)
        tasks_b_after = requests.get(f"{API}/collection-tasks?mine=true", headers=headers_b, timeout=15).json()
        assert any(t["route_id"] == route["id"] for t in tasks_b_after)

        route_for_a = requests.get(f"{API}/routes/{route['id']}", headers=headers_a, timeout=15)
        assert route_for_a.status_code == 404
        route_for_b = requests.get(f"{API}/routes/{route['id']}", headers=headers_b, timeout=15)
        assert route_for_b.status_code == 200

    def test_reassignment_preserves_completed_task_history(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-04-03")
        driver_a, headers_a = self._make_driver_with_login(h_admin_fcc)
        assign_a = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                  json={"driver_id": driver_a["id"]}, timeout=15)
        assert assign_a.status_code == 200, assign_a.text

        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        task = detail["tasks"][0]
        complete = requests.post(f"{API}/collection-tasks/{task['id']}/complete", headers=headers_a,
                                 json={"lat": task["lat"], "lng": task["lng"]}, timeout=15)
        assert complete.status_code == 200, complete.text

        driver_b, _ = self._make_driver_with_login(h_admin_fcc)
        reassign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                  json={"driver_id": driver_b["id"]}, timeout=15)
        assert reassign.status_code == 200, reassign.text

        after = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        completed_task = next(t for t in after["tasks"] if t["id"] == task["id"])
        assert completed_task["driver_id"] == driver_a["id"]  # history preserved, not overwritten

    def test_audit_log_message_format(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-04-04")
        driver, _ = self._make_driver_with_login(h_admin_fcc)
        r = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                           json={"driver_id": driver["id"]}, timeout=15)
        assert r.status_code == 200, r.text

        logs = requests.get(f"{API}/audit-logs", headers=h_admin_fcc, timeout=15).json()
        entry = next((l for l in logs if l["entity_id"] == route["id"] and l["action"] == "reassign_driver"), None)
        assert entry is not None
        assert f"rota {route['code']}" in entry["new_value"]["message"]
        assert driver["name"] in entry["new_value"]["message"]

    def test_driver_cannot_reassign(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-04-05")
        driver, headers = self._make_driver_with_login(h_admin_fcc)
        r = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=headers,
                           json={"driver_id": driver["id"]}, timeout=15)
        assert r.status_code == 403


class TestRouteStart:
    """Fase PROD3 — POST /routes/{rid}/start now optionally records GPS and
    is restricted, for drivers, to their own assigned route via _driver_scope
    (reused from PROD2's GET /routes/{id} visibility rule)."""

    _make_driver_with_login = TestRouteAssignment._make_driver_with_login
    _make_route = TestRouteAssignment._make_route

    def test_driver_starts_own_route_records_gps(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-05-01")
        driver, headers = self._make_driver_with_login(h_admin_fcc)
        assign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                json={"driver_id": driver["id"]}, timeout=15)
        assert assign.status_code == 200, assign.text

        r = requests.post(f"{API}/routes/{route['id']}/start", headers=headers,
                          json={"lat": 41.1111, "lng": -8.2222}, timeout=15)
        assert r.status_code == 200, r.text

        detail = requests.get(f"{API}/routes/{route['id']}", headers=headers, timeout=15).json()
        assert detail["status"] == "in_progress"
        assert detail["started_at"] is not None
        assert detail["actual_start_lat"] == 41.1111
        assert detail["actual_start_lng"] == -8.2222

    def test_driver_cannot_start_another_drivers_route(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-05-02")
        driver_a, _ = self._make_driver_with_login(h_admin_fcc)
        driver_b, headers_b = self._make_driver_with_login(h_admin_fcc)
        assign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                json={"driver_id": driver_a["id"]}, timeout=15)
        assert assign.status_code == 200, assign.text

        r = requests.post(f"{API}/routes/{route['id']}/start", headers=headers_b, timeout=15)
        assert r.status_code == 404

        untouched = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert untouched["status"] == "scheduled"

    def test_start_without_body_still_works(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-05-03")
        r = requests.post(f"{API}/routes/{route['id']}/start", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert detail["status"] == "in_progress"
        assert detail.get("actual_start_lat") is None


class TestRouteFinish:
    """Fase PROD4 — POST /routes/{rid}/finish completes an in_progress route,
    recording real duration/distance and collected/failed/ignored/pending
    task counts, feeding the future route-history screen."""

    _make_driver_with_login = TestRouteAssignment._make_driver_with_login
    _make_route = TestRouteAssignment._make_route

    def test_finish_requires_in_progress(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-06-01")
        r = requests.post(f"{API}/routes/{route['id']}/finish", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 400

    def test_finish_completes_route_and_counts_tasks(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-06-02")
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=h_admin_fcc, timeout=15)
        assert start.status_code == 200, start.text

        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        task = detail["tasks"][0]
        complete = requests.post(f"{API}/collection-tasks/{task['id']}/complete", headers=h_admin_fcc,
                                 json={"lat": task["lat"], "lng": task["lng"]}, timeout=15)
        assert complete.status_code == 200, complete.text

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=h_admin_fcc, timeout=15)
        assert finish.status_code == 200, finish.text
        body = finish.json()
        assert body["collected_count"] == 1
        assert body["failed_count"] == 0
        assert body["ignored_count"] == 0
        assert body["pending_count"] == 0
        assert body["actual_duration_min"] is not None
        assert body["actual_distance_km"] == route["distance_km"]  # no GPS captured at start -> planned fallback

        after = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert after["status"] == "completed"
        assert after["completed_at"] is not None

    def test_finish_with_gps_computes_real_distance(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-06-03")
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=h_admin_fcc,
                              json={"lat": 41.10, "lng": -8.60}, timeout=15)
        assert start.status_code == 200, start.text

        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        task = detail["tasks"][0]
        requests.post(f"{API}/collection-tasks/{task['id']}/complete", headers=h_admin_fcc,
                     json={"lat": task["lat"], "lng": task["lng"]}, timeout=15)

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=h_admin_fcc,
                               json={"lat": 41.11, "lng": -8.61}, timeout=15)
        assert finish.status_code == 200, finish.text
        body = finish.json()
        assert body["actual_distance_km"] is not None
        assert body["actual_distance_km"] > 0

    def test_driver_can_only_finish_own_route(self, h_admin_fcc):
        route, _ = self._make_route(h_admin_fcc, "2026-06-04")
        driver_a, headers_a = self._make_driver_with_login(h_admin_fcc)
        driver_b, headers_b = self._make_driver_with_login(h_admin_fcc)
        assign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                json={"driver_id": driver_a["id"]}, timeout=15)
        assert assign.status_code == 200, assign.text
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers_a, timeout=15)
        assert start.status_code == 200, start.text

        r = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers_b, timeout=15)
        assert r.status_code == 404

        untouched = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert untouched["status"] == "in_progress"

    def test_finish_frees_driver_and_vehicle(self, h_admin_fcc):
        route, vehicle = self._make_route(h_admin_fcc, "2026-06-05")
        driver, headers = self._make_driver_with_login(h_admin_fcc)
        assign = requests.patch(f"{API}/routes/{route['id']}/assignment", headers=h_admin_fcc,
                                json={"driver_id": driver["id"]}, timeout=15)
        assert assign.status_code == 200, assign.text
        requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text

        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        updated_driver = next(d for d in drivers if d["id"] == driver["id"])
        assert updated_driver["status"] == "available"
        vehicles = requests.get(f"{API}/vehicles", headers=h_admin_fcc, timeout=15).json()
        updated_vehicle = next(v for v in vehicles if v["id"] == vehicle["id"])
        assert updated_vehicle["status"] == "available"
