import { useEffect, useState } from 'react';
import { useAquaWise, tr } from '@/App';
import { useGetVapidPublicKey, getGetNotificationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, AlertCircle, Send, ShieldAlert, LoaderCircle } from 'lucide-react';

const DEVICE_TOKEN_KEY = 'aquawise_device_token';

function getOrCreateDeviceToken(): string {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function WebPushSettings() {
  const { lang, notify } = useAquaWise();
  const queryClient = useQueryClient();
  const vapid = useGetVapidPublicKey();

  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    isSupported ? Notification.permission : 'unsupported'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Check current browser subscription status
  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setIsSubscribed(Boolean(sub));
      })
      .catch((err) => {
        console.warn('Error reading push subscription:', err);
      });
  }, [isSupported]);

  const handleTogglePush = async () => {
    if (!isSupported) {
      notify(tr(lang, 'pushUnsupported'));
      return;
    }

    setErrorMsg('');
    setLoading(true);

    try {
      if (isSubscribed) {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          const deviceToken = getOrCreateDeviceToken();

          try {
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint, deviceToken }),
            });
          } catch (e) {
            console.warn('Backend unsubscribe failed:', e);
          }
        }
        setIsSubscribed(false);
        notify(tr(lang, 'pushNotSubscribed'));
      } else {
        // Check VAPID availability
        if (!vapid.data?.enabled || !vapid.data.publicKey) {
          throw new Error(tr(lang, 'pushMissingKey'));
        }

        // Request permission
        const permResult = await Notification.requestPermission();
        setPermission(permResult);

        if (permResult === 'denied') {
          throw new Error(tr(lang, 'pushBlockedTip'));
        }
        if (permResult !== 'granted') {
          setLoading(false);
          return;
        }

        // Subscribe through PushManager
        const reg = await navigator.serviceWorker.ready;
        const appServerKey = urlBase64ToUint8Array(vapid.data.publicKey);
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey as unknown as BufferSource,
        });

        const subJson = sub.toJSON();
        const p256dh = subJson.keys?.p256dh;
        const auth = subJson.keys?.auth;

        if (!p256dh || !auth) {
          throw new Error('Failed to retrieve push encryption keys from browser.');
        }

        const deviceToken = getOrCreateDeviceToken();
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: { p256dh, auth },
            userAgent: navigator.userAgent,
            deviceToken,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to register subscription with server.');
        }

        setIsSubscribed(true);
        notify(tr(lang, 'pushSubscribed'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push subscription failed';
      setErrorMsg(msg);
      notify(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestPush = async () => {
    setTestSending(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Test push request failed');
      }
      void queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
      notify(tr(lang, 'pushTestSuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not trigger test alert';
      setErrorMsg(msg);
      notify(msg);
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div className="web-push-settings-card" style={{ marginTop: 16, padding: '16px 18px', background: '#f8fafc', borderRadius: 8, border: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-main)' }}>
            <Bell size={16} />
            <span>{tr(lang, 'pushNotifications')}</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 600,
                background: !isSupported
                  ? '#fee2e2'
                  : permission === 'denied'
                  ? '#fee2e2'
                  : isSubscribed
                  ? '#dcfce7'
                  : '#f1f5f9',
                color: !isSupported
                  ? '#991b1b'
                  : permission === 'denied'
                  ? '#991b1b'
                  : isSubscribed
                  ? '#166534'
                  : '#64748b',
              }}
            >
              {!isSupported
                ? tr(lang, 'pushUnsupported')
                : permission === 'denied'
                ? tr(lang, 'pushBlocked')
                : isSubscribed
                ? tr(lang, 'pushSubscribed')
                : tr(lang, 'pushNotSubscribed')}
            </span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
            {tr(lang, 'pushNotificationsHelp')}
          </div>

          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626', marginTop: 8 }}>
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {permission === 'denied' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#b91c1c', marginTop: 6 }}>
              <ShieldAlert size={14} />
              <span>{tr(lang, 'pushBlockedTip')}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!isSupported || loading || (permission === 'denied' && !isSubscribed)}
            onClick={handleTogglePush}
            data-testid="button-toggle-push"
            style={{ fontSize: 12, padding: '7px 12px', minHeight: 34, gap: 6 }}
          >
            {loading ? (
              <LoaderCircle size={14} className="spin" />
            ) : isSubscribed ? (
              <CheckCircle2 size={14} style={{ color: '#16a34a' }} />
            ) : null}
            <span>{isSubscribed ? tr(lang, 'disablePush') : tr(lang, 'enablePush')}</span>
          </button>

          {isSubscribed && (
            <button
              type="button"
              className="text-button"
              disabled={testSending}
              onClick={handleSendTestPush}
              data-testid="button-test-push"
              style={{ fontSize: 11, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {testSending ? <LoaderCircle size={12} className="spin" /> : <Send size={12} />}
              <span>{testSending ? tr(lang, 'testingPush') : tr(lang, 'testPush')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
