// Servidores da comunidade (Firestore: servers/{uid_timestamp}). Regras: GDMbot/servidor/firestore.rules
// - Adicionar/editar só com login; cada um avalia com estrelas (e comentário) os servidores dos outros.
// - Destaque pago (Mercado Pago, rota /api/createServerBoost): fica no topo por 30 dias, ordenado pelo valor pago;
//   os 3 primeiros aparecem maiores. "boost"/"boostUntil" só o servidor grava (webhook).
import { t } from '../i18n.js';
import { esc, normalize, fmtNum } from '../data.js';
import { loadFirebase, getUser, onUser, requireUser, publicName } from '../cloud.js';
import { summarize, starsDisplay, starsInput } from '../ratings.js';

const MODES = ['pvp', 'pve', 'pvpve'];
const REGIONS = ['SouthAmerica', 'America', 'Europe', 'Asia', 'Oceania'];
const MAPS = ['main', 'dlc', 'both'];
const GAME_MODES = ['survival', 'tribe', 'warrior', 'pvp', 'casual', 'custom'];
const ICON_SIZE = 128;

const isUrl = (s) => /^https:\/\/[^\s<>"]{3,190}$/i.test(s || '');
const escLines = (s) => esc(s).replace(/\n/g, '<br>');
const boosted = (d) => (Number(d.boostUntil) || 0) > Date.now() && (Number(d.boost) || 0) > 0;

// imagem enviada -> quadrado 128 px em WebP (data URL guardada no próprio documento)
function iconFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('type')); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = ICON_SIZE; c.height = ICON_SIZE;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, ICON_SIZE, ICON_SIZE);
      let url = c.toDataURL('image/webp', 0.82);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
      resolve(url);
    };
    img.onerror = () => reject(new Error('load'));
    img.src = URL.createObjectURL(file);
  });
}

export async function initServersPage(root, params) {
  let config = {};
  try { config = JSON.parse(root.querySelector('#serversConfig').textContent); } catch (e) { /* padrão */ }
  const grid = root.querySelector('#srv-grid');
  const featured = root.querySelector('#srv-featured');
  const count = root.querySelector('#srv-count');
  const status = root.querySelector('#srv-status');
  const viewer = root.querySelector('#srv-viewer');
  const body = root.querySelector('#srv-viewer-body');
  const [qEl, modeEl, regionEl, sortEl] = ['#srv-search', '#srv-mode', '#srv-region', '#srv-sort'].map((s) => root.querySelector(s));
  let docs = [];
  let openId = null;

  const say = (msg) => { status.hidden = !msg; status.textContent = msg || ''; };
  const back = params?.get('destaque');
  if (back) say(t(`srv.boostBack.${back}`));

  async function load() {
    try {
      const fb = await loadFirebase();
      const snap = await fb.store.getDocs(fb.store.collection(fb.db, 'servers'));
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    } catch (e) {
      console.warn('servers', e);
      grid.innerHTML = `<div class="items-error">${esc(t('srv.loadError'))}</div>`;
      count.textContent = '';
    }
  }

  const badges = (d) => `
    <span class="srv-mode srv-mode-${esc(d.mode)}">${esc(t(`srv.modeName.${d.mode}`))}</span>
    <span class="srv-chip">${esc(t(`events.reg.${d.region}`))}</span>
    ${d.lang ? `<span class="srv-chip">${esc(d.lang)}</span>` : ''}
    <span class="srv-chip">${esc(t(`srv.map.${d.map}`))}</span>
    ${d.gameMode && d.gameMode !== 'custom' ? `<span class="srv-chip">${esc(t(`map.mode.${d.gameMode}`))}</span>` : ''}
    ${d.slots ? `<span class="srv-chip">${esc(t('srv.slotsN', { n: d.slots }))}</span>` : ''}`;

  function card(d, rank = 0) {
    const r = summarize(d.ratings);
    return `<button type="button" class="srv-card${rank ? ` srv-top srv-top-${rank}` : ''}${boosted(d) ? ' is-boosted' : ''}" data-open="${esc(d.id)}">
      ${rank ? `<span class="srv-rank">${rank}</span>` : boosted(d) ? `<span class="srv-boost-tag">${esc(t('srv.featuredTag'))}</span>` : ''}
      <span class="srv-card-head">
        ${d.icon ? `<img class="srv-icon" src="${esc(d.icon)}" alt="" />` : '<span class="srv-icon srv-icon-empty"></span>'}
        <span class="srv-card-title"><strong>${esc(d.name)}</strong>${starsDisplay(r.avg, r.count, { compact: true })}</span>
      </span>
      <span class="srv-badges">${badges(d)}</span>
      ${d.desc ? `<span class="srv-desc">${esc(d.desc.slice(0, rank === 1 ? 260 : 140))}${d.desc.length > (rank === 1 ? 260 : 140) ? '...' : ''}</span>` : ''}
      ${(d.tags || []).length ? `<span class="srv-tags">${d.tags.map((x) => `<i>#${esc(x)}</i>`).join('')}</span>` : ''}
    </button>`;
  }

  function render() {
    const q = normalize(qEl.value);
    const list = docs.filter((d) => (!modeEl.value || d.mode === modeEl.value) && (!regionEl.value || d.region === regionEl.value)
      && (!q || normalize(`${d.name} ${d.desc} ${(d.tags || []).join(' ')} ${d.lang} ${d.author}`).includes(q)));
    const top = list.filter(boosted).sort((a, b) => (b.boost || 0) - (a.boost || 0) || (a.boostUntil || 0) - (b.boostUntil || 0));
    const rest = list.filter((d) => !boosted(d)).map((d) => ({ d, r: summarize(d.ratings) }));
    rest.sort((a, b) => {
      if (sortEl.value === 'recent') return (b.d.createdAt?.seconds || 0) - (a.d.createdAt?.seconds || 0);
      if (sortEl.value === 'votes') return b.r.count - a.r.count || b.r.avg - a.r.avg;
      const sc = (x) => (x.r.avg * x.r.count + 3 * 2) / (x.r.count + 2);
      return sc(b) - sc(a);
    });
    featured.innerHTML = top.length ? `
      <h2 class="comfort-section-title">${esc(t('srv.featured'))}</h2>
      <div class="srv-podium">${top.slice(0, 3).map((d, i) => card(d, i + 1)).join('')}</div>
      ${top.length > 3 ? `<div class="srv-grid">${top.slice(3).map((d) => card(d)).join('')}</div>` : ''}` : '';
    count.textContent = t('srv.count', { n: list.length });
    grid.innerHTML = rest.length ? rest.map(({ d }) => card(d)).join('')
      : (top.length ? '' : `<p class="tier-muted">${esc(t('srv.empty'))}</p>`);
    if (openId) renderViewer();
  }

  // ---------------------------------------------------------------- janela do servidor
  function renderViewer() {
    const d = docs.find((x) => x.id === openId);
    if (!d) { closeViewer(); return; }
    const u = getUser();
    const own = u && u.uid === d.uid;
    const r = summarize(d.ratings);
    const mine = u ? d.ratings?.[u.uid] : null;
    const reviews = Object.values(d.ratings || {}).filter((x) => x?.s).sort((a, b) => (b.t || 0) - (a.t || 0));
    body.innerHTML = `
      <header class="srv-view-head">
        ${d.icon ? `<img class="srv-icon srv-icon-lg" src="${esc(d.icon)}" alt="" />` : ''}
        <div>
          <h2 id="srv-viewer-title">${esc(d.name)}</h2>
          ${starsDisplay(r.avg, r.count)}
          <p class="tier-card-meta">${esc(t('srv.by', { n: d.author || t('account.anonymous') }))}${boosted(d) ? ` · <span class="srv-boost-tag srv-boost-inline">${esc(t('srv.featuredUntil', { d: new Date(d.boostUntil).toLocaleDateString() }))}</span>` : ''}</p>
        </div>
      </header>
      <div class="srv-badges">${badges(d)}</div>
      ${d.desc ? `<p class="srv-view-desc">${escLines(d.desc)}</p>` : ''}
      <div class="srv-links">
        ${isUrl(d.discord) ? `<a class="tier-btn primary" href="${esc(d.discord)}" target="_blank" rel="noopener noreferrer nofollow">Discord</a>` : ''}
        ${(d.links || []).filter((l) => isUrl(l?.url)).map((l) => `<a class="tier-btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.label || t('srv.link'))}</a>`).join('')}
        ${d.address ? `<button type="button" class="tier-btn" data-copy="${esc(d.address)}">${esc(t('srv.copyAddress', { a: d.address }))}</button>` : ''}
      </div>
      ${(d.tags || []).length ? `<p class="srv-tags">${d.tags.map((x) => `<i>#${esc(x)}</i>`).join('')}</p>` : ''}
      ${own ? `<div class="tier-viewer-actions">
        <button type="button" class="tier-btn primary" data-act="boost">${esc(t('srv.boostBtn'))}</button>
        <button type="button" class="tier-btn" data-act="edit">${esc(t('srv.edit'))}</button>
        <button type="button" class="tier-btn danger" data-act="delete">${esc(t('tier.delete'))}</button>
      </div>` : ''}
      <section class="tier-review-box">
        <h3>${esc(t('srv.rateTitle'))}</h3>
        ${own ? `<p class="tier-muted">${esc(t('srv.ownServer'))}</p>` : !u ? `<p class="tier-muted">${esc(t('rating.loginToRate'))}</p>` : `
          <form class="tier-review-form" data-review>
            ${starsInput(mine?.s || 0)}
            <textarea class="tier-entry-input tier-textarea" name="comment" maxlength="300" rows="2" placeholder="${esc(t('srv.commentPlaceholder'))}">${esc(mine?.c || '')}</textarea>
            <div class="tier-publish-actions">
              <button type="submit" class="tier-btn primary">${esc(t('tier.sendReview'))}</button>
              <span class="tier-muted" data-review-status aria-live="polite"></span>
            </div>
          </form>`}
        <ul class="tier-reviews">${reviews.map((x) => `<li><span class="tier-review-head"><strong>${esc(x.n || t('account.anonymous'))}</strong>${starsDisplay(x.s, 1, { compact: true })}</span>${x.c ? `<p>${escLines(x.c)}</p>` : ''}</li>`).join('') || `<li class="tier-muted">${esc(t('tier.noReviews'))}</li>`}</ul>
      </section>`;
    viewer.hidden = false;
  }
  function closeViewer() { openId = null; viewer.hidden = true; body.innerHTML = ''; }

  // ---------------------------------------------------------------- formulário (novo / editar)
  function renderForm(d = null) {
    openId = null;
    const v = d || { mode: 'pve', region: 'SouthAmerica', map: 'main', gameMode: 'survival', links: [], tags: [] };
    const opt = (list, cur, label) => list.map((x) => `<option value="${x}" ${x === cur ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
    body.innerHTML = `
      <h2 id="srv-viewer-title">${esc(t(d ? 'srv.editTitle' : 'srv.addTitle'))}</h2>
      <form class="srv-form" data-form="${esc(d?.id || '')}">
        <div class="srv-form-icon">
          <span class="srv-icon srv-icon-lg" data-icon-preview>${v.icon ? `<img src="${esc(v.icon)}" alt="" />` : ''}</span>
          <label class="tier-btn">${esc(t('srv.iconPick'))}<input type="file" accept="image/*" data-icon-file hidden /></label>
          <input type="hidden" name="icon" value="${esc(v.icon || '')}" />
        </div>
        <label><span>${esc(t('srv.fName'))} *</span><input class="tier-entry-input" name="name" maxlength="60" required value="${esc(v.name || '')}" /></label>
        <label><span>${esc(t('srv.fDesc'))}</span><textarea class="tier-entry-input tier-textarea" name="desc" maxlength="1000" rows="4" placeholder="${esc(t('srv.fDescPh'))}">${esc(v.desc || '')}</textarea></label>
        <div class="srv-form-row">
          <label><span>${esc(t('srv.mode'))} *</span><select class="tier-entry-input" name="mode">${opt(MODES, v.mode, (x) => t(`srv.modeName.${x}`))}</select></label>
          <label><span>${esc(t('srv.region'))} *</span><select class="tier-entry-input" name="region">${opt(REGIONS, v.region, (x) => t(`events.reg.${x}`))}</select></label>
          <label><span>${esc(t('srv.fMap'))}</span><select class="tier-entry-input" name="map">${opt(MAPS, v.map, (x) => t(`srv.map.${x}`))}</select></label>
          <label><span>${esc(t('srv.fGameMode'))}</span><select class="tier-entry-input" name="gameMode">${opt(GAME_MODES, v.gameMode, (x) => (x === 'custom' ? t('srv.custom') : t(`map.mode.${x}`)))}</select></label>
          <label><span>${esc(t('srv.fLang'))}</span><input class="tier-entry-input" name="lang" maxlength="20" placeholder="PT-BR" value="${esc(v.lang || '')}" /></label>
          <label><span>${esc(t('srv.fSlots'))}</span><input class="tier-entry-input" name="slots" type="number" min="0" max="500" value="${esc(v.slots || '')}" /></label>
        </div>
        <label><span>${esc(t('srv.fDiscord'))}</span><input class="tier-entry-input" name="discord" maxlength="200" placeholder="https://discord.gg/..." value="${esc(v.discord || '')}" /></label>
        ${[0, 1].map((i) => `<div class="srv-form-row srv-form-link">
          <label><span>${esc(t('srv.fLinkLabel', { n: i + 1 }))}</span><input class="tier-entry-input" name="linkLabel${i}" maxlength="30" placeholder="${esc(t('srv.fLinkLabelPh'))}" value="${esc(v.links?.[i]?.label || '')}" /></label>
          <label><span>${esc(t('srv.fLinkUrl', { n: i + 1 }))}</span><input class="tier-entry-input" name="linkUrl${i}" maxlength="200" placeholder="https://..." value="${esc(v.links?.[i]?.url || '')}" /></label>
        </div>`).join('')}
        <div class="srv-form-row">
          <label><span>${esc(t('srv.fAddress'))}</span><input class="tier-entry-input" name="address" maxlength="80" placeholder="123.45.67.89:8777" value="${esc(v.address || '')}" /></label>
          <label><span>${esc(t('srv.fTags'))}</span><input class="tier-entry-input" name="tags" maxlength="130" placeholder="${esc(t('srv.fTagsPh'))}" value="${esc((v.tags || []).join(', '))}" /></label>
        </div>
        <div class="tier-publish-actions">
          <button type="submit" class="tier-btn primary">${esc(t(d ? 'srv.save' : 'srv.publish'))}</button>
          <span class="tier-muted" data-form-status aria-live="polite"></span>
        </div>
      </form>`;
    viewer.hidden = false;
  }

  async function saveForm(form) {
    const st = form.querySelector('[data-form-status]');
    const u = await requireUser();
    if (!u) return;
    const f = form.elements;
    const links = [0, 1].map((i) => ({ label: f[`linkLabel${i}`].value.trim().slice(0, 30), url: f[`linkUrl${i}`].value.trim() }))
      .filter((l) => l.url);
    const discord = f.discord.value.trim();
    if ((discord && !isUrl(discord)) || links.some((l) => !isUrl(l.url))) { st.textContent = t('srv.badUrl'); return; }
    const data = {
      uid: u.uid,
      author: publicName(u),
      name: f.name.value.trim().slice(0, 60),
      desc: f.desc.value.trim().slice(0, 1000),
      icon: f.icon.value.length <= 70000 ? f.icon.value : '',
      discord,
      links,
      mode: MODES.includes(f.mode.value) ? f.mode.value : 'pve',
      region: REGIONS.includes(f.region.value) ? f.region.value : 'SouthAmerica',
      lang: f.lang.value.trim().slice(0, 20),
      map: MAPS.includes(f.map.value) ? f.map.value : 'main',
      gameMode: GAME_MODES.includes(f.gameMode.value) ? f.gameMode.value : 'custom',
      slots: Math.max(0, Math.min(500, Math.round(Number(f.slots.value) || 0))),
      address: f.address.value.trim().slice(0, 80),
      tags: f.tags.value.split(',').map((x) => x.trim().replace(/^#/, '').slice(0, 20)).filter(Boolean).slice(0, 6)
    };
    if (!data.name) { st.textContent = t('srv.needName'); return; }
    const editId = form.dataset.form;
    if (!editId && docs.filter((d) => d.uid === u.uid).length >= (config.maxPerUser || 3)) { st.textContent = t('srv.maxReached', { n: config.maxPerUser || 3 }); return; }
    st.textContent = t('account.syncing');
    try {
      const fb = await loadFirebase();
      const { doc, setDoc, serverTimestamp } = fb.store;
      if (editId) {
        const old = docs.find((d) => d.id === editId) || {};
        const full = { ...data, ratings: old.ratings || {}, createdAt: old.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
        if (old.boost !== undefined) full.boost = old.boost;
        if (old.boostUntil !== undefined) full.boostUntil = old.boostUntil;
        await setDoc(doc(fb.db, 'servers', editId), full);
      } else {
        await setDoc(doc(fb.db, 'servers', `${u.uid}_${Date.now()}`), { ...data, ratings: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      closeViewer();
      say(t(editId ? 'srv.saved' : 'srv.published'));
      await load();
    } catch (e) {
      console.warn('save server', e);
      st.textContent = t('tier.saveError');
    }
  }

  // ---------------------------------------------------------------- destaque pago
  function renderBoost(d) {
    const amounts = config.boostAmounts || [10, 20, 50, 100];
    const top = docs.filter(boosted).sort((a, b) => (b.boost || 0) - (a.boost || 0));
    body.innerHTML = `
      <h2 id="srv-viewer-title">${esc(t('srv.boostTitle', { n: d.name }))}</h2>
      <p>${esc(t('srv.boostText', { days: config.boostDays || 30 }))}</p>
      ${top.length ? `<p class="tier-muted">${esc(t('srv.boostTopNow', { a: top.slice(0, 3).map((x) => `R$ ${fmtNum(x.boost, 2)}`).join(' · ') }))}</p>` : `<p class="tier-muted">${esc(t('srv.boostNoneYet'))}</p>`}
      ${boosted(d) ? `<p class="tier-muted">${esc(t('srv.boostCurrent', { v: fmtNum(d.boost, 2), d: new Date(d.boostUntil).toLocaleDateString() }))}</p>` : ''}
      <form class="srv-boost-form" data-boost="${esc(d.id)}">
        <div class="srv-boost-amounts">${amounts.map((a) => `<button type="button" class="tier-btn" data-amount="${a}">R$ ${a}</button>`).join('')}</div>
        <label><span>${esc(t('srv.boostValue'))}</span><input class="tier-entry-input" name="amount" type="number" min="5" max="1000" step="1" value="${amounts[1] || 20}" /></label>
        <div class="tier-publish-actions">
          <button type="submit" class="tier-btn primary">${esc(t('srv.boostPay'))}</button>
          <span class="tier-muted" data-boost-status aria-live="polite"></span>
        </div>
        <p class="tier-muted">${esc(t('srv.boostNote'))}</p>
      </form>`;
  }

  async function payBoost(form) {
    const st = form.querySelector('[data-boost-status]');
    const u = await requireUser();
    if (!u) return;
    const amount = Number(form.elements.amount.value);
    if (!(amount >= 5 && amount <= 1000)) { st.textContent = t('srv.boostRange'); return; }
    st.textContent = t('support.opening');
    try {
      const r = await fetch(`${String(config.apiBase).replace(/\/$/, '')}/createServerBoost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
        body: JSON.stringify({ serverId: form.dataset.boost, amount })
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.url) throw new Error(out.error || 'erro');
      window.location.href = out.url;
    } catch (e) {
      st.textContent = e.message && e.message !== 'erro' ? e.message : t('srv.boostError');
    }
  }

  // ---------------------------------------------------------------- eventos
  [qEl, modeEl, regionEl, sortEl].forEach((el) => el.addEventListener('input', render));
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { openId = b.dataset.open; renderViewer(); } });
  featured.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { openId = b.dataset.open; renderViewer(); } });
  root.querySelector('#srv-add').addEventListener('click', async () => {
    const u = await requireUser();
    if (u) renderForm();
  });

  viewer.addEventListener('click', async (e) => {
    if (e.target === viewer || e.target.closest('[data-close]')) { closeViewer(); return; }
    const star = e.target.closest('[data-star]');
    if (star) {
      const form = star.closest('form');
      form.dataset.stars = star.dataset.star;
      form.querySelectorAll('[data-star]').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.star) <= Number(star.dataset.star));
        b.setAttribute('aria-checked', String(b === star));
      });
      return;
    }
    const amt = e.target.closest('[data-amount]');
    if (amt) { amt.closest('form').elements.amount.value = amt.dataset.amount; return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); } catch (err) { /* ignora */ }
      cp.textContent = t('map.copied');
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const d = docs.find((x) => x.id === openId);
    if (!act || !d) return;
    if (act === 'edit') renderForm(d);
    if (act === 'boost') renderBoost(d);
    if (act === 'delete' && window.confirm(t('srv.deleteConfirm', { n: d.name }))) {
      try {
        const fb = await loadFirebase();
        await fb.store.deleteDoc(fb.store.doc(fb.db, 'servers', d.id));
        closeViewer();
        await load();
      } catch (err) {
        console.warn('delete server', err);
        alert(t('tier.saveError'));
      }
    }
  });
  viewer.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-icon-file]');
    if (!inp) return;
    const form = inp.closest('form');
    try {
      const url = await iconFromFile(inp.files[0]);
      form.elements.icon.value = url;
      form.querySelector('[data-icon-preview]').innerHTML = `<img src="${esc(url)}" alt="" />`;
    } catch (err) {
      form.querySelector('[data-form-status]').textContent = t('srv.iconError');
    }
  });
  viewer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.matches('[data-form]')) { saveForm(form); return; }
    if (form.matches('[data-boost]')) { payBoost(form); return; }
    if (form.matches('[data-review]')) {
      const st = form.querySelector('[data-review-status]');
      const u = getUser();
      const d = docs.find((x) => x.id === openId);
      if (!u || !d) return;
      const stars = Number(form.dataset.stars || d.ratings?.[u.uid]?.s || 0);
      if (!stars) { st.textContent = t('tier.pickStars'); return; }
      const review = { s: stars, n: publicName(u), t: Date.now() };
      const c = form.elements.comment.value.trim().slice(0, 300);
      if (c) review.c = c;
      st.textContent = t('account.syncing');
      try {
        const fb = await loadFirebase();
        await fb.store.updateDoc(fb.store.doc(fb.db, 'servers', d.id), { [`ratings.${u.uid}`]: review });
        d.ratings = { ...(d.ratings || {}), [u.uid]: review };
        render();
      } catch (err) {
        console.warn('review', err);
        st.textContent = t('tier.saveError');
      }
    }
  });
  document.addEventListener('keydown', function esc2(e) {
    if (!viewer.isConnected) { document.removeEventListener('keydown', esc2); return; }
    if (e.key === 'Escape' && !viewer.hidden) closeViewer();
  });
  onUser(() => { if (openId) renderViewer(); });
  load();
}
