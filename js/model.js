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
