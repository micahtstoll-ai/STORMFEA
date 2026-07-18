/**
 * in-plane-anisotropy.test.ts
 * ---------------------------
 * Locks for the opt-in in-plane raster (bead-to-bead) anisotropy on the BULK
 * term of the FDM dual criterion (feature #6). Design intent:
 *   - default OFF ⇒ exactly isotropic von Mises (bit-identical);
 *   - collapses to von Mises when the cross-bead ratio = 1 (non-binding);
 *   - only bites cross-bead loads (raster-angle dependent);
 *   - NEVER touches the interlayer interface (delamination) term, so the
 *     criterion's azimuth invariance about the weak axis is preserved.
 */

import { describe, it, expect } from "vitest";
import { fdmDualCriterionSF, type InPlaneAniso } from "../../solver/stress.js";

const Y = 50, Z = 29, ZS = Z / Math.sqrt(3);
type S6 = [number, number, number, number, number, number];
const sf = (s: S6, aniso: InPlaneAniso | null = null) =>
  fdmDualCriterionSF(s[0], s[1], s[2], s[3], s[4], s[5], Y, Z, ZS, undefined, aniso);

// A spread of in-plane and 3D states.
const states: S6[] = [
  [30, 0, 0, 0, 0, 0],     // in-plane uniaxial X
  [0, 30, 0, 0, 0, 0],     // in-plane uniaxial Y
  [20, 20, 0, 0, 0, 0],    // in-plane equibiaxial
  [0, 0, 0, 15, 0, 0],     // in-plane shear
  [25, -10, 0, 8, 0, 0],   // mixed in-plane
  [0, 0, 18, 0, 0, 0],     // pure through-layer tension (interface)
  [0, 0, 0, 0, 12, 0],     // interlayer shear
  [15, 0, 10, 0, 5, 3],    // fully 3D
];

describe("bit-identity & collapse", () => {
  it("no aniso arg reproduces the legacy SF exactly", () => {
    // The default parameter is null, so passing nothing must equal the 3-mode call.
    for (const s of states) {
      expect(sf(s, null)).toBe(fdmDualCriterionSF(s[0], s[1], s[2], s[3], s[4], s[5], Y, Z, ZS));
    }
  });

  it("crossBeadRatio = 1 is non-binding — collapses to von Mises/interface", () => {
    const iso: InPlaneAniso = { rasterAngleDeg: 0, crossBeadRatio: 1 };
    const iso45: InPlaneAniso = { rasterAngleDeg: 45, crossBeadRatio: 1 };
    for (const s of states) {
      expect(sf(s, iso)).toBeCloseTo(sf(s, null), 9);
      expect(sf(s, iso45)).toBeCloseTo(sf(s, null), 9);
    }
  });
});

describe("directional anisotropy", () => {
  it("a cross-bead tensile load is knocked down by the ratio; along-bead is not", () => {
    // Beads along X (rasterAngle 0). A pure Y tension pulls ACROSS the beads.
    const crossLoad: S6 = [0, 20, 0, 0, 0, 0];
    const alongLoad: S6 = [20, 0, 0, 0, 0, 0];
    const a: InPlaneAniso = { rasterAngleDeg: 0, crossBeadRatio: 0.5 };
    // cross-bead: SF halves (allowable halved) vs isotropic
    expect(sf(crossLoad, a)).toBeCloseTo(0.5 * sf(crossLoad, null), 6);
    // along-bead: σ_perp = 0 → cross-bead term inert → unchanged
    expect(sf(alongLoad, a)).toBeCloseTo(sf(alongLoad, null), 9);
  });

  it("rotating the raster changes which in-plane direction is weak", () => {
    const yTension: S6 = [0, 20, 0, 0, 0, 0];
    // beads along Y (rasterAngle 90) → Y is ALONG the beads → no knockdown
    expect(sf(yTension, { rasterAngleDeg: 90, crossBeadRatio: 0.5 })).toBeCloseTo(sf(yTension, null), 9);
    // beads along X (rasterAngle 0) → Y is across → knocked down
    expect(sf(yTension, { rasterAngleDeg: 0, crossBeadRatio: 0.5 })).toBeLessThan(sf(yTension, null));
  });
});

describe("interface (delamination) term is untouched", () => {
  it("pure through-layer tension SF is identical with and without aniso", () => {
    const zTension: S6 = [0, 0, 18, 0, 0, 0];
    for (const ang of [0, 30, 45, 90]) {
      expect(sf(zTension, { rasterAngleDeg: ang, crossBeadRatio: 0.4 })).toBeCloseTo(sf(zTension, null), 9);
    }
  });

  it("interlayer shear SF is identical with and without aniso", () => {
    const zShear: S6 = [0, 0, 0, 0, 12, 5];
    expect(sf(zShear, { rasterAngleDeg: 0, crossBeadRatio: 0.4 })).toBeCloseTo(sf(zShear, null), 9);
  });
});

describe("locked numeric snapshot (LOW confidence)", () => {
  it("cross-bead tension at ratio 0.7 is locked", () => {
    // σ_perp = 30 across beads, allowable 0.7·50 = 35 → SF = 35/30 ≈ 1.1667
    const s: S6 = [0, 30, 0, 0, 0, 0];
    expect(sf(s, { rasterAngleDeg: 0, crossBeadRatio: 0.7 })).toBeCloseTo(1.1667, 3);
  });
});
