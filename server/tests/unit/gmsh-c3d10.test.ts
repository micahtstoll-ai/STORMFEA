/**
 * gmsh-c3d10.test.ts
 * ------------------
 * Regression test pinning the Gmsh type-11 (C3D10) midside node ordering to
 * STORMFEA's convention (issue #167). The type-11 read in gmsh_mesh.ts assumes
 * "Gmsh ordering matches our element.ts" with no test; this exercises the real
 * binary and asserts the midpoint invariant, mirroring tetgen-c3d10.test.ts.
 *
 * Requires a gmsh binary (CI has one since #108). Skipped otherwise so the
 * suite stays green:
 *   npx vitest run server/tests/unit/gmsh-c3d10.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { meshStepWithGmsh, probeGmsh, type GmshMeshResult } from "../../gmsh_mesh.js";
import { analyzeC3D10MidsideOrdering, C3D10_MIDSIDE_EDGES } from "../../c3d10_ordering.js";

const gmsh = await probeGmsh();
if (!gmsh.found) {
  // eslint-disable-next-line no-console
  console.warn("SKIP: gmsh not found — skipping Gmsh C3D10 midnode-ordering regression test");
}

// A plain box STEP (flat faces → all C3D10 elements are straight-edged/affine,
// so their midsides sit at EXACT midpoints — the same clean invariant the
// TetGen test uses). Built via gmsh's OpenCASCADE kernel (-0 = geometry only).
function makeBoxStep(L: number, W: number, H: number): Buffer {
  const base = path.join(tmpdir(), `sf_gmsh_c3d10_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const geo =
    `SetFactory("OpenCASCADE");\n` +
    `Box(1) = {0,0,0, ${L},${W},${H}};\n`;
  writeFileSync(`${base}.geo`, geo);
  execFileSync("gmsh", [`${base}.geo`, "-0", "-o", `${base}.step`, "-format", "step"], { stdio: "ignore" });
  return readFileSync(`${base}.step`);
}

describe.skipIf(!gmsh.found)("Gmsh type-11 → C3D10 midnode ordering (requires gmsh)", () => {
  let mesh: GmshMeshResult;

  beforeAll(async () => {
    const step = makeBoxStep(10, 6, 4);
    mesh = await meshStepWithGmsh(step, { clMin: 1.5, clMax: 3.0, elementOrder: 2 });
  }, 120_000);

  it("produces 10-node elements", () => {
    expect(mesh.mesh.nodesPerElem).toBe(10);
    expect(mesh.mesh.elementCount).toBeGreaterThan(0);
    expect(mesh.mesh.elements.length).toBe(mesh.mesh.elementCount * 10);
  });

  it("midside ordering matches STORMFEA's convention (affine witnesses present)", () => {
    const a = analyzeC3D10MidsideOrdering(mesh.mesh.nodes, mesh.mesh.elements, mesh.mesh.elementCount);
    expect(a.ok).toBe(true);
    // A flat box meshes to affine elements → essentially all are witnesses.
    expect(a.affineWitnesses).toBeGreaterThan(0);
  });

  it("every midnode sits at the midpoint of its expected corner pair", () => {
    // Flat faces → exact midpoints (a small tolerance covers float rounding).
    let worst = 0;
    for (let e = 0; e < mesh.mesh.elementCount; e++) {
      const base = e * 10;
      for (let s = 0; s < 6; s++) {
        const [ca, cb] = C3D10_MIDSIDE_EDGES[s]!;
        const na = mesh.mesh.elements[base + ca]!, nb = mesh.mesh.elements[base + cb]!, nm = mesh.mesh.elements[base + 4 + s]!;
        let len2 = 0, dev2 = 0;
        for (let d = 0; d < 3; d++) {
          const A = mesh.mesh.nodes[na*3+d]!, B = mesh.mesh.nodes[nb*3+d]!, M = mesh.mesh.nodes[nm*3+d]!;
          const dd = M - 0.5 * (A + B); dev2 += dd*dd;
          const el = B - A; len2 += el*el;
        }
        if (len2 > 1e-30) worst = Math.max(worst, Math.sqrt(dev2 / len2));
      }
    }
    expect(worst).toBeLessThan(1e-6); // straight elements → ~0; a wrong order ⇒ ~0.5
  });
});
