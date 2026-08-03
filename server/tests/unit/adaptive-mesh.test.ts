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
  smoothSizeFieldGradation,
  buildTetEdgeList,
  extractCornerBackground,
  judgeRemeshAgainstBudget,
  effectiveElementBudget,
  sizeFieldToVolFile,
  meshToNodeFile,
  meshToEleFile,
  VOLUME_CAP_SCALE,
  DEFAULT_LOOP_OPTIONS,
  DEFAULT_SIZE_FIELD_FACTORS,
  type LoopState,
  type LoopControlOptions,
  type SizeField,
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

// A CONNECTED mesh, which buildRowOfTets deliberately is not: `count` unit cubes
// stacked along x, each split into 6 tets by Kuhn's subdivision (all sharing the
// cube's main diagonal, all of volume s³/6). Adjacent cubes share a face, so the
// edge graph is connected — which is what the gradation tests need, since a
// Lipschitz constraint can only propagate along edges.
function buildTetGrid(count: number, s: number): TetMesh {
  const nodeAt = (i: number, j: number, k: number) => i * 4 + j * 2 + k;
  const nodeCount = (count + 1) * 4;
  const nodes = new Float64Array(nodeCount * 3);
  for (let i = 0; i <= count; i++) {
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) {
        const n = nodeAt(i, j, k);
        nodes[n * 3] = i * s; nodes[n * 3 + 1] = j * s; nodes[n * 3 + 2] = k * s;
      }
    }
  }
  // Kuhn decomposition of a cube into 6 tets, as (j,k) offsets from corner i.
  const KUHN: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1]],
  ];
  const elements = new Int32Array(count * 6 * 4);
  let e = 0;
  for (let i = 0; i < count; i++) {
    for (const tet of KUHN) {
      for (let k = 0; k < 4; k++) {
        const [di, dj, dk] = tet[k]!;
        elements[e * 4 + k] = nodeAt(i + di, dj, dk);
      }
      e++;
    }
  }
  return { nodes, elements, nodeCount, elementCount: count * 6, nodesPerElem: 4 };
}

/** A size field with an explicit per-node target, for operator-level tests. */
function fieldFrom(current: Float64Array, target: Float64Array): SizeField {
  let refined = 0, min = Infinity, max = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i]! < current[i]! * 0.99) refined++;
    if (target[i]! < min) min = target[i]!;
    if (target[i]! > max) max = target[i]!;
  }
  return {
    targetSize: target, currentSize: current,
    refinedNodeCount: refined, excludedNodeCount: 0,
    minTargetSize: Number.isFinite(min) ? min : 0, maxTargetSize: max,
  };
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

describe("buildTetEdgeList", () => {
  const mesh = buildTetGrid(3, 1.0);

  it("emits unique, non-degenerate edges with positive lengths", () => {
    const edges = buildTetEdgeList(mesh);
    expect(edges.a.length).toBeGreaterThan(0);
    expect(edges.b.length).toBe(edges.a.length);
    expect(edges.len.length).toBe(edges.a.length);
    const seen = new Set<string>();
    for (let k = 0; k < edges.a.length; k++) {
      const i = edges.a[k]!, j = edges.b[k]!;
      expect(i).not.toBe(j);
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      expect(seen.has(key)).toBe(false); // deduplicated
      seen.add(key);
      expect(edges.len[k]!).toBeGreaterThan(0);
      expect(edges.len[k]!).toBeCloseTo(
        Math.hypot(
          mesh.nodes[i * 3]! - mesh.nodes[j * 3]!,
          mesh.nodes[i * 3 + 1]! - mesh.nodes[j * 3 + 1]!,
          mesh.nodes[i * 3 + 2]! - mesh.nodes[j * 3 + 2]!,
        ), 12);
    }
  });

  it("connects the mesh — adjacent cubes share edges", () => {
    // The whole point of this fixture: a Lipschitz constraint can only travel
    // along edges, so a disconnected fixture would make the gradation tests
    // vacuous.
    const edges = buildTetEdgeList(mesh);
    const adj = new Map<number, Set<number>>();
    for (let k = 0; k < edges.a.length; k++) {
      if (!adj.has(edges.a[k]!)) adj.set(edges.a[k]!, new Set());
      if (!adj.has(edges.b[k]!)) adj.set(edges.b[k]!, new Set());
      adj.get(edges.a[k]!)!.add(edges.b[k]!);
      adj.get(edges.b[k]!)!.add(edges.a[k]!);
    }
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    expect(seen.size).toBe(mesh.nodeCount);
  });
});

describe("smoothSizeFieldGradation — bounded size transition", () => {
  const mesh = buildTetGrid(6, 1.0);
  const G = DEFAULT_SIZE_FIELD_FACTORS.gradation;
  const current = new Float64Array(mesh.nodeCount).fill(1.0);

  it("is a NO-OP on a field that requests no refinement", () => {
    // The property that keeps it composable with the budget guard. An already
    // adaptively-refined mesh has a real size gradient of its own; re-grading
    // THAT would demand refinement the error estimator never asked for, and
    // measured on a real part it consumed the entire remaining element budget.
    const target = Float64Array.from(current);
    const out = smoothSizeFieldGradation(mesh, fieldFrom(current, target), G);
    for (let n = 0; n < mesh.nodeCount; n++) expect(out.targetSize[n]!).toBeCloseTo(current[n]!, 12);
    expect(out.refinedNodeCount).toBe(0);
  });

  it("satisfies the Lipschitz bound h_i <= h_j + (gradation-1)*d on every edge", () => {
    const target = Float64Array.from(current);
    target[0] = 0.2;                       // one hard-refined node at the x=0 end
    const out = smoothSizeFieldGradation(mesh, fieldFrom(current, target), G);
    const edges = buildTetEdgeList(mesh);
    const beta = G - 1;
    for (let k = 0; k < edges.a.length; k++) {
      const i = edges.a[k]!, j = edges.b[k]!, d = edges.len[k]!;
      const hi = out.targetSize[i]!, hj = out.targetSize[j]!;
      expect(Math.abs(hi - hj)).toBeLessThanOrEqual(beta * d + 1e-9);
    }
  });

  it("spreads refinement outward — a neighbour of the refined node is pulled down", () => {
    const target = Float64Array.from(current);
    target[0] = 0.2;
    const out = smoothSizeFieldGradation(mesh, fieldFrom(current, target), G);
    // Node 4 is the next cube corner along x, one unit edge away from node 0.
    expect(out.targetSize[4]!).toBeLessThan(current[4]!);
    expect(out.refinedNodeCount).toBeGreaterThan(1);
  });

  it("only ever LOWERS targets, and never below the field's own minimum", () => {
    const target = Float64Array.from(current);
    target[0] = 0.2;
    const input = fieldFrom(current, target);
    const out = smoothSizeFieldGradation(mesh, input, G);
    for (let n = 0; n < mesh.nodeCount; n++) {
      expect(out.targetSize[n]!).toBeLessThanOrEqual(input.targetSize[n]! + 1e-12);
      expect(out.targetSize[n]!).toBeGreaterThanOrEqual(input.minTargetSize - 1e-12);
    }
  });

  it("treats gradation <= 1 as 'no limit' and returns the field untouched", () => {
    const target = Float64Array.from(current);
    target[0] = 0.2;
    const input = fieldFrom(current, target);
    expect(smoothSizeFieldGradation(mesh, input, 1)).toBe(input);
    expect(smoothSizeFieldGradation(mesh, input, 0.5)).toBe(input);
  });
});

describe("predictRefinedElementCount — calibration against 'no refinement'", () => {
  it("predicts EXACTLY the current element count for an unrefined field", () => {
    // The property the budget bisection rests on. It used to mix a MEAN current
    // size with a MIN target size, so even a field requesting nothing predicted
    // more elements than the mesh already had — a floor that let the bisection
    // bottom out over budget and spin the driver's re-mesh retries.
    const mesh = buildTetGrid(4, 1.0);
    const current = new Float64Array(mesh.nodeCount).fill(0.7);
    const field = fieldFrom(current, Float64Array.from(current));
    expect(predictRefinedElementCount(mesh, field)).toBeCloseTo(mesh.elementCount, 9);
  });

  it("scales as the cube of the size ratio where the field refines", () => {
    const mesh = buildTetGrid(1, 1.0);          // 6 tets, all nodes shared
    const current = new Float64Array(mesh.nodeCount).fill(1.0);
    const target  = new Float64Array(mesh.nodeCount).fill(0.5);
    expect(predictRefinedElementCount(mesh, fieldFrom(current, target)))
      .toBeCloseTo(mesh.elementCount * 8, 6);  // (1/0.5)^3
  });
});

describe("judgeRemeshAgainstBudget & effectiveElementBudget (reality check)", () => {
  it("accepts a mesh inside the budget and rejects one outside it", () => {
    expect(judgeRemeshAgainstBudget(90_000, 90_000, 106_720, 13_340).accepted).toBe(true);
    expect(judgeRemeshAgainstBudget(115_544, 106_000, 106_720, 13_340).accepted).toBe(false);
  });

  it("measures the bias on GROWTH, not on totals", () => {
    // The observed first refinement: 13,340 → 76,651 actual against a 43,829
    // prediction. On growth that is 63,311/30,489 = 2.08; on totals it would be
    // 76,651/43,829 = 1.75, and dividing the budget by THAT drove the next
    // iteration's effective budget below the current element count — which reads
    // as "no refinement is possible" and stalled the loop a step early.
    const v = judgeRemeshAgainstBudget(76_651, 43_829, 106_720, 13_340);
    expect(v.sizingBias).toBeCloseTo((76_651 - 13_340) / (43_829 - 13_340), 6);
    expect(effectiveElementBudget(106_720, 76_651, v.sizingBias)).toBeGreaterThan(76_651);
  });

  it("never reports a bias below 1 — the guard tightens, it never loosens", () => {
    // An over-prediction is not licence to refine harder than the field asked.
    expect(judgeRemeshAgainstBudget(20_000, 40_000, 106_720, 13_340).sizingBias).toBe(1);
    expect(effectiveElementBudget(106_720, 13_340, 0.2)).toBe(106_720);
  });

  it("round-trips: a budget corrected by the bias lands back on the budget", () => {
    // If the mesher delivers `bias ×` the predicted growth, then predicting up to
    // effectiveElementBudget must yield at most elementBudget elements.
    const budget = 106_720, current = 40_534, bias = 2.5;
    const eff = effectiveElementBudget(budget, current, bias);
    const deliveredIfPredictionMaxedOut = current + (eff - current) * bias;
    expect(deliveredIfPredictionMaxedOut).toBeLessThanOrEqual(budget + 1);
  });

  it("leaves no room when the mesh has already reached the budget", () => {
    expect(effectiveElementBudget(106_720, 106_720, 3)).toBe(106_720);
    expect(effectiveElementBudget(106_720, 120_000, 3)).toBe(120_000);
  });
});

describe("relaxSizeFieldToBudget — gradation-aware budgeting", () => {
  const mesh = buildTetGrid(8, 1.0);
  const current = new Float64Array(mesh.nodeCount).fill(1.0);
  const target = new Float64Array(mesh.nodeCount).fill(1.0);
  for (let n = 0; n < 8; n++) target[n] = 0.25;   // refine the x=0 end hard
  const field = fieldFrom(current, target);
  const G = DEFAULT_SIZE_FIELD_FACTORS.gradation;

  it("counts the graded transition band INSIDE the budget", () => {
    // Smoothing costs elements. If the budget were evaluated on the raw field
    // and the smoothing applied afterwards, the band would be spent on top of
    // the budget rather than within it.
    const budget = Math.floor(mesh.elementCount * 3);
    const relaxed = relaxSizeFieldToBudget(mesh, field, budget, G);
    expect(predictRefinedElementCount(mesh, relaxed)).toBeLessThanOrEqual(budget * 1.02);
  });

  it("returns a field requesting NO refinement when the budget has no room", () => {
    // Signals the driver to stop instead of paying for a re-mesh that cannot help.
    const relaxed = relaxSizeFieldToBudget(mesh, field, mesh.elementCount, G);
    expect(relaxed.refinedNodeCount).toBe(0);
  });

  it("still refines when there IS room", () => {
    const relaxed = relaxSizeFieldToBudget(mesh, field, mesh.elementCount * 4, G);
    expect(relaxed.refinedNodeCount).toBeGreaterThan(0);
  });
});

describe("extractCornerBackground — corner-only, order-preserving", () => {
  // A synthetic C3D10: the linear grid plus fake midside nodes appended after
  // the corners, exactly as TetGen's -o2 output is laid out.
  const lin = buildTetGrid(2, 1.0);
  function asC3D10(m: TetMesh): TetMesh {
    const extra = m.elementCount * 6;
    const nodes = new Float64Array((m.nodeCount + extra) * 3);
    nodes.set(m.nodes);
    const elements = new Int32Array(m.elementCount * 10);
    for (let e = 0; e < m.elementCount; e++) {
      for (let k = 0; k < 4; k++) elements[e * 10 + k] = m.elements[e * 4 + k]!;
      for (let k = 0; k < 6; k++) {
        const mid = m.nodeCount + e * 6 + k;
        elements[e * 10 + 4 + k] = mid;
        nodes[mid * 3] = 0.5; nodes[mid * 3 + 1] = 0.5; nodes[mid * 3 + 2] = 0.5;
      }
    }
    return { nodes, elements, nodeCount: m.nodeCount + extra, elementCount: m.elementCount, nodesPerElem: 10 };
  }
  const quad = asC3D10(lin);

  it("drops the midside nodes that never received a real target size", () => {
    const current = new Float64Array(quad.nodeCount).fill(1.0);
    const target  = new Float64Array(quad.nodeCount).fill(0.4375); // the placeholder
    for (let n = 0; n < lin.nodeCount; n++) target[n] = 0.3;       // the real field
    const bg = extractCornerBackground(quad, fieldFrom(current, target));
    expect(bg.mesh.nodeCount).toBe(lin.nodeCount);
    expect(bg.mesh.nodesPerElem).toBe(4);
    expect(bg.mesh.elementCount).toBe(quad.elementCount);
    for (const ts of bg.field.targetSize) expect(ts).toBeCloseTo(0.3, 12);
  });

  it("preserves node ORDER — the STL surface vertices stay first", () => {
    // TetGen's -r emits its input vertices first and in order, which is what
    // makes surfaceToNode an identity map through a re-mesh. Renumbering in
    // first-seen-in-elements order would silently break that.
    const current = new Float64Array(quad.nodeCount).fill(1.0);
    const bg = extractCornerBackground(quad, fieldFrom(current, Float64Array.from(current)));
    for (let n = 0; n < lin.nodeCount; n++) {
      expect(bg.mesh.nodes[n * 3]!).toBeCloseTo(lin.nodes[n * 3]!, 12);
      expect(bg.mesh.nodes[n * 3 + 1]!).toBeCloseTo(lin.nodes[n * 3 + 1]!, 12);
      expect(bg.mesh.nodes[n * 3 + 2]!).toBeCloseTo(lin.nodes[n * 3 + 2]!, 12);
    }
  });

  it("remaps element connectivity to the compacted indices", () => {
    const current = new Float64Array(quad.nodeCount).fill(1.0);
    const bg = extractCornerBackground(quad, fieldFrom(current, Float64Array.from(current)));
    for (let e = 0; e < bg.mesh.elementCount; e++) {
      for (let k = 0; k < 4; k++) {
        expect(bg.mesh.elements[e * 4 + k]!).toBe(lin.elements[e * 4 + k]!);
      }
    }
  });

  it("is an identity on a linear mesh whose nodes are all used", () => {
    const current = new Float64Array(lin.nodeCount).fill(1.0);
    const bg = extractCornerBackground(lin, fieldFrom(current, Float64Array.from(current)));
    expect(bg.mesh.nodeCount).toBe(lin.nodeCount);
    expect(Array.from(bg.mesh.elements)).toEqual(Array.from(lin.elements));
  });
});

describe("sizeFieldToVolFile — per-element volume constraints", () => {
  const mesh = buildTetGrid(1, 1.0);
  const current = new Float64Array(mesh.nodeCount).fill(1.0);

  it("has the '<elementCount>' header and one line per element", () => {
    const target = new Float64Array(mesh.nodeCount).fill(0.5);
    const lines = sizeFieldToVolFile(mesh, fieldFrom(current, target)).trim().split("\n");
    expect(lines[0]).toBe(`${mesh.elementCount}`);
    expect(lines.length).toBe(mesh.elementCount + 1);
    expect(lines[1]!.trim().split(/\s+/)[0]).toBe("1");   // 1-based indices
  });

  it("caps each element from its FINEST corner target, scaled by VOLUME_CAP_SCALE", () => {
    // Same convention as predictRefinedElementCount, so the budget prediction and
    // the constraint handed to the mesher describe the same mesh.
    const target = new Float64Array(mesh.nodeCount).fill(1.0);
    target[mesh.elements[0]!] = 0.5;   // one corner of element 0 refined
    const lines = sizeFieldToVolFile(mesh, fieldFrom(current, target)).trim().split("\n");
    const vol0 = Number(lines[1]!.trim().split(/\s+/)[1]);
    const exact = VOLUME_CAP_SCALE * 0.5 ** 3 / (6 * Math.SQRT2);
    expect(vol0 / exact).toBeCloseTo(1, 7);   // the file carries 8 significant digits
  });

  it("emits TetGen's -1 (unconstrained) for a non-positive target", () => {
    const target = new Float64Array(mesh.nodeCount); // all zero
    const lines = sizeFieldToVolFile(mesh, fieldFrom(current, target)).trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!.trim().split(/\s+/)[1]).toBe("-1");
    }
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
