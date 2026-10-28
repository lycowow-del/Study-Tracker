import { DATA_STORES } from './backup.js';
import { DEFAULT_ANALYTICS } from './analytics.js';
import { DEFAULT_PLAN } from './planner.js';
import { seedNodes, SUBJECTS, DEFAULT_FLAGS, DEFAULT_SCREEN, DEFAULT_TYPES, DEFAULT_ERRCATS, normTool } from './model.js';
const NAME = 'cpale-tracker', VERSION = 5;
// Ordered migrations: each adds structure only and never deletes user data.
const MIGRATIONS = { 1: db => {
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('settings', { keyPath: 'key' });
  db.createObjectStore('progress', { keyPath: 'id' });
  db.createObjectStore('errorLog', { keyPath: 'id', autoIncrement: true });
},
2: db => { for (const n of ['subjects', 'nodes', 'flags', 'rounds', 'screenings', 'assessments', 'assessmentRows']) db.createObjectStore(n, { keyPath: 'id' }); },
3: db => { for (const n of ['rounds', 'screenings']) db.createObjectStore(n, { keyPath: 'id' }); },
4: db => { for (const n of ['assessments', 'assessmentRows']) db.createObjectStore(n, { keyPath: 'id' }); },
5: db => { for (const n of ['sessions', 'plan']) db.createObjectStore(n, { keyPath: 'id' }); } };
let db;
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const st = (n, m = 'readonly') => db.transaction(n, m).objectStore(n);
export async function init() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = e => { for (let v = e.oldVersion + 1; v <= e.newVersion; v++) MIGRATIONS[v](r.result); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database blocked by another open tab'));
  });
  db.onversionchange = () => { db.close(); alert('The app was updated in another tab. Please reload this page.'); };
  const sv = await req(st('meta').get('schemaVersion'));
  if (!sv) await req(st('meta', 'readwrite').put({ key: 'createdAt', value: new Date().toISOString() }));
  if (!sv || sv.value < VERSION) await req(st('meta', 'readwrite').put({ key: 'schemaVersion', value: VERSION }));
}
export const all = n => req(st(n).getAll());
export const put = (n, v) => req(st(n, 'readwrite').put(v));
export const get = (n, k) => req(st(n).get(k));
export const del = (n, k) => req(st(n, 'readwrite').delete(k));
export const putMany = (n, arr) => new Promise((res, rej) => {
  const t = db.transaction(n, 'readwrite'), s = t.objectStore(n);
  arr.forEach(v => s.put(v)); t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error);
});
export const analyticsCfg = async () => ({ ...DEFAULT_ANALYTICS, ...((await get('settings', 'analytics')) || {}) });
export const planCfg = async () => ({ ...DEFAULT_PLAN, ...((await get('settings', 'plan')) || {}) });
export const screenCfg = async () => ({ ...DEFAULT_SCREEN, ...((await get('settings', 'screening')) || {}) });
export const assessTypes = async () => (((await get('settings', 'assessTypes')) || { value: DEFAULT_TYPES }).value).map(normTool);
export const errCats = async () => ((await get('settings', 'errCats')) || { value: DEFAULT_ERRCATS }).value;
const twoStores = (fn) => new Promise((res, rej) => {
  const t = db.transaction(['assessments', 'assessmentRows'], 'readwrite');
  fn(t.objectStore('assessments'), t.objectStore('assessmentRows'));
  t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error);
});
export async function saveAssessment(a, rows) {
  const old = (await all('assessmentRows')).filter(r => r.assessmentId === a.id);
  await twoStores((sa, sr) => { old.forEach(r => sr.delete(r.id)); sa.put(a); rows.forEach(r => sr.put(r)); });
}
export async function purgeAssessment(id) {
  const old = (await all('assessmentRows')).filter(r => r.assessmentId === id);
  await twoStores((sa, sr) => { old.forEach(r => sr.delete(r.id)); sa.delete(id); });
}
// One-time, idempotent seed of FAR + subjects + flags (deterministic ids; never touches progress).
export async function seed() {
  if (await get('meta', 'seeded2')) return;
  const items = await (await fetch('data/far-index.json')).json();
  await putMany('nodes', seedNodes(items, 'FAR'));
  await putMany('subjects', SUBJECTS.map((id, i) => ({ id, name: id, targetDate: '', order: i })));
  await putMany('flags', DEFAULT_FLAGS);
  await put('meta', { key: 'seeded2', value: new Date().toISOString() });
}
export const clear = n => req(st(n, 'readwrite').clear());
export async function logError(e, ctx = '') {
  try {
    await put('errorLog', { ts: new Date().toISOString(), message: String((e && e.message) || e), stack: String((e && e.stack) || ''), ctx });
    const keys = await req(st('errorLog').getAllKeys());
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) await req(st('errorLog', 'readwrite').delete(k));
  } catch (x) { console.error('logError failed', x, e); }
}
export async function exportAll() {
  const o = { app: 'cpale-tracker', backupFormat: 2, schemaVersion: VERSION, exportedAt: new Date().toISOString() };
  for (const n of DATA_STORES) o[n] = await all(n);
  return o;
}

export const SCHEMA_VERSION = VERSION;
export const backupMeta = async () => ({ reminderDays: 14, lastBackupAt: null, ...((await get('settings', 'backupMeta')) || {}) });
export const markBackup = async () => put('settings', { ...(await backupMeta()), key: 'backupMeta', lastBackupAt: new Date().toISOString() });
export const setReminder = async days => put('settings', { ...(await backupMeta()), key: 'backupMeta', reminderDays: days });
export async function counts() {
  const o = {};
  for (const n of [...DATA_STORES, 'errorLog']) o[n] = await req(st(n).count());
  return o;
}
// All-or-nothing: one transaction over every data store. The error log is left alone.
function replaceStores(stores) {
  return new Promise((res, rej) => {
    const t = db.transaction(DATA_STORES, 'readwrite');
    t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('Operation aborted; no data was changed.'));
    try { for (const n of DATA_STORES) { const s = t.objectStore(n); s.clear(); (stores[n] || []).forEach(r => s.put(r)); } }
    catch (e) { try { t.abort(); } catch (_) {} rej(e); }
  });
}
export const restoreAll = stores => replaceStores(stores);
export async function resetAll() {
  const meta = await all('meta'), keep = await get('settings', 'backupMeta');
  const createdAt = (meta.find(m => m.key === 'createdAt') || {}).value || new Date().toISOString();
  await replaceStores({ meta: [{ key: 'schemaVersion', value: VERSION }, { key: 'createdAt', value: createdAt }], settings: keep ? [keep] : [] });
}
