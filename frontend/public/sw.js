/* RMJ One service worker.
 *
 * Two jobs: (1) browser push notifications (unchanged), and (2) a conservative
 * offline-tolerance cache so the shop keeps working through a brief ISP blip.
 *
 * Caching rules, deliberately cautious for a live business app:
 *   - /api/**            → NEVER cached. Always network. Business data must be
 *                          fresh; a stale cached balance would be dangerous.
 *   - navigations (HTML) → network-first, fall back to the cached app shell
 *                          when offline (so the app still opens on a blip).
 *   - other same-origin  → cache-first with background refresh. The web export's
 *     static assets        asset filenames are content-hashed, so a new deploy
 *                          produces new names and can't be served stale.
 *   - cross-origin (CDN) → left to the browser; not touched here.
 *
 * Bump CACHE_VERSION to force old caches out on the next activate.
 */
const CACHE_VERSION = 'rmj-one-v1';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(SHELL_URL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only manage same-origin GETs. Never touch the API — business data is
  // always fetched live, never served from cache.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // App navigations: try the network first (so a new deploy is picked up),
  // fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((c) => c || Response.error())),
    );
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

/* ---------------- Push notifications (unchanged) ---------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'RMJ One', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'RMJ One';
  const options = {
    body: data.body || '',
    tag: data.tag || 'rmj-one',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
