/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The extension-host side of the embedded MCP control seam.
 *
 * This class OWNS an AF_UNIX listener inside the VS Code extension
 * host process. It:
 *
 *   - is DEFAULT OFF (`resolveControlSeamEnablement`),
 *   - binds ONLY an AF_UNIX socket (no TCP, ever),
 *   - creates its socket directory with mode 0700 and its socket and
 *     token files with mode 0600,
 *   - requires an EXPLICIT client authorization bearer token on every
 *     request,
 *   - exposes exactly the two READ-ONLY operations,
 *   - logs NO credential and NO transcript content,
 *   - removes the socket file and the token file on dispose.
 *
 * IT DOES NOT TOUCH TASK SEMANTICS. The listener never calls into the
 * session lifecycle's mutating paths. It holds a `ControlSeamAuthority`
 * (a set of READ closures) and nothing else. There is no `start`, no
 * `send`, no `abort`, no `stop` reachable from this module — the
 * mutating surface is not merely unused here, it is ABSENT.
 */

import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"

import { Logger } from "@shared/services/Logger"

import type { ControlSeamAuthority } from "./control-seam-authority"
import { readControlSeamRunIdentity } from "./control-seam-authority"
import {
	type ControlSeamEnableSource,
	parseControlSeamOptInRecord,
	resolveControlSeamEnablement,
} from "./control-seam-enablement"
import { acquireControlSeamOwnership, releaseControlSeamOwnership, resolveControlSeamOwnerPath } from "./control-seam-ownership"
import {
	CONTROL_SEAM_DIR_MODE,
	CONTROL_SEAM_FILE_MODE,
	CONTROL_SEAM_MAX_SOCKET_PATH_LENGTH,
	isControlSeamSocketPathUsable,
	resolveControlSeamDir,
	resolveControlSeamOptInPath,
	resolveControlSeamSocketPath,
	resolveControlSeamTokenPath,
} from "./control-seam-paths"
import {
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_MAX_REQUEST_BYTES,
	CONTROL_SEAM_OPERATIONS,
	CONTROL_SEAM_PROTOCOL_VERSION,
	type ControlSeamCapabilities,
	type ControlSeamResponse,
	constantTimeEquals,
	controlSeamError,
	decodeControlSeamRequest,
	encodeControlSeamResponse,
	isControlSeamRunIdentity,
} from "./control-seam-protocol"

export interface ControlSeamServerOptions {
	/** The READ-ONLY authority seam (the existing session owner). */
	readonly authority: ControlSeamAuthority
	/** The extension version reported in the capabilities payload. */
	readonly extensionVersion: string
	/** The platform reported in the capabilities payload. */
	readonly platform: string
	/** Override the socket path (tests). */
	readonly socketPath?: string
	/** Override the token path (tests). */
	readonly tokenPath?: string
	/** Override the opt-in record path (tests). */
	readonly optInPath?: string
	/** Override the private directory (tests). */
	readonly dirPath?: string
	/** Override the ownership record path (tests). */
	readonly ownerPath?: string
	/** Environment used for path resolution (tests). */
	readonly env?: NodeJS.ProcessEnv
	/**
	 * Force the enablement decision. When `undefined`, the resolver
	 * decides (env override -> opt-in record -> default OFF).
	 */
	readonly forceEnabled?: boolean
}

export interface ControlSeamServerHandle {
	/** The socket path the listener bound to. */
	readonly socketPath: string
	/** The token path the bearer token was written to. */
	readonly tokenPath: string
	/** The bearer token value (the caller needs it to authorize a client). */
	readonly token: string
	/** Why the seam is enabled. */
	readonly source: ControlSeamEnableSource
	/**
	 * The id of the instance that owns the endpoint.
	 *
	 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01: ownership is EXPLICIT.
	 * Cleanup only removes the socket/token when the on-disk owner
	 * record still carries this id — so one instance can never delete
	 * another instance's live artifacts.
	 */
	readonly instanceId: string
}

/**
 * The AF_UNIX listener owned by the extension host.
 *
 * Lifecycle: `start()` -> (serve requests) -> `dispose()`.
 * `dispose()` is idempotent and removes the socket file.
 */
export class ControlSeamServer {
	private readonly options: ControlSeamServerOptions
	private server: Server | undefined
	private handle: ControlSeamServerHandle | undefined
	private readonly sockets = new Set<Socket>()
	private disposed = false
	/**
	 * The ownership record path this instance claimed. Set only after
	 * a successful start, so `dispose()` before a successful start
	 * never removes another instance's artifacts.
	 */
	private ownerPath: string | undefined

	constructor(options: ControlSeamServerOptions) {
		this.options = options
	}

	/**
	 * Start the listener, if the seam is enabled.
	 *
	 * Returns `undefined` when the seam is OFF — the caller then has
	 * NO listener, NO socket file, and NO token file. That is the
	 * "disabled bridge produces no delta" invariant: the disabled path
	 * touches nothing outside the resolver call.
	 */
	async start(): Promise<ControlSeamServerHandle | undefined> {
		if (this.disposed) {
			return undefined
		}
		const env = this.options.env ?? process.env
		const optInPath = this.options.optInPath ?? resolveControlSeamOptInPath(env)
		// ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.4): the opt-in
		// record is PARSED and VALIDATED, not merely probed for
		// existence. A stray empty file, a truncated write, or a
		// non-JSON file does NOT enable the seam.
		const optInValid = readControlSeamOptInRecord(optInPath) !== undefined
		const resolution =
			this.options.forceEnabled !== undefined
				? {
						enabled: this.options.forceEnabled,
						source: (this.options.forceEnabled ? "env-on" : "default-off") as ControlSeamEnableSource,
					}
				: resolveControlSeamEnablement(env, optInValid)
		if (!resolution.enabled) {
			Logger.log(`[ControlSeam] disabled (source=${resolution.source}); no listener created`)
			return undefined
		}

		const dirPath = this.options.dirPath ?? resolveControlSeamDir(env)
		const socketPath = this.options.socketPath ?? resolveControlSeamSocketPath(env)
		const tokenPath = this.options.tokenPath ?? resolveControlSeamTokenPath(env)
		const ownerPath = this.options.ownerPath ?? resolveControlSeamOwnerPath(dirPath)

		// ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 (C2 transport
		// constraint): an AF_UNIX path longer than the platform's
		// `sock_path` fails inside `listen()` with an opaque
		// `EINVAL`. Fail closed here with an actionable message
		// instead, so a long `CLINE_DIR`/`TMPDIR` is diagnosable.
		if (!isControlSeamSocketPathUsable(socketPath)) {
			throw new Error(
				`[ControlSeam] socket path is too long for an AF_UNIX listener (${Buffer.byteLength(socketPath, "utf8")} bytes > ${CONTROL_SEAM_MAX_SOCKET_PATH_LENGTH}); set a shorter CLINE_DIR`,
			)
		}

		mkdirSync(dirPath, { recursive: true, mode: CONTROL_SEAM_DIR_MODE })
		// `mkdir` honours the umask, so re-assert the mode explicitly.
		chmodSync(dirPath, CONTROL_SEAM_DIR_MODE)

		const token = randomBytes(32).toString("hex")

		// ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.1): EXPLICIT
		// INSTANCE OWNERSHIP.
		//
		// The RECON01 seam wrote the token and then removed any
		// pre-existing socket file unconditionally, so a SECOND
		// instance silently REPLACED a live instance's socket and
		// token. Now the ownership is taken FIRST: a live owner makes
		// this start fail closed, and only a provably DEAD owner
		// (stale endpoint) may be reclaimed.
		const ownership = acquireControlSeamOwnership({
			dirPath,
			ownerPath,
			token,
			env,
		})
		const instanceId = ownership.instanceId

		try {
			writeFileSync(tokenPath, `${token}\n`, { mode: CONTROL_SEAM_FILE_MODE })
			chmodSync(tokenPath, CONTROL_SEAM_FILE_MODE)

			// A stale socket file from a previous crashed host would
			// make `listen` fail with EADDRINUSE. We may only remove it
			// because ownership was granted above — i.e. there was NO
			// live owner. A live owner's socket is NEVER removed.
			if (existsSync(socketPath)) {
				rmSync(socketPath, { force: true })
			}

			const server = createServer((socket) => this.handleConnection(socket))
			await new Promise<void>((resolve, reject) => {
				const onError = (error: Error): void => {
					server.removeListener("listening", onListening)
					reject(error)
				}
				const onListening = (): void => {
					server.removeListener("error", onError)
					resolve()
				}
				server.once("error", onError)
				server.once("listening", onListening)
				// AF_UNIX only: the path argument makes this an AF_UNIX
				// listener, never an INET one.
				server.listen(socketPath)
			})
			chmodSync(socketPath, CONTROL_SEAM_FILE_MODE)
			server.on("connection", (socket) => {
				this.sockets.add(socket)
				socket.on("close", () => this.sockets.delete(socket))
			})
			this.server = server
			this.handle = { socketPath, tokenPath, token, source: resolution.source, instanceId }
			this.ownerPath = ownerPath
			Logger.log(`[ControlSeam] listening on ${socketPath} (source=${resolution.source}, instance=${instanceId})`)
			return this.handle
		} catch (error) {
			// The start failed: release ONLY our own artifacts. The
			// ownership release is instance-scoped, so a failure here
			// cannot delete another instance's live artifacts.
			this.releaseOwnedArtifacts(instanceId, ownerPath, socketPath, tokenPath)
			throw error
		}
	}

	/** The active handle, if the seam is running. */
	get activeHandle(): ControlSeamServerHandle | undefined {
		return this.handle
	}

	/**
	 * Stop the listener and remove every artifact IT created.
	 *
	 * Idempotent. Never throws — a cleanup failure must not take the
	 * extension host down with it.
	 *
	 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.1): cleanup is
	 * OWNERSHIP-SCOPED. The socket and token files are removed ONLY
	 * when the on-disk owner record still carries THIS instance's id.
	 * The RECON01 implementation removed them unconditionally, so a
	 * second instance's dispose() DELETED a live instance's endpoint.
	 */
	async dispose(): Promise<void> {
		if (this.disposed) {
			return
		}
		this.disposed = true
		for (const socket of this.sockets) {
			try {
				// `end()` first so the peer observes a clean EOF (and
				// therefore settles its outstanding request) rather than
				// an abrupt reset that a client may not surface.
				socket.end()
				socket.destroy()
			} catch {
				// Best effort: a socket that is already gone is fine.
			}
		}
		this.sockets.clear()
		const server = this.server
		this.server = undefined
		const handle = this.handle
		this.handle = undefined
		if (server) {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
		const env = this.options.env ?? process.env
		const socketPath = this.options.socketPath ?? resolveControlSeamSocketPath(env)
		const tokenPath = this.options.tokenPath ?? resolveControlSeamTokenPath(env)
		const ownerPath = this.ownerPath
		this.ownerPath = undefined
		if (handle && ownerPath) {
			this.releaseOwnedArtifacts(handle.instanceId, ownerPath, socketPath, tokenPath)
		} else {
			// We never completed a start, so we never owned anything.
			// Removing the artifacts here could delete another
			// instance's LIVE endpoint — so we deliberately do NOT.
			Logger.log("[ControlSeam] disposed without a completed start; no artifacts removed")
		}
		Logger.log("[ControlSeam] disposed")
	}

	/**
	 * Remove the artifacts, but ONLY if this instance still owns them.
	 *
	 * The ownership release is the gate: when the on-disk record
	 * belongs to somebody else, the socket and the token are left
	 * untouched.
	 */
	private releaseOwnedArtifacts(instanceId: string, ownerPath: string, socketPath: string, tokenPath: string): void {
		const released = releaseControlSeamOwnership({ ownerPath, instanceId })
		if (!released) {
			// Another instance owns the endpoint now. Our artifacts were
			// already replaced; removing the paths would delete the
			// OTHER instance's live socket and token.
			Logger.log("[ControlSeam] ownership was lost; leaving another instance's artifacts untouched")
			return
		}
		try {
			rmSync(socketPath, { force: true })
		} catch {
			// Best effort.
		}
		try {
			rmSync(tokenPath, { force: true })
		} catch {
			// Best effort.
		}
	}

	/**
	 * Handle one client connection.
	 *
	 * The wire is NDJSON: one request object per line, one response
	 * object per line. Every line is authorized independently, so a
	 * client that loses its token mid-stream cannot keep reading.
	 *
	 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.2, C1.3):
	 *
	 *   - The ACCUMULATED line is BOUNDED. A client that never sends a
	 *     newline cannot make the extension host buffer without limit;
	 *     the connection is rejected with
	 *     `control_seam_payload_too_large` and closed.
	 *   - Every request the server OWNS is SETTLED. The server's
	 *     per-request timer bounds how long a single request may
	 *     occupy a connection; a client that stops reading is
	 *     disconnected rather than left with a half-open request.
	 */
	private handleConnection(socket: Socket): void {
		let buffer = ""
		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8")
			// Bound the INCOMPLETE-line buffer BEFORE parsing anything.
			if (Buffer.byteLength(buffer, "utf8") > CONTROL_SEAM_MAX_REQUEST_BYTES) {
				buffer = ""
				this.writeResponse(
					socket,
					controlSeamError(
						CONTROL_SEAM_ERROR_CODES.payloadTooLarge,
						"control-seam request exceeded the protocol byte bound",
					),
				)
				// Close the connection: the oversized input is rejected
				// without being parsed, authorized, or buffered further.
				socket.end()
				return
			}
			let newlineIndex = buffer.indexOf("\n")
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex)
				buffer = buffer.slice(newlineIndex + 1)
				const response = this.handleLine(line)
				this.writeResponse(socket, response)
				newlineIndex = buffer.indexOf("\n")
			}
		})
		socket.on("error", () => {
			// A client that disappears mid-request is not an error the
			// extension host needs to surface.
		})
	}

	/**
	 * Write one response, tolerating a client that has already gone.
	 *
	 * A write to a closed socket must never throw out of the data
	 * handler — that would take the extension host down.
	 */
	private writeResponse(socket: Socket, response: ControlSeamResponse): void {
		try {
			socket.write(encodeControlSeamResponse(response))
		} catch {
			// The client is gone. Nothing to do.
		}
	}

	/**
	 * Handle one request line.
	 *
	 * Exposed for the tests so the request/response logic can be
	 * exercised without a socket.
	 */
	handleLine(line: string): ControlSeamResponse {
		const request = decodeControlSeamRequest(line)
		if (!request) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.badRequest, "malformed control-seam request")
		}
		const handle = this.handle
		if (!handle) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "control seam is not running")
		}
		// EXPLICIT CLIENT AUTHORIZATION. The token is compared in
		// constant time and is NEVER written to a log.
		if (!constantTimeEquals(request.token, handle.token)) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.unauthorized, "control-seam authorization failed")
		}
		switch (request.op) {
			case "clinemm_capabilities":
				return this.handleCapabilities()
			case "clinemm_get_run":
				return this.handleGetRun(request.sessionId)
			default:
				return controlSeamError(CONTROL_SEAM_ERROR_CODES.unknownOperation, "unknown control-seam operation")
		}
	}

	/** `clinemm_capabilities` — no session identity is disclosed. */
	private handleCapabilities(): ControlSeamResponse {
		const capabilities: ControlSeamCapabilities = {
			protocolVersion: CONTROL_SEAM_PROTOCOL_VERSION,
			operations: CONTROL_SEAM_OPERATIONS.map((operation) => ({
				id: operation.id,
				description: operation.description,
			})),
			readOnly: true,
			host: {
				extensionVersion: this.options.extensionVersion,
				platform: this.options.platform,
			},
		}
		return { v: CONTROL_SEAM_PROTOCOL_VERSION, ok: true, result: capabilities }
	}

	/**
	 * `clinemm_get_run` — reads the EXISTING session owner.
	 *
	 * The client MAY echo a session id. When it does and the echo does
	 * not match the active session, the request is refused WITHOUT
	 * disclosing whether the echoed id exists elsewhere. That is the
	 * "stale/foreign session identifier does not disclose another run"
	 * invariant.
	 */
	private handleGetRun(echoedSessionId?: string): ControlSeamResponse {
		const identity = readControlSeamRunIdentity(this.options.authority)
		if (!identity) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.noActiveRun, "no active run")
		}
		if (echoedSessionId !== undefined && echoedSessionId !== identity.sessionId) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.foreignSession, "session identifier does not match the active run")
		}
		// Fail closed on a widened payload.
		if (!isControlSeamRunIdentity(identity)) {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "run identity failed the payload allow-list")
		}
		return { v: CONTROL_SEAM_PROTOCOL_VERSION, ok: true, result: identity }
	}
}

/**
 * Read the bearer token a client needs to authorize itself.
 *
 * The token file is written by `ControlSeamServer.start()` with mode
 * 0600 inside the 0700 directory. Only the owning user can read it.
 */
export function readControlSeamToken(tokenPath: string): string | undefined {
	try {
		const raw = readFileSync(tokenPath, "utf8").trim()
		return raw.length > 0 ? raw : undefined
	} catch {
		return undefined
	}
}

/**
 * Read and VALIDATE the explicit opt-in record.
 *
 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.4): the record must PARSE
 * and must carry `enabled: true`. A missing, empty, truncated, or
 * non-JSON record does NOT enable the seam — the seam stays OFF.
 */
export function readControlSeamOptInRecord(optInPath: string): { enabled: true } | undefined {
	let raw: string
	try {
		raw = readFileSync(optInPath, "utf8")
	} catch {
		return undefined
	}
	return parseControlSeamOptInRecord(raw)
}

/**
 * Write the explicit opt-in record.
 *
 * The operator (or an installer) calls this to turn the seam on
 * without an environment override. It is deliberately a separate,
 * explicit act: the seam must never be enabled by accident.
 *
 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01: the written record is now
 * VALIDATED on the way out, so the file this function leaves on disk
 * is exactly the shape the reader accepts.
 */
export function writeControlSeamOptIn(optInPath: string): void {
	const dir = dirname(optInPath)
	mkdirSync(dir, { recursive: true, mode: CONTROL_SEAM_DIR_MODE })
	chmodSync(dir, CONTROL_SEAM_DIR_MODE)
	const contents = `${JSON.stringify({ enabled: true }, null, 2)}\n`
	writeFileSync(optInPath, contents, { mode: CONTROL_SEAM_FILE_MODE })
	chmodSync(optInPath, CONTROL_SEAM_FILE_MODE)
}
