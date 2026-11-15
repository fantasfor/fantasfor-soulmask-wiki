// Mapa interativo: mapa oficial do jogo (UI/Map/Level01_Map, extraído por tools/build_data.py)
// com zoom (Leaflet) e marcadores do próprio jogador (salvos no navegador e na conta, se logado).
import { t, pick } from '../i18n.js';
import { esc } from '../data.js';
import { initGameLayers } from './map-game.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const STORAGE_KEY = 'soulmask-map-markers';
const SIZE = 1024; // coordenadas do mapa (o desenho tem 4096 px)

export const MARKER_CATS = {
  resource: { color: '#39d98a', icon: '' },
  base: { color: '#90d1ee', icon: '' },
  boss: { color: '#e63946', icon: '' },
  ruin: { color: '#b974ff', icon: '' },
  tribe: { color: '#ecd760', icon: '' },
  other: { color: '#f3efe8', icon: '' }
};

let leafletPromise = null;
function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = LEAFLET_CSS;
        document.head.appendChild(css);
      }
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('Leaflet')); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

function readMarkers() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function writeMarkers(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* ignora */ }
}

// os dois mapas do jogo: Floresta da Névoa (base) e Areias Movediças (DLC)
export const MAPS = { main: 'assets/img/map/world.webp', dlc: 'assets/img/map/dlc.webp' };
const MAP_KEY = 'map_current';

export async function initMapPage(root, params) {
  let mapId = params?.get('map');
  if (!MAPS[mapId]) { try { mapId = localStorage.getItem(MAP_KEY); } catch (e) { mapId = null; } }
  if (!MAPS[mapId]) mapId = 'main';
  try { localStorage.setItem(MAP_KEY, mapId); } catch (e) { /* ignora */ }
  root.querySelectorAll('[data-map-switch]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mapSwitch === mapId));
    b.addEventListener('click', () => {
      if (b.dataset.mapSwitch === mapId) return;
      try { localStorage.setItem(MAP_KEY, b.dataset.mapSwitch); } catch (e) { /* ignora */ }
      location.hash = `#mapa?map=${b.dataset.mapSwitch}`;
    });
  });
  const canvas = root.querySelector('#map-canvas');
  const addBtn = root.querySelector('#map-add');
  const hint = root.querySelector('#map-hint');
  const filters = root.querySelector('#map-filters');
  const listEl = root.querySelector('#map-markers');
  const dialog = root.querySelector('#map-dialog');

  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    canvas.innerHTML = `<p class="map-hint">${esc(t('common.errorLoading', { msg: 'Leaflet' }))}</p>`;
    return;
  }

  const bounds = [[0, 0], [SIZE, SIZE]];
  const map = L.map(canvas, {
    crs: L.CRS.Simple, minZoom: -1, maxZoom: 3, zoomSnap: 0.5, attributionControl: false, preferCanvas: true,
    maxBounds: [[-SIZE * 0.7, -SIZE * 0.7], [SIZE * 1.7, SIZE * 1.7]]
  });
  L.imageOverlay(MAPS[mapId], bounds).addTo(map);
  map.fitBounds(bounds);

  // marcadores antigos (sem "map") são do mapa base
  const onThisMap = (m) => (m.map || 'main') === mapId;
  let allMarkers = readMarkers();
  let markers = allMarkers.filter(onThisMap);
  const saveAll = () => {
    allMarkers = [...allMarkers.filter((m) => !onThisMap(m)), ...markers];
    writeMarkers(allMarkers);
  };
  const hidden = new Set();
  const layer = L.layerGroup().addTo(map);
  let adding = false;
  let pending = null;

  const catLabel = (c) => t(`map.cat.${c}`);

  function icon(cat) {
    const c = MARKER_CATS[cat] || MARKER_CATS.other;
    return L.divIcon({
      className: 'map-pin',
      html: `<span style="--pin:${c.color}">${c.icon}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26]
    });
  }

  function render() {
    layer.clearLayers();
    markers.filter((m) => !hidden.has(m.cat)).forEach((m) => {
      L.marker([m.y, m.x], { icon: icon(m.cat), title: m.name })
        .bindPopup(`<strong>${esc(m.name)}</strong><br><small>${esc(catLabel(m.cat))}</small>${m.note ? `<p>${esc(m.note)}</p>` : ''}
          <button type="button" class="map-btn" data-del="${esc(m.id)}">${esc(t('map.delete'))}</button>`)
        .addTo(layer);
    });
    filters.innerHTML = Object.keys(MARKER_CATS).map((c) => {
      const n = markers.filter((m) => m.cat === c).length;
      return `<button type="button" class="map-filter" data-cat="${c}" aria-pressed="${!hidden.has(c)}" style="--pin:${MARKER_CATS[c].color}">
        <span aria-hidden="true">${MARKER_CATS[c].icon}</span> ${esc(catLabel(c))} <small>${n}</small></button>`;
    }).join('');
    listEl.innerHTML = markers.length ? markers.map((m) => `
      <li><button type="button" class="map-marker-item" data-go="${esc(m.id)}" style="--pin:${(MARKER_CATS[m.cat] || MARKER_CATS.other).color}">
        <span aria-hidden="true">${(MARKER_CATS[m.cat] || MARKER_CATS.other).icon}</span> ${esc(m.name)}</button>
        <button type="button" class="map-marker-del" data-del="${esc(m.id)}" aria-label="${esc(t('map.delete'))}">&times;</button></li>`).join('')
      : `<li class="map-hint">${esc(t('map.none'))}</li>`;
  }

  function setAdding(on) {
    adding = on;
    addBtn.setAttribute('aria-pressed', String(on));
    canvas.classList.toggle('is-adding', on);
    hint.textContent = t(on ? 'map.hintAdding' : 'map.hint');
  }

  function remove(id) {
    markers = markers.filter((m) => m.id !== id);
    saveAll();
    map.closePopup();
    render();
  }

  dialog.elements.cat.innerHTML = Object.keys(MARKER_CATS).map((c) => `<option value="${c}">${esc(catLabel(c))}</option>`).join('');

  map.on('click', (e) => {
    if (!adding) return;
    pending = { x: Math.round(e.latlng.lng * 10) / 10, y: Math.round(e.latlng.lat * 10) / 10 };
    dialog.reset();
    dialog.hidden = false;
    dialog.elements.name.focus();
    setAdding(false);
  });
  addBtn.addEventListener('click', () => setAdding(!adding));
  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pending) return;
    markers.push({
      id: `m${Date.now().toString(36)}`,
      name: dialog.elements.name.value.trim().slice(0, 60),
      cat: dialog.elements.cat.value,
      note: dialog.elements.note.value.trim().slice(0, 300),
      map: mapId,
      ...pending
    });
    saveAll();
    pending = null;
    dialog.hidden = true;
    render();
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => { pending = null; dialog.hidden = true; });
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    if (hidden.has(b.dataset.cat)) hidden.delete(b.dataset.cat); else hidden.add(b.dataset.cat);
    render();
  });
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { remove(del.dataset.del); return; }
    const go = e.target.closest('[data-go]');
    if (go) {
      const m = markers.find((x) => x.id === go.dataset.go);
      if (m) {
        hidden.delete(m.cat);
        render();
        map.setView([m.y, m.x], 2);
      }
    }
  });
  render();
  // o Leaflet precisa recalcular o tamanho depois da animação de troca de página
  setTimeout(() => map.invalidateSize(), 350);
  initGameLayers(L, map, root, mapId, params?.get('q') || '');
}
