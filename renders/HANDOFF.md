# Autumn Lake — Blender Render Knowledge & Handoff

A complete transfer of everything built for the STORMFEA "autumn lake" render, so
it can be continued in a **Claude Chat with the Blender MCP** connected to a live
Blender. In that environment you get the things this headless sandbox could not:
a **GPU**, the **OIDN/OptiX denoiser**, **HDRI skies**, and **downloadable PBR /
scanned assets** (Poly Haven, etc.) — which is the fastest route to genuinely
photoreal results.

Branch: `claude/blender-mcp-render-kzgh4d`. All paths below are under `renders/`.

---

## 1. What this is
A procedural recreation (and re-lighting) of a reference photo: a calm autumn
forest lake at sunset — red/orange broadleaf + dark conifers around the shore,
warm sky reflected in the water, cattails in the foreground. It grew into several
moods (sunset, high-detail displaced shore, overcast **Autumn Rain**, and a
**photoreal** tree pass).

Everything is **pure Python + Cycles, fully procedural** (no external assets were
reachable in the sandbox). Every generator is seeded so results are reproducible
and every instance is unique.

---

## 2. Repo map
| File | Purpose |
|---|---|
| `autumn-lake/autumn_lake_scene.py` | Main scene. Composable render flags. Landscape (lake ellipse + rolling ground), water, cattails, trees, clouds, camera, lighting. |
| `autumn-lake/tree_lib.py` | **Stylized** procedural trees: recursive spline branches (da Vinci taper, root flare, gravity/phototropism), ico-blob foliage, vertex-colour materials, distance LOD. Fast default look. |
| `autumn-lake/sapling_trees.py` | **Photoreal** trees via Blender's bundled **Sapling Tree Gen**. 9 species mapped to curated presets; procedural bark + translucent autumn leaf shaders; per-tree unique seed. |
| `autumn-lake/displace_lib.py` | Cycles **Adaptive Subdivision** (micropolygon displacement) pipeline: experimental feature set, adaptive subsurf, `Displacement` node template (ground/mud/rock presets). |
| `autumn-lake/rain_lib.py` | **Autumn Rain**: overcast gradient world, volumetric mist cube, rain-ripple + splash-ring water normals, falling rain streaks. |
| `cattail/cattail_lib.py` | Reusable cattail (Typha) generator: tapered/twisted/keeled blade ribbons, felted "corn-dog" spikes, wet/dry + warm/cool material variants. Also exposes the generic `add_tube()` reused by the tree branches. |
| `cattail/cattail.py` | Standalone cattail hero shot (rain/wet). |
| `trees/tree_showcase.py` | Lineup render of the stylized tree species + bare skeletons. |
| Outputs | `autumn_lake_render.png` (sunset), `_hd.png` (displaced shore), `_rain.png` (rain), `_pr.png` (photoreal). |

---

## 3. How to drive the scene — composable render flags
`blender -b -P autumn_lake_scene.py -- <mode>` where mode tokens combine with `-`:

- `preview` → 640×360, low samples, scratch output (fast iteration).
- `final` → 1280×720, 256 spp — the **sunset default** (untouched by the variants).
- add `hd` → Adaptive-Subdivision displaced ground/mud/rocks (Experimental).
- add `rain` → overcast + mist + rippled/splashing water + streaks + wet reeds.
- add `pr` → photoreal Sapling trees, **frustum-culled** to what the camera sees.

e.g. `final-pr`, `final-rain`, `preview-rain`, and they stack (`final-rain-pr`).
Parsing is `set(mode.split("-"))` with `IS_PREVIEW/HD/RAIN/PR` booleans; each
variant is an isolated `if FLAG:` block so the default path never changes.

---

## 4. The systems (with the reusable recipes)

### 4.1 Landscape & composition
- Lake is an **ellipse** `lake_e(x,y) = (x/26)^2 + ((y-8)/52)^2`; `<1` is water.
- `ground_h(x,y)` rises away from the rim with low-freq noise; the near shoreline
  (`near_shore_y`) is derived from the ellipse for placing cattails/rocks.
- Camera: 24 mm at `(0,-51.5,2.5)` looking to `(0,40,0.5)`. **Created up-front**
  so photoreal placement can frustum-cull against it.

### 4.2 Trees — photoreal (the current hero)
Sapling is bundled and **works headless**:
`bpy.ops.preferences.addon_enable(module="add_curve_sapling")` then
`bpy.ops.curve.tree_add(**params)` → creates a `tree` CURVE + `leaves` MESH.

Species → preset mapping (`sapling_trees.SPECIES`, presets in
`/usr/share/blender/scripts/addons/add_curve_sapling/presets/*.py`, each a plain
dict you can `ast.literal_eval` and pass as kwargs):

```
birch  → white_birch      aspen → quaking_aspen (levels bumped to 3)
maple  → small_maple      oak   → small_maple + shape '1' (spherical), more branches
willow → weeping_willow   pine  → small_pine
spruce → douglas_fir + shape '0' (conical)   fir → douglas_fir
snag   → quaking_aspen with showLeaves=False (bare/dead)
```
Per-tree `seed` = unique grow. Bark = procedural noise/wave bump (birch gets
horizontal lenticel bands); leaves = translucent Principled (Subsurface) whose
**hue varies per tree** via `ShaderNodeObjectInfo.Random → ColorRamp` (green→
yellow→orange→red); conifers use a separate dark-green needle shader.

**Gotchas that cost real time — remember these:**
1. **`autoTaper` crash.** Presets ship `autoTaper: True`; it recomputes `taper`
   from the seed-randomised scale and for unlucky seeds pushes `taper[0] > 1`,
   making Sapling's trunk radius `(startRad*(1-taper[0]))**ratioPower` **complex**
   → `TypeError: '>' not supported between 'float' and 'complex'`. **Fix: set
   `autoTaper: False`** so taper stays at preset values. (This only shows up
   across many random seeds, not a single fixed one.)
2. **Seed is int32** — mask with `& 0x7FFFFFFF`, not `0xFFFFFFFF`.
3. **Don't change `levels` per-tree** while autoTaper logic is involved (same
   taper trap). Do LOD by thinning `leaves` only.
4. **Framing lies.** When validating a species lineup, dense trees can sit
   off-frame and make good trees look "sparse" — check leaf **face counts**
   (`len(leaves.data.polygons)`) not just the render.

### 4.3 Visibility optimization (what makes photoreal affordable)
Only grow trees the camera sees:
```
from bpy_extras.object_utils import world_to_camera_view
ndc = world_to_camera_view(scene, cam, Vector((x, y, canopy_z)))
keep = (-0.06 < ndc.x < 1.06) and (-0.04 < ndc.y < 1.20) and ndc.z > 0.5
```
This dropped ~650 scattered candidates to ~150 visible trees. Distance LOD then
thins leaf counts on far trees. Peak memory ~12 GB at 150 trees, 600 spp.

### 4.4 Trees — stylized (`tree_lib.py`)
The fast default. Recursive branch **splines** via `cattail_lib.add_tube`; child
radii by **da Vinci's rule** (`sum(child_r^2) ≈ parent_r^2`); noise-perturbed
trunk with **root flare**; branch curvature from phototropism (up early) + gravity
droop (toward tip); foliage = noise-deformed ico-blobs; per-tree hue/value jitter
baked into a `col` vertex-colour attribute. `foliage=False` renders the bare
skeleton. Good at distance, cheap, guaranteed-unique.

### 4.5 Adaptive Subdivision displacement (`displace_lib.py`)
```
scene.cycles.feature_set = 'EXPERIMENTAL'
scene.cycles.dicing_rate = 1.0; scene.cycles.offscreen_dicing_scale = 8
mod = obj.modifiers.new("Subdivision", 'SUBSURF'); mod.subdivision_type='SIMPLE'
obj.cycles.use_adaptive_subdivision = True
mat.cycles.displacement_method = 'BOTH'   # Displacement + Bump (Blender 4.0)
# node template: TexCoord.Object → Mapping → <height tex> → Displacement.Height
#                Displacement(Scale,Midlevel) → Material Output.Displacement
```
Height presets: ground (noise clods + Voronoi pebbles), mud (Voronoi F1 cracks),
rock (noise crags + Voronoi facets). Adaptive dicing is screen-based so the
foreground gets real geometry while the distance stays cheap.

### 4.6 Autumn Rain (`rain_lib.py`)
- **Overcast world**: `NewGeometry.Incoming → SeparateXYZ.Z → MapRange → ColorRamp
  (cool grey/blue) → Background`. No sun disc = soft, shadowless light.
- **Volumetric mist**: a cube around the camera+lake with `VolumePrincipled`
  (density ~0.01 for a ~150-unit scene — 0.02–0.05 washes it out at this scale;
  Anisotropy 0.7). Beer-Lambert extinction fades the far forest → depth.
  `volume_bounces=0` (single scatter) keeps it renderable.
- **Rain-ripple water**: two tiled Voronoi (`DISTANCE_TO_EDGE` net + `F1` dimples)
  + Noise → ColorRamp → Bump → Normal.
- **Splash rings**: Voronoi `F1` `Distance → sin(distance*freq)` = concentric
  rings; radial falloff + a per-cell `GREATER_THAN` gate so only some cells
  splash. **Voronoi `Distance` is scale-independent**, so shrink `ring_scale` to
  make splashes physically bigger without changing ring count.
- **Rain streaks**: instanced thin transparent+emission cylinders in the view
  volume. **Wet reeds**: `cattail_lib.make_cattail_materials(wet=True)` + boosted
  clear-coat.

---

## 5. Sandbox limits we hit — and how the MCP / live Blender removes them
| Limit here | Effect | Fix in a live Blender + MCP |
|---|---|---|
| **No OIDN/OptiX denoiser** (apt build) | foliage/volume noise; had to brute-force 600 spp | Enable **OIDN or OptiX denoise** → clean at ~64–256 spp, far faster |
| **No external network** (blender.org, Poly Haven 403) | no HDRIs, no scanned textures — everything procedural | MCP can pull **Poly Haven HDRIs + PBR textures** and models → true photoreal |
| **CPU only** | slow | **GPU (CUDA/OptiX)** — often 10–50× faster |
| **10-min/command cap** | had to render `final-pr` in the background | Interactive — no cap |
| **Sapling leaf cards** (hex/rect planes) | leaf shapes visible up close | **Alpha leaf textures** or geometry leaves; or scanned leaf atlases |

---

## 6. Recommended next steps to get *better* renders with the MCP
1. **Lighting**: replace the Nishita/gradient sky with a real **HDRI** (overcast
   for rain, golden-hour for the sunset). Biggest single realism jump.
2. **Denoise + GPU**: turn on OIDN + GPU; drop samples; render bigger.
3. **Bark & leaves**: swap the procedural bark for **scanned PBR bark** per
   species; give Sapling leaves **alpha leaf-shape textures** (or a leaf atlas).
   Add subtle translucency/backscatter tuned per species.
4. **Ground/water**: scanned mud/rock/grass with real displacement; a proper
   water shader (wave/ocean modifier, caustics, wet-edge darkening).
5. **Composition knob**: PR placement currently keeps some near-bank trees that
   overhang the top of frame (lush/immersive). For the **open vista**, exclude
   trees closer than ~15 m (`if y < -30 …` → widen), leaving more sky/water.
6. **Wind/animation**: Sapling has armature/wind; or geo-nodes leaf sway.
7. Keep the **frustum-cull + per-tree-seed + species-preset** approach — it's the
   part that makes a unique, varied, affordable forest.

---

## 7. Evolution (session timeline)
Sunset lake vista → real procedural **cattails** → **structural** stylized trees
(unique + species) → **Adaptive-Subdivision** pebbled/rock shore (`hd`) →
**Autumn Rain** (overcast + mist + rippled water) → **splash rings** + **streaks**
+ **wet reeds** → **photoreal Sapling** multi-species trees, visibility-culled
(`pr`). Each mood is a composable flag; the sunset default is preserved.
