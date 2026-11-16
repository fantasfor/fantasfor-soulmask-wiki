import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, renderChunked, ingredientChip, openItemModal, attrName } from '../data.js';

// atributos base (creatures.json "stats"): os principais sempre à mostra, o resto em "Mostrar mais"
const MAIN_STATS = ['MaxHealth', 'Attack', 'Defense', 'MaxTiLi', 'MaxFuZhong', 'SpeedRate'];
const PCT_STATS = ['Crit', 'CritDef'];
const MULT_STATS = ['SpeedRate', 'AttackSpeed'];

const FIELDS = ['temper', 'habitat', 'active', 'social', 'senses', 'weak', 'drops', 'capture'];

export async function initCreaturesPage(root, params) {
  const search = root.querySelector('#db-search');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let creatures = [];
  let items = new Map();
  let meta = {};
  try {
    [creatures, items, meta] = await Promise.all([loadData('creatures'), loadIndex('items').catch(() => new Map()),
      loadData('meta').catch(() => ({}))]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');

  // "Ver no mapa": abre o Mapa interativo mostrando só onde a criatura nasce (Floresta primeiro, se estiver nos dois)
  const mapLink = (c) => (c.maps?.length
    ? `<a class="db-map-btn" href="#mapa?map=${c.maps.includes('main') ? 'main' : c.maps[0]}&creature=${encodeURIComponent(c.id)}">${esc(t('creatures.seeOnMap'))}</a>` : '');
  // recursos que a criatura dá (itens clicáveis, abrem a janela do item)
  // vêm do banco único (creatures.json "loot", o mesmo que o Mapa interativo usa)
  const lootIds = (part) => [...new Set((part?.rows || []).map((r) => r[0]).filter((id) => items.has(id)))];
  const dropIdsOf = (c) => [...new Set([...lootIds(c.loot?.harvest), ...lootIds(c.loot?.extra)])];
  const chipList = (title, ids) => (ids.length ? `<div class="creature-drops"><span class="creature-drops-title">${esc(title)}</span>
      <div class="creature-drops-list">${ids.map((id) => ingredientChip(items, id)).join('')}</div></div>` : '');
  const dropChips = (c) => {
    if (!c.loot) return '';
    const harvest = lootIds(c.loot.harvest);
    const extra = lootIds(c.loot.extra).filter((id) => !harvest.includes(id));
    return (c.loot.confirmed ? '' : `<p class="creature-unconfirmed">${esc(t('map.cr.unconfirmed'))}</p>`)
      + chipList(t('map.cr.harvest'), harvest) + chipList(t('map.cr.extra'), extra);
  };

  const num = (v, d = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
  const statVal = (k, v) => (PCT_STATS.includes(k) ? `${num(v * 100, 1)}%` : MULT_STATS.includes(k) ? `×${num(v)}` : num(v));
  const statLabel = (k) => { const n = attrName(meta, k); return n === k ? t(`creatures.stat.${k}`) : n; };
  const statRow = ([k, v]) => `<div><dt>${esc(statLabel(k))}</dt><dd>${esc(statVal(k, v))}</dd></div>`;
  function statsHtml(c) {
    const base = c.stats?.base;
    if (!base && !c.stats?.slots) return '';
    const all = Object.entries(base || {});
    const main = MAIN_STATS.filter((k) => base?.[k] != null).map((k) => [k, base[k]]);
    const rest = all.filter(([k]) => !MAIN_STATS.includes(k));
    if (c.stats.slots) rest.push(['slots', c.stats.slots]);
    return `<div class="creature-stats">
      <span class="creature-drops-title">${esc(t('creatures.statsTitle'))}</span>
      ${c.stats.confirmed === false ? `<p class="creature-unconfirmed">${esc(t('creatures.statsUnconfirmed'))}</p>` : ''}
      <dl class="creature-facts creature-stat-grid">${main.map(statRow).join('')}</dl>
      ${rest.length ? `<details class="creature-stats-more"><summary>${esc(t('creatures.statsMore'))}</summary>
        <dl class="creature-facts creature-stat-grid">${rest.map(statRow).join('')}</dl></details>` : ''}
      <p class="creature-stats-note">${esc(t('creatures.statsNote'))}</p>
    </div>`;
  }

  function card(c) {
    return `
      <article class="item-card creature-card">
        ${c.photo ? `<img class="creature-photo" src="${esc(c.photo)}" alt="${esc(pick(c, 'name'))}" loading="lazy" width="256" height="256" />` : ''}
        <h3 class="item-card-title">${esc(pick(c, 'name'))}${c.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>
        ${pick(c, 'desc') ? `<p class="item-card-description">${escLines(pick(c, 'desc'))}</p>` : ''}
        <dl class="creature-facts">
          ${FIELDS.filter((f) => pick(c, f) && !(f === 'drops' && dropIdsOf(c).length)).map((f) => `<div><dt>${esc(t(`creatures.${f}`))}</dt><dd>${esc(pick(c, f))}</dd></div>`).join('')}
        </dl>
        ${statsHtml(c)}
        ${dropChips(c)}
        ${mapLink(c)}
      </article>`;
  }
  const dropText = (c) => dropIdsOf(c).map((id) => { const it = items.get(id); return it ? `${it.name_pt} ${it.name_en}` : ''; }).join(' ');
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
