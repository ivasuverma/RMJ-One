import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, saveToken, clearToken, getToken } from '@/src/api/client';

export type User = { id: string; username: string; name: string; role: 'owner' | 'employee' };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const me = await api.get<User>('/auth/me');
          setUser(me);
        }
      } catch (_e) {
        await clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>(
      '/auth/login',
      { username, password },
      false,
    );
    await saveToken(res.access_token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  return <AuthCtx.Provider value={{ user, loading, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
