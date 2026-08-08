# Soulmask Database

Base inicial para o site estático do Soulmask Database — rápido, acessível e preparado para crescer.

## Estrutura do projeto

- `index.html` — entrada principal do site
- `assets/css/` — estilos
- `assets/js/` — scripts (i18n, carregamento de componentes)
- `assets/lang/` — arquivos de idioma (JSON)
- `components/` — pedaços HTML reutilizáveis (header, footer, sidebar)
- `pages/` — páginas do site (home, etc.)
- `.github/workflows/` — workflows do CI/CD (deploy)

Cada arquivo tem uma responsabilidade única para facilitar manutenção e reuso.

## Desenvolver localmente

1. Abra um terminal na raiz do projeto.
2. Sirva os arquivos estáticos com Python (recomendado):

```bash
# Python 3
python -m http.server 8000
# Acesse http://localhost:8000
```

Obs: usar o servidor do Python evita dependências extras e é suficiente para testar o site estático.

## Publicação no GitHub Pages

Recomenda-se publicar o conteúdo no branch `main`. O repositório já contém um workflow GitHub Actions que faz deploy automático para GitHub Pages sempre que houver um `push` na branch `main`.

Comandos mínimos para iniciar um repositório e subir o site:

```bash
git init
git add .
git commit -m "Initial Soulmask Database scaffold"
git branch -M main
git remote add origin git@github.com:USERNAME/REPO.git
git push -u origin main
```

Após o push, o workflow `.github/workflows/gh-pages.yml` será executado e o site será publicado automaticamente em GitHub Pages.

### Observações sobre domínio

- Para usar um domínio customizado, adicione um arquivo `CNAME` na raiz contendo seu domínio.
- O workflow preserva automaticamente arquivos e subpastas. O arquivo `.nojekyll` está incluído para evitar processamento por Jekyll.

## Internacionalização (i18n)

Todos os textos são carregados a partir de arquivos JSON em `assets/lang/` e aplicados via `data-i18n` no HTML. Para adicionar um idioma, crie `assets/lang/xx.json` seguindo o formato existente.

## Padrões de desenvolvimento

- Evitar duplicação: componentes em `components/` devem ser reutilizados.
- Todo texto visível deve estar em arquivos de idioma — não escrever textos fixos no HTML.
- Arquivos devem ter responsabilidade única.
- Priorizar performance e acessibilidade.

## Próximos passos sugeridos

- Adicionar traduções extras (`en`, `es`).
- Criar componentes de UI adicionais (modais, tooltips, cards dinâmicos).
- Automatizar checagens de lint (opcional).

Se quiser, eu posso: adicionar traduções, configurar `CNAME`, ou ajustar o workflow para um subdiretório específico.
