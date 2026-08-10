# STORMFEA — Development Roadmap
## Nordic Storm FTC 5962 | Last updated: August 2026

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
- [x] Automated validation suite (`server/tests/solver_validation.ts`) — 180 tests
      across 32 groups: patch test, cantilever linearity, orthotropic
      isotropic-limit, SPR smoothing (incl. boundary-patch conditioning), C3D10
      element properties and quadrature, the FDM/Hill criteria, energy-norm ZZ
      error estimation with a manufactured-solution effectivity index, Kirsch and
      Lekhnitskii open-hole anchors, and FEA-in-the-loop calibration. Counts on
      every user-facing surface are CI-asserted against the suite as it actually
      ran (`scripts/check-doc-test-counts.mjs`), so they cannot go stale silently

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
- [x] Anisotropic core homogenization (Stage 2) — per-axis Gibson-Ashby laws
      in the natural material frame (`buildCoreMaterial`): extruded-wall
      patterns are rule-of-mixtures ρ^1.0 along the build axis but ρ^2 in
      plane and ρ^3 in in-plane shear (anisotropy INVERTS at low density,
      with a symmetric Poisson guard keeping every bin positive definite);
      TPMS keeps the locked per-axis gyroid laws; upright-no-bed scaling
      happens before the scalar swap; `twoRegion.ts` bins are now true Voigt
      blends of the rotated endpoint C matrices

### Failure Modes
- [x] Bulk yield — FEM FDM dual criterion (bulk von Mises + interlayer interface;
      Hill legacy option), high confidence — see the layer-model overhaul below
- [x] Net-section tension — classical Shigley formula (high confidence)
- [x] Shear-out — classical, layer-height-aware (medium confidence)
- [x] Thread strip-out — layer-interface penalty model (medium confidence)
- [x] Bearing (hole wall) — conservative estimate, flagged low confidence
- [x] All modes layer-height-aware
- [x] Bearing confidence raises to medium with calibrated profile
- [x] Fatigue (Goodman/Basquin) — low confidence; raises to medium with a fitted
      cyclic-coupon S-N profile (`POST /api/calibration/fatigue`)
- [x] Linear buckling — eigenvalue validated to <5% vs closed-form Euler
      (solver_validation group 16); stays low overall pending an empirical FDM
      imperfection knockdown

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
- [x] Convergence badge (✓ converged / upgraded / ✓ skipped / unavailable)
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
- [x] CALIBRATE tab with SVG coupon diagrams and STL downloads
- [x] CALIBRATE tab with Taguchi-ready save workflow

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
- [x] Section-view interior stress heatmap (issue #190) — opt-in volumetric
      payload on `/api/analyse` (`analysis.includeVolumeField`, off by default
      to keep ordinary responses light) carries analysis-mesh node positions,
      corner-tet connectivity, and per-node stress/utilization arrays. The
      client marching-tetrahedra slices whichever tets the section/clip plane
      cuts (`sliceTetsByAxisPlane`) and renders the cut face with the SAME
      color scale (gamma, legend, threshold filter) as the exterior heatmap,
      replacing the flat grey "cut material" cap. Scoped limitation: built
      from the analysis mesh's corner nodes only, so a C3D10 mesh's mid-side
      curvature is not reflected in the cut geometry — exact for C3D4,
      first-order-per-tet-corner for C3D10.

### Layer-model overhaul (audit + decoupled interlayer failure + bond model)
- [x] Layer-model audit (docs/layer-model-audit.md) — six findings: azimuth-
      dependent Hill form (A1), silent SF=999 clamp for Z<Y/2 (A2), tension/
      compression-symmetric bond failure (A3), orientation-multiplier double
      count (A4), lap-shear→yieldZ coupling (A5), no bead-penetration physics (A6)
- [x] A4 fix — orientation removed from the solved material's strength
      multiplier (the criterion resolves direction via weakAxis); sole
      remaining scalar is the angled-no-bed 0.75 conservative fallback
- [x] FDM dual criterion (default) — bulk (bead) von Mises + interlayer
      interface (⟨σzz⟩₊/S_zt)²+(τ_z/S_zs)²≤1 with Mohr–Coulomb friction under
      compression; azimuth-invariant; preserves the Hill uniaxial anchors
      (flat-print false-safety SF≈0.58 unchanged); hill-legacy kept as a
      comparison flag and for the upright-no-bed swap fallback
- [x] Independent interlaminar shear allowable S_zs (yieldZShear) through the
      material types, two-region bins, utilization heatmap, and analytic
      shear-out/thread checks; lap-shear coupon now calibrates S_zs directly
- [x] Z-tension coupon (dog-bone printed standing) — measures yieldZ/S_zt
      directly; delamination row LOW→MEDIUM when run
- [x] Interlayer failure-mode rows — "Interlayer tension (delamination
      onset)" and "Interlayer shear" decomposed from the FEM field
- [x] Bead-penetration bond model (server/solver/bond.ts) — interface
      temperature history (lumped capacitance) → Arrhenius bond potential →
      neck growth × healing (Φ^¾); relative to reference settings, anchored
      so legacy results are unchanged at typical settings; process inputs
      (nozzle/speed/fan/bed) in the MATERIAL tab + G-code auto-fill; fitted
      per printer via POST /api/calibration/bond-sweep (CALIBRATE tab panel);
      constants confidence-LOW, regression-locked (bond.test.ts)
- [x] Bond void/consolidation factor (server/solver/bond.ts) — cold-deposition
      interbead porosity: strength cut below the reference interface temperature,
      exactly 1.0 at reference (bit-identical), reinforces cold⇒weaker so no
      locked trend flips; fittable voidSensitivity coeff (bond.test.ts)
- [x] Layer-by-layer delamination risk profile + interface-aware DFM +
      coupon-recommendation engine (analysis.ts) — surface WHICH layers are at
      risk, what to reorient/add, and which coupon most improves confidence
- [x] Process-sensitivity dashboard + bond-quality surface (POST
      /api/bond-sensitivity) — how nozzle/speed/fan/layer-height move the bond
      margin, and a nozzle×speed sweet-spot map (BOND SENSITIVITY panel)
- [x] In-plane raster (bead-to-bead) anisotropy (audit A7) — opt-in, evidence-
      gated cross-bead check on the BULK term; interface azimuth invariance
      preserved; bit-identical off/no-evidence (in-plane-anisotropy.test.ts)

### Solver-accuracy campaign (69 issues, shipped July 2026)

A single reviewed integration (issues #136–#205, minus #149) auditing the solver
end to end. Suite after landing: 677 vitest unit tests across 66 files, 180
solver-validation tests, parallel-assembly equivalence, 141 client-logic checks,
plus three CI drift gates (doc test counts, API routes, invariant symbols).

**Headline defect** — Gmsh's C3D10 midside node ordering was swapped, making
every STEP-file element self-intersecting (mixed-sign Jacobian, ~0 mm³ isoparametric
volume). Post-fix the isoparametric volume matches CAD exactly, and BOTH mesher
paths now run a runtime midside self-check instead of trusting the binary (#167).

- [x] Element formulation — C3D10 surface traction is now the correct quadratic
      consistent load (was lumping A/3 onto corners, exactly inverted: midsides
      got zero) (#137); C3D10 mass integrates isoparametrically like stiffness
      rather than assuming an affine element, with its own higher-order rule
      (#158); geometric stiffness keeps the linear stress gradient that drives
      bending buckling instead of one element-constant stress (#164); an opt-in
      higher-order Gauss rule for curved elements, with the affine-exact case
      documented and locked (#163); tangled/inverted curved elements are
      detected rather than silently integrated through |detJ| (#162)
- [x] Boundary conditions, reactions & solver hygiene — true support reactions
      are recovered from pristine pre-BC rows (they previously collapsed to ~0
      through the penalty-modified K) (#136); Dirichlet handling gained
      `row-penalty` and exact `elimination` schemes, with the static pipeline on
      elimination, replacing the single global-max penalty that degraded CG
      conditioning on soft-region DOFs (#154); the modal path shares that exact
      elimination instead of its own inconsistent penalty (#155); CG re-checks
      the recurrence residual against the true residual and the iteration cap is
      no longer warn-only (#153)
- [x] Eigenproblems — buckling moved to block subspace (Rayleigh–Ritz) inverse
      iteration, so the smallest positive BLF is guaranteed rather than hoped for
      from power iteration plus a single deflation (#138); modal gained a Sturm
      missed-mode check, eigenvector convergence, and scaled shifts (#160);
      participation factors cover all three directions with effective modal mass,
      instead of X-only (#161); `assembleMass` no longer silently substitutes PLA
      density for a material without `massRho` (#159)
- [x] Error estimation & convergence — the ZZ estimator is a real volume-weighted
      energy norm over the full stress tensor with shape-function interpolation
      (it was an unweighted L2 norm of scalar von Mises differences, with the
      material factor cancelling out) (#143, #144, #145), locked by a
      manufactured-solution effectivity index (#150); Richardson reports the
      observed order p_obs from the three mesh points instead of hardcoding p=2
      (#146); the convergence study consults the singularity warning rather than
      chasing a quantity that diverges (#147); singularity detection is
      scale-relative, not a hardcoded 1 mm neighborhood (#148); SPR
      boundary-patch conditioning is characterized with a boundary known-answer
      test — exactly where FDM stress peaks live (#156); `globalRelativeError`
      now actually reaches the user, with η explained (#151, #202)
- [x] Mesh & geometry robustness — mesh quality is scale- and unit-invariant
      (the Jacobian metric was a raw mm³ triple product judged against an
      absolute threshold) (#165); sliver elements are gated as the real accuracy
      killers rather than warned about (#166); the TetGen path no longer bakes in
      millimetre assumptions for weld precision and default element volume
      (#168); Gmsh top/bottom face detection and hole detection are relative to
      part scale, so origin-centered, thin, or out-of-window parts stop
      misclassifying faces and dropping bolt surfaces (#169, #170)
- [x] Two-region & material model — the three conflicting infill→stiffness laws
      (CLT linear-ρ vs 0.30-intercept scalar vs Gibson-Ashby ρ^n, differing 2–5×
      at 20% infill) are unified (#176); core strength knockdown is per-axis like
      core stiffness, so the model can no longer claim Z-stiffer and Z-weaker at
      once (#177); wall-fraction quantization no longer lets a 0.01 change flip a
      transition element ~100× (#178); `latticeStrengthFraction` no longer
      hard-clips with a slope discontinuity at ρ≈0.94 (#183); wall-band volume
      fractions use the C3D10 midside distances that were computed and discarded,
      catching bands that enter an element without reaching a corner (#180);
      solid-skin (top/bottom) classification gained its own thickness and a
      cone-angle face test (#181); wall-loop perimeter excludes internal hole
      bores (#182); material tables are key-checked, so orphan entries and
      silent PLA-bond fallbacks are gone (#186); the upright scalar swap's
      Poisson-ratio inconsistency is resolved and documented (#187)
- [x] Deshpande–Fleck–Ashby core yield (#171) — pressure-dependent yield for the
      cellular infill core, σ̂² = (σ_vm² + α²σ_m²)/(1+(α/3)²) with α(ρ) =
      2.08·(1−ρ) (`solver/lattice.ts`), blended per bin core-fraction-weighted so
      pure-shell bins are von Mises. α(1) = 0 exactly, so solid parts and every
      non-core element are bit-identical to the pre-DFA path; uniaxial yield is
      preserved at yieldXY for any α. Exponents LOW confidence, locked by
      `dfa-core-yield.test.ts`
- [x] Per-failure-mode yield selection (#175) — bearing and thread strip-out on
      wall-lined holes use the SHELL allowables (slicers line holes with
      perimeters), not the blended average material; a 20%-infill wall-lined hole
      now matches the 100%-infill part at equal wall count
      (`per-failure-mode-yield.test.ts`)
- [x] Bond & calibration honesty — the bond model's fan reference is per-material
      instead of anchoring every material to 100% fan, which skewed exactly the
      fan-sensitive ones (ABS/ASA) (#184); wall-to-wall bond stopped passing
      `lineWidth` into the `layerHeightMm` slot under a clamp derived for other
      geometry (#185); calibration fits gate on residuals, so a bad ≥3-point
      sweep no longer lifts confidence LOW→MEDIUM (#179); the bearing and
      lap-shear Kt fixtures are real stress concentrators — a plate-with-hole and
      an overlap-end peak — instead of hole-less boxes in uniform shear that made
      the "peak-based" correction a no-op (#139, #140)
- [x] Uncertainty & fatigue — the SF band now widens for the Gibson-Ashby
      exponent uncertainty on low-infill two-region parts (#173) and for the
      bond model's LOW-confidence constants when the process path is active
      (#172), instead of being falsely tight exactly where the model is weakest;
      interlayer fatigue is checked separately from bulk fatigue, since the
      dominant FDM cyclic failure mode is at the interface (#174)
- [x] Validation & traceability — a Lekhnitskii orthotropic open-hole
      known-answer benchmark, the first anisotropic analytic anchor in a suite
      that was otherwise entirely isotropic (#188); a per-analysis validation
      coverage map (`validation-coverage.ts`) that reports which suites cover the
      configuration you actually ran, states axis values with NO direct coverage
      plainly, and flags known combination gaps (#191); `docs/INVARIANTS.md`, the
      resolved index from each CLAUDE.md invariant to its implementing symbol and
      locking test, including an honest list of partial-coverage gaps (#192);
      `distance.ts` gained its first dedicated tests (#195)
- [x] Verdict, reporting & docs — one shared `ACCEPTABLE_SF_THRESHOLD = 1.5`
      constant, ending the disagreement between a green "Safe" verdict, a
      "recommended minimum 2×" caption, and a report that ambered 1–2× (#141);
      the stress legend maps color→stress through the same γ=0.55 warp as the
      model, which had been over-reading mid-legend stress ~1.8× (#142); choosing
      C3D4 now warns about its documented ~55% bending underprediction (#189);
      the "will fail at X N" headline is captioned as a linear first-yield
      extrapolation (#204); the printed report carries every reliability caveat
      the app shows — non-convergence, mesh fallback, degraded two-region,
      rigid-body (#196); `/api/methodology` describes the FDM dual criterion it
      actually uses (#197); methodology numeric and material tables are generated
      from the constants (#199); fatigue and the cross-bead ratio gained SOURCES
      entries (#200, #205); `docs/API.md` covers every live route with a CI drift
      check (#201); face-pressure selection scales its proximity band so coarse
      meshes cannot silently select zero triangles and apply no load (#157)

### Adaptive mesh refinement (issue #149, the campaign's one deferral — shipped)
- [x] Error-driven adaptive refinement loop (`server/solver/adaptiveMesh.ts`,
      `runAdaptiveAnalysis` in `analysis.ts`) — solve, ZZ error estimate, build a
      regional size field concentrating elements where the error indicator is
      worst, re-mesh with TetGen sizing, re-solve; reports the BEST (lowest
      global-error) iteration, not the last. Defaults: 3% target global relative
      error, at most 4 solves, hard cap 8× the base element count, stop when a
      step improves error by <5%. Refinement-only (never coarsens), and one step
      never shrinks an element below ~1/3 its size. A detected singularity gets a
      2 mm exclusion ball — refining a true singularity never converges (#147).
      OPT-IN: default false is bit-identical to the legacy single solve
      (`adaptive-default-identical.test.ts`), and it degrades cleanly with a
      stated reason on the STEP/Gmsh path, the box-mesh fallback, and a missing
      TetGen binary
- [x] The deferral's root cause, fixed — the earlier TetGen regional sizing
      attempt COARSENED instead of refining because of two undocumented TetGen
      behaviours, both re-verified empirically against tetgen 1.5.0: `-Y`
      (preserve input surface triangulation) forbids Steiner points on facets and
      segments, so sizes near a surface are simply unreachable — dropping it took
      the reference case from 12 to 314 elements; and the `.b.mtr` metric is only
      read alongside `-q`, so the old `-pmYQ` "sizing only" fallback silently
      emitted the minimal tetrahedralisation. The switch chain is now
      `-pmq1.4Q` → `-pmq2.0Q` → `-pq1.4Q` → `-pQ`, abandoning the size field only
      after two genuine sized attempts. Dropping `-Y` does not cost the O(1)
      surface-to-volume node map, which is locked by its own round-trip test
- [x] Degradation contract enforced on the RE-SOLVE, not just the re-mesh — the
      loop guarded `meshWithTetGenSizing` but left the solve on the refined mesh
      unguarded, so a mesh TetGen returned happily and the hard mesh-quality gate
      (#166) then rejected threw straight out of `runAdaptiveAnalysis`. An opt-in
      accuracy feature could therefore turn a part that solved fine at its tier
      into a 500, discarding the good tier result the loop was already holding.
      Now caught as `resolve-failed`, keeping best-so-far. Found by measurement,
      not review; locked by `adaptive-resolve-failure.test.ts` (tetgen-gated,
      verified to fail without the fix). The `StopReason` union was extended to
      cover the driver-produced reasons, so the documented API contract is
      type-enforced instead of free-form strings

---

## IN PROGRESS / NEXT

_Previous entries (DFA core yield, per-failure-mode yield selection) shipped in
the solver-accuracy campaign; adaptive mesh refinement (#149) shipped in PR #246
— see above._

- **Surface the adaptive-refinement loop in the client** — #246 landed the solver
  path (`analysis.adaptiveRefinement` on `/api/analyse`, full
  `AdaptiveRefinementInfo` on the response), but the client has no toggle and no
  readout, so the feature is unreachable from the UI. The payload already carries
  everything a results panel needs: iteration count, stop reason, initial vs
  final global error and element count, the element budget, and the per-iteration
  history. The benefit is now demonstrated rather than asserted (see the
  benchmark below), so the remaining blocker is the honesty of the readout: the
  loop optimises the ENERGY-NORM error, and on the one part measured it moved
  peak stress by 24% while moving that error by 8% — a panel that reports only
  the error would overstate what the run settled
- **Validate the 3% error target and 8× growth cap against a NON-SINGULAR part**
  — the budget overshoot and the sliver failure are fixed (the re-mesh moved off
  TetGen's `-m` background metric, which slivers on curved boundaries even with a
  constant metric, onto `-r` with per-element volume constraints; the cap is now
  enforced against the mesh actually emitted, before it is solved), and
  `adaptive-benchmark.test.ts` shows adaptivity beating uniform refinement on the
  Ø5-bore tube: 0.262 global error on 40,534 elements against 0.337 on 54,373.
  What is still NOT settled is the estimator's behaviour on that geometry. The ZZ
  global relative error reads 89% on the coarse tier and does not fall
  monotonically under refinement — measured 0.894 → 0.262 → 0.279, with the loop
  stopping on `stalled` because the third solve was WORSE. Peak von Mises is
  likewise unsettled: adaptive resolves 4.91 MPa where uniform reads 3.97, a 24%
  spread against an 8% spread in the error being optimised. The "singular bore or
  estimator defect?" question is now PARTLY answered, and it was at least partly
  the estimator: on a deliberately non-singular part (smooth cylinder,
  distributed constraint and traction, no hole, no re-entrant corner) the C3D10
  estimate read 23.2% / 6.9% / 80.6% across tiers — worst on the FINEST mesh —
  while C3D4 on the identical geometry fell monotonically. Cause was SPR solving
  rank-deficient patches (every C3D10 midside node's patch is the ring of tets
  sharing one edge) past a rank guard written as an absolute pivot threshold on a
  matrix in raw global mm coordinates, which could never fire. Fixed; that sweep
  now reads 5.4% / 4.0% / 3.4%. What this does NOT establish is that the tube's
  own numbers were the same defect — the 0.894 → 0.262 → 0.279 sequence above
  predates the fix and should be re-measured before the bore is either blamed or
  cleared. Until then the 3% target and 8× cap are defaults chosen by argument,
  not by measurement. Note the adaptive-vs-uniform comparison itself is
  a ONE-PART result so far: the plate below could not complete a refined solve
  for an unrelated reason (the solver wall clock), so it neither confirms nor
  refutes the tube's margin. The comparison's own premise is now bounded rather
  than assumed: the uniform yardstick must land within `UNIFORM_MAX_RATIO` (2x)
  of the adaptive element count, and if TetGen's non-monotone response to `-a`
  ever moves the ladder outside that band the benchmark fails on the PREMISE,
  naming the rungs it walked, instead of failing the error margin with two
  numbers that look like an adaptivity regression and are not
- **The solver wall clock, not mesh quality, is now the binding constraint on
  adaptive refinement for mid-size parts** — surfaced by fixing the slivers:
  refined solves are actually attempted now, and the next limit shows up
  immediately behind them. On a 40x20x4 mm bracket plate the first refinement
  built a CLEAN 51,743-element mesh (239k DOF, zero hard-gate violations, zero
  poor elements, worst normalized Jacobian 0.112) and the PCG solver hit its 90 s
  deadline at relRes 1.4e-2 while still converging, so the run degraded to the
  tier solve with `resolve-failed`. The degradation is correct behaviour, but it
  means the 8x element budget and the solver's time budget are set independently
  and can contradict each other: the loop is allowed to build a mesh it is not
  allowed to solve. Options are to derive the element budget from a DOF/time
  model rather than a fixed multiple, to raise `CG_DEADLINE_MS`
  (`server/solver/cg.ts`) for the adaptive path specifically, or to treat a
  deadline miss as a budget signal and retry smaller. The second of those is now
  DONE, and more besides: the wall clock is a hang guard rather than a verdict —
  it no longer throws (the solve returns its current iterate with
  `CGResult.timedOut` set, exactly as exhausting the iteration cap already did),
  the default is 600 s via `CG_DEADLINE_DEFAULT_MS`, and it is per-solve
  configurable through `SolverInput.cgDeadlineMs`. A 90 s limit sat INSIDE the
  range a legitimate large solve needs, so the same mesh and inputs passed on an
  idle host and failed on a loaded one; the fine tier of the smooth-cylinder
  benchmark genuinely needs 181 s. That removes the hard failure but NOT the
  underlying point: the element budget and the time budget are still set
  independently, so deriving one from the other remains open. Measured on 4
  cores; a faster host moves the threshold but does not remove it

- **Pin `VOLUME_CAP_SCALE` with more than one geometry** — the scale converting a
  target edge length to a TetGen `-a` volume cap (13, `adaptiveMesh.ts`) was
  calibrated on the tube alone, where it brought predicted and emitted element
  counts within 11%. It is confidence-LOW and the equivalent ratio on the tier
  path's uniform caps drifts between ~2.5 and ~5.5 with density. The driver
  measures and corrects the residual per-run, so a wrong seed costs a re-mesh
  rather than correctness — but a second and third geometry would say whether 13
  is a constant or a coincidence
- **Gauss-point SPR sampling for C3D10** (`docs/spr-gauss-point-handoff.md`) —
  `recoverElementStress` evaluates C3D10 stress at all four Gauss points and then
  AVERAGES them into one value per element, so the recovered field `σ*` is built
  from a single sample per element while the estimator compares it against `σ_h`
  recomputed per Gauss point. The two sides of `η` are sampled asymmetrically, so
  the estimate carries an O(h) floor unrelated to the true error: on a
  manufactured quadratic field that C3D10 solves EXACTLY (‖u_h − u_exact‖ ~1e-13)
  it still reports 1.46% / 0.53% / 0.26% at 4³/6³/8³, making the estimator not
  asymptotically exact on C3D10. Conservative (it over-reports), and ~3× smaller
  since the rank-deficient-patch fix, so this is an accuracy limit rather than a
  defect — but the adaptive loop's default target is 3%, so at the coarse tier up
  to half the target can be artifact. The handoff covers the fix (keep the
  per-point stresses, raise the recovery basis to the element's own quadratic
  order, re-measure whether midside interpolation is still needed) and the one
  trap that matters: group 30's manufactured solution is quadratic, which C3D10
  reproduces exactly, so it CANNOT anchor a C3D10 effectivity index — that needs
  a cubic-or-higher exact solution
- **The two mesher paths size themselves on incompatible philosophies, and only
  one of them targets an element budget** (issue #295) — `tetMaxVolumeForTier`
  (`server/tetgen.ts`) is SCALE-RELATIVE: it divides the bounding-box volume by
  `TET_TARGET_ELEMENTS` (coarse 4,000 / standard 12,000 / fine 40,000), so an STL
  part gets that many elements whatever its size. The STEP/Gmsh path in
  `runAnalysis` (`server/analysis.ts`) is ABSOLUTE: its per-tier `clOpts` set
  `clMin`/`clMax`/`clCurv` in millimetres (fine = 0.2/2.0/30), which fixes an
  element SIZE and lets the resulting count float freely with part size. So
  "fine" means "40,000 elements" for an STL and "2 mm elements" for a STEP, and
  only the first guarantees a resolution budget. The absolute form is defensible
  on its own terms — a 2 mm cap resolves a fillet the same way on any part, and
  `clCurv` is what refines hole bores — but it has no FLOOR: a thin plate meshed
  at `clMax` 2.0 mm gets one or two quadratic elements through a 3-4 mm wall,
  which is under-resolved for bending regardless of how many elements the part
  carries in total. Neither `docs/` nor this file records the absolute choice as
  a landed decision, and the shipped list above has an entry for teaching the STL
  path to honour the tier with no STEP counterpart. Fix direction: keep the
  curvature-driven sizing, add a scale-relative cap so the tier still targets a
  count, and add a through-thickness floor so the smallest dimension always
  carries enough elements to bend. Blocks the two-region entry below
- **Enable and harden the two-region (walls vs infill) model, once the mesh can
  resolve it** (issue #297) — the model is built, validated, and reachable
  (`print.twoRegion`, `server/twoRegion.ts`, `two-region-toggle` in the client)
  but defaults OFF, so the default analysis represents infill as a scalar
  knockdown with no spatial structure. The blocker is resolution, but NOT in
  the way first assumed here — the wall-band CLASSIFICATION is not the fragile
  part. Measured on a 60x30x6 mm plate with a 1.35 mm band, against the exact
  analytic shell volume fraction: 3.2% error with the element 4.4x the band
  width, 0.06% at h = 1.5 mm. `tetFractionBelowIso` integrates the level set
  INSIDE the element (invariant #2), so it does not need elements finer than
  the band to get the volume right.
  What DOES need resolution is the structural effect the model exists to
  capture. Same fixture as a cantilever, two-region against the homogenized
  average at matched resolution, measuring how much of the converged 26.1%
  sandwich stiffening each mesh recovers: 1 element through thickness gives 4%
  (tip deflection 29.0% off), 2 gives 57% (13.1% off), 3 gives 83% (4.75% off),
  4 gives 100% (0.84% off). At one element through thickness the model returns
  essentially the homogenized answer while reporting itself active, which is
  worse than not offering it. That measurement set
  `MIN_ELEMENTS_THROUGH_THICKNESS` to 4 (issue #295) — it was 3 on textbook
  convention, which leaves 17% of the effect behind. Still sequenced after the
  mesh-sizing entry, now for the measured reason. Note the core
  homogenization exponents remain confidence-LOW (see KNOWN LIMITATIONS); this
  entry is about making an existing validated model the default and surfacing the
  shell/core split, not about moving those constants
- **Symmetry-preserving meshing** (issue #296) — an unstructured tet mesh of a mirror-symmetric
  part is not itself mirror-symmetric, so the recovered stress field carries an
  asymmetry the geometry does not have. Measured on a symmetric cantilever
  fixture: only 128 of 384 element centroids had a mirror partner at all, and the
  SPR nodal field's mirror asymmetry ran 1.83% / 0.88% / 0.52% rms across
  384/3,072/10,368 elements while the DISPLACEMENT field stayed symmetric to
  0.001%. Mesh symmetry is a property of the geometry and independent of the load
  case: detect the symmetry plane, mesh the fundamental domain, mirror and weld,
  and then any asymmetry left in a result is real rather than injected.
  `runLinearStaticWithK` already anticipates mirrored input — the assemblers
  auto-orient via `Math.abs(sixV)`/`Math.abs(detJ)`, and the mesh-quality gate
  deliberately keys on shape rather than Jacobian SIGN so "a MIRROR-oriented but
  well shaped mesh solves correctly and must pass the gate". Scope limit: only
  applies where the geometry actually HAS a symmetry plane, and it does not
  reduce the mesh-to-mesh artifact below.
  DETECTION HAS LANDED (`server/solver/symmetry.ts`, `detectSymmetryPlanes`).
  It verifies mesh-INDEPENDENTLY — each mirrored sample point is measured
  against the surface as a geometric object via `pointTriangleDistance`, never
  against mesh entities, because the condition being detected is precisely a
  symmetric part with an asymmetric mesh and an entity-matching test would
  reject every real case. Candidates are the three coordinate axes plus the
  principal axes of the area-weighted surface covariance. Cost is 0.6 s at
  28k elements for a fully symmetric part and 5 ms for an asymmetric one, which
  short-circuits on the first violating sample. Both tolerances
  (`SYMMETRY_DEFAULT_TOL_REL`, `SYMMETRY_DEDUP_ANGLE_DEG`) are confidence-LOW:
  argued from STL chord error and from measured eigenvector spread, not tuned
  against a corpus of real parts.
  STILL TO DO: clipping and capping the input surface (split out as its own
  entry below, issue #300 — it is the risky half and a standalone capability),
  then meshing the fundamental domain and mirroring plus welding the result.
  The weld at the symmetry plane has to be exact or the seam becomes a fresh
  artifact source — the same class of defect as the vertex-welding bug in
  CLAUDE.md's heatmap section — and it must share one snap tolerance with the
  clipper rather than carrying a second literal that can drift
- **Watertight surface clipping at a plane** (issue #300) — given a closed
  triangulated surface and a plane, produce the closed surface of the
  half-space intersection. The prerequisite for the entry above, split out
  because it is substantial on its own and nothing in the repo does it today:
  `sliceTetsByAxisPlane` (`client/index.html`) is a marching-tet slice of the
  VOLUME mesh for display only, producing a cut face to colour rather than a
  watertight surface a mesher can consume, and it runs client-side after the
  solve. Different operation, different pipeline stage.
  Classify each triangle against the plane, split the straddling ones,
  re-triangulate the keep-side remainder, extract the open boundary loops, and
  cap them. **The cap is where the difficulty is, and it is not a triangle
  fan** — cutting a plate through its bore leaves an outer loop plus the bore's
  cross-section as an inner loop, so the cap is a constrained triangulation of
  a polygon WITH HOLES. A fan over the outer loop would tile straight across
  the bore and hand the mesher a solid where the part has a hole.
  Failure modes to design against, several of which this repo has already paid
  for once: watertightness is binary (TetGen wants a closed PLC, and one
  unclosed loop either fails outright or silently tetrahedralises something
  that is not the part, so closure needs its own check BEFORE the mesher is
  invoked rather than a downstream quality gate catching the consequences); a
  vertex within epsilon of the plane must SNAP to it rather than emit a
  zero-area sliver (see the `-m` background-metric episode in
  AI_ORCHESTRATION entry 12 and the hard sliver gate from #166); loop
  orientation has to be consistent to distinguish an outer boundary from a
  hole; and a flat face lying exactly ON the symmetry plane is an ordinary FTC
  bracket, not a pathological input.
  Almost all of it is pure geometry and testable with no mesher present —
  closure (every edge shared by exactly two triangles), signed volume against
  the analytic half, a bore-through cap against the analytic annulus area,
  coplanar and on-plane fixtures, and a clip/mirror/weld round trip back to
  the original volume. The one part that genuinely needs TetGen or Gmsh is
  confirming the mesher accepts the output, which belongs in the
  mesher-gated shard alongside the existing skips
- **Anisotropic (honeycomb) DFA extension** — the shipped core yield criterion
  is the isotropic-foam form. Extending pressure sensitivity per-axis would
  match the per-axis stiffness and strength laws the core already uses;
  currently α is one scalar per bin
- **Close the invariant-coverage gaps catalogued in `docs/INVARIANTS.md`** —
  four invariants are locked on their core numeric claim but only partially on
  the structural half: exhaustive sign-case coverage for `tetFractionBelowIso`
  (two-region #2); an automated check that whole-part vs. per-element material
  consumers stay on their correct side of the `material` / `ElementMaterialField`
  split (two-region #6); a negative test keeping `yieldZShear` out of the
  assembly-worker payload (interlayer #5); and a grep-style CI guard — the shape
  `scripts/check-api-routes.mjs` already uses — against a second orientation
  scalar entering the material-stiffness path (interlayer #8)
- **Raise the LOW-confidence constants with data, not code** — the bond model
  (h0, Ea, Φ-exponent, μ), the Gibson-Ashby exponents, and DFA's α₀/exponent are
  all regression-locked engineering estimates. The fitting endpoints
  (`/api/calibration/bond-sweep`, `/api/calibration/fatigue`) and the coupon
  recommendation engine exist; what is missing is a printer process sweep and
  Z-tension/lap-shear coupons actually run on the team's machine

---

## DEFERRED (explicit decisions)
- Heat-set inserts — deferred until core tool stable
- 45° orientation recommendation — removed (warping/twist faults)
- Multi-part assembly analysis — high complexity, low FTC value
- Delamination PROPAGATION (cohesive zones / VCCT, G_IC/G_IIC fracture
  energies) — initiation is covered by the interface criterion; propagation
  needs an incremental/nonlinear solve and fracture-toughness coupons (DCB/
  ENF), a major solver lift with limited decision value for FTC-scale parts.
  Hook left open: the interface criterion's tension/shear split is exactly
  the mixed-mode ratio a future energy criterion would consume.

_Resolved: "Temperature/cooling speed effect — insufficient consistent data"
— now modeled physics-first by the bead-penetration bond model (anchored to
reference settings, LOW confidence until process-sweep fitted) instead of
waiting for a consistent empirical table._

## KNOWN LIMITATIONS (disclosed in app)
- Bearing failure: LOW confidence — no FDM-specific bearing data. The Kt fixture
  behind the calibrated path is now a real plate-with-hole rather than a
  hole-less box, so calibration genuinely moves the allowable; the underlying
  data gap is unchanged
- Pattern multipliers: approximate — inconsistent literature
- Layer height model: −15% to +10%, linear — process interaction now enters
  only via the bond model's τc (thinner roads more fan/speed sensitive)
- Fatigue estimate: LOW confidence — sparse FDM S-N data. Interlayer fatigue is
  now checked separately from bulk, but on the same sparse basis
- Filament color: known to affect strength (η²=97.3%) — not modeled
- Interlayer allowables default to literature ratios (S_zt = 0.58·Y,
  S_zs = S_zt/√3) until the Z-tension and lap-shear coupons are run
- Bond-model constants (h0, Ea, Φ-exponent, friction μ=0.3): LOW confidence
  engineering estimates until fitted from a printer process sweep
- Core homogenization exponents (Gibson-Ashby ρ^n, DFA α₀ = 2.08 and its density
  exponent): LOW confidence, regression-locked and calibration-overridable
- Delamination is INITIATION-only (strength-based); crack propagation
  between layers is not simulated (see DEFERRED)
- Curved C3D10 elements are under-integrated by the default 4-point Gauss rule
  (exact only for straight-edged elements); a higher-order rule is opt-in
- Adaptive refinement is opt-in, API-only, and STL-only — the error-driven
  remesh loop exists (#149/#246) but is reachable only via
  `analysis.adaptiveRefinement` on `/api/analyse`, not from the UI. It degrades
  to the selected mesh tier on the STEP/Gmsh path, on the box-mesh fallback, and
  where no TetGen binary is found. It targets the ZZ global relative error, which
  does not by itself guarantee a changed safety factor or governing failure mode,
  and it deliberately leaves a 2 mm ball around a detected singularity coarse
  (refining a true singularity never converges). Its benefit relative to simply
  selecting the fine tier is not yet benchmarked (see NEXT)
- The per-analysis validation coverage map reports whether a configuration's
  KIND is exercised somewhere in the suite, not that a specific geometry, load
  case, or material is proven correct — and it names its combination gaps (e.g.
  two-region validation runs exclusively on C3D10 meshes)
- The DISPLAYED stress field carries a mesh-dependent artifact tail that the ZZ
  estimator cannot flag, and this is only PARTLY disclosed (issue #294). Measured
  on a symmetric cantilever fixture at 3,072 elements, two different meshes of
  the same geometry under the same load disagree by a median of 0.03% of peak but
  a p95 of 7.9% and a max of 16.1% — the field is excellent almost everywhere
  with a scattered tail, and the hot spots MOVE when the part is re-meshed.
  Refinement is the only measured lever (three recovery-side fixes were
  prototyped and were neutral or regressions: boundary-patch borrowing, the
  cascade thresholds, and `SPR_MAX_AMPLIFICATION_QUADRATIC`, which is
  bit-identical from 60 down to 5). The per-element `errorEstimate` does NOT
  predict these locations — Spearman 0.015 against the actual mesh-to-mesh
  disagreement — because ZZ differences the recovered and raw fields and an
  artifact inherited by both cancels. `globalRelativeError` is shown on the
  RESULTS tab, so a user reading the 3D view alone gets no signal at all;
  `topErrorElements` should not be read as "here is where the picture lies"

_Resolved: the TetGen box-mesh fallback previously always produced C3D4 (≈55%
bending underprediction) regardless of the element-order selector; it now honours
the selector (C3D10 by default) — see the shipped list above. Choosing C3D4
explicitly now warns about the same underprediction._

_Resolved: the stress legend read ~1.8× high mid-scale because model colors were
gamma-warped (γ=0.55) while the legend was linear; both now share the warp._

_Resolved: STEP-file C3D10 elements were self-intersecting from a swapped Gmsh
midside node ordering; fixed, and both mesher paths self-check midside placement
at runtime._
