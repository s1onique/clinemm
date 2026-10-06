/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — CORRECTION01.
 *
 * CLI wiring: the (backendKind, allowVm, host) decision is now
 * a pure function. These tests prove the reviewer-flagged seam
 * is closed:
 *
 *   --backend fake  -> FakeProcessRunner + FakeTestbedBackend
 *   --backend tart without --allow-vm -> rejected
 *   --backend tart --allow-vm on unsupported host -> rejected
 *   --backend tart --allow-vm on supported host ->
 *       RealProcessRunner + TartBackend (the real seam)
 */

import { describe, expect, it } from "bun:test";
import { selectCliRunner } from "../src/cli.ts";
import { FakeTestbedBackend } from "../src/fake-backend.ts";
import { FakeProcessRunner, RealProcessRunner } from "../src/process-runner.ts";
import { TartBackend } from "../src/tart-backend.ts";
import type { HostClassification } from "../src/types.ts";

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

const HOST_DARWIN_ARM64_NO_TART: HostClassification = {
  os: "darwin",
  arch: "arm64",
  class: "darwin-arm64",
  tartAvailable: false,
  sshAvailable: true,
  supported: false,
  reason: "tart not on PATH",
};

describe("CLI runner wiring (CORRECTION01)", () => {
  it("--backend fake defaults to FakeProcessRunner + FakeTestbedBackend", () => {
    const w = selectCliRunner("fake", false, HOST_SUPPORTED);
    expect(w.kind).toBe("fake");
    expect(w.proc).toBeInstanceOf(FakeProcessRunner);
    expect(w.backend).toBeInstanceOf(FakeTestbedBackend);
  });

  it("--backend tart without --allow-vm is rejected on any host", () => {
    const w = selectCliRunner("tart", false, HOST_SUPPORTED);
    expect(w.kind).toBe("rejected");
    expect(w.rejectReason).toMatch(/--allow-vm/);
  });

  it("--backend tart --allow-vm on unsupported host is rejected (fail-closed)", () => {
    const w = selectCliRunner("tart", true, HOST_LINUX);
    expect(w.kind).toBe("rejected");
    expect(w.rejectReason).toMatch(/host not supported/);
  });

  it("--backend tart --allow-vm on supported host uses RealProcessRunner + TartBackend", () => {
    const w = selectCliRunner("tart", true, HOST_SUPPORTED);
    expect(w.kind).toBe("tart");
    // The decisive proof: NOT a FakeProcessRunner.
    expect(w.proc).toBeInstanceOf(RealProcessRunner);
    expect(w.proc).not.toBeInstanceOf(FakeProcessRunner);
    expect(w.backend).toBeInstanceOf(TartBackend);
    expect(w.backend).not.toBeInstanceOf(FakeTestbedBackend);
  });

  it("--backend tart --allow-vm on darwin-arm64 with no tart binary is rejected", () => {
    const w = selectCliRunner("tart", true, HOST_DARWIN_ARM64_NO_TART);
    expect(w.kind).toBe("rejected");
    expect(w.rejectReason).toMatch(/host not supported/);
  });
});