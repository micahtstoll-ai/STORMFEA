# STORMFEA HTTP API Reference

STORMFEA runs as a local Express server on `http://localhost:3000`. The
single-file client (`client/index.html`) is the only intended consumer, but the
API is a plain JSON/REST surface you can also drive from `curl`, Postman, or a
script. This document covers every route defined in
[`server/index.ts`](../server/index.ts).

## Conventions

- **Base URL:** `http://localhost:3000`
- **CORS:** requests are accepted only from `localhost` / `127.0.0.1` origins (or
  no-origin callers such as curl). Any other `Origin` gets `403`.
- **Body limit:** JSON bodies up to **50 MB**; uploaded files up to **50 MB**.
- **Error envelope:** every error response uses a uniform shape

  ```json
  { "error": "human-readable message", "field": "offending.field", "hint": "how to fix it" }
  ```

  `field` and `hint` are present where the server can identify them. `POST`
  routes validate their body shape *before* any decode/mesh/solve work, so a
  malformed request returns a `400` with the offending field path rather than an
  opaque mid-pipeline `500`.
- **Status codes:** `400` malformed/invalid request · `401` Onshape not
  configured · `403` CORS denial · `413` body/file too large · `404` build
  artifact missing · `503` meshing binary (TetGen) not installed · `500`
  unexpected server error.

## Endpoint index

| Group | Method & path |
|-------|---------------|
| UI | `GET /` |
| Health | `GET /api/health` |
| Geometry | `POST /api/upload` |
| Analysis | `POST /api/analyse` |
| Demo | `GET /api/demo/part` · `GET /api/demo/archetypes` |
| Calibration | `GET /api/calibration` · `POST /api/calibration/calculate` · `POST /api/calibration/save` · `DELETE /api/calibration/:id` · `GET /api/calibration/export-all` · `POST /api/calibration/import-all` · `GET /api/calibration/coupon/:type` · `POST /api/calibration/kt` |
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
client directory are also served.

### `GET /api/health`
Liveness probe.

**Response** `200`
```json
{ "status": "ok", "version": "43" }
```

---

## Geometry

### `POST /api/upload`
Parse an uploaded part and return display geometry + detected holes. STL is
parsed directly; STEP/STP is meshed by Gmsh for bounds and hole walls.

**Request** — `multipart/form-data` with a single part named `file`
(`.stl`, `.step`, or `.stp`, ≤ 50 MB).

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
STEP responses additionally include `stepB64` (the original STEP bytes, echoed
back for the analyse call). Errors: `400` no file / unsupported type, `500`
parse or mesh failure.

---

## Analysis

### `POST /api/analyse`
Run the full FEM pipeline (mesh → assemble → solve → stress recovery → failure
modes) and return the stress field plus a result summary. This is the core
endpoint.

**Request** `application/json`. The body is the object returned by
`/api/upload` plus the user's load/print choices. Validated against
`ANALYSE_SPEC` in `server/index.ts` before any work begins. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `positionsB64` | string | Base64 Float32 positions from `/api/upload` (required) |
| `fileType` | `"stl"｜"step"` | Defaults to `stl` |
| `stepB64` | string | Required for STEP parts |
| `triangleCount` | number | |
| `bounds` | `{minX,maxX,minY,maxY,minZ,maxZ}` | |
| `holes[]` | array | `{ id, centre[3], normal[3], radius, confidence?, edgeCount? }`. Upload responses may also include `warning` (overlapping/merged-hole flag). |
| `boltHoleIds[]` | number[] | Which holes are bolted (constraints) |
| `boltFasteners[]` | array | Optional per-hole fastener spec |
| `forces[]` | array | `{ magnitude, direction[3], position[3], loadDistribution? }` |
| `print` | object | `{ materialId, infillPct, wallCount, pattern, orientation, layerHeightMm, meshOrder?, useCLT? }` |
| `meshQuality` | `"coarse"｜"standard"｜"fine"` | Optional |
| `analysisType` | string | `linear_static` (default) or `modal` |
| `computeBuckling` | boolean | Opt-in linear buckling |
| `gravity` | `{ g, direction[3] }` | Optional body-force load |
| `pressures[]` | array | Optional surface loads `{ magnitude, direction[3], normal?, region? }`. `magnitude` in MPa (negative = outward/suction). `normal:true` follows each triangle's own outward normal. `region` ∈ `"face"` (default, extreme face toward `direction`), `"facing"` (all faces toward `direction`), `"all"` (whole surface / hydrostatic). |
| `fatigueLoadRatio` | number | Optional fatigue load ratio `R = σ_min/σ_max` (default `0`; clamped to `[-1, 0.95]`) |
| `layerNormal` | `[x,y,z]` | Optional through-layer (weak) axis from the picked bed face. Present → exact weak-axis tensor rotation for upright/angled prints; absent → conservative scalar-swap fallback. Direction only (sign/azimuth immaterial). |
| `calibration` | object | Optional active calibration profile |

**Response modes**

1. **Blocking JSON (default).** Returns a single JSON object once the solve
   finishes.
2. **Server-Sent Events (opt-in).** Add `?stream=1` *or* send
   `Accept: text/event-stream`. The server emits ordered `phase` events (mesh →
   constraints → assembly → solve → recovery → mapping), streams CG residual
   checkpoints, then a final `result` event with the same payload as the
   blocking mode, or an `error` event. Closing the connection aborts the
   server-side solve at the next phase boundary.

**Response payload** (`summary` excerpt — see `buildPayload` in
`server/index.ts` for the full field list):
```json
{
  "summary": {
    "maxVonMisesMPa": 41.2,
    "maxDisplacementMm": 0.83,
    "effectiveYieldMPa": 29.0,
    "safetyFactor": 0.70,
    "sfCriterion": "Hill",
    "vonMisesSafetyFactor": 1.21,
    "safetyfactorLow": 0.58, "safetyFactorHigh": 0.86,
    "estimatedFailForce": 140.0,
    "yielding": true,
    "verdict": "FAIL",
    "converged": true, "cgIterations": 412, "solverMs": 1830,
    "nodeCount": 8461, "elementCount": 4210, "nodesPerElem": 10,
    "failureModes": [ /* per-mode SF + confidence */ ],
    "recommendations": [ /* strings */ ],
    "fatigue": { /* Goodman estimate */ },
    "isotropicComparison": { /* what plain von Mises would have said */ }
  },
  "vertexStressB64": "<base64 Float32 per-vertex von Mises>",
  "vertexDisplacementB64": "<base64 Float32 per-vertex displacement>",
  "vertexPrincipalStressB64": "…",
  "modalResult": null
}
```
Large numeric arrays (per-vertex stress, displacement, principal stresses,
utilisation, mode shapes) are base64-encoded Float32 buffers. Errors: `400`
invalid body / undecodable `positionsB64`, `503` TetGen not installed (with
install hint), `500` solver failure, timeout after 120 s.

---

## Demo

### `GET /api/demo/part`
Returns a sample part STL for the one-click judge demo, run through the real
pipeline. Query `?type=` selects an archetype (default `bracket`). Response is
`application/octet-stream` with `X-Demo-Dims` / `X-Demo-Meta` headers.

### `GET /api/demo/archetypes`
Returns the available demo archetypes (`DEMO_ARCHETYPE_META`) for the picker.

---

## Calibration

Physical-coupon calibration lets a team tune the model to their printer. Profiles
persist to `~/.stressform_calibrations.json`.

### `GET /api/calibration`
List saved profiles and standard coupon dimensions.
**Response** `{ "profiles": [...], "couponDims": {...} }`

### `POST /api/calibration/calculate`
Back-calculate a material profile from measured coupon failure loads (no save).
**Body** `{ id, label, materialId, layerHeightMm, tensileFailN?, lapShearFailN?, bearingFailN?, tensileDeflMm?, ktLapShear?, ktBearing? }`
(coupon loads are nullable — `null` means "not tested").
**Response** `{ "profile": {...} }`

### `POST /api/calibration/save`
Persist a profile (upserted by `id`).
**Body** `{ id, materialId, ... }` **Response** `{ "saved": true, "profileCount": n }`

### `DELETE /api/calibration/:id`
Remove a profile. **Response** `{ "deleted": true }`

### `GET /api/calibration/export-all`
Download every profile as one JSON bundle (`Content-Disposition: attachment`) so
a team can move calibration data between machines.

### `POST /api/calibration/import-all`
Merge profiles from an exported bundle. Matches by `id` (imported overwrites
local of same id; new ids are added; local-only ids are preserved). Malformed
entries are skipped and reported.
**Body** `{ "profiles": [ ... ] }`
**Response** `{ imported, skipped, skippedSamples, totalProfiles }`

### `GET /api/calibration/coupon/:type`
Download a calibration coupon STL. `:type` ∈ `tensile` | `lapshear` | `bearing`.
Response is `application/octet-stream`; `400` for unknown types.

### `POST /api/calibration/kt`
Run FEA on standard coupon geometry to extract stress-concentration factors (Kt)
for lap-shear and bearing coupons.
**Body** `{ materialId, layerHeightMm? }` (defaults to 0.2 mm)
**Response** `{ ktLapShear, ktBearing, converged }`

---

## Validation scoreboard

Track predicted vs. measured failure loads. Persists to
`~/.stressform_validations.json`.

### `GET /api/validation`
All cases with derived fields plus aggregate stats.
**Response** `{ "cases": [ { ..., "derived": {...} } ], "stats": {...} }`

### `POST /api/validation/save`
Add or update a case (upserted by `id`). Both loads must be `> 0`.
**Body** `{ id, predictedFailN, measuredFailN, ... }`
**Response** `{ saved, count, derived, stats }`

### `DELETE /api/validation/:id`
Remove a case. **Response** `{ deleted: true, stats }`

---

## Solver tests & methodology

### `GET /api/solver-tests`
Run the compiled solver-validation suite (`dist/tests/solver_validation.js`) as a
child process and stream back structured results.
**Response** `{ passed, failed, total, groups: [ { name, tests: [ {name, passed, detail?} ] } ], rawLines }`
Returns `404` if the suite has not been compiled (`npm run build` first).

### `GET /api/methodology`
Returns a self-contained two-page HTML methodology document (printable to PDF for
an engineering notebook). No analysis result required. See
[`METHODOLOGY.md`](METHODOLOGY.md) for the same content in Markdown.

---

## Session & export

Client state autosaves to `~/.stressform_session.json` (metadata only, no
geometry).

### `GET /api/session`
Return the saved session, or `null` if none.

### `POST /api/session`
Persist the session. Body must be a JSON object. **Response** `{ "saved": true }`

### `DELETE /api/session`
Clear the saved session. **Response** `{ "cleared": true }`

### `POST /api/export-zip`
Bundle session metadata + calibration profile + HTML report into a single JSON
download (`Content-Disposition: attachment`).
**Body** `{ session?, reportHtml?, calibProfile? }`

---

## Reporting

### `POST /api/report`
Render a full HTML analysis report from a result object.
**Body** `{ result, fileName?, printSettings?, timestamp? }`
**Response** `text/html`.

> PDF export is fully **client-side** (`exportFullReportPDF()` in
> `client/index.html`) — there is no server-side PDF route, deliberately, so the
> app has no Chromium/Puppeteer dependency and works offline.

---

## Onshape integration

Import parts directly from an Onshape Part Studio via the REST API (HMAC-signed
requests live in `server/onshape.ts`). Credentials persist to
`~/.stressform_onshape.json` (`0600`).

### `GET /api/onshape/status`
**Response** `{ "configured": true|false }`

### `POST /api/onshape/credentials`
Save an API key pair. **Body** `{ accessKey, secretKey }` (both non-empty).
**Response** `{ "saved": true }`. On Windows the file is additionally locked down
via `icacls`.

### `POST /api/onshape/parts`
List parts in a Part Studio. Requires configured credentials (`401` otherwise).
**Body** `{ url }` (a `cad.onshape.com/documents/{did}/w/{wid}/e/{eid}` URL).
**Response** `{ "parts": [ { partId, name } ] }`. Bad URL → `400`; Onshape
auth/access failure → `401`/`502`.

### `POST /api/onshape/import`
Export a part as STEP from Onshape and run it through the upload pipeline
(Gmsh mesh, hole detection). Requires configured credentials.
**Body** `{ url, partId? }`
**Response** same shape as `POST /api/upload` for a STEP part, plus `onshapeUrl`.

### `DELETE /api/onshape/credentials`
Remove the saved key. **Response** `{ "cleared": true }`

---

*Source of truth: [`server/index.ts`](../server/index.ts). If a handler and this
document disagree, the handler wins — please open a PR to fix the doc.*
