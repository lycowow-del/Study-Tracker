// Pure backup/CSV/reminder logic (no DOM or IndexedDB) so it can be tested in Node.
export const DATA_STORES = ['meta', 'settings', 'progress', 'subjects', 'nodes', 'flags', 'rounds', 'screenings', 'assessments', 'assessmentRows', 'sessions', 'plan'];
const KEY = { meta: 'key', settings: 'key' };
export function validateBackup(text, curVersion) {
  const out = { ok: false, errors: [], warnings: [], counts: {}, stores: {}, info: {} };
  let o;
  try { o = JSON.parse(text); } catch (e) { out.errors.push('The file is not valid JSON.'); return out; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.app !== 'cpale-tracker') { out.errors.push('This is not a CPALE Tracker backup file.'); return out; }
  const mv = Array.isArray(o.meta) ? o.meta.find(m => m && m.key === 'schemaVersion') : null;
  const sv = Number(o.schemaVersion ?? (mv ? mv.value : 1));
  if (!Number.isFinite(sv) || sv < 1) { out.errors.push('The backup has no valid schema version.'); return out; }
  if (sv > curVersion) { out.errors.push(`This backup was made by a newer version of the app (schema ${sv}; this app supports up to ${curVersion}). Update the app first.`); return out; }
  for (const n of DATA_STORES) {
    const v = o[n];
    if (v === undefined) { out.stores[n] = []; continue; }
    if (!Array.isArray(v)) { out.errors.push(`"${n}" is not a list.`); continue; }
    const k = KEY[n] || 'id', seen = new Set(), good = []; let bad = 0, dup = 0;
    for (const r of v) {
      if (!r || typeof r !== 'object' || r[k] == null || r[k] === '') { bad++; continue; }
      if (seen.has(r[k])) dup++; seen.add(r[k]); good.push(r);
    }
    if (bad) out.errors.push(`"${n}" has ${bad} record(s) without a valid ${k}.`);
    if (dup) out.warnings.push(`"${n}" has ${dup} duplicate record(s); the last one is kept.`);
    out.stores[n] = good;
  }
  if (out.errors.length) return out;
  const rids = new Set(out.stores.rounds.map(r => r.id)), aids = new Set(out.stores.assessments.map(r => r.id));
  const sc = out.stores.screenings.filter(s => rids.has(s.roundId));
  if (sc.length < out.stores.screenings.length) { out.warnings.push(`${out.stores.screenings.length - sc.length} screening record(s) without a round will be skipped.`); out.stores.screenings = sc; }
  const ar = out.stores.assessmentRows.filter(r => aids.has(r.assessmentId));
  if (ar.length < out.stores.assessmentRows.length) { out.warnings.push(`${out.stores.assessmentRows.length - ar.length} assessment row(s) without an assessment will be skipped.`); out.stores.assessmentRows = ar; }
  if (!out.stores.nodes.length) out.warnings.push('This backup has no syllabus data. The built-in FAR index will load fresh, and your ticks are kept where file numbers match.');
  for (const n of DATA_STORES) out.counts[n] = out.stores[n].length;
  out.info = { exportedAt: o.exportedAt || null, schemaVersion: sv, format: o.backupFormat || 1 };
  out.ok = true;
  return out;
}
// Meta after a restore: current schema version; seeded flag only if the backup has syllabus data (otherwise re-seed).
export function prepareMeta(meta, curVersion, curCreatedAt, hasNodes) {
  const m = (meta || []).filter(r => r.key !== 'schemaVersion' && (hasNodes || r.key !== 'seeded2'));
  m.push({ key: 'schemaVersion', value: curVersion });
  if (!m.some(r => r.key === 'createdAt')) m.push({ key: 'createdAt', value: curCreatedAt || new Date().toISOString() });
  if (hasNodes && !m.some(r => r.key === 'seeded2')) m.push({ key: 'seeded2', value: new Date().toISOString() });
  return m;
}
export const csvCell = v => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formulas
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (head, rows) => '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const r1 = x => Math.round(x * 10) / 10;
export function screeningCsv(rounds, screenings, nodes) {
  const N = new Map(nodes.map(n => [n.id, n])), R = new Map(rounds.map(r => [r.id, r]));
  const rows = screenings.filter(s => R.has(s.roundId)).map(s => {
    const r = R.get(s.roundId), g = N.get(s.groupId) || {}, t = N.get(g.parent) || {};
    return [r.name, r.date, r.source || '', r.subject, t.name || '', g.name || '(removed subtopic)', s.correct, s.total, r1(100 * s.correct / s.total)];
  }).sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])));
  return toCsv(['Round', 'Date', 'Source', 'Subject', 'Topic', 'Subtopic', 'Correct', 'Total', 'Score %'], rows);
}
export function assessmentCsv(assessments, rowsAll, nodes, types, cats) {
  const N = new Map(nodes.map(n => [n.id, n])), by = new Map();
  for (const r of rowsAll) (by.get(r.assessmentId) || by.set(r.assessmentId, []).get(r.assessmentId)).push(r);
  const rows = [];
  for (const a of assessments) {
    const ty = (types.find(t => t.id === a.typeId) || {}).name || '(removed type)';
    const mk = Object.entries(a.errorCounts || {}).map(([k, n]) => `${(cats.find(c => c.id === k) || { name: '(removed category)' }).name}: ${n}`).join('; ');
    for (const r of by.get(a.id) || []) {
      const g = N.get(r.groupId) || {}, t = N.get(g.parent) || {}, att = r.mode === 'count' ? r.total - (r.unanswered || 0) : null;
      rows.push([a.name, ty, a.subject, a.date, a.time || '', `${a.attemptKind} #${a.attemptNo}`, a.minutes, a.difficulty || '', a.expected, t.name || '', g.name || '(removed subtopic)', r.mode,
        r.mode === 'count' ? r.correct : null, r.mode === 'count' ? (r.unanswered || 0) : null, r.mode === 'count' ? r.total : null,
        r.mode === 'count' ? r1(100 * r.correct / r.total) : r.pct, att > 0 ? r1(100 * r.correct / att) : null, mk, a.notes || '', a.correctiveAction || '']);
    }
  }
  rows.sort((a, b) => String(a[3]).localeCompare(String(b[3])) || String(a[0]).localeCompare(String(b[0])));
  return toCsv(['Assessment', 'Type', 'Subject', 'Date', 'Time', 'Attempt', 'Minutes', 'Difficulty', 'Expected %', 'Topic', 'Subtopic', 'Entry mode', 'Correct', 'Unanswered', 'Total', 'Score %', 'Accuracy %', 'Mistakes (whole assessment)', 'Notes', 'Corrective action'], rows);
}
export const daysSince = (iso, now) => (now - new Date(iso)) / 864e5;
export function reminderDue(lastBackupAt, createdAt, days, now = new Date()) {
  if (!days) return false;
  const ref = lastBackupAt || createdAt;
  return !!ref && daysSince(ref, now) >= days;
}
export function sessionsCsv(sessions, nodes) {
  const N = new Map(nodes.map(n => [n.id, n]));
  const rows = sessions.filter(s => !s.removedAt).sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(s => [s.date, s.subject, s.minutes, s.activity, (N.get(s.gid) || {}).name || '', s.note || '']);
  return toCsv(['Date', 'Subject', 'Minutes', 'Activity', 'Subtopic', 'Note'], rows);
}
