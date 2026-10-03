import { useCallback, useEffect, useState } from 'react';
import { api } from '@/src/api/client';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type PageSrc = { uri: string; headers: Record<string, string> };

/** A document PDF's pages as pictures the server draws (`?page=N`), so the app
 *  can show a PDF right on screen. `pages` is `undefined` while loading and
 *  `null` when the server can't draw it (the screen falls back to Open PDF);
 *  `locked` is true for a password-protected PDF (offer Unlock, then `reload`). */
export function usePdfPages(docId: string | null, token: string): { pages: PageSrc[] | null | undefined; locked: boolean; reload: () => void } {
  const [pages, setPages] = useState<PageSrc[] | null | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setPages(undefined); setLocked(false);
    if (!docId || !token) return;
    let dead = false;
    api.get<{ pages: number | null; locked?: boolean }>(`/documents/${docId}/pages`)
      .then((r) => {
        if (dead) return;
        const n = r.pages || 0;
        setLocked(!!r.locked);
        // `v` makes an unlocked document's pages fresh pictures, not the cached locked ones.
        setPages(n ? Array.from({ length: n }, (_, i) => ({
          uri: `${BASE}/api/documents/${docId}/file?page=${i}${version ? `&v=${version}` : ''}`, headers: { Authorization: `Bearer ${token}` },
        })) : null);
      })
      .catch(() => { if (!dead) setPages(null); });
    return () => { dead = true; };
  }, [docId, token, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { pages, locked, reload };
}
