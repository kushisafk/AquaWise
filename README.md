# AquaWise: Weather-Aware Irrigation Decision Support

[![React](https://img.shields.io/badge/Frontend-React%2019%20%7C%20Vite%20%7C%20Tailwind-blue.svg)](artifacts/aquawise)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%7C%20Python%203.11+-009688.svg)](artifacts/api-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](tsconfig.json)
[![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-success.svg)](artifacts/aquawise/public)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Event](https://img.shields.io/badge/Hackathon-IARE%20HackVerse%202026--27-orange.svg)](docs/PRD.md)

> **"Should I water now?"**  
> AquaWise is a mobile-first, weather-aware irrigation decision support system. It combines live field telemetry (soil moisture, rain, temperature, humidity, and solar intensity) with hyper-local forecast data to provide explainable recommendations: **WATER NOW**, **WAIT**, or **CHECK FIELD**.

---

## 🌟 Key Features

- **Farmer-First Simplicity**: One screen, one clear answer, one sentence explanation. Supports **English**, **Telugu (తెలుగు)**, and **Hindi (हिन्दी)**.
- **Explainable Decision Engine**: Transparently ranks the environmental factors driving each recommendation (e.g., soil moisture, incoming rainfall, heat index) with confidence levels.
- **Weather-Aware Intelligence**: Integrates live Open-Meteo forecasts to avoid irrigating when meaningful rain ($\ge 2\text{ mm}$, $\ge 60\%$ probability) is imminent.
- **ML Soil Moisture Forecasting**: Simulates short-term moisture dynamics (+1 to +48 hrs) and compares 4 candidate schedules (Fixed, Threshold, Rain-Aware, and Optimized) to quantify water savings.
- **Fault-Tolerant & Safe by Default**: Detects sensor disconnections, flat-lines, and spikes within 3 cycles. Imputes missing values with decaying confidence and falls back to deterministic safety rules.
- **Manual Override & Bounded Runs**: Full farmer control to start (with auto-expiring timer) or stop irrigation instantly. Stop always takes priority.
- **Installable PWA**: Works offline on Android Chrome and desktop via Service Workers, indicating stale data when disconnected.
- **Hardware-Swappable Edge Contract**: Standardized MQTT JSON contract compatible with ESP32 and Arduino UNO Q field rigs.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│               FIELD RIG (ESP32 / UNO Q)                 │
│  - Soil Moisture, Rain Sensor, DHT11, Solar Cell        │
│  - Servo Valve Trigger / Submersible Pump Relay         │
│  - 0.96" OLED Display, Piezo Buzzer, Hardware Button    │
└────────────────────────────┬────────────────────────────┘
                             │ MQTT over Wi-Fi
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 FASTAPI BACKEND SERVICE                 │
│  - REST API & Server-Sent Events (SSE /api/events)      │
│  - SQLite Database (Telemetry, Calibration, History)    │
│  - Open-Meteo Weather Client & Cache                    │
│  - 3-Layer Decision Engine (Rules, ML Forecast, Opt)    │
│  - Sensor Fault Detection & Imputation Estimator        │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS / SSE Stream
                             ▼
┌─────────────────────────────────────────────────────────┐
│                  FARMER WEB APP (PWA)                   │
│  - React 19 + TypeScript + Vite + Tailwind CSS          │
│  - Trilingual: English, Telugu, Hindi                   │
│  - Real-Time Decision Card, Why Screen, Calibration     │
│  - Interactive Test Mode Scenarios for Demonstrations   │
└─────────────────────────────────────────────────────────┘
```

For full architectural details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📁 Repository Structure

```
AquaWise/
├── artifacts/
│   ├── api-server/         # FastAPI backend service
│   │   ├── main.py         # REST endpoints, SSE stream, SQLite storage, simulation tick
│   │   ├── engine.py       # Deterministic decision rules & multilingual reasons
│   │   ├── forecasting.py  # ML regressor, water-balance simulation, schedule comparison
│   │   └── tests/          # Pytest suite for API endpoints and decision engine
│   ├── aquawise/           # React 19 + Vite + Tailwind CSS PWA frontend
│   │   ├── src/            # UI components, pages (Home, Why, Calibration, Settings)
│   │   ├── locales/        # English (en), Telugu (te), Hindi (hi) dictionaries
│   │   └── public/         # PWA Web Manifest, icons, and offline Service Worker
│   └── mockup-sandbox/     # Component design and prototyping sandbox
├── docs/
│   ├── PRD.md              # Full Product Requirements Document (IARE HackVerse)
│   ├── ARCHITECTURE.md     # In-depth system architecture & engine layer breakdown
│   └── HARDWARE_GUIDE.md   # Bill of Materials, ESP32 pinouts, and MQTT JSON contract
├── lib/
│   ├── api-spec/           # OpenAPI 3.0 specification contract (openapi.yaml)
│   ├── api-client-react/   # Generated React Query hooks (via Orval)
│   └── api-zod/            # Generated Zod validation schemas
├── main.py                 # Root launcher script for the FastAPI backend
├── package.json            # Workspace npm scripts
├── pnpm-workspace.yaml     # pnpm workspace configuration
└── pyproject.toml          # Python package requirements and pytest configuration
```

---

## 🚀 Quickstart Guide

### Prerequisites
- **Node.js** v20+ (Node.js 24/25 recommended)
- **Python** 3.11+
- **pnpm** (or run commands via `npx pnpm`)

### 1. Clone the Repository
```bash
git clone https://github.com/kushisafk/AquaWise.git
cd AquaWise
```

### 2. Start the Backend API Server
Install Python dependencies and run the server:
```bash
pip install fastapi uvicorn scikit-learn httpx pytest
python main.py
```
*The FastAPI service starts at `http://localhost:5000`.*
*Interactive API documentation is available at `http://localhost:5000/api/docs`.*

### 3. Run the Frontend App
In a separate terminal:
```bash
npx pnpm install
npx pnpm dev:web
```
*The web app opens at `http://localhost:5173` (or the configured Vite port).*

### 4. Run the Automated Tests
```bash
python -m pytest artifacts/api-server/tests
```

---

## 📡 Core API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check endpoint |
| `GET` | `/api/field` | Current field telemetry and active decision |
| `GET` | `/api/recommendation` | Active decision, ranked driving factors, and confidence level |
| `GET` | `/api/weather` | Current, cached, and forecast weather data |
| `GET` | `/api/analytics` | Moisture history, ML forecast, and schedule comparison |
| `GET` | `/api/events` | Real-time Server-Sent Events (SSE) telemetry stream |
| `POST` | `/api/irrigation/start` | Trigger manual irrigation session with a bounded duration |
| `POST` | `/api/irrigation/stop` | Emergency Stop active irrigation session |
| `POST` | `/api/calibration` | Calibrate dry and wet soil baseline points |
| `POST` | `/api/test-scenario` | Inject demo scenarios (rain, probe disconnect, dry soil) |
| `POST` | `/api/reset` | Reset field, test overrides, and simulation to defaults |

---

## 🧪 Demonstration & Test Scenarios

AquaWise includes a built-in **Test Scenario Injector** in the UI and via `/api/test-scenario` for live hackathon judging:

1. **Dry Soil**: Sets soil moisture to 15% $\rightarrow$ App alerts **WATER NOW** with recommended duration.
2. **Rain Forecast**: Sets dry soil with high incoming rain ($\ge 3.5\text{ mm}$, $85\%$) $\rightarrow$ App shifts to **WAIT: Rain expected soon**.
3. **Active Rain**: Triggers rain sensor $\rightarrow$ App immediately shows **WAIT: It is raining** and halts auto-irrigation.
4. **Sensor Disconnection**: Simulates unplugging the probe $\rightarrow$ Triggers **CHECK FIELD**, alerts farmer, and imputes value with decaying confidence.
5. **Language Switching**: Toggle between English, Telugu, and Hindi instantaneously across all UI elements and decision explanations.

---

## 📄 License & Credits

- Developed for the **IARE HackVerse Series 2026-27 (AgriTech Problem 2)**.
- Licensed under the [MIT License](LICENSE).
