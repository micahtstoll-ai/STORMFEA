/**
 * merged-holes.test.ts
 * --------------------
 * flagMergedHoleWarnings flags physically-overlapping hole detections (the
 * symptom of Gmsh merging two closely-spaced hole surfaces into one inflated
 * radius) and leaves well-separated holes alone.
 */

import { describe, it, expect } from "vitest";
import { flagMergedHoleWarnings } from "../../holes.js";

describe("flagMergedHoleWarnings", () => {
  it("does not flag well-separated holes", () => {
    const holes = [
      { id: 0, centre: [0, 0, 0] as const, radius: 1.5 },
      { id: 1, centre: [10, 0, 0] as const, radius: 1.5 },
    ];
    expect(flagMergedHoleWarnings(holes)).toEqual([null, null]);
  });

  it("flags both holes when their detected circles overlap", () => {
    const holes = [
      { id: 0, centre: [0, 0, 0] as const, radius: 2.0 },
      { id: 1, centre: [3, 0, 0] as const, radius: 2.0 }, // gap 3 < r+r = 4
    ];
    const w = flagMergedHoleWarnings(holes);
    expect(w[0]).toBeTruthy();
    expect(w[1]).toBeTruthy();
    expect(w[0]).toContain("hole 1");
    expect(w[1]).toContain("hole 0");
  });

  it("does not flag exactly-tangent holes (touching but not overlapping)", () => {
    const holes = [
      { id: 0, centre: [0, 0, 0] as const, radius: 1.5 },
      { id: 1, centre: [3, 0, 0] as const, radius: 1.5 }, // gap 3 == r+r
    ];
    expect(flagMergedHoleWarnings(holes)).toEqual([null, null]);
  });

  it("uses array index when no id is provided", () => {
    const holes = [
      { centre: [0, 0, 0] as const, radius: 2 },
      { centre: [1, 0, 0] as const, radius: 2 },
    ];
    const w = flagMergedHoleWarnings(holes);
    expect(w[0]).toContain("hole 1");
    expect(w[1]).toContain("hole 0");
  });
});
