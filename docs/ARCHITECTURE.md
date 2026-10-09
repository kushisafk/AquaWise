# AquaWise — System Architecture & Design

AquaWise is a weather-aware irrigation decision support system designed to answer a single question for farmers in plain language: **"Should I water now?"**

This document details the multi-tier system architecture, data pipelines, decision algorithms, and machine learning components.

---

## 1. High-Level Architecture

AquaWise spans three interconnected tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 1: FIELD HARDWARE RIG                   │
│                                                                 │
│  - Microcontroller (ESP32 / Arduino UNO Q)                      │
│  - Sensors: Soil Moisture, Rain Detector, DHT11, Solar Cell     │
│  - Actuators: Servo Motor (Trigger v1) / Relay + Pump           │
│  - Local UI: 0.96" I2C OLED, Buzzer Patterns, Hardware Button   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ MQTT over Wi-Fi (JSON Payloads)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TIER 2: BACKEND SERVICE                     │
│                                                                 │
│  - FastAPI Web Service (REST API + Server-Sent Events / SSE)    │
│  - SQLite Local Database (Telemetry, Calibration, Events)       │
│  - Weather Integration (Open-Meteo Forecast Client + Cache)     │
│  - 3-Layer Decision Engine:                                     │
│      * Layer 1: Deterministic Rules Baseline (Always Active)    │
│      * Layer 2: Soil Moisture Forecasting (scikit-learn / Sim)  │
│      * Layer 3: Schedule Comparison (4 Strategies Analyzed)     │
│  - Sensor Fault Detection & Imputation Estimator                │
│  - Self-Learning Loop (Self-Calibration & Retraining Gate)      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS / REST / SSE Stream
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TIER 3: FARMER WEB APP (PWA)                    │
│                                                                 │
│  - Mobile-First Progressive Web App (React + Vite + Tailwind)   │
│  - Trilingual Support: English, Telugu (తెలుగు), Hindi (हिन्दी)  │
│  - Real-Time Decision Card: WATER NOW / WAIT / CHECK FIELD      │
│  - Explainable AI: Ranked Decision Factors & Confidence         │
│  - Offline Service Worker Cache with Stale Data Warning         │
│  - Interactive Calibration, Settings & Demonstration Test Mode  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Decision Engine Layers

The backend decision engine (`artifacts/api-server/engine.py` and `forecasting.py`) evaluates live data using a three-tiered hierarchy:

### Layer 1: Deterministic Rules Baseline (Always Active)
Ensures safe, dependable operation even when the weather API, ML models, or internet connection are unavailable.

- **Dynamic Thresholds**: Calculated from farmer calibration:
  - `dry_point`: Minimum sensor baseline (default: 20%)
  - `wet_point`: Saturated sensor baseline (default: 70%)
  - `low_threshold`: $dry + 0.25 \times (wet - dry)$
  - `target_threshold`: $dry + 0.70 \times (wet - dry)$
- **Evaluation Order**:
  1. **Sensor Fault**: If soil moisture is invalid/missing without a confident estimate $\rightarrow$ **CHECK FIELD**.
  2. **Active Rain**: If raining now $\rightarrow$ **WAIT** (*"It is raining"*).
  3. **Low Soil Moisture**:
     - If forecast rain $\ge 2\text{ mm}$ and probability $\ge 60\%$ within 6 hours $\rightarrow$ **WAIT** (*"Rain expected soon"*).
     - Otherwise $\rightarrow$ **WATER NOW** (*"Soil is dry and needs water"*), suggesting a run duration to reach target.
  4. **Approaching Dry**: If currently adequate but predicted to cross `low` threshold within the forecast window $\rightarrow$ **WAIT** (*"Water later at HH:MM"*).
  5. **Adequate Moisture**: Otherwise $\rightarrow$ **WAIT** (*"Soil has enough water"*).

### Layer 2: Moisture Forecasting Engine
- Predicts short-term soil moisture at $+1, +3, +6, +12, +24, +48$ hours.
- Uses temperature, humidity, solar radiation, historical moisture trends, and forecast precipitation.
- Evaluated against a **persistence baseline** (assumption that moisture remains unchanged). If the ML model does not beat persistence on held-out data, the system falls back to a transparent water-balance physics simulator.

### Layer 3: Irrigation Schedule Optimization
Simulates 4 candidate irrigation strategies over a 48-hour forward horizon:
1. **Fixed Schedule**: Waters at set daily intervals (baseline representing standard practice).
2. **Threshold Schedule**: Waters whenever moisture drops below the `low` threshold.
3. **Rain-Aware Schedule**: Waters on low moisture, but skips/delays when rain is forecast.
4. **Optimized Schedule**: Minimizes water use while constraining moisture within the target band.

Each schedule outputs:
- Estimated water consumption (liters)
- Dry-stress hours (hours crop is under-watered)
- Over-water hours (hours moisture exceeds healthy ceiling)

---

## 3. Sensor Fault Handling & Imputation

When sensor anomalies occur, the system detects them within 3 reporting cycles:
- **Disconnect / Short**: ADC reading at floor or ceiling limits.
- **Flat-Line**: Sensor value shows zero variation despite changing ambient conditions.
- **Spike Anomaly**: Moisture jump exceeds physical soil hydraulic conductivity.
- **Missing Telemetry**: Heartbeat timeout exceeding 30 seconds.

**Response & Imputation**:
- The backend imputes the missing soil moisture value using the last valid reading, solar/temperature evapotranspiration estimates, and recent watering records.
- Estimated data is explicitly flagged as **`source: "estimated"`** with decaying confidence.
- Extended outages automatically downgrade status to **CHECK FIELD** and dispatch alerts.

---

## 4. Real-Time Communication

- **Device to Backend**: MQTT over Wi-Fi (`aquawise/field1/#`).
- **Backend to Frontend**:
  - **REST API**: For configuration, history, calibration, manual overrides.
  - **Server-Sent Events (`GET /api/events`)**: Pushes updated telemetry, decisions, and system alerts to connected clients in real time.
- **Offline / PWA Sync**:
  - Service worker caches the application shell and the last successful `/api/field` snapshot.
  - When offline, cached values are shown with a visible **"Stale / Offline"** warning banner. Writes and valve actuations are locked until reconnect.
