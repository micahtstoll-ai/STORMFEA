/**
 * assembly-pool.ts
 * ----------------
 * Persistent lazy worker pool for parallel stiffness assembly (issue #98).
 *
 * Workers are spawned on first use and kept alive across assembly calls —
 * the Express server is long-running, so the spawn cost (module load per
 * worker) is paid once, not per analysis.
 *
 * Lifecycle discipline:
 *  - Idle workers are unref()'d, so plain node scripts (solver_validation,
 *    test-parallel-assembly) exit naturally with no explicit teardown; the
 *    OS reaps the threads at process exit.
 *  - A worker is ref()'d synchronously before postMessage and unref()'d when
 *    its job settles — the ref'd worker (not the awaited promise) is what
 *    holds the event loop open during a solve.
 *  - Persistent 'error'/'exit' handlers are installed at spawn: an 'error'
 *    event with no listener would crash the process even while idle. They
 *    settle any in-flight job exactly once and evict the worker; intentional
 *    terminate() (timeout/destroy) is flagged so its 'exit' event is not
 *    reported as a crash.
 *  - On job timeout only the offending worker is terminated and evicted;
 *    sibling jobs settle naturally. The pool tops itself up on the next call.
 *  - Whole assembly calls are serialized by a promise-chain mutex: two
 *    concurrent analyses queue rather than the second finding every worker
 *    busy and failing to serial for no reason.
 */

import { Worker } from "worker_threads";

interface PoolWorker {
  readonly worker: Worker;
  busy: boolean;
  /** Reject the in-flight job (set while busy) — used by the persistent
   *  error/exit handlers. Job-side settling clears it first. */
  settle: ((err: Error) => void) | null;
  /** True when the pool itself called terminate() (timeout or destroy),
   *  so the resulting nonzero 'exit' must not be reported as a crash. */
  terminating: boolean;
}

let pool: PoolWorker[] = [];
let poolScript: string | null = null;

/** Promise-chain mutex serializing whole runAssemblyJobs calls. */
let poolMutex: Promise<void> = Promise.resolve();

function evict(pw: PoolWorker): void {
  const i = pool.indexOf(pw);
  if (i >= 0) pool.splice(i, 1);
}

function spawnWorker(script: string): PoolWorker {
  const worker = new Worker(script);
  const pw: PoolWorker = { worker, busy: false, settle: null, terminating: false };
  worker.on("error", (err) => {
    const settle = pw.settle;
    pw.settle = null;
    evict(pw);
    settle?.(err instanceof Error ? err : new Error(String(err)));
  });
  worker.on("exit", (code) => {
    evict(pw);
    if (!pw.terminating && code !== 0) {
      const settle = pw.settle;
      pw.settle = null;
      settle?.(new Error(`assembly worker exited unexpectedly with code ${code}`));
    }
  });
  worker.unref();  // idle by default — never holds the event loop open
  return pw;
}

/** Run one job on one pooled worker; resolves with the worker's reply. */
function dispatch(pw: PoolWorker, payload: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;

    const settleOnce = (err: Error | null, result?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pw.worker.off("message", onMessage);
      pw.settle = null;
      pw.busy = false;
      pw.worker.unref();
      if (err) reject(err); else resolve(result);
    };

    const onMessage = (msg: { success?: boolean; error?: string }): void => {
      if (msg && msg.success) settleOnce(null, msg);
      else settleOnce(new Error(`assembly worker error: ${msg?.error ?? "unknown"}`));
    };

    const timer = setTimeout(() => {
      // Shoot only this worker; the job rejects, the caller falls back to
      // serial, siblings settle naturally and return to idle.
      pw.terminating = true;
      evict(pw);
      void pw.worker.terminate();
      settleOnce(new Error(`assembly worker timeout after ${timeoutMs} ms`));
    }, timeoutMs);

    pw.settle = (err) => settleOnce(err);
    pw.busy = true;
    pw.worker.ref();  // synchronously before postMessage — holds the loop open
    pw.worker.on("message", onMessage);
    pw.worker.postMessage(payload);
  });
}

/**
 * Run one job per payload on the persistent pool, spawning workers lazily
 * (and topping up after evictions) as needed. Resolves with the workers'
 * replies in payload order; rejects if any job fails or times out.
 *
 * Calls are serialized: a second concurrent call waits for the first.
 */
export async function runAssemblyJobs(
  script:    string,
  payloads:  readonly unknown[],
  timeoutMs: number,
): Promise<unknown[]> {
  const prev = poolMutex;
  let release!: () => void;
  poolMutex = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    if (poolScript !== script) {
      // Script path changed (should not happen in practice) — start fresh.
      await destroyPoolUnlocked();
      poolScript = script;
    }
    const idle = pool.filter((pw) => !pw.busy);
    while (idle.length < payloads.length) {
      const pw = spawnWorker(script);
      pool.push(pw);
      idle.push(pw);
    }
    return await Promise.all(payloads.map((p, i) => dispatch(idle[i]!, p, timeoutMs)));
  } finally {
    release();
  }
}

async function destroyPoolUnlocked(): Promise<void> {
  const workers = pool.slice();
  pool = [];
  poolScript = null;
  await Promise.all(workers.map((pw) => {
    pw.terminating = true;
    pw.settle?.(new Error("assembly pool destroyed"));
    pw.settle = null;
    return pw.worker.terminate();
  }));
}

/**
 * Terminate every pooled worker and clear the pool. Not required for natural
 * process exit (idle workers are unref()'d) — exported for explicit teardown,
 * e.g. future server shutdown wiring.
 */
export async function destroyAssemblyPool(): Promise<void> {
  const prev = poolMutex;
  let release!: () => void;
  poolMutex = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    await destroyPoolUnlocked();
  } finally {
    release();
  }
}
