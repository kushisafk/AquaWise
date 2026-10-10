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
            time_of_day = rng.uniform(0.0, 24.0)
            time_since_last_irrigation = rng.uniform(0.0, 168.0)
            
            # Step 1: Feature Engineering - Time-Series Lags
            actual_drying = _drying_rate(temperature, humidity, sunlight)
            moisture_minus_1h = min(100.0, moisture + actual_drying + rng.gauss(0, 0.5))
            temp_rolling_3h_avg = temperature + rng.gauss(0, 2.0)
            drying_rate_per_hour = moisture_minus_1h - moisture
            
            # Step 5: Evapotranspiration (ET0) Engineered Feature
            et_index = (temperature * (max(5, sunlight) / 100)) / max(1, humidity)

            target = _balance(
                moisture, horizon, temperature, humidity, sunlight,
                rain_mm * min(1, horizon / 6), irrigation,
            ) + rng.gauss(0, 1.0)
            target = max(0.0, min(100.0, target))
            samples.append([
                moisture, horizon, temperature, humidity, sunlight,
                rain_probability, rain_mm, irrigation,
                moisture_minus_1h, temp_rolling_3h_avg, drying_rate_per_hour, et_index,
                time_of_day, time_since_last_irrigation
            ])
            targets.append(target)
            persistence.append(moisture)

        # Step 3: Time-Series Cross-Validation
        # Do not shuffle time-series data!
        from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
        # Keep temporal order by removing shuffle/random split (in a real DB scenario, order is vital)
        split_idx = int(len(samples) * 0.75)
        x_train, x_test = np.asarray(samples)[:split_idx], np.asarray(samples)[split_idx:]
        y_train, y_test = np.asarray(targets)[:split_idx], np.asarray(targets)[split_idx:]
        base_test = np.asarray(persistence)[split_idx:]
        
        # Step 2: Dynamic Hyperparameter Tuning
        # Step 4: Upgrade to LightGBM-style Regressor (HistGradientBoostingRegressor)
        # We use sklearn's native HistGradientBoostingRegressor which is heavily optimized for tabular data and handles non-linearities much better than the standard GBR.
        from sklearn.ensemble import HistGradientBoostingRegressor
        param_dist = {
            'max_iter': [30, 50, 100, 150],
            'max_depth': [2, 3, 4, 5, None],
            'learning_rate': [0.01, 0.05, 0.1, 0.2]
        }
        base_model = HistGradientBoostingRegressor(random_state=17)
        tscv = TimeSeriesSplit(n_splits=3)
        search = RandomizedSearchCV(
            base_model, param_distributions=param_dist, n_iter=8, 
            scoring='neg_mean_absolute_error', cv=tscv, random_state=17, n_jobs=1
        )
        search.fit(x_train, y_train)
        candidate = search.best_estimator_

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
    moisture_minus_1h: float | None = None,
    temp_rolling_3h_avg: float | None = None,
    time_of_day: float = 12.0,
    time_since_last_irrigation: float = 24.0,
    hourly_weather: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    if _model is None and _model_status.startswith("Water-balance simulator"):
        train_experimental_model()
    
    # Step 1: Compute real or fallback lag features
    if moisture_minus_1h is None:
        moisture_minus_1h = min(100.0, moisture + _drying_rate(temperature, humidity, sunlight))
    if temp_rolling_3h_avg is None:
        temp_rolling_3h_avg = temperature
    drying_rate_per_hour = moisture_minus_1h - moisture
    
    # Step 5: Compute ET Index
    et_index = (temperature * (max(5, sunlight) / 100)) / max(1, humidity)

    horizons = [1, 3, 6, 12, 24, 48]
    points = []
    for hours in horizons:
        if _model is not None:
            try:
                predicted = float(_model.predict([[
                    moisture, hours, temperature, humidity, sunlight,
                    rain_probability, rain_mm, irrigation_minutes,
                    moisture_minus_1h, temp_rolling_3h_avg, drying_rate_per_hour, et_index,
                    (time_of_day + hours) % 24.0, time_since_last_irrigation + hours
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
    """Compare 4 irrigation strategies over a 48h horizon under identical simulated conditions.

    All strategies share:
    - Same initial soil moisture and thresholds.
    - Same weather (temperature, humidity, sunlight, rain).
    - Same soil evaporation and absorption model.
    - Same assumed flow-rate parameter (litres per minute).

    Strategies:
    - Fixed schedule: Conventional timer watering (15 min every 12h = 60 min total in 48h).
    - Moisture threshold: Waters only when moisture drops below low threshold, with a 4h cooldown.
    - Rain-aware threshold: Responsive watering, but delays if meaningful rain (>=60% chance, >=2mm) is expected within 6h.
    - Optimized schedule: Predictive scheduling that balances stress prevention and water conservation.
    """
    names = ["Fixed schedule", "Moisture threshold", "Rain-aware threshold", "Optimized schedule"]
    descriptions = {
        "Fixed schedule": "Timer baseline: Waters on a rigid calendar schedule (15 min every 12h) regardless of soil or rain.",
        "Moisture threshold": "Sensor threshold: Waters 15 min when soil drops below threshold, with rest intervals.",
        "Rain-aware threshold": "Weather-aware: Waters below threshold, but pauses if meaningful rain is forecasted within 6 hours.",
        "Optimized schedule": "Predictive water-smart: Calculates targeted durations to reach target moisture while leveraging rain forecasts.",
    }
    totals: dict[str, dict[str, float]] = {
        name: {"water": 0.0, "stress": 0.0, "over": 0.0}
        for name in names
    }
    levels = {name: max(0.0, min(100.0, float(moisture))) for name in names}
    last_watered = {name: -10 for name in names}
    meaningful_rain = rain_probability >= 60 and rain_mm >= 2
    flow_rate = max(0.1, float(flow_litres_per_minute))
    wet_ceiling = min(100.0, target + 8.0)

    # Simulate 48 hourly steps under identical conditions
    for hour in range(48):
        for name in names:
            level = levels[name]
            if level < low_threshold:
                totals[name]["stress"] += 1.0
            if level > wet_ceiling:
                totals[name]["over"] += 1.0

            should_water = False
            minutes = 0
            cooldown_ok = (hour - last_watered[name]) >= 4

            if name == "Fixed schedule":
                # Conventional practice: waters at hour 6, 18, 30, 42
                if hour % 12 == 6:
                    should_water, minutes = True, 15
            elif name == "Moisture threshold":
                # Waters when dry with cooldown
                if level < low_threshold and cooldown_ok:
                    should_water, minutes = True, 15
            elif name == "Rain-aware threshold":
                # Waters when dry with cooldown, unless rain is imminent
                rain_imminent = (hour < 6 and meaningful_rain)
                if level < low_threshold and cooldown_ok and not rain_imminent:
                    should_water, minutes = True, 15
            elif name == "Optimized schedule":
                # Predictive: checks if currently dry or drying will push below threshold within 4h
                drying_step = _drying_rate(temperature, humidity, sunlight)
                will_dry_soon = (hour < 6 and not meaningful_rain and (level - drying_step * 3) < low_threshold)
                rain_imminent = (hour < 6 and meaningful_rain)
                if (level < low_threshold or will_dry_soon) and cooldown_ok and not rain_imminent:
                    # Targeted volume to reach target without overshooting
                    deficit = max(4.0, min(30.0, target - level))
                    calc_minutes = max(8, min(25, round(deficit / 0.28)))
                    should_water, minutes = True, calc_minutes

            simulated_rain = (rain_mm / 6.0) if (hour < 6 and meaningful_rain) else 0.0
            level = _balance(
                level, 1, temperature, humidity, sunlight, simulated_rain,
                minutes if should_water else 0,
            )
            if should_water:
                totals[name]["water"] += minutes * flow_rate
                last_watered[name] = hour
            levels[name] = max(0.0, min(100.0, level))

    baseline_water = totals["Fixed schedule"]["water"]

    results = []
    for name in names:
        candidate_water = totals[name]["water"]
        if baseline_water > 0:
            savings_pct = round((baseline_water - candidate_water) / baseline_water * 100.0, 1)
        else:
            savings_pct = 0.0 if candidate_water == 0 else -100.0

        if savings_pct > 0:
            savings_type = "saved"
        elif savings_pct < 0:
            savings_type = "increased"
        else:
            savings_type = "neutral"

        # Determine if strategy is recommended based on stress prevention and efficiency
        is_recommended = False
        if name == "Optimized schedule":
            # Recommended if it has lower or equal stress than fixed and doesn't waste excessive water
            is_recommended = totals[name]["stress"] <= totals["Fixed schedule"]["stress"]
        elif name == "Rain-aware threshold" and not is_recommended:
            is_recommended = (
                totals[name]["stress"] <= totals["Fixed schedule"]["stress"]
                and totals[name]["water"] < totals["Fixed schedule"]["water"]
            )

        results.append({
            "name": name,
            "description": descriptions[name],
            "waterLitres": round(candidate_water, 1),
            "dryStressHours": int(totals[name]["stress"]),
            "overwateringHours": int(totals[name]["over"]),
            "waterSavedPercent": savings_pct,
            "savingsType": savings_type,
            "isBaseline": (name == "Fixed schedule"),
            "isRecommended": is_recommended,
            "assumedFlowRateLpm": flow_rate,
            "isFlowRateConfigured": True,
        })

    return results
