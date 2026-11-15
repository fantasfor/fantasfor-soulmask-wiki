# Soulmask Fantasfor Wiki

Site estático da wiki Soulmask (SPA com roteamento por hash) — rápido, acessível e pronto para GitHub Pages.

> **Todos os direitos reservados.** Este repositório é público só para publicar o site; o código, o design e os textos não podem ser copiados nem reutilizados sem autorização. Veja [LICENSE](LICENSE). Soulmask e seus dados, imagens e ícones pertencem à CampFire Studio e à Qooland Games; este é um site de fã sem vínculo oficial.

## Estrutura do projeto

- `index.html` — entrada principal do site (SPA)
- `assets/css/` — estilos modulares (`style.css` importa base, layout, componentes e páginas)
- `assets/js/` — scripts:
  - `main.js` — roteador, busca global, troca de idioma e home
  - `i18n.js` — textos da interface em português e inglês
  - `data.js` — carregamento dos dados, formatação de atributos e janela de detalhes do item
  - `pages/*.js` — uma página por arquivo (itens, talentos, Builder Maker, tier list...)
- `assets/data/` — dados do jogo em JSON, gerados por `tools/build_data.py` (PT + EN)
- `assets/img/game/` — ícones oficiais do jogo (WebP), gerados pelo mesmo script
- `components/` — pedaços HTML reutilizáveis (header, sidebar)
- `pages/` — páginas do site carregadas via hash (`#home`, `#talentos`, ...)
- `tools/` — extração dos dados do Soulmask Modkit (veja `tools/COMO_ATUALIZAR.md`)
- `.github/workflows/` — deploy automático no GitHub Pages

## Idiomas

O site tem português e inglês (botões PT/EN na barra lateral, ou `?lang=en` na URL).
Textos fixos usam `data-i18n="chave"` no HTML; as chaves ficam em `assets/js/i18n.js`.
Os dados do jogo já vêm com `name_pt`/`name_en`, `desc_pt`/`desc_en` etc.

## Atualizar os dados do jogo

```bash
python tools/build_data.py
```

Detalhes em [tools/COMO_ATUALIZAR.md](tools/COMO_ATUALIZAR.md).

## Desenvolver localmente

1. Abra um terminal na raiz do projeto.
2. Sirva os arquivos estáticos com Python:

```bash
python tools/dev_server.py 8000
# Acesse http://localhost:8000  (servidor sem cache, sempre mostra a versão mais nova)
```

> Abrir `index.html` direto via `file://` não funciona (fetch de páginas/componentes é bloqueado).

## Publicação no GitHub Pages

O workflow `.github/workflows/gh-pages.yml` faz deploy automático a cada `push` na branch `main`.

1. Suba o código:

```bash
git add .
git commit -m "Site otimizado"
git push origin main
```

2. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. O site será publicado em `https://<usuario>.github.io/<repositorio>/`.

> Todos os caminhos do site são relativos (`assets/...`, `pages/...`), então funciona tanto em domínio raiz quanto em subpasta de projeto.
> O arquivo `.nojekyll` está incluído para evitar processamento Jekyll caso o deploy por branch seja usado.

### Domínio customizado (opcional)

Adicione um arquivo `CNAME` na raiz contendo seu domínio e configure o DNS.

## Padrões de desenvolvimento

- Cada arquivo tem uma responsabilidade única.
- Novas páginas: crie `pages/<nome>.html`, adicione o link em `components/sidebar.html` (com `data-i18n`) e, se precisar de JS, crie `assets/js/pages/<nome>.js` e registre em `PAGE_INIT` no `assets/js/main.js`.
- Imagens novas devem ser WebP (use Pillow: `Image.open(png).save(webp, 'WEBP', quality=85)`).
