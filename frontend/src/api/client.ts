import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const TOKEN_KEY = 'rmj.access_token';

export type ApiError = { status: number; detail: string };

// Fired once, globally, whenever an *authenticated* request comes back 401 —
// i.e. the token we sent was rejected (expired, or the backend was
// redeployed with a new JWT_SECRET). Registered by AuthContext on mount so
// every screen gets the same "session expired" behavior instead of each one
// independently handling (or not handling) a raw 401 from api.get/post/etc.
// Deliberately NOT fired for unauthenticated calls like login itself — a
// wrong-password 401 on the login screen isn't a session expiry.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

if (!BASE && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn(
    '[api] EXPO_PUBLIC_BACKEND_URL is not set — requests will use a relative URL and ' +
    'almost certainly fail to reach the backend. Set it in frontend/.env and restart ' +
    'with `npx expo start -c` (env vars are inlined at bundle time).',
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response, authed: boolean = true) {
  const text = await res.text();
  if (!text) {
    if (!res.ok) {
      if (res.status === 401 && authed) { await clearToken(); onUnauthorized?.(); }
      throw { status: res.status, detail: res.statusText || 'Request failed' } as ApiError;
    }
    return null;
  }
  const parsed = safeJson(text);
  if (!res.ok) {
    const rawDetail = (parsed.ok && (parsed.value?.detail ?? parsed.value?.message)) ?? res.statusText ?? 'Request failed';
    if (res.status === 401 && authed) { await clearToken(); onUnauthorized?.(); }
    throw { status: res.status, detail: formatDetail(rawDetail) } as ApiError;
  }
  if (!parsed.ok) {
    // A 200 with a body that isn't JSON almost always means the request hit the
    // wrong server — e.g. EXPO_PUBLIC_BACKEND_URL is unset/wrong and something
    // else (often the Expo dev server itself) answered instead of the API.
    // Surfacing this clearly beats silently handing screens a raw HTML string
    // where they expect an object, which used to crash the screen instead.
    throw {
      status: res.status,
      detail: 'Got a non-JSON response from the server. Check EXPO_PUBLIC_BACKEND_URL in frontend/.env points at the backend, then restart with `npx expo start -c`.',
    } as ApiError;
  }
  return parsed.value;
}

function safeJson(t: string): { ok: true; value: any } | { ok: false; value: string } {
  try { return { ok: true, value: JSON.parse(t) }; } catch { return { ok: false, value: t }; }
}

// FastAPI validation errors come back as `detail: [{loc, msg, type}, ...]`.
// Rendering that array with String() gave "[object Object], [object Object]" —
// turn it into a readable "field: message" string instead.
function formatDetail(detail: any): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => {
      if (typeof d === 'string') return d;
      const field = Array.isArray(d?.loc) ? d.loc.filter((p: any) => p !== 'body').join('.') : '';
      const msg = d?.msg || 'invalid';
      return field ? `${field}: ${msg}` : msg;
    }).join('; ') || 'Request failed';
  }
  if (detail && typeof detail === 'object') return detail.msg || detail.message || JSON.stringify(detail);
  return String(detail ?? 'Request failed');
}

export const api = {
  async post<T>(path: string, body?: any, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) Object.assign(headers, await authHeaders());
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res, auth) as Promise<T>;
  },
  async put<T>(path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res, true) as Promise<T>;
  },
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}/api${path}`, { headers: await authHeaders() });
    return handle(res, true) as Promise<T>;
  },
  async del<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}/api${path}`, { method: 'DELETE', headers: await authHeaders() });
    return handle(res, true) as Promise<T>;
  },
  async patch<T>(path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'PATCH', headers, body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res, true) as Promise<T>;
  },
  // Multipart upload — do NOT set Content-Type so the browser adds the correct
  // multipart boundary. Used by the Documents module to POST a captured file.
  // A 90s timeout means a stalled upload fails cleanly instead of spinning
  // forever (e.g. a big photo on a weak connection).
  async upload<T>(path: string, form: FormData): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: await authHeaders(), body: form, signal: ctrl.signal });
      return handle(res, true) as Promise<T>;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw { detail: 'Upload timed out — check your connection and try again.' };
      throw e;
    } finally { clearTimeout(timer); }
  },
};

// `remember=false` (web only) keeps the session in sessionStorage instead of the
// persistent store, so closing the tab/browser logs the user out — useful on a
// shared shop device. Default is persistent ("stay logged in"), matching prior
// behavior. Native builds have no meaningful non-persistent option, so `remember`
// is ignored there.
export async function saveToken(t: string, remember: boolean = true) {
  if (Platform.OS === 'web' && !remember) {
    try { window.sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
    await storage.secureRemove(TOKEN_KEY);
    return;
  }
  if (Platform.OS === 'web') {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }
  await storage.secureSet(TOKEN_KEY, t);
}

// Whether the current session is session-only (i.e. the user did NOT check
// "keep me signed in"). Used when a screen needs to re-save a fresh token
// (e.g. after a password change) without silently upgrading a session-only
// login into a persistent one.
export async function isSessionOnly(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try { return !!window.sessionStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
  }
  return false;
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
  if (Platform.OS === 'web') {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }
}

export async function getToken() {
  if (Platform.OS === 'web') {
    try {
      const s = window.sessionStorage.getItem(TOKEN_KEY);
      if (s) return s;
    } catch { /* ignore */ }
  }
  return storage.secureGet<string>(TOKEN_KEY, '');
}
