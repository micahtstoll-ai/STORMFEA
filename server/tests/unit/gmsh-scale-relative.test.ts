/**
 * gmsh-scale-relative.test.ts — issues #169 and #170.
 * ---------------------------------------------------
 * STEP surface classification used to key off absolute-mm constants:
 *   - top/bottom faces via `zMin > 3.5` / `zMax < 0.5` (assumed base-at-0,
 *     height > 3.5 mm) — origin-centered and thin parts misclassified (#169);
 *   - holes via `rStd < 0.08` mm, radius window `0.5–15` mm, `1.0` mm merge,
 *     and a `>90°` gap heuristic that could fabricate phantom holes (#170).
 *
 * These are now bounding-box-relative / dimensionless. The tests prove:
 *   1. The same part classifies top/bottom identically whether base-at-0,
 *      origin-centered, or offset (#169).
 *   2. A thin (2 mm) plate gets BOTH faces classified (#169).
 *   3. Holes are detected identically at 1× and 10× scale (#170).
 *   4. A sub-0.5 mm pin hole and a >15 mm bore — both outside the old absolute
 *      window — are detected (#170).
 *   5. A single hole with a >90° angular gap is NOT split into phantom holes
 *      (#170).
 *   6. mm backward-compat: a base-at-0 part classifies exactly as intended.
 */

import { describe, it, expect } from "vitest";
import { identifySurfaces } from "../../gmsh_mesh.js";

type Tri = [number, number, number];

// ── Builders ────────────────────────────────────────────────────────────────

/** Flat rectangular face at height z on a [−hx,hx]×[−hy,hy] grid → tris + pts. */
function flatFace(z: number, hx: number, hy: number, n = 6): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++)
      pts.push([-hx + (2 * hx * i) / n, -hy + (2 * hy * j) / n, z]);
  return pts;
}

/** Cylindrical wall nodes around (cx,cy), radius r, spanning [zMin,zMax]. */
function cyl(cx: number, cy: number, r: number, zMin: number, zMax: number, na = 16, nz = 4): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let k = 0; k < nz; k++) {
    const z = zMin + (nz === 1 ? 0 : (k / (nz - 1)) * (zMax - zMin));
    for (let a = 0; a < na; a++) {
      const t = (a / na) * 2 * Math.PI;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t), z]);
    }
  }
  return pts;
}

/** Assemble a set of point-groups into a flat node buffer + per-group tris.
 *  Each group becomes its own surface tag (starting at 1). Triangles simply
 *  chain consecutive triples within the group (enough to enumerate its nodes). */
function assemble(groups: Array<Array<[number, number, number]>>): {
  nodes: Float64Array;
  surfaceTris: Map<number, Tri[]>;
} {
  const flat: number[] = [];
  const surfaceTris = new Map<number, Tri[]>();
  let base = 0;
  groups.forEach((g, gi) => {
    const tris: Tri[] = [];
    for (const [x, y, z] of g) flat.push(x, y, z);
    for (let i = 0; i + 2 < g.length; i++) tris.push([base + i, base + i + 1, base + i + 2]);
    surfaceTris.set(gi + 1, tris);
    base += g.length;
  });
  return { nodes: new Float64Array(flat), surfaceTris };
}

// A box shell: bottom face, top face, and 4 cylinder-ish "side" walls giving z
// extent. Returns the surfaces shifted so the box spans z ∈ [z0, z0+H].
function boxShell(H: number, z0: number, half = 20): Array<Array<[number, number, number]>> {
  const bottom = flatFace(z0, half, half);
  const top = flatFace(z0 + H, half, half);
  // side walls: vertical strips at x = ±half, y = ±half spanning the height
  const side: Array<[number, number, number]> = [];
  const nz = 5;
  for (let k = 0; k < nz; k++) {
    const z = z0 + (k / (nz - 1)) * H;
    side.push([half, 0, z], [-half, 0, z], [0, half, z], [0, -half, z]);
  }
  return [bottom, top, side];
}

// ── #169: top/bottom face detection ─────────────────────────────────────────

describe("top/bottom face detection is bounding-box-relative (issue #169)", () => {
  function classifyBox(H: number, z0: number) {
    const { nodes, surfaceTris } = assemble(boxShell(H, z0));
    const s = identifySurfaces(nodes, surfaceTris);
    return {
      top: s.filter(x => x.type === "top_face").length,
      bottom: s.filter(x => x.type === "bottom_face").length,
    };
  }

  it("classifies top+bottom identically for base-at-0, origin-centered, and offset (H=40)", () => {
    const base = classifyBox(40, 0);      // z ∈ [0,40]
    const centered = classifyBox(40, -20); // z ∈ [-20,20]  (old code: top at +20 misclassified)
    const offset = classifyBox(40, 137);   // z ∈ [137,177]
    expect(base).toEqual({ top: 1, bottom: 1 });
    expect(centered).toEqual({ top: 1, bottom: 1 });
    expect(offset).toEqual({ top: 1, bottom: 1 });
  });

  it("classifies BOTH faces of a thin 2 mm plate (old code left the top unknown)", () => {
    // 2 mm tall, base at 0: old `zMin > 3.5` never fires → no top face.
    const thin = classifyBox(2, 0);
    expect(thin.top).toBe(1);
    expect(thin.bottom).toBe(1);
  });

  it("mm backward-compat: a 10 mm part base-at-0 still classifies top and bottom", () => {
    const mm = classifyBox(10, 0);
    expect(mm).toEqual({ top: 1, bottom: 1 });
  });
});

// ── #170: hole detection ────────────────────────────────────────────────────

describe("hole detection is scale-relative (issue #170)", () => {
  // A plate (side walls give height) with two holes.
  function plateWithHoles(scale: number): { nodes: Float64Array; surfaceTris: Map<number, Tri[]> } {
    const H = 4 * scale, half = 20 * scale;
    const walls = boxShell(H, 0, half);          // bottom, top, side
    const holeA = cyl(-8 * scale, 0, 1.5 * scale, 0, H);
    const holeB = cyl(8 * scale, 2 * scale, 3.0 * scale, 0, H);
    return assemble([...walls, holeA, holeB]);
  }

  it("detects the same holes at 1× and 10× scale, radii scaling ×10", () => {
    const one = identifySurfaces(...(() => { const p = plateWithHoles(1); return [p.nodes, p.surfaceTris] as const; })());
    const ten = identifySurfaces(...(() => { const p = plateWithHoles(10); return [p.nodes, p.surfaceTris] as const; })());
    const hOne = one.filter(s => s.type === "hole_wall").map(s => s.holeInfo!.r).sort((a, b) => a - b);
    const hTen = ten.filter(s => s.type === "hole_wall").map(s => s.holeInfo!.r).sort((a, b) => a - b);
    expect(hOne.length).toBe(2);
    expect(hTen.length).toBe(2);
    for (let i = 0; i < 2; i++) expect(hTen[i]! / hOne[i]!).toBeCloseTo(10, 5);
  });

  it("detects a sub-0.5 mm pin hole and a >15 mm bore — both outside the OLD absolute window", () => {
    // A ~60 mm plate holding a 0.45 mm-radius pin hole (< old min 0.5) and an
    // 18 mm-radius bore (> old max 15) — both rejected by the old 0.5–15 mm
    // window, both inside the scale-relative window here.
    const H = 6, half = 30;
    const walls = boxShell(H, 0, half);
    const pin = cyl(-20, 0, 0.45, 0, H, 24, 4);   // r=0.45 < old min 0.5
    const bore = cyl(10, 0, 18, 0, H, 48, 4);      // r=18  > old max 15
    const { nodes, surfaceTris } = assemble([...walls, pin, bore]);
    const holes = identifySurfaces(nodes, surfaceTris).filter(s => s.type === "hole_wall");
    const radii = holes.map(h => h.holeInfo!.r).sort((a, b) => a - b);
    expect(radii.length).toBe(2);
    expect(radii[0]!).toBeCloseTo(0.45, 1);
    expect(radii[1]!).toBeCloseTo(18, 0);
  });
});

describe("gap heuristic never fabricates phantom holes (issue #170)", () => {
  it("a single hole with a >90° angular gap yields at most one hole, never a phantom split", () => {
    // A full-height wall covering only 240° of arc (120° gap) — e.g. a hole
    // opened by an intersecting slot. Must never become 2+ detected holes.
    const H = 4, half = 20;
    const walls = boxShell(H, 0, half);
    const partial: Array<[number, number, number]> = [];
    const nz = 4, na = 16;
    for (let k = 0; k < nz; k++) {
      const z = (k / (nz - 1)) * H;
      for (let a = 0; a < na; a++) {
        const t = (a / na) * (2 * Math.PI * 240 / 360); // only 240° of the circle
        partial.push([2 + 2.5 * Math.cos(t), 2.5 * Math.sin(t), z]);
      }
    }
    const { nodes, surfaceTris } = assemble([...walls, partial]);
    const holes = identifySurfaces(nodes, surfaceTris).filter(s => s.type === "hole_wall");
    expect(holes.length).toBeLessThanOrEqual(1);
  });

  it("a genuinely full circular hole is still detected (control)", () => {
    const H = 4, half = 20;
    const walls = boxShell(H, 0, half);
    const full = cyl(0, 0, 2.5, 0, H);
    const { nodes, surfaceTris } = assemble([...walls, full]);
    const holes = identifySurfaces(nodes, surfaceTris).filter(s => s.type === "hole_wall");
    expect(holes.length).toBe(1);
    expect(holes[0]!.holeInfo!.r).toBeCloseTo(2.5, 1);
  });
});
