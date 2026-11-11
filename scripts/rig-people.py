"""
Rigs the generated people (walker, hitchhiker, cyclist, Cat Queen) with a
simple skeleton and a few looping moves, using Blender as a Python module
(`pip install bpy`). The models are statues from the generator, so the
skeleton is placed from measured joint positions and every vertex is
weighted to its nearest bones, then smoothed across the mesh so joints bend
softly. Moves are keyframed here; the game plays them with an AnimationMixer.

    python3 -I scripts/rig-people.py <in-dir> <out-dir> [name ...]

Input: the phone-ready models (public/gen/opt/<name>.glb, copied from
project files). Output: <out-dir>/<name>.glb with clips. Run
scripts/pack-people.sh after it to shrink the files again.

Coordinates in the tables below are the model's own glTF coordinates:
x = the model's left, y = up, z = the way it faces, as loaded (about one
unit tall, centred on the origin).
"""
import math
import sys

import bpy
import mathutils

# --------------------------------------------------------------------------- skeletons
# name: (parent, head, tail)
HUMAN_WALKER = {
    'hips': (None, (0, -0.05, -0.01), (0, 0.06, -0.02)),
    'spine': ('hips', (0, 0.06, -0.02), (0, 0.19, -0.03)),
    'chest': ('spine', (0, 0.19, -0.03), (0, 0.29, -0.03)),
    'head': ('chest', (0, 0.29, -0.03), (0, 0.5, 0.0)),
    'thigh.R': ('hips', (-0.045, -0.06, 0.0), (-0.05, -0.22, 0.01)),
    'shin.R': ('thigh.R', (-0.05, -0.22, 0.01), (-0.045, -0.43, 0.0)),
    'foot.R': ('shin.R', (-0.045, -0.43, 0.0), (-0.05, -0.49, 0.1)),
    'thigh.L': ('hips', (0.045, -0.06, 0.0), (0.05, -0.22, 0.06)),
    'shin.L': ('thigh.L', (0.05, -0.22, 0.06), (0.05, -0.42, -0.08)),
    'foot.L': ('shin.L', (0.05, -0.42, -0.08), (0.05, -0.49, 0.0)),
    'arm.R': ('chest', (-0.09, 0.22, -0.03), (-0.17, 0.13, -0.02)),
    'forearm.R': ('arm.R', (-0.17, 0.13, -0.02), (-0.25, 0.06, 0.04)),
    'hand.R': ('forearm.R', (-0.25, 0.06, 0.04), (-0.29, 0.04, 0.07)),
    'arm.L': ('chest', (0.09, 0.22, -0.03), (0.17, 0.13, -0.02)),
    'forearm.L': ('arm.L', (0.17, 0.13, -0.02), (0.25, 0.06, 0.04)),
    'hand.L': ('forearm.L', (0.25, 0.06, 0.04), (0.29, 0.04, 0.07)),
}

HITCHHIKER = {
    'hips': (None, (0, -0.13, 0.0), (0, 0.0, 0.0)),
    'spine': ('hips', (0, 0.0, 0.0), (0, 0.12, 0.0)),
    'chest': ('spine', (0, 0.12, 0.0), (0, 0.22, 0.0)),
    'head': ('chest', (0, 0.22, 0.02), (0, 0.5, 0.04)),
    'thigh.R': ('hips', (-0.06, -0.14, 0.0), (-0.06, -0.27, 0.0)),
    'shin.R': ('thigh.R', (-0.06, -0.27, 0.0), (-0.06, -0.43, 0.0)),
    'foot.R': ('shin.R', (-0.06, -0.43, 0.0), (-0.06, -0.49, 0.08)),
    'thigh.L': ('hips', (0.06, -0.14, 0.0), (0.06, -0.27, 0.0)),
    'shin.L': ('thigh.L', (0.06, -0.27, 0.0), (0.06, -0.43, 0.0)),
    'foot.L': ('shin.L', (0.06, -0.43, 0.0), (0.06, -0.49, 0.08)),
    # The right arm holds a thumb up beside the head.
    'arm.R': ('chest', (-0.1, 0.16, 0.0), (-0.16, 0.08, 0.05)),
    'forearm.R': ('arm.R', (-0.16, 0.08, 0.05), (-0.21, 0.2, 0.08)),
    'hand.R': ('forearm.R', (-0.21, 0.2, 0.08), (-0.22, 0.28, 0.08)),
    'arm.L': ('chest', (0.1, 0.16, 0.0), (0.15, 0.02, 0.0)),
    'forearm.L': ('arm.L', (0.15, 0.02, 0.0), (0.17, -0.1, 0.03)),
}

CYCLIST = {
    # The bike is the root and never moves; the rider sits on it.
    'bike': (None, (0, -0.25, 0.0), (0, -0.05, 0.0)),
    'hips': ('bike', (0, 0.12, -0.12), (0, 0.2, -0.04)),
    'spine': ('hips', (0, 0.2, -0.04), (0, 0.27, 0.06)),
    'head': ('spine', (0, 0.3, 0.09), (0, 0.48, 0.16)),
    'thigh.R': ('hips', (-0.05, 0.12, -0.12), (-0.05, 0.02, -0.02)),
    'shin.R': ('thigh.R', (-0.05, 0.02, -0.02), (-0.05, -0.18, -0.05)),
    'foot.R': ('shin.R', (-0.05, -0.18, -0.05), (-0.05, -0.2, 0.02)),
    'thigh.L': ('hips', (0.05, 0.12, -0.12), (0.05, 0.02, -0.02)),
    'shin.L': ('thigh.L', (0.05, 0.02, -0.02), (0.05, -0.18, -0.05)),
    'foot.L': ('shin.L', (0.05, -0.18, -0.05), (0.05, -0.2, 0.02)),
    'arm.R': ('spine', (-0.07, 0.27, 0.07), (-0.07, 0.12, 0.17)),
    'forearm.R': ('arm.R', (-0.07, 0.12, 0.17), (-0.07, 0.03, 0.26)),
    'arm.L': ('spine', (0.07, 0.27, 0.07), (0.07, 0.12, 0.17)),
    'forearm.L': ('arm.L', (0.07, 0.12, 0.17), (0.07, 0.03, 0.26)),
}

CAT_QUEEN = {
    'hips': (None, (0, -0.3, -0.05), (0, -0.1, -0.03)),
    'spine': ('hips', (0, -0.1, -0.03), (0, 0.02, -0.02)),
    'head': ('spine', (0, 0.02, 0.0), (0, 0.5, 0.0)),
    'thigh.R': ('hips', (-0.08, -0.3, -0.04), (-0.08, -0.4, 0.0)),
    'shin.R': ('thigh.R', (-0.08, -0.4, 0.0), (-0.08, -0.48, 0.04)),
    'thigh.L': ('hips', (0.08, -0.3, -0.04), (0.08, -0.4, 0.0)),
    'shin.L': ('thigh.L', (0.08, -0.4, 0.0), (0.08, -0.48, 0.04)),
    'arm.R': ('spine', (-0.13, 0.0, 0.0), (-0.13, -0.08, 0.06)),
    'forearm.R': ('arm.R', (-0.13, -0.08, 0.06), (-0.12, -0.14, 0.1)),
    'arm.L': ('spine', (0.13, 0.0, 0.0), (0.13, -0.08, 0.06)),
    'forearm.L': ('arm.L', (0.13, -0.08, 0.06), (0.12, -0.14, 0.1)),
    # The tail lies along the floor behind her and curls up on her left.
    'tail.1': ('hips', (0.03, -0.34, -0.1), (0.11, -0.44, -0.2)),
    'tail.2': ('tail.1', (0.11, -0.44, -0.2), (0.19, -0.45, -0.29)),
    'tail.3': ('tail.2', (0.19, -0.45, -0.29), (0.25, -0.36, -0.37)),
    'tail.4': ('tail.3', (0.25, -0.36, -0.37), (0.26, -0.24, -0.46)),
}

# Bones a vertex may not belong to, by where it is (keeps legs off the arms and so on).
def human_mask(p, bones):
    x, y, z = p
    out = set()
    if y > -0.02:
        out |= {b for b in bones if b.startswith(('thigh', 'shin', 'foot'))}
    if y < -0.12:
        out |= {b for b in bones if b.startswith(('arm', 'forearm', 'hand'))}
    if x > 0.02:
        out |= {b for b in bones if b.endswith('.R') and not b.startswith(('thigh', 'shin', 'foot'))}
    if x < -0.02:
        out |= {b for b in bones if b.endswith('.L') and not b.startswith(('thigh', 'shin', 'foot'))}
    return out


def cyclist_mask(p, bones):
    x, y, z = p
    out = human_mask(p, bones) - {b for b in bones if b.startswith(('thigh', 'shin', 'foot'))}
    # Only the rider's legs bend: anything far from the rider's legs stays on the bike.
    if abs(x) > 0.12 or z > 0.12 or z < -0.2 or y < -0.24:
        out |= {b for b in bones if b.startswith(('thigh', 'shin', 'foot'))}
    if x > 0.0:
        out |= {b for b in bones if b.endswith('.R')}
    if x < 0.0:
        out |= {b for b in bones if b.endswith('.L')}
    return out


def cat_mask(p, bones):
    x, y, z = p
    out = set()
    if z > -0.1 or y > -0.2:
        out |= {b for b in bones if b.startswith('tail')}
    elif z < -0.16:
        out |= {b for b in bones if not b.startswith('tail')}
    if y > -0.25:
        out |= {b for b in bones if b.startswith(('thigh', 'shin'))}
    # Paws only: keep the big furry chest and face on the head bone.
    if y > -0.02 or abs(x) < 0.085:
        out |= {b for b in bones if b.startswith(('arm', 'forearm'))}
    if x > 0.02:
        out |= {b for b in bones if b.endswith('.R')}
    if x < -0.02:
        out |= {b for b in bones if b.endswith('.L')}
    return out


# --------------------------------------------------------------------------- moves
# Each move: seconds, then a function of phase (0..1) giving {bone: (rx, ry, rz) in degrees}
# about the model's axes (x = its left, y = up, z = forward), relative to the parent.
def walk(speed=1.0):
    def f(t):
        s = math.sin(t * 2 * math.pi)
        c = math.cos(t * 2 * math.pi)
        lift = lambda k: max(0.0, k)
        return {
            'hips': (0, 4 * s * speed, 0),
            'spine': (3 * speed, -4 * s * speed, 0),
            'thigh.L': (-26 * s * speed, 0, 0),
            'thigh.R': (26 * s * speed, 0, 0),
            'shin.L': (26 * lift(c) * speed, 0, 0),
            'shin.R': (30 * lift(-c) * speed, 0, 0),
            'foot.L': (-10 * s * speed, 0, 0),
            'foot.R': (10 * s * speed, 0, 0),
            'arm.L': (22 * s * speed, 0, 0),
            'arm.R': (-22 * s * speed, 0, 0),
            'forearm.L': (-10 - 10 * lift(s) * speed, 0, 0),
            'forearm.R': (-10 - 10 * lift(-s) * speed, 0, 0),
            'head': (-2 * speed, 3 * s * speed, 0),
        }
    return f


def idle(t):
    s = math.sin(t * 2 * math.pi)
    s2 = math.sin(t * 4 * math.pi)
    return {
        'spine': (1.5 * s2, 0, 0),
        'chest': (1.5 * s2, 0, 0),
        'head': (2 * s2, 10 * s, 0),
        'arm.L': (3 * s2, 0, 0),
        'arm.R': (3 * s2, 0, 0),
    }


def thumb(t):
    s = math.sin(t * 2 * math.pi)
    return {
        'spine': (0, 0, 3 * s),
        'head': (4 * abs(s), -8, 0),
        'arm.R': (0, 0, -10 + 10 * s),
        'forearm.R': (0, 0, 15 * max(0, s)),
    }


def pedal(t):
    a = t * 2 * math.pi
    return {
        'thigh.R': (22 * math.sin(a), 0, 0),
        'shin.R': (-28 + 28 * math.cos(a), 0, 0),
        'thigh.L': (22 * math.sin(a + math.pi), 0, 0),
        'shin.L': (-28 + 28 * math.cos(a + math.pi), 0, 0),
        'hips': (0, 0, 2 * math.sin(a)),
        'head': (0, 4 * math.sin(a / 2), 0),
    }


def cat_idle(t):
    s = math.sin(t * 2 * math.pi)
    return {
        'spine': (2 * math.sin(t * 4 * math.pi), 0, 0),
        'head': (3 * math.sin(t * 4 * math.pi), 6 * s, 2 * s),
        'tail.1': (0, 18 * s, 0),
        'tail.2': (0, 20 * math.sin(t * 2 * math.pi - 0.6), 0),
        'tail.3': (0, 24 * math.sin(t * 2 * math.pi - 1.2), 0),
        'tail.4': (0, 26 * math.sin(t * 2 * math.pi - 1.8), 0),
    }


def cat_swipe(t):
    # Wind up, slash with the right paw, recover.
    k = math.sin(min(1.0, t / 0.6) * math.pi)
    return {
        'spine': (4 * k, -4 * k, 0),
        'head': (-3 * k, 5 * k, 0),
        'arm.R': (-55 * k, 0, 0),
        'forearm.R': (-25 * k, 0, 0),
        'tail.3': (0, 25 * k, 0),
        'tail.4': (0, 30 * k, 0),
    }


def cat_walk(t):
    s = math.sin(t * 2 * math.pi)
    c = math.cos(t * 2 * math.pi)
    return {
        'hips': (0, 6 * s, 3 * s),
        'thigh.L': (-28 * s, 0, 0),
        'thigh.R': (28 * s, 0, 0),
        'shin.L': (25 * max(0, c), 0, 0),
        'shin.R': (25 * max(0, -c), 0, 0),
        'arm.L': (18 * s, 0, 0),
        'arm.R': (-18 * s, 0, 0),
        'head': (0, -5 * s, 0),
        'tail.1': (0, 14 * s, 0),
        'tail.2': (0, 16 * math.sin(t * 2 * math.pi - 0.7), 0),
        'tail.3': (0, 18 * math.sin(t * 2 * math.pi - 1.4), 0),
        'tail.4': (0, 18 * math.sin(t * 2 * math.pi - 2.1), 0),
    }


# A resting pose added to every move: the statues stand with their arms out.
BASE = {
    'player_walker': {'arm.L': (0, 0, -48), 'arm.R': (0, 0, 48), 'forearm.L': (0, 0, -12), 'forearm.R': (0, 0, 12)},
}

RIGS = {
    'player_walker': (HUMAN_WALKER, human_mask, {'idle': (3.0, idle), 'walk': (1.0, walk(1.0)), 'run': (0.62, walk(1.5))}),
    'hitchhiker': (HITCHHIKER, human_mask, {'idle': (3.0, idle), 'thumb': (1.6, thumb), 'walk': (1.1, walk(0.8))}),
    'cyclist': (CYCLIST, cyclist_mask, {'pedal': (0.8, pedal)}),
    'cat_queen': (CAT_QUEEN, cat_mask, {'idle': (2.4, cat_idle), 'swipe': (1.0, cat_swipe), 'walk': (0.9, cat_walk)}),
}


# --------------------------------------------------------------------------- helpers
def to_bl(p):
    """glTF (x, y up, z front) to Blender (x, -z, y)."""
    return mathutils.Vector((p[0], -p[2], p[1]))


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def rig(src, dst, name):
    bones, mask, moves = RIGS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    mesh = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    # Bake the import transform into the mesh so its coordinates match the tables.
    bpy.context.view_layer.objects.active = mesh
    for o in bpy.context.scene.objects:
        o.select_set(o == mesh)
    mesh.parent = None
    mesh.matrix_world = mesh.matrix_world.copy()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    arm_data = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.scene.objects:
        o.select_set(o == arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for bn, (parent, head, tail) in bones.items():
        eb = arm_data.edit_bones.new(bn)
        eb.head = to_bl(head)
        eb.tail = to_bl(tail)
        eb.roll = 0
    for bn, (parent, head, tail) in bones.items():
        if parent:
            eb = arm_data.edit_bones[bn]
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')

    # Weights: nearest bones by distance, kept off bones the mask rules out, then smoothed.
    names = list(bones)
    segs = {bn: (to_bl(bones[bn][1]), to_bl(bones[bn][2])) for bn in names}
    verts = mesh.data.vertices
    # Vertices split at texture seams share a position: weight them as one, or seams open up when they bend.
    key = lambda co: (round(co.x, 4), round(co.y, 4), round(co.z, 4))
    weld = {}
    vid = [weld.setdefault(key(v.co), len(weld)) for v in verts]
    reps = [None] * len(weld)
    for v in verts:
        reps[vid[v.index]] = reps[vid[v.index]] or v.co.copy()
    bans = []
    W = []
    for p in reps:
        g = (p.x, p.z, -p.y)
        banned = set(mask(g, names))
        # A leg vertex belongs to whichever leg is nearer (the generated feet can overlap side to side).
        legs = {side: [bn for bn in names if bn.startswith(('thigh', 'shin', 'foot')) and bn.endswith(side) and bn not in banned] for side in ('.L', '.R')}
        if legs['.L'] and legs['.R']:
            dl = min(seg_dist(p, *segs[bn]) for bn in legs['.L'])
            dr = min(seg_dist(p, *segs[bn]) for bn in legs['.R'])
            banned |= set(legs['.R'] if dl < dr else legs['.L'])
        bans.append(banned)
        ds = sorted((seg_dist(p, *segs[bn]), bn) for bn in names if bn not in banned)
        if not ds:
            ds = [(0.0, names[0])]
        top = ds[:3]
        ws = {bn: 1.0 / max(d, 0.004) ** 4 for d, bn in top}
        tot = sum(ws.values())
        W.append({bn: w / tot for bn, w in ws.items()})
    nbr = [set() for _ in reps]
    for e in mesh.data.edges:
        a, b = (vid[i] for i in e.vertices)
        if a != b:
            nbr[a].add(b)
            nbr[b].add(a)
    for _ in range(4):
        nw = []
        for i, w in enumerate(W):
            acc = dict(w)
            for j in nbr[i]:
                for bn, x in W[j].items():
                    acc[bn] = acc.get(bn, 0.0) + x
            n = 1 + len(nbr[i])
            acc = {bn: x / n for bn, x in acc.items() if bn not in bans[i]} or dict(w)
            best = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
            t = sum(x for _, x in best)
            nw.append({bn: x / t for bn, x in best})
        W = nw
    # The generator sometimes joins the two feet with a thin skin; cut any face that spans both legs.
    def leg_side(w):
        bn = max(w, key=w.get)
        return bn[-2:] if bn.startswith(('thigh', 'shin', 'foot')) else None
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    cut = [fc for fc in bm.faces if len({leg_side(W[vid[v.index]]) for v in fc.verts} - {None}) > 1]
    if cut:
        bmesh.ops.delete(bm, geom=cut, context='FACES_ONLY')
        bm.to_mesh(mesh.data)
        print('cut', len(cut), 'faces joining the legs')
    bm.free()
    groups = {bn: mesh.vertex_groups.new(name=bn) for bn in names}
    for v in verts:
        for bn, x in W[vid[v.index]].items():
            if x > 0.01:
                groups[bn].add([v.index], x, 'REPLACE')
    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = arm
    mesh.parent = arm

    # Moves.
    bpy.context.view_layer.objects.active = arm
    arm.animation_data_create()
    rest = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    for clip, (secs, fn) in moves.items():
        act = bpy.data.actions.new(clip)
        arm.animation_data.action = act
        frames = max(8, int(round(secs * 24)))
        for fi in range(frames + 1):
            t = fi / frames
            rots = fn(t % 1.0)
            base = BASE.get(name, {})
            for pb in arm.pose.bones:
                rx, ry, rz = rots.get(pb.name, (0, 0, 0))
                bx, by, bz = base.get(pb.name, (0, 0, 0))
                rx, ry, rz = rx + bx, ry + by, rz + bz
                # Model axes to Blender: x stays, model up (y) is Blender z, model forward (z) is Blender -y.
                q = (
                    mathutils.Quaternion((0, 0, 1), math.radians(ry))
                    @ mathutils.Quaternion((0, -1, 0), math.radians(rz))
                    @ mathutils.Quaternion((1, 0, 0), math.radians(rx))
                )
                m = rest[pb.name]
                local = (m.inverted() @ q.to_matrix() @ m).to_quaternion()
                pb.rotation_quaternion = local
                pb.keyframe_insert('rotation_quaternion', frame=fi + 1)
        track = arm.animation_data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 1, act)
        arm.animation_data.action = None
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_animation_mode='NLA_TRACKS',
        export_image_format='WEBP',
        export_apply=False,
        export_yup=True,
    )
    print('rigged', name, '->', dst, len(verts), 'verts')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index(__file__) + 1 :] if __file__ in sys.argv else sys.argv[1:]
    src_dir, out_dir, *only = args
    for name in only or list(RIGS):
        rig(f'{src_dir}/{name}.glb', f'{out_dir}/{name}.glb', name)
