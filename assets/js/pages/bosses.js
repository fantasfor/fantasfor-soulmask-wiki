// Chefes: guardiões das pirâmides (assets/data/bosses.json, gerado dos altares BP_JianZhu_Summon_* e de DT_ShengWuCaiJiBao)
// + líderes de tribo, líderes saqueadores e chefes de ruína (assets/data/leaders.json, dos pontos do mapa do jogo)
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, fmtNum, ingredientChip, openItemModal } from '../data.js';

const TIER_CLASS = ['fierce', 'berserk', 'doom'];
// chefes com foto de fundo em assets/img/bosses/bg_<id>.webp
const BG = new Set(['JianChiHu', 'JinGangYuan', 'JuFengJiu', 'MengMaXiang', 'MoGuiWa']);

function dropList(items, list) {
  return `<div class="farming-harvest">${list.map((d) => `<span class="farming-drop">${ingredientChip(items, d.id, d.n[0] === d.n[1] ? d.n[0] : `${d.n[0]}–${d.n[1]}`)}${d.chance < 100 ? `<small>${esc(d.chance)}%</small>` : ''}</span>`).join('')}</div>`;
}

export async function initBossesPage(root, params) {
  const search = root.querySelector('#db-search');
  const filter = root.querySelector('#bosses-filter');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  const groupBar = root.querySelector('#bosses-groups');
  let bosses = [];
  let leaders = [];
  let items;
  let sets;
  try {
    [bosses, items, sets, leaders] = await Promise.all([loadData('bosses'), loadIndex('items'), loadIndex('armor-sets'),
      loadData('leaders').catch(() => [])]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');
  const chosen = {}; // dificuldade aberta em cada card
  const moreOpen = new Set(); // cards com "Mostrar mais" aberto
  function tierBody(tier, bossId) {
    const facts = [
      tier.level ? `<div><dt>${esc(t('bosses.level'))}</dt><dd>${esc(tier.level)}</dd></div>` : '',
      tier.exp ? `<div><dt>${esc(t('bosses.exp'))}</dt><dd>${esc(fmtNum(tier.exp, 0))}</dd></div>` : ''
    ].join('');
    // itens para invocar como espaços de inventário (mesmo visual do mapa interativo)
    const summon = tier.summon?.length
      ? `<h4 class="boss-block-title">${esc(t('bosses.summon'))}</h4>
        <div class="boss-slots">${tier.summon.flatMap((g) => g.ids.map((id) => {
          const it = items.get(id);
          const name = it ? pick(it, 'name') : id;
          return `<a class="boss-slot" href="#itens?item=${encodeURIComponent(id)}" data-item-id="${esc(id)}" title="${esc(name)}">
            <span class="boss-slot-box">${it?.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" />` : ''}<b>×${esc(g.n)}</b></span>
            <span class="boss-slot-name">${esc(name)}</span></a>`;
        })).join('')}</div>`
      : '';
    const extra = [
      tier.drops?.length ? `<h4 class="farming-subtitle">${esc(t('bosses.drops'))}</h4>${dropList(items, tier.drops)}` : '',
      tier.final?.length ? `<h4 class="farming-subtitle" title="${esc(t('bosses.finalHint'))}">${esc(t('bosses.final'))}</h4>${dropList(items, tier.final)}` : '',
      tier.parts?.length ? `<h4 class="farming-subtitle">${esc(t('bosses.parts'))}</h4>${dropList(items, tier.parts)}` : ''
    ].join('');
    const unlocks = tier.unlocks?.length
      ? `<h4 class="farming-subtitle">${esc(t('bosses.unlocks'))}</h4>
        <ul class="boss-unlocks">${tier.unlocks.map((u) => `
          <li>
            <strong>${esc(pick(u, 'name'))}</strong>
            ${(u.sets || []).map((id) => { const s = sets.get(String(id)); return s ? ` <a class="boss-set-link" href="#armaduras?set=${esc(id)}">${esc(pick(s, 'name'))} →</a>` : ''; }).join('')}
            ${(u.items || []).map((id) => ingredientChip(items, id, 0)).join('')}
          </li>`).join('')}</ul>`
      : `<p class="boss-no-unlock">${esc(t('bosses.noUnlock'))}</p>`;
    return `
      <dl class="farming-facts">${facts}</dl>
      ${summon}
      ${unlocks}
      ${extra ? `<details class="boss-more"${moreOpen.has(bossId) ? ' open' : ''}>
        <summary><span class="boss-more-on">${esc(t('bosses.more'))}</span><span class="boss-more-off">${esc(t('bosses.less'))}</span></summary>
        <div class="boss-more-body">${extra}</div>
      </details>` : ''}`;
  }

  function card(b) {
    const idx = Math.min(chosen[b.id] ?? b.tiers.length - 1, b.tiers.length - 1);
    const setNames = (b.sets || []).map((id) => sets.get(String(id))).filter(Boolean);
    const bg = BG.has(b.id) ? `assets/img/bosses/bg_${b.id.toLowerCase()}.webp` : '';
    const title = `<h3 class="item-card-title">${esc(pick(b.tiers[idx], 'name'))}${b.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>`;
    return `
      <article class="item-card creature-card boss-card${bg ? ' has-bg' : ''}" data-boss="${esc(b.id)}">
        ${bg
    ? `<div class="boss-hero"><img src="${esc(bg)}" alt="${esc(pick(b, 'name'))}" loading="lazy" width="1000" height="563" />${title}</div>`
    : `${b.photo ? `<img class="creature-photo" src="${esc(b.photo)}" alt="${esc(pick(b, 'name'))}" loading="lazy" width="256" height="256" />` : ''}${title}`}
        ${setNames.length ? `<p class="boss-sets">${setNames.map((s) => `<a href="#armaduras?set=${esc(s.id)}">${s.icon ? `<img src="${esc(s.icon)}" alt="" loading="lazy" width="28" height="28" />` : ''}${esc(pick(s, 'name'))}</a>`).join('')}</p>` : ''}
        <div class="boss-tabs" role="tablist" aria-label="${esc(t('bosses.difficulty'))}">
          ${b.tiers.map((tier, i) => `<button type="button" role="tab" class="boss-tab boss-tab-${TIER_CLASS[i] || 'doom'}${i === idx ? ' is-active' : ''}" aria-selected="${i === idx}" data-tier="${i}">${esc(t(`bosses.tier${i + 1}`))}</button>`).join('')}
        </div>
        <div class="boss-tier" role="tabpanel">${tierBody(b.tiers[idx], b.id)}</div>
      </article>`;
  }

  function haystack(b) {
    const ids = new Set();
    b.tiers.forEach((tr) => ['drops', 'final', 'parts'].forEach((k) => (tr[k] || []).forEach((d) => ids.add(d.id))));
    const names = [...ids].map((id) => { const it = items.get(id); return it ? `${it.name_pt} ${it.name_en}` : ''; });
    const setNames = (b.sets || []).map((id) => { const s = sets.get(String(id)); return s ? `${s.name_pt} ${s.name_en}` : ''; });
    return normalize(`${b.tiers.map((tr) => `${tr.name_pt} ${tr.name_en}`).join(' ')} ${names.join(' ')} ${setNames.join(' ')}`);
  }
  const hay = new Map(bosses.map((b) => [b.id, haystack(b)]));

  // ---------------------------------------------------------------- líderes e chefes de ruína (assets/data/leaders.json)
  const chosenV = {}; // nível aberto em cada card de líder
  const pct = (v) => `${fmtNum(v, v < 10 ? 1 : 0)}%`;
  const chip = (id, n, chance) => `<span class="farming-drop">${ingredientChip(items, id, n)}${chance != null && chance < 100 ? `<small>${esc(pct(chance))}</small>` : ''}</span>`;
  const mapLink = (e, s, i, total) => `<a class="boss-map-link" href="#mapa?map=${esc(e.map)}&at=${esc(s[0])},${esc(s[1])}">${esc(total > 1 ? t('bosses.mapN', { n: i + 1 }) : t('bosses.viewMap'))}</a>`;

  function leaderBody(e, v) {
    const lv = v.lo === v.hi ? v.lo : `${v.lo}–${v.hi}`;
    const where = pick(v, 'where');
    const facts = [
      `<div><dt>${esc(t('common.level'))}</dt><dd>${esc(lv)}</dd></div>`,
      where ? `<div><dt>${esc(t('bosses.where'))}</dt><dd>${esc(where)}</dd></div>` : '',
      v.spots.length > 1 ? `<div><dt>${esc(t('bosses.spots'))}</dt><dd>${esc(v.spots.length)}</dd></div>` : '',
      v.exp ? `<div><dt>${esc(t('bosses.exp'))}</dt><dd>${esc(fmtNum(v.exp, 0))}</dd></div>` : ''
    ].join('');
    const g = v.gear || {};
    const dropRow = (list) => `<div class="farming-harvest">${list.map((d) => chip(d.id, d.n[0] === d.n[1] ? d.n[0] : `${d.n[0]}–${d.n[1]}`, d.chance)).join('')}</div>`;
    // duelo no Posto de desafio: itens para invocar (mesmo visual de espaços de inventário dos chefes das pirâmides)
    const duel = (e.duel || []).map((d) => `
      <h4 class="boss-block-title" title="${esc(pick(d, 'at'))}">${esc(t('bosses.duel'))}</h4>
      <p class="boss-duel-title">${esc(pick(d, 'title'))}${pick(d, 'at') ? ` <small>· ${esc(pick(d, 'at'))}</small>` : ''}</p>
      ${d.modes?.length ? `<p class="boss-duel-mode">${esc(t(d.modes.length > 1 ? 'bosses.duelOnlyN' : 'bosses.duelOnly', { modes: d.modes.map((m) => t(`map.mode.${m}`)).join(t('bosses.and')) }))}</p>` : ''}
      <div class="boss-slots">${d.ing.flatMap((gr) => gr.ids.map((id) => {
        const it = items.get(id);
        const name = it ? pick(it, 'name') : id;
        return `<a class="boss-slot" href="#itens?item=${encodeURIComponent(id)}" data-item-id="${esc(id)}" title="${esc(name)}">
          <span class="boss-slot-box">${it?.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" />` : ''}<b>×${esc(gr.n)}</b></span>
          <span class="boss-slot-name">${esc(name)}</span></a>`;
      })).join('')}</div>`).join('');
    const extra = [
      v.harvest?.length ? `<h4 class="farming-subtitle">${esc(t('bosses.drops'))}</h4>${dropRow(v.harvest)}` : '',
      v.final?.length ? `<h4 class="farming-subtitle" title="${esc(t('bosses.finalHint'))}">${esc(t('bosses.final'))}</h4>${dropRow(v.final)}` : '',
      v.drops?.length ? `<h4 class="farming-subtitle">${esc(t('bosses.lootDrops'))}</h4>
        <div class="farming-harvest">${v.drops.map((d) => chip(d.id, d.n[0] === d.n[1] ? d.n[0] : `${d.n[0]}–${d.n[1]}`, d.chance)).join('')}</div>` : '',
      g.armor?.length ? `<h4 class="farming-subtitle" title="${esc(t('bosses.gearHint'))}">${esc(t('bosses.gearArmor'))}</h4>
        <div class="farming-harvest">${g.armor.flatMap((s) => s.ids.map((id) => chip(id, 0, s.chance))).join('')}</div>` : '',
      g.weapons?.length ? `<h4 class="farming-subtitle" title="${esc(t('bosses.gearHint'))}">${esc(t('bosses.gearWeapons'))}</h4>
        <div class="farming-harvest">${g.weapons.map((id) => chip(id, 0, g.weaponChance)).join('')}</div>` : ''
    ].join('');
    return `
      <dl class="farming-facts">${facts}</dl>
      ${v.spots.length ? `<p class="boss-map-links">${v.spots.map((s, i) => mapLink(e, s, i, v.spots.length)).join('')}</p>` : ''}
      ${duel}
      ${e.group === 'world' ? `<p class="boss-no-unlock">${esc(t('bosses.noSummon'))}</p>` : ''}
      ${extra ? `<details class="boss-more"${moreOpen.has(e.id) ? ' open' : ''}>
        <summary><span class="boss-more-on">${esc(t('bosses.more'))}</span><span class="boss-more-off">${esc(t('bosses.less'))}</span></summary>
        <div class="boss-more-body">${extra}</div>
      </details>` : ''}`;
  }

  function leaderCard(e) {
    const idx = Math.min(chosenV[e.id] ?? 0, e.variants.length - 1);
    const tabs = e.variants.length > 1
      ? `<div class="boss-tabs boss-tabs-lv" role="tablist" aria-label="${esc(t('common.level'))}" style="--n:${e.variants.length}">
          ${e.variants.map((v, i) => `<button type="button" role="tab" class="boss-tab${i === idx ? ' is-active' : ''}" aria-selected="${i === idx}" data-variant="${i}">${esc(t('bosses.lvTab', { n: v.lo }))}</button>`).join('')}
        </div>` : '';
    return `
      <article class="item-card leader-card" data-leader="${esc(e.id)}">
        <header class="leader-head">
          ${e.photo
    ? `<img class="leader-icon leader-photo" src="${esc(e.photo)}" alt="${esc(pick(e, 'name'))}" loading="lazy" width="72" height="72" />`
    : `<img class="leader-icon" src="assets/img/bosses/icon_${esc(e.group)}.svg" alt="" width="56" height="56" />`}
          <div>
            <h3 class="item-card-title">${esc(pick(e, 'name'))}${e.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}</h3>
            <span class="leader-group">${esc(t(e.map === 'dlc' ? 'map.mapDlc' : 'map.mapMain'))}</span>
          </div>
        </header>
        ${tabs}
        <div class="boss-tier" role="tabpanel">${leaderBody(e, e.variants[idx])}</div>
      </article>`;
  }

  function leaderHay(e) {
    const ids = new Set();
    e.variants.forEach((v) => {
      [...(v.drops || []), ...(v.harvest || []), ...(v.final || [])].forEach((d) => ids.add(d.id));
      (v.gear?.armor || []).forEach((s) => s.ids.forEach((id) => ids.add(id)));
      (v.gear?.weapons || []).forEach((id) => ids.add(id));
    });
    const names = [...ids].map((id) => { const it = items.get(id); return it ? `${it.name_pt} ${it.name_en}` : ''; });
    return normalize(`${e.name_pt} ${e.name_en} ${e.variants.map((v) => `${v.where_pt || ''} ${v.where_en || ''}`).join(' ')} ${names.join(' ')}`);
  }
  leaders.forEach((e) => hay.set(e.id, leaderHay(e)));

  // ---------------------------------------------------------------- grupos (abas no topo) e "Mostrar mais"
  const GROUP_LABEL = { pyramid: 'bosses.gPyramid', tribe: 'bosses.gTribe', plunderer: 'bosses.gPlunderer', ruin: 'bosses.gRuin' };
  const GROUP_NOTE = { pyramid: 'bosses.note', tribe: 'bosses.noteTribe', plunderer: 'bosses.notePlunderer', ruin: 'bosses.noteRuin' };
  let group = GROUP_LABEL[params.get('g')] ? params.get('g') : '';

  function render() {
    const q = normalize(search.value);
    const f = filter.value;
    const keep = (x) => (!q || hay.get(x.id).includes(q)) && (!f || (f === 'dlc') === Boolean(x.dlc));
    const sections = [
      // chefes das pirâmides + chefes-criatura sem item de invocação (Tempestade de Areia Mortal, Rei Rato Mutante)
      { key: 'pyramid', list: [...bosses, ...leaders.filter((e) => e.group === 'world')].filter(keep), card: (x) => (x.tiers ? card(x) : leaderCard(x)) },
      ...['tribe', 'plunderer', 'ruin'].map((k) => ({ key: k, list: leaders.filter((e) => e.group === k && keep(e)), card: leaderCard }))
    ].filter((s) => (!group || s.key === group) && s.list.length);
    groupBar.querySelectorAll('[data-group]').forEach((b) => {
      const on = b.dataset.group === group;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    count.textContent = tCount('bosses.count', sections.reduce((n, s) => n + s.list.length, 0));
    // todos os cards de cada grupo aparecem de uma vez (sem "Mostrar mais" escondendo chefes)
    container.innerHTML = sections.length ? sections.map((s) => `
        <section class="bosses-section" data-section="${s.key}">
          <h2 class="bosses-section-title"><img src="${s.key === 'pyramid' ? 'assets/img/map/icons/shanggujinzita.webp' : `assets/img/bosses/icon_${s.key}.svg`}" alt="" width="28" height="28" />${esc(t(GROUP_LABEL[s.key]))} <small>${esc(s.list.length)}</small></h2>
          <p class="bosses-note">${esc(t(GROUP_NOTE[s.key]))}</p>
          <div class="items-grid bosses-grid">${s.list.map(s.card).join('')}</div>
        </section>`).join('') : `<div class="items-no-results">${esc(t('bosses.none'))}</div>`;
  }
  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  groupBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    group = b.dataset.group;
    render();
  });
  container.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('boss-more')) return;
    const card = d.closest('.boss-card, .leader-card');
    const id = card?.dataset.boss || card?.dataset.leader;
    if (d.open) moreOpen.add(id); else moreOpen.delete(id);
  }, true);
  container.addEventListener('click', (e) => {
    const vtab = e.target.closest('[data-variant]');
    if (vtab) {
      const el = vtab.closest('.leader-card');
      const ld = leaders.find((x) => x.id === el.dataset.leader);
      chosenV[ld.id] = Number(vtab.dataset.variant);
      el.outerHTML = leaderCard(ld);
      container.querySelector(`.leader-card[data-leader="${CSS.escape(ld.id)}"] .boss-tab.is-active`)?.focus();
      return;
    }
    if (e.target.closest('.boss-map-link')) return;   // link normal para o mapa
    const tab = e.target.closest('.boss-tab');
    if (tab) {
      const el = tab.closest('.boss-card');
      const b = bosses.find((x) => x.id === el.dataset.boss);
      chosen[b.id] = Number(tab.dataset.tier);
      el.outerHTML = card(b);
      container.querySelector(`.boss-card[data-boss="${CSS.escape(b.id)}"] .boss-tab.is-active`)?.focus();
      return;
    }
    const link = e.target.closest('[data-item-link], [data-item-id]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink || link.dataset.itemId);
  });
  render();
}
