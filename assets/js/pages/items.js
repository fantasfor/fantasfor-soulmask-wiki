// Itens e Receitas: todos os itens, com a receita de cada um (materiais e bancada) no próprio cartão.
// A antiga página Receitas (#receitas) agora abre esta, já filtrada pela bancada.
import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum, categoryLabel, iconImg, qualityClass, openItemModal, recipeBlock, rarityIcon } from '../data.js';

export async function initItemsPage(root, params) {
  const search = root.querySelector('#items-search');
  const catSel = root.querySelector('#items-category-filter');
  const benchSel = root.querySelector('#items-bench-filter');
  const craftEl = root.querySelector('#items-craftable');
  const count = root.querySelector('#items-count');
  const container = root.querySelector('#items-container');

  let items = [];
  let meta = {};
  let recipes = [];
  let benches = {};
  try {
    [items, meta, recipes, benches] = await Promise.all([loadData('items'), loadData('meta'), loadData('recipes'), loadData('benches')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const recipesOf = new Map();
  recipes.forEach((r) => { if (!recipesOf.has(r.item)) recipesOf.set(r.item, []); recipesOf.get(r.item).push(r); });

  const cats = [...new Set(items.map((i) => i.cat))]
    .sort((a, b) => categoryLabel(meta, a).localeCompare(categoryLabel(meta, b)));
  cats.forEach((c) => catSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(categoryLabel(meta, c))}</option>`));
  const used = new Set(recipes.flatMap((r) => r.benches || []));
  Object.entries(benches).filter(([k]) => used.has(k))
    .sort((a, b) => pick(a[1], 'name').localeCompare(pick(b[1], 'name')))
    .forEach(([k, b]) => benchSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(pick(b, 'name'))}</option>`));

  if (params.get('q')) search.value = params.get('q');
  if (params.get('cat')) catSel.value = params.get('cat');
  if (params.get('bench')) { benchSel.value = params.get('bench'); craftEl.checked = true; }
  if (params.get('craft') === '1') craftEl.checked = true;

  // texto de busca: nome, descrição e os materiais da receita (para achar "o que usa couro")
  const hay = new Map(items.map((it) => {
    const parts = [it.name_pt, it.name_en, it.desc_pt || '', it.desc_en || ''];
    (recipesOf.get(it.id) || []).forEach((r) => r.ing.forEach((g) => g.ids.forEach((id) => {
      const x = byId.get(id);
      if (x) parts.push(x.name_pt, x.name_en);
    })));
    return [it.id, normalize(parts.join(' '))];
  }));

  function card(it) {
    const desc = pick(it, 'desc');
    const rs = recipesOf.get(it.id) || [];
    const r = benchSel.value ? rs.find((x) => (x.benches || []).includes(benchSel.value)) || rs[0] : rs[0];
    return `
      <article class="item-card${rs.length ? ' recipe-card' : ''}${qualityClass(it.quality)}">
        <button type="button" class="item-card-header recipe-card-head" data-item-id="${esc(it.id)}">
          ${iconImg(it, 'item-card-icon')}
          <div class="item-card-title-section">
            <h3 class="item-card-title">${it.quality ? `${rarityIcon(meta, it.quality)} ` : ''}${esc(pick(it, 'name'))}${r?.count ? ` ×${esc(r.count)}` : ''}</h3>
            <span class="item-card-category">${esc(categoryLabel(meta, it.cat))}${r?.level ? ` · ${esc(t('common.level'))} ${esc(r.level)}` : ''}${it.dlc ? ' · DLC' : ''}</span>
          </div>
        </button>
        ${r ? recipeBlock(r, byId, benches) : `<div class="item-card-body">${desc ? `<p class="item-card-description">${esc(desc)}</p>` : ''}</div>`}
        <div class="item-card-meta item-card-meta-pad">
          ${it.stack ? `<span>${esc(t('common.stack'))} <strong>${esc(it.stack)}</strong></span>` : ''}
          ${it.weight != null ? `<span>${esc(t('common.weight'))} <strong>${esc(fmtNum(it.weight))}</strong></span>` : ''}
          ${it.durability ? `<span>${esc(t('common.durability'))} <strong>${esc(it.durability)}</strong></span>` : ''}
          ${it.comfort ? `<span>${esc(t('common.comfort'))} <strong>+${esc(fmtNum(it.comfort, 0))}</strong></span>` : ''}
          ${rs.length ? `<a class="item-card-tree" href="#bancada?item=${encodeURIComponent(it.id)}">${esc(t('items.seeTree'))}</a>` : ''}
        </div>
      </article>`;
  }

  function render() {
    const q = normalize(search.value);
    const cat = catSel.value;
    const bench = benchSel.value;
    const onlyCraft = craftEl.checked || Boolean(bench);
    const list = items.filter((it) => {
      if (cat && it.cat !== cat) return false;
      const rs = recipesOf.get(it.id);
      if (onlyCraft && !rs) return false;
      if (bench && !rs.some((r) => (r.benches || []).includes(bench))) return false;
      return !q || hay.get(it.id).includes(q);
    });
    count.textContent = tCount('items.count', list.length);
    current = list;
    shown = 0;
    if (container._chunkObserver) container._chunkObserver.disconnect();
    container.innerHTML = list.length ? '' : `<div class="items-no-results">${esc(t('items.none'))}</div>`;
    moreWrap.hidden = true;
    showMore();
  }

  // "Mostrar mais": carrega os itens em blocos, só quando a pessoa pede (a página não pesa com 2 mil cartões)
  const PAGE = 48;
  let current = [];
  let shown = 0;
  const moreWrap = document.createElement('div');
  moreWrap.className = 'items-more';
  moreWrap.hidden = true;
  moreWrap.innerHTML = '<button type="button" class="map-btn items-more-btn"></button><small class="items-more-info"></small>';
  container.after(moreWrap);
  const moreBtn = moreWrap.querySelector('button');
  const moreInfo = moreWrap.querySelector('small');
  function showMore() {
    const slice = current.slice(shown, shown + PAGE);
    if (slice.length) container.insertAdjacentHTML('beforeend', slice.map(card).join(''));
    shown += slice.length;
    const left = current.length - shown;
    moreWrap.hidden = left <= 0;
    moreBtn.textContent = t('items.showMore', { n: Math.min(PAGE, left) });
    moreInfo.textContent = t('items.shownOf', { a: shown, b: current.length });
  }
  moreBtn.addEventListener('click', () => {
    const first = shown;
    showMore();
    // leva o foco para o primeiro cartão novo (teclado e leitor de tela)
    container.children[first]?.querySelector('button, a')?.focus({ preventScroll: true });
  });

  search.addEventListener('input', render);
  catSel.addEventListener('change', render);
  benchSel.addEventListener('change', render);
  craftEl.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const c = e.target.closest('[data-item-link], [data-item-id]');
    if (c) {
      e.preventDefault();
      openItemModal(c.dataset.itemLink || c.dataset.itemId);
    }
  });
  render();
  if (params.get('item')) openItemModal(params.get('item'));
}
