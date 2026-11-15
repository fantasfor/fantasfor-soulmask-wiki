# Como atualizar os dados do site (depois de um patch do Soulmask)

Os dados e ícones do site vêm direto do **Soulmask Modkit** (grátis na Epic Games Store).
Não é preciso abrir o editor: o script lê os arquivos do Modkit no disco.

## Passo a passo

1. Atualize o **Soulmask Modkit** pelo Epic Games Launcher (para pegar o conteúdo do patch novo).
2. Na pasta do site, rode:

```bash
python tools/build_data.py
```

Em poucos segundos ele regera tudo em `assets/data/` e os ícones novos em `assets/img/game/`.
Para refazer **todos** os ícones (não só os novos), use `python tools/build_data.py --force-icons`.

3. Teste localmente:

```bash
python tools/dev_server.py 8765
```

e abra `http://localhost:8765`.

## O que cada arquivo faz

| Arquivo | Função |
|---|---|
| `tools/uasset.py` | Lê arquivos `.uasset` da Unreal 4.27 (Blueprints, DataTables, texturas) |
| `tools/parse_po.py` | Lê as traduções oficiais (`Localization/Game/{en,pt}/Game.po`) |
| `tools/build_data.py` | Junta tudo e gera os JSONs e os ícones do site |
| `tools/legacy_map.json` | Mapa de IDs do site antigo para os novos (para builds e tier lists salvas no navegador) |
| `tools/dev_server.py` | Servidor local sem cache para testar |

Se o Modkit estiver instalado em outro lugar, defina a variável `SOULMASK_CONTENT` com o caminho da pasta
`...\SoulMaskModkit\Projects\WS\Content`.

## Dados gerados (`assets/data/`)

| Arquivo | Conteúdo |
|---|---|
| `items.json` | Todos os itens (nome/descrição PT+EN, categoria, peso, pilha, durabilidade, atributos, ícone) |
| `weapons.json` | Armas com dano e atributos (fixos e aleatórios) |
| `armor-pieces.json` | Peças de armadura com slot, conjunto e atributos |
| `armor-sets.json` | Conjuntos e bônus de 2/4/6 peças |
| `foods.json` | Comidas, bebidas e remédios com efeitos e duração |
| `talents.json` | Talentos com todos os níveis e IDs do jogo (usados no export do GDMbot) |
| `recipes.json` / `benches.json` | Receitas, ingredientes e bancadas |
| `creatures.json` | Enciclopédia de criaturas |
| `masks.json` | Máscaras e suas melhorias |
| `crops.json` | Plantações: crescimento, temperatura, adubo e colheita |

Imagens extras: `assets/img/creatures/` (foto de cada criatura = miniatura 3D que o editor grava no modelo)
e `assets/img/map/world.webp` (mapa do mundo, `UI/Map/Level01_Map`).

## Conta, tier lists da comunidade e avaliações

O login com Google usa o mesmo Firebase da loja do GDMbot (`gdmbot-141e7`). As regras de acesso do banco
ficam em `GDMbot/servidor/firestore.rules` (coleções `users`, `tierlists`, `talentRatings`). Depois de mudar
as regras, publique: `firebase deploy --only firestore:rules` dentro de `GDMbot/servidor`, ou cole o arquivo
em Firebase Console → Firestore → Regras → Publicar.
| `meta.json` | Nomes oficiais dos atributos e categorias em PT/EN |
| `legacy-ids.json` | Conversão de IDs antigos (builds e tier lists salvas no navegador) |

## Google (SEO) e Analytics

- Página nova ou texto mudou: edite `PAGES` em `tools/build_seo.py` e rode `python tools/build_seo.py` (gera `<pagina>.html` na raiz, `sitemap.xml` e `robots.txt`).
- Verificação do Search Console: `GOOGLE_SITE_VERIFICATION` em `tools/build_seo.py`.
- Google Analytics: `GA_ID` em `assets/js/analytics.js`.

