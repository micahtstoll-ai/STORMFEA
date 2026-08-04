# BC-singularity exclusion in the adaptive loop

**Status:** landed, and honest about its limits — it is a real but *modest*
improvement, and on its own it cannot bring a bolt-constrained part near the 3%
`targetGlobalError`. The reason is structural and is spelled out below.

Follow-up to `docs/spr-gauss-point-handoff.md`. That work removed the ZZ
estimator's artifact floor; this addresses what was left, which turned out not
to be an estimator problem at all.

---

## The finding that prompted it

Refining a singularity never converges. A rigid displacement constraint applied
over part of a surface creates one exactly where it stops, and so does the rim
of a loaded patch, where traction jumps to zero. The elements there report large
error at every density, so an equidistribution loop keeps pouring elements into
a region that cannot improve, and stalls short of its target.

Measured on the Ø5-bore tube under UNIFORM refinement (clamp on the whole bore,
consistent traction over the whole outer wall so the load contributes no patch
edge), 6 763 → 19 308 elements:

| region (fixed geometric band) | share of error energy |
|---|---|
| bore rim — clamp meets free face | 20.1 % → **27.7 %** |
| bore wall — the clamped surface | 32.0 % → **47.7 %** |
| outer rim — pure 90° geometry | 0.2 % → **0.4 %** |
| interior | 37.7 % → **16.0 %** |

Global convergence rate 0.61 against the smooth-C3D10 expectation of 2.0; 1.56
when the clamped boundary is excluded from the norm.

**It is not geometry.** The obvious guess — that the sharp rim is a stress
singularity — is wrong, and an earlier revision of the handoff said so
incorrectly. A sharp edge is singular only when the material wedge is
RE-ENTRANT (> 180°); the tube's outer rim is a convex 90° edge between two
traction-free faces, which is bounded, and it carries ~0.3% of the error and
does not grow. What is singular is the BC idealization.

---

## What landed

`bcDiscontinuityMask` (`server/solver/adaptiveMesh.ts`) marks the nodes on the
RIM of each BC patch — constrained node sets and loaded node sets — and dilates
by `BC_SINGULARITY_DILATE_HOPS` rings of mesh adjacency. `buildSizeField` gained
an `excludeNodes` mask that those nodes feed, alongside the existing geometric
`singularities` regions (issue #147), which stay: a region is a geometric ball,
right for a detected corner whose position is known but whose mesh neighbourhood
is not; a mask is a topological set, right for a BC interface, which is defined
by which nodes the BC touched. The mask is also the only shape that stays
O(nodeCount) — the region test is O(nodeCount × regions), fine for a handful of
corners and quadratic for an interface of thousands of nodes.

`runAdaptiveAnalysis` rebuilds the mask after every accepted re-mesh, because
node indices are per-mesh. The BC node sets reach it through
`_captureInternals`.

### The trap, which cost a measurement to find

A BC set is a 2-D patch embedded in a 3-D mesh. In the VOLUME graph almost every
node of the patch has a neighbour just beneath it that is not in the set, so
"has a neighbour outside the set" is true for the WHOLE PATCH, not its rim. The
first implementation did exactly that, masked the entire bore wall, suppressed
refinement so completely that the loop stalled after one step at **18.7%** —
against **11.1%** with no exclusion at all. The fix is to restrict the interface
test to edges whose BOTH endpoints lie on the boundary surface.

`bcDiscontinuityMask` therefore REQUIRES a surface mask and returns an empty
mask without one, rather than guessing. Locked by
"refuses to guess without a surface mask" in `adaptive-mesh.test.ts`, which was
mutation-checked: removing the surface restriction fails it.

---

## What it actually bought

Ø5-bore tube, coarse tier, default loop options:

| | no exclusion | with exclusion |
|---|---|---|
| error | 19.37 % → **11.14 %** | 19.37 % → **10.23 %** |
| iterations | 4 | 5 |
| stop reason | `stalled` | `max-iterations` |
| final elements | 80 866 | 85 075 |
| min safety factor | 8.99 | **5.58** |
| peak von Mises | 5.56 MPa | **8.49 MPa** |

The loop no longer stalls — it makes real progress at every step and runs out of
iterations instead of running out of things it is allowed to improve. But the
gain is **0.9 percentage points for one extra solve**, which is honest to call
modest.

**The safety factor moved 38%.** Peak stress rose 5.56 → 8.49 MPa and minimum SF
fell 8.99 → 5.58 — the CONSERVATIVE direction, which is the acceptable one for
this tool, and all 8 of `adaptive-benchmark.test.ts`'s guards (including "peak
stress at least as high as uniform, within a factor of 2") still pass. The
likely mechanism is that budget freed from the unresolvable rim goes to the bore
wall INTERIOR, which is a real, resolvable bearing concentration that the coarse
mesh was under-reading. That explanation is inferred from where the exclusion
band sits, not directly proven, and it rests on one fixture. Treat a 38% SF
swing between two defensible meshes as evidence that peak stress near a rigid
clamp is not a converged quantity — which is what
`adaptive-benchmark.test.ts`'s "a lower energy-norm error does not certify the
safety factor" already says.

**CI cost.** The benchmark's `beforeAll` now spends the loop's full 5 iterations
instead of stalling at 4, so its budget was raised from 900 s to 1 800 s. That
is the feature working as intended, not a regression, but it is a real cost.

---

## Why this cannot reach 3%, and what would

Excluding a region from REFINEMENT while still counting it in the REPORTED
global error is structurally incoherent. The BC band holds ~75% of the error
energy and is now frozen by construction, so it sets a floor the loop cannot get
below however many elements it spends. That is exactly what the numbers show:
10.23% against a 3% target, with the loop hitting its iteration cap rather than
its accuracy goal.

Getting near 3% needs the reported error split into **resolvable discretization
error** and **irreducible BC-idealization error**, with the loop targeting the
first and reporting the second separately. That is a user-facing contract change
(`docs/API.md`, the DEBUG tab, the methodology PDF), not a solver change, and it
is deliberately not done here. Without it a user reading 10% concludes their
mesh is inadequate, when what is actually crude is the rigid-clamp idealization
of their bolt.

The third option — replacing the rigid clamp with a compliant bearing model —
removes the discontinuity at source and is the only one that reduces the TRUE
error rather than avoiding or re-labelling it. Much larger scope: it would move
every bolt-constrained result the project has validated.
