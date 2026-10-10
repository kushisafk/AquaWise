"""AquaWise API: simulated field state, dynamic irrigation scheduling and persisted controls."""

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

from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request

from pydantic import BaseModel, Field

from starlette.responses import StreamingResponse

from engine import calculate_recommendation, thresholds

from forecasting import (

    forecast_points,

    generate_irrigation_schedule,

    strategy_comparison,

)

from weather import fetch_open_meteo, get_weather

API_PREFIX = "/api"

DB_PATH = Path(os.environ.get(

    "AQUAWISE_DB_PATH",

    str(Path(__file__).resolve().parent / "aquawise.sqlite3"),

))

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DB_LOCK = threading.RLock()

def _weather_from_open_meteo(latitude: float, longitude: float) -> dict:
    import urllib.request
    import json
    from datetime import datetime, timezone
    
    API_KEY = "AIzaSyDBLRANvsoLcpTyBKuib510TZ2ss3CjRs4"
    google_url = f"https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude={latitude}&location.longitude={longitude}&key={API_KEY}"
    
    try:
        req = urllib.request.Request(google_url, headers={'User-Agent': 'AquaWise'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read())
            
            hours = data.get("forecastHours", [])
            if not hours:
                raise ValueError("No forecastHours found")
                
            hourly_series = []
            max_prob_6h = 0.0
            total_rain_6h = 0.0
            
            for i, h in enumerate(hours[:48]):
                temp = float(h.get("temperature", {}).get("degrees", 25.0))
                humidity = float(h.get("relativeHumidity", 55.0))
                prob = float(h.get("precipitation", {}).get("probability", {}).get("percent", 0.0))
                rain = float(h.get("precipitation", {}).get("qpf", {}).get("quantity", 0.0))
                time_str = h.get("interval", {}).get("startTime", "")
                
                hourly_series.append({
                    "time": time_str,
                    "precipitationProbability": prob,
                    "precipitationMm": rain,
                    "temperatureC": temp,
                    "humidityPercent": humidity,
                })
                
                if i < 6:
                    max_prob_6h = max(max_prob_6h, prob)
                    total_rain_6h += rain
            
            curr = hourly_series[0] if hourly_series else {}
            is_raining_now = curr.get("precipitationMm", 0.0) > 0.0
            
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
                "temperatureC": curr.get("temperatureC", 25.0),
                "humidityPercent": curr.get("humidityPercent", 55.0),
                "rainingNow": is_raining_now,
                "rainProbability6h": round(max_prob_6h, 1),
                "precipitationMm6h": total_rain_6h,
                "summary": summary,
                "source": "Google Weather API",
                "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "hourly": hourly_series,
                "latitude": latitude,
                "longitude": longitude,
            }
            
    except Exception:
        # If anything fails (like a network timeout), fallback to Open-Meteo
        pass
        
    return fetch_open_meteo(latitude, longitude)

@asynccontextmanager

async def lifespan(app: FastAPI):

    _init_db()

    with DB_LOCK, connect_db() as db:

        _cleanup_duplicate_history(db)

        try:

            exists = db.execute("SELECT 1 FROM history WHERE title = 'System initialized'").fetchone()

            if not exists:

                add_history(

                    db, "alert", "System initialized",

                    "AquaWise started with deterministic physical water-balance physics and Open-Meteo weather integration.",

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

    soilMoisture: float | None = Field(default=None, ge=0, le=100)

    rainingNow: bool = False

    rainProbability6h: float = Field(default=0, ge=0, le=100)

    precipitationMm6h: float = Field(default=0, ge=0, le=200)

    sensorFault: bool = False

    weatherStatus: Literal["LIVE", "CACHED", "STALE", "UNAVAILABLE", "TEST_OVERRIDE"] | None = None

    scenarioKey: str | None = None

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

                temperature_c REAL,

                humidity_percent REAL,

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

def _effective_moisture(

    db: sqlite3.Connection,

    simulation: dict,

    weather_info: dict,

    calibration: dict,

) -> tuple[float | None, str, bool]:

    scenario = get_value(db, "test_scenario")

    fault = bool(scenario and scenario.get("sensorFault"))

    if scenario and scenario.get("scenarioKey") == "sensor_fault":

        return None, "stale", True

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

    temp = weather_info.get("temperatureC") or 26.0

    hum = weather_info.get("humidityPercent") or 60.0

    dry_rate = max(0.02, 0.06 + max(0, temp - 20) * 0.004 + 55 * 0.0012 - hum * 0.0008)

    estimate = max(0.0, float(last["soil_moisture"]) - age_hours * dry_rate)

    return round(estimate, 1), "estimated", True

def _field_state(db: sqlite3.Connection) -> dict:

    settings = read_settings(db)

    calibration = read_calibration(db)

    simulation = get_value(db, "simulation", DEFAULT_SIMULATION.copy())

    test_scenario = get_value(db, "test_scenario")

    # Fetch weather via dedicated weather service

    weather_info = get_weather(

        db,

        settings["latitude"],

        settings["longitude"],

        test_mode=settings["testMode"],

        test_scenario=test_scenario,

    )

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

    temp = weather_info.get("temperatureC") or 26.0

    hum = weather_info.get("humidityPercent") or 60.0

    evaporation = max(0.02, 0.06 + max(0, temp - 20) * 0.004 + 55 * 0.0012 - hum * 0.0008)

    # Deplete moisture naturally

    moisture -= evaporation * elapsed_minutes

    if weather_info.get("rainingNow"):

        moisture += min(0.8, elapsed_minutes * 0.015)

    # Advance active irrigation session

    if active:

        end = parse_time(active["ends_at"])

        max_elapsed = (

            max(0.0, (current - parse_time(active["started_at"])).total_seconds() / 60)

            if parse_time(active["started_at"]) else 0.0

        )

        run_minutes = min(elapsed_minutes, max_elapsed, active["duration_minutes"])

        moisture += run_minutes * 0.32

        stop_reason = None

        if active["source"] == "automatic" and weather_info.get("rainingNow"):

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

    measured_moisture, provenance, fault = _effective_moisture(

        db, simulation, weather_info, calibration,

    )

    sunlight = round(max(5.0, min(100.0, 76 - (hum - 50) * 0.4)), 1)

    future_moisture = max(

        0.0,

        (measured_moisture if measured_moisture is not None else moisture)

        - evaporation * 360

        + min(15.0, (weather_info.get("precipitationMm6h") or 0.0) * 0.75),

    )

    # Recommendation via deterministic rules

    recommendation = calculate_recommendation(

        moisture=measured_moisture,

        dry_point=calibration["dryPoint"],

        wet_point=calibration["wetPoint"],

        raining_now=bool(weather_info.get("rainingNow")),

        rain_probability_6h=float(weather_info.get("rainProbability6h") or 0.0),

        precipitation_mm_6h=float(weather_info.get("precipitationMm6h") or 0.0),

        forecast_stale=bool(weather_info.get("stale")),

        weather_unavailable=weather_info.get("status") == "UNAVAILABLE",

        estimated=provenance == "estimated",

        temperature_c=temp,

        humidity_percent=hum,

        sunlight_percent=sunlight,

        max_duration_minutes=settings["maxDurationMinutes"],

        flow_litres_per_minute=settings["flowLitresPerMinute"],

        forecast_moisture_6h=future_moisture,

        language=settings["language"],

        current_time=current,

    )

    recommendation["updatedAt"] = iso(current)

    # Dynamic Schedule generation

    schedule = generate_irrigation_schedule(

        moisture=measured_moisture,

        low_threshold=calibration["lowThreshold"],

        target_moisture=calibration["targetMoisture"],

        flow_litres_per_minute=settings["flowLitresPerMinute"],

        max_duration_minutes=settings["maxDurationMinutes"],

        hourly_weather=weather_info.get("hourly") or [],

        current_time=current,

        language=settings["language"],

    )

    session = session_dict(db)

    # Telemetry logging (rate-limited to 1 minute)

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

                measured_moisture, temp, hum,

                sunlight, int(bool(weather_info.get("rainingNow"))), int(fault), provenance, iso(current),

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

                f"temperature {temp:.1f}°C; humidity {hum:.0f}%.",

                provenance,

            )

    # History recommendation logging (avoid duplicate consecutive statuses)

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

    if weather_info.get("stale"):

        add_notification(db, "Weather data is stale", "Open-Meteo is unavailable or the cached forecast is old.")

    if fault:

        add_notification(db, "Simulated sensor fault", "Check field sensor; displayed estimates are labelled.")

    # Phase 6: Automatic mode handling

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

            "temperatureC": round(temp, 1) if temp is not None else None,

            "humidityPercent": round(hum, 1) if hum is not None else None,

            "sunlightPercent": sunlight,

            "rainingNow": bool(weather_info.get("rainingNow")),

            "sensorFault": fault,

            "provenance": provenance,

            "updatedAt": iso(current),

        },

        "weather": weather_info,

        "recommendation": recommendation,

        "schedule": schedule,

        "irrigation": session,

        "lowThreshold": calibration["lowThreshold"],

        "targetMoisture": calibration["targetMoisture"],

        "connectionStatus": "connected",

        "testMode": bool(settings["testMode"]),

    }

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

@app.get(f"{API_PREFIX}/schedule")

def get_schedule():

    with DB_LOCK, connect_db() as db:

        return _field_state(db)["schedule"]

@app.get(f"{API_PREFIX}/weather")

def get_weather_route():

    with DB_LOCK, connect_db() as db:

        settings = read_settings(db)

        return get_weather(

            db,

            settings["latitude"],

            settings["longitude"],

            test_mode=settings["testMode"],

            test_scenario=get_value(db, "test_scenario"),

        )

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
        
        # 3. Anomaly Detection (adapting when reading fails)
        is_anomalous = False
        if moisture is not None and len(history) >= 10:
            try:
                from sklearn.ensemble import IsolationForest
                import numpy as np
                hist_vals = [h["moisturePercent"] for h in history]
                iso_model = IsolationForest(contamination=0.05, random_state=42)
                iso_model.fit(np.array(hist_vals).reshape(-1, 1))
                if iso_model.predict(np.array([[moisture]]))[0] == -1:
                    is_anomalous = True
            except Exception:
                pass

        if moisture is None or is_anomalous:
            moisture = float(get_value(db, "simulation", DEFAULT_SIMULATION)["moisture"])

        temp = field["telemetry"]["temperatureC"] or 26.0

        hum = field["telemetry"]["humidityPercent"] or 60.0

        sun = field["telemetry"]["sunlightPercent"]

        prob = field["weather"].get("rainProbability6h") or 0.0

        rain = field["weather"].get("precipitationMm6h") or 0.0

        irr_duration = field["irrigation"]["durationMinutes"] if field["irrigation"]["active"] else 0

        # Run non-ML physical simulation using real hourly forecast if available

        points, label = forecast_points(

            float(moisture), temp, hum, sun, prob, rain, irr_duration,

            hourly_weather=field["weather"].get("hourly"),

        )

        settings = read_settings(db)

        strategies = strategy_comparison(

            float(moisture), field["lowThreshold"], field["targetMoisture"],

            temp, hum, sun, prob, rain, settings["flowLitresPerMinute"],

            hourly_weather=field["weather"].get("hourly"),

        )

        return {

            "history": history,

            "forecast": points,

            "strategies": strategies,

            "schedule": field.get("schedule"),

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

        # If location coordinates changed, refresh weather immediately with live data
        if (
            abs(previous["latitude"] - incoming["latitude"]) > 0.001
            or abs(previous["longitude"] - incoming["longitude"]) > 0.001
        ):
            set_value(db, "test_scenario", None)
            get_weather(
                db, incoming["latitude"], incoming["longitude"],
                test_mode=False,
                force_refresh=True,
            )

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

        calibration = read_calibration(db)

        low = calibration["lowThreshold"]

        target = calibration["targetMoisture"]

        scenario_data = payload.model_dump()

        # Handle explicit scenario key presets (Phase 8: 10 scenarios)

        key = payload.scenarioKey

        if key == "dry_no_rain":

            scenario_data = {

                "soilMoisture": round(max(5.0, low - 8.0), 1),

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "dry_rain_soon":

            scenario_data = {

                "soilMoisture": round(max(5.0, low - 8.0), 1),

                "rainingNow": False,

                "rainProbability6h": 85.0,

                "precipitationMm6h": 8.5,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "rain_now":

            scenario_data = {

                "soilMoisture": round(low + 5.0, 1),

                "rainingNow": True,

                "rainProbability6h": 95.0,

                "precipitationMm6h": 14.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "adequate":

            scenario_data = {

                "soilMoisture": round(min(90.0, target + 5.0), 1),

                "rainingNow": False,

                "rainProbability6h": 10.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "dry_later":

            scenario_data = {

                "soilMoisture": round(low + 4.5, 1),

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "weather_stale":

            scenario_data = {

                "soilMoisture": round(low - 2.0, 1),

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "STALE",

                "scenarioKey": key,

            }

        elif key == "weather_unavailable":

            scenario_data = {

                "soilMoisture": round(low - 2.0, 1),

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "UNAVAILABLE",

                "scenarioKey": key,

            }

        elif key == "sensor_fault":

            scenario_data = {

                "soilMoisture": None,

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": True,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "active_watering":

            # Start simulated watering session

            active = db.execute("SELECT 1 FROM irrigation_sessions WHERE active = 1").fetchone()

            if not active:

                _start_session(db, 20, "manual")

            scenario_data = {

                "soilMoisture": round(low - 4.0, 1),

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        elif key == "target_reached":

            # Simulate target moisture reached during watering

            scenario_data = {

                "soilMoisture": target,

                "rainingNow": False,

                "rainProbability6h": 0.0,

                "precipitationMm6h": 0.0,

                "sensorFault": False,

                "weatherStatus": "TEST_OVERRIDE",

                "scenarioKey": key,

            }

        set_value(db, "setting:testMode", True)

        set_value(db, "test_scenario", scenario_data)

        set_value(db, "auto_override_until", None)

        simulation = get_value(db, "simulation", DEFAULT_SIMULATION.copy())

        if scenario_data.get("soilMoisture") is not None:

            simulation["moisture"] = scenario_data["soilMoisture"]

            simulation["lastUpdated"] = iso()

            set_value(db, "simulation", simulation)

        add_history(

            db, "alert", "Test scenario applied",

            f"Test override '{key or 'custom'}' applied. Legitimate history preserved.",

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

