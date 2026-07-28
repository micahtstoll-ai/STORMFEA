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
  /**
   * Scale-relative floor for the single-linkage threshold (issue #170). The
   * threshold is primarily the adaptive `medianNN·5`; this floor only guards
   * against a degenerate ~0 median. It used to be a hard-coded 0.5 mm, which
   * is unit-dependent; deriving it from the model diagonal keeps it meaningful
   * at any scale. Defaults to 0 (pure-adaptive) when no diagonal is supplied.
   */
  diagFloor: number = 0,
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
  const threshold = Math.max(diagFloor, medianNN * 5);

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

// ─── Scale-relative surface-classification constants (issues #169, #170) ──────
// Every threshold below is dimensionless or derived from the model's own
// bounding box, so the same STEP part classifies identically whether it was
// exported in mm, cm, m, or inches, and whether it sits base-at-0,
// origin-centered, or offset. See each constant for its rationale.

/** A face is "flat in z" when its z-extent is under this fraction of the part
 *  height. Replaces the absolute `zSpan < 0.1` mm. 2% comfortably separates a
 *  planar top/bottom face (z-extent ≈ 0) from a hole wall (spans the height). */
const FLAT_ZSPAN_FRAC = 0.02;
/** A flat face is top/bottom when its z sits within this fraction of the part
 *  height of the GLOBAL z-max / z-min. Replaces the absolute `zMin > 3.5` /
 *  `zMax < 0.5` mm, which assumed base-at-0 and height > 3.5 mm. */
const FACE_POS_FRAC = 0.02;
/** Circularity tolerance as a DIMENSIONLESS ratio rStd/rMean. Replaces the
 *  absolute `rStd < 0.08` mm, which conflated facet resolution with
 *  non-circularity (a coarsely faceted large hole has small rStd/rMean but
 *  rStd > 0.08 mm absolute). 0.06 ≈ the old 0.08 mm on a canonical ~1.5 mm
 *  bolt hole, but now scales to any radius/unit. */
const CIRC_REL = 0.06;
/** Accepted hole-radius window as a fraction of the model diagonal. Replaces
 *  the absolute 0.5–15 mm window, which dropped both sub-0.5 mm pin holes and
 *  >15 mm bores. Below MIN a "circle" is fit noise; above MAX it can't be an
 *  internal hole (radius > ~half the part). The MIN is deliberately small
 *  (0.3% of the diagonal) because the circularity (rStd/rMean) and angular-
 *  coverage gates already reject non-holes, so MIN only needs to exclude
 *  degenerate near-point clusters. */
const RADIUS_MIN_FRAC = 0.003;
const RADIUS_MAX_FRAC = 0.49;
/** Angular gap (deg) that TRIGGERS the merged-hole check. A split is only
 *  performed when it is CORROBORATED by ≥2 independently-circular clusters
 *  (issue #170) — a single arc with a large gap (counterbore, slot-intersected
 *  hole) is never split into phantom holes. */
const GAP_SPLIT_DEG = 90;
/** Two detected hole surfaces are the SAME physical cylinder when their centres
 *  are closer than this fraction of the smaller radius (issue #170). Replaces
 *  the absolute 1.0 mm centre-merge distance. Rim/top/bottom surfaces of one
 *  hole share a centre to within mesh noise, while distinct holes are spaced
 *  well beyond 25% of a radius apart. */
const HOLE_MERGE_FRAC = 0.25;

export function identifySurfaces(
  nodes:       Float64Array,
  surfaceTris: Map<number, Array<[number,number,number]>>,
): SurfaceInfo[] {
  const results: SurfaceInfo[] = [];
  const debugSurfaces = process.env["STORMFEA_DEBUG_SURFACES"] === "1";

  // ── Global model extent (issues #169, #170) ────────────────────────────────
  // Classification is relative to the model's OWN bounding box, not absolute mm.
  // Derived from the union of all surface-triangle nodes (the exterior), which
  // defines the true top/bottom planes and the model diagonal used to scale the
  // hole-radius window and clustering floor.
  let gMinX=Infinity, gMaxX=-Infinity, gMinY=Infinity, gMaxY=-Infinity, gMinZ=Infinity, gMaxZ=-Infinity;
  for (const tris of surfaceTris.values()) {
    for (const tri of tris) {
      for (const n of tri) {
        const x=nodes[n*3]??0, y=nodes[n*3+1]??0, z=nodes[n*3+2]??0;
        if(x<gMinX)gMinX=x; if(x>gMaxX)gMaxX=x;
        if(y<gMinY)gMinY=y; if(y>gMaxY)gMaxY=y;
        if(z<gMinZ)gMinZ=z; if(z>gMaxZ)gMaxZ=z;
      }
    }
  }
  if (!Number.isFinite(gMinX)) { gMinX=gMaxX=gMinY=gMaxY=gMinZ=gMaxZ=0; }
  const modelHeight = gMaxZ - gMinZ;
  const modelDiag = Math.hypot(gMaxX-gMinX, gMaxY-gMinY, gMaxZ-gMinZ);
  const radiusMin = RADIUS_MIN_FRAC * modelDiag;
  const radiusMax = RADIUS_MAX_FRAC * modelDiag;
  const clusterFloor = 1e-4 * modelDiag;
  /** True when a fitted radius is within the scale-relative plausible window. */
  const radiusInWindow = (r: number) => r > radiusMin && r < radiusMax;
  /** Dimensionless circularity test (issue #170). */
  const isCircular = (rStd: number, rMean: number) => rMean > 0 && rStd / rMean < CIRC_REL;

  if (debugSurfaces) {
    console.log(`[gmsh-debug] model bbox z=[${gMinZ.toFixed(2)},${gMaxZ.toFixed(2)}] height=${modelHeight.toFixed(2)} ` +
      `diag=${modelDiag.toFixed(2)} radius-window=[${radiusMin.toFixed(3)},${radiusMax.toFixed(3)}]mm`);
  }

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
    // Flatness and top/bottom membership are now RELATIVE to the part's own
    // height (issue #169), not absolute mm — so origin-centered and thin parts
    // classify correctly. A part with ~0 height can't have a meaningful
    // top/bottom, so those faces fall through to the cylinder/outer-edge branch.
    if (modelHeight > 0 && zSpan < FLAT_ZSPAN_FRAC * modelHeight) {
      // Nearly flat — top or bottom face, decided by proximity to the GLOBAL
      // z extremes rather than fixed z coordinates.
      const posTol = FACE_POS_FRAC * modelHeight;
      if (gMaxZ - zMax < posTol) bestType = "top_face";
      else if (zMin - gMinZ < posTol) bestType = "bottom_face";
      else bestType = "unknown";
      if (debugSurfaces) {
        console.log(`[gmsh-debug] surface ${surfId}: flat (zSpan=${zSpan.toFixed(3)} < ${(FLAT_ZSPAN_FRAC*modelHeight).toFixed(3)}) ` +
          `z=[${zMin.toFixed(2)},${zMax.toFixed(2)}] vs global[${gMinZ.toFixed(2)},${gMaxZ.toFixed(2)}] → ${bestType}`);
      }
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
          `(circular? rStd/rMean=${(rStd/(rMean||1)).toFixed(4)}<${CIRC_REL} = ${isCircular(rStd, rMean)}; ` +
          `radiusInWindow? ${radiusInWindow(rMean)})`);
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
      const fullyCovered = maxAngularGapDeg < GAP_SPLIT_DEG; // real single hole: small, even gaps

      if (debugSurfaces) {
        console.log(`[gmsh-debug] surface ${surfId}: angular gap=${maxAngularGapDeg.toFixed(1)}deg fullyCovered=${fullyCovered}`);
      }

      if (isCircular(rStd, rMean) && radiusInWindow(rMean) && fullyCovered) {
        // Low radial variance around centroid AND points surround it → genuine
        // cylindrical surface
        bestType     = "hole_wall";
        bestHoleInfo = { cx, cy, r: rMean };
      } else if (isCircular(rStd, rMean) && radiusInWindow(rMean) && !fullyCovered) {
        // Tight radial fit but points don't surround the centroid — this MIGHT
        // be two (or more) separate holes merged under one surface tag, OR it
        // might be a single hole legitimately exposing a large angular gap
        // (a counterbore, or a hole intersected by a slot). We must NOT invent
        // phantom holes for the latter (issue #170), so a split is only
        // accepted when it is CORROBORATED by ≥2 clusters that EACH pass the
        // circularity + radius-window fit independently. Otherwise the surface
        // is a partial/irregular wall → outer_edge, not fabricated holes.
        const clusters = clusterByDistance(nodeArr, nodes, clusterFloor);
        const fits: SurfaceInfo[] = [];
        for (const clusterNodes of clusters) {
          if (clusterNodes.length < 3) continue; // too few points to fit a circle
          let scx = 0, scy = 0;
          for (const n of clusterNodes) { scx += nodes[n*3] ?? 0; scy += nodes[n*3+1] ?? 0; }
          scx /= clusterNodes.length; scy /= clusterNodes.length;
          const subRadii = clusterNodes.map(n =>
            Math.sqrt(((nodes[n*3]??0) - scx)**2 + ((nodes[n*3+1]??0) - scy)**2));
          const subRMean = subRadii.reduce((a,b)=>a+b,0) / subRadii.length;
          const subRStd = Math.sqrt(subRadii.reduce((a,b)=>a+(b-subRMean)**2,0) / subRadii.length);
          if (isCircular(subRStd, subRMean) && radiusInWindow(subRMean)) {
            fits.push({
              surfaceId:   surfId,
              nodeIndices: clusterNodes,
              type:        "hole_wall",
              holeInfo:    { cx: scx, cy: scy, r: subRMean },
            });
          }
        }
        if (fits.length >= 2) {
          // Corroborated: genuinely separate merged holes. Emit each.
          console.warn(
            `[gmsh] surface near (${cx.toFixed(2)},${cy.toFixed(2)}) covers only ` +
            `${(360 - maxAngularGapDeg).toFixed(0)}° around its centroid (max gap ` +
            `${maxAngularGapDeg.toFixed(0)}°) and splits into ${fits.length} independently-circular ` +
            `clusters — treating as ${fits.length} merged holes.`
          );
          results.push(...fits);
          // The split clusters already cover this surface's real content.
          continue;
        }
        // Not corroborated — a single arc with a large gap (counterbore / slot).
        // Do NOT fabricate holes; classify as a plain outer edge instead.
        if (debugSurfaces) {
          console.log(`[gmsh-debug] surface ${surfId}: large angular gap (${maxAngularGapDeg.toFixed(0)}°) but ` +
            `only ${fits.length} circular cluster(s) — NOT splitting (no phantom holes) → outer_edge`);
        }
        bestType = "outer_edge";
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
    elementOrder?:  1 | 2;  // 1 = C3D4 linear, 2 = C3D10 quadratic (default)
  } = {}
): Promise<GmshMeshResult> {

  const { clMin = 0.3, clMax = 3.0, clCurv = 20, elementOrder = 2 } = options;

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
    // Scale-relative centre merge (issue #170): same-cylinder surfaces share a
    // centre to within mesh noise; use a fraction of the smaller radius rather
    // than a fixed 1.0 mm so it holds at any scale.
    const existing = holeCentres.find(h =>
      Math.sqrt((h.cx-cx)**2+(h.cy-cy)**2) < HOLE_MERGE_FRAC * Math.min(h.r, r));
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

  // Loud, actionable signal when surface classification found NO planar
  // top/bottom face (issue #169). These are the anchors for automatic
  // load/constraint placement, so an empty set means auto-placement will fall
  // back to a geometric extreme-face search — surface it rather than letting a
  // mis-anchored model look normal.
  if (topFaceNodes.length === 0 && bottomFaceNodes.length === 0) {
    console.warn(
      "[gmsh] No planar top or bottom face was classified from this STEP part. " +
      "Automatic top/bottom load & constraint placement has no CAD-face anchor and " +
      "will fall back to a geometric extreme-face search — verify auto-applied loads/constraints."
    );
  }

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
