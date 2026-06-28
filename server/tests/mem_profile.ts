/**
 * mem_profile.ts
 * --------------
 * Standalone memory profiling script for the STORMFEA FEM pipeline.
 *
 * Sweeps over box mesh sizes to measure per-phase heap usage.
 * Not a vitest test — run via:
 *
 *   npm run profile:mem
 *
 * which compiles and runs:
 *   STORMFEA_PROFILE_MEMORY=1 node --expose-gc dist/tests/mem_profile.js
 *
 * Output: per-phase heap delta (MB) for each grid size.
 * Useful for catching regressions in memory-critical assembly/stress paths.
 */

import { generateBoxMesh } from "../solver/meshgen.js";
import { runLinearStatic }  from "../solver/pipeline.js";
import type { SolverInput } from "../solver/pipeline.js";

// ─── Snapshot helper ──────────────────────────────────────────────────────────
// Mirrors the _snap helper in pipeline.ts and analysis.ts
function snap(label: string): { heapMB: number; label: string } {
  if (typeof globalThis.gc === "function") globalThis.gc();
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  return { heapMB, label };
}

function printDelta(before: { heapMB: number; label: string }, after: { heapMB: number; label: string }): void {
  const delta = after.heapMB - before.heapMB;
  const sign  = delta >= 0 ? "+" : "";
  console.log(`  ${before.label} → ${after.label}: heap=${after.heapMB.toFixed(1)}MB delta=${sign}${delta.toFixed(1)}MB`);
}

// ─── Profile sweep ────────────────────────────────────────────────────────────
const GRID_SIZES: [number, number, number][] = [
  [10, 10, 10],   //  ~1k elements
  [20, 20, 20],   //  ~8k elements
  [30, 30, 30],   // ~27k elements
];

const mat = { E: 3500, nu: 0.36, yieldStrength: 50, label: "pla" };

console.log("STORMFEA Memory Profile");
console.log("========================");
if (typeof globalThis.gc !== "function") {
  console.warn("Warning: --expose-gc not active. GC-before-snap disabled; deltas may include GC lag.");
}
console.log();

(async () => {

for (const [nx, ny, nz] of GRID_SIZES) {
  const label = `${nx}×${ny}×${nz}`;
  console.log(`Grid ${label}:`);

  const t0 = snap("baseline");

  const mesh = generateBoxMesh(0, 0, 0, nx * 1.0, ny * 1.0, nz * 1.0, nx, ny, nz);

  const t1 = snap("after generateBoxMesh");
  printDelta(t0, t1);
  console.log(`  nodes=${mesh.nodeCount} elements=${mesh.elementCount}`);

  // Build simple constraints (bottom face fixed) and forces (top face loaded)
  const bottom: number[] = [], top: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const z = mesh.nodes[n * 3 + 2] ?? 0;
    if (z < 0.01) bottom.push(n);
    if (z > ny * 1.0 - 0.01) top.push(n);
  }
  const fPerNode = 100.0 / Math.max(1, top.length);
  const input: SolverInput = {
    mesh,
    material: mat,
    constraints: [{ nodeIndices: bottom }],
    forces: top.map(n => ({ nodeIndex: n, forceN: [0, 0, fPerNode] as [number, number, number] })),
  };

  // Note: pipeline.ts also calls _snap internally when STORMFEA_PROFILE_MEMORY=1
  const t2 = snap("before runLinearStatic");
  const result = await runLinearStatic(input);
  const t3 = snap("after runLinearStatic");

  printDelta(t1, t2);
  printDelta(t2, t3);
  console.log(`  converged=${result.converged} cgIter=${result.cgIterations} maxVM=${result.maxVonMisesMPa.toFixed(2)} MPa`);
  console.log();
}

})();  // End async IIFE

console.log("Profile complete.");
