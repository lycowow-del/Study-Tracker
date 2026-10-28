import { h, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, screenGroups, progress } from './model.js';
import { buildEvidence, analyze, bucket, nextAction, buildSources, velocity, consistency, retentionPairs, retentionSummary, calibration, errorShare, dayNum } from './analytics.js';
import { getSubj, setSubj } from './views.js';
const COL = { Mastered: '#3ddc84', Developing: '#ffb454', Weak: '#ff6b6b', 'Too little evidence': '#5b646c' };
const fmt = x => x == null ? '–' : (+x.toFixed(1)) + '%';
const NS = 'http://www.w3.org/2000/svg';
const svg = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [n, v] of Object.entries(a)) e.setAttribute(n, v); for (const c of k.flat()) if (c != null) e.append(c); return e; };
const sgn = x => (x > 0 ? '+' : '') + (+x.toFixed(1));
function trendChart(src, cS) {
  const W = 700, H = 260, L = 40, R = 12, T = 12, B = 30, days = src.map(s => dayNum(s.date)), d0 = Math.min(...days), span = Math.max(1, Math.max(...days) - d0);
  const X = s => L + (src.length === 1 ? (W - L - R) / 2 : (dayNum(s.date) - d0) / span * (W - L - R)), Y = v => T + (1 - v / 100) * (H - T - B);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Score trend chart' });
  for (const v of [0, 25, 50, 75, 100]) g.append(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: '#262c32' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', fill: '#8b949e', 'font-size': 10 }, v + '%'));
  for (const [v, c] of [[cS.weakBelow, '#ff6b6b'], [cS.strongFrom, '#3ddc84']]) g.append(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: c, 'stroke-dasharray': '4 4', opacity: .7 }));
  const fa = src.filter(s => s.attempt === 'first');
  if (fa.length > 1) g.append(svg('polyline', { points: fa.map(s => `${X(s)},${Y(s.score)}`).join(' '), fill: 'none', stroke: '#3ddc84', 'stroke-width': 1.5, opacity: .6 }));
  for (const s of src) {
    const tip = svg('title', {}, `${s.name} (${s.date}): ${+s.score.toFixed(1)}% of ${s.total} questions${s.attempt === 'repeat' ? ', repeat attempt' : ''}`), x = X(s), y = Y(s.score);
    g.append(s.kind === 'screening' ? svg('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: '#6ab0ff' }, tip) : svg('circle', { cx: x, cy: y, r: 5, fill: s.attempt === 'repeat' ? 'none' : '#3ddc84', stroke: '#3ddc84', 'stroke-width': 2 }, tip));
  }
  for (const [s, a] of [[src[0], 'start'], [src[src.length - 1], 'end']]) g.append(svg('text', { x: X(s), y: H - 8, 'text-anchor': src.length === 1 ? 'middle' : a, fill: '#8b949e', 'font-size': 10 }, s.date));
  return g;
}
const note = t => h('details', { class: 'mut', style: 'margin-top:6px' }, h('summary', {}, 'How this is calculated'), h('div', {}, t));
const pill = (s, sub) => h('span', { class: 'fl', style: `background:${COL[s]};margin:0;color:${s === 'Too little evidence' ? '#fff' : '#000'}` }, s + (sub ? ` (${sub.toLowerCase()})` : ''));

export async function analyticsPage(root) {
  const S = { subj: getSubj(), diff: '' };
  let d;
  const load = async () => {
    d = { nodes: await db.all('nodes'), rounds: await db.all('rounds'), screenings: await db.all('screenings'), assessments: await db.all('assessments'), rows: await db.all('assessmentRows'), subs: await db.all('subjects'), cats: await db.errCats(),
      types: await db.assessTypes(), prog: Object.fromEntries((await db.all('progress')).map(p => [p.id, p])), cS: await db.screenCfg(), cA: await db.analyticsCfg() };
  };
  const advanced = (res, groups) => {
    const { cA, cS } = d, now = new Date(), P = (title, ...k) => h('div', { class: 'panel' }, h('h2', {}, title), ...k);
    let src = buildSources({ rounds: d.rounds, screenings: d.screenings, assessments: d.assessments, rows: d.rows, subject: S.subj, skipTypes: new Set(d.types.filter(t => !t.countsTowardMastery).map(t => t.id)) });
    if (S.diff) src = src.filter(s => s.kind === 'assessment' && s.difficulty === S.diff);
    const target = ((d.subs.find(x => x.id === S.subj) || {}).targetDate) || '';
    const vel = velocity(src, cS.strongFrom, target, now), con = consistency(src), cal = calibration(src), ret = retentionPairs(res.use, groups, cA), rs = retentionSummary(ret), er = errorShare(src, d.cats);
    const out = [h('h1', { style: 'margin-top:18px' }, 'Trends and patterns')];
    out.push(P('Score trend', src.length ? [trendChart(src, cS), h('div', { class: 'mut' }, `Each point is one screening round (square) or assessment (circle, hollow = repeat attempt), scored over its count-based rows. The line joins first attempts. Dashed lines mark your Weak (${cS.weakBelow}%) and Strong (${cS.strongFrom}%) cut-offs. ${src.length} result(s) shown. Hover a point for details.`)] : h('div', { class: 'mut' }, 'No results to chart yet.')));
    const card = (title, r, body, how) => h('div', { class: 'panel' }, h('h2', {}, title), r.ok ? body : h('div', { class: 'mut' }, r.reason), note(how));
    out.push(h('div', { class: 'grid', style: 'margin-top:10px' },
      card('Velocity', vel, [h('div', {}, `${sgn(vel.per30)} points per 30 days`), h('div', { class: 'mut' }, `Based on ${vel.n} first-attempt assessments over ${vel.span} days. Your last-3 average is ${vel.current.toFixed(1)}%.`),
        h('div', {}, vel.needed == null ? 'Set a target date for this subject in Syllabus to compare.' : vel.needed === 'passed' ? 'The target date has passed.' : `Needed to reach ${cS.strongFrom}% by ${target}: about ${vel.needed.toFixed(1)} points per 30 days.`)],
        'Least-squares slope of first-attempt assessment scores over time, shown per 30 days. Needed = (Strong cut-off minus the average of your last 3 first-attempt scores) divided by days to the target date, per 30 days. Both assume a straight line, so treat them as rough estimates that are noisy with few results.'),
      card('Consistency', con, [h('div', {}, `Spread (standard deviation) ${con.sd.toFixed(1)} points`), h('div', { class: 'mut' }, `Last ${con.n} first-attempt assessments: mean ${con.mean.toFixed(1)}%, range ${con.min.toFixed(1)}% to ${con.max.toFixed(1)}%.`)],
        'Sample standard deviation of your last 5 first-attempt assessment scores (at least 3 needed). A smaller spread means more predictable results. Different assessments differ in difficulty and topic, so some spread is expected.'),
      card('Confidence vs performance', cal, [h('div', {}, `Average gap ${sgn(cal.mean)} points (${cal.n} assessments)`), h('div', { class: 'mut' }, cal.mean >= 0 ? 'On average you scored at or above what you expected.' : 'On average you scored below what you expected.'),
        h('table', {}, h('tr', {}, ['Assessment', 'Expected', 'Actual', 'Gap'].map(x => h('th', {}, x))), cal.list.slice(-5).map(x => h('tr', {}, h('td', {}, x.name), h('td', {}, fmt(x.expected)), h('td', {}, fmt(x.score)), h('td', {}, sgn(x.gap)))))],
        'Actual score minus the expected score you entered before checking answers, for first-attempt assessments only (repeats would not be a fair prediction). Positive means you did better than you expected; negative means worse. Needs at least 3.')));
    out.push(P('Retention', rs.n ? [h('div', {}, `${rs.n} subtopic(s) with a retest at least ${cA.retentionDays} days after an earlier result: ${rs.improved} improved, ${rs.declined} declined, average change ${sgn(rs.mean)} points.`),
      h('div', { style: 'overflow-x:auto' }, h('table', {}, h('tr', {}, ['Subtopic', 'Earlier', 'Later', 'Gap (days)', 'Change', 'Later attempt'].map(x => h('th', {}, x))),
        ret.sort((a, b) => a.change - b.change).map(p => h('tr', {}, h('td', {}, p.g.group.name), h('td', {}, `${fmt(p.before)} (${p.earlier.total})`), h('td', {}, `${fmt(p.after)} (${p.later.total})`), h('td', {}, p.gap), h('td', {}, sgn(p.change)), h('td', {}, p.later.attempt)))))]
      : h('div', { class: 'mut' }, `No subtopic has two results at least ${cA.retentionDays} days apart with ${cA.retentionMinQ}+ questions each yet.`),
      note(`For each subtopic, its most recent result is compared with the most recent earlier result at least ${cA.retentionDays} days before it, if both have at least ${cA.retentionMinQ} questions. A later repeat attempt can look better simply because you practiced the same questions, so the attempt type is shown. Sorted with the biggest declines first. Question counts are in brackets.`)));
    out.push(P('Mistake categories', er.rows.length ? [h('div', { class: 'mut' }, `${er.categorized} categorized mistake(s) across ${er.n} assessment(s), covering ${Math.round(100 * er.categorized / Math.max(1, er.missed))}% of the ${er.missed} wrong or unanswered answers in those assessments.`),
      ...er.rows.map(r => h('div', { style: 'margin:4px 0' }, `${r.name}: ${r.count} (${r.share.toFixed(0)}%)`, h('div', { class: 'bar' }, h('i', { style: `width:${r.share}%` }))))]
      : h('div', { class: 'mut' }, 'No categorized mistakes yet. Add counts when logging an assessment.'),
      note('Sums the mistake counts you entered per assessment. Counts are per assessment, so they cannot be split by subtopic, and the coverage figure shows how much of your wrong or unanswered answers were categorized.')));
    return out;
  };
  const draw = () => {
    root.replaceChildren();
    const now = new Date(), { cA, cS, prog } = d, groups = screenGroups(d.nodes, S.subj);
    const skip = new Set(d.types.filter(t => !t.countsTowardMastery).map(t => t.id)), ev = buildEvidence({ ...d, skipTypes: skip }), res = analyze({ groups, items: ev.items, excluded: ev.excluded, cA, cS, now, difficulty: S.diff });
    const sel = h('select', { 'aria-label': 'Difficulty filter' }, [['', 'All difficulties'], ['Easy', 'Easy only'], ['Medium', 'Medium only'], ['Hard', 'Hard only']].map(([v, l]) => h('option', { value: v, selected: v === S.diff }, l)));
    sel.addEventListener('change', () => { S.diff = sel.value; draw(); });
    root.append(h('div', { class: 'tabs' }, SUBJECTS.map(id => h('button', { class: id === S.subj ? 'on' : '', onclick: () => { S.subj = id; setSubj(id); draw(); } }, id))),
      h('h1', {}, 'Analytics: ' + S.subj), h('div', { class: 'tool' }, sel, h('span', { class: 'mut' }, 'Difficulty is your own rating; it filters assessment results and never adjusts scores.')));
    if (!groups.length) { root.append(h('p', { class: 'mut' }, 'This subject has no subtopic groups with counted files yet.')); return; }
    if (S.diff) root.append(h('p', { class: 'mut' }, `Showing assessments rated ${S.diff} only. ${res.screeningExcluded} screening result(s) are excluded because screening has no difficulty rating.`));
    const skippedN = d.assessments.filter(a => !a.removedAt && a.subject === S.subj && skip.has(a.typeId)).length;
    if (skippedN) root.append(h('p', { class: 'mut' }, `${skippedN} assessment(s) from tools that do not count toward mastery are excluded here. Change this in Study Tools.`));
    const c = res.counts, cov = progress(groups.flatMap(g => g.files), id => !!(prog[id] && prog[id].done));
    const seg = k => h('div', { style: `width:${100 * c[k] / res.total}%;background:${COL[k]};height:100%`, title: `${k}: ${c[k]}` });
    root.append(h('div', { class: 'panel' }, h('h2', {}, `Readiness: ${res.total} subtopics`),
      h('div', { class: 'bar', style: 'display:flex;height:14px' }, ['Mastered', 'Developing', 'Weak', 'Too little evidence'].map(seg)),
      h('div', {}, `Mastered ${c.Mastered} · Developing ${c.Developing} · Weak ${c.Weak} · Too little evidence ${c['Too little evidence']}`),
      h('div', { class: 'mut' }, `Too little evidence = not started ${c.notStarted} · tentative (under ${cS.minQ} questions) ${c.tentative} · strong so far, needs more evidence ${c.strongSoFar}`),
      h('div', { class: 'mut' }, `Coverage, shown separately and never blended in: lecture notes made ${cov.done} of ${cov.total}. Coverage does not measure understanding.`),
      res.excludedPct ? h('div', { class: 'mut' }, `${res.excludedPct} percent-only row(s) excluded from every figure (question count unknown).`) : null,
      note(`Each result is weighted by questions x attempt factor (first attempt 1, repeat ${cA.repeatFactor}) x fade (halves every ${cA.halfLifeDays} days). Subtopic score = weighted correct / weighted questions. Weak: below ${cS.weakBelow}%. Developing: ${cS.weakBelow}% to under ${cS.strongFrom}%. Mastered: ${cS.strongFrom}% or more with at least ${cA.masteryQ} questions from at least ${cA.masteryA} separate assessments or screening rounds. Fewer than ${cS.minQ} questions is too little evidence. No combined readiness number is shown on purpose.`)));
    const wrap = h('div', { style: 'overflow-x:auto' }), tbl = h('table', {}, h('tr', {}, ['Subtopic', 'Status', 'Weighted score', 'Questions', 'Sources', 'Raw score', 'Accuracy', 'Unanswered', 'First attempts', `Last ${cA.recentDays} days`, 'Last evidence', 'Next action'].map(x => h('th', {}, x))));
    let last = null;
    for (const p of res.per) {
      if (p.g.topic.id !== last) { last = p.g.topic.id; tbl.append(h('tr', { class: 'tr-topic' }, h('td', { colspan: 12 }, p.g.topic.name))); }
      const tk = p.g.files.filter(f => prog[f.id] && prog[f.id].done).length;
      tbl.append(h('tr', {}, h('td', {}, p.g.group.name), h('td', {}, pill(p.status, p.sub)), h('td', {}, fmt(p.S)), h('td', {}, p.Q), h('td', {}, p.A), h('td', {}, fmt(p.raw)), h('td', {}, fmt(p.accuracy)),
        h('td', {}, fmt(p.unansweredRate)), h('td', {}, fmt(p.firstAcc)), h('td', {}, p.recentQ ? `${fmt(p.recent)} (${p.recentQ})` : '–'), h('td', {}, p.lastDate || '–'), h('td', {}, nextAction(p, cA, cS, now, tk))));
    }
    wrap.append(tbl);
    root.append(h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, 'Subtopics'), wrap,
      note('Raw score = correct / total across all results. Accuracy = correct / (total - unanswered) and unanswered rate = unanswered / total, both from assessments only (screening records no unanswered). First attempts = raw score of first attempts only. Question counts are shown so you can judge how much each figure rests on.')));
    const tname = id => id ? ((d.types.find(t => t.id === id) || {}).name || '(removed type)') : '(none)';
    const bt = (title, rows, key) => h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, title),
      rows.length ? h('table', {}, h('tr', {}, [key, 'Assessments', 'Questions', 'Score', 'Accuracy', 'First attempts'].map(x => h('th', {}, x))),
        rows.map(r => h('tr', {}, h('td', {}, r.label), h('td', {}, r.n), h('td', {}, r.Q), h('td', {}, fmt(r.score)), h('td', {}, fmt(r.accuracy)), h('td', {}, fmt(r.first))))) : h('div', { class: 'mut' }, 'No assessment results yet.'));
    root.append(bt('By assessment type', bucket(res.use, i => i.typeId).map(r => ({ ...r, label: tname(r.key) })), 'Type'),
      bt('By difficulty (your rating)', bucket(res.use, i => i.difficulty || 'Unrated').map(r => ({ ...r, label: r.key })), 'Difficulty'),
      ...advanced(res, groups));
  };
  try { await load(); draw(); } catch (e) { report(e, 'analytics'); }
}
