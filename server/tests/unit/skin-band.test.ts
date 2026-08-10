/**
 * skin-band.test.ts
 * -----------------
 * Independent top/bottom solid-skin (floor/ceiling) bands for the two-region
 * material model. Verifies:
 *   1. Equal-thickness equivalence — the multi-band penetration path collapses
 *      bit-identically to the legacy single-tWall distance path.
 *   2. buildTwoRegionField with skins = tWall reproduces the no-skin field
 *      (binOfElement + constitutive matrices identical).
 *   3. A box with a thicker top/bottom skin than the perimeter band matches the
 *      closed-form union-of-bands shell volume.
 */

import { describe, it, expect } from "vitest";
import {
  computeNodeSurfaceDistances,
  computeNodeBandPenetration,
} from "../../solver/distance.js";
import { computeWallFractions, computeWallFractionsFromPhi } from "../../solver/wallfrac.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { buildTwoRegionField, classifyFaceBands, DEFAULT_SKIN_CONE_DEG } from "../../twoRegion.js";
import type { TetMesh } from "../../solver/types.js";

const isoOrtho = (E: number, label: string) => ({
  kind: "orthotropic" as const,
  E_xy: E, E_z: E, nu_xy: 0.36, nu_xz: 0.36, G_xz: E / (2 * (1 + 0.36)),
  yieldXY: 50 * E / 3500, yieldZ: 50 * E / 3500, label, massRho: 1240 * E / 3500,
});

function tetVolumes(mesh: ReturnType<typeof generateBoxMeshC3D4>): Float64Array {
  const V = new Float64Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const b = e * 4;
    const n0 = mesh.elements[b]!, n1 = mesh.elements[b + 1]!, n2 = mesh.elements[b + 2]!, n3 = mesh.elements[b + 3]!;
    const ax = mesh.nodes[n0 * 3]!, ay = mesh.nodes[n0 * 3 + 1]!, az = mesh.nodes[n0 * 3 + 2]!;
    const bx = mesh.nodes[n1 * 3]!, by = mesh.nodes[n1 * 3 + 1]!, bz = mesh.nodes[n1 * 3 + 2]!;
    const cx = mesh.nodes[n2 * 3]!, cy = mesh.nodes[n2 * 3 + 1]!, cz = mesh.nodes[n2 * 3 + 2]!;
    const dx = mesh.nodes[n3 * 3]!, dy = mesh.nodes[n3 * 3 + 1]!, dz = mesh.nodes[n3 * 3 + 2]!;
    V[e] = Math.abs(
      (bx - ax) * ((cy - ay) * (dz - az) - (cz - az) * (dy - ay)) -
      (by - ay) * ((cx - ax) * (dz - az) - (cz - az) * (dx - ax)) +
      (bz - az) * ((cx - ax) * (dy - ay) - (cy - ay) * (dx - ax))
    ) / 6;
  }
  return V;
}

describe("classifyFaceBands face-orientation classification (issue #181)", () => {
  // Three synthetic boundary triangles, build axis +Z:
  //  A — horizontal (normal ‖ +Z, φ ≈ 0°), centroid high → top skin.
  //  B — 60°-from-horizontal overhang (|n·ẑ| = cos60° = 0.5), centroid low → bottom skin.
  //  C — vertical wall (normal ⟂ build axis, φ = 90°) → perimeter band.
  const nodes = new Float64Array([
    // Triangle A (z = 10)
    0, 0, 10,   1, 0, 10,   0, 1, 10,
    // Triangle B (normal 60° off +Z)
    0, 0, 0,    0, 1, 0,    0.5, 0, -0.8660254,
    // Triangle C (vertical, normal ‖ +X)
    0, 0, 0,    0, 1, 0,    0, 0, 1,
  ]);
  const mesh: TetMesh = {
    nodes, elements: new Int32Array(0), nodeCount: 9, elementCount: 0, nodesPerElem: 4,
  };
  const faces = new Int32Array([0, 1, 2,  3, 4, 5,  6, 7, 8]);
  const T_WALL = 1.0, T_TOP = 3.0, T_BOT = 2.0;

  it("60° overhang face is credited as solid skin, not the wall band (default 65° cone)", () => {
    const band = classifyFaceBands(mesh, faces, {
      buildAxis: [0, 0, 1], tSkinTop: T_TOP, tSkinBot: T_BOT,
    }, T_WALL);
    expect(band[0]).toBe(T_TOP);          // horizontal top → top skin
    expect(band[1]).toBe(T_BOT);          // 60° overhang underside → bottom skin (NOT tWall)
    expect(band[1]).not.toBe(T_WALL);
    expect(band[2]).toBe(T_WALL);         // vertical wall → perimeter band
    expect(DEFAULT_SKIN_CONE_DEG).toBeGreaterThan(60);
  });

  it("legacy 45° cone would mis-classify the 60° overhang as wall", () => {
    const band = classifyFaceBands(mesh, faces, {
      buildAxis: [0, 0, 1], tSkinTop: T_TOP, tSkinBot: T_BOT, skinConeDeg: 45,
    }, T_WALL);
    expect(band[1]).toBe(T_WALL);         // the pre-fix cliff (issue #181)
    expect(band[2]).toBe(T_WALL);         // vertical still a wall
  });
});

describe("computeNodeBandPenetration equal-thickness equivalence", () => {
  const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
  const faces = extractSurfaceFaces(mesh);
  const triCount = faces.length / 3;
  const T_WALL = 1.35;
  const dMax = T_WALL + 6.0;

  it("uniform faceBand = tWall reproduces (distance − tWall) bit-for-bit", () => {
    const dist = computeNodeSurfaceDistances(mesh, faces, dMax);
    const faceBand = new Float64Array(triCount).fill(T_WALL);
    const phi = computeNodeBandPenetration(mesh, faces, faceBand, dMax);
    // Compare only corner nodes that the level set reads (first 4 per element).
    const isCorner = new Uint8Array(mesh.nodeCount);
    for (let e = 0; e < mesh.elementCount; e++)
      for (let k = 0; k < 4; k++) isCorner[mesh.elements[e * 4 + k]!] = 1;
    for (let n = 0; n < mesh.nodeCount; n++) {
      if (!isCorner[n]) continue;
      expect(phi[n]).toBe((dist[n] ?? 0) - T_WALL);
    }
  });

  it("wall fractions match between the legacy and phi-direct paths", () => {
    const dist = computeNodeSurfaceDistances(mesh, faces, dMax);
    const legacy = computeWallFractions(mesh, dist, T_WALL);
    const faceBand = new Float64Array(triCount).fill(T_WALL);
    const phi = computeNodeBandPenetration(mesh, faces, faceBand, dMax);
    const viaPhi = computeWallFractionsFromPhi(mesh, phi);
    for (let e = 0; e < mesh.elementCount; e++) expect(viaPhi[e]).toBe(legacy[e]);
  });
});

describe("buildTwoRegionField skins == tWall reproduces the no-skin field", () => {
  const mesh = generateBoxMeshC3D4(0, 0, 0, 30, 12, 8, 12, 5, 4);
  const faces = extractSurfaceFaces(mesh);
  const T_WALL = 1.2;
  const shell = isoOrtho(3500, "shell");
  const core = isoOrtho(700, "core");

  it("identical binOfElement and constitutive matrices", () => {
    const base = buildTwoRegionField(mesh, faces, shell, core, T_WALL);
    const withSkin = buildTwoRegionField(mesh, faces, shell, core, T_WALL, {
      buildAxis: [0, 0, 1], tSkinTop: T_WALL, tSkinBot: T_WALL,
    });
    expect(base.field).not.toBeNull();
    expect(withSkin.field).not.toBeNull();
    expect(withSkin.shellVolumeFraction).toBeCloseTo(base.shellVolumeFraction!, 12);
    const a = base.field!, b = withSkin.field!;
    for (let e = 0; e < mesh.elementCount; e++) expect(b.binOfElement[e]).toBe(a.binOfElement[e]);
    for (let i = 0; i < a.C.length; i++) expect(b.C[i]).toBe(a.C[i]);
  });
});

describe("box with thicker floor/ceiling than perimeter → union-of-bands volume", () => {
  // Fine mesh so the marching-tet estimate of the piecewise-linear union band
  // is fair. Build axis +Z: top/bottom faces are skins, sides are perimeters.
  const W = 24, D = 16, H = 20;
  const mesh = generateBoxMeshC3D4(0, 0, 0, W, D, H, 12, 8, 10);
  const faces = extractSurfaceFaces(mesh);
  const T_WALL = 1.0;   // vertical perimeter band
  const T_TOP = 3.0;    // ceiling skin (much thicker)
  const T_BOT = 2.0;    // floor skin
  const shell = isoOrtho(3500, "shell");
  const core = isoOrtho(700, "core");

  it("shellVolumeFraction matches the closed-form union band within 6%", () => {
    const tr = buildTwoRegionField(mesh, faces, shell, core, T_WALL, {
      buildAxis: [0, 0, 1], tSkinTop: T_TOP, tSkinBot: T_BOT,
    });
    expect(tr.field).not.toBeNull();
    // Core = { perimeter-inset AND above floor AND below ceiling }: a box.
    const outer = W * D * H;
    const core3 = (W - 2 * T_WALL) * (D - 2 * T_WALL) * (H - T_TOP - T_BOT);
    const shellVolAnalytic = outer - core3;
    const VfAnalytic = shellVolAnalytic / outer;
    expect(Math.abs(tr.shellVolumeFraction! - VfAnalytic) / VfAnalytic).toBeLessThan(0.06);
  });

  it("thicker skins raise the shell fraction above the uniform-tWall model", () => {
    const uniform = buildTwoRegionField(mesh, faces, shell, core, T_WALL);
    const withSkin = buildTwoRegionField(mesh, faces, shell, core, T_WALL, {
      buildAxis: [0, 0, 1], tSkinTop: T_TOP, tSkinBot: T_BOT,
    });
    expect(withSkin.shellVolumeFraction).toBeGreaterThan(uniform.shellVolumeFraction!);
    expect(withSkin.skinTopThicknessMm).toBe(T_TOP);
    expect(withSkin.skinBotThicknessMm).toBe(T_BOT);
  });
});
