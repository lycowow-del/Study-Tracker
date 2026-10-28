import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { localISO, SUBJECTS, kidsOf, validateRow, rowStats, overall, validateAssessment, signature, attemptInfo, normTool, toolsFor } from './model.js';
import { getSubj, setSubj } from './views.js';
const today = () => localISO();
const fmt = x => x == null ? '–' : (+x.toFixed(1)) + '%';
const DIFF = ['Easy', 'Medium', 'Hard'];

export async function assessments(root) {
  const S = { subj: getSubj(), type: '', att: '', open: new Set(), draft: null };
  let nodes, list, rowsBy, types, cats;
  const load = async () => {
    nodes = await db.all('nodes'); list = (await db.all('assessments')).filter(a => !a.removedAt); rowsBy = new Map();
    for (const r of await db.all('assessmentRows')) (rowsBy.get(r.assessmentId) || rowsBy.set(r.assessmentId, []).get(r.assessmentId)).push(r);
    types = await db.assessTypes(); cats = await db.errCats();
  };
  const run = async (fn, ctx) => { try { await fn(); await load(); draw(); } catch (e) { report(e, ctx); } };
  const groupsOf = () => { const kids = kidsOf(nodes.filter(n => n.subject === S.subj)), out = []; for (const t of kids.get('root:' + S.subj) || []) for (const g of kids.get(t.id) || []) if (g.kind === 'group') out.push({ id: g.id, label: `${t.name} › ${g.name}` }); return out; };
  const gname = id => { const n = nodes.find(x => x.id === id); return n ? n.name : '(removed subtopic)'; };
  const tname = id => (types.find(t => t.id === id) || { name: '(removed type)' }).name;
  const blank = () => ({ id: null, subject: S.subj, name: '', typeId: (toolsFor(types, S.subj)[0] || {}).id || '', date: today(), time: '', minutes: '', difficulty: '', attemptKind: 'first', attemptNo: 1, expected: '', notes: '', correctiveAction: '', errorCounts: {}, rows: [] });
  const fromRec = a => ({ ...a, minutes: a.minutes ?? '', expected: a.expected ?? '', time: a.time || '', errorCounts: { ...a.errorCounts },
    rows: (rowsBy.get(a.id) || []).map(r => ({ groupId: r.groupId, mode: r.mode, correct: r.correct ?? '', total: r.total ?? '', unanswered: r.unanswered ?? '', pct: r.pct ?? '' })) });

  const form = () => {
    const d = S.draft, tool = types.find(t => t.id === d.typeId) || normTool({});
    const typeSel = h('select', { 'aria-label': 'Type' }, toolsFor(types, S.subj, d.typeId).map(t => h('option', { value: t.id, selected: t.id === d.typeId }, t.name + (t.enabled ? '' : ' (disabled)'))));
    typeSel.addEventListener('change', () => { d.typeId = typeSel.value; draw(); });
    const bind = (k, type, o = {}) => { const i = h('input', { type, value: d[k] ?? '', ...o }); i.addEventListener('input', () => { d[k] = i.value; }); return i; };
    const sel = (k, opts) => { const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === d[k] }, l))); s.addEventListener('change', () => { d[k] = s.value; }); return s; };
    const fld = (l, el) => h('label', {}, l, el);
    const kind = sel('attemptKind', [['first', 'First attempt'], ['repeat', 'Repeat attempt']]), info = h('span', { class: 'mut' });
    const upd = () => {
      if (d.id) { info.textContent = `Attempt #${d.attemptNo}`; return; }
      const ai = attemptInfo(S.subj, d.name, list); d.attemptNo = ai.no;
      if (!d.kindTouched) { d.attemptKind = ai.kind; kind.value = ai.kind; }
      info.textContent = `Attempt #${ai.no}` + (ai.kind === 'repeat' ? ` (you logged this name ${ai.no - 1} time(s) before)` : '');
    };
    kind.addEventListener('change', () => { d.kindTouched = true; });
    const name = bind('name', 'text', { placeholder: 'e.g. FAR pre-board 1', style: 'width:260px' }); name.addEventListener('input', upd);
    const rowsBox = h('div', { class: 'form' });
    for (const r of d.rows) if (tool.entry !== 'both' && r.mode !== tool.entry) r.mode = tool.entry;
    const drawRows = () => rowsBox.replaceChildren(...d.rows.map((r, i) => {
      const inp = (k, w, ph) => { const x = h('input', { type: 'number', min: 0, step: k === 'pct' ? 'any' : 1, value: r[k], placeholder: ph, style: `width:${w}px`, 'aria-label': `${ph}: ${gname(r.groupId)}` }); x.addEventListener('input', () => { r[k] = x.value; }); return x; };
      const ms = h('select', {}, [['count', 'Correct / total'], ['pct', 'Percent only']].filter(([v]) => tool.entry === 'both' || tool.entry === v).map(([v, l]) => h('option', { value: v, selected: v === r.mode }, l)));
      ms.addEventListener('change', () => { r.mode = ms.value; drawRows(); });
      return h('div', { class: 'frow' }, h('b', { style: 'min-width:220px' }, gname(r.groupId)), ms,
        ...(r.mode === 'pct' ? [inp('pct', 80, 'Percent')] : [inp('correct', 70, 'Correct'), inp('unanswered', 90, 'Unanswered'), inp('total', 70, 'Total')]),
        h('button', { onclick: () => { d.rows.splice(i, 1); drawRows(); } }, '✕'));
    }));
    const addSel = h('select', {}, h('option', { value: '' }, '+ Add subtopic…'), ...groupsOf().map(g => h('option', { value: g.id }, g.label)));
    addSel.addEventListener('change', () => { if (addSel.value && !d.rows.some(r => r.groupId === addSel.value)) { d.rows.push({ groupId: addSel.value, mode: 'count', correct: '', total: '', unanswered: '', pct: '' }); drawRows(); } addSel.value = ''; });
    drawRows(); upd();
    const ecs = cats.map(c => { const x = h('input', { type: 'number', min: 0, step: 1, value: d.errorCounts[c.id] ?? '' }); x.addEventListener('input', () => { d.errorCounts[c.id] = x.value; }); return fld(c.name, x); });
    const ta = k => { const t = h('textarea', {}, d[k] || ''); t.addEventListener('input', () => { d[k] = t.value; }); return t; };
    return h('div', { class: 'panel form', style: 'margin-bottom:10px' }, h('h2', {}, d.id ? 'Edit assessment' : 'Log assessment'),
      h('div', { class: 'frow' }, fld('Name', name), fld('Type', typeSel), fld('Date', bind('date', 'date')), fld('Time (optional)', bind('time', 'time')),
        tool.trackTime ? fld('Minutes spent', bind('minutes', 'number', { min: 0 })) : null, fld('Difficulty', sel('difficulty', [['', '–'], ...DIFF.map(x => [x, x])])), fld('Attempt', kind), info,
        fld('Expected score % (before checking)', bind('expected', 'number', { min: 0, max: 100 }))),
      h('h2', {}, 'Subtopic breakdown (required)'), rowsBox, h('div', {}, addSel, groupsOf().length ? '' : h('span', { class: 'mut' }, ' No topics in this subject yet. Add them in Syllabus first.')),
      h('h2', {}, 'Mistakes by category (counts)'), h('div', { class: 'frow' }, ecs),
      fld('Notes', ta('notes')), fld('Corrective action', ta('correctiveAction')),
      h('div', { class: 'tool' }, h('button', { onclick: save }, 'Save'), h('button', { onclick: () => { S.draft = null; draw(); } }, 'Cancel')));
  };
  const save = async () => {
    const d = S.draft, rows = [], tool = types.find(t => t.id === d.typeId) || normTool({});
    for (const r of d.rows) { if (tool.entry !== 'both' && r.mode !== tool.entry) { toast(`${gname(r.groupId)}: this tool only allows ${tool.entry === 'count' ? 'correct / total' : 'percent'} entries.`, 'err'); return; } const v = validateRow(r); if (!v.ok) { toast(`${gname(r.groupId)}: ${v.msg}`, 'err'); return; } rows.push({ groupId: r.groupId, ...v.row }); }
    const ec = {};
    for (const [k, v] of Object.entries(d.errorCounts)) { const s = String(v).trim(); if (s === '') continue; if (!/^\d+$/.test(s)) { toast('Error counts must be whole numbers.', 'err'); return; } if (+s > 0) ec[k] = +s; }
    const chk = validateAssessment(d, rows, ec); if (!chk.ok) { toast(chk.msg, 'err'); return; }
    const id = d.id || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), now = new Date().toISOString();
    const a = { id, subject: d.subject, name: d.name.trim(), typeId: d.typeId, date: d.date, time: d.time || '', minutes: (!tool.trackTime || String(d.minutes).trim() === '') ? null : Number(d.minutes), difficulty: d.difficulty,
      attemptKind: d.attemptKind, attemptNo: d.attemptNo, expected: String(d.expected).trim() === '' ? null : Number(d.expected), notes: (d.notes || '').trim(), correctiveAction: (d.correctiveAction || '').trim(),
      errorCounts: ec, createdAt: d.createdAt || now, updatedAt: now, removedAt: null };
    const sig = signature(a, rows), dup = list.find(x => x.id !== id && signature(x, rowsBy.get(x.id) || []) === sig);
    if (dup && !confirm('This looks like a duplicate of an existing entry (same name, date and numbers). Save anyway?')) return;
    await run(async () => { await db.saveAssessment(a, rows.map(r => ({ id: `${id}|${r.groupId}`, assessmentId: id, ...r }))); S.draft = null; toast('Saved'); }, 'save assessment');
  };
  const detail = (a, ov) => {
    const rows = rowsBy.get(a.id) || [], tpq = a.minutes != null && ov.T > 0 ? `${(a.minutes / ov.T).toFixed(1)} min per question` : null;
    const ec = Object.entries(a.errorCounts || {}).map(([k, n]) => `${(cats.find(c => c.id === k) || { name: '(removed category)' }).name}: ${n}`).join(' · ');
    return h('tr', { class: 'sub' }, h('td', { colspan: 12 },
      ...rows.map(r => { const st = rowStats(r); return h('div', {}, `${gname(r.groupId)}: ` + (r.mode === 'pct' ? `${fmt(st.score)} (n unknown, not in weighted overall)` : `${r.correct}/${r.total} · unanswered ${r.unanswered} · score ${fmt(st.score)} · accuracy ${fmt(st.accuracy)}`)); }),
      ec ? h('div', {}, 'Mistakes: ' + ec) : null, tpq ? h('div', {}, tpq) : null, a.notes ? h('div', {}, 'Notes: ' + a.notes) : null, a.correctiveAction ? h('div', {}, 'Corrective action: ' + a.correctiveAction) : null));
  };
  const draw = () => {
    root.replaceChildren();
    const typeSel = h('select', {}, h('option', { value: '' }, 'All types'), types.map(t => h('option', { value: t.id, selected: t.id === S.type }, t.name)));
    typeSel.addEventListener('change', () => { S.type = typeSel.value; draw(); });
    const attSel = h('select', {}, [['', 'First and repeat'], ['first', 'First attempts'], ['repeat', 'Repeat attempts']].map(([v, l]) => h('option', { value: v, selected: v === S.att }, l)));
    attSel.addEventListener('change', () => { S.att = attSel.value; draw(); });
    const shown = list.filter(a => a.subject === S.subj && (!S.type || a.typeId === S.type) && (!S.att || a.attemptKind === S.att))
      .sort((x, y) => (y.date + (y.time || '')).localeCompare(x.date + (x.time || '')) || y.createdAt.localeCompare(x.createdAt));
    root.append(h('div', { class: 'tabs' }, SUBJECTS.map(id => h('button', { class: id === S.subj ? 'on' : '', onclick: () => { S.subj = id; setSubj(id); S.draft = null; draw(); } }, id))),
      h('h1', {}, 'Assessments: ' + S.subj),
      h('div', { class: 'tool' }, h('button', { onclick: () => { S.draft = blank(); draw(); } }, '+ Log assessment'), typeSel, attSel, h('span', { class: 'mut' }, `${shown.length} shown`)));
    if (S.draft) root.append(form());
    if (!shown.length) { root.append(h('p', { class: 'mut' }, 'No assessments logged for this subject yet.')); return; }
    const tbl = h('table', {}, h('tr', {}, ['', 'Date', 'Name', 'Type', 'Attempt', 'Score', 'Accuracy', 'Unanswered', 'Minutes', 'Difficulty', 'Expected → actual', ''].map(x => h('th', {}, x))));
    for (const a of shown) {
      const ov = overall(rowsBy.get(a.id) || []), open = S.open.has(a.id);
      tbl.append(h('tr', {}, h('td', {}, h('button', { onclick: () => { open ? S.open.delete(a.id) : S.open.add(a.id); draw(); } }, open ? '▾' : '▸')), h('td', {}, a.date), h('td', {}, a.name), h('td', {}, tname(a.typeId)),
        h('td', {}, `${a.attemptKind === 'repeat' ? 'Repeat' : 'First'} #${a.attemptNo}`),
        h('td', { title: ov.nUnknown ? `${ov.nUnknown} percent-only row(s) not included in the weighted score` : '' }, ov.mode === 'weighted' ? `${fmt(ov.score)} (${ov.C}/${ov.T})${ov.nUnknown ? ' *' : ''}` : ov.mode === 'unweighted' ? `${fmt(ov.score)} (n unknown)` : '–'),
        h('td', {}, fmt(ov.accuracy)), h('td', {}, ov.mode === 'weighted' ? ov.U : '–'), h('td', {}, a.minutes ?? '–'), h('td', {}, a.difficulty || '–'),
        h('td', {}, a.expected != null ? `${a.expected}% → ${fmt(ov.score)}` : '–'),
        h('td', {}, h('button', { onclick: () => { S.draft = fromRec(a); draw(); scrollTo(0, 0); root.scrollTop = 0; } }, 'Edit'), ' ',
          h('button', { onclick: () => { if (confirm(`Remove "${a.name}"? You can restore it in Settings.`)) run(() => db.put('assessments', { ...a, removedAt: new Date().toISOString() }), 'remove assessment'); } }, '✕'))));
      if (open) tbl.append(detail(a, ov));
    }
    root.append(tbl, h('div', { class: 'mut', style: 'margin-top:6px' }, '* includes percent-only rows that are not part of the weighted score. Aggregate trends arrive with the analytics package.'));
  };
  await load(); draw();
}
