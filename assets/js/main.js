import { initUI } from './ui.js';
import { initGdmbotStore } from './gdmbot-store.js?v=1';

const CLASS_WEAPONS = {
  warrior: {
    label: 'Guerreiro',
    weapons: [
      { name: 'Lâmina de Duas Mãos', image: 'assets/img/itens/t13_img_0083_05_01.webp' },
      { name: 'Martelo', image: 'assets/img/itens/t13_img_0087_05_01.webp' },
      { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0082_05_01.webp' },
      { name: 'Espada Grande', image: 'assets/img/itens/t13_img_0086_05_01.webp' },
      { name: 'Manoplas', image: 'assets/img/itens/t13_img_0084_05_01.webp' }
    ]
  },
  hunter: {
    label: 'Caçador',
    weapons: [
      { name: 'Arco Longo', image: 'assets/img/itens/t13_img_0088_05_01.webp' },
      { name: 'Lâmina de Duas Mãos', image: 'assets/img/itens/t13_img_0083_05_01.webp' },
      { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0082_05_01.webp' },
      { name: 'Lança', image: 'assets/img/itens/t13_img_0091_05_01.webp' },
      { name: 'Manoplas', image: 'assets/img/itens/t13_img_0084_05_01.webp' },
      { name: 'Chicote de Espinhos', image: 'assets/img/itens/t13_img_0092_05_01.webp' }
    ]
  },
  guard: {
    label: 'Guarda',
    weapons: [
      { name: 'Escudo', image: 'assets/img/itens/t13_img_0090_05_01.webp' },
      { name: 'Arco', image: 'assets/img/itens/t13_img_0081_05_01.webp' },
      { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0082_05_01.webp' },
      { name: 'Espada Grande', image: 'assets/img/itens/t13_img_0086_05_01.webp' },
      { name: 'Lança', image: 'assets/img/itens/t13_img_0091_05_01.webp' }
    ]
  }
};

const ALL_WEAPONS = Object.values(CLASS_WEAPONS).flatMap((classData) => classData.weapons)
  .filter((weapon, index, weapons) => weapons.findIndex((item) => item.name === weapon.name) === index);

async function loadComponent(path, selector) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error('fetch failed');
    const html = await r.text();
    const node = document.querySelector(selector);
    if (node) node.innerHTML = html;
  } catch (e) {
    console.error('loadComponent', path, e);
  }
}

async function fetchHTML(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch failed');
  return await r.text();
}

async function swapContent(html) {
  function normalizeGlobalSearch(value) {
    return (value || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
    let catalog = [];
    const sources = [
      { page: 'talentos', label: 'Talento', url: 'assets/data/talentos.json', name: (item) => item['Title PT'] || item['Title EN'], text: (item) => item['Description PT'] || item['Description EN'] },
      { page: 'itens', label: 'Item', url: 'assets/data/itens.json', name: (item) => item.name_pt || item.name, text: (item) => item.description_pt || item.description },
      { page: 'alimentos', label: 'Alimento', url: 'assets/data/alimentos.json', name: (item) => item.name_pt || item.name_en, text: (item) => `${item.description_pt || item.description_en || ''} ${item.bonus || ''}` },
      { page: 'armaduras', label: 'Armadura', url: 'assets/data/Armaduras.json', name: (item) => item.name_pt || item.name, text: (item) => `${item.description_pt || item.description || ''} ${item.efeito_conjunto || ''}` }
    ];
    async function loadCatalog() {
      const loaded = await Promise.all(sources.map(async (source) => {
        try {
          const response = await fetch(source.url, source.page === 'itens' ? { cache: 'no-store' } : undefined);
          if (!response.ok) return [];
          const data = await response.json();
          return (Array.isArray(data) ? data : []).map((item) => ({
            page: source.page,
            label: source.label,
            name: source.name(item) || source.label,
            text: source.text(item) || ''
          }));
        } catch {
          return [];
        }
      }));
      catalog = loaded.flat();
    }
    function clearResults() {
      results.innerHTML = '';
      results.hidden = true;
    }
    function renderResults(query) {
      const normalized = normalizeGlobalSearch(query);
      if (!normalized) {
        clearResults();
        return;
      }
      const matches = catalog.filter((item) => normalizeGlobalSearch(`${item.name} ${item.text}`).includes(normalized)).slice(0, 8);
      results.innerHTML = matches.length
        ? matches.map((item) => `<button type="button" class="sidebar-search-result" data-page="${item.page}"><strong>${item.name}</strong><span>${item.label}</span></button>`).join('')
        : '<div class="sidebar-search-empty">Nenhum resultado</div>';
      results.hidden = false;
    }
    input.addEventListener('input', () => renderResults(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        clearResults();
      }
    });
    results.addEventListener('click', (event) => {
      const result = event.target.closest('.sidebar-search-result');
      if (!result) return;
      input.value = '';
      clearResults();
      window.navigateTo(result.dataset.page);
    });
    document.addEventListener('click', (event) => {
      if (!wrapper.contains(event.target)) clearResults();
    });
    loadCatalog();
  }
    setupSidebarSearch();
  const container = document.querySelector('#page-content');
  if (!container) return;

  const oldView = container.querySelector('.view');
  if (oldView) {
    oldView.classList.add('view-exit');
    requestAnimationFrame(() => oldView.classList.add('view-exit-active'));
    await new Promise((res) => {
      const timeout = setTimeout(res, 300);
      oldView.addEventListener('transitionend', () => {
        clearTimeout(timeout);
        res();
      }, { once: true });
    });
  }

  container.innerHTML = `<div class="view view-enter">${html}</div>`;
  const newView = container.querySelector('.view');
  if (!newView) return;

  requestAnimationFrame(() => newView.classList.add('view-enter-active'));
  await new Promise((res) => {
    const timeout = setTimeout(res, 300);
    newView.addEventListener('transitionend', () => {
      clearTimeout(timeout);
      res();
    }, { once: true });
  });

  newView.classList.remove('view-enter', 'view-enter-active');

  if (container.innerHTML.includes('builder-maker-page')) {
    initBuilderMakerPage();
  }
}

function createFeedItem(item) {
  const li = document.createElement('li');
  li.className = 'home-feed-item';
  li.innerHTML = `
    ${item.thumbnail
      ? `<img class="home-feed-item-thumb" src="${item.thumbnail}" alt="${item.title}">`
      : `<img class="home-feed-item-icon" src="${item.icon}" alt="${item.iconAlt}">`}
    <div class="home-feed-item-body">
      <h3 class="home-feed-item-title">${item.title}</h3>
      <span class="home-feed-item-date">${item.date}</span>
    </div>
    <a class="home-feed-item-button" href="${item.url}" target="_blank" rel="noopener noreferrer">${item.buttonText}</a>
  `;
  return li;
}

async function fetchRss2JsonFeed(feedUrl) {
  const proxy = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
  const res = await fetch(proxy);
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
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'application/xml');
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

  const desc = item.querySelector('description')?.textContent || '';
  const match = desc.match(/<img[^>]*src="([^"]+)"/i);
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

async function fetchSteamFeed() {
  const feedUrl = 'https://store.steampowered.com/feeds/news/app/2646460/';

  try {
    const items = await fetchRss2JsonFeed(feedUrl);
    if (!items.length) throw new Error('Steam RSS retornou nenhum item');
    return items.slice(0, 3).map((item) => ({
      icon: 'assets/img/nav-hexagon.svg',
      iconAlt: 'Ícone Soulmask',
      thumbnail: item.thumbnail || item.enclosure?.link || '',
      title: item.title || 'Sem título',
      date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('pt-BR') : '',
      url: item.link || 'https://store.steampowered.com/app/2646460/',
      buttonText: 'Ver notícia'
    }));
  } catch (e) {
    console.warn('fetchSteamFeed rss2json', e);
  }

  try {
    const { items } = await fetchXmlProxy(feedUrl);
    if (!items.length) throw new Error('Steam proxy retornou nenhum item');
    return items.slice(0, 3).map((item) => ({
      icon: 'assets/img/nav-hexagon.svg',
      iconAlt: 'Ícone Soulmask',
      thumbnail: parseXmlImage(item),
      title: item.querySelector('title')?.textContent || 'Sem título',
      date: item.querySelector('pubDate')?.textContent ? new Date(item.querySelector('pubDate')?.textContent).toLocaleDateString('pt-BR') : '',
      url: item.querySelector('link')?.textContent || 'https://store.steampowered.com/app/2646460/',
      buttonText: 'Ver notícia'
    }));
  } catch (e) {
    console.warn('fetchSteamFeed proxy', e);
    return [
      { icon: 'assets/img/nav-hexagon.svg', iconAlt: 'Ícone Soulmask', title: 'Não foi possível carregar o feed da Steam', date: '', url: 'https://store.steampowered.com/app/2646460/', buttonText: 'Ver Steam' }
    ];
  }
}

async function fetchYouTubeFeed() {
  const channelUrl = 'https://www.youtube.com/@GDMFantasfor';
  const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCUNx7vQ1iTmU_YIvCsApGPw';

  try {
    const items = await fetchRss2JsonFeed(feedUrl);
    if (!items.length) throw new Error('YouTube RSS retornou nenhum item');
    return items.slice(0, 4).map((item) => {
      const videoId = getYoutubeVideoId(item.link || '');
      return {
        icon: 'assets/img/nav-hexagon.svg',
        iconAlt: 'Ícone YouTube',
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
        title: item.title || 'Sem título',
        date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('pt-BR') : '',
        url: item.link || channelUrl,
        buttonText: 'Ver vídeo'
      };
    });
  } catch (e) {
    console.warn('fetchYouTubeFeed rss2json', e);
  }

  try {
    const { items } = await fetchXmlProxy(feedUrl);
    if (!items.length) throw new Error('YouTube proxy retornou nenhum item');
    return items.slice(0, 4).map((item) => {
      const link = item.querySelector('link')?.getAttribute('href') || channelUrl;
      const videoId = getYoutubeVideoId(link);
      return {
        icon: 'assets/img/nav-hexagon.svg',
        iconAlt: 'Ícone YouTube',
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
        title: item.querySelector('title')?.textContent || 'Sem título',
        date: item.querySelector('published')?.textContent ? new Date(item.querySelector('published')?.textContent).toLocaleDateString('pt-BR') : '',
        url: link,
        buttonText: 'Ver vídeo'
      };
    });
  } catch (e) {
    console.warn('fetchYouTubeFeed proxy', e);
    return [
      { icon: 'assets/img/nav-hexagon.svg', iconAlt: 'Ícone YouTube', title: 'Não foi possível carregar o feed do YouTube', date: '', url: channelUrl, buttonText: 'Ver canal' }
    ];
  }
}

function decodeBase64Utf8(base64) {
  try {
    return decodeURIComponent(escape(atob(base64.replace(/\s/g, ''))));
  } catch (e) {
    return atob(base64.replace(/\s/g, ''));
  }
}

function parseUpdateNotesMarkdown(markdown, limit = 4) {
  const versions = markdown.split(/^## \[/m).slice(1);
  return versions.slice(0, limit).map((section) => {
    const lines = section.split('\n');
    const headerLine = lines[0].trim();
    const headerMatch = headerLine.match(/^([\d.]+)\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    const version = headerMatch ? headerMatch[1] : headerLine.replace(/\].*$/, '');
    const date = headerMatch ? headerMatch[2] : '';
    const formattedDate = date ? date.split('-').reverse().join('/') : '';
    const changes = lines.slice(1).map((line) => line.trim()).filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
    return {
      version: version || 'Atualização',
      date: formattedDate,
      changes: changes.length ? changes : ['Nenhuma mudança clara encontrada.']
    };
  }).filter((item) => item.changes.length);
}

async function fetchUpdateNotesWithApi() {
  const url = 'https://api.github.com/repos/fantasfor/Site/contents/Atualizacao.md?t=' + Date.now();
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error('GitHub API erro ' + res.status);
  const data = await res.json();
  if (!data.content) throw new Error('Conteúdo de atualização não encontrado');
  return decodeBase64Utf8(data.content);
}

async function fetchUpdateNotesWithRaw() {
  const url = 'https://raw.githubusercontent.com/fantasfor/Site/main/Atualizacao.md?t=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Raw GitHub erro ' + res.status);
  return await res.text();
}

async function fetchUpdateNotes() {
  try {
    return await fetchUpdateNotesWithApi();
  } catch (apiError) {
    console.warn('fetchUpdateNotes API failed, trying raw content', apiError);
    try {
      return await fetchUpdateNotesWithRaw();
    } catch (rawError) {
      console.warn('fetchUpdateNotes raw fallback failed', rawError);
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://raw.githubusercontent.com/fantasfor/Site/main/Atualizacao.md');
      const proxyRes = await fetch(proxyUrl, { cache: 'no-store' });
      if (!proxyRes.ok) throw new Error('AllOrigins proxy erro ' + proxyRes.status);
      return await proxyRes.text();
    }
  }
}

async function renderHomeUpdates() {
  const updatesList = document.getElementById('home-updates-list');
  if (!updatesList) return;

  updatesList.innerHTML = '<article class="home-update-card"><h3>Carregando notas...</h3><p style="margin:0;color:#d9d2c5;">Buscando atualizações do GitHub.</p></article>';

  try {
    const markdown = await fetchUpdateNotes();
    const updates = parseUpdateNotesMarkdown(markdown, 4);
    if (!updates.length) {
      updatesList.innerHTML = '<article class="home-update-card"><h3>Nenhuma nota encontrada</h3><p style="margin:0;color:#d9d2c5;">O arquivo de atualizações não contém seções no formato esperado.</p></article>';
      return;
    }

    const card = document.createElement('article');
    card.className = 'home-update-card';
    card.innerHTML = `
      <h3>Notas de Atualização</h3>
      ${updates.map((update) => `
        <div class="home-update-version">
          <strong>${update.version}${update.date ? ' — ' + update.date : ''}</strong>
          <ul>${update.changes.map((change) => `<li>${change}</li>`).join('')}</ul>
        </div>
      `).join('')}
    `;

    updatesList.innerHTML = '';
    updatesList.appendChild(card);
  } catch (error) {
    console.warn('renderHomeUpdates', error);
    updatesList.innerHTML = `<article class="home-update-card"><h3>Erro ao carregar notas</h3><p style="margin:0;color:#d9d2c5;">${error.message}</p></article>`;
  }
}

async function renderHomeFeeds() {
  const soulmaskFeed = document.getElementById('soulmask-feed');
  const youtubeFeed = document.getElementById('youtube-feed');
  if (!soulmaskFeed || !youtubeFeed) return;

  soulmaskFeed.innerHTML = '<li class="home-feed-loading">Carregando atualizações Soulmask...</li>';
  youtubeFeed.innerHTML = '<li class="home-feed-loading">Carregando vídeos do YouTube...</li>';

  try {
    const steamItems = await fetchSteamFeed();
    soulmaskFeed.innerHTML = '';
    steamItems.forEach((item) => soulmaskFeed.appendChild(createFeedItem(item)));
  } catch (error) {
    console.warn('renderHomeFeeds steam', error);
    soulmaskFeed.innerHTML = '<li class="home-feed-error">Erro ao carregar o feed Soulmask. Tente novamente mais tarde.</li>';
  }

  try {
    const youtubeItems = await fetchYouTubeFeed();
    youtubeFeed.innerHTML = '';
    youtubeItems.forEach((item) => youtubeFeed.appendChild(createFeedItem(item)));
  } catch (error) {
    console.warn('renderHomeFeeds youtube', error);
    youtubeFeed.innerHTML = '<li class="home-feed-error">Erro ao carregar o feed do YouTube. Tente novamente mais tarde.</li>';
  }
}

// "#gdmbot?app=XYZ" -> "gdmbot" (o que vem depois do "?" são parâmetros da página)
function currentPageName() {
  return (location.hash || '#home').replace('#', '').split('?')[0] || 'home';
}

window.getHashParams = function getHashParams() {
  const query = (location.hash.split('?')[1] || '');
  return new URLSearchParams(query);
};

async function loadPageFromHash() {
  const page = currentPageName();

  document.querySelectorAll('a.nav-link').forEach((n) => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  try {
    const html = await fetchHTML(`pages/${page}.html`);
    await swapContent(html);
  } catch (e) {
    console.warn('page load failed, loading home', e);
    const html = await fetchHTML('pages/home.html');
    await swapContent(html);
    document.querySelectorAll('a.nav-link').forEach((n) => n.classList.toggle('active', n.dataset.page === 'home'));
    history.replaceState(null, '', '#home');
  }

  if (document.querySelector('.builder-maker-page')) {
    initBuilderMakerPage();
  }

  if (document.querySelector('.talents-page')) {
    initTalentsPage();
  }

  if (document.querySelector('.items-page')) {
    initItensPage();
  }

  if (document.querySelector('.foods-page')) {
    initAlimentosPage();
  }

  if (document.querySelector('.armaduras-page')) {
    initArmadurasPage();
  }

  if (document.querySelector('.tier-list-page')) {
    initTierListPage();
  }

  if (document.querySelector('.gdmbot-page')) {
    initGdmbotPage();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  if (document.querySelector('.home-page')) {
    renderHomeFeeds();
    renderHomeUpdates();
  }
}

window.addEventListener('hashchange', loadPageFromHash, false);

window.navigateTo = function (page) {
  const target = '#' + (page || 'home');
  if (location.hash !== target) {
    location.hash = target;
  } else {
    loadPageFromHash();
  }
};

document.body.addEventListener('click', (ev) => {
  const anchor = ev.target.closest('a[href^="#"]');
  if (!anchor) return;

  const href = anchor.getAttribute('href') || '';
  if (href === '#') return;

  ev.preventDefault();
  const p = anchor.dataset.page || href.replace('#', '') || 'home';
  window.navigateTo(p);
});

window.initTalentsPage = function initTalentsPage() {
  const root = document.querySelector('.talents-page');
  if (!root || root.dataset.talentsReady === 'true') return;
  root.dataset.talentsReady = 'true';

  let allTalents = [];
  let filteredTalents = [];
  let showFavoritesOnly = false;
  let favoriteIds = new Set();

  function getCurrentLanguage() {
    return localStorage.getItem('talents_lang') || 'pt';
  }

  const i18nStrings = {
    pt: {
      noResults: 'Nenhum talento encontrado',
      count: (n) => `${n} talento${n !== 1 ? 's' : ''} encontrado${n !== 1 ? 's' : ''}`,
    },
    en: {
      noResults: 'No talents found',
      count: (n) => `${n} talent${n !== 1 ? 's' : ''} found`,
    }
  };

  // Funções de favoritos
  function getFavorites() {
    const stored = localStorage.getItem('talents_favorites') || '[]';
    try {
      return new Set(JSON.parse(stored));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    localStorage.setItem('talents_favorites', JSON.stringify(Array.from(favoriteIds)));
  }

  function toggleFavorite(talentId) {
    if (favoriteIds.has(talentId)) {
      favoriteIds.delete(talentId);
    } else {
      favoriteIds.add(talentId);
    }
    saveFavorites();
    renderTalents();
  }

  async function loadTalents() {
    try {
      const response = await fetch('assets/data/talentos.json');
      if (!response.ok) throw new Error('Falha ao carregar arquivo');
      
      allTalents = await response.json();
      
      if (!Array.isArray(allTalents)) {
        throw new Error('Formato inválido');
      }

      // Atribuir IDs aos talentos
      allTalents = allTalents.map((t, idx) => ({ ...t, _id: idx }));

      // Carregar favoritos salvos
      favoriteIds = getFavorites();

      const lang = getCurrentLanguage();
      const types = new Set(allTalents.map(t => t[`Type ${lang === 'pt' ? 'PT' : 'EN'}`]).filter(Boolean));
      const exclusives = new Set(allTalents.map(t => t[`Exclusive ${lang === 'pt' ? 'PT' : 'EN'}`]).filter(Boolean).filter(e => e !== 'Nenhum' && e !== 'None'));
      
      populateTypeFilter(Array.from(types).sort());
      populateExclusiveFilter(Array.from(exclusives).sort());
      
      filteredTalents = [...allTalents];
      updateLangToggleButton();
      renderTalents();
      setupEventListeners();
    } catch (error) {
      console.error('Erro ao carregar talentos:', error);
      const container = root.querySelector('#talents-container');
      if (container) {
        container.innerHTML = `<div class="talents-error">❌ Erro ao carregar: ${error.message}</div>`;
      }
    }
  }

  function updateLangToggleButton() {
    const btn = root.querySelector('#talents-lang-toggle');
    if (btn) btn.textContent = getCurrentLanguage() === 'pt' ? 'EN' : 'PT';
  }

  function toggleTalentsLanguage() {
    const nextLang = getCurrentLanguage() === 'pt' ? 'en' : 'pt';
    localStorage.setItem('talents_lang', nextLang);

    const langKey = nextLang === 'pt' ? 'PT' : 'EN';
    const types = new Set(allTalents.map(t => t[`Type ${langKey}`]).filter(Boolean));
    const exclusives = new Set(allTalents.map(t => t[`Exclusive ${langKey}`]).filter(Boolean).filter(e => e !== 'Nenhum' && e !== 'None'));
    populateTypeFilter(Array.from(types).sort());
    populateExclusiveFilter(Array.from(exclusives).sort());

    const searchInput = root.querySelector('#talents-search');
    if (searchInput) searchInput.value = '';

    filteredTalents = [...allTalents];
    updateLangToggleButton();
    renderTalents();
  }

  function populateTypeFilter(types) {
    const select = root.querySelector('#talents-type-filter');
    if (!select) return;
    
    while (select.options.length > 1) {
      select.remove(1);
    }
    
    types.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      select.appendChild(option);
    });
  }

  function populateExclusiveFilter(exclusives) {
    const select = root.querySelector('#talents-exclusive-filter');
    if (!select) return;
    
    while (select.options.length > 1) {
      select.remove(1);
    }
    
    exclusives.forEach(exclusive => {
      const option = document.createElement('option');
      option.value = exclusive;
      option.textContent = exclusive;
      select.appendChild(option);
    });
  }

  function setupEventListeners() {
    const searchInput = root.querySelector('#talents-search');
    const typeFilter = root.querySelector('#talents-type-filter');
    const exclusiveFilter = root.querySelector('#talents-exclusive-filter');
    const favoritesBtn = root.querySelector('#talents-favorites-btn');
    const container = root.querySelector('#talents-container');

    if (searchInput) {
      searchInput.addEventListener('input', filterTalents);
    }
    if (typeFilter) {
      typeFilter.addEventListener('change', filterTalents);
    }
    if (exclusiveFilter) {
      exclusiveFilter.addEventListener('change', filterTalents);
    }
    if (favoritesBtn) {
      favoritesBtn.addEventListener('click', () => {
        showFavoritesOnly = !showFavoritesOnly;
        favoritesBtn.classList.toggle('active', showFavoritesOnly);
        filterTalents();
      });
    }
    const langToggleBtn = root.querySelector('#talents-lang-toggle');
    if (langToggleBtn) {
      langToggleBtn.addEventListener('click', toggleTalentsLanguage);
    }
    if (container) {
      container.addEventListener('click', (e) => {
        const favoriteBtn = e.target.closest('.talent-card-favorite');
        if (favoriteBtn) {
          e.preventDefault();
          const talentId = parseInt(favoriteBtn.dataset.id);
          toggleFavorite(talentId);
        }
      });
    }
  }

  function filterTalents() {
    const searchInput = root.querySelector('#talents-search');
    const typeFilter = root.querySelector('#talents-type-filter');
    const exclusiveFilter = root.querySelector('#talents-exclusive-filter');
    
    if (!searchInput || !typeFilter || !exclusiveFilter) return;

    const searchValue = searchInput.value.toLowerCase();
    const typeValue = typeFilter.value;
    const exclusiveValue = exclusiveFilter.value;
    const lang = getCurrentLanguage();
    const langKey = lang === 'pt' ? 'PT' : 'EN';

    filteredTalents = allTalents.filter(talent => {
      const title = (talent[`Title ${langKey}`] || '').toLowerCase();
      const description = (talent[`Description ${langKey}`] || '').toLowerCase();
      const type = talent[`Type ${langKey}`] || '';
      const exclusive = talent[`Exclusive ${langKey}`] || '';

      const matchesSearch = title.includes(searchValue) || description.includes(searchValue);
      const matchesType = !typeValue || type === typeValue;
      const matchesExclusive = !exclusiveValue || exclusive === exclusiveValue;
      const isFavorite = favoriteIds.has(talent._id);
      const matchesFavorite = !showFavoritesOnly || isFavorite;

      return matchesSearch && matchesType && matchesExclusive && matchesFavorite;
    });

    renderTalents();
  }

  function renderTalents() {
    const container = root.querySelector('#talents-container');
    if (!container) return;

    const lang = getCurrentLanguage();
    const langKey = lang === 'pt' ? 'PT' : 'EN';

    if (filteredTalents.length === 0) {
      const i18n = i18nStrings[lang];
      container.innerHTML = `<div class="talents-no-results">${i18n.noResults}</div>`;
      updateCount(0, lang);
      return;
    }

    container.innerHTML = filteredTalents.map(talent => {
      const isFavorite = favoriteIds.has(talent._id);
      const typeName = talent[`Type ${langKey}`] || '';
      const typeKey = (typeName || '').toLowerCase();
      const typeColors = {
        positivo: { accent: '#39d98a', soft: 'rgba(57, 217, 138, 0.16)', strong: 'rgba(57, 217, 138, 0.7)' },
        positive: { accent: '#39d98a', soft: 'rgba(57, 217, 138, 0.16)', strong: 'rgba(57, 217, 138, 0.7)' },
        tribo: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
        tribe: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
        personalidade: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        personality: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        titulo: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
        title: { accent: '#d4af37', soft: 'rgba(212, 175, 55, 0.16)', strong: 'rgba(212, 175, 55, 0.7)' },
        origem: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        origin: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        preferencias: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        preferences: { accent: '#b974ff', soft: 'rgba(185, 116, 255, 0.16)', strong: 'rgba(185, 116, 255, 0.7)' },
        normal: { accent: '#e63946', soft: 'rgba(230, 57, 70, 0.16)', strong: 'rgba(230, 57, 70, 0.7)' },
      };
      const typePalette = typeColors[typeKey] || typeColors.normal;
      const articleStyle = `--card-accent:${typePalette.accent};--card-accent-soft:${typePalette.soft};--card-accent-strong:${typePalette.strong};`;
      const typeSlug = (typeName || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      return `
      <article class="talent-card${typeSlug ? ` type-${typeSlug}` : ''}" style="${articleStyle}">
        <button 
          class="talent-card-favorite ${isFavorite ? 'favorited' : ''}" 
          data-id="${talent._id}"
          title="${isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"
        >
          ${isFavorite ? '★' : '☆'}
        </button>
        
        <div class="talent-card-header">
          <img 
            src="${talent.Icon || ''}" 
            alt="${talent[`Title ${langKey}`] || 'Talent'}"
            class="talent-card-icon"
            loading="lazy"
          />
          <div class="talent-card-title-section">
            <h3 class="talent-card-title">${talent[`Title ${langKey}`] || ''}</h3>
            <span class="talent-card-type">${talent[`Type ${langKey}`] || ''}</span>
          </div>
        </div>
        
        <div class="talent-card-body">
          <p class="talent-card-description">${talent[`Description ${langKey}`] || ''}</p>
          
          ${talent[`Exclusive ${langKey}`] && talent[`Exclusive ${langKey}`] !== 'Nenhum' && talent[`Exclusive ${langKey}`] !== 'None'
            ? `<div class="talent-card-exclusive">
                <strong class="talent-card-exclusive-label">${lang === 'pt' ? 'Exclusivo:' : 'Exclusive:'}</strong>
                <span class="talent-card-exclusive-value">${talent[`Exclusive ${langKey}`]}</span>
              </div>`
            : ''
          }
          
          ${talent.New ? `<span class="talent-card-new">${lang === 'pt' ? 'NOVO' : 'NEW'}</span>` : ''}
        </div>
      </article>
    `;
    }).join('');

    updateCount(filteredTalents.length, lang);
  }

  function updateCount(count, lang) {
    const statsElement = root.querySelector('#talents-count');
    if (statsElement) {
      const i18n = i18nStrings[lang];
      statsElement.textContent = i18n.count(count);
    }
  }

  loadTalents();
};

window.initBuilderMakerPage = function initBuilderMakerPage() {
  const root = document.querySelector('.builder-maker-page');
  if (!root || root.dataset.builderReady === 'true') return;
  root.dataset.builderReady = 'true';

  const STORAGE_KEY = 'soulmask_builder_builds_v2';
  const MAX_TALENT_SLOTS = 8;
  const POSITIVE_TALENT_START_SLOT = 2;

  const selectorGridEl = root.querySelector('#talentSelectorGrid');
  const talentPickerModalEl = root.querySelector('#talentPickerModal');
  const talentPickerSearchEl = root.querySelector('#talentPickerSearch');
  const talentPickerListEl = root.querySelector('#talentPickerList');
  const talentPickerPreviewEl = root.querySelector('#talentPickerPreview');
  const armorSlotsEl = root.querySelector('#armorSlots');
  const armorPickerInlineEl = root.querySelector('#armorPickerInline');
  const foodCategorySlotsEl = root.querySelector('#foodCategorySlots');
  const foodPickerInlineEl = root.querySelector('#foodPickerInline');
  const buildNameInput = root.querySelector('#buildName');
  const buildDescriptionInput = root.querySelector('#buildDescription');
  const buildTribeInput = root.querySelector('#buildTribe');
  const builderHeaderNameEl = root.querySelector('#builderHeaderName');
  const builderHeaderTribeEl = root.querySelector('#builderHeaderTribe');
  const builderHeaderTitleEl = root.querySelector('#builderHeaderTitle');
  const builderHeaderClassEl = root.querySelector('#builderHeaderClass');
  const builderHeaderMasterEl = root.querySelector('#builderHeaderMaster');
  const counterEl = root.querySelector('#positiveCounter');
  const positiveLimitEl = root.querySelector('#positiveLimit');
  const savedBuildsListEl = root.querySelector('#savedBuildsList');
  const setBonusPanelEl = root.querySelector('#setBonusPanel');
  const importInput = root.querySelector('#buildImportInput');
  const buildSaveStatusEl = root.querySelector('#buildSaveStatus');
  const talentExportLevelEl = root.querySelector('#talentExportLevel');
  const talentExportCodeEl = root.querySelector('#talentExportCode');
  const talentExportStatusEl = root.querySelector('#talentExportStatus');
  const talentExportPreviewEl = root.querySelector('#talentExportPreview');

  const state = {
    search: '',
    selectedPositive: Array(MAX_TALENT_SLOTS).fill(null),
    selectedArmorPieces: Array(6).fill(null),
    selectedFoods: Array(7).fill(null),
    optionalSlots: 0,
    optionalTalentGroups: [],
    expandedSlot: null,
    previewTalentId: null,
    currentBuildId: null
  };

  let talentCatalog = [];
  let armorCatalog = [];
  let foodCatalog = [];
  let savedBuilds = [];
  const armorSlotNames = ['Armadura', 'Luvas', 'Calça', 'Botas', 'Colar', 'Anel'];
  const armorSlotCategories = ['Armadura', 'Luvas', 'Calças', 'Botas', 'Colar', 'Anel'];
  const foodSlotCategories = [
    { label: 'Alimento Básico', category: 'Alimento Básico' },
    { label: 'Bebida', category: 'Bebida' },
    { label: 'Carne', category: 'Carne' },
    { label: 'Frutas e Vegetais', category: 'Frutas e Vegetais' },
    { label: 'Predileção', category: 'Predileção' },
    { label: 'Outros', category: 'Outros' },
    { label: 'Outros', category: 'Outros' }
  ];

  function normalizeText(value) {
    return (value || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function formatDate(dateIso) {
    try {
      return new Date(dateIso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '';
    }
  }

  function getSelectedTribeLabel() {
    const selectedOption = buildTribeInput.options[buildTribeInput.selectedIndex];
    if (!selectedOption || !selectedOption.value) return 'Nao selecionada';
    return selectedOption.textContent || 'Nao selecionada';
  }

  function renderClassWeapons() {
    const classWeaponsListEl = root.querySelector('#classWeaponsList');
    if (!classWeaponsListEl) return;

    const val = buildTribeInput ? buildTribeInput.value : '';
    const classData = CLASS_WEAPONS[val];
    const learnedWeapons = new Set(classData?.weapons.map((weapon) => weapon.name) || []);

    classWeaponsListEl.innerHTML = ALL_WEAPONS.map((weapon) => `
        <div class="class-weapon-item ${learnedWeapons.has(weapon.name) ? 'learned' : ''}" title="${weapon.name}">
          <img class="class-weapon-icon" src="${weapon.image}" alt="${weapon.name}" />
          <span class="class-weapon-level">${learnedWeapons.has(weapon.name) ? 120 : 100}</span>
        </div>
    `).join('');
  }

  function renderArmorSlots() {
    if (!armorSlotsEl) return;

    armorSlotsEl.innerHTML = state.selectedArmorPieces.map((itemId, index) => {
      const item = armorCatalog.find((armor) => String(armor.id) === String(itemId));
      return `
        <button type="button" class="armor-slot ${item ? 'selected' : 'empty'}" data-armor-slot="${index}" title="${item?.name_pt || armorSlotNames[index]}" aria-label="${armorSlotNames[index]}">
          ${item ? `<img src="${item.image || ''}" alt="${item.name_pt || item.name || 'Peça de armadura'}" />` : ''}
        </button>
      `;
    }).join('') + `
      <button type="button" class="complete-armor-set-button" id="completeArmorSetButton" title="Completar conjunto da armadura" aria-label="Completar conjunto da armadura" ${state.selectedArmorPieces.some(Boolean) ? '' : 'disabled'}>Completar</button>
    `;

    armorSlotsEl.querySelectorAll('.armor-slot').forEach((button) => {
      button.addEventListener('click', () => openArmorPicker(Number(button.dataset.armorSlot)));
    });
    armorSlotsEl.querySelector('#completeArmorSetButton')?.addEventListener('click', completeArmorSet);
  }

  function renderFoodSlots() {
    if (!foodCategorySlotsEl) return;
    foodCategorySlotsEl.innerHTML = foodSlotCategories.map((slot, index) => {
      const food = foodCatalog.find((item) => String(item.id) === String(state.selectedFoods[index]));
      return `
        <button type="button" class="armor-slot ${food ? 'selected' : 'empty'}" data-food-slot="${index}" title="${food?.name_pt || slot.label}" aria-label="${slot.label}">
          ${food ? `<img src="${food.image_path || ''}" alt="${food.name_pt || food.name_en || slot.label}" />` : ''}
        </button>
      `;
    }).join('');

    foodCategorySlotsEl.querySelectorAll('[data-food-slot]').forEach((button) => {
      button.addEventListener('click', () => openFoodPicker(Number(button.dataset.foodSlot)));
    });
  }

  function openFoodPicker(slotIndex) {
    if (!foodPickerInlineEl) return;
    const slotCategory = foodSlotCategories[slotIndex]?.category;
    const availableFoods = foodCatalog.filter((food) => food.subcategory === slotCategory);
    foodPickerInlineEl.innerHTML = [
      '<button type="button" class="armor-picker-option food-picker-option" data-food-id="" title="Remover alimento" aria-label="Remover alimento">&times;</button>',
      ...availableFoods.map((food) => `
        <button type="button" class="armor-picker-option food-picker-option" data-food-id="${food.id}" title="${food.name_pt || food.name_en || 'Alimento'}" aria-label="${food.name_pt || food.name_en || 'Alimento'}">
          <img src="${food.image_path || ''}" alt="" />
        </button>
      `)
    ].join('');
    foodPickerInlineEl.querySelectorAll('[data-food-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedFoods[slotIndex] = button.dataset.foodId || null;
        foodPickerInlineEl.hidden = true;
        renderFoodSlots();
      });
    });
    foodPickerInlineEl.hidden = false;
  }

  function completeArmorSet() {
    const referenceItemId = state.selectedArmorPieces[0] || state.selectedArmorPieces.find(Boolean);
    const referenceItem = armorCatalog.find((item) => String(item.id) === String(referenceItemId));
    if (!referenceItem?.efeito_conjunto) return;

    armorSlotCategories.forEach((category, slotIndex) => {
      const matchingPiece = armorCatalog.find((item) => (
        item.categoria === category && item.efeito_conjunto === referenceItem.efeito_conjunto
      ));
      state.selectedArmorPieces[slotIndex] = matchingPiece?.id || null;
    });

    renderArmorSlots();
    renderSetBonuses();
  }

  function openArmorPicker(slotIndex) {
    if (!armorPickerInlineEl) return;
    const slotCategory = armorSlotCategories[slotIndex];
    const availableArmor = armorCatalog.filter((item) => item.categoria === slotCategory);
    armorPickerInlineEl.innerHTML = [
      '<button type="button" class="armor-picker-option" data-armor-id="" title="Remover peça" aria-label="Remover peça">&times;</button>',
      ...availableArmor.map((item) => `
        <button type="button" class="armor-picker-option" data-armor-id="${item.id}" title="${item.name_pt || item.name || 'Peça de armadura'}" aria-label="${item.name_pt || item.name || 'Peça de armadura'}">
          <img src="${item.image || ''}" alt="" />
        </button>
      `)
    ].join('');

    armorPickerInlineEl.querySelectorAll('[data-armor-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedArmorPieces[slotIndex] = button.dataset.armorId || null;
        armorPickerInlineEl.hidden = true;
        renderArmorSlots();
        renderSetBonuses();
      });
    });
    armorPickerInlineEl.hidden = false;
  }

  function syncHeaderBuildInfo() {
    builderHeaderNameEl.textContent = buildNameInput.value.trim() || 'Build sem nome';
    const hasClass = Boolean(buildTribeInput?.value);
    if (builderHeaderClassEl) builderHeaderClassEl.textContent = getSelectedTribeLabel();
    if (builderHeaderMasterEl) builderHeaderMasterEl.style.display = hasClass ? 'inline' : 'none';
    const tribeTalent = selectedTalentData(state.selectedPositive[0]);
    const titleTalent = selectedTalentData(state.selectedPositive[1]);
    if (builderHeaderTribeEl) builderHeaderTribeEl.textContent = tribeTalent?.exclusive || 'Nao selecionada';
    if (builderHeaderTitleEl) builderHeaderTitleEl.textContent = titleTalent?.name || 'Nao selecionado';
    renderClassWeapons();
  }

  function selectedTalentData(itemId) {
    return talentCatalog.find((item) => item.id === itemId) || null;
  }

  function getTalentGroupForSlot(slotIndex) {
    if (slotIndex === 0) return 'tribe';
    if (slotIndex === 1) return 'title';
    if (slotIndex >= MAX_TALENT_SLOTS) return state.optionalTalentGroups[slotIndex - MAX_TALENT_SLOTS] || null;
    return 'positive';
  }

  function getSlotLabel(slotIndex) {
    if (slotIndex === 0) return 'Tribo';
    if (slotIndex === 1) return 'Titulo';
    if (slotIndex >= MAX_TALENT_SLOTS) return 'Opcional';
    return `Talento ${slotIndex - POSITIVE_TALENT_START_SLOT + 1}`;
  }

  function getVisibleTalentsForSlot(slotIndex) {
    const query = normalizeText(state.search);
    return talentCatalog.filter((item) => {
      if (item.group !== getTalentGroupForSlot(slotIndex)) return false;
      return !query || normalizeText(item.name).includes(query);
    });
  }

  function updateCounter() {
    const total = state.selectedPositive
      .map((itemId) => selectedTalentData(itemId))
      .filter((item) => item?.group === 'positive').length;
    if (counterEl) counterEl.textContent = String(total);
    if (positiveLimitEl) {
      positiveLimitEl.textContent = String(
        MAX_TALENT_SLOTS - POSITIVE_TALENT_START_SLOT
        + state.optionalTalentGroups.filter((group) => group === 'positive').length
      );
    }
  }

  function renderSelectorGrid() {
    const talentSlots = Array.from({ length: state.selectedPositive.length }, (_, index) => {
      const selectedItem = selectedTalentData(state.selectedPositive[index]);
      const isOpen = state.expandedSlot === index;
      const isOptional = index >= MAX_TALENT_SLOTS;
      const talentTypeClass = index < POSITIVE_TALENT_START_SLOT ? 'talent-type-gold'
        : index < MAX_TALENT_SLOTS ? 'talent-type-green' : '';
      const style = selectedItem ? `--icon-image: url('${selectedItem.imageUrl}')` : '--icon-image: none';

      return `
        <div class="selector-shell ${isOptional ? 'optional-slot' : ''}">
          <button
            type="button"
            class="selector-tile-icon ${talentTypeClass} ${selectedItem ? 'selected' : 'empty'} ${isOpen ? 'selected' : ''}"
            data-slot-index="${index}"
            style="${style}"
            aria-label="${selectedItem ? selectedItem.name : getSlotLabel(index)}">
          </button>
          ${isOptional ? `<button type="button" class="remove-optional-slot" data-slot-index="${index}" aria-label="Remover talento opcional">-</button>` : ''}
          <span class="selector-label">${selectedItem ? selectedItem.name : getSlotLabel(index)}</span>
        </div>
      `;
    }).join('');

    const addOptionalSlot = `
      <div class="selector-shell add-optional-shell">
        <button type="button" class="add-optional-slot" aria-label="Adicionar talento opcional">+</button>
        <span class="selector-label">Adicionar opcional</span>
      </div>
    `;
    selectorGridEl.innerHTML = talentSlots + addOptionalSlot;

    selectorGridEl.querySelectorAll('.selector-tile-icon').forEach((button) => {
      button.addEventListener('click', () => {
        const slotIndex = Number(button.dataset.slotIndex);
        state.expandedSlot = slotIndex;
        state.previewTalentId = state.selectedPositive[slotIndex];
        state.search = '';
        talentPickerSearchEl.value = '';
        renderTalentOptions();
        renderSelectorGrid();
        talentPickerModalEl.hidden = false;
        if (getTalentGroupForSlot(slotIndex)) talentPickerSearchEl.focus();
      });
    });

    selectorGridEl.querySelector('.add-optional-slot')?.addEventListener('click', () => {
      state.optionalSlots += 1;
      state.optionalTalentGroups.push(null);
      state.selectedPositive.push(null);
      renderAll();
    });

    selectorGridEl.querySelectorAll('.remove-optional-slot').forEach((button) => {
      button.addEventListener('click', () => {
        const slotIndex = Number(button.dataset.slotIndex);
        const optionalIndex = slotIndex - MAX_TALENT_SLOTS;
        state.selectedPositive.splice(slotIndex, 1);
        state.optionalTalentGroups.splice(optionalIndex, 1);
        state.optionalSlots -= 1;
        renderAll();
      });
    });
  }

  function closeTalentPicker() {
    talentPickerModalEl.hidden = true;
    state.expandedSlot = null;
    state.previewTalentId = null;
    state.search = '';
    talentPickerSearchEl.value = '';
    renderSelectorGrid();
  }

  function renderTalentPreview(itemId) {
    const item = selectedTalentData(itemId);
    if (!item) {
      talentPickerPreviewEl.innerHTML = '<h3>Descricao</h3><p>Passe o mouse sobre um talento para ver seus detalhes.</p>';
      return;
    }

    talentPickerPreviewEl.innerHTML = `
      <h3>${item.name}</h3>
      <p>${item.description || 'Sem descricao disponivel.'}</p>
    `;
  }

  function renderTalentOptions() {
    if (state.expandedSlot === null) {
      talentPickerListEl.innerHTML = '';
      renderTalentPreview(null);
      return;
    }

    const selectedGroup = getTalentGroupForSlot(state.expandedSlot);
    if (!selectedGroup) {
      talentPickerSearchEl.hidden = true;
      talentPickerListEl.innerHTML = ['tribe', 'title', 'positive'].map((group) => `
        <button type="button" class="selector-option talent-picker-option" data-talent-group="${group}">
          <span class="selector-option-name">${group === 'tribe' ? 'Tribo' : group === 'title' ? 'Titulo' : 'Positivo'}</span>
        </button>
      `).join('');
      talentPickerPreviewEl.innerHTML = '<h3>Tipo de talento</h3><p>Escolha o tipo para este slot opcional.</p>';
      talentPickerListEl.querySelectorAll('[data-talent-group]').forEach((button) => {
        button.addEventListener('click', () => {
          state.optionalTalentGroups[state.expandedSlot - MAX_TALENT_SLOTS] = button.dataset.talentGroup;
          renderTalentOptions();
          talentPickerSearchEl.focus();
        });
      });
      return;
    }

    talentPickerSearchEl.hidden = false;
    const items = getVisibleTalentsForSlot(state.expandedSlot);
    if (!items.length) {
      talentPickerListEl.innerHTML = '<div class="empty-state">Nenhum talento encontrado para esta busca.</div>';
      renderTalentPreview(null);
      return;
    }

    const currentId = state.selectedPositive[state.expandedSlot];
    if (!items.some((item) => item.id === state.previewTalentId)) {
      state.previewTalentId = currentId || items[0].id;
    }

    talentPickerListEl.innerHTML = items.map((item) => {
      const selected = item.id === currentId;
      return `
        <button
          type="button"
          class="selector-option talent-picker-option ${selected ? 'selected' : ''}"
          data-item-id="${item.id}">
          <span class="selector-option-icon" style="--icon-image: url('${item.imageUrl}')"></span>
          <span class="selector-option-name">${item.name}</span>
        </button>
      `;
    }).join('');

    renderTalentPreview(state.previewTalentId);

    talentPickerListEl.querySelectorAll('.selector-option').forEach((button) => {
      const previewTalent = () => {
        state.previewTalentId = button.dataset.itemId;
        renderTalentPreview(state.previewTalentId);
      };

      button.addEventListener('mouseenter', previewTalent);
      button.addEventListener('focus', previewTalent);
      button.addEventListener('click', () => {
        const selectedId = button.dataset.itemId;
        const slot = state.expandedSlot;
        if (slot === null) return;
        state.selectedPositive[slot] = state.selectedPositive[slot] === selectedId ? null : selectedId;
        closeTalentPicker();
        renderAll();
      });
    });
  }

  function buildPayload() {
    return {
      id: state.currentBuildId,
      name: buildNameInput.value.trim() || 'Build sem nome',
      description: buildDescriptionInput.value.trim(),
      tribe: buildTribeInput.value,
      selectedPositive: [...state.selectedPositive],
      optionalTalentGroups: [...state.optionalTalentGroups],
      selectedArmorPieces: [...state.selectedArmorPieces],
      selectedFoods: [...state.selectedFoods],
      talentExportLevel: talentExportLevelEl?.value || 'max',
      updatedAt: new Date().toISOString()
    };
  }

  function getTalentGameId(talent, level) {
    if (!talent?.gameIds) return null;
    if (level === 'max') return [...talent.gameIds].reverse().find(Boolean) || null;
    const index = Number(level) - 1;
    return talent.gameIds[index] || [...talent.gameIds].reverse().find(Boolean) || null;
  }

  function getExportTalentIds() {
    const level = talentExportLevelEl?.value || 'max';
    return state.selectedPositive
      .map((itemId) => getTalentGameId(selectedTalentData(itemId), level))
      .filter(Boolean);
  }

  function getGmCommands() {
    const addCommands = getExportTalentIds().map((id) => `gm AddNG ${id} 1 0`);
    // Remove todos os talentos já colocados antes de adicionar os da build
    return addCommands.length ? ['gm ClearNG', ...addCommands] : [];
  }

  // Gera a macro no formato do GDMbot: abre o console com "-" duas vezes
  // (fica aberto) e digita um comando GM por talento.
  function buildTalentExportCode() {
    const gmCommands = getGmCommands();
    if (!gmCommands.length) return '';
    const buildName = buildNameInput.value.trim() || 'Build sem nome';
    const commands = [
      { type: 'comment', value: `Builder Maker: ${buildName} (${gmCommands.length - 1} talentos)`, delay: 0, options: {} },
      { type: 'key', value: '-', delay: 0.3, options: { key_action: 'normal' } },
      { type: 'key', value: '-', delay: 0.5, options: { key_action: 'normal' } }
    ];
    gmCommands.forEach((line) => {
      commands.push({ type: 'type_text', value: line, delay: 0.2, options: { interval: 0.02 } });
      commands.push({ type: 'key', value: 'enter', delay: 0.5, options: { key_action: 'normal' } });
    });
    return JSON.stringify(commands);
  }

  function renderTalentExport() {
    if (!talentExportCodeEl) return;
    talentExportCodeEl.value = buildTalentExportCode();
    if (talentExportPreviewEl) {
      const lines = getGmCommands();
      talentExportPreviewEl.textContent = lines.length ? lines.join('\n') : 'Nenhum talento selecionado.';
    }
  }

  function downloadTalentExport() {
    const code = buildTalentExportCode();
    if (!code) {
      flashStatus(talentExportStatusEl, 'Nenhum talento selecionado.');
      return;
    }
    const name = (buildNameInput.value.trim() || 'build').replace(/[^a-z0-9-_]+/gi, '_');
    const blob = new Blob([JSON.stringify(JSON.parse(code), null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macro_talentos_${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function flashStatus(element, message) {
    if (!element) return;
    element.textContent = message;
    clearTimeout(element._statusTimer);
    element._statusTimer = setTimeout(() => { element.textContent = ''; }, 2500);
  }

  async function copyTalentExportCode() {
    const code = buildTalentExportCode();
    if (!code) {
      flashStatus(talentExportStatusEl, 'Nenhum talento selecionado.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      talentExportCodeEl.select();
      document.execCommand('copy');
    }
    flashStatus(talentExportStatusEl, 'Código copiado!');
  }

  function applyBuild(build) {
    state.currentBuildId = build.id || null;
    const importedTalents = Array.isArray(build.selectedPositive) ? build.selectedPositive : [];
    const importedGroups = Array.isArray(build.optionalTalentGroups) ? build.optionalTalentGroups : [];
    state.selectedArmorPieces = Array.isArray(build.selectedArmorPieces)
      ? Array.from({ length: 6 }, (_, index) => build.selectedArmorPieces[index] || null)
      : Array(6).fill(null);
    state.selectedFoods = Array.from({ length: 7 }, (_, index) => (
      Array.isArray(build.selectedFoods) ? build.selectedFoods[index] || null : null
    ));
    if (talentExportLevelEl) talentExportLevelEl.value = build.talentExportLevel || 'max';
    state.optionalSlots = Math.max(importedTalents.length - MAX_TALENT_SLOTS, importedGroups.length, 0);
    state.optionalTalentGroups = Array.from({ length: state.optionalSlots }, (_, index) => {
      const group = importedGroups[index];
      return ['tribe', 'title', 'positive'].includes(group) ? group : null;
    });
    state.selectedPositive = Array.from(
      { length: MAX_TALENT_SLOTS + state.optionalSlots },
      (_, index) => importedTalents[index] || null
    );
    state.expandedSlot = null;
    state.previewTalentId = null;
    talentPickerModalEl.hidden = true;

    buildNameInput.value = build.name || '';
    buildDescriptionInput.value = build.description || '';
    buildTribeInput.value = build.tribe || '';
    renderAll();
    renderFoodSlots();
  }

  function persistSavedBuilds() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBuilds));
  }

  function loadSavedBuilds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      savedBuilds = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      savedBuilds = [];
    }
  }

  function saveCurrentBuild() {
    const payload = buildPayload();
    if (!payload.id) payload.id = `build-${Date.now()}`;

    const index = savedBuilds.findIndex((item) => item.id === payload.id);
    if (index >= 0) {
      savedBuilds[index] = payload;
    } else {
      savedBuilds.unshift(payload);
    }

    state.currentBuildId = payload.id;
    persistSavedBuilds();
    renderSavedBuilds();
    flashStatus(buildSaveStatusEl, `Build "${payload.name}" salva!`);
  }

  function loadActiveBuild() {
    if (state.currentBuildId) {
      const found = savedBuilds.find((item) => item.id === state.currentBuildId);
      if (found) {
        applyBuild(found);
        return;
      }
    }

    if (savedBuilds[0]) {
      applyBuild(savedBuilds[0]);
    }
  }

  function exportCurrentBuild() {
    const payload = buildPayload();
    const fileName = `${(payload.name || 'build').replace(/[^a-z0-9-_]+/gi, '_')}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clearCurrentBuild() {
    state.currentBuildId = null;
    state.selectedPositive = Array(MAX_TALENT_SLOTS).fill(null);
    state.selectedArmorPieces = Array(6).fill(null);
    state.selectedFoods = Array(7).fill(null);
    state.optionalSlots = 0;
    state.optionalTalentGroups = [];
    state.expandedSlot = null;
    state.previewTalentId = null;
    if (talentExportLevelEl) talentExportLevelEl.value = 'max';
    renderFoodSlots();
    buildNameInput.value = '';
    buildDescriptionInput.value = '';
    buildTribeInput.value = '';
    talentPickerSearchEl.value = '';
    state.search = '';
    talentPickerModalEl.hidden = true;
    renderAll();
  }

  function renderSavedBuilds() {
    if (!savedBuilds.length) {
      savedBuildsListEl.innerHTML = '<div class="saved-build-empty">Nenhuma build salva.</div>';
      return;
    }

    savedBuildsListEl.innerHTML = savedBuilds.map((build) => {
      const active = build.id === state.currentBuildId;
      return `
        <article class="saved-build-card ${active ? 'active' : ''}" data-build-id="${build.id}">
          <button type="button" class="saved-build-main" data-action="load" data-build-id="${build.id}">
            <h3 class="saved-build-name">${build.name || 'Build sem nome'}</h3>
            <p class="saved-build-date">${formatDate(build.updatedAt)}</p>
          </button>
          <div class="saved-build-actions">
            <button type="button" class="saved-build-btn" data-action="edit" data-build-id="${build.id}" aria-label="Editar build">✎</button>
            <button type="button" class="saved-build-btn delete" data-action="delete" data-build-id="${build.id}" aria-label="Excluir build">🗑</button>
          </div>
        </article>
      `;
    }).join('');

    savedBuildsListEl.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        const buildId = button.dataset.buildId;
        const targetBuild = savedBuilds.find((item) => item.id === buildId);
        if (!targetBuild) return;

        if (action === 'load' || action === 'edit') {
          applyBuild(targetBuild);
          return;
        }

        if (action === 'delete') {
          savedBuilds = savedBuilds.filter((item) => item.id !== buildId);
          if (state.currentBuildId === buildId) state.currentBuildId = null;
          persistSavedBuilds();
          renderSavedBuilds();
        }
      });
    });
  }

  function renderSetBonuses() {
    if (!setBonusPanelEl) return;

    const equippedItems = state.selectedArmorPieces
      .map((itemId) => armorCatalog.find((armor) => String(armor.id) === String(itemId)))
      .filter(Boolean);

    if (!equippedItems.length) {
      setBonusPanelEl.innerHTML = '<p class="set-bonus-empty">Equipe peças para ver os bônus.</p>';
      return;
    }

    const sets = new Map();
    equippedItems.forEach((item) => {
      const setKey = item.efeito_conjunto || `item-${item.id}`;
      const setItems = sets.get(setKey) || [];
      setItems.push(item);
      sets.set(setKey, setItems);
    });

    setBonusPanelEl.innerHTML = Array.from(sets.values())
      .sort((firstSet, secondSet) => secondSet.length - firstSet.length)
      .map((setItems) => {
        const representative = setItems[0];
        const count = setItems.length;
        const bonuses = [
          [2, representative.atributo_conjunto_2pc],
          [4, representative.atributo_conjunto_4pc],
          [6, representative.atributo_conjunto_6pc]
        ].filter(([pieces, value]) => value && count >= pieces);

        const bonusMarkup = bonuses.flatMap(([pieces, value]) => value
          .split(/,\s+(?=[A-Za-zÀ-ÿ])/)
          .map((attribute) => attribute.trim())
          .filter(Boolean)
          .map((attribute) => `
            <p class="set-bonus-tier"><strong>${pieces} peças:</strong> ${attribute}</p>
          `)
        ).join('');
        const descriptionMarkup = count === 6 && representative.efeito_conjunto
          ? `<p class="set-bonus-description">${representative.efeito_conjunto}</p>`
          : '';

        return `
          <article class="set-bonus-card">
            <h3 class="set-bonus-title">${representative.name_pt || representative.name || 'Conjunto'} (${count}/6)</h3>
            ${bonusMarkup || '<p class="set-bonus-locked">Complete 2 peças para liberar o primeiro bônus.</p>'}
            ${descriptionMarkup}
          </article>
        `;
      }).join('');
  }

  function renderAll() {
    syncHeaderBuildInfo();
    updateCounter();
    renderArmorSlots();
    renderSetBonuses();
    renderSelectorGrid();
    renderTalentOptions();
    renderSavedBuilds();
    renderTalentExport();
  }

  async function loadTalentData() {
    try {
      const response = await fetch('assets/data/talentos.json');
      if (!response.ok) throw new Error('Falha ao carregar talentos.');
      const data = await response.json();

      const groupByType = {
        Tribo: 'tribe',
        'Título': 'title',
        Positivo: 'positive'
      };

      talentCatalog = data
        .filter((item) => groupByType[item['Type PT']])
        .map((item, index) => {
          const imageUrl = item['nome imagem'] ? `assets/img/talentos/${item['nome imagem']}` : item['Icon'];
          return {
            id: `talent-${index}`,
            name: item['Title PT'] || item['Title EN'] || 'Talento',
            description: item['Description PT'] || item['Description EN'] || '',
            group: groupByType[item['Type PT']],
            exclusive: item['Exclusive PT'] || item['Exclusive EN'] || '',
            imageUrl: imageUrl,
            gameIds: [item.IDs1, item.IDs2, item.IDs3].map((value) => (value ? String(Math.trunc(value)) : null))
          };
        });

      state.selectedPositive = state.selectedPositive.map((itemId, index) => {
        const item = selectedTalentData(itemId);
        return item?.group === getTalentGroupForSlot(index) ? itemId : null;
      });
    } catch (error) {
      console.error('Erro ao carregar talentos:', error);
      talentCatalog = [
        { id: 'tribe-1', name: 'Talento de Tribo', description: '', group: 'tribe', imageUrl: '' },
        { id: 'title-1', name: 'Talento de Titulo', description: '', group: 'title', imageUrl: '' },
        { id: 'positive-1', name: 'Vigor', description: '', group: 'positive', imageUrl: '' },
        { id: 'positive-2', name: 'Constituicao', description: '', group: 'positive', imageUrl: '' },
        { id: 'positive-3', name: 'Furia', description: '', group: 'positive', imageUrl: '' }
      ];
    }

    renderAll();
  }

  async function loadArmorData() {
    try {
      const response = await fetch('assets/data/Armaduras.json');
      if (!response.ok) throw new Error('Falha ao carregar armaduras.');
      const data = await response.json();
      armorCatalog = (Array.isArray(data) ? data : [])
        .filter((item) => armorSlotCategories.includes(item.categoria))
        .filter((item) => item.atributo_conjunto_2pc || item.atributo_conjunto_4pc || item.atributo_conjunto_6pc)
        .filter((item) => !/traje feito pelos antigos com materiais de feras selvagens/i.test(item.efeito_conjunto || ''))
        .filter((item) => item.image);
    } catch (error) {
      console.error('Erro ao carregar peças de armadura:', error);
      armorCatalog = [];
    }
    renderArmorSlots();
    renderSetBonuses();
  }

  async function loadFoodData() {
    try {
      const response = await fetch('assets/data/alimentos.json');
      if (!response.ok) throw new Error('Falha ao carregar alimentos.');
      const data = await response.json();
      foodCatalog = Array.isArray(data) ? data.filter((item) => item.image_path) : [];
    } catch (error) {
      console.error('Erro ao carregar alimentos do Builder Maker:', error);
      foodCatalog = [];
    }
    renderFoodSlots();
  }

  function bindActions() {
    talentPickerSearchEl.addEventListener('input', (event) => {
      state.search = event.target.value;
      renderTalentOptions();
    });

    root.querySelector('#talentPickerClose')?.addEventListener('click', closeTalentPicker);
    talentPickerModalEl.addEventListener('click', (event) => {
      if (event.target === talentPickerModalEl) closeTalentPicker();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !talentPickerModalEl.hidden) closeTalentPicker();
    });

    buildNameInput.addEventListener('input', syncHeaderBuildInfo);
    buildTribeInput.addEventListener('change', syncHeaderBuildInfo);
    root.querySelector('#actionSaveBuild')?.addEventListener('click', saveCurrentBuild);
    root.querySelector('#actionLoadBuild')?.addEventListener('click', loadActiveBuild);
    root.querySelector('#actionExportBuild')?.addEventListener('click', exportCurrentBuild);
    root.querySelector('#actionImportBuild')?.addEventListener('click', () => importInput.click());
    root.querySelector('#actionClearBuild')?.addEventListener('click', clearCurrentBuild);
    root.querySelector('#actionCopyTalentCode')?.addEventListener('click', copyTalentExportCode);
    talentExportLevelEl?.addEventListener('change', renderTalentExport);
    buildNameInput.addEventListener('input', renderTalentExport);
    root.querySelector('#actionDownloadTalentCode')?.addEventListener('click', downloadTalentExport);

    root.querySelector('#topImportBuild')?.addEventListener('click', () => importInput.click());
    root.querySelector('#topExportBuild')?.addEventListener('click', exportCurrentBuild);
    root.querySelector('#topClearBuild')?.addEventListener('click', clearCurrentBuild);

    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const normalized = {
          id: imported.id || `build-${Date.now()}`,
          name: imported.name || 'Build importada',
          description: imported.description || '',
          tribe: imported.tribe || '',
          selectedPositive: Array.isArray(imported.selectedPositive)
            ? imported.selectedPositive
            : Array(MAX_TALENT_SLOTS).fill(null),
          optionalTalentGroups: Array.isArray(imported.optionalTalentGroups)
            ? imported.optionalTalentGroups
            : [],
          selectedArmorPieces: Array.isArray(imported.selectedArmorPieces) ? imported.selectedArmorPieces : [],
          selectedFoods: Array.isArray(imported.selectedFoods) ? imported.selectedFoods : [],
          talentExportLevel: imported.talentExportLevel || 'max',
          updatedAt: new Date().toISOString()
        };

        const foundIndex = savedBuilds.findIndex((item) => item.id === normalized.id);
        if (foundIndex >= 0) {
          savedBuilds[foundIndex] = normalized;
        } else {
          savedBuilds.unshift(normalized);
        }

        persistSavedBuilds();
        applyBuild(normalized);
      } catch (error) {
        console.error('Erro ao importar build:', error);
      } finally {
        importInput.value = '';
      }
    });
  }

  loadSavedBuilds();
  bindActions();
  renderAll();
  loadTalentData();
  loadArmorData();
  loadFoodData();
};

window.addEventListener('hashchange', () => {
  const page = currentPageName();
  if (page === 'builder-maker') initBuilderMakerPage();
  if (page === 'talentos') initTalentsPage();
  if (page === 'itens') initItensPage();
  if (page === 'alimentos') initAlimentosPage();
  if (page === 'armaduras') initArmadurasPage();
  if (page === 'tier-list') initTierListPage();
  if (page === 'gdmbot') initGdmbotPage();
});

// Página de venda do GDMbot (login Google, compra, licença): assets/js/gdmbot-store.js
window.initGdmbotPage = initGdmbotStore;


window.initTierListPage = function initTierListPage() {
  const root = document.querySelector('.tier-list-page');
  if (!root || root.dataset.tierListReady === 'true') return;
  root.dataset.tierListReady = 'true';

  const board = root.querySelector('#tier-list-board');
  const armorPool = root.querySelector('#tier-list-armor-pool');
  const weaponPool = root.querySelector('#tier-list-weapon-pool');
  const maskPool = root.querySelector('#tier-list-mask-pool');
  const categoryButtons = [...root.querySelectorAll('.tier-category')];
  const ranks = [
    { name: 'A', color: '#e5c85c' },
    { name: 'B', color: '#7ebf79' },
    { name: 'C', color: '#78a9d1' },
    { name: 'D', color: '#b28acb' },
    { name: 'E', color: '#d98972' }
  ];
  const storageKey = 'soulmask-tier-lists';
  const armorStorageKey = 'soulmask-tier-armor-placements';
  const weaponStorageKey = 'soulmask-tier-weapon-placements';
  const maskStorageKey = 'soulmask-tier-mask-placements';
  const maskDefinitions = [
    { name: 'Celestial Wings', label: 'Asas Celestiais', image: 'assets/img/itens/t7_img_0006_05_01.webp' },
    { name: 'Abyss Overlord', label: 'Soberano do Abismo', image: 'assets/img/itens/t7_img_0001_05_01.webp' },
    { name: 'Golden Legend', label: 'Lenda Dourada', image: 'assets/img/itens/t7_img_0030_05_01.webp' },
    { name: 'Doomsday Judgment', label: 'Julgamento Final', image: 'assets/img/itens/t7_img_0013_05_01.webp' },
    { name: 'Civilization', label: 'Civilização', image: 'assets/img/itens/t7_img_0008_05_01.webp' },
    { name: 'Torch of Eternity', label: 'Tocha da Eternidade', image: 'assets/img/itens/t7_img_0109_05_01.webp' },
    { name: 'Wilderness Mark', label: 'Marca da Selva', image: 'assets/img/itens/t7_img_0112_05_01.webp' },
    { name: 'Glorious Hymn', label: 'Hino Glorioso', image: 'assets/img/itens/t7_img_0029_05_01.webp' },
    { name: 'Tactical Guidance', label: 'Instruções Táticas', image: 'assets/img/itens/t7_img_0107_05_01.webp' },
    { name: 'Explorer', label: 'Explorador', image: 'assets/img/itens/t7_img_0024_05_01.webp' },
    { name: 'Shadow Walker', label: 'Caminhante das Sombras', image: 'assets/img/itens/t7_img_0088_05_01.webp' },
    { name: 'Nature Enlightenment', label: 'Iluminação Natural', image: 'assets/img/itens/t7_img_0059_05_01.webp' },
    { name: 'Ironblood Guard', label: 'Guarda de Sangue Feroz', image: 'assets/img/itens/t7_img_0039_05_01.webp' },
    { name: 'Rich', label: 'Fértil', image: 'assets/img/itens/t7_img_0084_05_01.webp' },
    { name: 'Conquest', label: 'Conquista', image: 'assets/img/itens/t7_img_0009_05_01.webp' },
    { name: 'Enforcer', label: 'Executor', image: 'assets/img/itens/t7_img_0022_05_01.webp' },
    { name: 'Ruler of the Barren Sands', label: 'Soberano das Areias Áridas', image: 'assets/img/itens/t7_img_0085_05_01.webp' },
    { name: 'Shadow Hunter', label: 'Caçador das Sombras', image: 'assets/img/itens/t7_img_0087_05_01.webp' }
  ];
  const maskDisplayNames = new Map(maskDefinitions.map(({ name, label }) => [name, label]));
  let selectedCategory = 'armadura';
  let tierLists = {};
  let armorCatalog = [];
  let armorAssignments = {};
  let selectedArmorId = null;
  let weaponAssignments = {};
  let selectedWeaponId = null;
  let maskCatalog = [];
  let maskAssignments = {};
  let selectedMaskId = null;

  try {
    const savedLists = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (savedLists && typeof savedLists === 'object' && !Array.isArray(savedLists)) {
      tierLists = savedLists;
    }
  } catch (error) {
    console.warn('Não foi possível carregar as tier lists salvas.', error);
  }

  try {
    const savedAssignments = JSON.parse(localStorage.getItem(armorStorageKey) || '{}');
    if (savedAssignments && typeof savedAssignments === 'object' && !Array.isArray(savedAssignments)) {
      armorAssignments = savedAssignments;
    }
  } catch (error) {
    console.warn('Não foi possível carregar a tier list de armaduras.', error);
  }

  try {
    const savedAssignments = JSON.parse(localStorage.getItem(weaponStorageKey) || '{}');
    if (savedAssignments && typeof savedAssignments === 'object' && !Array.isArray(savedAssignments)) {
      weaponAssignments = savedAssignments;
    }
  } catch (error) {
    console.warn('Não foi possível carregar a tier list de armas.', error);
  }

  try {
    const savedAssignments = JSON.parse(localStorage.getItem(maskStorageKey) || '{}');
    if (savedAssignments && typeof savedAssignments === 'object' && !Array.isArray(savedAssignments)) {
      maskAssignments = savedAssignments;
    }
  } catch (error) {
    console.warn('Não foi possível carregar a tier list de máscaras.', error);
  }

  function getEntries(category, rank) {
    const entries = tierLists[category]?.[rank];
    return Array.isArray(entries) ? entries : [];
  }

  function saveLists() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(tierLists));
    } catch (error) {
      console.warn('Não foi possível salvar a tier list.', error);
    }
  }

  function saveArmorAssignments() {
    try {
      localStorage.setItem(armorStorageKey, JSON.stringify(armorAssignments));
    } catch (error) {
      console.warn('Não foi possível salvar a tier list de armaduras.', error);
    }
  }

  function saveWeaponAssignments() {
    try {
      localStorage.setItem(weaponStorageKey, JSON.stringify(weaponAssignments));
    } catch (error) {
      console.warn('Não foi possível salvar a tier list de armas.', error);
    }
  }

  function getArmorName(item) {
    return item.name_pt || item.name || 'Armadura sem nome';
  }

  function getArmorImage(item) {
    return /rel[ií]quia divina/i.test(getArmorName(item))
      ? 'assets/img/armaduras/Ruina Divina.webp'
      : item.image || '';
  }

  function getMaskName(item) {
    return maskDisplayNames.get(item.name) || item.name_pt || item.name || 'Máscara sem nome';
  }

  function saveMaskAssignments() {
    try {
      localStorage.setItem(maskStorageKey, JSON.stringify(maskAssignments));
    } catch (error) {
      console.warn('Não foi possível salvar a tier list de máscaras.', error);
    }
  }

  function createArmorImage(item, isPlaced = false) {
    const armorId = String(item.id);
    const button = document.createElement('button');
    button.className = 'tier-armor-item';
    button.type = 'button';
    button.draggable = true;
    button.dataset.armorId = armorId;
    button.title = getArmorName(item);
    button.setAttribute('aria-label', getArmorName(item));
    button.setAttribute('aria-pressed', String(!isPlaced && selectedArmorId === armorId));
    if (!isPlaced && selectedArmorId === armorId) button.classList.add('is-selected');

    const image = document.createElement('img');
    image.src = getArmorImage(item);
    image.alt = getArmorName(item);
    image.loading = 'lazy';
    button.append(image);
    return button;
  }

  function createMaskImage(item, isPlaced = false) {
    const maskId = String(item.id);
    const name = getMaskName(item);
    const button = document.createElement('button');
    button.className = 'tier-mask-item';
    button.type = 'button';
    button.draggable = true;
    button.dataset.maskId = maskId;
    button.title = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', String(!isPlaced && selectedMaskId === maskId));
    if (!isPlaced && selectedMaskId === maskId) button.classList.add('is-selected');

    const image = document.createElement('img');
    image.src = item.image || '';
    image.alt = name;
    image.loading = 'lazy';
    button.append(image);
    return button;
  }

  function createWeaponImage(weapon, isPlaced = false) {
    const button = document.createElement('button');
    button.className = 'tier-weapon-item';
    button.type = 'button';
    button.draggable = true;
    button.dataset.weaponId = weapon.name;
    button.title = weapon.name;
    button.setAttribute('aria-label', weapon.name);
    button.setAttribute('aria-pressed', String(!isPlaced && selectedWeaponId === weapon.name));
    if (!isPlaced && selectedWeaponId === weapon.name) button.classList.add('is-selected');

    const image = document.createElement('img');
    image.src = weapon.image;
    image.alt = weapon.name;
    image.loading = 'lazy';
    button.append(image);
    return button;
  }

  function renderArmorPool() {
    armorPool.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Armaduras disponíveis';
    const grid = document.createElement('div');
    grid.className = 'tier-armor-grid';
    armorCatalog
      .filter((item) => !armorAssignments[String(item.id)])
      .forEach((item) => grid.append(createArmorImage(item)));
    armorPool.append(heading, grid);
  }

  function renderArmorRows() {
    board.replaceChildren();
    ranks.forEach(({ name, color }) => {
      const row = document.createElement('section');
      row.className = 'tier-row';
      row.dataset.rank = name;
      row.style.setProperty('--tier-color', color);

      const rankLabel = document.createElement('div');
      rankLabel.className = 'tier-rank';
      rankLabel.textContent = name;
      rankLabel.setAttribute('aria-label', `Nível ${name}`);

      const content = document.createElement('div');
      content.className = 'tier-content';
      armorCatalog
        .filter((item) => armorAssignments[String(item.id)] === name)
        .forEach((item) => content.append(createArmorImage(item, true)));

      row.append(rankLabel, content);
      board.append(row);
    });
  }

  function renderMaskPool() {
    maskPool.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Máscaras disponíveis';
    const grid = document.createElement('div');
    grid.className = 'tier-mask-grid';
    maskCatalog
      .filter((item) => !maskAssignments[String(item.id)])
      .forEach((item) => grid.append(createMaskImage(item)));
    maskPool.append(heading, grid);
  }

  function renderWeaponPool() {
    weaponPool.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Armas disponíveis';
    const grid = document.createElement('div');
    grid.className = 'tier-weapon-grid';
    ALL_WEAPONS
      .filter((weapon) => !weaponAssignments[weapon.name])
      .forEach((weapon) => grid.append(createWeaponImage(weapon)));
    weaponPool.append(heading, grid);
  }

  function renderMaskRows() {
    board.replaceChildren();
    ranks.forEach(({ name, color }) => {
      const row = document.createElement('section');
      row.className = 'tier-row';
      row.dataset.rank = name;
      row.style.setProperty('--tier-color', color);

      const rankLabel = document.createElement('div');
      rankLabel.className = 'tier-rank';
      rankLabel.textContent = name;
      rankLabel.setAttribute('aria-label', `Nível ${name}`);

      const content = document.createElement('div');
      content.className = 'tier-content';
      maskCatalog
        .filter((item) => maskAssignments[String(item.id)] === name)
        .forEach((item) => content.append(createMaskImage(item, true)));

      row.append(rankLabel, content);
      board.append(row);
    });
  }

  function renderWeaponRows() {
    board.replaceChildren();
    ranks.forEach(({ name, color }) => {
      const row = document.createElement('section');
      row.className = 'tier-row';
      row.dataset.rank = name;
      row.style.setProperty('--tier-color', color);

      const rankLabel = document.createElement('div');
      rankLabel.className = 'tier-rank';
      rankLabel.textContent = name;
      rankLabel.setAttribute('aria-label', `Nível ${name}`);

      const content = document.createElement('div');
      content.className = 'tier-content';
      ALL_WEAPONS
        .filter((weapon) => weaponAssignments[weapon.name] === name)
        .forEach((weapon) => content.append(createWeaponImage(weapon, true)));

      row.append(rankLabel, content);
      board.append(row);
    });
  }

  function renderMaskTierList() {
    renderMaskPool();
    renderMaskRows();
  }

  function renderWeaponTierList() {
    renderWeaponPool();
    renderWeaponRows();
  }

  function renderArmorTierList() {
    renderArmorPool();
    renderArmorRows();
  }

  function renderBoard() {
    board.replaceChildren();
    armorPool.hidden = selectedCategory !== 'armadura';
    weaponPool.hidden = selectedCategory !== 'arma';
    maskPool.hidden = selectedCategory !== 'mascaras';
    if (selectedCategory === 'armadura') {
      renderArmorTierList();
      return;
    }
    if (selectedCategory === 'mascaras') {
      renderMaskTierList();
      return;
    }
    if (selectedCategory === 'arma') {
      renderWeaponTierList();
      return;
    }

    ranks.forEach(({ name, color }) => {
      const row = document.createElement('section');
      row.className = 'tier-row';
      row.style.setProperty('--tier-color', color);

      const rankLabel = document.createElement('div');
      rankLabel.className = 'tier-rank';
      rankLabel.textContent = name;
      rankLabel.setAttribute('aria-label', `Nível ${name}`);

      const content = document.createElement('div');
      content.className = 'tier-content';

      const form = document.createElement('form');
      form.className = 'tier-entry-form';
      form.dataset.rank = name;

      const input = document.createElement('input');
      input.className = 'tier-entry-input';
      input.name = 'entry';
      input.type = 'text';
      input.maxLength = 80;
      input.placeholder = `Adicionar em ${name}`;
      input.setAttribute('aria-label', `Adicionar item ao nível ${name}`);

      const submit = document.createElement('button');
      submit.className = 'tier-entry-submit';
      submit.type = 'submit';
      submit.textContent = '+';
      submit.setAttribute('aria-label', `Adicionar ao nível ${name}`);
      form.append(input, submit);
      content.append(form);

      getEntries(selectedCategory, name).forEach((entry, index) => {
        const chip = document.createElement('div');
        chip.className = 'tier-entry';
        const label = document.createElement('span');
        label.className = 'tier-entry-name';
        label.textContent = entry;
        const remove = document.createElement('button');
        remove.className = 'tier-entry-remove';
        remove.type = 'button';
        remove.textContent = '×';
        remove.dataset.rank = name;
        remove.dataset.index = String(index);
        remove.setAttribute('aria-label', `Remover ${entry}`);
        chip.append(label, remove);
        content.append(chip);
      });

      row.append(rankLabel, content);
      board.append(row);
    });
  }

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.category;
      selectedArmorId = null;
      selectedWeaponId = null;
      selectedMaskId = null;
      categoryButtons.forEach((categoryButton) => {
        const isActive = categoryButton === button;
        categoryButton.classList.toggle('is-active', isActive);
        categoryButton.setAttribute('aria-pressed', String(isActive));
      });
      renderBoard();
    });
  });

  board.addEventListener('submit', (event) => {
    const form = event.target.closest('.tier-entry-form');
    if (!form) return;
    event.preventDefault();
    const input = form.elements.entry;
    const entry = input.value.trim();
    if (!entry) return;
    tierLists[selectedCategory] ||= {};
    tierLists[selectedCategory][form.dataset.rank] ||= [];
    tierLists[selectedCategory][form.dataset.rank].push(entry);
    saveLists();
    const rank = form.dataset.rank;
    renderBoard();
    board.querySelector(`[data-rank="${rank}"] .tier-entry-input`)?.focus();
  });

  board.addEventListener('click', (event) => {
    const remove = event.target.closest('.tier-entry-remove');
    if (!remove) return;
    const entries = getEntries(selectedCategory, remove.dataset.rank);
    entries.splice(Number(remove.dataset.index), 1);
    saveLists();
    renderBoard();
  });

  root.addEventListener('click', (event) => {
    if (selectedCategory === 'armadura') {
      const armorButton = event.target.closest('.tier-armor-item');
      if (armorButton) {
        const armorId = armorButton.dataset.armorId;
        if (armorAssignments[armorId]) {
          delete armorAssignments[armorId];
          selectedArmorId = null;
          saveArmorAssignments();
        } else {
          selectedArmorId = selectedArmorId === armorId ? null : armorId;
        }
        renderArmorTierList();
        return;
      }
      const armorRow = event.target.closest('.tier-row');
      if (armorRow && selectedArmorId) {
        armorAssignments[selectedArmorId] = armorRow.dataset.rank;
        selectedArmorId = null;
        saveArmorAssignments();
        renderArmorTierList();
      }
      return;
    }

    if (selectedCategory === 'mascaras') {
      const maskButton = event.target.closest('.tier-mask-item');
      if (maskButton) {
        const maskId = maskButton.dataset.maskId;
        if (maskAssignments[maskId]) {
          delete maskAssignments[maskId];
          selectedMaskId = null;
          saveMaskAssignments();
        } else {
          selectedMaskId = selectedMaskId === maskId ? null : maskId;
        }
        renderMaskTierList();
        return;
      }
      const maskRow = event.target.closest('.tier-row');
      if (maskRow && selectedMaskId) {
        maskAssignments[selectedMaskId] = maskRow.dataset.rank;
        selectedMaskId = null;
        saveMaskAssignments();
        renderMaskTierList();
      }
    }

    if (selectedCategory === 'arma') {
      const weaponButton = event.target.closest('.tier-weapon-item');
      if (weaponButton) {
        const weaponId = weaponButton.dataset.weaponId;
        if (weaponAssignments[weaponId]) {
          delete weaponAssignments[weaponId];
          selectedWeaponId = null;
          saveWeaponAssignments();
        } else {
          selectedWeaponId = selectedWeaponId === weaponId ? null : weaponId;
        }
        renderWeaponTierList();
        return;
      }
      const weaponRow = event.target.closest('.tier-row');
      if (weaponRow && selectedWeaponId) {
        weaponAssignments[selectedWeaponId] = weaponRow.dataset.rank;
        selectedWeaponId = null;
        saveWeaponAssignments();
        renderWeaponTierList();
      }
    }
  });

  root.addEventListener('dragstart', (event) => {
    const armorButton = event.target.closest('.tier-armor-item');
    if (armorButton) {
      event.dataTransfer.setData('text/plain', `armor:${armorButton.dataset.armorId}`);
      return;
    }
    const maskButton = event.target.closest('.tier-mask-item');
    if (maskButton) {
      event.dataTransfer.setData('text/plain', `mask:${maskButton.dataset.maskId}`);
      return;
    }
    const weaponButton = event.target.closest('.tier-weapon-item');
    if (weaponButton) event.dataTransfer.setData('text/plain', `weapon:${weaponButton.dataset.weaponId}`);
  });

  board.addEventListener('dragover', (event) => {
    const row = event.target.closest('.tier-row');
    if (!row) return;
    event.preventDefault();
    row.classList.add('is-drop-target');
  });

  board.addEventListener('dragleave', (event) => {
    const row = event.target.closest('.tier-row');
    if (row && !row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
  });

  board.addEventListener('drop', (event) => {
    const row = event.target.closest('.tier-row');
    if (!row) return;
    event.preventDefault();
    const [itemType, itemId] = event.dataTransfer.getData('text/plain').split(':');
    if (selectedCategory === 'armadura' && itemType === 'armor'
      && armorCatalog.some((item) => String(item.id) === itemId)) {
      armorAssignments[itemId] = row.dataset.rank;
      selectedArmorId = null;
      saveArmorAssignments();
      renderArmorTierList();
    } else if (selectedCategory === 'mascaras' && itemType === 'mask'
      && maskCatalog.some((item) => String(item.id) === itemId)) {
      maskAssignments[itemId] = row.dataset.rank;
      selectedMaskId = null;
      saveMaskAssignments();
      renderMaskTierList();
    } else if (selectedCategory === 'arma' && itemType === 'weapon'
      && ALL_WEAPONS.some((weapon) => weapon.name === itemId)) {
      weaponAssignments[itemId] = row.dataset.rank;
      selectedWeaponId = null;
      saveWeaponAssignments();
      renderWeaponTierList();
    }
  });

  weaponPool.addEventListener('dragover', (event) => {
    if (event.target.closest('.tier-weapon-grid')) event.preventDefault();
  });

  weaponPool.addEventListener('drop', (event) => {
    if (!event.target.closest('.tier-weapon-grid')) return;
    event.preventDefault();
    const [itemType, itemId] = event.dataTransfer.getData('text/plain').split(':');
    if (itemType !== 'weapon' || !weaponAssignments[itemId]) return;
    delete weaponAssignments[itemId];
    saveWeaponAssignments();
    renderWeaponTierList();
  });

  armorPool.addEventListener('dragover', (event) => {
    if (event.target.closest('.tier-armor-grid')) event.preventDefault();
  });

  armorPool.addEventListener('drop', (event) => {
    if (!event.target.closest('.tier-armor-grid')) return;
    event.preventDefault();
    const [itemType, itemId] = event.dataTransfer.getData('text/plain').split(':');
    if (itemType !== 'armor' || !armorAssignments[itemId]) return;
    delete armorAssignments[itemId];
    saveArmorAssignments();
    renderArmorTierList();
  });

  maskPool.addEventListener('dragover', (event) => {
    if (event.target.closest('.tier-mask-grid')) event.preventDefault();
  });

  maskPool.addEventListener('drop', (event) => {
    if (!event.target.closest('.tier-mask-grid')) return;
    event.preventDefault();
    const [itemType, itemId] = event.dataTransfer.getData('text/plain').split(':');
    if (itemType !== 'mask' || !maskAssignments[itemId]) return;
    delete maskAssignments[itemId];
    saveMaskAssignments();
    renderMaskTierList();
  });

  async function loadArmorCatalog() {
    try {
      const response = await fetch('assets/data/Armaduras.json');
      if (!response.ok) throw new Error('Falha ao carregar os dados de armaduras.');
      const items = await response.json();
      const armors = (Array.isArray(items) ? items : [])
        .filter((item) => /^armadura\b/i.test(getArmorName(item)))
        .filter((item) => item.efeito_conjunto
          || item.atributo_conjunto_2pc
          || item.atributo_conjunto_4pc
          || item.atributo_conjunto_6pc);
      armorCatalog = Array.from(
        new Map(armors.map((item) => [item.efeito_conjunto || item.id, item])).values()
      );
      renderArmorTierList();
    } catch (error) {
      console.error('Erro ao carregar armaduras para a tier list:', error);
    }
  }

  async function loadMaskCatalog() {
    try {
      const response = await fetch('assets/data/itens.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao carregar os ícones das máscaras.');
      const items = await response.json();
      const itemsByImage = new Map(
        (Array.isArray(items) ? items : [])
          .filter((item) => item.category === 'Máscaras')
          .map((item) => [item.image, item])
      );
      maskCatalog = maskDefinitions.map((mask) => {
        const item = itemsByImage.get(mask.image);
        if (!item) throw new Error(`Máscara sem item correspondente: ${mask.name}`);
        return { ...item, name: mask.name, name_pt: mask.label, image: mask.image };
      });
      renderMaskTierList();
    } catch (error) {
      console.error('Erro ao carregar máscaras para a tier list:', error);
    }
  }

  renderBoard();
  loadArmorCatalog();
  loadMaskCatalog();
};

window.initAlimentosPage = function initAlimentosPage() {
  const root = document.querySelector('.foods-page');
  if (!root || root.dataset.foodsReady === 'true') return;
  root.dataset.foodsReady = 'true';

  let allFoods = [];
  let filteredFoods = [];
  let viewMode = 'cards';
  let selectedBonusColumns = [];
  let sortColumn = '';
  let sortDirection = 'asc';

  function populateFilter(selector, values, emptyLabel) {
    const select = root.querySelector(selector);
    if (!select) return;
    select.innerHTML = `<option value="">${emptyLabel}</option>`;
    values.filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function getBonusEntries(food) {
    return (food.bonus || '').split(',').map((bonus) => {
      const separatorIndex = bonus.indexOf(':');
      if (separatorIndex < 0) return { label: bonus.trim(), value: '' };
      return {
        label: bonus.slice(0, separatorIndex).trim(),
        value: bonus.slice(separatorIndex + 1).trim(),
      };
    }).filter((bonus) => bonus.label);
  }

  function getBonusValue(food, column) {
    return getBonusEntries(food).find((bonus) => bonus.label === column)?.value || '';
  }

  function getBonusColumns(foods) {
    return [...new Set([
      ...foods.flatMap((food) => getBonusEntries(food).map((bonus) => bonus.label)),
    ])].filter((column) => column !== 'Recuperação Aprimorada')
      .sort((firstColumn, secondColumn) => firstColumn.localeCompare(secondColumn, 'pt-BR'));
  }

  function populateBonusColumnsFilter(columns) {
    const options = root.querySelector('#foods-columns-options');
    if (!options) return;
    options.innerHTML = columns.map((column) => `
      <label class="foods-column-option">
        <input type="checkbox" value="${column}" ${selectedBonusColumns.includes(column) ? 'checked' : ''} />
        <span>${column}</span>
      </label>
    `).join('');
    selectedBonusColumns = [...columns];
  }

  function updateBonusColumnsPicker(columns) {
    selectedBonusColumns = [...columns];
    populateBonusColumnsFilter(columns);
  }

  function getSortValue(food, column) {
    if (column.startsWith('bonus:')) return getBonusValue(food, column.slice(6));
    const values = {
      name: food.name_pt || food.name_en || '',
      category: `${food.category || ''} ${food.subcategory || ''}`,
      description: food.description_pt || food.description_en || '',
      duration: food.duracao || '',
    };
    return values[column] || '';
  }

  function sortFoods(foods) {
    if (!sortColumn) return foods;
    return [...foods].sort((firstFood, secondFood) => {
      const firstValue = getSortValue(firstFood, sortColumn);
      const secondValue = getSortValue(secondFood, sortColumn);
      const firstNumber = Number.parseFloat(firstValue.replace(',', '.').replace(/[^\d.-]/g, ''));
      const secondNumber = Number.parseFloat(secondValue.replace(',', '.').replace(/[^\d.-]/g, ''));
      const bothNumbers = Number.isFinite(firstNumber) && Number.isFinite(secondNumber);
      const comparison = bothNumbers
        ? firstNumber - secondNumber
        : firstValue.localeCompare(secondValue, 'pt-BR', { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  function getSortIndicator(column) {
    if (sortColumn !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  }

  function renderFoods() {
    const container = root.querySelector('#foods-container');
    if (!container) return;
    if (!filteredFoods.length) {
      container.innerHTML = '<div class="foods-empty">Nenhum alimento encontrado.</div>';
      updateCount(0);
      return;
    }

    if (viewMode === 'table') {
      const bonusColumns = getBonusColumns(filteredFoods).filter((column) => selectedBonusColumns.includes(column));
      if (sortColumn.startsWith('bonus:') && !bonusColumns.includes(sortColumn.slice(6))) {
        sortColumn = '';
        sortDirection = 'asc';
      }
      container.className = 'foods-table-wrap';
      container.innerHTML = `
        <table class="foods-table">
          <thead>
            <tr>
              <th scope="col"><button class="foods-sort-button" type="button" data-sort-column="name">Alimento <span>${getSortIndicator('name')}</span></button></th>
              <th scope="col"><button class="foods-sort-button" type="button" data-sort-column="description">Descrição <span>${getSortIndicator('description')}</span></button></th>
              ${bonusColumns.map((column) => `<th class="foods-bonus-column" data-bonus-column="${column}" scope="col"><button class="foods-sort-button" type="button" data-sort-column="bonus:${column}">${column} <span>${getSortIndicator(`bonus:${column}`)}</span></button></th>`).join('')}
              <th scope="col"><button class="foods-sort-button" type="button" data-sort-column="duration">Duração <span>${getSortIndicator('duration')}</span></button></th>
            </tr>
          </thead>
          <tbody>
            ${sortFoods(filteredFoods).map((food) => `
              <tr>
                <th scope="row">
                  <div class="food-table-name">
                    <img class="food-table-image" src="${food.image_path || ''}" alt="" loading="lazy" />
                    <span>${food.name_pt || food.name_en || 'Alimento'}</span>
                  </div>
                </th>
                <td>${food.description_pt || food.description_en || ''}</td>
                ${bonusColumns.map((column) => `<td class="foods-bonus-column" data-bonus-column="${column}">${getBonusValue(food, column)}</td>`).join('')}
                <td>${food.duracao || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      updateCount(filteredFoods.length);
      root.querySelectorAll('[data-sort-column]').forEach((button) => {
        button.addEventListener('click', () => {
          const nextColumn = button.dataset.sortColumn;
          if (sortColumn === nextColumn) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
          else {
            sortColumn = nextColumn;
            sortDirection = 'asc';
          }
          renderFoods();
        });
      });
      return;
    }

    container.className = 'foods-grid';
    container.innerHTML = filteredFoods.map((food) => `
      <article class="food-card">
        <div class="food-card-header">
          <img class="food-card-image" src="${food.image_path || ''}" alt="" loading="lazy" />
          <div>
            <h2 class="food-card-title">${food.name_pt || food.name_en || 'Alimento'}</h2>
            <span class="food-card-category">${food.category || ''}</span>
            <span class="food-card-subcategory">${food.subcategory || ''}</span>
          </div>
        </div>
        <p class="food-card-description">${food.description_pt || food.description_en || ''}</p>
        ${food.bonus ? `<div class="food-card-bonus"><strong>Bônus:</strong><ul class="food-card-bonus-list">${food.bonus.split(',').map((b) => b.trim()).filter(Boolean).map((b) => `<li>${b}</li>`).join('')}</ul></div>` : ''}
        ${food.duracao ? `<div class="food-card-duration"><strong>Duração:</strong> ${food.duracao}</div>` : ''}
      </article>
    `).join('');
    updateCount(filteredFoods.length);
  }

  function filterFoods() {
    const search = (root.querySelector('#foods-search')?.value || '').toLocaleLowerCase('pt-BR');
    const category = root.querySelector('#foods-category-filter')?.value || '';
    const subcategory = root.querySelector('#foods-subcategory-filter')?.value || '';
    filteredFoods = allFoods.filter((food) => {
      const searchable = [food.name_pt, food.name_en, food.description_pt, food.bonus].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return (!search || searchable.includes(search))
        && (!category || food.category === category)
        && (!subcategory || food.subcategory === subcategory);
    });
      updateBonusColumnsPicker(getBonusColumns(filteredFoods));
    renderFoods();
  }

  function updateCount(count) {
    const element = root.querySelector('#foods-count');
    if (element) element.textContent = `${count} ${count === 1 ? 'alimento encontrado' : 'alimentos encontrados'}`;
  }

  function setViewMode(nextMode) {
    viewMode = nextMode;
    const columnsPicker = root.querySelector('.foods-columns-picker');
    if (columnsPicker) columnsPicker.hidden = viewMode !== 'table';
    root.querySelectorAll('[data-foods-view]').forEach((button) => {
      const isActive = button.dataset.foodsView === viewMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    if (viewMode === 'table') {
      const subcategoryFilter = root.querySelector('#foods-subcategory-filter');
      if (subcategoryFilter && !subcategoryFilter.value) {
        const basicFoodOption = [...subcategoryFilter.options].find((option) => option.value === 'Alimento Básico');
        if (basicFoodOption) subcategoryFilter.value = basicFoodOption.value;
      }
    }
    filterFoods();
  }

  async function loadFoods() {
    try {
      const response = await fetch('assets/data/alimentos.json');
      if (!response.ok) throw new Error('Falha ao carregar os alimentos.');
      allFoods = await response.json();
      if (!Array.isArray(allFoods)) throw new Error('Formato inválido.');
      populateFilter('#foods-category-filter', [...new Set(allFoods.map((food) => food.category))], 'Todas as categorias');
      populateFilter('#foods-subcategory-filter', [...new Set(allFoods.map((food) => food.subcategory))], 'Todas as subcategorias');
      updateBonusColumnsPicker(getBonusColumns(allFoods));
      filteredFoods = [...allFoods];
      root.querySelector('#foods-search')?.addEventListener('input', filterFoods);
      root.querySelector('#foods-category-filter')?.addEventListener('change', filterFoods);
      root.querySelector('#foods-subcategory-filter')?.addEventListener('change', filterFoods);
      root.querySelector('#foods-columns-options')?.addEventListener('change', (event) => {
        if (event.target.matches('input[type="checkbox"]')) {
          selectedBonusColumns = [...root.querySelectorAll('#foods-columns-options input:checked')].map((input) => input.value);
          renderFoods();
        }
      });
      root.querySelector('#foods-columns-button')?.addEventListener('click', () => {
        const button = root.querySelector('#foods-columns-button');
        const panel = root.querySelector('#foods-columns-panel');
        const isOpen = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!isOpen));
        panel.hidden = isOpen;
      });
      root.querySelector('#foods-columns-panel')?.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      document.addEventListener('click', (event) => {
        const picker = root.querySelector('.foods-columns-picker');
        const button = root.querySelector('#foods-columns-button');
        const panel = root.querySelector('#foods-columns-panel');
        if (picker && !picker.contains(event.target)) {
          button.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
        }
      });
      root.querySelectorAll('[data-foods-view]').forEach((button) => {
        button.addEventListener('click', () => setViewMode(button.dataset.foodsView));
      });
      renderFoods();
    } catch (error) {
      console.error('Erro ao carregar alimentos:', error);
      root.querySelector('#foods-container').innerHTML = `<div class="foods-error">Erro ao carregar os alimentos: ${error.message}</div>`;
    }
  }

  loadFoods();
};

window.initItensPage = function initItensPage() {
  const root = document.querySelector('.items-page');
  if (!root || root.dataset.itensReady === 'true') return;
  root.dataset.itensReady = 'true';

  let allItems = [];
  let filteredItems = [];

  function getCurrentLanguage() {
    return localStorage.getItem('items_lang') || 'pt';
  }

  function getName(item) {
    const lang = getCurrentLanguage();
    return (lang === 'pt' ? item.name_pt : item.name) || item.name || item.name_pt || '';
  }

  function getDescription(item) {
    const lang = getCurrentLanguage();
    return (lang === 'pt' ? item.description_pt : item.description) || item.description || item.description_pt || '';
  }

  function updateLangToggleButton() {
    const btn = root.querySelector('#items-lang-toggle');
    if (btn) btn.textContent = getCurrentLanguage() === 'pt' ? 'EN' : 'PT';
  }

  function toggleItensLanguage() {
    const nextLang = getCurrentLanguage() === 'pt' ? 'en' : 'pt';
    localStorage.setItem('items_lang', nextLang);
    updateLangToggleButton();
    renderItems();
  }

  async function loadItems() {
    try {
      const response = await fetch('assets/data/itens.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao carregar arquivo');

      allItems = await response.json();
      if (!Array.isArray(allItems)) throw new Error('Formato inválido');

      const categories = new Set(allItems.map((i) => i.category).filter(Boolean));
      populateCategoryFilter(Array.from(categories).sort());

      filteredItems = [...allItems];
      updateLangToggleButton();
      renderItems();
      setupEventListeners();
    } catch (error) {
      console.error('Erro ao carregar itens:', error);
      const container = root.querySelector('#items-container');
      if (container) {
        container.innerHTML = `<div class="items-error">❌ Erro ao carregar: ${error.message}</div>`;
      }
    }
  }

  function populateCategoryFilter(categories) {
    const select = root.querySelector('#items-category-filter');
    if (!select) return;

    while (select.options.length > 1) {
      select.remove(1);
    }

    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
  }

  function setupEventListeners() {
    const searchInput = root.querySelector('#items-search');
    const categoryFilter = root.querySelector('#items-category-filter');
    const langToggleBtn = root.querySelector('#items-lang-toggle');

    if (searchInput) searchInput.addEventListener('input', filterItems);
    if (categoryFilter) categoryFilter.addEventListener('change', filterItems);
    if (langToggleBtn) langToggleBtn.addEventListener('click', toggleItensLanguage);
  }

  function filterItems() {
    const searchInput = root.querySelector('#items-search');
    const categoryFilter = root.querySelector('#items-category-filter');
    if (!searchInput || !categoryFilter) return;

    const searchValue = searchInput.value.toLowerCase();
    const categoryValue = categoryFilter.value;

    filteredItems = allItems.filter((item) => {
      const name = getName(item).toLowerCase();
      const description = getDescription(item).toLowerCase();
      const matchesSearch = name.includes(searchValue) || description.includes(searchValue);
      const matchesCategory = !categoryValue || item.category === categoryValue;
      return matchesSearch && matchesCategory;
    });

    renderItems();
  }

  function renderItems() {
    const container = root.querySelector('#items-container');
    if (!container) return;

    if (filteredItems.length === 0) {
      container.innerHTML = '<div class="items-no-results">Nenhum item encontrado</div>';
      updateCount(0);
      return;
    }

    container.innerHTML = filteredItems.map((item) => `
      <article class="item-card">
        <div class="item-card-header">
          <img
            src="${item.image || ''}"
            alt="${getName(item) || 'Item'}"
            class="item-card-icon"
            loading="lazy"
          />
          <div class="item-card-title-section">
            <h3 class="item-card-title">${getName(item)}</h3>
            <span class="item-card-category">${item.category || ''}</span>
          </div>
        </div>
        <div class="item-card-body">
          ${getDescription(item) ? `<p class="item-card-description">${getDescription(item)}</p>` : ''}
          <div class="item-card-meta">
            ${item.stack != null ? `<span><strong>${item.stack}</strong> empilhável</span>` : ''}
            ${item.weight != null ? `<span>Peso <strong>${item.weight}</strong></span>` : ''}
          </div>
        </div>
      </article>
    `).join('');

    updateCount(filteredItems.length);
  }

  function updateCount(n) {
    const el = root.querySelector('#items-count');
    if (el) el.textContent = `${n} ${n === 1 ? 'item encontrado' : 'itens encontrados'}`;
  }

  loadItems();
};

window.initArmadurasPage = function initArmadurasPage() {
  const root = document.querySelector('.armaduras-page');
  if (!root || root.dataset.armadurasReady === 'true') return;
  root.dataset.armadurasReady = 'true';

  const detailImage = root.querySelector('#armaduras-detail-image');
  const detailName = root.querySelector('#armaduras-detail-name');
  const detailDescription = root.querySelector('#armaduras-detail-description');
  const detailSet = root.querySelector('#armaduras-detail-set');
  const list = root.querySelector('#armaduras-list');
  const comparisonPanel = root.querySelector('#armaduras-comparison');
  const comparisonGrid = root.querySelector('#armaduras-comparison-grid');
  const comparisonClear = root.querySelector('#armaduras-comparison-clear');
  const comparisonToggle = root.querySelector('#armaduras-compare-toggle');
  const detailPanel = root.querySelector('#armaduras-detail');
  let comparisonItems = [];
  let comparisonMode = false;

  function getName(item) {
    return item.name_pt || item.name || 'Armadura sem nome';
  }

  function getDescription(item) {
    return item.description_pt || item.description || item.efeito_conjunto || 'Descrição não disponível.';
  }

  function getImage(item) {
    return /rel[ií]quia divina/i.test(getName(item))
      ? 'assets/img/armaduras/Ruina Divina.webp'
      : item.image || '';
  }

  function renderSetAttribute(label, value) {
    if (!value) return '';
    return value
      .split(/,\s+(?=[A-Za-zÀ-ÿ])/)
      .map((attribute) => attribute.trim())
      .filter(Boolean)
      .map((attribute) => `<li>${label}: ${attribute}</li>`)
      .join('');
  }

  function renderComparisonValue(value) {
    if (!value) return 'Sem informação';
    return value.split(/,\s+(?=[A-Za-zÀ-ÿ])/).filter(Boolean).join('<br>');
  }

  function renderComparison() {
    if (!comparisonPanel || !comparisonGrid) return;
    comparisonPanel.hidden = !comparisonMode;
    comparisonGrid.innerHTML = comparisonItems.map((item) => `
      <article class="armadura-comparison-card">
        <img src="${getImage(item)}" alt="" />
        <h3>${getName(item)}</h3>
        <div class="armadura-comparison-row">
          <strong>Descrição</strong>
          <span>${getDescription(item)}</span>
        </div>
        <div class="armadura-comparison-row">
          <strong>2 peças</strong>
          <span>${renderComparisonValue(item.atributo_conjunto_2pc)}</span>
        </div>
        <div class="armadura-comparison-row">
          <strong>4 peças</strong>
          <span>${renderComparisonValue(item.atributo_conjunto_4pc)}</span>
        </div>
        <div class="armadura-comparison-row">
          <strong>6 peças</strong>
          <span>${renderComparisonValue(item.atributo_conjunto_6pc)}</span>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('.armadura-card').forEach((card) => {
      card.classList.toggle(
        'is-comparison-selected',
        comparisonItems.some((item) => String(item.id) === card.dataset.itemId)
      );
    });
  }

  function toggleComparison(item) {
    const existingIndex = comparisonItems.findIndex((selected) => String(selected.id) === String(item.id));
    if (existingIndex >= 0) {
      comparisonItems.splice(existingIndex, 1);
    } else {
      if (comparisonItems.length >= 2) comparisonItems.shift();
      comparisonItems.push(item);
    }
    renderComparison();
  }

  function renderComparisonMode() {
    if (detailPanel) detailPanel.hidden = comparisonMode;
    if (comparisonPanel) comparisonPanel.hidden = !comparisonMode;
    if (comparisonMode) {
      list.querySelectorAll('.armadura-card').forEach((card) => {
        card.classList.remove('is-selected');
      });
    }
    if (comparisonToggle) {
      comparisonToggle.setAttribute('aria-checked', String(comparisonMode));
      comparisonToggle.setAttribute('aria-label', comparisonMode ? 'Voltar ao detalhe' : 'Ativar comparação');
    }
    renderComparison();
  }

  function selectArmor(item) {
    detailImage.src = getImage(item);
    detailImage.alt = getName(item);
    detailName.textContent = getName(item);
    detailDescription.textContent = getDescription(item);
    detailSet.innerHTML = [
      renderSetAttribute('2 peças', item.atributo_conjunto_2pc),
      renderSetAttribute('4 peças', item.atributo_conjunto_4pc),
      renderSetAttribute('6 peças', item.atributo_conjunto_6pc)
    ].join('') || '<li>Atributos não informados.</li>';

    list.querySelectorAll('.armadura-card').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.itemId === String(item.id));
    });
    renderComparison();
  }

  async function loadArmors() {
    try {
      const response = await fetch('assets/data/Armaduras.json');
      if (!response.ok) throw new Error('Falha ao carregar os dados de armaduras.');

      const items = await response.json();
      const armors = (Array.isArray(items) ? items : [])
        .filter((item) => /^armadura\b/i.test(getName(item)))
        .filter((item) => item.efeito_conjunto
          || item.atributo_conjunto_2pc
          || item.atributo_conjunto_4pc
          || item.atributo_conjunto_6pc);
      const uniqueArmors = Array.from(
        new Map(armors.map((item) => [item.efeito_conjunto || item.id, item])).values()
      );

      if (!uniqueArmors.length) {
        list.innerHTML = '<div class="armaduras-empty">Nenhuma armadura encontrada.</div>';
        return;
      }

      list.innerHTML = uniqueArmors.map((item) => `
        <button type="button" class="armadura-card" data-item-id="${item.id}" title="${getName(item)}">
          <img src="${item.image || ''}" alt="" loading="lazy" />
          <span class="armadura-name">${getName(item)}</span>
        </button>
      `).join('');

      list.querySelectorAll('.armadura-card').forEach((card) => {
        card.querySelector('img').addEventListener('error', () => card.remove());
        card.addEventListener('click', () => {
          const selected = uniqueArmors.find((item) => String(item.id) === card.dataset.itemId);
            if (selected) {
              if (comparisonMode) {
                toggleComparison(selected);
              } else {
                selectArmor(selected);
              }
            }
        });
      });

      selectArmor(uniqueArmors[0]);
        comparisonToggle?.addEventListener('click', () => {
          comparisonMode = !comparisonMode;
          renderComparisonMode();
        });
        comparisonClear?.addEventListener('click', () => {
          comparisonItems = [];
          renderComparison();
        });
    } catch (error) {
      console.error('Erro ao carregar armaduras:', error);
      list.innerHTML = `<div class="armaduras-error">Erro ao carregar armaduras: ${error.message}</div>`;
    }
  }

  loadArmors();
};

async function init() {
  const sidebarTarget = document.querySelector('#site-sidebar');
  if (sidebarTarget) {
    try {
      sidebarTarget.innerHTML = await fetchHTML('components/sidebar.html');
    } catch (error) {
      console.error('Failed to load sidebar', error);
    }
  }

  const mainContent = document.querySelector('#main-content');
  if (mainContent) {
    try {
      const headerHTML = await fetchHTML('components/header.html');
      const headerWrapper = document.createElement('header');
      headerWrapper.id = 'site-header';
      headerWrapper.innerHTML = headerHTML;
      mainContent.insertBefore(headerWrapper, mainContent.firstChild);
    } catch (error) {
      console.error('Failed to load header', error);
    }
  }

  initUI();
  await loadPageFromHash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
