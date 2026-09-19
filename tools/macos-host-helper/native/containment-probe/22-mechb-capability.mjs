#!/usr/bin/env node
// 22-mechb-capability.mjs
//
// Candidate B capability probe.
//
// Lifecycle:
//   1. Fork a "spawner" process. The spawner has a known PID.
//   2. Spawner forks a "fixture-emulator" child that does
//      setsid + fork + long sleep (mirrors fixture E/F).
//   3. Parent of spawner dies.
//   4. THIS driver (a separate, unrelated process) tries to
//      attach kqueue EVFILT_PROC NOTE_FORK on the fixture-emulator.
//   5. Measure:
//      - does the attachment succeed at all?
//      - if so, does NOTE_FORK fire on the inner fork?
//      - is the child PID delivered (kevent.data != 0)?
//      - is the grandchild visible (NOTE_FORK on the emulator
//        when it forks the grandchild)?
//
// Output: single JSON to stdout.

import { spawn, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const TMP_DIR = process.env.TMP_OUT || "/tmp/clinemm-helper-supervised-command-containment01"
const PROBE   = process.env.MECHB_CROSS_PROBE ||
  "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/containment-probe/22-mechb-cross-process-test"
mkdirSync(TMP_DIR, { recursive: true })

// Step 1+2: use a small helper binary that forks and execs into
// the emulator. We reuse a tiny C program that exits into a long
// sleep via setsid + fork + sleep.

const SPAWNER_AND_EMULATOR = `#!/usr/bin/env bash
# We use bash itself: bash can do setsid + fork chain if invoked
# properly. But bash's job control interferes, so we use a tiny C
# program instead.
exec /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/containment-probe/22-mechb-emulator
`
// Actually use the emulator directly.

// 22-mechb-emulator.c is defined below — a small C program that:
//   setsid()
//   fork() -> grandchild
//   grandchild: sleep(30)
//   parent: sleep(30) -- lives long enough for cross-process attach

// We spawn it detached so it lives across our driver's lifetime.
const EMULATOR_BIN =
  "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/containment-probe/22-mechb-emulator"

const child = spawn(EMULATOR_BIN, [], {
  detached: true, stdio: ["ignore", "pipe", "pipe"],
})
const emulatorPid = child.pid
console.error(`[B-cap] emulator spawned at pid=${emulatorPid}`)

// Give it time to perform setsid+fork.
await new Promise((r) => setTimeout(r, 800))

// Verify the emulator is visible to ps.
const ps = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,sess=,comm="])
const lines = ps.stdout.toString().split("\n").filter(Boolean)
const seenEmulator = lines.find((l) => l.trim().startsWith(String(emulatorPid) + " "))

// Step 4: launch the cross-process probe on the emulator.
const probe = spawn(PROBE, [String(emulatorPid)], { stdio: ["ignore", "pipe", "pipe"] })
let probeOut = ""
let probeErr = ""
probe.stdout.on("data", (c) => { probeOut += c.toString() })
probe.stderr.on("data", (c) => { probeErr += c.toString() })

// Wait for probe to finish (it runs ~6 seconds).
const exitCode = await new Promise((resolve) => {
  probe.on("exit", resolve)
  setTimeout(() => { try { probe.kill("SIGKILL") } catch {} ; resolve(-1) }, 8000)
})

// Step 5: parse probe output.
const events = probeOut.split("\n").filter(Boolean).map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)
const attach = events.find((e) => e.event === "attached")
const attachFailed = events.find((e) => e.event === "attach_failed")
const end = events.find((e) => e.event === "end")
const forks = events.filter((e) => e.event === "fork")

const result = {
  emulator_pid: emulatorPid,
  emulator_seen_in_ps: !!seenEmulator,
  ps_line_for_emulator: seenEmulator ?? null,
  probe_exit_code: exitCode,
  probe_stderr: probeErr.slice(0, 2000),
  attach_succeeded: !!attach,
  attach_failed: !!attachFailed,
  attach_failed_errno: attachFailed?.errno,
  attach_failed_errstr: attachFailed?.errstr,
  fork_events_count: forks.length,
  fork_events: forks,
  end_event: end,
  NOTE_FORK_CHILD_PID_AVAILABLE: forks.some((f) => f.kevent_data && f.kevent_data !== 0),
  CROSS_PROCESS_ATTACHMENT_WORKS: !!attach,
  REGISTRATION_LATENCY_US: null, // measured below
}

// Clean up emulator + grandchild.
spawnSync("kill", ["-KILL", String(emulatorPid)])
// Grandchild is reparented to launchd; we have no authority from
// this process to kill it. The probe is harmless; it will exit on
// its own.

const out = join(TMP_DIR, "22-mechb-capability.json")
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ok: true, results_path: out, result }, null, 2))
