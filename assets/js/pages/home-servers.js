// Página inicial: 3 servidores em destaque (comunidade + oficiais da Steam), logo abaixo do "Bem-vindo".
// Ordem: maior apoio (boost) primeiro; empate ou sem apoio -> mais jogadores online agora.
// Esconde inativos (sem confirmação há 60 dias) e prefere os online quando há pelo menos 3.
// Carrega em segundo plano (não atrasa o resto da home). Mesma API da página Servidores (Worker gdmbot-loja).
import { t } from '../i18n.js';
import { esc } from '../data.js';
import { loadFirebase } from '../cloud.js';

const API = 'https://gdmbot-loja.gdmbot-loja.workers.dev/api';
const ACTIVE_DAYS = 60;
const SHOW = 3;
const OFFICIAL_ICON = 'assets/img/servers/oficial-soulmask.webp';
const OFF_REGION = { NA: 'America', US: 'America', EU: 'Europe', AS: 'Asia', SA: 'SouthAmerica', OC: 'Oceania', AU: 'Oceania' };

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const addrKey = (d) => (/^[a-z0-9.-]+:\d{1,5}$/i.test(String(d.address || '').trim()) ? String(d.address).trim().toLowerCase() : '');
const lastCheck = (d) => ((d.updatedAt?.seconds || d.createdAt?.seconds || 0) * 1000);

async function communityServers() {
  try {
    const fb = await loadFirebase();
    const snap = await fb.store.getDocs(fb.store.collection(fb.db, 'servers'));
    const since = Date.now() - ACTIVE_DAYS * 24 * 3600 * 1000;
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => lastCheck(d) > since);
  } catch (e) {
    console.warn('home servers', e);
    return [];
  }
}

async function load() {
  const [community, off] = await Promise.all([communityServers(), getJson(`${API}/officialServers`)]);
  // status ao vivo dos servidores da comunidade com IP (até 30 por chamada)
  const keys = [...new Set(community.map(addrKey).filter(Boolean))].slice(0, 30);
  const status = keys.length ? (await getJson(`${API}/serverStatus?addrs=${encodeURIComponent(keys.join(','))}`))?.servers || {} : {};
  const items = community.map((d) => {
    const s = status[addrKey(d)];
    return {
      id: d.id, name: d.name, icon: d.icon || '', boost: Number(d.boost) || 0, region: d.region, mode: d.mode,
      online: s ? s.online : null, players: s?.online ? s.players : -1, max: s?.maxPlayers || d.slots || 0
    };
  });
  (off?.servers || []).forEach((s) => items.push({
    id: `off:${s.name}`, official: true, name: t('srv.official.name2', { c: `${s.region}-${s.num || '?'}` }), icon: OFFICIAL_ICON,
    boost: 0, region: OFF_REGION[s.region] || '', mode: s.mode, online: true, players: s.players, max: s.maxPlayers
  }));
  const online = items.filter((x) => x.online);
  const pool = online.length >= SHOW ? online : [...online, ...items.filter((x) => !x.online)];
  return pool.sort((a, b) => b.boost - a.boost || b.players - a.players).slice(0, SHOW);
}

function card(x) {
  const state = x.online === true ? 'is-on' : x.online === false ? 'is-off' : 'is-wait';
  const label = x.online === true ? t('srv.live.online') : x.online === false ? t('srv.live.offline') : t('srv.live.unknown');
  return `<a class="home-srv-card${x.boost ? ' is-boosted' : ''}${x.official ? ' is-official' : ''}" href="#servidores?id=${encodeURIComponent(x.id)}">
    ${x.icon ? `<img class="home-srv-icon" src="${esc(x.icon)}" alt="" loading="lazy" />` : '<span class="home-srv-icon"></span>'}
    <span class="home-srv-body">
      <strong class="home-srv-name">${esc(x.name)}</strong>
      <span class="home-srv-meta">
        <span class="srv-live ${state}"><span class="srv-dot"></span>${esc(label)}</span>
        ${x.players >= 0 ? `<span class="home-srv-players">${esc(t('srv.live.players', { n: x.players, max: x.max || '?' }))}</span>` : ''}
      </span>
      <span class="home-srv-tags">
        ${x.official ? `<span class="srv-chip srv-chip-official">${esc(t('srv.official.tag'))}</span>` : ''}
        ${x.boost ? `<span class="srv-chip home-srv-boost">${esc(t('home.servers.supporter'))}</span>` : ''}
        ${x.mode ? `<span class="srv-mode srv-mode-${esc(x.mode)}">${esc(t(`srv.modeName.${x.mode}`))}</span>` : ''}
        ${x.region ? `<span class="srv-chip">${esc(t(`events.reg.${x.region}`))}</span>` : ''}
      </span>
    </span>
  </a>`;
}

export function initHomeServers(root) {
  // o 1º elemento de pages/home.html é um <script>: procura na página inteira
  const box = (root.closest('.view') || document).querySelector('#home-servers');
  if (!box) return;
  const list = box.querySelector('[data-list]');
  list.innerHTML = `<p class="tier-muted">${esc(t('site.loading'))}</p>`;
  box.hidden = false;
  // sem await: a home continua carregando (feeds, notas) enquanto isto chega
  load().then((top) => {
    if (!box.isConnected) return;
    if (!top.length) { box.hidden = true; return; }
    list.innerHTML = top.map(card).join('');
  }).catch((e) => {
    console.warn('home servers', e);
    box.hidden = true;
  });
}
