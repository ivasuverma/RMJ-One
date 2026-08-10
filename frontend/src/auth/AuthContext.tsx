import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, saveToken, clearToken, getToken } from '@/src/api/client';

export type User = {
  id: string;
  username: string;
  name: string;
  role: 'owner' | 'admin' | 'accountant' | 'employee';
  employee_code?: string;
  designation?: string;
  department?: string;
  photo?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  loginOwner: (username: string, password: string) => Promise<void>;
  loginEmployee: (employee_code: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateMyAccount: (currentPassword: string, newUsername?: string, newPassword?: string) => Promise<void>;
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

  const loginOwner = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login', { username, password }, false,
    );
    await saveToken(res.access_token);
    setUser(res.user);
  }, []);

  const loginEmployee = useCallback(async (employee_code: string, pin: string) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/employee-login', { employee_code, pin }, false,
    );
    await saveToken(res.access_token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  const updateMyAccount = useCallback(async (currentPassword: string, newUsername?: string, newPassword?: string) => {
    const res = await api.put<{ access_token: string; user: User }>('/auth/me', {
      current_password: currentPassword,
      new_username: newUsername || undefined,
      new_password: newPassword || undefined,
    });
    await saveToken(res.access_token);
    setUser(res.user);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, loginOwner, loginEmployee, logout, refresh, updateMyAccount }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
