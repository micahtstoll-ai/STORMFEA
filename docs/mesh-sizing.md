# What a mesh tier promises (issue #295)

STORMFEA has two meshers. Until this change they sized themselves on
incompatible philosophies, and only one of them targeted an element budget.

- **STL → TetGen** was scale-relative. `tetMaxVolumeForTier` returns
  `bboxVolume / TET_TARGET_ELEMENTS[tier]`, so the part gets a target COUNT
  whatever its physical size (issue #168 bought that; before it, fixed mm³
  volumes meant a metre-scale part got ~0 elements).
- **STEP → Gmsh** was absolute. The per-tier `clMin`/`clMax`/`clCurv` were
  millimetres — fine was `0.2 / 2.0 / 30` — which fixes an element SIZE and
  lets the count float freely with part size.

So "Fine — slow (~60s)" meant *40,000 elements* for an STL and *2 mm elements*
for a STEP. Only the first guarantees a resolution budget.

This document records the resolved decision, because its absence was itself
part of the finding: nothing in `docs/` described the absolute Gmsh sizing as a
deliberate choice, so there was no way to tell a landed decision from an
oversight. Per `CLAUDE.md`, this is where such a decision lives.

## The decision

A mesh tier makes **one promise, in two parts**, and both meshers now make it
against the same constants (`server/meshSizing.ts`):

1. **A target element count** — coarse 4,000 / standard 12,000 / fine 40,000.
2. **A floor of `MIN_ELEMENTS_THROUGH_THICKNESS` = 4 elements** across the
   part's smallest bounding-box dimension.

Each path resolves that promise into its own mesher's units — TetGen's `-a`
takes a VOLUME, Gmsh's `clmax` takes a LENGTH — through one shared relation
(`regularTetVolumeForEdge`, the same 6·√2 that `sizeFieldToVolFile` in
`solver/adaptiveMesh.ts` uses), so the two describe the same geometry.

The absolute millimetre table was **kept, as an upper bound**, not deleted.
`clCurv` is what refines hole bores and a hard `clMax` is what resolves small
fillets on a large part, where a count budget alone would permit a coarser
element. `gmshSizingForTier` takes the finest of the three bounds, so it can
only refine relative to the historical value.

## Why a count budget is not sufficient on its own

This is the part that was not obvious, and it is why the STL path needed
changing too even though it had been scale-relative since #168.

**A count is a budget for the whole part.** A large thin plate can spend its
entire element budget on plan area and carry almost nothing through the wall.
Worked on a 60x30x6 mm plate at the standard tier:

| | value |
|---|---|
| bbox volume | 10,800 mm³ |
| count budget | 10,800 / 12,000 = 0.9 mm³ per element |
| regular-tet edge | 1.97 mm |
| **elements through the 6 mm section** | **3.0** |

Three, on the geometry class this tool exists to analyse, at the DEFAULT tier.
The fine tier reaches 4.6 and was always fine; standard was not. The STL path's
scale invariance was real and is preserved — it just never implied a floor.

## Why the floor is 4

Not textbook convention. A 60x30x6 mm cantilever with a 1.35 mm wall band
(shell E_xy 2400 / core E_xy 600 MPa) was solved with the two-region field
active and against the homogenized average at matched resolution, sweeping
elements through the thickness. The quantity that matters is how much of the
converged **sandwich stiffening** (26.1% at 8 through) each resolution recovers:

| elements through | stiffening recovered | tip deflection vs converged |
|---|---|---|
| 1 | 4% | 29.0% off |
| 2 | 57% | 13.1% off |
| 3 | 83% | 4.75% off |
| 4 | 100% | 0.84% off |
| 8 | 100% (reference) | — |

The constant shipped at 3 on "standard FE practice" and was corrected to 4 by
this measurement one commit later. Three leaves 17% of the effect behind. At one
element through thickness the two-region model returns essentially the
homogenized answer while reporting itself active, which is worse than not
offering it.

Note that the wall-band **classification** converges far faster than the
structural response — the same fixture recovers the analytic shell volume
fraction to 3.2% at one element per 4.4 band widths, because
`tetFractionBelowIso` integrates the level set INSIDE the element (two-region
invariant 2). Volume fraction is therefore the wrong thing to size against; the
through-thickness layering is the binding constraint.

Confidence: **MEDIUM**. One geometry, one shell/core contrast. It is a floor
rather than a target, so erring high is the safe direction.

## The overshoot clamp

The floor can demand more elements than the tier budgets — a large thin sheet is
the standard conflict. `MESH_MAX_BUDGET_OVERSHOOT` (4×) pulls the sizing back
and **reports that it did**. It exists to stop a pathological geometry building
a mesh the solver cannot finish, not to enforce the target, which is why the
allowance is deliberately loose: resolving the section matters more than hitting
a count.

When the clamp fires, the section is left below the floor. That is the whole
reason it is reported rather than silent.

## Why the readout is measured, not predicted

`summary.meshResolution` reports achieved-vs-target from the mesh that came
back, not from the flags that were sent. Both meshers treat a size cap as a
REQUEST:

- `meshWithTetGen`'s switch-set fallback chain relaxes `-a` and can end at
  `-pQ` with no volume constraint at all.
- Gmsh's `clmax` yields where a curvature or boundary constraint disagrees.

A readout built from the flags would report the mesh that was asked for, which
is exactly the mesh that is not in doubt.

The prediction is still used for the clamp and the log line, and there it has a
known error with a known SIGN: a real mesh is not regular tets and typically
emits somewhat MORE elements than the relation predicts (the equivalent ratio on
the TetGen tier path drifts between ~2.5 and ~5.5 with density, which is what
`VOLUME_CAP_SCALE` absorbs on the adaptive path). More elements than predicted
means elements SMALLER than predicted, so a floor derived this way delivers at
least the layers it asks for. It errs toward a finer mesh, never a coarser one.

## What this does not do

- It does not give the STEP path a through-thickness floor **measured** on a
  STEP part. The floor is geometry-derived and mesher-independent, but the
  sandwich-stiffening sweep behind the constant was run on the TetGen path.
- It does not change adaptive refinement, which still degrades to the selected
  tier on the STEP/Gmsh path.
- It does not settle `VOLUME_CAP_SCALE` (13, calibrated on one geometry,
  confidence-LOW) — see `ROADMAP.md`.

## Follow-ups since this landed (audited 2026-08-12)

Everything above still ships as described: `MESH_TARGET_ELEMENTS` is
4,000 / 12,000 / 40,000, `MIN_ELEMENTS_THROUGH_THICKNESS` is 4,
`MESH_MAX_BUDGET_OVERSHOOT` is 4, `GMSH_TIER_ABSOLUTE.fine` is still
`0.2 / 2.0 / 30` as an upper bound, and both `tetSizingForTier` and
`gmshSizingForTier` still take the finest of the count budget, the absolute cap
(Gmsh only) and the through-thickness floor. Two things happened downstream of
it that a reader of this document needs to know.

**The floor became a correctness GATE, not only a sizing target (issue #297,
2026-08-10).** The two-region material model is now ON by default, and
`runAnalysis` degrades it to the uniform path — reporting
`summary.materialModel.degraded` — when the mesh that came back resolves fewer
than `MIN_ELEMENTS_THROUGH_THICKNESS` elements across the thinnest section. The
justification is the sandwich-stiffening sweep in "Why the floor is 4" above,
one consequence further on: at one element through thickness the model returns
essentially the homogenized answer *while reporting itself active*. An explicit
`twoRegion: true` does not override the gate, and the gate reads
`meshResolution` — the measured readout, for the reason "Why the readout is
measured, not predicted" gives. So the measurement behind this constant now
decides whether a material model runs at all, not merely how fine the mesh is.
Locked by `server/tests/unit/two-region-default.test.ts`.

**The readout is one-sided, and deliberately so.** Documented at
`MeshResolutionReport` rather than here when it was found:
`elementsThroughThickness` is back-figured from the mean element VOLUME, so it
reports mean element SIZE across the thin direction and not a layer count. The
two agree for what this pipeline emits (TetGen runs `-q1.4`, bounding the
radius-edge ratio) and diverge for a deliberately anisotropic mesh — a
structured mesh of 2 x 2 x 0.75 mm cells through a 6 mm plate has eight nominal
layers and reads 3.7. The divergence only ever reads LOW, so a consumer gating
on the figure errs toward calling a mesh under-resolved, which is the direction
the #297 gate wants.

**These tier densities are the regime #294's re-measurement was taken in
(2026-08-11).** `server/tests/measure294.ts` sizes its plate fixture to land on
each tier's budget with `nz >= 4` so the mesh clears this floor — 4,032 /
9,984 / 36,000 elements — precisely because measuring below the floor would
measure a mesh the tool no longer emits. See
`docs/display-field-mesh-sensitivity.md`; that document's tables are the
current statement of what refinement buys, and this document is what moved the
lever.

## Symbols

Search by symbol, not line number:

| Concern | Symbol | File |
|---|---|---|
| Tier targets, floor, overshoot, tet relations | `MESH_TARGET_ELEMENTS`, `MIN_ELEMENTS_THROUGH_THICKNESS`, `MESH_MAX_BUDGET_OVERSHOOT`, `regularTetVolumeForEdge` | `server/meshSizing.ts` |
| Achieved-vs-target readout | `achievedResolution`, `MeshResolutionReport` | `server/meshSizing.ts` |
| STL sizing | `tetSizingForTier`, `tetMaxVolumeForTier` | `server/tetgen.ts` |
| STEP sizing | `gmshSizingForTier`, `GMSH_TIER_ABSOLUTE` | `server/gmsh_mesh.ts` |
| Locking tests | `tet-sizing.test.ts`, `gmsh-sizing.test.ts`, `tetgen-scale.test.ts` | `server/tests/unit/` |
