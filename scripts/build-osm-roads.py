#!/usr/bin/env python3
"""Builds the game's road files from OpenStreetMap highway data.

usage: python3 scripts/build-osm-roads.py <filtered.osm.pbf> <out_dir> [--source TEXT]

Input is an OpenStreetMap extract already cut down by scripts/fetch-osm-roads.sh
(highways, motorway exits, towns, and the landmarks and gas stations the
game shows along the way). Output, all plain JSON:

  backbone.json        interstates and other major highways (motorway, trunk
                       and their ramps), the whole country in one file
  tiles/<x>_<y>.json   US and state routes (primary and its ramps), one file
                       per 2 x 2 degree square; x = floor(lng / 2), y = floor(lat / 2)
  towns.json           cities and towns
  features/<x>_<y>.json  landmarks and gas stations near the highways, per
                       2 x 2 degree square (see scripts/osm_features.py)
  index.json           what was built, when, from what, and the tile list
  LICENSE-ODbL.txt     the licence note these files must carry

Every file uses the same compact road format (version 2):

  q        coordinates are integers in 1/q degrees
  nodes    flat [lng, lat, lng, lat, ...]; a node is the same place in every
           file when its integer coordinates match, which is how the game
           joins tiles to the backbone
  refs     route numbers ("I 70", "US 50"), indexed by edges
  names    road names ("Main Street"), indexed by edges
  edges    [nodeA, nodeB, class, refIndex, nameIndex, meters, flags,
            speedKmh, lanes, [delta-encoded shape points from A]]
           class: 0 motorway, 1 trunk, 2 primary; flags bit 0 = one way
           (A to B only); speedKmh and lanes are 0 when OpenStreetMap
           doesn't say. An optional 11th item lists bridges and tunnels:
           [[startMeters, endMeters, kind], ...] measured from A, kind 1 =
           bridge, 2 = tunnel (only spans of MIN_SPAN_M or more)
  exits    backbone only: [node, exit number, exit name]

The data is from OpenStreetMap and must stay under the ODbL; see
https://www.openstreetmap.org/copyright.
"""
import argparse
import gzip
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import osmium

from osm_features import KINDS as FEATURE_KINDS, FeatureReader, RoadGrid

Q = 100_000  # 1e-5 degree, about 1 m; fine enough that shared nodes line up exactly
TILE_DEG = 2
MIN_SPAN_M = 60  # shorter bridges (most overpasses) and tunnels are left out
SIMPLIFY_DEG = 0.0003  # about 30 m: plenty for a game road, and junctions are kept exactly
CLASS = {'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2}
ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'
LICENSE_NOTE = """Road files for Road Trip Madness

These files contain information from OpenStreetMap
(https://www.openstreetmap.org), which is made available here under the
Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/

© OpenStreetMap contributors. See https://www.openstreetmap.org/copyright

They were derived by keeping only highways, motorway exits and towns, joining
road pieces between junctions and simplifying their shapes, plus named
landmarks, gas stations and river crossings near those highways. The script that
builds them is scripts/build-osm-roads.py in the game's repository.
"""


def parse_speed(v: str) -> int:
    """'65 mph' -> 105, '50' -> 50, anything else -> 0."""
    m = re.match(r'^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?\s*$', v or '')
    if not m:
        return 0
    n = float(m.group(1))
    return round(n * 1.609344) if m.group(2) == 'mph' else round(n)


def parse_lanes(v: str) -> int:
    try:
        n = int((v or '').split(';')[0])
    except ValueError:
        return 0
    return n if 0 < n < 20 else 0


class Reader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []
        self.towns = []
        self.exits = {}
        # Each state file holds its own clipped copy of a road that crosses
        # the border, under the same way id, so ways are told apart by their
        # nodes too. Only exact repeats (and repeated towns) are skipped.
        self.seen_ways = set()
        self.seen_towns = set()
        # Road segments (pairs of node ids, smaller first) on bridges and in tunnels.
        self.structure = {}

    def node(self, n):
        t = n.tags
        if t.get('highway') == 'motorway_junction':
            self.exits[n.id] = (t.get('ref', ''), t.get('exit_to') or t.get('name') or '')
        place = t.get('place')
        if place in ('city', 'town') and 'name' in t and n.id not in self.seen_towns:
            self.seen_towns.add(n.id)
            pop = re.sub(r'[^\d]', '', t.get('population', ''))
            self.towns.append([t['name'], 0 if place == 'city' else 1, round(n.location.lon * Q), round(n.location.lat * Q), int(pop) if pop else 0])

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        c = CLASS.get(hw)
        if c is None or t.get('area') == 'yes':
            return
        try:
            pts = [(nd.ref, nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2:
            return
        key = (w.id, tuple(p[0] for p in pts))
        if key in self.seen_ways:
            return
        self.seen_ways.add(key)
        oneway = t.get('oneway', '')
        if oneway == '-1':
            pts.reverse()
        kind = structure_kind(t)
        if kind:
            for i in range(1, len(pts)):
                u, v = pts[i - 1][0], pts[i][0]
                self.structure[(u, v) if u < v else (v, u)] = kind
        ow = oneway in ('yes', '1', 'true', '-1') or (hw in ('motorway', 'motorway_link') and oneway != 'no') or t.get('junction') == 'roundabout'
        self.ways.append({
            'c': c,
            'ow': ow,
            'ref': t.get('ref', ''),
            'name': t.get('name', ''),
            'speed': parse_speed(t.get('maxspeed', '')),
            'lanes': parse_lanes(t.get('lanes', '')),
            'pts': pts,
        })


def structure_kind(t) -> int:
    """1 for a bridge, 2 for a tunnel, 0 for an ordinary road."""
    if t.get('tunnel', 'no') in ('yes', 'building_passage', 'avalanche_protector'):
        return 2
    if t.get('bridge', 'no') not in ('no', ''):
        return 1
    return 0


def spans_along(pts, structure):
    """Bridge and tunnel spans along a run of points, in metres from its start."""
    out = []
    m = 0.0
    for i in range(1, len(pts)):
        u, v = pts[i - 1][0], pts[i][0]
        step = haversine((pts[i - 1][1], pts[i - 1][2]), (pts[i][1], pts[i][2]))
        kind = structure.get((u, v) if u < v else (v, u), 0)
        if kind:
            if out and out[-1][2] == kind and m - out[-1][1] < 5:
                out[-1][1] = m + step
            else:
                out.append([m, m + step, kind])
        m += step
    return [[round(a), round(b), k] for a, b, k in out if b - a >= MIN_SPAN_M]


def haversine(a, b):
    r = 6_371_000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(d)))


def simplify(pts, tol):
    """Douglas-Peucker on (lng, lat) with longitude scaled by cos(lat)."""
    if len(pts) < 3:
        return pts[:]
    k = math.cos(math.radians(pts[0][1]))
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay, bx, by = pts[i][0] * k, pts[i][1], pts[j][0] * k, pts[j][1]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy or 1e-18
        best, best_d = -1, tol * tol
        for m in range(i + 1, j):
            px, py = pts[m][0] * k, pts[m][1]
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
            ex, ey = ax + dx * t - px, ay + dy * t - py
            d = ex * ex + ey * ey
            if d > best_d:
                best_d, best = d, m
        if best >= 0:
            keep[best] = True
            stack += [(i, best), (best, j)]
    return [p for p, kk in zip(pts, keep) if kk]


# Nodes the extract provider added where it cut roads at a state line have ids
# from 30,000,000,000 up (https://osm.download.movisda.io/ "Synthetic IDs").
CUT_NODE_MIN_ID = 30_000_000_000


def join_cut_ends(ways, max_m=60.0):
    """Rejoins roads cut apart at state lines.

    Each state extract cuts every road at its own copy of the border and adds
    a new node there (sometimes it keeps a real node instead), so the two halves of a road end up to tens of metres
    apart with different ids, and the road would stop at the border. Each
    cut end is joined to the nearest cut end of another road within max_m,
    preferring the same route number, and for one-way roads only an end to a
    start (so a divided highway never joins across its median).
    Returns how many road ends were moved.
    """
    ends = {}
    seen = {}
    for wi, w in enumerate(ways):
        pts = w['pts']
        for i, (nid, _, _) in enumerate(pts):
            seen[nid] = seen.get(nid, 0) + (1 if i in (0, len(pts) - 1) else 2)
    for wi, w in enumerate(ways):
        pts = w['pts']
        for pos, i in (('start', 0), ('end', len(pts) - 1)):
            nid, lon, lat = pts[i]
            if seen[nid] == 1:
                ends[nid] = (wi, pos, lon, lat)
    cell = 0.001
    grid = {}
    for nid, (_, _, lon, lat) in ends.items():
        grid.setdefault((math.floor(lon / cell), math.floor(lat / cell)), []).append(nid)
    pairs = []
    for a, (wa, pa, lon, lat) in ends.items():
        cx, cy = math.floor(lon / cell), math.floor(lat / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for b in grid.get((cx + dx, cy + dy), []):
                    if b <= a or (a < CUT_NODE_MIN_ID and b < CUT_NODE_MIN_ID):
                        continue  # at least one of the two must be a cut the extract made
                    wb, pb, blon, blat = ends[b]
                    if wb == wa:
                        continue
                    A, B = ways[wa], ways[wb]
                    if (A['ow'] or B['ow']) and pa == pb:
                        continue
                    m = haversine((lon, lat), (blon, blat))
                    if m <= max_m:
                        score = m + (0 if A['ref'] == B['ref'] else 40) + (0 if A['c'] == B['c'] else 40)
                        pairs.append((score, a, b))
    pairs.sort()
    remap = {}
    for _, a, b in pairs:
        if a in remap or b in remap:
            continue
        remap[a] = a
        remap[b] = a
    moved = 0
    for w in ways:
        pts = w['pts']
        for i in (0, len(pts) - 1):
            a = remap.get(pts[i][0])
            if a is not None and a != pts[i][0]:
                pts[i] = (a, ends[a][2], ends[a][3])
                moved += 1
    return moved


def split_at_junctions(ways, exits):
    """Cuts ways into edges that run junction to junction (across both layers)."""
    use = {}
    for w in ways:
        last = len(w['pts']) - 1
        for i, (nid, _, _) in enumerate(w['pts']):
            use[nid] = use.get(nid, 0) + (2 if i in (0, last) else 1)
    for nid in exits:
        if nid in use:
            use[nid] += 2  # keep exits as nodes so the game can name them
    edges = []
    for w in ways:
        pts = w['pts']
        cur = [pts[0]]
        for i in range(1, len(pts)):
            cur.append(pts[i])
            if i < len(pts) - 1 and use[pts[i][0]] > 1:
                edges.append(dict(w, pts=cur))
                cur = [pts[i]]
        if len(cur) > 1:
            edges.append(dict(w, pts=cur))
    return edges


def merge_chains(edges, keep_nodes):
    """Joins edges that meet at a node only they touch and that describe the same road."""
    # Same road = same class, direction and route number (or name, for roads
    # without one). Speed and lanes change often along a road; a joined edge
    # keeps the values of its longer part, which is plenty for the game.
    def same(a, b):
        return a['c'] == b['c'] and a['ow'] == b['ow'] and a['ref'] == b['ref'] and (a['ref'] or a['name'] == b['name'])
    at = {}
    for i, e in enumerate(edges):
        for nid in (e['pts'][0][0], e['pts'][-1][0]):
            at.setdefault(nid, []).append(i)
    alive = [True] * len(edges)
    for nid in list(at):
        if nid in keep_nodes:
            continue
        here = [i for i in at[nid] if alive[i]]
        if len(here) != 2 or here[0] == here[1]:
            continue
        a, b = here
        ea, eb = edges[a], edges[b]
        if not same(ea, eb):
            continue
        pa, pb = ea['pts'], eb['pts']
        if pa[-1][0] == nid and pb[0][0] == nid:
            joined = pa + pb[1:]
        elif pb[-1][0] == nid and pa[0][0] == nid:
            joined = pb + pa[1:]
        elif not ea['ow'] and pa[0][0] == nid and pb[0][0] == nid:
            joined = pa[::-1] + pb[1:]
        elif not ea['ow'] and pa[-1][0] == nid and pb[-1][0] == nid:
            joined = pa + pb[::-1][1:]
        else:
            continue
        if joined[0][0] == joined[-1][0]:
            continue  # a loop; leave it in two pieces so both ends stay nodes
        longer = ea if len(pa) >= len(pb) else eb
        edges[a] = dict(longer, pts=joined)
        alive[b] = False
        for end in (joined[0][0], joined[-1][0]):
            at[end] = [a if i == b else i for i in at[end]]
    return [e for e, ok in zip(edges, alive) if ok]


class RoadFile:
    """Accumulates one output file in the compact road format."""

    def __init__(self, structure=None):
        self.structure = structure or {}
        self.node_ix = {}
        self.nodes = []
        self.refs, self.ref_ix = [], {}
        self.names, self.name_ix = [], {}
        self.edges = []
        self.exits = []
        self.exit_nodes = set()
        self.meters = 0
        self.spans = 0

    def _node(self, p):
        key = (round(p[1] * Q), round(p[2] * Q))
        if key not in self.node_ix:
            self.node_ix[key] = len(self.nodes) // 2
            self.nodes.extend(key)
        return self.node_ix[key]

    def _string(self, table, index, s):
        if s not in index:
            index[s] = len(table)
            table.append(s)
        return index[s]

    def add(self, e, exits):
        pts = e['pts']
        ll = [(p[1], p[2]) for p in pts]
        meters = round(sum(haversine(ll[i], ll[i + 1]) for i in range(len(ll) - 1)))
        if meters == 0:
            return
        self.meters += meters
        a, b = self._node(pts[0]), self._node(pts[-1])
        x, y = self.nodes[a * 2], self.nodes[a * 2 + 1]
        deltas = []
        for lng, lat in simplify(ll, SIMPLIFY_DEG)[1:-1]:
            qx, qy = round(lng * Q), round(lat * Q)
            if (qx, qy) != (x, y):
                deltas += [qx - x, qy - y]
                x, y = qx, qy
        edge = [
            a, b, e['c'],
            self._string(self.refs, self.ref_ix, e['ref']),
            self._string(self.names, self.name_ix, e['name']),
            meters, 1 if e['ow'] else 0, e['speed'], e['lanes'], deltas,
        ]
        spans = spans_along(pts, self.structure)
        if spans:
            edge.append(spans)
            self.spans += len(spans)
        self.edges.append(edge)
        if exits is not None:
            for p in (pts[0], pts[-1]):
                n = self._node(p)
                if p[0] in exits and n not in self.exit_nodes:
                    self.exit_nodes.add(n)
                    self.exits.append([n, *exits[p[0]]])

    def doc(self, kind, extra):
        d = {'version': 2, 'kind': kind, 'q': Q, 'attribution': ATTRIBUTION, 'license': 'ODbL-1.0',
             'classes': ['motorway', 'trunk', 'primary'], 'refs': self.refs, 'names': self.names,
             'nodes': self.nodes, 'edges': self.edges}
        if kind == 'backbone':
            d['exits'] = self.exits
        d.update(extra)
        return d


def write_json(path, doc):
    raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    with open(path, 'wb') as f:
        f.write(raw)
    return len(raw), len(gzip.compress(raw, 9))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pbf', nargs='+', help='filtered state files (roads-XX.osm.pbf); read one by one, never merged')
    ap.add_argument('out')
    ap.add_argument('--source', default='OpenStreetMap extract')
    ap.add_argument('--min-connected', type=float, default=0.95, help='fail if fewer road nodes join the main network')
    args = ap.parse_args()

    r = Reader()
    # Not osmium merge: it keeps one copy of a way that two state files both
    # clipped at their border, which left gaps of kilometres (I-40 at Texola).
    for f in args.pbf:
        r.apply_file(f, locations=True)
    print(f'read {len(r.ways)} ways, {len(r.exits)} exits, {len(r.towns)} towns', file=sys.stderr)

    joined = join_cut_ends(r.ways)
    print(f'joined {joined} road ends cut apart at state lines', file=sys.stderr)
    edges = split_at_junctions(r.ways, r.exits)
    edges = merge_chains(edges, set(r.exits))

    backbone = RoadFile(r.structure)
    tiles = {}
    for e in edges:
        if e['c'] < 2:
            backbone.add(e, r.exits)
        else:
            p = e['pts'][0]
            key = (math.floor(p[1] / TILE_DEG), math.floor(p[2] / TILE_DEG))
            tiles.setdefault(key, RoadFile(r.structure)).add(e, None)

    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(os.path.join(args.out, 'tiles'), exist_ok=True)
    sizes = {}
    sizes['backbone.json'] = write_json(os.path.join(args.out, 'backbone.json'), backbone.doc('backbone', {}))
    tile_list = []
    for (x, y), t in sorted(tiles.items()):
        name = f'tiles/{x}_{y}.json'
        sizes[name] = write_json(os.path.join(args.out, name), t.doc('tile', {'tile': [x, y], 'tileDeg': TILE_DEG}))
        tile_list.append([x, y, sizes[name][1]])
    r.towns.sort(key=lambda t: -t[4])
    sizes['towns.json'] = write_json(os.path.join(args.out, 'towns.json'), {
        'version': 2, 'q': Q, 'attribution': ATTRIBUTION, 'license': 'ODbL-1.0',
        'kinds': ['city', 'town'], 'towns': r.towns})

    # Landmarks: a second pass over the same files, keeping what lies near the highways.
    grid = RoadGrid(simplify([(p[1], p[2]) for p in e['pts']], SIMPLIFY_DEG) for e in edges)
    fr = FeatureReader(grid, Q, TILE_DEG)
    for f in args.pbf:
        fr.apply_file(f, locations=True)
    del grid
    os.makedirs(os.path.join(args.out, 'features'), exist_ok=True)
    feature_list = []
    for (x, y), t in sorted(fr.tiles.items()):
        name = f'features/{x}_{y}.json'
        sizes[name] = write_json(os.path.join(args.out, name), {
            'version': 1, 'q': Q, 'attribution': ATTRIBUTION, 'license': 'ODbL-1.0', 'tile': [x, y], 'tileDeg': TILE_DEG,
            'kinds': FEATURE_KINDS, 'points': t['points'], 'lines': t['lines']})
        feature_list.append([x, y, sizes[name][1]])

    with open(os.path.join(args.out, 'LICENSE-ODbL.txt'), 'w') as f:
        f.write(LICENSE_NOTE)
    index = {
        'version': 2, 'built': built, 'source': args.source, 'attribution': ATTRIBUTION, 'license': 'ODbL-1.0',
        'licenseFile': 'LICENSE-ODbL.txt', 'q': Q, 'tileDeg': TILE_DEG,
        'backbone': {'file': 'backbone.json', 'gzipBytes': sizes['backbone.json'][1], 'rawBytes': sizes['backbone.json'][0], 'km': round(backbone.meters / 1000)},
        'towns': {'file': 'towns.json', 'count': len(r.towns)},
        'tiles': tile_list,
        'features': feature_list,
    }
    write_json(os.path.join(args.out, 'index.json'), index)

    tile_gz = sorted(s[1] for n, s in sizes.items() if n.startswith('tiles/'))
    print(f"backbone: {round(backbone.meters / 1000)} km, {len(backbone.edges)} edges, {len(backbone.exits)} exits, "
          f"{sizes['backbone.json'][1] / 1e6:.2f} MB gzipped")
    if tile_gz:
        print(f'tiles: {len(tile_gz)}, {sum(tile_gz) / 1e6:.2f} MB gzipped in total, '
              f'median {tile_gz[len(tile_gz) // 2] / 1e3:.0f} KB, largest {tile_gz[-1] / 1e3:.0f} KB')
    print(f'towns: {len(r.towns)}')
    feat_gz = sum(s[1] for n, s in sizes.items() if n.startswith('features/'))
    print(f'landmarks: {dict(sorted(fr.count.items()))}, {len(feature_list)} files, {feat_gz / 1e6:.2f} MB gzipped in total')
    print(f'bridges and tunnels kept: {backbone.spans + sum(t.spans for t in tiles.values())}')

    # Sanity check: almost every road should join one network across all files.
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for f in [backbone, *tiles.values()]:
        n = f.nodes
        for e in f.edges:
            parent[find((n[e[0] * 2], n[e[0] * 2 + 1]))] = find((n[e[1] * 2], n[e[1] * 2 + 1]))
    counts = {}
    for x in list(parent):
        root = find(x)
        counts[root] = counts.get(root, 0) + 1
    share = max(counts.values()) / len(parent) if parent else 0
    print(f'connected: {share:.1%} of road nodes are in the main network')
    if share < args.min_connected:
        sys.exit(f'Only {share:.1%} of road nodes connect; expected at least {args.min_connected:.0%}.')


if __name__ == '__main__':
    main()
