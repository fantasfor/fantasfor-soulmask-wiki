import { t, pick } from '../i18n.js';
import { loadData, loadIndex, esc, escLines, normalize, L } from '../data.js';
import { loadFirebase, getUser, onUser, requireUser, publicName } from '../cloud.js';
import { summarize, starsDisplay, starsInput } from '../ratings.js';

const RANKS = [
  { name: 'A', color: '#e5c85c' },
  { name: 'B', color: '#7ebf79' },
  { name: 'C', color: '#78a9d1' },
  { name: 'D', color: '#b28acb' },
  { name: 'E', color: '#d98972' }
];
const RANK_NAMES = RANKS.map((r) => r.name);
const KEYS = {
  lists: 'soulmask-tier-lists',
  armadura: 'soulmask-tier-armor-v2',
  arma: 'soulmask-tier-weapon-v2',
  mascaras: 'soulmask-tier-mask-v2'
};
const OLD_KEYS = {
  armadura: 'soulmask-tier-armor-placements',
  arma: 'soulmask-tier-weapon-placements',
  mascaras: 'soulmask-tier-mask-placements'
};
const CATEGORY_LABEL = { armadura: 'tier.armor', arma: 'tier.weapon', mascaras: 'tier.masks', talentos: 'tier.talents' };
// nomes antigos das armas (PT) -> tipo de arma do jogo
const OLD_WEAPON_NAMES = {
  'Lâmina de Duas Mãos': 'shuangdao', Martelo: 'chui', 'Lâmina de Uma Mão': 'dao', 'Espada Grande': 'jian',
  Manoplas: 'quantao', 'Arco Longo': 'gong', Arco: 'gong', Lança: 'mao', 'Chicote de Espinhos': 'bian', Escudo: 'dun'
};

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch (e) { return fallback; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignora */ }
}

export async function initTierListPage(root) {
  const board = root.querySelector('#tier-list-board');
  const pools = {
    armadura: root.querySelector('#tier-list-armor-pool'),
    arma: root.querySelector('#tier-list-weapon-pool'),
    mascaras: root.querySelector('#tier-list-mask-pool')
  };
  const catButtons = [...root.querySelectorAll('.tier-category')];
  const tabButtons = [...root.querySelectorAll('.tier-tab')];
  const mine = root.querySelector('#tier-mine');
  const community = root.querySelector('#tier-community');
  const grid = root.querySelector('#tier-community-grid');
  const viewer = root.querySelector('#tier-viewer');
  const viewerBody = root.querySelector('#tier-viewer-body');
  const pubForm = root.querySelector('#tier-publish');
  const pubTitle = root.querySelector('#tier-publish-title');
  const pubNote = root.querySelector('#tier-publish-note');
  const pubStatus = root.querySelector('#tier-publish-status');
  const cSearch = root.querySelector('#tier-community-search');
  const cSort = root.querySelector('#tier-community-sort');

  let category = 'armadura';
  let view = 'mine';
  let selected = null;
  const lists = readJSON(KEYS.lists, {});

  let sets = []; let weapons = []; let masks = []; let meta = {}; let legacy = {}; let pieces;
  try {
    [sets, weapons, masks, meta, legacy, pieces] = await Promise.all([
      loadData('armor-sets'), loadData('weapons'), loadData('masks'), loadData('meta'),
      loadData('legacy-ids').catch(() => ({})), loadIndex('armor-pieces')
    ]);
  } catch (e) {
    board.innerHTML = `<p>${esc(t('common.errorLoading', { msg: e.message }))}</p>`;
    return;
  }

  // catálogos: id, nome, ícone (um ícone por tipo de arma: a versão aprimorada do jogo)
  const best = {};
  weapons.filter((w) => w.enhanced).forEach((w) => {
    if (w.wtype && w.icon && !best[w.wtype]) best[w.wtype] = { icon: w.icon };
  });
  const catalogs = {
    armadura: sets.map((s) => ({ id: String(s.id), name: pick(s, 'name'), icon: s.icon })),
    arma: Object.keys(best).map((k) => ({ id: k, name: L(meta.weaponTypes?.[k]) || k, icon: best[k].icon })),
    mascaras: masks.map((m) => ({ id: m.id, name: pick(m, 'name'), icon: m.icon }))
  };
  const catalogIdx = Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, new Map(v.map((x) => [x.id, x]))]));

  // posições salvas (com migração do formato antigo)
  const placements = {};
  Object.keys(catalogs).forEach((cat) => {
    let p = readJSON(KEYS[cat], null);
    if (!p) {
      p = {};
      const old = readJSON(OLD_KEYS[cat], {});
      Object.entries(old).forEach(([oldId, rank]) => {
        let nid = null;
        if (cat === 'armadura') nid = pieces.get(legacy.armor?.[oldId])?.set;
        if (cat === 'arma') nid = OLD_WEAPON_NAMES[oldId];
        if (cat === 'mascaras') nid = legacy.mask?.[oldId];
        if (nid) p[String(nid)] = rank;
      });
      if (Object.keys(p).length) writeJSON(KEYS[cat], p);
    }
    placements[cat] = p;
  });

  // ---------------------------------------------------------------- minha tier list
  function tile(entry, { draggable = true } = {}) {
    return `<button type="button" class="tier-armor-item${selected === entry.id ? ' is-selected' : ''}" ${draggable ? 'draggable="true"' : 'tabindex="-1"'} data-entry="${esc(entry.id)}" title="${esc(entry.name)}" aria-label="${esc(entry.name)}">
      ${entry.icon ? `<img src="${esc(entry.icon)}" alt="${esc(entry.name)}" loading="lazy" />` : esc(entry.name)}
    </button>`;
  }

  function rankHead(name) {
    return `<div class="tier-rank" aria-label="${esc(t('tier.level', { rank: name }))}">${name}</div>`;
  }

  function renderPoolBoard() {
    const cat = category;
    const catList = catalogs[cat];
    const place = placements[cat];
    const poolLabel = { armadura: 'tier.armorPool', arma: 'tier.weaponPool', mascaras: 'tier.maskPool' }[cat];
    pools[cat].innerHTML = `<h2>${esc(t(poolLabel))}</h2><div class="tier-armor-grid" data-pool="1">${catList.filter((e) => !place[e.id]).map((e) => tile(e)).join('')}</div>`;
    board.innerHTML = RANKS.map(({ name, color }) => `
      <section class="tier-row" data-rank="${name}" style="--tier-color:${color}">
        ${rankHead(name)}
        <div class="tier-content">${catList.filter((e) => place[e.id] === name).map((e) => tile(e)).join('')}</div>
      </section>`).join('');
  }

  function renderTextBoard() {
    board.innerHTML = RANKS.map(({ name, color }) => {
      const entries = lists[category]?.[name] || [];
      return `
        <section class="tier-row" style="--tier-color:${color}">
          ${rankHead(name)}
          <div class="tier-content">
            <form class="tier-entry-form" data-rank="${name}">
              <input class="tier-entry-input" name="entry" type="text" maxlength="80" placeholder="${esc(t('tier.addIn', { rank: name }))}" />
              <button class="tier-entry-submit" type="submit" aria-label="${esc(t('tier.addIn', { rank: name }))}">+</button>
            </form>
            ${entries.map((entry, i) => `<div class="tier-entry"><span class="tier-entry-name">${esc(entry)}</span><button class="tier-entry-remove" type="button" data-rank="${name}" data-index="${i}" aria-label="×">×</button></div>`).join('')}
          </div>
        </section>`;
    }).join('');
  }

  function renderMine() {
    Object.entries(pools).forEach(([k, p]) => { p.hidden = k !== category; });
    if (catalogs[category]) renderPoolBoard(); else renderTextBoard();
  }

  function place(id, rank) {
    if (rank) placements[category][id] = rank; else delete placements[category][id];
    writeJSON(KEYS[category], placements[category]);
    selected = null;
    renderMine();
  }

  // ranks atuais da categoria: { A: [ids ou textos], ... }
  function currentRanks(cat = category) {
    const out = {};
    RANK_NAMES.forEach((r) => { out[r] = []; });
    if (catalogs[cat]) {
      Object.entries(placements[cat]).forEach(([id, r]) => { if (out[r] && catalogIdx[cat].has(id)) out[r].push(id); });
    } else {
      RANK_NAMES.forEach((r) => { out[r] = (lists[cat]?.[r] || []).slice(0, 60).map((s) => String(s).slice(0, 80)); });
    }
    return out;
  }

  // ---------------------------------------------------------------- comunidade (Firebase)
  let communityDocs = [];
  let communityLoaded = false;
  let openDoc = null;

  async function fetchCommunity() {
    grid.innerHTML = `<p class="tier-muted">${esc(t('site.loading'))}</p>`;
    try {
      const fb = await loadFirebase();
      const { collection, query, orderBy, limit, getDocs } = fb.store;
      const snap = await getDocs(query(collection(fb.db, 'tierlists'), orderBy('updatedAt', 'desc'), limit(100)));
      communityDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      communityLoaded = true;
      renderCommunity();
    } catch (e) {
      console.warn('tierlists', e);
      grid.innerHTML = `<p class="tier-muted">${esc(t('tier.communityError'))}</p>`;
    }
  }

  function preview(doc) {
    const idx = catalogIdx[doc.category];
    return `<div class="tier-mini">${RANKS.map(({ name, color }) => {
      const entries = doc.ranks?.[name] || [];
      if (!entries.length) return '';
      const content = idx
        ? entries.slice(0, 8).map((id) => idx.get(id)).filter(Boolean).map((e) => `<img src="${esc(e.icon)}" alt="${esc(e.name)}" title="${esc(e.name)}" loading="lazy" />`).join('')
        : `<span class="tier-mini-text">${esc(entries.slice(0, 4).join(', '))}</span>`;
      return `<div class="tier-mini-row" style="--tier-color:${color}"><span>${name}</span><div>${content}</div></div>`;
    }).join('')}</div>`;
  }

  function renderCommunity() {
    if (!communityLoaded) return;
    const q = normalize(cSearch.value);
    const list = communityDocs
      .filter((d) => d.category === category)
      .filter((d) => !q || normalize(`${d.title} ${d.author} ${d.note || ''}`).includes(q))
      .map((d) => ({ d, r: summarize(d.ratings) }));
    const sort = cSort.value;
    list.sort((a, b) => {
      if (sort === 'recent') return (b.d.updatedAt?.seconds || 0) - (a.d.updatedAt?.seconds || 0);
      if (sort === 'votes') return b.r.count - a.r.count || b.r.avg - a.r.avg;
      // média bayesiana: poucas notas não dominam o topo
      const score = (x) => (x.r.avg * x.r.count + 3 * 2) / (x.r.count + 2);
      return score(b) - score(a);
    });
    grid.innerHTML = list.length ? list.map(({ d, r }) => `
      <button type="button" class="tier-card" data-doc="${esc(d.id)}">
        <span class="tier-card-head">
          <strong class="tier-card-title">${esc(d.title)}</strong>
          ${starsDisplay(r.avg, r.count, { compact: true })}
        </span>
        <span class="tier-card-meta">${d.photo ? `<img src="${esc(d.photo)}" alt="" referrerpolicy="no-referrer" />` : ''}${esc(d.author)} · ${esc(t('tier.reviewsN', { n: r.count }))}</span>
        ${preview(d)}
        ${d.note ? `<span class="tier-card-note">${esc(d.note)}</span>` : ''}
      </button>`).join('') : `<p class="tier-muted">${esc(t('tier.communityEmpty'))}</p>`;
  }

  function fullBoard(doc) {
    const idx = catalogIdx[doc.category];
    return RANKS.map(({ name, color }) => {
      const entries = doc.ranks?.[name] || [];
      const content = idx
        ? entries.map((id) => idx.get(id)).filter(Boolean).map((e) => tile(e, { draggable: false })).join('')
        : entries.map((s) => `<div class="tier-entry"><span class="tier-entry-name">${esc(s)}</span></div>`).join('');
      return `<section class="tier-row" style="--tier-color:${color}">${rankHead(name)}<div class="tier-content">${content}</div></section>`;
    }).join('');
  }

  function renderViewer() {
    const doc = openDoc;
    if (!doc) { viewer.hidden = true; return; }
    const u = getUser();
    const r = summarize(doc.ratings);
    const mineReview = u ? doc.ratings?.[u.uid] : null;
    const own = u && u.uid === doc.uid;
    const reviews = Object.entries(doc.ratings || {}).map(([uid, x]) => ({ uid, ...x })).filter((x) => x.s)
      .sort((a, b) => (b.t || 0) - (a.t || 0));
    viewerBody.innerHTML = `
      <header class="tier-viewer-head">
        <span class="tier-list-eyebrow">${esc(t(CATEGORY_LABEL[doc.category] || 'tier.title'))}</span>
        <h2 id="tier-viewer-title">${esc(doc.title)}</h2>
        <p class="tier-card-meta">${doc.photo ? `<img src="${esc(doc.photo)}" alt="" referrerpolicy="no-referrer" />` : ''}${esc(doc.author)}</p>
        ${starsDisplay(r.avg, r.count)}
      </header>
      ${doc.note ? `<div class="tier-note"><strong>${esc(t('tier.authorNote'))}</strong><p>${escLines(doc.note)}</p></div>` : ''}
      <div class="tier-list-board tier-viewer-board">${fullBoard(doc)}</div>
      <div class="tier-viewer-actions">
        <button type="button" class="tier-btn" data-act="copy">${esc(t('tier.copyToMine'))}</button>
        ${own ? `<button type="button" class="tier-btn danger" data-act="delete">${esc(t('tier.delete'))}</button>` : ''}
      </div>
      <section class="tier-review-box">
        <h3>${esc(t('tier.rateTitle'))}</h3>
        ${own ? `<p class="tier-muted">${esc(t('tier.ownList'))}</p>` : `
          <form class="tier-review-form" data-review>
            ${starsInput(mineReview?.s || 0)}
            <textarea class="tier-entry-input tier-textarea" name="comment" maxlength="300" rows="2" placeholder="${esc(t('tier.commentPlaceholder'))}">${esc(mineReview?.c || '')}</textarea>
            <div class="tier-publish-actions">
              <button type="submit" class="tier-btn primary">${esc(t(u ? 'tier.sendReview' : 'tier.loginToReview'))}</button>
              <span class="tier-muted" data-review-status aria-live="polite"></span>
            </div>
          </form>`}
        <ul class="tier-reviews">${reviews.map((x) => `
          <li>
            <span class="tier-review-head"><strong>${esc(x.n || t('account.anonymous'))}</strong>${starsDisplay(x.s, 1, { compact: true })}</span>
            ${x.c ? `<p>${escLines(x.c)}</p>` : ''}
          </li>`).join('') || `<li class="tier-muted">${esc(t('tier.noReviews'))}</li>`}</ul>
      </section>`;
    viewer.hidden = false;
  }

  function openViewer(id) {
    openDoc = communityDocs.find((d) => d.id === id) || null;
    renderViewer();
    viewer.querySelector('.tier-viewer-close')?.focus();
  }

  async function sendReview(form) {
    const status = form.querySelector('[data-review-status]');
    const u = await requireUser();
    if (!u || !openDoc) return;
    const stars = Number(form.dataset.stars || openDoc.ratings?.[u.uid]?.s || 0);
    if (!stars) { status.textContent = t('tier.pickStars'); return; }
    const review = { s: stars, n: publicName(u), t: Date.now() };
    const c = form.elements.comment.value.trim().slice(0, 300);
    if (c) review.c = c;
    status.textContent = t('account.syncing');
    try {
      const fb = await loadFirebase();
      await fb.store.updateDoc(fb.store.doc(fb.db, 'tierlists', openDoc.id), { [`ratings.${u.uid}`]: review });
      openDoc.ratings = { ...(openDoc.ratings || {}), [u.uid]: review };
      renderViewer();
      renderCommunity();
    } catch (e) {
      console.warn('review', e);
      status.textContent = t('tier.saveError');
    }
  }

  async function publish() {
    const u = await requireUser();
    if (!u) return;
    const ranks = currentRanks();
    if (!Object.values(ranks).some((x) => x.length)) { pubStatus.textContent = t('tier.publishEmpty'); return; }
    const title = pubTitle.value.trim().slice(0, 80);
    if (!title) { pubTitle.focus(); return; }
    pubStatus.textContent = t('account.syncing');
    try {
      const fb = await loadFirebase();
      const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = fb.store;
      const ref = doc(fb.db, 'tierlists', `${u.uid}_${category}`);
      const fields = {
        uid: u.uid, author: publicName(u), photo: (u.photoURL || '').slice(0, 500), title,
        note: pubNote.value.trim().slice(0, 1000), category, ranks, updatedAt: serverTimestamp()
      };
      const snap = await getDoc(ref);
      if (snap.exists()) await updateDoc(ref, fields);
      else await setDoc(ref, { ...fields, createdAt: serverTimestamp(), ratings: {} });
      pubStatus.textContent = t('tier.published');
      communityLoaded = false;
    } catch (e) {
      console.warn('publish', e);
      pubStatus.textContent = t('tier.saveError');
    }
  }

  // preenche o formulário com a lista já publicada (se houver)
  async function fillPublishForm() {
    const u = getUser();
    pubStatus.textContent = '';
    if (!u) { pubTitle.value = ''; pubNote.value = ''; return; }
    try {
      const fb = await loadFirebase();
      const snap = await fb.store.getDoc(fb.store.doc(fb.db, 'tierlists', `${u.uid}_${category}`));
      if (snap.exists()) {
        pubTitle.value = snap.data().title || '';
        pubNote.value = snap.data().note || '';
        pubStatus.textContent = t('tier.alreadyPublished');
      } else {
        pubTitle.value = '';
        pubNote.value = '';
      }
    } catch (e) { /* sem acesso: o envio mostra o erro */ }
  }

  // ---------------------------------------------------------------- navegação
  function render() {
    tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    mine.hidden = view !== 'mine';
    community.hidden = view !== 'community';
    if (view === 'mine') renderMine();
    else if (!communityLoaded) fetchCommunity();
    else renderCommunity();
  }

  tabButtons.forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); }));
  catButtons.forEach((b) => b.addEventListener('click', () => {
    category = b.dataset.category;
    selected = null;
    catButtons.forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    render();
    fillPublishForm();
  }));
  cSearch.addEventListener('input', renderCommunity);
  cSort.addEventListener('change', renderCommunity);
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('[data-doc]');
    if (c) openViewer(c.dataset.doc);
  });
  pubForm.addEventListener('submit', (e) => { e.preventDefault(); publish(); });

  viewer.addEventListener('click', async (e) => {
    if (e.target === viewer || e.target.closest('[data-close]')) { openDoc = null; renderViewer(); return; }
    const star = e.target.closest('[data-star]');
    if (star) {
      const form = star.closest('form');
      form.dataset.stars = star.dataset.star;
      form.querySelectorAll('[data-star]').forEach((b) => {
        const on = Number(b.dataset.star) <= Number(star.dataset.star);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(b === star));
      });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy' && openDoc) {
      const cat = openDoc.category;
      if (catalogs[cat]) {
        placements[cat] = {};
        RANK_NAMES.forEach((r) => (openDoc.ranks?.[r] || []).forEach((id) => { if (catalogIdx[cat].has(id)) placements[cat][id] = r; }));
        writeJSON(KEYS[cat], placements[cat]);
      } else {
        lists[cat] = {};
        RANK_NAMES.forEach((r) => { lists[cat][r] = [...(openDoc.ranks?.[r] || [])]; });
        writeJSON(KEYS.lists, lists);
      }
      openDoc = null;
      renderViewer();
      view = 'mine';
      render();
    }
    if (act === 'delete' && openDoc && window.confirm(t('tier.confirmDelete'))) {
      try {
        const fb = await loadFirebase();
        await fb.store.deleteDoc(fb.store.doc(fb.db, 'tierlists', openDoc.id));
        communityDocs = communityDocs.filter((d) => d.id !== openDoc.id);
        openDoc = null;
        renderViewer();
        renderCommunity();
      } catch (err) {
        alert(t('tier.saveError'));
      }
    }
  });
  viewer.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-review]');
    if (!form) return;
    e.preventDefault();
    sendReview(form);
  });
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape' && !viewer.hidden) { openDoc = null; renderViewer(); }
  };
  document.addEventListener('keydown', onKey);

  // minha tier list: clique para escolher e clique na linha para posicionar, ou arrastar
  mine.addEventListener('click', (e) => {
    if (!catalogs[category]) return;
    const item = e.target.closest('[data-entry]');
    if (item) {
      const id = item.dataset.entry;
      if (placements[category][id]) { place(id, null); return; }
      selected = selected === id ? null : id;
      renderMine();
      return;
    }
    const row = e.target.closest('.tier-row');
    if (row && selected) place(selected, row.dataset.rank);
  });
  mine.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-entry]');
    if (item) e.dataTransfer.setData('text/plain', `${category}:${item.dataset.entry}`);
  });
  mine.addEventListener('dragover', (e) => {
    if (e.target.closest('.tier-row, [data-pool]')) e.preventDefault();
  });
  mine.addEventListener('drop', (e) => {
    const target = e.target.closest('.tier-row, [data-pool]');
    if (!target) return;
    e.preventDefault();
    const [cat, id] = e.dataTransfer.getData('text/plain').split(':');
    if (cat !== category || !catalogs[cat]?.some((x) => x.id === id)) return;
    place(id, target.dataset.rank || null);
  });
  board.addEventListener('submit', (e) => {
    const form = e.target.closest('.tier-entry-form');
    if (!form) return;
    e.preventDefault();
    const v = form.elements.entry.value.trim();
    if (!v) return;
    lists[category] ||= {};
    (lists[category][form.dataset.rank] ||= []).push(v);
    writeJSON(KEYS.lists, lists);
    const rank = form.dataset.rank;
    renderMine();
    board.querySelector(`[data-rank="${rank}"] .tier-entry-input`)?.focus();
  });
  board.addEventListener('click', (e) => {
    const rm = e.target.closest('.tier-entry-remove');
    if (!rm) return;
    lists[category]?.[rm.dataset.rank]?.splice(Number(rm.dataset.index), 1);
    writeJSON(KEYS.lists, lists);
    renderMine();
  });

  const unsub = onUser(() => {
    if (!root.isConnected) { unsub(); return; }
    fillPublishForm();
    if (openDoc) renderViewer();
  });
  render();
}
