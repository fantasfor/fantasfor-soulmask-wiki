// Página Comunidade: junta num só lugar o que os jogadores publicam no site
// (builds do Builder Maker, tier lists e servidores), com filtro por tipo, ordem, busca,
// estrelas/comentários/resposta do autor (social.js) e favoritos (favorites.js).
// Cada publicação continua morando na sua coleção e na sua página; aqui só lemos e avaliamos.
import { t, locale } from '../i18n.js';
import { esc, escLines, normalize } from '../data.js';
import { loadFirebase, onUser } from '../cloud.js';
import { summarize, starsDisplay } from '../ratings.js';
import { reviewsHtml, bindReviews, cardStats, commentCount, score, docTime } from '../social.js';
import { favButton, bindFavButtons, getFavs, favPages, pageIcon, pageLabel } from '../favorites.js';
import { buildPreview, loadBuildCatalog } from './builder-community.js';

const TIER_CAT = { armadura: 'tier.armor', arma: 'tier.weapon', mascaras: 'tier.masks', talentos: 'tier.talents' };
const ACTIVE_DAYS = 60; // mesmo prazo da página de servidores
const TYPES = {
  build: { coll: 'builds', label: 'cm.build' },
  tier: { coll: 'tierlists', label: 'cm.tier' },
  server: { coll: 'servers', label: 'cm.server' }
};

// publicação -> item comum da página
function normalizeDoc(type, d) {
  const base = { type, coll: TYPES[type].coll, id: d.id, doc: d, favId: `post:${TYPES[type].coll}/${d.id}` };
  if (type === 'server') {
    return {
      ...base, title: d.name, author: d.author, photo: '', text: d.desc || '', time: docTime(d, 'createdAt'),
      link: `#servidores?id=${encodeURIComponent(d.id)}`, openLabel: 'cm.openServer'
    };
  }
  if (type === 'tier') {
    return {
      ...base, title: d.title, author: d.author, photo: d.photo, text: d.note || '', time: docTime(d),
      link: `#tier-list?lista=${encodeURIComponent(d.id)}`, openLabel: 'cm.openTier'
    };
  }
  return {
    ...base, title: d.title, author: d.author, photo: d.photo, text: d.note || '', time: docTime(d),
    link: `#builder-maker?aba=comunidade&build=${encodeURIComponent(d.id)}`, openLabel: 'cm.openBuild'
  };
}

export async function initCommunityPage(root, params) {
  const grid = root.querySelector('#cm-grid');
  const favPagesBox = root.querySelector('#cm-fav-pages');
  const typeBtns = [...root.querySelectorAll('.cm-types [data-type]')];
  const search = root.querySelector('#cm-search');
  const sortSel = root.querySelector('#cm-sort');
  const viewer = root.querySelector('#cm-viewer');
  const body = root.querySelector('#cm-viewer-body');
  let items = [];
  let type = ['build', 'tier', 'server', 'favoritos'].includes(params?.get('tipo')) ? params.get('tipo') : '';
  let open = null;
  let cat = null;

  // ---------------------------------------------------------------- carregar
  async function load() {
    try {
      const fb = await loadFirebase();
      const { collection, query, orderBy, limit, getDocs } = fb.store;
      const get = (name, q) => getDocs(q || collection(fb.db, name))
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
        .catch((e) => { console.warn('comunidade', name, e); return []; });
      const [builds, tiers, servers] = await Promise.all([
        get('builds', query(collection(fb.db, 'builds'), orderBy('updatedAt', 'desc'), limit(150))),
        get('tierlists', query(collection(fb.db, 'tierlists'), orderBy('updatedAt', 'desc'), limit(150))),
        get('servers')
      ]);
      const activeSince = Date.now() - ACTIVE_DAYS * 24 * 3600 * 1000;
      items = [
        ...builds.map((d) => normalizeDoc('build', d)),
        ...tiers.map((d) => normalizeDoc('tier', d)),
        ...servers.filter((d) => docTime(d) > activeSince).map((d) => normalizeDoc('server', d))
      ];
      if (builds.length) cat = await loadBuildCatalog().catch(() => null);
      render();
      const linked = params?.get('abrir');
      if (linked) openItem(linked);
    } catch (e) {
      console.warn('comunidade', e);
      grid.innerHTML = `<p class="tier-muted">${esc(t('cm.loadError'))}</p>`;
    }
  }

  // ---------------------------------------------------------------- lista
  function preview(it) {
    const d = it.doc;
    if (it.type === 'build') return cat ? buildPreview(cat, d.code) : '';
    if (it.type === 'tier') {
      const n = Object.values(d.ranks || {}).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0);
      return `<span class="bc-mini"><span class="srv-chip">${esc(t(TIER_CAT[d.category] || 'tier.title'))}</span><span class="srv-chip">${esc(t('cm.entriesN', { n }))}</span></span>`;
    }
    return `<span class="bc-mini">
      <span class="srv-mode srv-mode-${esc(d.mode)}">${esc(t(`srv.modeName.${d.mode}`))}</span>
      <span class="srv-chip">${esc(t(`events.reg.${d.region}`))}</span>
      ${d.lang ? `<span class="srv-chip">${esc(d.lang)}</span>` : ''}
    </span>`;
  }

  function card(it) {
    const d = it.doc;
    const img = it.type === 'server' ? (d.icon ? `<img class="cm-card-icon" src="${esc(d.icon)}" alt="" loading="lazy" />` : '')
      : (it.photo ? `<img src="${esc(it.photo)}" alt="" referrerpolicy="no-referrer" />` : '');
    return `<article class="tier-card cm-card cm-card-${it.type}" data-open="${esc(it.favId)}" tabindex="0" aria-label="${esc(it.title)}">
      <span class="tier-card-head">
        <span class="cm-type cm-type-${it.type}">${esc(t(TYPES[it.type].label))}</span>
        ${favButton(it.favId, { compact: true })}
      </span>
      <strong class="tier-card-title">${esc(it.title)}</strong>
      <span class="tier-card-meta">${img}${esc(it.author || t('account.anonymous'))}${it.time ? ` · ${esc(new Date(it.time).toLocaleDateString(locale()))}` : ''}</span>
      ${preview(it)}
      ${it.text ? `<span class="tier-card-note">${esc(it.text)}</span>` : ''}
      <span class="social-card-stats">${cardStats(d)}</span>
    </article>`;
  }

  function filtered() {
    const q = normalize(search.value);
    const favs = new Set(getFavs());
    return items.filter((it) => (!type || (type === 'favoritos' ? favs.has(it.favId) : it.type === type))
      && (!q || normalize(`${it.title} ${it.author} ${it.text}`).includes(q)));
  }

  function render() {
    const favs = new Set(getFavs());
    const counts = { '': items.length, favoritos: items.filter((it) => favs.has(it.favId)).length };
    items.forEach((it) => { counts[it.type] = (counts[it.type] || 0) + 1; });
    root.querySelectorAll('[data-n]').forEach((s) => { s.textContent = `(${counts[s.dataset.n] || 0})`; });
    typeBtns.forEach((b) => { const on = b.dataset.type === type; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });

    const pages = type === 'favoritos' ? favPages() : [];
    favPagesBox.innerHTML = type === 'favoritos' ? `<div class="cm-fav-pages">
      <h2>${esc(t('cm.favPages'))}</h2>
      ${pages.length ? `<div class="home-fav-list">${pages.map((p) => `<a class="home-fav-link" href="#${esc(p)}"><img src="${esc(pageIcon(p))}" alt="" aria-hidden="true" /><span>${esc(pageLabel(p))}</span></a>`).join('')}</div>`
        : `<p class="tier-muted">${esc(t('fav.emptyHome'))}</p>`}
      <h2>${esc(t('cm.favPosts'))}</h2></div>` : '';

    const list = filtered();
    const sort = sortSel.value;
    list.sort((a, b) => {
      if (sort === 'recent') return b.time - a.time;
      if (sort === 'comments') return commentCount(b.doc) - commentCount(a.doc) || b.time - a.time;
      if (sort === 'votes') return summarize(b.doc.ratings).count - summarize(a.doc.ratings).count || score(b.doc) - score(a.doc);
      return score(b.doc) - score(a.doc) || b.time - a.time;
    });
    grid.innerHTML = list.length ? list.map(card).join('')
      : `<p class="tier-muted">${esc(t(type === 'favoritos' ? 'cm.favEmpty' : 'cm.empty'))}</p>`;
  }

  // ---------------------------------------------------------------- janela
  function renderViewer() {
    if (!open) { viewer.hidden = true; body.innerHTML = ''; return; }
    const it = open;
    const d = it.doc;
    const r = summarize(d.ratings);
    const tierBoard = it.type === 'tier' ? `<div class="cm-tier-text">${['A', 'B', 'C', 'D', 'E'].map((rk) => {
      const n = (d.ranks?.[rk] || []).length;
      return n ? `<span class="srv-chip">${rk}: ${n}</span>` : '';
    }).join('')}</div>` : '';
    body.innerHTML = `
      <header class="tier-viewer-head">
        <span class="tier-list-eyebrow">${esc(t(TYPES[it.type].label))}</span>
        <h2 id="cm-viewer-title">${esc(it.title)}</h2>
        <p class="tier-card-meta">${it.photo ? `<img src="${esc(it.photo)}" alt="" referrerpolicy="no-referrer" />` : ''}${esc(it.author || t('account.anonymous'))}</p>
        ${starsDisplay(r.avg, r.count)}
      </header>
      ${it.text ? `<div class="tier-note"><p>${escLines(it.text)}</p></div>` : ''}
      ${it.type === 'build' && cat ? buildPreview(cat, d.code, { full: true }) : preview(it)}
      ${tierBoard}
      <div class="tier-viewer-actions">
        <a class="tier-btn primary" href="${esc(it.link)}" data-follow>${esc(t(it.openLabel))}</a>
        ${favButton(it.favId)}
        <button type="button" class="tier-btn" data-act="link">${esc(t('social.copyLink'))}</button>
      </div>
      ${reviewsHtml(d, { placeholder: t(it.type === 'server' ? 'srv.commentPlaceholder' : 'tier.commentPlaceholder') })}`;
    viewer.hidden = false;
  }
  function openItem(favId) {
    open = items.find((it) => it.favId === favId) || null;
    renderViewer();
    viewer.querySelector('.tier-viewer-close')?.focus();
  }
  const closeViewer = () => { open = null; renderViewer(); };

  bindReviews(viewer, {
    coll: (d) => open?.coll || TYPES.build.coll,
    getDoc: () => open?.doc,
    // servidores: toda edição do dono também confirma que está ativo (exigido pelas regras)
    ownerExtra: (fb) => (open?.type === 'server' ? { updatedAt: fb.store.serverTimestamp() } : {}),
    onChange: () => { renderViewer(); render(); }
  });
  bindFavButtons(viewer);
  bindFavButtons(grid);

  viewer.addEventListener('click', async (e) => {
    if (e.target === viewer || e.target.closest('[data-close]')) { closeViewer(); return; }
    if (e.target.closest('[data-follow]')) { open = null; return; }
    const btn = e.target.closest('[data-act="link"]');
    if (btn && open) {
      const url = `${location.origin}${location.pathname}#comunidade?abrir=${encodeURIComponent(open.favId)}`;
      try { await navigator.clipboard.writeText(url); } catch (err) { window.prompt('URL', url); }
      btn.textContent = t('map.copied');
    }
  });
  grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-fav]')) return;
    const c = e.target.closest('[data-open]');
    if (c) openItem(c.dataset.open);
  });
  grid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); openItem(e.target.dataset.open); }
  });
  typeBtns.forEach((b) => b.addEventListener('click', () => { type = b.dataset.type; render(); }));
  search.addEventListener('input', render);
  sortSel.addEventListener('change', render);
  const onFavs = () => { if (!root.isConnected) { window.removeEventListener('favs-changed', onFavs); return; } if (items.length) render(); };
  window.addEventListener('favs-changed', onFavs);
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape' && !viewer.hidden) closeViewer();
  };
  document.addEventListener('keydown', onKey);
  const unsub = onUser(() => {
    if (!root.isConnected) { unsub(); return; }
    if (items.length) render();
    if (open) renderViewer();
  });
  render();
  grid.innerHTML = `<p class="tier-muted">${esc(t('site.loading'))}</p>`;
  await load();
}
