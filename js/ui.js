import * as db from './db.js';
export const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(a)) {
    if (n === 'class') e.className = v;
    else if (n.startsWith('on')) e.addEventListener(n.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(n, v === true ? '' : v);
  }
  for (const c of k.flat()) if (c != null) e.append(c);
  return e;
};
export function toast(msg, kind = 'ok') {
  const t = h('div', { class: 'toast ' + kind, title: kind === 'err' ? 'Click to dismiss' : '' }, msg);
  document.getElementById('toasts').append(t);
  if (kind === 'err') t.addEventListener('click', () => t.remove()); else setTimeout(() => t.remove(), 3500);
}
export const report = (e, ctx) => { db.logError(e, ctx); toast('Error: ' + ((e && e.message) || e), 'err'); };
