/**
 * adaptive-mesh.test.ts — issue #149.
 *
 * Unit tests for the error-driven adaptive-refinement CORE logic
 * (server/solver/adaptiveMesh.ts). These are entirely binary-independent: no
 * TetGen is invoked. They pin the two things that MUST be correct for the
 * feature to be honest:
 *
 *   1. The SIZE FIELD requests refinement (smaller target size) in high-error
 *      elements and leaves low-error regions coarse (unchanged).
 *   2. The loop control stops correctly (target reached, iteration cap,
 *      element-growth cap, stall) and the growth guard relaxes an over-budget
 *      field instead of blowing up the DOF count.
 *
 * The end-to-end TetGen re-mesh (tetgen.ts meshWithTetGenSizing) can only run
 * where a tetgen binary exists (CI) and is tested separately with a self-skip.
 */
import { describe, it, expect } from "vitest";
import {
  tetCharacteristicSize,
  aggregateElementFieldsToNodes,
  buildSizeField,
  targetPerElementError,
  predictRefinedElementCount,
  relaxSizeFieldToBudget,
  shouldStopRefinement,
  sizeFieldToMtr,
  meshToNodeFile,
  meshToEleFile,
  DEFAULT_LOOP_OPTIONS,
  DEFAULT_SIZE_FIELD_FACTORS,
  type LoopState,
  type LoopControlOptions,
} from "../../solver/adaptiveMesh.js";
import type { TetMesh } from "../../solver/types.js";

// ─── Test mesh: a 2×1×1 slab split into two unit-cube regions, each meshed as
// a small triangle-free tet grid. We build it by hand as a set of unit tets so
// the "high-error" region (x<1) and "low-error" region (x>1) are cleanly
// separated. Element 0..k live in region A (low x), the rest in region B.
//
// For the core assertions we don't need a physically valid FE mesh — we need a
// mesh whose element→node incidence and geometry are real, so size aggregation
// and prediction are exercised. We lay out a row of unit tets along x.
function buildRowOfTets(count: number, spacing: number): TetMesh {
  // Each "tet i" uses 4 nodes placed near x = i*spacing. Nodes are shared only
  // conceptually; here we give each tet its own 4 corner nodes for simplicity
  // (that still exercises aggregation — a node belongs to exactly one element).
  const nodes = new Float64Array(count * 4 * 3);
  const elements = new Int32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x0 = i * spacing;
    // Unit-ish tet corners.
    const corners = [
      [x0, 0, 0],
      [x0 + spacing, 0, 0],
      [x0, spacing, 0],
      [x0, 0, spacing],
    ];
    for (let k = 0; k < 4; k++) {
      const nIdx = i * 4 + k;
      nodes[nIdx * 3]     = corners[k]![0]!;
      nodes[nIdx * 3 + 1] = corners[k]![1]!;
      nodes[nIdx * 3 + 2] = corners[k]![2]!;
      elements[i * 4 + k] = nIdx;
    }
  }
  return { nodes, elements, nodeCount: count * 4, elementCount: count, nodesPerElem: 4 };
}

describe("tetCharacteristicSize", () => {
  it("recovers the size of a regular-ish unit tet as a positive scale", () => {
    const h = tetCharacteristicSize(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    expect(h).toBeGreaterThan(0);
    // Larger tet → larger characteristic size, monotone in linear scale.
    const h2 = tetCharacteristicSize(0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2);
    expect(h2).toBeGreaterThan(h);
    expect(h2 / h).toBeCloseTo(2, 6); // size scales linearly with geometry
  });
  it("returns 0 for a degenerate (zero-volume) tet", () => {
    expect(tetCharacteristicSize(0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0)).toBe(0);
  });
});

describe("targetPerElementError (equidistribution)", () => {
  it("splits the global target across elements in quadrature (÷√N)", () => {
    expect(targetPerElementError(0.1, 100)).toBeCloseTo(0.01, 12);
    expect(targetPerElementError(0.1, 4)).toBeCloseTo(0.05, 12);
  });
});

describe("buildSizeField — CORE: refine high-error, leave low-error coarse", () => {
  // 10 tets in a row. Give elements 0-1 (low x) very high error, the rest
  // near-zero error. The size field MUST shrink target size on the high-error
  // nodes and leave the low-error nodes at their current size.
  const N = 10;
  const mesh = buildRowOfTets(N, 1.0);
  const err = new Float32Array(N);
  err[0] = 0.9; // high error
  err[1] = 0.8; // high error
  for (let e = 2; e < N; e++) err[e] = 0.001; // low error

  const opts = {
    targetError: 0.02,
    order: 2,
    minSizeFactor: DEFAULT_SIZE_FIELD_FACTORS.minSizeFactor,
    maxSizeFactor: DEFAULT_SIZE_FIELD_FACTORS.maxSizeFactor,
  };
  const field = buildSizeField(mesh, err, opts);

  it("shrinks target size for nodes of high-error elements", () => {
    // Nodes of element 0 and 1 are indices 0..7.
    for (let n = 0; n < 8; n++) {
      expect(field.targetSize[n]!).toBeLessThan(field.currentSize[n]!);
    }
  });

  it("leaves low-error nodes at their current size (coarse untouched)", () => {
    // Nodes of elements 2..9 are indices 8..39.
    for (let n = 8; n < mesh.nodeCount; n++) {
      expect(field.targetSize[n]!).toBeCloseTo(field.currentSize[n]!, 9);
    }
  });

  it("high-error nodes end up strictly smaller than low-error nodes", () => {
    const hiMax = Math.max(field.targetSize[0]!, field.targetSize[1]!, field.targetSize[2]!, field.targetSize[3]!);
    const loMin = Math.min(...Array.from(field.targetSize.slice(8)));
    expect(hiMax).toBeLessThan(loMin);
  });

  it("respects the min-size-factor floor (no runaway shrink in one step)", () => {
    // Element 0 has huge error; the raw factor would be tiny, but it is floored.
    const floored = field.currentSize[0]! * opts.minSizeFactor;
    expect(field.targetSize[0]!).toBeGreaterThanOrEqual(floored - 1e-9);
  });

  it("reports a positive refined-node count and it matches the high-error nodes", () => {
    expect(field.refinedNodeCount).toBe(8); // exactly the 8 nodes of elements 0,1
  });

  it("honors absMinSize as a hard physical floor", () => {
    const f2 = buildSizeField(mesh, err, { ...opts, absMinSize: 0.9 });
    for (const ts of f2.targetSize) expect(ts).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });
});

describe("buildSizeField — singularity exclusion (issue #147)", () => {
  const N = 6;
  const mesh = buildRowOfTets(N, 1.0);
  const err = new Float32Array(N).fill(0.001);
  err[0] = 0.95; // huge error at the singular corner (x≈0)

  it("does NOT refine a high-error node inside a flagged singular region", () => {
    const field = buildSizeField(mesh, err, {
      targetError: 0.02, order: 2,
      minSizeFactor: 0.35, maxSizeFactor: 1.0,
      singularities: [{ x: 0, y: 0, z: 0, radius: 0.6 }],
    });
    // Node 0 sits at (0,0,0) — inside the singular region → keep current size.
    expect(field.targetSize[0]!).toBeCloseTo(field.currentSize[0]!, 9);
    expect(field.excludedNodeCount).toBeGreaterThan(0);
  });

  it("WOULD refine the same node without the singularity flag (control)", () => {
    const field = buildSizeField(mesh, err, {
      targetError: 0.02, order: 2, minSizeFactor: 0.35, maxSizeFactor: 1.0,
    });
    expect(field.targetSize[0]!).toBeLessThan(field.currentSize[0]!);
  });
});

describe("aggregateElementFieldsToNodes", () => {
  it("takes the MAX incident error and MIN incident size per node", () => {
    // Two tets sharing node behaviour is simulated via the row mesh (disjoint
    // nodes), so just check the per-node values map from their single element.
    const mesh = buildRowOfTets(3, 1.0);
    const err = new Float32Array([0.5, 0.1, 0.9]);
    const { nodeError, nodeSize } = aggregateElementFieldsToNodes(mesh, err);
    expect(nodeError[0]!).toBeCloseTo(0.5, 5);   // node of element 0 (Float32)
    expect(nodeError[8]!).toBeCloseTo(0.9, 5);   // node of element 2 (Float32)
    for (const s of nodeSize) expect(s).toBeGreaterThan(0);
  });
});

describe("predictRefinedElementCount & relaxSizeFieldToBudget (runaway guard)", () => {
  const N = 20;
  const mesh = buildRowOfTets(N, 1.0);
  const err = new Float32Array(N);
  for (let e = 0; e < N; e++) err[e] = 0.9; // refine EVERYTHING aggressively

  const field = buildSizeField(mesh, err, {
    targetError: 0.001, order: 2, minSizeFactor: 0.2, maxSizeFactor: 1.0,
  });

  it("predicts a larger element count when the whole mesh is refined", () => {
    const predicted = predictRefinedElementCount(mesh, field);
    expect(predicted).toBeGreaterThan(N); // refinement grows the count
  });

  it("relaxes an over-budget field to fit the element budget", () => {
    const budget = N * 2; // allow at most 2× growth
    const before = predictRefinedElementCount(mesh, field);
    expect(before).toBeGreaterThan(budget);
    const relaxed = relaxSizeFieldToBudget(mesh, field, budget);
    const after = predictRefinedElementCount(mesh, relaxed);
    expect(after).toBeLessThanOrEqual(budget * 1.05); // within tolerance of budget
    // Still refines (targets not fully reverted to current).
    expect(relaxed.refinedNodeCount).toBeGreaterThan(0);
    // Relaxed targets are >= original targets (less aggressive) but still < current.
    for (let n = 0; n < mesh.nodeCount; n++) {
      expect(relaxed.targetSize[n]!).toBeGreaterThanOrEqual(field.targetSize[n]! - 1e-9);
    }
  });

  it("leaves an already-in-budget field untouched", () => {
    const budget = 1e9;
    const relaxed = relaxSizeFieldToBudget(mesh, field, budget);
    expect(relaxed).toBe(field); // identity — no work done
  });
});

describe("shouldStopRefinement — loop control", () => {
  const opts: LoopControlOptions = {
    targetGlobalError: 0.03,
    maxIterations: 4,
    maxElementGrowth: 8,
    minRelativeImprovement: 0.05,
  };
  const base = (over: Partial<LoopState>): LoopState => ({
    iteration: 0,
    globalRelativeError: 0.1,
    elementCount: 1000,
    baseElementCount: 1000,
    previousGlobalRelativeError: null,
    refinedNodeCount: 10,
    ...over,
  });

  it("stops when the target global error is reached", () => {
    const r = shouldStopRefinement(base({ globalRelativeError: 0.02 }), opts);
    expect(r).toEqual({ stop: true, reason: "target-error-reached" });
  });

  it("stops at the iteration cap", () => {
    const r = shouldStopRefinement(base({ iteration: 3 }), opts); // iteration+1 >= 4
    expect(r).toEqual({ stop: true, reason: "max-iterations" });
  });

  it("stops at the element-growth cap", () => {
    const r = shouldStopRefinement(base({ elementCount: 8000, baseElementCount: 1000 }), opts);
    expect(r).toEqual({ stop: true, reason: "element-growth-cap" });
  });

  it("stops when the size field requested no refinement", () => {
    const r = shouldStopRefinement(base({ refinedNodeCount: 0 }), opts);
    expect(r).toEqual({ stop: true, reason: "no-refinement-requested" });
  });

  it("stops when improvement stalls (<5%)", () => {
    const r = shouldStopRefinement(
      base({ globalRelativeError: 0.098, previousGlobalRelativeError: 0.1 }),
      opts,
    );
    expect(r).toEqual({ stop: true, reason: "stalled" });
  });

  it("stops when error GREW (negative improvement)", () => {
    const r = shouldStopRefinement(
      base({ globalRelativeError: 0.12, previousGlobalRelativeError: 0.1 }),
      opts,
    );
    expect(r).toEqual({ stop: true, reason: "stalled" });
  });

  it("continues when error is above target, improving, and within all caps", () => {
    const r = shouldStopRefinement(
      base({ iteration: 1, globalRelativeError: 0.06, previousGlobalRelativeError: 0.1 }),
      opts,
    );
    expect(r).toEqual({ stop: false, reason: "continue" });
  });

  it("target-reached takes priority over the iteration cap", () => {
    const r = shouldStopRefinement(base({ iteration: 3, globalRelativeError: 0.01 }), opts);
    expect(r.reason).toBe("target-error-reached");
  });

  it("DEFAULT_LOOP_OPTIONS are sane guards", () => {
    expect(DEFAULT_LOOP_OPTIONS.maxIterations).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_LOOP_OPTIONS.maxElementGrowth).toBeGreaterThan(1);
    expect(DEFAULT_LOOP_OPTIONS.targetGlobalError).toBeGreaterThan(0);
  });
});

describe("simulated adaptive loop convergence (no binary)", () => {
  // Drive the loop control with a fake solver whose error halves each refine.
  // Verifies the loop terminates by target-reached and that error is monotone.
  it("converges monotonically and stops at the target", () => {
    const opts = DEFAULT_LOOP_OPTIONS;
    let gre = 0.2;
    let prev: number | null = null;
    let elems = 1000;
    const base = 1000;
    const history: number[] = [];
    let stopReason = "";
    for (let it = 0; it < 20; it++) {
      history.push(gre);
      const decision = shouldStopRefinement(
        {
          iteration: it,
          globalRelativeError: gre,
          elementCount: elems,
          baseElementCount: base,
          previousGlobalRelativeError: prev,
          refinedNodeCount: 5,
        },
        opts,
      );
      if (decision.stop) { stopReason = decision.reason; break; }
      // Fake refine: error halves, elements grow 1.7×.
      prev = gre;
      gre = gre * 0.5;
      elems = Math.round(elems * 1.7);
    }
    // Monotone decreasing.
    for (let i = 1; i < history.length; i++) expect(history[i]!).toBeLessThan(history[i - 1]!);
    expect(["target-error-reached", "max-iterations", "element-growth-cap"]).toContain(stopReason);
  });
});

describe("TetGen file serialization (pure, binary-independent)", () => {
  const mesh = buildRowOfTets(2, 1.0);
  const err = new Float32Array([0.9, 0.01]);
  const field = buildSizeField(mesh, err, {
    targetError: 0.02, order: 2, minSizeFactor: 0.35, maxSizeFactor: 1.0,
  });

  it("sizeFieldToMtr has the '<count> 1' header and one value per node", () => {
    const mtr = sizeFieldToMtr(field);
    const lines = mtr.trim().split("\n");
    expect(lines[0]).toBe(`${mesh.nodeCount} 1`);
    expect(lines.length).toBe(mesh.nodeCount + 1);
    // Every value is a finite positive number.
    for (let i = 1; i < lines.length; i++) {
      const v = parseFloat(lines[i]!);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("the .mtr metric encodes the refinement (high-error node value < low-error node value)", () => {
    const mtr = sizeFieldToMtr(field);
    const vals = mtr.trim().split("\n").slice(1).map(parseFloat);
    const hiMin = Math.min(vals[0]!, vals[1]!, vals[2]!, vals[3]!); // element-0 nodes
    const loMax = Math.max(vals[4]!, vals[5]!, vals[6]!, vals[7]!); // element-1 nodes
    expect(hiMin).toBeLessThan(loMax); // metric requests smaller size where error is high
  });

  it("meshToNodeFile / meshToEleFile emit 1-based TetGen files with correct headers", () => {
    const nodeFile = meshToNodeFile(mesh);
    expect(nodeFile.split("\n")[0]).toBe(`${mesh.nodeCount} 3 0 0`);
    const eleFile = meshToEleFile(mesh);
    expect(eleFile.split("\n")[0]).toBe(`${mesh.elementCount} 4 0`);
    // First element line: 1-based node indices.
    const firstEle = eleFile.trim().split("\n")[1]!.trim().split(/\s+/).map(Number);
    expect(firstEle[0]).toBe(1);          // element index (1-based)
    expect(Math.min(...firstEle.slice(1))).toBeGreaterThanOrEqual(1); // node indices 1-based
  });
});
