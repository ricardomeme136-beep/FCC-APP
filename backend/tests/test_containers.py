"""Tests for container visibility in route creation, and container
archive/delete (Fase: contentores no criador de rotas + eliminação segura).
"""
import uuid

import requests
from conftest import API, PASSWORD


def _create_container(h_admin_fcc, **overrides):
    body = {
        "address": f"TEST_Container_{uuid.uuid4().hex[:8]}",
        "lat": 41.30, "lng": -8.28, "waste_type": "general",
    }
    body.update(overrides)
    r = requests.post(f"{API}/containers", headers=h_admin_fcc, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _depot(h_admin_fcc):
    return requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]


class TestContainerAvailabilityAnnotation:
    def test_fresh_container_is_available_for_a_date(self, h_admin_fcc):
        c = _create_container(h_admin_fcc)
        r = requests.get(f"{API}/containers?for_date=2026-04-15", headers=h_admin_fcc, timeout=15)
        row = next(x for x in r.json() if x["id"] == c["id"])
        assert row["available"] is True
        assert row["unavailable_reason"] is None

    def test_container_already_scheduled_shows_route_code_not_silently_hidden(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _create_container(h_admin_fcc, lat=depot["lat"] + 0.01, lng=depot["lng"] + 0.01)
        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-04-16",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": c["address"], "container_id": c["id"]}],
        }, timeout=30).json()

        r = requests.get(f"{API}/containers?for_date=2026-04-16", headers=h_admin_fcc, timeout=15)
        row = next(x for x in r.json() if x["id"] == c["id"])
        assert row["available"] is False
        assert route["code"] in row["unavailable_reason"]

        # A different date is unaffected.
        r2 = requests.get(f"{API}/containers?for_date=2026-04-17", headers=h_admin_fcc, timeout=15)
        row2 = next(x for x in r2.json() if x["id"] == c["id"])
        assert row2["available"] is True

    def test_archived_container_flagged_unavailable(self, h_admin_fcc):
        c = _create_container(h_admin_fcc)
        requests.patch(f"{API}/containers/{c['id']}", headers=h_admin_fcc, json={"status": "archived"}, timeout=15)
        r = requests.get(f"{API}/containers?for_date=2026-04-18", headers=h_admin_fcc, timeout=15)
        row = next(x for x in r.json() if x["id"] == c["id"])
        assert row["available"] is False
        assert row["unavailable_reason"] == "Arquivado"


class TestContainerDeleteOrArchive:
    def test_delete_without_history_requires_password(self, h_admin_fcc):
        c = _create_container(h_admin_fcc)
        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 400

    def test_delete_without_history_rejects_wrong_password(self, h_admin_fcc):
        c = _create_container(h_admin_fcc)
        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_admin_fcc,
                            json={"password": "WrongPassword123"}, timeout=15)
        assert r.status_code == 401

    def test_delete_without_history_succeeds_and_is_permanent(self, h_admin_fcc):
        c = _create_container(h_admin_fcc)
        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_admin_fcc,
                            json={"password": PASSWORD}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "delete"
        gone = requests.get(f"{API}/containers/{c['id']}", headers=h_admin_fcc, timeout=15)
        assert gone.status_code == 404

    def test_container_with_history_archives_and_keeps_history(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _create_container(h_admin_fcc, lat=depot["lat"] + 0.02, lng=depot["lng"] + 0.02)
        requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-04-19",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": c["address"], "container_id": c["id"]}],
        }, timeout=30)

        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "archive"

        detail = requests.get(f"{API}/containers/{c['id']}", headers=h_admin_fcc, timeout=15)
        assert detail.status_code == 200
        assert detail.json()["status"] == "archived"
        assert len(detail.json()["history"]) == 1  # the collection_task is still there

        active_list = requests.get(f"{API}/containers?status=active", headers=h_admin_fcc, timeout=15).json()
        assert not any(x["id"] == c["id"] for x in active_list)

    def test_dispatcher_cannot_delete_or_archive_container(self, h_admin_fcc, dispatcher_fcc):
        h_dispatcher = {"Authorization": f"Bearer {dispatcher_fcc['access_token']}"}
        c = _create_container(h_admin_fcc)
        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_dispatcher,
                            json={"password": PASSWORD}, timeout=15)
        assert r.status_code == 403

    def test_archived_container_rejected_when_explicitly_used_in_new_route(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _create_container(h_admin_fcc, lat=depot["lat"] + 0.03, lng=depot["lng"] + 0.03)
        requests.patch(f"{API}/containers/{c['id']}", headers=h_admin_fcc, json={"status": "archived"}, timeout=15)

        manual = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-04-20",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": c["address"], "container_id": c["id"]}],
        }, timeout=30)
        assert manual.status_code == 400
        assert c["qr_code"] in manual.json()["detail"]

        auto = requests.post(f"{API}/routes/optimize", headers=h_admin_fcc, json={
            "date": "2026-04-20", "container_ids": [c["id"]], "num_trucks": 1,
        }, timeout=30)
        assert auto.status_code == 400
        assert c["qr_code"] in auto.json()["detail"]

    def test_multi_tenant_isolation_cannot_delete_other_companys_container(self, h_admin_fcc, h_admin_suma):
        c = _create_container(h_admin_fcc)
        r = requests.delete(f"{API}/containers/{c['id']}", headers=h_admin_suma,
                            json={"password": PASSWORD}, timeout=15)
        assert r.status_code == 404

    def test_audit_log_records_delete_and_archive(self, h_admin_fcc):
        c1 = _create_container(h_admin_fcc)
        requests.delete(f"{API}/containers/{c1['id']}", headers=h_admin_fcc, json={"password": PASSWORD}, timeout=15)

        depot = _depot(h_admin_fcc)
        c2 = _create_container(h_admin_fcc, lat=depot["lat"] + 0.04, lng=depot["lng"] + 0.04)
        requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-04-21",
            "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c2["lat"], "lng": c2["lng"], "address": c2["address"], "container_id": c2["id"]}],
        }, timeout=30)
        requests.delete(f"{API}/containers/{c2['id']}", headers=h_admin_fcc, timeout=15)

        logs = requests.get(f"{API}/audit-logs", headers=h_admin_fcc, timeout=15).json()
        assert any(l["entity"] == "container" and l["entity_id"] == c1["id"] and l["action"] == "delete" for l in logs)
        assert any(l["entity"] == "container" and l["entity_id"] == c2["id"] and l["action"] == "archive" for l in logs)
