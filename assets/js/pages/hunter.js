// Ranks de caçador: títulos de caça (requisitos e bônus), os 60 níveis de caça e dicas tiradas dos dados.
// Dados: assets/data/hunter.json (tools/build_journey.py: DT_ShouLieNodeTable, DT_ShouLieLevelTable e os animais
//        da enciclopédia BT_DongWuTuJian) + achievements.json (conquistas pedidas por cada título)
//      + creatures.json (nome e foto dos animais).
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, fmtNum, ingredientChip, openItemModal } from '../data.js';

const LS_KEY = 'hunter_calc_v1';
const pct = (v) => `${fmtNum(v * 100, v * 100 % 1 ? 1 : 0)}%`;

export async function initHunterPage(root) {
  const ranksEl = root.querySelector('#hunt-ranks');
  const calcEl = root.querySelector('#hunt-calc');
  const tableEl = root.querySelector('#hunt-levels');
  const tipsEl = root.querySelector('#hunt-tips');
  let data;
  let ach;
  let creatures;
  let items;
  try {
    [data, ach, creatures, items] = await Promise.all([loadData('hunter'), loadData('achievements'), loadIndex('creatures'), loadIndex('items')]);
  } catch (e) {
    ranksEl.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const achById = new Map(ach.list.map((a) => [a.id, a]));
  const levels = data.levels;
  const maxLv = levels.length;
  // EXP total para chegar ao nível n (nível 1 = 0)
  const cum = [0];
  levels.forEach((l, i) => { cum[i + 1] = cum[i] + l.exp; });
  // bônus somados até o nível n (cada nível dá o seu)
  const bonusAt = (n) => levels.slice(0, n).reduce((s, l) => ({ speed: s.speed + l.speed, out: s.out + l.out, tool: s.tool + l.tool, stamina: s.stamina + l.stamina }), { speed: 0, out: 0, tool: 0, stamina: 0 });

  // ---------------------------------------------------------------- títulos
  ranksEl.innerHTML = data.ranks.map((r) => {
    const reqs = [
      `<li>${esc(t('hunt.reqLevel', { n: r.level }))}</li>`,
      `<li>${esc(t('hunt.reqBestiary', { n: r.bestiary }))} <a href="#criaturas">${esc(t('hunt.bestiaryLink'))}</a></li>`,
      ...r.achievements.map((id) => {
        const a = achById.get(id);
        if (!a) return '';
        return `<li>${esc(t('hunt.reqAch'))} <a href="#conquistas?q=${encodeURIComponent(pick(a, 'name'))}">${esc(pick(a, 'name'))}</a>: ${esc(pick(a, 'how'))}</li>`;
      })
    ].join('');
    const eff = r.effects.map((e) => `<li>${esc(pick(e, 'text'))}</li>`).join('');
    return `<article class="hunt-rank">
      <div class="hunt-rank-head">
        ${r.icon ? `<img class="hunt-rank-icon" src="${esc(r.icon)}" alt="" loading="lazy" width="72" height="72" />` : ''}
        <div><span class="hunt-rank-n">${esc(t('hunt.rankN', { n: r.n }))}</span><h3>${esc(pick(r, 'name'))}</h3></div>
      </div>
      <h4>${esc(t('hunt.needs'))}</h4><ul class="hunt-list">${reqs}</ul>
      <h4>${esc(t('hunt.gives'))}</h4><ul class="hunt-list hunt-gives">${eff}</ul>
    </article>`;
  }).join('');

  // ---------------------------------------------------------------- calculadora de níveis
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { saved = {}; }
  let from = Math.min(maxLv, Math.max(0, Number(saved.from) || 0));
  let to = Math.min(maxLv, Math.max(from, Number(saved.to) || 30));
  calcEl.innerHTML = `
    <div class="hunt-calc-inputs">
      <label>${esc(t('hunt.from'))} <input type="number" id="hunt-from" class="items-search-input" min="0" max="${maxLv}" value="${from}" /></label>
      <label>${esc(t('hunt.to'))} <input type="number" id="hunt-to" class="items-search-input" min="1" max="${maxLv}" value="${to}" /></label>
    </div>
    <div id="hunt-calc-out" class="hunt-calc-out" aria-live="polite"></div>`;
  const outEl = calcEl.querySelector('#hunt-calc-out');
  function renderCalc() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ from, to })); } catch (e) { /* ignora */ }
    const need = cum[to] - cum[from];
    const b = bonusAt(to);
    const rank = [...data.ranks].reverse().find((r) => to >= r.level);
    outEl.innerHTML = `
      <div class="hunt-stat"><strong>${esc(fmtNum(Math.max(0, need), 0))}</strong><span>${esc(t('hunt.expNeeded', { a: from, b: to }))}</span></div>
      <div class="hunt-stat"><strong>+${esc(pct(b.speed))}</strong><span>${esc(t('hunt.bSpeed'))}</span></div>
      <div class="hunt-stat"><strong>+${esc(pct(b.out))}</strong><span>${esc(t('hunt.bOut'))}</span></div>
      <div class="hunt-stat"><strong>−${esc(pct(b.tool))}</strong><span>${esc(t('hunt.bTool'))}</span></div>
      <div class="hunt-stat"><strong>−${esc(pct(b.stamina))}</strong><span>${esc(t('hunt.bStamina'))}</span></div>
      <p class="ev-legend">${rank ? esc(t('hunt.rankAt', { lv: to, name: pick(rank, 'name') })) : esc(t('hunt.noRankAt', { lv: to }))}</p>`;
  }
  calcEl.addEventListener('input', (e) => {
    const v = Math.min(maxLv, Math.max(0, Number(e.target.value) || 0));
    if (e.target.id === 'hunt-from') from = v;
    if (e.target.id === 'hunt-to') to = v;
    if (to < from) [from, to] = [to, from];
    renderCalc();
  });
  renderCalc();

  // ---------------------------------------------------------------- tabela de níveis (recolhida)
  const rankAt = new Map(data.ranks.map((r) => [r.level, r]));
  tableEl.innerHTML = `<details class="hunt-table-wrap"><summary>${esc(t('hunt.tableShow', { n: maxLv }))}</summary>
    <div class="guide-table-wrap"><table class="guide-table hunt-table">
      <thead><tr><th>${esc(t('hunt.colLv'))}</th><th>${esc(t('hunt.colExp'))}</th><th>${esc(t('hunt.colTotal'))}</th><th>${esc(t('hunt.colBonus'))}</th><th>${esc(t('hunt.colRank'))}</th></tr></thead>
      <tbody>${levels.map((l, i) => {
        const b = bonusAt(i + 1);
        const r = rankAt.get(l.lv);
        return `<tr${r ? ' class="is-rank"' : ''}><td>${l.lv}</td><td>${esc(fmtNum(l.exp, 0))}</td><td>${esc(fmtNum(cum[i + 1], 0))}</td><td>+${esc(pct(b.speed))} / +${esc(pct(b.out))} / −${esc(pct(b.tool))} / −${esc(pct(b.stamina))}</td><td>${r ? esc(pick(r, 'name')) : ''}</td></tr>`;
      }).join('')}</tbody>
    </table></div><p class="ev-legend">${esc(t('hunt.tableNote'))}</p></details>`;

  // ---------------------------------------------------------------- dicas
  const beasts = data.beasts.map((b) => ({ ...b, c: creatures.get(b.id) })).filter((b) => b.c && b.exp);
  const top = [...beasts].sort((a, b) => b.exp - a.exp).slice(0, 12);
  const g = data.beasts.find((b) => b.grades)?.grades || [];
  const bonus = data.beasts.find((b) => b.bonus)?.bonus || [];
  const sameGrades = data.beasts.every((b) => JSON.stringify(b.grades) === JSON.stringify(g));
  const quick = data.beasts.find((b) => b.quick)?.quick || [];
  const intact = data.beasts.find((b) => b.intact)?.intact || [];
  const chips = (ids) => ids.filter((id) => items.has(id)).map((id) => ingredientChip(items, id)).join('');
  tipsEl.innerHTML = `
    <article class="hunt-tip">
      <h3>${esc(t('hunt.tipMaskTitle'))}</h3>
      <p>${esc(t('hunt.tipMask'))} <a href="#mascaras?id=DaoJu_Mask_06">${esc(t('hunt.tipMaskLink'))}</a></p>
    </article>
    <article class="hunt-tip">
      <h3>${esc(t('hunt.tipBestiaryTitle'))}</h3>
      <p>${esc(t('hunt.tipBestiary', { n: data.beasts.length, max: Math.max(...data.ranks.map((r) => r.bestiary)) }))} <a href="#criaturas">${esc(t('hunt.bestiaryLink'))}</a></p>
    </article>
    ${g.length ? `<article class="hunt-tip">
      <h3>${esc(t('hunt.tipScoreTitle'))}</h3>
      <p>${esc(t('hunt.tipScore'))}</p>
      <div class="guide-table-wrap"><table class="guide-table hunt-grade"><thead><tr><th>${esc(t('hunt.colScore'))}</th>${g.map((x) => `<th>${esc(fmtNum(x, 0))}+</th>`).join('')}</tr></thead>
      <tbody><tr><td>${esc(t('hunt.colScoreBonus'))}</td>${bonus.map((x) => `<td>+${esc(pct(x))}</td>`).join('')}</tr></tbody></table></div>
      <p class="ev-legend">${esc(t(sameGrades ? 'hunt.tipScoreSame' : 'hunt.tipScoreDiff'))} ${esc(t('hunt.tipScoreUnclear'))}</p>
    </article>` : ''}
    ${quick.length || intact.length ? `<article class="hunt-tip">
      <h3>${esc(t('hunt.tipKillTitle'))}</h3>
      <p>${esc(t('hunt.tipKill'))}</p>
      ${quick.length ? `<p class="hunt-tip-row"><span class="ach-label">${esc(t('hunt.quick'))}</span><span class="ach-chips">${chips(quick)}</span></p>` : ''}
      ${intact.length ? `<p class="hunt-tip-row"><span class="ach-label">${esc(t('hunt.intact'))}</span><span class="ach-chips">${chips(intact)}</span></p>` : ''}
    </article>` : ''}
    <article class="hunt-tip hunt-tip-wide">
      <h3>${esc(t('hunt.tipExpTitle'))}</h3>
      <p>${esc(t('hunt.tipExp'))}</p>
      <ol class="hunt-top">${top.map((b) => `<li><a href="#criaturas?q=${encodeURIComponent(pick(b.c, 'name'))}">${b.c.photo ? `<img src="${esc(b.c.photo)}" alt="" loading="lazy" width="40" height="40" />` : ''}<span>${esc(pick(b.c, 'name'))}</span></a><strong>${esc(t('hunt.expN', { n: fmtNum(b.exp, 0) }))}</strong></li>`).join('')}</ol>
      <p class="ev-legend">${esc(t('hunt.tipExpNote'))}</p>
    </article>`;
  tipsEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (link) { e.preventDefault(); openItemModal(link.dataset.itemLink); }
  });
  void tCount;
}
