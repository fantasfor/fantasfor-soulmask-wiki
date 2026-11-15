// A página Receitas foi juntada com Itens (#itens). Links antigos (#receitas?bench=...) continuam funcionando.
export async function initRecipesPage(root, params) {
  const p = new URLSearchParams();
  if (params.get('q')) p.set('q', params.get('q'));
  if (params.get('bench')) p.set('bench', params.get('bench'));
  p.set('craft', '1');
  location.replace(`#itens?${p.toString()}`);
}
