// Interações da comunidade, iguais em todo o site (Tier List, Servidores, Builds publicadas e página Comunidade):
// estrelas + comentário de cada jogador e resposta do autor da publicação.
// Os dados ficam no próprio documento publicado (regras: GDMbot/servidor/firestore.rules):
//   ratings.{uid} = { s: 1..5, c?: comentário, n: nome, t: data }   -> cada um só grava/apaga a sua
//   replies.{uid} = { c: resposta, t: data }                         -> só o autor da publicação grava
import { t, locale } from './i18n.js';
import { esc, escLines } from './data.js';
import { loadFirebase, getUser, publicName } from './cloud.js';
import { summarize, starsDisplay, starsInput } from './ratings.js';

// avaliações com nota, da mais nova para a mais antiga
export function reviewList(doc) {
  return Object.entries(doc?.ratings || {})
    .map(([uid, x]) => ({ uid, ...(typeof x === 'number' ? { s: x } : x) }))
    .filter((x) => x.s >= 1 && x.s <= 5)
    .sort((a, b) => (b.t || 0) - (a.t || 0));
}

export const commentCount = (doc) => reviewList(doc).filter((x) => x.c).length;

// média bayesiana: poucas notas não dominam o topo
export function score(doc) {
  const r = summarize(doc?.ratings);
  return (r.avg * r.count + 3 * 2) / (r.count + 2);
}

// data de criação/atualização em ms (Timestamp do Firestore ou número)
export const docTime = (d, field = 'updatedAt') => {
  const v = d?.[field] ?? d?.createdAt;
  return v?.seconds ? v.seconds * 1000 : Number(v) || 0;
};

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(locale()) : '');

// bloco "Avalie" + lista de avaliações (com respostas do autor)
export function reviewsHtml(doc, { title = t('social.rateTitle'), ownText = t('social.ownPost'), placeholder = t('tier.commentPlaceholder') } = {}) {
  const u = getUser();
  const own = Boolean(u && u.uid === doc.uid);
  const mine = u ? reviewList(doc).find((x) => x.uid === u.uid) : null;
  const reviews = reviewList(doc);
  const replies = doc.replies || {};
  const r = summarize(doc.ratings);
  return `<section class="tier-review-box social-reviews" data-social>
    <h3>${esc(title)} <span class="social-count">${esc(t('social.reviewsN', { n: r.count }))} · ${esc(t('social.commentsN', { n: commentCount(doc) }))}</span></h3>
    ${own ? `<p class="tier-muted">${esc(ownText)}</p>` : !u ? `<p class="tier-muted">${esc(t('rating.loginToRate'))} <button type="button" class="tier-btn social-login" data-social-login>${esc(t('account.login'))}</button></p>` : `
      <form class="tier-review-form" data-review>
        ${starsInput(mine?.s || 0)}
        <textarea class="tier-entry-input tier-textarea" name="comment" maxlength="300" rows="2" placeholder="${esc(placeholder)}">${esc(mine?.c || '')}</textarea>
        <div class="tier-publish-actions">
          <button type="submit" class="tier-btn primary">${esc(t(mine ? 'social.updateReview' : 'tier.sendReview'))}</button>
          ${mine ? `<button type="button" class="tier-btn danger" data-review-del>${esc(t('social.deleteReview'))}</button>` : ''}
          <span class="tier-muted" data-review-status aria-live="polite"></span>
        </div>
      </form>`}
    <ul class="tier-reviews">${reviews.map((x) => {
      const rep = replies[x.uid];
      return `<li class="${u && x.uid === u.uid ? 'is-mine' : ''}">
        <span class="tier-review-head"><strong>${esc(x.n || t('account.anonymous'))}</strong>${starsDisplay(x.s, 1, { compact: true })}${x.t ? `<time class="social-date">${esc(fmtDate(x.t))}</time>` : ''}</span>
        ${x.c ? `<p>${escLines(x.c)}</p>` : ''}
        ${rep?.c ? `<div class="social-reply"><strong>${esc(t('social.authorReply'))}</strong><p>${escLines(rep.c)}</p></div>` : ''}
        ${own && x.c ? `<details class="social-reply-form">
          <summary>${esc(t(rep?.c ? 'social.editReply' : 'social.reply'))}</summary>
          <form data-reply="${esc(x.uid)}">
            <textarea class="tier-entry-input tier-textarea" name="reply" maxlength="300" rows="2" placeholder="${esc(t('social.replyPh'))}">${esc(rep?.c || '')}</textarea>
            <div class="tier-publish-actions">
              <button type="submit" class="tier-btn">${esc(t('social.sendReply'))}</button>
              <span class="tier-muted" data-reply-status aria-live="polite"></span>
            </div>
          </form>
        </details>` : ''}
      </li>`;
    }).join('') || `<li class="tier-muted">${esc(t('tier.noReviews'))}</li>`}</ul>
  </section>`;
}

// Liga os eventos do bloco de avaliações dentro de "container" (uma vez só).
//   coll: coleção do Firestore ('tierlists', 'servers', 'builds')
//   getDoc(): documento aberto agora ({ id, uid, ratings, replies, ... })
//   ownerExtra(): campos extras que o autor precisa gravar junto (ex.: servidores exigem updatedAt)
//   onChange(doc): chamado depois de salvar (para redesenhar)
export function bindReviews(container, { coll, getDoc, ownerExtra = null, onChange = () => {} }) {
  const ref = async (doc) => {
    const fb = await loadFirebase();
    return { fb, r: fb.store.doc(fb.db, typeof coll === 'function' ? coll(doc) : coll, doc.id) };
  };

  container.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-social]')) return;
    if (e.target.closest('[data-social-login]')) {
      const { requireUser } = await import('./cloud.js');
      await requireUser();
      return;
    }
    const star = e.target.closest('[data-star]');
    if (star) {
      const form = star.closest('form');
      form.dataset.stars = star.dataset.star;
      form.querySelectorAll('[data-star]').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.star) <= Number(star.dataset.star));
        b.setAttribute('aria-checked', String(b === star));
      });
      return;
    }
    if (e.target.closest('[data-review-del]')) {
      const doc = getDoc();
      const u = getUser();
      if (!doc || !u || !window.confirm(t('social.deleteReviewConfirm'))) return;
      const st = container.querySelector('[data-review-status]');
      try {
        const { fb, r } = await ref(doc);
        await fb.store.updateDoc(r, { [`ratings.${u.uid}`]: fb.store.deleteField() });
        const next = { ...(doc.ratings || {}) };
        delete next[u.uid];
        doc.ratings = next;
        onChange(doc);
      } catch (err) {
        console.warn('delete review', err);
        if (st) st.textContent = t('tier.saveError');
      }
    }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.closest('[data-social]')) return;
    e.preventDefault();
    const doc = getDoc();
    const u = getUser();
    if (!doc || !u) return;

    if (form.matches('[data-review]')) {
      const st = form.querySelector('[data-review-status]');
      const stars = Number(form.dataset.stars || reviewList(doc).find((x) => x.uid === u.uid)?.s || 0);
      if (!stars) { st.textContent = t('tier.pickStars'); return; }
      const review = { s: stars, n: publicName(u), t: Date.now() };
      const c = form.elements.comment.value.trim().slice(0, 300);
      if (c) review.c = c;
      st.textContent = t('account.syncing');
      try {
        const { fb, r } = await ref(doc);
        await fb.store.updateDoc(r, { [`ratings.${u.uid}`]: review });
        doc.ratings = { ...(doc.ratings || {}), [u.uid]: review };
        onChange(doc);
      } catch (err) {
        console.warn('review', err);
        st.textContent = t('tier.saveError');
      }
      return;
    }

    if (form.matches('[data-reply]') && u.uid === doc.uid) {
      const st = form.querySelector('[data-reply-status]');
      const who = form.dataset.reply;
      const c = form.elements.reply.value.trim().slice(0, 300);
      st.textContent = t('account.syncing');
      try {
        const { fb, r } = await ref(doc);
        const reply = { c, t: Date.now() };
        await fb.store.updateDoc(r, {
          [`replies.${who}`]: c ? reply : fb.store.deleteField(),
          ...(ownerExtra ? ownerExtra(fb, doc) : {})
        });
        const next = { ...(doc.replies || {}) };
        if (c) next[who] = reply; else delete next[who];
        doc.replies = next;
        onChange(doc);
      } catch (err) {
        console.warn('reply', err);
        st.textContent = t('tier.saveError');
      }
    }
  });
}

// resumo curto para cartões: estrelas + nº de comentários
export function cardStats(doc) {
  const r = summarize(doc.ratings);
  const n = commentCount(doc);
  return `${starsDisplay(r.avg, r.count, { compact: true })}<span class="social-mini" title="${esc(t('social.commentsN', { n }))}">${esc(t('social.commentsShort', { n }))}</span>`;
}
