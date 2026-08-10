import { Platform } from 'react-native';
import { api } from '@/src/api/client';

/**
 * Browser push notifications (web only). Native push (Android/iOS app installs)
 * is a separate system and isn't wired up — this covers the "open the site in
 * your phone browser, allow notifications" flow.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob !== 'undefined' ? atob(base64) : '';
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPushPermission(): PushPermission {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission as PushPermission;
}

export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: 'Not supported in this browser' };
  try {
    const { publicKey, enabled } = await api.get<{ publicKey: string; enabled: boolean }>(
      '/notifications/vapid-public-key',
    );
    if (!enabled || !publicKey) {
      return { ok: false, reason: 'Push isn’t configured on the server yet' };
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: permission === 'denied' ? 'Notifications blocked in browser settings' : 'Permission not granted' };
    }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    await api.post('/notifications/subscribe', sub.toJSON());
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.detail || e?.message || 'Could not enable notifications' };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    // best-effort
  }
}
