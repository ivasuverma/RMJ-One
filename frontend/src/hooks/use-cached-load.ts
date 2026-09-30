import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { storage } from '@/src/utils/storage';

/**
 * Stale-while-revalidate for a screen's data: the last copy saved on this device
 * is shown the moment the screen opens, then fresh data is fetched in the
 * background and swapped in — so the screen never sits blank on a spinner once
 * it has loaded once. Refreshes on focus, on `refresh()` (pull to refresh), and
 * every `intervalMs` while the screen is focused and the app is in front.
 *
 * `key` should include the user id so one person never sees another's copy.
 */
export function useCachedLoad<T>(key: string | null, loader: (fresh: boolean) => Promise<T>, intervalMs = 60000) {
  const [data, setData] = useState<T | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);   // when the shown copy was saved (null = live)
  const [loading, setLoading] = useState(false);                   // a fetch is in flight
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const inFlight = useRef(false);
  const again = useRef<boolean | null>(null);   // a run asked for while one was in flight
  const hasData = useRef(false);

  // Paint the saved copy first.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    storage.getItem<string | null>(key, null).then((raw) => {
      if (!alive || !raw || hasData.current) return;
      try {
        const saved = JSON.parse(raw) as { at: number; data: T };
        setData(saved.data); setCachedAt(saved.at); hasData.current = true;
      } catch { /* ignore a bad copy */ }
    });
    return () => { alive = false; };
  }, [key]);

  const run = useCallback(async (fresh = false) => {
    if (!key) return;
    if (inFlight.current) { again.current = (again.current ?? false) || fresh; return; }
    inFlight.current = true; setLoading(true);
    try {
      const d = await loaderRef.current(fresh);
      setData(d); setCachedAt(null); setError(null); hasData.current = true;
      storage.setItem(key, JSON.stringify({ at: Date.now(), data: d }));
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not refresh');
    } finally {
      inFlight.current = false; setLoading(false);
    }
    // Something changed mid-fetch (e.g. just punched in) — fetch once more so it shows.
    if (again.current !== null) { const f = again.current; again.current = null; await run(f); }
  }, [key]);

  // On focus: refresh now, then every intervalMs while focused and the app is in front.
  useFocusEffect(useCallback(() => {
    run();
    const t = setInterval(() => { if (AppState.currentState === 'active') run(); }, intervalMs);
    return () => clearInterval(t);
  }, [run, intervalMs]));

  return { data, cachedAt, loading, error, refresh: () => run(true), reload: () => run(false) };
}
