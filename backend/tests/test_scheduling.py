"""Automated unit tests for dynamic irrigation scheduling and water-balance simulation."""

import pytest
from datetime import datetime, timedelta, timezone

from forecasting import (
    balance_step,
    drying_rate,
    generate_irrigation_schedule,
    simulate_48h_timeline,
    WETTING_RATE_PER_MINUTE,
)


def mock_dry_weather_48h():
    now = datetime(2026, 10, 10, 10, 0, 0, tzinfo=timezone.utc)
    return [
        {
            "time": (now + timedelta(hours=i)).isoformat(),
            "temperatureC": 30.0,
            "humidityPercent": 50.0,
            "precipitationProbability": 0.0,
            "precipitationMm": 0.0,
        }
        for i in range(48)
    ]


def mock_rainy_weather_48h():
    now = datetime(2026, 10, 10, 10, 0, 0, tzinfo=timezone.utc)
    return [
        {
            "time": (now + timedelta(hours=i)).isoformat(),
            "temperatureC": 24.0,
            "humidityPercent": 80.0,
            "precipitationProbability": 90.0 if i < 6 else 10.0,
            "precipitationMm": 2.5 if i < 4 else 0.0,
        }
        for i in range(48)
    ]


def test_schedule_duration_scales_with_moisture_deficit():
    weather_48h = mock_dry_weather_48h()
    low = 32.5
    target = 55.0

    # Soil slightly dry (30% -> deficit 25%)
    sch1 = generate_irrigation_schedule(
        moisture=30.0,
        low_threshold=low,
        target_moisture=target,
        flow_litres_per_minute=12.0,
        max_duration_minutes=90,
        hourly_weather=weather_48h,
    )
    assert sch1["status"] == "WATER NOW"
    duration1 = sch1["durationMinutes"]

    # Soil severely dry (15% -> deficit 40%)
    sch2 = generate_irrigation_schedule(
        moisture=15.0,
        low_threshold=low,
        target_moisture=target,
        flow_litres_per_minute=12.0,
        max_duration_minutes=150,
        hourly_weather=weather_48h,
    )
    assert sch2["status"] == "WATER NOW"
    duration2 = sch2["durationMinutes"]

    # Greater deficit must require longer duration
    assert duration2 > duration1
    assert sch2["estimatedLitres"] > sch1["estimatedLitres"]


def test_schedule_delays_when_meaningful_rain_imminent():
    rainy = mock_rainy_weather_48h()
    sch = generate_irrigation_schedule(
        moisture=25.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=60,
        hourly_weather=rainy,
    )
    # Even though soil is dry (25% < 32.5%), rain is expected soon -> status must be WAIT
    assert sch["status"] == "WAIT"
    assert "rain" in sch["timingReason"].lower()
    assert sch["durationMinutes"] == 0
    assert sch["estimatedLitres"] == 0.0


def test_schedule_predicts_future_crossing_when_moist():
    dry_weather = mock_dry_weather_48h()
    # Soil is 35% (above 32.5% low threshold), but under 30°C sun it dries at ~0.15%/h
    # Crossing will happen in ~16 hours
    sch = generate_irrigation_schedule(
        moisture=35.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=60,
        hourly_weather=dry_weather,
    )
    assert sch["status"] == "WAIT"
    assert sch["recommendedStartTime"] is not None
    assert "dry threshold" in sch["timingReason"].lower()


def test_schedule_enforces_max_duration_cap():
    dry_weather = mock_dry_weather_48h()
    # 5% moisture to 55% target requires ~156 minutes.
    # When cap is 45 minutes, must cap at 45 minutes
    sch = generate_irrigation_schedule(
        moisture=5.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=45,
        hourly_weather=dry_weather,
    )
    assert sch["status"] == "WATER NOW"
    assert sch["durationMinutes"] == 45
    assert sch["estimatedLitres"] == 45 * 12.0
    assert "capped" in sch["timingReason"].lower()


def test_schedule_volume_calculation():
    dry_weather = mock_dry_weather_48h()
    sch = generate_irrigation_schedule(
        moisture=25.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=15.5,
        max_duration_minutes=60,
        hourly_weather=dry_weather,
    )
    assert sch["estimatedLitres"] == round(sch["durationMinutes"] * 15.5, 1)


def test_simulation_bounds_and_effects():
    # Test lower bound (cannot go below 0)
    low_step = balance_step(2.0, 100.0, 45.0, 10.0, 100.0, 0.0, 0.0)
    assert low_step == 0.0

    # Test upper bound (cannot exceed 100)
    high_step = balance_step(90.0, 0.5, 20.0, 90.0, 10.0, 50.0, 60.0)
    assert high_step == 100.0

    # Rain and irrigation add water
    baseline = balance_step(40.0, 1.0, 25.0, 60.0, 50.0, 0.0, 0.0)
    with_rain = balance_step(40.0, 1.0, 25.0, 60.0, 50.0, 5.0, 0.0)
    with_irr = balance_step(40.0, 1.0, 25.0, 60.0, 50.0, 0.0, 15.0)
    assert with_rain > baseline
    assert with_irr > baseline


def test_simulation_smooth_trajectory_no_unexplained_jumps():
    weather_48h = mock_dry_weather_48h()
    timeline = simulate_48h_timeline(45.0, weather_48h)
    assert len(timeline) == 48

    for i in range(1, len(timeline)):
        prev = timeline[i - 1]["moisturePercent"]
        curr = timeline[i]["moisturePercent"]
        # Under dry conditions with no rain or watering, hourly drop should be steady drying (0.02% to 0.4%)
        diff = prev - curr
        assert 0.0 <= diff <= 0.5, f"Unexplained moisture jump or drop at hour {i}: {prev} -> {curr}"


def test_schedule_recalculates_when_soil_becomes_moist():
    weather_48h = mock_dry_weather_48h()

    # Step 1: dry soil -> WATER NOW
    sch_dry = generate_irrigation_schedule(
        moisture=25.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=60,
        hourly_weather=weather_48h,
    )
    assert sch_dry["status"] == "WATER NOW"
    assert sch_dry["durationMinutes"] > 0

    # Step 2: after watering, soil becomes 55% -> WAIT
    sch_wet = generate_irrigation_schedule(
        moisture=55.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=60,
        hourly_weather=weather_48h,
    )
    assert sch_wet["status"] == "WAIT"
    assert sch_wet["durationMinutes"] == 0


def test_schedule_zero_flow_and_invalid_soil():
    weather_48h = mock_dry_weather_48h()

    # Invalid soil moisture
    sch_invalid = generate_irrigation_schedule(
        moisture=None,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=12.0,
        max_duration_minutes=60,
        hourly_weather=weather_48h,
    )
    assert sch_invalid["status"] == "CHECK FIELD"
    assert sch_invalid["durationMinutes"] is None

    # Zero flow rate is safely clamped
    sch_zero_flow = generate_irrigation_schedule(
        moisture=20.0,
        low_threshold=32.5,
        target_moisture=55.0,
        flow_litres_per_minute=0.0,
        max_duration_minutes=60,
        hourly_weather=weather_48h,
    )
    assert sch_zero_flow["status"] == "WATER NOW"
    assert sch_zero_flow["estimatedLitres"] is not None

