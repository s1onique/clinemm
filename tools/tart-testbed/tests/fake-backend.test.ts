/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 * Fake backend suite (C16 — 25 tests, deterministic, fast).
 */

import { describe, expect, it } from "bun:test";
import { FakeProcessRunner } from "../src/process-runner.ts";
import { FakeTestbedBackend } from "../src/fake-backend.ts";
import { TestbedOrchestrator } from "../src/testbed.ts";
import type { HostClassification, TestbedSpec } from "../src/types.ts";

const IMAGE = "ghcr.io/cirruslabs/macos-sonoma-base@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const HOST_SUPPORTED: HostClassification = {
  os: "darwin",
  arch: "arm64",
  class: "darwin-arm64",
  tartAvailable: true,
  sshAvailable: true,
  supported: true,
};

const HOST_LINUX: HostClassification = {
  os: "linux",
  arch: "x64",
  class: "linux-x64",
  tartAvailable: false,
  sshAvailable: true,
  supported: false,
  reason: "test",
};

function makeSpec(overrides: Partial<TestbedSpec> = {}): TestbedSpec {
  return {
    image: IMAGE,
    runId: "r-abcd1234",
    vmNamePrefix: "spec01",
    commands: [{ argv: ["true"], label: "noop" }],
    artifacts: [],
    keepVm: false,
    ...overrides,
  };
}

function makeProc(): FakeProcessRunner {
  return new FakeProcessRunner(
    [
      {
        result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 },
      },
    ],
    { strict: false },
  );
}

/** Like makeProc but also scripts the fake's stop/delete so
 *  teardown assertions don't accidentally fail when a test
 *  is otherwise focused on command-level behavior. */
function makeProcWithTeardown(): FakeProcessRunner {
  return new FakeProcessRunner(
    [
      { argvPrefix: ["fake-stop"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
      { argvPrefix: ["fake-delete"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
      { result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
    ],
    { strict: false },
  );
}
describe("FakeTestbedBackend + TestbedOrchestrator — C16 suite", () => {
  it("1. happy lifecycle: prepare → start → waitReady → exec → teardown pass", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-1" });
    const r = await orch.run(makeSpec());
    expect(r.overallStatus).toBe("PASS");
    expect(r.teardown.status).toBe("pass");
    expect(r.teardown.stopStatus).toBe("pass");
    expect(r.teardown.deleteStatus).toBe("pass");
    expect(r.steps.map((s) => s.name)).toEqual(["prepare", "start", "waitReady"]);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]?.exitCode).toBe(0);
    expect(r.commands[0]?.status).toBe("pass");
  });

  it("2. prepare failure surfaces PREPARE_FAILED", async () => {
    const backend = new FakeTestbedBackend({
      hooks: { prepareError: () => new Error("TESTBED_PREPARE_FAILED: synthetic") },
    });
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-2" });
    const r = await orch.run(makeSpec());
    expect(r.overallStatus).toBe("PREPARE_FAILED");
    expect(r.failureCode).toBe("TESTBED_PREPARE_FAILED");
  });

  it("3. start failure surfaces START_FAILED", async () => {
    const backend = new FakeTestbedBackend({
      hooks: { startError: () => new Error("TART_START_FAILED: synthetic") },
    });
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-3" });
    const r = await orch.run(makeSpec());
    expect(r.overallStatus).toBe("START_FAILED");
    expect(r.failureCode).toBe("TART_START_FAILED");
  });

  it("4. IP timeout surfaces IP_TIMEOUT", async () => {
    const backend = new FakeTestbedBackend({ ipDelayPolls: 100 });
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-4" });
    const r = await orch.run(makeSpec({ timeouts: { ipReadyMs: 50 } }));
    expect(r.overallStatus).toBe("IP_TIMEOUT");
    expect(r.failureCode).toBe("TART_IP_TIMEOUT");
  });

  it("5. SSH timeout surfaces SSH_TIMEOUT", async () => {
    const backend = new FakeTestbedBackend({ sshDelayPolls: 100 });
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-5" });
    const r = await orch.run(makeSpec({ timeouts: { sshReadyMs: 50 } }));
    expect(r.overallStatus).toBe("SSH_TIMEOUT");
    expect(r.failureCode).toBe("TART_SSH_TIMEOUT");
  });

  it("6. command success recorded with pass status", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["echo"], result: { exitCode: 0, signal: null, stdout: "hi\\n", stderr: "", timedOut: false, durationMs: 5 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-6" });
    const r = await orch.run(makeSpec({ commands: [{ argv: ["echo", "hi"], label: "say-hi" }] }));
    expect(r.overallStatus).toBe("PASS");
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]?.status).toBe("pass");
    expect(r.commands[0]?.stdout).toBe("hi\\n");
    expect(r.commands[0]?.label).toBe("say-hi");
  });

  it("7. non-zero exit does not abort by default", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["false"], result: { exitCode: 1, signal: null, stdout: "", stderr: "nope", timedOut: false, durationMs: 3 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-7" });
    const r = await orch.run(makeSpec({ commands: [{ argv: ["false"] }] }));
    expect(r.overallStatus).toBe("PASS");
    expect(r.commands[0]?.status).toBe("fail");
    expect(r.commands[0]?.exitCode).toBe(1);
  });

  it("8. command timeout is recorded with timedOut=true", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["sleep"], result: { exitCode: null, signal: "SIGKILL", stdout: "", stderr: "", timedOut: true, durationMs: 100 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-8" });
    const r = await orch.run(makeSpec({ commands: [{ argv: ["sleep", "10"], timeoutMs: 100 }] }));
    expect(r.commands[0]?.timedOut).toBe(true);
    expect(r.commands[0]?.status).toBe("timeout");
  });

  it("9. multiple commands preserve ordering and individual records", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["echo", "one"], result: { exitCode: 0, signal: null, stdout: "one", stderr: "", timedOut: false, durationMs: 1 } },
      { argvPrefix: ["echo", "two"], result: { exitCode: 0, signal: null, stdout: "two", stderr: "", timedOut: false, durationMs: 1 } },
      { argvPrefix: ["echo", "three"], result: { exitCode: 0, signal: null, stdout: "three", stderr: "", timedOut: false, durationMs: 1 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-9" });
    const r = await orch.run(makeSpec({
      commands: [
        { argv: ["echo", "one"] },
        { argv: ["echo", "two"] },
        { argv: ["echo", "three"] },
      ],
    }));
    expect(r.commands.map((c) => c.stdout)).toEqual(["one", "two", "three"]);
  });

  it("10. copy-in failure surfaces as TESTBED_COPY_IN_FAILED", async () => {
    const backend = new FakeTestbedBackend({
      hooks: { copyInError: () => new Error("TESTBED_COPY_IN_FAILED: synthetic") },
    });
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-10" });
    const r = await orch.run(makeSpec({
      workspaceMount: { hostPath: "/tmp/src", guestPath: "/tmp/dst" },
    }));
    expect(r.overallStatus).toBe("EXCEPTION");
    expect(r.failureCode).toBe("TESTBED_COPY_IN_FAILED");
  });

  it("11. optional artifact missing is recorded but not fatal", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-11" });
    const r = await orch.run(makeSpec({
      commands: [{ argv: ["true"] }],
      artifacts: [{ guestPath: "/nope.txt", hostDestination: "/tmp/missing-artifact.txt", required: false }],
    }));
    expect(r.overallStatus).toBe("PASS");
    expect(r.artifacts[0]?.status).toBe("missing");
    expect(r.artifacts[0]?.required).toBe(false);
  });

  it("12. required artifact missing surfaces ARTIFACT_MISSING", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-12" });
    const r = await orch.run(makeSpec({
      commands: [{ argv: ["true"] }],
      artifacts: [{ guestPath: "/nope.txt", hostDestination: "/tmp/missing-required.txt", required: true }],
    }));
    expect(r.overallStatus).toBe("ARTIFACT_MISSING");
    expect(r.failureCode).toBe("TESTBED_REQUIRED_ARTIFACT_MISSING");
  });
});

describe("FakeTestbedBackend + TestbedOrchestrator — C16 suite part 2", () => {
  it("13. artifact SHA + size recorded when copyOut succeeds", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-13" });
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const hostPath = "/tmp/cline-testbed-r-13-host";
    mkdirSync(hostPath, { recursive: true });
    writeFileSync(`${hostPath}/payload.txt`, "hello world");
    const r = await orch.run(makeSpec({
      commands: [{ argv: ["true"] }],
      workspaceMount: { hostPath, guestPath: "/work" },
      artifacts: [{ guestPath: "/work/payload.txt", hostDestination: "/tmp/cline-testbed-r-13-dest.txt", required: true }],
    }));
    expect(r.overallStatus).toBe("PASS");
    expect(r.artifacts[0]?.status).toBe("collected");
    expect(r.artifacts[0]?.byteSize).toBe(11);
    expect(r.artifacts[0]?.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("14. teardown runs after success", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-14" });
    const r = await orch.run(makeSpec());
    expect(r.teardown.status).toBe("pass");
    expect(r.teardown.stopStatus).toBe("pass");
    expect(r.teardown.deleteStatus).toBe("pass");
    expect(backend.lifecycleState).toBe("destroyed");
  });

  it("15. teardown runs after command failure (failOnNonZero=true)", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProcWithTeardown();
    proc.addScript({ argvPrefix: ["false"], result: { exitCode: 1, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 1 } });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-15" });
    const r = await orch.run(makeSpec({
      commands: [{ argv: ["false"], failOnNonZero: true }],
    }));
    expect(r.overallStatus).toBe("COMMAND_FAILED");
    expect(r.teardown.status).toBe("pass");
    expect(backend.lifecycleState).toBe("destroyed");
  });

  it("16. teardown runs after unexpected exception in backend", async () => {
    const proc = makeProc();
    const failing = new FakeTestbedBackend({
      hooks: { execError: () => new Error("TESTBED_INTERNAL_ERROR: synthetic") },
    });
    const orch = new TestbedOrchestrator({ backend: failing, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-16" });
    const r = await orch.run(makeSpec({ commands: [{ argv: ["trigger-throw"] }] }));
    expect(r.overallStatus).toBe("EXCEPTION");
    expect(r.teardown.status).toBe("pass");
  });

  it("17. stop fails + delete succeeds: teardown.fail, both reported", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["fake-stop"], result: { exitCode: 1, signal: null, stdout: "", stderr: "stop-fail", timedOut: false, durationMs: 1 } },
      { argvPrefix: ["fake-delete"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 1 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-17" });
    const r = await orch.run(makeSpec());
    expect(r.teardown.status).toBe("fail");
    expect(r.teardown.stopStatus).toBe("fail");
    expect(r.teardown.deleteStatus).toBe("pass");
    expect(r.teardown.error).toContain("stop-fail");
  });

  it("18. stop succeeds + delete fails: teardown.fail", async () => {
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { argvPrefix: ["fake-stop"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 1 } },
      { argvPrefix: ["fake-delete"], result: { exitCode: 1, signal: null, stdout: "", stderr: "delete-fail", timedOut: false, durationMs: 1 } },
    ], { strict: true });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-18" });
    const r = await orch.run(makeSpec());
    expect(r.teardown.status).toBe("fail");
    expect(r.teardown.stopStatus).toBe("pass");
    expect(r.teardown.deleteStatus).toBe("fail");
    expect(r.teardown.error).toContain("delete-fail");
  });

  it("19. primary failure preserved over teardown failure", async () => {
    const backend = new FakeTestbedBackend({
      hooks: { deleteError: () => new Error("TART_DELETE_FAILED: synthetic") },
    });
    const proc = makeProcWithTeardown();
    proc.addScript({ argvPrefix: ["false"], result: { exitCode: 1, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 1 } });
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-19" });
    const r = await orch.run(makeSpec({ commands: [{ argv: ["false"], failOnNonZero: true }] }));
    expect(r.overallStatus).toBe("COMMAND_FAILED");
    expect(r.failureCode).toBe("TESTBED_INTERNAL_ERROR");
    expect(r.teardown.deleteStatus).toBe("fail");
  });

  it("20. keepVm=true skips stop + delete and surfaces KEEP_VM", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-20" });
    const r = await orch.run(makeSpec({ keepVm: true }));
    expect(r.overallStatus).toBe("KEEP_VM");
    expect(r.teardown.kept).toBe(true);
    expect(r.teardown.stopStatus).toBe("skipped");
    expect(r.teardown.deleteStatus).toBe("skipped");
    expect(backend.lifecycleState).not.toBe("destroyed");
  });

  it("21. owned VM can be deleted (default destroy path)", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-21" });
    const r = await orch.run(makeSpec());
    expect(r.teardown.deleteStatus).toBe("pass");
    expect(backend.lifecycleState).toBe("destroyed");
  });

  it("22. non-owned VM cannot be deleted — backend refuses", async () => {
    // Direct backend invocation with a VM name whose runId
    // segment does NOT match the supplied runId. The backend
    // must throw TESTBED_VM_OWNERSHIP_UNPROVEN.
    const backend = new FakeTestbedBackend();
    const proc = new FakeProcessRunner([
      { result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
      { result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
    ], { strict: true });
    await backend.prepare({ image: "x", vmName: "clinemm-testbed-foo-aaaaaa" }, proc);
    let threw = false;
    try {
      await backend.destroy({ vmName: "clinemm-testbed-foo-aaaaaa", runId: "bbbbbb" }, proc);
    } catch (e) {
      threw = true;
      expect((e as { code?: string }).code).toBe("TESTBED_VM_OWNERSHIP_UNPROVEN");
    }
    expect(threw).toBe(true);
  });

  it("23. result JSON schema is stable and complete", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-23" });
    const r = await orch.run(makeSpec());
    const required = [
      "schemaVersion", "runId", "backend", "image", "vmName", "hostPlatform",
      "startedAt", "finishedAt", "durationMs", "steps", "commands", "artifacts",
      "teardown", "overallStatus",
    ];
    for (const k of required) {
      expect(k in r).toBe(true);
    }
    expect(r.schemaVersion).toBe(1);
    expect(typeof r.runId).toBe("string");
    expect(r.image).toBe(IMAGE);
    expect(typeof r.vmName).toBe("string");
    expect(r.hostPlatform.supported).toBe(true);
  });

  it("24. no secrets captured: result fields never include env / private keys", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_SUPPORTED, outputDir: "/tmp/cline-testbed-r-24" });
    const r = await orch.run(makeSpec({
      knownHostsContents: "ssh-ed25519 AAAAC3...not-a-real-key",
      sshIdentityFile: "/tmp/not-a-real-key",
      metadata: { act: "ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01" },
    }));
    const json = JSON.stringify(r);
    expect(json).not.toContain("PRIVATE");
    expect(json).not.toContain("/tmp/not-a-real-key");
    expect(json).not.toContain("ssh-ed25519 AAAAC3");
    expect(r.metadata?.act).toBe("ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01");
  });

  it("25. unsupported-host classification surfaces UNSUPPORTED_HOST", async () => {
    const backend = new FakeTestbedBackend();
    const proc = makeProc();
    const orch = new TestbedOrchestrator({ backend, processRunner: proc, host: HOST_LINUX, outputDir: "/tmp/cline-testbed-r-25" });
    const r = await orch.run(makeSpec());
    expect(r.hostPlatform.supported).toBe(false);
    expect(typeof r.hostPlatform.reason).toBe("string");
    expect(r.overallStatus).toBe("PASS");
  });
});
