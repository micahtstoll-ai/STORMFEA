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

**The exclusion is SOFT, which was not obvious and is worth stating.**
`buildSizeField` pins a masked node's target to its current size, but
`smoothSizeFieldGradation` runs afterwards and will pull that target back down
whenever a refining neighbour demands it (`h[i] = h[j] + β·d` fires on the
target node regardless of masking; only the SOURCE of a gradation constraint has
to be refining). So a masked node adjacent to a heavily refined one does still
shrink, the size transition across the band stays bounded by `gradation`, and
"never refine" overstates what actually happens. That is desirable — it is what
stops the mask from carving a size discontinuity into the mesh — but it means
the band is a refinement DAMPER, not a hard freeze.

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

### The safety factor moved 38%, and it is NOT this feature

Peak stress rose 5.56 → 8.49 MPa and minimum SF fell 8.99 → 5.58. That looked
alarming enough to be worth chasing, and two explanations were offered and then
discarded: first that freed budget was resolving a real bearing concentration
(a fine uniform mesh disagreed), then that the mask carved a size discontinuity
(gradation bounds the transition, so it cannot).

The measurement that settled it: run the loop with NO exclusion at all and vary
only `maxElementGrowth`.

| growth | elements | min SF | peak von Mises |
|---|---|---|---|
| 4 | 44 875 | 7.28 | 6.864 MPa |
| 6 | 65 358 | 6.24 | **8.017 MPa** |
| 8 | 80 866 | **8.99** | 5.564 MPa |

Peak stress swings **44%**, non-monotonically, across three defensible meshes of
the same part with this feature switched off entirely. The exclusion run's
5.58 / 8.485 sits inside that spread. **The swing is a property of the part, not
of the feature.**

The real finding is the one that survives: on a part with a rigid-clamp
singularity, peak stress and safety factor are NOT converged quantities, and
element count is not a proxy for their accuracy — the 65 k mesh reports a higher
peak than the 81 k one. `adaptive-benchmark.test.ts` already asserts "a lower
energy-norm error does not certify the safety factor"; this is how emphatically
true that is. Anyone reading a safety factor off a bolt-constrained adaptive run
should treat it as ±40%, and that is a limitation of the idealization rather
than of the mesh or the estimator.

**CI cost.** The benchmark's `beforeAll` now spends the loop's full 5 iterations
instead of stalling at 4, so its budget was raised from 900 s to 1 800 s. That
is the feature working as intended, not a regression, but it is a real cost.

---

## Why this cannot reach 3%, and what would

Excluding a region from REFINEMENT while still counting it in the REPORTED
global error means the excluded band sets a floor under the reported number.

**Correcting an earlier overstatement.** A previous revision put that band at
~75% of the error energy. That figure came from the uniform-refinement study,
where it covered the bore rim PLUS the entire clamped wall. The band the code
actually masks is the rim plus one ring, and `bcSingularityErrorFraction`
measures it directly: **23.8%** with exclusion, 27.7% without. Decomposing the
final 10.23%:

| | total | BC-band component | refinable remainder |
|---|---|---|---|
| with exclusion | 10.23 % | 4.99 % | 8.93 % |
| no exclusion | 11.14 % | 5.86 % | 9.47 % |

So the floor is about **5%**, not "3% is unreachable in principle". Driving the
refinable remainder to zero would still leave ~5%, which is above the 3% target
but far closer than the earlier claim implied. The conclusion survives — this
cannot reach 3% by refinement alone — but the margin is one factor, not three.

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

---

## Caveat on `bcSingularityErrorFraction`: do not compare it across densities

The band is defined TOPOLOGICALLY — the patch rim plus `BC_SINGULARITY_DILATE_HOPS`
rings of mesh adjacency — so it thins geometrically as the mesh refines. Measured
on the same part with no exclusion, at three densities:

| elements | 44 875 | 65 358 | 80 866 |
|---|---|---|---|
| `bcSingularityErrorFraction` | 40.6 % | 33.1 % | 27.7 % |

The falling trend is mostly the band shrinking, not the singularity weakening.
The number is meaningful as "how much of THIS solve's error sits at the BC" and
is the right thing to show a user next to that solve. It is NOT a convergence
metric and must not be read as one across refinement levels; a fixed-radius band
would be needed for that, which would in turn need a length scale the topological
definition deliberately avoids.

---

## Split vs diagnose, decided (issue #259)

Whether to keep reporting ONE total error with the BC share as a diagnosis (a),
or to report a genuine two-way split and let the loop target the resolvable part
(b).

**Decision: (a).** The table above is the argument. A user-facing split number
inherits the band's topological definition, so it moves from 40.6% to 27.7% on
ONE part across three densities, mostly because the band thinned — and it would
move again if anyone retuned `BC_SINGULARITY_DILATE_HOPS`. A headline number
that responds to an internal constant is worse than today's ambiguous total,
which has no such dependency. (b) is not ruled out forever, but it is blocked on
a band definition that is stable under refinement, and that needs a physical
length scale nobody has justified yet. Adopting (b) first and discovering the
band problem afterwards is the expensive order.

The second trap stands regardless and is already respected in code: the loop
must never announce `target-error-reached` against a filtered figure while the
honest total is materially higher. `maskedErrorFraction` is documented as a
reported number and not a target for exactly this reason.

**Shipped for (a).** `bcSingularityErrorFraction` is now computed on the
ORDINARY single solve too (`AnalysisResult.bcSingularityErrorFraction`), not
only on the opt-in adaptive path, and both the app and the printed report make
their advice conditional on it. Measured on the Ø5-bore tube, plain
non-adaptive runs:

| tier | elements | global η | BC share |
|---|---|---|---|
| coarse | 13 340 | 19.37 % | **75.7 %** |
| fine | 71 404 | 15.68 % | **48.0 %** |

(The coarse η reproduces the #149 benchmark's `initialGlobalError` of 0.1937,
which is the cross-check that the normal-path computation agrees with the
adaptive one.) Three quarters of the default tier's error is BC band — so the
old size-only advice was telling users to refine against a number their mesh
does not control. Above 50 % the wording now says a finer mesh will NOT fix it
and points at the constraint idealization; between 33 % and 50 % the share is
reported without overriding the refine advice, since the majority remainder is
still resolvable; below 33 % it is not mentioned.

Note the 75.7 % → 48.0 % drop is mostly the band thinning, exactly as the
caveat above says. Both surfaces state the number is specific to that solve and
not comparable across densities, precisely so this fall is not read as progress.

**What (a) still owed, for the record.** The fraction was computed and returned,
but nothing consumed it — not the client, not the printed report. The gap was
not the number, it was that the number never arrived:

- The client's discretization readout keyed purely on the total and said
  "high — refine the mesh before trusting margins" above 10%. On a bolt-
  constrained part that is precisely the wrong instruction: the error is
  BC-dominated and refinement cannot remove it.
- `bcSingularityErrorFraction` lived only on `adaptiveRefinement`, so it was
  absent on ordinary single solves — which is most runs.

Both are addressed above. Still open, and deliberately: the number is a
DIAGNOSIS and the loop must never target it. `maskedErrorFraction` documents
that, and the choice of (a) means no filtered figure is ever compared against
`targetGlobalError` — the trap this issue names first stays structurally
impossible rather than merely avoided.
