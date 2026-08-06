/**
 * c3d10_ordering.ts
 * -----------------
 * Runtime self-check that a mesher's second-order (C3D10) midside node ordering
 * matches STORMFEA's convention before the mesh is handed to the solver.
 *
 * WHY (issue #167)
 * ================
 * Both meshers (TetGen via C3D10_REORDER, Gmsh type-11 read raw) emit 10-node
 * connectivity whose 6 midside slots must line up with `element.ts`'s shape
 * functions. Getting the ordering wrong does NOT crash: every element silently
 * evaluates the wrong shape functions and produces garbage stiffness that still
 * solves and still looks plausible. The TetGen ordering is pinned by a unit
 * test — but only against CI's build; a user's locally-installed TetGen (or a
 * new Gmsh version) with a different midnode emission order would corrupt every
 * analysis with nothing checking at runtime.
 *
 * THE CHECK
 * =========
 * STORMFEA's midside convention (from c3d10ShapeFunctions: N4=4ξη, N5=4ηζ,
 * N6=4ξζ, N7=4ξδ, N8=4ηδ, N9=4ζδ with corners 0↔ξ, 1↔η, 2↔ζ, 3↔δ):
 *
 *   slot 4 = midpoint(corner 0, corner 1)
 *   slot 5 = midpoint(corner 1, corner 2)
 *   slot 6 = midpoint(corner 0, corner 2)
 *   slot 7 = midpoint(corner 0, corner 3)
 *   slot 8 = midpoint(corner 1, corner 3)
 *   slot 9 = midpoint(corner 2, corner 3)
 *
 * For a STRAIGHT-EDGED element each midside node sits exactly at that midpoint,
 * so the per-slot deviation (relative to the edge length) is ~0. If the ordering
 * is wrong, each midside is compared against the wrong corner pair and the
 * deviation is O(½ edge). TetGen output is entirely affine; Gmsh interior
 * elements stay affine even when boundary elements curve onto the geometry.
 *
 * So: if NO element's midside nodes sit near their corner-pair midpoints (i.e.
 * there is not a single affine witness AND even the closest element is far off),
 * the ordering does not match — reject loudly. A correctly-ordered mesh always
 * has affine witnesses (all of TetGen; the interior of any Gmsh volume mesh), so
 * a genuinely all-curved-but-correct mesh is never falsely rejected. Overhead is
 * O(elements) trivial arithmetic (6 midpoints per element).
 */

/** STORMFEA midside slot 4+i connects corners C3D10_MIDSIDE_EDGES[i]. */
export const C3D10_MIDSIDE_EDGES: readonly [number, number][] = [
  [0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3],
];

export interface MidsideOrderingCheck {
  /** Elements whose 6 midsides all sit within `affineRelTol` of the midpoints. */
  affineWitnesses: number;
  /** Smallest per-element max midside deviation seen (relative to edge length). */
  bestElemMaxDev: number;
  /** Whether the ordering is judged consistent with STORMFEA's convention. */
  ok: boolean;
}

/**
 * Analyze the midside ordering without throwing (used by the thrower and tests).
 */
export function analyzeC3D10MidsideOrdering(
  nodes: Float64Array,
  elements: Int32Array,
  elementCount: number,
  opts?: { affineRelTol?: number; mismatchRelTol?: number },
): MidsideOrderingCheck {
  const affineRelTol   = opts?.affineRelTol   ?? 1e-4; // straight elements deviate ~1e-9
  const mismatchRelTol = opts?.mismatchRelTol ?? 0.10; // a wrong map deviates ~0.5

  let affineWitnesses = 0;
  let bestElemMaxDev = Infinity;

  for (let e = 0; e < elementCount; e++) {
    const base = e * 10;
    let elemMaxDev = 0;
    for (let s = 0; s < 6; s++) {
      const [ca, cb] = C3D10_MIDSIDE_EDGES[s]!;
      const na = elements[base + ca]!, nb = elements[base + cb]!, nm = elements[base + 4 + s]!;
      let len2 = 0, dev2 = 0;
      for (let d = 0; d < 3; d++) {
        const a = nodes[na * 3 + d] ?? 0, b = nodes[nb * 3 + d] ?? 0, m = nodes[nm * 3 + d] ?? 0;
        const dd = m - 0.5 * (a + b);
        dev2 += dd * dd;
        const el = b - a;
        len2 += el * el;
      }
      const rel = len2 > 1e-30
        ? Math.sqrt(dev2 / len2)
        : (Math.sqrt(dev2) > 1e-12 ? Infinity : 0); // zero-length edge = degenerate corner pair
      if (rel > elemMaxDev) elemMaxDev = rel;
    }
    if (elemMaxDev < affineRelTol) affineWitnesses++;
    if (elemMaxDev < bestElemMaxDev) bestElemMaxDev = elemMaxDev;
  }

  if (!Number.isFinite(bestElemMaxDev)) bestElemMaxDev = Infinity;
  // Consistent when at least one element sits at its midpoints (a straight/affine
  // witness), OR the whole mesh is only mildly curved (closest element well below
  // the half-edge signature of a wrong permutation).
  const ok = affineWitnesses > 0 || bestElemMaxDev <= mismatchRelTol;

  return { affineWitnesses, bestElemMaxDev, ok };
}

/**
 * A mesh REJECTED by the ordering guard, as distinct from a mesh that failed to
 * generate (issue #265).
 *
 * The distinction is what callers act on. A geometry TetGen cannot mesh is a
 * property of the input, and re-running produces the same refusal — the only
 * response is to degrade. A mesh that generated fine and then failed this check
 * is a statement about the TOOLCHAIN, and it has been observed to be transient:
 * once in three otherwise identical suite runs, with the same binary, the same
 * geometry and no input change. So it is worth attempting again before throwing
 * away every feature the analysis is about, and the retry doubles as the
 * experiment — a rejection that survives a fresh mesh is reproducible, and
 * reproducible means the remap really does not match this mesher build.
 *
 * Carries the measurements so a caller can log what it saw on each attempt.
 */
export class C3D10OrderingError extends Error {
  readonly affineWitnesses: number;
  readonly bestElemMaxDev:  number;
  readonly source:          string;

  constructor(message: string, detail: { affineWitnesses: number; bestElemMaxDev: number; source: string }) {
    super(message);
    this.name            = "C3D10OrderingError";
    this.affineWitnesses = detail.affineWitnesses;
    this.bestElemMaxDev  = detail.bestElemMaxDev;
    this.source          = detail.source;
  }
}

/**
 * Verify a C3D10 mesh's midside ordering, throwing an actionable error on a
 * mismatch. `source` names the mesher/path for the error message.
 * No-op for meshes that are not 10-node.
 */
export function verifyC3D10MidsideOrdering(
  nodes: Float64Array,
  elements: Int32Array,
  elementCount: number,
  nodesPerElem: number,
  source: string,
): void {
  if (nodesPerElem !== 10 || elementCount === 0) return;

  const { ok, bestElemMaxDev, affineWitnesses } = analyzeC3D10MidsideOrdering(nodes, elements, elementCount);
  if (ok) return;

  throw new C3D10OrderingError(
    `[C3D10 node order] The second-order midside node ordering from ${source} does not match ` +
    `STORMFEA's convention (slot 4=mid(0,1), 5=mid(1,2), 6=mid(0,2), 7=mid(0,3), 8=mid(1,3), ` +
    `9=mid(2,3)). No element's midside nodes sit at their corner-pair midpoints ` +
    `(0 affine witnesses; the closest element's worst midside deviated ` +
    `${(bestElemMaxDev * 100).toFixed(0)}% of the edge length — straight elements should be ~0%). ` +
    `This is a mesher version/build mismatch: proceeding would evaluate the wrong shape functions ` +
    `on every element and silently produce garbage stiffness. Update the ${source} node-order ` +
    `remap (see server/c3d10_ordering.ts) for this mesher build, or install the supported version.`,
    { affineWitnesses, bestElemMaxDev, source },
  );
}
