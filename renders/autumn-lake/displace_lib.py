# displace_lib.py — Cycles Adaptive Subdivision (micropolygon displacement) pipeline.
#
# True geometric micro-detail via Cycles' experimental adaptive subdivision:
#   1. Switch the Cycles feature set to EXPERIMENTAL and set the dicing rates.
#   2. Give an object a Subdivision Surface modifier and turn on adaptive dicing.
#   3. Set the material's displacement method to "Displacement and Bump".
#   4. Drive a Displacement node (-> Material Output.Displacement) from a
#      high-resolution procedural height source.
#
# Adaptive dicing is screen-size based: near geometry dices to ~`dicing_rate`
# pixels (true 4K-scale relief in the foreground) while distant / off-screen
# geometry stays coarse, which keeps the micropolygon count survivable on CPU.
import bpy


# --------------------------------------------------- 1. experimental feature set
def enable_experimental(scene, dicing=1.0, offscreen=8.0, preview=8.0):
    """Switch Cycles to Experimental and configure adaptive dicing.
       dicing = target micropolygon edge length in pixels (1.0 ~= per-pixel)."""
    scene.cycles.feature_set = 'EXPERIMENTAL'
    scene.cycles.dicing_rate = dicing                 # render dicing (px)
    scene.cycles.preview_dicing_rate = preview
    scene.cycles.offscreen_dicing_scale = offscreen   # coarsen off-screen geometry
    scene.cycles.max_subdivisions = 12


# ------------------------------------------------- 2. adaptive subdivision modifier
def add_adaptive_subdiv(obj, dicing_rate=1.0, simple=True):
    """Add a Subdivision Surface modifier and enable Cycles adaptive dicing.
       simple=True (SIMPLE) preserves the base silhouette (terrain / mud);
       simple=False (CATMULL_CLARK) rounds the cage first (boulders)."""
    m = obj.modifiers.new("Subdivision", 'SUBSURF')
    m.subdivision_type = 'SIMPLE' if simple else 'CATMULL_CLARK'
    m.levels = 1
    m.render_levels = 1
    obj.cycles.use_adaptive_subdivision = True
    obj.cycles.dicing_rate = dicing_rate
    return m


def _set_method(mat, method):
    """displacement_method lives on mat.cycles in 4.0, on mat directly in 4.1+."""
    if hasattr(mat, "displacement_method"):
        mat.displacement_method = method
    else:
        mat.cycles.displacement_method = method


# ------------------------------------------------------- 3 + 4. displacement node
def set_displacement(mat, kind, scale, midlevel=0.0, method='BOTH'):
    """Set the material's displacement method and wire the standard
       height -> Displacement -> Material Output.Displacement template.
       kind in {'ground', 'mud', 'rock'} selects the high-res height source."""
    _set_method(mat, method)                 # 'BOTH' = Displacement and Bump
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if out is None:
        out = nt.nodes.new("ShaderNodeOutputMaterial")

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    disp = nt.nodes.new("ShaderNodeDisplacement")
    disp.inputs["Scale"].default_value = scale
    disp.inputs["Midlevel"].default_value = midlevel
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    if kind == 'rock':
        # craggy relief: large noise mountains + Voronoi facets, high contrast
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        crag = nt.nodes.new("ShaderNodeTexNoise")
        crag.inputs["Scale"].default_value = 2.5
        crag.inputs["Detail"].default_value = 12.0
        crag.inputs["Roughness"].default_value = 0.75
        facet = nt.nodes.new("ShaderNodeTexVoronoi")
        facet.feature = 'DISTANCE_TO_EDGE'
        facet.inputs["Scale"].default_value = 6.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'FLOAT'
        mix.inputs["Factor"].default_value = 0.5
        nt.links.new(mapping.outputs["Vector"], crag.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], facet.inputs["Vector"])
        nt.links.new(crag.outputs["Fac"], mix.inputs["A"])
        nt.links.new(facet.outputs["Distance"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], disp.inputs["Height"])
    elif kind == 'mud':
        # cracked mud: Voronoi edges (dried cracks) + fine grain
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        cracks = nt.nodes.new("ShaderNodeTexVoronoi")
        cracks.feature = 'DISTANCE_TO_EDGE'
        cracks.inputs["Scale"].default_value = 9.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[1].position = 0.18   # sharp crack valleys
        grain = nt.nodes.new("ShaderNodeTexNoise")
        grain.inputs["Scale"].default_value = 45.0
        grain.inputs["Detail"].default_value = 8.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'FLOAT'
        mix.inputs["Factor"].default_value = 0.25
        nt.links.new(mapping.outputs["Vector"], cracks.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], grain.inputs["Vector"])
        nt.links.new(cracks.outputs["Distance"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
        nt.links.new(grain.outputs["Fac"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], disp.inputs["Height"])
    else:  # 'ground': tactile clods + small pebbles
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        clods = nt.nodes.new("ShaderNodeTexNoise")
        clods.inputs["Scale"].default_value = 12.0
        clods.inputs["Detail"].default_value = 15.0
        clods.inputs["Roughness"].default_value = 0.7
        pebbles = nt.nodes.new("ShaderNodeTexVoronoi")
        pebbles.inputs["Scale"].default_value = 30.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'FLOAT'
        mix.inputs["Factor"].default_value = 0.3
        nt.links.new(mapping.outputs["Vector"], clods.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], pebbles.inputs["Vector"])
        nt.links.new(clods.outputs["Fac"], mix.inputs["A"])
        nt.links.new(pebbles.outputs["Distance"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], disp.inputs["Height"])

    nt.links.new(disp.outputs["Displacement"], out.inputs["Displacement"])
    return disp
