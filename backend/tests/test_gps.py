"""Tests for real driver GPS reporting (POST /gps/location).

The vehicle a driver reports GPS for must always be resolved server-side
from their own in_progress route — a driver must never be able to report a
position for an arbitrary vehicle_id supplied in the request body.
"""
import uuid

import requests
from conftest import API


def _depot(h_admin_fcc):
    return requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]


def _driver_on_route(h_admin_fcc):
    email = f"test_gps_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_GpsDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}

    vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()
    depot = _depot(h_admin_fcc)
    route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
        "date": "2026-05-01",
        "start": {"depot_id": depot["id"]},
        "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_GpsStop"}],
        "driver_id": driver["id"], "vehicle_id": vehicle["id"],
    }, timeout=30).json()
    start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
    assert start.status_code == 200, start.text
    return driver, vehicle, route, headers


class TestGpsLocationSecurity:
    def test_driver_cannot_spoof_vehicle_id(self, h_admin_fcc):
        driver, vehicle, route, headers = _driver_on_route(h_admin_fcc)
        other_vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 5000,
        }, timeout=15).json()

        r = requests.post(f"{API}/gps/location", headers=headers, json={
            "vehicle_id": other_vehicle["id"], "lat": 41.30, "lng": -8.28,
        }, timeout=15)
        assert r.status_code == 200, r.text
        # The real vehicle from the driver's own route was used — never the
        # spoofed other_vehicle id from the request body.
        assert r.json()["vehicle_id"] == vehicle["id"]

        other_live = requests.get(f"{API}/gps/live", headers=h_admin_fcc, timeout=15).json()
        assert not any(p["vehicle_id"] == other_vehicle["id"] for p in other_live)

    def test_driver_without_in_progress_route_is_rejected(self, h_admin_fcc):
        email = f"test_gps_noroute_{uuid.uuid4().hex[:8]}@example.com"
        requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_GpsNoRoute", "email": email, "password": "SenhaForte123",
        }, timeout=15)
        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
        headers = {"Authorization": f"Bearer {login['access_token']}"}

        r = requests.post(f"{API}/gps/location", headers=headers, json={
            "vehicle_id": "does-not-matter", "lat": 41.30, "lng": -8.28,
        }, timeout=15)
        assert r.status_code == 400

    def test_posted_position_marked_as_real_device_source(self, h_admin_fcc):
        driver, vehicle, route, headers = _driver_on_route(h_admin_fcc)
        r = requests.post(f"{API}/gps/location", headers=headers, json={
            "vehicle_id": vehicle["id"], "lat": 41.31, "lng": -8.29, "speed": 22, "heading": 90,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["source"] == "device"

        live = requests.get(f"{API}/gps/live", headers=h_admin_fcc, timeout=15).json()
        row = next(p for p in live if p["vehicle_id"] == vehicle["id"])
        assert row["source"] == "device"
        assert row["lat"] == 41.31 and row["lng"] == -8.29
