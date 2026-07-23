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
 * The threshold is derived adaptively from each surface's own median 3-D edge
 * length (5×) rather than a fixed constant (issue #170). Separate holes end up
 * in separate clusters because their XY gap far exceeds a few edge lengths,
 * while one hole's own wall nodes stay linked. The previous code measured
 * nearest-neighbor spacing in the XY PROJECTION and floored it at an absolute
 * 0.5 mm — but a cylindrical wall's nodes stack at (nearly) the same XY over
 * multiple z levels, collapsing the XY spacing toward zero, so that 0.5 mm
 * constant was actually the load-bearing threshold. Measuring the spacing in
 * full 3-D (the true local edge length) removes the collapse AND the absolute
 * constant: the scale is now genuinely relative to the mesh and correct at any
 * unit scale.
 */
function clusterByDistance(
  nodeArr:   number[],
  nodes:     Float64Array,
): number[][] {
  const n = nodeArr.length;
  if (n < 2) return [nodeArr];

  const xy: Array<[number, number]> = nodeArr.map(idx =>
    [nodes[idx * 3] ?? 0, nodes[idx * 3 + 1] ?? 0]);

  // Median 3-D nearest-neighbor distance = the local edge length. Measured in
  // full 3-D so vertically-stacked wall nodes (same XY, different z) don't drive
  // the spacing to zero. Pre-allocated typed array avoids push overhead.
  const nnDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ix = nodes[nodeArr[i]! * 3] ?? 0, iy = nodes[nodeArr[i]! * 3 + 1] ?? 0, iz = nodes[nodeArr[i]! * 3 + 2] ?? 0;
    let minD = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = ix - (nodes[nodeArr[j]! * 3] ?? 0);
      const dy = iy - (nodes[nodeArr[j]! * 3 + 1] ?? 0);
      const dz = iz - (nodes[nodeArr[j]! * 3 + 2] ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < minD) minD = d;
    }
    nnDists[i] = minD;
  }
  nnDists.sort();
  const medianNN = nnDists[Math.floor(nnDists.length / 2)] ?? 0;
  // 5× the median edge length links a hole's own wall nodes while separating
  // distinct holes. Floor at MIN_VALUE only so a fully-degenerate (all-
  // coincident) set still yields a positive threshold — for any real mesh
  // medianNN·5 dominates. Union below is by XY distance (holes are apart in XY).
  const threshold = Math.max(medianNN * 5, Number.MIN_VALUE);

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

// ─── Scale-relative classification thresholds (issues #169, #170) ──────────────
//
// Every threshold below is RELATIVE to the mesh's own extent — no absolute-mm
// magic numbers survive in the touched classification paths. Each carries a
// rationale for the fraction chosen and how it preserves the existing fixtures.

/**
 * Relative circularity tolerance for a cylindrical (hole-wall) fit: a surface is
 * "circular" when its radial standard deviation is at most `HOLE_CIRCULARITY_EPS`
 * of its mean radius (issue #170). The old test was an absolute `rStd < 0.08 mm`,
 * which was ~16 % relative at r = 0.5 mm but only ~0.5 % at r = 15 mm — stricter
 * on big holes purely because of scale. 6 % is close to the old tolerance at the
 * wall-band scale (0.08 mm ≈ 6 % of ~1.35 mm) where holes actually sit, still
 * comfortably passes a well-meshed cylinder (radial variation < ~2 % at the
 * clcurv densities used) and rejects flat/curved non-cylindrical faces (radial
 * variation ≫ 10 %). The clustering fixtures use exact circles (rStd = 0), so
 * any positive ε preserves them.
 */
export const HOLE_CIRCULARITY_EPS = 0.06;

/**
 * Plausible hole-radius window as a fraction of the model's bounding-box
 * diagonal (issue #170) — replaces the absolute `0.5 mm < rMean < 15 mm`. A hole
 * is a small-to-moderate fraction of the part it lives in; `[diag·0.001,
 * diag·0.6]` spans mesh-noise-sized specks up to a hole taking most of the part.
 * The 0.6 upper bound tolerates the unit-test fixtures where `identifySurfaces`
 * receives only a single hole's own nodes (so the "bbox" is that hole's bbox and
 * r ≈ 0.29–0.35·diag), while in production (all part nodes) it rejects a
 * "radius" larger than the part (a mis-fit outer edge). Reported, not silently
 * relabelled: an out-of-window fit falls through to `outer_edge`.
 */
export function holeRadiusWindow(bboxDiag: number): { rMin: number; rMax: number } {
  return { rMin: bboxDiag * 0.001, rMax: bboxDiag * 0.6 };
}

/**
 * Classify a surface's flatness and top/bottom role RELATIVE to the mesh's own
 * z-extent (issue #169) — no absolute-mm z constants. The old code used
 * `zMin > 3.5` (top) and `zMax < 0.5` (bottom), which misclassified origin-
 * centred parts and anything under ~3.5 mm tall. Here a surface is "flat"
 * (horizontal) when its own z-variation is under 2 % of the part height, and a
 * flat face sitting at the global zMax is the top, at the global zMin the bottom.
 * 2 % is scale-invariant; it needs no absolute floor because CAD flat faces are
 * exactly planar in the mesh (their own z-variation is ~0), and the degenerate
 * zero-height part is handled explicitly.
 */
export function classifyFaceByZ(
  faceZMin: number,
  faceZMax: number,
  globalZMin: number,
  globalZMax: number,
): { isFlat: boolean; type: SurfaceInfo["type"] } {
  const globalZSpan = globalZMax - globalZMin;
  if (!(globalZSpan > 0)) return { isFlat: true, type: "unknown" }; // no height → no top/bottom
  const zTol = globalZSpan * 0.02; // 2 % of part height — relative, scale-invariant
  if (faceZMax - faceZMin >= zTol) return { isFlat: false, type: "unknown" }; // not horizontal
  if (globalZMax - faceZMax <= zTol) return { isFlat: true, type: "top_face" };
  if (faceZMin - globalZMin <= zTol) return { isFlat: true, type: "bottom_face" };
  return { isFlat: true, type: "unknown" }; // a flat ledge/step somewhere in the middle
}

/** Least-variance circle fit in XY for a node subset: centroid centre plus the
 *  mean and standard deviation of the radial distances. Pure helper shared by
 *  the whole-surface fit and the per-cluster re-fits (issue #170). */
export function fitCircleXY(
  clusterNodes: number[],
  nodes:        Float64Array,
): { cx: number; cy: number; rMean: number; rStd: number } {
  let cx = 0, cy = 0;
  for (const nIdx of clusterNodes) { cx += nodes[nIdx * 3] ?? 0; cy += nodes[nIdx * 3 + 1] ?? 0; }
  const k = clusterNodes.length || 1;
  cx /= k; cy /= k;
  const radii = clusterNodes.map(nIdx =>
    Math.sqrt(((nodes[nIdx * 3] ?? 0) - cx) ** 2 + ((nodes[nIdx * 3 + 1] ?? 0) - cy) ** 2));
  const rMean = radii.reduce((a, b) => a + b, 0) / (radii.length || 1);
  const rStd = Math.sqrt(radii.reduce((a, b) => a + (b - rMean) ** 2, 0) / (radii.length || 1));
  return { cx, cy, rMean, rStd };
}

/** True when a circle fit is tight (relative circularity) AND its radius lies
 *  inside the bbox-relative plausible window — the scale-relative replacement
 *  for `rStd < 0.08 && 0.5 < rMean < 15` (issue #170). */
export function isHoleFit(
  fit:     { rMean: number; rStd: number },
  bboxDiag: number,
): boolean {
  const { rMin, rMax } = holeRadiusWindow(bboxDiag);
  return fit.rMean > 0 && fit.rStd / fit.rMean < HOLE_CIRCULARITY_EPS
      && fit.rMean > rMin && fit.rMean < rMax;
}

export function identifySurfaces(
  nodes:       Float64Array,
  surfaceTris: Map<number, Array<[number,number,number]>>,
): SurfaceInfo[] {
  const results: SurfaceInfo[] = [];
  const debugSurfaces = process.env["STORMFEA_DEBUG_SURFACES"] === "1";

  // Global extent of the whole part (issues #169, #170): top/bottom classification
  // and the hole-radius window are both relative to it. Computed from every node
  // (extremes lie on the surface anyway), so it is the true part bbox in
  // production; in unit tests that pass a single feature's nodes it is that
  // feature's bbox, which the generous relative windows still tolerate.
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity;
  const totalNodes = nodes.length / 3;
  for (let i = 0; i < totalNodes; i++) {
    const x = nodes[i * 3] ?? 0, y = nodes[i * 3 + 1] ?? 0, z = nodes[i * 3 + 2] ?? 0;
    if (x < gMinX) gMinX = x; if (x > gMaxX) gMaxX = x;
    if (y < gMinY) gMinY = y; if (y > gMaxY) gMaxY = y;
    if (z < gMinZ) gMinZ = z; if (z > gMaxZ) gMaxZ = z;
  }
  if (!Number.isFinite(gMinX)) { gMinX = gMaxX = gMinY = gMaxY = gMinZ = gMaxZ = 0; }
  const globalZMin = gMinZ, globalZMax = gMaxZ;
  const bboxDiag = Math.sqrt((gMaxX - gMinX) ** 2 + (gMaxY - gMinY) ** 2 + (gMaxZ - gMinZ) ** 2);

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

    // z range of this surface (its centre in XY is fitted per-branch via
    // fitCircleXY, so only the z span is needed here).
    let zMin=Infinity, zMax=-Infinity;
    for (const n of nodeArr) {
      const z=nodes[n*3+2]??0;
      if(z<zMin) zMin=z; if(z>zMax) zMax=z;
    }

    // Check if this is a cylindrical surface by fitting a circle in XY
    // A cylindrical hole wall has nearly constant radial distance from its axis
    let bestType: SurfaceInfo["type"] = "unknown";
    let bestHoleInfo: SurfaceInfo["holeInfo"] | undefined;

    // Flatness + top/bottom are decided RELATIVE to the part's own z-extent
    // (issue #169) — no absolute zMin>3.5 / zMax<0.5 / zSpan<0.1 constants.
    const zClass = classifyFaceByZ(zMin, zMax, globalZMin, globalZMax);
    if (zClass.isFlat) {
      // Horizontal face — top, bottom, or a mid-height ledge (unknown).
      bestType = zClass.type;
    } else {
      // Has z extent — cylindrical hole wall or a flat (vertical) outer edge.
      // Fit a circle in XY: a cylinder's points sit at near-constant radius from
      // the centroid axis. Circularity is now RELATIVE (rStd/rMean) and the
      // radius window is scaled from the model bbox (issue #170).
      const fit = fitCircleXY(nodeArr, nodes);
      const rMean = fit.rMean, rStd = fit.rStd;

      if (debugSurfaces) {
        console.log(`[gmsh-debug] surface ${surfId}: cylindrical-fit check — ` +
          `centroid=(${fit.cx.toFixed(2)},${fit.cy.toFixed(2)}) rMean=${rMean.toFixed(3)} rStd=${rStd.toFixed(3)} ` +
          `(rStd/rMean=${(rMean > 0 ? rStd / rMean : Infinity).toFixed(4)} < ${HOLE_CIRCULARITY_EPS}? ${rMean > 0 && rStd / rMean < HOLE_CIRCULARITY_EPS})`);
      }

      // Angular coverage check: a genuine single cylindrical wall has points
      // distributed roughly evenly all the way around its centroid. A large gap
      // means EITHER a partially-occluded single wall (still one hole — e.g. a
      // counterbore or an intersecting feature removed part of the wall) OR two
      // separate holes merged under one surface tag. We must not confuse the two.
      let maxAngularGapDeg = 0;
      if (nodeArr.length >= 3) {
        const angles = nodeArr
          .map(n => Math.atan2((nodes[n*3+1]??0) - fit.cy, (nodes[n*3]??0) - fit.cx))
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

      const circular = isHoleFit(fit, bboxDiag);
      if (circular && fullyCovered) {
        // Tight radial fit AND points surround the centroid → genuine cylinder.
        bestType     = "hole_wall";
        bestHoleInfo = { cx: fit.cx, cy: fit.cy, r: rMean };
      } else if (circular && !fullyCovered) {
        // Tight fit but a >90° gap. BEFORE fabricating multiple holes, require
        // CORROBORATION that these are really separate holes (issue #170): the
        // nodes must split into ≥2 spatial clusters that EACH individually fit a
        // circle. A single connected cluster is one partially-occluded wall;
        // splitting it would invent phantom holes.
        const clusters = clusterByDistance(nodeArr, nodes);
        const circularClusters = clusters
          .filter(c => c.length >= 3)
          .map(c => ({ nodes: c, fit: fitCircleXY(c, nodes) }))
          .filter(c => isHoleFit(c.fit, bboxDiag));

        if (circularClusters.length >= 2) {
          // Corroborated: two (or more) genuinely-circular, spatially-distinct
          // clusters merged under one surface tag → split and re-fit each.
          console.warn(
            `[gmsh] surface near (${fit.cx.toFixed(2)},${fit.cy.toFixed(2)}) fits a circle ` +
            `(r=${rMean.toFixed(2)}) but covers only ${(360 - maxAngularGapDeg).toFixed(0)}° ` +
            `(max gap ${maxAngularGapDeg.toFixed(0)}°) AND splits into ${circularClusters.length} ` +
            `individually-circular clusters — treating as separate merged holes.`
          );
          for (const c of circularClusters) {
            results.push({
              surfaceId:   surfId,
              nodeIndices: c.nodes,
              type:        "hole_wall",
              holeInfo:    { cx: c.fit.cx, cy: c.fit.cy, r: c.fit.rMean },
            });
          }
          // The split clusters already cover this surface's real content.
          continue;
        }

        // NOT corroborated — one partially-occluded wall, not many holes. Keep it
        // as a single hole_wall (whole-surface fit) rather than splitting, so a
        // counterbore / intersecting feature never produces phantom holes.
        console.warn(
          `[gmsh] surface near (${fit.cx.toFixed(2)},${fit.cy.toFixed(2)}) has a ` +
          `${maxAngularGapDeg.toFixed(0)}° gap but no corroborating second circular cluster — ` +
          `treating as a single partially-covered hole, not splitting into phantom holes.`
        );
        bestType     = "hole_wall";
        bestHoleInfo = { cx: fit.cx, cy: fit.cy, r: rMean };
      } else {
        // High relative radial variance or radius out of the plausible window →
        // flat (vertical) outer edge (reported, not silently dropped).
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
    // Two hole-wall surfaces belong to the SAME physical cylinder when their
    // fitted centres nearly coincide (e.g. a top/bottom rim Gmsh split into
    // separate surface tags). "Nearly" is relative to the smaller fitted radius
    // (issue #170) — 0.5·r matches the old 1.0 mm constant at r = 2 mm but scales
    // with the hole. Distinct holes are separated by ≳ their own radii, so this
    // never over-merges them.
    const existing = holeCentres.find(h =>
      Math.sqrt((h.cx-cx)**2+(h.cy-cy)**2) < 0.5 * Math.min(h.r, r));
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
