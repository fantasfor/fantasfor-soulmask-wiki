import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, iconImg, qualityClass, ingredientChip, openItemModal } from '../data.js';

// Máscaras: todas visíveis em grade; ao clicar, abre (logo abaixo da linha) a descrição e as melhorias
export async function initMasksPage(root, params) {
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let masks = [];
  let items;
  let sources = {};
  try {
    [masks, items, sources] = await Promise.all([loadData('masks'), loadIndex('items'), loadData('sources').catch(() => ({}))]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');
  let openId = params.get('id') || null;

  const upgradeText = (u) => [u.name_pt, u.name_en, ...u.levels.flatMap((l) => [l.desc_pt, l.desc_en])].join(' ');

  function upgradeHtml(u) {
    return `
      <li class="mask-upgrade">
        ${u.icon ? `<img class="mask-upgrade-icon" src="${esc(u.icon)}" alt="" loading="lazy" />` : '<span class="mask-upgrade-icon"></span>'}
        <div class="mask-upgrade-body">
          <strong class="mask-upgrade-name">${esc(pick(u, 'name'))}</strong>
          ${u.levels.map((l, i) => `
            <div class="mask-upgrade-level">
              ${u.levels.length > 1 ? `<span class="mask-upgrade-tag">${esc(t('common.level'))} ${i + 1}</span>` : ''}
              ${l.maskLevel ? `<span class="mask-upgrade-tag">${esc(t('masks.needLevel', { n: l.maskLevel }))}</span>` : ''}
              <p>${escLines(pick(l, 'desc'))}</p>
              ${l.mats?.length ? `<div class="mask-upgrade-mats">${l.mats.map((m) => ingredientChip(items, m.ids[0], m.n)).join('')}</div>` : ''}
            </div>`).join('')}
        </div>
      </li>`;
  }

  function tile(m) {
    const open = m.id === openId;
    return `
      <button type="button" class="mask-tile${qualityClass(m.quality)}${open ? ' is-open' : ''}" data-mask="${esc(m.id)}" aria-expanded="${open}" aria-controls="mask-detail">
        ${iconImg(m, 'mask-tile-icon')}
        <span class="mask-tile-name">${esc(pick(m, 'name'))}</span>
        ${m.dlc ? '<span class="dlc-badge">DLC</span>' : ''}
        <span class="mask-tile-count">${esc(t('masks.upgradesN', { n: m.upgrades?.length || 0 }))}</span>
      </button>`;
  }

  // "Onde encontrar": baús de máscara (Relíquia Sagrada), chefes e inimigos que dão a máscara, no Mapa interativo
  function whereHtml(m) {
    const src = (sources[m.id] || []).filter((s) => s.m?.length);
    const maps = [...new Set(src.flatMap((s) => s.m))];
    const names = [...new Set(src.map((s) => pick({ name_pt: s.n?.pt, name_en: s.n?.en }, 'name')).filter(Boolean))];
    const craft = m.recipes?.length ? `<p class="mask-where-note">${esc(t('masks.whereCraft'))}</p>` : '';
    if (!maps.length) return `<div class="mask-where"><p class="mask-where-note">${esc(t(m.recipes?.length ? 'masks.onlyCraft' : 'masks.notOnMap'))}</p></div>`;
    const mapId = maps.includes('main') ? 'main' : maps[0];
    return `<div class="mask-where">
      <a class="db-map-btn" href="#mapa?map=${mapId}&item=${encodeURIComponent(m.id)}">${esc(t('masks.whereFind'))}</a>
      ${names.length ? `<p class="mask-where-note">${esc(names.join(' · '))}</p>` : ''}${craft}</div>`;
  }

  function detail(m) {
    return `
      <article class="mask-detail${qualityClass(m.quality)}" id="mask-detail" tabindex="-1">
        <header class="mask-card-head">
          <button type="button" class="mask-card-icon-btn" data-item-id="${esc(m.id)}" title="${esc(t('common.details'))}">${iconImg(m, 'mask-card-icon')}</button>
          <div>
            <h2 class="mask-detail-title">${esc(pick(m, 'name'))} ${m.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</h2>
            ${pick(m, 'lore') ? `<p class="mask-lore">${escLines(pick(m, 'lore'))}</p>` : ''}
            ${(m.buffs || []).map((b) => `<p class="mask-buff"><strong>${esc(pick(b, 'name'))}</strong> ${escLines(pick(b, 'desc'))}</p>`).join('')}
            ${whereHtml(m)}
          </div>
          <button type="button" class="mask-detail-close" data-close aria-label="${esc(t('common.close'))}">&times;</button>
        </header>
        ${m.outfit ? `<h3 class="mask-upgrades-title">${esc(t('masks.outfit'))}</h3>
          <div class="mask-outfits">${['m', 'f'].filter((s) => m.outfit[s]).map((s) => `<figure><img src="${esc(m.outfit[s])}" alt="" loading="lazy" /><figcaption>${esc(t(s === 'm' ? 'builder.male' : 'builder.female'))}</figcaption></figure>`).join('')}</div>` : ''}
        ${m.upgrades?.length ? `<h3 class="mask-upgrades-title">${esc(t('masks.upgrades'))}</h3><ul class="mask-upgrades">${m.upgrades.map(upgradeHtml).join('')}</ul>` : ''}
      </article>`;
  }

  let list = [];
  function render() {
    const q = normalize(search.value);
    list = masks.filter((m) => !q || normalize(`${m.name_pt} ${m.name_en} ${m.lore_pt || ''} ${m.lore_en || ''} ${(m.upgrades || []).map(upgradeText).join(' ')}`).includes(q))
      .sort((a, b) => (b.quality || 0) - (a.quality || 0) || pick(a, 'name').localeCompare(pick(b, 'name')));
    count.textContent = tCount('masks.count', list.length);
    container.innerHTML = list.length ? list.map(tile).join('') : `<div class="items-no-results">${esc(t('masks.none'))}</div>`;
    placeDetail(false);
  }

  // insere o painel de detalhes logo depois da última máscara da mesma linha da grade
  function placeDetail(focus) {
    container.querySelector('#mask-detail')?.remove();
    const m = list.find((x) => x.id === openId);
    const btn = m && container.querySelector(`[data-mask="${CSS.escape(m.id)}"]`);
    if (!btn) return;
    const top = btn.offsetTop;
    let last = btn;
    let next = btn.nextElementSibling;
    while (next && next.offsetTop === top) { last = next; next = next.nextElementSibling; }
    last.insertAdjacentHTML('afterend', detail(m));
    if (focus) {
      const panel = container.querySelector('#mask-detail');
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function toggle(id) {
    openId = openId === id ? null : id;
    container.querySelectorAll('[data-mask]').forEach((b) => {
      const open = b.dataset.mask === openId;
      b.classList.toggle('is-open', open);
      b.setAttribute('aria-expanded', String(open));
    });
    placeDetail(true);
  }

  search.addEventListener('input', render);
  container.addEventListener('click', (e) => {
    const tileBtn = e.target.closest('[data-mask]');
    if (tileBtn) { toggle(tileBtn.dataset.mask); return; }
    if (e.target.closest('[data-close]')) { toggle(openId); return; }
    const link = e.target.closest('[data-item-link], [data-item-id]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink || link.dataset.itemId);
  });
  // a grade muda de colunas com a largura da tela: reposiciona o painel
  let resizeTimer;
  const onResize = () => {
    if (!root.isConnected) { window.removeEventListener('resize', onResize); return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => placeDetail(false), 150);
  };
  window.addEventListener('resize', onResize);
  render();
}
