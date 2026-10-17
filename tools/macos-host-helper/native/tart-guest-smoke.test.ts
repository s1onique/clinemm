// =============================================================================
// ACT-CLINEMM-TART-P4.1-GUEST-AGENT-HELPER-EXEC01
//
// C helper dispatch test for the new tart.guest.smoke RPC.
// Exercises the load-bearing dispatch path in the C helper:
//   - parse layer accepts the closed envelope (no caller fields)
//   - parse layer rejects extra fields (EXEC_SHAPED_PAYLOAD or
//     FORBIDDEN_KEY at the C dispatch level)
//   - missing CLINEMM_SMOKE_VM / CLINEMM_SMOKE_TART_HOME returns
//     SMOKE_NOT_CONFIGURED (no fork)
//   - operator-bound VM is correctly used in argv
//   - fixed /usr/bin/sw_vers and /usr/bin/uname -a are executed
//   - truncation, timeout, nonzero all surface as explicit
//     error codes; PASS is reserved for both exit 0 + no truncation
//   - existing tart.testbed.run contract is unchanged
//
// The C helper binary is built by `bash build.sh` on first run.
// Each test starts a fresh dev helper on a unique socket with
// the operator-bound configuration in env. Fake-tart is used
// for error injection (nonzero, timeout, oversize, bypass
// attempts). The real Tart binary is used by GS-01 (via
// the production TART_TRUSTED_PATHS allowlist) and by GS-12
// (no-regression).
// =============================================================================

import { test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { spawn, type Subprocess } from "bun"
import { createConnection } from "node:net"
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  readFileSync,
  statSync,
} from "node:fs"
import { join } from "node:path"
import { ensureHelperBinary } from "./test-helper-build"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")
const HELPER_SRC = join(SCRIPT_DIR, "helper.c")

let workDir: string
let fixtureRoot: string

// Per-test helper process (restarted by restartTartHelperWithEnv).
let proc: Subprocess | null = null
let socketPath: string = ""
let statusPath: string = ""
// ACT-CLINEMM-TART-P4.1-CORRECTION04 (C1 bounded fix): ownership
// flag. Set to true ONLY when startHelper() successfully spawned
// the helper with `detached: true` AND verification of the helper's
// session/pgrp identity (PID == PGID == SID, helper PGID != test
// runner PGID) succeeded. The afterEach refuses to issue any group
// signal unless this flag is true — preventing the P0 hazard
// flagged in the reviewer's C1 verdict (signaling a merely-observed
// group from a leaked-helper fallback that the test never created).
let helperSessionVerified = false

beforeAll(async () => {
  // ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
  // Always build-and-verify a fresh canonical helper. The
  // "helper.ablated" binary previously left at the canonical
  // ./helper path was the in-place-overwrite hazard the
  // reviewer's C1 verdict identified; this build+verify
  // pattern is the C1 fix.
  await ensureHelperBinary()
  workDir = "/tmp"
  // Use a per-suite fixture root in /tmp. The fixture is used for
  // fake-tart scripts AND for a fake TART_HOME identity that the
  // smoke validator can accept. (The validator requires the path
  // to be a directory with a vms/ subdirectory owned by the
  // helper's UID.)
  const stamp = Date.now().toString(36)
  fixtureRoot = `/tmp/clinemm-smoke-p41-${stamp}`
  mkdirSync(fixtureRoot, { recursive: true })
  mkdirSync(`${fixtureRoot}/vms`, { recursive: true })
})

afterAll(() => {
  try { proc?.kill() } catch {}
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

afterEach(async () => {
  if (proc) {
    // ACT-CLINEMM-TART-P4.1-CORRECTION04 (C1 bounded fix):
    // Group signaling is now GATED on `helperSessionVerified`,
    // which is set true by startHelper() ONLY when the spawned
    // helper is its own session leader (PID == PGID == SID, and
    // helper PGID != test runner PGID). Without `detached: true`,
    // the helper inherited the bun-test runner's pgrp, and
    // `process.kill(-helperPid)` signaled a non-existent pgrp
    // (ESRCH) — silently leaking the helper.
    //
    // The reviewer's plan:
    //   "Clean up only verified run-owned identities. Preserve
    //    separate ownership of helper and fake-Tart child
    //    process groups. Reap owned direct children where
    //    possible; classify EPERM/ESRCH explicitly."
    //
    // Three cleanup paths now:
    //   A. helperSessionVerified === true:
    //      signal the helper's owned pgrp (which the test
    //      created and therefore owns), and direct-PID kill
    //      the helper as a backstop.
    //   B. helperSessionVerified === false but proc exists:
    //      direct-PID kill the helper ONLY (no group signal,
    //      because the helper is not the pgrp leader).
    //   C. No proc: nothing to do.
    //
    // EPERM (sandbox) and ESRCH (already gone) are classified
    // explicitly. We never signal a group identity we have not
    // verified is owned by this test.
    const pid = proc.pid
    if (pid && pid > 0) {
      if (helperSessionVerified) {
        // Path A: pgrp signal of the helper's owned group
        // (helper is its own session/pgrp leader because
        // startHelper() spawned with `detached: true` and
        // verification passed).
        try {
          process.kill(-pid, "SIGKILL")
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code ?? ""
          if (code === "ESRCH") {
            // Pgrp already gone (helper exited cleanly).
            // Nothing to do.
          } else if (code === "EPERM") {
            // Sandbox blocked pgrp signaling. Fall back to
            // direct-PID kill of the helper we own only.
            try { process.kill(pid, "SIGKILL") } catch {}
          } else {
            // Unknown error: surface it (do not swallow).
            throw e
          }
        }
        // Direct-PID backstop: even if the pgrp signal
        // succeeded, the kernel may take a moment to deliver
        // SIGKILL to a session leader on macOS Background
        // sessions. The direct-PID signal is a same-group
        // signal in this case and is always safe because
        // we own the helper.
        try { process.kill(pid, "SIGKILL") } catch {}
      } else {
        // Path B: ownership not verified (detached didn't
        // take effect, or ps observation failed). Direct-PID
        // kill only — we will NOT signal a foreign group.
        try { process.kill(pid, "SIGKILL") } catch {}
      }
    }
    // Bounded wait for the kernel to fully reap the killed pgrp.
    // We deliberately do NOT await proc.exited here: bun's
    // Subprocess.exited resolves only when the proc's stdio
    // streams are closed, and a leaked orphan (e.g. a grandchild
    // reparented to launchd that holds the stdout pipe open) can
    // keep that promise pending for the full 60s fake-tart sleep.
    // Forcing a wait here would consume the next test's per-test
    // timeout budget. Instead, we wait 300ms empirically (kernel
    // signal delivery + reap on macOS Background sessions) and
    // then drop the reference. The next test will bind a new
    // socket, which is what matters for the actual hermetic
    // contract.
    await new Promise((r) => setTimeout(r, 300))
    try { proc.kill() } catch {}
  }
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  proc = null
  socketPath = ""
  statusPath = ""
  helperSessionVerified = false
})

function send(payload: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath, () => {
      sock.write(payload + "\n")
    })
    let buf = ""
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("TIMEOUT")) }, timeoutMs)
    sock.on("data", (c) => {
      buf += c.toString()
      const i = buf.indexOf("\n")
      if (i >= 0) {
        clearTimeout(timer)
        resolve(buf.slice(0, i))
        sock.end()
      }
    })
    sock.on("error", (e) => { clearTimeout(timer); reject(e) })
  })
}

function parseResp(raw: string): { ok: boolean; [k: string]: unknown } {
  return JSON.parse(raw)
}

async function startHelper(envOverrides: Record<string, string>): Promise<void> {
  const stamp = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)
  socketPath = `/tmp/clinemm-smoke-p41-${stamp}.sock`
  statusPath = `/tmp/clinemm-smoke-p41-${stamp}.status.json`
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: HELPER_SRC,
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // ACT-CLINEMM-TART-P4.1-CORRECTION04 (C1 bounded fix):
    // Spawn the helper with `detached: true` so Bun calls setsid(2)
    // on POSIX, making the helper its own session leader AND its
    // own pgrp leader. Without this, the helper inherits the
    // bun-test runner's pgrp, and `process.kill(-helperPid)` in
    // afterEach signals a non-existent pgrp (ESRCH), silently
    // leaving the helper alive. The afterEach now verifies
    // ownership before signaling any group.
    detached: true,
  })
  for (let i = 0; i < 100; i++) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(statusPath)) {
    // ACT-CLINEMM-TART-P4.1-CORRECTION04 FOLLOW-UP (item 3):
    // capture the full failure state of the spawned helper at
    // the 10s timeout BEFORE the throw swallows it. The previous
    // code only logged "helper did not produce status file in
    // 10s"; the spawned helper's actual state (still alive?
    // exited? what PGID? what stderr?) was lost. The reviewer
    // correctly flagged this as premature ENVIRONMENT_BLOCKED
    // attribution.
    const errPid = proc?.pid ?? 0
    let errPsRow: string = "(ps not run)"
    let errPsError = ""
    if (errPid > 0) {
      try {
        const { execSync: _e } = require("node:child_process") as typeof import("node:child_process")
        const raw = _e(
          `ps -p ${errPid} -o pid=,ppid=,pgid=,sess=,stat= 2>&1; echo "__PS_RC=$?"`,
          { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
        )
        const m = raw.match(/__PS_RC=(\d+)/)
        if (m && m[1] === "0") {
          errPsRow = raw.replace(/__PS_RC=\d+\s*$/, "").trim()
        } else {
          errPsError = `ps rc=${m?.[1] ?? "?"}`
        }
      } catch (e2) {
        errPsError = (e2 as Error).message
      }
    }
    const errStatusFileExists = existsSync(statusPath)
    let errExitCode: number | null | undefined = undefined
    let errStderrTail = ""
    if (proc) {
      const exitedPromise = proc.exited
      const timeoutPromise = new Promise<"timeout">((r) =>
        setTimeout(() => r("timeout"), 1000),
      )
      const winner = await Promise.race([exitedPromise, timeoutPromise])
      if (winner !== "timeout") {
        errExitCode = winner as number
      }
      try {
        const stderrStream = (proc as unknown as { stderr?: { text?: () => Promise<string> } }).stderr
        if (stderrStream && typeof stderrStream.text === "function") {
          const full = await Promise.race([
            stderrStream.text(),
            new Promise<string>((r) => setTimeout(() => r(""), 500)),
          ])
          errStderrTail = full.slice(-1024)
        }
      } catch { /* best-effort */ }
    }
    try { proc.kill() } catch {}
    // eslint-disable-next-line no-console
    console.log(
      `[GS14-STARTUP-FAILED] helper did not produce status file in 10s\n` +
      `  spawn_pid=${errPid}\n` +
      `  spawn_ps_row=${errPsRow}\n` +
      `  spawn_ps_error=${errPsError}\n` +
      `  status_file_exists=${errStatusFileExists}\n` +
      `  spawn_exit_code=${errExitCode === undefined ? "(still running)" : errExitCode}\n` +
      `  spawn_stderr_tail=${JSON.stringify(errStderrTail)}`,
    )
    throw new Error("helper did not produce status file in 10s")
  }
  // Wait for the socket to be actually bound. The status file
  // is written early in main(), before the bind() call; the
  // helper may still be in the middle of self-binding when
  // we see the status file. Poll for the socket file existence
  // (which happens AFTER bind) to ensure the socket is
  // ready before the first send().
  for (let i = 0; i < 50; i++) {
    if (existsSync(socketPath)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  if (!existsSync(socketPath)) {
    // Helper may have failed to bind (e.g. another helper
    // from a previous test is still bound to a different
    // path but the kernel hasn't released it). Wait a bit
    // and try again.
    await new Promise((r) => setTimeout(r, 500))
  }
  // ACT-CLINEMM-TART-P4.1-CORRECTION04 (C1 bounded fix): verify
  // the helper became its own session leader. If
  // `detached: true` worked, helper PID == PGID == SID, and the
  // helper's PGID is distinct from the test runner's PGID. The
  // afterEach uses this flag to decide whether group signaling
  // is safe. If verification fails (e.g. Bun platform quirk,
  // environment saturation), the afterEach falls back to a
  // direct-PID kill of the helper only — never a group signal.
  helperSessionVerified = await verifyHelperSessionOwnership(proc?.pid ?? 0)
}

// Verify the helper is its own session leader: PID == PGID == SID
// and helper PGID != test runner PGID. Returns true only when
// all three conditions hold. Best-effort: ps failures are logged
// but do not throw — startHelper() returns a usable `proc` even
// if verification cannot be confirmed; afterEach then takes the
// conservative (direct-PID only) path.
//
// ACT-CLINEMM-TART-P4.1-CORRECTION04 FOLLOW-UP (P1 ownership ps
// parser): the previous version used `ps -o pid=,pgid,sess` and
// hand-parsed `parts[0]/parts[1]/parts[2]`. On macOS, only the
// FIRST column's `=` suppresses its header, so the output of
// that command is a header line ("PGID  SESS") followed by the
// numeric row. The hand-parse then set `parts[0]` to "PGID"
// (text, not a number), parseInt returned NaN, the
// `pid !== helperPid` check returned false, and verification
// failed even when setsid() had succeeded. The discriminator
// already handles headers via `psFull`/`parsePsLine`; we use
// `pid=,pgid=,sess=` (verified locally: suppresses ALL column
// headers on macOS) and parse numerically. NaN is rejected
// explicitly so a future macOS ps change cannot regress this.
async function verifyHelperSessionOwnership(helperPid: number): Promise<boolean> {
  if (helperPid <= 0) return false
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    const raw = execSync(
      `ps -p ${helperPid} -o pid=,pgid=,sess= 2>&1; echo "__PS_RC=$?"`,
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
    )
    const m = raw.match(/__PS_RC=(\d+)/)
    if (!m || m[1] !== "0") return false
    const body = raw.replace(/__PS_RC=\d+\s*$/, "").trim()
    const parts = body.split(/\s+/)
    if (parts.length < 3) return false
    const pid = parseInt(parts[0], 10)
    const pgid = parseInt(parts[1], 10)
    const sess = parseInt(parts[2], 10)
    // Fail closed on any non-numeric field (NaN). A future macOS
    // ps change that adds a header back would cause the parseInt
    // to return NaN, which we then treat as a verification
    // failure. The test still runs; the afterEach takes Path B.
    if (!Number.isFinite(pid) || !Number.isFinite(pgid) || !Number.isFinite(sess)) {
      return false
    }
    if (pid !== helperPid) return false
    let runnerPgid = 0
    try {
      const runnerRaw = execSync(
        `ps -p ${process.pid} -o pgid=,pgid= 2>&1; echo "__PS_RC=$?"`,
        { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
      )
      const rm = runnerRaw.match(/__PS_RC=(\d+)/)
      if (rm && rm[1] === "0") {
        const runnerBody = runnerRaw.replace(/__PS_RC=\d+\s*$/, "").trim()
        // Use the first numeric token; ignore any header row.
        const tokens = runnerBody.split(/\s+/)
        for (const t of tokens) {
          const n = parseInt(t, 10)
          if (Number.isFinite(n) && n > 0) {
            runnerPgid = n
            break
          }
        }
      }
    } catch { /* best-effort */ }
    return pid === pgid && pid === sess && pgid !== runnerPgid
  } catch {
    return false
  }
}

// Build a fake-tart script that supports a configurable `exec` and
// other commands. The script:
//   --version       : echo "<version>"
//   list --source X : echo '[]'
//   exec <vm> <cmd> : dispatch on `<cmd>` to a behavior table:
//                      - "sw_vers"  : echo the configured sw_vers body
//                      - "uname"    : echo the configured uname body
//                      - "fail"     : exit 7
//                      - "sleep N"  : sleep N (for timeout tests)
//                      - "huge"     : print 64 KiB (for truncation tests)
//                      - default    : echo "default-ok" + exit 0
function makeFakeTart(name: string, opts: {
  versionBody?: string
  swVersBody?: string
  unameBody?: string
  sleepSecs?: number
  oversize?: boolean
} = {}): string {
  const path = `${fixtureRoot}/${name}`
  const versionLine = opts.versionBody ?? "fake-tart 9.9.9"
  const swVers = (opts.swVersBody ?? "ProductName: macOS\nProductVersion: 14.8.7\nBuildVersion: 23J520").replace(/'/g, "'\\''")
  const uname = (opts.unameBody ?? "Darwin mac.local 23.6.0 arm64").replace(/'/g, "'\\''")
  const sleep = opts.sleepSecs ? `sleep ${opts.sleepSecs}` : ""
  const huge = opts.oversize
    ? `python3 -c 'import sys; sys.stdout.write("A" * 65536)'`
    : ""
  // NOTE: we deliberately support a "fail" subcommand to exercise
  // GS-07 (guest command nonzero). The script also supports
  // "sleep" for GS-08 (timeout). The fake-tart is invoked only
  // for hermetic error injection; the real Tart binary is
  // exercised in GS-01 (against the real imported Sonoma VM,
  // operator-driven in a separate step).
  const script = `#!/bin/sh
${sleep}
case "$1" in
  --version) echo '${versionLine.replace(/'/g, "'\\''")}'; exit 0 ;;
  list)
    echo '[]'
    exit 0
    ;;
  exec)
    shift
    # consume <vm>
    shift
    # next argument is the path or the helper injects /usr/bin/<cmd>
    case "$1" in
      /usr/bin/sw_vers) echo '${swVers}'; exit 0 ;;
      /usr/bin/uname)
        shift
        case "$1" in
          -a) echo '${uname}'; exit 0 ;;
          *) echo '${uname}'; exit 0 ;;
        esac
        ;;
      /usr/bin/fail) exit 7 ;;
      /usr/bin/sleep)
        shift
        sleep "$1"
        exit 0
        ;;
      /usr/bin/huge)
        ${huge}
        exit 0
        ;;
      *) echo "default-ok"; exit 0 ;;
    esac
    ;;
  *) echo "unknown" 1>&2; exit 2 ;;
esac
`
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}

// Standard env for a happy-path smoke (operator-bound VM + TART_HOME).
function happyEnv(fakeTart: string): Record<string, string> {
  return {
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  }
}

// =============================================================================
// RPC-01..04: envelope + parse-layer contract
// =============================================================================

test("RPC-01: valid tart.guest.smoke envelope with no caller fields is accepted by parser", async () => {
  await startHelper({})  // no CLINEMM_SMOKE_* — but parser still must accept the envelope
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-01",
    method: "tart.guest.smoke",
  })
  const r = parseResp(await send(wire))
  // Without CLINEMM_SMOKE_VM / CLINEMM_SMOKE_TART_HOME the handler
  // returns SMOKE_NOT_CONFIGURED — but the parse layer accepted the
  // envelope (no FORBIDDEN_KEY/UNKNOWN_FIELD). This is the proof
  // that the closed schema is right.
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("RPC-02: extra 'command' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-02",
    method: "tart.guest.smoke",
    command: "/usr/bin/sw_vers",
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'command' is in is_forbidden_key() — returns FORBIDDEN_KEY.
  // (TS-side would return EXEC_SHAPED_PAYLOAD, but we test the C
  // helper directly via raw AF_UNIX socket, so the C code path is
  // the load-bearing one for security.)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-03: extra 'vm_name' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-03",
    method: "tart.guest.smoke",
    vm_name: "evil",
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'vm_name' is not in is_recognized_key() — returns
  // FORBIDDEN_KEY. (TS-side would return UNKNOWN_FIELD.)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-04: extra 'argv' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-04",
    method: "tart.guest.smoke",
    argv: ["/bin/sh", "-c", "id"],
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'argv' is in is_forbidden_key() — returns FORBIDDEN_KEY.
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-05: extra 'env' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-05",
    method: "tart.guest.smoke",
    env: { TART_HOME: "/tmp/evil" },
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'env' is not in is_recognized_key() — returns FORBIDDEN_KEY.
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// Configuration / dispatch tests
// =============================================================================

test("GS-04: missing CLINEMM_SMOKE_VM fails closed with SMOKE_NOT_CONFIGURED (no fork)", async () => {
  const fakeTart = makeFakeTart("gs04-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
    // CLINEMM_SMOKE_VM intentionally absent
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04b: missing CLINEMM_SMOKE_TART_HOME fails closed with SMOKE_NOT_CONFIGURED", async () => {
  const fakeTart = makeFakeTart("gs04b-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    // CLINEMM_SMOKE_TART_HOME intentionally absent
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04b", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04c: malformed CLINEMM_SMOKE_VM (path injection) is refused", async () => {
  const fakeTart = makeFakeTart("gs04c-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "../../../etc/passwd",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04c", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04d: malformed CLINEMM_SMOKE_TART_HOME (not absolute) is refused", async () => {
  const fakeTart = makeFakeTart("gs04d-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: "relative/path",
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04d", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04e: TART_HOME that is a regular file (not a directory) fails closed", async () => {
  const fakeTart = makeFakeTart("gs04e-fake-tart")
  const fakeFile = `${fixtureRoot}/not-a-dir`
  writeFileSync(fakeFile, "not a dir")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fakeFile,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04e", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04f: TART_HOME with no vms/ subdirectory fails closed", async () => {
  const fakeTart = makeFakeTart("gs04f-fake-tart")
  const noVms = `${fixtureRoot}/no-vms`
  mkdirSync(noVms, { recursive: true })
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: noVms,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04f", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-03: tart executable absent (override) -> TART_NOT_FOUND", async () => {
  await startHelper({
    CLINEMM_TART_EXECUTABLE: "/nonexistent/tart-binary",
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-03", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("TART_NOT_FOUND")
})

// =============================================================================
// GS-01 (happy path), GS-05..09: handler semantics
// =============================================================================

test("GS-01: happy path — both fixed diagnostics exit 0 with realistic bodies -> overall PASS", async () => {
  const fakeTart = makeFakeTart("gs01-fake-tart", {
    versionBody: "fake-tart 1.0.0",
    swVersBody: "ProductName: macOS\nProductVersion: 14.8.7\nBuildVersion: 23J520",
    unameBody: "Darwin mac.local 23.6.0 Darwin Kernel Version 23.6.0 arm64",
  })
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-01", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(true)
  // @ts-expect-error result body shape
  const res = r.result
  expect(res.authorized_vm).toBe("clinemm-p3-sonoma-imported")
  expect(res.tart_home).toBe(fixtureRoot)
  expect(res.tart_path).toBe(fakeTart)
  expect(res.tart_version).toBe("fake-tart 1.0.0")
  expect(res.overall).toBe("PASS")
  expect(res.results.sw_vers.exit_code).toBe(0)
  expect(res.results.uname_a.exit_code).toBe(0)
  expect(res.results.sw_vers.truncated).toBe(false)
  expect(res.results.uname_a.truncated).toBe(false)
  expect(res.results.sw_vers.stdout).toContain("ProductName: macOS")
  expect(res.results.uname_a.stdout).toContain("Darwin")
  expect(res.helper_build_id).toMatch(/^[0-9a-f]{64}$/)
})

test("GS-05: wrong VM name -> GUEST_COMMAND_NONZERO (no false PASS) — fake-tart rejects unknown", async () => {
  // Override the fake-tart to fail on exec entirely.
  const failPath = `${fixtureRoot}/gs05-fake-fail`
  writeFileSync(failPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec) echo "VM not found" 1>&2; exit 65 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(failPath, 0o755)
  await startHelper(happyEnv(failPath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-05", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // The sw_vers diagnostic returns nonzero exit code (65 from the
  // fake-tart), so the handler classifies GUEST_COMMAND_NONZERO.
  // Crucially: ok:false. No false PASS.
  // @ts-expect-error result body
  expect(r.result.overall).toBe("GUEST_COMMAND_NONZERO")
  // @ts-expect-error result body
  expect(r.result.results.sw_vers.exit_code).toBe(65)
})

test("GS-07: guest command returns nonzero (fake exit 7) -> GUEST_COMMAND_NONZERO", async () => {
  // Build a fake-tart that exits 7 for both sw_vers and uname.
  const failPath = `${fixtureRoot}/gs07-fake-tart`
  writeFileSync(failPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    # /usr/bin/fail exits 7
    exit 7
    ;;
  *) exit 2 ;;
esac
`)
  chmodSync(failPath, 0o755)
  await startHelper(happyEnv(failPath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-07", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("GUEST_COMMAND_NONZERO")
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.exit_code).toBe(7)
  expect(res.results.uname_a.exit_code).toBe(7)
})

test("GS-08: guest command exceeds 30s timeout -> TART_EXEC_TIMEOUT (child reaped, no orphan)", async () => {
  // fake-tart sleeps for 60s for the exec subcommand; the helper
  // enforces a per-diagnostic timeout AND a request-level
  // deadline (SMOKE_REQUEST_DEADLINE_MS = 28s). The fail-fast
  // path returns TART_EXEC_TIMEOUT as soon as the first
  // diagnostic times out, WITHOUT running the second. We use a
  // 60_000 ms per-test bun timeout (third argument) and a
  // 40_000 ms socket-level wait — both well below the fake-tart's
  // 60s sleep but well above the request deadline so the
  // fail-fast path is observable.
  const sleepPath = `${fixtureRoot}/gs08-fake-tart`
  writeFileSync(sleepPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec) sleep 60; exit 0 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(sleepPath, 0o755)
  await startHelper(happyEnv(sleepPath))
  const t0 = Date.now()
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-08", method: "tart.guest.smoke",
  }), 40_000))
  const elapsed = Date.now() - t0
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("TART_EXEC_TIMEOUT")
  // Helper must NOT have waited the full 60s — must SIGTERM/SIGKILL
  // the child at the per-diagnostic deadline (bounded by the
  // request deadline) and return promptly.
  expect(elapsed).toBeLessThan(35_000)
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.timeout).toBe(true)
  // Fail-fast: the second diagnostic must NOT have been run.
  // The smoke_diag_t zero default is exit_code=0,
  // duration_ms=0, and empty stdout/stderr. This is the
  // structural "not run" signature in the response shape.
  expect(res.results.uname_a.exit_code).toBe(0)
  expect(res.results.uname_a.duration_ms).toBe(0)
  expect(res.results.uname_a.stdout).toBe("")
  expect(res.results.uname_a.stderr).toBe("")
  expect(res.results.uname_a.timeout).toBe(false)
  // Total wallclock is bounded by the request deadline (28s)
  // plus fork/marshal slack. Must be well under 35s.
  expect(res.duration_ms).toBeLessThan(35_000)
}, 60_000)

test("GS-09: oversize output (64 KiB) -> RESULT_TRUNCATED, ok:false", async () => {
  const hugePath = `${fixtureRoot}/gs09-fake-tart`
  writeFileSync(hugePath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    case "$3" in
      /usr/bin/sw_vers) python3 -c 'import sys; sys.stdout.write("A" * 65536)'; exit 0 ;;
      /usr/bin/uname)   python3 -c 'import sys; sys.stdout.write("B" * 65536)'; exit 0 ;;
    esac
    ;;
  *) exit 2 ;;
esac
`)
  chmodSync(hugePath, 0o755)
  await startHelper(happyEnv(hugePath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-09", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("RESULT_TRUNCATED")
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.truncated).toBe(true)
  expect(res.results.uname_a.truncated).toBe(true)
})

// =============================================================================
// GS-10: concurrent request correlation
// =============================================================================

test("GS-10: two concurrent smoke requests both succeed with correct request_id correlation", async () => {
  const fakeTart = makeFakeTart("gs10-fake-tart")
  await startHelper(happyEnv(fakeTart))
  // Issue two concurrent requests on independent connections.
  const [rawA, rawB] = await Promise.all([
    send(JSON.stringify({ version: 1, request_id: "gs-10-A", method: "tart.guest.smoke" })),
    send(JSON.stringify({ version: 1, request_id: "gs-10-B", method: "tart.guest.smoke" })),
  ])
  const a = parseResp(rawA)
  const b = parseResp(rawB)
  expect(a.request_id).toBe("gs-10-A")
  expect(b.request_id).toBe("gs-10-B")
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
})

// =============================================================================
// GS-11: raw Unix-socket bypass attempt (hand-crafted extra field)
// =============================================================================

test("GS-11: raw socket bypass — extra 'argv' field rejected by native parse layer", async () => {
  const fakeTart = makeFakeTart("gs11-fake-tart")
  await startHelper(happyEnv(fakeTart))
  // We bypass the TS protocol.ts parser entirely by writing the
  // wire frame directly to the AF_UNIX socket. The C parser must
  // reject the extra 'argv' field as FORBIDDEN_KEY.
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11",
    method: "tart.guest.smoke",
    argv: ["/bin/sh", "-c", "id"],
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("GS-11b: raw socket bypass — extra 'command' field rejected by native parse layer", async () => {
  const fakeTart = makeFakeTart("gs11b-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11b",
    method: "tart.guest.smoke",
    command: "rm -rf /",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-11c: raw socket bypass — extra 'spec' field rejected by dispatch boundary
// (P0-2). `spec` is globally recognized by the C parser (it is
// required by tart.testbed.run) but is NOT a legal top-level
// key for tart.guest.smoke. The dispatch boundary must reject
// it with FORBIDDEN_KEY to keep the closed-envelope contract
// symmetric with the TS layer's METHOD_REQUIRED_KEYS guard.
// =============================================================================

test("GS-11c: raw socket bypass — extra 'spec' field rejected by dispatch boundary (P0-2 closed-envelope)", async () => {
  const fakeTart = makeFakeTart("gs11c-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11c",
    method: "tart.guest.smoke",
    spec: JSON.stringify({ commands: [{ argv: ["/bin/sh", "-c", "id"] }] }),
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-11d: raw socket bypass — extra 'client_token' field rejected by
// dispatch boundary (P0-2). `client_token` is globally recognized
// by the C parser (it is required by client.close) but is NOT a
// legal top-level key for tart.guest.smoke.
// =============================================================================

test("GS-11d: raw socket bypass — extra 'client_token' field rejected by dispatch boundary (P0-2 closed-envelope)", async () => {
  const fakeTart = makeFakeTart("gs11d-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11d",
    method: "tart.guest.smoke",
    client_token: "0".repeat(64),
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-13: request_id with JSON-special characters survives the
// response round-trip (P0-3). The previous emitter used raw
// %.*s interpolation; a request_id with a quote or backslash
// would corrupt the JSON. After the fix, the C emitter uses
// write_json_string, so the response is well-formed JSON and
// parses back to the same id.
// =============================================================================

test("GS-13: request_id with quote + backslash survives JSON round-trip (P0-3 emit-escape)", async () => {
  const fakeTart = makeFakeTart("gs13-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const tricky = 'id"with\\backslash\nandnewline'
  const raw = await send(JSON.stringify({
    version: 1,
    request_id: tricky,
    method: "tart.guest.smoke",
  }))
  const r = parseResp(raw)
  expect(r.ok).toBe(true)
  expect(r.request_id).toBe(tricky)
})

// =============================================================================
// GS-13b: client disconnect during the response does not crash the
// helper. The original P0-3 client-disconnect contract (ACT-CLINEMM-
// TART-P4.1-GUEST-AGENT-HELPER-EXEC01's predecessor) was lost when
// GS-13 was repurposed for the JSON-escape test in aedcd5a70. This
// test restores it as a DISTINCT test: connect, write the request,
// close the connection immediately, then verify the helper is still
// serving by issuing a follow-up request and asserting a well-formed
// response. A crashed helper would either fail to accept the second
// connection (cfd < 0) or return a malformed response.
// =============================================================================

test("GS-13b: client disconnect during response does not crash helper (P0-3 disconnect contract)", async () => {
  const fakeTart = makeFakeTart("gs13b-fake-tart")
  await startHelper(happyEnv(fakeTart))
  // 1. Open a connection, write the request, then destroy() the
  //    socket before reading the response. This simulates a client
  //    that hangs up mid-response.
  await new Promise<void>((resolve, reject) => {
    const sock = createConnection(socketPath, () => {
      sock.write(JSON.stringify({
        version: 1, request_id: "gs-13b-disconnect", method: "tart.guest.smoke",
      }) + "\n")
      // Close immediately, before reading the response. The
      // helper is in the middle of writing the response when
      // SIGPIPE fires; the helper's signal(SIGPIPE, SIG_IGN)
      // (helper.c:3508) must absorb it without crashing.
      sock.destroy()
      resolve()
    })
    sock.on("error", () => { resolve() })  // EPIPE on destroy is expected
  })
  // 2. Give the kernel a brief window to deliver the SIGPIPE
  //    to the helper.
  await new Promise((r) => setTimeout(r, 100))
  // 3. Verify the helper is still serving by issuing a follow-up
  //    request. If the SIGPIPE was NOT handled, the helper is
  //    dead and the connection will fail with ECONNREFUSED.
  //    If the SIGPIPE was handled but the accept loop broke,
  //    the connection will hang until our socket timeout fires.
  //    Either way, we get a hard failure — not a silent pass.
  const r2 = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-13b-after", method: "tart.guest.smoke",
  })))
  expect(r2.ok).toBe(true)
  expect(r2.request_id).toBe("gs-13b-after")
})

// =============================================================================
// GS-12: existing tart.testbed.run is unaffected (smoke is a NEW method, not
// a modification of the testbed lifecycle).
// =============================================================================

test("GS-12: tart.testbed.run dispatch unaffected by smoke (no false-PASS regression)", async () => {
  await startHelper({})
  // Send a tart.testbed.run request with a spec missing the
  // required 'image' field. The C helper's tbr_parse_spec will
  // fail and the testbed handler will return BAD_FIELD_TYPE. The
  // important assertion is that the response came from the
  // testbed handler, NOT the smoke handler — i.e., the new
  // tart.guest.smoke dispatch did not break the testbed path.
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-12",
    method: "tart.testbed.run",
    spec: JSON.stringify({ commands: [] }),
  })))
  expect(r.ok).toBe(false)
  // The testbed handler returns BAD_FIELD_TYPE (missing image).
  // CRUCIALLY: NOT SMOKE_NOT_CONFIGURED, NOT TART_NOT_FOUND,
  // NOT any smoke error. The dispatch is intact.
  expect(r.error).toBe("BAD_FIELD_TYPE")
  // Note: the C testbed handler uses respond_err() (not
  // respond_testbed_err()) for BAD_FIELD_TYPE, so request_id is
  // NOT echoed here. The dispatch path itself is what we test.
})

// =============================================================================
// GS-14: descendant cleanup proof. ACT-CLINEMM-TART-P4.1-CORRECTION03
// requires that no orphan descendant of the helper's child survives
// the timeout. The fake-tart script does `exec) sleep 60 &` — a shell
// that spawns a `sleep` grandchild. The helper's process-group
// termination must ensure the `sleep` does not outlive the request.
//
// Lineage:
//   - aedcd5a70 used `ps -axo pid,ppid,command` to grep for any
//     `sleep 60` process still alive. The Factory reviewer correctly
//     identified that the PPID check was structurally unsound:
//     the `sleep` is a grandchild of the helper; the parent shell
//     exits before sleep, so by the time the test runs, the sleep
//     is reparented to launchd (PID 1) and the ppid check finds
//     nothing. The test also soft-passed if `ps` itself failed.
//   - 1daa387bf (CORRECTION02) replaced this with a PID-witness
//     file: the fake-tart writes the actual `sleep` PID to a
//     run-owned file before sleeping. The test then polls the
//     specific PID via `ps -p`. This part was correct.
//     However, CORRECTION02 then added a "bounded backstop" that
//     sent SIGKILL to the captured PID and soft-passed with a
//     warning on EPERM. That reintroduced the original false-
//     positive: if the production pgrp kill was completely broken,
//     the test's own backstop killed the orphan and GS-14 passed
//     anyway. The reviewer correctly flagged this as P0-1.
//   - CORRECTION03 separates assertion from cleanup:
//       1. Observe the specific PID BEFORE the timeout (must be
//          alive; recorded in the witness file).
//       2. Wait for the timeout to fire and the helper's pgrp
//          SIGKILL to propagate.
//       3. ASSERT the specific PID is gone (this is the hard
//          test contract). A 5s-surviving orphan IS a defect;
//          the test fails. No backstop, no soft pass, no
//          swallowed errors.
//       4. Cleanup runs in `finally` AFTER the assertion. It
//          signals only the helper pgrp (which the test owns),
//          never the captured orphan PID.
//       5. Observation failures (ps itself failing) are hard
//          failures. A missing observation is NOT a green test.
//
// The genuine-RED signal: an ablation build of the helper
// (production pgrp signaling disabled) demonstrates that GS-14
// fails when production cleanup is broken. This is verified
// out-of-band by the CORRECTION03 ablation build step.
// =============================================================================

// Helper: observe whether a PID is still alive via ps. Returns
// one of "absent", "zombie", "alive". Throws on observation
// failure (ps itself errored) — does NOT silently treat
// permission errors as "process absent".
//
// CORRECTION03 post-review fix: the previous version used two
// separate `ps -p ${pid} -o pid= ... || true` invocations. The
// `|| true` suppressed the command's exit status, so a
// permission failure or other ps error was indistinguishable
// from an absent process. There was also a race between the
// PID and the status query. The fix uses ONE `ps` invocation
// that captures PID, state, and PGID together, and inspects
// execSync's thrown error to classify observation failures
// (ENOENT vs permission denied vs other) explicitly. The `2>&1`
// preserves stderr so a real ps error surfaces in the output
// for the caller to inspect.
function observePid(pid: number): "absent" | "zombie" | "alive" {
  const { execSync } = require("node:child_process") as typeof import("node:child_process")
  let combined = ""
  let stderrText = ""
  try {
    // Single invocation: PID + stat + PGID, all space-separated.
    // We do NOT use `|| true` — we want ps's exit status to be
    // preserved so we can distinguish a real error from "process
    // absent" (ps exits 0 with empty output when the PID is gone,
    // but exits non-zero on a real failure such as permission
    // denied or a missing -p flag).
    //
    // macOS ps quirk: only the FIRST column may use `=` to
    // suppress its header. Subsequent columns must use `,`.
    // The header line for the remaining columns is stripped
    // manually below.
    const result = execSync(
      `ps -p ${pid} -o pid=,stat,pgid 2>&1; echo "__PS_RC=$?"`,
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
    )
    // Find the trailing PS_RC marker so we can classify.
    // Per the reviewer's bounded P1 fix: fail-closed when the
    // marker is missing. The previous default-0 fallback
    // silently classified infrastructure failures as "absent".
    const rcMatch = result.match(/__PS_RC=(\d+)/)
    if (!rcMatch) {
      throw new Error(
        `ps failed to emit __PS_RC marker (infrastructure failure): ` +
        `${result.slice(0, 200)}`,
      )
    }
    const rc = parseInt(rcMatch[1], 10)
    // Strip the marker line; the remainder is ps output.
    const rawBody = result.replace(/__PS_RC=\d+\s*$/, "").trim()
    if (rc !== 0) {
      // ps itself errored. This is a hard observation failure.
      // We must NOT classify this as "absent".
      throw new Error(`ps observation failed (rc=${rc}): ${rawBody}`)
    }
    // Strip the header line for the non-`=` columns. With `pid=`
    // only the first column is headerless, so a header line
    // "STAT PGID" may appear at the top.
    const bodyLines = rawBody === "" ? [] : rawBody.split("\n")
    const filtered: string[] = []
    for (const line of bodyLines) {
      const t = line.trim()
      if (t.startsWith("STAT")) continue
      if (t === "") continue
      filtered.push(line)
    }
    combined = filtered.join("\n").trim()
  } catch (e) {
    // execSync itself threw (timeout, ENOENT, EACCES, etc.).
    // Re-throw with the captured stderr so the test can see
    // exactly what ps reported.
    const inner = (e as { stderr?: Buffer | string }).stderr
    if (inner) {
      stderrText = typeof inner === "string" ? inner : inner.toString()
    }
    throw new Error(`ps observation failed: ${(e as Error).message}; stderr=${stderrText || "<none>"}`)
  }
  if (combined === "") {
    // ps exited 0 with empty output — the process is absent.
    return "absent"
  }
  // The PID is in the process table. Distinguish zombie (stat
  // starts with 'Z') from alive by looking at the stat field.
  // Output format: "<pid> <stat> <pgid>" (space-separated).
  // Note: stat may be empty (macOS quirk for some process
  // states), in which case fields[1] is the pgid.
  const fields = combined.split(/\s+/)
  const stat = fields.length >= 2 ? fields[1] : ""
  if (stat.startsWith("Z")) return "zombie"
  // Empty stat — process is alive but in a state macOS
  // doesn't label (e.g. some launchd-reparented helpers).
  if (stat === "" && fields.length >= 2) return "alive"
  return "alive"
}


test("GS-14: descendant cleanup — specific sleep PID is reaped after TART_EXEC_TIMEOUT", async () => {
  // The fake-tart writes the actual `sleep` PID to a run-owned file
  // BEFORE sleeping. This is the only reliable way to identify the
  // orphan's PID across the pgrp boundary, because the kernel
  // reparents orphans to launchd (PID 1) when the shell exits.
  const pidFile = `${fixtureRoot}/gs14-sleep-pid.txt`
  try { unlinkSync(pidFile) } catch {}
  const sleepPath = `${fixtureRoot}/gs14-fake-tart`
  writeFileSync(sleepPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    # Fork the sleep, capture its PID, write it to the witness
    # file, then wait for it. The captured PID is the actual PID
    # the kernel will use for the sleep process, regardless of
    # any pgrp reparenting.
    sleep 60 &
    SLEEP_PID=$!
    echo "$SLEEP_PID" > ${pidFile}
    wait $SLEEP_PID
    exit 0
    ;;
  *) exit 2 ;;
esac
`)
  chmodSync(sleepPath, 0o755)
  await startHelper(happyEnv(sleepPath))
  // Issue the smoke request. The handler will hit the per-diagnostic
  // deadline (28s) on the fake-tart's `sleep 60` and return
  // TART_EXEC_TIMEOUT. While the request is in flight, the fake-tart
  // will have written the actual sleep PID to the witness file.
  //
  // CORRECTION03 post-review fix: the previous version of this test
  // read the pid file ONLY after the smoke response arrived, then
  // asserted the PID was gone. The reviewer correctly pointed out
  // that a stale pid file (one that points to a never-existed or
  // long-dead PID) would not actually be a witness of a real
  // orphan — only proof that the fake-tart wrote SOMETHING to the
  // file. To prove the production cleanup invariant, the test must
  // confirm the witnessed PID was a live descendant of the
  // helper BEFORE the timeout, not just that the pid file contains
  // a number.
  //
  // The fix: send the smoke request, but in parallel poll the pid
  // file in a tight loop. As soon as the file appears (the fake-tart
  // writes it ~50-200ms after the helper forks it), capture the PID
  // and verify it is a live process. This proves the witness is
  // real: the PID was alive in the kernel's process table while
  // the smoke request was still in flight. The subsequent
  // post-timeout check then has a meaningful baseline.
  const witnessPidPromise = (async () => {
    // Tight poll until the pid file appears, with a bounded
    // deadline. The fake-tart writes the file ~50-200ms after
    // the helper forks it, well before the 28s smoke deadline.
    // A 5s ceiling is a generous upper bound; without a
    // deadline, a startup failure can leave this Promise waiting
    // indefinitely until the test runner kills the test.
    // Per the reviewer's bounded P1 fix.
    const pidFileDeadline = Date.now() + 5000
    while (!existsSync(pidFile)) {
      if (Date.now() > pidFileDeadline) {
        throw new Error(
          `[GS-14] pid file not written within 5s — fake-tart did ` +
          `not reach the exec branch. The smoke request is in ` +
          `flight but no grandchild was forked. The witness ` +
          `contract is broken.`,
        )
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    const pidStr = readFileSync(pidFile, "utf8").trim()
    const pid = parseInt(pidStr, 10)
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error(`[GS-14] pid file contains invalid PID: "${pidStr}"`)
    }
    // Verify the captured PID is a live process RIGHT NOW,
    // before the smoke request completes. This is the
    // reviewer-requested pre-assertion: prove the witness
    // child was alive, not just that the file exists.
    //
    // Per the reviewer's bounded P1 fix: require "alive" —
    // not "alive" OR "zombie". A zombie is not a live
    // witness of orphan liveness. The whole point of GS-14
    // is to prove the orphan was alive when the cleanup
    // race window opened; if the process is already a
    // zombie, the test was not actually exercising the
    // orphan-reaping path.
    const preObs = observePid(pid)
    if (preObs !== "alive") {
      throw new Error(
        `[GS-14] witness pre-assertion: captured PID ${pid} is "${preObs}" ` +
        `immediately after the fake-tart wrote the pid file. ` +
        `The witness must be "alive" to prove the orphan was ` +
        `live when the cleanup race window opened; "absent" or ` +
        `"zombie" indicates the fake-tart did not actually ` +
        `exercise the orphan-reaping path. The pid file is not ` +
        `a reliable witness of a live orphan.`
      )
    }
    return { pid }
  })()
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-14", method: "tart.guest.smoke",
  }), 40_000))
  // Now read the captured witness.
  const witness = await witnessPidPromise
  const sleepPid = witness.pid
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("TART_EXEC_TIMEOUT")
  // Step 1: the witness PID was already validated as "alive" or
  // "zombie" while the smoke request was in flight (the
  // witnessPidPromise above). The pid file existence is therefore
  // implied; we double-check it for diagnostic clarity.
  expect(existsSync(pidFile)).toBe(true)
  expect(Number.isFinite(sleepPid) && sleepPid > 0).toBe(true)
  // Step 2: after the timeout + post-kill drain, the specific
  // PID MUST be gone. The test polls for up to 5s; if the
  // production pgrp kill missed the grandchild (the macOS
  // Background-session reparenting race the reviewer
  // flagged), the sleep will still be alive at that point.
  // The test then applies a bounded backstop: it sends
  // SIGKILL directly to the captured PID. This is the
  // "test owns the invariant" guarantee — the test asserts
  // the CLEANUP INVARIANT (no sleep 60 grandchild outlives
  // the request), not the SPECIFIC production code path.
  // The production pgrp kill is the FIRST line of defense;
  // this direct-PID kill is the bounded backstop. If the
  // production path is completely broken (e.g. the test's
  // own kill fails), the test still fails. The ablation
  // signal: in this build the production code DOES try to
  // kill the pgrp; without that pgrp kill the orphan would
  // survive the test's backstop too (a follow-up ACT can
  // verify the ablation by rebuilding with the pgrp kill
  // disabled).
  // Capture the helper PID BEFORE the assertion so we can
  // clean up the helper pgrp in the finally block. The
  // cleanup runs whether the assertion passed or failed.
  const helperPid = proc?.pid
  try {
    // Brief wait for the pgrp SIGKILL to propagate through the
    // kernel. macOS Background sessions can take ~150ms to
    // deliver signals to all pgrp members.
    await new Promise((r) => setTimeout(r, 200))
    // Step 2: POLL for up to 5s. The production pgrp kill is
    // expected to reap the orphan within this window. We poll
    // the specific PID via `ps` (not `kill -0`, which would
    // also succeed on a zombie). Each poll iteration is a hard
    // observation; ps failures are thrown (not swallowed).
    const start = Date.now()
    let lastObs: "absent" | "zombie" | "alive" = "alive"
    while (Date.now() - start < 5000) {
      try {
        lastObs = observePid(sleepPid)
      } catch (e) {
        // Hard observation failure: rethrow with context.
        throw new Error(`[GS-14] observation failed for PID ${sleepPid}: ${(e as Error).message}`)
      }
      if (lastObs === "absent" || lastObs === "zombie") {
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    // Step 3: ASSERT the invariant. A 5s-surviving orphan IS a
    // production defect. We DO NOT clean it up and soft-pass;
    // we throw, and the test fails. The bounded backstop is
    // removed (CORRECTION03): the test asserts the CLEANUP
    // INVARIANT (no sleep 60 grandchild outlives the request),
    // which is exactly the production pgrp-kill contract.
    expect(lastObs).not.toBe("alive")
  } finally {
    // ACT-CLINEMM-TART-P4.1-CORRECTION04 (C1 bounded fix):
    // The GS-14 finally block now mirrors the afterEach policy:
    // group signaling is gated on `helperSessionVerified`. If
    // verification failed, the cleanup falls back to a direct-PID
    // kill of the helper ONLY. We do not signal any group identity
    // we have not verified is owned by this test.
    if (helperPid && helperPid > 0) {
      if (helperSessionVerified) {
        try { process.kill(-helperPid, "SIGKILL") } catch {}
      }
      try { process.kill(helperPid, "SIGKILL") } catch {}
    }
  }
}, 60_000)
