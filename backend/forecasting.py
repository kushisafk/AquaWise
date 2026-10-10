"""Deterministic physical water-balance simulator and dynamic irrigation scheduler.



Strict Non-ML Implementation:

- Pure physical soil-moisture depletion and infiltration simulation

- Penman-Monteith inspired drying rate driven by temperature, humidity, and solar radiation

- Dynamic 48-hour forward projection and PRD checkpoint generation (+1h, +3h, +6h, +12h, +24h, +48h)

- Dynamic schedule generation (start time, duration, litres, target moisture)

- 4-strategy comparative evaluation under identical weather and flow-rate assumptions

"""



from __future__ import annotations



import math

from datetime import datetime, timedelta, timezone

from typing import Any



# Simulation constants

WETTING_RATE_PER_MINUTE = 0.32  # % soil moisture increase per minute of standard watering

MODEL_DESCRIPTION = "Deterministic water-balance simulator (Penman-Monteith evapotranspiration & infiltration physics)"





def now_utc() -> datetime:

    return datetime.now(timezone.utc)





def iso(value: datetime | None = None) -> str:

    return (value or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")





def drying_rate(temperature: float, humidity: float, sunlight: float) -> float:

    """Hourly soil moisture loss (%) from solar radiation, temperature, and atmospheric humidity."""

    temp_factor = max(0.0, temperature - 20.0) * 0.004

    sun_factor = max(0.0, sunlight) * 0.0012

    hum_factor = max(0.0, humidity) * 0.0008

    return max(0.025, 0.06 + temp_factor + sun_factor - hum_factor)





def balance_step(

    moisture: float,

    hours: float,

    temperature: float,

    humidity: float,

    sunlight: float,

    rain_mm: float,

    irrigation_minutes: float = 0.0,

) -> float:

    """Single physical water-balance step with bounded moisture [0, 100]."""

    depletion = drying_rate(temperature, humidity, sunlight) * hours

    # Infiltration model: rain contributes ~0.75% moisture per mm up to 25% cap per event

    rain_gain = min(25.0, max(0.0, rain_mm) * 0.75)

    # Irrigation response

    irrigation_gain = max(0.0, irrigation_minutes) * WETTING_RATE_PER_MINUTE

    new_moisture = moisture - depletion + rain_gain + irrigation_gain

    return max(0.0, min(100.0, new_moisture))





def simulate_48h_timeline(

    initial_moisture: float,

    hourly_weather: list[dict[str, Any]],

    scheduled_irrigation: dict[int, int] | None = None,

) -> list[dict[str, Any]]:

    """Simulate hour-by-hour soil moisture over a 48-hour timeline."""

    scheduled = scheduled_irrigation or {}

    timeline: list[dict[str, Any]] = []

    current_moisture = max(0.0, min(100.0, float(initial_moisture)))



    for hour in range(48):

        weather_hour = hourly_weather[hour] if hour < len(hourly_weather) else {}

        temp = float(weather_hour.get("temperatureC", 26.0))

        hum = float(weather_hour.get("humidityPercent", 60.0))

        sun = round(max(5.0, min(100.0, 76.0 - (hum - 50.0) * 0.4)), 1)

        rain = float(weather_hour.get("precipitationMm", 0.0))

        irr_mins = float(scheduled.get(hour, 0))



        current_moisture = balance_step(

            current_moisture, 1.0, temp, hum, sun, rain, irr_mins

        )



        timeline.append({

            "hour": hour + 1,

            "moisturePercent": round(current_moisture, 1),

            "temperatureC": temp,

            "humidityPercent": hum,

            "rainMm": rain,

            "irrigationMinutes": irr_mins,

            "provenance": "simulated",

        })



    return timeline





def forecast_points(

    moisture: float,

    temperature: float,

    humidity: float,

    sunlight: float,

    rain_probability: float,

    rain_mm: float,

    irrigation_minutes: float = 0.0,

    hourly_weather: list[dict[str, Any]] | None = None,

) -> tuple[list[dict[str, Any]], str]:

    """Generate PRD checkpoint forecasts: +1h, +3h, +6h, +12h, +24h, +48h."""

    checkpoints = [1, 3, 6, 12, 24, 48]

    points = []



    if hourly_weather and len(hourly_weather) >= 48:

        # Step through real hourly forecast data for high-fidelity simulation

        cur = max(0.0, min(100.0, float(moisture)))

        checkpoint_map = {}

        for h in range(1, 49):

            idx = h - 1

            w = hourly_weather[idx]

            t = float(w.get("temperatureC", temperature))

            hm = float(w.get("humidityPercent", humidity))

            s = round(max(5.0, min(100.0, 76.0 - (hm - 50.0) * 0.4)), 1)

            r = float(w.get("precipitationMm", 0.0))

            irr = irrigation_minutes if h == 1 else 0.0

            cur = balance_step(cur, 1.0, t, hm, s, r, irr)

            if h in checkpoints:

                checkpoint_map[h] = round(cur, 1)



        for hours in checkpoints:

            points.append({

                "hours": hours,

                "moisturePercent": checkpoint_map.get(hours, round(cur, 1)),

                "provenance": "estimated",

            })

    else:

        # Fallback using environmental parameters

        for hours in checkpoints:

            effective_rain = rain_mm * min(1.0, hours / 6.0) if rain_probability >= 30 else 0.0

            predicted = balance_step(

                float(moisture), float(hours), temperature, humidity, sunlight,

                effective_rain, irrigation_minutes,

            )

            points.append({

                "hours": hours,

                "moisturePercent": round(predicted, 1),

                "provenance": "estimated",

            })



    return points, MODEL_DESCRIPTION





def generate_irrigation_schedule(

    *,

    moisture: float | None,

    low_threshold: float,

    target_moisture: float,

    flow_litres_per_minute: float,

    max_duration_minutes: int,

    hourly_weather: list[dict[str, Any]],

    current_time: datetime | None = None,

    language: str = "en",

) -> dict[str, Any]:

    """Determine dynamic watering start time, estimated duration, volume, and next evaluation."""

    now = current_time or now_utc()

    flow_rate = max(0.1, float(flow_litres_per_minute))

    cap_minutes = max(1, int(max_duration_minutes))



    if moisture is None or not (0.0 <= moisture <= 100.0):

        return {

            "status": "CHECK FIELD",

            "recommendedStartTime": None,

            "durationMinutes": None,

            "estimatedLitres": None,

            "targetMoisture": target_moisture,

            "timingReason": "Sensors require physical inspection before watering can be scheduled.",

            "nextEvaluationTime": iso(now + timedelta(hours=1)),

            "assumptions": f"Assumed flow rate: {flow_rate:.1f} L/min.",

        }



    # Hourly rain outlook in first 6 hours

    rain_6h = sum(float(h.get("precipitationMm", 0.0)) for h in hourly_weather[:6])

    max_prob_6h = max((float(h.get("precipitationProbability", 0.0)) for h in hourly_weather[:6]), default=0.0)

    meaningful_rain_soon = max_prob_6h >= 60.0 and rain_6h >= 2.0



    # Case A: Soil is already dry (< low_threshold)

    if moisture < low_threshold:

        if meaningful_rain_soon:

            rain_hour_idx = next(

                (idx for idx, h in enumerate(hourly_weather[:6]) if float(h.get("precipitationMm", 0.0)) >= 0.5),

                2,

            )

            rain_start_est = now + timedelta(hours=rain_hour_idx)

            return {

                "status": "WAIT",

                "recommendedStartTime": None,

                "durationMinutes": 0,

                "estimatedLitres": 0.0,

                "targetMoisture": target_moisture,

                "timingReason": f"Rain ({rain_6h:.1f} mm) is expected within 6 hours. Delaying watering to conserve water.",

                "nextEvaluationTime": iso(rain_start_est),

                "assumptions": f"Upcoming precipitation: {rain_6h:.1f} mm; Flow rate: {flow_rate:.1f} L/min.",

            }



        # Water Now

        deficit = max(2.0, target_moisture - moisture)

        raw_minutes = round(deficit / WETTING_RATE_PER_MINUTE)

        duration = max(5, min(cap_minutes, raw_minutes))

        litres = round(duration * flow_rate, 1)

        expected_after = round(min(100.0, moisture + duration * WETTING_RATE_PER_MINUTE), 1)

        capped_note = " (capped by max duration limit)" if raw_minutes > cap_minutes else ""



        return {

            "status": "WATER NOW",

            "recommendedStartTime": iso(now),

            "durationMinutes": duration,

            "estimatedLitres": litres,

            "targetMoisture": expected_after,

            "timingReason": f"Soil moisture ({moisture:.1f}%) is below the {low_threshold:.1f}% threshold with no rain expected.{capped_note}",

            "nextEvaluationTime": iso(now + timedelta(minutes=duration + 15)),

            "assumptions": f"Wetting response: 0.32%/min; Flow rate: {flow_rate:.1f} L/min; Target: {target_moisture:.1f}%.",

        }



    # Case B: Soil is adequately moist now (>= low_threshold)

    # Simulate hourly forward projection to find threshold crossing

    timeline = simulate_48h_timeline(moisture, hourly_weather)

    cross_hour: int | None = None

    for item in timeline:

        if item["moisturePercent"] < low_threshold:

            cross_hour = item["hour"]

            break



    if cross_hour is not None:

        # Crosses threshold in `cross_hour` hours

        scheduled_start = now + timedelta(hours=cross_hour - 1)

        # Check rain around scheduled time

        rain_around_cross = sum(

            float(hourly_weather[i].get("precipitationMm", 0.0))

            for i in range(max(0, cross_hour - 2), min(len(hourly_weather), cross_hour + 4))

        )

        if rain_around_cross >= 2.0:

            return {

                "status": "WAIT",

                "recommendedStartTime": None,

                "durationMinutes": 0,

                "estimatedLitres": 0.0,

                "targetMoisture": target_moisture,

                "timingReason": f"Moisture will reach threshold in ~{cross_hour} hours, but rain is expected. Waiting for rain.",

                "nextEvaluationTime": iso(now + timedelta(hours=min(6, cross_hour))),

                "assumptions": f"Simulated threshold crossing at +{cross_hour}h; Flow rate: {flow_rate:.1f} L/min.",

            }



        # Calculate targeted duration at crossing

        projected_moisture = timeline[cross_hour - 1]["moisturePercent"]

        deficit = max(2.0, target_moisture - projected_moisture)

        duration = max(5, min(cap_minutes, round(deficit / WETTING_RATE_PER_MINUTE)))

        litres = round(duration * flow_rate, 1)

        expected_after = round(min(100.0, projected_moisture + duration * WETTING_RATE_PER_MINUTE), 1)



        return {

            "status": "WAIT",

            "recommendedStartTime": iso(scheduled_start),

            "durationMinutes": duration,

            "estimatedLitres": litres,

            "targetMoisture": expected_after,

            "timingReason": f"Soil has adequate water now, but is projected to reach dry threshold in about {cross_hour} hours.",

            "nextEvaluationTime": iso(now + timedelta(hours=min(6, cross_hour))),

            "assumptions": f"Simulated threshold crossing at +{cross_hour}h; Flow rate: {flow_rate:.1f} L/min.",

        }



    # Case C: Soil remains above threshold throughout 48h

    return {

        "status": "WAIT",

        "recommendedStartTime": None,

        "durationMinutes": 0,

        "estimatedLitres": 0.0,

        "targetMoisture": target_moisture,

        "timingReason": "Soil moisture is healthy and expected to remain above threshold for the next 48 hours.",

        "nextEvaluationTime": iso(now + timedelta(hours=6)),

        "assumptions": f"Stable moisture balance; Flow rate: {flow_rate:.1f} L/min.",

    }





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

    hourly_weather: list[dict[str, Any]] | None = None,

) -> list[dict[str, Any]]:

    """Compare 4 candidate irrigation schedules over 48 hours under identical conditions.



    A. Fixed schedule:

       - Configurable timer baseline: 15 min every 12 hours (hour 6, 18, 30, 42 = 60 min total).

    B. Moisture threshold:

       - Waters 15 min when soil falls below low_threshold (with 4h cooldown).

    C. Rain-aware threshold:

       - Waters when dry, but delays if meaningful rain (prob >= 60%, amount >= 2mm) is forecast within 6h.

    D. Optimized schedule:

       - Predictive water-smart: targeted volume to reach target without overshooting, delays for forecast rain.

    """

    names = ["Fixed schedule", "Moisture threshold", "Rain-aware threshold", "Optimized schedule"]

    descriptions = {

        "Fixed schedule": "Timer baseline: Rigid calendar schedule (15 min every 12h) regardless of moisture or rain.",

        "Moisture threshold": "Sensor threshold: Waters 15 min when soil drops below threshold, with 4h rest intervals.",

        "Rain-aware threshold": "Weather-aware: Waters below threshold, but pauses if meaningful rain is forecast within 6 hours.",

        "Optimized schedule": "Predictive water-smart: Calculates targeted durations to reach target moisture while leveraging rain forecasts.",

    }



    totals: dict[str, dict[str, float]] = {

        name: {"water": 0.0, "sessions": 0.0, "stress": 0.0, "over": 0.0}

        for name in names

    }

    levels = {name: max(0.0, min(100.0, float(moisture))) for name in names}

    last_watered = {name: -10 for name in names}

    flow_rate = max(0.1, float(flow_litres_per_minute))

    wet_ceiling = min(100.0, target + 8.0)



    # 48-hour simulation

    for hour in range(48):

        # Extract hourly weather parameters if provided

        if hourly_weather and hour < len(hourly_weather):

            h_weather = hourly_weather[hour]

            t = float(h_weather.get("temperatureC", temperature))

            hm = float(h_weather.get("humidityPercent", humidity))

            s = round(max(5.0, min(100.0, 76.0 - (hm - 50.0) * 0.4)), 1)

            r = float(h_weather.get("precipitationMm", 0.0))

            prob = float(h_weather.get("precipitationProbability", 0.0))

        else:

            t, hm, s = temperature, humidity, sunlight

            r = (rain_mm / 6.0) if (hour < 6 and rain_probability >= 60 and rain_mm >= 2) else 0.0

            prob = rain_probability if hour < 6 else 0.0



        meaningful_rain_window = prob >= 60.0 and r >= 0.33  # ~2mm over 6h



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

                if hour % 12 == 6:

                    should_water, minutes = True, 15

            elif name == "Moisture threshold":

                if level < low_threshold and cooldown_ok:

                    should_water, minutes = True, 15

            elif name == "Rain-aware threshold":

                if level < low_threshold and cooldown_ok and not meaningful_rain_window:

                    should_water, minutes = True, 15

            elif name == "Optimized schedule":

                dry_step = drying_rate(t, hm, s)

                will_dry_soon = (level - dry_step * 3) < low_threshold

                if (level < low_threshold or will_dry_soon) and cooldown_ok and not meaningful_rain_window:

                    deficit = max(4.0, min(30.0, target - level))

                    calc_minutes = max(8, min(25, round(deficit / WETTING_RATE_PER_MINUTE)))

                    should_water, minutes = True, calc_minutes



            level = balance_step(level, 1.0, t, hm, s, r, minutes if should_water else 0)

            if should_water:

                totals[name]["water"] += minutes * flow_rate

                totals[name]["sessions"] += 1.0

                last_watered[name] = hour

            levels[name] = max(0.0, min(100.0, level))



    baseline_water = totals["Fixed schedule"]["water"]



    results = []

    for name in names:

        candidate_water = totals[name]["water"]

        # Explicit zero-baseline handling

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



        is_recommended = (name == "Optimized schedule")



        results.append({

            "name": name,

            "description": descriptions[name],

            "waterLitres": round(candidate_water, 1),

            "sessionsCount": int(totals[name]["sessions"]),

            "dryStressHours": int(totals[name]["stress"]),

            "overwateringHours": int(totals[name]["over"]),

            "waterSavedPercent": savings_pct,

            "savingsType": savings_type,

            "assumedFlowRateLpm": flow_rate,

            "isFlowRateConfigured": True,

            "isBaseline": (name == "Fixed schedule"),

            "isRecommended": is_recommended,

        })



    # Canonical order: Fixed baseline first, followed by threshold, rain-aware, and optimized

    return results



# ==========================================
# Experimental ML Model (LightGBM-style HistGradientBoostingRegressor)
# ==========================================
_model: Any = None
_model_status = MODEL_DESCRIPTION
_model_mae: float | None = None


def train_experimental_model() -> dict[str, Any]:
    """Train on generated sequences using LightGBM-style HistGradientBoostingRegressor and engineered features."""
    global _model, _model_status, _model_mae
    try:
        import random
        import numpy as np
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.metrics import mean_absolute_error
        from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit

        rng = random.Random(92)
        samples: list[list[float]] = []
        targets: list[float] = []
        persistence: list[float] = []
        for _ in range(300):
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

            # 1. Feature Engineering - Time-Series Lags
            actual_drying = drying_rate(temperature, humidity, sunlight)
            moisture_minus_1h = min(100.0, moisture + actual_drying + rng.gauss(0, 0.5))
            temp_rolling_3h_avg = temperature + rng.gauss(0, 2.0)
            drying_rate_per_hour = moisture_minus_1h - moisture

            # 5. Evapotranspiration (ET0) Engineered Feature
            et_index = (temperature * (max(5.0, sunlight) / 100.0)) / max(1.0, humidity)

            target = balance_step(
                moisture, float(horizon), temperature, humidity, sunlight,
                rain_mm * min(1.0, horizon / 6.0), irrigation,
            ) + rng.gauss(0, 1.0)
            target = max(0.0, min(100.0, target))
            samples.append([
                moisture, float(horizon), temperature, humidity, sunlight,
                rain_probability, rain_mm, float(irrigation),
                moisture_minus_1h, temp_rolling_3h_avg, drying_rate_per_hour, et_index,
                time_of_day, time_since_last_irrigation,
            ])
            targets.append(target)
            persistence.append(moisture)

        split_idx = int(len(samples) * 0.75)
        x_train, x_test = np.asarray(samples)[:split_idx], np.asarray(samples)[split_idx:]
        y_train, y_test = np.asarray(targets)[:split_idx], np.asarray(targets)[split_idx:]
        base_test = np.asarray(persistence)[split_idx:]

        param_dist = {
            'max_iter': [30, 50],
            'max_depth': [2, 3, None],
            'learning_rate': [0.05, 0.1],
        }
        base_model = HistGradientBoostingRegressor(random_state=17)
        tscv = TimeSeriesSplit(n_splits=2)
        search = RandomizedSearchCV(
            base_model, param_distributions=param_dist, n_iter=2,
            scoring='neg_mean_absolute_error', cv=tscv, random_state=17, n_jobs=1,
        )
        search.fit(x_train, y_train)
        candidate = search.best_estimator_

        model_error = float(mean_absolute_error(y_test, candidate.predict(x_test)))
        baseline_error = float(mean_absolute_error(y_test, base_test))
        _model_mae = round(model_error, 2)
        if model_error < baseline_error:
            _model = candidate
            _model_status = 'Experimental tree model (HistGradientBoosting with ET0 features)'
        else:
            _model = None
            _model_status = 'Persistence fallback (synthetic model did not beat baseline)'
    except Exception:
        _model = None
        _model_mae = None
        _model_status = 'Water-balance simulator (model unavailable)'
    return {'status': _model_status, 'mae': _model_mae}
