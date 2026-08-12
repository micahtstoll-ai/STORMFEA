# BC-singularity exclusion in the adaptive loop

**Status:** landed, and honest about its limits — it is a real but *modest*
improvement, and on its own it cannot bring a bolt-constrained part near the 3%
`targetGlobalError`. The reason is structural and is spelled out below.

Follow-up to `docs/spr-gauss-point-handoff.md`. That work removed the ZZ
estimator's artifact floor; this addresses what was left, which turned out not
to be an estimator problem at all.

**Read [Two later changes moved the load under this
fixture](#two-later-changes-moved-the-load-under-this-fixture-audited-2026-08-12)
before quoting any Ø5-bore-tube number below.** The mechanism, the design and
the #259 decision all still ship; the tube's absolute figures were taken before
the default load distribution changed twice under them.

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

### Correction: the DIRECTION is fixture-specific (issue #261)

The table above is the Ø5-bore tube, and the "falls with density" reading was
generalised from it alone. It does not survive a second part. On the cross plate
(`server/tests/unit/adaptive-fixture-cross.test.ts` — partial bore clamp,
re-entrant corners, distributed load), uniform tiers give:

| elements | 32 377 | 44 693 | 74 298 |
|---|---|---|---|
| `bcSingularityErrorFraction` | 41.1 % | 48.9 % | 48.2 % |

It RISES from coarse to standard and then flattens. So band thinning is one
effect among several — how much error the band holds also depends on how fast
the interior error is falling, and on this part the two roughly cancel.

What this does NOT change, and in fact strengthens: **do not read the fraction
as a trend across densities.** The original caveat assumed the number at least
moved predictably (downward, from thinning). It does not even do that. Compare
it across meshes for nothing; read it as a property of the solve in front of you.

`adaptive-fixture-cross.test.ts` asserts the fraction does not fall
monotonically on that part, so if this ever changes the doc gets revisited
rather than silently drifting.

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

---

## Two later changes moved the load under this fixture (audited 2026-08-12)

Everything this document decided still ships, and every symbol it names is
still there under that name: `bcDiscontinuityMask`, `BC_SINGULARITY_DILATE_HOPS`
(still 1) and `maskedErrorFraction` in `server/solver/adaptiveMesh.ts`,
`buildSizeField`'s `excludeNodes`, `smoothSizeFieldGradation`,
`_captureInternals`, and `bcSingularityErrorFraction` computed on the ordinary
single solve in `runAnalysis`. The #259 advice ladder is live at exactly the
thresholds recorded above — `bcDominant` at 50%, `bcNotable` at 33%, silent
below — in `client/index.html` and `server/report.ts`. The locking tests are
present: "refuses to guess without a surface mask" in `adaptive-mesh.test.ts`,
and the non-monotonicity assertion in `adaptive-fixture-cross.test.ts`, which
names this document in its failure message.

What is NOT still true is the load these measurements were taken under, and it
changed twice after 2026-08-04:

| when | change | effect on this fixture |
|---|---|---|
| 2026-08-05, `dc45d93` (#271) | `DEFAULT_LOAD_DISTRIBUTION` became `contact_patch` | 50 N stops being smeared over the extreme-face band and becomes a tapered disc at the application point |
| 2026-08-11, `9bb804c` (#305) | the patch acts on the surface the point was placed on, grown by edge adjacency | the point `(6, 0, 5)` is on the outer top rim, so the patch now wraps onto the top annulus the old rule excluded |

`adaptive-benchmark.test.ts` builds this tube with
`forces: [{ magnitude: 50, direction: [1, 0, 0], position: [R, 0, H] }]` and
names no `loadDistribution`, so it takes the default and therefore took both
changes. `docs/load-distribution-default.md` measured what that did on this
exact fixture and mesh ladder: SF 12.80 → 1.75 → 1.33 and peak 3.908 → 28.642 →
37.473 MPa at 20,291 elements.

**So the Ø5-bore-tube numbers in this document are legacy-load measurements and
are not expected to reproduce today.** That covers the exclusion-vs-no-exclusion
table (min SF 8.99 / 5.58, peak 5.56 / 8.49 MPa, error 11.14% / 10.23%), the
`maxElementGrowth` sweep, the error decomposition (10.23% = 4.99% + 8.93%), the
`bcSingularityErrorFraction` density table (40.6 / 33.1 / 27.7%), and the
non-adaptive tier table (75.7% / 48.0%, including its cross-check against #149's
`initialGlobalError` of 0.1937). They are left exactly as measured — they are
the record of what the feature bought at the time, and re-deriving them would
destroy that record. Anyone who needs today's figures must re-run, and should
add a row rather than overwrite one.

What is unaffected, and why it matters that this is a short list:

- **The cross-plate table (41.1 / 48.9 / 48.2%).** That fixture loads with
  `pressures: [{ magnitude: 0.5, direction: [1, 0, 0], region: "face" }]` and
  `forces: []`, so no force ever routes through load distribution. The
  correction it carries — that the fraction's DIRECTION across densities is
  fixture-specific — stands on its own measurement.
- **The mesh tiers themselves.** #295 added a through-thickness floor, but on
  this tube (bbox 12 x 12 x 5 mm) the count budget is finer than the floor at
  every tier, so the floor never binds and the tier meshes are unchanged. The
  drift here is the load, not the mesh.
- **Every structural claim.** That a rigid-clamp rim is a BC idealization
  singularity and not geometry; that the exclusion is SOFT because
  `smoothSizeFieldGradation` runs after the mask; that a 2-D BC patch in a 3-D
  volume graph needs the surface restriction or the whole patch gets masked;
  that an excluded band still counted in the reported total puts a floor under
  that total; and that peak stress on a bolt-constrained adaptive run is not a
  converged quantity. None of those depend on the load model.

The last point is worth reading twice against the new numbers rather than
treated as spent. The 44% non-monotone peak-stress swing measured here across
three defensible meshes was the argument that a safety factor off such a part is
±40%; #305's own measurement then found a 15.7% spread across three rungs on the
same part for an unrelated reason (a patch spanning a sharp edge, tracked as
#308). Two independent routes to the same warning.
