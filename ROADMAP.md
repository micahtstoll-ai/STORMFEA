# STORMFEA — Development Roadmap
## Nordic Storm FTC 5962 | Last updated: June 2026

---

## COMPLETED ✓

### Core Solver
- [x] C3D4 linear tetrahedral FEM, PCG solver with diagonal preconditioning
- [x] Transversely isotropic (orthotropic) constitutive matrix — 5 independent constants
- [x] Hill (1948) anisotropic yield criterion — single quadratic form in all six stress components, F/G/H/L/M/N coefficients derived from the two measured yield strengths; collapses exactly to von Mises in the isotropic limit (verified by the validation suite)
- [x] Superconvergent Patch Recovery (SPR) stress smoothing — Zienkiewicz & Zhu 1992
- [x] Patch test validated (σ_zz = 1.000000 MPa exactly)
- [x] Cantilever test within 2% of Euler-Bernoulli theory
- [x] Isotropic limit test — zero difference when E_z = E_xy
- [x] Positive definiteness check on C matrix before every solve
- [x] C3D10 second-order (10-node quadratic) tetrahedral elements — quadratic shape functions, B matrix, and assembly; 4-point Gauss integration with Gauss-point stress recovery. Reduces shear locking and resolves stress concentrations more accurately
- [x] Automated validation suite (`server/tests/solver_validation.ts`) — 97 tests across 8 groups: patch test, cantilever linearity, orthotropic isotropic-limit, SPR smoothing, C3D10 element properties, Hill criterion (von Mises collapse + directional yield), and FEA-in-the-loop calibration

### Geometry Pipeline
- [x] STL → TetGen → volume FEM
- [x] STEP → Gmsh (curvature-based refinement near holes) → volume FEM
- [x] Hole detection from STL (cylindrical face normal clustering)
- [x] Hole identification from STEP (exact CAD surfaces, no detection needed)
- [x] File name returned from upload response

### Print Settings Model
- [x] Orthotropic ratios from literature (E_z/E_xy=0.65, yieldZ/yieldXY=0.58)
- [x] Linear infill strength curve (monotonic — better supported than peak curve)
- [x] 9 infill pattern multipliers (conservative, confidence-labeled)
- [x] Orientation multipliers (0.55 flat, 0.90 upright) — well-supported
- [x] Wall count bonus (+10% per additional wall)
- [x] Layer height factor (Farashi & Vafaee 2022 meta-analysis, n=131)
- [x] All constants cited in Sources tab with confidence levels
- [x] Two-region material model (opt-in) — dense perimeter walls vs homogenized
      infill core, classified geometrically per element (exact surface-distance
      field + marching-tet volume fractions, 9 Voigt-blended bins) instead of a
      single averaged material; stiffness, strength, mass, self-weight, and
      utilization all follow the split. Validated: sandwich cantilever matches
      composite-EI theory to 0.3% (homogenized model ~23% too soft); Taguchi L9
      orthogonal-array main-effect checks over infill/walls/pattern/orientation
- [x] Two-region UI surfacing — live wall-band readout (wall count × line
      width) in the MATERIAL tab; results panel shows the implied vs legacy
      strength multiplier divergence with the relative delta
- [x] Gibson-Ashby core homogenization (Stage 1) — the two-region infill core
      now scales the solid material by per-pattern-family power laws
      (`solver/lattice.ts`: TPMS-like ρ^1.75 stiffness / ρ^1.25 strength,
      extruded-wall patterns ρ^2.0 / ρ^1.5, lightning ×0.3) instead of
      linearly in density; orientation no longer leaks into core stiffness;
      0%-infill no longer crashes (10⁻³ floor); exponents confidence-LOW,
      regression-locked (core-lattice.test.ts), calibration-overridable;
      results panel reports the core model + E_core/E_solid

### Failure Modes
- [x] Bulk yield — FEM Hill criterion (high confidence)
- [x] Net-section tension — classical Shigley formula (high confidence)
- [x] Shear-out — classical, layer-height-aware (medium confidence)
- [x] Thread strip-out — layer-interface penalty model (medium confidence)
- [x] Bearing (hole wall) — conservative estimate, flagged low confidence
- [x] All modes layer-height-aware
- [x] Bearing confidence raises to medium with calibrated profile

### Bolt & Hole Identification
- [x] Metric M2–M12 and inch #2-56 through 1/2-13
- [x] Clearance vs tapped detection (±0.2mm tolerance)
- [x] Non-standard, ambiguous, oversized warnings
- [x] Per-hole bolt type override dropdown in Constraints tab
- [x] Overrides saved to session and sent to analysis

### Mesh Convergence
- [x] Auto-convergence: standard mesh shown first, fine mesh in background
- [x] Auto-upgrade to fine mesh if >5% change in peak stress
- [x] Smart skip: SF > 3.0 skips fine mesh (clearly safe)
- [x] Convergence badge (✓ converged / ⬆ upgraded / ✓ skipped / ◇ unavailable)
- [x] Manual convergence study with Richardson extrapolation
- [x] Convergence cache — manual study reuses auto-check data

### Singularity Detection
- [x] Detects peak stress at geometric singularities (sharp corners)
- [x] Ratio-based: peak/1mm-neighborhood > 3× flags as likely singularity
- [x] Displayed prominently in results with fix recommendation

### Fatigue Analysis
- [x] Modified Goodman criterion + Basquin power law
- [x] Pulsating load assumed (R=0) — conservative for FTC
- [x] Endurance limit Se from base material UTS (not FDM-reduced yield)
- [x] Explicitly labeled LOW confidence with Wang et al. 2020 citation

### Topology Suggestions
- [x] Top 5% stress vertices clustered (3mm radius)
- [x] Context-aware suggestions: bottom face, top face, corner, edge, body
- [x] Each cluster gets distinct suggestion (non-duplicate)
- [x] Gold diamond markers in 3D viewer at each cluster location

### Calibration System
- [x] CALIBRATE tab with tensile/lap-shear/bearing coupon panels
- [x] Downloadable coupon STL files (server-generated, exact COUPON_DIMS)
- [x] Back-calculate material constants from failure loads
- [x] FEA-in-the-loop calibration (`coupon_fea.ts`) — extracts a stress-concentration factor Kt = peak/nominal by running the coupon through the production solver, so lap-shear and bearing allowables are peak-based and consistent with how real parts are evaluated (tensile stays nominal F/A by design). Documented ~5% noise floor from the fully-clamped BC
- [x] Save/load calibrated profiles to ~/.stressform_calibrations.json
- [x] Calibrated profiles override literature constants in solver
- [x] Calibration badge in results panel (green=calibrated, amber=literature)
- [x] Taguchi study guide document generated

### Session & Workflow
- [x] Session autosave every 5s to ~/.stressform_session.json (metadata only, no geometry)
- [x] Session restore: bolts, forces, print settings, calibration, hole overrides
- [x] 3D markers and arrows rebuilt on session restore
- [x] Session indicator in header (saved/unsaved/restored)
- [x] Re-upload prompt when session restored without geometry
- [x] A vs B design comparison — SF diff table, governing mode change detection
- [x] FTC load case library (6 presets)
- [x] Proper server-side HTML PDF report (/api/report endpoint)
- [x] Print-optimized CSS for browser PDF dialog

### Onshape Integration
- [x] REST API with HMAC-signed authentication
- [x] Parse Onshape document URL → did/wid/eid
- [x] Export Part Studio as STEP automatically
- [x] Parts list dropdown for multi-part Part Studios
- [x] Saves API key to ~/.stressform_onshape.json (chmod 600)
- [x] Status indicator (green=configured, gray=needs key)

### UI / UX
- [x] Nordic Storm 5962 branding — gold/dark, Rajdhani font
- [x] Dark/light mode toggle (persists via localStorage)
- [x] Startup tone + analysis completion/failure tones
- [x] ORIENTATION tab with ⊡ BED face picker
- [x] Face grouping — whole logical face highlights, not individual triangles
- [x] Snap-to-bed with layer line rings overlay
- [x] Bed plane grid correctly oriented via rotation matrix basis vectors
- [x] Force placement — click the mesh to set the application point, then set direction via the face dropdown (or a custom vector); magnitude with live lbf conversion
- [x] 200N/500N/1kN force presets
- [x] Live lbf conversion on force magnitude input
- [x] Results lead with action verdict (fail force + fix)
- [x] Peak stress pulsing red sphere marker on heatmap
- [x] Failure mode table with confidence labels, governing mode flagged
- [x] Hole identification panel in results
- [x] Print settings recommendations (5 ranked, layer height + wall count variants)
- [x] Orientation comparison table after solve
- [x] About screen in setup tab (differentiator statement + feature grid)
- [x] Live workflow rail — single source of truth for guidance and gating; shows each step's state (done / current / warn), explains what blocks analysis in place, flags an unset or flat orientation, and is click-to-navigate
- [x] Judge demo — one-click scenario loads a real part (the sample bracket if none is open) through the actual pipeline, auto-bolts the holes, and applies a varied-but-safe load, then the narrated tour runs the analysis over the populated part
- [x] SOURCES tab — full citation for every model constant
- [x] CALIBRATE tab with SVG coupon diagrams and ⬇ STL downloads
- [x] ⊗ CALIBRATE tab with Taguchi-ready save workflow

### Packaging & Documentation
- [x] Electron wrapper (Windows desktop app)
- [x] Finds tetgen.exe and gmsh.exe automatically (app dir + system PATH)
- [x] Startup binary check — probes TetGen and Gmsh at launch and prints a clear found/NOT-FOUND banner, so a missing mesher is loud at startup instead of silently degrading mid-analysis
- [x] Reliability gating — the verdict blocks on solver non-convergence (never reports "Safe" on an unconverged solve), and a mesh-fallback warning fires when TetGen fails and the part is analysed as a featureless box; both surface in the UI and the HTML report
- [x] start.bat launcher
- [x] README.md — full installation, architecture, key constants
- [x] Engineering Documentation (docx) — judge-facing, 10 sections, full references
- [x] User Manual (docx) — team-facing, quick start, troubleshooting
- [x] Taguchi Study Guide (docx) — calibration methodology, L9 array, analysis guide
- [x] Inline code comments throughout solver files
- [x] Module docblocks for element.ts, assembly.ts, cg.ts

### Advanced Analysis & Visualization
- [x] Deflected-shape view — warp the mesh by the displacement field, exaggeration
      slider + animation; stress heatmap follows the deformed surface
- [x] Modal analysis (opt-in) — natural frequencies + animated mode shapes
- [x] Linear buckling (opt-in) — BLF with C3D10 geometric stiffness, so buckling
      runs on the default quadratic mesh (not C3D4-only); animated buckling mode.
      Validated vs Euler column (C3D10 1.08% at 288 elems, `solver_validation` [16.5–16.8])
- [x] Section / cutting-plane view — X/Y/Z slice to inspect internal/occluded stress
- [x] Self-weight / acceleration body-force loads (multiples of g, infill-scaled mass);
      consistent-load resultant validated (`solver_validation` [21])
- [x] Surface pressure / traction loads — consistent tributary-area distribution;
      pressure patch test σ_zz = P (`solver_validation` [22])
- [x] STL mesh-quality control now honoured — coarse/standard/fine map to TetGen `-a`
- [x] Orthotropic directional-stiffness benchmark δ_z/δ_x = E_xy/E_z (`solver_validation` [23])

### Previously "next" — now shipped
- [x] Stress invariants — principal σ1/σ2/σ3 + signed von Mises heatmap modes with viewer toggle
- [x] Anisotropic damage indicator — per-vertex XY vs Z utilization (U_XY / U_Z view modes)
- [x] Material-property uncertainty bands — SF conservative/central/optimistic range bar
- [x] Non-uniform force distribution — cosine-bearing (distance-weighted) bolt loading
- [x] Hole-in-plate Kt benchmark — mesher-free structured plate-with-hole C3D10
      fixture (`buildPlateWithHoleMesh`) run through the production solver;
      peak/gross Kt ≈ 3.0 within 15% (`solver_validation` [24]). No longer
      blocked on a TetGen-meshable coupon hole.
- [x] True pressure normal-to-surface — per-triangle outward-normal traction
      option (`assembleSurfaceTractionNormal`); a "normal to surface" checkbox
      in the loads UI. Uniform-direction pressure remains the default.
- [x] Box-mesh fallback honours element order — a TetGen-fallback run now builds
      C3D10 (default) via `generateBoxMeshC3D10`, or a conforming C3D4 via
      `generateBoxMeshC3D4`, instead of being forced to linear C3D4. The fallback
      also carries real surface connectivity (`extractSurfaceFaces`), so surface
      pressure loads are honoured there.
- [x] Closely-spaced-hole detection — overlapping hole detections (the symptom of
      Gmsh merging two hole surfaces) are flagged in the CONSTRAINTS panel
      (`flagMergedHoleWarnings`).
- [x] Exact upright/angled orientation (issue #101) — when a bed face is picked,
      the orthotropic tensor is rotated (full 4th-order Bond transform,
      `rotateC6`/`rotationAligningZTo`) to align the weak axis with the bed
      normal, and Hill is evaluated in that frame. Replaces the scalar-swap
      approximation (kept as a conservative fallback when no bed is picked).
      Flat prints (weak axis +Z) are the identity, so all prior results are
      unchanged; validated in `bond-rotation.test.ts`.
- [x] Fatigue load ratio R — Goodman/Basquin now takes R = σ_min/σ_max
      (default 0). Surface pressure: normal-to-surface option + region selector
      (face/facing/all). Suction (negative) pressure allowed in the UI.

---

## IN PROGRESS / NEXT

- Section-view interior stress heatmap — color the cut face with real
  interpolated stress (design complete: volume payload on `/api/analyse`,
  client marching-tet slice over the stencil cap; carries per-node yield/region
  so two-region parts show region-correct interior stress)
- Deshpande–Fleck–Ashby core yield criterion — pressure-dependent yield for the
  cellular infill core (σ̂² = (σ_vm² + α²σ_m²)/(1+(α/3)²)); plugs into the
  per-bin yield hook in `recoverElementStress`; isotropic-DFA first, anisotropic
  honeycomb extension later
- Per-failure-mode yield selection — shell yield for bearing/thread checks on
  wall-lined holes (slicers line holes with perimeters)
- Anisotropic core homogenization (Stage 2) — per-axis Gibson-Ashby laws
  (extruded-wall patterns: rule-of-mixtures ρ^1.0 along the build axis,
  ρ^2–3 in-plane; per-axis columns already in `solver/lattice.ts`
  LATTICE_PARAMS) with true Voigt matrix blending of the per-bin C in
  `twoRegion.ts`

---

## DEFERRED (explicit decisions)
- Heat-set inserts — deferred until core tool stable
- 45° orientation recommendation — removed (warping/twist faults)
- Temperature/cooling speed effect — insufficient consistent data
- Multi-part assembly analysis — high complexity, low FTC value

## KNOWN LIMITATIONS (disclosed in app)
- Bearing failure: LOW confidence — no FDM-specific bearing data
- Pattern multipliers: approximate — inconsistent literature
- Layer height model: −15% to +10%, linear — interaction effects not captured
- Fatigue estimate: LOW confidence — sparse FDM S-N data
- Filament color: known to affect strength (η²=97.3%) — not modeled
- All tensile data is in-plane; pull-through failure mode is extrapolated

_Resolved: the TetGen box-mesh fallback previously always produced C3D4 (≈55%
bending underprediction) regardless of the element-order selector; it now honours
the selector (C3D10 by default) — see the shipped list above._
