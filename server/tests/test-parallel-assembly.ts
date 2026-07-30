/**
 * test-parallel-assembly.ts
 * -------------------------
 * Correctness test for the worker_threads parallel stiffness assembly path
 * (issue #98): the parallel result must equal the serial result within a
 * 1e-12 relative tolerance on real meshes, for both C3D4 and C3D10. Also
 * exercises the persistent worker pool (repeated calls reuse workers, with
 * bit-identical results) and asserts the process exits naturally — idle
 * pooled workers are unref()'d, so no explicit teardown is needed.
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
import { buildAnyConstitutiveMatrix } from "../solver/element.js";
import type { ElementMaterialField, TetMesh } from "../solver/types.js";

const mat = { E: 3500, nu: 0.36, yieldStrength: 50, label: "test" };

/**
 * Mixed N-bin material field (per-bin stiffness scaled 0.5→2.0, elements striped
 * by e % N). Exercises the per-element bin lookup crossing the worker postMessage
 * boundary — the two-region model's parallel-path plumbing. N defaults to 3;
 * a higher N mirrors issue #178's adaptive log-spaced bins (same field SHAPE,
 * more bins) to confirm larger bin counts survive the worker boundary too.
 */
function makeMixedField(mesh: TetMesh, binCount = 3): ElementMaterialField {
  const N = binCount;
  const C0 = buildAnyConstitutiveMatrix(mat);
  const Cs = new Float64Array(N * 36);
  const yieldXY = new Float64Array(N);
  const yieldZ = new Float64Array(N);
  const yieldZShear = new Float64Array(N);
  const massRho = new Float64Array(N);
  const shellFrac = new Float64Array(N);
  for (let b = 0; b < N; b++) {
    const scale = N === 1 ? 1 : 0.5 + 1.5 * (b / (N - 1)); // 0.5 … 2.0
    for (let i = 0; i < 36; i++) Cs[b * 36 + i] = scale * (C0[i] ?? 0);
    yieldXY[b] = 50 * Math.min(1, scale);
    yieldZ[b]  = 30 * Math.min(1, scale);
    yieldZShear[b] = yieldZ[b]! / Math.sqrt(3);
    massRho[b] = 1240 * Math.min(1, scale);
    shellFrac[b] = N === 1 ? 0 : b / (N - 1);
  }
  const binOfElement = new Int32Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) binOfElement[e] = e % N;
  return { binCount: N, binOfElement, C: Cs, yieldXY, yieldZ, yieldZShear, massRho, shellFrac };
}

let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

async function compareSerialVsParallel(
  label: string,
  mesh: TetMesh,
  field?: ElementMaterialField,
): Promise<void> {
  console.log(`\n[${label}] ${mesh.elementCount} elements, ${mesh.nodeCount} nodes, ${mesh.nodeCount * 3} DOF`);

  const tS = Date.now();
  const serial = await assembleK(mesh, mat, 'serial', undefined, field);
  const serialMs = Date.now() - tS;

  const tP = Date.now();
  const parallel = await assembleK(mesh, mat, 'parallel', undefined, field);
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
  // The parallel path sums element contributions per chunk and then adds the
  // chunk slabs, so summation order differs from serial and exact bit
  // equality is not expected — but 1e-12 relative agreement is. (Two
  // parallel runs ARE bit-identical to each other — asserted separately.)
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

    // Two-region material field: mixed 3-bin striping must survive the worker
    // boundary identically to serial (per-element bin lookup, multi-bin C).
    await compareSerialVsParallel("C3D4+field", meshC3D4, makeMixedField(meshC3D4));
    await compareSerialVsParallel("C3D10+field", meshC3D10, makeMixedField(meshC3D10));

    // Adaptive high-bin field (issue #178): the same payload SHAPE with more
    // bins (11) — the adaptive log-spaced binning grows binCount, so confirm a
    // higher bin count still crosses the worker boundary bit-for-1e-12.
    await compareSerialVsParallel("C3D4+field(11-bin)", meshC3D4, makeMixedField(meshC3D4, 11));
    await compareSerialVsParallel("C3D10+field(11-bin)", meshC3D10, makeMixedField(meshC3D10, 11));

    // Pool reuse (issue #98): two consecutive parallel assemblies must both
    // take the parallel path (the second reuses the persistent workers) and —
    // because chunk boundaries and merge order are fixed — be BIT-IDENTICAL
    // to each other. This catches merge-order regressions that the 1e-12
    // serial tolerance would hide.
    console.log(`\n[pool-reuse] two consecutive parallel assemblies (C3D4)`);
    const runA = await assembleK(meshC3D4, mat, 'parallel');
    const runB = await assembleK(meshC3D4, mat, 'parallel');
    check("pool-reuse: first parallel run took the parallel path", runA.parallel);
    check("pool-reuse: second parallel run took the parallel path", runB.parallel);
    let bitIdentical = runA.K.data.length === runB.K.data.length;
    if (bitIdentical) {
      for (let i = 0; i < runA.K.data.length; i++) {
        if (!Object.is(runA.K.data[i], runB.K.data[i])) { bitIdentical = false; break; }
      }
    }
    check("pool-reuse: repeated parallel runs are bit-identical", bitIdentical);
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

  // Natural-exit watchdog: idle pool workers are unref()'d, so the process
  // must exit on its own without destroyAssemblyPool(). The unref'd timer
  // below cannot hold the event loop open itself — it only fires if
  // something else (a leaked ref'd worker) does.
  const watchdog = setTimeout(() => {
    console.error("Parallel assembly test FAILED: worker pool leaked a ref — process did not exit");
    process.exit(1);
  }, 5000);
  watchdog.unref();
})();
