# STORMFEA Methodology

The engineering theory behind STORMFEA, gathered from the solver source into one
narrative. This is the Markdown companion to the in-app document served at
`GET /api/methodology` (which is formatted for printing into an FTC engineering
notebook). For where each piece lives in code, see
[`ARCHITECTURE.md`](ARCHITECTURE.md); for the HTTP surface, see
[`API.md`](API.md).

Units throughout the solver are **mm / N / MPa (N/mm²) / tonne**. All arithmetic
uses Float64.

Two conventions this document keeps, because they are the difference between a
methodology and a brochure:

- **Every constant is sourced.** A number here is backed by a citation, by a
  named test that locks it, or by an explicit confidence tag. Where the repo
  tags a constant LOW confidence, that tag is carried into the prose verbatim —
  a LOW-confidence constant is a documented gap, not a bug to quietly round up.
- **Symbols, not line numbers.** Everything is referenced by function or
  constant name. Line numbers drift with every unrelated edit.

**Contents**

1. [The problem: FDM parts are not isotropic](#1-the-problem-fdm-parts-are-not-isotropic)
2. [Constitutive model — transversely isotropic](#2-constitutive-model--transversely-isotropic)
3. [Elements, and the mesh they live on](#3-elements-and-the-mesh-they-live-on)
4. [Assembly, boundary conditions, loads, and solve](#4-assembly-boundary-conditions-loads-and-solve)
5. [Stress recovery — SPR](#5-stress-recovery--spr)
6. [Failure assessment](#6-failure-assessment)
7. [Convergence & discretization error](#7-convergence--discretization-error)
8. [Optional analyses](#8-optional-analyses)
9. [Calibration](#9-calibration)
10. [Validation](#10-validation)
11. [References](#references)

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
STORMFEA models this anisotropy explicitly. Both anchors live in
`FDM_ORTHO_RATIOS` (`server/analysis.ts`) with their literature sources attached
in the source comment; see §2 and the [References](#references).

---

## 2. Constitutive model — transversely isotropic

FDM parts are modeled as **transversely isotropic** (orthotropic with one plane
of symmetry: the XY layer plane). The stiffness matrix **C** is built from five
independent elastic constants (`buildOrthotropicConstitutiveMatrix`, reached via
`buildAnyConstitutiveMatrix`, `server/solver/element.ts`):

| Constant | Meaning | Default ratio | Source |
|----------|---------|---------------|--------|
| `E_xy` | in-layer Young's modulus | — | material DB |
| `E_z` | through-layer modulus | `E_z/E_xy = 0.65` | Perez et al. 2021 (measured 0.48–0.85 across studies; 0.65 is the central estimate) |
| `G_xz` | out-of-plane shear modulus | `G_xz/G_xy = 0.40` | Ahn et al. 2002; Casavola et al. 2016 — limited direct data |
| `ν_xy`, `ν_xz` | Poisson ratios | `ν_xz = 0.30` | Casavola et al. 2016 — limited direct data |

`G_xy` is not independent: it is taken from the material when set explicitly
(the CLT path supplies it as `1/A66`) and otherwise from the isotropic relation
`E_xy / (2(1 + ν_xy))`.

**C** is assembled by inverting the 3×3 normal-stress compliance block directly
rather than by quoting an expanded closed form, with the minor Poisson ratio
fixed by reciprocity, `ν_zx = ν_xz · E_z / E_xy`. Thermodynamic stability is
checked before inversion — positive-definiteness of the compliance reduces to
`Δ = (1 − ν_xy) − 2 ν_xz ν_zx > 0`, and a material that violates it throws
rather than silently producing a non-physical **C**. Strain uses Voigt ordering
`[εxx, εyy, εzz, γxy, γyz, γxz]`, so **C** is 6×6. When the five constants
collapse to isotropy (`E_z = E_xy`, etc.), **C** reduces to the standard
isotropic matrix — verified to `< 1e-6` by the validation suite (group 3).

### 2.1 Print orientation — the weak-axis rotation

The weak (through-layer) axis is the FDM layer normal. **C** is built in the
material's local frame (weak along local Z) and then rotated so that local Z
aligns with the part's actual layer normal — an exact **Bond transform**
implemented as a 4th-order tensor rotation (`rotateC6` / `rotationAligningZTo`,
`server/solver/element.ts`), driven by the `weakAxis` field on the material.
Because STORMFEA's Voigt order carries engineering shear *strains*, the
stiffness matrix entries equal the tensor components directly (the factor of two
lives on the compliance side), so a plain index expansion and an `R⊗R⊗R⊗R`
rotation is exact rather than approximate.

When a **bed face is picked** the client sends that layer normal (`layerNormal`),
so flat, **upright**, and angled prints are all handled exactly — the failure
criterion (§6) is likewise evaluated in the rotated frame. Flat prints have
`weakAxis = +Z`, i.e. the identity, so the common case is bit-unchanged. When no
bed is picked the azimuth is unknown, and an upright print falls back to a
**conservative scalar swap** (both horizontal directions treated as weak). This
supersedes the previous scalar-swap-only approximation (issue #101) and is locked
by `bond-rotation.test.ts`.

### 2.2 Layer height, and process → bond strength

**Layer-height correction.** Yield in Z varies roughly linearly with layer
height (thicker layers bond worse): about −15% to +10% over the usable range,
around a 0.2 mm baseline. `layerHeightFactor` (`server/analysis.ts`) implements
`1.00 + (0.2 − h)·1.0` clamped to `[0.85, 1.10]`; the −1.0/mm slope comes from
the Farashi & Vafaee 2022 meta-analysis (131 samples) with the direction
corroborated by Szust & Adamski 2022 and Vidakis et al. 2022. Confidence:
**MEDIUM** — the direction is consistent across studies, the magnitude is not.
This is the default process input to bond strength when no full process block is
supplied, and it retains ownership of the layer-height slope even when the bond
model below is active.

**Process → bond strength (bead-penetration model, opt-in).** When the MATERIAL
tab's process settings (nozzle temperature, print speed, cooling fan, bed/ambient
temperature) are provided — G-code auto-fills them — `server/solver/bond.ts`
predicts the `S_zt`, `S_zs`, and `E_z` ratios from an anchored physics chain:
interface temperature history (lumped-capacitance road cooling) → neck growth
(Frenkel/Pokluda) → reptation healing (Φ^¾), plus a void/consolidation factor for
cold-deposition interbead porosity.

Multipliers are **relative** and normalized to exactly `1.0` at the per-material
reference condition (reference nozzle AND reference cooling fan — both
per-material — 60 mm/s, bed 60 °C) evaluated at the same layer height, so with no
process block the legacy layer-height path is reproduced bit-for-bit. That
normalization is invariant 6 of the Interlayer Failure & Bond Model in
`CLAUDE.md`. The reference **fan is per-material** (issue #184): PLA/PETG 100%,
TPU 50%, ASA 20%, ABS/PA12 0% — each material's normal print practice, so
"multiplier = 1.0" is a condition the material is actually printed at (the old
shared 100% anchored ABS/ASA/PA to a fan-off-avoiding setting that promotes the
very warping and interlayer cracking this model predicts). PLA and PETG keep the
100% reference, so their results are unchanged; only ABS/ASA/TPU/PA12 shift.
Surfaced as `materialModel.bond.coolingFanRefPct`.

The **trends** are locked (hotter nozzle ↑, more fan ↓, faster printing ↑ — a
faster pass returns to a hotter substrate) by `bond.test.ts`; the **constants**
are confidence **LOW** until fitted from a printer process sweep
(`POST /api/calibration/bond-sweep`, §9). Trend locks over value locks is
deliberate: a change that flips one of those directions needs new physical
evidence, not a refactor. `POST /api/bond-sensitivity` evaluates the same model
for the process dashboard and a nozzle×speed bond-quality surface without running
a solve.

### 2.3 Infill as a single homogenized material

The single-material path scales in-plane stiffness by ONE density law shared
across every toggle (issue #176):

```
knockdown(ρ) = wallCredit + (1 − wallCredit)·g_GA(ρ)
```

(`lumpedInPlaneStiffnessScale`, `server/solver/lattice.ts`) — a Voigt volume
average of solid perimeter walls and a Gibson-Ashby infill core
`g_GA(ρ) = pf·ρⁿ·(1 − c(1−ρ))`, i.e. the lumped limit of the two-region model's
`E_eff = Vf·E_solid + (1−Vf)·E_solid·g(ρ)`. The `wallCredit` is a geometry-free
`min(0.9, 0.10·wallCount)` perimeter-fraction proxy (**LOW confidence**; §2.4
supersedes it with the exact per-element wall fraction when geometry is
available).

Both single-material paths route through this one law — the **Classical Laminate
Theory** path (`server/solver/laminate.ts`, Jones 1999 §2/§4) passes it as the
A-matrix scale, the isotropic-base path as the `E_xy` scale — so a 20% part no
longer swings 2–5× between the CLT and two-region toggles. CLT itself treats each
printed layer as a stack of parallel beads, one unidirectional ply per raster
angle: per-ply reduced stiffness `Q̄` is rotated to the deposition angle,
accumulated into the extensional A-matrix, and `A⁻¹` gives the effective in-plane
`E*`, `ν*`, `G*`. Out-of-plane (Z) properties are **not** touched by CLT — they
stay with the bond model, because CLT is a plane-stress theory and has nothing to
say about the interlayer weld.

Pattern enters stiffness only through the Gibson-Ashby family exponent (pattern
*strength* multipliers stay a strength concept and are no longer folded into
stiffness). At 100% infill `g_GA(1) = 1` exactly, so `knockdown = 1` and every
path reproduces the solid — the anchor. Density knockdown is decoupled from the
strength multiplier: stiffness and strength are separate physical quantities, but
they now share the SAME lumped *form*.

The single-material **strength** multiplier (`materialStrengthMultiplier`,
`server/analysis.ts`, scaling `yieldXY`) is the strength-side mirror of the same
Voigt average (issue #340):

```
strengthKnockdown(ρ) = wallCredit + (1 − wallCredit)·s_GA(ρ)
```

(`lumpedStrengthScale`, `server/solver/lattice.ts`), where
`s_GA(ρ) = min(1, patternMul·ρ^m)` is the Gibson & Ashby (1997) cellular-solid
strength law (`latticeStrengthFraction`) the two-region core (§2.4) already used.
This replaced a disowned `0.30 + 0.70ρ` linear curve (`infillStrengthCurve`) that
had no checkable citation and disagreed with the two-region default — so a part's
infill-strength number no longer depends on which toggle produced it. For
structural patterns `s_GA(1) = 1`, so `strengthKnockdown(1) = 1` exactly (the same
anchor); sub-unity patterns (lines/concentric/lightning, `patternMul < 1`) anchor
below solid, matching the two-region core. The pattern multiplier credits only the
infill lattice, never the solid walls, and — unlike the old curve — a
`patternMul > 1` pattern can no longer exceed solid strength at 100% infill. The
client's live settings preview (`client/index.html`) mirrors this law
identically, so the estimate shown before a solve uses the same infill-strength
physics the solver does. Orientation stays out of the solved multiplier (audit
A4); it survives only in the scalar what-if estimator (`effectiveStrengthMultiplier`).

### 2.4 The two-region model (walls vs infill) — the DEFAULT path

`analysis.twoRegion` **defaults to TRUE** as of issue #297 — *in the library*.
Note this default does NOT currently reach HTTP callers: the analyse handler
builds its settings with `twoRegion: body.analysis?.twoRegion === true`
(`server/index.ts`), turning an absent flag into an explicit `false`, so
`runAnalysis`'s `?? true` never fires over the wire. Through `POST /api/analyse`
the model is opt-in until that is fixed; see the `twoRegion` note in
`docs/API.md`. Everything below describes the model itself and is unaffected by
which side of that discrepancy invoked it. Infill is one of the
defining variables of an FDM part, and the single-material model above represents
it as a scalar knockdown with no spatial structure at all — a user could not tell
a 2-wall part from a 5-wall one except as a different number. Passing
`twoRegion: false` explicitly still selects the legacy single-material path,
which remains **bit-identical** to its pre-#297 self (invariant 1, asserted to
1e-12 on full solves in `solver_validation.ts` group 25). An *absent* flag is no
longer that path.

**Wall band.** `wallCount × extrusionWidthMm` (line width auto-imported from
G-code, default 0.45 mm, clamped to [0.1, 2.0] mm; the MATERIAL tab shows the
resulting band thickness live as either input changes).

**Distance field.** Every element node's exact distance to the tet-mesh boundary
is computed **point-to-triangle** (`pointTriangleDistance` /
`computeNodeSurfaceDistances`, `server/solver/distance.ts`, Ericson §5.1.5). It
must be point-to-triangle and not nearest-node: boundary triangles are typically
3–6 mm across while the band being resolved is ~1.35 mm, so the chord-vs-plane
error of a nearest-node distance would exceed the band outright. Boundary nodes
sit at distance exactly 0. For C3D10 the **midside** nodes are resolved too
(issue #180), because the wall-fraction level set subdivides each quadratic tet
into 8 corner/midside sub-tets and needs every element node.

The queries run over a triangle-bucketed spatial grid, and that grid may only ever
RAISE its cell size above `dMax` (`chooseGridCellSize`, issue #298): coarsening
merely widens the candidate set a query examines, while refining below `dMax`
would truncate the 27-cell one-ring search and make the field *wrong* rather than
slow. `distance-grid-budget.test.ts` asserts the gridded output equals a no-grid
brute-force reference exactly at every cell size.

**Volume fraction, not a label.** Each element gets the exact **volume fraction**
of itself inside the band via a marching-tetrahedra level-set cut on
`φ = nodeDist − tWall` (`tetFractionBelowIso` / `computeWallFractions`,
`server/solver/wallfrac.ts`). Fractions rather than hard labels because volume
elements (2.9–6.3 mm edges) are 2–5× thicker than a typical 1.35 mm band. On
C3D4 this is the exact fraction of the linear interpolant through the four corner
distances; on C3D10 the element is subdivided into 8 corner/midside sub-tets so
the quadratic band field is resolved *between* corners — a band that enters an
element without reaching a corner (fillet roots, boss bases) is otherwise
reported as fraction 0. The formulas are written per sign-case so every
denominator is a strictly-negative-minus-non-negative difference: **no NaN by
construction** (invariant 2), and no tie-breaking jitter.

**Floors and ceilings (top/bottom solid skins).** Slicers lay solid horizontal
skins on the top and bottom of a part independently of the vertical perimeters.
When modeled, `server/twoRegion.ts` unions independent top/bottom skin bands
(split at the build-axis mid-plane, oriented by the build axis) into the same
shell penetration field, so a floor/ceiling element is dense shell just like a
perimeter wall. A boundary face counts as a solid skin when its normal is within
`DEFAULT_SKIN_CONE_DEG = 65°` of the build axis. The legacy value was a hard 45°,
which sent shallow domes, moderate overhangs and undersides — surfaces slicers
print as stair-stepped solid skins — into the vertical-perimeter band with wall
thickness (issue #181). The skin band's thickness is `layers × layerHeight`,
generally different from the perimeter band's `wallCount × lineWidth`, which is
why the two bands are independent rather than one number.

**Shell material.** Solid-material properties at `strengthMul = 1.0` — exactly
the convention the coupon calibration back-calculates, since coupons are printed
flat and pulled in-plane, so calibrated solid properties flow to the shell
unchanged. No pattern multiplier, no infill knockdown, solid density.

**Core material — Gibson-Ashby homogenization.** The core is the SOLID material
times per-axis scale factors on the solid's natural-frame constants
(`latticeStiffnessScales` / `latticeStrengthFractions`,
`server/solver/lattice.ts`, applied in `buildCoreMaterial`):

- stiffness `g_a(ρ) = pf·ρ^{n_a}·(1 − c_a(1−ρ))` per axis;
- strength, per axis and per issue #183,
  `s_a(ρ) = ρ^{m_a}·(1 + (patternMul−1)(1 − ρ^K))` with `K = STRENGTH_TAPER_K = 10`
  when `patternMul > 1`, and the plain `patternMul·ρ^{m_a}` otherwise, clamped
  into `[LATTICE_STRENGTH_FLOOR, 1]`.

The taper replaced an older hard `min(1, patternMul·ρ^m)` clip, which pinned
`s = 1` over a whole range of ρ and left a kink where it engaged. `K = 10`
concentrates the fade into the top ~10–20% of density, so low and typical infill
is bit-unchanged, `s(1)` is still exactly `min(1, patternMul)`, and `s` rises
monotonically to that value from below with no interior overshoot.

| Family | Patterns | n in-plane (c) | n through-layer (c) | n G_xz (c) | n G_xy | Strength m (xy / z / zs) |
|---|---|---|---|---|---|---|
| TPMS-like 3-D | gyroid, cubic, adaptive | 1.75 (0.12) | 2.1 (0.18) | 2.3 (0.22) | derived | 1.25 / 1.5 / 1.6 (stretch-dominated) |
| extruded walls | grid, lines, honeycomb, trihexagon, concentric | 2.0 (0.10) | 1.0 (rule of mixtures) | 1.5 (0.10) | 3.0 (honeycomb bending) | 1.5 / 1.0 / 1.5 (bending-dominated) |
| sparse | lightning | 2.0, prefactor 0.3 | 2.0 | 2.0 | derived | 1.5 / 1.5 / 1.5 |

Every exponent in that table is an engineering estimate inside the Gibson & Ashby
(1997) ranges. **Confidence LOW**, per family, regression-locked by
`core-lattice.test.ts` and overridable by calibration — and an override routes
both stiffness and strength to a single scalar law, because one fitted exponent
cannot say which axis it belongs to.

Extruded-wall infill is continuous along the build axis, so BOTH its
through-layer stiffness (n = 1, rule of mixtures) and its through-layer strength
(m = 1) are the mildest laws in the family, and the core's anisotropy **inverts**
at low density: `E_z > E_xy` AND `yieldZ > yieldXY` in the core. The per-axis
strength exponents mirror the stiffness ordering per family precisely so that
`sign(E_z − E_xy)` agrees with `sign(yieldZ − yieldXY)` — previously a single
scalar strength law kept the solid's 0.58 ratio, claiming a Z-stiffer-yet-Z-weaker
core at once (issue #177). Because `ν_zx = ν_xz·E_z/E_xy` would then breach the
thermodynamic stability bound, `ν_xz` is scaled by `min(1, g_XY/g_Z, g_Z/g_XY)` —
symmetric, so the bound holds in the natural frame and after the upright scalar
swap alike.

**Anchors.** Every `g_a(1) = 1` and `s_a(1) = min(1, patternMul)` **exactly**, so
100% infill reproduces the solid bit-for-bit and the `materialsEqualFor` check
collapses the whole model to the uniform path (invariant 8). The ρ = 1 material
is never re-derived through a parallel formula chain — the collapse depends on
the scale factors being exactly 1.0, not approximately. Scales are floored at
`1e-3 × solid` so 0% infill still builds a positive-definite **C** rather than
crashing. Orientation never enters core **stiffness** (only the weakAxis
rotation / scalar swap does, applied AFTER the natural-frame scaling); it still
scales strength. Both regions keep the full orientation anisotropy — layer bonds
exist in walls and infill alike.

**Per-bin constitutive matrices are a true Voigt matrix blend.** Fractions are
quantized into bins, and each bin's matrix is

```
C_b = f·C_shell + (1 − f)·C_core
```

of the two **rotated** endpoint matrices (`buildTwoRegionField` bin loop,
`server/twoRegion.ts`). Blending after the weak-axis rotation is *exact* because
the Bond rotation is linear in **C**'s entries, so rotating a blend and blending
two rotations give the same matrix — valid only while shell and core share the
same `weakAxis`, which they do by construction. Never blend engineering constants
instead: that equals the matrix blend only when shell and core share every
modulus ratio, which the anisotropic core laws above deliberately break
(invariant 3).

The bin **spacing adapts to the shell:core contrast** (issue #178). Low and
medium contrast keeps 9 LINEARLY spaced bins, bit-for-bit as before; above a ~9:1
contrast the fractions are LOG-spaced and the count grows (capped at 33) so no
adjacent-bin stiffness step exceeds ~2×. Without this, at the ~10³:1 contrast of
a near-zero-infill core a 0.01 change in wall fraction could flip an element's
stiffness ~100× (0.06 → bin 0 ≈ 1× vs 0.07 → bin 1 ≈ 126×). Bin ENDPOINTS stay
`f = 0` and `f = 1` exactly, so pure-phase elements map to the endpoint matrices
bit-for-bit and the field's *shape* is unchanged.

**The scalar average carries the scalar consumers.** `SolverInput.material`
becomes the volume-weighted blend when the field is active, and whole-part
consumers (the ZZ error estimate's energy norm, the analytic hole checks) read
it while per-element consumers read the field. The two must not be conflated
(invariant 6). Note the scalar blend mixes ENGINEERING CONSTANTS — a first-order
approximation of the Voigt **C** average once the ratios diverge — which is
acceptable precisely because its consumers are scalar and every degenerate path
returns an exact endpoint material.

**Where the split is visible.** Only on a **section cut**. A part's boundary is
wall by construction — every boundary node sits at distance 0, inside the band —
so the classification on the DISPLAY mesh is identically 1.0 on every part and
carries no information. This is measured, not argued: min 1.0 / max 1.0 on the
24×12×6 fixture against a 50.6% shell volume fraction. It is therefore published
on `volumeField.nodeShellFractionB64` and painted on the cut face, never as a
display-mesh vertex field (invariant 9, locked by `two-region-default.test.ts`).

**Wall-to-wall (bead-to-bead) bond (opt-in).** With `twoRegion` and
`wallCount ≥ 2`, `buildWallBondField` marks elements on the internal loop-to-loop
boundary and their local wall-normal. Stress recovery then applies a **second,
independent interface check** in that per-element wall-normal frame, distinct
from the global-Z interlayer check, governing via `min()` alongside the
bulk/interlayer SFs. It uses the inter-pass revisit time for bonding; no dedicated
coupon data exists, so it is **LOW confidence**. Two geometry corrections make it
faithful:

- **Loop-length basis (#182).** The revisit time is
  `outerLoopPerimeter / printSpeed`. `estimateWallLoopPerimeterMm` groups the
  vertical boundary faces into connected loops and keeps only the **outer
  contour(s)** by the sign of each loop's projected cross-section (outward
  normals ⇒ outer loops enclose positive area, hole bores negative), so internal
  bolt-hole bores no longer inflate the loop length and understate the bond. A
  solid part is bit-identical to the legacy all-vertical-area sum; surfaced as
  `materialModel.wallBond.loopLengthBasis`.
- **Thermal depth = line width (#185).** The road-cooling constant
  `τc = π·ρ·cp·d/(8·h)` uses the road's characteristic thermal depth `d`. For a
  vertical weld that is the bead **line width** (adjacent beads cool laterally
  through their sides), which the same π/8 elliptical-road prefactor covers with
  the width/height roles swapped. It is passed as a named thermal-depth argument
  with a width-appropriate clamp (`WALL_THERMAL_DEPTH_CLAMP_MM = [0.1, 2.0] mm`),
  not the layer-height clamp, so a >1.0 mm large-nozzle bead is no longer
  silently pinned to 1.0 mm. Results are unchanged for in-clamp (≤1.0 mm) widths.

**Core yield criterion (Deshpande–Fleck–Ashby, issue #171).** The homogenized
infill core is a cellular solid: it yields under HYDROSTATIC stress (the lattice
compacts), unlike the deviatoric von Mises the solid obeys. Core bulk yield
therefore uses the isotropic-foam DFA criterion

```
σ̂² = (σ_vm² + α²·σ_m²) / (1 + (α/3)²)          σ_m = (σxx+σyy+σzz)/3
```

with pressure sensitivity `α(ρ) = DFA_ALPHA0·(1 − ρ)^DFA_ALPHA_EXP`,
`DFA_ALPHA0 = 2.08`, `DFA_ALPHA_EXP = 1.0`. The 2.08 is Deshpande & Fleck's
(2000) measured value for aluminium foams, corresponding via their
self-consistent relation `α² = (9/2)(1 − 2ν_p)/(1 + ν_p)` to a plastic Poisson
ratio ≈ 0, the low-density foam limit. A low-ρ FDM lattice is the same
cellular-solid class. The `(1 + (α/3)²)` normalization keeps the in-plane
uniaxial yield at `yieldXY` for every α, so DFA never disturbs the coupon
anchor — it only ADDS hydrostatic yield. `α(1) = 0` EXACTLY, so at ρ = 1, in
every shell/wall bin, and on the single-material path the criterion collapses to
von Mises bit-for-bit; no override on the exponent is exposed, because a nonzero
exponent is what makes that collapse exact. Applied per element via the
core-fraction-weighted per-bin α, `(1 − shellFrac)·α(ρ)`, inside
`recoverElementStress`; a strength-side change only, stiffness untouched. The α₀
magnitude and the linear knockdown are literature-form estimates, **confidence
LOW**, regression-locked by `dfa-core-yield.test.ts`.

**Reported uncertainty from the exponents (issue #173).** Because the strength
exponents are the least-trusted numbers in the model, `latticeStrengthExpExcursion`
re-evaluates the in-plane strength law at the endpoints of a plausible exponent
range (`strengthExpXYRange`: 1.0–1.5 for TPMS, 1.2–1.8 for the other families,
from Gibson & Ashby's m ≈ 1.5 bending-dominated / 1.2–1.3 stretch-dominated
spread) and widens the reported SF band for core-governed parts. It never enters
the constitutive matrix. At ρ = 1 the excursion is exactly `{1, 1}`, so a solid
part's band is reproduced bit-for-bit, and a calibration exponent override
collapses it to a point.

**When the model degrades itself.** Requesting the two-region model does not
guarantee getting it. It falls back to the uniform path, reporting
`materialModel.degraded` with a reason, when:

- the mesh is the box fallback (no real geometry to classify);
- no boundary surface is available;
- the mesh exceeds `TWO_REGION_MAX_ELEMENTS` (400,000);
- **the emitted mesh resolves fewer than `MIN_ELEMENTS_THROUGH_THICKNESS` = 4
  elements across the thinnest section.**

That last gate is the interesting one. The *classification* is not the fragile
part — `tetFractionBelowIso` integrates the level set inside the element, so the
shell volume fraction lands within 3.2% even at one element per 4.4 band widths.
What needs resolution is the STRUCTURAL EFFECT the model exists to capture.
Measured on a 60×30×6 mm sandwich cantilever, as the share of the converged 26.1%
sandwich stiffening each resolution recovers:

| elements through thickness | stiffening recovered | tip deflection vs converged |
|---|---|---|
| 1 | 4% | 29.0% off |
| 2 | 57% | 13.1% off |
| 3 | 83% | 4.75% off |
| 4 | 100% | 0.84% off |

At one element through thickness the model returns essentially the homogenized
answer *while reporting itself active*, which is worse than not offering it.
Degrading is the honest outcome: same answer, accurate label, and a reason that
names the fix. The gate reads `meshResolution` — the mesh that came back, not the
sizing request (§3.2) — and an explicit opt-in does **not** override it.
Confidence on the floor of 4: **MEDIUM** (one geometry, one shell/core contrast);
it is a floor rather than a target, so erring high is the safe direction.

**Anchoring and disclosure.** Endpoints agree with the legacy model by
construction (100% infill → solid; thin part → all walls). In between, the
summary reports both the implied average multiplier and the legacy global one —
deliberately **not** renormalized, because the divergence (the legacy model
under-credits wall-dominated thin sections) is what the model corrects. The
results panel displays that divergence directly, highlighted past 10% (invariant
5).

**Known limits.** Voigt blending is an upper bound inside the one-element
transition band; nozzle-temperature and flow effects on bond quality are captured
empirically via calibration coupons rather than as parametric inputs; and the DFA
core criterion is isotropic — an anisotropic honeycomb-foam extension, and a
fitted α(ρ), remain follow-ups.

---

## 3. Elements, and the mesh they live on

### 3.1 The two tetrahedral elements

Both live in `server/solver/element.ts`:

- **C3D10** — 10-node quadratic tet (default). Second-order shape functions
  capture bending and stress concentrations without shear locking. Integrated at
  the standard **4-point** Gauss rule (`C3D10_GAUSS`), which is exact for the
  affine (straight-sided) stiffness integrand.
- **C3D4** — 4-node linear tet. Constant strain → constant stress per element; no
  numerical integration needed (single centroid evaluation). Faster, but
  underpredicts bending stress by ~55% due to shear locking (validation group 2
  measures the cantilever tip deflection at ≈0.43 of Euler–Bernoulli at
  L/H = 20), so it is offered only as a speed option and every C3D4 report
  carries that banner.

For node `i` the B-matrix maps nodal displacements to strain; element stiffness
is **kₑ = ∫ Bᵀ C B dV**. C3D10 midnode ordering follows the Gmsh convention
(corners 0–3; edge midpoints 4–9); TetGen's permutation is pinned by a regression
test, and a guard rejects a mesher whose midside ordering fails the self-check —
twice, after which the analysis continues on LINEAR elements with the geometry
intact and says so (`meshOrderDowngrade`, issues #66 / #265).

A **higher-order opt-in rule** exists for genuinely curved C3D10 elements
(`C3D10_GAUSS_HIGH_ORDER`, issue #163): 64 points from a 4×4×4 Gauss–Legendre
rule mapped onto the reference tet by the Duffy collapsed-hex transform. Each 1-D
4-point rule is degree-7 exact, so it reproduces the affine result to round-off
(the regression anchor) while integrating curved elements with far smaller error.
It is **not** wired into the default assembly path — it is a strictly opt-in
argument, so the validated affine results stay bit-identical.

### 3.2 What a mesh tier promises (issue #295)

STORMFEA has two meshers — STL → TetGen and STEP → Gmsh — and they used to size
themselves on incompatible philosophies (TetGen scale-relative to an element
count, Gmsh absolute in millimetres). A tier now makes **one promise, in two
parts**, and both meshers make it against the same constants
(`server/meshSizing.ts`):

1. **A target element count** — `MESH_TARGET_ELEMENTS`: coarse 4,000 / standard
   12,000 / fine 40,000.
2. **A floor of `MIN_ELEMENTS_THROUGH_THICKNESS` = 4 elements** across the part's
   smallest bounding-box dimension.

Each path resolves that promise into its own mesher's units — TetGen's `-a` takes
a VOLUME, Gmsh's `clmax` takes a LENGTH — through one shared relation
(`regularTetVolumeForEdge`, the same `6√2` that the adaptive path's
`sizeFieldToVolFile` uses), so the two describe the same geometry. Gmsh's
absolute millimetre table is kept as an **upper bound**, not deleted: `clCurv` is
what refines hole bores and a hard `clMax` is what resolves small fillets on a
large part, so `gmshSizingForTier` takes the finest of the three bounds and can
only refine relative to the historical value.

The floor is necessary because **a count is a budget for the whole part**. A
60×30×6 mm plate at the standard tier gets 0.9 mm³ per element, a 1.97 mm regular
tet edge, and **3.0 elements through the 6 mm section** — on the geometry class
this tool exists to analyse, at the default tier. The value 4 is not textbook
convention; it is the sandwich-stiffening measurement tabulated in §2.4.

The floor can demand more elements than the tier budgets. `MESH_MAX_BUDGET_OVERSHOOT`
(4×) pulls the sizing back and **reports that it did**; it exists to stop a
pathological geometry building a mesh the solver cannot finish, not to enforce
the target, which is why the allowance is deliberately loose. When the clamp
fires, the section is left below the floor — which is exactly why it is reported
rather than silent.

Finally, `summary.meshResolution` reports achieved-vs-target from **the mesh that
came back**, not from the flags that were sent. Both meshers treat a size cap as
a request: TetGen's switch-set fallback chain relaxes `-a` and can end at `-pQ`
with no volume constraint at all, and Gmsh's `clmax` yields where a curvature or
boundary constraint disagrees. A readout built from the flags would report the
mesh that is not in doubt. The prediction is still used for the clamp, and there
it has a known error with a known SIGN — a real mesh is not regular tets and
typically emits somewhat MORE elements than the relation predicts, hence elements
SMALLER than predicted, so a floor derived this way delivers at least the layers
it asks for.

### 3.3 The mesh-quality gate

Slivers do not merely look bad; they wreck the answer. `server/solver/meshQuality.ts`
classifies every element on **dimensionless** metrics, so the same physical
element is classified identically at any model scale (issue #165):

- `normalizedJacobian` — mean-ratio quality `√2·(6V) / l_rms³`, exactly 1.0 for a
  regular tet, → 0 for a sliver, < 0 for an inverted element;
- `aspectRatio` — longest edge / shortest altitude;
- `min/maxDihedralDeg` over the full [0°, 180°] range (regular tet ≈ 70.5°);
- for C3D10, the midside offset `‖mid − edgeMidpoint‖ / edgeLen`.

`|nj| < HARD_SLIVER_NJ = 0.02` is a hard block: at that quality the element's
volume is ~2% of a regular tet on the same edge scale, so `B ∝ 1/(6V)` is
inflated ~50× and element-stiffness conditioning degrades by 10³–10⁴×.
`aspectRatio > HARD_AR = 100` and a midside offset ≥ `MIDSIDE_FOLD = 0.5` (the
node pushed past the corner, tangling the mapping) block likewise; `POOR_NJ = 0.10`,
`POOR_AR = 20`, dihedrals outside [5°, 175°] and midside offset > 0.25 are
reported as "poor" without blocking. `runLinearStaticWithK` refuses the solve on
a hard violation rather than returning a number nobody should read.

Two deliberate non-criteria. The raw signed `6V` is retained for reporting only —
thresholds never key on its SIGN, because the assemblers auto-orient via
`Math.abs`, so a **mirror-oriented** but well-shaped mesh must pass (issue #166).
That is not a nicety; §3.4 depends on it.

### 3.4 Symmetry-preserving meshing (issue #296)

**The problem.** An unstructured tet mesh of a mirror-symmetric part is not
itself mirror-symmetric — the tet subdivision is chiral. The *geometry* has a
symmetry the *discretization* does not, and the recovered stress field inherits
the discretization's asymmetry. Measured on a symmetric cantilever fixture: only
128 of 384 element centroids had a mirror partner at all, and the SPR nodal
field's mirror asymmetry ran **1.83% / 0.88% / 0.52% rms** across 384 / 3,072 /
10,368 elements — while the DISPLACEMENT field stayed symmetric to 0.001%.

That gap is the whole diagnosis. Displacement is the primal variable and is
smoothed by the solve; stress is a derivative of it recovered per patch, and a
chiral patch structure biases the recovery differently on the two sides. It is a
pure discretization artifact: a user looking at a symmetric part with an
asymmetric heatmap cannot tell whether they are seeing physics or meshing.

**The construction: detect → clip → mesh the half → reflect → weld.**

1. **Detect** (`detectSymmetryPlanes`, `server/solver/symmetry.ts`). A mirror
   plane maps the body to itself, hence maps the inertia tensor to itself, hence
   its normal is an eigenvector of that tensor — so the three principal axes of
   the area-weighted covariance of the boundary surface are candidates, obtained
   by cyclic Jacobi. The three **coordinate** axes are tested as well, for two
   reasons: a part with near-equal eigenvalues (a cube, a square-section bar) has
   numerically arbitrary eigenvectors, and CAD parts are usually modelled
   axis-aligned, so the coordinate axes are the likely answer precisely when the
   principal axes are least trustworthy. Candidates within
   `SYMMETRY_DEDUP_ANGLE_DEG = 1°` are collapsed, coordinate axes first so the
   exact representative wins — without this the detector reports six planes for a
   box, because the boundary-centroid cloud is genuinely chiral and rotates the
   principal axes by ~1e-4 rad.

   Verification deliberately does **not** match mesh entities. The obvious test —
   mirror the nodes and look for a node at the image position — is exactly wrong
   here, because the input is a symmetric part whose mesh is asymmetric; that is
   the condition being detected, so an entity-correspondence test would reject
   every real case. Instead each mirrored sample point is measured against the
   surface as a *geometric object*: the distance from the image point to the
   nearest boundary triangle, via the same `pointTriangleDistance` the two-region
   distance field uses. Acceptance is `SYMMETRY_DEFAULT_TOL_REL = 1e-3` of the
   bounding-box diagonal — ~0.1 mm on a 100 mm part, tight enough to reject a
   real one-sided feature, loose enough to absorb the faceting error of an STL
   approximation of a curved surface. Both that tolerance and the
   `SYMMETRY_MAX_SAMPLES = 1500` sweep cap are **LOW confidence** as specific
   numbers: chosen by argument from STL chord error and runtime, not measured
   against a corpus of real parts.

2. **Clip** (`clipSurfaceAtPlane`, `server/solver/clip.ts`). The fundamental
   domain must be handed to the mesher as a *closed* surface, so the cut has to
   be capped. The cap is not a triangle fan: cutting a plate through its bore
   leaves the outer loop PLUS the bore cross-section as an inner loop, so the cap
   is a constrained triangulation of a **polygon with holes**. A fan over the
   outer loop would tile straight across the bore and hand the mesher a solid
   where the part has a hole — silently wrong, not a crash. Watertightness is a
   property of the construction (one snap pass on vertices before anything is
   classified; split points cached per EDGE so the two triangles sharing it get
   the same vertex index with bit-identical coordinates; sign tests only ever on
   the snapped distances) and is then *checked* by `checkSurfaceClosure` before
   any mesher is invoked.

3. **Mesh the half** at the SAME absolute volume cap as the whole part, so the
   mirrored result lands at the tier's element budget rather than double it.

4. **Reflect and weld** (`mirrorTetMesh`, `server/solver/mirrorMesh.ts`). Nodes
   within tolerance of the plane are **snapped onto it before mirroring**, which
   makes coincidence exact rather than approximate: the mirror image of a snapped
   node is bit-identical to the node itself, so it maps back to the same index
   and no seam node is duplicated. Approximate matching would leave pairs of
   near-coincident nodes and the sliver tets connecting them — the same class of
   defect as the client's vertex-welding bug. The tolerance is
   `surfaceSnapTolerance` (`SURFACE_SNAP_TOL_REL = 1e-6` of the diagonal), the
   *same* definition the clip uses, which is the point: the clip decides what is
   on the plane and the weld decides which of those are the same point
   afterwards. If the two ever differed the seam would not close.

**Guarantees.** Element count exactly doubles; node count grows by the number of
off-plane nodes. Every element's node list is copied verbatim through the index
map, so every edge relationship survives by construction. The input is *checked*
to be a fundamental domain — material on both sides of the plane raises
`NotAFundamentalDomainError`, because an overlapping mesh is not a mesh-quality
problem the gate would catch, it is two copies of the same material in one region
solving to a part twice as stiff as it should be.

**Costs, and they are real.**

- A reflection reverses orientation, so **every mirrored tet has a negative
  Jacobian**. That is fine and deliberate: the assemblers auto-orient via
  `Math.abs(sixV)` / `Math.abs(detJ)` and the quality gate keys on
  sign-invariant shape metrics (§3.3). Permuting corners to restore a positive
  sign would also require permuting the six C3D10 midside nodes to match
  `C3D10_EDGE_PAIRS` — exactly the class of index surgery that produced the
  #66 / #265 midnode defects. Not fixing the sign is the safer engineering
  choice, and it is why §3.3's rule about the sign exists.
- **An extra mesh.** Detection needs a mesh to run on, so the part is meshed once
  to detect and once more for the half.
- **It is OPT-IN** (`analysis.symmetryMesh`, default false) and currently reached
  only on the STL/TetGen path. It degrades to the ordinary mesh — never breaks a
  solve — when no plane is detected, when the clip does not close, when the cap
  produces degenerate triangles, or when the half fails to mesh; `summary.symmetryMesh`
  reports `applied` and, when false, the reason.
- **It does not by itself guarantee a symmetric picture.** The mesh is only one
  source of asymmetry; the load is another (§4.3).

**Acceptance measurement** (`mirror-symmetry-acceptance.test.ts`). Two meshes of
the same bar with the same node grid, node count and element count, differing
only in chirality: the chiral one pairs 33.33% of its element centroids and
returns an SPR nodal field with 3.909% rms mirror asymmetry; the mirrored one
pairs 100% and returns **0.0000%** — exactly zero to float32 print precision,
because the mesh, the constraint set and the load are each symmetric, so the
whole discrete problem is. Principal stresses are checked as well, since von
Mises alone could hide a sign-flipped asymmetry.

---

## 4. Assembly, boundary conditions, loads, and solve

### 4.1 Global stiffness

Element matrices are assembled into a global **K** stored in **CSR** (Compressed
Sparse Row) via a two-pass build — sparsity pattern first, then values
(`server/solver/assembly.ts`). Invariants are asserted rather than assumed:
sorted column indices, a tracked diagonal, and symmetry of the assembled result.
A worker-thread path (`assembly-worker.ts`) parallelizes assembly by scattering
each chunk into a full-nnz CSR slab and summing; it is proven equivalent to the
serial path to 1e-12 by `test-parallel-assembly.ts`, including the mixed-bin case
that exercises a real multi-bin two-region field (invariant 7).

### 4.2 Boundary conditions, and the reactions that come out of them

Dirichlet constraints (bolted holes fixed, rollers, prescribed displacements) are
applied by `applyDirichletBC` (`server/solver/boundary.ts`), which offers three
schemes. **The static solve path uses ELIMINATION** (issue #154), not the penalty
method:

- move the known column to the RHS, `f_j −= K[j][i]·g_i` for every unconstrained
  row `j` (using symmetry);
- zero row `i` and column `i`, preserving symmetry, and set `K[i][i]` to the
  **pristine** diagonal `d_i` with `f_i = d_i·g_i`.

The constrained DOF is then fully decoupled and `u_i = g_i` **exactly** (to CG
tolerance), and the remaining unconstrained block is the original SPD principal
submatrix — so no conditioning damage is introduced. The two penalty schemes are
retained for the callers that genuinely need a penalty-inflated **K** (the
buckling path) and for the measurement harness: `global-penalty` adds
`K_penalty = kMax·1e8` from the single largest diagonal in the whole matrix (the
legacy behaviour), `row-penalty` uses `|K_ii|·1e8` per constrained DOF, bounding
the local inflation to a fixed factor regardless of the global stiffness spread.
A penalty scheme satisfies the constraint only to a relative error
`K_ii/K_penalty ≈ 1e-8`, which is the reason the static path left it.

Whatever the scheme, the function snapshots the **pristine rows** of every
constrained-node DOF before touching **K**, so the true support reaction

```
R_i = (K₀·u)_i − f_ext,i
```

is recoverable exactly and scheme-independently, without retaining the whole
pre-BC matrix (`computeBoltReactions`, `server/solver/pipeline.ts`).

### 4.3 Loads

`server/solver/load.ts` builds the right-hand side **f** in Newtons from point
forces, surface pressure, and body forces (self-weight, acceleration/impact in
multiples of *g*).

**Surface pressure** is applied as a consistent tributary-area traction over a
selectable region (`selectPressureRegion`): the extreme face toward a direction
(`face`), every triangle facing that direction (`facing`), or the whole exterior
(`all`, i.e. hydrostatic). A **normal-to-surface** option
(`assembleSurfaceTractionNormal`) follows each triangle's own outward normal for
curved or non-planar faces; a negative magnitude is outward (suction). The
box-mesh fallback carries surface connectivity (`extractSurfaceFaces`), so
pressure loads work there too.

On C3D10 the consistent nodal forces of a uniform traction over a quadratic
triangle land entirely on the three **midside** nodes (weights 1/3 each, corners
zero), and that is what every patch assembler here does — it is the exact
consistent load vector, not an approximation.

**The default point-load distribution is `contact_patch`, not `uniform`**
(`DEFAULT_LOAD_DISTRIBUTION`, `server/analysis.ts`). An absent `loadDistribution`
means: apply the load over a tapered disc centred on `ForceSpec.position`, on the
surface that point lies on. The previous behaviour remains reachable exactly via
`loadDistribution: 'uniform'` and is locked by `load-distribution-default.test.ts`.

Three measured defects in the old default drove the change
(`docs/load-distribution-default.md`):

1. **It discarded the application point.** Four positions on the Ø5-bore tube —
   including one on the opposite side of the part and one inside the bore —
   produced results identical to nine decimal places.
2. **The patch had a hard rim**, so the model contained a load singularity whose
   peak stress does not converge: across a 5.3× element range the safety factor
   swung 26.6% non-monotonically.
3. **The 0.5 mm band was absolute**, so the same part at two scales got a
   different load idealization.

`assembleContactPatchLoad` fixes all three. The taper is a **raised cosine**,
`w(s) = ½(1 + cos πs)` on `s = d/radius`, chosen for **zero slope at both ends**:
a linear ramp still leaves a kink in the traction where the patch stops, and it
is the traction DISCONTINUITY at a rim that is singular, not the patch's
existence.

**What surface the patch acts on (issue #305).** The patch grows from the
triangle nearest `position` by **edge adjacency**, admitting neighbours while
they are inside the radius. `direction` selects no face at all; it only has to be
non-zero. This is a correction, and the bug it fixed is instructive: the mode
originally selected windward triangles (`n·d > 0`), the rule every other mode
follows. But **a contact pushes** — at the surface it presses on, the force
points INTO the material, so `n·d < 0` there. The windward test therefore
excluded the surface under the user's arrow on every compressive load, left only
the far side of the part (outside the radius), and the "patch fell between the
triangles" fallback put the ENTIRE force onto ONE triangle of the opposite face,
chosen by index among tied candidates. A 120 N push placed on the top of a bar
was applied as a point load on its bottom.

Adjacency is also what stops the patch reaching THROUGH a thin part: a 3-D ball
centred on a thin plate's top face contains most of its bottom face, but the far
face is not edge-connected to the near one except around the rim, so it is
excluded exactly when the rim is further away than the radius and included
exactly when the contact really does wrap an edge. A same-side normal test would
need a tolerance, and no tolerance is right for both a thin plate (far face a
millimetre away) and a tight bore (near surface curving away from its own tangent
plane by `r²/2R` across the patch). Adjacency needs none, and the connected
component of a disc is independent of traversal order — so nothing depends on
triangle numbering, which is the property a mirror-symmetric part needs.

Two smaller guards: the under-resolved fallback loads every **tied** nearest
triangle rather than the first found, and `centreSnapMm` is a true
point-to-triangle distance rather than point-to-centroid (the old measure aliased
element size — a point sitting exactly on a coarse face reported itself 2.24 mm
off the surface against a 2.75 mm radius, and `analysis.ts` warns the user when
that number exceeds the radius). Same aliasing §2.4's distance field exists to
avoid.

**The radius is the weak number.** `CONTACT_PATCH_RADIUS_FRACTION = 0.10` of the
bounding-box diagonal is a **judgement, LOW confidence**, chosen so the default
disc is comparable in scale to the tapered-slab mode's depth on a typical part
rather than fitted to anything. Its sensitivity is not small: on the Ø5-bore tube
a 2.2× radius change moved the mesh-to-mesh spread 13.8% → 1.6% and the stress
level by more than 5×. **Pass `loadPatchRadiusMm`** — that is the number this
model actually wants, and the one the user knows and the tool does not. The
default is a conservative placeholder for it.

And the change is not free. On the Ø5-bore tube the new default is about **5.9×
more conservative** than the old one (SF 10.4 → 1.8 at matched meshes) because it
concentrates 50 N into a ~3.5 mm contact instead of smearing it over a ~12 mm²
face band. Which is right depends on whether the load really is transmitted
through a small pad at that point — a question nobody has measured on this
fixture. What can be said is that the previous behaviour was not an idealization
at all: it applied the load to a face the part is not touched on.

### 4.4 Linear solve

`K·u = f` is solved with **Preconditioned Conjugate Gradient** (Saad §6.7,
`server/solver/cg.ts`). The **default preconditioner is incomplete Cholesky
IC(0)**, with Jacobi (diagonal) as the fallback — IC(0) typically cuts iteration
count 3–10× on well-conditioned FEM systems, and a negative or near-zero pivot
during factorization (`IC0_NONPOSDEF`) falls back to Jacobi automatically rather
than failing the solve. Validation groups 13 and 18 compare the two directly, on
iteration count and on the full displacement vector.

Convergence is on the **relative residual** `‖r_k‖₂ / ‖f‖₂ < 1e-8`, which is
ample for engineering stress analysis. Iteration is capped and a wall-clock
deadline (`CG_DEADLINE_DEFAULT_MS`) bounds a runaway on a near-singular system;
the result distinguishes "hit the deadline having already reached tolerance" from
"timed out short of it". Residual checkpoints stream to the client so the CG
residual trend is observable during a long solve.

---

## 5. Stress recovery — SPR

Raw element stresses are `σ = C · B · uₑ`. For display and safety assessment they
are smoothed with **Superconvergent Patch Recovery** (Zienkiewicz & Zhu 1992,
`server/solver/stress.ts`): a least-squares polynomial is fit over each node's
element patch and sampled at the node. Every display vertex receives a stress
value; coincident vertices at mesh seams are welded before colour assignment so
the heatmap has no artificial discontinuities (the weld's own invariants live in
`CLAUDE.md`).

### 5.1 What the fit is sampled from

SPR here fits a **point cloud** (`SprSamples`), not element centroids, and there
are two ways to build one:

- `buildCentroidSamples` — one sample per element at its corner-average centroid.
  This is the whole of a C3D4 element: its stress genuinely IS constant, and the
  centroid is where that value belongs.
- `buildGaussSamples` — for C3D10, `σ = C·B·u` evaluated at all **four Gauss
  points**, un-averaged, each with its physical position from the isoparametric
  map and its `|detJ|·w`. It returns `null` for linear elements, because there is
  nothing to un-average.

The recovery basis matches the element order: linear `[1, x, y, z]` for C3D4,
full quadratic `[1, x, y, z, x², y², z², xy, yz, zx]` for C3D10. The quadratic
terms *extend* the linear ones, so a quadratic fit contains the linear space and
the linear-exactness guarantee survives the upgrade. The fit cascades
quadratic → linear → plain averaging, so a patch that cannot support 10 terms
gets a linear fit **on the same Gauss cloud** rather than dropping straight to an
average.

**Why this mattered more than the obvious argument suggests.** The original
diagnosis was that centroid sampling averaged away each element's within-element
stress variation. That is real, and it is what the quadratic basis addresses —
but it was not the cause of the measured error floor. The real cause was patch
**rank**: with one sample per element, a nodal patch at a convex corner of the
model holds 2–6 points, a 3-D linear fit needs 4 and wants more for conditioning,
so those patches failed the rank/amplification guard and fell back to plain
averaging — and averaging over a one-sided patch is biased by `O(h·|∇σ|)` *even
when the finite-element solution is exact*. Measured: under centroid sampling, 6
of 343 corner patches on a structured box and 28 of 792 on a TetGen cylinder were
rank-deficient; under Gauss sampling with the linear basis, **zero** were, on
either mesh.

Midside nodes are still **interpolated from their corners** rather than fitted
directly, and that was measured rather than assumed: under the quadratic basis
the amplification at midside nodes has median 2.2e8 on a structured box, with 913
of 1854 midside nodes outright rank-deficient there and 946 of 4245 on a TetGen
cylinder. A ring of tets around one edge is not a 3-D neighbourhood however
densely each tet is sampled.

Cost, measured on structured C3D10 boxes, recovery + estimator stage: **~1.6×**,
not the ~10× that 4× the samples with a 10-term basis suggests — the normal
matrix is still built once per node and amortised across all six components, and
the estimator's energy loop reads `σ_h` back from the samples instead of
rebuilding **B**.

### 5.2 One recovered field, not two

**The nodal quantity that is recovered is the stress TENSOR.** The displayed von
Mises heatmap and the per-node utilization ratios are **projections** of it, taken
after the recovery through the shared `vonMisesFromTensor6` — on C3D10 *and* on
C3D4 (issue #258). `sprSmoothedStress`, the old independent scalar recovery, is
consequently unreachable on any result the pipeline builds; it remains only as the
honest fallback for a result carrying neither a nodal nor an element tensor.

Three reasons, in order of weight:

1. **Superconvergence is a property of the tensor, not of von Mises.** The whole
   reason to sample at Gauss points is that σ's *components* are superconvergent
   there. Von Mises is a nonlinear functional of σ; its Gauss-point values carry
   no such guarantee, so recovering it directly keeps the sampling change while
   discarding the theorem that motivated it.
2. **Recovering von Mises directly has a known-SIGN bias.** Von Mises is
   **convex**, so by **Jensen's inequality** a patch fit through
   von-Mises-at-sample-points sits at or *above* the von Mises of the fitted
   tensor. It therefore over-reports the displayed peak systematically — in the
   same direction as the artifact this work exists to remove, on the field a user
   reads a safety factor off.
3. **It makes the heatmap and the ZZ estimator the same field.** Before, they
   were two independent recoveries of one physical field, free to disagree; the
   error estimate could improve while the picture did not. Now the displayed
   heatmap IS the field the estimator judged — literally: `σ*` comes back on
   `SolverResult.nodeStress6` and the display path reads it, rather than being
   recovered a second time (measured, that duplicate cost as much as the entire
   estimator stage it repeated).

The measured improvement is against **truth**, on a manufactured linear field the
mesh reproduces exactly:

| path | worst nodal error |
|---|---|
| von Mises of the recovered tensor | 6.31e-13 (round-off) |
| independently recovered scalar | 1.000 absolute at a corner against an exact 5.000 — 20% wrong |

and it was never only corners. Worst relative error by boundary class on the old
path: interior 8.33%, face 9.09%, edge 9.68%, corner 20.00%. Rank-deficient corner
patches are the extreme case, not the mechanism's extent — centroid recovery is
biased wherever the incident element centroids sit off-centre from the node,
which is everywhere in a tet mesh and merely least bad in the middle. How an ~8%
bias in the *displayed* field went unnoticed is worth recording: the exactness
test (validation group 20) exercised the tensor path. There was no exactness test
for the scalar path at all. The recovery that was proven exact was not the one
users read a safety factor off.

**On C3D4 the change is lateral, and that is stated rather than dressed up.**
`buildGaussSamples` returns null for linear elements, so C3D4 *recovery* is
unchanged; but the display path takes the projection whenever a nodal tensor
exists, and it exists on C3D4 too. Measured against the same manufactured field,
worst nodal error is **identical** on both formulations (20.00% / 15.00% / 10.00%
at 162 / 384 / 1,296 elements, shrinking as O(h)) — the accuracy win came from
Gauss sampling, and there is nothing to Gauss-sample on a constant-stress element.
The argument for taking the projection on C3D4 anyway is **consistency, not
accuracy**: one recovered field, the same operation on both element types. That
is a weaker warrant than the C3D10 case has and should not be quoted as if it
were the same evidence. `spr-scalar-projection.test.ts` locks all of it, including
the fact that projection and direct recovery genuinely *differ* — so if they ever
coincided, the argument for preferring one would have quietly stopped applying.

---

## 6. Failure assessment

### 6.1 The FDM dual criterion (default)

The isotropic **von Mises** equivalent stress is

```
σ_vm = √( ½[(σxx−σyy)² + (σyy−σzz)² + (σzz−σxx)²] + 3(τxy² + τyz² + τxz²) )
```

STORMFEA's default failure criterion is the **FDM dual criterion**
(`fdmDualCriterionSF`, `server/solver/stress.ts`), evaluated in the material
(layer) frame with the weak/layer-normal axis as local *z*. It replaces the
earlier single Hill (1948) quadratic (see the
[layer-model audit](layer-model-audit.md), findings A1–A3) and separates two
physically distinct mechanisms, taking the governing minimum:

1. **Bulk (bead) yield** — von Mises against the in-layer yield `Y`:
   `SF_bulk = Y / σ̂`, where `σ̂ = σ_vm` unless the element carries core
   pressure-sensitivity (§2.4's DFA term, `α = 0` on every non-core element and
   on the single-material path, giving bit-identity). This is
   **azimuth-invariant by construction** — a norm cannot depend on the part's
   rotation about the build axis — which is the property a calibrated single Hill
   form provably *cannot* have while also matching the measured in-plane shear
   yield. That was defect A1: with `N = 3/(2Y²) ≠ F + 2H`, a 45° azimuth rotation
   of the same in-plane shear state moved yield from 0.577·Y to ≈0.99·Y at
   `Z = 0.58Y`. A norm also cannot go negative, which fixes A2 (the clamped
   quadratic that reported `SF = 999` for in-plane tension–compression states
   when `Z < Y/2`).
2. **Interface (layer-bond) failure** — a tension⊕shear interaction on the layer
   plane (Brewer & Lagace 1988 / Hashin 1980 interlaminar form),
   **tension-only** in the normal term, because layers do not delaminate in
   compression (fixes A3):
   ```
   σzz > 0:  U = √( (σzz/S_zt)² + (τ_z/S_zs)² ),   SF_int = 1/U
   σzz ≤ 0:  Mohr–Coulomb friction credit — SF_int = S_zs / (τ_z − μ·|σzz|)
   ```
   with `τ_z = √(τyz² + τxz²)`, `S_zt = yieldZ` (through-layer tension) and
   `S_zs = yieldZShear` (interlaminar shear). `μ = INTERFACE_FRICTION_MU = 0.3`
   is a **LOW-confidence** engineering default from polymer-on-polymer sliding
   friction (~0.2–0.4), locked by `fdm-criterion.test.ts`. Compressive crushing
   is still caught by the bulk term. Do not re-symmetrize this: the asymmetry is
   the physics.

`SF = min(SF_bulk, SF_int)`. Both mechanisms scale linearly with load, so the
safety factors are exact closed forms rather than a search. At the isotropic
anchor (`S_zt = Y`, `S_zs = Y/√3`) the criterion reproduces von Mises for every
uniaxial, shear, and normal+transverse-shear state; hydrostatic-tension-dominated
states are intentionally interface-governed, because a bonded interface separates
under triaxial tension and von Mises is blind to it.

The default `S_zs = yieldZ/√3` (`INTERSHEAR_OVER_YIELDZ_DEFAULT`,
`interlaminarShearOf`) is **exactly** the transverse-shear yield the legacy Hill
coefficients `L = M = 3/(2Z²)` encoded, so uncalibrated through-layer results
match the legacy criterion. The critical FTC case is unchanged: a **flat print
loaded through the layers** has `σzz` dominating and drops to `SF ≈ Z/Y ≈ 0.58` —
the tool's core "false-safety" claim, asserted exactly rather than in a tolerance
band (validation group 7). The result summary reports the governing SF, its
criterion label (`sfCriterion`), and the plain von Mises SF
(`vonMisesSafetyFactor`) for comparison.

**In-plane raster (cross-bead) anisotropy (opt-in).** A unidirectional or
dominant raster is weaker *across* the beads than along them. When enabled
(`AnalysisSettings.inPlaneAnisotropy`) **and** there is evidence — a measured
`crossBeadRatio` or a declared unidirectional raster — a third cross-bead
tension⊕shear check is resolved onto the raster axes and added as a separate
`min` on the **bulk** term (audit A7). The interface term is untouched, so
azimuth invariance about the weak axis is preserved. With no evidence the ratio
is 1 (no penalty) and the criterion collapses exactly to von Mises; typical ±45°
alternating rasters homogenize toward isotropic and stay isotropic, which is why
this is opt-in and evidence-gated. Absent a measured
`CalibrationProfile.crossBeadRatio`, the literature default is
`CROSS_BEAD_RATIO_LITERATURE = 0.85` — an engineering default mid-band of the
~0.7–0.9 spread reported for unidirectional-raster tensile coupons (no single
paper pins 0.85 exactly), **confidence LOW**; see the SOURCES tab entry
`cross_bead_ratio`.

**Legacy Hill.** The Hill (1948) quadratic (`hillEquivalentStress`) remains
callable (`criterion: "hill-legacy"`) for comparison and as the
upright-with-no-bed **scalar-swap** fallback — the interface criterion needs a
known weak axis, which that fallback deliberately lacks. When `Y = Z`, Hill
reduces exactly to von Mises, verified at the isotropic limit by validation
group 7. Its anchor tests still run every suite pass, so a change that broke
`hill-legacy` callability would fail immediately.

### 6.2 Bolt-region and interlayer failure modes

Beyond the bulk-yield SF, `server/analysis.ts` checks the mechanical failure
modes around bolted holes, each with an individual confidence level:

| # | Mode | Basis | Confidence |
|---|---|---|---|
| 1 | Bulk yield | dual-criterion SF over the solved volume | **high** — from the stress field, not a closed form |
| 2 | Net-section tension | `σ_net = F/(ligament·t)` across the reduced section | **high** — classical |
| 3 | Shear-out | two shear planes from hole edge to free edge, against the interlaminar allowable | **medium** |
| 4 | Thread strip-out | engaged-thread shear area × `threadLayerPenalty` for the layer boundaries the helix crosses | **medium**, ±30% |
| 5 | Bearing (hole wall) | `F·mult/(d·t)` against the bearing allowable | **low** without a coupon, **medium** with one |

Two refinements worth stating. Bearing uses a **cosine-bearing** distribution
factor (peak ≈ π/2 × uniform) rather than a uniform pressure on the projected
area, and the mode's `failForceN` is `F·SF` like every other row — applying the
concentration factor a second time there was a real defect. And on a two-region
part with wall-lined holes (issue #175), thread strip-out and bearing use the
**shell** allowables, not the shell/core blend: slicers line a hole with dense
perimeters, so the shank bears on wall material. A 20%-infill and a 100%-infill
part with equal wall count therefore get the same bearing and thread allowable,
which is the physically right answer and was not what the blend gave.

When the dual criterion is active the layer interface is additionally
**decomposed** into two reported rows, so delamination is calibrated separately
from the bulk-yield SF that already folds both in:

6. **Interlayer tension (delamination onset)** — peak through-layer opening
   stress `⟨σzz⟩₊` vs `S_zt`. LOW confidence, raised to MEDIUM when a Z-tension
   coupon is run.
7. **Interlayer shear** — peak driving interlayer shear (friction-credited under
   compression) vs `S_zs`. LOW confidence, raised to MEDIUM when a lap-shear
   coupon is run.

With in-plane raster anisotropy active, an **In-plane bead bond (cross-raster)**
row is added likewise. The optional **Linear buckling (BLF)** mode is added when
buckling is requested (§8).

**The governing mode drives the headline** (issue #278). The lowest SF over bulk
yield and every checked mode above sets `summary.safetyFactor`, and
`summary.estimatedFailForce` is `totalAppliedForce ×` it. The bulk-yield-only
pair remains in the payload as `bulkSafetyFactor` / `bulkFailForceN`, and
`governingMode` names the mode responsible; both surfaces (the app's results bar
and the printed report) show the governing number, the mode that set it, and the
bulk-yield number side by side. Bulk yield is the most trustworthy single number
here — it comes from the solved stress field rather than a closed-form estimate —
but a part that strips its threads at 283 N does not survive to its 600 N
bulk-yield load, so the headline follows the governing mode and *discloses* the
bulk one rather than the reverse. On a part where no analytic mode is checked the
two are identical by construction.

### 6.3 Fatigue (Goodman)

A fatigue-life estimate uses the **modified Goodman** relation (plus Basquin for
cycle count) with an orientation-dependent endurance ratio `Se/UTS = 0.37` (flat
print, inter-layer bonds are the weak link) or `0.43` (upright print), from Wang
et al. 2020. The **load ratio** `R = σ_min/σ_max` is a user input (default `0`,
pulsating): `σ_a = σ_max(1−R)/2`, `σ_m = σ_max(1+R)/2`, with compressive mean
stress conservatively clamped to zero. `R = −1` is fully reversed; `R > 0` is a
tension-biased cycle.

Confidence is **LOW** by default — published FDM S-N data is sparse — so it is
reported as an estimate, not a guarantee. A team can raise it to MEDIUM by
fitting their own S-N curve at `POST /api/calibration/fatigue` (§9), **provided
the fit is clean**; a high-scatter dataset is still used but stays LOW.

---

## 7. Convergence & discretization error

Every finite element solution is an approximation whose error shrinks as the mesh
refines. STORMFEA surfaces that error four ways, and they measure genuinely
different things:

- an in-app **estimate** of where discretization error concentrates (the ZZ
  heatmap η, no re-solve needed) — §7.1;
- a per-location **measurement** of how much of the picture is the mesh rather
  than the part (the mesh-sensitivity overlay, from solves already run) — §7.2;
- a **trend** across mesh densities, with observed-order Richardson extrapolation
  — §7.3–7.4;
- **singularity diagnostics** that say when refining is the wrong instruction
  entirely — §7.5.

### 7.1 The ZZ (Zienkiewicz–Zhu) error estimate, η

`computeZZErrorEstimate` (`server/solver/stress.ts`) compares the SPR-recovered
field (§5) against the element field — the gap between "what the mesh computed"
and "what a locally-fitted polynomial says it should be" is the error indicator,
per Zienkiewicz & Zhu 1992.

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
  C3D10 (read back from the same samples the recovery used, so it is computed
  once) and constant per element on C3D4.
- `C⁻¹` is the compliance, one 6×6 inverse per material **bin** — the single
  rotated material normally, or the per-bin blended `C` when a two-region
  `ElementMaterialField` is active (§2.4). Using the full tensor norm rather than
  a scalar magnitude is what makes soft directions dominate: with `E_z ≪ E_xy`, a
  through-thickness error outranks an in-plane one of equal magnitude, which is
  the ordering an FDM part needs.

Element volume enters through the Gauss factor `w_g·|detJ_g|`, so error is
weighted per unit of part volume rather than per element — a cluster of small
elements does not outvote one large one by count. (Three earlier approximations —
a scalar von Mises magnitude difference, inverse-distance interpolation to the
centroid, and no volume weighting — were replaced by the above in issues
#143 / #144 / #145.)

**Normalization.** Per-element η is that error energy normalized by the **global**
stress energy norm, `‖σ‖_global = √(Σ_e ∫ σ_hᵀ C⁻¹ σ_h)`:

```
η_e = ‖error‖_e / ‖σ‖_global
```

So **η is a share of the whole part's energy norm, not a percentage error on that
element's own stress value.** Two consequences that make it easy to misread:

- Refining the mesh spreads the same total error over more elements, so the same
  physical defect produces a *smaller* η per element on a finer mesh — η values
  are not comparable across mesh densities.
- η says nothing about whether the *element's own* stress is high or low in
  absolute terms — a low-stress element in a poorly-resolved region can rank above
  a high-stress element in a well-resolved one.

`globalRelativeError` (returned alongside `errorEstimate`) is the one number that
IS an absolute, whole-part accuracy read: the root-sum-square of every element's
η, `√(Σ_e η_e²)`. It answers "how far is this solve, overall, from the
SPR-smoothed reference" — the η heatmap then shows *where* that total is
concentrated. The client shows both together for exactly this reason: the map for
"where to refine", the global figure for "how much to trust the numbers".

**What the suite actually proves about them.** Beyond the sanity checks (both
defined and non-negative, finer mesh ≤ coarser), the estimator is measured
against **manufactured solutions with a known exact stress field**. The
effectivity index `θ = η / ‖σ_exact − σ_h‖` is held to the classic [0.7, 1.3]
window on C3D4 and to a monotone approach toward 1 from the conservative side
(validation group 30); on C3D10 it is held to `θ > 1` with a ceiling of 2.0 and a
monotone trend ([33.4], [33.5]), and on a field C3D10 reproduces exactly, η is
required to be round-off rather than O(h) ([33.2] — it reads 3.2e-13 / 4.9e-13 /
7.0e-13 across three densities, against 1.46% / 0.53% / 0.26% before Gauss
sampling). So the direction and trend are locked, and on C3D4 the magnitude is
too. C3D10's θ ≈ 1.5 on a structured box is outside the classic band (an
unstructured TetGen fixture does reach 1.22): the estimate is **conservative**
there, not calibrated. Read both numbers as indicators with a known bias
direction, not as error bounds.

### 7.2 What η cannot see: the displayed field's own mesh-dependence (issue #294)

The heatmap carries something the rest of the pipeline does not tolerate
anywhere else: a scattered, mesh-dependent tail. **Re-mesh the same part at the
same density and the hot spots move.** The rest of the solve is held to a much
tighter standard — flag-off bit-identity to 1e-12, CG residual 1e-8 — so this is
worth stating plainly rather than leaving in a comment.

Re-measured on the #294 cantilever fixture at the post-#295 tier densities
(`server/tests/measure294.ts`, an offline script rather than a CI test), `|A − B|`
as a share of the surface peak, with mesh B being mesh A with its nodes displaced
by 15% of cell size:

| tier | elements | through-thickness | median | p95 | max | Spearman(η, \|A−B\|) | globalRelativeError |
|---|---|---|---|---|---|---|---|
| coarse | 4,032 | 4 | 0.29% | 2.15% | 14.61% | 0.061 | 8.2% |
| standard | 9,984 | 4 | 0.18% | 1.45% | 1.83% | −0.066 | 5.6% |
| fine | 36,000 | 6 | 0.12% | 1.00% | 1.14% | −0.164 | 3.9% |

At 25% node displacement the coarse tier reaches p95 12.18% / max 18.40% and the
standard tier p95 1.36% / max 10.20%, comfortably reproducing #294's original
figures (p95 7.90% / max 16.05%). So the defect is not gone; it is
**density-dependent**, and it is largest exactly where a user picks "coarse" to
get an answer quickly. Refinement shrinks it monotonically and is still the only
lever on amplitude.

Three things follow, and all three are load-bearing.

**η cannot flag these locations, and that is mechanism, not a bug to fix.** η is
`‖σ* − σ_h‖`: it differences the RECOVERED field against the RAW element field,
so an artifact carried by *both* cancels in the difference. The measured Spearman
rank correlation between a mesh's own `errorEstimate` and the actual mesh-to-mesh
disagreement at the same location is 0.015 (original), then 0.061 / −0.066 /
−0.164 on re-measurement — not one of those is predictive, and the sign flips are
noise rather than an anti-correlation worth reading. `globalRelativeError` remains
valid for the energy-norm error it was built for. **Never present
`topErrorElements` as "here is where the picture lies."**

**The answer is disclosure, not smoothing.** The model's colours ARE the reading,
so the response to an untrustworthy region is to *say* it is untrustworthy.
`meshSensitivityField` / `installMeshSensitivity` (`client/index.html`) difference
the two finest meshes a run produced, per display vertex, as a percentage of the
surface peak, and publish it as the `meshsens` view mode. This is free because
every analyse response paints the SAME display mesh (`req.positions`, the
client's upload-time geometry) whatever the analysis density — so index *v* in
one payload's `vertexStress` is the same point in space as index *v* in
another's, and the comparison is an array difference rather than a spatial
re-projection. The C3D4 background auto-check (§7.3) already produces two meshes,
so the overlay appears there without any extra solve.

What the overlay claims: where it is **large**, the colour at that location is set
partly by the mesh rather than by the part — a direct measurement. Where it is
**small**, that is weak evidence, not proof; two meshes agreeing is not
convergence. It differences two DIFFERENT densities, so it mixes the random
artifact with ordinary under-resolution; separating them would need two meshes at
the SAME density, a solve the tool does not otherwise need, for a distinction
that does not change what a user should do (refine, or distrust that spot).

**Null means unmeasured, and must never render as zero.** One mesh cannot measure
its own mesh-dependence: with no second solve the mode does not appear at all.

**Confidence, and the two halves do not carry the same weight.** The
**MECHANISM** — that the ZZ estimator cannot rank these locations — is **HIGH**:
it is structural rather than statistical, and the measurement agrees four times
independently across two perturbation amplitudes and three densities. Nothing
about it is specific to the fixture. The **AMPLITUDES** in the table are
**MEDIUM**: one geometry class (a plate in bending), one isotropic material, one
perturbation model, structured meshes rather than TetGen output. What they
support is the comparison BETWEEN tiers, which is a within-fixture comparison and
therefore robust. What they do NOT support is quoting "p95 1.45%" as the number
for some other part — which is exactly why the tool measures the overlay per-part
rather than shipping a constant. The erring direction is known: a structured box
mesh perturbed by a fixed fraction of its cell is a *tame* model of "a different
mesh of the same part" compared with re-running TetGen, which changes connectivity
as well as node placement, so the real spread between two tier-equivalent meshes
is likely LARGER than these tables, not smaller.

Full measurements: [`display-field-mesh-sensitivity.md`](display-field-mesh-sensitivity.md).

### 7.3 The 5% "converged" threshold and the background check

Both the automatic background check and the manual mesh-convergence study use the
same criterion, hard-coded as `changePct < 5.0` (percent) in `client/index.html`.
`changePct` is the percent change in the tracked metric between two mesh levels —
normally peak von Mises:

```
changePct = |metric_fine − metric_std| / metric_std × 100
```

Under 5% is reported "converged" / "mesh-independent within tolerance"; 5% or
more triggers an automatic swap to the finer mesh's results (the "auto-upgrade"
badge) in the background path, or a "not converged" call-out in the manual study.
5% is an **engineering heuristic on ONE scalar**, not a formal a-posteriori
bound — a badge can read "converged" while a different, non-peak location is
still drifting. It is also the same cutoff `headlineSpread` uses, deliberately,
so the two cannot say opposite things.

**C3D4 caveat.** For linear tetrahedra, two meshes can agree within 5% because
both suffer the *same* shear-locking stiffening, not because the answer is right
— the badge says so in those words. C3D10 skips the background check entirely:
the standard-mesh response already reports `nodesPerElem === 10`, and quadratic
elements do not need the fine-mesh confirmation.

**The SF > 3.0 smart-skip.** The background fine-mesh check runs only when it is
likely to matter. If the standard mesh has no computable safety factor
(`safetyFactorAvailable === false`), the fine mesh is skipped outright — a finer
mesh cannot manufacture an SF that does not exist. Otherwise, if the standard
SF exceeds 3.0 the fine mesh is skipped and a "clearly safe" badge is shown: a
part already at 3× the failure load has enough margin that mesh-driven changes to
the peak are very unlikely to flip the SF below 1, so the extra solve is not worth
the compute. The gate reads the **bulk** SF (`summary.bulkSafetyFactor`, issue
#278), because it is asking "is the STRESS FIELD comfortable enough that a finer
mesh cannot change the answer" — the *governing* SF can be dragged below 3 by a
closed-form analytic mode that no amount of remeshing moves, which would spend a
solve to learn nothing. This is a heuristic gate on cost, not a proof, and it is
skipped only for the *background, automatic* check; the manual "MESH CONVERGENCE
STUDY" always runs every requested level regardless of SF.

### 7.4 Manual study, observed-order Richardson, and headline spread

The manual study re-solves the model at several mesh-quality settings and reports
peak von Mises, node/element counts, and SF at each level. From that sequence it
computes an **observed** order of convergence rather than assuming one
(`convergenceObservedOrder`, issue #146), per standard Grid Convergence Index
practice:

```
r     = (nodes_fine / nodes_std)^(1/3)              // representative linear refinement ratio
p_obs = ln( (f_coarse − f_std) / (f_std − f_fine) ) / ln(r)
σ_exact ≈ σ_fine + (σ_fine − σ_std) / (r^p − 1)     // richardsonExtrapolate
```

The reported order is clamped to [0.5, 3]; the *unclamped* value is kept because
it is a diagnostic in its own right (below). When the three-point sequence is
non-monotone — the differences flip sign — a single power law is undefined, and
the code falls back to the **element-order theoretical rate**: `p = 2` for
quadratic C3D10, `p = 1` for linear C3D4. That distinction matters and was a real
bug: the previous code hard-coded `p = 2` with the comment "for linear elements",
which is the *displacement energy-norm* rate, not the rate for the peak STRESS
being extrapolated (linear elements recover stress only to O(h)).

`r` is derived from node counts as a proxy for element-size ratio, appropriate
for uniform 3-D refinement and not guaranteed for adaptive or local refinement.
The extrapolated value is trusted, and shown, only when it lands in a sane
envelope `0 < extrapolated < 3 × σ_fine`; outside that range the raw finest-mesh
value is used with no extrapolation note.

**Headline spread (issue #256).** The study already solved the same part at three
densities and already knew each mesh's safety factor — it printed them in a
column without ever saying how far apart they are, so a user could read SF 6.24
next to SF 9.09 and be told only whether the peak stress changed less than 5%
between the last two. Those are different questions. `headlineSpread` reports the
range across meshes and whether it is monotone in density. Measured: 46% on the
Ø5-bore tube and 18.9% on the cross plate, both NON-monotone in element count,
against 2.2% and monotone for a plate-with-hole whose peak genuinely converges.
The spread separates "converged" from "sampled". Like the mesh-sensitivity
overlay, it returns **null** for fewer than two usable meshes rather than 0% —
one mesh cannot measure its own mesh-dependence, and reporting zero there would
be a lie rather than a default.

### 7.5 Singularities, and when refining is the wrong instruction

Reentrant corners, point loads, and rigid constraint patches are classic FEA
stress singularities: the theoretical peak grows without bound as the mesh
refines, so `changePct` at that location will not settle below 5% no matter how
fine the mesh gets, and Richardson's power-law assumption does not apply. Three
mechanisms address this, and none of them pretends to remove the singularity.

**Refinement-based detection.** When the peak diverges under refinement the
successive differences GROW instead of shrinking, so `p_obs` collapses toward
zero or goes negative. `selectConvergenceMetric` (issue #147) treats
`p_obs ≤ 0.5` as **refinement evidence** — scale- and unit-independent, and
therefore ranked ABOVE the server's single-mesh geometric heuristic — and
switches the study's convergence metric from peak von Mises to the **99th
percentile** of the vertex field. A geometric singularity is spatially a point,
so its vertices stay a vanishing fraction of the surface under refinement while
p99 tracks the genuine high-stress field. It needs no server change (the vertex
array is already in every payload) and is directly comparable across meshes,
because the display mesh is identical at every quality level. When this fires the
study does **not** auto-upgrade to the fine mesh: its peak is a larger artifact,
not a better answer.

**Single-mesh detection** (`detectSingularity`, issues #148 / #263) compares the
peak against its own neighbourhood, on a radius that is a fraction of the part
(`SINGULARITY_PART_FRACTION = 0.05`). Two thresholds, deliberately split:
`SINGULARITY_RATIO_REPORT = 3.0` produces a diagnostic payload,
`SINGULARITY_RATIO_ALARM = 6.0` sets `detected` and alarms the user. The band
between them exists because a binary gate on this ratio *flickers*: measured on
the cross plate at four densities the ratio read 3.3 / 3.1 / <3.0 / <3.0 while the
peak wandered non-monotonically, so which side a given mesh landed on was decided
by noise. A warning that appears and vanishes as a user refines is worse than no
warning; it teaches people the warning is meaningless. The gap between the
measured populations is thin and stated as such: a known-smooth plate-with-hole
control (Kt ≈ 3, provably converging) reads 2.3–2.4 across four densities, so an
alarm at 2.5 would shout at a concentration whose peak demonstrably converges.
2.4 against 3.0 is a narrow margin for a *measurement* and far too narrow for an
*alarm*, which is exactly why the two are separate numbers.

**BC-idealization error** (`bcSingularityErrorFraction`, issue #259) is the third,
and on bolt-constrained parts it dominates. A rigid displacement constraint
applied over part of a surface creates a singularity exactly where it stops, and
so does the rim of a loaded patch. Measured on the Ø5-bore tube under uniform
refinement, the clamped boundary and its edge grow from 52% to 75% of the error
energy while the smooth interior collapses from 38% to 16%; the global convergence
rate is 0.61 against the smooth-C3D10 expectation of 2.0, and 1.56 with the
clamped boundary excluded. **The sharp geometric rim is not the culprit** — an
earlier revision of the analysis said it was, and that was wrong. A sharp edge is
singular only when the material wedge is RE-ENTRANT (> 180°); the tube's outer rim
is a convex 90° edge between two traction-free faces, which is bounded, and it
carries ~0.3% of the error and does not grow. What is singular is the rigid-clamp
*idealization* — a modelling choice, not physics and not geometry.

So the fraction is reported on every ordinary solve, and the advice is
conditional on it: above 50% the wording says a finer mesh will NOT fix it and
points at the constraint idealization; between 33% and 50% the share is reported
without overriding the refine advice; below 33% it is not mentioned. On the
Ø5-bore tube's default coarse tier, 75.7% of the error is BC band — so
size-only advice was telling users to refine against a number their mesh does not
control.

**Do not compare `bcSingularityErrorFraction` across densities.** The band is
defined TOPOLOGICALLY (the patch rim plus `BC_SINGULARITY_DILATE_HOPS` rings of
mesh adjacency), so it thins geometrically as the mesh refines. On the tube it
falls 40.6% → 33.1% → 27.7%; on the cross plate it RISES 41.1% → 48.9% → 48.2%.
It does not even move predictably, let alone monotonically. It is meaningful as
"how much of THIS solve's error sits at the BC" and is the right thing to show
beside that solve. It is not a convergence metric.

The consequence for the SF is blunt and worth stating: **on a part with a
rigid-clamp singularity, peak stress and safety factor are not converged
quantities.** Varying only the adaptive loop's element-growth cap, with the
singularity exclusion switched off entirely, peak stress swung 44%
non-monotonically across three defensible meshes of the same part (7.28 / 6.24 /
8.99 minimum SF at 44,875 / 65,358 / 80,866 elements — the 65k mesh reports a
higher peak than the 81k one). Element count is not a proxy for accuracy there.
Anyone reading a safety factor off a bolt-constrained run should treat it as
±40%, and that is a limitation of the idealization rather than of the mesh or the
estimator. The only fix that reduces the TRUE error rather than avoiding or
re-labelling it is replacing the rigid clamp with a compliant bearing model,
which would move every bolt-constrained result the project has validated and is
deliberately not done.

Full measurements: [`bc-singularity-exclusion.md`](bc-singularity-exclusion.md).

### 7.6 Error-driven adaptive refinement (issue #149, opt-in)

`analysis.adaptiveRefinement` closes the loop between the estimator and the
mesher. `server/solver/adaptiveMesh.ts` turns the per-element η field into a
**regional size field** — a per-node target edge length — by equidistributing the
predicted error (Zienkiewicz & Zhu 1992):

```
h_new = h_cur · clamp( (η_target / η_e)^(1/p), minFactor, maxFactor )
```

with `p` the energy-norm convergence rate (≈ the element polynomial order: 1 for
C3D4, 2 for C3D10). That size field drives a targeted TetGen re-mesh; the module
itself is binary-independent and fully unit-testable.

Four guards keep it from running away, and each exists because of a measured
failure:

- **A per-step floor**, `minSizeFactor = 0.55`. It was 0.35, which is a ~23× jump
  in local element DENSITY absorbed across the refinement boundary in a single
  re-mesh — the prime suspect for slivers on the Ø5-bore tube. 0.55 is a ~6×
  density step, reached over more iterations instead of one violent one.
- **Bounded gradation**, `gradation = 1.5` (`smoothSizeFieldGradation`): the
  target size may grow by at most ~50% per element away from a refined region, so
  refined and unrefined regions are joined by a graded band rather than a step.
- **A global element-count budget.** `predictRefinedElementCount` is explicitly
  first-order, so the driver ALSO checks the count TetGen actually emitted against
  the same budget before committing to a solve (`judgeRemeshAgainstBudget`, the
  `budget-overshoot` stop reason).
- **Singularity exclusion.** Geometric `singularities` regions (a ball, right for
  a detected corner whose position is known but whose mesh neighbourhood is not)
  and a topological `excludeNodes` mask from `bcDiscontinuityMask` (right for a BC
  interface, which is defined by which nodes the BC touched, and the only shape
  that stays O(nodeCount)).

Two properties of that exclusion are easy to get wrong and are therefore recorded.
**It is SOFT, not a freeze**: `buildSizeField` pins a masked node's target to its
current size, but `smoothSizeFieldGradation` runs afterwards and pulls that target
back down whenever a refining neighbour demands it, so the band is a refinement
*damper*. That is desirable — it is what stops the mask carving a size
discontinuity into the mesh. And **the mask must be the rim, not the patch**: a
BC set is a 2-D patch embedded in a 3-D mesh, so in the VOLUME graph almost every
node of the patch has a neighbour just beneath it that is outside the set. The
first implementation used that test, masked the entire bore wall, and stalled the
loop at 18.7% against 11.1% with no exclusion at all. The fix restricts the
interface test to edges whose BOTH endpoints lie on the boundary surface, and
`bcDiscontinuityMask` therefore **requires** a surface mask and returns an empty
mask without one rather than guessing.

`DEFAULT_LOOP_OPTIONS`: `targetGlobalError` 3%, `maxIterations` 5,
`maxElementGrowth` 8×, `minRelativeImprovement` 5%. The loop stops on target
reached, iteration cap, growth cap, a stalled improvement, or a size field that
requests no refinement. **The 3% target is frequently not the binding
constraint** and is deliberately not re-tuned: on the Ø5-bore tube the loop
reaches 10.23% and stops on `max-iterations`, because ~5% of that is the
irreducible BC band (§7.5). Excluding a region from refinement while still
counting it in the reported error puts a floor under the reported number, and the
loop must **never** announce `target-error-reached` against a filtered figure
while the honest total is materially higher — `maskedErrorFraction` is documented
as a reported number and never a target, precisely so that trap stays structurally
impossible rather than merely avoided.

### 7.7 What this machinery does not cover

- **η is diagnostic, not a safety gate.** Nothing in the SF/verdict pipeline
  reads `errorEstimate` — a high-η region does not lower the reported SF or block
  a "safe" verdict. It is purely an accuracy diagnostic for the user.
- **The two-way split is not reported** (issue #259, decided). The reported error
  is ONE total with the BC share as a *diagnosis*, not a genuine
  resolvable/irreducible split. A user-facing split number would inherit the
  band's topological definition and would move by a third across three densities
  of one part, mostly because the band thinned — and would move again if anyone
  retuned the dilation constant. A headline that responds to an internal constant
  is worse than today's ambiguous total. This is blocked on a band definition
  stable under refinement, which needs a physical length scale nobody has
  justified.
- **Nothing here certifies the safety factor.** `adaptive-benchmark.test.ts`
  asserts that a lower energy-norm error does not certify the safety factor, and
  §7.5's 44% swing is how emphatically true that is.

---

## 8. Optional analyses

**Modal (`server/solver/modal.ts`).** Solves `K·φ = ω²·M·φ` by subspace iteration
(Bathe's method) with shift-invert; `f_Hz = √(ω²)/(2π)` with no extra factor in
the mm/N/MPa/tonne system. The shift `σ` in `K_σ = K − σM` is problem-scaled by
default (a fraction of the Rayleigh quotient of the static deflection under a
uniform body load) rather than a fixed 1.0, and that shift is also what
regularizes rigid-body modes into a small positive eigenvalue — the textbook fix,
which keeps the SPD PCG/IC(0) path valid. The subspace carries a guard block
(`p ≥ nModes + 8`) so clustered or degenerate pairs are resolved. Results are
**certified rather than hoped for** (issue #160): band completeness from the
guard block plus a per-mode residual `‖Kφ − ω²Mφ‖/‖ω²Mφ‖`, rigid modes labelled
rather than silently reported as structural, and three-direction participation
factors `Γ_d = φᵀ·M·r_d` with effective modal masses (issue #161). Mass comes from
`assembleMass(mesh, material)`, so it carries the infill/wall effective density;
the legacy label-substring density table is a fallback that knows only SOLID
density and would be wrong for a sparse-infill part.

**Linear buckling (`server/solver/buckling.ts`).** Assembles the geometric
stiffness `Kσ` from the pre-stress state and solves `(K + λ·Kσ)·φ = 0` for the
smallest positive **Buckling Load Factor**. The algorithm is **block subspace
(Rayleigh–Ritz) inverse iteration** on `K⁻¹·(−Kσ)`, not plain inverse power
iteration (issue #138). The reason is specific: power iteration converges to the
largest-magnitude eigenvalue of that operator, which under mixed tension/
compression pre-stress can be a NEGATIVE (tension-driven, non-physical) mode even
when a physical positive mode exists, and a single deflation still misses the
governing BLF when two or more dominant tensile modes or a clustered spectrum are
present. Iterating a block of `p` vectors converges to the invariant subspace of
the `p` eigenvalues of smallest `|λ|` — and because inverse iteration captures
smallest-magnitude eigenvalues, once the block converges the smallest POSITIVE λ
inside it is provably the global smallest positive BLF: any smaller positive
eigenvalue would have smaller `|λ|` still and would already be in the block. That
yields a **certificate** (`certified`), and the result distinguishes
`tensileDominated` (no compressive geometric energy at all) from `indeterminate`
(geometric energy present but no positive eigenvalue captured), where the BLF must
not be shown as a buckling factor. The FAIL/MARGINAL/PASS verdict is applied by
the caller against design-basis thresholds documented in the client SOURCES tab
(`blf_thresholds`). Validation group 16 checks it against the Euler
clamped-free column.

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

The dual criterion keeps `S_zt` (Z-tension) and `S_zs` (lap-shear)
**independent** — the lap-shear coupon no longer back-derives `yield_Z` through a
fixed `τ/0.58` coupling (audit A5). That conversion survives in exactly one
place, explicitly flagged, as the fallback when no Z-tension coupon exists. The
**lap-shear** and **Z-tension** coupons measure the inter-layer bond, the single
most influential input; running either lifts the matching delamination mode
LOW→MEDIUM. Lap-shear and bearing joints concentrate stress beyond nominal F/A,
so `POST /api/calibration/kt` runs FEA on the coupon geometry — the same
`runLinearStatic` that solves real parts — to recover the stress-concentration
factor Kt and correct the derived strength.

Two further calibrations fit process/cycle models rather than static allowables:
`POST /api/calibration/fatigue` least-squares-fits the Basquin exponent and
`Se/UTS` from cyclic-coupon points (fatigue LOW→MEDIUM), and
`POST /api/calibration/bond-sweep` fits the bead-penetration bond coefficients
from a process sweep of Z-tension coupons (bond model LOW→MEDIUM, via
`CalibrationProfile.bondCoeffs`).

**Fit-quality gating (both fitted models).** A fit that reproduces the data poorly
must not silently earn the LOW→MEDIUM upgrade, so each endpoint measures its own
residual and gates on it. The residual is always returned — even a clean fit shows
its evidence — and every response carries an additive `fitQuality` field.

- **Bond sweep — reject.** `fitBondCoeffs` reports `rmsePct`, the RMS of
  (predicted − measured) Z-tension strength as a percentage of the mean measured
  strength. A clean sweep fits to well under 1%; the threshold is
  `BOND_FIT_RMSE_MAX_PCT = 15` (generous headroom that still catches a mislabeled
  point — a single 3× outlier lands near 77%). Above it the endpoint **refuses
  with 400**, naming the worst datum and its deviation. Rationale: the fitted
  coefficients are applied *multiplicatively* to interlayer strength and stiffness
  in **every** subsequent process-aware analysis, so accepting a fit the physics
  cannot reproduce would corrupt all of them at once; the literature-constants
  path stays the honest default.
- **Fatigue — accept but keep LOW.** `fitFatigueProfile` reports `logRms`, the RMS
  residual of the log-log Basquin regression (≈ multiplicative amplitude scatter).
  The threshold is `FATIGUE_LOGRMS_MAX = 0.15` (≈ ±16%). S-N scatter is physically
  inherent, so a team's own noisy coupons are still their best data — the endpoint
  **accepts** the fit and stores the measured `Se`/`b`, but tags the profile
  `fatigueFitQuality: "poor"`, which keeps `estimateFatigue` at **LOW** confidence
  and says so in the mode note. A clean fit behaves exactly as before.

The reject-vs-keep split is deliberate: bond coefficients are global multipliers
on load-bearing allowables, whereas the fatigue fields drive only the already
order-of-magnitude fatigue mode.

---

## 10. Validation

The solver ships an automated validation suite
(`server/tests/solver_validation.ts`, run via `npm run test` and reproducible live
at `GET /api/solver-tests`) that checks the kernel against problems with known
answers. Grouped by what they anchor:

**Kernel and elements**

- **Patch test** — uniform strain reproduced exactly.
- **Element checks** — C3D10 shape-function partition of unity; `kₑ` symmetric
  (`< 1e-8`) and positive-definite; the node-order self-check and the affine
  quadrature limit against the 64-point Duffy rule.
- **Cantilever beam** — tip deflection within the expected band of the
  Euler–Bernoulli solution, plus linear scaling (2× load → 2× deflection); the
  C3D4 shear-locking ratio (~0.43 of Euler–Bernoulli at L/H = 20) is measured
  rather than assumed. A simply-supported beam and a C3D10 convergence sweep
  corroborate.
- **Pure axial tension** — the case with no fundamental discretization error, so
  it is compared to the textbook answer tightly rather than in a band.
- **Rigid-body-mode detection** and **mesh-quality checking**.
- **IC(0) vs Jacobi** — iteration count and full displacement-vector agreement.

**Constitutive and failure**

- **Constitutive matrix** — orthotropic **C** reduces to isotropic when the
  through-layer constants match (`< 1e-6`); orthotropic directional stiffness.
- **Failure criterion** — the FDM dual criterion reproduces von Mises at the
  isotropic limit and is **azimuth-invariant** about the weak axis (exact to
  1e-12); in-plane uniaxial yields exactly at `Y_xy`; the false-safety case (flat
  print, through-layer load) detects `SF ≈ 0.58` — the core engineering claim;
  tension/compression asymmetry of the interface term. The legacy Hill form is
  checked for the same anchors where it stays callable.
- **Weak-axis rotation** — the Bond-transform core (`bond-rotation.test.ts`):
  identity for `+Z`, correct modulus reorientation, and an end-to-end anisotropy
  flip when the weak axis is rotated.
- **Two-region material field** — single-bin field reproduces the no-field solve
  exactly (1e-12); a sandwich cantilever matches composite-EI beam theory within
  0.3% where the homogenized model is ~23% too soft; wall-bond flag-off
  bit-identity; plus a Taguchi L9 orthogonal array sweeping
  infill/walls/pattern/orientation for main-effect sanity.

**Loads and stress concentration**

- **Body force (self-weight)** resultant conservation; **surface pressure /
  traction** including face selection on a coarse mesh with no silent zero-load.
- **Hole-in-plate concentration** — a plate with a central hole in uniaxial
  tension returns the classic Kirsch `Kt ≈ 3.0` (peak/gross) within ~15%, run
  through the production solver on a mesher-free structured C3D10 fixture.
- **Lekhnitskii orthotropic open-hole Kt** — the anisotropic counterpart of the
  Kirsch anchor, which the isotropic one cannot exercise.
- **Kt calibration** — a uniform coupon bar returns `Kt ≈ 1.0` within noise, plus
  the calibration-specific Kt fixtures.

**Recovery and error estimation**

- **SPR** — smoothing behaviour, linear-field exactness including the C3D10 stride
  regression, boundary-patch robustness against a known answer.
- **ZZ estimator** — sanity (defined, non-negative, finer ≤ coarser); the true
  energy-norm formulation; MMS effectivity on C3D4 held to [0.7, 1.3]; the C3D10
  exactness floor and effectivity trend (§7.1).

**Homogenization harness**

- **Numerical homogenization** (`server/homogenize.ts`) runs a perforated-plate
  cell through the SAME production solver at several hole radii and fits
  `n = Σ(ln ρ · ln g)/Σ(ln ρ)²`. It validates the HARNESS, not the infill
  exponent: a single circular hole is stress-concentration-dominated (Kt ≈ 3) and
  deliberately over-softens relative to a periodic wall network, so the suite
  checks that a solid cell recovers `E_solid` within 5%, that `g(ρ)` is monotone,
  that the dilute limit matches isolated-hole compliance, and that the power-law
  fit is clean — while explicitly **not** asserting the fitted exponent against
  the shipped `walls25d` value. The Gibson-Ashby exponents stay **LOW
  confidence**; this is a first-order cross-check, not a periodic RVE, and not a
  substitute for physical coupon calibration.

These solver checks run alongside the Vitest unit tests, the parallel-assembly
equivalence check, and the client-logic checks. Exact counts are reported by
`npm run test`; see the README's Contributing section for the current totals (a
CI guard, `scripts/check-doc-test-counts.mjs`, keeps those hand-copied numbers
from drifting away from the machine-generated summaries).

### 10.1 Per-analysis validation coverage (issue #191)

The suite scoreboard above is **global** — it reports that the whole suite passes,
not whether the suite covers the specific model path a given analysis just
exercised. Those are different assurances: an isotropic C3D4 part with a single
applied force rests on a very different (larger) set of anchors than a C3D10
two-region part with a bond-process block and bolt loads.

`server/validation-coverage.ts` maintains a small, explicit mapping from
configuration **axes** (element order, material model, failure criterion, load
types, mesher, opt-in options) to the solver-validation groups and unit suites
that directly exercise each axis value. Every analysis computes its own
**fingerprint** from its actual characteristics and gets back a coverage report
(`summary.validationCoverage`) — surfaced in the client as a "Validation Coverage"
panel near the results, and identical data is available via the API.

**What a coverage claim means:** the listed suite exercises the same *kind* of
characteristic (e.g. "runs a C3D10 mesh", "activates the two-region material
field") somewhere in the automated suite.

**What it does NOT mean:** it is not a claim that this exact geometry, load case,
or material combination has been proven correct — that would require a regression
fixture matching the user's actual part, which the project does not maintain.
Coverage is also tracked primarily **per-axis**, not per full combination; a
small, explicitly-maintained list of **known combination gaps**
(`KNOWN_COMBO_GAPS`) states plainly where two individually-covered axes have no
direct anchor for their *combination* (e.g. two-region validation runs exclusively
on C3D10 meshes today, so C3D4 + two-region has no direct combination anchor even
though each axis alone does). An intentionally-uncovered axis or combination is
reported as a plain gap statement, never silently implied as covered — checked
directly by `server/tests/unit/validation-coverage.test.ts`, including a CI guard
that every axis value in the fingerprint enum has an explicit (possibly empty)
entry in the coverage map, so a new feature must declare its coverage or declare
none rather than falling through unmapped.

---

## References

Literature the solver's constants and formulations are taken from. Every entry
here is cited from a source comment in the repo; the app's **Sources** tab carries
the same list with per-constant notes.

**Failure criteria and recovery**

- Hill, R. *A theory of the yielding and plastic flow of anisotropic metals.*
  Proc. R. Soc. A, 1948. (and *The Mathematical Theory of Plasticity*, OUP 1950)
- Hashin, Z. *Failure criteria for unidirectional fiber composites.* J. Appl.
  Mech., 1980; Brewer & Lagace, interlaminar stress-based criteria, 1988 — the
  quadratic tension⊕shear interface form the dual criterion's interface term
  follows.
- Zienkiewicz, O.C. & Zhu, J.Z. *The superconvergent patch recovery and a
  posteriori error estimates.* Int. J. Numer. Methods Eng., 1992 — SPR (§5) and
  the ZZ estimator and its equidistribution sizing law (§7.1, §7.6).

**FDM material properties**

- Perez, Celik & Karkkainen 2021 — `E_z/E_xy`; stiffness more isotropic than
  strength.
- Cojocaru et al. 2019 (UPB Sci. Bull.); Rodriguez et al. 2001 — `yieldZ/yieldXY`
  (measured 0.59 and ~0.50 respectively; 0.58 is the conservative central
  estimate).
- Ahn et al. 2002, *Anisotropic material properties of fused deposition modeling
  ABS plastic*, Rapid Prototyping J. 8(4) — `G_xz/G_xy`, and the bead-ply basis of
  the CLT path.
- Casavola et al. 2016 — `ν_xz`, `G_xz/G_xy`.
- Farashi & Vafaee 2022 (meta-analysis, 131 samples); Szust & Adamski 2022;
  Vidakis et al. 2022 — the layer-height effect on Z strength.
- Wang et al. 2020 — PLA fatigue behaviour under cyclic loading; the
  orientation-dependent endurance ratio.
- Birosz et al. 2022 — FDM infill/anisotropy characterization.

**Cellular solids and composites**

- Gibson, L.J. & Ashby, M.F. *Cellular Solids: Structure and Properties*, 2nd ed.,
  CUP 1997 — the power-law stiffness and strength scaling of the homogenized
  infill core, and the exponent ranges its LOW-confidence defaults sit inside.
- Deshpande, V.S. & Fleck, N.A. *Isotropic constitutive models for metallic
  foams.* J. Mech. Phys. Solids 48:1253–1283, 2000 — the pressure-sensitive yield
  surface and `α ≈ 2.08`.
- Jones, R.M. *Mechanics of Composite Materials*, 2nd ed., 1999, §2 & §4 —
  Classical Laminate Theory.

**Numerics and geometry**

- Saad, Y. *Iterative Methods for Sparse Linear Systems*, §6.7 — PCG.
- Bathe, K.-J. *Finite Element Procedures* — subspace iteration for the modal
  eigenproblem.
- Ericson, C. *Real-Time Collision Detection*, §5.1.5 — the point-to-triangle
  closest-point kernel behind the two-region distance field, the symmetry
  verification sweep, and the contact-patch centre snap.
- Shigley/Juvinall, standard machine-design formulations — net-section tension,
  shear-out, thread engagement, and the Goodman/Basquin fatigue relations.
