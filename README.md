# Soulmask Database — Fantasfor Wiki

Site estático da wiki Soulmask (SPA com roteamento por hash) — rápido, acessível e pronto para GitHub Pages.

## Estrutura do projeto

- `index.html` — entrada principal do site (SPA)
- `assets/css/` — estilos modulares (`style.css` importa base, layout, componentes e páginas)
- `assets/js/` — scripts (`main.js` = roteador + páginas, `ui.js` = helpers de UI)
- `assets/data/` — dados JSON (talentos, itens, armaduras)
- `assets/img/` — imagens otimizadas (WebP)
- `components/` — pedaços HTML reutilizáveis (header, sidebar)
- `pages/` — páginas do site carregadas via hash (`#home`, `#talentos`, ...)
- `.github/workflows/` — deploy automático no GitHub Pages

## Desenvolver localmente

1. Abra um terminal na raiz do projeto.
2. Sirva os arquivos estáticos com Python:

```bash
python -m http.server 8000
# Acesse http://localhost:8000
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
- Novas páginas: crie `pages/<nome>.html`, adicione o link em `components/sidebar.html` e, se precisar de JS, registre o init no roteador em `assets/js/main.js` (`loadPageFromHash`).
- Imagens novas devem ser WebP (use Pillow: `Image.open(png).save(webp, 'WEBP', quality=85)`).
