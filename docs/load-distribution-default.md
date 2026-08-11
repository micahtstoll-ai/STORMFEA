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
`ForceSpec.position`, on the surface that point lies on. (It was originally
"restricted to surfaces facing the load"; that rule was wrong and was replaced —
see [The surface the patch acts on](#the-surface-the-patch-acts-on-issue-305)
below.)

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

## The surface the patch acts on (issue #305)

The mode shipped selecting its surface from the load DIRECTION: only triangles
with `n·d > 0` were eligible — the same test `selectPressureRegion('facing')`
uses, and the rule every legacy mode follows. On this mode that is wrong, and
wrong in the case it is named after.

**A contact pushes.** At the surface it presses on, the force points INTO the
material, so `n·d < 0` there. The eligibility test therefore excluded the
surface under the user's arrow on every compressive load and left only the far
side of the part — a full thickness away, outside the patch radius. The taper
then selected nothing, and the "patch fell between the triangles" fallback put
the ENTIRE force onto ONE triangle of the opposite face, chosen by index among
tied candidates.

So on the default path, a 120 N push placed on the top of a bar was applied as
a point load on the bottom. Measured on the #296 bar (24 x 12 x 6, 384 C3D10
elements, load at `[24, 6, 6]` in `-z`, default 2.75 mm radius):

| | before | after |
|---|---|---|
| loaded triangles | **1** | 8 |
| face loaded | z = 0 (the far one) | z = 6 and the end face — where the point is |
| SPR nodal VM mirror asymmetry | **5.0441 %** | **0.0000 %** |
| σ₁ / σ₃ asymmetry | 6.4493 % / 2.5654 % | 0.0000 % / 0.0000 % |
| max displacement | 0.57431 mm | 0.55648 mm |

The asymmetry was #305's filed symptom, and it is a symptom of the fallback,
not of a rim tie-break as the issue guessed: a single triangle cannot be
mirror-symmetric, so a symmetric part with the load exactly ON its symmetry
plane came back asymmetric. The mesh was not at fault — 100 % of its element
centroids have a mirror partner (#296).

### The rule now

The patch grows from the triangle nearest `position` by EDGE ADJACENCY,
admitting neighbours while they are inside the radius. `direction` selects no
face at all; it only has to be non-zero. A push and a pull at the same point
produce the same patch with opposite sign, which is correct — whether a load is
contact or a bolted pad in tension is the sign of the force, not a property of
the surface.

What still must not happen is the patch reaching THROUGH the part onto the far
face: a 3-D ball centred on a thin part's top face contains most of its bottom
face. Adjacency is what stops it, and it is worth saying why it is better than
the obvious alternatives. A same-side-as-the-anchor normal test needs a
tolerance, and no tolerance is right for both a thin plate (where the far face
is a millimetre away) and a tight bore (where the near surface curves away from
its own tangent plane by `r²/2R` across the patch). Adjacency needs none: the
far face is not edge-connected to the near one except around the part's rim, so
it is excluded exactly when the rim is further away than the radius and
included exactly when the contact really does wrap an edge. Measured on the
same bar with a 6 mm radius against a 6 mm thickness — a ball that reaches the
far face outright — the patch stays entirely on the placed face.

A normal-test would also have needed a tie-break to pick its anchor, and
resolving a tie by triangle index is what produced this bug. The connected
component of a disc is independent of traversal order, so nothing about the
result depends on triangle numbering.

Two smaller things came with it:

- **The under-resolved fallback loads every TIED nearest triangle**, not the
  first one found. It is still reached only when the radius is below the local
  mesh size, but when it is reached it is now symmetric.
- **`centreSnapMm` is a true point-to-triangle distance**, not point-to-centroid.
  The old measure aliased the element size: a point sitting exactly on a coarse
  face reported itself 2.24 mm off the surface against a 2.75 mm radius, and
  `analysis.ts` warns the user when that number exceeds the radius. It now
  reports 0.000 mm for a point on the surface. Same aliasing CLAUDE.md's
  two-region invariant 4 exists to prevent in the distance field.

### What it costs on the benchmark fixture, and why

The Ø5-bore tube's own application point, `(6, 0, 5)`, is exactly ON the outer
top rim — a sharp 90° edge. The old rule could not load the top annulus there
(its normal is perpendicular to the load, so `n·d = 0` failed the test); the
new one wraps onto it, because the point is on the edge and a contact at an
edge really does bear on both faces. That moves this fixture's answer, and it
is the largest single consequence of the change:

| elements | old peak | new peak | old SF | new SF |
|---|---|---|---|---|
| 20 291 | 28.642 MPa | **37.473 MPa** | 1.75 | **1.33** |
| 54 373 | 29.312 MPa | **42.566 MPa** | 1.71 | **1.17** |
| ~79 000 | 29.257 MPa | **43.380 MPa** | 1.71 | **1.15** |
| **spread** | 2.3 % | **15.7 %** | | |

(The old rows are this document's own table above, re-listed for the three
rungs measured here; the last new row is 79 710 elements against the old
76 898 — TetGen's count is not reproducible to the element across runs.)

Two honest readings, and both belong here:

- **More conservative, which is the safe direction.** The load is now applied
  where the arrow was placed, over both faces the contact touches, and the
  governing peak lands inside the patch on the top annulus 0.4-0.7 mm from the
  application point. A tool that reports an optimistic safety factor is the
  dangerous failure; this moves the other way.
- **Less mesh-stable on this fixture, and that is a genuine loss.** 3.6% spread
  was #271's headline improvement. It is not lost in general: moving the SAME
  load off the rim to mid-height on the outer wall — no edge, no wrap — the
  peak goes 10.999 MPa at 20 291 elements to 11.503 MPa at 79 710, **4.6%
  across a 4x element range**, with the peak in the same place relative to the
  patch. The instability is specific to a load point placed ON a sharp edge,
  where the traction acts across the corner, and it is not something the patch
  rule can smooth away: it is what a distributed load at a rim does.

Tracked as **#308** — the options are a geodesic taper (which would actually
restore the spread), flagging an edge-spanning patch on the existing
reliability banner, or deciding this is simply what a load at a corner does.

Neither number is evidence about which idealization is closer to a real
contact. What can be said is that the previous behaviour was not an
idealization at all: it applied the load to a face the part is not touched on.

### What this does not settle

The radius is still `CONTACT_PATCH_RADIUS_FRACTION`, still a judgement, and now
that the patch lands on the correct face it is doing MORE of the work than it
was — a wrong-face point load did not depend on it at all. The guidance above
stands, more strongly: pass `loadPatchRadiusMm`.

## What is still open

- **The default radius has no calibration behind it.** Parts with known contact
  geometry would fix that. Until then it is a conservative placeholder.
- ~~`cause: "load-point"` is still misnamed~~ — renamed to `load-edge`, since
  what is singular there is the rim of the loaded patch and never a point.
- **One fixture.** The tube is the only part in the suite whose forces route
  through this path with a meaningful stress concentration; the cross plate uses
  a pressure load and is unaffected. A second force-loaded fixture would be
  worth having before treating the 5.9x as characteristic rather than specific.
