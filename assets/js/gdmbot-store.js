// Loja do GDMbot: login com Google (Firebase Auth), compra (Mercado Pago via servidor no Netlify),
// "Minha conta" (licença lida do Firestore) e conexão do app desktop (#gdmbot?app=CODIGO).
// Configuração: bloco JSON #gdmbotStoreConfig no topo de pages/gdmbot.html.

const FIREBASE_VERSION = '10.14.1';
const SDK = (name) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`;

let firebaseCache = null;

async function loadFirebase(config) {
  if (firebaseCache) return firebaseCache;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(SDK('app')), import(SDK('auth')), import(SDK('firestore')),
  ]);
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config.firebase);
  firebaseCache = {
    auth: authMod.getAuth(app),
    authMod,
    db: storeMod.getFirestore(app),
    storeMod,
  };
  return firebaseCache;
}

// Chama uma rota do servidor (Netlify) enviando o login do Google do usuário.
async function callApi(config, fb, route, body = {}) {
  const user = fb.auth.currentUser;
  if (!user) throw Object.assign(new Error('Entre com sua conta Google.'), { code: 'unauthenticated' });
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${String(config.apiBase).replace(/\/$/, '')}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw Object.assign(new Error('Sem conexão com o servidor da loja.'), { code: 'network' });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = response.status === 409 ? 'already-exists' : `http-${response.status}`;
    throw Object.assign(new Error(data.error || 'Algo deu errado. Tente novamente.'), { code });
  }
  return data;
}

function readConfig(root) {
  try {
    return JSON.parse(root.querySelector('#gdmbotStoreConfig')?.textContent || '{}');
  } catch (error) {
    console.warn('Configuração da loja GDMbot inválida', error);
    return {};
  }
}

const isFirebaseConfigured = (config) => Boolean(
  config.firebase && config.firebase.apiKey && config.firebase.projectId && config.apiBase,
);

function friendlyError(error) {
  const code = (error && error.code) || '';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'Login cancelado.';
  if (code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login. Permita pop-ups para este site.';
  if (code.includes('unauthorized-domain')) return 'Este domínio ainda não foi autorizado no Firebase (veja o guia de configuração).';
  if (code.includes('already-exists')) return 'Sua conta já tem o GDMbot Pro.';
  if (code.includes('network')) return 'Sem conexão com a internet.';
  return (error && error.message) || 'Algo deu errado. Tente novamente.';
}

export function initGdmbotStore() {
  const root = document.querySelector('.gdmbot-page');
  if (!root || root.dataset.gdmbotReady === 'true') return;
  root.dataset.gdmbotReady = 'true';
  const config = readConfig(root);
  const params = window.getHashParams ? window.getHashParams() : new URLSearchParams();
  const el = (name) => root.querySelector(`[data-gb="${name}"]`);
  const all = (name) => root.querySelectorAll(`[data-gb="${name}"]`);

  ['price', 'priceNote', 'deliveryTime', 'priceFrom', 'discount'].forEach((key) => {
    if (config[key]) all(key).forEach((node) => { node.textContent = config[key]; });
  });
  // promoção: preço cheio riscado + desconto
  all('promo').forEach((node) => { node.hidden = !(config.priceFrom && config.discount); });

  // download
  all('download').forEach((link) => {
    if (config.downloadUrl) {
      link.href = config.downloadUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.classList.add('is-disabled');
      link.removeAttribute('href');
      link.textContent = `${link.textContent.trim()} (em breve)`;
    }
  });

  if (config.supportEmail) {
    const support = el('support');
    if (support) {
      support.textContent = 'Envie um e-mail para ';
      const mail = document.createElement('a');
      mail.href = `mailto:${config.supportEmail}`;
      mail.textContent = config.supportEmail;
      support.append(mail, ' informando o e-mail da sua conta Google.');
    }
  }

  const terms = el('terms');
  if (terms) {
    fetch('assets/data/gdmbot-termos.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => { terms.textContent = text; })
      .catch(() => { terms.textContent = 'Não foi possível carregar os termos agora.'; });
  }

  const account = el('account');
  const message = el('message');
  const show = (text, kind = 'info') => {
    if (!message) return;
    message.hidden = !text;
    message.textContent = text || '';
    message.dataset.kind = kind;
  };

  const appSession = params.get('app');
  const purchase = params.get('compra');
  if (appSession) {
    el('appBanner').hidden = false;
  }
  if (purchase === 'aprovada') show('Pagamento aprovado! Sua licença aparece abaixo em alguns segundos.', 'ok');
  if (purchase === 'pendente') show('Pagamento pendente. Assim que for aprovado (Pix/boleto), a licença aparece aqui automaticamente.', 'info');
  if (purchase === 'recusada') show('O pagamento não foi aprovado. Você pode tentar novamente com outro meio.', 'error');

  const buyButtons = all('buy');
  const setBuyState = (text, disabled) => buyButtons.forEach((btn) => {
    btn.textContent = text;
    btn.classList.toggle('is-disabled', disabled);
  });

  if (!isFirebaseConfigured(config)) {
    setBuyState('Comprar Pro (em breve)', true);
    if (account) account.innerHTML = '<p class="gb-note">As vendas abrem em breve.</p>';
    return;
  }

  let fb = null;
  let user = null;
  let license = null;
  let unsubscribeLicense = null;
  let linkedSession = false;

  const render = () => {
    if (!account) return;
    if (!user) {
      account.innerHTML = `
        <p class="gb-account-title">Minha conta</p>
        <p class="gb-note">Entre com sua conta Google para comprar e acessar sua licença.</p>
        <button type="button" class="gb-btn gb-google" data-gb-action="login">
          <span class="gb-g">G</span> Entrar com Google
        </button>`;
      setBuyState('Comprar Pro', false);
      return;
    }
    const name = user.displayName || user.email;
    const head = `
      <div class="gb-user">
        ${user.photoURL ? `<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer">` : ''}
        <div><strong></strong><span></span></div>
        <button type="button" class="gb-link" data-gb-action="logout">Sair</button>
      </div>`;
    if (license && license.status === 'active') {
      account.innerHTML = `${head}
        <p class="gb-pro-ok">Você tem o GDMbot Pro</p>
        <p class="gb-note">No GDMbot, clique em <b>ATIVAR PRO → Entrar com Google</b>. Ou copie a chave abaixo e cole no app.</p>
        <textarea class="gb-key" readonly rows="3"></textarea>
        <button type="button" class="gb-btn" data-gb-action="copy">Copiar chave</button>`;
      account.querySelector('.gb-key').value = license.key || '';
      setBuyState('✓ Você já tem o Pro', true);
    } else {
      const revoked = license && license.status === 'revoked';
      account.innerHTML = `${head}
        <p class="gb-note">${revoked ? 'Sua licença foi cancelada (reembolso/estorno).' : 'Sua conta ainda não tem o Pro.'}</p>
        <button type="button" class="gb-btn buy" data-gb-action="buy">Comprar Pro — R$ ${config.price || ''}</button>`;
      setBuyState('Comprar Pro', false);
    }
    account.querySelector('.gb-user strong').textContent = name;
    account.querySelector('.gb-user span').textContent = user.email || '';
  };

  const login = async () => {
    try {
      fb = fb || await loadFirebase(config);
      const provider = new fb.authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await fb.authMod.signInWithPopup(fb.auth, provider);
    } catch (error) {
      show(friendlyError(error), 'error');
    }
  };

  const buy = async () => {
    if (!user) {
      await login();
      if (!fb || !fb.auth.currentUser) return;
    }
    if (license && license.status === 'active') return;
    setBuyState('Abrindo pagamento…', true);
    try {
      const data = await callApi(config, fb, 'createCheckout');
      window.location.href = data.url;
    } catch (error) {
      show(friendlyError(error), 'error');
      setBuyState('Comprar Pro', false);
    }
  };

  const linkApp = async () => {
    if (!appSession || linkedSession || !user) return;
    linkedSession = true;
    try {
      const data = await callApi(config, fb, 'linkApp', { session: appSession });
      el('appBanner').innerHTML = data.hasLicense
        ? '<strong>✓ GDMbot conectado!</strong> Volte para o GDMbot: o Pro será ativado em alguns segundos.'
        : '<strong>Conta conectada, mas ainda sem o Pro.</strong> Compre abaixo e depois clique de novo em "Entrar com Google" no GDMbot.';
    } catch (error) {
      linkedSession = false;
      el('appBanner').textContent = `Não foi possível conectar o GDMbot: ${friendlyError(error)}`;
    }
  };

  account.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-gb-action]')?.dataset.gbAction;
    if (action === 'login') login();
    if (action === 'logout') fb.authMod.signOut(fb.auth);
    if (action === 'buy') buy();
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(license.key);
        show('Chave copiada!', 'ok');
      } catch (error) {
        account.querySelector('.gb-key').select();
      }
    }
  });
  buyButtons.forEach((btn) => btn.addEventListener('click', (event) => {
    event.preventDefault();
    if (!btn.classList.contains('is-disabled')) buy();
  }));
  root.querySelector('[data-gb-action="app-login"]')?.addEventListener('click', login);

  loadFirebase(config).then((loaded) => {
    fb = loaded;
    fb.authMod.onAuthStateChanged(fb.auth, (current) => {
      user = current;
      license = null;
      if (unsubscribeLicense) unsubscribeLicense();
      unsubscribeLicense = null;
      if (user) {
        const ref = fb.storeMod.doc(fb.db, 'licenses', user.uid);
        unsubscribeLicense = fb.storeMod.onSnapshot(ref, (snap) => {
          license = snap.exists() ? snap.data() : null;
          if (license && license.status === 'active' && purchase === 'aprovada') show('Licença liberada! Obrigado pela compra.', 'ok');
          render();
          linkApp();
        }, () => render());
      }
      render();
      if (user) linkApp();
    });
  }).catch((error) => {
    console.error('Firebase', error);
    show('Não foi possível carregar o login agora. Recarregue a página.', 'error');
  });
}
