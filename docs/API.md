# STORMFEA HTTP API Reference

STORMFEA runs as a local Express server on `http://localhost:3000`. The
single-file client (`client/index.html`) is the only intended consumer, but the
API is a plain JSON/REST surface you can also drive from `curl`, Postman, or a
script. This document covers every route defined in
[`server/index.ts`](../server/index.ts) — enforced by
`scripts/check-api-routes.mjs`, which runs as part of `npm run test` and
fails the build if a registered route is undocumented here or vice versa.

That guard checks the route INVENTORY only. Request and response BODIES are
checked by nothing, so this document states, per route, what the handler
actually reads and actually writes — including the places where the in-process
type says one thing and the wire says another. Where those two disagree the
disagreement is called out explicitly rather than smoothed over; see
[Fields that exist in `AnalysisResult` but never reach the
wire](#fields-that-exist-in-analysisresult-but-never-reach-the-wire).

## Conventions

- **Base URL:** `http://localhost:3000`
- **CORS:** requests are accepted only from `localhost` / `127.0.0.1` origins (or
  no-origin callers such as curl). Any other `Origin` gets `403`.
- **Body limit:** JSON bodies up to **50 MB**; uploaded files up to **50 MB**.
- **Units.** Length **mm**, force **N**, stress/pressure/modulus **MPa**
  (= N/mm²), temperature **°C**, speed **mm/s**, angle **degrees**, frequency
  **Hz**, mass density **kg/m³**, time **ms** except where a field name says
  otherwise (`coolTimeConstS`, `cycles`). `gravity.g` is a MULTIPLE of standard
  gravity (1 = 9.80665 m/s²), not an acceleration. Percentages
  (`infillPct`, `coolingFanPct`) are 0–100; fractions
  (`globalRelativeError`, `bcSingularityErrorFraction`, `shellVolumeFraction`,
  node shell fraction) are 0–1. The server never rescales geometry: if the
  bounding-box diagonal is implausible for millimetres it reports
  `summary.unitsWarning` and analyses the numbers as given.
- **Coordinate frame.** One frame throughout: the raw STL/STEP file frame, in
  mm, un-translated and un-scaled. `bounds`, `holes[].centre`,
  `forces[].position`, `singularity.peakLocation` and the `volumeField` node
  positions are all in it. `direction` / `normal` / `layerNormal` vectors are in
  the same frame; `layerNormal` and `gravity.direction` need not be unit length.
- **Binary arrays.** Every large numeric array crosses the wire as a base64
  string in a field whose name ends `B64`. All are **little-endian Float32**
  except `volumeField.tetsB64`, which is **Int32**. See
  [Base64 array fields](#base64-array-fields) for per-field element counts and
  ordering — they cannot be guessed from the name.
- **Ids.** `holes[].id` is a 0-based index into the upload response's own
  `holes` array and is only meaningful against that same upload;
  `boltHoleIds` and `boltFasteners[].holeId` reference it. Calibration and
  validation ids are caller-chosen opaque strings, upserted on save. Onshape
  `partId` is Onshape's own id, passed through unchanged.
- **Error envelope:** every error response uses a uniform shape

  ```json
  { "error": "human-readable message", "field": "offending.field", "hint": "how to fix it" }
  ```

  `field` and `hint` are present where the server can identify them. Most `POST`
  routes validate their body shape with `expect()` (`server/validate.ts`)
  *before* any decode/mesh/solve work, so a malformed request returns a `400`
  with the offending field path rather than an opaque mid-pipeline `500`. Two
  routes carry extra keys on the envelope: `POST /api/calibration/bond-sweep`
  adds fit diagnostics to its `400`, and `GET /api/solver-tests` adds
  `tests: []` to its `404`.
- **Status codes:** `400` malformed/invalid request · `401` Onshape not
  configured or rejected the credentials · `403` CORS denial · `404` build
  artifact missing · `413` body/file too large · `502` Onshape reachable but
  failing · `503` meshing binary (TetGen) not installed · `500` unexpected
  server error.
- **Errors raised before a route runs** are normalised into the same envelope by
  a fallback handler at the end of `server/index.ts`: malformed JSON →
  `400 "Malformed JSON body"`; a body over the JSON limit →
  `413 "Request body too large"`; a Multer upload error → `413` for
  `LIMIT_FILE_SIZE` and `400` otherwise, with `field: "file"`; a CORS rejection
  → `403`; an unsupported upload extension → `400` with `field: "file"`.
- **Validator semantics** (`server/validate.ts`). `"number"` requires a FINITE
  number — `NaN`/`Infinity` are rejected. `"vec3"` is exactly 3 finite numbers.
  An optional key (`"foo?"`) accepts missing, `undefined` AND `null`
  interchangeably. **Extra keys are always allowed**: the checker asserts only
  what the server consumes, so an unknown field is never an error — it is
  silently ignored, or silently forwarded, depending on the route (see
  `print` vs `analysis` under `POST /api/analyse`).

## Endpoint index

| Group | Method & path |
|-------|---------------|
| UI | `GET /` |
| Health | `GET /api/health` |
| Geometry | `POST /api/upload` |
| Analysis | `POST /api/analyse` |
| Demo | `GET /api/demo/part` · `GET /api/demo/archetypes` |
| Calibration | `GET /api/calibration` · `POST /api/calibration/calculate` · `POST /api/calibration/fatigue` · `POST /api/calibration/bond-sweep` · `POST /api/calibration/save` · `DELETE /api/calibration/:id` · `GET /api/calibration/export-all` · `POST /api/calibration/import-all` · `GET /api/calibration/coupon/:type` · `POST /api/calibration/kt` |
| Bond model | `POST /api/bond-sensitivity` |
| Validation | `GET /api/validation` · `POST /api/validation/save` · `DELETE /api/validation/:id` |
| Solver tests | `GET /api/solver-tests` |
| Methodology | `GET /api/methodology` |
| Session | `GET /api/session` · `POST /api/session` · `DELETE /api/session` · `POST /api/export-zip` |
| Reporting | `POST /api/report` |
| Onshape | `GET /api/onshape/status` · `POST /api/onshape/credentials` · `POST /api/onshape/parts` · `POST /api/onshape/import` · `DELETE /api/onshape/credentials` |

> **On-disk stores.** Calibration, validation, session, and Onshape credentials
> persist to `~/.stressform_*.json` files (the `stressform` prefix is legacy
> naming kept for backward compatibility — the product is STORMFEA). Writes are
> atomic (temp file + rename); the credentials file is written `0600`.

---

## UI & health

### `GET /`
Serves the single-page client (`client/index.html`). Static assets under the
client directory are also served (`express.static`), so `solver.worker.js` and
`vendor/` come from the same origin. The directory is
`process.env.STRESSFORM_CLIENT_DIR` when set (Electron), else `dist/client`.

### `GET /api/health`
Liveness probe. Takes no parameters and cannot fail.

**Response** `200`
```json
{ "status": "ok", "version": "43" }
```
`version` is a hardcoded string literal, not the `package.json` version.

---

## Geometry

### `POST /api/upload`
Parse an uploaded part and return display geometry + detected holes. STL is
parsed directly; STEP/STP is meshed by Gmsh (`clMin 0.5`, `clMax 4.0`,
`clCurv 15`) for bounds and hole walls.

**Request** — `multipart/form-data` with a single part named `file`
(`.stl`, `.step`, or `.stp`, ≤ 50 MB). The extension is checked by Multer's
file filter before the body is read.

**Response** `200`
```json
{
  "fileType": "stl",
  "fileName": "bracket.stl",
  "triangleCount": 12000,
  "bounds": { "minX": 0, "maxX": 40, "minY": 0, "maxY": 20, "minZ": 0, "maxZ": 4 },
  "dimensions": { "x": 40.0, "y": 20.0, "z": 4.0 },
  "holes": [
    { "id": 0, "centre": [10,10,2], "normal": [0,0,1],
      "radius": 2.05, "diameter": 4.1, "confidence": 0.98, "edgeCount": 32 }
  ],
  "positionsB64": "<base64 Float32 surface positions>"
}
```

`fileName` is the uploaded filename verbatim. `dimensions` is
`max − min` per axis, rounded to 3 dp; `radius`/`diameter` to 4 dp.
`positionsB64` is Float32, 9 floats per triangle (3 vertices × xyz), length
`triangleCount * 9` — an unindexed triangle soup, which is why the client welds
coincident vertices before colouring.

The two paths differ, and a caller must not assume one shape:

| | STL | STEP / STP |
|---|---|---|
| `fileType` | `"stl"` | `"step"` |
| `stepB64` | absent | present — the original STEP bytes, echoed back for the analyse call |
| `holes[].normal` | from `detectHoles` | always `[0,0,1]` (not derived from the surface) |
| `holes[].confidence` | measured, 3 dp | `1.0`, lowered to `0.5` on a merge warning |
| `holes[].warning` | **absent** | present, `null` or a merged-hole string |

`holes[].warning` flags overlapping (likely Gmsh-merged) detections whose radius
may be wrong; it exists on the STEP and Onshape paths only. `edgeCount` is the
detected edge count on STL and the wall-node count on STEP — the same field name
for two different quantities.

**Errors.** `400` no file (`field: "file"`), `400` unsupported extension,
`413` over 50 MB, `500` parse or mesh failure (`{ "error": "<string>" }`, no
`field`/`hint`).

---

## Analysis

### `POST /api/analyse`
Run the full FEM pipeline (mesh → constraints → assemble → solve → stress
recovery → failure modes) and return the stress field plus a result summary.
This is the core endpoint.

**Request** `application/json`. The body is the object returned by
`/api/upload` plus the user's load/print choices. Validated against
`ANALYSE_SPEC` in `server/index.ts` before any work begins, then a second check
rejects an unknown `print.materialId` (`400`, `field: "print.materialId"`,
`hint` listing `MATERIAL_IDS`).

**Required** — the request fails `400` without them: `positionsB64`,
`triangleCount`, `bounds` (all six faces), `holes` (may be `[]`),
`boltHoleIds` (may be `[]`), `forces` (may be `[]`), and `print` with all of
`materialId`, `infillPct`, `wallCount`, `pattern`, `orientation`,
`layerHeightMm`. Everything else is optional.

| Field | Type | Notes |
|-------|------|-------|
| `positionsB64` | string | **Required.** Base64 Float32 positions from `/api/upload`. Decoded length must be non-zero and a multiple of 4 bytes, else `400` with `field: "positionsB64"`. |
| `fileType` | `"stl"｜"step"` | Optional; anything absent is treated as `stl`. |
| `stepB64` | string | Base64 STEP bytes. Required in practice for STEP parts (the mesher has nothing to mesh without it), but OPTIONAL to the validator — omitting it on a STEP part fails later, in the solve, not at validation. |
| `triangleCount` | number | **Required.** Drives the display-vertex count (`triangleCount × 3`) that every returned per-vertex array is sized to. It is trusted, not cross-checked against `positionsB64`'s length. |
| `bounds` | `{minX,maxX,minY,maxY,minZ,maxZ}` | **Required**, all six, finite. |
| `holes[]` | array | **Required** (may be empty). Each entry: `id`, `centre` (vec3), `normal` (vec3), `radius` — all four REQUIRED — plus optional `confidence`, `edgeCount`, `rmsError`, `maxDeviation`. `rmsError`/`maxDeviation` are circle-fit residuals the server defaults to `0` when absent; `/api/upload` does not emit them, so they only appear if a caller adds them. `diameter` and `warning` from the upload response are accepted and ignored (extra keys are allowed). |
| `boltHoleIds[]` | number[] | **Required** (may be empty). Which holes are bolted (constraints). |
| `boltFasteners[]` | array | Optional. `{ holeId, fastenerType?, washerOD? }` — only `holeId` is required within an entry. |
| `forces[]` | array | **Required** (may be empty). `{ magnitude, direction[3], position[3], loadDistribution?, loadPatchDepthMm?, loadPatchRadiusMm? }` — `magnitude` (N), `direction` and `position` (mm) are all REQUIRED within an entry. See [Load distribution](#load-distribution) below. |
| `print` | object | **Required.** `{ materialId, infillPct, wallCount, pattern, orientation, layerHeightMm, extrusionWidthMm?, topLayers?, bottomLayers?, process? }`. See [Print settings](#print-settings) below. |
| `analysis` | object | Optional numerical-method knobs. **Not all of them are honoured** — see [Analysis settings](#analysis-settings) below. |
| `gravity` | `{ g, direction[3] }` | Optional body-force load. `g` is a MULTIPLE of standard gravity (5 = a 5 g case), not m/s². `direction` need not be unit length. Uses the material's infill-scaled mass density. |
| `pressures[]` | array | Optional surface loads `{ magnitude, direction[3], normal?, region? }`. `magnitude` in MPa (positive = inward push, negative = outward/suction). `normal: true` follows each triangle's own outward normal instead of `−direction`. `region` ∈ `"face"` (default, extreme face toward `direction`) ｜ `"facing"` (every triangle whose normal faces `direction`) ｜ `"all"` (whole exterior / hydrostatic). Honoured on the box-mesh fallback. |
| `fatigueLoadRatio` | number | Optional `R = σ_min/σ_max`. Default `0` (pulsating 0→peak); `−1` = fully reversed. Clamped to `[-1, 0.95]` inside the estimator, and a non-finite value falls back to `0`. |
| `layerNormal` | `[x,y,z]` | Optional through-layer (weak) axis from the picked bed face. Present → exact weak-axis tensor rotation for upright/angled prints; absent → conservative scalar-swap fallback. Direction only; sign and in-plane azimuth are immaterial. |
| `calibration` | object | Optional active calibration profile. Validated only as "an object" — its interior is not shape-checked. May carry `latticeStiffExp` / `latticeStrengthExp` overrides for the two-region core's Gibson-Ashby exponents, and `bondCoeffs` from `/api/calibration/bond-sweep`. |

#### Load distribution

`forces[].loadDistribution` ∈ `"uniform"` ｜ `"cosine_bearing"` ｜
`"tapered_patch"` ｜ `"contact_patch"`. **Absent → `contact_patch`**
(`DEFAULT_LOAD_DISTRIBUTION`, `server/analysis.ts`), not `uniform`.

- `"uniform"` — legacy: equal split over the extreme-face band. Pass this
  explicitly for the pre-2026 behaviour, bit-identical.
- `"cosine_bearing"` — concentrated at a bolt bearing point.
- `"tapered_patch"` — raised-cosine **slab** on the extreme face as a consistent
  tributary-area traction. No hard rim circumferentially, but a slab still runs
  off a free edge at full strength (issue #260).
- `"contact_patch"` — raised-cosine **disc** centred on `position`, tapering in
  every surface direction; the only mode with no untapered patch edge.

**`position` is read ONLY by `contact_patch`** (issue #271). Under every other
mode the loaded nodes come from `direction` alone, so moving `position` changes
nothing. `contact_patch` acts on the surface `position` lies on, grown by edge
adjacency from the nearest triangle — so `direction` selects no face, and a push
and a pull at the same point produce the same patch with opposite sign (issue
#305). It used to select faces by `n·direction > 0`, which is the surface a
force points OUT of, so every compressive load landed on the far side of the
part. Changing the default moved force-loaded results substantially; see
`docs/load-distribution-default.md`.

`loadPatchDepthMm` sets the `tapered_patch` slab depth, `loadPatchRadiusMm` the
`contact_patch` disc radius; each is ignored by the other modes. Omitted →
`LOAD_PATCH_DEPTH_FRACTION` = 0.15 of the part's extent along `direction`, and
`CONTACT_PATCH_RADIUS_FRACTION` = 0.10 of its bounding-box diagonal
respectively — both judgements, not measurements. Pass the real contact size
when you know it.

#### Print settings

`extrusionWidthMm` (default 0.45, clamped `[0.1, 2.0]`) sets the wall band =
`wallCount × extrusionWidthMm`. `topLayers` / `bottomLayers` (clamped `[0, 64]`)
set the independent floor/ceiling solid-skin bands (× layer height) for the
two-region model; absent → `DEFAULT_TOP_LAYERS` / `DEFAULT_BOTTOM_LAYERS` = 4
each, with the assumption flagged in `materialModel.skinLayersAssumed`.

`process` (`{ nozzleTempC?, bedTempC?, printSpeedMmS?, coolingFanPct?,
ambientTempC? }`) activates the bead-penetration bond model —
**absent → legacy layer-height factor only, bit-identical.**

Two further `PrintSettings` fields are NOT listed in `ANALYSE_SPEC` but DO reach
the solver, because the handler forwards `body.print` wholesale:
`rasterAngleDeg` (bead direction in the layer plane, degrees from +X, default 0)
and `unidirectionalRaster` (boolean). Both are consumed only by the in-plane
raster anisotropy model, which is itself unreachable over HTTP (below), so today
they have no observable effect. Being outside the spec, they are also
unvalidated — a caller can put any JSON value there.

#### Analysis settings

`analysis` is NOT forwarded wholesale. The handler rebuilds an
`AnalysisSettings` object field by field, so anything it does not name is
dropped even when `ANALYSE_SPEC` accepts it.

**Honoured:**

| Field | Type | Default over HTTP |
|-------|------|-------------------|
| `meshQuality` | `coarse｜standard｜fine` | `standard` |
| `meshOrder` | `1` (C3D4) ｜ `2` (C3D10) | `2` — any value other than exactly `1` becomes `2` |
| `analysisType` | `linear_static｜modal` | `linear_static` — any value other than exactly `"modal"` becomes `linear_static` |
| `computeBuckling` | boolean | `false` (strict `=== true`) |
| `uncertaintyMode` | `central｜conservative｜optimistic` | `central`. Validated as a bare `"string"`, so a typo passes validation and is cast, not rejected. |
| `useCLT` | boolean | `false` (strict `=== true`) |
| `beadProps` | object | forwarded only when present; interior unvalidated |
| `twoRegion` | boolean | **`false` over HTTP** — see below |
| `includeVolumeField` | boolean | `false` (strict `=== true`) |
| `adaptiveRefinement` | boolean | `false` (strict `=== true`) |

**Accepted by the validator but silently dropped:** `criterion`
(`fdm-interface｜hill-legacy`). `ANALYSE_SPEC` declares it, the handler never
copies it into the settings object, so an HTTP caller cannot select
`hill-legacy`. The criterion is chosen internally: `fdm-interface` except on the
upright-no-bed scalar-swap fallback, which stays `hill-legacy`.

**Not reachable over HTTP at all** — present on `AnalysisSettings` in
`server/analysis.ts`, absent from both `ANALYSE_SPEC` and the handler's object:
`symmetryMesh` (issue #296), `wallBond`, `inPlaneAnisotropy`. In-process callers
(the test suite) can set them; HTTP callers cannot.

##### `twoRegion` — the default differs between the library and the wire

`AnalysisSettings.twoRegion` is documented as DEFAULT TRUE since issue #297, and
`runAnalysis` implements that with `req.analysis.twoRegion ?? true`. **That
default does not reach HTTP callers.** The analyse handler builds the settings
object with `twoRegion: body.analysis?.twoRegion === true`, which turns an
absent flag into an explicit `false`, so `?? true` never fires. Over HTTP the
two-region model is therefore OPT-IN: send `"analysis": { "twoRegion": true }`
to get it.

This is a discrepancy between the code and its own stated contract, not a
deliberate wire-level policy — it is recorded here because a caller reading
`server/analysis.ts` would otherwise expect the opposite. Verify against the
handler before depending on either behaviour.

When active, the infill core follows Gibson-Ashby power laws in density per
pattern family (see `materialModel.core` in the response). The model
self-degrades to the uniform path — still returning a result, with
`materialModel.degraded` set to a human-readable reason — in FOUR cases:

1. a box-fallback mesh (no real geometry to classify),
2. no boundary surface available,
3. a mesh over `TWO_REGION_MAX_ELEMENTS` = 400,000 elements,
4. a mesh resolving fewer than `MIN_ELEMENTS_THROUGH_THICKNESS` = 4 elements
   across the thinnest section — below that it recovers almost none of the
   sandwich stiffening it exists to capture while reporting itself active.

Case 4 reads the mesh that came back, not the sizing request, and an explicit
opt-in does NOT override it.

`includeVolumeField: true` adds the volumetric interior-stress payload used by
the section view (off by default to keep ordinary responses light). It carries
`nodeShellFractionB64`, the two-region wall/core classification per node in
`[0, 1]` — `null` when no two-region field ran, and the ONLY place the split is
visible, since a part's boundary is wall by construction and the same field on
the display mesh is identically 1.0 everywhere.

`adaptiveRefinement: true` runs the error-driven adaptive remesh loop instead of
a single solve — see [Adaptive refinement](#adaptive-refinement).

**Response modes**

1. **Blocking JSON (default).** Returns a single JSON object once the solve
   finishes.
2. **Server-Sent Events (opt-in).** Add `?stream=1` *or* send
   `Accept: text/event-stream`. The server emits ordered `phase` events (mesh →
   constraints → assembly → solve → modal → buckling → recovery → mapping),
   streams CG residual checkpoints, then a final `result` event carrying
   **exactly the same payload** as the blocking mode (both call `buildPayload`),
   or an `error` event `{ error, hint? }`. Closing the connection aborts the
   server-side solve at the next phase boundary and ends the stream with NO
   `result` event. Note the SSE path always returns HTTP `200` before solving,
   so a mid-solve failure arrives as an `error` EVENT, not a status code; only
   pre-solve rejections (`400`/`503`) come back as an ordinary JSON error.

**Response payload.** Top level:

```json
{
  "summary": { /* see below */ },
  "vertexStressB64": "…",
  "vertexSignedVonMisesB64": "…",
  "vertexXyUtilB64": null,
  "vertexZUtilB64": null,
  "vertexPrincipalStressB64": "…",
  "vertexPrincipalStress2B64": "…",
  "vertexPrincipalStress3B64": "…",
  "vertexDisplacementB64": "…",
  "vertexErrorEstimateB64": null,
  "globalRelativeError": 0.081,
  "bcSingularityErrorFraction": 0.12,
  "topErrorElements": null,
  "vertexModeShapesB64": null,
  "volumeField": null,
  "modalResult": null
}
```

**`globalRelativeError`, `bcSingularityErrorFraction`, `topErrorElements`,
`volumeField`, `vertexErrorEstimateB64` and `vertexModeShapesB64` are TOP-LEVEL
fields, NOT members of `summary`.** Everything else describing the solve is
inside `summary`.

`summary` carries exactly these keys, in this order (`buildPayload`,
`server/index.ts`):

`maxVonMisesMPa` (MPa, 4 dp) · `maxDisplacementMm` (mm, 6 dp) ·
`effectiveYieldMPa` (MPa, 2 dp) · `safetyFactor` (3 dp, nullable) ·
`bulkSafetyFactor` (3 dp, nullable) · `governingMode` (string) ·
`sfCriterion` · `vonMisesSafetyFactor` (3 dp, nullable) · `safetyfactorLow`
(nullable) · `safetyFactorHigh` (nullable) · `estimatedFailForce` (N, 1 dp) ·
`bulkFailForceN` (N, 1 dp) · `surfaceTriangleCount` · `yielding` (bool) ·
`verdict` (string) · `cgIterations` · `converged` (bool) · `meshFallback`
(bool) · `unitsWarning` (nullable string) · `materialModel` · `solverMs` ·
`nodeCount` · `elementCount` · `nodesPerElem` (4 or 10) · `recommendations`
(string[]) · `failureModes` · `holeClassifications` · `calibrationId` ·
`singularity` (nullable) · `rigidBodyMode` · `topologySuggestions` ·
`layerInterfaceProfile` (nullable) · `couponRecommendations` (defaults `[]`) ·
`delaminationDFM` (nullable) · `fatigue` · `isotropicComparison` ·
`governingDirection` (nullable) · `peakUtilXY` (nullable) · `peakUtilZ`
(nullable) · `minSignedVonMisesMPa` · `maxSignedVonMisesMPa` · `boltReactions`
(defaults `[]`) · `residualCheckpoints` (defaults `[]`) · `validationCoverage` ·
`adaptiveRefinement` (nullable).

`sfCriterion` is one of `"fdm-interface"`, `"hill"`, `"von-mises"` — note this
is NOT the same vocabulary as the `analysis.criterion` REQUEST field
(`fdm-interface｜hill-legacy`): the response reports `"hill"` where the request
would say `"hill-legacy"`, and reports `"von-mises"` for a material that never
reached an anisotropic criterion at all.

`validationCoverage` (issue #191) is always present and needs no opt-in. It is a
`ValidationCoverageReport` from `server/validation-coverage.ts`:
`{ fingerprint: { elementOrder, material, criterion, loadTypes[], mesher,
options[] }, axisCoverage: [{ axis, entries[] }], coveringEntryIds: string[],
uncoveredAxes: string[], comboGaps: [] }`. An axis with `entries: []` has NO
direct validation anchor; `uncoveredAxes` is exactly that list.

**Errors.** `400` invalid body / unknown `print.materialId` / undecodable
`positionsB64`; `503` TetGen not installed (with a platform-specific install
`hint`); `500` solver failure. The blocking path additionally rejects at `500`
after a 120 s `ANALYSE_TIMEOUT_MS`, which guards the async parts (mesher
subprocesses, file I/O) — it cannot interrupt the CPU-bound PCG loop, whose own
guards are the iteration cap and `CG_DEADLINE_DEFAULT_MS`.

#### Base64 array fields

`V` = `triangleCount × 3`, the display-vertex count, taken from the REQUEST's
`triangleCount`. `summary.surfaceTriangleCount` reports the triangle count the
server used. All Float32 little-endian unless stated.

| Field | Elements | Ordering / units |
|---|---|---|
| `vertexStressB64` | `V` | von Mises per display vertex, MPa |
| `vertexSignedVonMisesB64` | `V` | von Mises signed by hydrostatic sense (tension +, compression −), MPa |
| `vertexXyUtilB64` | `V` or `null` | in-plane utilization ratio (dimensionless, ~0–2); `null` when no anisotropic recovery ran |
| `vertexZUtilB64` | `V` or `null` | interlayer utilization ratio; `null` on the same condition |
| `vertexPrincipalStressB64` | `V` | σ₁, MPa |
| `vertexPrincipalStress2B64` | `V` | σ₂, MPa |
| `vertexPrincipalStress3B64` | `V` | σ₃, MPa |
| `vertexDisplacementB64` | `V × 3` | ux, uy, uz interleaved per vertex, mm |
| `vertexErrorEstimateB64` | `V` or `null` | per-vertex ZZ error indicator η, dimensionless fraction |
| `vertexModeShapesB64` | modal only, else `null` | per-vertex mode-shape displacements, concatenated mode by mode |

`volumeField` (only when `analysis.includeVolumeField` was true) is on the
ANALYSIS mesh, not the display mesh, and is indexed by analysis node index
`0..nodeCount-1`:

| Key | Type | Notes |
|---|---|---|
| `nodeCount`, `cornerTetCount` | number | |
| `nodesB64` | Float32, `nodeCount × 3` | xyz interleaved, mm |
| `tetsB64` | **Int32**, `cornerTetCount × 4` | corner-tet connectivity; C3D10 midside nodes are omitted |
| `nodeVonMisesB64` | Float32, `nodeCount` | MPa |
| `nodeSignedVonMisesB64` | Float32, `nodeCount` | MPa, tension + / compression − |
| `nodePrincipal1B64` / `2` / `3` | Float32, `nodeCount` | σ₁ ≥ σ₂ ≥ σ₃, MPa |
| `nodeXyUtilB64`, `nodeZUtilB64` | Float32 or `null` | utilization ratios |
| `nodeShellFractionB64` | Float32 or `null` | shell (wall) fraction in `[0, 1]`; `0` pure infill core, `1` pure solid wall/skin. `null` when no two-region field ran. |

#### Fields that exist in `AnalysisResult` but never reach the wire

`buildPayload` is an explicit object literal, not a spread of `result`. Seven
fields of `AnalysisResult` (`server/analysis.ts`) are therefore computed and
then dropped, and **no HTTP caller has ever received them** — the names have
never appeared in `server/index.ts` at any commit:

| Field | What it would have carried |
|---|---|
| `safetyFactorAvailable` | boolean; false on a box-fallback mesh |
| `meshResolution` | achieved-vs-target mesh report (issue #295) |
| `meshOrderDowngrade` | C3D10 → C3D4 downgrade report (issue #265) |
| `sfBandComposition` | which uncertainty terms formed the bulk SF band (#172/#173) |
| `symmetryMesh` | mirrored-fundamental-domain report (issue #296) |
| `bucklingResult` | linear buckling result, incl. BLF |
| `vertexBucklingModeB64` | buckling mode shape |

Do not code against them. They are listed rather than omitted because
`client/index.html` reads five of them (`s.meshResolution`,
`s.safetyFactorAvailable`, `dataStd.bucklingResult`,
`dataStd.vertexBucklingModeB64`) and the corresponding UI is consequently inert
— which makes their absence a live defect worth knowing about, not a design
choice to document as intentional.

#### Governing vs bulk safety factor

(Issue #278.) `summary.safetyFactor` is the GOVERNING safety factor: the minimum
over the FEM bulk-yield SF and every CHECKED entry in `failureModes`
(net-section tension, shear-out, thread strip-out, bearing, the interlayer rows,
buckling BLF). `estimatedFailForce` is `totalAppliedForce × safetyFactor`, and
`summary.verdict` reports the same quantity — so the headline number and the
verdict can never disagree. Before #278 the headline pair was bulk-yield-only
while the verdict was already the governing minimum, which let a response say
`safetyFactor: 3.0` next to
`verdict: "Fails — predicted to yield at 283 N (Thread strip-out)"`.

The bulk-yield-only pair is still reported, under `bulkSafetyFactor` /
`bulkFailForceN`, and `governingMode` names the mode behind the headline
("Bulk yield" when the FEM criterion governs). `sfCriterion`,
`vonMisesSafetyFactor` and `safetyfactorLow`/`safetyFactorHigh` all describe
`bulkSafetyFactor`, NOT the governing number: they are material-property
uncertainties of the FEM criterion and do not propagate through the closed-form
analytic modes. On a part where no analytic mode is checked,
`safetyFactor === bulkSafetyFactor` exactly.

(`sfBandComposition`, the prose disclosure of what formed that band, is computed
but not serialised — see the table above.)

#### Adaptive refinement

(`analysis.adaptiveRefinement: true`, issue #149.) Runs solve, ZZ error
estimate, regional size field, TetGen re-mesh, re-solve — and reports the
iteration with the LOWEST global error, not the last one. Defaults, from
`server/solver/adaptiveMesh.ts`: `targetGlobalError` 0.03, `maxIterations` 5,
`maxElementGrowth` 8× the base element count, `minRelativeImprovement` 0.05
(stop when a step improves the error by less than 5%). It only ever refines
(never coarsens), it holds the size field to a bounded gradation (target size
grows by at most ~50% per element away from a refined region, so refined and
unrefined regions are joined by a graded band rather than a step), and it keeps
a 2 mm ball around a detected singularity coarse, because refining a true
singularity does not converge.

The element cap is enforced against the mesh the mesher ACTUALLY emitted, before
that mesh is solved. The internal element-count prediction is first-order and can
under-predict; when the emitted mesh overshoots, the loop re-meshes with a
budget tightened by the measured error, and if that still overshoots it stops on
`budget-overshoot` having spent no solve on the over-budget mesh. `elementBudget`
on the response reports the ceiling, and every entry in `history` is at or under
it.

Default `false` is bit-identical to the single-solve path. The loop needs the
STL/TetGen path and a TetGen binary; on the STEP/Gmsh path, on the box-mesh
fallback, or with no binary it degrades to the selected mesh tier and says so via
`degradedToTier` plus a human-readable `note`. `summary.adaptiveRefinement` is
always present on the response — `null` on the default single-solve path, and
otherwise an object (a degraded run still reports, with `degradedToTier: true`):

```json
"adaptiveRefinement": {
  "iterations": 3,
  "stopReason": "target-error-reached",
  "initialGlobalError": 0.081, "finalGlobalError": 0.026,
  "initialElementCount": 1240, "finalElementCount": 6800,
  "elementBudget": 9920,
  "bcSingularityErrorFraction": 0.12,
  "history": [
    { "globalRelativeError": 0.081, "elementCount": 1240, "maxVonMisesMPa": 6.86, "safetyFactor": 7.28 },
    { "globalRelativeError": 0.042, "elementCount": 3100, "maxVonMisesMPa": 8.02, "safetyFactor": 6.24 },
    { "globalRelativeError": 0.026, "elementCount": 6800, "maxVonMisesMPa": 5.56, "safetyFactor": 8.99 }
  ],
  "headlineSpread": {
    "samples": 3,
    "safetyFactorMin": 6.24, "safetyFactorMax": 8.99, "safetyFactorSpread": 0.4407,
    "peakMin": 5.56, "peakMax": 8.02, "peakSpread": 0.4424,
    "monotoneInDensity": false,
    "note": "Across the 3 meshes solved, the safety factor moved 6.24–8.99 (44.1%) …"
  },
  "degradedToTier": false,
  "note": "Adaptive refinement: 3 solve(s), stopped on 'target-error-reached'. 12% of the remaining estimated error sits at boundary-condition discontinuities (the rim of a constrained or loaded patch), which refinement cannot reduce — that share reflects the constraint idealization, not the mesh."
}
```

`elementBudget`, `bcSingularityErrorFraction` and `headlineSpread` are OPTIONAL
members of this object (`?` on `AdaptiveRefinementInfo`); `history[].safetyFactor`
is nullable. Everything else shown is always present when the object is.

**`headlineSpread`** (issue #256) reports how far `safetyFactor` and
`maxVonMisesMPa` moved across the meshes the loop actually solved. It exists
because the discretization error and the headline number do NOT behave alike: on
the Ø5-bore tube the global error converged 19.4% → 11.1% while the safety factor
swung 46% and the peak 46%, NON-MONOTONICALLY, over the same runs. A reader shown
only the error is being shown a well-behaved number next to a badly-behaved one
with nothing distinguishing them.

`monotoneInDensity: false` is the stronger warning: element count did not predict
the answer, so a finer mesh is not a more trustworthy one. That is the signature
of a peak at a singularity — a clamp rim, a loaded-patch rim, or a sharp corner —
where the peak is set by the local element size and no mesh converges it.

This is a MEASUREMENT over the meshes at hand, not a confidence interval: it is
bounded by how far apart those meshes were and says nothing about where the true
value lies. It answers only "does refining this part change the answer". A part
whose peak genuinely converges gives a small, monotone spread and no `note` — the
plate-with-hole control measures 2.2%, monotone, settling to 0.1% between the two
finest meshes. Absent (`undefined`) when fewer than two solves happened, which is
deliberate: one mesh cannot measure its own mesh-dependence, and reporting 0%
there would assert a convergence that was never tested.

`note` is empty below a 5% spread — the same cutoff the client's convergence
study uses to call a metric mesh-independent, so the two surfaces cannot tell a
user opposite things.

`bcSingularityErrorFraction` is a DIAGNOSIS, not a second accuracy target, and
`finalGlobalError` remains the TOTAL estimated error regardless of it. A rigid
displacement constraint applied over part of a surface is singular exactly where
it stops, as is the rim of a loaded patch; the error there converges at a
measured rate of ~0.15 against the ~2.0 a smooth region gives, so halving it
would take on the order of 10⁶× the elements. Once that band dominates, the loop
can stop well short of `targetGlobalError` with nothing wrong with the mesh —
a high value says reach for a better constraint model, not a finer mesh. The
loop deliberately does NOT target the remainder: doing so would let it announce
`target-error-reached` on a filtered number while the honest total was several
times higher. Absent when no mask could be built (no surface, or a degraded run).

Read it for THIS solve only. The band is defined topologically (the patch rim
plus a fixed number of mesh-adjacency rings), so it thins as the mesh refines and
the fraction falls with density for that reason alone — measured 40.6% → 33.1% →
27.7% across 45k → 65k → 81k elements of the same part. It is not a convergence
metric. Related, and worth knowing when reading any bolt-constrained result: peak
stress and safety factor near a rigid constraint are not converged quantities
either, swinging ~40% non-monotonically across those same three meshes.

`stopReason` is one of `target-error-reached`, `max-iterations`,
`element-growth-cap`, `budget-overshoot`, `no-refinement-requested`, `stalled` (a
step improved the error by less than 5%, or the error grew), `remesh-failed`,
`resolve-failed`, `no-error-field`, or `degraded-to-tier` — the `StopReason`
union in `server/solver/adaptiveMesh.ts`, which the response type references
directly so this list cannot drift from the code.

`budget-overshoot` means the re-mesh could not be brought under the element cap
within its retry allowance; the loop reports the best solve it already has.
`resolve-failed` means the refined mesh was built but could not be solved —
either the hard mesh-quality gate REJECTED it, or the solve did not converge
(the PCG iteration cap or its wall-clock backstop stopped it short). The second
case is the common one now that refined meshes are clean: an 8x budget on a
mid-size part can produce a system larger than the solve budget allows, and the
loop then keeps the best solve it already has rather than failing the request.
Measured on a 40x20x4 mm bracket plate, the first refinement built a clean
51,743-element mesh (239k DOF, zero hard-gate violations) and ran out of solve
budget while still converging.

The wall clock itself is a hang guard, not a verdict: it does not throw, it
returns the current iterate with `CGResult.timedOut` set, and it defaults to
600 s (`CG_DEADLINE_DEFAULT_MS`, per-solve overridable via
`SolverInput.cgDeadlineMs` — an in-process field, not a request field). The
adaptive loop therefore tests the refined solve's `converged` flag directly
rather than relying on an exception — same degradation, stated explicitly. The
bracket-plate measurement above was taken against the former 90 s limit.

Note that the loop targets the ZZ energy-norm error. A lower global error does
not by itself guarantee a changed safety factor or governing failure mode.
Measured on a Ø5-bore tube (`server/tests/unit/adaptive-benchmark.test.ts`),
adaptive reached a 0.262 global error on 40,534 elements where a uniform mesh of
54,373 elements reached only 0.337 — but the two disagreed on peak von Mises by
24% (4.91 vs 3.97 MPa), far more than they disagreed on the error they were
optimising. Adaptivity buys error per element; it does not by itself settle the
peak stress.

#### `summary.materialModel`

Always present. On the uniform path it reports `twoRegion: false` with the
thickness/fraction fields `null`:

```json
"materialModel": {
  "twoRegion": true,
  "wallThicknessMm": 1.35,
  "shellVolumeFraction": 0.41,
  "shellYieldXYMPa": 27.5,
  "coreYieldXYMPa": 2.5,
  "impliedAvgStrengthMul": 0.36,
  "globalModelStrengthMul": 0.30,
  "core": {
    "model": "gibson-ashby",
    "patternFamily": "walls25d",
    "stiffnessExponent": 2.0,
    "strengthExponent": 1.5,
    "stiffnessScale": 0.0368,
    "strengthScale": 0.0894,
    "floored": false,
    "yieldCriterion": "deshpande-fleck-ashby",
    "dfaAlpha": 0.41,
    "confidence": "LOW"
  }
}
```

`twoRegion` (bool) and `globalModelStrengthMul` (number) are always present;
`wallThicknessMm`, `shellVolumeFraction`, `shellYieldXYMPa`, `coreYieldXYMPa`
and `impliedAvgStrengthMul` are always present but nullable. The rest are
OPTIONAL and appear only when the corresponding path ran:

- `core` — the Gibson-Ashby homogenization, as above. `patternFamily` ∈
  `tpms3d｜walls25d｜sparse`; `yieldCriterion` ∈
  `deshpande-fleck-ashby｜von-mises`; `dfaAlpha` is the DFA pressure-sensitivity
  of the pure core (0 at ρ=1, LOW confidence); `floored` is true when the
  stiffness scale hit the 1e-3 low-density floor; `confidence` is the literal
  `"LOW"`.
- `skinTopThicknessMm`, `skinBotThicknessMm`, `skinTopLayers`, `skinBotLayers`,
  `skinLayersAssumed`, `skinBuildAxis` (`"bed"｜"assumed-z-up"`) — the solid
  floor/ceiling skin bands. `skinLayersAssumed: true` means the layer counts
  were defaulted, not supplied.
- `collapsed` — string; set when shell and core were materially equal and the
  field collapsed to the uniform path (100% infill, all-shell part).
- `degraded` — string; set when the two-region request degraded, naming which
  of the four gates fired.
- `bond` — `{ relStrength, relStiffness, applied?, coolingFanRefPct?,
  interfaceTempC?, substrateTempC?, coolTimeConstS?, clamped, confidence
  ("low"｜"medium"), note }`. Present when `print.process` activated the bond
  model. `applied: false` marks the unknown-material refusal, where the
  multipliers are the reference no-ops (1.0) and the thermal diagnostics are
  omitted.
- `wallBond` — wall-to-wall bond diagnostics, or `null` when requested with no
  internal loop boundary to model. Unreachable over HTTP today
  (`analysis.wallBond` is not forwarded).

#### BC share of the discretization error

**Top-level `bcSingularityErrorFraction`** (issue #259), NOT
`summary.bcSingularityErrorFraction`. How much of `globalRelativeError`'s energy
sits at boundary-condition discontinuities — the rim of a constrained or loaded
patch. In `[0, 1]`, and present on ORDINARY solves, not only adaptive ones (the
`summary.adaptiveRefinement.bcSingularityErrorFraction` field is the same
statistic for the loop's chosen iterate).

It exists because the total alone cannot distinguish the two situations that
call for opposite responses. Measured on the Ø5-bore tube, plain non-adaptive:

| tier | elements | `globalRelativeError` | `bcSingularityErrorFraction` |
|---|---|---|---|
| coarse | 13 340 | 0.1937 | 0.757 |
| fine | 71 404 | 0.1568 | 0.480 |

At 75.7% the reported error is a floor set by the constraint idealization, and
refining the mesh will not move it — the BC band converges at a measured ~0.15
against the ~2.0 a smooth C3D10 region gives. The app and the printed report
both make their advice conditional on this: above 0.5 they say a finer mesh will
NOT fix it and point at the bolt/load idealization; between 0.33 and 0.5 they
report the share without overriding the refine advice; below that they omit it.

`null` means NOT MEASURED (no BC mask could be built — no surface, or no
constrained/loaded nodes), which is not the same as measured-at-zero; consumers
must not render it as "none".

Read it for THIS solve only. The band is topological (patch rim plus
`BC_SINGULARITY_DILATE_HOPS` adjacency rings), so it thins as the mesh refines —
the 0.757 → 0.480 fall above is mostly the band shrinking, not the singularity
weakening. It is not a convergence metric, and the loop deliberately does not
target it.

`topErrorElements` (top level, nullable) is the companion list:
`[{ x, y, z, errorEstimate }]` in mm and dimensionless η. It ranks where the
DISCRETIZATION error is largest. It does NOT rank where the displayed field is
mesh-dependent — see [Mesh sensitivity](#mesh-sensitivity-issue-294).

#### Singularity warning

`summary.singularity`, `null` when nothing is flagged. Says the peak stress is
set by the mesh rather than by the part, so the safety factor derived from it is
not a converged number:

```json
"singularity": {
  "detected": true,
  "cause": "constraint-edge",
  "confidence": "high",
  "evidence": "single-mesh-heuristic",
  "nearYield": false,
  "peakStressMPa": 3.99, "stressAt1mmMPa": 0.4,
  "concentrationRatio": 9.7,
  "neighborhoodRadiusMm": 8.954, "localElementSizeMm": 3.581,
  "peakVertexIdx": 411, "peakLocation": [6.0, 0.0, 5.0],
  "message": "…"
}
```

Every key shown is REQUIRED on `SingularityWarning` — the object is either
`null` or complete. `stressAt1mmMPa` is the average stress in the local
neighbourhood of radius `neighborhoodRadiusMm`; the name is kept for payload
back-compat and the radius has NOT been a fixed 1 mm since issue #148.

**`detected` is an ALARM flag, not "the object exists"** (issue #263). The
payload being present means the field is concentrated enough to describe
(`concentrationRatio` > 3); `detected` means it is conclusive enough on a
SINGLE mesh to act on (ratio > 6, or an isolated peak with no neighbours).
Anything showing a banner must key on `detected`; diagnostics may use the
payload either way.

The band between the two is deliberate. A binary gate on this ratio flickers:
measured on one part at four densities, the ratio came out 3.3 / 3.1 / <3.0 /
<3.0 while the peak wandered non-monotonically, so which side of a 3.0 gate a
given mesh landed on was decided by noise — a user refining their mesh watched
the warning appear and vanish for no physical reason. What covers the band
instead is `bcSingularityErrorFraction`, which read 41–49% across those same
four meshes: an integrated energy norm, which is why it does not flicker.

Note also that `neighborhoodRadiusMm` is floored at 5% of the part's bounding
diagonal. A purely element-relative radius cannot detect a singularity at all —
the field is self-similar near the tip, so a ball that shrinks with the mesh
gives a constant, small ratio however severe the singularity is.

`cause` (issue #257) is `geometry`, `constraint-edge`, or `load-edge`, and it
selects the remedy `message` gives. The three need opposite advice: a fillet for
a re-entrant corner, a better bolt idealization for a clamp edge (#260), a
realistic contact size for a loaded-patch rim. `load-edge` was called
`load-point` before #271 — the name was wrong in a way that mattered, because
the legacy load model spreads a force over a band of the extreme face, so what
is singular is that band's RIM and never a point. It is decided by which BC rim
the peak is NEAREST — on a compact part the sampling neighborhood can contain
both, and a first-match test blamed the constraint for a peak sitting on the
loaded node. Exact ties go to the constraint.

Detection keys on the SHAPE of the field (`concentrationRatio` > 3), never on
absolute stress. It formerly also required a peak above a hardcoded 50 MPa,
commented as "2× yield" for PLA, which made the warning depend on how hard the
part was loaded: an identical field with a 12× ratio was flagged at 51 MPa and
silent at 50. That is why the warning stayed silent on bolt-constrained parts,
whose peaks sit in the single-digit MPa. `nearYield` reports the yield
comparison that gate used to make, and changes the wording only — it never
suppresses the warning, because a singular peak is mesh-dependent whether or not
it is near yield, and that mesh-dependence is the thing being reported.

`peakVertexIdx` indexes the DISPLAY mesh (3 vertices per surface triangle), not
the FEA node array. Use `peakLocation` for anything spatial.

The field assessed is the FEA solution, not the display mesh (issue #263). It
used to be the display mesh, whose tessellation does not refine when the solve
does: the radius measured 13.25 mm on a part 12 mm across — larger than the part
— so the "ratio" was a peak-vs-whole-part contrast. Peak-finding, neighbour
sampling and the length scale now all come from the same mesh.

Remaining limitation, and it is a real one: a single mesh cannot settle whether
a moderate concentration is singular. Detecting divergence needs the multi-mesh
refinement study the client performs, which is what upgrades `evidence` to
`refinement`. Read a `single-mesh-heuristic` result below the alarm threshold as
"worth knowing", not as a verdict.

#### Mesh sensitivity (issue #294)

**The API publishes nothing for this.** The displayed field carries a scattered,
mesh-dependent tail — re-mesh the same part at the same density and the hot
spots move — and the `meshsens` view mode reports where. That comparison is
computed entirely in the client (`meshSensitivityField` /
`installMeshSensitivity`, `client/index.html`) by differencing the
`vertexStressB64` arrays of two analyse responses.

It is free precisely because it needs no new endpoint or field: every analyse
response paints the SAME display mesh (`positionsB64` from the request), whatever
the analysis density, so the comparison is an array difference and never a
re-projection. A caller wanting it does the same thing: run `/api/analyse`
twice at different `analysis.meshQuality` tiers and difference the two
`vertexStressB64` buffers element-wise. One solve cannot measure its own
mesh-dependence, and the mode does not appear until a second one exists.

Do not reach for `topErrorElements` for this. The ZZ estimator differences the
RECOVERED field against the RAW element field, so an artifact carried by both
cancels; measured Spearman against actual mesh-to-mesh disagreement was 0.015,
then 0.061 / −0.066 / −0.164 on re-measurement. `topErrorElements` is not "here
is where the picture lies". See `docs/display-field-mesh-sensitivity.md`.

---

## Demo

### `GET /api/demo/part`
Returns a sample part STL for the one-click judge demo, run through the real
pipeline. Query `?type=` selects an archetype (default `bracket`); an unknown
type silently falls back to `bracket`'s metadata. Response is
`application/octet-stream` with `Content-Disposition: attachment`, plus
`X-Demo-Dims` (the `DEMO_BRACKET` dimensions) and `X-Demo-Meta` (the archetype
metadata) headers, both JSON-encoded. No error path.

### `GET /api/demo/archetypes`
Returns the `DEMO_ARCHETYPE_META` object for the picker — keyed by archetype id,
not an array. No error path.

---

## Calibration

Physical-coupon calibration lets a team tune the model to their printer. Profiles
persist to `~/.stressform_calibrations.json`. A corrupt or unparseable store is
treated as empty rather than raising.

### `GET /api/calibration`
List saved profiles and standard coupon dimensions.
**Response** `{ "profiles": [...], "couponDims": {...} }` (`COUPON_DIMS`). No
error path.

### `POST /api/calibration/calculate`
Back-calculate a material profile from measured coupon failure loads (no save).
**Body** `{ id, label, materialId, layerHeightMm, tensileFailN?, zTensileFailN?,
lapShearFailN?, bearingFailN?, tensileDeflMm?, ktLapShear?, ktBearing? }`.
The first four are REQUIRED; the coupon loads are nullable by design (`null`
means "not tested", which the validator treats as absent). `zTensileFailN`
measures the through-layer tension allowable `S_zt` directly; `lapShearFailN`
calibrates the interlaminar shear allowable `S_zs` independently.
**Response** `{ "profile": {...} }`.
**Errors** `400` on a shape violation (uniform envelope) and `400`
`{ "error": "<string>" }` on any throw from `backCalculateProfile`.

### `POST /api/calibration/fatigue`
Fit an S-N (Basquin) curve from cyclic-coupon points — the fatigue analogue of
`/calculate`. Lifts the fatigue mode LOW→MEDIUM.
**Body** `{ materialId?, utsMPa?, enduranceLifeCycles?, points: [{
stressAmplitudeMPa, cycles }, …] }`.

This route does NOT use the shared shape validator. It checks only that `points`
is an array of length ≥ 2; the interior of each point is unvalidated, and
`materialId` is accepted but never read. `utsMPa` defaults to **55** when
absent or non-positive, `enduranceLifeCycles` to **1e6**.

**Response** `{ fit, fitQuality, fatigueFields: { fatigueSeRatio,
fatigueBasquinB, fatigueUTS_MPa, fatigueFitQuality }, warning? }` — merge
`fatigueFields` into a profile. `fit` carries `logRms` and `fitQuality`.

A POOR fit is ACCEPTED, not rejected: cyclic-coupon scatter is physically
inherent, so a team's own noisy S-N data is still their best available. It comes
back with `fitQuality: "poor"` and a `warning` string, and it keeps the fatigue
mode at LOW confidence while still using the measured Se/b.

**Errors** `400` fewer than 2 points (`field: "points"`); `400`
`{ "error": "<string>" }` on any throw.

### `POST /api/calibration/bond-sweep`
Fit the bead-penetration bond model's coefficients (`hConv`,
`activationEnergyKJmol`, `strengthPrefactor`) to a process sweep of Z-tension
coupons printed at varied nozzle temp / speed / fan / layer height. Lifts the
bond model LOW→MEDIUM.

**Body** `{ materialId, yieldXY_MPa?, yieldZ_over_yieldXY?, points: [{
layerHeightMm, measuredSztMPa?, zTensileFailN?, nozzleTempC?, printSpeedMmS?,
coolingFanPct?, bedTempC?, ambientTempC? }, …] }`. Within a point only
`layerHeightMm` is required by the validator, but each point must resolve to a
positive strength: `measuredSztMPa` if given, else `zTensileFailN` divided by
the Z-tension gauge area (`COUPON_DIMS.zTensile.gaugeWidthMm ×
gaugeThickMm`). `yieldXY_MPa` defaults to the material's literature yield and
`yieldZ_over_yieldXY` to `literatureYieldZRatio()`.

**Response** `{ fit, fitQuality, bondFields: { bondCoeffs } }` — merge
`bondFields` into a profile. `fit` carries `rmsePct` and per-point residuals.

**Errors.** Unlike `/fatigue`, a poor fit is REJECTED: bond coefficients apply
multiplicatively to interlayer strength and stiffness in every later analysis
carrying process settings, so a fit the physical model cannot reproduce would
silently corrupt all of them. `400` in that case, with an enriched envelope:

```json
{
  "error": "Bond sweep fit quality too poor to accept: …",
  "field": "points",
  "rmsePct": 31.4, "thresholdPct": 15, "fitQuality": "poor",
  "worstPoint": { "index": 3, "measuredMPa": 12.1, "predictedMPa": 19.8, "deviationPct": 63.6 },
  "points": [ { "index": 0, "measuredMPa": …, "predictedMPa": …, "deviationPct": … } ]
}
```

Also `400` for an unknown `materialId` (`field: "materialId"` — checked against
the bond property table, which is a different set from `MATERIAL_IDS`), `400`
for a point with no positive strength (`field: "points"`), `400` on a shape
violation, and `400` `{ "error": "<string>" }` on any throw.

### `POST /api/calibration/save`
Persist a profile (upserted by `id` — the stored profile with that id is
replaced wholesale, and the new one is appended, so save order is not
preserved). Validated only as `{ id: string, materialId: string }`; the rest of
the body is stored verbatim.
**Response** `{ "saved": true, "profileCount": n }`. **Errors** `400` shape,
`500` write failure.

### `DELETE /api/calibration/:id`
Remove a profile. **Response** `{ "deleted": true }` — always, whether or not
the id existed. No error path, no 404.

### `GET /api/calibration/export-all`
Download every profile as one JSON bundle (`Content-Disposition: attachment`,
filename `stressform_calibrations_<epoch>.json`) so a team can move calibration
data between machines. Body: `{ version: "1.0", exportedAt, tool, profileCount,
profiles }`. **Errors** `500`.

### `POST /api/calibration/import-all`
Merge profiles from an exported bundle. Matches by `id`: imported overwrites
local of the same id; new ids are added; local-only ids are preserved — so
importing is idempotent and never drops a local profile that was not in the
bundle. An entry is accepted only if `id` and `materialId` are both strings;
malformed entries are skipped and the first 80 characters of each are echoed
back.
**Body** `{ "profiles": [ … ] }` (each element must be an object).
**Response** `{ imported, skipped, skippedSamples, totalProfiles }`.
**Errors** `400` shape, `500` write failure.

### `GET /api/calibration/coupon/:type`
Download a calibration coupon STL. `:type` ∈ `tensile` ｜ `ztensile` ｜
`lapshear` ｜ `bearing` (`ztensile` is the same dog-bone geometry printed
standing on end for the through-layer tension coupon). Response is
`application/octet-stream` with `Content-Disposition: attachment` and a
`stressform_*_coupon.stl` filename. **Errors** `400`
`{ "error": "Unknown coupon type" }` (no `field`/`hint`), `500` on a generator
throw.

### `POST /api/calibration/kt`
Run FEA on standard coupon geometry to extract stress-concentration factors (Kt)
for lap-shear and bearing coupons.
**Body** `{ materialId, layerHeightMm? }` — `layerHeightMm` defaults to 0.2.
**Response** `{ ktLapShear, ktBearing, converged }`.

`ktLapShear` is **always exactly 1.0** — a policy constant, not a solve result
(issue #140). The calibrated lap-shear allowable is the APPARENT (average)
interlaminar shear strength `F/A_overlap` by design: the end-of-overlap shear
peak is a geometric singularity whose FEA "Kt" only tracks mesh density, and the
part-level criterion evaluates interlaminar shear on element-averaged stress, so
an average-based allowable is the consistent measure.

`ktBearing` comes from a real solve on a plate-with-hole probe and is **`null`
when that solve did not converge** — `converged` reports the same thing. There
is no separate convergence flag for the lap-shear number because there is no
lap-shear solve.

**Errors** `400` shape, `500` on any throw (including a mesher failure).

---

## Bond model

### `POST /api/bond-sensitivity`
Evaluate the bead-penetration bond model over process-parameter sweeps and a
nozzle×speed bond-quality surface. No solve — pure evaluation of
`predictBondMultipliers`, so the client never duplicates the physics. Powers the
BOND SENSITIVITY panel.

**Body** `{ materialId, layerHeightMm, process?: { nozzleTempC?,
printSpeedMmS?, coolingFanPct?, bedTempC?, ambientTempC? }, bondCoeffs?: {
hConv?, activationEnergyKJmol?, strengthPrefactor? } | null }`. Only
`materialId` and `layerHeightMm` are validated; `process` and `bondCoeffs` are
read without shape checking. A `layerHeightMm` ≤ 1e-6 is replaced by 0.2, and
the response echoes the value actually used.

Absent process fields are filled from the material's own reference condition, so
an empty `process` block sits exactly at the reference (`relStrength = 1.0`).
The fan reference is PER-MATERIAL (issue #184) — ABS/ASA/PA anchor at
fan-off/low, PLA/PETG high — so "no fan setting" does not mean 100% for every
material.

**Response** `{ materialId, layerHeightMm, reference, baseline, sweeps, surface }`:

- `reference` — `{ nozzleTempC, …BOND_REFERENCE }`, the condition the
  multipliers are relative to.
- `baseline` — the caller's effective settings plus `relStrength`,
  `relStiffness`, `strengthFactor`, `confidence`, `clamped`, `note` (4 dp).
- `sweeps` — four 1-D curves keyed `nozzleTempC`, `printSpeedMmS`,
  `coolingFanPct`, `layerHeightMm`, each `{ unit, label, baseValue, points: [{
  value, relStrength, strengthFactor }] }`. 15 points each except
  `coolingFanPct`, which has 11. `strengthFactor` is the FULL multiplier
  (`layerHeightFactor(lh) × relStrength`), `relStrength` the bond part alone.
- `surface` — the nozzle×speed grid for the sweet-spot map: `{ xKey, xUnit,
  xLabel, xValues (15), yKey, yUnit, yLabel, yValues (15), grid, baseX, baseY,
  valueLabel }`. `grid` is indexed `[speedIndex][nozzleIndex]` — y-major, x-minor
   — and holds `relStrength`, not `strengthFactor`.

**Errors** `400` shape, `400` unknown `materialId` (`field: "materialId"`, with
a `hint` listing the bond-table materials), `400` `{ "error": "<string>" }` on
any throw.

---

## Validation scoreboard

Track predicted vs. measured failure loads. Persists to
`~/.stressform_validations.json`. (Distinct from `summary.validationCoverage`,
which is computed per analysis from `server/validation-coverage.ts` and has no
route of its own.)

### `GET /api/validation`
All cases with derived fields plus aggregate stats.
**Response** `{ cases: [ { …case, derived } ], stats }`, where
`derived` = `{ errorPct, ratio, conservative }` — signed
`(predicted − measured)/measured × 100`, `predicted/measured`, and
`predicted ≤ measured` — and `stats` = `{ n, meanSignedErrorPct,
meanAbsErrorPct, rmsErrorPct, nNonConservative, worstNonConservativePct,
worstNonConservativeId, pctWithinBand, bandPct, correlation }`.
`worstNonConservativePct` / `worstNonConservativeId` are `null` when no case is
non-conservative; `correlation` (Pearson r of predicted vs measured) is `null`
when `n < 2` or either series is degenerate; `bandPct` is fixed at 25 and is
echoed so `pctWithinBand` is interpretable. An empty store returns all-zero
stats, not an error. No error path.

### `POST /api/validation/save`
Add or update a case (upserted by `id`). Validated as `{ id: string,
predictedFailN: number, measuredFailN: number }`; the remaining `ValidationCase`
fields (`label`, `partName`, `governingMode?`, `materialId?`, `orientation?`,
`layerHeightMm?`, `calibrated?`, `notes?`, `createdAt`) are stored verbatim
without checking. Both loads must be `> 0`.
**Response** `{ saved: true, count, derived, stats }`.
**Errors** `400` shape; `400` a non-positive load, with `field` naming
whichever of the two is at fault; `500` write failure.

### `DELETE /api/validation/:id`
Remove a case. **Response** `{ deleted: true, stats }` — always, whether or not
the id existed. No error path, no 404.

---

## Solver tests & methodology

### `GET /api/solver-tests`
Run the compiled solver-validation suite (`dist/tests/solver_validation.js`) as a
child process (30 s timeout) and stream back structured results parsed from its
stdout/stderr `✓`/`✗` markers.
**Response** `{ passed, failed, total, groups: [ { name, tests: [ { name,
passed, detail? } ] } ], rawLines }`. `rawLines` is every non-empty output line,
so a parse miss is still inspectable.
**Errors** `404` `{ error: "Validation suite not compiled. Run: npm run build",
tests: [] }` when `dist/tests/solver_validation.js` is absent — note the extra
`tests` key on that envelope; `500` `{ error, tests: [], groups: [] }` if the
child process fails to spawn. A non-zero exit code from the suite is NOT an
error — the failures are reported in `failed`/`groups` with a `200`.

### `GET /api/methodology`
Returns a self-contained two-page HTML document (`text/html`), printable to PDF
for an engineering notebook. No analysis result required, no parameters, no
error path. See [`METHODOLOGY.md`](METHODOLOGY.md) for the same content in
Markdown.

---

## Session & export

Client state autosaves to `~/.stressform_session.json` (metadata only, no
geometry).

### `GET /api/session`
Return the saved session, or `null` if none. A missing, unreadable or
unparseable file all return `null` with a `200` — this route never errors.

### `POST /api/session`
Persist the session. Body must be a JSON object (that is the whole validation —
the interior is free-form client state, checked only so a corrupted request
cannot store `null`). **Response** `{ "saved": true }`. **Errors** `400` if the
body is not an object; `500` write failure.

### `DELETE /api/session`
Clear the saved session. **Response** `{ "cleared": true }` — including when no
session existed and when the unlink failed. No error path.

### `POST /api/export-zip`
Bundle session metadata + calibration profile + HTML report into a single JSON
download (`Content-Disposition: attachment`, filename
`stressform_export_<epoch>.json`). Despite the route name the result is JSON,
not a zip — a true zip would need a dependency.
**Body** `{ session?, reportHtml?, calibProfile? }`, all optional.
**Response body** `{ version: "1.0", exportedAt, tool, session,
calibrationProfile, reportHtmlB64 }` — the report is embedded base64, and each
absent input becomes `null`.
**Errors** `400` shape, `500` on any throw.

---

## Reporting

### `POST /api/report`
Render a full HTML analysis report from a result object.

**Body** `{ result, fileName?, printSettings?, timestamp? }`. `result` is
tightly validated (issue #281): every string field in it flows into generated
HTML, so the route rejects an arbitrary payload before the template sees it
rather than relying on escaping alone. REQUIRED inside `result`: `verdict`,
`maxVonMisesMPa`, `maxDisplacementMm`, `effectiveYieldMPa`, `estimatedFailForce`,
`nodesPerElem`, `converged`, `meshFallback`, `sfCriterion`, `materialModel`,
`fatigue`, `isotropicComparison`, `failureModes` (each `{ mode, note, checked?,
sf?, confidence? }`), `holeClassifications` (each `{ type, warning?, bolt? }`),
`topologySuggestions` (each `{ suggestion, stressMPa?, position? }`). OPTIONAL:
`safetyFactor`, `bulkSafetyFactor`, `bulkFailForceN`, `governingMode`,
`safetyfactorLow`, `safetyFactorHigh`, `singularity`, `rigidBodyMode`,
`calibrationId` — the #278 disclosure trio is optional so a session saved before
that change can still be rendered.

`result.sfCriterion` must be `"fdm-interface"｜"hill"｜"von-mises"`, matching
`summary.sfCriterion` from `/api/analyse` — so a summary can be posted straight
back. `printSettings` accepts `{ materialId?, infillPct?, wallCount?, pattern?,
orientation?, layerHeightMm? }`, all optional. Defaults: `fileName` `"part"`,
`printSettings` `{}`, `timestamp` the server's current locale string.

**Response** `text/html`. **Errors** `400` shape (the common case is posting a
summary that lacks one of the required keys), `500` on a render throw.

> PDF export is fully **client-side** (`exportFullReportPDF()` in
> `client/index.html`) — there is no server-side PDF route, deliberately, so the
> app has no Chromium/Puppeteer dependency and works offline.

---

## Onshape integration

Import parts directly from an Onshape Part Studio via the REST API (HMAC-signed
requests live in `server/onshape.ts`). Credentials persist to
`~/.stressform_onshape.json` (`0600`).

**URL forms accepted.** `parseOnshapeUrl` takes any host containing
`onshape.com` and a path matching
`/documents/{did}/{w|v|m}/{wvmid}/e/{eid}` — so version (`/v/`) and microversion
(`/m/`) links work, not only workspace (`/w/`) links. The `hint` strings on the
`400` responses mention only the `/w/` form.

### `GET /api/onshape/status`
**Response** `{ "configured": true|false }`. A present-but-unparseable
credentials file reads as `false`. No error path.

### `POST /api/onshape/credentials`
Save an API key pair. **Body** `{ accessKey, secretKey }` (both strings, both
non-empty). **Response** `{ "saved": true }`. The file is written atomically
with mode `0600`; on Windows it is additionally locked down via `icacls`, and a
failure there is logged as a warning rather than failing the request.
**Errors** `400` shape, `400` an empty string (`field` naming whichever is
empty), `500` write failure.

### `POST /api/onshape/parts`
List parts in a Part Studio. Requires configured credentials.
**Body** `{ url }`. **Response** `{ "parts": [ { partId, name } ] }` — a
non-array response from Onshape yields `[]` rather than an error.
**Errors** `401` `{ "error": "Onshape not configured" }` (checked BEFORE body
validation, so an unconfigured server returns 401 even for a malformed body);
`400` unparseable URL (`field: "url"`); `401` if Onshape answered 401 or 403;
`502` for any other non-200 from Onshape; `500` on a thrown fetch error.

### `POST /api/onshape/import`
Export a part as STEP from Onshape and run it through the upload pipeline (Gmsh
mesh, hole detection). Requires configured credentials.
**Body** `{ url, partId? }` — `partId` omitted exports the whole Part Studio.
**Response** the same shape as `POST /api/upload` for a STEP part, plus
`onshapeUrl` (the URL as sent). `holes[].confidence` starts at `0.95` here
(rather than `1.0` on the upload path), dropping to `0.5` on a merge warning,
and `radius`/`diameter` are NOT rounded.
**Errors** `401` not configured (again checked before body validation, with a
different message from `/parts`); `400` unparseable URL (`field: "url"`);
`500` for everything else — unlike `/parts`, this route does NOT map Onshape
auth or upstream failures to `401`/`502`, so a bad key surfaces here as a `500`.

### `DELETE /api/onshape/credentials`
Remove the saved key. **Response** `{ "cleared": true }` — including when no
file existed and when the unlink failed. No error path.

---

*Source of truth: [`server/index.ts`](../server/index.ts). If a handler and this
document disagree, the handler wins — please open a PR to fix the doc.*
