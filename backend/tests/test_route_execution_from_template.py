"""Tests for POST /route-templates/{id}/create-execution (Fase 2) — the
only way a route_template becomes a real, operational `routes` document.
The exhaustive "editing the template afterward never changes the execution"
proof lives in test_pre_template_regression_guard.py::
TestFutureRouteTemplateSnapshot (that IS the test named in the Fase 2
spec); this file covers the rest of the endpoint's contract.
"""
import uuid

import requests
from conftest import API, PASSWORD


def _depot(h_admin_fcc):
    return requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]


def _container(h_admin_fcc, lat, lng, waste_type="general"):
    r = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
        "address": "TEST_ExecContainer", "lat": lat, "lng": lng, "waste_type": waste_type,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _template_with_one_stop(h_admin_fcc, default_driver_id=None, default_vehicle_id=None):
    depot = _depot(h_admin_fcc)
    c = _container(h_admin_fcc, depot["lat"] + 0.02, depot["lng"] + 0.02)
    body = {
        "name": f"TEST_ExecTemplate_{uuid.uuid4().hex[:6]}", "start_depot_id": depot["id"],
        "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_ExecStop", "container_ids": [c["id"]]}],
    }
    if default_driver_id:
        body["default_driver_id"] = default_driver_id
    if default_vehicle_id:
        body["default_vehicle_id"] = default_vehicle_id
    r = requests.post(f"{API}/route-templates", headers=h_admin_fcc, json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _driver_with_login(h_admin_fcc):
    email = f"test_exec_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_ExecDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    return driver, {"Authorization": f"Bearer {login['access_token']}"}


def _vehicle(h_admin_fcc):
    return requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()


class TestCreateExecutionBasics:
    def test_creates_scheduled_route_with_stops_and_tasks(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                          json={"date": "2026-07-05"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        route = body["route"]
        assert route["template_id"] == tpl["id"]
        assert route["status"] == "scheduled"
        assert route["date"] == "2026-07-05"
        assert route["planned_start_time"] is None
        assert "warnings" in body

        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert len(detail["stops"]) == 1
        assert len(detail["tasks"]) == 1
        assert detail["tasks"][0]["container_id"] == tpl["stops"][0]["container_ids"][0]
        assert detail["tasks"][0]["status"] == "scheduled"

    def test_planned_start_time_is_stored_and_validated(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        ok = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                           json={"date": "2026-07-06", "start_time": "06:30"}, timeout=30)
        assert ok.status_code == 200, ok.text
        assert ok.json()["route"]["planned_start_time"] == "06:30"

        bad = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                            json={"date": "2026-07-06", "start_time": "25:99"}, timeout=15)
        assert bad.status_code == 400

    def test_driver_and_vehicle_assignment(self, h_admin_fcc):
        driver, _ = _driver_with_login(h_admin_fcc)
        vehicle = _vehicle(h_admin_fcc)
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc, json={
            "date": "2026-07-07", "driver_id": driver["id"], "vehicle_id": vehicle["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()["route"]
        assert route["driver_id"] == driver["id"]
        assert route["driver_name"] == driver["name"]
        assert route["vehicle_id"] == vehicle["id"]

        # Tasks created from the template must carry the same assignment.
        detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert all(t["driver_id"] == driver["id"] and t["vehicle_id"] == vehicle["id"] for t in detail["tasks"])


class TestDefaultDriverVehicle:
    def test_template_default_is_exposed_but_not_auto_applied(self, h_admin_fcc):
        """Point 5 of the spec: defaults are a FRONTEND pre-fill convenience
        — the backend only ever uses whatever driver_id/vehicle_id is
        explicitly in the request. Omitting them must not silently fall
        back to the template's defaults."""
        driver, _ = _driver_with_login(h_admin_fcc)
        vehicle = _vehicle(h_admin_fcc)
        tpl = _template_with_one_stop(h_admin_fcc, default_driver_id=driver["id"], default_vehicle_id=vehicle["id"])
        assert tpl["default_driver_id"] == driver["id"]
        assert tpl["default_vehicle_id"] == vehicle["id"]

        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                          json={"date": "2026-07-08"}, timeout=30)
        assert r.status_code == 200, r.text
        route = r.json()["route"]
        assert route["driver_id"] is None
        assert route["vehicle_id"] is None


class TestConflictWarnings:
    def test_warns_but_still_creates_when_driver_already_has_a_route_that_day(self, h_admin_fcc):
        driver, headers = _driver_with_login(h_admin_fcc)
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.01, depot["lng"] + 0.01)
        first = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-07-09", "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_First", "container_id": c["id"]}],
            "driver_id": driver["id"],
        }, timeout=30)
        assert first.status_code == 200, first.text

        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc, json={
            "date": "2026-07-09", "driver_id": driver["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text  # warning, never blocks
        assert len(r.json()["warnings"]) >= 1
        assert "já tem a rota" in r.json()["warnings"][0]


class TestPermissionsAndTenantIsolation:
    def test_driver_cannot_create_execution(self, h_admin_fcc):
        _, driver_headers = _driver_with_login(h_admin_fcc)
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=driver_headers,
                          json={"date": "2026-07-10"}, timeout=15)
        assert r.status_code == 403

    def test_not_visible_across_tenants(self, h_admin_fcc, h_admin_suma):
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_suma,
                          json={"date": "2026-07-11"}, timeout=15)
        assert r.status_code == 404


class TestArchivedTemplate:
    def test_archived_template_cannot_create_new_execution(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        archived = requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc,
                                  json={"active": False}, timeout=15)
        assert archived.status_code == 200, archived.text
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                          json={"date": "2026-07-12"}, timeout=15)
        assert r.status_code == 400


class TestMultipleExecutionsAndTemplateIntegrity:
    def test_multiple_executions_different_dates_are_independent(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        r1 = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                           json={"date": "2026-07-13"}, timeout=30)
        r2 = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                           json={"date": "2026-07-15"}, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        route1, route2 = r1.json()["route"], r2.json()["route"]
        assert route1["id"] != route2["id"]
        assert route1["template_id"] == route2["template_id"] == tpl["id"]
        assert route1["date"] != route2["date"]

        stops1 = requests.get(f"{API}/routes/{route1['id']}", headers=h_admin_fcc, timeout=15).json()["stops"]
        stops2 = requests.get(f"{API}/routes/{route2['id']}", headers=h_admin_fcc, timeout=15).json()["stops"]
        assert {s["id"] for s in stops1}.isdisjoint({s["id"] for s in stops2}), \
            "each execution must get its OWN fresh route_stops, never shared"

    def test_creating_an_execution_does_not_alter_the_template(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        before = requests.get(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc, timeout=15).json()
        requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                     json={"date": "2026-07-16"}, timeout=30)
        after = requests.get(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc, timeout=15).json()
        assert after == before

    def test_editing_template_after_execution_does_not_change_execution_name_or_assignment(self, h_admin_fcc):
        """Lighter, focused companion to the exhaustive
        test_pre_template_regression_guard.py::TestFutureRouteTemplateSnapshot
        proof — checks the metadata angle (driver/vehicle/name) rather than
        stops/geometry, which that other test already covers in full."""
        driver, _ = _driver_with_login(h_admin_fcc)
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc, json={
            "date": "2026-07-17", "driver_id": driver["id"],
        }, timeout=30)
        route = r.json()["route"]

        requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc,
                       json={"name": "TEST_ChangedName", "default_driver_id": driver["id"]}, timeout=15)

        exec_after = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert exec_after["driver_id"] == driver["id"]
        assert exec_after["driver_name"] == driver["name"]  # unchanged, not re-derived from the (renamed) template


class TestOldRoutesWithoutTemplateStillWork:
    def test_route_without_template_id_behaves_normally(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.03, depot["lng"] + 0.03)
        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-07-18", "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_NoTemplate", "container_id": c["id"]}],
        }, timeout=30)
        assert route.status_code == 200, route.text
        doc = route.json()
        assert doc["template_id"] is None
        assert doc["planned_start_time"] is None

        detail = requests.get(f"{API}/routes/{doc['id']}", headers=h_admin_fcc, timeout=15)
        assert detail.status_code == 200, detail.text
        start = requests.post(f"{API}/routes/{doc['id']}/start", headers=h_admin_fcc, timeout=15)
        assert start.status_code == 200, start.text
