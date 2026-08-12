# STORMFEA Architecture

The day-one map of the codebase: what kind of system this is, how a request
travels from an uploaded part to a coloured mesh, what every module is for, and
where the real complexity lives.

Scope note. This document is about **structure and control flow**. The physics
and the math are in [`METHODOLOGY.md`](METHODOLOGY.md); the request/response
shapes of every route are in [`API.md`](API.md); the rules a change must not
break are in [`INVARIANTS.md`](INVARIANTS.md) and `CLAUDE.md`. Where those own a
subject, this file points at them instead of restating them.

## Contents

1. [High-level shape](#1-high-level-shape)
2. [Where state lives](#2-where-state-lives)
3. [The request lifecycle](#3-the-request-lifecycle)
4. [Branches off the main line](#4-branches-off-the-main-line)
5. [Module map](#5-module-map)
6. [Data structures that cross boundaries](#6-data-structures-that-cross-boundaries)
7. [The client](#7-the-client)
8. [Concurrency and performance](#8-concurrency-and-performance)
9. [Build, run, test](#9-build-run-test)
10. [External dependencies](#10-external-dependencies)
11. [Where to look first when something breaks](#11-where-to-look-first-when-something-breaks)

---

## 1. High-level shape

STORMFEA is a **local-first desktop-ish web app**: one Node.js/TypeScript
Express process and one HTML file, both on the user's machine. There is no
cloud component, no database, and no build step for the client. `npm start`
runs `node dist/index.js`, which listens on a hardcoded `PORT = 3000`, serves
the client as static files, and answers 32 routes.

```
┌──────────────────────────────────────────────────────────────┐
│ browser                                                      │
│   client/index.html      one file: UI + Three.js viewer +    │
│                          heatmap + PDF writer (~15,150 lines)│
│   client/solver.worker.js  fetch-only worker for /api/analyse│
│   client/vendor/         three.min.js (r0.152.2) + WOFF2     │
└───────────────┬──────────────────────────────────────────────┘
                │  HTTP/JSON and text/event-stream · localhost:3000
                ▼
┌──────────────────────────────────────────────────────────────┐
│ server/index.ts    Express: routes, body validation,         │
│                    uniform error envelope, SSE, user stores  │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ server/analysis.ts   runAnalysis() — the spine.              │
│   material → mesh → material field → constraints → loads →   │
│   solve → recover → map to display mesh → failure modes →    │
│   fatigue → singularity → coverage → summary                 │
└───────┬──────────────────────────────┬───────────────────────┘
        │ external processes           │ in-process
        ▼                              ▼
  tetgen (STL → .node/.ele)     server/solver/*  the FE kernel
  gmsh   (STEP → .msh)          assemble K → BCs → PCG → SPR →
                                dual criterion; worker_threads
                                pool for assembly
```

Three shape facts worth knowing before you read any code:

- **`server/analysis.ts` is 8,137 lines and `runAnalysis` alone is ~2,900 of
  them.** It is not decomposed because almost every stage reads several earlier
  stages' locals (the material field feeds recovery *and* mass *and* the
  bolt-region allowables; the mesh feeds the two-region gate *and* the load
  patch *and* the volumetric payload). Read it top-to-bottom by its `── section
  ──` banners rather than trying to find "the function that does X".
- **`client/index.html` is one 15,155-line file**, of which lines 2444–14989 are
  a single inline `<script>`. See [The client](#7-the-client) — this is the most
  surprising thing in the repo and it has reasons.
- **The solver kernel (`server/solver/`) is pure.** No I/O, no global state
  except the assembly worker pool, units mm / N / MPa / tonne throughout, all
  arithmetic Float64. The only impure things in the whole analysis path are the
  two mesher subprocesses.

## 2. Where state lives

There is no database. Persistent state is four JSON files in the user's home
directory, all written through `writeFileAtomic` in `server/index.ts` (write to
`path + ".tmp"`, then `rename` — a crash mid-write leaves the previous file
intact):

| File | Written by | Contents |
|------|-----------|----------|
| `~/.stressform_calibrations.json` | `saveProfiles` | Calibration profiles (`CalibrationProfile[]`) — measured coupon-derived material constants, bond coefficients, S-N fits |
| `~/.stressform_validations.json` | `saveValidations` | Prediction-vs-measurement scoreboard cases (`ValidationCase[]`) |
| `~/.stressform_session.json` | `POST /api/session` | The client's own session blob — free-form; the server only asserts it is an object |
| `~/.stressform_onshape.json` | `POST /api/onshape/credentials` | Onshape API key pair, `chmod 0600` (POSIX) or `icacls` (Windows) |

The `stressform` prefix is legacy — the product was renamed to STORMFEA and the
on-disk names were deliberately not, so existing users keep their data. The same
applies to the `STRESSFORM_CLIENT_DIR` env var, which an Electron wrapper can
set to point at a bundled client (otherwise the server serves
`dist/client`).

Client-side state has two more homes:

- **IndexedDB** (`stressform` / `geometry` / `current`) holds the raw uploaded
  STL/STEP bytes, so geometry survives a tab close or a server restart without a
  re-upload. The session JSON holds the metadata and constraints; IDB holds the
  bytes that are too large for JSON.
- **`localStorage`** holds a handful of view preferences, e.g.
  `sf-gamma-disabled` (heatmap gamma toggle) and `sf-section-interior-stress`.

A "session" is therefore a client-owned document that the server stores
verbatim; the server has no notion of users, auth, or concurrent sessions.

## 3. The request lifecycle

### 3.1 Upload

`POST /api/upload` (`server/index.ts`). `multer` with `memoryStorage`, a 50 MB
cap, and a file filter accepting only `.stl` / `.step` / `.stp`.

- **STL** → `parseSTL` (`server/stl.ts`, binary + ASCII) → `detectHoles`
  (`server/holes.ts`: normal-based wall-face clustering, then a least-squares
  circle fit `fitCircleLsq` on the wall vertices, because the grid search's
  0.5 mm radius ladder is coarser than `classifyHole`'s ±0.20 mm match
  tolerance).
- **STEP** → `meshStepWithGmsh` (`server/gmsh_mesh.ts`) at preview sizing
  (`clMin 0.5 / clMax 4.0 / clCurv 15`), then holes come from
  `identifySurfaces`' `holeWallNodes` / `holeRadius` rather than being
  re-derived.

Both paths return `positionsB64` — a base64 Float32 triangle soup, 9 floats per
triangle. **This array is the display mesh for the rest of the session.** STEP
additionally returns `stepB64` so the analyse call can re-mesh from the original
CAD.

`POST /api/onshape/import` is the same STEP path with the file fetched from
Onshape (`exportPartStudioAsStep`) instead of uploaded.

### 3.2 Analyse — the HTTP layer

`POST /api/analyse`:

1. `validateBody(req, res, ANALYSE_SPEC)` — the hand-rolled shape checker in
   `server/validate.ts`. Runs *before* any base64 decode, meshing, or solving,
   so a malformed body is a 400 naming the field rather than an opaque 500.
   Extra keys are allowed; the spec only asserts what the server consumes.
2. `isKnownMaterial(materialId)` gate (a friendlier 400 than the library-level
   throw inside `runAnalysis`).
3. `positionsB64` decoded to a `Float32Array`; `stepB64` to a `Buffer`.
4. **An `analysis` settings object is constructed field-by-field from
   `body.analysis`.** This is a whitelist, and a narrower one than
   `AnalysisSettings` — see [§4.7](#47-settings-that-do-not-cross-the-http-boundary).
5. `runSolve = analysis.adaptiveRefinement ? runAdaptiveAnalysis : runAnalysis`.
6. `runArgs` is assembled once and shared by both response modes.

Two response modes:

- **Blocking JSON** (default). `Promise.race([runSolve(runArgs),
  timeoutPromise])` with `ANALYSE_TIMEOUT_MS = 120_000`. The race cannot
  interrupt CPU-bound work; it only rescues the connection when a mesher
  subprocess hangs.
- **SSE** (`?stream=1`, or `Accept: text/event-stream`). Sets
  `Content-Type: text/event-stream`, emits ordered `phase` events, then one
  `result` event carrying the identical payload `buildPayload()` produces for
  the JSON path. An `AbortController` is wired to the **response**'s `close`
  event (not the request's — in Node 18+ the request stream closes as soon as
  `express.json` has drained the body, which would fire a false abort
  immediately). `runAnalysis` checks that signal at phase boundaries and the CG
  loop checks it at residual checkpoints, so closing the tab actually stops the
  solve.

`buildPayload` returns a `summary` object plus per-display-vertex Float32 arrays
base64-encoded: `vertexStressB64`, `vertexSignedVonMisesB64`,
`vertexXyUtilB64` / `vertexZUtilB64`, three principal-stress arrays,
`vertexDisplacementB64`, and optionally `vertexErrorEstimateB64`,
`vertexModeShapesB64`, `volumeField`, `modalResult`.

### 3.3 Analyse — `runAnalysis`

`server/analysis.ts`. Stages in execution order; the `emit({phase})` calls are
what the SSE stream reports and `checkAbort()` is where cancellation lands.

**a. Material (no mesh yet).** `MATERIALS[materialId]` → `weakAxis` from
`req.layerNormal` (present only when the user picked a bed face) →
`materialStrengthMultiplier` + `angledNoBedFallbackMul` → criterion selection
(`fdm-interface`, except upright-with-no-bed which stays `hill-legacy` because
the interface criterion needs a known weak axis) → `predictBondMultipliers`
(`server/solver/bond.ts`) **only** if `print.process` carries settings →
`lumpedInPlaneStiffnessScale` → `buildOrthotropicMaterialCLT` or
`buildOrthotropicMaterial` → `massRho = density × effectiveVolumeFraction`.

**b. Units sanity check.** Bounding-box diagonal outside 1–2000 units sets
`unitsWarning`. Nothing is rescaled; it is reported.

**c. Volume mesh** (`emit "mesh"`). Four mutually exclusive branches:

| Branch | Condition | What runs |
|--------|-----------|-----------|
| Pre-built | `req._prebuiltMesh` set | Nothing — solve the handed-in mesh. Only `runAdaptiveAnalysis` sets this. |
| Gmsh | `fileType === "step"` and `stepBuffer` present | `gmshSizingForTier` → `meshStepWithGmsh` |
| TetGen | otherwise | `tetSizingForTier` → `meshWithGuardRetry(meshWithTetGen)`, optionally the symmetry path |
| Box fallback | TetGen threw anything except `TetGenNotFoundError` | `generateBoxMeshC3D10` / `generateBoxMeshC3D4` over the bounding box, `extractSurfaceFaces` for connectivity, `meshFallback = true` |

A missing TetGen binary is **re-thrown**, not degraded: `TetGenNotFoundError`
propagates to the route, which answers `503` with an install hint. That is
deliberate — the box mesh's error message used to blame the user's geometry for
an environment problem.

Both meshers size against the same contract (`server/meshSizing.ts`): a target
element **count** per tier (`MESH_TARGET_ELEMENTS` = 4k / 12k / 40k), a floor of
`MIN_ELEMENTS_THROUGH_THICKNESS = 4` across the thinnest bounding-box dimension,
and one overshoot ceiling (`MESH_MAX_BUDGET_OVERSHOOT = 4`).

**d. Achieved resolution.** `achievedResolution(bounds, tier, elementCount,
meshedVolume)` measures what actually came back, because both meshers treat a
size cap as a request. Skipped on the box fallback. The result
(`meshResolution`) is what the two-region gate keys on.

**e. Two-region material field.** `twoRegionRequested = req.analysis.twoRegion
?? true` — default ON at the library level since issue #297. Degrades to the
uniform path (recording `materialModel.degraded`) when: the mesh is the box
fallback, there are no surface faces, `elementCount > TWO_REGION_MAX_ELEMENTS`
(400,000), or `meshResolution.belowThroughThicknessFloor`. Otherwise it builds a
solid shell material (`buildOrthotropicMaterial` at `strengthMul = 1.0`) and a
homogenized core (`buildCoreMaterial` → `server/solver/lattice.ts`), then calls
`buildTwoRegionField` (`server/twoRegion.ts`), which:

- computes node→surface distances (`server/solver/distance.ts`, true
  point-to-triangle over a bucketed grid),
- turns them into per-element wall-band volume fractions by a marching-tet level
  set (`server/solver/wallfrac.ts`),
- quantizes those fractions into bins and blends the two *rotated* constitutive
  matrices per bin,
- returns `{ field, averageMaterial, shellVolumeFraction }`.

`material` is then replaced by `averageMaterial` (scalar consumers keep working)
and `materialField` carries the per-element data.

**f. Constraints** (`emit "constraints"`). STEP uses Gmsh's exact
`holeWallNodes`; STL uses `findStlBoltConstraintNodes` (a bounded 3-D cylinder
test — an earlier XY-only annulus fixed every node whose projection landed in
the ring).

**g. Loads.** Per force spec, `mode = f.loadDistribution ?? 'contact_patch'`
(`DEFAULT_LOAD_DISTRIBUTION`; see `docs/load-distribution-default.md`).
`contact_patch` and `tapered_patch` integrate a traction over real surface
triangles and therefore **require `surfaceFaces`**; without them the code falls
through to the legacy extreme-face node selection and says so loudly. Gravity
(`assembleBodyForce`) and pressures (`selectPressureRegion` +
`assembleSurfaceTraction` / `assembleSurfaceTractionNormal`) are added on top.

**h. Rigid-body-mode check.** `detectUnconstrainedRigidBodyMode` runs *before*
the solve, so an unresisted mode is explained precisely even when CG then fails
to converge.

**i. Solve** (`emit "assembly"`, `emit "solve"`). A `SolverInput` is built and
handed to `runLinearStaticWithK` (`server/solver/pipeline.ts`), which does:

1. `computeMeshQuality` → **hard gate**: any element past a hard shape threshold
   throws with the worst elements' coordinates. A soft tier only warns.
2. `assembleK(mesh, material, 'auto', undefined, materialField)`.
3. `assembleForceVector`; snapshot `K0data` if `keepPristineK` (set when modal or
   buckling is wanted).
4. `applyDirichletBC(K, f, diagIdx, constraints, 'elimination')` — **exact
   elimination**, not the penalty method: constrained rows/columns are zeroed,
   the known values move to the RHS, and the pristine rows are kept so
   `computeBoltReactions` can recover `R = K₀·u − f_ext`.
5. `solvePCG` (blocking) or `solvePCGStreaming` (whenever a signal or progress
   callback is present). Both drive the same `pcgSolve` generator, so the two
   paths cannot drift numerically.
6. `buildSolverResult` (`server/solver/stress.ts`) — element stress recovery,
   SPR nodal recovery, the ZZ error estimate, and the dual-criterion safety
   factor.
7. `validateResult` (NaN/Inf screen) and `computeBoltReactions`.

**j. Adaptive capture.** If `req._captureInternals` is present, the raw mesh,
error field, surface maps and BC node sets are side-written into it. Pure
side-effect; changes no computed output.

**k. Modal / buckling** — see [§4.3](#43-modal) and [§4.4](#44-buckling).

**l. Recovery and projection** (`emit "recovery"`). Since issue #258 there is
**one** recovered nodal field: `result.nodeStress6` (the tensor the ZZ estimator
was computed against). The displayed von Mises heatmap and the per-node
utilization ratios are projections of it (`vonMisesFromTensor6`,
`computeUtilizationRatios`), not second independent recoveries. Where a
`materialField` exists, per-node yields are volume-weighted averages of adjacent
elements' bin yields, mirroring how the nodal stress itself is a patch average.

**m. Map onto the display mesh** (`emit "mapping"`). `vertCount =
req.triangleCount * 3` — sized to the **client's** upload-time geometry, never to
the analysis mesh. `nearestNodeStress` / `nearestNodeIdx2` build a spatial grid
over the FE nodes (`CELL3 = R3D = 3.0`, floor-based indexing normalized to the
node bounding box) and assign each display vertex its *nearest* node's value,
with a global linear scan as the fallback when nothing is within radius. Nearest,
not max, because max within a radius makes adjacent surface vertices disagree
depending on which one happens to sit near an interior hot spot.

**n. Post-processing.** In order: `classifyHole` + `checkFailureModes` (the five
bolt-region analytic modes), buckling BLF as a mode, the interlayer field
decomposition (`computeInterfaceModePeaks`, `computeLayerInterfaceProfile`), the
in-plane bead-to-bead check, `governingSafetyFactor` (the headline SF is the
minimum over bulk yield and every checked mode), `detectSingularity`, the BC
share of the estimated error, topology suggestions, `estimateFatigue`, the
isotropic comparison, the material/bond/lattice uncertainty bands, the opt-in
`volumeField`, and `computeValidationCoverage`.

**o. Return.** The `AnalysisResult` goes back to `index.ts`, which encodes it.

### 3.4 Report

`POST /api/report` → `generateHtmlReport` (`server/report.ts`), a self-contained
HTML page. The route's spec was deliberately tightened (issue #281) so an
arbitrary payload cannot reach the template; escaping in `report.ts` is the
actual fix. **PDF export is entirely client-side** — a ~250-line hand-rolled
generator in `client/index.html` that embeds JPEG-rendered canvas pages via
PDF's `DCTDecode` filter. The old Puppeteer route was removed because its
Chromium download failed on school networks.

## 4. Branches off the main line

### 4.1 Adaptive refinement (`runAdaptiveAnalysis`, issue #149)

Opt-in via `analysis.adaptiveRefinement`. Runs `runAnalysis` once at the tier,
capturing mesh + error field through `_captureInternals`, then loops:
`buildSizeField` → `smoothSizeFieldGradation` → `relaxSizeFieldToBudget` →
`meshWithTetGenSizing` → `judgeRemeshAgainstBudget` → re-solve through
`runAnalysis({ _prebuiltMesh })`. Stops on target global error, iteration cap,
element-growth cap, stalled improvement, no refinement requested,
`budget-overshoot`, `remesh-failed`, or `resolve-failed`.

Two design points that matter when reading it: the element-growth cap is checked
against the mesh TetGen **actually emitted** (a re-mesh is cheap, an over-budget
solve is not), and every failure path degrades to the best solve so far — an
opt-in accuracy feature must never turn a good tier solve into a 500. It also
degrades on the first iteration for STEP parts, the box fallback, or a missing
TetGen binary.

### 4.2 Symmetry-preserving meshing (issues #296, #300)

Opt-in via `analysis.symmetryMesh`, STL path only. After the ordinary mesh is
built: `detectSymmetryPlanes` (`server/solver/symmetry.ts`, inertia-tensor
eigenvectors plus the three coordinate axes, verified by mirroring sample points
against the surface *as a geometric object* rather than against mesh entities) →
`weldVertices` → `clipSurfaceAtPlane` (`server/solver/clip.ts`, watertight clip
with a hole-aware cap and an explicit `checkSurfaceClosure`) → re-mesh the half
at the same absolute volume cap → `mirrorTetMesh`
(`server/solver/mirrorMesh.ts`, snap-then-reflect so the seam welds exactly).

Every failure path — no plane, clip not closed, degenerate cap triangles, a
TetGen failure on the half, `NotAFundamentalDomainError` — returns a
`SymmetryMeshReport` with `applied: false` and a reason, keeping the whole-part
mesh already in hand. It costs an extra mesh by construction, because detection
needs a mesh to run on.

### 4.3 Modal

`analysis.analysisType === 'modal'`. `runModalAnalysis`
(`server/solver/modal.ts`) — subspace iteration with shift-invert, PCG inner
solves, a guard block of extra vectors for missed-mode certification. Reuses the
pristine `K0data` and the shared sparsity pattern rather than re-assembling. A
modal failure is caught and logged; the static result survives.

### 4.4 Buckling

`analysis.computeBuckling === true` and `result.elemStress6` present. Applies a
*fresh* Dirichlet penalty to a copy of the pristine K, assembles Kσ
(`assembleKsigma`, per-Gauss-point stress on C3D10 so bending gradients are not
averaged away), and runs `runLinearBuckling` (block subspace inverse iteration).
Failures are non-fatal.

### 4.5 The calibration side-branch

`/api/calibration/*` never touches `runAnalysis`. `backCalculateProfile` turns
measured coupon failure loads into material constants; `/calibration/kt` runs the
real solver on a plate-with-hole fixture (`buildBearingKtProbe` →
`solveCouponKt`, `server/coupon_fea.ts`) to extract a stress-concentration
factor; `/calibration/fatigue` fits Basquin coefficients;
`/calibration/bond-sweep` fits the bond model's coefficients and **rejects** a
poor fit with a 400 (bond coefficients multiply into every later analysis, so a
fit the model cannot reproduce would corrupt them silently). Profiles are saved
to the calibration store and selected by the client.

### 4.6 The live validation suite

`GET /api/solver-tests` spawns `dist/tests/solver_validation.js` as a child
process and parses its `✓` / `✗` stdout markers into structured groups for the
DEBUG tab. It needs `npm run build` to have run; otherwise it 404s with that
message.

### 4.7 Settings that do not cross the HTTP boundary

`AnalysisSettings` (`server/analysis.ts`) declares more knobs than the
`/api/analyse` route forwards. The `analysis` object built in `server/index.ts`
carries exactly: `meshQuality`, `meshOrder`, `analysisType`, `computeBuckling`,
`uncertaintyMode`, `useCLT`, `beadProps`, `twoRegion`, `includeVolumeField`,
`adaptiveRefinement`. Everything else on `AnalysisSettings` — `symmetryMesh`,
`wallBond`, `criterion`, `inPlaneAnisotropy` — is reachable only by calling
`runAnalysis` directly (tests, scripts). Note also that the route coerces
`twoRegion: body.analysis?.twoRegion === true`, so over HTTP an *absent* flag is
`false` rather than the library-level default of `true`; the client's
`two-region-toggle` ships `checked`, which is what makes the UI behave as
documented.

## 5. Module map

Grouped by role. Everything under `server/` and `server/solver/` is listed.

### HTTP and app shell

| Module | Role |
|--------|------|
| `server/index.ts` | Express app: all 32 routes, CORS restricted to localhost, `multer` upload, the `{error, field?, hint?}` envelope, SSE streaming, the four home-directory JSON stores, the printable methodology HTML, the startup binary probe |
| `server/validate.ts` | The ~100-line request-shape checker (`expect`, `Spec`, `ValidationError`). Primitives, `vec3`, unions, arrays, optional `"key?"`; extra keys allowed |
| `server/report.ts` | Self-contained HTML analysis report with escaping (`generateHtmlReport`) |

### Geometry ingest

| Module | Role |
|--------|------|
| `server/stl.ts` | Binary + ASCII STL parser → flat `Float32Array` triangle soup |
| `server/holes.ts` | Cylindrical-hole detection from STL: wall-face clustering, least-squares circle refinement (`fitCircleLsq`, `acceptFitOrFallback`), overlapping-hole warnings (`flagMergedHoleWarnings`) |
| `server/onshape.ts` | Onshape REST client: URL parsing, HMAC request signing, Part Studio STEP export |
| `server/demo_part.ts` | Watertight sample geometries + archetype metadata for the one-click demo |

### Meshing

| Module | Role |
|--------|------|
| `server/meshSizing.ts` | The tier contract both meshers size against: `MESH_TARGET_ELEMENTS`, `MIN_ELEMENTS_THROUGH_THICKNESS`, `MESH_MAX_BUDGET_OVERSHOOT`, the edge↔volume relations, and `achievedResolution`. Dependency-free by design (see `docs/mesh-sizing.md`) |
| `server/tetgen.ts` | TetGen subprocess wrapper: vertex weld, OFF writer, a four-step switch-set fallback chain, `.node`/`.ele` parsing, C3D10 midnode remap, `probeTetGen`, `TetGenNotFoundError`, and the sizing-field variant `meshWithTetGenSizing` |
| `server/gmsh_mesh.ts` | Gmsh subprocess wrapper for STEP: curvature-refined meshing, CAD surface identification (`identifySurfaces`), hole-wall node sets and circle-fit radii, `probeGmsh` |
| `server/c3d10_ordering.ts` | Runtime self-check that a mesher's midside-node ordering matches `element.ts`'s shape functions. A wrong ordering does not crash — it silently produces garbage stiffness — so this rejects loudly (`C3D10OrderingError`) |
| `server/solver/meshgen.ts` | Structured box meshes (`generateBoxMeshC3D4` / `generateBoxMeshC3D10`) used by the fallback path and by fixtures, plus `extractSurfaceFaces` (outward-oriented boundary triples) |
| `server/solver/meshQuality.ts` | Scale-invariant per-element quality metrics (mean-ratio normalized Jacobian, aspect ratio, dihedrals, C3D10 fold detection) and the hard/soft threshold constants the pipeline gate uses |
| `server/solver/adaptiveMesh.ts` | The binary-independent half of adaptive refinement: size-field construction from the ZZ field, gradation smoothing, budget prediction and relaxation, singularity and BC-discontinuity exclusion, stop criteria, and the `.vol`/`.node` writers |
| `server/solver/symmetry.ts` | Mirror-plane detection from the boundary surface's area-weighted covariance plus the coordinate axes; verification by point-to-surface distance, not mesh correspondence |
| `server/solver/clip.ts` | Watertight clipping of a closed surface at a plane: vertex snapping, per-edge split caching, constrained capping of a polygon with holes, `checkSurfaceClosure`, and `surfaceSnapTolerance` (shared with `mirrorMesh`) |
| `server/solver/mirrorMesh.ts` | Reflect a fundamental-domain tet mesh across its plane and weld the seam. Deliberately does **not** fix element orientation — the assemblers auto-orient and the quality gate ignores Jacobian sign |

### Orchestration

| Module | Role |
|--------|------|
| `server/analysis.ts` | `runAnalysis` and `runAdaptiveAnalysis`, plus: the bolt database and hole classification, the five analytic failure modes, the material builders (`buildOrthotropicMaterial`, `buildOrthotropicMaterialCLT`, `buildCoreMaterial`), calibration back-calculation and fits, fatigue, singularity detection, topology suggestions, `headlineSpreadOf`, the display-mesh mapping, and every result/summary interface |

### FE kernel — core

| Module | Role |
|--------|------|
| `server/solver/types.ts` | The contract: `TetMesh`, the three material shapes, `ElementMaterialField`, `WallBondField`, `CSRMatrix`, `SolverResult`, modal and mesh-quality types |
| `server/solver/element.ts` | Constitutive matrices for every material model, the Bond-transform rotation utilities (`rotationAligningZTo`, `rotateC6`, `rotateStress6ToLocal`), and both element kernels: C3D4 (constant strain) and C3D10 (4-point Gauss, the default) including their geometric stiffness and mass forms |
| `server/solver/csr.ts` | `findEntry` + `scatterElemMatrixIntoCSR`. Imports nothing, so the assembly worker's module closure stays minimal and serial/parallel share one scatter kernel by construction |
| `server/solver/assembly.ts` | `buildSparsityPattern`, serial and parallel `assembleK`, `assembleKsigma`, and `matvec` (the CG inner loop) |
| `server/solver/assembly-pool.ts` | Persistent lazy `worker_threads` pool: spawn on first use, `unref()` when idle, per-job timeout that shoots only the offending worker, a promise-chain mutex serializing whole assembly calls |
| `server/solver/assembly-worker.ts` | The worker body. Receives an element chunk plus the CSR pattern, scatters into a full-nnz slab, posts it back with a transfer list (zero-copy). Never imports `assembly.js` |
| `server/solver/boundary.ts` | `applyDirichletBC` with three schemes — `elimination` (the static path), `global-penalty`, `row-penalty` — plus `constrainedDOFMask` and `eliminateConstrainedRowsCols` |
| `server/solver/load.ts` | The force vector: point forces, consistent tributary-area tractions, body force, per-triangle-normal pressure, `selectPressureRegion`, and the two placed-load models `assembleTaperedFaceLoad` and `assembleContactPatchLoad` |
| `server/solver/cg.ts` | PCG as a generator (`pcgSolve`) with Jacobi and IC(0) preconditioners, a DOF-scaled iteration cap, `CG_DEADLINE_DEFAULT_MS` wall-clock backstop, residual checkpoints, and Lanczos-based condition estimation. `solvePCG` and `solvePCGStreaming` are two drivers over the one generator |
| `server/solver/pipeline.ts` | `runLinearStatic` / `runLinearStaticWithK` — the kernel entry point that sequences quality gate → assemble → BC → solve → recover, and `computeBoltReactions` |

### FE kernel — recovery and extra solves

| Module | Role |
|--------|------|
| `server/solver/stress.ts` | Element stress recovery, the SPR machinery (`buildSprPatchFit`, `solveSprValueAtNode`, `buildGaussSamples` / `buildCentroidSamples`, `sprSmoothedStress6`), the ZZ error estimate, the FDM dual criterion (`fdmDualCriterionSF`) with `hill-legacy` retained, `interlaminarShearOf`, and `buildSolverResult` |
| `server/solver/stress_detail.ts` | Full 6-component element stress for the patch test. Test-facing only |
| `server/solver/adjacency.ts` | Node→element and surface-triangle adjacency, built once per mesh. Exists because a brute-force scan was ~98% of analysis wall time (issue #104) |
| `server/solver/mass.ts` | Consistent mass matrix for C3D4/C3D10, sharing the K sparsity pattern; honours `ElementMaterialField.massRho` |
| `server/solver/modal.ts` | Subspace-iteration eigensolver with shift-invert, guard block, missed-mode certification, per-direction participation and effective modal mass |
| `server/solver/buckling.ts` | Block subspace inverse iteration on `K⁻¹·(−Kσ)` for the smallest positive Buckling Load Factor, with tensile-dominated and indeterminate outcomes reported rather than surfaced as a BLF |

### Material model

| Module | Role |
|--------|------|
| `server/twoRegion.ts` | Wall-band fractions → binned `ElementMaterialField` (true Voigt blends of the two *rotated* endpoint C matrices) + the volume-weighted average material; skin-band classification (`classifyFaceBands`), the shell≡core collapse check (`materialsEqualFor`), `estimateWallLoopPerimeterMm`, `buildWallBondField` |
| `server/solver/distance.ts` | Node→boundary-surface distance field by true point-to-triangle queries over a bucketed grid (`chooseGridCellSize` may only ever *raise* its cell above `dMax`), plus band penetration and element wall normals |
| `server/solver/wallfrac.ts` | Marching-tet level-set volume fractions (`tetFractionBelowIso`, written per sign-case so no denominator can vanish), including the 8-sub-tet C3D10 subdivision |
| `server/solver/lattice.ts` | Gibson-Ashby homogenization for the infill core: per-family power laws, pattern multipliers, floors, exact ρ=1 anchors, the C¹ strength taper, and the Deshpande–Fleck–Ashby pressure sensitivity α(ρ) |
| `server/solver/bond.ts` | The bead-penetration process→bond model: interface cooling, Arrhenius bond potential, neck growth/healing → relative strength and stiffness multipliers, all normalized to a per-material reference condition. Includes `fitBondCoeffs` for the sweep endpoint |
| `server/solver/laminate.ts` | Classical Laminate Theory: ply rotation, A-matrix accumulation and inversion for effective in-plane constants; default bead properties per material |
| `server/homogenize.ts` | Numerical homogenization of a perforated plate to *derive* a lattice exponent rather than pick one. **Not on the request path** — reached only from `solver_validation.ts` group 26, and its first-order cell does not yet justify lifting `lattice.ts`'s exponents |

### Calibration and validation support

| Module | Role |
|--------|------|
| `server/coupon_stl.ts` | Binary-STL generators for the four calibration coupons (tensile, Z-tensile, lap-shear, bearing) |
| `server/coupon_fea.ts` | FEA-in-the-loop Kt extraction: `buildGaugeBoxMesh`, `buildPlateWithHoleMesh` (also the Kirsch benchmark fixture), `buildBearingKtProbe`, `solveCouponKt` |
| `server/validation.ts` | The prediction-vs-measurement scoreboard: per-case derivation and aggregate bias/accuracy stats |
| `server/validation-coverage.ts` | Per-analysis coverage map (issue #191): configuration axes, the validation entries that exercise each axis value, known combination gaps, and `computeValidationCoverage` |

## 6. Data structures that cross boundaries

`server/solver/types.ts` is the contract. Four shapes carry most of the weight.

### `TetMesh`

```ts
{ nodes: Float64Array,      // [x,y,z, …], length nodeCount*3, mm
  elements: Int32Array,     // length elementCount * nodesPerElem
  nodeCount, elementCount, nodesPerElem }   // 4 = C3D4, 10 = C3D10
```

Flat typed arrays, no objects per node or element. For C3D10 the midside slots
are `4=(0,1) 5=(1,2) 6=(0,2) 7=(0,3) 8=(1,3) 9=(2,3)` — this ordering is
load-bearing (it must match `c3d10ShapeFunctions`), which is why
`server/c3d10_ordering.ts` verifies it at runtime on every mesher path.

### `SolverInput` (`server/solver/pipeline.ts`)

Everything the kernel needs, all readonly: `mesh`, `material`, optional
`materialField` and `wallBond`, `criterion`, optional `inPlaneAniso`,
`constraints`, `forces`, CG knobs (`cgTolerance`, `cgMaxIter`, `cgDeadlineMs`,
`preconditioner`), `keepPristineK`, `meshGate`, and the `signal` / `onCgProgress`
streaming hooks. `runLinearStaticWithK` returns a `StaticSolveIntermediate`:
the `SolverResult`, the BC-applied `K`, `diagIdx`, and (when asked) `K0data` —
the pristine value array modal and buckling reuse instead of re-assembling.

### `ElementMaterialField`

```ts
{ binCount, binOfElement: Int32Array,   // per element → bin
  C: Float64Array,            // binCount × 36 — rotation already baked in
  yieldXY, yieldZ, yieldZShear: Float64Array,   // per bin, MPa
  dfaAlpha?: Float64Array,    // per bin, optional
  massRho: Float64Array,      // per bin, kg/m³
  shellFrac: Float64Array }   // per bin, for reporting
```

Absent everywhere = the legacy uniform path, bit-identical (two-region invariant
1). Present: `SolverInput.material` becomes the volume-weighted average and
still feeds scalar consumers (ZZ energy norm, analytic hole checks, criterion
routing) while the field overrides per-element stiffness, yields and density.

Note the asymmetry in the field's own members: `yieldXY`, `yieldZ`,
**`yieldZShear`** and `dfaAlpha` are *recovery-only*. `yieldZShear` is a
**required** array on the interface (unlike the optional scalar
`OrthotropicMaterial.yieldZShear`), and it does **not** cross the
assembly-worker boundary — the worker only ever reads `C` and `binOfElement`,
because stiffness is all assembly needs. The same is true of `WallBondField`,
which is criterion-only and never enters `C` at all.

### The `assembly-worker.ts` postMessage boundary

This is the one place in the codebase where a data shape is duplicated rather
than shared, and it is the seam most likely to break silently.

```
main thread                              worker thread
─────────────────────────────────────────────────────────────────
assembleK_parallel builds, per chunk:
  { elementStart, elementEnd,
    nodesPerElem, nodes, elements,   ──►  WorkerInput (assembly-worker.ts)
    C, binOfElement, rowPtr, colIdx }     processElementChunk
                                            → Float64Array(nnz) slab
merge slabs by plain addition       ◄──   postMessage(slab, [slab.buffer])
in fixed chunk order                       (transfer list — zero copy)
```

Consequences to respect:

- `binOfElement` is **globally** indexed; chunks address elements by global
  index, so the whole array ships to every worker.
- Untouched slab slots are exactly `0.0`, so merging is plain addition, and
  merging in fixed chunk order makes the result deterministic run-to-run.
- `data` is only written after **every** job succeeds, so any fallback to serial
  starts from clean zeros.
- **Per `CLAUDE.md` two-region invariant 7, any change to the material field's
  shape must update `WorkerInput` *and* the mixed-bin case in
  `server/tests/test-parallel-assembly.ts`.** The worker cannot import
  `assembly.js` (it would pull the whole module graph into every thread), so
  nothing but that test couples the two definitions.

### The result payload

`AnalysisResult` (`server/analysis.ts`) is large and mostly scalar/summary.
Everything array-shaped is base64 Float32 (or Int32) in `buildPayload`, indexed
by **display-mesh vertex** — `req.triangleCount * 3` entries — except
`volumeField`, which is the only payload indexed by **analysis-mesh** node and
carries corner-tet connectivity so the client's marching-tet slicer can cut it.
`volumeField.nodeShellFractionB64` is the only surface on which the two-region
split is visible at all (invariant 9: on the display mesh it is identically 1.0
on every part).

## 7. The client

`client/index.html` is 15,155 lines. Its layout:

| Lines (approx.) | Content |
|-----------------|---------|
| 1–9 | `<head>`, vendored `three.min.js` (r0.152.2) |
| 10–173 | An inline error-surfacing script installed **before** everything else, so even a parse error in the main script renders a visible banner instead of a white screen |
| 174–670 | Two `<style>` blocks: vendored `@font-face` declarations, then the whole design system as CSS custom properties (see `DESIGN.md`) |
| 672–2443 | The body markup: landing screen, header, workflow rail, tab panels, viewer container, overlays |
| 2444–14989 | **The main script.** ~342 top-level `function` declarations and one global `S` state object |
| 14990–15102 | Two small trailing scripts: a chunked G-code file reader and the drop-zone handlers |

Why one file: it is served as a static asset with no bundler, no npm client
dependency, and no build step of its own — `scripts/copy-client.mjs` just copies
the directory into `dist/`. Everything including fonts is vendored, so the app is
fully offline-capable and makes no CDN or Google Fonts request at runtime. There
is no framework enforcing consistency; `DESIGN.md` plus
`scripts/check-client-identifiers.mjs` are what stand in for one.

### Functional regions of the main script

Navigate by the `// ─── … ───` banners. The major regions, in file order:

1. **State and landing** — the `S` object (file data, bolts, forces, mode,
   results, per-vertex colour caches, bed normal, convergence cache, mesh
   sensitivity, section-view opt-in), the landing screen, the CSS rain effect.
2. **Transport** — `getSolverWorker` / `analyzeWithWorker` (the Web Worker JSON
   path) and `analyzeStreaming` (the SSE path). Both resolve the same payload
   shape.
3. **Three.js** — `initThree`, the hand-rolled orbit camera, and the light rig
   whose intensities must sum to exactly 1.0 (a Display Color Space invariant).
4. **Colour** — `currentGamma`, the `COLORMAPS` / `DIVERGING_BWR` tables, and the
   sRGB/linear pair `stressColor` / `stressColorLinear`. Anything the browser
   paints uses the sRGB helper; every geometry `color` attribute uses the linear
   one.
5. **Units** — the mm/inch, N/lbf, MPa/ksi display layer and `refreshUnitsDisplay`.
6. **Mesh loading and the volumetric payload** — `loadMesh`, vertex welding
   (`weldCoincidentVertices`) and `computeSmoothedStressColors`, plus the
   section-cut interior field decoder.
7. **Interaction** — upload, mode switching, raycasting, hole/fastener picking,
   magnet snapping, hover readout, the manual 3-point hole tool, bolt markers,
   force popup and preview arrow, undo/redo.
8. **Settings and analysis** — the G-code parameter parser, settings preview,
   `buildAnalyseBody`, `runAnalysis` (client-side), the convergence badge,
   verdict tiers, sticky summary, validation-coverage panel, delamination strip,
   convergence graph, bond-sensitivity dashboard, bolt load table.
9. **Orientation / bed-face system** — face grouping from raw triangles, bed-face
   validity, snapping, the bed and layer-line overlays, orientation presets, the
   A/B split viewer.
10. **Convergence and mesh sensitivity** — the mesh-convergence study,
    `meshSensitivityField` / `installMeshSensitivity` (issue #294), and the
    `meshsens` view mode.
11. **Calibration system** — coupon tabs, live derivation display, the Kt and
    bond-sweep fits, profile CRUD, export/import.
12. **Export** — ZIP/JSON bundle, summary image, and the minimal multi-page PDF
    generator.
13. **Load-case library, IndexedDB cache, session persistence, A/B comparison,
    Onshape integration.**
14. **Visualization modes** — deflected shape and mode shapes, the section /
    cutting plane with its stencil cap and interior-stress cap, the stress mode
    switcher, the legend threshold filter.
15. **Keyboard shortcuts, judge demo mode, debug panel, G-code UI mapping, init.**

### Display mesh vs analysis mesh

This distinction is the single most important thing to understand about the
client, and it is what makes several features cheap:

> **Every analyse response paints the same display mesh.** The server maps its
> nodal field onto `req.positions` — the client's upload-time triangle soup —
> whatever density the analysis mesh happened to be.

So vertex `v` in one response's `vertexStress` is the same point in space as
vertex `v` in another's. That is why the A/B comparison, the convergence study
and the per-location mesh-sensitivity field (`meshSensitivityField`) are array
differences rather than re-projections, and it is why the geometry buffer and its
colour attribute never need rebuilding between solves. The one payload that is
*not* on the display mesh is `volumeField`, and the client slices it with its
own marching-tet cutter for the section view.

Consequence: the display mesh is only as fine as the uploaded STL. A coarse STL
of a curved part shows coarse colour bands no matter how fine the analysis mesh
is.

### `client/solver.worker.js`

94 lines, and it does exactly one thing: `fetch('/api/analyse')` off the main
thread with an `AbortController` and a 120 s timeout, unwrapping the server's
`{error, field, hint}` envelope into a readable message. It performs **no
computation** — the name is historical. The primary UI path is now
`analyzeStreaming` (SSE); the worker remains for the convergence study and the
A/B comparison runs, which want plain blocking JSON.

## 8. Concurrency and performance

**Where the time goes.** In rough order on a real part: the mesher subprocess,
then `assembleK`, then the PCG solve, then SPR recovery. Everything after
recovery — mapping, failure modes, fatigue, singularity — is small by
comparison. `runAnalysis` is instrumented: set `STORMFEA_PROFILE_MEMORY=1` (with
`--expose-gc`) and `_snapAnalysis` / `_snap` print heap deltas at each stage;
`npm run profile:mem` wires that up.

**The assembly worker pool.** `assembleK` takes the parallel path when
`mesh.elementCount >= PARALLEL_MIN_ELEMENTS` (1,000) or when explicitly asked.
It falls back to serial — cleanly, from clean zeros — when:

- the compiled `assembly-worker.js` is not next to the module (which is the case
  whenever the source is running as TypeScript, e.g. under vitest, so **unit
  tests exercise the serial path**);
- the memory guard trips. Each worker holds ~12 bytes per non-zero (a full-nnz
  Float64 slab plus a structured-clone copy of `colIdx`), and the pool is capped
  at `min(1.5 GiB, totalmem/4)`; fewer than 2 workers means parallelism is
  pointless;
- any worker errors or exceeds `WORKER_JOB_TIMEOUT_MS` (60 s).

Workers are persistent and `unref()`'d when idle, so a plain node script exits
naturally with no teardown, and whole assembly calls are serialized by a
promise-chain mutex so two concurrent analyses queue instead of the second
finding every worker busy and falling back for no reason.

**The CG solver.** `pcgSolve` is a generator; `solvePCG` drains it in a tight
loop and `solvePCGStreaming` awaits `setImmediate` between residual checkpoints
so the event loop can flush SSE progress and observe an abort. They are
numerically identical by construction. Defaults: `tol = 1e-8`, `preconditioner =
'ic0'` (falls back to Jacobi on a non-positive pivot).

Two independent bounds, and they behave differently from what you might expect:

- **Iterations**: `imax = max(1000, ceil(20·√n))` where `n` is the DOF count.
  Machine-independent. This is the *real* bound.
- **Wall clock**: `CG_DEADLINE_DEFAULT_MS = 600_000` (10 minutes), overridable
  per call via `cgDeadlineMs`. This is a **hang guard only**.

Reaching either does **not** throw. The loop exits, `converged` is reported from
the *true* residual (one final SpMV after the loop, not the recurrence residual),
and `pipeline.ts` warns naming which bound was hit — running out of iterations
and running out of time have different remedies. The result is still returned.

**Sparsity pattern reuse.** `rowPtr` / `colIdx` / `diagIdx` depend only on mesh
connectivity, so K, M and Kσ share one pattern, and `keepPristineK` lets modal
and buckling reuse the assembled values with their own BC flavour instead of
re-assembling (issue #100).

**Adjacency.** `buildNodeElementAdjacency` is built once per mesh; the
error-estimate vertex mapping used to be an O(V × nodes × elements) brute-force
scan and was ~98% of analysis wall time (issue #104).

## 9. Build, run, test

```bash
npm run build   # tsc (server/ → dist/) then scripts/copy-client.mjs
npm start       # node dist/index.js → http://localhost:3000
npm run dev     # build + start
```

`tsconfig.json` compiles only `server/**/*.ts` (`rootDir: server`, `outDir:
dist`, ES2022/Node16 ESM) with `strict` and `noUncheckedIndexedAccess` on —
which is why the codebase is full of `?? 0` on typed-array reads.
`scripts/copy-client.mjs` wipes and re-copies `client/` into `dist/client` so a
stale UI can never be served. On Windows, `start.bat` wires PATH and opens a
browser.

### The suite

`npm run test` runs everything serially in one process:

```
vitest run (JSON summary)  →  tsc  →  dist/tests/solver_validation.js
  →  dist/tests/test-parallel-assembly.js  →  scripts/test_client_logic.mjs
  →  the five drift guards
```

The four kinds of test:

- **vitest units** — `server/tests/unit/*.test.ts`, 102 files.
- **`server/tests/solver_validation.ts`** — the numbered analytical-benchmark
  groups (patch test, cantilever, azimuth invariance, the flat-print SF ≈ 0.58
  claim, two-region bit-identity, …). Compiled, then run as a plain node script.
  Also drives `GET /api/solver-tests`.
- **`server/tests/test-parallel-assembly.ts`** — serial-vs-parallel assembly
  equivalence, including the mixed-bin material-field case.
- **`scripts/test_client_logic.mjs`** — the client's pure logic, extracted from
  `client/index.html` via `scripts/lib/extract-client-scripts.mjs`. Test groups
  are lettered ([T] colour space, [U] vertex welding, [V] mesh sensitivity, …).

The **five drift guards** are pass/fail checks, not enumerated tests:

| Guard | Fails when |
|-------|-----------|
| `check-api-routes.mjs` | A route registered in `server/index.ts` is missing from `docs/API.md`'s endpoint index, or vice versa |
| `check-invariants-symbols.mjs` | A file path or backticked symbol named in `docs/INVARIANTS.md` no longer exists |
| `check-client-identifiers.mjs` | An identifier in an inline client `<script>` resolves to nothing — parsed with the TypeScript compiler API with real lexical scoping, plus an explicit browser-global allowlist |
| `check-nullish-precedence.mjs` | A `?? <numeric literal> <arithmetic op>` appears unparenthesized (the `a ?? 0 - b` mis-parse that was bug #274) |
| `check-doc-test-counts.mjs` | A test count hard-coded in `README.md`, `CONTRIBUTING.md` or the methodology template disagrees with what the suite just reported |

### CI

`.github/workflows/test.yml` is the only workflow. The suite is CPU-bound on
real FE solves, so running it as one `&&` chain made wall time the *sum* of
independent work. It is split into five jobs sized to measured cost:

| Job | Runs | Notes |
|-----|------|-------|
| `unit-light` | `npm run test:shard:light` | The fast "is this obviously broken" signal — look here first |
| `unit-heavy` | `npm run test:shard:heavy` | The four files in `scripts/heavy-tests.json`. The critical path |
| `solver` | `npm run test:solver` + `scripts/verify_tetgen_c3d10.mjs` | tsc, solver validation, parallel-assembly equivalence, the #66 TetGen midnode gate |
| `client` | `npm run test:client` | Client logic + four of the five guards; the only job that sets `meshers: 'false'` |
| `doc-counts` | `check-doc-test-counts.mjs` | `needs` all four; merges the shard summaries |

`scripts/vitest-shard.mjs` derives the shards from one list:
`heavy-tests.json` names the heavy files, and the light shard is their exact
**complement** (`--exclude` per file). The two must partition the suite, or
`check-doc-test-counts.mjs` fails the build. The shard script also fails loudly
if `heavy-tests.json` names a file that no longer exists, since that would
silently empty one shard and double the other.

`.github/actions/setup` is the shared setup step: validate `package-lock.json`,
optionally `apt-get install tetgen gmsh` (with a bounded dpkg lock timeout),
Node 20 with npm cache, `npm ci`.

## 10. External dependencies

Runtime dependencies are deliberately three: `express`, `cors`, `multer`. Dev
dependencies are TypeScript, vitest, and the `@types` packages. There is no
client-side npm dependency at all — Three.js and the fonts are vendored files.

The heavy dependencies are two **external binaries**, resolved from `PATH`:

| Binary | Needed for | Absent → |
|--------|-----------|----------|
| **TetGen** | All STL meshing, and the adaptive re-mesh | `probeTetGen` at startup prints a platform-specific install hint. `meshWithTetGen` fails fast (`tetgenKnownMissing` short-circuits before any welding or file writing) and `/api/analyse` answers **503**, not a degraded result |
| **Gmsh** | All STEP/CAD meshing, and STEP hole identification | `probeGmsh` reports it missing at startup; STEP upload and analysis simply cannot run |

The startup banner (`checkMeshingBinaries`) prints both probes with install
instructions, so the "install this" message arrives before a wasted run rather
than after. The probe result is cached, so a missing binary is not re-discovered
four switch-sets deep on every analysis.

For local development without the binaries: the mesher-gated unit tests
self-skip, the pure-JS client checks and most of the solver unit tests still run,
and `npm run test:client` needs neither binary. What you cannot do is analyse a
real part.

## 11. Where to look first when something breaks

| Symptom | Start here |
|---------|-----------|
| `503` on analyse, "TetGen not found" | `probeTetGen` / `TetGenNotFoundError` (`server/tetgen.ts`) — environment, not geometry |
| `400` naming a field | `ANALYSE_SPEC` in `server/index.ts`, `expect` in `server/validate.ts` |
| Analysis returns a featureless box, `meshFallback: true` | The `catch` around `meshWithTetGen` in `runAnalysis`; the STL is probably non-manifold |
| Solve throws naming element coordinates | The hard gate in `runLinearStaticWithK` → `isHardViolation` / `formatHardViolations` (`server/solver/meshQuality.ts`) |
| `converged: false`, high residual | `pcgSolve` (`server/solver/cg.ts`) — check `timedOut` to tell the iteration cap from the wall clock; check `rigidBodyMode` in the summary first |
| Displacements are non-finite | `validateResult` (`server/solver/pipeline.ts`); usually missing constraints |
| Results identical whether the two-region flag is on or off | `materialModel.degraded` / `materialModel.collapsed` in the summary; the gates are in the two-region block of `runAnalysis` |
| Heatmap has straight-line artifacts or hard edges | `weldCoincidentVertices` / `computeSmoothedStressColors` (`client/index.html`) and the Heatmap Rendering section of `CLAUDE.md` |
| Model colour disagrees with the legend | The Display Color Space invariants — a `color` attribute written with an sRGB helper, an over-unity light rig, or a specular material |
| Colour bands look coarse on a fine mesh | Expected: the display mesh is the uploaded STL, not the analysis mesh (see §7) |
| Stress on the surface looks noisy or offset | `nearestNodeStress` in `runAnalysis` — a 3.0-unit search radius over a floor-indexed grid |
| Modal frequencies missing or uncertified | `runModalAnalysis` (`server/solver/modal.ts`); `modalResult.certified` and `warnings` |
| BLF absent after asking for buckling | The buckling block in `runAnalysis` — failures are non-fatal and only logged; check `tensileDominated` / `indeterminate` |
| Parallel and serial assembly disagree | `scatterElemMatrixIntoCSR` (`server/solver/csr.ts`) is shared, so suspect the `WorkerInput` payload or the slab merge in `assembleK_parallel` |
| Adaptive refinement did nothing | The `degrade(...)` calls and `stopReason` in `runAdaptiveAnalysis` |
| `symmetryMesh.applied === false` | The `nope(reason)` ladder in the symmetry block of `runAnalysis` |
| CI red, and you want the cheapest signal | `unit-light`. If only `doc-counts` is red, a documented test count drifted |
| A doc guard fails | The five guards in §9 name their own file and the exact mismatch |
| Saved profiles or session vanished | The `~/.stressform_*.json` stores; loaders swallow parse errors and return empty, so a corrupt file reads as "no data" |
