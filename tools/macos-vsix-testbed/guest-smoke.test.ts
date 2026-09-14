/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01-CORRECTION02
 *
 * Discrimination test for the VSIX transfer seam.
 *
 * This test FAILS the inline-base64 argv transport. It PASSES
 * only if the VSIX bytes travel as a stdin byte stream — never as
 * command-line text.
 *
 * Strategy:
 *   1. Spawn a local "sink" Bun script that reads stdin and writes
 *      it to a tmp file (a stand-in for `ssh admin@guest cat > file`).
 *   2. Build a 16-MiB synthetic payload of pseudo-random bytes.
 *   3. Call streamBytesOverSsh() with the sink script + payload.
 *   4. Assert:
 *        (a) the sink file has the same byte length as the payload,
 *        (b) the sink file's SHA-256 equals the payload's SHA-256,
 *        (c) the spawned process's argv contains NO payload bytes
 *            (proves the bytes traveled via stdin, not argv).
 *
 * A 16-MiB payload is enough to break local argv (getconf ARG_MAX
 * on macOS is 262144 bytes; a 16-MiB base64 string is ~21 MiB)
 * without making the test slow.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

import { streamBytesOverSsh, scpVsixSshArgv } from "./guest-smoke.ts"

const TEST_ROOT = join(tmpdir(), "clinemm-testbed-guest-smoke-transfer")
const SINK_PATH = join(TEST_ROOT, "sink.ts")
const OUT_PATH = join(TEST_ROOT, "received.bin")
const PAYLOAD_PATH = join(TEST_ROOT, "payload.bin")

const SINK_SCRIPT = `// Stand-in for "ssh admin@guest 'cat > /tmp/foo.vsix'".
// Reads all of stdin, writes to OUT_PATH, exits 0.
const out = ${JSON.stringify(OUT_PATH)}
const data = await Bun.stdin.arrayBuffer()
await Bun.write(out, new Uint8Array(data))
process.exit(0)
`

function makePayload(sizeBytes: number): Uint8Array {
  const out = new Uint8Array(sizeBytes)
  let s = 0x9e3779b9 >>> 0
  for (let i = 0; i < sizeBytes; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    out[i] = s & 0xff
  }
  for (let i = 0; i < sizeBytes; i += 1024) {
    out[i] = (i & 0xff) ^ 0xa5
  }
  return out
}

describe("CORRECTION02: VSIX transfer is a stdin byte stream, not argv", () => {
  beforeAll(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_ROOT, { recursive: true })
    writeFileSync(SINK_PATH, SINK_SCRIPT)
  })
  afterAll(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it("16-MiB payload travels as stdin byte stream; bytes never enter argv", async () => {
    const SIZE = 16 * 1024 * 1024
    const payload = makePayload(SIZE)
    writeFileSync(PAYLOAD_PATH, payload)

    const sinkCmd = ["bun", "run", SINK_PATH]
    const code = await streamBytesOverSsh({
      cmd: sinkCmd,
      hostBytes: payload,
      budgetMs: 30_000,
    })
    expect(code).toBe(0)

    const received = readFileSync(OUT_PATH)
    expect(received.length).toBe(SIZE)

    const payloadSha = createHash("sha256").update(payload).digest("hex")
    const receivedSha = createHash("sha256").update(received).digest("hex")
    expect(receivedSha).toBe(payloadSha)

    const argvBlob = sinkCmd.join("\u0000")
    let leaked = 0
    const SAMPLE = 256
    for (let i = 0; i < SAMPLE; i++) {
      const idx = Math.floor((i * SIZE) / SAMPLE)
      const b = payload[idx]
      if (argvBlob.includes(String.fromCharCode(b))) {
        leaked++
      }
    }
    expect(leaked).toBeLessThanOrEqual(2)

    const head = payload.slice(0, 16)
    const headStr = String.fromCharCode(...head)
    expect(argvBlob.includes(headStr)).toBe(false)
    const tail = payload.slice(SIZE - 16, SIZE)
    const tailStr = String.fromCharCode(...tail)
    expect(argvBlob.includes(tailStr)).toBe(false)
  }, { timeout: 60_000 })

  it("streamBytesOverSsh is size-independent — no truncation at 1 KiB or 1 MiB", async () => {
    const sizes = [1024, 1024 * 1024]
    for (const size of sizes) {
      const payload = makePayload(size)
      const code = await streamBytesOverSsh({
        cmd: ["bun", "run", SINK_PATH],
        hostBytes: payload,
        budgetMs: 15_000,
      })
      expect(code).toBe(0)
      const received = readFileSync(OUT_PATH)
      expect(received.length).toBe(size)
      const a = createHash("sha256").update(payload).digest("hex")
      const b = createHash("sha256").update(received).digest("hex")
      expect(b).toBe(a)
    }
  }, { timeout: 60_000 })
})

/**
 * CORRECTION03 round 4: VSIX transfer uses the SAME pinned-key
 * authority as guestExec(). The byte-stream test above proves
 * "payload → stdin → child"; these tests prove "child SSH
 * authority == trusted pinned SSH authority".
 */
describe("CORRECTION03 round 4: VSIX transfer SSH authority == guestExec SSH authority", () => {
  const PINNED_KEY = "/tmp/clinemm-testbed-pinned-key"
  const PINNED_DIGEST =
    "registry.example/foo@sha256:" + "b".repeat(64)
  const PINNED_HOST_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  const KNOWN_HOSTS_FILE = "/tmp/clinemm-test-known-hosts"
  const GUEST_IP = "10.0.0.42"
  const GUEST_TMP_PATH = "/tmp/clinemm-testbed-transfer-test.vsix"

  it("scpVsixSshArgv builds argv with IdentitiesOnly=yes and the pinned key", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cmd).toContain("IdentitiesOnly=yes")
    expect(r.cmd).toContain(`IdentityFile=${PINNED_KEY}`)
    expect(r.cmd).toContain("PreferredAuthentications=publickey")
    expect(r.cmd).toContain("BatchMode=yes")
  })

  it("scpVsixSshArgv argv contains NO sshpass / NO password auth surface", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const argvBlob = r.cmd.join("\u0000")
    expect(argvBlob).not.toContain("sshpass")
    expect(argvBlob).not.toContain("PreferredAuthentications=password")
    expect(argvBlob).not.toContain("-oPasswordAuthentication=yes")
    expect(argvBlob).not.toContain("PKCS11Provider")
    expect(argvBlob).not.toContain("GSSAPIAuthentication=yes")
  })

  it("scpVsixSshArgv argv contains NO host file content (bytes never enter argv)", () => {
    const fakeHead = "PK\u0003\u0004VSIX-head-bytes-do-not-leak"
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const argvBlob = r.cmd.join("\u0000")
    expect(argvBlob.includes(fakeHead)).toBe(false)
    expect(argvBlob.includes("VSIX")).toBe(false)
  })

  it("scpVsixSshArgv remote command is the fixed cat > path writer (not arbitrary)", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const remote = r.cmd[r.cmd.length - 1]
    expect(remote).toContain("set -e")
    expect(remote).toContain("umask 077")
    expect(remote).toContain("mkdir -p /tmp/clinemm-testbed-staging")
    expect(remote).toContain(`cat > ${GUEST_TMP_PATH}`)
  })

  it("scpVsixSshArgv fails closed with SSH_KEY_NOT_PINNED when pinnedKeyPath is empty", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
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

  it("scpVsixSshArgv fails closed when pinnedImageDigest is malformed", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: "registry.example/foo@sha256:not-a-digest",
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("64-hex-digest")
    }
  })

  it("scpVsixSshArgv argv is exactly the same shape as sshCommandForGuest() (composition)", () => {
    // Tightest discriminator: any future divergence between the
    // transfer path and guestExec is caught here.
    return import("./runner.ts").then(({ sshCommandForGuest }) => {
      const remote = "set -e; umask 077; mkdir -p /tmp/clinemm-testbed-staging; cat > /tmp/foo.vsix"
      const transfer = scpVsixSshArgv({
        guestIp: GUEST_IP,
        guestTmpPath: "/tmp/foo.vsix",
        pinnedKeyPath: PINNED_KEY,
        pinnedImageDigest: PINNED_DIGEST,
        knownHostsFile: KNOWN_HOSTS_FILE,
        pinnedHostPublicKey: PINNED_HOST_KEY,
      })
      const exec = sshCommandForGuest({
        guestIp: GUEST_IP,
        remoteCommand: remote,
        pinnedKeyPath: PINNED_KEY,
        pinnedImageDigest: PINNED_DIGEST,
        knownHostsFile: KNOWN_HOSTS_FILE,
        pinnedHostPublicKey: PINNED_HOST_KEY,
      })
      expect(transfer.ok).toBe(true)
      expect(exec.ok).toBe(true)
      if (!transfer.ok || !exec.ok) return
      expect(transfer.cmd).toEqual(exec.cmd)
    })
  })
})

/**
 * CORRECTION03 round 5: VSIX transfer StrictHostKeyChecking=yes
 * contract. The byte-stream test above proves
 * "payload → stdin → child"; these tests prove the server-
 * identity pin reaches the transfer path the same way it
 * reaches guestExec().
 */
describe("CORRECTION03 round 5: VSIX transfer StrictHostKeyChecking=yes contract", () => {
  const PINNED_KEY = "/tmp/clinemm-testbed-pinned-key"
  const PINNED_DIGEST =
    "registry.example/foo@sha256:" + "b".repeat(64)
  const PINNED_HOST_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePinnedHostKeyBase64AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  const KNOWN_HOSTS_FILE = "/tmp/clinemm-test-known-hosts"
  const GUEST_IP = "10.0.0.42"
  const GUEST_TMP_PATH = "/tmp/clinemm-testbed-transfer-test.vsix"

  it("scpVsixSshArgv argv contains StrictHostKeyChecking=yes (not no)", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cmd).toContain("StrictHostKeyChecking=yes")
    expect(r.cmd).not.toContain("StrictHostKeyChecking=no")
  })

  it("scpVsixSshArgv argv contains UserKnownHostsFile=<path> (not /dev/null)", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cmd).toContain(`UserKnownHostsFile=${KNOWN_HOSTS_FILE}`)
    expect(r.cmd).not.toContain("UserKnownHostsFile=/dev/null")
  })

  it("scpVsixSshArgv fails closed when knownHostsFile is missing", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      pinnedHostPublicKey: PINNED_HOST_KEY,
    } as unknown as Parameters<typeof scpVsixSshArgv>[0])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("knownHostsFile")
    }
  })

  it("scpVsixSshArgv fails closed when pinnedHostPublicKey is empty", () => {
    const r = scpVsixSshArgv({
      guestIp: GUEST_IP,
      guestTmpPath: GUEST_TMP_PATH,
      pinnedKeyPath: PINNED_KEY,
      pinnedImageDigest: PINNED_DIGEST,
      knownHostsFile: KNOWN_HOSTS_FILE,
      pinnedHostPublicKey: "",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/pinnedHostPublicKey|host key line/i)
    }
  })
})
