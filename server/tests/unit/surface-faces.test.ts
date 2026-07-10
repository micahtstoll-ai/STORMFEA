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
import { assembleSurfaceTraction, assembleSurfaceTractionNormal } from "../../solver/load.js";

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
    const f = assembleSurfaceTractionNormal(box.nodes, faces, loaded, P);
    let fx=0, fy=0, fz=0;
    for (let n = 0; n < box.nodeCount; n++) { fx+=f[n*3]!; fy+=f[n*3+1]!; fz+=f[n*3+2]!; }
    expect(fx).toBeCloseTo(0, 6);
    expect(fy).toBeCloseTo(0, 6);
    expect(fz).toBeCloseTo(P * W * H, 6);   // +Z face area = W·H
  });

  it("matches the uniform assembler on a flat face (traction = P·n̂)", () => {
    const P = -1.7;
    const fNormal  = assembleSurfaceTractionNormal(box.nodes, faces, loaded, P);
    const fUniform = assembleSurfaceTraction(box.nodes, faces, loaded, [0, 0, P]);
    for (let i = 0; i < fNormal.length; i++) {
      expect(fNormal[i]).toBeCloseTo(fUniform[i]!, 9);
    }
  });
});
