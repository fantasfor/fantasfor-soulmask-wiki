"""Gera o banner das redes sociais (og:image / twitter:image), 1200x630:
assets/img/og-banner.jpg. Fundo = imagem de chefe do próprio site, escurecida à esquerda para o texto;
logo quadrado do Fantasfor + "Soulmask Wiki" + "Interactive Map • Builds • Crafting".

    python tools/build_og_banner.py [nome_do_fundo]      (padrão: bg_jingangyuan)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT.parent / 'fantasfor.github.io' / 'logo-quadrado.png'   # só leitura (fora deste projeto)
OUT = ROOT / 'assets' / 'img' / 'og-banner.jpg'
W, H = 1200, 630
GOLD = (236, 215, 96)
CREAM = (232, 224, 208)
FONTS = Path('C:/Windows/Fonts')


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for n in names:
        p = FONTS / n
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def cover(img: Image.Image, w: int, h: int, focus_x: float = 0.5) -> Image.Image:
    """Redimensiona cobrindo w x h e corta (focus_x escolhe a parte que fica visível)."""
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = round((img.width - w) * focus_x)
    y = (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def build(bg_name: str = 'bg_jingangyuan', mirror: bool = True, out: Path = OUT) -> Path:
    bg = Image.open(ROOT / 'assets' / 'img' / 'bosses' / f'{bg_name}.webp').convert('RGB')
    if mirror:
        bg = bg.transpose(Image.FLIP_LEFT_RIGHT)   # o chefe vai para a direita, o texto fica à esquerda
    bg = cover(bg, W, H, 0.5)

    # escurece: degradê da esquerda (texto) para a direita (chefe) + vinheta embaixo
    shade = Image.new('L', (W, H))
    px = shade.load()
    for x in range(W):
        a = int(235 - 160 * min(1.0, x / (W * 0.85)))
        for y in range(H):
            b = a + int(60 * max(0.0, (y - H * 0.6) / (H * 0.4)))
            px[x, y] = min(245, b)
    dark = Image.new('RGB', (W, H), (8, 8, 9))
    img = Image.composite(dark, bg, shade)

    d = ImageDraw.Draw(img)
    # moldura dourada fina
    d.rectangle((14, 14, W - 15, H - 15), outline=(150, 128, 60), width=2)

    # logo
    logo = Image.open(LOGO).convert('RGBA')
    size = 230
    logo = logo.resize((size, size), Image.LANCZOS)
    lx, ly = 70, (H - size) // 2 - 30
    glow = Image.new('RGBA', (size + 40, size + 40), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rectangle((20, 20, size + 20, size + 20), fill=(0, 0, 0, 200))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img.paste(glow, (lx - 20, ly - 10), glow)
    img.paste(logo, (lx, ly), logo)
    d.rectangle((lx - 1, ly - 1, lx + size, ly + size), outline=GOLD, width=2)

    # textos
    tx = lx + size + 50
    title = font(['georgiab.ttf', 'timesbd.ttf'], 92)
    sub = font(['segoeuib.ttf', 'arialbd.ttf'], 36)
    small = font(['segoeui.ttf', 'arial.ttf'], 27)

    def text(xy, s, f, fill):
        x, y = xy
        d.text((x + 3, y + 3), s, font=f, fill=(0, 0, 0))
        d.text((x, y), s, font=f, fill=fill)

    ty = ly + 6
    text((tx, ty), 'Soulmask', title, GOLD)
    text((tx, ty + 98), 'Wiki', title, CREAM)
    d.line((tx, ty + 218, tx + 520, ty + 218), fill=GOLD, width=3)
    text((tx, ty + 236), 'Interactive Map • Builds • Crafting', sub, CREAM)
    text((70, H - 78), 'English & Português  ·  data straight from the game  ·  fantasfor.github.io',
         small, (200, 192, 178))

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    return out


if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else 'bg_jingangyuan'
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT
    p = build(name, out=target)
    print(p, f'{p.stat().st_size / 1024:.0f} KB')
