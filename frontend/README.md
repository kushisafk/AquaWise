# AquaWise Frontend (PWA)

The frontend for AquaWise is an installable, mobile-first Progressive Web App (PWA) built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, **Lucide Icons**, and **Recharts**.

It provides simple, plain-language **WATER NOW**, **WAIT**, or **CHECK FIELD** irrigation recommendations in **English**, **Telugu (తెలుగు)**, and **Hindi (हिन्दी)**.

---

## 📱 PWA Features

- **Installable Web App**: Includes `manifest.webmanifest`, app icons (192px, 512px), theme colors, and Apple mobile web app tags for installation on Android and iOS home screens.
- **Offline Resilient**: Integrated Service Worker (`public/service-worker.js`) caches the application shell and GET API responses. Offline views display a clear **"Offline / Stale Data"** indicator.
- **Farmer-First UX**:
  - One tap to trigger or stop irrigation.
  - Transparent "Why" screen displaying ranked environmental factors.
  - Two-step dry/wet soil calibration workflow.
  - Interactive test scenario generator for live demonstrations.

---

## 🛠️ Development

Run the frontend in development mode:
```bash
# From workspace root
npx pnpm dev:web

# Or from this folder
npx pnpm dev
```

Build production bundle:
```bash
npx pnpm build:web
```

Typecheck:
```bash
npx pnpm typecheck
```
