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
