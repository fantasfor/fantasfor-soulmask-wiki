// Proficiência: EXP por nível, bônus contínuo (soma por nível), bônus de marco (30/60/90/120) e bônus das profissões.
// Dados: assets/data/proficiency.json (DT_ProficiencyConfig_* lidos por tools/build_guides.py).
import { t, pick } from '../i18n.js';
import { loadData, esc, fmtNum } from '../data.js';

const GROUPS = ['weapon', 'gather', 'process', 'craft'];
const LS_KEY = 'prof_calc_v1';

const perAt = (b, i) => (Array.isArray(b.per) ? b.per[i] || 0 : b.per);
const pct = (v) => `${fmtNum(v * 100, v * 100 < 10 ? 1 : 0)}%`;

export async function initProficiencyPage(root) {
  const typeSel = root.querySelector('#prof-type');
  const fromEl = root.querySelector('#prof-from');
  const lvEl = root.querySelector('#prof-level');
  const lvOut = root.querySelector('#prof-level-out');
  const result = root.querySelector('#prof-result');
  const milesEl = root.querySelector('#prof-milestones');
  const expEl = root.querySelector('#prof-exp');
  const classesEl = root.querySelector('#prof-classes');
  let data;
  try {
    data = await loadData('proficiency');
  } catch (e) {
    result.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const byId = new Map(data.types.map((x) => [x.id, x]));
  typeSel.innerHTML = GROUPS.map((g) => {
    const list = data.types.filter((x) => x.group === g).sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')));
    return list.length ? `<optgroup label="${esc(t(`prof.group.${g}`))}">${list.map((x) => `<option value="${esc(x.id)}">${esc(pick(x, 'name'))}</option>`).join('')}</optgroup>` : '';
  }).join('');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { saved = {}; }
  if (byId.has(saved.type)) typeSel.value = saved.type;
  if (saved.to) lvEl.value = saved.to;
  if (saved.from !== undefined) fromEl.value = saved.from;

  function render() {
    const p = byId.get(typeSel.value) || data.types[0];
    const max = p.exp.length;
    lvEl.max = max;
    const to = Math.max(1, Math.min(max, Number(lvEl.value) || 1));
    const from = Math.max(0, Math.min(to - 1, Number(fromEl.value) || 0));
    lvOut.textContent = to;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ type: p.id, to, from })); } catch (e) { /* ignora */ }

    const expNeed = p.exp.slice(from, to).reduce((a, b) => a + b, 0);
    const expAll = p.exp.slice(0, to).reduce((a, b) => a + b, 0);
    const next = to < max ? p.exp[to] : 0;
    const rows = p.benefits.map((b) => {
      let cont = 0;
      for (let i = 0; i < to; i += 1) cont += perAt(b, i);
      const mile = p.milestones.filter((m) => m.lv <= to).reduce((s, m) => s + m.items.filter((it) => it.key === b.key).reduce((a, it) => a + it.val, 0), 0);
      return { b, cont, mile, total: cont + mile };
    }).filter((r) => r.total > 0 || r.b.key);
    const quality = p.quality ? p.quality.slice(0, to).reduce((acc, q) => { (q || []).forEach((v, i) => { acc[i] = (acc[i] || 0) + v; }); return acc; }, []) : null;
    result.innerHTML = `
      <div class="prof-summary">
        <div class="prof-big"><strong>${esc(fmtNum(expNeed, 0))}</strong><span>${esc(t('prof.expNeeded', { a: from, b: to }))}</span></div>
        <div class="prof-big"><strong>${esc(fmtNum(expAll, 0))}</strong><span>${esc(t('prof.expTotal', { b: to }))}</span></div>
        <div class="prof-big"><strong>${next ? esc(fmtNum(next, 0)) : '-'}</strong><span>${esc(t('prof.expNext', { b: to + 1 }))}</span></div>
      </div>
      ${pick(p, 'gain') ? `<p class="prof-gain">${esc(pick(p, 'gain'))}</p>` : ''}
      <table class="guide-table">
        <thead><tr><th>${esc(t('prof.colBonus'))}</th><th>${esc(t('prof.colCont'))}</th><th>${esc(t('prof.colMile'))}</th><th>${esc(t('prof.colTotal'))}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(pick(r.b, 'name') || r.b.key)}</td><td>${r.b.pct ? pct(r.cont) : fmtNum(r.cont, 1)}</td><td>${r.mile ? (r.b.pct ? pct(r.mile) : fmtNum(r.mile, 1)) : '-'}</td><td><strong>${r.b.pct ? pct(r.total) : fmtNum(r.total, 1)}</strong></td></tr>`).join('')}</tbody>
      </table>
      ${quality && quality.some((v) => v > 0) ? `<p class="prof-quality"><strong>${esc(t('prof.quality'))}</strong> ${quality.map((v, i) => `<span>${esc(t('prof.qualityTier', { n: i + 1 }))} +${esc(pct(v))}</span>`).join('')}</p>` : ''}
      <p class="prof-gm">${esc(t('prof.gmTip'))} <code>gm SLDDengJi ${p.enum} ${to}</code> <button type="button" class="map-btn map-btn-sm" data-copy="gm SLDDengJi ${p.enum} ${to}">${esc(t('cmd.copy'))}</button></p>`;

    milesEl.innerHTML = p.milestones.length ? p.milestones.map((m) => `
      <article class="prof-mile${m.lv <= to ? ' is-on' : ''}">
        <header><span class="comfort-level-n">${m.lv}</span><strong>${esc(t('prof.mileAt', { n: m.lv }))}</strong></header>
        <ul>${m.items.map((it) => `<li>${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" />` : ''}<span>${esc(pick(it, 'text') || it.key)}</span></li>`).join('')}</ul>
      </article>`).join('') : `<p class="comfort-howto">${esc(t('prof.noMiles'))}</p>`;

    const marks = [];
    for (let l = 10; l <= max; l += 10) marks.push(l);
    let acc = 0; const cum = p.exp.map((e) => (acc += e));
    expEl.innerHTML = `<table class="guide-table guide-table-compact">
      <thead><tr><th>${esc(t('common.level'))}</th>${marks.map((l) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><th>${esc(t('prof.expLevel'))}</th>${marks.map((l) => `<td>${esc(fmtNum(p.exp[l - 1], 0))}</td>`).join('')}</tr>
        <tr><th>${esc(t('prof.expSum'))}</th>${marks.map((l) => `<td>${esc(fmtNum(cum[l - 1], 0))}</td>`).join('')}</tr>
      </tbody></table>`;
  }

  classesEl.innerHTML = data.classes.map((c) => `
    <article class="guide-card">
      <h3>${esc(pick(c, 'name'))}</h3>
      <ul>${c.profs.map((x) => {
    const p = byId.get(x.type) || byId.get({ DunPai: 'DunPai' }[x.type]);
    return `<li><span>${esc(p ? pick(p, 'name') : x.type)}</span><strong>+${x.min} ~ +${x.max}</strong></li>`;
  }).join('')}</ul>
    </article>`).join('');

  [typeSel, fromEl, lvEl].forEach((el) => el.addEventListener('input', render));
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch (err) { /* ignora */ }
    b.textContent = t('map.copied');
    setTimeout(() => { if (b.isConnected) b.textContent = t('cmd.copy'); }, 1400);
  });
  render();
}
