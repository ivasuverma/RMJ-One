import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { storage } from '@/src/utils/storage';
import { darkColors, lightColors, ThemeColors } from './palettes';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

const PREF_KEY = 'rmj.theme_preference';

type ThemeState = {
  colors: ThemeColors;
  scheme: ResolvedScheme;
  preference: ThemePreference;
  setPreference: (mode: ThemePreference) => void;
};

const ThemeCtx = createContext<ThemeState>({
  colors: darkColors,
  scheme: 'dark',
  preference: 'system',
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Follows the OS/browser `prefers-color-scheme` by default (react-native-web
  // reads this via matchMedia). Falls back to the dark "Emerald vault" palette
  // when the platform reports no preference at all.
  const systemScheme = useColorScheme();
  // Defaults to the signature dark look (the v2 design comp is dark-first);
  // users can still switch to light or follow the system in Settings.
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');

  useEffect(() => {
    storage.getItem<string>(PREF_KEY, 'system').then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
    });
  }, []);

  const setPreference = useCallback((mode: ThemePreference) => {
    setPreferenceState(mode);
    storage.setItem(PREF_KEY, mode);
  }, []);

  const scheme: ResolvedScheme = preference === 'system'
    ? (systemScheme === 'light' ? 'light' : 'dark')
    : preference;
  const colors = scheme === 'light' ? lightColors : darkColors;

  const value = useMemo(() => ({ colors, scheme, preference, setPreference }), [colors, scheme, preference, setPreference]);

  // Web: the page canvas starts dark (app/+html.tsx) to avoid a white flash;
  // once the theme is known, match it — otherwise any sliver not covered by a
  // screen (overscroll, the Home Screen app's bottom edge) shows as a black band in light mode.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = colors.surface;
    document.body.style.backgroundColor = colors.surface;
  }, [colors.surface]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
