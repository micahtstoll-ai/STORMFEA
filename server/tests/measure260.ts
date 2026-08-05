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

type Variant = "point" | "spread" | "edge-free" | "body-force";

const VARIANTS: readonly Variant[] = ["point", "spread", "edge-free", "body-force"];

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
      // The #256 fixture exactly: a 50 N nodal load, which analysis.ts lands on
      // the extreme face in the load direction (|x - xmax| < 0.5 mm) — NOT at
      // `position`, which the force path never reads.
      return { ...base, forces: [{ magnitude: TARGET_N, direction: [1, 0, 0], position: [R, 0, H] }] };
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
 * Where the surface stress peak sits, from the display-mesh projection.
 *
 * `result.singularity` would carry `peakLocation` directly, but after #263 the
 * payload is absent below `SINGULARITY_RATIO_REPORT` and it IS absent on most
 * of these runs — so the location has to come from the field itself. This is
 * the display projection, not the FEA peak, so it locates the peak's FEATURE
 * (load patch / bore rim / outer wall), which is all it is read for here.
 * `maxVonMisesMPa` remains the headline magnitude.
 */
function surfacePeakLocation(res: AnalysisResult, positions: Float32Array): [number, number, number] {
  let best = -Infinity, bi = -1;
  for (let i = 0; i < res.vertexStress.length; i++) {
    const v = res.vertexStress[i]!;
    if (v > best) { best = v; bi = i; }
  }
  if (bi < 0) return [NaN, NaN, NaN];
  return [positions[bi * 3] ?? NaN, positions[bi * 3 + 1] ?? NaN, positions[bi * 3 + 2] ?? NaN];
}

type Row = {
  variant: Variant; maxVol: number; elements: number;
  sf: number | null; peak: number; err: number | null;
  cause: string; peakLoc: [number, number, number]; ratio: number | null;
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
        _prebuiltMesh: {
          mesh: built.mesh, surfaceToNode: built.surfaceToNode, surfaceFaces: built.surfaceFaces,
        },
      });
      const s = res.singularity;
      rows.push({
        variant, maxVol, elements: built.mesh.elementCount,
        sf: res.safetyFactor, peak: res.maxVonMisesMPa,
        err: res.globalRelativeError == null ? null : res.globalRelativeError * 100,
        cause: s?.cause ?? "none",
        peakLoc: surfacePeakLocation(res, req.positions),
        ratio: s?.concentrationRatio ?? null,
        bcFrac: res.bcSingularityErrorFraction,
      });
      const last = rows[rows.length - 1]!;
      console.log(`[run] ${variant.padEnd(9)} ${built.mesh.elementCount.toString().padStart(6)} el  ` +
        `SF ${fmt(last.sf, 2)}  peak ${fmt(last.peak)} MPa  err ${fmt(last.err, 2)}%  ` +
        `cause=${last.cause} @(${last.peakLoc.map(v => v.toFixed(2)).join(",")})  ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n================ #260 de-risking measurements ================\n");
  for (const variant of VARIANTS) {
    const rs = rows.filter(r => r.variant === variant);
    console.log(`--- ${variant} ---`);
    console.log("elements | safety factor | peak vM MPa | global err % | BC err frac | singularity | surface peak location");
    for (const r of rs) {
      console.log(`${r.elements.toString().padStart(8)} | ${fmt(r.sf, 2).padStart(13)} | ${fmt(r.peak).padStart(11)} | ` +
        `${fmt(r.err, 2).padStart(12)} | ${fmt(r.bcFrac, 3).padStart(11)} | ${r.cause.padStart(11)} | ` +
        `(${r.peakLoc.map(v => v.toFixed(2)).join(", ")})`);
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
