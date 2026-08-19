"""WasteFlow — end-to-end API tests covering all critical review flows."""
import os
import time
import requests
import pytest
from conftest import (API, PASSWORD, ADMIN_EMAIL, ADMIN_B_EMAIL, DISPATCHER_EMAIL,
                      DRIVER_EMAIL, MANAGER_EMAIL, CUSTOMER_EMAIL)


# ---------- Auth ----------
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "healthy"

    def test_login_all_roles(self):
        for email in [
            ADMIN_EMAIL, DISPATCHER_EMAIL,
            DRIVER_EMAIL, CUSTOMER_EMAIL,
            MANAGER_EMAIL, ADMIN_B_EMAIL,
        ]:
            r = requests.post(f"{API}/auth/login",
                              json={"identifier": email, "password": PASSWORD}, timeout=15)
            assert r.status_code == 200, f"{email} -> {r.status_code} {r.text}"
            data = r.json()
            assert data.get("access_token")
            assert data["user"]["email"] == email

    def test_login_invalid_password(self):
        r = requests.post(f"{API}/auth/login",
                          json={"identifier": ADMIN_EMAIL, "password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_me(self, h_admin_fcc):
        r = requests.get(f"{API}/auth/me", headers=h_admin_fcc, timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "company_admin"


# ---------- Multi-tenant isolation ----------
class TestTenantIsolation:
    def test_vehicles_isolated(self, h_admin_fcc, h_admin_suma):
        fcc = requests.get(f"{API}/vehicles", headers=h_admin_fcc, timeout=15).json()
        suma = requests.get(f"{API}/vehicles", headers=h_admin_suma, timeout=15).json()
        fcc_ids = {v["id"] for v in fcc}
        suma_ids = {v["id"] for v in suma}
        assert fcc_ids and suma_ids, "Both companies must have vehicles"
        assert fcc_ids.isdisjoint(suma_ids), "Vehicles must not overlap across tenants"

    def test_containers_isolated(self, h_admin_fcc, h_admin_suma):
        fcc = requests.get(f"{API}/containers", headers=h_admin_fcc, timeout=15).json()
        suma = requests.get(f"{API}/containers", headers=h_admin_suma, timeout=15).json()
        assert {c["id"] for c in fcc}.isdisjoint({c["id"] for c in suma})

    def test_routes_isolated(self, h_admin_fcc, h_admin_suma):
        fcc = requests.get(f"{API}/routes", headers=h_admin_fcc, timeout=15).json()
        suma = requests.get(f"{API}/routes", headers=h_admin_suma, timeout=15).json()
        assert {r["id"] for r in fcc}.isdisjoint({r["id"] for r in suma})


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_kpis(self, h_admin_fcc):
        r = requests.get(f"{API}/analytics/dashboard", headers=h_admin_fcc, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("active_trucks", "collections_today", "completed",
                  "failed", "overdue", "active_incidents"):
            assert k in d["kpis"], f"missing kpi {k}"
        assert "alerts" in d and "recent_incidents" in d


# ---------- GPS live ----------
class TestGPS:
    def test_gps_live_moves(self, h_admin_fcc):
        r1 = requests.get(f"{API}/gps/live", headers=h_admin_fcc, timeout=15)
        assert r1.status_code == 200
        pos1 = r1.json()
        assert isinstance(pos1, list) and len(pos1) > 0, "no live positions"
        # snapshot latest timestamps
        snap1 = {p["vehicle_id"]: p["timestamp"] for p in pos1}
        time.sleep(7)  # simulation loop is 5s
        pos2 = requests.get(f"{API}/gps/live", headers=h_admin_fcc, timeout=15).json()
        snap2 = {p["vehicle_id"]: p["timestamp"] for p in pos2}
        moved = any(snap2.get(v) != snap1.get(v) for v in snap1)
        assert moved, "GPS positions did not change (simulation loop stalled?)"


# ---------- Reverse geocoding ----------
class TestGeocode:
    def test_reverse_requires_auth(self):
        r = requests.get(f"{API}/geocode/reverse?lat=41.28&lng=-8.28", timeout=10)
        assert r.status_code in (401, 403)

    def test_reverse_returns_address_shape(self, h_admin_fcc):
        # Real network call to Nominatim — tolerant of it being unreachable
        # (never a hard failure of this endpoint's own contract), but the
        # shape and auth must always hold.
        r = requests.get(f"{API}/geocode/reverse?lat=38.7169&lng=-9.1399",
                         headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        assert "address" in r.json()


# ---------- Containers ----------
class TestContainers:
    def test_list_and_filter(self, h_admin_fcc):
        r = requests.get(f"{API}/containers", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200
        assert len(r.json()) > 0
        f = requests.get(f"{API}/containers?waste_type=paper",
                         headers=h_admin_fcc, timeout=15).json()
        assert all(c["waste_type"] == "paper" for c in f)

    def test_detail_history(self, h_admin_fcc):
        cs = requests.get(f"{API}/containers", headers=h_admin_fcc, timeout=15).json()
        cid = cs[0]["id"]
        r = requests.get(f"{API}/containers/{cid}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200
        assert "history" in r.json()


# ---------- Routes ----------
class TestRoutes:
    def test_list_and_detail(self, h_admin_fcc):
        rs = requests.get(f"{API}/routes", headers=h_admin_fcc, timeout=15).json()
        assert len(rs) > 0
        rid = rs[0]["id"]
        d = requests.get(f"{API}/routes/{rid}", headers=h_admin_fcc, timeout=15).json()
        assert "tasks" in d
        seqs = [t["sequence"] for t in d["tasks"]]
        assert seqs == sorted(seqs), "tasks must be ordered by sequence"

    def test_optimize_creates_routes(self, h_admin_fcc):
        r = requests.post(f"{API}/routes/optimize",
                          headers=h_admin_fcc, json={"num_trucks": 2}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 1
        assert all("id" in rt for rt in data["routes"])

    def test_reoptimize(self, h_admin_fcc):
        rs = requests.get(f"{API}/routes", headers=h_admin_fcc, timeout=15).json()
        rid = rs[0]["id"]
        r = requests.post(f"{API}/routes/{rid}/reoptimize",
                          headers=h_admin_fcc, timeout=30)
        assert r.status_code == 200


# ---------- Driver flow ----------
class TestDriverFlow:
    def test_mine_today(self, h_driver):
        import datetime as dt
        today = dt.datetime.utcnow().date().isoformat()
        r = requests.get(f"{API}/collection-tasks?mine=true&date={today}",
                         headers=h_driver, timeout=15)
        assert r.status_code == 200
        tasks = r.json()
        # ordered by sequence within route
        assert isinstance(tasks, list)

    def _pending_mine(self, h_driver):
        tasks = requests.get(f"{API}/collection-tasks?mine=true",
                             headers=h_driver, timeout=15).json()
        return [t for t in tasks if t["status"] == "scheduled"]

    def test_complete_geofence_violation(self, h_driver):
        pending = self._pending_mine(h_driver)
        if not pending:
            pytest.skip("no pending tasks")
        t = pending[0]
        r = requests.post(f"{API}/collection-tasks/{t['id']}/complete",
                          headers=h_driver,
                          json={"lat": 0.0, "lng": 0.0, "weight_kg": 100},
                          timeout=15)
        assert r.status_code == 409, r.text
        assert "metros" in r.json()["detail"].lower()

    def test_complete_ok_and_idempotent(self, h_driver):
        pending = self._pending_mine(h_driver)
        if not pending:
            pytest.skip("no pending tasks")
        t = pending[0]
        payload = {"lat": t["lat"], "lng": t["lng"], "weight_kg": 250}
        r1 = requests.post(f"{API}/collection-tasks/{t['id']}/complete",
                           headers=h_driver, json=payload, timeout=15)
        assert r1.status_code == 200, r1.text
        assert r1.json()["status"] == "collected"
        # idempotent
        r2 = requests.post(f"{API}/collection-tasks/{t['id']}/complete",
                           headers=h_driver, json=payload, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["status"] == "collected"

    def test_fail_creates_incident(self, h_driver, h_admin_fcc):
        pending = self._pending_mine(h_driver)
        if not pending:
            pytest.skip("no pending tasks")
        t = pending[0]
        before = requests.get(f"{API}/incidents", headers=h_admin_fcc, timeout=15).json()
        r = requests.post(f"{API}/collection-tasks/{t['id']}/fail",
                          headers=h_driver,
                          json={"reason": "Contentor bloqueado", "lat": t["lat"], "lng": t["lng"]},
                          timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "failed"
        after = requests.get(f"{API}/incidents", headers=h_admin_fcc, timeout=15).json()
        assert len(after) > len(before), "fail must auto-create an incident"

    def test_ignore(self, h_driver):
        pending = self._pending_mine(h_driver)
        if not pending:
            pytest.skip("no pending tasks")
        t = pending[0]
        r = requests.post(f"{API}/collection-tasks/{t['id']}/ignore",
                          headers=h_driver, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "ignored"

    def test_driver_cannot_complete_others_task(self, h_driver, h_admin_fcc):
        """Driver authorization: complete a task NOT assigned to this driver -> 403."""
        # find a task assigned to a different driver in the same company
        me = requests.get(f"{API}/auth/me", headers=h_driver, timeout=10).json()
        my_did = me.get("driver_id")
        all_tasks = requests.get(f"{API}/collection-tasks", headers=h_admin_fcc, timeout=15).json()
        other = next((t for t in all_tasks
                      if t.get("driver_id") and t["driver_id"] != my_did
                      and t["status"] == "scheduled"), None)
        if not other:
            pytest.skip("no task belonging to another driver")
        r = requests.post(f"{API}/collection-tasks/{other['id']}/complete",
                          headers=h_driver,
                          json={"lat": other["lat"], "lng": other["lng"]},
                          timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# ---------- Incidents ----------
class TestIncidents:
    def test_list(self, h_admin_fcc):
        r = requests.get(f"{API}/incidents", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200

    def test_customer_creates(self, h_customer):
        r = requests.post(f"{API}/incidents", headers=h_customer,
                          json={"kind": "contentor_partido", "priority": "high",
                                "description": "TEST_incident do cliente"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "open"

    def test_status_transition(self, h_customer, h_admin_fcc):
        cr = requests.post(f"{API}/incidents", headers=h_customer,
                           json={"kind": "outro", "description": "TEST_transition"}, timeout=15)
        iid = cr.json()["id"]
        # transition open -> in_progress
        u = requests.patch(f"{API}/incidents/{iid}", headers=h_admin_fcc,
                           json={"status": "in_progress"}, timeout=15)
        assert u.status_code == 200
        assert u.json()["status"] == "in_progress"
        # resolve
        u2 = requests.patch(f"{API}/incidents/{iid}", headers=h_admin_fcc,
                            json={"status": "resolved"}, timeout=15)
        assert u2.json()["status"] == "resolved"
        assert u2.json().get("resolved_at")


# ---------- Analytics stats ----------
class TestAnalyticsStats:
    def test_stats(self, h_admin_fcc):
        r = requests.get(f"{API}/analytics/stats", headers=h_admin_fcc, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("totals", "drivers", "waste_breakdown"):
            assert k in d


# ---------- AI ----------
class TestAI:
    def test_ai_ask(self, h_admin_fcc):
        r = requests.post(f"{API}/ai/ask", headers=h_admin_fcc,
                          json={"question": "Quantas recolhas fizemos hoje?"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("answer"), str) and len(d["answer"]) > 5
        cs = d.get("context_summary", {})
        assert "recolhas_hoje" in cs and "viaturas_total" in cs
