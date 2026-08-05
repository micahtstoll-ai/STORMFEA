/**
 * measure260.ts — the two de-risking measurements #260 asked for, before the
 * bolt-model campaign starts.
 *
 *   TETGEN_BIN=tetgen node dist/tests/measure260.js [--probe]
 *
 * See the header of the report it writes for what it measures and why.
 */
import { runAnalysis, type AnalysisRequest, type AnalysisResult } from "../analysis.js";
import { meshWithTetGen, probeTetGen } from "../tetgen.js";

const R = 6, r = 2.5, H = 5, N = 32;

/** The #256 / adaptive-benchmark fixture geometry, verbatim. */
function tubeTriangleSoup(): { positions: Float32Array; triangleCount: number } {
  const tris: Array<[number, number, number][]> = [];
  const P = (rad: number, i: number, z: number): [number, number, number] =>
    [rad * Math.cos((2 * Math.PI * i) / N), rad * Math.sin((2 * Math.PI * i) / N), z];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const ob0 = P(R, i, 0), ob1 = P(R, j, 0), ot0 = P(R, i, H), ot1 = P(R, j, H);
    const ib0 = P(r, i, 0), ib1 = P(r, j, 0), it0 = P(r, i, H), it1 = P(r, j, H);
    tris.push([ob0, ob1, ot1], [ob0, ot1, ot0]); // outer wall
    tris.push([ib0, it1, ib1], [ib0, it0, it1]); // bore wall
    tris.push([it0, ot0, ot1], [it0, ot1, it1]); // top annulus
    tris.push([ib0, ob1, ob0], [ib0, ib1, ob1]); // bottom annulus
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, c) => {
    positions[ti * 9 + k * 3 + c] = v;
  })));
  return { positions, triangleCount: tris.length };
}

/** Exterior area of the faceted tube, by region. Sets the traction magnitudes. */
function facetAreas(): { outerWall: number; boreWall: number; annuli: number; total: number } {
  const chord = (rad: number) => 2 * rad * Math.sin(Math.PI / N);
  const outerWall = N * chord(R) * H;
  const boreWall = N * chord(r) * H;
  // Two annuli, each the polygon ring area between the two faceted rings.
  const ring = (N / 2) * Math.sin((2 * Math.PI) / N) * (R * R - r * r);
  const annuli = 2 * ring;
  return { outerWall, boreWall, annuli, total: outerWall + boreWall + annuli };
}

type Variant =
  | "point" | "tapered" | "tapered-thin"
  | "contact" | "contact-mid" | "contact-wide"
  | "spread" | "edge-free" | "body-force";

const ALL_VARIANTS: readonly Variant[] = [
  "point", "tapered", "tapered-thin",
  "contact", "contact-mid", "contact-wide",
  "spread", "edge-free", "body-force",
];
/** MEASURE260_VARIANTS=point,tapered re-runs a subset without re-solving all six. */
const VARIANTS: readonly Variant[] = (() => {
  const want = (process.env["MEASURE260_VARIANTS"] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (want.length === 0) return ALL_VARIANTS;
  return ALL_VARIANTS.filter(v => want.includes(v));
})();

const AREAS = facetAreas();
/**
 * Windward ('facing') area — half the outer wall plus half the bore wall. The
 * annuli are EXCLUDED: their outward normals are ±z, so n·d is exactly 0 for a
 * +x direction and `selectPressureRegion` needs n·d > 0. Measured against the
 * area the solver logs: 133.30 mm², which this reproduces exactly.
 */
const FACING_AREA = (AREAS.outerWall + AREAS.boreWall) / 2;
const TARGET_N = 50;
/**
 * Chosen so the body force's resultant is ~TARGET_N on this part
 * (V ≈ 464.3 mm³ × 1240 kg/m³ → 5.65e-3 N per g). Physically absurd as an
 * acceleration; it exists only to put the body-force variant's stress level in
 * the same range as the other three. The solve is linear, so it changes the
 * absolute numbers and nothing about the spread.
 */
const BODY_FORCE_G = 8855;

function makeRequest(variant: Variant): AnalysisRequest {
  const { positions, triangleCount } = tubeTriangleSoup();
  const base: AnalysisRequest = {
    positions,
    triangleCount,
    fileType: "stl",
    bounds: { minX: -R, maxX: R, minY: -R, maxY: R, minZ: 0, maxZ: H },
    holes: [{
      id: 0, centre: [0, 0, H / 2], normal: [0, 0, 1], radius: r,
      confidence: 1, edgeCount: N, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    forces: [],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: { meshQuality: "coarse" },
  };

  switch (variant) {
    case "point":
      // The LEGACY model: the load lands on the extreme face in its direction
      // (|x - xmax| < 0.5 mm), and `position` is not read. 'uniform' has to be
      // stated explicitly now — an absent `loadDistribution` means
      // DEFAULT_LOAD_DISTRIBUTION ('contact_patch') since #271, so leaving it
      // off would silently make this row measure the new default instead of the
      // baseline it exists to be.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H],
        loadDistribution: "uniform",
      }] };
    case "tapered":
      // The fix under test (#260): same 50 N on the same extreme face, but
      // spread over a raised-cosine patch integrated as a consistent traction
      // instead of equal-split over a hard-edged 0.5 mm band. Default depth =
      // LOAD_PATCH_DEPTH_FRACTION of the 12 mm extent along x, so 1.8 mm.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H],
        loadDistribution: "tapered_patch",
      }] };
    case "tapered-thin":
      // A third of the default depth. The default fraction is a judgement, not
      // a measurement, so the honest question is how much of any improvement
      // is the TAPER and how much is merely a bigger patch. If a 0.6 mm
      // tapered patch — barely wider than the legacy 0.5 mm band — already
      // helps, the taper is doing the work.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H],
        loadDistribution: "tapered_patch", loadPatchDepthMm: 0.6,
      }] };
    case "contact":
      // The #271 fix at the fixture's OWN stated application point, (R,0,H) —
      // which sits exactly on the free top rim. Half the disc therefore falls
      // off the part, so this is the honest worst case for a contact patch and
      // the direct comparison against the other rows.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H],
        loadDistribution: "contact_patch",
      }] };
    case "contact-mid":
      // The same load placed mid-height, where a transverse load on a tube
      // actually acts and where the taper has part on every side of it. Under
      // every other mode this request is IDENTICAL to `contact` — that the two
      // rows differ at all is the #271 fix working.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H / 2],
        loadDistribution: "contact_patch",
      }] };
    case "contact-wide":
      // Mid-height with the radius area-matched to the `tapered` slab (~47 mm²
      // -> r = 3.9 mm). Isolates patch SHAPE from patch SIZE, the confound the
      // `tapered-thin` control exposed.
      return { ...base, forces: [{
        magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H / 2],
        loadDistribution: "contact_patch", loadPatchRadiusMm: 3.9,
      }] };
    case "spread":
      // The same resultant spread over the entire windward surface — as far as
      // the pressure API can spread a directional surface load. Still has a
      // patch edge, at the n·d = 0 equator.
      return { ...base, pressures: [{ magnitude: TARGET_N / FACING_AREA, direction: [1, 0, 0], region: "facing" }] };
    case "edge-free":
      // Uniform traction over the WHOLE exterior. A closed surface has no
      // boundary, so the loaded patch has no rim and contributes no
      // discontinuity — leaving the clamp as the only one in the model.
      return { ...base, pressures: [{ magnitude: TARGET_N / AREAS.total, direction: [1, 0, 0], region: "all" }] };
    case "body-force":
      // Edge-free by construction and through a different load path: no surface
      // patch at all. Guards against the edge-free result being an artifact of
      // applying traction to the clamped bore wall.
      return { ...base, gravity: { g: BODY_FORCE_G, direction: [1, 0, 0] } };
  }
}

/**
 * Where the peak sits in the FEA FIELD — the mesh the stress was actually
 * computed on, read out of the `includeVolumeField` payload.
 *
 * This has to come from the field rather than from `result.singularity`:
 * after #263 that payload is absent below `SINGULARITY_RATIO_REPORT`, and it
 * IS absent on most of these runs. The display projection is not a substitute
 * either — measured on the first sweep, the two disagreed on the finest two
 * edge-free meshes (display argmax on the outer rim, detector reporting
 * `constraint-edge`), because the projection smooths the field before
 * anything takes an argmax of it. `maxVonMisesMPa` remains the headline.
 */
function feaPeakLocation(res: AnalysisResult): [number, number, number] {
  const vf = res.volumeField;
  if (!vf) return [NaN, NaN, NaN];
  const nodes = new Float32Array(Buffer.from(vf.nodesB64, "base64").buffer.slice(0));
  const vm = new Float32Array(Buffer.from(vf.nodeVonMisesB64, "base64").buffer.slice(0));
  let best = -Infinity, bi = -1;
  for (let i = 0; i < vm.length; i++) {
    const v = vm[i]!;
    if (v > best) { best = v; bi = i; }
  }
  if (bi < 0) return [NaN, NaN, NaN];
  return [nodes[bi * 3] ?? NaN, nodes[bi * 3 + 1] ?? NaN, nodes[bi * 3 + 2] ?? NaN];
}

/**
 * Distance from a point to the CLAMP RIM — the two circles rad = r, z ∈ {0, H}
 * where the full-bore clamp meets the free end faces. This is the singularity
 * #260 is about, so "how far is the governing peak from it" is the number the
 * whole reading turns on, and it beats a band-membership label: measured, the
 * edge-free peak lands 0.56 mm radially outboard of the rim, which a
 * "is it on the bore wall" test calls the annulus and misses entirely.
 */
function distToClampRim([x, y, z]: [number, number, number]): number {
  if (!Number.isFinite(x)) return NaN;
  const dRad = Math.hypot(x, y) - r;
  return Math.min(Math.hypot(dRad, z - 0), Math.hypot(dRad, z - H));
}

/** Which feature of the tube a point sits on — a label for the coordinates. */
function featureAt([x, y, z]: [number, number, number]): string {
  if (!Number.isFinite(x)) return "?";
  const rad = Math.hypot(x, y);
  const onEndFace = Math.abs(z) < 0.05 || Math.abs(z - H) < 0.05;
  if (rad < r + 0.05) return onEndFace ? "clamp rim" : "clamped bore wall";
  if (rad > R - 0.05) {
    // The point load's patch is the |x - R| < 0.5 band; the 'facing' pressure
    // region instead stops at the n·d = 0 equator.
    const near = x > R - 0.5 ? "load-patch arc" : Math.abs(x) < 1.0 ? "outer wall equator" : "outer wall";
    return onEndFace ? `${near} @ rim` : near;
  }
  return onEndFace ? "end face" : "interior";
}

type Row = {
  variant: Variant; maxVol: number; elements: number;
  sf: number | null; peak: number; err: number | null;
  cause: string; peakLoc: [number, number, number]; feature: string; dClamp: number;
  bcFrac: number | undefined;
};

function fmt(n: number | null | undefined, d = 3): string {
  return n == null || !Number.isFinite(n) ? "  —  " : n.toFixed(d);
}

async function main(): Promise<void> {
  const probe = await probeTetGen();
  if (!probe.found) { console.error(`tetgen not found at ${probe.path}`); process.exit(1); }

  const { positions, triangleCount } = tubeTriangleSoup();
  const ladderCaps = (process.env["MEASURE260_CAPS"] ?? "0.09,0.045,0.022,0.012")
    .split(",").map(s => Number(s.trim())).filter(v => Number.isFinite(v) && v > 0);

  console.log(`[areas] outerWall=${AREAS.outerWall.toFixed(2)} boreWall=${AREAS.boreWall.toFixed(2)} ` +
    `annuli=${AREAS.annuli.toFixed(2)} total=${AREAS.total.toFixed(2)} mm² ` +
    `-> all-traction ${(TARGET_N / AREAS.total).toPrecision(4)} MPa, facing ${(TARGET_N / FACING_AREA).toPrecision(4)} MPa`);

  // ── Mesh ladder, built ONCE and shared by every load variant ───────────────
  // Sharing the mesh is the point: across variants the discretisation is
  // bit-identical, so any difference in the spread is the load model alone.
  const meshes: Array<{ maxVol: number; built: Awaited<ReturnType<typeof meshWithTetGen>> }> = [];
  for (const maxVol of ladderCaps) {
    const t0 = Date.now();
    const built = await meshWithTetGen(positions, triangleCount, 2, maxVol);
    meshes.push({ maxVol, built });
    console.log(`[mesh] -a${maxVol} -> ${built.mesh.elementCount} elements, ` +
      `${built.mesh.nodeCount} nodes (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  if (process.argv.includes("--probe")) return;

  const rows: Row[] = [];
  for (const variant of VARIANTS) {
    for (const { maxVol, built } of meshes) {
      const req = makeRequest(variant);
      const t0 = Date.now();
      const res: AnalysisResult = await runAnalysis({
        ...req,
        analysis: { ...req.analysis, includeVolumeField: true },
        _prebuiltMesh: {
          mesh: built.mesh, surfaceToNode: built.surfaceToNode, surfaceFaces: built.surfaceFaces,
        },
      });
      const peakLoc = feaPeakLocation(res);
      rows.push({
        variant, maxVol, elements: built.mesh.elementCount,
        sf: res.safetyFactor, peak: res.maxVonMisesMPa,
        err: res.globalRelativeError == null ? null : res.globalRelativeError * 100,
        cause: res.singularity?.cause ?? "none",
        peakLoc, feature: featureAt(peakLoc), dClamp: distToClampRim(peakLoc),
        bcFrac: res.bcSingularityErrorFraction,
      });
      const last = rows[rows.length - 1]!;
      console.log(`[run] ${variant.padEnd(10)} ${built.mesh.elementCount.toString().padStart(6)} el  ` +
        `SF ${fmt(last.sf, 2)}  peak ${fmt(last.peak)} MPa  err ${fmt(last.err, 2)}%  ` +
        `cause=${last.cause} @(${last.peakLoc.map(v => v.toFixed(2)).join(",")}) = ${last.feature}, ` +
        `d(clamp rim)=${fmt(last.dClamp, 2)}mm  ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n================ #260 de-risking measurements ================\n");
  for (const variant of VARIANTS) {
    const rs = rows.filter(r => r.variant === variant);
    console.log(`--- ${variant} ---`);
    console.log("elements | safety factor | peak vM MPa | global err % | BC err frac | singularity | d(clamp rim) | FEA peak sits on");
    for (const r of rs) {
      console.log(`${r.elements.toString().padStart(8)} | ${fmt(r.sf, 2).padStart(13)} | ${fmt(r.peak).padStart(11)} | ` +
        `${fmt(r.err, 2).padStart(12)} | ${fmt(r.bcFrac, 3).padStart(11)} | ${r.cause.padStart(11)} | ` +
        `${fmt(r.dClamp, 2).padStart(12)} | ${r.feature} (${r.peakLoc.map(v => v.toFixed(2)).join(", ")})`);
    }
    const sfs = rs.map(r => r.sf).filter((v): v is number => v != null);
    const peaks = rs.map(r => r.peak).filter(v => Number.isFinite(v));
    const spread = (a: number[]) => (Math.max(...a) - Math.min(...a)) / Math.min(...a);
    const monotone = (a: number[]) =>
      a.every((v, i) => i === 0 || v >= a[i - 1]!) || a.every((v, i) => i === 0 || v <= a[i - 1]!);
    console.log(`SF spread   ${(spread(sfs) * 100).toFixed(1)}%  (${sfs.map(v => v.toFixed(2)).join(" -> ")})` +
      `  monotone-in-element-count: ${monotone(sfs)}`);
    console.log(`peak spread ${(spread(peaks) * 100).toFixed(1)}%  (${peaks.map(v => v.toFixed(3)).join(" -> ")})` +
      `  monotone-in-element-count: ${monotone(peaks)}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
