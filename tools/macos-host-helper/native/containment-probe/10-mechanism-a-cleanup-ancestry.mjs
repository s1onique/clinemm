#!/usr/bin/env node
// 10-mechanism-a-cleanup-ancestry.mjs
//
// CANDIDATE A — cleanup-time PPID-chain ancestry reconstruction.
//
// Hypothesis (intentionally REFUTABLE):
//   root PID -> enumerate process table at cleanup time
//             -> recursively select descendants by CURRENT ppid
//             -> terminate matched identities
//
// Native process information via libproc is preferred; here we
// use ps for portability but the destructive decision only goes
// through kernel-backed kill(pid, 0) + kill(pid, sig).
//
// Expected: REFUTED. Current ppid == 1 after reparenting; lineage
// breaks at the setsid()/detached:true boundary.
//
// Output: emits JSON to stdout describing for each fixture:
//   - expected_escaped_pids (processes with ppid=1, pgid != rootPgid)
//   - candidate_a_attributed (subset found via current-ppid BFS)
//   - classification: A_RECONSTRUCTED | A_MISSED_BUT_RECLAIMED | A_REFUTED

import { spawn, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const FIXTURE_DIR =
  process.env.FIXTURE_DIR || "/tmp/clinemm-descendant-conservation-telemetry01"
const TMP_DIR =
  process.env.TMP_OUT || "/tmp/clinemm-helper-supervised-command-containment01"
mkdirSync(TMP_DIR, { recursive: true })

const FIXTURES = [
  { id: "shell-A",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "01-fixture-shell.sh")] },
  { id: "node-B",        cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "02-fixture-node.mjs")] },
  { id: "python-C",      cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "03-fixture-python.py")] },
  { id: "mixed-D",       cmd: ["/bin/bash",     join(FIXTURE_DIR, "04-fixture-mixed.sh")] },
  { id: "node-escape",   cmd: ["/opt/homebrew/bin/node", join(FIXTURE_DIR, "05-fixture-node-escape.mjs")] },
  { id: "python-escape", cmd: ["/opt/homebrew/bin/python3", join(FIXTURE_DIR, "06-fixture-python-escape.py")] },
]

const DURATION = 5 // seconds; matches predecessor ACT

// ---------------------------------------------------------------------------
// Process-table snapshot. We use ps for portability; the destructive
// decision only goes through kernel-backed kill(pid, 0) + kill(pid, sig).
// ---------------------------------------------------------------------------

function psSnapshot() {
  const out = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,sess=,comm="])
  if (out.status !== 0) return []
  return out.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, ppid, pgid, sess, comm]) => ({
      pid: parseInt(pid, 10),
      ppid: parseInt(ppid, 10),
      pgid: parseInt(pgid, 10),
      sess: parseInt(sess, 10),
      comm,
    }))
}

// Baseline: pre-test snapshot of all ppid=1 processes (system daemons
// + any pre-existing reparented descendants of our session). New
// ppid=1+pgid=itself processes that appear AFTER our root spawns are
// candidate escapes from OUR test.
function baselineOrphans(snap) {
  const m = new Map()
  for (const p of snap) {
    if (p.ppid === 1 && p.pid !== 1) m.set(p.pid, p)
  }
  return m
}

// Detect candidate escapes: ppid=1, pgid=its-own-pid, NOT in the
// pre-test baseline, AND NOT a long-running system daemon.
function newOrphans(before, after) {
  const out = []
  for (const p of after) {
    if (p.ppid !== 1 || p.pid === 1) continue
    if (p.pgid !== p.pid) continue  // ppid=1 but pgid is still a job group; not a session escape
    if (before.has(p.pid)) continue // was already there
    out.push(p)
  }
  return out
}

function probe(pid) {
  const r = spawnSync("kill", ["-0", String(pid)])
  if (r.status === 0) return { rc: 0, name: "ALIVE" }
  const m = r.stderr?.toString().match(/errno\s*(\d+)/)
  const errno = m ? parseInt(m[1], 10) : -1
  if (errno === 3) return { rc: r.status ?? -1, errno, name: "ESRCH" }
  if (errno === 1) return { rc: r.status ?? -1, errno, name: "EPERM" }
  return { rc: r.status ?? -1, errno, name: "UNKNOWN" }
}

// ---------------------------------------------------------------------------
// Candidate A: cleanup-time ancestry reconstruction by CURRENT ppid.
// ---------------------------------------------------------------------------

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
    const kids = childrenOf.get(cur) ?? []
    for (const k of kids) {
      if (!seen.has(k)) {
        seen.add(k)
        queue.push(k)
      }
    }
  }
  seen.delete(rootPid)
  return seen
}

// ---------------------------------------------------------------------------
// Test driver — one fixture at a time.
// ---------------------------------------------------------------------------

async function runFixture(fx) {
  // 0. baseline: pre-test snapshot of system orphans
  const baselineSnap = psSnapshot()
  const baseline = baselineOrphans(baselineSnap)

  // NOTE: spawn returns a Node ChildProcess whose .pid is the spawned
  // PID, but because Node sets `detached: true` AND the test is
  // running inside the agent sandbox, the actual spawned fixture
  // may live in a different user namespace. We still capture the
  // Node-level pid (which is what ps in this process sees).
  const child = spawn(fx.cmd[0], fx.cmd.slice(1), {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const rootPid = child.pid

  // Give the fixture time to spawn its children and, in E/F, to
  // perform the setsid()/detached:true fork.
  await new Promise((r) => setTimeout(r, 1500))

  // Snapshot the inherited-PGID tree so we can verify which
  // processes are descendants of rootPid BEFORE any kill action.
  const snapInherited = psSnapshot()
  const inheritedSet = reconstructDescendants(rootPid, snapInherited)
  // Cross-check the actual rootPid exists in ps.
  const rootProc = snapInherited.find((p) => p.pid === rootPid)

  // STEP 1: simulate the predecessor ACT's helper-mediated PGID
  // cleanup -- kill the root's inherited PGID. This is what the
  // helper actually does today. Anything that survives this is an
  // "escape" by definition (it's NOT in our original PGID, so the
  // inherited-PGID mechanism cannot reach it).
  //
  // We attempt the kill from this process; if EPERM, the helper
  // has the LaunchAgent authority to escalate. For the discriminator
  // we only need to know whether anything survived.
  const pgidKill = spawnSync("kill", ["-KILL", "-" + rootPid])
  await new Promise((r) => setTimeout(r, 1500))

  const snapAfterInherited = psSnapshot()
  // An escape is a process that:
  //   - was an inherited descendant of rootPid AND survived the
  //     inherited-PGID kill, OR
  //   - is a NEW ppid=1, pgid=itself process not in baseline that
  //     matches our fixture's comm (sleep / node / python).
  const escapeSurvivors = []
  for (const p of snapAfterInherited) {
    if (p.pid === rootPid) continue
    if (p.pgid === rootPid) continue
    if (inheritedSet.has(p.pid)) {
      escapeSurvivors.push(p)
      continue
    }
    if (p.ppid === 1 && p.pid !== 1 && p.pgid === p.pid && !baseline.has(p.pid)) {
      const c = p.comm.toLowerCase()
      if (c.includes("sleep") || c.includes("node") || c.includes("python")) {
        escapeSurvivors.push(p)
      }
    }
  }

  // === CANDIDATE A: cleanup-time ancestry reconstruction ===
  // The naive helper would, AT THIS MOMENT, walk the process table
  // by CURRENT ppid and try to terminate. We model that:
  const candidateA = reconstructDescendants(rootPid, snapAfterInherited)

  // === Termination (Candidate A) ===
  let targeted = 0
  let termOk = 0
  let termEperm = 0
  let alreadyDead = 0
  for (const pid of candidateA) {
    targeted++
    const p = probe(pid)
    if (p.name === "ESRCH") { alreadyDead++; continue }
    const killR = spawnSync("kill", ["-TERM", String(pid)])
    if (killR.status === 0) termOk++
    else if (killR.stderr?.toString().includes("Operation not permitted") ||
             killR.stderr?.toString().includes("EPERM"))
      termEperm++
  }
  await new Promise((r) => setTimeout(r, 800))
  for (const pid of candidateA) {
    const p = probe(pid)
    if (p.name === "ALIVE") {
      const killR = spawnSync("kill", ["-KILL", String(pid)])
      if (killR.status === 0) termOk++
      else if (killR.stderr?.toString().includes("Operation not permitted") ||
               killR.stderr?.toString().includes("EPERM"))
        termEperm++
    }
  }

  await new Promise((r) => setTimeout(r, 1500))

  const escapedSet = new Set(escapeSurvivors.map((p) => p.pid))
  const attributedByA = []
  const missedByA = []
  for (const pid of escapedSet) {
    if (candidateA.has(pid)) attributedByA.push(pid)
    else missedByA.push(pid)
  }
  const stillAliveAfter = []
  for (const pid of escapedSet) {
    const p = probe(pid)
    if (p.name === "ALIVE") stillAliveAfter.push(pid)
  }

  const result = {
    fixture: fx.id,
    rootPid,
    root_proc_seen_in_ps: !!rootProc,
    candidate: "A_cleanup_ancestry",
    inherited_descendants_before_kill: Array.from(inheritedSet),
    escape_survivors_after_inherited_pgid_kill: escapeSurvivors.map((p) => ({
      pid: p.pid, ppid: p.ppid, pgid: p.pgid, sess: p.sess, comm: p.comm,
    })),
    expected_escaped_pids: Array.from(escapedSet),
    candidate_a_attributed: attributedByA,
    candidate_a_missed: missedByA,
    candidates_a_targeted: targeted,
    term_ok: termOk,
    term_eperm: termEperm,
    already_dead: alreadyDead,
    still_alive_after: stillAliveAfter,
    classification:
      escapedSet.size === 0 ? "A_NO_ESCAPES_OBSERVED"
      : missedByA.length === 0 ? "A_RECONSTRUCTED"
      : stillAliveAfter.length === 0 ? "A_MISSED_BUT_RECLAIMED"
      : "A_REFUTED",
  }

  // Final sweep so the test doesn't leak.
  for (const pid of Array.from(escapedSet)) {
    spawnSync("kill", ["-KILL", String(pid)])
  }
  try { child.kill("SIGKILL") } catch {}

  return result
}

;(async () => {
  const filter = process.env.ONLY
  const targets = filter ? FIXTURES.filter((f) => f.id === filter) : FIXTURES

  const results = []
  for (const fx of targets) {
    console.error(`[A] running fixture ${fx.id} ...`)
    try {
      const r = await runFixture(fx)
      results.push(r)
      console.error(
        `[A] ${fx.id}: ${r.classification} ` +
        `(expected=${r.expected_escaped_pids.length}, ` +
        `attributed=${r.candidate_a_attributed.length}, ` +
        `missed=${r.candidate_a_missed.length}, ` +
        `alive_after=${r.still_alive_after.length})`,
      )
    } catch (e) {
      results.push({ fixture: fx.id, error: String(e) })
      console.error(`[A] ${fx.id}: ERROR ${e}`)
    }
  }

  const out = join(TMP_DIR, "10-mechanism-a-results.json")
  writeFileSync(out, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ ok: true, results_path: out, results }, null, 2))
})()
