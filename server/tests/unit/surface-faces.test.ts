/**
 * surface-faces.test.ts
 * ---------------------
 * Covers the box-mesh-fallback support added for the known-limitations work:
 *   1. extractSurfaceFaces returns the closed boundary of a box mesh, with every
 *      triangle outward-oriented (normal points away from the box centroid).
 *   2. The fallback can build a C3D10 box mesh (order honoured on the fallback).
 *   3. assembleSurfaceTractionNormal reproduces a flat-face uniform traction and
 *      integrates to pressure × area × outward-normal.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D4, generateBoxMeshC3D10, extractSurfaceFaces } from "../../solver/meshgen.js";
import { assembleSurfaceTraction, assembleSurfaceTractionNormal, selectPressureRegion } from "../../solver/load.js";

const W = 4, H = 3, D = 5;              // box [0,W]×[0,H]×[0,D]
// Conforming 6-tet mesh — the fallback path (extractSurfaceFaces needs conformity).
const box = generateBoxMeshC3D4(0, 0, 0, W, H, D, 3, 2, 4);
const faces = extractSurfaceFaces(box);
const triCount = faces.length / 3;

function nodeXYZ(n: number): [number, number, number] {
  return [box.nodes[n*3]!, box.nodes[n*3+1]!, box.nodes[n*3+2]!];
}

describe("extractSurfaceFaces", () => {
  it("produces a non-empty triangle list of valid node indices", () => {
    expect(triCount).toBeGreaterThan(0);
    for (let i = 0; i < faces.length; i++) {
      expect(faces[i]).toBeGreaterThanOrEqual(0);
      expect(faces[i]).toBeLessThan(box.nodeCount);
    }
  });

  it("total surface area equals the box's exact area (closed boundary, no gaps/overlaps)", () => {
    let area = 0;
    for (let t = 0; t < triCount; t++) {
      const [ax,ay,az] = nodeXYZ(faces[t*3]!);
      const [bx,by,bz] = nodeXYZ(faces[t*3+1]!);
      const [cx,cy,cz] = nodeXYZ(faces[t*3+2]!);
      const ux=bx-ax, uy=by-ay, uz=bz-az, vx=cx-ax, vy=cy-ay, vz=cz-az;
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      area += 0.5 * Math.hypot(nx, ny, nz);
    }
    const exact = 2 * (W*H + H*D + W*D);
    expect(area).toBeCloseTo(exact, 6);
  });

  it("orients every triangle outward (normal points away from the box centroid)", () => {
    const cx0 = W/2, cy0 = H/2, cz0 = D/2;
    for (let t = 0; t < triCount; t++) {
      const [ax,ay,az] = nodeXYZ(faces[t*3]!);
      const [bx,by,bz] = nodeXYZ(faces[t*3+1]!);
      const [cx,cy,cz] = nodeXYZ(faces[t*3+2]!);
      const ux=bx-ax, uy=by-ay, uz=bz-az, vx=cx-ax, vy=cy-ay, vz=cz-az;
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const gx=(ax+bx+cx)/3 - cx0, gy=(ay+by+cy)/3 - cy0, gz=(az+bz+cz)/3 - cz0;
      expect(nx*gx + ny*gy + nz*gz).toBeGreaterThan(0);
    }
  });

  it("works on a C3D10 box (fallback honours quadratic order)", () => {
    const q = generateBoxMeshC3D10(0, 0, 0, W, H, D, 2, 2, 2);
    expect(q.nodesPerElem).toBe(10);
    const qf = extractSurfaceFaces(q);
    let area = 0;
    for (let t = 0; t < qf.length/3; t++) {
      const a=qf[t*3]!, b=qf[t*3+1]!, c=qf[t*3+2]!;
      const ax=q.nodes[a*3]!, ay=q.nodes[a*3+1]!, az=q.nodes[a*3+2]!;
      const bx=q.nodes[b*3]!, by=q.nodes[b*3+1]!, bz=q.nodes[b*3+2]!;
      const cx=q.nodes[c*3]!, cy=q.nodes[c*3+1]!, cz=q.nodes[c*3+2]!;
      const ux=bx-ax, uy=by-ay, uz=bz-az, vx=cx-ax, vy=cy-ay, vz=cz-az;
      area += 0.5*Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
    }
    expect(area).toBeCloseTo(2*(W*H + H*D + W*D), 6);
  });
});

describe("assembleSurfaceTractionNormal", () => {
  // Load the +Z face (z ≈ D). Its outward normal is +Z.
  const loaded: boolean[] = [];
  for (let t = 0; t < triCount; t++) {
    const za = box.nodes[faces[t*3]!*3+2]!, zb = box.nodes[faces[t*3+1]!*3+2]!, zc = box.nodes[faces[t*3+2]!*3+2]!;
    loaded[t] = (za > D-1e-6 && zb > D-1e-6 && zc > D-1e-6);
  }

  it("integrates to pressure × area × outward-normal on a flat face", () => {
    const P = 2.5; // MPa, positive → along +normal (outward) here
    const f = assembleSurfaceTractionNormal(box, faces, loaded, P);
    let fx=0, fy=0, fz=0;
    for (let n = 0; n < box.nodeCount; n++) { fx+=f[n*3]!; fy+=f[n*3+1]!; fz+=f[n*3+2]!; }
    expect(fx).toBeCloseTo(0, 6);
    expect(fy).toBeCloseTo(0, 6);
    expect(fz).toBeCloseTo(P * W * H, 6);   // +Z face area = W·H
  });

  it("matches the uniform assembler on a flat face (traction = P·n̂)", () => {
    const P = -1.7;
    const fNormal  = assembleSurfaceTractionNormal(box, faces, loaded, P);
    const fUniform = assembleSurfaceTraction(box, faces, loaded, [0, 0, P]);
    for (let i = 0; i < fNormal.length; i++) {
      expect(fNormal[i]).toBeCloseTo(fUniform[i]!, 9);
    }
  });
});

describe("assembleSurfaceTraction — C3D10 T6 consistent load (issue #137)", () => {
  // A quadratic (C3D10) face is a 6-node T6 triangle: under a uniform traction
  // the corner shape-function integrals VANISH and each mid-side integral is
  // A/3, so the load must land on the mid-side nodes — the exact inverse of the
  // pre-fix corner-only lumping. Load the +Z face of a C3D10 box and check the
  // full distribution (not just the resultant).
  const qbox = generateBoxMeshC3D10(0, 0, 0, W, H, D, 2, 2, 2);
  const qf = extractSurfaceFaces(qbox);
  const qTri = qf.length / 3;
  const loaded: boolean[] = [];
  for (let t = 0; t < qTri; t++) {
    const za = qbox.nodes[qf[t*3]!*3+2]!, zb = qbox.nodes[qf[t*3+1]!*3+2]!, zc = qbox.nodes[qf[t*3+2]!*3+2]!;
    loaded[t] = (za > D-1e-6 && zb > D-1e-6 && zc > D-1e-6);
  }
  const P = 3.1;
  const f = assembleSurfaceTraction(qbox, qf, loaded, [0, 0, P]);

  // Independently locate the mid-side node at the midpoint of a corner pair.
  const midOf = (p: number, q: number): number => {
    const mx=(qbox.nodes[p*3]!+qbox.nodes[q*3]!)/2;
    const my=(qbox.nodes[p*3+1]!+qbox.nodes[q*3+1]!)/2;
    const mz=(qbox.nodes[p*3+2]!+qbox.nodes[q*3+2]!)/2;
    for (let n = 0; n < qbox.nodeCount; n++)
      if (Math.abs(qbox.nodes[n*3]!-mx)<1e-9 && Math.abs(qbox.nodes[n*3+1]!-my)<1e-9 && Math.abs(qbox.nodes[n*3+2]!-mz)<1e-9) return n;
    return -1;
  };

  // Reference T6 load, built without touching the solver's edge map.
  const expected = new Float64Array(qbox.nodeCount * 3);
  const corners = new Set<number>();
  let faceArea = 0;
  for (let t = 0; t < qTri; t++) {
    if (!loaded[t]) continue;
    const a=qf[t*3]!, b=qf[t*3+1]!, c=qf[t*3+2]!;
    corners.add(a); corners.add(b); corners.add(c);
    const ax=qbox.nodes[a*3]!,ay=qbox.nodes[a*3+1]!,az=qbox.nodes[a*3+2]!;
    const bx=qbox.nodes[b*3]!,by=qbox.nodes[b*3+1]!,bz=qbox.nodes[b*3+2]!;
    const cx=qbox.nodes[c*3]!,cy=qbox.nodes[c*3+1]!,cz=qbox.nodes[c*3+2]!;
    const area=0.5*Math.hypot((by-ay)*(cz-az)-(bz-az)*(cy-ay),(bz-az)*(cx-ax)-(bx-ax)*(cz-az),(bx-ax)*(cy-ay)-(by-ay)*(cx-ax));
    faceArea += area;
    for (const m of [midOf(a,b), midOf(b,c), midOf(c,a)]) expected[m*3+2]! += P*area/3;
  }

  it("finds the loaded quadratic face", () => {
    expect(qbox.nodesPerElem).toBe(10);
    expect(faceArea).toBeCloseTo(W*H, 9);
    expect(corners.size).toBeGreaterThan(0);
  });

  it("puts ≈ 0 on every corner node (not A/3 as the pre-fix code did)", () => {
    for (const c of corners) {
      expect(f[c*3]!).toBeCloseTo(0, 9);
      expect(f[c*3+1]!).toBeCloseTo(0, 9);
      expect(f[c*3+2]!).toBeCloseTo(0, 9);
    }
  });

  it("puts Σ(A/3)·t on the mid-side nodes (matches the independent T6 reference)", () => {
    for (let i = 0; i < expected.length; i++) expect(f[i]!).toBeCloseTo(expected[i]!, 9);
  });

  it("keeps the total resultant exact (Σf = P·A on the loaded face)", () => {
    let fx=0, fy=0, fz=0;
    for (let n = 0; n < qbox.nodeCount; n++) { fx+=f[n*3]!; fy+=f[n*3+1]!; fz+=f[n*3+2]!; }
    expect(fx).toBeCloseTo(0, 9);
    expect(fy).toBeCloseTo(0, 9);
    expect(fz).toBeCloseTo(P * W * H, 6);
  });
});

describe("selectPressureRegion", () => {
  const count = (m: boolean[]) => m.reduce((s, on) => s + (on ? 1 : 0), 0);

  it("'all' selects every triangle (even with no direction)", () => {
    const sel = selectPressureRegion(box.nodes, faces, [0, 0, 0], "all");
    expect(count(sel)).toBe(triCount);
  });

  it("'face' selects a 0.5 mm band at the extreme +Z end", () => {
    const sel = selectPressureRegion(box.nodes, faces, [0, 0, 1], "face");
    // Selected triangle centroids must lie within 0.5 mm of the top plane z = D.
    for (let t = 0; t < triCount; t++) {
      if (!sel[t]) continue;
      const cz = (box.nodes[faces[t*3]!*3+2]! + box.nodes[faces[t*3+1]!*3+2]! + box.nodes[faces[t*3+2]!*3+2]!) / 3;
      expect(D - cz).toBeLessThan(0.5 + 1e-9);
    }
    expect(count(sel)).toBeGreaterThan(0);
    expect(count(sel)).toBeLessThan(triCount);
  });

  it("'facing +Z' selects exactly the top face (outward normal has +Z, all corners at z=D)", () => {
    const facing = selectPressureRegion(box.nodes, faces, [0, 0, 1], "facing");
    expect(count(facing)).toBeGreaterThan(0);
    for (let t = 0; t < triCount; t++) {
      if (!facing[t]) continue;
      for (const k of [0,1,2]) expect(box.nodes[faces[t*3+k]!*3+2]).toBeCloseTo(D, 6);
    }
    // 'facing' is stricter than the 'face' band (no side-wall fringe), so it
    // selects no more triangles than 'face'.
    const face = selectPressureRegion(box.nodes, faces, [0, 0, 1], "face");
    expect(count(facing)).toBeLessThanOrEqual(count(face));
  });

  it("'face'/'facing' select nothing without a direction", () => {
    expect(count(selectPressureRegion(box.nodes, faces, [0,0,0], "face"))).toBe(0);
    expect(count(selectPressureRegion(box.nodes, faces, [0,0,0], "facing"))).toBe(0);
  });

  it("normal pressure over the whole closed box nets ~zero resultant (hydrostatic balance)", () => {
    const all = selectPressureRegion(box.nodes, faces, [0,0,0], "all");
    const f = assembleSurfaceTractionNormal(box, faces, all, -3.0); // inward everywhere
    let fx=0, fy=0, fz=0;
    for (let n = 0; n < box.nodeCount; n++) { fx+=f[n*3]!; fy+=f[n*3+1]!; fz+=f[n*3+2]!; }
    expect(fx).toBeCloseTo(0, 6);
    expect(fy).toBeCloseTo(0, 6);
    expect(fz).toBeCloseTo(0, 6);
  });
});
