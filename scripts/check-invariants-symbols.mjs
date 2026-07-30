// scripts/check-invariants-symbols.mjs
//
// CI drift guard for issue #192: docs/INVARIANTS.md names specific code
// symbols and files as the implementation of each CLAUDE.md invariant. A
// rename or file move silently breaks that traceability. This script:
//
//   1. Asserts every `server/...` / `docs/...` / `client/...` file path
//      named in the doc still exists.
//   2. Asserts every identifier-shaped backtick token (function/const/type
//      names) still appears somewhere in server/ or client/ — cheap
//      "does this symbol still exist" grep, not a full call-graph check,
//      but it catches the common case (a rename that nobody updated the
//      matrix for).
//
// Deliberately permissive on false negatives (skips tokens that don't look
// like identifiers — numbers, prose fragments, operators) so it doesn't
// need hand-maintained exception lists; a missed check here is backstopped
// by the fact that every invariant also has a real regression test.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root       = path.join(__dirname, '..');

const doc = fs.readFileSync(path.join(root, 'docs', 'INVARIANTS.md'), 'utf-8');

// ── Collect every backtick-quoted token in the doc ──────────────────────────
const tokens = [...doc.matchAll(/`([^`]+)`/g)].map(m => m[1]);

const filePaths = new Set();
const symbols    = new Set();

// Identifier shape: starts with a letter/underscore, made of word chars,
// optionally dotted (Type.member) — and long enough to not be noise like `f`.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

for (let raw of tokens) {
  raw = raw.trim();
  // File path?
  if (/^(server|docs|client)\/[\w./-]+\.(ts|md|html)$/.test(raw)) {
    filePaths.add(raw);
    continue;
  }
  // Strip a trailing "(...)" call/type-args suffix, e.g. "buildAnyConstitutiveMatrix"
  let ident = raw.replace(/\(.*$/, '').trim();
  // Skip things like "print.twoRegion" prose flags — still valid dotted idents, keep them.
  if (IDENT_RE.test(ident) && ident.length >= 4 && !/^\d/.test(ident)) {
    symbols.add(ident);
  }
}

let ok = true;

// ── Check file paths exist ──────────────────────────────────────────────────
for (const fp of filePaths) {
  const full = path.join(root, fp);
  if (!fs.existsSync(full)) {
    console.error(`✗ docs/INVARIANTS.md references missing file: ${fp}`);
    ok = false;
  }
}

// ── Check symbols appear somewhere in server/ or client/ ───────────────────
// Build a single haystack (cheap for this repo's size) of all server/*.ts
// and client/index.html source, so each symbol is a plain substring search.
function collectSource(dir, exts) {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out += collectSource(full, exts);
    } else if (exts.some(e => entry.name.endsWith(e))) {
      out += fs.readFileSync(full, 'utf-8');
    }
  }
  return out;
}

const haystack = collectSource(path.join(root, 'server'), ['.ts'])
  + fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf-8');

// A small allowlist of doc/prose terms that are backtick-quoted but are not
// code symbols (config-file names, CLI flags, generic English words that
// happen to look like identifiers). Kept short and reviewed at each edit.
const PROSE_ALLOWLIST = new Set([
  'toBe', 'closeTo', 'npm', 'test', 'describe', 'it',
]);

for (const sym of symbols) {
  if (PROSE_ALLOWLIST.has(sym)) continue;
  // Dotted idents (Type.member): check the leaf name is present (the exact
  // qualifying type may be inlined/destructured differently at each site).
  const leaf = sym.split('.').pop();
  const re = new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (!re.test(haystack)) {
    console.error(`✗ docs/INVARIANTS.md references symbol not found in server/ or client/: ${sym}`);
    ok = false;
  }
}

if (!ok) {
  console.error('\nInvariant-matrix symbol drift detected — update docs/INVARIANTS.md (issue #192).');
  process.exit(1);
}
console.log(`✓ docs/INVARIANTS.md: all ${filePaths.size} referenced files and ${symbols.size} referenced symbols found`);
