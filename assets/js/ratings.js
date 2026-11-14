// Estrelas (1 a 5): exibição da média e botões para votar. Usado na Tier List e nos Talentos.
import { t } from './i18n.js';
import { esc, fmtNum } from './data.js';

// ratings = { uid: 4 } ou { uid: { s: 4, ... } }
export function summarize(ratings) {
  const vals = Object.values(ratings || {}).map((r) => (typeof r === 'number' ? r : r?.s)).filter((s) => s >= 1 && s <= 5);
  const count = vals.length;
  return { count, avg: count ? vals.reduce((a, b) => a + b, 0) / count : 0 };
}

export function starsDisplay(avg, count, { compact = false } = {}) {
  const pct = Math.max(0, Math.min(100, (avg / 5) * 100));
  const label = count ? t('rating.summary', { avg: fmtNum(avg, 1), n: count }) : t('rating.none');
  return `<span class="stars-display" title="${esc(label)}" aria-label="${esc(label)}">
    <span class="stars-track" aria-hidden="true">★★★★★<span class="stars-fill" style="width:${pct}%">★★★★★</span></span>
    ${compact ? (count ? `<span class="stars-num">${esc(fmtNum(avg, 1))}</span>` : '') : `<span class="stars-num">${esc(count ? `${fmtNum(avg, 1)} (${count})` : t('rating.none'))}</span>`}
  </span>`;
}

// botões de voto; data-star="n" em cada um
export function starsInput(value = 0, { disabled = false } = {}) {
  return `<span class="stars-input" role="radiogroup" aria-label="${esc(t('rating.yourRating'))}">${[1, 2, 3, 4, 5].map((n) => `
    <button type="button" class="star-btn${n <= value ? ' is-on' : ''}" data-star="${n}" role="radio" aria-checked="${n === value}" aria-label="${esc(t('rating.nStars', { n }))}" ${disabled ? 'disabled' : ''}>★</button>`).join('')}</span>`;
}
