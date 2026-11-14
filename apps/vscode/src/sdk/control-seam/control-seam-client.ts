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

import { CONTROL_SEAM_PROTOCOL_VERSION, type ControlSeamOperationId, type ControlSeamResponse } from "./control-seam-protocol"

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
 */
export function encodeControlSeamRequest(input: { op: ControlSeamOperationId; token: string; sessionId?: string }): string {
	const request: Record<string, unknown> = {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: input.op,
		token: input.token,
	}
	if (input.sessionId !== undefined) {
		request.sessionId = input.sessionId
	}
	return `${JSON.stringify(request)}\n`
}

/**
 * A minimal NDJSON request/response client over a duplex stream.
 *
 * The server answers each request line in order, so responses are
 * matched by arrival order. There is no multiplexing, no batching and
 * no streaming — the protocol does not have those.
 */
export class ControlSeamClient {
	private readonly token: string
	private buffer = ""
	private readonly pending: ((response: ControlSeamResponse) => void)[] = []
	private writer: ((payload: string) => void) | undefined

	constructor(token: string) {
		this.token = token
	}

	/** Provide the byte sink. */
	setWriter(writer: (payload: string) => void): void {
		this.writer = writer
	}

	/** Attach a socket and pump its data into the pending queue. */
	attach(socket: Socket): void {
		socket.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString("utf8")
			let newlineIndex = this.buffer.indexOf("\n")
			while (newlineIndex >= 0) {
				const line = this.buffer.slice(0, newlineIndex)
				this.buffer = this.buffer.slice(newlineIndex + 1)
				const resolver = this.pending.shift()
				if (resolver) {
					try {
						resolver(JSON.parse(line) as ControlSeamResponse)
					} catch {
						resolver({ v: CONTROL_SEAM_PROTOCOL_VERSION, ok: false })
					}
				}
				newlineIndex = this.buffer.indexOf("\n")
			}
		})
	}

	/** Send one request and await its response. */
	request(op: ControlSeamOperationId, sessionId?: string): Promise<ControlSeamResponse> {
		return new Promise<ControlSeamResponse>((resolve) => {
			this.pending.push(resolve)
			this.writer?.(encodeControlSeamRequest({ op, token: this.token, sessionId }))
		})
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
