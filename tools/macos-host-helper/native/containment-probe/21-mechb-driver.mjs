#!/usr/bin/env node
// 21-mechb-driver.mjs
//
// Driver for CANDIDATE B (kqueue EVFILT_PROC NOTE_FORK).
//
// Lifecycle:
//   1. spawn fixture
//   2. start kqueue probe on rootPid (records every NOTE_FORK
//      child PID it observes and recursively registers watches)
//   3. wait for fixture to do its setsid()/detached:true work
//   4. ask helper to kill inherited PGID
//   5. ask kqueue probe to terminate (SIGTERM)
//   6. parse probe output: tracked pids vs actual surviving pids
//
// The discriminator: did the kqueue probe's tracked set include
// the detached/setsid'd grandchild that the inherited-PGID helper
// kill leaves alive?

import { spawn, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync, createReadStream, statSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

const FIXTURE_DIR =
  process.env.FIXTURE_DIR || "/tmp/clinemm-descendant-conservation-telemetry01"
const TMP_DIR =
  process.env.TMP_OUT || "/tmp/clinemm-helper-supervised-command-containment01"
const SOCKET =
  process.env.CLINEMM_HOST_HELPER_SOCKET ||
  "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"
const PROBE =
  process.env.MECHB_PROBE ||
  "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/containment-probe/20-mechb-kqueue-probe"

mkdirSync(TMP_DIR, { recursive: true })

const FIXTURES = [
  { id: "shell-A",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "01-fixture-shell.sh")] },
  { id: "node-B",        cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "02-fixture-node.mjs")] },
  { id: "python-C",      cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "03-fixture-python.py")] },
  { id: "mixed-D",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "04-fixture-mixed.sh")] },
  { id: "node-escape",   cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "05-fixture-node-escape.mjs")] },
  { id: "python-escape", cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "06-fixture-python-escape.py")] },
]

let nextReqId = 1
function callHelper(method, params) {
  return new Promise((resolve, reject) => {
    const requestId = "disc-" + nextReqId++
    const envelope = { version: 1, request_id: requestId, method, ...(params ?? {}) }
    const conn = createConnection(SOCKET)
    let buffer = ""
    let resolved = false
    const cleanup = () => { try { conn.destroy() } catch {} }
    conn.setTimeout(8000)
    conn.on("timeout", () => { if (resolved) return; resolved = true; cleanup(); reject(new Error("helper timeout: " + method)) })
    conn.on("error",   (e) => { if (resolved) return; resolved = true; cleanup(); reject(e) })
    conn.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const idx = buffer.indexOf("\n")
      if (idx < 0) return
      const line = buffer.slice(0, idx).trim()
      cleanup()
      if (resolved) return
      resolved = true
      try { resolve(JSON.parse(line)) } catch (e) { reject(e) }
    })
    conn.on("connect", () => conn.write(JSON.stringify(envelope) + "\n"))
  })
}

function psLines() {
  const out = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,sess=,comm="])
  if (out.status !== 0) return []
  return out.stdout.toString().split("\n").filter(Boolean).map((line) => {
    const [pid, ppid, pgid, sess, comm] = line.trim().split(/\s+/)
    return { pid: +pid, ppid: +ppid, pgid: +pgid, sess: +sess, comm }
  })
}

function baselineOrphans(snap) {
  const m = new Map()
  for (const p of snap) if (p.ppid === 1 && p.pid !== 1) m.set(p.pid, p)
  return m
}

// ---------------------------------------------------------------------------
// Per-fixture run.
// ---------------------------------------------------------------------------

async function runFixture(fx, opts = {}) {
  const duration = opts.duration ?? 5
  const probeDuration = opts.probeDuration ?? 5

  const baseline = baselineOrphans(psLines())

  // 1. spawn fixture
  const child = spawn(fx.cmd[0], fx.cmd.slice(1), {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  })
  const rootPid = child.pid

  // 2. immediately start the kqueue probe BEFORE the fixture has
  //    a chance to fork. Race discriminator.
  const probeOut = join(TMP_DIR, `${fx.id}-probe.log`)
  const probe = spawn(PROBE, [String(rootPid), String(probeDuration)], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let probeStderr = ""
  probe.stdout.on("data", () => {})
  probe.stderr.on("data", (c) => { probeStderr += c.toString() })

  // Capture probe output to file as it comes in.
  const probeOutFd = (await import("node:fs")).openSync
  const { openSync } = await import("node:fs")
  const fd = openSync(probeOut, "w")
  probe.stdout.on("data", (chunk) => {
    try { require("node:fs").writeSync(fd, chunk) } catch {}
  })
  probe.stderr.on("data", (chunk) => {
    probeStderr += chunk.toString()
  })

  // 3. give fixture + probe time to converge
  await new Promise((r) => setTimeout(r, duration * 1000))

  // 4. terminate the probe gracefully
  spawnSync("kill", ["-TERM", String(probe.pid)])
  // wait for probe to exit
  await new Promise((r) => probe.on("exit", r))
  // close fd
  try { require("node:fs").closeSync(fd) } catch {}

  // 5. parse probe output
  let probeLines = []
  try {
    const raw = require("node:fs").readFileSync(probeOut, "utf8")
    probeLines = raw.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch (e) {}

  const endLine = probeLines.find((l) => l.event === "end") || {}
  const watched = endLine.watched || []
  const allSeen = endLine.all_seen || []
  const forkEvents = probeLines.filter((l) => l.event === "fork")
  const watchEvents = probeLines.filter((l) => l.event === "watch")

  // 6. Now perform the helper-mediated PGID cleanup so we can see
  //    what survives. The probe already terminated; we re-register
  //    and re-terminate using the helper.
  let openResp = null
  try { openResp = await callHelper("client.open", {}) } catch {}
  if (!openResp || !openResp.ok) {
    return { fixture: fx.id, error: "HELPER_OPEN_FAILED", rootPid }
  }
  const clientToken = openResp.client_token
  let regResp = null
  try { regResp = await callHelper("process-group.register-owned", { client_token: clientToken, pgid: rootPid }) } catch {}
  if (!regResp || !regResp.ok) {
    await callHelper("client.close", { client_token: clientToken })
    return { fixture: fx.id, error: "HELPER_REGISTER_FAILED", helper_register_error: regResp?.error, rootPid }
  }
  await callHelper("process-group.terminate-owned", { client_token: clientToken, job_token: regResp.job_token })
  await callHelper("client.close", { client_token: clientToken })

  // 7. Snapshot the post-cleanup process table. Identify survivors.
  await new Promise((r) => setTimeout(r, 1500))
  const finalSnap = psLines()
  const escapeSurvivors = []
  for (const p of finalSnap) {
    if (p.pid === rootPid) continue
    if (p.pgid === rootPid) continue
    if (p.ppid === 1 && p.pid !== 1 && p.pgid === p.pid && !baseline.has(p.pid)) {
      const c = p.comm.toLowerCase()
      if (c.includes("sleep") || c.includes("node") || c.includes("python")) {
        escapeSurvivors.push(p)
      }
    }
  }

  // 8. Did the kqueue probe's tracked set capture the escape?
  const watchedSet = new Set(watched)
  const seenSet = new Set(allSeen)
  const escapePids = new Set(escapeSurvivors.map((p) => p.pid))
  const attributed = []
  const missed = []
  for (const pid of escapePids) {
    if (watchedSet.has(pid)) attributed.push(pid)
    else missed.push(pid)
  }

  return {
    fixture: fx.id,
    rootPid,
    candidate: "B_kqueue_lineage",
    probe_watched_count: watched.length,
    probe_seen_count: allSeen.length,
    probe_fork_event_count: forkEvents.length,
    probe_watch_event_count: watchEvents.length,
    probe_stderr: probeStderr.slice(0, 4000),
    probe_watched: watched,
    probe_all_seen: allSeen,
    escape_survivors: escapeSurvivors.map((p) => ({
      pid: p.pid, ppid: p.ppid, pgid: p.pgid, comm: p.comm,
    })),
    expected_escaped_pids: Array.from(escapePids),
    candidate_b_attributed: attributed,
    candidate_b_missed: missed,
    classification:
      escapePids.size === 0 ? "B_NO_ESCAPES_OBSERVED"
      : missed.length === 0 ? "B_RECONSTRUCTED"
      : "B_REFUTED",
  }
}

;(async () => {
  const filter = process.env.ONLY
  const targets = filter ? FIXTURES.filter((f) => f.id === filter) : FIXTURES
  const results = []
  for (const fx of targets) {
    console.error(`[B] running fixture ${fx.id} ...`)
    try {
      const r = await runFixture(fx)
      results.push(r)
      console.error(
        `[B] ${fx.id}: ${r.classification} ` +
        `(expected=${r.expected_escaped_pids?.length ?? 0}, ` +
        `attributed=${r.candidate_b_attributed?.length ?? 0}, ` +
        `missed=${r.candidate_b_missed?.length ?? 0}, ` +
        `watched=${r.probe_watched_count ?? 0}, ` +
        `seen=${r.probe_seen_count ?? 0})`,
      )
    } catch (e) {
      results.push({ fixture: fx.id, error: String(e) })
      console.error(`[B] ${fx.id}: ERROR ${e}`)
    }
  }

  const out = join(TMP_DIR, "21-mechb-results.json")
  writeFileSync(out, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ ok: true, results_path: out, results }, null, 2))
})()
