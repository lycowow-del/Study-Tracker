// Pure planning logic (no DOM or IndexedDB). Package 9.
export const STUDY_ACTIVITIES = ['Notes / lecture', 'Practice questions', 'Review', 'Assessment', 'Other'];
// hours[getDay()]: index 0 = Sunday. Defaults are placeholders inside your stated 2-4 hours on weekdays; weekends are editable.
export const DEFAULT_PLAN = { hours: [2, 3, 3, 3, 3, 3, 4], blockDays: 3, reviewMinutes: 20, focus: 3 };
const DAY = 864e5;
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const weekdayOf = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
export const mondayOf = iso => addDays(iso, -((weekdayOf(iso) + 6) % 7));
// Weight of a subtopic = (Strong cut-off - score) x counted notes files; unknown score is treated as the Weak cut-off.
export const topicWeight = (t, cS) => Math.max(0, cS.strongFrom - (t.S ?? cS.weakBelow)) * t.size;
// Split `units` whole 15-minute units across weights (largest-remainder rounding).
export function split(units, weights) {
  const sum = weights.reduce((a, b) => a + b, 0), raw = weights.map(w => units * w / sum), base = raw.map(Math.floor);
  let rem = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < rem; k++) base[order[k][1]]++;
  return base;
}
// subjects: [{id, topics:[{gid,name,size,ticked,S}]}]; due: [{id,subject,name,priority}] retests already ranked.
export function generatePlan({ start, horizon = 7, cfg, subjects, due = [], cS }) {
  const days = [];
  for (let i = 0; i < horizon; i++) { const date = addDays(start, i), hours = cfg.hours[weekdayOf(date)] || 0; if (hours > 0) days.push({ date, hours }); }
  const subs = subjects.map(s => ({ ...s, ws: s.topics.map(t => ({ t, w: topicWeight(t, cS) })).filter(x => x.w > 0) })).filter(s => s.ws.length);
  const need = subs.map(s => s.ws.reduce((a, x) => a + x.w, 0)), total = need.reduce((a, b) => a + b, 0);
  const planned = Object.fromEntries(subs.map(s => [s.id, 0])), topicHours = {}, usedDue = new Set();
  let cur = null, left = 0, soFar = 0;
  const out = [];
  for (const day of days) {
    let subject = null;
    if (subs.length) {
      if (left > 0 && cur) subject = cur;
      else {
        let best = -Infinity;
        subs.forEach((s, i) => { const def = need[i] / total * (soFar + day.hours) - planned[s.id]; if (def > best + 1e-9) { best = def; subject = s.id; } });
        cur = subject; left = cfg.blockDays;
      }
      left--;
    }
    const units = Math.floor(day.hours * 60 / 15), avail = due.filter(x => !usedDue.has(x.id));
    const rSlots = Math.min(Math.floor(cfg.reviewMinutes / 15), Math.floor(units / 3), avail.length), reviews = [];
    for (const x of avail.slice(0, rSlots)) { usedDue.add(x.id); reviews.push({ ...x, minutes: 15 }); }
    const items = [];
    if (subject) {
      const s = subs.find(x => x.id === subject), studyUnits = units - reviews.length;
      const cand = s.ws.map(x => ({ ...x, p: x.w / (1 + (topicHours[x.t.gid] || 0)) })).sort((a, b) => b.p - a.p || a.t.name.localeCompare(b.t.name)).slice(0, Math.max(1, Math.min(cfg.focus, studyUnits)));
      const u = split(studyUnits, cand.map(c => c.p));
      cand.forEach((c, i) => {
        if (u[i] > 0) { items.push({ subject, gid: c.t.gid, name: c.t.name, minutes: u[i] * 15, kind: 'study', label: c.t.ticked < c.t.size ? 'Make or review notes' : 'Practice questions and test' }); topicHours[c.t.gid] = (topicHours[c.t.gid] || 0) + u[i] * 15 / 60; }
      });
      planned[subject] += day.hours;
    }
    soFar += day.hours;
    out.push({ ...day, subject, items, reviews });
  }
  return { days: out, shares: subs.map((s, i) => ({ subject: s.id, share: need[i] / total })) };
}
export function planItems(days, now) {
  const out = [];
  for (const day of days) {
    for (const it of day.items) out.push({ id: `p:${day.date}:${it.subject}:${it.gid}`, date: day.date, subject: it.subject, gid: it.gid, name: it.name, minutes: it.minutes, kind: 'study', label: it.label, done: false, createdAt: now });
    for (const r of day.reviews) out.push({ id: `p:${day.date}:rv:${r.id}`, date: day.date, subject: r.subject, gid: '', name: r.name, minutes: r.minutes, kind: 'review', label: 'Spaced review', done: false, createdAt: now });
  }
  return out;
}
// Saving a plan replaces future unfinished items only; past and finished items are never touched.
export function mergePlan(existing, generated, today) {
  const stale = p => p.date >= today && !p.done, keep = new Set(existing.filter(p => !stale(p)).map(p => p.id));
  return { remove: existing.filter(stale), add: generated.filter(p => !keep.has(p.id)) };
}
export const missedItems = (plan, today) => plan.filter(p => p.date < today && !p.done);
export function weekSummary({ today, cfg, sessions, plan }) {
  const mon = mondayOf(today), rows = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(mon, i), avail = (cfg.hours[weekdayOf(date)] || 0) * 60;
    const actual = sessions.filter(s => !s.removedAt && s.date === date).reduce((a, s) => a + s.minutes, 0);
    const items = plan.filter(p => p.date === date), planned = items.reduce((a, p) => a + p.minutes, 0), doneMin = items.filter(p => p.done).reduce((a, p) => a + p.minutes, 0);
    const status = date > today ? 'upcoming' : planned === 0 ? (actual > 0 ? 'unplanned' : 'none') : doneMin >= planned ? 'done' : date === today ? 'today' : 'missed';
    rows.push({ date, avail, planned, actual, doneMin, items: items.length, status });
  }
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  return { monday: mon, rows, target: sum('avail'), actual: sum('actual'), planned: sum('planned') };
}
