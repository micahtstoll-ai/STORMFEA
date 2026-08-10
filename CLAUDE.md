# STORMFEA Project Guidelines for Claude AI

## Project Overview
STORMFEA is an FDM-aware finite element analysis tool built with TypeScript/Node.js (server) and a single-file vanilla-JS client. The project uses npm for dependency management and runs automated tests via GitHub Actions.

## Keeping This File Accurate
This file is instructions an agent acts on, not a description to skim past — a
wrong claim here (a stale line number, a guessed commit hash, a "this always
happens" that doesn't) actively misleads instead of merely failing to help.
Before writing a fact into this file:
- Verify it against source (read/grep the actual code) — don't extrapolate
  from memory of an earlier version of the file or the code.
- Cite symbols, not line numbers. Line numbers drift with every unrelated
  edit; symbol names are the stable handle (`docs/INVARIANTS.md` states this
  same rule for its own rows — it applies here too).
- If a claim can't be verified, say so or leave it out — don't round several
  plausible answers up to one confident-sounding one.
- When a change to this repo touches an invariant, constant, or behavior
  described here, update this file in the same PR. A stale CLAUDE.md is a bug
  in the same sense a stale test is.

## Table of Contents
1. [Project Structure](#project-structure)
2. [Repo Hygiene & Git Safety](#repo-hygiene--git-safety)
3. [Related Documentation](#related-documentation)
4. [Common Tasks](#common-tasks)
5. [GitHub Actions Workflows](#github-actions-workflows)
6. [GitHub Issue Workflow](#github-issue-workflow)
7. [Physics-First: Citations & Confidence](#physics-first-citations--confidence)
8. [Frontend Design System](#frontend-design-system)
9. [Heatmap Rendering — Common Pitfalls & Lessons Learned](#heatmap-rendering--common-pitfalls--lessons-learned)
10. [Two-Region Material Model — Invariants](#two-region-material-model--invariants)
11. [Interlayer Failure & Bond Model — Invariants](#interlayer-failure--bond-model--invariants)

## Project Structure
- `server/` - Node.js backend (TypeScript)
- `server/solver/` - FE assembly, recovery, and the two-region/bond material models
- `server/tests/` - Test files (`server/tests/unit/` for vitest; `solver_validation.ts` and `test-parallel-assembly.ts` for the solver shard)
- `client/` - Single-file frontend (vanilla JS + Three.js)
- `docs/` - `INVARIANTS.md` (normative-invariant traceability index), `layer-model-audit.md` (A1–A7 defect history), `spr-gauss-point-handoff.md`, and other design/methodology notes
- `.github/workflows/` - CI/CD pipeline definitions
- `.github/actions/setup/` - shared CI setup (Node, `npm ci`, TetGen/Gmsh)
- `scripts/` - build and CI-support scripts, including `heavy-tests.json` (the CI heavy-shard file list) and the doc/API/invariant drift guards
- `package.json` - Project dependencies
- `package-lock.json` - Locked dependency versions (DO NOT DELETE)
- `tsconfig.json` - TypeScript configuration

## Repo Hygiene & Git Safety

### Package Lock File (package-lock.json)
**CRITICAL**: This file MUST remain in the repository and be included in every commit.

**Rules:**
- DO: Include `package-lock.json` in all commits
- DO: Verify the lock file exists before creating PRs
- DO: Run `npm install` or `npm ci` if updating dependencies
- DON'T: Exclude or ignore `package-lock.json`
- DON'T: Delete `package-lock.json` during refactoring
- DON'T: Create commits that remove this file
- DON'T: Use emojis anywhere

**Why:** The lock file ensures all CI environments use identical dependency versions. Without it:
1. GitHub Actions workflows fail (`npm ci` requires the lock file)
2. Builds become non-reproducible
3. Different developers get different packages installed
4. Pull request CI fails, blocking merges

### Before every commit or PR
- [ ] `package-lock.json` is present: `ls -la package-lock.json`
- [ ] Lock file changes are intentional: `git diff package-lock.json`
- [ ] No critical build files were accidentally removed (`dist/`, lock files, config files)
- [ ] Stage files explicitly — never `git add -A` or `git add .`
- [ ] `npm ci && npm run test` passes locally

### Workflow Files (.github/workflows/)
These files define CI/CD behavior. Before modifying:
- Test changes locally first
- Ensure `npm ci` and `npm run test` pass locally
- Document any new environment variables needed

## Related Documentation
CLAUDE.md is operational guidance for working in this repo, not a full
description of it — check these before assuming a gap or a bug:
- `docs/ARCHITECTURE.md` — the request lifecycle (upload → mesh → assemble →
  solve → recover → report), a module-by-module map of `server/` and
  `server/solver/`, and build/run/test commands.
- `docs/API.md` — the HTTP route surface (drift-guarded in CI — see
  [GitHub Actions Workflows](#github-actions-workflows)).
- `docs/METHODOLOGY.md` — the physics and math behind the solver.
- `docs/layer-model-audit.md`, `docs/bc-singularity-exclusion.md`,
  `docs/load-distribution-default.md`, `docs/mesh-sizing.md` — "landed
  decision" writeups: deliberate, non-obvious behavior changes with the
  measurements that justified them (e.g. the default load distribution is
  `contact_patch`, not `uniform`; a mesh tier promises an element count AND a
  floor of 4 elements across the thinnest section, on both mesher paths). If
  something looks wrong, check whether one of these already explains it
  before treating it as a bug.
- `DESIGN.md` — the frontend design system in full (see
  [Frontend Design System](#frontend-design-system) below for the summary).
- `CONTRIBUTING.md` — contributor norms, including the physics-citation
  requirement (see [Physics-First](#physics-first-citations--confidence)
  below).
- `ROADMAP.md` — planned work and priorities.

## Common Tasks

### Adding Dependencies
```bash
npm install <package-name>
# This automatically updates package-lock.json
# Commit both package.json and package-lock.json
```

### Creating a PR
```bash
git add package.json package-lock.json [other-files]
git commit -m "feat: description of changes"
git push origin your-branch
```

### Debugging CI Failures
1. Check the GitHub Actions logs first — identify which of the five shard jobs (below) went red; that tells you what kind of failure it is before you read a single line of log.
2. Run `npm ci` locally to reproduce dependency issues.
3. Run `npm run test` to reproduce test failures — it runs the full suite serially in one process, the same tests CI splits across shards.
4. Look for errors in TypeScript compilation or test execution.

## GitHub Actions Workflows
1. **test.yml** - Runs on every push/PR to main (the only workflow). The same
   tests `npm run test` runs locally, but split across five concurrent jobs
   sized to their measured cost, because the suite is CPU-bound on real FE
   solves and running it as one `&&` chain made the wall time their SUM:
   - `unit-light` - every vitest file except the heavy ones (92 of 96 as of
     2026-08-10), ~2 min. The fast "is this obviously broken" signal; look
     here first when CI goes red. `vitest-shard.mjs` derives this shard as the
     exact COMPLEMENT of `heavy-tests.json`, so the count moves with every
     added test file and nothing in CI checks it — treat the figure here as a
     dated snapshot, not a number to trust.
   - `unit-heavy` - the 4 files in `scripts/heavy-tests.json`, ~10.5 min. The
     critical path. These are acceptance gates (#149, #261, #160) doing real
     30k-75k element solves.
   - `solver` - `tsc` + `solver_validation.js` + parallel-assembly
     equivalence + the #66 TetGen midnode gate, ~5 min.
   - `client` - client logic + `docs/INVARIANTS.md` and API-route drift
     guards, ~1 min.
   - `doc-counts` - needs all four; merges the two vitest shard summaries and
     enforces the #198 README/methodology count guard.
   - Shared setup (Node, `npm ci`, TetGen/Gmsh) lives in
     `.github/actions/setup`.

   When adding a test file, put it in the light shard unless it costs more
   than ~30 s, and keep `scripts/heavy-tests.json` honest — the shards must
   PARTITION the suite or `check-doc-test-counts.mjs` fails the build.

## GitHub Issue Workflow
Track real work in GitHub issues, not just in conversation or code comments —
this repo already does this (see `docs/INVARIANTS.md`'s "Gaps found" notes,
several of which were filed as their own issues, and the commit/issue numbers
cited throughout the invariant sections below).
- **Open an issue** for anything that needs doing but isn't part of the
  current change: a follow-up, a known limitation, a documentation gap, a
  test-coverage hole. Use the **Bug Report** template for defects
  (`CONTRIBUTING.md`). Don't let a code TODO or a chat message be the only
  record of it.
- **Link issues to the PR that fixes them** with a `Fixes #N` / `Closes #N`
  keyword (see the "Linked Issue" field in
  `.github/pull_request_template.md`) so merging closes the issue
  automatically — that's the default path, not a manual close-it-yourself
  step.
- **Close an issue directly**, with a short comment on what changed and
  where, when it's resolved some other way — already fixed, superseded by
  another change, or landed without a `Fixes #` keyword in the commit.
- **Don't close speculatively.** An issue closes when the fix has actually
  landed (merged, or in an active session, pushed and verified) — not when
  you expect it will.

## Physics-First: Citations & Confidence
Any change touching the solver, material model, or failure-mode logic needs a
physical justification, not just a passing test suite. From `CONTRIBUTING.md`,
enforced throughout the invariant sections below:
- **Cite a source.** The 65% stiffness ratio (E_z) and 58% yield ratio
  (σ_yield,Z) anchors are not arbitrary — they come from peer-reviewed
  literature. If you have better data, bring the paper; don't nudge a
  constant because a result "looks more reasonable."
- **Tag confidence explicitly.** New failure modes and calibration constants
  get a HIGH / MEDIUM / LOW confidence label based on how much FDM-specific
  data backs them — see e.g. "Exponents are LOW confidence, locked by
  `core-lattice.test.ts`" in the Two-Region invariants below.
- **A LOW-confidence constant is a documented gap, not a bug.** Don't "fix"
  it by guessing a better number; either bring calibration data that
  justifies a change, or leave the tag alone.
- **Every new failure mode needs a unit test asserting the correct SF at a
  known load** — not just that the code runs without throwing.

## Frontend Design System
`client/index.html` is a single ~14,800-line file with no CSS framework
enforcing consistency — it relies on people (and agents) following
`DESIGN.md` by hand. Before any visual change:
- **Three fonts, fixed roles** — Rajdhani (headings), Outfit (UI copy), DM
  Mono (data/numbers/code). Never mix roles; never introduce a fourth font.
- **Four type sizes only** — 9 / 11 / 13 / 16px. No 10, 12, or 14px.
- **Three colors, two dimensions** — the gold accent, the four-step
  base/text scales, and three semantic colors (`--warn` amber, `--danger`
  rust red, `--success` = gold, never green). Never purple, cyan, blue,
  green, or a gradient.
- **Four spacing values** — 6 / 12 / 20 / 32px, used consistently.
- This is a summary; read `DESIGN.md` in full before a UI-touching PR.

## Heatmap Rendering — Common Pitfalls & Lessons Learned

### Known Issue: Vertex Welding Algorithm (FIXED)
**Problem:** Visible line artifacts in heatmap coloring, appearing as straight lines across the 3D visualization. These were caused by vertices at mesh seams not being properly grouped for stress smoothing.

**Root Cause:** The spatial hash grid for vertex welding used `Math.round()` for grid cell indexing, which caused edge cases with negative coordinates:
- `Math.round(-0.25) = 0` but `Math.round(-0.75) = -1`
- Vertices within 0.01mm (WELD_EPS) could hash to non-adjacent cells
- The 27-cell neighborhood search would eventually find connections, but only after multiple passes
- Under certain mesh geometries, this led to vertices that should be welded together remaining separate

**Solution Applied (commit: 49bc5d6):**
- Switched from `Math.round()` to `Math.floor()` with bounding-box normalization (consistent with server-side spatial indexing in `nearestNodeStress`, `server/analysis.ts`)
- This ensures all vertices are consistently hashed within a normalized [0, extent) range
- Added diagnostic debug modes (`?debugWeld=true`) for future troubleshooting

**Key Insight:** The server's spatial grid (`nearestNodeStress` in `analysis.ts`) uses `Math.floor((x - xMin) / cellSize)`, so the client's vertex welding should match this approach for consistency and to avoid edge-case artifacts.

### Vertex Welding Requirements (Invariants)
When modifying heatmap or mesh coloring code:
1. **Every vertex in display mesh MUST receive a stress value** — verify `vertexStress.length === triangleCount * 3`
2. **Vertices at same location (distance < 1 micron) MUST get identical stress** — weld before color assignment
3. **Use consistent grid-cell indexing** — match server's `floor((x - min) / cell)` approach, never `round(x / cell)`
4. **Test on edge cases:** negative coordinates, mesh boundaries, seams between large and small triangles

### Display Color Space (Invariants)
The model's colors ARE the reading, so the pixel the GPU emits must equal the
color the legend shows for that same stress. Three things enforce that, and all
three are locked by test group [T] in `scripts/test_client_logic.mjs`:

1. **sRGB for the browser, LINEAR for the GPU.** The `COLORMAPS` /
   `DIVERGING_BWR` tables are sRGB — that is the space viridis and plasma are
   defined in, and what CSS `rgb()` and canvas `fillStyle` expect. Three r152
   (`client/vendor/three.min.js`) defaults `outputColorSpace = 'srgb'` with
   ColorManagement on, so the shader's working space is linear-sRGB, and per
   Three's contract a vertex-color `BufferAttribute` is assumed to ALREADY be
   linear — it is never converted for you. Use `stressColor` /`divergingColor`
   for anything the BROWSER paints and `stressColorLinear` /
   `divergingColorLinear` (and `FILTER_GREY_LINEAR`, `DEFAULT_MESH_LINEAR`) for
   every geometry `color` attribute. Writing sRGB values straight into the
   attribute applies a spurious ~1/2.2 brightening to the model while the
   legend stays correct, and no amount of gamma alignment can reconcile them.
2. **The light rig sums to exactly 1.0 and is untinted white.** r152 defaults
   `useLegacyLights = true`, so intensity is a raw multiplier with no 1/PI
   falloff. Over-unity lighting clips channels INDEPENDENTLY, which rotates hue
   rather than merely brightening — the same stress then reads as a different
   color depending on which way a facet points, destroying the point of a
   perceptually-uniform colormap. A tinted light does the same thing more
   quietly. Retune the balance between the three lights if you like; keep the
   sum at 1.0.
3. **Data-carrying meshes are matte.** Build them with `makeStressMaterial()`
   (specular `0x000000`, shininess 0, `flatShading: false`). Phong's specular
   term is ADDITIVE: a highlight lays a white sheen over the reading and can
   push a unit-scale color past 1.0, reintroducing the clipping (2) exists to
   prevent.

Together these bound output at the colormap color itself: a fully-lit facet
renders it exactly, every other facet renders a darkened version of the right
hue. Shading reads the part's form; it cannot misreport a number.

### Material & Shading Essentials
- **Always use Gouraud shading** (vertex-interpolated) for stress heatmaps: `flatShading: false` in MeshPhongMaterial
- **Never use flat-shading** on ColorAttribute geometries — creates hard edges at triangle boundaries that appear as artifacts
- **Color clamping:** Use per-vertex colors, not per-triangle; gamma curve (`GAMMA = 0.55`) expands low-stress regions
- **`currentGamma()` is the single source of truth** for that curve — every
  paint path reads it (issue #142), including the section cut-face
  (`_colorInteriorValues`). Never keep a second copy of the `disableGamma`
  flag: the copy drifts the moment the in-app LINEAR/γ toggle is used.
- **The sequential scale clips to p02..p98** so one singular vertex can't wash
  out the map. That clip is REPORTED, not silent — the legend's end labels get
  a `≥` / `≤` marker (`S._legendClip`, re-applied by `refreshUnitsDisplay` so a
  unit toggle can't drop it). Without it the legend overstates its own coverage
  and disagrees with the MAX STRESS card.

### Debug Tools Available
- `?debugWeld=true` — Logs vertex grouping statistics, discontinuity detection, potential welding issues
- `?disableGamma=true` — Sets the INITIAL gamma state (the in-app LINEAR/γ button in the legend then owns it, persisted in `localStorage` as `sf-gamma-disabled`)
- Console output includes group size distribution and high-discontinuity triangles

### Code Review Checklist (Stress Rendering Changes)
Before submitting a PR that modifies mesh visualization or stress heatmap:
- [ ] Are coincident vertices being welded BEFORE color assignment? (weld tolerance: 0.01mm)
- [ ] Is shading mode explicitly set to Gouraud (`flatShading: false`)? 
- [ ] Does every write to a geometry `color` attribute use a `*Linear` color helper, and every browser-painted swatch the sRGB one?
- [ ] Do the light intensities still sum to 1.0, with no tinted lights?
- [ ] Is the mesh built via `makeStressMaterial()` rather than a hand-rolled MeshPhongMaterial?
- [ ] Does every display vertex receive a stress value (no NaN, no Infinity)?
- [ ] Stress array length validated: `vertexStress.length === triangleCount * 3`?
- [ ] Spatial grid indexing is consistent: floor-based with bounding-box normalization?
- [ ] Tested on mesh with negative coordinates (e.g., model centered at origin vs at positive quadrant)?
- [ ] Visual regression test added or updated for new coloring logic?
- [ ] Known limitation documented (if any) in user-facing messages?

### References
Search by symbol, not line number — these move:
- Vertex Welding: `client/index.html`, function `computeSmoothedStressColors`
- Color space: `client/index.html`, `srgbToLinear` / `stressColorLinear` /
  `divergingColorLinear` / `makeStressMaterial`; light rig in `initThree`
- Server Spatial Grid: `server/analysis.ts`, function `nearestNodeStress`
- Stress Recovery: `server/solver/stress.ts` — `sprSmoothedStress6` (tensor) is
  the ONE recovered nodal field: it feeds the ZZ estimator, and on C3D10 the
  displayed heatmap and the per-node utilization field are projections of it via
  `vonMisesFromTensor6` (issue #258) — on C3D4 as well as C3D10, so
  `sprSmoothedStress` (scalar) is no longer reached on any path the pipeline
  produces; its one remaining call site is a fallback for a result carrying
  neither a nodal nor an element tensor. Do not reintroduce an independent
  scalar recovery: von Mises is convex, so recovering it directly sits at or
  ABOVE the von Mises of the recovered tensor (Jensen) and biases the displayed
  peak upward.
  Both are built on the shared patch helpers `buildSprPatchFit`,
  `solveSprValueAtNode` and `interpolateMidsideFromCorners`, and both fit an
  `SprSamples` point cloud: `buildCentroidSamples` (one sample per element —
  C3D4, and the legacy shape) or `buildGaussSamples` (four C3D10 Gauss points per
  element, quadratic recovery basis — see `docs/spr-gauss-point-handoff.md`).

## Two-Region Material Model — Invariants

> This is the normative list. `docs/INVARIANTS.md` is the resolved,
> navigable index mapping each numbered invariant below to its current
> implementing symbol and locking test — check there first when a change
> might touch one of these.

The two-region model (`analysis.twoRegion`, DEFAULT TRUE since issue #297 —
pass `false` for the legacy single-material path) classifies elements into dense
perimeter walls vs homogenized infill core (`server/twoRegion.ts`,
`server/solver/distance.ts`, `server/solver/wallfrac.ts`, consumed via
`ElementMaterialField` in `server/solver/types.ts`). When modifying it:

1. **Flag off must stay bit-identical** — with no field, assembly/recovery/mass
   must reproduce the legacy single-material path exactly (tested to 1e-12 on
   full solves in `solver_validation.ts` group 25). Since #297 the flag DEFAULTS
   ON, so "off" means an explicit `twoRegion: false` rather than an absent flag;
   the bit-identity requirement is unchanged and is what makes that explicit
   opt-out meaningful.
   The model also self-degrades to the uniform path (reporting
   `materialModel.degraded`) when the emitted mesh resolves fewer than
   `MIN_ELEMENTS_THROUGH_THICKNESS` elements across the thinnest section: below
   that it recovers almost none of the sandwich stiffening it exists to capture
   while reporting itself active. The gate reads `meshResolution`, i.e. the mesh
   that came back, and an explicit opt-in does NOT override it.
2. **No NaN by construction** — the level-set volume fraction
   (`tetFractionBelowIso`) is written per sign-case so every denominator is a
   strictly-negative-minus-non-negative difference; keep it that way.
3. **Per-bin C is a true Voigt matrix blend** — `C_b = f·C_shell + (1−f)·C_core`
   of the two ROTATED endpoint matrices (`twoRegion.ts` bin loop). Blending
   after the weakAxis (Bond) rotation is exact because the rotation is linear
   in C's entries — valid ONLY while shell and core share the same `weakAxis`.
   Never blend materials with different weak axes, and never revert to
   blending engineering constants: that only equals the matrix blend when
   shell and core share every modulus ratio, which the anisotropic core laws
   deliberately break.
4. **Distance field must be point-to-triangle** — nearest-NODE distance aliases
   (3–6 mm boundary triangles vs ~1.35 mm wall band). Boundary nodes seed at
   exactly 0.
5. **Anchor endpoints, report divergence, never renormalize** — 100% infill and
   all-shell parts must collapse to the uniform path; interior divergence from
   `effectiveStrengthMultiplier` is surfaced in `summary.materialModel`, not
   hidden.
6. **The average material carries the scalars** — `SolverInput.material` is the
   volume-weighted blend when the field is active; whole-part consumers (ZZ
   error estimate, analytic hole checks) read it, per-element consumers read
   the field. Don't mix the two up. Note it blends ENGINEERING CONSTANTS — a
   first-order approximation of the Voigt C average once the core's ratios
   diverge from the shell's — acceptable because its consumers are scalar and
   every degenerate path returns an exact endpoint material.
7. **Worker boundary** — `binOfElement` + multi-bin `C` cross the
   `assembly-worker.ts` postMessage payload; any field shape change must update
   `WorkerInput` and the mixed-bin case in `test-parallel-assembly.ts`.
8. **Core homogenization anchors** — the core is the SOLID material times
   Gibson-Ashby scale factors (`server/solver/lattice.ts`); at ρ=1 those
   factors are exactly 1.0 so the core reproduces the solid bit-for-bit
   (the `materialsEqual` collapse depends on it — never re-derive the ρ=1
   material through a parallel formula chain). Scales are floored at
   1e-3×solid (0% infill must build a positive-definite C, not crash), and
   orientation must never enter core STIFFNESS — only the weakAxis
   rotation/scalar-swap and the strength multiplier do. Exponents are LOW
   confidence, locked by `server/tests/unit/core-lattice.test.ts`.
9. **The split is only visible on a SECTION CUT** (issue #297) — a part's
   boundary is wall by construction (every boundary node sits at distance 0
   from the surface, inside the wall band), so the classification on the
   DISPLAY mesh is identically 1.0 on every part and carries no information.
   Measured, not argued: min 1.0 / max 1.0 on the 24x12x6 fixture against a
   50.6% shell volume fraction. It is published on `volumeField`
   (`nodeShellFractionB64`) and painted on the cut face. Do not re-add it as a
   display-mesh vertex field — that revision existed and was caught only by a
   test asserting the picture was not constant. Locked by
   `server/tests/unit/two-region-default.test.ts`.

   (New invariants are APPENDED, never inserted: `docs/INVARIANTS.md` and
   comments throughout `server/` reference these by number.)

## Interlayer Failure & Bond Model — Invariants

> This is the normative list. `docs/INVARIANTS.md` is the resolved,
> navigable index mapping each numbered invariant below to its current
> implementing symbol and locking test — check there first when a change
> might touch one of these. See also `docs/layer-model-audit.md` for the
> historical defects (A1–A7, all resolved) these invariants prevent from
> regressing.

The FDM dual criterion (`fdmDualCriterionSF`, `server/solver/stress.ts`) and
the bead-penetration bond model (`server/solver/bond.ts`) replaced the Hill
(1948) criterion and extended the process model after the layer-model audit
(`docs/layer-model-audit.md`). When modifying them:

1. **Azimuth invariance is the point** — the criterion must be exactly
   invariant under rotation about the weak axis (locked by
   `fdm-criterion.test.ts` and solver_validation [7f]). Never reintroduce an
   independent in-plane shear coefficient into a quadratic form (that was the
   A1 defect: a quadratic Hill form cannot satisfy in-plane isotropy +
   uniaxial yield Y + in-plane shear Y/√3 + through-thickness Z ≠ Y at once).
2. **Anchors are preserved, not re-derived** — in-plane uniaxial yields at Y,
   through-layer uniaxial at Z, interlayer shear at S_zs, and the flat-print
   false-safety SF = Z/Y ≈ 0.58 (the tool's core claim). Default
   S_zs = yieldZ/√3 is EXACTLY Hill's L = M = 3/(2Z²) transverse shear, so
   uncalibrated through-layer results match the legacy criterion.
3. **Tension-only interface** — ⟨σzz⟩₊ Macaulay bracket; compression routes
   to bulk von Mises and credits interlayer shear via Mohr–Coulomb (μ = 0.3,
   LOW confidence). Do not re-symmetrize.
4. **hill-legacy stays callable** — `AnalysisSettings.criterion` and the
   upright-no-bed scalar-swap fallback depend on it (the interface criterion
   needs a known weak axis; the swap deliberately has none).
5. **yieldZShear plumbing** — an optional material scalar, a REQUIRED per-bin
   array in `ElementMaterialField` (types → twoRegion blend loop → stress
   consumer; it does NOT cross the assembly-worker boundary), derived as
   yieldZ/√3 wherever absent via `interlaminarShearOf`. Calibration keeps
   S_zs (lap-shear) and S_zt (Z-tension coupon) independent — never
   reintroduce the yieldZ = τ/0.58 conversion except as the flagged
   no-Z-coupon fallback (audit A5).
6. **Bond model is RELATIVE and anchored** — multipliers are exactly 1.0 at
   the reference process condition (per-material nozzle ref, 60 mm/s, fan
   100%, bed 60 °C) evaluated at the SAME layer height, so: no process block
   → bit-identical legacy path; the layer-height slope stays owned by
   `layerHeightFactor`; calibration ratios stay multiplicative. Constants are
   confidence-LOW, regression-locked (`bond.test.ts`), overridable via
   `CalibrationProfile.bondCoeffs` (fit: POST /api/calibration/bond-sweep).
7. **Trend locks over value locks** — hotter nozzle ↑, more fan ↓, faster
   printing ↑ (hotter substrate on arrival). Any change flipping these needs
   new physical evidence, not refactoring.
8. **Orientation stays out of the material's scalars** (audit A4) — direction
   is the criterion's job via weakAxis; the ONLY orientation scalar allowed
   in the material path is `angledNoBedFallbackMul` (0.75, angled with no bed
   picked — no directional model exists there).

## Questions?
If you need clarification on these guidelines, ask in the GitHub issue or PR description.
