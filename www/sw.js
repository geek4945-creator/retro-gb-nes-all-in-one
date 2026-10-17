// Offline shell + runtime cache for the EmulatorJS CDN (loader, UI and cores are cached after first use).
const VERSION = 'v6';
const SHELL = `retro-pocket-shell-${VERSION}`;
const RUNTIME = 'retro-pocket-ejs-v3';      // the EmulatorJS cores cache is version-independent: keep it across app updates
const SHELL_FILES = [
  './', 'index.html', 'player.html', 'manifest.webmanifest',
  'css/app.css', 'css/player.css',
  'js/app.js', 'js/art.js', 'js/cover.js', 'js/pads.js', 'js/padnav.js', 'js/padsui.js', 'js/cores.js', 'js/db.js', 'js/player.js', 'js/detect.js', 'js/bios.js', 'js/biosui.js', 'js/biosdata.js', 'js/hash.js', 'js/dstouch.js', 'js/dsui.js',
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

// Cross-origin isolation for threaded cores (PPSSPP, DOSBox Pure): player.html?...&iso=1 is served with COOP/COEP.
// COEP "require-corp" blocks no-cors cross-origin subresources unless they send CORP, and EmulatorJS injects plain <script>
// tags for its loader files, so cdn.emulatorjs.org responses are re-fetched with CORS (the CDN sends ACAO:*) and handed back
// with `Cross-Origin-Resource-Policy: cross-origin`. Pages without ?iso=1 get no COOP/COEP and behave exactly as before.
function isolate(r) {
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

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
      const r = cached || (await net) || new Response('Offline', { status: 503 });
      return req.mode === 'navigate' && url.searchParams.has('iso') && r.status === 200 ? isolate(r) : r;
    })());
    return;
  }

  if (url.hostname === 'cdn.emulatorjs.org') {
    // cache-first: pinned, versioned assets never change
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      let r = await cache.match(url.href);
      if (!r) {
        const net = await fetch(url.href, { mode: 'cors', credentials: 'omit' }).catch(() => null);
        if (!net) return Response.error();
        if (net.ok && net.status === 200) cache.put(url.href, net.clone());
        r = net;
      }
      const h = new Headers(r.headers); h.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    })());
  }
});
