/**
 * Focus Session - Offline Service Worker
 * Pre-caches shell assets and serves requests via stale-while-revalidate strategy.
 */

const CACHE_NAME = 'focus-session-v2.0.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/state.js',
  './js/worker.js',
  './js/audio.js',
  './js/favicon.js',
  './js/ui.js',
  './icons/favicon.svg'
];

/**
 * Installation: Cache core application assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/**
 * Activation: Purge superseded cache versions
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch interception: Stale-while-revalidate strategy
 */
self.addEventListener('fetch', (event) => {
  // Only intercept same-origin HTTP/HTTPS GET requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);

      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback; cachedResponse handles this if available
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
