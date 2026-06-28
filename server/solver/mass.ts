/**
 * mass.ts
 * -------
 * Consistent global mass matrix assembly for C3D4 and C3D10 tetrahedral elements.
 *
 * Unit system: mm / N / MPa / tonne
 *   Density rho in tonne/mm³  (e.g. PLA = 1.24e-9, steel = 7.85e-9)
 *   In this system: 1 N = 1 tonne·mm/s², so eigenvalue ω² has units rad²/s²
 *   directly and f_Hz = sqrt(ω²) / (2π) with no conversion factor.
 */

import type { TetMesh, CSRMatrix } from "./types.js";
import { buildSparsityPattern } from "./assembly.js";

// ─── Internal helper: compute 4-node tet volume ────────────────────────────────

function tetVolume(
  nodes: Float64Array,
  n0: number, n1: number, n2: number, n3: number,
): number {
  const x0 = nodes[n0*3] ?? 0, y0 = nodes[n0*3+1] ?? 0, z0 = nodes[n0*3+2] ?? 0;
  const x1 = nodes[n1*3] ?? 0, y1 = nodes[n1*3+1] ?? 0, z1 = nodes[n1*3+2] ?? 0;
  const x2 = nodes[n2*3] ?? 0, y2 = nodes[n2*3+1] ?? 0, z2 = nodes[n2*3+2] ?? 0;
  const x3 = nodes[n3*3] ?? 0, y3 = nodes[n3*3+1] ?? 0, z3 = nodes[n3*3+2] ?? 0;

  const a1 = x1-x0, b1 = y1-y0, c1 = z1-z0;
  const a2 = x2-x0, b2 = y2-y0, c2 = z2-z0;
  const a3 = x3-x0, b3 = y3-y0, c3 = z3-z0;
  const sixV = a1*(b2*c3 - b3*c2) - b1*(a2*c3 - a3*c2) + c1*(a2*b3 - a3*b2);
  return Math.abs(sixV) / 6;
}

// ─── Binary search helper ─────────────────────────────────────────────────────

function findEntry(colIdx: Int32Array, rowPtr: Int32Array, row: number, col: number): number {
  const start = rowPtr[row] ?? 0;
  const end   = rowPtr[row + 1] ?? colIdx.length;
  let lo = start, hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c   = colIdx[mid] ?? -1;
    if (c === col) return mid;
    if (c < col) lo = mid + 1; else hi = mid - 1;
  }
  throw new Error(`CSR entry not found for mass matrix: row=${row} col=${col}`);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Assemble the consistent global mass matrix M in CSR format.
 *
 * rho — material density in TONNE/mm³ (e.g. steel = 7.85e-9 t/mm³).
 *
 * For C3D4: consistent element mass matrix
 *   m_e[3a+d, 3b+d] = rho*Ve/20 * (2 if a==b, else 1), d ∈ {0,1,2}, a,b ∈ {0,1,2,3}
 *
 * For C3D10: exact analytical formula using pre-computed reference mass matrix entries.
 *
 * Sparsity pattern is identical to K (same mesh connectivity).
 */
export function assembleM(
  mesh: TetMesh,
  rho:  number,
): { M: CSRMatrix; diagIdx: Int32Array } {
  const n   = mesh.nodeCount * 3;
  const npe = mesh.nodesPerElem;

  const { rowPtr, colIdx, diagIdx } = buildSparsityPattern(mesh);
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  const elemNodes = new Int32Array(npe);

  if (npe === 4) {
    // ── C3D4 consistent mass ───────────────────────────────────────────────────
    // Element mass matrix: m_e[3a+d, 3b+d] = rho * Ve / 20 * (a==b ? 2 : 1)
    for (let e = 0; e < mesh.elementCount; e++) {
      const base = e * 4;
      const n0 = mesh.elements[base] ?? 0;
      const n1 = mesh.elements[base+1] ?? 0;
      const n2 = mesh.elements[base+2] ?? 0;
      const n3 = mesh.elements[base+3] ?? 0;

      elemNodes[0] = n0; elemNodes[1] = n1; elemNodes[2] = n2; elemNodes[3] = n3;

      const Ve = tetVolume(mesh.nodes, n0, n1, n2, n3);
      const scale = rho * Ve / 20;

      // Scatter: for each pair (a, b) of corner nodes and each DOF direction d
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          const mval = scale * (a === b ? 2.0 : 1.0);
          const na = elemNodes[a]!;
          const nb = elemNodes[b]!;
          for (let d = 0; d < 3; d++) {
            const globalR = na * 3 + d;
            const globalC = nb * 3 + d;
            const pos = findEntry(colIdx, rowPtr, globalR, globalC);
            data[pos] = (data[pos] ?? 0) + mval;
          }
        }
      }
    }
  } else if (npe === 10) {
    // ── C3D10 consistent mass (exact analytical formula) ──────────────────────
    //
    // Reference mass matrix M_ref (10×10) for unit tet (V=1/6, ρ=1):
    //   Exact integrals ∫ N_i N_j dV computed analytically (see compute_exact_mass.ts).
    //   All entries from barycentric polynomial integration: ∫ L0^a L1^b L2^c L3^d = a!b!c!d!/(a+b+c+d+3)!
    //
    // Node ordering: corners 0-3, midpoints 4-9 with EDGE_PAIRS = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]]
    // Entry types and values (reference, ρ=1, V=1/6):
    //   CC diagonal (corner=corner):        +0.002380952381  (= 1/420)
    //   CC off-diagonal (corner≠corner):    +0.000396825397  (= 1/2520)
    //   CM adjacent (corner on edge):       -0.001587301587  (= -1/630)
    //   CM opposite (corner not on edge):   -0.002380952381  (= -1/420)
    //   MM diagonal (same midpoint):        +0.012698412698  (= 8/630)
    //   MM adjacent (share barycentric):    +0.006349206349  (= 4/630)
    //   MM opposite (no shared coord):      +0.003174603175  (= 2/630)
    //
    // Physical element: scale = ρ × |detJ| = ρ × 6 × Ve  (for flat-sided tet with Ve = volume)
    //   M_e[a,b] = scale × M_ref[a,b]  (per direction d: m_e[3a+d, 3b+d] = scale × M_ref[a,b])

    // Pre-computed reference mass matrix values
    const MR_CC_DIAG = 1.0 / 420.0;           //  0.002380952381
    const MR_CC_OFF  = 1.0 / 2520.0;          //  0.000396825397
    const MR_CM_ADJ  = -1.0 / 630.0;          // -0.001587301587
    const MR_CM_OPP  = -1.0 / 420.0;          // -0.002380952381
    const MR_MM_DIAG = 8.0 / 630.0;           //  0.012698412698
    const MR_MM_ADJ  = 4.0 / 630.0;           //  0.006349206349
    const MR_MM_OPP  = 2.0 / 630.0;           //  0.003174603175

    // Edge pairs: midpoint index 4+ep connects corners EDGE_PAIRS[ep][0] and EDGE_PAIRS[ep][1]
    const EDGE_PAIRS: readonly [number, number][] = [
      [0,1], [1,2], [0,2], [0,3], [1,3], [2,3]
    ];

    for (let e = 0; e < mesh.elementCount; e++) {
      const base = e * 10;
      for (let ni = 0; ni < 10; ni++) {
        elemNodes[ni] = mesh.elements[base + ni] ?? 0;
      }

      // Compute element volume using corner nodes (indices 0-3)
      const n0 = elemNodes[0]!, n1 = elemNodes[1]!, n2 = elemNodes[2]!, n3 = elemNodes[3]!;
      const Ve = tetVolume(mesh.nodes, n0, n1, n2, n3);

      // Scale = ρ × 6 × Ve  (because M_ref is for unit tet with V_ref = 1/6)
      const scale = rho * 6.0 * Ve;

      // Scatter: for each pair (a, b) of local nodes and each DOF direction d
      for (let a = 0; a < 10; a++) {
        for (let b = 0; b < 10; b++) {
          // Determine entry type for M_ref[a,b]
          let mref: number;
          const aIsCorner = a < 4;
          const bIsCorner = b < 4;

          if (aIsCorner && bIsCorner) {
            mref = (a === b) ? MR_CC_DIAG : MR_CC_OFF;
          } else if (aIsCorner && !bIsCorner) {
            // b is midpoint: edge index (b-4), corners are EDGE_PAIRS[b-4]
            const [ep0, ep1] = EDGE_PAIRS[b - 4]!;
            mref = (a === ep0 || a === ep1) ? MR_CM_ADJ : MR_CM_OPP;
          } else if (!aIsCorner && bIsCorner) {
            // a is midpoint
            const [ep0, ep1] = EDGE_PAIRS[a - 4]!;
            mref = (b === ep0 || b === ep1) ? MR_CM_ADJ : MR_CM_OPP;
          } else {
            // Both midpoints
            if (a === b) {
              mref = MR_MM_DIAG;
            } else {
              const [a0, a1] = EDGE_PAIRS[a - 4]!;
              const [b0, b1] = EDGE_PAIRS[b - 4]!;
              const shareCoord = (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1);
              mref = shareCoord ? MR_MM_ADJ : MR_MM_OPP;
            }
          }

          const mval = scale * mref;
          if (mval === 0) continue;
          const na = elemNodes[a]!;
          const nb = elemNodes[b]!;
          for (let d = 0; d < 3; d++) {
            const globalR = na * 3 + d;
            const globalC = nb * 3 + d;
            const pos = findEntry(colIdx, rowPtr, globalR, globalC);
            data[pos] = (data[pos] ?? 0) + mval;
          }
        }
      }
    }
  } else {
    throw new Error(`assembleM: unsupported nodesPerElem=${npe}`);
  }

  return {
    M: { n, data, colIdx, rowPtr },
    diagIdx,
  };
}
