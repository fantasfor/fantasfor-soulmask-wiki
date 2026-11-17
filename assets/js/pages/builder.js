// Builder Maker: monta builds com talentos, armadura, armas, máscara e alimentos
// usando os dados oficiais do jogo. Salva no navegador, gera link e exporta para o GDMbot.
import { t, pick } from '../i18n.js';
import {
  loadData, loadIndex, esc, escLines, normalize, statList, statParts, fmtNum, fmtDuration, iconImg, qualityClass, L
} from '../data.js';
import { bonusHtml, SLOTS } from './armors.js';
import { TALENT_COLORS } from './talents.js';

// tipos de talento aceitos em cada grupo de slot (abas do seletor)
const GROUP_TYPES = {
  tribe: ['tribe'],
  title: ['title'],
  positive: ['positive', 'preference', 'origin', 'personality', 'negative']
};

const STORAGE_KEY = 'soulmask_builder_builds_v3';
const OLD_STORAGE_KEY = 'soulmask_builder_builds_v2';
const DRAFT_KEY = 'soulmask_builder_draft_v3';
const MAX_TALENT_SLOTS = 8;
const MAX_WEAPONS = 6;
const POSITIVE_START = 2;
const FOOD_SLOTS = ['staple', 'drink', 'meat', 'veg', 'recreational', 'other', 'other'];
const FOOD_LABELS = { staple: 'builder.food.staple', drink: 'builder.food.drink', meat: 'builder.food.meat', veg: 'builder.food.veg', recreational: 'builder.food.recreational', other: 'builder.food.other' };
const SLOT_LABELS = { armor: 'builder.slot.armor', gloves: 'builder.slot.gloves', pants: 'builder.slot.pants', boots: 'builder.slot.boots', necklace: 'builder.slot.necklace', ring: 'builder.slot.ring' };
const OLD_ARMOR_ORDER = ['armor', 'gloves', 'pants', 'boots', 'necklace', 'ring'];

// As armas de cada classe vêm do jogo (meta.classes, tabelas SLD_ChuShiLv_*):
// nelas a proficiência chega a 120; nas demais, 100.
const CLASS_WEAPON_ORDER = ['dao', 'shuangdao', 'jian', 'chui', 'mao', 'gong', 'dun', 'quantao', 'bian'];

function emptyBuild() {
  return {
    id: null,
    name: '',
    description: '',
    tribe: '',
    talents: Array(MAX_TALENT_SLOTS).fill(null),
    optionalGroups: [],
    armor: {},
    quality: 0,
    foods: Array(FOOD_SLOTS.length).fill(null),
    weapons: [null, null],
    mask: null,
    talentExportLevel: 'max'
  };
}

// ------------------------------------------------------------------ link compartilhável
// (exportadas: usadas também pela aba Comunidade, pages/builder-community.js)
export function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function compact(b) {
  return {
    n: b.name || undefined,
    d: b.description || undefined,
    c: b.tribe || undefined,
    t: b.talents,
    o: b.optionalGroups.length ? b.optionalGroups : undefined,
    a: b.armor,
    q: b.quality || undefined,
    f: b.foods,
    w: b.weapons,
    m: b.mask || undefined,
    l: b.talentExportLevel !== 'max' ? b.talentExportLevel : undefined
  };
}

function expand(c) {
  const b = emptyBuild();
  b.name = c.n || '';
  b.description = c.d || '';
  b.tribe = c.c || '';
  b.talents = Array.isArray(c.t) ? c.t : b.talents;
  b.optionalGroups = Array.isArray(c.o) ? c.o : [];
  b.armor = c.a && typeof c.a === 'object' ? c.a : {};
  b.quality = Number(c.q) || 0;
  b.foods = Array.isArray(c.f) ? c.f : b.foods;
  b.weapons = Array.isArray(c.w) ? c.w : b.weapons;
  b.mask = c.m || null;
  b.talentExportLevel = c.l || 'max';
  return b;
}

// ------------------------------------------------------------------ página
export async function initBuilderPage(root, params) {
  const $ = (sel) => root.querySelector(sel);
  const el = {
    grid: $('#talentSelectorGrid'),
    modal: $('#talentPickerModal'),
    pickSearch: $('#talentPickerSearch'),
    pickList: $('#talentPickerList'),
    pickPreview: $('#talentPickerPreview'),
    armorSlots: $('#armorSlots'),
    armorPicker: $('#armorPickerInline'),
    foodSlots: $('#foodCategorySlots'),
    foodPicker: $('#foodPickerInline'),
    gearRow: $('#builderGearRow'),
    gearPicker: $('#gearPickerInline'),
    classWeapons: $('#classWeaponsList'),
    name: $('#buildName'),
    desc: $('#buildDescription'),
    tribe: $('#buildTribe'),
    quality: $('#gearQuality'),
    hName: $('#builderHeaderName'),
    hClass: $('#builderHeaderClass'),
    hMaster: $('#builderHeaderMaster'),
    hTribe: $('#builderHeaderTribe'),
    hTitle: $('#builderHeaderTitle'),
    saved: $('#savedBuildsSelect'),
    savedDel: $('#savedBuildDelete'),
    totals: $('#buildTotals'),
    importInput: $('#buildImportInput'),
    status: $('#buildSaveStatus'),
    expLevel: $('#talentExportLevel'),
    expCode: $('#talentExportCode'),
    expStatus: $('#talentExportStatus'),
    expPreview: $('#talentExportPreview')
  };

  let talents; let pieces; let sets; let foodsIdx; let weaponsIdx; let masksIdx; let meta; let legacy;
  try {
    [talents, pieces, sets, foodsIdx, weaponsIdx, masksIdx, meta, legacy] = await Promise.all([
      loadData('talents'), loadIndex('armor-pieces'), loadIndex('armor-sets'), loadIndex('foods'),
      loadIndex('weapons'), loadIndex('masks'), loadData('meta'), loadData('legacy-ids').catch(() => ({}))
    ]);
  } catch (e) {
    el.grid.innerHTML = `<div class="empty-state">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const talentIdx = new Map(talents.map((x) => [x.id, x]));
  const qualityName = (q) => L(meta.qualities?.[q]) || t('builder.qualityN', { n: q });
  const typeLabel = {};
  talents.forEach((x) => { if (!typeLabel[x.type]) typeLabel[x.type] = x; });
  // armaduras do Builder: só os conjuntos avançados (2xxx) e de Dungeon/ruínas (3xxx), uma peça de cada por slot
  const builderSets = [...sets.values()].filter((s) => Number(s.id) >= 2000).sort((a, b) => Number(a.id) - Number(b.id));
  const piecesBySlot = {};
  SLOTS.forEach((s) => {
    piecesBySlot[s] = builderSets.map((set) => pieces.get(set.pieces?.[s])).filter(Boolean);
  });
  // classes e tribos (rótulos oficiais em inglês servem de chave de comparação)
  const classLabels = new Set(Object.values(meta.classes || {}).map((c) => c.en));
  const classWeapons = (cls) => new Set(meta.classes?.[cls]?.weapons || []);
  // só as versões aprimoradas (uma por tipo; o arco tem 4 variações no jogo)
  const enhancedWeapons = [...weaponsIdx.values()].filter((w) => w.enhanced);
  // ícone de cada tipo de arma: a versão aprimorada
  const typeIcon = {};
  enhancedWeapons.forEach((w) => {
    if (w.wtype && w.icon && !typeIcon[w.wtype]) typeIcon[w.wtype] = { icon: w.icon };
  });

  let state = emptyBuild();
  let savedBuilds = [];
  let pickerSlot = null;
  let previewId = null;
  let talentSearch = '';
  let talentTab = null;

  // ---------------------------------------------------------------- migração de builds antigas
  function migrateOld(b) {
    const nb = emptyBuild();
    nb.id = b.id || null;
    nb.name = b.name || '';
    nb.description = b.description || '';
    nb.tribe = b.tribe || '';
    const lt = legacy.talent || {};
    const la = legacy.armor || {};
    const lf = legacy.food || {};
    const oldT = Array.isArray(b.selectedPositive) ? b.selectedPositive : [];
    nb.talents = Array.from({ length: Math.max(MAX_TALENT_SLOTS, oldT.length) }, (_, i) => lt[oldT[i]] || null);
    nb.optionalGroups = Array.isArray(b.optionalTalentGroups) ? b.optionalTalentGroups : [];
    (b.selectedArmorPieces || []).forEach((id, i) => {
      const nid = la[String(id)];
      if (nid && OLD_ARMOR_ORDER[i]) nb.armor[OLD_ARMOR_ORDER[i]] = nid;
    });
    nb.foods = Array.from({ length: FOOD_SLOTS.length }, (_, i) => lf[String((b.selectedFoods || [])[i])] || null);
    nb.talentExportLevel = b.talentExportLevel || 'max';
    nb.updatedAt = b.updatedAt || new Date().toISOString();
    return nb;
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        savedBuilds = JSON.parse(raw) || [];
        return;
      }
      const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || '[]');
      savedBuilds = Array.isArray(old) ? old.map(migrateOld) : [];
      if (savedBuilds.length) persist();
    } catch (e) {
      savedBuilds = [];
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBuilds)); } catch (e) { /* ignora */ }
  }

  function flash(node, msg) {
    if (!node) return;
    node.textContent = msg;
    clearTimeout(node._timer);
    node._timer = setTimeout(() => { node.textContent = ''; }, 2600);
  }

  // ---------------------------------------------------------------- talentos
  const groupForSlot = (i) => {
    if (i === 0) return 'tribe';
    if (i === 1) return 'title';
    if (i >= MAX_TALENT_SLOTS) return state.optionalGroups[i - MAX_TALENT_SLOTS] || null;
    return 'positive';
  };
  const slotLabel = (i) => {
    if (i === 0) return t('builder.slotTribe');
    if (i === 1) return t('builder.slotTitle');
    if (i >= MAX_TALENT_SLOTS) return t('builder.slotOptional');
    return t('builder.slotTalent', { n: i - POSITIVE_START + 1 });
  };
  const talentDesc = (x) => pick(x, 'desc') || pick(x.levels?.[x.levels.length - 1], 'desc');

  function renderTalentGrid() {
    const tiles = state.talents.map((id, i) => {
      const x = talentIdx.get(id);
      const optional = i >= MAX_TALENT_SLOTS;
      const typeCls = i < POSITIVE_START ? 'talent-type-gold' : (i < MAX_TALENT_SLOTS ? 'talent-type-green' : '');
      return `
        <div class="selector-shell ${optional ? 'optional-slot' : ''}">
          <button type="button" class="selector-tile-icon ${typeCls} ${x ? 'selected' : 'empty'} ${pickerSlot === i ? 'selected' : ''}" data-slot="${i}"
            style="--icon-image:${x?.icon ? `url('${esc(x.icon)}')` : 'none'}" aria-label="${esc(x ? pick(x, 'name') : slotLabel(i))}" title="${esc(x ? pick(x, 'name') : slotLabel(i))}"></button>
          ${optional ? `<button type="button" class="remove-optional-slot" data-remove="${i}" aria-label="${esc(t('builder.removeOptional'))}">-</button>` : ''}
          <span class="selector-label">${esc(x ? pick(x, 'name') : slotLabel(i))}</span>
        </div>`;
    }).join('');
    el.grid.innerHTML = `${tiles}
      <div class="selector-shell add-optional-shell">
        <button type="button" class="add-optional-slot" aria-label="${esc(t('builder.addOptional'))}">+</button>
        <span class="selector-label">${esc(t('builder.addOptional'))}</span>
      </div>`;
  }

  function openTalentPicker(i) {
    pickerSlot = i;
    previewId = state.talents[i];
    talentSearch = '';
    el.pickSearch.value = '';
    const cur = talentIdx.get(state.talents[i]);
    talentTab = cur ? cur.type : null;
    el.modal.hidden = false;
    renderTalentOptions();
    renderTalentGrid();
    el.pickSearch.focus();
  }

  // compatibilidade com a classe e a tribo escolhidas na build
  function buildContext() {
    const cls = meta.classes?.[el.tribe.value];
    const tribeT = talentIdx.get(state.talents[0]);
    return {
      cls: cls ? cls.en : null,
      tribes: new Set((tribeT?.excl || []).map((x) => x.en).filter((x) => !classLabels.has(x)))
    };
  }

  function isCompatible(x, ctx) {
    if (!x.excl?.length) return true;
    const en = x.excl.map((e) => e.en);
    const clsReq = en.filter((e) => classLabels.has(e));
    const tribeReq = en.filter((e) => !classLabels.has(e));
    if (clsReq.length && ctx.cls && !clsReq.includes(ctx.cls)) return false;
    if (tribeReq.length && ctx.tribes.size && !tribeReq.some((e) => ctx.tribes.has(e))) return false;
    return true;
  }

  function closeTalentPicker() {
    el.modal.hidden = true;
    pickerSlot = null;
    renderTalentGrid();
  }

  const typeColor = (type) => (TALENT_COLORS[type] || TALENT_COLORS.other).accent;

  function renderPreview(id) {
    const x = talentIdx.get(id);
    el.pickList.querySelectorAll('.talent-row').forEach((r) => r.classList.toggle('is-preview', r.dataset.talent === id));
    if (!x) {
      el.pickPreview.innerHTML = `<h3>${esc(t('common.description'))}</h3><p>${esc(t('builder.previewHint'))}</p>`;
      return;
    }
    const lv = x.levels.length > 1
      ? `<ol class="preview-levels">${x.levels.map((l) => `<li>${esc(pick(l, 'desc'))}</li>`).join('')}</ol>`
      : '';
    const isCurrent = state.talents[pickerSlot] === x.id;
    el.pickPreview.style.setProperty('--row-color', typeColor(x.type));
    el.pickPreview.innerHTML = `
      <span class="preview-type">${esc(pick(x, 'type'))}</span>
      <h3>${esc(pick(x, 'name'))}</h3>
      <p>${escLines(talentDesc(x) || t('builder.noDescription'))}</p>
      ${lv}
      ${x.excl?.length ? `<p class="preview-excl">${esc(t('talents.exclusive'))} ${esc(x.excl.map(L).join(', '))}</p>` : ''}
      <button type="button" class="build-action-btn primary preview-pick" data-pick-talent="${esc(x.id)}">${esc(t(isCurrent ? 'builder.removeTalent' : 'builder.chooseTalent'))}</button>`;
  }

  function renderTalentOptions() {
    if (pickerSlot === null) return;
    const group = groupForSlot(pickerSlot);
    const tabs = root.querySelector('#talentPickerTabs');
    if (!group) {
      el.pickSearch.hidden = true;
      tabs.innerHTML = '';
      el.pickList.innerHTML = ['tribe', 'title', 'positive'].map((g) => `
        <button type="button" class="talent-row" data-group="${g}">
          <span class="talent-row-noicon"></span>
          <span class="talent-row-text"><span class="talent-row-name">${esc(t(`builder.group${g[0].toUpperCase()}${g.slice(1)}`))}</span></span>
        </button>`).join('');
      el.pickPreview.innerHTML = `<h3>${esc(t('builder.optionalType'))}</h3><p>${esc(t('builder.optionalTypeHint'))}</p>`;
      return;
    }
    el.pickSearch.hidden = false;
    const q = normalize(talentSearch);
    const ctx = buildContext();
    const onlyCompatible = root.querySelector('#talentPickerCompatible').checked;
    const taken = new Set(state.talents.filter((id, i) => id && i !== pickerSlot));
    const types = GROUP_TYPES[group];
    const base = talents.filter((x) => types.includes(x.type)
      && (!onlyCompatible || isCompatible(x, ctx))
      && (!q || normalize(`${x.name_pt} ${x.name_en} ${x.desc_pt || ''} ${x.desc_en || ''} ${(x.excl || []).map((e) => `${e.pt} ${e.en}`).join(' ')}`).includes(q)));
    if (!types.includes(talentTab)) talentTab = types[0];
    tabs.innerHTML = types.length > 1 ? types.map((ty) => {
      const n = base.filter((x) => x.type === ty).length;
      return `<button type="button" class="talent-tab" role="tab" data-tab="${ty}" aria-selected="${ty === talentTab}" style="--tab-color:${typeColor(ty)}">${esc(pick(typeLabel[ty], 'type') || ty)}<span class="tab-count">${n}</span></button>`;
    }).join('') : '';
    // com busca, mostra resultados de todas as abas
    const list = base.filter((x) => q || types.length === 1 || x.type === talentTab)
      .sort((a, b) => (taken.has(a.id) ? 1 : 0) - (taken.has(b.id) ? 1 : 0) || pick(a, 'name').localeCompare(pick(b, 'name')));
    if (!list.length) {
      el.pickList.innerHTML = `<div class="empty-state">${esc(t('builder.noMatch'))}</div>`;
      renderPreview(null);
      return;
    }
    const current = state.talents[pickerSlot];
    if (!list.some((x) => x.id === previewId)) previewId = current && list.some((x) => x.id === current) ? current : list[0].id;
    el.pickList.innerHTML = list.map((x) => {
      const badges = [
        ...(x.excl || []).map((e) => `<span class="talent-badge">${esc(L(e))}</span>`),
        x.levels.length > 1 ? `<span class="talent-badge muted">${esc(t('builder.levelsN', { n: x.levels.length }))}</span>` : ''
      ].join('');
      return `
      <button type="button" class="talent-row ${x.id === current ? 'selected' : ''}" data-talent="${esc(x.id)}" style="--row-color:${typeColor(x.type)}" ${taken.has(x.id) ? `disabled title="${esc(t('builder.alreadyUsed'))}"` : ''}>
        ${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy" />` : '<span class="talent-row-noicon"></span>'}
        <span class="talent-row-text">
          <span class="talent-row-name">${esc(pick(x, 'name'))}</span>
          <span class="talent-row-desc">${esc(talentDesc(x) || '')}</span>
          ${badges ? `<span class="talent-row-badges">${badges}</span>` : ''}
        </span>
      </button>`;
    }).join('');
    renderPreview(previewId);
  }

  // ---------------------------------------------------------------- armadura
  const quality = () => state.quality || 0;
  const qmul = (p) => (p?.qmul ? p.qmul[quality()] || 1 : 1);

  // slot com o nome embaixo (Armadura, Luvas, Arma 1, Bebida...)
  function slotCell(attrs, item, label) {
    const title = item ? `${label}: ${pick(item, 'name')}` : label;
    return `
      <div class="slot-cell">
        <button type="button" class="armor-slot ${item ? 'selected' : 'empty'}${qualityClass(item?.quality)}" ${attrs} title="${esc(title)}" aria-label="${esc(title)}">${item ? iconImg(item, '', pick(item, 'name')) : ''}</button>
        <span class="slot-cell-label">${esc(label)}</span>
      </div>`;
  }

  function renderArmorSlots() {
    el.armorSlots.innerHTML = SLOTS.map((s) => slotCell(`data-armor-slot="${s}"`, pieces.get(state.armor[s]), t(SLOT_LABELS[s]))).join('')
      + `<button type="button" class="complete-armor-set-button" id="completeArmorSetButton" title="${esc(t('builder.completeTitle'))}" ${Object.values(state.armor).some((id) => pieces.get(id)?.set) ? '' : 'disabled'}>${esc(t('builder.complete'))}</button>`;
  }

  function completeSet() {
    const ref = pieces.get(state.armor.armor) || [...Object.values(state.armor)].map((id) => pieces.get(id)).find((p) => p?.set);
    const set = ref?.set ? sets.get(String(ref.set)) : null;
    if (!set) return;
    SLOTS.forEach((s) => { if (set.pieces[s]) state.armor[s] = set.pieces[s]; });
    renderAll();
  }

  // seletor genérico com busca (armadura, alimento, arma, máscara)
  function openPicker(container, options, current, onPick, removeLabel) {
    closePickers(container);
    const render = (q) => {
      const nq = normalize(q);
      const list = options.filter((o) => !nq || normalize(`${o.name_pt} ${o.name_en}`).includes(nq));
      container.querySelector('.picker-results').innerHTML = [
        `<button type="button" class="armor-picker-option" data-pick="" title="${esc(removeLabel)}" aria-label="${esc(removeLabel)}">&times;</button>`,
        ...list.slice(0, 200).map((o) => `<button type="button" class="armor-picker-option${qualityClass(o.quality)}${o.id === current ? ' is-current' : ''}" data-pick="${esc(o.id)}" title="${esc(pick(o, 'name'))}" aria-label="${esc(pick(o, 'name'))}">${iconImg(o, '', '')}</button>`),
        list.length ? '' : `<span class="picker-empty">${esc(t('builder.noOptions'))}</span>`
      ].join('');
    };
    container.innerHTML = `<input type="search" class="picker-search" placeholder="${esc(t('builder.searchPicker'))}" aria-label="${esc(t('builder.searchPicker'))}" /><div class="picker-results" style="display:contents"></div>`;
    container.hidden = false;
    render('');
    const input = container.querySelector('.picker-search');
    input.addEventListener('input', () => render(input.value));
    container.onclick = (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      container.hidden = true;
      onPick(b.dataset.pick || null);
    };
    if (options.length > 16) input.focus();
  }

  function closePickers(except) {
    [el.armorPicker, el.foodPicker, el.gearPicker].forEach((p) => { if (p !== except) p.hidden = true; });
  }

  // ---------------------------------------------------------------- alimentos
  function renderFoodSlots() {
    el.foodSlots.innerHTML = FOOD_SLOTS.map((sub, i) => slotCell(`data-food-slot="${i}"`, foodsIdx.get(state.foods[i]), t(FOOD_LABELS[sub]))).join('');
  }

  // ---------------------------------------------------------------- armas e máscara
  // roupa de transformação da máscara escolhida (masks.json: outfit.m / outfit.f) no lugar do personagem
  const DEFAULT_PORTRAIT = 'assets/img/builder/personagem.webp';
  function renderOutfit() {
    const img = root.querySelector('#builderProfileImage');
    const box = root.querySelector('#outfitToggle');
    const m = masksIdx.get(state.mask);
    const sex = state.outfitSex === 'f' ? 'f' : 'm';
    const url = m?.outfit?.[sex] || m?.outfit?.m;
    img.src = url || DEFAULT_PORTRAIT;
    img.classList.toggle('is-outfit', Boolean(url));
    box.hidden = !url;
    if (url) {
      root.querySelector('#outfitCaption').textContent = t('builder.outfitOf', { name: pick(m, 'name') });
      box.querySelectorAll('[data-sex]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sex === sex)));
    }
  }

  function renderGear() {
    renderOutfit();
    // Arma 1 e 2 fixas; as extras (botão +) podem ser removidas
    el.gearRow.innerHTML = state.weapons.map((id, i) => {
      const cell = slotCell(`data-gear="weapon" data-index="${i}"`, weaponsIdx.get(id), t('builder.weaponSlot', { n: i + 1 }));
      return i < 2 ? cell : cell.replace('<div class="slot-cell">', `<div class="slot-cell slot-extra"><button type="button" class="slot-remove" data-remove-weapon="${i}" aria-label="${esc(t('builder.removeWeaponSlot'))}" title="${esc(t('builder.removeWeaponSlot'))}">&times;</button>`);
    }).join('')
      + slotCell('data-gear="mask" data-index="0"', masksIdx.get(state.mask), t('builder.mask'))
      + (state.weapons.length < MAX_WEAPONS ? `<div class="slot-cell"><button type="button" class="armor-slot slot-add" data-add-weapon aria-label="${esc(t('builder.addWeapon'))}" title="${esc(t('builder.addWeapon'))}">+</button><span class="slot-cell-label">${esc(t('builder.addWeapon'))}</span></div>` : '');
  }

  function renderClassWeapons() {
    const learned = classWeapons(state.tribe);
    el.classWeapons.innerHTML = CLASS_WEAPON_ORDER.filter((k) => typeIcon[k]).map((k) => {
      const name = L(meta.weaponTypes?.[k]) || k;
      return `<div class="class-weapon-item ${learned.has(k) ? 'learned' : ''}" title="${esc(name)}">
        <img class="class-weapon-icon" src="${esc(typeIcon[k].icon)}" alt="${esc(name)}" />
        <span class="class-weapon-level">${learned.has(k) ? 120 : 100}</span>
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- cabeçalho, bônus e totais
  function syncHeader() {
    el.hName.textContent = el.name.value.trim() || t('builder.unnamed');
    const opt = el.tribe.options[el.tribe.selectedIndex];
    el.hClass.textContent = el.tribe.value ? opt.textContent : t('builder.notSelected');
    el.hMaster.style.display = el.tribe.value ? 'inline' : 'none';
    const tribeT = talentIdx.get(state.talents[0]);
    const titleT = talentIdx.get(state.talents[1]);
    // o rótulo "<Tribo ...>" já diz "Tribo": tira a palavra do nome para não repetir ("Tribo Garra" -> "Garra")
    const noTribeWord = (s) => String(s || '').replace(/^(tribo|tribe)\s*[-–:]?\s*/i, '').replace(/\s+(tribe|tribo)$/i, '').trim() || s;
    el.hTribe.textContent = tribeT
      ? [...new Set(tribeT.excl?.length ? tribeT.excl.map((e) => noTribeWord(L(e))) : [noTribeWord(pick(tribeT, 'name'))])].join(', ')
      : t('builder.notSelected');
    el.hTitle.textContent = titleT ? pick(titleT, 'name') : t('builder.notSelectedM');
  }

  function equippedSets() {
    const counts = new Map();
    SLOTS.forEach((s) => {
      const p = pieces.get(state.armor[s]);
      if (p?.set) counts.set(p.set, (counts.get(p.set) || 0) + 1);
    });
    return [...counts].map(([id, n]) => ({ set: sets.get(String(id)), n })).filter((x) => x.set).sort((a, b) => b.n - a.n);
  }

  // bônus de conjunto: fica no "Resumo da build", logo abaixo dos atributos das peças (vazio sem conjunto)
  function setBonusHtml() {
    const eq = equippedSets();
    if (!eq.length) return '';
    return `<div><h3>${esc(t('builder.setBonus'))}</h3><div class="set-bonus-panel">${eq.map(({ set, n }) => `
      <article class="set-bonus-card">
        <h4 class="set-bonus-title">${esc(pick(set, 'name'))} (${n}/6)</h4>
        ${n < 2 ? `<p class="set-bonus-locked">${esc(t('builder.setLocked'))}</p>` : ''}
        ${bonusHtml(meta, set, n)}
      </article>`).join('')}</div></div>`;
  }

  function addStat(map, s, mult = 1) {
    const key = `${s.a}|${s.op}`;
    const cur = map.get(key) || { a: s.a, op: s.op, v: 0 };
    cur.v += s.v * mult;
    map.set(key, cur);
  }

  function renderTotals() {
    const gear = new Map();
    SLOTS.forEach((s) => {
      const p = pieces.get(state.armor[s]);
      (p?.stats || []).forEach((st) => addStat(gear, st, qmul(p)));
    });
    equippedSets().forEach(({ set, n }) => (set.bonuses || []).filter((b) => n >= b.n).forEach((b) => b.stats.forEach((st) => addStat(gear, st))));
    const food = new Map();
    let maxDur = 0;
    state.foods.forEach((id) => {
      const f = foodsIdx.get(id);
      (f?.effects || []).forEach((st) => addStat(food, st));
      if (f?.duration) maxDur = Math.max(maxDur, f.duration);
    });
    const weaponLines = state.weapons.map((id) => weaponsIdx.get(id)).filter(Boolean).map((w) => {
      const dmg = (w.stats || []).find((s) => s.a === 'WuQiDamage');
      return `<li class="stat-line"><span class="stat-label">${esc(pick(w, 'name'))}</span><span class="stat-value">${dmg ? esc(statParts(meta, dmg, qmul(w)).value) : ''}</span></li>`;
    }).join('');
    const sortStats = (m) => [...m.values()].filter((s) => Math.abs(s.v) > 1e-9)
      .sort((a, b) => statParts(meta, a).label.localeCompare(statParts(meta, b).label));
    // coluna da esquerda: atributos das peças; quando um alimento mexe no mesmo atributo, aparece "+X alimentos" na linha
    const gearLines = sortStats(gear).map((s) => {
      const { label, value } = statParts(meta, s);
      const f = food.get(`${s.a}|${s.op}`);
      const extra = f && Math.abs(f.v) > 1e-9 ? `<small class="stat-food">${esc(t('builder.fromFood', { v: statParts(meta, f).value }))}</small>` : '';
      return `<li class="stat-line"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}${extra}</span></li>`;
    }).join('');
    const left = [];
    if (gearLines) left.push(`<div><h3>${esc(t('builder.totalArmor'))}${quality() ? ` · ${esc(qualityName(quality()))}` : ''}</h3><ul class="stat-list">${gearLines}</ul></div>`);
    const bonus = setBonusHtml();
    if (bonus) left.push(bonus);
    if (weaponLines) left.push(`<div><h3>${esc(t('builder.weapons'))}</h3><ul class="stat-list">${weaponLines}</ul></div>`);
    // coluna da direita: cada alimento escolhido com a duração e os efeitos (dados de foods.json, os mesmos da página Alimentos)
    const chosen = state.foods.map((id) => foodsIdx.get(id)).filter((f) => f?.effects?.length);
    const foodCards = chosen.map((f) => `
      <div class="bt-food">
        <div class="bt-food-head">${iconImg(f, 'bt-food-icon', '')}<span class="bt-food-name">${esc(pick(f, 'name'))}</span>${f.duration ? `<span class="bt-food-dur">${esc(fmtDuration(f.duration))}</span>` : ''}</div>
        ${statList(meta, f.effects)}
      </div>`).join('');
    const foodTotal = chosen.length > 1 && food.size
      ? `<div class="bt-food-total"><h4>${esc(t('builder.foodTotal'))}${maxDur ? ` · ${esc(fmtDuration(maxDur))}` : ''}</h4>${statList(meta, sortStats(food))}</div>` : '';
    const right = `<div><h3>${esc(t('builder.totalFood'))}</h3>${foodCards ? `<div class="bt-food-list">${foodCards}</div>${foodTotal}` : `<p class="set-bonus-empty">${esc(t('builder.foodEmpty'))}</p>`}</div>`;
    el.totals.innerHTML = left.length || chosen.length
      ? `<div class="bt-col">${left.join('') || `<p class="set-bonus-empty">${esc(t('builder.totalsEmpty'))}</p>`}</div><div class="bt-col bt-col-food">${right}</div>`
      : `<p class="set-bonus-empty">${esc(t('builder.totalsEmpty'))}</p>`;
  }

  // ---------------------------------------------------------------- GDMbot
  function talentGameId(x, level) {
    if (!x?.levels?.length) return null;
    const ids = x.levels.map((l) => l.id);
    if (level === 'max') return ids[ids.length - 1];
    return ids[Number(level) - 1] || ids[ids.length - 1];
  }

  function gmCommands() {
    const level = el.expLevel.value || 'max';
    const ids = state.talents.map((id) => talentGameId(talentIdx.get(id), level)).filter(Boolean);
    // os IDs dos talentos são só números; qualquer "-" é removido para o comando não quebrar
    const clean = ids.map((id) => String(id).replace(/-/g, '').trim()).filter(Boolean);
    return clean.length ? ['gm ClearNG', ...clean.map((id) => `gm AddNG ${id} 1 0`)] : [];
  }

  function macroCode() {
    const cmds = gmCommands();
    if (!cmds.length) return '';
    // macro simplificada: só "gm ClearNG" e um "gm AddNG" por talento (sem comentário e sem teclas "-")
    const out = [];
    cmds.forEach((line) => {
      out.push({ type: 'type_text', value: line, delay: 0.2, options: { interval: 0.02 } });
      out.push({ type: 'key', value: 'enter', delay: 0.5, options: { key_action: 'normal' } });
    });
    return JSON.stringify(out);
  }

  function renderExport() {
    el.expCode.value = macroCode();
    const lines = gmCommands();
    el.expPreview.textContent = lines.length ? lines.join('\n') : t('builder.noTalents');
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const safeName = () => (el.name.value.trim() || 'build').replace(/[^a-z0-9-_]+/gi, '_');

  // ---------------------------------------------------------------- builds salvas
  function payload() {
    return {
      ...state,
      name: el.name.value.trim(),
      description: el.desc.value.trim(),
      tribe: el.tribe.value,
      talentExportLevel: el.expLevel.value || 'max',
      updatedAt: new Date().toISOString()
    };
  }

  function applyBuild(b) {
    state = { ...emptyBuild(), ...b };
    const extra = Math.max(state.talents.length - MAX_TALENT_SLOTS, state.optionalGroups.length, 0);
    state.optionalGroups = Array.from({ length: extra }, (_, i) => (['tribe', 'title', 'positive'].includes(state.optionalGroups[i]) ? state.optionalGroups[i] : null));
    state.talents = Array.from({ length: MAX_TALENT_SLOTS + extra }, (_, i) => (talentIdx.has(state.talents[i]) ? state.talents[i] : null));
    state.foods = Array.from({ length: FOOD_SLOTS.length }, (_, i) => (foodsIdx.has(state.foods[i]) ? state.foods[i] : null));
    const savedWeapons = Array.isArray(state.weapons) ? state.weapons.slice(0, MAX_WEAPONS) : [];
    state.weapons = Array.from({ length: Math.max(2, savedWeapons.length) }, (_, i) => (weaponsIdx.has(savedWeapons[i]) ? savedWeapons[i] : null));
    state.mask = masksIdx.has(state.mask) ? state.mask : null;
    const armor = {};
    SLOTS.forEach((s) => { if (pieces.has(state.armor?.[s])) armor[s] = state.armor[s]; });
    state.armor = armor;
    el.name.value = state.name || '';
    el.desc.value = state.description || '';
    el.tribe.value = state.tribe || '';
    el.quality.value = String(state.quality || 0);
    el.expLevel.value = state.talentExportLevel || 'max';
    el.modal.hidden = true;
    pickerSlot = null;
    renderAll();
  }

  // menu suspenso das builds salvas (ao lado do nome); o botão ao lado exclui a build aberta
  function renderSaved() {
    const fmt = (iso) => { try { return new Date(iso).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
    const isSaved = savedBuilds.some((b) => b.id === state.id);
    const head = savedBuilds.length ? t('builder.savedPick', { n: savedBuilds.length }) : t('builder.noSaved');
    el.saved.innerHTML = `<option value="">${esc(head)}</option>${savedBuilds.map((b) => `<option value="${esc(b.id)}">${esc(b.name || t('builder.unnamed'))}${b.updatedAt ? ` · ${esc(fmt(b.updatedAt))}` : ''}</option>`).join('')}`;
    el.saved.value = isSaved ? state.id : '';
    el.saved.disabled = !savedBuilds.length;
    el.savedDel.disabled = !isSaved;
  }

  // rascunho da sessão: mantém a build ao trocar de idioma ou de página
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload())); } catch (e) { /* ignora */ }
  }

  function renderAll() {
    saveDraft();
    syncHeader();
    renderArmorSlots();
    renderFoodSlots();
    renderGear();
    renderClassWeapons();
    renderTotals();
    renderTalentGrid();
    renderSaved();
    renderExport();
  }

  // ---------------------------------------------------------------- eventos
  // nomes oficiais das qualidades e das classes (DT_YiWenText)
  el.quality.innerHTML = [0, 1, 2, 3, 4, 5].map((q) => `<option value="${q}">${esc(qualityName(q))}</option>`).join('');
  el.tribe.innerHTML = `<option value="">${esc(t('builder.class'))}</option>`
    + Object.entries(meta.classes || {}).map(([k, c]) => `<option value="${esc(k)}">${esc(L(c))}</option>`).join('');

  el.grid.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const i = Number(rm.dataset.remove);
      state.talents.splice(i, 1);
      state.optionalGroups.splice(i - MAX_TALENT_SLOTS, 1);
      renderAll();
      return;
    }
    if (e.target.closest('.add-optional-slot')) {
      state.optionalGroups.push(null);
      state.talents.push(null);
      renderAll();
      return;
    }
    const tile = e.target.closest('[data-slot]');
    if (tile) openTalentPicker(Number(tile.dataset.slot));
  });
  el.pickSearch.addEventListener('input', () => { talentSearch = el.pickSearch.value; renderTalentOptions(); });
  el.pickList.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-talent]');
    if (b && b.dataset.talent !== previewId) { previewId = b.dataset.talent; renderPreview(previewId); }
  });
  el.pickList.addEventListener('focusin', (e) => {
    const b = e.target.closest('[data-talent]');
    if (b) { previewId = b.dataset.talent; renderPreview(previewId); }
  });
  const chooseTalent = (id) => {
    if (pickerSlot === null) return;
    state.talents[pickerSlot] = state.talents[pickerSlot] === id ? null : id;
    closeTalentPicker();
    renderAll();
  };
  el.pickList.addEventListener('click', (e) => {
    const g = e.target.closest('[data-group]');
    if (g) {
      state.optionalGroups[pickerSlot - MAX_TALENT_SLOTS] = g.dataset.group;
      renderTalentOptions();
      el.pickSearch.focus();
      return;
    }
    const b = e.target.closest('[data-talent]');
    if (b) chooseTalent(b.dataset.talent);
  });
  el.pickPreview.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-talent]');
    if (b) chooseTalent(b.dataset.pickTalent);
  });
  root.querySelector('#talentPickerTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    talentTab = b.dataset.tab;
    renderTalentOptions();
  });
  root.querySelector('#talentPickerCompatible').addEventListener('change', renderTalentOptions);
  root.querySelector('#talentPickerRemove').addEventListener('click', () => {
    if (pickerSlot === null) return;
    state.talents[pickerSlot] = null;
    closeTalentPicker();
    renderAll();
  });
  root.querySelector('#talentPickerClose').addEventListener('click', closeTalentPicker);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeTalentPicker(); });
  const onKey = (e) => {
    if (e.key !== 'Escape' || !root.isConnected) return;
    if (!el.modal.hidden) closeTalentPicker();
    closePickers(null);
  };
  document.addEventListener('keydown', onKey);

  el.armorSlots.addEventListener('click', (e) => {
    if (e.target.closest('#completeArmorSetButton')) { completeSet(); return; }
    const b = e.target.closest('[data-armor-slot]');
    if (!b) return;
    const s = b.dataset.armorSlot;
    openPicker(el.armorPicker, piecesBySlot[s], state.armor[s], (id) => {
      if (id) state.armor[s] = id; else delete state.armor[s];
      renderAll();
    }, t('builder.removePiece'));
  });
  el.foodSlots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-food-slot]');
    if (!b) return;
    const i = Number(b.dataset.foodSlot);
    const sub = FOOD_SLOTS[i];
    const opts = [...foodsIdx.values()].filter((f) => (sub === 'other' ? !['staple', 'drink', 'meat', 'veg', 'recreational'].includes(f.sub) : f.sub === sub) && f.effects?.length);
    openPicker(el.foodPicker, opts, state.foods[i], (id) => { state.foods[i] = id; renderAll(); }, t('builder.removeFood'));
  });
  root.querySelector('#outfitToggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sex]');
    if (!b) return;
    state.outfitSex = b.dataset.sex;
    renderOutfit();
    saveDraft();
  });
  el.gearRow.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-weapon]')) {
      if (state.weapons.length < MAX_WEAPONS) state.weapons.push(null);
      renderAll();
      return;
    }
    const rm = e.target.closest('[data-remove-weapon]');
    if (rm) {
      state.weapons.splice(Number(rm.dataset.removeWeapon), 1);
      closePickers(null);
      renderAll();
      return;
    }
    const b = e.target.closest('[data-gear]');
    if (!b) return;
    if (b.dataset.gear === 'mask') {
      openPicker(el.gearPicker, [...masksIdx.values()], state.mask, (id) => { state.mask = id; renderAll(); }, t('builder.removeMask'));
      return;
    }
    const i = Number(b.dataset.index);
    const learned = classWeapons(el.tribe.value);
    const opts = [...enhancedWeapons].sort((a, c) => (learned.has(c.wtype) ? 1 : 0) - (learned.has(a.wtype) ? 1 : 0)
      || CLASS_WEAPON_ORDER.indexOf(a.wtype) - CLASS_WEAPON_ORDER.indexOf(c.wtype));
    openPicker(el.gearPicker, opts, state.weapons[i], (id) => { state.weapons[i] = id; renderAll(); }, t('builder.removeWeapon'));
  });
  document.addEventListener('click', (e) => {
    if (!root.isConnected) return;
    if (!e.target.closest('.builder-picker, [data-armor-slot], [data-food-slot], [data-gear], #completeArmorSetButton')) closePickers(null);
  });

  el.name.addEventListener('input', () => { syncHeader(); renderExport(); saveDraft(); });
  el.desc.addEventListener('input', saveDraft);
  el.tribe.addEventListener('change', () => { state.tribe = el.tribe.value; syncHeader(); renderClassWeapons(); saveDraft(); });
  el.quality.addEventListener('change', () => { state.quality = Number(el.quality.value) || 0; renderTotals(); saveDraft(); });
  el.expLevel.addEventListener('change', () => { renderExport(); saveDraft(); });

  root.querySelector('#actionSaveBuild').addEventListener('click', () => {
    const p = payload();
    if (!p.id) p.id = `build-${Date.now()}`;
    state.id = p.id;
    const i = savedBuilds.findIndex((b) => b.id === p.id);
    if (i >= 0) savedBuilds[i] = p; else savedBuilds.unshift(p);
    persist();
    saveDraft();   // o rascunho guarda o id: ao recarregar, o menu continua mostrando esta build
    renderSaved();
    flash(el.status, t('builder.saved', { name: p.name || t('builder.unnamed') }));
  });
  root.querySelector('#actionClearBuild').addEventListener('click', () => applyBuild(emptyBuild()));
  root.querySelector('#actionShareBuild').addEventListener('click', async () => {
    const code = toBase64Url(JSON.stringify(compact(payload())));
    const url = `${location.origin}${location.pathname}#builder-maker?b=${code}`;
    try { await navigator.clipboard.writeText(url); } catch (e) { window.prompt('URL', url); }
    flash(el.status, t('builder.shared'));
  });
  root.querySelector('#actionExportBuild').addEventListener('click', () => download(`${safeName()}.json`, JSON.stringify(payload(), null, 2)));
  root.querySelector('#actionImportBuild').addEventListener('click', () => el.importInput.click());
  el.importInput.addEventListener('change', async () => {
    const file = el.importInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      // aceita o formato novo e o antigo (selectedPositive / selectedArmorPieces)
      const b = data.selectedPositive || data.selectedArmorPieces ? migrateOld(data) : { ...emptyBuild(), ...data };
      b.id = b.id || `build-${Date.now()}`;
      const i = savedBuilds.findIndex((x) => x.id === b.id);
      if (i >= 0) savedBuilds[i] = b; else savedBuilds.unshift(b);
      persist();
      applyBuild(b);
    } catch (e) {
      flash(el.status, t('builder.importError'));
    } finally {
      el.importInput.value = '';
    }
  });
  el.saved.addEventListener('change', () => {
    const build = savedBuilds.find((x) => x.id === el.saved.value);
    if (build) applyBuild(build);
  });
  el.savedDel.addEventListener('click', () => {
    const build = savedBuilds.find((x) => x.id === state.id);
    if (!build) return;
    if (!window.confirm(t('builder.deleteConfirm', { name: build.name || t('builder.unnamed') }))) return;
    savedBuilds = savedBuilds.filter((x) => x.id !== build.id);
    state.id = null;
    persist();
    renderSaved();
    flash(el.status, t('builder.deleted'));
  });
  root.querySelector('#actionCopyTalentCode').addEventListener('click', async () => {
    const code = macroCode();
    if (!code) { flash(el.expStatus, t('builder.noTalents')); return; }
    try { await navigator.clipboard.writeText(code); } catch (e) { el.expCode.select(); document.execCommand('copy'); }
    flash(el.expStatus, t('builder.copied'));
  });
  root.querySelector('#actionDownloadTalentCode').addEventListener('click', () => {
    const code = macroCode();
    if (!code) { flash(el.expStatus, t('builder.noTalents')); return; }
    download(`macro_talentos_${safeName()}.json`, JSON.stringify(JSON.parse(code), null, 4));
  });

  // ---------------------------------------------------------------- início
  loadSaved();
  const shared = params.get('b');
  if (shared) {
    try {
      applyBuild(expand(JSON.parse(fromBase64Url(shared))));
      flash(el.status, t('builder.sharedLoaded'));
    } catch (e) {
      applyBuild(emptyBuild());
      flash(el.status, t('builder.linkError'));
    }
  } else {
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    applyBuild(draft && typeof draft === 'object' ? draft : emptyBuild());
  }
}
