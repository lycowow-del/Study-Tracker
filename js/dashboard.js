import { h, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, screenGroups, progress, localISO } from './model.js';
import { buildEvidence, analyze, buildSources } from './analytics.js';
import { recommend, deadlines, activityFeed, weekMinutes } from './reco.js';
import { weekSummary } from './planner.js';
import { getSubj, setSubj } from './views.js';
const COL = { Mastered: '#3ddc84', Developing: '#ffb454', Weak: '#ff6b6b', 'Too little evidence': '#5b646c' };
const fmt = x => x == null ? '–' : (+x.toFixed(1)) + '%';
const hrs = m => (m / 60).toFixed(1) + ' h';
const pill = s => h('span', { class: 'fl', style: `background:${COL[s]};margin:0;color:${s === 'Too little evidence' ? '#fff' : '#000'}` }, s);

export async function dashboardPage(root) {
  const S = { subj: getSubj(), snz: false, more: false };
  let d;
  const load = async () => {
    d = { nodes: await db.all('nodes'), rounds: await db.all('rounds'), screenings: await db.all('screenings'), assessments: await db.all('assessments'), rows: await db.all('assessmentRows'),
      subs: await db.all('subjects'), types: await db.assessTypes(), sessions: await db.all('sessions'), plan: await db.all('plan'), cfg: await db.planCfg(), prog: await db.all('progress'), cS: await db.screenCfg(), cA: await db.analyticsCfg(),
      exam: ((await db.get('settings', 'exam')) || {}).date || '', snoozed: ((await db.get('settings', 'snoozed')) || {}).items || {} };
  };
  const run = async (fn, ctx) => { try { await fn(); await load(); draw(); } catch (e) { report(e, ctx); } };
  const draw = () => {
    root.replaceChildren();
    const now = new Date(), { cS, cA } = d, done = id => d.prog.some(p => p.id === id && p.done);
    const skip = new Set(d.types.filter(t => !t.countsTowardMastery).map(t => t.id)), ev = buildEvidence({ ...d, skipTypes: skip });
    const data = SUBJECTS.map(s => { const groups = screenGroups(d.nodes, s); if (!groups.length) return { s, groups }; return { s, groups, res: analyze({ groups, items: ev.items, excluded: ev.excluded, cA, cS, now }), cov: progress(groups.flatMap(g => g.files), done) }; });
    const cur = data.find(x => x.s === S.subj), P = (title, ...k) => h('div', { class: 'panel' }, h('h2', {}, title), ...k);
    const examIn = h('input', { type: 'date', value: d.exam, 'aria-label': 'CPALE exam date' });
    examIn.addEventListener('change', () => run(() => db.put('settings', { key: 'exam', date: examIn.value }), 'exam date'));
    const dl = deadlines(d.subs, d.exam, now);
    const wk = weekMinutes(d.assessments, now), ws = weekSummary({ today: localISO(now), cfg: d.cfg, sessions: d.sessions, plan: d.plan });
    root.append(h('div', { class: 'tabs' }, SUBJECTS.map(id => h('button', { class: id === S.subj ? 'on' : '', onclick: () => { S.subj = id; setSubj(id); draw(); } }, id))), h('h1', {}, 'Command Center: ' + S.subj));

    // Recommendations (selected subject)
    if (cur.groups.length) {
      const hasScr = d.rounds.some(r => !r.removedAt && r.subject === S.subj && d.screenings.some(s => s.roundId === r.id && s.total > 0));
      const rec = recommend({ per: cur.res.per, cS, cA, now, hasScreening: hasScr, subject: S.subj, snoozed: d.snoozed, ticked: p => p.g.files.filter(f => done(f.id)).length });
      const snooze = (id, until) => run(() => db.put('settings', { key: 'snoozed', items: { ...d.snoozed, [id]: until } }), 'snooze');
      const card = (r, isSnoozed) => h('div', { class: 'panel', style: 'margin:6px 0;padding:8px' },
        h('div', { class: 'tool', style: 'margin:0' }, h('b', {}, r.title), h('a', { href: r.link, onclick: () => setSubj(S.subj) }, 'Open'),
          isSnoozed ? h('button', { onclick: () => snooze(r.id, '') }, 'Restore') : h('button', { onclick: () => snooze(r.id, new Date(now.getTime() + 7 * 864e5).toISOString()) }, 'Snooze 7 days')),
        h('details', { class: 'mut' }, h('summary', {}, 'Why this?'), h('div', {}, r.why)));
      const shown = S.more ? rec.items : rec.items.slice(0, 6);
      root.append(P('Recommended next actions', h('div', { class: 'mut' }, 'Ranked by: baseline screening, weakest subtopics, retests that are due, thin evidence, then unstarted subtopics. Each one explains itself, and you can snooze any of them.'),
        shown.length ? shown.map(r => card(r, false)) : h('div', {}, 'Nothing to recommend right now.'),
        rec.items.length > 6 ? h('button', { onclick: () => { S.more = !S.more; draw(); } }, S.more ? 'Show fewer' : `Show all ${rec.items.length}`) : null,
        rec.snoozed.length ? h('div', { class: 'tool' }, h('button', { onclick: () => { S.snz = !S.snz; draw(); } }, `${S.snz ? 'Hide' : 'Show'} snoozed (${rec.snoozed.length})`)) : null,
        S.snz ? rec.snoozed.map(r => card(r, true)) : null));
    } else root.append(P('Recommended next actions', h('div', { class: 'mut' }, `${S.subj} has no syllabus yet. Add topics in Syllabus, or choose FAR.`)));

    const weakest = cur.groups.length ? cur.res.per.filter(p => p.Q >= cS.minQ && p.S != null).sort((a, b) => a.S - b.S).slice(0, 5) : [];
    const src = cur.groups.length ? buildSources({ rounds: d.rounds, screenings: d.screenings, assessments: d.assessments, rows: d.rows, subject: S.subj, skipTypes: skip }).slice(-5).reverse() : [];
    const feed = activityFeed({ assessments: d.assessments, rounds: d.rounds, progress: d.prog, nodes: d.nodes });
    root.append(h('div', { class: 'grid', style: 'margin-top:10px' },
      P('Countdown and deadlines', h('div', { class: 'tool' }, 'CPALE exam date:', examIn),
        dl.length ? h('table', {}, dl.map(x => h('tr', {}, h('td', {}, x.label), h('td', {}, x.date), h('td', { style: x.days < 0 ? 'color:var(--err)' : x.days <= 14 ? 'color:#ffb454' : '' }, x.days < 0 ? 'passed' : x.days === 0 ? 'today' : `${x.days} days`)))) : h('div', { class: 'mut' }, 'No dates set. Set the exam date above, and a target date per subject in Syllabus.')),
      P('Readiness by subject', h('table', {}, h('tr', {}, ['Subject', 'Mastered', 'Developing', 'Weak', 'Too little', 'Notes made'].map(x => h('th', {}, x))),
        data.map(x => x.groups.length ? h('tr', {}, h('td', {}, x.s), h('td', {}, x.res.counts.Mastered), h('td', {}, x.res.counts.Developing), h('td', {}, x.res.counts.Weak), h('td', {}, x.res.counts['Too little evidence']), h('td', {}, `${x.cov.done}/${x.cov.total}`))
          : h('tr', {}, h('td', {}, x.s), h('td', { colspan: 5, class: 'mut' }, 'no syllabus yet')))), h('div', { class: 'mut' }, 'Counts of subtopics by evidence-based status. Notes made is coverage only, not understanding.')),
      P(`Weakest subtopics (${S.subj})`, weakest.length ? h('table', {}, weakest.map(p => h('tr', {}, h('td', {}, p.g.group.name), h('td', {}, fmt(p.S)), h('td', { class: 'mut' }, `${p.Q} q`), h('td', {}, pill(p.status))))) : h('div', { class: 'mut' }, `Appears once a subtopic has ${cS.minQ}+ questions of evidence.`)),
      P(`Recent performance (${S.subj})`, src.length ? src.map(s => h('div', { style: 'margin:3px 0' }, `${s.name} · ${s.date} · ${fmt(s.score)} (${s.total} q${s.attempt === 'repeat' ? ', repeat' : ''})`, h('div', { class: 'bar' }, h('i', { style: `width:${s.score}%` })))) : h('div', { class: 'mut' }, 'No results yet.')),
      P('This week', h('div', {}, `Study log: ${hrs(ws.actual)} of ${hrs(ws.target)} weekly capacity (${Math.round(100 * ws.actual / Math.max(1, ws.target))}%)`),
        h('div', {}, `Planned: ${hrs(ws.planned)} · marked done: ${hrs(ws.rows.reduce((a, r) => a + r.doneMin, 0))} · missed days: ${ws.rows.filter(r => r.status === 'missed').length}`),
        h('div', { class: 'mut' }, `Assessment minutes (separate, not added to the study log): ${wk.minutes} in ${wk.count} assessment${wk.count === 1 ? '' : 's'} over the last 7 days. Set capacity and plan in Planner.`)),
      P('Recent activity', feed.length ? feed.map(e => h('div', {}, h('span', { class: 'mut' }, e.ts.slice(0, 16).replace('T', ' ') + ' '), e.text)) : h('div', { class: 'mut' }, 'Nothing yet.'))));
  };
  try { await load(); draw(); } catch (e) { report(e, 'dashboard'); }
}
