/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — CORRECTION01.
 *
 * TartBackend real-process lifecycle tests. These exercise the
 * `spawn()` seam end-to-end through a FakeProcessRunner so no
 * actual `tart` binary is needed for closure.
 *
 * Coverage:
 *  - start() spawns (does NOT call run() with timeout).
 *  - start() does NOT terminate the spawned process.
 *  - stop() runs `tart stop` and then awaits the spawned handle's
 *    exited promise.
 *  - start() throws TART_START_FAILED if the spawned process
 *    exits within the 200ms probe window (binary missing case).
 *  - destroy() refuses a VM not owned by the run / this backend.
 */

import { describe, expect, it } from "bun:test";
import {
  FakeProcessRunner,
  type FakeProcessScript,
  type FakeSpawnScript,
} from "../src/process-runner.ts";
import { TartBackend } from "../src/tart-backend.ts";
import { TestbedError } from "../src/types.ts";

const RUN_SCRIPTS: readonly FakeProcessScript[] = [
  { argvPrefix: ["tart", "clone"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
  { argvPrefix: ["tart", "stop"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
  { argvPrefix: ["tart", "delete"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
  { argvPrefix: ["tart", "ip"], result: { exitCode: 0, signal: null, stdout: "192.0.2.10\n", stderr: "", timedOut: false, durationMs: 0 } },
  { argvPrefix: ["ssh"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
];

const RUN_SPAWN_SCRIPTS: readonly FakeSpawnScript[] = [
  { argvPrefix: ["tart", "run"] },
];

const VM_NAME = "clinemm-testbed-c01-rrabcd-abcdef";
const RUN_ID = "r-abcd1234";

function makeBackend(): { backend: TartBackend; proc: FakeProcessRunner } {
  const proc = new FakeProcessRunner(RUN_SCRIPTS, {
    strict: false,
    spawnScripts: RUN_SPAWN_SCRIPTS,
  });
  return { backend: new TartBackend(), proc };
}

describe("TartBackend CORRECTION01 process-lifecycle seam", () => {
  it("start uses spawn and retains it (does NOT call run with timeout)", async () => {
    const { backend, proc } = makeBackend();
    await backend.start({ vmName: VM_NAME }, proc);
    expect(proc.spawnCalls.length).toBe(1);
    expect(proc.spawnCalls[0]?.argv[0]).toBe("tart");
    expect(proc.spawnCalls[0]?.argv[1]).toBe("run");
    const runCallsForTartRun = proc.calls.filter(
      (c) => c.argv[0] === "tart" && c.argv[1] === "run",
    );
    expect(runCallsForTartRun.length).toBe(0);
    const handle = backend._getRunHandle();
    expect(handle).not.toBeNull();
    if (handle === null) throw new Error("expected handle");
    let exited = false;
    void handle.exited.then(() => { exited = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(exited).toBe(false);
  });

  it("start throws TART_START_FAILED if tart run exits within probe window", async () => {
    const proc = new FakeProcessRunner(
      [
        { argvPrefix: ["tart", "clone"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["tart", "stop"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["tart", "delete"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["tart", "ip"], result: { exitCode: 1, signal: null, stdout: "", stderr: "no VM", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["ssh"], result: { exitCode: 1, signal: null, stdout: "", stderr: "no route", timedOut: false, durationMs: 0 } },
      ],
      {
        strict: false,
        spawnScripts: [
          { argvPrefix: ["tart", "run"], autoExitMs: 150, terminateExitCode: 1 },
        ],
      },
    );
    const backend = new TartBackend();
    let caught: TestbedError | null = null;
    try {
      await backend.start({ vmName: VM_NAME }, proc);
    } catch (e) {
      caught = e as TestbedError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("TART_START_FAILED");
  });

  it("stop runs tart stop AND awaits the spawned tart run handle to exit", async () => {
    // autoExitMs must exceed the 200ms probe so start() returns
    // successfully, then fires while stop() is awaiting the
    // handle. The handle settles within stop()'s 5s wait window.
    const proc = new FakeProcessRunner(RUN_SCRIPTS, {
      strict: false,
      spawnScripts: [
        { argvPrefix: ["tart", "run"], autoExitMs: 400 },
      ],
    });
    const backend = new TartBackend();
    await backend.start({ vmName: VM_NAME }, proc);
    // Sanity: start retained the handle and did NOT kill it.
    expect(backend._getRunHandle()).not.toBeNull();
    await backend.stop({ vmName: VM_NAME }, proc);
    // After stop(), the handle has been awaited and resolved.
    expect(backend._getRunHandle()).toBeNull();
    // The `tart stop` request was issued.
    const stopCalls = proc.calls.filter(
      (c) => c.argv[0] === "tart" && c.argv[1] === "stop",
    );
    expect(stopCalls.length).toBe(1);
    // The spawned `tart run` handle has exited (and is no longer in liveSpawns).
    expect(proc.liveSpawns.length).toBe(0);
  });

  it("destroy refuses a VM not owned by the run", async () => {
    const { backend, proc } = makeBackend();
    let caught: TestbedError | null = null;
    try {
      await backend.destroy({ vmName: "foreign-vm-name", runId: RUN_ID }, proc);
    } catch (e) {
      caught = e as TestbedError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("TESTBED_VM_OWNERSHIP_UNPROVEN");
  });

  it("destroy refuses a VM not owned by this backend instance", async () => {
    const { backend, proc } = makeBackend();
    await backend.start({ vmName: VM_NAME }, proc);
    const foreignButOwned = "clinemm-testbed-other-rrother-zzzzzz";
    let caught: TestbedError | null = null;
    try {
      await backend.destroy({ vmName: foreignButOwned, runId: "r-other1234" }, proc);
    } catch (e) {
      caught = e as TestbedError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("TESTBED_VM_OWNERSHIP_UNPROVEN");
  });
});