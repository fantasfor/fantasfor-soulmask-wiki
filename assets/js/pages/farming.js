// Plantio: dados das plantações (assets/data/crops.json, gerado de BP_ZhongZhi_ZuoWu_* e DT_ZhiBeiCaiJiBao)
import { t, tCount, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, fmtNum, iconImg, ingredientChip, openItemModal } from '../data.js';

function fmtGrowth(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return t('farming.hm', { h, m });
  if (h) return t('farming.h', { h });
  return t('common.minutes', { n: m });
}

// faixa de temperatura colorida (de -10 a 50 °C)
function tempBar(temps) {
  const LO = -10;
  const HI = 50;
  const pos = (v) => ((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * 100;
  const segs = temps.map((x) => {
    const a = pos(x.min ?? LO);
    const b = pos(x.max ?? HI);
    const cls = x.mult === 0 ? 'stop' : x.mult > 1 ? 'slow' : 'fast';
    const range = `${x.min ?? '…'}–${x.max ?? '…'} °C`;
    return `<span class="temp-seg temp-${cls}" style="left:${a}%;width:${b - a}%" title="${esc(`${range}: ${pick(x, 'label')} · ${pick(x, 'growthLabel')}`)}"></span>`;
  }).join('');
  const best = temps.find((x) => x.mult === 1);
  return `<div class="temp-bar" role="img" aria-label="${esc(best ? t('farming.ideal', { a: best.min, b: best.max }) : '')}">${segs}</div>
    <div class="temp-scale">${[LO, 0, 20, 40].map((v) => `<span style="left:${pos(v)}%">${v}°</span>`).join('')}</div>
    ${best ? `<p class="temp-ideal">${esc(t('farming.ideal', { a: best.min, b: best.max }))}</p>` : ''}`;
}

// faixa de temperatura em que a planta está (mult 0 = não cresce, 1 = normal, >1 = mais devagar)
function tempRange(c, temp) {
  return c.temps.find((x) => (x.min === null || temp >= x.min) && (x.max === null || temp < x.max)) || null;
}

// dica curta: melhor faixa, faixa lenta e limites em que a planta para
function tipText(c) {
  const best = c.temps.find((x) => x.mult === 1);
  if (!best) return '';
  const grow = c.temps.filter((x) => x.mult > 0);
  const lo = Math.min(...grow.map((x) => x.min ?? -Infinity));
  const hi = Math.max(...grow.map((x) => x.max ?? Infinity));
  const slow = Math.max(...c.temps.map((x) => x.mult));
  return t('farming.tip', {
    a: best.min, b: best.max, lo: Number.isFinite(lo) ? lo : '…', hi: Number.isFinite(hi) ? hi : '…', x: fmtNum(slow, 1)
  });
}

export async function initFarmingPage(root, params) {
  const search = root.querySelector('#db-search');
  const sortSel = root.querySelector('#farming-sort');
  const count = root.querySelector('#db-count');
  const container = root.querySelector('#db-container');
  let crops = [];
  let items;
  try {
    [crops, items] = await Promise.all([loadData('crops'), loadIndex('items')]);
  } catch (e) {
    container.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  if (params.get('q')) search.value = params.get('q');

  function card(c) {
    const slow = c.temps.some((x) => x.mult > 1) ? Math.max(...c.temps.map((x) => x.mult)) : 1;
    return `
      <article class="item-card farming-card">
        <header class="farming-head">
          <button type="button" class="farming-icon-btn" data-item-id="${esc(c.id)}" title="${esc(t('common.details'))}">${iconImg(c, 'farming-icon')}</button>
          <div>
            <h3 class="item-card-title">${esc(pick(c, 'name'))} ${c.dlc ? '<span class="dlc-badge">DLC</span>' : ''}</h3>
            <span class="farming-seed">${esc(pick(c, 'seed'))}</span>
          </div>
        </header>
        <dl class="farming-facts">
          <div><dt>${esc(t('farming.growth'))}</dt><dd>${esc(fmtGrowth(c.growth))}${slow > 1 ? ` <small>(${esc(t('farming.slowNote', { x: fmtNum(slow, 1) }))})</small>` : ''}</dd></div>
          ${c.fert ? `<div><dt>${esc(t('farming.fert'))}</dt><dd>${esc(fmtNum(c.fert.amount, 0))}</dd></div>` : ''}
          ${c.exp ? `<div><dt>${esc(t('farming.exp'))}</dt><dd>${esc(fmtNum(c.exp, 0))}</dd></div>` : ''}
        </dl>
        ${tempBar(c.temps)}
        ${tipText(c) ? `<p class="farming-tip">${esc(tipText(c))}</p>` : ''}
        <button type="button" class="farming-sim-btn" data-sim="${esc(c.id)}">${esc(t('farming.simulate'))}</button>
        ${pick(c, 'desc') ? `<p class="farming-desc">${escLines(pick(c, 'desc'))}</p>` : ''}
        ${c.harvest?.length ? `<h4 class="farming-subtitle">${esc(t('farming.harvest'))}</h4>
          <div class="farming-harvest">${c.harvest.map((h) => `<span class="farming-drop">${ingredientChip(items, h.id, h.n[0] === h.n[1] ? h.n[0] : `${h.n[0]}–${h.n[1]}`)}${h.chance < 100 ? `<small>${esc(h.chance)}%</small>` : ''}</span>`).join('')}</div>` : ''}
      </article>`;
  }

  function render() {
    const q = normalize(search.value);
    const list = crops.filter((c) => !q || normalize(`${c.name_pt} ${c.name_en} ${c.seed_pt} ${c.seed_en} ${c.harvest.map((h) => { const it = items.get(h.id); return it ? `${it.name_pt} ${it.name_en}` : ''; }).join(' ')}`).includes(q));
    if (sortSel.value === 'fast') list.sort((a, b) => a.growth - b.growth);
    else list.sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')));
    count.textContent = tCount('farming.count', list.length);
    container.innerHTML = list.length ? list.map(card).join('') : `<div class="items-no-results">${esc(t('farming.none'))}</div>`;
  }
  // ---------------------------------------------------------------- simulador
  const simCrop = root.querySelector('#sim-crop');
  const simTemp = root.querySelector('#sim-temp');
  const simTempOut = root.querySelector('#sim-temp-out');
  const simPlots = root.querySelector('#sim-plots');
  const simCycles = root.querySelector('#sim-cycles');
  const simResult = root.querySelector('#sim-result');
  const simBest = root.querySelector('#sim-best');
  const byId = new Map(crops.map((c) => [c.id, c]));
  simCrop.innerHTML = [...crops].sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name')))
    .map((c) => `<option value="${esc(c.id)}">${esc(pick(c, 'name'))}${c.dlc ? ' (DLC)' : ''}</option>`).join('');
  const ideal = crops.find((c) => c.id === params.get('crop')) || crops.find((c) => /milho|corn/i.test(c.name_pt)) || crops[0];
  simCrop.value = ideal.id;

  function simulate() {
    const c = byId.get(simCrop.value);
    const temp = Number(simTemp.value);
    const plots = Math.max(1, Math.min(500, Number(simPlots.value) || 1));
    const cycles = Math.max(1, Math.min(50, Number(simCycles.value) || 1));
    simTempOut.textContent = `${temp} °C`;
    const r = tempRange(c, temp);
    const mult = r ? r.mult : 0;
    const status = !mult ? 'stop' : mult > 1 ? 'slow' : 'fast';
    const time = mult ? c.growth * mult * cycles : 0;
    const drops = (c.harvest || []).map((h) => {
      const avg = ((h.n[0] + h.n[1]) / 2) * (h.chance / 100) * plots * cycles;
      return `<li>${ingredientChip(items, h.id, '')}<strong>≈ ${esc(fmtNum(avg, 0))}</strong>${h.n[0] !== h.n[1] || h.chance < 100 ? ` <small>(${esc(fmtNum(h.n[0] * plots * cycles * (h.chance === 100 ? 1 : 0), 0))}–${esc(fmtNum(h.n[1] * plots * cycles, 0))})</small>` : ''}</li>`;
    }).join('');
    simResult.innerHTML = `
      <div class="farm-sim-status farm-sim-${status}">
        <strong>${esc(r ? `${pick(r, 'label')} · ${pick(r, 'growthLabel')}` : t('farming.simUnknown'))}</strong>
        <span>${mult ? esc(t('farming.simTime', { time: fmtGrowth(time) })) : esc(t('farming.simStopped'))}</span>
      </div>
      <dl class="farming-facts">
        ${c.fert ? `<div><dt>${esc(t('farming.simFert'))}</dt><dd>${esc(fmtNum(c.fert.amount * plots * cycles, 0))}</dd></div>` : ''}
        ${c.exp ? `<div><dt>${esc(t('farming.exp'))}</dt><dd>${esc(fmtNum(c.exp * plots * cycles, 0))}</dd></div>` : ''}
        <div><dt>${esc(t('farming.simSeeds'))}</dt><dd>${esc(fmtNum(plots * cycles, 0))}</dd></div>
      </dl>
      ${drops ? `<h4 class="farming-subtitle">${esc(t('farming.simHarvest'))}</h4><ul class="farm-sim-drops">${drops}</ul>` : ''}
      ${tipText(c) ? `<p class="farming-tip">${esc(tipText(c))}</p>` : ''}`;
    // ranking das plantações para a temperatura escolhida
    const ranked = crops.map((x) => ({ x, r: tempRange(x, temp) }))
      .filter((o) => o.r && o.r.mult > 0)
      .sort((a, b) => a.r.mult - b.r.mult || a.x.growth * a.r.mult - b.x.growth * b.r.mult);
    simBest.innerHTML = ranked.length ? `<ul class="farm-sim-rank">${ranked.map(({ x, r: rr }) => `
      <li class="farm-sim-${rr.mult > 1 ? 'slow' : 'fast'}"><button type="button" data-sim="${esc(x.id)}">${esc(pick(x, 'name'))}</button>
        <span>${esc(pick(rr, 'growthLabel'))} · ${esc(fmtGrowth(x.growth * rr.mult))}</span></li>`).join('')}</ul>`
      : `<p class="farming-desc">${esc(t('farming.simNone'))}</p>`;
  }
  [simCrop, simTemp, simPlots, simCycles].forEach((el) => el.addEventListener('input', simulate));
  root.querySelector('.farm-sim').addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link]');
    if (link) { e.preventDefault(); openItemModal(link.dataset.itemLink); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sim]');
    if (!b) return;
    simCrop.value = b.dataset.sim;
    simulate();
    root.querySelector('.farm-sim').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  simulate();

  search.addEventListener('input', render);
  sortSel.addEventListener('change', render);
  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-item-link], [data-item-id]');
    if (!link) return;
    e.preventDefault();
    openItemModal(link.dataset.itemLink || link.dataset.itemId);
  });
  render();
}
