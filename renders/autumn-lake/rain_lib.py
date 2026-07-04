# rain_lib.py — turn the autumn lake into a moody "Autumn Rain" scene.
#
# Atmospheric building blocks (Blender 4.x node API):
#   1. make_overcast_world() — heavy overcast sky: soft, diffuse cool-grey/blue
#      world light with no sun disc, so there are no harsh sun shadows.
#   2. add_volumetric_mist()  — a Principled Volume cube wrapping the camera +
#      lake; low density + forward anisotropy gives rain haze that fades the
#      distant forest and hides the far low-poly edges (atmospheric depth).
#   3. apply_rain_ripples()   — rebuilds the lake normals from tiled Voronoi +
#      Noise through a Color Ramp, breaking the mirror into hundreds of splashes.
#   4. add_rain_streaks()     — a curtain of thin, faintly-emissive falling
#      streaks through the camera view (motion-blur-look rain).
import math
import random
import bpy


# ------------------------------------------------- 1. overcast rainy world ----
def make_overcast_world(scene, strength=1.3,
                        horizon=(0.34, 0.37, 0.42), zenith=(0.44, 0.49, 0.58)):
    """Elevation-based cool-grey gradient sky (no sun) -> flat, diffuse light."""
    world = bpy.data.worlds.new("OvercastRain")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.15
    mr.inputs["From Max"].default_value = 0.55
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*horizon, 1.0)     # dim horizon haze
    ramp.color_ramp.elements[1].color = (*zenith, 1.0)      # cool grey zenith
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(geo.outputs["Incoming"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return world


# ------------------------------------------------- 2. volumetric rain mist ----
def add_volumetric_mist(scene, bounds, density=0.012, anisotropy=0.7,
                        color=(0.60, 0.65, 0.72)):
    """A Principled Volume cube enclosing the camera + lake. Beer-Lambert
       extinction over depth fades the distant forest into the grey sky.
       bounds = (x0, x1, y0, y1, z0, z1)."""
    x0, x1, y0, y1, z0, z1 = bounds
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    cube = bpy.context.object
    cube.name = "RainMist"
    cube.scale = ((x1 - x0) / 2.0, (y1 - y0) / 2.0, (z1 - z0) / 2.0)
    cube.location = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0)
    cube.display_type = 'WIRE'
    cube.visible_shadow = False

    mat = bpy.data.materials.new("RainMistVol")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = anisotropy      # ~0.7 forward scatter
    vol.inputs["Color"].default_value = (*color, 1.0)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    cube.data.materials.append(mat)

    # keep volume cost survivable on CPU: single scatter is plenty for thin mist
    scene.cycles.volume_bounces = 0
    scene.cycles.volume_step_rate = 1.0
    return cube


# ------------------------------------------------- 3. procedural rain ripples -
def apply_rain_ripples(mat, scale=1.6, strength=0.32, roughness=0.06,
                       base_color=(0.011, 0.017, 0.018)):
    """Rebuild the lake normals from tiled Voronoi + Noise -> Color Ramp -> Bump
       so the surface reads as hundreds of tiny rain splashes, not a mirror."""
    nt = mat.node_tree
    p = nt.nodes.get("Principled BSDF")
    out = nt.nodes.get("Material Output")
    # drop the old streaky-ripple nodes, keep shader + output
    for n in list(nt.nodes):
        if n not in (p, out):
            nt.nodes.remove(n)

    p.inputs["Base Color"].default_value = (*base_color, 1.0)
    p.inputs["Roughness"].default_value = roughness
    p.inputs["IOR"].default_value = 1.33

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    # tiled Voronoi #1: cell-edge net = choppy ripple crests
    v_edge = nt.nodes.new("ShaderNodeTexVoronoi")
    v_edge.feature = 'DISTANCE_TO_EDGE'
    v_edge.inputs["Scale"].default_value = 3.0
    # tiled Voronoi #2: rounded splash dimples at a finer scale
    v_drop = nt.nodes.new("ShaderNodeTexVoronoi")
    v_drop.feature = 'F1'
    v_drop.inputs["Scale"].default_value = 7.0
    # noise breaks up the regularity
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 14.0
    nz.inputs["Detail"].default_value = 6.0
    nt.links.new(mapping.outputs["Vector"], v_edge.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], v_drop.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], nz.inputs["Vector"])

    mix1 = nt.nodes.new("ShaderNodeMix"); mix1.data_type = 'FLOAT'
    mix1.inputs["Factor"].default_value = 0.5
    mix2 = nt.nodes.new("ShaderNodeMix"); mix2.data_type = 'FLOAT'
    mix2.inputs["Factor"].default_value = 0.35
    nt.links.new(v_edge.outputs["Distance"], mix1.inputs["A"])
    nt.links.new(v_drop.outputs["Distance"], mix1.inputs["B"])
    nt.links.new(mix1.outputs["Result"], mix2.inputs["A"])
    nt.links.new(nz.outputs["Fac"], mix2.inputs["B"])

    # Color Ramp sharpens the combined field into ripple crests
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.30
    ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(mix2.outputs["Result"], ramp.inputs["Fac"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.12
    nt.links.new(ramp.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    return mat


# ------------------------------------------------- 4. falling rain streaks ----
def add_rain_streaks(scene, count=650, box=(-35, 35, -50, 8, 0.5, 22),
                     length=(0.35, 0.75), radius=0.013, tilt_deg=(3, 10),
                     emission=0.7, mix=0.92, seed=7):
    """A curtain of thin, faintly self-lit streaks through the camera view.
       Each is an elongated 4-sided cylinder (a motion-blurred raindrop)."""
    rng = random.Random(seed)
    x0, x1, y0, y1, z0, z1 = box

    mat = bpy.data.materials.new("RainStreak")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    mixsh = nt.nodes.new("ShaderNodeMixShader")
    mixsh.inputs["Fac"].default_value = mix          # mostly transparent
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.72, 0.78, 0.85, 1.0)
    em.inputs["Strength"].default_value = emission
    nt.links.new(tr.outputs["BSDF"], mixsh.inputs[1])
    nt.links.new(em.outputs["Emission"], mixsh.inputs[2])
    nt.links.new(mixsh.outputs["Shader"], out.inputs["Surface"])

    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=1.0, vertices=4,
                                        location=(0, -500, 0))
    tpl = bpy.context.object
    tpl.name = "RainStreakTpl"
    tpl.data.materials.append(mat)
    tpl.hide_render = True

    for i in range(count):
        s = bpy.data.objects.new("RainStreak", tpl.data)
        s.location = (rng.uniform(x0, x1), rng.uniform(y0, y1), rng.uniform(z0, z1))
        s.rotation_euler = (math.radians(rng.uniform(*tilt_deg)), 0.0,
                            rng.uniform(0, math.tau))
        s.scale = (1.0, 1.0, rng.uniform(*length))
        s.visible_shadow = False
        scene.collection.objects.link(s)
    return tpl


# ------------------------------------------------- 5. rain splash rings -------
def add_splash_rings(mat, scale=1.0, ring_scale=3.2, frequency=46.0,
                     strength=0.5, falloff=2.3, density=0.72):
    """Concentric expanding rings at scattered impact points, layered on top of
       the fine ripple normal. A Voronoi feature field gives one impact per cell;
       sin(distance*frequency) makes the rings; a radial falloff fades them out
       and a per-cell gate leaves only some cells splashing."""
    nt = mat.node_tree
    p = nt.nodes.get("Principled BSDF")
    # keep whatever normal is already driving the shader (the fine ripples) so
    # the splash bump can be chained on top of it
    prev_normal = p.inputs["Normal"].links[0].from_socket if p.inputs["Normal"].is_linked else None

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = 'F1'
    vor.inputs["Scale"].default_value = ring_scale
    nt.links.new(mapping.outputs["Vector"], vor.inputs["Vector"])

    def _math(op, v1=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        if v1 is not None:
            n.inputs[1].default_value = v1
        return n

    # concentric rings: sin(distance * frequency)
    mul = _math('MULTIPLY', frequency)
    nt.links.new(vor.outputs["Distance"], mul.inputs[0])
    sine = _math('SINE')
    nt.links.new(mul.outputs["Value"], sine.inputs[0])

    # radial falloff: 1 - distance*falloff, clamped at 0 -> rings die out at the rim
    fmul = _math('MULTIPLY', falloff)
    nt.links.new(vor.outputs["Distance"], fmul.inputs[0])
    inv = _math('SUBTRACT')
    inv.inputs[0].default_value = 1.0
    nt.links.new(fmul.outputs["Value"], inv.inputs[1])
    clamp = _math('MAXIMUM', 0.0)
    nt.links.new(inv.outputs["Value"], clamp.inputs[0])

    # per-cell gate: only cells whose random colour exceeds `density` splash
    gate = _math('GREATER_THAN', density)
    nt.links.new(vor.outputs["Color"], gate.inputs[0])

    # amplitude = sine * falloff * gate
    a1 = _math('MULTIPLY')
    nt.links.new(sine.outputs["Value"], a1.inputs[0])
    nt.links.new(clamp.outputs["Value"], a1.inputs[1])
    a2 = _math('MULTIPLY')
    nt.links.new(a1.outputs["Value"], a2.inputs[0])
    nt.links.new(gate.outputs["Value"], a2.inputs[1])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(a2.outputs["Value"], bump.inputs["Height"])
    if prev_normal is not None:
        nt.links.new(prev_normal, bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    return bump
