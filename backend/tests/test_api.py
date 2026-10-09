import main
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "aquawise-test.sqlite3")
    monkeypatch.setattr(
        main,
        "_weather_from_open_meteo",
        lambda _lat, _lon: {
            "temperatureC": 27.0,
            "humidityPercent": 55.0,
            "rainingNow": False,
            "rainProbability6h": 0.0,
            "precipitationMm6h": 0.0,
            "summary": "Clear test weather",
            "source": "Open-Meteo (test stub)",
            "stale": False,
            "updatedAt": main.iso(),
        },
    )
    with TestClient(main.app) as test_client:
        yield test_client


def settings_payload(client, **changes):
    values = client.get("/api/settings").json()
    values.update(changes)
    return values


def test_api_health_field_and_weather(client):
    assert client.get("/api/healthz").json() == {"status": "ok"}
    field = client.get("/api/field").json()
    assert field["recommendation"]["status"] in ("WATER NOW", "WAIT", "CHECK FIELD")
    assert field["telemetry"]["provenance"] == "simulated"
    assert field["weather"]["source"].startswith("Open-Meteo")


def test_manual_irrigation_obeys_saved_max_duration_and_can_stop(client):
    response = client.put(
        "/api/settings",
        json=settings_payload(client, maxDurationMinutes=10),
    )
    assert response.status_code == 200
    started = client.post("/api/irrigation/start", json={"durationMinutes": 35})
    assert started.status_code == 200
    assert started.json()["active"] is True
    assert started.json()["durationMinutes"] == 10
    stopped = client.post("/api/irrigation/stop").json()
    assert stopped["active"] is False
    assert client.get("/api/history?category=irrigation").json()


def test_auto_mode_starts_only_for_real_engine_water_recommendation(client):
    client.put(
        "/api/settings",
        json=settings_payload(client, controlMode="auto"),
    )
    field = client.post(
        "/api/test-scenario",
        json={
            "soilMoisture": 10,
            "rainingNow": False,
            "rainProbability6h": 0,
            "precipitationMm6h": 0,
            "sensorFault": False,
        },
    ).json()
    assert field["recommendation"]["status"] == "WATER NOW"
    assert field["irrigation"]["active"] is True
    assert field["irrigation"]["source"] == "automatic"


def test_auto_session_stops_when_calibrated_target_is_reached(client):
    client.put(
        "/api/settings",
        json=settings_payload(client, controlMode="auto"),
    )
    started = client.post(
        "/api/test-scenario",
        json={
            "soilMoisture": 10,
            "rainingNow": False,
            "rainProbability6h": 0,
            "precipitationMm6h": 0,
            "sensorFault": False,
        },
    ).json()
    assert started["irrigation"]["active"] is True
    stopped = client.post(
        "/api/test-scenario",
        json={
            "soilMoisture": 70,
            "rainingNow": False,
            "rainProbability6h": 0,
            "precipitationMm6h": 0,
            "sensorFault": False,
        },
    ).json()
    assert stopped["irrigation"]["active"] is False


def test_auto_session_manual_stop_respects_override_and_does_not_immediately_restart(client):
    client.put(
        "/api/settings",
        json=settings_payload(client, controlMode="auto"),
    )
    started = client.post(
        "/api/test-scenario",
        json={
            "soilMoisture": 10,
            "rainingNow": False,
            "rainProbability6h": 0,
            "precipitationMm6h": 0,
            "sensorFault": False,
        },
    ).json()
    assert started["irrigation"]["active"] is True
    assert started["irrigation"]["source"] == "automatic"

    # Farmer manually clicks "Stop Watering"
    stopped = client.post("/api/irrigation/stop").json()
    assert stopped["active"] is False

    # Immediate subsequent check of field state must NOT auto-restart
    field = client.get("/api/field").json()
    assert field["irrigation"]["active"] is False

    # Manual start clears the override
    manual_started = client.post("/api/irrigation/start", json={"durationMinutes": 10}).json()
    assert manual_started["active"] is True
    assert manual_started["source"] == "manual"



def test_sensor_fault_uses_recent_estimate_and_missing_history_checks_field(client):
    first = client.get("/api/field").json()
    assert first["telemetry"]["soilMoisture"] is not None
    scenario = {
        "soilMoisture": None,
        "rainingNow": False,
        "rainProbability6h": 0,
        "precipitationMm6h": 0,
        "sensorFault": True,
    }
    estimated = client.post("/api/test-scenario", json=scenario).json()
    assert estimated["telemetry"]["provenance"] == "estimated"
    assert estimated["telemetry"]["soilMoisture"] is not None
    with main.connect_db() as db:
        db.execute("DELETE FROM telemetry")
    missing = client.get("/api/field").json()
    assert missing["recommendation"]["status"] == "CHECK FIELD"
    assert missing["telemetry"]["soilMoisture"] is None


def test_settings_calibration_history_and_feedback_persist(client):
    updated = settings_payload(client, language="hi")
    client.put("/api/settings", json=updated)
    assert client.get("/api/settings").json()["language"] == "hi"
    calibration = client.put(
        "/api/calibration", json={"dryPoint": 15, "wetPoint": 75},
    ).json()
    assert calibration["lowThreshold"] == 30
    assert calibration["targetMoisture"] == 57
    assert client.post(
        "/api/feedback", json={"helpful": True, "comment": "Clear and useful"},
    ).status_code == 201
    assert client.get("/api/history?category=feedback").json()[0]["category"] == "feedback"


def test_notification_acknowledgement(client):
    client.post(
        "/api/test-scenario",
        json={
            "soilMoisture": 10,
            "rainingNow": False,
            "rainProbability6h": 0,
            "precipitationMm6h": 0,
            "sensorFault": False,
        },
    )
    notifications = client.get("/api/notifications").json()
    assert notifications
    notification_id = notifications[0]["id"]
    result = client.post(f"/api/notifications/{notification_id}/acknowledge")
    assert result.status_code == 200
    assert result.json()["acknowledged"] is True
