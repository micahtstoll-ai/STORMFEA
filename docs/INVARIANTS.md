# STORMFEA Invariant Traceability Matrix

`CLAUDE.md` is the **normative** source: it states, in prose, what must
never silently change in the Two-Region Material Model, the Interlayer
Failure & Bond Model, and the heatmap/display rules. This file is the
**resolved, navigable index** — one row per invariant, pointing at the
current implementing symbol (file:function/const, not line numbers — those
drift; symbol names are the stable handle) and the test(s) that lock it.
If a row's code or test reference goes stale, fix the row, not the
invariant text in CLAUDE.md.

Where an invariant's own locking coverage has a real gap (not just a
citation gap), the row says so explicitly under **Notes** instead of
papering over it — those gaps are findings, not embarrassments; several
were filed as their own issues.

See also `docs/layer-model-audit.md`, which explains *why* each Interlayer
Failure & Bond Model invariant exists (the historical defect it closes);
this matrix says *what must stay true*.

> **On the CI guard.** `scripts/check-invariants-symbols.mjs` asserts that
> every file path named here exists and that every backtick-quoted
> identifier appears SOMEWHERE under `server/` or in `client/index.html`.
> It is a substring search over one concatenated haystack, so it does not
> check that a symbol lives in the file this table claims, and a name that
> survives only in a code COMMENT still passes. It caught nothing when
> `materialsEqual` was renamed `materialsEqualFor`, because the old name
> stayed in three comments. Re-resolve rows by hand; the guard is a floor,
> not a proof. Its haystack also includes `server/tests/**`, but NOT
> `scripts/`, so a symbol that exists only in `scripts/test_client_logic.mjs`
> must not be backtick-quoted here.

---

## Two-Region Material Model — Invariants

CLAUDE.md source: "Two-Region Material Model — Invariants" (items 1–9).

| # | Invariant (one line) | Implementing code | Locking test(s) | Confidence / notes |
|---|---|---|---|---|
| 1 | An explicit `analysis.twoRegion: false` reproduces the legacy single-material path bit-identically (assembly/recovery/mass, to 1e-12 on full solves). Since #297 the flag DEFAULTS TRUE, so "off" means an explicit `false`, not an absent flag | `server/analysis.ts` — `twoRegionRequested = req.analysis.twoRegion ?? true` and the branch it guards; `server/twoRegion.ts` `buildTwoRegionField` (returns a null field on the off/collapsed paths, so every downstream consumer takes its pre-existing single-material path) | `server/tests/solver_validation.ts` group 25 ("Two-region material field — solve equivalence + sandwich beam"), test `[25.1]` (single-bin field solve ≡ uniform solve, 1e-12 rel) and `[25.3a]` (`buildWallBondField` returns null for wallCount<2 — the wall-bond flag-off no-op); `server/tests/unit/two-region-default.test.ts` `it("explicit false still selects the legacy single-material path (invariant 1)")` and `it("the default actually changes the answer — off and default are not the same solve")` | High confidence — the 1e-12 tolerance is asserted directly, not eyeballed. **Scope caveat:** the `?? true` default is a LIBRARY default. The HTTP handler in `server/index.ts` writes `twoRegion: body.analysis?.twoRegion === true`, which converts an absent flag to an explicit `false`, so `?? true` never fires for a `POST /api/analyse` caller. The bit-identity claim is unaffected; the DEFAULT is, and no test covers the HTTP boundary. See `docs/API.md`. |
| 2 | The level-set volume fraction (`tetFractionBelowIso`) is written per sign-case so every denominator is a strictly-negative-minus-non-negative difference — no NaN by construction | `server/solver/wallfrac.ts` `tetFractionBelowIso` | `server/tests/unit/wallfrac.test.ts` `describe("tetFractionBelowIso")` — all-one-side, single-negative-corner, three-negative-corner, 2-vs-2 symmetric and asymmetric, the `f(φ) + f(−φ) = 1` symmetry sweep, "corner exactly on the iso-surface produces finite output (no NaN)", and "continuity across the sign convention at a tied pair"; plus `it("no NaN across randomized φ (level-set stays finite by construction)")` in the C3D10 sub-tet section. `server/tests/solver_validation.ts` group 25 exercises it end-to-end through real meshes | Good. **Row corrected:** this was previously cited to `two-region.test.ts`, which does not import `tetFractionBelowIso` at all — the tests are in `wallfrac.test.ts`. The residual gap is narrower than previously stated: every sign CARDINALITY (0/1/2/3/4 negative corners), the zero-corner cases and the tie case are covered, and a randomized no-NaN sweep exists. What is still absent is a literal enumeration of all 16 corner sign patterns crossed with an iso sweep |
| 3 | Per-bin `C` is a true Voigt matrix blend `C_b = f·C_shell + (1−f)·C_core` of the two ROTATED endpoint matrices — valid only while shell and core share the same `weakAxis`; never blend engineering constants | `server/twoRegion.ts` `buildTwoRegionField` bin loop (entrywise blend after rotation) | `server/tests/unit/two-region.test.ts` `describe("true Voigt matrix blending (anisotropic core)")` — `it("endpoint bins equal the endpoint matrices bit-for-bit")` (`toBe`, against `buildAnyConstitutiveMatrix` of each endpoint) and `it("every bin blends the endpoint matrices at its own shellFrac (spacing-agnostic)")`, both run against a core whose `E_z/E_xy` ratio is INVERTED relative to the shell, i.e. exactly the case an engineering-constant blend gets wrong; `describe("adaptive log-spaced binning at high contrast (issue #178)")` `it("endpoints stay bit-identical")`; `server/tests/solver_validation.ts` group 25 `[25.2]` (sandwich tip deflection vs composite EI) | High confidence. **Row upgraded:** the previous note said the "never blend engineering constants" half was enforced by absence-of-code with no positive test. That is no longer true — the anisotropic-core fixture makes the two blends numerically distinguishable and pins the matrix answer to 9 decimals per bin. `it("weakAxis is carried onto blends when the shell has one")` covers the shared-weakAxis precondition |
| 4 | The distance field is point-to-triangle (not nearest-node) so boundary triangles between 3–6 mm don't alias a ~1.35 mm wall band; boundary nodes seed at exactly 0 | `server/solver/distance.ts` `pointTriangleDistance`, `computeNodeSurfaceDistances` / `computeNodeSurfaceDistancesAndNormals`; the bucket grid they query is sized by `chooseGridCellSize`, which may only ever RAISE the cell above `dMax` — that bound is what makes the 27-cell one-ring search complete, i.e. what makes the field exact rather than approximate. `computeNodeBandPenetration` is a second consumer of the same grid and is bounded by the same rule | `server/tests/unit/distance.test.ts` — all seven Voronoi regions hand-computed, the degenerate zero-area triangle, one-ring completeness on a diagonal cell, `dMax` clamping, and `describe("pointTriangleDistance — point-to-TRIANGLE beats nearest-node materially")`; `server/tests/unit/wallfrac.test.ts` (`computeNodeSurfaceDistances` + `computeWallFractions` on a box, analytic wall distance, C3D10 midside consumption); `server/tests/unit/distance-boundary-seed.test.ts` (boundary VALUES, corners vs C3D10 midsides, curved bore); `server/tests/unit/distance-grid-budget.test.ts` (#298 — gridded output equals a no-grid brute-force reference exactly at every cell size, and the cell never drops below `dMax`) | Good on the value, with two corrections. (a) The seeding is NOT separately observable: a boundary corner is a vertex of a boundary triangle, so it lies at distance 0 — inside any positive radius — and Ericson's kernel returns bit-exact 0 there, so the sweep reproduces the seed. Measured: deleting the seed loop leaves every test in `distance-boundary-seed.test.ts` passing. The seed is an optimization; the invariant holds on both paths. (b) The tests are in `distance.test.ts` / `wallfrac.test.ts`, NOT `two-region.test.ts` as this row previously claimed. On the two tracked gaps: **#317 is now largely covered** — `distance.test.ts` pins the point-to-triangle answer at 0.5 mm where the nearest VERTEX of the same triangle is ~42 mm (~85×), so a swap back to nearest-node fails that test; what remains uncovered is the PIPELINE-level consequence, since no fixture drives `computeNodeSurfaceDistances` itself through a nearest-node comparison at real 3–6 mm boundary-triangle scale. **#316 is still fully open**: the curved-bore fixture's midsides sit on the CHORD (its own comment says so), so the residual it measures is float noise at 1.8e-15, not the ~43 micron sagitta a Gmsh `-order 2` mesh would produce |
| 5 | Anchor endpoints (100% infill, all-shell parts) collapse to the uniform path; interior divergence from `effectiveStrengthMultiplier` is surfaced in `summary.materialModel`, never silently renormalized | `server/analysis.ts` — `MaterialModelInfo` on the result, populated where the two-region branch runs (`materialModel = { ...materialModel, degraded: why }` and the wall-bond block); `server/twoRegion.ts` `materialsEqualFor` check in `buildTwoRegionField` (100%-infill / all-shell collapse) | `server/tests/unit/two-region-default.test.ts` `it("invariant 5: reports the divergence between the split and the legacy multiplier, and does not renormalize it")` and `it("invariant 5: collapses to the uniform path at 100% infill (endpoint anchored)")`; `server/tests/unit/two-region.test.ts` `it("shell ≡ core (100% infill) collapses to uniform")`, `it("tWall = 0 collapses to uniform core")`, `it("huge tWall (thin part) collapses to uniform shell")`, and `describe("anchor policy: implied average vs legacy global multiplier")`; `server/tests/solver_validation.ts` group 25 | High confidence for the collapse anchors (asserted numerically) and now for the disclosure half too — the #297 test asserts the divergence is REPORTED rather than absorbed. "Never renormalize" remains partly enforced by absence-of-code (no renormalization step exists) |
| 6 | `SolverInput.material` is the volume-weighted ENGINEERING-CONSTANT blend when the field is active; whole-part consumers (ZZ error estimate, analytic hole checks) read it, per-element consumers read the field — the two must not be conflated | `server/twoRegion.ts` — the scalar `averageMaterial` computation in `buildTwoRegionField`; `server/analysis.ts` consumers of `SolverInput.material` vs. `ElementMaterialField` | `server/tests/unit/two-region.test.ts` `it("average material is the Vf-weighted blend")`; no test directly asserts a consumer is reading the *wrong* one of the pair (i.e., a scalar consumer accidentally reading per-element data or vice versa) | Medium — the blend VALUE is locked; the split between consumers is not. A "consumer audit" test (grep-based, asserting the known whole-part consumer list only touches `material`) would make this invariant self-checking the way `scripts/check-api-routes.mjs` does for routes |
| 7 | `binOfElement` + multi-bin `C` cross the `assembly-worker.ts` postMessage payload; any field-shape change must update `WorkerInput` and the mixed-bin case in `test-parallel-assembly.ts` | `server/solver/assembly-worker.ts` `WorkerInput` interface, `processElementChunk`; `server/solver/assembly.ts` (`binOfElement` parameter threaded through `assembleK`) | `server/tests/test-parallel-assembly.ts` (mixed-bin case: `binOfElement[e] = e % N` over an N-bin field whose per-bin `C` is scaled 0.5…2.0 — asserts the parallel path matches serial to 1e-12 on real meshes) | High confidence — the mixed-bin equivalence is asserted numerically on real meshes |
| 8 | Core homogenization anchors: at ρ=1 the Gibson-Ashby scale factors are exactly 1.0 (core reproduces solid bit-for-bit, `materialsEqualFor` depends on it — never re-derive the ρ=1 material through a parallel formula); scales floored at 1e-3×solid; orientation never enters core STIFFNESS | `server/solver/lattice.ts` `gibsonAshbyModulus`, `LATTICE_PARAMS`; `server/analysis.ts` `buildCoreMaterial`; `server/twoRegion.ts` `materialsEqualFor` | `server/tests/unit/core-lattice.test.ts` — `describe("ρ=1 anchors are exact (toBe, not closeTo)")` (stiffness scale, strength fraction, per-axis scales, and "the production core reproduces the solid bit-for-bit at 100% infill"), `describe("low-density floor")` (`it("scales floor at exactly 1e-3 at ρ=0")`, `it("0% infill core builds a valid constitutive matrix")`), and `it.each(["grid","gyroid"])("pattern %s: field is null (materialsEqual fires)")`; `server/tests/unit/dfa-core-yield.test.ts` for the ρ=1 ⇒ von Mises collapse | LOW confidence per CLAUDE.md (the EXPONENTS are LOW confidence, regression-locked) — the ρ=1 and floor anchors themselves are asserted with `toBe` (exact), so those specific claims are High confidence even though the exponent *values* are LOW. **Naming note:** the symbol is `materialsEqualFor`; `materialsEqual` survives only in comments |
| 9 | The wall/core split is only visible on a SECTION CUT — a part's boundary is wall by construction, so the classification on the DISPLAY mesh is identically 1.0 on every part; it is published on `volumeField` as `nodeShellFractionB64` and painted on the cut face, never as a display-mesh vertex field | `server/analysis.ts` `nodeShellFrac` build (volume-weighted per-node projection of `ElementMaterialField` shell fractions), `VolumeFieldPayload.nodeShellFractionB64`; `client/index.html` `VOLUME_MODE_DATA`, `MODE_META` | `server/tests/unit/two-region-default.test.ts` — `describe("the shell/core split is displayable (issue #297)")`, in particular `it("is not a constant — it would be useless as a picture if it were")`, plus `it("publishes a per-node classification bounded to [0, 1] on the volume payload")` and `it("agrees with the shell VOLUME FRACTION the summary reports")` | High confidence — measured, not argued: the display-mesh revision came back min 1.0 / max 1.0 against a 50.6% shell volume fraction on the 24x12x6 fixture |

### Related: the resolution gate (invariant 1's degrade path)

Not separately numbered in CLAUDE.md, but normative and easy to break: the
two-region model self-degrades to the uniform path — reporting
`MaterialModelInfo` `degraded` — on a box-fallback mesh, with no boundary
surface, above `TWO_REGION_MAX_ELEMENTS`, or below
`MIN_ELEMENTS_THROUGH_THICKNESS` elements across the thinnest section. The
last gate reads the mesh that came BACK, and an explicit opt-in does not
override it.

| Implementing code | Locking test(s) | Notes |
|---|---|---|
| `server/analysis.ts` — the four `degrade(...)` calls guarded by `twoRegionRequested`; `server/meshSizing.ts` `MIN_ELEMENTS_THROUGH_THICKNESS`; `server/twoRegion.ts` `TWO_REGION_MAX_ELEMENTS` | `server/tests/unit/two-region-default.test.ts` `describe("the resolution gate (issue #297)")` — `it("degrades on a mesh too coarse to express the sandwich effect")`, `it("does not degrade once the mesh resolves the section")`, `it("the gate reads the MESH, so an explicit opt-in cannot override it")` | Good on the resolution gate. The other three degrade reasons (box fallback, no boundary surface, element ceiling) have no dedicated test — a new gap, see below |

---

## Interlayer Failure & Bond Model — Invariants

CLAUDE.md source: "Interlayer Failure & Bond Model — Invariants" (items 1–8).
See `docs/layer-model-audit.md` for the resolved A1–A7 defect history these
invariants were written to prevent from regressing.

| # | Invariant (one line) | Implementing code | Locking test(s) | Confidence / notes |
|---|---|---|---|---|
| 1 | Azimuth invariance about the weak axis — never reintroduce an independent in-plane shear coefficient into a quadratic form (the A1 defect) | `server/solver/stress.ts` `fdmDualCriterionSF` (bulk term is plain von Mises, a norm — azimuth-invariant by construction) | `server/tests/unit/fdm-criterion.test.ts`; `server/tests/solver_validation.ts` group 7, case 7f, `test("Dual: azimuth-invariant in the layer plane (A1 fixed)")` — a τxy state vs. the 45°-rotated (σ, −σ) state, relative difference < 1e-12 | High confidence — regression-locked to 1e-12 |
| 2 | Anchors preserved: in-plane uniaxial at `Y`, through-layer uniaxial at `Z`, interlayer shear at `S_zs`, flat-print false-safety `SF = Z/Y ≈ 0.58`; default `S_zs = yieldZ/√3` exactly matches legacy Hill `L = M = 3/(2Z²)` | `server/solver/stress.ts` `fdmDualCriterionSF`; `server/analysis.ts` `INTERSHEAR_OVER_YIELDZ_DEFAULT` | `server/tests/solver_validation.ts` group 7 — case 7e's three `test("Dual: …")` anchors (in-plane at yieldXY, through-layer at yieldZ, flat-print false-safety ≈ 0.58), each `near(…, 1e-9)`, sitting directly beside the Hill anchors 7a–7d computed with the same `Y`, `Z` and `ZS = Z/√3` | High confidence — exact-anchor tests, not tolerance-banded, and the two criteria are anchored side by side in one block so a divergence shows immediately |
| 3 | Tension-only interface (`⟨σzz⟩₊` Macaulay bracket); compression routes to bulk von Mises and credits interlayer shear via Mohr–Coulomb (μ=0.3, LOW confidence) — do not re-symmetrize | `server/solver/stress.ts` `fdmDualCriterionSF` (Macaulay bracket on the normal term; friction-credit branch under `σzz ≤ 0`); `INTERFACE_FRICTION_MU` | `server/tests/solver_validation.ts` group 7, case 7h, `test("Dual: compression checked by bulk only (A3 fixed)")` — asserts tension at Z gives SF 1.0 while compression at −Z gives SF Y/Z, both to 1e-9; `server/tests/unit/fdm-criterion.test.ts` | High confidence for the tension/compression *asymmetry* itself; μ=0.3's *value* is explicitly LOW confidence per CLAUDE.md and the SOURCES tab |
| 4 | `hill-legacy` stays callable — `AnalysisSettings.criterion` and the upright-no-bed scalar-swap fallback depend on it | `server/solver/stress.ts` `CriterionKind`, `hillEquivalentStress`; `server/analysis.ts` `AnalysisSettings` `criterion`, and the upright-no-bed fallback that selects `hill-legacy` when no `weakAxis` is known | `server/tests/solver_validation.ts` group 7, cases 7a–7d, which call `hillEquivalentStress` directly (von Mises collapse at yieldXY = yieldZ, in-plane uniaxial, through-layer uniaxial, flat-print false-safety); `server/tests/unit/verdict-hill-sf.test.ts` `it("labels the Bulk yield mode with the Hill criterion when bulkCriterion='hill'")` and `it("minSafetyFactor is the hand-computed Hill SF")`. The scalar-swap HALF of the invariant is covered only indirectly: `server/tests/unit/upright-swap.test.ts` locks the swap itself (field-by-field, and that it is never stiffer than the true rotation) but does not assert that the swap path SELECTS `hill-legacy` | High confidence for callability — Hill's own anchor tests run every suite pass, so a change that broke `hill-legacy` would fail immediately. **New gap:** `AnalysisSettings` `criterion` is unreachable from `POST /api/analyse` — `ANALYSE_SPEC` accepts it but the handler never forwards it (see `docs/API.md`), and nothing tests that path |
| 5 | `yieldZShear` is an optional material scalar, a REQUIRED per-bin array in `ElementMaterialField` (does NOT cross the assembly-worker boundary); derived as `yieldZ/√3` wherever absent via `interlaminarShearOf`; keep `S_zs` (lap-shear) and `S_zt` (Z-tension) independent — never reintroduce `yieldZ = τ/0.58` except as the flagged no-Z-coupon fallback (audit A5) | `server/solver/stress.ts` `interlaminarShearOf`; `server/solver/types.ts` (`yieldZShear` optional on the material, required `Float64Array` on `ElementMaterialField`); `server/twoRegion.ts` (the per-bin `yieldZShear` blend); `server/analysis.ts` `backCalculateProfile` (independent `interShear_MPa` / `zTensileFailN` calibration inputs) | `server/tests/unit/fdm-criterion.test.ts` `describe("per-bin yieldZShear plumbing through recoverElementStress")` — the field-to-consumer path end to end; `server/tests/unit/two-region.test.ts` `it("explicit endpoint yieldZShear values blend instead of the derived default")` (the per-bin array shape and the derive-when-absent rule); `server/tests/unit/coupon-recommendations.test.ts` (`interfaceCalibrationState` gate — asserts `yieldZ_MPa` and `interShear_MPa` are tracked independently) | Medium. Verified by inspection this pass: `yieldZShear` appears ZERO times in `server/solver/assembly-worker.ts`, so the "does NOT cross the worker boundary" half holds today — but it is still enforced by nothing, with no negative test that would fail if a future field-shape change added it |
| 6 | Bond model is RELATIVE, multipliers exactly 1.0 at the reference process condition (per-material nozzle ref, 60 mm/s, fan 100%, bed 60 °C) at the SAME layer height, so no process block ⇒ bit-identical legacy path; layer-height slope stays owned by `layerHeightFactor`; calibration ratios stay multiplicative | `server/solver/bond.ts` (reference-condition normalization; `BondModelCoeffs`, `BOND_REFERENCE`, per-material `fanRefPct`); `server/analysis.ts` `layerHeightFactor` (unchanged fallback owner) | `server/tests/unit/bond.test.ts`; `server/tests/unit/bond-rotation.test.ts` | High confidence — `bond.test.ts` is explicitly named as the regression lock for the LOW-confidence constants in CLAUDE.md. Note the fan reference is PER-MATERIAL since #184, so "fan 100%" in the CLAUDE.md wording is the PLA/PETG anchor, not a universal one |
| 7 | Trend locks over value locks: hotter nozzle ↑, more fan ↓, faster printing ↑ (hotter substrate on arrival) — any change flipping these needs new physical evidence, not refactoring | `server/solver/bond.ts` (the interface-temperature-history → neck-growth → healing chain) | `server/tests/unit/bond.test.ts` (directional/monotonicity assertions, per CLAUDE.md's own description of this file's role) | LOW confidence per CLAUDE.md (constants), but the *trend* assertions themselves are regression-locked, not just documented |
| 8 | Orientation never enters the material's STIFFNESS scalars (audit A4) — the only orientation scalar allowed in the material path is `angledNoBedFallbackMul` (0.75, angled-no-bed) | `server/analysis.ts` `angledNoBedFallbackMul`, `materialStrengthMultiplier` (orientation-free); `effectiveStrengthMultiplier` (orientation-aware, but demoted to the scalar what-if estimator only) | `server/tests/unit/two-region.test.ts` (`materialStrengthMultiplier` / `effectiveStrengthMultiplier` split); `docs/layer-model-audit.md` A4 | Medium — the "only allowed orientation scalar" claim is enforced by there being exactly one call site (`angledNoBedFallbackMul`) feeding the material path, not by a test that would fail if a second one were added; a grep-based CI guard (same style as `scripts/check-api-routes.mjs`) would close this gap cheaply |

---

## Heatmap & Display — Invariants

CLAUDE.md states these in prose rather than as a numbered list (sections
"Vertex Welding Requirements", "Display Color Space", "The Picture's Own
Mesh-Dependence"), but they are normative in the same sense and each has a
locking test group in `scripts/test_client_logic.mjs`. Lettered here (W/C/M)
so rows can be cited; the letters are this file's, not CLAUDE.md's, and the
numbered lists above must never be renumbered to match.

| # | Invariant (one line) | Implementing code | Locking test(s) | Confidence / notes |
|---|---|---|---|---|
| W1 | Every display vertex receives a stress value — the per-vertex array length is exactly `triangleCount × 3` | `client/index.html` `computeSmoothedStressColors` | test group **[U]**, `test('every vertex is assigned a valid group id')`; the length contract itself is also asserted client-side against `surfaceTriangleCount` | Medium — the length equality is checked at run time and in the display-array plumbing, but there is no single test named for the `vertexStressB64` length contract itself |
| W2 | Vertices at the same location (< `WELD_EPS`, 0.01 mm) get identical stress — weld BEFORE colour assignment | `client/index.html` `weldCoincidentVertices` (grouping), consumed by `computeSmoothedStressColors` (which owns `WELD_EPS` and the `?debugWeld=true` verification pass) | test group **[U]** — `test('exactly coincident vertices weld into one group per location')`, `test('each welded group holds all 3 duplicates of its corner')`, `test('near-coincident vertices (STL float noise, < WELD_EPS) still weld')`, and `test('computeSmoothedStressColors welds via weldCoincidentVertices')` | High confidence |
| W3 | And the converse (issue #292): vertices NOT at the same location must not be forced to share one. Each vertex joins the NEAREST representative within `WELD_EPS`, so no group is wider than `2·WELD_EPS` and groups cannot chain | `client/index.html` `weldCoincidentVertices` — the hash holds, per cell, the group ids whose REPRESENTATIVE lives there; the vertex's own cell is scanned first | test group **[U]** — `test('vertices beyond WELD_EPS are not welded, even in an adjacent cell')` (~6.9× `WELD_EPS` fixture), `test('a run of occupied cells does not chain — each spaced vertex stays its own group')`, `test('no group is wider than WELD_EPS from its representative')`, `test('no two group representatives are within WELD_EPS of each other')`, and a dense sliver-scale cloud case. Three explicit regression guards re-run the PRE-FIX occupancy algorithm and assert it FAILS each of these, so the tests are a real constraint rather than a restatement of the code | High confidence — the strongest-locked invariant in this table |
| W4 | The partition depends on geometry, not on vertex ORDER | `client/index.html` `weldCoincidentVertices` (ties resolve to the lowest group id) | test group **[U]** — `test('the partition is independent of vertex order (25 shuffles)')` | High confidence |
| W5 | Grid-cell indexing is floor-based with bounding-box normalization, matching the server, never `round(x / cell)`; must hold for negative coordinates | `client/index.html` `weldCoincidentVertices`; server-side counterpart `server/analysis.ts` `nearestNodeStress` | test group **[U]** — `test('a part centered in the negative octant welds identically')` | Medium — the negative-coordinate BEHAVIOUR is locked; that the client and server use the same indexing SCHEME is not asserted anywhere, and would drift silently |
| C1 | sRGB for the browser, LINEAR for the GPU: every geometry `color` attribute is written through a `*Linear` helper, every browser-painted swatch through the sRGB one | `client/index.html` `srgbToLinear`, `stressColorLinear` / `divergingColorLinear`, `FILTER_GREY_LINEAR`, `DEFAULT_MESH_LINEAR`, against the sRGB `COLORMAPS` / `DIVERGING_BWR` tables and `stressColor` / `divergingColor` | test group **[T]** — `srgbToLinear` identities and monotonicity, `test('FILTER_GREY_LINEAR is the converted mid-grey, not the raw 0.5')`, and `test('${map}: model color == legend color at all 21 sampled stops (fully lit)')` per colormap plus the diverging scale, with `test('regression guard: the pre-fix path is off by >40/255 on viridis dark purple')` | High confidence |
| C2 | The light rig sums to exactly 1.0 and is untinted white | `client/index.html` `initThree` | test group **[T]** — `test('light rig parsed from initThree (1 ambient + 2 directional)')`, `test('light intensities sum to exactly 1.0 (no channel can exceed the colormap color)')`, `test('all lights are untinted white (a tint would scale channels unequally)')`, and `test('no channel of any colormap exceeds 1.0 under the normalized rig (no hue rotation)')` | High confidence |
| C3 | Data-carrying meshes are matte and Gouraud-shaded — built via `makeStressMaterial()`, never a hand-rolled Phong material | `client/index.html` `makeStressMaterial` | test group **[T]** — `test('makeStressMaterial exists and is the single stress-material factory')`, `test('stress material is fully matte (specular 0x000000, shininess 0)')`, `test('stress material keeps Gouraud shading (CLAUDE.md heatmap invariant)')`, `test('no stress mesh still builds a raw shiny MeshPhongMaterial with vertexColors')` | High confidence |
| C4 | `currentGamma()` is the single source of truth for the gamma curve — every paint path reads it, including the section cut face; never keep a second copy of the `disableGamma` flag (issue #142) | `client/index.html` `currentGamma`, `_colorInteriorValues` | test group **[T]** — `test('_colorInteriorValues uses currentGamma() (shared toggle, issue #142)')` and `test('_colorInteriorValues no longer reads the URL flag itself')` | High confidence for the cut-face path specifically; the other paint paths are not individually asserted |
| M1 | The ZZ estimator cannot flag mesh-dependent display locations, and that is mechanism, not a bug — never present `topErrorElements` as "here is where the picture lies" | `server/analysis.ts` `topErrorElements` (the ZZ output it must not be conflated with); `server/tests/measure294.ts` holds the re-measurement | Measured, not unit-tested: Spearman of η against actual mesh-to-mesh disagreement came out 0.015, then 0.061 / −0.066 / −0.164 on re-measurement (`docs/display-field-mesh-sensitivity.md`) | Mechanism HIGH confidence (structural, measured four times independently); AMPLITUDES MEDIUM (one geometry class, one material, structured meshes). **Gap:** nothing in CI would fail if a future change wired `topErrorElements` into a "where the picture lies" banner |
| M2 | Disclosure, not smoothing: mesh sensitivity is published as the `meshsens` view mode by differencing the two finest meshes a run produced, per DISPLAY vertex — never an interpolated comparison of two analysis meshes | `client/index.html` `meshSensitivityField`, `installMeshSensitivity`, `MODE_META` | test group **[V]** — symmetry under argument swap, per-location amplitude (`test('a single moved vertex is reported at full amplitude')`), normalisation by the peak across BOTH fields, and length-mismatch rejection | High confidence. This is free because every analyse response paints the SAME display mesh whatever the analysis density, so the comparison is an array difference; the API publishes nothing for it (see `docs/API.md`) |
| M3 | Null means UNMEASURED and must never render as zero — one mesh cannot measure its own mesh-dependence, so with no second solve the mode does not appear. Same rule `headlineSpread` follows (#256) | `client/index.html` `meshSensitivityField` (returns null), `installMeshSensitivity` (removes the mode); `server/analysis.ts` `headlineSpread` for the #256 parallel | test group **[V]** — `test('null with no second mesh')`, `test('null with no first mesh')`, `test('null on empty fields')`, `test('null on length mismatch')`, `test('null when both fields are identically zero')`, against `test('identical fields return a result (not null)')` and `test('identical fields measure 0% everywhere')` which pin the measured-zero case as DISTINCT from unmeasured | High confidence — the measured-zero vs unmeasured distinction is asserted from both sides |

---

## Gaps found while populating this matrix

None of the above invariants are unlocked outright, but several rows flag
**partial** coverage — cited here together so they're easy to triage as
follow-up issues rather than buried in table cells.

Closed since the last pass:

- ~~**Two-Region #4** — "boundary nodes seed at exactly 0" has no dedicated
  regression test.~~ CLOSED: `server/tests/unit/distance-boundary-seed.test.ts`
  asserts it directly, and separates the two routes a boundary node can reach
  zero by — corners are vertices of boundary triangles (bit-exactly 0), while
  C3D10 midsides arrive via the point-triangle sweep.
- ~~**Two-Region #3** — no positive test distinguishing a Voigt matrix blend
  from an engineering-constant blend.~~ CLOSED:
  `describe("true Voigt matrix blending (anisotropic core)")` in
  `server/tests/unit/two-region.test.ts` runs against an inverted-anisotropy
  core, where the two blends differ, and pins the matrix answer per bin.
- **Two-Region #2** — the gap is narrower than previously recorded, not closed:
  `server/tests/unit/wallfrac.test.ts` covers every sign cardinality, the
  on-iso-surface cases, the tie case and a randomized no-NaN sweep. Only the
  literal 16-pattern enumeration is missing.
- **#317** (invariant 4, nearest-node aliasing undefended) — largely covered by
  `describe("pointTriangleDistance — point-to-TRIANGLE beats nearest-node materially")`
  in `server/tests/unit/distance.test.ts`, which fails outright under a
  nearest-node kernel. Left OPEN rather than closed here because the coverage is
  at the kernel, not at `computeNodeSurfaceDistances`, and closing an issue is
  not this document's call — see the note under invariant 4.

Still open:

- **#316** (invariant 4) — no fixture places C3D10 midsides on a genuinely
  CURVED surface. The curved-bore fixture in
  `server/tests/unit/distance-boundary-seed.test.ts` puts them on the chord by
  construction, so the ~43 micron sagitta a Gmsh `-order 2` mesh produces is
  untested; what that test measures is 1.8e-15 of float noise.
- **Two-Region #1, scope** — the `?? true` default is asserted in-process
  (`server/tests/unit/two-region-default.test.ts`) but defeated at the HTTP
  boundary by `server/index.ts`, and no test covers the HTTP boundary at all.
  This is a live behaviour gap, not only a coverage gap.
- **Two-Region #6** — no automated check that whole-part vs. per-element
  material consumers stay on their correct side of the `material` /
  `ElementMaterialField` split.
- **Two-Region, resolution gate** — only the through-thickness gate is tested.
  The box-fallback, no-boundary-surface and `TWO_REGION_MAX_ELEMENTS` degrade
  reasons have no test asserting they fire.
- **Interlayer #4** — `AnalysisSettings` `criterion` is accepted by
  `ANALYSE_SPEC` and then dropped by the analyse handler, so `hill-legacy` is
  unreachable over HTTP. Nothing tests the request path.
- **Interlayer #5** — no negative test guarding `yieldZShear` out of the
  `assembly-worker.ts` payload (verified absent by inspection this pass).
- **Interlayer #8** — no CI guard against a second orientation scalar being
  added to the material-stiffness path (the kind of grep-based check
  `scripts/check-api-routes.mjs` already does for API routes would work here
  too).
- **Display W5** — the client's floor-based cell indexing is tested for
  negative coordinates, but nothing asserts it still MATCHES the server's
  scheme in `server/analysis.ts` `nearestNodeStress`; the two could drift apart
  silently.
- **Display M1** — nothing in CI would fail if `topErrorElements` were
  re-presented as a mesh-sensitivity indicator, which is exactly the conflation
  the invariant exists to forbid.

Most of these are documentation-visibility gaps rather than known live defects
— each invariant's core numeric claim (anchors, azimuth invariance, ρ=1
collapse, worker equivalence, weld tolerance, colour-space round trip) IS
regression-locked. The two exceptions worth treating as defects rather than
gaps are the Two-Region #1 HTTP default and the Interlayer #4 dropped
`criterion`, both of which are behaviour, not coverage.
