"""Tests for the persisted, deduplicated alerts system (Fase 1 — alertas).

Covers: aggregation/visibility threshold, auto-resolution on a successful
collection, manual resolution, reopening after resolution (same document,
history preserved), multi-tenant isolation, and the resilience contract —
a bug inside the alerts subsystem must never block a real recolha (fail/
complete) from being recorded.
"""
import asyncio
import os
import uuid

import requests
from conftest import API, PASSWORD
from motor.motor_asyncio import AsyncIOMotorClient

import core.db  # noqa: F401 — side effect: load_dotenv() populates os.environ

# A few tests need to corrupt an alert document directly (to prove the
# resilience contract) or read raw Mongo state — same dedicated-loop pattern
# already used by test_route_stops.py, for the same reason (avoids
# core.db's module-level client binding to the wrong event loop).
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


def _depot(h):
    return requests.get(f"{API}/depots", headers=h, timeout=15).json()[0]


def _container(h, lat, lng):
    r = requests.post(f"{API}/containers", headers=h, json={
        "address": "TEST_AlertContainer", "lat": lat, "lng": lng, "waste_type": "general",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _route_with_task(h, container_id, date):
    depot = _depot(h)
    vehicle = requests.post(f"{API}/vehicles", headers=h, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()
    r = requests.post(f"{API}/routes/optimize", headers=h, json={
        "date": date, "container_ids": [container_id], "vehicle_ids": [vehicle["id"]],
    }, timeout=30)
    assert r.status_code == 200, r.text
    route_id = r.json()["routes"][0]["id"]
    # optimize()'s own response has no "tasks" field (route metadata only)
    # — GET /routes/{id} is what assembles the full read model with tasks,
    # same as test_route_stops.py's equivalent helper does.
    detail = requests.get(f"{API}/routes/{route_id}", headers=h, timeout=15).json()
    task = next(t for t in detail["tasks"] if t["container_id"] == container_id)
    return detail, task


def _fail(h, task_id, reason="Contentor bloqueado"):
    r = requests.post(f"{API}/collection-tasks/{task_id}/fail", headers=h,
                      json={"reason": reason}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _complete(h, task_id):
    # No lat/lng on purpose — skips the geofence check entirely (see
    # complete_task(): it only runs when both are provided).
    r = requests.post(f"{API}/collection-tasks/{task_id}/complete", headers=h, json={}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_alert(h, container_id, status="all"):
    alerts = requests.get(f"{API}/alerts?status={status}", headers=h, timeout=15).json()
    matches = [a for a in alerts if a["container_id"] == container_id]
    assert len(matches) <= 1, "must never be more than one alert document per container"
    return matches[0] if matches else None


def _dashboard_alert_ids(h):
    d = requests.get(f"{API}/analytics/dashboard", headers=h, timeout=20).json()
    return {a.get("container_id") for a in d["alerts"] if a["type"] == "repeated_failure"}


class TestAggregationAndVisibility:
    def test_single_failure_creates_hidden_alert(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.01, depot["lng"] + 0.01)
        _, task = _route_with_task(h_admin_fcc, c["id"], "2026-03-01")

        _fail(h_admin_fcc, task["id"])

        alert = _get_alert(h_admin_fcc, c["id"])
        assert alert is not None
        assert alert["status"] == "open"
        assert alert["occurrence_count"] == 1
        assert alert["lifetime_occurrence_count"] == 1
        # Below the visibility threshold — not shown on the dashboard yet.
        assert c["id"] not in _dashboard_alert_ids(h_admin_fcc)

    def test_second_failure_becomes_visible_same_document(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.02, depot["lng"] + 0.01)
        _, task1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-02")
        _fail(h_admin_fcc, task1["id"])
        first = _get_alert(h_admin_fcc, c["id"])

        # A 2nd task for the same container (a fresh scheduled occurrence —
        # the first task is already terminal and can't be failed twice).
        _, task2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-03")
        _fail(h_admin_fcc, task2["id"])

        second = _get_alert(h_admin_fcc, c["id"])
        assert second["id"] == first["id"], "must reuse the same document, never create a second one"
        assert second["occurrence_count"] == 2
        assert second["lifetime_occurrence_count"] == 2
        assert "2" in second["message"]
        assert c["id"] in _dashboard_alert_ids(h_admin_fcc)

    def test_third_failure_updates_same_document_no_duplicates(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.03, depot["lng"] + 0.01)
        for i, d in enumerate(["2026-03-04", "2026-03-05", "2026-03-06"]):
            _, task = _route_with_task(h_admin_fcc, c["id"], d)
            _fail(h_admin_fcc, task["id"])

        all_alerts = requests.get(f"{API}/alerts?status=all", headers=h_admin_fcc, timeout=15).json()
        matches = [a for a in all_alerts if a["container_id"] == c["id"]]
        assert len(matches) == 1, "3 failures must still be exactly one document"
        assert matches[0]["occurrence_count"] == 3
        assert matches[0]["lifetime_occurrence_count"] == 3


class TestAutoResolve:
    def test_successful_collection_resolves_active_alert(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.04, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-07")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-08")
        _fail(h_admin_fcc, t2["id"])
        assert c["id"] in _dashboard_alert_ids(h_admin_fcc)

        _, t3 = _route_with_task(h_admin_fcc, c["id"], "2026-03-09")
        _complete(h_admin_fcc, t3["id"])

        alert = _get_alert(h_admin_fcc, c["id"])
        assert alert["status"] == "resolved"
        assert alert["resolved_by"] == "auto"
        assert alert["resolution_history"][-1]["resolution_type"] == "auto"
        assert alert["resolution_history"][-1]["occurrence_count_at_resolution"] == 2
        assert c["id"] not in _dashboard_alert_ids(h_admin_fcc)

    def test_completing_container_with_no_alert_is_a_no_op(self, h_admin_fcc):
        """A container that never failed has no alert document at all —
        completing its task must not create one out of thin air."""
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.05, depot["lng"] + 0.01)
        _, t = _route_with_task(h_admin_fcc, c["id"], "2026-03-10")
        _complete(h_admin_fcc, t["id"])
        assert _get_alert(h_admin_fcc, c["id"]) is None


class TestManualResolve:
    def _active_alert(self, h_admin_fcc, seed):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + seed, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-11")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-12")
        _fail(h_admin_fcc, t2["id"])
        return c, _get_alert(h_admin_fcc, c["id"])

    def test_manual_resolve_requires_management_role(self, h_admin_fcc, h_driver):
        _, alert = self._active_alert(h_admin_fcc, 0.11)
        r = requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_driver, timeout=15)
        assert r.status_code == 403

    def test_manual_resolve_sets_status_and_history(self, h_admin_fcc):
        _, alert = self._active_alert(h_admin_fcc, 0.12)
        me = requests.get(f"{API}/auth/me", headers=h_admin_fcc, timeout=10).json()

        r = requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_admin_fcc,
                          json={"resolution_note": "Contentor substituído"}, timeout=15)
        assert r.status_code == 200, r.text
        resolved = r.json()
        assert resolved["status"] == "resolved"
        assert resolved["resolved_by"] == me["id"]
        assert resolved["resolution_history"][-1]["resolution_type"] == "manual"
        assert resolved["resolution_history"][-1]["resolution_note"] == "Contentor substituído"
        assert resolved["resolution_history"][-1]["occurrence_count_at_resolution"] == 2

    def test_manual_resolve_idempotent(self, h_admin_fcc):
        _, alert = self._active_alert(h_admin_fcc, 0.13)
        r1 = requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_admin_fcc, timeout=15)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_admin_fcc, timeout=15)
        assert r2.status_code == 200
        assert len(r2.json()["resolution_history"]) == 1, "a 2nd resolve must not append a 2nd entry"


class TestReopenPreservesHistory:
    def test_reopen_after_auto_resolution_reuses_document_and_resets_streak(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.21, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-13")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-14")
        _fail(h_admin_fcc, t2["id"])
        _, t3 = _route_with_task(h_admin_fcc, c["id"], "2026-03-15")
        _complete(h_admin_fcc, t3["id"])
        resolved = _get_alert(h_admin_fcc, c["id"])
        assert resolved["status"] == "resolved"

        # A fresh streak starts — same container, new tasks, new failures.
        _, t4 = _route_with_task(h_admin_fcc, c["id"], "2026-03-16")
        _fail(h_admin_fcc, t4["id"])
        reopened_once = _get_alert(h_admin_fcc, c["id"])
        assert reopened_once["id"] == resolved["id"], "reopening must reuse the same document"
        assert reopened_once["status"] == "open"
        assert reopened_once["occurrence_count"] == 1, "current streak resets"
        assert reopened_once["lifetime_occurrence_count"] == 3, "lifetime total keeps accumulating"
        assert reopened_once["resolved_at"] is None
        assert reopened_once["resolved_by"] is None
        assert len(reopened_once["resolution_history"]) == 1, "old resolution entry is preserved, not erased"

        _, t5 = _route_with_task(h_admin_fcc, c["id"], "2026-03-17")
        _fail(h_admin_fcc, t5["id"])
        reopened_twice = _get_alert(h_admin_fcc, c["id"])
        assert reopened_twice["occurrence_count"] == 2
        assert reopened_twice["lifetime_occurrence_count"] == 4
        assert c["id"] in _dashboard_alert_ids(h_admin_fcc)

    def test_reopen_after_manual_resolution_reuses_document(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.22, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-18")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-19")
        _fail(h_admin_fcc, t2["id"])
        alert = _get_alert(h_admin_fcc, c["id"])
        requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_admin_fcc, timeout=15)

        _, t3 = _route_with_task(h_admin_fcc, c["id"], "2026-03-20")
        _fail(h_admin_fcc, t3["id"])
        reopened = _get_alert(h_admin_fcc, c["id"])
        assert reopened["id"] == alert["id"]
        assert reopened["status"] == "open"
        assert reopened["occurrence_count"] == 1
        assert reopened["lifetime_occurrence_count"] == 3
        assert len(reopened["resolution_history"]) == 1
        assert reopened["resolution_history"][0]["resolution_type"] == "manual"


class TestTenantIsolationAndSecurity:
    def test_alerts_isolated_across_tenants(self, h_admin_fcc, h_admin_suma):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.31, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-21")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-22")
        _fail(h_admin_fcc, t2["id"])

        assert _get_alert(h_admin_fcc, c["id"]) is not None
        suma_alerts = requests.get(f"{API}/alerts?status=all", headers=h_admin_suma, timeout=15).json()
        assert all(a["container_id"] != c["id"] for a in suma_alerts)

    def test_resolve_cross_tenant_returns_404(self, h_admin_fcc, h_admin_suma):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.32, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-23")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-24")
        _fail(h_admin_fcc, t2["id"])
        alert = _get_alert(h_admin_fcc, c["id"])

        r = requests.post(f"{API}/alerts/{alert['id']}/resolve", headers=h_admin_suma, timeout=15)
        assert r.status_code == 404

    def test_no_public_create_endpoint(self, h_admin_fcc):
        r = requests.post(f"{API}/alerts", headers=h_admin_fcc, json={"message": "fabricated"}, timeout=15)
        assert r.status_code in (404, 405)


class TestResilience:
    """The alerts subsystem must be able to fail without ever blocking a
    real recolha (fail/complete) from being recorded — see the try/except
    around _upsert_repeated_failure_alert()/_auto_resolve_repeated_failure_
    alert() in routers/tasks.py. Proven end-to-end through the public API:
    corrupt the alert document's shape directly in Mongo (bypassing the
    app, which would never write it this way itself), then confirm the
    real task status change still succeeds."""

    def test_failure_recording_survives_alert_subsystem_crash(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.41, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-25")
        _fail(h_admin_fcc, t1["id"])  # creates the alert doc normally

        # Corrupt occurrence_count so `existing["occurrence_count"] + 1`
        # inside _upsert_repeated_failure_alert() raises a TypeError. Left
        # scoped to this test's own unique container_id — harmless to other
        # tests — but cleaned up anyway for hygiene, same as the sibling
        # resilience test below.
        alert_filter = {"company_id": t1["company_id"], "type": "repeated_failure", "container_id": c["id"]}
        try:
            _run_async(_direct_db().alerts.update_one(alert_filter, {"$set": {"occurrence_count": "not-a-number"}}))

            _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-26")
            r = requests.post(f"{API}/collection-tasks/{t2['id']}/fail", headers=h_admin_fcc,
                              json={"reason": "Contentor bloqueado"}, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "failed", "the recolha itself must still be recorded"
        finally:
            _run_async(_direct_db().alerts.delete_one(alert_filter))

    def test_completion_recording_survives_alert_subsystem_crash(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.42, depot["lng"] + 0.01)
        _, t1 = _route_with_task(h_admin_fcc, c["id"], "2026-03-27")
        _fail(h_admin_fcc, t1["id"])
        _, t2 = _route_with_task(h_admin_fcc, c["id"], "2026-03-28")
        _fail(h_admin_fcc, t2["id"])  # occurrence_count == 2, status == "open"

        # Remove the "id" field so _auto_resolve_repeated_failure_alert()'s
        # alert["id"] lookup raises a KeyError. h_admin_fcc's company is
        # shared fixture data used by the whole suite, so this corrupted,
        # still-"open" document is deleted again in the finally block below
        # — it must never leak into another test's /analytics/dashboard call.
        alert_filter = {"company_id": t1["company_id"], "type": "repeated_failure", "container_id": c["id"]}
        try:
            _run_async(_direct_db().alerts.update_one(alert_filter, {"$unset": {"id": ""}}))

            _, t3 = _route_with_task(h_admin_fcc, c["id"], "2026-03-29")
            r = requests.post(f"{API}/collection-tasks/{t3['id']}/complete", headers=h_admin_fcc, json={}, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "collected", "the recolha itself must still be recorded"
        finally:
            _run_async(_direct_db().alerts.delete_one(alert_filter))
