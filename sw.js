// Service worker: keeps the app shell available offline. Bump VERSION on every release so browsers install the update.
// It never touches IndexedDB, so your study data is unaffected by updates or by clearing this cache.
const VERSION = '0.11.0';
const CACHE = 'cpale-tracker-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './data/far-index.json',
  './js/analytics-view.js', './js/analytics.js', './js/assessments.js', './js/backup.js', './js/dashboard.js', './js/data.js', './js/db.js', './js/main.js', './js/model.js',
  './js/planner-view.js', './js/planner.js', './js/pwa.js', './js/reco.js', './js/screening.js', './js/tools.js', './js/ui.js', './js/version.js', './js/views.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cpale-tracker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// The page asks for the update explicitly, so an update never reloads the app while you are mid-entry.
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const shell = () => req.mode === 'navigate' ? caches.match('./index.html') : undefined;
    try { return await fetch(req); } catch (err) { return (await shell()) || new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
