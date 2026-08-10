/**
 * surface-clip.test.ts — issue #300
 *
 * `clipSurfaceAtPlane` produces the closed surface of a half-space
 * intersection: the input a mesher needs to tetrahedralise a fundamental
 * domain (#296). Almost all of it is pure geometry, so almost all of it is
 * testable with no TetGen or Gmsh present — which matters because the tests
 * that would catch a silently WRONG answer are exactly the mesher-free ones:
 *
 *  - **Closure is binary.** TetGen given an unclosed PLC does not reliably
 *    fail; it can tetrahedralise something that is not the part. So every case
 *    below asserts closure directly rather than inferring it from a mesh.
 *  - **The cap is a polygon with HOLES.** Clipping a plate through its bore
 *    leaves the bore's cross-section as an inner loop. A triangle fan over the
 *    outer loop would tile straight across it and hand the mesher a solid
 *    where the part has a hole — closed, plausible, and wrong. The analytic
 *    cap-area check is what separates the two: the fan answer is the full
 *    3600 mm², the correct answer is 3600 minus the bore polygon.
 *  - **Volume is the end-to-end statement.** Half the part, and the two halves
 *    summing to the whole, catch orientation errors, lost triangles and
 *    double-counted caps in one number.
 *
 * The one thing that genuinely needs a mesher — that TetGen ACCEPTS the output
 * — is gated on the binary at the bottom of the file.
 */

import { describe, it, expect } from "vitest";
import {
  clipSurfaceAtPlane,
  checkSurfaceClosure,
  signedVolumeOf,
  surfaceBoundingBox,
  surfaceSnapTolerance,
  SURFACE_SNAP_TOL_REL,
  type SurfaceMesh,
} from "../../solver/clip.js";
import { extractSurfaceFaces } from "../../solver/meshgen.js";
import { buildPlateWithHoleMesh } from "../../coupon_fea.js";
import { weldVertices, weldToleranceForDiag, meshWithTetGen, probeTetGen } from "../../tetgen.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Closed, outward-oriented box surface: 8 vertices, 12 triangles. */
function boxSurface(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): SurfaceMesh {
  const positions = Float64Array.from([
    x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0,   // 0..3  z = z0
    x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1,   // 4..7  z = z1
  ]);
  const faces = Int32Array.from([
    0, 2, 1,  0, 3, 2,     // -z
    4, 5, 6,  4, 6, 7,     // +z
    0, 1, 5,  0, 5, 4,     // -y
    3, 7, 6,  3, 6, 2,     // +y
    0, 4, 7,  0, 7, 3,     // -x
    1, 2, 6,  1, 6, 5,     // +x
  ]);
  return { positions, faces };
}

/**
 * Rectangular plate with a centred circular through-bore, as a closed surface.
 *
 * `buildPlateWithHoleMesh` is the repo's mesher-free structured fixture (the
 * Kirsch Kt benchmark's geometry). Its boundary is exact and ANALYTIC, which is
 * what makes the cap-area assertions below possible:
 *   - the outer boundary is exactly the square, provided a ray lands on each
 *     corner — true for a square plate whenever nTheta is a multiple of 8;
 *   - the bore is exactly a regular nTheta-gon of radius r, area
 *     ½·nTheta·r²·sin(2π/nTheta) — NOT πr², so the check must use the polygon.
 *
 * Axes: x ∈ [−W/2, W/2], y ∈ [0, T] (the bore axis), z ∈ [−L/2, L/2].
 */
const PLATE = { W: 60, T: 6, L: 60, R: 5, nTheta: 64 } as const;

function plateWithBore(): SurfaceMesh {
  const mesh = buildPlateWithHoleMesh({
    widthMm: PLATE.W, thickMm: PLATE.T, lengthMm: PLATE.L, holeR: PLATE.R,
    nTheta: PLATE.nTheta, ns: 5, nThick: 2,
  });
  return { positions: mesh.nodes, faces: extractSurfaceFaces(mesh) };
}

/** Area of the regular nTheta-gon the fixture's bore actually is. */
const BORE_POLY_AREA = 0.5 * PLATE.nTheta * PLATE.R * PLATE.R * Math.sin((2 * Math.PI) / PLATE.nTheta);
/** Cross-sectional area normal to the bore axis: square minus bore polygon. */
const PLATE_SECTION_AREA = PLATE.W * PLATE.L - BORE_POLY_AREA;
const PLATE_VOLUME = PLATE_SECTION_AREA * PLATE.T;

// ─── #296-scope helpers, here only to exercise the clip output ───────────────
// Mirroring and welding belong to symmetry-preserving meshing, not to #300.
// They appear here as test fixtures because the round trip is the strongest
// statement available about the clip: clip, mirror, weld, and the original
// solid comes back watertight.

function mirrorSurface(s: SurfaceMesh, n: readonly [number, number, number], o: readonly [number, number, number]): SurfaceMesh {
  const positions = Float64Array.from(s.positions);
  const count = positions.length / 3;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const d = (x - o[0]) * n[0] + (y - o[1]) * n[1] + (z - o[2]) * n[2];
    positions[v * 3] = x - 2 * d * n[0];
    positions[v * 3 + 1] = y - 2 * d * n[1];
    positions[v * 3 + 2] = z - 2 * d * n[2];
  }
  // A mirror reverses orientation, so every triangle's winding flips or the
  // whole surface ends up inside-out (a negative volume).
  const faces = Int32Array.from(s.faces);
  for (let t = 0; t < faces.length / 3; t++) {
    const b = faces[t * 3 + 1]!;
    faces[t * 3 + 1] = faces[t * 3 + 2]!;
    faces[t * 3 + 2] = b;
  }
  return { positions, faces };
}

/** Drop `count` triangles starting at `start` — used to remove the cap faces. */
function withoutFaces(s: SurfaceMesh, start: number, count: number): SurfaceMesh {
  const keep: number[] = [];
  for (let t = 0; t < s.faces.length / 3; t++) {
    if (t >= start && t < start + count) continue;
    keep.push(s.faces[t * 3]!, s.faces[t * 3 + 1]!, s.faces[t * 3 + 2]!);
  }
  return { positions: s.positions, faces: Int32Array.from(keep) };
}

/** Weld two surfaces into one, through the repo's production vertex weld. */
function weldTogether(a: SurfaceMesh, b: SurfaceMesh): SurfaceMesh {
  const triCount = (a.faces.length + b.faces.length) / 3;
  const soup = new Float32Array(triCount * 9);
  let w = 0;
  for (const s of [a, b]) {
    for (let i = 0; i < s.faces.length; i++) {
      const v = s.faces[i]!;
      soup[w++] = s.positions[v * 3]!;
      soup[w++] = s.positions[v * 3 + 1]!;
      soup[w++] = s.positions[v * 3 + 2]!;
    }
  }
  const weld = weldVertices(soup, triCount);
  return { positions: weld.positions, faces: weld.faces };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("clipSurfaceAtPlane — closure and volume", () => {
  it("clips a box in half: watertight, exactly half the volume, one cap loop", () => {
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: [5, 0, 0] });

    expect(r.closure.closed).toBe(true);
    expect(r.closure.openEdges).toBe(0);
    expect(r.closure.nonManifoldEdges).toBe(0);
    expect(r.closure.inconsistentEdges).toBe(0);

    expect(signedVolumeOf(r.surface)).toBeCloseTo(500, 9);
    expect(r.outerLoopCount).toBe(1);
    expect(r.holeLoopCount).toBe(0);
    expect(r.capArea).toBeCloseTo(100, 9);
    expect(r.capFaceCount).toBeGreaterThan(0);
    expect(r.degenerateCapTriangles).toBe(0);
    expect(r.capFallbackCount).toBe(0);
  });

  it("caps with the normal pointing OUT of the kept half", () => {
    // An inward-facing cap still closes the surface and still has the right
    // area — but the enclosed volume comes out wrong, so this asserts the
    // orientation directly rather than trusting the volume to notice.
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: [5, 0, 0] });
    const p = r.surface.positions, f = r.surface.faces;
    for (let t = r.capFaceStart; t < f.length / 3; t++) {
      const a = f[t * 3]!, b = f[t * 3 + 1]!, c = f[t * 3 + 2]!;
      const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
      const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
      const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
      expect(uy * vz - uz * vy).toBeGreaterThan(0);   // normal · (+x) > 0
    }
  });

  it("the two halves' volumes sum to the original", () => {
    const box = boxSurface(-3, -4, -5, 7, 6, 5);
    const total = signedVolumeOf(box);
    const plane = { origin: [1.25, 0, 0] as const };
    const lower = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: plane.origin });
    const upper = clipSurfaceAtPlane(box, { normal: [-1, 0, 0], origin: plane.origin });

    expect(lower.closure.closed).toBe(true);
    expect(upper.closure.closed).toBe(true);
    expect(signedVolumeOf(lower.surface) + signedVolumeOf(upper.surface)).toBeCloseTo(total, 9);
  });

  it("clips on an oblique plane through the body diagonal", () => {
    // Nothing above is axis-aligned by necessity, but everything above IS
    // axis-aligned, which would hide a basis or projection error in the cap.
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const n: [number, number, number] = [1, 1, 1];
    const r = clipSurfaceAtPlane(box, { normal: n, origin: [10, 0, 0] });
    expect(r.closure.closed).toBe(true);
    // The plane through (10,0,0), (0,10,0), (0,0,10) cuts off the corner tet at
    // the origin: an octant of side 10, volume 10³/6.
    expect(signedVolumeOf(r.surface)).toBeCloseTo(1000 / 6, 9);
    // Cap is the equilateral triangle of side 10√2: √3/4 · 200.
    expect(r.capArea).toBeCloseTo((Math.sqrt(3) / 4) * 200, 9);
  });

  it("leaves a part the plane misses completely untouched", () => {
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: [20, 0, 0] });
    expect(r.capFaceCount).toBe(0);
    expect(r.closure.closed).toBe(true);
    expect(signedVolumeOf(r.surface)).toBeCloseTo(1000, 9);
    expect(r.discardedTriangleCount).toBe(0);
  });

  it("returns an empty surface when the plane discards the whole part", () => {
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: [-5, 0, 0] });
    expect(r.surface.faces.length).toBe(0);
    expect(r.capFaceCount).toBe(0);
    expect(r.closure.closed).toBe(false);   // nothing is not a closed solid
  });
});

describe("clipSurfaceAtPlane — on-plane and coplanar input", () => {
  it("keeps a flat face lying exactly ON the plane when it bounds kept material", () => {
    // An ordinary FTC bracket, not a pathological input: the box's bottom face
    // is coplanar with the cut, and all the material is on the kept side.
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [0, 0, -1], origin: [0, 0, 0] });
    expect(r.closure.closed).toBe(true);
    expect(signedVolumeOf(r.surface)).toBeCloseTo(1000, 9);
    expect(r.capFaceCount).toBe(0);          // the coplanar face IS the boundary
    expect(r.discardedTriangleCount).toBe(0);
  });

  it("drops a coplanar face whose material is on the discarded side", () => {
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const r = clipSurfaceAtPlane(box, { normal: [0, 0, 1], origin: [0, 0, 0] });
    expect(r.surface.faces.length).toBe(0);  // a zero-thickness shell is not a solid
  });

  it("uses existing vertices, not new split points, where the plane passes through them", () => {
    // The plate fixture has a full node layer at y = T/2 (nThick = 2), so the
    // cut lands exactly on existing vertices. The correct behaviour is to emit
    // NO split point there — a split at distance zero is the zero-area sliver
    // this module exists to avoid.
    const plate = plateWithBore();
    const before = plate.positions.length / 3;
    const r = clipSurfaceAtPlane(plate, { normal: [0, 1, 0], origin: [0, PLATE.T / 2, 0] });

    expect(r.closure.closed).toBe(true);
    expect(r.degenerateCapTriangles).toBe(0);
    expect(signedVolumeOf(r.surface)).toBeCloseTo(PLATE_VOLUME / 2, 6);
    // Some new vertices are legitimate (side-wall triangles whose diagonals
    // straddle the layer), but the count must stay far below "one per cut edge
    // plus a duplicate of every on-plane vertex".
    expect(r.surface.positions.length / 3).toBeLessThan(before);
  });

  it("snaps a vertex within tolerance onto the plane instead of emitting a sliver", () => {
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const diag = surfaceBoundingBox(box).diag;
    const tol = surfaceSnapTolerance(diag);
    // Cut a hair BELOW the far face: without snapping this shaves a
    // 0.4·tol-thick shell off the box and leaves a cap of near-zero-area
    // slivers. With snapping the far face lands exactly on the plane.
    const r = clipSurfaceAtPlane(box, { normal: [1, 0, 0], origin: [10 - 0.4 * tol, 0, 0] });

    expect(r.snappedVertexCount).toBe(4);
    expect(r.closure.closed).toBe(true);
    expect(r.capFaceCount).toBe(0);
    expect(r.degenerateCapTriangles).toBe(0);
    expect(signedVolumeOf(r.surface)).toBeCloseTo(100 * (10 - 0.4 * tol), 9);
  });

  it("clips identically at any unit scale", () => {
    // Every tolerance in the clipper is a fraction of the bounding-box
    // diagonal, for the reason issue #168 documents: a fixed absolute epsilon
    // silently assumes the model is in millimetres. The same part in metres
    // must clip to the same topology, and to the same volume once scaled back.
    const S = 1000;
    const mm = clipSurfaceAtPlane(boxSurface(0, 0, 0, 10, 10, 10), { normal: [1, 1, 0], origin: [5, 0, 0] });
    const m  = clipSurfaceAtPlane(boxSurface(0, 0, 0, 10 * S, 10 * S, 10 * S), { normal: [1, 1, 0], origin: [5 * S, 0, 0] });

    expect(m.closure.closed).toBe(true);
    expect(m.surface.faces.length).toBe(mm.surface.faces.length);
    expect(m.outerLoopCount).toBe(mm.outerLoopCount);
    expect(m.degenerateCapTriangles).toBe(0);
    expect(signedVolumeOf(m.surface) / S ** 3).toBeCloseTo(signedVolumeOf(mm.surface), 6);
  });

  it("reports an open input rather than capping a boundary off the plane", () => {
    // Capping an edge that is not on the plane would invent geometry. The
    // clipper drops it and the closure report says so — which is the check
    // that has to run BEFORE a mesher sees the result.
    const box = boxSurface(0, 0, 0, 10, 10, 10);
    const open: SurfaceMesh = { positions: box.positions, faces: box.faces.slice(0, 30) };  // -x face removed
    const r = clipSurfaceAtPlane(open, { normal: [0, 0, 1], origin: [0, 0, 5] });
    expect(r.closure.closed).toBe(false);
    expect(r.closure.openEdges).toBeGreaterThan(0);
  });

  it("shares one snap tolerance with the vertex weld", () => {
    // Not a style check: the clip decides which vertices sit exactly on the
    // plane and the weld decides which of those are the same point after
    // mirroring. Two literals that agree today are the seam failing later.
    for (const diag of [1, 17.32, 250, 1e4]) {
      expect(weldToleranceForDiag(diag)).toBe(surfaceSnapTolerance(diag));
    }
    expect(surfaceSnapTolerance(1e6)).toBe(1e6 * SURFACE_SNAP_TOL_REL);
    expect(surfaceSnapTolerance(0)).toBeGreaterThan(0);   // degenerate input
  });
});

describe("clipSurfaceAtPlane — the cap is a polygon with holes", () => {
  it("cuts a plate through its bore and removes the bore from the cap", () => {
    const plate = plateWithBore();
    expect(checkSurfaceClosure(plate).closed).toBe(true);

    const r = clipSurfaceAtPlane(plate, { normal: [0, 1, 0], origin: [0, PLATE.T / 2, 0] });

    expect(r.closure.closed).toBe(true);
    expect(r.outerLoopCount).toBe(1);
    expect(r.holeLoopCount).toBe(1);

    // THE test. A fan over the outer loop gives 3600 (the full square) and a
    // closed, plausible, wrong solid. The correct cap is the square minus the
    // bore polygon — and the bore is a 64-gon, so πr² is not the answer either.
    expect(r.capArea).toBeCloseTo(PLATE_SECTION_AREA, 6);
    expect(r.capArea).toBeLessThan(PLATE.W * PLATE.L - 0.9 * BORE_POLY_AREA);
    expect(r.capArea).toBeCloseTo(r.loopArea, 6);
    expect(r.capFallbackCount).toBe(0);
    expect(r.degenerateCapTriangles).toBe(0);

    expect(signedVolumeOf(r.surface)).toBeCloseTo(PLATE_VOLUME / 2, 6);
  });

  it("handles a cut that leaves two disjoint cross-sections", () => {
    // Cutting the same plate ALONG the bore axis splits the section into two
    // rectangles either side of the bore: two outer loops, no holes. A
    // single-outer-loop assumption would bridge them across the void.
    const plate = plateWithBore();
    const r = clipSurfaceAtPlane(plate, { normal: [0, 0, 1], origin: [0, 0, 0] });

    expect(r.closure.closed).toBe(true);
    expect(r.outerLoopCount).toBe(2);
    expect(r.holeLoopCount).toBe(0);
    // Section is the 60 x 6 rectangle less the 10 x 6 strip the bore occupies
    // (the bore polygon has vertices exactly at x = ±R on this plane).
    expect(r.capArea).toBeCloseTo(PLATE.W * PLATE.T - 2 * PLATE.R * PLATE.T, 6);
    expect(signedVolumeOf(r.surface)).toBeCloseTo(PLATE_VOLUME / 2, 6);
  });
});

describe("clipSurfaceAtPlane — clip / mirror / weld round trip", () => {
  it("rebuilds the original solid from one half", () => {
    // The end-to-end statement for #296: if the clip is watertight and its cut
    // lies exactly on the plane, mirroring the half and welding the seam must
    // give back the original part.
    const plate = plateWithBore();
    const plane = { normal: [0, 0, 1] as const, origin: [0, 0, 0] as const };
    const r = clipSurfaceAtPlane(plate, plane);
    expect(r.closure.closed).toBe(true);

    // The cap is the seam. Both halves' caps become internal once joined, so
    // they are dropped before welding — hence `capFaceStart` on the result.
    const half = withoutFaces(r.surface, r.capFaceStart, r.capFaceCount);
    const joined = weldTogether(half, mirrorSurface(half, plane.normal, plane.origin));

    const closure = checkSurfaceClosure(joined);
    expect(closure.openEdges).toBe(0);
    expect(closure.nonManifoldEdges).toBe(0);
    expect(closure.inconsistentEdges).toBe(0);
    expect(closure.closed).toBe(true);
    // Loose tolerance: the weld runs through float32, as the STL path does.
    expect(signedVolumeOf(joined)).toBeCloseTo(PLATE_VOLUME, 1);
  });
});

describe("checkSurfaceClosure", () => {
  it("accepts a closed box and rejects one with a face removed", () => {
    const box = boxSurface(0, 0, 0, 1, 1, 1);
    expect(checkSurfaceClosure(box).closed).toBe(true);

    const holed: SurfaceMesh = { positions: box.positions, faces: box.faces.slice(3) };
    const report = checkSurfaceClosure(holed);
    expect(report.closed).toBe(false);
    expect(report.openEdges).toBeGreaterThan(0);
  });

  it("rejects a surface with one triangle wound the wrong way", () => {
    // Two triangles sharing an edge in the SAME direction: every edge is still
    // used twice, so an undirected edge count would pass this.
    const box = boxSurface(0, 0, 0, 1, 1, 1);
    const faces = Int32Array.from(box.faces);
    const b = faces[1]!;
    faces[1] = faces[2]!;
    faces[2] = b;
    const report = checkSurfaceClosure({ positions: box.positions, faces });
    expect(report.openEdges).toBe(0);
    expect(report.inconsistentEdges).toBeGreaterThan(0);
    expect(report.closed).toBe(false);
  });
});

// ─── Mesher-gated: the one claim that needs a real mesher ────────────────────

const probe = await probeTetGen();

describe.skipIf(!probe.found)("TetGen accepts the clipped surface (requires tetgen binary)", () => {
  it("tetrahedralises the half plate to the analytic half volume", async () => {
    const plate = plateWithBore();
    const r = clipSurfaceAtPlane(plate, { normal: [0, 1, 0], origin: [0, PLATE.T / 2, 0] });
    expect(r.closure.closed).toBe(true);

    const triCount = r.surface.faces.length / 3;
    const soup = new Float32Array(triCount * 9);
    for (let i = 0; i < r.surface.faces.length; i++) {
      const v = r.surface.faces[i]!;
      soup[i * 3]     = r.surface.positions[v * 3]!;
      soup[i * 3 + 1] = r.surface.positions[v * 3 + 1]!;
      soup[i * 3 + 2] = r.surface.positions[v * 3 + 2]!;
    }

    const { mesh } = await meshWithTetGen(soup, triCount, 1, 40);
    expect(mesh.elementCount).toBeGreaterThan(0);

    let vol = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      const n0 = mesh.elements[e * 4]!, n1 = mesh.elements[e * 4 + 1]!;
      const n2 = mesh.elements[e * 4 + 2]!, n3 = mesh.elements[e * 4 + 3]!;
      const ax = mesh.nodes[n0 * 3]!, ay = mesh.nodes[n0 * 3 + 1]!, az = mesh.nodes[n0 * 3 + 2]!;
      const bx = mesh.nodes[n1 * 3]! - ax, by = mesh.nodes[n1 * 3 + 1]! - ay, bz = mesh.nodes[n1 * 3 + 2]! - az;
      const cx = mesh.nodes[n2 * 3]! - ax, cy = mesh.nodes[n2 * 3 + 1]! - ay, cz = mesh.nodes[n2 * 3 + 2]! - az;
      const dx = mesh.nodes[n3 * 3]! - ax, dy = mesh.nodes[n3 * 3 + 1]! - ay, dz = mesh.nodes[n3 * 3 + 2]! - az;
      vol += Math.abs(bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx)) / 6;
    }
    // A cap that fanned across the bore would come back ~78·3 = 235 mm³ heavy.
    expect(vol).toBeCloseTo(PLATE_VOLUME / 2, 0);
  }, 120_000);
});
