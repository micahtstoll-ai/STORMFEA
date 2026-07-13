/**
 * coupon_stl.ts
 * Generates binary STL files for calibration coupons.
 * All dimensions match COUPON_DIMS in analysis.ts exactly.
 *
 * Coupons:
 *   tensile  — ASTM-inspired dog-bone, 10×4mm gauge, 50mm gauge length
 *   lapShear — two tabs with 20×20mm overlap for inter-layer shear test
 *   bearing  — flat plate with M3 clearance hole 10mm from short edge
 */

// ─── STL binary writer ────────────────────────────────────────────────────────
function writeBinarySTL(triangles: Array<[number,number,number,number,number,number,number,number,number]>): Buffer {
  // 80-byte header + 4-byte count + n×50-byte triangles
  const buf = Buffer.alloc(80 + 4 + triangles.length * 50);
  buf.write('STORMFEA calibration coupon — Nordic Storm 5962', 0, 'ascii');
  buf.writeUInt32LE(triangles.length, 80);
  let off = 84;
  for (const t of triangles) {
    // Compute face normal
    const ax=t[0],ay=t[1],az=t[2];
    const bx=t[3],by=t[4],bz=t[5];
    const cx=t[6],cy=t[7],cz=t[8];
    const ex=bx-ax,ey=by-ay,ez=bz-az;
    const fx=cx-ax,fy=cy-ay,fz=cz-az;
    const nx=ey*fz-ez*fy, ny=ez*fx-ex*fz, nz=ex*fy-ey*fx;
    const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    buf.writeFloatLE(nx/nl, off);    buf.writeFloatLE(ny/nl, off+4);  buf.writeFloatLE(nz/nl, off+8);
    buf.writeFloatLE(ax, off+12);   buf.writeFloatLE(ay, off+16);  buf.writeFloatLE(az, off+20);
    buf.writeFloatLE(bx, off+24);   buf.writeFloatLE(by, off+28);  buf.writeFloatLE(bz, off+32);
    buf.writeFloatLE(cx, off+36);   buf.writeFloatLE(cy, off+40);  buf.writeFloatLE(cz, off+44);
    buf.writeUInt16LE(0, off+48);
    off += 50;
  }
  return buf;
}

type Tri = [number,number,number, number,number,number, number,number,number];

// ─── Box primitive ─────────────────────────────────────────────────────────────
function box(
  x0:number,y0:number,z0:number,
  x1:number,y1:number,z1:number
): Tri[] {
  // 6 faces × 2 triangles = 12 triangles
  const tris: Tri[] = [];
  const quads: Array<[number,number,number, number,number,number, number,number,number, number,number,number]> = [
    // bottom (z=z0)
    [x0,y0,z0, x1,y0,z0, x1,y1,z0, x0,y1,z0],
    // top (z=z1)
    [x0,y1,z1, x1,y1,z1, x1,y0,z1, x0,y0,z1],
    // front (y=y0)
    [x0,y0,z0, x0,y0,z1, x1,y0,z1, x1,y0,z0],
    // back (y=y1)
    [x1,y1,z0, x1,y1,z1, x0,y1,z1, x0,y1,z0],
    // left (x=x0)
    [x0,y1,z0, x0,y1,z1, x0,y0,z1, x0,y0,z0],
    // right (x=x1)
    [x1,y0,z0, x1,y0,z1, x1,y1,z1, x1,y1,z0],
  ];
  for (const [ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz] of quads) {
    tris.push([ax,ay,az, bx,by,bz, cx,cy,cz]);
    tris.push([ax,ay,az, cx,cy,cz, dx,dy,dz]);
  }
  return tris;
}

// ─── Cylinder primitive (approx with N-sided prism) ──────────────────────────
function cylinder(cx:number,cy:number,z0:number,z1:number,r:number,N=24): Tri[] {
  const tris: Tri[] = [];
  const pts = (z:number) => Array.from({length:N}, (_,i) => {
    const a = (i/N)*Math.PI*2;
    return [cx+r*Math.cos(a), cy+r*Math.sin(a), z] as [number,number,number];
  });
  const bot = pts(z0), top = pts(z1);
  for (let i=0;i<N;i++) {
    const j=(i+1)%N;
    // Side quad
    tris.push([bot[i]![0],bot[i]![1],bot[i]![2], bot[j]![0],bot[j]![1],bot[j]![2], top[j]![0],top[j]![1],top[j]![2]]);
    tris.push([bot[i]![0],bot[i]![1],bot[i]![2], top[j]![0],top[j]![1],top[j]![2], top[i]![0],top[i]![1],top[i]![2]]);
    // Bottom cap (fan from centre — inward normal)
    tris.push([cx,cy,z0, bot[j]![0],bot[j]![1],bot[j]![2], bot[i]![0],bot[i]![1],bot[i]![2]]);
    // Top cap
    tris.push([cx,cy,z1, top[i]![0],top[i]![1],top[i]![2], top[j]![0],top[j]![1],top[j]![2]]);
  }
  return tris;
}

// ─── Box with cylindrical hole (subtract cylinder using face-complement) ──────
// Simplified: build the box normally and punch the hole by excluding the
// cylinder volume. For STL we use a box + open cylinder approach:
// build the 4 wall faces that don't intersect the hole, then add hole caps.
// For simplicity we'll use a coarse subtraction: build the box then
// approximate the hole with a set of rectangular notches around the perimeter.
// Actually the cleanest approach for STL: build box faces individually,
// skip the top cap in the hole zone, add the hole collar.

function boxWithHole(
  x0:number,y0:number,z0:number,
  x1:number,y1:number,z1:number,
  hcx:number, hcy:number, hr:number, N=24
): Tri[] {
  const tris: Tri[] = [];
  const TWO_PI = Math.PI * 2;

  const hPts = (z:number) => Array.from({length:N}, (_,i)=>{
    const a=(i/N)*TWO_PI;
    return [hcx+hr*Math.cos(a), hcy+hr*Math.sin(a), z] as [number,number,number];
  });

  // 4 side faces (full rectangles — hole is vertical so sides are clean)
  tris.push(...box(x0,y0,z0,x1,y0+0.001,z1)); // approximate thin slabs for sides
  // Actually let's just do the 6 box faces minus top/bottom caps,
  // then add annular top/bottom caps and the hole walls.

  // Side faces (not top/bottom):
  const sideQuads: Array<[number,number,number,number,number,number,number,number,number,number,number,number]> = [
    [x0,y0,z0, x0,y0,z1, x1,y0,z1, x1,y0,z0],  // front
    [x1,y1,z0, x1,y1,z1, x0,y1,z1, x0,y1,z0],  // back
    [x0,y1,z0, x0,y1,z1, x0,y0,z1, x0,y0,z0],  // left
    [x1,y0,z0, x1,y0,z1, x1,y1,z1, x1,y1,z0],  // right
  ];
  for (const [ax,ay,az,bx,by,bz,cx2,cy2,cz2,dx,dy,dz] of sideQuads) {
    tris.push([ax,ay,az,bx,by,bz,cx2,cy2,cz2]);
    tris.push([ax,ay,az,cx2,cy2,cz2,dx,dy,dz]);
  }

  // Annular top and bottom caps — triangulate as fan from outer corners to hole edge
  // Approximate annulus with a grid of triangles
  const botPts = hPts(z0), topPts = hPts(z1);
  const corners2d: Array<[number,number]> = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  // Outer boundary at each corner, hole boundary at hPts
  // Simple approach: for each hole segment, connect to nearest outer corner
  // More robust: use ear-clipping on the annular polygon
  // Simplest correct approach for our case: triangulate annulus as sectors
  // connecting each hole edge point to the 4 corners via fan triangulation
  for (let i=0;i<N;i++) {
    const j=(i+1)%N;
    // bottom annulus — connect hole edge to plate boundary (simplified as fan through centroid of plate)
    const px=(x0+x1)/2, py=(y0+y1)/2;
    // Actually: fan triangles from each hole segment to the plate outer polygon
    // For a rectangular plate we can split into 4 sectors based on angle
    const angle = ((i+0.5)/N)*TWO_PI - Math.PI; // which quadrant
    let ox:number, oy:number;
    if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
      // primarily X direction
      ox = Math.cos(angle) > 0 ? x1 : x0;
      oy = py + Math.sin(angle)*(Math.abs(Math.cos(angle)) < 0.001 ? (y1-y0)/2 : (x1-hcx)/Math.abs(Math.cos(angle)) * Math.sin(angle));
      oy = Math.max(y0, Math.min(y1, oy));
    } else {
      oy = Math.sin(angle) > 0 ? y1 : y0;
      ox = px + Math.cos(angle)*(Math.abs(Math.sin(angle)) < 0.001 ? (x1-x0)/2 : (y1-hcy)/Math.abs(Math.sin(angle)) * Math.cos(angle));
      ox = Math.max(x0, Math.min(x1, ox));
    }
    // bottom face (looking down → normal -Z → wind CW from above = CCW from below)
    tris.push([botPts[j]![0],botPts[j]![1],z0, botPts[i]![0],botPts[i]![1],z0, ox,oy,z0]);
    // top face
    tris.push([topPts[i]![0],topPts[i]![1],z1, topPts[j]![0],topPts[j]![1],z1, ox,oy,z1]);
  }
  // Fill the 4 outer corners that don't get covered by the fan
  // Use corner triangles
  for (const [cx3,cy3] of corners2d) {
    // Find adjacent hole points (closest to this corner)
    let minDist = Infinity, minIdx = 0;
    for (let i=0;i<N;i++) {
      const d = (botPts[i]![0]-cx3)**2 + (botPts[i]![1]-cy3)**2;
      if (d<minDist) { minDist=d; minIdx=i; }
    }
    const prev = (minIdx-1+N)%N, next=(minIdx+1)%N;
    tris.push([cx3,cy3,z0, botPts[minIdx]![0],botPts[minIdx]![1],z0, botPts[prev]![0],botPts[prev]![1],z0]);
    tris.push([cx3,cy3,z0, botPts[next]![0],botPts[next]![1],z0, botPts[minIdx]![0],botPts[minIdx]![1],z0]);
    tris.push([cx3,cy3,z1, botPts[prev]![0],botPts[prev]![1],z1, botPts[minIdx]![0],botPts[minIdx]![1],z1]);
    tris.push([cx3,cy3,z1, botPts[minIdx]![0],botPts[minIdx]![1],z1, botPts[next]![0],botPts[next]![1],z1]);
  }

  // Hole walls (inner cylinder surface, normal pointing inward = toward axis)
  for (let i=0;i<N;i++) {
    const j=(i+1)%N;
    tris.push([botPts[j]![0],botPts[j]![1],z0, topPts[j]![0],topPts[j]![1],z1, topPts[i]![0],topPts[i]![1],z1]);
    tris.push([botPts[j]![0],botPts[j]![1],z0, topPts[i]![0],topPts[i]![1],z1, botPts[i]![0],botPts[i]![1],z0]);
  }

  return tris;
}

// ─── Coupon generators ────────────────────────────────────────────────────────

/**
 * Tensile dog-bone coupon.
 * Gauge: 10mm wide × 4mm thick × 50mm long
 * Grip tabs: 25mm wide × 4mm thick × 20mm long on each end
 * Tapered transition over 10mm on each end
 * Total length: 20 + 10 + 50 + 10 + 20 = 110mm
 */
export function generateTensileCoupon(): Buffer {
  const tris: Tri[] = [];
  const t = 4.0;   // thickness (Z)

  // Build as series of cross-sections along X axis, varying width in Y
  // Sections: [x_start, x_end, y_half_width]
  const sections: Array<[number,number,number]> = [
    [0,   20,  12.5],   // left grip tab
    [20,  30,  12.5],   // left taper start (we approximate taper as step)
    [25,  30,   5.0],   // left taper — narrow
    [30,  80,   5.0],   // gauge section (50mm)
    [80,  85,   5.0],   // right taper start
    [85,  90,  12.5],   // right taper end
    [90, 110,  12.5],   // right grip tab
  ];

  // Simpler: just use 3 boxes (left tab, gauge, right tab) + 2 tapers
  const gripW = 25.0, gaugeW = 10.0, gripL = 20.0, taperL = 10.0, gaugeL = 50.0;
  const totalL = gripL*2 + taperL*2 + gaugeL;
  const midY = 0;

  // Left grip
  tris.push(...box(-totalL/2, -gripW/2, 0, -totalL/2+gripL, gripW/2, t));
  // Gauge
  tris.push(...box(-gaugeL/2, -gaugeW/2, 0, gaugeL/2, gaugeW/2, t));
  // Right grip
  tris.push(...box(totalL/2-gripL, -gripW/2, 0, totalL/2, gripW/2, t));

  // Left taper (approximate as 4 slabs)
  for (let i=0;i<4;i++) {
    const x0 = -totalL/2+gripL + i*taperL/4;
    const x1 = x0+taperL/4;
    const w0 = gripW - (gripW-gaugeW)*(i/4);
    const w1 = gripW - (gripW-gaugeW)*((i+1)/4);
    const wMax = Math.max(w0,w1);
    tris.push(...box(x0,-wMax/2,0,x1,wMax/2,t));
  }
  // Right taper
  for (let i=0;i<4;i++) {
    const x0 = gaugeL/2 + i*taperL/4;
    const x1 = x0+taperL/4;
    const w0 = gaugeW + (gripW-gaugeW)*(i/4);
    const w1 = gaugeW + (gripW-gaugeW)*((i+1)/4);
    const wMax = Math.max(w0,w1);
    tris.push(...box(x0,-wMax/2,0,x1,wMax/2,t));
  }

  return writeBinarySTL(tris);
}

/**
 * Z-tension coupon: the SAME dog-bone geometry as the tensile coupon
 * (COUPON_DIMS.zTensile mirrors COUPON_DIMS.tensile), but printed STANDING ON
 * END so the gauge axis is the build (Z) direction — every layer interface in
 * the gauge is loaded in pure opening tension. Measures the bond tensile
 * allowable S_zt directly (layer-model audit A5). Uniform gauge ⇒ Kt ≈ 1,
 * plain F/A. Print instructions (standing orientation, brim, 100% infill)
 * live in the client CALIBRATE panel; the geometry is orientation-agnostic.
 */
export function generateZTensileCoupon(): Buffer {
  return generateTensileCoupon();
}

/**
 * Lap shear coupon.
 * Two 20×40×4mm tabs with 20×20mm overlap (printed as one piece with a notch).
 * Total: 20mm wide × 60mm long × 4mm thick.
 * Notch at top-left and bottom-right to create the lap joint geometry.
 */
export function generateLapShearCoupon(): Buffer {
  const tris: Tri[] = [];
  const W=20, L=60, T=4, OL=20; // width, total length, thickness, overlap length

  // Top half (left tab + overlap)
  tris.push(...box(0, 0, T/2, L-OL, W, T));  // left tab (bottom half missing)
  // Bottom half (overlap + right tab)
  tris.push(...box(OL, 0, 0, L, W, T/2));    // right tab (top half missing)
  // Overlap region — full thickness
  tris.push(...box(OL, 0, 0, L-OL, W, T));

  return writeBinarySTL(tris);
}

/**
 * Bearing coupon.
 * 40mm long × 20mm wide × 4mm thick plate.
 * M3 clearance hole (3.2mm diameter) at x=10mm from one short end, centred in width.
 */
export function generateBearingCoupon(): Buffer {
  const L=40, W=20, T=4;
  const hcx=10, hcy=W/2, hr=3.2/2;
  const tris = boxWithHole(0,0,0, L,W,T, hcx,hcy,hr, 32);
  return writeBinarySTL(tris);
}
