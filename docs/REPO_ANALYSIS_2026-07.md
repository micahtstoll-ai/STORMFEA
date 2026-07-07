# STORMFEA Repository Analysis — July 2026

Full-repo audit: every automated test executed, every HTTP endpoint exercised live
(including real TetGen 1.5.0 and Gmsh 4.12.1 meshing), the solver CPU-profiled,
and an independent physics verification of the C3D10 element path. Findings are
ordered by severity; each includes reproduction evidence. Proposals follow in
§4–§7.

---

## 1. Test Results

### 1.1 Automated suites — all passing

| Suite | Command | Result |
|---|---|---|
| Unit tests (vitest) | `vitest run` | **117 passed** (10 files, 105s) |
| TypeScript compile | `tsc` | clean |
| Solver validation | `node dist/tests/solver_validation.js` | **82 passed, 0 failed** (22 groups) |
| Client logic | `node scripts/test_client_logic.mjs` | **41 passed, 0 failed** |
| Live re-run via API | `GET /api/solver-tests` | 82/82, groups parsed correctly |

Note: README §Contributing says "67 tests in solver_validation.ts + 69 vitest
unit tests across 6 files" — actual counts are 82 + 117 across 10 files. Stale.

### 1.2 Live endpoint exercise

Server started from `dist/`, all routes exercised with real payloads:

| Endpoint | Result |
|---|---|
| `GET /api/health` | ✓ `{status:"ok",version:"43"}` |
| `GET /api/demo/archetypes`, `/api/demo/part?type=bracket` | ✓ 19,284-byte STL + meta headers |
| `POST /api/upload` (STL) | ✓ 384 tris, 1 hole Ø5.0 detected (conf 0.657) |
| `POST /api/upload` (STEP, Gmsh) | ✓ 808 tris, hole Ø4.9988 vs true Ø5.0 (conf 1.0) |
| `POST /api/analyse` (no TetGen → box fallback) | ✓ honest verdict, SF=null, meshFallback=true |
| `POST /api/analyse` (TetGen C3D10) | ✓ completes — but see F1 (wrong stiffness) and F2 (6.5 min runtime) |
| `GET /api/calibration`, coupon downloads, `POST calculate/save`, `DELETE` | ✓ |
| `GET/POST/DELETE /api/session` | ✓ round-trips |
| `GET /api/validation`, `POST save`, `DELETE` | ✓ stats computed |
| `POST /api/report` | ✓ HTML report (titled "StressForm Report" — see F6) |
| `GET /api/methodology` | ✓ 2-page printable HTML |
| `POST /api/export-zip` | ✓ JSON bundle |
| `GET /api/onshape/status` | ✓ `{configured:false}` (import path not testable without credentials) |

---

## 2. Critical Findings (verified with evidence)

### F1 — TetGen `-o2` C3D10 midside-node permutation is wrong · **HIGH / correctness**

`server/tetgen.ts:140` hardcodes `C3D10_REORDER = [0,1,2,3,4,7,5,6,8,9]` with a
comment admitting it "must be verified empirically once a TetGen binary is
available." It never was — **and the path is live**: `analysis.ts` requests
`elementOrder=2` for every STL upload when TetGen is present (README's claim
that "STL uploads use C3D4 only" is out of date).

Verified against a real TetGen binary (1.5.0). Geometric midpoint derivation
over 50 elements shows TetGen emits midside slots in edge order
`(2-3),(0-3),(0-1),(1-2),(1-3),(0-2)`, while `element.ts:489-496` expects
`(0-1),(1-2),(0-2),(0-3),(1-3),(2-3)`. Cantilever tip-deflection vs
Euler-Bernoulli (the same check as validation group [19], which passes 0.94 at
just 48 elements on the internal mesher):

| Permutation | 280 elems | 567 elems |
|---|---|---|
| repo `[0,1,2,3,4,7,5,6,8,9]` | **0.587** | **0.661** |
| identity | 0.538 | 0.530 |
| correct `[0,1,2,3,6,7,9,5,8,4]` | **0.984** | **0.986** |

Impact: every STL analysis with TetGen installed (the primary Windows
workflow) runs on a spuriously stiff model — deflections under-predicted
~35–45%, stress field correspondingly wrong, while the UI displays the
"C3D10 quadratic accuracy" badge. This silently defeats the core value
proposition of the tool.

Why CI never caught it: the workflow never installs TetGen/Gmsh, so no test
exercises the real meshing binaries (see P5).

Recommended fix (in order of robustness):
1. **Runtime derivation** — after parsing the first element of every `.ele`
   file, geometrically match each midside node to its corner pair (≤ 20 lines,
   micro­seconds) and build the permutation for *that* binary. Immune to
   TetGen version differences (the Windows `tetgen1.5.1-beta1` build may
   order differently than Linux 1.5.0).
2. At minimum, correct the constant to `[0,1,2,3,6,7,9,5,8,4]` and gate STL
   `-o2` behind a startup self-check (mesh a unit box, run the cantilever
   ratio, disable C3D10 if outside 0.85–1.15).

`scripts/verify_tetgen_c3d10.mjs` (added alongside this report) automates the
derivation + cantilever check against whatever `tetgen` binary is on PATH.

### F2 — Error-estimate vertex mapping is O(V × nodes × elements): 98.6% of analysis wall time · **HIGH / compute**

The 5,440-element demo analysis takes **6 m 35 s**; the FEM itself takes ~5 s.
V8 CPU profile of the full run (420 s sampled):

| Phase | Time | Share |
|---|---|---|
| `runAnalysis` self — line `vertexErrorEstimate[v] = nearestElementError(...)` loop | 253.5 s | 60.3% |
| `nearestElementError` frame | 161.0 s | 38.3% |
| `solvePCG` (498 iters, IC(0)) | 3.9 s | 0.9% |
| assembly, SPR, everything else | < 2 s | 0.5% |

Root cause (`analysis.ts:2179-2255`): for each surface vertex, for each node
in nearby grid cells, it scans **all elements** (`for e = 0..elementCount`)
to discover which elements contain that node — ~10⁸–10⁹ inner iterations plus
a fresh `Set` per vertex. Every other mapping loop in the file correctly uses
the spatial grid and runs in milliseconds.

Fix: build a node→elements adjacency list once — O(elementCount × npe), ~1 ms —
then per vertex, look up only the elements adjacent to nearby nodes.
Expected result: **~6.5 min → ~6 s (≈ 65×)** for this mesh; the gap grows
with mesh size (it's the reason "fine C3D10 meshes need 600 s").

Follow-on cleanups once fixed:
- Commit 5645f82 raised client/server/worker timeouts 120 s → 600 s to
  accommodate this; they can come back down (treating the symptom).
- The overlay phase estimates in `client/index.html` (~line 4946) assume
  ~10 s totals and are wildly off for current C3D10 runs.

### F3 — STL bolt constraint clamps a full-height XY annulus · **MEDIUM / correctness**

`analysis.ts:1688-1696` selects constrained nodes by 2-D radial distance only
(`0.9r < √((x−hx)²+(y−hy)²) < 1.15r`) with **no bound along the hole axis** —
for the demo bracket this constrained **2,741 of 9,602 nodes (28.5%)** for a
single Ø5 mm bolt. Any node anywhere in the part whose XY projection lands in
the ring is rigidly fixed: over-constraint that stiffens the model and
inflates bolt-area load capacity. It also can't handle holes whose axis isn't
Z. Note the codebase already contains a correct implementation —
`findHoleWallNodes()` (line 1475) bounds both the axial extent (±2.5r) and
radial tolerance — but the STL constraint path doesn't use it. Unify on the
3-D cylinder test (and if the top/bottom "washer annulus" clamping is
intentional, make it explicit and bounded to washer OD).

### F4 — `/api/analyse` has no request validation · **MEDIUM / robustness**

A malformed body (e.g. `forces: [{fx,fy,fz}]` instead of
`{magnitude,direction,position}`) crashes mid-pipeline with
`TypeError: undefined is not iterable` → opaque 500 after meshing has already
run. Reproduced live. Validate shape up front (a ~40-line hand-rolled checker
is enough — no dependency needed) and return 400 with the offending field
path. Same for `/api/upload` (bounds/holes consistency) and calibration POSTs.

### F5 — Missing-binary error blames the geometry · **LOW / UX**

With no `tetgen` on PATH, each analysis logs four "failed with -pq1.4a10Q,
trying fallback..." attempts and then reports *"The STL may have
self-intersections or non-manifold edges"* — the user is told their file is
broken when the mesher simply isn't installed. The startup probe already knows
the binary is missing; thread that state through (`ENOENT` → "TetGen not
found — install it, see startup instructions") and skip the 3 pointless
retries.

### F6 — Documentation / branding drift · **LOW**

- README: "STL locked to C3D4" (false — `-o2` is the default), test counts
  stale (§1.1), TetGen listed as Windows-only install requirement while
  `apt/brew` paths exist in the startup hints.
- CLAUDE.md documents `design-research.yml` and `nightly-design-loop.yml`
  workflows that do not exist in `.github/workflows/` (only `test.yml`).
- Brand split: UI/report/server banner say STORMFEA in some places,
  "StressForm" in others (`/api/report` title, server startup banner,
  `~/.stressform_*` files, `STRESSFORM_CLIENT_DIR` env var). Pick one
  user-facing name; keep on-disk names for backward compat if needed.

### F7 — "Works offline" claim vs CDN dependencies · **MEDIUM / product**

`client/index.html` loads Three.js from jsdelivr (line 7) and three font
families from Google Fonts (line 172-173). At a venue with no internet the 3-D
viewer — the heart of the app — will not initialize, despite README's
"No internet connection needed after install" and the PDF exporter having been
purpose-built to avoid network. Vendor `three.min.js` (~600 kB) and the three
WOFF2 families into `client/vendor/` and reference them relatively; total
repo cost ≈ 1 MB.

---

## 3. What's in good shape (keep as-is)

- **Solver core**: textbook-clean PCG with IC(0)+Jacobi fallback, zero
  per-iteration allocation, geometric residual checkpoints, wall-clock
  deadline. Assembly/CSR invariants asserted. 82-test validation suite with
  real analytic benchmarks (patch test, Euler-Bernoulli, isotropic-limit Hill)
  is far above hobby-project standard.
- **Honest degradation**: box-mesh fallback voids the safety factor and says
  why, rather than serving a plausible-looking wrong number.
- **Failure-mode breadth** with per-mode confidence labels, uncertainty bands
  (conservative/optimistic SF), isotropic-comparison explainer.
- **Error UX** in the client: friendly message + specific fix + collapsible
  technical detail (though see stale tab names, U2).
- **Design system** (DESIGN.md) is specific and mostly enforced; the
  landing/instrument-panel aesthetic is coherent.

---

## 4. Compute & Processing Proposals

**P1. Node→element adjacency for error mapping** (fixes F2). One adjacency
array built at mesh load; reuse it for SPR patches too (`stress.ts` builds
its own patch lists — unify). *Effort: small. Payoff: ~65× end-to-end.*

**P2. Replace COO-object parallel assembly with transferable buffers.**
`assembly.ts` workers return `{row,col,val}` JS objects (≈ 4.9 M objects for
this mesh), which are structured-cloned, flattened, sorted with a comparator,
then binary-searched into CSR. Have each worker fill a `Float64Array` keyed by
a precomputed per-chunk CSR slot list (or return `[rows,cols,vals]` typed
triple + transferables), then merge by simple addition. Also: spawn the worker
pool **once at server start**, not per analysis — current per-call spawn +
3-minute worker timeout is why small meshes sometimes assemble slower in
parallel than serially. *Effort: medium.*

**P3. Reuse K for buckling.** The C3D4 buckling path calls `assembleK` a
second time for the same mesh/material (analysis.ts:1919). `runLinearStaticWithK`
already exists for exactly this reuse — use it (penalty BCs are applied to the
same pattern; keep a pristine copy of `data` if needed). *Effort: small.*

**P4. Real progress + cancellation over SSE.** `/api/analyse` is a single
blocking POST for up to 600 s; the overlay fakes progress on a timer, and a
closed browser tab does not stop the solve — the server burns the full CPU
time for a result nobody will read. Emit `text/event-stream` phase events
(mesh → constraints → assembly → CG iteration/residual → recovery → mapping)
from the phases that already log to console, and wire `req.on('close')` to an
`AbortSignal` checked between phases (CG already supports iteration-boundary
aborts naturally). The client's residual-checkpoint sparkline can then be
live. *Effort: medium. UX payoff: large.*

**P5. Make CI exercise the real meshers.** `apt-get install -y tetgen gmsh` in
`test.yml` (Ubuntu runner, ~10 s), then:
- run `scripts/verify_tetgen_c3d10.mjs` (added with this report) — would have
  caught F1;
- one STL upload→analyse integration test and one STEP→Gmsh test with known
  hole radius (the Ø5 plate reproduces in ~2 s with `gmsh -0` + a .geo file);
- optionally a wall-time regression gate (e.g. demo analysis < 60 s) to catch
  future F2-class regressions.

**P6. Trim the JSON/base64 payload round-trip.** Every analyse POST re-uploads
the full geometry as base64 inside JSON (+33% size, double parse) and the
response returns ~10 parallel base64 fields. Options: keep upload geometry
server-side under a session token (upload already parses it), and/or return
one binary `application/octet-stream` frame with an offsets header. Matters at
the 50 MB upload limit. *Effort: medium, low risk.*

**P7. Atomic writes for user data files.** Calibration, validation and session
stores write with `fs.writeFileSync` directly over the target
(`index.ts:390-392`); a crash mid-write corrupts the team's calibration
history. Write to `path + ".tmp"` then `fs.renameSync`. *Effort: trivial.*

---

## 5. Backend / API Proposals

**B1. Split `server/index.ts` (1,421 lines).** Routes for calibration,
validation, session, Onshape, demo, and reporting can each be an
`express.Router` module; the ~350-line inline methodology HTML belongs in a
template file. Pure mechanical refactor, no behavior change.

**B2. Uniform error envelope + input validation** (F4): `{error, field?,
hint?}` and a tiny `expect(body, spec)` helper used by every POST route.

**B3. Serialize concurrent analyses.** Two simultaneous `/api/analyse` calls
currently interleave two CPU-bound solves on the main thread + two worker
pools. A single-slot queue with a 409/`Retry-After` (or queued SSE state via
P4) matches the single-user reality and prevents timeout cascades.

**B4. Version the API surface minimally.** `/api/health` already returns
`version` — have the client check it on boot and surface "server is v43,
UI expects v44 — restart via start.bat" instead of odd undefined-field
failures after partial upgrades.

**B5. `/api/upload` STEP hole `centre` is hardcoded `z=2.0`**
(`index.ts:116`) — compute from wall-node axial mean like the Onshape import
path does (`index.ts:1329-1336`); wrong centre skews the F3 constraint search
and edge-distance failure checks for STEP parts thicker than 4 mm.

---

## 6. Frontend / UI-UX Proposals

**U1. Wire the dead landing cards.** "RESUME SESSION" and "PAST EXPORTS" are
disabled with `TODO: wire once session persistence layer exists`
(index.html:618-637) — but the persistence layer *does* exist and works
(`/api/session` round-trip verified; IndexedDB geometry cache; 5 s autosave).
Resume = load session + IDB blob and jump to the right tab; this is the
single highest-leverage UX win for the competition-day "laptop died" case.

**U2. Fix stale guidance text.** Error-recovery copy references tabs that no
longer exist: "Switch to the Constraints tab, enter Bolt mode (B)…",
"Settings → Print Settings" (actual tabs: SETUP/ORIENT/LOADS/MATERIAL/
RESULTS). Same for the comment-level "SIMULATION" references. Audit all
user-visible strings for tab names after the nav redesign.

**U3. Honor the offline promise** (F7): vendor Three.js + fonts.

**U4. Real progress, live residual, cancel button** — client half of P4. Show
mesh size (nodes/elements/DOF) as soon as meshing completes, then CG
iteration + residual live; add "Cancel" that aborts the fetch *and* the
server solve. The existing worker (`solver.worker.js`) already has
`AbortController` plumbing to build on.

**U5. Consolidate dialogs.** 13 native `alert()/confirm()` calls remain
alongside the styled toast system (`showErrorToast`) — jarring against the
instrument-panel aesthetic; replace with the toast/modal components.

**U6. Accessibility pass.** 27 `aria-*` attributes across an 11,044-line UI;
2 keyboard listeners; heavy state changes (tab switches, results arrival) are
mostly unannounced (results container does have `aria-live` — good). Minimum
viable: focus outlines on cards/tabs, `aria-pressed` on toolbar toggles,
Escape-to-close on popups, `prefers-reduced-motion` for the landing rain
canvas and pulse animations, and a contrast check on `--text-lo` over
`--bg-base`.

**U7. Modularize `client/index.html`** (11 k lines, 409 functions, 967 inline
styles). The regex-extraction test harness (`test_client_logic.mjs`) is
already straining — it breaks if a function gains a comment between it and its
neighbor. Move JS to ES modules served statically (no bundler needed for a
local tool) and import real functions in tests; graduate repeated inline
styles to classes per DESIGN.md. Incremental, file-at-a-time migration works.

**U8. Results hierarchy niceties** (small, cumulative): sticky verdict bar
already exists — add units toggle (N↔lbf, MPa↔psi for US teams), copy-report-
row on click, and a "what changed vs baseline" chip on re-run (A/B data is
already captured and locked).

---

## 7. Suggested Priority Order

| # | Item | Type | Effort | Impact |
|---|---|---|---|---|
| 1 | F1 fix + runtime ordering check | correctness | S | Restores C3D10 validity for STL |
| 2 | F2 adjacency map | compute | S | ~65× analysis speed |
| 3 | P5 CI with real meshers + ordering gate | process | S | Prevents F1/F2 recurrence |
| 4 | F3 3-D cylinder bolt search (reuse `findHoleWallNodes`) | correctness | S | Constraint fidelity |
| 5 | U1 resume session + U3 vendor deps | UX | S–M | Competition-day reliability |
| 6 | P4/U4 SSE progress + cancel | UX+compute | M | Kills fake progress + wasted CPU |
| 7 | F4/B2 validation, F5 error text, U2 stale copy | robustness | S | Trust in errors |
| 8 | P2 assembly overhaul, P6 payload, B1 route split, U7 modularize | arch | M–L | Long-term velocity |

---

*Method notes: all timings on this container (Node 22.22, Linux, tetgen 1.5.0,
gmsh 4.12.1). CPU profile via `node --cpu-prof` on a direct `runAnalysis()`
call with the demo bracket (Ø5 bolted hole, 200 N face load, C3D10, 9,602
nodes / 5,440 elements). Cantilever verification: 40×4×2 mm beam, E=3.5 GPa,
ν=0.36, 10 N tip load, δ_EB = FL³/3EI.*
