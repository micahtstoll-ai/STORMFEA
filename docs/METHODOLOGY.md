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
at the per-material reference condition (reference nozzle, 60 mm/s, fan 100%, bed
60 °C) evaluated at the same layer height, so with no process block the legacy
layer-height path is reproduced bit-for-bit. Trends are locked (hotter nozzle ↑,
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
  bonding; no dedicated coupon data exists, so it is LOW confidence.
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
- Fractions are quantized into 9 bins of Voigt-blended constitutive matrices,
  yields, and densities (`twoRegion.ts` → `ElementMaterialField`), consumed
  per element by assembly, stress recovery, mass, and self-weight. The scalar
  `material` becomes the volume-weighted average and keeps feeding
  whole-part consumers (error estimate, analytic hole checks).
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
- **Known limits:** Voigt blending is an upper bound inside the one-element
  transition band; nozzle-temp/flow effects on bond quality are captured
  empirically via calibration coupons, not parametric inputs; the core yield
  criterion remains deviatoric (the dual criterion's bulk von Mises term) — a
  Deshpande–Fleck–Ashby pressure-dependent lattice criterion is a planned
  follow-up.

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
isotropic, which is why this is opt-in and evidence-gated.

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
buckling is requested (§7). The governing (lowest-SF) mode drives the overall
verdict.

### Fatigue (Goodman)

A fatigue-life estimate uses the **modified Goodman** relation (plus Basquin for
cycle count) with an FDM-specific endurance ratio `Se/UTS = 0.37` (Wang et al.
2020). The **load ratio** `R = σ_min/σ_max` is a user input (default `0`,
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

## 7. Optional analyses

- **Modal (`solver/modal.ts`).** Solves `K·φ = ω²·M·φ` by subspace iteration with
  shift-invert for the lowest natural frequencies; `f = √(ω²)/(2π)`. Mode shapes
  animate in the viewer.
- **Linear buckling (`solver/buckling.ts`).** Assembles the geometric stiffness
  `Kσ` from the pre-stress state and solves `(K + λ·Kσ)·φ = 0` by inverse power
  iteration for the smallest positive **Buckling Load Factor**.

---

## 8. Calibration

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

## 9. Validation

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
