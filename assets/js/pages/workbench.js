// Bancada de trabalho: árvore de fabricação de um item, do produto final até os materiais básicos
// (recipes.json) e de onde vem cada material básico (sources.json: animal, inimigo, baú, coleta, chefe).
import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, iconImg, fmtNum, sourceList, sourceName } from '../data.js';

const MAX_DEPTH = 9;

export async function initWorkbenchPage(root, params) {
  const search = root.querySelector('#wb-search');
  const suggest = root.querySelector('#wb-suggest');
  const qtyEl = root.querySelector('#wb-qty');
  const out = root.querySelector('#wb-result');
  let items; let recipes; let benches; let sources; let creatures; let bosses;
  try {
    [items, recipes, benches, sources, creatures, bosses] = await Promise.all([
      loadIndex('items'), loadData('recipes'), loadData('benches'), loadData('sources').catch(() => ({})),
      loadIndex('creatures'), loadIndex('bosses').catch(() => new Map())
    ]);
  } catch (e) {
    out.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const recipesOf = new Map();
  recipes.forEach((r) => { if (!recipesOf.has(r.item)) recipesOf.set(r.item, []); recipesOf.get(r.item).push(r); });
  const craftable = [...recipesOf.keys()].map((id) => items.get(id)).filter(Boolean)
    .map((it) => ({ it, hay: normalize(`${it.name_pt} ${it.name_en}`) }));
  const choice = {};      // item -> índice da receita escolhida (quando há mais de uma)
  const groupPick = {};   // "item#grupo" -> material escolhido no "Escolha um"
  let current = null;

  const name = (id) => pick(items.get(id), 'name') || id;
  const benchName = (r) => {
    const b = benches[(r.benches || [])[0]];
    return b ? pick(b, 'name') : t('wb.byHand');
  };
  // nome da bancada com o ícone dela (fabricar à mão fica sem ícone)
  const benchHtml = (r) => {
    const b = benches[(r.benches || [])[0]];
    const icon = b?.icon ? `<img src="${esc(b.icon)}" alt="" loading="lazy" width="64" height="64" />` : '';
    return `${icon}<span>${esc(benchName(r))}</span>`;
  };
  const recipeOf = (id) => {
    const rs = recipesOf.get(id) || [];
    return { rs, ri: Math.min(choice[id] || 0, rs.length - 1), r: rs[Math.min(choice[id] || 0, rs.length - 1)] };
  };

  // árvore de cima para baixo: o produto no topo, os materiais embaixo ligados por linhas
  const totals = new Map();   // materiais básicos somados
  function expand(id, qty, depth, path) {
    const { r } = recipeOf(id);
    if (!r || depth >= MAX_DEPTH || path.has(id)) {
      totals.set(id, (totals.get(id) || 0) + qty);
      const src = sourceList(sources[id], creatures, bosses, 2);
      return `<div class="wb-src">${src || `<span class="wb-nosrc">${esc(t('wb.noSource'))}</span>`}</div>`;
    }
    const crafts = Math.ceil(qty / (r.count || 1));
    const next = new Set(path); next.add(id);
    const kids = r.ing.map((g, gi) => {
      if (g.ids.length < 2) return `<li class="wb-node">${itemNode(g.ids[0], crafts * g.n, depth + 1, next)}</li>`;
      const key = `${id}#${gi}`;
      const sel = Math.min(groupPick[key] || 0, g.ids.length - 1);
      const n = crafts * g.n;
      return `<li class="wb-node"><div class="wb-choose">
          <div class="wb-choose-head">&#9670; ${esc(t('wb.chooseOne'))}</div>
          ${g.ids.map((oid, oi) => `<button type="button" class="wb-opt${oi === sel ? ' is-on' : ''}" data-group="${esc(key)}" data-idx="${oi}">
            ${iconImg(items.get(oid), 'wb-opt-icon')}<span class="wb-opt-name">${esc(name(oid))}</span><span class="wb-opt-n">×${esc(fmtNum(n, 0))}</span></button>`).join('')}
        </div>${expand(g.ids[sel], n, depth + 1, next)}</li>`;
    }).join('');
    return `<ul class="wb-branch">${kids}</ul>`;
  }

  function itemNode(id, qty, depth, path) {
    const { rs, ri, r } = recipeOf(id);
    return `<div class="wb-card">
        <button type="button" class="wb-frame${r ? '' : ' wb-frame-leaf'}" data-item-link="${esc(id)}" title="${esc(name(id))}">${iconImg(items.get(id), 'wb-icon')}</button>
        <span class="wb-name">${esc(name(id))}</span>
        <span class="wb-n">×${esc(fmtNum(qty, 0))}</span>
        ${r ? `<span class="wb-bench">${benchHtml(r)}</span>` : ''}
        ${rs.length > 1 ? `<select class="wb-alt" data-alt="${esc(id)}" aria-label="${esc(t('wb.otherRecipe'))}">${rs.map((x, i) => `<option value="${i}" ${i === ri ? 'selected' : ''}>${esc(t('wb.recipeN', { n: i + 1 }))}</option>`).join('')}</select>` : ''}
      </div>${expand(id, qty, depth, path)}`;
  }

  function render() {
    if (!current) return;
    totals.clear();
    const qty = Math.max(1, Math.min(999, Number(qtyEl.value) || 1));
    const tree = `<ul class="wb-branch wb-root"><li class="wb-node">${itemNode(current, qty, 0, new Set())}</li></ul>`;
    const base = [...totals.entries()].sort((a, b) => name(a[0]).localeCompare(name(b[0])));
    out.innerHTML = `
      <section class="guide-tool wb-tree-box">
        <header class="guide-tool-head"><div><h2>${esc(name(current))}</h2><p>${esc(t('wb.treeHint'))}</p></div></header>
        <div class="wb-tree-scroll"><div class="wb-tree">${tree}</div></div>
      </section>
      <section class="guide-tool">
        <header class="guide-tool-head"><div><h2>${esc(t('wb.baseTitle'))}</h2><p>${esc(t('wb.baseHint'))}</p></div></header>
        <div class="wb-base">${base.map(([id, n]) => {
          const src = (sources[id] || [])[0];
          return `<div class="wb-base-row">
            <button type="button" class="wb-item" data-item-link="${esc(id)}">${iconImg(items.get(id), 'wb-icon')}<span class="wb-name">${esc(name(id))}</span><span class="wb-n">×${esc(fmtNum(n, 0))}</span></button>
            <span class="wb-base-src">${src ? `${esc(t(`src.${src.t}`))}: ${esc(sourceName(src, creatures, bosses))}` : esc(t('wb.noSource'))}</span>
          </div>`;
        }).join('')}</div>
      </section>`;
    const sc = out.querySelector('.wb-tree-scroll');
    if (sc) sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;   // árvore larga começa centrada no produto
  }

  function pickItem(id) {
    if (!recipesOf.has(id)) return;
    current = id;
    search.value = name(id);
    suggest.hidden = true;
    history.replaceState(null, '', `#bancada?item=${encodeURIComponent(id)}`);
    render();
  }

  search.addEventListener('input', () => {
    const q = normalize(search.value.trim());
    if (q.length < 2) { suggest.hidden = true; return; }
    const list = craftable.filter((x) => x.hay.includes(q))
      .sort((a, b) => (a.hay.startsWith(q) ? 0 : 1) - (b.hay.startsWith(q) ? 0 : 1) || pick(a.it, 'name').localeCompare(pick(b.it, 'name')))
      .slice(0, 12);
    suggest.innerHTML = list.length ? list.map(({ it }) => `<li><button type="button" data-pick="${esc(it.id)}">${iconImg(it, 'wb-icon')}<span>${esc(pick(it, 'name'))}</span></button></li>`).join('')
      : `<li class="wb-suggest-none">${esc(t('wb.noMatch'))}</li>`;
    suggest.hidden = false;
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = suggest.querySelector('[data-pick]'); if (first) pickItem(first.dataset.pick); }
    if (e.key === 'Escape') suggest.hidden = true;
  });
  suggest.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) pickItem(b.dataset.pick); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target) || !e.target.closest('.wb-pick')) suggest.hidden = true; });
  qtyEl.addEventListener('input', render);
  out.addEventListener('change', (e) => {
    const s = e.target.closest('[data-alt]');
    if (s) { choice[s.dataset.alt] = Number(s.value); render(); }
  });
  out.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-group]');
    if (opt) { groupPick[opt.dataset.group] = Number(opt.dataset.idx); render(); return; }
    const link = e.target.closest('[data-item-link]');
    if (link && window.openItemModal) { e.preventDefault(); window.openItemModal(link.dataset.itemLink); }
  });

  if (params.get('item')) pickItem(params.get('item'));
}
