import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, escLines, normalize, renderChunked } from '../data.js';

const FIELDS = ['temper', 'habitat', 'active', 'social', 'senses', 'weak', 'drops', 'capture'];

export async function initCreaturesPage(root, params) {
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let creatures = [];
  try {
    creatures = await loadData('creatures');
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');

  function card(c) {
    return `
      <article class="item-card creature-card">
        ${c.photo ? `<img class="creature-photo" src="${esc(c.photo)}" alt="${esc(pick(c, 'name'))}" loading="lazy" width="256" height="256" />` : ''}
        <h3 class="item-card-title">${esc(pick(c, 'name'))}${c.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>
        ${pick(c, 'desc') ? `<p class="item-card-description">${escLines(pick(c, 'desc'))}</p>` : ''}
        <dl class="creature-facts">
          ${FIELDS.filter((f) => pick(c, f)).map((f) => `<div><dt>${esc(t(`creatures.${f}`))}</dt><dd>${esc(pick(c, f))}</dd></div>`).join('')}
        </dl>
      </article>`;
  }
  function render() {
    const q = normalize(search.value);
    const list = creatures.filter((c) => !q || normalize(FIELDS.concat(['name', 'desc']).map((f) => `${c[`${f}_pt`] || ''} ${c[`${f}_en`] || ''}`).join(' ')).includes(q))
      .sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')));
    count.textContent = tCount('creatures.count', list.length);
    renderChunked(container, list, card, { empty: `<div class="items-no-results">${esc(t('creatures.none'))}</div>` });
  }
  search.addEventListener('input', render);
  render();
}
