# sapling_trees.py — photoreal, per-tree-unique, multi-species trees built with
# Blender's bundled Sapling Tree Gen add-on (add_curve_sapling).
#
# Each species maps to one of Blender's curated Sapling presets (real botanical
# parameter sets) plus a few overrides. A per-tree `seed` makes every tree a
# unique grow. Bark + leaf materials are procedural (no external textures) and
# shared per family, with per-tree colour variation via Object-Info Random so
# the autumn canopy has real hue spread.
import ast
import os
import math
import bpy

_PRESET_DIR = "/usr/share/blender/scripts/addons/add_curve_sapling/presets"
_addon_ready = False


def ensure_addon():
    global _addon_ready
    if not _addon_ready:
        bpy.ops.preferences.addon_enable(module="add_curve_sapling")
        _addon_ready = hasattr(bpy.ops.curve, "tree_add")
    return _addon_ready


def _load_preset(name):
    with open(os.path.join(_PRESET_DIR, name + ".py")) as fh:
        txt = fh.read()
    return ast.literal_eval(txt[txt.index("{"):])


# species -> (preset name, override params). Overrides retune scale to the lake
# (~6-9 m) and force leaves on; oak & spruce are derived from nearby presets.
SPECIES = {
    "birch":  ("white_birch",   {"scale": 8.0,  "leaves": 110, "leafScale": 0.24}),
    "aspen":  ("quaking_aspen", {"scale": 9.0,  "levels": 3, "leaves": 45,
                                 "leafScale": 0.26}),
    "maple":  ("small_maple",   {"scale": 7.0,  "leaves": 90, "leafScale": 0.26}),
    "oak":    ("small_maple",   {"scale": 9.0,  "shape": "1", "leaves": 90,
                                 "leafScale": 0.28, "branches": (0, 140, 24, 10),
                                 "attractUp": (-0.3, -0.6, 0.0, 0.0)}),
    "willow": ("weeping_willow", {"scale": 8.0, "leaves": 180}),
    "pine":   ("small_pine",    {"scale": 6.5,  "leaves": 450}),
    "spruce": ("douglas_fir",   {"scale": 8.0,  "levels": 3, "shape": "0",
                                 "branches": (0, 60, 14, 8), "leaves": 220,
                                 "leafScale": 0.14}),
    "fir":    ("douglas_fir",   {"scale": 8.5,  "levels": 3, "leaves": 240,
                                 "leafScale": 0.16}),
    "snag":   ("quaking_aspen", {"scale": 8.0}),   # leaves forced off below
}
CONIFERS = {"pine", "spruce", "fir"}
_param_cache = {}


def _params(species):
    if species not in _param_cache:
        preset, over = SPECIES[species]
        p = _load_preset(preset)
        p.update(over)
        p["bevel"] = True
        p["makeMesh"] = False
        p["showLeaves"] = (species != "snag")
        # autoTaper recomputes taper from the (seed-randomised) scale and can push
        # taper[0] > 1, which makes Sapling's trunk-radius power go complex and
        # crash for unlucky seeds. Disable it so taper stays at the preset values.
        p["autoTaper"] = False
        _param_cache[species] = p
    return dict(_param_cache[species])


# --------------------------------------------------------------- materials ---
def _pnode(mat):
    return mat.node_tree.nodes["Principled BSDF"]


def _bark_material(name, tint, rough=0.82, birch=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = _pnode(m)
    p.inputs["Base Color"].default_value = (*tint, 1.0)
    p.inputs["Roughness"].default_value = rough
    coord = nt.nodes.new("ShaderNodeTexCoord")
    # bark grain -> bump
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 14.0
    grain.inputs["Detail"].default_value = 12.0
    grain.inputs["Roughness"].default_value = 0.75
    strokes = nt.nodes.new("ShaderNodeTexWave")   # vertical bark strokes
    strokes.wave_type = 'BANDS'
    strokes.bands_direction = 'Z'
    strokes.inputs["Scale"].default_value = 3.0
    strokes.inputs["Distortion"].default_value = 12.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump2 = nt.nodes.new("ShaderNodeBump")
    bump2.inputs["Strength"].default_value = 0.25
    nt.links.new(coord.outputs["Object"], grain.inputs["Vector"])
    nt.links.new(coord.outputs["Object"], strokes.inputs["Vector"])
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bump2.inputs["Normal"])
    nt.links.new(strokes.outputs["Fac"], bump2.inputs["Height"])
    nt.links.new(bump2.outputs["Normal"], p.inputs["Normal"])
    if birch:
        # horizontal dark lenticel bands over the pale birch bark
        bands = nt.nodes.new("ShaderNodeTexWave")
        bands.wave_type = 'BANDS'
        bands.bands_direction = 'Z'
        bands.inputs["Scale"].default_value = 22.0
        bands.inputs["Distortion"].default_value = 6.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.55
        ramp.color_ramp.elements[0].color = (*tint, 1.0)
        ramp.color_ramp.elements[1].position = 0.72
        ramp.color_ramp.elements[1].color = (0.05, 0.04, 0.03, 1.0)
        nt.links.new(coord.outputs["Object"], bands.inputs["Vector"])
        nt.links.new(bands.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


def _autumn_leaf_material():
    """Deciduous leaves: translucent, per-tree hue across an autumn ramp."""
    m = bpy.data.materials.new("SapLeafAutumn")
    m.use_nodes = True
    nt = m.node_tree
    p = _pnode(m)
    p.inputs["Roughness"].default_value = 0.62
    p.inputs["Subsurface Weight"].default_value = 0.20
    p.inputs["Subsurface Radius"].default_value = (0.4, 0.28, 0.05)
    p.inputs["Subsurface Scale"].default_value = 0.03
    obj = nt.nodes.new("ShaderNodeObjectInfo")
    # per-tree pick along the autumn ramp, jittered by a within-canopy noise
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6.0
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = 'ADD'
    scaledn = nt.nodes.new("ShaderNodeMath")
    scaledn.operation = 'MULTIPLY'
    scaledn.inputs[1].default_value = 0.25
    nt.links.new(coord.outputs["Generated"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], scaledn.inputs[0])
    nt.links.new(obj.outputs["Random"], mix.inputs[0])
    nt.links.new(scaledn.outputs["Value"], mix.inputs[1])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    e = ramp.color_ramp.elements
    e[0].position = 0.0;  e[0].color = (0.06, 0.16, 0.03, 1)   # green
    e[1].position = 1.0;  e[1].color = (0.42, 0.03, 0.01, 1)   # red
    for pos, col in [(0.35, (0.28, 0.30, 0.03, 1)),            # yellow-green
                     (0.6,  (0.55, 0.30, 0.02, 1)),            # yellow-orange
                     (0.8,  (0.55, 0.12, 0.01, 1))]:           # orange
        el = ramp.color_ramp.elements.new(pos)
        el.color = col
    nt.links.new(mix.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


def _conifer_leaf_material():
    m = bpy.data.materials.new("SapLeafConifer")
    m.use_nodes = True
    nt = m.node_tree
    p = _pnode(m)
    p.inputs["Roughness"].default_value = 0.7
    p.inputs["Subsurface Weight"].default_value = 0.12
    p.inputs["Subsurface Radius"].default_value = (0.1, 0.3, 0.08)
    obj = nt.nodes.new("ShaderNodeObjectInfo")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.012, 0.045, 0.015, 1)
    ramp.color_ramp.elements[1].color = (0.03, 0.075, 0.022, 1)
    nt.links.new(obj.outputs["Random"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


_BARK_TINT = {
    "birch":  (0.62, 0.60, 0.55),
    "aspen":  (0.42, 0.40, 0.34),
    "maple":  (0.14, 0.10, 0.07),
    "oak":    (0.11, 0.09, 0.06),
    "willow": (0.13, 0.10, 0.06),
    "pine":   (0.16, 0.08, 0.04),
    "spruce": (0.10, 0.07, 0.045),
    "fir":    (0.11, 0.08, 0.05),
    "snag":   (0.20, 0.18, 0.15),
}


def make_materials():
    """Build the shared material set once; returns dicts keyed by species."""
    bark = {}
    for sp, tint in _BARK_TINT.items():
        bark[sp] = _bark_material(f"Bark_{sp}", tint, birch=(sp == "birch"),
                                  rough=(0.7 if sp == "snag" else 0.82))
    return {"bark": bark,
            "leaf_decid": _autumn_leaf_material(),
            "leaf_conifer": _conifer_leaf_material()}


# ----------------------------------------------------------------- growing ---
def grow_tree(scene, species, seed, location, size, rot_z, mats, lod=1.0):
    """Grow one Sapling tree; assign materials; place it. Returns (tree, leaves)."""
    p = _params(species)
    p["seed"] = seed
    # LOD: distant trees get fewer leaves to bound cost. NB: do NOT change
    # `levels` here — with autoTaper on, Sapling recomputes taper and can push
    # taper[0] > 1, making the trunk-radius power complex (crash).
    if lod < 0.5 and species != "snag":
        p["leaves"] = max(10, int(p.get("leaves", 20) * 0.7))

    before = set(bpy.data.objects.keys())
    bpy.ops.curve.tree_add(**p)
    new = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
    tree = next(o for o in new if o.type == 'CURVE')
    leaves = next((o for o in new if o.type == 'MESH'), None)

    tree.data.materials.clear()
    tree.data.materials.append(mats["bark"][species])
    leaf_mat = mats["leaf_conifer"] if species in CONIFERS else mats["leaf_decid"]
    if leaves is not None:
        leaves.data.materials.clear()
        leaves.data.materials.append(leaf_mat)

    for o in new:                       # same transform keeps tree + leaves aligned
        o.location = location
        o.rotation_euler = (0.0, 0.0, rot_z)
        o.scale = (size, size, size)
    return tree, leaves
