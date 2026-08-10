import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const TOKEN_KEY = 'rmj.access_token';

export type ApiError = { status: number; detail: string };

if (!BASE && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn(
    '[api] EXPO_PUBLIC_BACKEND_URL is not set — requests will use a relative URL and ' +
    'almost certainly fail to reach the backend. Set it in frontend/.env and restart ' +
    'with `npx expo start -c` (env vars are inlined at bundle time).',
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(TOKEN_KEY, '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response) {
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw { status: res.status, detail: res.statusText || 'Request failed' } as ApiError;
    return null;
  }
  const parsed = safeJson(text);
  if (!res.ok) {
    const detail = (parsed.ok && (parsed.value?.detail || parsed.value?.message)) || res.statusText || 'Request failed';
    throw { status: res.status, detail: String(detail) } as ApiError;
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

export const api = {
  async post<T>(path: string, body?: any, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) Object.assign(headers, await authHeaders());
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res) as Promise<T>;
  },
  async put<T>(path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle(res) as Promise<T>;
  },
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}/api${path}`, { headers: await authHeaders() });
    return handle(res) as Promise<T>;
  },
  async del<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}/api${path}`, { method: 'DELETE', headers: await authHeaders() });
    return handle(res) as Promise<T>;
  },
};

export async function saveToken(t: string) { await storage.secureSet(TOKEN_KEY, t); }
export async function clearToken() { await storage.secureRemove(TOKEN_KEY); }
export async function getToken() { return storage.secureGet<string>(TOKEN_KEY, ''); }
