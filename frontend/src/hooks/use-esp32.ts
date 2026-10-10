import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchESP32Status,
  toggleESP32Auto,
  startESP32Pump,
  stopESP32Pump,
  getStoredESP32Url,
  setStoredESP32Url,
  getStoredConnectionMode,
  setStoredConnectionMode,
  fetchESP32Config,
  saveESP32Config,
  syncESP32Telemetry,
  type ESP32Status,
  type ESP32ConnectionMode,
} from '@/lib/esp32';

export interface UseESP32Return {
  data: ESP32Status | null;
  isConnected: boolean;
  isStale: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  commandError: string | null;
  isCommandPending: boolean;
  esp32Url: string;
  connectionMode: ESP32ConnectionMode;
  setEsp32Url: (url: string) => Promise<void>;
  setConnectionMode: (mode: ESP32ConnectionMode) => void;
  toggleAuto: () => Promise<void>;
  startPump: () => Promise<void>;
  stopPump: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const POLL_INTERVAL_MS = 1000;

export function useESP32(): UseESP32Return {
  const [data, setData] = useState<ESP32Status | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isCommandPending, setIsCommandPending] = useState<boolean>(false);
  const [esp32Url, setEsp32UrlState] = useState<string>(getStoredESP32Url());
  const [connectionMode, setConnectionModeState] = useState<ESP32ConnectionMode>(getStoredConnectionMode());

  const isPollingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string>(esp32Url);
  const modeRef = useRef<ESP32ConnectionMode>(connectionMode);
  const lastSyncTsRef = useRef<number>(0);
  const lastSyncedMoistureRef = useRef<number | null>(null);

  urlRef.current = esp32Url;
  modeRef.current = connectionMode;

  // Sync with backend config on mount
  useEffect(() => {
    let active = true;
    fetchESP32Config()
      .then((cfg) => {
        if (active && cfg?.esp32_url) {
          setEsp32UrlState(cfg.esp32_url);
        }
      })
      .catch(() => {
        // use local storage fallback
      });
    return () => {
      active = false;
    };
  }, []);

  // Poll function with race-condition / overlap prevention
  const pollStatus = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const status = await fetchESP32Status(urlRef.current, modeRef.current, controller.signal);
      setData(status);
      setIsConnected(true);
      setIsStale(false);
      setIsLoading(false);
      setLastUpdated(new Date());
      setError(null);

      // Periodically sync live sensor reading to backend database
      if (status.soil_moisture_percent != null) {
        const now = Date.now();
        if (now - lastSyncTsRef.current > 10_000 || lastSyncedMoistureRef.current !== status.soil_moisture_percent) {
          lastSyncTsRef.current = now;
          lastSyncedMoistureRef.current = status.soil_moisture_percent;
          void syncESP32Telemetry(status);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return;
      }
      // On failure: retain last valid data, but mark as disconnected / stale
      setIsConnected(false);
      setIsStale(true);
      setIsLoading(false);
      setError(err instanceof Error ? err.message : 'ESP32 is offline or unreachable');
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  // 1-second polling timer lifecycle
  useEffect(() => {
    let mounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const runPoll = async () => {
      if (!mounted) return;
      await pollStatus();
      if (mounted) {
        timerId = setTimeout(runPoll, POLL_INTERVAL_MS);
      }
    };

    void runPoll();

    return () => {
      mounted = false;
      if (timerId) clearTimeout(timerId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [pollStatus]);

  // Update ESP32 Base URL
  const setEsp32Url = useCallback(async (newUrl: string) => {
    setEsp32UrlState(newUrl);
    await saveESP32Config(newUrl);
    void pollStatus();
  }, [pollStatus]);

  // Update Connection Mode (Proxy vs Direct)
  const setConnectionMode = useCallback((newMode: ESP32ConnectionMode) => {
    setConnectionModeState(newMode);
    setStoredConnectionMode(newMode);
    void pollStatus();
  }, [pollStatus]);

  // Command: Toggle Auto
  const toggleAuto = useCallback(async () => {
    if (isCommandPending) return;
    setIsCommandPending(true);
    setCommandError(null);
    try {
      await toggleESP32Auto(urlRef.current, modeRef.current);
      // Immediately refresh authoritative status from device
      await pollStatus();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle mode.';
      setCommandError(msg);
      // Still refresh to ensure UI reflects actual device state
      await pollStatus();
      throw err;
    } finally {
      setIsCommandPending(false);
    }
  }, [isCommandPending, pollStatus]);

  // Command: Start Pump (3s pulse)
  const startPump = useCallback(async () => {
    if (isCommandPending) return;
    if (data?.auto_pump) {
      const msg = 'Manual control disabled while automatic mode is active. Switch to manual mode first.';
      setCommandError(msg);
      throw new Error(msg);
    }
    if (data?.pump_running) {
      const msg = 'Pump is already running.';
      setCommandError(msg);
      throw new Error(msg);
    }

    setIsCommandPending(true);
    setCommandError(null);
    try {
      await startESP32Pump(urlRef.current, modeRef.current);
      // Immediately refresh authoritative status from device
      await pollStatus();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to start pump.';
      setCommandError(msg);
      await pollStatus();
      throw err;
    } finally {
      setIsCommandPending(false);
    }
  }, [data?.auto_pump, data?.pump_running, isCommandPending, pollStatus]);

  // Command: Stop Pump
  const stopPump = useCallback(async () => {
    if (isCommandPending) return;
    setIsCommandPending(true);
    setCommandError(null);
    try {
      await stopESP32Pump(urlRef.current, modeRef.current);
      // Immediately refresh authoritative status from device
      await pollStatus();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to stop pump.';
      setCommandError(msg);
      await pollStatus();
      throw err;
    } finally {
      setIsCommandPending(false);
    }
  }, [isCommandPending, pollStatus]);

  return {
    data,
    isConnected,
    isStale,
    isLoading,
    lastUpdated,
    error,
    commandError,
    isCommandPending,
    esp32Url,
    connectionMode,
    setEsp32Url,
    setConnectionMode,
    toggleAuto,
    startPump,
    stopPump,
    refreshStatus: pollStatus,
  };
}
