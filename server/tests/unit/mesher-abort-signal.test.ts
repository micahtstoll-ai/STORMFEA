/**
 * mesher-abort-signal.test.ts — issue #345.
 * ------------------------------------------
 * Root cause: cancelling an analysis mid-mesh did nothing to the running
 * TetGen/Gmsh subprocess. Both meshers are spawned with `execFile` (promisified
 * as `execFileAsync`), and neither call received the request's AbortSignal —
 * so the request-level `checkAbort()` in analysis.ts could only notice a
 * cancellation AFTER the mesher call's `await` resolved, by which point the
 * child process had already run to completion (or its own unrelated 120s
 * hang-guard timeout).
 *
 * Node's `child_process.execFile` accepts a `signal` option: when the passed
 * AbortSignal fires, Node sends SIGTERM to the child immediately. The fix
 * threads the request's AbortSignal down through:
 *   analysis.ts (req.signal)
 *     -> meshWithTetGen / meshWithTetGenSizing (tetgen.ts)
 *       -> tryTetGen (tetgen.ts, private) -> execFileAsync({ signal })
 *     -> meshStepWithGmsh (gmsh_mesh.ts) -> execFileAsync({ signal })
 *
 * This sandbox has neither binary installed, so this file mocks
 * `child_process.execFile` and asserts the `signal` option actually reaches
 * the exec call with the exact AbortSignal instance the caller passed in, for
 * both mesher paths. A companion end-to-end test
 * (mesher-integration.test.ts) exercises the real binaries when present and
 * self-skips otherwise, following the same convention as this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface CapturedExecFileCall {
  file:    string;
  args:    string[];
  options: Record<string, unknown>;
}

const tetgenCalls: CapturedExecFileCall[] = [];
const gmshCalls: CapturedExecFileCall[] = [];

// Mocked at the child_process level (rather than mocking tetgen.ts/gmsh_mesh.ts
// themselves) so the real `promisify(execFile)` wiring in both modules is what
// gets exercised — this is what proves `signal` survives the actual call, not
// just that a test double was told to expect it.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFile: (
      file: string,
      argsOrOptionsOrCb?: unknown,
      optionsOrCb?: unknown,
      maybeCb?: unknown,
    ) => {
      // Normalize execFile's (args?, options?, callback) overloads.
      let args: string[] = [];
      let options: Record<string, unknown> = {};
      let callback: (err: NodeJS.ErrnoException | null) => void;
      if (typeof argsOrOptionsOrCb === "function") {
        callback = argsOrOptionsOrCb as typeof callback;
      } else if (typeof optionsOrCb === "function") {
        args = (argsOrOptionsOrCb as string[]) ?? [];
        callback = optionsOrCb as typeof callback;
      } else {
        args = (argsOrOptionsOrCb as string[]) ?? [];
        options = (optionsOrCb as Record<string, unknown>) ?? {};
        callback = maybeCb as typeof callback;
      }

      const call: CapturedExecFileCall = { file, args, options };
      if (file.toLowerCase().includes("gmsh")) gmshCalls.push(call);
      else tetgenCalls.push(call);

      // Fail every invocation with a non-ENOENT error, so callers treat it as
      // a real (if unsuccessful) run rather than "binary missing" — this
      // exercises the actual `tryTetGen` / `meshStepWithGmsh` error paths
      // without needing a real binary to succeed.
      const err = Object.assign(new Error("mock exec failure — no real binary in this test"), {
        code: "EMOCKFAIL",
      });
      queueMicrotask(() => callback(err));
      // execFile normally returns the ChildProcess; nothing here reads it.
      return undefined as unknown as ReturnType<typeof actual.execFile>;
    },
  };
});

const { meshWithTetGen } = await import("../../tetgen.js");
const { meshStepWithGmsh } = await import("../../gmsh_mesh.js");

// A minimal watertight tetrahedron soup — just enough for weldVertices / the
// OFF writer to run; the mocked TetGen never actually meshes it.
function tinyTetSoup(): { positions: Float32Array; triangleCount: number } {
  const verts: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3],
  ];
  const positions = new Float32Array(faces.length * 9);
  faces.forEach((f, fi) => f.forEach((vi_, k) => {
    const v = verts[vi_]!;
    positions[fi * 9 + k * 3]     = v[0];
    positions[fi * 9 + k * 3 + 1] = v[1];
    positions[fi * 9 + k * 3 + 2] = v[2];
  }));
  return { positions, triangleCount: faces.length };
}

beforeEach(() => {
  tetgenCalls.length = 0;
  gmshCalls.length = 0;
});

describe("issue #345: AbortSignal threaded into the mesher subprocess", () => {
  it("meshWithTetGen passes the given signal to every execFile attempt", async () => {
    const controller = new AbortController();
    const { positions, triangleCount } = tinyTetSoup();

    await expect(
      meshWithTetGen(positions, triangleCount, 2, 10, controller.signal),
    ).rejects.toThrow(); // mocked execFile always fails -> exhausts the fallback ladder

    expect(tetgenCalls.length).toBeGreaterThan(0);
    for (const call of tetgenCalls) {
      expect(call.options["signal"]).toBe(controller.signal);
      // The 120s hang-guard timeout must stay as a backstop (constraint #3) —
      // signal is additive, not a replacement.
      expect(call.options["timeout"]).toBe(120_000);
    }
  });

  it("meshWithTetGen omits signal (undefined) when the caller passes none", async () => {
    const { positions, triangleCount } = tinyTetSoup();

    await expect(
      meshWithTetGen(positions, triangleCount, 2, 10),
    ).rejects.toThrow();

    expect(tetgenCalls.length).toBeGreaterThan(0);
    for (const call of tetgenCalls) {
      expect(call.options["signal"]).toBeUndefined();
    }
  });

  it("meshStepWithGmsh passes the given signal to execFile", async () => {
    const controller = new AbortController();
    const step = Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

    await expect(
      meshStepWithGmsh(step, { clMin: 1, clMax: 2, clCurv: 10, elementOrder: 1, signal: controller.signal }),
    ).rejects.toThrow(); // mocked execFile fails -> "Gmsh failed: ..."

    expect(gmshCalls.length).toBe(1);
    expect(gmshCalls[0]!.options["signal"]).toBe(controller.signal);
    expect(gmshCalls[0]!.options["timeout"]).toBe(120_000);
  });

  it("meshStepWithGmsh omits signal (undefined) when the caller passes none", async () => {
    const step = Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

    await expect(
      meshStepWithGmsh(step, { clMin: 1, clMax: 2, clCurv: 10, elementOrder: 1 }),
    ).rejects.toThrow();

    expect(gmshCalls.length).toBe(1);
    expect(gmshCalls[0]!.options["signal"]).toBeUndefined();
  });

  it("an already-aborted signal makes execFile receive an aborted signal instance", async () => {
    // Not a full subprocess-kill test (no real binary in this sandbox — see
    // header), but proves the exact AbortSignal instance reaches execFile
    // already in the aborted state, which is what makes Node deliver SIGTERM
    // to a real child immediately rather than waiting out the 120s timeout.
    const controller = new AbortController();
    controller.abort();
    const { positions, triangleCount } = tinyTetSoup();

    await expect(
      meshWithTetGen(positions, triangleCount, 2, 10, controller.signal),
    ).rejects.toThrow();

    expect(tetgenCalls.length).toBeGreaterThan(0);
    for (const call of tetgenCalls) {
      const passedSignal = call.options["signal"] as AbortSignal;
      expect(passedSignal).toBe(controller.signal);
      expect(passedSignal.aborted).toBe(true);
    }
  });
});
