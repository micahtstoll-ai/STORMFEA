/**
 * analyse_stream.ts
 * -----------------
 * Abort bookkeeping for the SSE streaming branch of POST /api/analyse
 * (issue #347).
 *
 * The streaming handler has two reasons to stop a solve early, and they are
 * NOT the same event:
 *
 *   client  — the browser tab closed or the user clicked Cancel. Nobody is
 *             listening any more, so the correct behaviour is to abort the
 *             solve and say nothing on the wire.
 *   timeout — the server's own hang guard fired. The client IS still
 *             listening and is owed an explanation.
 *
 * Before #347 both went through one `abort(why)` whose reason string was only
 * ever console.log'd, and both ended the stream with no `result` and no
 * `error` event. The client (`analyzeStreaming`, client/index.html) reads a
 * stream that ends with neither as a cancel, so a server-side timeout was
 * reported to the user as "Analysis cancelled" — indistinguishable from their
 * own Cancel click, on a solve they never cancelled.
 *
 * This module owns the distinction: the guard remembers WHICH kind of abort
 * happened, emits a `timedOut`-tagged `error` event on the timeout path only,
 * and leaves the client-disconnect path silent (as it already correctly was).
 * It is a plain object over injectable hooks rather than inline handler code
 * so the behaviour is unit-testable without an HTTP server or a real clock
 * (`server/tests/unit/analyse-timeout.test.ts`).
 */

import { CG_DEADLINE_DEFAULT_MS } from "./solver/cg.js";

/**
 * Wall-clock budget for everything in an analyse request that is NOT the CG
 * solve: meshing (TetGen/Gmsh subprocess), constraint application, assembly,
 * stress recovery and surface mapping.
 *
 * The outer timeout wraps the WHOLE pipeline, so it has to be the CG solver's
 * own budget PLUS this, or it preempts a solve the solver itself considers
 * legitimate. Five minutes is deliberately generous against the largest part
 * this tool targets (the 30k-75k element acceptance meshes in the CI heavy
 * shard mesh, assemble and recover in well under that) — the outer timeout is
 * a hang guard for a pipeline stage that has stopped making progress, not a
 * performance budget, so the cost of it being too loose is a slow error and
 * the cost of it being too tight is a wrong one.
 */
export const ANALYSE_PIPELINE_MARGIN_MS = 300_000;

/**
 * Default hang guard for POST /api/analyse, both response modes.
 *
 * Derived from CG_DEADLINE_DEFAULT_MS rather than written as a literal: it was
 * a flat 120 s while the CG solver's own wall-clock backstop was 600 s, so the
 * route killed converging solves at a fifth of the budget cg.ts had explicitly
 * reserved for them — on exactly the large meshes that need it. Deriving it
 * keeps the two in the right order if either moves. Do not lower this below
 * CG_DEADLINE_DEFAULT_MS.
 */
export const ANALYSE_TIMEOUT_MS = CG_DEADLINE_DEFAULT_MS + ANALYSE_PIPELINE_MARGIN_MS;

/** Environment variable that overrides ANALYSE_TIMEOUT_MS for one server run. */
export const ANALYSE_TIMEOUT_ENV = "STORMFEA_ANALYSE_TIMEOUT_MS";

/**
 * Effective timeout: ANALYSE_TIMEOUT_MS unless STORMFEA_ANALYSE_TIMEOUT_MS
 * holds a positive finite number of milliseconds. A malformed or non-positive
 * value falls back to the default rather than disabling the guard.
 */
export function analyseTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[ANALYSE_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") return ANALYSE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return ANALYSE_TIMEOUT_MS;
  return n;
}

/** Why a streaming solve was aborted. */
export type AnalyseAbortKind = "timeout" | "client";

/** Payload of the `error` SSE event sent when the hang guard fires. */
export interface AnalyseTimeoutEvent {
  error: string;
  hint: string;
  /**
   * The flag the client keys on. Its presence is what separates this from a
   * cancel: a stream that ends with no event at all still means "cancelled".
   */
  timedOut: true;
  timeoutMs: number;
}

/** Build the `error` event body for a timed-out analysis. */
export function analyseTimeoutEvent(timeoutMs: number): AnalyseTimeoutEvent {
  const secs = Math.round(timeoutMs / 1000);
  return {
    error: `Analysis timed out after ${secs}s — the server stopped the solve.`,
    hint:
      `The part or mesh may be too large for this machine. Try a coarser mesh ` +
      `quality, or raise the limit with ${ANALYSE_TIMEOUT_ENV} (milliseconds) ` +
      `and restart the server.`,
    timedOut: true,
    timeoutMs,
  };
}

export interface AnalyseStreamGuardHooks {
  /** Writes one SSE event. Must be a no-op once the response has ended. */
  sse: (event: string, data: unknown) => void;
  /** Ends the response. Must tolerate being called when already ended. */
  end: () => void;
  /** Server-side log line. Defaults to console.log. */
  log?: (msg: string) => void;
  /** Effective timeout; defaults to analyseTimeoutMs(). */
  timeoutMs?: number;
  /** Timer injection (tests drive the fire manually). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface AnalyseStreamGuard {
  /** Passed to runAnalysis as `signal`. */
  readonly signal: AbortSignal;
  /** Timeout this guard is enforcing, in milliseconds. */
  readonly timeoutMs: number;
  /** Which abort happened, or null if the solve is still (or ended) healthy. */
  abortedBy(): AnalyseAbortKind | null;
  /** Called from res 'close' — the socket is gone, abort silently. */
  clientGone(): void;
  /** Called once the solve resolves or rejects: stops the hang guard. */
  settle(): void;
}

/**
 * Create the abort guard for one streaming analyse request.
 *
 * On timeout it reports BEFORE ending the stream, and it ends the stream
 * itself rather than waiting for the solve to notice the AbortSignal: the
 * signal is only checked at phase boundaries, so a stage that is genuinely
 * hung would never reach the handler's catch block and the user would be left
 * watching the overlay forever — which is the failure this guard exists for.
 */
export function createAnalyseStreamGuard(hooks: AnalyseStreamGuardHooks): AnalyseStreamGuard {
  const timeoutMs = hooks.timeoutMs ?? analyseTimeoutMs();
  const log = hooks.log ?? ((msg: string) => console.log(msg));
  const setTimer = hooks.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = hooks.clearTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout));

  const ac = new AbortController();
  let kind: AnalyseAbortKind | null = null;
  let settled = false;

  const handle = setTimer(() => {
    if (kind !== null || settled) return;
    kind = "timeout";
    ac.abort();
    log(`[analyse:sse] timed out after ${Math.round(timeoutMs / 1000)}s — aborting solve and reporting to client`);
    // Report, THEN end: an SSE event written after res.end() is dropped, and a
    // silent close is exactly what the client reads as a user cancel.
    hooks.sse("error", analyseTimeoutEvent(timeoutMs));
    hooks.end();
  }, timeoutMs);

  return {
    signal: ac.signal,
    timeoutMs,
    abortedBy: () => kind,
    clientGone: () => {
      if (kind !== null) return;
      kind = "client";
      ac.abort();
      clearTimer(handle);
      // No SSE event and no res.end(): the connection is already gone.
      log("[analyse:sse] client disconnected — aborting solve");
    },
    settle: () => {
      settled = true;
      clearTimer(handle);
    },
  };
}
