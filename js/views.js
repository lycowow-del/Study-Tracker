import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, progress, kidsOf, filesUnder, markRemoved, restore, nextOrder, daysLeft } from './model.js';
const APP_VERSION = '0.4.0 (Package 4)';
const STATUSES = ['Core', 'Optional', 'Visitor', 'Gap', 'Reserved'];
const bar = p => h('div', { class: 'bar' }, h('i', { style: `width:${p.pct}%` }));
const ask = (m, d = '') => { const v = prompt(m, d); return v && v.trim() ? v.trim() : null; };
let curSubj = 'FAR';
export const getSubj = () => curSubj;
export const setSubj = s => { curSubj = s; };

export async function dashboard(root) {
  root.append(h('h1', {}, 'Command Center'), h('p', { class: 'mut' }, 'Placeholder panels. Real indicators arrive in later packages.'));
  const ph = [['Study hours', 7], ['Assessment performance', 4], ['Weakest topics', 6], ['Deadlines and countdown', 7]];
  root.append(h('div', { class: 'grid' }, ph.map(([n, p]) => h('div', { class: 'panel ph' }, h('h2', {}, n), `Placeholder: Package ${p}`))));
}

export async function syllabus(root) {
  const S = { subj: curSubj, filter: 'all', flag: '', reserved: false, open: new Set() };
  let nodes, rec, subs, flags;
  const load = async () => {
    nodes = await db.all('nodes'); subs = await db.all('subjects'); flags = (await db.all('flags')).sort((a, b) => a.order - b.order);
    rec = Object.fromEntries((await db.all('progress')).map(r => [r.id, r]));
  };
  const run = async (fn, ctx) => { try { await fn(); await load(); draw(); } catch (e) { report(e, ctx); } };
  const base = id => rec[id] || { id, done: false, link: '', comment: '', flags: [] };
  const saveRec = (id, patch) => run(() => db.put('progress', { ...base(id), ...patch, updatedAt: new Date().toISOString() }), 'save progress');
  const saveQuiet = (id, patch) => { rec[id] = { ...base(id), ...patch, updatedAt: new Date().toISOString() }; return db.put('progress', rec[id]).catch(e => report(e, 'save comment')); };
  const done = id => !!(rec[id] && rec[id].done);
  const add = (kind, parent, name, status) => run(() => db.put('nodes', {
    id: (kind === 'file' ? 'n' : kind[0]) + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    subject: S.subj, kind, parent, name, status, tags: '', note: '', order: nextOrder(nodes, parent, S.subj), removedAt: null }), 'add');
  const rename = n => { const v = ask('New name', n.name); if (v) run(() => db.put('nodes', { ...n, name: v }), 'rename'); };
  const remove = n => {
    const fs = filesUnder(n.id, kidsOf(nodes)), t = fs.filter(f => done(f.id)).length;
    const msg = n.kind === 'file' ? `Remove "${n.name}"?` : `Remove "${n.name}" with ${fs.length} file(s) (${t} ticked)?`;
    if (confirm(msg + ' You can restore it from Settings > Recently removed.')) run(() => db.putMany('nodes', markRemoved(nodes, n.id, new Date().toISOString())), 'remove');
  };
  const row = n => {
    const r = rec[n.id] || {}, fl = (r.flags || []).map(id => flags.find(f => f.id === id)).filter(Boolean);
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Notes made: ' + n.name }); cb.checked = done(n.id);
    cb.addEventListener('change', () => saveRec(n.id, { done: cb.checked }));
    const ln = h('input', { type: 'text', class: 'link', placeholder: 'notes link / file name', 'aria-label': 'Notes link: ' + n.name, value: r.link || '' });
    ln.addEventListener('change', () => saveRec(n.id, { link: ln.value.trim() }));
    const top = h('div', { class: 'row ' + (n.status || 'core').toLowerCase(), title: [n.tags, n.note].filter(Boolean).join(' | ') || n.name },
      cb, h('code', {}, n.id.length <= 4 ? n.id : 'new'), h('span', { class: 'nm' }, n.name, fl.map(f => h('span', { class: 'fl', style: `background:${f.color}` }, f.name))),
      h('span', { class: 'badge' }, n.status), ln,
      h('button', { title: 'Comment, flags, status', onclick: () => { S.open.has(n.id) ? S.open.delete(n.id) : S.open.add(n.id); draw(); } }, '✎'),
      h('button', { title: 'Remove', onclick: () => remove(n) }, '✕'));
    if (!S.open.has(n.id)) return top;
    const ta = h('textarea', { placeholder: 'Comment', 'aria-label': 'Comment' }, r.comment || ''); let t;
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => saveQuiet(n.id, { comment: ta.value }), 500); });
    ta.addEventListener('change', () => saveQuiet(n.id, { comment: ta.value }));
    const sel = h('select', {}, STATUSES.map(s => h('option', { value: s, selected: s === n.status }, s)));
    sel.addEventListener('change', () => run(() => db.put('nodes', { ...n, status: sel.value }), 'status'));
    const fls = flags.map(f => { const c = h('input', { type: 'checkbox' }); c.checked = (r.flags || []).includes(f.id);
      c.addEventListener('change', () => saveRec(n.id, { flags: c.checked ? [...(r.flags || []), f.id] : (r.flags || []).filter(x => x !== f.id) }));
      return h('label', {}, c, ' ', h('span', { class: 'fl', style: `background:${f.color};margin:0` }, f.name), ' '); });
    return h('div', {}, top, h('div', { class: 'ann' }, ta, h('div', {}, 'Flags: ', fls), h('div', {}, 'Status: ', sel, ' ', h('button', { onclick: () => rename(n) }, 'Rename'))));
  };
  const draw = () => {
    const y = root.scrollTop; root.replaceChildren();
    const kids = kidsOf(nodes), roots = kids.get('root:' + S.subj) || [], all = roots.flatMap(t => filesUnder(t.id, kids));
    const tot = progress(all, done), sub = subs.find(s => s.id === S.subj) || { id: S.subj, name: S.subj, targetDate: '' };
    const filtering = S.filter !== 'all' || S.flag;
    const vis = n => (S.reserved || n.status !== 'Reserved') && (S.filter === 'all' || (S.filter === 'done') === done(n.id)) && (!S.flag || ((rec[n.id] || {}).flags || []).includes(S.flag));
    const dl = daysLeft(sub.targetDate);
    const dt = h('input', { type: 'date', value: sub.targetDate || '', 'aria-label': 'Target date' });
    dt.addEventListener('change', () => run(() => db.put('subjects', { ...sub, targetDate: dt.value }), 'target date'));
    const sel = h('select', {}, [['all', 'All'], ['todo', 'Not done'], ['done', 'Done']].map(([v, l]) => h('option', { value: v, selected: v === S.filter }, l)));
    sel.addEventListener('change', () => { S.filter = sel.value; draw(); });
    const fsel = h('select', {}, h('option', { value: '' }, 'Any flag'), flags.map(f => h('option', { value: f.id, selected: f.id === S.flag }, f.name)));
    fsel.addEventListener('change', () => { S.flag = fsel.value; draw(); });
    const rs = h('input', { type: 'checkbox' }); rs.checked = S.reserved; rs.addEventListener('change', () => { S.reserved = rs.checked; draw(); });
    root.append(h('div', { class: 'tabs' }, SUBJECTS.map(id => h('button', { class: id === S.subj ? 'on' : '', onclick: () => { S.subj = curSubj = id; S.open.clear(); draw(); } }, id))),
      h('h1', {}, 'Syllabus: ' + S.subj),
      h('div', { class: 'panel' }, h('h2', {}, `Lecture notes made: ${tot.done} of ${tot.total} (${tot.pct}%)`), bar(tot),
        h('div', { class: 'mut' }, 'Coverage only. This does not measure understanding. Counts Core, Visitor and Gap files; Optional and Reserved are not counted.'),
        h('div', { class: 'tool' }, 'Target date:', dt, h('b', {}, dl == null ? 'No target date set' : dl < 0 ? 'Target date passed' : `${dl} day(s) left`))),
      h('div', { class: 'tool' }, 'Show:', sel, fsel, h('label', {}, rs, ' include reserved'), h('button', { onclick: () => { const v = ask('New topic name'); if (v) add('topic', null, v); } }, '+ Add topic')));
    if (!roots.length) root.append(h('p', { class: 'mut' }, 'No topics yet. Click "+ Add topic" to start this subject.'));
    for (const t of roots) {
      const tp = progress(filesUnder(t.id, kids), done);
      root.append(h('div', { class: 'th' }, h('span', {}, t.name), h('span', {}, `${tp.done} of ${tp.total}`,
        h('button', { onclick: () => { const v = ask('New subtopic group name'); if (v) add('group', t.id, v); } }, '+ Group'), h('button', { onclick: () => rename(t) }, 'Rename'), h('button', { onclick: () => remove(t) }, '✕'))));
      for (const g of kids.get(t.id) || []) {
        const fs = (kids.get(g.id) || []).filter(vis);
        if (filtering && !fs.length) continue;
        const gp = progress(filesUnder(g.id, kids), done);
        root.append(h('div', { class: 'gh' }, h('span', {}, g.name), h('span', {}, `${gp.done} of ${gp.total}`,
          h('button', { onclick: () => { const v = ask('New notes file name'); if (v) add('file', g.id, v, 'Core'); } }, '+ File'), h('button', { onclick: () => rename(g) }, 'Rename'), h('button', { onclick: () => remove(g) }, '✕'))), ...fs.map(row));
      }
    }
    root.scrollTop = y;
  };
  await load(); draw();
}

export async function settings(root) {
  const meta = Object.fromEntries((await db.all('meta')).map(m => [m.key, m.value]));
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const logs = (await db.all('errorLog')).reverse(), flags = (await db.all('flags')).sort((a, b) => a.order - b.order), nodes = await db.all('nodes');
  const types = await db.assessTypes(), cats = await db.errCats(), goneAs = (await db.all('assessments')).filter(a => a.removedAt);
  const cfg = await db.screenCfg(), goneRounds = (await db.all('rounds')).filter(r => r.removedAt);
  const again = async () => { root.replaceChildren(); await settings(root); };
  const guard = fn => async () => { try { await fn(); await again(); } catch (e) { report(e, 'settings'); } };
  const doExport = async () => {
    try {
      const b = new Blob([JSON.stringify(await db.exportAll(), null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(b), download: `cpale-tracker-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); toast('Exported');
    } catch (e) { report(e, 'export'); }
  };
  const flagRow = f => {
    const nm = h('input', { type: 'text', value: f.name, 'aria-label': 'Flag name' }), co = h('input', { type: 'color', value: f.color, 'aria-label': 'Flag color' });
    const save = guard(() => db.put('flags', { ...f, name: nm.value.trim() || f.name, color: co.value }));
    nm.addEventListener('change', save); co.addEventListener('change', save);
    return h('div', { class: 'tool' }, nm, co, h('button', { onclick: guard(async () => { if (confirm(`Delete flag "${f.name}"? It will disappear from all files.`)) await db.del('flags', f.id); }) }, 'Delete'));
  };
  const gone = nodes.filter(n => n.removedAt && n.removedBy === n.id);
  const goneRow = n => {
    const part = nodes.filter(x => x.removedBy === n.id), parentOk = !n.parent || nodes.some(x => x.id === n.parent && !x.removedAt);
    return h('tr', {}, h('td', {}, `${n.subject} ${n.kind}: ${n.name}`), h('td', {}, part.length > 1 ? `+${part.length - 1} inside` : ''), h('td', {}, n.removedAt.slice(0, 10)),
      h('td', {}, parentOk ? h('button', { onclick: guard(() => db.putMany('nodes', restore(nodes, n.id))) }, 'Restore') : h('span', { class: 'mut' }, 'restore parent first'), ' ',
        h('button', { onclick: guard(async () => { if (confirm(`Permanently delete "${n.name}"${part.length > 1 ? ` and ${part.length - 1} item(s) inside` : ''}, with their ticks and comments? This cannot be undone.`)) for (const x of part) { await db.del('nodes', x.id); await db.del('progress', x.id); } }) }, 'Delete permanently')));
  };
  const listEd = (title, key, items) => h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, title),
    items.map(it => {
      const i = h('input', { type: 'text', value: it.name, 'aria-label': title });
      i.addEventListener('change', guard(async () => { const n = i.value.trim(); if (n) await db.put('settings', { key, value: items.map(x => x.id === it.id ? { ...x, name: n } : x) }); }));
      return h('div', { class: 'tool' }, i, h('button', { onclick: guard(async () => { if (items.length > 1 && confirm(`Delete "${it.name}"? Existing entries keep their data but show it as removed.`)) await db.put('settings', { key, value: items.filter(x => x.id !== it.id) }); }) }, 'Delete'));
    }),
    h('button', { onclick: guard(async () => { const v = ask('New name'); if (v) await db.put('settings', { key, value: [...items, { id: key[0] + Date.now().toString(36), name: v }] }); }) }, '+ Add'));
  const asRow = a => h('tr', {}, h('td', {}, `${a.subject} assessment: ${a.name} (${a.date})`), h('td', {}, (a.removedAt || '').slice(0, 10)),
    h('td', {}, h('button', { onclick: guard(() => db.put('assessments', { ...a, removedAt: null })) }, 'Restore'), ' ',
      h('button', { onclick: guard(async () => { if (confirm(`Permanently delete "${a.name}" and its breakdown? This cannot be undone.`)) await db.purgeAssessment(a.id); }) }, 'Delete permanently')));
  const cutRow = (label, key, min, max) => {
    const i = h('input', { type: 'number', min, max, value: cfg[key], style: 'width:80px' });
    i.addEventListener('change', guard(async () => {
      const n = { ...cfg, [key]: Number(i.value) };
      if (!Number.isFinite(n[key]) || n[key] < min || n[key] > max || n.weakBelow >= n.strongFrom || !Number.isInteger(n.minQ)) { toast('Invalid value. Weak must be below Strong, and the minimum must be a whole number of at least 1.', 'err'); return; }
      await db.put('settings', { key: 'screening', ...n });
    }));
    return h('div', { class: 'tool' }, label, i);
  };
  const roundRow = r => h('tr', {}, h('td', {}, `${r.subject} round: ${r.name} (${r.date})`), h('td', {}, (r.removedAt || '').slice(0, 10)),
    h('td', {}, h('button', { onclick: guard(() => db.put('rounds', { ...r, removedAt: null })) }, 'Restore'), ' ',
      h('button', { onclick: guard(async () => { if (confirm(`Permanently delete round "${r.name}" and its scores? This cannot be undone.`)) { for (const s of (await db.all('screenings')).filter(s => s.roundId === r.id)) await db.del('screenings', s.id); await db.del('rounds', r.id); } }) }, 'Delete permanently')));
  root.append(h('h1', {}, 'Settings'),
    h('div', { class: 'panel' }, h('h2', {}, 'Storage'),
      h('div', {}, `App version: ${APP_VERSION}`), h('div', {}, `Database schema version: ${meta.schemaVersion ?? '?'}`),
      h('div', {}, `Persistent storage: ${persisted ? 'granted' : 'not granted (the browser may still clear data; export backups regularly)'}`),
      h('div', { class: 'tool' }, h('button', { onclick: doExport }, 'Export data to JSON'), h('span', { class: 'mut' }, 'Interim backup. Import and restore arrive in Package 5.'))),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'Flags'), flags.map(flagRow),
      h('button', { onclick: guard(async () => { const v = ask('New flag name'); if (v) await db.put('flags', { id: 'f' + Date.now().toString(36), name: v, color: '#8b949e', order: flags.length }); }) }, '+ Add flag')),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, `Recently removed (${gone.length})`),
      gone.length ? h('table', {}, gone.map(goneRow)) : h('div', { class: 'mut' }, 'Nothing removed.')),
    listEd('Assessment types', 'assessTypes', types), listEd('Error categories', 'errCats', cats),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, `Removed assessments (${goneAs.length})`),
      goneAs.length ? h('table', {}, goneAs.map(asRow)) : h('div', { class: 'mut' }, 'Nothing removed.')),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'Screening cut-offs'),
      cutRow('Weak below (%)', 'weakBelow', 1, 100), cutRow('Strong from (%)', 'strongFrom', 1, 100), cutRow('Minimum questions for a reliable score', 'minQ', 1, 1000)),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, `Removed screening rounds (${goneRounds.length})`),
      goneRounds.length ? h('table', {}, goneRounds.map(roundRow)) : h('div', { class: 'mut' }, 'Nothing removed.')),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, `Error log (${logs.length})`),
      h('div', { class: 'tool' }, h('button', { onclick: guard(async () => { if (confirm('Clear the error log? This cannot be undone.')) await db.clear('errorLog'); }) }, 'Clear log'),
        h('button', { onclick: () => setTimeout(() => { throw new Error('Test error (deliberate)'); }) }, 'Trigger test error')),
      logs.length ? h('table', {}, logs.map(l => h('tr', {}, h('td', {}, l.ts.replace('T', ' ').slice(0, 19)), h('td', {}, l.message), h('td', { class: 'mut' }, l.ctx)))) : h('div', { class: 'mut' }, 'No errors logged.')));
}
