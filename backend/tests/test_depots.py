"""Tests for the primary depot / default start-point behaviour.

A company should never have to pick a depot manually once one is marked
is_primary — the automatic route creator, the manual/visual route creator
and the depot detail view all fall back to it.
"""
import uuid
from datetime import datetime, timezone

import requests
from conftest import API


def _create_depot(h_admin_fcc, is_primary=False, **overrides):
    body = {
        "name": f"TEST_Depot_{uuid.uuid4().hex[:8]}",
        "address": "TEST_Rua Depósito", "lat": 41.30, "lng": -8.28,
        "is_primary": is_primary,
    }
    body.update(overrides)
    r = requests.post(f"{API}/depots", headers=h_admin_fcc, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestPrimaryDepotBehavior:
    """All in one class: is_primary is a company-wide flag, and pytest-xdist
    pins a class's tests to a single worker (loadscope) — keeping these
    together avoids two workers racing to set/unset the same company's
    primary depot concurrently."""

    def test_marking_a_depot_primary_unmarks_the_previous_one(self, h_admin_fcc):
        first = _create_depot(h_admin_fcc, is_primary=True)
        second = _create_depot(h_admin_fcc, is_primary=True)

        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        primaries = [d for d in depots if d["id"] in (first["id"], second["id"]) and d["is_primary"]]
        assert len(primaries) == 1
        assert primaries[0]["id"] == second["id"]

    def test_patch_can_promote_an_existing_depot_to_primary(self, h_admin_fcc):
        first = _create_depot(h_admin_fcc, is_primary=True)
        second = _create_depot(h_admin_fcc, is_primary=False)

        upd = requests.patch(f"{API}/depots/{second['id']}", headers=h_admin_fcc, json={
            "name": second["name"], "address": second["address"],
            "lat": second["lat"], "lng": second["lng"], "is_primary": True,
        }, timeout=15)
        assert upd.status_code == 200, upd.text
        assert upd.json()["is_primary"] is True

        depots = requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()
        first_row = next(d for d in depots if d["id"] == first["id"])
        assert first_row["is_primary"] is False

    def test_optimize_defaults_to_primary_depot_when_not_chosen(self, h_admin_fcc):
        primary = _create_depot(h_admin_fcc, is_primary=True, lat=41.31, lng=-8.29)
        c = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
            "address": "TEST_OptimizeDefaultDepot", "lat": primary["lat"] + 0.01, "lng": primary["lng"] + 0.01,
            "waste_type": "general",
        }, timeout=15).json()

        r = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": "2026-03-09", "container_ids": [c["id"]], "num_trucks": 1,
        }, timeout=30)
        assert r.status_code == 200, r.text
        routes = r.json()["routes"]
        assert routes and routes[0]["start_depot_id"] == primary["id"]

    def test_manual_route_falls_back_to_primary_depot_with_no_start_at_all(self, h_admin_fcc):
        primary = _create_depot(h_admin_fcc, is_primary=True, lat=41.32, lng=-8.30)

        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-03-10",
            "stops": [{"lat": primary["lat"] + 0.01, "lng": primary["lng"] + 0.01, "address": "TEST_NoStartGiven"}],
        }, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["start_depot_id"] == primary["id"]


class TestDepotDetail:
    def test_depot_detail_includes_real_stats_not_placeholders(self, h_admin_fcc):
        depot = _create_depot(h_admin_fcc, lat=41.33, lng=-8.31)
        detail = requests.get(f"{API}/depots/{depot['id']}", headers=h_admin_fcc, timeout=15)
        assert detail.status_code == 200, detail.text
        data = detail.json()
        assert data["routes_today"] == 0
        assert data["vehicles_at_depot"] == 0

        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": datetime.now(timezone.utc).date().isoformat(),
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_DepotStatsStop"}],
        }, timeout=30)
        assert r.status_code == 200, r.text

        after = requests.get(f"{API}/depots/{depot['id']}", headers=h_admin_fcc, timeout=15).json()
        assert after["routes_today"] == 1
