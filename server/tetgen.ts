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
// Then elemCount lines: "index n0 n1 n2 n3 [attrs]"
// TetGen uses 1-based indices by default — subtract 1 if the first index is 1
function parseEleFile(text: string): Int32Array {
  const lines = text.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  const header = lines[0]!.trim().split(/\s+/);
  const elemCount = parseInt(header[0]!, 10);
  const elements = new Int32Array(elemCount * 4);

  // TetGen defaults to 1-based node indices but can emit 0-based depending on
  // build/flags. Detect the base by scanning the minimum node index referenced
  // across all elements: if the smallest index seen is 1 (and none is 0), the
  // file is 1-based and every index must be shifted down by 1. Scanning the
  // whole file (not just element 0) is robust to node 0 simply not appearing
  // in the first element.
  let minNodeIdx = Infinity;
  for (let i = 0; i < elemCount; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/);
    for (let k = 1; k <= 4; k++) {
      const v = parseInt(parts[k]!, 10);
      if (v < minNodeIdx) minNodeIdx = v;
    }
  }
  const offset = minNodeIdx === 0 ? 0 : 1;   // 0-based → 0, 1-based → 1

  for (let i = 0; i < elemCount; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/);
    elements[i * 4]     = parseInt(parts[1]!, 10) - offset;
    elements[i * 4 + 1] = parseInt(parts[2]!, 10) - offset;
    elements[i * 4 + 2] = parseInt(parts[3]!, 10) - offset;
    elements[i * 4 + 3] = parseInt(parts[4]!, 10) - offset;
  }
  return elements;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export interface TetGenResult {
  mesh: TetMesh;
  /** surfaceToNode[i] = index of STL surface vertex i in mesh.nodes */
  surfaceToNode: Int32Array;
  /** Number of Steiner points TetGen added (should be 0 with -Y) */
  steinerCount: number;
}

export async function meshWithTetGen(
  stlPositions:  Float32Array,
  triangleCount: number,
): Promise<TetGenResult> {

  // ── 1. Weld + write OFF ───────────────────────────────────────────────────
  const weld = weldVertices(stlPositions, triangleCount);
  const off  = buildOFF(weld);

  const tmpBase = path.join(tmpdir(), `stressform_${Date.now()}`);
  const offPath = tmpBase + ".off";

  await writeFile(offPath, off, "utf8");

  // ── 2. Run TetGen ─────────────────────────────────────────────────────────
  // -p      tetrahedralise the PLC
  // -q1.4   quality constraint (radius-edge ratio ≤ 1.4)
  // -a10    max element volume 10 mm³ (forces refinement in large flat regions)
  // -Q      quiet
  //
  // Note: we intentionally omit -Y (surface vertex preservation) because:
  //   - With -Y the mesh is too coarse in flat plate regions (only 585 nodes)
  //   - Without -Y TetGen inserts Steiner points freely, giving 20k+ nodes
  //   - We recover the surface mapping via spatial search (O(V×N), fast enough)
  //
  // Fallback chain: try quality+volume, then volume only, then basic.
  const nodePath = tmpBase + ".1.node";
  const elePath  = tmpBase + ".1.ele";

  const switchSets = [
    ["-pq1.4a10Q"],   // quality + volume (best)
    ["-pa10Q"],        // volume only
    ["-pa50Q"],        // coarser
    ["-pQ"],           // basic
  ];

  let meshed = false;
  for (const switches of switchSets) {
    const ok = await tryTetGen(offPath, switches);
    if (ok) {
      console.log(`[tetgen] succeeded with switches: ${switches.join(" ")}`);
      meshed = true;
      break;
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

  const nodes    = parseNodeFile(nodeText);
  const elements = parseEleFile(eleText);

  const nodeCount    = nodes.length / 3;
  const elementCount = elements.length / 4;


  // ── 5. Build surface→node map ──────────────────────────────────────────────
  // TetGen always outputs input vertices as the first N nodes in the same order,
  // regardless of whether -Y is used. Verified empirically: weld[i] = node[i]
  // with zero distance for all i in [0, weld.vertCount).
  // Use identity map for O(1) lookup — no spatial search needed.
  const surfaceToNode = new Int32Array(weld.vertCount);
  for (let i = 0; i < weld.vertCount; i++) surfaceToNode[i] = i;

  // ── 6. Clean up temp files ─────────────────────────────────────────────────
  const toDelete = [offPath, nodePath, elePath,
    tmpBase + ".1.face", tmpBase + ".1.edge", tmpBase + ".1.smesh"];
  await Promise.allSettled(toDelete.map(f => unlink(f)));

  console.log(`[tetgen] mesh: ${nodeCount} nodes, ${elementCount} elements, building surface map...`);

  return {
    mesh: {
      nodes,
      elements,
      nodeCount,
      elementCount,
      nodesPerElem: 4,  // TetGen only produces C3D4 linear elements
    },
    surfaceToNode,
    steinerCount: nodeCount - weld.vertCount,
  };
}

// ─── Helper: find tetgen binary ───────────────────────────────────────────────

function findTetGen(): string {
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
 * Probe whether the TetGen binary is actually runnable, for a loud startup
 * check. Runs it with no args (TetGen prints usage and exits) and classifies
 * the outcome: an ENOENT spawn error means the binary is absent; any other
 * result means it exists and launched. Returns the resolved path either way.
 */
export async function probeTetGen(): Promise<{ found: boolean; path: string }> {
  try {
    await execFileAsync(TETGEN_BIN, [], { timeout: 10_000 });
    return { found: true, path: TETGEN_BIN };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOENT = binary not found on disk / PATH. Anything else (non-zero exit
    // from a usage message, etc.) means it ran — so it IS present.
    return { found: code !== "ENOENT", path: TETGEN_BIN };
  }
}

// ─── Helper: try TetGen with given switches ───────────────────────────────────
async function tryTetGen(offPath: string, switches: string[]): Promise<boolean> {
  try {
    await execFileAsync(TETGEN_BIN, [...switches, offPath], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}
