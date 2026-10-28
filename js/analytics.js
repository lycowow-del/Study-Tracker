// Pure analytics engine (no DOM or IndexedDB). Formulas are those approved for Package 6 (P6-D1 to P6-D6).
import { todayNum } from './model.js';
export const DEFAULT_ANALYTICS = { halfLifeDays: 60, repeatFactor: 0.5, masteryQ: 20, masteryA: 2, retentionDays: 14, retentionMinQ: 5, recentDays: 30 };
const DAY = 864e5;
export const dayNum = d => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
export const ageDays = (date, now) => Math.max(0, todayNum(now) - dayNum(date));
// weight factor of one item = attempt factor x 0.5^(age / half-life); multiply by questions for its full weight
export const factor = (it, c, now) => (it.attempt === 'repeat' ? c.repeatFactor : 1) * Math.pow(0.5, ageDays(it.date, now) / c.halfLifeDays);
const sum = (a, f) => a.reduce((x, i) => x + f(i), 0);
const pct = (n, d) => d > 0 ? 100 * n / d : null;

// Evidence = screening scores + count-based assessment rows. Percent-only rows (n unknown) are counted but excluded.
export function buildEvidence({ rounds, screenings, assessments, rows, skipTypes = new Set() }) {
  const R = new Map(rounds.filter(r => !r.removedAt).map(r => [r.id, r])), A = new Map(assessments.filter(a => !a.removedAt && !skipTypes.has(a.typeId)).map(a => [a.id, a]));
  const items = [], excluded = {};
  for (const s of screenings) {
    const r = R.get(s.roundId); if (!r || !(s.total > 0)) continue;
    items.push({ groupId: s.groupId, source: 's:' + r.id, kind: 'screening', subject: r.subject, date: r.date, attempt: 'first', correct: s.correct, total: s.total, unanswered: 0, difficulty: '', typeId: '' });
  }
  for (const w of rows) {
    const a = A.get(w.assessmentId); if (!a) continue;
    if (w.mode === 'pct') { excluded[w.groupId] = (excluded[w.groupId] || 0) + 1; continue; }
    items.push({ groupId: w.groupId, source: 'a:' + a.id, kind: 'assessment', subject: a.subject, date: a.date, attempt: a.attemptKind === 'repeat' ? 'repeat' : 'first', correct: w.correct, total: w.total, unanswered: w.unanswered || 0, difficulty: a.difficulty || '', typeId: a.typeId || '' });
  }
  return { items, excluded };
}
export function classify(S, Q, A, cA, cS) {
  if (Q === 0) return { status: 'Too little evidence', sub: 'Not started' };
  if (Q < cS.minQ) return { status: 'Too little evidence', sub: 'Tentative' };
  if (S < cS.weakBelow) return { status: 'Weak', sub: '' };
  if (S < cS.strongFrom) return { status: 'Developing', sub: '' };
  if (Q >= cA.masteryQ && A >= cA.masteryA) return { status: 'Mastered', sub: '' };
  return { status: 'Too little evidence', sub: 'Strong so far' };
}
export function statsFor(items, cA, cS, now) {
  const Q = sum(items, i => i.total), A = new Set(items.map(i => i.source)).size;
  let wc = 0, wt = 0;
  for (const i of items) { const f = factor(i, cA, now); wc += i.correct * f; wt += i.total * f; }
  const S = pct(wc, wt), asm = items.filter(i => i.kind === 'assessment'), first = items.filter(i => i.attempt === 'first'), recent = items.filter(i => ageDays(i.date, now) <= cA.recentDays);
  return { Q, A, S, raw: pct(sum(items, i => i.correct), Q), accuracy: pct(sum(asm, i => i.correct), sum(asm, i => i.total - i.unanswered)),
    unansweredRate: pct(sum(asm, i => i.unanswered), sum(asm, i => i.total)), firstAcc: pct(sum(first, i => i.correct), sum(first, i => i.total)),
    recent: pct(sum(recent, i => i.correct), sum(recent, i => i.total)), recentQ: sum(recent, i => i.total), lastDate: items.reduce((m, i) => i.date > m ? i.date : m, ''), ...classify(S, Q, A, cA, cS) };
}
// groups: [{group:{id}, topic, files, size}] from screenGroups(). difficulty filter keeps only assessment items with that rating.
export function analyze({ groups, items, excluded, cA, cS, now, difficulty = '' }) {
  const gs = new Set(groups.map(g => g.group.id));
  const use = items.filter(i => gs.has(i.groupId) && (!difficulty || (i.kind === 'assessment' && i.difficulty === difficulty)));
  const by = new Map(); for (const i of use) (by.get(i.groupId) || by.set(i.groupId, []).get(i.groupId)).push(i);
  const per = groups.map(g => ({ g, excluded: excluded[g.group.id] || 0, ...statsFor(by.get(g.group.id) || [], cA, cS, now) }));
  const counts = { Mastered: 0, Developing: 0, Weak: 0, 'Too little evidence': 0, notStarted: 0, tentative: 0, strongSoFar: 0 };
  for (const p of per) {
    counts[p.status]++;
    if (p.status === 'Too little evidence') { if (p.sub === 'Not started') counts.notStarted++; else if (p.sub === 'Tentative') counts.tentative++; else counts.strongSoFar++; }
  }
  return { per, counts, use, total: groups.length,
    screeningExcluded: difficulty ? items.filter(i => i.kind === 'screening' && gs.has(i.groupId)).length : 0,
    excludedPct: Object.entries(excluded).filter(([k]) => gs.has(k)).reduce((a, [, n]) => a + n, 0) };
}
// Question-weighted comparison of assessments by any key (type, difficulty). Raw, not faded.
export function bucket(items, keyFn) {
  const m = new Map();
  for (const i of items.filter(i => i.kind === 'assessment')) { const k = keyFn(i); (m.get(k) || m.set(k, []).get(k)).push(i); }
  return [...m].map(([key, a]) => { const f = a.filter(i => i.attempt === 'first');
    return { key, Q: sum(a, i => i.total), n: new Set(a.map(i => i.source)).size, score: pct(sum(a, i => i.correct), sum(a, i => i.total)),
      accuracy: pct(sum(a, i => i.correct), sum(a, i => i.total - i.unanswered)), first: pct(sum(f, i => i.correct), sum(f, i => i.total)) }; });
}
export function nextAction(p, cA, cS, now, ticked) {
  if (p.status === 'Weak') return `Review ${p.g.size} notes files (${ticked} ticked), practice, then retest`;
  if (p.status === 'Developing') return `Practice, then retest after at least ${cA.retentionDays} days`;
  if (p.status === 'Mastered') { const age = ageDays(p.lastDate, now); return age > cA.recentDays ? `Retention check due: last evidence ${age} days ago` : 'Maintain; retest later to confirm retention'; }
  if (p.sub === 'Strong so far') return `Strong so far. Log about ${Math.max(0, cA.masteryQ - p.Q)} more questions and ${Math.max(0, cA.masteryA - p.A)} more assessment(s) to confirm mastery`;
  return `Log an assessment covering this subtopic (about ${Math.max(0, cS.minQ - p.Q)} more questions for a usable score)`;
}

// ---- Package 6B ----
// One point per source (screening round or assessment): question-weighted score over its count-based rows.
export function buildSources({ rounds, screenings, assessments, rows, subject, skipTypes = new Set() }) {
  const out = [];
  for (const r of rounds.filter(r => !r.removedAt && r.subject === subject)) {
    const ss = screenings.filter(s => s.roundId === r.id && s.total > 0), T = sum(ss, s => s.total);
    if (T > 0) out.push({ id: 's:' + r.id, kind: 'screening', name: r.name, date: r.date, attempt: 'first', correct: sum(ss, s => s.correct), total: T, score: pct(sum(ss, s => s.correct), T), expected: null, difficulty: '', errorCounts: {}, missed: 0 });
  }
  const by = new Map();
  for (const w of rows) if (w.mode !== 'pct') (by.get(w.assessmentId) || by.set(w.assessmentId, []).get(w.assessmentId)).push(w);
  for (const a of assessments) {
    if (a.removedAt || a.subject !== subject || skipTypes.has(a.typeId)) continue;
    const rs = by.get(a.id) || [], T = sum(rs, w => w.total), C = sum(rs, w => w.correct);
    if (T > 0) out.push({ id: 'a:' + a.id, kind: 'assessment', name: a.name, date: a.date, attempt: a.attemptKind === 'repeat' ? 'repeat' : 'first', correct: C, total: T, score: pct(C, T), expected: a.expected ?? null, difficulty: a.difficulty || '', errorCounts: a.errorCounts || {}, missed: T - C });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}
export function linreg(pts) {
  const n = pts.length; if (n < 2) return null;
  const mx = sum(pts, p => p.x) / n, my = sum(pts, p => p.y) / n, sxx = sum(pts, p => (p.x - mx) ** 2);
  if (sxx === 0) return null;
  const slope = sum(pts, p => (p.x - mx) * (p.y - my)) / sxx;
  return { slope, intercept: my - slope * mx };
}
const firstAssessments = src => src.filter(s => s.kind === 'assessment' && s.attempt === 'first');
// Slope of first-attempt assessment scores (points per 30 days); needs 4+ results spanning 14+ days.
export function velocity(src, strongFrom, target, now) {
  const fa = firstAssessments(src);
  if (fa.length < 4) return { ok: false, reason: `Needs at least 4 first-attempt assessments (you have ${fa.length}).` };
  const d0 = dayNum(fa[0].date), span = dayNum(fa[fa.length - 1].date) - d0;
  if (span < 14) return { ok: false, reason: `Needs results spanning at least 14 days (yours span ${span}).` };
  const reg = linreg(fa.map(s => ({ x: dayNum(s.date) - d0, y: s.score })));
  if (!reg) return { ok: false, reason: 'Not enough variation in dates.' };
  const current = sum(fa.slice(-3), s => s.score) / 3;
  let needed = null;
  if (target) { const left = dayNum(target) - todayNum(now); needed = left > 0 ? Math.max(0, strongFrom - current) / left * 30 : 'passed'; }
  return { ok: true, per30: reg.slope * 30, n: fa.length, span, current, needed };
}
export function consistency(src) {
  const fa = firstAssessments(src).slice(-5);
  if (fa.length < 3) return { ok: false, reason: `Needs at least 3 first-attempt assessments (you have ${fa.length}).` };
  const m = sum(fa, s => s.score) / fa.length;
  return { ok: true, n: fa.length, mean: m, sd: Math.sqrt(sum(fa, s => (s.score - m) ** 2) / (fa.length - 1)), min: Math.min(...fa.map(s => s.score)), max: Math.max(...fa.map(s => s.score)) };
}
// Per subtopic: the latest result compared with the most recent earlier result at least `retentionDays` before it.
export function retentionPairs(items, groups, cA) {
  const by = new Map(); for (const i of items) (by.get(i.groupId) || by.set(i.groupId, []).get(i.groupId)).push(i);
  const out = [];
  for (const g of groups) {
    const its = (by.get(g.group.id) || []).filter(i => i.total >= cA.retentionMinQ).sort((a, b) => a.date.localeCompare(b.date));
    for (let j = its.length - 1; j >= 0; j--) {
      const L = its[j], E = its.slice(0, j).reverse().find(e => dayNum(L.date) - dayNum(e.date) >= cA.retentionDays);
      if (E) { const before = pct(E.correct, E.total), after = pct(L.correct, L.total); out.push({ g, earlier: E, later: L, gap: dayNum(L.date) - dayNum(E.date), before, after, change: after - before }); break; }
    }
  }
  return out;
}
export const retentionSummary = pairs => ({ n: pairs.length, mean: pairs.length ? sum(pairs, p => p.change) / pairs.length : null, improved: pairs.filter(p => p.change > 0).length, declined: pairs.filter(p => p.change < 0).length });
// Actual minus expected score, first-attempt assessments only (expected is entered before checking answers).
export function calibration(src) {
  const list = firstAssessments(src).filter(s => s.expected != null).map(s => ({ ...s, gap: s.score - s.expected }));
  if (list.length < 3) return { ok: false, reason: `Needs at least 3 first-attempt assessments with an expected score (you have ${list.length}).`, list };
  return { ok: true, n: list.length, mean: sum(list, x => x.gap) / list.length, list };
}
export function errorShare(src, cats) {
  const tot = {}; let cat = 0, missed = 0, n = 0;
  for (const s of src) {
    if (s.kind !== 'assessment') continue;
    const e = Object.entries(s.errorCounts || {}); if (!e.length) continue;
    n++; missed += s.missed; for (const [k, v] of e) { tot[k] = (tot[k] || 0) + v; cat += v; }
  }
  return { n, categorized: cat, missed, rows: Object.entries(tot).map(([id, count]) => ({ id, name: (cats.find(c => c.id === id) || { name: '(removed category)' }).name, count, share: 100 * count / cat })).sort((a, b) => b.count - a.count) };
}
