/**
 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction02):
 * Production adapter from the C host-helper wire protocol to the
 * opaque `HelperOwnedPgidProvider` consumed by CommandJobManager.
 *
 * The C helper is the trusted side of the AF_UNIX boundary; this
 * file is the seatbelted side. It translates the wire protocol
 * (LF-terminated JSON, version:1, request_id echoed in response)
 * into the `HelperOwnedPgidProvider` interface that
 * `CommandJobManager` consumes. We deliberately do NOT import
 * from `tools/macos-host-helper/client.ts` because that lives
 * outside the `apps/vscode` workspace and would force a tsconfig
 * boundary change. The wire shape is identical; if the protocol
 * drifts, this file's `buildEnvelope` + `verifyRequestId` MUST
 * be updated.
 *
 * Architecture:
 *   C helper (tools/macos-host-helper/native/helper.c)
 *       ^ AF_UNIX (CLINEMM_HOST_HELPER_SOCKET)
 *       |
 *   HelperWireClient (this file, narrow net.Socket wrapper)
 *       ^ typed wire methods (clientOpen, registerOwned, ...)
 *       |
 *   HostHelperPgidProvider (this file, implements
 *                           HelperOwnedPgidProvider)
 *       ^ semantic interface (clientToken / jobToken / outcome)
 *       |
 *   CommandJobManager (apps/vscode/src/sdk/command-job-manager.ts)
 */

import { createConnection, type Socket } from "node:net"

import type { HelperOwnedPgidProvider } from "./command-job-manager"

export interface HelperWireClientOptions {
	socketPath: string
	timeoutMs?: number
}

export interface HelperWireClient {
	clientOpen(): Promise<{ clientToken: string; peerUid: number; peerPid: number }>
	registerOwned(input: { clientToken: string; pgid: number }): Promise<{ jobToken: string }>
	terminateOwned(input: { clientToken: string; jobToken: string }): Promise<"TERMINATED_TERM" | "TERMINATED_KILL">
	releaseOwned(input: { clientToken: string; jobToken: string }): Promise<"RELEASED">
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction03):
	 * reclaim the per-instance client slot. Calls the C helper's
	 * `client.close` method (added in review-correction02). The
	 * helper's `handle_client_close` reclaims the client slot
	 * atomically (secure-zeros token bytes, sets used=0).
	 */
	clientClose(input: { clientToken: string }): Promise<"CLOSED">
	/** Tear down the underlying socket (no-op if already closed). */
	close(): void
}

const FORBIDDEN_KEYS = new Set(["command", "argv", "shell", "exec", "script", "spawn", "cmd", "cmdline", "path", "file"])

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

function buildEnvelope(method: string, requestId: string, fields: Record<string, unknown>): string {
	const env: Record<string, unknown> = {
		version: 1,
		request_id: requestId,
		method,
		...fields,
	}
	checkForbiddenKeys(env)
	return JSON.stringify(env)
}

function generateRequestId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Wire envelope returned by the C helper. All fields are present in
 * every successful response; failed responses carry an `error` string
 * instead of `result`/`client_token`/etc.
 *
 * We use a structural shape (not a discriminated union) because the
 * helper's LF-terminated JSON is parsed with `JSON.parse` and the
 * presence/absence of fields is the discriminator at runtime, not
 * the type system.
 */
export interface HelperResponseEnvelope {
	readonly ok: boolean
	readonly request_id?: string
	readonly error?: string
	readonly result?: string
	readonly client_token?: string
	readonly peer_uid?: number
	readonly peer_pid?: number
	readonly job_token?: string
}

function isHelperResponseEnvelope(value: unknown): value is HelperResponseEnvelope {
	return typeof value === "object" && value !== null
}

function verifyRequestId(env: HelperResponseEnvelope, sent: string): void {
	if (typeof env.request_id !== "string") {
		throw new Error("helper response is missing request_id field (protocol drift)")
	}
	if (env.request_id !== sent) {
		throw new Error(`helper response request_id mismatch: sent='${sent}' received='${env.request_id}'`)
	}
}

export function createHelperWireClient(opts: HelperWireClientOptions): HelperWireClient {
	const timeoutMs = opts.timeoutMs ?? 5000
	let pending: Socket | null = null

	async function roundTrip(frame: string): Promise<HelperResponseEnvelope> {
		return new Promise((resolve, reject) => {
			pending = createConnection(opts.socketPath, () => {
				pending?.write(`${frame}\n`)
			})
			pending.once("error", reject)
			pending.setTimeout(timeoutMs)
			pending.once("timeout", () => reject(new Error("connection timeout")))
			readFrame(pending, timeoutMs)
				.then((line) => {
					try {
						const parsed: unknown = JSON.parse(line)
						if (!isHelperResponseEnvelope(parsed)) {
							reject(new Error("malformed response: not an object"))
							return
						}
						resolve(parsed)
					} catch (cause) {
						reject(new Error(`malformed response: ${(cause as Error).message}`))
					}
				})
				.catch(reject)
		})
	}

	return {
		async clientOpen() {
			const requestId = generateRequestId("co")
			const env = await roundTrip(buildEnvelope("client.open", requestId, {}))
			if (!env.ok) throw new Error(`helper error: ${env.error}`)
			verifyRequestId(env, requestId)
			if (typeof env.client_token !== "string") {
				throw new Error("helper response missing client_token")
			}
			return {
				clientToken: env.client_token,
				peerUid: env.peer_uid ?? 0,
				peerPid: env.peer_pid ?? 0,
			}
		},
		async registerOwned(input) {
			const requestId = generateRequestId("reg")
			const env = await roundTrip(
				buildEnvelope("process-group.register-owned", requestId, {
					client_token: input.clientToken,
					pgid: input.pgid,
				}),
			)
			if (!env.ok) throw new Error(`helper error: ${env.error}`)
			verifyRequestId(env, requestId)
			if (typeof env.job_token !== "string") {
				throw new Error("helper response missing job_token")
			}
			return { jobToken: env.job_token }
		},
		async terminateOwned(input) {
			const requestId = generateRequestId("term")
			const env = await roundTrip(
				buildEnvelope("process-group.terminate-owned", requestId, {
					client_token: input.clientToken,
					job_token: input.jobToken,
				}),
			)
			if (!env.ok) throw new Error(`helper error: ${env.error}`)
			verifyRequestId(env, requestId)
			return env.result as "TERMINATED_TERM" | "TERMINATED_KILL"
		},
		async releaseOwned(input) {
			const requestId = generateRequestId("rel")
			const env = await roundTrip(
				buildEnvelope("process-group.release-owned", requestId, {
					client_token: input.clientToken,
					job_token: input.jobToken,
				}),
			)
			if (!env.ok) throw new Error(`helper error: ${env.error}`)
			verifyRequestId(env, requestId)
			return env.result as "RELEASED"
		},
		async clientClose(input) {
			const requestId = generateRequestId("cc")
			const env = await roundTrip(
				buildEnvelope("client.close", requestId, {
					client_token: input.clientToken,
				}),
			)
			if (!env.ok) throw new Error(`helper error: ${env.error}`)
			verifyRequestId(env, requestId)
			return env.result as "CLOSED"
		},
		close() {
			try {
				pending?.end()
			} catch {
				/* ignore */
			}
			pending = null
		},
	}
}

function extractErrorCode(cause: unknown): string {
	if (cause instanceof Error) {
		const m = cause.message.match(/helper error:\s*([A-Z_]+)/)
		if (m) return m[1]
		return cause.message
	}
	return String(cause)
}

/**
 * HostHelperPgidProvider - implements the opaque
 * `HelperOwnedPgidProvider` interface using a wire client. The
 * token-mapping is the only state this object carries: the wire
 * client handles connection lifecycle; we cache the per-job
 * (clientToken, jobToken) pair so terminate/release can target
 * the right job.
 */
export class HostHelperPgidProvider implements HelperOwnedPgidProvider {
	constructor(private readonly wire: HelperWireClient) {}

	async clientOpen(): Promise<{ clientToken: string }> {
		try {
			const res = await this.wire.clientOpen()
			return { clientToken: res.clientToken }
		} catch {
			throw new Error("METHOD_NOT_AVAILABLE_IN_TS_FALLBACK")
		}
	}

	async registerOwned(input: { clientToken: string; pgid: number }): Promise<{ jobToken: string }> {
		try {
			const res = await this.wire.registerOwned(input)
			return { jobToken: res.jobToken }
		} catch {
			throw new Error("METHOD_NOT_AVAILABLE_IN_TS_FALLBACK")
		}
	}

	async terminateOwned(input: {
		clientToken: string
		jobToken: string
	}): Promise<{ ok: true; outcome: "TERMINATED_TERM" | "TERMINATED_KILL" } | { ok: false; code: string }> {
		try {
			const outcome = await this.wire.terminateOwned(input)
			return { ok: true, outcome }
		} catch (cause) {
			const code = extractErrorCode(cause)
			return { ok: false, code }
		}
	}

	async releaseOwned(_input: { clientToken: string; jobToken: string }): Promise<void> {
		try {
			await this.wire.releaseOwned(_input)
		} catch {
			// Best-effort. The kernel will reap the leader when
			// it exits; release is just bookkeeping.
		}
	}

	async clientClose(clientToken: string): Promise<void> {
		try {
			await this.wire.clientClose({ clientToken })
		} catch {
			// Best-effort. The helper reclaims the slot when the
			// socket closes anyway; clientClose is just the explicit
			// reclaim path that frees the slot immediately.
		}
	}
}

/**
 * Production factory: create a live HostHelperPgidProvider for
 * the LaunchAgent-managed C helper.
 *
 * The socket path is the SINGLE source of truth: the per-user
 * LaunchAgent `io.clinemm.host-helper` exports its AF_UNIX socket
 * via the `Sockets` dict, and the launchd-managed env var
 * `CLINEMM_HOST_HELPER_SOCKET` is set when the helper inherits
 * the activated fd. The Seatbelt backend already canonicalizes +
 * type-checks this same env var before granting the AF_UNIX rule
 * pair (see seatbelt-backend.ts), so the production code can
 * trust it.
 *
 * Returns `undefined` when the env var is unset (non-macOS, or
 * helper not installed). Callers should treat `undefined` as
 * "no fallback available" and pass it as
 * `options.helperOwnedPgidProvider` to CommandJobManager, which
 * then runs the pre-ACT direct-kill path.
 */
export function resolveLiveHelperOwnedPgidProvider(): HelperOwnedPgidProvider | undefined {
	const socketPath = process.env.CLINEMM_HOST_HELPER_SOCKET
	if (typeof socketPath !== "string" || socketPath.length === 0) {
		return undefined
	}
	const wire = createHelperWireClient({ socketPath })
	return new HostHelperPgidProvider(wire)
}

/**
 * Test seam: same as resolveLiveHelperOwnedPgidProvider but
 * takes the socketPath explicitly. Used by integration tests.
 */
export function createLiveHelperOwnedPgidProvider(socketPath: string): HelperOwnedPgidProvider {
	const wire = createHelperWireClient({ socketPath })
	return new HostHelperPgidProvider(wire)
}
