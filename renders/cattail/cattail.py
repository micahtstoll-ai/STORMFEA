# Procedural cattail (Typha latifolia) — hero clump, wet / rain scene, still.
#
# The plant geometry + materials live in cattail_lib.py (shared with the lake
# scene). This file is just the hero-shot staging: water, mud, rain, overcast
# world, lighting and camera.
#
# Run:  blender -b -P cattail.py -- [preview|final]
import bpy, math, random, sys, os
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import cattail_lib as ct

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

# ================================================================ cattails ==
mats = ct.make_cattail_materials(wet=True, warm=False)
acc = ct.new_accumulators()
N_PLANTS = 12
for i in range(N_PLANTS):
    u = i / (N_PLANTS - 1)
    cx = (u - 0.5) * 1.5 + random.uniform(-0.10, 0.10)
    cy = 0.28 * math.sin(u * math.pi) + random.uniform(-0.10, 0.10)   # gentle arc
    bz = random.uniform(-0.06, 0.02)                                  # bases submerged
    ct.build_clump(acc, (cx, cy, bz), 1, (0.85, 1.15), 0.0,
                   submerge=(0.0, 0.0), rng=random)
ct.realize(scene, acc, mats)

# ================================================================ staging ===
def principled(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]

mat_water, wt, wp = principled("Water")
wp.inputs["Base Color"].default_value = (0.012, 0.020, 0.020, 1)
wp.inputs["Roughness"].default_value = 0.035
wp.inputs["IOR"].default_value = 1.33
wnz = wt.nodes.new("ShaderNodeTexNoise"); wnz.inputs["Scale"].default_value = 12.0
wnz.inputs["Detail"].default_value = 8.0
wbmp = wt.nodes.new("ShaderNodeBump"); wbmp.inputs["Strength"].default_value = 0.06
wt.links.new(wnz.outputs["Fac"], wbmp.inputs["Height"])
wt.links.new(wbmp.outputs["Normal"], wp.inputs["Normal"])

mat_mud, mdt, mdp = principled("Mud")
mdp.inputs["Base Color"].default_value = (0.035, 0.026, 0.018, 1)
mdp.inputs["Roughness"].default_value = 0.28          # wet sheen
mdnz = mdt.nodes.new("ShaderNodeTexNoise"); mdnz.inputs["Scale"].default_value = 18.0
mdnz.inputs["Detail"].default_value = 8.0
mdb = mdt.nodes.new("ShaderNodeBump"); mdb.inputs["Strength"].default_value = 0.25
mdt.links.new(mdnz.outputs["Fac"], mdb.inputs["Height"])
mdt.links.new(mdb.outputs["Normal"], mdp.inputs["Normal"])

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, WATER_Z))
bpy.context.object.name = "Water"; bpy.context.object.data.materials.append(mat_water)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.35))
bpy.context.object.name = "Bottom"; bpy.context.object.data.materials.append(mat_mud)

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

bpy.ops.mesh.primitive_cylinder_add(radius=0.0005, depth=0.22, vertices=4, location=(0, -50, 0))
rain_tpl = bpy.context.object; rain_tpl.name = "RainTpl"
rain_tpl.data.materials.append(mat_rain); rain_tpl.hide_render = True
for i in range(340):
    r = bpy.data.objects.new("Rain", rain_tpl.data)
    r.location = (random.uniform(-2.6, 2.6), random.uniform(-2.6, 0.2), random.uniform(0.15, 2.5))
    r.rotation_euler = (math.radians(random.uniform(3, 9)), 0, random.uniform(0, math.tau))
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
wramp.color_ramp.elements[0].color = (0.40, 0.42, 0.44, 1)
wramp.color_ramp.elements[1].color = (0.52, 0.57, 0.64, 1)
wbg = wn.nodes.new("ShaderNodeBackground"); wbg.inputs["Strength"].default_value = 1.0
wout = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(wgeo.outputs["Incoming"], wsep.inputs["Vector"])
wn.links.new(wsep.outputs["Z"], wmr.inputs["Value"])
wn.links.new(wmr.outputs["Result"], wramp.inputs["Fac"])
wn.links.new(wramp.outputs["Color"], wbg.inputs["Color"])
wn.links.new(wbg.outputs["Background"], wout.inputs["Surface"])

# soft backlit key (for SSS translucency) + front fill
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
