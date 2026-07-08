/**
 * solver.worker.js
 * ────────────────
 * Web Worker for background FEA solver communication.
 * Runs heavy solver requests without blocking the main UI thread.
 *
 * Messages received:
 *   { type: 'analyzeRequest', payload: analysisBody, id: string }
 *
 * Messages sent:
 *   { type: 'result', id: string, data: analysisResult }
 *   { type: 'error', id: string, message: string }
 */

const SOLVER_TIMEOUT_MS = 120_000;
const abortControllers = new Map();

self.onmessage = async (event) => {
  const { type, payload, id } = event.data;

  if (type !== 'analyzeRequest') {
    return;
  }

  const abortController = new AbortController();
  abortControllers.set(id, abortController);

  try {
    // Create timeout guard
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, SOLVER_TIMEOUT_MS);

    const response = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const errorMsg = response.status === 0 ? 'Network error or worker terminated' : errorText;
      self.postMessage({
        type: 'error',
        id,
        message: errorMsg,
      });
      return;
    }

    const data = await response.json();
    self.postMessage({
      type: 'result',
      id,
      data,
    });
  } catch (error) {
    let errorMsg = 'Unknown error';

    if (error.name === 'AbortError') {
      errorMsg = `Solver timed out after ${SOLVER_TIMEOUT_MS / 1000}s. Server may be unresponsive.`;
    } else if (error instanceof TypeError) {
      errorMsg = `Network error: ${error.message}`;
    } else {
      errorMsg = error?.message || String(error);
    }

    self.postMessage({
      type: 'error',
      id,
      message: errorMsg,
    });
  } finally {
    abortControllers.delete(id);
  }
};

// Handle worker termination
self.onmessageerror = (event) => {
  console.error('[solver-worker] message error:', event);
};
