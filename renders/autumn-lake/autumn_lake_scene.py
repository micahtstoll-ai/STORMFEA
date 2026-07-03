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
from mathutils import noise, Vector

random.seed(20260703)

# ---------------------------------------------------------------- quality ---
mode = "final"
if "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    if args:
        mode = args[0]

if mode == "preview":
    RES_X, RES_Y, SAMPLES = 640, 360, 32
    OUT = "/tmp/claude-0/-home-user-STORMFEA/e03c2369-f850-53e7-8a78-a274eb7d038a/scratchpad/preview.png"
else:
    RES_X, RES_Y, SAMPLES = 1280, 720, 256
    OUT = "/home/user/STORMFEA/renders/autumn-lake/autumn_lake_render.png"

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

mat_trunk = simple_mat("Trunk", (0.05, 0.03, 0.02))
mat_birch = simple_mat("Birch", (0.65, 0.62, 0.55))
mat_red = simple_mat("LeafRed", (0.42, 0.03, 0.008))
mat_orange = simple_mat("LeafOrange", (0.55, 0.13, 0.01))
mat_yellow = simple_mat("LeafYellow", (0.55, 0.32, 0.02))
mat_pine = simple_mat("Pine", (0.015, 0.045, 0.015))
mat_pine2 = simple_mat("Pine2", (0.03, 0.07, 0.02))
mat_reed = simple_mat("Reed", (0.12, 0.20, 0.04))
mat_cattail = simple_mat("Cattail", (0.15, 0.07, 0.02))

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
def make_deciduous(name, leaf_mat, trunk_mat=mat_trunk, blob=0.35):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=2.4, location=(0, 0, 1.2))
    trunk = bpy.context.object
    trunk.data.materials.append(trunk_mat)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.9, location=(0, 0, 3.4))
    canopy = bpy.context.object
    canopy.scale = (1.0, 1.0, 1.25)
    for v in canopy.data.vertices:
        v.co += v.co.normalized() * random.uniform(-blob, blob)
    canopy.data.materials.append(leaf_mat)
    for poly in canopy.data.polygons:
        poly.use_smooth = True
    bpy.ops.object.select_all(action="DESELECT")
    trunk.select_set(True)
    canopy.select_set(True)
    bpy.context.view_layer.objects.active = trunk
    bpy.ops.object.join()
    tree = bpy.context.object
    tree.name = name
    return tree

def make_conifer(name, mat):
    parts = []
    for k, (r, h, z) in enumerate([(1.5, 2.6, 1.6), (1.15, 2.4, 3.0), (0.75, 2.2, 4.4)]):
        bpy.ops.mesh.primitive_cone_add(radius1=r, depth=h, location=(0, 0, z), vertices=10)
        c = bpy.context.object
        c.data.materials.append(mat)
        parts.append(c)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.10, depth=1.0, location=(0, 0, 0.5))
    tr = bpy.context.object
    tr.data.materials.append(mat_trunk)
    parts.append(tr)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    tree = bpy.context.object
    tree.name = name
    return tree

templates = [
    ("red", make_deciduous("T_Red", mat_red)),
    ("red2", make_deciduous("T_Red2", mat_red, blob=0.5)),
    ("orange", make_deciduous("T_Orange", mat_orange)),
    ("yellow", make_deciduous("T_Yellow", mat_yellow)),
    ("birch", make_deciduous("T_Birch", mat_yellow, trunk_mat=mat_birch, blob=0.5)),
    ("pine", make_conifer("T_Pine", mat_pine)),
    ("pine2", make_conifer("T_Pine2", mat_pine2)),
]
tdict = dict(templates)
for _, t in templates:
    t.location = (0, -500, 0)  # park templates out of view
    t.hide_render = True

def pick_template(x, y):
    r = random.random()
    if y > 55:  # far shoreline: mostly conifers
        if r < 0.55:
            return random.choice(["pine", "pine2"])
        return random.choice(["orange", "yellow", "red", "birch"])
    if x < 0:  # left bank: blazing autumn
        if r < 0.42:
            return "red" if random.random() < 0.6 else "red2"
        if r < 0.68:
            return "orange"
        if r < 0.82:
            return random.choice(["yellow", "birch"])
        return random.choice(["pine", "pine2"])
    else:  # right bank: dark conifers with autumn accents
        if r < 0.72:
            return random.choice(["pine", "pine2"])
        if r < 0.85:
            return "orange"
        if r < 0.94:
            return "yellow"
        return "red"

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
    key = pick_template(x, y)
    tpl = tdict[key]
    inst = bpy.data.objects.new(f"Tree_{placed}", tpl.data)
    s = random.uniform(0.7, 1.5)
    if y < -20:  # trees near the camera stay modest so they don't block the frame
        s = min(s, 1.05)
    inst.scale = (s, s, s * random.uniform(0.9, 1.3))
    inst.rotation_euler = (0, 0, random.uniform(0, 6.28))
    inst.location = (x, y, h - 0.15)
    scene.collection.objects.link(inst)
    placed += 1

# ------------------------------------------------------------------ reeds ---
bpy.ops.mesh.primitive_cylinder_add(radius=0.028, depth=2.0, location=(0, -500, 0), vertices=5)
reed_tpl = bpy.context.object
reed_tpl.data.materials.append(mat_reed)
reed_tpl.hide_render = True
bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.35, location=(0, -500, 0), vertices=6)
head_tpl = bpy.context.object
head_tpl.data.materials.append(mat_cattail)
head_tpl.hide_render = True

from mathutils import Euler

def reed_clump(cx, cy, count, spread, hmin=1.0, hmax=2.2):
    for k in range(count):
        x = cx + random.uniform(-spread, spread)
        y = cy + random.uniform(-spread, spread)
        h = ground_h(x, y)
        base = max(h, -0.2)
        length = random.uniform(hmin, hmax)
        rot = Euler((random.uniform(-0.18, 0.18), random.uniform(-0.18, 0.18), 0))
        center = Vector((x, y, base)) + rot.to_matrix() @ Vector((0, 0, length / 2.0))
        r = bpy.data.objects.new("Reed", reed_tpl.data)
        r.scale = (1, 1, length / 2.0)
        r.location = center
        r.rotation_euler = rot
        scene.collection.objects.link(r)
        if random.random() < 0.15:
            tip = Vector((x, y, base)) + rot.to_matrix() @ Vector((0, 0, length + 0.18))
            hd = bpy.data.objects.new("CattailHead", head_tpl.data)
            hd.location = tip
            hd.rotation_euler = rot
            scene.collection.objects.link(hd)

reed_clump(-5.0, -44.0, 60, 2.5)          # foreground left
reed_clump(6.0, -44.5, 45, 2.0)           # foreground right
reed_clump(0.5, -42.0, 15, 1.2, 0.7, 1.4)  # short center tuft
reed_clump(-22, -27, 30, 3.0)             # mid-distance left shore
reed_clump(22, -26, 30, 3.0)              # mid-distance right shore
reed_clump(-2.5, -51.5, 55, 3.5, 0.3, 0.9)  # short grass tufts near camera
reed_clump(3.5, -50.5, 40, 2.5, 0.3, 0.8)

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

# ------------------------------------------------------------------ render --
bpy.ops.render.render(write_still=True)
print(f"RENDER DONE -> {OUT}")
