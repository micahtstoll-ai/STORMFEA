/**
 * tetgen-not-found.test.ts — issue #106.
 *
 * With no TetGen binary on the machine, meshWithTetGen used to burn four
 * switch-set retries (each ENOENT) and then throw "The STL may have
 * self-intersections or non-manifold edges" — blaming the user's geometry for
 * a missing install. It must instead throw TetGenNotFoundError, which names
 * the real cause, carries an install hint, and (once the probe has run)
 * fails before any welding/OFF-file work.
 *
 * These tests only run where TetGen is actually absent; on machines/CI with
 * TetGen installed the path cannot be exercised, so they self-skip (the
 * mirror image of tetgen-c3d10.test.ts, which skips when TetGen is missing).
 */

import { describe, it, expect } from "vitest";
import { meshWithTetGen, probeTetGen, TetGenNotFoundError } from "../../tetgen.js";

// One degenerate triangle — never reaches TetGen when the binary is missing.
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

describe("TetGen missing-binary path (issue #106)", () => {
  it("throws TetGenNotFoundError with the real cause, not a geometry error", async () => {
    const probe = await probeTetGen();
    if (probe.found) return; // TetGen installed here — path not exercisable, skip

    let caught: unknown;
    try {
      await meshWithTetGen(positions, 1, 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TetGenNotFoundError);
    const err = caught as TetGenNotFoundError;
    expect(err.message).toContain("TetGen not found");
    expect(err.message).not.toContain("self-intersections");
    expect(err.hint).toContain("Install TetGen");
  });

  it("fails fast after the probe — no OFF write, no four-switch retry loop", async () => {
    const probe = await probeTetGen();
    if (probe.found) return; // skip where TetGen exists

    const t0 = Date.now();
    await expect(meshWithTetGen(positions, 1, 2)).rejects.toBeInstanceOf(TetGenNotFoundError);
    // Known-missing short-circuit runs before any file I/O or spawning; even
    // a generous bound proves the retry loop (4 × spawn attempts) was skipped.
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
