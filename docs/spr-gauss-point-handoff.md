# Gauss-point SPR sampling for C3D10 — RESOLVED

**Status:** done. Landed as issue #158. This document is kept as the record of
what was measured, including where the original diagnosis was wrong.

**Origin:** found while investigating the "ZZ global relative error reads
implausibly high on a real part" brief. That brief's headline defect (SPR
blowing up at rank-deficient patches) was fixed first; this was the residue.

---

## Result

| mesh | elements | ‖u_h − u_exact‖∞ / ‖u‖∞ | η before | η after |
|------|----------|--------------------------|----------|---------|
| C3D10 4³ |   384 | 8.2e-14 | 1.46 %  | **3.2e-13** |
| C3D10 6³ | 1 296 | 1.4e-13 | 0.53 %  | **4.9e-13** |
| C3D10 8³ | 3 072 | 2.2e-13 | 0.26 %  | **7.0e-13** |

On a manufactured field a C3D10 mesh reproduces exactly, the reported error is
now round-off that tracks the CG solution error, not a quantity that merely
shrinks with `h`. Locked by solver_validation `[33.2]`.

Effectivity index θ = η / ‖σ_exact − σ_h‖, on manufactured solutions C3D10
*cannot* represent (so there is real discretization error to measure against):

| fixture | before | after |
|---------|--------|-------|
| structured box, cubic u / quadratic σ, div 3→4→6→8 | 2.81 → 2.85 → 2.84 → 2.81 | **1.68 → 1.64 → 1.57 → 1.53** |
| structured box, quartic u / cubic σ, div 3→8 | 2.34 → 2.50 → 2.61 → 2.64 | **1.61 → 1.67 → 1.67 → 1.64** |
| TetGen cube, cubic u, 122 → 576 elements | 1.74 → 1.78 | **1.38 → 1.22** |

The estimator was **not** asymptotically exact on C3D10 before: θ sat flat near
2.8, and on the quartic fixture it moved *away* from 1 under refinement. It now
decreases monotonically toward 1 from the conservative (θ > 1) side.

**Honest limitation.** θ ≈ 1.5 on the structured box is still outside the
classic [0.7, 1.3] effectivity window that group 30 holds the C3D4 path to. The
unstructured TetGen fixture does reach 1.22. What is locked (`[33.5]`) is the
direction, the monotone trend and a ceiling of 2.0 — not membership in the
classic band.

---

## The diagnosis, corrected

The original handoff claimed the floor came from averaging away each element's
*within-element* stress variation: `σ_h` carries it, `σ*` could not, so the
difference was O(h·|∇σ|) regardless of discretization error.

**That is not what the floor was**, at least not on the fixture that measured
it. Three measurements on the 4³ case say so:

- the element-averaged stress matched `α·z_centroid` to **3.0e-12** — for a
  linear σ field the four-Gauss-point average lands exactly on the centroid
  value, so nothing was lost by averaging;
- **interior** corner nodes recovered exactly (max deviation 8.4e-13);
- exactly **46 nodes** deviated, at *every* refinement level — the 8 box corners
  plus the midside nodes interpolated from them — and **19 elements** carried
  90 % of the error energy, again at every level.

The real cause is patch **rank**, not sampling resolution. With one sample per
element, a nodal patch at a convex corner of the model holds 2–6 points; a 3-D
linear fit needs 4 and wants more for conditioning. Those patches failed the
rank/amplification guard and fell back to plain averaging — and averaging over a
one-sided patch is biased by O(h·|∇σ|) *even when the FE solution is exact*.
The nodal deviation scaled exactly as h (1.25 → 0.833 → 0.625) over a fixed set
of elements whose volume scales as h³, giving η ∝ h^2.5 — which is precisely the
observed 1.46 → 0.53 → 0.26 %.

Gauss sampling fixes this because it multiplies the sample count by 4 *and*
spreads the samples through each tet's interior, so the same 2-element corner
patch becomes an 8-point cloud that genuinely spans 3-D. Measured: under
centroid sampling, 6 of 343 corner patches on the structured box and 28 of 792
on a TetGen cylinder were rank-deficient; under Gauss sampling with the linear
basis, **zero** were, on either mesh.

The original "within-element variation" mechanism is real too — it is what the
quadratic basis addresses, and it is why θ improved on the *cubic* MMS where the
field genuinely varies inside each element. But it was not the cause of the
exactly-representable-field floor.

---

## What changed

1. **`buildGaussSamples`** (`stress.ts:735`) — evaluates σ = C·B·u at all four
   C3D10 Gauss points and keeps them, with each point's physical position from
   the isoparametric map, and |detJ|·w. `recoverElementStress` is untouched:
   `elemStress6` is still the four-point average, because the criterion, safety
   factor and per-element heatmap all legitimately want one value per element.
2. **SPR fits sample sets, not element centroids.** `buildSprPatchFit` and
   `solveSprValueAtNode` take an `SprSamples` and a term count.
   `buildCentroidSamples` reproduces the legacy one-sample-per-element shape, so
   C3D4 and every caller that passes no samples is bit-identical.
3. **Quadratic recovery basis** for C3D10 (10 terms), matching the element
   order. It cascades: quadratic → linear → averaging, so a patch that cannot
   support 10 terms gets a linear fit on the same Gauss cloud rather than
   dropping straight to an average.
4. **`computeZZErrorEstimate` reuses the samples** as σ_h in its energy loop
   instead of rebuilding B per Gauss point.

### Item 4 of the original plan — measured, and the answer was "keep it"

The question was whether midside nodes still need interpolating from their
corners once each element contributes 4 samples. They do. Amplification G at
midside nodes under the quadratic basis: median 2.2e8 on the structured box,
outright rank-deficient at 913 of 1854 midside nodes there and 946 of 4245 on a
TetGen cylinder. A ring of tets around one edge is not a 3-D neighbourhood
however densely each tet is sampled. A *linear* midside fit would be well posed
(max G 2.45) but is a step down in order from interpolating between two
quadratic-recovered corners.

---

## Cost — measured

Structured C3D10 box, recovery + estimator stage only, 3 runs averaged:

| mesh | elements | ZZ stage before | after | per element |
|------|----------|-----------------|-------|-------------|
| 10³ |  6 000 | 140 ms | 219 ms | 23.3 → 36.5 µs |
| 16³ | 24 576 | 525 ms | 884 ms | 21.4 → 36.0 µs |
| 22³ | 63 888 | 1 563 ms | 2 437 ms | 24.5 → 38.1 µs |

`recoverElementStress` is unchanged (384 → 384 ms at 16³). Heap is flat.

**~1.6×, not the ~10× that 4× the samples with a 10-term basis suggests.** Two
reasons: the normal matrix is still built once per node and amortised across all
six components, and the estimator's energy loop no longer rebuilds B — it reads
σ_h back from the samples. For context, `runLinearStatic` on the 16³ mesh takes
6 585 ms, so the ZZ stage goes from 8.0 % to 13.4 % of solve time.

The amplification budget for the quadratic basis (`SPR_MAX_AMPLIFICATION_QUADRATIC
= 60`) is deliberately not a sensitive knob: sweeping it from 8 to 1e6 moves θ
only in the third decimal, because a rejected quadratic fit falls to a linear
fit on the same Gauss cloud rather than to averaging.

---

## Effect on the adaptive loop — measured, and `targetGlobalError` stays at 3%

The motivation for doing this work at all was that `DEFAULT_LOOP_OPTIONS
.targetGlobalError` is 3% while the coarse-tier floor was ~1.5%, so up to half
the target could be artifact and the loop could spend iterations chasing error
that does not exist. That reasoning came from the *smooth manufactured* fixture.
Measured on a real part it is largely beside the point, so **the 3% target is
unchanged** — see below for why.

Fixture: the Ø5-bore tube from `adaptive-benchmark.test.ts` (bolt-constrained
bore, 50 N transverse), coarse tier, C3D10, default loop options.

| | before | after |
|---|--------|-------|
| tier (iteration 1) error | 22.80 % | **19.37 %** |
| final error | 12.57 % | **11.14 %** |
| solves | 5 | **4** |
| stop reason | `max-iterations` | `stalled` |
| final elements | 82 685 | **80 866** |

So on this part the change is a real if modest win: one fewer solve of an
~80 k-element mesh, reaching a *lower* final error with *fewer* elements, and
terminating on diminishing returns rather than running out of its iteration
budget.

**Where the loop aims its refinement barely moved, and that is correct.** The
per-element field drives `buildSizeField`, so it decides where elements get
spent. By region, on the 13 340-element tier mesh:

| region | share before | share after | absolute η² before | after | change |
|--------|--------------|-------------|--------------------|-------|--------|
| rim (sharp circular edge) | 31.7 % | 33.2 % | 164.8 | 124.6 | −24 % |
| outer wall | 27.1 % | 29.7 % | 140.9 | 111.4 | −21 % |
| interior | 21.0 % | 19.6 % | 109.2 | 73.5 | −33 % |
| bore wall (real concentrator) | 20.1 % | 17.6 % | 104.5 | 66.0 | −37 % |

Read the SHARES alone and it looks like the rim gained and the real
concentrator lost, which would be a regression. It is not: the global error
fell at the same time, so every region's ABSOLUTE estimate dropped. The rim
dropped *least*, which is why its share rose — the residue there is real error
the recovery fix cannot remove, while smoother regions carried more of the
removable artifact.

### What the residual error actually is — it is the BOUNDARY CONDITION, not geometry

An earlier revision of this section attributed that residue to the tube's sharp
rim, calling it a geometric stress singularity. **That was wrong**, and the
correction matters because it points at a different lever.

A sharp edge is only singular when the material wedge is RE-ENTRANT (> 180°).
The tube's rim is a 90° CONVEX wedge between two traction-free faces, which is
bounded. Measured under UNIFORM refinement (clamp on the whole bore, consistent
traction over the whole outer wall so the load has no patch edge, so the only
BC discontinuity is where the clamp meets the free end faces):

| region (fixed geometric band) | 6 763 el | 7 608 el | 15 382 el | 19 308 el |
|---|---|---|---|---|
| bore rim — clamp meets free face | 20.1 % | 23.2 % | 26.0 % | **27.7 %** |
| outer rim — pure 90° geometry | 0.2 % | 0.4 % | 0.3 % | **0.4 %** |
| bore wall — the clamped surface | 32.0 % | 35.6 % | 39.6 % | **47.7 %** |
| outer wall | 0.4 % | 0.5 % | 1.8 % | 1.2 % |
| end face | 9.6 % | 7.9 % | 8.1 % | 7.0 % |
| interior | 37.7 % | 32.4 % | 24.1 % | **16.0 %** |

The bands are FIXED volumes, so a growing share is genuine concentration, not a
binning artifact. The pure-geometry rim carries ~0.3 % and is flat: not
singular, exactly as theory says. The CLAMPED boundary and its edge grow from
52 % to 75 % of the error energy, while the smooth interior collapses from 38 %
to 16 %. Global convergence over the ladder is rate **0.61** against the
smooth-C3D10 expectation of 2.0; restricted to elements away from the clamp it
is **1.56**, 2.6× better. (The intermediate rates are erratic because TetGen's
element count responds non-monotonically to `-a` — the same effect
`adaptive-benchmark.test.ts` documents in its `UNIFORM_VOLUME_LADDER` comment;
only the whole-ladder rates are quoted here.)

So the residual error is dominated by the **rigid-clamp idealization** — a
modelling choice, not physics and not geometry. Refining into it never
converges, which is precisely why the adaptive loop stalls.

**Why the 3% target is still not worth re-tuning.** On this part the loop
stalls at 11 %, nowhere near 3 %, because of that BC singularity.
`targetGlobalError` is not the binding constraint — `stalled` and
`max-iterations` are — so any other value would have produced the same run.
The `SingularityRegion` exclusion in `buildSizeField` (`opts.singularities`) is
the right mechanism, but it must be fed the CONSTRAINT and LOAD boundaries, not
the part's sharp edges.

That has since been built — see **`docs/bc-singularity-exclusion.md`**. Read it
before assuming it solved the problem: it stops the loop stalling and moves the
tube from 11.14% to 10.23%, which is real but modest, and it CANNOT approach 3%
on its own. Excluding a region from refinement while still counting it in the
reported error puts a floor under the reported number — measured at ~5% on that
fixture (the masked band carries 23.8% of the error ENERGY, not the ~75% an
earlier revision of this file claimed; see the correction in that doc). Closing
the remaining gap is a reporting change, not a solver change.

Caveat: one fixture. The one-fewer-solve result in particular turns on a stop
reason flipping from `max-iterations` to `stalled`, which is not a robust
general claim.

## Not done (deliberate scope holds)

- **`sprSmoothedStress` (scalar von Mises) still uses centroid sampling.** It
  feeds the display heatmap. Von Mises is a nonlinear functional of σ, so
  Gauss-sampling it is a different operation from Gauss-sampling the tensor, and
  it would move every heatmap value. Unchanged, and bit-identical.
- **`analysis.ts`'s nodal-utilization `sprSmoothedStress6` call** (the per-node
  U_XY / U_Z display field) still passes no samples, so it keeps the legacy
  recovery. Upgrading it would change user-facing numbers with no lock demanding
  it. This is the obvious next candidate if the display field is ever revisited.

## Locks

- `server/tests/solver_validation.ts` group 33 — `[33.2]` the exactness floor
  (fails on the old path at η = 1.462e-2 / 5.304e-3), `[33.5]` the effectivity
  trend (fails on the old path at θ = 2.8128 → 2.8501 → 2.8363).
- `server/tests/unit/spr-gauss-sampling.test.ts` — the sampler's contract, the
  linear-exactness-at-box-corners claim, and quadratic exactness at interior
  nodes. Mutation-checked: forcing the linear basis fails the quadratic test;
  ignoring the passed samples fails three; averaging the samples fails the
  within-element-variation test.
- Unchanged and still green: solver_validation groups 4, 20, 30, 31 and
  `server/tests/unit/spr-midside-recovery.test.ts`.
