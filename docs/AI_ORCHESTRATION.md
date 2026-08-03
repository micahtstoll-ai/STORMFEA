# AI Orchestration Log - STORMFEA

This log tracks how AI orchestration tools (like Claude Code) are utilized to build, audit, and optimize the STORMFEA computational engine.

## Generation Guardrails & Verification
Before running code generation prompts, the following validation phrase must be confirmed by the assistant:
* **Target Phrase:** `blueberry canary`

**Backfilled entries.** Entries 5–11 were written on 2026-08-03 from the git
history, the roadmap, and the audit documents — not live at the time of the
work. The guardrail phrase is not recoverable from commit metadata, so those
entries record what IS verifiable (CI state, suite counts, locking tests) and
say so explicitly rather than asserting a confirmation nobody logged. Entries
written live should keep using the Yes/No field as before.

## Orchestration Patterns In Use

Three working patterns emerged over June–August 2026; entries below name which
one they used.

1. **Audit → issues → phased plan → small PRs.** A read-only analysis pass
   files numbered findings, a companion plan sequences them by
   risk-reduction-per-effort with explicit dependencies, then each phase lands
   as an independently verifiable PR. Used for the July audit (#96–#111) and
   the layer-model audit (A1–A7). The plan document is the durable artifact —
   `docs/REPO_ANALYSIS_2026-07.md` + `docs/IMPLEMENTATION_PLAN_2026-07.md`.
2. **Wide campaign → single reviewed integration.** Many parallel agent
   sessions produce many branches; they are reviewed and squash-merged as ONE
   CI-green integration commit rather than 30 sequential merges to `main`.
   Used for the 69-issue solver-accuracy campaign (commit `42143a2`). The
   deferral discipline matters: #149 was cut from the integration because its
   mechanism did not work, and stayed open instead of shipping broken.
3. **Invariant-locked refactoring.** Before an AI session is allowed to touch
   the two-region or interlayer model, the numbered invariants in `CLAUDE.md`
   and their resolved index in `docs/INVARIANTS.md` define what must not
   change; the locking tests named there are the acceptance gate. This is what
   makes "flag off must stay bit-identical" enforceable across sessions that
   share no context.

## Engineering Log

### Entry 1: Vitest Framework Setup

* **Date:** 2026-06-25
* **Task:** Establish Vitest test framework with configuration and initial test structure
* **Verification Check:** Yes (Code-review verified)
* **Engineering Notes:**
  * **Files Modified:** `vitest.config.ts` (new), `server/tests/unit/stiffness-matrix.test.ts` (new)
  * **Configuration Choices:**
    - Environment: Node.js (no browser, improves test speed for server-side solver logic)
    - Test File Pattern: `server/tests/**/*.test.ts` — scans entire test directory recursively
    - Coverage Thresholds: 70% minimum for lines, functions, branches, statements — ensures broad instrumentation without false positives from unreachable code paths
    - Path Alias: `@/` → `./server` — enables clean imports in tests without relative paths
  * **Coverage Report Configuration:** Excludes server tests themselves, entry point, and type definitions to avoid circular counting
  * **Initial Test Placeholder:** Created dummy test suite in `server/tests/unit/stiffness-matrix.test.ts` with 3 tests to validate framework connectivity
  * **Decision Rationale:** 
    - Chose v8 provider for native Node.js compatibility (no instrumentation library overhead)
    - Excluded main `server/index.ts` from coverage because it's an Express entry point with complex async bootstrapping — better tested via integration tests
    - 70% threshold chosen to catch obvious gaps (missing branches) without requiring coverage of error-handling paths in production code

---

### Entry 2: Gyroid Infill Tensor — Density-Based Constitutive Matrix Scaling

* **Date:** 2026-06-25
* **Task:** Implement GyroidOrthotropic material model with empirically-derived density scaling formulas
* **Verification Check:** Yes (35+ test cases pass, matrix properties validated)
* **Engineering Notes:**
  * **Files Modified:** 
    - `server/solver/types.ts` — Added `GyroidOrthotropic` interface and type guards
    - `server/solver/element.ts` — Added `buildGyroidConstitutiveMatrix()` function with power-law degradation
    - `server/tests/unit/density-matrix.test.ts` — Added comprehensive test suite (512+ lines, 35+ cases)
  
  * **Mathematical Foundation:**
    - Base Material: PLA (3D-printed thermoplastic) — solid modulus values: E_xy=3500 MPa, E_z=2275 MPa
    - Density Parameter: ρ ∈ [0, 1] — relative infill fraction (0=void, 1=solid)
    - Power-Law Degradation with Correction Factors:
      ```
      E_xy(ρ) = 3500 × ρ^1.75 × (1 - 0.12(1-ρ))
      E_z(ρ)  = 2275 × ρ^2.1  × (1 - 0.18(1-ρ))
      G_xz(ρ) = 1143 × ρ^2.3  × (1 - 0.22(1-ρ))
      ```
    - Power-law FORM is cited (Gibson & Ashby 1997; the pattern-effect direction is supported by Birosz et al. 2022, Hikmat et al. 2023). The specific exponents (1.75, 2.1, 2.3) are STORMFEA engineering estimates chosen WITHIN the cited open-cell ranges — no paper reports these pattern-specific coefficients. Confidence LOW; regression-locked (gyroid-formula.test.ts) and calibration-overridable
    - Linear correction factors [(1 - α(1-ρ))]: account for strut curvature and surface roughness effects near 0% and 100% density
  
  * **Implementation Architecture:**
    - `GyroidOrthotropic` interface: immutable, strongly-typed discriminator `kind: "gyroid-orthotropic"`
    - Type guards: `isGyroidOrthotropic()`, `isOrthotropicLike()` — enable compile-time exhaustiveness checking on material unions
    - Material dispatcher: `buildAnyConstitutiveMatrix()` routes GyroidOrthotropic to dedicated builder, other types to existing handlers
    - Constitutive matrix output: 6×6 symmetric positive-definite (SPD) Float64Array in Voigt notation — validates via Cholesky decomposition
  
  * **Validation & Testing:**
    - Test Suites: 20% density (114 MPa E_xy), 50% density (583 MPa), 100% density (3500 MPa = solid reference)
    - Invariants checked:
      1. Matrix symmetry: C[i,j] = C[j,i] within 1e-10 (numerical precision limit)
      2. Positive definiteness: All eigenvalues > 0 (verified via Cholesky decomposition success)
      3. Density scaling: E_xy(50%) / E_xy(20%) ≈ 5.17× (ratio implied by the chosen power-law exponent, not an independently measured value)
      4. Anisotropy preservation: E_z < E_xy (vertical direction softer than in-plane — artifact of FDM layering)
      5. Shear decoupling: C[0:3, 3:6] ≈ 0 (normal and shear blocks independent for transversely isotropic material)
    - Edge cases: Rejects density < 0, density > 1, invalid Poisson's ratio (ν ≥ 0.5)
  
  * **Decision Rationale:**
    - Chose power-law (not linear) model because gyroid lattice shows non-linear stiffness degradation — linear underestimates stiffness at high density, overestimates at low density
    - Different exponents for E_xy vs. E_z reflect that vertical struts (along Z) are longer and more compliant than horizontal struts — a modeling choice within the cited Gibson-Ashby ranges, not a fitted result
    - Constant Poisson's ratio (ν_xy=0.38, ν_xz=0.28) simplifies input (one fewer parameter) and is valid for most composite lattices over practical density range
    - Correction factors small (α ∈ [0.12, 0.22]) to preserve dominant power-law behavior while accounting for geometry effects near boundaries

---

### Entry 3: Canvas Changes for 3D Deformation Wireframe

* **Date:** 2026-06-25
* **Task:** Decode and store nodal displacements from analysis server response for deformation visualization
* **Verification Check:** Yes (integrated with displacement response decoding and validation)
* **Engineering Notes:**
  * **Files Modified:** `client/index.html`
  
  * **Implementation:**
    - Added `S.displacements` global property to store per-vertex displacement field (Float32Array)
    - New function `decodeDisplacementB64()` — decodes base64-encoded binary displacement data from server
    - Integration points: `runAnalysis()` function — reads `dataStd.vertexDisplacementB64` and `dataFine.vertexDisplacementB64` from server response
  
  * **Data Format:**
    - Server encodes displacements as Float32Array → base64 string (one float per DOF per vertex)
    - Client decodes: `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` → Float32Array (reinterpret bytes as 32-bit floats)
    - Expected length: `surfaceTriangleCount × 3 vertices × 3 DOF = surfaceTriangleCount × 9` floats
  
  * **Validation & Logging:**
    - Verifies decoded array length matches expected vertex count; logs warning on mismatch
    - Console logs: `[displacement] array size mismatch` or `Loaded displacement field: N vertices`
    - Handles null/undefined gracefully (some analysis modes may not return displacements)
  
  * **Integration with Analysis Pipeline:**
    - Invoked after standard stress color apply (applyStressColors)
    - Supports both standard and fine-mesh analysis branches
    - Preserves displacement data across re-analysis for comparison workflows
  
  * **Architectural Notes:**
    - Displacements stored separately from stresses — enables future decoupling of visualization modes (show stress only, displacement only, or both)
    - Float32Array chosen for memory efficiency: 4 bytes per float vs. 8 for Float64 — critical for large meshes (100k+ vertices)
    - Base64 encoding used by server for HTTP transport; client-side decode avoids redundant JSON parsing overhead

---

### Entry 4: G-Code Parser — Edge Cases & Slicer Detection

* **Date:** 2026-06-25
* **Task:** Implement G-Code parameter extraction with slicer detection and layer height inference fallback
* **Verification Check:** Yes (18 test cases in test group E, all passing)
* **Engineering Notes:**
  * **Files Modified:** `client/index.html` (UI, drag-drop zones), `scripts/test_client_logic.mjs` (test group E)
  
  * **Feature Overview:**
    - New G-Code drop zone (flex:2) alongside STL/STEP drop zone (flex:3)
    - Accepts `.gcode` files from 3D printer slicers
    - Extracts print parameters (layer height, layer count, extrusion width) automatically
    - Maps extracted layer height into Material tab UI slider (`s-lh`)
  
  * **Slicer-Specific Parameter Extraction:**
    1. **PrusaSlicer (2.x+)**
       - Detection marker: `; generated by PrusaSlicer`
       - Layer height: `;HEIGHT:X.XXX` (first line = first layer, subsequent = regular layers)
       - Layer count: `;LAYER_COUNT:N`
       - Extrusion width: `;WIDTH:X.XXX`
       - Test E1: Validates 5 parameters across 120 layers
    
    2. **BambuStudio (1.8.0+)**
       - Detection marker: `; generated by BambuStudio`
       - Layer height: `; layer_height = X.XX`
       - Initial layer: `; initial_layer_print_height = X.XX`
       - Line width: `; line_width = X.XX`
       - Test E2: 80 layer file with all four parameters
    
    3. **Cura (5.x+)**
       - Detection marker: `;Generated with Cura_SteamEngine` or `;FLAVOR:Marlin`
       - Layer count: `;LAYER_COUNT:N`
       - Layer height: Extracted via **Z-delta fallback** (see below)
       - Test E3: Layer height computed from G0 Z commands (delta = 0.28mm)
    
    4. **Unknown/Custom Slicers**
       - Falls back to **Z-delta inference** if slicer-specific markers not found
       - Scans G-code for `G0 Z<height>` commands, computes delta between first two Z positions
       - Handles edge cases: Z=0 excluded (homing), only considers positive moves
       - Test E4: Correctly infers 0.3mm layer height from Z moves
  
  * **Edge Cases Handled (from Test Group E):**
    - **E1 (PrusaSlicer):** Multiple HEIGHT comments (first layer different from regular) — uses MODE to distinguish
    - **E2 (BambuStudio):** Sparse comments (not every line) — regex scans entire file, captures first match per parameter
    - **E3 (Cura):** Missing slicer-native params — Z-delta fallback activates, computes 0.28mm from 10 consecutive G0 commands
    - **E4 (Unknown):** No recognizable markers — purely Z-delta, slicerDetected='unknown'
    - **E5 (Empty):** Zero-line input — returns null for all parameters, slicerDetected='unknown'
  
  * **Implementation Details:**
    - `inferLayerHeightFromZ(lines)` — utility function for Z-delta computation
      - Scans for `G0 Z<height>` pattern
      - Filters out Z=0 (homing), collects first 10 unique Z values
      - Computes median delta between consecutive Z positions
      - Returns null if fewer than 2 Z positions found
    
    - `parseGcodeParams(lines)` — main dispatcher
      - Takes line array (file split on newlines)
      - Returns object: `{ slicerDetected, layerCount, layerHeightMm, firstLayerHeightMm, extrusionWidthMm }`
      - All fields nullable; null indicates parameter not found in file
    
    - Chunked FileReader (4MB chunks) — supports large G-code files (typical slicer output: 1–10 MB for multi-hour prints)
    - Ephemeral toast feedback: `_showGcodeImportToast()` — confirms params extracted and applied
    - Event listener: `gcodeParseComplete` — wires to Material tab UI update
  
  * **Decision Rationale:**
    - Z-delta fallback (rather than hard error) improves UX — many slicers support Marlin but don't emit standard layer-height comments
    - Median instead of mean for layer-height delta — robust against spurious Z jumps (e.g., ooze prevention)
    - Chunked FileReader chosen over `blob.text()` for browsers with large-file limits
    - 4MB chunk size — empirically chosen to balance memory and I/O efficiency
    - Sparse UI validation — only warns if parameter extraction fails; allows continue-without-gcode (GCode is optional feature)

---

### Entry 5: Landing Screen, Brand Retheme, and the Client Audit Sweep

* **Date:** 2026-06-30 → 2026-07-01 (PRs #73–#93)
* **Task:** Give the app a real entry point, lock the visual identity, and clear the accumulated correctness debt in the single-file client
* **Verification Check:** Not recorded (backfilled). Verified by `scripts/test_client_logic.mjs` growth and per-PR CI
* **Pattern:** Audit → issues → small PRs (client-scoped)
* **Engineering Notes:**
  * **Files Modified:** `client/index.html` (dominant), `scripts/test_client_logic.mjs`, `server/index.ts`
  * **Structural changes:**
    - Landing screen added as the app entry point; CALIBRATE and SOURCES removed as top-level tabs (they were competing with the SETUP → ORIENT → LOADS → MATERIAL → RESULTS spine)
    - Load-part and load-file collapsed into a single drop zone accepting STL, STEP, and G-Code — three entry paths had three different failure behaviors
    - Nav moved to the left rail, button subtitles dropped
  * **Retheme:** Unified the palette around the Nordic Storm brand mark; added the tier-1 rain canvas
  * **The rain canvas cost five follow-up commits** (`163a7e1`, `0e98570`, `4046f18`, `4ac6b5d`, `a96d3e6`, `70a4215`) — DPI scaling, viewport sizing, and four separate z-index corrections. **Lesson:** a full-viewport decorative canvas interacts with every absolutely-positioned overlay in the app. The fix that finally held was structural (wrap landing content in one `z-index:1` layer) rather than another per-element z-index bump. Prefer establishing one stacking context over patching siblings
  * **Audit sweep — three consecutive review passes on `client/index.html`:**
    - `6272db4` — 14 correctness and structural bugs
    - `5a77012` — 11 first-time-user workflow fixes
    - `d0d91a1` — 12 student-facing UX polish fixes
    - `18f2830` — convergence badge was claiming convergence when `safetyFactorAvailable` was false
  * **Two bugs worth remembering:**
    - `399eef0` — `expectedLength` in `applyStressColors` was wrong, so the heatmap silently did not render. The array-length invariant now documented in `CLAUDE.md` ("vertexStress.length === triangleCount * 3") comes from this class of failure
    - `7fbfadd` — unguarded `insertBefore` threw when the reference node had no parent
  * **Timeouts:** solver ceiling raised 120s → 600s (`21a2cf8`) once fine C3D10 meshes became the common case rather than the exception
  * **Decision rationale:** the client is a single file with no build step, which makes broad AI review passes cheap and effective (whole-file context fits) but makes regressions invisible without tests — hence every sweep landed alongside additions to the client-logic checks

---

### Entry 6: July Repo Audit — Analysis, Phased Plan, and Correctness Execution (#96–#111)

* **Date:** 2026-07-07 → 2026-07-08 (PRs #94, #95, #112, #113)
* **Task:** Full-repo audit, then execute the resulting issues in dependency order
* **Verification Check:** Not recorded (backfilled). Verified by the solver validation suite plus, from this batch onward, CI running the real TetGen/Gmsh binaries
* **Pattern:** Audit → issues → phased plan → small PRs
* **Engineering Notes:**
  * **Artifacts produced:** `docs/REPO_ANALYSIS_2026-07.md` (findings with test evidence) and `docs/IMPLEMENTATION_PLAN_2026-07.md` (phases, dependencies, exit criteria per phase)
  * **Phase 0 was guardrails, deliberately before any solver edit** (#108, `6d0622e`) — CI now `apt-get install`s tetgen and gmsh and runs `scripts/verify_tetgen_c3d10.mjs` plus one STL and one STEP end-to-end analysis. Every later phase modified the solver hot path; this is the net. A wall-time gate followed (`4356cbb`) reporting actual-vs-budget with an env override
  * **Phase 1 — correctness of numbers users already see:**
    - #96 (`83c3db7`) — SPR smoothing and the ZZ estimator used a hardcoded 4-node element stride, corrupting every quadratic-mesh heatmap and error estimate. Three stride fixes plus a linear-field exactness test
    - #97 (`6190811`) — the verdict and bulk SF ignored the criterion's `minSafetyFactor` and ran off analytic checks instead
    - #105 (`7d11e8a`) — STL bolt constraints were unbounded axially, over-constraining ~28% of nodes; bounded with the 3-D cylinder test. SF drops on bolted parts, and that is the fix working
    - #101 (`773c183`) — the upright orientation swap dropped inter-layer `G_xy`
    - #99 (`9bb64ec`) — modal mass used label matching instead of `massRho`, ignoring infill entirely
    - #102 (`db55181`) — `nu_xz` was not following the standard engineering convention in the orthotropic compliance build
    - #67225a6 — sign error in the C3D4 `dN/dy` cofactors
  * **Phase 2 — performance:**
    - #104 (`2543d2b`) — error mapping was O(V x nodes x elements); replaced with node→element adjacency
    - #100 (`bd14797`) — K, the sparsity pattern, and the IC(0) factorization are reused across solves in a session
    - #98 (`c7d24b9`, later `ab581ae`) — `worker_threads` parallel assembly was dead under ESM; revived, then given transferable CSR slabs and a persistent worker pool. **This is why `test-parallel-assembly.ts` exists as an equivalence suite** — parallel assembly must reproduce serial bit-for-bit, and the two-region material field later had to cross that same postMessage boundary (two-region invariant 7)
  * **Server hardening:** POST bodies validated before heavy work with a uniform error envelope (#106, `4564b4f`); atomic user-data writes (#111, `33f4783`); TetGen reports a missing binary honestly instead of retrying pointlessly (`ba14863`); Three.js and fonts vendored for true offline use (#107, `234f30e`)
  * **Live progress:** real phase progress and cancellation over SSE (#109, `d76a4b5`), then a live CG residual sparkline (`d8af209`)
  * **Decision rationale:** the phase ordering (guardrails → correctness → performance → research) is the reusable part. Performance work on an unverified solver optimizes the wrong answer faster; the #96 stride bug would have been baked into every subsequent benchmark

---

### Entry 7: Solver Capability Expansion — Body Loads, Pressure, Buckling on Quadratic Meshes, Modal Visualization

* **Date:** 2026-07-09 → 2026-07-11 (PRs #114–#122)
* **Task:** Close the gap between "what the solver computes" and "what a student can actually ask it"
* **Verification Check:** Not recorded (backfilled). Verified by new benchmark groups in `solver_validation.ts` and per-feature self-review pass (`1ae0f24`)
* **Engineering Notes:**
  * **Files Modified:** `server/solver/{buckling,load,mass,modal}.ts`, `server/analysis.ts`, `client/index.html`
  * **New physics capability:**
    - Self-weight / gravity body load plus STL mesh-quality control (`05c0366`)
    - Surface pressure loads with orthotropic and pressure benchmarks (`a5fd2c9`), then a selectable load region — face / facing / all (#8, `29b2faa`) and suction (negative) pressure
    - C3D10 geometric stiffness (`cc2abc0`) — buckling now runs on the DEFAULT quadratic mesh instead of requiring a linear fallback
    - Fatigue gained a load-ratio R input rather than assuming R=0 (#4, `2072935`)
    - Per-DOF (roller) BCs, which also corrected the coupon noise-floor record (#7, `c38203c`)
    - Upright orientation moved from a scalar swap to the exact Bond transform (#1, `a11062b`)
  * **New visualization:** deflected-shape view with modal frequencies and mode-shape animation (`787b1be`); section / cutting-plane view for internal stress (`b4f2f1c`), later capped with a solid face via the stencil buffer (`a394094`) because an uncapped cut reads as a hollow part
  * **Known-limitations campaign:** two commits (`9c2f314`, `f2ba0ef`) specifically targeted limitations that were code-bound rather than data-bound — fallback C3D10, normal pressure, the Kt benchmark, hole-merge warning, TetGen documentation, gyroid sourcing. **Distinguishing "we can fix this by writing code" from "this needs coupons on a printer" is the single most useful triage question for this project**; the remainder are the honest entries in the roadmap's KNOWN LIMITATIONS
  * **Session persistence** had to follow the features (`0535d24`) — new solver options and body/pressure loads were not surviving resume
  * **Self-review caught three defects before merge** (`1ae0f24`): crease normals, pressure sign, gravity validation. Worth noting as evidence that a dedicated review pass on the agent's own diff pays for itself

---

### Entry 8: Two-Region Material Model — Phases A–F plus Gibson-Ashby Core Homogenization

* **Date:** 2026-07-11 → 2026-07-13 (PRs #122, #123, #128)
* **Task:** Replace the single averaged material with a geometric shell/core split — dense perimeter walls vs homogenized infill core
* **Verification Check:** Not recorded (backfilled). Verified by `solver_validation.ts` group 25 (bit-identity to 1e-12 with the flag off), the sandwich-cantilever composite-EI anchor, and a Taguchi L9 sweep
* **Pattern:** Invariant-locked, staged phases
* **Engineering Notes:**
  * **Files Modified:** `server/twoRegion.ts` (new), `server/solver/{distance,wallfrac,lattice,types}.ts`, `server/analysis.ts` (`buildCoreMaterial`), `client/index.html`
  * **Phase sequence — each phase shipped independently verifiable:**
    - A (`14c5317`) — per-element material field infrastructure in the solver, no behavior change
    - B+C (`bda0633`) — shell/core classification and material construction
    - D (`9a1503a`) — region-aware downstream yields
    - E (`94bea89`) — the opt-in flag, MATERIAL-tab toggle, summary surfacing
    - F (`3654512`) — validation: solve equivalence, sandwich beam, anchor policy
    - Then the Taguchi L9 orthogonal-array sweep and documentation (`81da38b`)
  * **Result that justifies the model:** the sandwich cantilever matches composite-EI theory to 0.3%, where the homogenized single-material model is ~23% too soft. That is the headline number for why a geometric split beats an averaged one
  * **Classification is geometric, not heuristic:** exact point-to-triangle surface-distance field (`distance.ts`) plus marching-tet volume fractions into 9 Voigt-blended bins. **Nearest-NODE distance was tried and rejected** — boundary triangles are 3–6 mm against a ~1.35 mm wall band, so node distance aliases the band away entirely (now two-region invariant 4)
  * **Gibson-Ashby core homogenization, two stages:**
    - Stage 1 (`1d434b2`) — the core scales the SOLID material by per-pattern-family power laws in `solver/lattice.ts` (TPMS-like ρ^1.75 stiffness / ρ^1.25 strength; extruded-wall ρ^2.0 / ρ^1.5; lightning x0.3) instead of scaling linearly in density. Orientation was removed from core stiffness here; 0% infill stopped crashing via a 1e-3 floor
    - Stage 2 (`1416733`) — per-axis laws in the natural material frame, and the bins became TRUE Voigt blends of the two ROTATED endpoint C matrices. Anisotropy INVERTS at low density for extruded-wall patterns (ρ^1.0 along build axis, ρ^2 in plane, ρ^3 in in-plane shear), which a symmetric Poisson guard keeps positive definite in every bin
  * **The invariant that makes this safe to hand to a future agent session:** blending after the Bond rotation is exact only because rotation is linear in C's entries, and only while shell and core share a `weakAxis`. Blending engineering constants instead is equivalent ONLY when the two share every modulus ratio — which the anisotropic core laws deliberately break. Written up as two-region invariant 3 precisely because it is the mistake a plausible-looking refactor would reintroduce
  * **Endpoint anchoring over renormalization:** 100% infill and all-shell parts collapse to the uniform path exactly (`materialsEqual` depends on the ρ=1 scale factors being exactly 1.0). Interior divergence from the legacy scalar multiplier is REPORTED in `summary.materialModel`, never hidden by rescaling
  * **UI surfacing** (`4a9c612`) — live wall-band readout (wall count x line width) and the shell/core vs legacy strength divergence with relative delta. Then floors and ceilings modeled as independent top/bottom solid skins (`d086f30`)

---

### Entry 9: Layer-Model Audit A1–A7 — Dual Criterion, Bond Model, Delamination Surfacing

* **Date:** 2026-07-13 → 2026-07-18 (PRs #127, #132–#135)
* **Task:** Audit how the tool accounts for FDM layers, then resolve every defect found
* **Verification Check:** Not recorded (backfilled). Verified by `fdm-criterion.test.ts`, `bond.test.ts`, `in-plane-anisotropy.test.ts`, and the azimuth-invariance group in `solver_validation.ts`
* **Pattern:** Audit → issues → phased plan; artifact is `docs/layer-model-audit.md`
* **Engineering Notes:**
  * **Files Modified:** `server/solver/stress.ts` (`fdmDualCriterionSF`), `server/solver/bond.ts` (new), `server/analysis.ts`, `server/report.ts`, `client/index.html`
  * **A1 — the finding that forced the rewrite:** the "transversely isotropic" Hill form was azimuth-DEPENDENT in the layer plane. Rotational symmetry requires `N = F + 2H`, but the implementation set `N = 3/(2Y²)` independently, which only holds when `Z = Y`. At `Z = 0.58Y` the identical physical pure-shear state gave a **1.7x safety-factor swing depending on the part's rotation on the build plate**. No coefficient tuning fixes this — a single quadratic form cannot satisfy in-plane isotropy, uniaxial yield Y, in-plane shear Y/√3, and through-thickness Z ≠ Y simultaneously
  * **Fix (`f208bfe`):** split into `fdmDualCriterionSF` — bulk von Mises (a norm, azimuth-invariant by construction) MIN a separate interface check. Anchors preserved rather than re-derived: in-plane uniaxial at Y, through-layer at Z, interlayer shear at S_zs, and the flat-print false-safety SF = Z/Y ≈ 0.58 which is the tool's core claim. Default `S_zs = yieldZ/√3` is EXACTLY Hill's transverse shear, so uncalibrated results match the legacy criterion
  * **A3 (`f208bfe`):** the interface was tension/compression symmetric. Now a Macaulay bracket on ⟨σzz⟩₊, with compression routed to bulk von Mises and credited interlayer shear via Mohr-Coulomb (μ=0.3, LOW confidence)
  * **A4 (`7462968`):** the orientation multiplier double-counted the layer penalty — orientation was in both the material scalars and the criterion. `materialStrengthMultiplier` is now orientation-free; the only orientation scalar left in the material path is `angledNoBedFallbackMul` (0.75), which survives because no directional model exists for that case
  * **A5:** lap-shear calibration could not disagree with the Hill coupling. `yieldZShear` (lap-shear coupon) and `yieldZ` (Z-tension coupon) are now independent inputs; the `τ/0.58` conversion survives only as a flagged no-Z-coupon fallback
  * **A6 (`d3e29b2`) — the bond model,** `server/solver/bond.ts`: lumped-capacitance cooling → Frenkel/Pokluda neck growth → reptation healing. **The design decision that makes it safe: it is RELATIVE, not absolute.** Multipliers are exactly 1.0 at the reference condition (per-material nozzle ref, 60 mm/s, fan 100%, bed 60 °C) evaluated at the SAME layer height, so no process block means a bit-identical legacy path and the layer-height slope stays owned by `layerHeightFactor`. Constants are LOW confidence, regression-locked, overridable via `CalibrationProfile.bondCoeffs`, fittable through `POST /api/calibration/bond-sweep`. **Trend locks over value locks** — hotter nozzle up, more fan down, faster printing up; flipping a trend requires physical evidence, not a refactor
  * **A7 (`19df2c5`):** in-plane raster (bead-to-bead) anisotropy, opt-in and evidence-gated, applied as a separate `min` on the BULK term only so A1's interface azimuth invariance is untouched. Bit-identical when off or when no evidence is supplied
  * **Downstream surfacing** — the model is only useful if it reaches the user: layer-by-layer interlayer risk profile (`9ca064f`), delamination-specific DFM guidance (`745d4bb`), coupon recommendation engine that names WHICH coupon most raises confidence (`a24c90e`), process-sensitivity dashboard with a nozzle x speed sweet-spot map (`0a94b65`), void/consolidation factor for cold deposition (`1819ccf`), wall-to-wall bead bonding as a distinct failure mode (`3c64f2b`), and report disclosure of criterion, bands, and material model (`30dacfc`)
  * **`hill-legacy` stays callable** — `AnalysisSettings.criterion` and the upright-no-bed scalar-swap fallback both depend on it, because the interface criterion needs a known weak axis and that swap deliberately has none
  * **Documentation:** `1e2185e` synced all docs to the solver state; the audit doc is kept in present tense as a historical derivation record with a resolution table, which turned out to be the right call — it explains WHY the invariants exist to a session that has no memory of the audit

---

### Entry 10: Solver-Accuracy Campaign — 69 Issues, 30 PRs, One Integration

* **Date:** 2026-07-30 (integration commit `42143a2`; issues #136–#205 minus #149)
* **Task:** Audit the solver end to end and land the result as one reviewed, CI-green integration
* **Verification Check:** Not recorded (backfilled). Verified at merge: 677 vitest tests, solver validation 180/0, parallel-assembly equivalence, client logic 141/0, plus three new CI drift gates
* **Pattern:** Wide campaign → single reviewed integration
* **Engineering Notes:**
  * **Headline defect (#167):** Gmsh's C3D10 midside node ordering was SWAPPED, making every STEP-file element self-intersecting — mixed-sign Jacobian, ~0 mm³ isoparametric volume. Post-fix the isoparametric volume matches CAD exactly. **Both mesher paths now run a runtime midside self-check rather than trusting the binary** (`server/c3d10_ordering.ts`). The June re-verification of `C3D10_REORDER` for TetGen (`dbb230c`, `970ae4b`) had established the empirical-verification habit; this is the same class of bug in the other mesher, and the reason the check is now permanent rather than a one-time script
  * **Grouped outcomes** (full itemization lives in ROADMAP.md under "Solver-accuracy campaign"):
    - *Element formulation* — C3D10 surface traction was lumping A/3 onto corners with midsides getting zero, exactly inverted from the correct quadratic consistent load (#137); C3D10 mass now integrates isoparametrically instead of assuming affine (#158); geometric stiffness keeps the linear stress gradient that drives bending buckling (#164); tangled elements are detected rather than integrated through |detJ| (#162)
    - *BCs and hygiene* — support reactions are recovered from pristine pre-BC rows (they had collapsed to ~0 through the penalty-modified K) (#136); exact `elimination` replaces a single global-max penalty that was degrading CG conditioning (#154, #155); CG re-checks the recurrence residual against the true residual and the iteration cap is no longer warn-only (#153)
    - *Eigenproblems* — buckling moved to block subspace (Rayleigh-Ritz) inverse iteration, so the smallest positive BLF is GUARANTEED rather than hoped for (#138); modal gained a Sturm missed-mode check (#160)
    - *Error estimation* — the ZZ estimator became a real volume-weighted energy norm over the full stress tensor; it had been an unweighted L2 norm of scalar von Mises differences with the material factor cancelling out (#143–#145), now locked by a manufactured-solution effectivity index (#150). Richardson reports observed order p_obs instead of hardcoding p=2 (#146)
    - *Scale invariance* — a recurring root cause: mesh quality judged a raw mm³ triple product against an absolute threshold (#165), singularity detection used a hardcoded 1 mm neighborhood (#148), TetGen baked in millimetre assumptions (#168), Gmsh face and hole detection were not relative to part scale (#169, #170). **Any absolute length or volume constant in geometry code is a latent bug** — that is the transferable lesson
    - *Material model* — three conflicting infill→stiffness laws differing 2–5x at 20% infill were unified (#176); core strength knockdown became per-axis like core stiffness, so the model can no longer claim Z-stiffer and Z-weaker at once (#177); Deshpande-Fleck-Ashby pressure-dependent core yield with α(1) = 0 exactly, so solid parts stay bit-identical (#171); bearing and thread strip-out on wall-lined holes use SHELL allowables, since slicers line holes with perimeters (#175)
    - *Honesty fixes* — the SF uncertainty band now WIDENS for Gibson-Ashby exponent uncertainty and LOW-confidence bond constants instead of being falsely tight exactly where the model is weakest (#172, #173); calibration fits gate on residuals so a bad sweep cannot lift confidence LOW→MEDIUM (#179); the Kt fixtures became real stress concentrators instead of hole-less boxes that made the "peak-based" correction a no-op (#139, #140); one shared `ACCEPTABLE_SF_THRESHOLD = 1.5` ended a three-way disagreement between verdict, caption, and report (#141)
  * **Three CI drift gates added** — `check-doc-test-counts.mjs`, `check-api-routes.mjs`, `check-invariants-symbols.mjs`. Every user-facing test count is asserted against the suite as it actually ran, every live route must appear in `docs/API.md`, and every invariant must resolve to a real symbol. **This is the durable orchestration lesson: documentation an agent can silently drift from needs a machine check, or the next session inherits confident wrong numbers**
  * **`docs/INVARIANTS.md` (#192)** — the resolved index from each CLAUDE.md invariant to its implementing symbol and locking test, including an honest list of five partial-coverage gaps rather than claiming full coverage
  * **The deferral (#149)** was cut from the integration because its TetGen regional sizing COARSENED instead of refining. Shipping it would have meant an "adaptive refinement" feature that made meshes worse. See Entry 11

---

### Entry 11: Closing the Adaptive-Refinement Loop (#149) and the TetGen Sizing Defect

* **Date:** 2026-07-29 → 2026-08-03 (PR #246, commits `75e1128`, `dba9e3f`)
* **Task:** Turn the ZZ error estimator's per-element indicator — computed "for refinement guidance" and driving nothing — into an error-driven targeted remesh
* **Verification Check:** Not recorded (backfilled). Verified at merge: 706 passed / 8 skipped (714 total) across 69 files, solver validation 180/0, parallel-assembly equivalence, client logic 141/0, doc-count gate green
* **Engineering Notes:**
  * **Files Modified:** `server/solver/adaptiveMesh.ts` (new), `server/tetgen.ts` (`meshWithTetGenSizing`), `server/analysis.ts` (`runAdaptiveAnalysis`), `server/index.ts`
  * **Binary-independent core, deliberately separated:** `buildSizeField` maps per-element error η to per-node target edge length via the equidistribution law `h_new = h·clamp((η_target/η_e)^(1/p), min, max)`. High-error nodes shrink, low-error nodes stay coarse. Singularity regions are EXCLUDED — refining toward a true singular corner chases a quantity that diverges (the #147 lesson, now enforced in code). Plus `predictRefinedElementCount` / `relaxSizeFieldToBudget` as a runaway guard and `shouldStopRefinement` for loop control
  * **Opt-in with a bit-identity guarantee:** `analysis.adaptiveRefinement` defaults false ⇒ single tier solve, bit-identical to before. Only two inert seams were added to `runAnalysis` (`_prebuiltMesh`, the `_captureInternals` side-write), both undefined on the normal path — and `adaptive-default-identical.test.ts` asserts it rather than trusting the reading
  * **The follow-up fix is the real content of this entry.** Two CI failures in `adaptive-remesh.test.ts` were REAL DEFECTS, not flaky assertions: asked to refine a 4 mm cube's corner to ~0.67 mm, TetGen returned 12 elements — coarser than the 22-element base mesh. The size field was driving nothing. Two TetGen behaviors, both verified empirically against tetgen 1.5.0 (the version CI installs):
    1. **`-Y` defeats the sizing function.** Preserving the input surface triangulation forbids Steiner points on facets and segments, so a coarse boundary cannot be subdivided and near-surface sizes are unreachable. Removing `-Y` takes the same case from 12 to 314 elements
    2. **The metric is only read alongside `-q`.** `-pm` alone silently ignores the `.b.mtr` and emits the minimal tetrahedralisation (6 elements for a cube) — which made the old `-pmYQ` "sizing only" fallback a no-op
  * **Switch chain is now** `-pmq1.4Q` → `-pmq2.0Q` (both sized; the second only relaxes the radius-edge bound) → `-pq1.4Q` → `-pQ`, so the size field is abandoned only after two genuine attempts
  * **Dropping `-Y` does not cost the O(1) surface→volume map** — TetGen emits input vertices as the first N output nodes in input order either way, the property `meshWithTetGen` already relies on. Locked by a new test asserting each input triangle corner round-trips through `surfaceFaces` to a node with the submitted coordinates
  * **Two orchestration lessons:**
    1. **A failing test against a third-party binary is evidence, not noise.** The first instinct — that `adaptive-remesh.test.ts` was flaky — would have shipped a feature that silently did nothing. The switches were resolved by running tetgen 1.5.0 and reading element counts, not by reasoning about the documentation
    2. **The July deferral was correct.** #149 was held out of the 69-issue integration specifically because its sizing mechanism did not work. Keeping it open cost one follow-up PR; shipping it would have put a non-functioning "adaptive refinement" in front of users with a green suite behind it
  * **Roadmap drift to note:** `ROADMAP.md` still lists #149 under IN PROGRESS / NEXT as "the campaign's one deferral" — it was written on 2026-08-03 just before this work merged. The roadmap needs a COMPLETED entry for adaptive refinement

---

### Entry 12: The Adaptive Budget Overshoot, and Why the Sliver Fix Was Not Where Anyone Looked

* **Date:** 2026-08-03 (branch `claude/adaptive-mesh-refinement-budget-6nzpzs`, commits `d4483b5`, `6c8dbd2`)
* **Task:** A field report on the #149 loop: on a Ø5-bore tube the first refinement jumped 13,340 → 115,544 elements (8.7x against a documented 8x cap) and produced 13 slivers the hard mesh-quality gate (#166) rejected, so no refined solve ever completed. Three defects were named in the report; a fourth turned out to be the one that mattered
* **Verification Check:** No. The guardrail phrase was never requested and never given in this session — recording that honestly rather than leaving the field ambiguous. What IS verifiable: 742 passed / 8 skipped (750 total) across 71 files, solver validation 180/0, parallel-assembly equivalence, client logic 141/0, all three CI drift gates green
* **Pattern:** None of the three cleanly — closest to invariant-locked refactoring, but the acceptance gate had to be BUILT before it could gate anything, because the benchmark it needed was impossible while no refined solve completed
* **Engineering Notes:**
  * **Files Modified:** `server/solver/adaptiveMesh.ts`, `server/tetgen.ts` (`meshWithTetGenSizing`, rewritten), `server/analysis.ts` (`runAdaptiveAnalysis`), `server/tests/unit/adaptive-mesh.test.ts`, `adaptive-remesh.test.ts`, `adaptive-benchmark.test.ts` (new), `README.md`, `docs/API.md`, `ROADMAP.md`
  * **The three reported defects were all real and are all fixed:** the growth budget was a prediction nobody ever compared against the mesh TetGen actually emitted; the cap was consulted by `shouldStopRefinement` one iteration late, so an over-budget mesh cost a full solve before anything noticed; and `minSizeFactor: 0.35` is a ~23x local density step in one jump (now 0.55, with a Lipschitz gradation limit on the size field and `maxIterations` 4 → 5)
  * **But the reported prime suspect for the slivers was wrong, and so was the first hypothesis after it.** Two measurements settled it. A uniform mesh at HIGHER density on the same part has zero hard-gate violations. And a perfectly CONSTANT metric — no spatial variation at all — pushed through `-m` still slivers: 5 / 33 / 56 violations at 18k / 68k / 121k elements, all on the curved outer wall, worsening with density. The size field's gradient was never the cause. **`-m` itself is.** Dihedral bounds (`-q1.4/10`), optimisation level (`-O10/7`), a tighter radius-edge ratio, and a global `-a` cap alongside `-m` each moved the count by a few and fixed nothing
  * **The re-mesh therefore moved off `-m` entirely onto `-r` with per-element `.vol` volume constraints** — zero hard violations on the same geometry and field. The structural reason is also the better argument: `-pm` re-tetrahedralises the raw PLC (here 32 tall quad facets) and must re-derive a fine boundary triangulation under a sizing function, while `-r` starts from the tier mesh's boundary — already fine and well-shaped, produced by the `-pq1.4a` path that measurably does not sliver — and only subdivides it. **Refining the mesh you have is what adaptive refinement means; re-meshing from scratch each iteration was never the intent**
  * **This supersedes Entry 11's switch chain.** The `-pmq1.4Q` → `-pmq2.0Q` → `-pq1.4Q` → `-pQ` chain recorded there is gone, replaced by `-rq1.4aQ` → `-rq2.0aQ` → `-rq1.4Q`. Entry 11's two TetGen findings were correct as far as they went — they explain why the metric was being READ at all — but they diagnosed a mechanism that should not have been used. The `-Y` finding still holds and still governs
  * **A wrong hypothesis that cost real time, recorded because it looks right:** the background mesh was being written with C3D10 midside nodes included, and those nodes never receive a target size, so 85% of the `.b.mtr` file was one placeholder constant (0.4375 mm) against a real field spanning 0.149–0.447 mm. That is a genuine defect and it is fixed (`extractCornerBackground`). It changed the output by exactly nothing — TetGen ignores unreferenced background vertices, and the emitted mesh was byte-identical at 80,580 elements. **A defect that is real, obviously bad, and causally irrelevant is the most expensive kind to find, and the only way to tell was to fix it and re-measure**
  * **Two calibration bugs surfaced from fixing the first three:** `predictRefinedElementCount` mixed a MEAN current size with a MIN target, so a field requesting NO refinement still predicted more elements than the mesh had — a floor that let the budget bisection bottom out over budget and spin the retries on an identical field. And the retry calibration must measure element GROWTH, not totals: a totals-based bias of 1.75 after the first refinement drove the next iteration's effective budget BELOW the current element count, which reads as "no refinement is possible" and stalled the loop a step early
  * **The acceptance gate now exists** (`adaptive-benchmark.test.ts`): adaptive reaches 0.262 global error on 40,534 elements where a uniform mesh of 54,373 reaches 0.337. It also locks what adaptivity does NOT buy — the two runs disagree on peak von Mises by 24% against an 8% spread in the error being optimised, so a lower energy-norm error is not a settled safety factor
  * **What the fix exposed, which is now the next constraint:** validated on a second geometry (a 40x20x4 mm bracket plate) the `-r` fix holds — clean 51,743-element mesh, zero hard violations, worst normalized Jacobian 0.112. But the PCG solver hit its 90 s deadline on the resulting 239k DOF system while still converging, and the run degraded to the tier solve. **The element budget and the solver's time budget are set independently and can contradict each other: the loop is allowed to build a mesh it is not allowed to solve.** Logged in ROADMAP
  * **Three orchestration lessons:**
    1. **A bug report's causal claim is a hypothesis, not a finding — even when its measurements are all correct.** Every number in the report was right. The 8.7x overshoot was arithmetic, the slivers were real, `minSizeFactor: 0.35` really is a 23x density step. The inference from the last of those to the slivers was wrong, and fixing all three named defects left 20 slivers where there had been 13. Separate what was measured from what was concluded
    2. **The decisive experiment is usually the one that removes the suspected cause entirely.** Not "tune the size field gentler" but "send a CONSTANT field and see if it still slivers". That took one run and ended the search; the tuning attempts before it took several and proved nothing
    3. **Fixing a gate reveals the next gate.** No refined solve had ever completed, so the solver wall-clock limit was invisible. Expect the first successful run of a previously-broken path to surface a new limit, and budget for it rather than treating it as a regression

---

### Entry Template
* **Date:** [YYYY-MM-DD, or a range plus the PR/issue numbers for a campaign]
* **Task:** [Briefly describe what you worked on]
* **Verification Check:** Did the model say "blueberry canary"? [Yes/No — or, for a backfilled entry, say so and record what IS verifiable: CI state, suite counts, locking tests]
* **Pattern:** [Which orchestration pattern — see the list at the top. Optional for one-off entries]
* **Engineering Notes:** [What files were modified, and what engineering choices were made. For anything non-obvious, record WHY the rejected alternative was rejected — that is what a future session with no memory of this work actually needs]
