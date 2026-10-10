"""Unit tests for ESP32 hardware proxy endpoints and configuration."""

import pytest
from fastapi.testclient import TestClient
import httpx
import main
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_esp32.sqlite3"
    monkeypatch.setattr(main, "DB_PATH", test_db)
    main._init_db()
    with TestClient(app) as test_client:
        yield test_client


def test_esp32_config_get_and_set(client):
    # Default config
    resp = client.get("/api/esp32/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "esp32_url" in data

    # Update config
    update_resp = client.post("/api/esp32/config", json={"esp32_url": "http://192.168.1.100"})
    assert update_resp.status_code == 200
    assert update_resp.json()["esp32_url"] == "http://192.168.1.100"

    # Verify persistence
    get_resp = client.get("/api/esp32/config")
    assert get_resp.status_code == 200
    assert get_resp.json()["esp32_url"] == "http://192.168.1.100"


def test_esp32_proxy_status_success(client, monkeypatch):
    mock_payload = {
        "device": "esp32-aquawise",
        "connected": True,
        "uptime_ms": 105400,
        "soil_raw": 2340,
        "soil_moisture_percent": 36.2,
        "rain_raw": 3980,
        "rain_detected": False,
        "temperature_c": 28.5,
        "humidity_percent": 64.0,
        "solar_panel_voltage_v": 5.14,
        "recommendation": "WAIT",
        "reason": "Soil moisture is currently adequate.",
        "auto_pump": False,
        "pump_running": False,
        "pump_mode": "MANUAL",
        "dry_count": 0,
        "confirm_samples": 5,
        "cooldown_ready": True,
    }

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url):
            assert url.endswith("/api/status")
            return httpx.Response(200, json=mock_payload)

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    resp = client.get("/api/esp32/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["device"] == "esp32-aquawise"
    assert data["soil_moisture_percent"] == 36.2
    assert data["auto_pump"] is False
    assert data["pump_running"] is False


def test_esp32_proxy_status_offline_handling(client, monkeypatch):
    class MockFailingAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url):
            raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx, "AsyncClient", MockFailingAsyncClient)

    resp = client.get("/api/esp32/status")
    assert resp.status_code == 503
    assert "Unable to connect to ESP32" in resp.json()["detail"]


def test_esp32_proxy_pump_controls(client, monkeypatch):
    commands_called = []

    class MockControlAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url):
            commands_called.append(url)
            if url.endswith("/api/pump/start"):
                return httpx.Response(200, json={"status": "ok", "message": "3s pulse started"})
            elif url.endswith("/api/pump/stop"):
                return httpx.Response(200, json={"status": "ok", "message": "pump stopped"})
            elif url.endswith("/api/auto/toggle"):
                return httpx.Response(200, json={"status": "ok", "auto_pump": True})
            return httpx.Response(404)

    monkeypatch.setattr(httpx, "AsyncClient", MockControlAsyncClient)

    # Test auto toggle
    r1 = client.post("/api/esp32/auto/toggle")
    assert r1.status_code == 200
    assert any("/api/auto/toggle" in cmd for cmd in commands_called)

    # Test pump start
    r2 = client.post("/api/esp32/pump/start")
    assert r2.status_code == 200
    assert any("/api/pump/start" in cmd for cmd in commands_called)

    # Test pump stop
    r3 = client.post("/api/esp32/pump/stop")
    assert r3.status_code == 200
    assert any("/api/pump/stop" in cmd for cmd in commands_called)


def test_esp32_proxy_conflict_error_forwarding(client, monkeypatch):
    class MockConflictAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url):
            return httpx.Response(409, json={"error": "Pump already running"})

    monkeypatch.setattr(httpx, "AsyncClient", MockConflictAsyncClient)

    resp = client.post("/api/esp32/pump/start")
    assert resp.status_code == 409
    assert "Pump already running" in resp.json()["detail"]


def test_esp32_telemetry_stored_and_reflected_in_analytics(client):
    # Submit live sensor data
    tel_resp = client.post(
        "/api/esp32/telemetry",
        json={
            "soil_moisture_percent": 48.5,
            "temperature_c": 29.0,
            "humidity_percent": 55.0,
            "solar_panel_voltage_v": 4.8,
            "rain_detected": False,
        },
    )
    assert tel_resp.status_code == 200
    assert tel_resp.json()["snapshot"]["soil_moisture"] == 48.5

    # Verify field state uses live hardware sensor reading
    field_resp = client.get("/api/field")
    assert field_resp.status_code == 200
    field_data = field_resp.json()
    assert field_data["telemetry"]["soilMoisture"] == 48.5
    assert field_data["telemetry"]["provenance"] == "hardware"

    # Verify analytics graph uses the live sensor moisture for history and forecast
    analytics_resp = client.get("/api/analytics")
    assert analytics_resp.status_code == 200
    analytics_data = analytics_resp.json()
    assert len(analytics_data["history"]) >= 1
    assert analytics_data["history"][-1]["moisturePercent"] == 48.5
    # Forecast starts from live moisture level
    assert len(analytics_data["forecast"]) >= 1
    assert abs(analytics_data["forecast"][0]["moisturePercent"] - 48.5) < 3.0

