import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { DashboardPage, AnalyticsPage, CalibrationPage, HistoryPage, SettingsPage } from '@/pages/AquaWise';
import NotFound from '@/pages/not-found';
import { Bell, ChartNoAxesCombined, Droplets, History, Leaf, Settings2 } from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetFieldState, useGetNotifications, useGetSettings, useAcknowledgeNotification, getGetNotificationsQueryKey, getGetFieldStateQueryKey, getGetSettingsQueryKey } from '@workspace/api-client-react';
import type { SettingsLanguage } from '@workspace/api-client-react';
import en from '@/locales/en';
import te from '@/locales/te';
import hi from '@/locales/hi';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
type Language = SettingsLanguage;
type AppCtx = { lang: Language; notify: (message: string) => void; stale: boolean };
const AppContext = createContext<AppCtx>({ lang: 'en', notify: () => undefined, stale: false });
export const useAquaWise = () => useContext(AppContext);

const dictionaries = { en, te, hi };
export const tr = (lang: Language, key: string) => { const selected = dictionaries[lang] as Record<string, string>; const english = dictionaries.en as Record<string, string>; return selected[key] || english[key] || key; };

const navItems = [
  { href: '/', key: 'dash', icon: Leaf },
  { href: '/analytics', key: 'analytics', icon: ChartNoAxesCombined },
  { href: '/history', key: 'history', icon: History },
  { href: '/settings', key: 'settings', icon: Settings2 },
];

function AppShell({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('en');
  const [toast, setToast] = useState('');
  const [stale, setStale] = useState(!navigator.onLine);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [path] = useLocation();
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 60_000 } });
  const field = useGetFieldState({ query: { queryKey: getGetFieldStateQueryKey(), refetchInterval: 30_000 } });
  const notifications = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 45_000 } });
  const acknowledge = useAcknowledgeNotification();
  const unread = notifications.data?.filter((item) => !item.acknowledged) || [];
  useEffect(() => {
    if (settings.data?.language) {
      setLang(settings.data.language);
      document.documentElement.lang = settings.data.language;
    }
  }, [settings.data?.language]);
  useEffect(() => {
    const onOffline = () => setStale(true);
    const onOnline = () => setStale(false);
    const onServiceWorkerMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'aquawise-stale-response') setStale(true);
      if (event.data?.type === 'aquawise-fresh-response') setStale(false);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  const ctx = { lang, notify, stale };
  const isOffline = stale || field.data?.connectionStatus === 'offline' || field.isError;
  return (
    <AppContext.Provider value={ctx}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><span className="brand-mark"><Droplets size={20} /></span><span>AquaWise</span></div>
          <div className="nav-label">{tr(lang, 'field')}</div>
          <nav className="nav-list" aria-label="Primary navigation">
            {navItems.map(({ href, key, icon: Icon }) => <Link key={href} href={href} className={`nav-item ${path === href ? 'active' : ''}`} data-testid={`link-${key}`}><Icon size={18} strokeWidth={1.8} /><span>{tr(lang, key)}</span></Link>)}
          </nav>
          <div className="sidebar-foot"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot" /> {tr(lang, 'simulated')}</div><div style={{ marginTop: 9 }}>{tr(lang, 'footer')}</div></div>
        </aside>
        <div className="main-wrap">
          <header className="topbar">
            <div className="topbar-brand">
              <Link href="/" className="brand-link">
                <span className="brand-dot"><Droplets size={16} strokeWidth={2.2} /></span>
                <span className="brand-name">AquaWise</span>
              </Link>
            </div>
            <div className="top-actions">
              <span className={`connection-chip ${isOffline ? 'offline' : ''}`} data-testid="status-connection">
                <i className="dot" />
                <span>{isOffline ? tr(lang, 'offline') : tr(lang, 'connected')}</span>
              </span>
              <button aria-label={tr(lang, 'alertTitle')} className="icon-btn" onClick={() => setAlertsOpen(!alertsOpen)} data-testid="button-alerts">
                <Bell size={17} strokeWidth={1.8} />
                {unread.length > 0 && <span className="badge-count">{unread.length}</span>}
              </button>
              <Link href="/settings" className="icon-btn" aria-label={tr(lang, 'settings')}>
                <Settings2 size={17} strokeWidth={1.8} />
              </Link>
            </div>
          </header>
          {alertsOpen && <section className="alerts-popover" aria-label={tr(lang, 'alertTitle')}>
            <div className="section-title" style={{ marginBottom: 5 }}><span>{tr(lang, 'alertTitle')}</span><button className="text-button" onClick={() => setAlertsOpen(false)}>×</button></div>
            {notifications.isLoading ? <div className="skeleton" style={{ height: 56 }} /> : notifications.isError ? <div className="subtle">{tr(lang, 'retry')}</div> : unread.length === 0 ? <div className="subtle">{tr(lang, 'noAlerts')}</div> : unread.map((item) => <article className="mini-alert" key={item.id}>
              <Bell size={16} /><div style={{ flex: 1 }}><div className="mini-alert-title">{item.title}</div><div className="mini-alert-detail">{item.detail}</div><button className="text-button" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ notificationId: item.id }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() }); notify(tr(lang, 'acknowledge')); }, onError: () => notify('Could not update alert. Please retry.') })}>{tr(lang, 'acknowledge')}</button></div>
            </article>)}
          </section>}
          {children}
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Primary navigation">
        {navItems.map(({ href, key, icon: Icon }) => <Link key={href} href={href} className={path === href ? 'active' : ''} data-testid={`mobile-link-${key}`}><Icon strokeWidth={1.8} /><span>{tr(lang, key)}</span></Link>)}
      </nav>
      {toast && <div role="status" className="toast-result">{toast}</div>}
    </AppContext.Provider>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <AppShell>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/calibration" component={CalibrationPage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}
export default App;
