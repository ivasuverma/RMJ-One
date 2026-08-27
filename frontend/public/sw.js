/* RMJ One service worker.
 *
 * Scope, deliberately minimal for a live business app: browser push
 * notifications only. It does NOT cache the app shell or assets.
 *
 * Why no caching: with frequent deploys, a cached HTML shell can end up
 * pointing at content-hashed JS chunks that a newer deploy has replaced. The
 * old chunks 404, and the app hangs on a blank screen. For a shop that's
 * always online this offline-cache buys little and risks a lot, so we let the
 * browser fetch everything fresh and keep the worker to push only.
 *
 * On activate we purge every old cache this worker ever created, so any device
 * still holding a stale bundle heals itself the next time it loads.
 */
const CACHE_VERSION = 'rmj-one-v2-nocache';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {}),
  );
});

// No fetch handler: the browser handles all requests directly, always fresh.

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
