const NAME = 'cpale-tracker', VERSION = 1;
// Ordered migrations: each adds structure only and never deletes user data.
const MIGRATIONS = { 1: db => {
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('settings', { keyPath: 'key' });
  db.createObjectStore('progress', { keyPath: 'id' });
  db.createObjectStore('errorLog', { keyPath: 'id', autoIncrement: true });
} };
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
  if (!(await req(st('meta').get('schemaVersion')))) {
    await req(st('meta', 'readwrite').put({ key: 'schemaVersion', value: VERSION }));
    await req(st('meta', 'readwrite').put({ key: 'createdAt', value: new Date().toISOString() }));
  }
}
export const all = n => req(st(n).getAll());
export const put = (n, v) => req(st(n, 'readwrite').put(v));
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
  for (const n of ['meta', 'settings', 'progress', 'errorLog']) o[n] = await all(n);
  return o;
}
