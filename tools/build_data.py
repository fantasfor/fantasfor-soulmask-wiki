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
        self.used[name] = {"pt": label["pt"], "en": label["en"], "pct": pct}
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
                random_pool.extend(pack["stats"])
        extra = prop_pack(cdo.get("ExtraPropPackID")) if cdo.get("ExtraPropPackID") else None
        if extra:
            random_pool.extend(extra["stats"])
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

    # ------------------------------------------------------------------ mapa do mundo
    build_world_map()
    log("lendo marcadores do mapa (fases do jogo)...")
    markers = build_map_markers(loc, {c["id"] for c in creatures})

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

    items_list = sorted(items.values(), key=lambda x: (x["cat"], x["name_pt"]))
    dump("items.json", items_list)
    dump("weapons.json", sorted(weapons, key=lambda x: (x.get("wtype", ""), x.get("quality", 0), x["name_pt"])))
    dump("armor-sets.json", sets)
    dump("armor-pieces.json", sorted(armor_pieces.values(), key=lambda x: (SLOT_ORDER.index(x["slot"]) if x.get("slot") in SLOT_ORDER else 99, x["name_pt"])))
    dump("foods.json", sorted(foods, key=lambda x: (x.get("sub", "zz"), x["name_pt"])))
    dump("talents.json", talents)
    dump("recipes.json", recipes)
    dump("benches.json", benches)
    dump("creatures.json", sorted(creatures, key=lambda x: x["name_pt"]))
    dump("masks.json", masks)
    dump("crops.json", crops)
    dump("map-markers.json", markers)
    dump("bosses.json", bosses)
    dump("comfort.json", comfort)
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


def creature_photo(pkg, cid):
    """Foto da criatura: miniatura 3D do modelo (SkeletalMesh) ou, na falta, do próprio Blueprint."""
    if pkg is None:
        return None
    os.makedirs(PHOTO_DIR, exist_ok=True)
    name = re.sub(r"[^a-z0-9_-]+", "_", cid.lower())
    out = os.path.join(PHOTO_DIR, name + ".webp")
    if os.path.isfile(out) and not FORCE_ICONS:
        return PHOTO_URL + name + ".webp"
    img = None
    try:
        for mesh in _skeletal_meshes(pkg):
            img = _embedded_thumbnail(Package.open(mesh))
            if img is not None:
                break
        if img is None:
            img = _embedded_thumbnail(pkg)
    except Exception:
        img = None
    if img is None:
        STATS["criatura sem foto"] += 1
        return None
    img.convert("RGB").save(out, "WEBP", quality=82, method=4)
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
            boss["tiers"].append(tier)
            if photo_pkg is None:
                photo_pkg = bpkg
        if not boss["tiers"]:
            continue
        boss["tiers"].sort(key=lambda t: t.get("level", 0))
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
        photo = creature_photo(photo_pkg, "boss_" + boss["id"].lower())
        if photo:
            boss["photo"] = photo
        bosses.append(boss)
    bosses.sort(key=lambda b: (bool(b.get("dlc")), b["tiers"][0].get("level", 0)))
    return bosses


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
}


def _level_settings(main_path):
    p = Package.open(main_path)
    for e in p.exports:
        if p.export_class(e) == "HWorldSettings":
            props, _ = p.read_export_props(e)
            return props
    return {}


def _marker_kind(c):
    """Classe do ator na fase -> (categoria, subtipo) do marcador, ou None para ignorar."""
    if "ChuanSongMen" in c:
        return "teleport", None
    if c.startswith("BP_JianZhu_ShiBei"):
        return "obelisk", None
    if c.startswith("BP_JianZhu_JingZiTaMen"):
        return "pyramid", None
    if c.startswith("BP_JianZhu_DiXiaCheng"):
        return "dungeon", None
    if c.startswith("BP_JianZhu_YiJiDaMen") or c.startswith("BP_JianZhu_YiJi_JiGuanDaMen"):
        return "ruin", None
    if c.startswith("BP_JianZhu_YiJiMianJuXiuFu"):
        return "maskAltar", None
    if c.startswith("BP_BaoXiang_Mask"):
        return "maskChest", None
    if c.startswith("BP_BaoXiang"):
        return "chest", None
    m = re.match(r"BP_JianZhu_KuangMai_([A-Za-z]+?)\d*_C$", c)
    if m:
        return "ore", m.group(1).lower()
    if c.startswith("BP_BuLuoGLQ"):
        return "tribe", None
    if "ShuaGuaiQi" in c:
        return "spawn", None
    return None


def build_map_markers(loc, creature_ids):
    """Marcadores do mapa interativo, lidos das fases do jogo (.umap): portais, estelas, pirâmides,
    ruínas, baús, minérios, tribos e onde nasce cada criatura. Coordenadas em 0..1024 sobre o desenho."""
    out = {"maps": {}}
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
                            res.append((cls, g.get("SCGZuiXiaoDengJi") or 0, g.get("SCGZuiDaDengJi") or 0))
                spawn_cache[scg] = res
            return spawn_cache[scg]

        points = []
        base = os.path.join(CONTENT_DIR, *folder.split("/"))
        files = []
        for root, _d, fs in os.walk(base):
            files += [os.path.join(root, f) for f in fs if f.endswith(".umap")]
        for f in sorted(files):
            if any(x in f for x in ("_Main.umap", "Weather", "_Far.umap")):
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
                if not (0 <= x <= 1024 and 0 <= y <= 1024):
                    continue
                cat, sub = kind
                cls_path = p.ref_path(e["class_index"]) or ""
                if cat == "spawn":
                    for cls, lo, hi in spawn_info(props.get("SCGClass")):
                        cid = asset_name(cls)
                        if cid in creature_ids:
                            points.append(["creature", x, y, cid, lo, hi])
                        else:
                            points.append(["npc", x, y, label(actor_name(cls)), lo, hi])
                    continue
                if cat == "ore":
                    points.append([cat, x, y, sub])
                    continue
                lvl = re.search(r"_(\d{2})[A-Z]", c)
                pt = [cat, x, y, label(actor_name(cls_path.split(":")[0]) if cls_path.startswith("/Game/") else None)]
                if cat == "chest" and lvl:
                    pt.append(int(lvl.group(1)))
                points.append(pt)
        out["maps"][mid] = {"image": "assets/img/map/world.webp", "labels": labels, "points": points}
        STATS["marcadores do mapa"] += len(points)
    return out


def build_world_map():
    """Mapa do mundo do jogo (UI/Map/Level01_Map, 4096x4096) para a página do mapa interativo."""
    out_dir = os.path.join(os.path.dirname(IMG_DIR), "map")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "world.webp")
    if os.path.isfile(out) and not FORCE_ICONS:
        return
    pkg = Package.open("/Game/UI/Map/Level01_Map")
    img = extract_texture(pkg) if pkg else None
    if img is None:
        log("AVISO: mapa do mundo não encontrado")
        return
    img = img.convert("RGB")
    img.save(out, "WEBP", quality=78, method=4)
    img.resize((1024, 1024), 1).save(os.path.join(out_dir, "world-small.webp"), "WEBP", quality=80, method=4)
    log("mapa do mundo:", img.size)


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
    buckets = defaultdict(list)
    for k, r in rows.items():
        rid = r.get("ID") or int(k)
        title = (r.get("Title") or {}).get("text", "") if isinstance(r.get("Title"), dict) else ""
        buckets[(rid // 10, title)].append(r)
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
            e = {"id": r.get("ID")}
            if d:
                e["desc_pt"], e["desc_en"] = d["pt"], d["en"]
            lv.append(e)
        t["levels"] = lv
        # descrição combinada "+[5,10,15]%" quando os níveis só mudam números
        comb = combine_levels([x.get("desc_pt", "") for x in lv]), combine_levels([x.get("desc_en", "") for x in lv])
        if comb[0]:
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

    out = []
    for it in items.values():
        if it["cat"] != "mask":
            continue
        m = dict(it)
        node = by_item.get(it["id"]) or by_name.get(it.get("name_pt"))
        if node:
            bi(m, "lore", loc.get(node.get("MJGZNodeMiaoShu")))
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
        return descs[-1]
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
