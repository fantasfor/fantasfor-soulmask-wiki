// Chefes: guardiões das pirâmides (assets/data/bosses.json, gerado dos altares BP_JianZhu_Summon_* e de DT_ShengWuCaiJiBao)
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
  let bosses = [];
  let items;
  let sets;
  try {
    [bosses, items, sets] = await Promise.all([loadData('bosses'), loadIndex('items'), loadIndex('armor-sets')]);
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

  function render() {
    const q = normalize(search.value);
    const f = filter.value;
    const list = bosses.filter((b) => (!q || hay.get(b.id).includes(q)) && (!f || (f === 'dlc') === Boolean(b.dlc)));
    count.textContent = tCount('bosses.count', list.length);
    container.innerHTML = list.length ? list.map(card).join('') : `<div class="items-no-results">${esc(t('bosses.none'))}</div>`;
  }
  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  container.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('boss-more')) return;
    const id = d.closest('.boss-card')?.dataset.boss;
    if (d.open) moreOpen.add(id); else moreOpen.delete(id);
  }, true);
  container.addEventListener('click', (e) => {
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
