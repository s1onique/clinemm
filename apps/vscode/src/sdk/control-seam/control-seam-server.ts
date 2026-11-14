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
import { type ControlSeamEnableSource, resolveControlSeamEnablement } from "./control-seam-enablement"
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
		const optInPresent = existsSync(optInPath)
		const resolution =
			this.options.forceEnabled !== undefined
				? {
						enabled: this.options.forceEnabled,
						source: (this.options.forceEnabled ? "env-on" : "default-off") as ControlSeamEnableSource,
					}
				: resolveControlSeamEnablement(env, optInPresent)
		if (!resolution.enabled) {
			Logger.log(`[ControlSeam] disabled (source=${resolution.source}); no listener created`)
			return undefined
		}

		const dirPath = this.options.dirPath ?? resolveControlSeamDir(env)
		const socketPath = this.options.socketPath ?? resolveControlSeamSocketPath(env)
		const tokenPath = this.options.tokenPath ?? resolveControlSeamTokenPath(env)

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
		writeFileSync(tokenPath, `${token}\n`, { mode: CONTROL_SEAM_FILE_MODE })
		chmodSync(tokenPath, CONTROL_SEAM_FILE_MODE)

		// A stale socket file from a previous crashed host would make
		// `listen` fail with EADDRINUSE. Remove it first — we own the
		// private directory, so nothing else can legitimately hold it.
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
		this.handle = { socketPath, tokenPath, token, source: resolution.source }
		Logger.log(`[ControlSeam] listening on ${socketPath} (source=${resolution.source})`)
		return this.handle
	}

	/** The active handle, if the seam is running. */
	get activeHandle(): ControlSeamServerHandle | undefined {
		return this.handle
	}

	/**
	 * Stop the listener and remove every artifact it created.
	 *
	 * Idempotent. Never throws — a cleanup failure must not take the
	 * extension host down with it.
	 */
	async dispose(): Promise<void> {
		if (this.disposed) {
			return
		}
		this.disposed = true
		for (const socket of this.sockets) {
			try {
				socket.destroy()
			} catch {
				// Best effort: a socket that is already gone is fine.
			}
		}
		this.sockets.clear()
		const server = this.server
		this.server = undefined
		this.handle = undefined
		if (server) {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
		const env = this.options.env ?? process.env
		const socketPath = this.options.socketPath ?? resolveControlSeamSocketPath(env)
		const tokenPath = this.options.tokenPath ?? resolveControlSeamTokenPath(env)
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
		Logger.log("[ControlSeam] disposed")
	}

	/**
	 * Handle one client connection.
	 *
	 * The wire is NDJSON: one request object per line, one response
	 * object per line. Every line is authorized independently, so a
	 * client that loses its token mid-stream cannot keep reading.
	 */
	private handleConnection(socket: Socket): void {
		let buffer = ""
		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8")
			let newlineIndex = buffer.indexOf("\n")
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex)
				buffer = buffer.slice(newlineIndex + 1)
				const response = this.handleLine(line)
				socket.write(encodeControlSeamResponse(response))
				newlineIndex = buffer.indexOf("\n")
			}
		})
		socket.on("error", () => {
			// A client that disappears mid-request is not an error the
			// extension host needs to surface.
		})
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
 * Write the explicit opt-in record.
 *
 * The operator (or an installer) calls this to turn the seam on
 * without an environment override. It is deliberately a separate,
 * explicit act: the seam must never be enabled by accident.
 */
export function writeControlSeamOptIn(optInPath: string): void {
	const dir = dirname(optInPath)
	mkdirSync(dir, { recursive: true, mode: CONTROL_SEAM_DIR_MODE })
	chmodSync(dir, CONTROL_SEAM_DIR_MODE)
	writeFileSync(optInPath, `${JSON.stringify({ enabled: true }, null, 2)}\n`, { mode: CONTROL_SEAM_FILE_MODE })
	chmodSync(optInPath, CONTROL_SEAM_FILE_MODE)
}
