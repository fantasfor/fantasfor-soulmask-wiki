// Atributos: o que cada atributo faz e como a qualidade do NPC (10 a 15) muda os valores.
// Regra do jogo (assets/data/npc-quality.json, lido por tools/build_guides.py):
//   valor = base (DT_Attr_ManRen_1) x coeficiente da cor (PinZhi_1..6) = base x qualidade / 10
//   branco 1,0 · verde 1,0–1,1 · azul 1,1–1,2 · roxo 1,2–1,3 · dourado 1,3–1,4 · vermelho 1,4–1,5
// Velocidade de movimento e fôlego não mudam com a qualidade.
import { t } from '../i18n.js';
import { loadData, esc, fmtNum, L, rarityIcon } from '../data.js';

const TIERS = [
  { id: 'base', n: 1, color: '#d9d9d9', name: { pt: 'Branco (base)', en: 'White (base)' } },
  { id: 'green', n: 2, color: '#4fd18b', name: { pt: 'Verde', en: 'Green' } },
  { id: 'blue', n: 3, color: '#4aa3ff', name: { pt: 'Azul', en: 'Blue' } },
  { id: 'purple', n: 4, color: '#c06cff', name: { pt: 'Roxo', en: 'Purple' } },
  { id: 'gold', n: 5, color: '#ecb43c', name: { pt: 'Dourado', en: 'Gold' } },
  { id: 'red', n: 6, color: '#ff5a4f', name: { pt: 'Vermelho', en: 'Red' } }
];

// ordem da tabela; "fixed" = não muda com a qualidade
const STATS = [
  { k: 'Attack', name: { pt: 'Ataque (ATQ)', en: 'Attack (ATK)' },
    d: { pt: 'Dano-base de todos os golpes e flechas. A arma e a proficiência somam em cima dele.', en: 'Base damage of every hit and arrow. Weapon and proficiency stack on top of it.' } },
  { k: 'Defense', name: { pt: 'Defesa (DEF)', en: 'Defense (DEF)' },
    d: { pt: 'Reduz o dano recebido. A armadura soma em cima dela.', en: 'Reduces damage taken. Armor stacks on top of it.' } },
  { k: 'MaxHealth', name: { pt: 'Vida (PV)', en: 'Health (HP)' },
    d: { pt: 'Quanto dano o personagem aguenta antes de cair.', en: 'How much damage the character takes before going down.' } },
  { k: 'MaxTiLi', name: { pt: 'Vigor', en: 'Stamina' },
    d: { pt: 'Gasto ao correr, esquivar, atacar e trabalhar. Com mais vigor, o NPC luta e trabalha mais tempo sem parar.', en: 'Spent when sprinting, dodging, attacking and working. More stamina means longer fights and work without pausing.' } },
  { k: 'MaxFuZhong', name: { pt: 'Carga', en: 'Carry weight' },
    d: { pt: 'Peso máximo que dá para carregar sem ficar lento.', en: 'Maximum weight carried before slowing down.' } },
  { k: 'MaxFood', name: { pt: 'Saciedade', en: 'Satiety' },
    d: { pt: 'Reserva de comida. Quanto maior, mais tempo até sentir fome.', en: 'Food reserve. The higher, the longer until hungry.' } },
  { k: 'MaxWater', name: { pt: 'Hidratação', en: 'Hydration' },
    d: { pt: 'Reserva de água. Quanto maior, mais tempo até sentir sede.', en: 'Water reserve. The higher, the longer until thirsty.' } },
  { k: 'MaxTenacity', name: { pt: 'Resiliência', en: 'Toughness' },
    d: { pt: 'Resistência a ser derrubado ou atordoado por golpes fortes.', en: 'Resistance to being knocked down or staggered by heavy hits.' } },
  { k: 'MaxJingShen', name: { pt: 'Moral', en: 'Morale' },
    d: { pt: 'Humor do NPC. Com moral baixa ele trabalha pior; conforto, comida boa e descanso ajudam.', en: 'NPC morale. Low morale means worse work; comfort, good food and rest help.' } },
  { k: 'SpeedRate', fixed: true, pct: true, name: { pt: 'Velocidade de movimento', en: 'Movement speed' },
    d: { pt: 'Não muda com a qualidade: fica em 100% e só muda com equipamentos, talentos e efeitos.', en: 'Does not change with quality: stays at 100% and only changes with gear, talents and effects.' } },
  { k: 'MaxHuXi', fixed: true, name: { pt: 'Fôlego', en: 'Breath' },
    d: { pt: 'Tempo embaixo d’água. Não muda com a qualidade.', en: 'Time underwater. Does not change with quality.' } }
];

// base de reserva caso o JSON ainda não exista (mesmos números do jogo)
const FALLBACK_BASE = { Attack: 10, Defense: 10, MaxHealth: 100, MaxTiLi: 200, MaxFuZhong: 100, MaxFood: 120, MaxWater: 120, MaxTenacity: 100, MaxJingShen: 100, SpeedRate: 1, MaxHuXi: 100 };
const FALLBACK_COEF = [[1, 1], [1, 1.1], [1.1, 1.2], [1.2, 1.3], [1.3, 1.4], [1.4, 1.5]];

const LS_KEY = 'attributes_quality_v2';
const round1 = (x) => Math.round(x * 10) / 10;

export async function initAttributesPage(root) {
  const tiersEl = root.querySelector('#attr-tiers');
  const pickEl = root.querySelector('#attr-pick');
  const tableEl = root.querySelector('#attr-table');
  const glossEl = root.querySelector('#attr-gloss');

  let data = null;
  try { data = await loadData('npc-quality'); } catch (e) { data = null; }
  const base = { ...FALLBACK_BASE, ...(data?.base || {}) };
  // faixa de qualidade (10..15) de cada cor, a partir do coeficiente do jogo (Ataque como referência)
  TIERS.forEach((tier, i) => {
    const c = data?.tiers?.find((x) => x.n === tier.n)?.coef?.Attack || FALLBACK_COEF[i];
    tier.lo = round1(c[0] * 10);
    // o limite de cima é exclusivo (11,0 já é azul), menos no vermelho, que vai até 15
    tier.hi = tier.n === 6 || c[1] === c[0] ? round1(c[1] * 10) : round1(c[1] * 10 - 0.1);
    tier.range = tier.lo === tier.hi ? fmtNum(tier.lo, 1) : `${fmtNum(tier.lo, 1)} – ${fmtNum(tier.hi, 1)}`;
  });
  const tierOf = (q) => [...TIERS].reverse().find((x) => q >= x.lo - 1e-9) || TIERS[0];

  let q = 15;
  try { const v = Number(localStorage.getItem(LS_KEY)); if (v >= 10 && v <= 15) q = v; } catch (e) { /* ignora */ }

  // losango de qualidade do jogo (o mesmo ícone de cor da tela do NPC)
  const dot = (tier) => rarityIcon(null, tier.n, { decorative: true, title: L(tier.name) });
  const pctTxt = (x) => `+${fmtNum(x, 0)}%`;
  tiersEl.innerHTML = TIERS.map((tier) => `<div class="attr-tier" style="--c:${tier.color}">${dot(tier)}<strong>${esc(L(tier.name))}</strong><span>${esc(tier.range)}</span><small>${tier.n === 1 ? '+0%' : `${pctTxt((tier.lo / 10 - 1) * 100)} ~ ${pctTxt((tier.hi / 10 - 1) * 100)}`}</small></div>`).join('');
  glossEl.innerHTML = STATS.map((s) => `<div class="attr-gloss-item"><strong>${esc(L(s.name))}</strong><p>${esc(L(s.d))}</p></div>`).join('');

  const valueAt = (s, quality) => (s.fixed ? base[s.k] : base[s.k] * quality / 10);
  const fmt = (s, x) => (s.pct ? `${fmtNum(x * 100, 0)}%` : fmtNum(x, x < 50 ? 2 : 1));

  function render() {
    renderPick();
    renderTable();
  }
  function renderPick() {
    const tier = tierOf(q);
    pickEl.innerHTML = `
      <div class="attr-q">
        <label for="attr-q-range"><span>${esc(t('attr.qLabel'))}</span>
          <output class="attr-q-out" style="--c:${tier.color}">${dot(tier)} ${esc(fmtNum(q, 1))} · ${esc(L(tier.name))}</output></label>
        <input type="range" id="attr-q-range" min="10" max="15" step="0.1" value="${q}" />
      </div>
      <div class="guide-chips">${TIERS.map((x) => `<button type="button" class="guide-chip${x.id === tier.id ? ' is-active' : ''}" style="--tone:${x.color}" data-tier="${x.id}" aria-pressed="${x.id === tier.id}">${dot(x)} ${esc(L(x.name))} <small>${esc(x.range)}</small></button>`).join('')}</div>`;
  }
  function renderTable() {
    try { localStorage.setItem(LS_KEY, String(q)); } catch (e) { /* ignora */ }
    const tier = tierOf(q);
    const gainPct = (q / 10 - 1) * 100;
    tableEl.innerHTML = `
      <div class="attr-row attr-head"><span>${esc(t('attr.colStat'))}</span><span>${esc(t('attr.colBase'))}</span><span>${esc(t('attr.colAt', { q: fmtNum(q, 1) }))}</span><span>${esc(t('attr.colRange', { c: L(tier.name) }))}</span><span>${esc(t('attr.colGain'))}</span></div>
      ${STATS.filter((s) => base[s.k] != null).map((s) => {
        const b = base[s.k];
        const v = valueAt(s, q);
        const lo = valueAt(s, tier.lo);
        const hi = valueAt(s, tier.hi);
        const gain = s.fixed ? 0 : gainPct;
        return `<div class="attr-row${s.fixed ? ' is-fixed' : ''}">
          <span class="attr-name">${esc(L(s.name))}</span>
          <span>${esc(fmt(s, b))}</span>
          <span class="attr-val" style="--c:${tier.color}">${s.fixed ? '' : dot(tier)}${esc(fmt(s, v))}</span>
          <span class="attr-range">${s.fixed || lo === hi ? esc(fmt(s, lo)) : `${esc(fmt(s, lo))} – ${esc(fmt(s, hi))}`}</span>
          <span class="attr-gain"><i class="attr-bar" style="--w:${(gain / 50) * 100}%;--c:${tier.color}"></i>${gain > 0.05 ? `+${esc(fmtNum(gain, 0))}%` : '—'}</span>
        </div>`;
      }).join('')}
      <p class="ev-legend attr-note">${esc(t('attr.note'))}</p>`;
  }
  pickEl.addEventListener('input', (e) => {
    if (e.target.id !== 'attr-q-range') return;
    q = round1(Number(e.target.value));
    const tier = tierOf(q);
    // atualiza só a tabela e o texto, para não perder o foco do controle deslizante
    const out = pickEl.querySelector('.attr-q-out');
    if (out) { out.style.setProperty('--c', tier.color); out.innerHTML = `${dot(tier)} ${esc(fmtNum(q, 1))} · ${esc(L(tier.name))}`; }
    pickEl.querySelectorAll('[data-tier]').forEach((b) => { const on = b.dataset.tier === tier.id; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
    renderTable();
  });
  pickEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tier]');
    if (!b) return;
    const tier = TIERS.find((x) => x.id === b.dataset.tier);
    q = tier.hi;
    render();
  });
  render();
}
