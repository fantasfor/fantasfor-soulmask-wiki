import { initUI } from './ui.js';
import { initGdmbotStore } from './gdmbot-store.js?v=1';
import { t, pick, getLang, setLang, applyI18n, locale } from './i18n.js';
import { loadData, esc, normalize } from './data.js';
import { initItemsPage } from './pages/items.js';
import { initTalentsPage } from './pages/talents.js';
import { initFoodsPage } from './pages/foods.js';
import { initArmorsPage } from './pages/armors.js';
import { initWeaponsPage } from './pages/weapons.js';
import { initRecipesPage } from './pages/recipes.js';
import { initMasksPage } from './pages/masks.js';
import { initCreaturesPage } from './pages/creatures.js';
import { initTierListPage } from './pages/tierlist.js';
import { initBuilderPage } from './pages/builder.js';
import { initCloud, mountAccountWidget } from './cloud.js';
import { trackPageView } from './analytics.js';
import { initMapPage } from './pages/map.js';
import { initFarmingPage } from './pages/farming.js';
import { initReportPage } from './pages/report.js';
import { initSupportPage } from './pages/support.js';
import { initBossesPage } from './pages/bosses.js';
import { initComfortPage } from './pages/comfort.js';
import { initProficiencyPage } from './pages/proficiency.js';
import { initMasteryPage } from './pages/mastery.js';
import { initEventsPage } from './pages/events.js';
import { initCommandsPage } from './pages/commands.js';
import { initServersPage } from './pages/servers.js';
import { initWorkbenchPage } from './pages/workbench.js';
import { initAttributesPage } from './pages/attributes.js';
import { initRedCrystalsPage } from './pages/red-crystals.js';
import { initCommunityPage } from './pages/community.js';
import { initBuilderCommunity } from './pages/builder-community.js';
import { initFavorites } from './favorites.js';

// página -> função de inicialização (recebe o elemento raiz e os parâmetros da URL)
const PAGE_INIT = {
  itens: initItemsPage,
  talentos: initTalentsPage,
  alimentos: initFoodsPage,
  armaduras: initArmorsPage,
  armas: initWeaponsPage,
  receitas: initRecipesPage,
  mascaras: initMasksPage,
  criaturas: initCreaturesPage,
  'tier-list': initTierListPage,
  // editor (builder.js) + aba Comunidade (builder-community.js)
  'builder-maker': async (root, params) => { await initBuilderPage(root, params); await initBuilderCommunity(root, params); },
  comunidade: initCommunityPage,
  mapa: initMapPage,
  plantio: initFarmingPage,
  reportar: initReportPage,
  apoie: initSupportPage,
  chefes: initBossesPage,
  conforto: initComfortPage,
  proficiencia: initProficiencyPage,
  maestria: initMasteryPage,
  eventos: initEventsPage,
  comandos: initCommandsPage,
  servidores: initServersPage,
  bancada: initWorkbenchPage,
  atributos: initAttributesPage,
  cristais: initRedCrystalsPage,
  gdmbot: () => initGdmbotStore()
};

async function fetchHTML(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch failed');
  return await r.text();
}

// "#gdmbot?app=XYZ" -> "gdmbot" (o que vem depois do "?" são parâmetros da página)
function currentPageName() {
  return (location.hash || '#home').replace('#', '').split('?')[0] || 'home';
}

function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}
window.getHashParams = hashParams;

// Páginas de entrada para o Google (comandos.html, mapa.html... geradas por tools/build_seo.py):
// mostram a seção do nome do arquivo e o endereço volta para o formato do site (./#comandos).
function adoptLandingPage() {
  const file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  if (location.hash || !file || file === 'index') return;
  history.replaceState(null, '', `./${location.search}#${file}`);
}
adoptLandingPage();

// ------------------------------------------------------------------ busca global
const SEARCH_SOURCES = [
  { file: 'items', kind: 'search.kind.item', page: 'itens', param: 'item' },
  { file: 'talents', kind: 'search.kind.talent', page: 'talentos', param: 'q' },
  { file: 'armor-sets', kind: 'search.kind.armor', page: 'armaduras', param: 'set' },
  { file: 'creatures', kind: 'search.kind.creature', page: 'criaturas', param: 'q' }
];
let searchCatalog = null;

async function buildSearchCatalog() {
  const lists = await Promise.all(SEARCH_SOURCES.map((s) => loadData(s.file).catch(() => [])));
  searchCatalog = lists.flatMap((list, i) => list.map((x) => ({
    src: SEARCH_SOURCES[i],
    item: x,
    hay: normalize(`${x.name_pt || ''} ${x.name_en || ''}`)
  })));
}

function setupSidebarSearch() {
  const input = document.querySelector('.sidebar-search');
  const wrapper = document.querySelector('.sidebar-search-wrapper');
  if (!input || !wrapper || wrapper.dataset.searchReady === 'true') return;
  wrapper.dataset.searchReady = 'true';
  const results = document.createElement('div');
  results.className = 'sidebar-search-results';
  results.hidden = true;
  wrapper.appendChild(results);

  const clear = () => { results.innerHTML = ''; results.hidden = true; };
  async function render() {
    const q = normalize(input.value.trim());
    if (q.length < 2) { clear(); return; }
    if (!searchCatalog) await buildSearchCatalog();
    const starts = []; const contains = [];
    for (const e of searchCatalog) {
      const i = e.hay.indexOf(q);
      if (i === 0) starts.push(e); else if (i > 0) contains.push(e);
      if (starts.length >= 10) break;
    }
    const matches = starts.concat(contains).slice(0, 10);
    results.innerHTML = matches.length
      ? matches.map((m) => {
        const value = m.src.param === 'q' ? pick(m.item, 'name') : m.item.id;
        return `<button type="button" class="sidebar-search-result" data-page="${esc(m.src.page)}" data-param="${esc(m.src.param)}" data-value="${esc(value)}">
          ${m.item.icon ? `<img src="${esc(m.item.icon)}" alt="" loading="lazy" />` : ''}
          <strong>${esc(pick(m.item, 'name'))}</strong><span>${esc(t(m.src.kind))}</span></button>`;
      }).join('')
      : `<div class="sidebar-search-empty">${esc(t('site.noResults'))}</div>`;
    results.hidden = false;
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; clear(); } });
  results.addEventListener('click', (e) => {
    const r = e.target.closest('.sidebar-search-result');
    if (!r) return;
    input.value = '';
    clear();
    const target = `#${r.dataset.page}?${r.dataset.param}=${encodeURIComponent(r.dataset.value)}`;
    if (location.hash === target) loadPageFromHash(); else location.hash = target;
  });
  document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) clear(); });
}

// ------------------------------------------------------------------ menu em ordem alfabética (no idioma atual)
function sortSidebar() {
  document.querySelectorAll('#site-sidebar .nav-list[data-sort="alpha"]').forEach((ul) => {
    [...ul.children]
      .sort((a, b) => a.textContent.trim().localeCompare(b.textContent.trim(), locale(), { sensitivity: 'base' }))
      .forEach((li) => ul.appendChild(li));
  });
}

// ------------------------------------------------------------------ rodapé (direitos autorais)
function renderFooter() {
  const f = document.querySelector('#site-footer');
  if (!f) return;
  const year = new Date().getFullYear();
  f.innerHTML = `
    <p class="site-footer-main">${esc(t('footer.copyright', { year }))}</p>
    <p>${esc(t('footer.rights'))}</p>
    <p>${esc(t('footer.game'))}</p>`;
}

// ------------------------------------------------------------------ idioma
function setupLangSwitch() {
  const update = () => document.querySelectorAll('.lang-switch-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  });
  document.querySelectorAll('.lang-switch-btn').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  update();
  window.addEventListener('langchange', () => {
    update();
    applyI18n(document.querySelector('#site-sidebar'));
    sortSidebar();
    renderFooter();
    updateDocumentTitle();
    loadPageFromHash({ keepScroll: true });
  });
}

function updateDocumentTitle() {
  const link = document.querySelector(`a.nav-link[data-page="${currentPageName()}"]`);
  document.title = link ? `Soulmask Fantasfor Wiki — ${link.textContent.trim()}` : 'Soulmask Fantasfor Wiki';
}

// ------------------------------------------------------------------ troca de conteúdo
async function swapContent(html) {
  const container = document.querySelector('#page-content');
  if (!container) return null;
  const oldView = container.querySelector('.view');
  if (oldView) {
    oldView.classList.add('view-exit');
    requestAnimationFrame(() => oldView.classList.add('view-exit-active'));
    await new Promise((res) => {
      const timeout = setTimeout(res, 300);
      oldView.addEventListener('transitionend', () => { clearTimeout(timeout); res(); }, { once: true });
    });
  }
  container.innerHTML = `<div class="view view-enter">${html}</div>`;
  const view = container.querySelector('.view');
  applyI18n(view);
  requestAnimationFrame(() => view.classList.add('view-enter-active'));
  await new Promise((res) => {
    const timeout = setTimeout(res, 300);
    view.addEventListener('transitionend', () => { clearTimeout(timeout); res(); }, { once: true });
  });
  view.classList.remove('view-enter', 'view-enter-active');
  return view;
}

let loadToken = 0;
async function loadPageFromHash(opts = {}) {
  const token = ++loadToken;
  let page = currentPageName();
  document.querySelectorAll('a.nav-link').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  let view;
  try {
    view = await swapContent(await fetchHTML(`pages/${page}.html`));
  } catch (e) {
    console.warn('page load failed, loading home', e);
    page = 'home';
    view = await swapContent(await fetchHTML('pages/home.html'));
    document.querySelectorAll('a.nav-link').forEach((n) => n.classList.toggle('active', n.dataset.page === 'home'));
    history.replaceState(null, '', '#home');
  }
  if (token !== loadToken || !view) return;
  updateDocumentTitle();
  trackPageView(page);
  const init = PAGE_INIT[page];
  if (init) {
    const root = view.firstElementChild || view;
    try {
      await init(root, hashParams());
    } catch (e) {
      console.error('init', page, e);
    }
  }
  if (page === 'home') {
    renderHomeFeeds();
    renderHomeUpdates();
  }
  if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', () => loadPageFromHash());

window.navigateTo = function navigateTo(page) {
  const target = '#' + (page || 'home');
  if (location.hash !== target) location.hash = target; else loadPageFromHash();
};

document.body.addEventListener('click', (ev) => {
  if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return; // nova aba: segue o link normal
  const anchor = ev.target.closest('a[href^="#"], a.nav-link[data-page]');
  if (!anchor || anchor.closest('.item-modal')) return;
  const href = anchor.getAttribute('href') || '';
  if (href === '#') return;
  ev.preventDefault();
  const target = anchor.dataset.page ? `#${anchor.dataset.page}` : href;
  if (location.hash === target) loadPageFromHash(); else location.hash = target;
});

// ------------------------------------------------------------------ home: feeds e notas
// títulos de feeds externos às vezes trazem emoji (ex.: "🔴 AO VIVO"): o site não usa emoji
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();

function createFeedItem(item) {
  item = { ...item, title: stripEmoji(item.title) };
  const li = document.createElement('li');
  li.className = 'home-feed-item';
  li.innerHTML = `
    ${item.thumbnail
      ? `<img class="home-feed-item-thumb" src="${esc(item.thumbnail)}" alt="${esc(item.title)}">`
      : `<img class="home-feed-item-icon" src="${esc(item.icon)}" alt="">`}
    <div class="home-feed-item-body">
      <h3 class="home-feed-item-title">${esc(item.title)}</h3>
      <span class="home-feed-item-date">${esc(item.date)}</span>
    </div>
    <a class="home-feed-item-button" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.buttonText)}</a>`;
  return li;
}

async function fetchRss2JsonFeed(feedUrl) {
  const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`);
  if (!res.ok) throw new Error('rss2json failed');
  const data = await res.json();
  if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('rss2json invalid');
  return data.items;
}

async function fetchXmlProxy(feedUrl) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`,
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(feedUrl)}`
  ];
  let lastError;
  for (const url of proxies) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('proxy failed');
      const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
      const items = Array.from(doc.querySelectorAll('item, entry'));
      if (!items.length) throw new Error('parsed zero items');
      return { doc, items };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('proxy feed failure');
}

function parseXmlImage(item) {
  const enclosure = item.querySelector('enclosure');
  if (enclosure?.getAttribute('url')) return enclosure.getAttribute('url');
  const match = (item.querySelector('description')?.textContent || '').match(/<img[^>]*src="([^"]+)"/i);
  return match ? match[1] : '';
}

function getYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('v') || parsed.pathname.split('/').pop() || '';
  } catch (e) {
    return '';
  }
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(locale()) : '');

async function fetchSteamFeed() {
  const feedUrl = 'https://store.steampowered.com/feeds/news/app/2646460/';
  const base = { icon: 'assets/img/nav-hexagon.svg', buttonText: t('home.seeNews') };
  try {
    const items = await fetchRss2JsonFeed(feedUrl);
    if (!items.length) throw new Error('empty');
    return items.slice(0, 3).map((item) => ({
      ...base,
      thumbnail: item.thumbnail || item.enclosure?.link || '',
      title: item.title || t('home.noTitle'),
      date: fmtDate(item.pubDate),
      url: item.link || 'https://store.steampowered.com/app/2646460/'
    }));
  } catch (e) {
    console.warn('fetchSteamFeed rss2json', e);
  }
  try {
    const { items } = await fetchXmlProxy(feedUrl);
    return items.slice(0, 3).map((item) => ({
      ...base,
      thumbnail: parseXmlImage(item),
      title: item.querySelector('title')?.textContent || t('home.noTitle'),
      date: fmtDate(item.querySelector('pubDate')?.textContent),
      url: item.querySelector('link')?.textContent || 'https://store.steampowered.com/app/2646460/'
    }));
  } catch (e) {
    console.warn('fetchSteamFeed proxy', e);
    return [{ ...base, title: t('home.steamFail'), date: '', url: 'https://store.steampowered.com/app/2646460/', buttonText: t('home.seeSteam') }];
  }
}

async function fetchYouTubeFeed() {
  const channelUrl = 'https://www.youtube.com/@GDMFantasfor';
  const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCUNx7vQ1iTmU_YIvCsApGPw';
  const base = { icon: 'assets/img/nav-hexagon.svg', buttonText: t('home.seeVideo') };
  try {
    const items = await fetchRss2JsonFeed(feedUrl);
    if (!items.length) throw new Error('empty');
    return items.slice(0, 4).map((item) => {
      const id = getYoutubeVideoId(item.link || '');
      return { ...base, thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '', title: item.title || t('home.noTitle'), date: fmtDate(item.pubDate), url: item.link || channelUrl };
    });
  } catch (e) {
    console.warn('fetchYouTubeFeed rss2json', e);
  }
  try {
    const { items } = await fetchXmlProxy(feedUrl);
    return items.slice(0, 4).map((item) => {
      const link = item.querySelector('link')?.getAttribute('href') || channelUrl;
      const id = getYoutubeVideoId(link);
      return { ...base, thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '', title: item.querySelector('title')?.textContent || t('home.noTitle'), date: fmtDate(item.querySelector('published')?.textContent), url: link };
    });
  } catch (e) {
    console.warn('fetchYouTubeFeed proxy', e);
    return [{ ...base, title: t('home.youtubeFail'), date: '', url: channelUrl, buttonText: t('home.seeChannel') }];
  }
}

// notas de atualização do site: assets/data/updates.json (pt/en), mais nova primeiro
async function renderHomeUpdates() {
  const list = document.getElementById('home-updates-list');
  if (!list) return;
  try {
    const updates = (await loadData('updates')).slice(0, 4);
    if (!updates.length) {
      list.innerHTML = `<article class="home-update-card"><h3>${esc(t('home.notesNone'))}</h3></article>`;
      return;
    }
    list.innerHTML = `
      <article class="home-update-card">
        <h3>${esc(t('home.notesTitle'))}</h3>
        ${updates.map((u) => `
          <div class="home-update-version">
            <strong>${esc(u.version)}${u.date ? ` — ${esc(new Date(`${u.date}T12:00:00`).toLocaleDateString(locale()))}` : ''}</strong>
            <ul>${(u[getLang()] || u.pt || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          </div>`).join('')}
      </article>`;
  } catch (error) {
    console.warn('renderHomeUpdates', error);
    list.innerHTML = `<article class="home-update-card"><h3>${esc(t('home.notesError'))}</h3></article>`;
  }
}
async function renderHomeFeeds() {
  const steam = document.getElementById('soulmask-feed');
  const yt = document.getElementById('youtube-feed');
  if (!steam || !yt) return;
  steam.innerHTML = `<li class="home-feed-loading">${esc(t('home.loadingSteam'))}</li>`;
  yt.innerHTML = `<li class="home-feed-loading">${esc(t('home.loadingYoutube'))}</li>`;
  const [s, y] = await Promise.all([fetchSteamFeed(), fetchYouTubeFeed()]);
  steam.innerHTML = '';
  s.forEach((item) => steam.appendChild(createFeedItem(item)));
  yt.innerHTML = '';
  y.forEach((item) => yt.appendChild(createFeedItem(item)));
}

// ------------------------------------------------------------------ início
async function init() {
  const sidebarTarget = document.querySelector('#site-sidebar');
  if (sidebarTarget) {
    try {
      sidebarTarget.innerHTML = await fetchHTML('components/sidebar.html');
      applyI18n(sidebarTarget);
    } catch (error) {
      console.error('Failed to load sidebar', error);
    }
  }
  const mainContent = document.querySelector('#main-content');
  if (mainContent) {
    try {
      const headerWrapper = document.createElement('header');
      headerWrapper.id = 'site-header';
      headerWrapper.innerHTML = await fetchHTML('components/header.html');
      mainContent.insertBefore(headerWrapper, mainContent.firstChild);
    } catch (error) {
      console.error('Failed to load header', error);
    }
  }
  sortSidebar();
  renderFooter();
  initUI();
  setupLangSwitch();
  setupSidebarSearch();
  // conta (login Google) e sincronização das builds/tier lists; recarrega a página quando chegam dados da conta
  mountAccountWidget(document.querySelector('#account-box'));
  initCloud();
  initFavorites(); // estrela nos botões da barra lateral + categoria Favoritos
  window.addEventListener('cloud-synced', () => loadPageFromHash({ keepScroll: true }));
  await loadPageFromHash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
