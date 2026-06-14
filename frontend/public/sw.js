// Minimal PWA service worker — network-first, no caching for live telemetry
const CACHE_NAME = 'f1-telemetry-v7';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/notification-icon.png',
  '/notification-badge.png',
  '/icon-192.png',
];

function notificationAssets() {
  const origin = self.location.origin;
  return {
    icon: `${origin}/notification-icon.png`,
    badge: `${origin}/notification-badge.png`,
  };
}

function headsUpNotificationOptions() {
  return {
    requireInteraction: false,
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 200],
  };
}

function shouldSuppressQuestionNotification(clientList) {
  return clientList.some((client) => {
    if (!client.url.includes('/game/')) {
      return false;
    }

    const focused = 'focused' in client ? client.focused : false;
    return focused && client.visibilityState === 'visible';
  });
}

function normalizeTargetPath(urlOrPath) {
  if (!urlOrPath || urlOrPath === '/') {
    return '/';
  }

  try {
    const parsed = new URL(urlOrPath, self.location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  }
}

function sameOrigin(client) {
  try {
    return new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function clientPathname(client) {
  try {
    return new URL(client.url).pathname;
  } catch {
    return '';
  }
}

function isAppClient(client) {
  const pathname = clientPathname(client);
  return pathname === '/'
    || pathname.startsWith('/game/')
    || pathname.startsWith('/lobby/');
}

async function focusExistingClient(clientList, targetPath) {
  for (const client of clientList) {
    if (!sameOrigin(client) || !('focus' in client)) {
      continue;
    }

    if (clientPathname(client) === targetPath) {
      return client.focus();
    }
  }

  for (const client of clientList) {
    if (!sameOrigin(client) || !isAppClient(client) || !('focus' in client)) {
      continue;
    }

    if (typeof client.navigate === 'function') {
      await client.navigate(targetPath);
    }

    return client.focus();
  }

  for (const client of clientList) {
    if (!sameOrigin(client) || !('focus' in client)) {
      continue;
    }

    if (typeof client.navigate === 'function') {
      await client.navigate(targetPath);
    }

    return client.focus();
  }

  return undefined;
}

function showQuestionNotification(registration, payload) {
  const path = normalizeTargetPath(payload.path || payload.url || '/');
  const assets = notificationAssets();

  return registration.showNotification(payload.title, {
    body: payload.body,
    icon: assets.icon,
    badge: assets.badge,
    tag: payload.tag,
    data: { path },
    timestamp: Date.now(),
    actions: [
      { action: 'open', title: 'Answer now' },
    ],
    ...headsUpNotificationOptions(),
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

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

self.addEventListener('push', (event) => {
  let payload = {
    title: 'New prediction question!',
    body: 'A new prediction question is live.',
    tag: 'question',
    path: '/',
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // Keep defaults when payload parsing fails.
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (shouldSuppressQuestionNotification(clientList)) {
        return undefined;
      }

      return showQuestionNotification(self.registration, payload);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SHOW_QUESTION_NOTIFICATION') {
    return;
  }

  const payload = {
    title: event.data.title,
    body: event.data.body,
    tag: event.data.tag,
    path: event.data.path,
    url: event.data.url,
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (shouldSuppressQuestionNotification(clientList)) {
        return undefined;
      }

      return showQuestionNotification(self.registration, payload);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = normalizeTargetPath(event.notification.data?.path || event.notification.data?.url || '/');
  const openUrl = new URL(targetPath, self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const focused = await focusExistingClient(clientList, targetPath);
      if (focused) {
        return focused;
      }

      return self.clients.openWindow(openUrl);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET'
    || url.protocol === 'ws:'
    || url.protocol === 'wss:'
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/_next/')
    || url.hostname !== self.location.hostname
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.hostname === self.location.hostname) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clonedResponse));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cachedResponse) => cachedResponse || Response.error()))
  );
});
