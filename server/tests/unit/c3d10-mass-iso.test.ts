/**
 * c3d10-mass-iso.test.ts
 * ----------------------
 * Issue #158: the C3D10 consistent mass used a fixed reference matrix scaled by
 * the CORNER-tet volume — exact only for straight-sided (affine) elements, while
 * the stiffness path integrates isoparametrically. A curved (Gmsh high-order)
 * element therefore carried a large mass error.
 *
 * Fix = hybrid:
 *   - affine element  → exact closed form (bit-identical regression anchor)
 *   - curved element  → isoparametric ∫ρ NᵢNⱼ|detJ|dV, degree-7-exact 125-pt rule
 *
 * These tests verify: affine bit-identity, curved correctness against an
 * INDEPENDENT high-order reference, mass conservation, and positive-definiteness.
 */

import { describe, it, expect } from "vitest";
import {
  isAffineC3D10,
  c3d10IsoparametricMass,
  c3d10Volume,
} from "../../solver/element.js";
import { assembleMass } from "../../solver/mass.js";
import type { TetMesh, IsotropicMaterial, CSRMatrix } from "../../solver/types.js";

// EDGE_PAIRS ordering: midpoint 4+ep connects corners EDGE_PAIRS[ep].
const EDGE_PAIRS: [number, number][] = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]];

/** Build a 30-length C3D10 node array from 4 corners; midpoints at edge centres. */
function affineNodes(corners: number[][]): Float64Array {
  const n: number[] = [];
  for (const p of corners) n.push(p[0]!, p[1]!, p[2]!);
  for (const [i, j] of EDGE_PAIRS) {
    n.push(
      (corners[i]![0]! + corners[j]![0]!) / 2,
      (corners[i]![1]! + corners[j]![1]!) / 2,
      (corners[i]![2]! + corners[j]![2]!) / 2,
    );
  }
  return new Float64Array(n);
}

// ── Independent high-order reference integrator (Duffy n=6, GL nodes via Newton
//    — deliberately DIFFERENT order from production's hardcoded n=5) ────────────
function gaussLegendre01(nn: number): { x: number; w: number }[] {
  const out: { x: number; w: number }[] = [];
  for (let i = 0; i < nn; i++) {
    let x = Math.cos(Math.PI * (i + 0.75) / (nn + 0.5));
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= nn; k++) { const p2 = ((2*k-1)*x*p1 - (k-1)*p0)/k; p0 = p1; p1 = p2; }
      const dp = nn * (x * p1 - p0) / (x*x - 1);
      const dx = -p1 / dp; x += dx; if (Math.abs(dx) < 1e-15) break;
    }
    let p0 = 1, p1 = x;
    for (let k = 2; k <= nn; k++) { const p2 = ((2*k-1)*x*p1 - (k-1)*p0)/k; p0 = p1; p1 = p2; }
    const dp = nn * (x * p1 - p0) / (x*x - 1);
    out.push({ x: 0.5 * (x + 1), w: 0.5 * (2 / ((1 - x*x) * dp * dp)) });
  }
  return out;
}
function shapeN(xi: number, eta: number, zeta: number): number[] {
  const d = 1 - xi - eta - zeta;
  return [xi*(2*xi-1), eta*(2*eta-1), zeta*(2*zeta-1), d*(2*d-1),
          4*xi*eta, 4*eta*zeta, 4*xi*zeta, 4*xi*d, 4*eta*d, 4*zeta*d];
}
function refDetJ(nodes: Float64Array, xi: number, eta: number, zeta: number): number {
  const d = 1 - xi - eta - zeta;
  const dxi  = [4*xi-1,0,0,-(4*d-1), 4*eta,0,4*zeta,4*(d-xi),-4*eta,-4*zeta];
  const det  = [0,4*eta-1,0,-(4*d-1), 4*xi,4*zeta,0,-4*xi,4*(d-eta),-4*zeta];
  const dze  = [0,0,4*zeta-1,-(4*d-1), 0,4*eta,4*xi,-4*xi,-4*eta,4*(d-zeta)];
  let J = [0,0,0,0,0,0,0,0,0];
  for (let i = 0; i < 10; i++) {
    const x = nodes[i*3]!, y = nodes[i*3+1]!, z = nodes[i*3+2]!;
    J[0]! += dxi[i]!*x; J[1]! += dxi[i]!*y; J[2]! += dxi[i]!*z;
    J[3]! += det[i]!*x; J[4]! += det[i]!*y; J[5]! += det[i]!*z;
    J[6]! += dze[i]!*x; J[7]! += dze[i]!*y; J[8]! += dze[i]!*z;
  }
  return J[0]!*(J[4]!*J[8]!-J[5]!*J[7]!) - J[1]!*(J[3]!*J[8]!-J[5]!*J[6]!) + J[2]!*(J[3]!*J[7]!-J[4]!*J[6]!);
}
/** Reference 10×10 mass block via an independent Duffy-6 rule. */
function refMass(nodes: Float64Array): Float64Array {
  const gl = gaussLegendre01(6);
  const M = new Float64Array(100);
  for (const u of gl) for (const v of gl) for (const t of gl) {
    const xi = u.x, eta = v.x*(1-u.x), zeta = t.x*(1-u.x)*(1-v.x);
    const jac = (1-u.x)*(1-u.x)*(1-v.x);
    const w = u.w*v.w*t.w*jac * Math.abs(refDetJ(nodes, xi, eta, zeta));
    const N = shapeN(xi, eta, zeta);
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) M[a*10+b]! += N[a]!*N[b]!*w;
  }
  return M;
}
/** Legacy corner-only reference formula (the OLD, affine-assuming mass block). */
function cornerFormulaMass(nodes: Float64Array): Float64Array {
  const MR_CC_DIAG=1/420, MR_CC_OFF=1/2520, MR_CM_ADJ=-1/630, MR_CM_OPP=-1/420,
        MR_MM_DIAG=8/630, MR_MM_ADJ=4/630, MR_MM_OPP=2/630;
  const vol = (() => {
    const ax=nodes[0]!,ay=nodes[1]!,az=nodes[2]!, bx=nodes[3]!,by=nodes[4]!,bz=nodes[5]!,
          cx=nodes[6]!,cy=nodes[7]!,cz=nodes[8]!, dx=nodes[9]!,dy=nodes[10]!,dz=nodes[11]!;
    return Math.abs((bx-ax)*((cy-ay)*(dz-az)-(cz-az)*(dy-ay))
      -(by-ay)*((cx-ax)*(dz-az)-(cz-az)*(dx-ax))
      +(bz-az)*((cx-ax)*(dy-ay)-(cy-ay)*(dx-ax)))/6;
  })();
  const scale = 6*vol; const M = new Float64Array(100);
  for (let a=0;a<10;a++) for (let b=0;b<10;b++) {
    let m; const ac=a<4, bc=b<4;
    if (ac&&bc) m=(a===b)?MR_CC_DIAG:MR_CC_OFF;
    else if (ac&&!bc){const[e0,e1]=EDGE_PAIRS[b-4]!;m=(a===e0||a===e1)?MR_CM_ADJ:MR_CM_OPP;}
    else if (!ac&&bc){const[e0,e1]=EDGE_PAIRS[a-4]!;m=(b===e0||b===e1)?MR_CM_ADJ:MR_CM_OPP;}
    else { if (a===b) m=MR_MM_DIAG; else {const[a0,a1]=EDGE_PAIRS[a-4]!,[b0,b1]=EDGE_PAIRS[b-4]!;
      m=(a0===b0||a0===b1||a1===b0||a1===b1)?MR_MM_ADJ:MR_MM_OPP;} }
    M[a*10+b] = scale*m;
  }
  return M;
}
function maxAbsDiff(A: Float64Array, B: Float64Array): number {
  let m = 0; for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs((A[i]??0)-(B[i]??0))); return m;
}
function frob(A: Float64Array): number { let s=0; for (let i=0;i<A.length;i++) s+=(A[i]??0)**2; return Math.sqrt(s); }
function sum(A: Float64Array): number { let s=0; for (let i=0;i<A.length;i++) s+=A[i]??0; return s; }

// A general (non-axis-aligned) corner tet.
const CORNERS = [[1,0,0],[0,2,0],[0,0,3],[0.4,0.5,0.6]];

// ─── Affine element ─────────────────────────────────────────────────────────

describe("C3D10 mass — affine element (issue #158)", () => {
  const nodes = affineNodes(CORNERS);

  it("isAffineC3D10 recognises exact-midpoint elements", () => {
    expect(isAffineC3D10(nodes)).toBe(true);
  });

  it("isoparametric block equals the exact corner formula (affine ⇒ same value)", () => {
    const iso = c3d10IsoparametricMass(nodes);
    const cor = cornerFormulaMass(nodes);
    expect(maxAbsDiff(iso, cor) / frob(cor)).toBeLessThan(1e-13);
  });

  it("Σ block = element volume (unit density mass conservation)", () => {
    const iso = c3d10IsoparametricMass(nodes);
    expect(sum(iso)).toBeCloseTo(c3d10Volume(nodes), 12);
  });
});

// ─── Curved element ─────────────────────────────────────────────────────────

describe("C3D10 mass — curved element (issue #158)", () => {
  // Displace midpoint 4 (edge 0-1) off the straight line → curved element.
  const nodes = affineNodes(CORNERS);
  const edgeLen = Math.hypot(CORNERS[1]![0]!-CORNERS[0]![0]!, CORNERS[1]![1]!-CORNERS[0]![1]!, CORNERS[1]![2]!-CORNERS[0]![2]!);
  nodes[4*3+2]! += 0.08 * edgeLen;   // 8% edge displacement in z

  it("isAffineC3D10 rejects a displaced-midnode element", () => {
    expect(isAffineC3D10(nodes)).toBe(false);
  });

  it("matches an INDEPENDENT high-order reference (Duffy-6) to machine precision", () => {
    const iso = c3d10IsoparametricMass(nodes);
    const ref = refMass(nodes);
    expect(maxAbsDiff(iso, ref) / frob(ref)).toBeLessThan(1e-12);
  });

  it("Σ block = TRUE curved volume, which the corner formula gets wrong", () => {
    const iso = c3d10IsoparametricMass(nodes);
    const Vtrue = c3d10Volume(nodes);
    expect(sum(iso)).toBeCloseTo(Vtrue, 12);
    // The old corner formula understates the mass (its total = corner-tet vol).
    const cor = cornerFormulaMass(nodes);
    const relMassErr = Math.abs(sum(cor) - Vtrue) / Vtrue;
    expect(relMassErr).toBeGreaterThan(0.05);   // >5% total-mass error — real bug
  });

  it("curved consistent element mass block is positive definite", () => {
    const A = c3d10IsoparametricMass(nodes);  // 10×10
    // Cholesky on the 10×10 block.
    const L = new Float64Array(100);
    let spd = true;
    for (let i = 0; i < 10 && spd; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i*10+j] ?? 0;
        for (let k = 0; k < j; k++) s -= (L[i*10+k]??0)*(L[j*10+k]??0);
        if (i === j) { if (s <= 0) { spd = false; break; } L[i*10+i] = Math.sqrt(s); }
        else L[i*10+j] = s / (L[j*10+j] ?? 1);
      }
    }
    expect(spd).toBe(true);
  });
});

// ─── Assembled mass on a curved single-element mesh ────────────────────────────

describe("assembleMass — curved C3D10 total mass (issue #158)", () => {
  const PLA: IsotropicMaterial = { E: 3500, nu: 0.35, yieldStrength: 56, label: "PLA", massRho: 1240 };
  const RHO_SOLVER = 1240 * 1e-12;

  const nodes = affineNodes(CORNERS);
  const edgeLen = Math.hypot(CORNERS[1]![0]!-CORNERS[0]![0]!, CORNERS[1]![1]!-CORNERS[0]![1]!, CORNERS[1]![2]!-CORNERS[0]![2]!);
  nodes[4*3+2]! += 0.08 * edgeLen;
  const mesh: TetMesh = {
    nodes, elements: new Int32Array([0,1,2,3,4,5,6,7,8,9]),
    nodeCount: 10, elementCount: 1, nodesPerElem: 10,
  };

  it("consistent total mass = ρ · V_true (curved), lumped agrees & stays positive", () => {
    const Vtrue = c3d10Volume(nodes);
    const con = assembleMass(mesh, PLA, 'consistent') as { M: CSRMatrix };
    let totalCon = 0; for (let i = 0; i < con.M.data.length; i++) totalCon += con.M.data[i] ?? 0;
    expect(totalCon).toBeCloseTo(3 * RHO_SOLVER * Vtrue, 18);   // 3 directions

    const lumped = assembleMass(mesh, PLA, 'lumped') as Float64Array;
    let totalLump = 0; for (let i = 0; i < lumped.length; i++) totalLump += lumped[i] ?? 0;
    expect(totalLump).toBeCloseTo(3 * RHO_SOLVER * Vtrue, 18);
    for (let i = 0; i < lumped.length; i++) expect(lumped[i] ?? 0).toBeGreaterThan(0);
  });
});
