import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum, statList, iconImg, qualityClass, L, renderChunked, openItemModal } from '../data.js';

export async function initWeaponsPage(root, params) {
  const search = root.querySelector('#db-search');
  const typeSel = root.querySelector('#db-filter');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let weapons = [];
  let meta = {};
  try {
    [weapons, meta] = await Promise.all([loadData('weapons'), loadData('meta')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  Object.entries(meta.weaponTypes || {}).sort((a, b) => L(a[1]).localeCompare(L(b[1]))).forEach(([k, v]) => {
    typeSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(L(v))}</option>`);
  });
  if (params.get('q')) search.value = params.get('q');
  if (params.get('type')) typeSel.value = params.get('type');

  const damage = (w) => (w.stats || []).find((s) => s.a === 'WuQiDamage')?.v || 0;

  function card(w) {
    const type = meta.weaponTypes?.[w.wtype];
    return `
      <button type="button" class="item-card db-card${qualityClass(w.quality)}" data-item-id="${esc(w.id)}">
        <div class="item-card-header">
          ${iconImg(w, 'item-card-icon')}
          <div class="item-card-title-section">
            <h3 class="item-card-title">${esc(pick(w, 'name'))}</h3>
            <span class="item-card-category">${esc(type ? L(type) : '')}${w.dlc ? ' · DLC' : ''}</span>
          </div>
          ${damage(w) ? `<span class="db-card-big" title="${esc(t('weapons.damage'))}">${esc(fmtNum(damage(w), 0))}</span>` : ''}
        </div>
        <div class="item-card-body">
          ${statList(meta, (w.stats || []).filter((s) => s.a !== 'WuQiDamage'))}
          <div class="item-card-meta">
            ${w.durability ? `<span>${esc(t('common.durability'))} <strong>${esc(w.durability)}</strong></span>` : ''}
            ${w.weight != null ? `<span>${esc(t('common.weight'))} <strong>${esc(fmtNum(w.weight))}</strong></span>` : ''}
          </div>
        </div>
      </button>`;
  }

  function render() {
    const q = normalize(search.value);
    const typ = typeSel.value;
    const list = weapons.filter((w) => (!typ || w.wtype === typ)
      && (!q || normalize(`${w.name_pt} ${w.name_en}`).includes(q)))
      .sort((a, b) => (a.wtype || '').localeCompare(b.wtype || '') || damage(a) - damage(b));
    count.textContent = tCount('weapons.count', list.length);
    renderChunked(container, list, card, { empty: `<div class="items-no-results">${esc(t('weapons.none'))}</div>` });
  }
  search.addEventListener('input', render);
  typeSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const c = e.target.closest('[data-item-id]');
    if (c) openItemModal(c.dataset.itemId);
  });
  render();
}
