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
  AlertTriangle, ArrowRight, Check, ChevronDown, Clock, CloudLightning, CloudRain, CloudSun,
  Cpu, Droplet, Droplets, Gauge, History, Info, Leaf, LoaderCircle, Power, Radio, RefreshCw,
  RotateCcw, Shield, ShieldCheck, SlidersHorizontal, Sprout, Sun, Thermometer, Timer,
  ThumbsDown, ThumbsUp, Volume2, WifiOff, Zap
} from 'lucide-react';
import { Link } from 'wouter';
import { useESP32 } from '@/hooks/use-esp32';
import { formatUptime, getMoistureCategory, fetchESP32Status } from '@/lib/esp32';

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
  { label: 'Nirmal, Telangana', lat: 19.0775, lon: 78.4261 },
  { label: 'Vijayawada, Andhra Pradesh', lat: 16.5062, lon: 80.6480 },
  { label: 'Hyderabad, Telangana', lat: 17.3850, lon: 78.4867 },
  { label: 'Guntur, Andhra Pradesh', lat: 16.3067, lon: 80.4365 },
  { label: 'Amaravati, Andhra Pradesh', lat: 16.5131, lon: 80.5165 },
  { label: 'Nagpur, Maharashtra', lat: 21.1458, lon: 79.0882 },
  { label: 'Bengaluru, Karnataka', lat: 12.9716, lon: 77.5946 },
];

interface CropOption {
  id: string;
  labels: Record<'en' | 'te' | 'hi', string>;
  soilTypes: Record<'en' | 'te' | 'hi', string>;
}

const CROPS: CropOption[] = [
  {
    id: 'cotton',
    labels: { en: 'Cotton', te: 'పత్తి (Cotton)', hi: 'कपास (Cotton)' },
    soilTypes: {
      en: 'Deep Black Clay / Regur Soil',
      te: 'లోతైన నల్లరేగడి నేల (Deep Black Soil)',
      hi: 'गहरी काली मिट्टी / रेगुर (Deep Black Soil)',
    },
  },
  {
    id: 'paddy',
    labels: { en: 'Paddy / Rice', te: 'వరి (Paddy / Rice)', hi: 'धान / चावल (Paddy / Rice)' },
    soilTypes: {
      en: 'Clayey Alluvial Soil (High moisture retention)',
      te: 'బంకమట్టి / ఒండ్రు నేల (నీటి నిలుపుదల ఎక్కువ)',
      hi: 'चिकनी जलोढ़ मिट्टी (अधिक जल संचयन)',
    },
  },
  {
    id: 'chilli',
    labels: { en: 'Chilli', te: 'మిర్చి (Chilli)', hi: 'मिर्च (Chilli)' },
    soilTypes: {
      en: 'Black / Red Loamy Soil',
      te: 'నల్ల లేదా ఎర్ర గరప నేల',
      hi: 'काली / लाल दोमट मिट्टी',
    },
  },
  {
    id: 'maize',
    labels: { en: 'Maize / Corn', te: 'మొక్కజొన్న (Maize)', hi: 'मक्का (Maize)' },
    soilTypes: {
      en: 'Well-drained Loam / Red Soil',
      te: 'ఎర్ర గరప నేల',
      hi: 'अच्छी जल निकासी वाली दोमट / लाल मिट्टी',
    },
  },
  {
    id: 'groundnut',
    labels: { en: 'Groundnut / Peanut', te: 'వేరుశనగ (Groundnut)', hi: 'मूंगफली (Groundnut)' },
    soilTypes: {
      en: 'Sandy Loam / Light Red Soil',
      te: 'ఇసుక గరప నేల',
      hi: 'रेतीली दोमट / हल्की लाल मिट्टी',
    },
  },
  {
    id: 'soybean',
    labels: { en: 'Soybean', te: 'సోయాబీన్ (Soybean)', hi: 'सोयाबीन (Soybean)' },
    soilTypes: {
      en: 'Well-drained Clay / Loam Soil',
      te: 'మంచి మురుగునీటి పారుదల గల నల్ల నేల',
      hi: 'अच्छी जल निकासी वाली काली / दोमट मिट्टी',
    },
  },
  {
    id: 'sugarcane',
    labels: { en: 'Sugarcane', te: 'చెరకు (Sugarcane)', hi: 'गन्ना (Sugarcane)' },
    soilTypes: {
      en: 'Deep Rich Loamy Soil',
      te: 'సారవంతమైన లోతైన గరప నేల',
      hi: 'गहरी उपजाऊ दोमट मिट्टी',
    },
  },
  {
    id: 'tomato',
    labels: { en: 'Tomato', te: 'టమాటా (Tomato)', hi: 'टमाटर (Tomato)' },
    soilTypes: {
      en: 'Well-drained Sandy Loam',
      te: 'నీరు నిలవని ఇసుక గరప నేల',
      hi: 'अच्छी जल निकासी वाली रेतीली दोमट मिट्टी',
    },
  },
  {
    id: 'wheat',
    labels: { en: 'Wheat', te: 'గోధుమ (Wheat)', hi: 'गेहूं (Wheat)' },
    soilTypes: {
      en: 'Clay Loam Soil',
      te: 'బంకమట్టి గరప నేల',
      hi: 'चिकनी दोमट मिट्टी',
    },
  },
  {
    id: 'pulses',
    labels: { en: 'Pulses / Red Gram', te: 'కందులు / పప్పుధాన్యాలు (Pulses)', hi: 'अरहर / दालें (Pulses)' },
    soilTypes: {
      en: 'Red Loam / Light Sandy Soil',
      te: 'ఎర్ర నేల లేదా తేలికపాటి నేల',
      hi: 'लाल दोमट / हल्की रेतीली मिट्टी',
    },
  },
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
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 30_000 } });
  const start = useStartIrrigation();
  const stop = useStopIrrigation();
  const feedback = useSubmitFeedback();
  const esp32 = useESP32();

  const invalidate = () => { qk.forEach((queryKey) => void client.invalidateQueries({ queryKey })); };
  const state = field.data;
  const recommendation = rec.data || state?.recommendation;
  const conditionStale = appStale || !!weather.data?.stale || recommendation?.provenance === 'stale' || state?.telemetry.provenance === 'stale';

  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isAutoMode = settings.data?.controlMode === 'auto';
  const isWatering = Boolean(state?.irrigation.active) || Boolean(esp32.data?.pump_running);
  const isAutoSession = isWatering && (state?.irrigation.source === 'automatic' || isAutoMode || Boolean(esp32.data?.auto_pump));

  // Active Watering Timer Calculation
  const wateringDurationMin = state?.irrigation.durationMinutes ?? 15;
  const wateringDurationSec = Math.max(1, wateringDurationMin * 60);

  const wateringEndsAtMs = state?.irrigation.endsAt
    ? new Date(state.irrigation.endsAt).getTime()
    : state?.irrigation.startedAt
      ? new Date(state.irrigation.startedAt).getTime() + wateringDurationSec * 1000
      : nowTs + wateringDurationSec * 1000;

  const remainingWateringSec = Math.max(0, Math.floor((wateringEndsAtMs - nowTs) / 1000));
  const elapsedWateringSec = Math.min(wateringDurationSec, Math.max(0, wateringDurationSec - remainingWateringSec));
  const wateringProgressPct = Math.min(100, Math.max(0, (elapsedWateringSec / wateringDurationSec) * 100));

  // Idle / Schedule Evaluation Timer Calculation
  const nextEvalIso = (state as any)?.schedule?.nextEvaluationTime
    || (recommendation as any)?.nextCheckTime
    || (state as any)?.schedule?.recommendedStartTime;

  const nextEvalMs = nextEvalIso ? new Date(nextEvalIso).getTime() : 0;
  const nextEvalDiffSec = nextEvalMs > nowTs ? Math.floor((nextEvalMs - nowTs) / 1000) : 0;

  const formatCountdown = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const refresh = () => { void field.refetch(); void weather.refetch(); void rec.refetch(); void esp32.refreshStatus(); };

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
        notify(
          l === 'te'
            ? (isAutoSession || isAutoMode ? 'ఆటోమేటిక్ నీటి చర్య బలవంతంగా ఆపబడింది.' : 'నీటి చర్య ఆపబడింది.')
            : l === 'hi'
              ? (isAutoSession || isAutoMode ? 'स्वचालित सिंचाई तुरंत रोक दी गई।' : 'सिंचाई रोक दी गई।')
              : (isAutoSession || isAutoMode ? 'Automatic watering force-stopped.' : 'Watering session stopped.')
        );
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

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => { window.speechSynthesis.getVoices(); };
    window.speechSynthesis.onvoiceschanged = onVoices;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === onVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const readAloud = () => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      notify(tx(l, 'voiceUnavailable'));
      return;
    }
    if (!recommendation && !isWatering && !esp32.data) return;

    const voices = window.speechSynthesis.getVoices();
    const langVoices = voices.filter((v) => {
      const code = v.lang.toLowerCase().replace('_', '-');
      return code.startsWith(l) || (l === 'te' && code.includes('te')) || (l === 'hi' && code.includes('hi'));
    });

    const isMale = (v: SpeechSynthesisVoice) => {
      const text = `${v.name} ${v.voiceURI}`.toLowerCase();
      return (
        text.includes('male') ||
        text.includes('-tem-') || text.includes('te-in-x-tem') ||
        text.includes('-him-') || text.includes('hi-in-x-him') ||
        text.includes('-enm-') || text.includes('en-in-x-enm') ||
        text.includes('-end-') || text.includes('mohan') ||
        text.includes('hemant') || text.includes('ravi') ||
        text.includes('david') || text.includes('george')
      );
    };

    const localLangVoices = langVoices.filter((v) => v.localService);
    const candidateVoices = localLangVoices.length > 0 ? localLangVoices : langVoices;
    const selectedVoice = candidateVoices.find(isMale) || candidateVoices[0];
    if (l !== 'en' && !selectedVoice && langVoices.length === 0 && voices.length === 0) {
      notify(tx(l, 'voiceMissing'));
      return;
    }

    const moisture = esp32.data?.soil_moisture_percent != null
      ? Math.round(esp32.data.soil_moisture_percent)
      : (state?.telemetry.soilMoisture != null ? Math.round(state.telemetry.soilMoisture) : null);
    const temp = Math.round(esp32.data?.temperature_c ?? weather.data?.temperatureC ?? state?.telemetry.temperatureC ?? 28);
    const rainChance = Math.round(weather.data?.rainProbability6h ?? 0);
    const rainMm = Math.round((weather.data?.precipitationMm6h ?? 0) * 10) / 10;
    const duration = recommendation?.durationMinutes ?? state?.irrigation.durationMinutes ?? 15;
    const targetMoisture = state?.targetMoisture ?? 55;

    let spokenText = '';

    if (isWatering || esp32.data?.pump_running) {
      if (l === 'te') {
        spokenText = `రైతు సోదరా, ప్రస్తుతం మీ పొలానికి నీరు పెట్టడం జరుగుతోంది. ఈ సెషన్ మొత్తం ${duration} నిమిషాలు నడుస్తుంది, ఇది నేల తేమను మీ లక్ష్యమైన ${targetMoisture} శాతానికి పెంచుతుంది. మీరు కోరుకుంటే ఎప్పుడైనా నీరు ఆపవచ్చు.`;
      } else if (l === 'hi') {
        spokenText = `किसान भाई, इस समय आपके खेत में सिंचाई चल रही है। यह चक्र कुल ${duration} मिनट चलेगा, जिससे मिट्टी की नमी आपके लक्ष्य ${targetMoisture} प्रतिशत तक पहुंचेगी। आप जब चाहें सिंचाई रोक सकते हैं।`;
      } else {
        spokenText = `Farmer friend, watering is currently underway for a total of ${duration} minutes. This session will replenish your soil moisture towards your target of ${targetMoisture} percent. You can tap stop watering at any time if you wish.`;
      }
    } else if (status === 'WATER NOW' || esp32.data?.recommendation === 'WATER NOW') {
      if (l === 'te') {
        spokenText = `రైతు సోదరా, మీ పొలంలో మట్టి తేమ ప్రస్తుతం ${moisture != null ? `${moisture} శాతం మాత్రమే ఉంది` : 'చాలా తక్కువగా ఉంది'}, ఇది పంటకు కావలసిన స్థాయి కంటే తక్కువ. రాబోయే 6 గంటల్లో వర్ష సూచన లేదు మరియు ఉష్ణోగ్రత ${temp} డిగ్రీలుగా ఉంది. పంట వేర్లు ఎండిపోకుండా ఉండటానికి, మీ పొలానికి ఇప్పుడు ${duration} నిమిషాలు నీరు పెట్టడం మంచిది. సిద్ధంగా ఉన్నప్పుడు నీరు పెట్టడం ప్రారంభించండి.`;
      } else if (l === 'hi') {
        spokenText = `किसान भाई, आपके खेत में मिट्टी की नमी अभी ${moisture != null ? `${moisture} प्रतिशत ही बची है` : 'काफी कम है'}, जो फसल की आवश्यकता से कम है। अगले 6 घंटे में बारिश की कोई संभावना नहीं है और तापमान ${temp} डिग्री है। पौधों को सूखे के तनाव से बचाने के लिए, अभी ${duration} मिनट सिंचाई करने की सलाह दी जाती है। तैयार होने पर पानी देना शुरू करें।`;
      } else {
        spokenText = `Farmer friend, your soil moisture is currently down to ${moisture != null ? `${moisture} percent` : 'a low level'}, which is below your crop's healthy range. There is no rain expected in the next 6 hours, and temperature is ${temp} degrees Celsius. We recommend watering your field for ${duration} minutes now to keep the root zone healthy and prevent moisture stress.`;
      }
    } else if (status === 'CHECK FIELD' || esp32.data?.recommendation === 'CHECK FIELD') {
      if (l === 'te') {
        spokenText = `రైతు సోదరా, సిస్టమ్‌కు ప్రస్తుతం స్పష్టమైన మట్టి తేమ రీడింగ్ అందడం లేదు. సెన్సార్ వదులుగా ఉండవచ్చు లేదా నేల పరిస్థితిలో తేడా ఉండవచ్చు. దయచేసి నీరు పెట్టే ముందు మీ పొలాన్ని మరియు తేమ సెన్సార్‌ను స్వయంగా ఒకసారి పరిశీలించండి.`;
      } else if (l === 'hi') {
        spokenText = `किसान भाई, सिस्टम को अभी खेत से मिट्टी की सही नमी की रीडिंग नहीं मिल पा रही है। हो सकता है सेंसर में कोई समस्या हो। पानी देने से पहले कृपया खेत में जाकर मिट्टी और सेंसर की स्थिति खुद जांचें।`;
      } else {
        spokenText = `Farmer friend, the system is unable to get a reliable soil moisture reading right now. The sensor might be loose or conditions unexpected. Please physically check your field and sensor before making an irrigation decision.`;
      }
    } else {
      // WAIT
      const isRain = esp32.data?.rain_detected || weather.data?.rainingNow || rainChance >= 50;
      if (isRain) {
        if (l === 'te') {
          spokenText = `రైతు సోదరా, మీ పొలంలో తేమ తక్కువగా ఉన్నప్పటికీ, రాబోయే 6 గంటల్లో ${rainChance} శాతం వర్షం వచ్చే అవకాశం ఉంది. ప్రస్తుతానికి నీరు పెట్టవద్దు, వేచి ఉండండి. సహజ వర్షాన్ని సద్వినియోగం చేసుకోవడం వల్ల మీ నీరు ఆదా అవుతుంది మరియు నేల అతిగా తడవకుండా ఉంటుంది.`;
        } else if (l === 'hi') {
          spokenText = `किसान भाई, भले ही मिट्टी में नमी कम हो, लेकिन अगले 6 घंटे में ${rainChance} प्रतिशत बारिश की संभावना है। अभी पानी न दें और इंतज़ार करें। प्राकृतिक बारिश का इंतज़ार करने से पानी की बचत होगी और खेत में दलदल नहीं बनेगा।`;
        } else {
          spokenText = `Farmer friend, although soil moisture is low, weather forecasts show a ${rainChance} percent chance of rain with ${rainMm} millimeters expected within the next 6 hours. Hold off on watering for now. Waiting for the rain will save your water and prevent soil saturation.`;
        }
      } else {
        if (l === 'te') {
          spokenText = `రైతు సోదరా, మీ పొలంలో తేమ పరిస్థితి చాలా బాగుంది. మట్టి తేమ ప్రస్తుతం ${moisture != null ? `${moisture} శాతంగా ఉంది` : 'తగినంతగా ఉంది'}, ఇది మీ పంట ఆరోగ్యకరమైన పెరుగుదలకు సరిపోతుంది. ఉష్ణోగ్రత ${temp} డిగ్రీలుగా ఉంది మరియు పంటకు నీటి కొరత లేదు, కాబట్టి ఈ రోజు నీరు అవసరం లేదు.`;
        } else if (l === 'hi') {
          spokenText = `किसान भाई, आपके खेत में नमी की स्थिति बहुत अच्छी है। मिट्टी की नमी अभी ${moisture != null ? `${moisture} प्रतिशत है` : 'पर्याप्त है'}, जो फसल की अच्छी बढ़वार के लिए काफी है। तापमान ${temp} डिग्री है और पौधों को पूरा पानी मिल रहा है, इसलिए आज अतिरिक्त पानी देने की आवश्यकता नहीं है।`;
        } else {
          spokenText = `Farmer friend, your field is in great shape. Soil moisture is currently healthy at ${moisture != null ? `${moisture} percent` : 'a good level'}, which is plenty for your crops. With temperatures at ${temp} degrees, your plants are not under stress, so no watering is needed today.`;
        }
      }
    }

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = l === 'te' ? 'te-IN' : l === 'hi' ? 'hi-IN' : 'en-IN';
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.pitch = selectedVoice && isMale(selectedVoice) ? 0.90 : 0.80;
    utterance.rate = 0.92;
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

  const status = (esp32.isConnected && esp32.data?.recommendation) ? esp32.data.recommendation : (recommendation?.status || 'WAIT');

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
    : ((esp32.isConnected && esp32.data?.reason) ? esp32.data.reason : (recommendation?.reason || tx(l, 'reasonFallback')));

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

      {/* Dominant Hero Recommendation Card */}
      <section className={`calm-hero tone-${statusTone}`} data-testid="card-recommendation">
        {/* Subtle Mode Box (lowkey rectangular tag, no pills) */}
        {isAutoMode ? (
          <div className="hero-mode-tag" data-testid="tag-mode-auto">
            {tx(l, 'automatic')}
          </div>
        ) : (
          <div className="hero-mode-tag advisory" data-testid="tag-mode-advisory">
            {tx(l, 'advisory')}
          </div>
        )}

        <h1 className="hero-dominant-title">{dominantTitle}</h1>

        <p className="hero-explanation">{explanation}</p>

        {/* Lowkey Timer (no enclosing card/box, solid line without gradient) */}
        {isWatering ? (
          <div className="hero-timer-clean" data-testid="active-watering-timer">
            <div className="timer-clean-header">
              <span className="timer-clean-label">{tx(l, 'wateringTimerRemaining')}:</span>
              <span className="timer-clean-digits font-mono">
                {formatCountdown(remainingWateringSec)}
              </span>
            </div>

            <div className="timer-clean-track">
              <div
                className="timer-clean-bar"
                style={{ width: `${wateringProgressPct}%` }}
              />
            </div>

            <div className="timer-clean-meta">
              <span>{tx(l, 'elapsedTime')}: {formatCountdown(elapsedWateringSec)}</span>
              <span>{tx(l, 'totalDuration')}: {wateringDurationMin} {tx(l, 'minutes')}</span>
            </div>
          </div>
        ) : (
          /* Lowkey Idle / Scheduled Timer */
          nextEvalDiffSec > 0 && (
            <div className="hero-timer-clean idle" data-testid="idle-schedule-timer">
              <div className="timer-clean-header">
                <span className="timer-clean-label">
                  {isAutoMode ? tx(l, 'nextAutoCheckTimer') : tx(l, 'nextAdvisoryCheckTimer')}:
                </span>
                <span className="timer-clean-digits font-mono">
                  {formatCountdown(nextEvalDiffSec)}
                </span>
              </div>
            </div>
          )
        )}

        {/* Dynamic Schedule Outlook */}
        {!isWatering && ((state as any)?.schedule || recommendation) && (
          <div className="hero-schedule-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            {status === 'WATER NOW' && ((state as any)?.schedule?.durationMinutes || recommendation?.durationMinutes) ? (
              <span>
                {tx(l, 'recommendedSession')}: {(state as any)?.schedule?.durationMinutes ?? recommendation?.durationMinutes} {tx(l, 'minutes')}
                {((state as any)?.schedule?.estimatedLitres ?? (recommendation as any)?.estimatedLitres) ? ` · ${((state as any)?.schedule?.estimatedLitres ?? (recommendation as any)?.estimatedLitres)} L` : ''}
              </span>
            ) : status === 'WAIT' && (state as any)?.schedule?.recommendedStartTime ? (
              <span>
                {tx(l, 'scheduledWatering')}: {fmtTime((state as any)?.schedule?.recommendedStartTime)} ({(state as any)?.schedule?.durationMinutes} min · {(state as any)?.schedule?.estimatedLitres} L)
              </span>
            ) : status === 'WAIT' && (state as any)?.schedule?.nextEvaluationTime ? (
              <span>
                {tx(l, 'nextEvaluation')}: {fmtTime((state as any)?.schedule?.nextEvaluationTime)}
              </span>
            ) : null}
          </div>
        )}

        {/* Primary Single Action */}
        <div className="hero-actions-container">
          {isWatering ? (
            <button
              className="btn btn-prominent-danger"
              onClick={async () => {
                if (esp32.data?.pump_running) {
                  try {
                    await esp32.stopPump();
                    notify(l === 'te' ? 'నీటి చర్య ఆపబడింది.' : l === 'hi' ? 'सिंचाई रोक दी गई।' : 'Watering session stopped.');
                  } catch (err) {
                    notify(errText(err));
                  }
                } else {
                  doStop();
                }
              }}
              disabled={stop.isPending || esp32.isCommandPending || appStale}
              data-testid="button-stop-irrigation"
            >
              {(stop.isPending || esp32.isCommandPending) ? <LoaderCircle size={18} className="animate-spin" /> : <Droplet size={18} />}
              <span>{isAutoSession || isAutoMode ? tx(l, 'forceStopWatering') : tx(l, 'stopWatering')}</span>
            </button>
          ) : status === 'WATER NOW' ? (
            <button
              className="btn btn-prominent-action"
              onClick={async () => {
                if (esp32.isConnected && !esp32.data?.auto_pump) {
                  try {
                    await esp32.startPump();
                    notify(l === 'te' ? 'నీటి చర్య ప్రారంభమైంది.' : l === 'hi' ? 'सिंचाई शुरू हुई।' : 'Watering session started.');
                  } catch (err) {
                    notify(errText(err));
                  }
                } else {
                  runWater();
                }
              }}
              disabled={(!recommendation && !esp32.data) || start.isPending || esp32.isCommandPending || appStale || (esp32.data?.auto_pump === true)}
              data-testid="button-start-irrigation"
            >
              {(start.isPending || esp32.isCommandPending) ? <LoaderCircle size={18} className="animate-spin" /> : <Droplets size={18} />}
              <span>
                {tx(l, 'water')}
                {recommendation?.durationMinutes ? ` (${recommendation.durationMinutes} ${tx(l, 'minutes')}${((state as any)?.schedule?.estimatedLitres ?? (recommendation as any)?.estimatedLitres) ? ` · ${((state as any)?.schedule?.estimatedLitres ?? (recommendation as any)?.estimatedLitres)} L` : ''})` : ''}
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

      {/* 0. ESP32 Smart Hardware Controller Section */}
      <section
        className="sensor-section-card"
        data-testid="section-esp32-controller"
        aria-label="ESP32 Smart Hardware Controller"
      >
        <div className="sensor-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="sensor-section-title">{tx(l, 'esp32SectionTitle')}</h2>
              <span
                className={`esp32-badge-pill ${esp32.isConnected ? 'live' : esp32.isStale ? 'stale' : 'offline'}`}
                data-testid="esp32-status-pill"
              >
                <span className={`live-pulse-dot ${esp32.isConnected ? '' : 'offline'}`} />
                {esp32.isConnected
                  ? tx(l, 'esp32StatusLive')
                  : esp32.isStale
                    ? tx(l, 'esp32StatusStale')
                    : tx(l, 'esp32StatusOffline')}
              </span>
            </div>
            <p className="sensor-section-subtitle">
              {tx(l, 'esp32SectionSub')}
            </p>
          </div>

          <div className="esp32-meta-chips">
            <span className="esp32-chip" title="Device Name & Base URL">
              <Radio size={12} />
              <span>{esp32.data?.device || 'esp32-aquawise'}</span>
              <span style={{ opacity: 0.7 }}>({esp32.esp32Url})</span>
            </span>
            {esp32.data?.uptime_ms != null && (
              <span className="esp32-chip" title="Device Uptime">
                <Clock size={12} />
                <span>{tx(l, 'esp32Uptime')}: {formatUptime(esp32.data.uptime_ms)}</span>
              </span>
            )}
            <Link href="/settings#esp32" className="text-button" style={{ fontSize: 12 }}>
              <SlidersHorizontal size={13} /> {tx(l, 'settings')}
            </Link>
          </div>
        </div>

        {/* Stale / Offline Notice Banner */}
        {(!esp32.isConnected || esp32.isStale) && (
          <div className="alert-banner error" style={{ marginBottom: 16 }} role="status">
            <WifiOff size={16} />
            <div style={{ flex: 1 }}>
              <strong>{tx(l, 'esp32StatusOffline')}</strong>: {esp32.error || 'Cannot reach ESP32 HTTP server.'}
              {esp32.lastUpdated && (
                <span style={{ display: 'block', fontSize: 11, marginTop: 2, opacity: 0.85 }}>
                  {tx(l, 'esp32LastSeen')}: {fmtTime(esp32.lastUpdated.toISOString())} ({tx(l, 'esp32StatusStale')})
                </span>
              )}
            </div>
            <button
              className="btn btn-outline btn-small"
              onClick={() => void esp32.refreshStatus()}
              disabled={esp32.isLoading}
            >
              <RefreshCw size={13} className={esp32.isLoading ? 'animate-spin' : ''} /> {tx(l, 'retry')}
            </button>
          </div>
        )}

        {/* Real-Time Sensor Telemetry Grid */}
        <div className="local-sensors-grid" data-testid="esp32-telemetry-grid" style={{ marginBottom: 16 }}>
          {/* Soil Moisture */}
          <div className="local-sensor-card" data-testid="esp32-soil-cell">
            <div className="local-sensor-card-header">
              <Droplets size={15} className="sensor-icon color-soil" />
              <span className="local-sensor-card-label">{tx(l, 'soilMoistureLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {esp32.data?.soil_moisture_percent != null
                ? `${esp32.data.soil_moisture_percent}%`
                : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {esp32.data?.soil_moisture_percent != null
                ? (() => {
                    const cat = getMoistureCategory(esp32.data?.soil_moisture_percent);
                    const tagLabel = cat === 'dry' ? tx(l, 'moistureDry') : cat === 'moderate' ? tx(l, 'moistureModerate') : cat === 'wet' ? tx(l, 'moistureWet') : tx(l, 'moistureUnavailable');
                    return `${tagLabel} · ${tx(l, 'esp32SoilRaw')}: ${esp32.data?.soil_raw ?? '—'}`;
                  })()
                : tx(l, 'noMoisture')}
            </div>
          </div>

          {/* Rain Sensor */}
          <div className="local-sensor-card" data-testid="esp32-rain-cell">
            <div className="local-sensor-card-header">
              <CloudRain size={15} className="sensor-icon color-rain" />
              <span className="local-sensor-card-label">{tx(l, 'sensorRainLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {esp32.data?.rain_detected === true ? (
                <span className="status-text-highlight raining">{tx(l, 'sensorRaining')}</span>
              ) : esp32.data?.rain_detected === false ? (
                <span className="status-text-highlight dry">{tx(l, 'sensorNoRain')}</span>
              ) : (
                '—'
              )}
            </div>
            <div className="local-sensor-card-caption">
              {esp32.data?.rain_detected === true
                ? (l === 'te' ? 'వర్షం నమోదవుతోంది' : l === 'hi' ? 'बारिश सक्रिय है' : 'Precipitation detected')
                : esp32.data?.rain_detected === false
                  ? (l === 'te' ? 'నేలపైన వర్షం లేదు' : l === 'hi' ? 'कोई वर्षा नहीं' : 'No rain on sensor plate')
                  : (l === 'te' ? 'సమాచారం లేదు' : l === 'hi' ? 'कोई डेटा नहीं' : 'No sensor data')}
            </div>
          </div>

          {/* Temperature Probe */}
          <div className="local-sensor-card" data-testid="esp32-temp-cell">
            <div className="local-sensor-card-header">
              <Thermometer size={15} className="sensor-icon color-temp" />
              <span className="local-sensor-card-label">{tx(l, 'temperatureLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {esp32.data?.temperature_c != null ? `${esp32.data.temperature_c}°C` : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {l === 'te' ? 'పొలంలో నేరుగా ఉష్ణోగ్రత' : l === 'hi' ? 'खेत का स्थानीय तापमान' : 'Field probe air temp'}
            </div>
          </div>

          {/* Humidity Probe */}
          <div className="local-sensor-card" data-testid="esp32-humidity-cell">
            <div className="local-sensor-card-header">
              <Gauge size={15} className="sensor-icon color-humidity" />
              <span className="local-sensor-card-label">{tx(l, 'sensorHumidityLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {esp32.data?.humidity_percent != null ? `${esp32.data.humidity_percent}%` : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {l === 'te' ? 'గాలిలోని తేమ శాతం' : l === 'hi' ? 'हवा में नमी का स्तर' : 'Relative humidity'}
            </div>
          </div>

          {/* Sun Intensity / Solar Panel Voltage */}
          <div className="local-sensor-card" data-testid="esp32-solar-cell">
            <div className="local-sensor-card-header">
              <Sun size={15} className="sensor-icon color-sun" />
              <span className="local-sensor-card-label">{tx(l, 'sunIntensity')}</span>
            </div>
            <div className="local-sensor-card-value">
              {esp32.data?.solar_panel_voltage_v != null
                ? `${esp32.data.solar_panel_voltage_v.toFixed(2)} V`
                : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {esp32.data?.solar_panel_voltage_v != null && esp32.data.solar_panel_voltage_v > 4.0
                ? (l === 'te' ? 'సౌర శక్తి యాక్టివ్' : l === 'hi' ? 'सौर ऊर्जा सक्रिय' : 'Solar power active')
                : (l === 'te' ? 'సౌర వోల్టేజ్' : l === 'hi' ? 'सौर वोल्टेज' : 'Solar panel voltage')}
            </div>
          </div>
        </div>

        {/* Authoritative Recommendation & Reason from ESP32 */}
        {esp32.data && (
          <div
            className={`esp32-recommendation-banner ${
              esp32.data.recommendation === 'WATER NOW'
                ? 'water-now'
                : esp32.data.recommendation === 'CHECK FIELD'
                  ? 'check-field'
                  : ''
            }`}
            data-testid="esp32-recommendation-banner"
            style={{ marginBottom: 16 }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary)' }}>
                  {tx(l, 'esp32HardwareRecommendation')}
                </span>
                <span className={`esp32-tag ${esp32.data.recommendation === 'WATER NOW' ? 'dry' : esp32.data.recommendation === 'CHECK FIELD' ? 'moderate' : 'wet'}`}>
                  {esp32.data.recommendation}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-heading)', fontWeight: 500 }}>
                {esp32.data.reason}
              </p>
            </div>
          </div>
        )}

        {/* Pump Controls & Mode Switcher Grid */}
        <div className="esp32-control-panel" style={{ margin: 0 }}>
          {/* Box 1: Mode Switcher */}
          <div className="esp32-mode-box">
            <div className="esp32-box-header">
              <span>{tx(l, 'control')}</span>
              <span className={`esp32-tag ${esp32.data?.auto_pump ? 'wet' : 'moderate'}`}>
                {esp32.data?.auto_pump ? tx(l, 'esp32AutoModeOn') : tx(l, 'esp32AutoModeOff')}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {esp32.data?.auto_pump ? tx(l, 'controlHelp') : tx(l, 'operationLimit')}
            </div>
            <div className="esp32-actions-row">
              <button
                type="button"
                className={`btn ${esp32.data?.auto_pump ? 'btn-outline' : 'btn-primary'} btn-small`}
                onClick={async () => {
                  try {
                    await esp32.toggleAuto();
                    notify(tx(l, 'settingsSaved'));
                  } catch (err) {
                    notify(errText(err));
                  }
                }}
                disabled={esp32.isCommandPending || !esp32.isConnected}
                data-testid="button-esp32-toggle-auto"
              >
                {esp32.isCommandPending ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Power size={14} />
                )}
                <span>
                  {esp32.data?.auto_pump ? tx(l, 'esp32SwitchToManual') : tx(l, 'esp32SwitchToAuto')}
                </span>
              </button>
            </div>
          </div>

          {/* Box 2: Pump Control & Safety Interlocks */}
          <div className="esp32-pump-box">
            <div className="esp32-box-header">
              <span>{tx(l, 'irrigation')}</span>
              {esp32.data?.pump_running ? (
                <span className="pump-active-indicator" data-testid="esp32-pump-active">
                  <Droplet size={15} />
                  <span>{tx(l, 'esp32PumpRunning')}</span>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {tx(l, 'esp32PumpStopped')}
                </span>
              )}
            </div>

            {/* Dry Count Confirmation Progress Meter */}
            {esp32.data && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 2 }}>
                  <span>{tx(l, 'esp32DryCountProgress')}</span>
                  <span>{esp32.data.dry_count} / {esp32.data.confirm_samples} {tx(l, 'esp32DrySamples')}</span>
                </div>
                <div className="esp32-progress-bar">
                  <div
                    className="esp32-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, (esp32.data.dry_count / Math.max(1, esp32.data.confirm_samples)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Pump Actions */}
            <div className="esp32-actions-row">
              {esp32.data?.pump_running ? (
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={async () => {
                    try {
                      await esp32.stopPump();
                      notify(tx(l, 'stopWatering'));
                    } catch (err) {
                      notify(errText(err));
                    }
                  }}
                  disabled={esp32.isCommandPending || !esp32.isConnected}
                  data-testid="button-esp32-stop-pump"
                >
                  {esp32.isCommandPending ? <LoaderCircle size={14} className="animate-spin" /> : <Droplet size={14} />}
                  <span>{tx(l, 'esp32StopPump')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={async () => {
                    try {
                      await esp32.startPump();
                      notify(tx(l, 'activeSession'));
                    } catch (err) {
                      notify(errText(err));
                    }
                  }}
                  disabled={esp32.data?.auto_pump === true || esp32.isCommandPending || !esp32.isConnected}
                  data-testid="button-esp32-start-pump"
                  title={esp32.data?.auto_pump ? tx(l, 'esp32AutoModeWarning') : tx(l, 'esp32StartPump')}
                >
                  {esp32.isCommandPending ? <LoaderCircle size={14} className="animate-spin" /> : <Droplets size={14} />}
                  <span>{tx(l, 'esp32StartPump')}</span>
                </button>
              )}

              {esp32.data?.auto_pump && !esp32.data?.pump_running && (
                <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                  {tx(l, 'esp32AutoModeWarning')}
                </span>
              )}
            </div>

            <div className="esp32-safety-note">
              <ShieldCheck size={13} color="var(--color-primary)" />
              <span>{tx(l, 'esp32SafetyLimitNotice')}</span>
            </div>
          </div>
        </div>

        {/* Command Error Alert (if any) */}
        {esp32.commandError && (
          <div className="alert-banner error" style={{ marginTop: 16 }} role="alert">
            <AlertTriangle size={16} />
            <span style={{ flex: 1 }}>{esp32.commandError}</span>
          </div>
        )}
      </section>



      {/* 2. Google Weather API Section (No soil moisture) */}
      <section className="sensor-section-card" data-testid="section-google-weather-api" aria-label="Google Weather API forecast">
        <div className="sensor-section-header">
          <h2 className="sensor-section-title">{tx(l, 'weatherApiTitle')}</h2>
          <p className="sensor-section-subtitle">{tx(l, 'weatherApiSub')}</p>
        </div>

        <div className="google-weather-grid">
          {/* Forecast Temperature & Outlook */}
          <div className="local-sensor-card" data-testid="card-temperature">
            <div className="local-sensor-card-header">
              <Sun size={15} className="sensor-icon color-sun" />
              <span className="local-sensor-card-label">{tx(l, 'temperatureLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {weather.data?.temperatureC != null ? `${weather.data.temperatureC}°C` : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {weather.data?.summary
                ? localizedWeatherSummary(weather.data.summary, l)
                : (l === 'te' ? 'సాధారణ ఉష్ణోగ్రత' : l === 'hi' ? 'सामान्य तापमान' : 'Normal range')}
            </div>
          </div>

          {/* Expected Rain Volume (6h) */}
          <div className="local-sensor-card" data-testid="card-weather">
            <div className="local-sensor-card-header">
              <CloudRain size={15} className="sensor-icon color-rain" />
              <span className="local-sensor-card-label">{tx(l, 'forecastRainVolume')}</span>
            </div>
            <div className="local-sensor-card-value">
              {weather.data?.precipitationMm6h != null ? `${weather.data.precipitationMm6h} mm` : '0 mm'}
            </div>
            <div className="local-sensor-card-caption">
              {weather.data?.rainProbability6h != null
                ? `${weather.data.rainProbability6h}% ${tx(l, 'rainChance')}`
                : (l === 'te' ? 'రాబోయే 6 గంటలు' : l === 'hi' ? 'अगले 6 घंटे' : 'Next 6 hours')}
            </div>
          </div>

          {/* Rain Probability (6h) */}
          <div className="local-sensor-card" data-testid="card-weather-rain-probability">
            <div className="local-sensor-card-header">
              <CloudLightning size={15} className="sensor-icon color-humidity" />
              <span className="local-sensor-card-label">{tx(l, 'rainChance')}</span>
            </div>
            <div className="local-sensor-card-value">
              {weather.data?.rainProbability6h != null ? `${weather.data.rainProbability6h}%` : '0%'}
            </div>
            <div className="local-sensor-card-caption">
              {weather.data?.rainingNow
                ? (l === 'te' ? 'ప్రస్తుతం వర్షం' : l === 'hi' ? 'अभी बारिश' : 'Rain currently active')
                : (weather.data?.rainProbability6h ?? 0) >= 50
                  ? (l === 'te' ? 'వర్షం వచ్చే అవకాశం ఉంది' : l === 'hi' ? 'जल्द बारिश की संभावना' : 'Rain likely soon')
                  : (l === 'te' ? 'వర్షం అవకాశం తక్కువ' : l === 'hi' ? 'बारिश की कम संभावना' : 'Low chance of rain')}
            </div>
          </div>

          {/* Forecast Humidity */}
          <div className="local-sensor-card" data-testid="card-weather-humidity">
            <div className="local-sensor-card-header">
              <Droplets size={15} className="sensor-icon color-soil" />
              <span className="local-sensor-card-label">{tx(l, 'sensorHumidityLabel')}</span>
            </div>
            <div className="local-sensor-card-value">
              {weather.data?.humidityPercent != null ? `${weather.data.humidityPercent}%` : '—'}
            </div>
            <div className="local-sensor-card-caption">
              {l === 'te' ? 'వాతావరణ తేమ' : l === 'hi' ? 'वायुमंडलीय आर्द्रता' : 'Regional atmosphere'}
            </div>
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

          {/* Dynamic Irrigation Schedule Plan */}
          {(data as any)?.schedule && (
            <section className="calm-card" data-testid="card-irrigation-schedule">
              <div className="section-header">
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>{tx(l, 'scheduleTitle')}</div>
                  <h2 className="section-title-clean">
                    {(data as any).schedule.recommendedStartTime
                      ? `${tx(l, 'scheduledWatering')}: ${fmtTime((data as any).schedule.recommendedStartTime)}`
                      : (data as any).schedule.status === 'WATER NOW'
                        ? tx(l, 'water')
                        : tx(l, 'allSet')}
                  </h2>
                  <p className="section-subtitle-clean">{(data as any).schedule.timingReason}</p>
                </div>
                {(data as any).schedule.durationMinutes ? (
                  <div className="strategy-number">
                    {(data as any).schedule.durationMinutes} <span className="unit">{tx(l, 'minutes')} · {(data as any).schedule.estimatedLitres} L</span>
                  </div>
                ) : null}
              </div>

              <div className="chips-stat-grid">
                <div className="summary-chip" style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx(l, 'target')}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{(data as any).schedule.targetMoisture}%</div>
                </div>
                <div className="summary-chip" style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx(l, 'nextEvaluation')}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtTime((data as any).schedule.nextEvaluationTime)}</div>
                </div>
              </div>

              {(data as any).schedule.assumptions && (
                <div className="strategy-assumptions-box" style={{ marginTop: 10 }}>
                  {(data as any).schedule.assumptions}
                </div>
              )}
            </section>
          )}

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

              <div className="chips-stat-grid">
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

  // ESP32 Hardware settings state
  const esp32 = useESP32();
  const [esp32UrlInput, setEsp32UrlInput] = useState(esp32.esp32Url);
  const [esp32ModeInput, setEsp32ModeInput] = useState(esp32.connectionMode);
  const [testTesting, setTestTesting] = useState(false);
  const [testStatusFeedback, setTestStatusFeedback] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    device?: string;
    uptime?: string;
  } | null>(null);

  useEffect(() => {
    if (esp32.esp32Url) {
      setEsp32UrlInput(esp32.esp32Url);
    }
    setEsp32ModeInput(esp32.connectionMode);
  }, [esp32.esp32Url, esp32.connectionMode]);

  const handleTestConnection = async () => {
    setTestTesting(true);
    setTestStatusFeedback(null);
    const start = performance.now();
    try {
      const res = await fetchESP32Status(esp32UrlInput, esp32ModeInput);
      const latency = Math.round(performance.now() - start);
      setTestStatusFeedback({
        success: true,
        message: tx(l, 'esp32ConnectionSuccess'),
        latencyMs: latency,
        device: res.device,
        uptime: formatUptime(res.uptime_ms),
      });
      notify(tx(l, 'esp32ConnectionSuccess'));
    } catch (err: any) {
      setTestStatusFeedback({
        success: false,
        message: `${tx(l, 'esp32ConnectionFailed')} ${err.message || ''}`,
      });
      notify(`${tx(l, 'esp32ConnectionFailed')}`);
    } finally {
      setTestTesting(false);
    }
  };

  const handleSaveHardwareSettings = async (e: FormEvent) => {
    e.preventDefault();
    try {
      esp32.setConnectionMode(esp32ModeInput);
      await esp32.setEsp32Url(esp32UrlInput);
      notify(tx(l, 'settingsSaved'));
    } catch (err: any) {
      notify(errText(err));
    }
  };

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

  // Informational Crop Type & Assumed Soil Type (input only, no effect on calculations)
  const [selectedCrop, setSelectedCrop] = useState<string>(() => {
    try {
      return localStorage.getItem('aquawise_crop_type') || 'cotton';
    } catch {
      return 'cotton';
    }
  });

  const activeCrop = CROPS.find((c) => c.id === selectedCrop) || CROPS[0];
  const assumedSoilText = activeCrop ? activeCrop.soilTypes[l] || activeCrop.soilTypes.en : '';

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

  const currentPresetIndex = form ? LOCATION_PRESETS.findIndex(
    (p) => Math.abs(p.lat - form.latitude) < 0.01 && Math.abs(p.lon - form.longitude) < 0.01
  ) : -1;

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

  const applyScenarioPreset = (scenarioKey: string) => {
    scenario.mutate(
      { data: { scenarioKey } as unknown as TestScenarioInput },
      {
        onSuccess: () => {
          qk.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
          notify(l === 'te' ? 'పరీక్ష పరిస్థితి వర్తింపజేయబడింది.' : l === 'hi' ? 'परीक्षण स्थिति लागू की गई।' : 'Test scenario applied.');
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
                  value={currentPresetIndex !== -1 ? currentPresetIndex : -1}
                  onChange={(e) => handlePresetSelect(Number(e.target.value))}
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

          {/* Section 4: ESP32 Smart Hardware Configuration */}
          <div className="calm-card" id="esp32" data-testid="section-esp32-settings">
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div>
                <h2 className="section-title-clean">{tx(l, 'esp32SectionTitle')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'esp32SectionSub')}</p>
              </div>
              <Cpu size={22} color="#1b4332" />
            </div>

            <form onSubmit={handleSaveHardwareSettings} data-testid="form-esp32-settings">
              <div className="form-fields-grid">
                <div className="form-control">
                  <label htmlFor="esp32-url">{tx(l, 'esp32DeviceAddress')}</label>
                  <input
                    id="esp32-url"
                    type="text"
                    value={esp32UrlInput}
                    onChange={(e) => setEsp32UrlInput(e.target.value)}
                    placeholder="http://192.168.4.1"
                    required
                    data-testid="input-esp32-url"
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                    Enter the local IP address or hostname of your ESP32 device on the Wi-Fi network.
                  </span>
                </div>

                <div className="form-control">
                  <label htmlFor="esp32-mode">{tx(l, 'esp32ConnectionMode')}</label>
                  <select
                    id="esp32-mode"
                    value={esp32ModeInput}
                    onChange={(e) => setEsp32ModeInput(e.target.value as 'proxy' | 'direct')}
                    data-testid="select-esp32-mode"
                  >
                    <option value="proxy">{tx(l, 'esp32ProxyMode')}</option>
                    <option value="direct">{tx(l, 'esp32DirectMode')}</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                    {esp32ModeInput === 'proxy'
                      ? 'Routes requests through AquaWise backend to eliminate HTTPS mixed-content & CORS blocking.'
                      : 'Direct HTTP connection from browser to ESP32 (requires plain HTTP and CORS enabled on device).'}
                  </span>
                </div>
              </div>

              {testStatusFeedback && (
                <div
                  className={`alert-banner ${testStatusFeedback.success ? 'info' : 'error'}`}
                  style={{ marginTop: 14 }}
                  role="status"
                >
                  {testStatusFeedback.success ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <div style={{ flex: 1 }}>
                    <strong>{testStatusFeedback.message}</strong>
                    {testStatusFeedback.success && (
                      <div style={{ fontSize: 11, marginTop: 3 }}>
                        Device: {testStatusFeedback.device} · Latency: {testStatusFeedback.latencyMs}ms · Uptime: {testStatusFeedback.uptime}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="button-save-esp32-settings"
                >
                  <Check size={16} />
                  <span>{tx(l, 'saveSettings')}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleTestConnection}
                  disabled={testTesting}
                  data-testid="button-test-esp32-connection"
                >
                  {testTesting ? <LoaderCircle size={16} className="animate-spin" /> : <Radio size={16} />}
                  <span>{testTesting ? tx(l, 'loading') : tx(l, 'esp32TestConnection')}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Section 5: Guided Field Setup & Soil Calibration */}
          <div className="calm-card" id="calibration">
            <div className="section-header">
              <div>
                <h2 className="section-title-clean">{tx(l, 'fieldSetupSection')}</h2>
                <p className="section-subtitle-clean">{tx(l, 'calibrateSub')}</p>
              </div>
              <SlidersHorizontal size={20} color="#1b4332" />
            </div>

            <form onSubmit={handleCalibSubmit} data-testid="form-calibration">
              {/* Crop Type & Assumed Soil Type (Informational input) */}
              <div className="form-fields-grid" style={{ marginBottom: 16 }}>
                <div className="form-control">
                  <label htmlFor="crop-type">{tx(l, 'cropType')}</label>
                  <select
                    id="crop-type"
                    value={selectedCrop}
                    onChange={(e) => {
                      setSelectedCrop(e.target.value);
                      try {
                        localStorage.setItem('aquawise_crop_type', e.target.value);
                      } catch {
                        // ignore storage errors
                      }
                    }}
                    data-testid="select-crop-type"
                  >
                    {CROPS.map((crop) => (
                      <option key={crop.id} value={crop.id}>
                        {crop.labels[l] || crop.labels.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-control">
                  <label htmlFor="assumed-soil-type">{tx(l, 'assumedSoilType')}</label>
                  <input
                    id="assumed-soil-type"
                    type="text"
                    readOnly
                    value={assumedSoilText}
                    data-testid="input-assumed-soil-type"
                    style={{ backgroundColor: 'var(--surface-muted, #f8fafc)', cursor: 'default' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-subtle, #64748b)', marginTop: 4 }}>
                    {tx(l, 'soilAssumptionNote')}
                  </span>
                </div>
              </div>

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

                <div style={{ marginTop: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                    {tx(l, 'useTest')} (10 Scenarios)
                  </label>
                  <div className="scenario-preset-grid">
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('dry_no_rain')}
                      data-testid="button-scenario-dry-no-rain"
                    >
                      {tx(l, 'scenarioDryNoRain')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('dry_rain_soon')}
                      data-testid="button-scenario-dry-rain-soon"
                    >
                      {tx(l, 'scenarioDryRainSoon')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('rain_now')}
                      data-testid="button-scenario-rain-now"
                    >
                      {tx(l, 'scenarioRainNow')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('adequate')}
                      data-testid="button-scenario-adequate"
                    >
                      {tx(l, 'scenarioAdequate')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('dry_later')}
                      data-testid="button-scenario-dry-later"
                    >
                      {tx(l, 'scenarioDryLater')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('weather_stale')}
                      data-testid="button-scenario-weather-stale"
                    >
                      {tx(l, 'scenarioWeatherStale')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('weather_unavailable')}
                      data-testid="button-scenario-weather-unavailable"
                    >
                      {tx(l, 'scenarioWeatherUnavailable')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('sensor_fault')}
                      data-testid="button-scenario-sensor-fault"
                    >
                      {tx(l, 'scenarioSensorFault')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('active_watering')}
                      data-testid="button-scenario-active-watering"
                    >
                      {tx(l, 'scenarioActiveWatering')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={scenario.isPending || !form.testMode}
                      onClick={() => applyScenarioPreset('target_reached')}
                      data-testid="button-scenario-target-reached"
                    >
                      {tx(l, 'scenarioTargetReached')}
                    </button>
                  </div>
                </div>

                <div className="test-actions-grid" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-danger btn-small"
                    disabled={reset.isPending}
                    onClick={resetAll}
                    data-testid="button-reset-field"
                    style={{ width: '100%' }}
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
