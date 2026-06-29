/**
 * demo_part.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates sample parts for the STORMFEA judge demo mode.
 * All geometries are provably watertight using the quad-ring technique.
 */

type Tri = [number, number, number, number, number, number, number, number, number];

function writeBinarySTL(tris: Tri[]): Buffer {
  const buf = Buffer.alloc(80 + 4 + tris.length * 50);
  buf.write("STORMFEA demo part — Nordic Storm 5962", 0, "ascii");
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = cx - ax, fy = cy - ay, fz = cz - az;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    buf.writeFloatLE(nx, off);      buf.writeFloatLE(ny, off + 4);  buf.writeFloatLE(nz, off + 8);
    buf.writeFloatLE(ax, off + 12); buf.writeFloatLE(ay, off + 16); buf.writeFloatLE(az, off + 20);
    buf.writeFloatLE(bx, off + 24); buf.writeFloatLE(by, off + 28); buf.writeFloatLE(bz, off + 32);
    buf.writeFloatLE(cx, off + 36); buf.writeFloatLE(cy, off + 40); buf.writeFloatLE(cz, off + 44);
    buf.writeUInt16LE(0, off + 48);
    off += 50;
  }
  return buf;
}

/** Ray from (cx,cy) at angle θ → intersection with axis-aligned rectangle. */
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

/** Build one watertight flat slab with N holes, using quad-ring technique. */
function buildSlab(
  W: number, D: number, T: number,   // width, depth, thickness
  holes: { cx: number; cy: number; r: number }[],
  N = 48,
  zOffset = 0,
): Tri[] {
  // For simplicity when multiple holes: use the first hole only for the annulus,
  // and add remaining holes as separate smaller slabs (cuts not yet supported).
  // TetGen handles overlapping geometry as interior regions.
  const x0 = 0, y0 = 0, x1 = W, y1 = D;
  const z0 = zOffset, z1 = zOffset + T;
  const tris: Tri[] = [];

  for (const hole of holes) {
    const { cx: hcx, cy: hcy, r: hr } = hole;
    const ang  = (i: number) => (i / N) * Math.PI * 2;
    const circle = Array.from({ length: N }, (_, i): [number, number] =>
      [hcx + hr * Math.cos(ang(i)), hcy + hr * Math.sin(ang(i))]);
    const rect = Array.from({ length: N }, (_, i) =>
      rayToRect(hcx, hcy, ang(i), x0, y0, x1, y1));

    const P = (xy: [number, number], z: number): [number, number, number] => [xy[0], xy[1], z];

    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const cTop  = P(circle[i]!, z1), cTopN = P(circle[j]!, z1);
      const rTop  = P(rect[i]!,   z1), rTopN = P(rect[j]!,   z1);
      const cBot  = P(circle[i]!, z0), cBotN = P(circle[j]!, z0);
      const rBot  = P(rect[i]!,   z0), rBotN = P(rect[j]!,   z0);

      // Top annulus (+Z normal, CCW from above)
      tris.push([...cTop, ...rTop, ...rTopN] as Tri);
      tris.push([...cTop, ...rTopN, ...cTopN] as Tri);
      // Bottom annulus (-Z normal, reverse winding)
      tris.push([...cBot, ...rBotN, ...rBot] as Tri);
      tris.push([...cBot, ...cBotN, ...rBotN] as Tri);
      // Outer wall
      tris.push([...rBot, ...rBotN, ...rTopN] as Tri);
      tris.push([...rBot, ...rTopN, ...rTop] as Tri);
      // Hole wall (inward)
      tris.push([...cBot, ...cTop, ...cTopN] as Tri);
      tris.push([...cBot, ...cTopN, ...cBotN] as Tri);
    }
  }
  return tris;
}

// ── Original mounting bracket ─────────────────────────────────────────────────
export interface DemoBracketDims {
  widthMm:  number;
  depthMm:  number;
  thickMm:  number;
  holeDiamMm: number;
  holeOffsetXMm: number;
  segments: number;
}

export const DEMO_BRACKET: DemoBracketDims = {
  widthMm: 40, depthMm: 28, thickMm: 4,
  holeDiamMm: 5.2,
  holeOffsetXMm: -11,
  segments: 48,
};

export function generateDemoBracket(d: DemoBracketDims = DEMO_BRACKET): Buffer {
  const { widthMm: W, depthMm: D, thickMm: T, segments: N } = d;
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2, z0 = 0, z1 = T;
  const hcx = d.holeOffsetXMm, hcy = 0, hr = d.holeDiamMm / 2;
  const ang = (i: number) => (i / N) * Math.PI * 2;
  const circle = Array.from({ length: N }, (_, i): [number, number] =>
    [hcx + hr * Math.cos(ang(i)), hcy + hr * Math.sin(ang(i))]);
  const rect = Array.from({ length: N }, (_, i) =>
    rayToRect(hcx, hcy, ang(i), x0, y0, x1, y1));
  const tris: Tri[] = [];
  const P = (xy: [number, number], z: number): [number, number, number] => [xy[0], xy[1], z];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cTop = P(circle[i]!, z1), cTopN = P(circle[j]!, z1);
    const rTop = P(rect[i]!, z1),   rTopN = P(rect[j]!, z1);
    const cBot = P(circle[i]!, z0), cBotN = P(circle[j]!, z0);
    const rBot = P(rect[i]!, z0),   rBotN = P(rect[j]!, z0);
    tris.push([...cTop, ...rTop, ...rTopN] as Tri);
    tris.push([...cTop, ...rTopN, ...cTopN] as Tri);
    tris.push([...cBot, ...rBotN, ...rBot] as Tri);
    tris.push([...cBot, ...cBotN, ...rBotN] as Tri);
    tris.push([...rBot, ...rBotN, ...rTopN] as Tri);
    tris.push([...rBot, ...rTopN, ...rTop] as Tri);
    tris.push([...cBot, ...cTop, ...cTopN] as Tri);
    tris.push([...cBot, ...cTopN, ...cBotN] as Tri);
  }
  return writeBinarySTL(tris);
}

// ── L-Bracket (motor mount) ─────────────────────────────────────────────────
// Wide flat bracket with hole offset toward one end — represents a motor mount
// that gets pried off the robot under high lateral load.
// Same proven quad-ring geometry as the original bracket, different proportions.
export function generateLBracket(): Buffer {
  const W   = 50;   // wider than the bracket
  const D   = 36;   // deeper
  const T   = 5;    // slightly thicker
  const hr  = 2.6;  // M5 hole radius
  const N   = 48;
  const x0  = 0, x1 = W, y0 = 0, y1 = D, z0 = 0, z1 = T;
  const hcx = 10, hcy = D / 2;  // hole near one end — maximizes bending moment
  const ang  = (i: number) => (i / N) * Math.PI * 2;
  const circle = Array.from({ length: N }, (_, i): [number,number] =>
    [hcx + hr * Math.cos(ang(i)), hcy + hr * Math.sin(ang(i))]);
  const rect = Array.from({ length: N }, (_, i) =>
    rayToRect(hcx, hcy, ang(i), x0, y0, x1, y1));
  const tris: Tri[] = [];
  const P = (xy: [number,number], z: number): [number,number,number] => [xy[0], xy[1], z];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cT=P(circle[i]!,z1), cTN=P(circle[j]!,z1);
    const rT=P(rect[i]!,z1),   rTN=P(rect[j]!,z1);
    const cB=P(circle[i]!,z0), cBN=P(circle[j]!,z0);
    const rB=P(rect[i]!,z0),   rBN=P(rect[j]!,z0);
    tris.push([...cT,...rT,...rTN] as Tri);
    tris.push([...cT,...rTN,...cTN] as Tri);
    tris.push([...cB,...rBN,...rB] as Tri);
    tris.push([...cB,...cBN,...rBN] as Tri);
    tris.push([...rB,...rBN,...rTN] as Tri);
    tris.push([...rB,...rTN,...rT] as Tri);
    tris.push([...cB,...cT,...cTN] as Tri);
    tris.push([...cB,...cTN,...cBN] as Tri);
  }
  return writeBinarySTL(tris);
}

// ── Arm Pivot Link ───────────────────────────────────────────────────────────
// Long narrow plate with one hole at the fixed end.
// Force applied at far end = maximum bending moment. Classic FTC arm link.
export function generateArmPivot(): Buffer {
  const W   = 80;   // long arm
  const D   = 16;   // narrow
  const T   = 4;    // thin
  const hr  = 2.6;  // M5 hole radius
  const N   = 48;
  const x0  = 0, x1 = W, y0 = 0, y1 = D, z0 = 0, z1 = T;
  const hcx = 10, hcy = D / 2;  // hole at one end
  const ang  = (i: number) => (i / N) * Math.PI * 2;
  const circle = Array.from({ length: N }, (_, i): [number,number] =>
    [hcx + hr * Math.cos(ang(i)), hcy + hr * Math.sin(ang(i))]);
  const rect = Array.from({ length: N }, (_, i) =>
    rayToRect(hcx, hcy, ang(i), x0, y0, x1, y1));
  const tris: Tri[] = [];
  const P = (xy: [number,number], z: number): [number,number,number] => [xy[0], xy[1], z];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cT=P(circle[i]!,z1), cTN=P(circle[j]!,z1);
    const rT=P(rect[i]!,z1),   rTN=P(rect[j]!,z1);
    const cB=P(circle[i]!,z0), cBN=P(circle[j]!,z0);
    const rB=P(rect[i]!,z0),   rBN=P(rect[j]!,z0);
    tris.push([...cT,...rT,...rTN] as Tri);
    tris.push([...cT,...rTN,...cTN] as Tri);
    tris.push([...cB,...rBN,...rB] as Tri);
    tris.push([...cB,...cBN,...rBN] as Tri);
    tris.push([...rB,...rBN,...rTN] as Tri);
    tris.push([...rB,...rTN,...rT] as Tri);
    tris.push([...cB,...cT,...cTN] as Tri);
    tris.push([...cB,...cTN,...cBN] as Tri);
  }
  return writeBinarySTL(tris);
}



// ── Archetype selector and metadata ──────────────────────────────────────────
export type DemoArchetype = 'bracket' | 'l-bracket' | 'arm-pivot';

export function generateDemoPart(type: DemoArchetype = 'bracket'): Buffer {
  switch (type) {
    case 'l-bracket':  return generateLBracket();
    case 'arm-pivot':  return generateArmPivot();
    default:           return generateDemoBracket();
  }
}

export const DEMO_ARCHETYPE_META: Record<string, {
  label: string; description: string; fileName: string; forceMag: [number, number];
}> = {
  'bracket': {
    label: 'Mounting Bracket',
    description: 'Flat bracket bolted through a hole, loaded at the far edge. Classic FTC motor mount. Demonstrates flat-print false safety.',
    fileName: 'stormfea_demo_bracket.stl',
    forceMag: [150, 250],
  },
  'l-bracket': {
    label: 'Wide Motor Mount',
    description: 'Wide flat bracket with hole near one end. Longer moment arm than the standard bracket — higher bending stress at the constraint.',
    fileName: 'stormfea_demo_lbracket.stl',
    forceMag: [100, 200],
  },
  'arm-pivot': {
    label: 'Arm Pivot Link',
    description: 'Long narrow arm with one hole at the fixed end. Force at far end creates maximum bending moment. Classic FTC intake/arm link.',
    fileName: 'stormfea_demo_arm.stl',
    forceMag: [80, 180],
  },
};
