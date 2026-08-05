# STORMFEA Methodology

The engineering theory behind STORMFEA, gathered from the solver source into one
narrative. This is the Markdown companion to the in-app document served at
`GET /api/methodology` (which is formatted for printing into an FTC engineering
notebook). For where each piece lives in code, see
[`ARCHITECTURE.md`](ARCHITECTURE.md).

Units throughout the solver are **mm / N / MPa (N/mm²) / tonne**. All arithmetic
uses Float64.

---

## 1. The problem: FDM parts are not isotropic

Conventional FEA assumes an **isotropic** material — equal stiffness and strength
in every direction. FDM (fused-deposition) prints are not: layers bond weakly to
each other, so the through-layer (Z) direction is markedly weaker than the
in-layer (XY) plane.

| Direction | Relative stiffness | Relative yield |
|-----------|-------------------|----------------|
| In-layer (XY) | 100% | 100% |
| Through-layer (Z) | ~65% | ~58% |

A flat-printed bracket that isotropic FEA calls "safe" can fail near **58%** of
the predicted load, because the solver never saw the weak inter-layer plane.
STORMFEA models this anisotropy explicitly.

---

## 2. Constitutive model — transversely isotropic

FDM parts are modeled as **transversely isotropic** (orthotropic with one plane
of symmetry: the XY layer plane). The stiffness matrix **C** is built from five
independent elastic constants (`server/solver/element.ts`,
`buildAnyConstitutiveMatrix`):

| Constant | Meaning | Default ratio | Source |
|----------|---------|---------------|--------|
| `E_xy` | in-layer Young's modulus | — | material DB |
| `E_z` | through-layer modulus | `E_z/E_xy = 0.65` | Perez et al. 2021 |
| `G_xz` | out-of-plane shear modulus | `G_xz/G_xy = 0.40` | Ahn et al. 2002 |
| `ν_xy`, `ν_xz` | Poisson ratios | `ν_xz = 0.30` | Casavola et al. 2016 |

Strain uses Voigt ordering `[εxx, εyy, εzz, γxy, γyz, γxz]`, so **C** is 6×6.
When the five constants collapse to isotropy (`E_z = E_xy`, etc.), **C** reduces
to the standard isotropic matrix — verified to `< 1e-6` by the validation suite.

**Layer-height correction.** Yield in Z varies roughly linearly with layer
height (thicker layers bond worse): about −15% to +10% over the usable range,
around a 0.2 mm baseline (Farashi & Vafaee 2022). This `layerHeightFactor` is the
default process input to bond strength when no full process block is supplied.

**Process → bond strength (bead-penetration model, opt-in).** When the MATERIAL
tab's process settings (nozzle temperature, print speed, cooling fan, bed/ambient
temperature) are provided — G-code auto-fills them — `solver/bond.ts` predicts
the `S_zt`, `S_zs`, and `E_z` ratios from an anchored physics chain: interface
temperature history (lumped-capacitance cooling) → neck growth (Frenkel/Pokluda)
→ reptation healing (Φ^¾), plus a void/consolidation factor for cold-deposition
interbead porosity. Multipliers are **relative** and normalized to exactly `1.0`
at the per-material reference condition (reference nozzle AND reference cooling
fan — both per-material — 60 mm/s, bed 60 °C) evaluated at the same layer height,
so with no process block the legacy layer-height path is reproduced bit-for-bit.
The reference **fan is per-material** (issue #184): PLA/PETG 100%, TPU 50%,
ASA 20%, ABS/PA12 0% — each material's normal print practice, so "multiplier =
1.0" is a condition the material is actually printed at (the old shared 100%
anchored ABS/ASA/PA to a fan-off-avoiding setting that promotes the very warping
and interlayer cracking this model predicts). PLA and PETG keep the 100%
reference, so their results are unchanged; only ABS/ASA/TPU/PA12 shift. Surfaced
as `materialModel.bond.coolingFanRefPct`. Trends are locked (hotter nozzle ↑,
more fan ↓, faster printing ↑) even though the constants are LOW confidence until
fitted from a printer process sweep (`POST /api/calibration/bond-sweep`). The
`POST /api/bond-sensitivity` route evaluates the same model for the process
dashboard and a nozzle×speed bond-quality surface without running a solve.

**Infill & pattern.** The single-material (default) model scales in-plane
stiffness by ONE density law shared across every toggle (issue #176):
`knockdown(ρ) = wallCredit + (1 − wallCredit)·g_GA(ρ)`
(`lumpedInPlaneStiffnessScale`, `solver/lattice.ts`) — a Voigt volume average of
solid perimeter walls and a Gibson-Ashby infill core `g_GA(ρ) = ρⁿ·(1 − c(1−ρ))`,
i.e. the lumped limit of the two-region model's `E_eff = Vf·E_solid +
(1−Vf)·E_solid·g(ρ)`. The `wallCredit` is a geometry-free `min(0.9, 0.10·wallCount)`
perimeter-fraction proxy (LOW confidence; the two-region model supersedes it with
the exact per-element wall fraction when geometry is available). Both single-material
paths route through this one law — the **Classical Laminate Theory** path
(`solver/laminate.ts`) passes it as the A-matrix scale (replacing the legacy
linear-ρ scaling), the isotropic-base path as the `E_xy` scale (replacing the
legacy `min(1, 0.30 + 0.70ρ + wallBonus)·patternMul`) — so a 20% part no longer
swings 2–5× between the CLT and two-region toggles. Pattern enters stiffness only
through the Gibson-Ashby family exponent (pattern *strength* multipliers stay a
strength concept, no longer folded into stiffness). At 100% infill `g_GA(1) = 1`
exactly, so `knockdown = 1` and every path reproduces the solid (anchor). Density
knockdown is now decoupled from the strength multiplier, which keeps driving
`yieldXY` on its own linear infill curve.

**Two-region model (walls vs infill, opt-in).** The default model above smears
perimeter walls and infill into ONE homogenized material (walls enter only as a
geometry-blind +10%-per-wall strength bonus). The two-region model
(`print.twoRegion`, MATERIAL tab toggle) instead classifies each element
geometrically:

- **Wall band** = `wallCount × extrusionWidthMm` (line width auto-imported from
  G-code, default 0.45 mm; the MATERIAL tab shows the resulting band thickness
  live as either input changes). Every corner node's exact distance to the tet-mesh
  boundary is computed (point-to-triangle, `solver/distance.ts`); each element
  then gets the exact **volume fraction** of itself inside the band via a
  marching-tet level-set cut on its 4 corner distances (`solver/wallfrac.ts`).
  Fractions — not hard labels — because volume elements (2.9–6.3 mm edges) are
  2–5× thicker than a typical 1.35 mm wall band.
- **Floors & ceilings (top/bottom solid skins).** Slicers lay solid horizontal
  skins on the top and bottom of a part independently of the vertical
  perimeters. When modeled, `solver/wallfrac.ts` unions independent top/bottom
  skin bands (split at the build-axis mid-plane, oriented by the build axis)
  into the same shell penetration field, so a floor/ceiling element is treated
  as dense shell just like a perimeter wall.
- **Wall-to-wall (bead-to-bead) bond (opt-in).** With `twoRegion` and
  `wallCount ≥ 2`, `buildWallBondField` (`server/twoRegion.ts`) marks elements on
  the internal loop-to-loop boundary and their local wall-normal. Stress recovery
  then applies a **second, independent interface check** in that per-element
  wall-normal frame (distinct from the global-Z interlayer check), governing via
  `min()` alongside the bulk/interlayer SFs. Uses the inter-pass revisit time for
  bonding; no dedicated coupon data exists, so it is LOW confidence. Two
  geometry corrections make it faithful:
  - **Loop-length basis (#182).** The inter-pass revisit time is
    `outerLoopPerimeter / printSpeed`. `estimateWallLoopPerimeterMm` groups the
    vertical boundary faces into connected loops and keeps only the **outer
    contour(s)** by the sign of each loop's projected cross-section (outward
    normals ⇒ outer loops enclose positive area, hole bores negative), so
    internal bolt-hole bores no longer inflate the loop length and understate
    the bond. A solid part is bit-identical to the legacy all-vertical-area sum;
    surfaced as `materialModel.wallBond.loopLengthBasis`.
  - **Thermal depth = line width (#185).** The τc road-cooling constant
    `τc = π·ρ·cp·d/(8·h)` uses the road's characteristic thermal depth `d`. For
    the vertical weld that is the bead **line width** (adjacent beads cool
    laterally through their sides), which the same π/8 elliptical-road prefactor
    covers with the width/height roles swapped. It is passed as a **named
    thermal-depth argument with a width-appropriate clamp**
    (`WALL_THERMAL_DEPTH_CLAMP_MM = [0.1, 2.0] mm`), not the layer-height clamp —
    so a >1.0 mm large-nozzle bead is no longer silently pinned to 1.0 mm.
    Results are unchanged for in-clamp (≤1.0 mm) widths.
- **Shell** carries solid-material properties (calibrated coupon values flow to
  it unchanged); **core** carries wall-free lattice properties from
  Gibson-Ashby power laws in relative density (`solver/lattice.ts`), applied as
  PER-AXIS scale factors on the solid's natural-frame constants
  (`buildCoreMaterial` in `analysis.ts`): stiffness `g(ρ) = ρⁿ·(1 − c(1−ρ))`
  per axis and strength `s(ρ) = min(1, patternMul·ρᵐ)` **also per axis**
  (yieldXY / yieldZ / yieldZShear each carry their own exponent — issue #177) —
  near zero at 0% infill (floored at 10⁻³×solid; the legacy curve's 0.30
  intercept represents the walls and is not reused). Exponents are per pattern
  family, confidence LOW, regression-locked, calibration-overridable (an
  override routes both stiffness and strength to a single scalar law — one
  fitted exponent can't say which axis it belongs to):

  | Family | Patterns | n in-plane (c) | n through-layer (c) | n G_xz (c) | n G_xy | Strength m (xy / z / zs) |
  |---|---|---|---|---|---|---|
  | TPMS-like 3-D | gyroid, cubic, adaptive | 1.75 (0.12) | 2.1 (0.18) | 2.3 (0.22) | derived | 1.25 / 1.5 / 1.6 (stretch-dominated) |
  | extruded walls | grid, lines, honeycomb, trihexagon, concentric | 2.0 (0.10) | 1.0 (rule of mixtures) | 1.5 (0.10) | 3.0 (honeycomb bending) | 1.5 / 1.0 / 1.5 (bending-dominated) |
  | sparse | lightning | 2.0 ×0.3 prefactor | 2.0 | 2.0 | derived | 1.5 / 1.5 / 1.5 |

  Extruded-wall infill is continuous along the build axis, so BOTH its
  through-layer stiffness (n = 1, rule of mixtures) and its through-layer
  strength (m = 1) are the mildest, and the core's anisotropy INVERTS at low
  density: `E_z > E_xy` AND `yieldZ > yieldXY` in the core. The per-axis
  strength exponents mirror the stiffness-exponent ordering per family, so
  `sign(E_z − E_xy)` now agrees with `sign(yieldZ − yieldXY)` in the core
  (previously the single scalar strength law kept the solid's yieldZ/yieldXY =
  0.58 ratio, claiming a Z-stiffer-yet-Z-weaker core at once — issue #177).
  Because ν_zx = ν_xz·E_z/E_xy would then exceed the thermodynamic
  stability limit, ν_xz is scaled by `min(1, gXY/gZ, gZ/gXY)` — symmetric so
  the bound holds in the natural frame and after the upright scalar swap
  alike. Because ν_zx = ν_xz·E_z/E_xy would then exceed the thermodynamic
  stability limit, ν_xz is scaled by `min(1, gXY/gZ, gZ/gXY)` — symmetric so
  the bound holds in the natural frame and after the upright scalar swap
  alike. Per-bin constitutive matrices are true Voigt blends of the two
  rotated endpoint matrices `C_b = f·C_shell + (1−f)·C_core` (engineering-
  constant blending would no longer agree once the ratios diverge); the
  scalar `averageMaterial` remains an engineering-constant blend, a
  first-order approximation used only by scalar consumers.

  Anchors: every `g(1) = 1` and `s(1) = min(1, patternMul)` exactly, so 100%
  infill reproduces the solid bit-for-bit and collapses to the uniform path.
  Orientation does not enter core stiffness (only the weakAxis rotation /
  scalar swap does, applied AFTER the natural-frame scaling); it still scales
  strength. Both regions keep the full orientation anisotropy (layer bonds
  exist in walls and infill alike).
- Fractions are quantized into Voigt-blended bins of constitutive matrices,
  yields, and densities (`twoRegion.ts` → `ElementMaterialField`), consumed
  per element by assembly, stress recovery, mass, and self-weight. The bin
  **spacing is adaptive to the shell:core contrast** (issue #178): low/medium
  contrast keeps the legacy 9 LINEARLY spaced bins bit-for-bit, but above a
  ~9:1 contrast the fractions are LOG-spaced and the count grows (capped at 33)
  so no adjacent-bin stiffness step exceeds ~2×. Without this, at the ~10³:1
  contrast of a near-zero-infill core a 0.01 change in wallFrac could flip an
  element's stiffness ~100× (0.06→bin0≈1× vs 0.07→bin1≈126×). The bin ENDPOINTS
  stay f=0 and f=1 exactly, so pure-phase elements map to the endpoint matrices
  bit-for-bit and the field SHAPE is unchanged (binCount is read as C.length/36,
  so the assembly-worker payload is untouched). The scalar `material` becomes
  the volume-weighted average and keeps feeding whole-part consumers (error
  estimate, analytic hole checks).
- **Anchoring:** endpoints agree with the legacy model by construction (100%
  infill → solid; thin part → all walls). In between the summary reports both
  the implied average multiplier and the legacy global one — deliberately not
  renormalized, because the divergence (legacy under-credits wall-dominated
  thin sections) is what the model corrects. The results panel displays this
  divergence directly (implied vs legacy multiplier with the relative delta,
  highlighted when it exceeds 10%).
- **Validation:** a sandwich cantilever solved with the classified field
  matches composite-EI beam theory within 0.3% where the homogenized model is
  ~23% too soft (`solver_validation.ts` group 25); a Taguchi L9 orthogonal
  array sweeps infill/walls/pattern/orientation for main-effect sanity.
- **Core yield criterion (Deshpande–Fleck–Ashby, issue #171).** The homogenized
  infill core is a cellular solid: it yields under HYDROSTATIC stress (the
  lattice compacts), unlike the deviatoric von Mises the solid obeys. Core bulk
  yield therefore uses the isotropic-foam DFA criterion
  `σ̂² = (σ_vm² + α²·σ_m²)/(1 + (α/3)²)` (σ_m = mean stress), with the
  pressure-sensitivity `α(ρ) = 2.08·(1 − ρ)` (Deshpande & Fleck 2000). The
  `(1 + (α/3)²)` normalization keeps the in-plane uniaxial yield at yieldXY for
  every α, so DFA never disturbs the coupon anchor — it only ADDS hydrostatic
  yield. `α(1) = 0` EXACTLY, so at ρ=1 (and in every shell/wall bin and the
  single-material flag-off path) the criterion collapses to von Mises
  bit-for-bit; α grows toward 2.08 as ρ→0. Applied per element via the
  core-fraction-weighted per-bin α `(1−shellFrac)·α(ρ)` in
  `recoverElementStress`; a strength-side change only (stiffness untouched).
  The α₀ magnitude and the linear knockdown are literature-form estimates,
  confidence LOW, regression-locked (`dfa-core-yield.test.ts`).
- **Known limits:** Voigt blending is an upper bound inside the one-element
  transition band; nozzle-temp/flow effects on bond quality are captured
  empirically via calibration coupons, not parametric inputs; the DFA core
  criterion is isotropic (an anisotropic honeycomb-foam extension, and a fitted
  α(ρ), remain follow-ups).

**Print orientation (weak-axis rotation).** The weak (through-layer) axis is the
FDM layer normal. **C** is built in the material's local frame (weak along local
Z) and then rotated so that local Z aligns with the part's actual layer normal —
an exact 90°/arbitrary **Bond transform** implemented as a 4th-order tensor
rotation (`rotateC6` / `rotationAligningZTo` in `solver/element.ts`), driven by
the `weakAxis` field on the material. When a **bed face is picked** the client
sends that layer normal (`layerNormal`), so flat, **upright**, and angled prints
are all handled exactly — the failure criterion (below) is likewise evaluated in
the rotated frame. Flat prints have `weakAxis = +Z`, i.e. the identity, so the
common case is unchanged. When no bed is picked (azimuth unknown), an upright
print falls back to a **conservative scalar swap** (both horizontal directions
treated as weak). This supersedes the previous scalar-swap-only approximation
(issue #101).

---

## 3. Elements

Two tetrahedral elements (`server/solver/element.ts`):

- **C3D10** — 10-node quadratic tet (default). Second-order shape functions
  capture bending and stress concentrations without shear locking. Integrated at
  the standard 4-point Gauss rule.
- **C3D4** — 4-node linear tet. Constant strain → constant stress per element; no
  numerical integration needed (single centroid evaluation). Faster but
  underpredicts bending stress by ~55% due to shear locking, so it is offered only
  as a speed option.

For node `i` the B-matrix maps nodal displacements to strain; element stiffness
is **kₑ = ∫ Bᵀ C B dV**. C3D10 midnode ordering follows the Gmsh convention
(corners 0–3; edge midpoints 4–9); TetGen's permutation is pinned by a regression
test.

---

## 4. Assembly, boundary conditions, and solve

**Global stiffness (`solver/assembly.ts`).** Element matrices are assembled into a
global **K** stored in **CSR** (Compressed Sparse Row) via a two-pass build
(sparsity pattern, then values). Invariants — sorted column indices, tracked
diagonal, symmetry — are asserted. A worker-thread path (`assembly-worker.ts`)
parallelizes assembly and is proven equivalent to the serial path by a dedicated
test.

**Boundary conditions (`solver/boundary.ts`).** Dirichlet constraints (bolted
holes fixed) are applied by the **penalty method**: add a large `K_penalty` to the
constrained diagonal and `K_penalty · gᵢ` to the load, so `uᵢ ≈ gᵢ` to a relative
error of ~1e-8.

**Loads (`solver/load.ts`).** Point forces, surface pressure, and body forces
(self-weight, acceleration/impact in multiples of *g*) build the right-hand side
**f** in Newtons. Surface pressure is applied as a consistent tributary-area
traction over a selectable region (`selectPressureRegion`): the extreme face
toward a direction (`face`), every triangle facing that direction (`facing`), or
the whole exterior (`all`, i.e. hydrostatic). A **normal-to-surface** option
(`assembleSurfaceTractionNormal`) follows each triangle's own outward normal for
curved/non-planar faces; a negative magnitude is outward (suction). The box-mesh
fallback carries surface connectivity (`extractSurfaceFaces`), so pressure loads
work there too.

**Linear solve (`solver/cg.ts`).** `K·u = f` is solved with **Preconditioned
Conjugate Gradient (PCG)** (Saad §6.7) using a Jacobi (diagonal) preconditioner
(an incomplete-Cholesky IC0 option also exists). Iteration is capped to prevent
runaway on near-singular systems; residual checkpoints stream to the client so the
CG residual trend is observable (see the README Debugging table).

---

## 5. Stress recovery — SPR

Raw element stresses are `σ = C · B · uₑ`. For display and safety assessment they
are smoothed with **Superconvergent Patch Recovery (SPR)** (Zienkiewicz & Zhu
1992, `solver/stress.ts`): a least-squares polynomial is fit over each node's
element patch and sampled at the node, typically a 10–20% accuracy improvement
over direct nodal averaging, especially at stress concentrations. Every display
vertex receives a stress value; coincident vertices at mesh seams are welded so
the heatmap has no artificial discontinuities.

**What the fit is sampled from.** On C3D4 each element contributes one sample,
its centroid — the element's stress is constant, so that is the whole of it. On
C3D10 each element contributes its **four Gauss points**, where the stress
components are superconvergent, and the fit uses a quadratic basis matching the
element order. One sample per element left patches at convex model corners with
fewer points than a 3-D fit has unknowns, so they degraded to plain averaging,
which over a one-sided patch is biased by O(h·|∇σ|) *even when the finite-element
solution is exact*.

**One recovered field, not two.** The nodal quantity that is recovered is the
stress **tensor**. The displayed von Mises heatmap and the per-node utilization
ratios are projections of it, evaluated after the recovery rather than recovered
in their own right. Von Mises is a nonlinear, convex functional of σ, so
recovering it directly is a different operation — one with no superconvergence
result behind it, and one that by Jensen's inequality sits at or *above* the von
Mises of the recovered tensor, biasing the displayed peak upward. It also means
the picture the user reads and the field the error estimator (§7) judges are the
same field, rather than two independent recoveries free to disagree.

---

## 6. Failure assessment

### The FDM dual criterion (default)

The isotropic **von Mises** equivalent stress is

```
σ_vm = √( ½[(σxx−σyy)² + (σyy−σzz)² + (σzz−σxx)² + 6(τxy² + τyz² + τxz²)] )
```

STORMFEA's default failure criterion is the **FDM dual criterion**
(`fdmDualCriterionSF` in `solver/stress.ts`), evaluated in the material (layer)
frame with the weak/layer-normal axis as local *z*. It replaces the earlier
single Hill (1948) quadratic (see the [layer-model audit](layer-model-audit.md),
findings A1–A3) and separates two physically distinct mechanisms, taking the
governing minimum:

1. **Bulk (bead) yield** — plain von Mises against the in-layer yield `Y`:
   `SF_bulk = Y / σ_vm`. This is **azimuth-invariant by construction** (a norm
   cannot depend on the part's rotation about the build axis) — the property a
   calibrated single Hill form provably *cannot* have while also matching the
   measured in-plane shear yield.
2. **Interface (layer-bond) failure** — a tension⊕shear interaction on the layer
   plane, **tension-only** in the normal term (layers do not delaminate in
   compression):
   ```
   σzz > 0:  U = √( (σzz/S_zt)² + (τ_z/S_zs)² ),   SF_int = 1/U
   σzz ≤ 0:  Mohr–Coulomb friction credit — SF_int = S_zs / (τ_z − μ·|σzz|)
   ```
   with `τ_z = √(τyz² + τxz²)`, `S_zt = yieldZ` (through-layer tension) and
   `S_zs = yieldZShear` (interlaminar shear, default `yieldZ/√3`; `μ = 0.3`,
   LOW confidence). Compressive crushing is still caught by the bulk term.

`SF = min(SF_bulk, SF_int)`. Both mechanisms scale linearly with load, so the
safety factors are exact closed forms. At the isotropic anchor
(`S_zt = Y`, `S_zs = Y/√3`) the criterion reproduces von Mises for every
uniaxial, shear, and normal+transverse-shear state. The default `S_zs = yieldZ/√3`
is **exactly** the transverse-shear yield the legacy Hill coefficients
`L = M = 3/(2Z²)` encoded, so uncalibrated through-layer results match the legacy
criterion. The critical FTC case is unchanged: a **flat print loaded through the
layers** has `σzz` dominating and drops to `SF ≈ Y/Z ≈ 0.58` — the tool's core
"false-safety" claim. The result summary reports the governing SF, its criterion
label (`sfCriterion`), and the plain von Mises SF (`vonMisesSafetyFactor`) for
comparison.

**In-plane raster (cross-bead) anisotropy (opt-in).** A unidirectional or
dominant raster is weaker *across* the beads than along them. When enabled
(`AnalysisSettings.inPlaneAnisotropy`) **and** there is evidence — a measured
`crossBeadRatio` or a declared unidirectional raster — a third cross-bead
tension⊕shear check is added as a separate `min` on the **bulk** term, resolved
onto the raster axes (audit A7). The interface term is untouched, so azimuth
invariance about the weak axis is preserved. With no evidence the cross-bead
ratio is 1 (no penalty) and the criterion collapses exactly to the von Mises
bulk term; typical ±45° alternating rasters homogenize toward isotropic and stay
isotropic, which is why this is opt-in and evidence-gated. Absent a measured
`CalibrationProfile.crossBeadRatio`, the literature default is
`CROSS_BEAD_RATIO_LITERATURE = 0.85` — an engineering default mid-band of the
~0.7–0.9 spread reported for unidirectional-raster tensile coupons (no single
paper pins 0.85 exactly), confidence LOW; see the SOURCES tab entry
`cross_bead_ratio`.

**Legacy Hill.** The Hill (1948) quadratic (`hillEquivalentStress`) remains
callable (`criterion: "hill-legacy"`) for comparison and as the
upright-with-no-bed **scalar-swap** fallback — the interface criterion needs a
known weak axis, which that fallback deliberately lacks. When `Y = Z`, Hill
reduces exactly to von Mises, verified at the isotropic limit by the validation
suite.

### Bolt-region and interlayer failure modes

Beyond the headline SF, `server/analysis.ts` checks the mechanical failure modes
around bolted holes, each with an individual confidence level:

1. **Bulk yield** — the dual-criterion SF over the volume.
2. **Net-section tension** — tension across the reduced section through a hole.
3. **Shear-out** — the bolt tearing out toward a free edge.
4. **Thread strip-out** — threaded-engagement failure.
5. **Bearing (hole wall)** — crushing at the hole wall (confidence: LOW — no
   FDM-specific bearing data in literature).

When the dual criterion is active the layer interface is additionally
**decomposed** into two reported rows so delamination is calibrated separately
from the headline SF (both already folded into it):

6. **Interlayer tension (delamination onset)** — peak through-layer opening
   stress `⟨σzz⟩₊` vs the bond tensile allowable `S_zt`. LOW confidence, raised
   to MEDIUM when a Z-tension coupon is run.
7. **Interlayer shear** — peak driving interlayer shear (friction-credited under
   compression) vs `S_zs`. LOW confidence, raised to MEDIUM when a lap-shear
   coupon is run.

With in-plane raster anisotropy active, an **In-plane bead bond (cross-raster)**
row is added likewise. The optional **Linear buckling (BLF)** mode is added when
buckling is requested (§8). The governing (lowest-SF) mode drives the overall
verdict.

### Fatigue (Goodman)

A fatigue-life estimate uses the **modified Goodman** relation (plus Basquin for
cycle count) with an orientation-dependent endurance ratio `Se/UTS = 0.37`
(flat print, inter-layer bonds are the weak link) or `0.43` (upright print)
(Wang et al. 2020). The **load ratio** `R = σ_min/σ_max` is a user input (default `0`,
pulsating): `σ_a = σ_max(1−R)/2`, `σ_m = σ_max(1+R)/2`, with compressive mean
stress conservatively clamped to zero. `R = −1` is fully reversed; `R > 0` is a
tension-biased cycle. Confidence is LOW by default — published FDM S-N data is
sparse — so it is reported as an estimate, not a guarantee. A team can raise it
to MEDIUM by fitting their own S-N curve: enter cyclic-coupon (σ_amplitude,
cycles) points at `POST /api/calibration/fatigue`, which least-squares fits the
Basquin exponent `b` and endurance ratio `Se/UTS`; those measured constants then
replace the literature defaults and lift the fatigue mode to MEDIUM confidence
(the same LOW→MEDIUM data gate the bearing coupon uses) — **provided the fit is
clean**; a poorly-fitting (high-scatter) S-N dataset is still used but stays LOW
confidence (see the fit-quality gating note in §8).

---

## 7. Convergence & discretization error

Every finite element solution is an approximation whose error shrinks as the
mesh refines. STORMFEA surfaces that error two ways: an in-app **estimate** of
where it concentrates (the ZZ heatmap, no re-solve needed) and an actual
**measurement** of the trend (running a second, finer mesh). *(The estimator's
internals are under revision in #207/#209 — energy-norm and observed-order
Richardson improvements exist on other branches but are not on `main`; this
section documents `main`'s current behavior.)*

### The ZZ (Zienkiewicz–Zhu) error estimate, η

`computeZZErrorEstimate` (`server/solver/stress.ts`) recovers a smoothed stress
field with **SPR** (§5) and compares it against the element field — the gap
between "what the mesh computed" and "what a locally-fitted polynomial says it
should be" is the error indicator, per Zienkiewicz & Zhu 1992.

It is a **true energy-norm integral**, evaluated at each element's Gauss points:

```
η_e² = Σ_g w_g · |detJ_g| · (σ*(x_g) − σ_h(x_g))ᵀ C⁻¹ (σ*(x_g) − σ_h(x_g))
```

- `σ*` is the recovered field: the **6-component** SPR nodal stress
  (`sprSmoothedStress6`) interpolated to the Gauss points with the element's own
  shape functions — quadratic with midside nodes on C3D10, linear barycentric on
  C3D4. No distance weights and no dimensional constants, so the interpolation is
  exact and scale-invariant.
- `σ_h` is the element field, `σ = C·B·u`, evaluated at each Gauss point on
  C3D10 (constant per element on C3D4).
- `C⁻¹` is the compliance, one 6×6 inverse per material **bin** — the single
  rotated material normally, or the per-bin blended `C` when a two-region
  `ElementMaterialField` is active (§2). Using the full tensor norm rather than a
  scalar magnitude is what makes soft directions dominate: with `E_z ≪ E_xy`, a
  through-thickness error outranks an in-plane one of equal magnitude, which is
  the ordering an FDM part needs.

Element volume enters through the Gauss factor `w_g·|detJ_g|`, so error is
weighted per unit of part volume rather than per element — a cluster of small
elements does not outvote one large one by count. *(Three earlier
approximations — a scalar von Mises magnitude difference, inverse-distance
interpolation to the centroid, and no volume weighting — were replaced by the
above in issues #143 / #144 / #145.)*

**Normalization.** Per-element η is that error energy normalized by the
  **global** stress energy norm, `‖σ‖_global = √(Σ_e ∫ σ_hᵀ C⁻¹ σ_h)`:

  ```
  η_e = ‖error‖_e / ‖σ‖_global
  ```

  So **η is a share of the whole part's energy norm, not a percentage error on
  that element's own stress value.** Two consequences that make it easy to
  misread:
  - Refining the mesh spreads the same total error over more elements, so the
    same physical defect produces a *smaller* η per element on a finer mesh —
    η values are not comparable across mesh densities.
  - η says nothing about whether the *element's own* stress is high or low in
    absolute terms — a low-stress element in a poorly-resolved region can rank
    above a high-stress element in a well-resolved one.

  `globalRelativeError` (returned alongside `errorEstimate`) is the one number
  that IS an absolute, whole-part accuracy read: the root-sum-square of every
  element's η, `√(Σ_e η_e²)`. It answers "how far is this solve, overall, from
  the SPR-smoothed reference" — the η heatmap then shows *where* that total is
  concentrated. STORMFEA's client shows both together for exactly this reason
  (η heatmap legend, issue #151): the map for "where to refine," the global
  figure for "how much to trust the numbers."

  **What the suite actually proves about them.** Beyond the sanity checks
  (`solver_validation.ts` [14.2]/[14.4]: both defined and non-negative, finer
  mesh ≤ coarser), the estimator is measured against **manufactured solutions
  with a known exact stress field**. The effectivity index θ = η / ‖σ_exact −
  σ_h‖ is held to the classic [0.7, 1.3] window on C3D4 and to a monotone
  approach toward 1 from the conservative side ([30.1]–[30.3]); on C3D10 it is
  held to θ > 1 with a ceiling of 2.0 and a monotone trend ([33.4], [33.5]),
  and on a field C3D10 reproduces exactly, η is required to be round-off rather
  than O(h) ([33.2]). So the direction and trend are locked, and on C3D4 the
  magnitude is too. C3D10's θ ≈ 1.5 on a structured box is outside the classic
  band: the estimate is **conservative** there, not calibrated. Read both
  numbers as indicators with a known bias direction, not as error bounds.

### The 5% "converged" threshold

Both the automatic background check and the manual mesh-convergence study use
the same criterion, hard-coded as `changePct < 5.0` (percent) — in
`client/index.html`, once for the automatic upgrade path
(`const converged = changePct < 5.0;`, near line 6094) and once for the manual
multi-mesh study (same expression, near line 8558). `changePct` is the
percent change in **peak von Mises stress** between two mesh levels:

```
changePct = |maxVM_fine − maxVM_std| / maxVM_std × 100
```

Under 5% is reported "converged" / "mesh-independent within tolerance"; 5% or
more triggers an automatic swap to the finer mesh's results (the "auto-
upgrade" badge) in the background-check path, or a "not converged" call-out in
the manual study. 5% is an engineering heuristic on ONE scalar (peak stress at
one point), not a formal a-posteriori bound — a badge can read "converged"
while a different, non-peak location is still drifting.

**C3D4 caveat.** For linear tetrahedra (C3D4), two meshes can agree within 5%
because both suffer the *same* shear-locking stiffening, not because the
answer is right (`client/index.html` badge text: "Standard and fine C3D4
meshes agree because both are equally locked, not because they are correct" —
C3D4 underpredicts bending stress by ~55% at practical densities). C3D10
(quadratic) elements skip the check entirely — the standard-mesh response
already reports `nodesPerElem === 10`, and the code treats quadratic elements
as not needing the fine-mesh confirmation (`client/index.html:6061–6064`).

### The SF > 3.0 smart-skip

The background fine-mesh check itself only runs when it is likely to matter.
`client/index.html:6056–6084`: if the standard mesh has no computable safety
factor (`safetyFactorAvailable === false`), the fine mesh is skipped outright
— a finer mesh cannot manufacture an SF that doesn't exist. Otherwise, if
`stdSF > 3.0` the fine mesh is also skipped and a "clearly safe" badge is
shown instead. The rationale (`client/index.html` badge sub-text): a part
already at 3× the failure load has enough margin that mesh-driven changes to
the peak stress are very unlikely to flip the SF below 1, so the extra solve
is not worth the compute cost. This is a heuristic gate on cost, not a proof —
it is skipped only for the *background, automatic* check; the manual
multi-mesh "MESH CONVERGENCE STUDY" button always runs every requested mesh
level regardless of SF.

### Manual convergence study & Richardson extrapolation

The "MESH CONVERGENCE STUDY" action (`client/index.html`, around line 8520)
re-solves the model at several mesh-quality settings and reports peak von
Mises stress, node/element counts, and SF at each level. From the **two
finest** results in that set it computes a Richardson-extrapolated estimate of
the mesh-independent stress (`client/index.html:8554–8573`):

```
r  = (nodes_fine / nodes_std)^(1/3)     // refinement ratio, from node counts
p  = 2                                   // ASSUMED convergence order — not
                                          // measured from the mesh series
σ_exact ≈ σ_fine + (σ_fine − σ_std) / (r^p − 1)
```

`p = 2` is a fixed assumption ("assumed for linear elements" per the code
comment) rather than an order observed from the actual sequence of results —
main does not fit `p` from 3+ mesh levels (an "observed-order" Richardson fit
is planned in #209, not yet merged). The refinement ratio `r` is derived from
node counts as a proxy for element-size ratio (`(nodes_fine/nodes_std)^(1/3)`,
appropriate for uniform 3-D refinement, not guaranteed for adaptive/local
refinement). The extrapolated value is only trusted, and shown, when it lands
in a sane envelope, `0 < extrapolated < 3 × σ_fine`
(`client/index.html:8569`) — outside that range the raw finest-mesh value is
used with no extrapolation note. The same `< 5%` criterion (previous
subsection) decides the study's own "converged" / "not converged" call-out,
here compared between the last two mesh levels in the study.

### What this machinery does not cover

- **Singularities.** Reentrant corners, point loads, and sharp fillets are
  classic FEA stress singularities: the theoretical peak stress grows without
  bound as the mesh refines there, so `changePct` at that location will not
  settle below 5% no matter how fine the mesh gets, and Richardson
  extrapolation's assumed order does not apply. STORMFEA does not currently
  detect or flag singular regions separately from ordinary discretization
  error; a persistently "not converged" result at a sharp geometric feature
  should be read as evidence of a singularity, not treated as a mesh-density
  problem to solve by refining further.
- **η is diagnostic, not a safety gate.** Nothing in the SF/verdict pipeline
  reads `errorEstimate` — a high-η region does not lower the reported SF or
  block the "safe" verdict. It is purely an accuracy diagnostic for the user.

---

## 8. Optional analyses

- **Modal (`solver/modal.ts`).** Solves `K·φ = ω²·M·φ` by subspace iteration with
  shift-invert for the lowest natural frequencies; `f = √(ω²)/(2π)`. Mode shapes
  animate in the viewer.
- **Linear buckling (`solver/buckling.ts`).** Assembles the geometric stiffness
  `Kσ` from the pre-stress state and solves `(K + λ·Kσ)·φ = 0` by inverse power
  iteration for the smallest positive **Buckling Load Factor**.

---

## 9. Calibration

Literature defaults carry **MEDIUM** confidence. Teams can upgrade to **HIGH** by
printing standard coupons on their own printer/filament, pulling them to failure,
and entering the loads (`POST /api/calibration/calculate`, downloadable STLs at
`GET /api/calibration/coupon/:type`):

| Coupon (`:type`) | Measures | Derivation |
|--------|----------|------------|
| Tensile dog-bone (`tensile`) | `yield_XY`, `E_xy` | F/A at fracture; stress/strain at yield |
| Z-tension dog-bone (`ztensile`) | `yield_Z` = `S_zt` (through-layer tension) | same gauge printed **standing on end**, loaded in pure opening; F/A directly |
| Lap-shear plate (`lapshear`) | `S_zs` (interlaminar shear) | F/(w·l) → shear allowable |
| Bearing plate (`bearing`) | bearing strength | F/(d·t), corrected by Kt from FEA |

The dual criterion keeps `S_zt` (Z-tension) and `S_zs` (lap-shear) **independent**
— the lap-shear coupon no longer back-derives `yield_Z` through a fixed `τ/0.58`
coupling (audit A5). The **lap-shear** and **Z-tension** coupons measure the
inter-layer bond, the single most influential input; running either lifts the
matching delamination mode LOW→MEDIUM. Lap-shear and bearing joints concentrate
stress beyond nominal F/A, so `POST /api/calibration/kt` runs FEA on the coupon
geometry to recover the stress-concentration factor Kt and correct the derived
strength.

Two further calibrations fit process/cycle models rather than static allowables:
`POST /api/calibration/fatigue` least-squares-fits the Basquin exponent and
`Se/UTS` from cyclic-coupon points (fatigue LOW→MEDIUM), and
`POST /api/calibration/bond-sweep` fits the bead-penetration bond coefficients
from a process sweep of Z-tension coupons (bond model LOW→MEDIUM).

**Fit-quality gating (both fitted models).** A fit that reproduces the data
poorly must not silently earn the LOW→MEDIUM upgrade, so each endpoint measures
its own residual and gates on it. The residual is always returned — even a clean
fit shows its evidence — and every response carries an additive `fitQuality`
field.

- **Bond sweep — reject.** `fitBondCoeffs` reports `rmsePct`, the RMS of
  (predicted − measured) Z-tension strength as a percentage of the mean measured
  strength. A clean sweep fits to well under 1%; the threshold is **15%**
  (`BOND_FIT_RMSE_MAX_PCT`, generous headroom that still catches a mislabeled
  point — a single 3× outlier lands near 77%). Above it the endpoint **refuses
  with 400**, naming the worst datum and its deviation. Rationale: the fitted
  coefficients are applied *multiplicatively* to interlayer strength and stiffness
  in **every** subsequent process-aware analysis, so accepting a fit the physics
  cannot reproduce would corrupt all of them at once; the literature-constants
  path (no `bondCoeffs`) stays the honest default.
- **Fatigue — accept but keep LOW.** `fitFatigueProfile` reports `logRms`, the RMS
  residual of the log-log Basquin regression (≈ multiplicative amplitude scatter).
  The threshold is **0.15** (`FATIGUE_LOGRMS_MAX`, ≈ ±16%). S-N scatter is
  physically inherent, so a team's own noisy coupons are still their best data —
  the endpoint **accepts** the fit and stores the measured `Se`/`b`, but tags the
  profile `fatigueFitQuality: "poor"`, which keeps `estimateFatigue` at **LOW**
  confidence (no MEDIUM upgrade) and says so in the mode note. A clean fit behaves
  exactly as before. The reject-vs-keep split is deliberate: bond coefficients
  are global multipliers on load-bearing allowables, whereas the fatigue fields
  drive only the already order-of-magnitude fatigue mode.

---

## 10. Validation

The solver ships an automated validation suite
(`server/tests/solver_validation.ts`, run via `npm run test` and reproducible live
at `GET /api/solver-tests`) that checks the kernel against problems with known
answers, grouped by:

- **Patch test** — uniform strain reproduced exactly.
- **Cantilever beam** — tip deflection within the expected C3D10 band of the
  Euler–Bernoulli solution; linear scaling (2× load → 2× deflection).
- **Constitutive matrix** — orthotropic **C** reduces to isotropic von Mises when
  `Y_z = Y_xy` (`< 1e-6`).
- **Element checks** — C3D10 shape-function partition of unity; `kₑ` symmetric
  (`< 1e-8`) and positive-definite.
- **Failure criterion** — the FDM dual criterion reproduces von Mises at the
  isotropic limit and is **azimuth-invariant** about the weak axis; in-plane
  uniaxial yields exactly at `Y_xy`; the false-safety case (flat print,
  through-layer load) detects `SF ≈ 0.58` — the core engineering claim. The
  legacy Hill form is checked for the same anchors where it stays callable.
- **Kt calibration** — a uniform coupon bar returns `Kt ≈ 1.0` within noise.
- **Hole-in-plate concentration** — a plate with a central hole in uniaxial
  tension returns the classic Kirsch `Kt ≈ 3.0` (peak/gross) within ~15%, run
  through the production solver on a mesher-free structured C3D10 fixture.
- **Weak-axis rotation** — the Bond-transform core (`bond-rotation.test.ts`):
  identity for `+Z`, correct modulus reorientation, and an end-to-end anisotropy
  flip when the weak axis is rotated.

These solver checks run alongside the Vitest unit tests, the parallel-assembly
equivalence check, and the client-logic checks. Exact counts are reported by
`npm run test`; see the README's Contributing section for the current totals.

### 9.1 Per-analysis validation coverage (issue #191)

The suite scoreboard above is **global** — it reports that the whole suite
passes, not whether the suite covers the specific model path a given analysis
just exercised. Those are different assurances: an isotropic C3D4 part with a
single applied force rests on a very different (larger) set of anchors than a
C3D10 two-region part with a bond-process block and bolt loads.

`server/validation-coverage.ts` maintains a small, explicit mapping from
configuration **axes** (element order, material model, failure criterion,
load types, mesher, opt-in options) to the solver-validation groups and unit
suites that directly exercise each axis value. Every analysis computes its own
**fingerprint** from its actual characteristics and gets back a coverage
report (`summary.validationCoverage`) — surfaced in the client as a
"Validation Coverage" panel near the results, and identical data is available
via the API.

**What a coverage claim means:** the listed suite exercises the same *kind*
of characteristic (e.g. "runs a C3D10 mesh", "activates the two-region
material field") somewhere in the automated suite.

**What it does NOT mean:** it is not a claim that this exact geometry, load
case, or material combination has been proven correct — that would require a
regression fixture matching the user's actual part, which the project does
not maintain. Coverage is also tracked primarily **per-axis**, not per full
combination; a small, explicitly-maintained list of **known combination
gaps** (`KNOWN_COMBO_GAPS`) states plainly where two individually-covered
axes have no direct anchor for their *combination* (e.g. two-region
validation runs exclusively on C3D10 meshes today, so C3D4 + two-region has
no direct combination anchor even though each axis alone does). An
intentionally-uncovered axis or combination is reported as a plain gap
statement, never silently implied as covered — this is checked directly by
`server/tests/unit/validation-coverage.test.ts`, including a CI guard that
every axis value in the fingerprint enum has an explicit (possibly empty)
entry in the coverage map, so a new feature must declare its coverage or
declare none rather than falling through unmapped.

---

## References

- Hill, R. *A theory of the yielding and plastic flow of anisotropic metals.*
  Proc. R. Soc. A, 1948. (and *The Mathematical Theory of Plasticity*, OUP 1950)
- Zienkiewicz, O.C. & Zhu, J.Z. *The superconvergent patch recovery and a
  posteriori error estimates.* Int. J. Numer. Methods Eng., 1992.
- Perez et al. 2021 · Cojocaru et al. 2019 · Ahn et al. 2002 · Casavola et al.
  2016 · Farashi & Vafaee 2022 · Wang et al. 2020 · Birosz et al. 2022.
- Saad, Y. *Iterative Methods for Sparse Linear Systems*, §6.7 (PCG).

All literature constants are also cited in the app's **Sources** tab.
