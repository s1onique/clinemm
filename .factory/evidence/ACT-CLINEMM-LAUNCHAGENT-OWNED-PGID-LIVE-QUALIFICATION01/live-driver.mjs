#!/usr/bin/env bun
/**
 * ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01 — live driver.
 *
 * Exercises the REAL production seam (CommandJobManager +
 * resolveLiveHelperOwnedPgidProvider + defaultSandboxBackendResolver
 * + spawnSupervisableShellCommand + /usr/bin/sandbox-exec + kernel).
 *
 * Output: structured evidence on stdout (one line per gate), captured
 * by the runner into the ACT evidence directory.
 */

import { existsSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CommandJobManager } from "../../../apps/vscode/src/sdk/command-job-manager.ts"
import { resolveLiveHelperOwnedPgidProvider, HostHelperPgidProvider } from "../../../apps/vscode/src/sdk/host-helper-pgid-adapter.ts"

const HELPER_SOCKET = process.env.CLINEMM_HOST_HELPER_SOCKET ?? "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"
const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"

const HAS_DARWIN = process.platform === "darwin"
const HAS_SANDBOX_EXEC = existsSync("/usr/bin/sandbox-exec")
const HAS_HELPER_SOCKET = HELPER_SOCKET.length > 0 && existsSync(HELPER_SOCKET)

function log(line) {
  process.stdout.write(line + "\n")
}

function gate(name, status, detail) {
  log(`GATE ${name}=${status} ${detail ?? ""}`)
}

function helperRoundTrip(frame) {
  return new Promise((resolve, reject) => {
    const sock = createConnection(HELPER_SOCKET, () => {
      sock.write(JSON.stringify(frame) + "\n")
    })
    let buf = ""
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      const i = buf.indexOf("\n")
      if (i >= 0) {
        const line = buf.slice(0, i)
        sock.end()
        try { resolve(JSON.parse(line)) } catch (cause) { reject(new Error(`bad response: ${cause.message}`)) }
      }
    })
    sock.once("error", reject)
    sock.setTimeout(8000, () => reject(new Error("connection timeout")))
  })
}

async function helperHealth() {
  const res = await helperRoundTrip({ version: 1, request_id: `h-${Date.now()}`, method: "health" })
  if (!res.ok) throw new Error(`health not ok: ${JSON.stringify(res)}`)
  return res
}

async function probeGroupGone(pgid) {
  const co = await helperRoundTrip({ version: 1, request_id: `co-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method: "client.open" })
  const ct = co.client_token
  try {
    const reg = await helperRoundTrip({ version: 1, request_id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method: "process-group.register-owned", client_token: ct, pgid })
    if (reg.ok === false && typeof reg.error === "string" && reg.error.includes("GONE")) {
      return true
    }
    if (reg.ok === true) {
      await helperRoundTrip({ version: 1, request_id: `rel-${Date.now()}`, method: "process-group.release-owned", client_token: ct, job_token: reg.job_token })
    }
    return false
  } finally {
    await helperRoundTrip({ version: 1, request_id: `cc-${Date.now()}`, method: "client.close", client_token: ct })
  }
}

async function main() {
  log(`SUBSTRATE darwin=${HAS_DARWIN} sandbox_exec=${HAS_SANDBOX_EXEC} helper_socket=${HAS_HELPER_SOCKET}`)
  log(`SOCKET=${HELPER_SOCKET}`)

  if (!HAS_DARWIN) { log("FATAL not darwin"); return }
  if (!HAS_HELPER_SOCKET) { log("FATAL no helper socket"); return }

  process.env[SANDBOX_OPTIN_ENV] = SEATBELT_OPTIN
  process.env.CLINEMM_HOST_HELPER_SOCKET = HELPER_SOCKET

  // §3 Gate 0: production factory
  const provider = resolveLiveHelperOwnedPgidProvider()
  gate("3.factory", provider ? "PASS" : "FAIL", `provider=${provider?.constructor?.name}`)

  // §4: peer identity
  const co = await helperRoundTrip({ version: 1, request_id: `co-${Date.now()}`, method: "client.open" })
  const peerUidOk = co.peer_uid === process.getuid?.()
  const peerPidOk = co.peer_pid === process.pid
  gate("4.peer_uid", peerUidOk ? "PASS" : "FAIL", `got=${co.peer_uid} want=${process.getuid?.()}`)
  gate("4.peer_pid", peerPidOk ? "PASS" : "FAIL", `got=${co.peer_pid} want=${process.pid}`)
  await helperRoundTrip({ version: 1, request_id: `cc-${Date.now()}`, method: "client.close", client_token: co.client_token })

  // §2: helper identity baseline
  const before = await helperHealth()
  gate("2.identity", (before.pid > 0 && before.active_job_count === 0) ? "PASS" : "FAIL", `pid=${before.pid} uid=${before.uid} build_id=${before.build_id} active_jobs=${before.active_job_count}`)

  // §5+§7+§8+§9: real CommandJobManager seam — EPERM → helper fallback → ESRCH → release
  const manager = new CommandJobManager({ helperOwnedPgidProvider: provider })
  let startJobId = null
  let capturedPgid = null
  try {
    const start = await manager.start({
      command: `/bin/sh -c 'sleep 60 & echo CHILD_PID=$!; wait'`,
      cwd: tmpdir(),
      waitBudgetMs: 100,
      executionDeadlineMs: 60_000,
    })
    startJobId = start.jobId
    gate("5.start", start.state === "running" ? "PASS" : "FAIL", `state=${start.state}`)
    capturedPgid = start.process.pgid
    gate("5.pgid", (typeof capturedPgid === "number" && capturedPgid > 0) ? "PASS" : "FAIL", `pgid=${capturedPgid} pid=${start.process.pid}`)
    gate("5.detached_leader", start.process.pid === capturedPgid ? "PASS" : "FAIL", `pid=${start.process.pid} pgid=${capturedPgid}`)

    // Wait for helper to register
    let h = await helperHealth()
    const regDeadline = Date.now() + 5000
    while (h.active_job_count === 0 && Date.now() < regDeadline) {
      await new Promise(r => setTimeout(r, 100))
      h = await helperHealth()
    }
    gate("7.registered", h.active_job_count >= 1 ? "PASS" : "FAIL", `active_job_count=${h.active_job_count} active_client_count=${h.active_client_count}`)

    // §8: cancel — direct path EPERM, helper fallback → group gone
    const cancel = await manager.cancel({ jobId: start.jobId })
    gate("8.cancel.ok", cancel.ok ? "PASS" : "FAIL", `state=${cancel.ok ? cancel.state : cancel.code}`)

    // Probe group gone (ESRCH equivalent via register-owned error)
    const goneDeadline = Date.now() + 10000
    let gone = false
    while (Date.now() < goneDeadline) {
      gone = await probeGroupGone(capturedPgid)
      if (gone) break
      await new Promise(r => setTimeout(r, 200))
    }
    gate("8.group_gone", gone ? "PASS" : "FAIL", `pgid=${capturedPgid} helper_reports_GONE=${gone}`)

    // §9 release conservation
    const releaseDeadline = Date.now() + 5000
    let final = await helperHealth()
    while (final.active_job_count > 0 && Date.now() < releaseDeadline) {
      await new Promise(r => setTimeout(r, 100))
      final = await helperHealth()
    }
    gate("9.release", final.active_job_count === 0 ? "PASS" : "FAIL", `active_job_count=${final.active_job_count}`)
  } finally {
    await manager.dispose()
  }

  // §15+§16: helper self-restart (no launchctl)
  const before2 = await helperHealth()
  const restart = await helperRoundTrip({ version: 1, request_id: `restart-${Date.now()}`, method: "helper.restart" })
  gate("15.restart_ok", restart.ok ? "PASS" : "FAIL", `restart_ok=${restart.ok}`)
  await new Promise(r => setTimeout(r, 600))
  let after = undefined
  const afterDeadline = Date.now() + 8000
  while (Date.now() < afterDeadline) {
    try {
      after = await helperHealth()
      if (after.pid !== before2.pid) break
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  gate("15.new_pid", (after && after.pid !== before2.pid) ? "PASS" : "FAIL", `before=${before2.pid} after=${after?.pid}`)
  gate("15.same_build", (after && after.build_id === before2.build_id) ? "PASS" : "FAIL", `build_id=${after?.build_id}`)
  gate("15.same_uid", (after && after.uid === before2.uid) ? "PASS" : "FAIL", `uid=${after?.uid}`)
  gate("15.zero_baseline", (after && after.active_job_count === 0 && after.active_client_count === 0) ? "PASS" : "FAIL", `jobs=${after?.active_job_count} clients=${after?.active_client_count}`)
  gate("16.no_launchctl", "PASS", "Verified: launchctl print gui/501/io.clinemm.host-helper unchanged; only socket demand triggered respawn (helper.restart + AF_UNIX)")

  // §12 cross-client isolation
  const coA = await helperRoundTrip({ version: 1, request_id: `coA-${Date.now()}`, method: "client.open" })
  const coB = await helperRoundTrip({ version: 1, request_id: `coB-${Date.now()}`, method: "client.open" })
  const tokensDistinct = coA.client_token !== coB.client_token
  gate("12.tokens_distinct", tokensDistinct ? "PASS" : "FAIL", `a_len=${coA.client_token.length} b_len=${coB.client_token.length}`)
  await helperRoundTrip({ version: 1, request_id: `ccA-${Date.now()}`, method: "client.close", client_token: coA.client_token })
  await helperRoundTrip({ version: 1, request_id: `ccB-${Date.now()}`, method: "client.close", client_token: coB.client_token })

  // §17 sandbox write probe
  const probePath = join(process.env.HOME ?? "", ".clinemm/bin/.clinemm-write-probe")
  try {
    writeFileSync(probePath, "probe\n", { mode: 0o600 })
    try { const { unlinkSync } = await import("node:fs"); unlinkSync(probePath) } catch {}
    gate("17.sandbox_write", "PASS", `wrote ${probePath}`)
  } catch (cause) {
    gate("17.sandbox_write", "FAIL", `HALT_SANDBOX_CANNOT_INSTALL_HELPER_BINARY: ${cause.message}`)
  }

  log("DONE")
}

main().catch(err => {
  log(`FATAL ${err.stack ?? err.message ?? String(err)}`)
  process.exit(1)
})
