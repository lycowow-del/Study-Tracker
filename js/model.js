// Pure functions (no DOM/IndexedDB) so they can be tested in Node.
export const COUNTED = new Set(['Core', 'Visitor', 'Gap']); // Optional and Reserved are shown but not counted
export function buildTree(items) {
  const t = new Map();
  for (const it of items) {
    if (!t.has(it.topic)) t.set(it.topic, new Map());
    const g = t.get(it.topic);
    if (!g.has(it.group)) g.set(it.group, []);
    g.get(it.group).push(it);
  }
  return t;
}
export function progress(items, isDone) {
  const c = items.filter(i => COUNTED.has(i.status));
  const done = c.filter(i => isDone(i.id)).length;
  return { done, total: c.length, pct: c.length ? Math.round(100 * done / c.length) : 0 };
}
