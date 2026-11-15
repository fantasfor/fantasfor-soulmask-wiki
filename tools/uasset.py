# -*- coding: utf-8 -*-
"""
Leitor de pacotes .uasset NÃO cozidos da Unreal Engine 4.27 (formato do Soulmask Modkit).

Lê direto do disco, sem abrir o editor:
  - cabeçalho, tabela de nomes, imports e exports
  - propriedades marcadas (tagged properties) de qualquer export, incluindo
    structs, arrays, sets, maps, FText, referências a objetos e soft paths
  - linhas de DataTables
  - o objeto padrão (CDO) de Blueprints, com herança de Blueprints pais

Uso rápido:
    from uasset import Package, content_path
    pkg = Package.open("/Game/Blueprints/DaoJu/DaoJuShiWu/DaoJu_Item_ZhuTuDou")
    print(pkg.cdo())                # propriedades do Default__..._C
    dt = Package.open("/Game/Blueprints/DataTable/NaturalGift/DT_GiftZongBiao")
    print(dt.datatable_rows())      # {row_name: {...}}
"""

import os
import struct

CONTENT_DIR = os.environ.get(
    "SOULMASK_CONTENT",
    r"C:\Program Files\Epic Games\SoulMaskModkit\Projects\WS\Content")

# Structs com serialização nativa (não usam tagged properties)
_NATIVE_STRUCTS = {
    "Vector": "<3f", "Vector2D": "<2f", "Vector4": "<4f", "Rotator": "<3f",
    "Quat": "<4f", "LinearColor": "<4f", "IntPoint": "<2i", "IntVector": "<3i",
    "Color": "<4B", "DateTime": "<q", "Timespan": "<q", "FrameNumber": "<i",
}


def content_path(game_path):
    """'/Game/A/B' -> '<Content>/A/B.uasset'"""
    p = game_path.split(".")[0]
    if not p.startswith("/Game/"):
        return None
    base = os.path.join(CONTENT_DIR, *p[len("/Game/"):].split("/"))
    # fases (.umap) usam o mesmo formato de pacote
    return base + ".umap" if not os.path.isfile(base + ".uasset") and os.path.isfile(base + ".umap") else base + ".uasset"


class ParseError(Exception):
    pass


class Reader(object):
    __slots__ = ("b", "o", "names")

    def __init__(self, b, o=0, names=None):
        self.b, self.o, self.names = b, o, names

    def i8(self):
        v = struct.unpack_from("<b", self.b, self.o)[0]; self.o += 1; return v

    def u8(self):
        v = self.b[self.o]; self.o += 1; return v

    def i16(self):
        v = struct.unpack_from("<h", self.b, self.o)[0]; self.o += 2; return v

    def u16(self):
        v = struct.unpack_from("<H", self.b, self.o)[0]; self.o += 2; return v

    def i32(self):
        v = struct.unpack_from("<i", self.b, self.o)[0]; self.o += 4; return v

    def u32(self):
        v = struct.unpack_from("<I", self.b, self.o)[0]; self.o += 4; return v

    def i64(self):
        v = struct.unpack_from("<q", self.b, self.o)[0]; self.o += 8; return v

    def u64(self):
        v = struct.unpack_from("<Q", self.b, self.o)[0]; self.o += 8; return v

    def f32(self):
        v = struct.unpack_from("<f", self.b, self.o)[0]; self.o += 4; return v

    def f64(self):
        v = struct.unpack_from("<d", self.b, self.o)[0]; self.o += 8; return v

    def guid(self):
        v = self.b[self.o:self.o + 16]; self.o += 16; return v.hex()

    def fstring(self):
        n = self.i32()
        if n == 0:
            return ""
        if n > 0:
            if n > 1 << 20:
                raise ParseError("string longa demais")
            s = self.b[self.o:self.o + n - 1].decode("latin-1")
            self.o += n
            return s
        n = -n
        if n > 1 << 20:
            raise ParseError("string longa demais")
        s = self.b[self.o:self.o + (n - 1) * 2].decode("utf-16-le", "replace")
        self.o += n * 2
        return s

    def fname(self):
        idx = self.i32()
        num = self.i32()
        if idx < 0 or idx >= len(self.names):
            raise ParseError("FName inválido %d" % idx)
        s = self.names[idx]
        return s if num == 0 else "%s_%d" % (s, num - 1)


class Package(object):
    _cache = {}

    @classmethod
    def open(cls, game_path):
        key = game_path.split(".")[0]
        if key in cls._cache:
            return cls._cache[key]
        fp = content_path(key)
        if not fp or not os.path.isfile(fp):
            cls._cache[key] = None
            return None
        pkg = cls(fp, key)
        cls._cache[key] = pkg
        return pkg

    def __init__(self, filepath, game_path=None):
        self.path = filepath
        self.game_path = game_path
        with open(filepath, "rb") as f:
            self.b = f.read()
        self._parse_summary()

    # ------------------------------------------------------------ cabeçalho
    def _parse_summary(self):
        r = Reader(self.b)
        if r.u32() != 0x9E2A83C1:
            raise ParseError("não é um pacote UE")
        legacy = r.i32()
        if legacy != -4:
            r.i32()
        self.ver = r.i32()
        r.i32()
        for _ in range(r.i32()):
            r.o += 20
        r.i32()                       # TotalHeaderSize
        r.fstring()                   # FolderName
        self.pkg_flags = r.u32()
        name_count, name_off = r.i32(), r.i32()
        if self.ver >= 516:
            r.fstring()               # LocalizationId
        if self.ver >= 459:
            r.i32(); r.i32()          # GatherableText
        exp_count, exp_off = r.i32(), r.i32()
        imp_count, imp_off = r.i32(), r.i32()
        # (o resto do summary não é necessário)

        # nomes
        r.o = name_off
        names = []
        for _ in range(name_count):
            names.append(r.fstring())
            if self.ver >= 504:
                r.o += 4
        self.names = names

        # imports
        r.names = names
        r.o = imp_off
        self.imports = []
        for _ in range(imp_count):
            class_pkg = r.fname()
            class_name = r.fname()
            outer = r.i32()
            obj = r.fname()
            if self.ver >= 520:
                r.fname()             # PackageName (editor)
            self.imports.append({"class_pkg": class_pkg, "class": class_name, "outer": outer, "name": obj})

        # exports
        r.o = exp_off
        self.exports = []
        for _ in range(exp_count):
            e = {}
            e["class_index"] = r.i32()
            e["super_index"] = r.i32()
            if self.ver >= 508:
                e["template_index"] = r.i32()
            e["outer"] = r.i32()
            e["name"] = r.fname()
            e["flags"] = r.u32()
            e["size"] = r.i64() if self.ver >= 511 else r.i32()
            e["offset"] = r.i64() if self.ver >= 511 else r.i32()
            r.o += 12                 # forced/notforclient/notforserver
            r.o += 16                 # PackageGuid
            r.u32()                   # PackageFlags
            if self.ver >= 365:
                r.i32()
            if self.ver >= 485:
                r.i32()
            if self.ver >= 507:
                r.o += 20
            self.exports.append(e)

    # ------------------------------------------------------------ referências
    def ref_name(self, index):
        if index == 0:
            return None
        if index < 0:
            return self.imports[-index - 1]["name"]
        return self.exports[index - 1]["name"]

    def ref_path(self, index):
        """Caminho completo de uma referência (import ou export)."""
        if index == 0:
            return None
        parts = []
        cur = index
        guard = 0
        while cur != 0 and guard < 32:
            guard += 1
            if cur < 0:
                imp = self.imports[-cur - 1]
                parts.append(imp["name"])
                cur = imp["outer"]
            else:
                exp = self.exports[cur - 1]
                parts.append(exp["name"])
                cur = exp["outer"]
                if cur == 0 and self.game_path:
                    parts.append(self.game_path)
        parts.reverse()
        if len(parts) == 1:
            return parts[0]
        return parts[0] + "." + ":".join(parts[1:])

    def ref_class(self, index):
        if index < 0:
            return self.imports[-index - 1]["class"]
        if index > 0:
            return self.ref_name(self.exports[index - 1]["class_index"])
        return None

    def export_class(self, e):
        return self.ref_name(e["class_index"])

    def find_export(self, name=None, cls=None):
        for e in self.exports:
            if (name is None or e["name"] == name) and (cls is None or self.export_class(e) == cls):
                return e
        return None

    # ------------------------------------------------------------ propriedades
    def read_export_props(self, e):
        r = Reader(self.b, e["offset"], self.names)
        end = e["offset"] + e["size"]
        props = self._read_tagged(r, end)
        return props, r.o

    def _read_tagged(self, r, end):
        out = {}
        while r.o < end:
            name = r.fname()
            if name == "None":
                break
            ptype = r.fname()
            size = r.i32()
            index = r.i32()
            info = {}
            if ptype == "StructProperty":
                info["struct"] = r.fname()
                if self.ver >= 441:
                    r.o += 16
            elif ptype == "BoolProperty":
                info["bool"] = r.u8()
            elif ptype in ("ByteProperty", "EnumProperty"):
                info["enum"] = r.fname()
            elif ptype in ("ArrayProperty", "SetProperty"):
                info["inner"] = r.fname()
            elif ptype == "MapProperty":
                info["inner"] = r.fname()
                info["value"] = r.fname()
            if self.ver >= 503:
                if r.u8():
                    r.o += 16
            start = r.o
            try:
                val = self._read_value(r, ptype, size, info, start + size)
            except Exception:
                val = {"_unparsed": ptype}
            r.o = start + size
            key = name if index == 0 else "%s[%d]" % (name, index)
            out[key] = val
        return out

    def _read_value(self, r, ptype, size, info, end):
        if ptype == "BoolProperty":
            return bool(info.get("bool"))
        if ptype == "IntProperty":
            return r.i32()
        if ptype == "Int8Property":
            return r.i8()
        if ptype == "Int16Property":
            return r.i16()
        if ptype == "Int64Property":
            return r.i64()
        if ptype == "UInt16Property":
            return r.u16()
        if ptype == "UInt32Property":
            return r.u32()
        if ptype == "UInt64Property":
            return r.u64()
        if ptype == "FloatProperty":
            return round(r.f32(), 6)
        if ptype == "DoubleProperty":
            return r.f64()
        if ptype == "ByteProperty":
            if info.get("enum", "None") == "None" or size == 1:
                return r.u8()
            return r.fname()
        if ptype == "EnumProperty":
            return r.fname()
        if ptype == "NameProperty":
            return r.fname()
        if ptype == "StrProperty":
            return r.fstring()
        if ptype == "TextProperty":
            return self._read_text(r)
        if ptype in ("ObjectProperty", "ClassProperty", "WeakObjectProperty", "LazyObjectProperty",
                     "InterfaceProperty"):
            return self.ref_path(r.i32())
        if ptype in ("SoftObjectProperty", "SoftClassProperty"):
            path = r.fname()
            sub = r.fstring()
            return path + (":" + sub if sub else "")
        if ptype == "StructProperty":
            return self._read_struct(r, info["struct"], end)
        if ptype == "ArrayProperty":
            return self._read_array(r, info["inner"], end)
        if ptype == "SetProperty":
            r.i32()                    # elementos removidos
            n = r.i32()
            return [self._read_inner(r, info["inner"], end, None) for _ in range(n)]
        if ptype == "MapProperty":
            nrem = r.i32()
            for _ in range(nrem):
                self._read_inner(r, info["inner"], end, None)
            n = r.i32()
            out = {}
            vector_vals = None   # valor struct sem nome: tagged; se falhar, Vector nativo (12 bytes)
            # chave enum de 1 byte (ByteProperty com enum) vem gravada como FName (8 bytes)
            byte_as_name = False
            if info["inner"] == "ByteProperty" and n and r.o + 8 <= end:
                idx, num = struct.unpack_from("<ii", r.b, r.o)
                byte_as_name = 0 <= idx < len(self.names) and 0 <= num < 64 and "::" in str(self.names[idx])
            for _ in range(n):
                k = r.fname() if byte_as_name else self._read_inner(r, info["inner"], end, None)
                if info["value"] == "StructProperty" and vector_vals is not False:
                    if vector_vals is None:
                        pos = r.o
                        try:
                            v = self._read_tagged(r, end)
                            vector_vals = False
                        except Exception:
                            r.o = pos
                            vector_vals = True
                    if vector_vals:
                        v = [round(x, 3) for x in struct.unpack_from("<3f", r.b, r.o)]
                        r.o += 12
                else:
                    v = self._read_inner(r, info["value"], end, None)
                out[str(k)] = v
            return out
        if ptype == "DelegateProperty":
            return None
        raise ParseError("tipo não suportado: " + ptype)

    def _read_inner(self, r, itype, end, struct_name):
        """Elemento de array/map/set (sem tag própria)."""
        if itype == "StructProperty":
            if struct_name:
                return self._read_struct(r, struct_name, end)
            # struct sem nome conhecido (map/set): tenta tagged
            return self._read_tagged(r, end)
        if itype == "BoolProperty":
            return bool(r.u8())
        if itype == "ByteProperty":
            return r.u8()
        if itype == "EnumProperty":
            return r.fname()
        return self._read_value(r, itype, 0, {}, end)

    def _read_array(self, r, inner, end):
        n = r.i32()
        if n < 0 or n > 1 << 20:
            raise ParseError("array inválido")
        if inner == "StructProperty":
            # tag do elemento
            r.fname(); r.fname(); r.i32(); r.i32()
            sname = r.fname()
            if self.ver >= 441:
                r.o += 16
            if self.ver >= 503 and r.u8():
                r.o += 16
            return [self._read_struct(r, sname, end) for _ in range(n)]
        if inner == "ByteProperty":
            # uint8 ou FName (enum): decide pelo tamanho restante
            remaining = end - r.o
            if n and remaining >= n * 8 and remaining != n:
                return [r.fname() for _ in range(n)]
            return [r.u8() for _ in range(n)]
        if inner == "BoolProperty":
            return [bool(r.u8()) for _ in range(n)]
        return [self._read_value(r, inner, 0, {}, end) for _ in range(n)]

    def _read_struct(self, r, sname, end):
        if sname in _NATIVE_STRUCTS:
            fmt = _NATIVE_STRUCTS[sname]
            v = struct.unpack_from(fmt, r.b, r.o)
            r.o += struct.calcsize(fmt)
            return [round(x, 6) if isinstance(x, float) else x for x in v]
        if sname == "Guid":
            return r.guid()
        if sname in ("SoftObjectPath", "SoftClassPath", "StringAssetReference"):
            path = r.fname()
            sub = r.fstring()
            return path + (":" + sub if sub else "")
        if sname == "GameplayTagContainer":
            n = r.i32()
            return [r.fname() for _ in range(n)]
        if sname == "GameplayTag":
            # serialização nativa em versões novas? em 4.27 é tagged
            pass
        if sname == "Box":
            v = struct.unpack_from("<6fB", r.b, r.o); r.o += 25
            return list(v)
        if sname == "Box2D":
            v = struct.unpack_from("<4fB", r.b, r.o); r.o += 17
            return list(v)
        if sname == "PerPlatformFloat":
            r.i32()
            return r.f32()
        if sname == "PerPlatformInt":
            r.i32()
            return r.i32()
        return self._read_tagged(r, end)

    def _read_text(self, r):
        flags = r.u32()
        htype = r.i8()
        if htype == -1:
            if r.i32():
                return r.fstring()
            return ""
        if htype == 0:                # Base: namespace, key, source
            ns = r.fstring()
            key = r.fstring()
            src = r.fstring()
            return {"text": src, "key": key, "ns": ns}
        if htype == 11:               # StringTableEntry
            table = r.fname()
            key = r.fstring()
            return {"table": table, "key": key}
        if htype in (1, 2):           # NamedFormat / OrderedFormat
            src = self._read_text(r)
            return {"format": src}
        return {"text_history": htype}

    # ------------------------------------------------------------ alto nível
    def cdo(self, inherit=True, _depth=0):
        """Propriedades do objeto padrão de um Blueprint (com herança de pais em /Game)."""
        exp = None
        for e in self.exports:
            if e["name"].startswith("Default__"):
                exp = e
                break
        if exp is None:
            return None
        props, _ = self.read_export_props(exp)
        if inherit and _depth < 12:
            parent = self.parent_class_path()
            if parent and parent.startswith("/Game/"):
                ppkg = Package.open(parent)
                if ppkg is not None:
                    base = ppkg.cdo(True, _depth + 1) or {}
                    merged = dict(base)
                    merged.update(props)
                    props = merged
        return props

    def generated_class(self):
        for e in self.exports:
            if self.export_class(e) in ("BlueprintGeneratedClass", "WidgetBlueprintGeneratedClass",
                                        "AnimBlueprintGeneratedClass"):
                return e
        return None

    def parent_class_path(self):
        gc = self.generated_class()
        if gc is None or gc["super_index"] == 0:
            return None
        return self.ref_path(gc["super_index"])

    def native_parent(self, _depth=0):
        """Primeira classe C++ na hierarquia (ex.: 'HDaoJuBase')."""
        parent = self.parent_class_path()
        if not parent:
            return None
        if parent.startswith("/Script/"):
            return parent.split(".")[-1]
        if _depth > 12:
            return None
        ppkg = Package.open(parent)
        return ppkg.native_parent(_depth + 1) if ppkg else parent

    def datatable_rows(self):
        exp = None
        for e in self.exports:
            if self.export_class(e) in ("DataTable", "CompositeDataTable"):
                exp = e
                break
        if exp is None:
            return None
        props, pos = self.read_export_props(exp)
        end = exp["offset"] + exp["size"]
        # depois das propriedades pode haver um int32 (bHasGuid) antes do número de linhas
        for skip in (4, 0, 8):
            r = Reader(self.b, pos + skip, self.names)
            try:
                n = r.i32()
                if n < 0 or n > 200000:
                    continue
                rows = {}
                for _ in range(n):
                    rn = r.fname()
                    rows[rn] = self._read_tagged(r, end)
                if r.o <= end:
                    return rows
            except Exception:
                continue
        raise ParseError("não consegui ler as linhas da DataTable " + str(self.game_path))

    def row_struct(self):
        exp = self.find_export(cls="DataTable")
        if not exp:
            return None
        props, _ = self.read_export_props(exp)
        return props.get("RowStruct")


if __name__ == "__main__":
    import json, sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    p = Package.open(sys.argv[1])
    if p is None:
        print("não encontrado"); sys.exit(1)
    mode = sys.argv[2] if len(sys.argv) > 2 else "auto"
    if mode == "exports":
        for e in p.exports:
            print(p.export_class(e), e["name"], e["size"])
    elif mode == "dt":
        rows = p.datatable_rows()
        print(len(rows), "linhas")
        for k in list(rows)[: int(sys.argv[3]) if len(sys.argv) > 3 else 2]:
            print(k, json.dumps(rows[k], ensure_ascii=False)[:3000])
    else:
        print("parent:", p.parent_class_path(), "| native:", p.native_parent())
        print(json.dumps(p.cdo(), ensure_ascii=False, indent=1)[:6000])
