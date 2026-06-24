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

- **Transversely isotropic material model** — 5 independent elastic constants calibrated from peer-reviewed literature
- **Hill (1948) anisotropic yield criterion** — collapses to von Mises when the material is isotropic; correctly amplifies through-layer stresses when it's not
- **5 distinct failure modes** with individual confidence levels: bulk yield, net-section tension, shear-out, thread strip-out, bearing
- **Superconvergent Patch Recovery (SPR)** stress smoothing (Zienkiewicz & Zhu 1992) — more accurate nodal stresses than direct averaging
- **Fatigue life estimate** using modified Goodman with FDM-specific endurance ratio (Se/UTS = 0.37)
- **Layer height correction** — accounts for −15% to +10% Z-property variation with layer height
- **3-coupon calibration** — tensile, lap shear, and bearing coupons let you tune the model to your specific printer and filament
- **Onshape integration** — import directly from Part Studio via REST API, no export step
- **Client-side PDF export** — full report generated in-browser, works offline at competition venues
- **Automatic mesh convergence** — fine mesh runs in the background; you get a result and then it quietly improves

---

## Differentiators vs. Standard FEA

| Feature | Conventional FEA | STORMFEA |
|---------|-----------------|----------|
| Material model | Isotropic (E, ν) | Transversely isotropic (5 constants) |
| Yield criterion | Von Mises | Hill (1948) anisotropic |
| Stress smoothing | Direct averaging | SPR (Zienkiewicz-Zhu 1992) |
| Failure modes | Bulk yield only | 5 modes with confidence levels |
| Mesh convergence | Manual | Automatic (fine mesh in background) |
| Layer height effect | Not modeled | −15% to +10% on Z-direction properties |
| FDM calibration | Not possible | 3-coupon physical calibration |

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| TetGen | 1.5.1 | [GitHub release](https://github.com/emersonkeenan/tetgen1.5.1-beta1) — rename to `tetgen.exe`, place in project root |
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

> **Offline use:** the PDF export is fully client-side. No internet connection needed after install.

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
    │  Hill criterion → safety factor   │
    │  5 failure mode checks            │
    │  Goodman fatigue estimate         │
    │  Print recommendations            │
    │  PDF report (client-side)         │
    └───────────────────────────────────┘
```

### Solver Stack

| Component | Implementation |
|-----------|---------------|
| Elements | C3D4 (linear tet) + C3D10 (quadratic tet) |
| Constitutive matrix | Transversely isotropic, 5 constants |
| Global assembly | Compressed Sparse Row (CSR) |
| Boundary conditions | Dirichlet via penalty method |
| Linear solve | Preconditioned Conjugate Gradient (PCG) |
| Stress recovery | SPR (Zienkiewicz-Zhu 1992) |
| Yield criterion | Hill (1948) anisotropic quadratic form |

---

## Model Constants

All constants are cited to peer-reviewed literature and documented in the app's **Sources** tab.

| Constant | Value | Source |
|----------|-------|--------|
| E_z / E_xy (stiffness ratio) | 0.65 | Perez et al. 2021 |
| σ_yield,Z / σ_yield,XY | 0.58 | Cojocaru et al. 2019 |
| G_xz / G_xy | 0.40 | Ahn et al. 2002 |
| ν_xz | 0.30 | Casavola et al. 2016 |
| Layer height slope | −1.0 %/mm | Farashi & Vafaee 2022 |
| Se / UTS (endurance ratio) | 0.37 | Wang et al. 2020 |

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
│   ├── analysis.ts       FEM pipeline, failure modes, fatigue (2,147 lines)
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
│       ├── types.ts      Material interfaces (Isotropic, Orthotropic)
│       ├── element.ts    C3D4 + C3D10 elements, constitutive matrix, B matrix
│       ├── assembly.ts   Global stiffness matrix assembly (CSR)
│       ├── boundary.ts   Dirichlet BCs (penalty method)
│       ├── load.ts       Neumann BCs (nodal forces)
│       ├── cg.ts         Preconditioned Conjugate Gradient solver
│       ├── pipeline.ts   runLinearStatic() entry point
│       ├── stress.ts     SPR recovery, Hill criterion, nodal averaging
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
├── start.bat             Windows launcher (sets PATH, opens browser)
├── start-debug.bat       Windows launcher with verbose solver diagnostics
├── CONTRIBUTING.md       How to contribute
├── ROADMAP.md            Development history
└── README.md             This file
```

---

## Known Limitations

- **Linear elastic only** — no plasticity or large deformation
- **Bearing failure confidence: LOW** — no FDM-specific bearing test data in literature
- **Fatigue confidence: LOW** — sparse FDM S-N curve data; estimate only
- **Filament color** affects strength (η² = 97.3% in one study) — not modeled
- **Layer height correction** is a linear approximation; valid within ±0.15 mm of nominal
- **Closely-spaced holes (STEP):** if Gmsh merges two hole surfaces, detected radius can be wrong — use `start-debug.bat` and check `[gmsh-debug]` lines if hole geometry looks off

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
3. Run `npm run test` — all 32 solver validation tests must pass
4. Open a pull request using the provided template

---

## License

[MIT](LICENSE) — Nordic Storm FTC Team 5962, Saint Peter Area Robotics

---

<div align="center">

Built by **Micah Stoll** · Nordic Storm FTC 5962 · Saint Peter MN · BIOBUZZ 2026–2027

*If this tool helps your team build better robots, a ⭐ on GitHub goes a long way.*

</div>
