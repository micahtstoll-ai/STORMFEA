// scripts/vitest-shard.mjs
//
// Runs one half of the vitest suite so CI can put the two halves on separate
// runners. `npm run test` still runs the whole thing in one process locally --
// this script only exists to give the workflow a seam.
//
//   node scripts/vitest-shard.mjs heavy   # only the files in heavy-tests.json
//   node scripts/vitest-shard.mjs light   # everything else
//
// Each shard writes its own JSON summary (scripts/vitest-summary-<shard>.json)
// so check-doc-test-counts.mjs can add them back up and still compare the total
// against the count README.md claims -- splitting the run must not weaken the
// #198 drift guard, so the guard learned to merge rather than the split being
// hidden from it.
//
// Extra CLI args are forwarded to vitest, e.g.
//   node scripts/vitest-shard.mjs light --reporter=verbose

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const shard = process.argv[2];
if (shard !== 'heavy' && shard !== 'light') {
  console.error('usage: node scripts/vitest-shard.mjs <heavy|light> [extra vitest args]');
  process.exit(2);
}
const passthrough = process.argv.slice(3);

const { files } = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'heavy-tests.json'), 'utf-8'),
);

// A path in heavy-tests.json that no longer exists would silently empty the
// heavy shard and silently double the light one, so fail loudly instead.
const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length > 0) {
  console.error(
    `✗ scripts/heavy-tests.json lists ${missing.length} file(s) that do not exist:\n` +
    missing.map((f) => `    ${f}`).join('\n') +
    '\n  Update the list (a renamed test file belongs in whichever shard matches its cost).',
  );
  process.exit(1);
}

const summary = `./scripts/vitest-summary-${shard}.json`;
const args = [
  'vitest', 'run',
  '--reporter=default', '--reporter=json', `--outputFile.json=${summary}`,
  ...(shard === 'heavy' ? files : files.flatMap((f) => ['--exclude', f])),
  ...passthrough,
];

console.log(`[shard:${shard}] ${files.length} heavy file(s) ${shard === 'heavy' ? 'selected' : 'excluded'}`);

const child = spawn('npx', args, { cwd: root, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
