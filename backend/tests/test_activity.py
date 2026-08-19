"""Tests for real driver presence/activity (Fase ACTIVITY 1).

activity_status must come only from real signals — login, the heartbeat
endpoint, and real in_progress routes — never from employment_status and
never from the simulated GPS loop (server.py::_simulate_gps).
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import requests
from conftest import API
from motor.motor_asyncio import AsyncIOMotorClient

import core.db  # noqa: F401 — side effect: load_dotenv() populates os.environ

# Same pattern as test_route_stops.py — a dedicated motor client bound to its
# own explicitly-managed event loop, used only to backdate last_seen_at
# beyond the offline threshold (there's no API for that; waiting 180s in a
# real-time test would be absurd).
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
    _direct_db()
    return _loop.run_until_complete(coro)


def _unique_email(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"


def _make_driver_with_login(h_admin_fcc, login=True):
    email = _unique_email("test_activity")
    r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_ActivityDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15)
    assert r.status_code == 200, r.text
    driver = r.json()
    headers = None
    if login:
        login_r = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login_r.status_code == 200, login_r.text
        headers = {"Authorization": f"Bearer {login_r.json()['access_token']}"}
    return driver, headers


def _recent_iso(ts: str, within_seconds: int = 60) -> bool:
    parsed = datetime.fromisoformat(ts)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed).total_seconds() < within_seconds


class TestLoginRecordsActivity:
    def test_login_sets_last_login_and_last_seen(self, h_admin_fcc):
        driver, headers = _make_driver_with_login(h_admin_fcc)
        me = requests.get(f"{API}/auth/me", headers=headers, timeout=15).json()
        assert _recent_iso(me["last_login_at"])
        assert _recent_iso(me["last_seen_at"])

    def test_never_logged_in_driver_is_offline(self, h_admin_fcc):
        driver, _ = _make_driver_with_login(h_admin_fcc, login=False)
        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        assert row["activity_status"] == "offline"
        assert row["last_seen_at"] is None


class TestHeartbeat:
    def test_heartbeat_requires_driver_account(self, h_admin_fcc):
        r = requests.post(f"{API}/drivers/me/heartbeat", headers=h_admin_fcc, json={}, timeout=15)
        assert r.status_code == 403

    def test_heartbeat_updates_own_last_seen_shows_online(self, h_admin_fcc):
        driver, headers = _make_driver_with_login(h_admin_fcc)
        hb = requests.post(f"{API}/drivers/me/heartbeat", headers=headers, json={}, timeout=15)
        assert hb.status_code == 200, hb.text

        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        assert row["activity_status"] == "online"
        assert _recent_iso(row["last_seen_at"])
        assert row["current_route_code"] is None

    def test_driver_cannot_spoof_another_drivers_presence(self, h_admin_fcc):
        """The heartbeat body never accepts a driver_id — the driver is
        resolved server-side from the authenticated token."""
        driver_a, _ = _make_driver_with_login(h_admin_fcc, login=False)
        driver_b, headers_b = _make_driver_with_login(h_admin_fcc)

        hb = requests.post(f"{API}/drivers/me/heartbeat", headers=headers_b,
                           json={"driver_id": driver_a["id"]}, timeout=15)
        assert hb.status_code == 200, hb.text

        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row_a = next(d for d in drivers if d["id"] == driver_a["id"])
        row_b = next(d for d in drivers if d["id"] == driver_b["id"])
        assert row_a["activity_status"] == "offline"  # never logged in / never heartbeat
        assert row_b["activity_status"] == "online"   # only B's own presence moved


class TestOnRouteStatus:
    def test_driver_on_started_route_shows_on_route_with_code_and_plate(self, h_admin_fcc):
        driver, headers = _make_driver_with_login(h_admin_fcc)
        vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
        }, timeout=15).json()
        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        depot = depots[0]

        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-03-05",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_OnRoute"}],
            "driver_id": driver["id"],
            "vehicle_id": vehicle["id"],
        }, timeout=30).json()

        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text

        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        assert row["activity_status"] == "on_route"
        assert row["current_route_code"] == route["code"]
        assert row["current_vehicle_plate"] == vehicle["plate"]

        finish = requests.post(f"{API}/routes/{route['id']}/finish", headers=headers, timeout=15)
        assert finish.status_code == 200, finish.text
        drivers_after = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row_after = next(d for d in drivers_after if d["id"] == driver["id"])
        assert row_after["activity_status"] == "online"  # back to online, route no longer in_progress
        assert row_after["current_route_code"] is None


class TestDashboardActiveDriversKpi:
    def test_kpi_counts_real_activity_not_employment_status(self, h_admin_fcc):
        # This runs under pytest-xdist alongside other classes/files that
        # create+login drivers in the same shared QA company, so the
        # company-wide count is a moving target — asserting it stays frozen
        # (or moves by exactly +1) against an earlier "before" snapshot is
        # inherently flaky. Instead: check THIS driver's own state, which is
        # race-proof, plus that the dashboard KPI matches an independent
        # per-driver count fetched immediately alongside it.
        driver, headers = _make_driver_with_login(h_admin_fcc, login=False)
        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        # employment_status defaults to "ativo" but the driver never logged in —
        # must NOT be counted as active.
        assert row["activity_status"] == "offline"

        login_r = requests.post(f"{API}/auth/login", json={"identifier": driver["email"], "password": "SenhaForte123"}, timeout=15)
        assert login_r.status_code == 200, login_r.text
        drivers_after = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row_after = next(d for d in drivers_after if d["id"] == driver["id"])
        assert row_after["activity_status"] == "online"

        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        drivers_now = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        real_active_count = len([d for d in drivers_now if d["activity_status"] != "offline"])
        assert dash["kpis"]["active_drivers"] == real_active_count

    def test_drivers_on_route_kpi_excludes_online_only_drivers(self, h_admin_fcc):
        # A driver merely "online" (app open, no route) must NOT inflate the
        # "Motoristas em rota" KPI — that was exactly the bug reported: the
        # card is labelled "em rota" but used to read active_drivers, which
        # mixes online in too.
        driver, headers = _make_driver_with_login(h_admin_fcc)  # login -> online, no route
        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        assert row["activity_status"] == "online"

        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        drivers_now = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        real_on_route_count = len([d for d in drivers_now if d["activity_status"] == "on_route"])
        assert dash["kpis"]["drivers_on_route"] == real_on_route_count
        # This driver being merely online must not have moved the count.
        assert not any(d["id"] == driver["id"] for d in drivers_now if d["activity_status"] == "on_route")


class TestDashboardPresenceList:
    """active_drivers_list — the painel's MOTORISTAS section. Distinct from
    the active_drivers KPI count above: this list also carries OFFLINE
    drivers (as long as they've ever sent a heartbeat) and last_seen_at, and
    is never capped."""

    def test_last_seen_at_is_included(self, h_admin_fcc):
        driver, headers = _make_driver_with_login(h_admin_fcc)
        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in dash["active_drivers_list"] if d["id"] == driver["id"])
        assert row["activity_status"] == "online"
        assert _recent_iso(row["last_seen_at"])

    def test_never_active_driver_excluded_from_presence_list(self, h_admin_fcc):
        driver, _ = _make_driver_with_login(h_admin_fcc, login=False)
        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        assert not any(d["id"] == driver["id"] for d in dash["active_drivers_list"])

    def test_offline_driver_with_history_still_appears(self, h_admin_fcc):
        driver, headers = _make_driver_with_login(h_admin_fcc)  # login sets last_seen_at
        # Backdate last_seen_at past the 180s offline threshold — no API for
        # this, and waiting for real time to pass would be absurd in a test.
        stale = (datetime.now(timezone.utc) - timedelta(seconds=400)).isoformat()
        _run_async(_direct_db().users.update_one({"driver_id": driver["id"]}, {"$set": {"last_seen_at": stale}}))

        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        row = next(d for d in drivers if d["id"] == driver["id"])
        assert row["activity_status"] == "offline"

        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        presence_row = next((d for d in dash["active_drivers_list"] if d["id"] == driver["id"]), None)
        assert presence_row is not None, "an offline driver with heartbeat history must still be in the presence list"
        assert presence_row["activity_status"] == "offline"
        assert presence_row["last_seen_at"] == stale

    def test_presence_list_is_not_capped_at_five(self, h_admin_fcc):
        ids = [_make_driver_with_login(h_admin_fcc)[0]["id"] for _ in range(7)]
        dash = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=15).json()
        present_ids = {d["id"] for d in dash["active_drivers_list"]}
        assert set(ids).issubset(present_ids)
