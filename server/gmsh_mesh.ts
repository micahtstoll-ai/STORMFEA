/**
 * gmsh_mesh.ts
 * ------------
 * Meshes a STEP file using Gmsh with curvature-based refinement.
 *
 * Advantages over TetGen+STL:
 *   1. Exact geometry — cylinders are cylinders, not triangle approximations
 *   2. Automatic refinement near holes via -clcurv flag
 *   3. Direct surface identification — no hole detection algorithm needed
 *   4. 2× finer elements near holes, coarser on flat faces
 *
 * Output:
 *   - TetMesh (nodes + elements) ready for the FEM solver
 *   - Surface map: which nodes belong to which CAD surface
 *   - Identified bolt surfaces (cylindrical hole walls)
 *   - Top/bottom face node sets for force/constraint application
 */

import { execFile }              from "child_process";
import { writeFile, readFile,
         unlink, mkdir }         from "fs/promises";
import { existsSync }            from "fs";
import { promisify }             from "util";
import { tmpdir }                from "os";
import * as path                 from "path";
import { fileURLToPath as ftu }  from "url";
import type { TetMesh }          from "./solver/types.js";

const execFileAsync = promisify(execFile);

// ─── Find Gmsh binary ─────────────────────────────────────────────────────────
function findGmsh(): string {
  const __dir = path.dirname(ftu(import.meta.url));
  const candidates = [
    path.join(__dir, "..", "gmsh.exe"),
    path.join(__dir, "..", "gmsh"),
    path.join(__dir, "gmsh.exe"),
    path.join(__dir, "gmsh"),
    "gmsh",
  ];
  for (const c of candidates) {
    if (existsSync(c)) { console.log(`[gmsh] found at: ${c}`); return c; }
  }
  return "gmsh";
}
const GMSH_BIN = findGmsh();

/**
 * Probe whether the Gmsh binary is runnable, for a loud startup check.
 * `gmsh --version` prints the version to stderr and exits 0, so a clean run
 * gives us both presence and version; ENOENT means it's absent.
 */
export async function probeGmsh(): Promise<{ found: boolean; path: string; version: string | null }> {
  try {
    const { stdout, stderr } = await execFileAsync(GMSH_BIN, ["--version"], { timeout: 10_000 });
    const version = (stderr || stdout || "").trim() || null;
    return { found: true, path: GMSH_BIN, version };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return { found: code !== "ENOENT", path: GMSH_BIN, version: null };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SurfaceInfo {
  surfaceId:   number;
  nodeIndices: number[];
  type:        "hole_wall" | "top_face" | "bottom_face" | "outer_edge" | "unknown";
  /** For hole walls: hole centre (x, y) and radius */
  holeInfo?:   { cx: number; cy: number; r: number };
}

export interface GmshMeshResult {
  mesh:         TetMesh;
  surfaces:     SurfaceInfo[];
  /** All nodes on cylindrical hole walls, grouped by hole */
  holeWallNodes: Map<number, number[]>;  // holeId → node indices
  /** Correctly-computed radius per hole (from identifySurfaces' circle fit,
   *  averaged across any merged top/bottom rim surfaces). Use this instead
   *  of recomputing radius from holeWallNodes' raw node positions —
   *  recomputing independently is exactly how this value drifted out of
   *  sync with the real fix in identifySurfaces in a previous version. */
  holeRadius:    Map<number, number>;    // holeId → radius (mm)
  /** All nodes on the top face (z = max) */
  topFaceNodes:  number[];
  /** All nodes on the bottom face (z = min) */
  bottomFaceNodes: number[];
  /** STL-compatible surface triangles for heatmap display */
  surfaceTriangles: Int32Array;  // [n0,n1,n2, ...] indices into mesh.nodes
}

// ─── Parse Gmsh .msh (version 2) — supports C3D4 and C3D10 ─────────────────────
/**
 * Parses first-order (type 4 = C3D4) and second-order (type 11 = C3D10) meshes.
 * Second-order triangles (type 9) are also handled for surface display —
 * only corner nodes are used for the heatmap triangulation.
 */
function parseMsh2(text: string): {
  nodes:        Float64Array;
  nodeCount:    number;
  elements:     Int32Array;
  elementCount: number;
  nodesPerElem: number;
  surfaceTris:  Map<number, Array<[number,number,number]>>;
} {
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length && !lines[i]!.includes("$Nodes")) i++;
  i++;
  const nodeCount = parseInt(lines[i++]!, 10);
  const nodesFlat = new Float64Array(nodeCount * 3);
  const nodeIdToIdx = new Map<number, number>();

  for (let n = 0; n < nodeCount; n++) {
    const parts = lines[i++]!.trim().split(/\s+/);
    const id = parseInt(parts[0]!, 10);
    nodesFlat[n*3]   = parseFloat(parts[1]!);
    nodesFlat[n*3+1] = parseFloat(parts[2]!);
    nodesFlat[n*3+2] = parseFloat(parts[3]!);
    nodeIdToIdx.set(id, n);
  }

  while (i < lines.length && !lines[i]!.includes("$Elements")) i++;
  i++;
  const totalElems = parseInt(lines[i++]!, 10);

  // Pre-allocate tets buffer at worst-case size (10 nodes × totalElems).
  // Actual used entries are sliced to tetPos at the end.
  const tetsBuf = new Int32Array(totalElems * 10);
  let tetPos = 0;
  const surfaceTris = new Map<number, Array<[number,number,number]>>();
  let detectedNPE = 4;

  for (let e = 0; e < totalElems; e++) {
    const parts = lines[i++]!.trim().split(/\s+/);
    if (!parts[0]) continue;
    const etype   = parseInt(parts[1]!, 10);
    const ntags   = parseInt(parts[2]!, 10);
    const geomTag = ntags >= 2 ? parseInt(parts[4]!, 10) : 0;
    const base    = 3 + ntags;

    if (etype === 4) {
      // C3D4: 4-node linear tet
      for (let k = 0; k < 4; k++)
        tetsBuf[tetPos++] = nodeIdToIdx.get(parseInt(parts[base+k]!, 10)) ?? 0;

    } else if (etype === 11) {
      // C3D10: 10-node quadratic tet — Gmsh ordering matches our element.ts
      detectedNPE = 10;
      for (let k = 0; k < 10; k++)
        tetsBuf[tetPos++] = nodeIdToIdx.get(parseInt(parts[base+k]!, 10)) ?? 0;

    } else if (etype === 2 || etype === 9) {
      // Linear or quadratic triangle — use corner nodes only for surface display
      const n0 = nodeIdToIdx.get(parseInt(parts[base]!,   10)) ?? 0;
      const n1 = nodeIdToIdx.get(parseInt(parts[base+1]!, 10)) ?? 0;
      const n2 = nodeIdToIdx.get(parseInt(parts[base+2]!, 10)) ?? 0;
      if (!surfaceTris.has(geomTag)) surfaceTris.set(geomTag, []);
      surfaceTris.get(geomTag)!.push([n0, n1, n2]);
    }
  }

  const elementCount = tetPos / detectedNPE;
  return {
    nodes:    nodesFlat,
    nodeCount,
    elements: tetsBuf.slice(0, tetPos),
    elementCount,
    nodesPerElem: detectedNPE,
    surfaceTris,
  };
}

// ─── Identify surfaces ────────────────────────────────────────────────────────
/**
 * Splits a set of node indices into spatial clusters using simple
 * single-linkage clustering (union-find): any two nodes within `threshold`
 * of each other end up in the same cluster, transitively. This is used to
 * recover individual holes when Gmsh has merged multiple holes' wall nodes
 * under a single surface tag — within one real hole the nodes are close
 * together (bounded by its diameter), while separate holes are far apart.
 *
 * The threshold is derived adaptively from each surface's own median
 * nearest-neighbor spacing (5x) rather than a fixed constant. A fixed
 * constant tuned for small holes would incorrectly split a single genuinely
 * large hole's own wall nodes into multiple fake clusters; deriving it from
 * the local point density scales correctly for both small and large real
 * holes while still separating distinct holes that are merged together.
 */
function clusterByDistance(
  nodeArr:   number[],
  nodes:     Float64Array,
): number[][] {
  const n = nodeArr.length;
  if (n < 2) return [nodeArr];

  const xy: Array<[number, number]> = nodeArr.map(idx =>
    [nodes[idx * 3] ?? 0, nodes[idx * 3 + 1] ?? 0]);

  // Median nearest-neighbor distance, used to set an adaptive threshold
  // Pre-allocate typed array to avoid push overhead for large surface node sets
  const nnDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let minD = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = xy[i]![0] - xy[j]![0], dy = xy[i]![1] - xy[j]![1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minD) minD = d;
    }
    nnDists[i] = minD;
  }
  nnDists.sort();
  const medianNN = nnDists[Math.floor(nnDists.length / 2)] ?? 1.0;
  const threshold = Math.max(0.5, medianNN * 5);

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) x = parent[x]!;
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const thresholdSq = threshold * threshold;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xy[i]![0] - xy[j]![0], dy = xy[i]![1] - xy[j]![1];
      if (dx * dx + dy * dy < thresholdSq) union(i, j);
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(nodeArr[i]!);
    clusters.set(root, list);
  }
  return Array.from(clusters.values());
}

export function identifySurfaces(
  nodes:       Float64Array,
  surfaceTris: Map<number, Array<[number,number,number]>>,
): SurfaceInfo[] {
  const results: SurfaceInfo[] = [];
  const debugSurfaces = process.env["STORMFEA_DEBUG_SURFACES"] === "1";

  for (const [surfId, tris] of surfaceTris.entries()) {
    const nodeSet = new Set<number>();
    for (const [a,b,c] of tris) { nodeSet.add(a); nodeSet.add(b); nodeSet.add(c); }
    const nodeArr = Array.from(nodeSet);

    if (debugSurfaces) {
      let dminX=Infinity,dmaxX=-Infinity,dminY=Infinity,dmaxY=-Infinity,dminZ=Infinity,dmaxZ=-Infinity;
      for (const n of nodeArr) {
        const x=nodes[n*3]??0, y=nodes[n*3+1]??0, z=nodes[n*3+2]??0;
        if(x<dminX)dminX=x; if(x>dmaxX)dmaxX=x;
        if(y<dminY)dminY=y; if(y>dmaxY)dmaxY=y;
        if(z<dminZ)dminZ=z; if(z>dmaxZ)dmaxZ=z;
      }
      console.log(`[gmsh-debug] surface ${surfId}: ${nodeArr.length} unique nodes, ` +
        `bbox x=[${dminX.toFixed(2)},${dmaxX.toFixed(2)}] y=[${dminY.toFixed(2)},${dmaxY.toFixed(2)}] z=[${dminZ.toFixed(2)},${dmaxZ.toFixed(2)}]`);
    }

    // Compute centroid and z range
    let cx=0, cy=0, cz=0, zMin=Infinity, zMax=-Infinity;
    for (const n of nodeArr) {
      const x=nodes[n*3]??0, y=nodes[n*3+1]??0, z=nodes[n*3+2]??0;
      cx+=x; cy+=y; cz+=z;
      if(z<zMin) zMin=z; if(z>zMax) zMax=z;
    }
    cx/=nodeArr.length; cy/=nodeArr.length; cz/=nodeArr.length;

    // Check if this is a cylindrical surface by fitting a circle in XY
    // A cylindrical hole wall has nearly constant radial distance from its axis
    let bestType: SurfaceInfo["type"] = "unknown";
    let bestHoleInfo: SurfaceInfo["holeInfo"] | undefined;

    // If z spans full thickness — could be cylindrical side or outer edge
    const zSpan = zMax - zMin;
    if (zSpan < 0.1) {
      // Nearly flat — top or bottom face
      if (zMin > 3.5) bestType = "top_face";
      else if (zMax < 0.5) bestType = "bottom_face";
      else bestType = "unknown";
    } else {
      // Has z extent — check if it's cylindrical (hole wall) or flat (outer edge)
      // Fit a circle in XY: for a cylinder, all points are at constant radius from axis
      // Compute centroid in XY and check radial std dev
      const radiiFromCentroid = nodeArr.map(n =>
        Math.sqrt(((nodes[n*3]??0) - cx)**2 + ((nodes[n*3+1]??0) - cy)**2));
      const rMean = radiiFromCentroid.reduce((a,b)=>a+b,0)/radiiFromCentroid.length;
      const rStd  = Math.sqrt(radiiFromCentroid.reduce((a,b)=>a+(b-rMean)**2,0)/radiiFromCentroid.length);

      if (debugSurfaces) {
        console.log(`[gmsh-debug] surface ${surfId}: cylindrical-fit check — ` +
          `centroid=(${cx.toFixed(2)},${cy.toFixed(2)}) rMean=${rMean.toFixed(3)} rStd=${rStd.toFixed(3)} ` +
          `(passes rStd<0.08? ${rStd < 0.08})`);
      }

      // Angular coverage check: a genuine single cylindrical wall has points
      // distributed roughly evenly all the way around its centroid. If Gmsh
      // has merged two separate holes' wall nodes under one surface tag
      // (which can happen when two holes are close together and the STEP
      // export/Gmsh doesn't assign them distinct physical groups), the
      // computed centroid sits between the two real holes, and the points
      // cluster into two tight arcs on opposite sides rather than
      // surrounding it — producing a large gap with no points at all. A
      // real single-hole wall with reasonable node density should never
      // have a gap anywhere near this large.
      let maxAngularGapDeg = 0;
      if (nodeArr.length >= 3) {
        const angles = nodeArr
          .map(n => Math.atan2((nodes[n*3+1]??0) - cy, (nodes[n*3]??0) - cx))
          .sort((a, b) => a - b);
        for (let k = 0; k < angles.length; k++) {
          const next = angles[(k + 1) % angles.length]!;
          let gap = next - angles[k]!;
          if (gap < 0) gap += 2 * Math.PI;
          if (gap > maxAngularGapDeg) maxAngularGapDeg = gap;
        }
        maxAngularGapDeg *= 180 / Math.PI;
      }
      const fullyCovered = maxAngularGapDeg < 90; // real single hole: small, even gaps

      if (debugSurfaces) {
        console.log(`[gmsh-debug] surface ${surfId}: angular gap=${maxAngularGapDeg.toFixed(1)}deg fullyCovered=${fullyCovered}`);
      }

      if (rStd < 0.08 && rMean > 0.5 && rMean < 15 && fullyCovered) {
        // Low radial variance around centroid AND points surround it → genuine
        // cylindrical surface
        bestType     = "hole_wall";
        bestHoleInfo = { cx, cy, r: rMean };
      } else if (rStd < 0.08 && rMean > 0.5 && rMean < 15 && !fullyCovered) {
        // Tight radial fit but points don't surround the centroid — likely
        // two (or more) separate holes merged under one surface tag. Don't
        // just discard this surface (that would silently drop real holes
        // from detection) — split the nodes into spatial clusters and
        // re-fit each one independently as its own candidate hole_wall.
        const clusters = clusterByDistance(nodeArr, nodes);
        console.warn(
          `[gmsh] surface near (${cx.toFixed(2)},${cy.toFixed(2)}) passed the radius/std check ` +
          `(r=${rMean.toFixed(2)}mm) but points only cover ${(360 - maxAngularGapDeg).toFixed(0)}° ` +
          `around the centroid (max gap ${maxAngularGapDeg.toFixed(0)}°) — likely ${clusters.length} ` +
          `holes merged under one surface tag. Splitting into separate clusters and re-fitting each.`
        );
        for (const clusterNodes of clusters) {
          if (clusterNodes.length < 3) continue; // too few points to fit a circle
          let scx = 0, scy = 0;
          for (const n of clusterNodes) { scx += nodes[n*3] ?? 0; scy += nodes[n*3+1] ?? 0; }
          scx /= clusterNodes.length; scy /= clusterNodes.length;
          const subRadii = clusterNodes.map(n =>
            Math.sqrt(((nodes[n*3]??0) - scx)**2 + ((nodes[n*3+1]??0) - scy)**2));
          const subRMean = subRadii.reduce((a,b)=>a+b,0) / subRadii.length;
          const subRStd = Math.sqrt(subRadii.reduce((a,b)=>a+(b-subRMean)**2,0) / subRadii.length);
          if (subRStd < 0.08 && subRMean > 0.5 && subRMean < 15) {
            results.push({
              surfaceId:   surfId,
              nodeIndices: clusterNodes,
              type:        "hole_wall",
              holeInfo:    { cx: scx, cy: scy, r: subRMean },
            });
          }
        }
        // Don't fall through to the normal single-entry push below — the
        // split clusters above already cover this surface's real content.
        continue;
      } else {
        // High radial variance → flat outer edge
        bestType = "outer_edge";
      }
    }

    if (debugSurfaces) {
      console.log(`[gmsh-debug] surface ${surfId}: FINAL classification = ${bestType}` +
        (bestHoleInfo ? ` (centre=(${bestHoleInfo.cx.toFixed(2)},${bestHoleInfo.cy.toFixed(2)}) r=${bestHoleInfo.r.toFixed(3)})` : ''));
    }

    results.push({
      surfaceId:   surfId,
      nodeIndices: nodeArr,
      type:        bestType,
      holeInfo:    bestHoleInfo,
    });
  }

  return results;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function meshStepWithGmsh(
  stepBuffer: Buffer,
  options: {
    clMin?:         number;  // min element size (mm), default 0.3
    clMax?:         number;  // max element size (mm), default 3.0
    clCurv?:        number;  // curvature samples per 2π, default 20
    elementOrder?:  1 | 2;  // 1 = C3D4 linear (default), 2 = C3D10 quadratic
  } = {}
): Promise<GmshMeshResult> {

  const { clMin = 0.3, clMax = 3.0, clCurv = 20, elementOrder = 1 } = options;

  const tmpBase = path.join(tmpdir(), `sf_${Date.now()}`);
  const stepPath = `${tmpBase}.step`;
  const mshPath  = `${tmpBase}.msh`;

  await writeFile(stepPath, stepBuffer);

  const orderLabel = elementOrder === 2 ? ' [C3D10 quadratic]' : ' [C3D4 linear]';
  console.log(`[gmsh] meshing STEP file (clMin=${clMin}, clMax=${clMax}, clCurv=${clCurv})${orderLabel}`);

  const args = [
    stepPath,
    "-3",
    `-clcurv`, `${clCurv}`,
    `-clmin`,  `${clMin}`,
    `-clmax`,  `${clMax}`,
    "-format", "msh2",
    "-o",      mshPath,
    "-v",      "1",
  ];

  // Add second-order flag if requested
  if (elementOrder === 2) {
    args.push("-order", "2");
  }

  try {
    await execFileAsync(GMSH_BIN, args, { timeout: 120_000, maxBuffer: 50*1024*1024 });
  } catch (err) {
    throw new Error(`Gmsh failed: ${err}`);
  }

  const mshText = await readFile(mshPath, "utf8");
  const parsed  = parseMsh2(mshText);

  // Guard against a silent Gmsh failure: it can exit 0 yet produce an empty or
  // malformed mesh (e.g. it couldn't load the STEP). Without this check the
  // empty/undefined arrays surface downstream as a cryptic "undefined is not
  // iterable" error. Fail here with something actionable instead.
  if (!parsed || !parsed.nodes || !(parsed.nodeCount > 0)) {
    throw new Error(
      "Gmsh produced an empty mesh from this STEP file. The file may be invalid, " +
      "or Gmsh may not have loaded it. Check that Gmsh is installed (see the server " +
      "startup banner) and that the STEP exports as a solid, not just surfaces."
    );
  }
  if (!parsed.surfaceTris) {
    throw new Error("Gmsh mesh has no surface triangles — cannot build geometry from this STEP file.");
  }

  console.log(`[gmsh] mesh: ${parsed.nodeCount} nodes, ${parsed.elementCount} elements (${parsed.nodesPerElem}-node tets)`);

  // Identify surfaces
  const surfaces = identifySurfaces(parsed.nodes, parsed.surfaceTris);

  // Group hole walls by hole
  const holeWallNodes = new Map<number, number[]>();
  const holeRadius = new Map<number, number>();
  const holeSurfaces = surfaces.filter(s => s.type === "hole_wall");

  // Cluster hole wall surfaces by their centre position
  let holeId = 0;
  const holeCentres: Array<{ cx: number; cy: number; r: number; id: number }> = [];
  for (const s of holeSurfaces) {
    if (!s.holeInfo || !s.nodeIndices) continue;
    const { cx, cy, r } = s.holeInfo;
    const existing = holeCentres.find(h => Math.sqrt((h.cx-cx)**2+(h.cy-cy)**2) < 1.0);
    if (existing) {
      const nodes = holeWallNodes.get(existing.id) ?? [];
      nodes.push(...s.nodeIndices);
      holeWallNodes.set(existing.id, nodes);
      // Surfaces merged into the same hole (e.g. top/bottom rim split into
      // separate surface IDs) should have near-identical radii since they're
      // the same physical cylinder — average them rather than keeping
      // whichever happened to be inserted first.
      const prevR = holeRadius.get(existing.id) ?? r;
      holeRadius.set(existing.id, (prevR + r) / 2);
    } else {
      holeCentres.push({ cx, cy, r, id: holeId });
      holeWallNodes.set(holeId, [...s.nodeIndices]);
      holeRadius.set(holeId, r);
      holeId++;
    }
  }

  // Top and bottom face nodes
  const topSurfs    = surfaces.filter(s => s.type === "top_face");
  const bottomSurfs = surfaces.filter(s => s.type === "bottom_face");
  const topFaceNodes    = topSurfs.flatMap(s => s.nodeIndices ?? []);
  const bottomFaceNodes = bottomSurfs.flatMap(s => s.nodeIndices ?? []);

  // Build surface triangle array for heatmap rendering
  // Count total triangles first, then fill a pre-allocated Int32Array
  let totalSurfTriCount = 0;
  for (const [, tris] of parsed.surfaceTris.entries()) totalSurfTriCount += tris.length;
  const allSurfTris = new Int32Array(totalSurfTriCount * 3);
  let surfTriPos = 0;
  for (const [, tris] of parsed.surfaceTris.entries()) {
    for (const [a,b,c] of tris) {
      allSurfTris[surfTriPos++] = a;
      allSurfTris[surfTriPos++] = b;
      allSurfTris[surfTriPos++] = c;
    }
  }

  console.log(`[gmsh] surfaces: ${surfaces.length} (${holeWallNodes.size} holes, ${topFaceNodes.length} top nodes, ${bottomFaceNodes.length} bottom nodes)`);

  // Log hole info
  for (const [id, nodes] of holeWallNodes.entries()) {
    const centre = holeCentres.find(h => h.id === id);
    console.log(`[gmsh] hole ${id}: ${nodes.length} wall nodes at (${centre?.cx.toFixed(2)},${centre?.cy.toFixed(2)})`);
  }

  // Clean up
  await Promise.allSettled([unlink(stepPath), unlink(mshPath)]);

  return {
    mesh: {
      nodes:        parsed.nodes,
      elements:     parsed.elements,
      nodeCount:    parsed.nodeCount,
      elementCount: parsed.elementCount,
      nodesPerElem: parsed.nodesPerElem,
    },
    surfaces,
    holeWallNodes,
    holeRadius,
    topFaceNodes,
    bottomFaceNodes,
    surfaceTriangles: allSurfTris,
  };
}
