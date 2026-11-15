import struct, re, json, sys
P = r'C:\Program Files\Epic Games\SoulMaskModkit\Projects\WS\Binaries\Win64\UE4Editor-WS.dll'
d = open(P, 'rb').read()
pe = struct.unpack_from('<I', d, 0x3c)[0]
nsec = struct.unpack_from('<H', d, pe + 6)[0]
optsz = struct.unpack_from('<H', d, pe + 20)[0]
base = struct.unpack_from('<Q', d, pe + 24 + 24)[0]
secs = []
o = pe + 24 + optsz
for i in range(nsec):
    name = d[o:o + 8].rstrip(b'\0').decode()
    vsz, va, rsz, raw = struct.unpack_from('<IIII', d, o + 8)
    secs.append((name, va, vsz, raw, rsz))
    o += 40

def off2va(off):
    for n, va, vsz, raw, rsz in secs:
        if raw <= off < raw + rsz:
            return base + va + off - raw
def va2off(v):
    r = v - base
    for n, va, vsz, raw, rsz in secs:
        if va <= r < va + rsz:
            return raw + r - va
def cstr(v):
    o = va2off(v)
    if o is None: return None
    e = d.find(b'\0', o, o + 600)
    if e < 0: return None
    try: return d[o:e].decode('utf-8')
    except Exception: return None

# metadata pair arrays: look for qword pointing to "ModuleRelativePath"
mrp_off = d.find(b'ModuleRelativePath\x00')
mrp_vas = []
for m in re.finditer(rb'ModuleRelativePath\x00', d):
    mrp_vas.append(off2va(m.start()))
hdr = off2va(d.find(b'Misc/HCheatManager.h\x00'))
pk_mrp = set(struct.pack('<Q', v) for v in mrp_vas)
pk_hdr = struct.pack('<Q', hdr)
# find pair (ptr ModuleRelativePath, ptr hdr)
pairs = []
for v in mrp_vas:
    pat = struct.pack('<Q', v)
    for m in re.finditer(re.escape(pat), d):
        if m.start() % 8 == 0: pairs.append(m.start())
print('pairs', len(pairs), file=sys.stderr)
# each metadata array: scan backwards/forwards in 16-byte steps while key strings valid
arrays = {}
for p in pairs:
    s = p
    prev = 'ModuleRelativePath'
    while True:
        k = cstr(struct.unpack_from('<Q', d, s - 16)[0]) if s >= 16 else None
        if k and k < prev and k in ('Comment', 'ToolTip', 'Category', 'CPP_Default_Value', 'ModuleRelativePath', 'BlueprintInternalUseOnly', 'DisplayName', 'Keywords', 'ShortToolTip') or (k and k.startswith('CPP_Default_')):
            s -= 16; prev = k
        else:
            break
    e = p + 16
    prev = 'ModuleRelativePath'
    while True:
        k = cstr(struct.unpack_from('<Q', d, e)[0])
        if k and k > prev and k in ('Comment', 'ToolTip', 'Category', 'ModuleRelativePath', 'DisplayName', 'Keywords') or (k and k.startswith('CPP_Default_')):
            e += 16; prev = k
        else:
            break
    md = {}
    for q in range(s, e, 16):
        k = cstr(struct.unpack_from('<Q', d, q)[0]); val = cstr(struct.unpack_from('<Q', d, q + 8)[0])
        md[k] = val
    arrays[off2va(s)] = ((e - s) // 16, md)
print('arrays', len(arrays), file=sys.stderr)
# find FFunctionParams referencing metadata arrays: qword ptr arr followed by int count
funcs = []
for va, (n, md) in arrays.items():
    pat = struct.pack('<Q', va)
    for m in re.finditer(re.escape(pat), d):
        q = m.start()
        # search backwards for name pointer (NameUTF8) within 96 bytes
        name = None
        for back in range(8, 104, 8):
            v = struct.unpack_from('<Q', d, q - back)[0]
            s = cstr(v) if base < v < base + 0x10000000 else None
            if s and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', s) and s not in ('UHCheatManager',):
                name = (back, s)
                break
        b = q - 72
        props = []
        if name and name[0] == 56:
            parr, nprop = struct.unpack_from('<QI', d, b + 48)
            fflags = struct.unpack_from('<I', d, b + 64)[0]
            po = va2off(parr) if parr else None
            for i in range(nprop if po else 0):
                pp = va2off(struct.unpack_from('<Q', d, po + 8 * i)[0])
                pn = cstr(struct.unpack_from('<Q', d, pp)[0])
                pflags = struct.unpack_from('<Q', d, pp + 16)[0]
                gen = struct.unpack_from('<I', d, pp + 24)[0] & 0x3f
                props.append((pn, gen, pflags))
        else:
            fflags = 0
        funcs.append((name, md, props, fflags))
out = []
for name, md, props, ff in funcs:
    out.append({'hdr': md.get('ModuleRelativePath'), 'params': props, 'flags': ff, 'name': name[1] if name else None, 'back': name[0] if name else None, 'tip': md.get('ToolTip') or md.get('Comment'), 'cat': md.get('Category'), 'meta': md})
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), file=sys.stderr)
