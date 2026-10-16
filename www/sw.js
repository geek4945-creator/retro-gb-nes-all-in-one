// Offline shell + runtime cache for the EmulatorJS CDN (loader, UI and cores are cached after first use).
const VERSION = 'v1';
const SHELL = `retro-pocket-shell-${VERSION}`;
const RUNTIME = `retro-pocket-ejs-${VERSION}`;
const SHELL_FILES = [
  './', 'index.html', 'player.html', 'manifest.webmanifest',
  'css/app.css', 'css/player.css',
  'js/app.js', 'js/cores.js', 'js/db.js', 'js/player.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, RUNTIME].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // stale-while-revalidate for the app shell; ignore query string (player.html?id=...)
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req.url.split('?')[0], r.clone()); return r; }).catch(() => null);
      return cached || (await net) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  if (url.hostname === 'cdn.emulatorjs.org') {
    // cache-first: versioned "stable" assets rarely change
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.status === 200) cache.put(req, r.clone());
      return r;
    })());
  }
});
