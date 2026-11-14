import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtDuration, statParts, statList, iconImg, openItemModal } from '../data.js';

export async function initFoodsPage(root, params) {
  const search = root.querySelector('#foods-search');
  const subSel = root.querySelector('#foods-subcategory-filter');
  const count = root.querySelector('#foods-count');
  const container = root.querySelector('#foods-container');
  const picker = root.querySelector('.foods-columns-picker');
  const colBtn = root.querySelector('#foods-columns-button');
  const colPanel = root.querySelector('#foods-columns-panel');
  const colOptions = root.querySelector('#foods-columns-options');

  let foods = [];
  let meta = {};
  try {
    [foods, meta] = await Promise.all([loadData('foods'), loadData('meta')]);
  } catch (e) {
    container.innerHTML = `<div class="foods-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }

  let view = 'cards';
  let sortCol = '';
  let sortDir = 1;
  let selectedCols = null;

  const subs = new Map();
  foods.forEach((f) => f.sub && subs.set(f.sub, pick(f, 'sub')));
  [...subs].sort((a, b) => a[1].localeCompare(b[1])).forEach(([k, label]) => {
    subSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(label)}</option>`);
  });
  if (params.get('q')) search.value = params.get('q');

  const allStats = (f) => [...(f.effects || []), ...(f.restores || [])];

  function filtered() {
    const q = normalize(search.value);
    const sub = subSel.value;
    return foods.filter((f) => (!sub || f.sub === sub)
      && (!q || normalize(`${f.name_pt} ${f.name_en} ${f.desc_pt || ''} ${f.desc_en || ''}`).includes(q)));
  }

  function columnsFor(list) {
    const seen = new Map();
    list.forEach((f) => allStats(f).forEach((s) => {
      if (!seen.has(s.a)) seen.set(s.a, statParts(meta, s).label);
    }));
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }

  function renderColumnsPicker(cols) {
    if (!selectedCols) selectedCols = new Set(cols.map(([a]) => a));
    colOptions.innerHTML = cols.map(([a, label]) => `
      <label class="foods-column-option"><input type="checkbox" value="${esc(a)}" ${selectedCols.has(a) ? 'checked' : ''} /><span>${esc(label)}</span></label>`).join('');
  }

  function valueOf(f, a) {
    const s = allStats(f).find((x) => x.a === a);
    return s ? statParts(meta, s) : null;
  }

  function cardHtml(f) {
    return `
      <article class="food-card" data-item-id="${esc(f.id)}">
        <div class="food-card-header">
          ${iconImg(f, 'food-card-image')}
          <div>
            <h2 class="food-card-title">${esc(pick(f, 'name'))}</h2>
            <span class="food-card-subcategory">${esc(pick(f, 'sub'))}</span>
          </div>
        </div>
        <p class="food-card-description">${esc(pick(f, 'desc'))}</p>
        ${f.effects?.length ? `<div class="food-card-bonus"><strong>${esc(t('common.effects'))}</strong>${statList(meta, f.effects)}</div>` : ''}
        ${f.restores?.length ? `<div class="food-card-bonus"><strong>${esc(t('common.restores'))}</strong>${statList(meta, f.restores)}</div>` : ''}
        ${f.duration ? `<div class="food-card-duration"><strong>${esc(t('common.duration'))}:</strong> ${esc(fmtDuration(f.duration))}</div>` : ''}
      </article>`;
  }

  function render() {
    const list = filtered();
    count.textContent = tCount('foods.count', list.length);
    picker.hidden = view !== 'table';
    if (!list.length) {
      container.className = 'foods-grid';
      container.innerHTML = `<div class="foods-empty">${esc(t('foods.none'))}</div>`;
      return;
    }
    if (view === 'cards') {
      container.className = 'foods-grid';
      container.innerHTML = list.map(cardHtml).join('');
      return;
    }
    const cols = columnsFor(list);
    renderColumnsPicker(cols);
    const shown = cols.filter(([a]) => selectedCols.has(a));
    const sorted = [...list];
    if (sortCol) {
      sorted.sort((x, y) => {
        let a; let b;
        if (sortCol === 'name') { a = pick(x, 'name'); b = pick(y, 'name'); return a.localeCompare(b) * sortDir; }
        if (sortCol === 'duration') { a = x.duration || 0; b = y.duration || 0; return (a - b) * sortDir; }
        a = allStats(x).find((s) => s.a === sortCol)?.v ?? -Infinity;
        b = allStats(y).find((s) => s.a === sortCol)?.v ?? -Infinity;
        return (a - b) * sortDir;
      });
    }
    const ind = (c) => (sortCol === c ? (sortDir > 0 ? '↑' : '↓') : '↕');
    container.className = 'foods-table-wrap';
    container.innerHTML = `
      <table class="foods-table">
        <thead><tr>
          <th scope="col"><button class="foods-sort-button" type="button" data-sort="name">${esc(t('foods.food'))} <span>${ind('name')}</span></button></th>
          ${shown.map(([a, label]) => `<th scope="col" class="foods-bonus-column"><button class="foods-sort-button" type="button" data-sort="${esc(a)}">${esc(label)} <span>${ind(a)}</span></button></th>`).join('')}
          <th scope="col"><button class="foods-sort-button" type="button" data-sort="duration">${esc(t('common.duration'))} <span>${ind('duration')}</span></button></th>
        </tr></thead>
        <tbody>
          ${sorted.map((f) => `
            <tr data-item-id="${esc(f.id)}">
              <th scope="row"><div class="food-table-name">${iconImg(f, 'food-table-image')}<span>${esc(pick(f, 'name'))}</span></div></th>
              ${shown.map(([a]) => `<td class="foods-bonus-column">${esc(valueOf(f, a)?.value || '')}</td>`).join('')}
              <td>${esc(fmtDuration(f.duration) || '-')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  root.querySelectorAll('[data-foods-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.foodsView;
    root.querySelectorAll('[data-foods-view]').forEach((x) => {
      x.classList.toggle('is-active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    if (view === 'table' && !subSel.value && subs.has('staple')) subSel.value = 'staple';
    render();
  }));
  container.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) {
      if (sortCol === s.dataset.sort) sortDir = -sortDir; else { sortCol = s.dataset.sort; sortDir = 1; }
      render();
      return;
    }
    const row = e.target.closest('[data-item-id]');
    if (row) openItemModal(row.dataset.itemId);
  });
  search.addEventListener('input', render);
  subSel.addEventListener('change', () => { selectedCols = null; render(); });
  colOptions.addEventListener('change', () => {
    selectedCols = new Set([...colOptions.querySelectorAll('input:checked')].map((i) => i.value));
    render();
  });
  colBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = colBtn.getAttribute('aria-expanded') === 'true';
    colBtn.setAttribute('aria-expanded', String(!open));
    colPanel.hidden = open;
  });
  colPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    colBtn.setAttribute('aria-expanded', 'false');
    colPanel.hidden = true;
  });
  render();
}
