# -*- coding: utf-8 -*-
"""
Dados das páginas-guia (chamado por build_data.py):
  proficiency.json ... níveis, EXP e bônus de cada proficiência (DT_ProficiencyConfig_*) + bônus das profissões
  mastery.json ....... habilidades de maestria de arma (DT_SpecializedSkill -> GA) e chances (DT_ZhuanJingSLD)
  events.json ........ horários de arena e PvP por região, configurações de invasão (BP_ZiYuanGuanLiQi, BP_GameXiShu_*)
Os valores de enum (EProficiency / EProficiencyBenefit) vêm de research/enums.json, lido da DLL do jogo.
"""
import json
import os
import re

from uasset import Package, CONTENT_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
ENUMS = json.load(open(os.path.join(HERE, "research", "enums.json"), encoding="utf-8"))
PROF_ENUM = ENUMS["EProficiency"]
BENEFIT_ENUM = ENUMS["EProficiencyBenefit"]
TABLE_ALIAS = {"BaoMu": "PaoMu", "Dun": "DunPai"}
GROUP_OF = {"WuQi": "weapon", "CaiJi": "gather", "JiaGong": "process", "ZhiZuo": "craft"}
WBP = "/Game/Blueprints/UI/ShuLianDu/WBP_ShuLianDu.Default__WBP_ShuLianDu_C."
# tabela da profissão -> índice ZhiYe_N (DT_YiWenText)
CLASS_TABLES = [("WuWeiZhe", 1), ("ShouLieZhe", 2), ("ShouHuZhe", 3), ("KuLi", 4), ("ZaGong", 5), ("ZongJiang", 6)]
WTYPE_TO_PROF = {"dao": "Dao", "shuangdao": "ShuangDao", "mao": "Mao", "chui": "Chui", "quantao": "QuanTao",
                 "gong": "Gong", "jian": "DaJian", "dun": "DunPai", "bian": "Bian"}


def _tail(v):
    return (v or "").split("::")[-1]


_TAG_RE = re.compile(r"</?[A-Za-z_][A-Za-z0-9_]*>|</>")


def clean(s):
    return _TAG_RE.sub("", (s or "").replace("<br>", "\n").replace("\r\n", "\n")).strip()


def _src(loc, path):
    e = loc.by_src.get(path)
    if e and (e.get("pt") or e.get("en")):
        return {"pt": clean(e.get("pt") or e.get("en")), "en": clean(e.get("en") or e.get("pt"))}
    return None


def _strip_num(s):
    return re.sub(r"\s*[+\-]?\d+(?:[.,]\d+)?\s*%?\s*$", "", s or "").strip()


# efeito do talento (ENaturalGiftEffect) -> proficiência que ele reforça (além do ProfExpInc, que traz a lista pronta)
TALENT_EFFECT_PROF = {
    "DaoDamageInc": "Dao", "ShuangDaoDamageInc": "ShuangDao", "MaoDamageInc": "Mao", "ChuiDamageInc": "Chui",
    "QuanTaoDamageInc": "QuanTao", "GongDamageInc": "Gong", "JianDamageInc": "DaJian", "BianDamageInc": "Bian",
    "WuQiPinZhiInc": "WuQi", "WuQiSuDu": "WuQi", "MakeWeaponExtraProp": "WuQi",
    "JiaZhouPinZhiInc": "JiaZhou", "JiaZhouSuDu": "JiaZhou", "MakeEquipExtraProp": "JiaZhou",
    "QiJuPinZhiInc": "QiJu", "QiJuSuDu": "QiJu", "LianJinSuDu": "LianJin", "PengRenSuDu": "PengRen",
    "PaoMuSuDu": "PaoMu", "RongLianSuDu": "RongLian", "RouPiSuDu": "RouPi", "FangZhiSuDu": "FangZhi",
    "ZhiTaoSuDu": "ZhiTao", "ZuoWuSpeed": "ZhongZhi", "ZuoWuCaiJiInc": "ZhongZhi",
}


def _prof_talents(loc, icons):
    """Talentos (DT_GiftZongBiao) que aumentam a EXP de proficiência ou um bônus da proficiência.
    Volta {proficiência: [{id, kind, vals, name, icon}]}; id = menor ID do talento (como em talents.json)."""
    rows = Package.open("/Game/Blueprints/DataTable/NaturalGift/DT_GiftZongBiao").datatable_rows() or {}
    groups = {}
    for k, r in rows.items():
        if not k.isdigit():
            continue
        eff = _tail(r.get("NGEffect"))
        if eff == "ProfExpInc":
            profs = [_tail(p) for p in r.get("NGProfTypeList") or []]
            kind = "exp"
        elif eff in TALENT_EFFECT_PROF:
            profs = [TALENT_EFFECT_PROF[eff]]
            kind = "quality" if "PinZhi" in eff or "ExtraProp" in eff else "bonus"
        else:
            continue
        if not profs:
            continue
        rid = int(k)
        title = r.get("Title") or {}
        key = (rid // 10, title.get("text", "") if isinstance(title, dict) else "")
        g = groups.setdefault(key, {"rows": [], "profs": profs, "kind": kind})
        g["rows"].append((rid, r))
    out = {}
    for g in groups.values():
        g["rows"].sort(key=lambda x: x[0])
        rid, first = g["rows"][0]
        name = loc.get(first.get("Title"))
        if not name:
            continue
        vals = [round(r.get("NGEffectVal") or 0, 4) for _, r in g["rows"]]
        kind = g["kind"]
        was_exp = kind == "exp"
        if vals and all(v < 0 for v in vals):
            kind = "neg"            # talento que atrapalha (ex.: "Redução de Dano do Martelo")
        e = {"id": str(rid), "kind": kind, "name_pt": name["pt"], "name_en": name["en"]}
        if any(vals) and was_exp:
            e["vals"] = vals        # % de EXP de proficiência (os outros efeitos usam escalas diferentes)
        ic = icons.get(first.get("Pic"))
        if ic:
            e["icon"] = ic
        for p in g["profs"]:
            p = TABLE_ALIAS.get(p, p)
            out.setdefault(p, []).append(e)
    for p in out:
        out[p].sort(key=lambda e: ({"quality": 0, "bonus": 1, "exp": 2, "neg": 3}[e["kind"]], e["name_pt"]))
    return out


def build_npc_quality(attrs):
    """Qualidade do NPC (10 a 15): base humana (DT_Attr_ManRen_1) x coeficiente da cor (PinZhi/PinZhi_1..6)."""
    base_rows = Package.open("/Game/Blueprints/DataTable/AttrMetaData/DT_Attr_ManRen_1").datatable_rows() or {}
    base = {k.split(".")[-1]: v.get("BaseValue") for k, v in base_rows.items()}
    tiers, scaled = [], []
    for n in range(1, 7):
        p = Package.open("/Game/Blueprints/DataTable/AttrMetaData/PinZhi/PinZhi_%d" % n)
        rows = (p.datatable_rows() if p else None) or {}
        coef = {}
        for r in rows.values():
            a = _tail(r.get("AttrType"))
            lo, hi = (r.get("CoefInterval") or [1, 1])[:2]
            coef[a] = [round(lo, 4), round(hi, 4)]
            if a not in scaled:
                scaled.append(a)
        tiers.append({"n": n, "coef": coef})
    keys = scaled + ["SpeedRate", "MaxHuXi"]
    return {"base": {k: base.get(k) for k in keys if base.get(k) is not None}, "scaled": scaled, "tiers": tiers}


def build_fertilizers(items, cdo_cache, loc, crops):
    """Fertilizantes: itens com FeiLiaoConfigList (tipo de adubo -> pontos), EXP de Plantio e aceleração."""
    out = []
    for iid, (pkg, cdo, _native) in cdo_cache.items():
        cfg = cdo.get("FeiLiaoConfigList")
        if not cfg or iid not in items:
            continue
        it = items[iid]
        f = {"id": iid, "name_pt": it["name_pt"], "name_en": it["name_en"],
             "desc_pt": it.get("desc_pt", ""), "desc_en": it.get("desc_en", ""), "icon": it.get("icon"),
             "types": {str(int(re.sub(r"\D", "", _tail(c.get("FeiLiaoType")) or "0") or 0)): c.get("FeiLiaoVal") for c in cfg}}
        if cdo.get("FeiLiaoProfExp"):
            f["exp"] = cdo["FeiLiaoProfExp"]
        if cdo.get("ZuoWuJiaSu"):
            f["boost"] = {"pct": round(cdo["ZuoWuJiaSu"], 4), "time": cdo.get("ZuoWuJiaSuTime") or 0}
        if it.get("recipes"):
            f["craft"] = True
        f["crops"] = [c["id"] for c in crops if c.get("fert") and str(c["fert"]["type"]) in f["types"]]
        out.append(f)
    return sorted(out, key=lambda f: (len(f["types"]), min(int(k) for k in f["types"])))


def build_proficiency(loc, attrs, icons):
    root = os.path.join(CONTENT_DIR, "Blueprints", "DataTable", "Proficiency")
    talents_by_prof = _prof_talents(loc, icons)
    types = []
    for folder, group in GROUP_OF.items():
        d = os.path.join(root, folder)
        for f in sorted(os.listdir(d)):
            m = re.match(r"DT_ProficiencyConfig_(\w+)\.uasset$", f)
            if not m:
                continue
            tid = TABLE_ALIAS.get(m.group(1), m.group(1))
            idx = PROF_ENUM.get(tid)
            name = attrs.names.get("Proficiency_%d" % idx) if idx is not None else None
            if not name or "未使用" in (name.get("pt", "") + name.get("en", "")):
                continue
            rows = Package.open("/Game/Blueprints/DataTable/Proficiency/%s/DT_ProficiencyConfig_%s" % (folder, m.group(1))).datatable_rows()
            levels = sorted(int(k) for k in rows if k.isdigit())
            exp, ben, order, teshu, miles = [], {}, [], [], []
            for lv in levels:
                r = rows[str(lv)]
                exp.append(r.get("ProfConsumeExp") or 0)
                ts = None
                for b in r.get("ProfBenefitConfigList") or []:
                    k = _tail(b.get("ProfBenefit"))
                    if k not in ben:
                        ben[k] = {"key": k, "pct": bool(b.get("IsPct", True)), "per": []}
                        order.append(k)
                    ben[k]["per"].append(round(b.get("ProfBenefitVal") or 0, 5))
                    if b.get("TeShuProfBenefitVal"):
                        ts = [round(x, 4) for x in b["TeShuProfBenefitVal"]]
                teshu.append(ts)
                un = []
                for u in r.get("UnlockProfBenefitConfigList") or []:
                    item = {"key": _tail(u.get("ProfBenefit")), "val": round(u.get("ProfBenefitVal") or 0, 4)}
                    # bônus de qualidade do marco vem por material (o campo do jogo é "TeShuProBenefitVal", sem o "f")
                    tq = u.get("TeShuProBenefitVal") or u.get("TeShuProfBenefitVal") or []
                    if any(tq):
                        item["tq"] = [round(x, 4) for x in tq]
                    txt = loc.get(u.get("DescText"))
                    if txt:
                        item["text_pt"], item["text_en"] = txt["pt"], txt["en"]
                    ic = icons.get(u.get("Pic"))
                    if ic:
                        item["icon"] = ic
                    un.append(item)
                if un:
                    miles.append({"lv": lv, "items": un})
            # nome de cada bônus: WBP_ShuLianDu.BenefitTextMap(<valor do enum>)
            for k in order:
                b = ben[k]
                # o texto do marco (sem o número) é o mais fiel; sem marco, usa o BenefitTextMap do jogo
                u = next((i for ms in miles for i in ms["items"] if i["key"] == k and i.get("text_pt")), None)
                nm = {"pt": _strip_num(u["text_pt"]), "en": _strip_num(u["text_en"])} if u else None
                if k.endswith("PinZhiInc"):
                    # o texto do marco cita um só material; o bônus por nível (130/140/150) vale para todos
                    b["quality"] = True
                    nm = _src(loc, WBP + "BenefitTextMap(%d" % BENEFIT_ENUM.get(k, -1)) \
                        or _src(loc, WBP.replace("WBP_ShuLianDu", "WBP_ShuLianDu_Plus") + "BenefitTextMap(%d" % BENEFIT_ENUM.get(k, -1)) or nm
                if not nm:
                    nm = _src(loc, WBP + "BenefitTextMap(%d" % BENEFIT_ENUM.get(k, -1))
                if nm:
                    b["name_pt"], b["name_en"] = nm["pt"], nm["en"]
                if len(set(b["per"])) == 1:
                    b["per"] = b["per"][0]          # valor igual em todos os níveis
            t = {"id": tid, "enum": idx, "group": group, "name_pt": name["pt"], "name_en": name["en"],
                 "exp": exp,
                 "benefits": [b for b in (ben[k] for k in order)
                              if (any(b["per"]) if isinstance(b["per"], list) else b["per"]) or b["key"] in {i["key"] for ms in miles for i in ms["items"]}],
                 "milestones": miles}
            gain = _src(loc, WBP + "GainExpDescMap(%d" % idx)
            if gain:
                t["gain_pt"], t["gain_en"] = gain["pt"], gain["en"]
            if any(teshu):
                t["quality"] = teshu
                # nome de cada material (índice da lista) = texto do marco que dá qualidade a ele
                labels = [None] * max(len(x or []) for x in teshu)
                for ms in miles:
                    for i in ms["items"]:
                        for n, v in enumerate(i.get("tq") or []):
                            if v and n < len(labels) and not labels[n] and i.get("text_pt"):
                                labels[n] = {"pt": _strip_num(i["text_pt"]), "en": _strip_num(i["text_en"])}
                t["qualityTiers"] = labels
            tal = talents_by_prof.get(tid) or talents_by_prof.get(m.group(1))
            if tal:
                t["talents"] = tal
            types.append(t)
    classes = []
    for table, zi in CLASS_TABLES:
        p = Package.open("/Game/Blueprints/DataTable/Proficiency/DT_Prof_ZhiYe_" + table)
        if not p:
            continue
        rows = p.datatable_rows()
        nm = attrs.names.get("ZhiYe_%d" % zi) or {"pt": table, "en": table}
        classes.append({"id": table, "name_pt": nm["pt"], "name_en": nm["en"],
                        "profs": [{"type": _tail(r.get("ProfType")), "min": r.get("MinAdd"), "max": r.get("MaxAdd")} for r in rows.values()]})
    return {"types": types, "classes": classes}


def _cooldown(ge_path):
    p = Package.open(ge_path.split(".")[0]) if ge_path else None
    c = (p.cdo() if p else None) or {}
    tags = (c.get("InheritableOwnedTagsContainer") or {}).get("CombinedTags") or []
    for tg in tags:
        m = re.search(r"Cooldown[^.]*\.(\d+(?:\.\d+)?)$", tg)
        if m:
            return float(m.group(1))
    v = ((c.get("DurationMagnitude") or {}).get("ScalableFloatMagnitude") or {}).get("Value")
    return round(v, 1) if v and v >= 1 else None


def build_mastery(loc, icons, wtype_labels):
    rows = Package.open("/Game/Data/DataTables/DT_SpecializedSkill").datatable_rows()
    fixed = {}
    for r in Package.open("/Game/Blueprints/ZiYuanGuanLi/DT_GuDingZhuanJing").datatable_rows().values():
        fixed[r.get("JiNengIndex")] = r.get("JiNengLv")
    skills = {}
    for k, r in rows.items():
        ga = ((r.get("ZJJN") or {}).get("Ability") or "").split(".")[0]
        p = Package.open(ga) if ga else None
        c = (p.cdo() if p else None) or {}
        name = loc.get(c.get("AbilityName"))
        if not name:
            continue
        w = _tail(r.get("UseWuQiLeiXing")).replace("WUQI_LEIXING_", "").lower()
        s = {"idx": r.get("JiNengIndex"), "w": w, "name_pt": name["pt"], "name_en": name["en"]}
        desc = loc.get(c.get("JinengMiaoshu"))
        if desc:
            s["desc_pt"], s["desc_en"] = desc["pt"], desc["en"]
        ic = icons.get(c.get("AbilityIcon"))
        if ic:
            s["icon"] = ic
        if c.get("TiLiCost"):
            s["stamina"] = round(c["TiLiCost"], 1)
        if c.get("GACoefficient"):
            s["coef"] = round(c["GACoefficient"], 2)
        if s["idx"] in fixed:
            s["fixed"] = fixed[s["idx"]]
        skills[s["idx"]] = s
    weapons = []
    for r in Package.open("/Game/Blueprints/ZiYuanGuanLi/DT_ZhuanJingSLD").datatable_rows().values():
        w = _tail(r.get("UseWuQiLeiXing")).replace("WUQI_LEIXING_", "").lower()
        lv = []
        for L, g in sorted((r.get("SLDGaiLv") or {}).items(), key=lambda x: int(x[0])):
            pool = {int(i): wt for i, wt in (g.get("JiNengChi") or {}).items() if int(i) in skills}
            tot = sum(pool.values()) or 1
            lv.append({"lv": int(L), "chance": round((g.get("GaiLv") or 0) * 100, 1),
                       "pool": [[i, round(wt * 100 / tot, 1)] for i, wt in sorted(pool.items(), key=lambda x: -x[1])]})
        lab = wtype_labels.get(w) or {"pt": w, "en": w}
        weapons.append({"w": w, "name_pt": lab["pt"], "name_en": lab["en"], "levels": lv})
    used = {i for wp in weapons for l in wp["levels"] for i, _ in l["pool"]} | set(fixed)
    return {"weapons": sorted(weapons, key=lambda x: x["name_pt"]),
            "skills": sorted(skills.values(), key=lambda s: (s["w"], s["idx"] not in used, s["idx"]))}


EVENT_SETTINGS = ["WarKaiGuan", "RuQinKaiGuan", "SuiJiRuQinKaiGuan", "RuQinBeginHour", "RuQinEndHour", "RuQinMaxChangCiCount",
                  "RuQinGuiMoXiShu", "RuQinQiangDuXiShu", "RuQinGuaiLevelXiShu", "RuQinGuaiCountMin", "RuQinGuaiCountMax",
                  "RuQinPerBoGuaiMin", "RuQinPerBoGuaiMax", "RuQinSucceedPrizeTimes", "ReDuXiShu", "ManageModeRuQin",
                  "JianDuiRuQinKaiGuan", "TribalExplorationKaiGuan", "RuinsExplorationKaiGuan", "HuXIangShangHaiKaiGuan"]
MODE_BP = [("survival", ""), ("tribe", "_Management"), ("warrior", "_Action"), ("pvp", "_PVP"), ("casual", "_Creative")]
MODE_NAME_KEY = {"survival": "CustomGameMode_Survival", "tribe": "CustomGameMode_Management",
                 "warrior": "CustomGameMode_Action", "pvp": "CustomGameMode_PVP"}
DROP_KEYS = ["BaoXiangDropRatio", "PuTongRenDiaoLuoRatio", "JingYingRenDiaoLuoRatio", "BossRenDiaoLuoRatio",
             "DongWuShiTiDiaoLuoRatio", "CaiKuangDiaoLuoRatio", "FaMuDiaoLuoRatio", "CaiJiDiaoLuoRatio", "ExpRatio"]


def build_modes(attrs):
    """Os 5 modos de jogo (BP_GameXiShu_GuanLiQi*): multiplicadores de drop no jogo solo (0) e servidor dedicado (1)."""
    out = []
    for mid, suf in MODE_BP:
        c = Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_GameXiShu_GuanLiQi" + suf).cdo() or {}
        g = c.get("GameXiShuMap") or {}
        pick = lambda n: {k: (g.get(n) or {}).get("OneNetModeGameXiShuMap", {}).get(k, 1.0) for k in DROP_KEYS}
        nm = attrs.names.get(MODE_NAME_KEY.get(mid, "")) or None
        e = {"id": mid, "solo": pick("0"), "server": pick("1")}
        if nm:
            e["name_pt"], e["name_en"] = nm["pt"], nm["en"]
        out.append(e)
    return out


# Eventos de invasão (esquadrões que atacam no horário da região). Horários enviados pelo dono do site,
# em horário de Brasília (BRT = UTC-3); o site guarda em UTC e converte para o fuso de quem visita.
# AS = Ásia, EU = Europa, NA = América do Norte, SA = América do Sul, OA = Oceania
SQUADS_BRT = [
    ("hunting", "Equipe de Caça da Tribo", "Tribe Hunting Squad",
     {"AS": "07:00-13:00", "EU": "14:00-20:00", "NA": "20:00-02:00", "SA": "18:00-00:00", "OA": "03:00-09:00"}),
    ("prospecting", "Equipe de Mineração da Tribo", "Tribe Prospecting Squad",
     {"AS": "07:30-13:00", "EU": "14:30-20:00", "NA": "20:30-02:00", "SA": "18:30-00:00", "OA": "03:30-09:00"}),
    ("advProspecting", "Equipe Avançada de Mineração da Tribo", "Advance Tribe Prospecting Squad",
     {"AS": "08:00-13:00", "EU": "15:00-20:00", "NA": "21:00-02:00", "SA": "19:00-00:00", "OA": "04:00-09:00"}),
    ("plunderer", "Aventura dos Saqueadores", "Plunderer Expedition Squad",
     {"AS": "08:30-13:00", "EU": "15:30-20:00", "NA": "21:30-02:00", "SA": "19:30-00:00", "OA": "04:30-09:00"}),
    ("transport", "Caravana de Transporte da Tribo", "Tribe Transport Squad",
     {"AS": "09:00-13:00", "EU": "16:00-20:00", "NA": "22:00-02:00", "SA": "20:00-00:00", "OA": "05:00-09:00"}),
    ("dungeon", "Expedição da Masmorra", "Dungeon Expedition Squad",
     {"AS": "09:00-13:00", "EU": "16:00-20:00", "NA": "22:00-02:00", "SA": "20:00-00:00", "OA": "05:00-09:00"}),
    ("shadowKing", "Rei das Sombras - Lâmina Sombria", "Shadow King - Shadowblade",
     {"AS": "09:30-13:00", "EU": "16:30-20:00", "NA": "22:30-02:00", "SA": "20:30-00:00", "OA": "05:30-09:00"}),
]
SQUAD_REGION = {"AS": "Asia", "EU": "Europe", "NA": "America", "SA": "SouthAmerica", "OA": "Oceania"}


def _brt_to_utc(hhmm):
    h, m = hhmm.split(":")
    return round((int(h) + int(m) / 60 + 3) % 24, 2)


def build_squads():
    out = []
    for sid, pt, en, times in SQUADS_BRT:
        t = {}
        for reg, span in times.items():
            a, b = span.split("-")
            t[SQUAD_REGION[reg]] = [_brt_to_utc(a), _brt_to_utc(b)]
        out.append({"id": sid, "name_pt": pt, "name_en": en, "times": t})
    return out


def build_events(loc):
    c = Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_ZiYuanGuanLiQi").cdo() or {}
    arena = {}
    for reg, v in ((c.get("ZhanChangTimeConfigMap") or {}).get("AllTimeConfigMap") or {}).items():
        arena[_tail(reg)] = [[t["StartTime"]["Hour"] + t["StartTime"].get("Minute", 0) / 60,
                              t["EndTime"]["Hour"] + t["EndTime"].get("Minute", 0) / 60] for t in v.get("TimeDuanList") or []]
    pvp = {}
    for hours, v in (c.get("PVPHoursMap") or {}).items():
        pvp[hours] = {r: [v.get("BeginHours" + r), v.get("EndHours" + r)] for r in ("Asia", "America", "Europe")}
    g = Package.open("/Game/Blueprints/ZiYuanGuanLi/BP_GameXiShu_GuanLiQi").cdo() or {}
    conf = {e["XiShuKey"]: e for e in (g.get("GameXiShuConfigMap") or {}).get("0", {}).get("GameXiShuConfigList", [])}
    settings = []
    for k in EVENT_SETTINGS:
        e = conf.get(k)
        if not e:
            continue
        s = {"key": k, "def": e.get("XiShuDefaultValue"), "min": e.get("XiShuMinValue"), "max": e.get("XiShuMaxValue"),
             "toggle": bool(e.get("IsKaiGuan"))}
        nm = _src(loc, "/Game/Blueprints/ZiYuanGuanLi/DT_XiShuTipsText.DT_XiShuTipsText.%s.YiWenNeiRongText" % k) \
            or _src(loc, "/Game/Blueprints/ZiYuanGuanLi/DT_YiWenText.DT_YiWenText.%s.YiWenNeiRongText" % k)
        if nm:
            s["name_pt"], s["name_en"] = nm["pt"], nm["en"]
        settings.append(s)
    return {"arena": arena, "pvp": pvp, "settings": settings, "squads": build_squads()}


# ====================================================================== fontes de cada item (para Bancada e Cristais)
_VEIN_CACHE = {}


def _vein_bag(sub):
    """Veio de minério (iron/copper/tin/coal) -> bolsa que ele dá (BP_JianZhu_KuangMai_<X>.ChanChuDaoJuBaoName)."""
    if sub not in _VEIN_CACHE:
        pkg = Package.open("/Game/Blueprints/JianZhu/KuangMai/BP_JianZhu_KuangMai_" + sub.capitalize())
        _VEIN_CACHE[sub] = ((pkg.cdo() if pkg else None) or {}).get("ChanChuDaoJuBaoName")
    return _VEIN_CACHE[sub]


SOURCE_RANK = {"fol": 0, "vein": 0, "crop": 0, "creature": 1, "chest": 2, "npc": 3, "boss": 4}


def build_item_sources(markers, creatures, bosses, all_bags=None, loc=None, crops=None, limit=30):
    """item -> lista de onde ele sai: coleta (plantas, árvores, depósitos), veio de minério, animal,
    baú, inimigo e chefe. Cada fonte: {"t": tipo, "id"/"n": quem, "c": chance %, "q": [mín, máx], "m": [mapas]}.
    A ordem põe primeiro a coleta (o jeito normal de juntar material) e depois a maior chance."""
    bags = dict(all_bags or {})
    bags.update(markers.get("bags") or {})
    creature_ids = {c["id"] for c in creatures}
    users = {}   # bolsa -> {(tipo, chave): {"t", "id"/"n", "m": set}}

    def add(bag, t, key, extra):
        if not bag or bag not in bags:
            return
        u = users.setdefault(bag, {}).setdefault((t, key), dict(extra, t=t, m=set()))
        return u

    for mid, m in (markers.get("maps") or {}).items():
        labels = m.get("labels") or []
        for p in m.get("points") or []:
            cat = p[0]
            u = None
            if cat == "creature":
                u = add(p[7] if len(p) > 7 and p[7] else (markers.get("creatureBags") or {}).get(p[4]), "creature", p[4], {"id": p[4]})
            elif cat == "npc" and len(p) > 7:
                lab = labels[p[4]] if 0 <= p[4] < len(labels) else None
                if lab:
                    u = add(p[7], "npc", lab["pt"], {"n": lab})
            elif cat in ("chest", "maskChest") and len(p) > 6:
                lab = labels[p[4]] if 0 <= p[4] < len(labels) else None
                u = add(p[6], "chest", lab["pt"] if lab else "?", {"n": lab} if lab else {})
            elif cat == "fol":
                ft = (markers.get("foliage") or {}).get(p[4])
                if ft and ft.get("bag"):
                    u = add(ft["bag"], "fol", p[4], {"id": p[4], "n": {"pt": ft.get("name_pt"), "en": ft.get("name_en")}})
            elif cat == "ore":
                vein = _vein_bag(p[4])
                if vein:
                    u = add(vein, "vein", p[4], {"id": p[4]})
            if u is not None:
                u["m"].add(mid)
    # toda a vegetação/objetos coletáveis do jogo (árvores, arbustos, pedras, carcaças...), mesmo sem ponto no mapa
    if loc is not None:
        conf = (Package.open("/Game/Blueprints/ZhiBei/BP_ZhiBeiConfig").cdo() or {}).get("ZhiBeiPropConfigMap") or {}
        for path, v in conf.items():
            cls = path.split(".")[-1]
            name = loc.get(v.get("FoliageMapName"))
            if not name:
                continue
            for _tool, e in (v.get("GongJuCaiJiDaoJuMap") or {}).items():
                for key in ("CaiJiDaoJuBaoName", "FinalCaiJiDaoJuBaoName"):
                    b = (e or {}).get(key)
                    if b and b != "None":
                        add(b, "fol", cls, {"id": cls, "n": {"pt": name["pt"], "en": name["en"]}})
    # animais sem ponto próprio no mapa, mas com bolsa de coleta
    for cid, bag in (markers.get("creatureBags") or {}).items():
        if cid in creature_ids:
            add(bag, "creature", cid, {"id": cid})

    out = {}
    for bag, rows in bags.items():
        who = users.get(bag)
        if not who:
            continue
        for r in rows:
            item, lo, hi, gp, ip = r[0], r[1], r[2], r[3], r[4]
            chance = round((gp or 0) * (ip or 0) / 100.0, 2)
            for (t, key), u in who.items():
                lst = out.setdefault(item, {})
                k = (t, key)
                cur = lst.get(k)
                if cur is None or chance > cur["c"]:
                    e = {kk: vv for kk, vv in u.items() if kk != "m"}
                    e.update({"c": chance, "q": [lo, hi], "m": sorted(u["m"])})
                    lst[k] = e
                else:
                    cur["m"] = sorted(set(cur["m"]) | u["m"])
    # árvores e arbustos: as bolsas deles não têm um objeto com nome, então o tipo vem do nome da bolsa
    used = set(users)
    for bag, rows in bags.items():
        if bag in used:
            continue
        kind = "tree" if re.search(r"(?i)tree|^shu$|mucai", bag) else "plant" if re.search(r"(?i)shrub|herb|aloe|grass|flower", bag) else None
        if not kind:
            continue
        for r in rows:
            chance = round((r[3] or 0) * (r[4] or 0) / 100.0, 2)
            if not r[2] or not chance:
                continue
            lst = out.setdefault(r[0], {})
            k = ("fol", kind)
            if k not in lst or chance > lst[k]["c"]:
                lst[k] = {"t": "fol", "id": kind, "c": chance, "q": [r[1], r[2]], "m": []}
    # plantio (colheita das plantações)
    for crop in crops or []:
        for h in crop.get("harvest") or []:
            lst = out.setdefault(h["id"], {})
            k = ("crop", crop["id"])
            if k not in lst:
                lst[k] = {"t": "crop", "id": crop["id"], "n": {"pt": crop["name_pt"], "en": crop["name_en"]},
                          "c": h.get("chance", 100), "q": h.get("n") or [1, 1], "m": []}
    # chefes de mundo (drops das dificuldades)
    for b in bosses or []:
        for ti in b.get("tiers") or []:
            for d in (ti.get("drops") or []) + (ti.get("final") or []):
                lst = out.setdefault(d["id"], {})
                k = ("boss", b["id"])
                if k not in lst or d.get("chance", 0) > lst[k]["c"]:
                    lst[k] = {"t": "boss", "id": b["id"], "c": d.get("chance", 0), "q": d.get("n") or [1, 1], "m": []}
    final = {}
    for item, lst in out.items():
        vals = sorted(lst.values(), key=lambda e: (SOURCE_RANK.get(e["t"], 9), -e["c"]))
        final[item] = vals[:limit]
    return final


# ====================================================================== cristais vermelhos (máscara)
HJS_DIR = "/Game/Blueprints/DaoJu/DaoJuMianJu/HongJingShi/"
HJS_DT = "/Game/Blueprints/DataTable/DaoJu/"
QUALITY_COLORS = ["white", "green", "blue", "purple", "gold", "red"]


def build_red_crystals(loc, attrs, items):
    """Cristais vermelhos (HongJingShi) que se encaixam na máscara: efeito principal, quanto ele
    cresce por qualidade, carga ocupada e os atributos extras aleatórios (pacote 100)."""
    props = Package.open(HJS_DT + "DT_HongJingShiPropTable").datatable_rows()
    teshu = Package.open(HJS_DT + "DT_HongJingShiTeShuPropTable").datatable_rows()

    def mult_table(r):
        return [[x.get("PinZhiJiaChengXia", 1), x.get("PinZhiJiaChengShang", 1)] for x in r.get("PinZhiJiaCheng") or []]

    def stat_of(a):
        return attrs.stat(a["Attr"]["AttributeName"], a.get("AttrValue"), a.get("CaoZuoFu"))

    extra = props.get("100") or {}
    extra_pool = []
    for a in extra.get("AttrList") or []:
        s = stat_of(a)
        if s:
            s["w"] = (a.get("AttrQuanZhongShang") or 0) - (a.get("AttrQuanZhongXia") or 0)
            extra_pool.append(s)
    extra_count = [int((extra.get("PinZhiNum") or {}).get(str(q), 0)) for q in range(6)]

    crystals = []
    for i in range(1, 100):
        pkg = Package.open(HJS_DIR + "BP_HongJingShi%02d" % i)
        if not pkg:
            break
        c = pkg.cdo() or {}
        cid = "BP_HongJingShi%02d" % i
        it = items.get(cid) or {}
        name = loc.get(c.get("Name")) or {"pt": it.get("name_pt", cid), "en": it.get("name_en", cid)}
        e = {"id": cid, "name_pt": name["pt"], "name_en": name["en"], "icon": it.get("icon"),
             "load": c.get("PinZhiFuZaiZhi") or [], "main": [], "special": []}
        mult = None
        for pid in c.get("PropPackIDList") or []:
            if pid == 100:
                continue
            r = props.get(str(pid))
            if r:
                mult = mult or mult_table(r)
                e["main"] += [s for s in (stat_of(a) for a in r.get("AttrList") or []) if s]
        for pid in c.get("TeShuPropPackIDList") or []:
            r = teshu.get(str(pid))
            if not r:
                continue
            mult = mult or mult_table(r)
            txt = loc.get(r.get("TeShuShuXingText")) or {}
            conf = r.get("TeShuAttrConfig") or {}
            e["special"].append({"pt": clean(txt.get("pt", "")), "en": clean(txt.get("en", "")),
                                 "v": conf.get("TeShuAttrValue"), "op": "add"})
        e["extra"] = 100 in (c.get("PropPackIDList") or [])
        e["mult"] = mult or []
        crystals.append(e)
    return {"crystals": crystals, "extraPool": extra_pool, "extraCount": extra_count, "extraMult": mult_table(extra),
            "qualities": QUALITY_COLORS}
