import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, screenGroups, validateEntry, scoreOf, band, isReliable, hitsFor, allocate } from './model.js';
import { getSubj, setSubj } from './views.js';
const today = () => new Date().toISOString().slice(0, 10);
const BC = { Weak: '#ff6b6b', Developing: '#ffb454', Strong: '#3ddc84' };
const pill = b => h('span', { class: 'fl', style: `background:${BC[b]};margin:0` }, b);
const fmt = x => (+x.toFixed(1)) + '%';
const ask = (m, d = '') => { const v = prompt(m, d); return v && v.trim() ? v.trim() : null; };

export async function screening(root) {
  const S = { subj: getSubj(), round: null, excl: false };
  let nodes, rounds, scr, cfg, prog, alloc;
  const load = async () => {
    nodes = await db.all('nodes'); rounds = (await db.all('rounds')).filter(r => !r.removedAt);
    scr = new Map((await db.all('screenings')).map(s => [s.id, s]));
    cfg = await db.screenCfg(); prog = Object.fromEntries((await db.all('progress')).map(p => [p.id, p]));
    alloc = (await db.get('settings', 'alloc:' + S.subj)) || { key: 'alloc:' + S.subj, hours: '', overrides: {} };
  };
  const rs = () => rounds.filter(r => r.subject === S.subj).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const run = async (fn, ctx) => { try { await fn(); await load(); draw(); } catch (e) { report(e, ctx); } };
  const newRound = () => {
    const R = rs(), name = ask('Round name', R.length ? `Round ${R.length + 1}` : 'Baseline'); if (!name) return;
    const id = 'r' + Date.now().toString(36);
    run(async () => { await db.put('rounds', { id, subject: S.subj, name, date: today(), source: '', createdAt: new Date().toISOString(), removedAt: null }); S.round = id; }, 'new round');
  };

  const draw = () => {
    root.replaceChildren();
    const R = rs(), G = screenGroups(nodes, S.subj);
    if (!R.some(r => r.id === S.round)) S.round = R.length ? R[R.length - 1].id : null;
    const round = R.find(r => r.id === S.round);
    const sel = h('select', { 'aria-label': 'Round' }, [...R].reverse().map(r => h('option', { value: r.id, selected: r.id === S.round }, `${r.name} (${r.date})`)));
    sel.addEventListener('change', () => { S.round = sel.value; draw(); });
    const field = (k, type, w) => {
      const i = h('input', { type, value: round[k] || '', placeholder: k, style: w ? `width:${w}` : '', 'aria-label': 'Round ' + k });
      i.addEventListener('change', () => { if ((k === 'name' || k === 'date') && !i.value.trim()) { draw(); return; } run(() => db.put('rounds', { ...round, [k]: i.value.trim() }), 'edit round'); });
      return i;
    };
    root.append(h('div', { class: 'tabs' }, SUBJECTS.map(id => h('button', { class: id === S.subj ? 'on' : '', onclick: () => { S.subj = id; setSubj(id); S.round = null; run(async () => {}, 'tab'); } }, id))),
      h('h1', {}, 'Screening: ' + S.subj),
      h('div', { class: 'tool' }, R.length ? 'Round:' : null, R.length ? sel : null, round ? [field('name', 'text'), field('date', 'date'), field('source', 'text', '150px')] : null,
        h('button', { onclick: newRound }, '+ New round'),
        round ? h('button', { onclick: () => { if (confirm(`Remove round "${round.name}"? You can restore it in Settings.`)) run(() => db.put('rounds', { ...round, removedAt: new Date().toISOString() }), 'remove round'); } }, 'Remove round') : null));
    if (!G.length) { root.append(h('p', { class: 'mut' }, 'This subject has no subtopic groups with counted files yet. Add them in Syllabus first.')); return; }
    if (!round) { root.append(h('p', { class: 'mut' }, 'Create a round (for example "Baseline") to start entering diagnostic scores.')); return; }

    const cells = {}, ins = {};
    const commit = async g => {
      const { c, t } = ins[g.group.id], id = round.id + '|' + g.group.id, old = scr.get(id), cs = c.value.trim(), ts = t.value.trim();
      try {
        if (cs === '' && ts === '') { await db.del('screenings', id); scr.delete(id); refresh(); return; }
        if (cs === '' || ts === '') return; // wait until both are filled
        const v = validateEntry(cs, ts);
        if (!v.ok) { toast(`${g.group.name}: ${v.msg}`, 'err'); c.value = old ? old.correct : ''; t.value = old ? old.total : ''; return; }
        const rec = { id, roundId: round.id, groupId: g.group.id, correct: v.correct, total: v.total, updatedAt: new Date().toISOString() };
        await db.put('screenings', rec); scr.set(id, rec); refresh();
      } catch (e) { report(e, 'save screening'); }
    };
    const tbl = h('table', { class: 'scr' }, h('tr', {}, ['Subtopic', 'Files', 'Correct', 'Total', 'Score', 'Band', 'Reliability', 'Previous', 'Change'].map(x => h('th', {}, x))));
    let lastTopic = null;
    for (const g of G) {
      if (g.topic.id !== lastTopic) { lastTopic = g.topic.id; tbl.append(h('tr', { class: 'tr-topic' }, h('td', { colspan: 9 }, g.topic.name))); }
      const s = scr.get(round.id + '|' + g.group.id) || {};
      const mk = k => { const i = h('input', { type: 'number', min: 0, step: 1, value: s[k] ?? '', 'aria-label': `${k}: ${g.group.name}` }); i.addEventListener('change', () => commit(g)); return i; };
      const c = mk('correct'), t = mk('total'); ins[g.group.id] = { c, t };
      const cl = cells[g.group.id] = { score: h('td'), band: h('td'), rel: h('td'), prev: h('td'), delta: h('td') };
      tbl.append(h('tr', {}, h('td', {}, g.group.name), h('td', { class: 'mut' }, g.size), h('td', {}, c), h('td', {}, t), cl.score, cl.band, cl.rel, cl.prev, cl.delta));
    }
    const box = () => h('div', { class: 'panel', style: 'margin-top:10px' });
    const sumBox = box(), rankBox = box(), allocBox = box();
    let cur = [];

    const renderAlloc = () => {
      const rows = cur.filter(x => !(S.excl && !x.rel)), H = parseFloat(alloc.hours);
      const sug = allocate(rows.map(x => ({ id: x.g.group.id, score: x.sc, size: x.g.size })), H, cfg.strongFrom);
      const save = () => db.put('settings', alloc).catch(e => report(e, 'allocation'));
      const hi = h('input', { type: 'number', min: 0, step: 0.5, value: alloc.hours, style: 'width:80px', 'aria-label': 'Hours to split' });
      hi.addEventListener('change', () => { alloc.hours = hi.value; save(); renderAlloc(); });
      const ex = h('input', { type: 'checkbox' }); ex.checked = S.excl; ex.addEventListener('change', () => { S.excl = ex.checked; renderAlloc(); });
      let tot = 0;
      const trs = [...cur].sort((a, b) => a.sc - b.sc).map(x => {
        const id = x.g.group.id, out = S.excl && !x.rel, s = out ? 0 : sug.get(id) || 0, ov = alloc.overrides[id], eff = ov != null ? ov : s; tot += eff;
        const oi = h('input', { type: 'number', min: 0, step: 0.1, value: ov ?? '', style: 'width:70px', 'aria-label': 'My hours: ' + x.g.group.name });
        oi.addEventListener('change', () => { const v = parseFloat(oi.value); if (oi.value.trim() === '' || !(v >= 0)) delete alloc.overrides[id]; else alloc.overrides[id] = v; save(); renderAlloc(); });
        return h('tr', {}, h('td', {}, x.g.group.name, x.rel ? '' : h('span', { class: 'mut' }, ' (tentative)')), h('td', {}, fmt(x.sc)), h('td', {}, x.g.size), h('td', {}, out ? 'excluded' : s.toFixed(1)), h('td', {}, oi), h('td', {}, eff.toFixed(1)));
      });
      const allStrong = cur.length > 0 && rows.every(x => x.sc >= cfg.strongFrom);
      allocBox.replaceChildren(h('h2', {}, 'Study-time suggestion (estimate)'),
        h('div', { class: 'tool' }, 'Hours to split:', hi, h('label', {}, ex, ' exclude tentative scores')),
        h('div', { class: 'mut' }, `Weight = (${cfg.strongFrom}% minus score) x number of counted notes files; zero at or above Strong. A rough guide, not a prediction. It ignores difficulty and exam weighting.`),
        !(H > 0) ? h('p', {}, 'Enter the hours you want to split to see a suggestion.') : allStrong ? h('p', {}, 'Every screened subtopic is at or above Strong, so no study time is suggested.') : null,
        cur.length ? h('table', {}, h('tr', {}, ['Subtopic', 'Score', 'Files', 'Suggested h', 'My hours', 'Effective h'].map(x => h('th', {}, x))), trs,
          h('tr', {}, h('td', { colspan: 5 }, H > 0 ? `Total effective hours (target ${H})` : 'Total effective hours'), h('td', {}, tot.toFixed(1)))) : h('div', { class: 'mut' }, 'No screened subtopics yet.'));
    };

    const refresh = () => {
      const Rn = rs(), unscreened = []; cur = [];
      for (const g of G) {
        const hits = hitsFor(g.group.id, Rn, scr), here = hits.findIndex(x => x.round.id === round.id), c = cells[g.group.id];
        c.band.replaceChildren(); c.score.textContent = c.rel.textContent = c.prev.textContent = c.delta.textContent = ''; c.rel.className = '';
        if (here >= 0) {
          const r = hits[here].rec, sc = scoreOf(r.correct, r.total), rl = isReliable(r.total, cfg);
          c.score.textContent = `${fmt(sc)} (${r.correct}/${r.total})`; c.band.append(pill(band(sc, cfg)));
          c.rel.textContent = rl ? 'Reliable' : 'Tentative'; if (!rl) c.rel.className = 'mut';
          if (here > 0) { const p = hits[here - 1], ps = scoreOf(p.rec.correct, p.rec.total), d = sc - ps; c.prev.textContent = `${fmt(ps)} (${p.round.name})`; c.delta.textContent = (d > 0 ? '+' : '') + (+d.toFixed(1)) + ' pts'; }
        }
        if (hits.length) { const l = hits[hits.length - 1], sc = scoreOf(l.rec.correct, l.rec.total); cur.push({ g, sc, n: l.rec.total, b: band(sc, cfg), rel: isReliable(l.rec.total, cfg) }); } else unscreened.push(g);
      }
      const cnt = b => cur.filter(x => x.b === b).length;
      sumBox.replaceChildren(h('h2', {}, 'Current status (latest data per subtopic, across all rounds)'),
        h('div', {}, `Weak ${cnt('Weak')} · Developing ${cnt('Developing')} · Strong ${cnt('Strong')} · tentative ${cur.filter(x => !x.rel).length} · not screened ${unscreened.length} of ${G.length}`),
        h('div', { class: 'mut' }, `Weak below ${cfg.weakBelow}%, Strong from ${cfg.strongFrom}%, reliable from ${cfg.minQ} questions (change in Settings).`),
        unscreened.length ? h('div', { class: 'mut' }, 'Not screened: ' + unscreened.map(g => g.group.name).join('; ')) : null);
      const ranked = [...cur].sort((a, b) => a.sc - b.sc || b.g.size - a.g.size);
      const act = x => {
        const tk = x.g.files.filter(f => prog[f.id] && prog[f.id].done).length;
        return (x.b === 'Weak' ? `Review ${x.g.size} notes files (${tk} ticked), then retest next round` : x.b === 'Developing' ? 'Practice questions here, then retest' : 'Maintain; revisit later to confirm') + (x.rel ? '' : '. Add more questions to confirm this score');
      };
      rankBox.replaceChildren(h('h2', {}, 'Weakness ranking (lowest score first)'),
        ranked.length ? h('table', {}, h('tr', {}, ['#', 'Subtopic', 'Score (n)', 'Band', 'Next action'].map(x => h('th', {}, x))),
          ranked.map((x, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, x.g.group.name, h('span', { class: 'mut' }, ' · ' + x.g.topic.name)), h('td', {}, `${fmt(x.sc)} (${x.n})`),
            h('td', {}, pill(x.b), x.rel ? '' : h('span', { class: 'mut' }, ' tentative')),
            h('td', {}, act(x), ' ', h('a', { href: '#/syllabus', onclick: () => setSubj(S.subj) }, 'Open Syllabus'))))) : h('div', { class: 'mut' }, 'Enter scores above to see the ranking.'));
      renderAlloc();
    };
    root.append(sumBox, tbl, rankBox, allocBox);
    refresh();
  };
  await load(); draw();
}
