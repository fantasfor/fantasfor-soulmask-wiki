import { loadTranslations, translateDocument } from './i18n.js';
import { initUI } from './ui.js';

// Load a component HTML and insert into selector
async function loadComponent(path, selector){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error('fetch failed');
    const html = await r.text();
    // insert directly (use swapContent for animated transitions)
    document.querySelector(selector).innerHTML = html;
  }catch(e){ console.error('loadComponent', path, e) }
}

// fetch HTML as text (no DOM insertion)
async function fetchHTML(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error('fetch failed');
  return await r.text();
}

// swap content of #page-content with simple fade+slide transition
async function swapContent(html){
  const container = document.querySelector('#page-content');
  const oldView = container.querySelector('.view');
  if(oldView){
    oldView.classList.add('view-exit');
    // force reflow then start exit
    requestAnimationFrame(()=> oldView.classList.add('view-exit-active'));
    await new Promise(res=>{
      const timeout = setTimeout(res, 300);
      oldView.addEventListener('transitionend', ()=>{ clearTimeout(timeout); res(); }, {once:true});
    });
  }
  // insert new view wrapper
  container.innerHTML = `<div class="view view-enter">${html}</div>`;
  const newView = container.querySelector('.view');
  // start enter transition
  requestAnimationFrame(()=> newView.classList.add('view-enter-active'));
  await new Promise(res=>{
    const timeout = setTimeout(res, 300);
    newView.addEventListener('transitionend', ()=>{ clearTimeout(timeout); res(); }, {once:true});
  });
  newView.classList.remove('view-enter','view-enter-active');
}

// Simple app initializer
async function init(){
  // load components (header removed)
  await Promise.all([
    loadComponent('components/sidebar.html','#site-sidebar')
  ]);

  // language
  const saved = localStorage.getItem('sm_lang') || navigator.language.split('-')[0] || 'pt';
  await setLanguage(saved);

  // initial page content will be loaded by hash router

  // small delay to ensure components are in DOM, then init UI
  setTimeout(()=>initUI(), 80);

  function createFeedItem(item){
    const li = document.createElement('li');
    li.className = 'home-feed-item';
    li.innerHTML = `
      ${item.thumbnail ? `<img class="home-feed-item-thumb" src="${item.thumbnail}" alt="${item.title}">`
                    : `<img class="home-feed-item-icon" src="${item.icon}" alt="${item.iconAlt}">`}
      <div class="home-feed-item-body">
        <h3 class="home-feed-item-title">${item.title}</h3>
        <span class="home-feed-item-date">${item.date}</span>
      </div>
      <a class="home-feed-item-button" href="${item.url}" target="_blank" rel="noopener noreferrer">${item.buttonText}</a>
    `;
    return li;
  }

  async function fetchRss2JsonFeed(feedUrl){
    const proxy = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
    const res = await fetch(proxy);
    if(!res.ok) throw new Error('rss2json failed');
    const data = await res.json();
    if(data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('rss2json invalid');
    return data.items;
  }

  async function fetchXmlProxy(feedUrl){
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`,
      `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(feedUrl)}`
    ];

    let lastError;
    for(const url of proxies){
      try{
        const res = await fetch(url);
        if(!res.ok) throw new Error('proxy failed');
        const text = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'application/xml');
        const items = Array.from(doc.querySelectorAll('item, entry'));
        if(!items.length) throw new Error('parsed zero items');
        return { doc, items };
      }catch(e){
        lastError = e;
      }
    }
    throw lastError || new Error('proxy feed failure');
  }

  function parseXmlImage(item){
    const enclosure = item.querySelector('enclosure');
    if(enclosure?.getAttribute('url')) return enclosure.getAttribute('url');

    const desc = item.querySelector('description')?.textContent || '';
    const match = desc.match(/<img[^>]*src="([^"]+)"/i);
    return match ? match[1] : '';
  }

  function getYoutubeVideoId(url){
    try{
      const parsed = new URL(url);
      return parsed.searchParams.get('v') || parsed.pathname.split('/').pop() || '';
    }catch(e){
      return '';
    }
  }

  async function fetchSteamFeed(){
    const feedUrl = 'https://store.steampowered.com/feeds/news/app/2646460/';
    try{
      const items = await fetchRss2JsonFeed(feedUrl);
      if(!items.length) throw new Error('Steam RSS retornou nenhum item');
      return items.slice(0, 3).map(item=>({
        icon: 'assets/img/nav-hexagon.svg',
        iconAlt: 'Ícone Soulmask',
        thumbnail: item.thumbnail || item.enclosure?.link || '',
        title: item.title || 'Sem título',
        date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('pt-BR') : '',
        url: item.link || 'https://store.steampowered.com/app/2646460/',
        buttonText: 'Ver notícia'
      }));
    }catch(e){
      console.warn('fetchSteamFeed rss2json', e);
    }

    try{
      const { items } = await fetchXmlProxy(feedUrl);
      if(!items.length) throw new Error('Steam proxy retornou nenhum item');
      return items.slice(0, 3).map(item=>({
        icon: 'assets/img/nav-hexagon.svg',
        iconAlt: 'Ícone Soulmask',
        thumbnail: parseXmlImage(item),
        title: item.querySelector('title')?.textContent || 'Sem título',
        date: item.querySelector('pubDate')?.textContent ? new Date(item.querySelector('pubDate')?.textContent).toLocaleDateString('pt-BR') : '',
        url: item.querySelector('link')?.textContent || 'https://store.steampowered.com/app/2646460/',
        buttonText: 'Ver notícia'
      }));
    }catch(e){
      console.warn('fetchSteamFeed proxy', e);
      return [
        { icon: 'assets/img/nav-hexagon.svg', iconAlt: 'Ícone Soulmask', title: 'Não foi possível carregar o feed da Steam', date: '', url: 'https://store.steampowered.com/app/2646460/', buttonText: 'Ver Steam' }
      ];
    }
  }

  async function fetchYouTubeFeed(){
    const channelUrl = 'https://www.youtube.com/@GDMFantasfor';
    const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCUNx7vQ1iTmU_YIvCsApGPw';
    try{
      const items = await fetchRss2JsonFeed(feedUrl);
      if(!items.length) throw new Error('YouTube RSS retornou nenhum item');
      return items.slice(0, 4).map(item=>{
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
    }catch(e){
      console.warn('fetchYouTubeFeed rss2json', e);
    }

    try{
      const { items } = await fetchXmlProxy(feedUrl);
      if(!items.length) throw new Error('YouTube proxy retornou nenhum item');
      return items.slice(0, 4).map(item=>{
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
    }catch(e){
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
    return versions.slice(0, limit).map(section => {
      const lines = section.split('\n');
      const headerLine = lines[0].trim();
      const headerMatch = headerLine.match(/^([\d.]+)\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      const version = headerMatch ? headerMatch[1] : headerLine.replace(/\].*$/, '');
      const date = headerMatch ? headerMatch[2] : '';
      const formattedDate = date ? date.split('-').reverse().join('/') : '';
      const changes = lines.slice(1).map(line => line.trim()).filter(line => line.startsWith('- ')).map(line => line.slice(2));
      return {
        version: version || 'Atualização',
        date: formattedDate,
        changes: changes.length ? changes : ['Nenhuma mudança clara encontrada.']
      };
    }).filter(item => item.changes.length);
  }

  async function fetchUpdateNotesWithApi() {
    const url = 'https://api.github.com/repos/fantasfor/Site/contents/Atualizacao.md?t=' + Date.now();
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github.v3+json'
      }
    });
    if(!res.ok) throw new Error('GitHub API erro ' + res.status);
    const data = await res.json();
    if(!data.content) throw new Error('Conteúdo de atualização não encontrado');
    return decodeBase64Utf8(data.content);
  }

  async function fetchUpdateNotesWithRaw() {
    const url = 'https://raw.githubusercontent.com/fantasfor/Site/main/Atualizacao.md?t=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error('Raw GitHub erro ' + res.status);
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
        if(!proxyRes.ok) throw new Error('AllOrigins proxy erro ' + proxyRes.status);
        return await proxyRes.text();
      }
    }
  }

  async function renderHomeUpdates(){
    const updatesList = document.getElementById('home-updates-list');
    if(!updatesList) return;
    updatesList.innerHTML = '<article class="home-update-card"><h3>Carregando notas...</h3><p style="margin:0;color:#d9d2c5;">Buscando atualizações do GitHub.</p></article>';
    try {
      const markdown = await fetchUpdateNotes();
      const updates = parseUpdateNotesMarkdown(markdown, 4);
      if(!updates.length) {
        updatesList.innerHTML = '<article class="home-update-card"><h3>Nenhuma nota encontrada</h3><p style="margin:0;color:#d9d2c5;">O arquivo de atualizações não contém seções no formato esperado.</p></article>';
        return;
      }
      const card = document.createElement('article');
      card.className = 'home-update-card';
      card.innerHTML = `
        <h3>Notas de Atualização</h3>
        ${updates.map(update => `
          <div class="home-update-version">
            <strong>${update.version}${update.date ? ' — ' + update.date : ''}</strong>
            <ul>${update.changes.map(change => `<li>${change}</li>`).join('')}</ul>
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

  async function renderHomeFeeds(){
    const soulmaskFeed = document.getElementById('soulmask-feed');
    const youtubeFeed = document.getElementById('youtube-feed');
    if(!soulmaskFeed || !youtubeFeed) return;

    soulmaskFeed.innerHTML = `<li class="home-feed-loading">Carregando atualizações Soulmask...</li>`;
    youtubeFeed.innerHTML = `<li class="home-feed-loading">Carregando vídeos do YouTube...</li>`;

    try{
      const steamItems = await fetchSteamFeed();
      soulmaskFeed.innerHTML = '';
      steamItems.forEach(item=> soulmaskFeed.appendChild(createFeedItem(item)));
    }catch(error){
      console.warn('renderHomeFeeds steam', error);
      soulmaskFeed.innerHTML = `<li class="home-feed-error">Erro ao carregar o feed Soulmask. Tente novamente mais tarde.</li>`;
    }

    try{
      const youtubeItems = await fetchYouTubeFeed();
      youtubeFeed.innerHTML = '';
      youtubeItems.forEach(item=> youtubeFeed.appendChild(createFeedItem(item)));
    }catch(error){
      console.warn('renderHomeFeeds youtube', error);
      youtubeFeed.innerHTML = `<li class="home-feed-error">Erro ao carregar o feed do YouTube. Tente novamente mais tarde.</li>`;
    }
  }

  // Router: load page from hash, and respond to hash changes
  async function loadPageFromHash(){
    const page = (location.hash || '#home').replace('#','') || 'home';
    // set active link
    document.querySelectorAll('a.nav-link').forEach(n=>n.classList.toggle('active', n.dataset.page===page));
    // attempt to load page as HTML, then swap content with animation
    try{
      const html = await fetchHTML(`pages/${page}.html`);
      await swapContent(html);
    }catch(e){
      console.warn('page load failed, loading home', e);
      const html = await fetchHTML('pages/home.html');
      await swapContent(html);
      document.querySelectorAll('a.nav-link').forEach(n=>n.classList.toggle('active', n.dataset.page==='home'));
      history.replaceState(null, '', '#home');
    }
    window.scrollTo({top:0,behavior:'smooth'});
    renderHomeFeeds();
    renderHomeUpdates();
  }

  window.addEventListener('hashchange', loadPageFromHash, false);
  // expose a helper to navigate programmatically
  window.navigateTo = function(page){
    const target = '#' + (page || 'home');
    if(location.hash !== target) location.hash = target;
    else loadPageFromHash();
  }

  // route hash clicks using event delegation so dynamically loaded pages work too
  document.body.addEventListener('click', (ev)=>{
    const anchor = ev.target.closest('a[href^="#"]');
    if(!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if(href === '#') return;
    ev.preventDefault();
    const p = anchor.dataset.page || href.replace('#','') || 'home';
    window.navigateTo(p);
  });

  // initial load from hash (if present)
  loadPageFromHash();
}

export async function setLanguage(lang){
  try{
    const translations = await loadTranslations(lang);
    translateDocument(translations);
    localStorage.setItem('sm_lang', lang);
  }catch(e){console.error(e)}
}

// expose setter for language switcher in header
window.setLanguage = setLanguage;

document.addEventListener('DOMContentLoaded', ()=>init());
