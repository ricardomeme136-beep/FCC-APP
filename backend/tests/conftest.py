"""Shared fixtures for WasteFlow API tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"
PASSWORD = "WasteFlowTest2026!"

# Fixed QA-fixture accounts created by seed_test_fixtures.py — a permanent,
# test-suite-owned dataset (tag "test_fixture", never "demo") that survives
# cleanup_demo_data.py and is never confused with a real company's data.
ADMIN_EMAIL = "qa-admin@wasteflow-test.internal"
ADMIN_B_EMAIL = "qa-admin-b@wasteflow-test.internal"
DISPATCHER_EMAIL = "qa-dispatcher@wasteflow-test.internal"
DRIVER_EMAIL = "qa-driver@wasteflow-test.internal"
MANAGER_EMAIL = "qa-manager@wasteflow-test.internal"
CUSTOMER_EMAIL = "qa-customer@wasteflow-test.internal"


def _login(identifier, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"identifier": identifier, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def api_base():
    return API


@pytest.fixture(scope="session")
def admin_fcc():
    return _login(ADMIN_EMAIL)


@pytest.fixture(scope="session")
def admin_suma():
    return _login(ADMIN_B_EMAIL)


@pytest.fixture(scope="session")
def driver_fcc():
    return _login(DRIVER_EMAIL)


@pytest.fixture(scope="session")
def customer_fcc():
    return _login(CUSTOMER_EMAIL)


@pytest.fixture(scope="session")
def dispatcher_fcc():
    return _login(DISPATCHER_EMAIL)


def auth_headers(session_login):
    return {"Authorization": f"Bearer {session_login['access_token']}"}


@pytest.fixture
def h_admin_fcc(admin_fcc):
    return auth_headers(admin_fcc)


@pytest.fixture
def h_admin_suma(admin_suma):
    return auth_headers(admin_suma)


@pytest.fixture
def h_driver(driver_fcc):
    return auth_headers(driver_fcc)


@pytest.fixture
def h_customer(customer_fcc):
    return auth_headers(customer_fcc)
