// Aba "Comunidade" do Builder Maker: builds publicadas pelos jogadores (Firestore builds/{uid_timestamp}).
// Cada build guarda o mesmo código do "Copiar link" do Builder (compact + base64url), então abrir uma build
// da comunidade é só ir para #builder-maker?b=CÓDIGO. Estrelas, comentários e resposta do autor: social.js.
// Regras de acesso: GDMbot/servidor/firestore.rules (match /builds/{id}).
// Não mexe no editor, nas builds salvas nem na exportação para o GDMbot (builder.js).
import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, L } from '../data.js';
import { loadFirebase, getUser, onUser, requireUser, publicName } from '../cloud.js';
import { summarize, starsDisplay } from '../ratings.js';
import { reviewsHtml, bindReviews, cardStats, score, docTime } from '../social.js';
import { favButton, bindFavButtons } from '../favorites.js';
import { compact, toBase64Url, fromBase64Url } from './builder.js';

const DRAFT_KEY = 'soulmask_builder_draft_v3'; // build aberta no editor (gravada pelo builder.js)
const MAX_PER_USER = 20;
const CODE_MAX = 6000;

// lê o código de uma build publicada -> objeto compacto { n, c, t, a, w, m, f, ... }
export function decodeBuild(code) {
  try { return JSON.parse(fromBase64Url(code)) || {}; } catch (e) { return {}; }
}

// dados do jogo para mostrar a build (ícones e nomes)
let catalog = null;
export function loadBuildCatalog() {
  if (!catalog) {
    catalog = Promise.all([loadData('talents'), loadIndex('masks'), loadIndex('weapons'), loadIndex('armor-pieces'), loadData('meta')])
      .then(([talents, masks, weapons, pieces, meta]) => ({ talents: new Map(talents.map((x) => [String(x.id), x])), masks, weapons, pieces, meta }))
      .catch((e) => { catalog = null; throw e; });
  }
  return catalog;
}

const icon = (x, cls = '') => (x?.icon ? `<img class="${cls}" src="${esc(x.icon)}" alt="${esc(pick(x, 'name'))}" title="${esc(pick(x, 'name'))}" loading="lazy" />` : '');

// miniatura: classe, máscara, armas e talentos
export function buildPreview(cat, code, { full = false } = {}) {
  const b = decodeBuild(code);
  const talents = (Array.isArray(b.t) ? b.t : []).map((id) => cat.talents.get(String(id))).filter(Boolean);
  const weapons = (Array.isArray(b.w) ? b.w : []).map((id) => cat.weapons.get(String(id))).filter(Boolean);
  const mask = cat.masks.get(String(b.m));
  const armor = Object.values(b.a && typeof b.a === 'object' ? b.a : {}).map((id) => cat.pieces.get(String(id))).filter(Boolean);
  const cls = L(cat.meta.classes?.[b.c]);
  if (!full) {
    return `<span class="bc-mini">
      ${cls ? `<span class="srv-chip">${esc(cls)}</span>` : ''}
      <span class="bc-mini-icons">${icon(mask)}${weapons.map((w) => icon(w)).join('')}${armor.slice(0, 6).map((p) => icon(p)).join('')}</span>
      <span class="bc-mini-icons bc-mini-talents">${talents.slice(0, 10).map((x) => icon(x)).join('')}</span>
    </span>`;
  }
  return `<div class="bc-full">
    ${cls ? `<p class="bc-full-class"><strong>${esc(t('builder.class'))}:</strong> ${esc(cls)}</p>` : ''}
    <div class="bc-full-gear">${[mask, ...weapons, ...armor].filter(Boolean).map((x) => `<span class="bc-gear">${icon(x)}<span>${esc(pick(x, 'name'))}</span></span>`).join('')}</div>
    ${talents.length ? `<h3 class="bc-full-title">${esc(t('bc.talents'))}</h3>
      <ul class="bc-talents">${talents.map((x) => `<li>${icon(x)}<span>${esc(pick(x, 'name'))}</span></li>`).join('')}</ul>` : ''}
  </div>`;
}

export async function initBuilderCommunity(root, params) {
  const tabs = root.querySelector('#builder-tabs');
  const shell = root.querySelector('.builder-shell');
  const panel = root.querySelector('#builder-community');
  if (!tabs || !shell || !panel) return;

  let docs = [];
  let loaded = false;
  let openDoc = null;
  let view = 'editor';

  panel.innerHTML = `
    <form class="tier-publish" id="bc-publish">
      <h2>${esc(t('bc.publishTitle'))}</h2>
      <p class="tier-muted">${esc(t('bc.publishHint'))}</p>
      <input class="tier-entry-input" name="title" maxlength="80" required placeholder="${esc(t('bc.titlePh'))}" />
      <textarea class="tier-entry-input tier-textarea" name="note" maxlength="1000" rows="3" placeholder="${esc(t('bc.notePh'))}"></textarea>
      <div class="tier-publish-actions">
        <button type="submit" class="tier-btn primary">${esc(t('tier.publish'))}</button>
        <span class="tier-muted" data-status aria-live="polite"></span>
      </div>
    </form>
    <div class="tier-community-bar bc-bar">
      <input type="search" class="tier-entry-input" id="bc-search" placeholder="${esc(t('bc.search'))}" aria-label="${esc(t('bc.search'))}" />
      <select class="tier-entry-input" id="bc-class" aria-label="${esc(t('builder.class'))}"><option value="">${esc(t('bc.allClasses'))}</option></select>
      <select class="tier-entry-input" id="bc-sort" aria-label="${esc(t('tier.sort'))}">
        <option value="rating">${esc(t('tier.sortRating'))}</option>
        <option value="recent">${esc(t('tier.sortRecent'))}</option>
        <option value="votes">${esc(t('tier.sortVotes'))}</option>
        <option value="mine">${esc(t('bc.mine'))}</option>
      </select>
    </div>
    <div class="tier-community-grid" id="bc-grid"></div>
    <div class="tier-viewer" id="bc-viewer" hidden>
      <section class="tier-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-viewer-title">
        <button type="button" class="tier-viewer-close" data-close aria-label="${esc(t('common.close'))}">&times;</button>
        <div id="bc-viewer-body"></div>
      </section>
    </div>`;
  const pubForm = panel.querySelector('#bc-publish');
  const pubStatus = pubForm.querySelector('[data-status]');
  const grid = panel.querySelector('#bc-grid');
  const search = panel.querySelector('#bc-search');
  const clsSel = panel.querySelector('#bc-class');
  const sortSel = panel.querySelector('#bc-sort');
  const viewer = panel.querySelector('#bc-viewer');
  const viewerBody = panel.querySelector('#bc-viewer-body');

  let cat;
  try {
    cat = await loadBuildCatalog();
  } catch (e) {
    grid.innerHTML = `<p class="tier-muted">${esc(t('common.errorLoading', { msg: e.message }))}</p>`;
    return;
  }
  clsSel.innerHTML += Object.entries(cat.meta.classes || {}).map(([k, c]) => `<option value="${esc(k)}">${esc(L(c))}</option>`).join('');

  const draft = () => {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  };
  const draftCode = () => {
    const d = draft();
    if (!d) return '';
    const c = compact({ optionalGroups: [], ...d });
    const empty = !(c.t || []).some(Boolean) && !Object.keys(c.a || {}).length && !(c.w || []).some(Boolean) && !c.m;
    return empty ? '' : toBase64Url(JSON.stringify(c));
  };

  // ---------------------------------------------------------------- abas
  function setView(v) {
    view = v;
    tabs.querySelectorAll('[data-btab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.btab === v)));
    shell.hidden = v !== 'editor';
    panel.hidden = v !== 'community';
    if (v === 'community') {
      const d = draft();
      if (!pubForm.elements.title.value) pubForm.elements.title.value = d?.name || '';
      if (!pubForm.elements.note.value) pubForm.elements.note.value = d?.description || '';
      if (!loaded) fetchDocs(); else renderGrid();
    }
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-btab]');
    if (b) setView(b.dataset.btab);
  });

  // ---------------------------------------------------------------- lista
  async function fetchDocs() {
    grid.innerHTML = `<p class="tier-muted">${esc(t('site.loading'))}</p>`;
    try {
      const fb = await loadFirebase();
      const { collection, query, orderBy, limit, getDocs } = fb.store;
      const snap = await getDocs(query(collection(fb.db, 'builds'), orderBy('updatedAt', 'desc'), limit(150)));
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded = true;
      renderGrid();
    } catch (e) {
      console.warn('builds', e);
      grid.innerHTML = `<p class="tier-muted">${esc(t('bc.loadError'))}</p>`;
    }
  }

  function renderGrid() {
    if (!loaded) return;
    const q = normalize(search.value);
    const u = getUser();
    const sort = sortSel.value;
    const list = docs
      .filter((d) => !clsSel.value || d.cls === clsSel.value)
      .filter((d) => sort !== 'mine' || (u && d.uid === u.uid))
      .filter((d) => !q || normalize(`${d.title} ${d.author} ${d.note || ''}`).includes(q))
      .map((d) => ({ d, r: summarize(d.ratings) }));
    list.sort((a, b) => {
      if (sort === 'recent' || sort === 'mine') return docTime(b.d) - docTime(a.d);
      if (sort === 'votes') return b.r.count - a.r.count || b.r.avg - a.r.avg;
      return score(b.d) - score(a.d);
    });
    grid.innerHTML = list.length ? list.map(({ d }) => `
      <button type="button" class="tier-card bc-card" data-doc="${esc(d.id)}">
        <span class="tier-card-head">
          <strong class="tier-card-title">${esc(d.title)}</strong>
          <span class="social-card-stats">${cardStats(d)}</span>
        </span>
        <span class="tier-card-meta">${d.photo ? `<img src="${esc(d.photo)}" alt="" referrerpolicy="no-referrer" />` : ''}${esc(d.author)}</span>
        ${buildPreview(cat, d.code)}
        ${d.note ? `<span class="tier-card-note">${esc(d.note)}</span>` : ''}
      </button>`).join('')
      : `<p class="tier-muted">${esc(t(sort === 'mine' ? 'bc.mineEmpty' : 'bc.empty'))}</p>`;
  }

  // ---------------------------------------------------------------- janela de uma build
  function renderViewer() {
    const d = openDoc;
    if (!d) { viewer.hidden = true; viewerBody.innerHTML = ''; return; }
    const u = getUser();
    const own = u && u.uid === d.uid;
    const r = summarize(d.ratings);
    viewerBody.innerHTML = `
      <header class="tier-viewer-head">
        <span class="tier-list-eyebrow">${esc(t('nav.builder'))}</span>
        <h2 id="bc-viewer-title">${esc(d.title)}</h2>
        <p class="tier-card-meta">${d.photo ? `<img src="${esc(d.photo)}" alt="" referrerpolicy="no-referrer" />` : ''}${esc(d.author)}</p>
        ${starsDisplay(r.avg, r.count)}
      </header>
      ${d.note ? `<div class="tier-note"><strong>${esc(t('tier.authorNote'))}</strong><p>${escLines(d.note)}</p></div>` : ''}
      ${buildPreview(cat, d.code, { full: true })}
      <div class="tier-viewer-actions">
        <a class="tier-btn primary bc-open" href="#builder-maker?b=${esc(d.code)}">${esc(t('bc.open'))}</a>
        <button type="button" class="tier-btn" data-act="link">${esc(t('social.copyLink'))}</button>
        ${favButton(`post:builds/${d.id}`)}
        ${own ? `<button type="button" class="tier-btn" data-act="update">${esc(t('bc.updateFromEditor'))}</button>
          <button type="button" class="tier-btn danger" data-act="delete">${esc(t('tier.delete'))}</button>` : ''}
      </div>
      <p class="tier-muted" data-act-status aria-live="polite"></p>
      ${reviewsHtml(d, { title: t('bc.rateTitle'), ownText: t('bc.ownBuild'), placeholder: t('bc.commentPh') })}`;
    viewer.hidden = false;
  }
  function openViewer(id) {
    openDoc = docs.find((d) => d.id === id) || null;
    renderViewer();
    viewer.querySelector('.tier-viewer-close')?.focus();
  }
  const closeViewer = () => { openDoc = null; renderViewer(); };

  bindReviews(viewer, { coll: 'builds', getDoc: () => openDoc, onChange: () => { renderViewer(); renderGrid(); } });
  bindFavButtons(viewer);

  // ---------------------------------------------------------------- publicar / atualizar / apagar
  async function publish() {
    const u = await requireUser();
    if (!u) return;
    const code = draftCode();
    if (!code) { pubStatus.textContent = t('bc.emptyBuild'); return; }
    if (code.length > CODE_MAX) { pubStatus.textContent = t('bc.tooBig'); return; }
    const title = pubForm.elements.title.value.trim().slice(0, 80);
    if (!title) { pubForm.elements.title.focus(); return; }
    if (loaded && docs.filter((d) => d.uid === u.uid).length >= MAX_PER_USER) { pubStatus.textContent = t('bc.maxReached', { n: MAX_PER_USER }); return; }
    pubStatus.textContent = t('account.syncing');
    try {
      const fb = await loadFirebase();
      const { doc, setDoc, serverTimestamp } = fb.store;
      const id = `${u.uid}_${Date.now()}`;
      await setDoc(doc(fb.db, 'builds', id), {
        uid: u.uid, author: publicName(u), photo: (u.photoURL || '').slice(0, 500), title,
        note: pubForm.elements.note.value.trim().slice(0, 1000), cls: String(draft()?.tribe || '').slice(0, 40), code,
        ratings: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      pubStatus.textContent = t('bc.published');
      pubForm.reset();
      sortSel.value = 'mine';
      await fetchDocs();
    } catch (e) {
      console.warn('publish build', e);
      pubStatus.textContent = t('tier.saveError');
    }
  }
  pubForm.addEventListener('submit', (e) => { e.preventDefault(); publish(); });

  viewer.addEventListener('click', async (e) => {
    if (e.target === viewer || e.target.closest('[data-close]')) { closeViewer(); return; }
    if (e.target.closest('.bc-open')) { openDoc = null; return; } // segue o link (abre no editor)
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const d = openDoc;
    if (!act || !d) return;
    const st = viewer.querySelector('[data-act-status]');
    if (act === 'link') {
      const url = `${location.origin}${location.pathname}#builder-maker?aba=comunidade&build=${encodeURIComponent(d.id)}`;
      try { await navigator.clipboard.writeText(url); } catch (err) { window.prompt('URL', url); }
      btn.textContent = t('map.copied');
      return;
    }
    if (act === 'update') {
      const code = draftCode();
      if (!code) { st.textContent = t('bc.emptyBuild'); return; }
      if (!window.confirm(t('bc.updateConfirm', { n: d.title }))) return;
      try {
        const fb = await loadFirebase();
        const fields = { code, cls: String(draft()?.tribe || '').slice(0, 40), updatedAt: fb.store.serverTimestamp() };
        await fb.store.updateDoc(fb.store.doc(fb.db, 'builds', d.id), fields);
        Object.assign(d, fields, { updatedAt: { seconds: Math.floor(Date.now() / 1000) } });
        renderViewer();
        renderGrid();
        viewer.querySelector('[data-act-status]').textContent = t('bc.updated');
      } catch (err) {
        console.warn('update build', err);
        st.textContent = t('tier.saveError');
      }
      return;
    }
    if (act === 'delete' && window.confirm(t('bc.confirmDelete'))) {
      try {
        const fb = await loadFirebase();
        await fb.store.deleteDoc(fb.store.doc(fb.db, 'builds', d.id));
        docs = docs.filter((x) => x.id !== d.id);
        closeViewer();
        renderGrid();
      } catch (err) {
        st.textContent = t('tier.saveError');
      }
    }
  });
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('[data-doc]');
    if (c) openViewer(c.dataset.doc);
  });
  [search, clsSel, sortSel].forEach((x) => x.addEventListener('input', renderGrid));
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape' && !viewer.hidden) closeViewer();
  };
  document.addEventListener('keydown', onKey);
  const unsub = onUser(() => {
    if (!root.isConnected) { unsub(); return; }
    renderGrid();
    if (openDoc) renderViewer();
  });

  // link direto: #builder-maker?aba=comunidade&build=ID (usado também pela página Comunidade)
  if (params?.get('aba') === 'comunidade') {
    setView('community');
    const linked = params.get('build');
    if (linked) {
      await fetchDocs();
      if (!docs.some((d) => d.id === linked)) {
        try {
          const fb = await loadFirebase();
          const snap = await fb.store.getDoc(fb.store.doc(fb.db, 'builds', linked));
          if (snap.exists()) docs.push({ id: snap.id, ...snap.data() });
        } catch (e) { /* apagada */ }
      }
      openViewer(linked);
    }
  }
}
