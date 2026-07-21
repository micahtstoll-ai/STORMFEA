/**
 * tetgen-scale.test.ts — issue #168.
 * ----------------------------------
 * Unit tests for the SCALE-RELATIVE meshing helpers factored out of tetgen.ts:
 *   - weldToleranceForDiag / weldVertices  (weld grid scales with model size)
 *   - tetMaxVolumeForTier                  (element count is scale-invariant)
 *
 * These are pure functions, so they run with NO tetgen binary (the real-binary
 * integration coverage lives in tetgen-c3d10.test.ts / mesher-integration.test.ts,
 * which skip when the binary is absent). The invariant we lock here is the whole
 * point of #168: the same geometry at 0.1×/1×/10× scale must weld to the same
 * vertex topology and mesh to the same element count.
 */
import { describe, it, expect } from 'vitest';
import {
  weldVertices,
  weldToleranceForDiag,
  boundingBoxOf,
  tetMaxVolumeForTier,
} from '../../tetgen.js';

// ─── A cube as a 12-triangle soup (every corner shared by 4–6 triangles) ─────
const CUBE_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const CUBE_TRIS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

function cubeSoup(scale: number, offset = 0): { positions: Float32Array; triangleCount: number } {
  const positions = new Float32Array(CUBE_TRIS.length * 9);
  CUBE_TRIS.forEach(([a, b, c], t) => {
    [a, b, c].forEach((vi, k) => {
      const v = CUBE_VERTS[vi]!;
      positions[t * 9 + k * 3]     = v[0] * scale + offset;
      positions[t * 9 + k * 3 + 1] = v[1] * scale + offset;
      positions[t * 9 + k * 3 + 2] = v[2] * scale + offset;
    });
  });
  return { positions, triangleCount: CUBE_TRIS.length };
}

describe('weldToleranceForDiag (issue #168)', () => {
  it('is proportional to the bbox diagonal', () => {
    expect(weldToleranceForDiag(100)).toBeCloseTo(100 * 1e-6, 12);
    // 10× the model → 10× the tolerance (grid tracks the model's magnitude).
    expect(weldToleranceForDiag(1000) / weldToleranceForDiag(100)).toBeCloseTo(10, 9);
  });

  it('stays strictly positive for a degenerate zero-size model', () => {
    expect(weldToleranceForDiag(0)).toBeGreaterThan(0);
  });
});

describe('boundingBoxOf', () => {
  it('measures the used vertex range and its diagonal', () => {
    const { positions, triangleCount } = cubeSoup(2, 0); // unit cube ×2 → 2×2×2
    const bb = boundingBoxOf(positions, triangleCount * 3);
    expect(bb.min).toEqual([0, 0, 0]);
    expect(bb.max).toEqual([2, 2, 2]);
    expect(bb.diag).toBeCloseTo(Math.sqrt(12), 6);
  });
});

describe('weldVertices scale invariance (issue #168)', () => {
  it('welds a cube soup to 8 vertices at every scale, with identical topology', () => {
    const scales = [0.001, 0.1, 1, 10, 1000];
    const ref = weldVertices(cubeSoup(1).positions, CUBE_TRIS.length);
    expect(ref.vertCount).toBe(8);
    for (const s of scales) {
      const w = weldVertices(cubeSoup(s).positions, CUBE_TRIS.length);
      expect(w.vertCount).toBe(8);
      // Same slot→welded-index mapping (face topology) regardless of scale.
      expect(Array.from(w.slotToWeld)).toEqual(Array.from(ref.slotToWeld));
    }
  });

  it('welds identically when the part is offset far from the origin', () => {
    // Centred vs positive-quadrant: the bbox-min normalisation keeps grid cells
    // in range so welding is unaffected by absolute position.
    const centred = weldVertices(cubeSoup(10, -5).positions, CUBE_TRIS.length);
    const shifted = weldVertices(cubeSoup(10, 1000).positions, CUBE_TRIS.length);
    expect(centred.vertCount).toBe(8);
    expect(shifted.vertCount).toBe(8);
    expect(Array.from(shifted.slotToWeld)).toEqual(Array.from(centred.slotToWeld));
  });

  it('merges coincident vertices that differ by less than the scaled tolerance', () => {
    // Two triangles whose shared edge vertices differ by diag·1e-7 (float32-ish
    // round-off) must weld at BOTH mm and metre scale.
    for (const scale of [1, 0.001]) {
      const diag = Math.sqrt(3) * scale;
      const jitter = diag * 1e-7; // an order of magnitude below the weld grid
      const p = new Float32Array(2 * 9);
      const A: [number, number, number] = [0, 0, 0];
      const B: [number, number, number] = [scale, 0, 0];
      const C: [number, number, number] = [0, scale, 0];
      const Bj: [number, number, number] = [scale + jitter, 0, 0];
      const tri = (v: number[][], t: number) =>
        v.forEach((pt, k) => pt.forEach((c, a) => { p[t * 9 + k * 3 + a] = c; }));
      tri([A, B, C], 0);
      tri([A, Bj, C], 1); // Bj ≈ B
      const w = weldVertices(p, 2);
      // A, B(≈Bj), C → 3 welded vertices, not 4.
      expect(w.vertCount).toBe(3);
    }
  });

  it('keeps genuinely distinct vertices separate at every scale', () => {
    const w = weldVertices(cubeSoup(1000).positions, CUBE_TRIS.length);
    expect(w.vertCount).toBe(8); // never over-welds a real 1000-unit cube into fewer corners
  });
});

describe('tetMaxVolumeForTier scale invariance (issue #168)', () => {
  it('reproduces the historical fixed mm³ volumes for a typical ~120,000 mm³ part', () => {
    const refVol = 120_000; // ≈ 49 mm cube — the calibration anchor
    expect(tetMaxVolumeForTier(refVol, 'standard')).toBeCloseTo(10, 6);
    expect(tetMaxVolumeForTier(refVol, 'coarse')).toBeCloseTo(30, 6);
    expect(tetMaxVolumeForTier(refVol, 'fine')).toBeCloseTo(3, 6);
  });

  it('yields a scale-invariant element count (bboxVol / maxVol = target)', () => {
    for (const tier of ['coarse', 'standard', 'fine'] as const) {
      const counts = [1e2, 1e5, 1e8, 1e11].map(
        v => v / tetMaxVolumeForTier(v, tier),
      );
      // Every scale gives the SAME implied element count for the tier.
      for (const c of counts) expect(c).toBeCloseTo(counts[0]!, 3);
    }
  });

  it('preserves the coarse:standard:fine tier ratios (30:10:3)', () => {
    const V = 5_000;
    const coarse = tetMaxVolumeForTier(V, 'coarse');
    const standard = tetMaxVolumeForTier(V, 'standard');
    const fine = tetMaxVolumeForTier(V, 'fine');
    expect(coarse / standard).toBeCloseTo(3, 6);
    expect(standard / fine).toBeCloseTo(10 / 3, 6);
  });

  it('never returns a non-positive bound for a degenerate flat bbox', () => {
    expect(tetMaxVolumeForTier(0, 'standard')).toBeGreaterThan(0);
  });
});
