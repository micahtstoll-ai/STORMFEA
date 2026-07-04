# cattail_lib.py — reusable procedural Typha latifolia geometry + materials.
#
# Pure builders that append geometry into caller-supplied (verts, faces, tvals)
# accumulators, plus a material factory. No scene/render side effects, so both
# the standalone hero shot (cattail.py) and the lake scene import this.
#
# Gradient convention: every vertex carries a param `t` in [0,1] (base->tip),
# baked into a "grad" FLOAT_COLOR attribute and read by the shaders.
import bpy, math, random
from mathutils import Vector, Matrix, noise


# ------------------------------------------------------------------ geometry
def add_leaf(leaf_v, leaf_f, leaf_t, base, azimuth, tilt, L, W,
             bend_max, bend_pow, droop, twist, keel):
    """Sweep a tapered, twisted, keeled ribbon blade along an arched spine."""
    N = 26
    ds = L / N
    spine = [Vector((0, 0, 0))]
    tang = []
    for i in range(N + 1):
        t = i / N
        theta = bend_max * (t ** bend_pow) + droop * (t ** 3)
        T = Vector((math.sin(theta), 0.0, math.cos(theta)))
        tang.append(T)
        if i > 0:
            spine.append(spine[-1] + T * ds)
    M = (Matrix.Translation(base)
         @ Matrix.Rotation(azimuth, 4, 'Z')
         @ Matrix.Rotation(tilt, 4, 'Y'))
    rings = []
    for i in range(N + 1):
        t, P, T = i / N, spine[i], tang[i]
        w = W * min(1.0, 1.25 * (1.0 - t) ** 0.55)      # widest low, point at tip
        wv = Matrix.Rotation(twist * t, 4, T) @ Vector((0, 1, 0))
        wv = (wv - wv.project(T)).normalized()
        fn = T.cross(wv).normalized()
        left, cen, right = P - wv * (w * 0.5), P + fn * (keel * w), P + wv * (w * 0.5)
        row = []
        for pt in (left, cen, right):
            leaf_v.append((M @ pt)[:]); leaf_t.append(t); row.append(len(leaf_v) - 1)
        rings.append(row)
    for i in range(N):
        a, b = rings[i], rings[i + 1]
        leaf_f.append((a[0], a[1], b[1], b[0]))
        leaf_f.append((a[1], a[2], b[2], b[1]))


def add_tube(vlist, flist, tlist, path, radii, sides=10,
             n_amp=0.0, n_scale=6.0, t_lo=0.0, t_hi=1.0, rng=random):
    """Capped tube swept along `path` with per-ring `radii`; optional radial noise."""
    rings = []
    seed = rng.random() * 100
    for k in range(len(path)):
        c = path[k]
        T = (path[k + 1] - c) if k < len(path) - 1 else (c - path[k - 1])
        T.normalize()
        up = Vector((0, 0, 1)) if abs(T.dot(Vector((0, 0, 1)))) <= 0.95 else Vector((0, 1, 0))
        n1 = T.cross(up).normalized()
        n2 = T.cross(n1).normalized()
        tt = k / (len(path) - 1)
        row = []
        for s in range(sides):
            ang = math.tau * s / sides
            r = radii[k]
            if n_amp:
                r *= 1.0 + n_amp * noise.noise(Vector((math.cos(ang) * n_scale,
                                                       math.sin(ang) * n_scale,
                                                       k * 0.5 + seed)))
            p = c + (n1 * math.cos(ang) + n2 * math.sin(ang)) * r
            vlist.append(p[:]); tlist.append(t_lo + (t_hi - t_lo) * tt)
            row.append(len(vlist) - 1)
        rings.append(row)
    for k in range(len(rings) - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            flist.append((rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]))
    cb = len(vlist); vlist.append(path[0][:]); tlist.append(t_lo)
    for s in range(sides):
        flist.append((cb, rings[0][(s + 1) % sides], rings[0][s]))
    ct = len(vlist); vlist.append(path[-1][:]); tlist.append(t_hi)
    for s in range(sides):
        flist.append((ct, rings[-1][s], rings[-1][(s + 1) % sides]))


def build_plant_leaves(leaf_v, leaf_f, leaf_t, base, n, scale, rng=random):
    az0 = rng.uniform(0, math.tau)
    for k in range(n):
        az = az0 + k * (math.tau / n) + rng.uniform(-0.35, 0.35)
        add_leaf(leaf_v, leaf_f, leaf_t, base, az,
                 rng.uniform(0.02, 0.14),
                 scale * rng.uniform(1.0, 1.45),      # length
                 scale * rng.uniform(0.015, 0.021),   # width
                 rng.uniform(0.22, 0.55),             # outward arch
                 rng.uniform(1.4, 2.2),               # bend power
                 rng.uniform(0.3, 1.1),               # tip droop
                 rng.uniform(-0.7, 0.7),              # twist
                 rng.uniform(0.10, 0.18))             # keel


def build_plant_stalk(stem, fem, male, base, scale, has_male, rng=random):
    """stem/fem/male are (verts, faces, tvals) accumulator triples."""
    sv, sf, stt = stem
    Hs = scale * rng.uniform(1.55, 1.95)
    lean = rng.uniform(0.0, 0.10)
    laz = rng.uniform(0, math.tau)
    dx, dy = math.cos(laz) * lean, math.sin(laz) * lean
    steps = 10
    path = [base + Vector((dx * (i / steps) ** 2 * Hs,
                           dy * (i / steps) ** 2 * Hs,
                           Hs * i / steps)) for i in range(steps + 1)]
    radii = [scale * (0.007 - 0.003 * (i / steps)) for i in range(steps + 1)]
    add_tube(sv, sf, stt, path, radii, sides=8, rng=rng)
    top = path[-1]
    Tdir = (path[-1] - path[-2]).normalized()
    # female "corn-dog" spike, rounded ends, felted radial noise
    Lf = scale * rng.uniform(0.16, 0.21)
    Rf = scale * 0.0135
    M, edge = 16, 0.11
    fpath, frad = [], []
    for i in range(M):
        tt = i / (M - 1)
        if tt < edge:
            f = math.sin(math.pi / 2 * tt / edge)
        elif tt > 1 - edge:
            f = math.sin(math.pi / 2 * (1 - tt) / edge)
        else:
            f = 1.0
        fpath.append(top + Tdir * (Lf * tt)); frad.append(Rf * f)
    add_tube(fem[0], fem[1], fem[2], fpath, frad, sides=14, n_amp=0.07, n_scale=5.0, rng=rng)
    if has_male:
        gap = scale * rng.uniform(0.015, 0.03)
        mbase = top + Tdir * (Lf + gap)
        Lm = scale * rng.uniform(0.07, 0.12)
        Rm = scale * 0.006
        mpath, mrad = [], []
        for i in range(12):
            tt = i / 11
            f = math.sin(math.pi * min(max(tt, 0.02), 0.98)) ** 0.4
            mpath.append(mbase + Tdir * (Lm * tt)); mrad.append(Rm * f)
        add_tube(male[0], male[1], male[2], mpath, mrad, sides=10, n_amp=0.05, rng=rng)


def new_accumulators():
    return {"leaf": ([], [], []), "stem": ([], [], []),
            "fem": ([], [], []), "male": ([], [], [])}


def build_clump(acc, center, n_plants, scale_range, spread,
                submerge=(-0.06, 0.02), rng=random, male_prob=0.6, base_z_fn=None):
    """Add a dense clonal clump of cattails around `center` into `acc`."""
    for i in range(n_plants):
        ang = rng.uniform(0, math.tau)
        rad = rng.uniform(0, spread)
        cx = center[0] + math.cos(ang) * rad
        cy = center[1] + math.sin(ang) * rad
        bz = base_z_fn(cx, cy) if base_z_fn else center[2] + rng.uniform(*submerge)
        base = Vector((cx, cy, bz))
        s = rng.uniform(*scale_range)
        build_plant_leaves(*acc["leaf"], base, rng.randint(7, 11), s, rng=rng)
        build_plant_stalk(acc["stem"], acc["fem"], acc["male"], base, s,
                          has_male=(rng.random() < male_prob), rng=rng)


# ------------------------------------------------------------------ materials
def make_cattail_materials(wet=True, warm=False):
    """Returns {'leaf','spike','male','stem'} materials.
       wet  -> clear-coat water film + droplet normal; warm -> drier autumn tone."""
    def principled(name):
        m = bpy.data.materials.new(name); m.use_nodes = True
        return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]

    mat_leaf, lt, lp = principled("CattailLeaf")
    lp.inputs["Roughness"].default_value = 0.34 if wet else 0.5
    lp.inputs["Subsurface Weight"].default_value = 0.20
    lp.inputs["Subsurface Radius"].default_value = (0.30, 0.15, 0.05) if warm else (0.10, 0.30, 0.08)
    lp.inputs["Subsurface Scale"].default_value = 0.02
    lp.inputs["Coat Weight"].default_value = 0.35 if wet else 0.08
    lp.inputs["Coat Roughness"].default_value = 0.06
    lp.inputs["Sheen Weight"].default_value = 0.15
    lvc = lt.nodes.new("ShaderNodeVertexColor"); lvc.layer_name = "grad"
    lramp = lt.nodes.new("ShaderNodeValToRGB"); e = lramp.color_ramp.elements
    if warm:
        e[0].color = (0.050, 0.095, 0.020, 1); e[1].color = (0.34, 0.24, 0.05, 1)
        lramp.color_ramp.elements.new(0.55).color = (0.115, 0.14, 0.04, 1)
    else:
        e[0].color = (0.020, 0.085, 0.020, 1); e[1].color = (0.42, 0.36, 0.06, 1)
        lramp.color_ramp.elements.new(0.55).color = (0.055, 0.20, 0.075, 1)
    lt.links.new(lvc.outputs["Color"], lramp.inputs["Fac"])
    lt.links.new(lramp.outputs["Color"], lp.inputs["Base Color"])
    if wet:
        ldrop = lt.nodes.new("ShaderNodeTexVoronoi")
        ldrop.inputs["Scale"].default_value = 120.0; ldrop.feature = "SMOOTH_F1"
        lbump = lt.nodes.new("ShaderNodeBump")
        lbump.inputs["Strength"].default_value = 0.10
        lbump.inputs["Distance"].default_value = 0.002
        lt.links.new(ldrop.outputs["Distance"], lbump.inputs["Height"])
        lt.links.new(lbump.outputs["Normal"], lp.inputs["Coat Normal"])

    mat_spike, st, sp = principled("SeedSpike")
    sp.inputs["Roughness"].default_value = 0.82
    sp.inputs["Subsurface Weight"].default_value = 0.05
    sn = st.nodes.new("ShaderNodeTexNoise")
    sn.inputs["Scale"].default_value = 55.0; sn.inputs["Detail"].default_value = 8.0
    sn.inputs["Roughness"].default_value = 0.75
    sfine = st.nodes.new("ShaderNodeTexNoise")
    sfine.inputs["Scale"].default_value = 240.0; sfine.inputs["Detail"].default_value = 4.0
    sbump = st.nodes.new("ShaderNodeBump"); sbump.inputs["Strength"].default_value = 0.35
    sbump2 = st.nodes.new("ShaderNodeBump")
    sbump2.inputs["Strength"].default_value = 0.15; sbump2.inputs["Distance"].default_value = 0.001
    st.links.new(sn.outputs["Fac"], sbump.inputs["Height"])
    st.links.new(sbump.outputs["Normal"], sbump2.inputs["Normal"])
    st.links.new(sfine.outputs["Fac"], sbump2.inputs["Height"])
    st.links.new(sbump2.outputs["Normal"], sp.inputs["Normal"])
    svc = st.nodes.new("ShaderNodeVertexColor"); svc.layer_name = "grad"
    sramp = st.nodes.new("ShaderNodeValToRGB")
    sramp.color_ramp.elements[0].color = (0.17, 0.085, 0.035, 1)
    sramp.color_ramp.elements[1].color = (0.11, 0.05, 0.02, 1)
    st.links.new(svc.outputs["Color"], sramp.inputs["Fac"])
    st.links.new(sramp.outputs["Color"], sp.inputs["Base Color"])

    mat_male, mt, mp = principled("MaleSpike")
    mp.inputs["Base Color"].default_value = (0.42, 0.34, 0.16, 1)
    mp.inputs["Roughness"].default_value = 0.85
    mn = mt.nodes.new("ShaderNodeTexNoise")
    mn.inputs["Scale"].default_value = 90.0; mn.inputs["Detail"].default_value = 6.0
    mmb = mt.nodes.new("ShaderNodeBump"); mmb.inputs["Strength"].default_value = 0.30
    mt.links.new(mn.outputs["Fac"], mmb.inputs["Height"])
    mt.links.new(mmb.outputs["Normal"], mp.inputs["Normal"])

    mat_stem, stt, stp = principled("CattailStem")
    stp.inputs["Base Color"].default_value = (0.10, 0.17, 0.05, 1) if warm else (0.08, 0.19, 0.05, 1)
    stp.inputs["Roughness"].default_value = 0.42 if wet else 0.5
    stp.inputs["Coat Weight"].default_value = 0.3 if wet else 0.05
    stp.inputs["Coat Roughness"].default_value = 0.08

    return {"leaf": mat_leaf, "spike": mat_spike, "male": mat_male, "stem": mat_stem}


# ------------------------------------------------------------------ realize
def make_object(scene, name, verts, faces, tvals, material, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces); me.update()
    col = me.color_attributes.new(name="grad", type="FLOAT_COLOR", domain="POINT")
    for i, t in enumerate(tvals):
        col.data[i].color = (t, t, t, 1.0)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    scene.collection.objects.link(ob)
    return ob


def realize(scene, acc, mats, prefix=""):
    make_object(scene, prefix + "Leaves", *acc["leaf"], mats["leaf"])
    make_object(scene, prefix + "Stems", *acc["stem"], mats["stem"])
    make_object(scene, prefix + "FemaleSpikes", *acc["fem"], mats["spike"])
    if acc["male"][0]:
        make_object(scene, prefix + "MaleSpikes", *acc["male"], mats["male"])
