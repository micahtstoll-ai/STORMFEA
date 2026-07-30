/**
 * coupon_fea.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FEA-in-the-loop calibration support.
 *
 * THE PROBLEM
 * -----------
 * Calibration converts a measured failure FORCE into a material STRENGTH.
 * The naive conversion is nominal stress: S = F / A. That is correct only when
 * the stress is uniform across the section the force passes through — which is
 * true for a well-designed tensile dog-bone failing mid-gauge, but NOT for the
 * lap-shear or bearing coupons, whose load paths concentrate stress at overlap
 * ends and hole edges.
 *
 * Why it matters: STORMFEA predicts real parts with FEA, which reports the
 * PEAK stress (including concentrations). If the material allowable was derived
 * from NOMINAL stress (F/A) but parts are checked against PEAK stress, the two
 * are measured differently and shear/bearing-governed predictions come out
 * biased non-conservative. To stay consistent, the allowable must be peak-based
 * too — i.e. extracted with the same solver that evaluates parts.
 *
 * THE METHOD
 * ----------
 * Run the coupon through the existing linear solver at a reference load, read
 * the peak von Mises in the failure region, and divide by the nominal von Mises
 * at that same load. Because the solver is LINEAR, stress scales with load, so
 * this ratio — the stress-concentration factor Kt — is a pure geometry/anisotropy
 * number, independent of the load magnitude:
 *
 *     Kt = peakVonMises(FEA) / nominalVonMises
 *
 * The peak-based allowable is then:
 *
 *     S_true = Kt · (F_fail / A_nominal)
 *
 * For a uniform tensile gauge Kt → 1 and this reduces exactly to F/A, which is
 * why the tensile coupon keeps the plain F/A path. lap-shear and bearing get
 * Kt > 1 from the solver.
 *
 * This module deliberately reuses runLinearStatic (the same entry point that
 * evaluates real parts) rather than re-deriving stresses by hand — that reuse
 * is the whole point: the calibration and the prediction share one stress engine.
 *
 * ACCURACY / NOISE FLOOR
 * ----------------------
 * The boundary-condition API only supports fully-fixed nodes (all 3 DOF), so the
 * gripped end is clamped rather than a free-contracting roller. Clamping blocks
 * Poisson contraction and leaves a small triaxial stress bump near the fixed end;
 * point-load application leaves another near the loaded end. Both decay inward
 * (Saint-Venant), so the gauge window must exclude the ends. Even so, a perfectly
 * uniform reference bar returns Kt ≈ 1.05 rather than 1.00 with the default mesh
 * density — that ~5% is the method's noise floor. Practical consequence: trust Kt
 * signals comfortably above the floor (bearing/lap-shear concentrations are
 * typically 1.3–2.5×); do NOT read meaning into Kt differences under ~10%.
 *
 * Note: the solver DOES support per-DOF (roller) constraints via
 * FixedNodeSet.fixedAxes (used by the simply-supported-beam validation), so a
 * z-only roller grip that permits Poisson contraction is possible. It was tried
 * and does NOT tighten this floor — the gauge window (gripFraction) already
 * excludes the grip zone where the clamp artifact lives, so the reported Kt is
 * unchanged (1.059 clamped vs roller) and the residual is dominated by
 * load-application/discretization. The floor is therefore inherent to the
 * coupon-FEA method rather than a missing solver feature.
 */

import type { AnyMaterial, TetMesh, FixedNodeSet, PointForce } from "./solver/types.js";
import { runLinearStatic } from "./solver/pipeline.js";
import { generateBoxMesh } from "./solver/meshgen.js";

/** Axis index: 0 = x, 1 = y, 2 = z. */
export type Axis = 0 | 1 | 2;

export interface AxialLoadCase {
  /** Total force (N) applied along `axis` at the high-coordinate end face. */
  totalForceN: number;
  /** Axis the force is applied along. */
  axis: Axis;
  /** Cross-sectional area (mm²) carrying the nominal stress. */
  nominalAreaMm2: number;
  /**
   * Fraction of the span (along `axis`) at each end treated as grip/load zone
   * and EXCLUDED from the peak-stress measurement, to avoid Saint-Venant
   * load-application artifacts. 0.2 keeps the central 60% as the gauge.
   */
  gripFraction: number;
  /**
   * If true the nominal stress is treated as pure shear (von Mises = √3·τ);
   * if false, as uniaxial normal stress (von Mises = σ). Tensile/bearing use
   * false; interlaminar lap-shear uses true.
   */
  shear: boolean;
}

/** Max von Mises over elements whose centroid lies within [lo, hi] on `axis`. */
export function regionalPeakVonMises(
  mesh: TetMesh,
  vonMises: Float64Array,
  axis: Axis,
  lo: number,
  hi: number,
): number {
  const npe = mesh.nodesPerElem;
  let peak = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    // Centroid coordinate on `axis` (corner nodes only — sufficient for C3D4/C3D10).
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const node = mesh.elements[e * npe + k]!;
      c += mesh.nodes[node * 3 + axis]!;
    }
    c /= 4;
    if (c < lo || c > hi) continue;
    const vm = vonMises[e] ?? 0;
    if (vm > peak) peak = vm;
  }
  return peak;
}

/**
 * Build the constraint + force sets for an axial pull: fix the low-coordinate
 * end face on `axis`, apply `totalForceN` spread evenly over the high end face.
 *
 * The grip face is fully clamped. A per-DOF roller grip (fixing only the axial
 * DOF; the solver supports this via FixedNodeSet.fixedAxes, exercised by the
 * simply-supported-beam validation) was tried to relieve Poisson clamping, but
 * it leaves the gauge-window Kt unchanged (measured 1.059 either way): the
 * clamp artifact decays within the excluded grip zone, so the residual ~5%
 * floor is dominated by load-application/discretization, not the grip — see the
 * ACCURACY / NOISE FLOOR note above. The clamp is therefore kept (a roller adds
 * point-anchor concentrations with no gauge-window benefit).
 */
export function buildAxialConstraintsAndForces(
  mesh: TetMesh,
  axis: Axis,
  totalForceN: number,
): { constraints: FixedNodeSet[]; forces: PointForce[]; loMin: number; loMax: number } {
  let amin = Infinity, amax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const v = mesh.nodes[n * 3 + axis]!;
    if (v < amin) amin = v;
    if (v > amax) amax = v;
  }
  const span = amax - amin || 1;
  const tol = span * 1e-3;

  const fixedNodes: number[] = [];
  const loadNodes: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const v = mesh.nodes[n * 3 + axis]!;
    if (v <= amin + tol) fixedNodes.push(n);
    else if (v >= amax - tol) loadNodes.push(n);
  }

  const perNode = loadNodes.length > 0 ? totalForceN / loadNodes.length : 0;
  const dir: [number, number, number] = [0, 0, 0];
  dir[axis] = 1;

  const forces: PointForce[] = loadNodes.map(n => ({
    nodeIndex: n,
    forceN: [dir[0] * perNode, dir[1] * perNode, dir[2] * perNode] as const,
  }));

  return {
    constraints: [{ nodeIndices: fixedNodes }],
    forces,
    loMin: amin,
    loMax: amax,
  };
}

export interface KtResult {
  Kt: number;
  peakVonMisesMPa: number;
  nominalVonMisesMPa: number;
  converged: boolean;
}

/**
 * Compute the stress-concentration factor Kt for a coupon mesh under an axial
 * load case, using the production solver. Kt = peak / nominal (von Mises).
 */
export async function solveCouponKt(
  mesh: TetMesh,
  material: AnyMaterial,
  lc: AxialLoadCase,
): Promise<KtResult> {
  const { constraints, forces, loMin, loMax } =
    buildAxialConstraintsAndForces(mesh, lc.axis, lc.totalForceN);

  // Coupon Kt probes run on controlled, deliberately hole-graded structured
  // fixtures; downgrade the mesh hard gate (issue #166) to a warning so the
  // intentional near-bore grading doesn't abort the internal calibration solve.
  const result = await runLinearStatic({ mesh, material, constraints, forces, meshGate: 'warn' });

  const span = loMax - loMin;
  const gaugeLo = loMin + span * lc.gripFraction;
  const gaugeHi = loMax - span * lc.gripFraction;
  const peakVM = regionalPeakVonMises(mesh, result.vonMises, lc.axis, gaugeLo, gaugeHi);

  // Nominal von Mises of the applied load at the carrying section.
  const nominalNormal = lc.totalForceN / lc.nominalAreaMm2;     // σ or τ
  const nominalVM = lc.shear ? Math.sqrt(3) * nominalNormal : nominalNormal;

  const Kt = nominalVM > 1e-9 ? peakVM / nominalVM : 1;
  return {
    Kt,
    peakVonMisesMPa: peakVM,
    nominalVonMisesMPa: nominalVM,
    converged: result.converged,
  };
}

/**
 * Canonical uniform reference: a straight prismatic gauge bar. Used both as a
 * test fixture (Kt must come out ≈ 1) and as the "what a perfectly uniform
 * coupon looks like" baseline. Loaded along Z.
 *
 *   width  → x   (mm)
 *   thick  → y   (mm)
 *   length → z   (mm)
 */
export function buildGaugeBoxMesh(
  widthMm: number,
  thickMm: number,
  lengthMm: number,
  divPerMmInv = 1.5,
): TetMesh {
  const nx = Math.max(2, Math.round(widthMm / divPerMmInv));
  const ny = Math.max(2, Math.round(thickMm / divPerMmInv));
  const nz = Math.max(6, Math.round(lengthMm / divPerMmInv));
  return generateBoxMesh(0, 0, 0, widthMm, thickMm, lengthMm, nx, ny, nz);
}

/**
 * Structured C3D10 mesh of a rectangular plate with a centred circular through-
 * hole — the classic "plate with a hole" fixture for the Kt ≈ 3.0 stress-
 * concentration benchmark (Kirsch). Built directly (no external mesher) so the
 * benchmark runs everywhere, including CI without TetGen/Gmsh.
 *
 * Geometry (centred at the origin):
 *   width  W → x ∈ [−W/2, W/2]
 *   thick  T → y ∈ [0, T]       (thin; hole axis is along y, through the plate)
 *   length L → z ∈ [−L/2, L/2]  (uniaxial tension is applied along z)
 * A hole of radius `holeR` is centred on the z–x plane at x = z = 0.
 *
 * Topology is a single O-grid (butterfly-free) annulus: the inner ring is the
 * hole edge, the outer ring is the rectangle, connected by `ns` graded radial
 * layers (clustered toward the hole for edge resolution) and `nTheta`
 * circumferential divisions, extruded `nThick` cells through the thickness. Each
 * curved hex cell uses the same conforming 6-tet body-diagonal split as
 * generateBoxMeshC3D10, so all tets have positive volume and mid-side nodes on
 * shared faces are identical.
 *
 * For a small hole-to-width ratio the peak σ_zz at the hole edge approaches
 * 3× the far-field (gross-section) stress — the value the benchmark checks.
 */
export function buildPlateWithHoleMesh(opts: {
  widthMm:  number;
  thickMm:  number;
  lengthMm: number;
  holeR:    number;
  nTheta?:  number;
  ns?:      number;
  nThick?:  number;
  radialGrade?: number;
}): TetMesh {
  const { widthMm: W, thickMm: T, lengthMm: L, holeR: r } = opts;
  const nTheta = Math.max(16, opts.nTheta ?? 48);
  const ns     = Math.max(4,  opts.ns ?? 10);
  const nThick = Math.max(1,  opts.nThick ?? 2);
  const grade  = opts.radialGrade ?? 1.8; // >1 clusters radial layers at the hole

  const Nrad = ns + 1;      // nodes per ray (inner hole → outer rectangle)
  const Ny   = nThick + 1;  // nodes through thickness
  const cornerPerLayer = nTheta * Nrad;
  const cornerCount = cornerPerLayer * Ny;

  // Ray/rectangle intersection for a centred rectangle [−W/2,W/2]×[−L/2,L/2]
  // (x = cosθ scaled, z = sinθ scaled).
  const outerPoint = (ct: number, st: number): [number, number] => {
    const tx = Math.abs(ct) > 1e-12 ? (W / 2) / Math.abs(ct) : Infinity;
    const tz = Math.abs(st) > 1e-12 ? (L / 2) / Math.abs(st) : Infinity;
    const t = Math.min(tx, tz);
    return [t * ct, t * st];
  };

  const cornerNodes = new Float64Array(cornerCount * 3);
  const cornerIdx = (iTheta: number, is: number, iy: number): number =>
    iy * cornerPerLayer + (iTheta % nTheta) * Nrad + is;

  for (let iy = 0; iy < Ny; iy++) {
    const y = (T * iy) / nThick;
    for (let it = 0; it < nTheta; it++) {
      const theta = (2 * Math.PI * it) / nTheta;
      const ct = Math.cos(theta), st = Math.sin(theta);
      const inX = r * ct, inZ = r * st;
      const [outX, outZ] = outerPoint(ct, st);
      for (let is = 0; is < Nrad; is++) {
        const frac = Math.pow(is / ns, grade); // 0 at hole, 1 at rectangle
        const x = inX + frac * (outX - inX);
        const z = inZ + frac * (outZ - inZ);
        const n = cornerIdx(it, is, iy);
        cornerNodes[n * 3]     = x;
        cornerNodes[n * 3 + 1] = y;
        cornerNodes[n * 3 + 2] = z;
      }
    }
  }

  const elementCount = nTheta * ns * nThick * 6;
  const elemConnFlat = new Int32Array(elementCount * 10);
  let ei = 0;

  const midMap = new Map<number, number>();
  let nextMidIdx = cornerCount;
  const midXYZ: number[] = [];
  const getMid = (a: number, b: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * (cornerCount + 1) + hi;
    let idx = midMap.get(key);
    if (idx !== undefined) return idx;
    idx = nextMidIdx++;
    midMap.set(key, idx);
    const ax = cornerNodes[a * 3]!, ay = cornerNodes[a * 3 + 1]!, az = cornerNodes[a * 3 + 2]!;
    const bx = cornerNodes[b * 3]!, by = cornerNodes[b * 3 + 1]!, bz = cornerNodes[b * 3 + 2]!;
    midXYZ.push((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    return idx;
  };

  for (let iy = 0; iy < nThick; iy++) {
    for (let it = 0; it < nTheta; it++) {   // periodic in θ (it+1 wraps)
      for (let is = 0; is < ns; is++) {
        const v0 = cornerIdx(it,   is,   iy);
        const v1 = cornerIdx(it+1, is,   iy);
        const v2 = cornerIdx(it+1, is+1, iy);
        const v3 = cornerIdx(it,   is+1, iy);
        const v4 = cornerIdx(it,   is,   iy+1);
        const v5 = cornerIdx(it+1, is,   iy+1);
        const v6 = cornerIdx(it+1, is+1, iy+1);
        const v7 = cornerIdx(it,   is+1, iy+1);
        const tets: [number, number, number, number][] = [
          [v0, v6, v1, v2],
          [v0, v6, v2, v3],
          [v0, v6, v3, v7],
          [v0, v6, v7, v4],
          [v0, v6, v4, v5],
          [v0, v6, v5, v1],
        ];
        for (const [n0, n1, n2, n3] of tets) {
          const base = ei * 10;
          elemConnFlat[base]     = n0;
          elemConnFlat[base + 1] = n1;
          elemConnFlat[base + 2] = n2;
          elemConnFlat[base + 3] = n3;
          elemConnFlat[base + 4] = getMid(n0, n1);
          elemConnFlat[base + 5] = getMid(n1, n2);
          elemConnFlat[base + 6] = getMid(n0, n2);
          elemConnFlat[base + 7] = getMid(n0, n3);
          elemConnFlat[base + 8] = getMid(n1, n3);
          elemConnFlat[base + 9] = getMid(n2, n3);
          ei++;
        }
      }
    }
  }

  const midCount = midXYZ.length / 3;
  const nodeCount = cornerCount + midCount;
  const nodes = new Float64Array(nodeCount * 3);
  nodes.set(cornerNodes);
  for (let m = 0; m < midXYZ.length; m++) nodes[cornerCount * 3 + m] = midXYZ[m]!;

  return { nodes, elements: elemConnFlat, nodeCount, elementCount, nodesPerElem: 10 };
}

/**
 * Bearing coupon geometry needed to build its Kt probe. This is a structural
 * subset of `COUPON_DIMS.bearing` (server/analysis.ts) — the single source of
 * truth for coupon dimensions. Passed in by the caller (dependency injection)
 * so this module stays free of an `analysis.ts` import cycle; callers MUST
 * source the numbers from `COUPON_DIMS.bearing`, never hard-code them.
 */
export interface BearingCouponGeom {
  holeDiamMm:    number;
  plateWidthMm:  number;
  plateThickMm:  number;
  plateLengthMm: number;
}

/** Mesh-density knobs for a plate-with-hole Kt probe (defaults = standard tier). */
export interface KtProbeMeshOpts {
  nTheta?:      number;
  ns?:          number;
  nThick?:      number;
  radialGrade?: number;
}

/**
 * Build the BEARING-coupon Kt probe: the plate-with-hole fixture at the coupon's
 * own geometry (from `COUPON_DIMS.bearing`), loaded in far-field tension along
 * its length.
 *
 * WHY OPEN-HOLE TENSION (an honest first-order proxy)
 * ---------------------------------------------------
 * A bearing coupon fails with a bolt shaft pressing on the hole WALL, but the
 * only load the plate-with-hole fixture can apply is far-field tension: the
 * axial-pull BC helper (`buildAxialConstraintsAndForces`) clamps one end face
 * and pulls the other, and no contact/bearing BC exists in the solver. So we do
 * NOT claim to reproduce the bearing load. Instead we extract the OPEN-HOLE
 * TENSION stress-concentration factor and use it as a FIRST-ORDER proxy for the
 * bearing concentration: both peak at the bore, both are O(2–3), and this is the
 * concentration the fixture can resolve honestly. It replaces the previous
 * hole-less solid bar whose Kt ≈ 1 made the bearing correction a silent no-op
 * (issue #139). Downstream (`backCalculateProfile`) multiplies this factor into
 * the bearing nominal F/(d·t); conflating a tension SCF with a bearing nominal
 * is the deliberate approximation, not an exact identity.
 *
 * NOMINAL REFERENCE — NET SECTION
 * -------------------------------
 * Nominal stress is referenced to the NET ligament section (W−d)·t (the material
 * that actually carries the pull past the hole), so the reported Kt is the
 * net-section open-hole SCF (≈2.3 for this coupon's d/W ≈ 0.16). The hole is
 * centred (the fixture centres it); the coupon's edge distance is not modelled
 * because it does not enter an open-hole tension SCF.
 */
export function buildBearingKtProbe(
  geom: BearingCouponGeom,
  meshOpts: KtProbeMeshOpts = {},
): { mesh: TetMesh; loadCase: AxialLoadCase } {
  const W = geom.plateWidthMm;
  const T = geom.plateThickMm;
  const L = geom.plateLengthMm;
  const r = geom.holeDiamMm / 2;

  const mesh = buildPlateWithHoleMesh({
    widthMm:  W,
    thickMm:  T,
    lengthMm: L,
    holeR:    r,
    nTheta:      meshOpts.nTheta      ?? 48,
    ns:          meshOpts.ns          ?? 12,
    nThick:      meshOpts.nThick      ?? 2,
    radialGrade: meshOpts.radialGrade ?? 2.0,
  });

  // Net-section area of the ligament beside the hole (see doc comment).
  const netAreaMm2 = (W - geom.holeDiamMm) * T;

  const loadCase: AxialLoadCase = {
    totalForceN:   1000,   // linear solve ⇒ Kt is load-independent
    axis:          2,      // pull along length (z)
    nominalAreaMm2: netAreaMm2,
    gripFraction:  0.30,   // exclude clamped/loaded ends (Saint-Venant)
    shear:         false,  // open-hole tension: nominal is uniaxial σ
  };
  return { mesh, loadCase };
}
