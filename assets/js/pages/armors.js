import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, statList, iconImg, openItemModal } from '../data.js';

export const SLOTS = ['armor', 'gloves', 'pants', 'boots', 'necklace', 'ring'];
const VARIANT_KEY = 'armors_variant';

export function bonusHtml(meta, set, equipped = 6) {
  return (set.bonuses || []).map((b) => {
    const on = equipped >= b.n;
    return `
      <div class="set-tier ${on ? 'is-active' : 'is-locked'}">
        <strong class="set-tier-label">${esc(t('armors.pieces', { n: b.n }))}</strong>
        ${statList(meta, b.stats)}
        ${pick(b, 'effect') ? `<p class="set-tier-effect">${escLines(pick(b, 'effect'))}</p>` : ''}
      </div>`;
  }).join('');
}

// IDs dos conjuntos (gerados por tools/build_data.py):
// 1xxx = normal, 2xxx = avançado (mesmo chefe = id + 1000), 3xxx = ruínas/Dungeon (sem variação)
const kindOf = (s) => s.kind || (Number(s.id) >= 3000 ? 'dungeon' : Number(s.id) >= 2000 ? 'advanced' : 'normal');

// peças sem conjunto (sem bônus): agrupadas pelo nome interno só para exibir juntas
// tribo (nome interno -> chave de tradução) e tipo de traje de cada peça de tribo
const TRIBES = { YeMan: 'claw', ZhiHui: 'flint', ShenMi: 'fang', TribeE: 'horn', TribeF: 'wolf', Bandits: 'bandits' };
const TRIBE_ORDER = ['claw', 'flint', 'fang', 'horn', 'wolf', 'bandits'];
const CAT_ORDER = ['outfit', 'combat', 'winter', 'daily'];

function looseKey(id) {
  let m = id.match(/^BP_ZB_[A-Za-z]+_YiJi_(\w+)$/);
  if (m) return { kind: 'dungeonLoose', key: `YiJi_${m[1]}` };
  m = id.match(/^BP_EG_(\w+?)_(SH|ZD)_(?:Arm|Body|Foot|Leg)_Lv_(\d)/);
  if (m) return { kind: 'tribe', tribe: TRIBES[m[1]], cat: m[2] === 'ZD' ? 'combat' : 'outfit', lv: Number(m[3]), key: `EG_${m[1]}_${m[2]}_${m[3]}` };
  m = id.match(/^BP_ZB_(YeMan|ZhiHui|ShenMi)_(SH|ZD|YuHan)_Lv(\d)_0\d/);
  if (m) return { kind: 'tribe', tribe: TRIBES[m[1]], cat: { SH: 'outfit', ZD: 'combat', YuHan: 'winter' }[m[2]], lv: Number(m[3]), key: `ZB_${m[1]}_${m[2]}_${m[3]}` };
  m = id.match(/^BP_ZB_(YeMan|ZhiHui|ShenMi)_ZD_(\d)\d$/);
  if (m) return { kind: 'tribe', tribe: TRIBES[m[1]], cat: 'combat', lv: Number(m[2]) + 0.5, key: `ZB_${m[1]}_ZDc_${m[2]}` };
  m = id.match(/^BP_ZB_(YeMan|ZhiHui|ShenMi)_(SH|YH)_\d$/);
  if (m) return { kind: 'tribe', tribe: TRIBES[m[1]], cat: m[2] === 'YH' ? 'winter' : 'daily', lv: 0, key: `ZB_${m[1]}_${m[2]}c` };
  return null;
}
function looseSets(pieces) {
  const groups = new Map();
  [...pieces.values()].filter((p) => !p.set).forEach((p) => {
    const k = looseKey(p.id);
    if (!k) return;
    if (!groups.has(k.key)) groups.set(k.key, { id: `p:${k.key}`, kind: k.kind, tribe: k.tribe, cat: k.cat, lv: k.lv, pieces: {}, bonuses: [] });
    const g = groups.get(k.key);
    if (p.slot && !g.pieces[p.slot]) g.pieces[p.slot] = p.id;
  });
  return [...groups.values()].map((g) => {
    const main = pieces.get(g.pieces.armor) || pieces.get(Object.values(g.pieces)[0]);
    return { ...g, name_pt: main?.name_pt || g.id, name_en: main?.name_en || g.id, icon: main?.icon };
  }).sort((a, b) => a.name_pt.localeCompare(b.name_pt));
}

export async function initArmorsPage(root, params) {
  const list = root.querySelector('#armaduras-list');
  const detail = root.querySelector('#armaduras-detail');
  const cmpPanel = root.querySelector('#armaduras-comparison');
  const cmpGrid = root.querySelector('#armaduras-comparison-grid');
  const cmpToggle = root.querySelector('#armaduras-compare-toggle');
  const cmpClear = root.querySelector('#armaduras-comparison-clear');
  const segButtons = [...root.querySelectorAll('[data-variant]')];

  let sets = [];
  let pieces;
  let meta = {};
  try {
    [sets, pieces, meta] = await Promise.all([loadData('armor-sets'), loadIndex('armor-pieces'), loadData('meta')]);
  } catch (e) {
    list.innerHTML = `<div class="armaduras-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  sets = [...sets, ...looseSets(pieces)];
  const byId = new Map(sets.map((s) => [String(s.id), s]));
  let variant = 'advanced';
  try { variant = localStorage.getItem(VARIANT_KEY) === 'normal' ? 'normal' : 'advanced'; } catch (e) { /* ignora */ }
  let compare = false;
  let chosen = [];
  let current = null;

  // conjunto equivalente na outra versão (normal <-> avançada)
  function counterpart(set, v) {
    const k = kindOf(set);
    if (k === 'dungeon' || k === 'dungeonLoose' || k === 'tribe' || k === v) return set;
    const id = Number(set.id) + (v === 'advanced' ? 1000 : -1000);
    return byId.get(String(id)) || set;
  }

  const visible = () => sets.filter((s) => kindOf(s) === variant || ['dungeon', 'dungeonLoose', 'tribe'].includes(kindOf(s)));

  function renderList() {
    const groups = [
      { key: 'boss', label: t('armors.groupBoss'), items: visible().filter((s) => ['normal', 'advanced'].includes(kindOf(s)) && !s.dlc) },
      { key: 'dlc', label: t('armors.groupDlc'), items: visible().filter((s) => ['normal', 'advanced'].includes(kindOf(s)) && s.dlc) },
      { key: 'ruins', label: t('armors.groupDungeon'), items: visible().filter((s) => ['dungeon', 'dungeonLoose'].includes(kindOf(s))) },
      { key: 'tribe', label: t('armors.groupTribe'), items: visible().filter((s) => kindOf(s) === 'tribe'), fold: true }
    ].filter((g) => g.items.length);
    const isOpen = (g) => !g.fold || g.items.some((s) => current && String(s.id) === String(current.id));
    list.innerHTML = groups.map((g) => `
      ${g.fold ? `<details class="arm-fold" ${isOpen(g) ? 'open' : ''}><summary class="arm-group-title">${esc(g.label)} <small>${g.items.length}</small></summary>` : `<h2 class="arm-group-title">${esc(g.label)}</h2>`}
      ${g.key === 'tribe' ? tribeBody(g.items) : g.key === 'ruins' ? ruinsBody(g.items) : itemsList(g.items)}${g.fold ? '</details>' : ''}`).join('');
  }

  function itemHtml(s) {
    const isCur = !compare && current && String(current.id) === String(s.id);
    const isCmp = compare && chosen.some((c) => String(c.id) === String(s.id));
    return `<li><button type="button" class="arm-item${isCur || isCmp ? ' is-selected' : ''}" data-set-id="${esc(s.id)}" aria-pressed="${isCur || isCmp}">
      <img src="${esc(s.icon || '')}" alt="" loading="lazy" width="44" height="44" />
      <span class="arm-item-name">${esc(pick(s, 'name'))}</span>
      ${s.dlc ? '<span class="dlc-badge">DLC</span>' : ''}
    </button></li>`;
  }
  const itemsList = (items) => `<ul class="arm-group">${items.map(itemHtml).join('')}</ul>`;

  // ruínas: conjuntos com bônus e peças sem conjunto, no mesmo grupo
  function ruinsBody(items) {
    const withSet = items.filter((s) => kindOf(s) === 'dungeon');
    const noSet = items.filter((s) => kindOf(s) === 'dungeonLoose');
    return `<h4 class="arm-cat">${esc(t('armors.subWithSet'))}</h4>${itemsList(withSet)}`
      + (noSet.length ? `<h4 class="arm-cat">${esc(t('armors.subNoSet'))}</h4>${itemsList(noSet)}` : '');
  }

  // tribos: uma seção por tribo e, dentro dela, por tipo de traje (do básico ao especial)
  function tribeBody(items) {
    return TRIBE_ORDER.map((tribe) => {
      const mine = items.filter((s) => s.tribe === tribe);
      if (!mine.length) return '';
      const open = mine.some((s) => current && String(s.id) === String(current.id));
      return `<details class="arm-subfold" ${open ? 'open' : ''}>
        <summary>${esc(t(`armors.tribe.${tribe}`))} <small>${mine.length}</small></summary>
        ${CAT_ORDER.map((cat) => {
          const list = mine.filter((s) => s.cat === cat).sort((a, b) => (a.lv || 0) - (b.lv || 0));
          return list.length ? `<h4 class="arm-cat">${esc(t(`armors.cat.${cat}`))}</h4>${itemsList(list)}` : '';
        }).join('')}
      </details>`;
    }).join('');
  }

  function piecesTable(set) {
    return `<ul class="arm-pieces">${SLOTS.map((slot) => {
      const p = pieces.get(set.pieces?.[slot]);
      if (!p) return '';
      return `<li class="arm-piece">
        <button type="button" class="arm-piece-btn" data-item-id="${esc(p.id)}" title="${esc(t('common.details'))}">
          ${iconImg(p, 'arm-piece-icon', '')}
          <span class="arm-piece-text">
            <span class="arm-piece-slot">${esc(t(`builder.slot.${slot}`))}</span>
            <span class="arm-piece-name">${esc(pick(p, 'name'))}</span>
          </span>
        </button>
        ${statList(meta, p.stats)}
      </li>`;
    }).join('')}</ul>`;
  }

  function kindLabel(set) {
    return t(`armors.kind.${kindOf(set)}`);
  }

  function renderDetail() {
    const set = current;
    if (!set) { detail.innerHTML = ''; return; }
    detail.innerHTML = `
      <header class="arm-detail-head">
        <img class="arm-detail-icon" src="${esc(set.icon || '')}" alt="" />
        <div>
          <span class="arm-kind arm-kind-${kindOf(set)}">${esc(kindLabel(set))}</span>
          <h2>${esc(pick(set, 'name'))} ${set.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</h2>
          <p class="arm-desc">${escLines(pick(set, 'desc') || t('armors.noDescription'))}</p>
        </div>
      </header>
      <h3 class="arm-section-title">${esc(t('armors.setAttributes'))}</h3>
      <div class="arm-bonuses">${bonusHtml(meta, set) || `<p class="arm-desc">${esc(t('armors.noSetBonus'))}</p>`}</div>
      <h3 class="arm-section-title">${esc(t('armors.setPieces'))}</h3>
      ${piecesTable(set)}`;
  }

  function renderCompare() {
    cmpPanel.hidden = !compare;
    detail.hidden = compare;
    cmpToggle.setAttribute('aria-pressed', String(compare));
    cmpToggle.classList.toggle('is-active', compare);
    cmpGrid.innerHTML = chosen.length ? chosen.map((set) => `
      <article class="arm-cmp-card">
        <header class="arm-detail-head">
          <img class="arm-detail-icon" src="${esc(set.icon || '')}" alt="" />
          <div>
            <span class="arm-kind arm-kind-${kindOf(set)}">${esc(kindLabel(set))}</span>
            <h3>${esc(pick(set, 'name'))}</h3>
          </div>
        </header>
        <div class="arm-bonuses">${bonusHtml(meta, set)}</div>
      </article>`).join('') : `<p class="arm-subtitle">${esc(t('armors.hint'))}</p>`;
  }

  function render() {
    segButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.variant === variant)));
    renderList();
    renderDetail();
    renderCompare();
  }

  list.addEventListener('click', (e) => {
    const c = e.target.closest('[data-set-id]');
    if (!c) return;
    const set = byId.get(c.dataset.setId);
    if (!set) return;
    if (compare) {
      const i = chosen.indexOf(set);
      if (i >= 0) chosen.splice(i, 1); else { if (chosen.length >= 2) chosen.shift(); chosen.push(set); }
    } else {
      current = set;
      if (window.innerWidth < 900) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    render();
  });
  segButtons.forEach((b) => b.addEventListener('click', () => {
    variant = b.dataset.variant;
    try { localStorage.setItem(VARIANT_KEY, variant); } catch (e) { /* ignora */ }
    if (current) current = counterpart(current, variant);
    chosen = chosen.map((s) => counterpart(s, variant));
    render();
  }));
  detail.addEventListener('click', (e) => {
    const p = e.target.closest('[data-item-id]');
    if (p) openItemModal(p.dataset.itemId);
  });
  cmpToggle.addEventListener('click', () => { compare = !compare; render(); });
  cmpClear.addEventListener('click', () => { chosen = []; render(); });

  const wanted = byId.get(params.get('set') || '');
  if (wanted && kindOf(wanted) !== 'dungeon') variant = kindOf(wanted);
  current = wanted || visible()[0];
  render();
}
