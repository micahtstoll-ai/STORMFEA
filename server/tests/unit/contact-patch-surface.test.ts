/**
 * contact-patch-surface.test.ts — issue #305.
 *
 * `contact_patch` is the DEFAULT load distribution (#271) and the mode whose
 * whole promise is "the load is applied where you placed the arrow". It chose
 * its surface from the load DIRECTION instead: only triangles with n·d > 0 were
 * eligible, i.e. the surface the force points OUT of.
 *
 * A contact pushes. At the surface it presses on, the force points INTO the
 * material — n·d < 0 — so on every compressive load the surface under the
 * user's arrow was ineligible and the only candidates lay a full part thickness
 * away, outside the patch radius. The taper then selected nothing, and the
 * "patch fell between the triangles" fallback put the ENTIRE force onto one
 * triangle of the opposite face, chosen by index among tied candidates.
 *
 * That is a wrong-face, mesh-dependent point load on the default path, and its
 * visible symptom was #305: a mirror-symmetric part, symmetric constraint and a
 * load placed exactly ON the symmetry plane returning a 5.04% asymmetric stress
 * field, on a mesh with 100% centroid pairing (#296).
 *
 * The patch now grows from the triangle nearest the application point by EDGE
 * ADJACENCY, so it stays on the surface the point is on and `direction` selects
 * nothing. These tests pin both halves: the surface it lands on, and the
 * symmetry that follows from selecting by geometry rather than by index.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis, type AnalysisRequest } from "../../analysis.js";
import {
  generateBoxMeshC3D4, generateBoxMeshC3D10, extractSurfaceFaces,
} from "../../solver/meshgen.js";
import { mirrorTetMesh } from "../../solver/mirrorMesh.js";
import { assembleContactPatchLoad } from "../../solver/load.js";
import { buildSurfaceTriangleAdjacency } from "../../solver/adjacency.js";
import type { TetMesh } from "../../solver/types.js";

const L = 10;   // 10 mm cube

function cube(n: number): { mesh: TetMesh; faces: Int32Array } {
  const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, n, n, n);
  return { mesh, faces: extractSurfaceFaces(mesh) };
}

/** Every node carrying a non-zero force, with its position and force. */
function loadedNodes(mesh: TetMesh, f: Float64Array) {
  const out: Array<{ n: number; x: number; y: number; z: number; fx: number; fy: number; fz: number }> = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const fx = f[n*3] ?? 0, fy = f[n*3+1] ?? 0, fz = f[n*3+2] ?? 0;
    if (fx === 0 && fy === 0 && fz === 0) continue;
    out.push({ n, x: mesh.nodes[n*3] ?? 0, y: mesh.nodes[n*3+1] ?? 0, z: mesh.nodes[n*3+2] ?? 0, fx, fy, fz });
  }
  return out;
}

const resultant = (mesh: TetMesh, f: Float64Array) => {
  let x = 0, y = 0, z = 0;
  for (let n = 0; n < mesh.nodeCount; n++) { x += f[n*3] ?? 0; y += f[n*3+1] ?? 0; z += f[n*3+2] ?? 0; }
  return { x, y, z };
};

describe("buildSurfaceTriangleAdjacency — the rule's one primitive", () => {
  it("gives every triangle of a closed surface exactly three neighbours", () => {
    const { mesh, faces } = cube(4);
    const { ptr, list } = buildSurfaceTriangleAdjacency(faces, mesh.nodeCount);
    const triCount = faces.length / 3;
    expect(ptr.length).toBe(triCount + 1);
    for (let t = 0; t < triCount; t++) {
      const deg = (ptr[t+1] ?? 0) - (ptr[t] ?? 0);
      expect(deg, `triangle ${t}`).toBe(3);       // a manifold closed surface
    }
    // Symmetric: u is a neighbour of t iff t is a neighbour of u.
    for (let t = 0; t < triCount; t++) {
      for (let k = ptr[t] ?? 0; k < (ptr[t+1] ?? 0); k++) {
        const u = list[k] ?? 0;
        const back: number[] = [];
        for (let m = ptr[u] ?? 0; m < (ptr[u+1] ?? 0); m++) back.push(list[m] ?? 0);
        expect(back, `${u} -> ${t}`).toContain(t);
      }
    }
  });

  it("reaches every triangle of a closed surface from any one of them", () => {
    // Connectivity is the property the patch rule leans on; if the surface came
    // apart into components the patch could not grow across a face boundary.
    const { mesh, faces } = cube(3);
    const { ptr, list } = buildSurfaceTriangleAdjacency(faces, mesh.nodeCount);
    const triCount = faces.length / 3;
    const seen = new Uint8Array(triCount);
    const stack = [0];
    seen[0] = 1;
    let n = 1;
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = ptr[t] ?? 0; k < (ptr[t+1] ?? 0); k++) {
        const u = list[k] ?? 0;
        if (seen[u]) continue;
        seen[u] = 1; n++; stack.push(u);
      }
    }
    expect(n).toBe(triCount);
  });

  it("survives a degenerate triangle with a repeated corner", () => {
    const faces = Int32Array.from([0, 1, 2,  1, 2, 3,  4, 4, 5]);
    const { ptr, list } = buildSurfaceTriangleAdjacency(faces, 6);
    expect((ptr[1] ?? 0) - (ptr[0] ?? 0)).toBe(1);   // triangle 0 shares edge 1-2
    expect(list[ptr[0] ?? 0]).toBe(1);
    expect((ptr[3] ?? 0) - (ptr[2] ?? 0)).toBe(0);   // the degenerate one links nothing
  });
});

describe("assembleContactPatchLoad — the patch is on the placed surface (#305)", () => {
  it("a downward force placed on the top face loads the TOP face", () => {
    // The case that was entirely broken: a push. Before the fix this returned
    // one triangle on z = 0, carrying all 100 N.
    const { mesh, faces } = cube(10);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, L]);

    expect(r.loadedTriangles).toBeGreaterThan(1);     // a patch, not the fallback
    for (const nd of loadedNodes(mesh, r.forces)) {
      expect(nd.z, `node ${nd.n} loaded away from the placed surface`).toBeCloseTo(L, 9);
    }
    expect(resultant(mesh, r.forces).z).toBeCloseTo(-100, 9);
    // And the point really is on the surface, so nothing was snapped far.
    expect(r.centreSnapMm).toBeLessThan(r.radiusMm);
  });

  it("makes loadPatchRadiusMm load-bearing for a push, not inert", () => {
    // The other half of what the old rule broke: with the whole load on one
    // fallback triangle, the requested radius changed NOTHING. Measured on the
    // #305 bar, a 6 mm radius against a 2.75 mm default both returned the same
    // single triangle. A radius the caller passes is the one number this model
    // actually wants (docs/load-distribution-default.md), so it has to move the
    // patch.
    const { mesh, faces } = cube(12);
    const centre: [number, number, number] = [5, 5, L];
    const small = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], centre, 1.5);
    const large = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], centre, 4);

    expect(small.radiusMm).toBe(1.5);
    expect(large.radiusMm).toBe(4);
    expect(large.loadedTriangles).toBeGreaterThan(small.loadedTriangles * 2);
    // Same resultant either way — a different distribution, not a different load.
    expect(resultant(mesh, small.forces).z).toBeCloseTo(-100, 9);
    expect(resultant(mesh, large.forces).z).toBeCloseTo(-100, 9);
    // The wider patch really is wider on the part, not just in bookkeeping.
    const spread = (f: Float64Array) => Math.max(
      ...loadedNodes(mesh, f).map(nd => Math.hypot(nd.x - centre[0], nd.y - centre[1])),
    );
    expect(spread(large.forces)).toBeGreaterThan(spread(small.forces) * 1.5);
  });

  it("push and pull at the same point are the same patch with opposite sign", () => {
    // Whether the load is contact or a bolted pad in tension is the sign of the
    // force, not a property of the surface — so the SELECTION must not change.
    const { mesh, faces } = cube(10);
    const push = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, L]);
    const pull = assembleContactPatchLoad(mesh, faces, [0, 0,  1], [0, 0,  100], [5, 5, L]);

    expect(pull.loadedTriangles).toBe(push.loadedTriangles);
    expect(pull.radiusMm).toBe(push.radiusMm);
    for (let i = 0; i < push.forces.length; i++) {
      // Summed rather than negated so the unloaded slots' signed zeros compare
      // equal; for finite floats a + b === 0 is exact opposition.
      expect((pull.forces[i] ?? 0) + (push.forces[i] ?? 0), `dof ${i}`).toBe(0);
    }
  });

  it("does not reach through a thin part onto the far face", () => {
    // 10 x 10 x 1 plate, patch radius 4 — four times the thickness, so a
    // Euclidean ball centred on the top face contains most of the bottom face.
    // Edge adjacency excludes it: the rim is 5 mm away, further than the radius,
    // so there is no connected path to the far side.
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, 1, 10, 10, 2);
    const faces = extractSurfaceFaces(mesh);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, 1], 4);

    expect(r.loadedTriangles).toBeGreaterThan(1);
    for (const nd of loadedNodes(mesh, r.forces)) {
      expect(nd.z, `node ${nd.n} loaded on the far face`).toBeGreaterThan(0.5);
    }
    expect(resultant(mesh, r.forces).z).toBeCloseTo(-100, 9);
  });

  it("wraps onto the adjoining face when the point is placed on an edge", () => {
    // The flip side of the rule above, and it is the physical answer: a contact
    // on an edge really does bear on both faces. What it must NOT do is jump to
    // a face it is not connected to (the test above).
    const { mesh, faces } = cube(10);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 0, L], 2);
    const nodes = loadedNodes(mesh, r.forces);
    expect(nodes.some(nd => Math.abs(nd.z - L) < 1e-9)).toBe(true);   // top face
    expect(nodes.some(nd => Math.abs(nd.y - 0) < 1e-9)).toBe(true);   // y = 0 face
    // Never the two faces the edge does not touch.
    for (const nd of nodes) {
      expect(nd.z, `node ${nd.n}`).toBeGreaterThan(L / 2);
      expect(nd.y, `node ${nd.n}`).toBeLessThan(L / 2);
    }
    expect(resultant(mesh, r.forces).z).toBeCloseTo(-100, 9);
  });
});

// ── Mirror symmetry, the symptom #305 was filed on ──────────────────────────
const PLANE_Y = 6;
const barHalf = generateBoxMeshC3D10(0, 0, 0, 24, PLANE_Y, 6, 8, 2, 2);
const bar = mirrorTetMesh(barHalf, { normal: [0, 1, 0], origin: [0, PLANE_Y, 0] }).mesh;
const barFaces = extractSurfaceFaces(bar);

const posKey = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

/** Mirror-partner index for every node of the mirrored bar. */
const mirrorOf = (() => {
  const index = new Map<string, number>();
  for (let i = 0; i < bar.nodeCount; i++) {
    index.set(posKey(bar.nodes[i*3]!, bar.nodes[i*3+1]!, bar.nodes[i*3+2]!), i);
  }
  return (i: number): number | undefined =>
    index.get(posKey(bar.nodes[i*3]!, 2 * PLANE_Y - bar.nodes[i*3+1]!, bar.nodes[i*3+2]!));
})();

describe("assembleContactPatchLoad — a symmetric load stays symmetric (#305)", () => {
  it("mirror-pairs the loaded set and the weights exactly", () => {
    const r = assembleContactPatchLoad(bar, barFaces, [0, 0, -1], [0, 0, -120], [24, PLANE_Y, 6]);
    expect(r.loadedTriangles).toBeGreaterThan(1);
    let checked = 0;
    for (const nd of loadedNodes(bar, r.forces)) {
      const j = mirrorOf(nd.n);
      expect(j, `node ${nd.n} has no mirror partner`).toBeDefined();
      // Bit-identical, not merely close: the selection is by geometry and the
      // arithmetic on a mirrored mesh is exact.
      expect(r.forces[j!*3+2], `node ${nd.n} vs its mirror ${j}`).toBe(nd.fz);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("stays symmetric when the patch is smaller than the mesh", () => {
    // The fallback path. Loading the single nearest triangle resolves a tie by
    // index; both tied triangles are loaded instead.
    const r = assembleContactPatchLoad(bar, barFaces, [0, 0, -1], [0, 0, -120], [12, PLANE_Y, 6], 0.01);
    expect(r.loadedTriangles).toBeGreaterThan(0);
    for (const nd of loadedNodes(bar, r.forces)) {
      const j = mirrorOf(nd.n);
      expect(j).toBeDefined();
      expect(r.forces[j!*3+2], `node ${nd.n} vs its mirror ${j}`).toBe(nd.fz);
    }
    expect(resultant(bar, r.forces).z).toBeCloseTo(-120, 9);
  });
});

// ── End to end: the table in the issue ──────────────────────────────────────
function barSoup(): { positions: Float32Array; triangleCount: number } {
  const W = 2 * PLANE_Y, H = 6, X = 24;
  const c: Array<[number, number, number]> = [
    [0, 0, 0], [X, 0, 0], [X, W, 0], [0, W, 0],
    [0, 0, H], [X, 0, H], [X, W, H], [0, W, H],
  ];
  const quads = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
  const tris: Array<[number, number, number][]> = [];
  for (const [a, b, cc, d] of quads) tris.push([c[a!]!, c[b!]!, c[cc!]!], [c[a!]!, c[cc!]!, c[d!]!]);
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, ci) => { positions[ti * 9 + k * 3 + ci] = v; })));
  return { positions, triangleCount: tris.length };
}

/** The #296 acceptance request, with the load distribution left to the DEFAULT. */
function defaultLoadRequest(): AnalysisRequest {
  const { positions, triangleCount } = barSoup();
  const surfaceToNode = new Int32Array(bar.nodeCount);
  for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i;
  return {
    positions, triangleCount, fileType: "stl",
    bounds: { minX: 0, maxX: 24, minY: 0, maxY: 2 * PLANE_Y, minZ: 0, maxZ: 6 },
    holes: [{
      id: 0, centre: [3, PLANE_Y, 3], normal: [0, 0, 1], radius: 2,
      confidence: 1, edgeCount: 32, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    // No loadDistribution: this is the default path, which is the point.
    forces: [{ magnitude: 120, direction: [0, 0, -1], position: [24, PLANE_Y, 6] }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: { meshQuality: "standard", meshOrder: 2, includeVolumeField: true, twoRegion: false },
    _prebuiltMesh: { mesh: bar, surfaceToNode, surfaceFaces: barFaces },
  };
}

const decodeF32 = (b64: string): Float32Array => {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

/** RMS mirror asymmetry of a per-node field, as a percentage of its peak. */
function asymmetryPct(field: Float32Array): number {
  let sumSq = 0, paired = 0, peak = 0;
  for (let i = 0; i < bar.nodeCount; i++) {
    peak = Math.max(peak, Math.abs(field[i] ?? 0));
    const j = mirrorOf(i);
    if (j === undefined) continue;
    const d = (field[i] ?? 0) - (field[j] ?? 0);
    sumSq += d * d; paired++;
  }
  return peak > 0 ? (Math.sqrt(sumSq / paired) / peak) * 100 : NaN;
}

describe("issue #305: the DEFAULT load distribution returns a symmetric field", () => {
  it("SPR von Mises and both principals are mirror-symmetric", async () => {
    const r = await runAnalysis(defaultLoadRequest());
    // The premise, without which the field below would be noise (#296's lesson).
    expect(r.converged).toBe(true);
    expect(r.maxDisplacementMm).toBeLessThan(24);

    // Measured 5.0441% / 6.4493% / 2.5654% before the fix.
    expect(asymmetryPct(decodeF32(r.volumeField!.nodeVonMisesB64))).toBeLessThan(0.001);
    expect(asymmetryPct(decodeF32(r.volumeField!.nodePrincipal1B64))).toBeLessThan(0.001);
    expect(asymmetryPct(decodeF32(r.volumeField!.nodePrincipal3B64))).toBeLessThan(0.001);
  }, 300_000);
});
