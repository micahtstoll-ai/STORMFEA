# The displayed field's mesh-dependence, re-measured and disclosed (issue #294)

The heatmap is the first thing a user looks at, and it carries something the
rest of the pipeline does not tolerate anywhere else: a scattered,
mesh-dependent tail. Re-mesh the same part at the same density and the hot
spots move. The rest of the solve is held to a much tighter standard —
flag-off bit-identity to 1e-12, CG true residual 1e-8 — so this is worth
stating plainly rather than leaving in a comment.

#294 measured it at 3,072 C3D10 elements and found: two meshes of the same
geometry under the same load disagreeing by a **median 0.03% / p95 7.90% /
max 16.05%** of peak, with the ZZ per-element error estimate showing
**Spearman 0.015** against where that disagreement actually was.

Two things then happened. #295 changed what a mesh tier promises (an element
COUNT — coarse 4,000 / standard 12,000 / fine 40,000 — plus a floor of 4
elements through the thinnest section). And #296 shipped mirrored meshing,
which removes the ASYMMETRY half of #294's evidence but not the defect: two
different meshes still disagree, mirroring just makes the pockets symmetric.

Mesh density was the only lever #294 identified, and that lever moved. So the
figures were re-taken in the regime the tool now defaults to.

## What was re-measured

`server/tests/measure294.ts` (offline script, not a CI test — same role as
`measure260.ts`). #294's fixture verbatim: a 100x40x8 mm cantilever plate,
C3D10, clamped at one end, 200 N transverse tip load, PLA-like isotropic
material. 216 probes on the top surface with the clamp band (x < 2T) excluded,
because a rigid-clamp rim is a genuine singularity already covered by
`bcSingularityErrorFraction` (#259).

Each probe reads the recovered NODAL von Mises through a nearest-node lookup —
the same rule `nearestNodeStress` (`server/analysis.ts`) uses to paint a
display vertex. The probes sit at fixed points in space, so the same probe
reads both meshes and the comparison needs no interpolation.

Mesh B is mesh A with its nodes moved: interior corners in all three axes, face
corners within their face plane, edge corners along their edge, box corners
pinned. Geometry, element count and tier are therefore identical and only node
PLACEMENT differs. Midside nodes are rebuilt as edge midpoints, so every
element stays straight-sided and no curved-element quadrature error is
introduced.

## Results

`|A - B|` as a share of the surface peak, at 15% and 25% of cell size of node
displacement:

| tier | elements | through-thickness | median | p95 | max | Spearman(eta, \|A-B\|) | globalRelativeError |
|---|---|---|---|---|---|---|---|
| coarse | 4,032 | 4 | 0.29% | 2.15% | 14.61% | 0.061 | 8.2% |
| standard | 9,984 | 4 | 0.18% | 1.45% | 1.83% | -0.066 | 5.6% |
| fine | 36,000 | 6 | 0.12% | 1.00% | 1.14% | -0.164 | 3.9% |

At 25% displacement (the same fixture, same seeds):

| tier | median | p95 | max |
|---|---|---|---|
| coarse | 0.52% | 12.18% | 18.40% |
| standard | 0.34% | 1.36% | 10.20% |
| fine | not measurable — see note | | |

_Note: at 25% the fine tier does not produce a solvable mesh. Both seeds tried
put at least one element under the solver's 0.02 normalized-Jacobian hard floor
(0.0150 on the first, 0.0059 and 0.0169 on the second) and the mesh-quality gate
refused the solve — correctly, and that cap is the right one to respect: a
perturbation big enough to make a sliver makes a mesh STORMFEA would never show
anyone. With ~36,000 elements a fixed per-node displacement gets many more
chances to make a sliver than at 4,032, so this is a property of the
PERTURBATION MODEL at that amplitude, not evidence about the fine tier's real
meshes. The 15% series covers the fine tier; do not read this row as a limit._

Three things follow.

**The tail is smaller than #294 reported, and refinement is why.** At the
tier the tool defaults to, p95 is 1.4% rather than 7.9%. Median, p95 and max
all fall monotonically with density at both displacement amplitudes. #294's
recommendation — refine — was the right one and #295 carried it out.

**Amplitude matters, and the coarse tier is where the tail still lives.** How
far apart two meshes are is not a controlled variable in real use: it is
whatever the mesher happened to do. At 25% displacement the coarse tier's p95
is 12.18% and its max 18.40%, comfortably reproducing #294's original figures.
So the defect is not gone, it is DENSITY-DEPENDENT — and it is largest exactly
where a user picks "coarse" to get an answer quickly.

**The ZZ estimator is still blind to it.** Spearman between mesh A's own
`errorEstimate` and the actual A-vs-B disagreement at the same location:
0.061 / -0.066 / -0.164 across the three tiers, against 0.015 originally. Not
one of those is predictive; the sign flip is noise, not an anti-correlation
worth reading. This is mechanism, not a coding error: eta is the gap between
the RECOVERED and the RAW element field, so an artifact inherited by both
cancels in the difference. `globalRelativeError` remains valid for the
energy-norm error it was built for. `topErrorElements` still must not be read
as "here is where the picture lies."

## The decision: measure it per location, from the solve already being done

#294 ruled out three recovery-side fixes on measurement (boundary-patch
borrowing, the cascade thresholds, `SPR_MAX_AMPLIFICATION_QUADRATIC`), and
nothing since has touched SPR recovery, so those stay ruled out. Smoothing the
display is not an option either — per `CLAUDE.md`'s rendering invariants, the
model's colors ARE the reading.

That leaves disclosure. The only thing that actually measures this artifact is
solving twice on different meshes and differencing — and the MESH CONVERGENCE
STUDY already solves twice, then reduced the result to global scalars (peak
change, headline spread) and discarded the spatial information.

So: keep it. `meshSensitivityField` (`client/index.html`) differences the two
finest meshes a run produced, per display vertex, as a percentage of the
surface peak, and `installMeshSensitivity` publishes it as a heatmap view mode
(`meshsens`, the Δ_M button) alongside a summary in the study report.

The comparison is exact, not interpolated. Every analyse response paints the
SAME display mesh — `server/analysis.ts` maps its nodal field onto
`req.positions`, the client's upload-time geometry, whatever the analysis mesh
density — so index v in one payload's `vertexStress` is the same point in space
as index v in another's. This is why the feature is a difference of two arrays
rather than a spatial re-projection, and why it costs nothing beyond the solve
the study was already running.

The C3D4 background auto-check (standard, then fine when SF < 3) also produces
two meshes, so the overlay appears there without any extra solve at all.

## What the overlay claims, and what it does not

- **Where it is large**, the color at that location is set partly by the mesh
  rather than by the part. That is the claim, and it is a direct measurement.
- **Where it is small**, this is weak evidence, not proof. Two meshes agreeing
  is not convergence — the study report has said this since #147 about its own
  scalar, and it is equally true per location.
- It measures the difference between two DIFFERENT DENSITIES, so it mixes the
  random artifact #294 is about with ordinary under-resolution. The study's own
  scalars cover the second; nothing covered the first. Separating them would
  need two meshes at the SAME density, which is a solve the tool does not
  otherwise need and would double the study's cost for a distinction that does
  not change what a user should do about it (refine, or distrust that spot).
- It is normalised by the peak of the two SURFACE fields — the number beside
  the legend — not by `summary.maxVonMisesMPa`, which is an element field and
  can peak inside the part.
- **Null means unmeasured**, and never renders as zero. One mesh cannot measure
  its own mesh-dependence, so with no second solve the mode does not appear at
  all. The same rule `headlineSpread` follows (#256).

## Confidence

Two claims here, and they do not carry the same weight.

**The mechanism — that the ZZ estimator cannot rank these locations: HIGH.**
It is structural, not statistical: eta is `‖σ* − σ_h‖` and an artifact present in
both terms subtracts out. The measurement agrees four times independently
(0.015 in #294, then 0.061 / -0.066 / -0.164 here), across two different
perturbation amplitudes and three densities, and the sign flips are noise rather
than a relationship. Nothing about it is specific to this fixture.

**The amplitudes in the tables — MEDIUM.** One geometry class (a plate in
bending), one isotropic material, one perturbation model, structured meshes
rather than TetGen output. What the amplitudes support is the comparison BETWEEN
tiers, which is what the conclusion rests on: every quantity falls monotonically
with density, at both perturbation amplitudes, which is a within-fixture
comparison and therefore robust to the fixture. What they do NOT support is
quoting "p95 1.45%" as the number for some other part. A user's part is not this
plate, which is exactly why the tool measures the overlay per-part rather than
shipping a constant.

Erring direction is known: a structured box mesh perturbed by a fixed fraction
of its cell is a TAME model of "a different mesh of the same part" compared with
re-running TetGen, which changes connectivity as well as node placement. So the
real spread between two tier-equivalent meshes is likely LARGER than these
tables, not smaller.

## What this does not do

- It does not remove the artifact. Refinement is still the only lever on
  amplitude, and it is now a lever the user can see the effect of.
- It does not make the C3D10 default path measure anything on its own. That
  path solves ONE mesh and returns; the badge there used to claim
  "Mesh-independent within 5% tolerance", which stated a measurement that had
  not been taken, and now says what is actually known (a property of the
  element) plus how to measure the rest.
- It does not put `globalRelativeError` in the 3D view. That remains on the
  RESULTS tab and in the eta explainer, and is a separate #294 sub-point.
- It has been measured on one geometry class (a plate in bending) at one
  material. The mechanism is not geometry-specific, but the AMPLITUDES in the
  table above are.

## Record status (audited 2026-08-12)

Re-checked against `main`: the decision above is what ships, and every number in
the tables still reproduces from the fixture as it is configured. `measure294.ts`
carries the tier divisions the tables report (21x8x4 = 4,032 / 32x13x4 = 9,984 /
50x20x6 = 36,000), `JITTER_AMP` defaults to 0.15 with `JITTER_SEED` 0x5f2b, and
the probe grid is 18 x 12 = 216 points on the top surface with the `x < 2T` clamp
band excluded. `meshSensitivityField`, `installMeshSensitivity`,
`MODE_META.meshsens`, `OVERFLOW_MODES`, `runConvergenceStudy` and
`convDatumFromPayload` are all present in `client/index.html` under those names,
and test group `[V]` is present in `scripts/test_client_logic.mjs`.

One property worth stating explicitly, because the sibling landed-decision
documents do not share it: this fixture drives the solver directly
(`generateBoxMeshC3D10` → `runLinearStatic` with explicit `PointForce` nodal
loads) and never calls `runAnalysis`. So the load-model changes of #271 and #305
— which moved the default distribution and then the surface it acts on, and which
DID move the tube-fixture numbers quoted in
`docs/bc-singularity-exclusion.md` and `docs/spr-gauss-point-handoff.md` — do not
touch anything measured here.

## Symbols

Search by symbol, not line number:

| Concern | Symbol | File |
|---|---|---|
| Per-location difference + summary (pure) | `meshSensitivityField` | `client/index.html` |
| Installing the field, refusing a stale one | `installMeshSensitivity` | `client/index.html` |
| The view mode itself | `MODE_META.meshsens`, `OVERFLOW_MODES` | `client/index.html` |
| Study report block, per-mesh vertex field retention | `runConvergenceStudy`, `convDatumFromPayload` | `client/index.html` |
| Display-vertex sampling rule the probe mirrors | `nearestNodeStress` | `server/analysis.ts` |
| The re-measurement | `measure294.ts` | `server/tests/` |
| Locking tests | group `[V]` | `scripts/test_client_logic.mjs` |
