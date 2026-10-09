"""AquaWise API: simulated field state, decision support and persisted controls."""

from __future__ import annotations

import asyncio
import json
import math
import os
import sqlite3
import threading
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from engine import calculate_recommendation, thresholds
from forecasting import forecast_points, strategy_comparison

API_PREFIX = "/api"
DB_PATH = Path(os.environ.get(
    "AQUAWISE_DB_PATH",
    str(Path(__file__).resolve().parent / "aquawise.sqlite3"),
))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DB_LOCK = threading.RLock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    with DB_LOCK, connect_db() as db:
        _cleanup_duplicate_history(db)
        try:
            info = forecast_points(34, 27, 58, 65, 0, 0)
            exists = db.execute("SELECT 1 FROM history WHERE title = 'Forecast model ready'").fetchone()
            if not exists:
                add_history(
                    db, "alert", "Forecast model ready",
                    f"{info[1]} based on synthetic data and transparent simulator assumptions.",
                    "system",
                )
        except Exception:
            pass
    yield


app = FastAPI(
    title="AquaWise API",
    description="Software-only irrigation decision support. Field readings and irrigation are simulated.",
    version="1.0.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    lifespan=lifespan,
)

DEFAULT_SETTINGS = {
    "language": "en",
    "controlMode": "advisory",
    "notificationsEnabled": True,
    "quietHoursStart": "21:00",
    "quietHoursEnd": "06:00",
    "maxDurationMinutes": 45,
    "flowLitresPerMinute": 12.0,
    "testMode": False,
    "latitude": 16.5062,
    "longitude": 80.6480,
}
DEFAULT_CALIBRATION = {"dryPoint": 20.0, "wetPoint": 70.0}
DEFAULT_SIMULATION = {
    "moisture": 34.0,
    "lastUpdated": None,
    "sensorFault": False,
}


class SettingsInput(BaseModel):
    language: Literal["en", "te", "hi"]
    controlMode: Literal["advisory", "auto"]
    notificationsEnabled: bool
    quietHoursStart: str = Field(pattern=r"^\d{2}:\d{2}$")
    quietHoursEnd: str = Field(pattern=r"^\d{2}:\d{2}$")
    maxDurationMinutes: int = Field(ge=1, le=240)
    flowLitresPerMinute: float = Field(ge=0.1, le=100)
    testMode: bool
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class CalibrationInput(BaseModel):
    dryPoint: float = Field(ge=0, le=100)
    wetPoint: float = Field(ge=0, le=100)


class IrrigationStartInput(BaseModel):
    durationMinutes: int = Field(ge=1, le=240)


class TestScenarioInput(BaseModel):
    soilMoisture: float | None = Field(ge=0, le=100)
    rainingNow: bool
    rainProbability6h: float = Field(ge=0, le=100)
    precipitationMm6h: float = Field(ge=0, le=200)
    sensorFault: bool


class FeedbackInput(BaseModel):
    helpful: bool
    comment: str = Field(max_length=1000)


@contextmanager
def connect_db():
    connection = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _init_db() -> None:
    with DB_LOCK, connect_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS app_values (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                soil_moisture REAL,
                temperature_c REAL NOT NULL,
                humidity_percent REAL NOT NULL,
                sunlight_percent REAL NOT NULL,
                raining_now INTEGER NOT NULL,
                sensor_fault INTEGER NOT NULL,
                provenance TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS weather_snapshots (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS irrigation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                active INTEGER NOT NULL,
                source TEXT NOT NULL,
                started_at TEXT,
                ends_at TEXT,
                duration_minutes INTEGER NOT NULL,
                stopped_at TEXT
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                detail TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS calibration (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                dry_point REAL NOT NULL,
                wet_point REAL NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                helpful INTEGER NOT NULL,
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS model_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL,
                training_data TEXT NOT NULL,
                evaluated_at TEXT NOT NULL,
                validation_mae REAL
            );
        """)
        for key, value in DEFAULT_SETTINGS.items():
            db.execute(
                "INSERT OR IGNORE INTO app_values(key, value) VALUES (?, ?)",
                (f"setting:{key}", json.dumps(value)),
            )
        db.execute(
            "INSERT OR IGNORE INTO app_values(key, value) VALUES ('simulation', ?)",
            (json.dumps({**DEFAULT_SIMULATION, "lastUpdated": iso()}),),
        )
        db.execute(
            "INSERT OR IGNORE INTO calibration(id, dry_point, wet_point, updated_at) VALUES (1, ?, ?, ?)",
            (DEFAULT_CALIBRATION["dryPoint"], DEFAULT_CALIBRATION["wetPoint"], iso()),
        )
        db.execute(
            "INSERT OR IGNORE INTO app_values(key, value) VALUES ('test_scenario', 'null')"
        )


def get_value(db: sqlite3.Connection, key: str, default=None):
    row = db.execute("SELECT value FROM app_values WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_value(db: sqlite3.Connection, key: str, value) -> None:
    db.execute(
        "INSERT INTO app_values(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def read_settings(db: sqlite3.Connection) -> dict:
    return {
        key: get_value(db, f"setting:{key}", fallback)
        for key, fallback in DEFAULT_SETTINGS.items()
    }


def read_calibration(db: sqlite3.Connection) -> dict:
    row = db.execute(
        "SELECT dry_point, wet_point, updated_at FROM calibration WHERE id = 1"
    ).fetchone()
    dry, wet = float(row["dry_point"]), float(row["wet_point"])
    low, target = thresholds(dry, wet)
    return {
        "dryPoint": dry,
        "wetPoint": wet,
        "updatedAt": row["updated_at"],
        "lowThreshold": low,
        "targetMoisture": target,
    }


def _cleanup_duplicate_history(db: sqlite3.Connection) -> None:
    """Safely deduplicate routine simulated readings while preserving real events."""
    db.execute("""
        DELETE FROM history
        WHERE category = 'reading'
        AND id NOT IN (
            SELECT MIN(id) FROM history
            WHERE category = 'reading'
            GROUP BY strftime('%Y-%m-%d %H', created_at)
        )
    """)


def add_history(
    db: sqlite3.Connection,
    category: str,
    title: str,
    detail: str,
    source: str = "system",
) -> int:
    cursor = db.execute(
        "INSERT INTO history(category, title, detail, source, created_at) VALUES (?, ?, ?, ?, ?)",
        (category, title, detail, source, iso()),
    )
    return int(cursor.lastrowid)


def add_notification(db: sqlite3.Connection, title: str, detail: str) -> None:
    exists = db.execute(
        "SELECT 1 FROM notifications WHERE title = ? AND detail = ? AND created_at > ?",
        (title, detail, iso(now_utc() - timedelta(hours=2))),
    ).fetchone()
    if not exists:
        db.execute(
            "INSERT INTO notifications(title, detail, acknowledged, created_at) VALUES (?, ?, 0, ?)",
            (title, detail, iso()),
        )


def session_dict(db: sqlite3.Connection) -> dict:
    row = db.execute(
        "SELECT * FROM irrigation_sessions ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        return {
            "active": False,
            "source": "manual",
            "startedAt": None,
            "endsAt": None,
            "durationMinutes": 0,
        }
    return {
        "active": bool(row["active"]),
        "source": row["source"],
        "startedAt": row["started_at"],
        "endsAt": row["ends_at"],
        "durationMinutes": int(row["duration_minutes"]),
    }


def _stop_session(db: sqlite3.Connection, row: sqlite3.Row, reason: str) -> None:
    if not row["active"]:
        return
    db.execute(
        "UPDATE irrigation_sessions SET active = 0, stopped_at = ? WHERE id = ?",
        (iso(), row["id"]),
    )
    add_history(
        db, "irrigation", "Simulated watering stopped",
        f"{row['source'].title()} session stopped: {reason}. No physical equipment is connected.",
        row["source"],
    )
    add_notification(db, "Simulated watering stopped", reason)


def _weather_from_open_meteo(latitude: float, longitude: float) -> dict:
    params = urlencode({
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,precipitation,rain,showers",
        "hourly": "precipitation_probability,precipitation,temperature_2m",
        "forecast_days": 2,
        "timezone": "auto",
    })
    request = Request(
        f"https://api.open-meteo.com/v1/forecast?{params}",
        headers={"User-Agent": "AquaWise/1.0"},
    )
    with urlopen(request, timeout=5) as response:
        data = json.loads(response.read().decode("utf-8"))
    current = data["current"]
    hourly = data["hourly"]
    current_time = str(current.get("time", ""))[:13]
    start_index = next(
        (i for i, value in enumerate(hourly.get("time", []))
         if str(value).startswith(current_time)),
        0,
    )
    probs = hourly.get("precipitation_probability", [])[start_index:start_index + 6]
    amounts = hourly.get("precipitation", [])[start_index:start_index + 6]
    probability = max((float(value or 0) for value in probs), default=0.0)
    rainfall = sum(float(value or 0) for value in amounts)
    raining = (
        float(current.get("precipitation", 0) or 0) > 0
        or float(current.get("rain", 0) or 0) > 0
        or float(current.get("showers", 0) or 0) > 0
    )
    if raining:
        summary = "Rain now"
    elif probability >= 60 and rainfall >= 2:
        summary = "Rain likely within 6 hours"
    elif probability >= 30:
        summary = "A chance of rain"
    else:
        summary = "Mostly dry for the next 6 hours"
    return {
        "temperatureC": float(current.get("temperature_2m", 26)),
        "humidityPercent": float(current.get("relative_humidity_2m", 60)),
        "rainingNow": raining,
        "rainProbability6h": probability,
        "precipitationMm6h": rainfall,
        "summary": summary,
        "source": "Open-Meteo",
        "stale": False,
        "updatedAt": iso(),
    }


def get_weather(db: sqlite3.Connection, settings: dict) -> dict:
    scenario = get_value(db, "test_scenario")
    if settings["testMode"] and scenario:
        return {
            "temperatureC": 28.0,
            "humidityPercent": 54.0,
            "rainingNow": scenario["rainingNow"],
            "rainProbability6h": scenario["rainProbability6h"],
            "precipitationMm6h": scenario["precipitationMm6h"],
            "summary": "Test scenario override",
            "source": "Test mode",
            "stale": False,
            "updatedAt": iso(),
        }

    row = db.execute("SELECT payload, fetched_at FROM weather_snapshots WHERE id = 1").fetchone()
    fetched_at = parse_time(row["fetched_at"]) if row else None
    if fetched_at and now_utc() - fetched_at < timedelta(minutes=15):
        cached = json.loads(row["payload"])
        cached["stale"] = False
        return cached

    try:
        weather = _weather_from_open_meteo(settings["latitude"], settings["longitude"])
        db.execute(
            "INSERT INTO weather_snapshots(id, payload, fetched_at) VALUES(1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            (json.dumps(weather), iso()),
        )
        return weather
    except Exception:
        if row:
            cached = json.loads(row["payload"])
            cached["stale"] = True
            cached["source"] = "Open-Meteo cached forecast"
            return cached
        return {
            "temperatureC": 27.0,
            "humidityPercent": 58.0,
            "rainingNow": False,
            "rainProbability6h": 0.0,
            "precipitationMm6h": 0.0,
            "summary": "Weather unavailable; using a labelled local simulation",
            "source": "Simulated fallback",
            "stale": True,
            "updatedAt": iso(),
        }


def _effective_moisture(
    db: sqlite3.Connection,
    simulation: dict,
    weather: dict,
    calibration: dict,
) -> tuple[float | None, str, bool]:
    scenario = get_value(db, "test_scenario")
    fault = bool(scenario and scenario.get("sensorFault"))
    if scenario and scenario.get("soilMoisture") is not None:
        moisture = float(scenario["soilMoisture"])
        return moisture, "simulated", fault
    if not fault:
        return float(simulation["moisture"]), "simulated", False

    last = db.execute(
        "SELECT soil_moisture, created_at FROM telemetry "
        "WHERE soil_moisture IS NOT NULL AND provenance = 'simulated' "
        "ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not last:
        return None, "stale", True
    last_time = parse_time(last["created_at"])
    age_hours = (now_utc() - last_time).total_seconds() / 3600 if last_time else math.inf
    if age_hours > 6:
        return None, "stale", True
    # Estimate from the last sound reading and the current simulated drying conditions.
    dry_rate = max(
        0.02,
        0.06 + max(0, weather["temperatureC"] - 20) * 0.004
        + 55 * 0.0012 - weather["humidityPercent"] * 0.0008,
    )
    estimate = max(0.0, float(last["soil_moisture"]) - age_hours * dry_rate)
    return round(estimate, 1), "estimated", True


def _field_state(db: sqlite3.Connection) -> dict:
    settings = read_settings(db)
    calibration = read_calibration(db)
    simulation = get_value(db, "simulation", DEFAULT_SIMULATION.copy())
    weather = get_weather(db, settings)
    current = now_utc()
    last_updated = parse_time(simulation.get("lastUpdated"))
    elapsed_minutes = min(
        120.0,
        max(0.0, (current - last_updated).total_seconds() / 60)
        if last_updated else 0.0,
    )
    moisture = float(simulation.get("moisture", 34))
    active = db.execute(
        "SELECT * FROM irrigation_sessions WHERE active = 1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    evaporation = max(
        0.02,
        0.06 + max(0, weather["temperatureC"] - 20) * 0.004
        + 55 * 0.0012 - weather["humidityPercent"] * 0.0008,
    )
    moisture -= evaporation * elapsed_minutes
    if weather["rainingNow"]:
        moisture += min(0.8, elapsed_minutes * 0.015)

    if active:
        end = parse_time(active["ends_at"])
        max_elapsed = (
            max(0.0, (current - parse_time(active["started_at"])).total_seconds() / 60)
            if parse_time(active["started_at"]) else 0.0
        )
        run_minutes = min(elapsed_minutes, max_elapsed, active["duration_minutes"])
        moisture += run_minutes * 0.32
        stop_reason = None
        if active["source"] == "automatic" and weather["rainingNow"]:
            stop_reason = "Rain started"
        elif moisture >= calibration["targetMoisture"]:
            stop_reason = "Target moisture reached"
        elif end and current >= end:
            stop_reason = "Maximum watering duration reached"
            set_value(db, "auto_override_until", iso(current + timedelta(hours=1)))
        if stop_reason:
            _stop_session(db, active, stop_reason)
            active = None
    moisture = round(max(0.0, min(100.0, moisture)), 1)
    simulation["moisture"] = moisture
    simulation["lastUpdated"] = iso(current)
    set_value(db, "simulation", simulation)

    scenario = get_value(db, "test_scenario")
    if scenario and scenario.get("rainingNow") is not None:
        weather = {**weather, "rainingNow": bool(scenario["rainingNow"])}
    measured_moisture, provenance, fault = _effective_moisture(
        db, simulation, weather, calibration,
    )
    sunlight = round(max(5.0, min(100.0, 76 - (weather["humidityPercent"] - 50) * 0.4)), 1)
    future_moisture = max(
        0,
        (measured_moisture if measured_moisture is not None else moisture)
        - evaporation * 360
        + min(15, weather["precipitationMm6h"] * 0.75),
    )
    recommendation = calculate_recommendation(
        moisture=measured_moisture,
        dry_point=calibration["dryPoint"],
        wet_point=calibration["wetPoint"],
        raining_now=weather["rainingNow"],
        rain_probability_6h=weather["rainProbability6h"],
        precipitation_mm_6h=weather["precipitationMm6h"],
        forecast_stale=weather["stale"],
        estimated=provenance == "estimated",
        temperature_c=weather["temperatureC"],
        humidity_percent=weather["humidityPercent"],
        sunlight_percent=sunlight,
        max_duration_minutes=settings["maxDurationMinutes"],
        forecast_moisture_6h=future_moisture,
        language=settings["language"],
    )
    recommendation["updatedAt"] = iso(current)
    session = session_dict(db)

    last_telemetry = db.execute(
        "SELECT created_at FROM telemetry ORDER BY id DESC LIMIT 1"
    ).fetchone()
    last_telemetry_at = parse_time(last_telemetry["created_at"]) if last_telemetry else None
    if not last_telemetry_at or current - last_telemetry_at >= timedelta(minutes=1):
        db.execute(
            "INSERT INTO telemetry(soil_moisture, temperature_c, humidity_percent, "
            "sunlight_percent, raining_now, sensor_fault, provenance, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                measured_moisture, weather["temperatureC"], weather["humidityPercent"],
                sunlight, int(weather["rainingNow"]), int(fault), provenance, iso(current),
            ),
        )
        last_reading = db.execute(
            "SELECT created_at FROM history WHERE category = 'reading' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        last_reading_at = parse_time(last_reading["created_at"]) if last_reading else None
        if not last_reading_at or current - last_reading_at >= timedelta(hours=6):
            add_history(
                db, "reading", "Simulated field reading",
                f"Soil moisture {measured_moisture if measured_moisture is not None else 'unavailable'}%; "
                f"temperature {weather['temperatureC']:.1f}°C; humidity {weather['humidityPercent']:.0f}%.",
                provenance,
            )
    last_decision = db.execute(
        "SELECT title, detail, created_at FROM history WHERE category = 'recommendation' "
        "ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not last_decision or last_decision["title"] != recommendation["status"]:
        add_history(
            db, "recommendation", recommendation["status"], recommendation["reason"],
            recommendation["provenance"],
        )
        if recommendation["status"] == "WATER NOW":
            add_notification(db, "Watering recommended", recommendation["reason"])
    if weather["stale"]:
        add_notification(db, "Weather data is stale", "Open-Meteo is unavailable or the cached forecast is old.")
    if fault:
        add_notification(db, "Simulated sensor fault", "Check the field reading; any displayed estimate is labelled.")

    # Automatic control remains software-only and obeys the same max-duration limit.
    override_until = parse_time(get_value(db, "auto_override_until"))
    auto_overridden = bool(override_until and current < override_until)
    if (
        settings["controlMode"] == "auto"
        and not auto_overridden
        and not session["active"]
        and recommendation["status"] == "WATER NOW"
        and recommendation["confidence"] in ("High", "Medium")
        and recommendation["durationMinutes"]
    ):
        _start_session(db, min(recommendation["durationMinutes"], settings["maxDurationMinutes"]), "automatic")
        session = session_dict(db)
    return {
        "telemetry": {
            "soilMoisture": measured_moisture,
            "temperatureC": round(weather["temperatureC"], 1),
            "humidityPercent": round(weather["humidityPercent"], 1),
            "sunlightPercent": sunlight,
            "rainingNow": bool(weather["rainingNow"]),
            "sensorFault": fault,
            "provenance": provenance,
            "updatedAt": iso(current),
        },
        "weather": weather,
        "recommendation": recommendation,
        "irrigation": session,
        "lowThreshold": calibration["lowThreshold"],
        "targetMoisture": calibration["targetMoisture"],
        "connectionStatus": "connected",
        "testMode": bool(settings["testMode"]),
    }


def _start_session(db: sqlite3.Connection, duration: int, source: str) -> dict:
    if db.execute(
        "SELECT 1 FROM irrigation_sessions WHERE active = 1 LIMIT 1"
    ).fetchone():
        raise HTTPException(status_code=409, detail="A simulated irrigation session is already active.")
    start = now_utc()
    end = start + timedelta(minutes=duration)
    db.execute(
        "INSERT INTO irrigation_sessions(active, source, started_at, ends_at, duration_minutes) "
        "VALUES (1, ?, ?, ?, ?)",
        (source, iso(start), iso(end), duration),
    )
    if source == "manual":
        set_value(db, "auto_override_until", None)
    add_history(
        db, "irrigation", "Simulated watering started",
        f"{source.title()} simulated session for {duration} minutes. No physical equipment is connected.",
        source,
    )
    add_notification(db, "Simulated watering started", f"{duration} minute {source} session.")
    return session_dict(db)


@app.get(f"{API_PREFIX}/healthz")
def health_check():
    return {"status": "ok"}


@app.get(f"{API_PREFIX}/events")
async def stream_field_events(request: Request):
    async def events():
        while not await request.is_disconnected():
            try:
                state = await asyncio.to_thread(get_field_state)
                yield f"event: field\ndata: {json.dumps(state, ensure_ascii=False)}\n\n"
            except Exception:
                yield 'event: error\ndata: {"status":"offline","message":"Field update unavailable"}\n\n'
            await asyncio.sleep(15)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get(f"{API_PREFIX}/field")
def get_field_state():
    with DB_LOCK, connect_db() as db:
        return _field_state(db)


@app.get(f"{API_PREFIX}/recommendation")
def get_recommendation():
    with DB_LOCK, connect_db() as db:
        return _field_state(db)["recommendation"]


@app.get(f"{API_PREFIX}/weather")
def get_weather_route():
    with DB_LOCK, connect_db() as db:
        return get_weather(db, read_settings(db))


@app.get(f"{API_PREFIX}/analytics")
def get_analytics():
    with DB_LOCK, connect_db() as db:
        field = _field_state(db)
        telemetry = db.execute(
            "SELECT soil_moisture, created_at FROM telemetry "
            "WHERE soil_moisture IS NOT NULL ORDER BY id DESC LIMIT 48"
        ).fetchall()
        history = [{
            "at": row["created_at"],
            "moisturePercent": float(row["soil_moisture"]),
        } for row in reversed(telemetry)]
        moisture = field["telemetry"]["soilMoisture"]
        if moisture is None:
            moisture = float(get_value(db, "simulation", DEFAULT_SIMULATION)["moisture"])
        points, label = forecast_points(
            float(moisture), field["telemetry"]["temperatureC"],
            field["telemetry"]["humidityPercent"],
            field["telemetry"]["sunlightPercent"],
            field["weather"]["rainProbability6h"],
            field["weather"]["precipitationMm6h"],
            field["irrigation"]["durationMinutes"] if field["irrigation"]["active"] else 0,
        )
        settings = read_settings(db)
        strategies = strategy_comparison(
            float(moisture), field["lowThreshold"], field["targetMoisture"],
            field["telemetry"]["temperatureC"], field["telemetry"]["humidityPercent"],
            field["telemetry"]["sunlightPercent"], field["weather"]["rainProbability6h"],
            field["weather"]["precipitationMm6h"], settings["flowLitresPerMinute"],
        )
        return {
            "history": history,
            "forecast": points,
            "strategies": strategies,
            "forecastLabel": label,
        }


@app.get(f"{API_PREFIX}/history")
def get_history(
    category: str = Query("all"),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0),
):
    allowed = {"all", "reading", "recommendation", "irrigation", "alert", "feedback"}
    if category not in allowed:
        raise HTTPException(status_code=422, detail="Choose a supported history filter.")
    with connect_db() as db:
        if category != "all":
            rows = db.execute(
                "SELECT id, category, title, detail, source, created_at FROM history "
                "WHERE category = ? ORDER BY id DESC LIMIT ? OFFSET ?",
                (category, limit, offset),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT id, category, title, detail, source, created_at FROM history "
                "ORDER BY id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [{
            "id": int(row["id"]),
            "category": row["category"],
            "title": row["title"],
            "detail": row["detail"],
            "source": row["source"],
            "at": row["created_at"],
        } for row in rows]


@app.get(f"{API_PREFIX}/settings")
def get_settings():
    with connect_db() as db:
        return read_settings(db)


@app.put(f"{API_PREFIX}/settings")
def update_settings(payload: SettingsInput):
    with DB_LOCK, connect_db() as db:
        previous = read_settings(db)
        incoming = payload.model_dump()
        for key, value in incoming.items():
            set_value(db, f"setting:{key}", value)
        if incoming.get("controlMode") == "auto":
            set_value(db, "auto_override_until", None)
        if previous["testMode"] and not incoming["testMode"]:
            set_value(db, "test_scenario", None)
        add_history(db, "alert", "Settings updated", "Saved field and notification preferences.")
        return incoming


@app.get(f"{API_PREFIX}/calibration")
def get_calibration():
    with connect_db() as db:
        return read_calibration(db)


@app.put(f"{API_PREFIX}/calibration")
def update_calibration(payload: CalibrationInput):
    if payload.wetPoint <= payload.dryPoint:
        raise HTTPException(status_code=422, detail="The wet point must be higher than the dry point.")
    with DB_LOCK, connect_db() as db:
        db.execute(
            "UPDATE calibration SET dry_point = ?, wet_point = ?, updated_at = ? WHERE id = 1",
            (payload.dryPoint, payload.wetPoint, iso()),
        )
        result = read_calibration(db)
        add_history(
            db, "alert", "Soil calibration updated",
            f"Dry point {payload.dryPoint:g}%; wet point {payload.wetPoint:g}%.",
        )
        return result


@app.post(f"{API_PREFIX}/irrigation/start")
def start_irrigation(payload: IrrigationStartInput):
    with DB_LOCK, connect_db() as db:
        settings = read_settings(db)
        duration = min(payload.durationMinutes, settings["maxDurationMinutes"])
        return _start_session(db, duration, "manual")


@app.post(f"{API_PREFIX}/irrigation/stop")
def stop_irrigation():
    with DB_LOCK, connect_db() as db:
        row = db.execute(
            "SELECT * FROM irrigation_sessions WHERE active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row:
            _stop_session(db, row, "Stopped manually")
        # Enforce manual override cooldown so automatic mode respects farmer's manual stop
        set_value(db, "auto_override_until", iso(now_utc() + timedelta(hours=2)))
        return session_dict(db)


@app.post(f"{API_PREFIX}/test-scenario")
def apply_test_scenario(payload: TestScenarioInput):
    with DB_LOCK, connect_db() as db:
        set_value(db, "setting:testMode", True)
        set_value(db, "test_scenario", payload.model_dump())
        set_value(db, "auto_override_until", None)
        simulation = get_value(db, "simulation", DEFAULT_SIMULATION.copy())
        if payload.soilMoisture is not None:
            simulation["moisture"] = payload.soilMoisture
            simulation["lastUpdated"] = iso()
            set_value(db, "simulation", simulation)
        add_history(
            db, "alert", "Test scenario applied",
            "Test-only simulated overrides were applied to soil, rain and/or sensor status.",
            "test mode",
        )
        return _field_state(db)


@app.post(f"{API_PREFIX}/reset")
def reset_field():
    with DB_LOCK, connect_db() as db:
        active = db.execute(
            "SELECT * FROM irrigation_sessions WHERE active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if active:
            _stop_session(db, active, "Field state reset")
        db.execute(
            "UPDATE calibration SET dry_point = ?, wet_point = ?, updated_at = ? WHERE id = 1",
            (DEFAULT_CALIBRATION["dryPoint"], DEFAULT_CALIBRATION["wetPoint"], iso()),
        )
        set_value(db, "simulation", {**DEFAULT_SIMULATION, "lastUpdated": iso()})
        set_value(db, "test_scenario", None)
        set_value(db, "setting:testMode", False)
        set_value(db, "auto_override_until", None)
        add_history(
            db, "alert", "Simulated field reset",
            "Field moisture, test overrides and calibration returned to defaults.",
        )
        return _field_state(db)


@app.get(f"{API_PREFIX}/notifications")
def get_notifications():
    with connect_db() as db:
        rows = db.execute(
            "SELECT id, title, detail, acknowledged, created_at FROM notifications "
            "ORDER BY id DESC LIMIT 100"
        ).fetchall()
        return [{
            "id": int(row["id"]),
            "title": row["title"],
            "detail": row["detail"],
            "acknowledged": bool(row["acknowledged"]),
            "at": row["created_at"],
        } for row in rows]


@app.post(f"{API_PREFIX}/notifications/{{notification_id}}/acknowledge")
def acknowledge_notification(notification_id: int):
    with connect_db() as db:
        cursor = db.execute(
            "UPDATE notifications SET acknowledged = 1 WHERE id = ?",
            (notification_id,),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found.")
        row = db.execute(
            "SELECT id, title, detail, acknowledged, created_at FROM notifications WHERE id = ?",
            (notification_id,),
        ).fetchone()
        return {
            "id": int(row["id"]), "title": row["title"], "detail": row["detail"],
            "acknowledged": bool(row["acknowledged"]), "at": row["created_at"],
        }


@app.post(f"{API_PREFIX}/feedback", status_code=201)
def submit_feedback(payload: FeedbackInput):
    with DB_LOCK, connect_db() as db:
        db.execute(
            "INSERT INTO feedback(helpful, comment, created_at) VALUES (?, ?, ?)",
            (int(payload.helpful), payload.comment, iso()),
        )
        event_id = add_history(
            db, "feedback", "Farmer feedback received",
            ("Helpful" if payload.helpful else "Not helpful")
            + (f": {payload.comment}" if payload.comment.strip() else ""),
            "farmer",
        )
        row = db.execute(
            "SELECT id, category, title, detail, source, created_at FROM history WHERE id = ?",
            (event_id,),
        ).fetchone()
        return {
            "id": int(row["id"]), "category": row["category"], "title": row["title"],
            "detail": row["detail"], "source": row["source"], "at": row["created_at"],
        }
