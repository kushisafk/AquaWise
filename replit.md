# AquaWise

A mobile-first, weather-aware irrigation decision support app with explainable recommendations and fully simulated field readings and watering controls.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the FastAPI service
- `pnpm --filter @workspace/aquawise run dev` — run the React/Vite frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `cd artifacts/api-server && uv run --project ../.. -- pytest -q tests` — API and decision-engine tests
- SQLite defaults to `artifacts/api-server/aquawise.sqlite3`; optional `AQUAWISE_DB_PATH` selects another file.
- Open-Meteo is public and does not require a key.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9, Python 3.11
- API: FastAPI + Pydantic
- DB: SQLite via Python's standard library
- Frontend: React, TypeScript, Vite, Tailwind CSS, React Query, Recharts
- API codegen: Orval (from OpenAPI spec)
- Forecast: scikit-learn, promoted only if it beats a synthetic-data persistence baseline
- PWA: web manifest, service worker, shell/API caching and stale-response signalling

## Where things live

- `artifacts/aquawise/src/` — React app, pages, localization, and PWA registration.
- `artifacts/aquawise/public/` — manifest, icons, and service worker.
- `artifacts/api-server/main.py` — FastAPI routes, SQLite persistence, simulation, weather, and controls.
- `artifacts/api-server/engine.py` — deterministic irrigation rules and localized recommendation reasons.
- `artifacts/api-server/forecasting.py` — synthetic model evaluation and strategy simulator.
- `artifacts/api-server/tests/` — decision boundaries, controls, sensor faults, persistence, and API tests.
- `lib/api-spec/openapi.yaml` — contract source of truth; regenerate client/schema with the codegen command.

## Architecture decisions

- All readings and irrigation sessions are software-only; no physical device control is present.
- AquaWise uses SQLite; it does not use the generic PostgreSQL library in this workspace.
- Recommendations stay rule-based if the weather provider or optional ML model is unavailable.
- Forecast and water-use comparisons are estimates from synthetic assumptions, not measured farm results.

## Product

Farmers can view WATER NOW / WAIT / CHECK FIELD advice, factors, weather, simulated telemetry and watering controls. The app also includes analytics, strategy comparisons, calibration, English/Telugu/Hindi, persisted history, in-app notifications and an installable offline-capable PWA.

## User preferences

Keep readings and irrigation operations simulated unless the user explicitly changes this scope.

## Gotchas

Regenerate the client after any OpenAPI change. Web Push is not configured; only in-app notifications are implemented. Offline API responses are cached and marked stale; writes and new recommendations need the backend.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
