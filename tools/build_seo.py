"""Gera o SEO do site (Google): uma página real por seção, sitemap.xml e robots.txt.

O site usa rotas com "#" (index.html#comandos). O Google ignora tudo depois do "#",
então para cada seção existir na busca ela precisa de um endereço próprio. Este
script cria, na raiz, um arquivo por seção (comandos.html, mapa.html, ...) que é
uma cópia do index.html com título, descrição e endereço canônico próprios. Ao
abrir, o main.js mostra a seção certa e troca o endereço para ./#comandos.

Rode depois de adicionar/renomear páginas ou mudar textos abaixo:
    python tools/build_seo.py
"""
from __future__ import annotations

import datetime as _dt
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = 'https://fantasfor.github.io/fantasfor-soulmask-wiki/'
SITE_NAME = 'Soulmask Fantasfor Wiki'
OG_IMAGE = SITE_URL + 'assets/img/Icon.png'

# Código de verificação do Google Search Console (só o valor de content="...").
# Search Console > Adicionar propriedade > Prefixo do URL > Tag HTML.
GOOGLE_SITE_VERIFICATION = 'q9zaKe0VLjXgmrlJ_YBomj4z7qN9WPLx1f5Oj3I0m9w'

# WebSite da raiz (fantasfor.github.io, fora deste projeto): as páginas da wiki se declaram parte dele
ROOT_SITE = {'@type': 'WebSite', 'name': SITE_NAME, 'url': 'https://fantasfor.github.io/'}
TITLE_SUFFIX = ' | Fantasfor Wiki'
MAX_TITLE, MAX_DESC = 60, 155   # limites que o Google costuma mostrar inteiros (o script avisa se passar)

# página (nome em pages/<nome>.html) -> (nome curto da seção, título para o Google, descrição para o Google)
# Os títulos usam os termos que o pessoal pesquisa ("Soulmask ..."); o nome curto vai na trilha (breadcrumb),
# no <h1> do texto do Google e nos links da home.
PAGES: dict[str, tuple[str, str, str]] = {
    'home': ('Início', 'Soulmask Wiki PT-BR: mapa, itens e builds',
             'Wiki de Soulmask em português e inglês: mapa interativo, itens e receitas, armaduras, talentos, '
             'builder de builds e comandos de admin, com dados do jogo.'),
    'mapa': ('Mapa interativo', 'Mapa interativo Soulmask (PT-BR)',
             'Mapa interativo de Soulmask com portais, ruínas, baús, minérios, tribos, chefes e onde nasce cada '
             'criatura. Procure o loot e marque seus pontos.'),
    'itens': ('Itens e receitas', 'Soulmask itens e receitas (crafting)',
              'Todos os itens e receitas de Soulmask: materiais, bancada, onde conseguir cada item e seus atributos.'),
    'builder-maker': ('Builder Maker', 'Soulmask Builder Maker: calculadora build',
                      'Monte e compartilhe builds de Soulmask: talentos, armadura, armas, máscara e comida, com o '
                      'total de atributos calculado.'),
    'comandos': ('Comandos de admin', 'Soulmask comandos de admin (GM) explicados',
                 'Todos os comandos GM (admin) de Soulmask explicados. Escreva o que quer fazer e o site acha o comando.'),
    'servidores': ('Servidores', 'Servidores brasileiros de Soulmask e mais',
                   'Encontre um servidor de Soulmask para jogar, inclusive brasileiros, ou divulgue o seu. Avalie os '
                   'servidores em que você jogou.'),
    'comunidade': ('Comunidade', 'Soulmask builds e tier lists da comunidade',
                   'Builds, tier lists e servidores de Soulmask publicados pelos jogadores: avalie com estrelas, '
                   'comente e guarde nos favoritos.'),
    'bancada': ('Bancada de trabalho', 'Soulmask árvore de fabricação (crafting)',
                'Árvore completa de fabricação de qualquer item de Soulmask: materiais, bancadas e quantidade '
                'total de recursos.'),
    'tier-list': ('Tier List', 'Soulmask Tier List: armas e talentos',
                  'Crie e compartilhe tier lists de Soulmask: organize armas, armaduras, máscaras e talentos por nível.'),
    'gdmbot': ('GDMbot', 'GDMbot: macros automáticos para Soulmask',
               'GDMbot: programa de macros para Soulmask que digita comandos e builds automaticamente no console.'),
    'eventos': ('Eventos de invasão', 'Soulmask eventos de invasão: horários',
                'Horário de cada evento de invasão de Soulmask por região do servidor, no seu fuso horário, e o que '
                'cada evento traz.'),
    'plantio': ('Plantio', 'Soulmask plantio: sementes e fertilizantes',
                'Guia de plantio de Soulmask: sementes, tempo de crescimento, temperatura ideal, fertilizantes e o '
                'que cada plantação rende.'),
    'alimentos': ('Alimentos', 'Soulmask comidas: efeitos, bônus e receitas',
                  'Todas as comidas de Soulmask com efeitos, bônus de atributos, duração, onde conseguir e a receita.'),
    'armaduras': ('Armaduras', 'Soulmask armaduras: conjuntos e bônus',
                  'Todos os conjuntos de armadura de Soulmask com peças, atributos, atributos aleatórios e bônus de '
                  'conjunto. Compare dois conjuntos.'),
    'armas': ('Armas', 'Soulmask armas: dano e atributos',
              'Todas as armas de Soulmask com dano, durabilidade e atributos, por tipo de arma.'),
    'atributos': ('Atributos', 'Soulmask atributos e qualidade dos NPCs',
                  'O que cada atributo de Soulmask faz e quanto a qualidade do NPC (10 a 15) aumenta cada valor.'),
    'cristais': ('Cristais Vermelhos', 'Soulmask cristais vermelhos da máscara',
                 'Cristais vermelhos de Soulmask: módulos da máscara, efeito de cada um, como crescem com a '
                 'qualidade e onde conseguir.'),
    'chefes': ('Chefes', 'Soulmask chefes (bosses): invocação e drops',
               'Chefes das pirâmides de Soulmask: como invocar cada dificuldade no altar, drops e armaduras que liberam.'),
    'conforto': ('Conforto', 'Soulmask conforto: móveis e níveis',
                 'Quanto conforto cada móvel dá em Soulmask, os 10 níveis de conforto e uma calculadora de conforto.'),
    'criaturas': ('Criaturas', 'Soulmask criaturas e animais: drops e mapa',
                  'Enciclopédia de criaturas e animais de Soulmask: atributos, o que dão ao esquartejar e onde '
                  'nascem no mapa.'),
    'animais': ('Animais domesticáveis', 'Soulmask montarias e animais de criação',
                'Montarias e animais de criação de Soulmask: arapuca, sela, cercado, onde encontrar, o que produzem '
                'e o que dão no abate.'),
    'maestria': ('Maestria de armas', 'Soulmask maestria de armas: habilidades',
                 'Todas as habilidades de maestria de cada arma de Soulmask, como conseguir e a chance de cada uma.'),
    'proficiencia': ('Proficiência', 'Soulmask proficiência: calculadora e bônus',
                     'Proficiência em Soulmask: EXP de cada nível, marcos e todos os bônus de armas, coleta e fabricação.'),
    'mascaras': ('Máscaras', 'Soulmask máscaras: efeitos e onde encontrar',
                 'Máscaras de Soulmask: efeito passivo, melhorias e onde encontrar cada uma no mapa.'),
    'talentos': ('Talentos', 'Soulmask talentos: efeitos e níveis',
                 'Todos os talentos de Soulmask com os efeitos dos níveis 1, 2 e 3. Filtre por tipo, tribo e profissão.'),
    'apoie': ('Apoie', 'Apoie a Fantasfor Wiki de Soulmask',
              'Apoie a Soulmask Fantasfor Wiki e ajude a manter o site atualizado.'),
    'reportar': ('Reportar', 'Reportar erro ou sugestão (Soulmask)',
                 'Encontrou um erro ou tem uma sugestão para a wiki de Soulmask? Envie por aqui.'),
}

# importância relativa para o sitemap
PRIORITY = {'home': '1.0', 'mapa': '0.9', 'itens': '0.9', 'builder-maker': '0.9', 'comandos': '0.9',
            'talentos': '0.8', 'armaduras': '0.8', 'bancada': '0.8', 'apoie': '0.3', 'reportar': '0.3'}


def page_url(page: str) -> str:
    return SITE_URL if page == 'home' else f'{SITE_URL}{page}.html'


def full_title(page: str) -> str:
    return PAGES[page][1] + TITLE_SUFFIX


def structured_data(page: str) -> dict:
    """JSON-LD: WebPage (parte do WebSite da raiz) + trilha (BreadcrumbList); na home, a lista de seções
    (ItemList de SiteNavigationElement) para ajudar o Google a montar os sitelinks."""
    name, _title, desc = PAGES[page]
    url = page_url(page)
    webpage = {'@type': 'CollectionPage' if page == 'home' else 'WebPage', '@id': url + '#webpage', 'url': url,
               'name': full_title(page), 'description': desc, 'inLanguage': 'pt-BR', 'isPartOf': ROOT_SITE,
               'primaryImageOfPage': {'@type': 'ImageObject', 'url': OG_IMAGE}}
    graph = [webpage]
    if page == 'home':
        graph.append({'@type': 'ItemList', '@id': url + '#sections', 'name': 'Seções da ' + SITE_NAME,
                      'itemListElement': [{'@type': 'SiteNavigationElement', 'position': i, 'name': PAGES[p][0],
                                           'description': PAGES[p][2], 'url': page_url(p)}
                                          for i, p in enumerate((p for p in PAGES if p != 'home'), start=1)]})
        webpage['mainEntity'] = {'@id': url + '#sections'}
    else:
        graph.append({'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': SITE_NAME, 'item': SITE_URL},
            {'@type': 'ListItem', 'position': 2, 'name': name, 'item': url}]})
        webpage['breadcrumb'] = {'@id': url + '#breadcrumb'}
    return {'@context': 'https://schema.org', '@graph': graph}


def head_block(page: str) -> str:
    _name, _title, desc = PAGES[page]
    title = full_title(page)
    url = page_url(page)
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    ld = json.dumps(structured_data(page), ensure_ascii=False).replace('</', '<\\/')
    lines = [
        f'<title>{e(title)}</title>',
        f'<meta name="description" content="{e(desc)}">',
        f'<link rel="canonical" href="{e(url)}">',
        '<meta name="robots" content="index,follow">',
    ]
    if GOOGLE_SITE_VERIFICATION:
        lines.append(f'<meta name="google-site-verification" content="{e(GOOGLE_SITE_VERIFICATION)}">')
    lines += [
        f'<meta property="og:site_name" content="{e(SITE_NAME)}">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:url" content="{e(url)}">',
        f'<meta property="og:image" content="{e(OG_IMAGE)}">',
        f'<meta property="og:image:alt" content="{e(SITE_NAME)}">',
        '<meta property="og:locale" content="pt_BR">',
        '<meta property="og:locale:alternate" content="en_US">',
        '<meta name="twitter:card" content="summary">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(desc)}">',
        f'<meta name="twitter:image" content="{e(OG_IMAGE)}">',
        f'<script type="application/ld+json">{ld}</script>',
    ]
    return '\n'.join('  ' + ln for ln in lines)


def prerender_block(page: str) -> str:
    """Texto para os buscadores, já no HTML (fica invisível pelo CSS .seo-prerender; o main.js troca pela
    página de verdade). Tem o título, a descrição, a trilha e links de texto normais para todas as seções,
    o que ajuda o Google a achar as páginas e montar os sitelinks."""
    name, title, desc = PAGES[page]
    e = html.escape
    crumb = '' if page == 'home' else (f'<p><a href="./">{e(SITE_NAME)}</a> › {e(name)}</p>')
    links = ''.join(f'<li><a href="{"./" if p == "home" else p + ".html"}">{e(PAGES[p][0])}</a></li>'
                    for p in PAGES if p != page)
    return (f'          <div class="view seo-prerender">{crumb}<h1>{e(title)}</h1>'
            f'<p>{e(desc)}</p><nav aria-label="{e(SITE_NAME)}"><ul>{links}</ul></nav></div>')


_MOJIBAKE = re.compile(r'(?:[ÂÃ][\u0080-¿]|â€[\u0080-¿–-›])+')


def fix_mojibake(text: str) -> str:
    """Conserta acentos que viraram "Ã§Ã£o" (UTF-8 lido como Windows-1252) fora dos blocos gerados."""
    def one(m):
        try:
            return m.group(0).encode('cp1252').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            return m.group(0)
    return _MOJIBAKE.sub(one, text)


def lastmod(page: str) -> str:
    """Data da última mudança da seção (arquivo pages/<nome>.html; a home usa as notas de atualização)."""
    f = ROOT / ('assets/data/updates.json' if page == 'home' else f'pages/{page}.html')
    return _dt.date.fromtimestamp(f.stat().st_mtime).isoformat() if f.exists() else _dt.date.today().isoformat()


def replace_between(text: str, start: str, end: str, body: str) -> str:
    pat = re.compile(rf'(<!-- {start}[^>]*-->)(.*?)(\s*<!-- {end} -->)', re.S)
    if not pat.search(text):
        raise SystemExit(f'Marcador <!-- {start} --> não encontrado no index.html')
    return pat.sub(lambda m: f'{m.group(1)}\n{body}{m.group(3)}', text, count=1)


def render(template: str, page: str) -> str:
    out = replace_between(template, 'SEO:START', 'SEO:END', head_block(page))
    return replace_between(out, 'PRERENDER:START', 'PRERENDER:END', prerender_block(page))


def main() -> None:
    index = ROOT / 'index.html'
    template = fix_mojibake(index.read_text(encoding='utf-8-sig'))
    for p in PAGES:
        t, d = full_title(p), PAGES[p][2]
        if len(t) > MAX_TITLE or len(d) > MAX_DESC:
            print(f'Aviso: {p}: título {len(t)}/{MAX_TITLE}, descrição {len(d)}/{MAX_DESC}')
    if len({full_title(p) for p in PAGES}) != len(PAGES):
        raise SystemExit('Há títulos repetidos em PAGES')
    missing = [p for p in PAGES if not (ROOT / 'pages' / f'{p}.html').exists()]
    if missing:
        raise SystemExit(f'Páginas sem arquivo em pages/: {missing}')
    extra = sorted(p.stem for p in (ROOT / 'pages').glob('*.html') if p.stem not in PAGES and p.stem != 'receitas')
    if extra:
        print('Aviso: páginas sem título/descrição em PAGES (não entram no Google):', extra)

    index.write_text(render(template, 'home'), encoding='utf-8', newline='\n')
    for page in PAGES:
        if page == 'home':
            continue
        (ROOT / f'{page}.html').write_text(render(template, page), encoding='utf-8', newline='\n')

    urls = '\n'.join(
        f'  <url><loc>{page_url(p)}</loc><lastmod>{lastmod(p)}</lastmod><priority>{PRIORITY.get(p, "0.6")}</priority></url>'
        for p in PAGES)
    (ROOT / 'sitemap.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f'{urls}\n</urlset>\n', encoding='utf-8', newline='\n')
    (ROOT / 'robots.txt').write_text(
        f'User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}sitemap.xml\n', encoding='utf-8', newline='\n')
    print(f'OK: index.html + {len(PAGES) - 1} páginas, sitemap.xml e robots.txt gerados.')


if __name__ == '__main__':
    main()
