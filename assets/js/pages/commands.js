// Comandos de console (GM e RCON): lista explicada + busca por frase ("quero invocar um lacaio").
// Dados: assets/data/commands.json (comandos lidos da DLL do jogo; textos escritos para o site).
import { t, getLang } from '../i18n.js';
import { loadData, esc, normalize } from '../data.js';

const STOP = new Set(('quero queria preciso como faco faz fazer eu um uma uns umas o a os as de do da dos das no na nos nas em para pra pro por com '
  + 'meu minha meus minhas que e ou se ao aos algum alguma todo toda comando cmd gm jogo soulmask '
  + 'i want wanna need how to do the a an of for in on my me with command can is it').split(' '));
// grupos de palavras com o mesmo sentido (PT e EN)
const SYN = [
  'invocar criar spawnar spawn gerar nascer summon colocar fazer aparecer create',
  'lacaio tribal tribais seguidor seguidores minion tribesman npc companheiro ajudante servo membro recruta',
  'remover tirar apagar deletar excluir remove delete limpar clear',
  'talento talentos talent trait traits',
  'teleportar teleporte teleport tp viajar ir go mover',
  'voar voo fly noclip fantasma ghost atravessar',
  'dinheiro money moeda moedas ouro gold',
  'experiencia xp exp nivel level upar subir evoluir',
  'item itens dar give recurso recursos material',
  'animal animais montaria pet bicho domar tame',
  'mapa map revelar descobrir',
  'tecnologia tech receitas desbloquear unlock',
  'invisivel invisibilidade esconder furtivo stealth',
  'reviver ressuscitar revive morto',
  'hora tempo dia noite time',
  'banir ban kick expulsar',
  'senha password admin login',
  'salvar save backup',
  'tribo tribe cla guild',
  'construcao construcoes base predio building destruir',
  'invasao invasoes calor heat ataque',
  'maestria mastery habilidade skill',
  'proficiencia proficiency'
].map((g) => g.split(' '));
const synOf = new Map();
SYN.forEach((g) => g.forEach((w) => synOf.set(w, g)));
const EXAMPLES = ['cmd.ex1', 'cmd.ex2', 'cmd.ex3', 'cmd.ex4', 'cmd.ex5', 'cmd.ex6'];

const stem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w);
const tokens = (s) => normalize(s).replace(/[^a-z0-9_ ]+/g, ' ').split(/\s+/).filter(Boolean);

export async function initCommandsPage(root, params) {
  const input = root.querySelector('#cmd-search');
  const exEl = root.querySelector('#cmd-examples');
  const catsEl = root.querySelector('#cmd-cats');
  const count = root.querySelector('#db-count');
  const list = root.querySelector('#db-container');
  let data;
  try {
    data = await loadData('commands');
  } catch (e) {
    list.innerHTML = `<div class="items-error">${esc(t('common.errorLoading', { msg: e.message }))}</div>`;
    return;
  }
  const lang = () => (getLang() === 'en' ? 'en' : 'pt');
  const cmds = data.list.map((c, i) => ({
    ...c,
    i,
    name: tokens(`${c.c} ${c.alt || ''}`.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')),
    words: new Set(tokens(`${c.k} ${c.pt} ${c.en}`)),
    kw: new Set(tokens(c.k))
  }));
  let cat = 'all';
  if (params?.get('q')) input.value = params.get('q');

  function score(c, qTokens) {
    let s = 0; let hit = 0;
    qTokens.forEach((tok) => {
      const group = synOf.get(tok) || [tok];
      let best = 0;
      group.forEach((w) => {
        const st = stem(w);
        if (c.c.toLowerCase() === w || (c.alt || '').toLowerCase() === w) best = Math.max(best, 6);
        if (c.name.some((n) => n.startsWith(st))) best = Math.max(best, 3);
        if ([...c.kw].some((k) => k.startsWith(st) || (k.length > 4 && st.startsWith(stem(k))))) best = Math.max(best, w === tok ? 3 : 2);
        else if ([...c.words].some((k) => k.startsWith(st))) best = Math.max(best, 1);
      });
      if (best) hit += 1;
      s += best;
    });
    // frases com várias ideias: vale mais quem cobre todas
    return hit ? s * (hit / qTokens.length) : 0;
  }

  function cardHtml(c) {
    const L = lang();
    const prefix = c.rcon ? '' : 'gm ';
    const syntax = `${prefix}${c.c}${c.a.map((a) => ` <${a[L === 'en' ? 1 : 0]}>`).join('')}`;
    return `<article class="cmd-card">
      <header>
        <code class="cmd-name">${esc(prefix)}${esc(c.c)}</code>
        ${c.alt ? `<span class="cmd-alt" title="${esc(t('cmd.altTitle'))}">${esc(c.alt)}</span>` : ''}
        <span class="cmd-cat">${esc(data.cats[c.cat]?.[L] || c.cat)}</span>
        ${c.rcon ? '<span class="cmd-rcon">RCON</span>' : ''}
      </header>
      <p>${esc(c[L])}</p>
      <div class="cmd-syntax"><span>${esc(t('cmd.syntax'))}</span><code>${esc(syntax)}</code></div>
      ${c.a.length ? `<ul class="cmd-args">${c.a.map((a) => `<li><code>${esc(a[L === 'en' ? 1 : 0])}</code><small>${esc(t(`cmd.type.${a[2]}`))}</small></li>`).join('')}</ul>` : ''}
      <footer>
        <code class="cmd-ex">${esc(c.ex)}</code>
        <button type="button" class="map-btn map-btn-sm" data-copy="${esc(c.ex)}">${esc(t('cmd.copy'))}</button>
        ${c.link ? `<a class="mp-link" href="#${esc(c.link)}">${esc(t('cmd.seePage'))}</a>` : ''}
      </footer>
    </article>`;
  }

  function render() {
    const L = lang();
    catsEl.innerHTML = [['all', t('cmd.all')], ...Object.entries(data.cats).map(([k, v]) => [k, v[L]])]
      .map(([k, label]) => `<button type="button" class="guide-chip${k === cat ? ' is-active' : ''}" aria-pressed="${k === cat}" data-cat="${esc(k)}">${esc(label)}</button>`).join('');
    exEl.innerHTML = `<span>${esc(t('cmd.tryThis'))}</span>${EXAMPLES.map((k) => `<button type="button" class="cmd-example" data-example="${esc(t(k))}">${esc(t(k))}</button>`).join('')}`;
    const q = tokens(input.value).filter((w) => !STOP.has(w));
    let out = cmds.filter((c) => cat === 'all' || c.cat === cat);
    if (q.length) {
      out = out.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.c.i - b.c.i).map((x) => x.c);
    }
    count.textContent = t('cmd.count', { n: out.length });
    list.innerHTML = out.map(cardHtml).join('') || `<div class="items-no-results">${esc(t('cmd.none'))}</div>`;
  }

  input.addEventListener('input', render);
  catsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    render();
  });
  exEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-example]');
    if (!b) return;
    input.value = b.dataset.example;
    cat = 'all';
    render();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch (err) { /* ignora */ }
    b.textContent = t('map.copied');
    setTimeout(() => { if (b.isConnected) b.textContent = t('cmd.copy'); }, 1400);
  });
  window.addEventListener('langchange', () => { if (list.isConnected) render(); });
  render();
}
