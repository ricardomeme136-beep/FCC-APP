"""Tests for route_templates (Fase 1): CRUD, stop editing, duplicate,
archive-vs-delete, save-as-template from a route and from a tracking
session, tenant isolation, RBAC, and the snapshot/independence invariant —
a template must never share live state with whatever it was created from or
duplicated from.
"""
import uuid

import requests
from conftest import API


def _container(h_admin_fcc, lat, lng, waste_type="general"):
    r = requests.post(f"{API}/containers", headers=h_admin_fcc, json={
        "address": "TEST_TplContainer", "lat": lat, "lng": lng, "waste_type": waste_type,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _depot(h_admin_fcc):
    return requests.get(f"{API}/depots", headers=h_admin_fcc, timeout=15).json()[0]


def _create_template(h_admin_fcc, name=None, n_stops=2):
    depot = _depot(h_admin_fcc)
    stops = []
    for i in range(n_stops):
        c = _container(h_admin_fcc, depot["lat"] + 0.02 * (i + 1), depot["lng"] + 0.02 * (i + 1))
        stops.append({"lat": c["lat"], "lng": c["lng"], "address": f"TEST_TplStop{i}", "container_ids": [c["id"]]})
    body = {
        "name": name or f"TEST_Template_{uuid.uuid4().hex[:6]}",
        "description": "TEST_desc", "start_depot_id": depot["id"], "stops": stops,
    }
    r = requests.post(f"{API}/route-templates", headers=h_admin_fcc, json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _driver_with_login(h_admin_fcc):
    email = f"test_tpl_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
        "name": f"TEST_TplDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    return driver, {"Authorization": f"Bearer {login['access_token']}"}


class TestCrudMultiTenant:
    def test_create_get_list(self, h_admin_fcc):
        t = _create_template(h_admin_fcc)
        got = requests.get(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc, timeout=15)
        assert got.status_code == 200, got.text
        assert got.json()["name"] == t["name"]

        listed = requests.get(f"{API}/route-templates", headers=h_admin_fcc, timeout=15).json()
        assert any(x["id"] == t["id"] for x in listed)

    def test_template_has_no_operational_fields(self, h_admin_fcc):
        t = _create_template(h_admin_fcc)
        for forbidden in ("date", "status", "actual_distance_km", "actual_duration_min",
                          "collected_count", "failed_count", "started_at", "completed_at"):
            assert forbidden not in t, f"template must never carry operational field {forbidden!r}"

    def test_not_visible_to_another_tenant(self, h_admin_fcc, h_admin_suma):
        t = _create_template(h_admin_fcc)
        other = requests.get(f"{API}/route-templates/{t['id']}", headers=h_admin_suma, timeout=15)
        assert other.status_code == 404
        other_list = requests.get(f"{API}/route-templates", headers=h_admin_suma, timeout=15).json()
        assert not any(x["id"] == t["id"] for x in other_list)


class TestRename:
    def test_rename_and_change_description(self, h_admin_fcc):
        t = _create_template(h_admin_fcc)
        r = requests.patch(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc,
                           json={"name": "TEST_Renamed", "description": "TEST_NewDesc"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_Renamed"
        assert r.json()["description"] == "TEST_NewDesc"


class TestDuplicate:
    def test_duplicate_is_independent_from_source(self, h_admin_fcc):
        original = _create_template(h_admin_fcc, name="TEST_Original")
        dup = requests.post(f"{API}/route-templates/{original['id']}/duplicate",
                            headers=h_admin_fcc, timeout=15)
        assert dup.status_code == 200, dup.text
        copy = dup.json()
        assert copy["id"] != original["id"]
        assert copy["name"] != original["name"] or "cópia" in copy["name"]
        assert [s["id"] for s in copy["stops"]] != [s["id"] for s in original["stops"]], \
            "duplicated stops must get their own fresh ids, never share the source's"

        # Editing the ORIGINAL afterward must never touch the copy.
        requests.patch(f"{API}/route-templates/{original['id']}", headers=h_admin_fcc,
                       json={"name": "TEST_ChangedAfterDuplicate"}, timeout=15)
        removed_stop_id = original["stops"][0]["id"]
        requests.delete(f"{API}/route-templates/{original['id']}/stops/{removed_stop_id}",
                        headers=h_admin_fcc, timeout=15)

        copy_after = requests.get(f"{API}/route-templates/{copy['id']}", headers=h_admin_fcc, timeout=15).json()
        assert copy_after["name"] == copy["name"]
        assert len(copy_after["stops"]) == len(copy["stops"])
        assert {s["id"] for s in copy_after["stops"]} == {s["id"] for s in copy["stops"]}


class TestArchiveOrDelete:
    def test_unused_template_is_hard_deleted(self, h_admin_fcc):
        t = _create_template(h_admin_fcc)
        r = requests.delete(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "delete"
        gone = requests.get(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc, timeout=15)
        assert gone.status_code == 404

    def test_template_with_an_execution_is_archived_not_deleted(self, h_admin_fcc):
        """No endpoint creates an execution FROM a template yet (Fase 2) —
        simulated here the same way test_route_stops.py simulates a legacy
        route: a route.template_id set directly, since that link (Fase 1,
        section 9) already exists on the model. This proves the archive
        branch of delete_template() actually engages once that link exists,
        without waiting for the Fase 2 endpoint to build it."""
        t = _create_template(h_admin_fcc)
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.05, depot["lng"] + 0.05)
        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-06-01", "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_ExecStop", "container_id": c["id"]}],
        }, timeout=30).json()

        # No PATCH exists for routes.template_id (Fase 2 concern) — this is a
        # one-time direct link to exercise the guard, not a supported flow.
        import asyncio, os
        from motor.motor_asyncio import AsyncIOMotorClient
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        loop.run_until_complete(client.routes.update_one({"id": route["id"]}, {"$set": {"template_id": t["id"]}}))

        r = requests.delete(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "archive"
        still_there = requests.get(f"{API}/route-templates/{t['id']}", headers=h_admin_fcc, timeout=15)
        assert still_there.status_code == 200
        assert still_there.json()["active"] is False


class TestPermissions:
    def test_driver_cannot_create_edit_duplicate_or_delete(self, h_admin_fcc):
        _, driver_headers = _driver_with_login(h_admin_fcc)
        t = _create_template(h_admin_fcc)

        create = requests.post(f"{API}/route-templates", headers=driver_headers,
                               json={"name": "TEST_ByDriver", "stops": []}, timeout=15)
        assert create.status_code == 403

        edit = requests.patch(f"{API}/route-templates/{t['id']}", headers=driver_headers,
                              json={"name": "TEST_Hacked"}, timeout=15)
        assert edit.status_code == 403

        dup = requests.post(f"{API}/route-templates/{t['id']}/duplicate", headers=driver_headers, timeout=15)
        assert dup.status_code == 403

        delete = requests.delete(f"{API}/route-templates/{t['id']}", headers=driver_headers, timeout=15)
        assert delete.status_code == 403

    def test_driver_can_still_read(self, h_admin_fcc):
        _, driver_headers = _driver_with_login(h_admin_fcc)
        t = _create_template(h_admin_fcc)
        r = requests.get(f"{API}/route-templates/{t['id']}", headers=driver_headers, timeout=15)
        assert r.status_code == 200, r.text

    def test_dispatcher_can_manage_templates(self, h_admin_fcc, dispatcher_fcc):
        headers = {"Authorization": f"Bearer {dispatcher_fcc['access_token']}"}
        depot = _depot(h_admin_fcc)
        r = requests.post(f"{API}/route-templates", headers=headers,
                          json={"name": "TEST_ByDispatcher", "start_depot_id": depot["id"], "stops": []}, timeout=15)
        assert r.status_code == 200, r.text


class TestStopsMultipleContainersAndEditing:
    def test_add_stop_with_multiple_containers_groups_into_one_stop(self, h_admin_fcc):
        t = _create_template(h_admin_fcc, n_stops=1)
        depot = _depot(h_admin_fcc)
        # Two containers a few meters apart — within cluster_into_stops'
        # DEFAULT_THRESHOLD_M, so they must land in the SAME new stop.
        c1 = _container(h_admin_fcc, depot["lat"] + 0.05, depot["lng"] + 0.05, "paper")
        c2 = _container(h_admin_fcc, depot["lat"] + 0.0501, depot["lng"] + 0.0501, "glass")
        r = requests.post(f"{API}/route-templates/{t['id']}/stops", headers=h_admin_fcc,
                          json={"container_ids": [c1["id"], c2["id"]]}, timeout=30)
        assert r.status_code == 200, r.text
        updated = r.json()
        new_stop = next(s for s in updated["stops"] if set(s["container_ids"]) == {c1["id"], c2["id"]})
        assert sorted(new_stop["waste_types"]) == ["glass", "paper"]

    def test_reorder_add_update_remove(self, h_admin_fcc):
        t = _create_template(h_admin_fcc, n_stops=2)
        stop_ids = [s["id"] for s in t["stops"]]

        reordered = requests.patch(f"{API}/route-templates/{t['id']}/stops/reorder", headers=h_admin_fcc,
                                   json={"stop_ids": list(reversed(stop_ids))}, timeout=15)
        assert reordered.status_code == 200, reordered.text
        seqs = {s["id"]: s["sequence"] for s in reordered.json()["stops"]}
        assert seqs[stop_ids[0]] == 2 and seqs[stop_ids[1]] == 1

        moved = requests.patch(f"{API}/route-templates/{t['id']}/stops/{stop_ids[0]}", headers=h_admin_fcc,
                               json={"lat": 41.5, "lng": -8.5, "address": "TEST_Moved"}, timeout=15)
        assert moved.status_code == 200, moved.text
        moved_stop = next(s for s in moved.json()["stops"] if s["id"] == stop_ids[0])
        assert moved_stop["lat"] == 41.5 and moved_stop["address"] == "TEST_Moved"

        removed = requests.delete(f"{API}/route-templates/{t['id']}/stops/{stop_ids[1]}",
                                  headers=h_admin_fcc, timeout=15)
        assert removed.status_code == 200, removed.text
        assert len(removed.json()["stops"]) == 1

    def test_disassociate_and_associate_containers_on_a_stop(self, h_admin_fcc):
        t = _create_template(h_admin_fcc, n_stops=1)
        stop = t["stops"][0]
        depot = _depot(h_admin_fcc)
        new_c = _container(h_admin_fcc, stop["lat"], stop["lng"], "plastic")

        r = requests.patch(f"{API}/route-templates/{t['id']}/stops/{stop['id']}", headers=h_admin_fcc,
                           json={"container_ids": [new_c["id"]]}, timeout=15)
        assert r.status_code == 200, r.text
        updated_stop = next(s for s in r.json()["stops"] if s["id"] == stop["id"])
        assert updated_stop["container_ids"] == [new_c["id"]]
        assert updated_stop["waste_types"] == ["plastic"]


class TestSaveRouteAsTemplate:
    def test_copies_planning_data_only_and_leaves_source_route_untouched(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.03, depot["lng"] + 0.03)
        driver, driver_headers = _driver_with_login(h_admin_fcc)
        vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
        }, timeout=15).json()
        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": "2026-06-02", "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_SaveAsTplStop", "container_id": c["id"]}],
            "driver_id": driver["id"], "vehicle_id": vehicle["id"],
        }, timeout=30).json()

        before = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()

        r = requests.post(f"{API}/routes/{route['id']}/save-as-template", headers=h_admin_fcc,
                          json={"name": "TEST_FromRoute", "description": "TEST_d"}, timeout=30)
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["name"] == "TEST_FromRoute"
        assert len(tpl["stops"]) == 1
        assert tpl["stops"][0]["container_ids"] == [c["id"]]
        # Never copied — these are execution/operational facts, not "the plan".
        for forbidden in ("date", "status", "actual_distance_km", "started_at", "completed_at"):
            assert forbidden not in tpl
        assert tpl["default_driver_id"] is None
        assert tpl["default_vehicle_id"] is None

        # Source route must be unchanged, EXCEPT geometry_cache: save-as-
        # template reuses route_geometry() (the same helper GET
        # /routes/{id}/geometry already uses) rather than duplicating its
        # stop->points->road_route() logic, and that helper's documented,
        # pre-existing behavior is to lazily cache geometry onto the route
        # the first time anyone asks for it — any other viewer of this route
        # would have triggered the exact same write. Every other field,
        # crucially including status/date/driver/vehicle/tasks, must be
        # untouched.
        after = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        before.pop("geometry_cache", None)
        after.pop("geometry_cache", None)
        assert after == before

        # Editing the template afterward must never reach back to the route.
        requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc,
                       json={"name": "TEST_ChangedAfterSave"}, timeout=15)
        route_after_tpl_edit = requests.get(f"{API}/routes/{route['id']}", headers=h_admin_fcc, timeout=15).json()
        route_after_tpl_edit.pop("geometry_cache", None)
        assert route_after_tpl_edit == before


class TestSaveTrackingAsTemplate:
    def _driver_on_route(self, h_admin_fcc, date):
        depot = _depot(h_admin_fcc)
        driver, headers = _driver_with_login(h_admin_fcc)
        vehicle = requests.post(f"{API}/vehicles", headers=h_admin_fcc, json={
            "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
        }, timeout=15).json()
        route = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": date, "start": {"depot_id": depot["id"]},
            "stops": [{"lat": depot["lat"] + 0.01, "lng": depot["lng"] + 0.01, "address": "TEST_TrkStop"}],
            "driver_id": driver["id"], "vehicle_id": vehicle["id"],
        }, timeout=30).json()
        start = requests.post(f"{API}/routes/{route['id']}/start", headers=headers, timeout=15)
        assert start.status_code == 200, start.text
        return driver, headers, route

    def test_geometry_copied_stops_empty_source_untouched(self, h_admin_fcc):
        driver, headers, route = self._driver_on_route(h_admin_fcc, "2026-06-03")
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        points = [{"point_uuid": str(uuid.uuid4()), "lat": 41.30 + i * 0.001, "lng": -8.30 + i * 0.001,
                  "timestamp": f"2026-06-03T10:0{i}:00+00:00"} for i in range(5)]
        add = requests.post(f"{API}/tracking-sessions/{session['id']}/points", headers=headers,
                            json={"points": points}, timeout=15)
        assert add.status_code == 200, add.text
        requests.post(f"{API}/tracking-sessions/{session['id']}/finish", headers=headers, timeout=15)

        before_session = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        before_points = before_session["points"]

        r = requests.post(f"{API}/tracking-sessions/{session['id']}/save-as-template", headers=h_admin_fcc,
                          json={"name": "TEST_FromTracking"}, timeout=15)
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["stops"] == []
        assert tpl["geometry"]["provider"] == "tracking_session"
        assert len(tpl["geometry"]["coordinates"]) == len(points)
        assert tpl["start_lat"] == points[0]["lat"] and tpl["start_lng"] == points[0]["lng"]
        for forbidden in ("date", "status", "actual_distance_km", "started_at", "completed_at"):
            assert forbidden not in tpl

        # The recording itself — session + every gps_positions point — must
        # be byte-for-byte unchanged after creating the template from it.
        after_session = requests.get(f"{API}/tracking-sessions/{session['id']}", headers=h_admin_fcc, timeout=15).json()
        assert after_session["points"] == before_points
        assert after_session["status"] == before_session["status"]
        assert after_session["distance_km"] == before_session["distance_km"]

    def test_rejects_session_with_too_few_points(self, h_admin_fcc):
        driver, headers, route = self._driver_on_route(h_admin_fcc, "2026-06-04")
        session = requests.post(f"{API}/tracking-sessions/start", headers=headers,
                                json={"lat": 41.30, "lng": -8.30}, timeout=15).json()
        r = requests.post(f"{API}/tracking-sessions/{session['id']}/save-as-template", headers=h_admin_fcc,
                          json={"name": "TEST_TooFew"}, timeout=15)
        assert r.status_code == 400
