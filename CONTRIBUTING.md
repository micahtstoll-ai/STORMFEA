# Contributing to STORMFEA

Thanks for taking an interest. Contributions from FTC teams, engineering students, and FEA practitioners are all welcome.

## Ground Rules

- **Physics first.** Any change that touches the solver, material model, or failure-mode logic needs a clear justification — ideally a citation. The 65% stiffness ratio (E_z/E_xy) and 58% yield ratio (yieldZ/yieldXY) are not arbitrary; they come from peer-reviewed literature. If you have better data, bring the paper. Note 58% is a yield-strength ratio, not a bond strength — the interlaminar bond term is `S_zs`, a separate quantity defaulting to yieldZ/√3.
- **Tests must pass.** Run `npm run test` before opening a PR. The full suite covers 1133 vitest unit tests across 107 files, 187 solver validation tests (patch tests, cantilever benchmarks, isotropic-limit and FDM dual-criterion checks, hole-in-plate Kt, weak-axis Bond rotation, two-region field equivalence), the parallel-assembly equivalence check, and 307 client logic checks. A regression in any of these is a blocker. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md#9-validation) for what the solver suite proves.
- **Keep the design system.** If you're touching the frontend, read `DESIGN.md` first. Three fonts, no gradients, no purple/cyan/blue/green — the aesthetic is intentional.

## Versioning

STORMFEA uses semantic versioning `MAJOR.MINOR.PATCH`, with one house rule:
**MAJOR is the analysis-engine generation, not an ordinary breaking-change counter.**

- `1.x` — the original engine (historical).
- `2.x` — the current, improved engine (two-region material model, FDM dual
  criterion + bond model, C3D10 default, adaptive refinement). This is what
  ships at launch.
- `3.x` — reserved for generative design (FDM-aware topology optimization),
  a substantial research effort back into the codebase (#327).

Within an engine era, bump MINOR for features and PATCH for fixes as usual. Do
**not** bump MAJOR for a routine breaking change — a new MAJOR means a new engine
generation. (The pre-2.0 number had drifted to `43.0.0`; it was reset to `2.0.0`
when this scheme was adopted.)

The version currently lives in three places that must stay in sync until it is
single-sourced (#373): `package.json`, the `/api/health` response in
`server/index.ts`, and the in-app string in `client/index.html`.

## Setting Up

```bash
git clone https://github.com/micahtstoll-ai/stormfea.git
cd stormfea
npm install
npm run build
npm run test   # full suite must pass (see counts above)
```

You'll need [TetGen 1.5.1](https://github.com/emersonkeenan/tetgen1.5.1-beta1) and [Gmsh 4.x](https://gmsh.info) on your PATH for the full server to run, but the solver unit tests work without them.

## Types of Contributions

### Bug Fixes
Open an issue first using the **Bug Report** template so the problem is documented. Then open a PR referencing the issue.

### New Failure Modes
Each failure mode needs:
- A physical model with cited constants
- A confidence level (HIGH / MEDIUM / LOW) based on available FDM-specific data
- A unit test that verifies the correct SF at a known load

### Calibration Data
If you've physically tested coupons from a specific printer/filament combination and have measured failure loads, open an issue with the data. Calibration profiles that others can use are genuinely valuable.

### UI/UX Improvements
Read `DESIGN.md`. Post a screenshot or description in an issue before writing code, so we can agree it fits the design direction before you invest time.

### Documentation
Typos, clarifications, and example walkthroughs are always welcome — open a PR directly.

## Stacked PRs

When a change naturally splits into dependent pieces — or an issue is large
enough that a single PR would be hard to review — use a stack of small PRs rather
than one big branch.

- Branch each PR off the branch below it, not off `main`
  (e.g. `feat/x-base` → `feat/x-part-2` → `feat/x-part-3`).
- Set each PR's **base** to the branch below it (the "base" dropdown when opening
  the PR), so its diff shows only its own change.
- Merge bottom-up. When the base PR merges to `main`, GitHub retargets the next
  PR's base to `main`; merge `main` forward and resolve as needed.
- Keep each PR independently reviewable and, ideally, independently green in CI.
- Link every PR to its issue with `Fixes #N`, and note the stack position in the
  body ("2 of 3, stacked on #<prev-PR>").

Stack only when there's a real dependency. Independent issues (for example, the
launch UI fixes) are better as parallel PRs straight off `main`. On the physics
roadmap, the natural stack is bolt-load application (#371) → spinning/rotational
load cases (#363), since the spinning-shaft-through-bolts case builds on the
former.

## Pull Request Checklist

The PR template covers this, but in short:

- [ ] `npm run test` passes
- [ ] If physics changed: 65% stiffness (E_z) and 58% yield (σ_yield,Z) constants are intact, or change is justified and documented
- [ ] If UI changed: no new fonts, no gradients, spacing follows the 6/12/20/32px grid
- [ ] Commit messages are clear and describe the *why*, not just the what

## Questions

Open a [Discussion](https://github.com/micahtstoll-ai/stormfea/discussions) or an Issue. FTC-season timelines are tight — we'll try to review promptly in the off-season.
