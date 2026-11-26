# -*- coding: utf-8 -*-
"""
Gera os dados do site (assets/data/*.json) e os ícones (assets/img/game/*.webp)
lendo direto o conteúdo do Soulmask Modkit — sem abrir o editor.

    python tools/build_data.py

Fontes (todas oficiais do jogo):
  - DT_AllDaoJu ............ lista mestre de itens
  - CDO dos Blueprints ..... nome, descrição, ícone, peso, pilha, durabilidade, atributos
  - DT_ZhuangBeiPropTable .. atributos de armas/armaduras (e bônus por qualidade)
  - DT_ZhuangBeiTaoZhuang .. conjuntos de armadura e bônus de 2/4/6 peças
  - GE_Food_* .............. efeitos e duração das comidas
  - DT_GiftZongBiao ........ talentos (todos os níveis)
  - PeiFang / Formula ...... receitas
  - BT_DongWuTuJian ........ enciclopédia de criaturas
  - BP_JianZhu_Summon_* .... chefes (altares de invocação), com DT_ShengWuCaiJiBao para os drops
  - BP_JianZhuGuanLiQi ..... níveis de conforto (GE_ShuShiDu*) e valor de conforto dos móveis
  - DT_YiWenText ........... nomes oficiais dos atributos
  - Localization/Game/{en,pt}/Game.po ... textos em inglês e português
"""

import io
import json
import os
import re
import struct
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from uasset import Package, CONTENT_DIR  # noqa: E402
from parse_po import parse_po  # noqa: E402

SITE = os.path.dirname(HERE)
DATA_DIR = os.path.join(SITE, "assets", "data")
IMG_DIR = os.path.join(SITE, "assets", "img", "game")
IMG_URL = "assets/img/game/"
LOC_DIR = os.path.join(CONTENT_DIR, "Localization", "Game")

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

STATS = Counter()

# Informações do site antigo que o jogo não fornece (tipo/exclusividade de talentos) e o
# mapa de IDs antigos -> novos. Gerado uma vez a partir dos JSONs antigos e reaproveitado depois.
LEGACY_MAP_PATH = os.path.join(HERE, "legacy_map.json")
try:
    LEGACY_MAP = json.load(open(LEGACY_MAP_PATH, encoding="utf-8"))
except Exception:
    LEGACY_MAP = {}


def log(*a):
    print(*a, flush=True)


# ====================================================================== textos
class Loc(object):
    def __init__(self):
        self.by_key = {}
        self.by_src = {}
        self.by_ctx = {}
        for lang in ("en", "pt"):
            po = os.path.join(LOC_DIR, lang, "Game.po")
            for key, src, msgid, msgstr, ctx in parse_po(po, with_ctx=True):
                e = self.by_key.setdefault(key, {"zh": msgid})
                if msgstr:
                    e[lang] = msgstr
                if ctx:
                    # StringTables: "Tabela,Chave" (as chaves se repetem entre tabelas)
                    ns = ctx.split(",", 1)[0]
                    if ns and not ns.startswith("["):
                        ce = self.by_ctx.setdefault((ns, key), {"zh": msgid})
                        if msgstr:
                            ce[lang] = msgstr
                if src:
                    for one in src.split(" "):
                        self.by_src.setdefault(one, e)
        log("textos carregados:", len(self.by_key))

    def get(self, t):
        """FText lido do .uasset -> {'pt':..., 'en':...} ou None."""
        if not t:
            return None
        if isinstance(t, str):
            return {"pt": clean(t), "en": clean(t)} if t and not has_cjk(t) else None
        if not isinstance(t, dict):
            return None
        if t.get("table"):
            table = t["table"].split(".")[-1]
            e = self.by_ctx.get((table, t.get("key", "")))
            if e and (e.get("en") or e.get("pt")):
                return {"pt": clean(e.get("pt") or e.get("en")), "en": clean(e.get("en") or e.get("pt"))}
            STATS["texto de StringTable sem tradução"] += 1
            return None
        e = self.by_key.get(t.get("key", ""))
        if e and (e.get("en") or e.get("pt")):
            en = clean(e.get("en") or e.get("pt"))
            pt = clean(e.get("pt") or e.get("en"))
            return {"pt": pt, "en": en}
        src = t.get("text", "")
        if src and not has_cjk(src):
            return {"pt": clean(src), "en": clean(src)}
        STATS["texto sem tradução"] += 1
        return None


_TAG_RE = re.compile(r"</?[A-Za-z_][A-Za-z0-9_]*>|</>")
_CJK_RE = re.compile(r"[㐀-鿿]")


def has_cjk(s):
    return bool(_CJK_RE.search(s or ""))


def clean(s):
    if not s:
        return ""
    s = s.replace("<br>", "\n").replace("\r\n", "\n")
    s = _TAG_RE.sub("", s)
    return s.strip()


def bi(obj, field, value):
    """Grava campo bilíngue: obj[field_pt], obj[field_en]."""
    if value:
        obj[field + "_pt"] = value["pt"]
        obj[field + "_en"] = value["en"]


# ====================================================================== ícones
class Icons(object):
    def __init__(self):
        os.makedirs(IMG_DIR, exist_ok=True)
        self.done = {}
        self.written = set()
        try:
            from PIL import Image  # noqa: F401
            self.pil = True
        except Exception:
            self.pil = False
            log("AVISO: Pillow não encontrado; ícones serão salvos em PNG")

    def get(self, tex_path):
        if not tex_path or not isinstance(tex_path, str) or not tex_path.startswith("/Game/"):
            return None
        tex_path = tex_path.split(".")[0]
        if tex_path in self.done:
            return self.done[tex_path]
        url = None
        try:
            name = re.sub(r"[^a-z0-9_-]+", "_", tex_path.rsplit("/", 1)[-1].lower())
            # evita colisão de nomes iguais em pastas diferentes
            base, n = name, 1
            while name in self.written:
                n += 1
                name = "%s_%d" % (base, n)
            out = os.path.join(IMG_DIR, name + ".webp")
            if os.path.isfile(out) and not FORCE_ICONS:
                self.written.add(name)
                self.done[tex_path] = IMG_URL + name + ".webp"
                STATS["ícones (cache)"] += 1
                return self.done[tex_path]
            pkg = Package.open(tex_path)
            img = extract_texture(pkg) if pkg else None
            if img is not None:
                self.written.add(name)
                url = self._save(img, name)
                STATS["ícones"] += 1
            else:
                STATS["ícone sem imagem"] += 1
        except Exception as e:
            STATS["ícone com erro"] += 1
        self.done[tex_path] = url
        return url

    def _save(self, img, name):
        if img.mode not in ("RGBA", "RGB"):
            img = img.convert("RGBA")
        if max(img.size) > ICON_SIZE:
            img = img.resize((ICON_SIZE, ICON_SIZE), 1)  # LANCZOS
        out = os.path.join(IMG_DIR, name + ".webp")
        img.save(out, "WEBP", quality=88, method=4)
        return IMG_URL + name + ".webp"


ICON_SIZE = 128
# python tools/build_data.py --force-icons  -> regera todos os ícones (ex.: depois de um patch)
FORCE_ICONS = "--force-icons" in sys.argv


def _read_compressed_bulk(b, start):
    """Bloco comprimido da Unreal (FCompression): tag + resumo + pedaços zlib."""
    import zlib
    i = b.find(b"\xc1\x83\x2a\x9e", start)
    while i >= 0:
        try:
            # [int64 tag][int64 tamanho do pedaço][int64 comprimido][int64 descomprimido]
            chunk_size, comp, uncomp = struct.unpack_from("<qqq", b, i + 8)
            if 0 < comp <= len(b) and 0 < uncomp < 64 << 20 and chunk_size > 0:
                n = (uncomp + chunk_size - 1) // chunk_size
                o = i + 32
                sizes = []
                for _ in range(n):
                    c, u = struct.unpack_from("<qq", b, o)
                    sizes.append((c, u))
                    o += 16
                out = bytearray()
                for c, u in sizes:
                    out += zlib.decompress(b[o:o + c])
                    o += c
                if len(out) == uncomp:
                    return bytes(out)
        except Exception:
            pass
        i = b.find(b"\xc1\x83\x2a\x9e", i + 4)
    return None


def extract_texture(pkg):
    """Imagem original da textura (dados-fonte do editor). Retorna PIL.Image ou None."""
    from PIL import Image
    exp = pkg.find_export(cls="Texture2D")
    if exp is None:
        return None
    props, _ = pkg.read_export_props(exp)
    src = props.get("Source") or {}
    w, h = src.get("SizeX"), src.get("SizeY")
    data = _read_compressed_bulk(pkg.b, exp["offset"])
    if data is None and w and h:
        # dados não comprimidos logo após o cabeçalho do bulk data
        need = w * h * 4
        tail = pkg.b[exp["offset"]:]
        if src.get("bPNGCompressed"):
            j = tail.find(b"\x89PNG\r\n\x1a\n")
            if j >= 0:
                data = tail[j:]
        elif len(tail) >= need:
            data = tail[-need:]
    if not data:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        img = Image.open(io.BytesIO(data))
        img.load()
        # a Unreal grava o PNG de origem com os canais na ordem BGRA: troca vermelho <-> azul
        if src.get("Format", "TSF_BGRA8") == "TSF_BGRA8" and img.mode in ("RGB", "RGBA"):
            ch = img.split()
            img = Image.merge(img.mode, (ch[2], ch[1], ch[0]) + tuple(ch[3:]))
        return img
    fmt = src.get("Format", "TSF_BGRA8")
    if fmt == "TSF_BGRA8" and w and h and len(data) >= w * h * 4:
        return Image.frombytes("RGBA", (w, h), data[:w * h * 4], "raw", "BGRA")
    if fmt == "TSF_G8" and w and h and len(data) >= w * h:
        return Image.frombytes("L", (w, h), data[:w * h])
    return None


# ====================================================================== utilidades
def game_assets_under(*game_dirs):
    """Caminhos /Game/... de todos os .uasset dentro das pastas indicadas."""
    for gd in game_dirs:
        base = os.path.join(CONTENT_DIR, *gd[len("/Game/"):].split("/"))
        for root, _dirs, files in os.walk(base):
            for fn in sorted(files):
                if fn.endswith(".uasset"):
                    rel = os.path.relpath(os.path.join(root, fn[:-7]), CONTENT_DIR).replace(os.sep, "/")
                    yield "/Game/" + rel


def asset_name(path):
    """'/Game/A/B.B_C' -> 'B'"""
    if not path:
        return None
    n = path.split(".")[-1]
    return n[:-2] if n.endswith("_C") else n


def pkg_path(path):
    return path.split(".")[0] if path else None


def enum_tail(v):
    return v.split("::")[-1] if isinstance(v, str) else v


def rnd(v):
    if isinstance(v, float):
        return round(v, 4)
    return v


CATEGORIES = [
    # chave, PT, EN
    ("building", "Construções", "Buildings"),
    ("armor", "Armaduras", "Armor"),
    ("weapon", "Armas", "Weapons"),
    ("tool", "Ferramentas", "Tools"),
    ("ammo", "Munição", "Ammo"),
    ("food", "Comidas e Bebidas", "Food & Drinks"),
    ("ingredient", "Ingredientes", "Ingredients"),
    ("medicine", "Remédios e Poções", "Medicine"),
    ("animal", "Materiais de Animais", "Animal Materials"),
    ("mineral", "Minérios", "Minerals"),
    ("plant", "Materiais Vegetais", "Plant Materials"),
    ("processed", "Materiais Processados", "Processed Materials"),
    ("mask", "Máscaras", "Masks"),
    ("mask_material", "Materiais de Máscara", "Mask Materials"),
    ("mask_module", "Módulos de Máscara", "Mask Modules"),
    ("mod", "Modificações", "Modifications"),
    ("repair", "Kits de Reparo", "Repair Kits"),
    ("utility", "Utilidades", "Utilities"),
    ("misc", "Diversos", "Miscellaneous"),
]
CAT_LABEL = {k: {"pt": pt, "en": en} for k, pt, en in CATEGORIES}


def categorize(native, cdo):
    typ = enum_tail(cdo.get("Type"))
    mat = enum_tail(cdo.get("CaiLiaoType"))
    if typ == "GaiZhuang":
        return "mod"
    if typ == "RepairKit":
        return "repair"
    if native == "HDaoJuMianJu" or (typ == "MianJu" and native == "HDaoJuMianJu"):
        return "mask"
    if native in ("HDaoJuHongJingShi",):
        return "mask_module"
    if native == "HDaoJuJianZhu" and mat in (None, "EDJCL_JianZhu"):
        return "building"
    if native == "HDaoJuZhuangBei":
        return "armor"
    if native == "HDaoJu_ZiDan":
        return "ammo"
    if native in ("HDaoJuWuQi", "HDaoJu_SheJiWuQi", "HDaoJu_TouZhi_WuQi"):
        if mat == "EDJCL_GongJu":
            return "tool"
        if mat == "EDJCL_QiTa":
            return "utility"
        return "weapon"
    if native == "HDaoJuShiWu":
        if mat == "EDJCL_YaoWu":
            return "medicine"
        if mat in ("EDJCL_ShiCai", "EDJCL_ZhiWu"):
            return "ingredient"
        return "food"
    m = {
        "EDJCL_DongWu": "animal", "EDJCL_KuangWu": "mineral", "EDJCL_ZhiWu": "plant",
        "EDJCL_BanChenPin": "processed", "EDJCL_Mask": "mask_material", "EDJCL_ShiCai": "ingredient",
        "EDJCL_YaoWu": "medicine", "EDJCL_JianZhu": "building", "EDJCL_GongJu": "tool",
    }.get(mat)
    if m:
        return m
    if native in ("HDaoJuFunction", "HDaoJuXiaoHao", "HDaoJuShuiTong", "HDaoJuShuiPing", "HDaoJuDianChi"):
        return "utility"
    return "misc"


SLOT_KEYS = {
    "ZHUANGBEI_SLOT_INDEX_YIFU": "armor",
    "ZHUANGBEI_SLOT_INDEX_SHOU": "gloves",
    "ZHUANGBEI_SLOT_INDEX_TUI": "pants",
    "ZHUANGBEI_SLOT_INDEX_JIAO": "boots",
    "ZHUANGBEI_SLOT_INDEX_TOU": "helmet",
}
SLOT_ORDER = ["armor", "gloves", "pants", "boots", "necklace", "ring", "helmet"]


def armor_slot(iid, cdo):
    """Slot da peça. Colar e anel usam índices numéricos; o nome do asset desempata."""
    s = SLOT_KEYS.get(enum_tail(cdo.get("ZhuangBeiSlotIndex")))
    if s:
        return s
    low = iid.lower()
    if "xianglian" in low or "necklace" in low:
        return "necklace"
    if "jiezhi" in low or "ring" in low:
        return "ring"
    if "shoutao" in low or "glove" in low:
        return "gloves"
    if "kuzi" in low or "pants" in low:
        return "pants"
    if "xiezi" in low or "shoes" in low or "boot" in low:
        return "boots"
    if "yifu" in low or "cloth" in low:
        return "armor"
    return None


# Rótulos de atributos de sobrevivência (mesmos termos da interface oficial do jogo)
EXTRA_ATTR_NAMES = {
    "Food": ("Saciedade", "Satiety"),
    "Water": ("Hidratação", "Hydration"),
    "XinQing": ("Humor", "Mood"),
    "TiLi": ("Vigor", "Stamina"),
    "Healing": ("Cura", "Healing"),
    "Du": ("Envenenamento", "Poisoning"),
    "FuShe": ("Radiação", "Radiation"),
    "HuXi": ("Fôlego", "Breath"),
    "CurMaxJingShen": ("Limite de Moral", "Max Morale"),
    "ZhuShiValue": ("Nutrição (Alimento Básico)", "Nutrition (Staple Food)"),
    "RouShiValue": ("Nutrição (Carne)", "Nutrition (Meat)"),
    "GuoShuValue": ("Nutrição (Frutas e Vegetais)", "Nutrition (Fruits & Vegetables)"),
    "ChengZhangExpRate": ("Taxa de EXP de Crescimento", "Growth EXP Rate"),
    "FoodConsume": ("Consumo de Saciedade", "Satiety Consumption"),
    "WaterConsume": ("Consumo de Hidratação", "Hydration Consumption"),
    "FoodConsumePctTiLiRecover": ("Saciedade gasta ao recuperar Vigor", "Satiety used on Stamina regen"),
    "WaterConsumePctTiLiRecover": ("Hidratação gasta ao recuperar Vigor", "Hydration used on Stamina regen"),
}


# ====================================================================== atributos
# Atributos mostrados em porcentagem (além dos valores com operação multiplicativa)
PCT_ATTRS = {
    "Crit", "CritDamageInc", "CritDamageDec", "CritDef", "DamageDec", "DamageInc", "AttackSpeed",
    "SpeedRate", "WuQiDamageInc", "ShengYinRatio", "FallDamageDec", "WuQiDamageDec",
    "WuQiDamageIncAgainstDun", "WuQiDamageDecIgnore", "FallSleepDamageDecRate", "BleedingDamageDecRate",
    "PoisoningDamageDecRate", "ParalysisDamageDecRate", "ZhuangBeiFangDu", "ZhuangBeiFangFuShe",
    "BlockWeakenTenacityDefense", "WeakenTenacityDefense", "TiLiWakenJianMian",
    "ChengZhangExpRate", "FoodConsume", "WaterConsume", "FoodConsumePctTiLiRecover",
    "WaterConsumePctTiLiRecover",
}


class Attrs(object):
    def __init__(self, loc):
        self.loc = loc
        self.names = {}
        rows = Package.open("/Game/Blueprints/ZiYuanGuanLi/DT_YiWenText").datatable_rows()
        for k, r in rows.items():
            t = loc.get(r.get("YiWenNeiRongText"))
            if t:
                self.names[k] = t
        # atributos de sobrevivência: mesmos textos do painel de atributos do jogo
        ui = "/Game/Blueprints/UI/ShiTu/WBP_ShiTu.WBP_ShiTu_C:WidgetTree.%s.ShuXingMing"
        ui_plus = "/Game/Blueprints/UI/ShiTu/WBP_ShiTu_Plus.WBP_ShiTu_Plus_C:WidgetTree.%s.ShuXingMing"
        official = {"Food": ui % "baoshidu", "Water": ui % "koukezhi", "XinQing": ui % "xinqing",
                    "TiLi": ui % "tili", "FuShe": ui_plus % "fushe"}
        for k, src in official.items():
            e = loc.by_src.get(src)
            if e and e.get("en"):
                self.names[k] = {"pt": clean(e.get("pt") or e["en"]), "en": clean(e["en"])}
        for k, alias in (("CurMaxJingShen", "MaxJingShen"), ("HuXi", "MaxHuXi"), ("ChengZhangExpRate", "ChengZhangExpRatio")):
            if alias in self.names:
                self.names.setdefault(k, self.names[alias])
        for k, (pt, en) in EXTRA_ATTR_NAMES.items():
            self.names.setdefault(k, {"pt": pt, "en": en})
        self.used = {}

    def stat(self, name, value, op):
        op = enum_tail(op) or "Additive"
        if not name or value is None:
            return None
        pct = op.startswith("Multipl") or name in PCT_ATTRS
        label = self.names.get(name)
        if not label:
            STATS["atributo sem nome"] += 1
            label = {"pt": name, "en": name}
        # "pct" do nome vale só para atributos que são sempre porcentagem; multiplicadores já vêm com op="mul"
        # (antes, um uso multiplicativo marcava o atributo inteiro e um +0,4 de ATQ aparecia como +40%)
        self.used[name] = {"pt": label["pt"], "en": label["en"], "pct": name in PCT_ATTRS}
        return {"a": name, "v": rnd(value), "op": "mul" if op.startswith("Multipl") else "add"}


# ====================================================================== principal
def main():
    t0 = time.time()
    loc = Loc()
    icons = Icons()
    attrs = Attrs(loc)

    prop_rows = Package.open("/Game/Blueprints/DataTable/DaoJu/DT_ZhuangBeiPropTable").datatable_rows()
    prop_rows = {int(k): v for k, v in prop_rows.items() if k.isdigit()}

    def prop_pack(pid):
        """Um pacote de atributos: fixo (1 atributo) ou aleatório (vários com peso)."""
        row = prop_rows.get(pid)
        if not row:
            return None
        out = []
        for a in row.get("AttrList", []):
            s = attrs.stat((a.get("Attr") or {}).get("AttributeName"), a.get("AttrValue"), a.get("CaoZuoFu"))
            if s:
                w = (a.get("AttrQuanZhongShang") or 0) - (a.get("AttrQuanZhongXia") or 0)
                if w and len(row.get("AttrList", [])) > 1:
                    s["w"] = w
                out.append(s)
        qmul = [rnd(q.get("PinZhiJiaChengShang", 1.0)) for q in sorted(row.get("PinZhiJiaCheng", []), key=lambda q: q.get("PinZhi", 0))]
        return {"stats": out, "qmul": qmul}

    # ------------------------------------------------------------------ itens
    log("lendo itens...")
    all_rows = Package.open("/Game/Blueprints/ZiYuanGuanLi/DT_AllDaoJu").datatable_rows()
    items = {}
    cdo_cache = {}
    for rk, r in all_rows.items():
        cls = r.get("DaoJuClass")
        if not cls:
            continue
        pkg = Package.open(cls)
        if pkg is None:
            STATS["item sem pacote"] += 1
            continue
        try:
            cdo = pkg.cdo() or {}
        except Exception:
            STATS["item com erro"] += 1
            continue
        if cdo.get("IsSpecialTestDaoJu"):
            continue
        name = loc.get(cdo.get("Name"))
        if not name:
            STATS["item sem nome traduzido"] += 1
            continue
        iid = asset_name(cls)
        native = pkg.native_parent()
        cat = categorize(native, cdo)
        it = {"id": iid}
        bi(it, "name", name)
        bi(it, "desc", loc.get(cdo.get("Description")))
        it["cat"] = cat
        if cdo.get("MaxAmount"):
            it["stack"] = cdo["MaxAmount"]
        if cdo.get("Weight") is not None:
            it["weight"] = rnd(cdo["Weight"])
        dur = cdo.get("MaxNaiJiuDu") or cdo.get("DefaultNaiJiuDu")
        if dur and cdo.get("HaveNaiJiuDu", True):
            it["durability"] = dur
        q = enum_tail(cdo.get("PinZhi"))
        if q and q.startswith("EDJPZ_Level"):
            it["quality"] = int(q[-1])
        if r.get("DlcKey", -1) not in (-1, None):
            it["dlc"] = True
        if "/AdditionMap01/" in cls:
            it["dlc"] = True
        icon = icons.get(cdo.get("Icon"))
        if icon:
            it["icon"] = icon
        items[iid] = it
        cdo_cache[iid] = (pkg, cdo, native)
    log("itens:", len(items))

    # ------------------------------------------------------------------ equipamentos (armas/armaduras)
    weapons = []
    armor_pieces = {}
    for iid, (pkg, cdo, native) in cdo_cache.items():
        it = items[iid]
        if it["cat"] not in ("weapon", "armor", "tool"):
            continue
        fixed, random_pool = [], []
        for s in cdo.get("DefaultZhuangBeiProp", []) or []:
            st = attrs.stat((s.get("ShuXing") or {}).get("AttributeName"), s.get("ShuXingValue"), s.get("CaoZuoFu"))
            if st:
                fixed.append(st)
        qmul = None
        for pid in cdo.get("PropPackID", []) or []:
            pack = prop_pack(pid)
            if not pack:
                continue
            qmul = qmul or pack["qmul"]
            if len(pack["stats"]) == 1:
                fixed.append(pack["stats"][0])
            else:
                # "g" = grupo de sorteio (cada pacote sorteia 1 atributo pelo peso "w")
                gi = len({s.get("g") for s in random_pool}) + 1
                random_pool.extend(dict(s, g=gi) for s in pack["stats"])
        extra = prop_pack(cdo.get("ExtraPropPackID")) if cdo.get("ExtraPropPackID") else None
        if extra:
            gi = len({s.get("g") for s in random_pool}) + 1
            random_pool.extend(dict(s, g=gi) for s in extra["stats"])
        if fixed:
            it["stats"] = fixed
        if random_pool:
            it["random"] = random_pool
        if qmul and any(q != 1 for q in qmul):
            it["qmul"] = qmul
        if it["cat"] == "armor":
            slot = armor_slot(iid, cdo)
            if slot:
                it["slot"] = slot
            if cdo.get("TaoZhuangNo"):
                it["set"] = cdo["TaoZhuangNo"]
            armor_pieces[iid] = it
        if it["cat"] == "weapon":
            wt = enum_tail(cdo.get("WuQiLeiXing"))
            if wt:
                it["wtype"] = wt.replace("WUQI_LEIXING_", "").lower()
            # versão aprimorada (JingHua): herda os atributos da arma de material usada na fabricação
            if "jinghua" in iid.lower() or (it.get("name_en") or "").startswith("Enhanced "):
                it["enhanced"] = True
            weapons.append(it)

    # nomes oficiais dos tipos de arma (DT_YiWenText: WuQiLeiXing_N, na ordem do enum do jogo)
    WTYPE_INDEX = {"dao": 1, "mao": 2, "gong": 3, "chui": 4, "dun": 5, "quantao": 6, "shuangdao": 7,
                   "jian": 8, "touzhiwu": 9, "gongchengchui": 10, "bian": 11}
    wtype_labels = {}
    for w in weapons:
        k = w.get("wtype")
        if k and k not in wtype_labels:
            lab = attrs.names.get("WuQiLeiXing_%d" % WTYPE_INDEX.get(k, 0))
            wtype_labels[k] = {"pt": lab["pt"], "en": lab["en"]} if lab else {"pt": k, "en": k}

    # classes (profissões) e as armas com bônus inicial de proficiência (SLD_ChuShiLv_*)
    PROF_TO_WTYPE = {"Dao": "dao", "Mao": "mao", "Gong": "gong", "Chui": "chui", "DunPai": "dun",
                     "QuanTao": "quantao", "ShuangDao": "shuangdao", "DaJian": "jian", "Bian": "bian"}
    classes = {}
    for key, table, idx in (("warrior", "ZhanShi", 1), ("hunter", "LieShou", 2), ("guard", "WeiShi", 3)):
        try:
            rr = Package.open("/Game/Blueprints/DataTable/NaturalGift/SLD_ChuShiLv_" + table).datatable_rows() or {}
        except Exception:
            rr = {}
        lab = attrs.names.get("ZhiYe_%d" % idx) or {"pt": key, "en": key}
        classes[key] = {"pt": lab["pt"], "en": lab["en"],
                        "weapons": [PROF_TO_WTYPE[p] for p in (enum_tail(r.get("ProfType")) for r in rr.values()) if p in PROF_TO_WTYPE]}
    qualities = {}
    for n in range(7):
        lab = attrs.names.get("PinZhi_%d" % n)
        if lab:
            qualities[str(n)] = {"pt": lab["pt"], "en": lab["en"]}

    # ------------------------------------------------------------------ conjuntos
    log("lendo conjuntos...")
    sets = []
    set_rows = Package.open("/Game/Blueprints/DataTable/DaoJu/DT_ZhuangBeiTaoZhuang").datatable_rows()
    for sk, sr in set_rows.items():
        sid = sr.get("TaoZhuangNo") or int(sk)
        pieces = {}
        for cls in sr.get("ZhuangBeiZuHe", []) or []:
            pid = asset_name(cls)
            p = armor_pieces.get(pid)
            if p and p.get("slot"):
                pieces[p["slot"]] = pid
                p["set"] = sid
        if not pieces:
            STATS["conjunto sem peças"] += 1
            continue
        body = armor_pieces.get(pieces.get("armor")) or armor_pieces[next(iter(pieces.values()))]
        st = {"id": sid, "name_pt": body.get("name_pt"), "name_en": body.get("name_en"),
              "icon": body.get("icon"), "pieces": pieces}
        if body.get("desc_pt"):
            st["desc_pt"], st["desc_en"] = body["desc_pt"], body.get("desc_en")
        bonuses = []
        for tier in sr.get("TaoZhuangList", []) or []:
            b = {"n": tier.get("ShuLiang"), "stats": []}
            for s in tier.get("EWaiShuXing", []) or []:
                x = attrs.stat((s.get("ShuXing") or {}).get("AttributeName"), s.get("ShuXingValue"), s.get("CaoZuoFu"))
                if x:
                    b["stats"].append(x)
            fx = []
            for ge in tier.get("EWaiGE", []) or []:
                info = ge_info(ge, loc)
                if info and info.get("desc"):
                    fx.append(info["desc"])
            if fx:
                b["effect_pt"] = "\n".join(f["pt"] for f in fx)
                b["effect_en"] = "\n".join(f["en"] for f in fx)
            bonuses.append(b)
        st["bonuses"] = bonuses
        if any(armor_pieces[p].get("dlc") for p in pieces.values()):
            st["dlc"] = True
        sets.append(st)
    log("conjuntos:", len(sets))

    # ------------------------------------------------------------------ comidas
    log("lendo comidas...")
    foods = []
    sub_counter = Counter()
    for iid, (pkg, cdo, native) in cdo_cache.items():
        it = items[iid]
        if it["cat"] not in ("food", "medicine", "ingredient"):
            continue
        ges = cdo.get("UserGEList") or cdo.get("GEList") or []
        effects, restores, duration = [], [], 0
        buffs = []
        for ge in ges:
            info = ge_info(ge, loc)
            if not info:
                continue
            for m in info["mods"]:
                st = attrs.stat(m["a"], m["v"], m["op"])
                if not st:
                    continue
                if info["instant"]:
                    restores.append(st)
                else:
                    effects.append(st)
            if not info["instant"] and info["duration"]:
                duration = max(duration, info["duration"])
            if info.get("name") and not info["instant"]:
                buffs.append(info["name"])
        f = dict(it)
        sub = food_subcategory(it)
        if sub:
            f["sub"] = sub["key"]
            sub_counter[sub["key"]] += 1
            f["sub_pt"], f["sub_en"] = sub["pt"], sub["en"]
        if effects:
            f["effects"] = effects
        if restores:
            f["restores"] = restores
        if duration:
            f["duration"] = int(duration)
        if effects or restores or it["cat"] == "food":
            foods.append(f)
    log("comidas:", len(foods), dict(sub_counter))

    # ------------------------------------------------------------------ talentos
    log("lendo talentos...")
    talents = build_talents(loc, icons, attrs.names)
    log("talentos:", len(talents))

    # ------------------------------------------------------------------ receitas
    log("lendo receitas...")
    benches = {}
    recipes = []
    for p in game_assets_under("/Game/Blueprints/PeiFang", "/Game/AdditionMap01/BluePrints/Formula"):
        pkg = Package.open(p)
        if not pkg:
            continue
        try:
            cdo = pkg.cdo() or {}
        except Exception:
            continue
        prod = asset_name(cdo.get("ProduceDaoJu"))
        if not prod or prod not in items:
            continue
        rc = {"id": p.rsplit("/", 1)[-1], "item": prod}
        bi(rc, "name", loc.get(cdo.get("PeiFangName")) or {"pt": items[prod]["name_pt"], "en": items[prod]["name_en"]})
        cnt = cdo.get("ProduceDaoJuCount") or cdo.get("ProduceCount")
        if cnt and cnt > 1:
            rc["count"] = cnt
        ing = []
        for d in cdo.get("DemandDaoJu", []) or []:
            alts = [asset_name(x) for x in d.get("DemandDaoJu", []) or [] if asset_name(x) in items]
            if alts:
                ing.append({"ids": alts, "n": d.get("DemandCount", 1)})
        if not ing:
            continue
        rc["ing"] = ing
        if cdo.get("DemandWater"):
            rc["water"] = cdo["DemandWater"]
        if cdo.get("PeiFangMakeTime"):
            rc["time"] = rnd(cdo["PeiFangMakeTime"])
        if cdo.get("PeiFangDengJi"):
            rc["level"] = cdo["PeiFangDengJi"]
        bl = []
        for g in cdo.get("MatchGongZuoTaiData", []) or []:
            for bcls in g.get("MustMatchGongZuoTaiList", []) or []:
                bid = asset_name(bcls)
                if bid not in benches:
                    benches[bid] = bench_info(bcls, loc, icons)
                if benches[bid] and bid not in bl:
                    bl.append(bid)
        if bl:
            rc["benches"] = bl
        if "/AdditionMap01/" in p:
            rc["dlc"] = True
        recipes.append(rc)
        items[prod].setdefault("recipes", []).append(rc["id"])
    benches = {k: v for k, v in benches.items() if v}
    log("receitas:", len(recipes), "bancadas:", len(benches))

    # ------------------------------------------------------------------ criaturas
    log("lendo criaturas...")
    creatures = []
    tj = Package.open("/Game/Data/DataTables/BT_DongWuTuJian").datatable_rows()
    for k, r in tj.items():
        cls = r.get("ObjectClassPath")
        pkg = Package.open(cls) if cls else None
        cdo = pkg.cdo() if pkg else {}
        name = loc.get((cdo or {}).get("MoRenMingZi"))
        if not name:
            continue
        c = {"id": k}
        bi(c, "name", name)
        for field, key in (("desc", "MiaoShu"), ("temper", "ShengHuoXiXing"), ("weak", "BuWeiXinXi"),
                           ("drops", "ChanChuXinXi"), ("active", "ChuMoXinXi"), ("habitat", "QiXiDiXinXi"),
                           ("senses", "GanGuanXinXi"), ("social", "SheHuiXingWei"), ("capture", "BuZhuoXinXi")):
            bi(c, field, loc.get(r.get(key)))
        if "/AdditionMap01/" in (cls or ""):
            c["dlc"] = True
        photo = creature_photo(pkg, k)
        if photo:
            c["photo"] = photo
        st = creature_stats(cls)
        if st:
            c["stats"] = st
        creatures.append(c)
    log("criaturas:", len(creatures), "com foto:", sum(1 for c in creatures if c.get("photo")))

    # ------------------------------------------------------------------ plantio
    crops = build_crops(items, cdo_cache, loc)
    log("plantações:", len(crops))

    # ------------------------------------------------------------------ chefes e conforto
    bosses = build_bosses(items, armor_pieces, loc)
    log("chefes:", len(bosses), "dificuldades:", sum(len(b["tiers"]) for b in bosses))
    comfort = build_comfort(items, cdo_cache, loc, icons, attrs)
    log("conforto: níveis", len(comfort["levels"]), "móveis", len(comfort["furniture"]))
    # o valor de conforto também aparece no próprio item (página Itens e janela de detalhes)
    for f in comfort["furniture"]:
        if f.get("item") in items:
            items[f["item"]]["comfort"] = f["value"]
            if f.get("max", 1) > 1:
                items[f["item"]]["comfortMax"] = f["max"]

    # ------------------------------------------------------------------ mapa do mundo
    build_world_map()
    build_menu_icons()
    log("lendo marcadores do mapa (fases do jogo)...")
    markers = build_map_markers(loc, {c["id"] for c in creatures}, items)
    build_creature_db(creatures, markers)
    leaders = build_leaders(markers, items, attrs.names, loc, creatures)
    log("líderes e chefes de ruína:", Counter(e["group"] for e in leaders))

    # ------------------------------------------------------------------ guias: proficiência, maestria, eventos, modos
    import build_guides
    markers["modes"] = build_guides.build_modes(attrs)
    proficiency = build_guides.build_proficiency(loc, attrs, icons)
    mastery = build_guides.build_mastery(loc, icons, wtype_labels)
    events = build_guides.build_events(loc)
    events["modes"] = markers["modes"]
    log("proficiências:", len(proficiency["types"]), "maestrias:", len(mastery["skills"]))
    all_bags = {k: [r for r in v if r[0] in items] for k, v in load_drop_bags().items()}
    sources = build_guides.build_item_sources(markers, creatures, bosses, all_bags, loc, crops)
    # as bolsas "cr:<criatura>" ficam só em creatures.json (loot); o mapa as remonta ao carregar
    for k in [k for k in markers["bags"] if k.startswith("cr:")]:
        del markers["bags"][k]
    red_crystals = build_guides.build_red_crystals(loc, attrs, items)
    log("itens com fonte:", len(sources), "cristais vermelhos:", len(red_crystals["crystals"]))
    npc_quality = build_guides.build_npc_quality(attrs)            # página Atributos
    fertilizers = build_guides.build_fertilizers(items, cdo_cache, loc, crops)   # página Plantio
    tameable = build_guides.build_tameable(loc, items, creatures, markers, cdo_cache)   # página Domesticáveis e montarias
    build_guides.enrich_tameable(tameable)   # porte, dieta, velocidades, passageiros, bolsa e efeito de cada comida
    log("fertilizantes:", len(fertilizers))

    # ------------------------------------------------------------------ máscaras
    masks = build_masks(items, loc, icons)
    log("máscaras:", len(masks))

    # ------------------------------------------------------------------ IDs antigos -> novos (builds salvas)
    legacy = build_legacy(items, armor_pieces, foods, talents)

    # ------------------------------------------------------------------ gravar
    def dump(name, data):
        with open(os.path.join(DATA_DIR, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        log("  ->", name, "%.0f KB" % (os.path.getsize(os.path.join(DATA_DIR, name)) / 1024))

    # armas aprimoradas não têm dano próprio (PropPackID vazio): herdam o da arma consumida na receita
    by_weapon = {w["id"]: w for w in weapons}
    for w in weapons:
        if not w.get("enhanced") or any(s["a"] == "WuQiDamage" for s in w.get("stats", [])):
            continue
        for rc in recipes:
            if rc["item"] != w["id"]:
                continue
            base = next((by_weapon[i] for g in rc["ing"] for i in g["ids"] if i in by_weapon), None)
            dmg = next((s for s in (base or {}).get("stats", []) if s["a"] == "WuQiDamage"), None)
            if dmg:
                w["stats"] = [dict(dmg)] + w.get("stats", [])
                w["dmgFrom"] = base["id"]
                if base.get("qmul") and not w.get("qmul"):
                    w["qmul"] = base["qmul"]
                if w["id"] in items:
                    items[w["id"]]["stats"] = w["stats"]
                STATS["arma aprimorada com dano herdado"] += 1
                break
    dump("weapons.json", sorted(weapons, key=lambda x: (x.get("wtype", ""), x.get("quality", 0), x["name_pt"])))
    dump("items.json", sorted(items.values(), key=lambda x: (x["cat"], x["name_pt"])))
    dump("armor-sets.json", sets)
    dump("armor-pieces.json", sorted(armor_pieces.values(), key=lambda x: (SLOT_ORDER.index(x["slot"]) if x.get("slot") in SLOT_ORDER else 99, x["name_pt"])))
    dump("foods.json", sorted(foods, key=lambda x: (x.get("sub", "zz"), x["name_pt"])))
    dump("talents.json", talents)
    dump("recipes.json", recipes)
    dump("benches.json", benches)
    add_boss_creatures(creatures, bosses, leaders, markers)   # chefes, líderes e chefes de ruína também na página Criaturas
    dump("creatures.json", sorted(creatures, key=lambda x: x["name_pt"]))
    dump("masks.json", masks)
    dump("crops.json", crops)
    dump("fertilizers.json", fertilizers)
    dump("npc-quality.json", npc_quality)
    dump("tameable.json", tameable)
    dump("map-markers.json", markers)
    dump("bosses.json", bosses)
    dump("leaders.json", leaders)
    dump("comfort.json", comfort)
    dump("proficiency.json", proficiency)
    dump("mastery.json", mastery)
    dump("events.json", events)
    dump("sources.json", sources)
    dump("red-crystals.json", red_crystals)
    dump("meta.json", {
        "categories": CAT_LABEL,
        "attrs": dict(sorted(attrs.used.items())),
        "weaponTypes": wtype_labels,
        "classes": classes,
        "qualities": qualities,
        "generated": time.strftime("%Y-%m-%d"),
    })
    dump("legacy-ids.json", legacy)
    LEGACY_MAP.pop("talents", None)   # tipos/exclusividades agora vêm do jogo
    with open(LEGACY_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(LEGACY_MAP, f, ensure_ascii=False, indent=0)

    log("resumo:", dict(STATS))
    log("pronto em %.0fs" % (time.time() - t0))


# ====================================================================== fotos das criaturas
PHOTO_DIR = os.path.join(os.path.dirname(IMG_DIR), "creatures")
PHOTO_URL = "assets/img/creatures/"


def _embedded_thumbnail(pkg):
    """Miniatura que o editor da Unreal grava dentro do .uasset (PNG 256x256, canais BGRA)."""
    from PIL import Image
    i = pkg.b.find(b"\x89PNG\r\n\x1a\n") if pkg else -1
    if i < 0:
        return None
    try:
        img = Image.open(io.BytesIO(pkg.b[i:]))
        img.load()
    except Exception:
        return None
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    ch = img.split()
    return Image.merge(img.mode, (ch[2], ch[1], ch[0]) + tuple(ch[3:]))


def _skeletal_meshes(pkg):
    """Pacotes /Game/... das SkeletalMesh referenciadas por um Blueprint (e pelos pais dele)."""
    seen = set()
    cur, depth = pkg, 0
    while cur is not None and depth < 4:
        for imp in cur.imports:
            if imp["class"] == "SkeletalMesh" and imp["outer"] < 0:
                outer = cur.imports[-imp["outer"] - 1]["name"]
                if outer.startswith("/Game/") and outer not in seen:
                    seen.add(outer)
                    yield outer
        parent = cur.parent_class_path() if hasattr(cur, "parent_class_path") else None
        cur = Package.open(parent.split(".")[0]) if parent and parent.startswith("/Game/") else None
        depth += 1


def remove_background(img, clean=True):
    """Tira o fundo do editor (céu cinza + chão xadrez) da miniatura com GrabCut (OpenCV).
    Sem OpenCV, devolve a imagem como está."""
    try:
        import cv2
        import numpy as np
    except Exception:
        return img
    from PIL import Image
    rgb = np.array(img.convert("RGB"))
    h, w = rgb.shape[:2]
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    # roupas (clean=False) ocupam a imagem quase toda: área inicial maior para não cortar pés e cabeça
    top, bottom = (0.15, 0.9) if clean else (0.03, 0.985)
    mask[int(h * top):int(h * bottom), int(w * 0.08):int(w * 0.92)] = cv2.GC_PR_FGD
    mask[:, :4] = cv2.GC_BGD
    mask[:, -4:] = cv2.GC_BGD
    mask[:4, :] = cv2.GC_BGD
    mask[-4:, :] = cv2.GC_BGD
    # sombra do editor no chão: azulada (matiz ~85-118), saturada e lisa; os bichos são marrons/cinzas.
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    lum = hsv[:, :, 2].astype(np.float32)
    mean = cv2.blur(lum, (7, 7))
    std = np.sqrt(np.maximum(cv2.blur(lum * lum, (7, 7)) - mean * mean, 0))
    shadow = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 118) & (hsv[:, :, 1] >= 45) & (std < 12)
    shadow[: int(h * 0.3), :] = False
    shadow = cv2.morphologyEx(shadow.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    mask[shadow] = cv2.GC_BGD
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, mask, None, bg, fg, 6, cv2.GC_INIT_WITH_MASK)
    except Exception:
        return img
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    alpha[shadow] = 0
    # pedaços do céu/chão do editor que ficaram grudados: áreas lisas com a cor das bordas da imagem
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    refs = [np.median(lab[:6].reshape(-1, 3), axis=0), np.median(lab[-6:].reshape(-1, 3), axis=0),
            np.median(lab[:, :6].reshape(-1, 3), axis=0), np.median(lab[:, -6:].reshape(-1, 3), axis=0)]
    near_ref = np.zeros((h, w), bool)
    for ref in refs:
        near_ref |= np.linalg.norm(lab - ref, axis=2) < 14
    sat = hsv[:, :, 1]
    # sombra cinza: neutra, lisa, mais escura que o chão, na parte de baixo
    floor_l = refs[1][0]
    gray_shadow = (sat < 45) & (std < 6) & (lab[:, :, 0] < floor_l + 3)
    gray_shadow[: int(h * 0.35), :] = False
    # penumbra azulada (pouca saturação) que sobra em volta das patas
    blue_shadow = (hsv[:, :, 0] >= 88) & (hsv[:, :, 0] <= 118) & (sat >= 18) & (std < 10)
    blue_shadow[: int(h * 0.35), :] = False
    cand = ((near_ref & (std < 5) & (sat < 40)) | gray_shadow | blue_shadow).astype(np.uint8)
    if not clean:  # roupas: só tira o céu/chão liso, nada de regra de sombra (apagaria tecido azul)
        cand = (near_ref & (std < 3) & (sat < 25)).astype(np.uint8)
    # só sai o que encosta no fundo já removido (buracos dentro do bicho, ex.: pele do elefante, ficam)
    bg_near = cv2.dilate((alpha == 0).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    n_c, lab_c = cv2.connectedComponents(cand)
    touching = np.unique(lab_c[bg_near & (cand > 0)])
    alpha[np.isin(lab_c, touching[touching > 0])] = 0
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # mantém só a maior mancha (o bicho) e suaviza a borda
    n, labels, stats, _ = cv2.connectedComponentsWithStats(alpha)
    if n > 2:
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        big = stats[keep, cv2.CC_STAT_AREA]
        for i in range(1, n):
            if i == keep:
                continue
            x, y, cw, ch, area = stats[i]
            thin_line = ch <= 8 and cw > 30          # linha do horizonte do editor
            part = labels == i
            # parte solta com cor de sombra (cinza ou azulada, pouco saturada): sombra no chão
            hue_med = float(np.median(hsv[:, :, 0][part]))
            sat_med = float(np.median(sat[part]))
            shadowy = sat_med < 40 or (88 <= hue_med <= 118 and sat_med < 140)
            if area < big * 0.15 or thin_line or y <= 2 or (shadowy and y > h * 0.3):
                alpha[part] = 0
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    if alpha.mean() < 1.5 or alpha.mean() > 200:  # recorte falhou (nada ou quase tudo sobrou)
        return None
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


OUTFIT_DIR = os.path.join(os.path.dirname(IMG_DIR), "masks")
OUTFIT_URL = "assets/img/masks/"


def _crop_to_subject(img, pad=6):
    """Corta a imagem (RGBA) em volta do que sobrou depois de tirar o fundo."""
    bbox = img.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def _square(img, size=256):
    """Centraliza a imagem num quadrado transparente (o bicho fica grande, sem distorcer)."""
    from PIL import Image
    side = max(img.width, img.height)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return sq.resize((size, size), 1) if side > size else sq


def mask_outfits():
    """Roupa que o personagem veste ao usar a transformação de cada máscara.
    Caminho: melhoria da máscara (BP_Mask_XiuFu02_<nó>) -> habilidade GA_Mask_BianShen_* ("Tag to Check"
    = GameplayEffect.Mask.BianShen.2_<nó>, MeshIndex) -> BP_ZiYuanGuanLiQi.ShiZhuangMap[MeshIndex]
    -> modelos masculino/feminino -> miniatura 3D sem o fundo do editor.
    Retorna {nó: {"m": url, "f": url}}."""
    mgr = Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ZiYuanGuanLiQi")
    table = {}
    for e in ((mgr.cdo() if mgr else None) or {}).get("ShiZhuangMap") or []:
        if e.get("WaiGuanIndex") is not None:
            table[int(e["WaiGuanIndex"])] = (e.get("WaiGuanMeshNan"), e.get("WaiGuanMeshNv"))
    os.makedirs(OUTFIT_DIR, exist_ok=True)
    by_node = {}
    for gp in game_assets_under("/Game/Blueprints/GAS/Skill/Mask", "/Game/AdditionMap01/BluePrints/GAS/Skill/Mask"):
        if "GA_Mask_BianShen_" not in gp:
            continue
        try:
            cdo = Package.open(gp).cdo() or {}
        except Exception:
            continue
        tag = ((cdo.get("Tag to Check") or {}).get("TagName")) or ""
        mt = re.search(r"BianShen\.2_(\d{4})$", tag)
        idx = cdo.get("MeshIndex")
        if not mt or idx not in table:
            continue
        urls = {}
        for sex, mesh in zip(("m", "f"), table[idx]):
            if not mesh:
                continue
            name = "outfit_%d_%s" % (idx, sex)
            out = os.path.join(OUTFIT_DIR, name + ".webp")
            if not os.path.isfile(out) or FORCE_ICONS:
                img = _embedded_thumbnail(Package.open(mesh.split(".")[0]))
                if img is None:
                    continue
                cut = remove_background(img, clean=False) or img.convert("RGBA")
                # algumas roupas são muito escuras: clareia um pouco para aparecer no fundo escuro do site
                from PIL import ImageEnhance
                rgb_part, a_part = cut.convert("RGB"), cut.getchannel("A")
                rgb_part = ImageEnhance.Brightness(rgb_part).enhance(1.35)
                rgb_part = ImageEnhance.Contrast(rgb_part).enhance(1.08)
                cut = rgb_part.convert("RGBA")
                cut.putalpha(a_part)
                _crop_to_subject(cut).save(out, "WEBP", quality=88, method=4)
            urls[sex] = OUTFIT_URL + name + ".webp"
        if urls:
            by_node[mt.group(1)] = urls
            STATS["roupas de transformação"] += 1
    return by_node


def _subject_brightness(img):
    """Brilho médio só do bicho (pixels visíveis); serve para descartar miniaturas sem textura."""
    import numpy as np
    a = np.array(img.convert("RGBA")).astype(np.float32)
    vis = a[:, :, 3] > 128
    if vis.sum() < 50:
        return 0.0
    return float(a[:, :, :3][vis].mean())


# fotos de chefe em que a miniatura do modelo saiu ruim (só o rabo / só a bola): usa este Blueprint
BOSS_PHOTO_BP = {"Sobek": "BP_Boss_Sobek", "Scarab": "BP_Building_Statue_Scarab"}


def game_assets_under_named(root, name):
    for gp in game_assets_under(root):
        if gp.rsplit("/", 1)[-1] == name:
            yield gp


def creature_photo(pkg, cid, prefer_bp=False):
    """Foto da criatura: miniatura 3D do modelo (SkeletalMesh) ou, na falta, do próprio Blueprint,
    sem o fundo do editor."""
    if pkg is None:
        return None
    os.makedirs(PHOTO_DIR, exist_ok=True)
    name = re.sub(r"[^a-z0-9_-]+", "_", cid.lower()) + "_t"   # _t = fundo transparente
    out = os.path.join(PHOTO_DIR, name + ".webp")
    if os.path.isfile(out) and not FORCE_ICONS:
        return PHOTO_URL + name + ".webp"
    # candidatas: miniatura de cada modelo e a do próprio Blueprint; algumas vêm sem textura (toda preta),
    # então fica a primeira com brilho normal (ou a mais clara)
    cands = []
    try:
        for mesh in _skeletal_meshes(pkg):
            im = _embedded_thumbnail(Package.open(mesh))
            if im is not None:
                cands.append(im)
        im = _embedded_thumbnail(pkg)
        if im is not None:
            if prefer_bp:
                cands.insert(0, im)
            else:
                cands.append(im)
    except Exception:
        pass
    if not cands:
        STATS["criatura sem foto"] += 1
        return None
    best, best_lum = None, -1
    for im in cands:
        cut = remove_background(im)
        if cut is None:
            continue
        lum = _subject_brightness(cut)
        if lum > best_lum:
            best, best_lum = cut, lum
        if lum >= 45:
            best = cut
            break
    if best is None:
        best = cands[0].convert("RGBA")
    else:
        best = _square(_crop_to_subject(best, pad=8))
    best.save(out, "WEBP", quality=85, method=4)
    STATS["fotos de criaturas"] += 1
    return PHOTO_URL + name + ".webp"


def build_crops(items, cdo_cache, loc):
    """Plantações: semente -> planta (BP_ZhongZhi_ZuoWu_*): fases, temperatura, adubo e colheita."""
    harvest = {}
    rows = Package.open("/Game/Blueprints/DataTable/CaiJiBao/DT_ZhiBeiCaiJiBao").datatable_rows()
    for r in rows.values():
        if r.get("DaoJuBaoName"):
            harvest[r["DaoJuBaoName"]] = r.get("DaoJuBaoContent") or []

    def rng(m):
        lo = ((m or {}).get("LowerBound") or {}).get("Value")
        hi = ((m or {}).get("UpperBound") or {}).get("Value")
        return [int(lo or 0), int(hi or lo or 0)]

    crops = []
    for iid, (pkg, cdo, _native) in cdo_cache.items():
        classes = cdo.get("JianZhuClasses") or []
        if iid not in items or not classes or not str(classes[0]).startswith("/Game/"):
            continue
        plant = Package.open(classes[0])
        pcdo = plant.cdo() if plant else None
        cfg = (pcdo or {}).get("ZuoWuConfig")
        if not cfg:
            continue
        seed = items[iid]
        c = {"id": iid, "icon": seed.get("icon")}
        bi(c, "name", loc.get(pcdo.get("JianZhuDisplayName")) or {"pt": seed["name_pt"], "en": seed["name_en"]})
        bi(c, "seed", {"pt": seed["name_pt"], "en": seed["name_en"]})
        bi(c, "desc", {"pt": seed.get("desc_pt", ""), "en": seed.get("desc_en", "")})
        stages = [s.get("NeedTime", 0) for s in cfg.get("JieDuanConfig", []) if s.get("NeedTime", 0) > 1]
        c["growth"] = int(sum(stages))
        c["stages"] = len(stages)
        temps = []
        for w in cfg.get("WenDuConfig", []):
            lo, hi = (w.get("WenDuRange") or [None, None])[:2]
            tt = {"min": None if lo is None or lo <= -999 else lo, "max": None if hi is None or hi >= 999 else hi,
                  "mult": w.get("ShengZhangTimePower", 0)}
            bi(tt, "label", loc.get(w.get("WenDuDesc")))
            bi(tt, "growthLabel", loc.get(w.get("ShengZhangDesc")))
            temps.append(tt)
        c["temps"] = temps
        fl = cfg.get("NeedFeiLiao") or {}
        if fl.get("FLVal"):
            c["fert"] = {"type": int(re.sub(r"\D", "", enum_tail(fl.get("FLType")) or "0") or 0), "amount": fl["FLVal"]}
        out = []
        for group in harvest.get(cfg.get("CaiJiDaoJuBaoName"), []):
            total = sum(i.get("DaoJuQuanZhong", 0) for i in group.get("BaoNeiDaoJuInfos", [])) or 1
            for i in group.get("BaoNeiDaoJuInfos", []):
                hid = asset_name(i.get("DaoJuClass") or "")
                if hid in items:
                    chance = group.get("SelectedRandomProbability", 100) * i.get("DaoJuQuanZhong", 0) / total
                    out.append({"id": hid, "n": rng(i.get("DaoJuMagnitude")), "chance": round(chance)})
        c["harvest"] = out
        if cfg.get("ProfExp"):
            c["exp"] = cfg["ProfExp"]
        if seed.get("dlc") or "/AdditionMap01/" in str(classes[0]):
            c["dlc"] = True
        crops.append(c)
    return sorted(crops, key=lambda x: x["name_pt"])


def _rng(m):
    lo = ((m or {}).get("LowerBound") or {}).get("Value")
    hi = ((m or {}).get("UpperBound") or {}).get("Value")
    return [int(lo or 0), int(hi or lo or 0)]


def _group_cond(group):
    """Condições do grupo de drop (TiaoJian) -> texto curto: E entre blocos com "&", OU dentro do bloco com "|".
    Ex.: "IsNotSurvival" (moedas só fora do modo Sobrevivência), "Area_IsYuLin", "PVP_7Day+"."""
    parts = []
    for cc in group.get("ConditionAndCheckData") or []:
        ors = []
        for x in cc.get("ConditionOrCheck") or []:
            n = re.sub(r"^(TJ_DL_|TJ_|BP_Condition_)", "", str(x).split(".")[-1])
            ors.append(re.sub(r"_C$", "", n))
        if ors:
            parts.append("|".join(ors))
    return "&".join(parts)


def bag_rows(content, item_ids=None, g0=0):
    """Pacote de drop (CaiJiBao) agrupado como no jogo: o jogo sorteia cada grupo pela chance do grupo e,
    dentro dele, um item pelo peso.
    -> [[item, mín, máx, chance do grupo %, chance no grupo %, nº do grupo, (condição)], ...]"""
    out = []
    for gi, group in enumerate(content or []):
        cond = _group_cond(group)
        infos = group.get("BaoNeiDaoJuInfos") or []
        total = sum(i.get("DaoJuQuanZhong", 0) for i in infos) or 1
        for i in infos:
            iid = asset_name(i.get("DaoJuClass") or "")
            if not iid or (item_ids is not None and iid not in item_ids):
                continue
            m = i.get("DaoJuMagnitude") or {}
            lo = int(((m.get("LowerBound") or {}).get("Value")) or 0)
            hi = int(((m.get("UpperBound") or {}).get("Value")) or lo)
            row = [iid, lo, hi, round(group.get("SelectedRandomProbability", 100), 1),
                   round(i.get("DaoJuQuanZhong", 0) * 100 / total, 1), g0 + gi]
            if cond:
                row.append(cond)
            out.append(row)
    return out


def _pack_drops(content, items):
    """Conteúdo de um pacote de drop (CaiJiBao) -> [{id, n:[min,max], chance}]"""
    out = []
    for group in content or []:
        infos = group.get("BaoNeiDaoJuInfos") or []
        total = sum(i.get("DaoJuQuanZhong", 0) for i in infos) or 1
        for i in infos:
            iid = asset_name(i.get("DaoJuClass") or "")
            if iid in items:
                chance = group.get("SelectedRandomProbability", 100) * i.get("DaoJuQuanZhong", 0) / total
                out.append({"id": iid, "n": _rng(i.get("DaoJuMagnitude")), "chance": max(1, round(chance))})
    # o mesmo item pode aparecer em grupos diferentes: soma quantidades se a chance for 100%
    merged = {}
    for d in out:
        m = merged.get(d["id"])
        if m and m["chance"] >= 100 and d["chance"] >= 100:
            m["n"] = [m["n"][0] + d["n"][0], m["n"][1] + d["n"][1]]
        elif not m or d["chance"] > m["chance"]:
            merged[d["id"]] = d
    return list(merged.values())


def build_bosses(items, armor_pieces, loc):
    """Chefes das pirâmides: as 3 dificuldades de cada um (invocação no altar), XP, drops e o que liberam."""
    packs = {}
    for r in Package.open("/Game/Blueprints/DataTable/CaiJiBao/DT_ShengWuCaiJiBao").datatable_rows().values():
        if r.get("DaoJuBaoName"):
            packs[r["DaoJuBaoName"]] = r.get("DaoJuBaoContent") or []
    collect = {}
    for path, conf in ((Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ShengWuCollectData").cdo() or {})
                       .get("ShengWuPropConfigSoftMap") or {}).items():
        m = (conf or {}).get("ShengWuCollectDaoJuMap") or {}
        first = next(iter(m.values()), None) if m else None
        if first:
            collect[pkg_path(path)] = (first.get("CaiJiDaoJuBaoName"), first.get("CaiJiFinalDaoJuBaoName"))

    def cdo_of(path):
        pkg = Package.open(pkg_path(path)) if path else None
        # classe renomeada no editor: o pacote antigo vira um ObjectRedirector para o novo
        if pkg and any(pkg.export_class(e) == "ObjectRedirector" for e in pkg.exports):
            target = next((i["name"] for i in pkg.imports if i["name"].startswith("/Game/")), None)
            pkg = Package.open(target) if target else pkg
        try:
            return pkg, (pkg.cdo() if pkg else None) or {}
        except Exception:
            return pkg, {}

    def tech(sub_path):
        """Nó de tecnologia liberado ao derrotar o chefe -> nome, condição e itens que ensina a fabricar."""
        _pkg, c = cdo_of(sub_path)
        if not c:
            return None
        t = {}
        bi(t, "name", loc.get(c.get("Name")))
        bi(t, "cond", loc.get(c.get("AutoLearnCondition")))
        made = []
        for rp in c.get("KeJiPeiFangSoftList") or []:
            _p, rc = cdo_of(rp)
            prod = asset_name(rc.get("ProduceDaoJu"))
            if prod in items and prod not in made:
                made.append(prod)
        sets = sorted({armor_pieces[i]["set"] for i in made if i in armor_pieces and armor_pieces[i].get("set")})
        if sets:
            t["sets"] = sets
        others = [i for i in made if i not in armor_pieces]
        if others:
            t["items"] = others
        return t if t.get("name_pt") else None

    def find_collect(pkg):
        cur, depth = pkg, 0
        while cur is not None and depth < 4:
            key = collect.get(cur.game_path) if hasattr(cur, "game_path") else None
            if key:
                return key
            parent = cur.parent_class_path()
            cur = Package.open(pkg_path(parent)) if parent and parent.startswith("/Game/") else None
            depth += 1
        return None

    altars = []
    for p in game_assets_under("/Game/Blueprints/JianZhu/GameFunction", "/Game/AdditionMap01/BluePrints/Building/GameFunction"):
        if "Summon" not in p.rsplit("/", 1)[-1]:
            continue
        _pkg, c = cdo_of(p)
        tiers = []
        for rpath, ex in (c.get("GameFunctionExecutionMap") or {}).items():
            for e in (ex or {}).get("ExecutionList") or []:
                if "SUMMON_NPC" in str(e.get("FunctionType")) and str(e.get("ExecuteActorClass") or "").startswith("/Game/"):
                    tiers.append((rpath, e["ExecuteActorClass"]))
        if tiers:
            altars.append((p, tiers))

    bosses = []
    for altar, tiers in altars:
        boss = {"id": altar.rsplit("_", 1)[-1], "tiers": []}
        photo_pkg = None
        for rpath, cls in tiers:
            bpkg, bc = cdo_of(cls)
            if not bc:
                continue
            # a classe invocada pode ser uma variante sem dados próprios: usa o pai quando precisar
            parent = bpkg.parent_class_path() if bpkg else None
            ppkg, pc = cdo_of(parent) if parent and parent.startswith("/Game/") and "Boss" in parent else (None, {})
            name = loc.get(bc.get("MoRenMingZi")) or loc.get(pc.get("MoRenMingZi"))
            if not name:
                continue
            _rp, rc = cdo_of(rpath)
            tier = {}
            bi(tier, "name", name)
            exp = bc.get("KilledExp") or pc.get("KilledExp")
            if exp:
                tier["exp"] = exp
            if rc.get("PeiFangDengJi"):
                tier["level"] = rc["PeiFangDengJi"]
            ing = []
            for d in rc.get("DemandDaoJu") or []:
                alts = [asset_name(x) for x in d.get("DemandDaoJu") or [] if asset_name(x) in items]
                if alts:
                    ing.append({"ids": alts, "n": d.get("DemandCount", 1)})
            if ing:
                tier["summon"] = ing
            pk = find_collect(bpkg) or (find_collect(ppkg) if ppkg else None)
            if pk:
                dr = _pack_drops(packs.get(pk[0]), items)
                fin = _pack_drops(packs.get(pk[1]), items)
                if dr:
                    tier["drops"] = dr
                if fin:
                    tier["final"] = fin
                # mesma coisa, agrupada como o jogo sorteia (janela do mapa interativo)
                g1 = bag_rows(packs.get(pk[0]), items)
                g2 = bag_rows(packs.get(pk[1]), items, g0=1000)
                if g1 or g2:
                    tier["groups"] = g1 + g2
            parts = []
            for bw in bc.get("BuWeiConfigList") or pc.get("BuWeiConfigList") or []:
                for d in _pack_drops(packs.get(bw.get("BuWeiDiaoLuoBao")), items):
                    if d["id"] not in [x["id"] for x in parts]:
                        parts.append(d)
            if parts:
                tier["parts"] = parts
            unlocks = [tech(a.get("KeJiSubNodeClass")) for a in bc.get("AutoLearnKeJiList") or pc.get("AutoLearnKeJiList") or []]
            unlocks = [u for u in unlocks if u]
            if unlocks:
                tier["unlocks"] = unlocks
            tier["_cls"] = pkg_path(cls)   # só para os atributos base (sai antes de gravar)
            boss["tiers"].append(tier)
            if photo_pkg is None:
                photo_pkg = bpkg
        if not boss["tiers"]:
            continue
        boss["tiers"].sort(key=lambda t: t.get("level", 0))
        # atributos base da 1ª dificuldade (página Criaturas)
        # (sem tabela na classe invocada, ex.: BP_EgyptDLC_JackalKing_1: DT_Attr_<chefe>_1 pelo nome, não confirmado)
        st = creature_stats(boss["tiers"][0].get("_cls")) or creature_stats("/Game/_/X.BP_Monster_%s_1" % boss["id"])
        if st:
            boss["stats"] = st
        for t in boss["tiers"]:
            t.pop("_cls", None)
        first = boss["tiers"][0]
        boss["name_pt"], boss["name_en"] = first["name_pt"], first["name_en"]
        sets = []
        for t in boss["tiers"]:
            for u in t.get("unlocks", []):
                sets += [s for s in u.get("sets", []) if s not in sets]
        if sets:
            boss["sets"] = sets
        if "/AdditionMap01/" in altar:
            boss["dlc"] = True
        override = BOSS_PHOTO_BP.get(boss["id"])
        if override:
            found = next(game_assets_under_named("/Game/AdditionMap01", override), None)
            if found:
                photo_pkg = Package.open(found)
        photo = creature_photo(photo_pkg, "boss_" + boss["id"].lower(), prefer_bp=bool(override))
        if photo:
            boss["photo"] = photo
        bosses.append(boss)
    bosses.sort(key=lambda b: (bool(b.get("dlc")), b["tiers"][0].get("level", 0)))
    return bosses


def boss_harvest(cls_path, items):
    """O que um chefe-criatura dá ao esquartejar (BP_ShengWuCollectData -> DT_ShengWuCaiJiBao) e o XP dele."""
    pkg = Package.open(cls_path)
    cdo = (pkg.cdo() if pkg else None) or {}
    packs = {r.get("DaoJuBaoName"): r.get("DaoJuBaoContent") or []
             for r in Package.open("/Game/Blueprints/DataTable/CaiJiBao/DT_ShengWuCaiJiBao").datatable_rows().values()}
    conf = ((Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ShengWuCollectData").cdo() or {})
            .get("ShengWuPropConfigSoftMap") or {})
    m = next((v for k, v in conf.items() if pkg_path(k) == cls_path), None) or {}
    first = next(iter((m.get("ShengWuCollectDaoJuMap") or {}).values()), {})
    return {"exp": cdo.get("KilledExp"),
            "harvest": _pack_drops(packs.get(first.get("CaiJiDaoJuBaoName")), items),
            "final": _pack_drops(packs.get(first.get("CaiJiFinalDaoJuBaoName")), items)}


def add_duels(entries, items, loc, drops):
    """Postos de desafio (BP_JianZhu_Summon_TribeBoss/RobberBoss): cada receita invoca um líder num duelo.
    Liga a receita ao líder pelo nome do NPC que o invocador cria; quem não está no mapa (os Deuses da Guerra)
    vira um card novo, sem local."""
    for altar, group in (("/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_Summon_TribeBoss", "tribe"),
                         ("/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_Summon_RobberBoss", "plunderer")):
        apkg = Package.open(altar)
        acdo = (apkg.cdo() if apkg else None) or {}
        altar_name = loc.get(acdo.get("JianZhuDisplayName"))
        # modos de jogo onde o Posto de desafio existe: o item dele fica escondido nos outros (HiddenItemInGameMode)
        ipkg = Package.open(pkg_path(acdo.get("JianZhuDaoJuClass"))) if acdo.get("JianZhuDaoJuClass") else None
        hidden = {enum_tail(m) for m in ((ipkg.cdo() if ipkg else None) or {}).get("HiddenItemInGameMode") or []}
        modes = [site for game, site in (("Survival", "survival"), ("Management", "tribe"), ("Action", "warrior"),
                                         ("PVP", "pvp"), ("Creative", "casual")) if game not in hidden]
        for rpath, ex in (acdo.get("GameFunctionExecutionMap") or {}).items():
            rc = (Package.open(pkg_path(rpath)).cdo() if Package.open(pkg_path(rpath)) else None) or {}
            ing = []
            for d in rc.get("DemandDaoJu") or []:
                alts = [asset_name(x) for x in d.get("DemandDaoJu") or [] if asset_name(x) in items]
                if alts:
                    ing.append({"ids": alts, "n": d.get("DemandCount", 1)})
            title = loc.get(rc.get("PeiFangName"))
            if not ing or not title:
                continue
            duel = {"title_pt": title["pt"], "title_en": title["en"], "ing": ing}
            if len(modes) < 5:
                duel["modes"] = modes
            if altar_name:
                duel["at_pt"], duel["at_en"] = altar_name["pt"], altar_name["en"]
            for e in (ex or {}).get("ExecutionList") or []:
                scg = pkg_path(e.get("ExecuteObjPara"))
                spkg = Package.open(scg) if scg else None
                scdo = (spkg.cdo() if spkg else None) or {}
                for s in scdo.get("SCGInfoList") or []:
                    for g in s.get("SGBList") or []:
                        cls = g.get("GuaiWuClass")
                        cpkg = Package.open(pkg_path(cls)) if cls else None
                        nm = loc.get(((cpkg.cdo() if cpkg else None) or {}).get("MoRenMingZi"))
                        if not nm:
                            continue
                        hit = [en for (mk, _k), en in entries.items() if mk == "main" and en["name_en"] == nm["en"]]
                        if not hit:
                            key = ("duel", nm["en"])
                            if key not in entries:
                                slug = re.sub(r"[^a-z0-9]+", "-", nm["en"].lower()).strip("-")
                                entries[key] = {"id": "main-" + slug, "group": group, "map": "main",
                                                "name_pt": nm["pt"], "name_en": nm["en"], "variants": {}}
                            ent = entries[key]
                            lo, hi, bag = g.get("SCGZuiXiaoDengJi"), g.get("SCGZuiDaDengJi"), g.get("DiaoLuoBaoID")
                            v = ent["variants"].setdefault((lo, hi, bag, None), {"lo": lo, "hi": hi, "spots": []})
                            dr = drops(bag)
                            if dr:
                                v["drops"] = dr
                            if altar_name:
                                v["where_pt"], v["where_en"] = altar_name["pt"], altar_name["en"]
                            hit = [ent]
                        for en in hit:
                            if all(x["title_en"] != duel["title_en"] for x in en.setdefault("duel", [])):
                                en["duel"].append(duel)


def build_leaders(markers, items, names, loc=None, creatures=None):
    """Líderes de tribo, líderes saqueadores, chefes de ruína e chefes do mundo, tirados dos pontos do mapa
    (build_map_markers): nome oficial, nível, onde ficam, drops (bolsa do jogo), o equipamento que vestem e podem
    soltar e, para os líderes, a receita de duelo no Posto de desafio."""
    # chefe-criatura gigante sem item de invocação (vai para a aba Chefes, junto com os das pirâmides);
    # o Núcleo Central e a Punição Divina ficam em Chefes de ruína
    WORLD = {"Death Sandstorm"}
    # criaturas da enciclopédia que também são chefes (nenhuma no momento: o Rei Rato Mutante é só um rato elite)
    WORLD_CREATURES = set()
    cr_by_id = {c["id"]: c for c in creatures or []}
    WORLD_HARVEST = {"Death Sandstorm": "/Game/AdditionMap01/BluePrints/Monster/Boss_Behemoth/BP_Boss_Behemoth"}
    # Blueprint de cada chefe mecânico/do mundo (achado pelo MoRenMingZi), para a foto do modelo
    M = "/Game/AdditionMap01/BluePrints/Monster/"
    PHOTO_CLASS = {
        ("main", "Central Core"): "/Game/Blueprints/DongWu/BP_JiXie_Boss",
        ("dlc", "Central Core"): M + "CentralCore/BP_Boss_CentralCore",
        ("*", "Death Sandstorm"): M + "Boss_Behemoth/BP_Boss_Behemoth",
        ("*", "Destroyer"): M + "Machine/Destroyer/BP_Boss_Destroyer",
        ("*", "Divine Punishment"): M + "Machine/Valkyrie/BP_Boss_Valkyrie",
        ("*", "Huntsman"): M + "Machine/Ranger/BP_Boss_Ranger",
        ("*", "Observer III"): M + "Machine/Recon02/BP_Machine_Recon02_Boss",
        ("*", "Patroller III"): M + "Machine/Recon01/BP_Machine_Recon01_Boss",
        ("*", "Trailblazer S"): M + "Machine/Excavator/BP_Machine_Excavator_Boss",
        ("*", "Mechanical Core X"): "/Game/Blueprints/DongWu/BP_JiXie_HuiMie",
        ("*", "Mechanical Core Y"): "/Game/Blueprints/DongWu/BP_JiXie_HuiMie_Dian",
        ("*", "Slayer X"): "/Game/Blueprints/DongWu/BP_JiXie_ShouWei",
        ("*", "Terminator"): "/Game/Blueprints/DongWu/BP_JiXie_BOSS02",
    }
    TRIBE_BAG = re.compile(r"^(DesertWolf|SavageHorn)\d+_Boss$")
    CLAN_OF_BAG = {"DesertWolf": "Clan_6", "SavageHorn": "Clan_5"}
    PLUNDERER = re.compile(r"^(Plunderer .*(Leader|King)|Sand Bandit (Leader|King|Shadow))", re.I)
    RUIN_BAG = re.compile(r"^(DL_JiXie_Boss|Machine_Boss|CenterCore)")
    bags = markers.get("bags") or {}
    equip = markers.get("npcEquip") or []

    def drops(bag):
        out = {}
        for r in bags.get(bag) or []:
            if len(r) > 6 or r[0] not in items:   # grupos com condição (só em certos modos) ficam de fora
                continue
            ch = round(r[3] * r[4] / 100, 1)
            if ch <= 0:
                continue
            d = {"id": r[0], "n": [r[1], r[2]], "chance": ch}
            if r[0] not in out or ch > out[r[0]]["chance"]:
                out[r[0]] = d
        return sorted(out.values(), key=lambda d: (-d["chance"], d["id"]))

    def gear(idx):
        eq = equip[idx] if isinstance(idx, int) and 0 <= idx < len(equip) else None
        if not eq:
            return None
        armor = []
        for slot, ids in sorted((eq.get("slots") or {}).items(), key=lambda kv: int(kv[0])):
            ids = [i for i in ids if i in items]
            if ids:
                armor.append({"slot": int(slot), "ids": ids, "chance": (eq.get("drop") or {}).get(slot)})
        g = {"armor": armor} if armor else {}
        w = [i for i in eq.get("weapons") or [] if i in items]
        if w:
            g["weapons"] = w
            if eq.get("weaponDrop") is not None:
                g["weaponChance"] = eq["weaponDrop"]
        return g or None

    def region(mk, x, y):
        regs = markers["maps"][mk].get("regions") or []
        best = min(regs, key=lambda r: (r["x"] - x) ** 2 + (r["y"] - y) ** 2, default=None)
        return best["name"] if best else None

    entries = {}

    def add(group, mk, key, name, lo, hi, bag, eq, x, y, place=None):
        e = entries.get((mk, key))
        if e is None:
            slug = re.sub(r"[^a-z0-9]+", "-", (name["en"] or key).lower()).strip("-")
            e = entries[(mk, key)] = {"id": "%s-%s" % (mk, slug), "group": group, "map": mk,
                                      "name_pt": name["pt"], "name_en": name["en"], "variants": {}}
            if mk == "dlc":
                e["dlc"] = True
        vk = (lo, hi, bag, eq)
        v = e["variants"].get(vk)
        if v is None:
            v = e["variants"][vk] = {"lo": lo, "hi": hi, "spots": []}
            dr = drops(bag)
            if dr:
                v["drops"] = dr
            g = gear(eq)
            if g:
                v["gear"] = g
            where = place or region(mk, x, y)
            if where:
                v["where_pt"], v["where_en"] = where["pt"], where["en"]
        # pontos quase no mesmo lugar (ex.: dois andares do mesmo covil) contam como um só local
        if all((x - s[0]) ** 2 + (y - s[1]) ** 2 > 1 for s in v["spots"]):
            v["spots"].append([x, y])

    for mk, mp in (markers.get("maps") or {}).items():
        labels = mp.get("labels") or []
        for p in mp.get("points") or []:
            if p[0] == "dungeon":
                dg = (markers.get("dungeons") or {}).get(p[5]) if len(p) > 5 else None
                for en in (dg or {}).get("enemies") or []:
                    if en.get("role") == "boss":
                        place = {"pt": dg.get("title_pt") or "", "en": dg.get("title_en") or ""} if dg.get("title_pt") else None
                        # o mesmo chefe nas masmorras de nível 40/50/60: um card só, com uma aba por masmorra
                        add("ruin", mk, "dg:" + en["name_en"], {"pt": en["name_pt"], "en": en["name_en"]},
                            en["lo"], en["hi"], en.get("bag"), None, p[1], p[2], place)
                continue
            # criatura-chefe da enciclopédia sem invocação (ex.: Rei Rato Mutante): também vai para a aba Chefes
            if p[0] == "creature" and p[4] in WORLD_CREATURES and p[4] in cr_by_id:
                c = cr_by_id[p[4]]
                add("world", mk, p[4], {"pt": c["name_pt"], "en": c["name_en"]}, p[5], p[6],
                    p[7] or (markers.get("creatureBags") or {}).get(p[4]), None, p[1], p[2])
                ent = entries[(mk, p[4])]
                if c.get("photo"):
                    ent["photo"] = c["photo"]
                continue
            if p[0] != "npc" or len(p) < 8:
                continue
            lab = labels[p[4]] if isinstance(p[4], int) and p[4] < len(labels) else None
            if not lab:
                continue
            bag = p[7] or ""
            eq = p[8] if len(p) > 8 else None
            tb = TRIBE_BAG.match(bag)
            if tb:
                clan = names.get(CLAN_OF_BAG[tb.group(1)])
                if not clan:
                    continue
                name = {"pt": "Líder da %s" % clan["pt"], "en": "%s Leader" % clan["en"]}
                add("tribe", mk, "tribe:" + tb.group(1), name, p[5], p[6], bag, eq, p[1], p[2])
            elif re.search(r"Tribe Leader", lab["en"]):
                add("tribe", mk, lab["en"], lab, p[5], p[6], bag, eq, p[1], p[2])
            elif PLUNDERER.search(lab["en"]):
                add("plunderer", mk, lab["en"], lab, p[5], p[6], bag, eq, p[1], p[2])
            elif lab["en"] in WORLD:
                add("world", mk, lab["en"], lab, p[5], p[6], bag, eq, p[1], p[2])
                # chefe sem bolsa de drop (criatura gigante): o que dá ao esquartejar
                harvest = WORLD_HARVEST.get(lab["en"])
                if harvest and not bag:
                    v = entries[(mk, lab["en"])]["variants"][(p[5], p[6], bag, eq)]
                    v.update({k: val for k, val in boss_harvest(harvest, items).items() if val})
            elif RUIN_BAG.match(bag):
                add("ruin", mk, lab["en"], lab, p[5], p[6], bag, eq, p[1], p[2])

    # duelos nos Postos de desafio (líderes de tribo e saqueadores): receita de invocação e quem ela chama
    if loc is not None:
        add_duels(entries, items, loc, drops)

    out = []
    for e in entries.values():
        e["variants"] = sorted(e["variants"].values(), key=lambda v: (v["lo"], v["hi"]))
        # foto: miniatura 3D do modelo do chefe (os humanos não têm retrato no jogo: ficam com o ícone)
        cls = PHOTO_CLASS.get((e["map"], e["name_en"])) or PHOTO_CLASS.get(("*", e["name_en"]))
        photo = creature_photo(Package.open(cls), "boss_" + e["id"]) if cls else None
        if photo and not e.get("photo"):
            e["photo"] = photo
        # atributos base (página Criaturas); os líderes humanos não têm tabela própria no jogo
        st = creature_stats(cls) if cls else None
        if st:
            e["stats"] = st
        out.append(e)
    order = {"world": 0, "tribe": 1, "plunderer": 2, "ruin": 3}
    out.sort(key=lambda e: (order[e["group"]], e["map"] != "main", e["variants"][0]["lo"], e["name_pt"]))
    return out


def build_comfort(items, cdo_cache, loc, icons, attrs):
    """Conforto: níveis (BP_JianZhuGuanLiQi.ShuShiGEList -> GE_ShuShiDu*) e o valor de cada móvel (JianZhuJiaJuList)."""
    mgr = Package.open("/Game/Blueprints/JianZhu/BP_JianZhuGuanLiQi").cdo() or {}
    show = mgr.get("ShuShiAuxGEList") or {}
    thresholds = sorted((int(k), v) for k, v in (mgr.get("ShuShiGEList") or {}).items())
    levels = []
    for i, (lo, ge) in enumerate(thresholds):
        info = ge_info(ge, loc) or {}
        sh = ge_info(show.get(str(lo)), loc) or {}
        lv = {"n": i + 1, "min": lo}
        if i + 1 < len(thresholds):
            lv["max"] = thresholds[i + 1][0] - 1
        bi(lv, "name", sh.get("name"))
        bi(lv, "info", sh.get("desc"))
        bi(lv, "buff", info.get("name"))
        bi(lv, "desc", info.get("desc"))
        stats = [attrs.stat(m["a"], m["v"], m["op"]) for m in info.get("mods", [])]
        lv["stats"] = [s for s in stats if s]
        if info.get("duration"):
            lv["duration"] = int(info["duration"])
        levels.append(lv)

    entries = {}
    for e in mgr.get("JianZhuJiaJuList") or []:
        cls = pkg_path(e.get("JianZhuJiaJuClass"))
        if cls and e.get("ShuShiValue"):
            entries[cls] = {"value": rnd(e["ShuShiValue"]), "max": e.get("ShuShiDieJiaNum") or 1}

    # cada construção (item) herda o valor da classe mais próxima na cadeia de pais
    def match(cls_path):
        cur, depth = cls_path, 0
        while cur and depth < 6:
            if cur in entries:
                return cur
            pkg = Package.open(cur)
            parent = pkg.parent_class_path() if pkg else None
            cur = pkg_path(parent) if parent and parent.startswith("/Game/") else None
            depth += 1
        return None

    used = set()
    furniture = []
    for iid, (_pkg, cdo, _native) in cdo_cache.items():
        classes = cdo.get("JianZhuClasses") or []
        if iid not in items or not classes or not str(classes[0]).startswith("/Game/"):
            continue
        key = match(pkg_path(classes[0]))
        if not key:
            continue
        used.add(key)
        it = items[iid]
        f = {"id": iid, "item": iid, "value": entries[key]["value"], "max": entries[key]["max"],
             "name_pt": it["name_pt"], "name_en": it["name_en"]}
        if it.get("icon"):
            f["icon"] = it["icon"]
        if it.get("dlc"):
            f["dlc"] = True
        furniture.append(f)
    # entradas sem item de construção (ex.: troféus de caça): usa o nome e o ícone do próprio Blueprint
    for cls, e in entries.items():
        if cls in used:
            continue
        info = bench_info(cls, loc, icons)
        if not info:
            STATS["móvel de conforto sem nome"] += 1
            continue
        f = {"id": cls.rsplit("/", 1)[-1], "value": e["value"], "max": e["max"]}
        f.update(info)
        if "/AdditionMap01/" in cls:
            f["dlc"] = True
        furniture.append(f)
    furniture.sort(key=lambda x: (-x["value"], x["name_pt"]))
    return {"levels": levels, "radius": rnd((mgr.get("ShuShiFindJiaJuRadius") or 0) / 100), "furniture": furniture}


MAP_LEVELS = {
    # id: (fase principal com o HWorldSettings, pasta das subfases)
    "main": ("/Game/Maps/Level01/Level01_Main", "Maps/Level01"),
    "dlc": ("/Game/AdditionMap01/Maps/DLC_Level01/DLC_Level01_Main", "AdditionMap01/Maps/DLC_Level01"),
}
# desenho de cada mapa (UI/Map/*) -> assets/img/map/<arquivo>.webp
MAP_IMAGES = {"main": ("/Game/UI/Map/Level01_Map", "world"), "dlc": ("/Game/AdditionMap01/UI/Map/DLC_Level01_Map", "dlc")}


def _level_settings(main_path):
    p = Package.open(main_path)
    for e in p.exports:
        if p.export_class(e) == "HWorldSettings":
            props, _ = p.read_export_props(e)
            return props
    return {}


def _marker_kind(c):
    """Classe do ator na fase -> (categoria, subtipo) do marcador, ou None para ignorar."""
    if ("ChuanSongMen" in c and not c.startswith("BP_Collections")) or c.startswith("BP_RegionalPortal_"):
        return "teleport", None
    m = re.match(r"BP_JianZhu_ShiBei(\d+)_C$", c)
    if m:
        return ("tabletAncient" if int(m.group(1)) < 100 else "tabletDivine"), None
    if c.startswith("BP_JianZhu_JingZiTaMen"):
        return "pyramid", None
    if (c.startswith("BP_JianZhu_DiXiaCheng") or c.startswith("BP_Portal_DungeonEgypt_Lv")) and "Exit" not in c:
        return "dungeon", None   # entrada de masmorra (Floresta) / portal da masmorra (Areias Errantes)
    if c.startswith("BP_JianZhu_YiJiDaMen") or c.startswith("BP_JianZhu_YiJi_JiGuanDaMen"):
        return "ruin", None
    if c.startswith("BP_JianZhu_YiJiMianJuXiuFu"):
        return "maskAltar", None
    if c.startswith("BP_BaoXiang_Mask"):
        return "maskChest", None
    if c.startswith("BP_BaoXiang") or c.startswith("BP_RuinsBox_") or c.startswith("BP_TribeBox_"):
        return "chest", None   # BP_RuinsBox_* / BP_TribeBox_* = baús do mapa da DLC
    m = re.match(r"BP_JianZhu_KuangMai_([A-Za-z]+?)\d*_C$", c)
    if m:
        return "ore", m.group(1).lower()
    # BP_BuLuoGLQ (gerente da tribo) fica no mesmo lugar do acampamento/quartel/fortaleza oficial: não vira marcador
    # pontos de renascimento: Areias Errantes (RuinsRespawnPoint / CentralCore) e Floresta (YiJiFuHuoDian, nas ruínas)
    if c.startswith(("BP_Building_RuinsRespawnPoint", "BP_Building_CentralCoreRespawnPoint", "BP_JiGuan_YiJiFuHuoDian")):
        return "respawn", None
    if c.startswith("BP_CrowdNPC_Firefly"):
        return "firefly", None
    if c.startswith("BP_RuQinSGQ"):
        return "invasion", None   # ponto de onde saem as invasões
    # altar de invocação dos chefes: DLC (Sobek, Escaravelho, Anúbis) e Floresta (os 5 chefes de pirâmide)
    m = re.match(r"BP_(?:Building|JianZhu)_Summon_(Sobek|Scarab|JackalKing|JianChiHu|JinGangYuan|JuFengJiu|MengMaXiang|MoGuiWa)_C$", c)
    if m:
        return "summon", m.group(1)
    if "ShuaGuaiQi" in c:
        return "spawn", None
    return None


# inimigo nomeado que é chefe (mesma regra do site: map-game.js BOSS_RE)
BOSS_NAME_RE = re.compile(r"(^|[^a-zà-ú])(rei|l[ií]der|chefe|king|leader|boss|chief)([^a-zà-ú]|$)", re.I)

MAP_ICON_DIR = os.path.join(os.path.dirname(IMG_DIR), "map", "icons")
MAP_ICON_URL = "assets/img/map/icons/"
J = "/Game/UI/resource/JianYingIcon/"
MAP_CAT_ICONS = {
    "teleport": J + "DiTuIcon/shenmizhimen",
    "tabletAncient": J + "DiTuIcon/gudaishibei2",        # branca, como no mapa do jogo
    "tabletDivine": J + "DiTuIcon/gudaishengshibei2",
    "pyramid": J + "DiTuIcon/shanggujinzita",
    "dungeon": J + "DiTuIcon/dixiacheng",
    "ruin": J + "DiTuIcon/gudaiyizhi_1",
    "maskAltar": J + "DiTuIcon/teshugudaiyizhi_1",
    "maskChest": J + "XiangZiFenLeiicon/kaibaoxiang",
    "chest": J + "shujukuicon/baoxiangdidian",
    "tribe": J + "DiTuIcon/chengzhai_2",
    "ore": J + "DiTuIcon/xiaoxingkuangchauang",
    # bolinhas coloridas do jogo (DiTuBiaoJiIcon/shitubiaoji*): amarela = inimigos, vermelha = chefes de tribo,
    # azul = animais, verde = mecânicos
    "npc": J + "DiTuBiaoJiIcon/shitubiaoji2",
    "boss": J + "DiTuBiaoJiIcon/shitubiaoji2",       # pintada de vermelho (MAP_CAT_TINT)
    "animalDot": J + "DiTuBiaoJiIcon/shitubiaoji",
    "mech": J + "DiTuBiaoJiIcon/shitubiaoji1",
    "creature": J + "DiTuIcon/yeshoujingying",
    "invasion": J + "DiTuBiaoJiIcon/lueduo",        # de onde saem as invasões ("saque")
    "respawn": J + "DiTuIcon/chushengdian",         # ponto de renascimento
}

# Locais oficiais do mapa do jogo ("pontos de exploração", BP_MapQingBaoConfig / BP_DLC_MapInforConfig):
# tipo do jogo -> categoria do site. Os que já vêm dos atores da fase (portal, pirâmide, masmorra)
# só entram quando a fase não tem esses atores.
TSD_CAT = {
    "JINZITA": "pyramid", "CHUANSONGMEN": "teleport", "DIXIACHENG": "dungeon",
    "YEWAI_YIZHI": "ruin", "YEWAI_YIJI": "bigRuin", "YIJI": "holyRuin", "SHEN_MIAO": "mystRuin",
    "DIXIA_YIJI": "ruinDungeon", "UNDERGROUNDPALACE": "palace",
    "BULUO_CHENGZHAI_SMALL": "camp", "BULUO_CHENGZHAI_MIDDLE": "barrack", "BULUO_CHENGZHAI_BIG": "fortress",
    "CHAOXUE": "lair", "BEAST": "beast", "WORLDBOSS": "bossAltar", "ARENA": "arena",
    "KUANGCHUANG_BIG": "mineL", "KUANGCHUANG_MIDDLE": "mineM", "KUANGCHUANG_SMALL": "mineS",
    "SHIPCAMP": "shipCamp", "CAVE": "cave", "MYSTERYISLAND": "island", "FLOATING_ISLAND": "floatIsland",
}
TSD_FROM_ACTORS = {"pyramid", "teleport", "dungeon"}
# inimigos mecânicos usam o ícone do item "Módulo de Armas"
MECH_ICON_ITEM = "assets/img/game/daoju_item_mokuai_bingqi.webp"

# eventos de invasão: pasta do spawner de evento (SGQ_ShiJian/...) -> tipo de esquadrão
INVASION_NAMES = {
    "king": ("Rei Saqueador da Região", "Plunderer King of the Region"),
    "base": ("Ataque de tribo à base", "Tribe base raid"),
}


# variações do mesmo filhote que viram uma entrada só no filtro
BABY_ALIAS = {"BP_DongWu_YangTuo_Special": "BP_DongWu_YangTuo", "BP_Monster_Chicken_F": "BP_Monster_Chicken"}


def _squad_type(scg):
    """Caminho do config de spawn de evento -> tipo de esquadrão de invasão (ou None)."""
    s = str(scg or "")
    if "/AdditionMap01/BluePrints/NPC/Event/" in s:
        # Areias Errantes: mesma ideia, outra pasta (bandidos da areia no lugar dos saqueadores)
        rel = s.split("/NPC/Event/")[1]
        if rel.startswith("SandBandits/Ruins_Outside/"):
            return "dungeon" if "_DXC" in rel else "plunderer"
        if rel.startswith("Animal/Cub/"):
            return "hunting"
        if rel.startswith("Tribe/ResourcePoint/"):
            return "prospecting"
        if rel.startswith("Tribe/Patrol/") and "EnemyMount" not in rel:
            return "transport"
        return None   # montarias (Animal/Mount e Animal/<tribo>) e mercadores (Shop)
    if "/SGQ_ShiJian/" not in s:
        return None
    rel = s.split("/SGQ_ShiJian/")[1]
    if rel.startswith("Animal/Mount/") or "/Shop/" in rel:
        return None   # montarias (vão junto com os saqueadores) e mercadores não são esquadrões
    if rel.startswith("Robber/BP_SGQ_LDZ_Boss"):
        return "king"
    if "_DXC" in rel:
        return "dungeon"
    if rel.startswith("Animal/Cub/"):
        return "hunting"
    if rel.startswith("Tribe/ResourcePoint/"):
        return "advProspecting" if "_Event_Boss_" in rel else "prospecting"
    if rel.startswith("Tribe/Patrol/"):
        return "transport"
    if rel.startswith("Robber/Relic_Outside/"):
        return "plunderer"
    return None
# Blueprint do animal (BP_DongWu_<X>) -> nome do ícone de mapa (dongwutubiao/ditubiaoji_<nome>)
ANIMAL_ICON_ALIAS = {
    "chajiaolin": "lu",            # antilocapra
    "haiguai": "yezixie",          # caranguejo-dos-coqueiros
    "huanglang": "lang",           # lobo da estepe
    "xuelang": "lang",             # lobo ártico
    "laoshu": "bianyishu",         # rato mutante
    "ma": "yema",                  # mustangue
    "mengmaxiang": "mengmaboss",   # mamute
    "mulu": "lu",                  # cariacu
    "xionglu": "lu",               # cariacu
    "tuolu": "lu",                 # alce
    "senran": "jumang",            # sucuri
    "shizi": "xiongshi",           # leão selvagem
    "souquan": "shuquan",          # cachorro do mato
    "xianggui": "xiangui",         # tartaruga
    "xuebao": "baozi",             # leopardo-das-neves
    "yu": "shirenchang",           # piranha
    "zongxiong": "xiong",          # urso pardo
}

# chefe de mundo -> ícone de chefe (dongwutubiao/ditubiaoji_<nome>)
BOSS_ICONS = {"JianChiHu": "renchishouboss", "MoGuiWa": "guiwuwaboss", "JinGangYuan": "jingangyuanboss",
              "JuFengJiu": "jufengjiuboss", "MengMaXiang": "mengmaboss"}
DLC_BOSS_ICONS = {"Sobek": "DaoJu_Item_Head_Sobeck", "JackalKing": "DaoJu_Item_Head_JackalKing",
                  "Scarab": "DaoJu_Item_Head_Scarab"}

# baú da pirâmide -> chefe (assets/data/bosses.json)
JZT_BOSS = {"RenChiShou": "JianChiHu", "GuiWuWa": "MoGuiWa", "JinGangYuan": "JinGangYuan",
            "JuFengJiu": "JuFengJiu", "MengMaXiang": "MengMaXiang"}


MAP_CAT_TINT = {"boss": (226, 48, 36)}   # ícone branco do jogo pintado nessa cor (vermelho)
# cor do ícone de baú por tipo de conteúdo (a regra de qual baú é qual tipo fica em map-game.js chestKind)
CHEST_TINT = {
    "relic": (236, 180, 60),     # Relíquia Antiga: dourado
    "holy": (196, 120, 255),     # relíquias sagradas e Lenda Dourada (máscaras): roxo
    "supply": (96, 214, 120),    # caixas de suprimentos: verde
    "storage": (110, 182, 240),  # caixas de armazenamento: azul
    "junk": (186, 170, 150),     # caixa de tralhas: cinza
    "core": (240, 118, 54),      # núcleo de motor antigravidade (DLC): laranja
}


def map_icon(tex_path, size=64, tint=None):
    """Ícone de mapa do jogo -> assets/img/map/icons/<nome>.webp (com cache).
    tint=(r,g,b): pinta as partes claras do ícone nessa cor (as sombras continuam escuras)."""
    os.makedirs(MAP_ICON_DIR, exist_ok=True)
    name = tex_path.rsplit("/", 1)[-1].lower() + ("_tint%02x%02x%02x" % tint if tint else "")
    out = os.path.join(MAP_ICON_DIR, name + ".webp")
    if not os.path.isfile(out) or FORCE_ICONS:
        pkg = Package.open(tex_path)
        img = extract_texture(pkg) if pkg else None
        if img is None:
            return None
        img = img.convert("RGBA")
        if tint:
            px = img.load()
            top = max(sum(px[xx, yy][:3]) for yy in range(img.height) for xx in range(img.width)
                      if px[xx, yy][3] > 128) or 765
            for yy in range(img.height):
                for xx in range(img.width):
                    r, g, b, a = px[xx, yy]
                    lum = min(1.0, (r + g + b) / top)   # o ponto mais claro vira a cor cheia
                    px[xx, yy] = (int(tint[0] * lum), int(tint[1] * lum), int(tint[2] * lum), a)
        img.thumbnail((size, size), 1)
        img.save(out, "WEBP", quality=90, method=4)
    return MAP_ICON_URL + name + ".webp"


def map_icon_glyph(frame_tex, glyph_tex, name, size=64):
    """Ícone de lugar montado: moldura em losango de um ícone do jogo (o símbolo dela é apagado) com outro
    símbolo do jogo, branco, no centro. Ex.: ponto de renascimento = moldura das ruínas + fogueira."""
    os.makedirs(MAP_ICON_DIR, exist_ok=True)
    out = os.path.join(MAP_ICON_DIR, name + ".webp")
    if not os.path.isfile(out) or FORCE_ICONS:
        fp, gp = Package.open(frame_tex), Package.open(glyph_tex)
        frame = extract_texture(fp) if fp else None
        glyph = extract_texture(gp) if gp else None
        if frame is None or glyph is None:
            return None
        frame, glyph = frame.convert("RGBA"), glyph.convert("RGBA")
        w, h = frame.size
        cx, cy = w / 2.0, h / 2.0
        px = frame.load()
        dark = [px[x, y] for y in range(int(cy * 0.6), int(cy * 1.4)) for x in range(int(cx * 0.6), int(cx * 1.4))
                if px[x, y][3] > 200 and sum(px[x, y][:3]) < 200]
        fill = tuple(int(sum(c[i] for c in dark) / len(dark)) for i in range(3)) + (255,) if dark else (20, 20, 20, 255)
        # miolo do losango (até antes da borda branca): pinta tudo com o fundo escuro, apagando o símbolo antigo
        # borda = anel branco mais externo; o miolo vai até um pouco antes dele
        outer = max((abs(x - cx) + abs(y - cy) for y in range(h) for x in range(w)
                     if px[x, y][3] > 200 and sum(px[x, y][:3]) > 600), default=w * 0.5)
        r = outer - w * 0.035
        for y in range(h):
            for x in range(w):
                if abs(x - cx) + abs(y - cy) < r and px[x, y][3] > 0:
                    px[x, y] = fill
        g = glyph.copy()
        g = g.crop(g.getbbox() or (0, 0, g.width, g.height))   # sem a margem vazia do desenho
        g.thumbnail((int(w * 0.46), int(h * 0.46)), 1)
        gpx = g.load()
        for y in range(g.height):
            for x in range(g.width):
                gpx[x, y] = (255, 255, 255, gpx[x, y][3])   # símbolo inteiro branco (chama e lenha)
        frame.alpha_composite(g, (int(cx - g.width / 2), int(cy - g.height / 2)))
        frame.thumbnail((size, size), 1)
        frame.save(out, "WEBP", quality=90, method=4)
    return MAP_ICON_URL + name + ".webp"


def load_drop_bags():
    """Todas as 'bolsas de drop' (CaiJiBao/*): nome -> [[item, mín, máx, chance %], ...]."""
    bags = {}
    import itertools
    for gp in itertools.chain(game_assets_under("/Game/Blueprints/DataTable/CaiJiBao"),
                              game_assets_under("/Game/AdditionMap01/BluePrints/DataTable/Drop")):
        try:
            rows = Package.open(gp).datatable_rows()
        except Exception:
            continue
        for key, r in rows.items():
            # [item, mín, máx, chance do grupo %, chance do item no grupo %, nº do grupo]
            out = bag_rows(r.get("DaoJuBaoContent"))
            for name in {key, r.get("DaoJuBaoName")}:
                if name and out:
                    bags.setdefault(name, out)
    return bags


def build_foliage_types(loc, all_bags, item_ids):
    """Tipos de vegetação/objeto coletável que viram marcador: depósitos de recurso (pasta Ore, ex.: ferro,
    argila, gelo) e coletáveis especiais (pasta Special com bolsa final TaiZi_*, ex.: Torre Anti-radiação).
    -> {"BP_Collections_Iron_Medium_C": {name_pt, name_en, g, icon, respawn, tool, bagRows}}"""
    conf = (Package.open("/Game/Blueprints/ZhiBei/BP_ZhiBeiConfig").cdo() or {}).get("ZhiBeiPropConfigMap") or {}
    item_icon = {}
    for path, v in conf.items():
        cls = path.split(".")[-1]
        name = loc.get(v.get("FoliageMapName"))
        if not name:
            continue
        tools = list((v.get("GongJuCaiJiDaoJuMap") or {}).items())
        if "/Ore/" in path:
            g = "deposit"
        elif "/Special/" in path:
            g = "collect"
        else:
            continue
        # bolsa "de verdade": a da melhor ferramenta (as primeiras picaretas só tiram pedra comum)
        cands = [(ti, e.get(key)) for ti, (tool, e) in enumerate(tools)
                 for key in ("CaiJiDaoJuBaoName", "FinalCaiJiDaoJuBaoName")
                 if e.get(key) and e.get(key) != "None" and e.get(key) in all_bags]
        special = [c for c in cands if not c[1].startswith("Common")]
        tool_lv, bag = (special or cands or [(0, None)])[0]
        rows = [r for r in all_bags.get(bag, []) if not item_ids or r[0] in item_ids] if bag else []
        t = {"g": g}
        bi(t, "name", name)
        if rows:
            t["bagRows"] = rows
            best = max(rows, key=lambda r: (r[3] * r[4], r[2]))
            t["item"] = best[0]
        if v.get("ZhiBeiEnableRebornAfterCollect") and v.get("ZhiBeiRebornTimeAfterCollect"):
            t["respawn"] = int(v["ZhiBeiRebornTimeAfterCollect"])
        if g == "deposit" and tools:
            m = re.search(r"GaoZi_(\d)", tools[tool_lv][0])
            if m and int(m.group(1)) > 1:
                t["tool"] = int(m.group(1))
        item_icon[cls] = t
    return item_icon


def _foliage_positions(p, e, end):
    """Instâncias de um componente de vegetação (FoliageInstancedStaticMeshComponent):
    depois das propriedades vem PerInstanceSMData = [tamanho 64][quantidade][matriz 4x4 por instância]."""
    blob = p.b[end:end + 32]
    i = blob.find(struct.pack("<i", 64))
    if i < 0:
        return []
    n = struct.unpack_from("<i", blob, i + 4)[0]
    base = end + i + 8
    if n <= 0 or base + n * 64 > e["offset"] + e["size"] + 64:
        return []
    out = []
    for k in range(n):
        x, y, z = struct.unpack_from("<3f", p.b, base + k * 64 + 48)
        out.append((x, y, z))
    return out


DUNGEON_ENTRANCES = ["/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_DiXiaCheng_001",
                     "/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_DiXiaCheng_002",
                     "/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_DiXiaCheng_Lv40",
                     "/Game/Blueprints/JianZhu/GameFunction/BP_JianZhu_DiXiaCheng_Lv50",
                     "/Game/AdditionMap01/BluePrints/Dungeon/Portal/BP_Portal_DungeonEgypt_Lv40",
                     "/Game/AdditionMap01/BluePrints/Dungeon/Portal/BP_Portal_DungeonEgypt_Lv50",
                     "/Game/AdditionMap01/BluePrints/Dungeon/Portal/BP_Portal_DungeonEgypt_Lv60"]


def build_dungeons(loc, use_bag, bag_of):
    """Masmorras (entra-se por um portal e cai numa masmorra montada ao acaso com salas prontas).
    Para cada entrada: nome, descrição, nível, tempo, jogadores, custo de entrada, inimigos (das salas,
    no nível da masmorra) e baús. -> {classe da entrada: {...}}"""
    confs = {}
    for wd in ("BP_Level01Main_Data", "BP_DLCLevel01Main_Data"):
        for c in (Package.open("/Game/Blueprints/StreamLevel/WorldSettingData/" + wd).cdo() or {}).get("DiXiaChengConfigList") or []:
            confs[c.get("Name")] = c
    names = {}

    def name_of(cls):
        if cls not in names:
            pkg = Package.open(cls.split(".")[0])
            cdo = (pkg.cdo() if pkg else None) or {}
            names[cls] = loc.get(cdo.get("JianZhuDisplayName") or cdo.get("Name") or cdo.get("MoRenMingZi"))
        return names[cls]

    room_cache = {}

    def room_spawners(db):
        """SCGClass de todos os spawners das salas do banco de salas."""
        if db not in room_cache:
            found = set()
            p = Package.open(db)
            exp = [e for e in (p.exports if p else []) if (p.export_class(e) or "").endswith("ModuleDatabase")]
            mods = p.read_export_props(exp[0])[0].get("Modules") or [] if exp else []
            for m in mods:
                lp = Package.open(str(m.get("Level") or "").split(".")[0])
                for e in (lp.exports if lp else []):
                    if "ShuaGuaiQi" not in (lp.export_class(e) or ""):
                        continue
                    try:
                        pr, _ = lp.read_export_props(e)
                    except Exception:
                        continue
                    if pr.get("SCGClass"):
                        found.add(str(pr["SCGClass"]))
            room_cache[db] = found
        return room_cache[db]

    out = {}
    for ent in DUNGEON_ENTRANCES:
        cdo = (Package.open(ent) or None)
        cdo = cdo.cdo() if cdo else None
        if not cdo:
            continue
        gfm = cdo.get("GameFunctionExecutionMap") or {}
        if not gfm:
            continue
        formula_path, ex = next(iter(gfm.items()))
        key = ((ex or {}).get("ExecutionList") or [{}])[0].get("ExecutePara1")
        conf = confs.get(key)
        if not conf:
            continue
        fp = Package.open(formula_path.split(".")[0])
        formula = (fp.cdo() if fp else None) or {}
        cost = [{"id": asset_name(d["DemandDaoJu"][0]), "n": d.get("DemandCount") or 1}
                for d in formula.get("DemandDaoJu") or [] if d.get("DemandDaoJu")]
        scgs = room_spawners(str(conf.get("SGFModuleDataBase") or "").split(".")[0])
        lv_m = re.search(r"Lv(\d{2})$", key or "")
        # sem "LvXX" no código (ex.: "Demo002" = masmorra grande): usa o maior nível das salas
        levels = sorted({int(x) for s in scgs for x in re.findall(r"_(?:Lv)?(\d{2})(?:_C|\.)", s)})
        lv = int(lv_m.group(1)) if lv_m else (max(levels) if levels else 0)
        enemies = []
        for s in sorted(scgs):
            if not re.search(r"(?:_Lv|_)%d(?:_C|\.|/)" % lv, s):
                continue
            role = "boss" if "Boss" in s else "elite" if ("JingYing" in s or "Elite" in s) else "guard"
            sp = Package.open(s.split(".")[0])
            scdo = (sp.cdo() if sp else None) or {}
            for info in scdo.get("SCGInfoList") or []:
                for g in info.get("SGBList") or []:
                    gcls = g.get("GuaiWuClass")
                    if not gcls:
                        continue
                    nm = name_of(gcls)
                    bag = g.get("DiaoLuoBaoID")
                    e = {"role": role, "lo": g.get("SCGZuiXiaoDengJi") or 0, "hi": g.get("SCGZuiDaDengJi") or 0}
                    if nm:
                        bi(e, "name", nm)
                    b = use_bag(bag if bag and bag != "None" else None)
                    if b:
                        e["bag"] = b
                    if nm and not any(x.get("name_pt") == e.get("name_pt") and x["role"] == role for x in enemies):
                        enemies.append(e)
        # baús da masmorra: pasta do nível (Floresta: BaoXiang/DiXiaCheng[Lv40|Lv50]; DLC: GameBox/Dungeons/Dungeon_LvXX)
        if "/AdditionMap01/" in ent:
            chest_dir = "/Game/AdditionMap01/BluePrints/GameBox/Dungeons/Dungeon_Lv%d" % lv
        else:
            chest_dir = "/Game/Blueprints/BaoXiang/DiXiaCheng/DiXiaChengLv%d" % lv
            if not list(game_assets_under(chest_dir)):
                chest_dir = "/Game/Blueprints/BaoXiang/DiXiaCheng"
        chests = []
        for gp in sorted(game_assets_under(chest_dir)):
            if os.path.dirname(gp) != chest_dir:
                continue
            b = bag_of(gp)
            nm = name_of(gp)
            if b:
                c = {"bag": b}
                if nm:
                    bi(c, "name", nm)
                chests.append(c)
        d = {"key": key, "level": lv, "time": int(conf.get("MaxTimeSeconds") or 0),
             "players": conf.get("MaxPlayers") or 0, "cost": cost,
             "mask": formula.get("DemandMianJuNengLiang") or 0, "awareness": formula.get("PeiFangDengJi") or 0,
             "enemies": enemies, "chests": chests}
        bi(d, "title", loc.get(conf.get("Title")))
        bi(d, "desc", loc.get(conf.get("Desc")))
        out[ent.rsplit("/", 1)[-1]] = d
    STATS["masmorras"] += len(out)
    return out


MAP_TAG_WIDGETS = {"main": "/Game/Blueprints/UI/Map/WBP_MapTag_LevelMain01",
                   "dlc": "/Game/Blueprints/UI/Map/WBP_MapTag_LevelMain02"}


def map_regions(loc, mid):
    """Nomes das regiões escritos sobre o mapa do jogo (ex.: "Olho das Areias / (Cânion) / Nível: 41–50").
    Vêm do widget WBP_MapTag_LevelMain0X: cada região é uma VerticalBox com 3 textos, posicionada num
    canvas de 4096 px sobre o desenho do mapa. -> [{x, y (0..1024), name, type, lv}]"""
    p = Package.open(MAP_TAG_WIDGETS.get(mid, ""))
    if not p:
        return []
    slot_content, texts, boxes, canvas = {}, {}, {}, []
    for e in p.exports:
        c = p.export_class(e)
        if c not in ("TextBlock", "CanvasPanelSlot", "VerticalBoxSlot", "VerticalBox"):
            continue
        v = p.read_export_props(e)[0]
        if c == "VerticalBoxSlot":
            slot_content[str(v.get("Parent")) + ":" + e["name"]] = str(v.get("Content"))
        elif c == "TextBlock":
            texts[e["name"]] = v.get("Text")
        elif c == "VerticalBox":
            boxes[e["name"]] = v.get("Slots") or []
        else:
            canvas.append(v)
    out, seen = [], set()
    for v in canvas:
        box = str(v.get("Content")).rsplit(":", 1)[-1]
        off = (v.get("LayoutData") or {}).get("Offsets") or {}
        key = (round(off.get("Left", 0)), round(off.get("Top", 0)))
        if not box.startswith("VerticalBox") or key in seen:
            continue
        seen.add(key)
        r = {"x": round(key[0] / 4, 1), "y": round(key[1] / 4, 1)}
        for sp in boxes.get(box, []):
            t = loc.get(texts.get(slot_content.get(str(sp), "").rsplit(":", 1)[-1]))
            if not t:
                continue
            if re.match(r"(N[ií]vel|Level)", t["en"]) or re.match(r"N[ií]vel", t["pt"]):
                r["lv"] = re.sub(r"^[^\d]*", "", t["en"]).replace("-", "–")
            elif t["en"].startswith("("):
                r["type"] = {k: s.strip("() ") for k, s in t.items()}
            else:
                r["name"] = t
        if r.get("name"):
            out.append(r)
    STATS["regiões no mapa"] += len(out)
    return out


CREATURE_VARIANT_RE = re.compile(r"_(JY|JingYing|Elite|Boss)$")

# atributos base mostrados (chaves iguais às de meta.json "attrs"); a tabela tem mais linhas (partes do corpo etc.)
CREATURE_STAT_KEYS = ["MaxHealth", "Attack", "Defense", "MaxTiLi", "TiLiRecover", "HealthRecover", "MaxFuZhong",
                      "SpeedRate", "AttackSpeed", "Crit", "CritDef", "MaxTenacity", "MaxHuXi", "MaxFood", "MaxWater",
                      "HanKang", "YanKang", "DuKang", "FuKang"]


_ATTR_TABLES = None


def add_boss_creatures(creatures, bosses, leaders, markers=None):
    """Página Criaturas: junta os chefes (pirâmides e mundo), líderes de tribo e saqueadores e chefes de ruína
    (mecânicos) às criaturas da enciclopédia. Campos extras: rank ("boss" | "leader" | "ruin"), group (aba da
    página Chefes), kill (itens que pode soltar ao morrer, incluindo armadura e armas), maps e at ([x, y] de um
    ponto no mapa, para o "Ver no mapa" abrir a janela dele: #mapa?map=..&at=x,y)."""
    boss_at = {}   # chefe -> ponto do altar de invocação (DLC) ou da pirâmide dele (Floresta)
    for mk, mp in ((markers or {}).get("maps") or {}).items():
        for p in mp.get("points") or []:
            bid = p[4] if p[0] == "summon" else p[5] if p[0] == "pyramid" and len(p) > 5 else None
            if bid and (bid not in boss_at or p[0] == "summon"):
                boss_at[bid] = (mk, [p[1], p[2]])
    def stats_ok(st, key):
        # classes sem tabela própria herdam a do modelo base de chefe (Dente-de-sabre): não é a delas
        return st if st and (st.get("table") != "DT_Attr_JianChiHu" or "jianchihu" in key.lower()) else None

    for b in bosses:
        kill = []
        for tr in b.get("tiers") or []:
            for d in (tr.get("drops") or []) + (tr.get("final") or []) + (tr.get("parts") or []):
                if d["id"] not in kill:
                    kill.append(d["id"])
        c = {"id": "boss:" + b["id"], "name_pt": b["name_pt"], "name_en": b["name_en"], "rank": "boss",
             "group": "pyramid", "maps": ["dlc" if b.get("dlc") else "main"], "variant": "normal"}
        if b.get("dlc"):
            c["dlc"] = True
        if b["id"] in boss_at:
            c["maps"], c["at"] = [boss_at[b["id"]][0]], boss_at[b["id"]][1]
        if b.get("photo"):
            c["photo"] = b["photo"]
        st = stats_ok(b.get("stats"), b["id"])
        if st:
            c["stats"] = st
        if kill:
            c["kill"] = kill
        creatures.append(c)
    RANK = {"world": "boss", "tribe": "leader", "plunderer": "leader", "ruin": "ruin"}
    # animal da enciclopédia que também apareça como "chefe" (ex.: Rei Rato Mutante, um rato elite): fica só
    # como criatura, sem card de chefe duplicado
    animal_names = {(c.get("name_en") or "").strip().lower() for c in creatures if not c.get("rank")}
    for e in leaders:
        if (e.get("name_en") or "").strip().lower() in animal_names:
            continue
        kill = []
        for v in e.get("variants") or []:
            ids = [d["id"] for d in (v.get("drops") or []) + (v.get("harvest") or []) + (v.get("final") or [])]
            ids += [i for s in (v.get("gear") or {}).get("armor") or [] for i in s["ids"]]
            ids += (v.get("gear") or {}).get("weapons") or []
            kill += [i for i in ids if i not in kill]
        c = {"id": "leader:" + e["id"], "name_pt": e["name_pt"], "name_en": e["name_en"], "rank": RANK.get(e["group"], "leader"),
             "group": "pyramid" if e["group"] == "world" else e["group"], "maps": [e["map"]], "variant": "normal",
             "lv": [min(v["lo"] for v in e["variants"]), max(v["hi"] for v in e["variants"])]}
        spot = next((v["spots"][0] for v in e["variants"] if v.get("spots")), None)
        if spot:
            c["at"] = spot
        if e.get("dlc"):
            c["dlc"] = True
        if e.get("photo"):
            c["photo"] = e["photo"]
        st = stats_ok(e.get("stats"), e["id"])
        if st:
            c["stats"] = st
        if kill:
            c["kill"] = kill
        creatures.append(c)


def creature_stats(cls_path):
    """Atributos base (nível 1) da criatura: tabela DT_Attr_<x> importada pelo Blueprint dela (ou por um pai),
    e o nº de espaços do inventário (BaoGuoRongLiang). Formato descrito em build_creature_db."""
    path, seen, table, slots = str(cls_path or "").split(".")[0], set(), None, None
    while path.startswith("/Game/") and path not in seen and not (table and slots is not None):
        seen.add(path)
        pk = Package.open(path)
        if not pk:
            break
        if not table:
            table = next((str(i.get("name")) for i in pk.imports if str(i.get("class")) == "Package"
                          and "/DT_Attr_" in str(i.get("name"))), None)
        if slots is None:
            slots = (pk.cdo() or {}).get("BaoGuoRongLiang")
        sup = next((pk.ref_path(e["super_index"]) for e in pk.exports
                    if pk.export_class(e) == "BlueprintGeneratedClass" and e.get("super_index")), None)
        path = (sup or "").split(".")[0]
    out = {}
    confirmed = bool(table)
    if not table:
        # o Blueprint não importa a tabela: tenta DT_Attr_<nome> pelo nome do Blueprint (não confirmado)
        global _ATTR_TABLES
        if _ATTR_TABLES is None:
            _ATTR_TABLES = {p.rsplit("/", 1)[-1].lower(): p for root in ("/Game/Blueprints/DataTable/AttrMetaData",
                            "/Game/AdditionMap01/BluePrints/DataTable/AttrMetaData") for p in game_assets_under(root)}
        name = re.sub(r"^BP_(DongWu|Monster)_", "", asset_name(cls_path).split(".")[0])
        table = _ATTR_TABLES.get(("DT_Attr_" + name).lower())
    if table:
        tp = Package.open(table)
        rows = (tp.datatable_rows() if tp else None) or {}
        base = {k.split(".")[-1]: v.get("BaseValue") for k, v in rows.items()}
        vals = {k: rnd(base[k]) for k in CREATURE_STAT_KEYS if base.get(k) is not None}
        if vals:
            out = {"table": table.rsplit("/", 1)[-1], "base": vals, "confirmed": confirmed}
    if slots:
        out["slots"] = int(slots)
    return out or None


def build_creature_db(creatures, markers):
    """Banco único de criaturas (assets/data/creatures.json), lido pelo mapa, pela página Criaturas,
    pela página Itens (via sources.json) e pela página Animais domesticáveis. Campos que este passo põe:
      variant: "normal" | "elite" | "boss"
      base:    id da versão comum (nas elites/chefes);  elites: [ids das versões elite/chefe] (na comum)
      maps:    ["main", "dlc"] onde a criatura nasce no Mapa interativo
      loot: {
        confirmed: true  -> tabela ligada à criatura pelo próprio jogo (BP_ShengWuCollectData)
                   false -> achada só pelo nome do Blueprint (mostrar como "não confirmado")
        harvest: {bag, rows}  ao esquartejar o corpo
        extra:   {bag, rows}  outros recursos, ao terminar de esquartejar (bolsa "final")
        young:   {bag, rows}  filhote em crescimento, quando a bolsa é outra
        toolMult: {"Stone": 1.0, "Bronze": 1.2, ...}  quantidade × conforme a faca de esquartejar
      }
      rows = [item, mín, máx, chance do grupo %, chance no grupo %, grupo, condição]
      stats: {table: "DT_Attr_<x>", base: {MaxHealth, Attack, Defense, MaxTiLi, MaxFuZhong, SpeedRate, ...}, slots: n}
        valores BaseValue do jogo no nível 1 (chaves = meta.json "attrs"); Crit/CritDef são frações (0,05 = 5%),
        SpeedRate/AttackSpeed são multiplicadores (1 = normal). A cada nível a criatura ganha pontos de atributo
        (DT_Level_Monster: 1 ponto automático por nível), então no jogo os valores sobem com o nível.
        slots = espaços do inventário (BaoGuoRongLiang).
        confirmed: true = tabela importada pelo Blueprint; false = achada pelo nome (mostrar "não confirmado")."""
    ids = {c["id"] for c in creatures}
    loot = markers.pop("creatureLoot", {})
    for c in creatures:
        cid = c["id"]
        mm = CREATURE_VARIANT_RE.search(cid)
        # "_Boss" de animal (ex.: Rei Rato Mutante) é só uma versão elite mais forte, não um chefe
        c["variant"] = "elite" if mm else "normal"
        if mm and CREATURE_VARIANT_RE.sub("", cid) in ids:
            c["base"] = CREATURE_VARIANT_RE.sub("", cid)
        if cid in loot:
            c["loot"] = loot[cid]
        on = [mid for mid, m in markers["maps"].items()
              if any(p[0] == "creature" and p[4] == cid for p in m["points"])]
        if on:
            c["maps"] = on
        c.pop("dropIds", None)
    by_id = {c["id"]: c for c in creatures}
    for c in creatures:
        if c.get("base"):
            by_id[c["base"]].setdefault("elites", []).append(c["id"])
    STATS["criatura sem tabela de coleta"] += sum(1 for c in creatures if not c.get("loot"))


def build_map_markers(loc, creature_ids, items=None):
    """Marcadores do mapa interativo, lidos das fases do jogo (.umap): portais, estelas, pirâmides,
    ruínas, baús, minérios, tribos e onde nasce cada criatura. Coordenadas em 0..1024 sobre o desenho."""
    out = {"maps": {}, "icons": {}, "creatureIcons": {}, "bossIcons": {}, "bags": {}, "babyNames": {}}
    for cat, tex in MAP_CAT_ICONS.items():
        url = map_icon(tex, tint=MAP_CAT_TINT.get(cat))
        if url:
            out["icons"][cat] = url
    # ponto de renascimento: fogueira oficial do jogo (ShaiXuan/gouhuo_1, o mesmo desenho de
    # DiTuBiaoJiIcon/ditubiaojiicon_11 sem brilho) na moldura em losango dos outros lugares (ruínas)
    url = map_icon_glyph(J + "DiTuIcon/gudaiyizhi_1", J + "ShaiXuan/gouhuo_1", "respawn_fogueira")
    if url:
        out["icons"]["respawn"] = url
    # baús: o mesmo ícone pintado numa cor por tipo de conteúdo (map-game.js chestKind)
    out["icons"]["chestTint"] = {}
    for kind, rgb in CHEST_TINT.items():
        url = map_icon(MAP_CAT_ICONS["chest"], tint=rgb)
        if url:
            out["icons"]["chestTint"][kind] = url
    if os.path.isfile(os.path.join(IMG_DIR, "daoju_item_firefly.webp")):
        out["icons"]["firefly"] = IMG_URL + "daoju_item_firefly.webp"   # item "Vaga-lume"
    # nomes dos tipos de invasão (os mesmos da página Eventos de invasão)
    import build_guides
    out["invasionTypes"] = {sid: {"name_pt": pt, "name_en": en, "sched": True} for sid, pt, en, _t in build_guides.SQUADS_BRT}
    for sid, (pt, en) in INVASION_NAMES.items():
        out["invasionTypes"][sid] = {"name_pt": pt, "name_en": en}
    # ícone de cada animal: dongwutubiao/ditubiaoji_<nome>. O nome do ícone nem sempre é o do Blueprint
    # (ex.: XueBao/leopardo-das-neves usa "baozi", Yu/piranha usa "shirenchang"): ANIMAL_ICON_ALIAS corrige.
    animal_dir = J + "dongwutubiao/"
    for cid in creature_ids:
        key = re.sub(r"^BP_DongWu_", "", cid).split("_")[0].lower()
        for cand in (ANIMAL_ICON_ALIAS.get(key), key):
            if cand and Package.open(animal_dir + "ditubiaoji_" + cand):
                url = map_icon(animal_dir + "ditubiaoji_" + cand)
                if url:
                    out["creatureIcons"][cid] = url
                    break
        else:
            STATS["animal sem ícone no mapa"] += 1
    # ícone de cada chefe de mundo (silhuetas de chefe do próprio jogo)
    for boss_id, icon in BOSS_ICONS.items():
        url = map_icon(J + "dongwutubiao/ditubiaoji_" + icon)
        if url:
            out["bossIcons"][boss_id] = url
    # chefes da DLC não têm silhueta de mapa: usa o ícone da cabeça do chefe (troféu do jogo)
    for boss_id, icon in DLC_BOSS_ICONS.items():
        url = map_icon("/Game/UI/Icon/jianzhuicon/" + icon, size=96)
        if url:
            out["bossIcons"][boss_id] = url
    all_bags = load_drop_bags()
    item_ids = set(items or [])
    chest_bag = {}

    def use_bag(name):
        """Registra a bolsa de drop (se existir) e devolve o nome, ou None."""
        if not name:
            return None
        if name not in out["bags"]:
            rows = [r for r in all_bags.get(name, []) if not item_ids or r[0] in item_ids]
            if not rows:
                return None
            out["bags"][name] = rows
        return name

    def bag_of(cls_path):
        if cls_path not in chest_bag:
            pkg = Package.open(cls_path)
            cdo = (pkg.cdo() if pkg else None) or {}
            name = cdo.get("BaoXiangDiaoLuoID")
            rows = [r for r in all_bags.get(name, []) if not item_ids or r[0] in item_ids] if name else []
            if rows:
                out["bags"][name] = rows
            elif "_Mask_" in cls_path:
                # baú de máscara (Relíquia Sagrada): não tem bolsa; a máscara que ele dá é importada pelo
                # próprio Blueprint (ou pela versão "_SYW" dele). Vira uma bolsa com 100% daquele item.
                got = []
                for cand in (cls_path, cls_path + "_SYW"):
                    pk2 = Package.open(cand)
                    for imp in (pk2.imports if pk2 else []):
                        nm = str(imp.get("name") or "")
                        nm = nm[:-2] if nm.endswith("_C") else nm
                        if re.match(r"DaoJu_(Item_)?Mask", nm) and nm in item_ids and nm not in got:
                            got.append(nm)
                    if got:
                        break
                if got:
                    name = "mask:" + cls_path.rsplit("/", 1)[-1].split(".")[0]
                    rows = [[i, 1, 1, 100, 100.0, k] for k, i in enumerate(got)]
                    out["bags"][name] = rows
                    STATS["baú de máscara com máscara"] += 1
            chest_bag[cls_path] = name if rows else None
        return chest_bag[cls_path]

    # o que se coleta de cada animal: tabela do próprio jogo (BP_ShengWuCollectData) com a bolsa normal
    # e a bolsa extra/final; se o animal não estiver nela, tenta pelo nome do Blueprint (DT_ShengWuCaiJiBao)
    out["creatureBags"] = {}
    # banco de criaturas (vai para creatures.json["loot"]; formato descrito em build_creature_db)
    out["creatureLoot"] = {}
    collect_conf = (Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ShengWuCollectData").cdo() or {}).get("ShengWuPropConfigSoftMap") or {}

    def bag_rows(name):
        if not name or name == "None":
            return []
        return [list(r) for r in all_bags.get(name, []) if not item_ids or r[0] in item_ids]

    # o jogo nem sempre escreve o id igual à enciclopédia (ex.: BP_DongWu_EYu x BP_DongWu_Eyu): compara sem maiúsculas
    canon = {c.lower(): c for c in creature_ids}
    conf_lower = {asset_name(p).lower(): (asset_name(p), c) for p, c in collect_conf.items()}
    for path, conf in collect_conf.items():
        cid = canon.get(asset_name(path).lower(), asset_name(path))
        m = (conf or {}).get("ShengWuCollectDaoJuMap") or {}
        first = next(iter(m.values()), None) if m else None
        if cid not in creature_ids or not first:
            continue
        rows = bag_rows(first.get("CaiJiDaoJuBaoName"))
        fin = bag_rows(first.get("CaiJiFinalDaoJuBaoName"))
        young = bag_rows(first.get("FaYuingCaiJiDaoJuBaoName"))
        loot = {"confirmed": True}
        if rows:
            loot["harvest"] = {"bag": first.get("CaiJiDaoJuBaoName"), "rows": rows}
        if fin:
            loot["extra"] = {"bag": first.get("CaiJiFinalDaoJuBaoName"), "rows": fin}
        if young and first.get("FaYuingCaiJiDaoJuBaoName") != first.get("CaiJiDaoJuBaoName"):
            loot["young"] = {"bag": first.get("FaYuingCaiJiDaoJuBaoName"), "rows": young}
        # multiplicador de quantidade por faca de esquartejar (BP_DamageType_ChopKnife_<material>)
        mult = {}
        for tool, e in m.items():
            mm = re.search(r"ChopKnife_([A-Za-z]+)", tool or "")
            if mm and (e or {}).get("DamageGiveDaoJuMultiPower") is not None:
                mult[mm.group(1)] = round(float(e["DamageGiveDaoJuMultiPower"]), 2)
        if mult:
            loot["toolMult"] = mult
        rows = rows + [r[:5] + [r[5] + 1000] + r[6:] for r in fin]
        if rows:
            out["bags"]["cr:" + cid] = rows
            out["creatureBags"][cid] = "cr:" + cid
            out["creatureLoot"][cid] = loot
    lower_bags = {k.lower(): k for k in all_bags}
    for cid in creature_ids:
        if cid in out["creatureBags"]:
            continue
        base = re.sub(r"^BP_(DongWu|Monster)_", "", cid)
        for cand in (base, re.sub(r"_(JY|JingYing|Elite)$", "", base)):
            key = lower_bags.get(cand.lower())
            name = use_bag(key) if key else None
            if name:
                out["creatureBags"][cid] = name
                # bolsa achada só pelo nome do Blueprint: dado do jogo, mas a ligação não é confirmada
                out["creatureLoot"][cid] = {"confirmed": False, "harvest": {"bag": name, "rows": [list(r) for r in out["bags"][name]]}}
                break
        else:
            STATS["animal sem drop"] += 1

    harvest_cache = {}

    def animal_harvest(cls_path):
        """Animal que não está na enciclopédia (ex.: Jacaré (Ruínas) = BP_DongWu_EYu_YiJi): usa a tabela de
        esquartejar dele ou, se não tiver, a do Blueprint pai (confirmado pelas importações do próprio Blueprint).
        Devolve "cr:<criatura>" (tabela do banco de criaturas) ou "hv:<Blueprint>" (tabela própria), ou None."""
        name = asset_name(cls_path)
        if name in harvest_cache:
            return harvest_cache[name]
        res = None
        if re.match(r"BP_(DongWu|Monster)_", name):
            pk = Package.open(cls_path.split(".")[0])
            imps = {str(i.get("name") or "").lower() for i in (pk.imports if pk else [])}
            parts = name.split("_")
            for n in range(len(parts), 2, -1):
                cand = "_".join(parts[:n])
                if n < len(parts) and cand.lower() + "_c" not in imps:
                    continue   # só vale o pai de verdade (importado pelo Blueprint)
                cid = canon.get(cand.lower())
                if cid and out["creatureBags"].get(cid, "").startswith("cr:"):
                    res = "cr:" + cid
                    break
                hit = conf_lower.get(cand.lower())
                mm = ((hit[1] or {}).get("ShengWuCollectDaoJuMap") or {}) if hit else {}
                first = next(iter(mm.values()), None) if mm else None
                if first:
                    rows = bag_rows(first.get("CaiJiDaoJuBaoName"))
                    fin = bag_rows(first.get("CaiJiFinalDaoJuBaoName"))
                    rows = rows + [r[:5] + [r[5] + 1000] + r[6:] for r in fin]
                    if rows:
                        res = "hv:" + hit[0]
                        out["bags"][res] = rows
                        break
        if res:
            STATS["animal fora da enciclopédia com tabela"] += 1
        harvest_cache[name] = res
        return res

    # equipamento dos NPCs humanos (armaduras, anel, colar e armas que eles vestem e soltam ao morrer):
    # o spawner aponta para as tabelas DiWeiAndZhuangBeiDataTable / DiWeiAndWuQiDataTable (peças por posição
    # e profissão) e a classe do NPC diz a chance de cada parte cair (CharMorenDaoJuInitData).
    # out["npcEquip"] = [{slots: {"1": [itens]...}, drop: {"1": %...}, weapons: [itens], weaponDrop: %}]
    out["npcEquip"] = []
    equip_index, equip_cache, dt_cache = {}, {}, {}
    SLOT_OF = {"YIFU": "1", "TUI": "2", "SHOU": "3", "JIAO": "4"}

    def dt_items(path):
        """Tabela de equipamento/armas -> {parte: [itens]} (parte "w" quando a linha não diz a parte)."""
        path = str(path or "").split(".")[0]
        if not path or path == "None":
            return {}
        if path not in dt_cache:
            res = {}
            pk = Package.open(path)
            rows = pk.datatable_rows() if pk else {}

            def walk(v, slot=None):
                if isinstance(v, dict):
                    for k, x in v.items():
                        walk(x, k if re.fullmatch(r"\d", str(k)) else slot)
                elif isinstance(v, list):
                    for x in v:
                        walk(x, slot)
                elif isinstance(v, str) and v.startswith("/Game/"):
                    iid = asset_name(v)
                    iid = iid[:-2] if iid.endswith("_C") else iid
                    if iid in item_ids:
                        lst = res.setdefault(slot or "w", [])
                        if iid not in lst:
                            lst.append(iid)
            walk(rows or {})
            dt_cache[path] = res
        return dt_cache[path]

    def npc_equip(scg, cls_path):
        """Índice em out["npcEquip"] do equipamento deste NPC (ou None)."""
        key = (str(scg), str(cls_path))
        if key in equip_cache:
            return equip_cache[key]
        res = None
        spk = Package.open(str(scg).split(".")[0]) if scg else None
        scdo = (spk.cdo() if spk else None) or {}
        armor = dt_items(scdo.get("DiWeiAndZhuangBeiDataTable"))
        weapons = [i for lst in dt_items(scdo.get("DiWeiAndWuQiDataTable")).values() for i in lst]
        if armor or weapons:
            # cada campo de CharMorenDaoJuInitData vale da classe mais próxima que o define (sobe pelos pais)
            init, path, seen = {}, str(cls_path).split(".")[0], set()
            while path.startswith("/Game/") and path not in seen:
                seen.add(path)
                cpk = Package.open(path)
                if not cpk:
                    break
                for k, v in ((((cpk.cdo() or {}).get("CharMorenDaoJuInitData")) or {}).items()):
                    init.setdefault(k, v)
                sup = next((cpk.ref_path(e["super_index"]) for e in cpk.exports
                            if cpk.export_class(e) == "BlueprintGeneratedClass" and e.get("super_index")), None)
                path = (sup or "").split(".")[0]
            drop = {}
            for k, v in (init.get("DaoJuPartDiaoLuoData") or {}).items():
                s = str(k).split("ZHUANGBEI_SLOT_INDEX_")[-1]
                drop[SLOT_OF.get(s, s)] = round(float(v) * 100, 1)
            eq = {"slots": armor, "drop": drop}
            if weapons:
                eq["weapons"] = list(dict.fromkeys(weapons))
                if init.get("KJLWuQiDiaoLuoProbalility") is not None:
                    eq["weaponDrop"] = round(float(init["KJLWuQiDiaoLuoProbalility"]) * 100, 1)
            sig = json.dumps(eq, sort_keys=True)
            if sig not in equip_index:
                equip_index[sig] = len(out["npcEquip"])
                out["npcEquip"].append(eq)
            res = equip_index[sig]
            STATS["NPC com equipamento"] += 1
        equip_cache[key] = res
        return res

    # coletáveis e depósitos de recurso (vegetação "BP_Collections_*", BP_ZhiBeiConfig)
    foliage = build_foliage_types(loc, all_bags, item_ids)
    out["foliage"] = {k: {kk: vv for kk, vv in v.items() if kk != "bagRows"} for k, v in foliage.items()}
    for k, v in foliage.items():
        if v.get("bagRows"):
            out["bags"]["fol:" + k] = v["bagRows"]
            out["foliage"][k]["bag"] = "fol:" + k

    out["dungeons"] = build_dungeons(loc, use_bag, bag_of)

    for mid, (main_path, folder) in MAP_LEVELS.items():
        ws = _level_settings(main_path)
        qx, qy = ws.get("MapQiDian") or [-408028.0, -408144.0]
        size = (ws.get("MapSize") or [816100.0])[0]
        labels, label_idx = [], {}

        def label(val):
            if not val:
                return -1
            key = json.dumps(val, ensure_ascii=False, sort_keys=True)
            if key not in label_idx:
                label_idx[key] = len(labels)
                labels.append(val)
            return label_idx[key]

        name_cache = {}

        def actor_name(cls_path):
            if cls_path not in name_cache:
                pkg = Package.open(cls_path)
                cdo = (pkg.cdo() if pkg else None) or {}
                name_cache[cls_path] = loc.get(cdo.get("JianZhuDisplayName") or cdo.get("Name") or cdo.get("MoRenMingZi"))
            return name_cache[cls_path]

        spawn_cache = {}

        def spawn_info(scg):
            """Config de spawn -> lista de (criatura, nível mín, nível máx)."""
            if scg not in spawn_cache:
                res = []
                pkg = Package.open(scg) if scg else None
                cdo = (pkg.cdo() if pkg else None) or {}
                for info in cdo.get("SCGInfoList") or []:
                    for g in info.get("SGBList") or []:
                        cls = g.get("GuaiWuClass")
                        if cls:
                            bag = g.get("DiaoLuoBaoID")
                            # ShiFouFaYu ("cresce"): filhote que nasce pequeno (ou ovo)
                            baby = str(g.get("ShiFouFaYu")) == "True" or asset_name(cls).endswith("_Egg")
                            res.append((cls, g.get("SCGZuiXiaoDengJi") or 0, g.get("SCGZuiDaDengJi") or 0,
                                        bag if bag and bag != "None" else None, baby))
                spawn_cache[scg] = res
            return spawn_cache[scg]

        points = []
        squad_seen = {}
        scg_default = {}
        base = os.path.join(CONTENT_DIR, *folder.split("/"))
        files = []
        for root, _d, fs in os.walk(base):
            files += [os.path.join(root, f) for f in fs if f.endswith(".umap")]
        for f in sorted(files):
            # o mapa base guarda os atores nas subfases; o da DLC guarda muitos na própria fase principal
            if any(x in f for x in ("Weather", "_Far.umap", "StartScene")) or (mid == "main" and "_Main.umap" in f):
                continue
            gp = "/Game/" + os.path.relpath(f[:-5], CONTENT_DIR).replace(os.sep, "/")
            try:
                p = Package.open(gp)
            except Exception:
                continue
            if not p:
                continue
            paths = None
            for e in p.exports:
                c = p.export_class(e) or ""
                if c in foliage:
                    # depósitos de recurso e coletáveis: instâncias de vegetação
                    try:
                        fprops, fend = p.read_export_props(e)
                        rl = fprops.get("RelativeLocation") or [0.0, 0.0, 0.0]
                        for fx, fy, fz in _foliage_positions(p, e, fend):
                            x = round((fx + rl[0] - qx) / size * 1024, 1)
                            y = round((fy + rl[1] - qy) / size * 1024, 1)
                            if 0 <= x <= 1024 and 0 <= y <= 1024:
                                points.append(["fol", x, y, int(round(fz + rl[2])), c])
                    except Exception:
                        STATS["vegetação com erro"] += 1
                    continue
                kind = _marker_kind(c)
                if not kind or p.ref_name(e["outer"]) != "PersistentLevel":
                    continue
                try:
                    props, _ = p.read_export_props(e)
                except Exception:
                    continue
                rc = props.get("RootComponent")
                if not rc:
                    continue
                if paths is None:
                    paths = {p.ref_path(j + 1): ex for j, ex in enumerate(p.exports)}
                ce = paths.get(rc)
                if ce is None:
                    continue
                cp, _ = p.read_export_props(ce)
                xyz = cp.get("RelativeLocation")
                if not xyz:
                    continue
                x = round((xyz[0] - qx) / size * 1024, 1)
                y = round((xyz[1] - qy) / size * 1024, 1)
                z = int(round(xyz[2]))
                if not (0 <= x <= 1024 and 0 <= y <= 1024):
                    continue
                cat, sub = kind
                cls_path = p.ref_path(e["class_index"]) or ""
                if cat == "spawn":
                    # config de spawn: no ponto ou, se não estiver nele, no Blueprint do spawner (ex.: ovos)
                    if not props.get("SCGClass") and cls_path.startswith("/Game/"):
                        if cls_path not in scg_default:
                            pkg = Package.open(cls_path.split(".")[0])
                            scg_default[cls_path] = ((pkg.cdo() if pkg else None) or {}).get("SCGClass")
                        props["SCGClass"] = scg_default[cls_path]
                    # pontos de evento (SGQ_ShiJian): bando que aparece por evento -> categoria própria
                    scg_s = str(props.get("SCGClass") or "")
                    is_event = "/SGQ_ShiJian/" in scg_s or "/AdditionMap01/BluePrints/NPC/Event/" in scg_s
                    sq = _squad_type(props.get("SCGClass")) if is_event else None
                    if sq:
                        # um marcador por ponto de esquadrão (sem repetir o mesmo lugar: normal + elite)
                        info = spawn_info(props.get("SCGClass"))
                        key = (sq, round(x), round(y))
                        if key not in squad_seen:
                            squad_seen[key] = len(points)
                            points.append(["invasion", x, y, z, sq,
                                           min((i[1] for i in info), default=0), max((i[2] for i in info), default=0)])
                        else:
                            q = points[squad_seen[key]]
                            for i in info:
                                q[5] = min(q[5], i[1]) if q[5] else i[1]
                                q[6] = max(q[6], i[2])
                    for cls, lo, hi, bag, baby in spawn_info(props.get("SCGClass")):
                        cid = canon.get(asset_name(cls).lower(), asset_name(cls))
                        bag = use_bag(bag)
                        # filhotes também nascem com a Equipe de Caça (onça, leopardo-das-neves...)
                        if baby and (not is_event or sq == "hunting"):
                            # filhote / ovo: categoria própria (para domesticar)
                            cid = BABY_ALIAS.get(cid, cid)
                            if cid not in creature_ids and cid not in out["babyNames"]:
                                out["babyNames"][cid] = actor_name(cls) or {"pt": cid, "en": cid}
                            key = ("baby", cid, round(x), round(y))
                            if key not in squad_seen:
                                squad_seen[key] = True
                                points.append(["baby", x, y, z, cid, lo, hi])
                            continue
                        if is_event:
                            # pontos de evento não vão para o mapa; só reis/líderes nomeados continuam (chefes)
                            nm = actor_name(cls)
                            if cid not in creature_ids and nm and BOSS_NAME_RE.search("%s %s" % (nm["pt"], nm["en"])):
                                points.append(["npc", x, y, z, label(nm), lo, hi, bag, npc_equip(props.get("SCGClass"), cls)])
                            continue
                        if cid in creature_ids:
                            points.append(["creature", x, y, z, cid, lo, hi, bag])
                        else:
                            # animal fora da enciclopédia sem bolsa de drop: o que dá ao esquartejar
                            # p[8] = índice em out["npcEquip"] (armaduras/armas que o NPC veste e pode soltar)
                            points.append(["npc", x, y, z, label(actor_name(cls)), lo, hi, bag or animal_harvest(cls),
                                           npc_equip(props.get("SCGClass"), cls)])
                    continue
                if cat in ("ore", "summon"):
                    points.append([cat, x, y, z, sub])
                    continue
                if cat == "invasion":
                    # BP_RuQinSGQ: tribo próxima que ataca a base do jogador (só na Floresta; nas Areias Errantes
                    # o pedido foi não mostrar esse tipo)
                    if mid != "dlc":
                        points.append(["invasion", x, y, z, "base", 0, 0])
                    continue
                lvl = re.search(r"_(\d{2})[A-Z]", c) or re.search(r"_T(\d)_", c)
                game_cls = cls_path.split(":")[0] if cls_path.startswith("/Game/") else None
                pt = [cat, x, y, z, label(actor_name(game_cls) if game_cls else None)]
                if cat == "dungeon":
                    pt.append(c[:-2] if c.endswith("_C") else c)   # chave em out["dungeons"]
                if cat in ("chest", "maskChest"):
                    pt.append(int(lvl.group(1)) if lvl else 0)
                    pt.append(bag_of(game_cls) if game_cls else None)
                    jzt = re.search(r"JZT_\d+_(?:ZhongShu_)?([A-Za-z]+)_C$", c)
                    if jzt:
                        pt.append(JZT_BOSS.get(jzt.group(1)))
                points.append(pt)
        # locais oficiais do mapa (ruínas, acampamentos, covis, minas, arenas...) e estelas
        conf_cls = ((Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ZiYuanGuanLiQi").cdo() or {})
                    .get("MapQingBaoConfigClassMap") or {}).get(main_path.rsplit("/", 1)[-1])
        qconf = (Package.open(conf_cls.split(".")[0]).cdo() or {}) if conf_cls else {}
        if qconf:
            have = {p[0] for p in points}
            points[:] = [p for p in points if p[0] != "ruin"]   # ruínas: a lista oficial substitui as portas
            icon_map = (qconf.get("AllTanSuoDianIconMap") or {}).get("TanSuoDianIconMap") or {}
            tsd_loc = (qconf.get("AllTanSuoPointLocationMap") or {}).get("TanSuoDianLocationMap") or {}
            for k, v in ((qconf.get("AllTanSuoDianInfoMap") or {}).get("TanSuoDianInfoMap") or {}).items():
                tt = (v.get("TSDType") or "").split("::")[-1].replace("ETSD_TYPE_", "")
                cat = TSD_CAT.get(tt)
                xyz = tsd_loc.get(k)
                if not cat or not xyz or (cat in TSD_FROM_ACTORS and cat in have):
                    continue
                if cat not in out["icons"] and icon_map.get("ETanSuoDianType::ETSD_TYPE_" + tt):
                    url = map_icon(icon_map["ETanSuoDianType::ETSD_TYPE_" + tt].split(".")[0])
                    if url:
                        out["icons"][cat] = url
                x = round((xyz[0] - qx) / size * 1024, 1)
                y = round((xyz[1] - qy) / size * 1024, 1)
                if 0 <= x <= 1024 and 0 <= y <= 1024:
                    points.append([cat, x, y, int(round(xyz[2])), label(loc.get(v.get("TSDName")))])
            # estelas (antigas e sagradas), quando a fase não tem os atores delas
            if not {"tabletAncient", "tabletDivine"} & have:
                for path, xyz in ((qconf.get("AllShiBeiLocationList") or {}).get("ShiBeiLocationMap") or {}).items():
                    x = round((xyz[0] - qx) / size * 1024, 1)
                    y = round((xyz[1] - qy) / size * 1024, 1)
                    if 0 <= x <= 1024 and 0 <= y <= 1024:
                        points.append(["tabletDivine" if "HolyTablet" in path else "tabletAncient", x, y, int(round(xyz[2])), -1])
        # cada pirâmide recebe o chefe do baú de pirâmide mais próximo
        jzt = [p for p in points if p[0] in ("chest", "maskChest") and len(p) > 7 and p[7]]
        for p in points:
            if p[0] == "pyramid" and jzt:
                near = min(jzt, key=lambda q: (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2)
                if (near[1] - p[1]) ** 2 + (near[2] - p[2]) ** 2 < 40 ** 2:
                    p.append(near[7])
        # formato do ponto: [categoria, x, y, z(mundo), ...]  x/y em 0..1024 sobre o desenho
        out["maps"][mid] = {"image": "assets/img/map/%s.webp" % MAP_IMAGES[mid][1], "world": [qx, qy, size],
                            "labels": labels, "points": points, "regions": map_regions(loc, mid)}
        STATS["marcadores do mapa"] += len(points)
    return out


MENU_ICONS = {  # botões da página inicial que não tinham ícone -> ícones da interface do jogo
    "itens": "ZuoCeGongNeng/wupin_1",
    "armaduras": "shujukuicon/fangju_1",
    "armas": "ZuoCeGongNeng/wuqijieshao_1",
    "receitas": "ZuoCeGongNeng/zhizuo_1",
    "chefes": "DiTuIcon/shijieboss",
    "mapa": "ZuoCeGongNeng/lutu_1",
    "tierlist": "ZuoCeGongNeng/chenghao_1",
    "gdmbot": "ZuoCeGongNeng/nengli_1",
    "reportar": "ZuoCeGongNeng/rizhi_1",
    "proficiencia": "ZuoCeGongNeng/shuliandu_1",
    "maestria": "ZuoCeGongNeng/zhuanjing_1",
    "eventos": "ZuoCeGongNeng/buluoshijian_1",
    "comandos": "ZuoCeGongNeng/wenben_1",
    "servidores": "ZuoCeGongNeng/buluoxinxi_1",
    "bancada": "ZuoCeGongNeng/zhizuo_1",
    "atributos": "ZuoCeGongNeng/jingli_1",
}


def build_menu_icons():
    out_dir = os.path.join(os.path.dirname(IMG_DIR), "menu-icons")
    for name, tex in MENU_ICONS.items():
        out = os.path.join(out_dir, name + ".webp")
        if os.path.isfile(out) and not FORCE_ICONS:
            continue
        pkg = Package.open("/Game/UI/resource/JianYingIcon/" + tex)
        img = extract_texture(pkg) if pkg else None
        if img is not None:
            img.convert("RGBA").save(out, "WEBP", quality=90, method=4)


def build_world_map():
    """Mapa do mundo do jogo (UI/Map/Level01_Map, 4096x4096) para a página do mapa interativo."""
    out_dir = os.path.join(os.path.dirname(IMG_DIR), "map")
    os.makedirs(out_dir, exist_ok=True)
    for mid, (tex, fname) in MAP_IMAGES.items():
        out = os.path.join(out_dir, fname + ".webp")
        if os.path.isfile(out) and not FORCE_ICONS:
            continue
        pkg = Package.open(tex)
        img = extract_texture(pkg) if pkg else None
        if img is None:
            log("AVISO: mapa não encontrado:", tex)
            continue
        img = img.convert("RGB")
        img.save(out, "WEBP", quality=78, method=4)
        img.resize((1024, 1024), 1).save(os.path.join(out_dir, fname + "-small.webp"), "WEBP", quality=80, method=4)
        log("mapa", mid, img.size)


# ====================================================================== auxiliares
_ge_cache = {}


def ge_info(ge_path, loc):
    """Efeito (GameplayEffect): modificadores, duração e textos de buff."""
    p = pkg_path(ge_path)
    if p in _ge_cache:
        return _ge_cache[p]
    info = None
    pkg = Package.open(p) if p else None
    if pkg:
        try:
            cdo = pkg.cdo() or {}
            pol = enum_tail(cdo.get("DurationPolicy")) or "Instant"
            dur = ((cdo.get("DurationMagnitude") or {}).get("ScalableFloatMagnitude") or {}).get("Value") or 0
            mods = []
            for m in cdo.get("Modifiers", []) or []:
                a = (m.get("Attribute") or {}).get("AttributeName")
                mm = m.get("ModifierMagnitude") or {}
                v = (mm.get("ScalableFloatMagnitude") or {}).get("Value")
                if v is None:
                    v = (m.get("Magnitude") or {}).get("Value")
                if a and v:
                    mods.append({"a": a, "v": v, "op": m.get("ModifierOp")})
            info = {"instant": pol == "Instant", "duration": dur if pol == "HasDuration" else 0, "mods": mods}
            # textos de buff (subobjeto HGEUIDataBuffXinXi)
            for e in pkg.exports:
                if "BuffXinXi" in (pkg.export_class(e) or "") or "BuffXinXi" in e["name"]:
                    props, _ = pkg.read_export_props(e)
                    nm = loc.get(props.get("BuffMing"))
                    ds = loc.get(props.get("BuffMiaoShu"))
                    if nm:
                        info["name"] = nm
                    if ds:
                        info["desc"] = ds
        except Exception:
            info = None
    _ge_cache[p] = info
    return info


_FOOD_SUBS = [
    # (padrão no início da descrição em chinês, chave, PT, EN)
    ("主食", "staple"), ("饮品", "drink"), ("饮料", "drink"), ("肉食", "meat"), ("肉类", "meat"),
    ("果蔬", "veg"), ("蔬果", "veg"), ("嗜好", "recreational"), ("零食", "snack"), ("药品", "healing"),
    ("药物", "healing"),
]


def food_subcategory(it):
    """Usa o rótulo oficial entre colchetes no início da descrição: '[Staple Food] ...'"""
    en = it.get("desc_en") or ""
    pt = it.get("desc_pt") or ""
    men = re.match(r"^\s*[\[【]([^\]】]+)[\]】]", en)
    mpt = re.match(r"^\s*[\[【]([^\]】]+)[\]】]", pt)
    if not men:
        if it["cat"] == "medicine":
            return {"key": "healing", "pt": "Cura", "en": "Healing"}
        return {"key": "other", "pt": "Outros", "en": "Other"}
    label_en = men.group(1).strip()
    label_pt = mpt.group(1).strip() if mpt else label_en
    key = re.sub(r"[^a-z]+", "_", label_en.lower()).strip("_")
    key = {"staple_food": "staple", "drinks": "drink", "drink": "drink", "beverage": "drink", "meat": "meat",
           "fruits_vegetables": "veg", "fruit_vegetables": "veg", "fruits_and_vegetables": "veg",
           "vegetables": "veg", "recreational": "recreational", "medicine": "healing"}.get(key, key)
    return {"key": key, "pt": label_pt, "en": label_en}


_bench_cache = {}


def bench_info(cls, loc, icons):
    pkg = Package.open(cls)
    if not pkg:
        return None
    try:
        cdo = pkg.cdo() or {}
    except Exception:
        return None
    name = None
    for k in ("JianZhuDisplayName", "Name", "GongZuoTaiName", "DisplayName"):
        name = loc.get(cdo.get(k))
        if name:
            break
    if not name:
        return None
    out = {"name_pt": name["pt"], "name_en": name["en"]}
    ic = icons.get(cdo.get("Icon") or cdo.get("JianZhuIcon"))
    if ic:
        out["icon"] = ic
    return out


def build_talents(loc, icons, names):
    """Agrupa os níveis (Star 1..3) de cada talento pelo LearnedNGID."""
    rows = Package.open("/Game/Blueprints/DataTable/NaturalGift/DT_GiftZongBiao").datatable_rows()
    # o ID verdadeiro é o nome da linha (o campo "ID" às vezes vem 0)
    for k, r in rows.items():
        if k.isdigit():
            r["ID"] = int(k)
    # tipos: usa as tabelas oficiais de sorteio quando o ID aparece nelas
    def ids_of(path):
        try:
            rr = Package.open(path).datatable_rows() or {}
        except Exception:
            return set()
        out = set()
        s = json.dumps(rr)
        for m in re.finditer(r"\b(\d{5,7})\b", s):
            out.add(int(m.group(1)))
        for k in rr:
            if k.isdigit():
                out.add(int(k))
        return out

    neg = ids_of("/Game/Blueprints/DataTable/NaturalGift/DT_GiftFuMiann")

    TYPES = {
        "positive": ("Positivo", "Positive"), "negative": ("Negativo", "Negative"),
        "preference": ("Preferências", "Preferences"), "tribe": ("Tribo", "Tribe"),
        "title": ("Título", "Title"), "origin": ("Origem", "Origin"),
        "personality": ("Personalidade", "Personality"), "other": ("Outros", "Other"),
    }
    # tipo oficial do jogo (ENaturalGiftSource)
    SOURCE_TYPE = {"XiHao": "preference", "BornBuLuoCiTiao": "tribe", "ChengHao": "title", "JingLi": "title",
                   "XingGe": "personality", "BornChuShen": "origin"}

    # ---- exclusividade oficial (por tribo e/ou profissão), tirada das tabelas de sorteio do jogo
    def label(key):
        v = names.get(key)
        return {"pt": v["pt"], "en": v["en"]} if v else None

    CLAN_TOKENS = [("DuYa", "Clan_3"), ("HuoShi", "Clan_2"), ("LiZhua", "Clan_1"), ("Wolf", "Clan_6"), ("Horn", "Clan_5")]
    JOB_TOKENS = [("ZhanShi", "ZhiYe_1"), ("_ZS", "ZhiYe_1"), ("LieShou", "ZhiYe_2"), ("_LS", "ZhiYe_2"),
                  ("WeiShi", "ZhiYe_3"), ("_WS", "ZhiYe_3"), ("LiGong", "ZhiYe_4"), ("KuLi", "ZhiYe_4"),
                  ("ZaGong", "ZhiYe_5"), ("JiangRen", "ZhiYe_6"), ("_JR", "ZhiYe_6")]

    def cond_keys(conds):
        keys = []
        for c in conds or []:
            n = asset_name(c) or ""
            keys += [k for tok, k in CLAN_TOKENS if tok in n]
            keys += [k for tok, k in JOB_TOKENS if tok in n]
        return keys

    excl = defaultdict(set)      # ID do talento -> chaves (Clan_N / ZhiYe_N)
    generic = set()              # aparece também em sorteios sem restrição
    is_good = {}
    for t in ("DT_GiftZhengMian", "DT_GiftZhengMian_Custom", "DT_GiftFuMiann"):
        try:
            rr = Package.open("/Game/Blueprints/DataTable/NaturalGift/" + t).datatable_rows() or {}
        except Exception:
            continue
        for row in rr.values():
            keys = cond_keys(row.get("TiaoJianBaoList"))
            for d in row.get("NGDetailList", []) or []:
                if "IsGood" in d:
                    is_good[d.get("ID")] = d["IsGood"]
                if keys:
                    excl[d.get("ID")].update(keys)
                else:
                    generic.add(d.get("ID"))
    try:
        cfg = Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ManRenRandomConfig").cdo() or {}
    except Exception:
        cfg = {}
    for clan, data in (cfg.get("BornBuLuoCiTiaoMap") or {}).items():
        letter = clan.split("_")[-1]
        if len(letter) == 1 and letter.isalpha():
            key = "Clan_%d" % (ord(letter.upper()) - ord("A") + 1)
            for grp in data.get("CiTiaoList", []) or []:
                for ng in grp.get("NGIDList", []) or []:
                    excl[ng.get("NGID")].add(key)
    for grp in cfg.get("BornChuShenCiTiaoList", []) or []:
        keys = cond_keys(grp.get("TiaoJianList"))
        for ng in grp.get("NGIDList", []) or []:
            is_good.setdefault(ng.get("NGID"), ng.get("IsGoodNG", True))
            if keys:
                excl[ng.get("NGID")].update(keys)

    # Níveis do mesmo talento: o jogo liga os níveis por LearnedNGID; alguns (ex.: negativos) não ligam,
    # mas usam o mesmo prefixo de ID (…1, …2, …3) e o mesmo título com Star 1, 2, 3.
    # O nível 3 às vezes tem outro título (ex.: 抵触 "Aversão" -> 厌恶 "Nojo"), então o agrupamento é só pelo prefixo
    # do ID; o título só separa quando o mesmo prefixo tem estrelas repetidas (ex.: títulos 6000x, todos Star 3).
    buckets = defaultdict(list)
    for k, r in rows.items():
        rid = r.get("ID") or int(k)
        buckets[rid // 10].append(r)
    groups = defaultdict(list)
    for key, rs in buckets.items():
        stars = [r.get("Star", 0) for r in rs]
        if len(rs) > 1 and len(set(stars)) == len(stars):
            groups[key] = rs
        else:
            for r in rs:
                groups[("ng", r.get("LearnedNGID") or r.get("ID"))].append(r)

    out = []
    for _, levels in groups.items():
        levels.sort(key=lambda r: (r.get("Star", 0), r.get("ID", 0)))
        first = levels[0]
        gid = first.get("ID")
        name = loc.get(first.get("Title"))
        if not name:
            STATS["talento sem nome"] += 1
            continue
        t = {"id": str(gid)}
        bi(t, "name", name)
        lv = []
        for r in levels:
            d = loc.get(r.get("Desc"))
            e = {"id": r.get("ID"), "star": r.get("Star", 0)}
            if d:
                e["desc_pt"], e["desc_en"] = d["pt"], d["en"]
            ln = loc.get(r.get("Title"))
            if ln and ln["pt"] != name["pt"]:
                e["name_pt"], e["name_en"] = ln["pt"], ln["en"]   # nível com nome próprio (ex.: nível 3)
            lv.append(e)
        t["levels"] = lv
        # descrição combinada "+[5,10,15]%" quando os níveis só mudam números
        comb = combine_levels([x.get("desc_pt", "") for x in lv]), combine_levels([x.get("desc_en", "") for x in lv])
        if comb[0] and comb[1]:
            t["desc_pt"], t["desc_en"] = comb
        ids = {x.get("ID") for x in levels}
        source = enum_tail(first.get("NGEffectSource")) or "Normal"
        typ = SOURCE_TYPE.get(source)
        if not typ:
            bad = (ids & neg) or any(is_good.get(i) is False for i in ids)
            typ = "negative" if bad else "positive"
        # exclusividade: só quando o talento nunca sai em sorteio sem restrição
        keys = set()
        for i in ids:
            keys |= excl.get(i, set())
        if keys and not (ids & generic):
            labels = [label(k) for k in sorted(keys)]
            labels = [x for x in labels if x]
            if labels:
                t["excl"] = labels
        t["type"] = typ
        t["type_pt"], t["type_en"] = TYPES[typ]
        ic = icons.get(first.get("Pic"))
        if ic:
            t["icon"] = ic
        out.append(t)
    out.sort(key=lambda x: (x["type"], x["name_pt"]))
    STATS["talentos exclusivos"] = sum(1 for x in out if x.get("excl"))
    return out


MASK_STAT_KEYS = {   # EMJJiChuShuXingType -> chave do site (nomes vêm da tela WBP_MianJuXiuFu)
    "ChuShiNengLiang_Type": "energy", "NengLiangHuiFuSuDu_Type": "recovery",
    "NengLiangXiaoHaoSuDu_Type": "consumption", "FuZaiZhi_Type": "crystal", "WeiShe_Type": "deterrence"}


def build_masks(items, loc, icons):
    """Máscaras com o efeito passivo e as melhorias exclusivas (nós de reparo) de cada uma."""
    def mats(lst):
        out = []
        for d in lst or []:
            ids = [asset_name(x) for x in d.get("DemandDaoJu", []) or [] if asset_name(x) in items]
            if ids:
                out.append({"ids": ids, "n": d.get("DemandCount", 1)})
        return out

    by_item, by_name = {}, {}
    for p in game_assets_under("/Game/Blueprints/MianJu/GaiZhuang", "/Game/AdditionMap01/BluePrints/Mask/GaiZhuang"):
        pkg = Package.open(p)
        try:
            cdo = (pkg.cdo() if pkg else None) or {}
        except Exception:
            continue
        if "MJGZNodeName" not in cdo:
            continue
        for d in cdo.get("NeedJieSuoDaoJu", []) or []:
            for cls in d.get("DemandDaoJu", []) or []:
                by_item.setdefault(asset_name(cls), cdo)
        nm = loc.get(cdo.get("MJGZNodeName"))
        if nm:
            by_name.setdefault(nm["pt"], cdo)

    outfits = mask_outfits()
    out = []
    for it in items.values():
        if it["cat"] != "mask":
            continue
        m = dict(it)
        node = by_item.get(it["id"]) or by_name.get(it.get("name_pt"))
        if node:
            # roupa de transformação: a melhoria da máscara que ativa a habilidade de transformação
            for xf in node.get("DuLiXiuFuNodeList", []) or []:
                nid = re.search(r"_(\d{4})(?:\.|$)", xf or "")
                if nid and nid.group(1) in outfits:
                    m["outfit"] = outfits[nid.group(1)]
                    break
            bi(m, "lore", loc.get(node.get("MJGZNodeMiaoShu")))
            # atributos básicos (tela de reparo da máscara): nível atual/máximo e valor, quando o jogo dá
            stats = {}
            for k, v in (node.get("CurShuXingMap") or {}).items():
                key = MASK_STAT_KEYS.get(k.split("::")[-1])
                if key and isinstance(v, dict):
                    st = {"lv": v.get("CurMJShuXingDengJi") or 0, "max": v.get("MaxMJShuXingDengJi") or 5}
                    if v.get("MJShuXingZhi"):
                        st["val"] = round(v["MJShuXingZhi"], 3)
                    stats[key] = st
            if stats:
                m["stats"] = stats
            if node.get("FuZaiShangXianList"):
                m["crystalLimit"] = [round(x) for x in node["FuZaiShangXianList"]]   # por nível da máscara
            if node.get("ChaChaoShuLiang"):
                m["slots"] = node["ChaChaoShuLiang"]
            buffs = []
            for ge in node.get("GE_MaskList", []) or []:
                info = ge_info(ge, loc)
                if info and (info.get("desc") or info.get("name")):
                    b = {}
                    bi(b, "name", info.get("name"))
                    bi(b, "desc", info.get("desc"))
                    buffs.append(b)
            if buffs:
                m["buffs"] = buffs
            ups = []
            for xf in node.get("DuLiXiuFuNodeList", []) or []:
                xp = Package.open(xf)
                try:
                    xc = (xp.cdo() if xp else None) or {}
                except Exception:
                    continue
                levels = []
                name = None
                for cfg in xc.get("MJXFNodeConfigList", []) or []:
                    nm = loc.get(cfg.get("MJXFNodeName"))
                    name = name or nm
                    lv = {}
                    bi(lv, "desc", loc.get(cfg.get("MJXFNodeMiaoShu")))
                    if cfg.get("NeedMianJuDengJi"):
                        lv["maskLevel"] = cfg["NeedMianJuDengJi"]
                    mm = mats(cfg.get("NeedJieSuoDaoJu"))
                    if mm:
                        lv["mats"] = mm
                    if lv.get("desc_pt") or mm:
                        levels.append(lv)
                if not name or not levels:
                    continue
                up = {"levels": levels}
                bi(up, "name", name)
                ic = icons.get(xc.get("IconYiJieSuo") or xc.get("Icon"))
                if ic:
                    up["icon"] = ic
                ups.append(up)
            if ups:
                m["upgrades"] = ups
                # núcleo da máscara: o Módulo Restritivo que a melhoria de mimetismo pede
                core = next((x for u in ups for lv in u["levels"] for mm in lv.get("mats", [])
                             for x in mm["ids"] if x.startswith("DaoJu_Item_Mask_BianShen")), None)
                if core:
                    m["core"] = core
        else:
            STATS["máscara sem nó de melhoria"] += 1
        out.append(m)
    return out


_NUM = re.compile(r"-?\d+(?:[.,]\d+)?")


def combine_levels(descs):
    descs = [d for d in descs if d]
    if not descs:
        return ""
    if len(descs) == 1:
        return descs[0]
    skel = [_NUM.sub("#", d) for d in descs]
    if len(set(skel)) != 1:
        return ""   # textos diferentes entre os níveis: a página mostra cada nível separado
    nums = [_NUM.findall(d) for d in descs]
    parts = _NUM.split(descs[0])
    out = parts[0]
    for i in range(len(nums[0])):
        vals = [n[i] for n in nums]
        out += vals[0] if len(set(vals)) == 1 else "[" + ",".join(vals) + "]"
        out += parts[i + 1]
    return out


def build_legacy(items, armor_pieces, foods, talents):
    """Mapa dos IDs do site antigo para os novos (para builds salvas no navegador)."""
    if not os.path.isfile(os.path.join(DATA_DIR, "talentos.json")) and LEGACY_MAP.get("ids"):
        return LEGACY_MAP["ids"]   # arquivos antigos já apagados: reaproveita o mapa salvo
    legacy = {"armor": {}, "food": {}, "talent": {}}
    by_en = defaultdict(list)
    for it in items.values():
        by_en[(it.get("name_en") or "").strip().lower()].append(it["id"])

    def match(name, pool):
        for cand in by_en.get((name or "").strip().lower(), []):
            if cand in pool:
                return cand
        return None

    old_arm = os.path.join(DATA_DIR, "Armaduras.json")
    if os.path.isfile(old_arm):
        for a in json.load(open(old_arm, encoding="utf-8")):
            m = match(a.get("name"), armor_pieces)
            if m:
                legacy["armor"][str(a["id"])] = m
    food_ids = {f["id"] for f in foods}
    old_food = os.path.join(DATA_DIR, "alimentos.json")
    if os.path.isfile(old_food):
        for f in json.load(open(old_food, encoding="utf-8")):
            m = match(f.get("name_en"), food_ids)
            if m:
                legacy["food"][str(f["id"])] = m
    old_t = os.path.join(DATA_DIR, "talentos.json")
    if os.path.isfile(old_t):
        data = json.load(open(old_t, encoding="utf-8"))
        groups = {"Tribo", "Título", "Positivo"}
        filtered = [t for t in data if t.get("Type PT") in groups]
        tids = {t["id"] for t in talents}
        for i, t in enumerate(filtered):
            gid = str(int(t["IDs1"])) if t.get("IDs1") else None
            if gid in tids:
                legacy["talent"]["talent-%d" % i] = gid
    legacy["mask"] = {}
    mask_ids = {i for i, it in items.items() if it["cat"] == "mask"}
    old_items = os.path.join(DATA_DIR, "itens.json")
    if os.path.isfile(old_items):
        for it in json.load(open(old_items, encoding="utf-8")):
            if it.get("category") == "Máscaras":
                m = match(it.get("name"), mask_ids)
                if m:
                    legacy["mask"][str(it["id"])] = m
    STATS["legado máscaras"] = len(legacy["mask"])
    STATS["legado armaduras"] = len(legacy["armor"])
    STATS["legado comidas"] = len(legacy["food"])
    STATS["legado talentos"] = len(legacy["talent"])
    LEGACY_MAP["ids"] = legacy
    return legacy


if __name__ == "__main__":
    main()
