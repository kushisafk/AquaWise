# AquaWise — Hardware Specification & Device Contract

This document provides the hardware bill of materials, circuit pinouts, MQTT contract, alert patterns, and physical safety constraints for the AquaWise physical test rig.

---

## 1. Bill of Materials (BOM)

| Component | Function | Model / Specification | Notes |
|-----------|----------|-----------------------|-------|
| Microcontroller | Core edge logic, sensor sampling, MQTT client | ESP32-WROOM-32 (or Arduino UNO Q) | Wi-Fi 2.4 GHz; ADC1 pins for analog inputs |
| Soil Moisture Sensor | Measures soil moisture % | Capacitive Soil Moisture Sensor v1.2 | Analog voltage output; resistant to corrosion |
| Rain Sensor | Detects active precipitation | Raindrop Detection Board (LM393) | Analog + digital interrupt pin |
| Temp & Humidity | Ambient air climate | DHT11 / DHT22 | 1-wire digital protocol |
| Solar Cell | Relative sunlight intensity (0–100%) | Small photovoltaic cell / LDR divider | Read through analog voltage divider |
| Display | Local field status & diagnostics | 0.96" I2C OLED (SSD1306, 128x64) | 4-pin I2C (`SDA`, `SCL`, `VCC`, `GND`) |
| Buzzer | Audible field alert patterns | Active Piezo Buzzer (5V) | Driven via GPIO transistor / direct pin |
| Actuator (v1) | Irrigation valve trigger | SG90 Micro Servo (or MG995) | Simulates valve opening/closing |
| Actuator (v2) | Real watering | 12V Submersible DC Water Pump | Driven via Relay or MOSFET with flyback diode |
| Hardware Button | Local Stop & Silence alarms | Momentary Push Button | Internal pull-up; debounce filter |
| Power Supply | System power | 5V 2A USB (Board) + Separate 5V/12V (Motors) | Common ground shared between supplies |

---

## 2. Wiring & Electrical Safety Rules

> [!WARNING]
> **Brownout Prevention (HW-2)**: The servo and water pump must **never** draw power directly from the 3.3V or 5V regulator pin of the ESP32. Inductive spikes and current surges will cause brownouts and continuous board reboots.
> Use an independent external power supply for actuators with a **common ground (GND)** connected to the ESP32.

> [!IMPORTANT]
> **ESP32 ADC1 Pin Selection (HW-1)**: Wi-Fi on the ESP32 disables ADC2 pins. All analog sensors (soil moisture, rain, solar cell) must be connected to **ADC1 pins** (GPIO 32, 33, 34, 35, 36, 39).

> [!CAUTION]
> **Fail-Safe Actuation (HW-6)**: On boot, power loss, or lost connection, the actuator must immediately revert to **OFF / closed**.

---

## 3. Physical User Interface

### 3.1 OLED Rotating Status Screens
1. **Screen 1 (Primary)**: Soil Moisture % bar + Advice banner (`WATER NOW` / `WAIT` / `CHECK`).
2. **Screen 2 (Weather)**: Air Temperature (°C), Relative Humidity (%), Light (%), Rain status.
3. **Screen 3 (System)**: Mode (`Advisory` / `Auto`), Wi-Fi RSSI, MQTT status.
4. **Screen 4 (Alert)**: Active warning or sensor fault code when triggered.

### 3.2 Buzzer Acoustic Patterns
| Event | Buzzer Pattern | Repetition |
|-------|----------------|------------|
| **Water Needed** | 2 short beeps | Up to 3 times, spaced 30 min apart |
| **Irrigation Started** | 1 long beep | Once |
| **Irrigation Finished** | 2 short beeps | Once |
| **Sensor Fault** | 3 rapid beeps | Once, repeated every 30 min until cleared |
| **Connection Lost** | 1 long + 1 short beep | Once |
| **Stop Acknowledged**| 1 short beep | Once |
| **Rain Detected** | 1 short beep | Once |

### 3.3 Physical Button Controls
- **Short Press (< 1.5s)**: Silence active buzzer audible alert.
- **Long Press (> 2.0s)**: **Emergency Stop** — immediately shuts off active irrigation and switches valve to closed position.

---

## 4. MQTT Device Contract

### 4.1 Topic Hierarchy
All topics are scoped under `aquawise/<field_id>/`:

| Topic | Direction | Purpose | QoS | Retained |
|-------|-----------|---------|-----|----------|
| `aquawise/field1/telemetry` | Device $\rightarrow$ Backend | Periodic sensor metrics (10s default) | 0 | No |
| `aquawise/field1/status` | Device $\rightarrow$ Backend | Online / Offline status with Last Will | 1 | Yes |
| `aquawise/field1/event` | Device $\rightarrow$ Backend | Button actions, valve states, faults | 1 | No |
| `aquawise/field1/cmd` | Backend $\rightarrow$ Device | Start, stop, set mode, trigger buzzer | 1 | No |
| `aquawise/field1/config` | Backend $\rightarrow$ Device | Calibration bounds, timing intervals | 1 | Yes |
| `aquawise/field1/alert` | Backend $\rightarrow$ Device | Request specific buzzer/OLED pattern | 1 | No |

---

### 4.2 Telemetry JSON Payload (`aquawise/field1/telemetry`)
```json
{
  "ts": 1760000000,
  "fw": "0.1.0",
  "soil": {
    "raw": 2310,
    "pct": 41.5,
    "valid": true
  },
  "rain": {
    "raw": 3800,
    "wet": false,
    "valid": true
  },
  "air": {
    "temp_c": 31.0,
    "rh": 52,
    "valid": true
  },
  "light": {
    "raw": 1900,
    "rel_pct": 74,
    "valid": true
  },
  "actuator": {
    "state": "off",
    "mode": "advisory",
    "run_left_s": 0
  },
  "net": {
    "rssi": -61
  }
}
```

---

### 4.3 Command JSON Payloads (`aquawise/field1/cmd`)

**Start Irrigation (with auto-expire duration):**
```json
{
  "cmd": "start",
  "duration_s": 600,
  "source": "app"
}
```

**Stop Irrigation (Emergency or normal stop):**
```json
{
  "cmd": "stop",
  "source": "app"
}
```

**Set Mode (`advisory` or `auto`):**
```json
{
  "cmd": "set_mode",
  "mode": "auto"
}
```
