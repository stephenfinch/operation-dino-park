// Service worker: lets the game install to a home screen and play offline.
// Game code (HTML, JS, CSS) is network-first, so a new deploy shows up on the next load.
// Models, fonts and the three.js CDN files are cache-first; bump VERSION to refresh them.
const VERSION = 'v1';
const CACHE = 'operation-dino-park-' + VERSION;
const SHELL = ['./', 'index.html', 'css/style.css', 'js/main.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const NET_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('operation-dino-park-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isCode = (url) => url.origin === location.origin && (/\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/'));
const cacheable = (res) => res && (res.ok || res.type === 'opaque');

async function put(req, res) {
  if (!cacheable(res)) return;
  const c = await caches.open(CACHE);
  await c.put(req, res);
}

async function networkFirst(req, fallback) {
  const net = fetch(req).then((res) => { put(req, res.clone()); return res; });
  net.catch(() => {});
  const timeout = new Promise((r) => setTimeout(r, NET_TIMEOUT));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch (err) { /* offline: fall back to the cache */ }
  const hit = (await caches.match(req, { ignoreSearch: true })) || (fallback && (await caches.match(fallback)));
  return hit || net;
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, './')); return; }
  e.respondWith(isCode(url) ? networkFirst(req) : cacheFirst(req));
});

// The page sends the files its first visit fetched (before this worker was in control).
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache') return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map(async (u) => {
    if (await c.match(u)) return;
    try {
      const res = await fetch(u, { mode: new URL(u).origin === location.origin ? 'same-origin' : 'cors' });
      if (res.ok) await c.put(u, res);
    } catch (err) { /* skip what cannot be fetched */ }
  }))));
});
