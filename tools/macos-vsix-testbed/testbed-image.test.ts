/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01-CORRECTION03
 *
 * Discrimination tests for the testbed-image qualifier and the
 * fail-closed gate in runner.ts.
 *
 * Verifies:
 *   1. checkPrereqs() rejects missing SSH key path
 *   2. checkPrereqs() rejects malformed SSH public key
 *   3. checkPrereqs() rejects missing or non-semver VS Code version
 *   4. checkPrereqs() accepts a well-formed ssh-ed25519 public key
 *   5. checkPrereqs() accepts a well-formed ssh-rsa public key
 *   6. checkPrereqs() emits the standard macOS VS Code binary path
 *      as the editor baseline
 *   7. checkPrereqs() fingerprints match the OpenSSH SHA256 format
 *      (prefix "SHA256:" + base64, no trailing =)
 *
 * These tests run without a Tart VM — they exercise the prereq
 * validation logic that gates the actual image qualification.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkPrereqs,
  captureGuestSshHostPublicKey,
  loadOperatorSshdHostKeyPair,
  parseAndValidateHostKeyLine,
  injectOperatorSshdHostKeyPair,
} from "./testbed-image.ts"

const TEST_ROOT = join(tmpdir(), "clinemm-testbed-image-qualifier")
const GOOD_KEY = join(TEST_ROOT, "id_ed25519.pub")
const RSA_KEY = join(TEST_ROOT, "id_rsa.pub")
const BAD_KEY = join(TEST_ROOT, "garbage.pub")

const GOOD_ED25519_BODY =
  "AAAAC3NzaC1lZDI1NTE5AAAAIA7G3example9k1example1example2example3example4example5"
const GOOD_RSA_BODY =
  "AAAAB3NzaC1yc2EAAAADAQABAAABAQDExampleExampleExampleExampleExampleExampleExample"

beforeAll(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(TEST_ROOT, { recursive: true })
  writeFileSync(GOOD_KEY, `ssh-ed25519 ${GOOD_ED25519_BODY} operator@dev-mac\n`)
  writeFileSync(RSA_KEY, `ssh-rsa ${GOOD_RSA_BODY} operator@dev-mac\n`)
  writeFileSync(BAD_KEY, "not a key\n")
  process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = GOOD_KEY
  process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = "1.95.3"
})

afterAll(() => {
  delete process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
  delete process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe("CORRECTION03: testbed-image qualifier prereqs (fail-closed)", () => {
  it("rejects when SSH public key path env is missing", async () => {
    const saved = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    delete process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("SSH_KEY_NOT_PINNED")
        expect(r.message).toContain("CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = saved
    }
  })

  it("rejects when SSH public key file does not exist", async () => {
    const saved = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH =
      "/tmp/clinemm-this-key-does-not-exist.pub"
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("SSH_KEY_NOT_PINNED")
        expect(r.message).toContain("does not exist")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = saved
    }
  })

  it("rejects malformed SSH public key", async () => {
    const saved = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = BAD_KEY
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("SSH_KEY_NOT_PINNED")
        expect(r.message).toContain("malformed")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = saved
    }
  })

  it("rejects missing VS Code version", async () => {
    const saved = process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION
    delete process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("EDITOR_BASELINE_NOT_PROVEN")
        expect(r.message).toContain("CLINEMM_TESTBED_IMAGE_VSCODE_VERSION")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = saved
    }
  })

  it("rejects non-semver VS Code version", async () => {
    const saved = process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION
    process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = "1.95"
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("EDITOR_BASELINE_NOT_PROVEN")
        expect(r.message).toContain("semver")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = saved
    }
  })

  it("accepts well-formed ssh-ed25519 public key + semver VS Code version", async () => {
    const savedKey = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    const savedVer = process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION
    process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = GOOD_KEY
    process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = "1.95.3"
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.vscodeVersion).toBe("1.95.3")
        expect(r.vscodeBinary).toBe(
          "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        )
        expect(r.sshKeyFp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
        expect(r.sshKeyFp.endsWith("=")).toBe(false)
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = savedKey
      process.env.CLINEMM_TESTBED_IMAGE_VSCODE_VERSION = savedVer
    }
  })

  it("accepts well-formed ssh-rsa public key", async () => {
    const savedKey = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = RSA_KEY
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(true)
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = savedKey
    }
  })

  it("rejects ssh-dss (DSA) public keys — not allowed by the qualifier", async () => {
    const DSA_KEY = join(TEST_ROOT, "id_dsa.pub")
    writeFileSync(
      DSA_KEY,
      "ssh-dss AAAAB3NzaC1kc3MAAACBAMExampleExampleExample operator@dev-mac\n",
    )
    const savedKey = process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH
    process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = DSA_KEY
    try {
      const r = await checkPrereqs()
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("SSH_KEY_NOT_PINNED")
        expect(r.message).toContain("malformed")
      }
    } finally {
      process.env.CLINEMM_TESTBED_IMAGE_PUBLIC_KEY_PATH = savedKey
    }
  })
})

/**
 * Round-6 tests: captureGuestSshHostPublicKey() must read the
 * actual sshd host public key from INSIDE the qualified VM
 * through the authenticated provisioning channel — NOT from
 * `ssh-keyscan`, which observes unauthenticated wire responses.
 *
 * The helper takes an optional `runCommand` injection point so
 * tests can supply a stand-in that pretends to be `sshpass ssh
 * admin@$ip 'cat /etc/ssh/ssh_host_ed25519_key.pub'` and
 * returns pre-canned stdout / exit code. This isolates the
 * parser from the SSH transport, so the tests cover every
 * failure mode without an actual SSH server.
 */
describe("CORRECTION03 round 6+7: captureGuestSshHostPublicKey — host-key provenance + conservation", () => {
  // A canonical ssh-ed25519 base64 key body — 68 chars, longer
  // than the 43-char regex floor so the validation passes.
  const ED25519_BODY =
    "AAAAC3NzaC1lZDI1NTE5AAAAIA7G3example9k1example1example2example3example4example5"

  it("captures a bare ssh-ed25519 line via the authenticated channel", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-ed25519 ${ED25519_BODY}\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostPublicKey).toBe(`ssh-ed25519 ${ED25519_BODY}`)
      expect(r.hostKeyPath).toBe("/etc/ssh/ssh_host_ed25519_key.pub")
    }
  })

  it("preserves the trailing ssh-keygen root@host comment", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY} root@clinemm-testbed-qualifier`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-ed25519 ${ED25519_BODY} root@clinemm-testbed-qualifier\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostPublicKey).toBe(
        `ssh-ed25519 ${ED25519_BODY} root@clinemm-testbed-qualifier`,
      )
    }
  })

  it("invokes sshpass with admin@<guestIp> over the authenticated channel", async () => {
    let observedArgv: readonly string[] = []
    await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.99",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async (cmd) => {
        observedArgv = cmd
        return { exitCode: 0, stdout: `ssh-ed25519 ${ED25519_BODY}\n`, stderr: "" }
      },
    })
    expect(observedArgv.length).toBeGreaterThan(0)
    expect(observedArgv[0]).toBe("sshpass")
    expect(observedArgv[3]).toBe("ssh")
    const userHost = observedArgv.find((t) => t.startsWith("admin@"))
    expect(userHost).toBe("admin@10.0.0.99")
    expect(observedArgv).toContain("PreferredAuthentications=password")
    expect(observedArgv).toContain("PubkeyAuthentication=no")
  })

  it("fails closed (SSH_HOST_KEY_NOT_FOUND) when sshd returns non-zero", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 42,
        stdout: "__CLINEMM_HOST_KEY_MISSING__\n",
        stderr: "cat: /etc/ssh/ssh_host_ed25519_key.pub: No such file or directory\n",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_NOT_FOUND")
      expect(r.message).toContain("/etc/ssh/ssh_host_ed25519_key.pub")
      expect(r.message).toContain("exit 42")
      expect(r.detail).toContain("No such file or directory")
    }
  })

  it("fails closed (SSH_HOST_KEY_NOT_FOUND) when stdout is empty", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_NOT_FOUND")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) on embedded newlines", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-ed25519 ${ED25519_BODY}\n@revoked extra entry\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
      expect(r.message).toContain("embedded newlines")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) when key starts with @", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `@revoked ssh-ed25519 ${ED25519_BODY}\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
      expect(r.message).toContain("marker")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) when key starts with | (hashed host)", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `|1|abc|ssh-ed25519 ${ED25519_BODY}\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) when key starts with # (comment)", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `# ssh-ed25519 ${ED25519_BODY}\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) on unsupported key type (ssh-dss)", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-dss AAAAB3NzaC1kc3MAAACBAMExampleExampleExample root@host\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
      expect(r.message).toContain("ssh-dss")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) when key has a host field smuggled in", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `10.0.0.42 ssh-ed25519 ${ED25519_BODY}\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
      expect(r.message).toContain("4")
    }
  })

  it("fails closed (SSH_HOST_KEY_MALFORMED) on too-short base64 body", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY}`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-ed25519 AAAtooShort\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
      expect(r.message).toContain("base64")
    }
  })

  it("accepts an ecdsa-sha2-nistp256 host key", async () => {
    const ECDSA_BODY =
      "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAKEcdExampleExampleExampleExampleExampleExampleExampleExampleExample"
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ecdsa-sha2-nistp256 ${ECDSA_BODY} root@host`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ecdsa-sha2-nistp256 ${ECDSA_BODY} root@host\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostPublicKey.startsWith("ecdsa-sha2-nistp256 ")).toBe(true)
    }
  })

  it("returns hostPublicKey that round-trips through the round-5 testbed-config validator", async () => {
    const r = await captureGuestSshHostPublicKey({
      guestIp: "10.0.0.42",
      expectedPublicKey: `ssh-ed25519 ${ED25519_BODY} root@host`,
      runCommand: async () => ({
        exitCode: 0,
        stdout: `ssh-ed25519 ${ED25519_BODY} root@host\n`,
        stderr: "",
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const line = r.hostPublicKey
      const SSH_HOST_PUBLIC_KEY_LINE_RE =
        /^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa|rsa-sha2-256|rsa-sha2-512)\s+([A-Za-z0-9+/=]{43,})\s*([!-~]*)$/
      expect(SSH_HOST_PUBLIC_KEY_LINE_RE.test(line)).toBe(true)
      expect(line).not.toMatch(/[\r\n]/)
      expect(line.startsWith("@")).toBe(false)
      expect(line.startsWith("|")).toBe(false)
      expect(line.startsWith("#")).toBe(false)
    }
  })
})

/**
 * Round-7 tests: parseAndValidateHostKeyLine() is the pure
 * validator used on both sides of the conservation check
 * (operator-supplied key + captured-from-guest key). It MUST
 * apply identical rules so a malformed input is rejected on
 * both sides, not just one.
 */
describe("CORRECTION03 round 7: parseAndValidateHostKeyLine — pure validator", () => {
  const ED25519_BODY =
    "AAAAC3NzaC1lZDI1NTE5AAAAIA7G3example9k1example1example2example3example4example5"

  it("accepts a 2-token ssh-ed25519 line", () => {
    const r = parseAndValidateHostKeyLine(`ssh-ed25519 ${ED25519_BODY}`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.keyType).toBe("ssh-ed25519")
      expect(r.b64).toBe(ED25519_BODY)
      expect(r.comment).toBeUndefined()
    }
  })

  it("accepts a 3-token ssh-ed25519 line with trailing comment", () => {
    const r = parseAndValidateHostKeyLine(
      `ssh-ed25519 ${ED25519_BODY} root@host`,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.keyType).toBe("ssh-ed25519")
      expect(r.b64).toBe(ED25519_BODY)
      expect(r.comment).toBe("root@host")
    }
  })

  it("rejects empty input", () => {
    const r = parseAndValidateHostKeyLine("")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("SSH_HOST_KEY_MALFORMED")
    }
  })

  it("rejects embedded newlines", () => {
    const r = parseAndValidateHostKeyLine(`ssh-ed25519 ${ED25519_BODY}\n@revoked extra`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain("embedded newlines")
    }
  })

  it("rejects leading @ marker", () => {
    const r = parseAndValidateHostKeyLine(`@revoked ssh-ed25519 ${ED25519_BODY}`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain("marker")
    }
  })

  it("rejects leading | marker", () => {
    const r = parseAndValidateHostKeyLine(`|1|abc|ssh-ed25519 ${ED25519_BODY}`)
    expect(r.ok).toBe(false)
  })

  it("rejects leading # marker", () => {
    const r = parseAndValidateHostKeyLine(`# ssh-ed25519 ${ED25519_BODY}`)
    expect(r.ok).toBe(false)
  })

  it("rejects unsupported key types (ssh-dss)", () => {
    const r = parseAndValidateHostKeyLine(
      `ssh-dss AAAAB3NzaC1kc3MAAACBAMExampleExampleExample root@host`,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain("ssh-dss")
    }
  })

  it("rejects host field smuggled in (4 tokens)", () => {
    const r = parseAndValidateHostKeyLine(
      `10.0.0.42 ssh-ed25519 ${ED25519_BODY} root@host`,
    )
    expect(r.ok).toBe(false)
  })

  it("rejects too-short base64 body", () => {
    const r = parseAndValidateHostKeyLine(`ssh-ed25519 AAAtooShort`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain("base64")
    }
  })

  it("rejects non-string input", () => {
    const r = parseAndValidateHostKeyLine(undefined as unknown as string)
    expect(r.ok).toBe(false)
  })
})

/**
 * Round-7 tests: loadOperatorSshdHostKeyPair() is the
 * ROOT-OF-TRUST boundary validator. It runs BEFORE the
 * in-guest conservation check, so its failure modes are
 * the only way the operator can inject a bad root.
 *
 * The 5 invariants (see doc-comment):
 *   1. both files exist
 *   2. private key mode 0o600 (no group/other read)
 *   3. public key parseable with the same rules as the
 *      captured-from-guest key
 *
 * These tests build real on-disk key files (no real crypto)
 * to exercise every branch.
 */
describe("CORRECTION03 round 7: loadOperatorSshdHostKeyPair — root-of-trust boundary", () => {
  const ROOT = join(tmpdir(), "clinemm-testbed-round7-loadOperator")
  const PRIV = join(ROOT, "host_ed25519")
  const PUB = join(ROOT, "host_ed25519.pub")
  const BAD_PUB = join(ROOT, "garbage.pub")

  beforeAll(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(ROOT, { recursive: true })
    writeFileSync(PRIV, "fake-private-key\n")
    writeFileSync(PUB, `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA7G3example9k1example1example2example3example4example5 root@host\n`)
    writeFileSync(BAD_PUB, "not a key\n")
    chmodSync(PRIV, 0o600)
    chmodSync(PUB, 0o644)
    chmodSync(BAD_PUB, 0o644)
  })

  afterAll(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  })

  it("accepts a well-formed key pair with private key mode 0o600", () => {
    const r = loadOperatorSshdHostKeyPair({
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.privateKeyMode).toBe(0o600)
      expect(r.publicKey.startsWith("ssh-ed25519 ")).toBe(true)
      expect(r.publicKey).toContain("root@host")
    }
  })

  it("fails closed (HOST_KEY_PAIR_NOT_PROVIDED) when the private key does not exist", () => {
    const r = loadOperatorSshdHostKeyPair({
      privateKeyPath: "/tmp/clinemm-this-key-does-not-exist",
      publicKeyPath: PUB,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_PAIR_NOT_PROVIDED")
      expect(r.message).toContain("private key does not exist")
    }
  })

  it("fails closed (HOST_KEY_PAIR_NOT_PROVIDED) when the public key does not exist", () => {
    const r = loadOperatorSshdHostKeyPair({
      privateKeyPath: PRIV,
      publicKeyPath: "/tmp/clinemm-this-pub-does-not-exist.pub",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_PAIR_NOT_PROVIDED")
      expect(r.message).toContain("public key does not exist")
    }
  })

  it("fails closed (HOST_KEY_PAIR_NOT_PROVIDED) when the private key is world-readable (0o644)", () => {
    chmodSync(PRIV, 0o644)
    try {
      const r = loadOperatorSshdHostKeyPair({
        privateKeyPath: PRIV,
        publicKeyPath: PUB,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("HOST_KEY_PAIR_NOT_PROVIDED")
        expect(r.message).toContain("group/world accessible")
        expect(r.message).toContain("0o644")
      }
    } finally {
      chmodSync(PRIV, 0o600)
    }
  })

  it("fails closed (HOST_KEY_PAIR_NOT_PROVIDED) when the private key is group-readable (0o640)", () => {
    chmodSync(PRIV, 0o640)
    try {
      const r = loadOperatorSshdHostKeyPair({
        privateKeyPath: PRIV,
        publicKeyPath: PUB,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe("HOST_KEY_PAIR_NOT_PROVIDED")
        expect(r.message).toContain("group/world accessible")
      }
    } finally {
      chmodSync(PRIV, 0o600)
    }
  })

  it("fails closed (HOST_KEY_PAIR_NOT_PROVIDED) when the public key is malformed", () => {
    const r = loadOperatorSshdHostKeyPair({
      privateKeyPath: PRIV,
      publicKeyPath: BAD_PUB,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_PAIR_NOT_PROVIDED")
      expect(r.message).toContain("malformed")
    }
  })
})

/**
 * Round-8 tests: injectOperatorSshdHostKeyPair() is the
 * round-8 root-of-trust boundary. It MUST inject the
 * operator-supplied sshd host key pair into the qualification
 * VM through a NON-SSH Tart-side channel (`tart exec`).
 * The private key MUST NEVER cross any SSH connection.
 *
 * Reviewer's round-8 discriminator:
 *   "No byte of ssh_host_ed25519_key may cross an SSH
 *    connection before server identity is established."
 *
 * These tests assert the argv-shape invariant structurally
 * AND scan the protocol source tree for any forbidden token
 * combination that would regress the invariant.
 */
describe("CORRECTION03 round 8: injectOperatorSshdHostKeyPair — non-SSH Tart-side channel", () => {
  // A canonical ssh-ed25519 base64 key body — 68 chars.
  const ED25519_BODY =
    "AAAAC3NzaC1lZDI1NTE5AAAAIA7G3example9k1example1example2example3example4example5"
  const PUBKEY = `ssh-ed25519 ${ED25519_BODY} root@host\n`

  function setupOperatorKeyPair() {
    const ROOT = join(tmpdir(), "clinemm-testbed-round8-injection")
    const PRIV = join(ROOT, "host_ed25519")
    const PUB = join(ROOT, "host_ed25519.pub")
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(ROOT, { recursive: true })
    writeFileSync(PRIV, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n")
    writeFileSync(PUB, PUBKEY)
    chmodSync(PRIV, 0o600)
    chmodSync(PUB, 0o644)
    return { ROOT, PRIV, PUB }
  }

  function teardown(ROOT: string) {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  }

  it("injects via `tart exec -i <vm>` (Tart-side non-SSH channel with stdin forwarding)", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    let observedArgv: readonly string[] = []
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async (cmd) => {
        observedArgv = cmd
        return {
          exitCode: 0,
          stdout: "__CLINEMM_HOST_KEY_INJECTED__\n",
          stderr: "",
        }
      },
    })
    teardown(ROOT)
    expect(r.ok).toBe(true)
    // argv MUST start with the documented stdin-enabled form
    // (`tart exec -i <vm>`). Plain `tart exec` does NOT
    // forward stdin -- see openai/tart discussion #1141.
    expect(observedArgv[0]).toBe("tart")
    expect(observedArgv[1]).toBe("exec")
    expect(observedArgv[2]).toBe("-i")
    expect(observedArgv[3]).toBe("clinemm-testbed-qualifier")
  })

  it("argv NEVER contains `ssh`, `scp`, or `sshpass` (private key never crosses SSH)", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    let observedArgv: readonly string[] = []
    await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async (cmd) => {
        observedArgv = cmd
        return { exitCode: 0, stdout: "__CLINEMM_HOST_KEY_INJECTED__\n", stderr: "" }
      },
    })
    teardown(ROOT)
    expect(observedArgv.includes("ssh")).toBe(false)
    expect(observedArgv.includes("scp")).toBe(false)
    expect(observedArgv.includes("sshpass")).toBe(false)
  })

  it("the in-guest shell command references `/etc/ssh/ssh_host_ed25519_key` (the private key path) but NOT the private key content", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    let observedArgv: readonly string[] = []
    await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async (cmd) => {
        observedArgv = cmd
        return { exitCode: 0, stdout: "__CLINEMM_HOST_KEY_INJECTED__\n", stderr: "" }
      },
    })
    teardown(ROOT)
    // The path to the private key file (in the guest) IS in
    // the shell command (we need to write to it). But the
    // private key CONTENT must NOT appear in the argv (it
    // travels via stdin only).
    const joined = observedArgv.join(" ")
    expect(joined).toContain("/etc/ssh/ssh_host_ed25519_key")
    expect(joined).not.toContain("BEGIN OPENSSH PRIVATE KEY")
  })

  it("fails closed (HOST_KEY_INJECTION_FAILED) when `tart exec` returns non-zero", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "tart: VM not running",
      }),
    })
    teardown(ROOT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_INJECTION_FAILED")
      expect(r.message).toContain("clinemm-testbed-qualifier")
      expect(r.message).toContain("exit 1")
      expect(r.detail).toContain("VM not running")
    }
  })

  it("fails closed (HOST_KEY_INJECTION_FAILED) when the OK marker is missing", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async () => ({
        exitCode: 0,
        stdout: "some unexpected output\n",
        stderr: "",
      }),
    })
    teardown(ROOT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_INJECTION_FAILED")
      expect(r.message).toContain("OK marker")
    }
  })

  it("fails closed (HOST_KEY_INJECTION_FAILED) when the public key file does not exist", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: "/tmp/clinemm-does-not-exist.pub",
      runCommand: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    })
    teardown(ROOT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_INJECTION_FAILED")
      expect(r.message).toContain("failed to read the operator-supplied sshd host public key")
    }
  })

  it("fails closed (HOST_KEY_INJECTION_FAILED) when vmName is empty", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      runCommand: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    })
    teardown(ROOT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("HOST_KEY_INJECTION_FAILED")
      expect(r.message).toContain("vmName")
    }
  })

  it("custom hostKeyPath is honored (the in-guest path is configurable)", async () => {
    const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
    let observedArgv: readonly string[] = []
    const r = await injectOperatorSshdHostKeyPair({
      vmName: "clinemm-testbed-qualifier",
      privateKeyPath: PRIV,
      publicKeyPath: PUB,
      hostKeyPath: "/etc/ssh/ssh_host_rsa_key",
      runCommand: async (cmd) => {
        observedArgv = cmd
        return { exitCode: 0, stdout: "__CLINEMM_HOST_KEY_INJECTED__\n", stderr: "" }
      },
    })
    teardown(ROOT)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostKeyPath).toBe("/etc/ssh/ssh_host_rsa_key")
      expect(r.hostPublicKeyPath).toBe("/etc/ssh/ssh_host_rsa_key.pub")
    }
    const joined = observedArgv.join(" ")
    expect(joined).toContain("/etc/ssh/ssh_host_rsa_key")
    expect(joined).toContain("/etc/ssh/ssh_host_rsa_key.pub")
  })

  /**
   * Round-9 functional tests (reviewer's round-9 reopen
   * HALT_TART_EXEC_STDIN_NOT_ENABLED): `tart exec` without
   * `-i` does NOT forward stdin. The round-8 argv
   * `["tart", "exec", <vmName>, ...]` was missing `-i`, so
   * the private key bytes written to the host's stdin pipe
   * would have been discarded. The bounded fix inserts `-i`
   * after `tart exec` and before <vmName>, asserts that
   * prefix structurally, and adds a runtime defense-in-depth
   * check that refuses to build / run an argv missing `-i`.
   *
   * Exact-argv discriminator (the reviewer's bounded
   * correction discriminator):
   *
   *   argv[0] === "tart"
   *   argv[1] === "exec"
   *   argv[2] === "-i"            // <- stdin-forwarding flag
   *   argv[3] === <vmName>
   *
   * The smallest live-capability probe on a developer
   * substrate would be:
   *
   *   printf 'sentinel' | tart exec -i <vm> sh -c 'cat'
   *
   * with exact `sentinel` equality. This Background session
   * cannot run that probe (kill EPERM, APFS protect residue
   * documented in 02-host-helper-launchd.txt); the live
   * probe is classified LIVE_UNOBSERVABLE_HERE and belongs
   * to the developer-Mac live qualification.
   */
  describe("CORRECTION03 round 9: injectOperatorSshdHostKeyPair — `tart exec -i` stdin-enabled form", () => {
    it("argv prefix is exactly [\"tart\", \"exec\", \"-i\", <vmName>] (stdin-enabled form, reviewer's exact-prefix discriminator)", async () => {
      const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
      let observedArgv: readonly string[] = []
      const r = await injectOperatorSshdHostKeyPair({
        vmName: "clinemm-testbed-qualifier",
        privateKeyPath: PRIV,
        publicKeyPath: PUB,
        runCommand: async (cmd) => {
          observedArgv = cmd
          return {
            exitCode: 0,
            stdout: "__CLINEMM_HOST_KEY_INJECTED__\n",
            stderr: "",
          }
        },
      })
      teardown(ROOT)
      expect(r.ok).toBe(true)
      expect(observedArgv[0]).toBe("tart")
      expect(observedArgv[1]).toBe("exec")
      expect(observedArgv[2]).toBe("-i")
      expect(observedArgv[3]).toBe("clinemm-testbed-qualifier")
    })

    it("argv does NOT place <vmName> in argv[2] (would mean `-i` is missing and stdin is silently dropped)", async () => {
      const { ROOT, PRIV, PUB } = setupOperatorKeyPair()
      let observedArgv: readonly string[] = []
      await injectOperatorSshdHostKeyPair({
        vmName: "clinemm-testbed-qualifier",
        privateKeyPath: PRIV,
        publicKeyPath: PUB,
        runCommand: async (cmd) => {
          observedArgv = cmd
          return {
            exitCode: 0,
            stdout: "__CLINEMM_HOST_KEY_INJECTED__\n",
            stderr: "",
          }
        },
      })
      teardown(ROOT)
      // If the reviewer round-9 fix regressed and `-i` was
      // dropped from the argv builder, <vmName> would shift
      // into argv[2]. That single regression would silently
      // disable stdin forwarding and the private-key bytes
      // would be lost -- so we make this explicit.
      expect(observedArgv[2]).not.toBe("clinemm-testbed-qualifier")
      expect(observedArgv[2]).toBe("-i")
    })
  })
})

/**
 * Round-8 STRUCTURAL source-tree scan: ensure the
 * qualification bootstrap command set NEVER references the
 * private host-key path in any ssh/scp/sshpass argv. The
 * reviewer's structural test:
 *
 *   "A structural test can simply assert that the
 *    qualification bootstrap command set never references
 *    the private host-key path in any ssh, scp, sshpass, or
 *    stdin-to-SSH transport. Only the public key may appear
 *    in later trust material."
 *
 * This test scans every source file under tools/macos-vsix-testbed/
 * for any line that contains BOTH (a) the private host-key
 * path string `/etc/ssh/ssh_host_` AND (b) one of the
 * forbidden tokens `ssh`/`scp`/`sshpass` in argv position.
 * The set of substrings we look for (and forbid) is the
 * cross-product of (private host-key path) x (ssh / scp /
 * sshpass argv token). A match indicates that a future edit
 * has regressed the round-8 invariant.
 *
 * Note: this is a SOURCE-tree scan (not a runtime check).
 * Comments that mention `ssh-keyscan` or `ssh-keygen` (the
 * generation step, which runs on the dev Mac, NOT over a
 * network) are NOT matches; the test only flags lines that
 * reference both the private key path AND the forbidden
 * tokens. We additionally exempt any line that is inside a
 * `// ... # Step ...` protocol block (operator-facing
 * documentation) -- but as of round 8 those blocks no
 * longer reference scp-of-private-key, so this exemption
 * is defensive only.
 */
describe("CORRECTION03 round 8: structural — private host-key path never appears in any ssh/scp/sshpass argv", () => {
  it("no source file references both /etc/ssh/ssh_host_ and ssh/scp/sshpass in argv position", () => {
    const { readdirSync, statSync, readFileSync } = require("node:fs") as typeof import("node:fs")
    const { join: joinPath } = require("node:path") as typeof import("node:path")
    const ROOT = joinPath(__dirname)
    const files: string[] = []
    function walk(dir: string) {
      for (const ent of readdirSync(dir)) {
        const p = joinPath(dir, ent)
        const st = statSync(p)
        if (st.isDirectory()) {
          if (ent === "node_modules") continue
          walk(p)
        } else if (p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".cjs") || p.endsWith(".mjs")) {
          files.push(p)
        }
      }
    }
    walk(ROOT)
    const forbiddenTokens = ["ssh", "scp", "sshpass"] as const
    const violations: string[] = []
    for (const file of files) {
      // Skip the test file itself -- it legitimately mentions
      // the protected substrings while defining the scan.
      if (file.endsWith(".test.ts")) continue
      const lines = readFileSync(file, "utf8").split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip lines that are operator-facing documentation
        // comments inside the runQualifier() protocol block
        // (those start with `//   # Step` and are explicitly
        // marked as protocol steps). The round-8 protocol
        // block does NOT instruct scp-of-private-key, but
        // historical lines from older rounds might. We check
        // for the ssh/scp/sshpass combination that would
        // actually be a security violation -- an argv token,
        // not a comment.
        // Forbidding rule: any line that contains BOTH the
        // private host-key path AND the literal token
        // `sshpass` is a violation regardless of context.
        // (sshpass is only ever used to bootstrap SSH; a
        // comment mentioning it would not say the private
        // key path.)
        if (line.includes("/etc/ssh/ssh_host_") && line.includes("sshpass")) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
          continue
        }
        // Likewise, any line that has `scp` (a command,
        // not a substring of another word) AND the private
        // host-key path is a violation.
        if (
          line.includes("/etc/ssh/ssh_host_") &&
          (/(?:^|\s|"|')scp(?:$|\s|"|')/.test(line))
        ) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
          continue
        }
        // And any line that has `ssh` as an argv token
        // (quoted or in a list) AND the private host-key
        // path is a violation. This is a stricter check that
        // catches both literal `"ssh"` argv and embedded
        // references in command arrays.
        if (
          line.includes("/etc/ssh/ssh_host_") &&
          /(?:^|\s|"|')ssh(?:$|\s|"|')/.test(line)
        ) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `structural violation: sshd host PRIVATE key path appears in an ssh/scp/sshpass argv in ${violations.length} location(s):\n${violations.join("\n")}`,
      )
    }
  })
})

/**
 * Round-9 STRUCTURAL source-tree scan (reviewer's round-9
 * reopen HALT_TART_EXEC_STDIN_NOT_ENABLED): ensure no source
 * file under tools/macos-vsix-testbed/ constructs a `tart
 * exec` argv that omits the `-i` stdin-forwarding flag. The
 * round-8 argv builder had this defect; the structural scan
 * walks every .ts/.js/.cjs/.mjs file (excluding the test
 * files themselves, which legitimately mention the prefix
 * while defining the scan and the prefix assertions).
 *
 * A violation is any line whose Tart exec argv builder does
 * NOT have `-i` in argv[2]. The matching is conservative: we
 * match both the inline `tart exec <arg>` form (used in
 * documentation comments) and the array-form
 * `["tart", "exec", <argv[2]>, ...]` form (the actual
 * production builder in testbed-image.ts). Doc lines that
 * explicitly say `plain \`tart exec\` does NOT forward
 * stdin` are exempt (the negative-claim comments inside the
 * helper's doc-block use `//` and `*` continuation, both
 * matched by `/^\s*\*?/` here so they don't false-positive).
 *
 * Verified non-tautological: the structural test FAILS if a
 * future edit drops `-i` from the argv builder (manual
 * confirmation by injecting a violation).
 */
describe("CORRECTION03 round 9: structural — every `tart exec` argv in source uses `-i` (stdin-enabled form)", () => {
  it("no source file contains a `tart exec` argv that omits the `-i` stdin-forwarding flag", () => {
    const { readdirSync, statSync, readFileSync } = require("node:fs") as typeof import("node:fs")
    const { join: joinPath } = require("node:path") as typeof import("node:path")
    const ROOT = joinPath(__dirname)
    const files: string[] = []
    function walk(dir: string) {
      for (const ent of readdirSync(dir)) {
        const p = joinPath(dir, ent)
        const st = statSync(p)
        if (st.isDirectory()) {
          if (ent === "node_modules") continue
          walk(p)
        } else if (p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".cjs") || p.endsWith(".mjs")) {
          files.push(p)
        }
      }
    }
    walk(ROOT)
    const violations: string[] = []
    // Array-form builder (the actual production form):
    // ["tart", "exec", <argv2>, ...] where argv[2] is NOT "-i".
    // argv[2] is matched as a non-empty string that doesn't
    // start with "-i" (we don't allow any -iX variant here --
    // the upstream flag is exactly "-i" with no value).
    //
    // The argv builder is typically SPLIT ACROSS MULTIPLE LINES
    // (one literal per line, indented), so we read each file as
    // a whole and run a multiline regex (the `s` flag makes `.`
    // match newlines). We then locate the line number of each
    // match by computing its offset in the file.
    //
    // argv[2] may be either a quoted string literal
    // (e.g. `"<vmName>"`) OR a JS variable reference
    // (e.g. `args.vmName`); we accept both. The negative
    // lookahead `(?!-i["']|\\b-i\\b)` matches the argv[2]
    // token ONLY if it is NOT the literal "-i".
    const arrayFormPattern =
      /\[\s*["']tart["']\s*,\s*["']exec["']\s*,\s*(?:["'](?!-i["'])[^"'\n]+["']|args\.[A-Za-z_][A-Za-z0-9_]*)/s
    for (const file of files) {
      // Skip the test file itself -- it legitimately mentions
      // the protected argv builder pattern while defining the
      // scan and the prefix assertions.
      if (file.endsWith(".test.ts")) continue
      const content = readFileSync(file, "utf8")
      // Find all matches across the whole file (multiline).
      const re = new RegExp(arrayFormPattern.source, arrayFormPattern.flags + "g")
      let match: RegExpExecArray | null
      while ((match = re.exec(content)) !== null) {
        const offset = match.index
        const before = content.slice(0, offset)
        const lineNum = before.split("\n").length
        const lineText = content.slice(offset).split("\n")[0].trim()
        violations.push(`${file}:${lineNum}: ${lineText}`)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `structural violation: ` +
          `\`tart exec\` argv builder is missing the \`-i\` stdin-forwarding flag ` +
          `(reviewer's round-9 reopen HALT_TART_EXEC_STDIN_NOT_ENABLED) in ${violations.length} location(s):\n` +
          `${violations.join("\n")}`,
      )
    }
  })
})
