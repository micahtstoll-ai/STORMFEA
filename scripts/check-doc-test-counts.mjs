// scripts/check-doc-test-counts.mjs
//
// CI drift guard for issue #198: three user-facing surfaces (README.md,
// the methodology PDF template in server/index.ts, and formerly the DEBUG
// tab caption) each hand-copied a test-suite count, and all three went
// stale at different rates. Instead of re-guessing the "true" count by
// regexing test source (fragile — it.each()/test.each() multiply one call
// site into several tests, and environment-gated tests vary by machine),
// this script reads the machine-generated summaries the suite itself wrote
// during THIS run of `npm run test`:
//
//   scripts/vitest-summary.json            ← vitest --reporter=json
//   dist/tests/solver-validation-summary.json ← solver_validation.ts
//   scripts/client-logic-summary.json      ← test_client_logic.mjs
//
// and asserts the numbers hard-coded in README.md and the methodology
// template match. Run as the last step of `npm run test`; exits 1 on any
// mismatch so drift fails the build instead of silently accumulating.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root       = path.join(__dirname, '..');

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`✗ missing ${label} summary at ${p} — did the earlier test steps run?`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const vitestSummary = readJson(path.join(root, 'scripts', 'vitest-summary.json'), 'vitest');
const solverSummary  = readJson(path.join(root, 'dist', 'tests', 'solver-validation-summary.json'), 'solver validation');
const clientSummary  = readJson(path.join(root, 'scripts', 'client-logic-summary.json'), 'client logic');

const actual = {
  vitestTests: vitestSummary.numTotalTests,
  vitestFiles: (vitestSummary.testResults ?? []).length,
  solverTests: solverSummary.passed,
  solverGroups: solverSummary.groups,
  clientTests: clientSummary.passed,
};

for (const [k, v] of Object.entries(actual)) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    console.error(`✗ could not determine actual "${k}" from generated summaries`);
    process.exit(1);
  }
}

let ok = true;
function check(surface, label, claimed, expected) {
  if (claimed == null) {
    console.error(`✗ ${surface}: could not find a "${label}" count to check — pattern may have drifted`);
    ok = false;
    return;
  }
  if (claimed !== expected) {
    console.error(`✗ ${surface}: claims ${claimed} ${label}, actual is ${expected}`);
    ok = false;
  } else {
    console.log(`✓ ${surface}: ${label} = ${expected}`);
  }
}

// ── README.md ───────────────────────────────────────────────────────────────
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
{
  const m = /(\d+)\s+vitest unit tests across\s+(\d+)\s+files/.exec(readme);
  check('README.md', 'vitest unit tests', m ? Number(m[1]) : null, actual.vitestTests);
  check('README.md', 'vitest test files', m ? Number(m[2]) : null, actual.vitestFiles);
}
{
  const m = /(\d+)\s+solver validation tests/.exec(readme);
  check('README.md', 'solver validation tests', m ? Number(m[1]) : null, actual.solverTests);
}
{
  const m = /(\d+)\s+client logic checks/.exec(readme);
  check('README.md', 'client logic checks', m ? Number(m[1]) : null, actual.clientTests);
}

// ── Methodology PDF template (server/index.ts) ─────────────────────────────
const indexTs = fs.readFileSync(path.join(root, 'server', 'index.ts'), 'utf-8');
{
  const m = /(\d+)-test automated validation suite/.exec(indexTs);
  check('server/index.ts (methodology)', 'solver validation tests', m ? Number(m[1]) : null, actual.solverTests);
}

if (!ok) {
  console.error('\nTest-count drift detected — update the doc(s) above to match the actual suite (issue #198).');
  process.exit(1);
}
console.log('\nAll documented test counts match the suite as it actually ran.');
