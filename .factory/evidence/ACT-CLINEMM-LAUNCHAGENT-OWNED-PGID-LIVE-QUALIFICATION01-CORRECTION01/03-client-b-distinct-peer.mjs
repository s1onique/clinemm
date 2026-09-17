#!/usr/bin/env bun
/**
 * ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01-CORRECTION01
 *
 * Step 3 (CROSS-CLIENT DENY): this is a SEPARATE Bun subprocess
 * so it has a DIFFERENT kernel peer_pid than the main driver.
 *
 * Reads /tmp/clinemm-cross-client-A-<aPid>.json for:
 *   - jobTokenJA (real A-owned job_token)
 *   - peerPidA (so we can prove our peer_pid differs)
 *   - helperSocket path
 *
 * Opens a fresh helper client (slot allocated to OUR peer_pid),
 * then sends process-group.terminate-owned with:
 *   client_token = our fresh CB
 *   job_token    = JA (real, owned by A's different client_token)
 *
 * Expected response: ok=false, error=DENY_FOREIGN_JOB.
 * That is the load-bearing discriminator: the helper compares
 * JA's owner_client_token to the caller-supplied client_token,
 * and since they differ, it refuses.
 */

import { existsSync, readFileSync } from "node:fs"
import { createConnection } from "node:net"

const secretPath = process.argv[2]
if (!secretPath || !existsSync(secretPath)) {
  console.error(JSON.stringify({ ok: false, error: `secret file missing: ${secretPath}` }))
  process.exit(2)
}

const secret = JSON.parse(readFileSync(secretPath, "utf8"))
const HELPER_SOCKET = secret.helperSocket

if (!existsSync(HELPER_SOCKET)) {
  console.error(JSON.stringify({ ok: false, error: `helper socket missing: ${HELPER_SOCKET}` }))
  process.exit(2)
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

const out = {
  step: "client_b_distinct_peer",
  PEER_PID_B: process.pid,
  PEER_PID_A: secret.peerPidA,
}

const reqid = (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Open client B via raw helper socket. Different kernel peer PID
// means the helper allocates a NEW client slot with a NEW client_token.
const coB = await helperRoundTrip({ version: 1, request_id: reqid("coB"), method: "client.open" })
out.client_token_present = typeof coB.client_token === "string" && coB.client_token.length === 32
out.peer_uid_B = coB.peer_uid
out.peer_pid_B_wire = coB.peer_pid
out.peer_pid_match = coB.peer_pid === process.pid
out.token_lengths = 32
out.tokens_distinct_from_a = typeof coB.client_token === "string" && coB.client_token !== secret.clientTokenA
out.peer_pids_differ = process.pid !== secret.peerPidA

// THE LOAD-BEARING DISCRIMINATOR.
// B uses jobTokenJA (a real A-owned job token) with its OWN client_token.
// The helper's resolve_owned_job() compares JA.owner_client_token to
// the caller-supplied client_token; since they differ, it MUST return
// DENY_FOREIGN_JOB. This is the only error code that proves
// foreign-ownership denial (vs. unknown-token rejection).
const bTermA = await helperRoundTrip({
  version: 1,
  request_id: reqid("bTermA"),
  method: "process-group.terminate-owned",
  client_token: coB.client_token,
  job_token: secret.jobTokenJA,
})
out.B_TERMINATE_RESULT = bTermA
out.B_OK = bTermA.ok
out.B_ERROR = bTermA.error ?? null
out.B_USING_A_REAL_JOB_TOKEN = (bTermA.ok === false && bTermA.error === "DENY_FOREIGN_JOB") ? "PASS" : `FAIL result=${JSON.stringify(bTermA)}`

// Close client B explicitly.
await helperRoundTrip({ version: 1, request_id: reqid("ccB"), method: "client.close", client_token: coB.client_token }).catch(() => {})

out.DONE = "B_DENIED"
console.log(JSON.stringify(out))
