// Apoie: doação pelo Mercado Pago (servidor da loja no Netlify, rota /api/createDonation),
// Pix direto (QR code "copia e cola" gerado no navegador) e mural de apoiadores (Firestore: supporters).
import { t } from '../i18n.js';
import { esc } from '../data.js';
import { loadFirebase, getUser, onUser, publicName } from '../cloud.js';

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

// ---------------------------------------------------------------- Pix "copia e cola" (BR Code estático)
function emv(id, value) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const ascii = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .-]/g, '').toUpperCase().slice(0, max);

export function pixPayload({ key, name, city, amount }) {
  const parts = [
    emv('00', '01'),
    emv('26', emv('00', 'br.gov.bcb.pix') + emv('01', key.trim())),
    emv('52', '0000'),
    emv('53', '986'),
    amount ? emv('54', Number(amount).toFixed(2)) : '',
    emv('58', 'BR'),
    emv('59', ascii(name, 25) || 'FANTASFOR'),
    emv('60', ascii(city, 15) || 'BRASIL'),
    emv('62', emv('05', '***'))
  ].join('');
  const base = `${parts}6304`;
  return base + crc16(base);
}

function loadQrLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_LIB;
    s.onload = () => resolve(window.QRCode);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function initSupportPage(root, params) {
  let config = {};
  try { config = JSON.parse(root.querySelector('#supportConfig').textContent); } catch (e) { /* usa padrão */ }
  const form = root.querySelector('#support-form');
  const amountsEl = root.querySelector('#support-amounts');
  const custom = root.querySelector('#support-custom');
  const nameEl = root.querySelector('#support-name');
  const msgEl = root.querySelector('#support-msg');
  const showEl = root.querySelector('#support-show');
  const submit = root.querySelector('#support-submit');
  const message = root.querySelector('#support-message');
  const list = root.querySelector('#support-list');
  let amount = (config.amounts || [10])[1] || 10;

  const say = (text, kind = 'info') => {
    message.hidden = !text;
    message.textContent = text || '';
    message.dataset.kind = kind;
  };
  const status = params.get('apoio');
  if (status === 'aprovado') say(t('support.thanks'), 'ok');
  if (status === 'pendente') say(t('support.pending'), 'info');
  if (status === 'recusado') say(t('support.refused'), 'error');

  // valores
  function renderAmounts() {
    amountsEl.innerHTML = (config.amounts || [5, 10, 20, 50]).map((v) => `
      <button type="button" class="support-amount" role="radio" data-amount="${v}" aria-checked="${!custom.value && v === amount}">R$ ${esc(v)}</button>`).join('');
  }
  amountsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-amount]');
    if (!b) return;
    amount = Number(b.dataset.amount);
    custom.value = '';
    renderAmounts();
  });
  custom.addEventListener('input', renderAmounts);
  renderAmounts();

  const unsub = onUser((u) => {
    if (!root.isConnected) { unsub(); return; }
    if (u && !nameEl.value) nameEl.value = publicName(u);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = custom.value ? Number(custom.value) : amount;
    if (!(value >= 2 && value <= 1000)) { say(t('support.range'), 'error'); return; }
    submit.disabled = true;
    submit.textContent = t('support.opening');
    try {
      const headers = { 'Content-Type': 'application/json' };
      const u = getUser();
      if (u) headers.Authorization = `Bearer ${await u.getIdToken()}`;
      const r = await fetch(`${String(config.apiBase).replace(/\/$/, '')}/createDonation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: value, name: nameEl.value, message: msgEl.value, show: showEl.checked })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) throw new Error(data.error || t('support.error'));
      window.location.href = data.url;
    } catch (err) {
      say(err.message || t('support.error'), 'error');
      submit.disabled = false;
      submit.textContent = t('support.button');
    }
  });

  // Pix direto
  if (config.pixKey) {
    const box = root.querySelector('#support-pix');
    const code = root.querySelector('#support-pix-code');
    box.hidden = false;
    code.value = pixPayload({ key: config.pixKey, name: config.pixName, city: config.pixCity });
    loadQrLib().then((QR) => {
      // eslint-disable-next-line no-new
      new QR(root.querySelector('#support-qr'), { text: code.value, width: 200, height: 200, correctLevel: QR.CorrectLevel.M });
    }).catch(() => { /* sem QR: o código copia e cola continua funcionando */ });
    root.querySelector('#support-pix-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code.value); } catch (err) { code.select(); document.execCommand('copy'); }
      say(t('support.pixCopied'), 'ok');
    });
  }

  // mural
  try {
    const fb = await loadFirebase();
    const { collection, query, orderBy, limit, getDocs } = fb.store;
    const snap = await getDocs(query(collection(fb.db, 'supporters'), orderBy('createdAt', 'desc'), limit(60)));
    const rows = snap.docs.map((d) => d.data());
    list.innerHTML = rows.length ? rows.map((s) => `
      <li><strong>${esc(s.name || t('support.anon'))}</strong>${s.message ? `<span>“${esc(s.message)}”</span>` : ''}</li>`).join('')
      : `<li class="support-note">${esc(t('support.first'))}</li>`;
  } catch (e) {
    list.innerHTML = `<li class="support-note">${esc(t('support.first'))}</li>`;
  }
}
