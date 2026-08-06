/**
 * holes.ts — cylinder detection for closed solid STL files.
 *
 * Approach: for a closed solid, hole walls appear as wall-facing triangles
 * (face normal nearly horizontal, |nz| < 0.15) clustered at a consistent
 * radial distance from the hole axis. We find them by a grid search over
 * candidate cylinder centres, trying radii from 0.5mm to 15mm.
 *
 * The grid search only LOCATES a hole; it must not be what we report.
 * Its radius ladder is 0.5 mm coarse, so a raw grid radius is up to
 * ±0.25 mm from the truth — larger than classifyHole's entire ±0.20 mm
 * MATCH_TOL, which is enough to name the wrong fastener (issue #280: the
 * 5.2 mm demo bracket hole reported 5.0 mm and classified as an M6 tap
 * drill). So every kept candidate is refined by a least-squares circle
 * fit over the VERTICES of its wall faces — vertices sit on the nominal
 * cylinder, while centroids sit inside it by the faceting sagitta — and
 * the fitted centre/radius/residuals are what leave this module. The
 * STEP/Gmsh path already reports an exact `gmsh.holeRadius`; this brings
 * the STL path to the same footing.
 *
 * Validated on the 1"×1"×4mm plate: correctly finds both M3 holes
 * (r=1.5mm) at (1.80, 6.76) and (-6.50, 0.00).
 */

export interface HoleFeature {
  id:           number;
  centre:       [number, number, number];
  normal:       [number, number, number];
  radius:       number;
  confidence:   number;
  edgeCount:    number;
  /** RMS radial residual (mm) of the wall vertices about the reported circle. */
  rmsError:     number;
  /** Largest single radial residual (mm) about the reported circle. */
  maxDeviation: number;
}

/**
 * One wall-facing triangle: centroid, inward XY normal, and the triangle's
 * three vertices (flat, to avoid a per-face array allocation over meshes with
 * tens of thousands of wall faces).
 *
 * The vertices are kept because the radius refinement fits them, not the
 * centroids: the centroid of a facet chord sits INSIDE the nominal cylinder by
 * the sagitta, so a centroid fit under-reports the radius by O(Δθ²) — 0.19% on
 * a 48-segment hole, ~3% on a 12-segment one. The vertices lie on the cylinder.
 */
interface WF {
  cx:number; cy:number; cz:number; nx:number; ny:number;
  vx0:number; vy0:number; vx1:number; vy1:number; vx2:number; vy2:number;
}

/** Result of the least-squares circle refinement. Radii/residuals in mm. */
export interface CircleFit {
  cx:     number;
  cy:     number;
  r:      number;
  rms:    number;
  maxDev: number;
}

/**
 * Kåsa algebraic circle fit: minimise Σ (x²+y² − (A·x + B·y + C))² over the
 * sample points, which is linear in (A,B,C) and so needs no iteration. The
 * points are mean-centred first, which zeroes the two linear cross-terms and
 * leaves a well-conditioned 2×2 solve.
 *
 * Kåsa is biased toward small radii when the samples cover only a short arc
 * AND the samples are noisy — it is exact on any arc when they are not. Hole
 * walls here are gated to >198° of coverage (maxGap < 0.9π rad = 162°) before
 * they become a HoleFeature, and at that coverage the bias is measured at
 * -1e-4 mm for 0.02 mm sample noise and -6e-3 mm for 0.1 mm, i.e. two to three
 * orders of magnitude below the 0.20 mm classification tolerance this fit
 * exists to respect. (Ungated it is real: at 60° coverage and 0.1 mm noise the
 * bias is -1.1 mm.) The rms guard in acceptFitOrFallback rejects anything
 * noisier than that anyway.
 *
 * Returns null when the points are degenerate (collinear — e.g. the flat
 * outer wall of a plate — or too few to constrain three unknowns).
 */
export function fitCircleLsq(px: readonly number[], py: readonly number[]): CircleFit | null {
  const n = px.length;
  if (n < 3) return null;

  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += px[i]!; my += py[i]!; }
  mx /= n; my /= n;

  let Suu = 0, Suv = 0, Svv = 0, Suz = 0, Svz = 0, Sz = 0;
  for (let i = 0; i < n; i++) {
    const u = px[i]! - mx, v = py[i]! - my;
    const z = u * u + v * v;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Suz += u * z; Svz += v * z; Sz += z;
  }

  const det = Suu * Svv - Suv * Suv;
  // Scale-aware degeneracy test: Suu*Svv has units of length^4, so compare
  // against the sample's own spread rather than an absolute epsilon.
  if (!(Math.abs(det) > 1e-9 * (Suu + Svv) * (Suu + Svv))) return null;

  const a = (Suz * Svv - Svz * Suv) / det;
  const b = (Svz * Suu - Suz * Suv) / det;
  const cu = a / 2, cv = b / 2;
  const rsq = Sz / n + cu * cu + cv * cv;
  if (!(rsq > 0) || !Number.isFinite(rsq)) return null;

  const cx = mx + cu, cy = my + cv;
  const r  = Math.sqrt(rsq);
  const { rms, maxDev } = residualsAbout(px, py, cx, cy, r);
  if (!Number.isFinite(r) || !Number.isFinite(rms)) return null;
  return { cx, cy, r, rms, maxDev };
}

/** Radial residual statistics of the sample points about a given circle. */
function residualsAbout(
  px: readonly number[], py: readonly number[],
  cx: number, cy: number, r: number,
): { rms: number; maxDev: number } {
  let sum = 0, maxDev = 0;
  for (let i = 0; i < px.length; i++) {
    const e = Math.abs(Math.hypot(px[i]! - cx, py[i]! - cy) - r);
    sum += e * e;
    if (e > maxDev) maxDev = e;
  }
  return { rms: px.length ? Math.sqrt(sum / px.length) : 0, maxDev };
}

/** mm — radial tolerance of the grid search, and the band the refinement is
 *  allowed to move within. Shared by the search and the refinement so the two
 *  can never disagree about what "this candidate's faces" means. */
export const RTOL = 0.4;

/**
 * Accept or reject a circle fit against the candidate the grid search found.
 *
 * Any of these falls back to the grid radius and the normal-derived centre, but
 * ALWAYS with residuals measured about whatever circle is actually returned —
 * never a placeholder:
 *   - degenerate/failed fit (collinear samples, e.g. a flat outer wall), or
 *     fewer than the 3 samples a circle needs
 *   - fitted radius more than RTOL from the grid radius, or centre more than
 *     RTOL from the normal-derived centre — the fit ran away from the feature
 *     the search actually found
 *   - RMS residual above RTOL/2 — the samples are not a circle
 *
 * Split out from refineCandidate (which does the sample collection) and
 * exported for unit testing (tests/unit/hole-radius-fit.test.ts): the guard
 * rails are unreachable through detectHoles on any mesh the grid search will
 * actually accept, so they need a direct test or they have none.
 */
export function acceptFitOrFallback(
  px: readonly number[], py: readonly number[],
  cxRef: number, cyRef: number, rGrid: number,
): CircleFit {
  const fallback = (): CircleFit => ({
    cx: cxRef, cy: cyRef, r: rGrid,
    ...residualsAbout(px, py, cxRef, cyRef, rGrid),
  });
  const fit = fitCircleLsq(px, py);
  if (!fit) return fallback();
  if (Math.abs(fit.r - rGrid) > RTOL) return fallback();
  if (Math.hypot(fit.cx - cxRef, fit.cy - cyRef) > RTOL) return fallback();
  if (fit.rms > RTOL / 2) return fallback();
  return fit;
}

/**
 * Refine one grid candidate into a real circle.
 *
 * The grid search hands us a centre already refined off the face normals and a
 * radius still snapped to the 0.5 mm ladder. This fits centre AND radius
 * together to the wall vertices, so the reported circle is one circle rather
 * than a fitted centre bolted to a quantised radius.
 */
function refineCandidate(faces: readonly WF[], cxRef: number, cyRef: number, rGrid: number): CircleFit {
  const px: number[] = [];
  const py: number[] = [];
  // Vertices of a hole-wall facet sit on the cylinder, but a slightly tapered
  // or partially-captured wall can contribute strays, so drop vertices that are
  // nowhere near the located circle.
  //
  // The band has to clear TWO offsets, both of which grow with the radius: the
  // faceting sagitta that separates a vertex from its face's centroid (3% of r
  // on a 12-segment hole) and the up-to-RTOL gap between that centroid radius
  // and the grid rung. Hence the proportional term — a flat 2*RTOL empties the
  // sample set on a large coarsely-facetted hole, which would hand the fit
  // nothing to measure. See the unwindowed refill below for the hard guarantee.
  const band = Math.max(2 * RTOL, 0.10 * rGrid);
  const push = (x: number, y: number, lim: number) => {
    if (Math.abs(Math.hypot(x - cxRef, y - cyRef) - rGrid) < lim) { px.push(x); py.push(y); }
  };
  for (const f of faces) {
    push(f.vx0, f.vy0, band); push(f.vx1, f.vy1, band); push(f.vx2, f.vy2, band);
  }
  // The residuals this returns are reported verbatim as rmsError/maxDeviation,
  // so they must never be measured over an empty sample set — residualsAbout()
  // of nothing is 0, which would read downstream as a flawless fit backed by no
  // evidence at all (exactly the fiction the old hardcoded 0.05/0.1 was). If the
  // band somehow rejected everything, take every vertex and let the guard rails
  // below decide.
  if (px.length < 3) {
    for (const f of faces) {
      push(f.vx0, f.vy0, Infinity); push(f.vx1, f.vy1, Infinity); push(f.vx2, f.vy2, Infinity);
    }
  }

  return acceptFitOrFallback(px, py, cxRef, cyRef, rGrid);
}

/**
 * Deterministic sanity check for merged / mis-detected holes.
 *
 * Two distinct bolt holes cannot physically overlap. When Gmsh merges two
 * closely-spaced hole surfaces under one tag, the circle fit produces a single
 * hole with an inflated radius (and a centre between the two real holes), which
 * can then overlap a neighbouring hole. This flags any hole whose detected
 * circle overlaps another's, so the UI/report can tell the user the radius may
 * be wrong (README "Closely-spaced holes (STEP)" caveat). Purely geometric —
 * no mesher dependence — so it also runs on the STL and Onshape paths.
 *
 * Returns a warning string per input hole (null when the hole looks fine),
 * aligned by index.
 */
export function flagMergedHoleWarnings(
  holes: readonly { id?: number; centre: readonly [number, number, number]; radius: number }[],
): (string | null)[] {
  const warn: (string | null)[] = holes.map(() => null);
  const label = (k: number) => holes[k]!.id ?? k;
  const msg = (other: number) =>
    `Overlaps hole ${other} — two closely-spaced holes may have been merged into one; ` +
    `the detected radius/centre may be wrong. Re-run start-debug.bat and check the ` +
    `[gmsh-debug] lines, or redefine the hole manually.`;
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i]!, b = holes[j]!;
      const dx = a.centre[0] - b.centre[0];
      const dy = a.centre[1] - b.centre[1];
      const dz = a.centre[2] - b.centre[2];
      const dist = Math.hypot(dx, dy, dz);
      // 0.98 leaves a hair of tolerance so exactly-tangent holes don't trip it.
      if (dist < (a.radius + b.radius) * 0.98) {
        if (!warn[i]) warn[i] = msg(label(j));
        if (!warn[j]) warn[j] = msg(label(i));
      }
    }
  }
  return warn;
}

export function detectHoles(positions: Float32Array, triangleCount: number): HoleFeature[] {

  // ── Collect wall-facing triangle centroids + normals + vertices ─────────────
  const wf: WF[] = [];

  for (let t = 0; t < triangleCount; t++) {
    const b = t * 9;
    const x0=positions[b]??0,   y0=positions[b+1]??0, z0=positions[b+2]??0;
    const x1=positions[b+3]??0, y1=positions[b+4]??0, z1=positions[b+5]??0;
    const x2=positions[b+6]??0, y2=positions[b+7]??0, z2=positions[b+8]??0;
    const ex1=x1-x0,ey1=y1-y0,ez1=z1-z0;
    const ex2=x2-x0,ey2=y2-y0,ez2=z2-z0;
    const fnx=ey1*ez2-ez1*ey2, fny=ez1*ex2-ex1*ez2, fnz=ex1*ey2-ey1*ex2;
    const fl=Math.sqrt(fnx*fnx+fny*fny+fnz*fnz);
    if (fl<1e-10) continue;
    if (Math.abs(fnz/fl)>0.15) continue;           // not a wall face
    const nxyLen=Math.sqrt(fnx*fnx+fny*fny)/fl;
    if (nxyLen<0.85) continue;
    wf.push({ cx:(x0+x1+x2)/3, cy:(y0+y1+y2)/3, cz:(z0+z1+z2)/3,
              nx:(fnx/fl)/nxyLen, ny:(fny/fl)/nxyLen,
              vx0:x0, vy0:y0, vx1:x1, vy1:y1, vx2:x2, vy2:y2 });
  }
  if (wf.length < 6) return [];

  // ── Bounding box of wall faces ─────────────────────────────────────────────
  let xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity;
  for (const f of wf) {
    if(f.cx<xMin)xMin=f.cx; if(f.cx>xMax)xMax=f.cx;
    if(f.cy<yMin)yMin=f.cy; if(f.cy>yMax)yMax=f.cy;
  }

  // ── Grid search for cylinder centres ──────────────────────────────────────
  // For each (gx,gy) candidate centre and radius r:
  //   score = number of wall faces whose radial distance |face_pos - centre|
  //           is within ±tolerance of r
  // A real hole shows a sharp peak in score at the correct r.

  const GRID_STEP   = 0.5;   // mm — candidate centre spacing
  const RADII       = Array.from({length:30},(_,i)=>0.5+i*0.5); // 0.5 to 15mm
  const MIN_SCORE   = 10;    // minimum faces to count as a hole

  // cx/cy/r are the REFINED circle (see refineCandidate), not the grid values —
  // the grid values never escape this loop.
  interface Candidate {
    cx:number; cy:number; r:number; rms:number; maxDev:number;
    score:number; faces:WF[];
  }
  const candidates: Candidate[] = [];

  const gxSteps = Math.ceil((xMax-xMin)/GRID_STEP)+1;
  const gySteps = Math.ceil((yMax-yMin)/GRID_STEP)+1;

  for (let gi=0; gi<gxSteps; gi++) {
    const gx = xMin + gi*GRID_STEP;
    for (let gj=0; gj<gySteps; gj++) {
      const gy = yMin + gj*GRID_STEP;

      for (const r of RADII) {
        const matching = wf.filter(f => Math.abs(Math.sqrt((f.cx-gx)**2+(f.cy-gy)**2)-r) < RTOL);
        if (matching.length < MIN_SCORE) continue;

        // Refine centre: face normals point INWARD toward the axis,
        // so centre = face_pos + r * face_normal (add, not subtract)
        const cxEsts = matching.map(f => f.cx + r*f.nx);
        const cyEsts = matching.map(f => f.cy + r*f.ny);
        const cxRef = cxEsts.reduce((s,v)=>s+v,0)/cxEsts.length;
        const cyRef = cyEsts.reduce((s,v)=>s+v,0)/cyEsts.length;

        // Spread of centre estimates (lower = better)
        const spread = Math.sqrt(
          cxEsts.reduce((s,v)=>s+(v-cxRef)**2,0)/cxEsts.length +
          cyEsts.reduce((s,v)=>s+(v-cyRef)**2,0)/cyEsts.length
        );
        if (spread > 0.5) continue;

        // Least-squares refine centre AND radius off the wall vertices. Issue
        // #280: reporting the grid `r` here quantised every STL radius to
        // 0.5 mm, up to ±0.25 mm off — larger than classifyHole's ±0.20 mm
        // MATCH_TOL, so the tool could name the wrong fastener on a hole it
        // had located perfectly.
        const fit = refineCandidate(matching, cxRef, cyRef, r);

        candidates.push({
          cx: fit.cx, cy: fit.cy, r: fit.r, rms: fit.rms, maxDev: fit.maxDev,
          score: matching.length, faces: matching,
        });
      }
    }
  }

  if (!candidates.length) return [];

  // ── Deduplicate: keep best candidate per (centre, radius) cluster ──────────
  // Both radii here are FITTED, which is what makes this test work. One true
  // hole is generally found by BOTH grid rungs that straddle it — every wall
  // face of a 3.7 mm hole is within RTOL of the 3.5 rung and within RTOL of the
  // 4.0 rung — and |3.5 − 4.0| = 0.5 is not < 0.5, so on grid radii the two
  // survived as separate holes. Measured on the pristine code, a 3.7 mm hole
  // was emitted twice (3.5 and 4.0), and likewise 2.15, 3.3, 4.2 and 13.7 mm;
  // fitted, every rung lands on the true radius and they collapse to one.
  // (Not universal: on very coarse tessellation the centroid radius can fall
  // far enough inside that only one rung matches, which is why the pristine
  // code emitted one hole for 3.7 mm at 12 segments and two at 24+.)
  candidates.sort((a,b)=>b.score-a.score);
  const kept: Candidate[] = [];
  for (const c of candidates) {
    const dup = kept.some(k =>
      Math.sqrt((k.cx-c.cx)**2+(k.cy-c.cy)**2) < 1.5
      && Math.abs(k.r-c.r) < 0.5
    );
    if (!dup) kept.push(c);
  }

  // ── Convert to HoleFeature[] ───────────────────────────────────────────────
  const holes: HoleFeature[] = [];
  let id = 0;

  for (const c of kept) {
    // Angular coverage check
    const angles = c.faces.map(f => Math.atan2(f.cy-c.cy, f.cx-c.cx)).sort((a,b)=>a-b);
    let maxGap = 0;
    for (let i=0; i<angles.length; i++) {
      const gap = i<angles.length-1
        ? (angles[i+1]??0)-(angles[i]??0)
        : (angles[0]??0)+Math.PI*2-(angles[angles.length-1]??0);
      if (gap>maxGap) maxGap=gap;
    }
    if (maxGap > Math.PI*0.9) continue; // more than 162° missing → not a full hole

    const czVals = c.faces.map(f=>f.cz);
    const czMid  = (Math.min(...czVals)+Math.max(...czVals))/2;

    const confidence = Math.min(1, (c.score/144) * (1-maxGap/(Math.PI*2)));

    holes.push({
      id:           id++,
      centre:       [c.cx, c.cy, czMid],
      normal:       [0, 0, 1],
      radius:       c.r,
      confidence,
      edgeCount:    c.score,
      // Real measured residuals about the reported circle. These were hardcoded
      // 0.05 / 0.1 placeholders, which made a bad fit indistinguishable from a
      // good one for anything downstream that wanted to judge the detection.
      rmsError:     c.rms,
      maxDeviation: c.maxDev,
    });
  }

  return holes;
}
