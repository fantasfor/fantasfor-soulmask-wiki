"""
Gera os dados das páginas Conquistas, Ranks de caçador e Humor dos NPCs, lidos do Modkit:

  assets/data/achievements.json  <- BP_ChengJiuConfig (marcos da jornada) + estelas (ShiBei / Achievement_Tablet)
  assets/data/hunter.json        <- DT_ShouLieNodeTable (títulos), DT_ShouLieLevelTable (níveis), animais da enciclopédia
  assets/data/moods.json         <- BP_ZiYuanGuanLiQi.XinQingConfData / XinQingAffectConfMap, DT_XinQingTagTable,
                                    DT_XinQingGongHuiLvTable e os GE de humor de cada profissão

Roda sozinho (não mexe nos outros JSON):  python tools/build_journey.py
"""
import os
import re
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402
from uasset import Package  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "assets", "data")

# mapa com chave de 1 byte (enum sem "::", ex.: ZHIYE_TYPE_WUWEI) que o leitor geral não reconhece
_orig_read_value = Package._read_value


def _read_value(self, r, ptype, size, info, end):
    if ptype == "MapProperty" and info.get("inner") == "ByteProperty":
        start = r.o
        try:
            return _orig_read_value(self, r, ptype, size, info, end)
        except Exception:
            r.o = start
            r.i32()
            n = r.i32()
            out = {}
            for _ in range(n):
                k = r.fname()
                out[str(k)] = self._read_inner(r, info["value"], end, None)
            return out
    return _orig_read_value(self, r, ptype, size, info, end)


Package._read_value = _read_value


def gp(p):
    return p.split(".")[0] if p else None


def tail(p):
    return gp(p).rsplit("/", 1)[-1] if p else None


def cdo(p):
    pk = Package.open(gp(p)) if p else None
    try:
        return (pk.cdo() if pk else None) or {}
    except Exception:
        return {}


def load(name):
    with open(os.path.join(DATA, name + ".json"), encoding="utf8") as f:
        return json.load(f)


def dump(name, data):
    out = os.path.join(DATA, name + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("  ->", name, "%.0f KB" % (os.path.getsize(out) / 1024))


def split_how(t):
    """'texto de ambientação: como desbloquear' -> (ambientação, como)."""
    if not t:
        return None, None
    flav, how = {}, {}
    for lang in ("pt", "en"):
        s = (t.get(lang) or "").strip()
        s = re.sub(r"\s*[（(](?:requer|requires)(?:\s+a)?\s+DLC[^()（）]*[)）]\.?$", "", s, flags=re.I)
        s = re.sub(r"^errote\b", "Derrote", s)   # erro de digitação no texto em português do jogo
        m = re.match(r"^(.*\S)\s*(?:[:：]|\s—\s)\s*([^:：—]+)$", s, re.S)
        if m and len(m.group(2)) < 200:
            f, h = m.group(1).strip(), m.group(2).strip()
        else:
            f, h = "", s
        h = re.sub(r",?\s*(?:para desbloquear|to unlock) (?:este|this) (?:Marco de Viagem|Trip Milestone)\.?$", "", h, flags=re.I).strip()
        h = h[:1].upper() + h[1:] if h else h
        flav[lang], how[lang] = f, h
    return (flav if any(flav.values()) else None), how


def main():
    loc = bd.Loc()
    icons = bd.Icons()
    items = {x["id"]: x for x in load("items")}
    creatures = {x["id"]: x for x in load("creatures")}
    bosses = load("bosses")
    world = {k: v["world"] for k, v in load("map-markers")["maps"].items()}
    zy = cdo("/Game/Blueprints/ZiYuanGuanLi/BP_ZiYuanGuanLiQi")

    name_cache = {}

    def actor_name(path):
        p = gp(path)
        if p not in name_cache:
            c = cdo(p)
            name_cache[p] = loc.get(c.get("JianZhuDisplayName") or c.get("Name") or c.get("MoRenMingZi"))
        return name_cache[p]

    def to_map(mid, xyz):
        qx, qy, size = world[mid]
        x = round((xyz[0] - qx) / size * 1024, 1)
        y = round((xyz[1] - qy) / size * 1024, 1)
        return [x, y] if 0 <= x <= 1024 and 0 <= y <= 1024 else None

    def tech(sub):
        c = cdo(sub)
        if not c:
            return None
        t = {}
        bd.bi(t, "name", loc.get(c.get("Name")))
        made = []
        for rp in c.get("KeJiPeiFangSoftList") or []:
            prod = bd.asset_name(cdo(rp).get("ProduceDaoJu"))
            if prod in items and prod not in made:
                made.append(prod)
        if made:
            t["items"] = made
        return t if t.get("name_pt") or made else None

    # ------------------------------------------------------------------ conquistas
    cfg = cdo("/Game/Blueprints/ZiYuanGuanLi/BP_ChengJiuConfig")
    order = [gp(p) for p in cfg["ChengJiuShowOrderList"]["ChengJiuList"]]
    big_of = {}
    for big, v in cfg["ChengJiuBigTypeMap"]["ChengJiuBigTypeMap"].items():
        for _typ, v2 in (v.get("ChengJiuTypeMap") or {}).items():
            for p in v2.get("ChengJiuList") or []:
                big_of[gp(p)] = big.split("::")[-1]
    steles = []   # (caminho, mapa, sagrada)
    for key, holy in (("HolySteleAchievementMap", True), ("OrdinarySteleAchievementMap", False)):
        for lvl, v in cfg[key].items():
            mid = "dlc" if lvl.startswith("DLC") else "main"
            for p in v.get("ChengJiuList") or []:
                steles.append((gp(p), mid, holy))
    # posição de cada estela (config de informações do mapa)
    pos = {}
    for lvl, conf in (zy.get("MapQingBaoConfigClassMap") or {}).items():
        mid = {"Level01_Main": "main", "DLC_Level01_Main": "dlc"}.get(lvl)
        if not mid:
            continue
        q = cdo(conf)
        for path, xyz in ((q.get("AllShiBeiLocationList") or {}).get("ShiBeiLocationMap") or {}).items():
            at = to_map(mid, xyz)
            if at:
                pos[(gp(path), mid)] = at
    # regiões das conquistas de exploração (índice -> nome da região)
    tsd_count = {}

    boss_by_cls = {}
    boss_by_name = {}
    for b in bosses:
        boss_by_cls["BP_Boss_" + b["id"]] = b["id"]
        for t in b.get("tiers") or []:
            boss_by_name[t.get("name_pt")] = b["id"]
    mm = load("map-markers")["maps"]
    map_names = {mid: {l.get("pt") for l in v.get("labels") or [] if l} for mid, v in mm.items()}

    def target_of(c, mid):
        """Onde fazer: criatura (enciclopédia), chefe (página Chefes) ou busca no mapa pelo nome."""
        paths = c.get("ChengJiuObjectClassOrList") or ([c.get("ChengJiuObjectClass")] if c.get("ChengJiuObjectClass") else [])
        out = []
        for p in paths:
            n = tail(p)
            if not n or n.endswith("_Base"):
                continue
            if n in creatures:
                out.append({"creature": n})
            elif n in boss_by_cls:
                out.append({"boss": boss_by_cls[n]})
            elif c.get("ChengJiuBigType", "").endswith("KILL_TARGET"):
                nm = actor_name(p)
                if nm and nm["pt"] in boss_by_name:
                    out.append({"boss": boss_by_name[nm["pt"]]})
                elif nm:
                    # só quando o nome existe entre os marcadores do mapa (busca do mapa acha o ponto)
                    for m2 in ([mid] + [x for x in map_names if x != mid]):
                        if nm["pt"] in map_names.get(m2, ()):
                            out.append({"q_pt": nm["pt"], "q_en": nm["en"], "map": m2})
                            break
        return out

    ach = []
    seen = set()

    def add(p, cat, mid=None, holy=None):
        if p in seen:
            return
        seen.add(p)
        c = cdo(p)
        if not c:
            return
        aid = tail(p)
        dlc = aid.startswith("BP_Achievement_") or "_AJ_" in aid or mid == "dlc"
        row = {"id": aid, "cat": cat}
        bd.bi(row, "name", loc.get(c.get("ChengJiuName")))
        text = loc.get(c.get("ChengJiuTiaoJian"))
        if cat in ("stele", "holyStele"):
            if text:
                bd.bi(row, "lore", text)
        else:
            flav, how = split_how(text)
            if flav:
                bd.bi(row, "lore", flav)
            if how:
                bd.bi(row, "how", how)
        ic = icons.get(c.get("TextureIcon"))
        if ic:
            row["icon"] = ic
        if c.get("ChengJiuNeedCount"):
            row["count"] = c["ChengJiuNeedCount"]
        rw = {}
        if c.get("ChengJiuExp"):
            rw["exp"] = c["ChengJiuExp"]
        if c.get("ChengJiuKeJiPoint"):
            rw["tech"] = c["ChengJiuKeJiPoint"]
        un = [tech(a.get("KeJiSubNodeClass")) for a in c.get("AutoGetKeJiList") or []]
        un = [u for u in un if u]
        if un:
            rw["unlocks"] = un
        if rw:
            row["reward"] = rw
        if dlc:
            row["dlc"] = True
        m = mid or ("dlc" if dlc else "main")
        if cat in ("stele", "holyStele"):
            at = pos.get((p, m))
            if at:
                row["map"] = m
                row["at"] = at
        else:
            tg = target_of(c, m)
            if tg:
                row["targets"] = tg
            if c.get("CollectIntParaList") and c.get("ChengJiuType", "").endswith("TANSUODIAN"):
                row["points"] = len(c["CollectIntParaList"])
            if c.get("SubChengJiuList"):
                row["subs"] = [tail(s) for s in c["SubChengJiuList"]]
            obj = c.get("ChengJiuObjClass") or (c.get("ChengJiuObjectClass") if not c.get("ChengJiuBigType", "").endswith("KILL_TARGET") else None)
            on = bd.asset_name(obj) if obj else None
            if on and on in items:
                row["item"] = on
            elif on and "MianJu" in (obj or ""):
                # máscara: BP_MJGZ_MianJu_N -> DaoJu_Mask_0(N-2) não é garantido; usa o nome da máscara
                nm = actor_name(obj)
                if nm:
                    bd.bi(row, "maskName", nm)
            if c.get("NumberParam2") and "ShouLie" in aid:
                row["level"] = c["NumberParam2"]
                row["quality"] = c.get("NumberParam1")
        ach.append(row)

    CAT = {"CHENGZHANG": "growth", "MAP_TANSUO": "explore", "KILL_TARGET": "kill", "MANREN_MANAGER": "tribe",
           "ZHIZAO": "craft", "JIESUO_MIANJIA": "masks", "SUB_CHENGJIU": "collection"}
    for p in order + [x for x in big_of if x not in order]:
        b = big_of.get(p, "")
        cat = CAT.get(b.replace("ECHBIGTYPE_", ""), "other")
        if cat == "kill":
            n = tail(p)
            cat = ("hunt" if "ShouLie" in n else "ruins" if "YiJiDiGong" in n or "DiMianYiJi" in n
                   else "camps" if "ZhaiZi" in n else "kill")
        add(p, cat)
    for p, mid, holy in steles:
        add(p, "holyStele" if holy else "stele", mid, holy)
    # nome genérico (ex.: "Selvagem" em várias conquistas): a busca do mapa não leva ao lugar certo
    from collections import Counter
    qn = Counter(t["q_pt"] for r in ach for t in r.get("targets", []) if "q_pt" in t)
    for r in ach:
        if r.get("targets"):
            r["targets"] = [t for t in r["targets"] if "q_pt" not in t or qn[t["q_pt"]] <= 4]
            if not r["targets"]:
                del r["targets"]
    # marca chefes: alvo na página Chefes
    for r in ach:
        if r["cat"] == "kill" and any("boss" in t for t in r.get("targets", [])):
            r["cat"] = "bosses"
    dump("achievements", {"list": ach})

    # ------------------------------------------------------------------ ranks de caçador
    nodes = Package.open(gp(zy["ShouLieNodeBiao"])).datatable_rows()
    levels = Package.open(gp(zy["ShouLieLvBiao"])).datatable_rows()
    ach_by_id = {r["id"]: r for r in ach}
    ranks = []
    for k, r in sorted(nodes.items(), key=lambda kv: int(kv[0])):
        row = {"n": int(k), "level": r.get("DengJi"), "bestiary": r.get("TuJianShuLiang")}
        bd.bi(row, "name", loc.get(r.get("MingCheng")))
        ic = icons.get(r.get("IconUnLock") or r.get("Icon"))
        if ic:
            row["icon"] = ic
        ic2 = icons.get(r.get("Icon"))
        if ic2 and ic2 != ic:
            row["iconLocked"] = ic2
        need = [tail(x) for x in r.get("ChengJiuJieSuo") or []]
        row["achievements"] = [a for a in need if a in ach_by_id]
        eff = []
        for e, d in zip(r.get("HuoDeNengLi") or [], r.get("HuoDeNengLiMiaoShu") or []):
            one = {"type": (e.get("Type") or "").split("::")[-1], "v": e.get("Value")}
            bd.bi(one, "text", loc.get(d))
            eff.append(one)
        row["effects"] = eff
        ranks.append(row)
    lv = []
    for k, r in sorted(levels.items(), key=lambda kv: int(kv[0])):
        lv.append({"lv": r["DengJi"], "exp": r["ShengJiExp"], "speed": r.get("TuZaiSuDu"), "out": r.get("TuZaiChanChu"),
                   "tool": r.get("TuZaiGongJuXiaoHao"), "stamina": r.get("TuZaiTiLiXiaoHao")})
    # animais da enciclopédia: EXP de personagem ao abater e pontuação de caça pedida para cada nota
    tujian = Package.open(gp(zy["TuJianBiao"])).datatable_rows()
    beasts = []
    for cid, r in tujian.items():
        c = cdo(r.get("ObjectClassPath"))
        if not c:
            continue
        b = {"id": cid}
        if c.get("KilledExp"):
            b["exp"] = c["KilledExp"]
        grades = [c.get("ShouLiePingFenPingJi")] + [c.get("ShouLiePingFenPingJi[%d]" % i) for i in range(1, 6)]
        if grades[0] is not None:
            b["grades"] = [g for g in grades if g is not None]
        bonus = [c.get("ShouLiePingFenJiaCheng")] + [c.get("ShouLiePingFenJiaCheng[%d]" % i) for i in range(1, 6)]
        if bonus[0] is not None:
            b["bonus"] = [x for x in bonus if x is not None]
        if c.get("BiaoBenDropPingFenLimit"):
            b["specimen"] = c["BiaoBenDropPingFenLimit"]
        sus, wan = [], []
        for d in c.get("ShouLieDaoJuSunHaoArray") or []:
            iid = bd.asset_name(d.get("DaoJuTemplate"))
            if iid not in items:
                continue
            if d.get("bSuSha") and iid not in sus:
                sus.append(iid)
            if d.get("bWanZheng") and iid not in wan:
                wan.append(iid)
        if sus:
            b["quick"] = sus
        if wan:
            b["intact"] = wan
        beasts.append(b)
    dump("hunter", {"ranks": ranks, "levels": lv, "beasts": beasts})

    # ------------------------------------------------------------------ humor
    PROF = ["ZHIYE_TYPE_WUWEI", "ZHIYE_TYPE_SHOULIE", "ZHIYE_TYPE_SHOUHU", "ZHIYE_TYPE_KULI", "ZHIYE_TYPE_ZAGONG", "ZHIYE_TYPE_ZONGJIANG"]
    states = []
    for st in zy.get("XinQingConfData") or []:
        row = {"id": (st.get("Type") or "").split("::")[-1], "lo": st.get("Value"), "hi": st.get("Value[1]")}
        ic = icons.get(st.get("Icon"))
        if ic:
            row["icon"] = ic
        eff = {}
        for prof in PROF:
            ge = (st.get("GE_XiaoGuoMap") or {}).get(prof)
            gi = bd.ge_info(ge, loc) if ge else None
            if not gi:
                continue
            e = {"mods": [{"a": m["a"], "v": m["v"], "op": (m.get("op") or "").split("::")[-1]} for m in gi.get("mods", [])]}
            if gi.get("name"):
                bd.bi(e, "name", gi["name"])
                bd.bi(row, "name", gi["name"])
            if gi.get("desc"):
                bd.bi(e, "desc", gi["desc"])
            eff[prof.replace("ZHIYE_TYPE_", "").lower()] = e
        if eff:
            row["effects"] = eff
        states.append(row)
    tags = []
    for _k, r in sorted(Package.open("/Game/Data/DataTables/DT_XinQingTagTable").datatable_rows().items(), key=lambda kv: int(kv[0])):
        t = {"tag": (r.get("GameplayTag") or {}).get("TagName"), "up": bool(r.get("IsFit"))}
        bd.bi(t, "text", loc.get(r.get("Context")))
        tags.append(t)
    # duração dos efeitos de gosto/aversão (GE_XinQing_TianFuLike_* / TianFuHate_*)
    for t in tags:
        m = re.match(r"GameplayEffect\.XinQing\.TianFu(Like|Hate)\.(\w+)$", t["tag"] or "")
        if m:
            c = cdo("/Game/Blueprints/GAS/GE/GE_XinQing_TianFu%s_%s" % (m.group(1), m.group(2)))
            d = ((c.get("DurationMagnitude") or {}).get("ScalableFloatMagnitude") or {}).get("Value")
            if d:
                t["dur"] = d
    tribe = []
    mat_names = {}
    for k, r in sorted(Package.open("/Game/Data/DataTables/DT_XinQingGongHuiLvTable").datatable_rows().items(), key=lambda kv: int(kv[0])):
        tribe.append({"lv": int(k), "gear": (r.get("ZBCaiZhi") or "").split("::")[-1], "comfort": r.get("ShuShiZhi")})
    affect = {}
    for k, v in (zy.get("XinQingAffectConfMap") or {}).items():
        affect[k.split("::")[-1]] = {"tick": v.get("TickDelta")}
    # comidas com nível de tribo indicado (GongHuiLevelFit): base da "comida deliciosa / ruim" do humor
    food_ids = {x["id"] for x in load("foods")}
    food_lv = {}
    for p in bd.game_assets_under("/Game/Blueprints/DaoJu", "/Game/AdditionMap01/BluePrints"):
        n = p.rsplit("/", 1)[-1]
        if n not in food_ids or n in food_lv:
            continue
        lv = cdo(p).get("GongHuiLevelFit")
        if lv:
            food_lv[n] = lv
    dump("moods", {"states": states, "tags": tags, "tribe": tribe, "affect": affect, "foodLv": food_lv})


if __name__ == "__main__":
    main()
