// =============================================================================
// clinemm-host-helper — client library for Codium/ClineMM
// =============================================================================
//
// Connects to the per-user LaunchAgent's AF_UNIX endpoint and exchanges
// the protocol v1 envelope. Used by the seatbelted Codium process to
// invoke the trusted helper's only capability (`health`).
//
// This client is the seatbelted SIDE of the boundary. The C helper
// (native/helper.c) is the trusted SIDE. The client NEVER executes
// arbitrary commands — only `health`.
//
// Usage:
//   import { createHealthClient } from "./client"
//   const client = createHealthClient({ socketPath })
//   const env = await client.health({ requestId: "trace-1" })
//   // env = { version, request_id, ok, service, pid, uid }
//
// Wire format: LF-terminated JSON, max 4096 bytes per frame.
//
// PROTOCOL CONSERVATION (CORRECTION02):
//   The wire-level contract from protocol.ts is:
//     Response (ok) = { version: 1, request_id: "<echoed>", ok: true,
//                       service: "clinemm-host-helper", pid: n, uid: n }
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

// 10 forbidden keys — see ACT §13.
const FORBIDDEN_KEYS = new Set([
  "command", "argv", "shell", "exec", "script",
  "spawn", "cmd", "cmdline", "path", "file",
])

export interface HealthResponse {
  version: 1
  // CORRECTION02: restored. The frozen protocol contract requires the
  // server to echo request_id, and the client to verify exact match.
  request_id: string
  ok: true
  service: "clinemm-host-helper"
  pid: number
  uid: number
}

export interface ErrorResponse {
  ok: false
  error: string
}

export type AnyResponse = HealthResponse | ErrorResponse

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

export interface HealthClientOptions {
  socketPath: string
  timeoutMs?: number
}

export interface HealthClient {
  health(opts?: { requestId?: string }): Promise<HealthResponse>
  close(): void
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

export function createHealthClient(opts: HealthClientOptions): HealthClient {
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
      const healthResp = env as HealthResponse
      // CORRECTION02: protocol conservation. The response MUST echo
      // the request_id EXACTLY. If the field is missing or differs,
      // the wire contract has drifted; fail closed.
      if (typeof healthResp.request_id !== "string") {
        throw new MissingRequestIdError()
      }
      if (healthResp.request_id !== requestId) {
        throw new RequestIdMismatchError(requestId, healthResp.request_id)
      }
      return healthResp
    },
    close(): void {
      try { pending?.end() } catch { /* ignore */ }
      pending = null
    },
  }
}
