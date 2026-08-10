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
  WallBondField,
} from "./solver/types.js";
import { buildAnyConstitutiveMatrix, computeGeometry } from "./solver/element.js";
import {
  computeNodeSurfaceDistances,
  computeNodeBandPenetration,
  computeNodeSurfaceDistancesAndNormals,
  computeElementWallNormals,
} from "./solver/distance.js";
import {
  computeWallFractions,
  computeWallFractionsFromPhi,
  computeWallInteriorFraction,
} from "./solver/wallfrac.js";
import { interlaminarShearOf } from "./solver/stress.js";

/**
 * BASE / FLOOR wall-fraction bin count. Low- and medium-contrast fields use
 * exactly this many LINEARLY spaced bins (f_b = b/(N−1)) — bit-identical to the
 * legacy path. High-contrast fields grow the count and switch to log-spacing so
 * the adjacent-bin stiffness ratio stays bounded (see planBins, issue #178).
 */
export const TWO_REGION_BIN_COUNT = 9;

/** Hard cap on the adaptive bin count (memory bound; 33×36 doubles ≈ 9 KB). */
export const TWO_REGION_MAX_BINS = 33;

/**
 * Target upper bound on the stiffness ratio between ADJACENT bins (issue #178).
 * Linear 9-bin spacing already respects this up to a shell:core contrast ≈ 9;
 * above that a 0.01 change in wallFrac could otherwise flip an element's
 * stiffness ~100× (0.06→bin0 vs 0.07→bin1 at 10³:1), so we log-space and add
 * bins until every adjacent pair is within this factor.
 */
export const TWO_REGION_BIN_RATIO_TARGET = 2;

/**
 * Default solid-skin cone half-angle, degrees: a boundary face is a solid
 * top/bottom SKIN when the angle between its normal and the build axis is
 * ≤ this value (equivalently, the face is tilted ≤ this many degrees from
 * horizontal). Faces steeper than this — within (90° − cone) of vertical —
 * stay on the perimeter WALL band.
 *
 * The legacy value was 45° (a hard cos45 test), which sent 45°–90°-from-
 * horizontal up/down-facing surfaces — shallow domes, moderate overhangs and
 * undersides that slicers print as stair-stepped SOLID top/bottom skins — into
 * the vertical-perimeter band with wall thickness (issue #181). 65° captures
 * those solid-skin surfaces (e.g. a 60°-from-horizontal dome region: normal
 * 60° off the axis, cos 60° = 0.5 ≥ cos 65° = 0.423 → skin) while leaving
 * genuine near-vertical perimeter walls (tilt > 65°, i.e. within 25° of
 * vertical) on the wall band. Overridable per-analysis via SkinBands.skinConeDeg.
 */
export const DEFAULT_SKIN_CONE_DEG = 65;

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
  /**
   * Shell (wall-band) share of total part volume, ∈ [0, 1]. NULL when the
   * classification was skipped because shell ≡ core (issue #297) — the split
   * is not computed there, so no fraction is reported rather than a made-up
   * one. See `collapsedReason`.
   */
  shellVolumeFraction: number | null;
  /** Wall-band (vertical perimeter) thickness used for classification, mm. */
  wallThicknessMm: number;
  /**
   * Set when the model collapsed to a uniform part WITHOUT computing the
   * classification. Distinct from a degradation: the model ran, and the answer
   * is that this part has no split.
   */
  collapsedReason?: string;
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
  /**
   * Solid-skin cone half-angle in degrees (max tilt of a solid-skin face's
   * normal from the build axis). Defaults to DEFAULT_SKIN_CONE_DEG (65°).
   * Set to 45 to reproduce the legacy hard-cos45 classification.
   */
  skinConeDeg?: number;
}

/**
 * Per-boundary-triangle band thickness for the multi-thickness classifier.
 * A triangle whose normal is within `skinConeDeg` (default 65°) of the build
 * axis is a solid SKIN (top or bottom, split by its centroid's position along
 * the axis relative to the part mid-plane — winding-independent); everything
 * else (near-vertical side walls) uses the perimeter band `tWall`. The cone
 * angle replaces the legacy hard cos45 test so 45°–90°-from-horizontal
 * up/down-facing overhang/underside surfaces are credited as solid skin
 * rather than mis-classified as vertical perimeter (issue #181).
 *
 * Exported for direct unit testing of the face classification.
 */
export function classifyFaceBands(
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
  // Skin faces: normal within `skinConeDeg` of the build axis (|n·ŵ| ≥ cos θ).
  // Larger cone → more up/down-facing overhang/underside faces credited as
  // solid skin; genuine near-vertical walls stay on tWall (issue #181).
  const coneDeg = skin.skinConeDeg ?? DEFAULT_SKIN_CONE_DEG;
  const cosCone = Math.cos((coneDeg * Math.PI) / 180);

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
    if (Math.abs(nDotW) >= cosCone) {
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
  // DFA pressure sensitivity blends like the yields: core-only, shell = 0. At
  // f = 1 (pure shell / 100%-infill collapse) → 0 (von Mises); at f = 0 (pure
  // core degenerate) → the core's α. Matches the per-bin dfaAlpha blend, so the
  // averageMaterial the field-null degenerate paths hand to recovery carries
  // the right criterion. Omitted when neither endpoint is pressure-sensitive.
  const dfaAlpha = shell.dfaAlpha !== undefined || core.dfaAlpha !== undefined
    ? mix(shell.dfaAlpha ?? 0, core.dfaAlpha ?? 0)
    : undefined;
  return {
    ...blended,
    ...(gxy !== undefined ? { G_xy: gxy } : {}),
    ...(rho !== undefined ? { massRho: rho } : {}),
    ...(dfaAlpha !== undefined ? { dfaAlpha } : {}),
    ...(shell.weakAxis ? { weakAxis: shell.weakAxis } : {}),
  };
}

/** Relative difference helper for the shell ≡ core degenerate check. */
/**
 * Do shell and core describe the SAME material? Then there is no split to
 * compute and the classification can be skipped entirely (issue #297).
 *
 * Exported so the predicate lives in one place: `buildTwoRegionField` uses it
 * to short-circuit, and callers can reason about the collapse without
 * duplicating the tolerance.
 */
export function materialsEqualFor(
  shellMat: OrthotropicMaterial,
  coreMat:  OrthotropicMaterial,
): boolean {
  return relDiff(shellMat.E_xy, coreMat.E_xy) < 1e-9
      && relDiff(shellMat.E_z, coreMat.E_z) < 1e-9
      && relDiff(shellMat.yieldXY, coreMat.yieldXY) < 1e-9
      && relDiff(shellMat.yieldZ, coreMat.yieldZ) < 1e-9;
}

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

// ─── Adaptive wall-fraction binning (issue #178) ─────────────────────────────
//
// The per-bin constitutive matrix is C(f) = f·C_shell + (1−f)·C_core, linear in
// the shell fraction f. For a diagonal entry with shell:core ratio k the
// magnitude C(f) = C_core·(1 + f·(k−1)) grows fastest near f = 0, so uniformly
// spaced bins put a huge stiffness step on the first interval at high contrast.
// We (a) measure the worst diagonal contrast K, (b) keep the legacy LINEAR
// N=9 spacing while it already bounds the adjacent-bin ratio (K ⪅ 9), and
// (c) otherwise LOG-space the fractions so C grows geometrically — every
// adjacent-bin ratio ≤ TWO_REGION_BIN_RATIO_TARGET. Because C(f) is steepest
// for the max-contrast entry, bounding ITS ratio bounds every entry's ratio.
// Endpoints stay f=0 (pure core) and f=1 (pure shell) EXACTLY in both modes,
// so pure-phase elements map to the endpoint matrices bit-for-bit.

/** Worst shell:core diagonal stiffness ratio across the two endpoint matrices. */
function stiffnessContrast(Cshell: Float64Array, Ccore: Float64Array): number {
  const DIAG = [0, 7, 14, 21, 28, 35]; // 6×6 flattened row-major diagonal
  let k = 1;
  for (const i of DIAG) {
    const s = Math.abs(Cshell[i] ?? 0);
    const c = Math.abs(Ccore[i] ?? 0);
    if (s > 1e-30 && c > 1e-30) k = Math.max(k, s / c);
  }
  return k;
}

/**
 * Choose the bin count and spacing mode for a given contrast. Linear N=9 is
 * kept while its worst adjacent ratio 1 + (K−1)/(N−1) ≤ target (so low/medium
 * contrast stays bit-identical to the legacy path); otherwise log-space with
 * N−1 = ⌈log(K)/log(target)⌉ bins (capped), giving adjacent ratio K^(1/(N−1)) ≤
 * target.
 */
function planBins(K: number): { N: number; logSpaced: boolean } {
  const Nlin = TWO_REGION_BIN_COUNT;
  const linWorst = 1 + (K - 1) / (Nlin - 1);
  if (linWorst <= TWO_REGION_BIN_RATIO_TARGET + 1e-12) return { N: Nlin, logSpaced: false };
  const need = 1 + Math.ceil(Math.log(K) / Math.log(TWO_REGION_BIN_RATIO_TARGET));
  return { N: Math.min(TWO_REGION_MAX_BINS, Math.max(Nlin, need)), logSpaced: true };
}

/** Shell fraction for bin b (endpoints exact; log-spaced ⇒ geometric stiffness). */
function binFraction(b: number, N: number, K: number, logSpaced: boolean): number {
  if (b <= 0) return 0;
  if (b >= N - 1) return 1;
  if (!logSpaced) return b / (N - 1);
  return (Math.pow(K, b / (N - 1)) - 1) / (K - 1);
}

/** Nearest bin (in the spacing's warped index space) for an element's wallFrac. */
function binForWallFrac(w: number, N: number, K: number, logSpaced: boolean): number {
  const wc = Math.min(1, Math.max(0, w));
  const idx = logSpaced
    ? (N - 1) * Math.log1p(wc * (K - 1)) / Math.log(K) // inverse of binFraction
    : wc * (N - 1);
  const b = Math.round(idx);
  return b < 0 ? 0 : b > N - 1 ? N - 1 : b;
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
  // Checked BEFORE the distance field, not after (issue #297). This branch used
  // to fall through, build the full classification, and then discard it — which
  // cost nothing while the model was opt-in and became the dominant cost of
  // every solid-part analysis the moment it became the default. MEASURED on the
  // #149 adaptive fixture, which is 100% infill: 248.7 s before the default
  // flip, 433.5 s after, 236.4 s with the flag forced off. The whole 1.74x was
  // this field being computed for a part that has no split.
  //
  // What is given up is `shellVolumeFraction` on this path: it is a true
  // statement about the GEOMETRY but a distinction without a difference about
  // the MATERIAL, since both regions are the same. Nothing derived depends on
  // it here — at rho = 1 the strength fraction is exactly 1.0, so
  // `impliedAvgStrengthMul` reduces to `orientFallbackMul` for any Vf — so the
  // only loss is a percentage in the results text on a part where the split
  // cannot change a number.
  if (materialsEqualFor(shellMat, coreMat)) {
    return {
      field: null,
      averageMaterial: blendMaterial(shellMat, coreMat, 1, shellMat.label),
      shellVolumeFraction: null,
      wallThicknessMm: tWall,
      collapsedReason: "shell and core are the same material (no split to compute)",
    };
  }

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
  //
  // ADAPTIVE spacing (issue #178): the bin FRACTIONS f_b are linear (legacy,
  // bit-identical) for low/medium contrast and log-spaced (with more bins) for
  // high contrast, so no adjacent-bin stiffness step exceeds ~2× even at the
  // ~10³:1 shell:core contrast of a near-zero-infill core. The field SHAPE is
  // unchanged (binOfElement + binCount×36 C), so the assembly-worker payload
  // (invariant #7) is untouched — binCount is already read as C.length/36.
  const Cshell = buildAnyConstitutiveMatrix(shellMat as AnyMaterial);
  const Ccore  = buildAnyConstitutiveMatrix(coreMat as AnyMaterial);
  const K = stiffnessContrast(Cshell, Ccore);
  const { N, logSpaced } = planBins(K);
  const C = new Float64Array(N * 36);
  const yieldXY = new Float64Array(N);
  const yieldZ = new Float64Array(N);
  const yieldZShear = new Float64Array(N);
  const massRho = new Float64Array(N);
  const shellFrac = new Float64Array(N);
  const dfaAlpha = new Float64Array(N);
  const zsShell = interlaminarShearOf(shellMat);
  const zsCore  = interlaminarShearOf(coreMat);
  // The shell is solid (von Mises, α = 0); only the core is pressure-sensitive.
  const alphaCore = coreMat.dfaAlpha ?? 0;
  for (let b = 0; b < N; b++) {
    const f = binFraction(b, N, K, logSpaced);
    for (let i = 0; i < 36; i++) {
      C[b * 36 + i] = f * (Cshell[i] ?? 0) + (1 - f) * (Ccore[i] ?? 0);
    }
    yieldXY[b]   = f * shellMat.yieldXY + (1 - f) * coreMat.yieldXY;
    yieldZ[b]    = f * shellMat.yieldZ  + (1 - f) * coreMat.yieldZ;
    yieldZShear[b] = f * zsShell + (1 - f) * zsCore;
    massRho[b]   = f * (shellMat.massRho ?? 0) + (1 - f) * (coreMat.massRho ?? 0);
    shellFrac[b] = f;
    // Core-fraction-weighted DFA α: pure-shell bins (f = 1) → 0 (von Mises,
    // untouched); the pure-core bin (f = 0) → the core's full foam α. First-
    // order scalar blend, consistent with the yields above. LOW confidence.
    dfaAlpha[b]  = (1 - f) * alphaCore;
  }

  const binOfElement = new Int32Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    binOfElement[e] = binForWallFrac(wallFrac[e] ?? 0, N, K, logSpaced);
  }

  return {
    field: { binCount: N, binOfElement, C, yieldXY, yieldZ, yieldZShear, massRho, shellFrac, dfaAlpha },
    averageMaterial,
    shellVolumeFraction: Vf,
    wallThicknessMm: tWall,
    ...(skin ? { skinTopThicknessMm: skin.tSkinTop, skinBotThicknessMm: skin.tSkinBot } : {}),
  };
}

/**
 * Build the wall-to-wall (bead-to-bead) bond field: per-element local
 * radial direction + "sits at an internal loop boundary" weight, for the
 * criterion-only wall-bond failure mode (see WallBondField doc). Kept as a
 * SIBLING function to buildTwoRegionField (not folded into TwoRegionResult)
 * to keep the stiffness-blend concern and the criterion-only bond concern
 * separate — this never touches C, binOfElement, or anything that crosses
 * the assembly-worker boundary.
 *
 * Returns null when there's no internal loop boundary to model
 * (wallCount < 2 or lineWidth <= 0) — the natural flag-off no-op.
 *
 * @param yieldWallMPa       Wall-to-wall tension allowable, MPa (already
 *                           scaled by the wall-to-wall bond model).
 * @param yieldWallShearMPa  Wall-to-wall shear allowable, MPa (already
 *                           scaled by the wall-to-wall bond model).
 */
/**
 * Estimate the average OUTER wall-loop perimeter length (mm): the vertical-ish
 * ("perimeter", more-than-45°-off-build-axis) boundary triangle area of the
 * OUTER contour(s) only, divided by the part's extent along the build axis. For
 * a prismatic part this is exact (perimeter area = perimeter length × height);
 * for general shapes it's a first-order average.
 *
 * Used to derive a physically-grounded inter-pass revisit time for the
 * wall-to-wall bond model: unlike interlayer (Z) bonding, where the nozzle
 * revisits a spot one Z-layer later, adjacent wall loops are typically
 * printed back-to-back — the relevant "return" is roughly the time to
 * traverse one full perimeter loop before starting the next, i.e.
 * perimeterLengthMm / printSpeedMmS.
 *
 * INTERNAL HOLE BORES ARE EXCLUDED (issue #182). The old estimate summed ALL
 * vertical boundary area, so a bolt-hole bore inflated the loop length, doubled
 * the modeled inter-pass time, and understated wall-to-wall bond strength — with
 * hole count a spurious driver. Physically a bore is a SEPARATE, short loop, not
 * part of the outer wall's return path. We separate the two here:
 *
 *   1. Group the vertical boundary triangles into connected components (shared
 *      mesh edges). The outer shell is one component; each hole bore is its own.
 *   2. For each component compute its signed projected cross-section via the
 *      divergence theorem, Σ (r_⊥ · A_⊥) = 2·(signed area)·height, using the
 *      OUTWARD triangle normals (extractSurfaceFaces / Gmsh emit outward faces).
 *      Outer contours enclose POSITIVE area; a hole's outward-of-solid normal
 *      points INTO the void, so its bore encloses NEGATIVE area. The sign is
 *      origin-independent (Σ A_⊥ = 0 over a closed band).
 *   3. Keep only components on the OUTER side (same sign as the largest-|area|
 *      component — robust to a globally flipped winding convention); drop the
 *      opposite-sign bores. Sum their area / height.
 *
 * A solid (hole-free) part is one positive component ⇒ identical to the legacy
 * sum (bit-for-bit). Adding a through-hole adds one negative component that is
 * now excluded, so the outer-loop estimate is unchanged by the hole.
 */
export function estimateWallLoopPerimeterMm(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  buildAxis: readonly [number, number, number],
): number {
  const nodes = mesh.nodes;
  const triCount = Math.floor(surfaceFaces.length / 3);
  const wlen = Math.hypot(buildAxis[0], buildAxis[1], buildAxis[2]) || 1;
  const wx = buildAxis[0] / wlen, wy = buildAxis[1] / wlen, wz = buildAxis[2] / wlen;
  const COS45 = Math.SQRT1_2;

  let pMin = Infinity, pMax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const proj = (nodes[n * 3] ?? 0) * wx + (nodes[n * 3 + 1] ?? 0) * wy + (nodes[n * 3 + 2] ?? 0) * wz;
    if (proj < pMin) pMin = proj;
    if (proj > pMax) pMax = proj;
  }
  const height = Math.max(pMax - pMin, 1e-6);

  // In-plane orthonormal basis (ex, ey) spanning the plane ⊥ buildAxis, for the
  // signed-area projection.
  const seedX = Math.abs(wx) < 0.9 ? 1 : 0, seedY = Math.abs(wx) < 0.9 ? 0 : 1, seedZ = 0;
  const sdotw = seedX * wx + seedY * wy + seedZ * wz;
  let exx = seedX - sdotw * wx, exy = seedY - sdotw * wy, exz = seedZ - sdotw * wz;
  const exlen = Math.hypot(exx, exy, exz) || 1;
  exx /= exlen; exy /= exlen; exz /= exlen;
  const eyx = wy * exz - wz * exy, eyy = wz * exx - wx * exz, eyz = wx * exy - wy * exx;

  // Collect vertical-ish triangles with their area, in-plane centroid, and
  // in-plane outward area-vector (raw cross product / 2 projected onto ex, ey).
  const vTri: number[] = [];         // global triangle indices (vertical-ish)
  const vArea: number[] = [];        // triangle area
  const vCu: number[] = [], vCv: number[] = [];   // in-plane centroid coords
  const vAu: number[] = [], vAv: number[] = [];   // in-plane area-vector coords
  for (let t = 0; t < triCount; t++) {
    const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
    const ax = nodes[na * 3] ?? 0, ay = nodes[na * 3 + 1] ?? 0, az = nodes[na * 3 + 2] ?? 0;
    const bx = nodes[nb * 3] ?? 0, by = nodes[nb * 3 + 1] ?? 0, bz = nodes[nb * 3 + 2] ?? 0;
    const cx = nodes[nc * 3] ?? 0, cy = nodes[nc * 3 + 1] ?? 0, cz = nodes[nc * 3 + 2] ?? 0;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-12) continue;
    const nDotW = (nx * wx + ny * wy + nz * wz) / nlen;
    if (Math.abs(nDotW) >= COS45) continue; // skin (floor/ceiling) face — skip
    const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
    vTri.push(t);
    vArea.push(nlen / 2);
    vCu.push(gx * exx + gy * exy + gz * exz);
    vCv.push(gx * eyx + gy * eyy + gz * eyz);
    // Area vector = (nx,ny,nz)/2 (outward); its in-plane components.
    vAu.push((nx * exx + ny * exy + nz * exz) / 2);
    vAv.push((nx * eyx + ny * eyy + nz * eyz) / 2);
  }
  const M = vTri.length;
  if (M === 0) return 0;

  // Union-find over vertical triangles sharing a mesh edge → connected loops.
  const parent = new Int32Array(M);
  for (let i = 0; i < M; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const stride = mesh.nodeCount + 1;
  const edgeOwner = new Map<number, number>();
  for (let i = 0; i < M; i++) {
    const t = vTri[i]!;
    const n0 = surfaceFaces[t * 3] ?? 0, n1 = surfaceFaces[t * 3 + 1] ?? 0, n2 = surfaceFaces[t * 3 + 2] ?? 0;
    const edges = [[n0, n1], [n1, n2], [n2, n0]];
    for (const [p, q] of edges) {
      const lo = Math.min(p!, q!), hi = Math.max(p!, q!);
      const key = lo * stride + hi;
      const owner = edgeOwner.get(key);
      if (owner === undefined) edgeOwner.set(key, i);
      else union(owner, i);
    }
  }

  // Per-component signed cross-section (Σ r_⊥·A_⊥) and total area.
  const compSigned = new Map<number, number>();
  const compArea = new Map<number, number>();
  for (let i = 0; i < M; i++) {
    const r = find(i);
    compSigned.set(r, (compSigned.get(r) ?? 0) + (vCu[i]! * vAu[i]! + vCv[i]! * vAv[i]!));
    compArea.set(r, (compArea.get(r) ?? 0) + vArea[i]!);
  }

  // Outer side = sign of the largest-|signed-area| component (robust to a
  // globally flipped winding convention). Keep components on that side; the
  // opposite-sign components are internal hole bores → excluded.
  let outerSign = 0, maxAbs = -1;
  for (const s of compSigned.values()) {
    if (Math.abs(s) > maxAbs) { maxAbs = Math.abs(s); outerSign = s >= 0 ? 1 : -1; }
  }
  let outerArea = 0;
  for (const [r, s] of compSigned) {
    if (s * outerSign >= 0) outerArea += compArea.get(r) ?? 0; // outer contour
  }
  return outerArea / height;
}

export function buildWallBondField(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  lineWidth: number,
  wallCount: number,
  yieldWallMPa: number,
  yieldWallShearMPa: number,
): WallBondField | null {
  if (lineWidth <= 0 || wallCount < 2) return null;
  const tWall = lineWidth * wallCount;
  const dMax = tWall + maxCornerEdge(mesh);
  const { dist, normal } = computeNodeSurfaceDistancesAndNormals(mesh, surfaceFaces, dMax, true);
  const wallInteriorFrac = computeWallInteriorFraction(mesh, dist, lineWidth, wallCount);
  const wallNormal = computeElementWallNormals(mesh, normal!);
  return { wallNormal, wallInteriorFrac, yieldWallMPa, yieldWallShearMPa };
}
