import { describe, it, expect } from 'vitest';
import { c3d10ShapeDerivatives, buildB_c3d10 } from '../../solver/element.js';

// Unit tetrahedron with corners at (1,0,0),(0,1,0),(0,0,1),(0,0,0) and
// standard C3D10 edge-midpoint nodes. Used by buildB_c3d10 tests below.
const UNIT_TET_NODES = new Float64Array([
  1, 0, 0,   // node 0  (ξ=1)
  0, 1, 0,   // node 1  (η=1)
  0, 0, 1,   // node 2  (ζ=1)
  0, 0, 0,   // node 3  (δ=1)
  0.5, 0.5, 0,   // node 4  midpoint 0-1
  0, 0.5, 0.5,   // node 5  midpoint 1-2
  0.5, 0, 0.5,   // node 6  midpoint 0-2
  0.5, 0, 0,     // node 7  midpoint 0-3
  0, 0.5, 0,     // node 8  midpoint 1-3
  0, 0, 0.5,     // node 9  midpoint 2-3
]);

describe('c3d10ShapeDerivatives — reference isolation', () => {
  it('second call does not mutate the first call\'s returned arrays', () => {
    const [dNdxi_1, dNdeta_1, dNdzeta_1] = c3d10ShapeDerivatives(0.2, 0.3, 0.1);

    // Snapshot values before any second call
    const snap_xi    = Array.from(dNdxi_1);
    const snap_eta   = Array.from(dNdeta_1);
    const snap_zeta  = Array.from(dNdzeta_1);

    // Second call with different Gauss-point coordinates
    c3d10ShapeDerivatives(0.4, 0.2, 0.2);

    // If the first call returned a live reference to shared scratch, these
    // arrays would now hold the second call's values and the assertion fails.
    expect(Array.from(dNdxi_1)).toEqual(snap_xi);
    expect(Array.from(dNdeta_1)).toEqual(snap_eta);
    expect(Array.from(dNdzeta_1)).toEqual(snap_zeta);
  });

  it('returns arrays of length 10', () => {
    const [dNdxi, dNdeta, dNdzeta] = c3d10ShapeDerivatives(0.1381966, 0.1381966, 0.1381966);
    expect(dNdxi.length).toBe(10);
    expect(dNdeta.length).toBe(10);
    expect(dNdzeta.length).toBe(10);
  });

  it('derivatives at corner node 0 (ξ=1,η=0,ζ=0) match analytic values', () => {
    // N0 = ξ(2ξ-1), so dN0/dξ = 4ξ-1 = 3, dN0/dη = dN0/dζ = 0
    const [dNdxi, dNdeta, dNdzeta] = c3d10ShapeDerivatives(1, 0, 0);
    expect(dNdxi[0]).toBeCloseTo(3, 12);
    expect(dNdeta[0]).toBeCloseTo(0, 12);
    expect(dNdzeta[0]).toBeCloseTo(0, 12);
  });

  it('two sequential calls return independent objects', () => {
    const [xi_a] = c3d10ShapeDerivatives(0.1, 0.2, 0.3);
    const [xi_b] = c3d10ShapeDerivatives(0.5, 0.1, 0.1);
    // If correctly isolated, xi_a and xi_b should differ and not be the same reference
    expect(xi_a).not.toBe(xi_b);
    // Their values should differ (different inputs)
    const differs = Array.from(xi_a).some((v, i) => v !== xi_b[i]);
    expect(differs).toBe(true);
  });
});

describe('buildB_c3d10 — reference isolation', () => {
  it('second call does not mutate the first call\'s returned B matrix', () => {
    const { B: B1 } = buildB_c3d10(UNIT_TET_NODES, 0.1381966, 0.1381966, 0.1381966);

    // Snapshot all 180 values before any second call
    const snap = Array.from(B1);

    // Second call with a different Gauss point
    buildB_c3d10(UNIT_TET_NODES, 0.5854102, 0.1381966, 0.1381966);

    // If buildB_c3d10 returned a live reference to module-level scratch, B1
    // would now contain the second call's values and this assertion fails.
    expect(Array.from(B1)).toEqual(snap);
  });

  it('returns B matrix of length 180 (6×30)', () => {
    const { B } = buildB_c3d10(UNIT_TET_NODES, 0.1381966, 0.1381966, 0.1381966);
    expect(B.length).toBe(180);
  });

  it('returns a positive Jacobian determinant for the unit tet', () => {
    const { detJ } = buildB_c3d10(UNIT_TET_NODES, 0.1381966, 0.1381966, 0.1381966);
    expect(detJ).toBeGreaterThan(0);
  });

  it('two sequential calls return independent B objects', () => {
    const { B: B_a } = buildB_c3d10(UNIT_TET_NODES, 0.1381966, 0.1381966, 0.1381966);
    const { B: B_b } = buildB_c3d10(UNIT_TET_NODES, 0.5854102, 0.1381966, 0.1381966);
    expect(B_a).not.toBe(B_b);
    const differs = Array.from(B_a).some((v, i) => v !== B_b[i]);
    expect(differs).toBe(true);
  });
});
