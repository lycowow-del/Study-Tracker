import { h, toast } from './ui.js';
import { APP_VERSION } from './version.js';
let deferred = null;
const secure = () => 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');

export async function registerPwa() {
  if (!secure()) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reg;
  try { reg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.error('Service worker registration failed', e); return; }
  const show = w => {
    if (document.getElementById('upd')) return;
    const bar = h('div', { id: 'upd', class: 'banner', style: 'top:56px' }, 'A new version is ready.',
      h('button', { onclick: () => w.postMessage({ type: 'SKIP_WAITING' }) }, 'Reload to update'), h('button', { onclick: () => bar.remove() }, 'Later'));
    document.body.append(bar);
  };
  if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
  reg.addEventListener('updatefound', () => { const nw = reg.installing; if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(nw); }); });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloaded) return; reloaded = true; location.reload(); });
  reg.update().catch(() => {});
}
export function initOffline() {
  const el = h('div', { class: 'net', title: 'No connection. The app and all your data work offline.' }, 'Offline');
  const sync = () => { if (navigator.onLine) el.remove(); else document.body.append(el); };
  addEventListener('online', sync); addEventListener('offline', sync); sync();
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('pwa-installable')); });
addEventListener('appinstalled', () => { deferred = null; document.dispatchEvent(new Event('pwa-installed')); });

export function pwaPanel() {
  const status = h('div', { class: 'mut' }, 'Checking…');
  const inst = h('button', { style: 'display:none' }, 'Install app');
  const sync = () => { inst.style.display = deferred ? '' : 'none'; };
  inst.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; sync(); });
  document.addEventListener('pwa-installable', sync); document.addEventListener('pwa-installed', sync); sync();
  (async () => {
    if (!secure()) { status.textContent = `App version ${APP_VERSION}. Offline mode needs https (GitHub Pages is fine) or localhost.`; return; }
    const reg = await navigator.serviceWorker.getRegistration(), mine = (await caches.keys()).filter(k => k.startsWith('cpale-tracker-'));
    const n = mine.length ? (await (await caches.open(mine[0])).keys()).length : 0;
    status.textContent = `App version ${APP_VERSION} · ${navigator.serviceWorker.controller ? `offline-ready (${n} files cached)` : reg ? 'installed; becomes active after a reload' : 'service worker not registered'} · ${navigator.onLine ? 'online' : 'offline'}`;
  })().catch(() => { status.textContent = `App version ${APP_VERSION}.`; });
  const check = h('button', { onclick: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { toast('Not available here. Offline mode needs https.', 'err'); return; }
    try { await reg.update(); toast('Checked. If a new version exists, a banner will appear.'); } catch (e) { toast('Could not check. Are you offline?', 'err'); }
  } }, 'Check for updates');
  const repair = h('button', { onclick: async () => {
    if (!confirm('Clear the app cache and reload? Your study data is not touched; only the app files are downloaded again. You need a connection for this.')) return;
    try {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) if (k.startsWith('cpale-tracker-')) await caches.delete(k);
    } catch (e) { toast('Could not clear the cache: ' + e.message, 'err'); return; }
    location.reload();
  } }, 'Repair app files (clear cache)');
  return h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'App and offline'), status, h('div', { class: 'tool' }, inst, check, repair),
    h('div', { class: 'mut' }, 'Install: Chrome and Edge show an install icon in the address bar, and the Install app button appears here when available. On iPhone or iPad use Share, then Add to Home Screen. Study data is stored on this device only, so keep exporting backups.'));
}
