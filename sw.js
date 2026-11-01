/* SupportFlow™ — service worker
   Bump CACHE when you deploy, or testers will keep the old build. */
const CACHE = 'supportflow-v19-public-full';

// Everything needed to open the app with no network at all.
const CORE = [
  './',
  './index.html',
  './app.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './mark.svg',
  './sfsd.html',
];

// Third-party runtime deps. Cached on first successful load rather than during
// install, so a slow or blocked CDN can't stop the app installing.
const RUNTIME = [
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      // Take over immediately so a redeploy replaces an older worker (and its
      // stale cached pages) without waiting for every tab to be closed.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // The AI proxy must always hit the network — a cached tax answer is worse
  // than no answer. (POSTs already bypass this, but be explicit.)
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || RUNTIME.some((h) => req.url.startsWith(h));
  if (!cacheable) return;                       // never touch API calls

  // Navigations: network first so a redeploy is picked up, cache as the safety net.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./app.html')))
    );
    return;
  }

  // Everything else: cache first, refill in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith("supportflow-v") && k !== "supportflow-v19-public-full") ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});
