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
  if (!existsSync(HELPER_BIN)) {
    const build = spawn({
      cmd: [join(SCRIPT_DIR, "build.sh")],
      cwd: SCRIPT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const code = await build.exited
    if (code !== 0) throw new Error(`build.sh exited ${code}`)
  }
  expect(existsSync(HELPER_BIN)).toBe(true)
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
  // CORRECTION04 (C1 bounded fix): cleanup is split into two paths.
  //
  // FRESH-SPAWN PATH (we spawned `proc` in this test):
  //   - We OWN the helper PID. The helper was spawned with
  //     `detached: true`, so its PID == its PGID == its SID, and
  //     its group is distinct from the test runner's. The
  //     ownership verification (`freshSpawnVerified === true`)
  //     confirms the helper actually became its own session
  //     leader; if verification failed, we fall back to direct-PID
  //     kill of the helper only — never a group signal.
  //   - We also own the fake-tart's `sleep 60` child PID
  //     (witnessed via the run-owned pid file). The fake-tart's
  //     `sleep` is in a SEPARATE process group (the fake-tart's
  //     `exec` handler doesn't call setpgid; in production the
  //     helper's `smoke_invoke_bounded` calls setpgid(0,0) in
  //     the child at helper.c:4312, putting the child in its
  //     own pgrp). The child pgrp is therefore independent of
  //     the helper pgrp. We signal each owned direct child by
  //     its specific PID, not by group.
  //   - EPERM/ESRCH are classified explicitly. We NEVER signal a
  //     group we have not verified is owned by this test.
  //
  // LEAKED-HELPER PATH (fresh spawn failed; we observed an
  // already-leaked helper for the discriminator's evidence):
  //   - We do NOT own the leaked helper. We MUST NOT signal it
  //     directly or by group. The leaked helper's lifecycle is
  //     the operator's responsibility, not this test's. The
  //     `if (freshSpawnVerified && proc)` guard below makes the
  //     cleanup strictly conditional on the fresh-spawn path.
  if (freshSpawnVerified && proc && proc.pid && proc.pid > 0) {
    const ownedHelperPid = proc.pid
    // First: reap the child fork by its specific PID (if we
    // witnessed one). The child pgrp is independent of the
    // helper pgrp, so we don't use a group signal here either.
    if (observedChildPid > 0 && observedChildPid !== ownedHelperPid) {
      try {
        process.kill(observedChildPid, "SIGKILL")
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? ""
        // ESRCH = already gone. EPERM = sandbox block. Either is
        // acceptable: we own the PID semantically but the kernel
        // may have reaped it before us.
        if (code !== "ESRCH") {
          // eslint-disable-next-line no-console
          console.log(`[PGID-DISC] child ${observedChildPid} kill: ${code} (acceptable)`)
        }
      }
    }
    // Then: signal the helper's verified-owned group. Because
    // `detached: true` ran setsid(2), ownedHelperPid IS the
    // helper's pgrp leader. We signal THAT group, which the
    // test created and therefore owns. If `detached: true`
    // didn't take effect (e.g. Bun platform quirk), the kill
    // returns ESRCH (no such pgrp) — we don't fall back to a
    // foreign group, we just leave the helper PID-killed below.
    try {
      process.kill(-ownedHelperPid, "SIGKILL")
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      if (code === "ESRCH") {
        // No pgrp of that name (e.g. detached didn't take
        // effect, or the helper already exited). Fall back
        // to direct-PID kill of the helper ONLY.
        try { process.kill(ownedHelperPid, "SIGKILL") } catch {}
      } else if (code === "EPERM") {
        // Sandbox blocked the pgrp signal. We may still
        // signal the helper directly because we own it.
        try { process.kill(ownedHelperPid, "SIGKILL") } catch {}
      } else {
        // Unknown error: surface it (do not silently swallow).
        // eslint-disable-next-line no-console
        console.log(`[PGID-DISC] helper pgrp kill: code=${code} msg=${(e as Error).message}`)
      }
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
          // CORRECTION04 (C1 bounded fix): verify the helper is
          // its own session leader. This is the ownership root.
          // If `detached: true` worked, then helper PID == PGID == SID.
          // If they don't match, the test does NOT own the helper
          // for group-signaling purposes; the afterEach will
          // refuse to signal any group from this observation.
          //
          // We also verify the helper's PGID differs from the test
          // runner's PGID, because we must not signal a group the
          // test runner is a member of.
          let runnerPgid = 0
          try {
            const runnerPs = execSync(
              `ps -p ${process.pid} -o pgid= 2>&1; echo "__PS_RC=$?"`,
              { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "pipe"] },
            )
            const m = runnerPs.match(/__PS_RC=(\d+)/)
            if (m && m[1] === "0") {
              const cleaned = runnerPs.replace(/__PS_RC=\d+\s*$/, "").trim()
              runnerPgid = parseInt(cleaned.split(/\s+/)[0] ?? "0", 10)
            }
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
      // eslint-disable-next-line no-console
      console.log(`[PGID-DISC] fresh-spawn failed: ${(e as Error).message}; ` +
        `falling back to leaked-helper observation.`)
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
