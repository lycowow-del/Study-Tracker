import * as db from './db.js';
import { h, toast, report } from './ui.js';
import { dashboard, syllabus, settings } from './views.js';
import { screening } from './screening.js';
import { assessments } from './assessments.js';
const NAV = [['dashboard', 'Command Center', dashboard], ['syllabus', 'Syllabus', syllabus], ['screening', 'Screening', screening], ['assessments', 'Assessments', assessments],
  ['data', 'Data Management', 0, 5], ['analytics', 'Analytics', 0, 6], ['tools', 'Study Tools', 0, 8], ['planner', 'Planner', 0, 9], ['settings', 'Settings', settings]];
addEventListener('error', e => report(e.error || e.message, 'window'));
addEventListener('unhandledrejection', e => report(e.reason, 'promise'));
const nav = document.getElementById('nav'), main = document.getElementById('main');
nav.append(h('div', { class: 'brand' }, '⋆ ', h('span', {}, 'CPALE Tracker')),
  ...NAV.map(([id, name, fn, pkg]) => {
    const inner = [h('span', { class: 'ic' }, name[0]), h('span', { class: 'lb' }, name, fn ? null : h('small', {}, `Coming soon · Package ${pkg}`))];
    return fn ? h('a', { href: '#/' + id, 'data-id': id }, inner) : h('span', { class: 'cs', title: `Coming soon (Package ${pkg})` }, inner);
  }));
document.getElementById('menu').addEventListener('click', () => document.body.classList.toggle(matchMedia('(max-width:800px)').matches ? 'open' : 'collapsed'));
nav.addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('open'); });
async function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
  const n = NAV.find(x => x[0] === id && x[2]) || NAV[0];
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.id === n[0]));
  main.replaceChildren();
  try { await n[2](main); } catch (e) { report(e, 'view ' + n[0]); main.append(h('p', { class: 'err' }, 'This page failed to load. See Settings > error log.')); }
}
addEventListener('hashchange', route);
(async () => {
  try { await db.init(); await db.seed(); } catch (e) { toast('Storage unavailable: ' + e.message, 'err'); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  route();
})();
