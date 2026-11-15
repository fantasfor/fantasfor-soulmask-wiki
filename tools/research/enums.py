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
    vsz, va, rsz, raw = struct.unpack_from('<IIII', d, o + 8)
    secs.append((va, vsz, raw, rsz)); o += 40
def off2va(off):
    for va, vsz, raw, rsz in secs:
        if raw <= off < raw + rsz: return base + va + off - raw
out = {}
for en in sys.argv[2:]:
    vals = {}
    for m in re.finditer(re.escape(en.encode()) + rb'::([A-Za-z0-9_]+)\x00', d):
        v = off2va(m.start())
        pat = struct.pack('<Q', v)
        for mm in re.finditer(re.escape(pat), d):
            if mm.start() % 8: continue
            val = struct.unpack_from('<q', d, mm.start() + 8)[0]
            if 0 <= val < 100000:
                vals[m.group(1).decode()] = val
                break
    out[en] = vals
json.dump(out, open(sys.argv[1], 'w'), indent=0)
for k, v in out.items():
    print(k, len(v), sorted(v.items(), key=lambda x: x[1])[:200])
