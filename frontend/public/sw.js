// Minimal PWA service worker — network-first, no caching for live telemetry
const CACHE_NAME = 'f1-telemetry-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json'
];

// Install: cache only critical static assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  return self.clients.claim();
});

// Fetch: STRICT NETWORK-FIRST — never cache API/WebSocket requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // PASS-THROUGH: never intercept WebSocket, API, or dynamic requests
  if (
    request.method !== 'GET' ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/') ||
    url.hostname !== self.location.hostname
  ) {
    return; // Let browser handle natively
  }

  // Network-first for everything else (static assets fall back to cache)
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful GET responses for same-origin static assets
        if (response.ok && url.hostname === self.location.hostname) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clonedResponse));
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache only if network fails
        return caches.match(request).then((cachedResponse) => cachedResponse || Response.error());
      })
  );
});
