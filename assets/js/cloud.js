// Conta do site (login com Google via Firebase) e sincronização das configurações do usuário
// (builds, tier lists, favoritos) entre computadores. Usa o mesmo projeto Firebase da loja do GDMbot.
// Regras de acesso do banco: GDMbot/servidor/firestore.rules
import { t } from './i18n.js';
import { esc } from './data.js';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDaUlPpU9DZxLqxIINrvsUeWNdv8J-FmkU',
  authDomain: 'gdmbot-141e7.firebaseapp.com',
  projectId: 'gdmbot-141e7',
  appId: '1:671420542572:web:af2972da507c63631f7249'
};
const FIREBASE_VERSION = '10.14.1';
const SDK = (name) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`;

// chaves do localStorage que acompanham a conta
const SYNC_KEYS = {
  soulmask_builder_builds_v3: 'builds',
  'soulmask-tier-armor-v2': 'replace',
  'soulmask-tier-weapon-v2': 'replace',
  'soulmask-tier-mask-v2': 'replace',
  'soulmask-tier-lists': 'replace',
  talents_favorites_v2: 'union',
  'soulmask-map-markers': 'replace'
};
const META_KEY = 'cloud_sync_meta';

let fbPromise = null;
let user = null;
let ready = false;
const listeners = new Set();
let suppress = false;
let uploadTimer = null;
let status = '';

export function loadFirebase() {
  if (!fbPromise) {
    fbPromise = Promise.all([import(SDK('app')), import(SDK('auth')), import(SDK('firestore'))])
      .then(([appMod, authMod, store]) => {
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
        return { auth: authMod.getAuth(app), authMod, db: store.getFirestore(app), store };
      })
      .catch((e) => { fbPromise = null; throw e; });
  }
  return fbPromise;
}

export const getUser = () => user;
export const isReady = () => ready;

// cb(user) agora e a cada login/logout
export function onUser(cb) {
  listeners.add(cb);
  if (ready) cb(user);
  return () => listeners.delete(cb);
}

function emit() {
  listeners.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
  renderWidgets();
}

export async function login() {
  const fb = await loadFirebase();
  const provider = new fb.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const r = await fb.authMod.signInWithPopup(fb.auth, provider);
    return r.user;
  } catch (e) {
    const code = e?.code || '';
    if (code.includes('popup-closed') || code.includes('cancelled-popup')) return null;
    alert(code.includes('popup-blocked') ? t('account.popupBlocked') : t('account.loginError'));
    return null;
  }
}

export async function logout() {
  const fb = await loadFirebase();
  await fb.authMod.signOut(fb.auth);
}

// nome público curto (usado nas tier lists e avaliações)
export function publicName(u = user) {
  return (u?.displayName || (u?.email || '').split('@')[0] || t('account.anonymous')).slice(0, 60);
}

// ------------------------------------------------------------------ sincronização
function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function writeMeta(m) {
  try { Storage.prototype.setItem.call(localStorage, META_KEY, JSON.stringify(m)); } catch (e) { /* ignora */ }
}

// marca a hora da alteração local e agenda o envio para a conta
function patchStorage() {
  const original = Storage.prototype.setItem;
  if (original._cloudPatched) return;
  const patched = function setItem(key, value) {
    original.call(this, key, value);
    if (this === localStorage && SYNC_KEYS[key] && !suppress) {
      const m = readMeta();
      m[key] = Date.now();
      writeMeta(m);
      scheduleUpload();
    }
  };
  patched._cloudPatched = true;
  Storage.prototype.setItem = patched;
}

function setLocal(key, value) {
  suppress = true;
  try { localStorage.setItem(key, value); } catch (e) { /* ignora */ } finally { suppress = false; }
}

function parse(v, fallback) {
  try { const x = JSON.parse(v); return x ?? fallback; } catch (e) { return fallback; }
}

function mergeBuilds(a, b) {
  const map = new Map();
  [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach((x) => {
    if (!x || !x.id) return;
    const cur = map.get(x.id);
    if (!cur || String(x.updatedAt || '') > String(cur.updatedAt || '')) map.set(x.id, x);
  });
  return [...map.values()].sort((x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || '')));
}

async function syncDown() {
  if (!user) return;
  const fb = await loadFirebase();
  setStatus('syncing');
  try {
    const snap = await fb.store.getDoc(fb.store.doc(fb.db, 'users', user.uid));
    const remote = (snap.exists() && snap.data().sync) || {};
    const meta = readMeta();
    let changed = false;
    Object.entries(SYNC_KEYS).forEach(([key, mode]) => {
      const local = localStorage.getItem(key);
      const r = remote[key];
      if (!r || typeof r.v !== 'string') return;
      let next = null;
      if (mode === 'builds') {
        next = JSON.stringify(mergeBuilds(parse(local, []), parse(r.v, [])));
      } else if (mode === 'union') {
        next = JSON.stringify([...new Set([...parse(local, []), ...parse(r.v, [])])]);
      } else if (!local || (r.t || 0) > (meta[key] || 0)) {
        next = r.v;
      }
      if (next !== null && next !== local) {
        setLocal(key, next);
        meta[key] = Math.max(meta[key] || 0, r.t || 0);
        changed = true;
      }
    });
    writeMeta(meta);
    await upload();
    if (changed) window.dispatchEvent(new CustomEvent('cloud-synced'));
  } catch (e) {
    console.warn('sync', e);
    setStatus('error');
  }
}

function scheduleUpload() {
  if (!user) return;
  clearTimeout(uploadTimer);
  setStatus('pending');
  uploadTimer = setTimeout(upload, 1500);
}

async function upload() {
  if (!user) return;
  const fb = await loadFirebase();
  const meta = readMeta();
  const sync = {};
  Object.keys(SYNC_KEYS).forEach((key) => {
    const v = localStorage.getItem(key);
    if (v !== null) sync[key] = { v, t: meta[key] || Date.now() };
  });
  try {
    await fb.store.setDoc(fb.store.doc(fb.db, 'users', user.uid), { sync, updatedAt: fb.store.serverTimestamp() }, { merge: true });
    setStatus('ok');
  } catch (e) {
    console.warn('upload', e);
    setStatus('error');
  }
}

// ------------------------------------------------------------------ widget da conta (barra lateral)
const widgets = new Set();

function setStatus(s) {
  status = s;
  renderWidgets();
}

function renderWidgets() {
  widgets.forEach((w) => {
    if (!w.isConnected) { widgets.delete(w); return; }
    if (!ready) {
      w.innerHTML = '';
      return;
    }
    if (!user) {
      w.innerHTML = `<button type="button" class="account-login" data-account="login" title="${esc(t('account.loginHint'))}"><span class="account-g">G</span> ${esc(t('account.login'))}</button>`;
      return;
    }
    const st = { syncing: t('account.syncing'), pending: t('account.syncing'), ok: t('account.synced'), error: t('account.syncError') }[status] || '';
    w.innerHTML = `
      <div class="account-user">
        ${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />` : '<span class="account-avatar"></span>'}
        <div class="account-text">
          <strong>${esc(publicName())}</strong>
          <span class="account-status account-status-${esc(status)}">${esc(st)}</span>
        </div>
        <button type="button" class="account-logout" data-account="logout">${esc(t('account.logout'))}</button>
      </div>`;
  });
}

export function mountAccountWidget(container) {
  if (!container || widgets.has(container)) return;
  widgets.add(container);
  container.addEventListener('click', (e) => {
    const a = e.target.closest('[data-account]')?.dataset.account;
    if (a === 'login') login();
    if (a === 'logout') logout();
  });
  renderWidgets();
}

window.addEventListener('langchange', renderWidgets);

export function initCloud() {
  patchStorage();
  loadFirebase().then((fb) => {
    fb.authMod.onAuthStateChanged(fb.auth, (u) => {
      const changed = (u?.uid || null) !== (user?.uid || null);
      user = u;
      ready = true;
      status = '';
      emit();
      if (u && changed) syncDown();
    });
  }).catch((e) => {
    console.warn('Firebase indisponível', e);
    ready = true;
    emit();
  });
}

// pede login quando a ação precisa de conta; retorna o usuário ou null
export async function requireUser() {
  if (user) return user;
  return (await login()) || user;
}
