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
  points  [kind, name, lng, lat, flags, wiki, ele?] (ele: peaks only, metres, when tagged)
          flags bit 0 = truck stop, bit 1 = city (50,000 people or more),
          bit 2 = village;
          wiki is "lang:Title" (a Wikipedia page), "Q123" (Wikidata) or ""
  lines   [kind, name, wiki, [lng, lat, dlng, dlat, ...]] (rivers)
  crossings  [lng, lat, mainDeg, crossDeg, kind, both, lanes, name]: a main
          street (OSM secondary) crossing a highway. Degrees are planar
          (east 0, counter-clockwise); mainDeg is the highway's (0-179),
          crossDeg the street's (for one-sided, the way it runs off).
          kind 0 = they meet (flat), 1 = the street goes over the highway,
          2 = it goes under. both 0 = the street ends at the highway.
  bridges [lng, lat, deg]: a highway on a bridge over another highway, deg
          the direction of the one on top (0-179), so the game knows which
          road of a crossing is the upper one.
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


def ele_of(t):
    """A peak's height in metres from its ele tag ("1234", "1234 m", "4000 ft"), or None."""
    m = re.match(r'\s*(-?[0-9]+(?:\.[0-9]+)?)\s*(m|ft|feet)?', t.get('ele', '').replace(',', '.'))
    if not m:
        return None
    v = float(m.group(1)) * (0.3048 if m.group(2) in ('ft', 'feet') else 1)
    return round(v) if -100 < v < 9000 else None


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


def bearing(ax, ay, bx, by):
    """Planar direction from A to B in whole degrees (east 0, counter-clockwise), 0-359."""
    k = math.cos(math.radians((ay + by) / 2))
    return round(math.degrees(math.atan2(by - ay, (bx - ax) * k))) % 360


def seg_sin(ax, ay, bx, by, cx, cy, dx, dy):
    """Sine of the angle between two segments (planar, longitude scaled)."""
    k = math.cos(math.radians(ay))
    rx, ry, sx, sy = (bx - ax) * k, by - ay, (dx - cx) * k, dy - cy
    n = math.hypot(rx, ry) * math.hypot(sx, sy)
    return abs(rx * sy - ry * sx) / n if n else 0


def seg_dist_m(px, py, ax, ay, bx, by):
    """Metres from P to segment AB."""
    k = math.cos(math.radians(py))
    ax, bx, qx = (ax - px) * k, (bx - px) * k, 0
    ay, by = ay - py, by - py
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1e-18)))
    return math.hypot(ax + dx * t, ay + dy * t) * 111_000


MIN_CROSS_SIN = 0.34  # crossings at less than about 20 degrees are roads running alongside
END_NEAR_M = 25  # a street ending this close to a highway meets it


class BridgeGrid:
    """Highway segments on bridges (any length), by cell, to tell what passes under them."""

    def __init__(self, segs):
        self.segs = segs
        self.cells = {}
        for i, (ax, ay, bx, by) in enumerate(segs):
            for cx in range(math.floor(min(ax, bx) / SEG_CELL), math.floor(max(ax, bx) / SEG_CELL) + 1):
                for cy in range(math.floor(min(ay, by) / SEG_CELL), math.floor(max(ay, by) / SEG_CELL) + 1):
                    self.cells.setdefault((cx, cy), []).append(i)

    def near(self, x, y, m):
        for i in self.cells.get((math.floor(x / SEG_CELL), math.floor(y / SEG_CELL)), ()):
            if seg_dist_m(x, y, *self.segs[i]) < m:
                return True
        return False


class RoadGrid:
    """Where the highways are: a coarse set of cells near any road, and road segments by cell.

    `lines` gives point lists, or (point list, road class) pairs; a segment is
    (ax, ay, bx, by, class), class 9 when not given.
    """

    def __init__(self, lines):
        self.near = set()
        self.segs = {}
        for ll in lines:
            c = 9
            if isinstance(ll, tuple):
                ll, c = ll
            for i in range(1, len(ll)):
                (ax, ay), (bx, by) = ll[i - 1], ll[i]
                n = max(1, int(max(abs(bx - ax), abs(by - ay)) / (NEAR_CELL / 2)))
                for k in range(n + 1):
                    x, y = ax + (bx - ax) * k / n, ay + (by - ay) * k / n
                    self.near.add((math.floor(x / NEAR_CELL), math.floor(y / NEAR_CELL)))
                for cx in range(math.floor(min(ax, bx) / SEG_CELL), math.floor(max(ax, bx) / SEG_CELL) + 1):
                    for cy in range(math.floor(min(ay, by) / SEG_CELL), math.floor(max(ay, by) / SEG_CELL) + 1):
                        self.segs.setdefault((cx, cy), []).append((ax, ay, bx, by, c))

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
                    hit = seg_cross(ax, ay, bx, by, *s[:4])
                    if hit:
                        break
                if hit:
                    out.append((i, hit))
                    break
        return out

    def all_crossings(self, pts, min_sin=MIN_CROSS_SIN):
        """Every (i, (x, y), seg) where pts[i-1]..pts[i] crosses a highway segment at a real angle."""
        out = []
        for i in range(1, len(pts)):
            (ax, ay), (bx, by) = pts[i - 1], pts[i]
            seen = set()
            for cx in range(math.floor(min(ax, bx) / SEG_CELL), math.floor(max(ax, bx) / SEG_CELL) + 1):
                for cy in range(math.floor(min(ay, by) / SEG_CELL), math.floor(max(ay, by) / SEG_CELL) + 1):
                    for s in self.segs.get((cx, cy), ()):
                        if s in seen:
                            continue
                        seen.add(s)
                        hit = seg_cross(ax, ay, bx, by, *s[:4])
                        if hit and seg_sin(ax, ay, bx, by, *s[:4]) >= min_sin:
                            out.append((i, hit, s))
        return out

    def nearest(self, x, y, m):
        """The highway segment within m metres of a point, if any."""
        best, found = m, None
        for s in self.segs.get((math.floor(x / SEG_CELL), math.floor(y / SEG_CELL)), ()):
            d = seg_dist_m(x, y, *s[:4])
            if d < best:
                best, found = d, s
        return found


class FeatureReader(osmium.SimpleHandler):
    """Second pass over the state files: keeps landmarks near the highways, per tile."""

    def __init__(self, grid, q, tile_deg, bridges=None):
        super().__init__()
        self.grid = grid
        self.bridges = bridges
        self.q = q
        self.tile_deg = tile_deg
        self.tiles = {}
        self.seen = set()
        self.count = {}

    def _tile(self, lon, lat):
        key = (math.floor(lon / self.tile_deg), math.floor(lat / self.tile_deg))
        return self.tiles.setdefault(key, {'points': [], 'lines': [], 'crossings': [], 'bridges': []})

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
        row = [K[kind], name, round(lon * self.q), round(lat * self.q), flags, '' if kind == 'fuel' else wiki_of(t)]
        # Peaks keep their height (metres), so the game can tell a 30 m mound from a real mountain.
        if kind == 'peak':
            ele = ele_of(t)
            if ele is not None:
                row.append(ele)
        self._tile(lon, lat)['points'].append(row)
        self.count[kind] = self.count.get(kind, 0) + 1

    def node(self, n):
        if n.tags:
            self._point(n.tags, n.location.lon, n.location.lat, ('n', n.id))

    def _cross_row(self, x, y, main_deg, cross_deg, kind, both, lanes, name):
        key = ('x', round(x * 1e4), round(y * 1e4))
        if key in self.seen:
            return  # a neighbouring state's copy of the same street
        self.seen.add(key)
        self._tile(x, y)['crossings'].append([round(x * self.q), round(y * self.q), main_deg % 180, cross_deg % 360, kind, both, lanes, name])
        self.count['crossing'] = self.count.get('crossing', 0) + 1

    def _street(self, t, w):
        """A main street (OSM secondary): where it crosses or meets a highway."""
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2:
            return
        name = t.get('name') or t.get('ref') or ''
        try:
            lanes = int(re.sub(r'[^\d].*$', '', t.get('lanes', '')) or 0)
        except ValueError:
            lanes = 0
        layer = 0
        try:
            layer = int(t.get('layer', '0'))
        except ValueError:
            pass
        own = 1 if (t.get('bridge', 'no') not in ('no', '') or layer > 0) else 2 if (t.get('tunnel', 'no') not in ('no', '') or layer < 0) else 0
        hits = self.grid.all_crossings(pts)
        for i, (x, y), seg in hits:
            # Over or under from the street's own tags; else a highway bridge right there means
            # it passes under; a motorway never meets a street, so it goes over; else they meet.
            kind = own or (2 if self.bridges and self.bridges.near(x, y, 20) else 1 if seg[4] == 0 else 0)
            (ax, ay), (bx, by) = pts[i - 1], pts[i]
            self._cross_row(x, y, bearing(*seg[:4]), bearing(ax, ay, bx, by), kind, 1, lanes, name)
        # A street that ends at a highway (a T): the highway is usually simplified a little off the junction.
        for end, step in ((0, 1), (len(pts) - 1, -1)):
            ex, ey = pts[end]
            if any(meters((ex, ey), hit) < 60 for _, hit, _ in hits):
                continue
            seg = self.grid.nearest(ex, ey, END_NEAR_M)
            if not seg or seg[4] == 0:
                continue
            j = end + step
            while 0 < j < len(pts) - 1 and meters((ex, ey), pts[j]) < 30:
                j += step
            fx, fy = pts[j]
            if seg_sin(ex, ey, fx, fy, *seg[:4]) < MIN_CROSS_SIN:
                continue
            self._cross_row(ex, ey, bearing(*seg[:4]), bearing(ex, ey, fx, fy), 0, 0, lanes, name)

    def add_bridges(self, segs):
        """Highways on bridges over other highways: where, and which way the upper one runs."""
        for ax, ay, bx, by in segs:
            for _, (x, y), s in self.grid.all_crossings([(ax, ay), (bx, by)]):
                key = ('b', round(x * 1e4), round(y * 1e4))
                if key in self.seen:
                    continue
                self.seen.add(key)
                self._tile(x, y)['bridges'].append([round(x * self.q), round(y * self.q), bearing(ax, ay, bx, by) % 180])
                self.count['bridge'] = self.count.get('bridge', 0) + 1

    def way(self, w):
        t = w.tags
        if t.get('highway') == 'secondary':
            self._street(t, w)
            return
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
