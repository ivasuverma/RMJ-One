import { useEffect, useState } from 'react';
import { api } from '@/src/api/client';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

/** A document PDF's pages as pictures the server draws (`?page=N`), so the app
 *  can show a PDF right on screen. `undefined` while loading; `null` when the
 *  server can't draw it (the screen falls back to Open PDF). */
export function usePdfPages(docId: string | null, token: string): { uri: string; headers: Record<string, string> }[] | null | undefined {
  const [pages, setPages] = useState<{ uri: string; headers: Record<string, string> }[] | null | undefined>(undefined);
  useEffect(() => {
    setPages(undefined);
    if (!docId || !token) return;
    let dead = false;
    api.get<{ pages: number | null }>(`/documents/${docId}/pages`)
      .then((r) => {
        if (dead) return;
        const n = r.pages || 0;
        setPages(n ? Array.from({ length: n }, (_, i) => ({
          uri: `${BASE}/api/documents/${docId}/file?page=${i}`, headers: { Authorization: `Bearer ${token}` },
        })) : null);
      })
      .catch(() => { if (!dead) setPages(null); });
    return () => { dead = true; };
  }, [docId, token]);
  return pages;
}
