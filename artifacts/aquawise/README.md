# AquaWise

AquaWise is a mobile-first, installable irrigation decision support app. It gives a deterministic, plain-language **WATER NOW**, **WAIT**, or **CHECK FIELD** recommendation and shows why it made that choice.

## Software-only boundary

All soil readings, scenario overrides, and irrigation sessions are simulated in software. AquaWise does not connect to or control a pump, sensor, ESP32, Arduino, MQTT device, or other physical equipment. The API data models keep the field state independent of a hardware transport so a future device adapter can be added without changing the frontend contracts.

## Architecture

- **Frontend:** React, TypeScript, Vite, Recharts, React Query.
- **Backend:** Python 3.11, FastAPI, Pydantic, SQLite.
- **API contract:** `lib/api-spec/openapi.yaml`, with generated TypeScript hooks and schemas.
- **Weather:** Open-Meteo forecast API; no API key is needed. Coordinates are editable in Settings.
- **Persistence:** SQLite stores simulated telemetry, settings, calibration, weather cache, recommendation/event history, irrigation events, notifications, feedback, and model metadata.
- **Live updates:** Server-Sent Events at `GET /api/events`, with periodic client refresh as a reconnect/fallback path.

## Run locally in this project

The managed workflows start both services:

- Web app: `artifacts/aquawise: web`
- FastAPI: `artifacts/api-server: API Server`

Python dependencies are declared in the workspace `pyproject.toml` and `uv.lock`. The SQLite file defaults to `artifacts/api-server/aquawise.sqlite3`; set `AQUAWISE_DB_PATH` to place it elsewhere. Replit supplies the service `PORT` value to the API workflow.

## API

FastAPI interactive documentation: `/api/docs`; machine-readable OpenAPI: `/api/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/healthz` | Health check |
| GET | `/api/events` | Field updates as Server-Sent Events |
| GET | `/api/field` | Current simulated field state and recommendation |
| GET | `/api/recommendation` | Current decision and ranked factors |
| GET | `/api/weather` | Live, cached, stale, or test-mode forecast |
| GET | `/api/analytics` | Moisture history, forecast, and strategy comparison |
| GET | `/api/history?category=all` | Persisted, filterable event history |
| GET / PUT | `/api/settings` | Read and save preferences |
| GET / PUT | `/api/calibration` | Read and save dry/wet calibration points |
| POST | `/api/irrigation/start` | Start a bounded simulated session |
| POST | `/api/irrigation/stop` | Stop the active simulated session |
| POST | `/api/test-scenario` | Set labelled simulated weather/readings/faults |
| POST | `/api/reset` | Reset field, test override, and calibration defaults |
| GET | `/api/notifications` | List in-app notifications |
| POST | `/api/notifications/{id}/acknowledge` | Acknowledge an in-app notification |
| POST | `/api/feedback` | Persist farmer feedback |

## Decision rules

The default dry and wet calibration points are 20% and 70%. The low threshold is dry + 25% of the calibration range; the target is dry + 70%. Rain now always returns WAIT. Meaningful rain within six hours requires both at least 60% probability and at least 2 mm. Below-threshold moisture without that forecast returns WATER NOW. Missing or invalid moisture without a recent estimate returns CHECK FIELD. The pure rules live in `artifacts/api-server/engine.py` and have boundary tests.

## Forecast and limitations

Synthetic water-balance sequences train a lightweight scikit-learn regressor. AquaWise evaluates it against a persistence baseline on held-out synthetic data and uses it only if it performs better; otherwise the transparent water-balance simulator is used. Forecasts remain experimental because there is no historical field dataset. Schedule comparisons share one simulator and explicitly report estimates, not measured savings. Sensor-fault estimates are labelled and expire after six hours.

Android Web Push is not configured. In-app notifications and acknowledgement work; the app does not claim that operating-system push delivery occurred. Auto mode starts and stops simulated sessions only. No production-grade learning or self-retraining pipeline is claimed.

## Android installation and offline use

Serve the app from an HTTPS origin, open it in Chrome on Android, then choose **Install app** or **Add to Home screen** from the browser menu. The service worker caches the app shell and successful GET responses. When offline, it can return the last cached field/API response and marks that response stale; new recommendations and irrigation operations are unavailable until the backend reconnects.

## Checks

```sh
pnpm --filter @workspace/api-spec run codegen
cd artifacts/api-server && uv run --project ../.. -- pytest -q tests
pnpm --filter @workspace/aquawise run typecheck
pnpm run typecheck
```
