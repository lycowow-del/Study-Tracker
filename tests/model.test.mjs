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
// ---- Package 4 ----
import { validateRow, rowStats, overall, validateAssessment, signature, attemptInfo } from '../js/model.js';
assert.deepEqual(validateRow({ mode: 'count', correct: '7', total: '10', unanswered: '' }), { ok: true, row: { mode: 'count', correct: 7, total: 10, unanswered: 0 } });
for (const r of [{ mode: 'count', correct: '8', total: '10', unanswered: '3' }, { mode: 'count', correct: '1', total: '0', unanswered: '' }, { mode: 'count', correct: '2.5', total: '5', unanswered: '' },
  { mode: 'count', correct: '2', total: '5', unanswered: 'x' }, { mode: 'pct', pct: '101' }, { mode: 'pct', pct: '' }, { mode: 'pct', pct: '-5' }]) assert.equal(validateRow(r).ok, false, JSON.stringify(r));
assert.deepEqual(validateRow({ mode: 'pct', pct: '82.5' }), { ok: true, row: { mode: 'pct', pct: 82.5 } });
const st = rowStats({ mode: 'count', correct: 6, total: 10, unanswered: 2 });
assert.equal(st.score, 60); assert.equal(st.accuracy, 75); assert.equal(st.incorrect, 2);
assert.equal(rowStats({ mode: 'count', correct: 0, total: 5, unanswered: 5 }).accuracy, null, 'nothing attempted');
const rowsMix = [{ mode: 'count', correct: 6, total: 10, unanswered: 2 }, { mode: 'count', correct: 9, total: 10, unanswered: 0 }, { mode: 'pct', pct: 50 }];
const ov = overall(rowsMix);
assert.equal(ov.C, 15); assert.equal(ov.T, 20); assert.equal(ov.U, 2); assert.equal(ov.score, 75); assert.equal(ov.nUnknown, 1); assert.equal(ov.mode, 'weighted');
assert(Math.abs(ov.accuracy - 100 * 15 / 18) < 1e-9);
const onlyPct = overall([{ mode: 'pct', pct: 80 }, { mode: 'pct', pct: 60 }]); assert.equal(onlyPct.mode, 'unweighted'); assert.equal(onlyPct.score, 70);
const base = { name: 'Pre-board 1', date: '2026-10-23', minutes: '90', expected: '70' };
const rws = rowsMix.map((r, i) => ({ groupId: 'g' + i, ...r }));
assert.equal(validateAssessment(base, rws, {}).ok, true);
assert.equal(validateAssessment({ ...base, name: ' ' }, rws, {}).ok, false);
assert.equal(validateAssessment(base, [], {}).ok, false, 'breakdown required');
assert.equal(validateAssessment({ ...base, expected: '120' }, rws, {}).ok, false);
assert.equal(validateAssessment({ ...base, date: '23/10/2026' }, rws, {}).ok, false);
assert.equal(validateAssessment(base, rws, { a: 3, b: 2 }).ok, true, '5 <= 3 wrong + 2 unanswered');
assert.equal(validateAssessment(base, rws, { a: 4, b: 2 }).ok, false, '6 > 5');
assert.equal(validateAssessment(base, [rws[0], { ...rws[1], groupId: 'g0' }], {}).ok, false, 'duplicate subtopic');
const A = { subject: 'FAR', name: 'Pre-Board 1', date: '2026-10-23' };
assert.equal(signature(A, rws), signature({ ...A, name: ' pre-board 1 ' }, [...rws].reverse()), 'order/case insensitive');
assert.notEqual(signature(A, rws), signature({ ...A, date: '2026-10-24' }, rws));
const prior = [{ subject: 'FAR', name: 'pre-board 1' }, { subject: 'FAR', name: 'Quiz 2' }, { subject: 'TAX', name: 'Pre-board 1' }];
assert.deepEqual(attemptInfo('FAR', 'Pre-Board 1', prior), { kind: 'repeat', no: 2 });
assert.deepEqual(attemptInfo('FAR', 'New one', prior), { kind: 'first', no: 1 }); assert.deepEqual(attemptInfo('FAR', '', prior), { kind: 'first', no: 1 });
console.log('PASS: package 4 tests');
// ---- Package 5 ----
import { validateBackup, prepareMeta, csvCell, toCsv, screeningCsv, assessmentCsv, reminderDue, DATA_STORES } from '../js/backup.js';
const V = 4;
const good = { app: 'cpale-tracker', backupFormat: 2, schemaVersion: 4, exportedAt: '2026-10-23T00:00:00Z',
  meta: [{ key: 'schemaVersion', value: 4 }, { key: 'createdAt', value: '2026-10-01T00:00:00Z' }, { key: 'seeded2', value: 'x' }], settings: [{ key: 'screening', weakBelow: 85 }, { key: 'backupMeta', reminderDays: 7 }],
  progress: [{ id: '211', done: true, link: 'a' }], subjects: [{ id: 'FAR' }], nodes: seedNodes(items.slice(0, 6)), flags: [{ id: 'f1' }],
  rounds: [{ id: 'r1', subject: 'FAR', name: 'Baseline', date: '2026-10-02', removedAt: null }], screenings: [{ id: 'r1|g', roundId: 'r1', groupId: 'g', correct: 3, total: 4 }],
  assessments: [{ id: 'a1', subject: 'FAR', name: 'Q1', typeId: 't-quiz', date: '2026-10-03', attemptKind: 'first', attemptNo: 1, errorCounts: { 'e-calc': 2 }, removedAt: null }],
  assessmentRows: [{ id: 'a1|g', assessmentId: 'a1', groupId: 'g', mode: 'count', correct: 6, total: 10, unanswered: 2 }] };
good.sessions = [{ id: 'u1', date: '2026-10-02', subject: 'FAR', minutes: 30 }]; good.plan = [{ id: 'p1', date: '2026-10-25' }];
let v = validateBackup(JSON.stringify(good), V);
assert(v.ok, v.errors.join()); assert.equal(v.warnings.length, 0);
for (const n of DATA_STORES) assert.deepEqual(v.stores[n], good[n], 'round trip ' + n);
assert.equal(validateBackup('not json', V).ok, false);
assert.equal(validateBackup(JSON.stringify({ app: 'other' }), V).ok, false);
assert(/newer/.test(validateBackup(JSON.stringify({ ...good, schemaVersion: 99 }), V).errors[0]), 'newer version refused');
assert.equal(validateBackup(JSON.stringify({ ...good, nodes: {} }), V).ok, false, 'store must be a list');
assert.equal(validateBackup(JSON.stringify({ ...good, progress: [{ done: true }] }), V).ok, false, 'missing id');
assert.equal(validateBackup(JSON.stringify({ ...good, meta: [{ value: 1 }] }), V).ok, false, 'missing meta key');
v = validateBackup(JSON.stringify({ ...good, screenings: [...good.screenings, { id: 'x|g', roundId: 'x', groupId: 'g', correct: 1, total: 2 }], assessmentRows: [...good.assessmentRows, { id: 'z|g', assessmentId: 'z', groupId: 'g', mode: 'pct', pct: 5 }] }), V);
assert(v.ok && v.stores.screenings.length === 1 && v.stores.assessmentRows.length === 1 && v.warnings.length === 2, 'orphans skipped with warnings');
const p1 = { app: 'cpale-tracker', exportedAt: '2026-10-22T00:00:00Z', meta: [{ key: 'schemaVersion', value: 1 }, { key: 'createdAt', value: 'c' }], settings: [], progress: [{ id: '211', done: true, link: '' }], errorLog: [{ id: 1, message: 'x' }] };
v = validateBackup(JSON.stringify(p1), V);
assert(v.ok && v.info.schemaVersion === 1 && v.stores.progress.length === 1 && v.stores.nodes.length === 0 && !('errorLog' in v.stores), 'Package 1 export accepted');
assert(v.warnings.some(w => /no syllabus/.test(w)));
// meta preparation
let pm = prepareMeta(p1.meta, 4, 'cur', false); assert(!pm.some(r => r.key === 'seeded2') && pm.find(r => r.key === 'schemaVersion').value === 4);
pm = prepareMeta(good.meta, 4, 'cur', true); assert(pm.filter(r => r.key === 'seeded2').length === 1);
pm = prepareMeta([{ key: 'createdAt', value: 'c' }], 4, 'cur', true); assert(pm.some(r => r.key === 'seeded2'), 'never re-seed over restored nodes');
pm = prepareMeta([], 4, 'cur', false); assert.equal(pm.find(r => r.key === 'createdAt').value, 'cur');
// CSV
assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); assert.equal(csvCell('+1'), "'+1"); assert.equal(csvCell('@a'), "'@a");
assert.equal(csvCell(-5), '-5'); assert.equal(csvCell(null), ''); assert.equal(csvCell(0), '0');
assert(toCsv(['a'], [['1']]).startsWith('\ufeffa\r\n1'));
const nd = [{ id: 't', name: 'Topic' }, { id: 'g', name: 'Sub', parent: 't' }];
const sc = screeningCsv([{ id: 'r1', name: 'Baseline', date: '2026-10-02', subject: 'FAR', source: '=bad' }], [{ roundId: 'r1', groupId: 'g', correct: 3, total: 4 }, { roundId: 'gone', groupId: 'g', correct: 1, total: 1 }], nd).split('\r\n');
assert.equal(sc[0], '\ufeffRound,Date,Source,Subject,Topic,Subtopic,Correct,Total,Score %'); assert.equal(sc[1], "Baseline,2026-10-02,'=bad,FAR,Topic,Sub,3,4,75"); assert.equal(sc.length, 3, 'removed round excluded');
const ac = assessmentCsv([good.assessments[0]], [...good.assessmentRows, { assessmentId: 'a1', groupId: 'g', mode: 'pct', pct: 80 }], nd, [{ id: 't-quiz', name: 'School/RC quiz' }], [{ id: 'e-calc', name: 'Computation' }]).split('\r\n');
assert.equal(ac.length, 4); assert(ac[1].includes('School/RC quiz') && ac[1].includes(',60,75,Computation: 2')); assert(ac[2].includes(',pct,,,,80,,'));
// reminder
const now = new Date('2026-10-23T12:00:00Z');
assert.equal(reminderDue(null, '2026-10-01T00:00:00Z', 14, now), true); assert.equal(reminderDue('2026-10-15T00:00:00Z', 'x', 14, now), false);
assert.equal(reminderDue('2026-10-09T12:00:00Z', null, 14, now), true, 'exactly 14 days'); assert.equal(reminderDue('2026-10-01T00:00:00Z', null, 0, now), false, 'off');
assert.equal(reminderDue(null, null, 14, now), false);
console.log('PASS: package 5 tests');
// ---- Package 6 (core analytics) ----
import { DEFAULT_ANALYTICS, ageDays, factor, buildEvidence, classify, statsFor, analyze, bucket, nextAction } from '../js/analytics.js';
const cA = DEFAULT_ANALYTICS, cS = DEFAULT_SCREEN, NOW = new Date('2026-10-24T12:00:00Z');
const mk = (correct, total, o = {}) => ({ groupId: 'g1', source: 'x' + Math.random(), kind: 'assessment', subject: 'FAR', date: '2026-10-24', attempt: 'first', correct, total, unanswered: 0, difficulty: '', typeId: 't', ...o });
assert.equal(ageDays('2026-08-25', NOW), 60); assert.equal(ageDays('2026-10-24', NOW), 0); assert.equal(ageDays('2026-11-30', NOW), 0, 'future = 0');
assert.equal(factor(mk(1, 1, { date: '2026-08-25' }), cA, NOW), 0.5); assert.equal(factor(mk(1, 1, { date: '2026-06-26' }), cA, NOW), 0.25);
assert.equal(factor(mk(1, 1, { attempt: 'repeat' }), cA, NOW), 0.5);
// worked example from the approved design: 85% -> Developing, Q 30, A 3
const ex = statsFor([mk(6, 10, { kind: 'screening', date: '2026-08-25' }), mk(9, 10), mk(10, 10, { attempt: 'repeat' })], cA, cS, NOW);
assert.equal(ex.S, 85); assert.equal(ex.Q, 30); assert.equal(ex.A, 3); assert.equal(ex.status, 'Developing');
// status boundaries
const stf = (items) => statsFor(items, cA, cS, NOW);
assert.deepEqual([stf([]).status, stf([]).sub], ['Too little evidence', 'Not started']);
assert.equal(stf([mk(9, 9)]).sub, 'Tentative'); assert.equal(stf([mk(5, 10)]).status, 'Weak');
assert.equal(stf([mk(849, 1000)]).status, 'Weak'); assert.equal(stf([mk(17, 20)]).status, 'Developing'); assert.equal(stf([mk(919, 1000)]).status, 'Developing');
assert.equal(stf([mk(23, 25), mk(23, 25)]).status, 'Mastered', '92% exactly, 50 questions, 2 sources');
let sg = stf([mk(23, 25)]); assert.deepEqual([sg.status, sg.sub], ['Too little evidence', 'Strong so far'], 'one source never qualifies');
sg = stf([mk(10, 10), mk(9, 9)]); assert.equal(sg.sub, 'Strong so far', '19 questions'); assert.equal(stf([mk(10, 10), mk(10, 10)]).status, 'Mastered', '20 questions');
// attempt/fade influence
assert(Math.abs(stf([mk(10, 10, { attempt: 'repeat' }), mk(0, 10)]).S - 100 * 5 / 15) < 1e-9, 'repeat counts half');
assert(Math.abs(stf([mk(0, 10, { date: '2026-08-25' }), mk(10, 10)]).S - 100 * 10 / 15) < 1e-9, 'old result fades');
// raw metrics
const m = stf([mk(6, 10, { unanswered: 2 }), mk(8, 10, { attempt: 'repeat', date: '2026-01-01' }), mk(5, 10, { kind: 'screening', unanswered: 0 })]);
assert.equal(m.raw, 100 * 19 / 30); assert.equal(m.accuracy, 100 * 14 / 18); assert.equal(m.unansweredRate, 100 * 2 / 20);
assert.equal(m.firstAcc, 100 * 11 / 20); assert.equal(m.recent, 100 * 11 / 20); assert.equal(m.recentQ, 20); assert.equal(m.lastDate, '2026-10-24');
// evidence building
const ev = buildEvidence({ rounds: [{ id: 'r1', subject: 'FAR', date: '2026-10-01' }, { id: 'r2', subject: 'FAR', date: '2026-10-02', removedAt: 'x' }],
  screenings: [{ roundId: 'r1', groupId: 'g1', correct: 3, total: 4 }, { roundId: 'r2', groupId: 'g1', correct: 1, total: 1 }],
  assessments: [{ id: 'a1', subject: 'FAR', date: '2026-10-03', attemptKind: 'repeat', difficulty: 'Hard', typeId: 't-quiz' }, { id: 'a2', subject: 'FAR', date: '2026-10-04', removedAt: 'x' }],
  rows: [{ assessmentId: 'a1', groupId: 'g1', mode: 'count', correct: 5, total: 6, unanswered: 1 }, { assessmentId: 'a1', groupId: 'g2', mode: 'pct', pct: 80 }, { assessmentId: 'a2', groupId: 'g1', mode: 'count', correct: 1, total: 1 }] });
assert.equal(ev.items.length, 2, 'removed round and assessment ignored'); assert.equal(ev.excluded.g2, 1, 'percent-only counted, not used');
assert.deepEqual(ev.items.map(i => i.attempt), ['first', 'repeat']);
// analyze: breakdown adds up; difficulty filter drops screening
const gp6 = n => ({ group: { id: n }, topic: { id: 't', name: 'T' }, files: [{ id: 'f' + n }], size: 1 });
const A1 = analyze({ groups: [gp6('g1'), gp6('g2'), gp6('g3')], items: [mk(10, 10, { groupId: 'g1' }), mk(10, 10, { groupId: 'g1' }), mk(2, 10, { groupId: 'g2', kind: 'screening' })], excluded: { g3: 2 }, cA, cS, now: NOW });
assert.equal(A1.counts.Mastered + A1.counts.Developing + A1.counts.Weak + A1.counts['Too little evidence'], 3, 'sums to subtopics');
assert.deepEqual([A1.counts.Mastered, A1.counts.Weak, A1.counts.notStarted, A1.excludedPct], [1, 1, 1, 2]);
const A2 = analyze({ groups: [gp6('g1'), gp6('g2')], items: [mk(10, 10, { groupId: 'g1', difficulty: 'Hard' }), mk(2, 10, { groupId: 'g2', kind: 'screening' }), mk(9, 10, { groupId: 'g1', difficulty: 'Easy' })], excluded: {}, cA, cS, now: NOW, difficulty: 'Hard' });
assert.equal(A2.per[0].Q, 10); assert.equal(A2.per[1].sub, 'Not started'); assert.equal(A2.screeningExcluded, 1);
// buckets and actions
const bk = bucket([mk(8, 10, { typeId: 'a' }), mk(10, 10, { typeId: 'a', attempt: 'repeat' }), mk(5, 10, { typeId: 'b' }), mk(9, 9, { kind: 'screening', typeId: '' })], i => i.typeId);
assert.equal(bk.length, 2); assert.deepEqual([bk[0].Q, bk[0].n, bk[0].score, bk[0].first], [20, 2, 90, 80]);
const P = (o) => ({ g: gp6('g1'), ...o });
assert(/Review 1 notes files \(1 ticked\)/.test(nextAction(P({ status: 'Weak' }), cA, cS, NOW, 1)));
assert(/at least 14 days/.test(nextAction(P({ status: 'Developing' }), cA, cS, NOW, 0)));
assert(/about 12 more questions/.test(nextAction(P({ status: 'Too little evidence', sub: 'Tentative', Q: 8 }), cA, { ...cS, minQ: 20 }, NOW, 0)));
assert(/about 15 more questions and 1 more assessment/.test(nextAction(P({ status: 'Too little evidence', sub: 'Strong so far', Q: 5, A: 1 }), cA, cS, NOW, 0)));
assert(/Retention check due/.test(nextAction(P({ status: 'Mastered', lastDate: '2026-08-01' }), cA, cS, NOW, 0))); assert(/Maintain/.test(nextAction(P({ status: 'Mastered', lastDate: '2026-10-20' }), cA, cS, NOW, 0)));
console.log('PASS: package 6 core tests');
// ---- Package 6B ----
import { buildSources, linreg, velocity, consistency, retentionPairs, retentionSummary, calibration, errorShare } from '../js/analytics.js';
const aa = (date, score, o = {}) => ({ kind: 'assessment', attempt: 'first', date, score, total: 10, name: 'A' + date, expected: null, errorCounts: {}, missed: 0, ...o });
const src0 = buildSources({ rounds: [{ id: 'r1', subject: 'FAR', name: 'Baseline', date: '2026-08-20' }, { id: 'r2', subject: 'TAX', name: 'Other', date: '2026-08-21' }, { id: 'r3', subject: 'FAR', name: 'Gone', date: '2026-08-22', removedAt: 'x' }],
  screenings: [{ roundId: 'r1', groupId: 'a', correct: 3, total: 4 }, { roundId: 'r1', groupId: 'b', correct: 5, total: 6 }, { roundId: 'r2', groupId: 'a', correct: 1, total: 1 }, { roundId: 'r3', groupId: 'a', correct: 1, total: 1 }],
  assessments: [{ id: 'x1', subject: 'FAR', name: 'Quiz', date: '2026-09-01', attemptKind: 'first', expected: 70, difficulty: 'Hard', errorCounts: { e: 2 } }, { id: 'x2', subject: 'FAR', name: 'PctOnly', date: '2026-09-02', attemptKind: 'first' }],
  rows: [{ assessmentId: 'x1', mode: 'count', correct: 6, total: 10 }, { assessmentId: 'x2', mode: 'pct', pct: 90 }], subject: 'FAR' });
assert.equal(src0.length, 2, 'other subject, removed round and percent-only assessment excluded');
assert.deepEqual([src0[0].name, src0[0].correct, src0[0].total, src0[0].score], ['Baseline', 8, 10, 80]); assert.deepEqual([src0[1].kind, src0[1].score, src0[1].missed, src0[1].expected], ['assessment', 60, 4, 70]);
let reg = linreg([{ x: 0, y: 50 }, { x: 10, y: 60 }, { x: 20, y: 70 }]); assert(Math.abs(reg.slope - 1) < 1e-12 && Math.abs(reg.intercept - 50) < 1e-9);
assert.equal(linreg([{ x: 1, y: 1 }]), null); assert.equal(linreg([{ x: 1, y: 1 }, { x: 1, y: 2 }]), null);
const four = [aa('2026-09-01', 50), aa('2026-09-11', 60), aa('2026-09-21', 70), aa('2026-10-01', 80)];
let vl = velocity(four, 92, '2026-12-23', NOW);
assert(vl.ok && Math.abs(vl.per30 - 30) < 1e-9 && vl.n === 4 && vl.span === 30 && Math.abs(vl.current - 70) < 1e-9 && Math.abs(vl.needed - 11) < 1e-9, JSON.stringify(vl));
assert.equal(velocity(four, 92, '', NOW).needed, null); assert.equal(velocity(four, 92, '2026-10-01', NOW).needed, 'passed');
assert.equal(velocity(four.slice(0, 3), 92, '', NOW).ok, false, '3 results'); assert.equal(velocity([aa('2026-10-01', 50), aa('2026-10-03', 60), aa('2026-10-05', 70), aa('2026-10-07', 80)], 92, '', NOW).ok, false, 'span under 14 days');
assert.equal(velocity([...four.slice(0, 3), aa('2026-10-01', 80, { attempt: 'repeat' })], 92, '', NOW).ok, false, 'repeats and screening ignored');
let cs = consistency([aa('2026-09-01', 99), aa('2026-09-02', 60), aa('2026-09-03', 70), aa('2026-09-04', 80), aa('2026-09-05', 70), aa('2026-09-06', 70)]);
assert(cs.ok && cs.n === 5 && cs.min === 60 && cs.max === 80 && Math.abs(cs.mean - 70) < 1e-9 && Math.abs(cs.sd - Math.sqrt(50)) < 1e-9, 'last 5 only: sd sqrt(50)');
assert.equal(consistency([aa('2026-09-01', 70), aa('2026-09-02', 70)]).ok, false); assert.equal(consistency([aa('a', 70), aa('b', 70), aa('c', 70)]).sd, 0);
// retention
const gR = [{ group: { id: 'g1' } }], it = (date, c, t) => ({ groupId: 'g1', date, correct: c, total: t });
let rp = retentionPairs([it('2026-09-01', 6, 10), it('2026-09-10', 8, 10), it('2026-09-20', 9, 10), it('2026-09-05', 1, 4)], gR, cA);
assert.equal(rp.length, 1); assert.deepEqual([rp[0].gap, rp[0].before, rp[0].after, rp[0].change], [19, 60, 90, 30], '9-day gap skipped, 4-question result ignored');
rp = retentionPairs([it('2026-09-01', 6, 10), it('2026-09-10', 8, 10), it('2026-09-20', 9, 10), it('2026-10-10', 7, 10)], gR, cA);
assert.deepEqual([rp[0].gap, rp[0].change], [20, -20], 'latest result is compared with the most recent qualifying earlier one');
assert.equal(retentionPairs([it('2026-09-01', 6, 10), it('2026-09-14', 8, 10)], gR, cA).length, 0, '13 days is not enough');
assert.equal(retentionPairs([it('2026-09-01', 6, 10), it('2026-09-15', 8, 10)], gR, cA).length, 1, 'exactly 14 days counts');
const rsum = retentionSummary([{ change: 30 }, { change: -10 }, { change: 0 }]); assert.deepEqual([rsum.n, rsum.mean, rsum.improved, rsum.declined], [3, 20 / 3, 1, 1]); assert.equal(retentionSummary([]).mean, null);
// calibration
let cb = calibration([aa('1', 75, { expected: 70 }), aa('2', 70, { expected: 80 }), aa('3', 95, { expected: 90 }), aa('4', 99, { expected: 10, attempt: 'repeat' }), aa('5', 50)]);
assert(cb.ok && cb.n === 3 && Math.abs(cb.mean) < 1e-9, 'repeats and missing expected ignored: gaps +5 -10 +5');
assert.equal(calibration([aa('1', 75, { expected: 70 })]).ok, false);
// error share
const er6 = errorShare([aa('1', 50, { errorCounts: { c: 3, m: 1 }, missed: 5 }), aa('2', 50, { errorCounts: { c: 1 }, missed: 3 }), aa('3', 50, { missed: 9 }), { ...aa('4', 50), kind: 'screening', errorCounts: { c: 9 } }], [{ id: 'c', name: 'Concept' }]);
assert.deepEqual([er6.n, er6.categorized, er6.missed], [2, 5, 8]); assert.deepEqual(er6.rows.map(r => [r.name, r.count, r.share]), [['Concept', 4, 80], ['(removed category)', 1, 20]]);
assert.deepEqual(errorShare([], []).rows, []);
console.log('PASS: package 6B tests');
// ---- Package 7 ----
import { recommend, deadlines, activityFeed, weekMinutes } from '../js/reco.js';
const pp = (id, status, o = {}) => ({ g: { group: { id, name: 'N-' + id }, size: 3, files: [] }, status, sub: '', S: 50, Q: 20, A: 2, lastDate: '2026-10-20', ...o });
const R0 = o => recommend({ per: [], cS, cA, now: NOW, hasScreening: true, subject: 'FAR', ...o });
let rc = R0({ hasScreening: false, per: [pp('w1', 'Weak', { S: 70 })] });
assert.equal(rc.items[0].kind, 'baseline'); assert.equal(R0({ per: [pp('w1', 'Weak')] }).items.some(r => r.kind === 'baseline'), false);
rc = R0({ per: [pp('a', 'Weak', { S: 80 }), pp('b', 'Weak', { S: 40 }), pp('c', 'Developing', { S: 88, lastDate: '2026-09-01' }), pp('d', 'Too little evidence', { sub: 'Tentative', S: 90, Q: 4 }), pp('e', 'Too little evidence', { sub: 'Not started', S: null, Q: 0, lastDate: '' })] });
assert.deepEqual(rc.items.map(r => r.id), ['weak:b', 'weak:a', 'retest:c', 'evidence:d', 'evidence:e'], 'weakest first, then retest, thin evidence, not started');
assert(/40(\.0)?%/.test(rc.items[0].why) && /85%/.test(rc.items[0].why), 'why quotes the numbers');
assert.equal(R0({ per: [pp('c', 'Developing', { S: 88, lastDate: '2026-10-15' })] }).items.length, 0, 'developing, only 9 days old: not due');
assert.equal(R0({ per: [pp('c', 'Developing', { S: 88, lastDate: '2026-10-10' })] }).items[0].kind, 'retest', '14 days: due');
assert.equal(R0({ per: [pp('m', 'Mastered', { S: 95, lastDate: '2026-09-01' })] }).items[0].id, 'retain:m'); assert.equal(R0({ per: [pp('m', 'Mastered', { S: 95, lastDate: '2026-10-20' })] }).items.length, 0);
rc = R0({ per: [pp('a', 'Weak'), pp('b', 'Weak', { S: 60 })], snoozed: { 'weak:a': '2026-10-30T00:00:00Z', 'weak:b': '2026-10-01T00:00:00Z' } });
assert.deepEqual([rc.items.map(r => r.id), rc.snoozed.map(r => r.id)], [['weak:b'], ['weak:a']], 'future snooze hides, expired snooze returns');
const dl7 = deadlines([{ id: 'TAX', targetDate: '2027-01-10' }, { id: 'FAR', targetDate: '2026-10-20' }, { id: 'AUD', targetDate: '' }], '2027-10-01', NOW);
assert.deepEqual(dl7.map(x => [x.label, x.days]), [['FAR target', -4], ['TAX target', 78], ['CPALE exam', 342]]); assert.deepEqual(deadlines([], '', NOW), []);
const fd = activityFeed({ assessments: [{ name: 'Q1', subject: 'FAR', updatedAt: '2026-10-22T10:00:00Z' }, { name: 'Gone', subject: 'FAR', updatedAt: '2026-10-23T10:00:00Z', removedAt: 'x' }], rounds: [{ name: 'Base', subject: 'FAR', createdAt: '2026-10-21T10:00:00Z' }],
  progress: [{ id: 'n1', done: true, updatedAt: '2026-10-23T09:00:00Z' }, { id: 'n2', done: false, updatedAt: '2026-10-23T11:00:00Z' }, { id: 'n3', done: true, updatedAt: '2026-10-24T00:00:00Z' }], nodes: [{ id: 'n1', name: 'File one' }, { id: 'n3', name: 'Removed', removedAt: 'x' }], limit: 3 });
assert.deepEqual(fd.map(e => e.text), ['Notes updated: File one', 'Logged assessment: Q1 (FAR)', 'Created screening round: Base (FAR)'], 'newest first, removed and unticked ignored');
const wm = weekMinutes([{ date: '2026-10-24', minutes: 60 }, { date: '2026-10-18', minutes: 30 }, { date: '2026-10-17', minutes: 99 }, { date: '2026-10-20', minutes: null }, { date: '2026-10-21', minutes: 15, removedAt: 'x' }], NOW);
assert.deepEqual(wm, { minutes: 90, count: 2 }, 'today and 6 days back count; day 7 does not');
console.log('PASS: package 7 tests');
// ---- Package 8 ----
import { ACTIVITIES, normTool, toolsFor } from '../js/model.js';
const old = normTool({ id: 't-quiz', name: 'School/RC quiz' });
assert.deepEqual([old.activity, old.entry, old.countsTowardMastery, old.trackTime, old.enabled, old.subjects, old.purpose], ['Quiz', 'both', true, true, true, [], ''], 'old two-field records get safe defaults');
assert.deepEqual(normTool({ id: 'x', name: 'X', subjects: 'bad' }).subjects, []); assert.equal(normTool({ id: 'x', name: 'X', countsTowardMastery: false }).countsTowardMastery, false);
assert(ACTIVITIES.includes('Flashcards') && ACTIVITIES.includes('Mock exam'));
const tl = [normTool({ id: 'a', name: 'A' }), normTool({ id: 'b', name: 'B', enabled: false }), normTool({ id: 'c', name: 'C', subjects: ['TAX'] }), normTool({ id: 'd', name: 'D', subjects: ['FAR', 'AFAR'] })];
assert.deepEqual(toolsFor(tl, 'FAR').map(t => t.id), ['a', 'd'], 'disabled and other-subject tools hidden');
assert.deepEqual(toolsFor(tl, 'TAX').map(t => t.id), ['a', 'c']); assert.deepEqual(toolsFor(tl, 'FAR', 'b').map(t => t.id), ['a', 'b', 'd'], 'current tool always kept');
const skip = new Set(['t-off']);
const evS = buildEvidence({ rounds: [], screenings: [], assessments: [{ id: 'a1', subject: 'FAR', date: '2026-10-01', typeId: 't-on' }, { id: 'a2', subject: 'FAR', date: '2026-10-02', typeId: 't-off' }],
  rows: [{ assessmentId: 'a1', groupId: 'g', mode: 'count', correct: 5, total: 10 }, { assessmentId: 'a2', groupId: 'g', mode: 'count', correct: 9, total: 10 }], skipTypes: skip });
assert.deepEqual(evS.items.map(i => i.total + ':' + i.correct), ['10:5'], 'tool not counted toward mastery is excluded from evidence');
const srS = buildSources({ rounds: [], screenings: [], subject: 'FAR', skipTypes: skip, assessments: [{ id: 'a1', subject: 'FAR', date: '2026-10-01', typeId: 't-on', name: 'On' }, { id: 'a2', subject: 'FAR', date: '2026-10-02', typeId: 't-off', name: 'Off' }],
  rows: [{ assessmentId: 'a1', mode: 'count', correct: 5, total: 10 }, { assessmentId: 'a2', mode: 'count', correct: 9, total: 10 }] });
assert.deepEqual(srS.map(s => s.name), ['On'], 'and from trend sources');
assert.equal(buildEvidence({ rounds: [], screenings: [], assessments: [{ id: 'a1', subject: 'FAR', date: '2026-10-01', typeId: 't-off' }], rows: [{ assessmentId: 'a1', groupId: 'g', mode: 'count', correct: 5, total: 10 }] }).items.length, 1, 'default skips nothing');
console.log('PASS: package 8 tests');
// ---- Package 9 ----
import { localISO, todayNum } from '../js/model.js';
import { DEFAULT_PLAN, addDays, weekdayOf, mondayOf, topicWeight, split, generatePlan, planItems, mergePlan, missedItems, weekSummary } from '../js/planner.js';
import { sessionsCsv } from '../js/backup.js';
assert.equal(localISO(new Date(2026, 9, 24, 23, 59)), '2026-10-24', 'local calendar day, even late in the evening'); assert.equal(localISO(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
assert.equal(todayNum(new Date(2026, 9, 24, 23, 59)) - todayNum(new Date(2026, 9, 23, 0, 1)), 1);
assert.equal(addDays('2026-10-31', 1), '2026-11-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28'); assert.equal(weekdayOf('2026-10-24'), 6); assert.equal(mondayOf('2026-10-24'), '2026-10-19'); assert.equal(mondayOf('2026-10-19'), '2026-10-19'); assert.equal(mondayOf('2026-10-25'), '2026-10-19', 'Sunday belongs to the Monday-start week');
assert.deepEqual(split(12, [100, 50]), [8, 4]); assert.deepEqual(split(12, [100 / 3, 25]), [7, 5]); assert.equal(split(7, [1, 1, 1]).reduce((a, b) => a + b, 0), 7);
assert.equal(topicWeight({ S: 60, size: 5 }, cS), 160); assert.equal(topicWeight({ S: null, size: 4 }, cS), 28, 'unknown score = Weak cut-off'); assert.equal(topicWeight({ S: 95, size: 4 }, cS), 0);
const tp = (gid, S, size, ticked = 0) => ({ gid, name: gid.toUpperCase(), size, ticked, S });
const cfg3 = { hours: [3, 3, 3, 3, 3, 3, 3], blockDays: 3, reviewMinutes: 0, focus: 2 };
let gpn = generatePlan({ start: '2026-10-26', horizon: 2, cfg: cfg3, cS, subjects: [{ id: 'FAR', topics: [tp('a', 92 - 20, 5), tp('b', 92 - 10, 5), tp('c', 95, 3)] }] });
// weights: a = 20x5 = 100, b = 10x5 = 50, c = 0 (Strong)
assert.deepEqual(gpn.days[0].items.map(i => [i.gid, i.minutes]), [['a', 120], ['b', 60]], 'day 1: 180 min split 2:1');
assert.deepEqual(gpn.days[1].items.map(i => [i.gid, i.minutes]), [['a', 105], ['b', 75]], 'day 2: priority falls as time is planned');
assert(gpn.days.every(dy => dy.items.reduce((a, i) => a + i.minutes, 0) === 180), 'whole day used');
assert.equal(gpn.days[0].items[0].label, 'Make or review notes'); assert.equal(generatePlan({ start: '2026-10-26', horizon: 1, cfg: cfg3, cS, subjects: [{ id: 'FAR', topics: [tp('a', 70, 5, 5)] }] }).days[0].items[0].label, 'Practice questions and test');
gpn = generatePlan({ start: '2026-10-26', horizon: 4, cfg: { ...cfg3, blockDays: 1 }, cS, subjects: [{ id: 'FAR', topics: [tp('a', 62, 5)] }, { id: 'TAX', topics: [tp('t', 82, 5)] }] });
// needs: FAR (92-62) x 5 = 150, TAX (92-82) x 5 = 50, so shares 75% / 25%; day 2 is a tie and goes to the first subject
assert.deepEqual(gpn.days.map(dy => dy.subject), ['FAR', 'FAR', 'TAX', 'FAR'], 'deficit rule');
assert.deepEqual(gpn.shares.map(s => [s.subject, s.share]), [['FAR', 0.75], ['TAX', 0.25]]);
gpn = generatePlan({ start: '2026-10-26', horizon: 6, cfg: { ...cfg3, blockDays: 3 }, cS, subjects: [{ id: 'FAR', topics: [tp('a', 62, 5)] }, { id: 'TAX', topics: [tp('t', 62, 5)] }] });
assert.deepEqual(gpn.days.map(dy => dy.subject), ['FAR', 'FAR', 'FAR', 'TAX', 'TAX', 'TAX'], 'blocks of 3 days');
// days off and reviews
gpn = generatePlan({ start: '2026-10-24', horizon: 3, cfg: { hours: [0, 3, 3, 3, 3, 3, 4], blockDays: 3, reviewMinutes: 30, focus: 1 }, cS, subjects: [{ id: 'FAR', topics: [tp('a', 62, 5)] }], due: [{ id: 'r1', subject: 'FAR', name: 'R1' }, { id: 'r2', subject: 'FAR', name: 'R2' }, { id: 'r3', subject: 'FAR', name: 'R3' }] });
assert.deepEqual(gpn.days.map(dy => dy.date), ['2026-10-24', '2026-10-26'], 'Sunday (0 h) skipped');
assert.deepEqual(gpn.days.map(dy => dy.reviews.map(r => r.id)), [['r1', 'r2'], ['r3']], 'each review used once, 2 slots a day at 30 min');
assert.equal(gpn.days[0].items[0].minutes, 240 - 30, 'review time comes out of the day'); assert.equal(gpn.days[1].items[0].minutes, 180 - 15);
gpn = generatePlan({ start: '2026-10-26', horizon: 2, cfg: cfg3, cS, subjects: [{ id: 'FAR', topics: [tp('a', 95, 5)] }], due: [{ id: 'r1', subject: 'FAR', name: 'R1' }] });
assert(gpn.days.every(dy => dy.items.length === 0 && dy.subject === null), 'all Strong: no study items'); assert.deepEqual(gpn.shares, []);
// accepting a plan
const pitems = planItems(generatePlan({ start: '2026-10-26', horizon: 1, cfg: { ...cfg3, reviewMinutes: 15 }, cS, subjects: [{ id: 'FAR', topics: [tp('a', 62, 5)] }], due: [{ id: 'r1', subject: 'FAR', name: 'Retest X' }] }).days, 'now');
assert.deepEqual(pitems.map(i => [i.id, i.kind, i.minutes]), [['p:2026-10-26:FAR:a', 'study', 165], ['p:2026-10-26:rv:r1', 'review', 15]]);
const exPlan = [{ id: 'old', date: '2026-10-20', done: false }, { id: 'tick', date: '2026-10-26', done: true }, { id: 'p:2026-10-26:FAR:a', date: '2026-10-26', done: true }, { id: 'fut', date: '2026-10-27', done: false }];
const mg9 = mergePlan(exPlan, pitems, '2026-10-26');
assert.deepEqual(mg9.remove.map(p => p.id), ['fut'], 'only future unfinished items are replaced'); assert.deepEqual(mg9.add.map(p => p.id), ['p:2026-10-26:rv:r1'], 'a ticked item is not duplicated');
assert.deepEqual(missedItems(exPlan, '2026-10-26').map(p => p.id), ['old']);
// week summary: today = Saturday 2026-10-24, week starts Monday 2026-10-19
const ws9 = weekSummary({ today: '2026-10-24', cfg: DEFAULT_PLAN, sessions: [{ date: '2026-10-19', minutes: 90 }, { date: '2026-10-19', minutes: 30, removedAt: 'x' }, { date: '2026-10-21', minutes: 60 }, { date: '2026-10-20', minutes: 45 }],
  plan: [{ date: '2026-10-19', minutes: 120, done: true }, { date: '2026-10-20', minutes: 100, done: false }, { date: '2026-10-24', minutes: 60, done: false }, { date: '2026-10-25', minutes: 60, done: false }] });
assert.equal(ws9.monday, '2026-10-19'); assert.equal(ws9.target, (3 * 5 + 4 + 2) * 60); assert.equal(ws9.actual, 195); assert.equal(ws9.planned, 340);
assert.deepEqual(ws9.rows.map(r => r.status), ['done', 'missed', 'unplanned', 'none', 'none', 'today', 'upcoming']);
assert.equal(ws9.rows[0].actual, 90, 'removed session ignored');
// study-log CSV
const sc9 = sessionsCsv([{ date: '2026-10-02', subject: 'FAR', minutes: 45, activity: 'Review', gid: 'g', note: '=x', createdAt: '2' }, { date: '2026-10-01', subject: 'FAR', minutes: 30, activity: 'Other', gid: '', createdAt: '1' }, { date: '2026-10-03', subject: 'FAR', minutes: 5, removedAt: 'x', activity: 'Other' }], [{ id: 'g', name: 'Sub, one' }]).split('\r\n');
assert.equal(sc9[0], '\ufeffDate,Subject,Minutes,Activity,Subtopic,Note'); assert.equal(sc9[1], '2026-10-01,FAR,30,Other,,'); assert.equal(sc9[2], `2026-10-02,FAR,45,Review,"Sub, one",'=x`); assert.equal(sc9.length, 4, 'removed excluded');
console.log('PASS: package 9 tests');
// ---- Package 10: PWA and offline ----
import fs from 'fs'; import vm from 'vm'; import path from 'path';
const root10 = new URL('..', import.meta.url).pathname, read10 = f => fs.readFileSync(path.join(root10, f), 'utf8');
const swSrc = read10('sw.js'), manifest = JSON.parse(read10('manifest.webmanifest'));
const BASE = 'https://user.github.io/Study-Tracker/sw.js';
function makeSw(online = true) {
  const handlers = {}, store = new Map(), flags = { skip: 0, claimed: 0, net: online };
  class Request { constructor(u, o) { this.url = new URL(u, BASE).href; this.opts = o; } }
  class Response { constructor(b, o = {}) { this.body = b; this.status = o.status || 200; } }
  const norm = (r, o) => { const u = new URL(typeof r === 'string' ? r : r.url, BASE).href; return o && o.ignoreSearch ? u.split('?')[0] : u; };
  const caches = {
    async open(n) { if (!store.has(n)) store.set(n, new Map()); const m = store.get(n); return { async addAll(rs) { for (const r of rs) m.set(norm(r), { body: 'cached:' + norm(r) }); }, async keys() { return [...m.keys()]; } }; },
    async keys() { return [...store.keys()]; }, async delete(n) { return store.delete(n); },
    async match(req, o) { const u = norm(req, o); for (const m of store.values()) for (const [k, v] of m) if ((o && o.ignoreSearch ? k.split('?')[0] : k) === u) return v; return undefined; } };
  const ctx = vm.createContext({ self: { location: new URL(BASE), addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => { flags.skip++; }, clients: { claim: () => { flags.claimed++; return Promise.resolve(); } } },
    caches, Request, Response, URL, Promise, fetch: async r => { if (!flags.net) throw new Error('offline'); return { body: 'network:' + r.url, status: 200 }; } });
  vm.runInContext(swSrc, ctx);
  return { handlers, store, flags, ctx, caches };
}
const fireFetch = async (sw, url, o = {}) => { const ev = { request: { method: 'GET', mode: 'cors', url, ...o }, respondWith(p) { this.result = p; } }; sw.handlers.fetch(ev); return ev.result ? await ev.result : null; };
const ASSETS10 = (sw) => vm.runInContext('ASSETS', sw.ctx), CACHE10 = (sw) => vm.runInContext('CACHE', sw.ctx);
// release hygiene
const { APP_VERSION } = await import('../js/version.js');
assert.equal(vm.runInContext(swSrc + '\nVERSION', vm.createContext({ self: { addEventListener() {}, location: new URL(BASE) }, caches: {}, Request: class {}, Response: class {}, URL })), APP_VERSION, 'sw.js VERSION matches js/version.js');
const listed = new Set(ASSETS10(makeSw()).map(u => u.replace(/^\.\//, '')));
const onDisk = ['js', 'css', 'data', 'icons'].flatMap(dn => fs.readdirSync(path.join(root10, dn)).map(f => dn + '/' + f)).concat(['index.html', 'manifest.webmanifest']);
for (const f of onDisk) assert(listed.has(f), 'missing from sw ASSETS: ' + f);
for (const u of listed) if (u !== '') assert(fs.existsSync(path.join(root10, u)), 'ASSETS entry has no file: ' + u);
assert(listed.has(''), 'root URL cached');
// manifest and icons
assert(manifest.name && manifest.short_name && manifest.display === 'standalone' && manifest.start_url === './' && manifest.scope === './');
const png = f => { const b = fs.readFileSync(path.join(root10, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
for (const ic of manifest.icons) assert.deepEqual(png(ic.src), ic.sizes.split('x').map(Number), ic.src);
assert(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
const idx = read10('index.html'); assert(/rel="manifest" href="manifest.webmanifest"/.test(idx) && /name="theme-color"/.test(idx) && /name="viewport"/.test(idx));
// every relative import in the app resolves to a cached file (no network needed at runtime)
for (const f of fs.readdirSync(path.join(root10, 'js'))) for (const m of read10('js/' + f).matchAll(/from '\.\/([\w-]+\.js)'/g)) assert(listed.has('js/' + m[1]), `${f} imports ${m[1]} which is not cached`);
// service worker behaviour with a fake browser
let sw = makeSw(); await new Promise(r => { sw.handlers.install({ waitUntil: p => p.then(r) }); });
assert.equal([...sw.store.get(CACHE10(sw)).keys()].length, ASSETS10(sw).length, 'install precaches every asset');
sw.flags.net = false;
assert.equal((await fireFetch(sw, 'https://user.github.io/Study-Tracker/js/main.js?v=2')).body, 'cached:https://user.github.io/Study-Tracker/js/main.js', 'offline asset, query ignored');
assert.equal((await fireFetch(sw, 'https://user.github.io/Study-Tracker/', { mode: 'navigate' })).body, 'cached:https://user.github.io/Study-Tracker/', 'offline launch');
assert.equal((await fireFetch(sw, 'https://user.github.io/Study-Tracker/anything', { mode: 'navigate' })).body, 'cached:https://user.github.io/Study-Tracker/index.html', 'unknown navigation gets the shell');
assert.equal((await fireFetch(sw, 'https://user.github.io/Study-Tracker/missing.png')).status, 503, 'uncached asset offline: clear 503, no crash');
assert.equal(await fireFetch(sw, 'https://user.github.io/Study-Tracker/js/main.js', { method: 'POST' }), null, 'non-GET ignored');
assert.equal(await fireFetch(sw, 'https://cdn.example.com/lib.js'), null, 'cross-origin ignored');
sw.flags.net = true; assert.equal((await fireFetch(sw, 'https://user.github.io/Study-Tracker/other.json')).body, 'network:https://user.github.io/Study-Tracker/other.json', 'uncached goes to network when online');
sw.store.set('cpale-tracker-0.0.1', new Map()); sw.store.set('other-app-cache', new Map());
await new Promise(r => { sw.handlers.activate({ waitUntil: p => p.then(r) }); });
assert.deepEqual([...sw.store.keys()].sort(), ['cpale-tracker-' + APP_VERSION, 'other-app-cache'].sort(), 'old app caches removed, other caches kept'); assert.equal(sw.flags.claimed, 1);
sw.handlers.message({ data: { type: 'OTHER' } }); assert.equal(sw.flags.skip, 0); sw.handlers.message({ data: { type: 'SKIP_WAITING' } }); assert.equal(sw.flags.skip, 1, 'update applies only on request');
console.log('PASS: package 10 tests');
