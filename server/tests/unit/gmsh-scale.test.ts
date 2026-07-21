/**
 * gmsh-scale.test.ts — issue #169.
 * --------------------------------
 * Locks the SCALE-RELATIVE top/bottom face classification helper classifyFaceByZ:
 * top/bottom faces are classified against the mesh's OWN z-extent, so no absolute
 * zMin>3.5 / zMax<0.5 constants remain and origin-centred or thin parts classify
 * correctly. Pure — no Gmsh binary needed.
 */
import { describe, it, expect } from 'vitest';
import { classifyFaceByZ } from '../../gmsh_mesh.js';

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
