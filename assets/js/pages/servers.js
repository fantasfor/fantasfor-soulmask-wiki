// Servidores da comunidade (Firestore: servers/{uid_timestamp}). Regras: GDMbot/servidor/firestore.rules
// - Adicionar/editar só com login; cada um avalia com estrelas (e comentário) os servidores dos outros;
//   o dono pode responder os comentários (social.js).
// - Destaque pago (Mercado Pago, rota /api/createServerBoost): valor livre, não expira; ordenado pelo total pago,
//   os 3 primeiros aparecem maiores. "boost" só o servidor grava (webhook).
// - O dono confirma que o servidor está ativo a cada 60 dias (grava updatedAt); sem isso ele some da lista.
// - Imagens: o documento guarda um ícone estático pequeno (WebP 128 px). O ícone animado (GIF) e o banner ficam
//   num documento separado, serverMedia/{id}, para não estourar o limite de 1 MB do documento do servidor;
//   o campo "media" (data em ms) avisa que esse documento existe.
import { t } from '../i18n.js';
import { esc, normalize, fmtNum } from '../data.js';
import { loadFirebase, getUser, onUser, requireUser, publicName } from '../cloud.js';
import { summarize, starsDisplay } from '../ratings.js';
import { reviewsHtml, bindReviews, commentCount, score } from '../social.js';
import { favButton, bindFavButtons } from '../favorites.js';

const MODES = ['pvp', 'pve', 'pvpve'];
const REGIONS = ['SouthAmerica', 'America', 'Europe', 'Asia', 'Oceania'];
const MAPS = ['main', 'dlc', 'both'];
const GAME_MODES = ['survival', 'tribe', 'warrior', 'pvp', 'casual', 'custom'];
const ICON_SIZE = 128;
const BANNER_W = 936; // 468 x 60 (padrão de banner de lista de servidores) em dobro, para telas nítidas
const BANNER_H = 120;
// tamanhos máximos dos arquivos GIF (o texto base64 fica ~33% maior; a soma cabe em 1 MB)
const ICON_GIF_MAX = 250 * 1024;
const BANNER_GIF_MAX = 400 * 1024;
const ICON_MEDIA_MAX = 350000; // caracteres (mesmo limite das regras)
const BANNER_MEDIA_MAX = 560000;

const isUrl = (s) => /^https:\/\/[^\s<>"]{3,190}$/i.test(s || '');
const escLines = (s) => esc(s).replace(/\n/g, '<br>');
const boosted = (d) => (Number(d.boost) || 0) > 0;
const BOOST_MIN = 1;
const BOOST_MAX = 50000;
const DAY = 24 * 3600 * 1000;
// última confirmação de que o servidor está ativo (salvar/editar também conta)
const lastCheck = (d) => ((d.updatedAt?.seconds || d.createdAt?.seconds || 0) * 1000) || Date.now();

// imagens animadas/banners já baixados nesta visita (id -> { v, icon, banner })
const mediaCache = new Map();

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(file);
});

// desenha a imagem (1º quadro, se for GIF) recortada para w x h e devolve WebP (ou JPEG)
function drawCover(file, w, h, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale; const sh = h / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      let url = c.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      resolve(url);
    };
    img.onerror = () => reject(new Error('load'));
    img.src = URL.createObjectURL(file);
  });
}

const isGif = (file) => file?.type === 'image/gif';

// ícone: estático 128 px sempre; GIF animado guardado como está (se couber)
async function iconFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('type');
  const still = await drawCover(file, ICON_SIZE, ICON_SIZE);
  if (!isGif(file)) return { still, anim: '' };
  if (file.size > ICON_GIF_MAX) throw new Error('gifSize');
  return { still, anim: await readAsDataUrl(file) };
}

// banner: GIF guardado como está; outras imagens viram WebP 936 x 120
async function bannerFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('type');
  if (isGif(file)) {
    if (file.size > BANNER_GIF_MAX) throw new Error('gifSize');
    return readAsDataUrl(file);
  }
  let url = await drawCover(file, BANNER_W, BANNER_H, 0.85);
  if (url.length > BANNER_MEDIA_MAX) url = await drawCover(file, BANNER_W, BANNER_H, 0.6);
  return url;
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
  const ACTIVE_DAYS = config.activeDays || 60;
  const activeUntil = (d) => lastCheck(d) + ACTIVE_DAYS * DAY;
  const isActive = (d) => activeUntil(d) > Date.now();
  const isOwn = (d) => getUser()?.uid === d.uid;
  const iconOf = (d) => mediaCache.get(d.id)?.icon || d.icon || '';
  const bannerOf = (d) => mediaCache.get(d.id)?.banner || '';

  const say = (msg) => { status.hidden = !msg; status.textContent = msg || ''; };
  const back = params?.get('destaque');
  if (back) say(t(`srv.boostBack.${back}`));

  async function loadMedia(list) {
    const need = list.filter((d) => d.media && mediaCache.get(d.id)?.v !== d.media);
    if (!need.length) return false;
    const fb = await loadFirebase();
    await Promise.all(need.map(async (d) => {
      try {
        const snap = await fb.store.getDoc(fb.store.doc(fb.db, 'serverMedia', d.id));
        const m = snap.exists() ? snap.data() : {};
        mediaCache.set(d.id, { v: d.media, icon: m.icon || '', banner: m.banner || '' });
      } catch (e) {
        console.warn('server media', d.id, e);
      }
    }));
    return true;
  }

  async function load() {
    try {
      const fb = await loadFirebase();
      const snap = await fb.store.getDocs(fb.store.collection(fb.db, 'servers'));
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      if (await loadMedia(docs.filter((d) => isActive(d) || isOwn(d)))) render();
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
    ${d.gameMode && d.gameMode !== 'custom' ? `<span class="srv-chip">${esc(t(`map.mode.${d.gameMode}`))}</span>` : ''}`;

  const ipBox = (d) => (d.address
    ? `<div class="srv-ip"><code title="${esc(d.address)}">${esc(d.address)}</code><button type="button" class="srv-ip-copy" data-copy="${esc(d.address)}">${esc(t('srv.copyIp'))}</button></div>`
    : isUrl(d.discord) ? `<div class="srv-ip"><a class="srv-ip-copy srv-ip-discord" href="${esc(d.discord)}" target="_blank" rel="noopener noreferrer nofollow">Discord</a></div>` : '');

  // linha da lista (modelo: listas de servidores de Minecraft): ícone e nome | banner e descrição | IP e números
  function row(d, pos, rank = 0) {
    const r = summarize(d.ratings);
    const icon = iconOf(d);
    const banner = bannerOf(d);
    const descMax = rank === 1 ? 260 : 170;
    const tag = !isActive(d) ? `<span class="srv-boost-tag srv-inactive-tag">${esc(t('srv.active.tag'))}</span>`
      : boosted(d) ? `<span class="srv-boost-tag">${esc(t('srv.featuredTag'))}</span>` : '';
    return `<article class="srv-row${rank ? ` srv-place srv-place-${rank}` : ''}${boosted(d) ? ' is-boosted' : ''}${isActive(d) ? '' : ' is-inactive'}" data-open="${esc(d.id)}" tabindex="0" aria-label="${esc(d.name)}">
      <div class="srv-row-id">
        ${icon ? `<img class="srv-icon" src="${esc(icon)}" alt="" loading="lazy" />` : '<span class="srv-icon srv-icon-empty"></span>'}
        <strong class="srv-row-name">${esc(d.name)}</strong>
        <span class="srv-row-pos">#${pos}</span>
        ${tag}
      </div>
      <div class="srv-row-mid">
        ${banner ? `<img class="srv-banner" src="${esc(banner)}" alt="" loading="lazy" />`
          : `<span class="srv-banner srv-banner-empty"><span>${esc(d.name)}</span></span>`}
        ${d.desc ? `<p class="srv-desc">${esc(d.desc.slice(0, descMax))}${d.desc.length > descMax ? '...' : ''}</p>` : ''}
        <span class="srv-badges">${badges(d)}</span>
      </div>
      <div class="srv-row-side">
        ${ipBox(d)}
        <ul class="srv-stats">
          <li>${starsDisplay(r.avg, r.count)}</li>
          <li>${esc(t('social.commentsN', { n: commentCount(d) }))}</li>
          ${d.slots ? `<li>${esc(t('srv.slotsN', { n: d.slots }))}</li>` : ''}
        </ul>
        ${(d.tags || []).length ? `<span class="srv-tags">${d.tags.slice(0, 4).map((x) => `<i>#${esc(x)}</i>`).join('')}</span>` : ''}
      </div>
    </article>`;
  }

  function render() {
    const q = normalize(qEl.value);
    // inativos (sem confirmação há 60 dias) só aparecem para o próprio dono
    const list = docs.filter((d) => (isActive(d) || isOwn(d)) && (!modeEl.value || d.mode === modeEl.value) && (!regionEl.value || d.region === regionEl.value)
      && (!q || normalize(`${d.name} ${d.desc} ${(d.tags || []).join(' ')} ${d.lang} ${d.author} ${d.address}`).includes(q)));
    const top = list.filter((d) => boosted(d) && isActive(d)).sort((a, b) => (b.boost || 0) - (a.boost || 0) || lastCheck(b) - lastCheck(a));
    const rest = list.filter((d) => !(boosted(d) && isActive(d))).map((d) => ({ d, r: summarize(d.ratings) }));
    rest.sort((a, b) => {
      if (sortEl.value === 'recent') return (b.d.createdAt?.seconds || 0) - (a.d.createdAt?.seconds || 0);
      if (sortEl.value === 'votes') return b.r.count - a.r.count || b.r.avg - a.r.avg;
      return score(b.d) - score(a.d);
    });
    featured.innerHTML = top.length ? `
      <h2 class="comfort-section-title">${esc(t('srv.featured'))}</h2>
      <div class="srv-list">${top.map((d, i) => row(d, i + 1, i < 3 ? i + 1 : 0)).join('')}</div>` : '';
    count.textContent = t('srv.count', { n: list.length });
    grid.innerHTML = rest.length ? `${top.length ? `<h2 class="comfort-section-title">${esc(t('srv.allServers'))}</h2>` : ''}
      <div class="srv-list">${rest.map(({ d }, i) => row(d, top.length + i + 1)).join('')}</div>`
      : (top.length ? '' : `<p class="tier-muted">${esc(t('srv.empty'))}</p>`);
    if (openId) renderViewer();
  }

  // ---------------------------------------------------------------- janela do servidor
  function renderViewer() {
    const d = docs.find((x) => x.id === openId);
    if (!d) { closeViewer(); return; }
    const own = isOwn(d);
    const r = summarize(d.ratings);
    const icon = iconOf(d);
    const banner = bannerOf(d);
    body.innerHTML = `
      ${banner ? `<img class="srv-banner srv-banner-lg" src="${esc(banner)}" alt="" />` : ''}
      <header class="srv-view-head">
        ${icon ? `<img class="srv-icon srv-icon-lg" src="${esc(icon)}" alt="" />` : ''}
        <div>
          <h2 id="srv-viewer-title">${esc(d.name)}</h2>
          ${starsDisplay(r.avg, r.count)}
          <p class="tier-card-meta">${esc(t('srv.by', { n: d.author || t('account.anonymous') }))}${boosted(d) ? ` · <span class="srv-boost-tag srv-boost-inline">${esc(t('srv.featuredTag'))}</span>` : ''}</p>
        </div>
      </header>
      <div class="srv-badges">${badges(d)}${d.slots ? `<span class="srv-chip">${esc(t('srv.slotsN', { n: d.slots }))}</span>` : ''}</div>
      ${d.desc ? `<p class="srv-view-desc">${escLines(d.desc)}</p>` : ''}
      ${d.address ? `<div class="srv-view-ip">${ipBox(d)}</div>` : ''}
      <div class="srv-links">
        ${isUrl(d.discord) ? `<a class="tier-btn primary" href="${esc(d.discord)}" target="_blank" rel="noopener noreferrer nofollow">Discord</a>` : ''}
        ${(d.links || []).filter((l) => isUrl(l?.url)).map((l) => `<a class="tier-btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.label || t('srv.link'))}</a>`).join('')}
        <button type="button" class="tier-btn" data-act="link">${esc(t('social.copyLink'))}</button>
        ${favButton(`post:servers/${d.id}`)}
      </div>
      ${(d.tags || []).length ? `<p class="srv-tags">${d.tags.map((x) => `<i>#${esc(x)}</i>`).join('')}</p>` : ''}
      ${own ? activeBox(d) : ''}
      ${own ? `<div class="tier-viewer-actions">
        <button type="button" class="tier-btn primary" data-act="boost">${esc(t('srv.boostBtn'))}</button>
        <button type="button" class="tier-btn" data-act="edit">${esc(t('srv.edit'))}</button>
        <button type="button" class="tier-btn danger" data-act="delete">${esc(t('tier.delete'))}</button>
      </div>` : ''}
      ${reviewsHtml(d, { title: t('srv.rateTitle'), ownText: t('srv.ownServer'), placeholder: t('srv.commentPlaceholder') })}`;
    viewer.hidden = false;
  }
  // aviso para o dono: até quando confirmar que está ativo
  function activeBox(d) {
    const left = Math.ceil((activeUntil(d) - Date.now()) / DAY);
    const msg = left <= 0 ? t('srv.active.expired')
      : left <= 7 ? t('srv.active.soon', { n: left })
      : t('srv.active.until', { d: new Date(activeUntil(d)).toLocaleDateString() });
    return `<div class="srv-active-box${left <= 7 ? ' is-warn' : ''}">
      <p>${esc(msg)}</p>
      <button type="button" class="tier-btn${left <= 7 ? ' primary' : ''}" data-act="active">${esc(t('srv.active.confirm'))}</button>
    </div>`;
  }
  function closeViewer() { openId = null; viewer.hidden = true; body.innerHTML = ''; }
  function openServer(id) { openId = id; renderViewer(); viewer.querySelector('.tier-viewer-close')?.focus(); }

  // ---------------------------------------------------------------- formulário (novo / editar)
  async function renderForm(d = null) {
    openId = null;
    if (d) await loadMedia([d]).catch(() => {});
    const v = d || { mode: 'pve', region: 'SouthAmerica', map: 'main', gameMode: 'survival', links: [], tags: [] };
    const m = d ? (mediaCache.get(d.id) || {}) : {};
    const opt = (list, cur, label) => list.map((x) => `<option value="${x}" ${x === cur ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
    body.innerHTML = `
      <h2 id="srv-viewer-title">${esc(t(d ? 'srv.editTitle' : 'srv.addTitle'))}</h2>
      <form class="srv-form" data-form="${esc(d?.id || '')}">
        <div class="srv-form-icon">
          <span class="srv-icon srv-icon-lg" data-icon-preview>${m.icon || v.icon ? `<img src="${esc(m.icon || v.icon)}" alt="" />` : ''}</span>
          <div class="srv-form-media">
            <label class="tier-btn">${esc(t('srv.iconPick'))}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-icon-file hidden /></label>
            <span class="tier-muted">${esc(t('srv.iconHint', { kb: ICON_GIF_MAX / 1024 }))}</span>
          </div>
          <input type="hidden" name="icon" value="${esc(v.icon || '')}" />
          <input type="hidden" name="iconAnim" value="${esc(m.icon || '')}" />
        </div>
        <div class="srv-form-banner">
          <span class="srv-banner srv-banner-empty" data-banner-preview>${m.banner ? `<img src="${esc(m.banner)}" alt="" />` : `<span>${esc(t('srv.bannerNone'))}</span>`}</span>
          <div class="srv-form-media">
            <label class="tier-btn">${esc(t('srv.bannerPick'))}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-banner-file hidden /></label>
            <button type="button" class="tier-btn" data-banner-clear ${m.banner ? '' : 'hidden'}>${esc(t('srv.bannerRemove'))}</button>
            <span class="tier-muted">${esc(t('srv.bannerHint', { kb: BANNER_GIF_MAX / 1024 }))}</span>
          </div>
          <input type="hidden" name="banner" value="${esc(m.banner || '')}" />
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
    const iconAnim = f.iconAnim.value.length <= ICON_MEDIA_MAX ? f.iconAnim.value : '';
    const banner = f.banner.value.length <= BANNER_MEDIA_MAX ? f.banner.value : '';
    const hasMedia = Boolean(iconAnim || banner);
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
    if (hasMedia) data.media = Date.now();
    if (!data.name) { st.textContent = t('srv.needName'); return; }
    const editId = form.dataset.form;
    if (!editId && docs.filter((d) => d.uid === u.uid).length >= (config.maxPerUser || 3)) { st.textContent = t('srv.maxReached', { n: config.maxPerUser || 3 }); return; }
    st.textContent = t('account.syncing');
    try {
      const fb = await loadFirebase();
      const { doc, setDoc, deleteDoc, serverTimestamp } = fb.store;
      const id = editId || `${u.uid}_${Date.now()}`;
      const old = editId ? (docs.find((d) => d.id === editId) || {}) : null;
      if (old) {
        const full = { ...data, ratings: old.ratings || {}, createdAt: old.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
        if (old.replies) full.replies = old.replies;
        if (old.boost !== undefined) full.boost = old.boost;
        if (old.boostUntil !== undefined) full.boostUntil = old.boostUntil;
        await setDoc(doc(fb.db, 'servers', id), full);
      } else {
        await setDoc(doc(fb.db, 'servers', id), { ...data, ratings: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      // imagens grandes: documento à parte (gravado depois do servidor, porque as regras conferem o dono nele)
      if (hasMedia) {
        await setDoc(doc(fb.db, 'serverMedia', id), { uid: u.uid, icon: iconAnim, banner, updatedAt: serverTimestamp() });
        mediaCache.set(id, { v: data.media, icon: iconAnim, banner });
      } else if (old?.media) {
        await deleteDoc(doc(fb.db, 'serverMedia', id)).catch(() => {});
        mediaCache.delete(id);
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
    const top = docs.filter((x) => boosted(x) && isActive(x)).sort((a, b) => (b.boost || 0) - (a.boost || 0));
    body.innerHTML = `
      <h2 id="srv-viewer-title">${esc(t('srv.boostTitle', { n: d.name }))}</h2>
      <p>${esc(t('srv.boostText', { days: ACTIVE_DAYS }))}</p>
      ${top.length ? `<p class="tier-muted">${esc(t('srv.boostTopNow', { a: top.slice(0, 3).map((x) => `R$ ${fmtNum(x.boost, 2)}`).join(' · ') }))}</p>` : `<p class="tier-muted">${esc(t('srv.boostNoneYet'))}</p>`}
      ${boosted(d) ? `<p class="tier-muted">${esc(t('srv.boostCurrent', { v: fmtNum(d.boost, 2) }))}</p>` : ''}
      <form class="srv-boost-form" data-boost="${esc(d.id)}">
        <div class="srv-boost-amounts">${amounts.map((a) => `<button type="button" class="tier-btn" data-amount="${a}">R$ ${a}</button>`).join('')}</div>
        <label><span>${esc(t('srv.boostValue'))}</span><input class="tier-entry-input" name="amount" type="number" min="${BOOST_MIN}" max="${BOOST_MAX}" step="1" value="${amounts[1] || 20}" /></label>
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
    if (!(amount >= BOOST_MIN && amount <= BOOST_MAX)) { st.textContent = t('srv.boostRange'); return; }
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
  async function copyFrom(btn) {
    try { await navigator.clipboard.writeText(btn.dataset.copy); } catch (err) { window.prompt('IP', btn.dataset.copy); }
    const old = btn.textContent;
    btn.textContent = t('map.copied');
    setTimeout(() => { if (btn.isConnected) btn.textContent = old; }, 1600);
  }
  const onListClick = (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.stopPropagation(); copyFrom(cp); return; }
    if (e.target.closest('a')) return;
    const b = e.target.closest('[data-open]');
    if (b) openServer(b.dataset.open);
  };
  const onListKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); openServer(e.target.dataset.open); }
  };
  [qEl, modeEl, regionEl, sortEl].forEach((el) => el.addEventListener('input', render));
  [grid, featured].forEach((el) => { el.addEventListener('click', onListClick); el.addEventListener('keydown', onListKey); });
  root.querySelector('#srv-add').addEventListener('click', async () => {
    const u = await requireUser();
    if (u) renderForm();
  });

  bindReviews(viewer, {
    coll: 'servers',
    getDoc: () => docs.find((x) => x.id === openId),
    // o dono grava junto a confirmação de ativo (exigida pelas regras em toda edição dele)
    ownerExtra: (fb) => ({ updatedAt: fb.store.serverTimestamp() }),
    onChange: () => render()
  });
  bindFavButtons(viewer);

  viewer.addEventListener('click', async (e) => {
    if (e.target === viewer || e.target.closest('[data-close]')) { closeViewer(); return; }
    const amt = e.target.closest('[data-amount]');
    if (amt) { amt.closest('form').elements.amount.value = amt.dataset.amount; return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { copyFrom(cp); return; }
    if (e.target.closest('[data-banner-clear]')) {
      const form = e.target.closest('form');
      form.elements.banner.value = '';
      form.querySelector('[data-banner-preview]').innerHTML = `<span>${esc(t('srv.bannerNone'))}</span>`;
      e.target.closest('[data-banner-clear]').hidden = true;
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const d = docs.find((x) => x.id === openId);
    if (!act || !d) return;
    if (act === 'link') {
      const url = `${location.origin}${location.pathname}#servidores?id=${encodeURIComponent(d.id)}`;
      try { await navigator.clipboard.writeText(url); } catch (err) { window.prompt('URL', url); }
      e.target.closest('[data-act]').textContent = t('map.copied');
    }
    if (act === 'edit') renderForm(d);
    if (act === 'boost') renderBoost(d);
    if (act === 'active') {
      try {
        const fb = await loadFirebase();
        await fb.store.updateDoc(fb.store.doc(fb.db, 'servers', d.id), { updatedAt: fb.store.serverTimestamp() });
        d.updatedAt = { seconds: Math.floor(Date.now() / 1000) };
        say(t('srv.active.done', { days: ACTIVE_DAYS }));
        render();
      } catch (err) {
        console.warn('active server', err);
        alert(t('tier.saveError'));
      }
    }
    if (act === 'delete' && window.confirm(t('srv.deleteConfirm', { n: d.name }))) {
      try {
        const fb = await loadFirebase();
        if (d.media) await fb.store.deleteDoc(fb.store.doc(fb.db, 'serverMedia', d.id)).catch(() => {});
        await fb.store.deleteDoc(fb.store.doc(fb.db, 'servers', d.id));
        mediaCache.delete(d.id);
        closeViewer();
        await load();
      } catch (err) {
        console.warn('delete server', err);
        alert(t('tier.saveError'));
      }
    }
  });
  viewer.addEventListener('change', async (e) => {
    const iconInp = e.target.closest('[data-icon-file]');
    const bannerInp = e.target.closest('[data-banner-file]');
    if (!iconInp && !bannerInp) return;
    const form = e.target.closest('form');
    const st = form.querySelector('[data-form-status]');
    const err = (x) => (x.message === 'gifSize'
      ? t('srv.gifTooBig', { kb: (iconInp ? ICON_GIF_MAX : BANNER_GIF_MAX) / 1024 })
      : t('srv.iconError'));
    try {
      st.textContent = '';
      if (iconInp) {
        const { still, anim } = await iconFromFile(iconInp.files[0]);
        form.elements.icon.value = still;
        form.elements.iconAnim.value = anim;
        form.querySelector('[data-icon-preview]').innerHTML = `<img src="${esc(anim || still)}" alt="" />`;
      } else {
        const url = await bannerFromFile(bannerInp.files[0]);
        form.elements.banner.value = url;
        form.querySelector('[data-banner-preview]').innerHTML = `<img src="${esc(url)}" alt="" />`;
        form.querySelector('[data-banner-clear]').hidden = false;
      }
    } catch (x) {
      st.textContent = err(x);
    } finally {
      e.target.value = '';
    }
  });
  viewer.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.closest('[data-social]')) return; // avaliações: social.js
    e.preventDefault();
    if (form.matches('[data-form]')) { saveForm(form); return; }
    if (form.matches('[data-boost]')) payBoost(form);
  });
  document.addEventListener('keydown', function esc2(e) {
    if (!viewer.isConnected) { document.removeEventListener('keydown', esc2); return; }
    if (e.key === 'Escape' && !viewer.hidden) closeViewer();
  });
  onUser(() => { if (docs.length) render(); else if (openId) renderViewer(); });
  await load();
  // link direto: #servidores?id=ID (usado também pela página Comunidade)
  const linked = params?.get('id');
  if (linked && docs.some((d) => d.id === linked)) openServer(linked);
}
