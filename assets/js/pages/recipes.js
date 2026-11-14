import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, iconImg, qualityClass, recipeBlock, renderChunked, openItemModal } from '../data.js';

export async function initRecipesPage(root, params) {
  const search = root.querySelector('#db-search');
  const benchSel = root.querySelector('#db-filter');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let recipes = [];
  let items;
  let benches = {};
  try {
    [recipes, items, benches] = await Promise.all([loadData('recipes'), loadIndex('items'), loadData('benches')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const used = new Set(recipes.flatMap((r) => r.benches || []));
  Object.entries(benches).filter(([k]) => used.has(k))
    .sort((a, b) => pick(a[1], 'name').localeCompare(pick(b[1], 'name')))
    .forEach(([k, b]) => benchSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(pick(b, 'name'))}</option>`));
  if (params.get('q')) search.value = params.get('q');
  if (params.get('bench')) benchSel.value = params.get('bench');

  // texto de busca: produto + ingredientes, nos dois idiomas
  const hay = new Map(recipes.map((r) => {
    const names = [r.name_pt, r.name_en];
    r.ing.forEach((g) => g.ids.forEach((id) => {
      const it = items.get(id);
      if (it) names.push(it.name_pt, it.name_en);
    }));
    return [r, normalize(names.join(' '))];
  }));

  function card(r) {
    const prod = items.get(r.item);
    return `
      <article class="item-card recipe-card${qualityClass(prod?.quality)}">
        <button type="button" class="item-card-header recipe-card-head" data-item-id="${esc(r.item)}">
          ${iconImg(prod, 'item-card-icon')}
          <div class="item-card-title-section">
            <h3 class="item-card-title">${esc(pick(r, 'name'))}${r.count ? ` ×${esc(r.count)}` : ''}</h3>
            <span class="item-card-category">${r.level ? `${esc(t('common.level'))} ${esc(r.level)}` : ''}${r.dlc ? ' · DLC' : ''}</span>
          </div>
        </button>
        ${recipeBlock(r, items, benches)}
      </article>`;
  }

  function render() {
    const q = normalize(search.value);
    const b = benchSel.value;
    const list = recipes.filter((r) => (!b || (r.benches || []).includes(b)) && (!q || hay.get(r).includes(q)))
      .sort((x, y) => pick(x, 'name').localeCompare(pick(y, 'name')));
    count.textContent = tCount('recipes.count', list.length);
    renderChunked(container, list, card, { chunk: 60, empty: `<div class="items-no-results">${esc(t('recipes.none'))}</div>` });
  }
  search.addEventListener('input', render);
  benchSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link], [data-item-id]');
    if (link) {
      e.preventDefault();
      openItemModal(link.dataset.itemLink || link.dataset.itemId);
    }
  });
  render();
}
