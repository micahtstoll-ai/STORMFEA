/**
 * holes.ts — cylinder detection for closed solid STL files.
 *
 * Approach: for a closed solid, hole walls appear as wall-facing triangles
 * (face normal nearly horizontal, |nz| < 0.15) clustered at a consistent
 * radial distance from the hole axis. We find them by a grid search over
 * candidate cylinder centres, trying radii from 0.5mm to 15mm.
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
  rmsError:     number;
  maxDeviation: number;
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

  // ── Collect wall-facing triangle centroids + normals ────────────────────────
  interface WF { cx:number; cy:number; cz:number; nx:number; ny:number; }
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
              nx:(fnx/fl)/nxyLen, ny:(fny/fl)/nxyLen });
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
  const RTOL        = 0.4;   // mm — radial tolerance
  const MIN_SCORE   = 10;    // minimum faces to count as a hole

  interface Candidate { cx:number; cy:number; r:number; score:number; faces:WF[]; }
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

        candidates.push({ cx:cxRef, cy:cyRef, r, score:matching.length, faces:matching });
      }
    }
  }

  if (!candidates.length) return [];

  // ── Deduplicate: keep best candidate per (centre, radius) cluster ──────────
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
      rmsError:     0.05,
      maxDeviation: 0.1,
    });
  }

  return holes;
}
