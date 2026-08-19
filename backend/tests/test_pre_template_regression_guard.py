"""Regression guard for the FASE 0 checkpoint — pins down the exact
contracts the (not-yet-built) route_templates/scheduling work must never
break, per the architecture audit's section 7: tracking-session geometry
resolution, the live GPS map's contract, and the dashboard's
in_progress-driven driver counts.

These deliberately overlap with existing coverage (test_tracking.py,
test_wasteflow_api.py::TestGPS, test_activity.py) — kept here anyway, in
their own file, so the "must not regress before Fase 1/2" surface is
explicit and easy to find in one place.
"""
import uuid

import requests
from conftest import API


def _driver_with_vehicle(h_admin_fcc):
    """Vehicle created with driver_id set up front — routes.py never
    back-fills vehicles.driver_id when a route assigns a driver+vehicle pair
    (only drivers.vehicle_id), so this is the only way GET /gps/live's
    driver_name actually resolves to something real."""
    email = f"test_regguard_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_RegDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000, "driver_id": driver["id"],
    }, timeout=15).json()
    return driver, vehicle, headers


def _route_for_driver(h_admin_fcc, driver, vehicle, date):
    depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
    body = {
        "date": date, "start": {"depot_id": depot["id"]},
        "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_RegStop"}],
        "driver_id": driver["id"], "vehicle_id": vehicle["id"],
    }
    r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestTrackingGeometrySurvivesRouteCompletion:
    """(A) tracking_sessions.route_id must keep resolving planned geometry
    (routers/tracking.py::get_session -> routers/routes.py::route_geometry)
    exactly the same after the route finishes. route_geometry() is
    deliberately NOT guarded by assert_route_editable() — only the 4
    stop-editing endpoints and reoptimize() are — this test pins that down."""

    def test_planned_geometry_still_resolves_after_route_is_completed(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        route = _route_for_driver(h_admin_fcc, driver, vehicle, "2026-05-15")

        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        assert session["route_id"] == route["id"]

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text

        detail = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        assert detail["planned"] is not None
        assert len(detail["planned"]["coordinates"]) >= 2
        assert detail["planned"]["distance_m"] > 0


class TestGpsLiveContract:
    """(B) GET /gps/live's shape must stay exactly as the admin live map
    (mapa.tsx) and the driver's own marker expect — unaffected by FASE 0,
    since assert_route_editable() never touches routers/gps.py."""

    def test_live_position_has_the_expected_fields(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        route = _route_for_driver(h_admin_fcc, driver, vehicle, "2026-05-16")
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        posted = requests.post(f"{API}/gps/location", headers=headers, json={
            "vehicle_id": vehicle["id"], "lat": 41.30, "lng": -8.30, "speed": 12, "heading": 90,
        }, timeout=15)
        assert posted.status_code == 200, posted.text

        live = requests.get(f"{API}/gps/live", headers=h_admin_fcc, timeout=15).json()
        row = next(p for p in live if p["vehicle_id"] == vehicle["id"])
        for key in ("id", "vehicle_id", "lat", "lng", "speed", "heading", "status",
                    "source", "timestamp", "plate", "vehicle_status", "driver_name"):
            assert key in row, f"missing field {key}"
        assert row["plate"] == vehicle["plate"]
        assert row["driver_name"] == driver["name"]
        assert row["source"] == "device"


class TestDashboardOnRouteCountFollowsRouteStatus:
    """(C) kpis.drivers_on_route must track routes.status == "in_progress"
    exactly — on with start, off with finish.

    Deliberately checks a SINGLE dashboard response's own
    active_drivers_list (which already carries every driver's
    activity_status alongside the kpi count) rather than comparing the kpi
    from one request against a driver count from a second, separate
    request: this test's own company is shared with every other test file
    running in parallel, and two sequential HTTP round-trips leave a real
    window for a concurrent test elsewhere to change the company-wide
    count — which is exactly what made this test genuinely flaky under
    -n 2 (confirmed: passes reliably in isolation, fails intermittently
    only under real concurrent load). Using one response's own internal
    consistency removes the race instead of just documenting it."""

    def test_on_route_count_moves_with_start_and_finish(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        route = _route_for_driver(h_admin_fcc, driver, vehicle, "2026-05-17")

        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        real_on_route = len([d for d in dash["active_drivers_list"] if d["activity_status"] == "on_route"])
        assert dash["kpis"]["drivers_on_route"] == real_on_route
        row = next(d for d in dash["active_drivers_list"] if d["id"] == driver["id"])
        assert row["activity_status"] == "on_route"

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text
        dash_after = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        real_on_route_after = len([d for d in dash_after["active_drivers_list"] if d["activity_status"] == "on_route"])
        assert dash_after["kpis"]["drivers_on_route"] == real_on_route_after
        row_after = next(d for d in dash_after["active_drivers_list"] if d["id"] == driver["id"])
        assert row_after["activity_status"] != "on_route"


class TestFutureRouteTemplateSnapshot:
    """THE most important invariant of the whole templates plan (Fase 1
    section 5 / Fase 2 section 2): once an execution is created from a
    template, editing that template must never change the execution —
    route_stops, collection_tasks, and geometry_cache must all stay frozen.

    Fase 1 already proved the narrower "duplicate/save-as-template never
    shares state with its source" half (test_route_templates.py::
    TestDuplicate, ::TestSaveRouteAsTemplate). Fase 2 adds the create-
    execution endpoint that makes THIS specific test possible — no longer
    skipped."""

    def test_editing_a_template_does_not_change_an_already_created_execution(self, h_admin_fcc):
        depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
        c1 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_SnapStop1", "lat": depot["lat"] + 0.02, "lng": depot["lng"] + 0.02, "waste_type": "paper",
        }, timeout=15).json()
        c2 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_SnapStop2", "lat": depot["lat"] - 0.02, "lng": depot["lng"] - 0.02, "waste_type": "glass",
        }, timeout=15).json()

        tpl = requests.post(f"{API}/route-templates", headers=h_admin_fcc, json={
            "name": "TEST_SnapshotTemplate", "start_depot_id": depot["id"],
            "stops": [
                {"lat": c1["lat"], "lng": c1["lng"], "address": "TEST_SnapStop1", "container_ids": [c1["id"]]},
                {"lat": c2["lat"], "lng": c2["lng"], "address": "TEST_SnapStop2", "container_ids": [c2["id"]]},
            ],
        }, timeout=30).json()

        created = requests.post(f"{API}/route-templates/{tpl['id']}/create-execution", headers=h_admin_fcc,
                                json={"date": "2026-07-01", "start_time": "06:30"}, timeout=30)
        assert created.status_code == 200, created.text
        route = created.json()["route"]
        assert route["template_id"] == tpl["id"]

        # Snapshot everything the execution owns, right after creation.
        exec_before = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        stops_before = exec_before["stops"]
        tasks_before = exec_before["tasks"]
        geometry_before = exec_before["geometry_cache"] if "geometry_cache" in exec_before else \
            requests.get(f"{API}/routes/{route['id']}/geometry", headers=h_admin_fcc, timeout=15).json()

        # Now edit the template in every way the editor allows: rename,
        # reposition/reassociate an existing stop, add a new stop, remove one.
        requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc,
                       json={"name": "TEST_RenamedAfterExecution", "description": "TEST_changed"}, timeout=15)
        tpl_stop_ids = [s["id"] for s in tpl["stops"]]
        requests.patch(f"{API}/route-templates/{tpl['id']}/stops/{tpl_stop_ids[0]}", headers=h_admin_fcc,
                       json={"lat": depot["lat"] + 0.09, "lng": depot["lng"] + 0.09, "address": "TEST_Moved"}, timeout=15)
        c3 = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_SnapStop3", "lat": depot["lat"] + 0.05, "lng": depot["lng"] + 0.05, "waste_type": "plastic",
        }, timeout=15).json()
        requests.post(f"{API}/route-templates/{tpl['id']}/stops", headers=h_admin_fcc,
                      json={"container_ids": [c3["id"]]}, timeout=30)
        requests.delete(f"{API}/route-templates/{tpl['id']}/stops/{tpl_stop_ids[1]}", headers=h_admin_fcc, timeout=15)

        template_after = requests.get(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc, timeout=15).json()
        assert template_after["name"] == "TEST_RenamedAfterExecution"
        assert len(template_after["stops"]) == 2  # moved stop 1 + new stop 3 (stop 2 removed) — template DID change

        # The execution — route_stops, collection_tasks, and geometry — must
        # be exactly as it was the moment it was created.
        exec_after = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert exec_after["stops"] == stops_before
        assert exec_after["tasks"] == tasks_before
        geometry_after = exec_after["geometry_cache"] if "geometry_cache" in exec_after else \
            requests.get(f"{API}/routes/{route['id']}/geometry", headers=h_admin_fcc, timeout=15).json()
        assert geometry_after == geometry_before

        # And even archiving/deleting the template afterward must not touch it.
        requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc, json={"active": False}, timeout=15)
        exec_final = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        assert exec_final["stops"] == stops_before
        assert exec_final["tasks"] == tasks_before
