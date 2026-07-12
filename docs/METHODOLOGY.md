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
around a 0.2 mm baseline (Farashi & Vafaee 2022).

**Infill & pattern.** Effective properties are scaled by infill fraction and
pattern (gyroid degrades less than rectilinear at equal infill). Wall/bead
contributions can be added via Classical Laminate Theory (`solver/laminate.ts`).

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
- **Shell** carries solid-material properties (calibrated coupon values flow to
  it unchanged); **core** carries wall-free lattice properties from
  Gibson-Ashby power laws in relative density (`solver/lattice.ts`), applied as
  PER-AXIS scale factors on the solid's natural-frame constants
  (`buildCoreMaterial` in `analysis.ts`): stiffness `g(ρ) = ρⁿ·(1 − c(1−ρ))`
  per axis and strength `s(ρ) = min(1, patternMul·ρᵐ)` — near zero at 0%
  infill (floored at 10⁻³×solid; the legacy curve's 0.30 intercept represents
  the walls and is not reused). Exponents are per pattern family, confidence
  LOW, regression-locked, calibration-overridable (an override routes to a
  single scalar law — one fitted exponent can't say which axis it belongs to):

  | Family | Patterns | n in-plane (c) | n through-layer (c) | n G_xz (c) | n G_xy | Strength m |
  |---|---|---|---|---|---|---|
  | TPMS-like 3-D | gyroid, cubic, adaptive | 1.75 (0.12) | 2.1 (0.18) | 2.3 (0.22) | derived | 1.25 (stretch-dominated) |
  | extruded walls | grid, lines, honeycomb, trihexagon, concentric | 2.0 (0.10) | 1.0 (rule of mixtures) | 1.5 (0.10) | 3.0 (honeycomb bending) | 1.5 (bending-dominated) |
  | sparse | lightning | 2.0 ×0.3 prefactor | 2.0 | 2.0 | derived | 1.5 |

  Extruded-wall infill is continuous along the build axis, so its through-layer
  law is the mildest and the core's anisotropy INVERTS at low density (E_z >
  E_xy). Because ν_zx = ν_xz·E_z/E_xy would then exceed the thermodynamic
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
  criterion remains deviatoric (Hill) — a Deshpande–Fleck–Ashby
  pressure-dependent lattice criterion is a planned follow-up.

**Print orientation (weak-axis rotation).** The weak (through-layer) axis is the
FDM layer normal. **C** is built in the material's local frame (weak along local
Z) and then rotated so that local Z aligns with the part's actual layer normal —
an exact 90°/arbitrary **Bond transform** implemented as a 4th-order tensor
rotation (`rotateC6` / `rotationAligningZTo` in `solver/element.ts`), driven by
the `weakAxis` field on the material. When a **bed face is picked** the client
sends that layer normal (`layerNormal`), so flat, **upright**, and angled prints
are all handled exactly — the Hill criterion (below) is likewise evaluated in the
rotated frame. Flat prints have `weakAxis = +Z`, i.e. the identity, so the
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

### Hill (1948) anisotropic yield

The isotropic **von Mises** equivalent stress is

```
σ_vm = √( ½[(σxx−σyy)² + (σyy−σzz)² + (σzz−σxx)² + 6(τxy² + τyz² + τxz²)] )
```

STORMFEA instead uses the **Hill (1948)** quadratic yield criterion
(`hillEquivalentStress` in `solver/stress.ts`), specialized to a transversely
isotropic part with in-layer yield `Y` and through-layer yield `Z`. The
through-layer normal term carries a `(Y/Z)²` amplifier, so a load pushing across
the layers is correctly magnified. The safety factor is

```
SF = Y / σ_Hill
```

When `Y = Z`, Hill reduces **exactly** to von Mises — verified at the isotropic
limit by the validation suite. The critical FTC case is a **flat print loaded
through the layers**: `σ_zz` dominates, the amplifier bites, and a part that looks
safe under von Mises drops to `SF ≈ Y/Z ≈ 0.58`. The result summary reports both
the Hill SF and the von Mises SF for comparison.

### Five bolt-region failure modes

Beyond bulk yielding, `server/analysis.ts` checks the mechanical failure modes
around bolted holes, each with an individual confidence level:

1. **Bulk yield** — Hill SF over the volume.
2. **Net-section tension** — tension across the reduced section through a hole.
3. **Shear-out** — the bolt tearing out toward a free edge.
4. **Thread strip-out** — threaded-engagement failure.
5. **Bearing (hole wall)** — crushing at the hole wall (confidence: LOW — no
   FDM-specific bearing data in literature).

The governing (lowest-SF) mode drives the overall verdict.

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
(the same LOW→MEDIUM data gate the bearing coupon uses).

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
printing three standard coupons on their own printer/filament, pulling them to
failure, and entering the loads (`POST /api/calibration/*`):

| Coupon | Measures | Derivation |
|--------|----------|------------|
| Tensile dog-bone | `yield_XY`, `E_xy` | F/A at fracture; stress/strain at yield |
| Lap-shear plate | `yield_Z` (via inter-layer shear) | F/(w·l) → shear → `yield_Z` |
| Bearing plate | bearing strength | F/(d·t), corrected by Kt from FEA |

The **lap-shear coupon** directly measures inter-layer bond strength — the single
most influential variable in the model. Lap-shear and bearing joints concentrate
stress beyond nominal F/A, so `POST /api/calibration/kt` runs FEA on the coupon
geometry to recover the stress-concentration factor Kt and correct the derived
strength.

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
- **Hill criterion** — reproduces von Mises at the isotropic limit; in-plane
  uniaxial yields exactly at `Y_xy`; the false-safety case (flat print,
  through-layer load) detects `SF ≈ 0.58` — the core engineering claim.
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
