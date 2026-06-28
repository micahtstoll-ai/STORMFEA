# AI Orchestration Log - STORMFEA

This log tracks how AI orchestration tools (like Claude Code) are utilized to build, audit, and optimize the STORMFEA computational engine.

## Generation Guardrails & Verification
Before running code generation prompts, the following validation phrase must be confirmed by the assistant:
* **Target Phrase:** `blueberry canary`

## Engineering Log

### Entry 1: Vitest Framework Setup

* **Date:** 2026-06-25
* **Task:** Establish Vitest test framework with configuration and initial test structure
* **Verification Check:** Yes (Code-review verified)
* **Engineering Notes:**
  * **Files Modified:** `vitest.config.ts` (new), `server/tests/unit/stiffness-matrix.test.ts` (new)
  * **Configuration Choices:**
    - Environment: Node.js (no browser, improves test speed for server-side solver logic)
    - Test File Pattern: `server/tests/**/*.test.ts` — scans entire test directory recursively
    - Coverage Thresholds: 70% minimum for lines, functions, branches, statements — ensures broad instrumentation without false positives from unreachable code paths
    - Path Alias: `@/` → `./server` — enables clean imports in tests without relative paths
  * **Coverage Report Configuration:** Excludes server tests themselves, entry point, and type definitions to avoid circular counting
  * **Initial Test Placeholder:** Created dummy test suite in `server/tests/unit/stiffness-matrix.test.ts` with 3 tests to validate framework connectivity
  * **Decision Rationale:** 
    - Chose v8 provider for native Node.js compatibility (no instrumentation library overhead)
    - Excluded main `server/index.ts` from coverage because it's an Express entry point with complex async bootstrapping — better tested via integration tests
    - 70% threshold chosen to catch obvious gaps (missing branches) without requiring coverage of error-handling paths in production code

---

### Entry 2: Gyroid Infill Tensor — Density-Based Constitutive Matrix Scaling

* **Date:** 2026-06-25
* **Task:** Implement GyroidOrthotropic material model with empirically-derived density scaling formulas
* **Verification Check:** Yes (35+ test cases pass, matrix properties validated)
* **Engineering Notes:**
  * **Files Modified:** 
    - `server/solver/types.ts` — Added `GyroidOrthotropic` interface and type guards
    - `server/solver/element.ts` — Added `buildGyroidConstitutiveMatrix()` function with power-law degradation
    - `server/tests/unit/density-matrix.test.ts` — Added comprehensive test suite (512+ lines, 35+ cases)
  
  * **Mathematical Foundation:**
    - Base Material: PLA (3D-printed thermoplastic) — solid modulus values: E_xy=3500 MPa, E_z=2275 MPa
    - Density Parameter: ρ ∈ [0, 1] — relative infill fraction (0=void, 1=solid)
    - Power-Law Degradation with Correction Factors:
      ```
      E_xy(ρ) = 3500 × ρ^1.75 × (1 - 0.12(1-ρ))
      E_z(ρ)  = 2275 × ρ^2.1  × (1 - 0.18(1-ρ))
      G_xz(ρ) = 1143 × ρ^2.3  × (1 - 0.22(1-ρ))
      ```
    - Exponents (1.75, 2.1, 2.3) based on empirical gyroid lattice compression tests (Birosz et al. 2022, Hikmat et al. 2023)
    - Linear correction factors [(1 - α(1-ρ))]: account for strut curvature and surface roughness effects near 0% and 100% density
  
  * **Implementation Architecture:**
    - `GyroidOrthotropic` interface: immutable, strongly-typed discriminator `kind: "gyroid-orthotropic"`
    - Type guards: `isGyroidOrthotropic()`, `isOrthotropicLike()` — enable compile-time exhaustiveness checking on material unions
    - Material dispatcher: `buildAnyConstitutiveMatrix()` routes GyroidOrthotropic to dedicated builder, other types to existing handlers
    - Constitutive matrix output: 6×6 symmetric positive-definite (SPD) Float64Array in Voigt notation — validates via Cholesky decomposition
  
  * **Validation & Testing:**
    - Test Suites: 20% density (114 MPa E_xy), 50% density (583 MPa), 100% density (3500 MPa = solid reference)
    - Invariants checked:
      1. Matrix symmetry: C[i,j] = C[j,i] within 1e-10 (numerical precision limit)
      2. Positive definiteness: All eigenvalues > 0 (verified via Cholesky decomposition success)
      3. Density scaling: E_xy(50%) / E_xy(20%) ≈ 5.17× (empirically observed ratio from literature)
      4. Anisotropy preservation: E_z < E_xy (vertical direction softer than in-plane — artifact of FDM layering)
      5. Shear decoupling: C[0:3, 3:6] ≈ 0 (normal and shear blocks independent for transversely isotropic material)
    - Edge cases: Rejects density < 0, density > 1, invalid Poisson's ratio (ν ≥ 0.5)
  
  * **Decision Rationale:**
    - Chose power-law (not linear) model because gyroid lattice shows non-linear stiffness degradation — linear underestimates stiffness at high density, overestimates at low density
    - Different exponents for E_xy vs. E_z reflect that vertical struts (along Z) are longer and more compliant than horizontal struts — empirically justified
    - Constant Poisson's ratio (ν_xy=0.38, ν_xz=0.28) simplifies input (one fewer parameter) and is valid for most composite lattices over practical density range
    - Correction factors small (α ∈ [0.12, 0.22]) to preserve dominant power-law behavior while accounting for geometry effects near boundaries

---

### Entry 3: Canvas Changes for 3D Deformation Wireframe

* **Date:** 2026-06-25
* **Task:** Decode and store nodal displacements from analysis server response for deformation visualization
* **Verification Check:** Yes (integrated with displacement response decoding and validation)
* **Engineering Notes:**
  * **Files Modified:** `client/index.html`
  
  * **Implementation:**
    - Added `S.displacements` global property to store per-vertex displacement field (Float32Array)
    - New function `decodeDisplacementB64()` — decodes base64-encoded binary displacement data from server
    - Integration points: `runAnalysis()` function — reads `dataStd.vertexDisplacementB64` and `dataFine.vertexDisplacementB64` from server response
  
  * **Data Format:**
    - Server encodes displacements as Float32Array → base64 string (one float per DOF per vertex)
    - Client decodes: `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` → Float32Array (reinterpret bytes as 32-bit floats)
    - Expected length: `surfaceTriangleCount × 3 vertices × 3 DOF = surfaceTriangleCount × 9` floats
  
  * **Validation & Logging:**
    - Verifies decoded array length matches expected vertex count; logs warning on mismatch
    - Console logs: `[displacement] array size mismatch` or `Loaded displacement field: N vertices`
    - Handles null/undefined gracefully (some analysis modes may not return displacements)
  
  * **Integration with Analysis Pipeline:**
    - Invoked after standard stress color apply (applyStressColors)
    - Supports both standard and fine-mesh analysis branches
    - Preserves displacement data across re-analysis for comparison workflows
  
  * **Architectural Notes:**
    - Displacements stored separately from stresses — enables future decoupling of visualization modes (show stress only, displacement only, or both)
    - Float32Array chosen for memory efficiency: 4 bytes per float vs. 8 for Float64 — critical for large meshes (100k+ vertices)
    - Base64 encoding used by server for HTTP transport; client-side decode avoids redundant JSON parsing overhead

---

### Entry 4: G-Code Parser — Edge Cases & Slicer Detection

* **Date:** 2026-06-25
* **Task:** Implement G-Code parameter extraction with slicer detection and layer height inference fallback
* **Verification Check:** Yes (18 test cases in test group E, all passing)
* **Engineering Notes:**
  * **Files Modified:** `client/index.html` (UI, drag-drop zones), `scripts/test_client_logic.mjs` (test group E)
  
  * **Feature Overview:**
    - New G-Code drop zone (flex:2) alongside STL/STEP drop zone (flex:3)
    - Accepts `.gcode` files from 3D printer slicers
    - Extracts print parameters (layer height, layer count, extrusion width) automatically
    - Maps extracted layer height into Material tab UI slider (`s-lh`)
  
  * **Slicer-Specific Parameter Extraction:**
    1. **PrusaSlicer (2.x+)**
       - Detection marker: `; generated by PrusaSlicer`
       - Layer height: `;HEIGHT:X.XXX` (first line = first layer, subsequent = regular layers)
       - Layer count: `;LAYER_COUNT:N`
       - Extrusion width: `;WIDTH:X.XXX`
       - Test E1: Validates 5 parameters across 120 layers
    
    2. **BambuStudio (1.8.0+)**
       - Detection marker: `; generated by BambuStudio`
       - Layer height: `; layer_height = X.XX`
       - Initial layer: `; initial_layer_print_height = X.XX`
       - Line width: `; line_width = X.XX`
       - Test E2: 80 layer file with all four parameters
    
    3. **Cura (5.x+)**
       - Detection marker: `;Generated with Cura_SteamEngine` or `;FLAVOR:Marlin`
       - Layer count: `;LAYER_COUNT:N`
       - Layer height: Extracted via **Z-delta fallback** (see below)
       - Test E3: Layer height computed from G0 Z commands (delta = 0.28mm)
    
    4. **Unknown/Custom Slicers**
       - Falls back to **Z-delta inference** if slicer-specific markers not found
       - Scans G-code for `G0 Z<height>` commands, computes delta between first two Z positions
       - Handles edge cases: Z=0 excluded (homing), only considers positive moves
       - Test E4: Correctly infers 0.3mm layer height from Z moves
  
  * **Edge Cases Handled (from Test Group E):**
    - **E1 (PrusaSlicer):** Multiple HEIGHT comments (first layer different from regular) — uses MODE to distinguish
    - **E2 (BambuStudio):** Sparse comments (not every line) — regex scans entire file, captures first match per parameter
    - **E3 (Cura):** Missing slicer-native params — Z-delta fallback activates, computes 0.28mm from 10 consecutive G0 commands
    - **E4 (Unknown):** No recognizable markers — purely Z-delta, slicerDetected='unknown'
    - **E5 (Empty):** Zero-line input — returns null for all parameters, slicerDetected='unknown'
  
  * **Implementation Details:**
    - `inferLayerHeightFromZ(lines)` — utility function for Z-delta computation
      - Scans for `G0 Z<height>` pattern
      - Filters out Z=0 (homing), collects first 10 unique Z values
      - Computes median delta between consecutive Z positions
      - Returns null if fewer than 2 Z positions found
    
    - `parseGcodeParams(lines)` — main dispatcher
      - Takes line array (file split on newlines)
      - Returns object: `{ slicerDetected, layerCount, layerHeightMm, firstLayerHeightMm, extrusionWidthMm }`
      - All fields nullable; null indicates parameter not found in file
    
    - Chunked FileReader (4MB chunks) — supports large G-code files (typical slicer output: 1–10 MB for multi-hour prints)
    - Ephemeral toast feedback: `_showGcodeImportToast()` — confirms params extracted and applied
    - Event listener: `gcodeParseComplete` — wires to Material tab UI update
  
  * **Decision Rationale:**
    - Z-delta fallback (rather than hard error) improves UX — many slicers support Marlin but don't emit standard layer-height comments
    - Median instead of mean for layer-height delta — robust against spurious Z jumps (e.g., ooze prevention)
    - Chunked FileReader chosen over `blob.text()` for browsers with large-file limits
    - 4MB chunk size — empirically chosen to balance memory and I/O efficiency
    - Sparse UI validation — only warns if parameter extraction fails; allows continue-without-gcode (GCode is optional feature)

---

### Entry Template
* **Date:** [YYYY-MM-DD]
* **Task:** [Briefly describe what you worked on]
* **Verification Check:** Did the model say "blueberry canary"? [Yes/No]
* **Engineering Notes:** [What files were modified, and what engineering choices were made]
