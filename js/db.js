import { seedNodes, SUBJECTS, DEFAULT_FLAGS } from './model.js';
const NAME = 'cpale-tracker', VERSION = 2;
// Ordered migrations: each adds structure only and never deletes user data.
const MIGRATIONS = { 1: db => {
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('settings', { keyPath: 'key' });
  db.createObjectStore('progress', { keyPath: 'id' });
  db.createObjectStore('errorLog', { keyPath: 'id', autoIncrement: true });
},
2: db => { for (const n of ['subjects', 'nodes', 'flags']) db.createObjectStore(n, { keyPath: 'id' }); } };
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
  const o = { app: 'cpale-tracker', exportedAt: new Date().toISOString() };
  for (const n of ['meta', 'settings', 'progress', 'errorLog', 'subjects', 'nodes', 'flags']) o[n] = await all(n);
  return o;
}
