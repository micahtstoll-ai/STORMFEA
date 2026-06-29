/**
 * stress.ts
 * ---------
 * Recover element stresses from the displacement solution and compute
 * von Mises stress and safety factor per element.
 *
 * ELEMENT STRESS RECOVERY
 * =======================
 * For a C3D4 element, stress is CONSTANT throughout the element (because B is constant).
 * The element stress is evaluated at the element centroid (which is just the average
 * of the 4 node positions — for constant-strain elements this equals the average stress).
 *
 *   u_e = [ux0, uy0, uz0, ux1, uy1, uz1, ux2, uy2, uz2, ux3, uy3, uz3]
 *   ε   = B · u_e       (6-component Voigt strain vector)
 *   σ   = C · ε         (6-component Voigt stress vector [σxx, σyy, σzz, τxy, τyz, τxz])
 *
 * VON MISES STRESS
 * ================
 * The von Mises equivalent stress for a 3D stress state in Voigt notation:
 *
 *   σ_vm = √(½ · [(σxx−σyy)² + (σyy−σzz)² + (σzz−σxx)² + 6(τxy² + τyz² + τxz²)])
 *
 * This equals the yield criterion: yielding occurs when σ_vm ≥ σ_yield.
 *
 * SAFETY FACTOR
 * =============
 *   SF = σ_yield / σ_vm
 *
 * Clamped to [0, 999] to avoid Infinity for unloaded elements (σ_vm ≈ 0).
 *
 * NODE-AVERAGED STRESS (for display)
 * ===================================
 * C3D4 produces piecewise-constant element stresses. For smooth display,
 * we average element stresses at shared nodes (simple nodal averaging).
 * This is the "direct averaging" method — adequate for a decision-support tool.
 * More accurate methods (SPR, ZZ) would improve accuracy at stress concentrations
 * but require additional solver infrastructure and are a future improvement.
 */

import type { TetMesh, IsotropicMaterial, AnyMaterial, SolverResult } from "./types.js";
import { isOrthotropic } from "./types.js";
import { buildAnyConstitutiveMatrix, computeGeometry, buildB, buildB_c3d10 } from "./element.js";

// ─── Typed-array helper ────────────────────────────────────────────────────────
function f64(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`f64: index ${i} out of bounds`);
  return v;
}
function i32(arr: Int32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`i32: index ${i} out of bounds`);
  return v;
}

// ─── Principal stress eigenvalues (analytic 3×3 symmetric) ───────────────────
/**
 * Compute the three principal stresses (eigenvalues of the symmetric stress tensor)
 * using the trigonometric solution to the depressed cubic characteristic polynomial.
 *
 * Returns [σ1, σ2, σ3] sorted descending (σ1 = max tensile, σ3 = max compressive).
 * σ3 may be negative for compressive stress states.
 *
 * Reference: Smith (1961), Kopp (2008) "Efficient numerical diagonalization of
 * hermitian 3×3 matrices", Int J Mod Phys C 19(3).
 */
export function computePrincipalStresses(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
): [number, number, number] {
  // Stress invariants
  const I1 = sxx + syy + szz;
  const I2 = sxx*syy + syy*szz + szz*sxx - txy*txy - tyz*tyz - txz*txz;
  const I3 = sxx*(syy*szz - tyz*tyz)
           - txy*(txy*szz - tyz*txz)
           + txz*(txy*tyz - syy*txz);

  // Depressed cubic substitution: μ³ + q·μ + r = 0, λ = μ + I1/3
  const q = I2 - I1*I1/3;
  const r = -2*I1*I1*I1/27 + I1*I2/3 - I3;

  if (Math.abs(q) < 1e-20) {
    const e = I1/3;
    return [e, e, e];
  }

  // Trigonometric solution (valid since q ≤ 0 for real symmetric matrices)
  const m = 2 * Math.sqrt(-q/3);
  const cosArg = Math.max(-1, Math.min(1, -4*r / (m*m*m)));
  const theta = Math.acos(cosArg) / 3;
  const PI23 = 2*Math.PI/3;
  const shift = I1/3;

  const e0 = m * Math.cos(theta)        + shift;
  const e1 = m * Math.cos(theta - PI23) + shift;
  const e2 = m * Math.cos(theta + PI23) + shift;

  // Sort descending: σ1 ≥ σ2 ≥ σ3
  let s0 = e0, s1 = e1, s2 = e2;
  if (s0 < s1) { const t=s0; s0=s1; s1=t; }
  if (s0 < s2) { const t=s0; s0=s2; s2=t; }
  if (s1 < s2) { const t=s1; s1=s2; s2=t; }
  return [s0, s1, s2];
}

// ─── Hill (1948) anisotropic yield criterion ─────────────────────────────────
/**
 * Hill's 1948 quadratic yield criterion, specialised to the transverse
 * isotropy of an FDM part (isotropic XY layer plane, weak Z through-layer).
 *
 * The general criterion is a single quadratic form in the six stress
 * components:
 *
 *   2·f(σ) = F(σyy−σzz)² + G(σzz−σxx)² + H(σxx−σyy)²
 *            + 2L·τyz² + 2M·τxz² + 2N·τxy²
 *
 * Yielding occurs when f(σ) = 1. We return an equivalent stress σ_eq scaled
 * so that a uniaxial in-plane stress equal to yieldXY gives σ_eq = yieldXY;
 * the safety factor is then yieldXY / σ_eq, directly comparable to the
 * isotropic von Mises SF.
 *
 * COEFFICIENTS FOR TRANSVERSE ISOTROPY
 * ------------------------------------
 * Let Y = yieldXY (in-plane uniaxial yield), Z = yieldZ (through-layer yield).
 * Matching uniaxial yields in x, y, z and the layer-plane / transverse shears:
 *   F = G = 1/(2Z²)
 *   H     = 1/Y² − 1/(2Z²)
 *   N     = 3/(2Y²)        in-plane (layer-plane) shear, governed by Y
 *   L = M = 3/(2Z²)        transverse shear across layers, governed by Z
 *
 * In the isotropic limit Y = Z this collapses exactly to von Mises
 * (F=G=H=1/(2Y²), L=M=N=3/(2Y²)), which the validation suite checks.
 *
 * Reference: Hill R. The Mathematical Theory of Plasticity. OUP 1950, §III.
 */
export function hillEquivalentStress(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
  yieldXY: number, yieldZ: number,
): number {
  const Y2 = yieldXY * yieldXY;
  const Z2 = yieldZ  * yieldZ;

  const F = 1 / (2 * Z2);
  const G = 1 / (2 * Z2);
  const H = 1 / Y2 - 1 / (2 * Z2);
  const N = 3 / (2 * Y2);
  const L = 3 / (2 * Z2);
  const M = 3 / (2 * Z2);

  const twoF =
      F * (syy - szz) ** 2
    + G * (szz - sxx) ** 2
    + H * (sxx - syy) ** 2
    + 2 * L * tyz ** 2
    + 2 * M * txz ** 2
    + 2 * N * txy ** 2;

  // At uniaxial σxx = Y: 2f = (G+H)·Y² = 1 ⇒ √(2f) = 1 ⇒ σ_eq = Y.
  return yieldXY * Math.sqrt(Math.max(0, twoF));
}

// ─── Per-element stress recovery ─────────────────────────────────────────────

/**
 * Compute von Mises stress at each element.
 *
 * Returns { vonMises, safetyFactor } arrays of length elementCount.
 */
export function recoverElementStress(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          AnyMaterial,
): {
  vonMises:      Float64Array;
  safetyFactor:  Float64Array;
  elemPrincipal: Float64Array;
  maxVonMises:   number;
  minSF:         number;
} {
  const C = buildAnyConstitutiveMatrix(mat);
  const yieldStr = 'kind' in mat ? (mat as import("./types.js").OrthotropicMaterial).yieldXY
                                 : (mat as IsotropicMaterial).yieldStrength;
  const vonMises     = new Float64Array(mesh.elementCount);
  const safetyFactor = new Float64Array(mesh.elementCount);
  const elemPrincipal = new Float64Array(mesh.elementCount * 3);

  let maxVM = 0;
  let minSF = 999;

  // 4-point Gauss quadrature points for tetrahedron (same as C3D10_GAUSS in element.ts)
  const GAUSS_PTS = [
    { xi:0.1381966, eta:0.1381966, zeta:0.1381966 },
    { xi:0.5854102, eta:0.1381966, zeta:0.1381966 },
    { xi:0.1381966, eta:0.5854102, zeta:0.1381966 },
    { xi:0.1381966, eta:0.1381966, zeta:0.5854102 },
  ];

  let _lastSig: [number, number, number] = [0, 0, 0];

  // Pre-allocate per-element scratch arrays outside the element loop.
  // Each is zeroed before use as needed (noted per array below).
  const _ue30        = new Float64Array(30);  // C3D10: element displacements
  const _nodeCoords  = new Float64Array(30);  // C3D10: element node coordinates
  const _sigAvg      = new Float64Array(6);   // C3D10: accumulated Gauss-point stress (zeroed per element)
  const _eps         = new Float64Array(6);   // strain vector (overwritten each Gauss pt)
  const _ue12        = new Float64Array(12);  // C3D4: element displacements
  const _eps4        = new Float64Array(6);   // C3D4: strain vector
  const _sig4        = new Float64Array(6);   // C3D4: stress vector

  for (let e = 0; e < mesh.elementCount; e++) {
    const npe  = mesh.nodesPerElem ?? 4;
    const base = e * npe;

    let vm = 0, sf = 999;

    if (npe === 10) {
      // ── C3D10: proper Gauss-point stress recovery ───────────────────────────
      // Evaluate B at each Gauss point, compute σ = C·B·u_e, average.
      // This is the superconvergent recovery location for quadratic elements.
      // Result is significantly more accurate than the C3D4 corner-node fallback,
      // especially at stress concentrations near holes.

      // Gather all 10 node displacements (30 entries) into pre-allocated scratch
      const ue30 = _ue30;
      for (let ni = 0; ni < 10; ni++) {
        const nodeIdx = i32(mesh.elements, base + ni);
        ue30[ni*3]   = f64(displacement, nodeIdx*3);
        ue30[ni*3+1] = f64(displacement, nodeIdx*3+1);
        ue30[ni*3+2] = f64(displacement, nodeIdx*3+2);
      }

      // Extract 10×3 node coordinates for this element into pre-allocated scratch
      const nodeCoords = _nodeCoords;
      for (let ni = 0; ni < 10; ni++) {
        const nodeIdx = i32(mesh.elements, base + ni);
        nodeCoords[ni*3]   = mesh.nodes[nodeIdx*3]   ?? 0;
        nodeCoords[ni*3+1] = mesh.nodes[nodeIdx*3+1] ?? 0;
        nodeCoords[ni*3+2] = mesh.nodes[nodeIdx*3+2] ?? 0;
      }

      // Average stress over 4 Gauss points (zero sigAvg before accumulating)
      const sigAvg = _sigAvg;
      sigAvg.fill(0);
      let nValidGP = 0;

      for (const gp of GAUSS_PTS) {
        try {
          const { B: B30 } = buildB_c3d10(nodeCoords, gp.xi, gp.eta, gp.zeta);

          // ε = B · u_e  (6×30 × 30 → 6) — reuse scratch eps
          const eps = _eps;
          for (let r = 0; r < 6; r++) {
            let s = 0;
            for (let c = 0; c < 30; c++) s += (B30[r*30+c]??0) * (ue30[c]??0);
            eps[r] = s;
          }

          // σ = C · ε (accumulate into sigAvg)
          for (let r = 0; r < 6; r++) {
            let s = 0;
            for (let c = 0; c < 6; c++) s += (C[r*6+c]??0) * (eps[c]??0);
            sigAvg[r] = (sigAvg[r] ?? 0) + s;
          }
          nValidGP++;
        } catch { /* degenerate Gauss point — skip */ }
      }

      if (nValidGP === 0) {
        // All 4 Gauss points had degenerate Jacobians — the element itself is
        // degenerate (inverted, collapsed, or near-zero volume). This means the
        // mesh is broken; silently reporting vm=0 / sf=999 would hide the problem
        // and potentially inflate the safety factor. Throw so the error surfaces
        // in the UI as a solver failure rather than a misleadingly safe result.
        throw new Error(
          `C3D10 element ${e}: all 4 Gauss points degenerate (zero Jacobian). ` +
          `The mesh may contain inverted or collapsed tetrahedra. ` +
          `Re-export the STL (check for non-manifold edges) and re-run.`
        );
      }
      for (let k = 0; k < 6; k++) sigAvg[k] = (sigAvg[k]??0) / nValidGP;

      const sxx=sigAvg[0]??0, syy=sigAvg[1]??0, szz=sigAvg[2]??0;
      const txy=sigAvg[3]??0, tyz=sigAvg[4]??0, txz=sigAvg[5]??0;

      _lastSig = computePrincipalStresses(sxx, syy, szz, txy, tyz, txz);
      vm = Math.sqrt(0.5*((sxx-syy)**2+(syy-szz)**2+(szz-sxx)**2+6*(txy**2+tyz**2+txz**2)));

      if (isOrthotropic(mat)) {
        const { yieldXY, yieldZ } = mat;
        const sigHill = hillEquivalentStress(sxx, syy, szz, txy, tyz, txz, yieldXY, yieldZ);
        sf = sigHill > 1e-12 ? yieldXY / sigHill : 999;
      } else {
        sf = vm > 1e-12 ? yieldStr/vm : 999;
      }

    } else {
      // ── C3D4: existing constant-strain formulation ──────────────────────────
      const n0 = i32(mesh.elements, base);
      const n1 = i32(mesh.elements, base + 1);
      const n2 = i32(mesh.elements, base + 2);
      const n3 = i32(mesh.elements, base + 3);

      const geom = computeGeometry(mesh.nodes, n0, n1, n2, n3);
      const B    = buildB(geom);

      // Use pre-allocated scratch arrays — no per-element heap allocations
      const ue = _ue12;
      const cornerNodes = [n0, n1, n2, n3] as const;
      for (let ni = 0; ni < 4; ni++) {
        const nodeIdx = cornerNodes[ni] ?? 0;
        ue[ni*3]   = f64(displacement, nodeIdx*3);
        ue[ni*3+1] = f64(displacement, nodeIdx*3+1);
        ue[ni*3+2] = f64(displacement, nodeIdx*3+2);
      }

      const eps = _eps4;
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let c = 0; c < 12; c++) s += (B[r*12+c]??0) * (ue[c]??0);
        eps[r] = s;
      }

      const sig = _sig4;
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let c = 0; c < 6; c++) s += (C[r*6+c]??0) * (eps[c]??0);
        sig[r] = s;
      }

      const sxx=sig[0]??0, syy=sig[1]??0, szz=sig[2]??0;
      const txy=sig[3]??0, tyz=sig[4]??0, txz=sig[5]??0;

      _lastSig = computePrincipalStresses(sxx, syy, szz, txy, tyz, txz);
      vm = Math.sqrt(0.5*((sxx-syy)**2+(syy-szz)**2+(szz-sxx)**2+6*(txy**2+tyz**2+txz**2)));

      if (!isFinite(vm)) {
        throw new Error(`Non-finite von Mises at element ${e}: σ=[${sxx},${syy},${szz},${txy},${tyz},${txz}]`);
      }

      if (isOrthotropic(mat)) {
        const { yieldXY, yieldZ } = mat;
        const sigHill = hillEquivalentStress(sxx, syy, szz, txy, tyz, txz, yieldXY, yieldZ);
        sf = sigHill > 1e-12 ? yieldXY / sigHill : 999;
      } else {
        sf = vm > 1e-12 ? yieldStr/vm : 999;
      }
    }

    sf = Math.min(Math.max(sf, 0), 999);
    if (!isFinite(vm)) vm = 0;

    vonMises[e]     = vm;
    safetyFactor[e] = sf;
    if (vm > maxVM) maxVM = vm;
    if (sf < minSF) minSF = sf;

    // Principal stresses — re-read sxx/syy/szz/txy/tyz/txz from the sig/sigAvg
    // arrays computed above. We store them as a closure variable set per-branch.
    const [ps1, ps2, ps3] = _lastSig;
    elemPrincipal[e*3]   = ps1;
    elemPrincipal[e*3+1] = ps2;
    elemPrincipal[e*3+2] = ps3;
  }

  return { vonMises, safetyFactor, elemPrincipal, maxVonMises: maxVM, minSF };
}

// ─── SPR (Superconvergent Patch Recovery) stress smoothing ───────────────────
/**
 * Zienkiewicz-Zhu SPR stress recovery for C3D4 elements.
 *
 * For each node n, collect the patch P(n) = all elements sharing node n.
 * Fit a linear polynomial to the element centroid stresses in the patch:
 *   σ(x,y,z) = a0 + a1·x + a2·y + a3·z
 * using least-squares. Evaluate the fitted polynomial at the node location
 * to get a smoothed nodal stress.
 *
 * This is more accurate than direct averaging for stress concentrations
 * (typically 10-20% improvement for C3D4, Zienkiewicz & Zhu 1992).
 *
 * For patches with < 4 elements (boundary nodes), falls back to direct averaging
 * since the least-squares system is underdetermined.
 *
 * Reference: Zienkiewicz OC, Zhu JZ. The superconvergent patch recovery
 * and a posteriori error estimates. Int J Numer Methods Eng. 1992;33(7).
 */
export function sprSmoothedStress(
  mesh:     TetMesh,
  vonMises: Float64Array,
): Float64Array {
  const nodeStress = new Float64Array(mesh.nodeCount);
  const nodeCount  = new Int32Array(mesh.nodeCount);

  // Build node → element connectivity
  // For C3D10, we only associate corner nodes (0-3) with each element.
  // Midside nodes (4-9) also get entries, but their patches may be small.
  const npe = mesh.nodesPerElem ?? 4;
  const nodeElements: number[][] = Array.from({ length: mesh.nodeCount }, () => []);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    // Use all nodes (corner + midside) — SPR handles small patches via fallback
    for (let ni = 0; ni < npe; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      nodeElements[nodeIdx]!.push(e);
    }
  }

  // Compute element centroid coordinates
  const elemCentX = new Float64Array(mesh.elementCount);
  const elemCentY = new Float64Array(mesh.elementCount);
  const elemCentZ = new Float64Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 4;
    let cx = 0, cy = 0, cz = 0;
    for (let ni = 0; ni < 4; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      cx += mesh.nodes[n * 3]     ?? 0;
      cy += mesh.nodes[n * 3 + 1] ?? 0;
      cz += mesh.nodes[n * 3 + 2] ?? 0;
    }
    elemCentX[e] = cx / 4;
    elemCentY[e] = cy / 4;
    elemCentZ[e] = cz / 4;
  }

  // Pre-allocate SPR scratch arrays outside node loop to avoid per-node heap allocations.
  // M rows are fully overwritten each iteration, so no zeroing is needed.
  const _sprM: [Float64Array, Float64Array, Float64Array, Float64Array] = [
    new Float64Array(5),
    new Float64Array(5),
    new Float64Array(5),
    new Float64Array(5),
  ];
  const _sprA = new Float64Array(4);  // back-substitution result

  // For each node: SPR fit or fallback to averaging
  for (let n = 0; n < mesh.nodeCount; n++) {
    const patch = nodeElements[n]!;
    if (patch.length === 0) continue;

    const nx = mesh.nodes[n * 3]     ?? 0;
    const ny = mesh.nodes[n * 3 + 1] ?? 0;
    const nz = mesh.nodes[n * 3 + 2] ?? 0;

    if (patch.length < 4) {
      // Insufficient patch — direct average
      let sum = 0;
      for (const e of patch) sum += vonMises[e] ?? 0;
      nodeStress[n] = sum / patch.length;
      nodeCount[n]  = patch.length;
      continue;
    }

    // Build least-squares system A·a = b
    // A is (patchSize × 4), b is (patchSize × 1)
    // Polynomial basis: [1, x, y, z]
    // Normal equations: (Aᵀ A) a = Aᵀ b  →  4×4 system

    let AtA00=0, AtA01=0, AtA02=0, AtA03=0;
    let AtA11=0, AtA12=0, AtA13=0;
    let AtA22=0, AtA23=0, AtA33=0;
    let Atb0=0, Atb1=0, Atb2=0, Atb3=0;

    for (const e of patch) {
      const cx = elemCentX[e] ?? 0;
      const cy = elemCentY[e] ?? 0;
      const cz = elemCentZ[e] ?? 0;
      const sv = vonMises[e] ?? 0;

      AtA00 += 1;      AtA01 += cx;     AtA02 += cy;     AtA03 += cz;
      AtA11 += cx*cx;  AtA12 += cx*cy;  AtA13 += cx*cz;
      AtA22 += cy*cy;  AtA23 += cy*cz;
      AtA33 += cz*cz;
      Atb0  += sv;     Atb1  += sv*cx;  Atb2  += sv*cy;  Atb3  += sv*cz;
    }

    // Solve 4×4 symmetric system via Gaussian elimination with partial pivoting
    // Build augmented matrix [AtA | Atb] using pre-allocated rows
    const M = _sprM;
    M[0][0]=AtA00; M[0][1]=AtA01; M[0][2]=AtA02; M[0][3]=AtA03; M[0][4]=Atb0;
    M[1][0]=AtA01; M[1][1]=AtA11; M[1][2]=AtA12; M[1][3]=AtA13; M[1][4]=Atb1;
    M[2][0]=AtA02; M[2][1]=AtA12; M[2][2]=AtA22; M[2][3]=AtA23; M[2][4]=Atb2;
    M[3][0]=AtA03; M[3][1]=AtA13; M[3][2]=AtA23; M[3][3]=AtA33; M[3][4]=Atb3;

    // Gaussian elimination
    let solveFailed = false;
    for (let col = 0; col < 4; col++) {
      // Partial pivoting
      let maxRow = col, maxVal = Math.abs(M[col]![col]!);
      for (let row = col + 1; row < 4; row++) {
        if (Math.abs(M[row]![col]!) > maxVal) {
          maxVal = Math.abs(M[row]![col]!);
          maxRow = row;
        }
      }
      if (maxVal < 1e-12) { solveFailed = true; break; }
      [M[col], M[maxRow]] = [M[maxRow]!, M[col]!];

      const pivot = M[col]![col]!;
      for (let row = col + 1; row < 4; row++) {
        const factor = M[row]![col]! / pivot;
        for (let k = col; k <= 4; k++) {
          M[row]![k]! -= factor * M[col]![k]!;
        }
      }
    }

    if (solveFailed) {
      // Fallback to average
      let sum = 0;
      for (const e of patch) sum += vonMises[e] ?? 0;
      nodeStress[n] = sum / patch.length;
      nodeCount[n]  = patch.length;
      continue;
    }

    // Back substitution — use pre-allocated buffer
    const a = _sprA;
    for (let row = 3; row >= 0; row--) {
      let sum = M[row]![4]!;
      for (let col = row + 1; col < 4; col++) {
        sum -= M[row]![col]! * a[col]!;
      }
      a[row] = sum / M[row]![row]!;
    }

    // Evaluate polynomial at node position
    const smoothed = a[0]! + a[1]! * nx + a[2]! * ny + a[3]! * nz;
    // Clamp to non-negative (stress can't be negative in von Mises sense)
    nodeStress[n] = Math.max(0, smoothed);
    nodeCount[n]  = patch.length;
  }

  return nodeStress;
}

/**
 * Average element von Mises stresses at nodes (direct averaging — fallback).
 * Used when SPR is not appropriate (e.g. very coarse meshes).
 */
export function nodeAveragedStress(
  mesh:      TetMesh,
  vonMises:  Float64Array,
): Float64Array {
  const nodeStress = new Float64Array(mesh.nodeCount);
  const nodeCount  = new Int32Array(mesh.nodeCount);

  const npeAvg = mesh.nodesPerElem ?? 4;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npeAvg;
    const vm   = vonMises[e] ?? 0;
    for (let ni = 0; ni < npeAvg; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      nodeStress[nodeIdx] = (nodeStress[nodeIdx] ?? 0) + vm;
      nodeCount[nodeIdx]  = (nodeCount[nodeIdx]  ?? 0) + 1;
    }
  }

  for (let i = 0; i < mesh.nodeCount; i++) {
    const cnt = nodeCount[i] ?? 0;
    if (cnt > 0) nodeStress[i] = (nodeStress[i] ?? 0) / cnt;
  }

  return nodeStress;
}

// ─── Max displacement ─────────────────────────────────────────────────────────

export function maxDisplacement(displacement: Float64Array): number {
  const n = displacement.length / 3;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const ux = displacement[i * 3]     ?? 0;
    const uy = displacement[i * 3 + 1] ?? 0;
    const uz = displacement[i * 3 + 2] ?? 0;
    const d  = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

// ─── Node-averaged principal stress ──────────────────────────────────────────

/**
 * Average element principal stresses (σ1, σ2, σ3) at shared nodes.
 * Returns a flat Float64Array of length nodeCount×3: [σ1₀,σ2₀,σ3₀, σ1₁,...].
 */
export function nodeAveragedPrincipalStress(
  mesh:         TetMesh,
  elemPrincipal: Float64Array,
): Float64Array {
  const nodePrincipal = new Float64Array(mesh.nodeCount * 3);
  const nodeCount     = new Int32Array(mesh.nodeCount);
  const npe = mesh.nodesPerElem ?? 4;

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const ps1 = elemPrincipal[e*3]   ?? 0;
    const ps2 = elemPrincipal[e*3+1] ?? 0;
    const ps3 = elemPrincipal[e*3+2] ?? 0;
    for (let ni = 0; ni < npe; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      nodePrincipal[n*3]   = (nodePrincipal[n*3]   ?? 0) + ps1;
      nodePrincipal[n*3+1] = (nodePrincipal[n*3+1] ?? 0) + ps2;
      nodePrincipal[n*3+2] = (nodePrincipal[n*3+2] ?? 0) + ps3;
      nodeCount[n] = (nodeCount[n] ?? 0) + 1;
    }
  }

  for (let n = 0; n < mesh.nodeCount; n++) {
    const cnt = nodeCount[n] ?? 0;
    if (cnt > 0) {
      nodePrincipal[n*3]   = (nodePrincipal[n*3]   ?? 0) / cnt;
      nodePrincipal[n*3+1] = (nodePrincipal[n*3+1] ?? 0) / cnt;
      nodePrincipal[n*3+2] = (nodePrincipal[n*3+2] ?? 0) / cnt;
    }
  }

  return nodePrincipal;
}

// ─── Zienkiewicz-Zhu error estimation ──────────────────────────────────────
/**
 * Compute per-element Zienkiewicz-Zhu error estimates from SPR-smoothed stress.
 *
 * For each element, the energy-norm error is estimated as:
 *   η_e = ‖σ_SPR − σ_centroid‖_energy,e / ‖σ_global‖_energy
 *
 * where σ_SPR is interpolated from nodal values (result of sprSmoothedStress)
 * to the element centroid, and σ_centroid is the recovered stress at the centroid.
 *
 * The energy norm at an element is:
 *   ‖σ‖²_energy,e = σᵀ · C⁻¹ · σ
 *
 * where C is the constitutive matrix. For isotropic material:
 *   C⁻¹[i,j] = ((1+ν)/E) · δ_ij − (ν/(1+ν)) · I_1 (trace term)
 *
 * Reference: Zienkiewicz OC, Zhu JZ. The superconvergent patch recovery
 * and a posteriori error estimates. Int J Numer Methods Eng. 1992;33(7):1331–64.
 */
export function computeZZErrorEstimate(
  mesh:           TetMesh,
  vonMises:       Float64Array,
  sprStress:      Float64Array | null,  // per-node von Mises from SPR (or null for fallback)
  mat:            AnyMaterial,
): {
  errorEstimate:      Float32Array;
  globalRelativeError: number;
  topErrorElements:   Array<{ x: number; y: number; z: number; errorEstimate: number }>;
} {
  const errorEstimate = new Float32Array(mesh.elementCount);
  let errorSum2 = 0;      // Σ η_e²
  let stressNormSum2 = 0; // Σ ‖σ_e‖²_energy

  // Get material properties for energy-norm calculation
  const E = 'kind' in mat ? (mat as import("./types.js").OrthotropicMaterial).E_xy
                          : (mat as IsotropicMaterial).E;
  const nu = 'kind' in mat ? (mat as import("./types.js").OrthotropicMaterial).nu_xy
                           : (mat as IsotropicMaterial).nu;

  // Energy-norm normalization constants
  const invE = 1.0 / E;
  const factor1 = (1 + nu) * invE;
  const factor2 = -nu * invE / (1 + nu);

  // Compute element centroid coordinates (reuse from sprSmoothedStress pattern)
  const elemCentX = new Float64Array(mesh.elementCount);
  const elemCentY = new Float64Array(mesh.elementCount);
  const elemCentZ = new Float64Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 4;
    let cx = 0, cy = 0, cz = 0;
    for (let ni = 0; ni < 4; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      cx += mesh.nodes[n * 3]     ?? 0;
      cy += mesh.nodes[n * 3 + 1] ?? 0;
      cz += mesh.nodes[n * 3 + 2] ?? 0;
    }
    elemCentX[e] = cx / 4;
    elemCentY[e] = cy / 4;
    elemCentZ[e] = cz / 4;
  }

  // Build node → element connectivity (same pattern as SPR)
  const npe = mesh.nodesPerElem ?? 4;
  const nodeElements: number[][] = Array.from({ length: mesh.nodeCount }, () => []);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < npe; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      nodeElements[nodeIdx]!.push(e);
    }
  }

  // If SPR stress not provided, fall back to direct averaging (lower accuracy)
  const nodeSprStress = sprStress ?? nodeAveragedStress(mesh, vonMises);

  // Interpolate SPR stress to element centroids using patch-weighted average
  for (let e = 0; e < mesh.elementCount; e++) {
    const npe4 = mesh.nodesPerElem ?? 4;
    const base = e * npe4;

    // Get element nodes
    const elemNodes: number[] = [];
    for (let ni = 0; ni < Math.min(4, npe4); ni++) {
      elemNodes.push(mesh.elements[base + ni] ?? 0);
    }

    // Interpolate nodal SPR stress to centroid using distance-weighted average
    let sprAtCentroid = 0;
    let totalWeight = 0;
    const cx = elemCentX[e]!;
    const cy = elemCentY[e]!;
    const cz = elemCentZ[e]!;

    for (const n of elemNodes) {
      const nx = mesh.nodes[n * 3]     ?? 0;
      const ny = mesh.nodes[n * 3 + 1] ?? 0;
      const nz = mesh.nodes[n * 3 + 2] ?? 0;
      const dist2 = (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) + (cz - nz) * (cz - nz);
      const weight = dist2 < 1e-12 ? 1e6 : 1.0 / (1.0 + dist2); // Nodes very close → higher weight
      sprAtCentroid += (nodeSprStress[n] ?? 0) * weight;
      totalWeight += weight;
    }
    sprAtCentroid = totalWeight > 0 ? sprAtCentroid / totalWeight : (vonMises[e] ?? 0);

    // Energy norm of error: ‖σ_SPR − σ_centroid‖²_energy
    const errStress = sprAtCentroid - (vonMises[e] ?? 0);
    // Von Mises is scalar, but energy norm uses full tensor. Approximate with von Mises magnitude:
    const errEnergy2 = errStress * errStress * factor1;

    // Energy norm of element centroid stress for normalization
    const vm = vonMises[e] ?? 0;
    const stressEnergy2 = vm * vm * factor1;

    errorSum2 += errEnergy2;
    stressNormSum2 += stressEnergy2;

    // Per-element error estimate (0–1): relative to global norm
    // For now, store as magnitude; will normalize after global norm is known
    errorEstimate[e] = Math.sqrt(Math.max(0, errEnergy2));
  }

  // Global normalization
  const globalEnergyNorm = Math.sqrt(Math.max(1e-12, stressNormSum2));
  const globalRelativeError = globalEnergyNorm > 1e-12 ? Math.sqrt(errorSum2) / globalEnergyNorm : 0;

  // Normalize per-element estimates by global norm
  for (let e = 0; e < mesh.elementCount; e++) {
    errorEstimate[e] = globalEnergyNorm > 1e-12 ? (errorEstimate[e]! / globalEnergyNorm) : 0;
  }

  // Find top-20 elements by error estimate
  const indexedErrors = Array.from({ length: mesh.elementCount }, (_, i) => ({
    index: i,
    error: errorEstimate[i] ?? 0,
  }));
  indexedErrors.sort((a, b) => b.error - a.error);

  const topErrorElements = indexedErrors.slice(0, 20).map(({ index }) => ({
    x: elemCentX[index]!,
    y: elemCentY[index]!,
    z: elemCentZ[index]!,
    errorEstimate: errorEstimate[index]!,
  }));

  return { errorEstimate, globalRelativeError, topErrorElements };
}

// ─── Package stress results ───────────────────────────────────────────────────

/**
 * Build the final SolverResult from raw displacement and CG metadata.
 */
export function buildSolverResult(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          AnyMaterial,
  cgIterations: number,
  converged:    boolean,
  solverMs:     number,
  residualCheckpoints?: readonly { iteration: number; relativeResidual: number }[],
  computeErrorEstimate: boolean = true,
): SolverResult {
  const { vonMises, safetyFactor, elemPrincipal, maxVonMises, minSF } =
    recoverElementStress(mesh, displacement, mat);

  // Compute Zienkiewicz-Zhu error estimates if requested
  let errorEstimate: Float32Array | undefined;
  let globalRelativeError: number | undefined;
  let topErrorElements: Array<{ x: number; y: number; z: number; errorEstimate: number }> | undefined;

  if (computeErrorEstimate) {
    const sprStress = sprSmoothedStress(mesh, vonMises);
    const { errorEstimate: ee, globalRelativeError: gre, topErrorElements: tee } =
      computeZZErrorEstimate(mesh, vonMises, sprStress, mat);
    errorEstimate = ee;
    globalRelativeError = gre;
    topErrorElements = tee;
  }

  return {
    displacement,
    vonMises,
    safetyFactor,
    maxDisplacementMm:   maxDisplacement(displacement),
    maxVonMisesMPa:      maxVonMises,
    minSafetyFactor:     minSF,
    cgIterations,
    converged,
    solverMs,
    nodePrincipalStress: nodeAveragedPrincipalStress(mesh, elemPrincipal),
    residualCheckpoints,
    errorEstimate,
    globalRelativeError,
    topErrorElements,
  };
}

// Re-export buildB so stress.ts is the only external consumer of element internals
export { buildB as buildStrainDisplacementMatrix };
