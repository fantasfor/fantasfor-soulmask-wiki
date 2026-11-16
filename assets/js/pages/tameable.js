// Animais domesticáveis: montarias e animais de criação.
// Dados: assets/data/tameable.json (domesticação, cercado e produção, regiões — tools/build_guides.py build_tameable)
//      + assets/data/creatures.json (nome, foto, habitat, mapas e o abate em "loot", o mesmo banco do Mapa e de Criaturas).
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, fmtNum, ingredientChip, openItemModal, L, attrName } from '../data.js';

// atributos base (creatures.json -> stats.base, nível 1); ordem de exibição
const STAT_ORDER = ['MaxHealth', 'Attack', 'Defense', 'MaxTiLi', 'TiLiRecover', 'HealthRecover', 'MaxFuZhong', 'SpeedRate',
  'AttackSpeed', 'Crit', 'CritDef', 'MaxTenacity', 'MaxHuXi', 'MaxFood', 'MaxWater', 'HanKang', 'YanKang', 'DuKang', 'FuKang'];
const FRACTION = new Set(['Crit', 'CritDef']);          // 0.05 = 5%
const MULTIPLIER = new Set(['SpeedRate', 'AttackSpeed']); // 1 = normal (100%)

const MAP_KEY = { main: 'map.mapMain', dlc: 'map.mapDlc' };
// material da faca de esquartejar (BP_DamageType_ChopKnife_<material>)
const KNIFE = { Stone: 'tame.knife.Stone', Bone: 'tame.knife.Bone', Bronze: 'tame.knife.Bronze', BlackIron: 'tame.knife.BlackIron', Alloy: 'tame.knife.Alloy' };

// segundos -> "30 min" / "1 h" / "1 h 30 min"
function every(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return t('farming.hm', { h, m });
  if (h) return t('farming.h', { h });
  return t('common.minutes', { n: m });
}

// linha de bolsa [item, mín, máx, chance do grupo %, chance no grupo %, grupo, condição] -> {id, q, c}
const rowOf = (r) => ({ id: r[0], q: [r[1], r[2]], c: Math.round((r[3] || 0) * (r[4] || 0)) / 100 });

export async function initTameablePage(root, params) {
  const search = root.querySelector('#db-search');
  const catSel = root.querySelector('#tame-cat');
  const mapSel = root.querySelector('#tame-map');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let list = [];
  let creatures;
  let items;
  let meta = {};
  try {
    [list, creatures, items, meta] = await Promise.all([loadData('tameable'), loadIndex('creatures'), loadIndex('items'), loadData('meta').catch(() => ({}))]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  // junta a ficha de domesticação com o banco de criaturas (só os que existem nos dois)
  const animals = list.map((a) => ({ ...a, c: creatures.get(a.id) })).filter((a) => a.c);
  if (params.get('q')) search.value = params.get('q');
  if (params.get('cat')) catSel.value = params.get('cat');
  if (params.get('map')) mapSel.value = params.get('map');

  const unconfirmed = `<span class="tame-unconfirmed">${esc(t('tame.unconfirmed'))}</span>`;
  const chip = (id, n) => (items.has(id) ? ingredientChip(items, id, n) : '');
  const qty = (q) => (q[0] === q[1] ? `${q[0]}` : `${q[0]}–${q[1]}`);

  function lootHtml(c) {
    const loot = c.loot;
    const rows = [...(loot?.harvest?.rows || []), ...(loot?.extra?.rows || [])].map(rowOf).filter((r) => items.has(r.id));
    if (!rows.length) return `<p class="tame-none">${unconfirmed}</p>`;
    return `<ul class="tame-drops">${rows.map((r) => `<li>${chip(r.id, qty(r.q))}<small>${r.c ? `${esc(fmtNum(r.c, r.c < 10 ? 1 : 0))}%` : ''}</small></li>`).join('')}</ul>
      ${loot.confirmed === false ? `<p class="tame-note">${esc(t('tame.lootGuess'))}</p>` : ''}
      ${loot.toolMult ? `<p class="tame-note">${esc(t('tame.toolMult', { list: Object.entries(loot.toolMult).map(([k, v]) => `${KNIFE[k] ? t(KNIFE[k]) : k} ×${fmtNum(v, 1)}`).join(', ') }))}</p>` : ''}`;
  }

  function prodHtml(a) {
    const prod = a.pen?.prod || [];
    if (!prod.length) return `<p class="tame-none">${esc(a.pen ? t('tame.noProd') : t('tame.noPen'))}</p>`;
    return `<ul class="tame-drops">${prod.map((p) => `<li>${chip(p.id, p.n)}<small>${esc(t('tame.every', { t: every(p.every) }))}${p.max ? ` · ${esc(t('tame.maxStock', { n: p.max }))}` : ''}</small></li>`).join('')}</ul>`;
  }

  function statsHtml(c) {
    const s = c.stats;
    if (!s?.base) return `<p class="tame-none">${unconfirmed}</p>`;
    const keys = [...STAT_ORDER.filter((k) => k in s.base), ...Object.keys(s.base).filter((k) => !STAT_ORDER.includes(k))];
    const fmt = (k, v) => (FRACTION.has(k) ? `${fmtNum(v * 100, 1)}%` : MULTIPLIER.has(k) ? `${fmtNum(v * 100, 0)}%` : fmtNum(v, v % 1 ? 2 : 0));
    const name = (k) => (k === 'MaxHuXi' ? t('creatures.stat.MaxHuXi') : attrName(meta, k));
    return `<dl class="tame-facts tame-stats">
        ${keys.map((k) => `<div><dt>${esc(name(k))}</dt><dd>${esc(fmt(k, s.base[k]))}</dd></div>`).join('')}
        ${s.slots ? `<div><dt>${esc(t('creatures.stat.slots'))}</dt><dd>${esc(s.slots)}</dd></div>` : ''}
      </dl>
      <p class="tame-note">${esc(t('creatures.statsNote'))}</p>
      ${s.confirmed === false ? `<p class="tame-note">${esc(t('creatures.statsUnconfirmed'))}</p>` : ''}`;
  }

  const yesNo = (v) => (v === true ? esc(t('tame.yes')) : v === false ? esc(t('tame.no')) : unconfirmed);

  function card(a) {
    const c = a.c;
    const maps = (c.maps || []).map((m) => t(MAP_KEY[m] || m));
    const regs = (a.regions || []).filter((r) => !mapSel.value || r.map === mapSel.value).slice(0, 5);
    const foods = (a.foods || []).filter((id) => items.has(id));
    const capture = pick(c, 'capture');
    return `
      <article class="item-card tame-card">
        <header class="tame-head">
          ${c.photo ? `<img class="tame-photo" src="${esc(c.photo)}" alt="${esc(pick(c, 'name'))}" loading="lazy" width="96" height="96" />` : ''}
          <div>
            <h3 class="item-card-title">${esc(pick(c, 'name'))}${c.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>
            <div class="tame-cats">${a.cats.map((k) => `<span class="tame-cat tame-cat-${k}">${esc(t(`tame.cat.${k}`))}</span>`).join('')}</div>
          </div>
        </header>
        ${c.maps?.length ? `<a class="db-map-btn" href="#mapa?map=${esc(mapSel.value && c.maps.includes(mapSel.value) ? mapSel.value : c.maps[0])}&creature=${encodeURIComponent(c.id)}">${esc(t('creatures.seeOnMap'))}</a>` : ''}
        ${topic(a, 'where', t('tame.where'), `<dl class="tame-facts">
          <div><dt>${esc(t('tame.maps'))}</dt><dd>${maps.length ? esc(maps.join(', ')) : unconfirmed}</dd></div>
          ${regs.length ? `<div><dt>${esc(t('tame.regions'))}</dt><dd>${esc(regs.map((r) => L({ pt: r.name_pt, en: r.name_en })).join(', '))}</dd></div>` : ''}
          ${pick(c, 'habitat') ? `<div><dt>${esc(t('creatures.habitat'))}</dt><dd>${esc(pick(c, 'habitat'))}</dd></div>` : ''}
        </dl>`)}
        ${topic(a, 'prod', t('tame.produces'), `${a.pen && pick(a.pen, 'name') ? `<p class="tame-sub">${esc(pick(a.pen, 'name'))}${a.pen.max ? ` (${esc(t('tame.penMax', { n: a.pen.max }))})` : ''}</p>` : ''}${prodHtml(a)}`)}
        ${topic(a, 'loot', t('tame.slaughter'), lootHtml(c))}
        ${topic(a, 'tame', t('tame.taming'), `
          <div class="tame-gear">
            <div><span>${esc(t('tame.trap'))}</span>${(a.traps || []).map((tr) => (tr.item && items.has(tr.item) ? chip(tr.item, '') : `<em>${esc(L(tr))}</em>`)).join('') || (capture ? esc(capture) : unconfirmed)}</div>
            ${a.saddle ? `<div><span>${esc(t('tame.saddle'))}</span>${chip(a.saddle, '') || unconfirmed}</div>` : ''}
            ${a.pen?.item ? `<div><span>${esc(t('tame.pen'))}</span>${chip(a.pen.item, '') || esc(pick(a.pen, 'name'))}</div>` : ''}
          </div>
          <dl class="tame-facts">
            <div><dt>${esc(t('tame.fight'))}</dt><dd>${yesNo(a.fight)}</dd></div>
          </dl>`)}
        ${topic(a, 'stats', t('creatures.statsTitle'), statsHtml(c))}
        ${foods.length ? topic(a, 'foods', t('tame.foods'), `<div class="tame-foods">${foods.map((id) => chip(id, '')).join('')}</div>`) : ''}
      </article>`;
  }

  // cada tópico começa fechado, com "Mostrar mais" (mesmo estilo da página Chefes); lembra os que a pessoa abriu
  const opened = new Set();
  function topic(a, key, title, body) {
    const id = `${a.id}:${key}`;
    return `<details class="boss-more tame-topic" data-topic="${esc(id)}"${opened.has(id) ? ' open' : ''}>
      <summary><strong>${esc(title)}</strong><span class="boss-more-on">${esc(t('bosses.more'))}</span><span class="boss-more-off">${esc(t('bosses.less'))}</span></summary>
      <div class="tame-topic-body">${body}</div>
    </details>`;
  }
  container.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('tame-topic')) return;
    if (d.open) opened.add(d.dataset.topic); else opened.delete(d.dataset.topic);
  }, true);

  // texto de busca: nome, habitat e o nome dos recursos
  const hay = (a) => normalize([a.c.name_pt, a.c.name_en, a.c.habitat_pt, a.c.habitat_en,
    ...(a.regions || []).flatMap((r) => [r.name_pt, r.name_en]),
    ...(a.pen?.prod || []).flatMap((p) => { const it = items.get(p.id); return it ? [it.name_pt, it.name_en] : []; })].join(' '));

  function render() {
    const q = normalize(search.value);
    const cat = catSel.value;
    const map = mapSel.value;
    const shown = animals.filter((a) => (!cat || a.cats.includes(cat)) && (!map || (a.c.maps || []).includes(map)) && (!q || hay(a).includes(q)))
      .sort((x, y) => pick(x.c, 'name').localeCompare(pick(y.c, 'name')));
    count.textContent = tCount('tame.count', shown.length);
    container.innerHTML = shown.length ? shown.map(card).join('') : `<div class="items-no-results">${esc(t('tame.none'))}</div>`;
  }
  search.addEventListener('input', render);
  catSel.addEventListener('change', render);
  mapSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink);
  });
  render();
}
