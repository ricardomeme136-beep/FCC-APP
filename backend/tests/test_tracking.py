"""Tests for recorded driver trajectories (routers/tracking.py) —
tracking_sessions + POST /tracking-sessions/{id}/points.

Covers: only a driver can start/feed/finish/cancel their own recording,
idempotent batch inserts (a resent batch never double-counts distance or
point_count), and multi-tenant isolation of the new collection.
"""
import uuid

import requests
from conftest import API


def _driver_with_vehicle(h_admin_fcc):
    """A driver with a persistent vehicle_id assignment but NO in_progress
    route — the "motorista experiente grava uma volta que já conhece" case
    from the spec, independent of any managed route."""
    email = f"test_track_{uuid.uuid4().hex[:8]}@example.com"
    vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_TrackDriver_{uuid.uuid4().hex[:4]}", "email": email,
        "password": "SenhaForte123", "vehicle_id": vehicle["id"],
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    return driver, vehicle, headers


def _driver_without_vehicle(h_admin_fcc):
    email = f"test_track_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_TrackNoVehicle_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    return driver, headers


def _driver_on_route(h_admin_fcc):
    """A driver with an in_progress managed route — the tracking_session
    started here should pick up route_id automatically, enabling the
    planned-vs-real comparison."""
    email = f"test_track_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_TrackRouteDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()
    depot = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]
    route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
        "date": "2026-05-01",
        "start": {"depot_id": depot["id"]},
        "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_TrackRouteStop"}],
        "driver_id": driver["id"], "vehicle_id": vehicle["id"],
    }, timeout=30).json()
    start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
    assert start.status_code == 200, start.text
    return driver, vehicle, route, headers


class TestTrackingSessionLifecycle:
    def test_driver_without_vehicle_cannot_start(self, h_admin_fcc):
        driver, headers = _driver_without_vehicle(h_admin_fcc)
        r = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                          json={"lat": 41.30, "lng": -8.30}, timeout=15)
        assert r.status_code == 400

    def test_admin_cannot_start_a_recording(self, h_admin_fcc):
        r = requests.post(f"{API}/tracking-sessions/start", headers=h_admin_fcc,
                          json={"lat": 41.30, "lng": -8.30}, timeout=15)
        assert r.status_code == 403

    def test_start_uses_driver_vehicle_and_second_start_is_rejected(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        r = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                          json={"lat": 41.30, "lng": -8.30}, timeout=15)
        assert r.status_code == 200, r.text
        session = r.json()
        assert session["vehicle_id"] == vehicle["id"]
        assert session["driver_id"] == driver["id"]
        assert session["status"] == "recording"
        assert session["route_id"] is None

        again = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                              json={"lat": 41.30, "lng": -8.30}, timeout=15)
        assert again.status_code == 400

    def test_points_batch_is_idempotent_on_resend(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.300, "lng": -8.300}, timeout=15).json()
        sid = session["id"]
        batch = {"points": [
            {"point_uuid": str(uuid.uuid4()), "lat": 41.301, "lng": -8.300, "timestamp": "2026-05-01T10:00:00+00:00"},
            {"point_uuid": str(uuid.uuid4()), "lat": 41.302, "lng": -8.300, "timestamp": "2026-05-01T10:00:10+00:00"},
        ]}
        r1 = requests.post(f"{API}/tracking-sessions/{sid}/points", headers=headers, json=batch, timeout=15)
        assert r1.status_code == 200, r1.text
        assert r1.json()["inserted"] == 2
        first_distance = r1.json()["distance_km"]
        assert first_distance > 0

        # Resend the exact same batch (simulating a network retry after the
        # response was lost) — must not double-insert or double-count.
        r2 = requests.post(f"{API}/tracking-sessions/{sid}/points", headers=headers, json=batch, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["inserted"] == 0
        assert r2.json()["distance_km"] == first_distance
        assert r2.json()["point_count"] == 2

    def test_only_owning_driver_can_feed_their_session(self, h_admin_fcc):
        driver_a, vehicle_a, headers_a = _driver_with_vehicle(h_admin_fcc)
        _driver_b, _vehicle_b, headers_b = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers_a,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        r = requests.post(f"{API}/tracking-sessions/{session['id']}/points", headers=headers_b, json={
            "points": [{"point_uuid": str(uuid.uuid4()), "lat": 41.31, "lng": -8.31, "timestamp": "2026-05-01T10:00:00+00:00"}],
        }, timeout=15)
        assert r.status_code == 404

    def test_finish_sets_completed_and_blocks_further_points(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        finish = requests.post(f"{API}/tracking-sessions/{session['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text
        assert finish.json()["status"] == "completed"
        assert finish.json()["ended_at"] is not None

        r = requests.post(f"{API}/tracking-sessions/{session['id']}/points", headers=headers, json={
            "points": [{"point_uuid": str(uuid.uuid4()), "lat": 41.31, "lng": -8.31, "timestamp": "2026-05-01T10:00:00+00:00"}],
        }, timeout=15)
        assert r.status_code == 400

    def test_cancel_marks_cancelled_not_deleted(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        r = requests.post(f"{API}/tracking-sessions/{session['id']}/cancel", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"

        detail = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15)
        assert detail.status_code == 200
        assert detail.json()["status"] == "cancelled"

    def test_list_and_detail_are_enriched_and_scoped(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        requests.post(f"{API}/tracking-sessions/{session['id']}/points", headers=headers, json={
            "points": [{"point_uuid": str(uuid.uuid4()), "lat": 41.301, "lng": -8.301, "timestamp": "2026-05-01T10:00:00+00:00"}],
        }, timeout=15)

        admin_list = requests.get(f"{API}/tracking-sessions", headers=h_admin_fcc, timeout=15).json()
        row = next(s for s in admin_list if s["id"] == session["id"])
        assert row["driver_name"] == driver["name"]
        assert row["vehicle_plate"] == vehicle["plate"]

        # The driver only ever sees their own sessions.
        driver_list = requests.get(f"{API}/tracking-sessions", headers=headers, timeout=15).json()
        assert all(s["driver_id"] == driver["id"] for s in driver_list)

        detail = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        assert len(detail["points"]) == 1
        assert detail["points"][0]["lat"] == 41.301

    def test_session_not_visible_across_tenants(self, h_admin_fcc, h_admin_suma):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        r = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_suma, timeout=15)
        assert r.status_code == 404
        other_list = requests.get(f"{API}/tracking-sessions", headers=h_admin_suma, timeout=15).json()
        assert not any(s["id"] == session["id"] for s in other_list)


class TestPlannedVsReal:
    def test_session_started_on_a_route_carries_route_id_and_planned_geometry(self, h_admin_fcc):
        driver, vehicle, route, headers = _driver_on_route(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        assert session["route_id"] == route["id"]

        detail = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        assert detail["planned"] is not None
        assert len(detail["planned"]["coordinates"]) >= 2
        assert detail["planned"]["distance_m"] > 0

    def test_session_without_route_has_no_planned_geometry(self, h_admin_fcc):
        driver, vehicle, headers = _driver_with_vehicle(h_admin_fcc)
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        detail = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        assert detail["planned"] is None
