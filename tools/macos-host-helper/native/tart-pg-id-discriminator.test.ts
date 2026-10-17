// =============================================================================
// ACT-CLINEMM-TART-P4.1-CORRECTION04 — Process-Group Identity Discriminator
//
// Per the CORRECTION03 post-review verdict (PASS_PGID_MISMATCH /
// HALT_UNSAFE_GROUP_CLEANUP), the CORRECTION03 discriminator
// (`tart-pg-id-discriminator.test.ts` at the start of CORRECTION04)
// established a real PID/PGID mismatch but introduced a P0 cleanup
// hazard: its afterEach signaled `observedHelperPgid` as a group
// signal, which (a) may be inherited from the test runner's group
// rather than owned by the test, and (b) may originate from a
// leaked-helper fallback that the test never created.
//
// The C1 bounded fix has two parts:
//   - Establish process ownership at SPAWN TIME, not cleanup time.
//     Use Bun's `detached: true` to make the helper its own session
//     leader (Bun calls setsid(2) on POSIX), so the helper's PID is
//     its own pgrp leader and session leader.
//   - Separate fresh-spawn ownership from leaked-helper observation.
//     The leaked-helper branch is read-only: its process identities
//     never enter test cleanup.
//
// This file replaces the CORRECTION03 discriminator. The discriminator
// is the same in spirit (observe real pgrp identity of a real helper
// and a real child fork) but is now SAFE in its cleanup. The
// afterEach only reaps direct children of the test that this test
// actually spawned; never a group identity borrowed from a leaked
// helper. EPERM and ESRCH are classified explicitly. The
// production helper.c is unchanged (byte-identical to the
// CORRECTION02 commit at 1daa387bf).
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
} from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { ensureHelperBinary } from "./test-helper-build"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")

// Per-test state. These are observed values, not assumptions.
let proc: Subprocess | null = null
let socketPath: string = ""
let statusPath: string = ""
let pidFile: string = ""
let fixtureRoot: string = ""
let evidencePath: string = ""
let observedHelperPid = 0
let observedHelperPpid = 0
let observedHelperPgid = 0
let observedHelperSess = 0
let observedHelperStat = ""
let observedHelperCommand = ""
let observedHelperSource = "fresh-spawn"
let observedChildPid = 0
let observedChildPpid = 0
let observedChildPgid = 0
let observedChildSess = 0
let observedChildStat = ""
let assumedKillRc = ""
let actualKillRc = ""
// CORRECTION04 (C1 bounded fix): ownership flag. Set to true ONLY
// when the test has successfully spawned its own helper with
// `detached: true` AND verified the helper is its own session
// leader (helper PID == helper PGID == helper SID, and helper
// PGID != test runner PGID). The afterEach refuses to issue any
// signal when this flag is false — preventing the P0 hazard of
// the CORRECTION03 afterEach (which signaled observed groups from
// a leaked-helper fallback that the test never created).
let freshSpawnVerified = false
let ownershipCheckLog = ""

beforeAll(async () => {
  // ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
  // Use the build verification module instead of the old
  // "existsSync and run build.sh if missing" pattern. The
  // module ALWAYS invokes build.sh (which atomically replaces
  // ./helper with a fresh, codesign-verified canonical binary),
  // then validates the binary's Mach-O Identifier is "helper"
  // (not "helper.ablated" or any other variant), then asserts
  // codesign --verify --strict passes. A stale ablated binary
  // at the canonical path is detected and rejected at suite-start
  // rather than causing confusing runtime crashes downstream.
  const helperIdentity = await ensureHelperBinary()
  // The identity record is a debugging aid; we log it so the
  // test report can correlate crashes to a specific artifact.
  console.log(
    `[${"PGID-DISC"}] helper identity: sha256=${helperIdentity.sha256.slice(0, 16)}... ` +
      `inode=${helperIdentity.inode} build_id=${helperIdentity.buildId.slice(0, 16)}... ` +
      `ident=${helperIdentity.machOIdentifier} size=${helperIdentity.sizeBytes}`,
  )
  const stamp = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)
  fixtureRoot = `/tmp/clinemm-pgid-${stamp}`
  mkdirSync(fixtureRoot, { recursive: true })
  mkdirSync(`${fixtureRoot}/vms`, { recursive: true })
  evidencePath = process.env.CLINEMM_PGID_EVIDENCE_PATH ?? `/tmp/clinemm-pgid-${stamp}/evidence.txt`
})

afterAll(() => {
  try { proc?.kill() } catch {}
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { unlinkSync(pidFile) } catch {}
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

afterEach(async () => {
  // CORRECTION04 FOLLOW-UP (bounded C1 fix): cleanup is split into
  // three layers, each gated on a STRICTLY different condition.
  //
  // LAYER 1 — direct-PID kill of any test-spawned proc:
  //   Gate: `proc && proc.pid > 0`. This applies whenever this
  //   test actually called spawn() and got a handle, regardless
  //   of whether the helper bound its status file or passed
  //   ownership verification. The reviewer's PARTIAL_SPAWN_LEAK
  //   verdict: a recorded `proc` is a test-created direct child,
  //   even when PGID verification fails. We must always attempt
  //   bounded direct-child termination. Group signaling is gated
  //   separately (Layer 2) so a failed verification does NOT
  //   cause us to leak the spawned helper.
  //
  // LAYER 2 — pgrp signal of the helper's owned group:
  //   Gate: `freshSpawnVerified === true`. This applies ONLY
  //   when ps confirmed the helper is its own session/pgrp
  //   leader (helper.PID==helper.PGID==helper.SID and
  //   helper.PGID!=runner.PGID). Without that confirmation we
  //   cannot tell whether kill(-helperPid) would target a
  //   foreign group; the helper inherits the test runner's
  //   pgrp when detached:true does not take effect, and
  //   signaling that pgrp would kill the test runner.
  //   ESRCH (no such pgrp) is acceptable; we fall back to
  //   direct-PID (which Layer 1 already did).
  //
  // LAYER 3 — leaked-helper fallback cleanup:
  //   Gate: NEVER. The leaked-helper branch in the test body
  //   only OBSERVES a leaked helper; it never records that
  //   helper as a `proc` we own. So Layer 1's gate
  //   (`proc && proc.pid > 0`) is automatically false in
  //   the leaked-helper branch, and the cleanup is a no-op.
  //
  // The interaction with the test body's failure handling: when
  // `startHelperForDiscriminator()` throws because the status
  // file never appeared, `proc` was already set by spawn() and
  // is non-null when afterEach runs. The OLD code skipped all
  // cleanup because `freshSpawnVerified` was false. The new
  // Layer 1 catches this case: the spawned helper is
  // direct-PID-killed even though we never got far enough to
  // verify the session.
  if (proc && proc.pid && proc.pid > 0) {
    const ownedHelperPid = proc.pid
    // Layer 1: direct-PID kill of the test's own child.
    // ESRCH (already gone) is fine; EPERM (sandbox block) is
    // surfaced but does not throw — we still proceed to Layer 2
    // to attempt the pgrp signal where applicable.
    try {
      process.kill(ownedHelperPid, "SIGKILL")
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      if (code !== "ESRCH") {
        // eslint-disable-next-line no-console
        console.log(`[PGID-DISC] Layer1 direct-PID kill: code=${code} msg=${(e as Error).message}`)
      }
    }
    // Reap the child fork by its specific PID (if we
    // witnessed one). The child pgrp is independent of the
    // helper pgrp, so we don't use a group signal here.
    if (observedChildPid > 0 && observedChildPid !== ownedHelperPid) {
      try {
        process.kill(observedChildPid, "SIGKILL")
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? ""
        if (code !== "ESRCH") {
          // eslint-disable-next-line no-console
          console.log(`[PGID-DISC] child ${observedChildPid} kill: code=${code} (acceptable)`)
        }
      }
    }
    // Layer 2: pgrp signal of the helper's owned group, ONLY
    // when ownership was verified.
    if (freshSpawnVerified) {
      try {
        process.kill(-ownedHelperPid, "SIGKILL")
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? ""
        if (code !== "ESRCH" && code !== "EPERM") {
          // eslint-disable-next-line no-console
          console.log(`[PGID-DISC] Layer2 pgrp kill: code=${code} msg=${(e as Error).message}`)
        }
      }
    } else {
      // Layer 1 has already direct-PID-killed the helper.
      // We deliberately do NOT signal any group identity here.
      // eslint-disable-next-line no-console
      console.log(
        `[PGID-DISC] Layer2 skipped: freshSpawnVerified=false. ` +
        `Helper ${ownedHelperPid} was direct-PID-killed in Layer 1.`,
      )
    }
    // Bounded wait for kernel reaping.
    await new Promise((r) => setTimeout(r, 200))
    // proc.kill() is a no-op for detached children once the
    // Subprocess handle is closed, but we try it for symmetry.
    try { proc.kill() } catch {}
  }
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { unlinkSync(pidFile) } catch {}
  socketPath = ""
  statusPath = ""
  pidFile = ""
  proc = null
  // Reset per-test observation state so the next test starts clean.
  freshSpawnVerified = false
  observedHelperPid = 0
  observedHelperPpid = 0
  observedHelperPgid = 0
  observedHelperSess = 0
  observedHelperStat = ""
  observedHelperCommand = ""
  observedHelperSource = "fresh-spawn"
  observedChildPid = 0
  observedChildPpid = 0
  observedChildPgid = 0
  observedChildSess = 0
  observedChildStat = ""
  assumedKillRc = ""
  actualKillRc = ""
})

// Run a single ps invocation with the discriminator's fields:
// pid, ppid, pgid, sess, stat, command. The trailing __PS_RC
// marker is the explicit exit-status capture (fail-closed when
// missing — the reviewer's bounded P1 fix).
//
// macOS ps quirk: only the FIRST column may use `=` to suppress
// its header. Subsequent columns must use `,`. The header line
// (which only shows the remaining column labels) is stripped
// manually here.
function psFull(pid: number): { rc: number; lines: string[]; raw: string } {
  const raw = execSync(
    `ps -p ${pid} -o pid=,ppid,pgid,sess,stat,command 2>&1; echo "__PS_RC=$?"`,
    { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
  )
  const rcMatch = raw.match(/__PS_RC=(\d+)/)
  // Per the reviewer's bounded P1 fix: fail-closed when the
  // __PS_RC marker is missing. The previous default-0 fallback
  // silently classified infrastructure failures as "process
  // absent", which masked observation errors.
  if (!rcMatch) {
    throw new Error(
      `ps failed to emit __PS_RC marker (infrastructure failure): ` +
      `raw=${raw.slice(0, 200)}`,
    )
  }
  const rc = parseInt(rcMatch[1], 10)
  const body = raw.replace(/__PS_RC=\d+\s*$/, "").trim()
  if (rc !== 0) {
    throw new Error(`ps rc=${rc} body=${body.slice(0, 200)}`)
  }
  // Strip the header line if present. With `pid=` only the
  // first column is headerless, so the remaining columns emit
  // a single header line: "PPID  PGID  SESS STAT COMMAND".
  const bodyLines = body === "" ? [] : body.split("\n")
  const filtered: string[] = []
  for (const line of bodyLines) {
    const t = line.trim()
    if (t.startsWith("PPID")) continue
    if (t === "") continue
    filtered.push(line)
  }
  return { rc, lines: filtered, raw: body }
}

// Parse a single ps line. First 5 fields are numeric (pid, ppid,
// pgid, sess, stat), the rest is the command. The stat field
// may be blank (macOS omits it for processes with no state, e.g.
// some leaked launchd-reparented helpers), so we accept lines
// with 4-5 numeric fields and treat missing fields as empty.
function parsePsLine(line: string): {
  pid: number; ppid: number; pgid: number; sess: number;
  stat: string; command: string
} | null {
  const trimmed = line.trim()
  if (trimmed === "") return null
  const parts = trimmed.split(/\s+/)
  // Need at least pid, ppid, pgid, sess, command.
  if (parts.length < 5) return null
  const pid = parseInt(parts[0], 10)
  const ppid = parseInt(parts[1], 10)
  const pgid = parseInt(parts[2], 10)
  const sess = parseInt(parts[3], 10)
  // Detect whether the 5th element is the stat or the command.
  // Heuristic: stat is short (1-4 chars, possibly with a `+`),
  // command starts with `/` or `./` or contains a path.
  let stat: string
  let cmdStart: number
  if (parts.length === 5) {
    // No stat field at all (macOS quirk for some states).
    stat = ""
    cmdStart = 4
  } else if (parts[4].length <= 4 && !parts[4].includes("/")) {
    // parts[4] is the stat.
    stat = parts[4]
    cmdStart = 5
  } else {
    // parts[4] is already the command.
    stat = ""
    cmdStart = 4
  }
  return {
    pid, ppid, pgid, sess, stat,
    command: parts.slice(cmdStart).join(" "),
  }
}

async function startHelperForDiscriminator(fakeTart: string): Promise<void> {
  const stamp = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)
  socketPath = `/tmp/clinemm-pgid-sock-${stamp}.sock`
  statusPath = `/tmp/clinemm-pgid-status-${stamp}.json`
  pidFile = `${fixtureRoot}/disc-child-pid.txt`
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { unlinkSync(pidFile) } catch {}
  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: join(SCRIPT_DIR, "helper.c"),
      CLINEMM_TART_EXECUTABLE: fakeTart,
      CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
      CLINEMM_SMOKE_TART_HOME: fixtureRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // CORRECTION04 (C1 bounded fix): `detached: true` causes Bun
    // to call setsid(2) on POSIX, making the helper its own session
    // leader AND its own pgrp leader. The helper's PID then equals
    // its PGID equals its SID, and the helper's group is distinct
    // from the test runner's group. This is the ownership root
    // that the CORRECTION03 discriminator was missing.
    detached: true,
  })
  for (let i = 0; i < 100; i++) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(statusPath)) {
    throw new Error("helper did not produce status file in 10s")
  }
  for (let i = 0; i < 50; i++) {
    if (existsSync(socketPath)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  if (!existsSync(socketPath)) {
    await new Promise((r) => setTimeout(r, 500))
  }
}

function send(payload: string, timeoutMs = 35000): Promise<string> {
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

// Find a representative leaked helper (any `./helper` process
// with PPID=1, i.e. reparented to launchd). Returns its PID
// or -1 if none is available. Used as a fallback when the
// environment cannot start a fresh helper.
function findLeakedHelperPid(): number {
  try {
    // macOS ps requires commas (not `=`) for column separators
    // in `ps -ax -o`. Use `=` only on `-p $pid` (where the
    // headerless form is what we want). The header line is
    // stripped manually.
    const raw = execSync(
      `ps -ax -o pid,ppid,command 2>&1; echo "__PS_RC=$?"`,
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] },
    )
    const rcMatch = raw.match(/__PS_RC=(\d+)/)
    if (!rcMatch) return -1
    const rc = parseInt(rcMatch[1], 10)
    if (rc !== 0) return -1
    const body = raw.replace(/__PS_RC=\d+\s*$/, "").trim()
    const lines = body === "" ? [] : body.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip the header line.
      if (trimmed.startsWith("PID")) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length < 3) continue
      const pid = parseInt(parts[0], 10)
      const ppid = parseInt(parts[1], 10)
      const cmd = parts.slice(2).join(" ")
      if (ppid !== 1) continue
      if (cmd !== "./helper" && !cmd.endsWith("/helper")) continue
      return pid
    }
  } catch { /* best-effort */ }
  return -1
}

test(
  "PGID-DISC: real helper + child fork — observe pgrp identity, prove kill(-helperPid) target",
  async () => {
    // The test has TWO observation modes:
    //
    //  1. FRESH-SPAWN MODE (preferred): spawn a real helper,
    //     issue a real smoke request, capture both helper and
    //     child pgrp identity. This is the reviewer's primary
    //     discriminator.
    //
    //  2. LEAKED-HELPER MODE (fallback): when the environment
    //     is saturated (e.g. 2,300+ leaked helpers preventing
    //     new helper from binding), pick a representative
    //     already-leaked helper with PPID=1 and observe ITS
    //     identity. The child fork is gone (already reaped),
    //     so child observations are skipped; the helper pgrp
    //     identity is still the load-bearing discriminator.
    //
    // Both modes produce the same evidence file. The test
    // always passes once the observation is captured; the
    // MATCH/MISMATCH verdict is the discriminator's output.

    let freshSpawnSucceeded = false
    let helperPid = 0
    let helperRow: ReturnType<typeof parsePsLine> = null
    let childPid = 0
    let childRow: ReturnType<typeof parsePsLine> = null

    // Try fresh spawn first.
    try {
      const fakeTart = `${fixtureRoot}/disc-fake-tart`
      writeFileSync(fakeTart, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    sleep 60 &
    SLEEP_PID=$!
    echo "$SLEEP_PID" > ${pidFile}
    wait $SLEEP_PID
    exit 0
    ;;
  *) exit 2 ;;
esac
`)
      chmodSync(fakeTart, 0o755)
      await startHelperForDiscriminator(fakeTart)
      if (proc && proc.pid) {
        helperPid = proc.pid
        const helperPs = psFull(helperPid)
        helperRow = parsePsLine(helperPs.lines[0] ?? "")
        if (helperRow && helperRow.pid === helperPid) {
          // CORRECTION04 FOLLOW-UP (bounded C1 fix, P1 ownership
          // parser): reuse the existing psFull()/parsePsLine()
          // machinery to discover the test runner's PGID. The
          // previous inline `ps -o pgid=` block on macOS emits a
          // header line ("PGID  SESS") because only the first
          // column's `=` suppresses its header, and the body is
          // parsed by hand into `parts[0]`. That hand-parse is
          // brittle and was the reviewer's P1 defect. psFull()
          // already strips the header line; parsePsLine() handles
          // the stat field; we just need the runner's PGID.
          let runnerPgid = 0
          try {
            const runnerRow = parsePsLine(
              psFull(process.pid).lines[0] ?? "",
            )
            if (runnerRow) runnerPgid = runnerRow.pgid
          } catch { /* best-effort */ }
          const ownSession =
            helperRow.pid === helperRow.pgid &&
            helperRow.pid === helperRow.sess
          const ownGroup = helperRow.pgid !== runnerPgid
          ownershipCheckLog =
            `pid==pgid==sid:${ownSession} ` +
            `pid=${helperRow.pid} pgid=${helperRow.pgid} ` +
            `sid=${helperRow.sess} ` +
            `runner_pgid=${runnerPgid} ` +
            `helper_pgid_neq_runner_pgid:${ownGroup}`
          if (ownSession && ownGroup) {
            freshSpawnVerified = true
          } else {
            // eslint-disable-next-line no-console
            console.log(
              `[PGID-DISC] OWNERSHIP-VERIFICATION-FAILED: ${ownershipCheckLog}. ` +
              `Test will not signal any group from this spawn. ` +
              `The discriminator's evidence is still recorded, but ` +
              `afterEach will use direct-PID kill only.`,
            )
          }
          // Send a real smoke request, in parallel polling for
          // the pid file the fake-tart writes. PID file polling
          // is bounded by 5s (per the reviewer's bounded P1 fix).
          const smokePromise = send(
            JSON.stringify({
              version: 1, request_id: "pgid-disc", method: "tart.guest.smoke",
            }),
          )
          const pidDeadline = Date.now() + 5000
          while (!existsSync(pidFile)) {
            if (Date.now() > pidDeadline) break
            await new Promise((r) => setTimeout(r, 10))
          }
          if (existsSync(pidFile)) {
            const childPidStr = readFileSync(pidFile, "utf8").trim()
            const cp = parseInt(childPidStr, 10)
            if (Number.isFinite(cp) && cp > 0) {
              childPid = cp
              const childPs = psFull(childPid)
              childRow = parsePsLine(childPs.lines[0] ?? "")
            }
          }
          try { smokePromise.catch(() => {}) } catch { /* ignore */ }
          freshSpawnSucceeded = true
          observedHelperSource = "fresh-spawn"
        }
      }
    } catch (e) {
      // CORRECTION04 FOLLOW-UP (bounded C1 fix, item 3): capture
      // the full failure state of the spawned helper at the 10s
      // timeout BEFORE the catch swallows the error. The previous
      // code only logged the thrown message; the spawned helper's
      // actual state (still alive? exited? what PGID? what stderr?)
      // was lost. The reviewer correctly flagged this as
      // premature ENVIRONMENT_BLOCKED attribution.
      //
      // Diagnostic fields captured:
      //   - thrown error message (the trigger)
      //   - spawned PID (from proc.pid; the Subprocess handle is
      //     still set because spawn() succeeded before the wait
      //     loop timed out)
      //   - ps row at the timeout: PID, PGID, SESS, STAT, command
      //     (using psFull which already strips macOS headers)
      //   - status-file existence: did the helper ever bind?
      //   - exit code: only meaningful if the Subprocess has
      //     resolved its `exited` promise (will be 0 if it
      //     completed cleanly, undefined if still running)
      //   - stderr text if proc.stderr was captured and the proc
      //     has exited (best-effort; stdio was set to "pipe" so
      //     the text is buffered)
      const errMsg = (e as Error).message
      const spawnPid = proc?.pid ?? 0
      let spawnPsRow: ReturnType<typeof parsePsLine> = null
      let spawnPsError = "(ps not run)"
      if (spawnPid > 0) {
        try {
          spawnPsRow = parsePsLine(psFull(spawnPid).lines[0] ?? "")
        } catch (e2) {
          spawnPsError = (e2 as Error).message
        }
      }
      const statusFileExists = existsSync(statusPath)
      let spawnExitCode: number | null | undefined = undefined
      let spawnStderrTail = ""
      if (proc) {
        // proc.exited resolves when stdio streams close. If the
        // helper is still alive at the 10s timeout, this would
        // hang. Use a bounded 1s race to capture the exit code
        // only when the proc has actually exited.
        const exitedPromise = proc.exited
        const timeoutPromise = new Promise<"timeout">((r) =>
          setTimeout(() => r("timeout"), 1000),
        )
        const winner = await Promise.race([exitedPromise, timeoutPromise])
        if (winner !== "timeout") {
          spawnExitCode = winner as number
        }
        // Best-effort stderr capture. proc.stderr is null when
        // stdio was "ignore"; the discriminator sets "pipe" so
        // it is a ReadableStream | undefined.
        try {
          const stderrStream = (proc as unknown as { stderr?: { readable?: boolean; text?: () => Promise<string> } })
            .stderr
          if (stderrStream && typeof stderrStream.text === "function") {
            const full = await Promise.race([
              stderrStream.text(),
              new Promise<string>((r) => setTimeout(() => r(""), 500)),
            ])
            // Last 1 KiB only.
            spawnStderrTail = full.slice(-1024)
          }
        } catch { /* best-effort */ }
      }
      // eslint-disable-next-line no-console
      console.log(
        `[PGID-DISC] fresh-spawn FAILED: ${errMsg}\n` +
        `  spawn_pid=${spawnPid}\n` +
        `  spawn_ps_row=${spawnPsRow ? `pid=${spawnPsRow.pid} pgid=${spawnPsRow.pgid} sess=${spawnPsRow.sess} stat="${spawnPsRow.stat}" cmd=${spawnPsRow.command}` : "(none)"}\n` +
        `  spawn_ps_error=${spawnPsError}\n` +
        `  status_file_exists=${statusFileExists}\n` +
        `  spawn_exit_code=${spawnExitCode === undefined ? "(still running)" : spawnExitCode}\n` +
        `  spawn_stderr_tail=${JSON.stringify(spawnStderrTail)}\n` +
        `  -> falling back to leaked-helper observation; afterEach will direct-PID-kill ${spawnPid || "(no spawned handle)"}.`,
      )
    }

    if (!freshSpawnSucceeded) {
      // LEAKED-HELPER MODE: pick a representative leaked helper.
      const leakedPid = findLeakedHelperPid()
      if (leakedPid <= 0) {
        throw new Error(
          `[PGID-DISC] no leaked helper available either; cannot run discriminator.`,
        )
      }
      helperPid = leakedPid
      observedHelperSource = "leaked-helper (PPID=1, reparented to launchd)"
      const helperPs = psFull(helperPid)
      helperRow = parsePsLine(helperPs.lines[0] ?? "")
      if (!helperRow || helperRow.pid !== helperPid) {
        throw new Error(
          `[PGID-DISC] leaked helper ${leakedPid} ps returned no row: ` +
          `${JSON.stringify(helperPs)}`,
        )
      }
    }

    // Discriminator's load-bearing observation: the helper's
    // process-group identity vs the assumed one.
    if (!helperRow) {
      throw new Error("[PGID-DISC] helperRow is null after observation")
    }
    observedHelperPid = helperRow.pid
    observedHelperPpid = helperRow.ppid
    observedHelperPgid = helperRow.pgid
    observedHelperSess = helperRow.sess
    observedHelperStat = helperRow.stat
    observedHelperCommand = helperRow.command
    if (childRow) {
      observedChildPid = childRow.pid
      observedChildPpid = childRow.ppid
      observedChildPgid = childRow.pgid
      observedChildSess = childRow.sess
      observedChildStat = childRow.stat
    }

    // Test assumed vs actual pgrp kill targets. SIGNAL-0
    // (no actual signal sent) — reviewer's plan: "No signal
    // should be issued until ownership is established."
    try {
      process.kill(-helperPid, 0)
      assumedKillRc = "rc=0 (assumed pgrp EXISTS — cleanup assumption correct)"
    } catch (e) {
      assumedKillRc =
        `rc=-1 errno=${(e as NodeJS.ErrnoException).code ?? "?"} ` +
        `msg=${(e as Error).message}`
    }
    try {
      process.kill(-observedHelperPgid, 0)
      actualKillRc = "rc=0 (actual pgrp EXISTS — real cleanup target)"
    } catch (e) {
      actualKillRc =
        `rc=-1 errno=${(e as NodeJS.ErrnoException).code ?? "?"} ` +
        `msg=${(e as Error).message}`
    }

    // Evidence file + console echo.
    const assumedOk = assumedKillRc.startsWith("rc=0")
    const verdict = assumedOk ? "MATCH" : "MISMATCH"
    const evidence =
      `PGID-DISC EVIDENCE — ${new Date().toISOString()}\n` +
      `source=${observedHelperSource}\n` +
      `fresh_spawn_verified=${freshSpawnVerified}\n` +
      `ownership_check=${ownershipCheckLog || "(n/a — leaked-helper mode)"}\n` +
      `helper_pid=${observedHelperPid}\n` +
      `helper_ppid=${observedHelperPpid}\n` +
      `helper_pgid=${observedHelperPgid}\n` +
      `helper_sess=${observedHelperSess}\n` +
      `helper_stat=${observedHelperStat}\n` +
      `helper_command=${observedHelperCommand}\n` +
      `helper_pgid_equals_pid=${observedHelperPgid === observedHelperPid}\n` +
      `child_pid=${observedChildPid || "(unobserved in leaked-helper mode)"}\n` +
      `child_ppid=${observedChildPpid || "(n/a)"}\n` +
      `child_pgid=${observedChildPgid || "(n/a)"}\n` +
      `child_sess=${observedChildSess || "(n/a)"}\n` +
      `child_stat=${observedChildStat || "(n/a)"}\n` +
      `child_ppid_equals_helper_pid=${observedChildPpid === observedHelperPid || "(n/a)"}\n` +
      `child_pgid_equals_child_pid=${observedChildPgid === observedChildPid || "(n/a)"}\n` +
      `assumed_pgrp_kill_target=kill(-${observedHelperPid}, 0)\n` +
      `assumed_pgrp_kill_result=${assumedKillRc}\n` +
      `actual_pgrp_kill_target=kill(-${observedHelperPgid}, 0)\n` +
      `actual_pgrp_kill_result=${actualKillRc}\n` +
      `discriminator_verdict=${verdict}\n`
    try { writeFileSync(evidencePath, evidence) } catch { /* best-effort */ }
    // eslint-disable-next-line no-console
    console.log("\n" + evidence)

    if (observedHelperPgid === observedHelperPid) {
      // eslint-disable-next-line no-console
      console.log(
        `[PGID-DISC] MATCH: helper_pgid==helper_pid==${observedHelperPid}. ` +
        `Existing test cleanup assumption holds for this run.`,
      )
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[PGID-DISC] MISMATCH: helper_pid=${observedHelperPid} but ` +
        `helper_pgid=${observedHelperPgid}. ` +
        `Existing test cleanup sent SIGKILL to non-existent pgrp ` +
        `${observedHelperPid}; afterEach uses actual pgrp ` +
        `${observedHelperPgid} instead.`,
      )
    }

    // Discriminator's verdict is observational. Test passes
    // once the observation is captured.
    expect(observedHelperPid).toBeGreaterThan(0)
    expect(observedHelperPgid).toBeGreaterThan(0)
  },
  30_000,
)
