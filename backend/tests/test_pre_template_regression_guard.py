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

import pytest
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
    exactly — on with start, off with finish. Uses the same race-proof
    "independently recomputed, checked alongside" pattern as
    test_activity.py's KPI tests (a before/after delta across the whole
    company would be flaky under parallel test execution)."""

    def test_on_route_count_moves_with_start_and_finish(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        route = _route_for_driver(h_admin_fcc, driver, vehicle, "2026-05-17")

        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        drivers_now = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        real_on_route = len([d for d in drivers_now if d["activity_status"] == "on_route"])
        assert dash["kpis"]["drivers_on_route"] == real_on_route
        row = next(d for d in drivers_now if d["id"] == driver["id"])
        assert row["activity_status"] == "on_route"

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text
        dash_after = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        drivers_after = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        real_on_route_after = len([d for d in drivers_after if d["activity_status"] == "on_route"])
        assert dash_after["kpis"]["drivers_on_route"] == real_on_route_after
        row_after = next(d for d in drivers_after if d["id"] == driver["id"])
        assert row_after["activity_status"] != "on_route"


class TestFutureRouteTemplateSnapshot:
    """route_templates now exists (Fase 1). The "editing a template never
    changes something already copied FROM it" half of the invariant is
    proven for the two copy paths that exist today —
    test_route_templates.py::TestDuplicate and ::TestSaveRouteAsTemplate
    (duplicate-from-template, template-from-route) — both edit the source
    after copying and assert the copy is untouched.

    What's still NOT provable yet: editing a template after an EXECUTION
    (routes) was created FROM it — there is no "create execution from
    template" endpoint yet (Fase 2). Left as an explicit, visible skip
    rather than silently omitted; the design rule is already encoded ahead
    of time in routers/route_templates.py::delete_template()'s docstring
    (routes.template_id is checked there even though nothing sets it yet)."""

    @pytest.mark.skip(reason="no 'create execution from template' endpoint yet — add in Fase 2")
    def test_editing_a_template_does_not_change_an_already_created_execution(self, h_admin_fcc):
        pass
