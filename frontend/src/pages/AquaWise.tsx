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
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, CloudRain,
  Droplet, Droplets, History, Info, Leaf, LoaderCircle, RefreshCw,
  RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Sprout, Sun,
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

// ==========================================
// 1. HOME SCREEN (Radically Simplified)
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
    if (!recommendation) return;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang.toLowerCase().startsWith(l));
    if (l !== 'en' && !voice) {
      notify(tx(l, 'voiceMissing'));
      return;
    }
    const localizedStatus = recommendation.status === 'WATER NOW'
      ? (l === 'te' ? 'ఇప్పుడు నీరు పెట్టండి' : l === 'hi' ? 'अभी सिंचाई करें' : 'Water now')
      : recommendation.status === 'WAIT'
        ? (l === 'te' ? 'వేచి ఉండండి' : l === 'hi' ? 'प्रतीक्षा करें' : 'Wait')
        : (l === 'te' ? 'పొలాన్ని తనిఖీ చేయండి' : l === 'hi' ? 'खेत की जांच करें' : 'Check the field');
    const utterance = new SpeechSynthesisUtterance(
      `${localizedStatus}. ${recommendation.reason}. ${tx(l, 'duration')}: ${recommendation.durationMinutes} ${tx(l, 'minutes')}.`
    );
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

  const isWatering = state?.irrigation.active;
  const status = recommendation?.status;

  // Visual status tone
  const statusTone = isWatering
    ? 'watering'
    : status === 'WATER NOW'
      ? 'water-now'
      : status === 'CHECK FIELD'
        ? 'check-field'
        : 'wait';

  // Dominant recommendation display
  let dominantTitle = tx(l, 'allSet');
  if (isWatering) {
    dominantTitle = tx(l, 'activeSession');
  } else if (status === 'WATER NOW') {
    dominantTitle = tx(l, 'waterNowTitle');
  } else if (status === 'CHECK FIELD') {
    dominantTitle = tx(l, 'checkFieldTitle');
  }

  const explanation = isWatering
    ? (l === 'te' ? 'నీరు పెట్టే చక్రం చురుకుగా సాగుతోంది.' : l === 'hi' ? 'सिंचाई चक्र सक्रिय रूप से चल रहा है।' : `Watering cycle in progress. Remaining runtime: ${recommendation?.durationMinutes ?? 15} min.`)
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

      {/* Hero Recommendation Section */}
      <section className={`calm-hero tone-${statusTone}`} data-testid="card-recommendation">
        <div className="hero-status-pill">
          <span className="status-indicator-dot" />
          <span className="status-indicator-label">
            {isWatering ? tx(l, 'session') : (status || 'READY')}
          </span>
        </div>

        <h1 className="hero-dominant-title">{dominantTitle}</h1>

        <p className="hero-explanation">{explanation}</p>

        {/* Primary Action Button */}
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
              <span>{tx(l, 'water')}</span>
              {recommendation?.durationMinutes && (
                <span className="btn-badge">{recommendation.durationMinutes} {tx(l, 'minutes')}</span>
              )}
            </button>
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

      {/* Discreet Feedback & Status Meta Bar */}
      <div className="home-footer-meta">
        <span className="subtle">
          {tx(l, 'updated')} {fmtTime(recommendation?.updatedAt)} · {tx(l, 'simulatedNotice')}
        </span>
        <div className="home-feedback-inline">
          <span className="feedback-prompt">{tx(l, 'feedback')}</span>
          <button
            className="feedback-pill-btn"
            disabled={feedback.isPending || !recommendation}
            onClick={() => sendFeedback(true)}
            data-testid="button-feedback-yes"
            title={tx(l, 'helpful')}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            className="feedback-pill-btn"
            disabled={feedback.isPending || !recommendation}
            onClick={() => sendFeedback(false)}
            data-testid="button-feedback-no"
            title={tx(l, 'notHelpful')}
          >
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>
    </Page>
  );
}

// ==========================================
// 2. INSIGHTS SCREEN (Why & Forecast)
// ==========================================
function Chart({ data }: { data: Analytics }) {
  const history = data.history || [];
  const forecast = data.forecast || [];
  const points = [
    ...history.map((x, i) => ({
      x: 42 + i * (250 / Math.max(history.length - 1, 1)),
      y: 180 - x.moisturePercent * 1.38,
    })),
    ...forecast.map((x, i) => ({
      x: (history.length ? 292 : 42) + (i + 1) * (215 / Math.max(forecast.length, 1)),
      y: 180 - x.moisturePercent * 1.38,
    })),
  ];
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${Math.max(25, Math.min(180, p.y))}`).join(' ');
  const cutoff = history.length ? 42 + (history.length - 1) * (250 / Math.max(history.length - 1, 1)) : 42;

  return (
    <svg className="chart-svg" viewBox="0 0 540 220" role="img" aria-label={`${history.length} observed readings and ${forecast.length} forecast points`}>
      {[40, 80, 120, 160].map((y) => (
        <g key={y}>
          <line x1="42" x2="520" y1={y} y2={y} stroke="#edf2eb" strokeDasharray="3 4" />
          <text x="7" y={y + 4} className="chart-axis">{Math.round((180 - y) / 1.38)}%</text>
        </g>
      ))}
      <line x1={cutoff} x2={cutoff} y1="30" y2="182" stroke="#d5ded3" strokeDasharray="4 4" />
      {points.length > 1 && (
        <path d={d} fill="none" stroke="#1b4332" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {history.map((p, i) => {
        const x = 42 + i * (250 / Math.max(history.length - 1, 1));
        const y = Math.max(25, Math.min(180, 180 - p.moisturePercent * 1.38));
        return <circle key={`h-${i}`} cx={x} cy={y} r="3.5" fill="#1b4332" />;
      })}
      {forecast.map((p, i) => {
        const x = (history.length ? 292 : 42) + (i + 1) * (215 / Math.max(forecast.length, 1));
        const y = Math.max(25, Math.min(180, 180 - p.moisturePercent * 1.38));
        return <circle key={`f-${i}`} cx={x} cy={y} r="3.5" fill="#c48a36" />;
      })}
      <text x="42" y="206" className="chart-axis">{history.length ? 'Past readings' : 'Current'}</text>
      <text x="450" y="206" className="chart-axis">+{forecast.at(-1)?.hours ?? 0}h forecast</text>
    </svg>
  );
}

export function AnalyticsPage() {
  const { lang } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const query = useGetAnalytics({ query: { queryKey: getGetAnalyticsQueryKey(), refetchInterval: 60_000 } });
  const rec = useGetRecommendation({ query: { queryKey: getGetRecommendationQueryKey(), refetchInterval: 60_000 } });
  const data = query.data;
  const recommendation = rec.data;

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
          {/* Main Chart Section */}
          <section className="calm-card" data-testid="chart-moisture">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'moisture')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'forecastLabel')}: {data.forecastLabel}</p>
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

          {/* Contributing Decision Factors */}
          <section className="calm-card" data-testid="card-decision-factors">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'reasons')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'confidence')}: {recommendation?.confidence ?? 'High'} · {tx(l, 'source')}: {recommendation?.provenance ?? 'Simulated'}</p>
              </div>
              <ShieldCheck size={20} color="#1b4332" />
            </div>

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
              <div className="empty-state" style={{ padding: '24px 8px' }}>
                <Info size={22} />
                <p>{tx(l, 'noFactors')}</p>
              </div>
            )}
          </section>

          {/* Strategy Comparison */}
          <section className="calm-card">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'strategies')}</h2>
                <p className="section-subtitle-clean">Water usage and stress predictions over 48 hours</p>
              </div>
              <Droplets size={20} color="#1b4332" />
            </div>

            {data.strategies?.length ? (
              <div className="clean-list">
                {data.strategies.map((strategy, i) => (
                  <article className="strategy-clean-row" key={`${strategy.name}-${i}`}>
                    <div>
                      <div className="strategy-name">{localizedStrategy(strategy.name, l)}</div>
                      <div className="strategy-detail">
                        {tx(l, 'stress')}: {strategy.dryStressHours}h · {tx(l, 'overwatering')}: {strategy.overwateringHours}h · {tx(l, 'saving')}: {strategy.waterSavedPercent}%
                      </div>
                    </div>
                    <div className="strategy-number">
                      {strategy.waterLitres} <span className="unit">{tx(l, 'litres')}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>{tx(l, 'noForecast')}</p>
              </div>
            )}
          </section>

          {/* Hourly Forecast Outlook */}
          <section className="calm-card">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'forecastLabel')}</h2>
                <p className="section-subtitle-clean">Estimated soil moisture progression</p>
              </div>
              <CloudRain size={20} color="#947333" />
            </div>

            {data.forecast?.length ? (
              <div className="clean-list">
                {data.forecast.map((point, i) => (
                  <article className="forecast-timeline-row" key={`${point.hours}-${i}`}>
                    <div className="timeline-hour">+{point.hours}h</div>
                    <div className="timeline-meta">{point.provenance} · {tx(l, 'simulatedNotice')}</div>
                    <div className="timeline-value">{point.moisturePercent}%</div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>{tx(l, 'noForecast')}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

// ==========================================
// 3. HISTORY SCREEN (Clean Activity List)
// ==========================================
const categories: { value: GetHistoryCategory; key: keyof typeof copy.en }[] = [
  { value: 'all', key: 'all' },
  { value: 'reading', key: 'reading' },
  { value: 'recommendation', key: 'recommendation' },
  { value: 'irrigation', key: 'irrigation' },
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
  const params = category === 'all' ? undefined : { category };
  const query = useGetHistory(params, { query: { queryKey: getGetHistoryQueryKey(params), refetchInterval: 60_000 } });

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
            onClick={() => setCategory(item.value)}
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
          {query.data.length ? (
            <div className="clean-list">
              {query.data.map((item: HistoryEvent) => (
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
// 4. SETTINGS & FIELD SETUP
// ==========================================
export function SettingsPage() {
  const { lang, notify, stale: appStale } = useAquaWise();
  const l = lang as 'en' | 'te' | 'hi';
  const client = useQueryClient();

  // Settings query & mutation
  const settingsQuery = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 60_000 } });
  const saveSettings = useUpdateSettings();

  // Calibration query & mutation
  const calibQuery = useGetCalibration({ query: { queryKey: getGetCalibrationQueryKey(), refetchInterval: 60_000 } });
  const fieldQuery = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const saveCalib = useUpdateCalibration();

  // Test scenario mutations
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

  // Local test scenario state
  const [scenarioMoisture, setScenarioMoisture] = useState('24');
  const [scenarioRain, setScenarioRain] = useState('48');

  const dryVal = Number(dry);
  const wetVal = Number(wet);
  const isCalibValid = dry !== '' && wet !== '' && dryVal >= 0 && wetVal <= 100 && dryVal < wetVal;

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
                </div>
              </div>
            </div>

            <div className="section-separator" />

            {/* Section 2: Irrigation & Quiet Hours */}
            <div className="form-group-section">
              <h2 className="group-heading">{tx(l, 'irrigationSection')}</h2>

              <div className="toggle-item-row">
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

              <div className="form-fields-grid" style={{ marginTop: 16 }}>
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

              <div className="form-fields-grid" style={{ marginTop: 16 }}>
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
            </div>

            <div className="section-separator" />

            {/* Section 3: Field Location */}
            <div className="form-group-section">
              <h2 className="group-heading">{tx(l, 'location')}</h2>
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

              {/* Calibration Slider Track */}
              <div className="calibration-track" aria-label={`Dry ${dry}%, Wet ${wet}%`}>
                <span className="calibration-pin" style={{ left: `${Math.max(0, Math.min(100, dryVal))}%` }} />
                <span className="calibration-pin wet-pin" style={{ left: `${Math.max(0, Math.min(100, wetVal))}%` }} />
              </div>
              <div className="calibration-caption">
                <span>{tx(l, 'dry')} · {dry || '—'}%</span>
                <span>{tx(l, 'wet')} · {wet || '—'}%</span>
              </div>

              {calibQuery.data && (
                <div className="calibration-summary-chips">
                  <span className="summary-chip">{tx(l, 'lowThreshold')}: {calibQuery.data.lowThreshold}%</span>
                  <span className="summary-chip">{tx(l, 'targetMoisture')}: {calibQuery.data.targetMoisture}%</span>
                </div>
              )}

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

          {/* Section 5: Simulation & Testing */}
          <div className="calm-card">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'testingSection')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'testSub')}</p>
              </div>
              <Sprout size={20} color="#1b4332" />
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
  }, [query.data?.dryPoint, query.data?.wetPoint, dry, wet]);

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const payload: CalibrationInput = { dryPoint: dryVal, wetPoint: wetVal };
    update.mutate(
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

  return (
    <Page>
      <PageHeading
        eyebrow={tx(l, 'calibrateTitle')}
        title={tx(l, 'calibrateTitle')}
        subtitle={tx(l, 'calibrateSub')}
      />

      {query.isLoading && <LoadingCard text={tx(l, 'loading')} />}
      {query.isError && (
        <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />
      )}

      {query.data && (
        <div className="calm-card" style={{ maxWidth: 640 }}>
          <form onSubmit={submit} data-testid="form-calibration">
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
                {tx(l, 'currentReading')}: {field.data?.telemetry.soilMoisture ?? '—'}%
              </span>
              <div className="capture-buttons-group">
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => captureCurrent('dry')}
                  disabled={appStale || field.data?.telemetry.soilMoisture == null}
                  data-testid="button-capture-dry"
                >
                  {tx(l, 'dryCapture')}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => captureCurrent('wet')}
                  disabled={appStale || field.data?.telemetry.soilMoisture == null}
                  data-testid="button-capture-wet"
                >
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

            <div className="calibration-track" aria-label={`Dry ${dry}%, Wet ${wet}%`}>
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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!valid || update.isPending}
                data-testid="button-save-calibration"
              >
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
