const common = {
  dash: 'Home',
  analytics: 'Insights',
  calibration: 'Calibration',
  history: 'History',
  settings: 'Settings',
  field: 'Active field',
  simulated: 'Simulated',
  connected: 'Connected',
  offline: 'Offline',
  unread: 'new alerts',
  noAlerts: 'No new alerts',
  acknowledge: 'Mark seen',
  loading: 'Loading field data',
  retry: 'Try again',
  dashboard: 'Home',
  alertTitle: 'Field alerts',
  fieldName: 'North plot',
  area: '0.8 ha',
  footer: 'Advice that keeps the field in your hands.'
} as const;

const page = {
  allSet: "You're all set",
  waterNowTitle: 'Water now',
  checkFieldTitle: 'Check your field',
  viewInsights: 'View insights',
  viewForecast: 'View forecast',
  activeSession: 'Watering in progress',
  stopWatering: 'Stop watering',
  soilMoistureLabel: 'Soil moisture',
  temperatureLabel: 'Temperature',
  upcomingRainLabel: 'Upcoming rain',
  soundReadout: 'Listen',
  testingSection: 'Simulation & Testing',
  fieldSetupSection: 'Field setup & calibration',
  irrigationSection: 'Irrigation rules',
  preferencesSection: 'Preferences',
  strategyFixed: 'Fixed schedule', strategyMoisture: 'Moisture threshold', strategyRainAware: 'Rain-aware threshold', strategyOptimized: 'Optimized schedule',
  cachedForecast: 'Cached forecast', weatherRainNow: 'Rain now', weatherRainLikely: 'Rain likely within 6 hours', weatherRainChance: 'A chance of rain', weatherMostlyDry: 'Mostly dry for the next 6 hours', weatherTest: 'Test scenario override', weatherFallback: 'Weather unavailable; using a labelled local simulation',
  readAloud: 'Read decision aloud', voiceUnavailable: 'Speech readout is not supported in this browser.', voiceMissing: 'No matching voice is available on this device. Read the text on screen.', voiceError: 'Could not start speech readout.', dryCapture: 'Use current reading as dry', wetCapture: 'Use current reading as wet', currentReading: 'Current simulated reading', noReading: 'No current soil reading is available to capture.', overwatering: 'Overwatering estimate', liveForecast: 'Live forecast', fallbackForecast: 'Simulated weather fallback', testForecast: 'Test weather scenario',
  overview: 'FIELD OVERVIEW', dashboardTitle: 'Good morning, your field is ready.', sub: 'A clear next step, grounded in the latest simulated field reading.',

  nextStep: 'YOUR NEXT STEP', reasonFallback: 'The recommendation will appear here when field data is available.', water: 'Start watering', stop: 'Stop watering', session: 'WATERING IN PROGRESS', duration: 'Suggested run', minutes: 'min', confidence: 'confidence', updated: 'Updated', reasons: 'Contributing factors', moisture: 'Soil moisture', threshold: 'Start threshold', target: 'Target', sensor: 'Sensor reading', weather: 'Local weather', rainChance: 'Rain chance · 6h', rain: 'Rain · 6h', humidity: 'Humidity', temperature: 'Air temperature', simulatedNotice: 'Simulated operation', stale: 'Some readings may be out of date. Use your judgement before acting.', noMoisture: 'No soil reading available', noWeather: 'Weather information is not available right now.', loading: 'Reading field conditions…', error: 'We could not load field data.', retry: 'Retry', feedback: 'Was this helpful?', thankFeedback: 'Thank you — your feedback was saved.', useTest: 'Test scenarios', testSub: 'Apply simulated readings to observe how recommendations adapt.', dryScenario: 'Dry soil', rainScenario: 'Rain expected', faultScenario: 'Sensor fault', reset: 'Reset simulation', apply: 'Apply scenario', helpful: 'Helpful', notHelpful: 'Not helpful', source: 'Source', high: 'High', medium: 'Medium', low: 'Low', forecast: 'FIELD TREND', analyticsTitle: 'Why & Forecast', analyticsSub: 'Detailed factors shaping recommendations, moisture forecast and water savings.', observed: 'Observed', predicted: 'Forecast', noHistory: 'No moisture history yet', noForecast: 'No forecast points yet', strategies: 'Watering strategies', litres: 'litres', stress: 'Dry stress', saving: 'Water saved', forecastLabel: 'Forecast outlook', calibrateTitle: 'Soil Moisture Calibration', calibrateSub: 'Set dry and wet reference levels for this software simulation.', dry: 'Dry point', wet: 'Wet point', saveCalibration: 'Save calibration', calibrationSaved: 'Calibration saved.', currentGuide: 'Current operating range', lowThreshold: 'Start watering at', targetMoisture: 'Aim for', calibrationWarning: 'Dry point must be lower than wet point.', historyTitle: 'Activity & History', historySub: 'A transparent chronological record of readings, decisions and irrigation actions.', all: 'All events', reading: 'Readings', recommendation: 'Decisions', irrigation: 'Watering', alert: 'Alerts', feedbackEvents: 'Feedback', noEvents: 'No events in this view yet.', settingsTitle: 'Settings & Field Setup', settingsSub: 'Language, irrigation rules, calibration and test simulation controls.', language: 'Language', english: 'English', telugu: 'తెలుగు', hindi: 'हिन्दी', control: 'Control mode', advisory: 'Advisory only', automatic: 'Automatic control', controlHelp: 'Automatic mode can act only within your saved duration limit.', notifications: 'In-app notifications', notificationsHelp: 'Show field alerts in this app.', quietHours: 'Quiet hours', from: 'From', to: 'To', maxDuration: 'Maximum watering duration', flow: 'Flow rate', location: 'Field location', latitude: 'Latitude', longitude: 'Longitude', testMode: 'Test mode', testHelp: 'All values are simulated. Test mode enables scenario controls.', saveSettings: 'Save settings', settingsSaved: 'Settings saved.', min: 'minutes', perMinute: 'L / minute', savedAt: 'Last saved', loadingSettings: 'Loading saved controls…', settingsError: 'Could not load settings.', operationLimit: 'Uses the current recommendation and your duration limit.', noFactors: 'No explanation factors are available yet.', eventSource: 'Origin', simulatedLabel: 'Simulated', autoLabel: 'Auto', manualLabel: 'Manual', tryAgain: 'Please try again.', resetConfirm: 'Reset the field simulation to its starting state?', calibrating: 'Saving…', savingProgress: 'Saving…', applying: 'Applying…',
} as const;

const dictionary = { ...common, ...page } as const;

export default dictionary;
