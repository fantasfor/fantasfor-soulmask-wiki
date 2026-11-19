// Busca tolerante: sem acento e sem maiúsculas, palavras em qualquer ordem, sinônimos e pequenos erros de digitação.
//   const q = fuzzyQuery('pvp brasil');
//   const s = fuzzyScore(q, 'Servidor Brazil PvP ...');   // 0 = não bate; maior = mais parecido
// Cada palavra digitada precisa aparecer em algum lugar do texto. Pontos por palavra:
//   3 = aparece igual, 2.5 = por sinônimo, 1 = parecida (erro de 1 ou 2 letras, conforme o tamanho).
import { normalize } from './data.js';

// grupos de sinônimos (já sem acento)
const SYNONYMS = [
  ['br', 'brasil', 'brazil', 'brasileiro', 'brazilian', 'america do sul', 'south america', 'southamerica', 'sa'],
  ['pt', 'ptbr', 'pt-br', 'portugues', 'portuguese'],
  ['en', 'ingles', 'english'],
  ['es', 'espanol', 'espanhol', 'spanish'],
  ['eu', 'europa', 'europe'],
  ['na', 'us', 'eua', 'usa', 'america do norte', 'north america'],
  ['as', 'asia'],
  ['oficial', 'official', 'oficiais'],
  ['dlc', 'areias errantes', 'shifting sand', 'shifting sands'],
  ['floresta', 'cloud mist', 'cloud mist forest', 'floresta de nevoa nuvem'],
];

const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

// erros aceitos por palavra: até 3 letras nenhum, até 6 letras 1, mais que isso 2
const maxEdits = (n) => (n <= 3 ? 0 : n <= 6 ? 1 : 2);

// distância de edição (inserir, apagar, trocar ou inverter 2 letras), com parada antecipada
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** texto digitado -> lista de palavras (com os sinônimos de cada uma) */
export function fuzzyQuery(text) {
  return words(text).map((w) => {
    const group = SYNONYMS.find((g) => g.includes(w));
    return { w, alts: group ? group.filter((x) => x !== w) : [] };
  });
}

/** prepara o texto onde procurar (guarde o resultado se for usar várias vezes) */
export function fuzzyText(text) {
  const norm = ` ${words(text).join(' ')} `;
  return { norm, tokens: [...new Set(norm.trim().split(' '))] };
}

function termScore(term, hay) {
  const has = (x) => (x.length <= 2 ? hay.tokens.includes(x) : hay.norm.includes(x));
  if (has(term.w)) return 3;
  if (term.alts.some(has)) return 2.5;
  const max = maxEdits(term.w.length);
  if (!max) return 0;
  // parecida com alguma palavra inteira, ou com o começo dela (quem ainda está digitando)
  for (const tok of hay.tokens) {
    if (tok.length < 3) continue;
    if (editDistance(term.w, tok, max) <= max) return 1;
    if (tok.length > term.w.length && editDistance(term.w, tok.slice(0, term.w.length), max) <= max) return 1;
  }
  return 0;
}

/** 0 = alguma palavra não bate; senão, a soma dos pontos (exato > sinônimo > parecido) */
export function fuzzyScore(query, hay) {
  if (!query.length) return 1;
  const h = typeof hay === 'string' ? fuzzyText(hay) : hay;
  let total = 0;
  for (const term of query) {
    const s = termScore(term, h);
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** todas as palavras bateram igual ou por sinônimo (sem erro de digitação) */
export const isExact = (query, score) => score >= query.length * 2.5;
