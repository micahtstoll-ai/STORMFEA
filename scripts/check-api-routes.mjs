// scripts/check-api-routes.mjs
//
// CI drift guard for issue #201: docs/API.md claims to document "every
// route defined in server/index.ts" (API.md:6-7). This script makes that
// claim checkable instead of aspirational — it greps the routes actually
// registered on the Express app and the routes listed in API.md's
// "Endpoint index" table, and fails if either side has one the other
// doesn't (a route added without a doc update, or a doc entry for a route
// that no longer exists).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root       = path.join(__dirname, '..');

const indexTs = fs.readFileSync(path.join(root, 'server', 'index.ts'), 'utf-8');
const apiMd   = fs.readFileSync(path.join(root, 'docs', 'API.md'), 'utf-8');

// ── Routes actually registered ──────────────────────────────────────────────
const registered = new Set();
const routeRe = /app\.(get|post|delete|put)\(\s*["']([^"']+)["']/g;
for (const m of indexTs.matchAll(routeRe)) {
  registered.add(`${m[1].toUpperCase()} ${m[2]}`);
}

// ── Routes documented in API.md's endpoint index table ─────────────────────
const indexSection = apiMd.split('## Endpoint index')[1]?.split(/\n---/)[0] ?? '';
const documented = new Set();
const docRe = /`(GET|POST|DELETE|PUT)\s+([^\s`]+)`/g;
for (const m of indexSection.matchAll(docRe)) {
  documented.add(`${m[1]} ${m[2]}`);
}

if (documented.size === 0) {
  console.error('✗ found 0 documented routes in docs/API.md\'s "Endpoint index" section — table format may have changed');
  process.exit(1);
}
if (registered.size === 0) {
  console.error('✗ found 0 app.<method>(...) route registrations in server/index.ts — regex may have drifted from the code style');
  process.exit(1);
}

const undocumented = [...registered].filter(r => !documented.has(r)).sort();
const stale        = [...documented].filter(r => !registered.has(r)).sort();

let ok = true;
if (undocumented.length) {
  ok = false;
  console.error(`✗ ${undocumented.length} route(s) registered in server/index.ts but missing from docs/API.md's endpoint index:`);
  for (const r of undocumented) console.error(`    ${r}`);
}
if (stale.length) {
  ok = false;
  console.error(`✗ ${stale.length} route(s) documented in docs/API.md but not registered in server/index.ts (stale doc):`);
  for (const r of stale) console.error(`    ${r}`);
}

if (!ok) {
  console.error('\nRoute↔doc drift detected — update docs/API.md (issue #201).');
  process.exit(1);
}
console.log(`✓ docs/API.md's endpoint index matches all ${registered.size} routes registered in server/index.ts`);
