"""Ícones de raridade/qualidade (losangos do jogo, UI/resource/shuxingjiemian/juesepinzhi1..6, 64x64)
-> assets/img/rarity/<n>_<cor>.webp. Nível n = EDJPZ_Level<n> dos itens / qualidade 1..6 dos NPCs.

    python tools/build_rarity_icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from uasset import Package  # noqa: E402
import build_data  # noqa: E402

COLORS = ['branco', 'verde', 'azul', 'roxo', 'dourado', 'vermelho']
OUT = ROOT / 'assets' / 'img' / 'rarity'


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for n, color in enumerate(COLORS, start=1):
        name = 'juesepinzhi' if n == 1 else f'juesepinzhi{n}'
        img = build_data.extract_texture(Package.open(f'/Game/UI/resource/shuxingjiemian/{name}'))
        if img is None:
            raise SystemExit(f'não consegui ler {name}')
        bbox = img.getbbox()                      # corta a borda transparente
        if bbox:
            img = img.crop(bbox)
        side = max(img.size)                      # deixa quadrado, centralizado
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        target = OUT / f'{n}_{color}.webp'
        sq.save(target, 'WEBP', lossless=True)
        print(target.name, sq.size, f'{target.stat().st_size} B')


if __name__ == '__main__':
    main()
