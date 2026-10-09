"""Pure, deterministic irrigation decision rules used by AquaWise."""

from __future__ import annotations

from typing import Any


TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        "invalid": "The moisture reading is unavailable. Check the field before watering.",
        "raining": "It is raining now, so wait and let the soil absorb the water.",
        "rain_soon": "The soil is dry, but useful rain is expected within 6 hours. Wait and check again after the rain.",
        "dry": "Soil moisture is below your calibrated dry threshold and no useful rain is expected soon.",
        "sufficient": "Soil moisture is above the calibrated dry threshold. No watering is needed now.",
        "dry_later": "The field is moist enough now, but the forecast suggests it may become dry in about {hours} hours.",
        "moisture": "Soil moisture",
        "rain_now": "Rain right now",
        "forecast": "Forecast rain",
        "conditions": "Drying conditions",
        "estimate": "Estimated moisture",
        "supports": "Moisture is below the calibrated threshold.",
        "rain_supports": "Current rain is adding water to the soil.",
        "forecast_supports": "Useful rain is expected within 6 hours.",
        "forecast_delays": "No meaningful rain is expected within 6 hours.",
        "stale": "Weather information is stale; confidence is reduced.",
        "sensor": "The moisture value is estimated because a sensor fault was simulated.",
        "conditions_detail": "Temperature, humidity and sunlight affect the drying estimate.",
    },
    "te": {
        "invalid": "తేమ రీడింగ్ అందుబాటులో లేదు. నీరు పెట్టే ముందు పొలాన్ని తనిఖీ చేయండి.",
        "raining": "ఇప్పుడు వర్షం పడుతోంది. నీరు నేలలో ఇంకే వరకు వేచి ఉండండి.",
        "rain_soon": "నేల పొడిగా ఉంది, కానీ 6 గంటల్లో వర్షం వచ్చే అవకాశం ఉంది. వేచి ఉండి తర్వాత మళ్లీ తనిఖీ చేయండి.",
        "dry": "నేల తేమ మీ పొడి పరిమితి కంటే తక్కువగా ఉంది; త్వరలో ఉపయోగకరమైన వర్షం లేదు.",
        "sufficient": "నేల తేమ పొడి పరిమితి కంటే ఎక్కువగా ఉంది. ఇప్పుడు నీరు అవసరం లేదు.",
        "dry_later": "ఇప్పుడు తేమ సరిపోతుంది, కానీ సుమారు {hours} గంటల్లో పొడిగా మారవచ్చు.",
        "moisture": "నేల తేమ",
        "rain_now": "ఇప్పటి వర్షం",
        "forecast": "వర్ష సూచన",
        "conditions": "ఎండబెట్టే పరిస్థితులు",
        "estimate": "అంచనా తేమ",
        "supports": "తేమ నిర్ణయించిన పరిమితి కంటే తక్కువగా ఉంది.",
        "rain_supports": "ప్రస్తుత వర్షం నేలకు నీటిని అందిస్తోంది.",
        "forecast_supports": "6 గంటల్లో ఉపయోగకరమైన వర్షం వచ్చే అవకాశం ఉంది.",
        "forecast_delays": "6 గంటల్లో గణనీయమైన వర్షం లేదు.",
        "stale": "వాతావరణ సమాచారం పాతది; నమ్మక స్థాయి తగ్గించబడింది.",
        "sensor": "సెన్సార్ లోపం అనుకరించబడింది; తేమ అంచనా మాత్రమే.",
        "conditions_detail": "ఉష్ణోగ్రత, తేమ మరియు సూర్యకాంతి ఎండే వేగాన్ని ప్రభావితం చేస్తాయి.",
    },
    "hi": {
        "invalid": "मिट्टी की नमी उपलब्ध नहीं है। पानी देने से पहले खेत की जाँच करें।",
        "raining": "अभी बारिश हो रही है। पानी को मिट्टी में जाने दें और प्रतीक्षा करें।",
        "rain_soon": "मिट्टी सूखी है, लेकिन 6 घंटे में उपयोगी बारिश संभव है। प्रतीक्षा करें और बाद में जाँचें।",
        "dry": "मिट्टी की नमी तय सूखे स्तर से कम है और जल्द उपयोगी बारिश की उम्मीद नहीं है।",
        "sufficient": "मिट्टी की नमी तय सूखे स्तर से ऊपर है। अभी पानी देने की ज़रूरत नहीं है।",
        "dry_later": "अभी नमी पर्याप्त है, लेकिन लगभग {hours} घंटे में खेत सूखा हो सकता है।",
        "moisture": "मिट्टी की नमी",
        "rain_now": "अभी की बारिश",
        "forecast": "बारिश का पूर्वानुमान",
        "conditions": "सूखने की स्थिति",
        "estimate": "अनुमानित नमी",
        "supports": "नमी तय सीमा से कम है।",
        "rain_supports": "अभी की बारिश मिट्टी में पानी जोड़ रही है।",
        "forecast_supports": "6 घंटे में उपयोगी बारिश की संभावना है।",
        "forecast_delays": "6 घंटे में उपयोगी बारिश की संभावना नहीं है।",
        "stale": "मौसम की जानकारी पुरानी है; भरोसे का स्तर घटाया गया है।",
        "sensor": "सेंसर की खराबी का अनुकरण किया गया है; नमी अनुमानित है।",
        "conditions_detail": "तापमान, नमी और धूप मिट्टी के सूखने की गति को बदलते हैं।",
    },
}


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
    estimated: bool = False,
    temperature_c: float = 26,
    humidity_percent: float = 60,
    sunlight_percent: float = 55,
    max_duration_minutes: int = 45,
    forecast_moisture_6h: float | None = None,
    language: str = "en",
) -> dict[str, Any]:
    """Apply the specified ordered rules. No randomness or I/O is used."""
    low, target = thresholds(dry_point, wet_point)
    t = TRANSLATIONS.get(language, TRANSLATIONS["en"])
    useful_rain = rain_probability_6h >= 60 and precipitation_mm_6h >= 2
    factors: list[dict[str, Any]] = []

    if moisture is None or not 0 <= moisture <= 100:
        return {
            "status": "CHECK FIELD",
            "reason": t["invalid"],
            "confidence": "Low",
            "durationMinutes": None,
            "factors": [{
                "name": t["estimate"], "effect": "caution",
                "detail": t["invalid"], "rank": 1,
            }],
            "provenance": "stale" if forecast_stale else ("estimated" if estimated else "simulated"),
        }

    factors.append({
        "name": t["estimate"] if estimated else t["moisture"],
        "effect": "supports" if moisture < low else "caution",
        "detail": t["supports"] if moisture < low else t["sufficient"],
        "rank": 1,
    })
    if raining_now:
        factors.append({
            "name": t["rain_now"], "effect": "delays",
            "detail": t["rain_supports"], "rank": 2,
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
    factors.append({
        "name": t["conditions"], "effect": "caution",
        "detail": t["conditions_detail"], "rank": 3,
    })
    if forecast_stale:
        factors.append({
            "name": t["forecast"], "effect": "caution",
            "detail": t["stale"], "rank": 4,
        })
    if estimated:
        factors.append({
            "name": t["estimate"], "effect": "caution",
            "detail": t["sensor"], "rank": 5,
        })

    duration: int | None = None
    if raining_now:
        status, reason = "WAIT", t["raining"]
    elif moisture < low and useful_rain:
        status, reason = "WAIT", t["rain_soon"]
    elif moisture < low:
        status, reason = "WATER NOW", t["dry"]
        duration = max(5, min(max_duration_minutes, round((target - moisture) / 0.32)))
    else:
        status, reason = "WAIT", t["sufficient"]
        if forecast_moisture_6h is not None and forecast_moisture_6h < low:
            status = "WAIT"
            reason = t["dry_later"].format(hours=6)

    confidence = "High"
    if forecast_stale or estimated:
        confidence = "Medium"
    if forecast_stale and estimated:
        confidence = "Low"
    if status == "CHECK FIELD":
        confidence = "Low"
    return {
        "status": status,
        "reason": reason,
        "confidence": confidence,
        "durationMinutes": duration,
        "factors": sorted(factors, key=lambda item: item["rank"]),
        "provenance": "stale" if forecast_stale else ("estimated" if estimated else "simulated"),
    }
