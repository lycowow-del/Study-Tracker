import { h, toast, report } from './ui.js';
import * as db from './db.js';
import { SUBJECTS, ACTIVITIES, normTool } from './model.js';
const ask = (m, d = '') => { const v = prompt(m, d); return v && v.trim() ? v.trim() : null; };

export async function toolsPage(root) {
  let tools, usage;
  const load = async () => { tools = await db.assessTypes(); usage = {}; for (const a of await db.all('assessments')) if (!a.removedAt) usage[a.typeId] = (usage[a.typeId] || 0) + 1; };
  const save = async list => { try { await db.put('settings', { key: 'assessTypes', value: list }); await load(); draw(); } catch (e) { report(e, 'study tools'); } };
  const upd = (id, patch) => save(tools.map(t => t.id === id ? { ...t, ...patch } : t));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= tools.length) return; const l = [...tools]; [l[i], l[j]] = [l[j], l[i]]; save(l); };
  const card = (t, i) => {
    const name = h('input', { type: 'text', value: t.name, 'aria-label': 'Tool name', style: 'min-width:220px' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) upd(t.id, { name: v }); else draw(); });
    const chk = (label, k) => { const c = h('input', { type: 'checkbox' }); c.checked = !!t[k]; c.addEventListener('change', () => upd(t.id, { [k]: c.checked })); return h('label', {}, c, ' ' + label); };
    const sel = (k, opts) => { const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === t[k] }, l))); s.addEventListener('change', () => upd(t.id, { [k]: s.value })); return s; };
    const purpose = h('input', { type: 'text', value: t.purpose, placeholder: 'Purpose: what this tool is for', style: 'width:100%', 'aria-label': 'Purpose' });
    purpose.addEventListener('change', () => upd(t.id, { purpose: purpose.value.trim() }));
    const subs = SUBJECTS.map(s => { const c = h('input', { type: 'checkbox' }); c.checked = t.subjects.includes(s); c.addEventListener('change', () => upd(t.id, { subjects: c.checked ? [...t.subjects, s] : t.subjects.filter(x => x !== s) })); return h('label', {}, c, ' ' + s + ' '); });
    const del = () => {
      if (tools.length <= 1) { toast('Keep at least one tool.', 'err'); return; }
      const n = usage[t.id] || 0;
      if (confirm(`Delete "${t.name}"?` + (n ? ` ${n} assessment(s) use it and will show it as "(removed type)". Disabling it instead keeps them tidy.` : ''))) save(tools.filter(x => x.id !== t.id));
    };
    return h('div', { class: 'panel', style: `margin-bottom:8px;${t.enabled ? '' : 'opacity:.65'}` },
      h('div', { class: 'tool', style: 'margin-top:0' }, name, chk('Enabled', 'enabled'), h('button', { onclick: () => move(i, -1), title: 'Move up' }, '▲'), h('button', { onclick: () => move(i, 1), title: 'Move down' }, '▼'), h('button', { onclick: del }, 'Delete')),
      purpose,
      h('div', { class: 'tool' }, 'Activity type:', sel('activity', ACTIVITIES.map(a => [a, a])), 'Entry:', sel('entry', [['both', 'Correct/total or percent'], ['count', 'Correct/total only'], ['pct', 'Percent only']]), chk('Counts toward mastery', 'countsTowardMastery'), chk('Track time', 'trackTime')),
      h('div', { class: 'tool' }, 'Subjects (none ticked = all):', ...subs),
      h('div', { class: 'mut' }, `Scoring engine: manual entry (fixed). Used in ${usage[t.id] || 0} assessment(s).`));
  };
  const draw = () => {
    root.replaceChildren(h('h1', {}, 'Study Tools'),
      h('div', { class: 'panel', style: 'margin-bottom:10px' }, h('div', { class: 'mut' },
        'A tool is a way you practice or test yourself. Renaming a tool or changing its activity type only changes labels and filters. It does not add auto-scoring, a question bank or a different assessment engine: every tool records results you enter by hand, as correct out of total or as a percent. Disabled tools are hidden when logging new assessments, and old entries keep them. Turning off "Counts toward mastery" keeps a tool\'s assessments in your history but leaves them out of mastery, trends and the dashboard.')),
      ...tools.map(card),
      h('button', { onclick: () => { const v = ask('New tool name'); if (v) save([...tools, normTool({ id: 't' + Date.now().toString(36), name: v })]); } }, '+ Add tool'));
  };
  try { await load(); draw(); } catch (e) { report(e, 'study tools'); }
}
