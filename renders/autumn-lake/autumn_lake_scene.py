# Autumn lake at sunset — procedural Blender scene
# Recreates a photo: calm forest lake at dusk, red/orange autumn trees on the
# left bank, dark conifers on the right, warm sky glow reflected in the water,
# reeds and grass in the foreground.
#
# Run headless:  blender -b -P autumn_lake_scene.py -- [preview|final]
import bpy
import math
import random
import sys
import os
from mathutils import noise, Vector

# shared procedural generators: cattails (renders/cattail) + trees (this dir)
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(_HERE, "..", "cattail"))
sys.path.append(_HERE)
import cattail_lib as ct
import tree_lib

random.seed(20260703)

# ---------------------------------------------------------------- quality ---
mode = "final"
if "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    if args:
        mode = args[0]

# Composable render flags in the mode string, e.g. "final", "final-hd",
# "final-rain", "final-rain-hd", "preview-rain":
#   hd   -> Cycles Adaptive Subdivision (micropolygon displacement); heavy.
#   rain -> "Autumn Rain": overcast world + volumetric mist + rain-ripple water.
_tok = set(mode.split("-"))
IS_PREVIEW = "preview" in _tok
HD = "hd" in _tok
RAIN = "rain" in _tok

if IS_PREVIEW:
    RES_X, RES_Y = 640, 360
    SAMPLES = 64 if (HD or RAIN) else 32
    OUT = "/tmp/claude-0/-home-user-STORMFEA/e03c2369-f850-53e7-8a78-a274eb7d038a/scratchpad/preview.png"
else:
    RES_X, RES_Y = 1280, 720
    SAMPLES = 128 if HD else (170 if RAIN else 256)
    _suffix = ("_rain" if RAIN else "") + ("_hd" if HD else "")
    OUT = f"/home/user/STORMFEA/renders/autumn-lake/autumn_lake_render{_suffix}.png"

# ------------------------------------------------------------ scene setup ---
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
# apt build of Blender ships without OIDN/OptiX denoisers
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 6
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "Medium High Contrast"
scene.view_settings.exposure = 1.3

# ------------------------------------------------------------------ world ---
world = bpy.data.worlds.new("SunsetSky")
scene.world = world
world.use_nodes = True
wn = world.node_tree
wn.nodes.clear()
sky = wn.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(2.5)
sky.sun_rotation = math.radians(180.0)  # sun ahead of camera (+Y)
sky.sun_size = math.radians(1.5)
sky.sun_intensity = 1.0
sky.altitude = 0
sky.air_density = 1.8
sky.dust_density = 5.5
sky.ozone_density = 2.5
bg = wn.nodes.new("ShaderNodeBackground")
bg.inputs["Strength"].default_value = 0.35
out = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(sky.outputs["Color"], bg.inputs["Color"])
wn.links.new(bg.outputs["Background"], out.inputs["Surface"])

# -------------------------------------------------------------- materials ---
def simple_mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1.0)
    p.inputs["Roughness"].default_value = rough
    return m

# trunk material kept for the fallen log & stump; tree foliage/bark now come
# from tree_lib's vertex-colour materials (per-tree colour lives in the mesh)
mat_trunk = simple_mat("Trunk", (0.05, 0.03, 0.02))

# ground: noisy mix of grass green and autumn brown
mat_ground = bpy.data.materials.new("Ground")
mat_ground.use_nodes = True
gn = mat_ground.node_tree
gp = gn.nodes["Principled BSDF"]
gp.inputs["Roughness"].default_value = 1.0
gtex = gn.nodes.new("ShaderNodeTexNoise")
gtex.inputs["Scale"].default_value = 3.0
gramp = gn.nodes.new("ShaderNodeValToRGB")
gramp.color_ramp.elements[0].color = (0.06, 0.10, 0.02, 1)   # grass green
gramp.color_ramp.elements[1].color = (0.16, 0.09, 0.025, 1)  # dry brown
gn.links.new(gtex.outputs["Fac"], gramp.inputs["Fac"])
gn.links.new(gramp.outputs["Color"], gp.inputs["Base Color"])

# water: dark, near-mirror, fine ripples
mat_water = bpy.data.materials.new("Water")
mat_water.use_nodes = True
wnodes = mat_water.node_tree
wp = wnodes.nodes["Principled BSDF"]
wp.inputs["Base Color"].default_value = (0.010, 0.015, 0.014, 1)
wp.inputs["Roughness"].default_value = 0.02
wp.inputs["IOR"].default_value = 1.33
wtex = wnodes.nodes.new("ShaderNodeTexNoise")
wtex.inputs["Scale"].default_value = 30.0
wtex.inputs["Detail"].default_value = 8.0
wcoord = wnodes.nodes.new("ShaderNodeTexCoord")
wmap = wnodes.nodes.new("ShaderNodeMapping")
wmap.inputs["Scale"].default_value = (0.35, 3.5, 1.0)  # horizontal ripple streaks
wnodes.links.new(wcoord.outputs["Object"], wmap.inputs["Vector"])
wnodes.links.new(wmap.outputs["Vector"], wtex.inputs["Vector"])
wbump = wnodes.nodes.new("ShaderNodeBump")
wbump.inputs["Strength"].default_value = 0.02
wnodes.links.new(wtex.outputs["Fac"], wbump.inputs["Height"])
wnodes.links.new(wbump.outputs["Normal"], wp.inputs["Normal"])

# ------------------------------------------------------------- landscape ---
# Lake = ellipse in the XY plane; ground rises away from its rim.
def lake_e(x, y):
    return (x / 26.0) ** 2 + ((y - 8.0) / 52.0) ** 2

def ground_h(x, y):
    e = lake_e(x, y)
    h = 2.2 * (e - 1.0)
    h = max(min(h, 6.0), -3.0)
    if h > 0.05:
        roll = noise.noise(Vector((x * 0.04, y * 0.04, 0.0)))
        h += min(h, 1.0) * roll * 0.8  # <= 0.8*h, so the shore stays above water
    return h

GRID_N, GRID_M = 130, 150
X0, X1, Y0, Y1 = -85.0, 85.0, -65.0, 125.0
verts, faces = [], []
for j in range(GRID_M + 1):
    y = Y0 + (Y1 - Y0) * j / GRID_M
    for i in range(GRID_N + 1):
        x = X0 + (X1 - X0) * i / GRID_N
        verts.append((x, y, ground_h(x, y)))
for j in range(GRID_M):
    for i in range(GRID_N):
        a = j * (GRID_N + 1) + i
        faces.append((a, a + 1, a + GRID_N + 2, a + GRID_N + 1))
gmesh = bpy.data.meshes.new("GroundMesh")
gmesh.from_pydata(verts, [], faces)
gmesh.update()
ground = bpy.data.objects.new("Ground", gmesh)
ground.data.materials.append(mat_ground)
scene.collection.objects.link(ground)
for poly in gmesh.polygons:
    poly.use_smooth = True

bpy.ops.mesh.primitive_plane_add(size=500, location=(0, 20, 0.0))
water = bpy.context.object
water.name = "Water"
water.data.materials.append(mat_water)

# ------------------------------------------------------------------ trees ---
# Every tree is generated fresh from its own random.Random(seed) via tree_lib,
# so no two share geometry or colour (see tree_lib.py). Autumn palettes below
# get a per-tree hue/value jitter inside the generator.
PALETTE = {
    "red":    (0.42, 0.03, 0.008),
    "orange": (0.55, 0.13, 0.01),
    "yellow": (0.55, 0.32, 0.02),
    "birch":  (0.60, 0.42, 0.05),
    "pine":   (0.020, 0.060, 0.020),
    "pine2":  (0.030, 0.080, 0.025),
}
BROADLEAF = {"red", "orange", "yellow", "birch"}

def pick_species(x, y):
    """Return a palette key, biome-weighted by bank (matches the old layout)."""
    r = random.random()
    if y > 55:                       # far shoreline: mostly conifers
        if r < 0.55:
            return random.choice(["pine", "pine2"])
        return random.choice(["orange", "yellow", "red", "birch"])
    if x < 0:                        # left bank: blazing autumn
        if r < 0.50:
            return "red"
        if r < 0.72:
            return "orange"
        if r < 0.86:
            return random.choice(["yellow", "birch"])
        return random.choice(["pine", "pine2"])
    else:                            # right bank: dark conifers with accents
        if r < 0.72:
            return random.choice(["pine", "pine2"])
        if r < 0.85:
            return "orange"
        if r < 0.94:
            return "yellow"
        return "red"

CAM_XY = Vector((0.0, -51.5))        # for distance-based level of detail
tree_mats = tree_lib.make_tree_materials()
tree_acc = tree_lib.new_accumulators()

placed = 0
attempts = 0
while placed < 650 and attempts < 20000:
    attempts += 1
    x = random.uniform(-80, 80)
    y = random.uniform(-58, 118)
    e = lake_e(x, y)
    if e < 1.04 or e > 5.0:
        continue
    h = ground_h(x, y)
    if h < 0.12:
        continue
    # keep the near shore around the camera clear
    if y < -32 and abs(x) < 16:
        continue
    key = pick_species(x, y)
    s = random.uniform(0.7, 1.5)
    if y < -20:  # trees near the camera stay modest so they don't block the frame
        s = min(s, 1.05)
    s *= random.uniform(0.9, 1.3)
    # detail falls off with distance so far background trees stay cheap
    dist = (Vector((x, y)) - CAM_XY).length
    lod = max(0.0, min(1.0, 1.25 - dist / 90.0))
    base = (x, y, h - 0.15)
    rng = random.Random(placed * 2654435761 & 0xFFFFFFFF)
    if key in BROADLEAF:
        tree_lib.build_broadleaf(tree_acc, base, s, PALETTE[key], rng, lod=lod)
    else:
        tree_lib.build_conifer(tree_acc, base, s, PALETTE[key], rng, lod=lod)
    placed += 1

tree_lib.realize(scene, tree_acc, tree_mats)

# --------------------------------------------------------------- cattails ---
# Real procedural Typha latifolia clumps lining the near shore, replacing the
# old crude reeds. Warm/dry material variant so they read against the sunset;
# strongly backlit by the low sun -> orange-rimmed silhouettes as in the photo.
def near_shore_y(x):
    """y of the near (camera-side) waterline for a given x on the lake ellipse."""
    v = 1.0 - (x / 26.0) ** 2
    return 8.0 - 52.0 * math.sqrt(max(v, 0.0))

def cattail_base_z(x, y):
    """Sit bases right at the waterline, a touch submerged."""
    return max(min(ground_h(x, y), 0.05), -0.18)

cat_mats = ct.make_cattail_materials(wet=False, warm=True)
cat_acc = ct.new_accumulators()

# dense fringe strung along the whole near shoreline arc
for x in range(-34, 35, 3):
    ys = near_shore_y(x)
    cx = x + random.uniform(-1.6, 1.6)
    cy = ys + random.uniform(-1.6, 0.8)
    dist = abs(x)
    n = random.randint(7, 11) if dist < 20 else random.randint(4, 7)
    smin = 1.3 - dist * 0.010            # centre clumps taller than the wings
    ct.build_clump(cat_acc, (cx, cy, 0.0), n,
                   (max(0.8, smin), max(1.0, smin + 0.5)), spread=2.4,
                   rng=random, male_prob=0.55, base_z_fn=cattail_base_z)

# tall hero clumps just in front of the waterline -> foreground silhouettes
for cx, cy in [(-11, -47.0), (-4, -48.0), (4.5, -48.2), (11.5, -47.2), (0.0, -49.2)]:
    ct.build_clump(cat_acc, (cx + random.uniform(-1, 1), cy, 0.0),
                   random.randint(10, 15), (1.5, 2.3), spread=2.0,
                   rng=random, male_prob=0.6, base_z_fn=cattail_base_z)

ct.realize(scene, cat_acc, cat_mats, prefix="Cattail_")

# fallen log and stump on the near bank, as in the reference photo
log_h = ground_h(5.5, -49.5)
bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=3.2, location=(5.5, -49.5, log_h + 0.15))
log = bpy.context.object
log.name = "FallenLog"
log.rotation_euler = (0, math.radians(88), math.radians(25))
log.data.materials.append(mat_trunk)
stump_h = ground_h(3.2, -48.5)
bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.6, location=(3.2, -48.5, stump_h + 0.25))
stump = bpy.context.object
stump.name = "Stump"
stump.data.materials.append(mat_trunk)

# ------------------------------------------------------------------ clouds --
# emissive noise-masked plane high above the horizon ahead, catching the
# sunset color in both sky and reflection
mat_cloud = bpy.data.materials.new("Clouds")
mat_cloud.use_nodes = True
cn = mat_cloud.node_tree
cn.nodes.clear()
c_out = cn.nodes.new("ShaderNodeOutputMaterial")
c_mix = cn.nodes.new("ShaderNodeMixShader")
c_trans = cn.nodes.new("ShaderNodeBsdfTransparent")
c_emit = cn.nodes.new("ShaderNodeEmission")
c_emit.inputs["Color"].default_value = (1.0, 0.48, 0.30, 1.0)
c_emit.inputs["Strength"].default_value = 6.0
c_noise = cn.nodes.new("ShaderNodeTexNoise")
c_noise.inputs["Scale"].default_value = 2.2
c_noise.inputs["Detail"].default_value = 8.0
c_noise.inputs["Roughness"].default_value = 0.65
c_ramp = cn.nodes.new("ShaderNodeValToRGB")
c_ramp.color_ramp.elements[0].position = 0.52
c_ramp.color_ramp.elements[1].position = 0.72
c_coord = cn.nodes.new("ShaderNodeTexCoord")
c_map = cn.nodes.new("ShaderNodeMapping")
c_map.inputs["Scale"].default_value = (1.0, 2.5, 1.0)  # streaky clouds
cn.links.new(c_coord.outputs["Object"], c_map.inputs["Vector"])
cn.links.new(c_map.outputs["Vector"], c_noise.inputs["Vector"])
cn.links.new(c_noise.outputs["Fac"], c_ramp.inputs["Fac"])
cn.links.new(c_ramp.outputs["Color"], c_mix.inputs["Fac"])
cn.links.new(c_trans.outputs["BSDF"], c_mix.inputs[1])
cn.links.new(c_emit.outputs["Emission"], c_mix.inputs[2])
cn.links.new(c_mix.outputs["Shader"], c_out.inputs["Surface"])

bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 650, 130))
clouds = bpy.context.object
clouds.name = "Clouds"
clouds.scale = (2200, 900, 1)
clouds.data.materials.append(mat_cloud)
clouds.visible_shadow = False

# ----------------------------------------------------------------- camera ---
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 24
cam = bpy.data.objects.new("Camera", cam_data)
cam.location = (0, -51.5, 2.5)
target = Vector((0, 40, 0.5))
direction = target - Vector(cam.location)
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

# ----------------------------------------------------------- Autumn Rain mood --
# Overcast world (no sun) + volumetric mist + rain-ripple water. Only runs in the
# "*-rain" modes so the default sunset render is untouched.
if RAIN:
    import rain_lib as rl
    # cooler, dimmer grade for the overcast mood
    scene.view_settings.look = "Medium Contrast"
    scene.view_settings.exposure = 0.4
    # 1. heavy overcast sky (soft diffuse cool light, no harsh sun shadows)
    rl.make_overcast_world(scene, strength=1.3)
    clouds.hide_render = True                      # drop the warm sunset clouds
    # 2. volumetric rain mist wrapping the camera + lake -> atmospheric depth
    rl.add_volumetric_mist(scene, bounds=(-95, 95, -70, 125, -6, 30),
                           density=0.010, anisotropy=0.7)
    # 3. procedural rain ripples break the mirror into hundreds of splashes
    rl.apply_rain_ripples(mat_water, scale=1.6, strength=0.32)

# --------------------------------------- high-detail micropolygon displacement --
# Cycles Adaptive Subdivision gives the ground, mud and rocks true 4K geometric
# relief. Screen-adaptive dicing keeps the foreground crisp while the rest stays
# cheap. Only runs in the "*-hd" modes so the normal render is untouched.
if HD:
    import displace_lib as dl
    dl.enable_experimental(scene, dicing=1.0, offscreen=8.0, preview=8.0)

    # (a) existing ground: adaptive subdiv + micro clods/pebbles. Slightly coarser
    #     per-object dicing since it spans the whole scene.
    dl.add_adaptive_subdiv(ground, dicing_rate=2.0, simple=True)
    dl.set_displacement(mat_ground, "ground", scale=0.08, midlevel=0.5)

    # (b) mud apron conforming to the near shoreline in the foreground bank
    mat_mud_hd = simple_mat("MudHD", (0.055, 0.040, 0.026), rough=0.95)
    mv, mf = [], []
    MX0, MX1, MY0, MY1 = -30.0, 30.0, -53.0, -41.0
    NX, NY = 40, 14
    for j in range(NY + 1):
        yy = MY0 + (MY1 - MY0) * j / NY
        for i in range(NX + 1):
            xx = MX0 + (MX1 - MX0) * i / NX
            mv.append((xx, yy, ground_h(xx, yy) + 0.03))
    for j in range(NY):
        for i in range(NX):
            a = j * (NX + 1) + i
            mf.append((a, a + 1, a + NX + 2, a + NX + 1))
    mud_mesh = bpy.data.meshes.new("MudMesh")
    mud_mesh.from_pydata(mv, [], mf)
    mud_mesh.update()
    for poly in mud_mesh.polygons:
        poly.use_smooth = True
    mud = bpy.data.objects.new("Mud", mud_mesh)
    mud.data.materials.append(mat_mud_hd)
    scene.collection.objects.link(mud)
    dl.add_adaptive_subdiv(mud, dicing_rate=1.0, simple=True)
    dl.set_displacement(mat_mud_hd, "mud", scale=0.06, midlevel=0.5)

    # (c) boulders along the foreground shore -> craggy *real* geometry (the
    #     silhouette detail is genuine subdivided mesh, not a bump fake).
    mat_rock_hd = simple_mat("RockHD", (0.13, 0.115, 0.10), rough=0.85)
    dl.set_displacement(mat_rock_hd, "rock", scale=0.22, midlevel=0.5)
    # hero boulders in the visible mid-foreground, nestled between the reed clumps
    hero = [(-13.0, -48.5, 1.6), (-6.0, -49.0, 1.9), (6.5, -49.0, 1.8),
            (14.0, -48.0, 1.4)]
    scatter = [(random.uniform(-26, 26), random.uniform(-47.0, -42.0),
                random.uniform(0.5, 1.2)) for _ in range(10)]
    for k, (rx, ry, rr) in enumerate(hero + scatter):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2, radius=rr,
            location=(rx, ry, ground_h(rx, ry) + rr * 0.5))
        rock = bpy.context.object
        rock.name = f"Rock_{k}"
        rock.scale = (1.0, random.uniform(0.7, 1.1), random.uniform(0.55, 0.85))
        rock.rotation_euler = (random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2),
                               random.uniform(0, 6.28))
        rock.data.materials.append(mat_rock_hd)
        for poly in rock.data.polygons:
            poly.use_smooth = True
        dl.add_adaptive_subdiv(rock, dicing_rate=1.0, simple=False)

# ------------------------------------------------------------------ render --
bpy.ops.render.render(write_still=True)
print(f"RENDER DONE -> {OUT}")
