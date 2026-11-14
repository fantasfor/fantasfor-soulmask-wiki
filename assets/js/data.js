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
    recipe.time ? `<span>⏱ ${esc(fmtDuration(recipe.time))}</span>` : '',
    recipe.water ? `<span>💧 ${esc(recipe.water)}</span>` : '',
    recipe.count ? `<span>${esc(t('common.yields'))} ×${esc(recipe.count)}</span>` : ''
  ].join('');
  return `
    <div class="recipe-block">
      <div class="recipe-ings">${ing}</div>
      ${benchNames ? `<div class="recipe-benches">${benchNames}</div>` : ''}
      ${meta ? `<div class="recipe-meta">${meta}</div>` : ''}
    </div>`;
}

export async function openItemModal(id) {
  const el = ensureModal();
  const body = el.querySelector('.item-modal-body');
  body.innerHTML = `<p class="item-modal-loading">${esc(t('site.loading'))}</p>`;
  el.hidden = false;
  const [items, meta, recipes, benches, sets] = await Promise.all([
    loadIndex('items'), loadData('meta'), loadData('recipes'), loadData('benches'), loadIndex('armor-sets')
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
    ${own.length ? `<h3>${esc(t('items.howToCraft'))}</h3>${own.map((r) => recipeBlock(r, items, benches)).join('')}` : ''}
    ${usedIn.length ? `<h3>${esc(t('items.usedIn'))}</h3><div class="used-in">${usedIn.map((r) => ingredientChip(items, r.item, 0)).join('')}</div>` : ''}
  `;
  el.querySelector('.item-modal-close').setAttribute('aria-label', t('common.close'));
}

window.openItemModal = openItemModal;
