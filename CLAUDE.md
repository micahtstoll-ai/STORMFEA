# STORMFEA Project Guidelines for Claude AI

## Project Overview
STORMFEA is an FDM-aware finite element analysis tool built with TypeScript/Node.js (server) and a single-file vanilla-JS client. The project uses npm for dependency management and runs automated tests via GitHub Actions.

## Critical Files & Safety Rules

### Package Lock File (package-lock.json)
**CRITICAL**: This file MUST remain in the repository and be included in every commit.

**Rules:**
- ✅ DO: Include `package-lock.json` in all commits
- ✅ DO: Verify the lock file exists before creating PRs
- ✅ DO: Run `npm install` or `npm ci` if updating dependencies
- ❌ DON'T: Exclude or ignore `package-lock.json`
- ❌ DON'T: Delete `package-lock.json` during refactoring
- ❌ DON'T: Create commits that remove this file

**Why:** The lock file ensures all CI environments use identical dependency versions. Without it:
1. GitHub Actions workflows fail (`npm ci` requires the lock file)
2. Builds become non-reproducible
3. Different developers get different packages installed
4. Pull request CI fails, blocking merges

### Git Safety Checklist
Before creating a commit or PR, verify:
- [ ] `package-lock.json` is present: `ls package-lock.json`
- [ ] Lock file changes are intentional: `git diff package-lock.json`
- [ ] No critical build files were accidentally removed

### Workflow Files (.github/workflows/)
These files define CI/CD behavior. Before modifying:
- Test changes locally first
- Ensure `npm ci` and `npm run test` pass locally
- Document any new environment variables needed

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
1. Check the GitHub Actions logs first
2. Run `npm ci` locally to reproduce dependency issues
3. Run `npm run test` to reproduce test failures
4. Look for errors in TypeScript compilation or test execution

## Project Structure
- `server/` - Node.js backend (TypeScript)
- `client/` - Single-file frontend (vanilla JS + Three.js)
- `server/tests/` - Test files
- `.github/workflows/` - CI/CD pipeline definitions
- `package.json` - Project dependencies
- `package-lock.json` - Locked dependency versions (DO NOT DELETE)
- `tsconfig.json` - TypeScript configuration

## GitHub Actions Workflows
1. **test.yml** - Runs on every push/PR to main (the only workflow)
   - Installs dependencies via `npm ci`
   - Compiles TypeScript
   - Runs the full test suite (vitest units, solver validation, parallel
     assembly equivalence, client logic checks)

## Prevention Guidelines for Automated Commits
When making automated PRs or commits:
1. Always run: `ls -la package-lock.json` to verify existence
2. Always verify: `git diff package-lock.json` shows expected changes only
3. Always test: Run `npm ci && npm run test` before pushing
4. Never use: `git add -A` or `git add .` - add files explicitly
5. Never delete: Build artifacts (dist/), lock files, or config files

## Heatmap Rendering — Common Pitfalls & Lessons Learned

### Known Issue: Vertex Welding Algorithm (FIXED)
**Problem:** Visible line artifacts in heatmap coloring, appearing as straight lines across the 3D visualization. These were caused by vertices at mesh seams not being properly grouped for stress smoothing.

**Root Cause:** The spatial hash grid for vertex welding used `Math.round()` for grid cell indexing, which caused edge cases with negative coordinates:
- `Math.round(-0.25) = 0` but `Math.round(-0.75) = -1`
- Vertices within 0.01mm (WELD_EPS) could hash to non-adjacent cells
- The 27-cell neighborhood search would eventually find connections, but only after multiple passes
- Under certain mesh geometries, this led to vertices that should be welded together remaining separate

**Solution Applied (commit: 49bc5d6):**
- Switched from `Math.round()` to `Math.floor()` with bounding-box normalization (consistent with server-side spatial indexing in `server/analysis.ts:1728-1730`)
- This ensures all vertices are consistently hashed within a normalized [0, extent) range
- Added diagnostic debug modes (`?debugWeld=true`) for future troubleshooting

**Key Insight:** The server's spatial grid (`analysis.ts`) uses `Math.floor((x - xMin) / cellSize)`, so the client's vertex welding should match this approach for consistency and to avoid edge-case artifacts.

### Vertex Welding Requirements (Invariants)
When modifying heatmap or mesh coloring code:
1. **Every vertex in display mesh MUST receive a stress value** — verify `vertexStress.length === triangleCount * 3`
2. **Vertices at same location (distance < 1 micron) MUST get identical stress** — weld before color assignment
3. **Use consistent grid-cell indexing** — match server's `floor((x - min) / cell)` approach, never `round(x / cell)`
4. **Test on edge cases:** negative coordinates, mesh boundaries, seams between large and small triangles

### Material & Shading Essentials
- **Always use Gouraud shading** (vertex-interpolated) for stress heatmaps: `flatShading: false` in MeshPhongMaterial
- **Never use flat-shading** on ColorAttribute geometries — creates hard edges at triangle boundaries that appear as artifacts
- **Color clamping:** Use per-vertex colors, not per-triangle; gamma curve (`GAMMA = 0.55`) expands low-stress regions

### Debug Tools Available
- `?debugWeld=true` — Logs vertex grouping statistics, discontinuity detection, potential welding issues
- `?disableGamma=true` — Disables gamma curve (test if color banding is from gamma expansion)
- Console output includes group size distribution and high-discontinuity triangles

### Code Review Checklist (Stress Rendering Changes)
Before submitting a PR that modifies mesh visualization or stress heatmap:
- [ ] Are coincident vertices being welded BEFORE color assignment? (weld tolerance: 0.01mm)
- [ ] Is shading mode explicitly set to Gouraud (`flatShading: false`)? 
- [ ] Does every display vertex receive a stress value (no NaN, no Infinity)?
- [ ] Stress array length validated: `vertexStress.length === triangleCount * 3`?
- [ ] Spatial grid indexing is consistent: floor-based with bounding-box normalization?
- [ ] Tested on mesh with negative coordinates (e.g., model centered at origin vs at positive quadrant)?
- [ ] Visual regression test added or updated for new coloring logic?
- [ ] Known limitation documented (if any) in user-facing messages?

### References
- Vertex Welding: `client/index.html` lines ~2210–2280 (computeSmoothedStressColors function)
- Server Spatial Grid: `server/analysis.ts` lines 1712–1776 (nearestNodeStress function)
- Stress Recovery: `server/solver/stress.ts` lines 376–515 (sprSmoothedStress function)

## Two-Region Material Model — Invariants

The opt-in two-region model (`print.twoRegion`) classifies elements into dense
perimeter walls vs homogenized infill core (`server/twoRegion.ts`,
`server/solver/distance.ts`, `server/solver/wallfrac.ts`, consumed via
`ElementMaterialField` in `server/solver/types.ts`). When modifying it:

1. **Flag off must stay bit-identical** — with no field, assembly/recovery/mass
   must reproduce the legacy single-material path exactly (tested to 1e-12 on
   full solves in `solver_validation.ts` group 25).
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

## Interlayer Failure & Bond Model — Invariants

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
