import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { api, saveToken, clearToken, getToken, isSessionOnly, setUnauthorizedHandler } from '@/src/api/client';
import { isQuickUnlockEnabled, runQuickUnlock } from '@/src/utils/quickUnlock';

export type User = {
  id: string;
  username: string;
  name: string;
  role: 'owner' | 'admin' | 'accountant' | 'employee';
  employee_code?: string;
  designation?: string;
  department?: string;
  photo?: string;
  modules?: string[];
  // Employee-only: true right after an admin creates the account, until they
  // set a real password — the default (last 4 digits of employee code) is
  // predictable. Gates entry to the employee tabs; see set-password.tsx.
  must_change_password?: boolean;
  // Employee-only: per-module edit/delete rights on the modules an owner has
  // assigned them (repairs/tasks/approvals). Owner/admin/accountant accounts
  // don't carry this — they're never subject to it.
  module_rights?: Record<string, { edit?: boolean; delete?: boolean }>;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  // True when a valid session exists on this device but the user hasn't passed
  // the biometric quick-unlock gate yet. The app is held behind a lock screen
  // while this is set.
  locked: boolean;
  unlock: () => Promise<{ ok: boolean; reason?: string }>;
  cancelQuickUnlock: () => Promise<void>;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  loginOwner: (username: string, password: string, remember?: boolean) => Promise<void>;
  loginEmployee: (username: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateMyAccount: (currentPassword: string, newUsername?: string, newPassword?: string, newName?: string) => Promise<void>;
  hasModule: (key: string) => boolean;
  hasRight: (key: string, right: 'edit' | 'delete') => boolean;
};

const AuthCtx = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const router = useRouter();

  // Single global point for "your session is no longer valid" — fired by
  // api/client.ts whenever an authenticated request comes back 401 (token
  // expired, or the backend was redeployed with a new JWT_SECRET). Without
  // this, screens each got a raw 401 and handled it (or didn't) on their
  // own, so behavior varied screen to screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setLocked(false);
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) { setUser(null); return; }
      const me = await api.get<User>('/auth/me');
      setUser(me);
    } catch (_e) {
      await clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      // If a valid session survived on this device and the user turned on quick
      // unlock, hold the app behind the biometric gate until they pass it. Only
      // gate when refresh() kept the token (i.e. the session is still valid).
      try {
        const token = await getToken();
        if (token && (await isQuickUnlockEnabled())) setLocked(true);
      } catch { /* ignore — fall through unlocked */ }
      setLoading(false);
    })();
  }, [refresh]);

  const unlock = useCallback(async () => {
    const res = await runQuickUnlock();
    if (res.ok) setLocked(false);
    return res;
  }, []);

  // "Use password instead" from the lock screen — drop the stored session and
  // send them through the normal login. Enrollment stays so they can re-enable
  // quick unlock later without re-registering, unless they disable it.
  const cancelQuickUnlock = useCallback(async () => {
    await clearToken();
    setUser(null);
    setLocked(false);
    router.replace('/login');
  }, [router]);

  const login = useCallback(async (username: string, password: string, remember: boolean = true) => {
    // One sign-in for everyone — owner, admin, accountant, or employee.
    // The backend checks both account stores and returns whichever matches.
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login-unified', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setLocked(false);
    setUser(res.user);
  }, []);

  const loginOwner = useCallback(async (username: string, password: string, remember: boolean = true) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setLocked(false);
    setUser(res.user);
  }, []);

  const loginEmployee = useCallback(async (username: string, password: string, remember: boolean = true) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/employee-login', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setLocked(false);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setLocked(false);
    setUser(null);
  }, []);

  const updateMyAccount = useCallback(async (currentPassword: string, newUsername?: string, newPassword?: string, newName?: string) => {
    // Re-save the fresh token the same way the current one is stored — a
    // session-only ("don't remember me") login shouldn't silently become
    // persistent just because the password changed.
    const remember = !(await isSessionOnly());
    const res = await api.put<{ access_token: string; user: User }>('/auth/me', {
      current_password: currentPassword,
      new_username: newUsername || undefined,
      new_password: newPassword || undefined,
      new_name: newName || undefined,
    });
    await saveToken(res.access_token, remember);
    setUser(res.user);
  }, []);

  // Auto sign-out after a configurable stretch of inactivity. The owner sets
  // the number of minutes in Settings › Security (0 = never). Idle is detected
  // from DOM activity (web export), and re-armed on every interaction.
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let minutes = 0;
    let cancelled = false;
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange'];
    const doLogout = () => { logout().finally(() => router.replace('/login')); };
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (minutes > 0) timer = setTimeout(doLogout, minutes * 60 * 1000);
    };
    const onActivity = () => arm();
    api.get<{ auto_signout_minutes: number }>('/settings/security')
      .then((s) => {
        if (cancelled) return;
        minutes = Number(s?.auto_signout_minutes) || 0;
        if (minutes <= 0) return;
        if (typeof document !== 'undefined') {
          events.forEach((e) => document.addEventListener(e, onActivity, { passive: true } as any));
        }
        arm();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        events.forEach((e) => document.removeEventListener(e, onActivity));
      }
    };
  }, [uid, logout, router]);

  const hasModule = useCallback((key: string) => !!user?.modules?.includes(key), [user]);
  // Owner/admin/accountant have no module_rights concept — the backend never
  // gates them on it, so treat them as always-rights-on here too. For an
  // employee, edit/delete must be explicitly granted per module.
  const hasRight = useCallback((key: string, right: 'edit' | 'delete') => {
    if (!user) return false;
    if (user.role !== 'employee') return true;
    return !!user.module_rights?.[key]?.[right];
  }, [user]);

  return (
    <AuthCtx.Provider value={{ user, loading, locked, unlock, cancelQuickUnlock, login, loginOwner, loginEmployee, logout, refresh, updateMyAccount, hasModule, hasRight }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
