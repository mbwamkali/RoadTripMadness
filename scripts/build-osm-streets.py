#!/usr/bin/env python3
"""Builds the game's local street squares from OpenStreetMap.

usage: python3 scripts/build-osm-streets.py <streets-XX.osm.pbf ...> <out_dir> [--index index.json]

Input: state extracts cut down by scripts/fetch-osm-roads.sh to streets
(trunk, primary, secondary, tertiary, unclassified, residential,
living_street and their links; motorway links only to find junctions)
and the places a town stop can have.
Output: <out_dir>/<x>_<y>.bin, one file per TILE_DEG square
(x = floor(lng / TILE_DEG), y = floor(lat / TILE_DEG)), gzip-compressed.
With --index, the road build's index.json gets a "streets" entry so the
game knows the squares exist.

The game reads a square at each end of a trip (src/geo/streetTiles.ts)
instead of asking a public Overpass server, which was too slow or refused.
Points every way shares with another way are kept exactly (the same
integer coordinates as the highway files), so streets join the highways;
the rest are simplified to about SIMPLIFY_M. In dense city blocks (more
than DENSE_KM of side streets in a ~1 km cell) side streets are left out,
so big cities keep their main roads and small towns keep every street.

Square format (all integers are unsigned LEB128 varints; signed ones are
zigzag-encoded), version 2, gzip on top:

  magic 'RTS1'
  varint tileX + 1000, tileY + 1000, q / 1000
  varint stringCount, then each string: varint byteLength, UTF-8 bytes
         (names and route numbers in one table, most used first)
  varint wayCount
  ways, column by column so like values sit together:
    class*2 + oneway      class: 1 trunk 2 primary 3 secondary 4 tertiary 5 minor
    nameIndex + 1         0 = no name
    refIndex + 1          0 = no route number
    speedKmh              0 = not tagged
    lanes                 0 = not tagged
    pointCount
    points: the first point of each way relative to the previous way's
            first point (the square's corner for the first), then each
            point relative to the one before; x then y, zigzag.
  version 2 adds the places a town stop can have (gas, garage, grocery,
  hardware, gun shop, pharmacy, police, junkyard, barn, motel):
  varint placeCount, then kind (index in PLACE_KINDS) for each, nameIndex + 1
  for each, then each point relative to the one before (the corner first).

The data is from OpenStreetMap and must stay under the ODbL; see
https://www.openstreetmap.org/copyright.
"""
import argparse
import gzip
import json
import marshal
import shutil
import math
import os
import sys
from array import array
from collections import Counter

import numpy as np  # pass 1 only: counting shared points
import osmium

Q = 100_000  # same as build-osm-roads.py, so shared points line up exactly
TILE_DEG = 0.25
SIMPLIFY_M = 15  # side streets bend more often than highways; 15 m keeps their shape
# Side streets are dropped from a DENSE_CELL x DENSE_CELL degree square (about 1 km) holding more than DENSE_KM of them.
DENSE_CELL = 0.01
DENSE_KM = 8.0
CLASS = {
    'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2,
    'secondary': 3, 'secondary_link': 3, 'tertiary': 4, 'tertiary_link': 4,
    'unclassified': 5, 'residential': 5, 'living_street': 5,
}
# Places a town stop can have, in the game's order (src/game/stops.ts PlaceKind).
PLACE_KINDS = ['pumps', 'garage', 'grocery', 'hardware', 'gunshop', 'pharmacy', 'police', 'junkyard', 'barn', 'motel']


def place_kind(t):
    """Which town place an OpenStreetMap object is (same rules as placeKindOf in src/town/layout.ts), or None."""
    a, sh = t.get('amenity'), t.get('shop')
    if a == 'fuel':
        return 'pumps'
    if a == 'police':
        return 'police'
    if a == 'pharmacy' or sh == 'chemist':
        return 'pharmacy'
    if sh in ('car_repair', 'tyres') or t.get('craft') == 'car_repair':
        return 'garage'
    if sh in ('hardware', 'doityourself'):
        return 'hardware'
    if sh in ('supermarket', 'convenience', 'grocery', 'general'):
        return 'grocery'
    if sh in ('hunting', 'outdoor', 'weapons'):
        return 'gunshop'
    if t.get('tourism') in ('motel', 'hotel', 'guest_house'):
        return 'motel'
    if t.get('industrial') == 'scrap_yard':
        return 'junkyard'
    if (t.get('landuse') == 'farmyard' and 'name' in t) or sh == 'farm':
        return 'barn'
    return None


# Only counted, so their junctions with streets are kept; not written.
COUNT_ONLY = {'motorway', 'motorway_link'}


def usable(t) -> bool:
    return t.get('access') not in ('private', 'no') and t.get('area') != 'yes'


class Counts(osmium.SimpleHandler):
    """Pass 1: every node id used by a way (ends twice), to find shared points."""

    def __init__(self):
        super().__init__()
        self.ids = array('q')

    def way(self, w):
        hw = w.tags.get('highway')
        if (hw in CLASS and usable(w.tags)) or hw in COUNT_ONLY:
            refs = [n.ref for n in w.nodes]
            if len(refs) >= 2:
                self.ids.extend(refs)
                self.ids.append(refs[0])
                self.ids.append(refs[-1])


def parse_speed(v: str) -> int:
    v = (v or '').strip()
    try:
        if v.endswith('mph'):
            return round(float(v[:-3]) * 1.609344)
        for suf in ('km/h', 'kmh'):
            if v.endswith(suf):
                v = v[: -len(suf)]
        return round(float(v))
    except ValueError:
        return 0


def parse_lanes(v: str) -> int:
    try:
        n = int((v or '').split(';')[0])
    except ValueError:
        return 0
    return n if 0 < n < 20 else 0


def simplify(pts, keep, tol):
    """Douglas-Peucker between kept points. pts are (x, y) in 1/Q degrees, scaled for latitude by the caller."""
    out = [0]
    start = 0
    for i in range(1, len(pts)):
        if keep[i] or i == len(pts) - 1:
            _dp(pts, start, i, tol, out)
            out.append(i)
            start = i
    return out


def _dp(pts, a, b, tol, out):
    if b - a < 2:
        return
    ax, ay = pts[a]
    bx, by = pts[b]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1e-9
    best, bi = -1.0, -1
    for i in range(a + 1, b):
        px, py = pts[i]
        d = abs(dy * (px - ax) - dx * (py - ay)) / L
        if d > best:
            best, bi = d, i
    if best > tol:
        _dp(pts, a, bi, tol, out)
        out.append(bi)
        _dp(pts, bi, b, tol, out)


class Ways(osmium.SimpleHandler):
    """Pass 2: simplified ways, sorted into squares."""

    def __init__(self, shared, recs, seen):
        super().__init__()
        self.shared = shared
        self.recs = recs
        self.seen = seen
        self.count = 0

    def place(self, kind, oid, name, lon, lat):
        key = hash(('place', oid))
        if key in self.seen:
            return
        self.seen.add(key)
        # A place is stored like a way with one point and a negative kind (see encode).
        self.recs.append((-1 - PLACE_KINDS.index(kind), name[:28], '', 0, 0, [(round(lon * Q), round(lat * Q))]))

    def node(self, n):
        kind = place_kind(n.tags)
        if kind:
            self.place(kind, ('n', n.id), n.tags.get('name') or n.tags.get('brand') or '', n.location.lon, n.location.lat)

    def way(self, w):
        t = w.tags
        c = CLASS.get(t.get('highway'))
        if c is None:
            kind = place_kind(t)
            if kind:
                try:
                    pts = [(n.lon, n.lat) for n in w.nodes]
                except osmium.InvalidLocationError:
                    return
                if pts:
                    self.place(kind, ('w', w.id), t.get('name') or t.get('brand') or '', sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            return
        if not usable(t):
            return
        try:
            nodes = [(n.ref, n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(nodes) < 2:
            return
        # A road crossing a state line is in both state files; skip exact repeats.
        key = hash((w.id, nodes[0][0], nodes[-1][0], len(nodes)))
        if key in self.seen:
            return
        self.seen.add(key)
        oneway = t.get('oneway', '')
        if oneway == '-1':
            nodes.reverse()
        ow = oneway in ('yes', '1', 'true', '-1') or t.get('junction') in ('roundabout', 'circular')
        shared = self.shared
        keep = [n[0] in shared for n in nodes]
        keep[0] = keep[-1] = True
        q = [(round(n[1] * Q), round(n[2] * Q)) for n in nodes]
        k = math.cos(math.radians(nodes[0][2]))
        scaled = [(x * k, y) for x, y in q]
        tol = SIMPLIFY_M / 111_320 * Q
        idx = simplify(scaled, keep, tol)
        pts = [q[i] for i in idx]
        # Drop repeats (two nodes on the same metre).
        clean = [pts[0]]
        for p in pts[1:]:
            if p != clean[-1]:
                clean.append(p)
        if len(clean) < 2:
            return
        rec = (c * 2 + (1 if ow else 0), t.get('name', ''), t.get('ref', ''), parse_speed(t.get('maxspeed', '')), parse_lanes(t.get('lanes', '')), clean)
        self.recs.append(rec)
        self.count += 1


def way_km(pts) -> float:
    k = math.cos(math.radians(pts[0][1] / Q))
    return sum(math.hypot((b[0] - a[0]) * k, b[1] - a[1]) for a, b in zip(pts, pts[1:])) / Q * 111.32


def thin_dense(recs, dense_km):
    """
    Drops side streets (class 5) in city blocks packed with them: where a
    DENSE_CELL square holds more than dense_km of side streets, only the
    bigger roads stay. Small towns and the countryside keep every street.
    """
    cells = Counter()
    where = []
    for r in recs:
        if r[0] // 2 == 5:
            mid = r[5][len(r[5]) // 2]
            cell = (math.floor(mid[0] / (DENSE_CELL * Q)), math.floor(mid[1] / (DENSE_CELL * Q)))
            cells[cell] += way_km(r[5])
            where.append(cell)
        else:
            where.append(None)
    kept = [r for r, cell in zip(recs, where) if cell is None or cells[cell] <= dense_km]
    return kept, cells


def add_to_tiles(recs, tiles):
    span = TILE_DEG * Q
    for rec in recs:
        xs = [p[0] for p in rec[5]]
        ys = [p[1] for p in rec[5]]
        for tx in range(math.floor(min(xs) / span), math.floor(max(xs) / span) + 1):
            for ty in range(math.floor(min(ys) / span), math.floor(max(ys) / span) + 1):
                tiles.setdefault((tx, ty), []).append(rec)


def uvarint(n: int, out: bytearray):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zz(n: int) -> int:
    return (n << 1) if n >= 0 else ((-n << 1) - 1)


def encode(tx: int, ty: int, recs) -> bytes:
    places = sorted((r for r in recs if r[0] < 0), key=lambda r: (r[5][0][1], r[5][0][0]))
    recs = [r for r in recs if r[0] >= 0]
    # Ways in a sweep order, so each first point is near the last one.
    recs = sorted(recs, key=lambda r: (r[5][0][1] // 500, r[5][0][0] if (r[5][0][1] // 500) % 2 == 0 else -r[5][0][0]))
    use = Counter()
    for r in recs + places:
        if r[1]:
            use[r[1]] += 1
        if r[2]:
            use[r[2]] += 1
    strings = [s for s, _ in use.most_common()]
    six = {s: i for i, s in enumerate(strings)}
    out = bytearray(b'RTS1')
    for v in (tx + 1000, ty + 1000, Q // 1000, len(strings)):
        uvarint(v, out)
    for s in strings:
        b = s.encode('utf-8')
        uvarint(len(b), out)
        out += b
    uvarint(len(recs), out)
    for r in recs:
        uvarint(r[0], out)
    for r in recs:
        uvarint(six[r[1]] + 1 if r[1] else 0, out)
    for r in recs:
        uvarint(six[r[2]] + 1 if r[2] else 0, out)
    for r in recs:
        uvarint(r[3], out)
    for r in recs:
        uvarint(r[4], out)
    for r in recs:
        uvarint(len(r[5]), out)
    span = round(TILE_DEG * Q)
    px, py = tx * span, ty * span
    for r in recs:
        pts = r[5]
        uvarint(zz(pts[0][0] - px), out)
        uvarint(zz(pts[0][1] - py), out)
        px, py = pts[0]
        x, y = pts[0]
        for p in pts[1:]:
            uvarint(zz(p[0] - x), out)
            uvarint(zz(p[1] - y), out)
            x, y = p
    # Version 2: the town places after the ways.
    uvarint(len(places), out)
    for r in places:
        uvarint(-1 - r[0], out)
    for r in places:
        uvarint(six[r[1]] + 1 if r[1] else 0, out)
    px, py = tx * span, ty * span
    for r in places:
        x, y = r[5][0]
        uvarint(zz(x - px), out)
        uvarint(zz(y - py), out)
        px, py = x, y
    return gzip.compress(bytes(out), compresslevel=9, mtime=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--dense-km', type=float, default=DENSE_KM, help='side streets per ~1 km cell before a cell keeps only bigger roads')
    ap.add_argument('--stats', action='store_true')
    ap.add_argument('--index', help="the road build's index.json, to add a streets entry to")
    args = ap.parse_args()
    *pbfs, out_dir = args.inputs
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(out_dir, '.parts')
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    squares = set()
    seen = set()
    total_ways = 0
    for f in pbfs:
        c = Counts()
        c.apply_file(f)
        ids, n = np.unique(np.frombuffer(c.ids, dtype=np.int64), return_counts=True)
        shared = set(ids[n > 1].tolist())
        del c, ids, n
        recs = []
        h = Ways(shared, recs, seen)
        h.apply_file(f, locations=True, idx='flex_mem')
        del shared
        if args.stats:
            _, cells = thin_dense(recs, 1e9)
            v = sorted(cells.values())
            print('side-street km per cell: ' + ', '.join(f'p{p} {v[int(len(v) * p / 100) - 1]:.1f}' for p in (50, 75, 90, 95, 99, 100)), file=sys.stderr)
            for km in (6, 8, 10, 12, 15, 20):
                kept, _ = thin_dense(recs, km)
                print(f'  limit {km} km: drops {len(recs) - len(kept):,} of {len(recs):,} ways', file=sys.stderr)
        kept, _ = thin_dense(recs, args.dense_km)
        # Squares cross state lines, so each state's part goes to disk and squares are written at the end.
        tiles = {}
        add_to_tiles(kept, tiles)
        for key, part in tiles.items():
            with open(os.path.join(work, f'{key[0]}_{key[1]}.part'), 'ab') as fh:
                marshal.dump(part, fh)
        squares.update(tiles)
        tiles = None
        total_ways += len(kept)
        print(f'{os.path.basename(f)}: {len(kept):,} ways kept of {len(recs):,}, {len(squares):,} squares so far', file=sys.stderr, flush=True)
        del recs, kept
    sizes = []
    for tx, ty in sorted(squares):
        recs = []
        with open(os.path.join(work, f'{tx}_{ty}.part'), 'rb') as fh:
            while True:
                try:
                    recs.extend(marshal.load(fh))
                except EOFError:
                    break
        data = encode(tx, ty, recs)
        with open(os.path.join(out_dir, f'{tx}_{ty}.bin'), 'wb') as fh:
            fh.write(data)
        sizes.append(len(data))
    shutil.rmtree(work)
    sizes.sort()
    total = sum(sizes)
    print(f'streets: {len(sizes):,} squares, {total / 1e6:.1f} MB, median {sizes[len(sizes) // 2] / 1e3:.0f} KB, '
          f'p90 {sizes[int(len(sizes) * 0.9)] / 1e3:.0f} KB, max {sizes[-1] / 1e3:.0f} KB, {total_ways:,} ways', file=sys.stderr)
    if args.index:
        with open(args.index) as fh:
            index = json.load(fh)
        index['streets'] = {'dir': os.path.basename(os.path.normpath(out_dir)), 'tileDeg': TILE_DEG, 'version': 2, 'squares': len(sizes), 'bytes': total}
        with open(args.index, 'w') as fh:
            json.dump(index, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
