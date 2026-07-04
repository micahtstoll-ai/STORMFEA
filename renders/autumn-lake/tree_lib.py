# tree_lib.py — procedural, guaranteed-unique trees for the autumn lake.
#
# Every tree is driven by its own random.Random(seed): trunk shape, branch
# counts, angles, curvature, taper, foliage placement and colour all come from
# continuous randoms, so two identical trees are effectively impossible.
# Geometry is accumulated into a handful of merged meshes (NOT linked
# instances) grouped by material.
#
# Structural-realism model (per the design spec):
#   * Trunk is a noise-perturbed spline with lean/curvature + a root flare.
#   * Every branch is a curved spline shaped by phototropism (grow toward the
#     light, +Z) early and gravity droop toward the tip.
#   * Child radii follow Leonardo da Vinci's rule: the summed cross-sectional
#     area of the children ~= the parent's area, which preserves believable
#     tapering. The thickest child continues the parent line; thinner children
#     branch off at wider angles.
#
# Reuses cattail_lib.add_tube() for every trunk/branch spline segment.
import math
import colorsys
import bpy
from mathutils import Vector, noise
import cattail_lib as ct


# ------------------------------------------------------------------ helpers
def _perp(v):
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


def _davinci_radii(parent_r, n, rng, alpha=0.92, skew=1.7):
    """Leonardo's rule: sum(child_r^2) ~= alpha * parent_r^2. Returns radii
       sorted descending so the thickest child continues the parent line."""
    weights = [rng.random() ** skew + 0.05 for _ in range(n)]
    s = sum(weights)
    radii = [parent_r * math.sqrt(alpha * w / s) for w in weights]
    radii.sort(reverse=True)
    return radii


def _grow_path(start, direction, length, segs, up_bias, droop, wander, rng):
    """Sample a curved branch spline. Phototropism (+Z) dominates early, gravity
       droop dominates toward the tip, with low-frequency lateral wander."""
    d = direction.normalized()
    pts = [Vector(start)]
    step = length / segs
    seed = rng.random() * 100.0
    up = Vector((0, 0, 1))
    for i in range(segs):
        t = (i + 1) / segs
        lateral = Vector((noise.noise(Vector((seed, t * 2.5, 0.0))),
                          noise.noise(Vector((0.0, t * 2.5, seed))), 0.0)) * wander
        bend = up * (up_bias * (1.0 - t) - droop * t) + lateral
        d = (d + bend / segs * 1.8).normalized()
        pts.append(pts[-1] + d * step)
    return pts


# ------------------------------------------------------------------ foliage
_ICO = {0: None, 1: None, 2: None}


def _ico_geometry(subdiv):
    """(verts, tris) of a unit icosphere at the given subdivision."""
    import bmesh
    me = bpy.data.meshes.new("ico")
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
    bpy.data.meshes.remove(me)
    return verts, tris


def _ensure_ico():
    for k in list(_ICO):
        if _ICO[k] is None:
            _ICO[k] = _ico_geometry(k)


def _add_blob(acc, center, radius, color, rng, squash=1.0, rough=0.35, subdiv=1):
    """Noise-deformed low-poly ico-blob into the leaf accumulator, coloured with
       a height gradient + per-vertex noise baked in."""
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
        t = (pz - zmin) / (zmax - zmin + 1e-6)
        shade = 0.55 + 0.55 * t + rng.uniform(-0.06, 0.06)
        shade *= 1.0 + 0.10 * noise.noise(world * 0.6)
        cols.append((color[0] * shade, color[1] * shade, color[2] * shade, 1.0))
    for tri in ico_t:
        f.append((base + tri[0], base + tri[1], base + tri[2]))


# ------------------------------------------------------------------ bark tubes
def _add_tube_path(acc, path, r0, r1, rng, sides, bark, n_amp=0.08, taper_pow=1.0):
    """Emit a tapered, radially-noised tube along an arbitrary spline path and
       colour its verts with the (already jittered) bark tone + value noise."""
    v, f, cols = acc["bark"]
    start = len(v)
    m = len(path)
    radii = [r1 + (r0 - r1) * (1.0 - i / (m - 1)) ** taper_pow for i in range(m)]
    tl = []
    ct.add_tube(v, f, tl, path, radii, sides=sides, n_amp=n_amp, n_scale=4.0, rng=rng)
    for _ in range(len(v) - start):
        sh = 0.72 + 0.55 * rng.random()
        cols.append((bark[0] * sh, bark[1] * sh, bark[2] * sh, 1.0))


def _add_trunk(acc, base, height, base_r, top_r, lean, curve, rng, bark, sides=8):
    """Noise-perturbed trunk spline with a non-circular root flare. Returns the
       sampled path so branches can be attached along it."""
    segs = 8
    seed = rng.random() * 100.0
    d = lean.normalized()
    curve_axis = _perp(d)
    pts = [Vector(base)]
    step = height / segs
    for i in range(segs):
        t = (i + 1) / segs
        wander = Vector((noise.noise(Vector((seed, t * 2.0, 0.0))),
                         noise.noise(Vector((0.0, t * 2.0, seed))), 0.0)) * 0.06
        d = (d + (curve_axis * curve + wander) / segs).normalized()
        pts.append(pts[-1] + d * step)
    # radii: taper base->top, plus a root flare in the lowest ~12%
    radii = []
    for i in range(segs + 1):
        t = i / segs
        r = top_r + (base_r - top_r) * (1.0 - t) ** 1.4
        if t < 0.12:
            flare = (0.12 - t) / 0.12
            r += base_r * 0.6 * flare * flare
        radii.append(r)
    tl = []
    ct.add_tube(acc["bark"][0], acc["bark"][1], tl, pts, radii,
                sides=sides, n_amp=0.12, n_scale=3.0, rng=rng)   # n_amp high -> non-circular flare
    for _ in range(len(acc["bark"][0]) - len(acc["bark"][2])):
        sh = 0.72 + 0.55 * rng.random()
        acc["bark"][2].append((bark[0] * sh, bark[1] * sh, bark[2] * sh, 1.0))
    return pts


# ------------------------------------------------------------------ broadleaf
def build_broadleaf(acc, base, scale, palette, rng, lod=1.0, foliage=True):
    """Spreading canopy: thick trunk -> upward-curving primaries -> recursive
       da Vinci-tapered sub-branches -> foliage clumps on the twig tips.
       foliage=False renders the bare branch skeleton (for showcase/winter)."""
    _ensure_ico()
    color = _jitter_color(palette, rng)
    bark = _jitter_color((0.05, 0.035, 0.022), rng, hue=0.02, val=0.4, sat=0.2)
    subdiv = 1 if lod > 0.5 else 0
    depth = 4 if lod > 0.6 else (2 if lod > 0.3 else 1)
    base = Vector(base)

    trunk_h = scale * rng.uniform(2.4, 3.6)
    trunk_r = scale * rng.uniform(0.13, 0.20)
    top_r = trunk_r * rng.uniform(0.5, 0.62)
    lean = _rotate_dir(Vector((0, 0, 1)), rng.uniform(0.02, 0.14), rng.uniform(0, math.tau))
    curve = rng.uniform(-0.05, 0.05)
    path = _add_trunk(acc, base, trunk_h, trunk_r, top_r, lean, curve, rng, bark, sides=8)
    top = path[-1]
    tdir = (path[-1] - path[-2]).normalized()

    n_primary = rng.randint(3, 5)
    radii = _davinci_radii(top_r, n_primary + 1, rng)   # +1: trunk continuation stub
    for i, rc in enumerate(radii[1:]):                  # skip the continuation share
        # thicker children stay near the trunk line, thinner ones flare wider
        rank = i / max(1, n_primary - 1)
        spread = rng.uniform(0.45, 0.7) + 0.5 * rank
        d = _rotate_dir(tdir, spread, rng.uniform(0, math.tau))
        d = (d + Vector((0, 0, 0.55))).normalized()     # phototropic lift
        start = top - tdir * (trunk_h * rng.uniform(0.0, 0.25))
        _branch(acc, start, d, scale * rng.uniform(1.4, 2.1), rc,
                depth, rng, color, bark, subdiv, scale, foliage)


def _branch(acc, start, d, length, radius, depth, rng, color, bark, subdiv, scale, foliage=True):
    segs = 4 if depth >= 3 else (3 if depth == 2 else 2)
    up_bias = rng.uniform(0.5, 1.0)          # phototropism: tips curve up
    droop = rng.uniform(0.15, 0.5) * (1.4 - 0.2 * depth)   # heavier/longer -> more droop
    wander = rng.uniform(0.15, 0.4)
    path = _grow_path(start, d, length, segs, up_bias, droop, wander, rng)
    end_r = radius * 0.6
    _add_tube_path(acc, path, radius, end_r, rng, sides=(6 if depth > 1 else 5), bark=bark)
    end = path[-1]
    tip = (path[-1] - path[-2]).normalized()

    if depth <= 1:
        if foliage:
            for _ in range(rng.randint(2, 3)):
                c = end + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3),
                                  rng.uniform(-0.1, 0.3))) * scale
                _add_blob(acc, c, scale * rng.uniform(0.75, 1.2), color, rng,
                          squash=rng.uniform(0.8, 1.15), subdiv=subdiv)
        return

    n = rng.randint(2, 4)
    child_r = _davinci_radii(end_r, n + 1, rng)         # +1: this branch continues
    for i, rc in enumerate(child_r):
        rank = i / max(1, n)
        if i == 0:                                       # continuation: mild turn
            nd = _rotate_dir(tip, rng.uniform(0.1, 0.35), rng.uniform(0, math.tau))
        else:                                            # side branches spread wider
            nd = _rotate_dir(tip, rng.uniform(0.4, 0.9) + 0.3 * rank, rng.uniform(0, math.tau))
        nd = (nd + Vector((0, 0, 0.3))).normalized()
        _branch(acc, end, nd, length * rng.uniform(0.62, 0.82), rc,
                depth - 1, rng, color, bark, subdiv, scale, foliage)


# ------------------------------------------------------------------ conifer
def build_conifer(acc, base, scale, palette, rng, lod=1.0, foliage=True):
    """Conical crown: curved central leader with whorls of drooping foliage
       branches, longest low and shrinking to a dense point.
       foliage=False renders the bare branch skeleton."""
    _ensure_ico()
    color = _jitter_color(palette, rng, hue=0.03, val=0.22, sat=0.12)
    bark = (0.045, 0.03, 0.02)
    subdiv = 1 if lod > 0.5 else 0
    base = Vector(base)

    H = scale * rng.uniform(5.0, 8.0)
    tiers = rng.randint(8, 13) if lod > 0.4 else rng.randint(4, 6)
    lean = _rotate_dir(Vector((0, 0, 1)), rng.uniform(0.01, 0.07), rng.uniform(0, math.tau))
    curve = rng.uniform(-0.03, 0.03)
    leader = _add_trunk(acc, base, H * 0.92, scale * 0.14, scale * 0.02,
                        lean, curve, rng, bark, sides=6)

    def leader_at(frac):
        i = min(len(leader) - 1, max(0, int(frac * (len(leader) - 1))))
        return leader[i]

    for k in range(tiers):
        t = k / (tiers - 1)                               # 0 base .. 1 top
        center = leader_at(0.10 + 0.86 * t)
        tier_r = scale * (2.2 * (1.0 - t) ** 1.1 + 0.22)  # longest low, shrinking up
        # branch angle: lower whorls near-horizontal drooping, upper more upswept
        droop = rng.uniform(0.35, 0.7) * (1.0 - 0.6 * t)
        n_br = max(4, int((8 - 4 * t) * (1.0 if lod > 0.4 else 0.5)))
        for b in range(n_br):
            ang = rng.uniform(0, math.tau)
            outdir = Vector((math.cos(ang), math.sin(ang), -0.15 - droop)).normalized()
            br = scale * 0.045 * (1 - t) + 0.008
            path = _grow_path(center, outdir, tier_r, 3, up_bias=0.0,
                              droop=droop * 1.4, wander=0.2, rng=rng)
            _add_tube_path(acc, path, br, 0.006, rng, sides=4, bark=bark)
            if not foliage:
                continue
            n_blob = 2 if lod > 0.4 else 1
            for j in range(n_blob):
                c = path[min(len(path) - 1, 1 + j)]
                _add_blob(acc, c, scale * (0.5 * (1 - t) + 0.2) * rng.uniform(0.85, 1.15),
                          color, rng, squash=rng.uniform(0.7, 1.0), rough=0.45, subdiv=subdiv)
    if foliage:
        crown = leader_at(1.0)
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
