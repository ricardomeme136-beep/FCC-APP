"""Tests for route_schedules (Fase 3) — recurring template -> execution
materialization. Snapshot-independence of a single execution from its
template is already exhaustively covered by
test_pre_template_regression_guard.py::TestFutureRouteTemplateSnapshot; this
file focuses on what's new: recurrence rules, the materialization window,
idempotency, edit/deactivate/cancel policy, and interval-based conflicts.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import requests
from conftest import API, PASSWORD


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _depot(h):
    return requests.get(f"{API}/depots", headers=h, timeout=15).json()[0]


def _container(h, lat, lng):
    r = requests.post(f"{API}/containers", headers=h, json={
        "address": "TEST_SchedContainer", "lat": lat, "lng": lng, "waste_type": "general",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _template_with_one_stop(h):
    depot = _depot(h)
    c = _container(h, depot["lat"] + 0.02, depot["lng"] + 0.02)
    r = requests.post(f"{API}/route-templates", headers=h, json={
        "name": f"TEST_SchedTemplate_{uuid.uuid4().hex[:6]}", "start_depot_id": depot["id"],
        "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_SchedStop", "container_ids": [c["id"]]}],
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _driver_with_login(h):
    email = f"test_sched_{uuid.uuid4().hex[:8]}@example.com"
    driver = requests.post(f"{API}/drivers", headers=h, json={
        "name": f"TEST_SchedDriver_{uuid.uuid4().hex[:4]}", "email": email, "password": "SenhaForte123",
    }, timeout=15).json()
    login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15).json()
    return driver, {"Authorization": f"Bearer {login['access_token']}"}


def _vehicle(h):
    return requests.post(f"{API}/vehicles", headers=h, json={
        "plate": f"TEST-{uuid.uuid4().hex[:6].upper()}", "capacity_kg": 8000,
    }, timeout=15).json()


class TestOneTimeSchedule:
    def test_creates_single_execution_on_start_date(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        d = (_today() + timedelta(days=3)).isoformat()
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once", "start_date": d,
        }, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["materialized"]) == 1
        route = body["materialized"][0]
        assert route["date"] == d
        assert route["schedule_id"] == body["schedule"]["id"]
        assert route["template_id"] == tpl["id"]
        assert route["status"] == "scheduled"


class TestWeeklyRecurrence:
    def test_selected_weekdays_only(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        start = _today()
        end = start + timedelta(days=13)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "weekly", "weekdays": [0, 2, 4],
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        assert r.status_code == 200, r.text
        dates = sorted(rr["date"] for rr in r.json()["materialized"])
        expected = [d for d in (start + timedelta(days=i) for i in range((end - start).days + 1))
                    if d.weekday() in (0, 2, 4)]
        assert dates == [d.isoformat() for d in expected]

    def test_rejects_empty_weekday_list(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "weekly", "weekdays": [],
            "start_date": _today().isoformat(),
        }, timeout=15)
        assert r.status_code == 400


class TestBusinessDaysAndDaily:
    def test_weekdays_recurrence_is_monday_to_friday_only(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        start = _today()
        end = start + timedelta(days=6)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "weekdays",
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        assert r.status_code == 200, r.text
        dates = [date.fromisoformat(x["date"]) for x in r.json()["materialized"]]
        assert dates and all(d.weekday() < 5 for d in dates)

    def test_daily_recurrence_covers_every_day(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        start = _today()
        end = start + timedelta(days=6)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "daily",
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        assert r.status_code == 200, r.text
        assert len(r.json()["materialized"]) == 7


class TestMaterializationIdempotency:
    def test_materializing_twice_does_not_duplicate(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        d = (_today() + timedelta(days=2)).isoformat()
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once", "start_date": d,
        }, timeout=30)
        sid = r.json()["schedule"]["id"]

        again = requests.post(f"{API}/route-schedules/{sid}/materialize", headers=h_admin_fcc, timeout=30)
        assert again.status_code == 200, again.text
        assert again.json()["materialized"] == []

        cal = requests.get(f"{API}/schedule/calendar", headers=h_admin_fcc,
                           params={"start": d, "end": d}, timeout=30).json()
        matches = [i for i in cal["items"] if i["schedule_id"] == sid]
        assert len(matches) == 1

    def test_calendar_view_materializes_without_duplicating(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        start = _today() + timedelta(days=1)
        end = start + timedelta(days=6)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "daily",
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        sid = r.json()["schedule"]["id"]

        cal1 = requests.get(f"{API}/schedule/calendar", headers=h_admin_fcc,
                            params={"start": start.isoformat(), "end": end.isoformat()}, timeout=30).json()
        cal2 = requests.get(f"{API}/schedule/calendar", headers=h_admin_fcc,
                            params={"start": start.isoformat(), "end": end.isoformat()}, timeout=30).json()
        count1 = len([i for i in cal1["items"] if i["schedule_id"] == sid])
        count2 = len([i for i in cal2["items"] if i["schedule_id"] == sid])
        assert count1 == 7
        assert count2 == 7


class TestSnapshotIndependence:
    def test_editing_template_after_schedule_created_does_not_change_materialized_route(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        d = (_today() + timedelta(days=4)).isoformat()
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once", "start_date": d,
        }, timeout=30)
        route_id = r.json()["materialized"][0]["id"]
        before = requests.get(f"{API}/routes/{route_id}", headers=h_admin_fcc, timeout=15).json()

        renamed = requests.patch(f"{API}/route-templates/{tpl['id']}", headers=h_admin_fcc,
                                 json={"name": "TEST_Renamed"}, timeout=15)
        assert renamed.status_code == 200, renamed.text

        after = requests.get(f"{API}/routes/{route_id}", headers=h_admin_fcc, timeout=15).json()
        assert before["stops"] == after["stops"]
        assert before["num_stops"] == after["num_stops"]


class TestEditingScheduleNeverTouchesHistory:
    def test_completed_execution_is_never_rewritten_when_schedule_is_edited(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        d = (_today() + timedelta(days=1)).isoformat()
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once", "start_date": d,
        }, timeout=30)
        sid = r.json()["schedule"]["id"]
        route_id = r.json()["materialized"][0]["id"]

        started = requests.post(f"{API}/routes/{route_id}/start", headers=h_admin_fcc, timeout=15)
        assert started.status_code == 200, started.text
        finished = requests.post(f"{API}/routes/{route_id}/finish", headers=h_admin_fcc, timeout=15)
        assert finished.status_code == 200, finished.text

        edited = requests.patch(f"{API}/route-schedules/{sid}", headers=h_admin_fcc,
                                json={"planned_start_time": "09:00"}, timeout=30)
        assert edited.status_code == 200, edited.text

        route_after = requests.get(f"{API}/routes/{route_id}", headers=h_admin_fcc, timeout=15).json()
        assert route_after["status"] == "completed"
        assert route_after["date"] == d

    def test_editing_rule_recreates_only_still_scheduled_future_routes(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        start = _today() + timedelta(days=5)
        end = start + timedelta(days=2)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "daily",
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        sid = r.json()["schedule"]["id"]
        assert len(r.json()["materialized"]) == 3

        edited = requests.patch(f"{API}/route-schedules/{sid}", headers=h_admin_fcc,
                                json={"planned_start_time": "10:15"}, timeout=30)
        assert edited.status_code == 200, edited.text
        assert len(edited.json()["materialized"]) == 3
        assert all(rr["planned_start_time"] == "10:15" for rr in edited.json()["materialized"])


class TestDeactivateAndCancelFuture:
    def test_deactivating_schedule_keeps_existing_future_routes(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        d = (_today() + timedelta(days=6)).isoformat()
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once", "start_date": d,
        }, timeout=30)
        sid = r.json()["schedule"]["id"]
        route_id = r.json()["materialized"][0]["id"]

        deactivated = requests.patch(f"{API}/route-schedules/{sid}", headers=h_admin_fcc,
                                     json={"active": False}, timeout=30)
        assert deactivated.status_code == 200, deactivated.text
        assert deactivated.json()["materialized"] == []

        still_there = requests.get(f"{API}/routes/{route_id}", headers=h_admin_fcc, timeout=15)
        assert still_there.status_code == 200
        assert still_there.json()["status"] == "scheduled"

    def test_cancel_future_executions_removes_only_scheduled_ones(self, h_admin_fcc):
        tpl = _template_with_one_stop(h_admin_fcc)
        past_ish = _today() + timedelta(days=1)
        end = past_ish + timedelta(days=2)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "daily",
            "start_date": past_ish.isoformat(), "end_date": end.isoformat(),
        }, timeout=30)
        sid = r.json()["schedule"]["id"]
        routes = r.json()["materialized"]
        assert len(routes) == 3

        first_route_id = routes[0]["id"]
        requests.post(f"{API}/routes/{first_route_id}/start", headers=h_admin_fcc, timeout=15)
        requests.post(f"{API}/routes/{first_route_id}/finish", headers=h_admin_fcc, timeout=15)

        cancelled = requests.post(f"{API}/route-schedules/{sid}/cancel-future-executions",
                                  headers=h_admin_fcc, timeout=30)
        assert cancelled.status_code == 200, cancelled.text

        completed_route = requests.get(f"{API}/routes/{first_route_id}", headers=h_admin_fcc, timeout=15)
        assert completed_route.status_code == 200
        assert completed_route.json()["status"] == "completed"

        for rr in routes[1:]:
            gone = requests.get(f"{API}/routes/{rr['id']}", headers=h_admin_fcc, timeout=15)
            assert gone.status_code == 404


class TestTimeIntervalConflicts:
    def test_overlapping_start_times_warn_for_same_driver(self, h_admin_fcc):
        driver, _ = _driver_with_login(h_admin_fcc)
        d = (_today() + timedelta(days=7)).isoformat()
        tpl1 = _template_with_one_stop(h_admin_fcc)
        first = requests.post(f"{API}/route-templates/{tpl1['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "06:00", "driver_id": driver["id"],
        }, timeout=30)
        assert first.status_code == 200, first.text

        tpl2 = _template_with_one_stop(h_admin_fcc)
        second = requests.post(f"{API}/route-templates/{tpl2['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "06:15", "driver_id": driver["id"],
        }, timeout=30)
        assert second.status_code == 200, second.text
        assert len(second.json()["warnings"]) >= 1

    def test_non_overlapping_start_times_do_not_warn(self, h_admin_fcc):
        driver, _ = _driver_with_login(h_admin_fcc)
        d = (_today() + timedelta(days=8)).isoformat()
        tpl1 = _template_with_one_stop(h_admin_fcc)
        first = requests.post(f"{API}/route-templates/{tpl1['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "06:00", "driver_id": driver["id"],
        }, timeout=30)
        assert first.status_code == 200, first.text

        tpl2 = _template_with_one_stop(h_admin_fcc)
        second = requests.post(f"{API}/route-templates/{tpl2['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "07:00", "driver_id": driver["id"],
        }, timeout=30)
        assert second.status_code == 200, second.text
        assert second.json()["warnings"] == []

    def test_overlapping_start_times_warn_for_same_vehicle(self, h_admin_fcc):
        vehicle = _vehicle(h_admin_fcc)
        d = (_today() + timedelta(days=9)).isoformat()
        tpl1 = _template_with_one_stop(h_admin_fcc)
        first = requests.post(f"{API}/route-templates/{tpl1['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "08:00", "vehicle_id": vehicle["id"],
        }, timeout=30)
        assert first.status_code == 200, first.text

        tpl2 = _template_with_one_stop(h_admin_fcc)
        second = requests.post(f"{API}/route-templates/{tpl2['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "08:10", "vehicle_id": vehicle["id"],
        }, timeout=30)
        assert second.status_code == 200, second.text
        assert any("viatura" in w.lower() for w in second.json()["warnings"])


class TestMultipleRoutesSameDayAllowed:
    def test_two_routes_same_day_different_driver_no_conflict(self, h_admin_fcc):
        d1, _ = _driver_with_login(h_admin_fcc)
        d2, _ = _driver_with_login(h_admin_fcc)
        d = (_today() + timedelta(days=10)).isoformat()
        tpl1 = _template_with_one_stop(h_admin_fcc)
        tpl2 = _template_with_one_stop(h_admin_fcc)
        r1 = requests.post(f"{API}/route-templates/{tpl1['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "06:00", "driver_id": d1["id"],
        }, timeout=30)
        r2 = requests.post(f"{API}/route-templates/{tpl2['id']}/create-execution", headers=h_admin_fcc, json={
            "date": d, "start_time": "06:00", "driver_id": d2["id"],
        }, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["warnings"] == [] and r2.json()["warnings"] == []


class TestPermissionsAndTenantIsolation:
    def test_driver_cannot_create_schedule(self, h_admin_fcc):
        _, driver_headers = _driver_with_login(h_admin_fcc)
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-schedules", headers=driver_headers, json={
            "template_id": tpl["id"], "recurrence_type": "once",
            "start_date": (_today() + timedelta(days=1)).isoformat(),
        }, timeout=15)
        assert r.status_code == 403

    def test_schedule_not_visible_across_tenants(self, h_admin_fcc, h_admin_suma):
        tpl = _template_with_one_stop(h_admin_fcc)
        r = requests.post(f"{API}/route-schedules", headers=h_admin_fcc, json={
            "template_id": tpl["id"], "recurrence_type": "once",
            "start_date": (_today() + timedelta(days=1)).isoformat(),
        }, timeout=30)
        sid = r.json()["schedule"]["id"]
        cross = requests.get(f"{API}/route-schedules/{sid}", headers=h_admin_suma, timeout=15)
        assert cross.status_code == 404


class TestOldRoutesWithoutScheduleStillWork:
    def test_manual_route_has_null_schedule_id_and_appears_in_calendar(self, h_admin_fcc):
        depot = _depot(h_admin_fcc)
        c = _container(h_admin_fcc, depot["lat"] + 0.01, depot["lng"] + 0.01)
        d = (_today() + timedelta(days=11)).isoformat()
        r = requests.post(f"{API}/routes/manual", headers=h_admin_fcc, json={
            "date": d, "start": {"depot_id": depot["id"]},
            "stops": [{"lat": c["lat"], "lng": c["lng"], "address": "TEST_ManualStop", "container_id": c["id"]}],
        }, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["schedule_id"] is None

        cal = requests.get(f"{API}/schedule/calendar", headers=h_admin_fcc,
                           params={"start": d, "end": d}, timeout=30).json()
        matches = [i for i in cal["items"] if i["id"] == r.json()["id"]]
        assert len(matches) == 1
        assert matches[0]["schedule_id"] is None
        assert matches[0]["recurrent"] is False
