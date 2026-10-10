"""Pure, deterministic irrigation decision rules used by AquaWise.

Following PRD Section 9.1:
- Inputs: calibrated moisture, dry/wet points, rain-now, forecast rain (prob & mm),
  temperature, humidity, sunlight, flow rate, max duration, staleness/unavailability.
- Rule order:
  1. Soil invalid / no reliable reading -> CHECK FIELD
  2. Raining now -> WAIT ("It is raining now")
  3. Moisture < low threshold:
     - if meaningful rain forecast within 6h (prob >= 60% and mm >= 2.0) -> WAIT ("Rain expected soon")
     - else -> WATER NOW with dynamically calculated duration
  4. Moisture adequate now, but forecast predicts crossing low threshold within 6h -> WAIT ("Soil may dry out in about X hours")
  5. Otherwise -> WAIT ("Soil has enough water")
- Accounts for stale/unavailable weather (honest confidence reduction; never assumes missing weather = 0% rain).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        "invalid": "Moisture reading unavailable. Please check your soil.",
        "raining": "It is raining now. Let the rain water your crops.",
        "rain_soon": "Soil is dry, but rain is expected soon. Wait for the rain.",
        "dry": "Soil is dry and no rain is expected. Water your field.",
        "dry_capped": "Soil is dry. Watering capped by maximum duration limit ({cap} min).",
        "sufficient": "Soil has enough moisture. No watering needed right now.",
        "dry_later": "Soil is moist now, but may dry out in about {hours} hours.",
        "moisture": "Soil moisture",
        "rain_now": "Rain right now",
        "forecast": "Rain forecast",
        "conditions": "Drying conditions",
        "estimate": "Estimated moisture",
        "supports": "Soil is dry.",
        "rain_supports": "Current rain is adding water to the soil.",
        "forecast_supports": "Useful rain is expected within 6 hours.",
        "forecast_delays": "No meaningful rain is expected within 6 hours.",
        "stale": "Weather information is old.",
        "weather_unavailable": "Weather forecast is unavailable; exercise caution.",
        "sensor": "Soil reading is an estimate.",
        "conditions_detail": "Heat and sun affect how fast soil dries.",
    },
    "te": {
        "invalid": "తేమ రీడింగ్ లేదు. దయచేసి పొలాన్ని తనిఖీ చేయండి.",
        "raining": "ఇప్పుడు వర్షం పడుతోంది. నీరు అవసరం లేదు.",
        "rain_soon": "నేల పొడిగా ఉంది, కానీ త్వరలో వర్షం రానుంది. వేచి ఉండండి.",
        "dry": "నేల ఎండిపోయింది, వర్షం లేదు. నీరు పెట్టండి.",
        "dry_capped": "నేల ఎండిపోయింది. గరిష్ట సమయ పరిమితి ({cap} నిమిషాలు) వర్తింపజేయబడింది.",
        "sufficient": "నేలలో సరిపడా తేమ ఉంది. ఇప్పుడు నీరు అవసరం లేదు.",
        "dry_later": "ఇప్పుడు తేమ బాగుంది, కానీ సుమారు {hours} గంటల్లో ఎండవచ్చు.",
        "moisture": "నేల తేమ",
        "rain_now": "ఇప్పటి వర్షం",
        "forecast": "వర్ష సూచన",
        "conditions": "ఎండబెట్టే పరిస్థితులు",
        "estimate": "అంచనా తేమ",
        "supports": "నేల ఎండిపోయింది.",
        "rain_supports": "వర్షం నేలకు నీటిని అందిస్తోంది.",
        "forecast_supports": "6 గంటల్లో వర్షం వచ్చే అవకాశం ఉంది.",
        "forecast_delays": "6 గంటల్లో వర్షం సూచన లేదు.",
        "stale": "వాతావరణ సమాచారం పాతది.",
        "weather_unavailable": "వాతావరణ సమాచారం అందుబాటులో లేదు. జాగ్రత్తగా ఉండండి.",
        "sensor": "తేమ అంచనా మాత్రమే.",
        "conditions_detail": "ఎండ మరియు వేడి వల్ల నేల త్వరగా ఎండుతుంది.",
    },
    "hi": {
        "invalid": "नमी की रीडिंग नहीं मिल रही है। कृपया खेत देखें।",
        "raining": "अभी बारिश हो रही है। पानी देने की ज़रूरत नहीं है।",
        "rain_soon": "मिट्टी सूखी है, लेकिन जल्द बारिश संभव है। इंतज़ार करें।",
        "dry": "मिट्टी सूखी है और बारिश नहीं है। खेत में पानी दें।",
        "dry_capped": "मिट्टी सूखी है। अधिकतम समय सीमा ({cap} मिनट) लागू की गई।",
        "sufficient": "मिट्टी में पर्याप्त पानी है। अभी पानी की ज़रूरत नहीं है।",
        "dry_later": "अभी नमी ठीक है, पर लगभग {hours} घंटे में खेत सूख सकता है।",
        "moisture": "मिट्टी की नमी",
        "rain_now": "अभी की बारिश",
        "forecast": "बारिश का पूर्वानुमान",
        "conditions": "सूखने की स्थिति",
        "estimate": "अनुमानित नमी",
        "supports": "मिट्टी सूखी है।",
        "rain_supports": "बारिश से खेत को पानी मिल रहा है।",
        "forecast_supports": "6 घंटे में बारिश की संभावना है।",
        "forecast_delays": "6 घंटे में बारिश की उम्मीद नहीं है।",
        "stale": "मौसम की जानकारी पुरानी है।",
        "weather_unavailable": "मौसम की जानकारी उपलब्ध नहीं है। सावधानी रखें।",
        "sensor": "नमी का केवल अनुमान लगाया गया है।",
        "conditions_detail": "धूप और गर्मी से मिट्टी जल्दी सूखती है।",
    },
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def thresholds(dry_point: float, wet_point: float) -> tuple[float, float]:
    """Return calibrated low threshold and target moisture."""
    if not (0 <= dry_point < wet_point <= 100):
        raise ValueError("Wet calibration must be greater than dry calibration.")
    span = wet_point - dry_point
    return round(dry_point + 0.25 * span, 1), round(dry_point + 0.70 * span, 1)


def calculate_recommendation(
    *,
    moisture: float | None,
    dry_point: float,
    wet_point: float,
    raining_now: bool,
    rain_probability_6h: float,
    precipitation_mm_6h: float,
    forecast_stale: bool = False,
    weather_unavailable: bool = False,
    estimated: bool = False,
    temperature_c: float = 26,
    humidity_percent: float = 60,
    sunlight_percent: float = 55,
    max_duration_minutes: int = 45,
    flow_litres_per_minute: float = 12.0,
    forecast_moisture_6h: float | None = None,
    time_of_day: float = 12.0,
    time_since_last_irrigation: float = 24.0,
    language: str = "en",
    current_time: datetime | None = None,
) -> dict[str, Any]:
    """Apply the specified ordered rules. Deterministic and explainable."""
    now = current_time or now_utc()
    low, target = thresholds(dry_point, wet_point)
    t = TRANSLATIONS.get(language, TRANSLATIONS["en"])
    useful_rain = rain_probability_6h >= 60.0 and precipitation_mm_6h >= 2.0
    factors: list[dict[str, Any]] = []

    # 1. Invalid soil reading
    if moisture is None or not (0.0 <= moisture <= 100.0):
        return {
            "status": "CHECK FIELD",
            "reason": t["invalid"],
            "confidence": "Low",
            "durationMinutes": None,
            "estimatedLitres": None,
            "suggestedStartTime": None,
            "nextCheckTime": iso(now + timedelta(hours=1)),
            "targetMoisture": target,
            "lowThreshold": low,
            "factors": [{
                "name": t["estimate"], "effect": "caution",
                "detail": t["invalid"], "rank": 1,
            }],
            "provenance": "stale" if forecast_stale else ("estimated" if estimated else "simulated"),
        }

    # Factor 1: Soil moisture
    factors.append({
        "name": t["estimate"] if estimated else t["moisture"],
        "effect": "supports" if moisture < low else "caution",
        "detail": t["supports"] if moisture < low else t["sufficient"],
        "rank": 1,
    })

    # Factor 2: Rain
    if raining_now:
        factors.append({
            "name": t["rain_now"], "effect": "delays",
            "detail": t["rain_supports"], "rank": 2,
        })
    elif weather_unavailable:
        factors.append({
            "name": t["forecast"], "effect": "caution",
            "detail": t["weather_unavailable"], "rank": 2,
        })
    elif useful_rain:
        factors.append({
            "name": t["forecast"], "effect": "delays",
            "detail": t["forecast_supports"], "rank": 2,
        })
    else:
        factors.append({
            "name": t["forecast"], "effect": "supports",
            "detail": t["forecast_delays"], "rank": 2,
        })

    # Factor 3: Environmental conditions
    factors.append({
        "name": t["conditions"], "effect": "caution",
        "detail": t["conditions_detail"], "rank": 3,
    })

    # Factor 4: Stale / missing weather
    if forecast_stale:
        factors.append({
            "name": t["forecast"], "effect": "caution",
            "detail": t["stale"], "rank": 4,
        })
    elif weather_unavailable:
        factors.append({
            "name": t["forecast"], "effect": "caution",
            "detail": t["weather_unavailable"], "rank": 4,
        })

    # Factor 5: Estimated sensor reading
    if estimated:
        factors.append({
            "name": t["estimate"], "effect": "caution",
            "detail": t["sensor"], "rank": 5,
        })

    duration: int | None = None
    suggested_start: str | None = None
    next_check: str = iso(now + timedelta(hours=6))

    # 2. Raining now
    if raining_now:
        status, reason = "WAIT", t["raining"]
        next_check = iso(now + timedelta(hours=2))
    # 3. Moisture < low and rain coming soon
    elif moisture < low and useful_rain:
        status, reason = "WAIT", t["rain_soon"]
        next_check = iso(now + timedelta(hours=3))
    # 4. Moisture < low and no rain
    elif moisture < low:
        status = "WATER NOW"
        suggested_start = iso(now)
        # Dynamic duration to reach target
        raw_duration = round((target - moisture) / 0.32)
        duration = max(5, min(max_duration_minutes, raw_duration))
        if raw_duration > max_duration_minutes:
            reason = t["dry_capped"].format(cap=max_duration_minutes)
        else:
            reason = t["dry"]
        next_check = iso(now + timedelta(minutes=duration + 15))
    # 5. Moisture >= low, but forecast predicts dropping below low
    elif forecast_moisture_6h is not None and forecast_moisture_6h < low:
        status, reason = "WAIT", t["dry_later"].format(hours=6)
        suggested_start = iso(now + timedelta(hours=5))
        next_check = iso(now + timedelta(hours=4))
    # 6. Moisture is healthy
    else:
        status, reason = "WAIT", t["sufficient"]
        next_check = iso(now + timedelta(hours=6))

    estimated_litres = round(duration * max(0.1, flow_litres_per_minute), 1) if duration is not None else None

    # Determine confidence honestly
    confidence = "High"
    if forecast_stale or estimated or weather_unavailable:
        confidence = "Medium"
    if (forecast_stale or weather_unavailable) and estimated:
        confidence = "Low"
    if status == "CHECK FIELD":
        confidence = "Low"

    return {
        "status": status,
        "reason": reason,
        "confidence": confidence,
        "durationMinutes": duration,
        "estimatedLitres": estimated_litres,
        "suggestedStartTime": suggested_start,
        "nextCheckTime": next_check,
        "targetMoisture": target,
        "lowThreshold": low,
        "factors": sorted(factors, key=lambda item: item["rank"]),
        "provenance": "stale" if (forecast_stale or weather_unavailable) else ("estimated" if estimated else "simulated"),
    }
