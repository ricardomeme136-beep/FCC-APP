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
PASSWORD = "WasteFlow2026!"


def _login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def api_base():
    return API


@pytest.fixture(scope="session")
def admin_fcc():
    return _login("admin@wasteflow.pt")


@pytest.fixture(scope="session")
def admin_suma():
    return _login("admin@suma.pt")


@pytest.fixture(scope="session")
def driver_fcc():
    return _login("motorista@wasteflow.pt")


@pytest.fixture(scope="session")
def customer_fcc():
    return _login("cliente@wasteflow.pt")


@pytest.fixture(scope="session")
def dispatcher_fcc():
    return _login("despachante@wasteflow.pt")


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
