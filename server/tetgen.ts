/**
 * tetgen.ts
 * ---------
 * Calls the system TetGen binary to generate a quality tetrahedral volume
 * mesh from an STL surface mesh.
 *
 * Pipeline:
 *   STL positions (Float32Array)
 *     → weld duplicate vertices
 *     → write .off file
 *     → spawn tetgen -pYQ
 *     → read .node + .ele output
 *     → return TetMesh + surfaceNodeMap
 *
 * The 'Y' switch tells TetGen to preserve all input surface vertices as
 * the first N nodes in the output, in the same order. This means:
 *   output.nodes[i] === input surface vertex[i]  for i in [0, surfaceVertCount)
 *
 * This gives us a direct O(1) surface-to-volume mapping with no spatial search.
 *
 * TetGen switches used:
 *   -p  Tetrahedralise the piecewise linear complex (required)
 *   -Y  Preserve input surface vertices (no Steiner points on surface)
 *   -Q  Quiet mode (suppress stdout)
 *
 * Note: -q (quality) causes assertion failures in TetGen 1.5 on some
 * geometries. We omit it and rely on -p only for a valid but unrefined mesh.
 * Quality refinement is planned for a future version.
 */

import { execFile }                           from "child_process";
import { writeFile, readFile, unlink }        from "fs/promises";
import { existsSync }                         from "fs";
import { promisify }                          from "util";
import { tmpdir }                             from "os";
import * as path                              from "path";
import { fileURLToPath as ftu }               from "url";
import type { TetMesh }                       from "./solver/types.js";

const execFileAsync = promisify(execFile);

// ─── Vertex welding ───────────────────────────────────────────────────────────
interface WeldResult {
  positions: Float64Array;   // welded vertex positions [x0,y0,z0, ...]
  faces:     Int32Array;     // triangle indices [a0,b0,c0, ...]
  vertCount: number;
  triCount:  number;
  /** For each original STL slot, which welded vertex index it maps to */
  slotToWeld: Int32Array;
}

function weldVertices(stlPositions: Float32Array, triangleCount: number): WeldResult {
  // Weld tolerance: 1e6 = 1 micron. Previously 1e4 (0.1mm) which was too coarse
  // — circle vertices from the quad-ring generator differ at the 4th decimal place,
  // causing adjacent triangles to have unmatched vertices → open edges → TetGen rejection.
  const PREC = 1e6;
  const outer = new Map<number, Map<number, number>>();
  const slotToWeld = new Int32Array(triangleCount * 3);
  let vertCount = 0;
  // Pre-allocate for the worst case (no welding): every slot is unique.
  // Actual used positions are sliced to vertCount*3 at return.
  const posArr = new Float64Array(triangleCount * 3 * 3);

  for (let slot = 0; slot < triangleCount * 3; slot++) {
    const x = stlPositions[slot * 3]     ?? 0;
    const y = stlPositions[slot * 3 + 1] ?? 0;
    const z = stlPositions[slot * 3 + 2] ?? 0;
    const qx = Math.round(x * PREC);
    const qy = Math.round(y * PREC);
    const qz = Math.round(z * PREC);
    const outerKey = (qz + 1_048_577) * 2_097_155 + (qy + 1_048_577);
    let inner = outer.get(outerKey);
    if (!inner) { inner = new Map(); outer.set(outerKey, inner); }
    let idx = inner.get(qx);
    if (idx === undefined) {
      idx = vertCount++;
      inner.set(qx, idx);
      posArr[idx * 3]     = x;
      posArr[idx * 3 + 1] = y;
      posArr[idx * 3 + 2] = z;
    }
    slotToWeld[slot] = idx;
  }

  const faces = new Int32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount * 3; t++) faces[t] = slotToWeld[t] ?? 0;

  return {
    positions: posArr.slice(0, vertCount * 3),
    faces,
    vertCount,
    triCount: triangleCount,
    slotToWeld,
  };
}

// ─── Write OFF file ───────────────────────────────────────────────────────────
function buildOFF(weld: WeldResult): string {
  const lines: string[] = [`OFF`, `${weld.vertCount} ${weld.triCount} 0`];
  const p = weld.positions;
  for (let v = 0; v < weld.vertCount; v++) {
    lines.push(`${p[v*3]??0} ${p[v*3+1]??0} ${p[v*3+2]??0}`);
  }
  for (let t = 0; t < weld.triCount; t++) {
    lines.push(`3 ${weld.faces[t*3]??0} ${weld.faces[t*3+1]??0} ${weld.faces[t*3+2]??0}`);
  }
  return lines.join("\n") + "\n";
}

// ─── Parse TetGen .node file ──────────────────────────────────────────────────
// Format: first line = "nodeCount dim attrs boundary"
// Then nodeCount lines: "index x y z [attrs] [boundary]"
function parseNodeFile(text: string): Float64Array {
  const lines = text.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  const header = lines[0]!.trim().split(/\s+/);
  const nodeCount = parseInt(header[0]!, 10);
  const nodes = new Float64Array(nodeCount * 3);
  for (let i = 0; i < nodeCount; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/);
    nodes[i * 3]     = parseFloat(parts[1]!);
    nodes[i * 3 + 1] = parseFloat(parts[2]!);
    nodes[i * 3 + 2] = parseFloat(parts[3]!);
  }
  return nodes;
}

// ─── Parse TetGen .ele file ───────────────────────────────────────────────────
// Format: first line = "elemCount nodesPerElem attrs"
// Then elemCount lines: "index n0..nN [attrs]"
// nodesPerElem = 4 for C3D4 (linear), 10 for C3D10 (second-order via -o2).
// TetGen uses 1-based indices by default — subtract 1 if the first index is 1.
//
// TetGen's C3D10 edge-midpoint ordering (0-based .ele positions 4–9), VERIFIED
// EMPIRICALLY against TetGen 1.5 by meshing box / unit-cube / skewed-hexahedron
// OFF files with -o2 and matching each higher-order node's coordinates to the
// midpoint of a corner pair. Confirmed against two builds — the 1.5.1-beta1
// source ("Version 1.5, May 31, 2014" banner) and the Debian/Ubuntu package
// tetgen 1.5.0-5build1 (issue #66, re-run 2026-07 via
// scripts/verify_tetgen_c3d10.mjs, which observed slots 4..9 emit edges
// 2-3, 0-3, 0-1, 1-2, 1-3, 0-2 — deriving exactly the C3D10_REORDER below —
// and a cantilever check at δ/δ_EB = 0.984). Consistent across every element
// of every run, with and without quality refinement (-pQ, -pq1.4Q,
// -pq1.4a0.1Q, -pq1.4a10Q):
//   TetGen:   4=mid(2,3), 5=mid(0,3), 6=mid(0,1), 7=mid(1,2), 8=mid(1,3), 9=mid(0,2)
//   STORMFEA: 4=mid(0,1), 5=mid(1,2), 6=mid(0,2), 7=mid(0,3), 8=mid(1,3), 9=mid(2,3)
// (STORMFEA's convention comes from element.ts c3d10ShapeFunctions:
//  N4=4ξη, N5=4ηζ, N6=4ξζ, N7=4ξδ, N8=4ηδ, N9=4ζδ with corners 0↔ξ,1↔η,2↔ζ,3↔δ.)
//
// STORMFEA slot k reads TetGen raw position C3D10_REORDER[k]:
//   slot 4 (mid 0,1) ← raw 6;  slot 5 (mid 1,2) ← raw 7;  slot 6 (mid 0,2) ← raw 9;
//   slot 7 (mid 0,3) ← raw 5;  slot 8 (mid 1,3) ← raw 8;  slot 9 (mid 2,3) ← raw 4.
// Pinned by the regression test server/tests/unit/tetgen-c3d10.test.ts, which
// runs whenever a tetgen binary is available (e.g. via the TETGEN_BIN env var).
const C3D10_REORDER = [0, 1, 2, 3, 6, 7, 9, 5, 8, 4]; // stormfea slot k ← tetgen raw position C3D10_REORDER[k]

function parseEleFile(text: string): { elements: Int32Array; nodesPerElem: number } {
  const lines = text.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  const header = lines[0]!.trim().split(/\s+/);
  const elemCount   = parseInt(header[0]!, 10);
  const nodesPerElem = parseInt(header[1]!, 10);  // 4 for C3D4, 10 for C3D10

  const elements = new Int32Array(elemCount * nodesPerElem);

  // Detect 0-based vs 1-based node indices by scanning all elements.
  let minNodeIdx = Infinity;
  for (let i = 0; i < elemCount; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/);
    for (let k = 1; k <= nodesPerElem; k++) {
      const v = parseInt(parts[k]!, 10);
      if (v < minNodeIdx) minNodeIdx = v;
    }
  }
  const offset = minNodeIdx === 0 ? 0 : 1;

  for (let i = 0; i < elemCount; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/);
    if (nodesPerElem === 10) {
      // Read into a temp buffer, then reorder from TetGen ordering to STORMFEA ordering.
      const raw = new Int32Array(10);
      for (let k = 0; k < 10; k++) raw[k] = parseInt(parts[k + 1]!, 10) - offset;
      for (let k = 0; k < 10; k++) elements[i * 10 + k] = raw[C3D10_REORDER[k]!]!;
    } else {
      for (let k = 0; k < 4; k++) elements[i * 4 + k] = parseInt(parts[k + 1]!, 10) - offset;
    }
  }
  return { elements, nodesPerElem };
}

// ─── Missing-binary error ─────────────────────────────────────────────────────
/**
 * Thrown when the TetGen binary itself is absent (spawn ENOENT), as opposed
 * to TetGen running and failing on the geometry. Callers must NOT treat this
 * as a geometry problem: the fix is installing TetGen, not re-exporting the
 * STL. analysis.ts rethrows it instead of falling back to the box mesh, and
 * /api/analyse maps it to a 503 with the install hint (issue #106).
 */
export class TetGenNotFoundError extends Error {
  readonly hint: string;
  constructor(binPath: string) {
    const install = process.platform === "win32"
      ? "download tetgen.exe and place it next to start.bat"
      : process.platform === "darwin"
        ? "run: brew install tetgen"
        : "run: sudo apt-get install tetgen";
    super(`TetGen not found (looked for '${binPath}') — STL meshing requires it. This is a setup problem, not a problem with your model.`);
    this.hint = `Install TetGen (${install}), then restart the server. The server console prints the same instructions at startup.`;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export interface TetGenResult {
  mesh: TetMesh;
  /** surfaceToNode[i] = index of STL surface vertex i in mesh.nodes */
  surfaceToNode: Int32Array;
  /**
   * Surface triangles as mesh-node triples [a0,b0,c0, a1,b1,c1, …]. These are
   * the welded boundary triangles; boundary vertices are the first N mesh nodes
   * in order (see surfaceToNode), so these indices point directly into
   * mesh.nodes. Used to apply consistent surface tractions (pressure loads).
   */
  surfaceFaces: Int32Array;
  /** Number of Steiner points TetGen added (should be 0 with -Y) */
  steinerCount: number;
}

export async function meshWithTetGen(
  stlPositions:  Float32Array,
  triangleCount: number,
  elementOrder:  1 | 2 = 2,
  /**
   * Maximum tetrahedron volume in mm³ (TetGen -a switch). Lower = denser mesh.
   * Default 10 preserves the historical behaviour; analysis.ts maps the user's
   * coarse/standard/fine selector to this so the control actually affects STL
   * mesh density (previously it was hardcoded and only the STEP/Gmsh path
   * honoured the selector).
   */
  maxVolume:     number = 10,
): Promise<TetGenResult> {

  // ── 0. Known-missing fast path ────────────────────────────────────────────
  // The startup probe (probeTetGen) already determined whether the binary is
  // runnable. If it is known to be absent, fail immediately with the honest
  // cause — before welding vertices, writing the OFF file, or burning four
  // pointless switch-set retries that each ENOENT (issue #106).
  if (tetgenKnownMissing) throw new TetGenNotFoundError(TETGEN_BIN);

  // ── 1. Weld + write OFF ───────────────────────────────────────────────────
  const weld = weldVertices(stlPositions, triangleCount);
  const off  = buildOFF(weld);

  const tmpBase = path.join(tmpdir(), `stressform_${Date.now()}`);
  const offPath = tmpBase + ".off";

  await writeFile(offPath, off, "utf8");

  // ── 2. Run TetGen ─────────────────────────────────────────────────────────
  // -p      tetrahedralise the PLC
  // -q1.4   quality constraint (radius-edge ratio ≤ 1.4)
  // -a<v>   max element volume <v> mm³ (from maxVolume, driven by mesh quality)
  // -Q      quiet
  // -o2     second-order elements (C3D10); only added when elementOrder=2
  //
  // Note: C3D10_REORDER in parseEleFile remaps TetGen's midnode ordering to
  // STORMFEA's element.ts ordering. Verified empirically against TetGen 1.5
  // (1.5.1-beta1) — see the comment above C3D10_REORDER and the regression
  // test server/tests/unit/tetgen-c3d10.test.ts.
  //
  // Fallback chain: try quality+volume, then volume only, then a relaxed volume,
  // then basic. The final `-pQ` (no volume constraint) always succeeds if the
  // geometry is meshable at all.
  const nodePath = tmpBase + ".1.node";
  const elePath  = tmpBase + ".1.ele";

  const a  = Math.max(0.01, maxVolume);
  const aR = (a * 5).toPrecision(4);   // relaxed volume for the third attempt
  const av = a.toPrecision(4);
  const o2 = elementOrder === 2 ? ["-o2"] : [];
  const switchSets = [
    [`-pq1.4a${av}Q`, ...o2],
    [`-pa${av}Q`,     ...o2],
    [`-pa${aR}Q`,     ...o2],
    ["-pQ",           ...o2],
  ];

  let meshed = false;
  for (const switches of switchSets) {
    const outcome = await tryTetGen(offPath, switches);
    if (outcome === "ok") {
      console.log(`[tetgen] succeeded with switches: ${switches.join(" ")}`);
      meshed = true;
      break;
    }
    if (outcome === "missing") {
      // The binary itself is absent (ENOENT) — retrying with different
      // switches cannot help, and this must not be reported as a geometry
      // problem. Remember it so later analyses fail before doing any work.
      tetgenKnownMissing = true;
      console.error(`[tetgen] binary not found (looked for '${TETGEN_BIN}') — skipping fallback switch sets`);
      await unlink(offPath).catch(() => {});
      throw new TetGenNotFoundError(TETGEN_BIN);
    }
    console.log(`[tetgen] failed with ${switches.join(" ")}, trying fallback...`);
  }

  if (!meshed) {
    throw new Error("TetGen failed to mesh this geometry. The STL may have self-intersections or non-manifold edges.");
  }

  // ── 3. Read output ────────────────────────────────────────────────────────
  const [nodeText, eleText] = await Promise.all([
    readFile(nodePath, "utf8"),
    readFile(elePath,  "utf8"),
  ]);

  const nodes                          = parseNodeFile(nodeText);
  const { elements, nodesPerElem }     = parseEleFile(eleText);

  const nodeCount    = nodes.length / 3;
  const elementCount = elements.length / nodesPerElem;

  // ── 4. Build surface→node map ──────────────────────────────────────────────
  // TetGen always outputs input vertices as the first N nodes in the same order,
  // regardless of whether -Y is used. Verified empirically: weld[i] = node[i]
  // with zero distance for all i in [0, weld.vertCount).
  const surfaceToNode = new Int32Array(weld.vertCount);
  for (let i = 0; i < weld.vertCount; i++) surfaceToNode[i] = i;

  // ── 5. Clean up temp files ─────────────────────────────────────────────────
  const toDelete = [offPath, nodePath, elePath,
    tmpBase + ".1.face", tmpBase + ".1.edge", tmpBase + ".1.smesh"];
  await Promise.allSettled(toDelete.map(f => unlink(f)));

  console.log(`[tetgen] mesh: ${nodeCount} nodes, ${elementCount} elements (${nodesPerElem}-node)`);

  return {
    mesh: {
      nodes,
      elements,
      nodeCount,
      elementCount,
      nodesPerElem,
    },
    surfaceToNode,
    surfaceFaces: weld.faces,
    steinerCount: nodeCount - weld.vertCount,
  };
}

// ─── Helper: find tetgen binary ───────────────────────────────────────────────

function findTetGen(): string {
  // Explicit override, e.g. for tests or deployments where the binary lives
  // outside the default search paths. Ignored (with a warning) if the path
  // does not exist, so the normal search below still applies.
  const envBin = process.env["TETGEN_BIN"];
  if (envBin) {
    if (existsSync(envBin)) {
      console.log(`[tetgen] using TETGEN_BIN: ${envBin}`);
      return envBin;
    }
    console.warn(`[tetgen] TETGEN_BIN set but not found on disk: ${envBin}`);
  }

  const __dir = path.dirname(ftu(import.meta.url));
  const candidates = [
    path.join(__dir, "..", "tetgen.exe"),
    path.join(__dir, "..", "tetgen"),
    path.join(__dir, "tetgen.exe"),
    path.join(__dir, "tetgen"),
    "tetgen.exe",
    "tetgen",
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      console.log(`[tetgen] found binary at: ${c}`);
      return c;
    }
  }
  return process.platform === "win32" ? "tetgen.exe" : "tetgen";
}

const TETGEN_BIN = findTetGen();

/**
 * Whether we know the TetGen binary is absent. Set by probeTetGen at startup
 * and by an ENOENT during an actual meshing attempt; cleared when a probe
 * finds the binary again (e.g. installed and the probe re-run). Lets every
 * subsequent analysis fail fast with the real cause instead of re-discovering
 * the missing binary through four ENOENT retries per run (issue #106).
 */
let tetgenKnownMissing = false;

/**
 * Probe whether the TetGen binary is actually runnable, for a loud startup
 * check. Runs it with no args (TetGen prints usage and exits) and classifies
 * the outcome: an ENOENT spawn error means the binary is absent; any other
 * result means it exists and launched. Returns the resolved path either way.
 */
export async function probeTetGen(): Promise<{ found: boolean; path: string }> {
  try {
    await execFileAsync(TETGEN_BIN, [], { timeout: 10_000 });
    tetgenKnownMissing = false;
    return { found: true, path: TETGEN_BIN };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOENT = binary not found on disk / PATH. Anything else (non-zero exit
    // from a usage message, etc.) means it ran — so it IS present.
    const found = code !== "ENOENT";
    tetgenKnownMissing = !found;
    return { found, path: TETGEN_BIN };
  }
}

// ─── Helper: try TetGen with given switches ───────────────────────────────────
// "missing" = the binary itself could not be spawned (ENOENT); "fail" = it ran
// but rejected the geometry/switches. The distinction matters: only "fail" is
// worth retrying with more permissive switches.
async function tryTetGen(offPath: string, switches: string[]): Promise<"ok" | "fail" | "missing"> {
  try {
    await execFileAsync(TETGEN_BIN, [...switches, offPath], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return "ok";
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "fail";
  }
}
