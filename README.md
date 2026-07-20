<div align="center">

# STORMFEA

### FDM-Aware Finite Element Analysis for 3D Printed FTC Robot Parts

[![CI](https://github.com/micahtstoll-ai/stormfea/actions/workflows/test.yml/badge.svg)](https://github.com/micahtstoll-ai/stormfea/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org)

**Nordic Storm · FTC Team 5962 · Saint Peter Area Robotics · BIOBUZZ 2026–2027**

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Key Features](#key-features) · [Calibration](#calibration) · [Contributing](#contributing)

</div>

---

## The Problem with Standard FEA on FDM Parts

Every FEA tool models material as **isotropic** — same stiffness in every direction. FDM prints are not isotropic.

| Direction | Relative Stiffness | Relative Yield Strength |
|-----------|-------------------|------------------------|
| In-layer (XY) | 100% | 100% |
| Through-layer (Z) | **65%** | **58%** |

A flat-printed bracket that conventional FEA calls "safe" can fail at **55% of the predicted load** — purely because the through-layer bond is weaker and the solver didn't know. On an FTC robot, that bracket breaks during a match.

STORMFEA models the anisotropic reality.

---

## Key Features

- **Transversely isotropic material model** — 5 independent elastic constants calibrated from peer-reviewed literature, with an exact weak-axis tensor rotation (Bond transform) for upright/angled prints when a bed face is picked
- **FDM dual failure criterion** — bulk (bead) von Mises yield plus a separate, tension-only interlayer-interface (delamination) check with Mohr–Coulomb friction under compression; azimuth-invariant about the layer normal, collapses to von Mises in the isotropic limit, and still drops a flat print loaded through the layers to SF ≈ 0.58 (evaluated in the rotated material frame for non-flat prints). The legacy Hill (1948) quadratic stays selectable for comparison. Optional, evidence-gated in-plane raster (cross-bead) anisotropy for unidirectional rasters
- **Two-region material model** (opt-in) — classifies each element geometrically into dense perimeter walls vs homogenized infill core (exact surface-distance field + per-element volume fractions) instead of one averaged material; the MATERIAL tab shows the wall band (wall count × line width) live, and results report how the geometric split diverges from the legacy global strength multiplier
- **Gibson-Ashby infill homogenization** — the infill core follows cellular-solid power laws in density (E ∝ ρ^1.75–2.0 by pattern family, not the naive linear scaling), with per-axis anisotropy: extruded-wall patterns (grid/lines/honeycomb) stay stiff along the build axis but soften as ρ²–ρ³ in-plane, while TPMS patterns (gyroid/cubic) degrade near-isotropically; exponents are confidence-labelled and calibration-overridable
- **Failure modes with individual confidence levels** — five bolt-region checks (bulk yield, net-section tension, shear-out, thread strip-out, bearing) plus a decomposed layer interface (interlayer tension / delamination onset and interlayer shear), and an optional wall-to-wall bead-bond check for multi-wall parts
- **Superconvergent Patch Recovery (SPR)** stress smoothing (Zienkiewicz & Zhu 1992) — more accurate nodal stresses than direct averaging
- **Deflected-shape visualization** — warp the mesh by the computed displacement field, with an exaggeration slider and animation; the stress heatmap follows the deformed surface
- **Modal analysis** (opt-in) — natural frequencies with animated mode shapes
- **Linear buckling** (opt-in) — Buckling Load Factor on the default C3D10 quadratic mesh (geometric stiffness for both C3D4 and C3D10), with an animated buckling mode
- **Section / cutting-plane view** — slice the part along X/Y/Z to inspect stress on internal and occluded surfaces
- **Body-force loads** — self-weight and robot-acceleration/impact (in multiples of g) using the infill-scaled mass, plus surface-pressure loads with a normal-to-surface option, a region selector (extreme face / all faces facing a direction / whole surface), and suction (negative pressure)
- **Fatigue life estimate** using modified Goodman + Basquin with FDM-specific endurance ratio (Se/UTS = 0.37) and a selectable load ratio R (pulsating / fully reversed / tension-biased)
- **Layer height correction** — accounts for −15% to +10% Z-property variation with layer height
- **Bead-penetration bond model** (opt-in) — predicts interlayer strength from process settings (nozzle temp, print speed, cooling fan, bed temp) via an anchored interface-cooling → neck-growth → healing chain, with a process-sensitivity dashboard and nozzle×speed bond-quality surface; normalized so typical settings reproduce the literature anchors
- **Coupon calibration** — tensile, Z-tension, lap-shear, and bearing coupons tune static allowables to your printer/filament (Z-tension and lap-shear calibrate the through-layer tension and interlaminar shear independently); cyclic and process sweeps additionally fit the fatigue S-N curve and the bond model
- **Onshape integration** — import directly from Part Studio via REST API, no export step
- **Client-side PDF export** — full report generated in-browser, works offline at competition venues
- **Automatic mesh convergence** — fine mesh runs in the background; you get a result and then it quietly improves
- **Accessible audio feedback** — per-stage tones for upload → mesh → solve → completion, with volume control and disable toggle. Especially useful in loud lab/competition environments. Enable/disable in the PREFS tab

---

## Differentiators vs. Standard FEA

| Feature | Conventional FEA | STORMFEA |
|---------|-----------------|----------|
| Material model | Isotropic (E, ν) | Transversely isotropic (5 constants) |
| Yield criterion | Von Mises | FDM dual criterion (bulk von Mises + interlayer interface; Hill legacy option) |
| Stress smoothing | Direct averaging | SPR (Zienkiewicz-Zhu 1992) |
| Failure modes | Bulk yield only | Bolt-region + interlayer modes, each with confidence levels |
| Mesh convergence | Manual | Automatic (fine mesh in background) |
| Layer height effect | Not modeled | −15% to +10% on Z-direction properties |
| Walls vs infill | One smeared material | Opt-in two-region model: solid perimeter shell + Gibson-Ashby lattice core, blended per element |
| FDM calibration | Not possible | Physical coupon calibration (tensile / Z-tension / lap-shear / bearing) |

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| TetGen | 1.5.x | Linux: `sudo apt-get install tetgen` · macOS: `brew install tetgen` · Windows: [GitHub release](https://github.com/emersonkeenan/tetgen1.5.1-beta1) — rename to `tetgen.exe`, place in project root |
| Gmsh | 4.x | `winget install Gmsh.Gmsh` (Windows) or [gmsh.info](https://gmsh.info) |

### Install & Run

```bash
git clone https://github.com/micahtstoll-ai/stormfea.git
cd stormfea
npm install
npm run build
```

**Windows:** double-click `start.bat` — it wires up PATH and opens the browser automatically.

**Other:**
```bash
npm start
# Open http://localhost:3000
```

> **Offline use:** the entire app runs with no internet connection after install. The 3-D viewer's Three.js runtime and all UI fonts are vendored locally under `client/vendor/` (no CDN or Google Fonts calls), and PDF export is fully client-side. Nothing is fetched from an external host at runtime.

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
    │  FEM Solver                       │
    │  buildC      orthotropic C matrix │
    │  assembleK   global K (CSR)       │
    │  applyBCs    penalty method       │
    │  PCG solve → u (displacement)     │
    │  SPR       → σ (nodal stress)     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │  Post-processing                  │
    │  dual criterion → safety factor   │
    │  bolt + interlayer failure modes  │
    │  Goodman fatigue estimate         │
    │  Print recommendations            │
    │  PDF report (client-side)         │
    └───────────────────────────────────┘
```

### Solver Stack

| Component | Implementation |
|-----------|---------------|
| Elements | C3D10 (quadratic tet, default) + C3D4 (linear tet, faster but shear-locking-prone for bending) |
| Constitutive matrix | Transversely isotropic, 5 constants |
| Global assembly | Compressed Sparse Row (CSR) |
| Boundary conditions | Dirichlet via penalty method |
| Linear solve | Preconditioned Conjugate Gradient (PCG) |
| Stress recovery | SPR (Zienkiewicz-Zhu 1992) |
| Failure criterion | FDM dual criterion (bulk von Mises + interlayer interface); Hill (1948) legacy option |

---

## Model Constants

All constants are cited to peer-reviewed literature and documented in the app's **Sources** tab.

| Constant | Value | Source |
|----------|-------|--------|
| E_z / E_xy (stiffness ratio) | 0.65 | Perez et al. 2021 |
| σ_yield,Z / σ_yield,XY | 0.58 ± 0.10† | Cojocaru et al. 2019 |
| G_xz / G_xy | 0.40 | Ahn et al. 2002 |
| ν_xz | 0.30 | Casavola et al. 2016 |
| Layer height slope | −1.0 ± 30%† /mm | Farashi & Vafaee 2022 |
| Se / UTS (endurance ratio) | 0.37 | Wang et al. 2020 |

† Central value is sourced to the cited paper. The uncertainty band (±0.10 on yield ratio; ±30% on layer-height slope) is an engineering margin applied for the conservative/optimistic SF range bar — it is not a value reported by those papers. See the app's **Sources** tab for detail.

---

## Calibration

The defaults are literature averages — good for a first pass, but your printer and filament will differ. For printer-specific accuracy:

1. Go to the **⊗ CALIBRATE** tab → download coupon STLs
2. Print with your target settings (walls, layer height, infill)
3. Pull to failure with a force gauge
4. Enter the measured loads → save profile
5. Run analysis with the calibrated profile active

The **lap shear coupon** directly measures inter-layer bond strength — the single most important variable in the model.

---

## Project Structure

```
stormfea/
├── server/
│   ├── index.ts          Express routes (upload, analyse, calibrate, Onshape)
│   ├── analysis.ts       FEM pipeline, failure modes, fatigue (~5,100 lines)
│   ├── twoRegion.ts      Two-region (shell/core) material field builder
│   ├── stl.ts            Binary/ASCII STL parser
│   ├── holes.ts          Cylindrical hole detection from STL geometry
│   ├── tetgen.ts         TetGen wrapper (STL → .node/.ele)
│   ├── gmsh_mesh.ts      Gmsh wrapper (STEP → .msh, curvature refinement)
│   ├── onshape.ts        Onshape REST API (HMAC auth, Part Studio STEP export)
│   ├── coupon_stl.ts     Calibration coupon STL generators
│   ├── coupon_fea.ts     FEA-in-the-loop Kt extraction
│   ├── demo_part.ts      Sample bracket for one-click judge demo
│   ├── report.ts         PDF report generation
│   └── solver/
│       ├── types.ts      Material interfaces + per-element material field
│       ├── element.ts    C3D4 + C3D10 elements, constitutive matrix, B matrix
│       ├── lattice.ts    Gibson-Ashby infill homogenization laws (per pattern family)
│       ├── laminate.ts   Classical Laminate Theory in-plane stiffness (opt-in CLT)
│       ├── distance.ts   Exact point-to-triangle surface distance field
│       ├── wallfrac.ts   Per-element wall-band volume fractions (marching tet)
│       ├── adjacency.ts  Node → element adjacency (O(1) lookups)
│       ├── assembly.ts   Global stiffness matrix assembly (CSR, parallel workers)
│       ├── assembly-worker.ts  Worker-thread element assembly
│       ├── boundary.ts   Dirichlet BCs (penalty method)
│       ├── load.ts       Neumann BCs (nodal forces)
│       ├── mass.ts       Mass matrix assembly (modal / self-weight)
│       ├── modal.ts      Natural-frequency eigensolver
│       ├── buckling.ts   Linear buckling (geometric stiffness) eigensolver
│       ├── cg.ts         Preconditioned Conjugate Gradient solver
│       ├── pipeline.ts   runLinearStatic() entry point
│       ├── meshgen.ts    Box-mesh fallback generators + surface extraction
│       ├── meshQuality.ts  Element quality metrics (Jacobian, aspect ratio)
│       ├── stress.ts     SPR recovery, FDM dual criterion (+ Hill legacy), nodal averaging
│       ├── bond.ts       Bead-penetration process→bond strength model
│       └── stress_detail.ts  Full stress tensor (σxx,σyy,σzz,τxy,τyz,τxz)
├── client/
│   └── index.html        Single-file frontend (vanilla JS + Three.js)
├── scripts/
│   ├── copy-client.mjs   Copies client to dist/ for Express serving
│   └── test_client_logic.mjs  Client-side logic validation
├── .github/
│   ├── workflows/
│   │   └── test.yml      CI: TypeScript compile + solver validation suite
│   └── ISSUE_TEMPLATE/   Bug report and feature request templates
├── docs/
│   ├── API.md            HTTP API reference (all endpoints)
│   ├── ARCHITECTURE.md   Contributor architecture map
│   └── METHODOLOGY.md    FEA theory & math
├── start.bat             Windows launcher (sets PATH, opens browser)
├── start-debug.bat       Windows launcher with verbose solver diagnostics
├── CONTRIBUTING.md       How to contribute
├── DESIGN.md             Frontend design system
├── ROADMAP.md            Development history
└── README.md             This file
```

### Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How a request flows from upload to heatmap; module-by-module map of `server/` and `server/solver/` |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | The FEA theory — constitutive model, elements, PCG solve, SPR, the FDM dual failure criterion, bond model, failure modes, calibration, validation |
| [docs/API.md](docs/API.md) | Every HTTP endpoint with request/response shapes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, ground rules, PR checklist |
| [DESIGN.md](DESIGN.md) | Frontend design system (typography, color, spacing) |
| [ROADMAP.md](ROADMAP.md) | Development history and known limitations |

---

## Known Limitations

- **Linear elastic only** — no plasticity or large deformation (the deflected-shape view is a scaled/exaggerated visualization of the linear solution, not a large-deformation result)
- **Surface pressure loads** use consistent tributary-area (lumped) nodal loading. A **normal-to-surface** option follows each triangle's own outward normal for curved/non-planar faces, and the load region is selectable — the extreme face toward a direction, every face *facing* that direction, or the entire exterior surface (hydrostatic). Honoured on the box-mesh fallback as well (which now carries surface connectivity).
- **Bearing failure confidence: LOW** — no FDM-specific bearing test data in literature
- **Fatigue confidence: LOW → MEDIUM** — literature S-N data is sparse (LOW by default), but a team can fit their own S-N curve from cyclic coupons (`POST /api/calibration/fatigue`, least-squares Basquin `b` + `Se/UTS`), which replaces the defaults and lifts the fatigue mode to MEDIUM; the load ratio R is selectable
- **Linear buckling confidence: LOW** — the eigenvalue itself is validated to <5% against closed-form Euler (test group 16), so the *computed* buckling load is high-confidence; the mode stays LOW only for the empirical ~10–40% FDM imperfection knockdown (reported as an imperfection-adjusted BLF, and already embedded in the verdict thresholds)
- **Upright/angled orientation** — modeled exactly (weak-axis tensor rotation) when a bed face is picked; without one, an upright print falls back to a conservative scalar-swap approximation
- **Infill homogenization exponents** — the Gibson-Ashby power-law FORM is literature-cited, but the specific per-pattern-family exponents are engineering estimates within the cited ranges (confidence LOW, regression-locked, overridable per calibration profile); pattern strength multipliers are likewise approximate, as pattern-ranking literature is inconsistent. A numerical-homogenization harness (`server/homogenize.ts`) computes a solver-derived degradation curve and is validated against classical isolated-hole theory (test group 26), but its first-order single-hole cell is concentration-dominated and does not yet reproduce a periodic wall network's exponent — so it does not lift these above LOW; a periodic square-void RVE (or physical coupons → HIGH) is the path to MEDIUM
- **Filament color** affects strength (η² = 97.3% in one study) — not modeled
- **Layer height correction** is a linear approximation; valid within ±0.15 mm of nominal
- **Element order** — both STL (TetGen `-o2`) and STEP (Gmsh) uploads default to quadratic C3D10 elements; TetGen's mid-node ordering permutation is verified empirically and pinned by a regression test (`server/tests/unit/tetgen-c3d10.test.ts`). Linear C3D4 is selectable in the MATERIAL tab for faster solves, but underpredicts bending stress by ~55% due to shear locking. The box-mesh fallback now honours the element-order selector too (C3D10 by default), so a TetGen-fallback run is no longer forced to C3D4.
- **Closely-spaced holes (STEP):** if Gmsh merges two hole surfaces the detected radius can be wrong. Overlapping hole detections are now flagged in the CONSTRAINTS panel so you can verify or redefine them; `start-debug.bat` still shows the `[gmsh-debug]` circle-fit lines for deeper inspection.

---

## Debugging

Run `start-debug.bat` instead of `start.bat` to enable verbose solver output. Watch the console while uploading a file or clicking **Analyse**.

**CG residual trends and what they mean:**

| Residual shape | Likely cause |
|----------------|-------------|
| Climbs immediately | Near-singular system — bolt constraints don't resist rigid-body rotation |
| Bounces up/down | Degenerate mesh element or material property issue |
| Shrinks slowly but steadily | Poorly conditioned system — try coarser mesh or simplify sharp geometry |

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Quick summary:

1. Fork → create a branch (`git checkout -b fix/my-fix`)
2. Make changes; if touching physics, verify the 65% stiffness / 58% bond constants are unchanged
3. Run `npm run test` — everything must pass: 430 vitest unit tests across 42 files, 117 solver validation tests in `solver_validation.ts`, the parallel-assembly equivalence suite, and 71 client logic checks (a few vitest tests self-skip where the TetGen/Gmsh binaries are absent, so the raw totals show a handful of skips)
4. Open a pull request using the provided template

---

## License

[MIT](LICENSE) — Nordic Storm FTC Team 5962, Saint Peter Area Robotics

---

<div align="center">

Built by **Micah Stoll** · Nordic Storm FTC 5962 · Saint Peter MN · BIOBUZZ 2026–2027

*If this tool helps your team build better robots, a ⭐ on GitHub goes a long way.*

</div>
