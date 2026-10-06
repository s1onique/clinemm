/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 * Test C7, C8, C9 (SSH argv construction, hostile quoting).
 */

import { describe, expect, it } from "bun:test";
import {
  isValidGuestIp,
  quoteShellArgv,
  sshRemoteArgv,
} from "../src/ssh-argv.ts";

describe("isValidGuestIp", () => {
  it("accepts ipv4", () => expect(isValidGuestIp("10.0.0.42")).toBe(true));
  it("accepts ipv6", () => expect(isValidGuestIp("fe80::1")).toBe(true));
  it("rejects hostname", () => expect(isValidGuestIp("vm.example.com")).toBe(false));
  it("rejects empty", () => expect(isValidGuestIp("")).toBe(false));
});

describe("quoteShellArgv", () => {
  it("leaves safe tokens unquoted", () => {
    expect(quoteShellArgv(["echo", "hello", "world"])).toBe("echo hello world");
  });
  it("quotes tokens with spaces", () => {
    expect(quoteShellArgv(["echo", "hello world"])).toBe("echo 'hello world'");
  });
  it("escapes embedded single quotes", () => {
    expect(quoteShellArgv(["echo", "it's"])).toBe(`echo 'it'\\''s'`);
  });
  it("quotes empty tokens", () => {
    expect(quoteShellArgv(["echo", ""])).toBe("echo ''");
  });
});

describe("sshRemoteArgv", () => {
  const baseArgs = {
    guestIp: "10.0.0.42",
    user: "admin",
    remoteArgv: ["echo", "hello world"],
    identityFile: "/tmp/key",
  };

  it("produces canonical ssh flags + user@ip + quoted remote", () => {
    const r = sshRemoteArgv(baseArgs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const argv = [...r.argv];
    expect(argv[0]).toBe("ssh");
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("StrictHostKeyChecking=yes");
    expect(argv).toContain("IdentityFile=/tmp/key");
    expect(argv).toContain("admin@10.0.0.42");
    expect(argv.at(-1)).toBe("echo 'hello world'");
  });

  it("rejects empty user", () => {
    const r = sshRemoteArgv({ ...baseArgs, user: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-IP guestIp", () => {
    const r = sshRemoteArgv({ ...baseArgs, guestIp: "vm.example.com" });
    expect(r.ok).toBe(false);
  });

  it("forwards ConnectTimeout when provided", () => {
    const r = sshRemoteArgv({ ...baseArgs, connectTimeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.argv]).toContain("ConnectTimeout=5");
  });

  it("hostile remoteArgv is quoted as one shell-safe token", () => {
    const r = sshRemoteArgv({
      ...baseArgs,
      remoteArgv: ["sh", "-c", "rm -rf /; echo $(whoami)"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.argv].at(-1)).toBe(`sh -c 'rm -rf /; echo $(whoami)'`);
  });
});