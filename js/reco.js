// Pure dashboard logic: recommendations, deadlines, activity feed, weekly minutes.
import { ageDays, nextAction } from './analytics.js';
import { todayNum } from './model.js';
const DAY = 864e5, fmt = x => (+x.toFixed(1)) + '%', dnum = d => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
// Every recommendation says why (with numbers) and can be snoozed. Priority: baseline > weak (by gap) > retests > thin evidence > not started.
export function recommend({ per, cS, cA, now, hasScreening, subject, snoozed = {}, ticked = () => 0 }) {
  const out = [];
  if (!hasScreening) out.push({ id: 'baseline:' + subject, kind: 'baseline', priority: 1000, title: `Run your baseline screening for ${subject}`, why: 'There is no screening round yet, so your weak points are unknown. Screening gives every subtopic a starting score.', link: '#/screening' });
  for (const p of per) {
    const name = p.g.group.name, id = p.g.group.id, age = p.lastDate ? ageDays(p.lastDate, now) : null, act = nextAction(p, cA, cS, now, ticked(p));
    if (p.status === 'Weak') out.push({ id: 'weak:' + id, kind: 'weak', priority: 500 + (cS.strongFrom - p.S), title: `Strengthen: ${name}`, why: `Weighted score ${fmt(p.S)} is below ${cS.weakBelow}% (${p.Q} questions). ${act}.`, link: '#/syllabus' });
    else if (p.status === 'Developing' && age >= cA.retentionDays) out.push({ id: 'retest:' + id, kind: 'retest', priority: 300 + Math.min(age, 120) / 2, title: `Retest: ${name}`, why: `Developing at ${fmt(p.S)}. The last result was ${age} days ago, so a retest now also checks retention.`, link: '#/assessments' });
    else if (p.status === 'Mastered' && age > cA.recentDays) out.push({ id: 'retain:' + id, kind: 'retest', priority: 280 + Math.min(age, 120) / 2, title: `Retention check: ${name}`, why: `Mastered at ${fmt(p.S)}, but the last result was ${age} days ago.`, link: '#/assessments' });
    else if (p.status === 'Too little evidence') out.push({ id: 'evidence:' + id, kind: 'evidence', priority: p.sub === 'Not started' ? 100 : 200, title: p.sub === 'Not started' ? `Get a first score: ${name}` : `Add evidence: ${name}`, why: act + '.', link: p.sub === 'Not started' ? '#/screening' : '#/assessments' });
  }
  const isSnoozed = r => !!(snoozed[r.id] && new Date(snoozed[r.id]) > now);
  const items = out.filter(r => !isSnoozed(r)).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
  return { items, snoozed: out.filter(isSnoozed) };
}
export function deadlines(subs, examDate, now) {
  const today = todayNum(now), out = [];
  if (examDate) out.push({ label: 'CPALE exam', date: examDate });
  for (const s of subs) if (s.targetDate) out.push({ label: `${s.id} target`, date: s.targetDate });
  return out.map(x => ({ ...x, days: dnum(x.date) - today })).sort((a, b) => a.date.localeCompare(b.date));
}
export function activityFeed({ assessments, rounds, progress, nodes, limit = 8 }) {
  const N = new Map(nodes.map(n => [n.id, n])), ev = [];
  for (const a of assessments) if (!a.removedAt) ev.push({ ts: a.updatedAt || a.createdAt || '', text: `Logged assessment: ${a.name} (${a.subject})` });
  for (const r of rounds) if (!r.removedAt) ev.push({ ts: r.createdAt || '', text: `Created screening round: ${r.name} (${r.subject})` });
  for (const p of progress) if (p.done && p.updatedAt) { const n = N.get(p.id); if (n && !n.removedAt) ev.push({ ts: p.updatedAt, text: `Notes updated: ${n.name}` }); }
  return ev.filter(e => e.ts).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}
// Minutes recorded on assessments dated within the last 7 days (not a study log; that comes with the planner).
export function weekMinutes(assessments, now) {
  const today = todayNum(now);
  const rows = assessments.filter(a => !a.removedAt && a.minutes != null && today - dnum(a.date) >= 0 && today - dnum(a.date) <= 6);
  return { minutes: rows.reduce((s, a) => s + a.minutes, 0), count: rows.length };
}
