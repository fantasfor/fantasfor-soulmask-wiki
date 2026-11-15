// Atributos: o que cada atributo faz e como a qualidade do NPC (10 a 15) muda os valores.
// Os números de exemplo são de NPCs reais (um por faixa de qualidade); a base (qualidade 10) é a mesma
// do jogo para humanos (DT_Attr_ManRen_1: ATQ 10, DEF 10, PV 100...).
import { t } from '../i18n.js';
import { esc, fmtNum, L } from '../data.js';

const TIERS = [
  { id: 'base', range: '10', color: '#d9d9d9', name: { pt: 'Base', en: 'Base' } },
  { id: 'green', range: '10 – 10,9', color: '#4fd18b', name: { pt: 'Verde', en: 'Green' } },
  { id: 'blue', range: '11 – 11,9', color: '#4aa3ff', name: { pt: 'Azul', en: 'Blue' } },
  { id: 'purple', range: '12 – 12,9', color: '#c06cff', name: { pt: 'Roxo', en: 'Purple' } },
  { id: 'gold', range: '13 – 13,9', color: '#ecb43c', name: { pt: 'Dourado', en: 'Gold' } },
  { id: 'red', range: '14 – 15', color: '#ff5a4f', name: { pt: 'Vermelho', en: 'Red' } }
];

// valor de exemplo em cada faixa (mesma ordem de TIERS)
const STATS = [
  { k: 'atk', name: { pt: 'Ataque (ATQ)', en: 'Attack (ATK)' }, v: [10, 10.739, 11.045, 12.003, 13.992, 14.44],
    d: { pt: 'Dano-base de todos os golpes e flechas. A arma e a proficiência somam em cima dele.', en: 'Base damage of every hit and arrow. Weapon and proficiency stack on top of it.' } },
  { k: 'def', name: { pt: 'Defesa (DEF)', en: 'Defense (DEF)' }, v: [10, 10.487, 11.966, 12.276, 13.683, 14.541],
    d: { pt: 'Reduz o dano recebido. A armadura soma em cima dela.', en: 'Reduces damage taken. Armor stacks on top of it.' } },
  { k: 'hp', name: { pt: 'Vida (PV)', en: 'Health (HP)' }, v: [100, 102.4, 109.8, 114.1, 116.9, 124.3],
    d: { pt: 'Quanto dano o personagem aguenta antes de cair.', en: 'How much damage the character takes before going down.' } },
  { k: 'vigor', name: { pt: 'Vigor', en: 'Stamina' }, v: [100, 102.4, 111.1, 120.9, 130.3, 139.4],
    d: { pt: 'Gasto ao correr, esquivar, atacar e trabalhar. Com mais vigor, o NPC luta e trabalha mais tempo sem parar.', en: 'Spent when sprinting, dodging, attacking and working. More stamina means longer fights and work without pausing.' } },
  { k: 'speed', name: { pt: 'Velocidade de movimento', en: 'Movement speed' }, v: [100, 100, 100, 100, 100, 100], pct: true,
    d: { pt: 'Não muda com a qualidade: fica em 100% e só muda com equipamentos, talentos e efeitos.', en: 'Does not change with quality: stays at 100% and only changes with gear, talents and effects.' } },
  { k: 'load', name: { pt: 'Carga', en: 'Carry weight' }, v: [100, 107.2, 100, 120.6, 128.4, 137.4],
    d: { pt: 'Peso máximo que dá para carregar sem ficar lento.', en: 'Maximum weight carried before slowing down.' } },
  { k: 'food', name: { pt: 'Saciedade', en: 'Satiety' }, v: [100, 102.6, 110.7, 123.2, 132.6, 147.6],
    d: { pt: 'Reserva de comida. Quanto maior, mais tempo até sentir fome.', en: 'Food reserve. The higher, the longer until hungry.' } },
  { k: 'water', name: { pt: 'Hidratação', en: 'Hydration' }, v: [100, 103.8, 118.2, 122.8, 132.7, 149.6],
    d: { pt: 'Reserva de água. Quanto maior, mais tempo até sentir sede.', en: 'Water reserve. The higher, the longer until thirsty.' } },
  { k: 'breath', name: { pt: 'Fôlego', en: 'Breath' }, v: [100, 100, 100, 100, 100, 100],
    d: { pt: 'Tempo embaixo d’água. Não muda com a qualidade.', en: 'Time underwater. Does not change with quality.' } },
  { k: 'mood', name: { pt: 'Moral', en: 'Mood' }, v: [100, 103.6, 110.5, 121, 140, 144.6],
    d: { pt: 'Humor do NPC. Com moral baixa ele trabalha pior; conforto, comida boa e descanso ajudam.', en: 'NPC mood. Low mood means worse work; comfort, good food and rest help.' } },
  { k: 'tough', name: { pt: 'Resiliência', en: 'Toughness' }, v: [100, 101.9, 110.8, 127.7, 137.6, 147.1],
    d: { pt: 'Resistência a ser derrubado ou atordoado por golpes fortes.', en: 'Resistance to being knocked down or staggered by heavy hits.' } }
];

const LS_KEY = 'attributes_tier_v1';

export async function initAttributesPage(root) {
  const tiersEl = root.querySelector('#attr-tiers');
  const pickEl = root.querySelector('#attr-pick');
  const tableEl = root.querySelector('#attr-table');
  const glossEl = root.querySelector('#attr-gloss');
  let sel = 'red';
  try { sel = localStorage.getItem(LS_KEY) || sel; } catch (e) { /* ignora */ }
  if (!TIERS.some((x) => x.id === sel)) sel = 'red';

  const dot = (tier) => `<i class="attr-dot" style="--c:${tier.color}"></i>`;
  tiersEl.innerHTML = TIERS.map((tier) => `<div class="attr-tier" style="--c:${tier.color}">${dot(tier)}<strong>${esc(L(tier.name))}</strong><span>${esc(tier.range)}</span></div>`).join('');
  glossEl.innerHTML = STATS.map((s) => `<div class="attr-gloss-item"><strong>${esc(L(s.name))}</strong><p>${esc(L(s.d))}</p></div>`).join('');

  function render() {
    try { localStorage.setItem(LS_KEY, sel); } catch (e) { /* ignora */ }
    const ti = TIERS.findIndex((x) => x.id === sel);
    const tier = TIERS[ti];
    pickEl.innerHTML = TIERS.map((x) => `<button type="button" class="guide-chip${x.id === sel ? ' is-active' : ''}" data-tier="${x.id}" role="tab" aria-selected="${x.id === sel}">${dot(x)} ${esc(L(x.name))} <small>${esc(x.range)}</small></button>`).join('');
    const maxPct = Math.max(...STATS.map((s) => s.v[5] / s.v[0]));
    tableEl.innerHTML = `
      <div class="attr-row attr-head"><span>${esc(t('attr.colStat'))}</span><span>${esc(t('attr.colBase'))}</span><span>${esc(L(tier.name))}</span><span>${esc(t('attr.colGain'))}</span></div>
      ${STATS.map((s) => {
        const base = s.v[0]; const v = s.v[ti];
        const gain = (v / base - 1) * 100;
        const fmt = (x) => (s.pct ? `${fmtNum(x, 0)}%` : fmtNum(x, x < 20 ? 3 : 1));
        return `<div class="attr-row">
          <span class="attr-name">${esc(L(s.name))}</span>
          <span>${esc(fmt(base))}</span>
          <span class="attr-val" style="--c:${tier.color}">${esc(fmt(v))}</span>
          <span class="attr-gain"><i class="attr-bar" style="--w:${Math.max(0, (v / base - 1) / (maxPct - 1)) * 100}%;--c:${tier.color}"></i>${gain > 0.05 ? `+${esc(fmtNum(gain, 1))}%` : '—'}</span>
        </div>`;
      }).join('')}
      <p class="ev-legend attr-note">${esc(t('attr.note'))}</p>`;
  }
  pickEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tier]');
    if (b) { sel = b.dataset.tier; render(); }
  });
  render();
}
