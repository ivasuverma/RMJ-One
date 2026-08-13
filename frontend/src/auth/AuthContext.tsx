import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, saveToken, clearToken, getToken, isSessionOnly } from '@/src/api/client';

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
  // Employee-only: per-module edit/delete rights on the modules an owner has
  // assigned them (repairs/tasks/approvals). Owner/admin/accountant accounts
  // don't carry this — they're never subject to it.
  module_rights?: Record<string, { edit?: boolean; delete?: boolean }>;
};

type AuthState = {
  user: User | null;
  loading: boolean;
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
    (async () => { await refresh(); setLoading(false); })();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string, remember: boolean = true) => {
    // One sign-in for everyone — owner, admin, accountant, or employee.
    // The backend checks both account stores and returns whichever matches.
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login-unified', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setUser(res.user);
  }, []);

  const loginOwner = useCallback(async (username: string, password: string, remember: boolean = true) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setUser(res.user);
  }, []);

  const loginEmployee = useCallback(async (username: string, password: string, remember: boolean = true) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/employee-login', { username, password }, false,
    );
    await saveToken(res.access_token, remember);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
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
    <AuthCtx.Provider value={{ user, loading, login, loginOwner, loginEmployee, logout, refresh, updateMyAccount, hasModule, hasRight }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
