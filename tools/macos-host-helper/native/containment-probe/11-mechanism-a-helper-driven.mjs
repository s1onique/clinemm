#!/usr/bin/env node
// 11-mechanism-a-helper-driven.mjs
//
// HELPER-DRIVEN CANDIDATE A — cleanup-time PPID-chain ancestry
// reconstruction.
//
// Why helper-driven: my user cannot signal processes spawned in
// the test sandbox (sandbox isolates kill authority to the parent
// process). The clinemm-host-helper is a LaunchAgent with EPERM
// authority across the sandbox boundary; it can deliver signals
// my user cannot.
//
// Hypothesis (intentionally REFUTABLE):
//   root PID -> enumerate process table at cleanup time
//             -> recursively select descendants by CURRENT ppid
//             -> terminate matched identities via helper-owned PGID
//             -> did we catch the setsid()/detached:true escape?
//
// Expected: REFUTED. Current ppid == 1 after reparenting; lineage
// breaks at the setsid()/detached:true boundary. Helper-mediated
// PGID cleanup of the inherited PGID does NOT reach detached
// descendants that have moved to a new PGID/session.

import { spawn, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"

const FIXTURE_DIR =
  process.env.FIXTURE_DIR || "/tmp/clinemm-descendant-conservation-telemetry01"
const TMP_DIR =
  process.env.TMP_OUT || "/tmp/clinemm-helper-supervised-command-containment01"
const SOCKET =
  process.env.CLINEMM_HOST_HELPER_SOCKET ||
  "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"
mkdirSync(TMP_DIR, { recursive: true })

const FIXTURES = [
  { id: "shell-A",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "01-fixture-shell.sh")] },
  { id: "node-B",        cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "02-fixture-node.mjs")] },
  { id: "python-C",      cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "03-fixture-python.py")] },
  { id: "mixed-D",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "04-fixture-mixed.sh")] },
  { id: "node-escape",   cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "05-fixture-node-escape.mjs")] },
  { id: "python-escape", cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "06-fixture-python-escape.py")] },
]

// ---------------------------------------------------------------------------
// Helper wire client.
// ---------------------------------------------------------------------------

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

async function helperOpen()        { return await callHelper("client.open", {}) }
async function helperRegister(ct, pgid) { return await callHelper("process-group.register-owned", { client_token: ct, pgid }) }
async function helperTerminate(ct, jt) { return await callHelper("process-group.terminate-owned", { client_token: ct, job_token: jt }) }
async function helperClose(ct)     { return await callHelper("client.close", { client_token: ct }) }

// ---------------------------------------------------------------------------
// Process-table snapshot via ps.
// ---------------------------------------------------------------------------

function psLines() {
  const out = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,sess=,comm="])
  if (out.status !== 0) return []
  return out.stdout.toString().split("\n").filter(Boolean).map((line) => {
    const [pid, ppid, pgid, sess, comm] = line.trim().split(/\s+/)
    return { pid: +pid, ppid: +ppid, pgid: +pgid, sess: +sess, comm }
  })
}

function psSnapshot() { return psLines() }

function baselineOrphans(snap) {
  const m = new Map()
  for (const p of snap) if (p.ppid === 1 && p.pid !== 1) m.set(p.pid, p)
  return m
}

function reconstructDescendants(rootPid, allProcs) {
  const childrenOf = new Map()
  for (const p of allProcs) {
    if (p.pid === rootPid) continue
    if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, [])
    childrenOf.get(p.ppid).push(p.pid)
  }
  const seen = new Set([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const k of childrenOf.get(cur) ?? []) {
      if (!seen.has(k)) { seen.add(k); queue.push(k) }
    }
  }
  seen.delete(rootPid)
  return seen
}

// ---------------------------------------------------------------------------
// Test driver (helper-driven).
// ---------------------------------------------------------------------------

async function runFixture(fx) {
  // 0. baseline
  const baseline = baselineOrphans(psSnapshot())

  // 1. open a helper client connection (kernel-bound peer identity)
  let openErr = null
  let openResp = null
  try {
    openResp = await helperOpen()
  } catch (e) { openErr = String(e) }
  if (!openResp || !openResp.ok) {
    return { fixture: fx.id, error: "HELPER_OPEN_FAILED", helper_open_error: openErr ?? openResp?.error }
  }
  const clientToken = openResp.client_token

  // 2. spawn the fixture. The fixture's rootPid becomes the
  //    process group leader. We register rootPid's PGID with the
  //    helper via process-group.register-owned.
  const child = spawn(fx.cmd[0], fx.cmd.slice(1), {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  })
  const rootPid = child.pid

  // 3. Give the fixture time to spawn its children and, in E/F,
  //    to perform the setsid()/detached:true fork.
  await new Promise((r) => setTimeout(r, 1500))

  const snapBefore = psSnapshot()
  const inheritedSet = reconstructDescendants(rootPid, snapBefore)

  // 4. Register rootPid's PGID with the helper.
  let regResp = null, regErr = null
  try {
    regResp = await helperRegister(clientToken, rootPid)
  } catch (e) { regErr = String(e) }
  if (!regResp || !regResp.ok) {
    await helperClose(clientToken)
    return {
      fixture: fx.id, rootPid, candidate: "A_cleanup_ancestry_helper_driven",
      inherited_descendants: Array.from(inheritedSet),
      helper_register_error: regErr ?? regResp?.error,
      classification: "A_REGISTER_FAILED",
    }
  }
  const jobToken = regResp.job_token

  // 5. Helper terminates the inherited PGID via SIGTERM-grace-then-SIGKILL.
  let termResp = null, termErr = null
  try {
    termResp = await helperTerminate(clientToken, jobToken)
  } catch (e) { termErr = String(e) }

  // 6. Inspect the post-kill process table for surviving descendants.
  await new Promise((r) => setTimeout(r, 1500))
  const snapAfter = psSnapshot()
  const escapeSurvivors = []
  for (const p of snapAfter) {
    if (p.pid === rootPid) continue
    if (p.pgid === rootPid) continue
    if (inheritedSet.has(p.pid)) { escapeSurvivors.push(p); continue }
    if (p.ppid === 1 && p.pid !== 1 && p.pgid === p.pid && !baseline.has(p.pid)) {
      const c = p.comm.toLowerCase()
      if (c.includes("sleep") || c.includes("node") || c.includes("python")) {
        escapeSurvivors.push(p)
      }
    }
  }

  // 7. === CANDIDATE A: cleanup-time ancestry reconstruction ===
  //     Walk the process table by CURRENT ppid from rootPid.
  const candidateA = reconstructDescendants(rootPid, snapAfter)

  // 8. Try to kill each candidate-A pid. If we cannot (EPERM),
  //    report honestly. We are testing whether the BFS found the
  //    escape; whether we can deliver the kill is a separate axis
  //    covered by mechanism B/C.
  const attempted = []
  const killed = []
  const alreadyDead = []
  for (const pid of candidateA) {
    attempted.push(pid)
    const killR = spawnSync("kill", ["-KILL", String(pid)])
    if (killR.status === 0) killed.push(pid)
    else if (killR.stderr?.toString().includes("ESRCH")) alreadyDead.push(pid)
  }

  // 9. Final probe — any escapeSurvivors still alive?
  await new Promise((r) => setTimeout(r, 500))
  const finalSnap = psSnapshot()
  const stillAliveAfter = []
  for (const p of escapeSurvivors) {
    const cur = finalSnap.find((q) => q.pid === p.pid)
    if (cur) stillAliveAfter.push(cur.pid)
  }

  await helperClose(clientToken)

  const escapedSet = new Set(escapeSurvivors.map((p) => p.pid))
  const attributedByA = []
  const missedByA = []
  for (const pid of escapedSet) {
    if (candidateA.has(pid)) attributedByA.push(pid)
    else missedByA.push(pid)
  }

  return {
    fixture: fx.id,
    rootPid,
    candidate: "A_cleanup_ancestry_helper_driven",
    helper_register_response: regResp,
    helper_terminate_response: termResp,
    helper_terminate_error: termErr,
    inherited_descendants: Array.from(inheritedSet),
    escape_survivors: escapeSurvivors.map((p) => ({
      pid: p.pid, ppid: p.ppid, pgid: p.pgid, sess: p.sess, comm: p.comm,
    })),
    expected_escaped_pids: Array.from(escapedSet),
    candidate_a_attributed: attributedByA,
    candidate_a_missed: missedByA,
    candidates_a_targeted: attempted,
    actually_terminated: killed,
    already_dead: alreadyDead,
    still_alive_after: stillAliveAfter,
    classification:
      escapedSet.size === 0 ? "A_NO_ESCAPES_OBSERVED"
      : missedByA.length === 0 ? "A_RECONSTRUCTED"
      : stillAliveAfter.length === 0 ? "A_MISSED_BUT_RECLAIMED"
      : "A_REFUTED",
  }
}

;(async () => {
  const filter = process.env.ONLY
  const targets = filter ? FIXTURES.filter((f) => f.id === filter) : FIXTURES

  const results = []
  for (const fx of targets) {
    console.error(`[A] (helper-driven) running fixture ${fx.id} ...`)
    try {
      const r = await runFixture(fx)
      results.push(r)
      console.error(
        `[A] ${fx.id}: ${r.classification} ` +
        `(expected=${r.expected_escaped_pids?.length ?? 0}, ` +
        `attributed=${r.candidate_a_attributed?.length ?? 0}, ` +
        `missed=${r.candidate_a_missed?.length ?? 0}, ` +
        `alive_after=${r.still_alive_after?.length ?? 0})`,
      )
    } catch (e) {
      results.push({ fixture: fx.id, error: String(e) })
      console.error(`[A] ${fx.id}: ERROR ${e}`)
    }
  }

  const out = join(TMP_DIR, "11-mechanism-a-helper-driven.json")
  writeFileSync(out, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ ok: true, results_path: out, results }, null, 2))
})()
