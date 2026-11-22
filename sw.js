// Sarvlekh service worker.
//
// Cost note: a network-first worker re-requests every file on every app open — about 15
// requests per open, which across a few hundred phones is millions of Vercel edge requests a
// month. So the app's own files are served from the cache, and refreshed in the background at
// most once every 12 hours. A deploy is picked up immediately when VERSION changes; Vercel stamps a new
// VERSION on every deploy (build command in vercel.json), no manual step.
// API, Supabase and Google calls are never cached.
const VERSION = 'hostelos-202611221814';
const locHost = (typeof self !== 'undefined' && self.location && (self.location.hostname || (self.location.origin ? new URL(self.location.origin).hostname : ''))) || (typeof location !== 'undefined' && location.hostname) || '';
const locPort = (typeof self !== 'undefined' && self.location && (self.location.port || (self.location.origin ? new URL(self.location.origin).port : ''))) || (typeof location !== 'undefined' && location.port) || '';
const isDev = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(locHost) || locPort === '5176' || locPort === '5177';
const REFRESH_MS = 12 * 3600e3;
const SHELL = [
  './', './index.html', './pay.html', './visit.html', './join.html', './site.html', './manifest.webmanifest', './css/app.css', './css/site.css',
  './js/config.js', './js/theme.js', './js/pwa.js', './js/mascot.js', './js/geo.js', './js/core.js', './js/data.js', './js/domain.js', './js/app.js',
  './js/ui-owner.js', './js/ui-ops.js', './js/ui-settings.js', './js/ui-resident.js', './js/start.js', './js/pay.js', './js/visit.js', './js/join.js', './js/site.js',
  './icons/icon.svg', './icons/favicon-32.png', './icons/icon-192.png', './icons/apple-touch-icon.png', './img/login-phone.webp', './img/login-desktop.webp',
  // fetched on demand (Hindi, QR codes, super admin) — cached by the fetch handler when used
];

self.addEventListener('install', e => {
  if (isDev) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => caches.open(VERSION + ':meta')).then(m => m.put('stamp', new Response(String(Date.now()))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  if (isDev) {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim()));
    return;
  }
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + ':meta').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Background refresh of everything cached, at most every REFRESH_MS.
let refreshing = null;
async function maybeRefresh() {
  if (refreshing) return refreshing;
  const meta = await caches.open(VERSION + ':meta');
  const hit = await meta.match('stamp');
  const last = hit ? +(await hit.text()) : 0;
  if (Date.now() - last < REFRESH_MS) return;
  refreshing = (async () => {
    await meta.put('stamp', new Response(String(Date.now())));
    const cache = await caches.open(VERSION);
    for (const req of await cache.keys()) {
      try { const res = await fetch(req, { cache: 'no-cache' }); if (res.ok) await cache.put(req, res); } catch (e) { /* offline: keep old */ }
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Never touch the serverless functions. The path test has to match wherever the app is
  // mounted (root on Vercel, a sub-path in local preview), and nothing the functions answer
  // should ever be served stale from a cache.
  const origin = (typeof self !== 'undefined' && self.location && self.location.origin) || (typeof location !== 'undefined' && location.origin) || '';
  if (req.method !== 'GET' || url.origin !== origin || /(^|\/)api\//.test(url.pathname)) return;
  if (isDev) { e.respondWith(fetch(req)); return; }
  // A page of the app (/home, /settings/site ...) is always the same shell, whatever the path: Vercel serves
  // index.html for it, and offline the cached copy does.
  const appPage = req.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(url.pathname) && !/^\/h\//.test(url.pathname);
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(appPage ? './index.html' : req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) { e.waitUntil(maybeRefresh()); return hit; }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || cache.match('./index.html');
    }
  }));
});

// Web Push Notifications
self.addEventListener('push', e => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { title: 'Sarvlekh', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Sarvlekh';
  const options = {
    body: data.body || '',
    icon: data.icon || './icons/icon-192.png',
    badge: data.badge || './icons/icon-192.png',
    data: {
      link: data.link || '/',
      id: data.id,
      category: data.category || 'general'
    },
    tag: data.tag || (data.id ? 'sarvlekh-' + data.id : undefined),
    renotify: true
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Local push events from PWA client (when backgrounded / foreground notify)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'PUSH_LOCAL') {
    const data = e.data.payload || {};
    const title = data.title || 'Sarvlekh';
    const options = {
      body: data.body || '',
      icon: data.icon || './icons/icon-192.png',
      badge: data.badge || './icons/icon-192.png',
      data: {
        link: data.link || '/',
        id: data.id,
        category: data.category || 'general'
      },
      tag: data.tag || (data.id ? 'sarvlekh-' + data.id : undefined),
      renotify: true
    };
    e.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  const targetUrl = new URL(link, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
