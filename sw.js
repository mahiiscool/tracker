// Service worker: caches every app file so the app opens with no signal.
// To ship an update, bump VERSION. Old caches are deleted on activate.
// Bump this number every time you push a change. Phones then show "Update available".
const VERSION = 'v16';
const CACHE = 'tracker-' + VERSION;

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'app.js',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the browser's own HTTP cache. GitHub Pages lets browsers keep files
    // for 10 minutes, so without this a new version could get cached with the old app.js inside.
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

// The page asks for the switch when you tap "Update available".
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, fall back to network, and keep a copy of anything new.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
