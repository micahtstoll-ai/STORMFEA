// scripts/check-nullish-precedence.mjs
//
// Method note from issue #283 ("Method notes worth keeping"): `??` binds
// LOOSER than the arithmetic operators, so `a ?? 0 - b` silently parses as
// `a ?? (0 - b)`, not `(a ?? 0) - b` -- this was exactly bug #274
// (`closestNode()` measured distance from the origin because
// `nodes[i] ?? 0 - px` never subtracted `px` from a real node coordinate,
// only from the literal `0` on the rare nullish branch). TypeScript accepts
// the mixed expression without complaint (it only rejects `??` combined with
// `||`/`&&` at the same grouping level); this is purely a silent-precedence
// footgun, not a syntax error.
//
// The issue's one-liner was a grep:
//
//   grep -rnE '\?\?\s*[0-9.]+\s*[-+*/]' --include=*.ts server scripts
//
// which only catches a NUMERIC LITERAL immediately after `??`. The obvious
// broadening is: flag `??` followed by ANY right operand, then an
// unparenthesized arithmetic operator, since `a ?? b - c` is exactly as
// mis-parsed as `a ?? 0 - c`. That broadening WAS tried here, walking the
// AST for every BinaryExpression whose operator is `??` and whose right-hand
// side is itself an unparenthesized (a real parenthesized expression shows up
// as its own AST node, so this falls out for free) arithmetic BinaryExpression
// -- and it produces false positives on this codebase: every extra hit is a
// `value ?? computedDefaultFormula` pattern where the arithmetic on the right
// IS the whole intended fallback, e.g. `mat.G_xy ?? E_xy / (2 * (1 + nu_xy))`
// (server/solver/element.ts:130, the isotropic shear-modulus relation used AS
// a default) or `yieldZShear ?? yieldZ / Math.sqrt(3)` (server/solver/
// stress.ts:340, `interlaminarShearOf`'s documented default -- see the
// Interlayer Failure invariants in CLAUDE.md, item 5). Those are correct
// exactly because `??` binds loosest: the formula is meant to run before the
// fallback is chosen. A broadened check cannot distinguish "arithmetic that
// IS the fallback value" from "arithmetic that was meant to run on the ??
// result" without understanding intent, so per the issue's own guidance this
// stays the NARROW form -- numeric-literal trigger only, same shape as the
// original grep -- but implemented over the AST rather than as a raw regex,
// which is a real improvement even at the same scope: it cannot mis-fire on
// a match inside a comment, string, or template literal (a regex can), and it
// extends to a file type the original grep never covered at all (see below).
//
// LIMITATION (documented per issue #283's ask, not fixed by broadening): a
// non-literal right operand that silently swallows an operator -- e.g. some
// hypothetical `nodes[i] ?? fallbackNode.x - px` -- is NOT caught here. Only
// `?? <numeric literal> <op>` is, matching #274's actual shape
// (`nodes[i] ?? 0 - px`) and the issue's own grep.
//
// Scope matches the issue's grep: every *.ts file under server/ and scripts/,
// plus (new, since the issue's grep did not cover it) the inline <script>
// blocks in client/index.html -- the bug this check exists to catch (#274)
// happened to be server-side, but the same footgun is exactly as live in the
// client's plain JS, and nothing else type-checks that file (see
// check-client-identifiers.mjs).
//
// Usage: node scripts/check-nullish-precedence.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { extractInlineScripts } from './lib/extract-client-scripts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ── Collect source units to check ──────────────────────────────────────────
// { fileLabel, code, startLine (1-based line of code[0] within fileLabel), scriptKind }
const units = [];

function walkDir(dir, into) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, into);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      into.push(full);
    }
  }
}

for (const dir of ['server', 'scripts']) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  const files = [];
  walkDir(abs, files);
  for (const f of files) {
    units.push({
      fileLabel: path.relative(root, f),
      code: fs.readFileSync(f, 'utf-8'),
      startLine: 1,
      scriptKind: ts.ScriptKind.TS,
    });
  }
}

{
  const clientPath = path.join(root, 'client', 'index.html');
  const html = fs.readFileSync(clientPath, 'utf-8');
  for (const { code, startLine } of extractInlineScripts(html)) {
    units.push({ fileLabel: 'client/index.html', code, startLine, scriptKind: ts.ScriptKind.JS });
  }
}

if (units.length === 0) {
  console.error('✗ Found no source units to check — did server/, scripts/, or client/index.html move?');
  process.exit(1);
}

// ── Walk each unit's AST for the hazardous pattern ─────────────────────────
const ARITHMETIC_OPS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
]);

const findings = []; // { fileLabel, line, snippet }

function checkUnit(unit) {
  const sourceFile = ts.createSourceFile(unit.fileLabel, unit.code, ts.ScriptTarget.ES2022, true, unit.scriptKind);

  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isBinaryExpression(node.right) &&
      ARITHMETIC_OPS.has(node.right.operatorToken.kind) &&
      ts.isNumericLiteral(node.right.left) // narrow trigger — see file header
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const snippet = node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
      findings.push({ fileLabel: unit.fileLabel, line: unit.startLine - 1 + line, snippet });
    }
    ts.forEachChild(node, visit);
  }

  for (const stmt of sourceFile.statements) visit(stmt);
}

for (const unit of units) checkUnit(unit);

// ── Report ──────────────────────────────────────────────────────────────
const fileCount = new Set(units.map((u) => u.fileLabel)).size;
console.log(`Checked ${units.length} source unit(s) across ${fileCount} file(s) for '?? <numeric literal> <arithmetic-op>' without parentheses.`);

if (findings.length > 0) {
  findings.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel) || a.line - b.line);
  console.error(`\n✗ ${findings.length} unparenthesized '?? <literal>' + arithmetic hit(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.fileLabel}:${f.line}  ${f.snippet}`);
  }
  console.error(
    '\n`??` binds looser than +-*/%**, so each expression above evaluates the arithmetic ' +
    'BEFORE falling back on nullish -- e.g. `a ?? 0 - b` is `a ?? (0 - b)`, not `(a ?? 0) - b` ' +
    '(this was bug #274). Add explicit parentheses to say which grouping you mean.',
  );
  process.exit(1);
}

console.log("✓ No unparenthesized '?? <numeric literal>' + arithmetic-operator expressions found.");
