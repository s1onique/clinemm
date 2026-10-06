/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 * Test C15 (host compatibility — clean classification, no stack
 * traces).
 */

import { describe, expect, it } from "bun:test";
import { classifyHostPure } from "../src/host-classification.ts";

describe("classifyHostPure", () => {
  it("darwin-arm64 + tart + ssh => supported", () => {
    const r = classifyHostPure({ os: "darwin", arch: "arm64", tartAvailable: true, sshAvailable: true });
    expect(r.supported).toBe(true);
    expect(r.class).toBe("darwin-arm64");
    expect(r.reason).toBeUndefined();
  });

  it("linux-x64 => unsupported with reason", () => {
    const r = classifyHostPure({ os: "linux", arch: "x64", tartAvailable: true, sshAvailable: true });
    expect(r.supported).toBe(false);
    expect(r.class).toBe("linux-x64");
    expect(typeof r.reason).toBe("string");
    expect(r.reason).toContain("Virtualization.framework");
  });

  it("darwin-arm64 but tart missing => unsupported", () => {
    const r = classifyHostPure({ os: "darwin", arch: "arm64", tartAvailable: false, sshAvailable: true });
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("tart");
  });

  it("darwin-arm64 but ssh missing => unsupported", () => {
    const r = classifyHostPure({ os: "darwin", arch: "arm64", tartAvailable: true, sshAvailable: false });
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("ssh");
  });

  it("windows + arm64 => other class", () => {
    const r = classifyHostPure({ os: "win32", arch: "arm64", tartAvailable: false, sshAvailable: false });
    expect(r.class).toBe("other");
    expect(r.supported).toBe(false);
  });
});