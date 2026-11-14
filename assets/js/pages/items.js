import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum, categoryLabel, iconImg, qualityClass, renderChunked, openItemModal } from '../data.js';

export async function initItemsPage(root, params) {
  const search = root.querySelector('#items-search');
  const catSel = root.querySelector('#items-category-filter');
  const count = root.querySelector('#items-count');
  const container = root.querySelector('#items-container');

  let items = [];
  let meta = {};
  try {
    [items, meta] = await Promise.all([loadData('items'), loadData('meta')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }

  const cats = [...new Set(items.map((i) => i.cat))]
    .sort((a, b) => categoryLabel(meta, a).localeCompare(categoryLabel(meta, b)));
  cats.forEach((c) => catSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(categoryLabel(meta, c))}</option>`));

  if (params.get('q')) search.value = params.get('q');
  if (params.get('cat')) catSel.value = params.get('cat');

  function card(it) {
    const desc = pick(it, 'desc');
    return `
      <button type="button" class="item-card${qualityClass(it.quality)}" data-item-id="${esc(it.id)}">
        <div class="item-card-header">
          ${iconImg(it, 'item-card-icon')}
          <div class="item-card-title-section">
            <h3 class="item-card-title">${esc(pick(it, 'name'))}</h3>
            <span class="item-card-category">${esc(categoryLabel(meta, it.cat))}${it.dlc ? ' · DLC' : ''}</span>
          </div>
        </div>
        <div class="item-card-body">
          ${desc ? `<p class="item-card-description">${esc(desc)}</p>` : ''}
          <div class="item-card-meta">
            ${it.stack ? `<span>${esc(t('common.stack'))} <strong>${esc(it.stack)}</strong></span>` : ''}
            ${it.weight != null ? `<span>${esc(t('common.weight'))} <strong>${esc(fmtNum(it.weight))}</strong></span>` : ''}
            ${it.durability ? `<span>${esc(t('common.durability'))} <strong>${esc(it.durability)}</strong></span>` : ''}
          </div>
        </div>
      </button>`;
  }

  function render() {
    const q = normalize(search.value);
    const cat = catSel.value;
    const list = items.filter((it) => (!cat || it.cat === cat)
      && (!q || normalize(`${it.name_pt} ${it.name_en} ${it.desc_pt || ''} ${it.desc_en || ''}`).includes(q)));
    count.textContent = tCount('items.count', list.length);
    renderChunked(container, list, card, { empty: `<div class="items-no-results">${esc(t('items.none'))}</div>` });
  }

  search.addEventListener('input', render);
  catSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const c = e.target.closest('[data-item-id]');
    if (c) openItemModal(c.dataset.itemId);
  });
  render();
  if (params.get('item')) openItemModal(params.get('item'));
}
