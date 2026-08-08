# Publicar site no GitHub Pages

Esta pasta contém instruções rápidas para publicar o site `Soulmask_Database` no GitHub Pages.

Opções suportadas:

- **A: Usar `docs/` na branch `main` (recomendado para sites estáticos simples)**

  1. Crie um repositório no GitHub (por exemplo `username/soulmask-database`).
  2. No seu projeto local, mova ou copie todos os arquivos do site para uma pasta `docs` na raiz do repositório. Exemplos: `index.html`, `pages/`, `assets/`, etc.

     ```bash
     mkdir docs
     cp -r index.html pages assets imagens_exportadas docs/
     ```

  3. Inicialize o repositório (se ainda não):

     ```bash
     git init
     git add .
     git commit -m "Site: Preparar docs para GitHub Pages"
     git branch -M main
     git remote add origin https://github.com/<seu-usuario>/<seu-repo>.git
     git push -u origin main
     ```

  4. No GitHub: vá em _Settings_ → _Pages_ → _Build and deployment_ → _Source_ e selecione `Branch: main` e `Folder: /docs`.
  5. Salve. O GitHub publicará o site em `https://<seu-usuario>.github.io/<seu-repo>/`.

- **B: Usar branch `gh-pages` (útil se não quiser usar `docs/`)**

  1. Crie o repositório no GitHub.
  2. Gere uma cópia limpa do site (pode ser a raiz com os arquivos estáticos) em uma pasta `build/` (ou use a raiz).
  3. Publique a pasta na branch `gh-pages` com comandos (executar na raiz do projeto):

     ```bash
     # criando branch gh-pages com conteúdo da pasta build/
     git checkout --orphan gh-pages
     git --work-tree build add --all
     git --work-tree build commit -m "Deploy site"
     git push origin HEAD:gh-pages --force
     git checkout main
     ```

  4. No GitHub: _Settings_ → _Pages_ → escolha `gh-pages` como source.

Notas e dicas:

- Substitua `https://github.com/<seu-usuario>/<seu-repo>.git` pelo URL do seu repositório.
- Se estiver usando `file://` localmente, teste antes abrindo `index.html` via servidor simples, por exemplo:

  ```bash
  # Python 3
  python -m http.server 8000
  # depois abra http://localhost:8000
  ```

- Se preferir deploy automático, podemos adicionar um workflow do GitHub Actions que publica para `gh-pages` sempre que você fizer push na `main`.

Precisa que eu rode os comandos Git aqui ou prefira que eu gere um arquivo de exemplo `build/` pronto para deploy?