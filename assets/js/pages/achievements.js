// Conquistas: marcos da jornada (as conquistas da Steam) e estelas (antigas e sagradas).
// Dados: assets/data/achievements.json (tools/build_journey.py, lido de BP_ChengJiuConfig e de cada BP_ChengJiu_* /
//        BP_Achievement_*): nome, texto de ambientação, como fazer, recompensa (EXP, pontos de tecnologia e
//        receitas liberadas), alvo (criatura, chefe ou nome para a busca do mapa) e posição das estelas no mapa.
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, fmtNum, ingredientChip, openItemModal } from '../data.js';

const PAGE = 48;
const CATS = ['growth', 'explore', 'hunt', 'kill', 'bosses', 'camps', 'ruins', 'tribe', 'craft', 'masks', 'collection', 'stele', 'holyStele'];
const MAP_KEY = { main: 'map.mapMain', dlc: 'map.mapDlc' };

export async function initAchievementsPage(root, params) {
  const search = root.querySelector('#ach-search');
  const catSel = root.querySelector('#ach-cat');
  const mapSel = root.querySelector('#ach-map');
  const count = root.querySelector('#ach-count');
  const listEl = root.querySelector('#ach-list');
  const moreEl = root.querySelector('#ach-more');
  let data;
  let items;
  let creatures;
  let bosses;
  try {
    [data, items, creatures, bosses] = await Promise.all([loadData('achievements'), loadIndex('items'), loadIndex('creatures'), loadIndex('bosses')]);
  } catch (e) {
    listEl.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const all = data.list;
  const byId = new Map(all.map((a) => [a.id, a]));
  const used = CATS.filter((c) => all.some((a) => a.cat === c));
  catSel.innerHTML = `<option value="">${esc(t('ach.catAll'))}</option>${used.map((c) => `<option value="${c}">${esc(t(`ach.cat.${c}`))} (${all.filter((a) => a.cat === c).length})</option>`).join('')}`;
  if (params.get('q')) search.value = params.get('q');
  if (params.get('cat') && used.includes(params.get('cat'))) catSel.value = params.get('cat');
  if (params.get('map')) mapSel.value = params.get('map');
  let shown = PAGE;

  const mapOf = (a) => (a.dlc ? 'dlc' : 'main');
  const hay = (a) => {
    if (a._h === undefined) {
      a._h = normalize([a.name_pt, a.name_en, a.how_pt, a.how_en, a.lore_pt, a.lore_en, t(`ach.cat.${a.cat}`),
        ...(a.reward?.unlocks || []).flatMap((u) => [u.name_pt, u.name_en])].filter(Boolean).join(' '));
    }
    return a._h;
  };

  function targetLinks(a) {
    const out = [];
    (a.targets || []).forEach((tg) => {
      if (tg.creature) {
        const c = creatures.get(tg.creature);
        if (!c) return;
        const nm = pick(c, 'name');
        out.push(`<a class="ach-link" href="#criaturas?q=${encodeURIComponent(nm)}">${esc(nm)}</a>`);
        if (c.maps?.length) out.push(`<a class="ach-link ach-map" href="#mapa?map=${c.maps.includes(mapOf(a)) ? mapOf(a) : c.maps[0]}&creature=${encodeURIComponent(c.id)}">${esc(t('ach.seeMap'))}</a>`);
      } else if (tg.boss) {
        const b = bosses.get(tg.boss);
        const nm = b ? pick(b, 'name') : tg.boss;
        out.push(`<a class="ach-link" href="#chefes?q=${encodeURIComponent(nm)}">${esc(t('ach.seeBoss', { name: nm }))}</a>`);
      } else if (tg.q_pt) {
        const nm = pick(tg, 'q');
        out.push(`<a class="ach-link ach-map" href="#mapa?map=${esc(tg.map)}&q=${encodeURIComponent(nm)}">${esc(t('ach.seeMapName', { name: nm }))}</a>`);
      }
    });
    // dedup (variantes do mesmo animal levam ao mesmo lugar)
    return [...new Set(out)];
  }

  function rewardHtml(a) {
    const r = a.reward;
    if (!r) return '';
    const parts = [];
    if (r.exp) parts.push(`<span class="ach-pill">${esc(t('ach.exp', { n: fmtNum(r.exp, 0) }))}</span>`);
    if (r.tech) parts.push(`<span class="ach-pill">${esc(tCount('ach.tech', r.tech))}</span>`);
    const un = (r.unlocks || []).map((u) => `<div class="ach-unlock"><strong>${esc(pick(u, 'name') || t('ach.recipe'))}</strong>${(u.items || []).length ? `<div class="ach-chips">${u.items.map((id) => ingredientChip(items, id)).join('')}</div>` : ''}</div>`).join('');
    return `<div class="ach-reward"><span class="ach-label">${esc(t('ach.reward'))}</span>${parts.join('')}${un ? `<div class="ach-unlocks"><span class="ach-label">${esc(t('ach.unlocks'))}</span>${un}</div>` : ''}</div>`;
  }

  function card(a) {
    const stele = a.cat === 'stele' || a.cat === 'holyStele';
    const how = stele ? t(a.cat === 'holyStele' ? 'ach.holySteleHow' : 'ach.steleHow') : pick(a, 'how');
    const extra = [];
    if (a.points) extra.push(t('ach.points', { n: a.points }));
    if (a.subs?.length) extra.push(t('ach.subs', { n: a.subs.length }));
    if (a.item && items.has(a.item)) extra.push(`<span class="ach-chips">${ingredientChip(items, a.item)}</span>`);
    const links = targetLinks(a);
    if (stele && a.at) links.push(`<a class="ach-link ach-map" href="#mapa?map=${esc(a.map)}&at=${a.at[0]},${a.at[1]}">${esc(t('ach.seeMap'))}</a>`);
    const lore = pick(a, 'lore');
    return `<article class="ach-card${stele ? ' is-stele' : ''}" data-ach="${esc(a.id)}">
      <div class="ach-head">
        ${a.icon ? `<img class="ach-icon" src="${esc(a.icon)}" alt="" loading="lazy" width="56" height="56" />` : '<span class="ach-icon ach-icon-empty" aria-hidden="true"></span>'}
        <div class="ach-title">
          <h3>${esc(pick(a, 'name') || a.id)}</h3>
          <div class="ach-tags"><span class="ach-tag">${esc(t(`ach.cat.${a.cat}`))}</span>${a.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</div>
        </div>
      </div>
      <p class="ach-how"><span class="ach-label">${esc(t('ach.how'))}</span>${esc(how)}</p>
      ${extra.length ? `<p class="ach-extra">${extra.map((x) => (x.startsWith('<') ? x : esc(x))).join(' · ')}</p>` : ''}
      ${rewardHtml(a)}
      ${links.length ? `<div class="ach-links">${links.join('')}</div>` : ''}
      ${lore ? `<details class="ach-lore"><summary>${esc(t('ach.lore'))}</summary><p>${esc(lore)}</p></details>` : ''}
    </article>`;
  }

  function filtered() {
    const q = normalize(search.value.trim());
    const cat = catSel.value;
    const map = mapSel.value;
    return all.filter((a) => (!cat || a.cat === cat) && (!map || mapOf(a) === map) && (!q || hay(a).includes(q)));
  }

  function render(reset = true) {
    if (reset) shown = PAGE;
    const list = filtered();
    count.textContent = tCount('ach.count', list.length);
    listEl.innerHTML = list.length ? list.slice(0, shown).map(card).join('') : `<div class="items-empty">${esc(t('ach.empty'))}</div>`;
    moreEl.innerHTML = list.length > shown
      ? `<button type="button" class="guide-chip ach-more-btn">${esc(t('items.showMore', { n: Math.min(PAGE, list.length - shown) }))}</button> <small>${esc(t('items.shownOf', { a: Math.min(shown, list.length), b: list.length }))}</small>`
      : '';
  }

  // resumo: quantos de cada tipo e o total de recompensas das estelas
  const sumEl = root.querySelector('#ach-summary');
  if (sumEl) {
    const steles = all.filter((a) => a.cat === 'stele' || a.cat === 'holyStele');
    const tot = (m, k) => steles.filter((a) => mapOf(a) === m).reduce((s, a) => s + (a.reward?.[k] || 0), 0);
    const milestones = all.filter((a) => !(a.cat === 'stele' || a.cat === 'holyStele'));
    sumEl.innerHTML = `<div class="ach-sum"><strong>${milestones.length}</strong><span>${esc(t('ach.sumMilestones'))}</span></div>
      ${['main', 'dlc'].map((m) => `<div class="ach-sum"><strong>${steles.filter((a) => mapOf(a) === m).length}</strong><span>${esc(t('ach.sumSteles', { map: t(MAP_KEY[m]) }))}</span><small>${esc(t('ach.sumStelesReward', { exp: fmtNum(tot(m, 'exp'), 0), tech: tot(m, 'tech') }))}</small></div>`).join('')}`;
  }

  search.addEventListener('input', () => render());
  catSel.addEventListener('change', () => render());
  mapSel.addEventListener('change', () => render());
  moreEl.addEventListener('click', (e) => {
    if (!e.target.closest('.ach-more-btn')) return;
    shown += PAGE;
    render(false);
  });
  listEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (link) { e.preventDefault(); openItemModal(link.dataset.itemLink); }
  });
  render();
  // aberto com #conquistas?id=<id>: mostra só ela
  if (params.get('id') && byId.has(params.get('id'))) {
    const a = byId.get(params.get('id'));
    search.value = pick(a, 'name');
    render();
  }
}
