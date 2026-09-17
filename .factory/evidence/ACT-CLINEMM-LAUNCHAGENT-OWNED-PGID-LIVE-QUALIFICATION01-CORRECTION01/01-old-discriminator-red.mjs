#!/usr/bin/env bun
/**
 * ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01-CORRECTION01
 *
 * Step 1 (RED): Reproduce the prior §12 cross-client discriminator in
 * isolation and prove it is INVALID.
 *
 * The prior test did:
 *
 *   coA = client.open    (returns client_token = CA)
 *   coB = client.open    (returns client_token = CB)
 *   bTermA = terminate-owned(client_token=CB, job_token=CA)
 *   expect bTermA.ok = false  -> PASS
 *
 * The error returned was DENY_UNKNOWN_JOB. But:
 *
 *   - CA is a CLIENT token (32 hex chars), not a JOB token.
 *   - The helper's job_table is keyed by job_token, not by client_token.
 *   - Therefore "no job with token CA" is the EXPECTED result REGARDLESS
 *     of whether client B is allowed to touch client A's jobs.
 *   - The denial is structurally indistinguishable from ordinary
 *     unknown-job rejection — it does NOT prove cross-client isolation.
 *
 * This step re-runs that flawed call against the LIVE helper and
 * confirms the exact same DENY_UNKNOWN_JOB response, proving the
 * defect is reproducible (not a misinterpretation).
 *
 * Output: durably captured by 01-old-discriminator-red.txt wrapper.
 *
 * Honest label:
 *   OLD_CROSS_CLIENT_DISCRIMINATOR = INVALID
 *   (CA is a client token; denial does not discriminate cross-client
 *    ownership from ordinary unknown-job rejection)
 */

import { existsSync } from "node:fs"
import { createConnection } from "node:net"

const HELPER_SOCKET = process.env.CLINEMM_HOST_HELPER_SOCKET ?? "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"

if (!existsSync(HELPER_SOCKET)) {
  console.error(`FATAL helper socket missing: ${HELPER_SOCKET}`)
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

async function main() {
  const reqid = (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Step A: open two clients (the prior shape — same process, two sockets).
  const coA = await helperRoundTrip({ version: 1, request_id: reqid("coA"), method: "client.open" })
  const coB = await helperRoundTrip({ version: 1, request_id: reqid("coB"), method: "client.open" })

  console.log(`COA peer_pid=${coA.peer_pid} peer_uid=${coA.peer_uid} client_token_present=${typeof coA.client_token === "string" && coA.client_token.length === 32}`)
  console.log(`COB peer_pid=${coB.peer_pid} peer_uid=${coB.peer_uid} client_token_present=${typeof coB.client_token === "string" && coB.client_token.length === 32}`)
  console.log(`COA_TOKEN_LEN=${coA.client_token.length} COB_TOKEN_LEN=${coB.client_token.length} tokens_distinct=${coA.client_token !== coB.client_token}`)

  // Step B: the FLAWED discriminator — client B uses client A's CLIENT token
  // as if it were a JOB token. The helper MUST return DENY_UNKNOWN_JOB
  // because no job was ever registered under that 32-hex string.
  const bTermA = await helperRoundTrip({
    version: 1,
    request_id: reqid("bTermA"),
    method: "process-group.terminate-owned",
    client_token: coB.client_token,
    job_token: coA.client_token,    // <-- THE DEFECT: client_token in job_token slot
  })

  console.log(`B_USING_A_CLIENT_TOKEN_AS_JOB_TOKEN result=${JSON.stringify(bTermA)}`)

  // Step C: classify. This is the structural analysis, NOT a production
  // failure — the helper is doing exactly what its protocol says.
  const denied = bTermA.ok === false
  const errorIsUnknownJob = denied && typeof bTermA.error === "string" && bTermA.error === "DENY_UNKNOWN_JOB"

  console.log(`DENIED=${denied} error_is_unknown_job=${errorIsUnknownJob}`)
  console.log(`OLD_CROSS_CLIENT_DISCRIMINATOR=INVALID`)
  console.log(`REASON=CA is a client_token, not a job_token; denial does not discriminate cross-client ownership from ordinary unknown-job rejection`)

  // Cleanup.
  await helperRoundTrip({ version: 1, request_id: reqid("ccA"), method: "client.close", client_token: coA.client_token }).catch(() => {})
  await helperRoundTrip({ version: 1, request_id: reqid("ccB"), method: "client.close", client_token: coB.client_token }).catch(() => {})

  console.log(`DONE OLD_DISC=true DISCRIMINATOR_INVALID=true`)
}

main().catch(err => {
  console.error(`FATAL ${err.stack ?? err.message ?? String(err)}`)
  process.exit(1)
})
