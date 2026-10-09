"""Synthetic-data forecast experiment with a transparent water-balance fallback."""

from __future__ import annotations

import math
import random
from typing import Any

_model: Any = None
_model_status = "Water-balance simulator (synthetic assumptions)"
_model_mae: float | None = None


def _drying_rate(temperature: float, humidity: float, sunlight: float) -> float:
    return max(
        0.025,
        0.06 + max(0, temperature - 20) * 0.004
        + sunlight * 0.0012 - humidity * 0.0008,
    )


def _balance(
    moisture: float,
    hours: float,
    temperature: float,
    humidity: float,
    sunlight: float,
    rain_mm: float,
    irrigation_minutes: float = 0,
) -> float:
    return max(
        0.0,
        min(
            100.0,
            moisture
            - _drying_rate(temperature, humidity, sunlight) * hours
            + min(25.0, rain_mm * 0.75)
            + irrigation_minutes * 0.28,
        ),
    )


def train_experimental_model() -> dict[str, Any]:
    """Train only on generated sequences; promote only if better than persistence."""
    global _model, _model_status, _model_mae
    try:
        import numpy as np
        from sklearn.ensemble import GradientBoostingRegressor
        from sklearn.metrics import mean_absolute_error
        from sklearn.model_selection import train_test_split

        rng = random.Random(92)
        samples: list[list[float]] = []
        targets: list[float] = []
        persistence: list[float] = []
        for _ in range(2200):
            moisture = rng.uniform(10, 90)
            horizon = rng.choice([1, 3, 6, 12, 24, 48])
            temperature = rng.uniform(16, 42)
            humidity = rng.uniform(20, 95)
            sunlight = rng.uniform(5, 100)
            rain_probability = rng.uniform(0, 100)
            rain_mm = rng.uniform(0, 22) if rain_probability > 25 else 0
            irrigation = rng.choice([0, 0, 0, 8, 15])
            target = _balance(
                moisture, horizon, temperature, humidity, sunlight,
                rain_mm * min(1, horizon / 6), irrigation,
            ) + rng.gauss(0, 1.0)
            target = max(0.0, min(100.0, target))
            samples.append([
                moisture, horizon, temperature, humidity, sunlight,
                rain_probability, rain_mm, irrigation,
            ])
            targets.append(target)
            persistence.append(moisture)

        x_train, x_test, y_train, y_test, base_test = train_test_split(
            np.asarray(samples), np.asarray(targets), np.asarray(persistence),
            test_size=0.25, random_state=17,
        )
        candidate = GradientBoostingRegressor(
            n_estimators=45, max_depth=2, learning_rate=0.08, random_state=17,
        )
        candidate.fit(x_train, y_train)
        model_error = float(mean_absolute_error(y_test, candidate.predict(x_test)))
        baseline_error = float(mean_absolute_error(y_test, base_test))
        _model_mae = model_error
        if model_error < baseline_error:
            _model = candidate
            _model_status = "Experimental tree model (trained on synthetic data)"
        else:
            _model = None
            _model_status = "Persistence fallback (synthetic model did not beat baseline)"
    except Exception:
        _model = None
        _model_mae = None
        _model_status = "Water-balance simulator (model unavailable)"
    return {"status": _model_status, "mae": _model_mae}


def forecast_points(
    moisture: float,
    temperature: float,
    humidity: float,
    sunlight: float,
    rain_probability: float,
    rain_mm: float,
    irrigation_minutes: float = 0,
) -> tuple[list[dict[str, Any]], str]:
    if _model is None and _model_status.startswith("Water-balance simulator"):
        train_experimental_model()
    horizons = [1, 3, 6, 12, 24, 48]
    points = []
    for hours in horizons:
        if _model is not None:
            try:
                predicted = float(_model.predict([[
                    moisture, hours, temperature, humidity, sunlight,
                    rain_probability, rain_mm, irrigation_minutes,
                ]])[0])
            except Exception:
                predicted = _balance(
                    moisture, hours, temperature, humidity, sunlight,
                    rain_mm * min(1, hours / 6), irrigation_minutes,
                )
        else:
            predicted = _balance(
                moisture, hours, temperature, humidity, sunlight,
                rain_mm * min(1, hours / 6), irrigation_minutes,
            )
        points.append({
            "hours": hours,
            "moisturePercent": round(max(0.0, min(100.0, predicted)), 1),
            "provenance": "estimated",
        })
    return points, _model_status


def strategy_comparison(
    moisture: float,
    low_threshold: float,
    target: float,
    temperature: float,
    humidity: float,
    sunlight: float,
    rain_probability: float,
    rain_mm: float,
    flow_litres_per_minute: float,
) -> list[dict[str, Any]]:
    names = ["Fixed schedule", "Moisture threshold", "Rain-aware threshold", "Optimized schedule"]
    totals: dict[str, dict[str, float]] = {
        name: {"water": 0.0, "stress": 0.0, "over": 0.0}
        for name in names
    }
    levels = {name: moisture for name in names}
    meaningful_rain = rain_probability >= 60 and rain_mm >= 2
    for hour in range(48):
        for name in names:
            level = levels[name]
            if level < low_threshold:
                totals[name]["stress"] += 1
            if level > target + 10:
                totals[name]["over"] += 1
            should_water = False
            minutes = 0
            if name == "Fixed schedule" and hour % 12 == 0:
                should_water, minutes = True, 10
            elif name == "Moisture threshold" and level < low_threshold:
                should_water, minutes = True, 10
            elif name == "Rain-aware threshold" and level < low_threshold and not meaningful_rain:
                should_water, minutes = True, 10
            elif name == "Optimized schedule" and (
                level < low_threshold
                or (hour < 6 and rain_probability < 60 and
                    level - _drying_rate(temperature, humidity, sunlight) * 6 < low_threshold)
            ) and not (hour < 6 and meaningful_rain):
                should_water, minutes = True, 8
            simulated_rain = rain_mm / 6 if hour < 6 and meaningful_rain else 0
            level = _balance(
                level, 1, temperature, humidity, sunlight, simulated_rain,
                minutes if should_water else 0,
            )
            if should_water:
                totals[name]["water"] += minutes * flow_litres_per_minute
            levels[name] = level
    fixed = max(totals[names[0]]["water"], 0.01)
    return [{
        "name": name,
        "waterLitres": round(totals[name]["water"], 1),
        "dryStressHours": round(totals[name]["stress"], 1),
        "overwateringHours": round(totals[name]["over"], 1),
        "waterSavedPercent": round(
            max(-100, min(100, (fixed - totals[name]["water"]) / fixed * 100)), 1,
        ),
    } for name in names]
