# STORMFEA Invariant Traceability Matrix

`CLAUDE.md` is the **normative** source: it states, in prose, what must
never silently change in the Two-Region Material Model and the Interlayer
Failure & Bond Model. This file is the **resolved, navigable index** —
one row per numbered invariant, pointing at the current implementing
symbol (file:function/const, not line numbers — those drift; symbol names
are the stable handle) and the test(s) that lock it. If a row's code or
test reference goes stale, fix the row, not the invariant text in
CLAUDE.md.

Where an invariant's own locking coverage has a real gap (not just a
citation gap), the row says so explicitly under **Notes** instead of
papering over it — those gaps are findings, not embarrassments; several
were filed as their own issues.

See also `docs/layer-model-audit.md`, which explains *why* each Interlayer
Failure & Bond Model invariant exists (the historical defect it closes);
this matrix says *what must stay true*.

---

## Two-Region Material Model — Invariants

CLAUDE.md source: "Two-Region Material Model — Invariants" (items 1–9).

| # | Invariant (one line) | Implementing code | Locking test(s) | Confidence / notes |
|---|---|---|---|---|
| 1 | Flag off (`print.twoRegion` absent) reproduces the legacy single-material path bit-identically (assembly/recovery/mass, to 1e-12 on full solves) | `server/analysis.ts` — the `twoRegion` branch around `runAnalysis`; `server/twoRegion.ts` `buildTwoRegionField` (returns `null` when the flag is off, so every downstream consumer takes its pre-existing single-material path) | `server/tests/solver_validation.ts` group 25 ("Two-region material field — solve equivalence + sandwich beam"), test `[25.1]` (single-bin field reproduces the no-field solve exactly) and `[25.3a]` (wall-bond flag-off bit-identical) | High confidence — the 1e-12 numeric tolerance is asserted directly, not eyeballed |
| 2 | The level-set volume fraction (`tetFractionBelowIso`) is written per sign-case so every denominator is a strictly-negative-minus-non-negative difference — no NaN by construction | `server/solver/wallfrac.ts` `tetFractionBelowIso` | `server/tests/unit/two-region.test.ts` (wall-fraction edge cases); `server/tests/solver_validation.ts` group 25 exercises it end-to-end through real meshes | Medium — covered by the unit tests that exist, but there is no dedicated exhaustive sign-case enumeration test; a stronger property-based test (all 16 corner sign combinations × iso sweep) would close this gap |
| 3 | Per-bin `C` is a true Voigt matrix blend `C_b = f·C_shell + (1−f)·C_core` of the two ROTATED endpoint matrices — valid only while shell and core share the same `weakAxis`; never blend engineering constants | `server/twoRegion.ts` `buildTwoRegionField` bin loop (the `C_b = f·C_shell + (1−f)·C_core` comment block, entrywise blend after rotation) | `server/tests/unit/two-region.test.ts`; `server/tests/solver_validation.ts` group 25 (sandwich-beam composite-EI agreement, which would fail under an engineering-constant blend once shell/core ratios diverge) | Medium — the "never blend engineering constants" half of the invariant is enforced by the code path (there is no engineering-constant blend function on this path), not by an explicit negative test asserting the two blends diverge |
| 4 | The distance field is point-to-triangle (not nearest-node) so boundary triangles between 3–6 mm don't alias a ~1.35 mm wall band; boundary nodes seed at exactly 0 | `server/solver/distance.ts` `pointTriangleDistance`, `computeNodeSurfaceDistances` / `computeNodeSurfaceDistancesAndNormals` | `server/tests/unit/two-region.test.ts` (distance-field cases); `server/tests/unit/distance-boundary-seed.test.ts` (seeding, corners vs C3D10 midsides) | Good — the seeding sub-claim is now asserted directly; no dedicated node-vs-boundary-triangle-size regression, and no fixture places midsides on a curved surface (Gmsh `-order 2` would) |
| 5 | Anchor endpoints (100% infill, all-shell parts) collapse to the uniform path; interior divergence from `effectiveStrengthMultiplier` is surfaced in `summary.materialModel`, never silently renormalized | `server/analysis.ts` — `materialModel: MaterialModelInfo` field on the result, populated where the two-region branch runs (`materialModel = { ...materialModel, degraded: why }` and the wall-bond block); `server/twoRegion.ts` `materialsEqual` check in `buildTwoRegionField` (100%-infill / all-shell collapse) | `server/tests/unit/two-region.test.ts`; `server/tests/solver_validation.ts` group 25 | High confidence for the collapse anchors (asserted numerically); the "never renormalize" half is enforced by absence-of-code (no renormalization step exists), not a positive test |
| 6 | `SolverInput.material` is the volume-weighted ENGINEERING-CONSTANT blend when the field is active; whole-part consumers (ZZ error estimate, analytic hole checks) read it, per-element consumers read the field — the two must not be conflated | `server/twoRegion.ts` — the scalar `averageMaterial` computation in `buildTwoRegionField`; `server/analysis.ts` consumers of `SolverInput.material` vs. `ElementMaterialField` | `server/tests/unit/two-region.test.ts`; no test directly asserts a consumer is reading the *wrong* one of the pair (i.e., a scalar consumer accidentally reading per-element data or vice versa) | Medium — a "consumer audit" test (grep-based, asserting the known whole-part consumer list only touches `material`) would make this invariant self-checking the way `check-api-routes.mjs` does for routes |
| 7 | `binOfElement` + multi-bin `C` cross the `assembly-worker.ts` postMessage payload; any field-shape change must update `WorkerInput` and the mixed-bin case in `test-parallel-assembly.ts` | `server/solver/assembly-worker.ts` `WorkerInput` interface, `processElementChunk`; `server/solver/assembly.ts` (`binOfElement` parameter threaded through `assembleK`) | `server/tests/test-parallel-assembly.ts` (mixed-bin case: `binOfElement[e] = e % 3` — asserts parallel path matches serial to 1e-12 with a real multi-bin field) | High confidence — the mixed-bin equivalence is asserted numerically on real meshes |
| 8 | Core homogenization anchors: at ρ=1 the Gibson-Ashby scale factors are exactly 1.0 (core reproduces solid bit-for-bit, `materialsEqual` depends on it — never re-derive the ρ=1 material through a parallel formula); scales floored at 1e-3×solid; orientation never enters core STIFFNESS | `server/solver/lattice.ts` `gibsonAshbyModulus`, `LATTICE_PARAMS`; `server/analysis.ts` `buildCoreMaterial`; `server/twoRegion.ts` `materialsEqual` | `server/tests/unit/core-lattice.test.ts` — `describe("ρ=1 anchors are exact (toBe, not closeTo)")`, `describe("low-density floor")` (asserts the 1e-3 floor at ρ=0) | LOW confidence per CLAUDE.md (exponents are LOW confidence, regression-locked) — the ρ=1 and floor anchors themselves are asserted with `toBe` (exact), so those specific claims are High confidence even though the exponent *values* are LOW |

| 9 | The wall/core split is only visible on a SECTION CUT — a part's boundary is wall by construction, so the classification on the DISPLAY mesh is identically 1.0 on every part; it is published on `volumeField.nodeShellFractionB64` and painted on the cut face, never as a display-mesh vertex field | `server/analysis.ts` `nodeShellFrac` build (volume-weighted per-node projection of `ElementMaterialField.shellFrac`), `VolumeFieldPayload`; `client/index.html` `VOLUME_MODE_DATA`, `MODE_META` | `server/tests/unit/two-region-default.test.ts` — `describe("the shell/core split is displayable (issue #297)")`, in particular `it("is not a constant — it would be useless as a picture if it were")` | High confidence — measured, not argued: the display-mesh revision came back min 1.0 / max 1.0 against a 50.6% shell volume fraction on the 24x12x6 fixture |

---

## Interlayer Failure & Bond Model — Invariants

CLAUDE.md source: "Interlayer Failure & Bond Model — Invariants" (items 1–8).
See `docs/layer-model-audit.md` for the resolved A1–A7 defect history these
invariants were written to prevent from regressing.

| # | Invariant (one line) | Implementing code | Locking test(s) | Confidence / notes |
|---|---|---|---|---|
| 1 | Azimuth invariance about the weak axis — never reintroduce an independent in-plane shear coefficient into a quadratic form (the A1 defect) | `server/solver/stress.ts` `fdmDualCriterionSF` (bulk term is plain von Mises, a norm — azimuth-invariant by construction) | `server/tests/unit/fdm-criterion.test.ts`; `server/tests/solver_validation.ts` group 7, test `[7f]` ("azimuth-invariant in the layer plane (A1 fixed)" — τxy state vs. 45°-rotated (σ,−σ) state, exact to 1e-12) | High confidence — regression-locked to 1e-12 |
| 2 | Anchors preserved: in-plane uniaxial at `Y`, through-layer uniaxial at `Z`, interlayer shear at `S_zs`, flat-print false-safety `SF = Z/Y ≈ 0.58`; default `S_zs = yieldZ/√3` exactly matches legacy Hill `L = M = 3/(2Z²)` | `server/solver/stress.ts` `fdmDualCriterionSF`; `server/analysis.ts` `INTERSHEAR_OVER_YIELDZ_DEFAULT = 1/√3` | `server/tests/solver_validation.ts` group 7, tests `[7e]` (legacy anchors carry over exactly) and the Hill-collapse tests `7a`–`7d` | High confidence — exact-anchor tests, not tolerance-banded |
| 3 | Tension-only interface (`⟨σzz⟩₊` Macaulay bracket); compression routes to bulk von Mises and credits interlayer shear via Mohr–Coulomb (μ=0.3, LOW confidence) — do not re-symmetrize | `server/solver/stress.ts` `fdmDualCriterionSF` (Macaulay bracket on the normal term; friction-credit branch under `σzz ≤ 0`); `INTERFACE_FRICTION_MU` | `server/tests/solver_validation.ts` group 7, test `[7h]` (tension/compression asymmetry, audit A3); `server/tests/unit/fdm-criterion.test.ts` | High confidence for the tension/compression *asymmetry* itself; μ=0.3's *value* is explicitly LOW confidence per CLAUDE.md and the SOURCES tab |
| 4 | `hill-legacy` stays callable — `AnalysisSettings.criterion` and the upright-no-bed scalar-swap fallback depend on it | `server/solver/stress.ts` `CriterionKind = "fdm-interface" \| "hill-legacy"`, `hillEquivalentStress`; `server/analysis.ts` `AnalysisSettings.criterion`, the `(orientation === "upright" && !weakAxis) ? "hill-legacy" : "fdm-interface"` fallback selection | `server/tests/solver_validation.ts` group 7, tests `7a`–`7d` (Hill-specific anchors, still run against `hillEquivalentStress` directly) | High confidence — Hill's own anchor tests still run every suite pass, so a change that broke `hill-legacy` callability would fail immediately |
| 5 | `yieldZShear` is an optional material scalar, a REQUIRED per-bin array in `ElementMaterialField` (does NOT cross the assembly-worker boundary); derived as `yieldZ/√3` wherever absent via `interlaminarShearOf`; keep `S_zs` (lap-shear) and `S_zt` (Z-tension) independent — never reintroduce `yieldZ = τ/0.58` except as the flagged no-Z-coupon fallback (audit A5) | `server/solver/stress.ts` `interlaminarShearOf`; `server/twoRegion.ts` (`yieldZShear` array in the per-bin field, `mix(interlaminarShearOf(shell), interlaminarShearOf(core))`); `server/analysis.ts` `backCalculateProfile` (independent `interShear_MPa` / `zTensileFailN` calibration inputs) | `server/tests/unit/coupon-recommendations.test.ts` (`interfaceCalibrationState` gate — asserts `yieldZ_MPa` and `interShear_MPa` are tracked independently); `server/tests/unit/two-region.test.ts` for the per-bin array shape | Medium — the independence of the two calibration paths is well covered; the "does NOT cross the assembly-worker boundary" half of the claim is true by inspection of `WorkerInput` (`server/solver/assembly-worker.ts`, which carries `binOfElement` + `C` but no `yieldZShear`) but has no dedicated negative test asserting a future field-shape change can't add it accidentally |
| 6 | Bond model is RELATIVE, multipliers exactly 1.0 at the reference process condition (per-material nozzle ref, 60 mm/s, fan 100%, bed 60 °C) at the SAME layer height, so no process block ⇒ bit-identical legacy path; layer-height slope stays owned by `layerHeightFactor`; calibration ratios stay multiplicative | `server/solver/bond.ts` (reference-condition normalization; `BondModelCoeffs`); `server/analysis.ts` `layerHeightFactor` (unchanged fallback owner) | `server/tests/unit/bond.test.ts` | High confidence — `bond.test.ts` is explicitly named as the regression lock for the LOW-confidence constants in CLAUDE.md |
| 7 | Trend locks over value locks: hotter nozzle ↑, more fan ↓, faster printing ↑ (hotter substrate on arrival) — any change flipping these needs new physical evidence, not refactoring | `server/solver/bond.ts` (the interface-temperature-history → neck-growth → healing chain) | `server/tests/unit/bond.test.ts` (directional/monotonicity assertions, per CLAUDE.md's own description of this file's role) | LOW confidence per CLAUDE.md (constants), but the *trend* assertions themselves are regression-locked, not just documented |
| 8 | Orientation never enters the material's STIFFNESS scalars (audit A4) — the only orientation scalar allowed in the material path is `angledNoBedFallbackMul` (0.75, angled-no-bed) | `server/analysis.ts` `angledNoBedFallbackMul`, `materialStrengthMultiplier` (orientation-free); `effectiveStrengthMultiplier` (orientation-aware, but demoted to the scalar what-if estimator only) | `server/tests/unit/two-region.test.ts` (`materialStrengthMultiplier` / `effectiveStrengthMultiplier` split); `docs/layer-model-audit.md` A4 | Medium — the "only allowed orientation scalar" claim is enforced by there being exactly one call site (`angledNoBedFallbackMul`) feeding the material path, not by a test that would fail if a second one were added; a grep-based CI guard (same style as `check-api-routes.mjs`) would close this gap cheaply |

---

## Gaps found while populating this matrix

None of the above invariants are unlocked outright, but several rows above
flag **partial** coverage — cited here together so they're easy to triage
as follow-up issues rather than buried in table cells:

- **Two-Region #2** — no exhaustive sign-case test for `tetFractionBelowIso`'s
  NaN-by-construction claim.
- ~~**Two-Region #4** — "boundary nodes seed at exactly 0" has no dedicated
  regression test.~~ CLOSED: `server/tests/unit/distance-boundary-seed.test.ts`
  asserts it directly, and separates the two routes a boundary node can reach
  zero by — corners are seeded from `surfaceFaces` (bit-exactly 0), while C3D10
  midsides are not in those corner-only triples and arrive via the
  point-triangle sweep. One residual gap is stated in that file rather than
  hidden: no fixture places midside nodes on a genuinely CURVED surface, which
  a Gmsh `-order 2` mesh does, so a real sagitta offset there is untested.
- **Two-Region #6** — no automated check that whole-part vs. per-element
  material consumers stay on their correct side of the `material` /
  `ElementMaterialField` split.
- **Interlayer #5** — no negative test guarding `yieldZShear` out of the
  `assembly-worker.ts` payload.
- **Interlayer #8** — no CI guard against a second orientation scalar being
  added to the material-stiffness path (the kind of grep-based check
  `scripts/check-api-routes.mjs` already does for API routes would work
  here too).

These are documentation-visibility gaps, not known live defects — each
invariant's core numeric claim (anchors, azimuth invariance, ρ=1 collapse,
worker equivalence) IS regression-locked; the gaps are in the softer
structural/architectural half of each invariant's wording.
