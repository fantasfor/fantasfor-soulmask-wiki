import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, renderChunked, ingredientChip, openItemModal } from '../data.js';

const FIELDS = ['temper', 'habitat', 'active', 'social', 'senses', 'weak', 'drops', 'capture'];

export async function initCreaturesPage(root, params) {
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let creatures = [];
  let items = new Map();
  try {
    [creatures, items] = await Promise.all([loadData('creatures'), loadIndex('items').catch(() => new Map())]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');

  // "Ver no mapa": abre o Mapa interativo mostrando só onde a criatura nasce (Floresta primeiro, se estiver nos dois)
  const mapLink = (c) => (c.maps?.length
    ? `<a class="db-map-btn" href="#mapa?map=${c.maps.includes('main') ? 'main' : c.maps[0]}&creature=${encodeURIComponent(c.id)}">${esc(t('creatures.seeOnMap'))}</a>` : '');
  // recursos que a criatura dá (itens clicáveis, abrem a janela do item)
  const dropChips = (c) => {
    const ids = (c.dropIds || []).filter((id) => items.has(id));
    return ids.length ? `<div class="creature-drops"><span class="creature-drops-title">${esc(t('creatures.dropItems'))}</span>
      <div class="creature-drops-list">${ids.map((id) => ingredientChip(items, id)).join('')}</div></div>` : '';
  };

  function card(c) {
    return `
      <article class="item-card creature-card">
        ${c.photo ? `<img class="creature-photo" src="${esc(c.photo)}" alt="${esc(pick(c, 'name'))}" loading="lazy" width="256" height="256" />` : ''}
        <h3 class="item-card-title">${esc(pick(c, 'name'))}${c.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>
        ${pick(c, 'desc') ? `<p class="item-card-description">${escLines(pick(c, 'desc'))}</p>` : ''}
        <dl class="creature-facts">
          ${FIELDS.filter((f) => pick(c, f) && !(f === 'drops' && c.dropIds?.some((id) => items.has(id)))).map((f) => `<div><dt>${esc(t(`creatures.${f}`))}</dt><dd>${esc(pick(c, f))}</dd></div>`).join('')}
        </dl>
        ${dropChips(c)}
        ${mapLink(c)}
      </article>`;
  }
  const dropText = (c) => (c.dropIds || []).map((id) => { const it = items.get(id); return it ? `${it.name_pt} ${it.name_en}` : ''; }).join(' ');
  function render() {
    const q = normalize(search.value);
    const list = creatures.filter((c) => !q || normalize(`${FIELDS.concat(['name', 'desc']).map((f) => `${c[`${f}_pt`] || ''} ${c[`${f}_en`] || ''}`).join(' ')} ${dropText(c)}`).includes(q))
      .sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')));
    count.textContent = tCount('creatures.count', list.length);
    renderChunked(container, list, card, { empty: `<div class="items-no-results">${esc(t('creatures.none'))}</div>` });
  }
  search.addEventListener('input', render);
  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink);
  });
  render();
}
