/**
 * AquaWise ESP32 Hardware Integration Module
 *
 * Handles HTTP telemetry polling (1s), pump controls (auto toggle, 3s pulse start, stop),
 * response normalization (preserving nulls), and connection mode switching (Proxy vs Direct).
 */

export interface ESP32Status {
  device: string;
  connected: boolean;
  uptime_ms: number | null;
  soil_raw: number | null;
  soil_moisture_percent: number | null;
  rain_raw: number | null;
  rain_detected: boolean | null;
  temperature_c: number | null;
  humidity_percent: number | null;
  solar_panel_voltage_v: number | null;
  sun_intensity_percent: number | null;
  recommendation: string;
  reason: string;
  auto_pump: boolean;
  pump_running: boolean;
  pump_mode: string;
  dry_count: number;
  confirm_samples: number;
  cooldown_ready: boolean;
  raw_payload?: Record<string, unknown>;
}

/**
 * Convert solar panel voltage (0.0V - 5.5V reference) to relative sun intensity percentage (0-100%).
 */
export function solarVoltageToSunIntensity(voltage: number | null | undefined, maxVoltage = 5.5): number | null {
  if (voltage == null || isNaN(voltage)) return null;
  if (voltage > 20) {
    return Math.min(100, Math.max(0, Math.round(voltage * 10) / 10));
  }
  const pct = Math.min(100, Math.max(0, (voltage / maxVoltage) * 100));
  return Math.round(pct * 10) / 10;
}

export type ESP32ConnectionMode = 'proxy' | 'direct';
export type ESP32MoistureLevel = 'dry' | 'moderate' | 'wet' | 'unavailable';

const STORAGE_KEY_URL = 'aquawise_esp32_url';
const STORAGE_KEY_MODE = 'aquawise_esp32_mode';
export const DEFAULT_ESP32_URL = 'http://192.168.4.1';

/**
 * Retrieve user-configured ESP32 base URL from localStorage or default.
 */
export function getStoredESP32Url(): string {
  try {
    const val = localStorage.getItem(STORAGE_KEY_URL);
    if (val && val.trim()) {
      return sanitizeBaseUrl(val.trim());
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_ESP32_URL;
}

/**
 * Persist user-configured ESP32 base URL to localStorage.
 */
export function setStoredESP32Url(url: string): string {
  const sanitized = sanitizeBaseUrl(url);
  try {
    localStorage.setItem(STORAGE_KEY_URL, sanitized);
  } catch {
    // localStorage unavailable
  }
  return sanitized;
}

/**
 * Retrieve connection mode ('proxy' or 'direct').
 * Proxy mode routes requests through the AquaWise FastAPI backend to bypass browser mixed-content/CORS restrictions.
 */
export function getStoredConnectionMode(): ESP32ConnectionMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY_MODE);
    if (val === 'direct' || val === 'proxy') {
      return val;
    }
  } catch {
    // localStorage unavailable
  }
  return 'proxy';
}

/**
 * Persist connection mode.
 */
export function setStoredConnectionMode(mode: ESP32ConnectionMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_MODE, mode);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Sanitize and ensure proper http/https scheme on device address.
 */
export function sanitizeBaseUrl(input: string): string {
  let cleaned = input.trim();
  if (!cleaned) return DEFAULT_ESP32_URL;
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `http://${cleaned}`;
  }
  return cleaned.replace(/\/+$/, '');
}

/**
 * Format uptime into readable hours, minutes, and seconds.
 */
export function formatUptime(uptimeMs: number | null | undefined): string {
  if (uptimeMs == null || isNaN(uptimeMs) || uptimeMs < 0) return '—';
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Categorize soil moisture percentage into dry, moderate, wet, or unavailable.
 */
export function getMoistureCategory(percent: number | null | undefined, lowThreshold = 30, targetThreshold = 60): ESP32MoistureLevel {
  if (percent == null || isNaN(percent)) return 'unavailable';
  if (percent < lowThreshold) return 'dry';
  if (percent <= targetThreshold) return 'moderate';
  return 'wet';
}

/**
 * Strictly normalize ESP32 status response.
 * CRITICAL: null sensor values must remain null, never converted to 0.
 */
export function normalizeESP32Status(raw: any): ESP32Status {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid ESP32 status structure received.');
  }

  const toNullableNum = (val: any): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
  };

  const toNullableBool = (val: any): boolean | null => {
    if (val === null || val === undefined) return null;
    return Boolean(val);
  };

  return {
    device: typeof raw.device === 'string' && raw.device.trim() ? raw.device : 'esp32-aquawise',
    connected: raw.connected !== false,
    uptime_ms: toNullableNum(raw.uptime_ms),
    soil_raw: toNullableNum(raw.soil_raw),
    soil_moisture_percent: toNullableNum(raw.soil_moisture_percent),
    rain_raw: toNullableNum(raw.rain_raw),
    rain_detected: toNullableBool(raw.rain_detected),
    temperature_c: toNullableNum(raw.temperature_c),
    humidity_percent: toNullableNum(raw.humidity_percent),
    solar_panel_voltage_v: toNullableNum(raw.solar_panel_voltage_v),
    sun_intensity_percent: toNullableNum(raw.sun_intensity_percent ?? raw.sunlight_percent ?? raw.sunlightPercent ?? raw.sun_intensity) ??
      solarVoltageToSunIntensity(toNullableNum(raw.solar_panel_voltage_v)),
    recommendation: typeof raw.recommendation === 'string' && raw.recommendation.trim() ? raw.recommendation : 'WAIT',
    reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason : 'Hardware telemetry active.',
    auto_pump: Boolean(raw.auto_pump),
    pump_running: Boolean(raw.pump_running),
    pump_mode: typeof raw.pump_mode === 'string' ? raw.pump_mode : (raw.auto_pump ? 'AUTO' : 'MANUAL'),
    dry_count: Number(raw.dry_count ?? 0),
    confirm_samples: Number(raw.confirm_samples ?? 5),
    cooldown_ready: raw.cooldown_ready !== false,
    raw_payload: raw,
  };
}

/**
 * Build request URL based on connection mode (Proxy vs Direct).
 */
function buildEndpointUrl(path: string, baseUrl: string, mode: ESP32ConnectionMode): string {
  const cleanBase = sanitizeBaseUrl(baseUrl);
  if (mode === 'proxy') {
    // Route through FastAPI proxy, e.g. /api/esp32/status?url=http%3A%2F%2F192.168.4.1
    const proxyPath = path.replace(/^\/api/, '/api/esp32');
    return `${proxyPath}?url=${encodeURIComponent(cleanBase)}`;
  }
  return `${cleanBase}${path}`;
}

/**
 * Fetch authoritative status from ESP32.
 */
export async function fetchESP32Status(
  baseUrl: string = getStoredESP32Url(),
  mode: ESP32ConnectionMode = getStoredConnectionMode(),
  signal?: AbortSignal
): Promise<ESP32Status> {
  const url = buildEndpointUrl('/api/status', baseUrl, mode);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!res.ok) {
    let errDetail = `ESP32 returned HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errDetail = errJson.detail || errJson.error || errJson.message || errDetail;
    } catch {
      // ignore
    }
    throw new Error(errDetail);
  }

  const json = await res.json();
  return normalizeESP32Status(json);
}

/**
 * Toggle Automatic / Manual mode on ESP32 (POST /api/auto/toggle).
 */
export async function toggleESP32Auto(
  baseUrl: string = getStoredESP32Url(),
  mode: ESP32ConnectionMode = getStoredConnectionMode()
): Promise<{ success: boolean; message?: string }> {
  const url = buildEndpointUrl('/api/auto/toggle', baseUrl, mode);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (!res.ok) {
    let errDetail = `Auto toggle failed (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      errDetail = errJson.detail || errJson.error || errJson.message || errDetail;
    } catch {
      // ignore
    }
    throw new Error(errDetail);
  }

  return { success: true };
}

/**
 * Trigger manual pump start on ESP32 (POST /api/pump/start).
 * ESP32 activates pump for max 3s pulse.
 */
export async function startESP32Pump(
  baseUrl: string = getStoredESP32Url(),
  mode: ESP32ConnectionMode = getStoredConnectionMode()
): Promise<{ success: boolean; message?: string }> {
  const url = buildEndpointUrl('/api/pump/start', baseUrl, mode);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (!res.ok) {
    let errDetail = `Pump start failed (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      errDetail = errJson.detail || errJson.error || errJson.message || errDetail;
    } catch {
      // ignore
    }
    throw new Error(errDetail);
  }

  return { success: true };
}

/**
 * Trigger manual pump stop on ESP32 (POST /api/pump/stop).
 */
export async function stopESP32Pump(
  baseUrl: string = getStoredESP32Url(),
  mode: ESP32ConnectionMode = getStoredConnectionMode()
): Promise<{ success: boolean; message?: string }> {
  const url = buildEndpointUrl('/api/pump/stop', baseUrl, mode);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (!res.ok) {
    let errDetail = `Pump stop failed (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      errDetail = errJson.detail || errJson.error || errJson.message || errDetail;
    } catch {
      // ignore
    }
    throw new Error(errDetail);
  }

  return { success: true };
}

/**
 * Fetch backend-persisted ESP32 config.
 */
export async function fetchESP32Config(): Promise<{ esp32_url: string }> {
  try {
    const res = await fetch('/api/esp32/config');
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // backend offline or direct
  }
  return { esp32_url: getStoredESP32Url() };
}

/**
 * Save backend-persisted ESP32 config.
 */
export async function saveESP32Config(url: string): Promise<{ esp32_url: string }> {
  const clean = sanitizeBaseUrl(url);
  setStoredESP32Url(clean);
  try {
    const res = await fetch('/api/esp32/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esp32_url: clean }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // ignore
  }
  return { esp32_url: clean };
}
