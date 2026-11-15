// Cristais Vermelhos (HongJingShi): efeito principal, multiplicador por qualidade, carga, atributos extras
// sorteados e onde conseguir. Dados: assets/data/red-crystals.json e sources.json (tools/build_guides.py).
import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, fmtNum, statParts, sourceList, L } from '../data.js';

const Q = [
  { name: { pt: 'Branco', en: 'White' }, color: '#d9d9d9' },
  { name: { pt: 'Verde', en: 'Green' }, color: '#4fd18b' },
  { name: { pt: 'Azul', en: 'Blue' }, color: '#4aa3ff' },
  { name: { pt: 'Roxo', en: 'Purple' }, color: '#c06cff' },
  { name: { pt: 'Dourado', en: 'Gold' }, color: '#ecb43c' },
  { name: { pt: 'Vermelho', en: 'Red' }, color: '#ff5a4f' }
];
const LS_KEY = 'red_crystals_q_v1';

export async function initRedCrystalsPage(root) {
  const qEl = root.querySelector('#rc-quality');
  const listEl = root.querySelector('#rc-list');
  const searchEl = root.querySelector('#rc-search');
  const extraEl = root.querySelector('#rc-extra');
  const extraHint = root.querySelector('#rc-extra-hint');
  let data; let meta; let sources; let creatures; let bosses;
  try {
    [data, meta, sources, creatures, bosses] = await Promise.all([
      loadData('red-crystals'), loadData('meta'), loadData('sources').catch(() => ({})),
      loadIndex('creatures'), loadIndex('bosses').catch(() => new Map())
    ]);
  } catch (e) {
    listEl.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  let q = 5;
  try { q = Number(localStorage.getItem(LS_KEY) ?? 5); } catch (e) { /* ignora */ }
  if (!(q >= 0 && q <= 5)) q = 5;
  const open = new Set();

  // valor do efeito na qualidade escolhida: "mín – máx"
  const range = (stat, mult) => {
    const lo = statParts(meta, stat, mult[0]).value; const hi = statParts(meta, stat, mult[1]).value;
    return lo === hi ? lo : `${lo} – ${hi}`;
  };
  const specialText = (s, mult) => {
    const lo = fmtNum(s.v * mult[0] * 100, 1); const hi = fmtNum(s.v * mult[1] * 100, 1);
    const val = lo === hi ? `${lo}%` : `${lo}% – ${hi}%`;
    return L(s).replace('{0}', val).replace(/\s+\.$/, '.');
  };
  const hay = new Map(data.crystals.map((c) => [c.id, normalize([c.name_pt, c.name_en,
    ...c.main.map((s) => `${meta.attrs?.[s.a]?.pt || ''} ${meta.attrs?.[s.a]?.en || ''}`), ...c.special.map((s) => `${s.pt} ${s.en}`)].join(' '))]));

  function render() {
    try { localStorage.setItem(LS_KEY, String(q)); } catch (e) { /* ignora */ }
    qEl.innerHTML = Q.map((x, i) => `<button type="button" class="guide-chip${i === q ? ' is-active' : ''}" data-q="${i}" role="tab" aria-selected="${i === q}"><i class="attr-dot" style="--c:${x.color}"></i> ${esc(L(x.name))}</button>`).join('');
    const s = normalize(searchEl.value.trim());
    const list = data.crystals.filter((c) => !s || hay.get(c.id).includes(s));
    const col = Q[q].color;
    listEl.innerHTML = list.map((c) => {
      const mult = c.mult[q] || [1, 1];
      const effects = [
        ...c.main.map((st) => `<li><span>${esc(statParts(meta, st).label)}</span><strong style="color:${col}">${esc(range(st, mult))}</strong></li>`),
        ...c.special.map((st) => `<li class="rc-special"><span>${esc(specialText(st, mult))}</span></li>`)
      ].join('');
      const extras = c.extra ? data.extraCount[q] : 0;
      const src = sources[c.id] || [];
      return `<article class="rc-card" style="--c:${col}">
        <header class="rc-head">${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" />` : ''}<h3>${esc(pick(c, 'name'))}</h3></header>
        <ul class="rc-effects">${effects}</ul>
        <div class="rc-facts">
          <span>${esc(t('rc.load'))} <strong>${esc(fmtNum(c.load[q] ?? 0, 1))}</strong></span>
          <span>${esc(t('rc.extras'))} <strong>${esc(extras)}</strong></span>
        </div>
        ${src.length ? `<button type="button" class="map-btn map-btn-sm rc-src-btn" data-src="${esc(c.id)}" aria-expanded="${open.has(c.id)}">${esc(t('src.title'))} (${src.length})</button>
          ${open.has(c.id) ? sourceList(src, creatures, bosses, 10) : ''}` : ''}
      </article>`;
    }).join('') || `<div class="items-no-results">${esc(t('items.none'))}</div>`;

    // atributos extras: chance de cada um ser sorteado e o valor na qualidade
    const total = data.extraPool.reduce((a, x) => a + (x.w || 0), 0) || 1;
    const mult = (data.extraMult || data.crystals.find((c) => c.extra)?.mult || [])[q] || [1, 1];
    extraHint.textContent = t('rc.extraHint', { n: data.extraCount[q], q: L(Q[q].name) });
    extraEl.innerHTML = `<table class="guide-table"><thead><tr><th>${esc(t('attr.colStat'))}</th><th>${esc(t('rc.value'))}</th><th>${esc(t('rc.chance'))}</th></tr></thead><tbody>
      ${data.extraPool.map((st) => `<tr><td>${esc(statParts(meta, st).label)}</td><td style="color:${col}">${esc(range(st, mult))}</td><td>${esc(fmtNum((st.w / total) * 100, 0))}%</td></tr>`).join('')}
    </tbody></table>`;
  }
  qEl.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { q = Number(b.dataset.q); render(); } });
  searchEl.addEventListener('input', render);
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (!b) return;
    if (open.has(b.dataset.src)) open.delete(b.dataset.src); else open.add(b.dataset.src);
    render();
  });
  render();
}
