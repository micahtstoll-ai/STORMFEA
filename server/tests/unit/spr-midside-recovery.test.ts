/**
 * SPR recovery must stay BOUNDED on C3D10 meshes.
 *
 * Regression lock for the defect where every C3D10 midside node fitted its own
 * SPR patch. A midside node's patch is the ring of tets sharing ONE EDGE — a set
 * of nearly-coplanar centroids that cannot determine a 3-D linear polynomial. The
 * near-null direction was solved anyway (the rank guard was an ABSOLUTE
 * `|pivot| < 1e-12` test on a normal matrix built in raw global mm coordinates,
 * so it could never fire), producing a huge fitted gradient that the small offset
 * between the node and the ring's centroid mean turned into a huge recovered
 * stress.
 *
 * Measured on a smooth cylinder in bending, before the fix: recovered sigma* of
 * 105 MPa where the true peak stress was 1.27 MPa, a displayed heatmap peak 18x
 * the real peak stress, and a ZZ global relative error of 80.6% on the FINEST of
 * three mesh tiers (23.2% -> 6.9% -> 80.6%, non-monotone). After: 5.5% -> 4.0%
 * -> 3.5%, monotone.
 *
 * These tests use a DISTORTED structured mesh rather than a TetGen mesh so they
 * run without the TetGen binary. Distortion matters: a perfectly structured box
 * has symmetric edge rings whose spurious gradients largely cancel, which is
 * exactly why the existing MMS fixture (solver_validation group 30, a structured
 * C3D4 box) could not catch this.
 */
import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D10 } from "../../solver/meshgen.js";
import { sprSmoothedStress, sprSmoothedStress6 } from "../../solver/stress.js";
import { buildNodeElementLists } from "../../solver/adjacency.js";
import type { TetMesh } from "../../solver/types.js";

/** Deterministic hash-based jitter — reproducible across runs, no RNG seed. */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s) - 0.5;   // in [-0.5, 0.5)
}

/**
 * A C3D10 box mesh with its CORNER nodes displaced, then every midside node
 * re-placed at its edge midpoint so the elements stay geometrically valid
 * straight-sided tets. This reproduces the irregular edge rings that an
 * unstructured mesher produces.
 */
function distortedC3D10Box(nDiv: number, amp: number): TetMesh {
  const mesh = generateBoxMeshC3D10(0, 0, 0, 10, 10, 10, nDiv, nDiv, nDiv);
  const nodes = Float64Array.from(mesh.nodes);
  const L = 10, h = L / nDiv, eps = 1e-9;

  // Identify midside nodes so only corners are moved.
  const isMid = new Uint8Array(mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    for (let k = 4; k < 10; k++) isMid[mesh.elements[e * 10 + k] ?? 0] = 1;
  }

  for (let n = 0; n < mesh.nodeCount; n++) {
    if (isMid[n]) continue;
    for (let k = 0; k < 3; k++) {
      const v = nodes[n * 3 + k] ?? 0;
      // Keep boundary nodes on their faces so the domain stays a box.
      if (Math.abs(v) < eps || Math.abs(v - L) < eps) continue;
      nodes[n * 3 + k] = v + amp * h * jitter(n * 3 + k);
    }
  }

  // Re-centre midside nodes on their (moved) corners.
  const EDGES: readonly (readonly [number, number, number])[] = [
    [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
  ];
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 10;
    for (const [ca, cb, cm] of EDGES) {
      const a = mesh.elements[base + ca] ?? 0;
      const b = mesh.elements[base + cb] ?? 0;
      const m = mesh.elements[base + cm] ?? 0;
      for (let k = 0; k < 3; k++) {
        nodes[m * 3 + k] = 0.5 * ((nodes[a * 3 + k] ?? 0) + (nodes[b * 3 + k] ?? 0));
      }
    }
  }
  return { ...mesh, nodes };
}

/** Element-centroid coordinates (corner average), matching the SPR convention. */
function centroids(mesh: TetMesh): { cx: Float64Array; cy: Float64Array; cz: Float64Array } {
  const npe = mesh.nodesPerElem ?? 4;
  const cx = new Float64Array(mesh.elementCount);
  const cy = new Float64Array(mesh.elementCount);
  const cz = new Float64Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    let ax = 0, ay = 0, az = 0;
    for (let ni = 0; ni < 4; ni++) {
      const n = mesh.elements[e * npe + ni] ?? 0;
      ax += mesh.nodes[n * 3] ?? 0; ay += mesh.nodes[n * 3 + 1] ?? 0; az += mesh.nodes[n * 3 + 2] ?? 0;
    }
    cx[e] = ax / 4; cy[e] = ay / 4; cz[e] = az / 4;
  }
  return { cx, cy, cz };
}

describe("SPR recovery on C3D10 midside nodes", () => {
  const mesh = distortedC3D10Box(4, 0.35);
  const { cx, cy, cz } = centroids(mesh);
  const lists = buildNodeElementLists(mesh);

  it("never recovers a nodal stress far outside the range of the data", () => {
    // A smooth but NON-linear element field: recovery cannot reproduce it
    // exactly, so the patch fit has a genuine residual — the regime where an
    // ill-conditioned patch amplifies.
    const elem = new Float64Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      elem[e] = 10 + (cx[e] ?? 0) * (cy[e] ?? 0) * 0.1 + Math.sin(0.7 * (cz[e] ?? 0)) * 3;
    }
    const nodal = sprSmoothedStress(mesh, elem);

    // Measured against the GLOBAL data range, not each patch's own spread: a
    // patch spanning two nearly-equal elements has a spread near zero, and any
    // legitimate smoothing looks enormous relative to it.
    //
    // SPR is SUPPOSED to overshoot the element range a little — that is how it
    // recovers a peak the element averages miss — but it must stay the same
    // ORDER as the data. Pre-fix, the equivalent figure on a real TetGen mesh
    // was ~80x the data range.
    let lo = Infinity, hi = -Infinity;
    for (let e = 0; e < mesh.elementCount; e++) {
      const v = elem[e] ?? 0; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const span = hi - lo;

    let worst = 0, worstNode = -1;
    for (let n = 0; n < mesh.nodeCount; n++) {
      if (lists[n]!.length === 0) continue;
      const v = nodal[n] ?? 0;
      const over = Math.max(0, Math.max(lo - v, v - hi)) / span;
      if (over > worst) { worst = over; worstNode = n; }
    }
    expect(worst, `worst overshoot ${worst.toFixed(3)}x data range at node ${worstNode}`).toBeLessThan(0.25);
  });

  it("still reproduces a linear stress field exactly at corner nodes", () => {
    // Corner recovery must be untouched by the midside change. Combined with the
    // midside-interpolation test below, this gives linear exactness everywhere:
    // linear interpolation between two exact corner values IS the exact value at
    // the edge midpoint.
    //
    // Only patches the recovery actually FITS are checked. A patch of < 4
    // elements, or one whose fit would amplify data error by more than
    // SPR_MAX_AMPLIFICATION, falls back to direct averaging by documented design
    // — and averaging is not exact for a linear field. The skip criterion below
    // mirrors the one in buildSprPatchFit so this test asserts exactness exactly
    // where the code claims to deliver it.
    const elem = new Float64Array(mesh.elementCount);
    // Strictly positive over the box: sprSmoothedStress clamps to non-negative
    // (von Mises stress cannot be negative), so a field dipping below zero would
    // test the clamp rather than the fit.
    const f = (x: number, y: number, z: number) => 50 + 2 * x - 1.5 * y + 0.75 * z;
    for (let e = 0; e < mesh.elementCount; e++) elem[e] = f(cx[e] ?? 0, cy[e] ?? 0, cz[e] ?? 0);

    /** G = sqrt(n * [(A^T A)^-1]_00) for the node-centred, radius-scaled patch. */
    const amplification = (patch: readonly number[], n: number): number => {
      const nx = mesh.nodes[n*3] ?? 0, ny = mesh.nodes[n*3+1] ?? 0, nz = mesh.nodes[n*3+2] ?? 0;
      let h = 0;
      for (const e of patch) h = Math.max(h, Math.hypot(cx[e]!-nx, cy[e]!-ny, cz[e]!-nz));
      if (!(h > 0)) return Infinity;
      const A = new Float64Array(16);
      for (const e of patch) {
        const q = [1, (cx[e]!-nx)/h, (cy[e]!-ny)/h, (cz[e]!-nz)/h];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) A[i*4+j] = (A[i*4+j] ?? 0) + q[i]!*q[j]!;
      }
      const M = new Float64Array(20);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) M[i*5+j] = A[i*4+j] ?? 0;
        M[i*5+4] = i === 0 ? 1 : 0;
      }
      for (let col = 0; col < 4; col++) {
        let mr = col, mv = Math.abs(M[col*5+col] ?? 0);
        for (let row = col+1; row < 4; row++) {
          const v = Math.abs(M[row*5+col] ?? 0);
          if (v > mv) { mv = v; mr = row; }
        }
        if (mv === 0) return Infinity;
        if (mr !== col) for (let k = col; k <= 4; k++) {
          const t = M[col*5+k] ?? 0; M[col*5+k] = M[mr*5+k] ?? 0; M[mr*5+k] = t;
        }
        const piv = M[col*5+col] ?? 0;
        for (let row = col+1; row < 4; row++) {
          const f = (M[row*5+col] ?? 0) / piv;
          for (let k = col; k <= 4; k++) M[row*5+k] = (M[row*5+k] ?? 0) - f * (M[col*5+k] ?? 0);
        }
      }
      const y = [0,0,0,0];
      for (let row = 3; row >= 0; row--) {
        let s = M[row*5+4] ?? 0;
        for (let col = row+1; col < 4; col++) s -= (M[row*5+col] ?? 0) * y[col]!;
        y[row] = s / (M[row*5+row] ?? 1);
      }
      const g2 = y[0]!;
      return (Number.isFinite(g2) && g2 > 0) ? Math.sqrt(patch.length * g2) : Infinity;
    };
    const SPR_MAX_AMPLIFICATION = 30;   // mirrors server/solver/stress.ts
    const isFitted = (patch: readonly number[], n: number): boolean =>
      patch.length >= 4 && amplification(patch, n) <= SPR_MAX_AMPLIFICATION;

    // Midside nodes are excluded here: they are interpolated, not fitted.
    const isMid = new Uint8Array(mesh.nodeCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      for (let k = 4; k < 10; k++) isMid[mesh.elements[e * 10 + k] ?? 0] = 1;
    }

    const nodal = sprSmoothedStress(mesh, elem);
    let maxErr = 0, checked = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      if (isMid[n] || !isFitted(lists[n]!, n)) continue;
      const exact = f(mesh.nodes[n * 3] ?? 0, mesh.nodes[n * 3 + 1] ?? 0, mesh.nodes[n * 3 + 2] ?? 0);
      maxErr = Math.max(maxErr, Math.abs((nodal[n] ?? 0) - exact));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(maxErr).toBeLessThan(1e-8);
  });

  it("keeps every tensor component bounded and finite", () => {
    const elem6 = new Float64Array(mesh.elementCount * 6);
    for (let e = 0; e < mesh.elementCount; e++) {
      const x = cx[e] ?? 0, y = cy[e] ?? 0, z = cz[e] ?? 0;
      elem6[e * 6]     = 5 + 0.1 * x * y;
      elem6[e * 6 + 1] = -2 + Math.cos(0.5 * z) * 2;
      elem6[e * 6 + 2] = 0.05 * z * z;
      elem6[e * 6 + 3] = Math.sin(0.3 * x) * 1.5;
      elem6[e * 6 + 4] = 0.02 * y * z;
      elem6[e * 6 + 5] = 1;
    }
    const nodal6 = sprSmoothedStress6(mesh, elem6);

    let elemMax = 0;
    for (let i = 0; i < elem6.length; i++) elemMax = Math.max(elemMax, Math.abs(elem6[i] ?? 0));
    let nodalMax = 0;
    for (let i = 0; i < nodal6.length; i++) {
      const v = nodal6[i] ?? 0;
      expect(Number.isFinite(v)).toBe(true);
      nodalMax = Math.max(nodalMax, Math.abs(v));
    }
    expect(nodalMax, `nodal peak ${nodalMax.toExponential(2)} vs element peak ${elemMax.toExponential(2)}`)
      .toBeLessThan(2 * elemMax);
  });

  it("places every midside value between its two corner values", () => {
    // The structural invariant behind the fix: midside recovery is interpolation
    // from the corners, so it can never introduce a new extremum.
    const elem6 = new Float64Array(mesh.elementCount * 6);
    for (let e = 0; e < mesh.elementCount; e++) {
      elem6[e * 6] = 4 + 0.3 * (cx[e] ?? 0) - 0.2 * (cy[e] ?? 0) * (cz[e] ?? 0);
    }
    const nodal6 = sprSmoothedStress6(mesh, elem6);
    const EDGES: readonly (readonly [number, number, number])[] = [
      [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
    ];
    for (let e = 0; e < mesh.elementCount; e++) {
      const base = e * 10;
      for (const [ca, cb, cm] of EDGES) {
        const a = nodal6[(mesh.elements[base + ca] ?? 0) * 6] ?? 0;
        const b = nodal6[(mesh.elements[base + cb] ?? 0) * 6] ?? 0;
        const m = nodal6[(mesh.elements[base + cm] ?? 0) * 6] ?? 0;
        expect(m).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
        expect(m).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      }
    }
  });
});
