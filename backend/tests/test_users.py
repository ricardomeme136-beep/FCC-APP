"""Tests for real user/driver account management (Fase PROD1).

These tests create their own throwaway accounts (prefixed TEST_) inside the
already-seeded test tenant — they don't touch the demo seed accounts used
by other test files, and they're exactly the kind of "fictitious test users"
the user asked to keep: this is the test environment, not the real app.
"""
import uuid

import requests
from conftest import API


def _unique_email(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"


class TestUserCreation:
    def test_create_user_success_and_can_login(self, h_admin_fcc):
        email = _unique_email("test_user")
        r = requests.post(f"{API}/users", headers=h_admin_fcc, json={
            "name": "TEST_User", "email": email, "password": "SenhaForte123", "role": "dispatcher",
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == email.lower()
        assert "password_hash" not in data

        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 200, login.text

    def test_create_user_rejects_duplicate_email(self, h_admin_fcc):
        email = _unique_email("test_dup")
        body = {"name": "TEST_Dup", "email": email, "password": "SenhaForte123", "role": "dispatcher"}
        r1 = requests.post(f"{API}/users", headers=h_admin_fcc, json=body, timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/users", headers=h_admin_fcc, json=body, timeout=15)
        assert r2.status_code == 400
        assert "existe" in r2.json()["detail"].lower()

    def test_create_user_rejects_super_admin_role(self, h_admin_fcc):
        r = requests.post(f"{API}/users", headers=h_admin_fcc, json={
            "name": "TEST_SA", "email": _unique_email("test_sa"),
            "password": "SenhaForte123", "role": "super_admin",
        }, timeout=15)
        assert r.status_code == 400

    def test_driver_role_cannot_create_users(self, h_driver):
        r = requests.post(f"{API}/users", headers=h_driver, json={
            "name": "TEST_Forbidden", "email": _unique_email("test_forbidden"),
            "password": "SenhaForte123", "role": "dispatcher",
        }, timeout=15)
        assert r.status_code == 403


class TestUserUpdateAndReset:
    def test_update_name_and_reset_password(self, h_admin_fcc):
        email = _unique_email("test_upd")
        create = requests.post(f"{API}/users", headers=h_admin_fcc, json={
            "name": "TEST_Update", "email": email, "password": "SenhaForte123", "role": "dispatcher",
        }, timeout=15)
        uid = create.json()["id"]

        upd = requests.patch(f"{API}/users/{uid}", headers=h_admin_fcc, json={"name": "TEST_Renamed"}, timeout=15)
        assert upd.status_code == 200, upd.text
        assert upd.json()["name"] == "TEST_Renamed"

        reset = requests.post(f"{API}/users/{uid}/reset-password", headers=h_admin_fcc,
                              json={"new_password": "NovaSenha456"}, timeout=15)
        assert reset.status_code == 200, reset.text

        old_login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert old_login.status_code == 401
        new_login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "NovaSenha456"}, timeout=15)
        assert new_login.status_code == 200

    def test_disable_blocks_login(self, h_admin_fcc):
        email = _unique_email("test_disable")
        create = requests.post(f"{API}/users", headers=h_admin_fcc, json={
            "name": "TEST_Disable", "email": email, "password": "SenhaForte123", "role": "dispatcher",
        }, timeout=15)
        uid = create.json()["id"]
        requests.patch(f"{API}/users/{uid}", headers=h_admin_fcc, json={"disabled": True}, timeout=15)
        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 401


class TestDriverWithAccount:
    def test_create_driver_with_account_can_login_and_links_correctly(self, h_admin_fcc):
        email = _unique_email("test_driver")
        r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_Driver", "email": email, "password": "SenhaForte123",
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_created"] is True

        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 200, login.text
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {login.json()['access_token']}"}, timeout=15).json()
        assert me["role"] == "driver"
        assert me["driver_id"] == data["id"]

    def test_create_driver_without_account_unchanged(self, h_admin_fcc):
        r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={"name": "TEST_DriverOnly"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user_created"] is False

    def test_disable_driver_blocks_login_but_keeps_data(self, h_admin_fcc):
        email = _unique_email("test_dis_driver")
        create = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_DisableDriver", "email": email, "password": "SenhaForte123",
        }, timeout=15)
        did = create.json()["id"]

        disable = requests.post(f"{API}/drivers/{did}/disable", headers=h_admin_fcc, timeout=15)
        assert disable.status_code == 200, disable.text

        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 401

        still_there = requests.get(f"{API}/drivers/{did}", headers=h_admin_fcc, timeout=15)
        assert still_there.status_code == 200
        assert still_there.json()["employment_status"] == "inativo"

        enable = requests.post(f"{API}/drivers/{did}/enable", headers=h_admin_fcc, timeout=15)
        assert enable.status_code == 200
        relogin = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "SenhaForte123"}, timeout=15)
        assert relogin.status_code == 200

    def test_driver_reset_password(self, h_admin_fcc):
        email = _unique_email("test_reset_driver")
        create = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_ResetDriver", "email": email, "password": "SenhaForte123",
        }, timeout=15)
        did = create.json()["id"]
        reset = requests.post(f"{API}/drivers/{did}/reset-password", headers=h_admin_fcc,
                              json={"new_password": "OutraSenha789"}, timeout=15)
        assert reset.status_code == 200, reset.text
        login = requests.post(f"{API}/auth/login", json={"identifier": email, "password": "OutraSenha789"}, timeout=15)
        assert login.status_code == 200

    def test_driver_can_login_with_employee_number_instead_of_email(self, h_admin_fcc):
        number = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_NumberLogin", "employee_number": number, "password": "SenhaForte123",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user_created"] is True

        login = requests.post(f"{API}/auth/login",
                              json={"identifier": number, "password": "SenhaForte123"}, timeout=15)
        assert login.status_code == 200, login.text
        assert login.json()["user"]["email"] is None
        assert login.json()["user"]["username"] == number.lower()

        # case-insensitive, whitespace-tolerant
        login2 = requests.post(f"{API}/auth/login",
                               json={"identifier": f"  {number.upper()}  ", "password": "SenhaForte123"}, timeout=15)
        assert login2.status_code == 200, login2.text

    def test_driver_without_email_or_number_and_password_rejected(self, h_admin_fcc):
        r = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_NoIdentifier", "password": "SenhaForte123",
        }, timeout=15)
        assert r.status_code == 400
        # no orphan driver left behind
        drivers = requests.get(f"{API}/drivers", headers=h_admin_fcc, timeout=15).json()
        assert not any(d["name"] == "TEST_NoIdentifier" for d in drivers)

    def test_changing_employee_number_updates_login(self, h_admin_fcc):
        number = uuid.uuid4().hex[:6]
        create = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_RenumberDriver", "employee_number": number, "password": "SenhaForte123",
        }, timeout=15)
        did = create.json()["id"]

        new_number = uuid.uuid4().hex[:6]
        upd = requests.patch(f"{API}/drivers/{did}", headers=h_admin_fcc, json={
            "name": "TEST_RenumberDriver", "employee_number": new_number,
        }, timeout=15)
        assert upd.status_code == 200, upd.text

        old_login = requests.post(f"{API}/auth/login",
                                  json={"identifier": number, "password": "SenhaForte123"}, timeout=15)
        assert old_login.status_code == 401
        new_login = requests.post(f"{API}/auth/login",
                                  json={"identifier": new_number, "password": "SenhaForte123"}, timeout=15)
        assert new_login.status_code == 200, new_login.text

    def test_second_user_cannot_link_to_an_already_linked_driver(self, h_admin_fcc):
        create = requests.post(f"{API}/drivers", headers=h_admin_fcc, json={
            "name": "TEST_LinkDriver", "email": _unique_email("test_link1"), "password": "SenhaForte123",
        }, timeout=15)
        did = create.json()["id"]
        r = requests.post(f"{API}/users", headers=h_admin_fcc, json={
            "name": "TEST_SecondUser", "email": _unique_email("test_link2"),
            "password": "SenhaForte123", "role": "driver", "driver_id": did,
        }, timeout=15)
        assert r.status_code == 400
