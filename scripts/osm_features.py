"""Landmarks and gas stations for the road files (used by build-osm-roads.py).

The game used to ask the public Overpass server for these on every trip,
which could take a minute or more. Baking them into the monthly road build
makes them a few small static files instead. Only what lies near the
highways is kept, at the same distances the game's lookup used:

  towns and cities 3 km, villages 1.2 km, peaks 8 km, sights 2 km,
  gas stations about 1 km (the game keeps those within 350 m of its route)

Rivers are kept only where they cross a highway: a short piece of river
around each crossing, which is all the game draws.

Output: features/<x>_<y>.json, one per 2 x 2 degree square, in this format:

  q       coordinates are integers in 1/q degrees
  kinds   feature kinds, indexed by points and lines
  points  [kind, name, lng, lat, flags, wiki]
          flags bit 0 = truck stop, bit 1 = city (50,000 people or more),
          bit 2 = village;
          wiki is "lang:Title" (a Wikipedia page), "Q123" (Wikidata) or ""
  lines   [kind, name, wiki, [lng, lat, dlng, dlat, ...]] (rivers)
"""
import math
import re

import osmium

KINDS = ['citysign', 'peak', 'monument', 'tower', 'lighthouse', 'watertower', 'windmill',
         'castle', 'viewpoint', 'attraction', 'fuel', 'river']
K = {k: i for i, k in enumerate(KINDS)}
TRUCK_BRANDS = re.compile(r"\b(love'?s|pilot|flying j|petro|ta\b|travelcenters|travel center|travel plaza|truck ?stop|kwik trip|buc-ee'?s|sapp bros)", re.I)
TOURISM = {'attraction', 'viewpoint', 'theme_park'}
HISTORIC = {'monument', 'memorial', 'castle', 'fort', 'ruins', 'battlefield'}
MAN_MADE = {'tower': 'tower', 'lighthouse': 'lighthouse', 'water_tower': 'watertower', 'windmill': 'windmill'}
NEAR_CELL = 0.01  # degrees; about 1 km north-south
SEG_CELL = 0.05  # degrees, for the river crossing test


def kind_of(t):
    """The game's landmark kind for a set of tags, and how near a road it must be (metres)."""
    if t.get('amenity') == 'fuel':
        return 'fuel', 350
    place = t.get('place')
    if place in ('city', 'town'):
        return 'citysign', 3000
    if place == 'village':
        return 'citysign', 1200
    if t.get('natural') in ('peak', 'volcano'):
        return 'peak', 8000
    mm = MAN_MADE.get(t.get('man_made', ''))
    if mm:
        return mm, 2000
    h = t.get('historic')
    if h in HISTORIC:
        return ('castle' if h in ('castle', 'fort', 'ruins') else 'monument'), 2000
    tour = t.get('tourism')
    if tour in TOURISM:
        return ('viewpoint' if tour == 'viewpoint' else 'attraction'), 2000
    return None, 0


def wiki_of(t):
    w = t.get('wikipedia', '')
    if re.match(r'^[a-z-]{2,12}:.+$', w):
        return w
    d = t.get('wikidata', '')
    return d if re.match(r'^Q\d+$', d) else ''


def is_big(t):
    pop = re.sub(r'[, ]', '', t.get('population', ''))
    return t.get('place') == 'city' or (pop.isdigit() and int(pop) >= 50_000)


def seg_cross(ax, ay, bx, by, cx, cy, dx, dy):
    """Where segment AB crosses segment CD, or None."""
    rx, ry, sx, sy = bx - ax, by - ay, dx - cx, dy - cy
    den = rx * sy - ry * sx
    if den == 0:
        return None
    t = ((cx - ax) * sy - (cy - ay) * sx) / den
    u = ((cx - ax) * ry - (cy - ay) * rx) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return ax + rx * t, ay + ry * t
    return None


def meters(a, b):
    k = math.cos(math.radians(a[1]))
    return math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111_000


def river_piece(pts, i, hit, reach=300.0):
    """About `reach` metres of river either side of a crossing inside segment pts[i-1]..pts[i]."""
    back, d, j = [], meters(hit, pts[i - 1]), i - 1
    back.append(pts[j])
    while j > 0 and d < reach:
        d += meters(pts[j], pts[j - 1])
        j -= 1
        back.append(pts[j])
    ahead, d, j = [pts[i]], meters(hit, pts[i]), i
    while j < len(pts) - 1 and d < reach:
        d += meters(pts[j], pts[j + 1])
        j += 1
        ahead.append(pts[j])
    return back[::-1] + ahead


class RoadGrid:
    """Where the highways are: a coarse set of cells near any road, and road segments by cell."""

    def __init__(self, lines):
        self.near = set()
        self.segs = {}
        for ll in lines:
            for i in range(1, len(ll)):
                (ax, ay), (bx, by) = ll[i - 1], ll[i]
                n = max(1, int(max(abs(bx - ax), abs(by - ay)) / (NEAR_CELL / 2)))
                for k in range(n + 1):
                    x, y = ax + (bx - ax) * k / n, ay + (by - ay) * k / n
                    self.near.add((math.floor(x / NEAR_CELL), math.floor(y / NEAR_CELL)))
                for cx in range(math.floor(min(ax, bx) / SEG_CELL), math.floor(max(ax, bx) / SEG_CELL) + 1):
                    for cy in range(math.floor(min(ay, by) / SEG_CELL), math.floor(max(ay, by) / SEG_CELL) + 1):
                        self.segs.setdefault((cx, cy), []).append((ax, ay, bx, by))

    def is_near(self, lon, lat, meters):
        cx, cy = math.floor(lon / NEAR_CELL), math.floor(lat / NEAR_CELL)
        ry = int(meters / 111_000 / NEAR_CELL) + 1
        rx = int(meters / (111_000 * max(0.2, math.cos(math.radians(lat)))) / NEAR_CELL) + 1
        for dx in range(-rx, rx + 1):
            for dy in range(-ry, ry + 1):
                if (cx + dx, cy + dy) in self.near:
                    return True
        return False

    def crossings(self, pts):
        """Indexes i where river segment pts[i-1]..pts[i] crosses a highway, with the crossing point."""
        out = []
        for i in range(1, len(pts)):
            (ax, ay), (bx, by) = pts[i - 1], pts[i]
            cells = [(cx, cy)
                     for cx in range(math.floor(min(ax, bx) / SEG_CELL), math.floor(max(ax, bx) / SEG_CELL) + 1)
                     for cy in range(math.floor(min(ay, by) / SEG_CELL), math.floor(max(ay, by) / SEG_CELL) + 1)]
            for c in cells:
                hit = None
                for s in self.segs.get(c, ()):
                    hit = seg_cross(ax, ay, bx, by, *s)
                    if hit:
                        break
                if hit:
                    out.append((i, hit))
                    break
        return out


class FeatureReader(osmium.SimpleHandler):
    """Second pass over the state files: keeps landmarks near the highways, per tile."""

    def __init__(self, grid, q, tile_deg):
        super().__init__()
        self.grid = grid
        self.q = q
        self.tile_deg = tile_deg
        self.tiles = {}
        self.seen = set()
        self.count = {}

    def _tile(self, lon, lat):
        key = (math.floor(lon / self.tile_deg), math.floor(lat / self.tile_deg))
        return self.tiles.setdefault(key, {'points': [], 'lines': []})

    def _point(self, t, lon, lat, key):
        kind, radius = kind_of(t)
        if not kind:
            return
        name = t.get('name:en') or t.get('name') or ''
        if kind == 'fuel':
            name = name or t.get('brand') or t.get('operator') or ''
        if not name or key in self.seen or not self.grid.is_near(lon, lat, radius + 600):
            return
        self.seen.add(key)
        flags = 0
        if kind == 'fuel' and (t.get('hgv') == 'yes' or TRUCK_BRANDS.search(f"{name} {t.get('brand', '')}")):
            flags |= 1
        if kind == 'citysign' and is_big(t):
            flags |= 2
        if t.get('place') == 'village':
            flags |= 4
        self._tile(lon, lat)['points'].append([K[kind], name, round(lon * self.q), round(lat * self.q), flags, '' if kind == 'fuel' else wiki_of(t)])
        self.count[kind] = self.count.get(kind, 0) + 1

    def node(self, n):
        if n.tags:
            self._point(n.tags, n.location.lon, n.location.lat, ('n', n.id))

    def way(self, w):
        t = w.tags
        if t.get('amenity') == 'fuel':
            try:
                ll = [(nd.lon, nd.lat) for nd in w.nodes]
            except osmium.InvalidLocationError:
                return
            if ll:
                self._point(t, sum(p[0] for p in ll) / len(ll), sum(p[1] for p in ll) / len(ll), ('w', w.id))
            return
        if t.get('waterway') != 'river':
            return
        name = t.get('name:en') or t.get('name')
        if not name:
            return
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        wiki = wiki_of(t)
        for i, (x, y) in self.grid.crossings(pts):
            key = ('r', name, round(x * 1e4), round(y * 1e4))
            if key in self.seen:
                continue  # the same crossing, from a neighbouring state's copy of the river
            self.seen.add(key)
            piece = river_piece(pts, i, (x, y))
            qx, qy = round(piece[0][0] * self.q), round(piece[0][1] * self.q)
            flat = [qx, qy]
            for lon, lat in piece[1:]:
                nx, ny = round(lon * self.q), round(lat * self.q)
                flat += [nx - qx, ny - qy]
                qx, qy = nx, ny
            self._tile(x, y)['lines'].append([K['river'], name, wiki, flat])
            self.count['river'] = self.count.get('river', 0) + 1
