// Bancada de trabalho: árvore de fabricação de um item, do produto final até os materiais básicos
// (recipes.json) e de onde vem cada material básico (sources.json: animal, inimigo, baú, coleta, chefe).
import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, normalize, iconImg, fmtNum, sourceList, sourceName, rarityIcon } from '../data.js';

// ícone de raridade ao lado do nome (tooltip com o nome oficial da qualidade)
let qualityMeta = null;
loadData('meta').then((m) => { qualityMeta = m; }).catch(() => {});
const rarityOf = (it) => (it?.quality ? `${rarityIcon(qualityMeta, it.quality)} ` : '');

const MAX_DEPTH = 9;

export async function initWorkbenchPage(root, params) {
  const search = root.querySelector('#wb-search');
  const suggest = root.querySelector('#wb-suggest');
  const qtyEl = root.querySelector('#wb-qty');
  const out = root.querySelector('#wb-result');          // materiais totais (coluna da esquerda)
  const treeArea = root.querySelector('#wb-tree-area');  // árvore (coluna da direita)
  const main = root.querySelector('#wb-main');           // as duas colunas (eventos)
  const titleEl = root.querySelector('#wb-tree-title');
  const hintEl = root.querySelector('#wb-hint');
  const DEFAULT_ITEM = 'DaoJu_Item_PiGe_4';               // Couro Delicado: aberto quando a URL não traz item

  // no PC, as duas colunas ocupam a altura que sobra na tela (sem rolar a página); no celular, empilham
  function fitHeight() {
    if (!main.isConnected) { window.removeEventListener('resize', fitHeight); return; }
    const top = main.getBoundingClientRect().top + window.scrollY;
    main.style.setProperty('--wb-h', `${Math.max(460, window.innerHeight - top - 16)}px`);
  }
  window.addEventListener('resize', fitHeight);
  fitHeight();
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
  // bancada como ícone grande ao lado do item, com moldura própria e o selo de bancada (à mão não tem ícone)
  const benchFrame = (r) => {
    const b = benches[(r.benches || [])[0]];
    if (!b?.icon) return '';
    return `<span class="wb-bench-frame" title="${esc(benchName(r))}" aria-label="${esc(benchName(r))}">
        <img src="${esc(b.icon)}" alt="" loading="lazy" width="64" height="64" />
        <svg class="wb-bench-seal" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M6 21v-4h12v4M9 17v-3h6v3"/><path d="M14 3l4 4-6 6-4-4z"/></svg>
      </span>`;
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
        <span class="wb-frames">
          <button type="button" class="wb-frame${r ? '' : ' wb-frame-leaf'}" data-item-link="${esc(id)}" title="${esc(name(id))}">${iconImg(items.get(id), 'wb-icon')}</button>
          ${r ? benchFrame(r) : ''}
        </span>
        <span class="wb-name">${rarityOf(items.get(id))}${esc(name(id))}</span>
        <span class="wb-n">×${esc(fmtNum(qty, 0))}</span>
        ${r ? `<span class="wb-bench"><span>${esc(benchName(r))}</span></span>` : ''}
        ${rs.length > 1 ? `<select class="wb-alt" data-alt="${esc(id)}" aria-label="${esc(t('wb.otherRecipe'))}">${rs.map((x, i) => `<option value="${i}" ${i === ri ? 'selected' : ''}>${esc(t('wb.recipeN', { n: i + 1 }))}</option>`).join('')}</select>` : ''}
      </div>${expand(id, qty, depth, path)}`;
  }

  function render() {
    if (!current) return;
    totals.clear();
    const qty = Math.max(1, Math.min(999, Number(qtyEl.value) || 1));
    const tree = `<ul class="wb-branch wb-root"><li class="wb-node">${itemNode(current, qty, 0, new Set())}</li></ul>`;
    const base = [...totals.entries()].sort((a, b) => name(a[0]).localeCompare(name(b[0])));
    // o topo da árvore mostra o item escolhido e a dica de leitura
    titleEl.textContent = name(current);
    hintEl.textContent = t('wb.treeHint');
    treeArea.innerHTML = `<div class="wb-tree-scroll"><div class="wb-tree">${tree}</div></div>`;
    out.innerHTML = `
      <h3 class="wb-base-title">${esc(t('wb.baseTitle'))}</h3>
      <p class="wb-side-hint">${esc(t('wb.baseHint'))}</p>
      <div class="wb-base">${base.map(([id, n]) => {
        const src = (sources[id] || [])[0];
        return `<div class="wb-base-row">
          <button type="button" class="wb-item" data-item-link="${esc(id)}">${iconImg(items.get(id), 'wb-icon')}<span class="wb-name">${esc(name(id))}</span><span class="wb-n">×${esc(fmtNum(n, 0))}</span></button>
          <span class="wb-base-src">${src ? `${esc(t(`src.${src.t}`))}: ${esc(sourceName(src, creatures, bosses))}` : esc(t('wb.noSource'))}</span>
        </div>`;
      }).join('')}</div>`;
    fitHeight();
    const sc = treeArea.querySelector('.wb-tree-scroll');
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
    suggest.innerHTML = list.length ? list.map(({ it }) => `<li><button type="button" data-pick="${esc(it.id)}">${iconImg(it, 'wb-icon')}<span>${rarityOf(it)}${esc(pick(it, 'name'))}</span></button></li>`).join('')
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
  main.addEventListener('change', (e) => {
    const s = e.target.closest('[data-alt]');
    if (s) { choice[s.dataset.alt] = Number(s.value); render(); }
  });
  // arrastar a árvore com o mouse, como num mapa (no celular o dedo já rola a área sozinho).
  // Só vira arrasto depois de mover alguns pixels; assim clicar em item, "Escolha um" e receita continua normal.
  let drag = null;
  let justDragged = false;
  main.addEventListener('pointerdown', (e) => {
    const sc = e.target.closest('.wb-tree-scroll');
    if (!sc || e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('select, input, textarea')) return;
    drag = { sc, id: e.pointerId, x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop, moving: false };
  });
  main.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      drag.moving = true;
      drag.sc.classList.add('is-dragging');
      try { drag.sc.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    }
    e.preventDefault();
    drag.sc.scrollLeft = drag.left - dx;
    drag.sc.scrollTop = drag.top - dy;
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.moving) {
      justDragged = true;   // o clique que vem logo depois do arrasto é ignorado
      setTimeout(() => { justDragged = false; }, 0);
      drag.sc.classList.remove('is-dragging');
    }
    drag = null;
  };
  main.addEventListener('pointerup', endDrag);
  main.addEventListener('pointercancel', endDrag);
  main.addEventListener('lostpointercapture', endDrag);
  main.addEventListener('click', (e) => {
    if (justDragged) { e.preventDefault(); e.stopPropagation(); justDragged = false; }
  }, true);
  main.addEventListener('dragstart', (e) => { if (e.target.closest('.wb-tree-scroll')) e.preventDefault(); });

  main.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-group]');
    if (opt) { groupPick[opt.dataset.group] = Number(opt.dataset.idx); render(); return; }
    const link = e.target.closest('[data-item-link]');
    if (link && window.openItemModal) { e.preventDefault(); window.openItemModal(link.dataset.itemLink); }
  });

  // sem item na URL (ou item que não se fabrica), abre o Couro Delicado
  pickItem(params.get('item') && recipesOf.has(params.get('item')) ? params.get('item') : DEFAULT_ITEM);
}
