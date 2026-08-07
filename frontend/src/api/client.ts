import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const TOKEN_KEY = 'rmj.access_token';

export type ApiError = { status: number; detail: string };

async function authHeaders(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(TOKEN_KEY, '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response) {
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || res.statusText || 'Request failed';
    const err: ApiError = { status: res.status, detail: String(detail) };
    throw err;
  }
  return data;
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return t; }
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
