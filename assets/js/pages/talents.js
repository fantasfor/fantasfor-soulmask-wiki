import { t, tCount, pick } from '../i18n.js';
import { loadData, esc, escLines, normalize, renderChunked, L } from '../data.js';
import { loadFirebase, getUser, onUser, requireUser } from '../cloud.js';
import { summarize, starsDisplay, starsInput } from '../ratings.js';

// avaliações dos talentos: coleção talentRatings/{id} = { ratings: { uid: 1..5 } }
let ratingsCache = null;
async function loadRatings() {
  if (!ratingsCache) {
    ratingsCache = loadFirebase().then(async (fb) => {
      const snap = await fb.store.getDocs(fb.store.collection(fb.db, 'talentRatings'));
      const map = new Map();
      snap.forEach((d) => map.set(d.id, d.data().ratings || {}));
      return map;
    }).catch((e) => { console.warn('talentRatings', e); ratingsCache = null; return new Map(); });
  }
  return ratingsCache;
}

// exclusividade oficial (tribos/profissões) -> texto no idioma atual
export function exclLabels(x) {
  return (x.excl || []).map(L).filter(Boolean);
}

const FAV_KEY = 'talents_favorites_v2';

export const TALENT_COLORS = {
  positive: { accent: '#39d98a', soft: 'rgba(57, 217, 138, 0.16)', strong: 'rgba(57, 217, 138, 0.7)' },
  tribe: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
  title: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
  personality: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
  origin: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
  preference: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
  negative: { accent: '#e63946', soft: 'rgba(230, 57, 70, 0.16)', strong: 'rgba(230, 57, 70, 0.7)' },
  other: { accent: '#90d1ee', soft: 'rgba(144, 209, 238, 0.16)', strong: 'rgba(144, 209, 238, 0.7)' }
};

function readFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch (e) { return new Set(); }
}

export async function initTalentsPage(root, params) {
  const search = root.querySelector('#talents-search');
  const typeSel = root.querySelector('#talents-type-filter');
  const exclSel = root.querySelector('#talents-exclusive-filter');
  const favBtn = root.querySelector('#talents-favorites-btn');
  const count = root.querySelector('#talents-count');
  const container = root.querySelector('#talents-container');

  let talents = [];
  try {
    talents = await loadData('talents');
  } catch (e) {
    container.innerHTML = `<div class="talents-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const favs = readFavs();
  let favOnly = false;
  const sortSel = root.querySelector('#talents-sort');
  let ratings = new Map();
  const ratingOf = (id) => summarize(ratings.get(id));

  function ratingHtml(x) {
    const r = ratingOf(x.id);
    const u = getUser();
    const mine = u ? ratings.get(x.id)?.[u.uid] || 0 : 0;
    return `<div class="talent-card-rating" data-rate="${esc(x.id)}">
      ${starsDisplay(r.avg, r.count)}
      <span class="talent-rate-input" title="${esc(t(u ? 'rating.yourRating' : 'rating.loginToRate'))}">${starsInput(mine)}</span>
    </div>`;
  }

  const types = new Map();
  talents.forEach((x) => types.set(x.type, pick(x, 'type')));
  [...types].sort((a, b) => a[1].localeCompare(b[1])).forEach(([k, label]) => {
    typeSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(label)}</option>`);
  });
  const excl = [...new Set(talents.flatMap(exclLabels))].sort();
  excl.forEach((x) => exclSel.insertAdjacentHTML('beforeend', `<option value="${esc(x)}">${esc(x)}</option>`));
  if (params.get('q')) search.value = params.get('q');

  function card(x) {
    const pal = TALENT_COLORS[x.type] || TALENT_COLORS.other;
    const isFav = favs.has(x.id);
    const ex = exclLabels(x).join(', ');
    const levels = x.levels.length > 1
      ? `<div class="talent-card-levels">${x.levels.map((l, i) => `<span class="talent-level-chip" title="${esc(pick(l, 'desc'))}">${esc(t('common.level'))} ${i + 1} · ${esc(l.id)}</span>`).join('')}</div>`
      : `<div class="talent-card-levels"><span class="talent-level-chip">ID ${esc(x.levels[0]?.id)}</span></div>`;
    return `
      <article class="talent-card type-${esc(x.type)}" style="--card-accent:${pal.accent};--card-accent-soft:${pal.soft};--card-accent-strong:${pal.strong};">
        <button class="talent-card-favorite ${isFav ? 'favorited' : ''}" data-id="${esc(x.id)}" title="${esc(t(isFav ? 'talents.favRemove' : 'talents.favAdd'))}">${isFav ? '★' : '☆'}</button>
        <div class="talent-card-header">
          ${x.icon ? `<img src="${esc(x.icon)}" alt="" class="talent-card-icon" loading="lazy" />` : '<span class="talent-card-icon"></span>'}
          <div class="talent-card-title-section">
            <h3 class="talent-card-title">${esc(pick(x, 'name'))}</h3>
            <span class="talent-card-type">${esc(pick(x, 'type'))}</span>
          </div>
        </div>
        <div class="talent-card-body">
          <p class="talent-card-description">${escLines(pick(x, 'desc') || pick(x.levels[0], 'desc'))}</p>
          ${ex ? `<div class="talent-card-exclusive"><strong class="talent-card-exclusive-label">${esc(t('talents.exclusive'))}</strong> <span class="talent-card-exclusive-value">${esc(ex)}</span></div>` : ''}
          ${levels}
          ${ratingHtml(x)}
        </div>
      </article>`;
  }

  function render() {
    const q = normalize(search.value);
    const typ = typeSel.value;
    const ex = exclSel.value;
    const list = talents.filter((x) => (!typ || x.type === typ)
      && (!ex || exclLabels(x).includes(ex))
      && (!favOnly || favs.has(x.id))
      && (!q || normalize(`${x.name_pt} ${x.name_en} ${x.desc_pt || ''} ${x.desc_en || ''} ${exclLabels(x).join(' ')} ${x.levels.map((l) => l.id).join(' ')}`).includes(q)));
    const sort = sortSel.value;
    if (sort !== 'name') {
      const score = (x) => { const r = ratingOf(x.id); return sort === 'votes' ? r.count * 10 + r.avg : (r.avg * r.count + 3 * 2) / (r.count + 2) + (r.count ? 0 : -1); };
      list.sort((a, b) => score(b) - score(a));
    }
    count.textContent = tCount('talents.count', list.length);
    renderChunked(container, list, card, { empty: `<div class="talents-no-results">${esc(t('talents.none'))}</div>` });
  }

  search.addEventListener('input', render);
  typeSel.addEventListener('change', render);
  exclSel.addEventListener('change', render);
  favBtn.addEventListener('click', () => {
    favOnly = !favOnly;
    favBtn.classList.toggle('active', favOnly);
    render();
  });
  sortSel.addEventListener('change', render);

  async function rate(id, stars, box) {
    const u = await requireUser();
    if (!u) return;
    try {
      const fb = await loadFirebase();
      const cur = ratings.get(id)?.[u.uid];
      const value = cur === stars ? fb.store.deleteField() : stars; // clicar na mesma nota remove o voto
      await fb.store.setDoc(fb.store.doc(fb.db, 'talentRatings', id), { ratings: { [u.uid]: value } }, { merge: true });
      const next = { ...(ratings.get(id) || {}) };
      if (cur === stars) delete next[u.uid]; else next[u.uid] = stars;
      ratings.set(id, next);
      const x = talents.find((tt) => tt.id === id);
      if (x && box.isConnected) box.outerHTML = ratingHtml(x);
    } catch (err) {
      console.warn('rate', err);
      alert(t('rating.saveError'));
    }
  }

  container.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      const box = star.closest('[data-rate]');
      if (box) rate(box.dataset.rate, Number(star.dataset.star), box);
      return;
    }
    const b = e.target.closest('.talent-card-favorite');
    if (!b) return;
    const id = b.dataset.id;
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch (err) { /* ignora */ }
    const fav = favs.has(id);
    b.classList.toggle('favorited', fav);
    b.textContent = fav ? '★' : '☆';
    b.title = t(fav ? 'talents.favRemove' : 'talents.favAdd');
    if (favOnly) render();
  });
  render();
  // as notas chegam depois (não atrasam a lista); o login atualiza "sua nota"
  loadRatings().then((m) => { ratings = m; if (root.isConnected) render(); });
  const unsub = onUser(() => { if (!root.isConnected) { unsub(); return; } if (ratings.size) render(); });
}
