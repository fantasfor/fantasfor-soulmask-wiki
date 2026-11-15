// Acesso aos dados do jogo (assets/data/*.json gerados por tools/build_data.py)
// e componentes compartilhados (formatação de atributos, janela de detalhes do item).
import { t, pick, locale, getLang } from './i18n.js';

const cache = {};

// 'no-cache' revalida com o servidor (ETag): dados atualizados aparecem sem precisar mudar a URL
export function loadData(name) {
  if (!cache[name]) {
    cache[name] = fetch(`assets/data/${name}.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
      return r.json();
    }).catch((e) => {
      delete cache[name];
      throw e;
    });
  }
  return cache[name];
}

const indexCache = {};
export async function loadIndex(name) {
  if (!indexCache[name]) {
    indexCache[name] = loadData(name).then((list) => new Map(list.map((x) => [String(x.id), x])));
  }
  return indexCache[name];
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texto multi-linha seguro
export function escLines(value) {
  return esc(value).replace(/\n/g, '<br>');
}

export function normalize(value) {
  return (value || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function fmtNum(v, digits = 2) {
  return Number(v).toLocaleString(locale(), { maximumFractionDigits: digits });
}

// Objeto {pt, en} -> texto no idioma atual
export function L(obj) {
  if (!obj) return '';
  return obj[getLang()] || obj.pt || obj.en || '';
}

export function attrName(meta, a) {
  const m = meta?.attrs?.[a];
  return m ? L(m) || a : a;
}

export function isPct(meta, stat) {
  return stat.op === 'mul' || Boolean(meta?.attrs?.[stat.a]?.pct);
}

// { label, value } — valor já formatado com sinal e % quando for o caso
export function statParts(meta, stat, mult = 1) {
  const pct = isPct(meta, stat);
  const v = stat.v * mult;
  const shown = pct ? v * 100 : v;
  const sign = shown > 0 ? '+' : '';
  return { label: attrName(meta, stat.a), value: `${sign}${fmtNum(shown, pct ? 1 : 2)}${pct ? '%' : ''}` };
}

export function statLine(meta, stat, mult = 1) {
  const { label, value } = statParts(meta, stat, mult);
  return `<li class="stat-line"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span></li>`;
}

export function statList(meta, stats, mult = 1) {
  if (!stats?.length) return '';
  return `<ul class="stat-list">${stats.map((s) => statLine(meta, s, mult)).join('')}</ul>`;
}

export function fmtDuration(seconds) {
  if (!seconds) return '';
  if (seconds >= 60) return t('common.minutes', { n: fmtNum(seconds / 60, 1) });
  return t('common.seconds', { n: fmtNum(seconds, 0) });
}

export function categoryLabel(meta, key) {
  const c = meta?.categories?.[key];
  return c ? L(c) : key;
}

export function qualityClass(q) {
  return q ? ` quality-${q}` : '';
}

export function iconImg(item, cls = 'game-icon', alt = '') {
  if (!item?.icon) return `<span class="${cls} game-icon-empty" aria-hidden="true"></span>`;
  return `<img class="${cls}" src="${esc(item.icon)}" alt="${esc(alt)}" loading="lazy" width="64" height="64" />`;
}

// Renderização incremental de listas grandes (evita travar com milhares de itens)
export function renderChunked(container, list, renderOne, { chunk = 120, empty = '' } = {}) {
  container.innerHTML = '';
  if (container._chunkObserver) container._chunkObserver.disconnect();
  if (!list.length) {
    container.innerHTML = empty;
    return;
  }
  let index = 0;
  const sentinel = document.createElement('div');
  sentinel.className = 'chunk-sentinel';
  const step = () => {
    const slice = list.slice(index, index + chunk);
    index += slice.length;
    sentinel.insertAdjacentHTML('beforebegin', slice.map(renderOne).join(''));
    if (index >= list.length) {
      observer.disconnect();
      sentinel.remove();
    }
  };
  container.appendChild(sentinel);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) step();
  }, { rootMargin: '600px' });
  container._chunkObserver = observer;
  step();
  if (index < list.length) observer.observe(sentinel);
}

// ------------------------------------------------------------------ janela de detalhes do item
let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'item-modal';
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <section class="item-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="itemModalTitle">
      <button type="button" class="item-modal-close" aria-label="${esc(t('common.close'))}">&times;</button>
      <div class="item-modal-body"></div>
    </section>`;
  document.body.appendChild(modalEl);
  const close = () => { modalEl.hidden = true; };
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl || e.target.closest('.item-modal-close')) close();
    const link = e.target.closest('[data-item-link]');
    if (link) {
      e.preventDefault();
      openItemModal(link.dataset.itemLink);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) close();
  });
  window.addEventListener('hashchange', close);
  return modalEl;
}

export function ingredientChip(items, id, n) {
  const it = items.get(id);
  const name = it ? pick(it, 'name') : id;
  return `<a href="#" class="ing-chip" data-item-link="${esc(id)}" title="${esc(name)}">${iconImg(it, 'ing-icon')}<span class="ing-name">${esc(name)}</span>${n ? `<span class="ing-n">×${esc(n)}</span>` : ''}</a>`;
}

export function recipeBlock(recipe, items, benches) {
  const ing = recipe.ing.map((g) => `<div class="ing-group">${g.ids.map((id) => ingredientChip(items, id, g.n)).join(`<span class="ing-or">${esc(t('common.or'))}</span>`)}</div>`).join('');
  const benchNames = (recipe.benches || []).map((b) => benches[b]).filter(Boolean)
    .map((b) => `<span class="bench-chip">${b.icon ? `<img src="${esc(b.icon)}" alt="" loading="lazy" />` : ''}${esc(pick(b, 'name'))}</span>`).join('');
  const meta = [
    recipe.time ? `<span>${esc(t('common.craftTime'))}: ${esc(fmtDuration(recipe.time))}</span>` : '',
    recipe.water ? `<span>${esc(t('common.water'))}: ${esc(recipe.water)}</span>` : '',
    recipe.count ? `<span>${esc(t('common.yields'))} ×${esc(recipe.count)}</span>` : ''
  ].join('');
  return `
    <div class="recipe-block">
      <div class="recipe-ings">${ing}</div>
      ${benchNames ? `<div class="recipe-benches">${benchNames}</div>` : ''}
      ${meta ? `<div class="recipe-meta">${meta}</div>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ onde conseguir (sources.json)
const MAP_NAMES = { main: 'map.mapMain', dlc: 'map.mapDlc' };

// nome de uma fonte: animal, inimigo, baú, chefe ou depósito
export function sourceName(s, creatures, bosses) {
  if (s.t === 'creature') return pick(creatures?.get(s.id), 'name') || s.id;
  if (s.t === 'boss') { const b = bosses?.get(s.id); return b ? pick(b.tiers?.[0] || b, 'name') : s.id; }
  if (s.t === 'vein') return t('src.veinOf', { name: t(`map.game.${s.id}`) });
  if (s.t === 'fol' && !s.n && (s.id === 'tree' || s.id === 'plant')) return t(`src.${s.id}`);
  return s.n ? L(s.n) : s.id || '';
}

// lista de fontes; o nome abre a escolha do mapa (data-map-find)
export function sourceList(list, creatures, bosses, max = 8) {
  if (!list?.length) return '';
  return `<ul class="src-list">${list.slice(0, max).map((s) => {
    const name = sourceName(s, creatures, bosses);
    const qty = s.q && (s.q[0] !== 1 || s.q[1] !== 1) ? ` ×${s.q[0]}${s.q[1] !== s.q[0] ? `–${s.q[1]}` : ''}` : '';
    const findable = s.t !== 'boss' && s.m?.length;
    return `<li class="src-item src-${esc(s.t)}">
      <span class="src-type">${esc(t(`src.${s.t}`))}</span>
      ${findable ? `<button type="button" class="src-name" data-map-find="${esc(name)}" data-maps="${esc(s.m.join(','))}">${esc(name)}</button>`
        : s.t === 'boss' ? `<a class="src-name" href="#chefes">${esc(name)}</a>`
          : s.t === 'crop' ? `<a class="src-name" href="#plantio">${esc(name)}</a>` : `<span class="src-name">${esc(name)}</span>`}
      <span class="src-chance">${esc(fmtNum(s.c, s.c < 1 ? 2 : 1))}%${esc(qty)}</span>
    </li>`;
  }).join('')}</ul>`;
}

// "Em qual mapa?" -> abre o mapa interativo já buscando pelo nome
let mapPickEl = null;
export function openMapPicker(name, maps) {
  if (!mapPickEl) {
    mapPickEl = document.createElement('div');
    mapPickEl.className = 'item-modal map-pick';
    mapPickEl.hidden = true;
    document.body.appendChild(mapPickEl);
    mapPickEl.addEventListener('click', (e) => {
      if (e.target === mapPickEl || e.target.closest('[data-pick-close]')) mapPickEl.hidden = true;
      const go = e.target.closest('[data-pick-map]');
      if (go) {
        mapPickEl.hidden = true;
        if (modalEl) modalEl.hidden = true;
        location.hash = `#mapa?map=${go.dataset.pickMap}&q=${encodeURIComponent(mapPickEl.dataset.name)}`;
      }
    });
  }
  mapPickEl.dataset.name = name;
  mapPickEl.innerHTML = `
    <section class="item-modal-dialog map-pick-dialog" role="dialog" aria-modal="true">
      <button type="button" class="item-modal-close" data-pick-close aria-label="${esc(t('common.close'))}">&times;</button>
      <h2>${esc(t('src.whichMap', { name }))}</h2>
      <div class="map-pick-btns">${Object.keys(MAP_NAMES).map((id) => {
        const has = maps.includes(id);
        return `<button type="button" class="map-pick-btn" data-pick-map="${id}" ${has ? '' : 'disabled'}>
          <strong>${esc(t(MAP_NAMES[id]))}</strong><small>${esc(t(has ? 'src.found' : 'src.notFound'))}</small></button>`;
      }).join('')}</div>
    </section>`;
  mapPickEl.hidden = false;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-map-find]');
  if (!b) return;
  e.preventDefault();
  openMapPicker(b.dataset.mapFind, (b.dataset.maps || '').split(',').filter(Boolean));
});

export async function openItemModal(id) {
  const el = ensureModal();
  const body = el.querySelector('.item-modal-body');
  body.innerHTML = `<p class="item-modal-loading">${esc(t('site.loading'))}</p>`;
  el.hidden = false;
  const [items, meta, recipes, benches, sets, sources, creatures, bosses] = await Promise.all([
    loadIndex('items'), loadData('meta'), loadData('recipes'), loadData('benches'), loadIndex('armor-sets'),
    loadData('sources').catch(() => ({})), loadIndex('creatures').catch(() => new Map()), loadIndex('bosses').catch(() => new Map())
  ]);
  const it = items.get(String(id));
  if (!it) {
    body.innerHTML = `<p>${esc(t('items.none'))}</p>`;
    return;
  }
  const own = recipes.filter((r) => r.item === it.id);
  const usedIn = recipes.filter((r) => r.ing.some((g) => g.ids.includes(it.id))).slice(0, 40);
  const set = it.set ? sets.get(String(it.set)) : null;
  const facts = [
    it.quality != null && meta.qualities?.[it.quality] ? `<span>${esc(t('common.quality'))} <strong>${esc(L(meta.qualities[it.quality]))}</strong></span>` : '',
    it.stack ?`<span>${esc(t('common.stack'))} <strong>${esc(it.stack)}</strong></span>` : '',
    it.weight != null ? `<span>${esc(t('common.weight'))} <strong>${esc(fmtNum(it.weight))}</strong></span>` : '',
    it.durability ? `<span>${esc(t('common.durability'))} <strong>${esc(it.durability)}</strong></span>` : '',
    it.comfort ? `<span>${esc(t('common.comfort'))} <strong>+${esc(fmtNum(it.comfort, 0))}</strong>${it.comfortMax ? ` <small>(${esc(t('common.comfortMax', { n: it.comfortMax }))})</small>` : ''}</span>` : '',
    it.dlc ? '<span class="dlc-badge">DLC</span>' : ''
  ].join('');
  body.innerHTML = `
    <header class="item-modal-header${qualityClass(it.quality)}">
      ${iconImg(it, 'item-modal-icon')}
      <div>
        <h2 id="itemModalTitle">${esc(pick(it, 'name'))}</h2>
        <span class="item-modal-cat">${esc(categoryLabel(meta, it.cat))}</span>
        <div class="item-modal-facts">${facts}</div>
      </div>
    </header>
    ${pick(it, 'desc') ? `<p class="item-modal-desc">${escLines(pick(it, 'desc'))}</p>` : ''}
    ${it.stats?.length ? `<h3>${esc(t('common.stats'))}</h3>${statList(meta, it.stats)}` : ''}
    ${it.random?.length ? `<h3>${esc(t('items.randomStats'))}</h3>${statList(meta, it.random)}` : ''}
    ${set ? `<h3>${esc(t('armors.setPieces'))}</h3><p><a href="#armaduras?set=${esc(set.id)}" class="item-modal-link">${esc(pick(set, 'name'))}</a></p>` : ''}
    ${own.length ? `<h3>${esc(t('items.howToCraft'))}</h3>${own.map((r) => recipeBlock(r, items, benches)).join('')}
      <p><a class="item-modal-link" href="#bancada?item=${encodeURIComponent(it.id)}">${esc(t('items.seeTree'))}</a></p>` : ''}
    ${sources[it.id]?.length ? `<h3>${esc(t('src.title'))}</h3>${sourceList(sources[it.id], creatures, bosses)}` : ''}
    ${usedIn.length ? `<h3>${esc(t('items.usedIn'))}</h3><div class="used-in">${usedIn.map((r) => ingredientChip(items, r.item, 0)).join('')}</div>` : ''}
  `;
  el.querySelector('.item-modal-close').setAttribute('aria-label', t('common.close'));
}

window.openItemModal = openItemModal;
