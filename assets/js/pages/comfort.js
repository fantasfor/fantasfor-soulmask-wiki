// Conforto: níveis (GE_ShuShiDu*) e valor de conforto de cada móvel (assets/data/comfort.json, gerado de BP_JianZhuGuanLiQi)
import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum, iconImg, statList, fmtDuration, openItemModal } from '../data.js';

export async function initComfortPage(root, params) {
  const howto = root.querySelector('#comfort-howto');
  const levelsEl = root.querySelector('#comfort-levels');
  const search = root.querySelector('#db-search');
  const sortSel = root.querySelector('#comfort-sort');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let data;
  let meta;
  try {
    [data, meta] = await Promise.all([loadData('comfort'), loadData('meta')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');

  const dur = data.levels.find((l) => l.duration)?.duration;
  howto.textContent = t('comfort.howto', { r: fmtNum(data.radius, 0), d: dur ? fmtDuration(dur) : '' });

  levelsEl.innerHTML = data.levels.map((l) => `
    <article class="comfort-level">
      <header>
        <span class="comfort-level-n">${esc(l.n)}</span>
        <div>
          <h3>${esc(pick(l, 'name'))}</h3>
          <span class="comfort-level-range">${esc(l.max ? t('comfort.range', { a: fmtNum(l.min, 0), b: fmtNum(l.max, 0) }) : t('comfort.rangeUp', { a: fmtNum(l.min, 0) }))}</span>
        </div>
      </header>
      ${pick(l, 'buff') ? `<p class="comfort-level-buff">${esc(pick(l, 'buff'))}</p>` : ''}
      ${statList(meta, l.stats)}
    </article>`).join('');

  function row(f) {
    const icon = iconImg(f, 'comfort-icon');
    return `
      <div class="comfort-item">
        ${f.item ? `<button type="button" class="farming-icon-btn" data-item-id="${esc(f.item)}" title="${esc(t('common.details'))}">${icon}</button>` : icon}
        <div class="comfort-item-text">
          ${f.item ? `<a href="#" class="comfort-item-name" data-item-id="${esc(f.item)}">${esc(pick(f, 'name'))}</a>` : `<span class="comfort-item-name">${esc(pick(f, 'name'))}</span>`}
          ${f.dlc ? ' <span class="dlc-badge">DLC</span>' : ''}
          <small>${esc(f.max > 1 ? t('comfort.countsUpTo', { n: f.max, total: fmtNum(f.value * f.max, 0) }) : t('comfort.countsOne'))}</small>
        </div>
        <span class="comfort-item-value" title="${esc(t('comfort.perUnit'))}">+${esc(fmtNum(f.value, 0))}</span>
      </div>`;
  }

  function render() {
    const q = normalize(search.value);
    const list = data.furniture.filter((f) => !q || normalize(`${f.name_pt} ${f.name_en}`).includes(q));
    if (sortSel.value === 'name') list.sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')));
    else if (sortSel.value === 'total') list.sort((a, b) => b.value * b.max - a.value * a.max || pick(a, 'name').localeCompare(pick(b, 'name')));
    else list.sort((a, b) => b.value - a.value || pick(a, 'name').localeCompare(pick(b, 'name')));
    count.textContent = tCount('comfort.count', list.length);
    container.innerHTML = list.length ? list.map(row).join('') : `<div class="items-no-results">${esc(t('comfort.none'))}</div>`;
  }
  search.addEventListener('input', render);
  sortSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-id]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemId);
  });
  render();
}
