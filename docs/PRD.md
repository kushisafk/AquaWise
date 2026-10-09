# AquaWise — Product Requirements Document

**Project:** AquaWise: Weather-Aware Irrigation Decision Support
**Event:** IARE HockVerse Series 2026-27 (AgriTech, Problem 2)
**Version:** 1.0 (draft)
**Status:** Ready for build

---

## 1. Overview

### 1.1 Problem
Fixed irrigation schedules waste water or leave crops short of moisture when conditions change. Farmers need a simple, trustworthy answer to one question: **"Should I water now?"**

### 1.2 Solution
AquaWise reads live field data (soil moisture, rain, temperature, humidity, sunlight), combines it with the weather forecast, and tells the farmer in plain language whether to **WATER NOW**, **WAIT**, or **CHECK FIELD**, with a short reason. It can either only advise or trigger irrigation itself, with a manual override always available. It keeps working when a sensor fails by estimating the missing value and saying clearly that it is an estimate.

### 1.3 Product principles
1. **Farmer-first simplicity.** One screen, one big answer, one sentence of reason. Plain words in English, Telugu and Hindi.
2. **Works live.** Real sensors, real readings, real decisions, with no dependency on pre-recorded data to function.
3. **Never silently wrong.** Every value and recommendation carries a confidence level and a source (measured / estimated / stale).
4. **Safe by default.** Manual stop always wins. Automatic control is opt-in.
5. **Hardware-swappable.** The device contract (Section 7) is fixed. Which board implements it is not.

---

## 2. Goals and Non-Goals

### 2.1 Goals
- G1. Show live sensor readings from the field in the app within 5 seconds of measurement.
- G2. Produce an irrigation recommendation (WATER NOW / WAIT / CHECK FIELD) with a visible explanation of which inputs drove it.
- G3. Forecast short-term soil moisture and compare alternative irrigation schedules by water use and crop stress.
- G4. Keep producing useful recommendations when a sensor fails or readings are unreliable.
- G5. Support two control modes: **Advisory** (inform the farmer) and **Auto** (trigger irrigation), with manual override.
- G6. Learn from the system's own data over time (self-calibration and scheduled retraining).
- G7. Deliver a mobile-first, installable web app (PWA) that also works on desktop, in English, Telugu and Hindi.
- G8. Be demonstrable end-to-end with the physical rig during the event.

### 2.2 Non-goals (for this version)
- Multiple field zones (the data contract reserves a `field1` identifier so zones can be added later).
- Crop-specific agronomy tables (the farmer calibrates dry and wet points instead).
- Admin roles, multi-user accounts, login flows.
- iOS-specific support or optimisation.
- Cloud hosting (the backend runs on a laptop).
- Pesticide, fertiliser or disease advice.
- Production-grade water metering or valve hardware.

---

## 3. Users and Scenarios

### 3.1 Primary user
**One farmer (tester).** Uses an Android phone with Chrome, may have low literacy in English, prefers Telugu or Hindi, is often away from the device, and wants a direct instruction rather than data.

### 3.2 Key scenarios
| # | Scenario | Expected experience |
|---|----------|---------------------|
| S1 | Soil is dry, no rain forecast | Phone notification: "Soil is dry. Water now." App shows WATER NOW with a Start button. Buzzer on the device sounds a reminder pattern. |
| S2 | Soil is dry but rain is forecast soon | App shows WAIT with the reason "Rain expected in 3 hours." |
| S3 | It starts raining | App shows WAIT, "It is raining." Any running irrigation is stopped in Auto mode. |
| S4 | Soil moisture sensor disconnects | App shows CHECK FIELD (or an estimated value labelled as estimate). Buzzer sounds the fault pattern once, push notification sent. |
| S5 | Farmer wants to stop watering | One tap on Stop in the app, or press the physical button on the device. Irrigation stops immediately. |
| S6 | Farmer wants to water now regardless | Tap Water Now, choose a duration. The run auto-expires. |
| S7 | First-time setup | Choose language, press "Soil is dry now" with the probe in dry soil, press "Soil is wet enough now" with the probe in wet soil. Done. |
| S8 | Wi-Fi or backend goes down | Device keeps reading sensors, shows status on OLED, buffers data, and applies safe local rules. App shows "Last updated X minutes ago." |

---

## 4. Scope Summary

| Area | In scope (v1) |
|------|----------------|
| Sensing | Soil moisture, rain, temperature, humidity, solar intensity |
| Compute | Edge logic on device, ML and rules on laptop backend |
| Actuation | Servo as the irrigation trigger; pump behind the same interface once verified |
| Connectivity | MQTT between device and backend, REST/WebSocket between backend and app |
| App | PWA (Android Chrome first), desktop browser supported |
| Languages | English, Telugu, Hindi |
| Alerts | Chrome push notifications, buzzer patterns, OLED status |
| ML | Moisture forecasting, schedule comparison, sensor-failure imputation, self-learning loop |
| Data | Local database for telemetry, recommendations, events, calibration |

---

## 5. System Architecture

```
┌──────────────────────── FIELD DEVICE ────────────────────────┐
│ Soil moisture │ Rain │ DHT11 │ Solar cell                    │
│        └──────────── Board (ESP32 default / Arduino UNO Q) ──┤
│ OLED  │ Buzzer │ Physical button │ Servo (irrigation trigger)│
│ (Pump via relay/MOSFET when verified)                        │
└───────────────┬──────────────────────────────────────────────┘
                │ MQTT (Wi-Fi)
                ▼
┌──────────────────────── LAPTOP BACKEND ──────────────────────┐
│ Mosquitto broker                                             │
│ API service (FastAPI): REST + WebSocket/SSE + Web Push       │
│ Database (SQLite)                                            │
│ Weather service (forecast API client + cache)                │
│ Decision engine (rules + ML outputs + explanation)           │
│ ML services: forecast │ schedule comparison │ imputation     │
│ Learning job (nightly): self-calibration + retrain + promote │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS
                ▼
┌──────────────────────── FARMER APP (PWA) ────────────────────┐
│ Android Chrome (primary) │ Desktop browser                   │
│ English / Telugu / Hindi │ Push notifications │ Offline view │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Responsibility split
| Component | Responsible for | Must not depend on |
|-----------|-----------------|--------------------|
| Device | Reading sensors, calibration application, local safety rules, alerts (OLED/buzzer), actuation, publishing telemetry, accepting commands | Backend being online |
| Backend | Storage, weather, ML, decision engine, notifications, API | Internet for core decisions (weather and push degrade gracefully) |
| App | Presenting the answer, taking farmer input, calibration, override | Direct broker access |

### 5.2 Board strategy
- **ESP32** is the default sensor/actuator node.
- **Arduino UNO Q** may replace it or act as an edge gateway because it has a Linux side as well as a microcontroller. Before use, verify ADC resolution and I/O voltage levels from its datasheet.
- Both must implement the same **device contract** (Section 7). No backend or app change is allowed when swapping boards.

---

## 6. Hardware Requirements

### 6.1 Bill of materials
| Item | Purpose | Status |
|------|---------|--------|
| Microcontroller board (ESP32 / UNO Q) | Sensing, control, MQTT | Available |
| Soil moisture sensor | Core input | Available |
| Rain (raindrop) sensor | Detect rain now | Available |
| DHT11 | Air temperature and humidity | Available |
| Solar cell | Relative solar intensity | Available |
| OLED display | Local status | Available |
| Buzzer | Local audible alerts | Available |
| Servo motor | Irrigation trigger (v1) | Available |
| Water pump | Real irrigation | Available, **not yet verified working** |
| Push button | Local Stop / Silence | **To add** |
| Relay or MOSFET driver | Switch the pump | **To add** if pump is used |
| Separate supply for pump and servo | Avoid brownouts | **To add** |
| Laptop | Backend host | Available |

### 6.2 Hardware requirements
- HW1. Analog sensors must be wired to pins that remain usable while Wi-Fi is active (on ESP32, ADC1 pins only).
- HW2. The pump and servo must not be powered from the board's pins. They use a separate supply with a shared ground. The pump uses a driver with a flyback diode.
- HW3. A physical button must provide Stop (long press) and Silence alarm (short press).
- HW4. The solar cell is read through a voltage divider or resistor; the value is reported as **relative light (0–100 %)**, calibrated to the brightest and darkest readings seen.
- HW5. The actuator is abstracted as `Actuator.start(duration)` / `Actuator.stop()`. v1 implements it with the servo. The pump implementation is added after a bench test.
- HW6. On boot, power loss or disconnect, the actuator must default to **OFF / closed**.

### 6.3 Known limitations (to state honestly in the demo)
- DHT11 has low accuracy (about ±2 °C and ±5 % RH).
- The solar cell gives relative, not absolute, light intensity.
- Soil moisture readings are sensor- and soil-specific and require the farmer calibration step.

---

## 7. Device Contract (MQTT)

### 7.1 Topics
| Topic | Direction | Purpose |
|-------|-----------|---------|
| `aquawise/field1/telemetry` | Device → Backend | Periodic readings |
| `aquawise/field1/status` | Device → Backend | Online/offline (retained, with Last Will) |
| `aquawise/field1/event` | Device → Backend | Button presses, actuator start/stop, faults |
| `aquawise/field1/cmd` | Backend → Device | Start, stop, set mode, buzzer test |
| `aquawise/field1/config` | Backend → Device | Calibration values, intervals, limits (retained) |
| `aquawise/field1/alert` | Backend → Device | Request a buzzer/OLED alert pattern |

### 7.2 Telemetry payload (JSON, every 10 s default)
```json
{
  "ts": 1760000000,
  "fw": "0.1.0",
  "soil": { "raw": 2310, "pct": 41.5, "valid": true },
  "rain": { "raw": 3800, "wet": false, "valid": true },
  "air":  { "temp_c": 31.0, "rh": 52, "valid": true },
  "light": { "raw": 1900, "rel_pct": 74, "valid": true },
  "actuator": { "state": "off", "mode": "advisory", "run_left_s": 0 },
  "net": { "rssi": -61 }
}
```

### 7.3 Command payload
```json
{ "cmd": "start", "duration_s": 600, "source": "app" }
{ "cmd": "stop", "source": "app" }
{ "cmd": "set_mode", "mode": "auto" }
```

### 7.4 Contract requirements
- C1. Each sensor reports its own `valid` flag. The device sets it using range and sanity checks.
- C2. The broker uses username/password authentication. Credentials are not hard-coded in committed source.
- C3. Status uses MQTT Last Will so the backend knows when the device disappears.
- C4. Commands include a `source` field for the audit log (`app`, `auto`, `button`).
- C5. Config is retained so a rebooted device regains calibration without the app.

---

## 8. Functional Requirements

### 8.1 Sensing and device behaviour
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Device reads all sensors at a configurable interval (default 10 s) and publishes telemetry. | Must |
| FR-2 | Device converts raw soil reading to a 0–100 % moisture value using the farmer-set dry and wet calibration points. | Must |
| FR-3 | Device marks a reading invalid when out of range, flat-lined, or physically implausible. | Must |
| FR-4 | OLED shows current soil moisture, recommendation (WATER / WAIT / CHECK), and connection state. | Must |
| FR-5 | Device buffers readings while offline and sends them on reconnect. | Should |
| FR-6 | Device applies a safe local rule when the backend is unreachable (advice only; no automatic watering in this state unless the farmer enabled Auto). | Should |

### 8.2 Decision engine
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7 | Engine outputs one of WATER NOW, WAIT, CHECK FIELD for the field, plus an optional "water later at HH:MM". | Must |
| FR-8 | Every output includes a one-sentence reason in the farmer's language and a ranked list of the inputs that drove it. | Must |
| FR-9 | Every output carries a confidence level (High / Medium / Low) and the data source of each input (measured / estimated / stale). | Must |
| FR-10 | Engine suggests a run duration when it recommends watering. | Should |
| FR-11 | The rule-based baseline is always available and used as fallback if any ML component fails. | Must |

### 8.3 Weather
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12 | Backend fetches the forecast (rain amount and probability, temperature, evapotranspiration if offered) from a free weather API and caches it. | Must |
| FR-13 | If the weather API is unreachable, the engine uses the last cached forecast, flags it as stale, and lowers confidence. | Must |
| FR-14 | A clearly labelled **Test mode** toggle can override the forecast rain value for demonstration. | Should |

### 8.4 ML features
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-15 | Forecast short-term soil moisture (next 6–48 hours) from moisture history, temperature, humidity, light, rain and forecast weather. | Must |
| FR-16 | Compare candidate irrigation schedules by estimated water use, hours of dryness stress, and hours of over-watering, and recommend one. | Must |
| FR-17 | Detect sensor faults and estimate the missing soil moisture value when the sensor fails (Section 10). | Must |
| FR-18 | Self-learning loop: self-calibration of the field's drying and wetting behaviour, nightly retraining, and promotion of a new model only if it beats the current one (Section 9.4). | Should |
| FR-19 | Farmer feedback ("too wet" / "too dry") is stored and used as labels. | Could |

### 8.5 Control and override
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-20 | Two modes: **Advisory** (default) and **Auto**. The farmer switches mode in the app. | Must |
| FR-21 | **Stop** works from the app and from the physical button and always takes priority. | Must |
| FR-22 | Manual **Water Now** with a chosen duration, expiring automatically. | Must |
| FR-23 | A maximum run time per cycle is enforced on the device regardless of commands. | Must |
| FR-24 | In Auto mode, irrigation starts only when the engine says WATER NOW with at least Medium confidence, and stops when the target is reached, rain starts, or the cap is hit. | Must |
| FR-25 | Every start and stop is recorded with its source (app, auto, button). | Must |
| FR-26 | Priority order: Stop > Manual run > Auto > Advice only. | Must |

### 8.6 Alerts
See Section 11.

### 8.7 App
See Section 12.

---

## 9. Decision Logic and ML

### 9.1 Layer 1: Rule-based baseline (always on)
Inputs: calibrated soil moisture, rain-now flag, forecast rain (amount and probability), temperature, relative light, time since last irrigation.

Default thresholds (all adjustable from calibration, no crop tables):
- `low` = dry point + 25 % of the dry→wet range
- `target` = dry point + 70 % of the dry→wet range
- `rain_forecast_wait` = rain probability ≥ 60 % and amount ≥ 2 mm within the next 6 hours

Logic, in order:
1. If soil data is invalid and no confident estimate exists → **CHECK FIELD**.
2. If it is raining now → **WAIT** ("It is raining").
3. If moisture < `low`:
   - if `rain_forecast_wait` → **WAIT** ("Rain expected soon")
   - else → **WATER NOW**, with a duration to reach `target`.
4. If moisture ≥ `low` and the forecast model predicts crossing `low` within the horizon → **WAIT**, "Water later at HH:MM".
5. Otherwise → **WAIT** ("Soil has enough water").

High light and temperature raise the expected drying rate and bring "water later" times earlier.

### 9.2 Layer 2: Moisture forecast
- **Target:** soil moisture at +1, +3, +6, +12, +24, +48 hours.
- **Features:** recent moisture trend, time of day, temperature, humidity, relative light, rain-now, forecast rain, time since last irrigation, last irrigation duration.
- **Models:** gradient-boosted trees as the default; a small recurrent model may be tried if time allows.
- **Baseline to beat:** "persistence" (moisture stays the same). The forecast model is only used if it beats persistence on held-out data.
- **Cold start:** pretrained on data from a soil-water-balance simulator, then updated with real data as it accumulates.

### 9.3 Layer 3: Schedule comparison
Generate candidate schedules for the next 48 hours and simulate each with the forecast model or water-balance model:

| Candidate | Description |
|-----------|-------------|
| A. Fixed | A fixed daily schedule (baseline representing current practice) |
| B. Threshold | Water whenever moisture falls below `low` |
| C. Rain-aware | Threshold, but delay when meaningful rain is forecast |
| D. Optimised | Search for the least water that keeps moisture within the target band |

Scoring per candidate:
- **Water used** = run minutes × flow rate (flow rate is a configured assumption, shown in the UI).
- **Dry-stress hours** = hours below `low`.
- **Over-water hours** = hours above a wet ceiling.

The app shows the recommended schedule and a simple comparison ("Saves about X litres vs fixed schedule").

### 9.4 Self-learning loop
1. **Self-calibration:** estimate the field's drying rate and wetting response from logged data (valid readings only).
2. **Nightly job on the laptop:** retrain the forecast model using the last N days of valid data plus farmer feedback.
3. **Champion vs challenger:** the new model replaces the current one only if it beats it on a recent held-out window.
4. **Model registry:** keep versions; allow rollback to the previous model or to rules only.
5. **Data hygiene:** readings flagged invalid or estimated are excluded from training labels.

---

## 10. Sensor Failure Handling

### 10.1 Detection
| Fault | Detection rule |
|-------|----------------|
| Disconnected / short | Reading at the ADC extreme (floor or ceiling) |
| Flat-line | No change beyond noise for N readings while conditions change |
| Spike | Change faster than physically possible for soil moisture |
| Missing data | No telemetry for more than 3 intervals |
| Implausible vs context | Moisture rising with no rain and no irrigation |

### 10.2 Response
- The estimator predicts the missing soil moisture from the last good value, the self-calibrated drying model, weather, and recent irrigation events.
- Estimated values are labelled **Estimated** in the app with a decaying confidence.
- Time-based policy (configurable): short outage → estimate and continue; long outage → **CHECK FIELD** and alert the farmer.
- Other sensors: a failed rain sensor falls back to the forecast; a failed DHT11 falls back to the weather API temperature; a failed light sensor uses time of day and forecast cloud cover.

### 10.3 Requirements
- SF-1. A fault is detected within 3 reporting intervals.
- SF-2. The app never presents an estimated value as measured.
- SF-3. Fault injection (unplugging the probe) is part of the demo and test plan.

---

## 11. Alerts

The farmer is usually away from the device and cannot see the OLED. Alert design therefore follows this rule: **the phone notification is the primary channel; the buzzer serves anyone near the device; the OLED is a local status panel only.**

### 11.1 Chrome push notifications
- Sent via Web Push to the farmer's installed PWA on Android Chrome.
- Events: water needed, irrigation started or completed (Auto), sensor fault, device offline, rain started, low confidence needs a check.
- Messages are one short line in the chosen language, each with a tap-through to the relevant screen.
- Notifications are rate-limited and de-duplicated (the same alert is not repeated more than once per 30 minutes unless the state changes).
- The app also shows in-app alerts as a fallback if push is unavailable.

### 11.2 Buzzer patterns
| Event | Pattern |
|-------|---------|
| Water needed | 2 short beeps, repeated up to 3 times, 30 minutes apart, until acknowledged |
| Irrigation started | 1 long beep |
| Irrigation finished | 2 short beeps |
| Sensor fault | 3 rapid beeps, once, then repeated every 30 minutes until fixed or silenced |
| Connection lost | 1 long + 1 short beep, once |
| Stop acknowledged | 1 short beep |
| Rain started | 1 short beep |

- A short press on the physical button silences the current alert. A long press stops irrigation.
- Quiet hours (e.g. night) are configurable so the buzzer does not sound unnecessarily; faults and Stop acknowledgements always sound.

### 11.3 OLED screens (rotating)
1. Soil moisture % with a simple bar and WATER / WAIT / CHECK.
2. Temperature, humidity, light, rain.
3. Connection state and mode (Advisory / Auto).
4. Active alert text when present.

---

## 12. Farmer App (PWA)

### 12.1 Platform
- Installable PWA with a web manifest and service worker.
- Android Chrome is the primary target; desktop browsers are supported with a responsive layout.
- Served over HTTPS (local certificate or tunnel) because phones require it for install and service workers.

### 12.2 Screens
1. **Home** (the only screen needed daily)
   - Large status: **WATER NOW / WAIT / CHECK FIELD** with colour, icon and word.
   - One-sentence reason.
   - Suggested action ("Run for 10 minutes", "Water again after 6 PM").
   - **Start** and **Stop** buttons.
   - Live strip: soil moisture, temperature, rain, sunlight.
   - "Last updated" time and device online/offline indicator.
2. **Why** (tap on the status)
   - Ranked list of inputs that drove the decision, in plain words, and a confidence indicator.
   - Soil moisture trend and forecast chart.
   - Schedule comparison with water saved.
3. **Calibration**
   - "Soil is dry now" and "Soil is wet enough now" buttons with a short guide.
4. **Settings**
   - Language, Advisory/Auto mode, alert preferences, quiet hours, max run time, flow rate assumption, Test mode toggle.
5. **History**
   - Past recommendations and irrigation events with source (app, auto, button).

### 12.3 UX requirements
- UX-1. Core action reachable in at most one tap from opening the app.
- UX-2. Large touch targets and high contrast for use in sunlight.
- UX-3. Meaning never relies on colour alone (icon plus word).
- UX-4. Simple vocabulary, short sentences, no technical terms (no "volumetric water content", "evapotranspiration").
- UX-5. Optional voice readout of the status in the selected language (subject to browser and device voice support, to be tested for Telugu).
- UX-6. Offline: the app opens and shows the last known state with a clear "Last updated X ago" label.

### 12.4 Multilingual
- Languages: English, Telugu, Hindi.
- All strings live in locale files; the language can be changed at any time and is remembered.
- Layouts must tolerate longer Telugu and Hindi strings.
- Numbers, units and times are formatted per locale.
- Translations of the core phrases (WATER NOW / WAIT / CHECK FIELD and their reasons) are reviewed by a native speaker.
- Push notification text and buzzer-linked messages are also localised.

---

## 13. Backend and Data

### 13.1 Services
- MQTT broker (Mosquitto) with authentication.
- API service: REST for app actions and history, WebSocket or SSE for live updates, Web Push sender.
- Weather client with cache.
- Decision engine and ML services (Python).
- Scheduled jobs: forecast refresh, nightly learning job, data retention.

### 13.2 Data model (single user, single field)
| Table | Key contents |
|-------|--------------|
| `telemetry` | ts, all sensor values, valid flags, source (measured/estimated) |
| `weather_snapshots` | fetched_at, forecast rain/temperature series |
| `recommendations` | ts, status, reason key, drivers (ranked), confidence, model versions |
| `irrigation_events` | start, end, duration, source (app/auto/button), mode |
| `calibration` | dry point, wet point, timestamps |
| `feedback` | ts, "too wet"/"too dry" |
| `alerts` | ts, type, channel, acknowledged |
| `push_subscriptions` | the farmer's browser subscription |
| `models` | name, version, metrics, active flag |
| `settings` | language, mode, quiet hours, max run, flow rate |

### 13.3 Security (proportionate to a single-user prototype)
- Broker and API require credentials or a shared token; the pump command is not open to anyone on the network.
- Secrets are kept in environment/config files excluded from version control.
- The device validates command fields and enforces its own limits regardless of what the backend sends.

---

## 14. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Latency | Sensor reading to on-screen update ≤ 5 s on the same network |
| NFR-2 | Reliability | Device continues local sensing and safe behaviour with no Wi-Fi or backend |
| NFR-3 | Safety | Actuator defaults to OFF on boot, power loss, or lost control link |
| NFR-4 | Robustness | App and backend tolerate missing sensors and stale weather without crashing |
| NFR-5 | Usability | A new user completes setup and understands the home screen without help |
| NFR-6 | Performance | Home screen loads in ≤ 3 s on a mid-range Android phone on the local network |
| NFR-7 | Maintainability | Device contract documented; boards and actuators swappable without backend change |
| NFR-8 | Transparency | Every recommendation stores its inputs and explanation for later review |

---

## 15. Demonstration Plan (live rig)

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Calibrate: probe in dry soil, press "dry"; probe in wet soil, press "wet" | Moisture shows a sensible 0–100 % |
| 2 | Probe in dry soil | App: **WATER NOW**, reason shown, push notification, buzzer reminder |
| 3 | Switch to Auto, let it trigger | Servo actuates (pump when verified), OLED and app show running state |
| 4 | Press Stop (app, then physical button) | Stops immediately, buzzer acknowledges |
| 5 | Put probe into damp soil | Recommendation changes to **WAIT** |
| 6 | Drip water on the rain sensor | App: **WAIT, "It is raining"**; Auto irrigation is blocked or stopped |
| 7 | Toggle Test mode and set high forecast rain with dry soil | Reason changes to "Rain expected soon" (labelled as test) |
| 8 | Unplug the soil probe | Fault detected, buzzer + push, estimate or CHECK FIELD shown |
| 9 | Switch language to Telugu and Hindi | All text, reasons and notifications switch |
| 10 | Open Why and schedule comparison | Ranked drivers, forecast chart, "water saved" shown |

**Time-scale note:** forecasts span hours but the demo lasts minutes. Demo mode either compresses the time axis or replays a recorded day next to the live readings.

---

## 16. Success Metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| Decision correctness | ≥ 90 % agreement with expert-defined expected outputs on a scenario set | Scripted scenarios (dry/damp/rain/fault combinations) |
| Moisture forecast quality | Lower error than persistence baseline on held-out data | MAE comparison |
| Water savings | Reduction vs fixed-schedule baseline, with assumptions stated | Simulation over recorded and simulated weather |
| Failure robustness | Recommendation quality with imputation clearly better than without under injected faults | Fault injection tests |
| Live latency | ≤ 5 s sensor to screen | Timestamp comparison |
| Usability | Tester completes setup and a watering decision unaided | Observed session |

---

## 17. Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Contract and setup | Topics, payloads, broker, repo, HTTPS for the phone working |
| M1 | Live telemetry | Board publishes calibrated readings; app shows them live |
| M2 | Rules and home screen | WATER NOW / WAIT / CHECK FIELD with reasons, end to end |
| M3 | Actuation and safety | Servo trigger, Stop (app and button), max run, mode switch, audit log |
| M4 | Weather and calibration | Forecast integrated, farmer calibration buttons, Test mode |
| M5 | Alerts | Chrome push, buzzer patterns, OLED screens |
| M6 | ML | Forecast, schedule comparison, imputation, nightly learning loop |
| M7 | Languages and polish | English/Telugu/Hindi, voice readout, offline behaviour |
| M8 | Hardening and rehearsal | Fault injection, usability test, demo dry-runs |

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pump may not work | No real watering demo | Servo trigger as v1 actuator; bench-test pump separately behind the same interface |
| Little real training data | Weak ML | Simulator pretraining, rules fallback, champion/challenger gating |
| Forecast cannot be changed live | Weak "weather-aware" demo | Labelled Test mode override for forecast only |
| Demo time too short for hour-scale forecasts | ML looks idle | Time compression or recorded-day replay |
| Phone cannot install PWA without HTTPS | App unusable on phone | Local certificate or tunnel set up in M0 |
| Venue Wi-Fi unreliable | Demo failure | Use a phone hotspot; local broker; keep laptop awake |
| Sensor noise (DHT11, cheap moisture probe) | Wrong advice | Validity checks, smoothing, calibration, honest limitations |
| Telugu voice support varies by phone | Voice feature fails | Test on the target phone early; text remains the primary output |
| Pump or servo brownout resets the board | Random reboots | Separate supply, shared ground, decoupling capacitors |
| Learning from faulty data | Model drift | Train only on valid readings; model promotion gate; rollback |
| Buzzer annoying or unheard | Missed or unwelcome alerts | Push is primary; quiet hours; silence button |

---

## 19. Assumptions

- A1. One farmer, one field, one sensor set.
- A2. The laptop and phone are on the same network (a hotspot at the venue).
- A3. The farmer uses an Android phone with Chrome.
- A4. The servo represents the irrigation trigger until the pump is verified.
- A5. Pump flow rate is a stated assumption used for water estimates, not a measured value.
- A6. A free weather API with a rain forecast is available for the field's location.

---

## 20. Future Scope

- Multiple zones and per-zone schedules.
- Crop and growth-stage presets.
- Better sensors (capacitive probes, higher-accuracy temperature/humidity, absolute light).
- Flow meter for real water measurement.
- Cloud deployment and remote access.
- Multiple farmers and roles.
- SMS/WhatsApp alerts for low-connectivity areas.
- Disease and nutrient guidance (outside the current problem statement).
