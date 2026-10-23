import { readFileSync } from 'fs';
import assert from 'assert';
import { seedNodes, kidsOf, filesUnder, markRemoved, restore, nextOrder, progress, daysLeft, COUNTED } from '../js/model.js';
const items = JSON.parse(readFileSync(new URL('../data/far-index.json', import.meta.url)));
assert(items.length > 90); assert.equal(new Set(items.map(i => i.id)).size, items.length);
// seed: deterministic and idempotent
const a = seedNodes(items), b = seedNodes(items);
assert.deepEqual(a, b, 'seed deterministic');
assert.equal(new Set(a.map(n => n.id)).size, a.length, 'unique node ids');
assert.equal(a.filter(n => n.kind === 'file').length, items.length, 'all files seeded with original ids');
assert(a.filter(n => n.kind === 'topic').length >= 10);
const none = progress(items, () => false); assert.equal(none.done, 0);
assert.equal(items.filter(i => COUNTED.has(i.status)).length, none.total);
// remove / restore
let kids = kidsOf(a); const topic = kids.get('root:FAR')[1];
const before = filesUnder(topic.id, kids).length; assert(before > 0);
const changed = markRemoved(a, topic.id, '2026-01-01T00:00:00Z');
assert(changed.length > before, 'topic + groups + files marked');
kids = kidsOf(a); assert.equal(kids.get('root:FAR').find(t => t.id === topic.id), undefined, 'hidden after removal');
restore(a, topic.id); kids = kidsOf(a);
assert.equal(filesUnder(topic.id, kids).length, before, 'restored');
const grp = kids.get(topic.id)[0]; markRemoved(a, grp.id, 't1'); markRemoved(a, topic.id, 't2'); restore(a, topic.id);
assert(!(kidsOf(a).get(topic.id) || []).some(g => g.id === grp.id), 'child removed earlier stays removed');
// ordering and countdown
assert.equal(nextOrder([], null, 'AFAR'), 0);
assert.equal(nextOrder(a, null, 'FAR'), 1 + Math.max(...a.filter(n => !n.parent).map(n => n.order)));
assert.equal(daysLeft(''), null); assert.equal(daysLeft('2026-10-30', new Date(2026, 9, 23, 15)), 7);
assert.equal(daysLeft('2026-10-23', new Date(2026, 9, 23, 23)), 0); assert(daysLeft('2026-10-01', new Date(2026, 9, 23)) < 0);
console.log('PASS: model tests', { files: items.length, nodes: a.length });
// ---- Package 3 ----
import { DEFAULT_SCREEN, screenGroups, validateEntry, scoreOf, band, isReliable, hitsFor, allocate } from '../js/model.js';
const cfg = DEFAULT_SCREEN;
assert.deepEqual(cfg, { weakBelow: 85, strongFrom: 92, minQ: 10 });
assert.equal(screenGroups(seedNodes(items), 'FAR').length, 31, '31 screenable FAR groups (verified against the source index)');
assert.equal(screenGroups(seedNodes(items), 'AFAR').length, 0);
assert.equal(band(scoreOf(849, 1000), cfg), 'Weak'); assert.equal(band(scoreOf(17, 20), cfg), 'Developing'); // 85 exactly
assert.equal(band(scoreOf(919, 1000), cfg), 'Developing'); assert.equal(band(scoreOf(23, 25), cfg), 'Strong'); // 92 exactly
assert.equal(isReliable(9, cfg), false); assert.equal(isReliable(10, cfg), true);
for (const [c, t] of [['', '5'], ['x', '5'], ['3', '0'], ['6', '5'], ['-1', '5'], ['2.5', '5']]) assert.equal(validateEntry(c, t).ok, false, `${c}/${t}`);
assert.deepEqual(validateEntry('3', '5'), { ok: true, correct: 3, total: 5 });
const al = allocate([{ id: 'A', score: 60, size: 5 }, { id: 'B', score: 80, size: 4 }, { id: 'C', score: 95, size: 3 }], 10, 92);
assert(Math.abs(al.get('A') - 160 / 208 * 10) < 1e-9 && Math.abs(al.get('B') - 48 / 208 * 10) < 1e-9 && al.get('C') === 0, 'worked example');
assert(Math.abs([...al.values()].reduce((a, b) => a + b, 0) - 10) < 1e-9, 'sums to hours');
assert.equal([...allocate([{ id: 'X', score: 95, size: 2 }], 10, 92).values()][0], 0, 'all strong -> 0');
assert.equal([...allocate([{ id: 'X', score: 50, size: 2 }], NaN, 92).values()][0], 0, 'no hours -> 0');
const r1 = { id: 'r1' }, r2 = { id: 'r2' };
const sm = new Map([['r1|g', { total: 10, correct: 5 }], ['r2|g', { total: 12, correct: 9 }], ['r1|h', { total: 0, correct: 0 }]]);
assert.equal(hitsFor('g', [r1, r2], sm).length, 2); assert.equal(hitsFor('g', [r1, r2], sm).at(-1).round.id, 'r2', 'latest round wins');
assert.equal(hitsFor('h', [r1, r2], sm).length, 0, 'total 0 = not screened');
console.log('PASS: package 3 tests');
