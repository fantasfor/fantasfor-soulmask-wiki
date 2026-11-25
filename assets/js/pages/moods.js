// Humor dos NPCs (tribais): faixas de humor, efeito de cada uma por profissão e o que sobe ou desce o humor.
// Dados: assets/data/moods.json (tools/build_journey.py: BP_ZiYuanGuanLiQi.XinQingConfData / XinQingAffectConfMap,
//        GE_XiWu_<profissão>_<humor>, DT_XinQingTagTable, DT_XinQingGongHuiLvTable e GongHuiLevelFit das comidas)
//      + proficiency.json (nomes das profissões) + items.json / meta.json (comidas e nomes de atributos).
import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, fmtNum, attrName, ingredientChip, openItemModal } from '../data.js';

// profissão no humor (ZHIYE_TYPE_*) -> id em proficiency.json
const PROF = { wuwei: 'WuWeiZhe', shoulie: 'ShouLieZhe', shouhu: 'ShouHuZhe', kuli: 'KuLi', zagong: 'ZaGong', zongjiang: 'ZongJiang' };
const TONE = { FEICHANGJUSANG: 'bad2', JUSANG: 'bad', YIBAN: 'mid', YUKUAI: 'good', XingFen: 'good2' };
const pct = (v) => `${fmtNum(v * 100, 0)}%`;

export async function initMoodsPage(root) {
  const stagesEl = root.querySelector('#mood-stages');
  const classEl = root.querySelector('#mood-classes');
  const upEl = root.querySelector('#mood-up');
  const tribeEl = root.querySelector('#mood-tribe');
  const foodEl = root.querySelector('#mood-food');
  let data;
  let prof;
  let items;
  let meta = {};
  try {
    [data, prof, items, meta] = await Promise.all([loadData('moods'), loadData('proficiency'), loadIndex('items'), loadData('meta').catch(() => ({}))]);
  } catch (e) {
    stagesEl.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const className = (k) => pick((prof.classes || []).find((c) => c.id === PROF[k]), 'name') || k;
  const stateName = (s) => pick(s, 'name') || t(`mood.state.${s.id}`);
  const range = (s) => `${pct(s.lo)} – ${pct(s.hi)}`;
  const modTxt = (m) => {
    const d = m.op === 'Multiplicitive' ? (m.v - 1) * 100 : m.v;
    const sign = d > 0 ? '+' : '−';
    return `${attrName(meta, m.a)} ${sign}${fmtNum(Math.abs(d), Math.abs(d) % 1 ? 1 : 0)}${m.op === 'Multiplicitive' ? '%' : ''}`;
  };

  // ---------------------------------------------------------------- faixas
  stagesEl.innerHTML = data.states.map((s) => `<article class="mood-stage tone-${TONE[s.id] || 'mid'}">
      ${s.icon ? `<img src="${esc(s.icon)}" alt="" width="56" height="56" loading="lazy" />` : ''}
      <h3>${esc(stateName(s))}</h3>
      <span class="mood-range">${esc(range(s))}</span>
      <p>${esc(t(s.effects ? (s.lo >= 0.5 ? 'mood.stageGood' : 'mood.stageBad') : 'mood.stageNone'))}</p>
    </article>`).join('');

  // ---------------------------------------------------------------- efeito por profissão
  const keys = Object.keys(PROF).filter((k) => data.states.some((s) => s.effects?.[k]));
  classEl.innerHTML = `<div class="guide-table-wrap"><table class="guide-table mood-table">
    <thead><tr><th>${esc(t('mood.colClass'))}</th>${data.states.map((s) => `<th class="tone-${TONE[s.id] || 'mid'}">${s.icon ? `<img src="${esc(s.icon)}" alt="" width="22" height="22" />` : ''}${esc(stateName(s))}<small>${esc(range(s))}</small></th>`).join('')}</tr></thead>
    <tbody>${keys.map((k) => `<tr><th scope="row">${esc(className(k))}</th>${data.states.map((s) => {
      const e = s.effects?.[k];
      if (!e) return `<td class="mood-none">${esc(t('mood.noEffect'))}</td>`;
      return `<td class="tone-${TONE[s.id] || 'mid'}" title="${esc(pick(e, 'desc'))}">${e.mods.map((m) => `<div>${esc(modTxt(m))}</div>`).join('')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="ev-legend">${esc(t('mood.classNote'))}</p>`;

  // ---------------------------------------------------------------- o que sobe / desce
  const clean = (s) => String(s || '').replace(/^\s*[（(][^)）]*\{0\}[)）]\s*/, '').replace(/\s*-\s*\{1\}.*$/, '').trim();
  const row = (x) => `<li><span>${esc(clean(pick(x, 'text')))}</span>${x.dur ? `<small>${esc(t('mood.lasts', { n: fmtNum(x.dur / 60, 0) }))}</small>` : ''}</li>`;
  const ups = data.tags.filter((x) => x.up);
  const downs = data.tags.filter((x) => !x.up);
  upEl.innerHTML = `<div class="mood-cols">
      <div class="mood-col mood-col-up"><h3>${esc(t('mood.raises'))}</h3><ul>${ups.map(row).join('')}</ul></div>
      <div class="mood-col mood-col-down"><h3>${esc(t('mood.lowers'))}</h3><ul>${downs.map(row).join('')}</ul></div>
    </div>
    <p class="ev-legend">${esc(t('mood.tagsNote'))}</p>`;

  // ---------------------------------------------------------------- nível da tribo: equipamento e conforto
  tribeEl.innerHTML = `<div class="guide-table-wrap"><table class="guide-table">
    <thead><tr><th>${esc(t('mood.colTribe'))}</th><th>${esc(t('mood.colGear'))}</th><th>${esc(t('mood.colComfort'))}</th></tr></thead>
    <tbody>${data.tribe.map((r) => `<tr><td>${r.lv}</td><td>${esc(t(`mood.gear.${r.gear}`))}</td><td>${r.comfort ? `${esc(fmtNum(r.comfort, 0))}+` : '—'}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="ev-legend">${esc(t('mood.tribeNote'))} <a href="#conforto">${esc(t('mood.comfortLink'))}</a></p>`;

  // ---------------------------------------------------------------- comidas por nível da tribo
  const byLv = {};
  Object.entries(data.foodLv || {}).forEach(([id, lv]) => { if (items.has(id)) (byLv[lv] = byLv[lv] || []).push(id); });
  foodEl.innerHTML = Object.keys(byLv).sort((a, b) => a - b).map((lv) => `<div class="mood-food-row">
      <span class="ach-label">${esc(t('mood.foodLv', { n: lv }))}</span>
      <div class="ach-chips">${byLv[lv].sort((a, b) => pick(items.get(a), 'name').localeCompare(pick(items.get(b), 'name'))).map((id) => ingredientChip(items, id)).join('')}</div>
    </div>`).join('') + `<p class="ev-legend">${esc(t('mood.foodNote'))}</p>`;
  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (link) { e.preventDefault(); openItemModal(link.dataset.itemLink); }
  });
}
