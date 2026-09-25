import { useSyncExternalStore } from 'react';
import { storage } from '@/src/utils/storage';

// Glass bar settings (Settings › Glass bar) — how strongly the bottom tab bar
// blurs what's behind it, and how much tint sits on the glass. Per device,
// like Appearance. GlassTabBar reads them live.
export type Glass = { blur: number; tint: number };   // blur in px (0 = clear glass), tint in %
export const GLASS_DEFAULT: Glass = { blur: 22, tint: 40 };
export const BLUR_RANGE = { min: 0, max: 40, step: 2 };
export const TINT_RANGE = { min: 0, max: 90, step: 5 };
const KEY = 'rmj.glass';

let state: Glass = GLASS_DEFAULT;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

storage.getItem<string | null>(KEY, null).then((v) => {
  try {
    const g = v ? JSON.parse(v) : null;
    if (g && typeof g.blur === 'number' && typeof g.tint === 'number') { state = { blur: g.blur, tint: g.tint }; emit(); }
  } catch { /* keep defaults */ }
});

export function setGlass(patch: Partial<Glass>) {
  state = { ...state, ...patch };
  storage.setItem(KEY, JSON.stringify(state));
  emit();
}

export function useGlass(): Glass {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
    () => state,
  );
}
