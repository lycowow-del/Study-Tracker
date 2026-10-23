import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { buildTree, progress } from './model.js';
const APP_VERSION = '0.1.0 (Package 1)';
const flat = m => [...m.values()].flat();
const bar = p => h('div', { class: 'bar' }, h('i', { style: `width:${p.pct}%` }));
let ITEMS;
const loadItems = async () => ITEMS || (ITEMS = await (await fetch('data/far-index.json')).json());

export async function dashboard(root) {
  root.append(h('h1', {}, 'Command Center'), h('p', { class: 'mut' }, 'Placeholder panels. Real indicators arrive in later packages.'));
  const ph = [['Study hours', 7], ['Assessment performance', 4], ['Weakest topics', 6], ['Deadlines and countdown', 7]];
  root.append(h('div', { class: 'grid' }, ph.map(([n, p]) => h('div', { class: 'panel ph' }, h('h2', {}, n), `Placeholder: Package ${p}`))));
}

export async function syllabus(root) {
  const items = await loadItems();
  const rec = Object.fromEntries((await db.all('progress')).map(r => [r.id, r]));
  const st = { filter: 'all', reserved: false };
  const done = id => !!(rec[id] && rec[id].done);
  const save = async (it, patch) => {
    try {
      const r = { ...(rec[it.id] || { id: it.id, done: false, link: '' }), ...patch, updatedAt: new Date().toISOString() };
      await db.put('progress', r); rec[it.id] = r; draw();
    } catch (e) { report(e, 'save progress'); }
  };
  const row = it => {
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Notes made: ' + it.name }); cb.checked = done(it.id);
    cb.addEventListener('change', () => save(it, { done: cb.checked }));
    const ln = h('input', { type: 'text', class: 'link', placeholder: 'notes link / file name', 'aria-label': 'Notes link: ' + it.name, value: (rec[it.id] && rec[it.id].link) || '' });
    ln.addEventListener('change', () => save(it, { link: ln.value.trim() }));
    return h('div', { class: 'row ' + it.status.toLowerCase(), title: it.note || it.filename }, cb, h('code', {}, it.id), h('span', { class: 'nm' }, it.name), h('span', { class: 'badge' }, it.status), h('span', { class: 'tags' }, it.tags), ln);
  };
  const draw = () => {
    const y = root.scrollTop; root.replaceChildren();
    const full = buildTree(items), tot = progress(items, done);
    const keep = i => (st.reserved || i.status !== 'Reserved') && (st.filter === 'all' || (st.filter === 'done') === done(i.id));
    const sel = h('select', { 'aria-label': 'Filter' }, [['all', 'All'], ['todo', 'Not done'], ['done', 'Done']].map(([v, l]) => h('option', { value: v, selected: v === st.filter }, l)));
    sel.addEventListener('change', () => { st.filter = sel.value; draw(); });
    const rs = h('input', { type: 'checkbox' }); rs.checked = st.reserved;
    rs.addEventListener('change', () => { st.reserved = rs.checked; draw(); });
    root.append(h('h1', {}, 'Syllabus: FAR'),
      h('div', { class: 'panel' }, h('h2', {}, `Lecture notes made: ${tot.done} of ${tot.total} (${tot.pct}%)`), bar(tot),
        h('div', { class: 'mut' }, 'Coverage only. This does not measure understanding. Counts Core, Visitor and Gap files; Optional and Reserved files are not counted.')),
      h('div', { class: 'tool' }, 'Show:', sel, h('label', {}, rs, ' include reserved summary slots'), h('span', { class: 'mut' }, 'AFAR, RFBT, TAX, AUD, MAS: coming soon')));
    for (const [t, gm] of buildTree(items.filter(keep))) {
      const tp = progress(flat(full.get(t)), done);
      root.append(h('div', { class: 'th' }, h('span', {}, t), h('span', {}, `${tp.done} of ${tp.total}`)));
      for (const [g, its] of gm) {
        const gp = progress(full.get(t).get(g), done);
        root.append(h('div', { class: 'gh' }, h('span', {}, g), h('span', {}, `${gp.done} of ${gp.total}`)), ...its.map(row));
      }
    }
    root.scrollTop = y;
  };
  draw();
}

export async function settings(root) {
  const meta = Object.fromEntries((await db.all('meta')).map(m => [m.key, m.value]));
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const logs = (await db.all('errorLog')).reverse();
  const doExport = async () => {
    try {
      const b = new Blob([JSON.stringify(await db.exportAll(), null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(b), download: `cpale-tracker-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); toast('Exported');
    } catch (e) { report(e, 'export'); }
  };
  const clearLog = async () => { if (confirm('Clear the error log? This cannot be undone.')) { await db.clear('errorLog'); root.replaceChildren(); settings(root); } };
  root.append(h('h1', {}, 'Settings'),
    h('div', { class: 'panel' }, h('h2', {}, 'Storage'),
      h('div', {}, `App version: ${APP_VERSION}`), h('div', {}, `Database schema version: ${meta.schemaVersion ?? '?'}`),
      h('div', {}, `Persistent storage: ${persisted ? 'granted' : 'not granted (the browser may still clear data; export backups regularly)'}`),
      h('div', { class: 'tool' }, h('button', { onclick: doExport }, 'Export data to JSON'), h('span', { class: 'mut' }, 'Interim backup. Import and restore arrive in Package 5.'))),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, `Error log (${logs.length})`),
      h('div', { class: 'tool' }, h('button', { onclick: clearLog }, 'Clear log'), h('button', { onclick: () => setTimeout(() => { throw new Error('Test error (deliberate)'); }) }, 'Trigger test error')),
      logs.length ? h('table', {}, logs.map(l => h('tr', {}, h('td', {}, l.ts.replace('T', ' ').slice(0, 19)), h('td', {}, l.message), h('td', { class: 'mut' }, l.ctx)))) : h('div', { class: 'mut' }, 'No errors logged.')));
}
