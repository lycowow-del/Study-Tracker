import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, screenGroups, localISO } from './model.js';
import { buildEvidence, analyze } from './analytics.js';
import { recommend } from './reco.js';
import { STUDY_ACTIVITIES, generatePlan, planItems, mergePlan, missedItems, weekSummary, addDays } from './planner.js';
import { getSubj } from './views.js';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hrs = m => (m / 60).toFixed(1) + ' h';
const STAT = { done: 'done', today: 'today', missed: 'missed', upcoming: '', unplanned: 'unplanned', none: '' };

export async function plannerPage(root) {
  const S = { preview: null, removed: false, form: null };
  let d;
  const today = () => localISO();
  const load = async () => {
    d = { nodes: await db.all('nodes'), rounds: await db.all('rounds'), screenings: await db.all('screenings'), assessments: await db.all('assessments'), rows: await db.all('assessmentRows'), prog: await db.all('progress'),
      types: await db.assessTypes(), cS: await db.screenCfg(), cA: await db.analyticsCfg(), cfg: await db.planCfg(), sessions: await db.all('sessions'), plan: await db.all('plan'), timer: await db.get('settings', 'timer') };
  };
  const run = async (fn, ctx) => { try { await fn(); await load(); draw(); } catch (e) { report(e, ctx); } };
  const P = (title, ...k) => h('div', { class: 'panel', style: 'margin-top:10px' }, h('h2', {}, title), ...k);
  const nodeName = id => { const n = d.nodes.find(x => x.id === id); return n ? n.name : ''; };

  const subjectData = () => {
    const skip = new Set(d.types.filter(t => !t.countsTowardMastery).map(t => t.id)), ev = buildEvidence({ ...d, skipTypes: skip }), now = new Date(), isDone = id => d.prog.some(p => p.id === id && p.done);
    const subjects = [], due = [];
    for (const s of SUBJECTS) {
      const groups = screenGroups(d.nodes, s); if (!groups.length) continue;
      const res = analyze({ groups, items: ev.items, excluded: ev.excluded, cA: d.cA, cS: d.cS, now });
      subjects.push({ id: s, topics: res.per.map(p => ({ gid: p.g.group.id, name: p.g.group.name, size: p.g.size, ticked: p.g.files.filter(f => isDone(f.id)).length, S: p.S })) });
      const hasScr = d.rounds.some(r => !r.removedAt && r.subject === s && d.screenings.some(x => x.roundId === r.id && x.total > 0));
      for (const r of recommend({ per: res.per, cS: d.cS, cA: d.cA, now, hasScreening: hasScr, subject: s }).items.filter(r => r.kind === 'retest')) due.push({ id: r.id, subject: s, name: r.title, priority: r.priority });
    }
    return { subjects, due: due.sort((a, b) => b.priority - a.priority) };
  };

  const settingsPanel = () => {
    const { cfg } = d, save = patch => run(() => db.put('settings', { key: 'plan', ...cfg, ...patch }), 'plan settings');
    const num = (val, min, max, int, onOk, label) => { const i = h('input', { type: 'number', min, max, step: int ? 1 : 0.5, value: val, style: 'width:70px', 'aria-label': label });
      i.addEventListener('change', () => { const v = Number(i.value); if (i.value.trim() === '' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) { toast(`${label}: enter ${int ? 'a whole number' : 'a number'} from ${min} to ${max}.`, 'err'); draw(); return; } onOk(v); }); return i; };
    const hours = [1, 2, 3, 4, 5, 6, 0].map(g => h('label', {}, DOW[g] + ' ', num(cfg.hours[g], 0, 16, false, v => { const hh = [...cfg.hours]; hh[g] = v; save({ hours: hh }); }, DOW[g] + ' hours'), ' h '));
    return P('Plan settings', h('div', { class: 'tool' }, 'Hours available per day:', ...hours),
      h('div', { class: 'tool' }, 'Days per subject block:', num(cfg.blockDays, 1, 14, true, v => save({ blockDays: v }), 'Block days'), 'Spaced-review minutes per day (0 = off):', num(cfg.reviewMinutes, 0, 240, true, v => save({ reviewMinutes: v }), 'Review minutes'), 'Focus subtopics per day:', num(cfg.focus, 1, 8, true, v => save({ focus: v }), 'Focus subtopics')),
      h('div', { class: 'mut' }, 'Defaults are placeholders: weekdays 3 h (inside your 2-4 h), Saturday 4 h, Sunday 2 h. Set your real availability, and 0 for days off.'));
  };

  const logPanel = () => {
    const f = S.form = S.form || { date: today(), subject: getSubj(), minutes: '', activity: STUDY_ACTIVITIES[0], gid: '', note: '' };
    const bind = (k, type, o = {}) => { const i = h('input', { type, value: f[k], ...o }); i.addEventListener('input', () => { f[k] = i.value; }); return i; };
    const pick = (k, opts, onChange) => { const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === f[k] }, l))); s.addEventListener('change', () => { f[k] = s.value; if (onChange) onChange(); }); return s; };
    const groups = screenGroups(d.nodes, f.subject);
    const add = () => {
      const m = Number(f.minutes);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast('Enter a valid date.', 'err'); return; }
      if (!Number.isInteger(m) || m < 1 || m > 1440) { toast('Minutes must be a whole number from 1 to 1440.', 'err'); return; }
      run(async () => { await db.put('sessions', { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: f.date, subject: f.subject, minutes: m, activity: f.activity, gid: f.gid, note: f.note.trim(), createdAt: new Date().toISOString(), removedAt: null }); S.form = null; toast('Session logged'); }, 'log session');
    };
    const t = d.timer, el = h('span', { class: 'mut' });
    if (t) { const tick = () => { if (!el.isConnected) { clearInterval(iv); return; } el.textContent = `${Math.max(0, Math.round((Date.now() - new Date(t.startedAt)) / 60000))} min elapsed`; }; const iv = setInterval(tick, 15000); tick(); }
    const stop = () => run(async () => { const m = Math.max(1, Math.round((Date.now() - new Date(t.startedAt)) / 60000)); await db.put('sessions', { id: 'u' + Date.now().toString(36), date: localISO(new Date(t.startedAt)), subject: t.subject, minutes: m, activity: t.activity, gid: '', note: 'Timer', createdAt: new Date().toISOString(), removedAt: null }); await db.del('settings', 'timer'); toast(`Logged ${m} min`); }, 'stop timer');
    const start = () => run(() => db.put('settings', { key: 'timer', startedAt: new Date().toISOString(), subject: f.subject, activity: f.activity }), 'start timer');
    const live = d.sessions.filter(s => !s.removedAt).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))), gone = d.sessions.filter(s => s.removedAt);
    const tr = (s, restoreBtn) => h('tr', {}, h('td', {}, s.date), h('td', {}, s.subject), h('td', {}, s.minutes), h('td', {}, s.activity), h('td', {}, nodeName(s.gid)), h('td', { class: 'mut' }, s.note || ''),
      h('td', {}, restoreBtn ? h('button', { onclick: () => run(() => db.put('sessions', { ...s, removedAt: null }), 'restore session') }, 'Restore') : h('button', { onclick: () => { if (confirm('Remove this session? You can restore it below.')) run(() => db.put('sessions', { ...s, removedAt: new Date().toISOString() }), 'remove session'); } }, '✕')));
    return P('Study log', h('div', { class: 'frow' }, h('label', {}, 'Date', bind('date', 'date')), h('label', {}, 'Subject', pick('subject', SUBJECTS.map(s => [s, s]), () => { f.gid = ''; draw(); })), h('label', {}, 'Minutes', bind('minutes', 'number', { min: 1, style: 'width:80px' })),
      h('label', {}, 'Activity', pick('activity', STUDY_ACTIVITIES.map(a => [a, a]))), h('label', {}, 'Subtopic (optional)', pick('gid', [['', 'Any'], ...groups.map(g => [g.group.id, g.group.name])])), h('label', {}, 'Note', bind('note', 'text')), h('button', { onclick: add }, 'Add session')),
      h('div', { class: 'tool' }, t ? [h('span', {}, `Timer running: ${t.subject}, ${t.activity}. `), el, h('button', { onclick: stop }, 'Stop and log')] : [h('button', { onclick: start }, 'Start timer'), h('span', { class: 'mut' }, 'Uses the subject and activity above.')]),
      live.length ? h('div', { style: 'overflow-x:auto' }, h('table', {}, h('tr', {}, ['Date', 'Subject', 'Minutes', 'Activity', 'Subtopic', 'Note', ''].map(x => h('th', {}, x))), live.slice(0, 12).map(s => tr(s, false)))) : h('div', { class: 'mut' }, 'No sessions logged yet.'),
      live.length > 12 ? h('div', { class: 'mut' }, `Showing the latest 12 of ${live.length}. Export the full study log from Data Management.`) : null,
      gone.length ? h('div', { class: 'tool' }, h('button', { onclick: () => { S.removed = !S.removed; draw(); } }, `${S.removed ? 'Hide' : 'Show'} removed (${gone.length})`)) : null,
      S.removed && gone.length ? h('table', {}, gone.map(s => tr(s, true))) : null);
  };

  const weekPanel = () => {
    const ws = weekSummary({ today: today(), cfg: d.cfg, sessions: d.sessions, plan: d.plan });
    return P(`This week (from ${ws.monday})`, h('div', {}, `Logged ${hrs(ws.actual)} of ${hrs(ws.target)} capacity · planned ${hrs(ws.planned)}`),
      h('table', {}, h('tr', {}, ['Day', 'Available', 'Planned', 'Done (ticked)', 'Logged', 'Status'].map(x => h('th', {}, x))),
        ws.rows.map(r => h('tr', {}, h('td', {}, `${DOW[new Date(r.date + 'T00:00:00Z').getUTCDay()]} ${r.date.slice(5)}`), h('td', {}, hrs(r.avail)), h('td', {}, r.planned ? hrs(r.planned) : '–'), h('td', {}, r.planned ? hrs(r.doneMin) : '–'), h('td', {}, r.actual ? hrs(r.actual) : '–'),
          h('td', { style: r.status === 'missed' ? 'color:var(--err)' : r.status === 'done' ? 'color:var(--ac)' : '' }, STAT[r.status])))),
      h('div', { class: 'mut' }, 'Logged = study-log sessions that day. Done = plan items you ticked. Status compares ticked plan minutes with planned minutes; past days with unfinished items show as missed.'));
  };

  const planPanel = () => {
    const t = today(), upcoming = d.plan.filter(p => p.date >= t).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), missed = missedItems(d.plan, t).sort((a, b) => a.date.localeCompare(b.date));
    const suggest = () => { const { subjects, due } = subjectData(); S.preview = generatePlan({ start: t, cfg: d.cfg, subjects, due, cS: d.cS }); draw(); };
    const accept = () => { const { remove, add } = mergePlan(d.plan, planItems(S.preview.days, new Date().toISOString()), t); run(async () => { for (const p of remove) await db.del('plan', p.id); await db.putMany('plan', add); S.preview = null; toast('Plan saved'); }, 'save plan'); };
    const item = p => { const c = h('input', { type: 'checkbox', 'aria-label': 'Done' }); c.checked = p.done; c.addEventListener('change', () => run(() => db.put('plan', { ...p, done: c.checked }), 'plan item'));
      return h('div', { class: 'frow', style: 'align-items:center' }, c, h('span', {}, `${p.date.slice(5)} · ${p.subject} · ${p.name} · ${p.minutes} min · ${p.label}`), h('button', { onclick: () => run(() => db.del('plan', p.id), 'remove plan item') }, '✕')); };
    const pv = S.preview;
    return P('Plan', h('div', { class: 'tool' }, h('button', { onclick: suggest }, upcoming.length ? 'Re-plan from today' : 'Suggest a plan for the next 7 days'), h('span', { class: 'mut' }, 'Saving replaces only future unfinished items. Past and ticked items are kept.')),
      pv ? h('div', { class: 'panel', style: 'margin-bottom:8px' }, h('h2', {}, 'Suggested plan (not saved yet)'),
        pv.days.length ? [...pv.days.map(day => h('div', { style: 'margin:6px 0' }, h('b', {}, `${DOW[new Date(day.date + 'T00:00:00Z').getUTCDay()]} ${day.date.slice(5)} · ${hrs(day.hours * 60)}${day.subject ? ' · ' + day.subject : ''}`),
          ...day.items.map(i => h('div', {}, `${i.minutes} min · ${i.name} (${i.label})`)), ...day.reviews.map(r => h('div', { class: 'mut' }, `${r.minutes} min · ${r.name} (spaced review)`)),
          !day.items.length && !day.reviews.length ? h('div', { class: 'mut' }, 'Nothing to study: every subtopic is at or above Strong.') : null)),
          h('div', { class: 'mut' }, `Subject time split by need: ${pv.shares.map(s => `${s.subject} ${(100 * s.share).toFixed(0)}%`).join(' · ') || 'none'}. Subtopics are ranked by (Strong cut-off minus score) x notes files, with less priority for time already planned. Unscreened subtopics count as if at the Weak cut-off. This is a suggestion, not a prediction.`),
          h('div', { class: 'tool' }, h('button', { onclick: accept }, 'Accept and save this plan'), h('button', { onclick: () => { S.preview = null; draw(); } }, 'Discard'))]
          : h('div', { class: 'mut' }, 'No study days in the next 7 days. Set your available hours in Plan settings.')) : null,
      missed.length ? h('div', { class: 'panel', style: 'margin-bottom:8px;border-color:var(--err)' }, h('h2', {}, `Missed or unfinished (${missed.length})`), ...missed.map(item),
        h('div', { class: 'mut' }, 'Recovery: tick what you did anyway, remove what no longer matters, then Re-plan from today. The new plan re-ranks everything from your current evidence, so missed work is not simply repeated.')) : null,
      upcoming.length ? [h('h2', {}, 'Saved plan'), ...upcoming.map(item)] : h('div', { class: 'mut' }, 'No saved plan yet.'));
  };

  const allocPanel = () => {
    const { subjects } = subjectData(), t = today(), from = addDays(t, -6), by = {};
    for (const s of d.sessions) if (!s.removedAt && s.date >= from && s.date <= t) by[s.subject] = (by[s.subject] || 0) + s.minutes;
    const plannedBy = {}; for (const p of d.plan) if (p.date >= t && p.date <= addDays(t, 6)) plannedBy[p.subject] = (plannedBy[p.subject] || 0) + p.minutes;
    const gp = generatePlan({ start: t, cfg: d.cfg, subjects, due: [], cS: d.cS });
    return P('Time allocation by subject', h('table', {}, h('tr', {}, ['Subject', 'Share of need', 'Planned (next 7 days)', 'Logged (last 7 days)'].map(x => h('th', {}, x))),
      SUBJECTS.map(s => { const sh = gp.shares.find(x => x.subject === s); return h('tr', {}, h('td', {}, s), h('td', {}, sh ? (100 * sh.share).toFixed(0) + '%' : '–'), h('td', {}, plannedBy[s] ? hrs(plannedBy[s]) : '–'), h('td', {}, by[s] ? hrs(by[s]) : '–')); })),
      h('div', { class: 'mut' }, 'Share of need = each subject\'s total (Strong cut-off minus score) x notes files, as a percent of all subjects with something left to improve. Subjects with no syllabus yet show a dash.'));
  };

  const draw = () => { root.replaceChildren(h('h1', {}, 'Planner'), weekPanel(), planPanel(), logPanel(), allocPanel(), settingsPanel()); };
  try { await load(); draw(); } catch (e) { report(e, 'planner'); }
}
