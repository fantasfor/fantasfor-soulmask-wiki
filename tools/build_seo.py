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

# página (nome em pages/<nome>.html) -> (título, descrição para o Google)
PAGES: dict[str, tuple[str, str]] = {
    'home': ('Wiki do Soulmask em português',
             'Wiki do Soulmask em português e inglês: itens, receitas, armaduras, talentos, mapa interativo, '
             'builder de builds, comandos de admin e mais, com dados tirados direto do jogo.'),
    'builder-maker': ('Builder Maker — monte sua build',
                      'Monte e compartilhe builds do Soulmask: escolha talentos, armadura, armas, máscara e comida '
                      'e veja o total de atributos da build.'),
    'bancada': ('Bancada de trabalho — árvore de receitas',
                'Veja a árvore completa de fabricação de qualquer item do Soulmask: materiais, bancadas e '
                'quantidade total de recursos.'),
    'tier-list': ('Tier List',
                  'Crie e compartilhe tier lists do Soulmask: organize equipamentos e talentos por nível.'),
    'mapa': ('Mapa interativo do Soulmask',
             'Mapa interativo do Soulmask com portais, ruínas, baús, minérios, tribos e onde nasce cada criatura. '
             'Marque seus próprios pontos.'),
    'gdmbot': ('GDMbot — macros para Soulmask',
               'GDMbot: programa de macros para Soulmask que digita comandos e builds automaticamente no console.'),
    'comandos': ('Comandos de admin (GM)',
                 'Todos os comandos GM (admin) do Soulmask explicados. Escreva o que você quer fazer e o site acha o comando.'),
    'eventos': ('Eventos de invasão',
                'Horário de cada esquadrão de invasão do Soulmask no mapa, por região do servidor, no seu fuso horário.'),
    'servidores': ('Servidores',
                   'Encontre um servidor de Soulmask para jogar ou divulgue o seu. Avalie os servidores em que você jogou.'),
    'plantio': ('Plantio — guia de agricultura',
                'Guia de plantio do Soulmask: sementes, tempo de crescimento, temperatura ideal e o que cada plantação rende.'),
    'alimentos': ('Alimentos e comidas',
                  'Todas as comidas do Soulmask com efeitos, bônus de atributos, duração e categorias.'),
    'armaduras': ('Armaduras e conjuntos',
                  'Todos os conjuntos de armadura do Soulmask com peças, atributos e bônus de conjunto.'),
    'armas': ('Armas',
              'Todas as armas do Soulmask com dano, durabilidade e atributos.'),
    'atributos': ('Atributos',
                  'O que cada atributo do Soulmask faz e como a qualidade do NPC muda os valores dele.'),
    'cristais': ('Cristais Vermelhos',
                 'Cristais vermelhos do Soulmask: módulos da máscara, efeito de cada um, como crescem com a qualidade e onde conseguir.'),
    'chefes': ('Chefes (bosses)',
               'Chefes das pirâmides do Soulmask: como invocar cada dificuldade no altar, drops e conjuntos de armadura que liberam.'),
    'conforto': ('Conforto',
                 'Quanto conforto cada móvel dá no Soulmask, os 10 níveis de conforto e o bônus de Humor Agradável.'),
    'criaturas': ('Criaturas e animais',
                  'Enciclopédia de animais e criaturas do Soulmask.'),
    'maestria': ('Maestria de armas',
                 'Todas as habilidades de maestria de cada arma do Soulmask, como conseguir e a chance de cada uma.'),
    'proficiencia': ('Proficiência',
                     'Proficiência no Soulmask: EXP de cada nível e todos os bônus de armas, coleta e fabricação.'),
    'itens': ('Itens e receitas',
              'Todos os itens e receitas do Soulmask: materiais, bancada, onde conseguir e atributos.'),
    'mascaras': ('Máscaras',
                 'Máscaras do Soulmask, seus efeitos e habilidades.'),
    'talentos': ('Talentos',
                 'Explore e filtre todos os talentos do Soulmask e seus efeitos.'),
    'apoie': ('Apoie o projeto',
              'Apoie a Soulmask Fantasfor Wiki e ajude a manter o site atualizado.'),
    'reportar': ('Reportar erro ou sugestão',
                 'Encontrou um erro ou tem uma sugestão para a wiki do Soulmask? Envie por aqui.'),
}

# importância relativa para o sitemap
PRIORITY = {'home': '1.0', 'mapa': '0.9', 'itens': '0.9', 'builder-maker': '0.9', 'comandos': '0.9',
            'talentos': '0.8', 'armaduras': '0.8', 'bancada': '0.8', 'apoie': '0.3', 'reportar': '0.3'}


def page_url(page: str) -> str:
    return SITE_URL if page == 'home' else f'{SITE_URL}{page}.html'


def head_block(page: str) -> str:
    title, desc = PAGES[page]
    full_title = f'{title} — {SITE_NAME}' if page != 'home' else f'{SITE_NAME} — {title}'
    url = page_url(page)
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    ld = {'@context': 'https://schema.org', '@type': 'WebSite', 'name': SITE_NAME, 'url': SITE_URL, 'inLanguage': ['pt-BR', 'en']}
    if page != 'home':
        ld = {'@context': 'https://schema.org', '@type': 'WebPage', 'name': title, 'description': desc, 'url': url,
              'inLanguage': 'pt-BR', 'isPartOf': {'@type': 'WebSite', 'name': SITE_NAME, 'url': SITE_URL}}
    lines = [
        f'<title>{e(full_title)}</title>',
        f'<meta name="description" content="{e(desc)}">',
        f'<link rel="canonical" href="{e(url)}">',
        '<meta name="robots" content="index,follow">',
    ]
    if GOOGLE_SITE_VERIFICATION:
        lines.append(f'<meta name="google-site-verification" content="{e(GOOGLE_SITE_VERIFICATION)}">')
    lines += [
        f'<meta property="og:site_name" content="{e(SITE_NAME)}">',
        f'<meta property="og:title" content="{e(full_title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:type" content="website">',
        f'<meta property="og:url" content="{e(url)}">',
        f'<meta property="og:image" content="{e(OG_IMAGE)}">',
        '<meta property="og:locale" content="pt_BR">',
        '<meta name="twitter:card" content="summary">',
        f'<meta name="twitter:title" content="{e(full_title)}">',
        f'<meta name="twitter:description" content="{e(desc)}">',
        f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>',
    ]
    return '\n'.join('  ' + ln for ln in lines)


def prerender_block(page: str) -> str:
    """Texto mínimo visível antes do JavaScript (o main.js troca pelo conteúdo real)."""
    title, desc = PAGES[page]
    return (f'          <div class="view seo-prerender"><h1>{html.escape(title)}</h1>'
            f'<p>{html.escape(desc)}</p></div>')


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
    template = index.read_text(encoding='utf-8-sig')
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

    today = _dt.date.today().isoformat()
    urls = '\n'.join(
        f'  <url><loc>{page_url(p)}</loc><lastmod>{today}</lastmod><priority>{PRIORITY.get(p, "0.6")}</priority></url>'
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
