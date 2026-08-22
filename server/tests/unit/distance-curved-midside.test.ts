/**
 * distance-curved-midside.test.ts
 *
 * Two-region invariant #4, the CURVED case (issue #316).
 *
 * `distance-boundary-seed.test.ts` covers boundary-node distances on meshes
 * whose C3D10 midside nodes sit at the STRAIGHT midpoint of their corner pair
 * (`generateBoxMeshC3D10`, `buildPlateWithHoleMesh`). On those a boundary
 * midside lies exactly in the plane of its boundary triangles, so its distance
 * is float noise (~1.8e-15) rather than geometry. That left one case untested:
 * a mesher that PROJECTS midside nodes onto a curved CAD surface. Gmsh
 * `-order 2` does exactly that, placing a bore midside on the cylinder — off
 * the flat chord of its corner-only boundary triangle by the sagitta
 *   s = R·(1 − cos(π/n))
 * for a bore of radius R meshed with n circumferential segments. On a 5 mm bore
 * at n ≈ 24 that is ~43 microns, ~3% of the ~1.35 mm wall band the two-region
 * model resolves — genuinely non-zero, and the one case where a boundary
 * midside distance legitimately is.
 *
 * This test builds that fixture from the real Gmsh binary and pins three
 * things: corners on the bore are still bit-exactly 0 (they are vertices of
 * boundary triangles), bore midsides carry the sagitta rather than collapsing
 * to chord-placement float noise, and — the decision the issue asks for — that
 * offset is IMMATERIAL to the wall/core classification. It shifts the level-set
 * crossing only where the field is already deep in the shell band (dist ≈ 0,
 * φ = dist − tWall ≈ −tWall), never near the shell/core interface (dist = tWall)
 * that sits ~tWall inside the part, so the per-element wall fraction it consumes
 * barely moves (measured max Δ ≈ 3.6e-4 on this fixture). Recorded, not changed:
 * no seeding/level-set behaviour is altered.
 *
 * Requires a gmsh binary (CI installs one via .github/actions/setup). Skipped
 * otherwise so the suite stays green:
 *   npx vitest run server/tests/unit/distance-curved-midside.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { meshStepWithGmsh, probeGmsh } from "../../gmsh_mesh.js";
import { extractSurfaceFaces } from "../../solver/meshgen.js";
import { computeNodeSurfaceDistances } from "../../solver/distance.js";
import { computeWallFractions } from "../../solver/wallfrac.js";
import type { TetMesh } from "../../solver/types.js";

const gmsh = await probeGmsh();
if (!gmsh.found) {
  // eslint-disable-next-line no-console
  console.warn("SKIP: gmsh not found — skipping curved-bore C3D10 midside distance test (#316)");
}

// Bore geometry: a 5 mm-radius cylinder bored through the 4 mm thickness (the
// Y axis) of a 30x4x60 plate. Kept in one place so the radial filter and the
// analytic sagitta both read the same numbers.
const BORE_CX = 15, BORE_CZ = 30, BORE_R = 5;

/**
 * A bored plate STEP via Gmsh's OpenCASCADE kernel: a box minus a through
 * cylinder (`-0` = geometry only, mirroring makeBoxStep in gmsh-c3d10.test.ts).
 * The cylinder runs from y = -1 to y = 5, fully piercing the y in [0, 4] plate.
 */
function boredPlateStep(): Buffer {
  const base = path.join(tmpdir(), `sf_gmsh_bore_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const geo =
    `SetFactory("OpenCASCADE");\n` +
    `Box(1) = {0,0,0, 30,4,60};\n` +
    `Cylinder(2) = {${BORE_CX},-1,${BORE_CZ}, 0,6,0, ${BORE_R}};\n` +
    `BooleanDifference(3) = { Volume{1}; Delete; }{ Volume{2}; Delete; };\n`;
  writeFileSync(`${base}.geo`, geo);
  execFileSync("gmsh", [`${base}.geo`, "-0", "-o", `${base}.step`, "-format", "step"], { stdio: "ignore" });
  return readFileSync(`${base}.step`);
}

/** Corner nodes referenced by at least one boundary triangle. */
function boundaryCorners(faces: Int32Array): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < faces.length; i++) s.add(faces[i]!);
  return s;
}

/**
 * C3D10 midside nodes whose edge lies on a boundary face — the same helper
 * `distance-boundary-seed.test.ts` uses (a midside is on the surface when one
 * of the two tet faces sharing its edge is a boundary face).
 */
function boundaryMidsides(mesh: TetMesh, faces: Int32Array): Set<number> {
  const out = new Set<number>();
  if (mesh.nodesPerElem !== 10) return out;
  const faceKey = new Set<string>();
  for (let i = 0; i < faces.length; i += 3) {
    const t = [faces[i]!, faces[i + 1]!, faces[i + 2]!].sort((a, b) => a - b);
    faceKey.add(t.join(","));
  }
  const EDGES: readonly (readonly [number, number, number])[] = [
    [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
  ];
  for (let e = 0; e < mesh.elementCount; e++) {
    const b = e * 10;
    for (const [ca, cb, cm] of EDGES) {
      for (const other of [0, 1, 2, 3]) {
        if (other === ca || other === cb) continue;
        const t = [mesh.elements[b + ca]!, mesh.elements[b + cb]!, mesh.elements[b + other]!]
          .sort((x, y) => x - y);
        if (faceKey.has(t.join(","))) out.add(mesh.elements[b + cm]!);
      }
    }
  }
  return out;
}

/** Radial distance of a node from the bore axis (the Y axis at BORE_CX, BORE_CZ). */
function radialFromBore(mesh: TetMesh, n: number): number {
  const x = mesh.nodes[n * 3]!, z = mesh.nodes[n * 3 + 2]!;
  return Math.sqrt((x - BORE_CX) ** 2 + (z - BORE_CZ) ** 2);
}

describe.skipIf(!gmsh.found)("two-region invariant #4 — C3D10 midsides on a CURVED bore (#316)", () => {
  let mesh: TetMesh;
  let faces: Int32Array;
  let dist: Float64Array;
  let corners: Set<number>;
  let boreCorners: number[];
  let boreMids: number[];
  let nSegments: number;
  let sagitta: number;
  const dMax = 5; // > tWall (1.35) + a mesh element edge, so the shell/core interface is resolved

  beforeAll(async () => {
    const step = boredPlateStep();
    // clCurv=24 targets ~24 circumferential segments on the bore; clMin/clMax
    // keep the element count modest so this stays a light-shard test.
    const res = await meshStepWithGmsh(step, { clMin: 0.8, clMax: 2.0, clCurv: 24, elementOrder: 2 });
    mesh = res.mesh;
    faces = extractSurfaceFaces(mesh);
    dist = computeNodeSurfaceDistances(mesh, faces, dMax);

    corners = boundaryCorners(faces);
    const mids = boundaryMidsides(mesh, faces);
    const rTol = 0.25; // a node is "on the bore" when its radius is within 0.25 mm of R
    const onBore = (n: number) => Math.abs(radialFromBore(mesh, n) - BORE_R) < rTol;
    boreCorners = [...corners].filter(onBore);
    boreMids = [...mids].filter((n) => !corners.has(n) && onBore(n));

    // Effective circumferential segment count from the mean bore chord length:
    // n ≈ circumference / mean edge. Robust on an unstructured surface mesh
    // (a node-angle count double-counts staggered rims). Only near-horizontal
    // (circumferential) bore edges are averaged; near-axial edges are skipped.
    let edgeSum = 0, edgeN = 0;
    for (let i = 0; i < faces.length; i += 3) {
      const tri = [faces[i]!, faces[i + 1]!, faces[i + 2]!];
      for (let a = 0; a < 3; a++) {
        const p = tri[a]!, q = tri[(a + 1) % 3]!;
        if (!onBore(p) || !onBore(q)) continue;
        const dx = mesh.nodes[p * 3]! - mesh.nodes[q * 3]!;
        const dy = mesh.nodes[p * 3 + 1]! - mesh.nodes[q * 3 + 1]!;
        const dz = mesh.nodes[p * 3 + 2]! - mesh.nodes[q * 3 + 2]!;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0 && Math.abs(dy) < 0.5 * len) { edgeSum += len; edgeN++; }
      }
    }
    const meanChord = edgeN > 0 ? edgeSum / edgeN : NaN;
    nSegments = Math.round((2 * Math.PI * BORE_R) / meanChord);
    sagitta = BORE_R * (1 - Math.cos(Math.PI / nSegments));
  }, 120_000);

  it("meshes to C3D10 with a resolved curved bore", () => {
    expect(mesh.nodesPerElem).toBe(10);
    expect(mesh.elementCount).toBeGreaterThan(0);
    expect(boreCorners.length).toBeGreaterThan(0);
    expect(boreMids.length).toBeGreaterThan(0);
    // Sanity on the segmentation the sagitta band is measured against: a bore
    // this size at clCurv=24 resolves to roughly 24 segments (~40 micron sagitta).
    expect(nSegments).toBeGreaterThanOrEqual(16);
    expect(nSegments).toBeLessThanOrEqual(40);
    expect(sagitta).toBeGreaterThan(0.01); // tens of microns, not noise
    expect(sagitta).toBeLessThan(0.15);
  });

  it("every boundary corner is EXACTLY 0, the bore included (vertices of boundary triangles)", () => {
    // Same value invariant as the flat cases: a corner is a vertex of a
    // boundary triangle, so Ericson's kernel returns bit-exact 0 there,
    // curvature notwithstanding.
    for (const n of corners) expect(dist[n]).toBe(0);
    for (const n of boreCorners) expect(dist[n]).toBe(0);
  });

  it("bore midsides carry the sagitta, not chord-placement float noise", () => {
    let worst = 0;
    for (const n of boreMids) worst = Math.max(worst, dist[n]!);

    // NOT bit-zero and far above the ~1.8e-15 float noise the chord fixtures
    // show: a regression to chord placement (midsides at the straight midpoint)
    // would drive this back toward zero and fail here.
    expect(worst).toBeGreaterThan(0.01); // > 10 microns

    // Bounded by the analytic sagitta for the observed segmentation. The worst
    // midside sits slightly above the ideal-arc sagitta (its nearest boundary
    // triangle spans a wider-than-mean chord), so the band is generous on the
    // high side; the low side guards against the offset collapsing to noise.
    expect(worst).toBeGreaterThan(0.3 * sagitta);
    expect(worst).toBeLessThan(2.0 * sagitta);
  });

  it("the sagitta is IMMATERIAL to the wall/core classification (#316 decision)", () => {
    // Counterfactual "chord" field: force each bore midside distance to 0, which
    // is what straight-midpoint placement produces (see the flat fixtures).
    // Compare the per-element wall fraction the two-region model consumes.
    const tWall = 1.35; // ~3 perimeters at 0.45 mm — the band CLAUDE.md cites
    const distChord = Float64Array.from(dist);
    for (const n of boreMids) distChord[n] = 0;

    const fracCurved = computeWallFractions(mesh, dist, tWall);
    const fracChord = computeWallFractions(mesh, distChord, tWall);

    let maxDelta = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      maxDelta = Math.max(maxDelta, Math.abs(fracCurved[e]! - fracChord[e]!));
    }
    // Measured ~3.6e-4 on this fixture: the ~40 micron offset sits deep in the
    // shell band (dist ≈ 0, far from the dist = tWall interface), so it moves no
    // element's wall fraction by even half a percent. Locks the "leave it alone"
    // decision — if a future change made the sagitta materially perturb the
    // classification, this ceiling fails.
    expect(maxDelta).toBeLessThan(5e-3);
    // And it is genuinely non-zero (the offset exists; it is merely small), so
    // this is a real measurement rather than a vacuous bound.
    expect(maxDelta).toBeGreaterThan(0);
  });
});
