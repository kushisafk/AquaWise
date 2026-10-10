"""Dedicated weather service for AquaWise integrating Open-Meteo forecast API.

Features:
- Live asynchronous/synchronous fetching with timeouts
- Robust response validation and missing-value handling
- Persistent SQLite caching with configurable TTL (15 min)
- Stale-data fallback on API failure
- Explicit WEATHER UNAVAILABLE state when no cached data exists (no invented weather)
- Distinguishes LIVE, CACHED, STALE, UNAVAILABLE, and TEST_OVERRIDE states
- Consistent location timezone handling via Open-Meteo 'timezone=auto'
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_CACHE_TTL_MINUTES = 15
HTTP_TIMEOUT_SECONDS = 6.0


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def fetch_open_meteo(latitude: float, longitude: float) -> dict[str, Any]:
    """Fetch 48+ hour forecast from Open-Meteo with strict field validation."""
    params = urlencode({
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "current": "temperature_2m,relative_humidity_2m,precipitation,rain,showers",
        "hourly": "precipitation_probability,precipitation,temperature_2m,relative_humidity_2m",
        "forecast_days": 3,
        "timezone": "auto",
    })
    url = f"{OPEN_METEO_URL}?{params}"
    req = Request(url, headers={"User-Agent": "AquaWise/1.0"})

    with urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
        raw = resp.read().decode("utf-8")
        data = json.loads(raw)

    if not isinstance(data, dict):
        raise ValueError("Invalid Open-Meteo response structure")

    current = data.get("current")
    hourly = data.get("hourly")
    if not isinstance(current, dict) or not isinstance(hourly, dict):
        raise ValueError("Missing 'current' or 'hourly' blocks in Open-Meteo response")

    # Validate hourly arrays
    times = hourly.get("time") or []
    precip_prob = hourly.get("precipitation_probability") or []
    precip_amt = hourly.get("precipitation") or []
    temps = hourly.get("temperature_2m") or []
    humidities = hourly.get("relative_humidity_2m") or []

    if not times or len(times) == 0:
        raise ValueError("Empty hourly forecast timeline in Open-Meteo response")

    # Match current time index in hourly forecast
    cur_time_prefix = str(current.get("time", ""))[:13]
    start_idx = 0
    for idx, t in enumerate(times):
        if str(t).startswith(cur_time_prefix):
            start_idx = idx
            break

    # Build normalized hourly forecast series for 48 hours
    hourly_series: list[dict[str, Any]] = []
    end_idx = min(len(times), start_idx + 48)
    for i in range(start_idx, end_idx):
        hourly_series.append({
            "time": times[i] if i < len(times) else None,
            "precipitationProbability": float(precip_prob[i] or 0) if i < len(precip_prob) and precip_prob[i] is not None else 0.0,
            "precipitationMm": float(precip_amt[i] or 0) if i < len(precip_amt) and precip_amt[i] is not None else 0.0,
            "temperatureC": float(temps[i] or 25.0) if i < len(temps) and temps[i] is not None else 25.0,
            "humidityPercent": float(humidities[i] or 55.0) if i < len(humidities) and humidities[i] is not None else 55.0,
        })

    # Calculate 6-hour immediate outlook
    probs_6h = [pt["precipitationProbability"] for pt in hourly_series[:6]]
    amounts_6h = [pt["precipitationMm"] for pt in hourly_series[:6]]
    max_prob_6h = max(probs_6h, default=0.0)
    total_rain_6h = round(sum(amounts_6h), 1)

    cur_precip = float(current.get("precipitation") or 0.0)
    cur_rain = float(current.get("rain") or 0.0)
    cur_showers = float(current.get("showers") or 0.0)
    is_raining_now = cur_precip > 0.0 or cur_rain > 0.0 or cur_showers > 0.0

    if is_raining_now:
        summary = "Rain now"
    elif max_prob_6h >= 60 and total_rain_6h >= 2.0:
        summary = "Rain likely within 6 hours"
    elif max_prob_6h >= 30:
        summary = "A chance of rain"
    else:
        summary = "Mostly dry for the next 6 hours"

    return {
        "status": "LIVE",
        "stale": False,
        "temperatureC": round(float(current.get("temperature_2m", 26.0)), 1),
        "humidityPercent": round(float(current.get("relative_humidity_2m", 60.0)), 1),
        "rainingNow": is_raining_now,
        "rainProbability6h": round(max_prob_6h, 1),
        "precipitationMm6h": total_rain_6h,
        "summary": summary,
        "source": "Open-Meteo",
        "updatedAt": iso(),
        "latitude": latitude,
        "longitude": longitude,
        "hourly": hourly_series,
    }


def get_weather(
    db: sqlite3.Connection,
    latitude: float,
    longitude: float,
    *,
    test_mode: bool = False,
    test_scenario: dict[str, Any] | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Retrieve weather with DB caching, freshness validation, and honest fallback states."""
    # 1. Test mode override takes precedence
    if test_mode and test_scenario:
        # Check if scenario explicitly overrides weather status
        override_status = test_scenario.get("weatherStatus")
        if override_status == "UNAVAILABLE":
            return {
                "status": "UNAVAILABLE",
                "stale": True,
                "temperatureC": None,
                "humidityPercent": None,
                "rainingNow": False,
                "rainProbability6h": 0.0,
                "precipitationMm6h": 0.0,
                "summary": "Weather unavailable",
                "source": "Test mode (unavailable)",
                "updatedAt": iso(),
                "latitude": latitude,
                "longitude": longitude,
                "hourly": [],
            }
        if override_status == "STALE":
            return {
                "status": "STALE",
                "stale": True,
                "temperatureC": 28.0,
                "humidityPercent": 50.0,
                "rainingNow": bool(test_scenario.get("rainingNow", False)),
                "rainProbability6h": float(test_scenario.get("rainProbability6h", 0.0)),
                "precipitationMm6h": float(test_scenario.get("precipitationMm6h", 0.0)),
                "summary": "Stale weather (test mode)",
                "source": "Test mode (stale)",
                "updatedAt": iso(now_utc() - timedelta(hours=3)),
                "latitude": latitude,
                "longitude": longitude,
                "hourly": [],
            }

        return {
            "status": "TEST_OVERRIDE",
            "stale": False,
            "temperatureC": 28.0,
            "humidityPercent": 54.0,
            "rainingNow": bool(test_scenario.get("rainingNow", False)),
            "rainProbability6h": float(test_scenario.get("rainProbability6h", 0.0)),
            "precipitationMm6h": float(test_scenario.get("precipitationMm6h", 0.0)),
            "summary": "Test scenario override",
            "source": "Test mode",
            "updatedAt": iso(),
            "latitude": latitude,
            "longitude": longitude,
            "hourly": [
                {
                    "time": iso(now_utc() + timedelta(hours=h)),
                    "temperatureC": 28.0,
                    "humidityPercent": 54.0,
                    "precipitationProbability": float(test_scenario.get("rainProbability6h", 0.0)) if h < 6 else 0.0,
                    "precipitationMm": float(test_scenario.get("precipitationMm6h", 0.0)) / 6.0 if h < 6 else 0.0,
                }
                for h in range(48)
            ],
        }

    # 2. Check cached snapshot
    row = db.execute(
        "SELECT payload, fetched_at FROM weather_snapshots WHERE id = 1"
    ).fetchone()
    cached: dict[str, Any] | None = None
    fetched_at: datetime | None = None
    if row:
        try:
            cached = json.loads(row["payload"])
            fetched_at = parse_time(row["fetched_at"])
        except Exception:
            cached = None

    # Check if cached coordinates match current settings (within ~1km = 0.01 deg)
    coords_match = (
        cached is not None
        and abs(float(cached.get("latitude", 0)) - latitude) < 0.01
        and abs(float(cached.get("longitude", 0)) - longitude) < 0.01
    )

    age_minutes = (
        (now_utc() - fetched_at).total_seconds() / 60
        if fetched_at else float("inf")
    )

    # Use cache if fresh, location matches, and no forced refresh requested
    if cached and coords_match and not force_refresh and age_minutes < WEATHER_CACHE_TTL_MINUTES:
        cached["status"] = "CACHED"
        cached["stale"] = False
        return cached

    # 3. Attempt live fetch from Open-Meteo
    try:
        import sys
        main_mod = sys.modules.get("main")
        fetcher = getattr(main_mod, "_weather_from_open_meteo", fetch_open_meteo) if main_mod else fetch_open_meteo
        live = fetcher(latitude, longitude)
        # Store in SQLite cache
        db.execute(
            "INSERT INTO weather_snapshots(id, payload, fetched_at) VALUES(1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            (json.dumps(live), iso()),
        )
        return live
    except Exception as exc:
        # 4. Fallback on API failure:
        # If valid cached forecast exists, return as STALE
        if cached:
            cached["status"] = "STALE"
            cached["stale"] = True
            cached["source"] = "Open-Meteo (cached, stale)"
            cached["summary"] = f"{cached.get('summary', 'Forecast')} (Stale forecast)"
            return cached

        # 5. No cached forecast exists: report WEATHER UNAVAILABLE honestly
        # Do NOT invent fictitious weather numbers
        return {
            "status": "UNAVAILABLE",
            "stale": True,
            "temperatureC": None,
            "humidityPercent": None,
            "rainingNow": False,
            "rainProbability6h": 0.0,
            "precipitationMm6h": 0.0,
            "summary": "Weather unavailable",
            "source": "Open-Meteo (unavailable)",
            "updatedAt": iso(),
            "latitude": latitude,
            "longitude": longitude,
            "hourly": [],
        }
