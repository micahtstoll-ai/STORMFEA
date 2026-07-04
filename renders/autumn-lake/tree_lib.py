# tree_lib.py — procedural, guaranteed-unique trees for the autumn lake.
#
# Every tree is driven by its own random.Random(seed): branch counts, angles,
# lengths, foliage placement and colour all come from continuous randoms, so
# two identical trees are effectively impossible. Geometry is accumulated into
# a handful of merged meshes (NOT linked instances) grouped by material.
#
# Reuses cattail_lib.add_tube() for every branch/trunk segment and
# cattail_lib.make_object() to realize accumulators into meshes with a baked
# "col" FLOAT_COLOR attribute (both are already on sys.path in the lake scene).
import math
import colorsys
import bpy
from mathutils import Vector, Matrix, noise
import cattail_lib as ct


# ------------------------------------------------------------------ helpers
def _perp(v):
    """Some unit vector perpendicular to v."""
    a = Vector((0, 0, 1)) if abs(v.z) < 0.9 else Vector((1, 0, 0))
    return v.cross(a).normalized()


def _rotate_dir(d, spread, roll):
    """Tilt unit dir `d` by `spread` radians, rolled `roll` around d."""
    e1 = _perp(d)
    e2 = d.cross(e1).normalized()
    off = math.cos(roll) * e1 + math.sin(roll) * e2
    return (d * math.cos(spread) + off * math.sin(spread)).normalized()


def _jitter_color(rgb, rng, hue=0.04, val=0.18, sat=0.10):
    """Per-tree hue/val/sat jitter so no two crowns share a tone."""
    h, l, s = colorsys.rgb_to_hls(*rgb)
    h = (h + rng.uniform(-hue, hue)) % 1.0
    l = max(0.0, l * (1.0 + rng.uniform(-val, val)))
    s = min(1.0, max(0.0, s * (1.0 + rng.uniform(-sat, sat))))
    return colorsys.hls_to_rgb(h, l, s)


# ------------------------------------------------------------------ foliage
def _add_blob(acc, center, radius, color, rng, squash=1.0, rough=0.35, subdiv=1):
    """A noise-deformed low-poly ico-blob dropped into the leaf accumulator,
       coloured `color` with a height gradient + per-vertex noise baked in."""
    v, f, cols = acc["leaf"]
    base = len(v)
    ico_v, ico_t = _ICO[subdiv]
    seed = rng.random() * 50.0
    zmin = min(p[2] for p in ico_v)
    zmax = max(p[2] for p in ico_v)
    for (px, py, pz) in ico_v:
        p = Vector((px, py, pz))
        n = 1.0 + rough * noise.noise(p * 1.7 + Vector((seed, seed, seed)))
        world = center + Vector((p.x * n, p.y * n, p.z * n * squash)) * radius
        v.append(world[:])
        # brighter toward the top/outside, darker/greener inside-low
        t = (pz - zmin) / (zmax - zmin + 1e-6)
        shade = 0.55 + 0.55 * t + rng.uniform(-0.06, 0.06)
        shade *= 1.0 + 0.10 * noise.noise(world * 0.6)
        cols.append((color[0] * shade, color[1] * shade, color[2] * shade, 1.0))
    for tri in ico_t:
        f.append((base + tri[0], base + tri[1], base + tri[2]))


def _ico_geometry(subdiv):
    """Return (verts, tris) of a unit icosphere at the given subdivision."""
    me = bpy.data.meshes.new("ico")
    bm_obj = bpy.data.objects.new("ico", me)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    bm.to_mesh(me)
    bm.free()
    verts = [tuple(v.co) for v in me.vertices]
    tris = []
    for poly in me.polygons:
        vs = list(poly.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    bpy.data.objects.remove(bm_obj)
    bpy.data.meshes.remove(me)
    return verts, tris


# cache icosphere geometry per subdivision level (shape is reused, then
# displaced uniquely per blob — the cache is geometry template only)
_ICO = {0: None, 1: None, 2: None}
def _ensure_ico():
    for k in list(_ICO):
        if _ICO[k] is None:
            _ICO[k] = _ico_geometry(k)


# ------------------------------------------------------------------ bark
def _add_branch_tube(acc, p0, p1, r0, r1, rng, sides=6, bark=(0.05, 0.035, 0.022)):
    v, f, cols = acc["bark"]
    start = len(v)
    mid = (p0 + p1) * 0.5 + _perp(p1 - p0) * (p1 - p0).length * rng.uniform(-0.06, 0.06)
    path = [p0, mid, p1]
    radii = [r0, (r0 + r1) * 0.5, r1]
    tlist = []
    ct.add_tube(v, f, tlist, path, radii, sides=sides, n_amp=0.08, n_scale=4.0, rng=rng)
    for i in range(len(v) - start):
        sh = 0.75 + 0.5 * rng.random()
        cols.append((bark[0] * sh, bark[1] * sh, bark[2] * sh, 1.0))


# ------------------------------------------------------------------ broadleaf
def build_broadleaf(acc, base, scale, palette, rng, lod=1.0):
    """Recursive forking tree with foliage clumps on the twig tips."""
    _ensure_ico()
    color = _jitter_color(palette, rng)
    bark = _jitter_color((0.05, 0.035, 0.022), rng, hue=0.02, val=0.4, sat=0.2)
    subdiv = 1 if lod > 0.5 else 0
    depth = 3 if lod > 0.6 else (2 if lod > 0.3 else 1)
    base = Vector(base)

    trunk_h = scale * rng.uniform(2.4, 3.6)
    trunk_r = scale * rng.uniform(0.12, 0.19)
    lean = _rotate_dir(Vector((0, 0, 1)), rng.uniform(0.02, 0.16), rng.uniform(0, math.tau))
    top = base + lean * trunk_h
    _add_branch_tube(acc, base, top, trunk_r, trunk_r * 0.55, rng, sides=7, bark=bark)

    n_primary = rng.randint(4, 6)
    for i in range(n_primary):
        # primaries fan out from the upper trunk, biased upward
        d = _rotate_dir(lean, rng.uniform(0.5, 1.0), rng.uniform(0, math.tau))
        d = (d + Vector((0, 0, 0.6))).normalized()
        start = base + lean * (trunk_h * rng.uniform(0.55, 0.95))
        _branch(acc, start, d, scale * rng.uniform(1.4, 2.1),
                trunk_r * rng.uniform(0.5, 0.72), depth, rng, color, bark, subdiv, scale)


def _branch(acc, start, d, length, radius, depth, rng, color, bark, subdiv, scale):
    end = start + d * length
    _add_branch_tube(acc, start, end, radius, radius * 0.6, rng,
                     sides=(6 if depth > 1 else 5), bark=bark)
    if depth <= 0:
        return
    if depth == 1:
        # twig tips: 2-3 overlapping foliage clumps for a full crown
        for _ in range(rng.randint(2, 3)):
            c = end + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3),
                              rng.uniform(-0.1, 0.3))) * scale
            _add_blob(acc, c, scale * rng.uniform(0.75, 1.2), color, rng,
                      squash=rng.uniform(0.8, 1.15), subdiv=subdiv)
        return
    for _ in range(rng.randint(2, 4)):
        nd = _rotate_dir(d, rng.uniform(0.4, 0.9), rng.uniform(0, math.tau))
        nd = (nd + Vector((0, 0, 0.35))).normalized()
        _branch(acc, end, nd, length * rng.uniform(0.6, 0.8),
                radius * rng.uniform(0.62, 0.75), depth - 1, rng, color, bark, subdiv, scale)


# ------------------------------------------------------------------ conifer
def build_conifer(acc, base, scale, palette, rng, lod=1.0):
    """Curved central leader with whorls of downward-angled foliage branches."""
    _ensure_ico()
    color = _jitter_color(palette, rng, hue=0.03, val=0.22, sat=0.12)
    bark = (0.045, 0.03, 0.02)
    subdiv = 1 if lod > 0.5 else 0
    base = Vector(base)

    H = scale * rng.uniform(5.0, 8.0)
    tiers = rng.randint(8, 13) if lod > 0.4 else rng.randint(4, 6)
    lean = _rotate_dir(Vector((0, 0, 1)), rng.uniform(0.01, 0.08), rng.uniform(0, math.tau))
    # slightly curved leader (kept short of the crown so no bare tip pokes out)
    leader = [base + lean * (H * 0.92 * i / 6) +
              Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0)) * scale * i
              for i in range(7)]
    tl = []
    ct.add_tube(acc["bark"][0], acc["bark"][1], tl, leader,
                [scale * 0.14 * (1 - i / 7) + 0.01 for i in range(7)],
                sides=6, n_amp=0.05, rng=rng)
    for _ in range(len(acc["bark"][0]) - len(acc["bark"][2])):
        acc["bark"][2].append((bark[0], bark[1], bark[2], 1.0))

    for k in range(tiers):
        t = k / (tiers - 1)                      # 0 base .. 1 top
        center = base + lean * (H * (0.10 + 0.86 * t))
        tier_r = scale * (2.2 * (1.0 - t) ** 1.1 + 0.22)
        droop = rng.uniform(0.2, 0.55)
        n_br = max(4, int((8 - 4 * t) * (1.0 if lod > 0.4 else 0.5)))
        for b in range(n_br):
            ang = rng.uniform(0, math.tau)
            outdir = Vector((math.cos(ang), math.sin(ang), -droop)).normalized()
            tip = center + outdir * tier_r
            _add_branch_tube(acc, center, tip, scale * 0.05 * (1 - t) + 0.01,
                             0.008, rng, sides=4, bark=bark)
            # needle foliage: dark elongated blobs along the branch
            n_blob = 2 if lod > 0.4 else 1
            for j in range(n_blob):
                f = (j + 1) / (n_blob + 1)
                c = center.lerp(tip, f)
                _add_blob(acc, c, scale * (0.5 * (1 - t) + 0.2) * rng.uniform(0.85, 1.15),
                          color, rng, squash=rng.uniform(0.7, 1.0), rough=0.45, subdiv=subdiv)
    # dense conical crown so the leader tip is covered
    crown = base + lean * (H * 0.98)
    _add_blob(acc, crown, scale * 0.55, color, rng, squash=1.6, rough=0.4, subdiv=subdiv)
    _add_blob(acc, crown - lean * (scale * 0.5), scale * 0.7, color, rng,
              squash=1.3, rough=0.4, subdiv=subdiv)


# ------------------------------------------------------------------ realize
def new_accumulators():
    return {"leaf": ([], [], []), "bark": ([], [], [])}


def _colored_material(name, rough, backscatter=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = rough
    if backscatter:
        p.inputs["Subsurface Weight"].default_value = backscatter
        p.inputs["Subsurface Radius"].default_value = (0.4, 0.25, 0.05)
        p.inputs["Subsurface Scale"].default_value = 0.15
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "col"
    nt.links.new(vc.outputs["Color"], p.inputs["Base Color"])
    return m


def make_tree_materials():
    return {"leaf": _colored_material("TreeLeaf", 0.85, backscatter=0.12),
            "bark": _colored_material("TreeBark", 0.9)}


def _make_object(scene, name, verts, faces, cols, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    col = me.color_attributes.new(name="col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(cols):
        col.data[i].color = c
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    scene.collection.objects.link(ob)
    return ob


def realize(scene, acc, mats, prefix="Tree_"):
    _make_object(scene, prefix + "Foliage", *acc["leaf"], mats["leaf"])
    _make_object(scene, prefix + "Bark", *acc["bark"], mats["bark"])
