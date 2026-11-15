// Marcadores do jogo no mapa interativo (assets/data/map-markers.json, lidos das fases .umap por tools/build_data.py).
// - Todos os ícones (cerca de 14 mil) são desenhados numa única camada <canvas>: leve mesmo com tudo ligado.
// - Filtros por categoria com caixas de seleção (locais, baús, recursos, cada animal e cada inimigo).
// - Busca por item, lugar, inimigo ou animal.
// - "Visitados": marque lugares por save (vários saves), guardados no navegador e na conta.
// Formato do ponto: [categoria, x, y, z, ...] com x/y em 0..1024 sobre o desenho do mapa.
import { t, pick } from '../i18n.js';
import { esc, normalize, loadData, loadIndex, L as Lbl } from '../data.js';

const SIZE = 1024;
const VISITED_KEY = 'soulmask-map-visited';
const FILTER_KEY = 'map_filters_v2';

// categorias de lugares/recursos: tamanho do ícone e se começa ligada
const CATS = {
  teleport: { size: 26, on: true, group: 'places' },
  tabletAncient: { size: 22, on: true, group: 'places' },
  tabletDivine: { size: 22, on: true, group: 'places' },
  pyramid: { size: 34, on: true, group: 'places' },
  dungeon: { size: 30, on: true, group: 'places' },
  ruinDungeon: { size: 26, on: true, group: 'places' },
  palace: { size: 26, on: true, group: 'places' },
  ruin: { size: 22, on: true, group: 'places' },
  bigRuin: { size: 24, on: true, group: 'places' },
  holyRuin: { size: 28, on: true, group: 'places' },
  mystRuin: { size: 24, on: true, group: 'places' },
  maskAltar: { size: 24, on: true, group: 'places' },
  tribe: { size: 26, on: true, group: 'places' },
  camp: { size: 22, on: true, group: 'places' },
  barrack: { size: 26, on: true, group: 'places' },
  fortress: { size: 30, on: true, group: 'places' },
  shipCamp: { size: 26, on: true, group: 'places' },
  lair: { size: 22, on: true, group: 'places' },
  beast: { size: 22, on: true, group: 'places' },
  bossAltar: { size: 30, on: true, group: 'places' },
  arena: { size: 28, on: true, group: 'places' },
  mineL: { size: 26, on: true, group: 'places' },
  mineM: { size: 22, on: true, group: 'places' },
  mineS: { size: 20, on: true, group: 'places' },
  cave: { size: 22, on: true, group: 'places' },
  island: { size: 30, on: true, group: 'places' },
  floatIsland: { size: 30, on: true, group: 'places' },
  respawn: { size: 20, on: true, group: 'places' },
  firefly: { size: 18, on: false, group: 'other' },
  iron: { size: 20, on: false, group: 'resources' },
  copper: { size: 20, on: false, group: 'resources' },
  tin: { size: 20, on: false, group: 'resources' },
  coal: { size: 20, on: false, group: 'resources' }
};
// baús e invasões são separados por tipo: "c:<nome do baú>" e "i:<tipo de invasão>"
const GROUPS = ['bosses', 'places', 'chests', 'resources', 'deposits', 'collectibles', 'animals', 'babies', 'enemies', 'mechanical', 'events', 'other'];
// inimigos nomeados que são chefes (reis, líderes de tribo, chefe exilado)
const BOSS_RE = /(^|[^a-zà-ú])(rei|l[ií]der|chefe|king|leader|boss|chief)([^a-zà-ú]|$)/i;
// inimigos mecânicos (núcleos, matadores etc.): grupo próprio no filtro
const MECH_RE = /mec[aâ]nic|mechanic|^(matador|slayer)\b|n[uú]cleo|\bcore\b/i;
const isMech = (l) => MECH_RE.test(l.pt || '') || MECH_RE.test(l.en || '');
// condições dos grupos de drop que dependem do modo de jogo ou do mapa (o resto vira aviso no grupo)
const MODE_COND = {
  IsNotSurvival: (s) => s.mode !== 'survival',
  IsPVP: (s) => s.mode === 'pvp',
  IsNotPVP: (s) => s.mode !== 'pvp',
  'PVP_1Day+': (s) => s.mode === 'pvp',
  'PVP_3Day+': (s) => s.mode === 'pvp',
  'PVP_7Day+': (s) => s.mode === 'pvp',
  IsActionMode: (s) => s.mode === 'warrior',
  IsManagementMode: (s) => s.mode === 'tribe',
  IsCreativeMode: (s) => s.mode === 'casual',
  Map_IsOnly_DLCLevel01_Main: (s) => s.map === 'dlc',
  Map_Is_Level01_Main: (s) => s.map === 'main'
};
const ORE = ['iron', 'copper', 'tin', 'coal'];
// locais que mostram os baús que existem por perto (com a chance de drop)
const NEAR_CATS = ['ruin', 'bigRuin', 'holyRuin', 'mystRuin', 'dungeon', 'ruinDungeon', 'palace', 'maskAltar', 'pyramid',
  'camp', 'barrack', 'fortress', 'shipCamp', 'lair', 'cave', 'island', 'floatIsland', 'bossAltar'];

const readJSON = (k, f) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? f; } catch (e) { return f; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ } };

const MODE_KEY = 'map_game_mode';

export async function initGameLayers(L, map, root, mapId = 'main', startQuery = '') {
  const panel = root.querySelector('#map-layers');
  const searchEl = root.querySelector('#map-search');
  const visitEl = root.querySelector('#map-visits');
  const modeEl = root.querySelector('#map-mode');
  let data; let creatures; let items; let bosses;
  try {
    [data, creatures, items, bosses] = await Promise.all([
      loadData('map-markers'), loadIndex('creatures'), loadIndex('items'), loadData('bosses').catch(() => [])
    ]);
  } catch (e) {
    panel.innerHTML = `<p class="map-hint">${esc(t('common.errorLoading', { msg: e.message }))}</p>`;
    return;
  }
  const m = data.maps[mapId] || data.maps.main;
  const [QX, QY, WSIZE] = m.world || [-408028, -408144, 816100];

  // ---------------------------------------------------------------- modo de jogo (multiplicadores de drop)
  const modes = data.modes || [];
  const modeState = readJSON(MODE_KEY, { mode: 'survival' });
  if (modeEl && modes.length) {
    modeEl.innerHTML = modes.map((md) => `<option value="${esc(md.id)}">${esc(t(`map.mode.${md.id}`))}</option>`).join('');
    modeEl.value = modes.some((md) => md.id === modeState.mode) ? modeState.mode : 'survival';
    modeEl.addEventListener('change', () => {
      modeState.mode = modeEl.value;
      writeJSON(MODE_KEY, modeState);
      map.closePopup();
      renderModeNote();
    });
  }
  // PvP só existe em servidor: usa a tabela de servidor dedicado; os outros modos usam a do jogo solo
  // (nos dados do jogo, só o PvP muda entre as duas: ×1 solo, ×1,5 servidor)
  const modeRates = () => {
    const md = modes.find((x) => x.id === modeState.mode) || modes[0] || {};
    return (md.id === 'pvp' ? md.server : md.solo) || {};
  };
  // tipo do ponto -> multiplicador de quantidade do modo atual
  function multOf(o) {
    const r = modeRates();
    if (o.creature) return r.DongWuShiTiDiaoLuoRatio ?? 1;
    if (o.npcBoss || (o.boss && !o.bag)) return r.BossRenDiaoLuoRatio ?? 1;
    if (o.k?.startsWith('e:') || o.k?.startsWith('m:')) return r.PuTongRenDiaoLuoRatio ?? 1;
    if (o.cat === 'chest' || o.cat === 'maskChest' || NEAR_CATS.includes(o.cat)) return r.BaoXiangDropRatio ?? 1;
    return 1;
  }
  function renderModeNote() {
    const el = root.querySelector('#map-mode-note');
    if (!el) return;
    const r = modeRates();
    const parts = [['chest', r.BaoXiangDropRatio], ['enemy', r.PuTongRenDiaoLuoRatio], ['boss', r.BossRenDiaoLuoRatio], ['animal', r.DongWuShiTiDiaoLuoRatio]]
      .map(([k, v]) => `${t(`map.modeRate.${k}`)} ×${Number(v ?? 1).toLocaleString()}`);
    el.textContent = parts.join(' · ');
  }
  renderModeNote();
  const bossById = new Map(bosses.map((b) => [b.id, b]));
  const lab = (i) => (i >= 0 && m.labels[i] ? Lbl(m.labels[i]) : '');
  const typeKey = (o) => (o.k.startsWith('a:') ? 'animal' : o.k.startsWith('e:') ? 'npc' : o.k.startsWith('n:') ? 'npcBoss'
    : o.k.startsWith('b:') ? 'worldBoss' : o.k.startsWith('m:') ? 'mech'
      : o.k.startsWith('c:') ? o.cat : o.k.startsWith('i:') ? 'invasion' : o.k.startsWith('y:') ? 'baby'
      : o.k.startsWith('f:') ? (o.fol?.g === 'collect' ? 'collect' : 'deposit') : o.k);

  // filhotes e ovos: nome e ícone vêm do animal (ovo -> animal adulto; Kurma -> animal comum)
  const babyBase = (id) => id.replace(/_Egg$/, '').replace(/^BP_Kurma_/, 'BP_DongWu_').replace(/_Child$/, '');
  const babyIcon = (id) => data.creatureIcons?.[id] || data.creatureIcons?.[babyBase(id)] || data.icons?.creature;
  const babyName = (id) => (data.babyNames?.[id] ? pick({ name_pt: data.babyNames[id].pt, name_en: data.babyNames[id].en }, 'name')
    : pick(creatures.get(id), 'name') || id);

  // ---------------------------------------------------------------- pontos normalizados
  // k = chave do filtro (categoria, "a:<criatura>" ou "e:<inimigo>"), icon = url do ícone do jogo
  const points = m.points.map((p, idx) => {
    const [cat, x, y, z] = p;
    const o = { idx, cat, x, y, z, raw: p };
    if (cat === 'creature') {
      o.k = `a:${p[4]}`; o.creature = p[4]; o.lo = p[5]; o.hi = p[6]; o.bag = p[7] || data.creatureBags?.[p[4]];
      // no mapa: bolinha azul; na janela e no painel: ícone do animal
      o.popIcon = data.creatureIcons?.[p[4]] || data.icons?.creature;
      o.icon = data.icons?.animalDot || o.popIcon; o.size = data.icons?.animalDot ? 14 : 22;
    } else if (cat === 'npc') {
      o.label = p[4]; o.lo = p[5]; o.hi = p[6]; o.bag = p[7];
      const l = m.labels[p[4]];
      // bolinhas: vermelha = chefe de tribo, verde = mecânico, amarela = inimigo
      if (l && BOSS_RE.test(`${l.pt} ${l.en}`)) { o.k = `n:${p[4]}`; o.icon = data.icons?.boss; o.size = 18; o.npcBoss = true; }
      else if (l && isMech(l)) { o.k = `m:${p[4]}`; o.icon = data.icons?.mech || data.icons?.npc; o.size = 14; o.mech = true; }
      else { o.k = `e:${p[4]}`; o.icon = data.icons?.npc; o.size = 14; }
    } else if (cat === 'fol') {
      // depósito de recurso ou coletável (vegetação do jogo): ícone do item que ele dá
      const ft = data.foliage?.[p[4]];
      if (!ft) return o;
      o.fol = ft; o.k = `f:${p[4]}`; o.bag = ft.bag;
      o.icon = items.get(ft.item)?.icon || data.icons?.ore; o.size = ft.g === 'collect' ? 24 : 18;
    } else if (cat === 'baby') {
      // filhote ou ovo: ícone do animal adulto
      o.k = `y:${p[4]}`; o.baby = p[4]; o.lo = p[5]; o.hi = p[6];
      o.icon = babyIcon(p[4]); o.size = 20;
    } else if (cat === 'invasion') {
      o.k = `i:${p[4] || 'base'}`; o.inv = p[4] || 'base'; o.lo = p[5]; o.hi = p[6];
      o.icon = data.icons?.invasion; o.size = 22;
    } else if (cat === 'chest' || cat === 'maskChest') {
      o.k = `c:${p[4]}`; o.label = p[4]; o.level = p[5]; o.bag = p[6]; o.boss = p[7];
      o.icon = data.icons?.chest; o.size = 20; // mesmo ícone para todos os baús
    } else if (cat === 'summon') {
      // altar de invocação dos chefes da DLC (Sobek, Escaravelho, Anúbis), ao lado da pirâmide deles
      o.boss = p[4]; o.k = `b:${p[4]}`; o.summon = true;
      o.icon = data.bossIcons?.[p[4]] || bossById.get(p[4])?.photo || data.icons?.boss; o.size = 38;
    } else if (cat === 'ore') {
      o.k = p[4]; o.icon = data.icons?.ore; o.size = CATS[p[4]]?.size || 20;
    } else {
      o.k = cat; o.label = p[4]; o.icon = data.icons?.[cat]; o.size = CATS[cat]?.size || 22;
      if (cat === 'pyramid') {
        o.boss = p[5];
        // filtro pelo chefe da pirâmide, mas no mapa fica o ícone de pirâmide, como no jogo
        if (o.boss && data.bossIcons?.[o.boss]) { o.k = `b:${o.boss}`; o.size = 30; }
      }
    }
    // id dos "visitados": baús e invasões mantêm o id antigo (categoria), para não perder o que já foi marcado
    const idKey = (cat === 'chest' || cat === 'maskChest' || cat === 'invasion') ? cat : o.k;
    o.id = `${mapId === 'main' ? '' : `${mapId}:`}${idKey}@${x},${y}`;
    return o;
  }).filter((o) => o.icon);

  // texto de busca de cada ponto: nome, tipo, criatura, chefe e os itens que pode dar
  const bagText = {};
  const itemName = (id) => { const it = items.get(id); return it ? `${it.name_pt} ${it.name_en}` : id; };
  Object.entries(data.bags || {}).forEach(([k, rows]) => { bagText[k] = rows.map((r) => itemName(r[0])).join(' '); });
  function hay(o) {
    if (o._hay !== undefined) return o._hay;
    const parts = [t(`map.game.${typeKey(o)}`)];
    if (o.label >= 0) parts.push(m.labels[o.label]?.pt, m.labels[o.label]?.en);
    if (o.creature) { const c = creatures.get(o.creature); if (c) parts.push(c.name_pt, c.name_en); }
    if (o.fol) parts.push(o.fol.name_pt, o.fol.name_en);
    if (o.baby) parts.push(babyName(o.baby));
    if (o.inv) parts.push(data.invasionTypes?.[o.inv]?.name_pt, data.invasionTypes?.[o.inv]?.name_en);
    if (o.bag) parts.push(bagText[o.bag]);
    if (o.boss) { const b = bossById.get(o.boss); if (b) parts.push(b.name_pt, b.name_en, ...(b.tiers || []).flatMap((ti) => [...(ti.summon || []).map((s) => itemName(s.ids[0])), ...(ti.drops || []).map((d) => itemName(d.id))])); }
    o._hay = normalize(parts.filter(Boolean).join(' '));
    return o._hay;
  }

  // ---------------------------------------------------------------- filtros
  const animals = {}; const enemies = {}; const bossKeys = {}; const mechs = {}; const fols = {};
  const chestKeys = {}; const chestMask = {}; const invKeys = {}; const babyKeys = {};
  points.forEach((o) => {
    if (o.k.startsWith('y:')) babyKeys[o.k] = (babyKeys[o.k] || 0) + 1;
    if (o.k.startsWith('c:')) { chestKeys[o.k] = (chestKeys[o.k] || 0) + 1; if (o.cat === 'maskChest') chestMask[o.k] = (chestMask[o.k] || 0) + 1; }
    if (o.k.startsWith('i:')) invKeys[o.k] = (invKeys[o.k] || 0) + 1;
    if (o.k.startsWith('a:')) animals[o.creature] = (animals[o.creature] || 0) + 1;
    if (o.k.startsWith('e:')) enemies[o.label] = (enemies[o.label] || 0) + 1;
    if (o.k.startsWith('m:')) mechs[o.label] = (mechs[o.label] || 0) + 1;
    if (o.k.startsWith('f:')) fols[o.k] = (fols[o.k] || 0) + 1;
    if (o.k.startsWith('b:') || o.k.startsWith('n:')) bossKeys[o.k] = (bossKeys[o.k] || 0) + 1;
  });
  const catCount = {};
  points.forEach((o) => { if (CATS[o.k]) catCount[o.k] = (catCount[o.k] || 0) + 1; });
  const saved = readJSON(FILTER_KEY, {});
  const on = {};
  Object.keys(CATS).forEach((k) => { on[k] = saved[k] ?? CATS[k].on; });
  Object.keys(animals).forEach((id) => { on[`a:${id}`] = saved[`a:${id}`] ?? false; });
  Object.keys(enemies).forEach((l) => { on[`e:${l}`] = saved[`e:${l}`] ?? false; });
  Object.keys(mechs).forEach((l) => { on[`m:${l}`] = saved[`m:${l}`] ?? false; });
  // coletáveis começam ligados (são poucos); depósitos de recurso desligados (são milhares)
  Object.keys(fols).forEach((k) => { on[k] = saved[k] ?? (data.foliage?.[k.slice(2)]?.g === 'collect'); });
  Object.keys(bossKeys).forEach((k) => { on[k] = saved[k] ?? true; });
  // tipo de baú que é, na maioria, baú de máscara: começa ligado (como antes); os outros e as invasões, desligados
  Object.keys(chestKeys).forEach((k) => { chestMask[k] = (chestMask[k] || 0) * 2 > chestKeys[k]; });
  Object.keys(chestKeys).forEach((k) => { on[k] = saved[k] ?? chestMask[k]; });
  Object.keys(invKeys).forEach((k) => { on[k] = saved[k] ?? false; });
  Object.keys(babyKeys).forEach((k) => { on[k] = saved[k] ?? false; });
  const regions = m.regions || [];
  on.regions = saved.regions ?? true;
  const saveFilters = () => writeJSON(FILTER_KEY, on);

  const creatureName = (id) => pick(creatures.get(id), 'name') || id;
  const enemyName = (l) => lab(Number(l)) || t('map.game.npc');
  function groupEntries(g) {
    if (g === 'bosses') {
      const world = Object.keys(bossKeys).filter((k) => k.startsWith('b:')).map((k) => {
        const b = bossById.get(k.slice(2));
        return { k, name: b ? pick(b, 'name') : k, n: bossKeys[k], icon: data.bossIcons?.[k.slice(2)] || b?.photo };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const named = Object.keys(bossKeys).filter((k) => k.startsWith('n:'))
        .map((k) => ({ k, name: enemyName(k.slice(2)), n: bossKeys[k], icon: data.icons?.boss }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [...world, ...named];
    }
    if (g === 'animals') {
      return Object.keys(animals).sort((a, b) => creatureName(a).localeCompare(creatureName(b)))
        .map((id) => ({ k: `a:${id}`, name: creatureName(id), n: animals[id], icon: data.creatureIcons?.[id] || data.icons?.creature }));
    }
    if (g === 'enemies') {
      return Object.keys(enemies).sort((a, b) => enemyName(a).localeCompare(enemyName(b)))
        .map((l) => ({ k: `e:${l}`, name: enemyName(l), n: enemies[l], icon: data.icons?.npc }));
    }
    if (g === 'mechanical') {
      return Object.keys(mechs).sort((a, b) => enemyName(a).localeCompare(enemyName(b)))
        .map((l) => ({ k: `m:${l}`, name: enemyName(l), n: mechs[l], icon: data.icons?.mech || data.icons?.npc }));
    }
    if (g === 'chests') {
      return Object.keys(chestKeys)
        .map((k) => ({ k, name: lab(Number(k.slice(2))) || t('map.game.chest'), n: chestKeys[k], icon: data.icons?.chest }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (g === 'babies') {
      return Object.keys(babyKeys)
        .map((k) => ({ k, name: babyName(k.slice(2)), n: babyKeys[k], icon: babyIcon(k.slice(2)) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (g === 'events') {
      return Object.keys(invKeys)
        .map((k) => ({ k, name: pick(data.invasionTypes?.[k.slice(2)], 'name') || t('map.game.invasion'), n: invKeys[k], icon: data.icons?.invasion }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (g === 'deposits' || g === 'collectibles') {
      const want = g === 'deposits' ? 'deposit' : 'collect';
      const list = Object.keys(fols).filter((k) => data.foliage?.[k.slice(2)]?.g === want)
        .map((k) => { const ft = data.foliage[k.slice(2)]; return { k, ft, name: pick(ft, 'name'), n: fols[k], icon: items.get(ft.item)?.icon || data.icons?.ore }; });
      // dois tipos com o mesmo nome no jogo (ex.: "Mina de Sal" e a de sal bruto): usa o nome do item que dão
      const seen = {};
      list.forEach((e) => { seen[e.name] = (seen[e.name] || 0) + 1; });
      list.forEach((e) => { if (seen[e.name] > 1 && items.get(e.ft.item)) e.name = pick(items.get(e.ft.item), 'name'); });
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    const list = Object.keys(CATS).filter((k) => CATS[k].group === g && catCount[k])
      .map((k) => ({ k, name: t(`map.game.${k}`), n: catCount[k], icon: data.icons?.[ORE.includes(k) ? 'ore' : k] }));
    // nomes das regiões (como no mapa do jogo: "Olho das Areias / (Cânion) / Nível 41–50")
    if (g === 'places' && regions.length) list.unshift({ k: 'regions', name: t('map.game.regions'), n: regions.length });
    return list;
  }
  const openGroups = new Set(readJSON('map_groups_open', ['places']));
  function renderPanel() {
    panel.innerHTML = GROUPS.map((g) => {
      const entries = groupEntries(g);
      if (!entries.length) return '';
      const nOn = entries.filter((e) => on[e.k]).length;
      return `
        <details class="map-group" data-group="${g}" ${openGroups.has(g) ? 'open' : ''}>
          <summary>
            <label class="map-check map-group-check" onclick="event.stopPropagation()">
              <input type="checkbox" data-group-all="${g}" ${nOn === entries.length ? 'checked' : ''} />
              <span>${esc(t(`map.group.${g}`))}</span>
            </label>
            <small>${nOn}/${entries.length}</small>
          </summary>
          <div class="map-group-list">${entries.map((e) => `
            <label class="map-check">
              <input type="checkbox" data-k="${esc(e.k)}" ${on[e.k] ? 'checked' : ''} />
              ${e.icon ? `<img src="${esc(e.icon)}" alt="" />` : ''}
              <span>${esc(e.name)}</span><small>${e.n}</small>
            </label>`).join('')}</div>
        </details>`;
    }).join('');
    // estado "indeterminado" das caixas de grupo
    panel.querySelectorAll('[data-group-all]').forEach((cb) => {
      const entries = groupEntries(cb.dataset.groupAll);
      const n = entries.filter((e) => on[e.k]).length;
      cb.indeterminate = n > 0 && n < entries.length;
    });
  }
  panel.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.dataset.groupAll) {
      groupEntries(cb.dataset.groupAll).forEach((en) => { on[en.k] = cb.checked; });
    } else if (cb.dataset.k) {
      on[cb.dataset.k] = cb.checked;
    } else return;
    saveFilters();
    renderPanel();
    layer.redraw();
  });
  panel.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-group]');
    if (!d) return;
    if (d.open) openGroups.add(d.dataset.group); else openGroups.delete(d.dataset.group);
    writeJSON('map_groups_open', [...openGroups]);
  }, true);

  // ---------------------------------------------------------------- visitados (por save)
  let visits = readJSON(VISITED_KEY, null);
  if (!visits || typeof visits !== 'object' || !visits.saves) visits = { current: 'Save 1', saves: { 'Save 1': [] } };
  let visited = new Set(visits.saves[visits.current] || []);
  let hideVisited = Boolean(visits.hide);
  const saveVisits = () => { visits.saves[visits.current] = [...visited]; visits.hide = hideVisited; writeJSON(VISITED_KEY, visits); };
  function renderVisits() {
    visitEl.innerHTML = `
      <div class="map-visit-row">
        <select class="map-input" data-visit-save aria-label="${esc(t('map.visitSave'))}">
          ${Object.keys(visits.saves).map((s) => `<option ${s === visits.current ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <button type="button" class="map-btn map-btn-sm" data-visit-act="new" title="${esc(t('map.visitNew'))}">${esc(t('map.visitNewShort'))}</button>
        <button type="button" class="map-btn map-btn-sm" data-visit-act="rename" title="${esc(t('map.visitRename'))}">${esc(t('map.visitRenameShort'))}</button>
        <button type="button" class="map-btn map-btn-sm" data-visit-act="delete" title="${esc(t('map.visitDelete'))}">&times;</button>
      </div>
      <label class="map-check"><input type="checkbox" data-visit-hide ${hideVisited ? 'checked' : ''} /> <span>${esc(t('map.visitHide'))}</span><small>${visited.size}</small></label>`;
  }
  visitEl.addEventListener('change', (e) => {
    if (e.target.matches('[data-visit-save]')) {
      saveVisits();
      visits.current = e.target.value;
      visited = new Set(visits.saves[visits.current] || []);
      saveVisits();
    }
    if (e.target.matches('[data-visit-hide]')) { hideVisited = e.target.checked; saveVisits(); }
    renderVisits();
    layer.redraw();
  });
  visitEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-visit-act]')?.dataset.visitAct;
    if (!act) return;
    if (act === 'new') {
      const name = (window.prompt(t('map.visitNewPrompt'), `Save ${Object.keys(visits.saves).length + 1}`) || '').trim().slice(0, 40);
      if (!name || visits.saves[name]) return;
      saveVisits();
      visits.saves[name] = [];
      visits.current = name;
      visited = new Set();
    } else if (act === 'rename') {
      const name = (window.prompt(t('map.visitRenamePrompt'), visits.current) || '').trim().slice(0, 40);
      if (!name || name === visits.current || visits.saves[name]) return;
      visits.saves[name] = visits.saves[visits.current];
      delete visits.saves[visits.current];
      visits.current = name;
    } else if (act === 'delete') {
      if (Object.keys(visits.saves).length < 2 || !window.confirm(t('map.visitDeleteConfirm', { name: visits.current }))) return;
      delete visits.saves[visits.current];
      visits.current = Object.keys(visits.saves)[0];
      visited = new Set(visits.saves[visits.current]);
    }
    saveVisits();
    renderVisits();
    layer.redraw();
  });

  // ---------------------------------------------------------------- busca
  let query = '';
  let nameOnly = false;   // busca vinda da URL: só pelo nome do ponto (não pelos itens que ele dá)
  searchEl.addEventListener('input', () => {
    query = normalize(searchEl.value.trim());
    nameOnly = false;
    layer.redraw();
  });
  const nameHay = (o) => normalize([
    o.label >= 0 ? m.labels[o.label]?.pt : '', o.label >= 0 ? m.labels[o.label]?.en : '',
    o.creature ? creatures.get(o.creature)?.name_pt : '', o.creature ? creatures.get(o.creature)?.name_en : '',
    o.fol?.name_pt, o.fol?.name_en, o.baby ? babyName(o.baby) : '',
    o.boss ? bossById.get(o.boss)?.name_pt : '', o.boss ? bossById.get(o.boss)?.name_en : '',
    ORE.includes(o.k) ? t('src.veinOf', { name: t(`map.game.${o.k}`) }) : ''
  ].filter(Boolean).join(' '));
  const matches = (o) => (nameOnly ? nameHay(o).includes(query) : hay(o).includes(query));

  const isVisible = (o) => (query.length >= 2 ? matches(o) : on[o.k])
    && !(hideVisited && visited.has(o.id));

  // ---------------------------------------------------------------- camada de ícones (canvas)
  const images = {};
  function img(url) {
    if (!images[url]) {
      images[url] = new Image();
      images[url].onload = () => layer.redraw();
      images[url].src = url;
    }
    return images[url];
  }
  let drawn = [];
  const IconLayer = L.Layer.extend({
    onAdd(mp) {
      this._canvas = L.DomUtil.create('canvas', 'map-icon-layer');
      mp.getPanes().overlayPane.appendChild(this._canvas);
      mp.on('moveend zoomend resize', this.redraw, this);
      mp.on('zoomstart', this._hide, this);
      this.redraw();
    },
    onRemove(mp) {
      L.DomUtil.remove(this._canvas);
      mp.off('moveend zoomend resize', this.redraw, this);
      mp.off('zoomstart', this._hide, this);
    },
    _hide() { if (this._canvas) this._canvas.style.visibility = 'hidden'; },
    redraw() {
      if (!this._map || !this._canvas) return;
      const mp = this._map;
      const size = mp.getSize();
      const dpr = window.devicePixelRatio || 1;
      const cv = this._canvas;
      cv.style.visibility = 'visible';
      L.DomUtil.setPosition(cv, mp.containerPointToLayerPoint([0, 0]));
      cv.width = size.x * dpr;
      cv.height = size.y * dpr;
      cv.style.width = `${size.x}px`;
      cv.style.height = `${size.y}px`;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const zoomScale = Math.max(0.7, Math.min(1.6, 1 + mp.getZoom() * 0.2));
      drawn = [];
      const searching = query.length >= 2;
      points.forEach((o) => {
        if (!isVisible(o)) return;
        const pt = mp.latLngToContainerPoint([SIZE - o.y, o.x]);
        const s = o.size * zoomScale * (searching ? 1.15 : 1);
        if (pt.x < -s || pt.y < -s || pt.x > size.x + s || pt.y > size.y + s) return;
        const im = img(o.icon);
        if (!im.complete || !im.naturalWidth) return;
        ctx.globalAlpha = visited.has(o.id) ? 0.35 : 1;
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 4;
        ctx.drawImage(im, pt.x - s / 2, pt.y - s / 2, s, s);
        drawn.push({ o, x: pt.x, y: pt.y, r: s / 2 + 3 });
      });
      // nomes das regiões por cima dos ícones, no estilo do mapa do jogo (texto claro com contorno escuro)
      if (on.regions && !searching) {
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const z = mp.getZoom();
        // mapa afastado: só o nome, menor; aproximado: nome, tipo e nível
        const full = z >= 0.5;
        const big = full ? Math.min(26, 15 * (1 + (z - 0.5) * 0.3)) : 10;
        const small = Math.max(9, big * 0.62);
        regions.forEach((r) => {
          const pt = mp.latLngToContainerPoint([SIZE - r.y, r.x]);
          if (pt.x < -200 || pt.y < -60 || pt.x > size.x + 200 || pt.y > size.y + 60) return;
          const lines = [[Lbl(r.name), `600 ${big}px Cinzel, serif`, '#F3EFE8', big]];
          if (full && r.type) lines.push([`(${Lbl(r.type)})`, `${small}px Spectral, serif`, '#e6dccb', small]);
          if (full && r.lv) lines.push([t('map.regionLevel', { lv: r.lv }), `${small}px Spectral, serif`, '#e6dccb', small]);
          const total = lines.reduce((a, l) => a + l[3] * 1.15, 0);
          let y = pt.y - total / 2;
          lines.forEach(([txt, font, color, h]) => {
            y += (h * 1.15) / 2;
            ctx.font = font;
            ctx.lineWidth = Math.max(2.5, h * 0.22);
            ctx.strokeStyle = 'rgba(10, 9, 8, 0.9)';
            ctx.strokeText(txt, pt.x, y);
            ctx.fillStyle = color;
            ctx.fillText(txt, pt.x, y);
            y += (h * 1.15) / 2;
          });
        });
      }
    }
  });
  const layer = new IconLayer();
  layer.addTo(map);

  // aberto com #mapa?q=<nome> (ex.: vindo da Bancada de trabalho): busca e enquadra o que achou
  if (startQuery) {
    searchEl.value = startQuery;
    query = normalize(startQuery.trim());
    nameOnly = true;
    const hits = points.filter((o) => query.length >= 2 && matches(o));
    if (hits.length) {
      const ys = hits.map((o) => SIZE - o.y); const xs = hits.map((o) => o.x);
      map.fitBounds([[Math.min(...ys) - 8, Math.min(...xs) - 8], [Math.max(...ys) + 8, Math.max(...xs) + 8]], { maxZoom: 2, animate: false });
    }
    layer.redraw();
  }

  // coordenadas do jogo onde o mouse está (mesma escala do "X / Y" das janelas e do gm go)
  if (map._coordCtl) map.removeControl(map._coordCtl);
  const CoordCtl = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'map-coords-hover');
      div.setAttribute('aria-hidden', 'true');
      div.hidden = true;
      return div;
    }
  });
  map._coordCtl = new CoordCtl({ position: 'bottomleft' });
  map._coordCtl.addTo(map);
  const coordEl = map._coordCtl.getContainer();
  if (map._coordMove) map.off('mousemove', map._coordMove);
  if (map._coordOut) map.off('mouseout', map._coordOut);
  map._coordMove = (e) => {
    const x = e.latlng.lng; const y = SIZE - e.latlng.lat;
    if (x < 0 || y < 0 || x > SIZE || y > SIZE) { coordEl.hidden = true; return; }
    const wx = Math.round(((x / SIZE) * WSIZE + QX) / 100);
    const wy = Math.round(((y / SIZE) * WSIZE + QY) / 100);
    coordEl.textContent = `X ${wx}   Y ${wy}`;
    coordEl.hidden = false;
  };
  map._coordOut = () => { coordEl.hidden = true; };
  map.on('mousemove', map._coordMove);
  map.on('mouseout', map._coordOut);

  // clique num ícone: abre a janela de informações (o mais próximo do clique)
  map.on('click', (e) => {
    if (root.querySelector('#map-add')?.getAttribute('aria-pressed') === 'true') return;
    const p = e.containerPoint;
    let best = null; let bd = Infinity;
    drawn.forEach((d) => {
      const dist = (d.x - p.x) ** 2 + (d.y - p.y) ** 2;
      // ícones sobrepostos: vale o maior (ex.: a pirâmide antes do baú dela), depois o mais próximo
      const score = dist - d.o.size * 40;
      if (dist <= d.r * d.r && score < bd) { best = d; bd = score; }
    });
    if (!best) return;
    const o = best.o;
    L.popup({ maxWidth: 380, minWidth: 300, maxHeight: Math.max(260, map.getSize().y - 120), className: 'map-info-popup', autoPanPaddingTopLeft: [16, 40], autoPanPaddingBottomRight: [16, 16] })
      .setLatLng([SIZE - o.y, o.x]).setContent(popupHtml(o)).openOn(map);
  });
  map.getContainer().addEventListener('mousemove', (e) => {
    const r = map.getContainer().getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    const hit = drawn.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 <= d.r * d.r);
    map.getContainer().classList.toggle('map-hover-icon', hit);
  });

  // ---------------------------------------------------------------- janela de informações (visual próprio do site)
  const fmtPct = (v) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  const qty = (lo, hi) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
  const fmtTime = (s) => (s >= 3600 ? `${Math.round((s / 3600) * 10) / 10} h` : `${Math.round(s / 60)} min`);
  const itemOf = (id) => items.get(id);
  // "espaço de inventário": ícone + quantidade, nome embaixo
  function slots(list) {
    return `<div class="mp-slots">${list.map(({ id, n }) => {
      const it = itemOf(id);
      const name = it ? pick(it, 'name') : id;
      return `<a class="mp-slot" href="#itens?item=${encodeURIComponent(id)}" title="${esc(name)}">
        <span class="mp-slot-box">${it?.icon ? `<img src="${esc(it.icon)}" alt="" />` : ''}<b>×${esc(n)}</b></span>
        <span class="mp-slot-name">${esc(name)}</span></a>`;
    }).join('')}</div>`;
  }
  // recompensa: barra de chance + ícone + nome + quantidade
  // mult = multiplicador de quantidade do modo de jogo (a chance não muda com o modo)
  function rewardRows(rows, mult = 1) {
    if (!rows.length) return '';
    const scale = (n) => Math.max(n ? 1 : 0, Math.round(n * mult));
    return `<ul class="mp-drops">
      <li class="mp-drops-head"><span></span><span>${esc(t('map.colItem'))}</span><span>${esc(t('map.colChance'))} · ${esc(t('map.colQty'))}</span></li>
      ${rows.map((r) => {
    const it = itemOf(r.id);
    const name = it ? pick(it, 'name') : r.id;
    const total = r.total ?? r.chance;
    return `<li>
        <span class="mp-drop-icon">${it?.icon ? `<img src="${esc(it.icon)}" alt="" />` : ''}</span>
        <span class="mp-drop-main">
          <a href="#itens?item=${encodeURIComponent(r.id)}">${esc(name)}</a>
          <span class="mp-bar" title="${esc(t('map.chanceTitle', { p: fmtPct(total) }))}"><i style="width:${Math.max(3, Math.min(100, total))}%"></i></span>
        </span>
        <span class="mp-drop-side"><strong title="${esc(t('map.chanceTitle', { p: fmtPct(total) }))}">${esc(fmtPct(total))}</strong><small>×${esc(qty(scale(r.lo), scale(r.hi)))}</small>${r.detail ? `<em title="${esc(t('map.chanceDetail'))}">${esc(r.detail)}</em>` : ''}</span>
      </li>`;
  }).join('')}</ul>
      ${mult !== 1 ? `<p class="mp-mode-note">${esc(t('map.modeApplied', { m: Number(mult).toLocaleString(), mode: t(`map.mode.${modeState.mode}`) }))}</p>` : ''}`;
  }
  // tabela de drop agrupada como no jogo: 1ª coluna = chance do grupo (o jogo sorteia cada grupo),
  // 2ª = chance do item dentro do grupo, depois quantidade e o item.
  // rows: [item, mín, máx, chance do grupo, chance no grupo, chave do grupo]
  // condição do grupo ("A&B|C"): as de modo/mapa decidem se o grupo cai; as outras viram aviso
  const condState = () => ({ mode: modeState.mode, map: mapId });
  function condOk(cond) {
    if (!cond) return true;
    const s = condState();
    return cond.split('&').every((block) => block.split('|').some((tk) => (MODE_COND[tk] ? MODE_COND[tk](s) : true)));
  }
  function condNote(cond) {
    if (!cond) return '';
    const notes = cond.split('&').map((block) => block.split('|')
      .filter((tk) => !MODE_COND[tk] || /^PVP_\dDay\+$/.test(tk))
      .map((tk) => t(`map.cond.${tk}`) === `map.cond.${tk}` ? t('map.cond.other') : t(`map.cond.${tk}`))
      .join(` ${t('map.cond.or')} `)).filter(Boolean);
    return notes.join(' · ');
  }
  function groupTable(rows, mult = 1) {
    if (!rows?.length) return '';
    const hidden = rows.filter((r) => !condOk(r[6])).length;
    rows = rows.filter((r) => condOk(r[6]));
    if (!rows.length) return `<p class="mp-gt-hint">${esc(t('map.condNoneInMode'))}</p>`;
    const scale = (n) => Math.max(n ? 1 : 0, Math.round(n * mult));
    const groups = new Map();
    rows.forEach((r, i) => {
      const key = r[5] ?? `x${i}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const body = [...groups.values()].map((list) => {
      const note = condNote(list[0][6]);
      return (note ? `<tr class="mp-gt-cond"><td colspan="4">${esc(t('map.cond.only'))} ${esc(note)}</td></tr>` : '') + list.map((r, i) => {
        const it = itemOf(r[0]);
        const name = it ? pick(it, 'name') : r[0];
        const total = (r[3] * r[4]) / 100;
        return `<tr class="${i === 0 ? 'mp-gt-first' : ''}">
        ${i === 0 ? `<td class="mp-gt-g" rowspan="${list.length}">${esc(fmtPct(r[3]))}</td>` : ''}
        <td class="mp-gt-p" title="${esc(t('map.chanceTitle', { p: fmtPct(total) }))}">${esc(fmtPct(r[4]))}</td>
        <td class="mp-gt-q">${esc(qty(scale(r[1]), scale(r[2])))}</td>
        <td class="mp-gt-i"><a href="#itens?item=${encodeURIComponent(r[0])}">${it?.icon ? `<img src="${esc(it.icon)}" alt="" />` : ''}<span>${esc(name)}</span></a></td>
      </tr>`;
      }).join('');
    }).join('');
    return `<table class="mp-gt">
      <thead><tr><th>${esc(t('map.colGroup'))}</th><th>${esc(t('map.colChance'))}</th><th>${esc(t('map.colQty'))}</th><th>${esc(t('map.colItem'))}</th></tr></thead>
      <tbody>${body}</tbody></table>
      <p class="mp-gt-hint">${esc(t('map.groupHint'))}${hidden ? ` ${esc(t('map.condHidden', { n: hidden, mode: t(`map.mode.${modeState.mode}`) }))}` : ''}</p>
      ${mult !== 1 ? `<p class="mp-mode-note">${esc(t('map.modeApplied', { m: Number(mult).toLocaleString(), mode: t(`map.mode.${modeState.mode}`) }))}</p>` : ''}`;
  }

  const dropRows = (list) => (list || []).map((d) => ({ id: d.id, lo: d.n[0], hi: d.n[1], total: d.chance }));
  const block = (title, html) => (html ? `<section class="mp-block"><h4>${esc(title)}</h4><div class="mp-scroll">${html}</div></section>` : '');

  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  function bossBlock(b, tierIdx) {
    const tier = b.tiers?.[tierIdx] || b.tiers?.[0];
    if (!tier) return '';
    const chips = [tier.level ? `${t('common.level')} ${tier.level}` : '', tier.exp ? `EXP ${tier.exp}` : ''].filter(Boolean);
    return `
      ${b.tiers.length > 1 ? `<div class="mp-tiers" role="tablist">${b.tiers.map((ti, i) => `<button type="button" role="tab" class="mp-tier" data-tier="${i}" aria-selected="${i === tierIdx}" title="${esc(pick(ti, 'name'))}"><span>${ROMAN[i] || i + 1}</span></button>`).join('')}</div>` : ''}
      <div class="mp-hero">
        ${b.photo ? `<img src="${esc(b.photo)}" alt="" />` : ''}
        <div><strong>${esc(pick(tier, 'name'))}</strong><div class="mp-chips">${chips.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>
      </div>
      ${tier.summon?.length ? block(t('map.summon'), slots(tier.summon.map((s) => ({ id: s.ids[0], n: s.n })))) : ''}
      ${block(t('map.rewards'), tier.groups?.length
    ? groupTable(tier.groups, modeRates().BossRenDiaoLuoRatio ?? 1)
    : rewardRows(dropRows([...(tier.drops || []), ...(tier.final || [])]), modeRates().BossRenDiaoLuoRatio ?? 1))}`;
  }
  function locFooter(o) {
    const wx = Math.round((o.x / SIZE) * WSIZE + QX);
    const wy = Math.round((o.y / SIZE) * WSIZE + QY);
    const cmd = `gm go ${wx} ${wy} ${o.z + 100}`;
    return `<footer class="mp-foot">
      <div class="mp-coords"><span>X ${Math.round(wx / 100)}</span><span>Y ${Math.round(wy / 100)}</span>
        <button type="button" class="map-btn map-btn-sm" data-copy="${esc(cmd)}" title="${esc(cmd)}">${esc(t('map.copyGm'))}</button></div>
      <label class="mp-switch"><input type="checkbox" data-visit-id="${esc(o.id)}" ${visited.has(o.id) ? 'checked' : ''} /><i></i><span>${esc(t('map.visited'))} · ${esc(visits.current)}</span></label>
    </footer>`;
  }
  const near = (o, r = 9) => points.filter((q) => (q.cat === 'chest' || q.cat === 'maskChest') && (q.x - o.x) ** 2 + (q.y - o.y) ** 2 <= r * r);

  function popupHtml(o, tierIdx = 0) {
    const typeName = t(`map.game.${typeKey(o)}`);
    let title = typeName;
    let sub = '';
    let body = '';
    let tone = 'place';
    const lv = o.lo ? `${t('common.level')} ${o.lo}${o.hi && o.hi !== o.lo ? `–${o.hi}` : ''}` : '';
    if (o.creature) {
      const c = creatures.get(o.creature);
      title = creatureName(o.creature);
      sub = [typeName, lv].filter(Boolean).join(' · ');
      tone = 'animal';
      if (c?.photo) body = `<div class="mp-hero mp-hero-solo"><img src="${esc(c.photo)}" alt="" /></div>`;
      body += block(t('map.harvest'), groupTable(data.bags?.[o.bag], multOf(o)));
      if (c) body += `<a class="mp-link" href="#criaturas?q=${encodeURIComponent(title)}">${esc(t('map.seeCreature'))}</a>`;
    } else if (o.fol) {
      title = pick(o.fol, 'name');
      sub = typeName;
      tone = o.fol.g === 'collect' ? 'chest' : 'ore';
      const chips = [o.fol.tool ? t('map.toolTier', { n: o.fol.tool }) : '', o.fol.respawn ? t('map.respawn', { t: fmtTime(o.fol.respawn) }) : ''].filter(Boolean);
      body = (chips.length ? `<div class="mp-chips mp-chips-pad">${chips.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '')
        + block(t(o.fol.g === 'collect' ? 'map.rewards' : 'map.harvest'), groupTable(data.bags?.[o.bag], o.fol.g === 'deposit' ? (modeRates().CaiKuangDiaoLuoRatio ?? 1) : 1));
    } else if (o.baby) {
      title = babyName(o.baby);
      sub = [typeName, lv].filter(Boolean).join(' · ');
      tone = 'animal';
      const c = creatures.get(o.baby) || creatures.get(babyBase(o.baby));
      body = `<p class="mp-note">${esc(t(/_Egg$/.test(o.baby) ? 'map.eggHint' : 'map.babyHint'))}</p>`
        + (c ? `<a class="mp-link" href="#criaturas?q=${encodeURIComponent(pick(c, 'name'))}">${esc(t('map.seeCreature'))}</a>` : '');
    } else if (o.inv) {
      const it = data.invasionTypes?.[o.inv];
      title = pick(it, 'name') || typeName;
      sub = [typeName, lv].filter(Boolean).join(' · ');
      tone = 'boss';
      body = `<p class="mp-note">${esc(t(o.inv === 'base' ? 'map.baseRaidHint' : 'map.squadHint'))}</p>`
        + (o.inv === 'base' || it?.sched ? `<a class="mp-link" href="#eventos">${esc(t('map.seeEvents'))}</a>` : '');
    } else if (o.k.startsWith('e:') || o.k.startsWith('n:') || o.k.startsWith('m:')) {
      title = enemyName(o.label);
      sub = [typeName, lv].filter(Boolean).join(' · ');
      tone = o.npcBoss ? 'boss' : 'enemy';
      body = block(t('map.drops'), groupTable(data.bags?.[o.bag], multOf(o)));
    } else if (o.boss && bossById.get(o.boss)) {
      const b = bossById.get(o.boss);
      title = pick(b, 'name');
      sub = o.k.startsWith('b:') ? t('map.pyramidSub') : typeName;
      tone = 'boss';
      body = bossBlock(b, tierIdx) + (o.bag ? block(t('map.chestLoot'), groupTable(data.bags[o.bag], modeRates().BaoXiangDropRatio ?? 1)) : '');
    } else if (o.cat === 'chest' || o.cat === 'maskChest') {
      title = lab(o.label) || typeName;
      sub = [typeName, o.level ? `${t('common.level')} ${o.level}` : ''].filter(Boolean).join(' · ');
      tone = 'chest';
      body = block(t('map.rewards'), groupTable(data.bags?.[o.bag], multOf(o)));
    } else if (NEAR_CATS.includes(o.cat)) {
      title = lab(o.label) || typeName;
      sub = typeName;
      const ch = near(o);
      if (ch.length) {
        const lvls = ch.map((q) => q.level).filter(Boolean);
        sub += ` · ${t('map.chestsNear', { n: ch.length })}${lvls.length ? ` · ${t('common.level')} ${Math.min(...lvls)}–${Math.max(...lvls)}` : ''}`;
        // baús diferentes por perto: cada bolsa entra uma vez, com os grupos dela
        const bags = [...new Set(ch.map((q) => q.bag).filter((b) => data.bags?.[b]))];
        const rows = bags.flatMap((bg) => data.bags[bg].map((r) => [...r.slice(0, 5), `${bg}:${r[5]}`]));
        body = block(t('map.rewardsNear'), groupTable(rows, multOf(o)));
      }
    } else {
      title = lab(o.label) || typeName;
      sub = typeName === title ? '' : typeName;
      if (ORE.includes(o.k)) { title = typeName; sub = t('map.oreVein'); tone = 'ore'; }
    }
    return `<div class="mp mp-tone-${tone}" data-point="${o.idx}">
      <header class="mp-head">
        <span class="mp-diamond">${o.popIcon || o.icon ? `<img src="${esc(o.popIcon || o.icon)}" alt="" />` : ''}</span>
        <div><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      </header>
      ${body}
      ${locFooter(o)}
    </div>`;
  }
  // ações dentro da janela: trocar chefe 1/2/3, copiar comando, marcar visitado
  map.getContainer().addEventListener('click', async (e) => {
    const box = e.target.closest('.mp');
    if (!box) return;
    const o = points.find((p) => p.idx === Number(box.dataset.point));
    const tab = e.target.closest('[data-tier]');
    if (tab && o) { box.outerHTML = popupHtml(o, Number(tab.dataset.tier)); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); } catch (err) { /* ignora */ }
      cp.textContent = t('map.copied');
      setTimeout(() => { if (cp.isConnected) cp.textContent = t('map.copyGm'); }, 1500);
    }
  });
  map.getContainer().addEventListener('change', (e) => {
    const cb = e.target.closest('[data-visit-id]');
    if (!cb) return;
    if (cb.checked) visited.add(cb.dataset.visitId); else visited.delete(cb.dataset.visitId);
    saveVisits();
    renderVisits();
    layer.redraw();
  });

  renderPanel();
  renderVisits();
}
