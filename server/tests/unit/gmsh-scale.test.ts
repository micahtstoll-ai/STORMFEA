/**
 * gmsh-scale.test.ts — issues #169 & #170.
 * ----------------------------------------
 * Locks the SCALE-RELATIVE Gmsh classification helpers:
 *   #169 classifyFaceByZ  — top/bottom faces classified against the mesh's own
 *                           z-extent (no absolute zMin>3.5 / zMax<0.5 constants).
 *   #170 holeRadiusWindow / isHoleFit / identifySurfaces — hole detection with
 *                           relative circularity + bbox-scaled radius window, and
 *                           corroboration before splitting a >90°-gap surface.
 *
 * All pure — no Gmsh binary needed (the real-binary path is mesher-integration.ts,
 * which skips without a binary). The acceptance invariant: the same geometry at
 * 0.1×/1×/10× scale classifies the same faces and detects the same holes.
 */
import { describe, it, expect } from 'vitest';
import {
  identifySurfaces,
  classifyFaceByZ,
  holeRadiusWindow,
  isHoleFit,
} from '../../gmsh_mesh.js';

// ── Cylinder-wall fixture generators (optionally a partial angular arc) ───────
function cylinderWall(
  cx: number, cy: number, radius: number, zMin: number, zMax: number,
  angularSamples = 16, zLevels = 5, arcDeg = 360, arcStartDeg = 0,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let z = 0; z < zLevels; z++) {
    const zVal = zMin + (zLevels === 1 ? 0.5 : z / (zLevels - 1)) * (zMax - zMin);
    for (let a = 0; a < angularSamples; a++) {
      const ang = ((arcStartDeg + (a / angularSamples) * arcDeg) * Math.PI) / 180;
      out.push([cx + radius * Math.cos(ang), cy + radius * Math.sin(ang), zVal]);
    }
  }
  return out;
}

function ringTris(nPerLevel: number, zLevels: number, base: number, closed = true): Array<[number, number, number]> {
  const tris: Array<[number, number, number]> = [];
  for (let z = 0; z < zLevels - 1; z++) {
    const z0 = base + z * nPerLevel, z1 = base + (z + 1) * nPerLevel;
    const span = closed ? nPerLevel : nPerLevel - 1;
    for (let a = 0; a < span; a++) {
      const a1 = (a + 1) % nPerLevel;
      tris.push([z0 + a, z0 + a1, z1 + a]);
      tris.push([z0 + a1, z1 + a1, z1 + a]);
    }
  }
  return tris;
}

function toFlat(groups: Array<Array<[number, number, number]>>): Float64Array {
  const flat: number[] = [];
  for (const g of groups) for (const [x, y, z] of g) flat.push(x, y, z);
  return new Float64Array(flat);
}

// ── #169: classifyFaceByZ ────────────────────────────────────────────────────
describe('classifyFaceByZ — extent-relative top/bottom (issue #169)', () => {
  it('classifies a thin (2 mm) part sitting at z=[0,2], where the old zMin>3.5 rule failed', () => {
    // Top flat face at z=2, bottom flat face at z=0; part is only 2 mm tall.
    expect(classifyFaceByZ(2, 2, 0, 2).type).toBe('top_face');
    expect(classifyFaceByZ(0, 0, 0, 2).type).toBe('bottom_face');
  });

  it('classifies an origin-centred part (z=[-5,5]) correctly', () => {
    expect(classifyFaceByZ(5, 5, -5, 5).type).toBe('top_face');
    expect(classifyFaceByZ(-5, -5, -5, 5).type).toBe('bottom_face');
  });

  it('is scale-invariant: same result at 0.1× and 10×', () => {
    for (const k of [0.1, 1, 10, 1000]) {
      expect(classifyFaceByZ(2 * k, 2 * k, 0, 2 * k).type).toBe('top_face');
      expect(classifyFaceByZ(0, 0, 0, 2 * k).type).toBe('bottom_face');
    }
  });

  it('leaves a vertical wall (large own z-span) and a mid-height ledge unclassified', () => {
    expect(classifyFaceByZ(0, 10, 0, 10).isFlat).toBe(false); // full-height wall
    expect(classifyFaceByZ(5, 5, 0, 10).type).toBe('unknown'); // flat ledge in the middle
  });

  it('degenerate zero-height part → unknown (no meaningful top/bottom)', () => {
    expect(classifyFaceByZ(3, 3, 3, 3).type).toBe('unknown');
  });
});

// ── #170: radius window / fit ────────────────────────────────────────────────
describe('holeRadiusWindow / isHoleFit (issue #170)', () => {
  it('scales the plausible radius window with the model bbox', () => {
    const w = holeRadiusWindow(100);
    expect(w.rMin).toBeCloseTo(0.1, 9);
    expect(w.rMax).toBeCloseTo(60, 9);
  });

  it('accepts a tight fit inside the window and rejects a non-circular one', () => {
    expect(isHoleFit({ rMean: 3, rStd: 0.01 }, 50)).toBe(true);
    expect(isHoleFit({ rMean: 3, rStd: 1.5 }, 50)).toBe(false);  // rStd/rMean = 0.5 ≫ ε
    expect(isHoleFit({ rMean: 40, rStd: 0.01 }, 50)).toBe(false); // radius > 0.6·diag
  });
});

// ── #170: identifySurfaces scale invariance & anti-phantom ───────────────────
describe('identifySurfaces — scale invariance (issue #170)', () => {
  it('detects the same single hole at 0.1×/1×/10× with a scale-consistent radius', () => {
    for (const k of [0.1, 1, 10]) {
      const wall = cylinderWall(5 * k, 5 * k, 1.5 * k, 0.5 * k, 3.5 * k, 16, 5);
      const surfaceTris = new Map([[1, ringTris(16, 5, 0)]]);
      const surfaces = identifySurfaces(toFlat([wall]), surfaceTris);
      const holes = surfaces.filter(s => s.type === 'hole_wall');
      expect(holes).toHaveLength(1);
      // radius scales with the geometry (relative detection, not an absolute mm window)
      expect(holes[0]!.holeInfo!.r).toBeGreaterThan(1.3 * k);
      expect(holes[0]!.holeInfo!.r).toBeLessThan(1.7 * k);
    }
  });
});

describe('identifySurfaces — >90° gap corroboration (issue #170)', () => {
  it('does NOT split a partially-occluded single wall into phantom holes', () => {
    // One hole (r=3) whose wall is only meshed over a 250° arc (110° gap) —
    // e.g. a counterbore / intersecting feature removed the rest. This is ONE
    // connected cluster, so the corroboration rule must refuse to split it.
    const arc = cylinderWall(0, 0, 3, 0.5, 3.5, 22, 5, 250, 0);
    const surfaceTris = new Map([[1, ringTris(22, 5, 0, /*closed*/ false)]]);
    const surfaces = identifySurfaces(toFlat([arc]), surfaceTris);
    const holes = surfaces.filter(s => s.type === 'hole_wall');
    expect(holes.length).toBeLessThanOrEqual(1); // never fabricates 2+ phantom holes
  });

  it('still splits two genuinely-separate holes merged under one surface tag', () => {
    // Two r=1.5 holes far apart (±25) → from the between-centroid the merged
    // cloud fits a large circle with a huge gap, but it corroborates into TWO
    // individually-circular clusters → split into two real holes.
    const h1 = cylinderWall(-25, 0, 1.5, 0.5, 3.5, 14, 5);
    const h2 = cylinderWall(25, 0, 1.5, 0.5, 3.5, 14, 5);
    const tris = [...ringTris(14, 5, 0), ...ringTris(14, 5, h1.length)];
    const surfaces = identifySurfaces(toFlat([h1, h2]), new Map([[1, tris]]));
    const holes = surfaces.filter(s => s.type === 'hole_wall');
    expect(holes).toHaveLength(2);
    for (const wall of holes) {
      expect(wall.holeInfo!.r).toBeGreaterThan(1.2);
      expect(wall.holeInfo!.r).toBeLessThan(1.8); // ~1.5, not a merged ~25 mm false radius
    }
  });
});
