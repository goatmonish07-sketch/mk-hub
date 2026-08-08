/* MK service worker — offline app shell + installability.
   Deliberately conservative: it only touches same-origin navigations and a
   small static allow-list. API/proxy/stream/cross-origin requests are never
   intercepted, so playback, logins and image proxying behave exactly as
   before whether the SW is present or not. */
const VERSION = 'mk-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POST/logins
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // never touch cross-origin (streams, TMDB, public proxies)
  if (url.pathname.startsWith('/api/')) return;           // never touch the stream/login proxy

  // Navigations: network-first (always get the freshest app after a redeploy),
  // fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', net.clone()).catch(() => {});
        return net;
      } catch (_) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Static same-origin assets (icons, manifest): cache-first for instant loads.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      if (net.ok) { const cache = await caches.open(VERSION); cache.put(req, net.clone()).catch(() => {}); }
      return net;
    } catch (_) {
      return hit || Response.error();
    }
  })());
});
