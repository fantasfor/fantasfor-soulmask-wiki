# -*- coding: utf-8 -*-
"""
Lê as traduções oficiais do Soulmask Modkit (Game.po) e gera um mapa:
    "<asset>.<Propriedade>" -> {"zh": ..., "en": ..., "pt": ...}

Ex.: "/Game/Blueprints/DaoJu/.../BP_DaoJu_JianTou_2_1.Name"
       -> {"zh": "淬毒石箭矢", "en": "Poison Stone Arrow", "pt": "Flecha de Pedra Envenenada"}

Uso:
    python tools/parse_po.py [pasta Localization/Game] [saída.json]
"""

import json
import os
import re
import sys

DEFAULT_LOC = r"C:\Program Files\Epic Games\SoulMaskModkit\Projects\WS\Content\Localization\Game"
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SiteExport", "loc_texts.json")
LANGS = {"en": "en", "pt": "pt"}


def _unquote(s):
    s = s.strip()
    if s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return (s.replace(r"\"", '"').replace(r"\n", "\n").replace(r"\r", "\r")
             .replace(r"\t", "\t").replace("\\\\", "\\"))


def parse_po(path, with_ctx=False):
    """Gera (key, source_location, msgid, msgstr[, msgctxt]) para cada entrada.
    msgctxt = "Namespace,Key" (para StringTables o namespace é o nome da tabela)."""
    key = loc = ctx = None
    field = None
    buf = {"msgid": [], "msgstr": []}

    def emit():
        if key is not None:
            rec = (key, loc, "".join(buf["msgid"]), "".join(buf["msgstr"]))
            return rec + (ctx,) if with_ctx else rec
        return None

    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                rec = emit()
                if rec:
                    yield rec
                key = loc = ctx = field = None
                buf = {"msgid": [], "msgstr": []}
                continue
            if line.startswith("#. Key:"):
                key = line.split(":", 1)[1].strip()
            elif line.startswith("#. SourceLocation:"):
                loc = line.split(":", 1)[1].strip()
            elif line.startswith("msgctxt "):
                ctx = _unquote(line[8:])
            elif line.startswith("msgid "):
                field = "msgid"
                buf[field].append(_unquote(line[6:]))
            elif line.startswith("msgstr "):
                field = "msgstr"
                buf[field].append(_unquote(line[7:]))
            elif line.startswith('"') and field:
                buf[field].append(_unquote(line))
        rec = emit()
        if rec:
            yield rec


_DEFAULT_RE = re.compile(r"\.Default__[^.]+_C\.")


def normalize_loc(loc):
    """'/Game/X/BP_A.Default__BP_A_C.Name' -> '/Game/X/BP_A.Name'"""
    return _DEFAULT_RE.sub(".", loc) if loc else loc


def main():
    loc_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LOC
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    texts = {}
    for code, folder in LANGS.items():
        po = os.path.join(loc_dir, folder, "Game.po")
        n = 0
        for key, loc, msgid, msgstr in parse_po(po):
            if not loc:
                continue
            for one in loc.split(" "):  # pode haver mais de uma origem
                k = normalize_loc(one)
                entry = texts.setdefault(k, {"key": key})
                entry.setdefault("zh", msgid)
                if msgstr:
                    entry[code] = msgstr
            n += 1
        print("%s: %d entradas" % (code, n))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(texts, f, ensure_ascii=False, indent=0)
    print("Total de textos: %d -> %s" % (len(texts), out))


if __name__ == "__main__":
    main()
