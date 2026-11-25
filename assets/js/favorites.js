// Favoritos: páginas do site (ex.: "mapa") e publicações da comunidade (ex.: "post:tierlists/ID").
// Ficam no navegador e acompanham a conta quando há login (cloud.js sincroniza a chave FAV_KEY).
// Páginas: estrela pequena dentro de cada botão da barra lateral; as favoritas aparecem na categoria
// "Favoritos" no topo da barra lateral (só quando há pelo menos uma).
import { t } from './i18n.js';
import { esc } from './data.js';

export const FAV_KEY = 'soulmask-favorites';
const MAX = 60;

// ícone de cada página (assets/img/home-icons, todos no mesmo branco)
const ICONS = {
  'builder-maker': 'builder', bancada: 'bancada', mapa: 'mapa', 'tier-list': 'tierlist', comandos: 'comandos',
  eventos: 'eventos', servidores: 'servidores', gdmbot: 'gdmbot', plantio: 'plantio', alimentos: 'alimentos',
  armaduras: 'armaduras', armas: 'armas', atributos: 'atributos', chefes: 'chefes', conforto: 'conforto',
  criaturas: 'animas', cristais: 'cristais', itens: 'itens', mascaras: 'mascaras', maestria: 'maestria',
  proficiencia: 'proficiencia', talentos: 'talentos', apoie: 'apoie', reportar: 'reportar', comunidade: 'comunidade',
  animais: 'animais', conquistas: 'conquistas', cacador: 'cacador', humor: 'humor'
};
// página nova sem entrada aqui: usa o ícone da grade da página inicial (mesmo nome) ou o genérico
export const pageIcon = (page) => {
  if (ICONS[page]) return `assets/img/home-icons/${ICONS[page]}.webp`;
  const img = document.querySelector(`.home-nav-square[href="#${CSS.escape(page)}"] img`);
  return img?.getAttribute('src') || 'assets/img/home-icons/itens.webp';
};
// toda página da barra lateral aceita favorito, menos a inicial
const favable = (page) => !!page && page !== 'home' && !page.includes(':');

export function getFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 200).slice(0, MAX) : [];
  } catch (e) { return []; }
}

function setFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* ignora */ }
  window.dispatchEvent(new CustomEvent('favs-changed'));
}

export const isFav = (id) => getFavs().includes(id);

export function toggleFav(id) {
  const list = getFavs();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  setFavs(list);
  return i < 0;
}

// link original da página no menu (fora da categoria Favoritos)
const navLink = (page) => document.querySelector(`#site-sidebar nav > ul:not(#nav-fav-list) a.nav-link[data-page="${CSS.escape(page)}"]`);
export const pageLabel = (page) => {
  const a = navLink(page);
  return a?.dataset.i18n ? t(a.dataset.i18n) : (a?.textContent.trim() || page);
};
// só páginas que existem no menu (descarta favoritos de páginas removidas)
// (antes de a barra lateral carregar, mantém todas para não sumir nada)
export const favPages = () => {
  const ready = !!document.querySelector('#site-sidebar nav a.nav-link[data-page]');
  return getFavs().filter((x) => favable(x) && (!ready || navLink(x)));
};
export const favPosts = () => getFavs().filter((x) => x.startsWith('post:'));

// botão de estrela para publicações (data-fav="id")
export function favButton(id, { compact = false } = {}) {
  const on = isFav(id);
  const label = t(on ? 'fav.remove' : 'fav.add');
  return `<button type="button" class="tier-btn fav-toggle${on ? ' is-on' : ''}${compact ? ' is-compact' : ''}" data-fav="${esc(id)}" aria-pressed="${on}" title="${esc(label)}" aria-label="${esc(label)}"><span class="fav-star" aria-hidden="true">★</span>${compact ? '' : `<span>${esc(label)}</span>`}</button>`;
}

function refreshButtons() {
  document.querySelectorAll('[data-fav]').forEach((b) => {
    const on = isFav(b.dataset.fav);
    const label = t(on ? 'fav.remove' : 'fav.add');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = label;
    b.setAttribute('aria-label', label);
    const txt = b.querySelector('span:not(.fav-star)');
    if (txt) txt.textContent = label;
  });
}

export function bindFavButtons(container) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b || !container.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFav(b.dataset.fav);
  });
}

// ------------------------------------------------------------------ barra lateral
// estrela desenhada pelo CSS (::before), sem texto: não entra no nome da página (título, ordem alfabética)
function starHtml(page) {
  const on = isFav(page);
  const label = t(on ? 'fav.removePage' : 'fav.addPage', { n: pageLabel(page) });
  return `<span class="nav-fav${on ? ' is-on' : ''}" data-nav-fav="${esc(page)}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}"></span>`;
}

function addStars() {
  document.querySelectorAll('#site-sidebar a.nav-link[data-page]').forEach((a) => {
    const page = a.dataset.page;
    if (!favable(page)) return; // página inicial não é favoritável
    a.querySelector('.nav-fav')?.remove();
    a.insertAdjacentHTML('beforeend', starHtml(page));
  });
}

function renderSection() {
  const nav = document.querySelector('#site-sidebar nav');
  if (!nav) return;
  let title = nav.querySelector('#nav-fav-title');
  let list = nav.querySelector('#nav-fav-list');
  if (!title) {
    nav.insertAdjacentHTML('afterbegin', '<div class="nav-section nav-fav-section" id="nav-fav-title"></div><ul class="nav-list" id="nav-fav-list" role="menu"></ul>');
    title = nav.querySelector('#nav-fav-title');
    list = nav.querySelector('#nav-fav-list');
  }
  const pages = favPages();
  const current = (location.hash || '#home').replace('#', '').split('?')[0] || 'home';
  title.textContent = t('fav.title');
  title.hidden = list.hidden = !pages.length;
  list.innerHTML = pages.map((p) => `<li><a class="nav-link${p === current ? ' active' : ''}" data-page="${esc(p)}" href="${esc(p)}.html">${esc(pageLabel(p))}</a></li>`).join('');
}

function renderSidebar() {
  renderSection();
  addStars();
}

// ------------------------------------------------------------------ grade da página inicial
// páginas favoritas primeiro (na ordem em que foram marcadas), com borda dourada; o resto mantém a ordem original
function orderHomeGrid() {
  const grid = document.querySelector('.home-quick-nav');
  if (!grid) return;
  const squares = [...grid.querySelectorAll('.home-nav-square')];
  squares.forEach((a, i) => { if (!a.dataset.homeOrder) a.dataset.homeOrder = String(i); });
  const favs = favPages();
  const pageOf = (a) => (a.getAttribute('href') || '').replace('#', '').split('?')[0];
  const rank = (a) => { const i = favs.indexOf(pageOf(a)); return i >= 0 ? i : favs.length + Number(a.dataset.homeOrder); };
  squares.sort((x, y) => rank(x) - rank(y)).forEach((a) => {
    a.classList.toggle('is-fav', favs.includes(pageOf(a)));
    grid.appendChild(a);
  });
}
export const initHomeFavGrid = () => orderHomeGrid();

export function initFavorites() {
  const sidebar = document.querySelector('#site-sidebar');
  if (sidebar && !sidebar.dataset.favReady) {
    sidebar.dataset.favReady = '1';
    // a estrela fica dentro do link: favorita sem abrir a página
    const toggle = (e) => {
      const s = e.target.closest('[data-nav-fav]');
      if (!s) return false;
      e.preventDefault();
      e.stopPropagation();
      toggleFav(s.dataset.navFav);
      // foco continua na mesma estrela depois de redesenhar
      requestAnimationFrame(() => sidebar.querySelector(`[data-nav-fav="${CSS.escape(s.dataset.navFav)}"]`)?.focus?.());
      return true;
    };
    sidebar.addEventListener('click', toggle, true);
    sidebar.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-nav-fav]')) toggle(e); }, true);
  }
  const update = () => { renderSidebar(); refreshButtons(); orderHomeGrid(); };
  window.addEventListener('favs-changed', update);
  // o idioma reescreve o texto dos links (e apaga as estrelas): redesenha depois
  window.addEventListener('langchange', () => setTimeout(update, 0));
  window.addEventListener('cloud-synced', update);
  window.addEventListener('storage', (e) => { if (e.key === FAV_KEY) update(); });
  renderSidebar();
}
