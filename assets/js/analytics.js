// Google Analytics 4: conta quantas pessoas abrem cada página do site.
// Cole aqui o "ID da métrica" do GA4 (formato G-XXXXXXXXXX). Vazio = analytics desligado.
const GA_ID = 'G-7H3C00D419';

// Base dos endereços enviados ao GA: cada seção aparece como /fantasfor-soulmask-wiki/<pagina>
const BASE_PATH = '/fantasfor-soulmask-wiki/';
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let ready = false;
let lastPage = null;

function setup() {
  if (ready || !GA_ID || isLocal) return ready;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // send_page_view: false -> o site manda um page_view por seção (rotas com "#")
  window.gtag('config', GA_ID, { send_page_view: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  ready = true;
  return ready;
}

export function trackPageView(page) {
  if (!setup() || page === lastPage) return;
  lastPage = page;
  const path = page === 'home' ? BASE_PATH : `${BASE_PATH}${page}`;
  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_location: `${location.origin}${path}`,
    page_path: path,
    language: document.documentElement.lang || undefined
  });
}
