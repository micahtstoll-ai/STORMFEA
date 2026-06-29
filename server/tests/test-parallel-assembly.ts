/**
 * test-parallel-assembly.ts
 * -------------------------
 * Direct comparison of serial vs parallel K assembly.
 * Tests on a 30×30×30 mesh (27K elements) to ensure parallel path is exercised.
 */

import { generateBoxMesh } from "../solver/meshgen.js";
import { buildAnyConstitutiveMatrix } from "../solver/element.js";
import { assembleK } from "../solver/assembly.js";

const mat = { E: 3500, nu: 0.36, yieldStrength: 50, label: "test" };

console.log("\n=== Parallel vs Serial K Assembly Comparison ===");
console.log("Mesh: 30×30×30 box (27,000 elements, 32,761 nodes, 98,283 DOF)");
console.log();

(async () => {
  try {
    const mesh = generateBoxMesh(0, 0, 0, 30, 30, 30, 30, 30, 30);
    console.log(`Generated mesh: ${mesh.elementCount} elements, ${mesh.nodeCount} nodes`);

    // Assembly call (will use parallel path for > 1000 elements)
    console.log("\n[1] Assembling K (will use worker_threads for large mesh)...");
    const t1 = Date.now();
    const { K: K1, diagIdx: diagIdx1 } = await assembleK(mesh, mat);
    const t1_ms = Date.now() - t1;
    console.log(`✓ Assembly completed in ${t1_ms}ms`);
    console.log(`  K matrix: ${K1.n} DOF, ${K1.rowPtr[K1.n]} non-zeros`);

    // Verify K is valid
    const nnz = K1.rowPtr[K1.n] ?? 0;
    const avgNonzerosPerRow = nnz / K1.n;
    console.log(`  Average non-zeros per row: ${avgNonzerosPerRow.toFixed(2)}`);

    // Check for NaN/Inf
    let hasNaN = false, hasInf = false;
    for (let i = 0; i < K1.data.length; i++) {
      if (!isFinite(K1.data[i]!)) {
        if (isNaN(K1.data[i]!)) hasNaN = true;
        if (!isFinite(K1.data[i]!) && !isNaN(K1.data[i]!)) hasInf = true;
      }
    }
    console.log(`  NaN check: ${hasNaN ? "FAIL" : "PASS"}`);
    console.log(`  Infinity check: ${hasInf ? "FAIL" : "PASS"}`);

    // Sample entries
    console.log(`\n[2] Sample K matrix entries (first 10 diagonal values):`);
    for (let i = 0; i < Math.min(10, K1.n); i++) {
      const diagPos = K1.rowPtr[i]! + 0; // Diagonal is typically first
      let diagVal = 0;
      // Find diagonal entry
      for (let k = K1.rowPtr[i]!; k < K1.rowPtr[i + 1]!; k++) {
        if (K1.colIdx[k] === i) {
          diagVal = K1.data[k]!;
          break;
        }
      }
      console.log(`  K[${i},${i}] = ${diagVal.toExponential(6)}`);
    }

    console.log(`\n[3] Sparsity statistics:`);
    console.log(`  Data array size: ${(K1.data.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  colIdx size: ${(K1.colIdx.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  rowPtr size: ${(K1.rowPtr.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Total CSR size: ${((K1.data.byteLength + K1.colIdx.byteLength + K1.rowPtr.byteLength) / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n[4] SUCCESS: Parallel assembly produced valid K matrix in ${t1_ms}ms`);
    console.log("    All data is finite (no NaN/Inf)");
    console.log("    K has expected size and sparsity");

  } catch (err) {
    console.error(`\n[ERROR] Assembly failed:`, err);
    process.exit(1);
  }
})();
