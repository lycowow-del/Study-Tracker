import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { validateBackup, prepareMeta, screeningCsv, assessmentCsv, sessionsCsv, reminderDue, daysSince } from './backup.js';
const stamp = () => new Date().toISOString().slice(0, 10);
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export async function exportJson(prefix = 'cpale-tracker') {
  download(`${prefix}-${stamp()}.json`, JSON.stringify(await db.exportAll(), null, 2), 'application/json');
  await db.markBackup();
}
let dismissed = false;
export async function checkReminder() {
  try {
    const old = document.getElementById('banner'); if (old) old.remove();
    const m = await db.backupMeta(), meta = Object.fromEntries((await db.all('meta')).map(x => [x.key, x.value])), c = await db.counts();
    if (dismissed || !(c.progress + c.screenings + c.assessments > 0) || !reminderDue(m.lastBackupAt, meta.createdAt, m.reminderDays, new Date())) return;
    const bar = h('div', { id: 'banner', class: 'banner' }, `No backup for ${Math.floor(daysSince(m.lastBackupAt || meta.createdAt, new Date()))} days.`,
      h('button', { onclick: async () => { try { await exportJson(); bar.remove(); toast('Backup exported'); } catch (e) { report(e, 'backup'); } } }, 'Export now'),
      h('button', { onclick: () => { dismissed = true; bar.remove(); } }, 'Dismiss'));
    document.body.append(bar);
  } catch (e) { console.error(e); }
}
const LABELS = { progress: 'Notes progress', nodes: 'Topics, groups and files', subjects: 'Subjects', flags: 'Flags', rounds: 'Screening rounds', screenings: 'Screening scores', assessments: 'Assessments', sessions: 'Study log sessions', plan: 'Plan items', assessmentRows: 'Assessment breakdown rows', settings: 'Settings', meta: 'App info', errorLog: 'Error log (not backed up)' };

export async function dataMgmt(root) {
  let busy = false;
  const guard = fn => async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { report(e, 'data management'); } finally { busy = false; } };
  const m = await db.backupMeta(), c = await db.counts();
  const last = m.lastBackupAt ? `${m.lastBackupAt.slice(0, 16).replace('T', ' ')} UTC (${Math.floor(daysSince(m.lastBackupAt, new Date()))} days ago)` : 'never';
  const pv = h('div');
  const csv = (name, build) => h('button', { onclick: guard(async () => { download(`${name}-${stamp()}.csv`, await build(), 'text/csv;charset=utf-8'); toast('CSV exported'); }) }, `Export ${name} CSV`);
  const rsel = h('select', { 'aria-label': 'Reminder' }, [[0, 'Off'], [7, '7 days'], [14, '14 days'], [30, '30 days']].map(([v, l]) => h('option', { value: v, selected: v === m.reminderDays }, l)));
  rsel.addEventListener('change', guard(async () => { await db.setReminder(Number(rsel.value)); await checkReminder(); toast('Saved'); }));
  const showPreview = (v, name) => {
    if (!v.ok) { pv.replaceChildren(h('div', { class: 'panel danger', style: 'margin-top:8px' }, h('h2', {}, 'This file cannot be restored'), ...v.errors.map(e => h('div', { class: 'err' }, e)), h('div', { class: 'mut' }, 'Your current data was not changed.'))); return; }
    const restore = guard(async () => {
      await exportJson('cpale-tracker-SAFETY-before-restore');
      if (!confirm('A safety copy of your current data was downloaded. Check your Downloads folder, then press OK to REPLACE all current data with this backup.')) return;
      const keep = await db.get('settings', 'backupMeta'), cur = Object.fromEntries((await db.all('meta')).map(x => [x.key, x.value])), stores = { ...v.stores };
      stores.meta = prepareMeta(stores.meta, db.SCHEMA_VERSION, cur.createdAt, stores.nodes.length > 0);
      stores.settings = [...stores.settings.filter(r => r.key !== 'backupMeta'), ...(keep ? [keep] : [])];
      await db.restoreAll(stores); toast('Restored. Reloading…'); setTimeout(() => location.reload(), 800);
    });
    pv.replaceChildren(h('div', { class: 'panel', style: 'margin-top:8px' }, h('h2', {}, `Preview: ${name}`),
      h('div', {}, `Exported: ${v.info.exportedAt ? v.info.exportedAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'} · schema ${v.info.schemaVersion} · format ${v.info.format}`),
      h('table', {}, Object.keys(v.counts).filter(k => k !== 'meta').map(k => h('tr', {}, h('td', {}, LABELS[k]), h('td', {}, v.counts[k])))),
      ...v.warnings.map(w => h('div', { class: 'mut' }, 'Note: ' + w)),
      h('div', { class: 'tool' }, h('button', { onclick: restore }, 'Restore (replaces all current data)'), h('button', { onclick: () => pv.replaceChildren() }, 'Cancel'))));
  };
  const fi = h('input', { type: 'file', accept: '.json,application/json' });
  fi.addEventListener('change', guard(async () => { const f = fi.files[0]; if (f) showPreview(validateBackup(await f.text(), db.SCHEMA_VERSION), f.name); }));
  const rin = h('input', { type: 'text', placeholder: 'Type RESET', 'aria-label': 'Type RESET to confirm' }), rb = h('button', { disabled: true }, 'Reset all data');
  rin.addEventListener('input', () => { rb.disabled = rin.value !== 'RESET'; });
  rb.addEventListener('click', guard(async () => {
    await exportJson('cpale-tracker-SAFETY-before-reset');
    if (!confirm('A safety copy was downloaded. Check your Downloads folder, then press OK to ERASE all data and start fresh.')) return;
    await db.resetAll(); toast('Data reset. Reloading…'); setTimeout(() => location.reload(), 800);
  }));
  root.append(h('h1', {}, 'Data Management'),
    h('div', { class: 'panel' }, h('h2', {}, 'Back up and export'), h('div', {}, `Last full backup: ${last}`),
      h('div', { class: 'tool' }, h('button', { onclick: guard(async () => { await exportJson(); toast('Backup exported'); await checkReminder(); }) }, 'Export full backup (JSON)'),
        csv('screening', async () => screeningCsv((await db.all('rounds')).filter(r => !r.removedAt), await db.all('screenings'), await db.all('nodes'))),
        csv('assessments', async () => assessmentCsv((await db.all('assessments')).filter(a => !a.removedAt), await db.all('assessmentRows'), await db.all('nodes'), await db.assessTypes(), await db.errCats()))),
      h('div', { class: 'tool' }, csv('study-log', async () => sessionsCsv(await db.all('sessions'), await db.all('nodes')))),
      h('div', { class: 'mut' }, 'Only the JSON backup can be restored. CSV files are for Excel and do not count as a backup. Removed items are not included in the CSV files.'),
      h('div', { class: 'tool' }, 'Remind me after no backup for:', rsel)),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'Restore from a backup'),
      h('div', { class: 'mut' }, 'Replaces ALL current data. A safety copy of your current data is downloaded first. Check your Downloads folder, because the browser decides where it goes.'), h('div', { class: 'tool' }, fi), pv),
    h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'Data summary'),
      h('table', {}, Object.keys(c).filter(k => k !== 'meta').map(k => h('tr', {}, h('td', {}, LABELS[k]), h('td', {}, c[k]))))),
    h('div', { class: 'panel danger', style: 'margin-top:10px' }, h('h2', {}, 'Danger zone'),
      h('div', { class: 'mut' }, 'Erases everything and reloads the built-in FAR index. A safety copy is downloaded first.'), h('div', { class: 'tool' }, rin, rb)));
}
