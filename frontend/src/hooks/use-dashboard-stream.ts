import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, getToken } from '@/src/api/client';

// Live dashboard via SSE (GET /api/dashboard/stream), with a polling fallback.
// The native EventSource can't send an Authorization header, so we use a
// fetch-based reader instead and pass the Bearer token in the header (never as
// a query param). Web supports response body streaming; React Native fetch
// does not expose a ReadableStream, so on native (and on any stream error) we
// fall back to plain polling of GET /dashboard with backoff. Either way the
// hook exposes the same shape, and `connected` reflects the *real* transport
// state so the "Live" pill can tell the truth.
export function useDashboardStream<T = any>(pollMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState('');

  const stopped = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(2000);

  const clearTimers = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
  };

  const poll = useCallback(async () => {
    try {
      const res = await api.get<T>('/dashboard');
      if (stopped.current) return;
      setData(res); setLastUpdated(new Date()); setError('');
    } catch (e: any) {
      if (!stopped.current) setError(e?.detail || 'Failed to load');
    } finally {
      if (!stopped.current) pollRef.current = setTimeout(poll, pollMs);
    }
  }, [pollMs]);

  // One-off immediate refresh (pull-to-refresh, or right after an inline
  // approve/reject) — the stream would catch up within ~5s anyway, but this
  // makes the change feel instant.
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<T>('/dashboard');
      if (!stopped.current) { setData(res); setLastUpdated(new Date()); setError(''); }
    } catch { /* stream/poll will retry */ }
  }, []);

  const startStream = useCallback(async () => {
    // Streaming reader only exists on web fetch; anywhere else, just poll.
    if (Platform.OS !== 'web') { setConnected(false); poll(); return; }

    const token = (await getToken()) || '';
    const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${base}/api/dashboard/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      const body: any = (res as any).body;
      if (!res.ok || !body || typeof body.getReader !== 'function') {
        throw new Error('stream unsupported');
      }
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      setConnected(true);
      backoff.current = 2000;

      // Parse the SSE frame stream: events are separated by a blank line, and
      // the payload lines start with "data: ". Comment lines (": keepalive")
      // are ignored but keep the socket warm.
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped.current) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            setData(JSON.parse(line.slice(5).trim()));
            setLastUpdated(new Date());
            setError('');
          } catch { /* ignore a malformed frame */ }
        }
      }
      throw new Error('stream ended');
    } catch (e: any) {
      if (stopped.current || e?.name === 'AbortError') return;
      // Lost the stream — mark disconnected, do one immediate poll so the data
      // stays fresh, then retry the stream with capped exponential backoff.
      setConnected(false);
      poll();
      const wait = Math.min(backoff.current, 30000);
      backoff.current = wait * 2;
      pollRef.current = setTimeout(() => { if (!stopped.current) startStream(); }, wait);
    }
  }, [poll]);

  useEffect(() => {
    stopped.current = false;
    startStream();
    return () => { stopped.current = true; clearTimers(); };
  }, [startStream]);

  return { data, connected, lastUpdated, error, refresh };
}
