# Handoff — Gauss-point SPR sampling for C3D10

**Status:** open, not urgent. This is an accuracy limit, not a defect: the
estimator over-reports error, so it errs conservative.

**Origin:** found while investigating the "ZZ global relative error reads
implausibly high on a real part" brief. That brief's headline defect (SPR
blowing up at rank-deficient patches) is fixed; this is the residue left behind,
and it shrank substantially when that fix landed — see *Current magnitude*.

---

## The claim in one line

On a C3D10 mesh the ZZ error estimate has a floor that is unrelated to the
actual discretization error, because the recovered field `σ*` is built from ONE
stress sample per element while the element's real stress varies linearly
within it.

## Why the floor exists

`recoverElementStress` (`server/solver/stress.ts:351`) already does the
expensive and correct thing for C3D10: it evaluates `σ = C·B·u` at all four
Gauss points, which are the superconvergent sampling locations for a quadratic
tet. It then **averages the four into a single Voigt6 per element** and returns
that as `elemStress6`.

Everything downstream sees only the average:

- `sprSmoothedStress6` (`stress.ts:1027`) fits `σ = a0 + a1x + a2y + a3z` to one
  sample per element, positioned at the element's corner-average centroid.
- `computeZZErrorEstimate` (`stress.ts:1279`) then compares that recovered field
  against `σ_h` recomputed **per Gauss point**.

So the two sides of `η = ‖σ* − σ_h‖` are sampled asymmetrically: `σ_h` carries
the element's within-element linear variation, `σ*` cannot, because the data it
was built from had that variation averaged away. The difference between them is
O(h·|∇σ|) whether or not the solution has any discretization error at all.

Note this is NOT a wrong sampling *location* — the roadmap's "4-point Gauss
integration with Gauss-point stress recovery" is accurate about where the stress
is evaluated. The per-point values are computed and then discarded.

## Current magnitude (measure before prioritising)

Fixture: the group-30 manufactured solution (pure bending, `σ_xx = α·z`), which
is a QUADRATIC displacement field. A C3D10 mesh represents it exactly, so with
`u_exact` prescribed on the whole boundary the FE solution is exact to CG
tolerance and the true discretization error is ~0. Any reported `η` is therefore
pure estimator artifact.

| mesh | elements | ‖u_h − u_exact‖∞ / ‖u‖∞ | reported η |
|------|----------|--------------------------|------------|
| C3D10 4³ |   384 | 8.2e-14 | **1.46%** |
| C3D10 6³ | 1 296 | 1.4e-13 | **0.53%** |
| C3D10 8³ | 3 072 | 2.2e-13 | **0.26%** |

The effectivity index θ = η / ‖σ_exact − σ_h‖ is unbounded in this limit
(finite numerator, ~zero denominator), so the estimator is **not asymptotically
exact on C3D10**.

Two caveats that lower the priority:

- The floor decreases at roughly O(h²) and is already small on anything but a
  coarse mesh.
- It shrank by ~3× when the rank-deficient-patch fix landed (it was
  4.06 / 2.30 / 1.52% before). If you find an older note quoting those numbers,
  they are stale.

## Why it is still worth doing

1. `DEFAULT_LOOP_OPTIONS.targetGlobalError` is **3%**
   (`server/solver/adaptiveMesh.ts:439`). At the coarse tier the floor is ~1.5%,
   i.e. up to half the target can be estimator artifact, so the adaptive loop
   can spend refinement iterations chasing error that does not exist.
2. Group 30 — the estimator's only magnitude lock — runs on a **C3D4** box. The
   C3D10 path has no effectivity anchor at all.
3. It is the last known systematic bias in a number shown directly to users.

---

## What to change

**1. Stop discarding the per-point stresses.** Have `recoverElementStress` also
emit the four Gauss-point tensors (`elementCount × 4 × 6`), or add a dedicated
sampler alongside it. Keep `elemStress6` as-is: the criterion, safety factor and
per-element heatmap values all legitimately want one value per element, and
several locks depend on it.

**2. Feed SPR four samples per element, at their real coordinates.** The patch
fit needs each sample's physical position, which is the isoparametric map
`x(ξ) = Σ Nᵢ(ξ)·xᵢ` — `c3d10ShapeFunctions` (`server/solver/element.ts:729`)
already provides `Nᵢ`, and `C3D10_GAUSS` (`element.ts:687`) the `ξ`. Today
`buildSprPatchFit` (`stress.ts:723`) is handed element centroids; it would take
sample points instead.

**3. Raise the recovery basis to match the element order.** SPR's accuracy
argument wants the recovery polynomial to be the same order as the element, so
C3D10 wants the full quadratic (10 terms: 1, x, y, z, x², y², z², xy, yz, zx),
not the current linear 4. With 4 samples per element and ~20 elements in a
corner patch that is ~80 samples for 10 unknowns — comfortably determined. C3D4
should keep the linear basis.

**4. Re-examine the midside treatment — measure, do not assume.** Midside nodes
are currently interpolated from their two corners
(`interpolateMidsideFromCorners`, `stress.ts:895`) because an edge-ring patch
with one sample per element is rank deficient along the edge. With four samples
spread through each tet's interior the ring's sample cloud genuinely spans 3-D,
so a direct midside fit may become well posed. The amplification metric already
in the code (`SPR_MAX_AMPLIFICATION`, `stress.ts:716`) is exactly the instrument
for deciding this: measure G at midside nodes under the new sampling before
changing the behaviour. If G stays high, keep the interpolation — it is
unconditionally well posed and costs nothing.

---

## Validation this change needs

**The important one:** group 30's MMS fixture **cannot** validate C3D10, and
naively pointing it at a C3D10 mesh will produce a meaningless or divide-by-zero
effectivity index. Its exact solution is quadratic, which C3D10 reproduces
exactly, so the true error is ~0 and θ = η/0. A C3D10 effectivity test needs a
**cubic or higher** manufactured solution, so that there is real,
refinement-converging discretization error to measure the estimate against.
Pick the field so it stays self-equilibrated (`div σ = 0`) if you want to keep
the zero-body-force setup that makes group 30 cheap.

**The regression lock this work should produce:** the table above, inverted.
With Gauss-point sampling and a quadratic basis, η on an exactly-representable
quadratic field should collapse toward machine zero rather than merely
decreasing with h. That is a sharp, cheap, unambiguous test.

**Existing locks to re-check** (all currently green, all constrain SPR):

- solver_validation group 20 — SPR reproduces a linear field exactly. A
  quadratic basis contains the linear space, so this should still hold; if it
  does not, the fit is being solved wrong.
- solver_validation group 31 — boundary-patch conditioning (issue #156).
- solver_validation group 4 — SPR smoothing behaviour.
- `server/tests/unit/spr-midside-recovery.test.ts` — boundedness and the
  midside-between-corners invariant. Item 4 above may legitimately change the
  latter; if so, replace it with the equivalent boundedness claim rather than
  deleting it.

**Cost.** Patch assembly goes from n samples to 4n, and the normal matrix from
4×4 to 10×10, for every node × 6 components. `sprSmoothedStress6` is already a
measurable share of recovery time on large meshes — profile it. The current
`buildSprPatchFit` amortises the matrix across the 6 components, which is worth
preserving.

---

## Files

| file | what lives there |
|------|------------------|
| `server/solver/stress.ts:351` | `recoverElementStress` — the Gauss loop that currently averages |
| `server/solver/stress.ts:716` | `SPR_MAX_AMPLIFICATION` — patch-conditioning guard |
| `server/solver/stress.ts:723` | `buildSprPatchFit` — patch geometry + rank verdict |
| `server/solver/stress.ts:895` | `interpolateMidsideFromCorners` |
| `server/solver/stress.ts:939` | `sprSmoothedStress` (scalar von Mises, feeds the heatmap) |
| `server/solver/stress.ts:1027` | `sprSmoothedStress6` (tensor, feeds the estimator) |
| `server/solver/stress.ts:1279` | `computeZZErrorEstimate` |
| `server/solver/element.ts:687` | `C3D10_GAUSS` |
| `server/solver/element.ts:729` | `c3d10ShapeFunctions` |
| `server/solver/element.ts:781` | `buildB_c3d10` |
| `server/solver/adaptiveMesh.ts:439` | `DEFAULT_LOOP_OPTIONS` (the 3% target) |

Line numbers are a convenience, not a contract — search the symbol if they have
drifted.
