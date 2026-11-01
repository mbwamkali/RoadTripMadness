#!/usr/bin/env python3
"""
Fetches the CC0 low-poly models the game uses (Quaternius packs, shared from
public Google Drive folders) and converts each to a small binary glTF (.glb)
in public/models/: one mesh, flat-shaded triangles (no normals: the game uses flatShading) with per-vertex colours baked from the
material colours (or sampled from the texture), so every model draws in a
single call and can be instanced.

    python3 scripts/build-models.py            # downloads into data-src/models/
    python3 scripts/build-models.py --offline  # convert what is already there

Needs Python 3 and Pillow (only for textured models). Credits: docs/CREDITS.md.
"""
import html
import json
import math
import os
import re
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data-src', 'models')
OUT = os.path.join(ROOT, 'public', 'models')

# Quaternius packs (all CC0): https://quaternius.com
PACKS = {
    'cars': '1fKlbDry77iY8KlEoxzUxIAZQL_XhzWlA',  # Cars
    'zombie': '1AfOPRgr5Gl8gll9KfGDEUSYq_Ag7yPJG',  # Animated Zombie
    'nature': '1-Kl0L_Jg8awbh0S5T-z3zxh4mVlnxTpa',  # Ultimate Nature
    'simplebuildings': '1r-FcNFxC6ziN0oI3GqZJdEkdzglFQHQH',  # Simple Buildings
}

# output name: (pack, OBJ base name, optional texture file)
MODELS = {
    # Traffic
    'car-sedan': ('cars', 'NormalCar1', None),
    'car-hatch': ('cars', 'NormalCar2', None),
    'car-suv': ('cars', 'SUV', None),
    'car-taxi': ('cars', 'Taxi', None),
    'car-cop': ('cars', 'Cop', None),
    'car-sports': ('cars', 'SportsCar', None),
    # Town buildings (textures sampled into vertex colours)
    'shop': ('simplebuildings', 'Shop', 'Shop.png'),
    'flat-1': ('simplebuildings', 'Flat', 'Hotel.png'),
    'flat-2': ('simplebuildings', 'Flat2', 'Hotel.png'),
    'hospital': ('simplebuildings', 'Hospital', 'Hotel.png'),
    'house-1': ('simplebuildings', 'House', 'HouseTexture1.png'),
    'house-2': ('simplebuildings', 'House2', 'HouseTexture2.png'),
    'house-3': ('simplebuildings', 'House3', 'HouseTexture3.png'),
    'house-4': ('simplebuildings', 'House4', 'HouseTexture4.png'),
    'house-5': ('simplebuildings', 'House5', 'HouseTexture1.png'),
    # Enemies
    'zombie': ('zombie', 'Zombie', 'ZombieTexture.png'),
    # Plants and rocks
    'oak-1': ('nature', 'CommonTree_1', None),
    'oak-2': ('nature', 'CommonTree_2', None),
    'oak-3': ('nature', 'CommonTree_3', None),
    'tree-dead': ('nature', 'CommonTree_Dead_1', None),
    'pine-1': ('nature', 'PineTree_1', None),
    'pine-2': ('nature', 'PineTree_3', None),
    'palm-1': ('nature', 'PalmTree_1', None),
    'palm-2': ('nature', 'PalmTree_3', None),
    'cactus-1': ('nature', 'Cactus_1', None),
    'cactus-2': ('nature', 'Cactus_3', None),
    'cactus-3': ('nature', 'Cactus_4', None),
    'bush-1': ('nature', 'Bush_1', None),
    'bush-2': ('nature', 'BushBerries_1', None),
    'grass': ('nature', 'Grass', None),
    'corn': ('nature', 'Corn_1', None),
    'wheat': ('nature', 'Wheat', None),
    'rock-1': ('nature', 'Rock_1', None),
    'rock-2': ('nature', 'Rock_3', None),
    'rock-3': ('nature', 'Rock_5', None),
}


def drive_list(folder):
    """Files in a public Drive folder, recursively: {path: id}."""
    page = subprocess.run(['curl', '-sL', '-m', '60', f'https://drive.google.com/embeddedfolderview?id={folder}'], capture_output=True, text=True).stdout
    out = {}
    for m in re.finditer(r'id="entry-([A-Za-z0-9_-]+)".*?flip-entry-title">([^<]+)', page, re.S):
        fid, name = m.group(1), html.unescape(m.group(2))
        if re.search(r'\.[A-Za-z0-9]{2,5}$', name):
            out[name] = fid
        else:
            for k, v in drive_list(fid).items():
                out[f'{name}/{k}'] = v
    return out


def download(fid, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(['curl', '-sfL', '-m', '120', f'https://drive.usercontent.google.com/download?id={fid}&export=download', '-o', dest], check=True)


def fetch():
    for pack, folder in PACKS.items():
        wanted = {base for p, base, _ in MODELS.values() if p == pack}
        textures = {t for p, _, t in MODELS.values() if p == pack and t}
        files = drive_list(folder)
        for path, fid in files.items():
            name = path.split('/')[-1]
            stem, ext = os.path.splitext(name)
            keep = (path.startswith('OBJ/') and stem in wanted and ext in ('.obj', '.mtl')) or name in textures or path.startswith('Textures/') or name.lower() == 'license.txt'
            dest = os.path.join(SRC, pack, name)
            if keep and not os.path.exists(dest):
                print('fetch', pack, path)
                download(fid, dest)


def parse_mtl(path):
    mats, cur = {}, None
    if not os.path.exists(path):
        return mats
    for line in open(path, encoding='utf8', errors='replace'):
        p = line.split()
        if not p:
            continue
        if p[0] == 'newmtl':
            cur = ' '.join(p[1:])
            mats[cur] = {'kd': (0.8, 0.8, 0.8)}
        elif p[0] == 'Kd' and cur:
            mats[cur]['kd'] = tuple(float(x) for x in p[1:4])
        elif p[0] == 'map_Kd' and cur:
            mats[cur]['map'] = p[-1]
    return mats


def srgb_byte(c):
    # MTL colours are linear in Blender exports; glTF vertex colours are linear too.
    return max(0, min(255, round(c * 255)))


def convert(name, pack, base, tex):
    obj = os.path.join(SRC, pack, base + '.obj')
    mats = parse_mtl(os.path.join(SRC, pack, base + '.mtl'))
    image = None
    tex = tex or next((os.path.basename(m['map'].replace('\\', '/')) for m in mats.values() if 'map' in m), None)
    if tex and os.path.exists(os.path.join(SRC, pack, tex)):
        from PIL import Image
        image = Image.open(os.path.join(SRC, pack, tex)).convert('RGB')
    vs, vts, vns = [], [], []
    tris = []  # (v, vt, vn, colour) * 3
    color = (204, 204, 204)
    use_tex = False
    for line in open(obj, encoding='utf8', errors='replace'):
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            vs.append(tuple(float(x) for x in p[1:4]))
        elif p[0] == 'vt':
            vts.append(tuple(float(x) for x in p[1:3]))
        elif p[0] == 'vn':
            vns.append(tuple(float(x) for x in p[1:4]))
        elif p[0] == 'usemtl':
            m = mats.get(' '.join(p[1:]), {'kd': (0.8, 0.8, 0.8)})
            color = tuple(srgb_byte(c) for c in m['kd'])
            use_tex = image is not None
        elif p[0] == 'f':
            corners = []
            for c in p[1:]:
                idx = (c.split('/') + ['', ''])[:3]
                v = int(idx[0]) - 1 if int(idx[0]) > 0 else len(vs) + int(idx[0])
                vt = (int(idx[1]) - 1) if idx[1] else None
                vn = (int(idx[2]) - 1) if idx[2] else None
                corners.append((v, vt, vn))
            for i in range(1, len(corners) - 1):
                tri = [corners[0], corners[i], corners[i + 1]]
                col = color
                if use_tex and all(t[1] is not None for t in tri):
                    # One colour per triangle, sampled at its UV centre: flat-shaded low-poly style.
                    u = sum(vts[t[1]][0] for t in tri) / 3
                    v = sum(vts[t[1]][1] for t in tri) / 3
                    w, h = image.size
                    col = image.getpixel((min(w - 1, int((u % 1) * w)), min(h - 1, int((1 - v % 1) * h))))
                    # Texture colours are sRGB; store linear.
                    col = tuple(srgb_byte((c / 255) ** 2.2) for c in col)
                tris.append([(t[0], t[2], col) for t in tri])
    # Flat normals where the file has none; dedupe identical corners into an index.
    positions, normals, colors, index, seen = [], [], [], [], {}
    for tri in tris:
        a, b, c = (vs[t[0]] for t in tri)
        e1 = [b[i] - a[i] for i in range(3)]
        e2 = [c[i] - a[i] for i in range(3)]
        n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        ln = math.sqrt(sum(x * x for x in n)) or 1
        flat = tuple(x / ln for x in n)
        for v, vn, col in tri:
            nn = flat
            key = (v, col)
            if key not in seen:
                seen[key] = len(positions)
                positions.append(vs[v])
                normals.append(nn)
                colors.append(col)
            index.append(seen[key])
    write_glb(os.path.join(OUT, name + '.glb'), positions, normals, colors, index)
    return len(tris), len(positions)


def write_glb(path, positions, normals, colors, index):
    n = len(positions)
    big = n > 65535
    pos = b''.join(struct.pack('<3f', *p) for p in positions)
    nor = b''
    col = b''.join(struct.pack('<4B', c[0], c[1], c[2], 255) for c in colors)
    idx = b''.join(struct.pack('<I' if big else '<H', i) for i in index)
    pad = lambda b: b + b'\0' * (-len(b) % 4)
    chunks = [pad(pos), pad(col), pad(idx)]
    offsets, o = [], 0
    for c in chunks:
        offsets.append(o)
        o += len(c)
    binary = b''.join(chunks)
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    gltf = {
        'asset': {'version': '2.0', 'generator': 'road-trip-madness build-models.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'COLOR_0': 1}, 'indices': 2, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': offsets[0], 'byteLength': len(pos), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[1], 'byteLength': len(col), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[2], 'byteLength': len(idx), 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': mins, 'max': maxs},
            {'bufferView': 1, 'componentType': 5121, 'normalized': True, 'count': n, 'type': 'VEC4'},
            {'bufferView': 2, 'componentType': 5125 if big else 5123, 'count': len(index), 'type': 'SCALAR'},
        ],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


if __name__ == '__main__':
    if '--offline' not in sys.argv:
        fetch()
    total = 0
    for name, (pack, base, tex) in MODELS.items():
        tris, verts = convert(name, pack, base, tex)
        size = os.path.getsize(os.path.join(OUT, name + '.glb'))
        total += size
        print(f'{name:12s} {tris:6d} tris {verts:6d} verts {size / 1024:7.1f} KB')
    print(f'total {total / 1024:.0f} KB')
