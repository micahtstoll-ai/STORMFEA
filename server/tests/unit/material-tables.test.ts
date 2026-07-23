/**
 * material-tables.test.ts
 * -----------------------
 * Key-set invariant for the material tables (issue #186).
 *
 * Three tables describe every supported material and MUST stay in sync:
 *   - MATERIALS         (analysis.ts)      — base props, the source of truth.
 *   - BOND_MATERIALS    (solver/bond.ts)   — bond physics.
 *   - DEFAULT_BEAD_PROPS (solver/laminate.ts) — CLT bead stiffness.
 *
 * A key present in one table but missing from MATERIALS is unreachable and a
 * desync hazard: a materialId matching it would draw one table's physics while
 * the others fall back to PLA. This test fails the moment they drift — e.g. it
 * failed on the orphan `pa6cf`/`petgcf` bead entries before they were removed.
 */

import { describe, it, expect } from "vitest";
import { MATERIAL_IDS, isKnownMaterial } from "../../analysis.js";
import { BOND_MATERIALS, isKnownBondMaterial } from "../../solver/bond.js";
import { DEFAULT_BEAD_PROPS } from "../../solver/laminate.js";

describe("material table key-set invariant (issue #186)", () => {
  const materials = new Set(MATERIAL_IDS);

  it("BOND_MATERIALS keys are EXACTLY the MATERIALS keys", () => {
    const bond = Object.keys(BOND_MATERIALS);
    // Same set both directions — no material without bond physics, no bond
    // physics for a material that doesn't exist.
    expect(new Set(bond)).toEqual(materials);
    for (const id of MATERIAL_IDS) expect(isKnownBondMaterial(id)).toBe(true);
  });

  it("DEFAULT_BEAD_PROPS keys are a SUBSET of MATERIALS keys (no orphans)", () => {
    for (const id of Object.keys(DEFAULT_BEAD_PROPS)) {
      expect(materials.has(id)).toBe(true);
    }
    // The removed carbon-fibre orphans must not have crept back.
    expect(DEFAULT_BEAD_PROPS).not.toHaveProperty("pa6cf");
    expect(DEFAULT_BEAD_PROPS).not.toHaveProperty("petgcf");
  });

  it("isKnownMaterial gates the supported set and rejects everything else", () => {
    expect(MATERIAL_IDS.length).toBeGreaterThan(0);
    for (const id of MATERIAL_IDS) expect(isKnownMaterial(id)).toBe(true);
    expect(isKnownMaterial("unobtainium")).toBe(false);
    expect(isKnownMaterial("pa6cf")).toBe(false);
    expect(isKnownMaterial("")).toBe(false);
  });
});
