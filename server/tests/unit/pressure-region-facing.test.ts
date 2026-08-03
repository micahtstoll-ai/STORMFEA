/**
 * `selectPressureRegion(region: "face")` must select a FACE, not a slab of space.
 *
 * "face" picks the extreme surface toward the load direction. It did that purely
 * by position: every boundary triangle whose centroid lay within a proximity
 * band of the extreme projection. A band is a slab, so it wraps around the rim
 * onto the ADJACENT, perpendicular surface — and how much it catches depends on
 * how finely the model happens to be meshed, not on its geometry.
 *
 * That made the pressure RESULTANT wrong. On a Ø20 x 40 cylinder loaded on its
 * top face, the shipped path selected the 313.3 mm² top disk plus 1 255.7 mm² of
 * full-height side wall, so a 1 MPa "top face" pressure applied 1 569 N instead
 * of 313 N — 5x the intended load, silently, with the correct-looking face
 * selected in the UI.
 *
 * The fix requires a selected triangle to actually face the load direction, the
 * same test `region: "facing"` already used. A perpendicular side wall has
 * n·d = 0 and is excluded regardless of mesh density.
 */
import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { selectPressureRegion, assembleSurfaceTraction } from "../../solver/load.js";
import type { TetMesh } from "../../solver/types.js";

/** Outward unit normal and area of boundary triangle t. */
function triNormal(mesh: TetMesh, faces: Int32Array, t: number) {
  const a = faces[t*3]!, b = faces[t*3+1]!, c = faces[t*3+2]!;
  const ax = mesh.nodes[a*3]!, ay = mesh.nodes[a*3+1]!, az = mesh.nodes[a*3+2]!;
  const bx = mesh.nodes[b*3]!, by = mesh.nodes[b*3+1]!, bz = mesh.nodes[b*3+2]!;
  const cx = mesh.nodes[c*3]!, cy = mesh.nodes[c*3+1]!, cz = mesh.nodes[c*3+2]!;
  const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
  const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
  const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  const len = Math.hypot(nx, ny, nz);
  return { nx: nx/len, ny: ny/len, nz: nz/len, area: 0.5*len };
}

describe('selectPressureRegion("face") selects a face, not a slab', () => {
  // A 10x10x10 box: the +z face is exactly 100 mm², and the four side walls are
  // exactly perpendicular to +z, so any of their area appearing in the selection
  // is unambiguously wrong.
  const L = 10, EXACT_FACE_AREA = L * L;

  for (const n of [2, 4, 8]) {
    it(`selects only the +z face at ${n}x${n}x${n} divisions`, () => {
      const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, n, n, n);
      const faces = extractSurfaceFaces(mesh);
      const isLoaded = selectPressureRegion(mesh.nodes, faces, [0, 0, 1], "face");

      let selectedArea = 0, sideArea = 0;
      for (let t = 0; t < isLoaded.length; t++) {
        if (!isLoaded[t]) continue;
        const { nz, area } = triNormal(mesh, faces, t);
        selectedArea += area;
        if (nz < 0.9) sideArea += area;      // not part of the +z face
      }

      expect(sideArea).toBe(0);
      expect(selectedArea).toBeCloseTo(EXACT_FACE_AREA, 6);
    });
  }

  it("gives a mesh-independent pressure resultant", () => {
    // The property that actually matters downstream: total force = p x A,
    // whatever the mesh density. Pre-fix this grew with refinement as the band
    // swept in more of the side wall.
    const p = 2.5;   // MPa
    const resultants = [2, 4, 8].map(n => {
      const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, n, n, n);
      const faces = extractSurfaceFaces(mesh);
      const isLoaded = selectPressureRegion(mesh.nodes, faces, [0, 0, 1], "face");
      const f = assembleSurfaceTraction(mesh, faces, isLoaded, [0, 0, p]);
      let fx = 0, fy = 0, fz = 0;
      for (let i = 0; i < mesh.nodeCount; i++) {
        fx += f[i*3]!; fy += f[i*3+1]!; fz += f[i*3+2]!;
      }
      return { fx, fy, fz };
    });

    for (const r of resultants) {
      expect(r.fz).toBeCloseTo(p * EXACT_FACE_AREA, 6);
      expect(r.fx).toBeCloseTo(0, 9);
      expect(r.fy).toBeCloseTo(0, 9);
    }
  });

  it("still never returns an empty selection for a valid direction", () => {
    // The non-emptiness guarantee (issue #157) must survive the added facing
    // test — an empty selection would apply zero load while looking normal.
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, 3, 3, 3);
    const faces = extractSurfaceFaces(mesh);
    for (const dir of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
                       [1,1,1],[-1,2,-0.5]] as [number,number,number][]) {
      const isLoaded = selectPressureRegion(mesh.nodes, faces, dir, "face");
      expect(isLoaded.some(Boolean), `direction ${dir.join(",")}`).toBe(true);
    }
  });

  it("leaves region 'facing' and 'all' untouched", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, 3, 3, 3);
    const faces = extractSurfaceFaces(mesh);
    const triCount = faces.length / 3;

    // 'all' selects everything.
    expect(selectPressureRegion(mesh.nodes, faces, [0,0,1], "all").every(Boolean)).toBe(true);

    // 'facing' selects exactly the triangles whose outward normal has a positive
    // component along the direction — for +z on a box, exactly the +z face.
    const facing = selectPressureRegion(mesh.nodes, faces, [0,0,1], "facing");
    let facingArea = 0;
    for (let t = 0; t < triCount; t++) {
      const { nz, area } = triNormal(mesh, faces, t);
      expect(facing[t]).toBe(nz > 1e-9);
      if (facing[t]) facingArea += area;
    }
    expect(facingArea).toBeCloseTo(EXACT_FACE_AREA, 6);
  });
});
