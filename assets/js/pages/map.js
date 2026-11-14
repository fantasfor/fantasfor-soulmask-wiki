// Mapa interativo: mapa oficial do jogo (UI/Map/Level01_Map, extraído por tools/build_data.py)
// com zoom (Leaflet) e marcadores do próprio jogador (salvos no navegador e na conta, se logado).
import { t, pick } from '../i18n.js';
import { esc, loadData, loadIndex, L as Lbl } from '../data.js';

// marcadores do jogo (assets/data/map-markers.json, lidos das fases .umap por tools/build_data.py)
const GAME_CATS = {
  teleport: { color: '#4fe3ff', r: 7, on: true },
  obelisk: { color: '#ecd760', r: 5, on: true },
  pyramid: { color: '#ff5d5d', r: 9, on: true },
  dungeon: { color: '#ff8c3a', r: 8, on: true },
  ruin: { color: '#b974ff', r: 5, on: true },
  maskAltar: { color: '#ff7ad9', r: 7, on: true },
  maskChest: { color: '#ff7ad9', r: 5, on: true },
  tribe: { color: '#f3efe8', r: 7, on: true },
  chest: { color: '#d9a441', r: 3, on: false },
  iron: { color: '#c0c6cc', r: 4, on: false },
  copper: { color: '#d9824b', r: 4, on: false },
  tin: { color: '#9fb4c7', r: 4, on: false },
  coal: { color: '#555555', r: 4, on: false },
  npc: { color: '#e63946', r: 2.5, on: false }
};

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const STORAGE_KEY = 'soulmask-map-markers';
const SIZE = 1024; // coordenadas do mapa (o desenho tem 4096 px)

export const MARKER_CATS = {
  resource: { color: '#39d98a', icon: '⛏' },
  base: { color: '#90d1ee', icon: '🏠' },
  boss: { color: '#e63946', icon: '☠' },
  ruin: { color: '#b974ff', icon: '🏛' },
  tribe: { color: '#ecd760', icon: '⚑' },
  other: { color: '#f3efe8', icon: '●' }
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

export async function initMapPage(root) {
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
    maxBounds: [[-SIZE * 0.25, -SIZE * 0.25], [SIZE * 1.25, SIZE * 1.25]]
  });
  L.imageOverlay('assets/img/map/world.webp', bounds).addTo(map);
  map.fitBounds(bounds);

  let markers = readMarkers();
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
    writeMarkers(markers);
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
      ...pending
    });
    writeMarkers(markers);
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
  initGameLayers(L, map, root);
}

// ------------------------------------------------------------------ marcadores do jogo
async function initGameLayers(L, map, root) {
  const layersEl = root.querySelector('#map-layers');
  const creatureSel = root.querySelector('#map-creature');
  let data; let creatures;
  try {
    [data, creatures] = await Promise.all([loadData('map-markers'), loadIndex('creatures')]);
  } catch (e) {
    layersEl.innerHTML = `<p class="map-hint">${esc(t('common.errorLoading', { msg: e.message }))}</p>`;
    return;
  }
  const m = data.maps.main;
  const renderer = L.canvas({ padding: 0.3 });
  const lab = (i) => (i >= 0 && m.labels[i] ? Lbl(m.labels[i]) : '');
  const catOf = (p) => (p[0] === 'ore' ? p[3] : p[0]);
  const groups = {};
  const counts = {};
  const state = {};
  try { Object.assign(state, JSON.parse(localStorage.getItem('map_layers') || '{}')); } catch (e) { /* ignora */ }
  Object.keys(GAME_CATS).forEach((k) => { groups[k] = L.layerGroup(); counts[k] = 0; if (state[k] === undefined) state[k] = GAME_CATS[k].on; });

  const levels = (p) => (p[4] ? ` · ${t('common.level')} ${p[4]}${p[5] && p[5] !== p[4] ? `–${p[5]}` : ''}` : '');
  function popup(p) {
    const cat = catOf(p);
    let title = t(`map.game.${cat}`);
    if (p[0] === 'chest') title = `${lab(p[3]) || title}${p[4] ? ` · ${t('common.level')} ${p[4]}` : ''}`;
    else if (p[0] === 'npc') title = `${lab(p[3]) || title}${levels(p)}`;
    else if (p[0] !== 'ore' && lab(p[3])) title = `${lab(p[3])}`;
    return `<strong>${esc(title)}</strong><br><small>${esc(t(`map.game.${cat}`))}</small>`;
  }

  m.points.forEach((p) => {
    if (p[0] === 'creature') return;
    const cat = catOf(p);
    const conf = GAME_CATS[cat];
    if (!conf) return;
    counts[cat] += 1;
    L.circleMarker([SIZE - p[2], p[1]], { renderer, radius: conf.r, color: '#000', weight: 1, fillColor: conf.color, fillOpacity: 0.9 })
      .bindPopup(() => popup(p)).addTo(groups[cat]);
  });

  function renderLayers() {
    layersEl.innerHTML = Object.keys(GAME_CATS).filter((k) => counts[k]).map((k) => `
      <button type="button" class="map-filter" data-layer="${k}" aria-pressed="${state[k]}" style="--pin:${GAME_CATS[k].color}">
        <span class="map-dot" style="background:${GAME_CATS[k].color}"></span> ${esc(t(`map.game.${k}`))} <small>${counts[k]}</small></button>`).join('');
    Object.keys(groups).forEach((k) => {
      if (state[k] && counts[k]) groups[k].addTo(map); else groups[k].remove();
    });
  }
  layersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    state[b.dataset.layer] = !state[b.dataset.layer];
    try { localStorage.setItem('map_layers', JSON.stringify(state)); } catch (err) { /* ignora */ }
    renderLayers();
  });
  renderLayers();

  // criaturas: escolha uma para ver onde ela nasce
  const spawns = {};
  m.points.filter((p) => p[0] === 'creature').forEach((p) => { (spawns[p[3]] ||= []).push(p); });
  const ids = Object.keys(spawns).filter((id) => creatures.has(id))
    .sort((a, b) => pick(creatures.get(a), 'name').localeCompare(pick(creatures.get(b), 'name')));
  creatureSel.innerHTML = `<option value="">${esc(t('map.pickCreature'))}</option>`
    + ids.map((id) => `<option value="${esc(id)}">${esc(pick(creatures.get(id), 'name'))} (${spawns[id].length})</option>`).join('');
  const creatureLayer = L.layerGroup().addTo(map);
  creatureSel.addEventListener('change', () => {
    creatureLayer.clearLayers();
    const id = creatureSel.value;
    if (!id) return;
    const c = creatures.get(id);
    const name = pick(c, 'name');
    const pts = spawns[id];
    pts.forEach((p) => {
      L.circleMarker([SIZE - p[2], p[1]], { renderer, radius: 5, color: '#000', weight: 1, fillColor: '#39d98a', fillOpacity: 0.95 })
        .bindPopup(`<strong>${esc(name)}</strong>${esc(levels(p))}<br><a href="#criaturas?q=${encodeURIComponent(name)}">${esc(t('map.seeCreature'))}</a>`)
        .addTo(creatureLayer);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [SIZE - p[2], p[1]])).pad(0.2), { maxZoom: 1 });
  });
}
