/**
 * smooth-concentration.test.ts — the KNOWN-SMOOTH calibration anchor
 * (issues #263 and #256).
 *
 * WHY THIS FILE EXISTS
 * ====================
 * Every part this project has measured a singularity heuristic against has one:
 * the Ø5-bore tube (load-edge), the cross plate (constraint-edge), #148's point
 * spike. That is half a calibration set. A threshold fitted only to parts that
 * SHOULD trip it cannot be told apart from a threshold fitted to make those
 * parts trip it — #263 closed with exactly that gap recorded as the reason it
 * would not tune `SINGULARITY_RATIO_ALARM` any further:
 *
 *   "The honest gap is calibration data, not code: parts with a KNOWN-SMOOTH
 *    stress concentration (a generous fillet, a large hole) alongside the
 *    known-singular ones. Without both, no threshold on this ratio can be
 *    justified, only fitted."
 *
 * This is that part. A rectangular plate in uniaxial tension with a centred
 * circular through-hole — the Kirsch fixture, whose peak is a genuine stress
 * concentration (Kt ≈ 3) that is NOT singular: it has a finite limit and a mesh
 * resolves it. `solver_validation.ts` group 24 already pins its Kt against the
 * closed-form value, so this is a fixture with a known answer, not a new guess.
 *
 * It is built by `buildPlateWithHoleMesh` with no external mesher, so unlike the
 * tube and the cross plate this file needs no TetGen, never skips, and gives the
 * same element counts on every machine.
 *
 * WHAT IT ANCHORS
 * ===============
 * Measured here, four in-plane densities, everything else fixed:
 *
 *   elements   peak VM     Kt      SF      ratio   detector
 *     1 536    35.980    2.878    1.39      2.3    silent
 *     3 456    36.543    2.923    1.37      2.4    silent
 *     6 144    36.678    2.934    1.36      2.4    silent
 *     9 600    36.714    2.937    1.36      2.4    silent
 *
 * 1. **The ratio has a floor now.** A known-smooth concentration reads 2.3–2.4
 *    and STAYS there. The cross plate's known-singular constraint edge reads
 *    3.1–3.3 and wanders; #148's point spike reads 12. So `REPORT = 3.0` sits
 *    just above the smooth case and `ALARM = 6.0` well above it — for the first
 *    time those are boundaries between two measured populations rather than
 *    numbers with only one side.
 *
 *    The margin under REPORT is THIN (2.4 against 3.0) and that is worth saying
 *    plainly: a sharper-but-still-smooth feature could cross it. The alarm's
 *    margin is the comfortable one, which is consistent with #263's decision to
 *    make the 3.0 band a measurement and 6.0 the thing that shouts.
 *
 * 2. **It is #256's missing control.** That issue reports the safety factor
 *    swinging 46% (tube) and 18.9% (cross plate), non-monotonically, and asks
 *    whether the swing is constraint-specific. Two singular parts could not
 *    answer it: they had no negative case. Here the SAME solver, error estimator
 *    and recovery on a part whose peak is NOT singular give a 2.2% SF spread,
 *    MONOTONE, settling to 0.1% between the last two meshes.
 *
 *    So the swing is not a property of the solver, the mesher or stress recovery
 *    in general — a part without a singularity converges normally. That is the
 *    determination #256's second acceptance criterion asks for, and it is
 *    obtainable only from a part like this one.
 *
 * Assertions are bands and behavioural facts. The mesh is structured and
 * deterministic, so the element counts ARE reproducible (unlike the TetGen
 * fixtures) — but the stress values still carry solver tolerances, so pinning
 * them to more digits than the physics supports would be brittle for no gain.
 *
 * COST — measured ~149 s, in its own file so it runs in parallel with the other
 * long fixtures rather than after them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  detectSingularity, sampledField,
  SINGULARITY_RATIO_ALARM, SINGULARITY_RATIO_REPORT,
} from "../../analysis.js";
import { buildPlateWithHoleMesh, buildAxialConstraintsAndForces } from "../../coupon_fea.js";
import { runLinearStatic } from "../../solver/pipeline.js";
import { sprSmoothedStress6, buildGaussSamples, vonMisesFromTensor6 } from "../../solver/stress.js";
import { nodeCharacteristicSizes } from "../../solver/adaptiveMesh.js";
import type { TetMesh } from "../../solver/types.js";
import type { SingularityWarning } from "../../analysis.js";

/** Isotropic PLA-ish, matching solver_validation group 24 so the Kt is comparable. */
const MAT = { E: 3500, nu: 0.36, yieldStrength: 50, label: "kt-plate" } as const;

/**
 * W=40, T=2, L=100, hole Ø6 ⇒ d/W = 0.15. Small enough that the gross-section
 * peak approaches the infinite-plate Kirsch value of 3, which is what makes this
 * a KNOWN answer rather than merely a smooth one. Same numbers as validation
 * group 24 deliberately: the two should not be able to drift apart.
 */
const W = 40, T = 2, L = 100, R = 3;
const TOTAL_N = 1000;

/**
 * Purely IN-PLANE refinement (nThick fixed at 1). The concentration is a plane
 * phenomenon — the gradient to resolve runs around and away from the hole, not
 * through the 2 mm thickness — so spending elements on nThick doubles the solve
 * cost while refining the direction that is not under test. Measured: a ladder
 * that also raised nThick reached 17 280 elements and 311 s for a peak that had
 * already settled by 9 600 elements here.
 */
const LADDER = [
  { nTheta: 32, ns: 8,  nThick: 1, radialGrade: 2.0 },
  { nTheta: 48, ns: 12, nThick: 1, radialGrade: 2.0 },
  { nTheta: 64, ns: 16, nThick: 1, radialGrade: 2.0 },
  { nTheta: 80, ns: 20, nThick: 1, radialGrade: 2.0 },
];

interface Row {
  elements:    number;
  peak:        number;
  sf:          number;
  kt:          number;
  singularity: SingularityWarning | null;
  peakLoc:     [number, number, number];
}

/**
 * Solve one rung and run the singularity detector on it exactly as `runAnalysis`
 * does — the FEA field paired with its own coordinates, the FEA length scale,
 * and both BC rims supplied so the cause attribution is real rather than assumed.
 */
async function measure(opts: typeof LADDER[number]): Promise<Row> {
  const mesh: TetMesh = buildPlateWithHoleMesh({
    widthMm: W, thickMm: T, lengthMm: L, holeR: R, ...opts,
  });
  const { constraints, forces } = buildAxialConstraintsAndForces(mesh, 2, TOTAL_N);
  // meshGate 'warn': the hole-graded structured fixture has deliberately
  // stretched elements away from the bore, the same reason solveCouponKt
  // downgrades the gate for its Kt probes.
  const result = await runLinearStatic({ mesh, material: MAT, constraints, forces, meshGate: "warn" });

  // The one recovered nodal field (issue #258) — the tensor, projected to von
  // Mises, never an independently recovered scalar.
  const nodeStress6 = result.nodeStress6
    ?? sprSmoothedStress6(mesh, result.elemStress6!, buildGaussSamples(mesh, result.displacement, MAT));
  const vm = new Float64Array(mesh.nodeCount);
  for (let n = 0; n < mesh.nodeCount; n++) {
    vm[n] = vonMisesFromTensor6(
      nodeStress6![n * 6]     ?? 0, nodeStress6![n * 6 + 1] ?? 0, nodeStress6![n * 6 + 2] ?? 0,
      nodeStress6![n * 6 + 3] ?? 0, nodeStress6![n * 6 + 4] ?? 0, nodeStress6![n * 6 + 5] ?? 0,
    );
  }

  const ptsOf = (idx: number[]): Float64Array | null => {
    const p: number[] = [];
    for (const n of idx) p.push(mesh.nodes[n * 3] ?? 0, mesh.nodes[n * 3 + 1] ?? 0, mesh.nodes[n * 3 + 2] ?? 0);
    return p.length ? Float64Array.from(p) : null;
  };

  const singularity = detectSingularity(new Float32Array(0), new Float32Array(0), {
    bcRimPoints:   ptsOf(constraints.flatMap(c => c.nodeIndices)),
    loadRimPoints: ptsOf(forces.map(f => f.nodeIndex)),
    yieldMPa:      MAT.yieldStrength,
    feaField: {
      field:    sampledField("fea", vm, mesh.nodes),
      nodeSize: nodeCharacteristicSizes(mesh),
    },
  });

  let peak = 0, peakIdx = 0;
  for (let n = 0; n < mesh.nodeCount; n++) if (vm[n]! > peak) { peak = vm[n]!; peakIdx = n; }

  return {
    elements: mesh.elementCount,
    peak,
    sf: MAT.yieldStrength / peak,
    kt: peak / (TOTAL_N / (W * T)),          // gross-section Kt, as in group 24
    singularity,
    peakLoc: [
      mesh.nodes[peakIdx * 3] ?? 0, mesh.nodes[peakIdx * 3 + 1] ?? 0, mesh.nodes[peakIdx * 3 + 2] ?? 0,
    ],
  };
}

const spreadOf = (xs: number[]): number => (Math.max(...xs) - Math.min(...xs)) / Math.min(...xs);

describe("known-smooth concentration: plate with a hole (issues #263, #256)", () => {
  const rows: Row[] = [];

  beforeAll(async () => {
    for (const o of LADDER) rows.push(await measure(o));
    // eslint-disable-next-line no-console
    console.log("[#263 smooth]\n" + rows.map(r =>
      `  ${String(r.elements).padStart(6)} el  peak ${r.peak.toFixed(3)} MPa  Kt ${r.kt.toFixed(3)}  ` +
      `SF ${r.sf.toFixed(2)}  ratio ${r.singularity?.concentrationRatio ?? "silent"}  ` +
      `cause ${r.singularity?.cause ?? "-"}  peak@(${r.peakLoc.map(v => v.toFixed(2)).join(", ")})`
    ).join("\n"));
  }, 900_000);

  // ── Premise: this really is the textbook fixture ───────────────────────────
  it("reproduces the Kirsch concentration factor on every mesh (premise)", () => {
    // If Kt is not ≈3 then whatever is being measured below is not the known
    // case, and none of the calibration claims follow. Same 15% band as
    // solver_validation group 24, which pins this fixture independently.
    for (const r of rows) {
      expect(Math.abs(r.kt - 3.0) / 3.0, `${r.elements} el: Kt=${r.kt.toFixed(3)}`).toBeLessThan(0.15);
    }
  });

  it("puts the peak on the hole edge, away from both grips (premise)", () => {
    // The whole point is a concentration that is NOT a boundary-condition
    // artifact. The hole edge at 90° to the pull is x = ±R, z = 0; the grips are
    // at z = ±50. A peak that drifted to a grip would make this fixture measure
    // the same clamp-rim singularity as every other part in the set.
    for (const r of rows) {
      const [x, , z] = r.peakLoc;
      expect(Math.abs(Math.abs(x) - R), `${r.elements} el: peak x=${x}`).toBeLessThan(0.5);
      expect(Math.abs(z), `${r.elements} el: peak z=${z} — drifted toward a grip`).toBeLessThan(L * 0.05);
    }
  });

  it("attributes the concentration to GEOMETRY, not a boundary condition", () => {
    // Both rims are supplied to the detector, so this is the attribution logic
    // actually choosing, not an absence of alternatives.
    for (const r of rows) {
      if (r.singularity) {
        expect(r.singularity.cause, `${r.elements} el`).toBe("geometry");
      }
    }
  });

  // ── #263: the calibration lower bound ──────────────────────────────────────
  it("stays BELOW the reporting threshold on every mesh", () => {
    // Measured ratio 2.3–2.4 against REPORT = 3.0, so the detector returns null.
    // This is the anchor the threshold never had: the smooth population sits
    // below the line the singular population sits above.
    //
    // If this starts failing, the detector has begun flagging a concentration
    // that provably converges — a false positive on the one part where "false"
    // is demonstrable — and the thresholds need re-deriving, not nudging.
    for (const r of rows) {
      expect(
        r.singularity,
        `${r.elements} el: flagged a known-smooth Kt≈3 hole as singular ` +
        `(ratio ${r.singularity?.concentrationRatio}, cause ${r.singularity?.cause})`,
      ).toBeNull();
    }
  });

  it("keeps the alarm threshold clear of the smooth population", () => {
    // Belt and braces on the number that actually shouts at users. REPORT is the
    // thin margin (2.4 vs 3.0); ALARM is the one that must never be close.
    expect(SINGULARITY_RATIO_ALARM).toBeGreaterThan(SINGULARITY_RATIO_REPORT);
    expect(SINGULARITY_RATIO_ALARM / 2.4).toBeGreaterThan(2.0);
  });

  // ── #256: the control the swing investigation never had ────────────────────
  it("does NOT reproduce the safety-factor swing", () => {
    // The headline finding of this fixture. #256 measures 46% (tube) and 18.9%
    // (cross plate) across mesh ladders; here the same pipeline gives ~2%.
    //
    // Asserted as a CEILING, deliberately mirroring the cross plate's floor
    // assertion. Together they say the swing tracks the singularity and not the
    // solver: if this part ever starts swinging like the singular ones, the
    // cause is no longer the idealization and #256's conclusion needs revisiting.
    const sfs = rows.map(r => r.sf);
    expect(sfs).toHaveLength(LADDER.length);
    expect(
      spreadOf(sfs),
      `SF spread ${(spreadOf(sfs) * 100).toFixed(1)}% (${sfs.map(v => v.toFixed(2)).join(" -> ")}) — ` +
      `a part with a CONVERGING peak should not swing like the singular fixtures`,
    ).toBeLessThan(0.05);
  });

  it("converges MONOTONICALLY in peak stress, unlike the singular fixtures", () => {
    // The other half of the contrast. On the tube and the cross plate the peak
    // is non-monotone in element count — more elements is not a better number.
    // Here it climbs and settles: 35.980 -> 36.543 -> 36.678 -> 36.714.
    const peaks = rows.map(r => r.peak);
    for (let i = 1; i < peaks.length; i++) {
      expect(
        peaks[i]!,
        `peak fell from ${peaks[i - 1]!.toFixed(3)} to ${peaks[i]!.toFixed(3)} between rungs ${i - 1} and ${i} ` +
        `(${peaks.map(p => p.toFixed(3)).join(" -> ")}) — this fixture's value is that it converges monotonically`,
      ).toBeGreaterThanOrEqual(peaks[i - 1]! * 0.999);
    }
  });

  it("settles: the two finest meshes agree to well under a percent", () => {
    // Convergence proper, not merely a small spread. Measured 0.10%. A singular
    // peak cannot do this at any density — that is what makes it singular.
    const [b, a] = [rows[rows.length - 2]!.peak, rows[rows.length - 1]!.peak];
    const change = Math.abs(a - b) / b;
    expect(change, `finest two meshes differ ${(change * 100).toFixed(2)}%`).toBeLessThan(0.01);
  });
});
