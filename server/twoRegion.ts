/**
 * twoRegion.ts
 * ------------
 * Two-region (dense perimeter shell / homogenized infill core) FDM material
 * model: turns per-element wall-band volume fractions into a quantized
 * ElementMaterialField plus the volume-weighted average material.
 *
 * The caller (runAnalysis) builds the shell and core materials — this module
 * deliberately does not import the material builders from analysis.ts (no
 * import cycle); it only depends on solver-side geometry primitives.
 *
 * Blending notes:
 * - Per-bin constitutive matrices are TRUE Voigt (iso-strain) blends of the
 *   two rotated endpoint matrices, C_b = f·C_shell + (1−f)·C_core. Voigt is
 *   an upper bound on the true transition-element stiffness; it only affects
 *   the one-element-thick blend band and matches the codebase's first-order
 *   homogenized philosophy. Blending after the Bond (weakAxis) rotation is
 *   exact because the rotation is linear in C's entries — valid ONLY while
 *   shell and core share the same weakAxis.
 * - Yields and density blend linearly in volume fraction (consistent with
 *   Voigt).
 * - averageMaterial blends ENGINEERING CONSTANTS (blendMaterial below):
 *   identical to the Voigt C average when shell and core share all ratios,
 *   a first-order approximation once the anisotropic core laws make the
 *   ratios diverge. Acceptable because its only consumers are scalar
 *   (ZZ error-estimate energy norm, analytic hole checks, criterion
 *   routing) and every degenerate path returns an exact endpoint material.
 */

import type {
  AnyMaterial,
  ElementMaterialField,
  OrthotropicMaterial,
  TetMesh,
} from "./solver/types.js";
import { buildAnyConstitutiveMatrix, computeGeometry } from "./solver/element.js";
import { computeNodeSurfaceDistances, computeNodeBandPenetration } from "./solver/distance.js";
import { computeWallFractions, computeWallFractionsFromPhi } from "./solver/wallfrac.js";
import { interlaminarShearOf } from "./solver/stress.js";

/** Quantization level count for the wall-fraction bins (f_b = b/(N−1)). */
export const TWO_REGION_BIN_COUNT = 9;

/** Sanity cap: skip the field on absurdly large meshes (memory/latency). */
export const TWO_REGION_MAX_ELEMENTS = 400_000;

export interface TwoRegionResult {
  /**
   * The per-element field, or null when the classification degenerates to a
   * uniform part (all-shell thin part, all-core, or shell ≡ core at 100%
   * infill) — callers then run the plain uniform path with averageMaterial.
   */
  field: ElementMaterialField | null;
  /**
   * Volume-weighted average of shell and core. Feeds SolverInput.material
   * (scalar consumers: ZZ error-estimate energy norm, criterion routing) and
   * IS the uniform material when field is null.
   */
  averageMaterial: OrthotropicMaterial;
  /** Shell (wall-band) share of total part volume, ∈ [0, 1]. */
  shellVolumeFraction: number;
  /** Wall-band (vertical perimeter) thickness used for classification, mm. */
  wallThicknessMm: number;
  /** Top solid-skin (ceiling) band thickness, mm — only when skins were modeled. */
  skinTopThicknessMm?: number;
  /** Bottom solid-skin (floor) band thickness, mm — only when skins were modeled. */
  skinBotThicknessMm?: number;
}

/**
 * Independent top/bottom solid-skin (floor/ceiling) band specification for the
 * two-region model. Skins are the SAME solid material as the perimeter shell
 * (they are just solid regions printed layer-by-layer with the same weak axis),
 * so only their GEOMETRY differs — a horizontal-surface band whose thickness is
 * `layers × layerHeight`, generally different from the vertical perimeter band
 * `wallCount × lineWidth`.
 */
export interface SkinBands {
  /**
   * Build axis in the global mesh frame (bed normal, or a Z-up default when no
   * bed is picked). Used ONLY to classify which boundary triangles are
   * horizontal skins vs vertical perimeters and to split top from bottom.
   * Sign/azimuth are immaterial to the classification.
   */
  buildAxis: readonly [number, number, number];
  /** Top (ceiling) skin band thickness, mm. */
  tSkinTop: number;
  /** Bottom (floor) skin band thickness, mm. */
  tSkinBot: number;
}

/**
 * Per-boundary-triangle band thickness for the multi-thickness classifier.
 * A triangle whose normal is within 45° of the build axis is a solid SKIN
 * (top or bottom, split by its centroid's position along the axis relative to
 * the part mid-plane — winding-independent); everything else (side walls,
 * steep overhangs) uses the perimeter band `tWall`.
 */
function classifyFaceBands(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  skin: SkinBands,
  tWall: number,
): Float64Array {
  const nodes = mesh.nodes;
  const triCount = Math.floor(surfaceFaces.length / 3);
  const band = new Float64Array(triCount);

  const wlen = Math.hypot(skin.buildAxis[0], skin.buildAxis[1], skin.buildAxis[2]) || 1;
  const wx = skin.buildAxis[0] / wlen, wy = skin.buildAxis[1] / wlen, wz = skin.buildAxis[2] / wlen;

  // Part extent along the build axis → mid-plane for the top/bottom split.
  let pMin = Infinity, pMax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const proj = (nodes[n * 3] ?? 0) * wx + (nodes[n * 3 + 1] ?? 0) * wy + (nodes[n * 3 + 2] ?? 0) * wz;
    if (proj < pMin) pMin = proj;
    if (proj > pMax) pMax = proj;
  }
  const mid = (pMin + pMax) / 2;
  const COS45 = Math.SQRT1_2; // cos(45°) ≈ 0.70710678

  for (let t = 0; t < triCount; t++) {
    const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
    const ax = nodes[na * 3] ?? 0, ay = nodes[na * 3 + 1] ?? 0, az = nodes[na * 3 + 2] ?? 0;
    const bx = nodes[nb * 3] ?? 0, by = nodes[nb * 3 + 1] ?? 0, bz = nodes[nb * 3 + 2] ?? 0;
    const cx = nodes[nc * 3] ?? 0, cy = nodes[nc * 3 + 1] ?? 0, cz = nodes[nc * 3 + 2] ?? 0;
    // Triangle normal (b−a)×(c−a).
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-12) { band[t] = tWall; continue; } // degenerate → perimeter
    const nDotW = (nx * wx + ny * wy + nz * wz) / nlen;
    if (Math.abs(nDotW) >= COS45) {
      const cProj = ((ax + bx + cx) / 3) * wx + ((ay + by + cy) / 3) * wy + ((az + bz + cz) / 3) * wz;
      band[t] = cProj >= mid ? skin.tSkinTop : skin.tSkinBot;
    } else {
      band[t] = tWall;
    }
  }
  return band;
}

/**
 * Linear blend of two orthotropic materials' ENGINEERING CONSTANTS
 * (f = shell fraction). Used for averageMaterial (scalar consumers) and the
 * exact degenerate endpoints (f ∈ {0, 1}) only — the per-bin constitutive
 * matrices blend the rotated C matrices directly (see the bin loop), which
 * differs from this once shell and core stop sharing modulus ratios.
 */
function blendMaterial(
  shell: OrthotropicMaterial,
  core: OrthotropicMaterial,
  f: number,
  label: string,
): OrthotropicMaterial {
  const mix = (a: number, b: number) => f * a + (1 - f) * b;
  const blended: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy:    mix(shell.E_xy, core.E_xy),
    E_z:     mix(shell.E_z, core.E_z),
    nu_xy:   mix(shell.nu_xy, core.nu_xy),
    nu_xz:   mix(shell.nu_xz, core.nu_xz),
    G_xz:    mix(shell.G_xz, core.G_xz),
    yieldXY: mix(shell.yieldXY, core.yieldXY),
    yieldZ:  mix(shell.yieldZ, core.yieldZ),
    yieldZShear: mix(interlaminarShearOf(shell), interlaminarShearOf(core)),
    label,
  };
  const gxy = shell.G_xy !== undefined || core.G_xy !== undefined
    ? mix(shell.G_xy ?? shell.E_xy / (2 * (1 + shell.nu_xy)),
          core.G_xy ?? core.E_xy / (2 * (1 + core.nu_xy)))
    : undefined;
  const rho = shell.massRho !== undefined || core.massRho !== undefined
    ? mix(shell.massRho ?? 0, core.massRho ?? 0)
    : undefined;
  return {
    ...blended,
    ...(gxy !== undefined ? { G_xy: gxy } : {}),
    ...(rho !== undefined ? { massRho: rho } : {}),
    ...(shell.weakAxis ? { weakAxis: shell.weakAxis } : {}),
  };
}

/** Relative difference helper for the shell ≡ core degenerate check. */
function relDiff(a: number, b: number): number {
  const s = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / s;
}

/** Longest corner-corner edge in the mesh (search-radius bound for the
 *  distance clamp: straddling elements never have a clamped corner). */
function maxCornerEdge(mesh: TetMesh): number {
  const npe = mesh.nodesPerElem;
  let maxE2 = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let i = 0; i < 4; i++) {
      const ni = mesh.elements[base + i] ?? 0;
      const xi = mesh.nodes[ni * 3] ?? 0, yi = mesh.nodes[ni * 3 + 1] ?? 0, zi = mesh.nodes[ni * 3 + 2] ?? 0;
      for (let j = i + 1; j < 4; j++) {
        const nj = mesh.elements[base + j] ?? 0;
        const dx = (mesh.nodes[nj * 3] ?? 0) - xi;
        const dy = (mesh.nodes[nj * 3 + 1] ?? 0) - yi;
        const dz = (mesh.nodes[nj * 3 + 2] ?? 0) - zi;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxE2) maxE2 = d2;
      }
    }
  }
  return Math.sqrt(maxE2);
}

/**
 * Classify the mesh into wall/core volume fractions and build the quantized
 * material field.
 *
 * @param mesh          Tet mesh (C3D4 or C3D10).
 * @param surfaceFaces  Boundary triangle node triples into mesh.nodes.
 * @param shellMat      Solid perimeter material (typically massRho = solid
 *                      density; calibrated solid props flow here).
 * @param coreMat       Wall-free homogenized lattice material (massRho =
 *                      solid density × infill fraction).
 * @param tWall         Perimeter wall-band thickness, mm (wallCount × line width).
 * @param skin          Optional independent top/bottom solid-skin bands
 *                      (floor/ceiling). When present, horizontal-facing
 *                      boundary triangles get their own band thickness; when
 *                      absent the classifier reduces bit-identically to the
 *                      single-thickness `tWall` path.
 */
export function buildTwoRegionField(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  shellMat: OrthotropicMaterial,
  coreMat: OrthotropicMaterial,
  tWall: number,
  skin?: SkinBands,
): TwoRegionResult {
  // Largest band drives the search/clamp radius and the "any band?" check.
  const maxBand = skin ? Math.max(tWall, skin.tSkinTop, skin.tSkinBot) : tWall;

  // ── Degenerate: no band anywhere → pure core ─────────────────────────────
  if (maxBand <= 0) {
    return {
      field: null,
      averageMaterial: blendMaterial(shellMat, coreMat, 0, coreMat.label),
      shellVolumeFraction: 0,
      wallThicknessMm: 0,
    };
  }

  // ── Degenerate: shell ≡ core (e.g. 100% infill) → uniform solid ──────────
  const materialsEqual =
    relDiff(shellMat.E_xy, coreMat.E_xy) < 1e-9 &&
    relDiff(shellMat.E_z, coreMat.E_z) < 1e-9 &&
    relDiff(shellMat.yieldXY, coreMat.yieldXY) < 1e-9 &&
    relDiff(shellMat.yieldZ, coreMat.yieldZ) < 1e-9;

  // ── Wall fractions ────────────────────────────────────────────────────────
  // Single perimeter band → the legacy distance path (bit-identical). With
  // independent floor/ceiling skins → the union-of-bands penetration field,
  // which collapses to the legacy result when every band equals tWall.
  const dMax = maxBand + maxCornerEdge(mesh);
  let wallFrac: Float64Array;
  if (skin) {
    const faceBand = classifyFaceBands(mesh, surfaceFaces, skin, tWall);
    const nodePhi = computeNodeBandPenetration(mesh, surfaceFaces, faceBand, dMax);
    wallFrac = computeWallFractionsFromPhi(mesh, nodePhi);
  } else {
    const nodeDist = computeNodeSurfaceDistances(mesh, surfaceFaces, dMax);
    wallFrac = computeWallFractions(mesh, nodeDist, tWall);
  }

  // Volume-weighted shell fraction (corner-tet volumes; exact for straight-
  // sided C3D10 too, which is all the meshers produce).
  let volTotal = 0, volShell = 0;
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const g = computeGeometry(
      mesh.nodes,
      mesh.elements[base] ?? 0,
      mesh.elements[base + 1] ?? 0,
      mesh.elements[base + 2] ?? 0,
      mesh.elements[base + 3] ?? 0,
    );
    volTotal += g.V;
    volShell += g.V * (wallFrac[e] ?? 0);
  }
  const Vf = volTotal > 0 ? volShell / volTotal : 0;

  if (materialsEqual) {
    return {
      field: null,
      averageMaterial: blendMaterial(shellMat, coreMat, 1, shellMat.label),
      shellVolumeFraction: Vf,
      wallThicknessMm: tWall,
    };
  }

  const avgLabel = `two-region avg (shell ${(Vf * 100).toFixed(0)}%): ${shellMat.label}`;
  const averageMaterial = blendMaterial(shellMat, coreMat, Vf, avgLabel);

  // ── Degenerate: everything inside the band (thin part) → pure shell ──────
  // Physically right: slicers fill thin sections entirely with perimeters.
  if (Vf >= 1 - 1e-9) {
    return {
      field: null,
      averageMaterial: blendMaterial(shellMat, coreMat, 1, shellMat.label),
      shellVolumeFraction: 1,
      wallThicknessMm: tWall,
    };
  }
  if (Vf <= 1e-9) {
    return {
      field: null,
      averageMaterial: blendMaterial(shellMat, coreMat, 0, coreMat.label),
      shellVolumeFraction: 0,
      wallThicknessMm: tWall,
    };
  }

  // ── Quantize into bins ────────────────────────────────────────────────────
  // TRUE Voigt (iso-strain) blend: each bin's constitutive matrix is the
  // entrywise blend of the two ROTATED endpoint matrices, C_b = f·C_shell +
  // (1−f)·C_core. Blending after the weakAxis (Bond) rotation is exact
  // because the rotation is linear in C's entries — valid only while shell
  // and core share one weakAxis (invariant #3). Blending engineering
  // constants instead (the pre-anisotropic-core implementation) only agreed
  // with this when shell and core shared every modulus ratio and Poisson
  // ratio; the per-axis core laws broke that proportionality. Endpoint bins
  // (f = 0, 1) are the endpoint matrices bit-for-bit. Yields and density
  // stay linear scalar blends (consistent with Voigt).
  const N = TWO_REGION_BIN_COUNT;
  const C = new Float64Array(N * 36);
  const yieldXY = new Float64Array(N);
  const yieldZ = new Float64Array(N);
  const yieldZShear = new Float64Array(N);
  const massRho = new Float64Array(N);
  const shellFrac = new Float64Array(N);
  const Cshell = buildAnyConstitutiveMatrix(shellMat as AnyMaterial);
  const Ccore  = buildAnyConstitutiveMatrix(coreMat as AnyMaterial);
  const zsShell = interlaminarShearOf(shellMat);
  const zsCore  = interlaminarShearOf(coreMat);
  for (let b = 0; b < N; b++) {
    const f = b / (N - 1);
    for (let i = 0; i < 36; i++) {
      C[b * 36 + i] = f * (Cshell[i] ?? 0) + (1 - f) * (Ccore[i] ?? 0);
    }
    yieldXY[b]   = f * shellMat.yieldXY + (1 - f) * coreMat.yieldXY;
    yieldZ[b]    = f * shellMat.yieldZ  + (1 - f) * coreMat.yieldZ;
    yieldZShear[b] = f * zsShell + (1 - f) * zsCore;
    massRho[b]   = f * (shellMat.massRho ?? 0) + (1 - f) * (coreMat.massRho ?? 0);
    shellFrac[b] = f;
  }

  const binOfElement = new Int32Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    binOfElement[e] = Math.round((wallFrac[e] ?? 0) * (N - 1));
  }

  return {
    field: { binCount: N, binOfElement, C, yieldXY, yieldZ, yieldZShear, massRho, shellFrac },
    averageMaterial,
    shellVolumeFraction: Vf,
    wallThicknessMm: tWall,
    ...(skin ? { skinTopThicknessMm: skin.tSkinTop, skinBotThicknessMm: skin.tSkinBot } : {}),
  };
}
