/* RMJ One service worker.
 *
 * Push notifications + fast cold starts.
 *
 * Caching strategy — safe because Expo's web export gives every JS/CSS/asset a
 * CONTENT-HASHED filename (a new build = a new URL), so a cached asset can never
 * be "stale": if the code changes, the URL changes.
 *
 *   - Hashed static assets (/_expo/static/**, /assets/**, *.js/*.css) →
 *     CACHE-FIRST. Served instantly on a cold start; fetched + cached on first
 *     miss. This is what makes reopening the app after it was killed fast
 *     instead of re-downloading the whole bundle over the shop's connection.
 *   - HTML navigations and the service worker itself → ALWAYS NETWORK (never
 *     cached), so a new deploy is picked up immediately. The fresh HTML points
 *     at the new hashed asset URLs, which then cache on first load.
 *   - API calls (/api/**) and the SSE stream are never touched.
 *
 * On activate we drop caches from older SW versions so a format change heals.
 */
const CACHE_VERSION = 'rmj-one-v3-assets';
const ASSET_CACHE = CACHE_VERSION;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {}),
  );
});

// Only cache-first the immutable, content-hashed assets.
function isHashedAsset(url) {
  return (
    url.pathname.startsWith('/_expo/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Same-origin only; never cache the API, the SSE stream, or HTML navigations.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate' || req.destination === 'document') return;
  if (!isHashedAsset(url)) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok && res.status === 200) { cache.put(req, res.clone()).catch(() => {}); }
          return res;
        });
      }),
    ).catch(() => fetch(req)),
  );
});

/* ---------------- Push notifications ---------------- */
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

// Keep a reference so linters don't flag the version constant as unused; it
// also lets us confirm which worker build is live from DevTools.
self.__RMJ_SW_VERSION = CACHE_VERSION;
