const common = {
  dash: 'होम',
  analytics: 'इनसाइट्स',
  calibration: 'मिट्टी अंशांकन',
  history: 'इतिहास',
  settings: 'सेटिंग्स',
  field: 'सक्रिय खेत',
  simulated: 'सिम्युलेटेड',
  connected: 'कनेक्टेड',
  offline: 'ऑफलाइन',
  unread: 'नए अलर्ट',
  noAlerts: 'कोई नया अलर्ट नहीं',
  acknowledge: 'देखा हुआ चिह्नित करें',
  loading: 'खेत का डेटा लोड हो रहा है',
  retry: 'फिर कोशिश करें',
  dashboard: 'होम',
  alertTitle: 'खेत अलर्ट',
  fieldName: 'उत्तर खेत',
  area: '0.8 हेक्टेयर',
  footer: 'सलाह, खेत का फैसला आपके हाथ में रखे।'
} as const;

const page = {
  allSet: 'सब कुछ ठीक है',
  waterNowTitle: 'अभी सिंचाई करें',
  checkFieldTitle: 'खेत की जांच करें',
  viewInsights: 'इनसाइट्स देखें',
  viewForecast: 'पूर्वानुमान देखें',
  activeSession: 'सिंचाई जारी है',
  stopWatering: 'सिंचाई रोकें',
  soilMoistureLabel: 'मिट्टी की नमी',
  temperatureLabel: 'तापमान',
  upcomingRainLabel: 'आगामी बारिश',
  soundReadout: 'सुनें',
  testingSection: 'सिमुलेशन और परीक्षण',
  fieldSetupSection: 'खेत सेटअप और अंशांकन',
  irrigationSection: 'सिंचाई नियम',
  preferencesSection: 'प्राथमिकताएं',
  strategyFixed: 'निश्चित समय-सारणी', strategyMoisture: 'नमी सीमा', strategyRainAware: 'बारिश-सचेत सीमा', strategyOptimized: 'अनुकूलित समय-सारणी',
  cachedForecast: 'सहेजा हुआ पूर्वानुमान', weatherRainNow: 'अभी बारिश', weatherRainLikely: 'अगले 6 घंटे में बारिश की संभावना', weatherRainChance: 'बारिश की संभावना', weatherMostlyDry: 'अगले 6 घंटे मौसम अधिकतर सूखा', weatherTest: 'परीक्षण स्थिति लागू', weatherFallback: 'मौसम उपलब्ध नहीं; चिह्नित सिमुलेशन उपयोग हो रहा है',
  readAloud: 'निर्णय सुनें', voiceUnavailable: 'इस ब्राउज़र में वॉइस सुविधा उपलब्ध नहीं है।', voiceMissing: 'इस डिवाइस पर मेल खाती आवाज़ उपलब्ध नहीं है। स्क्रीन पर दिया पाठ पढ़ें।', voiceError: 'वॉइस पढ़ना शुरू नहीं हो सका।', dryCapture: 'वर्तमान रीडिंग को सूखा मानें', wetCapture: 'वर्तमान रीडिंग को गीला मानें', currentReading: 'वर्तमान सिम्युलेटेड रीडिंग', noReading: 'लेने के लिए मिट्टी की कोई रीडिंग उपलब्ध नहीं है।', overwatering: 'अधिक सिंचाई का अनुमान', liveForecast: 'लाइव मौसम पूर्वानुमान', fallbackForecast: 'सिम्युलेटेड मौसम विकल्प', testForecast: 'परीक्षण मौसम स्थिति',
  overview: 'खेत का अवलोकन', dashboardTitle: 'सुप्रभात, आपका खेत तैयार है।', sub: 'नवीनतम सिम्युलेटेड खेत रीडिंग पर आधारित अगला स्पष्ट कदम।',

  nextStep: 'आपका अगला कदम', reasonFallback: 'खेत का डेटा उपलब्ध होने पर सुझाव यहां दिखाई देगा।', water: 'सिंचाई शुरू करें', stop: 'सिंचाई रोकें', session: 'सिंचाई जारी है', duration: 'सुझाया समय', minutes: 'मिनट', confidence: 'विश्वास', updated: 'अपडेट', reasons: 'कारक', moisture: 'मिट्टी की नमी', threshold: 'शुरुआती सीमा', target: 'लक्ष्य', sensor: 'सेंसर रीडिंग', weather: 'स्थानीय मौसम', rainChance: 'बारिश की संभावना · 6 घंटे', rain: 'बारिश · 6 घंटे', humidity: 'नमी', temperature: 'हवा का तापमान', simulatedNotice: 'सिम्युलेटेड कार्रवाई', stale: 'कुछ रीडिंग पुरानी हो सकती हैं। कार्रवाई से पहले अपना विवेक इस्तेमाल करें।', noMoisture: 'मिट्टी की रीडिंग उपलब्ध नहीं', noWeather: 'मौसम की जानकारी अभी उपलब्ध नहीं है।', loading: 'खेत की स्थिति पढ़ रहे हैं…', error: 'खेत का डेटा लोड नहीं हो सका।', retry: 'फिर कोशिश करें', feedback: 'क्या यह सुझाव उपयोगी था?', thankFeedback: 'धन्यवाद — आपकी प्रतिक्रिया सहेजी गई।', useTest: 'परीक्षण स्थितियां', testSub: 'निर्णय की प्रतिक्रिया देखने के लिए सिम्युलेटेड रीडिंग लागू करें।', dryScenario: 'सूखी मिट्टी', rainScenario: 'बारिश की संभावना', faultScenario: 'सेंसर त्रुटि', reset: 'सिमुलेशन रीसेट करें', apply: 'स्थिति लागू करें', helpful: 'उपयोगी', notHelpful: 'उपयोगी नहीं', source: 'स्रोत', high: 'उच्च', medium: 'मध्यम', low: 'कम', forecast: 'खेत का रुझान', analyticsTitle: 'कारण और पूर्वानुमान', analyticsSub: 'हाल की नमी रीडिंग, निकट भविष्य का पूर्वानुमान और रणनीति अनुमान।', observed: 'देखा गया', predicted: 'पूर्वानुमान', noHistory: 'अभी नमी का इतिहास नहीं', noForecast: 'अभी पूर्वानुमान बिंदु नहीं', strategies: 'सिंचाई रणनीतियां', litres: 'लीटर', stress: 'सूखे का तनाव', saving: 'पानी की बचत', forecastLabel: 'पूर्वानुमान', calibrateTitle: 'मिट्टी नमी अंशांकन', calibrateSub: 'इस सॉफ्टवेयर सिमुलेशन के लिए सूखा और गीला संदर्भ तय करें।', dry: 'सूखा बिंदु', wet: 'गीला बिंदु', saveCalibration: 'अंशांकन सहेजें', calibrationSaved: 'अंशांकन सहेजा गया।', currentGuide: 'वर्तमान संचालन सीमा', lowThreshold: 'सिंचाई शुरू करें', targetMoisture: 'लक्ष्य रखें', calibrationWarning: 'सूखा बिंदु गीले बिंदु से कम होना चाहिए।', historyTitle: 'गतिविधि और इतिहास', historySub: 'रीडिंग, निर्णय और सिंचाई गतिविधियों का पारदर्शी रिकॉर्ड।', all: 'सभी घटनाएं', reading: 'रीडिंग', recommendation: 'निर्णय', irrigation: 'सिंचाई', alert: 'अलर्ट', feedbackEvents: 'प्रतिक्रिया', noEvents: 'इस दृश्य में अभी कोई घटना नहीं।', settingsTitle: 'सेटिंग्स और खेत सेटअप', settingsSub: 'भाषा, सिंचाई सीमा और खेत सिमुलेशन नियंत्रण।', language: 'भाषा', english: 'English', telugu: 'తెలుగు', hindi: 'हिन्दी', control: 'नियंत्रण मोड', advisory: 'केवल सलाह', automatic: 'स्वचालित नियंत्रण', controlHelp: 'स्वचालित मोड केवल आपकी सहेजी गई अवधि सीमा में काम कर सकता है।', notifications: 'ऐप सूचनाएं', notificationsHelp: 'इस ऐप में खेत अलर्ट दिखाएं।', quietHours: 'शांत समय', from: 'से', to: 'तक', maxDuration: 'अधिकतम सिंचाई अवधि', flow: 'जल प्रवाह', location: 'खेत का स्थान', latitude: 'अक्षांश', longitude: 'देशांतर', testMode: 'परीक्षण मोड', testHelp: 'सभी मान सिम्युलेटेड हैं। परीक्षण मोड में स्थिति नियंत्रण उपलब्ध हैं।', saveSettings: 'सेटिंग सहेजें', settingsSaved: 'सेटिंग सहेजी गई।', min: 'मिनट', perMinute: 'ली / मिनट', savedAt: 'अंतिम बार सहेजा', loadingSettings: 'सेटिंग लोड हो रही हैं…', settingsError: 'सेटिंग लोड नहीं हो सकीं।', operationLimit: 'वर्तमान सुझाव और आपकी अवधि सीमा का उपयोग करता है।', noFactors: 'अभी कोई व्याख्या कारक उपलब्ध नहीं।', eventSource: 'स्रोत', simulatedLabel: 'सिम्युलेटेड', autoLabel: 'स्वचालित', manualLabel: 'मैनुअल', tryAgain: 'कृपया फिर कोशिश करें।', resetConfirm: 'खेत सिमुलेशन को शुरुआती स्थिति में रीसेट करें?', calibrating: 'सहेज रहा है…', savingProgress: 'सहेज रहा है…', applying: 'लागू कर रहा है…',
} as const;

const dictionary = { ...common, ...page } as const;

export default dictionary;
