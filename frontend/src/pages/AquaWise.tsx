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
import { AlertTriangle, ChartNoAxesCombined, Check, CloudRain, Droplet, Droplets, History, Info, Leaf, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Sprout, Sun, ThumbsDown, ThumbsUp, Volume2, WifiOff } from 'lucide-react';

const copy = { en, te, hi } as const;
const tx = (lang: 'en' | 'te' | 'hi', key: keyof typeof copy.en) => copy[lang][key] as string;
const qk = [getGetFieldStateQueryKey(), getGetWeatherQueryKey(), getGetRecommendationQueryKey(), getGetAnalyticsQueryKey(), getGetHistoryQueryKey(), getGetNotificationsQueryKey()];
const fmtTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const errText = (error: unknown) => error instanceof Error ? error.message : 'Request could not be completed.';
function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div></div>;
}
function LoadingCard({ text }: { text: string }) {
  return <div className="card" style={{ padding: 22 }} aria-label={text}><div className="skeleton" style={{ height: 20, width: '42%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 76, marginBottom: 10 }} /><div className="skeleton" style={{ height: 13, width: '68%' }} /><p className="subtle" style={{ marginBottom: 0 }}>{text}</p></div>;
}
function ErrorBanner({ text, retry }: { text: string; retry: () => void }) {
  const { lang } = useAquaWise();
  return <div className="alert-banner error" role="alert"><AlertTriangle size={18} /><span style={{ flex: 1 }}>{text}</span><button className="btn btn-danger btn-small" onClick={retry}><RefreshCw size={14} />{tr(lang, 'retry')}</button></div>;
}
function Page({ children }: { children: ReactNode }) { return <main className="page">{children}</main>; }
function effectText(effect: string, lang: 'en' | 'te' | 'hi') {
  if (effect === 'supports') return lang === 'te' ? 'మద్దతు' : lang === 'hi' ? 'समर्थन' : 'Supports';
  if (effect === 'delays') return lang === 'te' ? 'ఆలస్యం' : lang === 'hi' ? 'देरी' : 'Delays';
  return lang === 'te' ? 'జాగ్రత్త' : lang === 'hi' ? 'सावधानी' : 'Caution';
}
const effectColor = (effect: string) => effect === 'supports' ? '#4d8254' : effect === 'delays' ? '#aa8040' : '#a7664f';
function weatherSourceLabel(source: string | undefined, lang: 'en' | 'te' | 'hi') {
  if (source === 'Open-Meteo') return tx(lang, 'liveForecast');
  if (source === 'Test mode') return tx(lang, 'testForecast');
  if (source?.includes('cached')) return tx(lang, 'cachedForecast');
  return tx(lang, 'fallbackForecast');
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
  const scenario = useApplyTestScenario();
  const reset = useResetField();
  const feedback = useSubmitFeedback();
  const [scenarioMoisture, setScenarioMoisture] = useState('24');
  const [scenarioRain, setScenarioRain] = useState('48');
  const invalidate = () => { qk.forEach((queryKey) => void client.invalidateQueries({ queryKey })); };
  const state = field.data;
  const recommendation = rec.data || state?.recommendation;
  const conditionStale = appStale || !!weather.data?.stale || recommendation?.provenance === 'stale' || state?.telemetry.provenance === 'stale';
  const refresh = () => { void field.refetch(); void weather.refetch(); void rec.refetch(); };
  const runWater = () => {
    if (!recommendation) return;
    const cap = settings.data?.maxDurationMinutes ?? 60;
    const duration = Math.max(1, Math.min(cap, recommendation.durationMinutes ?? 15));
    start.mutate({ data: { durationMinutes: duration } }, { onSuccess: () => { invalidate(); notify(l === 'te' ? 'నీటి చర్య ప్రారంభమైంది.' : l === 'hi' ? 'सिंचाई कार्रवाई शुरू हुई।' : 'Watering session started.'); }, onError: (error) => notify(errText(error)) });
  };
  const doStop = () => stop.mutate(undefined, { onSuccess: () => { invalidate(); notify(l === 'te' ? 'నీటి చర్య ఆపబడింది.' : l === 'hi' ? 'सिंचाई रोक दी गई।' : 'Watering session stopped.'); }, onError: (error) => notify(errText(error)) });
  const apply = (mode: 'dry' | 'rain' | 'fault') => {
    const input: TestScenarioInput = { soilMoisture: mode === 'fault' ? null : Number(scenarioMoisture), rainingNow: mode === 'rain', rainProbability6h: Number(scenarioRain), precipitationMm6h: mode === 'rain' ? 6.4 : 0, sensorFault: mode === 'fault' };
    scenario.mutate({ data: input }, { onSuccess: () => { invalidate(); notify(l === 'te' ? 'పరీక్ష పరిస్థితి వర్తింపజేయబడింది.' : l === 'hi' ? 'परीक्षण स्थिति लागू की गई।' : 'Test scenario applied.'); }, onError: (error) => notify(errText(error)) });
  };
  const resetAll = () => {
    if (!window.confirm(tx(l, 'resetConfirm'))) return;
    reset.mutate(undefined, { onSuccess: () => { invalidate(); notify(l === 'te' ? 'పొలం రీసెట్ అయింది.' : l === 'hi' ? 'खेत रीसेट हुआ।' : 'Field simulation reset.'); }, onError: (error) => notify(errText(error)) });
  };
  const sendFeedback = (helpful: boolean) => feedback.mutate({ data: { helpful, comment: '' } }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetHistoryQueryKey() }); notify(tx(l, 'thankFeedback')); }, onError: (error) => notify(errText(error)) });
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
      `${localizedStatus}. ${recommendation.reason}. ${tx(l, 'duration')}: ${recommendation.durationMinutes} ${tx(l, 'minutes')}.`,
    );
    utterance.lang = l === 'te' ? 'te-IN' : l === 'hi' ? 'hi-IN' : 'en-IN';
    if (voice) utterance.voice = voice;
    utterance.onerror = () => notify(tx(l, 'voiceError'));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  if (field.isLoading && !state) return <Page><PageHeading eyebrow={tx(l, 'overview')} title={tx(l, 'dashboardTitle')} subtitle={tx(l, 'sub')} /><LoadingCard text={tx(l, 'loading')} /></Page>;
  return <Page>
    <PageHeading eyebrow={tx(l, 'overview')} title={tx(l, 'dashboardTitle')} subtitle={tx(l, 'sub')} />
    {(field.isError || rec.isError) && <ErrorBanner text={`${tx(l, 'error')} ${field.error ? errText(field.error) : ''}`} retry={refresh} />}
    {state?.connectionStatus === 'offline' && <div className="alert-banner error" role="status"><WifiOff size={17} /><span>{tx(l, 'stale')}</span></div>}
    {conditionStale && state?.connectionStatus !== 'offline' && <div className="alert-banner" role="status"><Info size={17} /><span>{tx(l, 'stale')}</span></div>}
    <section className="hero-decision" aria-label={tx(l, 'nextStep')} data-testid="card-recommendation">
      <div><div className="decision-label">{tx(l, 'nextStep')} <span style={{ opacity: .7 }}>· {tx(l, 'simulatedNotice')}</span></div><h2 className="decision-title">{recommendation?.status || '—'}</h2><p className="decision-reason">{recommendation?.reason || tx(l, 'reasonFallback')}</p><div className="decision-meta"><span className="meta-pill">{tx(l, 'confidence')}: {recommendation?.confidence || '—'}</span><span className="meta-pill">{tx(l, 'source')}: {recommendation?.provenance || tx(l, 'simulatedLabel')}</span><span className="meta-pill">{tx(l, 'updated')}: {fmtTime(recommendation?.updatedAt)}</span></div></div>
      <div className="decision-action">
        {state?.irrigation.active ? <button className="btn btn-light" onClick={doStop} disabled={stop.isPending || appStale} data-testid="button-stop-irrigation">{stop.isPending ? <LoaderCircle size={17} /> : <Droplet size={17} />}{tx(l, 'stop')}</button> : <button className="btn btn-primary" onClick={runWater} disabled={!recommendation || start.isPending || appStale || state?.connectionStatus === 'offline'} data-testid="button-start-irrigation">{start.isPending ? <LoaderCircle size={17} /> : <Droplets size={17} />}{tx(l, 'water')}</button>}
        {recommendation && <button className="btn btn-light btn-small" onClick={readAloud} data-testid="button-read-aloud"><Volume2 size={15} />{tx(l, 'readAloud')}</button>}
        <div style={{ color: '#d5e4d6', fontSize: 11, lineHeight: 1.5 }}>{state?.irrigation.active ? tx(l, 'session') : `${tx(l, 'duration')}: ${recommendation?.durationMinutes ?? '—'} ${tx(l, 'minutes')}`}<br />{tx(l, 'operationLimit')}</div>
      </div>
    </section>
    <div className="dashboard-grid">
      <section className="card metric-card" aria-label={tx(l, 'moisture')} data-testid="card-soil-moisture">
        <h2 className="section-title">{tx(l, 'moisture')}<span className="sim-chip">{tx(l, 'sensor')}</span></h2>
        <div className="moisture-row"><div><div className="metric-big">{state?.telemetry.soilMoisture == null ? '—' : <>{state.telemetry.soilMoisture}<span className="metric-unit">%</span></>}</div><div className="metric-note">{state?.telemetry.soilMoisture == null ? tx(l, 'noMoisture') : `${tx(l, 'updated')} · ${fmtTime(state.telemetry.updatedAt)}`}</div></div><div style={{ textAlign: 'right' }}><div className="stat-name">{tx(l, 'target')}</div><div style={{ font: '700 19px Manrope', color: '#446c48' }}>{state?.targetMoisture ?? '—'}%</div></div></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, state?.telemetry.soilMoisture ?? 0))}%` }} /><div className="threshold-marker" style={{ left: `${Math.max(0, Math.min(100, state?.lowThreshold ?? 0))}%` }} title={`${tx(l, 'threshold')} ${state?.lowThreshold ?? '—'}%`} /></div>
        <div className="scale-labels"><span>0%</span><span>{tx(l, 'threshold')} · {state?.lowThreshold ?? '—'}%</span><span>100%</span></div>
        <div className="stat-grid" style={{ marginTop: 19 }}>
          <div className="stat-tile"><div className="stat-name">{tx(l, 'temperature')}</div><div className="stat-value">{state?.telemetry.temperatureC ?? '—'}°</div><div className="stat-sub">{tx(l, 'simulatedNotice')}</div></div>
          <div className="stat-tile"><div className="stat-name">{tx(l, 'humidity')}</div><div className="stat-value">{state?.telemetry.humidityPercent ?? '—'}%</div><div className="stat-sub">{tx(l, 'simulatedNotice')}</div></div>
          <div className="stat-tile"><div className="stat-name">{l === 'te' ? 'సూర్యకాంతి' : l === 'hi' ? 'धूप' : 'Sunlight'}</div><div className="stat-value">{state?.telemetry.sunlightPercent ?? '—'}%</div><div className="stat-sub">{tx(l, 'simulatedNotice')}</div></div>
          <div className="stat-tile"><div className="stat-name">{l === 'te' ? 'సెన్సర్ స్థితి' : l === 'hi' ? 'सेंसर स्थिति' : 'Sensor status'}</div><div className="stat-value" style={{ fontSize: 17 }}>{state?.telemetry.sensorFault ? (l === 'te' ? 'లోపం' : l === 'hi' ? 'त्रुटि' : 'Fault') : (l === 'te' ? 'సరే' : l === 'hi' ? 'ठीक' : 'OK')}</div><div className="stat-sub">{tx(l, 'simulatedNotice')}</div></div>
        </div>
      </section>
      <section className="card metric-card" aria-label={tx(l, 'weather')} data-testid="card-weather">
        <h2 className="section-title">{tx(l, 'weather')} <CloudRain size={18} color="#9a8246" /></h2>
        {weather.isLoading && !weather.data ? <div className="skeleton" style={{ height: 122 }} /> : weather.isError ? <div className="empty-state" style={{ padding: '19px 5px' }}><CloudRain size={25} /><p>{tx(l, 'noWeather')}</p><button className="text-button" onClick={() => void weather.refetch()}>{tx(l, 'retry')}</button></div> : <><div className="weather-summary"><div className="weather-icon"><Sun size={20} /></div><div><div className="weather-desc">{localizedWeatherSummary(weather.data?.summary, l)}</div><div className="weather-source">{weatherSourceLabel(weather.data?.source, l)}</div></div></div><div className="weather-details"><div className="weather-detail"><strong>{weather.data?.temperatureC}°C</strong><span>{tx(l, 'temperature')}</span></div><div className="weather-detail"><strong>{weather.data?.rainProbability6h}%</strong><span>{tx(l, 'rainChance')}</span></div><div className="weather-detail"><strong>{weather.data?.precipitationMm6h} mm</strong><span>{tx(l, 'rain')}</span></div></div><div className="weather-source" style={{ marginTop: 13 }}>{weather.data?.rainingNow ? (l === 'te' ? 'ఇప్పుడు వర్షం పడుతోంది' : l === 'hi' ? 'अभी बारिश हो रही है' : 'Rain is falling now') : (l === 'te' ? 'ప్రస్తుతం వర్షం లేదు' : l === 'hi' ? 'अभी बारिश नहीं' : 'No rain at the moment')} · {tx(l, 'updated')} {fmtTime(weather.data?.updatedAt)}</div></>}
      </section>
    </div>
    <div className="dashboard-grid">
      <section className="card list-card" data-testid="card-decision-factors"><h2 className="section-title">{tx(l, 'reasons')}<ShieldCheck size={18} color="#608465" /></h2>{recommendation?.factors?.length ? recommendation.factors.slice().sort((a, b) => a.rank - b.rank).map((factor, index) => <div className="strategy-row" key={`${factor.name}-${index}`}><div><div className="strategy-name">{factor.name}</div><div className="strategy-detail">{factor.detail}</div></div><span style={{ color: effectColor(factor.effect), fontSize: 11, fontWeight: 700 }}>{effectText(factor.effect, l)}</span></div>) : <div className="empty-state" style={{ padding: '18px 4px' }}><Info size={22} /><p>{tx(l, 'noFactors')}</p></div>}</section>
      <section className="card list-card"><h2 className="section-title">{tx(l, 'useTest')}<Sprout size={18} color="#608465" /></h2><p className="form-help">{tx(l, 'testSub')} {tx(l, 'simulatedNotice')}.</p><div className="field-grid"><div className="field-control"><label htmlFor="scenario-moisture">{tx(l, 'moisture')} %</label><input id="scenario-moisture" type="number" min="0" max="100" step="any" value={scenarioMoisture} onChange={(e) => setScenarioMoisture(e.target.value)} data-testid="input-scenario-moisture" /></div><div className="field-control"><label htmlFor="scenario-rain">{tx(l, 'rainChance')} %</label><input id="scenario-rain" type="number" min="0" max="100" step="any" value={scenarioRain} onChange={(e) => setScenarioRain(e.target.value)} data-testid="input-scenario-rain" /></div></div><div style={{ display: 'grid', gap: 8, marginTop: 13 }}><button className="btn btn-outline btn-small" disabled={scenario.isPending || !settings.data?.testMode} onClick={() => apply('dry')} data-testid="button-test-dry">{tx(l, 'dryScenario')}</button><button className="btn btn-outline btn-small" disabled={scenario.isPending || !settings.data?.testMode} onClick={() => apply('rain')} data-testid="button-test-rain">{tx(l, 'rainScenario')}</button><button className="btn btn-outline btn-small" disabled={scenario.isPending || !settings.data?.testMode} onClick={() => apply('fault')} data-testid="button-test-fault">{tx(l, 'faultScenario')}</button><button className="btn btn-danger btn-small" disabled={reset.isPending} onClick={resetAll} data-testid="button-reset-field"><RotateCcw size={14} />{tx(l, 'reset')}</button></div>{!settings.data?.testMode && <p className="subtle" style={{ marginBottom: 0 }}>{tx(l, 'testHelp')}</p>}</section>
    </div>
    <section className="card feedback-row"><div><strong style={{ color: '#34543c', fontSize: 13 }}>{tx(l, 'feedback')}</strong><div className="subtle" style={{ marginTop: 4 }}>{tx(l, 'simulatedNotice')} · {tx(l, 'source')}: recommendation</div></div><div className="feedback-buttons"><button className="btn btn-outline btn-small" disabled={feedback.isPending || !recommendation} onClick={() => sendFeedback(true)} data-testid="button-feedback-yes"><ThumbsUp size={14} />{tx(l, 'helpful')}</button><button className="btn btn-outline btn-small" disabled={feedback.isPending || !recommendation} onClick={() => sendFeedback(false)} data-testid="button-feedback-no"><ThumbsDown size={14} />{tx(l, 'notHelpful')}</button></div></section>
  </Page>;
}

function Chart({ data }: { data: Analytics }) {
  const history = data.history || [];
  const forecast = data.forecast || [];
  const points = [...history.map((x, i) => ({ x: 42 + i * (250 / Math.max(history.length - 1, 1)), y: 180 - x.moisturePercent * 1.38 })), ...forecast.map((x, i) => ({ x: (history.length ? 292 : 42) + (i + 1) * (215 / Math.max(forecast.length, 1)), y: 180 - x.moisturePercent * 1.38 }))];
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${Math.max(25, Math.min(180, p.y))}`).join(' ');
  const cutoff = history.length ? 42 + (history.length - 1) * (250 / Math.max(history.length - 1, 1)) : 42;
  return <svg className="chart-svg" viewBox="0 0 540 220" role="img" aria-label={`${history.length} observed readings and ${forecast.length} forecast points`}>
    {[40, 80, 120, 160].map((y) => <g key={y}><line x1="42" x2="520" y1={y} y2={y} stroke="#e9eee6" strokeDasharray="3 5" /><text x="7" y={y + 4} className="chart-axis">{Math.round((180 - y) / 1.38)}%</text></g>)}
    <line x1={cutoff} x2={cutoff} y1="30" y2="182" stroke="#cfd9cc" strokeDasharray="4 5" />
    {points.length > 1 && <path d={d} fill="none" stroke="#59845d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {history.map((p, i) => { const x = 42 + i * (250 / Math.max(history.length - 1, 1)); const y = Math.max(25, Math.min(180, 180 - p.moisturePercent * 1.38)); return <circle key={`h-${i}`} cx={x} cy={y} r="4" fill="#59845d" />; })}
    {forecast.map((p, i) => { const x = (history.length ? 292 : 42) + (i + 1) * (215 / Math.max(forecast.length, 1)); const y = Math.max(25, Math.min(180, 180 - p.moisturePercent * 1.38)); return <circle key={`f-${i}`} cx={x} cy={y} r="4" fill="#d0a24f" />; })}
    <text x="42" y="207" className="chart-axis">{history.length ? 'Past' : 'Now'}</text><text x="464" y="207" className="chart-axis">+{forecast.at(-1)?.hours ?? 0}h</text>
  </svg>;
}
export function AnalyticsPage() {
  const { lang } = useAquaWise(); const l = lang as 'en' | 'te' | 'hi';
  const query = useGetAnalytics({ query: { queryKey: getGetAnalyticsQueryKey(), refetchInterval: 60_000 } });
  const data = query.data;
  return <Page><PageHeading eyebrow={tx(l, 'forecast')} title={tx(l, 'analyticsTitle')} subtitle={tx(l, 'analyticsSub')} />
    {query.isLoading && <LoadingCard text={tx(l, 'loading')} />}
    {query.isError && <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />}
    {data && <div className="content-grid">
      <div style={{ display: 'grid', gap: 18 }}>
        <section className="card chart-card" data-testid="chart-moisture"><h2 className="section-title">{tx(l, 'moisture')} <span className="sim-chip">{tx(l, 'forecastLabel')}: {data.forecastLabel}</span></h2>
          {(!data.history?.length && !data.forecast?.length) ? <div className="empty-state"><ChartNoAxesCombined size={28} /><h3>{tx(l, 'noHistory')}</h3><p>{tx(l, 'noForecast')}</p></div> : <><Chart data={data} /><div className="legend"><span><i />{tx(l, 'observed')}</span><span><i className="forecast" />{tx(l, 'predicted')} · {tx(l, 'simulatedNotice')}</span></div></>}
        </section>
        <section className="card list-card"><h2 className="section-title">{tx(l, 'strategies')}<Droplets size={18} color="#608465" /></h2>{data.strategies?.length ? data.strategies.map((strategy, i) => <article className="strategy-row" key={`${strategy.name}-${i}`}><div><div className="strategy-name">{localizedStrategy(strategy.name, l)}</div><div className="strategy-detail">{tx(l, 'stress')}: {strategy.dryStressHours}h · {tx(l, 'overwatering')}: {strategy.overwateringHours}h · {tx(l, 'saving')}: {strategy.waterSavedPercent}%</div></div><div className="strategy-number">{strategy.waterLitres} <span style={{ fontSize: 11, fontWeight: 600 }}>{tx(l, 'litres')}</span></div></article>) : <div className="empty-state"><p>{tx(l, 'noForecast')}</p></div>}</section>
      </div>
      <aside className="card list-card"><h2 className="section-title">{tx(l, 'forecastLabel')}<CloudRain size={18} color="#987b42" /></h2>{data.forecast?.length ? data.forecast.map((point, i) => <article className="strategy-row" key={`${point.hours}-${i}`}><div><div className="strategy-name">+{point.hours}h</div><div className="strategy-detail">{point.provenance} · {tx(l, 'simulatedNotice')}</div></div><div className="strategy-number">{point.moisturePercent}%</div></article>) : <div className="empty-state"><p>{tx(l, 'noForecast')}</p></div>}<div className="alert-banner info" style={{ marginTop: 15, marginBottom: 0 }}><Info size={16} /><span>{tx(l, 'stale')}</span></div></aside>
    </div>}</Page>;
}

export function CalibrationPage() {
  const { lang, notify, stale: appStale } = useAquaWise(); const l = lang as 'en' | 'te' | 'hi'; const client = useQueryClient();
  const query = useGetCalibration({ query: { queryKey: getGetCalibrationQueryKey(), refetchInterval: 60_000 } });
  const field = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const update = useUpdateCalibration();
  const [dry, setDry] = useState(''); const [wet, setWet] = useState('');
  useEffect(() => { if (query.data && dry === '' && wet === '') { setDry(String(query.data.dryPoint)); setWet(String(query.data.wetPoint)); } }, [query.data?.dryPoint, query.data?.wetPoint, dry, wet]);
  const dryVal = Number(dry); const wetVal = Number(wet); const valid = dry !== '' && wet !== '' && dryVal >= 0 && wetVal <= 100 && dryVal < wetVal;
  const captureCurrent = (point: 'dry' | 'wet') => {
    const moisture = field.data?.telemetry.soilMoisture;
    if (moisture == null) { notify(tx(l, 'noReading')); return; }
    (point === 'dry' ? setDry : setWet)(String(moisture));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!valid) return;
    const payload: CalibrationInput = { dryPoint: dryVal, wetPoint: wetVal };
    update.mutate({ data: payload }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetCalibrationQueryKey() }); void client.invalidateQueries({ queryKey: getGetFieldStateQueryKey() }); notify(tx(l, 'calibrationSaved')); }, onError: (error) => notify(errText(error)) });
  };
  return <Page><PageHeading eyebrow={tx(l, 'calibrateTitle')} title={tx(l, 'calibrateTitle')} subtitle={tx(l, 'calibrateSub')} />
    {query.isLoading && <LoadingCard text={tx(l, 'loading')} />}
    {query.isError && <ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} />}
    {query.data && <div className="content-grid">
      <form className="card form-card" onSubmit={submit} data-testid="form-calibration">
        <div className="form-section"><h2 className="form-section-title">{tx(l, 'dry')} &amp; {tx(l, 'wet')}</h2><p className="form-help">{tx(l, 'simulatedNotice')}</p>
          <div className="field-grid"><div className="field-control"><label htmlFor="dry-point">{tx(l, 'dry')} (%)</label><input id="dry-point" type="number" min="0" max="100" step="any" value={dry} onChange={(e) => setDry(e.target.value)} required data-testid="input-dry-point" /></div><div className="field-control"><label htmlFor="wet-point">{tx(l, 'wet')} (%)</label><input id="wet-point" type="number" min="0" max="100" step="any" value={wet} onChange={(e) => setWet(e.target.value)} required data-testid="input-wet-point" /></div></div>
          <div className="field-capture">
            <div className="form-help">{tx(l, 'currentReading')}: {field.data?.telemetry.soilMoisture ?? '—'}%</div>
            <div className="feedback-buttons">
              <button type="button" className="btn btn-outline btn-small" onClick={() => captureCurrent('dry')} disabled={appStale || field.data?.telemetry.soilMoisture == null} data-testid="button-capture-dry">{tx(l, 'dryCapture')}</button>
              <button type="button" className="btn btn-outline btn-small" onClick={() => captureCurrent('wet')} disabled={appStale || field.data?.telemetry.soilMoisture == null} data-testid="button-capture-wet">{tx(l, 'wetCapture')}</button>
            </div>
          </div>
          {dry && wet && !valid && <div role="alert" className="alert-banner error" style={{ marginTop: 15, marginBottom: 0 }}><AlertTriangle size={16} />{tx(l, 'calibrationWarning')}</div>}
          <div className="calibration-track" aria-label={`${tx(l, 'dry')} ${dry}%, ${tx(l, 'wet')} ${wet}%`}><span className="calibration-pin" style={{ left: `${Math.max(0, Math.min(100, dryVal))}%` }} /><span className="calibration-pin" style={{ left: `${Math.max(0, Math.min(100, wetVal))}%`, background: '#4e8159' }} /></div>
          <div className="calibration-caption"><span>{tx(l, 'dry')} · {dry || '—'}%</span><span>{tx(l, 'wet')} · {wet || '—'}%</span></div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={!valid || update.isPending} data-testid="button-save-calibration">{update.isPending ? <LoaderCircle size={16} /> : <Check size={16} />}{update.isPending ? tx(l, 'calibrating') : tx(l, 'saveCalibration')}</button>
      </form>
      <aside className="card list-card"><h2 className="section-title">{tx(l, 'currentGuide')}<Leaf size={18} color="#608465" /></h2><div className="stat-tile" style={{ marginBottom: 10 }}><div className="stat-name">{tx(l, 'lowThreshold')}</div><div className="stat-value">{query.data.lowThreshold}%</div></div><div className="stat-tile"><div className="stat-name">{tx(l, 'targetMoisture')}</div><div className="stat-value">{query.data.targetMoisture}%</div></div><div className="alert-banner info" style={{ marginTop: 15, marginBottom: 0 }}><Info size={16} /><span>{tx(l, 'simulatedNotice')} · {tx(l, 'savedAt')}: {fmtTime(query.data.updatedAt)}</span></div></aside>
    </div>}</Page>;
}

const categories: { value: GetHistoryCategory; key: keyof typeof copy.en }[] = [
  { value: 'all', key: 'all' }, { value: 'reading', key: 'reading' }, { value: 'recommendation', key: 'recommendation' }, { value: 'irrigation', key: 'irrigation' }, { value: 'alert', key: 'alert' }, { value: 'feedback', key: 'feedbackEvents' },
];
function EventGlyph({ category }: { category: string }) {
  if (category === 'irrigation') return <Droplet size={17} />;
  if (category === 'alert') return <AlertTriangle size={17} />;
  if (category === 'recommendation') return <ShieldCheck size={17} />;
  if (category === 'feedback') return <ThumbsUp size={17} />;
  return <Leaf size={17} />;
}
function HistoryList({ items, lang }: { items: HistoryEvent[]; lang: 'en' | 'te' | 'hi' }) {
  return items.length ? <div>{items.map((item) => <article className="event-row" key={item.id} data-testid={`event-row-${item.id}`}><div className="event-main"><span className="event-icon"><EventGlyph category={item.category} /></span><div><div className="event-title">{item.title}</div><div className="event-detail">{item.detail}</div><div className="event-detail">{tx(lang, 'eventSource')}: {item.source}</div></div></div><time className="event-time">{fmtTime(item.at)}</time></article>)}</div> : <div className="empty-state"><History size={27} /><h3>{tx(lang, 'noEvents')}</h3><p>{tx(lang, 'simulatedNotice')}</p></div>;
}
export function HistoryPage() {
  const { lang } = useAquaWise(); const l = lang as 'en' | 'te' | 'hi'; const [category, setCategory] = useState<GetHistoryCategory>('all');
  const params = category === 'all' ? undefined : { category };
  const query = useGetHistory(params, { query: { queryKey: getGetHistoryQueryKey(params), refetchInterval: 60_000 } });
  return <Page><PageHeading eyebrow={tx(l, 'historyTitle')} title={tx(l, 'historyTitle')} subtitle={tx(l, 'historySub')} />
    <div className="filters" role="tablist" aria-label={tx(l, 'historyTitle')}>{categories.map((item) => <button key={item.value} className={`filter-chip ${category === item.value ? 'active' : ''}`} role="tab" aria-selected={category === item.value} onClick={() => setCategory(item.value)} data-testid={`filter-history-${item.value}`}>{tx(l, item.key)}</button>)}</div>
    {query.isLoading && <div className="card" style={{ padding: 20, marginTop: 17 }}><div className="skeleton" style={{ height: 64, marginBottom: 12 }} /><div className="skeleton" style={{ height: 64, marginBottom: 12 }} /><div className="skeleton" style={{ height: 64 }} /></div>}
    {query.isError && <div style={{ marginTop: 18 }}><ErrorBanner text={`${tx(l, 'error')} ${errText(query.error)}`} retry={() => void query.refetch()} /></div>}
    {query.data && <section className="card list-card" style={{ marginTop: 17 }} data-testid="list-history"><HistoryList items={query.data} lang={l} /></section>}
  </Page>;
}

export function SettingsPage() {
  const { lang, notify } = useAquaWise(); const l = lang as 'en' | 'te' | 'hi'; const client = useQueryClient();
  const query = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 60_000 } }); const save = useUpdateSettings();
  const [form, setForm] = useState<SettingsInput | null>(null);
  useEffect(() => { if (query.data && !form) setForm({ ...query.data }); }, [query.data, form]);
  const update = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  const change = (key: keyof SettingsInput, value: string | boolean) => {
    if (!form) return;
    if (key === 'language' || key === 'controlMode') update(key, value as never);
    else if (typeof form[key] === 'boolean') update(key, value as boolean as never);
    else if (key === 'quietHoursStart' || key === 'quietHoursEnd') update(key, value as never);
    else update(key, Number(value) as never);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!form) return;
    save.mutate({ data: form }, { onSuccess: (saved) => { client.setQueryData(getGetSettingsQueryKey(), saved); void client.invalidateQueries({ queryKey: getGetFieldStateQueryKey() }); notify(tx(saved.language, 'settingsSaved')); }, onError: (error) => notify(errText(error)) });
  };
  return <Page><PageHeading eyebrow={tx(l, 'settingsTitle')} title={tx(l, 'settingsTitle')} subtitle={tx(l, 'settingsSub')} />
    {query.isLoading && <LoadingCard text={tx(l, 'loadingSettings')} />}
    {query.isError && <ErrorBanner text={`${tx(l, 'settingsError')} ${errText(query.error)}`} retry={() => void query.refetch()} />}
    {form && <form onSubmit={submit} className="content-grid" data-testid="form-settings">
      <div className="card form-card">
        <div className="form-section"><h2 className="form-section-title">{tx(l, 'language')} &amp; {tx(l, 'control')}</h2><p className="form-help">{tx(l, 'settingsSub')}</p>
          <div className="field-grid"><div className="field-control"><label htmlFor="language">{tx(l, 'language')}</label><select id="language" value={form.language} onChange={(e) => change('language', e.target.value)} data-testid="select-language"><option value="en">{tx(l, 'english')}</option><option value="te">{tx(l, 'telugu')}</option><option value="hi">{tx(l, 'hindi')}</option></select></div><div className="field-control"><label htmlFor="control-mode">{tx(l, 'control')}</label><select id="control-mode" value={form.controlMode} onChange={(e) => change('controlMode', e.target.value)} data-testid="select-control-mode"><option value="advisory">{tx(l, 'advisory')}</option><option value="auto">{tx(l, 'automatic')}</option></select></div></div><p className="form-help" style={{ marginTop: 10, marginBottom: 0 }}>{tx(l, 'controlHelp')}</p>
        </div>
        <div className="form-section"><h2 className="form-section-title">{tx(l, 'notifications')}</h2><div className="toggle-row"><div className="toggle-copy"><strong>{tx(l, 'notifications')}</strong><span>{tx(l, 'notificationsHelp')}</span></div><input aria-label={tx(l, 'notifications')} className="switch" type="checkbox" checked={form.notificationsEnabled} onChange={(e) => change('notificationsEnabled', e.target.checked)} data-testid="toggle-notifications" /></div><div className="field-grid"><div className="field-control"><label htmlFor="quiet-start">{tx(l, 'quietHours')} · {tx(l, 'from')}</label><input id="quiet-start" type="time" value={form.quietHoursStart} onChange={(e) => change('quietHoursStart', e.target.value)} data-testid="input-quiet-start" /></div><div className="field-control"><label htmlFor="quiet-end">{tx(l, 'quietHours')} · {tx(l, 'to')}</label><input id="quiet-end" type="time" value={form.quietHoursEnd} onChange={(e) => change('quietHoursEnd', e.target.value)} data-testid="input-quiet-end" /></div></div></div>
        <div className="form-section"><h2 className="form-section-title">{tx(l, 'operationLimit')}</h2><div className="field-grid"><div className="field-control"><label htmlFor="max-duration">{tx(l, 'maxDuration')} ({tx(l, 'min')})</label><input id="max-duration" type="number" min="1" max="240" value={form.maxDurationMinutes} onChange={(e) => change('maxDurationMinutes', e.target.value)} data-testid="input-max-duration" /></div><div className="field-control"><label htmlFor="flow-rate">{tx(l, 'flow')} ({tx(l, 'perMinute')})</label><input id="flow-rate" type="number" min="0.1" max="100" step="0.1" value={form.flowLitresPerMinute} onChange={(e) => change('flowLitresPerMinute', e.target.value)} data-testid="input-flow-rate" /></div></div></div>
        <div className="form-section"><h2 className="form-section-title">{tx(l, 'location')}</h2><div className="field-grid"><div className="field-control"><label htmlFor="latitude">{tx(l, 'latitude')}</label><input id="latitude" type="number" min="-90" max="90" step="0.0001" value={form.latitude} onChange={(e) => change('latitude', e.target.value)} data-testid="input-latitude" /></div><div className="field-control"><label htmlFor="longitude">{tx(l, 'longitude')}</label><input id="longitude" type="number" min="-180" max="180" step="0.0001" value={form.longitude} onChange={(e) => change('longitude', e.target.value)} data-testid="input-longitude" /></div></div></div>
        <button type="submit" className="btn btn-primary" disabled={save.isPending} data-testid="button-save-settings">{save.isPending ? <LoaderCircle size={16} /> : <Check size={16} />}{save.isPending ? tx(l, 'savingProgress') : tx(l, 'saveSettings')}</button>
      </div>
      <aside className="card list-card"><h2 className="section-title">{tx(l, 'testMode')}<Sprout size={18} color="#608465" /></h2><p className="form-help">{tx(l, 'testHelp')}</p><div className="toggle-row"><div className="toggle-copy"><strong>{tx(l, 'testMode')}</strong><span>{tx(l, 'simulatedNotice')}</span></div><input aria-label={tx(l, 'testMode')} className="switch" type="checkbox" checked={form.testMode} onChange={(e) => change('testMode', e.target.checked)} data-testid="toggle-test-mode" /></div><div className="alert-banner info" style={{ marginTop: 15 }}><Info size={16} /><span>{tx(l, 'operationLimit')}</span></div><div className="stat-tile"><div className="stat-name">{tx(l, 'control')}</div><div className="stat-value" style={{ fontSize: 17 }}>{form.controlMode === 'auto' ? tx(l, 'automatic') : tx(l, 'advisory')}</div></div><p className="subtle" style={{ marginTop: 14 }}>{tx(l, 'simulatedNotice')} · {tx(l, 'source')}: settings</p></aside>
    </form>}
  </Page>;
}
