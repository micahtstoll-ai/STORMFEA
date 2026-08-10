# Handoff: the open issues predating #305

Written 2026-08-10 at `50b0881`, after auditing every open issue against the
code as it stands. Covers **#292, #294, #298, #303** — the four that predate the
two filed while finishing #296.

The audit's headline: **none of them should be closed.** All four are accurate
in substance. What has moved is context around #294, and one hypothesis
connecting #292 to #294 has been checked and disproved. Both are recorded below
so nobody re-derives them.

Companion reading: `docs/mesh-sizing.md` (what a mesh tier now promises),
`CLAUDE.md`'s heatmap and two-region invariant sections, `docs/INVARIANTS.md`.

---

## #292 — vertex weld matches by cell occupancy, not distance

**Status: accurate, unfixed, verified against current `main`.**

The loop in `computeSmoothedStressColors` (`client/index.html`) still matches the
issue's quote exactly: the 27-cell neighbourhood scan takes the first occupied
cell with `break outer` and **no distance test**, then writes that borrowed group
back under the vertex's OWN cell key. `WELD_CELL = WELD_EPS * 2 = 0.02 mm`, so
opposite corners of the neighbourhood are ~0.069 mm apart — about 7x the
documented 10 µm tolerance — and still merge.

Three consequences, all still live: welds past tolerance, groups chain
transitively, and the result depends on vertex ORDER (the same mesh with
reordered triangles can weld differently).

**Reachability.** Latent on typical meshes (vertex spacing ~mm against a 0.02 mm
cell), but the issue names a real path: chaining needs spacing near `WELD_CELL`,
which happens on fine meshes and around slivers — and `smooth-concentration.test.ts`
already produces normalized Jacobians ~0.006. The geometry exists inside this
repo's own suite.

**Note on CLAUDE.md.** Its heatmap section carries a `### Known Issue: Vertex
Welding Algorithm (FIXED)` heading. That is NOT stale and NOT overclaiming: it
refers to the `Math.round` → `Math.floor` indexing fix (49bc5d6), which is
genuinely fixed. #292 is a different defect in the same function. What CLAUDE.md
lacks is the CONVERSE of its stated invariant — it says vertices at the same
location must get identical stress (true, and satisfied) but never says vertices
NOT at the same location must not be forced to share one. Worth adding when #292
is fixed, not before.

**Shape of the fix**, from the issue: distance-test candidates against the group
representative before joining, key the map by the vertex's own cell rather than
writing back a borrowed group, and add a locking test so the property is
enforced rather than only observable under `?debugWeld=true`. The debug pass
already checks exactly this and would report it — it just never runs in CI.

---

## #294 — displayed field carries a mesh-dependent artifact tail

**Status: core defect accurate and unfixed. Two sections superseded by work that
has since landed** (recorded as a comment on the issue too).

### What still stands

- Two 3,072-element meshes of the same geometry, same load: `|A - B|` / peak has
  median 0.03%, **p95 7.90%**, max 16.05%.
- p95 `|A-B|` EXCEEDS p95 `|A-ref|`, which is the signature of independent random
  artifact rather than systematic under-resolution.
- Spearman **0.015** between `errorEstimate` and actual A-vs-B disagreement. This
  is mechanistic: ZZ differences the recovered and raw fields, so an artifact
  inherited by both cancels. `topErrorElements` is not "where the picture lies".
- All three prototyped fixes stay ruled out (boundary-patch borrowing, cascade
  thresholds, `SPR_MAX_AMPLIFICATION_QUADRATIC`). Nothing since has touched SPR
  recovery.

### What moved

1. **The mesh-density recommendation is stale.** The issue says "Fine" produced
   ~3,290 elements on a real part. That predates **#295**: a tier now promises a
   COUNT (4,000 / 12,000 / 40,000) and a through-thickness floor of 4, on both
   mesher paths, with `summary.meshResolution` reporting what was achieved. The
   recommendation has largely been carried out — but **the artifact has not been
   re-measured at the new densities**, and density is the only lever this issue
   identified. That re-measurement is the first thing to do here.

2. **The asymmetry tables are no longer an unaddressed problem.** They are the
   same measurement as #296, which shipped: `analysis.symmetryMesh` takes SPR
   nodal asymmetry from 3.909% to 0.0000% and centroid pairing from 0.07% to
   99.85%. This does not close #294 — its defect is that two DIFFERENT meshes
   disagree, and mirroring gives symmetric pockets rather than random ones,
   exactly as #296's scope limit predicted.

### Hypothesis checked and DISPROVED

That #292's welding (which is vertex-order dependent, and so a plausible
mesh-to-mesh artifact source) contributes to #294's numbers. **It does not.**
#294 reproduces with `generateBoxMeshC3D10 + runLinearStatic` — the solver
directly — so its 216 probes read the recovered nodal field server-side and never
passed through client welding. The two are independent layers: #292 sits
downstream and adds to what a user sees, but it is not in these numbers, and
fixing it will not move them. **There is no ordering constraint between #292 and
#294.**

### Realistic direction

The issue's own list, unchanged: re-measure at post-#295 densities; or surface
per-location reliability in the viewport by reusing the MESH CONVERGENCE STUDY,
which already solves at several densities and currently discards the spatial
information. Smoothing the display is explicitly off the table — the model's
colors ARE the reading.

---

## #298 — unbounded grid allocation in `computeNodeSurfaceDistancesAndNormals`

**Status: accurate, still latent, re-confirmed twice.**

`CELL = Math.max(dMax, 1e-6)` with every boundary triangle binned into every cell
its bbox spans, so a `dMax` far below element scale explodes the bucket `Map`.

**Still not reachable from production**, including after #297. That is worth
stating explicitly, because #297 made the two-region model the default and so
made this distance path run on EVERY analysis rather than only opt-in ones — the
obvious worry is that this went live. It did not: both callers
(`buildTwoRegionField`, `buildWallBondField`) derive `dMax = maxBand +
maxCornerEdge(mesh)`, which is always at least one element edge.

So it stays a latent robustness hazard whose value is that the constraint is
invisible from the call site. Cheapest of the four to fix (cap the implied cell
count and raise `CELL` when it is exceeded — coarser buckets are still correct,
since the grid is an acceleration structure, not part of the answer). Lowest user
impact. Good work to fold into whatever next touches `distance.ts`.

---

## #303 — DESIGN.md type-scale drift in the client

**Status: accurate, re-scoped with measured counts on 2026-08-10.**

Filed for five reliability banners using `font-size:12px` and
`border-radius:6px`, both forbidden. The counts say the problem is much wider:

| Size | Occurrences | DESIGN.md |
|---|---|---|
| `font-size:10px` | 268 | forbidden |
| `font-size:12px` | 10 | forbidden |
| `font-size:14px` | 3 | forbidden |

So the banners are 5 of ~281, and **10px is a de facto sixth size** across the
settings panels rather than a handful of slips. Fixing five banners would address
2% of it.

Suggested order is in the issue: decide what 10px should become (per DESIGN.md,
mostly 9px, some 11px — a judgement to make once, not 268 times), sweep 12/14px
by inspection, then 10px by context class, and consider whether the repeated
inline-styled blocks should become shared CSS classes. The `vmode-btn` buttons
already work that way and carry no inline sizes, which is why they never drifted.

The durable fix is a grep-style CI guard in the shape of
`scripts/check-api-routes.mjs` — assert no `font-size:` outside {9, 11, 13, 16}px
— but it can only land after the sweep.

---

## Suggested order, and why

**#305 → #292 → #294**, with #298 folded in opportunistically and #303 whenever
someone is doing UI work.

- **#305 first** because #296 shipped but its user-visible benefit is blocked
  behind it: the default `contact_patch` distribution injects 5.04% asymmetry on
  a perfectly symmetric mesh, so force-loaded parts still render asymmetric
  heatmaps no matter what the mesh does. Force loads are the common case.
- **#292 next** because it is a contained fix with an obvious locking test, in
  code adjacent to #296's seam weld.
- **#294 last** because it is closer to a research problem than a bug, and
  because its one identified lever (mesh density) moved under it in #295 — so it
  wants a re-measurement before it wants a fix.

The ordering between #292 and #294 is now free choice, not a dependency: see the
disproved hypothesis above.
