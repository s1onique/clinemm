// =============================================================================
// clinemm-host-helper — client library for Codium/ClineMM
// =============================================================================
//
// Connects to the per-user LaunchAgent's AF_UNIX endpoint and exchanges
// the protocol v1 envelope. Used by the seatbelted Codium process to
// invoke the trusted helper's fixed capabilities.
//
// PROBE01 (ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01) added a
// second fixed capability `testbed.run-installed-vsix-smoke`. Both
// methods share this client; the request envelope is dispatched
// through the same wire protocol.
//
// This client is the seatbelted SIDE of the boundary. The C helper
// (native/helper.c) is the trusted SIDE.
//
// Usage:
//   import { createHelperClient } from "./client"
//   const client = createHelperClient({ socketPath })
//   const env = await client.health({ requestId: "trace-1" })
//   const test = await client.testbedRunInstalledVsixSmoke({
//     requestId: "probe-1",
//     subjectHead: "<40-hex>",
//     vsixPath: "<abs>",
//     vsixSha256: "<64-hex>",
//   })
//
// Wire format: LF-terminated JSON, max 8192 bytes per frame (PROBE01).
//
// PROTOCOL CONSERVATION:
//   The wire-level contract from protocol.ts is:
//     Response (ok) = { version: 1, request_id: "<echoed>", ok: true,
//                       service: "clinemm-host-helper", pid: n, uid: n }
//     Response (testbed ok) = { version: 1, request_id: "<echoed>",
//                               ok: true, "result": {...} }
//   The C helper MUST echo request_id. The client MUST verify the
//   echoed request_id equals the sent request_id. Mismatch fails
//   closed (the protocol has been corrupted in transit).
//
// STRUCTURAL ANTI-SHELL: this client refuses to send a payload that
// carries any of the 10 forbidden keys (command, argv, shell, exec,
// script, spawn, cmd, cmdline, path, file). Defense in depth — the
// server enforces the same invariant.
// =============================================================================

import { createConnection, type Socket } from "node:net"

// 10 forbidden keys — see ACT §13. The client refuses to send these
// at any nesting level; the server enforces the same invariant.
const FORBIDDEN_KEYS = new Set([
  "command", "argv", "shell", "exec", "script",
  "spawn", "cmd", "cmdline", "path", "file",
])

// PROBE01: shape of the testbed.run-installed-vsix-smoke result.
// Captured from the runner's stdout JSON object. Subject to runner
// contract; this is the load-bearing schema.
export interface TestbedRunInstalledVsixSmokeResult {
  subject_head: string
  vsix_sha256: string
  guest_vsix_sha256?: string
  extension_id?: string
  extension_version?: string
  guest_image?: string
  guest_macos_version?: string
  vscode_version?: string
  activation?: "pass" | "fail" | "skip"
  [k: string]: unknown
}

export interface HealthResponse {
  version: 1
  request_id: string
  ok: true
  service: "clinemm-host-helper"
  pid: number
  uid: number
}

export interface TestbedOkResponse {
  version: 1
  request_id: string
  ok: true
  result: TestbedRunInstalledVsixSmokeResult
}

export interface ErrorResponse {
  ok: false
  error: string
}

export type AnyResponse =
  | HealthResponse
  | TestbedOkResponse
  | ErrorResponse

export class RequestIdMismatchError extends Error {
  readonly sent: string
  readonly received: string | undefined
  constructor(sent: string, received: string | undefined) {
    super(
      `helper response request_id mismatch: sent='${sent}' received='${received ?? "<missing>"}'`
    )
    this.name = "RequestIdMismatchError"
    this.sent = sent
    this.received = received
  }
}

export class MissingRequestIdError extends Error {
  constructor() {
    super("helper response is missing request_id field (protocol drift)")
    this.name = "MissingRequestIdError"
  }
}

export interface HelperClientOptions {
  socketPath: string
  timeoutMs?: number
}

export interface HelperClient {
  health(opts?: { requestId?: string }): Promise<HealthResponse>
  testbedRunInstalledVsixSmoke(opts: {
    requestId: string
    subjectHead: string
    vsixPath: string
    vsixSha256: string
  }): Promise<TestbedOkResponse>
  close(): void
}

/**
 * @deprecated Use {@link createHelperClient} instead.
 *
 * PROBE01: this client was renamed to createHelperClient because the
 * fixed capability surface now has two methods (`health` and
 * `testbed.run-installed-vsix-smoke`). The legacy
 * createHealthClient is kept as a thin wrapper for ACT-01
 * backwards-compatibility; new callers should prefer
 * createHelperClient.
 */
export function createHealthClient(opts: HelperClientOptions): HelperClient {
  return createHelperClient(opts)
}

export function createHelperClient(opts: HelperClientOptions): HelperClient {
  const timeoutMs = opts.timeoutMs ?? 5000
  let pending: Socket | null = null

  async function roundTrip(frame: string): Promise<AnyResponse> {
    return new Promise((resolve, reject) => {
      pending = createConnection(opts.socketPath, () => {
        pending?.write(frame + "\n")
      })
      pending.once("error", reject)
      pending.setTimeout(timeoutMs)
      pending.once("timeout", () => reject(new Error("connection timeout")))
      readFrame(pending, timeoutMs)
        .then((line) => {
          try {
            resolve(JSON.parse(line))
          } catch (cause) {
            reject(new Error(`malformed response: ${(cause as Error).message}`))
          }
        })
        .catch(reject)
    })
  }

  return {
    async health(hOpts?: { requestId?: string }): Promise<HealthResponse> {
      const requestId = hOpts?.requestId ?? `health-${Date.now().toString(36)}`
      const env = await roundTrip(buildRequest("health", requestId))
      if (!env.ok) {
        throw new Error(`helper error: ${(env as ErrorResponse).error}`)
      }
      // Both HealthResponse and TestbedOkResponse carry request_id;
      // we discriminate via the `service` field (only HealthResponse
      // has it).
      const anyResp = env as HealthResponse | TestbedOkResponse
      if (typeof (anyResp as { service?: unknown }).service !== "string") {
        throw new Error(`helper returned non-health response for health method`)
      }
      const healthResp = anyResp as HealthResponse
      if (typeof healthResp.request_id !== "string") {
        throw new MissingRequestIdError()
      }
      if (healthResp.request_id !== requestId) {
        throw new RequestIdMismatchError(requestId, healthResp.request_id)
      }
      return healthResp
    },
    async testbedRunInstalledVsixSmoke(tOpts): Promise<TestbedOkResponse> {
      const env = await roundTrip(
        buildTestbedRequest(
          tOpts.requestId,
          tOpts.subjectHead,
          tOpts.vsixPath,
          tOpts.vsixSha256,
        ),
      )
      if (!env.ok) {
        throw new Error(`helper error: ${(env as ErrorResponse).error}`)
      }
      const testbedResp = env as TestbedOkResponse
      if (typeof testbedResp.request_id !== "string") {
        throw new MissingRequestIdError()
      }
      if (testbedResp.request_id !== tOpts.requestId) {
        throw new RequestIdMismatchError(tOpts.requestId, testbedResp.request_id)
      }
      if (typeof testbedResp.result !== "object" || testbedResp.result === null) {
        throw new Error("testbed response missing result object")
      }
      return testbedResp
    },
    close(): void {
      try { pending?.end() } catch { /* ignore */ }
      pending = null
    },
  }
}

function checkForbiddenKeys(obj: unknown, path = ""): void {
  if (obj === null || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      checkForbiddenKeys(obj[i], `${path}[${i}]`)
    }
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error(`forbidden key '${k}' at ${path || "<root>"} (anti-shell)`)
    }
    checkForbiddenKeys(v, path ? `${path}.${k}` : k)
  }
}

function buildRequest(method: "health", requestId: string): string {
  const env: Record<string, unknown> = {
    version: 1,
    request_id: requestId,
    method,
  }
  checkForbiddenKeys(env)
  return JSON.stringify(env)
}

// PROBE01: build a testbed.run-installed-vsix-smoke request envelope.
// All three fields are required; missing/wrong-typed fields are
// rejected by the server. We DO NOT add any forbidden keys.
function buildTestbedRequest(
  requestId: string,
  subjectHead: string,
  vsixPath: string,
  vsixSha256: string,
): string {
  const env: Record<string, unknown> = {
    version: 1,
    request_id: requestId,
    method: "testbed.run-installed-vsix-smoke",
    subject_head: subjectHead,
    vsix_path: vsixPath,
    vsix_sha256: vsixSha256,
  }
  checkForbiddenKeys(env)
  return JSON.stringify(env)
}

function readFrame(sock: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ""
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString("utf8")
      const i = buf.indexOf("\n")
      if (i >= 0) {
        cleanup()
        resolve(buf.slice(0, i))
        sock.end()
      }
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onTimeout = (): void => {
      cleanup()
      reject(new Error("helper response timeout"))
    }
    const onEnd = (): void => {
      cleanup()
      if (buf.length > 0) resolve(buf)
      else reject(new Error("helper closed before responding"))
    }
    const timer = setTimeout(onTimeout, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      sock.removeListener("data", onData)
      sock.removeListener("error", onError)
      sock.removeListener("end", onEnd)
    }
    sock.on("data", onData)
    sock.once("error", onError)
    sock.once("end", onEnd)
  })
}
