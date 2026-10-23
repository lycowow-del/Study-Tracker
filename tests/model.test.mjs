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
