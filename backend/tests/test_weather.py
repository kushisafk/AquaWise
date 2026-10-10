"""Automated unit and integration tests for Open-Meteo weather service."""

import json
import sqlite3
import pytest
from datetime import datetime, timedelta, timezone

import weather
from weather import fetch_open_meteo, get_weather, iso, now_utc


@pytest.fixture
def test_db(tmp_path):
    db_file = tmp_path / "weather_test.sqlite3"
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS weather_snapshots (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )
    """)
    conn.commit()
    yield conn
    conn.close()


def sample_open_meteo_raw():
    now_str = iso()[:13] + ":00"
    times = [
        (now_utc() + timedelta(hours=i)).isoformat(timespec="hours")
        for i in range(72)
    ]
    return {
        "current": {
            "time": now_str,
            "temperature_2m": 29.4,
            "relative_humidity_2m": 58.0,
            "precipitation": 0.0,
            "rain": 0.0,
            "showers": 0.0,
        },
        "hourly": {
            "time": times,
            "temperature_2m": [29.0 + (i % 5) for i in range(72)],
            "relative_humidity_2m": [58.0 - (i % 10) for i in range(72)],
            "precipitation_probability": [15.0 if i > 12 else 0.0 for i in range(72)],
            "precipitation": [2.5 if i == 14 else 0.0 for i in range(72)],
        },
    }


def test_weather_fetch_and_validation(monkeypatch):
    raw = sample_open_meteo_raw()

    class MockResponse:
        def read(self):
            return json.dumps(raw).encode("utf-8")
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr(weather, "urlopen", lambda req, timeout=5.0: MockResponse())

    result = fetch_open_meteo(16.5062, 80.6480)
    assert result["status"] == "LIVE"
    assert result["stale"] is False
    assert result["temperatureC"] == 29.4
    assert result["humidityPercent"] == 58.0
    assert result["rainingNow"] is False
    assert len(result["hourly"]) == 48
    assert result["source"] == "Open-Meteo"


def test_weather_missing_fields_validation(monkeypatch):
    class BadResponse:
        def read(self):
            return json.dumps({"current": {}}).encode("utf-8")
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr(weather, "urlopen", lambda req, timeout=5.0: BadResponse())
    with pytest.raises(ValueError):
        fetch_open_meteo(16.5062, 80.6480)


def test_weather_cache_reuse(test_db, monkeypatch):
    raw = sample_open_meteo_raw()
    call_count = [0]

    class MockResponse:
        def read(self):
            call_count[0] += 1
            return json.dumps(raw).encode("utf-8")
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr(weather, "urlopen", lambda req, timeout=5.0: MockResponse())

    # First call: hits API and caches
    w1 = get_weather(test_db, 16.5062, 80.6480)
    assert w1["status"] == "LIVE"
    assert call_count[0] == 1

    # Second call within TTL: served from DB cache without calling API
    w2 = get_weather(test_db, 16.5062, 80.6480)
    assert w2["status"] == "CACHED"
    assert w2["stale"] is False
    assert call_count[0] == 1


def test_weather_stale_on_api_failure(test_db, monkeypatch):
    # Prime cache with an existing forecast
    cached_payload = {
        "status": "LIVE",
        "stale": False,
        "temperatureC": 30.0,
        "humidityPercent": 60.0,
        "rainingNow": False,
        "rainProbability6h": 10.0,
        "precipitationMm6h": 0.0,
        "summary": "Clear",
        "source": "Open-Meteo",
        "latitude": 16.5062,
        "longitude": 80.6480,
        "hourly": [],
    }
    test_db.execute(
        "INSERT INTO weather_snapshots(id, payload, fetched_at) VALUES (1, ?, ?)",
        (json.dumps(cached_payload), iso(now_utc() - timedelta(minutes=30))),
    )
    test_db.commit()

    # Simulate API network outage
    def fail_urlopen(req, timeout=5.0):
        raise OSError("Connection timed out")

    monkeypatch.setattr(weather, "urlopen", fail_urlopen)

    # Cache is older than TTL, API fails -> must return cached data marked as STALE
    w = get_weather(test_db, 16.5062, 80.6480)
    assert w["status"] == "STALE"
    assert w["stale"] is True
    assert w["temperatureC"] == 30.0
    assert "stale" in w["source"].lower() or "cached" in w["source"].lower()


def test_weather_unavailable_when_no_cache_and_api_fails(test_db, monkeypatch):
    # Ensure database is empty (no cache)
    test_db.execute("DELETE FROM weather_snapshots")
    test_db.commit()

    def fail_urlopen(req, timeout=5.0):
        raise OSError("Network unreachable")

    monkeypatch.setattr(weather, "urlopen", fail_urlopen)

    # Must report WEATHER UNAVAILABLE honestly without fabricating numbers
    w = get_weather(test_db, 16.5062, 80.6480)
    assert w["status"] == "UNAVAILABLE"
    assert w["stale"] is True
    assert w["temperatureC"] is None
    assert w["humidityPercent"] is None
    assert "unavailable" in w["summary"].lower()


def test_weather_location_change_triggers_refresh(test_db, monkeypatch):
    raw1 = sample_open_meteo_raw()
    raw2 = sample_open_meteo_raw()
    raw2["current"]["temperature_2m"] = 22.0

    call_count = [0]
    def mock_urlopen(req, timeout=5.0):
        call_count[0] += 1
        data = raw1 if "16.5062" in req.full_url else raw2
        class MockResp:
            def read(self):
                return json.dumps(data).encode("utf-8")
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        return MockResp()

    monkeypatch.setattr(weather, "urlopen", mock_urlopen)

    # Fetch for Vijayawada (16.5062, 80.6480)
    w1 = get_weather(test_db, 16.5062, 80.6480)
    assert w1["temperatureC"] == 29.4
    assert call_count[0] == 1

    # Changing coordinates to Bengaluru (12.9716, 77.5946) must refresh
    w2 = get_weather(test_db, 12.9716, 77.5946)
    assert w2["temperatureC"] == 22.0
    assert call_count[0] == 2
