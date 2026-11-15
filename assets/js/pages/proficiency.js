// Proficiência: EXP por nível, bônus contínuo (soma por nível), bônus de marco (30/60/90/120), qualidade de fabricação,
// bônus das profissões e talentos que ajudam cada proficiência.
// Dados: assets/data/proficiency.json (DT_ProficiencyConfig_* e DT_GiftZongBiao lidos por tools/build_guides.py).
// Qualidade de fabricação (por material) = soma por nível (TeShuProfBenefitVal) + marcos (TeShuProBenefitVal)
//                                         + bônus geral de qualidade (ProfBenefitVal dos níveis 130/140/150).
import { t, pick } from '../i18n.js';
import { loadData, esc, fmtNum } from '../data.js';

const GROUPS = ['weapon', 'gather', 'process', 'craft'];
const LS_KEY = 'prof_calc_v1';
const ALIAS = { Dun: 'DunPai', BaoMu: 'PaoMu' };

const perAt = (b, i) => (Array.isArray(b.per) ? b.per[i] || 0 : b.per);
const pct = (v) => `${fmtNum(v * 100, Math.abs(v * 100) < 10 && v * 100 % 1 ? 1 : 0)}%`;

// "a cada N níveis" quando o bônus só entra em alguns níveis
function stepInfo(b) {
  if (!Array.isArray(b.per)) return null;
  const lv = b.per.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
  if (!lv.length || lv.length === b.per.length) return null;
  const vals = new Set(lv.map((l) => b.per[l - 1]));
  const diffs = new Set(lv.slice(1).map((l, i) => l - lv[i]));
  return { first: lv[0], last: lv[lv.length - 1], every: diffs.size === 1 ? [...diffs][0] : 0, val: vals.size === 1 ? [...vals][0] : 0, count: lv.length };
}

export async function initProficiencyPage(root) {
  const typeSel = root.querySelector('#prof-type');
  const fromEl = root.querySelector('#prof-from');
  const lvEl = root.querySelector('#prof-level');
  const lvOut = root.querySelector('#prof-level-out');
  const result = root.querySelector('#prof-result');
  const milesEl = root.querySelector('#prof-milestones');
  const talentsEl = root.querySelector('#prof-talents');
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

  // qualidade por material até o nível "to": [{ label, lv, mile, gen, total }]
  function qualityRows(p, to) {
    if (!p.quality) return [];
    const qb = p.benefits.find((b) => b.quality);
    let gen = 0;
    if (qb) for (let i = 0; i < to; i += 1) gen += perAt(qb, i);
    const n = Math.max(...p.quality.map((q) => (q || []).length));
    const rows = [];
    for (let k = 0; k < n; k += 1) {
      let lv = 0;
      for (let i = 0; i < to; i += 1) lv += (p.quality[i] || [])[k] || 0;
      const mile = p.milestones.filter((m) => m.lv <= to).reduce((s, m) => s + m.items.reduce((a, it) => a + ((it.tq || [])[k] || 0), 0), 0);
      const lab = p.qualityTiers?.[k];
      rows.push({ label: lab ? pick(lab, 'text') || lab.pt : t('prof.qualityTier', { n: k + 1 }), lv, mile, gen, total: lv + mile + gen });
    }
    // materiais com o mesmo texto (ex.: madeira/pedra e osso) viram uma linha só, com a faixa "a–b" quando diferem
    const merged = [];
    rows.forEach((r) => {
      const m = merged.find((o) => o.label === r.label);
      if (!m) { merged.push({ label: r.label, list: [r] }); return; }
      m.list.push(r);
    });
    return merged.map(({ label, list }) => {
      const span = (k) => { const v = list.map((r) => r[k]); return [Math.min(...v), Math.max(...v)]; };
      return { label, lv: span('lv'), mile: span('mile'), gen: span('gen'), total: span('total') };
    });
  }
  const pctSpan = ([a, b], plus = '') => (Math.abs(a - b) < 1e-6 ? `${plus}${pct(a)}` : `${plus}${pct(a)} – ${pct(b)}`);

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
    const rows = p.benefits.filter((b) => !b.quality).map((b) => {
      let cont = 0;
      for (let i = 0; i < to; i += 1) cont += perAt(b, i);
      const mile = p.milestones.filter((m) => m.lv <= to).reduce((s, m) => s + m.items.filter((it) => it.key === b.key && !it.tq).reduce((a, it) => a + it.val, 0), 0);
      return { b, cont, mile, total: cont + mile };
    });
    const qrows = qualityRows(p, to);
    const val = (b, v) => (b.pct ? pct(v) : fmtNum(v, 1));
    result.innerHTML = `
      <div class="prof-summary">
        <div class="prof-big"><strong>${esc(fmtNum(expNeed, 0))}</strong><span>${esc(t('prof.expNeeded', { a: from, b: to }))}</span></div>
        <div class="prof-big"><strong>${esc(fmtNum(expAll, 0))}</strong><span>${esc(t('prof.expTotal', { b: to }))}</span></div>
        <div class="prof-big"><strong>${next ? esc(fmtNum(next, 0)) : '-'}</strong><span>${esc(t('prof.expNext', { b: to + 1 }))}</span></div>
      </div>
      ${pick(p, 'gain') ? `<p class="prof-gain">${esc(pick(p, 'gain'))}</p>` : ''}
      <div class="guide-table-wrap"><table class="guide-table">
        <thead><tr><th>${esc(t('prof.colBonus'))}</th><th>${esc(t('prof.colCont'))}</th><th>${esc(t('prof.colMile'))}</th><th>${esc(t('prof.colTotal'))}</th></tr></thead>
        <tbody>${rows.map((r) => {
          const st = stepInfo(r.b);
          const note = st && st.every ? `<small class="prof-step">${esc(t('prof.stepEvery', { v: val(r.b, st.val), n: st.every, a: st.first }))}</small>` : '';
          return `<tr><td>${esc(pick(r.b, 'name') || r.b.key)}${note}</td><td>${val(r.b, r.cont)}</td><td>${r.mile ? val(r.b, r.mile) : '-'}</td><td><strong>${val(r.b, r.total)}</strong></td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${qrows.length ? `<h3 class="prof-sub">${esc(t('prof.quality'))}</h3>
      <div class="guide-table-wrap"><table class="guide-table prof-quality-table">
        <thead><tr><th>${esc(t('prof.qualityMat'))}</th><th>${esc(t('prof.colCont'))}</th><th>${esc(t('prof.colMile'))}</th><th>${esc(t('prof.qualityAll'))}</th><th>${esc(t('prof.colTotal'))}</th></tr></thead>
        <tbody>${qrows.map((r) => `<tr><td>${esc(r.label)}</td><td>${pctSpan(r.lv)}</td><td>${r.mile[1] ? pctSpan(r.mile) : '-'}</td><td>${r.gen[1] ? pctSpan(r.gen) : '-'}</td><td><strong>${pctSpan(r.total, '+')}</strong></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="comfort-howto">${esc(t('prof.qualityHint'))}</p>` : ''}
      <p class="prof-gm">${esc(t('prof.gmTip'))} <code>gm SLDDengJi ${p.enum} ${to}</code> <button type="button" class="map-btn map-btn-sm" data-copy="gm SLDDengJi ${p.enum} ${to}">${esc(t('cmd.copy'))}</button></p>`;

    const stepped = p.benefits.map((b) => ({ b, st: stepInfo(b) })).filter((x) => x.st && x.st.every && !x.b.quality);
    milesEl.innerHTML = (p.milestones.length ? p.milestones.map((m) => `
      <article class="prof-mile${m.lv <= to ? ' is-on' : ''}">
        <header><span class="comfort-level-n">${m.lv}</span><strong>${esc(t('prof.mileAt', { n: m.lv }))}</strong></header>
        <ul>${m.items.map((it) => `<li>${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" />` : ''}<span>${esc(pick(it, 'text') || it.key)}</span></li>`).join('')}</ul>
      </article>`).join('') : `<p class="comfort-howto">${esc(t('prof.noMiles'))}</p>`)
      + (stepped.length ? `
      <article class="prof-mile prof-mile-steps">
        <header><span class="comfort-level-n">+</span><strong>${esc(t('prof.stepsTitle'))}</strong></header>
        <ul>${stepped.map(({ b, st }) => `<li><span>${esc(pick(b, 'name') || b.key)}: ${esc(t('prof.stepEvery', { v: val(b, st.val), n: st.every, a: st.first }))}</span></li>`).join('')}</ul>
      </article>` : '');

    const tal = p.talents || [];
    const kindLabel = (k) => t(`prof.talentKind.${k}`);
    const tvals = (x) => (x.vals ? ` <small>${esc(x.vals.map((v) => `${v > 0 ? '+' : ''}${fmtNum(v * 100, 0)}%`).join(' / '))}</small>` : '');
    talentsEl.innerHTML = tal.length ? `<div class="prof-talents">${tal.map((x) => `
      <a class="prof-talent prof-talent-${esc(x.kind)}" href="#talentos?q=${encodeURIComponent(x.id)}" title="${esc(t('prof.talentOpen'))}">
        ${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy" width="40" height="40" />` : '<span class="prof-talent-noicon"></span>'}
        <span><strong>${esc(pick(x, 'name'))}</strong><small>${esc(kindLabel(x.kind))}${x.vals ? ':' : ''}</small>${tvals(x)}</span>
      </a>`).join('')}</div>` : `<p class="comfort-howto">${esc(t('prof.noTalents'))}</p>`;

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
    const p = byId.get(x.type) || byId.get(ALIAS[x.type]);
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
