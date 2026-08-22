<div align="center">

# STORMFEA

### FDM-Aware Finite Element Analysis for 3D Printed FTC Robot Parts

[![CI](https://github.com/micahtstoll-ai/stormfea/actions/workflows/test.yml/badge.svg)](https://github.com/micahtstoll-ai/stormfea/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org)

**Nordic Storm · FTC Team 5962 · Saint Peter Area Robotics · BIOBUZZ 2026–2027**

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [What It Does](#what-it-does) · [Calibration](#calibration) · [Known Limitations](#known-limitations) · [Contributing](#contributing)

</div>

---

## The Problem with Standard FEA on FDM Parts

Every general-purpose FEA tool models material as **isotropic** — same stiffness and strength in every direction. FDM prints are not isotropic.

| Direction | Relative Stiffness | Relative Yield Strength |
|-----------|-------------------|------------------------|
| In-layer (XY) | 100% | 100% |
| Through-layer (Z) | **65%** | **58%** |

A flat-printed bracket loaded through its layers, that conventional FEA calls "safe", can fail at **58% of the predicted load** — purely because the layer-to-layer bond is weaker than the bead and the solver didn't know. On an FTC robot, that bracket breaks during a match.

That number — SF ≈ 0.58 for a flat print loaded through the layers — is the tool's core claim, and the failure criterion is built to reproduce it exactly. STORMFEA models the anisotropic reality: a direction-aware stiffness tensor, a separate interlayer-interface failure check, and a geometric split between dense perimeter walls and sparse infill.

---

## What It Does

### Material & failure model

- **Transversely isotropic material** — 5 independent elastic constants from peer-reviewed literature, with an exact weak-axis tensor rotation (Bond transform) for upright/angled prints when a bed face is picked.
- **FDM dual failure criterion** (`fdmDualCriterionSF`) — bulk (bead) von Mises yield *plus* a separate, tension-only interlayer-interface check, with Mohr–Coulomb friction crediting interlayer shear under compression. Azimuth-invariant about the layer normal, collapses to von Mises in the isotropic limit. It **replaced** the Hill (1948) quadratic after the layer-model audit ([`docs/layer-model-audit.md`](docs/layer-model-audit.md)); Hill stays selectable (`criterion: "hill-legacy"`) for comparison, and is still the path used by the upright-no-bed scalar-swap fallback.
- **Two-region material model — on by default** (in the library; see the note below on the HTTP path). Every element is classified geometrically into dense perimeter walls vs homogenized infill core (exact point-to-triangle surface-distance field plus per-element volume fractions) instead of one smeared material. Wall band = wall count × line width; top/bottom solid skins get their own band = layer count × layer height. Stiffness, strength and mass all follow the split. Pass `twoRegion: false` for the legacy single-material path, which stays bit-identical. It self-degrades to the single material, with a stated reason, on any mesh that cannot resolve at least 4 elements across the thinnest section. Known discrepancy: the analyse HTTP handler coerces an absent flag to `false`, so over `POST /api/analyse` the model is currently opt-in rather than default — send `"twoRegion": true` explicitly until that is fixed (`docs/API.md`).
- **Gibson-Ashby infill homogenization** — the core is the solid material times cellular-solid power laws in density (E ∝ ρ^1.75–2.0 by pattern family, not naive linear scaling), with per-axis anisotropy: extruded-wall patterns (grid/lines/honeycomb) stay stiff along the build axis but soften as ρ²–ρ³ in-plane, while TPMS patterns (gyroid/cubic) degrade near-isotropically. Exponents are confidence-labelled LOW and calibration-overridable.
- **Failure modes, each with its own confidence level** — five bolt-region checks (bulk yield, net-section tension, shear-out, thread strip-out, bearing), a decomposed layer interface (interlayer tension / delamination onset, and interlayer shear), and an opt-in wall-to-wall bead-bond check for multi-wall parts.
- **Bead-penetration bond model** (opt-in) — predicts interlayer strength from process settings (nozzle temp, print speed, cooling fan, bed temp) through an anchored interface-cooling → neck-growth → healing chain, with a process-sensitivity dashboard and a nozzle × speed bond-quality surface. Multipliers are exactly 1.0 at the reference process condition, so a run with no process block is bit-identical to the legacy path.
- **Layer height correction** — −15% to +10% variation in Z-direction properties, linear in layer height.
- **Fatigue life estimate** — modified Goodman + Basquin with an FDM-specific endurance ratio (Se/UTS = 0.37 flat, 0.43 upright) and a selectable load ratio R.

### Solve & mesh

- **C3D10 quadratic tetrahedra by default** on both mesher paths (STL → TetGen `-o2`, STEP → Gmsh); C3D4 linear is selectable for faster solves.
- **A mesh tier promises an element count** — coarse ≈ 4,000 / standard ≈ 12,000 / fine ≈ 40,000 — *and* a floor of 4 elements across the thinnest section, on both mesher paths. See [`docs/mesh-sizing.md`](docs/mesh-sizing.md).
- **Superconvergent Patch Recovery** (Zienkiewicz & Zhu 1992) for nodal stress, with Gauss-point sampling and a quadratic recovery basis on C3D10 ([`docs/spr-gauss-point-handoff.md`](docs/spr-gauss-point-handoff.md)).
- **Automatic mesh convergence** — a finer mesh runs in the background; you get a result, and it quietly improves.
- **Symmetry-preserving meshing** (opt-in, `analysis.symmetryMesh`, API-only — no UI toggle yet). An unstructured tet mesh of a mirror-symmetric part is *chiral*, so the recovered stress field carries an asymmetry the part does not have. This detects a symmetry plane, meshes only the fundamental domain, mirrors it and welds the seam exactly. Measured on a symmetric cantilever: 33% of element centroids had a mirror partner and 3.9% rms SPR asymmetry, against 100% and 0.0000% for the mirrored mesh. It costs an extra mesh (detection needs a mesh to run on) and degrades silently to the ordinary path — reported as `summary.symmetryMesh` — when no plane is found, the clip does not close, or the mesher fails.
- **Error-driven adaptive refinement** (opt-in, `analysis.adaptiveRefinement`, API-only, STL/TetGen path). Instead of refining the whole part a tier at a time, the ZZ error estimate drives a size field that concentrates elements where the error is, then re-meshes and re-solves until a 3% global relative error target, an iteration cap, or an element-growth cap is hit. Benchmarked on a Ø5-bore tube: 0.262 global error on 40,534 elements, where a uniform mesh of 54,373 elements reached only 0.337. Two measured caveats: the loop optimises the **energy-norm** error, and those two meshes disagreed on peak stress by 24% — a lower global error is not a settled safety factor; and on a larger part the refined mesh can exceed the solver's wall-clock budget, in which case the run degrades to the tier solve and says so.

### Loads & boundary conditions

- **Contact-patch loading is the default.** A force is applied where it was *placed*, as a raised-cosine disc on the surface it was placed on, rather than smeared over a whole face. This changes the answer for every force that does not name a distribution, including every force the client has ever sent — the deltas are large and deliberate. `loadDistribution: 'uniform'` restores the previous behaviour exactly. Rationale and measurements: [`docs/load-distribution-default.md`](docs/load-distribution-default.md).
- **Surface pressure** with a normal-to-surface option for curved faces, a region selector (extreme face toward a direction / every face facing that direction / the whole exterior, i.e. hydrostatic), and suction (negative pressure).
- **Body-force loads** — self-weight and robot acceleration/impact in multiples of g, using the infill-scaled mass.
- **Modal analysis** (opt-in, `analysisType: 'modal'`) — natural frequencies with animated mode shapes.
- **Linear buckling** (opt-in, `computeBuckling`) — Buckling Load Factor with an animated buckling mode; geometric stiffness for both C3D4 and C3D10.

### Reading the result

- **Heatmap view modes** — tension/compression, von Mises, signed von Mises, the three principal stresses, damage ratio, XY and interlayer utilization, the ZZ error estimate η, the wall/core split, and mesh sensitivity.
- **Mesh sensitivity (`meshsens`)** — the tool says **where** the displayed field is mesh-dependent. Re-mesh the same part at the same density and the hot spots move; this differences the two finest meshes a run already produced, per display vertex, as a percentage of the surface peak. It is free, because every analyse response paints the same display mesh whatever the analysis density, so the comparison is an array difference rather than a re-projection. Null means *unmeasured* and never renders as zero: with only one solve, the mode does not appear at all. See [`docs/display-field-mesh-sensitivity.md`](docs/display-field-mesh-sensitivity.md).
- **Section / cutting-plane view** — slice the part along X/Y/Z to read stress on internal and occluded surfaces. This is also the only place the wall/core split is visible: a part's outer boundary is wall by construction, so on the model surface the classification is identically 1.0 everywhere.
- **Deflected-shape visualization** — warp the mesh by the computed displacement field, with an exaggeration slider and animation; the heatmap follows the deformed surface.
- **The legend reports its own clipping** — the sequential scale clips to the p02..p98 band so one singular vertex cannot wash out the map, and marks the clipped end labels with `≥` / `≤` rather than silently overstating its coverage.
- **Client-side PDF export** — the full report is generated in-browser by a hand-rolled ~100-line PDF writer (no Puppeteer, no Chromium download, no server round-trip), so it works offline at a competition venue.

### Getting geometry and settings in

- **Onshape integration** — import straight from a Part Studio over the REST API (HMAC-signed), no manual export step.
- **STL and STEP upload**, with cylindrical hole detection on both paths.
- **`.gcode` import** — drop a sliced file to auto-fill print settings (layer height, walls, infill, nozzle/bed temperature, speed) instead of re-typing them. Parsed entirely in the browser.
- **Coupon calibration** — tensile, Z-tension, lap-shear and bearing coupons tune the static allowables to your printer and filament, with Z-tension and lap-shear calibrating through-layer tension and interlaminar shear *independently*. Cyclic and process sweeps additionally fit the fatigue S-N curve and the bond model.
- **Accessible audio feedback** — per-stage tones for upload → mesh → solve → completion, with volume control and a disable toggle, for loud lab and competition environments. PREFS tab.

---

## Differentiators vs. Standard FEA

| Feature | Conventional FEA | STORMFEA |
|---------|-----------------|----------|
| Material model | Isotropic (E, ν) | Transversely isotropic (5 constants) |
| Yield criterion | Von Mises | FDM dual criterion (bulk von Mises + interlayer interface); Hill (1948) legacy option |
| Walls vs infill | One smeared material | Two-region model **by default**: solid perimeter shell + Gibson-Ashby lattice core, blended per element |
| Stress smoothing | Direct averaging | SPR (Zienkiewicz-Zhu 1992), Gauss-point sampled on C3D10 |
| Failure modes | Bulk yield only | Bolt-region + interlayer modes, each with a confidence level |
| Mesh convergence | Manual | Automatic (finer mesh in the background) |
| Mesh-induced error in the picture | Not shown | Measured per location and painted (`meshsens` view) |
| Point loads | Smeared over a face | Contact patch at the placed location, by default |
| Layer height effect | Not modeled | −15% to +10% on Z-direction properties |
| FDM calibration | Not possible | Physical coupon calibration (tensile / Z-tension / lap-shear / bearing) |

---

## Quick Start

### Prerequisites

| Tool | Version | Needed for | Install |
|------|---------|-----------|---------|
| Node.js | 20+ | Everything | [nodejs.org](https://nodejs.org) |
| TetGen | 1.5.x | **STL** meshing | Linux: `sudo apt-get install tetgen` · macOS: `brew install tetgen` · Windows: [GitHub release](https://github.com/emersonkeenan/tetgen1.5.1-beta1) — rename to `tetgen.exe`, place in project root |
| Gmsh | 4.x | **STEP** meshing and Onshape import | `winget install Gmsh.Gmsh` (Windows) or [gmsh.info](https://gmsh.info) |

Both meshers are external binaries, and neither is bundled. The app starts and runs without them, but degrades in a way you need to know about:

- **No TetGen** → an uploaded STL falls back to a **bounding-box mesh**. That box has no holes, no fillets and no stress concentrations — that is, none of the features parts actually fail at. The result is reported with an explicit "not suitable for design decisions" banner, and no safety factor is claimed. Install TetGen.
- **No Gmsh** → STEP upload and Onshape import do not work at all.

### Install & Run

```bash
git clone https://github.com/micahtstoll-ai/stormfea.git
cd stormfea
npm install
npm run build      # tsc → dist/, then copies client/ → dist/client/
npm start          # node dist/index.js
# Open http://localhost:3000
```

**Windows:** double-click `start.bat` — it installs dependencies on first run, builds, syncs the client, warns about missing meshers, and opens the browser for you.

`npm run dev` is `npm run build && npm start` in one step. Re-run `npm run copy:client` after editing `client/index.html`, or the server keeps serving the copy in `dist/`.

> **Offline use:** the entire app runs with no internet connection after install. The 3-D viewer's Three.js runtime (r152) and all UI fonts are vendored under `client/vendor/` — no CDN, no Google Fonts — and PDF export is fully client-side. Nothing is fetched from an external host at runtime.

---

## How It Works

```
Browser (Three.js 3D viewer + form UI)
         │  HTTP / port 3000
         ▼
Express Server (Node.js + TypeScript)
         │
    ┌────┴──────────────────────────────┐
    │  Upload pipeline                  │
    │  STL  → TetGen → tetrahedral mesh │
    │  STEP → Gmsh   → mesh + holes     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │  Material field                   │
    │  distance   surface distance field│
    │  wallfrac   per-element wall frac │
    │  twoRegion  per-bin blended C     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │  FEM Solver                       │
    │  buildC      constitutive matrix  │
    │  assembleK   global K (CSR)       │
    │  applyBCs    penalty method       │
    │  PCG solve → u (displacement)     │
    │  SPR       → σ (nodal tensor)     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │  Post-processing                  │
    │  dual criterion → safety factor   │
    │  bolt + interlayer failure modes  │
    │  Goodman fatigue estimate         │
    │  ZZ error estimate                │
    │  Print recommendations            │
    │  PDF report (client-side)         │
    └───────────────────────────────────┘
```

Module-by-module detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the math is in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

### Solver Stack

| Component | Implementation |
|-----------|---------------|
| Elements | C3D10 (quadratic tet, default) + C3D4 (linear tet, faster but shear-locking-prone in bending) |
| Constitutive matrix | Transversely isotropic, 5 constants; per-element two-region blend when the material field is active |
| Global assembly | Compressed Sparse Row (CSR), parallel across a persistent worker pool |
| Boundary conditions | Dirichlet via penalty method |
| Linear solve | Preconditioned Conjugate Gradient (PCG) |
| Stress recovery | SPR (Zienkiewicz-Zhu 1992) — one recovered nodal *tensor* field, projected for both the heatmap and the utilization fields |
| Error estimate | Zienkiewicz-Zhu, recovered-vs-raw, in the energy norm |
| Failure criterion | FDM dual criterion (bulk von Mises + interlayer interface); Hill (1948) legacy option |

---

## Model Constants

All constants are cited to peer-reviewed literature and documented, with confidence labels, in the app's **Sources** tab.

| Constant | Value | Confidence | Source |
|----------|-------|-----------|--------|
| E_z / E_xy (stiffness ratio) | 0.65 | MEDIUM | Perez et al. 2021 (measured range 0.48–0.85) |
| σ_yield,Z / σ_yield,XY | 0.58 ± 0.10† | MEDIUM | Cojocaru et al. 2019 (measured 0.59; range 0.50–0.65) |
| G_xz / G_xy | 0.40 | LOW | Ahn et al. 2002; Casavola et al. 2016 |
| ν_xz | 0.30 | LOW | Casavola et al. 2016 |
| S_zs / σ_yield,Z (interlaminar shear) | 1/√3 ≈ 0.577 | — (exactly Hill's transverse shear; superseded by a lap-shear coupon) | — |
| Layer height slope | −1.0 ± 30%† /mm, clamped to [0.85, 1.10] | MEDIUM | Farashi & Vafaee 2022 |
| Se / UTS (endurance ratio) | 0.37 flat / 0.43 upright | LOW (MEDIUM once you fit your own S-N curve) | Wang et al. 2020 |
| Mohr–Coulomb interface friction μ | 0.3 | LOW | engineering estimate |
| Infill exponent (E ∝ ρ^n) | 1.75–2.0 by pattern family | LOW | Gibson & Ashby power-law form is cited; the per-family exponents are engineering estimates within the cited range |

† Central value is sourced to the cited paper. The uncertainty band (±0.10 on the yield ratio, ±30% on the layer-height slope) is an engineering margin applied for the conservative/optimistic SF range bar — it is not a value reported by those papers.

**A LOW-confidence constant is a documented gap, not a bug.** Do not nudge one because a result looks more reasonable; bring calibration data or a paper. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Calibration

The defaults are literature averages — good for a first pass, but your printer and your filament will differ. For printer-specific accuracy:

1. **CALIBRATE** tab → download coupon STLs
2. Print with your target settings (walls, layer height, infill)
3. Pull to failure with a force gauge
4. Enter the measured loads → save profile
5. Run the analysis with the calibrated profile active

The **lap-shear coupon** directly measures inter-layer bond strength — the single most important variable in the model. It and the **Z-tension coupon** calibrate interlaminar shear and through-layer tension *independently*; neither is derived from the other. Cyclic coupons (`POST /api/calibration/fatigue`) fit your own Basquin `b` and `Se/UTS`, and a process sweep (`POST /api/calibration/bond-sweep`) fits the bond model's coefficients.

---

## Project Structure

```
stormfea/
├── server/
│   ├── index.ts          Express routes (upload, analyse, calibrate, report, Onshape)
│   ├── analysis.ts       FEM pipeline, failure modes, fatigue, report assembly
│   ├── twoRegion.ts      Two-region (shell/core) material field builder
│   ├── homogenize.ts     Numerical homogenization harness for the lattice exponents
│   ├── meshSizing.ts     What a mesh tier promises, shared by both meshers (#295)
│   ├── stl.ts            Binary/ASCII STL parser
│   ├── holes.ts          Cylindrical hole detection from STL geometry
│   ├── tetgen.ts         TetGen wrapper (STL → .node/.ele), switch-set fallback chain
│   ├── gmsh_mesh.ts      Gmsh wrapper (STEP → .msh, curvature refinement)
│   ├── c3d10_ordering.ts Runtime guard on a mesher's midside-node ordering (#167)
│   ├── onshape.ts        Onshape REST API (HMAC auth, Part Studio STEP export)
│   ├── coupon_stl.ts     Calibration coupon STL generators
│   ├── coupon_fea.ts     FEA-in-the-loop Kt extraction
│   ├── validate.ts       Request-shape checker run before any heavy work
│   ├── validation.ts     Prediction-vs-measurement scoreboard
│   ├── validation-coverage.ts  Per-analysis validation coverage map (#191)
│   ├── demo_part.ts      Sample bracket for one-click judge demo
│   ├── report.ts         Server-rendered HTML report (GET /api/report)
│   └── solver/
│       ├── types.ts      Material interfaces + per-element material field
│       ├── element.ts    C3D4 + C3D10 elements, constitutive matrix, B matrix
│       ├── lattice.ts    Gibson-Ashby infill homogenization laws (per pattern family)
│       ├── laminate.ts   Classical Laminate Theory in-plane stiffness (opt-in CLT)
│       ├── distance.ts   Exact point-to-triangle surface distance field
│       ├── wallfrac.ts   Per-element wall-band volume fractions (marching tet)
│       ├── adjacency.ts  Node → element adjacency (O(1) lookups)
│       ├── csr.ts        Dependency-free CSR helpers shared with the worker
│       ├── assembly.ts   Global stiffness matrix assembly (CSR)
│       ├── assembly-worker.ts  Worker-thread element assembly
│       ├── assembly-pool.ts    Persistent lazy worker pool (#98)
│       ├── boundary.ts   Dirichlet BCs (penalty method)
│       ├── load.ts       Neumann BCs (nodal forces, contact-patch distribution)
│       ├── mass.ts       Mass matrix assembly (modal / self-weight)
│       ├── modal.ts      Natural-frequency eigensolver
│       ├── buckling.ts   Linear buckling (geometric stiffness) eigensolver
│       ├── cg.ts         Preconditioned Conjugate Gradient solver
│       ├── pipeline.ts   runLinearStatic() entry point + mesh-quality gate
│       ├── meshgen.ts    Box-mesh fallback generators + surface extraction
│       ├── meshQuality.ts      Element quality metrics (Jacobian, aspect ratio)
│       ├── adaptiveMesh.ts     Error-driven size field + refinement loop (#149)
│       ├── symmetry.ts   Symmetry-plane detection (#296)
│       ├── clip.ts       Watertight clipping of a closed surface at a plane (#300)
│       ├── mirrorMesh.ts Reflect a fundamental domain and weld the seam (#296)
│       ├── stress.ts     SPR recovery, FDM dual criterion (+ Hill legacy), ZZ estimator
│       ├── bond.ts       Bead-penetration process → bond-strength model
│       └── stress_detail.ts    Full stress tensor (σxx,σyy,σzz,τxy,τyz,τxz)
├── server/tests/
│   ├── unit/             vitest suite (the bulk of the tests)
│   ├── solver_validation.ts        Solver validation suite (analytical benchmarks)
│   ├── test-parallel-assembly.ts   Serial-vs-parallel assembly equivalence
│   ├── measure260.ts, measure294.ts  Offline measurement scripts, not CI tests
│   └── mem_profile.ts    Memory profiling harness (npm run profile:mem)
├── client/
│   ├── index.html        Single-file frontend (vanilla JS + Three.js)
│   ├── solver.worker.js  Web Worker for background solver requests
│   └── vendor/           Vendored Three.js r152 + the three UI fonts (offline)
├── scripts/
│   ├── copy-client.mjs           Copies client/ into dist/ for Express serving
│   ├── test_client_logic.mjs     Client-side logic validation
│   ├── vitest-shard.mjs          Splits vitest into the light/heavy CI shards
│   ├── heavy-tests.json          The heavy shard's file list
│   ├── check-doc-test-counts.mjs Test-count drift guard (#198)
│   ├── check-api-routes.mjs      docs/API.md ↔ registered-route drift guard
│   ├── check-invariants-symbols.mjs  docs/INVARIANTS.md symbol drift guard
│   ├── check-client-identifiers.mjs  Client identifier/reference guard
│   └── check-nullish-precedence.mjs  ?? / || precedence guard
├── .github/
│   ├── workflows/test.yml   CI: five concurrent jobs
│   ├── actions/setup/       Shared CI setup (Node, npm ci, TetGen/Gmsh)
│   ├── ISSUE_TEMPLATE/      Bug report and feature request templates
│   └── pull_request_template.md
├── docs/                 See the Documentation index below
├── start.bat             Windows launcher (installs, builds, opens browser)
├── start-debug.bat       Windows launcher with verbose solver diagnostics
├── CLAUDE.md             Normative invariants + agent working guidelines
├── CONTRIBUTING.md       How to contribute
├── DESIGN.md             Frontend design system
├── ROADMAP.md            Development history and planned work
└── README.md             This file
```

### Documentation

| Doc | What it is for |
|-----|----------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The contributor's map: how a request flows from upload to heatmap, and what each module owns |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | The physics and math behind the solver, in one narrative |
| [docs/API.md](docs/API.md) | Every HTTP route with request/response shapes — drift-guarded against `server/index.ts` in CI |
| [docs/INVARIANTS.md](docs/INVARIANTS.md) | The resolved index from each normative invariant in `CLAUDE.md` to its implementing symbol and locking test |
| [docs/layer-model-audit.md](docs/layer-model-audit.md) | Why the Hill criterion was replaced: the A1–A7 defect history, all resolved |
| [docs/display-field-mesh-sensitivity.md](docs/display-field-mesh-sensitivity.md) | Why the displayed field is mesh-dependent, why η cannot flag it, and what the tool shows instead |
| [docs/load-distribution-default.md](docs/load-distribution-default.md) | Why `contact_patch` became the default load distribution, and what it cost |
| [docs/mesh-sizing.md](docs/mesh-sizing.md) | What a mesh tier promises, and why both meshers now promise the same thing |
| [docs/bc-singularity-exclusion.md](docs/bc-singularity-exclusion.md) | Excluding boundary-condition singularities from the adaptive loop, and the limits of doing so |
| [docs/spr-gauss-point-handoff.md](docs/spr-gauss-point-handoff.md) | Gauss-point SPR sampling for C3D10: what was measured, including where the first diagnosis was wrong |
| [docs/REPO_ANALYSIS_2026-07.md](docs/REPO_ANALYSIS_2026-07.md) | The July 2026 full-repo audit — a dated snapshot, kept as a record |
| [docs/IMPLEMENTATION_PLAN_2026-07.md](docs/IMPLEMENTATION_PLAN_2026-07.md) | The phased plan that sequenced the issues that audit filed |
| [docs/AI_ORCHESTRATION.md](docs/AI_ORCHESTRATION.md) | Log of how AI tooling was used to build and audit the engine |
| [CLAUDE.md](CLAUDE.md) | The normative invariant list, and the working rules for anyone (human or agent) changing this repo |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, ground rules, the physics-citation requirement, PR checklist |
| [DESIGN.md](DESIGN.md) | Frontend design system — typography, colour, spacing, component rules, colour-space correctness |
| [ROADMAP.md](ROADMAP.md) | Development history and planned work |

---

## Known Limitations

This project's credibility rests on stating what it cannot do. If a limitation below has been measured, the measurement and its confidence label are given.

**Physics and modelling**

- **Linear elastic only** — no plasticity, no large deformation, no contact. The deflected-shape view is a scaled visualization of the *linear* solution, not a large-deformation result.
- **Upright / angled orientation** is modeled exactly (weak-axis tensor rotation) only when a bed face is picked. Without one, an upright print falls back to a conservative scalar-swap approximation, which has no directional model and therefore uses the legacy Hill criterion rather than the interface criterion.
- **Infill homogenization exponents** — the Gibson-Ashby power-law *form* is literature-cited, but the per-pattern-family exponents are engineering estimates within the cited ranges (LOW confidence, regression-locked, overridable per calibration profile). Pattern strength multipliers are likewise approximate; pattern-ranking literature is inconsistent. The numerical-homogenization harness (`server/homogenize.ts`) produces a solver-derived degradation curve and is validated against classical isolated-hole theory, but its first-order single-hole cell is concentration-dominated and does not yet reproduce a periodic wall network's exponent — so it does not lift these above LOW. A periodic square-void RVE (or physical coupons) is the path to MEDIUM.
- **Bearing failure confidence: LOW** — there is no FDM-specific bearing test data in the literature.
- **Mohr–Coulomb interface friction (μ = 0.3) confidence: LOW.**
- **Fatigue confidence: LOW → MEDIUM** — literature S-N data is sparse (LOW by default), but a team that fits its own S-N curve from cyclic coupons replaces the defaults and lifts the mode to MEDIUM.
- **Linear buckling confidence: LOW** — the eigenvalue itself is validated to <5% against closed-form Euler, so the *computed* buckling load is high-confidence. The mode stays LOW only for the empirical ~10–40% FDM imperfection knockdown, which is reported as an imperfection-adjusted BLF and already embedded in the verdict thresholds.
- **Filament colour** affects strength (η² = 97.3% in one study) — not modeled.
- **Layer height correction** is a linear approximation, valid within about ±0.15 mm of nominal.
- **Bond-model constants are LOW confidence** and locked by regression rather than by measurement. What is defended is the *trend* (hotter nozzle up, more fan down, faster printing up), not the value; the values are overridable from a process sweep.

**The picture itself**

- **The displayed field is mesh-dependent, and refinement is the only lever on the amplitude.** Re-mesh the same part at the same density and the hot spots move. On the #294 cantilever fixture at the shipped tier densities, `|A−B|` as a share of the surface peak ran p95 1.45% / max 1.83% at the standard tier and p95 2.15% / max 14.61% at coarse (15% node displacement); at 25% displacement coarse reached p95 12.18% / max 18.40%. **Confidence: the mechanism is HIGH** (structural, measured four times independently), **the amplitudes are MEDIUM** — one geometry class (a plate in bending), one isotropic material, structured meshes rather than real mesher output. They support the comparison *between tiers*, which is what the conclusion rests on. **Do not read 1.45% as "the" figure for another part**; the tool measures the overlay per-part precisely because a user's part is not this plate. The erring direction is known: a perturbed structured mesh is a *tame* model of "a different mesh of the same part", so the real spread is likely larger, not smaller.
- **The ZZ error estimator provably cannot flag those locations.** η differences the recovered field against the raw element field, so an artifact carried by both cancels in the difference. Measured Spearman against actual mesh-to-mesh disagreement: 0.015, then 0.061 / −0.066 / −0.164 on re-measurement — none predictive, and the sign flip is noise. `globalRelativeError` remains valid for the energy-norm error it was built for, and `topErrorElements` must never be read as "here is where the picture lies". Use the `meshsens` view for that, and only after a second mesh has been solved.
- **`meshsens` measures two different densities**, so it mixes the random mesh artifact with ordinary under-resolution. Where it is small, that is weak evidence, not proof — two meshes agreeing is not convergence.
- **The wall/core split is invisible on the model surface.** Every boundary node sits at distance 0 from the surface, inside the wall band, so the classification on the display mesh is identically 1.0 on every part. It is only meaningful on a section cut.

**Meshing and elements**

- **Both meshers are external binaries.** Without TetGen an STL run degrades to a featureless bounding box and says so; without Gmsh, STEP and Onshape import do not work.
- **Element order** — both upload paths default to quadratic C3D10. Linear C3D4 is selectable for faster solves but underpredicts bending stress by roughly 55% due to shear locking. TetGen's mid-node ordering permutation is verified empirically and pinned by a regression test; if the runtime ordering guard rejects a C3D10 mesh twice, the analysis continues on C3D4 with the geometry intact and reports the downgrade.
- **Symmetry-preserving meshing does not by itself guarantee a symmetric picture** — the default `contact_patch` load distribution is separately asymmetric.
- **Closely-spaced holes (STEP)** — if Gmsh merges two hole surfaces, the detected radius can be wrong. Overlapping detections are flagged in the CONSTRAINTS panel so you can verify or redefine them.
- **Adaptive refinement optimises the energy-norm error**, which is not the same thing as converging the peak stress: on the benchmark part, two meshes 1.34× apart in element count disagreed on peak von Mises by 24%.

**Scope**

- **Adaptive refinement and symmetry-preserving meshing are API-only.** There is no UI toggle for either yet.
- **Surface pressure loads** use consistent tributary-area (lumped) nodal loading.
- **Local-first, single-user.** No cloud component, no database, no auth; profiles live in `~/.stressform_*.json` on the machine running the server.

---

## Debugging

Run `start-debug.bat` instead of `start.bat` for verbose solver output (it sets `STORMFEA_DEBUG_CG=1` and `STORMFEA_DEBUG_SURFACES=1`). Watch the console while uploading a file or clicking **Analyse**.

**CG residual trends and what they mean:**

| Residual shape | Likely cause |
|----------------|-------------|
| Climbs immediately | Near-singular system — bolt constraints don't resist rigid-body rotation |
| Bounces up/down | Degenerate mesh element or material property issue |
| Shrinks slowly but steadily | Poorly conditioned system — try a coarser mesh or simplify sharp geometry |

**Client-side URL flags:**

| Flag | Effect |
|------|--------|
| `?debugWeld=true` | Logs vertex weld grouping statistics, group-size distribution, and high-discontinuity triangles |
| `?disableGamma=true` | Sets the *initial* heatmap gamma state; the in-app LINEAR/γ button in the legend then owns it, persisted in `localStorage` as `sf-gamma-disabled` |

The **DEBUG** tab carries system state, the last analysis, a feature checklist, the recent console log, and a **Copy Bug Report** button that packages all of it.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, and [CLAUDE.md](CLAUDE.md) for the invariants a change must not silently break. Quick summary:

1. Fork → create a branch (`git checkout -b fix/my-fix`)
2. Make changes. If you touch the solver, material model or failure-mode logic, **bring a citation** and tag any new constant HIGH / MEDIUM / LOW. The 65% stiffness and 58% yield ratios are not adjustable to taste.
3. Every new failure mode needs a unit test asserting the correct SF at a known load.
4. If you touch the frontend, read [DESIGN.md](DESIGN.md) first.
5. Run `npm run test` — everything must pass: 1129 vitest unit tests across 106 files, 187 solver validation tests in `solver_validation.ts`, the parallel-assembly equivalence suite, and 296 client logic checks (a few vitest tests self-skip where the TetGen/Gmsh binaries are absent, so the raw totals show a handful of skips). The run finishes with five drift guards; if one fails, the doc it names is stale, not the guard.
6. Open a pull request using the provided template, and link the issue with `Fixes #N`.

CI splits the same suite across five concurrent jobs (`unit-light`, `unit-heavy`, `solver`, `client`, `doc-counts`) because the suite is CPU-bound on real FE solves. Look at `unit-light` first when CI goes red.

---

## License

[MIT](LICENSE) — Nordic Storm FTC Team 5962, Saint Peter Area Robotics

---

<div align="center">

Built by **Micah Stoll** · Nordic Storm FTC 5962 · Saint Peter MN · BIOBUZZ 2026–2027

*If this tool helps your team build better robots, a star on GitHub goes a long way.*

</div>
