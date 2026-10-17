// =============================================================================
// ACT-CLINEMM-TART-HELPER-REAL-LIFECYCLE-CORRECTION01
//
// Bounded RED tests for the native helper's `tart.testbed.run` lifecycle.
// Each test exercises a specific defect identified in the source review:
//
//   TBRUNNER-RL-01: SSH argv must include -o before every "key=value"
//                   option (UserKnownHostsFile=, ConnectTimeout=) so
//                   openssh parses it as configuration, not a hostname.
//   TBRUNNER-RL-02: per-run ed25519 identity + known_hosts MUST exist
//                   on disk before the first SSH attempt (otherwise
//                   BatchMode + StrictHostKeyChecking can never
//                   succeed).
//   TBRUNNER-RL-03: a non-zero SSH exit code from a guest command MUST
//                   surface as an explicit error code (TART_CMD_FAILED),
//                   not silently succeed via `(void)ex_r`.
//   TBRUNNER-RL-04: a failed `tart stop` MUST surface as an explicit
//                   error code, not silently succeed.
//   TBRUNNER-RL-05: a failed `tart delete` MUST surface as an explicit
//                   error code, not silently succeed.
//   TBRUNNER-RL-06: a WAIT_SSH timeout (or any post-clone failure)
//                   MUST result in the VM being deleted from the host,
//                   not orphaned.
//
// The helper binary is built by `bash build.sh` on first run.
//
// Per-test timeout: 30s (the synthetic lifecycle takes ~10–15s
// with CLINEMM_TBR_SSH_TIMEOUT_MS=8000; we add slack for the
// fail-fast tests that hit the SSH deadline).
// =============================================================================

import { test, expect, beforeAll, afterAll } from "bun:test"
// Per-test timeout is set via the third arg of `test(name, fn, ms)`.

import { spawn, type Subprocess } from "bun"
import { createConnection } from "node:net"
import {
  existsSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  copyFileSync,
} from "node:fs"
import { join } from "node:path"
import { ensureHelperBinary } from "./test-helper-build"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")

let fixtureRoot: string

const IMAGE = "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64)

type SshBehavior = "exit0" | "capture-argv"
type DeleteBehavior = "ok" | "fail"
type StopBehavior = "ok" | "fail"

interface HelperCtx {
  workDir: string
  socketPath: string
  statusPath: string
  sshCapturedPath: string
  scpCapturedPath: string
  deleteCallsPath: string
  deleteExitPath: string
  sshExitPath: string
  cmdExitPath: string
  stopExitPath: string
  toolDir: string
  proc: Subprocess | null
}

async function startHelper(opts: {
  sshBehavior: SshBehavior
  deleteBehavior: DeleteBehavior
  stopBehavior: StopBehavior
  sshExit?: number
}): Promise<HelperCtx> {
  const ctx: HelperCtx = {
    workDir: join(fixtureRoot, "run-" + Math.random().toString(36).slice(2, 8)),
    socketPath: "",
    statusPath: "",
    sshCapturedPath: "",
    scpCapturedPath: "",
    deleteCallsPath: "",
    deleteExitPath: "",
    sshExitPath: "",
    cmdExitPath: "",
    stopExitPath: "",
    toolDir: "",
    proc: null,
  }
  ctx.socketPath = join(ctx.workDir, "helper.sock")
  ctx.statusPath = join(ctx.workDir, "status.json")
  ctx.sshCapturedPath = join(ctx.workDir, "ssh.argv.txt")
  ctx.scpCapturedPath = join(ctx.workDir, "scp.argv.txt")
  ctx.deleteCallsPath = join(ctx.workDir, "delete.calls.txt")
  ctx.deleteExitPath = join(ctx.workDir, "delete.exit")
  ctx.sshExitPath = join(ctx.workDir, "ssh.exit")
  ctx.cmdExitPath = join(ctx.workDir, "cmd.exit")
  ctx.stopExitPath = join(ctx.workDir, "stop.exit")

  mkdirSync(ctx.workDir, { recursive: true, mode: 0o755 })

  // Fake-tart: clone/run always exit 0; `tart ip` returns an
  // IP-shaped string. `tart stop` and `tart delete` return whatever
  // the controlled exit file says.
  const fakeTart = join(ctx.workDir, "fake-tart")
  writeFileSync(
    fakeTart,
    `#!/bin/sh
case "$1" in
  ip) echo "192.168.64.42"; exit 0 ;;
  stop) exit $(cat ${ctx.stopExitPath} 2>/dev/null || echo 0) ;;
  delete) echo "$@" >> ${ctx.deleteCallsPath}; exit $(cat ${ctx.deleteExitPath} 2>/dev/null || echo 0) ;;
  *) exit 0 ;;
esac
`,
  )
  chmodSync(fakeTart, 0o755)

  // Fake ssh / ssh-keygen / scp: copy the static multi-mode script
  // (see fake-ssh.sh next to this test file) into the per-test
  // toolbin dir. The script dispatches on its basename:
  //   ssh-keygen -f <path> → creates <path> and <path>.pub, exit 0
  //   ssh (with FAKE_SSH_CAPTURE_PATH set) → records argv, then
  //                                          exits FAKE_SSH_EXIT
  //   ssh (no capture) → exits FAKE_SSH_EXIT
  //   scp → exits 0
  const toolDir = join(ctx.workDir, "toolbin")
  mkdirSync(toolDir, { recursive: true, mode: 0o755 })
  const fakeSsh = join(toolDir, "ssh")
  const fakeScp = join(toolDir, "scp")
  const fakeKeygen = join(toolDir, "ssh-keygen")
  copyFileSync(join(SCRIPT_DIR, "fake-ssh.sh"), fakeSsh)
  chmodSync(fakeSsh, 0o755)
  try {
    const { symlinkSync } = await import("node:fs")
    symlinkSync(fakeSsh, fakeScp)
    symlinkSync(fakeSsh, fakeKeygen)
  } catch {
    // best-effort
  }
  ctx.toolDir = toolDir

  writeFileSync(ctx.stopExitPath, opts.stopBehavior === "fail" ? "1\n" : "0\n")
  writeFileSync(ctx.deleteExitPath, opts.deleteBehavior === "fail" ? "1\n" : "0\n")
  writeFileSync(ctx.sshExitPath, "0\n")
  writeFileSync(ctx.cmdExitPath, "0\n")

  ctx.proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: ctx.socketPath,
      CLINEMM_HELPER_STATUS_PATH: ctx.statusPath,
      CLINEMM_TART_EXECUTABLE: fakeTart,
      CLINEMM_TART_CACHE_DIR: join(ctx.workDir, "canary"),
      CLINEMM_TART_STAGING_DIR: join(ctx.workDir, "staging"),
      CLINEMM_HELPER_TOOL_DIR: ctx.toolDir,
      // Multi-mode fake ssh: read the controlled exit code from
      // the per-test FAKE_SSH_EXIT_FILE (the fake ssh reads its
      // first byte every invocation). Tests can change the
      // controlled exit code mid-test by rewriting the file.
      FAKE_SSH_EXIT_FILE: ctx.sshExitPath,
      FAKE_SSH_CMD_EXIT_FILE: ctx.cmdExitPath,
      FAKE_SSH_CAPTURE_PATH: opts.sshBehavior === "capture-argv"
        ? ctx.sshCapturedPath
        : "",
      // Generous SSH deadline (8s) so tests that rely on a fake
      // ssh to "succeed" have time to resolve WAIT_SSH. The
      // exit0/capture-argv tests still hit the deadline promptly
      // when they write 255 to sshExitPath.
      CLINEMM_TBR_SSH_TIMEOUT_MS: "8000",
      CLINEMM_TBR_SSH_POLL_MS: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  for (let i = 0; i < 50; i++) {
    if (existsSync(ctx.statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(ctx.statusPath)) {
    try { ctx.proc.kill() } catch {}
    throw new Error("helper did not start (status.json missing)")
  }
  return ctx
}

function stopHelper(ctx: HelperCtx): void {
  try { ctx.proc?.kill() } catch {}
}

function send(ctx: HelperCtx, payload: string, timeoutMs = 25000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(ctx.socketPath, () => {
      sock.write(payload + "\n")
    })
    let buf = ""
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("TIMEOUT")) }, timeoutMs)
    sock.on("data", (c) => {
      buf += c.toString()
      const i = buf.indexOf("\n")
      if (i >= 0) {
        clearTimeout(timer)
        sock.end()
        resolve(buf.slice(0, i))
      }
    })
    sock.on("error", (err) => { clearTimeout(timer); reject(err) })
    sock.on("end", () => {
      clearTimeout(timer)
      if (buf.length > 0) resolve(buf)
      else reject(new Error("helper closed"))
    })
  })
}

beforeAll(async () => {
  // ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
  // Always build-and-verify a fresh canonical helper. The old
  // pattern (require a pre-existing binary) is no longer safe —
  // a stale ablated binary at the canonical path is exactly the
  // failure mode the bounded fix prevents.
  await ensureHelperBinary()
  fixtureRoot = `/tmp/clinemm-real-lifecycle-correction01-${Date.now().toString(36)}`
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o755 })
})

afterAll(async () => {
  if (process.env.KEEP_FIXTURE) {
    console.log(`[KEEP_FIXTURE] fixtureRoot=${fixtureRoot}`)
    return
  }
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

// TBRUNNER-RL-01: SSH argv must include -o before every "Key=Value"
// option. The previous source emitted
//   argv[7] = "UserKnownHostsFile=..."   (no leading "-o")
//   argv[8] = "ConnectTimeout=..."        (no leading "-o")
// which makes openssh treat them as positional hostnames. The
// corrected source MUST emit a valid -o KEY=VAL pair for each
// option. This test installs a fake ssh that captures its argv to
// a file, drives the helper through a real tart.testbed.run, then
// asserts that every "key=value" token has a "-o" immediately
// preceding it.
test("TBRUNNER-RL-01: SSH argv includes -o before every -o KEY=VAL option", async () => {
  const ctx = await startHelper({
    sshBehavior: "capture-argv",
    stopBehavior: "ok",
    deleteBehavior: "ok",
  })
  try {
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-01-argv-shape",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["echo", "ok"] }],
      }),
    })
    await send(ctx, req)
    expect(existsSync(ctx.sshCapturedPath)).toBe(true)
    const argv = readFileSync(ctx.sshCapturedPath, "utf-8")
      .split("\n")
      .filter((l) => l.startsWith("argv["))
      .map((l) => l.replace(/^argv\[\d+\]=\d+=/, ""))
    expect(argv.length).toBeGreaterThan(0)
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]
      if (a.startsWith("-") || !a.includes("=")) continue
      expect(argv[i - 1]).toBe("-o")
    }
  } finally {
    stopHelper(ctx)
  }
})

// TBRUNNER-RL-02: per-run ed25519 identity + known_hosts must exist
// on disk before the first SSH attempt. The previous source
// referenced these paths but never created the files, so every
// BatchMode+StrictHostKeyChecking SSH call would fail. The
// corrected source MUST create id_ed25519, id_ed25519.pub, and
// known_hosts in the per-run staging dir.
test("TBRUNNER-RL-02: staging dir contains id_ed25519 and known_hosts after tart.testbed.run", async () => {
  const ctx = await startHelper({
    sshBehavior: "exit0",
    stopBehavior: "ok",
    deleteBehavior: "ok",
  })
  try {
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-02-staging-files",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["echo", "ok"] }],
      }),
    })
    await send(ctx, req)
    const stagingRoot = join(ctx.workDir, "staging")
    const runs = existsSync(stagingRoot) ? readdirSync(stagingRoot) : []
    let found = false
    for (const run of runs) {
      const p = join(stagingRoot, run)
      const hasId = existsSync(join(p, "id_ed25519"))
      const hasPub = existsSync(join(p, "id_ed25519.pub"))
      const hasKh = existsSync(join(p, "known_hosts"))
      if (hasId && hasPub && hasKh) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  } finally {
    stopHelper(ctx)
  }
})

// TBRUNNER-RL-03: a non-zero SSH command exit code MUST surface as
// an explicit error code (TART_CMD_FAILED), not silently succeed
// via `(void)ex_r`. The previous source discarded the ssh_exec
// result.
test("TBRUNNER-RL-03: non-zero SSH command exit surfaces as TART_CMD_FAILED (not PASS)", async () => {
  const ctx = await startHelper({
    sshBehavior: "exit0",
    stopBehavior: "ok",
    deleteBehavior: "ok",
  })
  try {
    // Make only the COMMAND exit 7; WAIT_SSH still uses 0.
    writeFileSync(ctx.cmdExitPath, "7\n")
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-03-cmd-fail",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["false"] }],
      }),
    })
    const resp = JSON.parse(await send(ctx, req))
    expect(resp.ok).toBe(false)
    expect(resp.error).toBe("TART_CMD_FAILED")
  } finally {
    stopHelper(ctx)
  }
})

// TBRUNNER-RL-04: a failed `tart stop` MUST surface as
// TART_STOP_FAILED, not silently succeed via `(void)stop_inv`.
// This test uses sshBehavior="exit0" so WAIT_SSH succeeds (the
// fake ssh exits 0 when called with "true"), letting the
// lifecycle reach the stop step where the controlled exit
// file makes `tart stop` fail.
test("TBRUNNER-RL-04: tart stop failure surfaces as TART_STOP_FAILED", async () => {
  const ctx = await startHelper({
    sshBehavior: "exit0",
    stopBehavior: "fail",
    deleteBehavior: "ok",
  })
  try {
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-04-stop-fail",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["true"] }],
      }),
    })
    const resp = JSON.parse(await send(ctx, req))
    expect(resp.ok).toBe(false)
    expect(resp.error).toBe("TART_STOP_FAILED")
  } finally {
    stopHelper(ctx)
  }
})

// TBRUNNER-RL-05: a failed `tart delete` MUST surface as
// TART_DELETE_FAILED, not silently succeed via `(void)del_inv`.
// Like RL-04, this needs WAIT_SSH to succeed so the lifecycle
// reaches the delete step. Stop succeeds; delete exits 1.
test("TBRUNNER-RL-05: tart delete failure surfaces as TART_DELETE_FAILED", async () => {
  const ctx = await startHelper({
    sshBehavior: "exit0",
    stopBehavior: "ok",
    deleteBehavior: "fail",
  })
  try {
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-05-delete-fail",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["true"] }],
      }),
    })
    const resp = JSON.parse(await send(ctx, req))
    expect(resp.ok).toBe(false)
    expect(resp.error).toBe("TART_DELETE_FAILED")
  } finally {
    stopHelper(ctx)
  }
})

// TBRUNNER-RL-06: WAIT_SSH timeout (or any post-clone failure)
// MUST result in `tart delete` being called on the VM before the
// helper responds, so the guest is not orphaned on the host.
test("TBRUNNER-RL-06: WAIT_SSH timeout triggers VM delete (no orphan)", async () => {
  const ctx = await startHelper({
    sshBehavior: "exit0",
    stopBehavior: "ok",
    deleteBehavior: "ok",
  })
  try {
    // Make WAIT_SSH fail (every ssh true call returns 255). The
    // helper's WAIT_SSH loop will then time out and emit
    // TART_SSH_TIMEOUT. The orphan-prevention gate MUST have
    // called `tart delete` before responding.
    writeFileSync(ctx.sshExitPath, "255\n")
    const req = JSON.stringify({
      version: 1,
      request_id: "rl-06-orphan",
      method: "tart.testbed.run",
      spec: JSON.stringify({
        image: IMAGE,
        commands: [{ argv: ["true"] }],
      }),
    })
    const resp = JSON.parse(await send(ctx, req))
    expect(resp.ok).toBe(false)
    expect(resp.error).toBe("TART_SSH_TIMEOUT")
    const calls = existsSync(ctx.deleteCallsPath)
      ? readFileSync(ctx.deleteCallsPath, "utf-8")
      : ""
    expect(calls).toContain("delete")
  } finally {
    stopHelper(ctx)
  }
})




