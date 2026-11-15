// Maestria de armas: habilidades (DT_SpecializedSkill -> GA) e chance em cada marco (DT_ZhuanJingSLD).
import { t, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum } from '../data.js';

const LS_KEY = 'mastery_weapon';

export async function initMasteryPage(root, params) {
  const tabs = root.querySelector('#mastery-tabs');
  const chances = root.querySelector('#mastery-chances');
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const grid = root.querySelector('#db-container');
  let data;
  try {
    data = await loadData('mastery');
  } catch (e) {
    grid.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const byIdx = new Map(data.skills.map((s) => [s.idx, s]));
  const weapons = data.weapons;
  let cur = params?.get('w');
  if (!weapons.some((w) => w.w === cur)) { try { cur = localStorage.getItem(LS_KEY); } catch (e) { cur = null; } }
  if (!weapons.some((w) => w.w === cur)) cur = weapons[0]?.w;
  if (params?.get('q')) search.value = params.get('q');

  function renderTabs() {
    tabs.innerHTML = weapons.map((w) => `<button type="button" class="guide-chip${w.w === cur ? ' is-active' : ''}" role="tab" aria-selected="${w.w === cur}" data-w="${esc(w.w)}">${esc(pick(w, 'name'))}</button>`).join('');
  }

  function skillCard(s, weight) {
    return `<article class="mastery-card">
      <header>
        ${s.icon ? `<img src="${esc(s.icon)}" alt="" loading="lazy" />` : '<span class="mastery-noicon"></span>'}
        <div>
          <h3>${esc(pick(s, 'name'))}</h3>
          <div class="mp-chips">
            <span>#${s.idx}</span>
            ${s.stamina ? `<span>${esc(t('mastery.stamina', { n: fmtNum(s.stamina, 0) }))}</span>` : ''}
            ${s.fixed ? `<span class="is-gold">${esc(t('mastery.fixed', { n: s.fixed }))}</span>` : ''}
          </div>
        </div>
      </header>
      ${pick(s, 'desc') ? `<p>${esc(pick(s, 'desc'))}</p>` : ''}
      ${weight ? `<div class="mastery-weights">${weight}</div>` : ''}
      <footer><code>gm AddZJ ${s.idx}</code><button type="button" class="map-btn map-btn-sm" data-copy="gm AddZJ ${s.idx}">${esc(t('cmd.copy'))}</button></footer>
    </article>`;
  }

  function render() {
    renderTabs();
    try { localStorage.setItem(LS_KEY, cur); } catch (e) { /* ignora */ }
    const w = weapons.find((x) => x.w === cur);
    chances.innerHTML = w ? `<table class="guide-table">
      <thead><tr><th>${esc(t('mastery.colLevel'))}</th><th>${esc(t('mastery.colChance'))}</th><th>${esc(t('mastery.colPool'))}</th></tr></thead>
      <tbody>${w.levels.map((l) => `<tr><td><strong>${l.lv}</strong></td><td>${esc(fmtNum(l.chance, 0))}%</td>
        <td class="mastery-pool">${l.pool.map(([i, p]) => `<span title="${esc(t('mastery.poolTitle', { p: fmtNum((p * l.chance) / 100, 1) }))}">${esc(pick(byIdx.get(i), 'name') || `#${i}`)} <b>${esc(fmtNum(p, 1))}%</b></span>`).join('')}</td></tr>`).join('')}</tbody>
    </table><p class="comfort-howto">${esc(t('mastery.poolHint'))}</p>` : '';
    const q = normalize(search.value);
    const inPool = new Map();
    (w?.levels || []).forEach((l) => l.pool.forEach(([i, p]) => { if (!inPool.has(i)) inPool.set(i, []); inPool.get(i).push([l.lv, p]); }));
    const list = data.skills.filter((s) => (q ? normalize(`${s.name_pt} ${s.name_en} ${s.desc_pt || ''} ${s.desc_en || ''} ${s.idx}`).includes(q) : s.w === cur));
    count.textContent = t('mastery.count', { n: list.length });
    grid.innerHTML = list.map((s) => {
      const wl = inPool.get(s.idx);
      return skillCard(s, wl ? wl.map(([lv, p]) => `<span>${esc(t('mastery.atLevel', { n: lv }))}: <b>${esc(fmtNum(p, 1))}%</b></span>`).join('') : '');
    }).join('') || `<div class="items-no-results">${esc(t('site.noResults'))}</div>`;
  }

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    cur = b.dataset.w;
    search.value = '';
    render();
  });
  search.addEventListener('input', render);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch (err) { /* ignora */ }
    b.textContent = t('map.copied');
    setTimeout(() => { if (b.isConnected) b.textContent = t('cmd.copy'); }, 1400);
  });
  render();
}
