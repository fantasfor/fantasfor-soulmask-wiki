import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, iconImg, qualityClass, ingredientChip, openItemModal, rarityIcon, rarityName } from '../data.js';

// Ícones dos atributos (o jogo não tem um para cada): losango com traço branco simples, no estilo do mapa
const D = '<path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.4"/>';
const GLYPH = {
  energy: '<path d="M13 6 8.5 12.8h3.2L11 18l4.5-6.8h-3.2Z" fill="currentColor"/>',
  recovery: '<path d="M12 7v8M8.6 10.4 12 7l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 17h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  consumption: '<path d="M12 7v8M8.6 11.6 12 15l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 17h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  crystal: '<path d="M12 6.5 15.2 10 12 17.5 8.8 10Z M8.8 10h6.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  deterrence: '<path d="M7 12s2-3.4 5-3.4 5 3.4 5 3.4-2 3.4-5 3.4S7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  mask: '<path d="M7.5 8.5c3-1.2 6-1.2 9 0 .3 4.5-1.6 8-4.5 8.8-2.9-.8-4.8-4.3-4.5-8.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.3 11.3h1.8M12.9 11.3h1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  core: '<circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'
};
const statIcon = (k) => `<svg class="mask-ico" viewBox="0 0 24 24" aria-hidden="true">${D}${GLYPH[k] || ''}</svg>`;
const STAT_ORDER = ['energy', 'recovery', 'consumption', 'crystal', 'deterrence'];

// Máscaras: lista à esquerda (no celular, um seletor em cima) e, à direita, tudo sobre a máscara escolhida
export async function initMasksPage(root, params) {
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const listEl = root.querySelector('#db-container');
  const selectEl = root.querySelector('#mask-select');
  const panel = root.querySelector('#mask-panel');
  let masks = [];
  let items;
  let sources = {};
  let meta = {};
  try {
    [masks, items, sources, meta] = await Promise.all([loadData('masks'), loadIndex('items'), loadData('sources').catch(() => ({})), loadData('meta').catch(() => ({}))]);
  } catch (e) {
    panel.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  masks.sort((a, b) => (b.quality || 0) - (a.quality || 0) || pick(a, 'name').localeCompare(pick(b, 'name')));
  if (params.get('q')) search.value = params.get('q');
  let openId = masks.some((m) => m.id === params.get('id')) ? params.get('id') : masks[0]?.id;

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

  function rowHtml(m) {
    const on = m.id === openId;
    return `
      <button type="button" class="mask-row${qualityClass(m.quality)}${on ? ' is-open' : ''}" data-mask="${esc(m.id)}" role="listitem" aria-current="${on}">
        ${iconImg(m, 'mask-row-icon')}
        <span class="mask-row-text">
          <span class="mask-row-name">${esc(pick(m, 'name'))}</span>
          <span class="mask-row-meta">${m.quality ? `${rarityIcon(meta, m.quality, { decorative: true })}<span>${esc(rarityName(meta, m.quality))}</span>` : ''}${m.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</span>
        </span>
      </button>`;
  }

  // de onde vem um item no Mapa interativo (baús, chefes, inimigos)
  function whereOf(id) {
    const src = (sources[id] || []).filter((s) => s.m?.length);
    const maps = [...new Set(src.flatMap((s) => s.m))];
    const names = [...new Set(src.map((s) => pick({ name_pt: s.n?.pt, name_en: s.n?.en }, 'name')).filter(Boolean))];
    return { maps, names, mapId: maps.includes('main') ? 'main' : maps[0] };
  }
  const mapNames = (maps) => maps.map((x) => t(x === 'dlc' ? 'map.mapDlc' : 'map.mapMain')).join(' · ');

  function whereCard(title, icon, id, emptyKey, extra = '') {
    const w = whereOf(id);
    const it = items.get(id);
    return `<div class="mask-where-card">
      <h4>${statIcon(icon)}<span>${esc(title)}</span></h4>
      ${it ? `<div class="mask-where-item">${ingredientChip(items, id, 0)}</div>` : ''}
      ${w.maps.length
    ? `<p class="mask-where-note">${esc(w.names.join(' · '))}<br /><small>${esc(mapNames(w.maps))}</small></p>
         <a class="db-map-btn" href="#mapa?map=${w.mapId}&item=${encodeURIComponent(id)}">${esc(t('masks.whereFind'))}</a>`
    : `<p class="mask-where-note">${esc(t(emptyKey))}</p>`}${extra}</div>`;
  }

  function whereHtml(m) {
    const craft = m.recipes?.length;
    const maskEmpty = craft ? 'masks.onlyCraft' : 'masks.notOnMap';
    const cards = [whereCard(t('masks.whereMask'), 'mask', m.id, maskEmpty,
      craft && whereOf(m.id).maps.length ? `<p class="mask-where-note">${esc(t('masks.whereCraft'))}</p>` : '')];
    if (m.core) cards.push(whereCard(t('masks.core'), 'core', m.core, 'masks.coreNotOnMap', `<p class="mask-where-note mask-where-hint">${esc(t('masks.coreHint'))}</p>`));
    return `<section class="mask-block"><h3 class="mask-block-title">${esc(t('masks.whereFind'))}</h3><div class="mask-where-grid">${cards.join('')}</div></section>`;
  }

  function statsHtml(m) {
    const s = m.stats || {};
    const bars = STAT_ORDER.filter((k) => s[k]).map((k) => {
      const v = s[k];
      const segs = Array.from({ length: v.max || 5 }, (_, i) => `<i class="${i < v.lv ? 'on' : ''}"></i>`).join('');
      return `<li class="mask-stat" title="${esc(t(`masks.stat.${k}.tip`))}">
        ${statIcon(k)}<span class="mask-stat-name">${esc(t(`masks.stat.${k}`))}</span>
        <span class="mask-stat-bar" role="img" aria-label="${esc(`${v.lv} / ${v.max}`)}">${segs}</span>
        <span class="mask-stat-lv">${v.lv}/${v.max}</span></li>`;
    }).join('');
    const cl = m.crystalLimit;
    const cards = [
      s.energy?.val ? [statIcon('energy'), t('masks.energyCap'), Math.round(s.energy.val), t('masks.energyCapTip')] : null,
      cl?.length ? [statIcon('crystal'), t('masks.stat.crystal'), `${cl[0]} → ${cl[cl.length - 1]}`, t('masks.crystalTip', { n: cl.length })] : null
    ].filter(Boolean);
    if (!bars && !cards.length) return '';
    return `<section class="mask-block"><h3 class="mask-block-title">${esc(t('masks.stats'))}</h3>
      <div class="mask-stats-wrap">
        ${bars ? `<ul class="mask-stats">${bars}</ul>` : ''}
        ${cards.length ? `<div class="mask-info-cards">${cards.map(([ic, label, val, tip]) => `
          <div class="mask-info-card"${tip ? ` title="${esc(tip)}"` : ''}>${ic}<span class="mask-info-label">${esc(label)}</span><strong>${esc(String(val))}</strong>${tip ? `<small>${esc(tip)}</small>` : ''}</div>`).join('')}</div>` : ''}
      </div></section>`;
  }

  function detail(m) {
    if (!m) return `<div class="items-no-results">${esc(t('masks.none'))}</div>`;
    return `
      <article class="mask-detail${qualityClass(m.quality)}" id="mask-detail" tabindex="-1">
        <header class="mask-card-head">
          <button type="button" class="mask-card-icon-btn" data-item-id="${esc(m.id)}" title="${esc(t('common.details'))}">${iconImg(m, 'mask-card-icon')}</button>
          <div class="mask-head-text">
            <h2 class="mask-detail-title">${esc(pick(m, 'name'))} ${m.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</h2>
            ${m.quality ? `<p class="mask-rarity">${rarityIcon(meta, m.quality, { decorative: true })}<span>${esc(rarityName(meta, m.quality))}</span></p>` : ''}
            ${pick(m, 'lore') ? `<p class="mask-lore">${escLines(pick(m, 'lore'))}</p>` : ''}
          </div>
        </header>
        ${m.buffs?.length ? `<section class="mask-block"><h3 class="mask-block-title">${esc(t('masks.effect'))}</h3>
          <div class="mask-buffs">${m.buffs.map((b) => `<div class="mask-buff-card"><strong>${esc(pick(b, 'name'))}</strong><p>${escLines(pick(b, 'desc'))}</p></div>`).join('')}</div></section>` : ''}
        ${statsHtml(m)}
        ${whereHtml(m)}
        ${m.outfit ? `<section class="mask-block"><h3 class="mask-block-title">${esc(t('masks.outfit'))}</h3>
          <div class="mask-outfits">${['m', 'f'].filter((s) => m.outfit[s]).map((s) => `<figure><img src="${esc(m.outfit[s])}" alt="" loading="lazy" /><figcaption>${esc(t(s === 'm' ? 'builder.male' : 'builder.female'))}</figcaption></figure>`).join('')}</div></section>` : ''}
        ${m.upgrades?.length ? `<section class="mask-block"><h3 class="mask-block-title">${esc(t('masks.upgrades'))} <small>${esc(t('masks.upgradesN', { n: m.upgrades.length }))}</small></h3><ul class="mask-upgrades">${m.upgrades.map(upgradeHtml).join('')}</ul></section>` : ''}
      </article>`;
  }

  let list = [];
  function render() {
    const q = normalize(search.value);
    list = masks.filter((m) => !q || normalize(`${m.name_pt} ${m.name_en} ${m.lore_pt || ''} ${m.lore_en || ''} ${(m.upgrades || []).map(upgradeText).join(' ')}`).includes(q));
    count.textContent = tCount('masks.count', list.length);
    if (list.length && !list.some((m) => m.id === openId)) openId = list[0].id;
    listEl.innerHTML = list.length ? list.map(rowHtml).join('') : `<div class="items-no-results">${esc(t('masks.none'))}</div>`;
    selectEl.innerHTML = list.map((m) => `<option value="${esc(m.id)}"${m.id === openId ? ' selected' : ''}>${esc(pick(m, 'name'))}${m.quality ? ` · ${esc(rarityName(meta, m.quality))}` : ''}</option>`).join('');
    selectEl.disabled = !list.length;
    showPanel();
  }

  function showPanel() {
    panel.innerHTML = detail(list.find((m) => m.id === openId));
  }

  function select(id, { scroll = false } = {}) {
    if (!id || id === openId) return;
    openId = id;
    listEl.querySelectorAll('[data-mask]').forEach((b) => {
      const on = b.dataset.mask === openId;
      b.classList.toggle('is-open', on);
      b.setAttribute('aria-current', String(on));
    });
    selectEl.value = openId;
    showPanel();
    // link da máscara aberta, sem recarregar a página
    try { history.replaceState(null, '', `#mascaras?id=${encodeURIComponent(openId)}`); } catch (e) { /* ignora */ }
    if (scroll && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
  }

  search.addEventListener('input', render);
  selectEl.addEventListener('change', () => select(selectEl.value));
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mask]');
    if (row) select(row.dataset.mask, { scroll: true });
  });
  panel.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link], [data-item-id]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink || link.dataset.itemId);
  });
  render();
}
