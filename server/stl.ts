/**
 * stl.ts
 * ------
 * Server-side STL parser. Reads binary and ASCII STL files.
 * Returns a flat Float32Array of triangle vertex positions and the triangle count.
 * No dependencies — pure Node.js Buffer operations.
 */

export interface STLData {
  /** Flat array: [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] — 9 floats per triangle */
  positions:     Float32Array;
  triangleCount: number;
}

export function parseSTL(buffer: Buffer): STLData {
  // Detect ASCII vs binary
  // Binary STL: first 80 bytes = header (may not start with "solid")
  // ASCII STL: starts with "solid "
  // The reliable check: if byte 80..83 encodes a triangle count that matches
  // the file size, it is binary.
  const view       = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const triCount   = view.getUint32(80, true);
  const expectedSz = 80 + 4 + triCount * 50;

  if (buffer.length === expectedSz) {
    return parseBinary(view, triCount);
  }

  // Fallback: try ASCII
  const text = buffer.toString("utf8");
  if (text.trimStart().startsWith("solid")) {
    return parseASCII(text);
  }

  // Last resort: force binary interpretation
  return parseBinary(view, triCount);
}

function parseBinary(view: DataView, triCount: number): STLData {
  const positions = new Float32Array(triCount * 9);
  let off = 84; // skip 80-byte header + 4-byte count

  for (let i = 0; i < triCount; i++) {
    off += 12; // skip face normal
    for (let v = 0; v < 3; v++) {
      positions[i * 9 + v * 3 + 0] = view.getFloat32(off,     true);
      positions[i * 9 + v * 3 + 1] = view.getFloat32(off + 4, true);
      positions[i * 9 + v * 3 + 2] = view.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // attribute byte count
  }

  return { positions, triangleCount: triCount };
}

function parseASCII(text: string): STLData {
  const vr = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
  const verts: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = vr.exec(text)) !== null) {
    verts.push(+(m[1] ?? '0'), +(m[2] ?? '0'), +(m[3] ?? '0'));
  }

  const triCount = Math.floor(verts.length / 9);
  return {
    positions:     new Float32Array(verts.slice(0, triCount * 9)),
    triangleCount: triCount,
  };
}
