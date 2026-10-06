/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 * Test C17 (Tart command-construction tests) and C3 (argv-only).
 *
 * Verify that:
 *   - each helper returns the documented argv shape
 *   - hostile input strings stay as ONE argv element (no shell
 *     interpolation, no escaping)
 *   - validateImageRef rejects tag-only / malformed refs
 */

import { describe, expect, it } from "bun:test";
import {
  tartCloneArgv,
  tartDeleteArgv,
  tartIpArgv,
  tartListArgv,
  tartRunArgv,
  tartStopArgv,
  tartVersionArgv,
  validateImageRef,
} from "../src/tart-cli.ts";

const IMAGE = "ghcr.io/cirruslabs/macos-sonoma-base@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("tart-cli argv construction", () => {
  it("tart clone: [tart, clone, image, vm]", () => {
    expect([...tartCloneArgv({ image: IMAGE, vmName: "v1" })]).toEqual([
      "tart",
      "clone",
      IMAGE,
      "v1",
    ]);
  });

  it("tart run: includes --no-graphics and forwards optional flags", () => {
    expect([...tartRunArgv({ vmName: "v1" })]).toEqual(["tart", "run", "--no-graphics", "v1"]);
    expect([...tartRunArgv({ vmName: "v1", cpu: 4, memoryMiB: 8192, diskGiB: 64 })]).toEqual([
      "tart",
      "run",
      "--no-graphics",
      "--cpu",
      "4",
      "--memory",
      "8192",
      "--disk-size",
      "64",
      "v1",
    ]);
  });

  it("tart run: noGraphics=false omits --no-graphics", () => {
    expect([...tartRunArgv({ vmName: "v1", noGraphics: false })]).toEqual(["tart", "run", "v1"]);
  });

  it("tart ip: [tart, ip, vm]", () => {
    expect([...tartIpArgv("v1")]).toEqual(["tart", "ip", "v1"]);
  });

  it("tart stop: [tart, stop, vm]", () => {
    expect([...tartStopArgv("v1")]).toEqual(["tart", "stop", "v1"]);
  });

  it("tart delete: [tart, delete, vm]", () => {
    expect([...tartDeleteArgv("v1")]).toEqual(["tart", "delete", "v1"]);
  });

  it("tart list: [tart, list]", () => {
    expect([...tartListArgv()]).toEqual(["tart", "list"]);
  });

  it("tart --version: [tart, --version]", () => {
    expect([...tartVersionArgv()]).toEqual(["tart", "--version"]);
  });
});

describe("tart-cli argv never embeds shell metacharacters as separate elements", () => {
  const hostileImage = "foo; rm -rf /";
  const hostileVm = "$(evil)";

  it("hostile image stays as one argv element in tart clone", () => {
    const argv = tartCloneArgv({ image: hostileImage, vmName: "v1" });
    expect(argv).toHaveLength(4);
    expect(argv[2]).toBe(hostileImage);
    expect(argv[3]).toBe("v1");
  });

  it("hostile vm name stays as one argv element in tart clone", () => {
    const argv = tartCloneArgv({ image: IMAGE, vmName: hostileVm });
    expect(argv).toHaveLength(4);
    expect(argv[3]).toBe(hostileVm);
  });

  it("hostile name stays as one argv element in tart run / ip / stop / delete", () => {
    expect(tartRunArgv({ vmName: hostileVm }).at(-1)).toBe(hostileVm);
    expect(tartIpArgv(hostileVm).at(-1)).toBe(hostileVm);
    expect(tartStopArgv(hostileVm).at(-1)).toBe(hostileVm);
    expect(tartDeleteArgv(hostileVm).at(-1)).toBe(hostileVm);
  });

  it("hostile name with newlines/quotes stays as one argv element", () => {
    const evil = "v\nm\n$(cat /etc/shadow)'\"`";
    const argv = tartRunArgv({ vmName: evil });
    expect(argv.at(-1)).toBe(evil);
    expect(argv).toHaveLength(4); // tart, run, --no-graphics, vmName
  });
});

describe("validateImageRef", () => {
  it("accepts registry/path@sha256:<64-hex-digest>", () => {
    expect(validateImageRef(IMAGE)).toEqual({ ok: true });
  });

  it("rejects tag-only references", () => {
    expect(validateImageRef("ghcr.io/foo/bar:latest").ok).toBe(false);
    expect(validateImageRef("ghcr.io/foo/bar:v1").ok).toBe(false);
  });

  it("rejects empty / wrong length digest", () => {
    expect(validateImageRef("foo@sha256:abc").ok).toBe(false);
    expect(validateImageRef("foo@sha256:" + "0".repeat(63)).ok).toBe(false);
    expect(validateImageRef("foo@sha256:" + "g".repeat(64)).ok).toBe(false); // non-hex
  });

  it("rejects empty input", () => {
    expect(validateImageRef("").ok).toBe(false);
  });
});