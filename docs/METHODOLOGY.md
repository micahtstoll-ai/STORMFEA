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

**Loads (`solver/load.ts`).** Point forces, equivalent nodal tractions (surface
pressure via consistent tributary area), and body forces (self-weight,
acceleration/impact in multiples of *g*) build the right-hand side **f** in
Newtons.

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

A fatigue-life estimate uses the **modified Goodman** relation with an
FDM-specific endurance ratio `Se/UTS = 0.37` (Wang et al. 2020). Confidence is
LOW — FDM S-N data is sparse — so it is reported as an estimate, not a guarantee.

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
