"""Ícones da página inicial todos no mesmo branco (o do ícone de Talentos, #cecece).

Lê assets/img/menu-icons/*.webp (e o cristal vermelho) e grava assets/img/home-icons/*.webp em 128 px:
cor única e transparência vinda do brilho de cada pixel, então os detalhes internos (ex.: Chefes)
continuam visíveis. Rodar de novo depois de trocar algum ícone:  python tools/build_home_icons.py
"""
import glob
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "img", "menu-icons")
OUT = os.path.join(ROOT, "assets", "img", "home-icons")
EXTRA = {"cristais": os.path.join(ROOT, "assets", "img", "game", "bp_hongjingshi13.webp")}
WHITE = 206  # cor do ícone de Talentos
SIZE = 128


CONTENT = 94  # tamanho do desenho dentro dos 128 px (igual ao ícone de Talentos)


def convert(src, dst):
    im = Image.open(src).convert("RGBA")
    small = max(im.size) < SIZE
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    px = list(im.getdata())
    lum_of = lambda r, g, b: 0.3 * r + 0.59 * g + 0.11 * b  # noqa: E731
    lum = sorted(lum_of(r, g, b) for r, g, b, a in px if a > 200)
    top = max(lum[int(len(lum) * 0.95)] if lum else 255, 1)
    flat = lum and (lum[-1] - lum[0]) < 12  # silhueta de uma cor só: mantém o alfa original
    # fundo opaco (ex.: Armaduras vem num quadrado escuro): o brilho do canto vira o "transparente"
    w, h = im.size
    m = max(4, w // 16)  # um pouco para dentro (alguns ícones têm borda transparente fina)
    corners = [im.getpixel(p) for p in ((m, m), (w - 1 - m, m), (m, h - 1 - m), (w - 1 - m, h - 1 - m))]
    bg = sum(lum_of(*c[:3]) for c in corners) / 4 if all(c[3] > 200 for c in corners) else 0
    out = []
    for r, g, b, a in px:
        k = 1.0 if flat and not bg else max(0.0, min(1.0, (lum_of(r, g, b) - bg) / max(top - bg, 1)))
        out.append((WHITE, WHITE, WHITE, int(a * k)))
    res = Image.new("RGBA", im.size)
    res.putdata(out)
    # fonte pequena ou com fundo: recorta o desenho e amplia para o tamanho dos outros ícones
    if small or bg:
        box = res.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
        if box:
            res = res.crop(box)
            scale = CONTENT / max(res.size)
            res = res.resize((max(1, round(res.width * scale)), max(1, round(res.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(res, ((SIZE - res.width) // 2, (SIZE - res.height) // 2))
    canvas.save(dst, "WEBP", quality=90, method=6)


def draw_community(dst):
    """Ícone da página Comunidade (três pessoas), desenhado no mesmo estilo dos outros."""
    from PIL import ImageDraw
    big = 512
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (WHITE, WHITE, WHITE, 255)
    for cx, cy, r, scale in ((150, 200, 52, 0.8), (362, 200, 52, 0.8), (256, 170, 70, 1.0)):
        if scale < 1:  # pessoas de trás: contorno escuro separa da do meio
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)
            d.pieslice((cx - 110, cy + 70, cx + 110, cy + 290), 180, 360, fill=c)
    hole = (0, 0, 0, 0)
    d.ellipse((256 - 92, 170 - 92, 256 + 92, 170 + 92), fill=hole)
    d.pieslice((256 - 162, 250 - 22, 256 + 162, 250 + 302), 180, 360, fill=hole)
    d.ellipse((256 - 70, 170 - 70, 256 + 70, 170 + 70), fill=c)
    d.pieslice((256 - 140, 250, 256 + 140, 250 + 280), 180, 360, fill=c)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(dst, "WEBP", quality=90, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    draw_community(os.path.join(OUT, "comunidade.webp"))
    files = {os.path.splitext(os.path.basename(f))[0]: f for f in glob.glob(os.path.join(SRC, "*.webp"))}
    files.update(EXTRA)
    for name, f in sorted(files.items()):
        convert(f, os.path.join(OUT, name + ".webp"))
        print("ok", name)


if __name__ == "__main__":
    main()
