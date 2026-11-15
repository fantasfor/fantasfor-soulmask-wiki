// Eventos de invasão: linha do tempo de 24 h com o horário de cada esquadrão por região,
// convertida para o fuso de quem visita. Dados: assets/data/events.json ("squads", em UTC; ver tools/build_guides.py).
import { t, pick, locale } from '../i18n.js';
import { loadData, esc } from '../data.js';

const LS_KEY = 'events_tl_v1';

const tzOffset = () => -new Date().getTimezoneOffset() / 60; // horas

// deslocamento (em horas) de um fuso IANA agora, já contando horário de verão
function zoneOffset(tz, date = new Date()) {
  try {
    const p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date).forEach(({ type, value }) => { p[type] = value; });
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    const base = Math.floor(date.getTime() / 60000) * 60000;
    return Math.round((asUtc - base) / 60000) / 60;
  } catch (e) { return null; }
}
const fmtOff = (off) => {
  const s = off < 0 ? '-' : '+'; const a = Math.abs(off); const h = Math.floor(a); const m = Math.round((a - h) * 60);
  return `UTC${s}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
// todos os fusos que o navegador conhece, ordenados pelo deslocamento
function allZones() {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch (e) { list = []; }
  if (!list.length) {
    list = ['Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
      'America/Caracas', 'America/Sao_Paulo', 'America/Noronha', 'Atlantic/Azores', 'Europe/London', 'Europe/Paris', 'Europe/Athens',
      'Europe/Moscow', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo',
      'Australia/Sydney', 'Pacific/Auckland'];
  }
  const now = new Date();
  return list.map((z) => ({ z, off: zoneOffset(z, now) }))
    .filter((x) => x.off !== null)
    .sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
}
const mod24 = (h) => ((h % 24) + 24) % 24;
const fmtH = (h) => { const x = mod24(h); const hh = Math.floor(x); const mm = Math.round((x - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

// intervalo [a,b) em horas (pode virar o dia) -> pedaços dentro de 0..24
function pieces(a, b) {
  let len = b - a;
  if (len <= 0) len += 24;          // ex.: 22h - 2h
  if (len >= 24) return [[0, 24]];
  const s = mod24(a);
  return s + len <= 24 ? [[s, s + len]] : [[s, 24], [0, s + len - 24]];
}

export async function initEventsPage(root) {
  const regionEl = root.querySelector('#ev-region');
  const tzEl = root.querySelector('#ev-tz');
  const sqEl = root.querySelector('#ev-squads');
  const sqNextEl = root.querySelector('#ev-squads-next');
  let data;
  try {
    data = await loadData('events');
  } catch (e) {
    sqEl.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  // preenche o seletor com todos os fusos (depois de "Meu fuso horário" e "UTC")
  const frag = document.createDocumentFragment();
  allZones().forEach(({ z, off }) => {
    const o = document.createElement('option');
    o.value = z;
    o.textContent = `(${fmtOff(off)}) ${z.replace(/_/g, ' ').replace(/\//g, ' / ')}`;
    frag.appendChild(o);
  });
  tzEl.appendChild(frag);

  let st = {};
  try { st = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { st = {}; }
  if (st.region) regionEl.value = st.region;
  if (st.tz) tzEl.value = st.tz;
  if (!tzEl.value) tzEl.value = 'local';

  function render() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...st, region: regionEl.value, tz: tzEl.value })); } catch (e) { /* ignora */ }
    const tz = tzEl.value;
    const off = tz === 'utc' ? 0 : (tz === 'local' ? tzOffset() : (zoneOffset(tz) ?? tzOffset()));
    const now = new Date();
    const nowH = mod24(now.getUTCHours() + now.getUTCMinutes() / 60 + off);
    const rows = (data.squads || []).map((s) => ({ label: pick(s, 'name'), spans: s.times[regionEl.value] ? [s.times[regionEl.value]] : [] }));
    const hours = Array.from({ length: 25 }, (_, h) => h);
    sqEl.innerHTML = `
      <div class="ev-axis">${hours.filter((h) => h % 3 === 0).map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, '0')}h</span>`).join('')}</div>
      ${rows.map((r) => `
        <div class="ev-row ev-row-squad">
          <span class="ev-label">${esc(r.label)}</span>
          <div class="ev-track">
            ${hours.slice(0, 24).map((h) => `<i class="ev-tick" style="left:${(h / 24) * 100}%"></i>`).join('')}
            ${r.spans.flatMap(([a, b]) => pieces(a + off, b + off).map(([x, y]) => {
    const label = `${fmtH(a + off)} - ${fmtH(b + off)}`;
    return `<span class="ev-bar" style="left:${(x / 24) * 100}%;width:${((y - x) / 24) * 100}%" title="${esc(label)}">${y - x >= 2 ? esc(label) : ''}</span>`;
  })).join('')}
            <i class="ev-now" style="left:${(nowH / 24) * 100}%" title="${esc(t('events.now'))}"></i>
          </div>
        </div>`).join('')}
      <p class="ev-legend">${esc(t('events.nowIs', { h: fmtH(nowH), tz: tz === 'utc' ? 'UTC' : fmtOff(off) }))}</p>`;

    // agora / próximo de cada esquadrão
    const dur = (h) => t('events.inHours', { h: Math.floor(h), m: String(Math.round((h % 1) * 60)).padStart(2, '0') });
    sqNextEl.innerHTML = rows.map((r) => {
      let best = null; let active = null;
      r.spans.forEach(([a, b]) => {
        const inside = pieces(a + off, b + off).some(([x, y]) => nowH >= x && nowH < y);
        // termina no fim real do intervalo (mesmo quando ele vira o dia)
        if (inside) active = { left: mod24(b + off - nowH) };
        const start = mod24(a + off - nowH);
        if (!inside && (best === null || start < best)) best = start;
      });
      const txt = active ? t('events.activeEnds', { d: dur(active.left) })
        : (best !== null ? t('events.startsIn', { d: dur(best) }) : t('events.off'));
      return `<div class="ev-next-item${active ? ' is-active' : ''}"><strong>${esc(r.label)}</strong><span>${esc(txt)}</span></div>`;
    }).join('');
  }

  // relógio: segue o fuso escolhido em "Mostrar horários em"
  const clockTime = root.querySelector('#ev-clock-time');
  const clockDate = root.querySelector('#ev-clock-date');
  const clockZone = root.querySelector('#ev-clock-zone');
  function tickClock() {
    if (!clockTime) return;
    const tz = tzEl.value;
    const zone = tz === 'utc' ? 'UTC' : (tz === 'local' ? undefined : tz);
    const now = new Date();
    let timeStr; let dateStr;
    try {
      timeStr = new Intl.DateTimeFormat(locale(), { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
      dateStr = new Intl.DateTimeFormat(locale(), { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    } catch (e) {
      timeStr = now.toLocaleTimeString(); dateStr = now.toLocaleDateString();
    }
    const off = tz === 'utc' ? 0 : (tz === 'local' ? tzOffset() : (zoneOffset(tz) ?? tzOffset()));
    const name = tz === 'utc' ? 'UTC' : (tz === 'local' ? t('events.tzLocal') : tz.replace(/_/g, ' ').replace(/\//g, ' / '));
    clockTime.textContent = timeStr;
    clockDate.textContent = dateStr;
    clockZone.textContent = tz === 'utc' ? 'UTC+00:00' : `${name} · ${fmtOff(off)}`;
  }

  [regionEl, tzEl].forEach((el) => el.addEventListener('input', () => { render(); tickClock(); }));
  render();
  tickClock();
  let lastMin = new Date().getMinutes();
  const timer = setInterval(() => {
    if (!sqEl.isConnected) { clearInterval(timer); return; }
    tickClock();
    const m = new Date().getMinutes();
    if (m !== lastMin) { lastMin = m; render(); } // a linha do tempo atualiza a cada minuto
  }, 1000);
}
