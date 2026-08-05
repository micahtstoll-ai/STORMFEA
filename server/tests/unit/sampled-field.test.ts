/**
 * sampled-field.test.ts
 * ---------------------
 * Issue #263 (systemic half). Two point sets are in play across analysis.ts and
 * they are not interchangeable: the DISPLAY mesh (`req.positions`, 3 vertices
 * per surface triangle, indexed by `vertexStress`) and the FEA mesh
 * (`mesh.nodes`, indexed by `nodeStress`).
 *
 * Pairing a field from one with coordinates from the other is SILENT — the
 * index stays in range and points at an unrelated location. It happened four
 * times: the adaptive loop's refinement-exclusion ball (#257), `peakVertexIdx`
 * (#263), the singularity detector's internals, and generateTopologySuggestions,
 * which read `mesh.nodes` at display-vertex indices and therefore placed design
 * markers at unrelated coordinates. Three of the four were found by accident.
 *
 * `sampledField` carries the two together and checks the length invariant once,
 * turning the whole class from a wrong answer into a loud failure.
 */

import { describe, it, expect } from "vitest";
import { sampledField } from "../../analysis.js";

describe("sampledField pairs a field with its own coordinates (issue #263)", () => {
  it("accepts a correctly paired field", () => {
    const values = new Float32Array([1, 2, 3]);
    const coords = new Float64Array(9);
    const f = sampledField("display", values, coords);
    expect(f.count).toBe(3);
    expect(f.space).toBe("display");
    expect(f.values).toBe(values);
    expect(f.coords).toBe(coords);
  });

  it("REJECTS a display field paired with FEA coordinates — the real bug", () => {
    // 256 display vertices against a 5 000-node FEA mesh: in range for every
    // index, so the old loose-parameter form read node 0..255's coordinates and
    // reported them as the location of display vertex 0..255's stress.
    const displayStress = new Float32Array(256);
    const feaNodes = new Float64Array(5000 * 3);
    expect(() => sampledField("display", displayStress, feaNodes)).toThrow(/wrong point set/i);
  });

  it("REJECTS the reverse pairing too", () => {
    const nodeStress = new Float64Array(5000);
    const displayPositions = new Float32Array(256 * 3);
    expect(() => sampledField("fea", nodeStress, displayPositions)).toThrow(/wrong point set/i);
  });

  it("names both counts so the mismatch is diagnosable from the message", () => {
    try {
      sampledField("display", new Float32Array(4), new Float64Array(30));
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = String((e as Error).message);
      expect(msg).toContain("4 values");
      expect(msg).toContain("30 coordinate");
      expect(msg).toContain("12");  // what was expected
      expect(msg).toContain("display");
    }
  });

  it("accepts an empty field", () => {
    // Degenerate but valid — a part with no surface triangles yet.
    expect(() => sampledField("fea", new Float64Array(0), new Float64Array(0))).not.toThrow();
  });

  it("rejects a coords array that is merely LONGER than needed", () => {
    // The failure mode is always "more coordinates than values", so a
    // greater-than-or-equal check would have let every real instance through.
    expect(() => sampledField("fea", new Float64Array(10), new Float64Array(33))).toThrow();
  });
});
