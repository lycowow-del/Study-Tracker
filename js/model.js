// Pure functions (no DOM/IndexedDB) so they can be tested in Node.
export const COUNTED = new Set(['Core', 'Visitor', 'Gap']); // Optional and Reserved are shown but not counted
export const SUBJECTS = ['FAR', 'AFAR', 'RFBT', 'TAX', 'AUD', 'MAS'];
export const DEFAULT_FLAGS = [
  { id: 'f-review', name: 'Needs review', color: '#ffb454', order: 0 },
  { id: 'f-confusing', name: 'Confusing', color: '#ff6b6b', order: 1 },
  { id: 'f-important', name: 'Important', color: '#6ab0ff', order: 2 }];
export const topicId = (s, t) => `t:${s}:${t}`;
export const groupId = (s, t, g) => `g:${s}:${t}|${g}`;
// Flat seed rows -> hierarchical nodes. Deterministic ids, so seeding twice yields identical records.
export function seedNodes(items, subject = 'FAR') {
  const out = new Map(), cnt = {};
  const next = p => (cnt[p] = (cnt[p] ?? -1) + 1);
  for (const it of items) {
    const tid = topicId(subject, it.topic), gid = groupId(subject, it.topic, it.group);
    if (!out.has(tid)) out.set(tid, { id: tid, subject, kind: 'topic', parent: null, name: it.topic, order: next('root'), removedAt: null });
    if (!out.has(gid)) out.set(gid, { id: gid, subject, kind: 'group', parent: tid, name: it.group, order: next(tid), removedAt: null });
    out.set(it.id, { id: it.id, subject, kind: 'file', parent: gid, name: it.name, status: it.status, tags: it.tags, note: it.note, order: next(gid), removedAt: null });
  }
  return [...out.values()];
}
export function kidsOf(nodes) {
  const m = new Map();
  for (const n of nodes) {
    if (n.removedAt) continue;
    const k = n.parent || 'root:' + n.subject;
    (m.get(k) || m.set(k, []).get(k)).push(n);
  }
  for (const a of m.values()) a.sort((x, y) => x.order - y.order);
  return m;
}
export function filesUnder(id, kids) {
  const out = [], walk = i => { for (const c of kids.get(i) || []) c.kind === 'file' ? out.push(c) : walk(c.id); };
  walk(id); return out;
}
export function descendants(id, nodes) {
  const by = new Map(), out = [];
  for (const n of nodes) (by.get(n.parent) || by.set(n.parent, []).get(n.parent)).push(n);
  const walk = i => { for (const c of by.get(i) || []) { out.push(c); walk(c.id); } };
  walk(id); return out;
}
// Soft delete: marks the node and its still-active descendants; returns the changed nodes to persist.
export function markRemoved(nodes, id, ts) {
  const root = nodes.find(n => n.id === id);
  const ds = descendants(id, nodes).filter(n => !n.removedAt);
  const ch = [root, ...ds];
  for (const n of ch) { n.removedAt = ts; n.removedBy = id; }
  return ch;
}
export function restore(nodes, id) {
  const ch = nodes.filter(n => n.removedBy === id);
  for (const n of ch) { n.removedAt = null; n.removedBy = null; }
  return ch;
}
export const nextOrder = (nodes, parent, subject) =>
  1 + Math.max(-1, ...nodes.filter(n => n.parent === parent && (parent || n.subject === subject)).map(n => n.order));
export function progress(items, isDone) {
  const c = items.filter(i => COUNTED.has(i.status));
  const done = c.filter(i => isDone(i.id)).length;
  return { done, total: c.length, pct: c.length ? Math.round(100 * done / c.length) : 0 };
}
export function daysLeft(date, now = new Date()) {
  if (!date) return null;
  const t = new Date(date + 'T00:00:00'), n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((t - n) / 864e5);
}

// ---- Package 3: screening ----
export const DEFAULT_SCREEN = { weakBelow: 85, strongFrom: 92, minQ: 10 };
// Subtopic groups that hold at least one counted file (Core/Visitor/Gap), in syllabus order.
export function screenGroups(nodes, subject) {
  const kids = kidsOf(nodes.filter(n => n.subject === subject)), out = [];
  for (const t of kids.get('root:' + subject) || []) for (const g of kids.get(t.id) || []) {
    if (g.kind !== 'group') continue;
    const files = (kids.get(g.id) || []).filter(f => f.kind === 'file' && COUNTED.has(f.status));
    if (files.length) out.push({ topic: t, group: g, files, size: files.length });
  }
  return out;
}
export function validateEntry(cs, ts) {
  const ok = s => /^\d+$/.test(String(s).trim());
  if (!ok(cs) || !ok(ts)) return { ok: false, msg: 'Enter whole numbers only.' };
  const correct = +cs, total = +ts;
  if (total < 1) return { ok: false, msg: 'Total must be at least 1.' };
  if (correct > total) return { ok: false, msg: 'Correct cannot exceed total.' };
  return { ok: true, correct, total };
}
export const scoreOf = (c, t) => (100 * c) / t;
export const band = (sc, cfg) => sc < cfg.weakBelow ? 'Weak' : sc >= cfg.strongFrom ? 'Strong' : 'Developing';
export const isReliable = (total, cfg) => total >= cfg.minQ;
// Rounds must be sorted oldest -> newest. Returns rounds that have data for the group.
export function hitsFor(groupId, rounds, scr) {
  const out = [];
  for (const r of rounds) { const s = scr.get(r.id + '|' + groupId); if (s && s.total > 0) out.push({ round: r, rec: s }); }
  return out;
}
// weight = (strongFrom - score) x content size (counted files), zero at or above Strong.
export function allocate(rows, hours, strongFrom) {
  const w = rows.map(r => Math.max(0, strongFrom - r.score) * r.size), sum = w.reduce((a, b) => a + b, 0);
  return new Map(rows.map((r, i) => [r.id, hours > 0 && sum > 0 ? hours * w[i] / sum : 0]));
}

// ---- Package 4: assessments ----
export const DEFAULT_TYPES = [{ id: 't-quiz', name: 'School/RC quiz', activity: 'Quiz' }, { id: 't-preboard', name: 'Pre-board / mock exam', activity: 'Mock exam' }, { id: 't-practice', name: 'Practice set', activity: 'Problem drill' }, { id: 't-drill', name: 'Theory/problem-solving drill', activity: 'Problem drill' }];
// ---- Package 8: study tool registry (a tool is an assessment type plus settings; the scoring engine is always manual entry) ----
export const ACTIVITIES = ['Quiz', 'Problem drill', 'Flashcards', 'Mock exam', 'Recall session', 'Other'];
export const normTool = t => ({ purpose: '', activity: 'Quiz', entry: 'both', countsTowardMastery: true, trackTime: true, enabled: true, ...t, subjects: Array.isArray(t.subjects) ? t.subjects : [] });
// Tools offered when logging: enabled and valid for the subject; the entry's current tool is always kept so old entries still display.
export const toolsFor = (tools, subject, currentId = '') => tools.filter(t => t.id === currentId || (t.enabled && (!t.subjects.length || t.subjects.includes(subject))));
export const DEFAULT_ERRCATS = [{ id: 'e-concept', name: 'Concept gap' }, { id: 'e-calc', name: 'Computation or careless error' }, { id: 'e-misread', name: 'Misread the question' }, { id: 'e-time', name: 'Ran out of time' }];
// A breakdown row is {mode:'count', correct, total, unanswered} or {mode:'pct', pct}.
export function validateRow(r) {
  if (r.mode === 'pct') {
    const s = String(r.pct ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s) || Number(s) > 100) return { ok: false, msg: 'Percentage must be between 0 and 100.' };
    return { ok: true, row: { mode: 'pct', pct: Number(s) } };
  }
  const un = String(r.unanswered ?? '').trim() === '' ? '0' : String(r.unanswered).trim();
  const v = validateEntry(r.correct, r.total);
  if (!v.ok) return v;
  if (!/^\d+$/.test(un)) return { ok: false, msg: 'Enter whole numbers only.' };
  if (v.correct + Number(un) > v.total) return { ok: false, msg: 'Correct plus unanswered cannot exceed total.' };
  return { ok: true, row: { mode: 'count', correct: v.correct, total: v.total, unanswered: Number(un) } };
}
export function rowStats(r) {
  if (r.mode === 'pct') return { score: r.pct, accuracy: null, n: null };
  const att = r.total - (r.unanswered || 0);
  return { score: 100 * r.correct / r.total, accuracy: att > 0 ? 100 * r.correct / att : null, n: r.total, incorrect: r.total - r.correct - (r.unanswered || 0) };
}
// Question-weighted overall from count rows only; percentage-only rows (n unknown) are excluded unless they are all there is.
export function overall(rows) {
  const cr = rows.filter(r => r.mode !== 'pct'), pr = rows.filter(r => r.mode === 'pct');
  const C = cr.reduce((a, r) => a + r.correct, 0), T = cr.reduce((a, r) => a + r.total, 0), U = cr.reduce((a, r) => a + (r.unanswered || 0), 0);
  const out = { C, T, U, incorrect: T - C - U, nUnknown: pr.length };
  if (T > 0) { out.mode = 'weighted'; out.score = 100 * C / T; out.accuracy = T - U > 0 ? 100 * C / (T - U) : null; }
  else if (pr.length) { out.mode = 'unweighted'; out.score = pr.reduce((a, r) => a + r.pct, 0) / pr.length; out.accuracy = null; }
  else { out.mode = 'none'; out.score = null; out.accuracy = null; }
  return out;
}
export function validateAssessment(d, rows, ec) {
  if (!String(d.name || '').trim()) return { ok: false, msg: 'Enter a name.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return { ok: false, msg: 'Enter a valid date.' };
  if (!rows.length) return { ok: false, msg: 'Add at least one subtopic to the breakdown.' };
  if (new Set(rows.map(r => r.groupId)).size !== rows.length) return { ok: false, msg: 'A subtopic appears twice.' };
  const m = String(d.minutes ?? '').trim(); if (m !== '' && !(Number(m) >= 0)) return { ok: false, msg: 'Minutes must be a number of 0 or more.' };
  const e = String(d.expected ?? '').trim(); if (e !== '' && !(Number(e) >= 0 && Number(e) <= 100)) return { ok: false, msg: 'Expected score must be between 0 and 100.' };
  const ov = overall(rows), errs = Object.values(ec).reduce((a, b) => a + b, 0);
  if (ov.mode === 'weighted' && errs > ov.incorrect + ov.U) return { ok: false, msg: `Error counts (${errs}) exceed the wrong or unanswered questions (${ov.incorrect + ov.U}).` };
  return { ok: true };
}
export const signature = (a, rows) => [a.subject, String(a.name || '').trim().toLowerCase(), a.date,
  ...[...rows].sort((x, y) => x.groupId < y.groupId ? -1 : 1).map(r => r.mode === 'pct' ? `${r.groupId}:p${r.pct}` : `${r.groupId}:${r.correct}/${r.total}/${r.unanswered || 0}`)].join('|');
export function attemptInfo(subject, name, list) {
  const n = String(name || '').trim().toLowerCase();
  const prior = n ? list.filter(a => a.subject === subject && String(a.name).trim().toLowerCase() === n).length : 0;
  return { kind: prior > 0 ? 'repeat' : 'first', no: prior + 1 };
}

// ---- Local calendar day helpers (dates in this app are YYYY-MM-DD in the user's own timezone) ----
export const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayNum = (now = new Date()) => Math.floor(Date.parse(localISO(now) + 'T00:00:00Z') / 864e5);
