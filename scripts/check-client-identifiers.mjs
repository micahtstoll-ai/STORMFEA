// scripts/check-client-identifiers.mjs
//
// Method note from issue #283 ("Method notes worth keeping"): the client is
// plain JS living inside a <script> tag in client/index.html, and nothing
// type-checks it. Two of the four bugs fixed in PR #287 were exactly this
// class of defect -- a call to a function that does not exist anywhere in
// the file (`renderResults`, `playStartupTone` -- both should have been
// `showResults` / `AudioManager.playMeshStart`) -- and both would throw
// `ReferenceError` the moment the code path ran, at runtime, in production.
//
// This script parses every inline <script> block in client/index.html with
// the TypeScript compiler API (already a devDependency -- no new dependency
// added), does real lexical-scope resolution (function/block scopes, var
// hoisting, destructuring, catch clauses, etc.) and reports every identifier
// reference that does not resolve to:
//   (a) something declared somewhere in scope (in the same script, or -- for
//       `var`/function declarations only, matching how browsers actually
//       share globals across sibling <script> tags -- in a DIFFERENT inline
//       script block), or
//   (b) an entry in the explicit ALLOWLIST below (browser/DOM/JS builtins,
//       plus externals the page loads via non-inlined <script src> tags,
//       e.g. THREE from vendor/three.min.js).
//
// This is a heuristic scope resolver, not a full parser/typechecker: it
// deliberately over-approximates in the lenient direction (hoists function
// declarations a little more eagerly than strict-mode block scoping would,
// treats named function/class expressions as self-visible) so that it never
// flags legitimate code -- the two real bugs it exists to catch are pure
// "this name does not exist ANYWHERE in the file" errors, and no plausible
// scoping subtlety produces one of those as a false negative.
//
// On the current tree (after PR #287) this should report ZERO hits. If it
// reports something:
//   - a genuinely undeclared identifier is a real bug -- report it, do not
//     silently allowlist it away.
//   - a legitimate browser/DOM/vendor global that isn't yet on the allowlist
//     is a gap in the list below -- add it there, with a comment, and rerun.
//
// Usage: node scripts/check-client-identifiers.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { extractInlineScripts } from './lib/extract-client-scripts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const clientPath = path.join(root, 'client', 'index.html');
const html = fs.readFileSync(clientPath, 'utf-8');

const scriptBlocks = extractInlineScripts(html);
if (scriptBlocks.length === 0) {
  console.error('✗ Found no inline <script> blocks in client/index.html — extraction regex may have drifted.');
  process.exit(1);
}

// ── Allowlist ────────────────────────────────────────────────────────────
// Explicit and commented, grouped by why each name is here. This is NOT a
// blanket suppression -- every entry is a real global the runtime provides,
// never a name we're giving up on resolving.
const ALLOWLIST = new Set([
  // -- JS language / runtime builtins --------------------------------------
  'undefined', 'NaN', 'Infinity', 'globalThis', 'arguments',
  'Object', 'Array', 'Function', 'Boolean', 'Number', 'String', 'Symbol',
  'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Promise', 'Proxy', 'Reflect', 'ArrayBuffer', 'SharedArrayBuffer',
  'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
  'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'EvalError', 'URIError', 'AggregateError',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'structuredClone', 'queueMicrotask', 'eval',

  // -- Browser window / global scope ---------------------------------------
  'window', 'self', 'top', 'parent', 'frames', 'globalThis',
  'document', 'navigator', 'location', 'history', 'screen',
  'console', 'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'focus', 'blur',
  'localStorage', 'sessionStorage', 'indexedDB', 'IDBKeyRange',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'XMLHttpRequest', 'FormData', 'URL', 'URLSearchParams',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'matchMedia', 'getComputedStyle', 'getSelection', 'devicePixelRatio',
  'performance', 'crypto', 'btoa', 'atob',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
  'CustomEvent', 'Event', 'EventTarget', 'MessageEvent', 'MessageChannel', 'MessagePort',
  'CSS', 'Node', 'NodeList', 'HTMLElement', 'SVGElement', 'Element',
  'Image', 'Audio', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext',
  'Blob', 'File', 'FileReader', 'FileList', 'DataTransfer', 'DataTransferItemList',
  'ClipboardItem', 'ClipboardEvent',
  'WebSocket', 'WebAssembly', 'Worker', 'SharedWorker', 'ServiceWorker',
  'Notification', 'Permissions', 'Geolocation',
  'requestFullscreen', 'exitFullscreen',
  'DOMParser', 'XMLSerializer', 'DOMMatrix', 'DOMPoint', 'DOMRect', 'Path2D',
  'TextEncoder', 'TextDecoder',
  'OffscreenCanvas', 'ImageData', 'ImageBitmap', 'createImageBitmap',
  'HTMLCanvasElement', 'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',

  // -- Vendored / externally loaded scripts --------------------------------
  // Loaded via <script src="vendor/three.min.js"> (see client/index.html:9),
  // pinned r0.152.2 (issue #107). The inline scripts reference the global
  // UMD export, not an import, so it never resolves from within-file scope.
  'THREE',
]);

// ── Pass 1: collect script-block metadata + parsed ASTs ────────────────────
const parsed = scriptBlocks.map(({ code, startLine }, idx) => {
  const fileName = `client-inline-${idx}.js`;
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  return { code, startLine, fileName, sourceFile };
});

// Names hoisted onto the shared global object by `var` / top-level `function`
// declarations, matching how real <script> tags share a global object while
// keeping `let`/`const`/`class` scoped to their own script (WHATWG HTML: each
// classic script gets its own lexical "script scope" record layered on the
// shared global object). Collected across ALL blocks up front so a name
// declared in script N is visible when checking script M.
const sharedGlobalNames = new Set();

function isVarDeclarationList(node) {
  return (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
}

// Walks a binding name (Identifier or Object/ArrayBindingPattern) collecting
// the leaf identifier names it declares. Does not look at defaults/computed
// keys -- see collectBindingDefaultsAsUses for that half.
function collectBindingNames(nameNode, into) {
  if (!nameNode) return;
  if (ts.isIdentifier(nameNode)) {
    into.add(nameNode.text);
    return;
  }
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      if (ts.isOmittedExpression(el)) continue; // array hole: [, , x]
      collectBindingNames(el.name, into);
    }
  }
}

// Top-level (script-global) var/function scan for pass 1, not crossing
// function boundaries.
function scanForSharedGlobals(node) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  ) {
    // Function/class bodies don't leak `var`s to the shared cross-script
    // global object unless there's an explicit `window.x = ...` (which is a
    // property write, not an identifier declaration, and is fine as-is).
    // A FunctionDeclaration's OWN name at true top level is handled below via
    // its own case before recursing, so just don't descend further here.
    return;
  }
  if (ts.isVariableStatement(node) && isVarDeclarationList(node.declarationList)) {
    for (const decl of node.declarationList.declarations) collectBindingNames(decl.name, sharedGlobalNames);
    return; // no need to descend into initializers for this pass
  }
  ts.forEachChild(node, scanForSharedGlobals);
}

// An explicit `window.NAME = ...` / `globalThis.NAME = ...` property write, at
// ANY nesting depth (including inside an IIFE or a deeply nested function),
// creates a de-facto global: real browsers resolve a bare unqualified `NAME`
// reference by falling through to the global object once no lexical binding
// matches, so a later bare reference to NAME anywhere -- including a sibling
// <script> block -- genuinely resolves at runtime and is not a bug. This file
// uses the pattern deliberately (e.g. `window.showErrorToast = showErrorToast`
// around client/index.html:151, to expose one IIFE's helper to the rest of the
// page without an unguarded top-level `var`). Unlike scanForSharedGlobals this
// intentionally DOES descend into function/class bodies -- the write itself,
// not where it's declared, is what matters.
function scanForWindowGlobalWrites(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    ts.isIdentifier(node.left.expression) &&
    (node.left.expression.text === 'window' || node.left.expression.text === 'globalThis')
  ) {
    sharedGlobalNames.add(node.left.name.text);
  }
  ts.forEachChild(node, scanForWindowGlobalWrites);
}

for (const { sourceFile } of parsed) {
  scanForWindowGlobalWrites(sourceFile);
}

for (const { sourceFile } of parsed) {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      sharedGlobalNames.add(stmt.name.text);
    }
    scanForSharedGlobals(stmt);
  }
}

// ── Pass 2: real scope resolution per script block ──────────────────────────
class Scope {
  constructor(parent) {
    this.parent = parent;
    this.names = new Set();
  }
  has(name) {
    for (let s = this; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  }
  declare(name) {
    this.names.add(name);
  }
}

const findings = []; // { file, line, name }

function report(file, startLine, node, name) {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  findings.push({ file, line: startLine + line, name });
}

// Recursively hoists `var` declarations and function declarations reachable
// from `node` WITHOUT crossing into a nested function/method/accessor body,
// adding them to `scope`. Mirrors JS var-hoisting semantics closely enough to
// avoid false positives from declare-after-use or declare-in-a-sibling-block
// patterns, which this codebase uses in a few places (e.g. `var` declared
// inside an `if` block, used after the block).
function hoistInto(node, scope) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    return; // nested function scope: hoisted separately when it's visited
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return; // classes are never var/function hoisted
  }
  if (ts.isVariableStatement(node)) {
    if (isVarDeclarationList(node.declarationList)) {
      for (const decl of node.declarationList.declarations) collectBindingNames(decl.name, scope.names);
    }
    return;
  }
  if (
    (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
    node.initializer && ts.isVariableDeclarationList(node.initializer) && isVarDeclarationList(node.initializer)
  ) {
    for (const decl of node.initializer.declarations) collectBindingNames(decl.name, scope.names);
  }
  ts.forEachChild(node, (child) => hoistInto(child, scope));
}

// Separately (not via hoistInto, which skips function bodies): register a
// nested FunctionDeclaration's name in the nearest enclosing scope reachable
// without crossing ANOTHER function boundary. hoistInto already stops at
// function bodies, so we fold this into the same walk by handling
// FunctionDeclaration specially wherever it's encountered as a plain
// statement (block-level function declarations are common in this file).
function hoistFunctionNames(node, scope) {
  if (
    ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node)
  ) {
    return;
  }
  if (ts.isFunctionDeclaration(node)) {
    if (node.name) scope.declare(node.name.text);
    return; // don't descend into its body for THIS scope's hoisting
  }
  ts.forEachChild(node, (child) => hoistFunctionNames(child, scope));
}

function hoistBoth(node, scope) {
  hoistInto(node, scope);
  hoistFunctionNames(node, scope);
}

function isTypeofOperand(node) {
  const p = node.parent;
  return !!p && ts.isTypeOfExpression(p) && p.expression === node;
}

function isBareDeclarationName(node) {
  const p = node.parent;
  if (!p) return false;
  // `function foo() {}` / `class Foo {}` name
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === node) return true;
  // parameter binding name handled via collectBindingNames elsewhere (skipped by caller)
  return false;
}

function checkIdentifierUse(node, scope, ctx) {
  const name = node.text;
  if (ALLOWLIST.has(name)) return;
  if (sharedGlobalNames.has(name)) return;
  if (scope.has(name)) return;
  if (isTypeofOperand(node)) return; // `typeof x` never throws even if x is undeclared
  report(ctx.file, ctx.startLine, node, name);
}

// Visits a binding name (declaration side): declares leaf identifiers into
// `declScope`, but still walks default-value expressions / computed property
// keys as ordinary reference expressions checked against `useScope` (usually
// the same scope, once fully populated with sibling bindings).
function visitBindingDefaults(nameNode, useScope, ctx) {
  if (!nameNode) return;
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      if (ts.isOmittedExpression(el)) continue;
      if (ts.isBindingElement(el)) {
        if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) {
          visit(el.propertyName.expression, useScope, ctx);
        }
        visitBindingDefaults(el.name, useScope, ctx);
        if (el.initializer) visit(el.initializer, useScope, ctx);
      }
    }
  }
}

function declareParams(params, scope) {
  for (const p of params) collectBindingNames(p.name, scope.names);
}
function visitParamDefaults(params, scope, ctx) {
  for (const p of params) {
    visitBindingDefaults(p.name, scope, ctx);
    if (p.initializer) visit(p.initializer, scope, ctx);
  }
}

function enterFunctionLike(node, scope, ctx) {
  const fnScope = new Scope(scope);
  // Named function/class expressions can reference their own name
  // recursively; over-approximate by making the name visible inside.
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
    fnScope.declare(node.name.text);
  }
  if (node.parameters) {
    declareParams(node.parameters, fnScope);
  }
  if (node.body) {
    if (ts.isBlock(node.body)) {
      for (const stmt of node.body.statements) hoistBoth(stmt, fnScope); // var + nested function decls
      declareBlockScopedBindings(node.body.statements, fnScope); // body's own let/const/class
    }
  }
  if (node.parameters) visitParamDefaults(node.parameters, fnScope, ctx);
  if (node.body) {
    if (ts.isBlock(node.body)) {
      for (const stmt of node.body.statements) visit(stmt, fnScope, ctx);
    } else {
      visit(node.body, fnScope, ctx); // arrow with expression body
    }
  }
}

// Pre-declares the `let`/`const`/`class`/`function` bindings a list of
// statements introduces directly into their own block, into `scope`. This is
// the lexical-scope half of hoisting: `var`/function-declaration hoisting is
// handled separately by hoistBoth (which crosses block boundaries but not
// function ones); this only covers what stops at the nearest block.
//
// Used for every block-like statement list -- including, critically, the
// TOP LEVEL of each <script> block. Earlier versions of this script called
// this pre-scan for nested blocks (via enterBlockLike) but not for the
// top level, which meant every top-level `let`/`const` in the file (nearly
// all of the app's own state, e.g. `const S = {...}`, `let
// _landingScreenActive`) was invisible to every reference anywhere in the
// script and got flagged as unresolved -- thousands of false positives.
function declareBlockScopedBindings(stmts, scope) {
  for (const stmt of stmts) {
    if (ts.isVariableStatement(stmt) && !isVarDeclarationList(stmt.declarationList)) {
      for (const decl of stmt.declarationList.declarations) collectBindingNames(decl.name, scope.names);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      scope.declare(stmt.name.text);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      scope.declare(stmt.name.text); // also visible in enclosing var-scope via hoistFunctionNames
    }
  }
}

function enterBlockLike(stmts, parentScope, ctx) {
  const blockScope = new Scope(parentScope);
  declareBlockScopedBindings(stmts, blockScope);
  for (const stmt of stmts) visit(stmt, blockScope, ctx);
  return blockScope;
}

function visit(node, scope, ctx) {
  if (node === undefined || node === null) return;

  if (ts.isPrivateIdentifier(node)) return; // #field — not a normal scope lookup

  if (ts.isIdentifier(node)) {
    if (isBareDeclarationName(node)) return;
    checkIdentifierUse(node, scope, ctx);
    return;
  }

  // -- Function-like: new var-scope --------------------------------------
  if (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    // The function's own name (FunctionDeclaration) was already declared in
    // the enclosing scope by hoistBoth/enterBlockLike; do not re-check it.
    if (node.name && !ts.isComputedPropertyName(node.name)) {
      // ok — declaration name, nothing to check
    } else if (node.name && ts.isComputedPropertyName(node.name)) {
      visit(node.name.expression, scope, ctx);
    }
    enterFunctionLike(node, scope, ctx);
    return;
  }

  // -- Class: name is a declaration; heritage/members need scope walking --
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const classScope = new Scope(scope);
    if (ts.isClassExpression(node) && node.name) classScope.declare(node.name.text);
    if (node.heritageClauses) {
      for (const hc of node.heritageClauses) for (const t of hc.types) visit(t.expression, scope, ctx);
    }
    for (const member of node.members) visit(member, classScope, ctx);
    return;
  }
  if (ts.isPropertyDeclaration(node)) {
    if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name.expression, scope, ctx);
    if (node.initializer) visit(node.initializer, scope, ctx);
    return;
  }

  // -- Block-scoped constructs ---------------------------------------------
  if (ts.isBlock(node)) {
    enterBlockLike(node.statements, scope, ctx);
    return;
  }
  if (ts.isCaseBlock(node)) {
    // All case clauses of one switch share a single lexical scope in real JS.
    const stmts = node.clauses.flatMap((c) => c.statements);
    const switchScope = new Scope(scope);
    for (const stmt of stmts) {
      if (ts.isVariableStatement(stmt) && !isVarDeclarationList(stmt.declarationList)) {
        for (const decl of stmt.declarationList.declarations) collectBindingNames(decl.name, switchScope.names);
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        switchScope.declare(stmt.name.text);
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        switchScope.declare(stmt.name.text);
      }
    }
    for (const clause of node.clauses) {
      if (ts.isCaseClause(clause)) visit(clause.expression, switchScope, ctx);
      for (const stmt of clause.statements) visit(stmt, switchScope, ctx);
    }
    return;
  }
  if (ts.isCatchClause(node)) {
    const catchScope = new Scope(scope);
    if (node.variableDeclaration) collectBindingNames(node.variableDeclaration.name, catchScope.names);
    if (node.variableDeclaration) visitBindingDefaults(node.variableDeclaration.name, catchScope, ctx);
    enterBlockLike(node.block.statements, catchScope, ctx);
    return;
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const loopScope = new Scope(scope);
    if (node.initializer && ts.isVariableDeclarationList(node.initializer) && !isVarDeclarationList(node.initializer)) {
      for (const decl of node.initializer.declarations) collectBindingNames(decl.name, loopScope.names);
    }
    if (node.initializer) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations) {
          visitBindingDefaults(decl.name, loopScope, ctx);
          if (decl.initializer) visit(decl.initializer, loopScope, ctx);
        }
      } else {
        visit(node.initializer, loopScope, ctx);
      }
    }
    if (ts.isForStatement(node)) {
      if (node.condition) visit(node.condition, loopScope, ctx);
      if (node.incrementor) visit(node.incrementor, loopScope, ctx);
    } else {
      visit(node.expression, loopScope, ctx);
    }
    visit(node.statement, loopScope, ctx);
    return;
  }

  // -- Variable declarations outside binding-collection contexts already
  //    handled above (top-level / hoisted): visit initializers + defaults --
  if (ts.isVariableDeclaration(node)) {
    visitBindingDefaults(node.name, scope, ctx);
    if (node.initializer) visit(node.initializer, scope, ctx);
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) visit(decl, scope, ctx);
    return;
  }

  // -- Object literal: keys are not references unless shorthand/computed --
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        if (ts.isComputedPropertyName(prop.name)) visit(prop.name.expression, scope, ctx);
        visit(prop.initializer, scope, ctx);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        checkIdentifierUse(prop.name, scope, ctx); // shorthand IS a reference
        if (prop.objectAssignmentInitializer) visit(prop.objectAssignmentInitializer, scope, ctx);
      } else if (ts.isSpreadAssignment(prop)) {
        visit(prop.expression, scope, ctx);
      } else if (ts.isMethodDeclaration(prop) || ts.isGetAccessor(prop) || ts.isSetAccessor(prop)) {
        if (ts.isComputedPropertyName(prop.name)) visit(prop.name.expression, scope, ctx);
        enterFunctionLike(prop, scope, ctx);
      } else {
        ts.forEachChild(prop, (c) => visit(c, scope, ctx));
      }
    }
    return;
  }

  // -- Member access: only the object expression is a reference, not `.name` --
  if (ts.isPropertyAccessExpression(node)) {
    visit(node.expression, scope, ctx);
    return; // node.name is a property name, not a variable
  }
  if (ts.isElementAccessExpression(node)) {
    visit(node.expression, scope, ctx);
    visit(node.argumentExpression, scope, ctx); // obj[expr] — expr IS a reference
    return;
  }

  // -- Labels: not variable references ---------------------------------
  if (ts.isLabeledStatement(node)) {
    visit(node.statement, scope, ctx); // node.label is a label, not checked
    return;
  }
  if (ts.isBreakOrContinueStatement(node)) {
    return; // label only (if any); nothing else to check
  }

  // -- Default: recurse into all children under the same scope -----------
  ts.forEachChild(node, (child) => visit(child, scope, ctx));
}

for (const { code, startLine, fileName, sourceFile } of parsed) {
  const ctx = { file: fileName, startLine: startLine - 1 };
  const topScope = new Scope(null);
  for (const stmt of sourceFile.statements) hoistBoth(stmt, topScope); // var + nested function decls
  declareBlockScopedBindings(sourceFile.statements, topScope); // top-level let/const/class
  for (const stmt of sourceFile.statements) visit(stmt, topScope, ctx);
}

// ── Report ──────────────────────────────────────────────────────────────
console.log(`Checked ${scriptBlocks.length} inline <script> block(s) in client/index.html against the TypeScript AST + a ${ALLOWLIST.size}-entry global allowlist.`);

if (findings.length > 0) {
  findings.sort((a, b) => a.line - b.line);
  console.error(`\n✗ ${findings.length} unresolved identifier reference(s):\n`);
  for (const f of findings) {
    console.error(`  client/index.html:${f.line}  '${f.name}' does not resolve to any declared binding or allowlisted global`);
  }
  console.error(
    '\nEach hit above is either a real bug (a ReferenceError waiting to happen — e.g. #275/#276) ' +
    'or a legitimate global missing from ALLOWLIST in this script. Fix the code, or add the global ' +
    'with a comment explaining what provides it; never blanket-suppress.',
  );
  process.exit(1);
}

console.log('✓ Every identifier referenced in the inline client scripts resolves.');
