/**
 * hole-radius-fit.test.ts — issue #280.
 * -------------------------------------
 * detectHoles() grid-searches candidate hole radii on a 0.5 mm ladder. Before
 * #280 the winning rung WAS the reported radius, so every STL radius was
 * quantised to a multiple of 0.5 mm — up to 0.25 mm off, which is larger than
 * classifyHole's entire MATCH_TOL (0.20 mm on the diameter). That is enough to
 * name the wrong fastener on a hole the search located perfectly: the shipped
 * demo bracket (Ø5.2) reported Ø5.0 and came back as an M6 tap drill.
 *
 * The grid search now only LOCATES; a least-squares circle fit over the wall
 * VERTICES reports. These tests lock the four things that fix depends on:
 *
 *   1. off-ladder radii come back accurate to far inside MATCH_TOL;
 *   2. the fit is over vertices, not face centroids — on coarse tessellation a
 *      centroid fit is biased inward past MATCH_TOL and would not fix anything;
 *   3. a hole straddled by two rungs is emitted ONCE, not twice;
 *   4. the guard rails hand back the grid radius and REAL residuals when the
 *      fit is untrustworthy, rather than garbage or a placeholder.
 *
 * Cheap by construction: bracket-sized plates (40x28) so each detectHoles()
 * call is ~0.2 s. Belongs in the light shard.
 */

import { describe, it, expect } from "vitest";
import { detectHoles, fitCircleLsq, acceptFitOrFallback, RTOL } from "../../holes.js";
import { classifyHole } from "../../analysis.js";
import { parseSTL } from "../../stl.js";
import { generateDemoBracket, DEMO_BRACKET } from "../../demo_part.js";

/** classifyHole's matching tolerance, on the DIAMETER (analysis.ts MATCH_TOL). */
const MATCH_TOL = 0.20;

// ── Synthetic watertight slab with one bore, same quad-ring construction as
//    demo_part.ts (so the wall facets are exactly what the real STL path sees).
//    `radial` lets a test make a non-circular bore.
function rayToRect(
  cx: number, cy: number, theta: number,
  x0: number, y0: number, x1: number, y1: number,
): [number, number] {
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let t = Infinity;
  if (dx > 1e-9)  t = Math.min(t, (x1 - cx) / dx);
  if (dx < -1e-9) t = Math.min(t, (x0 - cx) / dx);
  if (dy > 1e-9)  t = Math.min(t, (y1 - cy) / dy);
  if (dy < -1e-9) t = Math.min(t, (y0 - cy) / dy);
  return [cx + dx * t, cy + dy * t];
}

function slab(
  radial: (theta: number) => number,
  { W = 40, D = 28, T = 4, N = 48, hcx = 0, hcy = 0 } = {},
): { positions: Float32Array; triangleCount: number; plateDimMin: number } {
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2, z0 = 0, z1 = T;
  const ang = (i: number) => (i / N) * Math.PI * 2;
  const bore = Array.from({ length: N }, (_, i): [number, number] => {
    const th = ang(i), rr = radial(th);
    return [hcx + rr * Math.cos(th), hcy + rr * Math.sin(th)];
  });
  const rect = Array.from({ length: N }, (_, i) => rayToRect(hcx, hcy, ang(i), x0, y0, x1, y1));
  const P = (xy: [number, number], z: number): number[] => [xy[0], xy[1], z];
  const tris: number[][] = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cT = P(bore[i]!, z1), cTN = P(bore[j]!, z1);
    const rT = P(rect[i]!, z1), rTN = P(rect[j]!, z1);
    const cB = P(bore[i]!, z0), cBN = P(bore[j]!, z0);
    const rB = P(rect[i]!, z0), rBN = P(rect[j]!, z0);
    tris.push([...cT, ...rT, ...rTN], [...cT, ...rTN, ...cTN],
              [...cB, ...rBN, ...rB], [...cB, ...cBN, ...rBN],
              [...rB, ...rBN, ...rTN], [...rB, ...rTN, ...rT],
              [...cB, ...cT, ...cTN], [...cB, ...cTN, ...cBN]);
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => positions.set(t, i * 9));
  return { positions, triangleCount: tris.length, plateDimMin: Math.min(W, D) };
}

const circularBore = (r: number, opts?: Parameters<typeof slab>[1]) => slab(() => r, opts);

/** Points on an exact circle — for the fit/guard-rail unit tests. */
function circlePts(
  R: number, cx: number, cy: number, n: number, noise = 0,
): [number[], number[]] {
  // Fixed LCG: noisy cases must be deterministic or the guard-rail thresholds
  // they straddle would make the test flaky.
  let s = 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  const px: number[] = [], py: number[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2, rr = R + noise * rnd();
    px.push(cx + rr * Math.cos(th)); py.push(cy + rr * Math.sin(th));
  }
  return [px, py];
}

// ─────────────────────────────────────────────────────────────────────────────
describe("#280 detected radius is fitted, not snapped to the 0.5 mm ladder", () => {
  // 2.6 and 3.7 sit as far off the ladder as it gets (0.1 and 0.2 from a rung),
  // and 2.6 is the demo parts' real radius. 4.3 is 0.2 off in the other
  // direction. All were reported as the neighbouring rung before #280.
  it.each([[1.6], [2.6], [3.7], [4.3]])(
    "recovers r=%f to far inside MATCH_TOL", (r) => {
      const s = circularBore(r);
      const holes = detectHoles(s.positions, s.triangleCount);
      expect(holes).toHaveLength(1);
      const h = holes[0]!;
      // Not merely inside MATCH_TOL — three orders of magnitude inside it. The
      // residual error here is the float32 STL round-trip, nothing else.
      expect(Math.abs(h.radius * 2 - r * 2)).toBeLessThan(MATCH_TOL / 100);
      // And explicitly NOT the grid answer it used to be.
      expect(Math.abs(h.radius - Math.round(h.radius / 0.5) * 0.5)).toBeGreaterThan(0.05);
      // Centre accuracy was never the bug — assert it did not regress.
      expect(Math.hypot(h.centre[0], h.centre[1])).toBeLessThan(1e-3);
    });

  it("emits a rung-straddled hole ONCE (both 3.5 and 4.0 match a 3.7 bore)", () => {
    // Every wall face of a 3.7 mm bore is within RTOL (0.4) of the 3.5 rung AND
    // within RTOL of the 4.0 rung, so the search produces both candidates at the
    // same centre. The dedup test is |k.r - c.r| < 0.5, and |3.5 - 4.0| = 0.5 is
    // NOT < 0.5 — so on grid radii the pristine code emitted this hole twice
    // (measured; likewise for 2.15, 3.3, 4.2 and 13.7 mm bores). Both radii are
    // now the fitted 3.7, which collapses them.
    const s = circularBore(3.7);
    const holes = detectHoles(s.positions, s.triangleCount);
    expect(holes).toHaveLength(1);
    expect(holes[0]!.radius).toBeCloseTo(3.7, 3);
  });

  it("reports measured residuals, not the old hardcoded 0.05 / 0.1", () => {
    // A clean CAD bore has essentially zero residual. The placeholders claimed
    // 0.05 mm rms / 0.1 mm max on every hole ever detected, which made a bad
    // detection indistinguishable from a perfect one.
    const s = circularBore(2.6);
    const clean = detectHoles(s.positions, s.triangleCount);
    expect(clean).toHaveLength(1);
    expect(clean[0]!.rmsError).toBeLessThan(1e-4);
    expect(clean[0]!.maxDeviation).toBeLessThan(1e-4);

    // A lobed (out-of-round) bore must report residuals that track the lobe.
    const lobe = (a: number) => {
      const s = slab((th) => 2.6 + a * Math.cos(3 * th));
      const h = detectHoles(s.positions, s.triangleCount);
      expect(h).toHaveLength(1);
      return h[0]!;
    };
    const small = lobe(0.05), big = lobe(0.10);
    expect(small.rmsError).toBeGreaterThan(1e-3);
    expect(big.rmsError).toBeGreaterThan(small.rmsError * 1.5);   // doubles with the lobe
    expect(big.maxDeviation).toBeGreaterThan(big.rmsError);
    for (const h of [small, big]) {
      expect(Number.isFinite(h.rmsError)).toBe(true);
      expect(Number.isFinite(h.maxDeviation)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#280 the fit is over wall VERTICES, not face centroids", () => {
  it("a centroid fit is biased past MATCH_TOL on a coarse bore; the vertex fit is not", () => {
    // A facet's chord lies inside the nominal cylinder, so its centroid sits in
    // by the sagitta: |centroid| / R = sqrt(5 + 4 cos dTheta) / 3 for the
    // quad-ring split used here. At 8 segments that is 0.9326 — a 6.7% low
    // radius. The vertices are ON the cylinder, which is why refineCandidate
    // keeps them. This test is the justification for carrying vertices in WF.
    const R = 2.6, N = 8;
    const s = circularBore(R, { N });

    // What a centroid fit would have given: collect the wall-face centroids the
    // same way detectHoles does (|nz| < 0.15) and fit those instead.
    const p = s.positions;
    const cx: number[] = [], cy: number[] = [];
    for (let t = 0; t < s.triangleCount; t++) {
      const b = t * 9;
      const x0 = p[b]!, y0 = p[b + 1]!, z0 = p[b + 2]!;
      const x1 = p[b + 3]!, y1 = p[b + 4]!, z1 = p[b + 5]!;
      const x2 = p[b + 6]!, y2 = p[b + 7]!, z2 = p[b + 8]!;
      const ex1 = x1 - x0, ey1 = y1 - y0, ez1 = z1 - z0;
      const ex2 = x2 - x0, ey2 = y2 - y0, ez2 = z2 - z0;
      const nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
      const L = Math.hypot(nx, ny, nz);
      if (L < 1e-10 || Math.abs(nz / L) > 0.15) continue;
      const gx = (x0 + x1 + x2) / 3, gy = (y0 + y1 + y2) / 3;
      if (Math.hypot(gx, gy) < R * 1.5) { cx.push(gx); cy.push(gy); }  // bore wall only
    }
    const centroidFit = fitCircleLsq(cx, cy);
    expect(centroidFit).not.toBeNull();
    // 2.4249 vs 2.6 — a 0.35 mm diameter error, comfortably OUTSIDE MATCH_TOL.
    expect(Math.abs(centroidFit!.r * 2 - R * 2)).toBeGreaterThan(MATCH_TOL);

    // The shipped vertex fit gets it right on the same mesh.
    const holes = detectHoles(s.positions, s.triangleCount);
    expect(holes).toHaveLength(1);
    expect(Math.abs(holes[0]!.radius * 2 - R * 2)).toBeLessThan(MATCH_TOL / 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#280 ground truth: the shipped demo bracket", () => {
  it("reports the true Ø5.2 and no longer identifies an M6 tap drill", () => {
    const truthR = DEMO_BRACKET.holeDiamMm / 2;   // 2.6
    const stl = parseSTL(generateDemoBracket());
    const holes = detectHoles(stl.positions, stl.triangleCount);
    expect(holes).toHaveLength(1);
    const h = holes[0]!;

    // Was 2.5 (the grid rung, 0.1 mm low). Now the truth.
    expect(h.radius).toBeCloseTo(truthR, 5);
    expect(h.centre[0]).toBeCloseTo(DEMO_BRACKET.holeOffsetXMm, 6);

    const cls = classifyHole(h.radius, DEMO_BRACKET.depthMm);
    expect(cls.detectedDiamMm).toBeCloseTo(DEMO_BRACKET.holeDiamMm, 5);

    // The pre-#280 answer was M6 / tapped_75 — Ø5.00 is exactly the M6 75%
    // tap drill. A tapped classification is what gates the thread strip-out
    // check, so the quantisation was not cosmetic.
    expect(cls.type).not.toBe("tapped_75");
    expect(cls.bolt?.label).not.toBe("M6");

    // At the true Ø5.2 the nearest standard hole is the #10 close clearance
    // (5.16), 0.04 mm away. #10-24 and #10-32 share that clearance figure —
    // issue #290 fixed classifyHole to collapse that pair instead of
    // reporting a phantom "#10-24 vs #10-32" ambiguity no measurement could
    // ever resolve (see classify-hole-clearance-collapse.test.ts). This hole
    // still comes back "ambiguous", but now for a real reason: M6's
    // 50%-thread tap drill (5.25) is a genuinely different candidate only
    // 0.01mm further away than the #10 clearance match. That is NOT the #280
    // radius-fit defect this file covers, and NOT the #290 twin-duplicate
    // defect either — it is a separate, pre-existing property of the
    // ambiguity band, tracked on its own.
    expect(cls.type).toBe("ambiguous");
    expect(cls.bolt?.label).toBe("#10-24");
    expect(cls.warning).not.toContain("#10-32");
    expect(cls.warning).toContain("M6");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#280 circle fit and its guard rails", () => {
  it("is exact on exact samples and returns null on degenerate ones", () => {
    const fit = fitCircleLsq(...circlePts(2.6, 1, -2, 64));
    expect(fit).not.toBeNull();
    expect(fit!.r).toBeCloseTo(2.6, 12);
    expect(fit!.cx).toBeCloseTo(1, 12);
    expect(fit!.cy).toBeCloseTo(-2, 12);
    expect(fit!.rms).toBeLessThan(1e-12);

    expect(fitCircleLsq([0, 1, 2, 3], [0, 1, 2, 3])).toBeNull();   // collinear
    expect(fitCircleLsq([0, 1], [0, 1])).toBeNull();               // fewer than 3
    expect(fitCircleLsq([], [])).toBeNull();
  });

  it("keeps a good fit and moves the centre with it", () => {
    const [px, py] = circlePts(2.6, 0, 0, 64);
    const out = acceptFitOrFallback(px, py, 0.01, 0.01, 2.5);
    expect(out.r).toBeCloseTo(2.6, 10);
    expect(out.cx).toBeCloseTo(0, 10);
    expect(out.rms).toBeLessThan(1e-12);
  });

  // Each of these must fall back to the GRID radius — the search's answer — and
  // never to NaN, Infinity, or a runaway fit. Unreachable through detectHoles
  // on any mesh the grid search accepts, which is why they are driven directly.
  it.each([
    ["fit runs away in radius", ...circlePts(3.4, 0, 0, 64)],
    ["fit runs away in centre", ...circlePts(2.5, 1.2, 0, 64)],
    ["samples are not a circle", ...circlePts(2.6, 0, 0, 64, 0.9)],
    ["samples are collinear", [0, 1, 2, 3], [0, 1, 2, 3]],
  ] as [string, number[], number[]][])(
    "falls back to the grid radius when %s", (_name, px, py) => {
      const out = acceptFitOrFallback(px, py, 0, 0, 2.5);
      expect(out.r).toBe(2.5);
      expect(out.cx).toBe(0);
      expect(out.cy).toBe(0);
      // Residuals are measured about the circle actually returned, so a refused
      // fit reports a LARGE error rather than the old 0.05/0.1 fiction.
      expect(out.rms).toBeGreaterThan(RTOL / 2);
      expect(Number.isFinite(out.rms)).toBe(true);
      expect(Number.isFinite(out.maxDev)).toBe(true);
      expect(out.maxDev).toBeGreaterThanOrEqual(out.rms);
    });

  it("rejects vertices belonging to a neighbouring feature", () => {
    // The sample band exists so a facet that is in the candidate's annulus by
    // its centroid cannot drag the fit with a vertex that is somewhere else.
    // A keyway cut 0.8 mm into the bore wall puts five facets' vertices well
    // outside the band: they are dropped, and the reported circle is still the
    // real Ø5.2 bore rather than an average of bore and keyway.
    const keyed = slab((th) => (th < (5 / 48) * Math.PI * 2 ? 2.6 + 0.8 : 2.6));
    const holes = detectHoles(keyed.positions, keyed.triangleCount);
    expect(holes.length).toBeGreaterThanOrEqual(1);
    const bore = holes.find(h => Math.abs(h.radius - 2.6) < 0.2);
    expect(bore).toBeDefined();
    expect(bore!.radius).toBeCloseTo(2.6, 4);
    expect(bore!.rmsError).toBeLessThan(1e-4);
  });
});
