# STORMFEA Project Guidelines for Claude AI

## Project Overview
STORMFEA is an FDM-aware finite element analysis tool built with TypeScript/Node.js and React. The project uses npm for dependency management and runs automated tests via GitHub Actions.

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
- `client/` - React frontend (TypeScript)
- `server/tests/` - Test files
- `.github/workflows/` - CI/CD pipeline definitions
- `package.json` - Project dependencies
- `package-lock.json` - Locked dependency versions (DO NOT DELETE)
- `tsconfig.json` - TypeScript configuration

## GitHub Actions Workflows
1. **test.yml** - Runs on every push/PR to main
   - Installs dependencies via `npm ci`
   - Compiles TypeScript
   - Runs solver validation tests

2. **design-research.yml** - Weekly AI design research
   - Requires ANTHROPIC_API_KEY secret
   - Runs design analysis and improvements

3. **nightly-design-loop.yml** - Nightly automated design loop
   - Requires ANTHROPIC_API_KEY and GITHUB_TOKEN
   - Creates design improvement PRs

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

## Questions?
If you need clarification on these guidelines, ask in the GitHub issue or PR description.
