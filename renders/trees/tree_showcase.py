# tree_showcase.py — a lineup that shows off the procedural tree generator:
# a back row of full-canopy trees (varied species / colour / size, no two alike)
# and a front pair of bare skeletons that reveal the structural-realism model
# (root flare, noise-perturbed trunk splines, da Vinci taper, curved branches).
#
# Run:  blender -b -P tree_showcase.py -- [preview|final]
import bpy, sys, os, math, random
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(HERE, "..", "cattail"))
sys.path.append(os.path.join(HERE, "..", "autumn-lake"))
import tree_lib

mode = "final"
if "--" in sys.argv:
    a = sys.argv[sys.argv.index("--") + 1:]
    if a:
        mode = a[0]
SCR = "/tmp/claude-0/-home-user-STORMFEA/e03c2369-f850-53e7-8a78-a274eb7d038a/scratchpad"
if mode == "preview":
    RES_X, RES_Y, SAMPLES = 800, 420, 40
    OUT = SCR + "/tree_showcase_preview.png"
else:
    RES_X, RES_Y, SAMPLES = 1400, 740, 220
    OUT = HERE + "/tree_showcase_render.png"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 6
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "Medium Contrast"
scene.view_settings.exposure = 0.05

PAL = {"red": (0.52, 0.020, 0.006), "orange": (0.58, 0.11, 0.008),
       "yellow": (0.56, 0.32, 0.02), "birch": (0.60, 0.42, 0.05),
       "pine": (0.020, 0.060, 0.020)}

mats = tree_lib.make_tree_materials()
acc = tree_lib.new_accumulators()

# --- back row: full-canopy variety (broadleaf + conifer, all unique) --------
back = [("yellow", "b"), ("pine", "c"), ("orange", "b"), ("pine", "c"), ("red", "b")]
x = -20.0
for i, (key, kind) in enumerate(back):
    rng = random.Random(500 + i * 7)
    s = random.Random(90 + i).uniform(1.0, 1.25)
    if kind == "c":
        tree_lib.build_conifer(acc, (x, 9.0, 0), s, PAL[key], rng, lod=1.0)
    else:
        tree_lib.build_broadleaf(acc, (x, 9.0, 0), s, PAL[key], rng, lod=1.0)
    x += 10.0

# --- front pair: bare skeletons revealing the branch structure --------------
# offset in x from the back row so nothing sits directly behind them
rng = random.Random(4242)
tree_lib.build_broadleaf(acc, (-7.5, -3.5, 0), 1.4, PAL["birch"],
                         rng, lod=1.0, foliage=False)
rng = random.Random(9191)
tree_lib.build_conifer(acc, (7.5, -3.5, 0), 1.35, PAL["pine"],
                       rng, lod=1.0, foliage=False)

tree_lib.realize(scene, acc, mats)

# --- ground -----------------------------------------------------------------
mat_g = bpy.data.materials.new("Ground"); mat_g.use_nodes = True
gp = mat_g.node_tree.nodes["Principled BSDF"]
gp.inputs["Base Color"].default_value = (0.09, 0.10, 0.06, 1)
gp.inputs["Roughness"].default_value = 1.0
gnz = mat_g.node_tree.nodes.new("ShaderNodeTexNoise"); gnz.inputs["Scale"].default_value = 8
gb = mat_g.node_tree.nodes.new("ShaderNodeBump"); gb.inputs["Strength"].default_value = 0.15
mat_g.node_tree.links.new(gnz.outputs["Fac"], gb.inputs["Height"])
mat_g.node_tree.links.new(gb.outputs["Normal"], gp.inputs["Normal"])
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 4, 0))
bpy.context.object.data.materials.append(mat_g)

# --- sky + soft golden key --------------------------------------------------
world = bpy.data.worlds.new("Sky"); scene.world = world; world.use_nodes = True
wn = world.node_tree; wn.nodes.clear()
sky = wn.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(22); sky.sun_rotation = math.radians(70)
sky.air_density = 2.0; sky.dust_density = 2.2
bg = wn.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 0.6
wout = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(sky.outputs["Color"], bg.inputs["Color"])
wn.links.new(bg.outputs["Background"], wout.inputs["Surface"])

sun = bpy.data.lights.new("Key", "SUN"); sun.energy = 2.6; sun.angle = math.radians(2)
sun.color = (1.0, 0.94, 0.85)
so = bpy.data.objects.new("Key", sun)
so.rotation_euler = (math.radians(58), 0, math.radians(40))
scene.collection.objects.link(so)

# --- camera -----------------------------------------------------------------
cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 38
cam = bpy.data.objects.new("Camera", cam_d)
cam.location = (0, -35, 7.5)
tgt = Vector((0, 3.0, 4.6))
cam.rotation_euler = (tgt - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam); scene.camera = cam

bpy.ops.render.render(write_still=True)
print("RENDER DONE ->", OUT)
