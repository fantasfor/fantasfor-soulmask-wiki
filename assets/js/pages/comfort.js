// Conforto: níveis (GE_ShuShiDu*) e valor de conforto de cada móvel (assets/data/comfort.json, gerado de BP_JianZhuGuanLiQi)
// + Calculadora de conforto (ferramenta à parte): o jogador adiciona as decorações que já colocou e vê o nível.
import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, normalize, fmtNum, iconImg, statList, fmtDuration, openItemModal } from '../data.js';

const CHECK_KEY = 'soulmask-comfort-check';
const readCheck = () => { try { return JSON.parse(localStorage.getItem(CHECK_KEY) || '{}') || {}; } catch (e) { return {}; } };
const writeCheck = (v) => { try { localStorage.setItem(CHECK_KEY, JSON.stringify(v)); } catch (e) { /* ignora */ } };

export async function initComfortPage(root, params) {
  const checkEl = root.querySelector('#comfort-check');
  const toolSearch = root.querySelector('#comfort-tool-search');
  const toolResults = root.querySelector('#comfort-tool-results');
  const toolList = root.querySelector('#comfort-tool-list');
  const clearBtn = root.querySelector('#comfort-clear');
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

  // ---------------------------------------------------------------- calculadora (ferramenta à parte)
  let placed = readCheck();
  const byId = new Map(data.furniture.map((f) => [f.id, f]));
  Object.keys(placed).forEach((id) => { if (!byId.has(id)) delete placed[id]; });
  const counted = (f) => Math.min(placed[f.id] || 0, f.max || 1);

  function renderSummary() {
    const total = data.furniture.reduce((s, f) => s + counted(f) * f.value, 0);
    const level = [...data.levels].reverse().find((l) => total >= l.min) || null;
    const next = data.levels.find((l) => l.min > total) || null;
    const base = level ? level.min : 0;
    const pct = next ? Math.max(0, Math.min(100, ((total - base) / (next.min - base)) * 100)) : 100;
    checkEl.innerHTML = `
      <div class="comfort-check-body">
        <div class="comfort-check-total"><strong>${esc(fmtNum(total, 0))}</strong><span>${esc(t('comfort.checkPoints'))}</span></div>
        <div class="comfort-check-level">
          <span class="comfort-level-n">${esc(level ? level.n : 0)}</span>
          <div>
            <strong>${esc(level ? pick(level, 'name') : t('comfort.checkNone'))}</strong>
            <span>${esc(next ? t('comfort.checkNext', { n: fmtNum(next.min - total, 0), name: pick(next, 'name') }) : t('comfort.checkMax'))}</span>
            <span class="comfort-check-bar"><i style="width:${pct}%"></i></span>
          </div>
        </div>
        ${level && pick(level, 'buff') ? `<p class="comfort-level-buff">${esc(pick(level, 'buff'))}</p>` : ''}
      </div>`;
    clearBtn.disabled = !Object.keys(placed).length;
  }

  function renderMine() {
    const ids = Object.keys(placed).filter((id) => byId.has(id))
      .sort((a, b) => pick(byId.get(a), 'name').localeCompare(pick(byId.get(b), 'name')));
    toolList.innerHTML = ids.length ? ids.map((id) => {
      const f = byId.get(id);
      const n = placed[id];
      const over = n > (f.max || 1);
      return `<li class="comfort-tool-row">
        ${iconImg(f, 'comfort-icon')}
        <span class="comfort-tool-name">${esc(pick(f, 'name'))}<small>+${esc(fmtNum(f.value, 0))} ${esc(t('comfort.each'))}${f.max > 1 ? ` · ${esc(t('comfort.maxCount', { n: f.max }))}` : ''}</small></span>
        <span class="comfort-qty is-on">
          <button type="button" class="map-btn map-btn-sm" data-step="-1" data-id="${esc(id)}" aria-label="${esc(t('comfort.less'))}">-</button>
          <output class="${over ? 'is-over' : ''}" title="${esc(over ? t('comfort.overMax', { n: f.max }) : '')}">${n}</output>
          <button type="button" class="map-btn map-btn-sm" data-step="1" data-id="${esc(id)}" aria-label="${esc(t('comfort.more'))}">+</button>
        </span>
        <strong class="comfort-tool-sub">+${esc(fmtNum(counted(f) * f.value, 0))}</strong>
      </li>`;
    }).join('') : `<li class="comfort-tool-empty">${esc(t('comfort.toolEmpty'))}</li>`;
  }

  function renderPick() {
    const q = normalize(toolSearch.value);
    const list = data.furniture.filter((f) => !q || normalize(`${f.name_pt} ${f.name_en}`).includes(q))
      .sort((a, b) => b.value - a.value || pick(a, 'name').localeCompare(pick(b, 'name')))
      .slice(0, q ? 60 : 24);
    toolResults.innerHTML = list.map((f) => `
      <button type="button" class="comfort-tool-add${placed[f.id] ? ' is-added' : ''}" data-add="${esc(f.id)}" title="${esc(t('comfort.toolAdd'))}">
        ${iconImg(f, 'comfort-icon')}
        <span>${esc(pick(f, 'name'))}</span>
        <small>+${esc(fmtNum(f.value, 0))}</small>
      </button>`).join('') || `<p class="comfort-tool-empty">${esc(t('comfort.none'))}</p>`;
  }

  function setQty(id, n) {
    if (!byId.has(id)) return;
    const v = Math.max(0, Math.min(99, n));
    if (v) placed[id] = v; else delete placed[id];
    writeCheck(placed);
    renderSummary();
    renderMine();
    renderPick();
  }

  toolSearch.addEventListener('input', renderPick);
  toolResults.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) setQty(b.dataset.add, (placed[b.dataset.add] || 0) + 1);
  });
  toolList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) setQty(b.dataset.id, (placed[b.dataset.id] || 0) + Number(b.dataset.step));
  });
  clearBtn.addEventListener('click', () => {
    if (!window.confirm(t('comfort.checkClearConfirm'))) return;
    placed = {};
    writeCheck(placed);
    renderSummary();
    renderMine();
    renderPick();
  });

  // ---------------------------------------------------------------- lista padrão de móveis
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
  renderSummary();
  renderMine();
  renderPick();
}
