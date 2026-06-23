# StressForm — FDM-Aware FEA for FTC 3D Printed Parts

**Nordic Storm FTC Team 5962 · Saint Peter Area Robotics · St. Peter, MN**  
*BIOBUZZ Season 2026–2027*

---

## What It Does

StressForm is a finite element analysis tool purpose-built for FDM 3D printed parts. Unlike every existing FEA tool, it models the **anisotropic mechanical behavior** of FDM material — the fact that through-layer direction is only ~65% as stiff as in-layer, and inter-layer bond strength is ~58% of in-plane yield.

For FTC bracket design, this means:
- A flat-printed bracket predicted "safe" by conventional FEA may fail at 55% of the predicted load
- StressForm correctly identifies **which direction** and **which failure mode** governs
- Results include fatigue life estimates for cyclic loading (FTC mechanisms cycle hundreds of times per match)

---

## Differentiators vs Standard FEA

| Feature | Conventional FEA | StressForm |
|---------|-----------------|------------|
| Material model | Isotropic (E, ν) | Transversely isotropic (5 constants) |
| Yield criterion | Von Mises | Hill (1948) anisotropic criterion |
| Stress smoothing | Direct averaging | SPR (Zienkiewicz-Zhu 1992) |
| Failure modes | Bulk yield only | 5 modes with confidence levels |
| Mesh convergence | Manual | Automatic (fine mesh in background) |
| Layer height effect | Not modeled | −15% to +10% on Z-direction properties |
| FDM calibration | Not possible | 3-coupon physical calibration |

---

## Requirements

- **Node.js** v20 or higher
- **TetGen** 1.5.1 — for STL meshing  
  Download: https://github.com/emersonkeenan/tetgen1.5.1-beta1  
  Rename to `tetgen.exe` and place in `stressform-local/`
- **Gmsh** 4.x — for STEP meshing (required for Onshape integration)  
  Install: `winget install Gmsh.Gmsh` (Windows)  
  Or download from https://gmsh.info
- **Puppeteer** (installed automatically via `npm install`) — bundles its own
  headless Chromium, used to render the PDF report. See "PDF export" below
  if `npm install` fails on a restricted network.

---

## Installation

```bash
# Clone or extract the project
cd stressform-local

# Install dependencies
npm install

# Add TetGen and Gmsh to PATH (Windows)
$env:PATH += ";$PWD"  # PowerShell
# or use start.bat which does this automatically
```

---

## PDF export

Clicking "Export PDF" (or the PDF button in the Results panel) builds a real
`.pdf` file entirely in the browser — no server round-trip, no Chromium, no
internet connection required. It works the same whether you're online or
completely offline at a competition venue.

(Earlier versions of this app used Puppeteer + headless Chromium to render
the PDF server-side. That dependency was removed — its ~150MB Chromium
download reliably failed on locked-down school networks and even on a
fresh Windows install with normal internet, which made `npm install` itself
fail for a feature that's now fully client-side anyway.)

---

## Debugging a solver that won't converge

If an analysis fails with "Mesh generation failed" / a PCG timeout error, or
just sits on "Solving..." for a long time, run `start-debug.bat` instead
of the normal `start.bat`. It's identical except it prints extra diagnostic
output to the console window — watch that window while you upload a file or
click Analyse.

**CG solver residual trend** — printed at increasing iteration checkpoints.
The shape tells you what's actually wrong:

- **Climbing immediately** (residual grows from iteration 1) → the system is
  likely singular or near-singular. Check whether your bolt constraints
  actually restrain the part against rigid-body rotation — two bolts close
  together or in a line provide little resistance to rotating about that
  line, especially if an applied force is far off to one side.
- **Bouncing around** (residual goes up and down without a clear trend) →
  often a sign of a bad/degenerate element in the mesh, or a material
  property issue. Try a coarser mesh quality setting to see if the problem
  disappears (if it does, the issue is likely in the specific finer-mesh
  element geometry).
- **Shrinking steadily but too slowly** (residual decreases every checkpoint,
  just not fast enough to finish in 90 seconds) → the system is solvable but
  poorly conditioned. A coarser mesh or simplifying the geometry near sharp
  features usually resolves this.

**Gmsh surface classification** — printed for every detected surface on a
STEP file upload: node count, bounding box, circle-fit stats (centroid,
mean radius, std deviation), angular coverage, and the final classification
(`hole_wall` / `outer_edge` / `top_face` / `bottom_face` / `unknown`). Use
this if a detected hole's position or radius looks wrong — for example, if
the app reports a much larger hole diameter than the part actually has, this
log shows exactly which raw surface produced that number and why it passed
(or should have failed) the cylindrical-fit check, which is the fastest way
to tell whether two separate holes got merged under one surface tag.

---

## Running

```bash
cd stressform-local
npm start
# Open http://localhost:3000
```

Or double-click `start.bat` on Windows — it adds the binaries to PATH and opens the browser.

---

## Building the Electron Desktop App

```bash
cd stressform-electron
npm install

# Build (Windows)
.\node_modules\.bin\electron-packager.cmd . StressForm ^
  --platform=win32 --arch=x64 --out=release --overwrite ^
  --extra-resource=..\stressform-local\dist ^
  --extra-resource=..\stressform-local\client ^
  --extra-resource=..\stressform-local\node_modules ^
  --icon=assets\icon.ico
```

Output: `stressform-electron\release\StressForm-win32-x64\StressForm.exe`

---

## Project Structure

```
stressform-local/
├── server/
│   ├── index.ts          Express server — routes for upload, analyse, calibration, Onshape
│   ├── analysis.ts       Main analysis pipeline — FEM solve, failure modes, fatigue
│   ├── stl.ts            Binary/ASCII STL parser
│   ├── holes.ts          Cylindrical hole detection from STL geometry
│   ├── tetgen.ts         TetGen binary wrapper (STL → .node/.ele)
│   ├── gmsh_mesh.ts      Gmsh wrapper (STEP → .msh, curvature refinement near holes)
│   ├── onshape.ts        Onshape REST API — HMAC auth, Part Studio STEP export
│   ├── coupon_stl.ts     Calibration coupon STL generators
│   ├── coupon_fea.ts     FEA-in-the-loop Kt extraction for calibration
│   ├── demo_part.ts      Sample bracket STL for the one-click judge demo
│   └── solver/
│       ├── types.ts      Material interfaces (Isotropic, Orthotropic, AnyMaterial)
│       ├── element.ts    C3D4 + C3D10 elements — constitutive matrix, B matrix, Ke
│       ├── assembly.ts   Global stiffness matrix assembly (CSR format)
│       ├── boundary.ts   Dirichlet boundary conditions (penalty method)
│       ├── load.ts       Neumann boundary conditions (nodal forces)
│       ├── cg.ts         Preconditioned Conjugate Gradient solver
│       ├── pipeline.ts   runLinearStatic() — top-level solver entry point
│       ├── stress.ts     SPR stress recovery, Hill criterion, nodal averaging
│       └── stress_detail.ts  Full stress tensor recovery (σxx,σyy,σzz,τxy,τyz,τxz)
├── client/
│   └── index.html        Single-file frontend (~5,300 lines, vanilla JS + Three.js)
├── ROADMAP.md            Development history and future plans
└── README.md             This file

stressform-electron/
├── electron/
│   └── main.js           Electron main process — launches server, opens BrowserWindow
└── package.json
```

---

## Architecture Overview

```
Browser (Three.js UI)
        ↕ HTTP (port 3000)
Express Server (Node.js)
        ↕
   ┌────────────────────────────────────┐
   │  Upload pipeline                   │
   │  STL → TetGen → TetMesh            │
   │  STEP → Gmsh → TetMesh + holes    │
   └──────────────┬─────────────────────┘
                  ↓
   ┌────────────────────────────────────┐
   │  FEM Solver                        │
   │  buildC (orthotropic)              │
   │  assembleK (CSR)                   │
   │  applyBCs (penalty)                │
   │  PCG solve → u (displacement)      │
   │  SPR → σ (nodal stress)            │
   └──────────────┬─────────────────────┘
                  ↓
   ┌────────────────────────────────────┐
   │  Post-processing                   │
   │  Hill criterion → SF               │
   │  5 failure mode checks             │
   │  Singularity detection             │
   │  Topology suggestions              │
   │  Goodman fatigue estimate          │
   │  Print recommendations             │
   └────────────────────────────────────┘
```

---

## Key Model Constants

| Constant | Value | Source |
|----------|-------|--------|
| E_z / E_xy | 0.65 | Perez et al. 2021 |
| yieldZ / yieldXY | 0.58 | Cojocaru et al. 2019 |
| G_xz / G_xy | 0.40 | Ahn et al. 2002 |
| ν_xz | 0.30 | Casavola et al. 2016 |
| Layer height slope | −1.0/mm | Farashi & Vafaee 2022 |
| Se/UTS (flat) | 0.37 | Wang et al. 2020 |

All constants documented with full citations in the app's Sources tab.

---

## Calibration

The default constants are literature averages. For printer-specific calibration:

1. Download coupon STLs from the ⊗ CALIBRATE tab
2. Print with your target settings
3. Pull to failure with a force gauge
4. Enter loads → save profile
5. Run analysis with calibrated profile active

The lap shear coupon directly measures your printer's inter-layer bond strength — the most important unknown in the model.

---

## Known Limitations

- Linear elastic only — no plasticity or large deformation
- Bearing failure confidence: LOW (no FDM-specific bearing data)
- Fatigue estimate: LOW confidence (sparse FDM S-N curve data)
- Filament color affects strength (η²=97.3%) — not modeled
- Layer height effect: −15% to +10% range, linear approximation only
- Rigid-body-mode detection (warns when bolt constraints don't resist a
  rotation your applied load is driving) is uncalibrated against real
  failure data and has been checked against one real non-convergence case
  without confirming it as the cause — see "Hole radius detection" below,
  which turned out to be the actual issue in that case.
- **Hole radius detection for closely-spaced holes (STEP files)**: if two
  bolt holes are close enough together that Gmsh assigns their wall
  surfaces the same surface tag, the computed hole centre and radius can be
  badly wrong (observed: reported ~7mm radius for an actual 1.5mm-radius
  hole). A defensive fix (splitting merged surfaces by spatial clustering)
  is in place but unverified against the real Gmsh output that caused this —
  if hole positions/radii look implausible after upload, run
  `start-debug.bat` and check the `[gmsh-debug]` lines for the actual
  surface-by-surface classification.

---

## Built By

Micah Stoll · Nordic Storm FTC 5962 · Saint Peter Area Robotics · St. Peter, MN  
BIOBUZZ Season 2026–2027
