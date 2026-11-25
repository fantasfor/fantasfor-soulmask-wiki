// Domesticáveis e montarias: lista de animais à esquerda e painel do animal escolhido à direita.
// Dados: assets/data/tameable.json (domesticação, cercado e produção, regiões, porte, dieta, velocidades,
//        passageiros, bolsa e efeito de cada comida — tools/build_guides.py build_tameable + enrich_tameable)
//      + assets/data/creatures.json (nome, foto, descrição, habitat, mapas, atributos base e o abate em "loot",
//        o mesmo banco do Mapa e de Criaturas).
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, fmtNum, ingredientChip, openItemModal, L, attrName, iconImg } from '../data.js';

// atributos base (creatures.json -> stats.base, nível 1); ordem de exibição
const STAT_ORDER = ['MaxHealth', 'Attack', 'Defense', 'MaxTiLi', 'TiLiRecover', 'HealthRecover', 'MaxFuZhong', 'SpeedRate',
  'AttackSpeed', 'Crit', 'CritDef', 'MaxTenacity', 'MaxHuXi', 'MaxFood', 'MaxWater', 'HanKang', 'YanKang', 'DuKang', 'FuKang'];
const FRACTION = new Set(['Crit', 'CritDef']);          // 0.05 = 5%
const MULTIPLIER = new Set(['SpeedRate', 'AttackSpeed']); // 1 = normal (100%)

const MAP_KEY = { main: 'map.mapMain', dlc: 'map.mapDlc' };
// material da faca de esquartejar (BP_DamageType_ChopKnife_<material>)
const KNIFE = { Stone: 'tame.knife.Stone', Bone: 'tame.knife.Bone', Bronze: 'tame.knife.Bronze', BlackIron: 'tame.knife.BlackIron', Alloy: 'tame.knife.Alloy' };
const FOODS_SHOWN = 12;   // comidas visíveis antes do "Mostrar mais"

// ícones simples (traço branco, no estilo dos ícones do jogo) para o que o jogo não tem ícone
const SVG = {
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/><path d="M4 17h2M18 17h2M12 9V7"/>',
  stamina: '<path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z"/>',
  seats: '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M3.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5M11.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5"/>',
  carry: '<path d="M6 8h12l-1.5 12h-9L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  bag: '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 10h16M10 13h4"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10"/><path d="M16 3c-2 2-2 6 0 8v10"/>',
  trap: '<path d="M4 20h16M6 20l6-14 6 14"/><path d="M9 13h6"/>',
  pin: '<path d="M12 21s-6-6.5-6-11a6 6 0 0 1 12 0c0 4.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'
};
const icon = (k) => `<svg class="tame-ico" viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;

// segundos -> "30 min" / "1 h" / "1 h 30 min"
function every(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return t('farming.hm', { h, m });
  if (h) return t('farming.h', { h });
  return t('common.minutes', { n: m });
}

// cm/s (unidade do jogo) -> km/h
const kmh = (cms) => fmtNum(cms * 0.036, 1);

// linha de bolsa [item, mín, máx, chance do grupo %, chance no grupo %, grupo, condição] -> {id, q, c}
const rowOf = (r) => ({ id: r[0], q: [r[1], r[2]], c: Math.round((r[3] || 0) * (r[4] || 0)) / 100 });

export async function initTameablePage(root, params) {
  const search = root.querySelector('#db-search');
  const catSel = root.querySelector('#tame-cat');
  const mapSel = root.querySelector('#tame-map');
  const count = root.querySelector('#db-count');
  const listEl = root.querySelector('#tame-list');
  const pickEl = root.querySelector('#tame-pick');
  const panel = root.querySelector('#db-container');
  let list = [];
  let creatures;
  let items;
  let meta = {};
  try {
    [list, creatures, items, meta] = await Promise.all([loadData('tameable'), loadIndex('creatures'), loadIndex('items'), loadData('meta').catch(() => ({}))]);
  } catch (e) {
    panel.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  // junta a ficha de domesticação com o banco de criaturas (só os que existem nos dois)
  const animals = list.map((a) => ({ ...a, c: creatures.get(a.id) })).filter((a) => a.c);
  if (params.get('q')) search.value = params.get('q');
  let cat = ['mount', 'farm', 'other'].includes(params.get('cat')) ? params.get('cat') : '';
  // mapa escolhido nos botões ('' = os dois mapas)
  let mapPick = ['main', 'dlc'].includes(params.get('map')) ? params.get('map') : '';
  let current = params.get('animal') || null;

  // maiores valores entre as montarias (tamanho das barras)
  const mounts = animals.filter((a) => a.cats.includes('mount'));
  const maxRun = Math.max(1, ...mounts.map((a) => a.move?.run || 0));
  const maxStamina = Math.max(1, ...mounts.map((a) => a.c.stats?.base?.MaxTiLi || 0));

  const unconfirmed = `<span class="tame-unconfirmed">${esc(t('tame.unconfirmed'))}</span>`;
  const chip = (id, n) => (items.has(id) ? ingredientChip(items, id, n) : '');
  const qty = (q) => (q[0] === q[1] ? `${q[0]}` : `${q[0]}–${q[1]}`);

  // selos: categoria, dieta e DLC
  function badges(a) {
    return [
      ...a.cats.map((k) => `<span class="tame-cat tame-cat-${k}">${esc(t(`tame.cat.${k}`))}</span>`),
      a.diet ? `<span class="tame-cat tame-diet-${a.diet}">${esc(t(`tame.diet.${a.diet}`))}</span>` : '',
      a.c.dlc ? '<span class="dlc-badge">DLC</span>' : ''
    ].join('');
  }

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

  // bloco "Status da montaria": barras (velocidade, vigor) e caixas (passageiros, carga, bolsa)
  function mountHtml(a) {
    if (!a.cats.includes('mount')) return '';
    const base = a.c.stats?.base || {};
    const bar = (key, label, value, shown, max, sub) => `
      <div class="tame-bar">
        <div class="tame-bar-head">${icon(key)}<span>${esc(label)}</span><strong>${shown}</strong></div>
        <div class="tame-bar-track"><span style="width:${Math.max(4, Math.round((value / max) * 100))}%"></span></div>
        ${sub ? `<small>${sub}</small>` : ''}
      </div>`;
    const box = (key, label, value, sub) => `
      <div class="tame-box">${icon(key)}<span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const mv = a.move;
    const speedSub = mv ? esc([mv.walk && t('tame.walk', { v: kmh(mv.walk) }), mv.trot && t('tame.trot', { v: kmh(mv.trot) })].filter(Boolean).join(' · ')) : '';
    const bars = [
      mv?.run ? bar('speed', t('tame.speed'), mv.run, esc(t('tame.kmh', { v: kmh(mv.run) })), maxRun, speedSub) : '',
      base.MaxTiLi ? bar('stamina', t('tame.stamina'), base.MaxTiLi, esc(fmtNum(base.MaxTiLi, 0)), maxStamina, '') : ''
    ].join('');
    const boxes = [
      box('seats', t('tame.seats'), a.seats ? esc(a.seats) : esc(t('tame.seatsNone')), a.seats && a.seatsSaddle ? esc(t('tame.seatsSaddle')) : ''),
      base.MaxFuZhong ? box('carry', t('tame.carry'), esc(fmtNum(base.MaxFuZhong, 0)), '') : '',
      a.bag ? box('bag', t('tame.bag'), esc(a.bag), '') : ''
    ].join('');
    return `<section class="tame-block">
        <h3>${esc(t('tame.mountStats'))}</h3>
        <div class="tame-bars">${bars || `<p class="tame-none">${unconfirmed}</p>`}</div>
        <div class="tame-boxes">${boxes}</div>
        <p class="tame-note">${esc(t('tame.mountNote'))}</p>
      </section>`;
  }

  // bloco "Alimentação": um card por comida (ícone, nome e efeito no animal)
  function foodsHtml(a) {
    const foods = (a.foods || []).filter((id) => items.has(id));
    if (!foods.length) return '';
    const card = (id) => {
      const it = items.get(id);
      const f = a.foodInfo?.[id] || {};
      const fx = [
        f.v ? t('tame.foodValue', { n: f.v }) : '',
        f.grow ? t('tame.foodGrow', { p: fmtNum(f.grow[0] * 100, 0), t: every(f.grow[1]) }) : '',
        f.rad ? t('tame.foodRad') : '',
        f.tox ? t('tame.foodTox') : ''
      ].filter(Boolean);
      return `<button type="button" class="tame-food" data-item-link="${esc(id)}">
          ${iconImg(it, 'tame-food-icon', '')}
          <span class="tame-food-text"><span class="tame-food-name">${esc(pick(it, 'name'))}</span>
          ${fx.length ? `<small>${esc(fx.join(' · '))}</small>` : ''}</span>
        </button>`;
    };
    const first = foods.slice(0, FOODS_SHOWN).map(card).join('');
    const rest = foods.slice(FOODS_SHOWN);
    return `<section class="tame-block">
        <h3>${icon('food')}${esc(t('tame.feeding'))}</h3>
        <p class="tame-note">${esc(t('tame.feedNote'))}</p>
        <div class="tame-food-grid">${first}</div>
        ${rest.length ? topic(a, 'foods', t('tame.moreFoods', { n: rest.length }), `<div class="tame-food-grid">${rest.map(card).join('')}</div>`) : ''}
      </section>`;
  }

  function panelHtml(a) {
    const c = a.c;
    const maps = (c.maps || []).map((m) => t(MAP_KEY[m] || m));
    const regs = (a.regions || []).filter((r) => !mapPick || r.map === mapPick).slice(0, 6);
    const capture = pick(c, 'capture');
    const mapLink = c.maps?.length ? `<a class="db-map-btn" href="#mapa?map=${esc(mapPick && c.maps.includes(mapPick) ? mapPick : c.maps[0])}&creature=${encodeURIComponent(c.id)}">${esc(t('creatures.seeOnMap'))}</a>` : '';
    return `
      <header class="tame-panel-head">
        ${c.photo ? `<img class="tame-photo" src="${esc(c.photo)}" alt="${esc(pick(c, 'name'))}" width="120" height="120" />` : ''}
        <div>
          <h2>${esc(pick(c, 'name'))}</h2>
          <div class="tame-cats">${badges(a)}</div>
          ${pick(c, 'desc') ? `<p class="tame-desc">${esc(pick(c, 'desc'))}</p>` : ''}
          ${pick(c, 'temper') ? `<p class="tame-sub">${esc(t('tame.temper'))}: ${esc(pick(c, 'temper'))}</p>` : ''}
        </div>
      </header>
      ${mountHtml(a)}
      ${foodsHtml(a)}
      <div class="tame-cols">
        <section class="tame-block">
          <h3>${icon('trap')}${esc(t('tame.howTo'))}</h3>
          <div class="tame-gear">
            <div><span>${esc(t('tame.trap'))}</span>${(a.traps || []).map((tr) => (tr.item && items.has(tr.item) ? chip(tr.item, '') : `<em>${esc(L(tr))}</em>`)).join('') || (capture ? esc(capture) : unconfirmed)}</div>
            ${a.saddle ? `<div><span>${esc(t('tame.saddle'))}</span>${chip(a.saddle, '') || unconfirmed}</div>` : ''}
            ${a.pen?.item ? `<div><span>${esc(t('tame.pen'))}</span>${chip(a.pen.item, '') || esc(pick(a.pen, 'name'))}</div>` : ''}
          </div>
          <dl class="tame-facts">
            <div><dt>${esc(t('tame.fight'))}</dt><dd>${yesNo(a.fight)}</dd></div>
          </dl>
        </section>
        <section class="tame-block">
          <h3>${icon('pin')}${esc(t('tame.whereFind'))}</h3>
          <dl class="tame-facts">
            <div><dt>${esc(t('tame.maps'))}</dt><dd>${maps.length ? esc(maps.join(', ')) : unconfirmed}</dd></div>
            ${regs.length ? `<div><dt>${esc(t('tame.regions'))}</dt><dd>${esc(regs.map((r) => L({ pt: r.name_pt, en: r.name_en })).join(', '))}</dd></div>` : ''}
            ${pick(c, 'habitat') ? `<div><dt>${esc(t('creatures.habitat'))}</dt><dd>${esc(pick(c, 'habitat'))}</dd></div>` : ''}
            ${pick(c, 'active') ? `<div><dt>${esc(t('tame.active'))}</dt><dd>${esc(pick(c, 'active'))}</dd></div>` : ''}
          </dl>
          ${mapLink}
        </section>
      </div>
      ${a.pen || a.cats.includes('farm') ? topic(a, 'prod', t('tame.produces'), `${a.pen && pick(a.pen, 'name') ? `<p class="tame-sub">${esc(pick(a.pen, 'name'))}${a.pen.max ? ` (${esc(t('tame.penMax', { n: a.pen.max }))})` : ''}</p>` : ''}${prodHtml(a)}`) : ''}
      ${topic(a, 'loot', t('tame.slaughter'), lootHtml(c))}
      ${topic(a, 'stats', t('creatures.statsTitle'), statsHtml(c))}`;
  }

  // tópicos que começam fechados, com "Mostrar mais" (mesmo estilo da página Chefes); lembra os que a pessoa abriu
  const opened = new Set();
  function topic(a, key, title, body) {
    const id = `${a.id}:${key}`;
    return `<details class="boss-more tame-topic" data-topic="${esc(id)}"${opened.has(id) ? ' open' : ''}>
      <summary><strong>${esc(title)}</strong><span class="boss-more-on">${esc(t('bosses.more'))}</span><span class="boss-more-off">${esc(t('bosses.less'))}</span></summary>
      <div class="tame-topic-body">${body}</div>
    </details>`;
  }
  panel.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('tame-topic')) return;
    if (d.open) opened.add(d.dataset.topic); else opened.delete(d.dataset.topic);
  }, true);

  // texto de busca: nome, habitat, regiões e o nome dos recursos
  const hay = (a) => normalize([a.c.name_pt, a.c.name_en, a.c.habitat_pt, a.c.habitat_en,
    ...(a.regions || []).flatMap((r) => [r.name_pt, r.name_en]),
    ...(a.pen?.prod || []).flatMap((p) => { const it = items.get(p.id); return it ? [it.name_pt, it.name_en] : []; })].join(' '));

  let shown = [];
  function renderPanel() {
    const a = shown.find((x) => x.id === current);
    panel.innerHTML = a ? panelHtml(a) : `<div class="items-no-results">${esc(t('tame.none'))}</div>`;
    listEl.querySelectorAll('[data-animal]').forEach((b) => {
      const on = b.dataset.animal === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    pickEl.value = current || '';
  }

  function render() {
    const q = normalize(search.value);
    const map = mapPick;
    mapSel.querySelectorAll('[data-map]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.map === mapPick)));
    catSel.querySelectorAll('[data-cat]').forEach((b) => {
      const on = b.dataset.cat === cat;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    shown = animals.filter((a) => (!cat || a.cats.includes(cat)) && (!map || (a.c.maps || []).includes(map)) && (!q || hay(a).includes(q)))
      .sort((x, y) => pick(x.c, 'name').localeCompare(pick(y.c, 'name')));
    count.textContent = tCount('tame.count', shown.length);
    if (!shown.some((a) => a.id === current)) current = shown[0]?.id || null;
    listEl.innerHTML = shown.map((a) => `<li><button type="button" class="tame-item" role="option" data-animal="${esc(a.id)}">
        ${a.c.photo ? `<img src="${esc(a.c.photo)}" alt="" loading="lazy" width="48" height="48" />` : '<span class="tame-item-noimg"></span>'}
        <span class="tame-item-text"><span class="tame-item-name">${esc(pick(a.c, 'name'))}</span><span class="tame-cats">${badges(a)}</span></span>
      </button></li>`).join('');
    pickEl.innerHTML = shown.map((a) => `<option value="${esc(a.id)}">${esc(pick(a.c, 'name'))}</option>`).join('');
    renderPanel();
  }

  function choose(id) {
    if (!id || id === current) return;
    current = id;
    history.replaceState(null, '', `#animais?animal=${encodeURIComponent(id)}`);
    renderPanel();
    // no celular a lista vira seletor em cima: leva a vista ao começo do painel
    if (window.matchMedia('(max-width: 760px)').matches) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  search.addEventListener('input', render);
  catSel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b || b.dataset.cat === cat) return;
    cat = b.dataset.cat;
    render();
  });
  // clicar no mapa escolhido de novo volta a mostrar os dois
  mapSel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-map]');
    if (!b) return;
    mapPick = mapPick === b.dataset.map ? '' : b.dataset.map;
    render();
  });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-animal]');
    if (b) choose(b.dataset.animal);
  });
  pickEl.addEventListener('change', () => choose(pickEl.value));
  panel.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink);
  });
  render();
}
