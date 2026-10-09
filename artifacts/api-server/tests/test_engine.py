import pytest

from engine import calculate_recommendation, thresholds


def decide(**overrides):
    values = {
        "moisture": 32.4,
        "dry_point": 20,
        "wet_point": 70,
        "raining_now": False,
        "rain_probability_6h": 0,
        "precipitation_mm_6h": 0,
    }
    values.update(overrides)
    return calculate_recommendation(**values)


def test_calibration_thresholds_use_requested_range_percentages():
    assert thresholds(20, 70) == (32.5, 55.0)


def test_recommendation_threshold_boundary():
    assert decide(moisture=32.4)["status"] == "WATER NOW"
    assert decide(moisture=32.5)["status"] == "WAIT"


def test_rain_now_rule_takes_precedence_over_dry_soil():
    result = decide(moisture=5, raining_now=True)
    assert result["status"] == "WAIT"
    assert "rain" in result["reason"].lower()


def test_meaningful_rain_boundary_delays_watering():
    assert decide(
        moisture=20, rain_probability_6h=60, precipitation_mm_6h=2,
    )["status"] == "WAIT"
    assert decide(
        moisture=20, rain_probability_6h=59.9, precipitation_mm_6h=10,
    )["status"] == "WATER NOW"
    assert decide(
        moisture=20, rain_probability_6h=100, precipitation_mm_6h=1.9,
    )["status"] == "WATER NOW"


def test_missing_and_out_of_range_moisture_requires_field_check():
    assert decide(moisture=None)["status"] == "CHECK FIELD"
    assert decide(moisture=101)["status"] == "CHECK FIELD"


def test_stale_or_estimated_data_reduces_confidence():
    assert decide(forecast_stale=True)["confidence"] == "Medium"
    assert decide(forecast_stale=True, estimated=True)["confidence"] == "Low"


def test_calibration_rejects_reversed_points():
    with pytest.raises(ValueError):
        thresholds(70, 20)
