# The default load distribution changed to `contact_patch`

**Status:** landed. This is a deliberate change to the answer for every force
that does not name a distribution — including every force the client has ever
sent. It is not a refactor, and the deltas below are large.

Follow-up to #260 (the load-spreading lever) and #271 (`ForceSpec.position` was
never read). Those issues added `tapered_patch` and `contact_patch` as opt-in
modes; this makes the second one the default.

---

## What changed

`DEFAULT_LOAD_DISTRIBUTION = 'contact_patch'` (`server/analysis.ts`). An absent
`loadDistribution` now means: apply the load over a tapered disc centred on
`ForceSpec.position`, restricted to surfaces facing the load.

It used to mean: find the extreme face along `direction`, take every node within
a hard 0.5 mm of it, and split the load between them — ignoring `position`
entirely.

**The previous behaviour is still reachable**, exactly, via
`loadDistribution: 'uniform'`. That reproduces the old absent-field cascade
including the near-hole linear taper, and it is locked by
`load-distribution-default.test.ts`.

## Why

Three defects in the old default, all measured:

1. **It discarded the application point.** Four positions on the Ø5-bore tube —
   including one on the opposite side of the part and one inside the bore —
   produced results identical to nine decimal places (#271).
2. **The patch had a hard rim**, so the model contained a load singularity whose
   peak stress does not converge. Across a 5.3x element range the safety factor
   swung 26.6% non-monotonically (#260).
3. **The 0.5 mm band was absolute**, so the same part at two scales got a
   different load idealization — the defect #168 fixed for mesh density.

## The measured delta

Ø5-bore tube (`adaptive-benchmark.test.ts` fixture), 50 N in +x at the fixture's
own stated application point (6, 0, 5), five shared meshes:

| elements | legacy SF | new SF | legacy peak | new peak |
|---|---|---|---|---|
| 14 408 | 10.43 | **1.77** | 4.793 MPa | **28.287 MPa** |
| 20 291 | 12.80 | **1.75** | 3.908 MPa | **28.642 MPa** |
| 24 182 | 11.11 | **1.75** | 4.500 MPa | **28.602 MPa** |
| 54 373 | 12.61 | **1.71** | 3.966 MPa | **29.312 MPa** |
| 76 898 | 10.10 | **1.71** | 4.948 MPa | **29.257 MPa** |
| **spread** | **26.6 %** | **3.6 %** | | |

Two things happened at once and they must not be conflated.

**The number got much more stable.** 26.6% → 3.6% across the ladder. That is the
improvement, and it is real: the peak no longer sits on a patch rim that never
converges.

**The number also got about 5.9x more conservative.** SF 10.4 → 1.8 on this part
is the difference between "comfortably safe" and "marginal". That is NOT a
convergence effect — it is the load model. The old default smeared 50 N over the
whole ~12 mm² extreme-face band; the new one concentrates it into a ~3.5 mm
diameter contact at a free rim, where roughly half the disc falls off the part.
Same resultant, ~6x the local traction.

### Which one is right depends on a number nobody has measured

If the load really is transmitted through a small pad at that point, 28 MPa is
right and the old 4.8 MPa was a 6x under-prediction — optimistic, in a
structural tool, which is the dangerous direction. If the load is genuinely
carried by the whole face, the old model was closer and the new default
over-predicts.

The default radius — `CONTACT_PATCH_RADIUS_FRACTION`, 10% of the bounding-box
diagonal — is a judgement, not a measurement, and it is now load-bearing for
every user who does not override it. Its sensitivity is not small: on this
fixture a 2.2x radius change moved the spread 13.8% → 1.6%, and the stress level
by more than 5x.

**So the practical guidance is: pass `loadPatchRadiusMm`.** That is the number
this model actually wants, and it is the one the user knows and the tool does
not. The default is a placeholder for it, chosen to err conservative.

## Why the test suite did not catch any of this

It cannot, and that is worth stating plainly rather than reading 858 green tests
as endorsement.

- **`solver_validation.ts` never calls `runAnalysis`.** All 187 known-answer
  anchors drive the solver with explicit nodal forces, so they bypass load
  distribution entirely. They are structurally blind to this change — their
  passing is not evidence about it in either direction.
- **The fixtures that do route through the force path assert inequalities**, not
  pinned numbers, deliberately: TetGen's element count is chaotically sensitive
  to its volume cap, so pinned values would be brittle for reasons unrelated to
  the solver. They absorbed a 5.9x move in the safety factor without one
  failure.

`load-distribution-default.test.ts` exists because of that gap. It pins the
semantics — absent means contact_patch, contact_patch respects `position`,
`uniform` still reaches legacy and still ignores `position`, and the two give
materially different answers — through `runAnalysis` on a prebuilt box mesh, so
it needs no TetGen and never skips.

## What is still open

- **The default radius has no calibration behind it.** Parts with known contact
  geometry would fix that. Until then it is a conservative placeholder.
- ~~`cause: "load-point"` is still misnamed~~ — renamed to `load-edge`, since
  what is singular there is the rim of the loaded patch and never a point.
- **One fixture.** The tube is the only part in the suite whose forces route
  through this path with a meaningful stress concentration; the cross plate uses
  a pressure load and is unaffected. A second force-loaded fixture would be
  worth having before treating the 5.9x as characteristic rather than specific.
