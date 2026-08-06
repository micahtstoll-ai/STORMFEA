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
//
// CI runs the vitest suite as two shards on two runners (see
// scripts/vitest-shard.mjs), which would hand this guard a partial count and
// let it "pass" against a README claiming the full one. So the vitest summary
// may be given as SEVERAL files, whose test and file counts are summed:
//
//   node scripts/check-doc-test-counts.mjs \
//     --vitest a/vitest-summary-light.json --vitest b/vitest-summary-heavy.json \
//     --solver dist/tests/solver-validation-summary.json \
//     --client scripts/client-logic-summary.json
//
// With no flags the defaults above apply, so a plain `npm run test` is
// unchanged. Summing is only sound because the shards PARTITION the suite —
// vitest-shard.mjs derives one shard as the exact complement of the other, so
// no file can be counted twice or dropped. The duplicate check below enforces
// that rather than trusting it.

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

/** Collect repeatable `--flag <value>` arguments, or [] if the flag is absent. */
function argValues(flag) {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) {
      console.error(`✗ ${flag} needs a path argument`);
      process.exit(1);
    }
    out.push(v);
    i++;
  }
  return out;
}

const vitestPaths = argValues('--vitest');
const solverPath = argValues('--solver')[0] ?? path.join(root, 'dist', 'tests', 'solver-validation-summary.json');
const clientPath = argValues('--client')[0] ?? path.join(root, 'scripts', 'client-logic-summary.json');

const vitestSummaries = (vitestPaths.length > 0
  ? vitestPaths
  : [path.join(root, 'scripts', 'vitest-summary.json')]
).map((p) => ({ path: p, json: readJson(p, `vitest (${p})`) }));

// Two shards that overlap would double-count a file and make a stale README
// look correct, which is the exact failure this guard exists to catch. Compare
// the union of test-file paths against the running total.
const seenFiles = new Set();
for (const { path: p, json } of vitestSummaries) {
  for (const r of json.testResults ?? []) {
    if (seenFiles.has(r.name)) {
      console.error(
        `✗ vitest summaries overlap: ${r.name} appears in more than one shard ` +
        `(last seen in ${p}). Shards must partition the suite, or the totals below are wrong.`,
      );
      process.exit(1);
    }
    seenFiles.add(r.name);
  }
}

if (vitestSummaries.length > 1) {
  console.log(
    `· merged ${vitestSummaries.length} vitest shard summaries: ` +
    vitestSummaries.map((s) => `${path.basename(s.path)}=${(s.json.testResults ?? []).length} files`).join(', '),
  );
}

const solverSummary  = readJson(solverPath, 'solver validation');
const clientSummary  = readJson(clientPath, 'client logic');

const actual = {
  vitestTests: vitestSummaries.reduce((n, s) => n + (s.json.numTotalTests ?? NaN), 0),
  vitestFiles: seenFiles.size,
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
