/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The CLIENT side of the embedded MCP control seam.
 *
 * This module is transport-agnostic: it speaks the NDJSON control
 * protocol over any duplex byte stream. The two transports are:
 *
 *   - `control-seam-proxy.ts` — a local stdio MCP server (this is what
 *     Codex launches as an MCP stdio server).
 *   - the tests — an in-memory pair.
 *
 * The client reads the bearer token from the token file (0600 inside
 * the 0700 private directory) and attaches it to every request. A
 * client that cannot read the token is unauthorized — the server
 * refuses it.
 */

import { readFileSync } from "node:fs"
import { createConnection, type Socket } from "node:net"

import {
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_MAX_REQUEST_BYTES,
	CONTROL_SEAM_PROTOCOL_VERSION,
	type ControlSeamOperationId,
	type ControlSeamResponse,
	type ControlSeamWritePayload,
	controlSeamError,
} from "./control-seam-protocol"

/**
 * The default per-request timeout, in milliseconds.
 *
 * A control-seam read is a local socket round trip: it should take
 * microseconds. The timeout exists so a LOST request can never leave
 * an unresolved promise behind — not to make slow reads succeed.
 */
export const CONTROL_SEAM_DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/**
 * One outstanding request.
 *
 * `clearTimer` lets the resolver disarm the timeout when the response
 * arrives, so a settled request never leaves a live timer behind.
 */
interface PendingRequest {
	readonly resolve: (response: ControlSeamResponse) => void
	timer: NodeJS.Timeout | undefined
	clearTimer: () => void
}

/**
 * Read the bearer token from disk.
 *
 * Returns `undefined` when the token file is absent or unreadable —
 * which is exactly the "no installed instance" case, and the caller
 * then fails closed.
 */
export function loadControlSeamToken(tokenPath: string): string | undefined {
	try {
		const raw = readFileSync(tokenPath, "utf8").trim()
		return raw.length > 0 ? raw : undefined
	} catch {
		return undefined
	}
}

/**
 * Encode a request envelope as one NDJSON line.
 *
 * The client and the server both build requests through this ONE
 * function so the two ends cannot drift.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the envelope gained the
 * SEPARATE `writeToken` and the operation-specific `payload`. A READ
 * request carries neither, so its wire shape is UNCHANGED.
 */
export function encodeControlSeamRequest(input: {
	op: ControlSeamOperationId
	token: string
	sessionId?: string
	writeToken?: string
	payload?: ControlSeamWritePayload
}): string {
	const request: Record<string, unknown> = {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: input.op,
		token: input.token,
	}
	if (input.sessionId !== undefined) {
		request.sessionId = input.sessionId
	}
	if (input.writeToken !== undefined) {
		request.writeToken = input.writeToken
	}
	if (input.payload !== undefined) {
		request.payload = input.payload
	}
	return `${JSON.stringify(request)}\n`
}

/**
 * A minimal NDJSON request/response client over a duplex stream.
 *
 * The server answers each request line in order, so responses are
 * matched by arrival order. There is no multiplexing, no batching and
 * no streaming — the protocol does not have those.
 *
 * EVERY outstanding request is SETTLED. The RECON01 client pushed a
 * resolver onto `pending` and never removed it unless a response
 * arrived, so a socket close, a transport error, or a server that
 * simply never answered left the promise PERMANENTLY UNRESOLVED — the
 * awaiting caller hung forever, and the proxy's MCP tool call never
 * returned. This client now settles every pending request on:
 *
 *   - a response arriving,
 *   - the socket closing,
 *   - a transport error,
 *   - the per-request timeout elapsing.
 */
export class ControlSeamClient {
	private readonly token: string
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the SEPARATE write
	 * credential. When absent, the client can only issue READ
	 * operations — the server refuses the write operations without a
	 * valid write credential.
	 */
	private readonly writeToken: string | undefined
	private readonly requestTimeoutMs: number
	private buffer = ""
	private readonly pending: PendingRequest[] = []
	private writer: ((payload: string) => void) | undefined
	private disposed = false
	/**
	 * Whether the attached transport is still usable.
	 *
	 * Starts `true` so a writer-only client (no socket) remains
	 * usable; `attach()` flips it to `false` on close/error.
	 */
	private connected = true

	constructor(token: string, options: { readonly requestTimeoutMs?: number; readonly writeToken?: string } = {}) {
		this.token = token
		this.writeToken = options.writeToken
		this.requestTimeoutMs = options.requestTimeoutMs ?? CONTROL_SEAM_DEFAULT_REQUEST_TIMEOUT_MS
	}

	/** Provide the byte sink. */
	setWriter(writer: (payload: string) => void): void {
		this.writer = writer
	}

	/** Attach a socket and pump its data into the pending queue. */
	attach(socket: Socket): void {
		socket.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString("utf8")
			// Bound the INCOMPLETE-line buffer: a peer that never sends
			// a newline must not be able to grow this without limit.
			if (Buffer.byteLength(this.buffer, "utf8") > CONTROL_SEAM_MAX_REQUEST_BYTES) {
				this.buffer = ""
				this.settleAll(
					controlSeamError(
						CONTROL_SEAM_ERROR_CODES.payloadTooLarge,
						"control-seam response exceeded the protocol byte bound",
					),
				)
				socket.destroy()
				return
			}
			let newlineIndex = this.buffer.indexOf("\n")
			while (newlineIndex >= 0) {
				const line = this.buffer.slice(0, newlineIndex)
				this.buffer = this.buffer.slice(newlineIndex + 1)
				const pending = this.pending.shift()
				if (pending) {
					pending.clearTimer()
					try {
						pending.resolve(JSON.parse(line) as ControlSeamResponse)
					} catch {
						pending.resolve({ v: CONTROL_SEAM_PROTOCOL_VERSION, ok: false })
					}
				}
				newlineIndex = this.buffer.indexOf("\n")
			}
		})
		// A close or an error SETTLES every outstanding request. Without
		// this, a client that loses the extension host mid-request waits
		// forever.
		socket.on("close", () => {
			this.connected = false
			this.settleAll(
				controlSeamError(
					CONTROL_SEAM_ERROR_CODES.internal,
					"the control-seam connection closed before a response arrived",
				),
			)
		})
		socket.on("error", () => {
			this.connected = false
			this.settleAll(
				controlSeamError(
					CONTROL_SEAM_ERROR_CODES.internal,
					"the control-seam connection failed before a response arrived",
				),
			)
		})
		// The peer's FIN (a clean half-close) is also a disconnect: the
		// extension host can no longer answer, so the outstanding
		// request must settle now rather than at the timeout.
		socket.on("end", () => {
			this.connected = false
			this.settleAll(
				controlSeamError(
					CONTROL_SEAM_ERROR_CODES.internal,
					"the control-seam connection ended before a response arrived",
				),
			)
		})
	}

	/**
	 * Send one request and await its response.
	 *
	 * If the socket is already gone (closed or failed), the request
	 * settles IMMEDIATELY with an error rather than being enqueued
	 * against a dead transport.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the optional `payload`
	 * carries the WRITE operation's discriminated input. The write
	 * credential is attached automatically when the client holds one.
	 */
	request(op: ControlSeamOperationId, sessionId?: string, payload?: ControlSeamWritePayload): Promise<ControlSeamResponse> {
		if (this.disposed) {
			return Promise.resolve(controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "the control-seam client is closed"))
		}
		if (!this.connected) {
			return Promise.resolve(controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "the control-seam connection is not open"))
		}
		return new Promise<ControlSeamResponse>((resolve) => {
			const pending: PendingRequest = {
				resolve,
				timer: undefined,
				clearTimer: () => {
					if (pending.timer) {
						clearTimeout(pending.timer)
						pending.timer = undefined
					}
				},
			}
			pending.timer = setTimeout(() => {
				const index = this.pending.indexOf(pending)
				if (index >= 0) {
					this.pending.splice(index, 1)
				}
				pending.clearTimer()
				resolve(controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "the control-seam request timed out"))
			}, this.requestTimeoutMs)
			// Never hold the process open for a pending request.
			pending.timer.unref?.()
			this.pending.push(pending)
			this.writer?.(
				encodeControlSeamRequest({
					op,
					token: this.token,
					sessionId,
					...(this.writeToken !== undefined ? { writeToken: this.writeToken } : {}),
					...(payload !== undefined ? { payload } : {}),
				}),
			)
		})
	}

	/**
	 * Close the client and settle every outstanding request.
	 *
	 * Idempotent.
	 */
	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.settleAll(controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "the control-seam client was closed"))
	}

	/** Settle every outstanding request with the same response. */
	private settleAll(response: ControlSeamResponse): void {
		while (this.pending.length > 0) {
			const pending = this.pending.shift()
			if (!pending) {
				break
			}
			pending.clearTimer()
			pending.resolve(response)
		}
	}
}

/**
 * Connect to the extension host's control socket.
 *
 * Returns `undefined` when the socket is absent or the connection is
 * refused — the "no installed instance" case.
 */
export function connectControlSeam(socketPath: string): Promise<Socket | undefined> {
	return new Promise<Socket | undefined>((resolve) => {
		const socket = createConnection(socketPath)
		socket.once("connect", () => resolve(socket))
		socket.once("error", () => resolve(undefined))
	})
}
