"""Tests for assert_route_editable() (routers/routes.py) — the guard added
in FASE 0 that blocks structural changes (reorder/move/add/remove a stop, or
reoptimize()'s structural resequencing) once a route is no longer meant to
change shape.

Deliberately NOT covered here (unaffected by this guard, on purpose):
collection-task completion/fail/ignore, route start/finish, and tracking
sessions — see test_route_stops.py / test_wasteflow_api.py::TestDriverFlow
and test_tracking.py for those.
"""
import uuid

import requests
from conftest import API, PASSWORD


def _container(h_admin_fcc, lat, lng):
    r = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
        "address": "TEST_GuardContainer", "lat": lat, "lng": lng, "waste_type": "general",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _route_with_two_container_stops(h_admin_fcc, date):
    """A manual route with 2 real stops (each with one container/task) far
    enough apart to stay separate stops — real tasks are needed here (unlike
    test_route_stops.py's simpler empty-stop cases) because some of these
    tests need to mark a task collected and finish the route for real."""
    depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
    c1 = _container(h_admin_fcc, depot["lat"] + 0.02, depot["lng"] + 0.02)
    c2 = _container(h_admin_fcc, depot["lat"] - 0.02, depot["lng"] - 0.02)
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_GuardDriver_{uuid.uuid4().hex[:4]}",
        "email": f"test_guard_{uuid.uuid4().hex[:8]}@example.com", "password": "SenhaForte123",
    }, timeout=15).json()
    vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()
    body = {
        "date": date, "start": {"depot_id": depot["id"]},
        "stops": [
            {"lat": c1["lat"], "lng": c1["lng"], "address": "TEST_GuardStop1", "container_id": c1["id"]},
            {"lat": c2["lat"], "lng": c2["lng"], "address": "TEST_GuardStop2", "container_id": c2["id"]},
        ],
        "driver_id": driver["id"], "vehicle_id": vehicle["id"],
    }
    r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json=body, timeout=30)
    assert r.status_code == 200, r.text
    route = r.json()
    login = requests.post(f"{API}/auth/login",
                          json={"identifier": driver["email"], "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    return route, headers


def _stop_ids(h_admin_fcc, route_id):
    detail = requests.get(f"{API}/routes/{route_id}", headers=h_admin_fcc, timeout=15).json()
    return [s["id"] for s in detail["stops"]]


def _completed_route(h_admin_fcc, date):
    """Started, every task collected through the real API, then finished —
    a genuinely completed route, not just a status flipped directly in Mongo."""
    route, headers = _route_with_two_container_stops(h_admin_fcc, date)
    start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
    assert start.status_code == 200, start.text
    detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
    for t in detail["tasks"]:
        c = requests.post(f"{API}/collection-tasks/{t['id']}/complete", headers=headers,
                          json={"lat": t["lat"], "lng": t["lng"]}, timeout=15)
        assert c.status_code == 200, c.text
    finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
    assert finish.status_code == 200, finish.text
    return route


def _cancelled_route(h_admin_fcc, date):
    """A route with real history that gets archived (status -> cancelled)
    via DELETE + admin password — the same path TestRouteDeletion already
    exercises, reused here to reach the "cancelled" state for the guard."""
    route, headers = _route_with_two_container_stops(h_admin_fcc, date)
    start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
    assert start.status_code == 200, start.text
    detail = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
    task = detail["tasks"][0]
    c = requests.post(f"{API}/collection-tasks/{task['id']}/complete", headers=headers,
                      json={"lat": task["lat"], "lng": task["lng"]}, timeout=15)
    assert c.status_code == 200, c.text
    deleted = requests.delete(f"{API}/routes/{route['id']}", headers=h_admin_fcc,
                              json={"password": PASSWORD}, timeout=15)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["action"] == "archive"
    return route


class TestScheduledRouteStaysEditable:
    """Sanity check: the guard must not regress the everyday case — every
    stop-structure endpoint keeps working exactly as before on a route
    that's still just scheduled."""

    def test_reorder_add_remove_and_reoptimize_all_still_work(self, h_admin_fcc):
        route, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-01")
        stop_ids = _stop_ids(h_admin_fcc, route["id"])

        reordered = requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                                   json={"stop_ids": list(reversed(stop_ids))}, timeout=15)
        assert reordered.status_code == 200, reordered.text

        depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
        c3 = _container(h_admin_fcc, depot["lat"] + 0.04, depot["lng"] + 0.04)
        added = requests.post(f"{API}/routes/{route['id']}/stops", headers=h_admin_fcc,
                              json={"container_ids": [c3["id"]]}, timeout=15)
        assert added.status_code == 200, added.text

        stop_ids_now = _stop_ids(h_admin_fcc, route["id"])
        removed = requests.delete(f"{API}/routes/{route['id']}/stops/{stop_ids_now[-1]}",
                                  headers=h_admin_fcc, timeout=15)
        assert removed.status_code == 200, removed.text

        reopt = requests.post(f"{API}/routes/{route['id']}/reoptimize", headers=h_admin_fcc, timeout=30)
        assert reopt.status_code == 200, reopt.text

    def test_move_between_two_scheduled_routes_still_works(self, h_admin_fcc):
        route_a, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-02")
        route_b, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-02")
        stop_ids_a = _stop_ids(h_admin_fcc, route_a["id"])
        moved = requests.post(f"{API}/routes/{route_a['id']}/stops/{stop_ids_a[0]}/move",
                              headers=h_admin_fcc, json={"target_route_id": route_b["id"]}, timeout=15)
        assert moved.status_code == 200, moved.text


class TestCompletedRouteIsLocked:
    def test_reorder_blocked(self, h_admin_fcc):
        route = _completed_route(h_admin_fcc, "2026-05-03")
        stop_ids = _stop_ids(h_admin_fcc, route["id"])
        r = requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                           json={"stop_ids": list(reversed(stop_ids))}, timeout=15)
        assert r.status_code == 409

    def test_add_blocked(self, h_admin_fcc):
        route = _completed_route(h_admin_fcc, "2026-05-04")
        depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
        c = _container(h_admin_fcc, depot["lat"] + 0.05, depot["lng"] + 0.05)
        r = requests.post(f"{API}/routes/{route['id']}/stops", headers=h_admin_fcc,
                          json={"container_ids": [c["id"]]}, timeout=15)
        assert r.status_code == 409

    def test_remove_blocked(self, h_admin_fcc):
        route = _completed_route(h_admin_fcc, "2026-05-05")
        stop_ids = _stop_ids(h_admin_fcc, route["id"])
        r = requests.delete(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 409

    def test_move_blocked_as_source_and_as_target(self, h_admin_fcc):
        completed = _completed_route(h_admin_fcc, "2026-05-06")
        scheduled, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-06")
        stop_ids_completed = _stop_ids(h_admin_fcc, completed["id"])
        stop_ids_scheduled = _stop_ids(h_admin_fcc, scheduled["id"])

        as_source = requests.post(f"{API}/routes/{completed['id']}/stops/{stop_ids_completed[0]}/move",
                                  headers=h_admin_fcc, json={"target_route_id": scheduled["id"]}, timeout=15)
        assert as_source.status_code == 409

        as_target = requests.post(f"{API}/routes/{scheduled['id']}/stops/{stop_ids_scheduled[0]}/move",
                                  headers=h_admin_fcc, json={"target_route_id": completed["id"]}, timeout=15)
        assert as_target.status_code == 409

    def test_reoptimize_blocked(self, h_admin_fcc):
        route = _completed_route(h_admin_fcc, "2026-05-07")
        r = requests.post(f"{API}/routes/{route['id']}/reoptimize", headers=h_admin_fcc, timeout=30)
        assert r.status_code == 409


class TestCancelledRouteIsLocked:
    def test_reorder_move_add_remove_and_reoptimize_all_blocked(self, h_admin_fcc):
        route = _cancelled_route(h_admin_fcc, "2026-05-08")
        stop_ids = _stop_ids(h_admin_fcc, route["id"])
        other, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-08")

        assert requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                              json={"stop_ids": list(reversed(stop_ids))}, timeout=15).status_code == 409
        depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
        c = _container(h_admin_fcc, depot["lat"] + 0.06, depot["lng"] + 0.06)
        assert requests.post(f"{API}/routes/{route['id']}/stops", headers=h_admin_fcc,
                             json={"container_ids": [c["id"]]}, timeout=15).status_code == 409
        assert requests.delete(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}",
                               headers=h_admin_fcc, timeout=15).status_code == 409
        assert requests.post(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}/move", headers=h_admin_fcc,
                             json={"target_route_id": other["id"]}, timeout=15).status_code == 409
        assert requests.post(f"{API}/routes/{route['id']}/reoptimize",
                             headers=h_admin_fcc, timeout=30).status_code == 409


class TestInProgressRouteBlocksStructuralEditsButAllowsReoptimize:
    """in_progress is a deliberate middle ground (see assert_route_editable's
    docstring): reoptimize() was built specifically to be safe mid-route (it
    only ever resequences tasks still scheduled/en_route/arrived), so it
    stays allowed; a blind manual reorder/move/add/remove was not, so those
    are blocked by default while the route is actively being driven."""

    def test_reorder_add_remove_and_move_blocked_while_in_progress(self, h_admin_fcc):
        route, headers = _route_with_two_container_stops(h_admin_fcc, "2026-05-09")
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        stop_ids = _stop_ids(h_admin_fcc, route["id"])
        other, _ = _route_with_two_container_stops(h_admin_fcc, "2026-05-09")

        assert requests.patch(f"{API}/routes/{route['id']}/stops/reorder", headers=h_admin_fcc,
                              json={"stop_ids": list(reversed(stop_ids))}, timeout=15).status_code == 409
        depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
        c = _container(h_admin_fcc, depot["lat"] + 0.07, depot["lng"] + 0.07)
        assert requests.post(f"{API}/routes/{route['id']}/stops", headers=h_admin_fcc,
                             json={"container_ids": [c["id"]]}, timeout=15).status_code == 409
        assert requests.delete(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}",
                               headers=h_admin_fcc, timeout=15).status_code == 409
        assert requests.post(f"{API}/routes/{route['id']}/stops/{stop_ids[0]}/move", headers=h_admin_fcc,
                             json={"target_route_id": other["id"]}, timeout=15).status_code == 409

    def test_reoptimize_still_allowed_while_in_progress(self, h_admin_fcc):
        route, headers = _route_with_two_container_stops(h_admin_fcc, "2026-05-10")
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        r = requests.post(f"{API}/routes/{route['id']}/reoptimize", headers=h_admin_fcc, timeout=30)
        assert r.status_code == 200, r.text
