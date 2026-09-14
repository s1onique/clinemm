/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 *
 * Unit tests for runner.ts.
 *
 * Focus areas:
 *   - argv validation (subject_head, vsix_sha256)
 *   - tartEnvSane() returns ok=false when tart is missing
 *     OR when TART_HOME is not writable (this is the substrate
 *     signal that triggers HALT_BASE_IMAGE_NOT_READY).
 *   - vmNameFor() produces names that fit Tart's length limit
 *     and are URL-safe.
 *
 * Substrate-heavy paths (tart clone/run/etc.) are NOT unit-tested
 * here; those are exercised by integration tests in a
 * substrate-eligible environment.
 */

import { describe, expect, it } from "bun:test"
import {
  run,
  tartEnvSane,
  vmNameFor,
  sshCommandForGuest,
  editorBaseline,
  buildKnownHostsFileContents,
} from "./runner.ts"

describe("runner argv validation", () => {
  const argv = [
    "runner.ts",
    "abc123",
    "1".repeat(40),
    "/tmp/foo.vsix",
    "a".repeat(64),
  ]

  it("rejects missing argv fields", async () => {
    const r = await run([])
    expect(r).not.toHaveProperty("result")
    if (!("result" in r)) expect(r.error).toBe("INTERNAL_ERROR")
  })

  it("rejects malformed subject_head", async () => {
    const r = await run([
      "runner.ts",
      "abc123",
      "not-hex",
      "/tmp/foo.vsix",
      "a".repeat(64),
    ])
    expect(r).not.toHaveProperty("result")
    if (!("result" in r)) expect(r.error).toBe("INTERNAL_ERROR")
  })

  it("rejects malformed vsix_sha256", async () => {
    const r = await run([
      "runner.ts",
      "abc123",
      "1".repeat(40),
      "/tmp/foo.vsix",
      "not-hex",
    ])
    expect(r).not.toHaveProperty("result")
    if (!("result" in r)) expect(r.error).toBe("INTERNAL_ERROR")
  })

  it("rejects subject_head of wrong length", async () => {
    const r = await run([
      "runner.ts",
      "abc123",
      "1".repeat(39),
      "/tmp/foo.vsix",
      "a".repeat(64),
    ])
    expect(r).not.toHaveProperty("result")
    if (!("result" in r)) expect(r.error).toBe("INTERNAL_ERROR")
  })

  it("rejects vsix_sha256 of wrong length", async () => {
    const r = await run([
      "runner.ts",
      "abc123",
      "1".repeat(40),
      "/tmp/foo.vsix",
      "a".repeat(63),
    ])
    expect(r).not.toHaveProperty("result")
    if (!("result" in r)) expect(r.error).toBe("INTERNAL_ERROR")
  })
})

describe("tartEnvSane()", () => {
  it("returns ok=false with a reason when tart --version fails", async () => {
    // Force PATH to a directory with no tart binary.
    const r = await (async () => {
      const prev = process.env.PATH
      process.env.PATH = "/tmp/clinemm-testbed-no-tart"
      try {
        return await tartEnvSane()
      } finally {
        process.env.PATH = prev
      }
    })()
    expect(r.ok).toBe(false)
    expect(r.reason).toBeDefined()
  })
})

describe("vmNameFor()", () => {
  it("produces names of bounded length", () => {
    const name = vmNameFor("x".repeat(1000))
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name.startsWith("clinemm-probe-")).toBe(true)
  })

  it("sanitizes unsafe request_id characters", () => {
    const name = vmNameFor("../../etc/passwd; rm -rf /")
    expect(name.includes("/")).toBe(false)
    expect(name.includes("..")).toBe(false)
    expect(name.includes(";")).toBe(false)
    expect(name.includes(" ")).toBe(false)
  })

  it("includes the timestamp suffix to avoid collisions", async () => {
    const a = vmNameFor("abc")
    // ensure the next call lands on a later millisecond
    await new Promise((r) => setTimeout(r, 5))
    const b = vmNameFor("abc")
    expect(a).not.toBe(b)
  })
})

describe("CORRECTION03: sshCommandForGuest() — pinned-key contract", () => {
  const PINNED_DIGEST =
    "ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49"
  const PINNED_HOST_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  const KNOWN_HOSTS_FILE = "/tmp/clinemm-test-known-hosts"

  it("builds ssh argv with BatchMode=yes, IdentitiesOnly=yes, IdentityFile pinned", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cmd).toContain("ssh")
      expect(r.cmd).toContain("BatchMode=yes")
      expect(r.cmd).toContain("IdentitiesOnly=yes")
      expect(r.cmd).toContain("IdentityFile=/tmp/clinemm-test-key")
      expect(r.cmd).toContain("PreferredAuthentications=publickey")
      expect(r.cmd).toContain("admin@10.0.0.1")
      expect(r.cmd).toContain("true")
    }
  })

  it("ssh argv contains no `-p <password>` and no sshpass", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cmd).not.toContain("sshpass")
      expect(r.cmd).not.toContain("-p admin")
      const idx = r.cmd.indexOf("-p")
      if (idx >= 0) {
        expect(r.cmd[idx + 1]).not.toBe("admin")
      }
    }
  })

  it("rejects when pinnedImageDigest lacks a sha256: digest", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: "ghcr.io/cirruslabs/macos-sonoma-base:latest",
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("sha256:")
    }
  })

  it("P1 (round 3): rejects malformed @sha256: reference (not-a-digest)", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: "registry.example/foo@sha256:not-a-digest",
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  it("P1 (round 3): rejects truncated sha256 digest (63 hex chars)", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: "registry.example/foo@sha256:" + "a".repeat(63),
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  it("P1 (round 3): accepts valid 64-hex sha256 digest", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: "registry.example/foo@sha256:" + "d".repeat(64),
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when pinnedKeyPath is empty", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("pinned SSH key path")
    }
  })
})

/**
 * CORRECTION03 round 5: sshCommandForGuest() — server-identity
 * contract. The previous builder emitted
 *   -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
 * which silently accepts ANY host key. We now require a pinned
 * server identity and an ephemeral known_hosts file.
 */
describe("CORRECTION03 round 5: sshCommandForGuest() — server-identity contract", () => {
  const PINNED_DIGEST =
    "ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49"
  const PINNED_HOST_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  const KNOWN_HOSTS_FILE = "/tmp/clinemm-test-known-hosts"

  it("argv contains StrictHostKeyChecking=yes (not no)", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cmd).toContain("StrictHostKeyChecking=yes")
      expect(r.cmd).not.toContain("StrictHostKeyChecking=no")
    }
  })

  it("argv contains UserKnownHostsFile=<absolute path> (not /dev/null)", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cmd).toContain(`UserKnownHostsFile=${KNOWN_HOSTS_FILE}`)
      expect(r.cmd).not.toContain("UserKnownHostsFile=/dev/null")
    }
  })

  it("rejects when knownHostsFile is missing (fail-closed)", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    } as unknown as Parameters<typeof sshCommandForGuest>[0])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("knownHostsFile")
    }
  })

  it("rejects when knownHostsFile is a relative path", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: "relative/known_hosts",
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("absolute")
    }
  })

  it("rejects when pinnedHostPublicKey is empty", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: "",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/pinnedHostPublicKey|host key line/i)
    }
  })

  it("rejects when pinnedHostPublicKey has an embedded host field", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: "10.0.0.1 " + PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("pinnedHostPublicKey rejected")
    }
  })

  it("rejects when pinnedHostPublicKey is whitespace only", () => {
    const r = sshCommandForGuest({
      guestIp: "10.0.0.1",
      remoteCommand: "true",
      pinnedKeyPath: "/tmp/clinemm-test-key",
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: "   \t  ",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("pinnedHostPublicKey")
    }
  })
})

/**
 * CORRECTION03 round 5: buildKnownHostsFileContents() — pure
 * payload generator for the ephemeral UserKnownHostsFile.
 */
describe("CORRECTION03 round 5: buildKnownHostsFileContents() — ephemeral known_hosts payload", () => {
  const PINNED_HOST_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

  it("produces a single line '<guestIp> <pinnedHostPublicKey>\\n'", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "10.0.0.42",
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.contents).toBe(`10.0.0.42 ${PINNED_HOST_KEY}\n`)
      expect(r.contents.split("\n").length).toBe(2)
    }
  })

  it("produces a v6 entry for an IPv6 literal", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "fe80::1",
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.contents).toBe(`fe80::1 ${PINNED_HOST_KEY}\n`)
    }
  })

  it("rejects hostnames (would allow wildcards)", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "vm.example.com",
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("IP literal")
    }
  })

  it("rejects embedded newlines", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "10.0.0.42",
      pinnedHostPublicKey: `${PINNED_HOST_KEY}\nssh-ed25519 AAAAattacker`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("embedded newlines")
    }
  })

  it("rejects when key type is unsupported (ssh-dss)", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "10.0.0.42",
      pinnedHostPublicKey:
        "ssh-dss AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("bare key line")
    }
  })

  it("accepts a trailing comment on the key line", () => {
    const r = buildKnownHostsFileContents({
      guestIp: "10.0.0.42",
      pinnedHostPublicKey: `${PINNED_HOST_KEY} clinemm-testbed-host`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.contents).toBe(
        `10.0.0.42 ${PINNED_HOST_KEY} clinemm-testbed-host\n`,
      )
    }
  })
})

describe("CORRECTION03: editorBaseline() — fail-closed on missing pins", () => {
  it("returns pinned binary + version when both args provided", () => {
    const r = editorBaseline({
      pinnedBinary: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      pinnedVersion: "1.95.3",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.binary).toContain("/Applications/Visual Studio Code.app")
      expect(r.version).toBe("1.95.3")
    }
  })

  it("rejects when pinnedBinary is null", () => {
    const r = editorBaseline({
      pinnedBinary: null,
      pinnedVersion: "1.95.3",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("CLINEMM_TESTBED_EDITOR_BINARY")
    }
  })

  it("rejects when pinnedVersion is null", () => {
    const r = editorBaseline({
      pinnedBinary: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      pinnedVersion: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("CLINEMM_TESTBED_EDITOR_VERSION")
    }
  })
})
