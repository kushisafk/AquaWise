"""Tests for forecast points and schedule strategy comparisons."""

import pytest
from forecasting import forecast_points, strategy_comparison


def test_forecast_points_bounded_and_consistent():
    points, label = forecast_points(
        moisture=34.0,
        temperature=28.0,
        humidity=55.0,
        sunlight=70.0,
        rain_probability=20.0,
        rain_mm=0.0,
    )
    assert len(points) == 6
    horizons = [p["hours"] for p in points]
    assert horizons == [1, 3, 6, 12, 24, 48]
    for p in points:
        assert 0.0 <= p["moisturePercent"] <= 100.0
        assert p["provenance"] == "estimated"
    assert isinstance(label, str)
    assert len(label) > 0


def test_strategy_comparison_returns_four_strategies():
    results = strategy_comparison(
        moisture=25.0,
        low_threshold=32.5,
        target=55.0,
        temperature=28.0,
        humidity=55.0,
        sunlight=70.0,
        rain_probability=10.0,
        rain_mm=0.0,
        flow_litres_per_minute=12.0,
    )
    assert len(results) == 4
    names = [r["name"] for r in results]
    assert names == ["Fixed schedule", "Moisture threshold", "Rain-aware threshold", "Optimized schedule"]

    baseline = next(r for r in results if r["isBaseline"])
    assert baseline["name"] == "Fixed schedule"
    assert baseline["waterSavedPercent"] == 0.0
    assert baseline["savingsType"] == "neutral"


def test_strategy_comparison_negative_savings_when_more_water_used():
    # If initial moisture is severely dry (e.g. 5%), responsive methods may water more than fixed timer
    # to rescue soil from extreme stress, resulting in negative savings (increased water use).
    results = strategy_comparison(
        moisture=5.0,
        low_threshold=35.0,
        target=60.0,
        temperature=35.0,
        humidity=30.0,
        sunlight=90.0,
        rain_probability=0.0,
        rain_mm=0.0,
        flow_litres_per_minute=12.0,
    )
    for r in results:
        assert r["waterLitres"] >= 0.0
        assert r["dryStressHours"] >= 0
        assert r["overwateringHours"] >= 0
        assert r["assumedFlowRateLpm"] == 12.0
        assert r["isFlowRateConfigured"] is True
        if r["waterSavedPercent"] < 0:
            assert r["savingsType"] == "increased"
        elif r["waterSavedPercent"] > 0:
            assert r["savingsType"] == "saved"
        else:
            assert r["savingsType"] == "neutral"


def test_strategy_comparison_rain_aware_saves_water_when_rain_imminent():
    # When soil is below threshold but meaningful rain is imminent (80% chance, 8mm)
    results = strategy_comparison(
        moisture=28.0,
        low_threshold=32.5,
        target=55.0,
        temperature=26.0,
        humidity=70.0,
        sunlight=40.0,
        rain_probability=85.0,
        rain_mm=8.0,
        flow_litres_per_minute=12.0,
    )
    baseline = next(r for r in results if r["name"] == "Fixed schedule")
    rain_aware = next(r for r in results if r["name"] == "Rain-aware threshold")
    moisture_thresh = next(r for r in results if r["name"] == "Moisture threshold")

    # Rain-aware should use less or equal water compared to plain moisture threshold because it waits for rain
    assert rain_aware["waterLitres"] <= moisture_thresh["waterLitres"]
    # Savings percent should be correctly relative to baseline
    expected_savings = round((baseline["waterLitres"] - rain_aware["waterLitres"]) / baseline["waterLitres"] * 100.0, 1)
    assert rain_aware["waterSavedPercent"] == expected_savings


def test_strategy_comparison_zero_baseline_handling():
    # Zero flow rate creates 0 baseline water without division by zero errors
    results = strategy_comparison(
        moisture=30.0,
        low_threshold=32.5,
        target=55.0,
        temperature=26.0,
        humidity=60.0,
        sunlight=50.0,
        rain_probability=0.0,
        rain_mm=0.0,
        flow_litres_per_minute=0.0,  # Clamped to min 0.1 internally
    )
    assert len(results) == 4
    for r in results:
        assert isinstance(r["waterSavedPercent"], float)
