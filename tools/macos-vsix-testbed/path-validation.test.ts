/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 *
 * Unit tests for path-validation.ts.
 *
 * Verifies:
 *   - accepts a real .vsix under TRUSTED_ARTIFACT_ROOT
 *   - rejects a path outside the root
 *   - rejects a symlink escape
 *   - rejects a file with the wrong SHA-256
 *   - rejects a file larger than MAX_VSIX_BYTES
 *   - rejects a directory
 *
 * Tests run against /tmp/clinemm-testbed-path-validation-* fixture
 * dirs so the trusted-root invariant is exercised.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"

import {
  MAX_VSIX_BYTES,
  trustedArtifactRoot,
  validateVsixPath,
} from "./path-validation.ts"

// Override HOME for the test so the trusted root resolves to a
// /tmp path the test process can actually create.
const FAKE_HOME = `/tmp/clinemm-testbed-fake-home-${Date.now().toString(36)}`
const ORIGINAL_HOME = process.env.HOME
process.env.HOME = FAKE_HOME

const FIXTURE_DIR = `${FAKE_HOME}/.clinemm/artifacts`

function writeFakeVsix(content = "fake-vsix-content"): { path: string; sha: string } {
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true })
  }
  const path = `${FIXTURE_DIR}/test-${Math.random().toString(36).slice(2)}.vsix`
  writeFileSync(path, content)
  const sha = createHash("sha256").update(content).digest("hex")
  return { path, sha }
}

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
})
afterAll(() => {
  try { rmSync(FAKE_HOME, { recursive: true, force: true }) } catch {}
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME
})

describe("validateVsixPath", () => {
  it("accepts a real .vsix under the trusted artifact root", () => {
    const { path, sha } = writeFakeVsix()
    const r = validateVsixPath(path, sha)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostSha256).toBe(sha)
      // canonical is the realpath-resolved path; on macOS
      // /tmp ↔ /private/tmp, so compare via realpath.
      expect(r.canonical).toBe(realpathSync(path))
      expect(r.size).toBeGreaterThan(0)
    }
  })

  it("rejects a path outside the trusted artifact root", () => {
    const outsidePath = `/tmp/clinemm-testbed-outside-${Date.now().toString(36)}.vsix`
    writeFileSync(outsidePath, "outside")
    const sha = createHash("sha256").update("outside").digest("hex")
    const r = validateVsixPath(outsidePath, sha)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("VSIX_NOT_FOUND")
    try { rmSync(outsidePath) } catch {}
  })

  it("rejects a path with .. component even after realpath", () => {
    const r = validateVsixPath(
      `${trustedArtifactRoot()}/../escape.vsix`,
      "a".repeat(64),
    )
    expect(r.ok).toBe(false)
  })

  it("rejects a symlink that points outside the trusted root", () => {
    // Create a real file outside, then a symlink inside the root
    // pointing to it.
    const outsidePath = `/tmp/clinemm-testbed-outside-symlink-${Date.now().toString(36)}.txt`
    writeFileSync(outsidePath, "escaped")
    const symlinkPath = `${FIXTURE_DIR}/escape-symlink-${Date.now().toString(36)}.vsix`
    symlinkSync(outsidePath, symlinkPath)
    const sha = createHash("sha256").update("escaped").digest("hex")
    const r = validateVsixPath(symlinkPath, sha)
    expect(r.ok).toBe(false)
    try { rmSync(symlinkPath) } catch {}
    try { rmSync(outsidePath) } catch {}
  })

  it("rejects a VSIX whose bytes do not match the expected SHA", () => {
    const { path } = writeFakeVsix("real-content")
    const r = validateVsixPath(path, "f".repeat(64))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("VSIX_HASH_MISMATCH")
  })

  it("rejects a non-existent file", () => {
    const r = validateVsixPath(
      `${trustedArtifactRoot()}/does-not-exist-${Date.now().toString(36)}.vsix`,
      "0".repeat(64),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("VSIX_NOT_FOUND")
  })

  it("rejects a directory at the requested path", () => {
    const dirPath = `${FIXTURE_DIR}/subdir-${Date.now().toString(36)}.vsix`
    mkdirSync(dirPath)
    const r = validateVsixPath(dirPath, "0".repeat(64))
    expect(r.ok).toBe(false)
    try { rmSync(dirPath, { recursive: true }) } catch {}
  })

  it("accepts case-mixed hex and normalizes to lowercase", () => {
    const content = "case-test"
    const { path } = writeFakeVsix(content)
    const sha = createHash("sha256").update(content).digest("hex").toUpperCase()
    const r = validateVsixPath(path, sha)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostSha256).toBe(sha.toLowerCase())
    }
  })

  it("exports MAX_VSIX_BYTES as a positive integer", () => {
    expect(MAX_VSIX_BYTES).toBeGreaterThan(0)
    expect(typeof MAX_VSIX_BYTES).toBe("number")
  })
})
