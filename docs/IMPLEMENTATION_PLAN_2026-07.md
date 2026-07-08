# STORMFEA Implementation Plan — July 2026 Audit

Companion to `docs/REPO_ANALYSIS_2026-07.md`. This plan sequences the issues
filed from the July 8 repo audit (#96–#111) plus the pre-existing physics
issues (#63–#65) into phases ordered by risk-reduction per unit effort, with
explicit dependencies so each phase lands as small, independently verifiable
PRs.

New findings in this audit (not in the June analysis): #96 (C3D10 SPR stride
bug), #97 (verdict ignores Hill SF), #98 (parallel assembly dead under ESM),
#99 (modal density ignores infill), #100 (matrix/factorization reuse),
#101 (upright axis swap + dropped G_xy), #102 (Poisson convention audit),
#103 (numerical hygiene batch).

---

## Phase 0 — Guardrails first (do before touching the solver)

**#108 — CI with real meshers.** `apt-get install tetgen gmsh` in test.yml,
run `scripts/verify_tetgen_c3d10.mjs`, add one STL and one STEP end-to-end
test. Everything later in this plan modifies the solver hot path; this is the
net that catches regressions. *Effort: S. No dependencies.*

Exit criteria: CI red if midnode ordering breaks, if an end-to-end analysis
fails, or (after Phase 1) if wall time regresses.

## Phase 1 — Correctness of shipped numbers

These change results users already see; each needs a before/after note in the PR.

1. **#96 — C3D10 SPR/ZZ stride fix.** Three one-line stride fixes + a
   linear-field exactness test. Highest confidence, smallest diff, affects
   every quadratic-mesh heatmap and error estimate. *Effort: S.*
2. **#97 — Verdict uses Hill minSafetyFactor + calibrated yield.** Plumb
   `result.minSafetyFactor` into the verdict and `checkFailureModes`; derive
   analytic-check yields from the solved material. *Effort: S–M. Independent.*
3. **#105 — 3-D bolt constraint (reuse `findHoleWallNodes`).** Removes the
   28%-of-nodes over-constraint on the STL path. Expect SF to drop on bolted
   parts — that is the fix working, document it. *Effort: S.*
4. **#101 (part 1) — CLT upright branch carries `G_xy`.** One line. The
   rotation-vs-swap decision (part 2) is Phase 4 research. *Effort: trivial.*
5. **#99 — Modal density from `massRho` with infill scaling.** Single density
   source of truth; delete label matching. *Effort: S.*

Exit criteria: validation suite green; new tests for each item; one demo
analysis re-run with before/after SF and heatmap screenshots in the PR.

## Phase 2 — Performance (the 65× and friends)

1. **#104 — node→element adjacency for error mapping.** The single biggest
   win: ~6.5 min → ~6 s on the demo mesh. Build the adjacency once per mesh;
   revert the 600 s timeouts; recalibrate overlay estimates. *Effort: S.*
2. **#100 — matrix/factorization reuse.** Order within the issue:
   IC(0)-factor-once for modal (biggest, safest), then share one `assembleK`
   across static/modal/buckling, then one `buildSparsityPattern` per mesh.
   Depends on nothing, but land after #99 so modal tests are stable. *Effort: M.*
3. **#98 — parallel assembly.** Step 1: delete the broken `require.resolve`
   check (workers start running at all). Step 2: transferable typed-array
   triplets. Step 3: persistent pool. Each step is a separate commit with the
   serial-vs-parallel equivalence test green. *Effort: M.*
4. Enable the CI wall-time gate from #108 once #104 is in.

Exit criteria: demo C3D10 analysis < 30 s; modal wall time reported
before/after; assembly equivalence test in CI.

## Phase 3 — Robustness & product promises

1. **#106 — trustworthy errors** (validation, envelope, honest
   missing-mesher message, stale tab copy). *Effort: S–M.*
2. **#111 — small fixes batch** (atomic writes, STEP hole z, docs/branding).
   Atomic writes and hole-z are trivial and can ride along with any Phase 1 PR.
3. **#107 — vendor Three.js + fonts** (offline promise). *Effort: S.*
4. **#110 — resume session.** Highest-leverage UX; purely client + existing
   APIs. *Effort: S–M.*
5. **#109 — SSE progress + cancel.** Deliberately after #104: once analyses
   are seconds not minutes, scope the UI accordingly; cancellation still
   matters for fine meshes. *Effort: M.*

## Phase 4 — Physics debt & research items (parallelizable, non-blocking)

- **#102 — Poisson convention audit.** Decide the `nu_xz` convention, pin it
  with a first-principles compliance test. Small but requires care; touches
  every orthotropic run if the constant changes.
- **#101 (part 2) — rotation vs swap for upright.** Benchmark the swap
  against a proper Bond-transformation rotation on the cantilever case;
  either implement rotation or document the approximation with error bounds.
- **#103 — numerical hygiene batch.** HRZ lumping for C3D10, exact Gauss
  constants, buckling sign handling, dead-code removal. Good
  first-contribution material; each item independent.
- **#63/#64/#65 — existing physics-citation issues.** Continue as the WIP
  commits have been doing (benchmark tests largely landed; sourcing work
  remains).

## Sequencing rationale

- Phase 0 before Phase 1 because #96/#97/#105 all change shipped numbers —
  the meshers-in-CI net must exist first.
- #96 before #104: the error-estimate speedup (#104) reuses the same
  adjacency/patch machinery the stride fix touches; fixing correctness first
  avoids optimizing a wrong quantity.
- #99 before #100: modal reuse work should start from a modal path whose
  mass matrix is already correct, so its regression baselines don't move twice.
- #109 last of the UX items because #104 changes its requirements.

## Verification per phase

Every PR: `npm ci && tsc && vitest run && node dist/tests/solver_validation.js`
plus the new CI mesher jobs. Phase 1 and 2 PRs additionally include a live
demo-bracket run (STL C3D10 + STEP paths) with SF, wall time, and heatmap
screenshot noted in the PR description.
