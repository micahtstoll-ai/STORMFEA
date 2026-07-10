# Contributing to STORMFEA

Thanks for taking an interest. Contributions from FTC teams, engineering students, and FEA practitioners are all welcome.

## Ground Rules

- **Physics first.** Any change that touches the solver, material model, or failure-mode logic needs a clear justification — ideally a citation. The 65% stiffness ratio and 58% bond strength are not arbitrary; they come from peer-reviewed literature. If you have better data, bring the paper.
- **Tests must pass.** Run `npm run test` before opening a PR. The full suite covers 226 Vitest unit tests, 97 solver validation tests (patch tests, cantilever benchmarks, isotropic-limit and Hill-criterion checks), the parallel-assembly equivalence check, and 41 client-logic checks. A regression in any of these is a blocker. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md#9-validation) for what the solver suite proves.
- **Keep the design system.** If you're touching the frontend, read `DESIGN.md` first. Three fonts, no gradients, no purple/cyan/blue/green — the aesthetic is intentional.

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

## Pull Request Checklist

The PR template covers this, but in short:

- [ ] `npm run test` passes
- [ ] If physics changed: 65% stiffness (E_z) and 58% yield (σ_yield,Z) constants are intact, or change is justified and documented
- [ ] If UI changed: no new fonts, no gradients, spacing follows the 6/12/20/32px grid
- [ ] Commit messages are clear and describe the *why*, not just the what

## Questions

Open a [Discussion](https://github.com/micahtstoll-ai/stormfea/discussions) or an Issue. FTC-season timelines are tight — we'll try to review promptly in the off-season.
