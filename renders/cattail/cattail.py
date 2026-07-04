# Procedural cattail (Typha latifolia) — hero clump, wet / rain scene, still.
#
# Botany targets:
#   * Each plant = a fan of 7-11 long flat blade leaves (blue-green, twisted,
#     tapering to a point, arching/drooping) growing from a shared base, PLUS
#     a separate stiff round stem topped by a brown felted "corn-dog" seed
#     spike, with a thinner paler male spike above it on some plants.
#   * 9-13 plants in a dense clonal clump at a waterline, bases partly
#     submerged, randomised rotation / scale / jitter so none look cloned.
#
# Technique: leaves are built as tapered, twisted, keeled ribbons swept along
# an integrated arch spine (per-leaf random bend + droop = the "posed wind").
# Spikes are noise-displaced tubes (felted silhouette) with a bump-mapped
# matte material. Leaf shader is SSS + a wet clear-coat layer with droplet
# normal detail. Overcast light + reflective wet water/mud + faint rain streaks.
#
# Run:  blender -b -P cattail.py -- [preview|final]
import bpy, math, random, sys
from mathutils import Vector, Matrix, noise

random.seed(714)

# ---------------------------------------------------------------- quality ---
mode = "final"
if "--" in sys.argv:
    a = sys.argv[sys.argv.index("--") + 1:]
    if a:
        mode = a[0]
SCR = "/tmp/claude-0/-home-user-STORMFEA/e03c2369-f850-53e7-8a78-a274eb7d038a/scratchpad"
if mode == "preview":
    RES_X, RES_Y, SAMPLES = 640, 400, 48
    OUT = SCR + "/cattail_preview.png"
else:
    RES_X, RES_Y, SAMPLES = 1200, 750, 280
    OUT = "/home/user/STORMFEA/renders/cattail/cattail_render.png"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = False          # apt Blender lacks OIDN/OptiX
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 8
scene.cycles.transparent_max_bounces = 12
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "Medium Contrast"
scene.view_settings.exposure = 0.45

WATER_Z = 0.06

# ================================================================ MATERIALS ==
def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]

# --- leaf: SSS + wet clear-coat, base-to-tip gradient from a 'grad' attr ----
mat_leaf, lt, lp = principled("CattailLeaf")
lp.inputs["Roughness"].default_value = 0.34
lp.inputs["Subsurface Weight"].default_value = 0.18
lp.inputs["Subsurface Radius"].default_value = (0.10, 0.30, 0.08)
lp.inputs["Subsurface Scale"].default_value = 0.02
lp.inputs["Coat Weight"].default_value = 0.35          # wet film
lp.inputs["Coat Roughness"].default_value = 0.06
lp.inputs["Sheen Weight"].default_value = 0.15
# gradient
lvc = lt.nodes.new("ShaderNodeVertexColor"); lvc.layer_name = "grad"
lramp = lt.nodes.new("ShaderNodeValToRGB")
e = lramp.color_ramp.elements
e[0].position = 0.0;  e[0].color = (0.020, 0.085, 0.020, 1)   # dark green base
e[1].position = 1.0;  e[1].color = (0.42, 0.36, 0.06, 1)      # yellowing tip
m1 = lramp.color_ramp.elements.new(0.55); m1.color = (0.055, 0.20, 0.075, 1)  # blue-green mid
lt.links.new(lvc.outputs["Color"], lramp.inputs["Fac"])
lt.links.new(lramp.outputs["Color"], lp.inputs["Base Color"])
# droplet sparkle on the wet coat
ldrop = lt.nodes.new("ShaderNodeTexVoronoi"); ldrop.inputs["Scale"].default_value = 120.0
ldrop.feature = "SMOOTH_F1"
lbump = lt.nodes.new("ShaderNodeBump"); lbump.inputs["Strength"].default_value = 0.10
lbump.inputs["Distance"].default_value = 0.002
lt.links.new(ldrop.outputs["Distance"], lbump.inputs["Height"])
lt.links.new(lbump.outputs["Normal"], lp.inputs["Coat Normal"])

# --- seed spike: matte brown, felted (noise bump), not glossy ---------------
mat_spike, st, sp = principled("SeedSpike")
sp.inputs["Base Color"].default_value = (0.14, 0.065, 0.028, 1)
sp.inputs["Roughness"].default_value = 0.82
sp.inputs["Subsurface Weight"].default_value = 0.05
sn = st.nodes.new("ShaderNodeTexNoise")
sn.inputs["Scale"].default_value = 55.0
sn.inputs["Detail"].default_value = 8.0
sn.inputs["Roughness"].default_value = 0.75
sfine = st.nodes.new("ShaderNodeTexNoise")
sfine.inputs["Scale"].default_value = 240.0
sfine.inputs["Detail"].default_value = 4.0
sbump = st.nodes.new("ShaderNodeBump"); sbump.inputs["Strength"].default_value = 0.35
sbump2 = st.nodes.new("ShaderNodeBump"); sbump2.inputs["Strength"].default_value = 0.15
sbump2.inputs["Distance"].default_value = 0.001
st.links.new(sn.outputs["Fac"], sbump.inputs["Height"])
st.links.new(sbump.outputs["Normal"], sbump2.inputs["Normal"])
st.links.new(sfine.outputs["Fac"], sbump2.inputs["Height"])
st.links.new(sbump2.outputs["Normal"], sp.inputs["Normal"])
# subtle base-to-tip tone via same gradient attr on the spike
svc = st.nodes.new("ShaderNodeVertexColor"); svc.layer_name = "grad"
sramp = st.nodes.new("ShaderNodeValToRGB")
sramp.color_ramp.elements[0].color = (0.17, 0.085, 0.035, 1)
sramp.color_ramp.elements[1].color = (0.11, 0.05, 0.02, 1)
st.links.new(svc.outputs["Color"], sramp.inputs["Fac"])
st.links.new(sramp.outputs["Color"], sp.inputs["Base Color"])

# --- male spike: paler, drier ------------------------------------------------
mat_male, mt, mp = principled("MaleSpike")
mp.inputs["Base Color"].default_value = (0.42, 0.34, 0.16, 1)
mp.inputs["Roughness"].default_value = 0.85
mn = mt.nodes.new("ShaderNodeTexNoise"); mn.inputs["Scale"].default_value = 90.0
mn.inputs["Detail"].default_value = 6.0
mmb = mt.nodes.new("ShaderNodeBump"); mmb.inputs["Strength"].default_value = 0.30
mt.links.new(mn.outputs["Fac"], mmb.inputs["Height"])
mt.links.new(mmb.outputs["Normal"], mp.inputs["Normal"])

# --- stem: green, wet ---------------------------------------------------------
mat_stem, stt, stp = principled("Stem")
stp.inputs["Base Color"].default_value = (0.08, 0.19, 0.05, 1)
stp.inputs["Roughness"].default_value = 0.42
stp.inputs["Coat Weight"].default_value = 0.3
stp.inputs["Coat Roughness"].default_value = 0.08

# --- water: dark near-mirror with ripples ------------------------------------
mat_water, wt, wp = principled("Water")
wp.inputs["Base Color"].default_value = (0.012, 0.020, 0.020, 1)
wp.inputs["Roughness"].default_value = 0.035
wp.inputs["IOR"].default_value = 1.33
wnz = wt.nodes.new("ShaderNodeTexNoise"); wnz.inputs["Scale"].default_value = 12.0
wnz.inputs["Detail"].default_value = 8.0
wtc = wt.nodes.new("ShaderNodeTexCoord")
wmp = wt.nodes.new("ShaderNodeMapping"); wmp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
wbmp = wt.nodes.new("ShaderNodeBump"); wbmp.inputs["Strength"].default_value = 0.06
wt.links.new(wtc.outputs["Object"], wmp.inputs["Vector"])
wt.links.new(wmp.outputs["Vector"], wnz.inputs["Vector"])
wt.links.new(wnz.outputs["Fac"], wbmp.inputs["Height"])
wt.links.new(wbmp.outputs["Normal"], wp.inputs["Normal"])

# --- wet mud bank ------------------------------------------------------------
mat_mud, mdt, mdp = principled("Mud")
mdp.inputs["Base Color"].default_value = (0.035, 0.026, 0.018, 1)
mdp.inputs["Roughness"].default_value = 0.28          # wet sheen
mdnz = mdt.nodes.new("ShaderNodeTexNoise"); mdnz.inputs["Scale"].default_value = 18.0
mdnz.inputs["Detail"].default_value = 8.0
mdb = mdt.nodes.new("ShaderNodeBump"); mdb.inputs["Strength"].default_value = 0.25
mdt.links.new(mdnz.outputs["Fac"], mdb.inputs["Height"])
mdt.links.new(mdb.outputs["Normal"], mdp.inputs["Normal"])

# --- faint rain streak material ---------------------------------------------
mat_rain = bpy.data.materials.new("Rain"); mat_rain.use_nodes = True
rt = mat_rain.node_tree; rt.nodes.clear()
r_out = rt.nodes.new("ShaderNodeOutputMaterial")
r_mix = rt.nodes.new("ShaderNodeMixShader"); r_mix.inputs["Fac"].default_value = 0.94
r_tr = rt.nodes.new("ShaderNodeBsdfTransparent")
r_em = rt.nodes.new("ShaderNodeEmission")
r_em.inputs["Color"].default_value = (0.72, 0.78, 0.85, 1)
r_em.inputs["Strength"].default_value = 0.75
rt.links.new(r_tr.outputs["BSDF"], r_mix.inputs[1])
rt.links.new(r_em.outputs["Emission"], r_mix.inputs[2])
rt.links.new(r_mix.outputs["Shader"], r_out.inputs["Surface"])

# ================================================================ GEOMETRY ==
leaf_v, leaf_f, leaf_t = [], [], []      # verts, faces, gradient t per vert

def add_leaf(base, azimuth, tilt, L, W, bend_max, bend_pow, droop, twist, keel):
    """Sweep a tapered, twisted, keeled ribbon along an arched spine."""
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
    # world transform for this leaf: lift to base, lean out, rotate around clump
    M = (Matrix.Translation(base)
         @ Matrix.Rotation(azimuth, 4, 'Z')
         @ Matrix.Rotation(tilt, 4, 'Y'))
    rings = []
    for i in range(N + 1):
        t = i / N
        P, T = spine[i], tang[i]
        taper = min(1.0, 1.25 * (1.0 - t) ** 0.55)      # widest low, point at tip
        w = W * taper
        wv = Matrix.Rotation(twist * t, 4, T) @ Vector((0, 1, 0))   # blade width dir
        wv = (wv - wv.project(T)).normalized()
        fn = T.cross(wv).normalized()                   # blade face normal
        left = P - wv * (w * 0.5)
        cen = P + fn * (keel * w)                        # raised keel -> shallow V
        right = P + wv * (w * 0.5)
        row = []
        for pt in (left, cen, right):
            leaf_v.append((M @ pt)[:])
            leaf_t.append(t)
            row.append(len(leaf_v) - 1)
        rings.append(row)
    for i in range(N):
        a, b = rings[i], rings[i + 1]
        leaf_f.append((a[0], a[1], b[1], b[0]))
        leaf_f.append((a[1], a[2], b[2], b[1]))

def build_plant_leaves(base, n, scale):
    az0 = random.uniform(0, math.tau)
    for k in range(n):
        az = az0 + k * (math.tau / n) + random.uniform(-0.35, 0.35)
        L = scale * random.uniform(1.0, 1.45)
        W = scale * random.uniform(0.015, 0.021)
        bend = random.uniform(0.22, 0.55)               # radians of outward arch
        droop = random.uniform(0.3, 1.1)                # extra tip droop
        twist = random.uniform(-0.7, 0.7)
        tilt = random.uniform(0.02, 0.14)
        add_leaf(base, az, tilt, L, W, bend, random.uniform(1.4, 2.2),
                 droop, twist, random.uniform(0.10, 0.18))

# --- generic noise-displaced tube (stems + spikes) --------------------------
def add_tube(vlist, flist, tlist, path, radii, sides=10,
             n_amp=0.0, n_scale=6.0, t_lo=0.0, t_hi=1.0):
    rings = []
    seed = random.random() * 100
    for k in range(len(path)):
        c = path[k]
        T = (path[k + 1] - c) if k < len(path) - 1 else (c - path[k - 1])
        T.normalize()
        up = Vector((0, 0, 1))
        if abs(T.dot(up)) > 0.95:
            up = Vector((0, 1, 0))
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
    # caps
    cb = len(vlist); vlist.append(path[0][:]); tlist.append(t_lo)
    for s in range(sides):
        flist.append((cb, rings[0][(s + 1) % sides], rings[0][s]))
    ct = len(vlist); vlist.append(path[-1][:]); tlist.append(t_hi)
    for s in range(sides):
        flist.append((ct, rings[-1][s], rings[-1][(s + 1) % sides]))

stem_v, stem_f, stem_t = [], [], []
fem_v, fem_f, fem_t = [], [], []
male_v, male_f, male_t = [], [], []

def build_plant_stalk(base, scale, has_male):
    Hs = scale * random.uniform(1.55, 1.95)             # stem height (spike clears leaves)
    lean = random.uniform(0.0, 0.10)
    laz = random.uniform(0, math.tau)
    dx, dy = math.cos(laz) * lean, math.sin(laz) * lean
    steps = 10
    path = [base + Vector((dx * (i / steps) ** 2 * Hs,
                           dy * (i / steps) ** 2 * Hs,
                           Hs * i / steps)) for i in range(steps + 1)]
    radii = [scale * (0.007 - 0.003 * (i / steps)) for i in range(steps + 1)]
    add_tube(stem_v, stem_f, stem_t, path, radii, sides=8)
    top = path[-1]
    Tdir = (path[-1] - path[-2]).normalized()
    # female spike: rounded-ended felted cylinder
    Lf = scale * random.uniform(0.16, 0.21)
    Rf = scale * 0.0135
    M = 16
    fpath, frad = [], []
    edge = 0.11
    for i in range(M):
        tt = i / (M - 1)
        if tt < edge:
            f = math.sin(math.pi / 2 * tt / edge)
        elif tt > 1 - edge:
            f = math.sin(math.pi / 2 * (1 - tt) / edge)
        else:
            f = 1.0
        fpath.append(top + Tdir * (Lf * tt)); frad.append(Rf * f)
    add_tube(fem_v, fem_f, fem_t, fpath, frad, sides=14, n_amp=0.07, n_scale=5.0)
    if has_male:
        gap = scale * random.uniform(0.015, 0.03)
        mbase = top + Tdir * (Lf + gap)
        Lm = scale * random.uniform(0.07, 0.12)
        Rm = scale * 0.006
        mpath, mrad = [], []
        for i in range(12):
            tt = i / 11
            f = math.sin(math.pi * min(max(tt, 0.02), 0.98)) ** 0.4
            mpath.append(mbase + Tdir * (Lm * tt)); mrad.append(Rm * f)
        add_tube(male_v, male_f, male_t, mpath, mrad, sides=10, n_amp=0.05)

# --- scatter the clump along a short shoreline arc ---------------------------
N_PLANTS = 12
for i in range(N_PLANTS):
    u = i / (N_PLANTS - 1)
    cx = (u - 0.5) * 1.5
    cy = 0.28 * math.sin(u * math.pi) + random.uniform(-0.10, 0.10)  # gentle arc
    cx += random.uniform(-0.10, 0.10)
    bz = random.uniform(-0.06, 0.02)                    # some bases submerged
    base = Vector((cx, cy, bz))
    scale = random.uniform(0.85, 1.15)
    build_plant_leaves(base, random.randint(7, 11), scale)
    build_plant_stalk(base, scale, has_male=(random.random() < 0.6))

def make_object(name, verts, faces, tvals, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    col = me.color_attributes.new(name="grad", type="FLOAT_COLOR", domain="POINT")
    for i, t in enumerate(tvals):
        col.data[i].color = (t, t, t, 1.0)
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    scene.collection.objects.link(ob)
    return ob

make_object("Leaves", leaf_v, leaf_f, leaf_t, mat_leaf)
make_object("Stems", stem_v, stem_f, stem_t, mat_stem)
make_object("FemaleSpikes", fem_v, fem_f, fem_t, mat_spike)
if male_v:
    make_object("MaleSpikes", male_v, male_f, male_t, mat_male)

# ================================================================ ENVIRONMENT
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, WATER_Z))
bpy.context.object.name = "Water"; bpy.context.object.data.materials.append(mat_water)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.35))
bpy.context.object.name = "Bottom"; bpy.context.object.data.materials.append(mat_mud)
# (no bank plane: water meets the overcast sky at a clean, moody horizon)

# faint thin rain streaks (motion-blur look) between camera and clump
bpy.ops.mesh.primitive_cylinder_add(radius=0.0005, depth=0.22, vertices=4,
                                     location=(0, -50, 0))
rain_tpl = bpy.context.object; rain_tpl.name = "RainTpl"
rain_tpl.data.materials.append(mat_rain); rain_tpl.hide_render = True
for i in range(340):
    r = bpy.data.objects.new("Rain", rain_tpl.data)
    r.location = (random.uniform(-2.6, 2.6), random.uniform(-2.6, 0.2),
                  random.uniform(0.15, 2.5))
    r.rotation_euler = (math.radians(random.uniform(3, 9)), 0,
                        random.uniform(0, math.tau))
    r.scale = (1, 1, random.uniform(0.5, 1.4))
    scene.collection.objects.link(r)

# --- cool overcast world: elevation-based grey gradient ----------------------
world = bpy.data.worlds.new("Overcast"); scene.world = world
world.use_nodes = True
wn = world.node_tree; wn.nodes.clear()
wgeo = wn.nodes.new("ShaderNodeNewGeometry")
wsep = wn.nodes.new("ShaderNodeSeparateXYZ")
wmr = wn.nodes.new("ShaderNodeMapRange")
wmr.inputs["From Min"].default_value = -0.15
wmr.inputs["From Max"].default_value = 0.55
wramp = wn.nodes.new("ShaderNodeValToRGB")
wramp.color_ramp.elements[0].color = (0.40, 0.42, 0.44, 1)   # dim horizon haze
wramp.color_ramp.elements[1].color = (0.52, 0.57, 0.64, 1)   # cool grey zenith
wbg = wn.nodes.new("ShaderNodeBackground"); wbg.inputs["Strength"].default_value = 1.0
wout = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(wgeo.outputs["Incoming"], wsep.inputs["Vector"])
wn.links.new(wsep.outputs["Z"], wmr.inputs["Value"])
wn.links.new(wmr.outputs["Result"], wramp.inputs["Fac"])
wn.links.new(wramp.outputs["Color"], wbg.inputs["Color"])
wn.links.new(wbg.outputs["Background"], wout.inputs["Surface"])

# soft key + fill (diffuse overcast look)
sun = bpy.data.lights.new("Key", "SUN"); sun.energy = 2.4; sun.angle = math.radians(9)
sun.color = (0.82, 0.86, 0.96)
so = bpy.data.objects.new("Key", sun); so.rotation_euler = (math.radians(46), 0, math.radians(155))
scene.collection.objects.link(so)
area = bpy.data.lights.new("Fill", "AREA"); area.energy = 60; area.size = 6
area.color = (0.8, 0.85, 0.95)
ao = bpy.data.objects.new("Fill", area); ao.location = (-3, -3, 3)
ao.rotation_euler = (math.radians(55), 0, math.radians(-45))
scene.collection.objects.link(ao)

# --- camera: low hero angle across the water --------------------------------
cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 35
cam = bpy.data.objects.new("Camera", cam_d)
cam.location = (1.6, -3.1, 0.85)
tgt = Vector((0.0, 0.05, 1.15))
cam.rotation_euler = (tgt - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam); scene.camera = cam

bpy.ops.render.render(write_still=True)
print("RENDER DONE ->", OUT)
