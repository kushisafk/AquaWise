import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFieldState, useGetWeather, useGetRecommendation, useGetAnalytics, useGetHistory,
  useGetSettings, useUpdateSettings, useGetCalibration, useUpdateCalibration,
  useStartIrrigation, useStopIrrigation, useApplyTestScenario, useResetField,
  useSubmitFeedback, getGetFieldStateQueryKey, getGetWeatherQueryKey,
  getGetRecommendationQueryKey, getGetAnalyticsQueryKey, getGetHistoryQueryKey,
  getGetSettingsQueryKey, getGetCalibrationQueryKey, getGetNotificationsQueryKey,
} from '@workspace/api-client-react';
import type { Analytics, CalibrationInput, GetHistoryCategory, HistoryEvent, SettingsInput, TestScenarioInput } from '@workspace/api-client-react';
import en from '@/locales/en';
import te from '@/locales/te';
import hi from '@/locales/hi';
import { useAquaWise, tr } from '@/App';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, CloudRain,
  Droplet, Droplets, History, Info, Leaf, LoaderCircle, RefreshCw,
  RotateCcw, ShieldCheck, SlidersHorizontal, Sprout, Sun,
  ThumbsDown, ThumbsUp, Volume2, WifiOff
} from 'lucide-react';
import { Link } from 'wouter';

const copy = { en, te, hi } as const;
const tx = (lang: 'en' | 'te' | 'hi', key: keyof typeof copy.en) => (copy[lang][key] ?? copy.en[key] ?? key) as string;
const qk = [getGetFieldStateQueryKey(), getGetWeatherQueryKey(), getGetRecommendationQueryKey(), getGetAnalyticsQueryKey(), getGetHistoryQueryKey(), getGetNotificationsQueryKey()];
const fmtTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const errText = (error: unknown) => error instanceof Error ? error.message : 'Request could not be completed.';

function PageHeading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}

function LoadingCard({ text }: { text: string }) {
  return (
    <div className="calm-card" style={{ padding: '32px 24px' }} aria-label={text}>
      <div className="skeleton" style={{ height: 20, width: '35%', marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 48, width: '70%', marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 16, width: '50%' }} />
      <p className="subtle" style={{ marginTop: 16, marginBottom: 0 }}>{text}</p>
    </div>
  );
}

function ErrorBanner({ text, retry }: { text: string; retry: () => void }) {
  const { lang } = useAquaWise();
  return (
    <div className="alert-banner error" role="alert">
      <AlertTriangle size={18} />
      <span style={{ flex: 1 }}>{text}</span>
      <button className="btn btn-outline btn-small" onClick={retry}>
        <RefreshCw size={14} />{tr(lang, 'retry')}
      </button>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <main className="page">{children}</main>;
}

function effectText(effect: string, lang: 'en' | 'te' | 'hi') {
  if (effect === 'supports') return lang === 'te' ? 'మద్దతు' : lang === 'hi' ? 'समर्थन' : 'Supports';
  if (effect === 'delays') return lang === 'te' ? 'ఆలస్యం' : lang === 'hi' ? 'देरी' : 'Delays';
  return lang === 'te' ? 'జాగ్రత్త' : lang === 'hi' ? 'सावधानी' : 'Caution';
}

function effectClass(effect: string) {
  if (effect === 'supports') return 'tag-support';
  if (effect === 'delays') return 'tag-delay';
  return 'tag-caution';
}

function localizedWeatherSummary(summary: string | undefined, lang: 'en' | 'te' | 'hi') {
  const labels: Record<string, keyof typeof copy.en> = {
    'Rain now': 'weatherRainNow',
    'Rain likely within 6 hours': 'weatherRainLikely',
    'A chance of rain': 'weatherRainChance',
    'Mostly dry for the next 6 hours': 'weatherMostlyDry',
    'Test scenario override': 'weatherTest',
    'Weather unavailable; using a labelled local simulation': 'weatherFallback',
  };
  const key = summary ? labels[summary] : undefined;
  return key ? tx(lang, key) : summary || '—';
}

function localizedStrategy(name: string, lang: 'en' | 'te' | 'hi') {
  const labels: Record<string, keyof typeof copy.en> = {
    'Fixed schedule': 'strategyFixed',
    'Moisture threshold': 'strategyMoisture',
    'Rain-aware threshold': 'strategyRainAware',
    'Optimized schedule': 'strategyOptimized',
  };
  const key = labels[name];
  return key ? tx(lang, key) : name;
}

const LOCATION_PRESETS = [
  { label: 'Vijayawada, Andhra Pradesh', lat: 16.5062, lon: 80.6480 },
  { label: 'Hyderabad, Telangana', lat: 17.3850, lon: 78.4867 },
  { label: 'Guntur, Andhra Pradesh', lat: 16.3067, lon: 80.4365 },
  { label: 'Amaravati, Andhra Pradesh', lat: 16.5131, lon: 80.5165 },
  { label: 'Nagpur, Maharashtra', lat: 21.1458, lon: 79.0882 },
  { label: 'Bengaluru, Karnataka', lat: 12.9716, lon: 77.5946 },
];

// ==========================================
// 1. HOME SCREEN (Simple, Consumer-Friendly)
// ==========================================
export function DashboardPage() {
  const { lang, notify, stale: appStale } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const client = useQueryClient();
  const field = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const weather = useGetWeather({ query: { queryKey: getGetWeatherQueryKey(), refetchInterval: 60_000 } });
  const rec = useGetRecommendation({ query: { queryKey: getGetRecommendationQueryKey(), refetchInterval: 30_000 } });
  const settings = useGetSettings();
  const start = useStartIrrigation();
  const stop = useStopIrrigation();
  const feedback = useSubmitFeedback();

  const invalidate = () => { qk.forEach((queryKey) => void client.invalidateQueries({ queryKey })); };
  const state = field.data;
  const recommendation = rec.data || state?.recommendation;
  const conditionStale = appStale || !!weather.data?.stale || recommendation?.provenance === 'stale' || state?.telemetry.provenance === 'stale';

  const refresh = () => { void field.refetch(); void weather.refetch(); void rec.refetch(); };

  const runWater = () => {
    if (!recommendation) return;
    const cap = settings.data?.maxDurationMinutes ?? 60;
    const duration = Math.max(1, Math.min(cap, recommendation.durationMinutes ?? 15));
    start.mutate(
      { data: { durationMinutes: duration } },
      {
        onSuccess: () => {
          invalidate();
          notify(l === 'te' ? 'నీటి చర్య ప్రారంభమైంది.' : l === 'hi' ? 'सिंचाई शुरू हुई।' : 'Watering session started.');
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  const doStop = () => {
    stop.mutate(undefined, {
      onSuccess: () => {
        invalidate();
        notify(l === 'te' ? 'నీటి చర్య ఆపబడింది.' : l === 'hi' ? 'सिंचाई रोक दी गई।' : 'Watering session stopped.');
      },
      onError: (error) => notify(errText(error)),
    });
  };

  const sendFeedback = (helpful: boolean) => {
    feedback.mutate(
      { data: { helpful, comment: '' } },
      {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
          notify(tx(l, 'thankFeedback'));
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  const readAloud = () => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      notify(tx(l, 'voiceUnavailable'));
      return;
    }
    if (!recommendation && !isWatering) return;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang.toLowerCase().startsWith(l));
    if (l !== 'en' && !voice) {
      notify(tx(l, 'voiceMissing'));
      return;
    }

    const duration = recommendation?.durationMinutes ?? state?.irrigation.durationMinutes ?? 15;
    let spokenText = '';

    if (isWatering) {
      spokenText = l === 'te'
        ? `${duration} నిమిషాలు నీరు పెట్టడం జరుగుతోంది.`
        : l === 'hi'
          ? `${duration} मिनट के लिए सिंचाई चल रही है।`
          : `Watering is running for ${duration} minutes.`;
    } else if (status === 'WATER NOW') {
      spokenText = l === 'te'
        ? `మీ పొలానికి ${duration} నిమిషాలు నీరు పెట్టండి. నేల ఎండిపోయింది.`
        : l === 'hi'
          ? `अपने खेत में ${duration} मिनट पानी दें। मिट्टी सूखी है।`
          : `Water your field for ${duration} minutes. The soil is dry.`;
    } else if (status === 'CHECK FIELD') {
      spokenText = l === 'te'
        ? 'దయచేసి మీ పొలాన్ని తనిఖీ చేయండి. తేమ రీడింగ్ సరిగా లేదు.'
        : l === 'hi'
          ? 'कृपया अपना खेत देखें। नमी सामान्य नहीं है।'
          : 'Please check your field. The soil reading looks unusual.';
    } else {
      const isRain = weather.data?.rainingNow || (weather.data?.rainProbability6h ?? 0) >= 50;
      if (isRain) {
        spokenText = l === 'te'
          ? 'వేచి ఉండండి, త్వరలో వర్షం రానుంది. నీరు పెట్టవద్దు.'
          : l === 'hi'
            ? 'इंतज़ार करें, जल्द बारिश हो सकती है। पानी न दें।'
            : 'Wait, rain is coming soon. No need to water.';
      } else {
        spokenText = l === 'te'
          ? 'ఇప్పుడు నీరు అవసరం లేదు. నేలలో సరిపడా తేమ ఉంది.'
          : l === 'hi'
            ? 'अभी पानी देने की ज़रूरत नहीं है। मिट्टी में पर्याप्त नमी है।'
            : 'No need to water right now. Your soil has enough moisture.';
      }
    }

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = l === 'te' ? 'te-IN' : l === 'hi' ? 'hi-IN' : 'en-IN';
    if (voice) utterance.voice = voice;
    utterance.onerror = () => notify(tx(l, 'voiceError'));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  if (field.isLoading && !state) {
    return (
      <Page>
        <LoadingCard text={tx(l, 'loading')} />
      </Page>
    );
  }

  const isWatering = Boolean(state?.irrigation.active);
  const status = recommendation?.status;

  const statusTone = isWatering
    ? 'watering'
    : status === 'WATER NOW'
      ? 'water-now'
      : status === 'CHECK FIELD'
        ? 'check-field'
        : 'wait';

  let dominantTitle = tx(l, 'allSet');
  if (isWatering) {
    dominantTitle = tx(l, 'activeSession');
  } else if (status === 'WATER NOW') {
    dominantTitle = tx(l, 'waterNowTitle');
  } else if (status === 'CHECK FIELD') {
    dominantTitle = tx(l, 'checkFieldTitle');
  }

  const explanation = isWatering
    ? (l === 'te'
        ? `నీరు పెట్టడం జరుగుతోంది (${state?.irrigation.durationMinutes ?? 15} నిమిషాలు).`
        : l === 'hi'
          ? `सिंचाई चल रही है (${state?.irrigation.durationMinutes ?? 15} मिनट)।`
          : `Watering right now for ${state?.irrigation.durationMinutes ?? 15} minutes.`)
    : (recommendation?.reason || tx(l, 'reasonFallback'));

  return (
    <Page>
      {(field.isError || rec.isError) && (
        <ErrorBanner text={`${tx(l, 'error')} ${field.error ? errText(field.error) : ''}`} retry={refresh} />
      )}
      {state?.connectionStatus === 'offline' && (
        <div className="alert-banner error" role="status">
          <WifiOff size={16} />
          <span>{tx(l, 'stale')}</span>
        </div>
      )}
      {conditionStale && state?.connectionStatus !== 'offline' && (
        <div className="alert-banner info" role="status">
          <Info size={16} />
          <span>{tx(l, 'stale')}</span>
        </div>
      )}

      {/* Dominant Hero Recommendation Card (Clean, No Pills) */}
      <section className={`calm-hero tone-${statusTone}`} data-testid="card-recommendation">
        <h1 className="hero-dominant-title">{dominantTitle}</h1>

        <p className="hero-explanation">{explanation}</p>

        {/* Primary Single Action */}
        <div className="hero-actions-container">
          {isWatering ? (
            <button
              className="btn btn-prominent-danger"
              onClick={doStop}
              disabled={stop.isPending || appStale}
              data-testid="button-stop-irrigation"
            >
              {stop.isPending ? <LoaderCircle size={18} className="animate-spin" /> : <Droplet size={18} />}
              <span>{tx(l, 'stopWatering')}</span>
            </button>
          ) : status === 'WATER NOW' ? (
            <button
              className="btn btn-prominent-action"
              onClick={runWater}
              disabled={!recommendation || start.isPending || appStale || state?.connectionStatus === 'offline'}
              data-testid="button-start-irrigation"
            >
              {start.isPending ? <LoaderCircle size={18} className="animate-spin" /> : <Droplets size={18} />}
              <span>
                {tx(l, 'water')}
                {recommendation?.durationMinutes ? ` (${recommendation.durationMinutes} ${tx(l, 'minutes')})` : ''}
              </span>
            </button>
          ) : status === 'CHECK FIELD' ? (
            <Link href="/settings#calibration" className="btn btn-prominent-action" data-testid="button-troubleshoot-field">
              <span>{tx(l, 'troubleshootField')}</span>
              <ArrowRight size={17} />
            </Link>
          ) : (
            <Link href="/analytics" className="btn btn-prominent-action" data-testid="button-view-insights">
              <span>{tx(l, 'viewInsights')}</span>
              <ArrowRight size={17} />
            </Link>
          )}

          <button
            className="icon-subtle-btn"
            onClick={readAloud}
            aria-label={tx(l, 'readAloud')}
            title={tx(l, 'readAloud')}
            data-testid="button-read-aloud"
          >
            <Volume2 size={18} strokeWidth={1.8} />
          </button>
        </div>
      </section>

      {/* Supporting Information: Exactly 3 Compact Metrics */}
      <section className="calm-metrics-strip" aria-label="Field overview metrics">
        <div className="calm-metric-unit" data-testid="card-soil-moisture">
          <div className="calm-metric-header">
            <Droplets size={14} className="metric-icon" />
            <span className="metric-label">{tx(l, 'soilMoistureLabel')}</span>
          </div>
          <div className="calm-metric-number">
            {state?.telemetry.soilMoisture == null ? '—' : `${state.telemetry.soilMoisture}%`}
          </div>
          <div className="calm-metric-caption">
            {state?.telemetry.soilMoisture == null
              ? tx(l, 'noMoisture')
              : `${tx(l, 'target')} ${state?.targetMoisture ?? '—'}% · ${tx(l, 'threshold')} ${state?.lowThreshold ?? '—'}%`}
          </div>
        </div>

        <div className="calm-metric-separator" />

        <div className="calm-metric-unit" data-testid="card-temperature">
          <div className="calm-metric-header">
            <Sun size={14} className="metric-icon" />
            <span className="metric-label">{tx(l, 'temperatureLabel')}</span>
          </div>
          <div className="calm-metric-number">
            {weather.data?.temperatureC != null
              ? `${weather.data.temperatureC}°C`
              : state?.telemetry.temperatureC != null
                ? `${state.telemetry.temperatureC}°`
                : '—'}
          </div>
          <div className="calm-metric-caption">
            {weather.data?.summary
              ? localizedWeatherSummary(weather.data.summary, l)
              : (l === 'te' ? 'సాధారణ ఉష్ణోగ్రత' : l === 'hi' ? 'सामान्य तापमान' : 'Normal range')}
          </div>
        </div>

        <div className="calm-metric-separator" />

        <div className="calm-metric-unit" data-testid="card-weather">
          <div className="calm-metric-header">
            <CloudRain size={14} className="metric-icon" />
            <span className="metric-label">{tx(l, 'upcomingRainLabel')}</span>
          </div>
          <div className="calm-metric-number">
            {weather.data?.precipitationMm6h != null ? `${weather.data.precipitationMm6h} mm` : '0 mm'}
          </div>
          <div className="calm-metric-caption">
            {weather.data?.rainProbability6h != null
              ? `${weather.data.rainProbability6h}% ${tx(l, 'rainChance')}`
              : (l === 'te' ? 'రాబోయే 6 గంటలు' : l === 'hi' ? 'अगले 6 घंटे' : 'Next 6 hours')}
          </div>
        </div>
      </section>

      {/* Discreet Feedback & Data Freshness Bar */}
      <div className="home-footer-meta">
        <span className="subtle">
          {tx(l, 'updated')} {fmtTime(recommendation?.updatedAt)} · {tx(l, 'simulatedNotice')}
        </span>
        <div className="home-feedback-inline">
          <span className="feedback-prompt">{tx(l, 'feedback')}</span>
          <button
            className="feedback-btn"
            disabled={feedback.isPending || !recommendation}
            onClick={() => sendFeedback(true)}
            data-testid="button-feedback-yes"
            title={tx(l, 'helpful')}
          >
            <ThumbsUp size={14} />
          </button>
          <button
            className="feedback-btn"
            disabled={feedback.isPending || !recommendation}
            onClick={() => sendFeedback(false)}
            data-testid="button-feedback-no"
            title={tx(l, 'notHelpful')}
          >
            <ThumbsDown size={14} />
          </button>
        </div>
      </div>
    </Page>
  );
}

// ==========================================
// 2. INSIGHTS SCREEN (Progressive Disclosure)
// ==========================================
function Chart({ data }: { data: Analytics }) {
  const history = data.history || [];
  const forecast = data.forecast || [];

  // Bounded Y-scale: 0% at y=180, 100% at y=25 (height 155px)
  const getY = (val: number) => {
    const clamped = Math.max(0, Math.min(100, val));
    return 180 - (clamped / 100) * 155;
  };

  const histPoints = history.map((x, i) => ({
    x: 42 + i * (250 / Math.max(history.length - 1, 1)),
    y: getY(x.moisturePercent),
  }));

  const cutoffX = history.length ? 42 + (history.length - 1) * (250 / Math.max(history.length - 1, 1)) : 42;

  const forePoints = forecast.map((x, i) => ({
    x: cutoffX + (i + 1) * (215 / Math.max(forecast.length, 1)),
    y: getY(x.moisturePercent),
  }));

  const allPoints = [...histPoints, ...forePoints];
  const histPath = histPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const forePath = [
    histPoints.at(-1) ? `M${histPoints.at(-1)!.x},${histPoints.at(-1)!.y}` : '',
    ...forePoints.map((p, i) => `${i === 0 && !histPoints.length ? 'M' : 'L'}${p.x},${p.y}`)
  ].filter(Boolean).join(' ');

  return (
    <svg className="chart-svg" viewBox="0 0 540 220" role="img" aria-label={`Moisture chart: ${history.length} observed, ${forecast.length} forecast points`}>
      {/* Horizontal guide lines */}
      {[0, 25, 50, 75, 100].map((pct) => {
        const y = getY(pct);
        return (
          <g key={pct}>
            <line x1="42" x2="520" y1={y} y2={y} stroke="#edf2eb" strokeDasharray="3 4" />
            <text x="7" y={y + 4} className="chart-axis">{pct}%</text>
          </g>
        );
      })}

      {/* Now boundary line */}
      <line x1={cutoffX} x2={cutoffX} y1="20" y2="185" stroke="#d5ded3" strokeDasharray="4 4" />

      {/* Historical path */}
      {histPoints.length > 1 && (
        <path d={histPath} fill="none" stroke="#1b4332" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Forecast path */}
      {forePoints.length > 0 && (
        <path d={forePath} fill="none" stroke="#c48a36" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Historical points */}
      {histPoints.map((p, i) => (
        <circle key={`h-${i}`} cx={p.x} cy={p.y} r="3.5" fill="#1b4332" />
      ))}

      {/* Forecast points */}
      {forePoints.map((p, i) => (
        <circle key={`f-${i}`} cx={p.x} cy={p.y} r="3.5" fill="#c48a36" />
      ))}

      <text x="42" y="206" className="chart-axis">{history.length ? 'Past 24h' : 'Current'}</text>
      <text x={Math.max(42, cutoffX - 12)} y="206" className="chart-axis" style={{ fontWeight: 600 }}>Now</text>
      <text x="450" y="206" className="chart-axis">+{forecast.at(-1)?.hours ?? 48}h forecast</text>
    </svg>
  );
}

export function AnalyticsPage() {
  const { lang } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const query = useGetAnalytics({ query: { queryKey: getGetAnalyticsQueryKey(), refetchInterval: 60_000 } });
  const rec = useGetRecommendation({ query: { queryKey: getGetRecommendationQueryKey(), refetchInterval: 60_000 } });
  const field = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 60_000 } });
  const data = query.data;
  const recommendation = rec.data;

  // Collapsible sections
  const [showStrategies, setShowStrategies] = useState(false);
  const [showHourly, setShowHourly] = useState(false);
  const [showFactors, setShowFactors] = useState(false);
  const [showModelDetails, setShowModelDetails] = useState(false);

  const bestStrategy = data?.strategies?.find((s) => (s as { isRecommended?: boolean }).isRecommended)
    || data?.strategies?.find((s) => s.name === 'Optimized schedule')
    || data?.strategies?.[0];

  const baselineStrategy = data?.strategies?.find((s) => s.name === 'Fixed schedule');

  return (
    <Page>
      <PageHeading
        eyebrow={tx(l, 'forecast')}
        title={tx(l, 'analyticsTitle')}
        subtitle={tx(l, 'analyticsSub')}
      />

      {query.isLoading && <LoadingCard text={tx(l, 'loading')} />}
      {query.isError && <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />}

      {data && (
        <div className="insights-container">
          {/* Default 1: Concise Moisture Outlook & Chart */}
          <section className="calm-card" data-testid="chart-moisture">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'moisture')}</h2>
                <p className="section-subtitle-clean">
                  {tx(l, 'forecastLabel')}: {data.forecastLabel}
                </p>
              </div>
              <div className="chart-legend-clean">
                <span className="legend-item"><i className="legend-dot observed" />{tx(l, 'observed')}</span>
                <span className="legend-item"><i className="legend-dot forecast" />{tx(l, 'predicted')}</span>
              </div>
            </div>

            {(!data.history?.length && !data.forecast?.length) ? (
              <div className="empty-state">
                <Leaf size={28} />
                <h3>{tx(l, 'noHistory')}</h3>
                <p>{tx(l, 'noForecast')}</p>
              </div>
            ) : (
              <Chart data={data} />
            )}
          </section>

          {/* Default 2: Preferred Irrigation Schedule Summary */}
          {bestStrategy && baselineStrategy && (
            <section className="calm-card" data-testid="card-preferred-strategy">
              <div className="section-header">
                <div>
                  <div className="strategy-badge-recommended" style={{ marginBottom: 6 }}>
                    <Check size={12} />
                    <span>{tx(l, 'preferredSchedule')}</span>
                  </div>
                  <h2 className="section-title-clean">{localizedStrategy(bestStrategy.name, l)}</h2>
                  <p className="section-subtitle-clean">
                    {(bestStrategy as { description?: string }).description || 'Predictive water management plan'}
                  </p>
                </div>
                <div className="strategy-number">
                  {bestStrategy.waterLitres} <span className="unit">{tx(l, 'litres')}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
                <div className="summary-chip" style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx(l, 'saving')}</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }} className={bestStrategy.waterSavedPercent > 0 ? 'badge-savings-positive' : bestStrategy.waterSavedPercent < 0 ? 'badge-savings-negative' : 'badge-savings-neutral'}>
                    {bestStrategy.waterSavedPercent > 0 ? `+${bestStrategy.waterSavedPercent}%` : `${bestStrategy.waterSavedPercent}%`}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                    {tx(l, 'baselineComparison')} ({baselineStrategy.waterLitres} L)
                  </div>
                </div>

                <div className="summary-chip" style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx(l, 'stress')}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: bestStrategy.dryStressHours === 0 ? '#2b6d41' : '#9c651e' }}>
                    {bestStrategy.dryStressHours}h
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                    under {field.data?.lowThreshold ?? 32.5}% threshold
                  </div>
                </div>

                <div className="summary-chip" style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx(l, 'overwatering')}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
                    {bestStrategy.overwateringHours}h
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                    above optimal target
                  </div>
                </div>
              </div>

              <div className="strategy-assumptions-box">
                {tx(l, 'flowRateAssumption').replace('{rate}', String((bestStrategy as { assumedFlowRateLpm?: number }).assumedFlowRateLpm || 12))}
              </div>
            </section>
          )}

          {/* Collapsible 1: All 4 Strategies Compared */}
          <section className="calm-card" data-testid="card-all-strategies">
            <button
              type="button"
              className="collapsible-trigger"
              onClick={() => setShowStrategies(!showStrategies)}
              data-testid="button-toggle-strategies"
            >
              <div>
                <h2 className="section-title-clean">{tx(l, 'strategies')} (4)</h2>
                <p className="section-subtitle-clean">Compare water use, drought stress and timer baseline</p>
              </div>
              <ChevronDown size={18} style={{ transform: showStrategies ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {showStrategies && data.strategies && (
              <div className="collapsible-panel">
                <div className="clean-list">
                  {data.strategies.map((strategy, i) => (
                    <article className="strategy-clean-row" key={`${strategy.name}-${i}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="strategy-name">{localizedStrategy(strategy.name, l)}</span>
                          {strategy.name === 'Fixed schedule' && (
                            <span className="summary-chip" style={{ fontSize: 10, padding: '2px 6px' }}>Baseline</span>
                          )}
                          {(strategy as { isRecommended?: boolean }).isRecommended && (
                            <span className="strategy-badge-recommended" style={{ fontSize: 10, padding: '2px 6px' }}>
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="strategy-detail">
                          {(strategy as { description?: string }).description || ''}
                        </div>
                        <div className="strategy-detail" style={{ marginTop: 4 }}>
                          {tx(l, 'stress')}: {strategy.dryStressHours}h · {tx(l, 'overwatering')}: {strategy.overwateringHours}h ·{' '}
                          <span className={strategy.waterSavedPercent > 0 ? 'badge-savings-positive' : strategy.waterSavedPercent < 0 ? 'badge-savings-negative' : 'badge-savings-neutral'}>
                            {strategy.waterSavedPercent > 0
                              ? `${strategy.waterSavedPercent}% ${tx(l, 'savings')}`
                              : strategy.waterSavedPercent < 0
                                ? `${Math.abs(strategy.waterSavedPercent)}% ${tx(l, 'increasedUse')}`
                                : '0% (Equal water)'}
                          </span>
                        </div>
                      </div>
                      <div className="strategy-number">
                        {strategy.waterLitres} <span className="unit">{tx(l, 'litres')}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Collapsible 2: Hourly Forecast Breakdown */}
          <section className="calm-card" data-testid="card-hourly-forecast">
            <button
              type="button"
              className="collapsible-trigger"
              onClick={() => setShowHourly(!showHourly)}
              data-testid="button-toggle-hourly"
            >
              <div>
                <h2 className="section-title-clean">{tx(l, 'hourlyOutlook')}</h2>
                <p className="section-subtitle-clean">Predicted soil moisture from +1h to +48h</p>
              </div>
              <ChevronDown size={18} style={{ transform: showHourly ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {showHourly && data.forecast && (
              <div className="collapsible-panel">
                <div className="clean-list">
                  {data.forecast.map((point, i) => (
                    <article className="forecast-timeline-row" key={`${point.hours}-${i}`}>
                      <div className="timeline-hour">+{point.hours}h</div>
                      <div className="timeline-meta">{point.provenance} · {tx(l, 'simulatedNotice')}</div>
                      <div className="timeline-value">{point.moisturePercent}%</div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Collapsible 3: Contributing Factors */}
          <section className="calm-card" data-testid="card-decision-factors">
            <button
              type="button"
              className="collapsible-trigger"
              onClick={() => setShowFactors(!showFactors)}
              data-testid="button-toggle-factors"
            >
              <div>
                <h2 className="section-title-clean">{tx(l, 'reasons')}</h2>
                <p className="section-subtitle-clean">
                  {tx(l, 'confidence')}: {recommendation?.confidence ?? 'High'} · {tx(l, 'source')}: {recommendation?.provenance ?? 'Simulated'}
                </p>
              </div>
              <ChevronDown size={18} style={{ transform: showFactors ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {showFactors && (
              <div className="collapsible-panel">
                {recommendation?.factors?.length ? (
                  <div className="clean-list">
                    {recommendation.factors
                      .slice()
                      .sort((a, b) => a.rank - b.rank)
                      .map((factor, index) => (
                        <article className="factor-row" key={`${factor.name}-${index}`}>
                          <div className="factor-info">
                            <span className="factor-rank">{factor.rank}</span>
                            <div>
                              <div className="factor-name">{factor.name}</div>
                              <div className="factor-detail">{factor.detail}</div>
                            </div>
                          </div>
                          <span className={`factor-badge ${effectClass(factor.effect)}`}>
                            {effectText(factor.effect, l)}
                          </span>
                        </article>
                      ))}
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '16px 8px' }}>
                    <Info size={20} />
                    <p>{tx(l, 'noFactors')}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Collapsible 4: Forecast Model Status & Transparency */}
          <section className="calm-card" data-testid="card-model-status">
            <button
              type="button"
              className="collapsible-trigger"
              onClick={() => setShowModelDetails(!showModelDetails)}
              data-testid="button-toggle-model-details"
            >
              <div>
                <h2 className="section-title-clean">{tx(l, 'modelStatus')}</h2>
                <p className="section-subtitle-clean">Provenance and evaluation parameters</p>
              </div>
              <ChevronDown size={18} style={{ transform: showModelDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {showModelDetails && (
              <div className="collapsible-panel">
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  {data.forecastLabel.includes('tree') || data.forecastLabel.includes('ML')
                    ? tx(l, 'modelExperimentalNotice')
                    : tx(l, 'modelFallbackNotice')}
                </p>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-subtle)' }}>
                  Active engine: <strong style={{ color: 'var(--text-main)' }}>{data.forecastLabel}</strong>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

// ==========================================
// 3. HISTORY SCREEN (Grouped & Paginated)
// ==========================================
const categories: { value: GetHistoryCategory; key: keyof typeof copy.en }[] = [
  { value: 'all', key: 'all' },
  { value: 'irrigation', key: 'irrigation' },
  { value: 'recommendation', key: 'recommendation' },
  { value: 'alert', key: 'alert' },
  { value: 'feedback', key: 'feedbackEvents' },
];

function EventGlyph({ category }: { category: string }) {
  if (category === 'irrigation') return <Droplet size={16} />;
  if (category === 'alert') return <AlertTriangle size={16} />;
  if (category === 'recommendation') return <ShieldCheck size={16} />;
  if (category === 'feedback') return <ThumbsUp size={16} />;
  return <Leaf size={16} />;
}

export function HistoryPage() {
  const { lang } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const [category, setCategory] = useState<GetHistoryCategory>('all');
  const [displayCount, setDisplayCount] = useState(15);

  const params = category === 'all' ? { limit: 150 } : { category, limit: 150 };
  const query = useGetHistory(params, { query: { queryKey: getGetHistoryQueryKey(params), refetchInterval: 60_000 } });

  const rawEvents = query.data || [];
  const visibleEvents = rawEvents.slice(0, displayCount);
  const hasMore = rawEvents.length > displayCount;

  // Group visible events by day
  const todayStr = new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const groups: { label: string; dateStr: string; items: HistoryEvent[] }[] = [];
  for (const item of visibleEvents) {
    const d = new Date(item.at);
    const dateStr = d.toDateString();
    let label = '';
    if (dateStr === todayStr) {
      label = tx(l, 'today');
    } else if (dateStr === yesterdayStr) {
      label = tx(l, 'yesterday');
    } else {
      label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    let group = groups.find((g) => g.dateStr === dateStr);
    if (!group) {
      group = { label, dateStr, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return (
    <Page>
      <PageHeading
        eyebrow={tx(l, 'historyTitle')}
        title={tx(l, 'historyTitle')}
        subtitle={tx(l, 'historySub')}
      />

      {/* Category filter pills */}
      <div className="filters-strip" role="tablist" aria-label={tx(l, 'historyTitle')}>
        {categories.map((item) => (
          <button
            key={item.value}
            className={`filter-pill ${category === item.value ? 'active' : ''}`}
            role="tab"
            aria-selected={category === item.value}
            onClick={() => {
              setCategory(item.value);
              setDisplayCount(15);
            }}
            data-testid={`filter-history-${item.value}`}
          >
            {tx(l, item.key)}
          </button>
        ))}
      </div>

      {query.isLoading && (
        <div className="calm-card" style={{ padding: 24, marginTop: 16 }}>
          <div className="skeleton" style={{ height: 48, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 48, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 48 }} />
        </div>
      )}

      {query.isError && (
        <div style={{ marginTop: 16 }}>
          <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />
        </div>
      )}

      {query.data && (
        <section className="calm-card" style={{ marginTop: 16 }} data-testid="list-history">
          {groups.length ? (
            <div>
              {groups.map((group) => (
                <div key={group.dateStr} className="history-day-group">
                  <div className="history-day-header">
                    <span className="history-day-title">{group.label}</span>
                    <span className="history-day-count">{group.items.length} events</span>
                  </div>
                  <div className="clean-list">
                    {group.items.map((item: HistoryEvent) => (
                      <article className="activity-entry" key={item.id} data-testid={`event-row-${item.id}`}>
                        <div className="activity-icon-container">
                          <EventGlyph category={item.category} />
                        </div>
                        <div className="activity-body">
                          <div className="activity-title">{item.title}</div>
                          <div className="activity-detail">{item.detail}</div>
                          <div className="activity-meta">
                            {tx(l, 'eventSource')}: {item.source}
                          </div>
                        </div>
                        <time className="activity-timestamp">{fmtTime(item.at)}</time>
                      </article>
                    ))}
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className="load-more-row">
                  <button
                    className="btn btn-outline btn-small"
                    onClick={() => setDisplayCount((prev) => prev + 20)}
                    data-testid="button-load-more"
                  >
                    <span>{tx(l, 'loadMore')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <History size={26} />
              <h3>{tx(l, 'noEvents')}</h3>
              <p>{tx(l, 'simulatedNotice')}</p>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}

// ==========================================
// 4. SETTINGS & FIELD SETUP SCREEN
// ==========================================
export function SettingsPage() {
  const { lang, notify, stale: appStale } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const client = useQueryClient();

  const settingsQuery = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 60_000 } });
  const saveSettings = useUpdateSettings();

  const calibQuery = useGetCalibration({ query: { queryKey: getGetCalibrationQueryKey(), refetchInterval: 60_000 } });
  const fieldQuery = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const saveCalib = useUpdateCalibration();

  const scenario = useApplyTestScenario();
  const reset = useResetField();

  // Local settings state
  const [form, setForm] = useState<SettingsInput | null>(null);
  useEffect(() => {
    if (settingsQuery.data && !form) setForm({ ...settingsQuery.data });
  }, [settingsQuery.data, form]);

  // Local calibration state
  const [dry, setDry] = useState('');
  const [wet, setWet] = useState('');
  useEffect(() => {
    if (calibQuery.data && dry === '' && wet === '') {
      setDry(String(calibQuery.data.dryPoint));
      setWet(String(calibQuery.data.wetPoint));
    }
  }, [calibQuery.data?.dryPoint, calibQuery.data?.wetPoint, dry, wet]);

  // Developer tools toggle
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [scenarioMoisture, setScenarioMoisture] = useState('24');
  const [scenarioRain, setScenarioRain] = useState('48');
  const [showCustomCoords, setShowCustomCoords] = useState(false);

  const dryVal = Number(dry);
  const wetVal = Number(wet);
  const isCalibValid = dry !== '' && wet !== '' && dryVal >= 0 && wetVal <= 100 && dryVal < wetVal;

  // Recalculated operating thresholds preview
  const previewSpan = isCalibValid ? wetVal - dryVal : 50;
  const previewLow = isCalibValid ? Math.round((dryVal + 0.25 * previewSpan) * 10) / 10 : 32.5;
  const previewTarget = isCalibValid ? Math.round((dryVal + 0.70 * previewSpan) * 10) / 10 : 55.0;

  const updateSetting = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const changeSetting = (key: keyof SettingsInput, value: string | boolean) => {
    if (!form) return;
    if (key === 'language' || key === 'controlMode') updateSetting(key, value as never);
    else if (typeof form[key] === 'boolean') updateSetting(key, value as boolean as never);
    else if (key === 'quietHoursStart' || key === 'quietHoursEnd') updateSetting(key, value as never);
    else updateSetting(key, Number(value) as never);
  };

  const handlePresetSelect = (presetIndex: number) => {
    if (presetIndex < 0) {
      setShowCustomCoords(true);
      return;
    }
    const preset = LOCATION_PRESETS[presetIndex];
    if (preset) {
      updateSetting('latitude', preset.lat);
      updateSetting('longitude', preset.lon);
    }
  };

  const handleSettingsSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    saveSettings.mutate(
      { data: form },
      {
        onSuccess: (saved) => {
          client.setQueryData(getGetSettingsQueryKey(), saved);
          void client.invalidateQueries({ queryKey: getGetFieldStateQueryKey() });
          notify(tx(saved.language, 'settingsSaved'));
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  const captureCurrent = (point: 'dry' | 'wet') => {
    const moisture = fieldQuery.data?.telemetry.soilMoisture;
    if (moisture == null) {
      notify(tx(l, 'noReading'));
      return;
    }
    (point === 'dry' ? setDry : setWet)(String(moisture));
  };

  const handleCalibSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCalibValid) return;
    const payload: CalibrationInput = { dryPoint: dryVal, wetPoint: wetVal };
    saveCalib.mutate(
      { data: payload },
      {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: getGetCalibrationQueryKey() });
          void client.invalidateQueries({ queryKey: getGetFieldStateQueryKey() });
          notify(tx(l, 'calibrationSaved'));
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  const applyScenario = (mode: 'dry' | 'rain' | 'fault') => {
    const input: TestScenarioInput = {
      soilMoisture: mode === 'fault' ? null : Number(scenarioMoisture),
      rainingNow: mode === 'rain',
      rainProbability6h: Number(scenarioRain),
      precipitationMm6h: mode === 'rain' ? 6.4 : 0,
      sensorFault: mode === 'fault',
    };
    scenario.mutate(
      { data: input },
      {
        onSuccess: () => {
          qk.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
          notify(l === 'te' ? 'పరీక్ష పరిస్థితి వర్తింపజేయబడింది.' : l === 'hi' ? 'परीक्षण स्थिति लागू की गई।' : 'Test scenario applied.');
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  const resetAll = () => {
    if (!window.confirm(tx(l, 'resetConfirm'))) return;
    reset.mutate(undefined, {
      onSuccess: () => {
        qk.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
        notify(l === 'te' ? 'పొలం రీసెట్ అయింది.' : l === 'hi' ? 'खेत रीसेट हुआ।' : 'Field simulation reset.');
      },
      onError: (error) => notify(errText(error)),
    });
  };

  return (
    <Page>
      <PageHeading
        eyebrow={tx(l, 'settingsTitle')}
        title={tx(l, 'settingsTitle')}
        subtitle={tx(l, 'settingsSub')}
      />

      {settingsQuery.isLoading && <LoadingCard text={tx(l, 'loadingSettings')} />}
      {settingsQuery.isError && (
        <ErrorBanner text={`${tx(l, 'settingsError')} ${errText(settingsQuery.error)}`} retry={() => void settingsQuery.refetch()} />
      )}

      {form && (
        <div className="settings-stack">
          {/* Main Settings Form */}
          <form onSubmit={handleSettingsSubmit} className="calm-card" data-testid="form-settings">
            {/* Section 1: Preferences */}
            <div className="form-group-section">
              <h2 className="group-heading">{tx(l, 'preferencesSection')}</h2>
              <div className="form-fields-grid">
                <div className="form-control">
                  <label htmlFor="language">{tx(l, 'language')}</label>
                  <select
                    id="language"
                    value={form.language}
                    onChange={(e) => changeSetting('language', e.target.value)}
                    data-testid="select-language"
                  >
                    <option value="en">{tx(l, 'english')}</option>
                    <option value="te">{tx(l, 'telugu')}</option>
                    <option value="hi">{tx(l, 'hindi')}</option>
                  </select>
                </div>

                <div className="form-control">
                  <label htmlFor="control-mode">{tx(l, 'control')}</label>
                  <select
                    id="control-mode"
                    value={form.controlMode}
                    onChange={(e) => changeSetting('controlMode', e.target.value)}
                    data-testid="select-control-mode"
                  >
                    <option value="advisory">{tx(l, 'advisory')}</option>
                    <option value="auto">{tx(l, 'automatic')}</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    {tx(l, 'controlHelp')}
                  </span>
                </div>
              </div>

              <div className="toggle-item-row" style={{ marginTop: 14 }}>
                <div>
                  <div className="toggle-title">{tx(l, 'notifications')}</div>
                  <div className="toggle-sub">{tx(l, 'notificationsHelp')}</div>
                </div>
                <input
                  aria-label={tx(l, 'notifications')}
                  className="switch"
                  type="checkbox"
                  checked={form.notificationsEnabled}
                  onChange={(e) => changeSetting('notificationsEnabled', e.target.checked)}
                  data-testid="toggle-notifications"
                />
              </div>
            </div>

            <div className="section-separator" />

            {/* Section 2: Watering Rules */}
            <div className="form-group-section">
              <h2 className="group-heading">{tx(l, 'irrigationSection')}</h2>

              <div className="form-fields-grid">
                <div className="form-control">
                  <label htmlFor="max-duration">{tx(l, 'maxDuration')} ({tx(l, 'min')})</label>
                  <input
                    id="max-duration"
                    type="number"
                    min="1"
                    max="240"
                    value={form.maxDurationMinutes}
                    onChange={(e) => changeSetting('maxDurationMinutes', e.target.value)}
                    data-testid="input-max-duration"
                  />
                </div>

                <div className="form-control">
                  <label htmlFor="flow-rate">{tx(l, 'flow')} ({tx(l, 'perMinute')})</label>
                  <input
                    id="flow-rate"
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={form.flowLitresPerMinute}
                    onChange={(e) => changeSetting('flowLitresPerMinute', e.target.value)}
                    data-testid="input-flow-rate"
                  />
                </div>
              </div>

              <div className="form-fields-grid" style={{ marginTop: 14 }}>
                <div className="form-control">
                  <label htmlFor="quiet-start">{tx(l, 'quietHours')} · {tx(l, 'from')}</label>
                  <input
                    id="quiet-start"
                    type="time"
                    value={form.quietHoursStart}
                    onChange={(e) => changeSetting('quietHoursStart', e.target.value)}
                    data-testid="input-quiet-start"
                  />
                </div>
                <div className="form-control">
                  <label htmlFor="quiet-end">{tx(l, 'quietHours')} · {tx(l, 'to')}</label>
                  <input
                    id="quiet-end"
                    type="time"
                    value={form.quietHoursEnd}
                    onChange={(e) => changeSetting('quietHoursEnd', e.target.value)}
                    data-testid="input-quiet-end"
                  />
                </div>
              </div>
            </div>

            <div className="section-separator" />

            {/* Section 3: Field Location */}
            <div className="form-group-section">
              <h2 className="group-heading">{tx(l, 'location')}</h2>

              <div className="form-control" style={{ marginBottom: 12 }}>
                <label htmlFor="location-preset">{tx(l, 'locationPreset')}</label>
                <select
                  id="location-preset"
                  onChange={(e) => handlePresetSelect(Number(e.target.value))}
                  defaultValue="0"
                  data-testid="select-location-preset"
                >
                  {LOCATION_PRESETS.map((p, idx) => (
                    <option key={p.label} value={idx}>{p.label}</option>
                  ))}
                  <option value="-1">{tx(l, 'customCoordinates')}</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowCustomCoords(!showCustomCoords)}
                >
                  {showCustomCoords ? 'Hide coordinate values' : 'View / edit coordinates'}
                </button>
                <span className="subtle">
                  ({form.latitude.toFixed(4)}, {form.longitude.toFixed(4)})
                </span>
              </div>

              {showCustomCoords && (
                <div className="form-fields-grid">
                  <div className="form-control">
                    <label htmlFor="latitude">{tx(l, 'latitude')}</label>
                    <input
                      id="latitude"
                      type="number"
                      min="-90"
                      max="90"
                      step="0.0001"
                      value={form.latitude}
                      onChange={(e) => changeSetting('latitude', e.target.value)}
                      data-testid="input-latitude"
                    />
                  </div>
                  <div className="form-control">
                    <label htmlFor="longitude">{tx(l, 'longitude')}</label>
                    <input
                      id="longitude"
                      type="number"
                      min="-180"
                      max="180"
                      step="0.0001"
                      value={form.longitude}
                      onChange={(e) => changeSetting('longitude', e.target.value)}
                      data-testid="input-longitude"
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saveSettings.isPending}
                data-testid="button-save-settings"
              >
                {saveSettings.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                <span>{saveSettings.isPending ? tx(l, 'savingProgress') : tx(l, 'saveSettings')}</span>
              </button>
            </div>
          </form>

          {/* Section 4: Guided Field Setup & Soil Calibration */}
          <div className="calm-card" id="calibration">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'fieldSetupSection')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'calibrateSub')}</p>
              </div>
              <SlidersHorizontal size={20} color="#1b4332" />
            </div>

            <form onSubmit={handleCalibSubmit} data-testid="form-calibration">
              <div className="form-fields-grid">
                <div className="form-control">
                  <label htmlFor="dry-point">{tx(l, 'dry')} (%)</label>
                  <input
                    id="dry-point"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={dry}
                    onChange={(e) => setDry(e.target.value)}
                    required
                    data-testid="input-dry-point"
                  />
                </div>
                <div className="form-control">
                  <label htmlFor="wet-point">{tx(l, 'wet')} (%)</label>
                  <input
                    id="wet-point"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={wet}
                    onChange={(e) => setWet(e.target.value)}
                    required
                    data-testid="input-wet-point"
                  />
                </div>
              </div>

              <div className="capture-controls-row">
                <span className="subtle">
                  {tx(l, 'currentReading')}: {fieldQuery.data?.telemetry.soilMoisture ?? '—'}%
                </span>
                <div className="capture-buttons-group">
                  <button
                    type="button"
                    className="btn btn-outline btn-small"
                    onClick={() => captureCurrent('dry')}
                    disabled={appStale || fieldQuery.data?.telemetry.soilMoisture == null}
                    data-testid="button-capture-dry"
                  >
                    {tx(l, 'dryCapture')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-small"
                    onClick={() => captureCurrent('wet')}
                    disabled={appStale || fieldQuery.data?.telemetry.soilMoisture == null}
                    data-testid="button-capture-wet"
                  >
                    {tx(l, 'wetCapture')}
                  </button>
                </div>
              </div>

              {dry && wet && !isCalibValid && (
                <div role="alert" className="alert-banner error" style={{ marginTop: 14 }}>
                  <AlertTriangle size={16} />
                  <span>{tx(l, 'calibrationWarning')}</span>
                </div>
              )}

              {/* Calibration Range Slider Track */}
              <div className="calibration-track" aria-label={`Dry ${dry}%, Wet ${wet}%`}>
                <span className="calibration-pin" style={{ left: `${Math.max(0, Math.min(100, dryVal))}%` }} />
                <span className="calibration-pin wet-pin" style={{ left: `${Math.max(0, Math.min(100, wetVal))}%` }} />
              </div>
              <div className="calibration-caption">
                <span>{tx(l, 'dry')} · {dry || '—'}%</span>
                <span>{tx(l, 'wet')} · {wet || '—'}%</span>
              </div>

              <div className="calibration-summary-chips">
                <span className="summary-chip">{tx(l, 'lowThreshold')}: {previewLow}%</span>
                <span className="summary-chip">{tx(l, 'targetMoisture')}: {previewTarget}%</span>
              </div>

              <div style={{ marginTop: 20 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!isCalibValid || saveCalib.isPending}
                  data-testid="button-save-calibration"
                >
                  {saveCalib.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>{saveCalib.isPending ? tx(l, 'calibrating') : tx(l, 'saveCalibration')}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Section 5: Developer Tools & Simulation (Collapsible / Advanced) */}
          <div className="calm-card" data-testid="section-dev-tools">
            <button
              type="button"
              className="dev-tools-toggle-btn"
              onClick={() => setDevToolsOpen(!devToolsOpen)}
              data-testid="button-toggle-dev-tools"
            >
              <Sprout size={16} />
              <span>{devToolsOpen ? tx(l, 'hideDevTools') : tx(l, 'showDevTools')}</span>
              <ChevronDown size={16} style={{ transform: devToolsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {devToolsOpen && (
              <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border-soft)' }}>
                <div className="section-header" style={{ marginBottom: 14 }}>
                  <div>
                    <h2 className="section-title-clean">{tx(l, 'devToolsTitle')}</h2>
                    <p className="section-subtitle-clean">{tx(l, 'devToolsSubtitle')}</p>
                  </div>
                </div>

                <div className="toggle-item-row" style={{ paddingBottom: 16 }}>
                  <div>
                    <div className="toggle-title">{tx(l, 'testMode')}</div>
                    <div className="toggle-sub">{tx(l, 'testHelp')}</div>
                  </div>
                  <input
                    aria-label={tx(l, 'testMode')}
                    className="switch"
                    type="checkbox"
                    checked={form.testMode}
                    onChange={(e) => changeSetting('testMode', e.target.checked)}
                    data-testid="toggle-test-mode"
                  />
                </div>

                <div className="form-fields-grid" style={{ marginTop: 12 }}>
                  <div className="form-control">
                    <label htmlFor="scenario-moisture">{tx(l, 'moisture')} (%)</label>
                    <input
                      id="scenario-moisture"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={scenarioMoisture}
                      onChange={(e) => setScenarioMoisture(e.target.value)}
                      data-testid="input-scenario-moisture"
                    />
                  </div>
                  <div className="form-control">
                    <label htmlFor="scenario-rain">{tx(l, 'rainChance')} (%)</label>
                    <input
                      id="scenario-rain"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={scenarioRain}
                      onChange={(e) => setScenarioRain(e.target.value)}
                      data-testid="input-scenario-rain"
                    />
                  </div>
                </div>

                <div className="test-actions-grid" style={{ marginTop: 16 }}>
                  <button
                    className="btn btn-outline btn-small"
                    disabled={scenario.isPending || !form.testMode}
                    onClick={() => applyScenario('dry')}
                    data-testid="button-test-dry"
                  >
                    {tx(l, 'dryScenario')}
                  </button>
                  <button
                    className="btn btn-outline btn-small"
                    disabled={scenario.isPending || !form.testMode}
                    onClick={() => applyScenario('rain')}
                    data-testid="button-test-rain"
                  >
                    {tx(l, 'rainScenario')}
                  </button>
                  <button
                    className="btn btn-outline btn-small"
                    disabled={scenario.isPending || !form.testMode}
                    onClick={() => applyScenario('fault')}
                    data-testid="button-test-fault"
                  >
                    {tx(l, 'faultScenario')}
                  </button>
                  <button
                    className="btn btn-danger btn-small"
                    disabled={reset.isPending}
                    onClick={resetAll}
                    data-testid="button-reset-field"
                  >
                    <RotateCcw size={14} />
                    <span>{tx(l, 'reset')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

// ==========================================
// 5. CALIBRATION PAGE (Compatibility Route)
// ==========================================
export function CalibrationPage() {
  const { lang, notify, stale: appStale } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const client = useQueryClient();
  const query = useGetCalibration({ query: { queryKey: getGetCalibrationQueryKey(), refetchInterval: 60_000 } });
  const field = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const update = useUpdateCalibration();

  const [dry, setDry] = useState('');
  const [wet, setWet] = useState('');

  useEffect(() => {
    if (query.data && dry === '' && wet === '') {
      setDry(String(query.data.dryPoint));
      setWet(String(query.data.wetPoint));
    }
  }, [query.data, dry, wet]);

  const dryVal = Number(dry);
  const wetVal = Number(wet);
  const valid = dry !== '' && wet !== '' && dryVal >= 0 && wetVal <= 100 && dryVal < wetVal;

  const captureCurrent = (point: 'dry' | 'wet') => {
    const moisture = field.data?.telemetry.soilMoisture;
    if (moisture == null) {
      notify(tx(l, 'noReading'));
      return;
    }
    (point === 'dry' ? setDry : setWet)(String(moisture));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    update.mutate(
      { data: { dryPoint: dryVal, wetPoint: wetVal } },
      {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: getGetCalibrationQueryKey() });
          void client.invalidateQueries({ queryKey: getGetFieldStateQueryKey() });
          notify(tx(l, 'calibrationSaved'));
        },
        onError: (error) => notify(errText(error)),
      }
    );
  };

  return (
    <Page>
      <PageHeading eyebrow={tx(l, 'calibration')} title={tx(l, 'calibrateTitle')} subtitle={tx(l, 'calibrateSub')} />
      {query.isLoading && <LoadingCard text={tx(l, 'loading')} />}
      {query.isError && <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />}
      {query.data && (
        <div className="calm-card">
          <form onSubmit={handleSubmit} data-testid="form-calibration-direct">
            <div className="form-fields-grid">
              <div className="form-control">
                <label htmlFor="calib-dry">{tx(l, 'dry')} (%)</label>
                <input
                  id="calib-dry"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={dry}
                  onChange={(e) => setDry(e.target.value)}
                  required
                />
              </div>
              <div className="form-control">
                <label htmlFor="calib-wet">{tx(l, 'wet')} (%)</label>
                <input
                  id="calib-wet"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={wet}
                  onChange={(e) => setWet(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="capture-controls-row">
              <span className="subtle">{tx(l, 'currentReading')}: {field.data?.telemetry.soilMoisture ?? '—'}%</span>
              <div className="capture-buttons-group">
                <button type="button" className="btn btn-outline btn-small" onClick={() => captureCurrent('dry')} disabled={appStale}>
                  {tx(l, 'dryCapture')}
                </button>
                <button type="button" className="btn btn-outline btn-small" onClick={() => captureCurrent('wet')} disabled={appStale}>
                  {tx(l, 'wetCapture')}
                </button>
              </div>
            </div>

            {dry && wet && !valid && (
              <div role="alert" className="alert-banner error" style={{ marginTop: 14 }}>
                <AlertTriangle size={16} />
                <span>{tx(l, 'calibrationWarning')}</span>
              </div>
            )}

            <div className="calibration-track">
              <span className="calibration-pin" style={{ left: `${Math.max(0, Math.min(100, dryVal))}%` }} />
              <span className="calibration-pin wet-pin" style={{ left: `${Math.max(0, Math.min(100, wetVal))}%` }} />
            </div>
            <div className="calibration-caption">
              <span>{tx(l, 'dry')} · {dry || '—'}%</span>
              <span>{tx(l, 'wet')} · {wet || '—'}%</span>
            </div>

            <div className="calibration-summary-chips" style={{ marginTop: 16 }}>
              <span className="summary-chip">{tx(l, 'lowThreshold')}: {query.data.lowThreshold}%</span>
              <span className="summary-chip">{tx(l, 'targetMoisture')}: {query.data.targetMoisture}%</span>
            </div>

            <div style={{ marginTop: 24 }}>
              <button type="submit" className="btn btn-primary" disabled={!valid || update.isPending}>
                {update.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                <span>{update.isPending ? tx(l, 'calibrating') : tx(l, 'saveCalibration')}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}
