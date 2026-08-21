/**
 * analyse-timeout.test.ts
 * -----------------------
 * Issue #347 regression: a server-side hang-guard timeout on the SSE analyse
 * path must be DISTINGUISHABLE from a user cancel.
 *
 * Before the fix both paths called one `abort()` that logged a reason nobody
 * transmitted and ended the stream with no `result` and no `error` event —
 * and the client reads exactly that shape as "Analysis cancelled". A real
 * user sat waiting for a large solve, never touched Cancel, and was told they
 * had cancelled it.
 *
 * These tests drive the guard over injected hooks and a fake clock, so they
 * assert the wire behaviour (which events are emitted, in what order, and
 * whether the stream is ended) without an HTTP server or a real timer. They
 * also lock the reconciliation with the CG solver's own deadline: the outer
 * guard must never fire before cg.ts's budget is exhausted.
 */

import { describe, it, expect } from "vitest";
import {
  ANALYSE_TIMEOUT_MS,
  ANALYSE_PIPELINE_MARGIN_MS,
  ANALYSE_TIMEOUT_ENV,
  analyseTimeoutMs,
  analyseTimeoutEvent,
  createAnalyseStreamGuard,
} from "../../analyse_stream.js";
import { CG_DEADLINE_DEFAULT_MS } from "../../solver/cg.js";

/** Records everything the guard would have put on the wire. */
function harness(timeoutMs = 1000) {
  const events: Array<{ event: string; data: any }> = [];
  const logs: string[] = [];
  let ended = false;
  let fire: (() => void) | null = null;
  let cleared = false;

  const guard = createAnalyseStreamGuard({
    sse:  (event, data) => { if (!ended) events.push({ event, data }); },
    end:  () => { ended = true; },
    log:  (m) => { logs.push(m); },
    timeoutMs,
    setTimer:   (fn) => { fire = fn; return 1; },
    clearTimer: () => { cleared = true; fire = null; },
  });

  return {
    guard, events, logs,
    isEnded: () => ended,
    wasCleared: () => cleared,
    /** Fire the hang guard, as the real timer would. */
    tick: () => { if (fire) fire(); },
    hasTimer: () => fire !== null,
  };
}

describe("analyse SSE hang guard (issue #347)", () => {
  it("reports a timeout as a tagged error event, then ends the stream", () => {
    const h = harness(1000);
    h.tick();

    expect(h.guard.abortedBy()).toBe("timeout");
    expect(h.guard.signal.aborted).toBe(true);
    expect(h.events.length).toBe(1);
    expect(h.events[0]!.event).toBe("error");
    expect(h.events[0]!.data.timedOut).toBe(true);
    expect(h.events[0]!.data.timeoutMs).toBe(1000);
    expect(String(h.events[0]!.data.error)).toContain("timed out");
    expect(h.isEnded()).toBe(true);
  });

  it("emits the error BEFORE ending — an event written after end() is dropped", () => {
    const h = harness(1000);
    h.tick();
    // The harness only records events while the response is still open, so a
    // non-empty log here IS the ordering assertion.
    expect(h.events.length).toBe(1);
  });

  it("stays silent on a client disconnect — nobody is listening", () => {
    const h = harness(1000);
    h.guard.clientGone();

    expect(h.guard.abortedBy()).toBe("client");
    expect(h.guard.signal.aborted).toBe(true);
    expect(h.events).toEqual([]);   // no error event
    expect(h.isEnded()).toBe(false); // and no res.end() on a dead socket
    expect(h.hasTimer()).toBe(false); // hang guard stood down
  });

  it("a timeout and a cancel are not the same event on the wire", () => {
    const timedOut = harness(1000);
    timedOut.tick();
    const cancelled = harness(1000);
    cancelled.guard.clientGone();

    // The whole bug in one assertion: these two used to be byte-identical
    // (nothing sent, stream closed), which is why the client could only ever
    // call both a cancel.
    expect(timedOut.events).not.toEqual(cancelled.events);
    expect(timedOut.events.some(e => e.event === "error" && e.data.timedOut === true)).toBe(true);
    expect(cancelled.events.some(e => e.event === "error")).toBe(false);
  });

  it("does not report a timeout after the client has already gone", () => {
    const h = harness(1000);
    h.guard.clientGone();
    h.tick();   // no-op: the timer was cleared, and kind is already set

    expect(h.guard.abortedBy()).toBe("client");
    expect(h.events).toEqual([]);
  });

  it("settle() stands the guard down so a completed solve cannot time out", () => {
    const h = harness(1000);
    h.guard.settle();
    h.tick();

    expect(h.wasCleared()).toBe(true);
    expect(h.guard.abortedBy()).toBe(null);
    expect(h.events).toEqual([]);
    expect(h.isEnded()).toBe(false);
  });

  it("never aborts twice / never changes its reason", () => {
    const h = harness(1000);
    h.tick();
    h.guard.clientGone();

    expect(h.guard.abortedBy()).toBe("timeout");
    expect(h.events.length).toBe(1);
  });
});

describe("analyse timeout budget vs the CG deadline (issue #347)", () => {
  it("sits strictly above the CG solver's own wall-clock backstop", () => {
    // The defect: a flat 120 s outer timeout killed solves the CG deadline
    // (600 s) explicitly allowed to keep running.
    expect(ANALYSE_TIMEOUT_MS).toBeGreaterThan(CG_DEADLINE_DEFAULT_MS);
    expect(ANALYSE_TIMEOUT_MS).toBe(CG_DEADLINE_DEFAULT_MS + ANALYSE_PIPELINE_MARGIN_MS);
  });

  it("leaves a real margin for meshing, assembly, recovery and mapping", () => {
    expect(ANALYSE_TIMEOUT_MS - CG_DEADLINE_DEFAULT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("names the elapsed budget in seconds in the message the user sees", () => {
    expect(analyseTimeoutEvent(900_000).error).toContain("900s");
    expect(analyseTimeoutEvent(900_000).hint).toContain(ANALYSE_TIMEOUT_ENV);
  });

  it("honours a positive numeric env override and ignores nonsense", () => {
    expect(analyseTimeoutMs({})).toBe(ANALYSE_TIMEOUT_MS);
    expect(analyseTimeoutMs({ [ANALYSE_TIMEOUT_ENV]: "45000" })).toBe(45_000);
    expect(analyseTimeoutMs({ [ANALYSE_TIMEOUT_ENV]: "  " })).toBe(ANALYSE_TIMEOUT_MS);
    expect(analyseTimeoutMs({ [ANALYSE_TIMEOUT_ENV]: "soon" })).toBe(ANALYSE_TIMEOUT_MS);
    expect(analyseTimeoutMs({ [ANALYSE_TIMEOUT_ENV]: "0" })).toBe(ANALYSE_TIMEOUT_MS);
    expect(analyseTimeoutMs({ [ANALYSE_TIMEOUT_ENV]: "-5" })).toBe(ANALYSE_TIMEOUT_MS);
  });
});
