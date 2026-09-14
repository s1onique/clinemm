/**
 * CORRECTION03 production-seam wiring: trusted testbed config
 * reader (pure).
 *
 * readTrustedTestbedConfig() is a pure function: it takes
 * `homeDir` and `currentUid` as arguments and does NOT read
 * process.env. This makes it directly testable without env
 * mutation races.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import {
  readTrustedTestbedConfig,
  defaultTrustedTestbedConfigPath,
} from "./testbed-config.ts"
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"

// The tests run as the current user; the owner check in
// readTrustedTestbedConfig compares stat.uid against the passed
// currentUid. We pass the real uid so the owner check is satisfied;
// tests that want to exercise the negative owner check pass a
// different uid (e.g. uid+1).
const MY_UID = userInfo().uid

let homeDir: string
let configPath: string

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "clinemm-testbed-config-"))
  configPath = join(homeDir, ".clinemm", "testbed", "config.json")
})

afterEach(() => {
  try {
    rmSync(homeDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function writeValidConfig(overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(homeDir, ".clinemm", "testbed"), { recursive: true, mode: 0o755 })
  const cfg = {
    schema_version: 1,
    image: "ghcr.io/cirruslabs/clinemm-testbed@sha256:" + "a".repeat(64),
    ssh_key_path: "/Users/dev/.clinemm/testbed/id_ed25519",
    editor_binary: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    editor_version: "1.95.3",
    ssh_host_public_key:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    ...overrides,
  }
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o644 })
}

describe("CORRECTION03: readTrustedTestbedConfig — fail-closed prereqs", () => {
  test("rejects when HOME is null", () => {
    const r = readTrustedTestbedConfig({ homeDir: null, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("HOME is not set")
  })

  test("rejects when HOME is empty string", () => {
    const r = readTrustedTestbedConfig({ homeDir: "", currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("HOME is not set")
  })

  test("rejects when the config file does not exist", () => {
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("trusted testbed config not found")
      expect(r.configPath).toBe(configPath)
    }
  })

  test("rejects when the config path resolves to a directory, not a regular file", () => {
    mkdirSync(configPath, { recursive: true })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("not a regular file")
  })

  test("rejects when the config has insecure mode (group write)", () => {
    writeValidConfig()
    chmodSync(configPath, 0o664) // group-writable
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("insecure mode")
  })

  test("rejects when the config has insecure mode (other write)", () => {
    writeValidConfig()
    chmodSync(configPath, 0o646) // other-writable
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("insecure mode")
  })

  test("rejects when the config is not valid JSON", () => {
    mkdirSync(join(homeDir, ".clinemm", "testbed"), { recursive: true, mode: 0o755 })
    writeFileSync(configPath, "{ not json", { mode: 0o644 })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("not valid JSON")
  })

  test("rejects when schema_version is missing", () => {
    writeValidConfig({ schema_version: undefined })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("schema_version")
  })

  test("rejects when schema_version is not 1", () => {
    writeValidConfig({ schema_version: 2 })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("schema_version must be 1")
  })

  test("rejects when image lacks @sha256: digest", () => {
    writeValidConfig({ image: "ghcr.io/cirruslabs/clinemm-testbed:latest" })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("@sha256:")
  })

  test("rejects when ssh_key_path is non-absolute", () => {
    writeValidConfig({ ssh_key_path: "id_ed25519" })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("ssh_key_path must be absolute")
  })

  test("rejects when editor_binary is non-absolute", () => {
    writeValidConfig({ editor_binary: "code" })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("editor_binary must be absolute")
  })

  test("rejects when editor_version is not semver", () => {
    writeValidConfig({ editor_version: "1.95" })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("editor_version must be semver")
  })

  test("accepts a well-formed config with mode 0o644", () => {
    writeValidConfig()
    const r = readTrustedTestbedConfig({ homeDir, currentUid: null })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.schema_version).toBe(1)
      expect(r.config.image).toMatch(/^[^@\s]+@sha256:[0-9a-f]{64}$/)
      expect(r.config.ssh_key_path.startsWith("/")).toBe(true)
      expect(r.config.editor_binary.startsWith("/")).toBe(true)
      expect(r.config.editor_version).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/)
    }
  })

  test("P1 (round 3): accepts valid 64-hex digest in OCI sha256 reference", () => {
    writeValidConfig({
      image: "ghcr.io/cirruslabs/clinemm-testbed@sha256:" + "a".repeat(64),
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.image).toContain("a".repeat(64))
  })

  test("P1 (round 3): rejects malformed @sha256: reference (not-a-digest)", () => {
    writeValidConfig({
      image: "registry.example/foo@sha256:not-a-digest",
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("registry/path@sha256:<64-hex-digest>")
    }
  })

  test("P1 (round 3): rejects truncated sha256 digest (63 hex chars)", () => {
    writeValidConfig({
      image: "registry.example/foo@sha256:" + "a".repeat(63),
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  test("P1 (round 3): rejects non-hex characters in sha256 digest", () => {
    writeValidConfig({
      image: "registry.example/foo@sha256:" + "z".repeat(64),
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  test("P1 (round 3): rejects image without @sha256: separator", () => {
    writeValidConfig({
      image: "registry.example/foo:" + "a".repeat(64),
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  test("P1 (round 3): accepts lowercase hex digest (canonical form)", () => {
    writeValidConfig({
      image: "registry.example/foo@sha256:" + "abcdef0123456789".repeat(4),
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(true)
  })

  test("accepts a well-formed config with mode 0o600", () => {
    writeValidConfig()
    chmodSync(configPath, 0o600)
    const r = readTrustedTestbedConfig({ homeDir, currentUid: null })
    expect(r.ok).toBe(true)
  })

  test("defaultTrustedTestbedConfigPath returns $HOME/.clinemm/testbed/config.json", () => {
    expect(defaultTrustedTestbedConfigPath("/Users/dev")).toBe(
      "/Users/dev/.clinemm/testbed/config.json",
    )
  })
})

/**
 * CORRECTION03 round 5: server-identity pin.
 *
 * The qualified-image contract now includes the bare SSH host
 * public key captured at qualification time. Without it,
 * StrictHostKeyChecking=yes has nothing to verify against —
 * the trusted config is the wrong shape.
 */
describe("CORRECTION03 round 5: readTrustedTestbedConfig — ssh_host_public_key pin", () => {
  const VALID_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

  test("rejects when ssh_host_public_key is missing", () => {
    writeValidConfig({ ssh_host_public_key: undefined } as Record<string, unknown>)
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("ssh_host_public_key")
    }
  })

  test("rejects when ssh_host_public_key is empty", () => {
    writeValidConfig({ ssh_host_public_key: "" })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("ssh_host_public_key")
    }
  })

  test("rejects when ssh_host_public_key contains embedded newlines", () => {
    writeValidConfig({ ssh_host_public_key: `${VALID_KEY}\nssh-ed25519 AAAAattacker` })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("embedded newlines")
    }
  })

  test("rejects when ssh_host_public_key starts with @ (revoked/CA marker)", () => {
    writeValidConfig({ ssh_host_public_key: `@revoked ${VALID_KEY}` })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("@")
    }
  })

  test("rejects when ssh_host_public_key starts with | (hashed host)", () => {
    writeValidConfig({ ssh_host_public_key: `|1|abc|def ${VALID_KEY}` })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("@")
    }
  })

  test("rejects when ssh_host_public_key is a comment line", () => {
    writeValidConfig({ ssh_host_public_key: `# ${VALID_KEY}` })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("#")
    }
  })

  test("rejects when ssh_host_public_key has a host field embedded (10.0.0.42 ssh-ed25519 ...)", () => {
    writeValidConfig({
      ssh_host_public_key: "10.0.0.42 " + VALID_KEY,
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("bare '<keytype> <base64> [<comment>]' line")
    }
  })

  test("rejects when ssh_host_public_key has an unsupported key type", () => {
    writeValidConfig({
      ssh_host_public_key:
        "ssh-dss AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("bare '<keytype> <base64> [<comment>]' line")
    }
  })

  test("rejects when ssh_host_public_key base64 part is too short", () => {
    writeValidConfig({
      ssh_host_public_key: "ssh-ed25519 AAAA",
    })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("bare '<keytype> <base64> [<comment>]' line")
    }
  })

  test("accepts a bare ssh-ed25519 line with no comment", () => {
    writeValidConfig({ ssh_host_public_key: VALID_KEY })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.ssh_host_public_key).toBe(VALID_KEY)
    }
  })

  test("accepts a bare ssh-ed25519 line with a trailing comment", () => {
    const key = `${VALID_KEY} clinemm-testbed-host`
    writeValidConfig({ ssh_host_public_key: key })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.ssh_host_public_key).toBe(key)
    }
  })

  test("accepts an ecdsa-sha2-nistp256 line (non-ed25519 key type)", () => {
    const key =
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAKEcdsaPinnedHostKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    writeValidConfig({ ssh_host_public_key: key })
    const r = readTrustedTestbedConfig({ homeDir, currentUid: MY_UID })
    expect(r.ok).toBe(true)
  })
})
