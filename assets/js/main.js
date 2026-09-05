import { loadTranslations, translateDocument } from './i18n.js';
import { initUI } from './ui.js';

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
  const r = await fetch(path);
  if (!r.ok) throw new Error('fetch failed');
  return await r.text();
}

async function swapContent(html) {
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

async function loadPageFromHash() {
  const page = (location.hash || '#home').replace('#', '') || 'home';

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

  if (document.querySelector('.armaduras-page')) {
    initArmadurasPage();
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

  const state = {
    search: '',
    selectedPositive: Array(MAX_TALENT_SLOTS).fill(null),
    selectedArmorPieces: Array(6).fill(null),
    optionalSlots: 0,
    optionalTalentGroups: [],
    expandedSlot: null,
    previewTalentId: null,
    currentBuildId: null
  };

  let talentCatalog = [];
  let armorCatalog = [];
  let savedBuilds = [];
  const armorSlotNames = ['Armadura', 'Luvas', 'Calça', 'Botas', 'Colar', 'Anel'];
  const armorSlotCategories = ['Armadura', 'Luvas', 'Calças', 'Botas', 'Colar', 'Anel'];

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

  const CLASS_WEAPONS = {
    warrior: {
      label: 'Guerreiro',
      weapons: [
        { name: 'Lâmina de Duas Mãos', image: 'assets/img/itens/t13_img_0094_05_01.webp' },
        { name: 'Martelo', image: 'assets/img/itens/t13_img_0098_05_01.webp' },
        { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0093_05_01.webp' },
        { name: 'Espada Grande', image: 'assets/img/itens/t13_img_0097_05_01.webp' },
        { name: 'Manoplas', image: 'assets/img/itens/t13_img_0095_05_01.webp' }
      ]
    },
    hunter: {
      label: 'Caçador',
      weapons: [
        { name: 'Arco Longo', image: 'assets/img/itens/t13_img_0099_05_01.webp' },
        { name: 'Lâmina de Duas Mãos', image: 'assets/img/itens/t13_img_0094_05_01.webp' },
        { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0093_05_01.webp' },
        { name: 'Lança', image: 'assets/img/itens/t13_img_0102_05_01.webp' },
        { name: 'Manoplas', image: 'assets/img/itens/t13_img_0095_05_01.webp' },
        { name: 'Chicote de Espinhos', image: 'assets/img/itens/t13_img_0103_05_01.webp' }
      ]
    },
    guard: {
      label: 'Guarda',
      weapons: [
        { name: 'Escudo', image: 'assets/img/itens/t13_img_0101_05_01.webp' },
        { name: 'Arco', image: 'assets/img/itens/t13_img_0092_05_01.webp' },
        { name: 'Lâmina de Uma Mão', image: 'assets/img/itens/t13_img_0093_05_01.webp' },
        { name: 'Espada Grande', image: 'assets/img/itens/t13_img_0097_05_01.webp' },
        { name: 'Lança', image: 'assets/img/itens/t13_img_0102_05_01.webp' }
      ]
    }
  };

  const ALL_WEAPONS = Object.values(CLASS_WEAPONS).flatMap((classData) => classData.weapons)
    .filter((weapon, index, weapons) => weapons.findIndex((item) => item.name === weapon.name) === index);

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
      updatedAt: new Date().toISOString()
    };
  }

  function applyBuild(build) {
    state.currentBuildId = build.id || null;
    const importedTalents = Array.isArray(build.selectedPositive) ? build.selectedPositive : [];
    const importedGroups = Array.isArray(build.optionalTalentGroups) ? build.optionalTalentGroups : [];
    state.selectedArmorPieces = Array.isArray(build.selectedArmorPieces)
      ? Array.from({ length: 6 }, (_, index) => build.selectedArmorPieces[index] || null)
      : Array(6).fill(null);
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
    state.optionalSlots = 0;
    state.optionalTalentGroups = [];
    state.expandedSlot = null;
    state.previewTalentId = null;
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
          .split(/,\s*/)
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
            imageUrl: imageUrl
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
};

window.addEventListener('hashchange', () => {
  const page = (location.hash || '#home').replace('#', '') || 'home';
  if (page === 'builder-maker') initBuilderMakerPage();
  if (page === 'talentos') initTalentsPage();
  if (page === 'itens') initItensPage();
  if (page === 'armaduras') initArmadurasPage();
});

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
      const response = await fetch('assets/data/itens.json');
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
      ? 'assets/img/armaduras/Ruina Divina.png'
      : item.image || '';
  }

  function renderSetAttribute(label, value) {
    if (!value) return '';
    return value
      .split(/,\s*/)
      .map((attribute) => attribute.trim())
      .filter(Boolean)
      .map((attribute) => `<li>${label}: ${attribute}</li>`)
      .join('');
  }

  function renderComparisonValue(value) {
    if (!value) return 'Sem informação';
    return value.split(/,\s*/).filter(Boolean).join('<br>');
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

export async function setLanguage(lang) {
  try {
    const translations = await loadTranslations(lang);
    translateDocument(translations);
    localStorage.setItem('sm_lang', lang);
  } catch (e) {
    console.error(e);
  }
}

window.setLanguage = setLanguage;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
