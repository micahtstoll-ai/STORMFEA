# STORMFEA Architecture

A contributor's map of the codebase: how a request flows from an uploaded part to
a stress heatmap, and what each module is responsible for. For the physics and
math, see [`METHODOLOGY.md`](METHODOLOGY.md); for the HTTP surface, see
[`API.md`](API.md).

## High-level shape

STORMFEA is a **local-first** tool: a Node.js/TypeScript Express server plus a
single-file vanilla-JS client, both on one machine. There is no cloud component
and no database — user data lives in `~/.stressform_*.json` files. Meshing is
delegated to two external binaries (**TetGen** for STL, **Gmsh** for STEP).

```
┌─────────────────────────────────────────────┐
│ client/index.html  (Three.js viewer + UI)   │
│ client/solver.worker.js  (off-thread helper) │
└───────────────┬─────────────────────────────┘
                │  HTTP / JSON · localhost:3000
                ▼
┌─────────────────────────────────────────────┐
│ server/index.ts   (Express routes)          │
│   upload · analyse · calibrate · validate   │
│   session · report · onshape · demo         │
└───────────────┬─────────────────────────────┘
                │
        ┌───────▼────────┐   external procs
        │ meshers        │──► TetGen (STL → .node/.ele)
        │ tetgen/gmsh    │──► Gmsh   (STEP → .msh)
        └───────┬────────┘
                ▼
┌─────────────────────────────────────────────┐
│ server/analysis.ts  (orchestrator)          │
│   constraints · loads · failure modes ·     │
│   fatigue · recommendations                 │
└───────────────┬─────────────────────────────┘
                ▼
┌─────────────────────────────────────────────┐
│ server/solver/*  (the FEA kernel)           │
│   assemble K → apply BCs → PCG solve →       │
│   SPR stress recovery → Hill safety factor  │
└─────────────────────────────────────────────┘
```

## Request lifecycle (a linear-static analysis)

1. **Upload.** `POST /api/upload` → `server/stl.ts` parses STL (or
   `server/gmsh_mesh.ts` meshes STEP). `server/holes.ts` detects cylindrical
   holes. The client gets surface geometry + a hole list.
2. **User setup.** In the browser the user picks bolted holes, applies forces,
   and chooses material / infill / orientation / mesh quality.
3. **Analyse.** `POST /api/analyse` validates the body (`ANALYSE_SPEC`) and calls
   `runAnalysis()` in `server/analysis.ts`.
4. **Volume mesh.** `analysis.ts` invokes `server/tetgen.ts` (STL) or
   `server/gmsh_mesh.ts` (STEP) to produce a tetrahedral volume mesh. Default
   elements are **C3D10** (quadratic); **C3D4** (linear) is selectable. If TetGen
   fails, a structured box-mesh fallback runs — it honours the element-order
   selector (C3D10 by default) and carries surface connectivity, so pressure
   loads still apply.
5. **Constraints & loads.** `analysis.ts` selects constraint nodes around bolted
   holes and builds the load set (point forces, body force / gravity, surface
   pressure).
6. **Solve.** `server/solver/pipeline.ts` (`runLinearStatic` /
   `runLinearStaticWithK`) drives the kernel: assemble **K** → apply Dirichlet
   BCs → **PCG** solve for displacements **u**.
7. **Stress recovery.** `server/solver/stress.ts` recovers element stresses,
   smooths them with **SPR**, and computes the **Hill** anisotropic safety factor.
8. **Post-process.** `analysis.ts` runs the 5 bolt-region failure modes, the
   Goodman fatigue estimate, and print recommendations; optionally runs modal
   (`modal.ts`) and buckling (`buckling.ts`).
9. **Response.** Per-vertex stress/displacement fields (base64 Float32) + a
   summary go back to the client, which colors the mesh. `POST /api/report`
   renders an HTML report; PDF export happens client-side.

## Server modules (`server/`)

| Module | Responsibility |
|--------|----------------|
| `index.ts` | Express app, all ~29 routes, request validation, error envelope, startup binary probe |
| `analysis.ts` | The orchestrator (~3,500 lines): meshing calls, constraint/load setup, 5 failure modes, fatigue, recommendations, bolt database |
| `stl.ts` | Binary/ASCII STL parser |
| `holes.ts` | Cylindrical hole detection from STL geometry; overlapping/merged-hole warning (`flagMergedHoleWarnings`) |
| `tetgen.ts` | TetGen wrapper (STL → volume mesh), binary probe, C3D10 midnode ordering |
| `gmsh_mesh.ts` | Gmsh wrapper (STEP → mesh), surface/hole identification, curvature refinement |
| `onshape.ts` | Onshape REST client (HMAC signing, Part Studio STEP export) |
| `coupon_stl.ts` | Calibration coupon STL generators (tensile / lap-shear / bearing) |
| `coupon_fea.ts` | FEA-in-the-loop Kt extraction for coupons; structured plate-with-hole fixture (`buildPlateWithHoleMesh`) for the Kt ≈ 3.0 benchmark |
| `demo_part.ts` | Sample parts + archetype metadata for the judge demo |
| `report.ts` | HTML report generation |
| `validate.ts` | Request-body shape checker (`expect`/`Spec`, `ValidationError`) |
| `validation.ts` | Validation-scoreboard case derivation + aggregate stats |

## The FEA kernel (`server/solver/`)

Pure functions, no I/O, no global state — units are mm / N / MPa / tonne
throughout. Data flows left to right:

```
types → element → assembly (+ assembly-worker) → boundary → load → cg
      → stress / stress_detail → pipeline
```

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Mesh (`TetMesh`), material (isotropic / orthotropic / gyroid), and result interfaces; C3D10 node-ordering convention |
| `element.ts` | C3D4 + C3D10 element stiffness, B-matrix, constitutive matrix **C**, geometric stiffness; weak-axis tensor rotation (`rotateC6`, `rotationAligningZTo`, `rotateStress6ToLocal`) for the Bond-transform orientation model |
| `assembly.ts` | Global stiffness **K** in CSR (two-pass), sparsity pattern, matvec; parallel path via `assembly-worker.ts` |
| `boundary.ts` | Dirichlet BCs via the penalty method |
| `load.ts` | Force vector: point forces, equivalent nodal forces, body force, surface traction (uniform + per-triangle-normal), pressure-region selection (`selectPressureRegion`) |
| `cg.ts` | Preconditioned Conjugate Gradient solver (Jacobi + IC0 preconditioners), streaming residual callbacks |
| `stress.ts` | Element stress recovery, SPR smoothing, Hill criterion, node-averaged display stress, safety factor |
| `stress_detail.ts` | Full stress tensor (σxx,σyy,σzz,τxy,τyz,τxz) recovery |
| `pipeline.ts` | `runLinearStatic()` — the kernel entry point that sequences assemble → BC → solve → recover |
| `mass.ts` | Consistent mass matrix (C3D4/C3D10) for modal analysis |
| `modal.ts` | Modal eigensolver (subspace iteration, shift-invert) → natural frequencies + mode shapes |
| `buckling.ts` | Linear buckling: geometric stiffness + inverse power iteration → Buckling Load Factor |
| `laminate.ts` | Classical Laminate Theory bead/wall property contributions |
| `meshgen.ts` | Box/fallback mesh generation (C3D4 + C3D10, conforming), boundary-face extraction (`extractSurfaceFaces`) so the fallback carries surface connectivity |
| `meshQuality.ts` | Element quality metrics |
| `adjacency.ts` | Node–element adjacency (used by SPR patches and constraint selection) |

## The client (`client/`)

- **`index.html`** — the entire frontend in one file (~12,000 lines, ~600
  functions): the Three.js scene, the tabbed UI, form handling, the stress
  heatmap (vertex welding + Gouraud shading — see the "Heatmap Rendering" notes in
  [`CLAUDE.md`](../CLAUDE.md)), the deflected-shape/section/A-B views, and the
  ~100-line client-side PDF generator.
- **`solver.worker.js`** — off-main-thread helper so heavy client-side work
  doesn't block the UI.
- **`vendor/`** — bundled `three.min.js` and WOFF2 fonts. Everything is vendored
  locally: **no CDN or Google Fonts calls at runtime**, so the app is fully
  offline-capable after install.

## Build, run, test

- **Build:** `npm run build` → `tsc` compiles `server/` to `dist/`, then
  `scripts/copy-client.mjs` copies the client into `dist/`.
- **Run:** `npm start` (`node dist/index.js`) serves on `:3000`. On Windows,
  `start.bat` wires PATH and opens the browser.
- **Test:** `npm run test` runs Vitest units → `tsc` typecheck → the compiled
  solver-validation suite → the parallel-assembly equivalence check → the
  client-logic checks (`scripts/test_client_logic.mjs`). See
  [`METHODOLOGY.md`](METHODOLOGY.md#9-validation) for what the solver suite proves.
- **CI:** `.github/workflows/test.yml` runs `npm ci` → build → the full suite on
  every push/PR.

## External dependencies

Runtime deps are deliberately minimal — `express`, `cors`, `multer`. The two
meshers (**TetGen**, **Gmsh**) are external binaries that must be on `PATH`; the
server probes for them at startup and fails fast with an install hint if a part
needs one that is missing (unit tests self-skip when the binaries are absent).
