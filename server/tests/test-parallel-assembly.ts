/**
 * test-parallel-assembly.ts
 * -------------------------
 * Correctness test for the worker_threads parallel stiffness assembly path
 * (issue #98): the parallel result must equal the serial result within a
 * 1e-12 relative tolerance on real meshes, for both C3D4 and C3D10.
 *
 * Run (compiled): node dist/tests/test-parallel-assembly.js
 * Wired into `npm test` after solver_validation. Exits non-zero on failure.
 *
 * NOTE: this test must run from compiled output — the parallel path spawns
 * dist/solver/assembly-worker.js, which does not exist when running from
 * uncompiled TypeScript (vitest); assembleK falls back to serial there.
 */

import { generateBoxMesh, generateBoxMeshC3D10 } from "../solver/meshgen.js";
import { assembleK } from "../solver/assembly.js";
import type { TetMesh } from "../solver/types.js";

const mat = { E: 3500, nu: 0.36, yieldStrength: 50, label: "test" };

let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

async function compareSerialVsParallel(label: string, mesh: TetMesh): Promise<void> {
  console.log(`\n[${label}] ${mesh.elementCount} elements, ${mesh.nodeCount} nodes, ${mesh.nodeCount * 3} DOF`);

  const tS = Date.now();
  const serial = await assembleK(mesh, mat, 'serial');
  const serialMs = Date.now() - tS;

  const tP = Date.now();
  const parallel = await assembleK(mesh, mat, 'parallel');
  const parallelMs = Date.now() - tP;

  console.log(`  serial=${serialMs}ms parallel=${parallelMs}ms (parallel path used: ${parallel.parallel})`);

  // The forced-parallel run must actually have taken the parallel path —
  // otherwise this comparison is vacuous (serial vs serial).
  check(`${label}: parallel path actually ran`, parallel.parallel);

  check(`${label}: same DOF count`, serial.K.n === parallel.K.n,
    `serial=${serial.K.n} parallel=${parallel.K.n}`);
  check(`${label}: same nnz`, serial.K.data.length === parallel.K.data.length,
    `serial=${serial.K.data.length} parallel=${parallel.K.data.length}`);

  // Element-wise comparison, relative to the largest matrix entry.
  // The parallel path sums element contributions in a different order (and the
  // worker drops |val| < 1e-16 triplets), so exact bit equality is not
  // expected — but 1e-12 relative agreement is.
  let maxAbsSerial = 0;
  for (let i = 0; i < serial.K.data.length; i++) {
    const a = Math.abs(serial.K.data[i] ?? 0);
    if (a > maxAbsSerial) maxAbsSerial = a;
  }
  let maxRelDiff = 0;
  let allFinite = true;
  for (let i = 0; i < serial.K.data.length; i++) {
    const s = serial.K.data[i] ?? 0;
    const p = parallel.K.data[i] ?? 0;
    if (!isFinite(p)) allFinite = false;
    const rel = Math.abs(p - s) / maxAbsSerial;
    if (rel > maxRelDiff) maxRelDiff = rel;
  }

  check(`${label}: parallel K all finite`, allFinite);
  check(`${label}: parallel equals serial within 1e-12 relative`, maxRelDiff < 1e-12,
    `maxRelDiff=${maxRelDiff.toExponential(3)}`);

  // Diagonal index arrays come from the same sparsity pattern — sanity check.
  check(`${label}: identical diagIdx`,
    serial.diagIdx.length === parallel.diagIdx.length &&
    serial.diagIdx.every((v, i) => v === parallel.diagIdx[i]));
}

(async () => {
  console.log("\n=== Parallel vs Serial K Assembly Equivalence ===");
  try {
    // C3D4: 12×12×12 box = 10 368 elements (well above the 1000-element
    // parallel threshold, small enough to keep the serial reference fast).
    const meshC3D4 = generateBoxMesh(0, 0, 0, 12, 12, 12, 12, 12, 12);
    await compareSerialVsParallel("C3D4", meshC3D4);

    // C3D10: 6×6×6 box = 1 296 quadratic elements.
    const meshC3D10 = generateBoxMeshC3D10(0, 0, 0, 6, 6, 6, 6, 6, 6);
    await compareSerialVsParallel("C3D10", meshC3D10);
  } catch (err) {
    console.error(`\n[ERROR] Assembly comparison failed:`, err);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(52)}`);
  if (failed > 0) {
    console.error(`Parallel assembly test FAILED (${failed} checks)`);
    process.exit(1);
  }
  console.log("Parallel assembly equals serial — all checks passed ✓");
})();
