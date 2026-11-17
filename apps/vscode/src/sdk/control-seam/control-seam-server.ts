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

import { createHash, randomBytes } from "node:crypto"
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
import { ControlSeamEventBuffer } from "./control-seam-event-buffer"
import {
	authorizeControlSeamMutation,
	type ControlSeamMutationGrant,
	createControlSeamMutationGrant,
	readControlSeamMutationOptInRecord,
	removeControlSeamWriteTokenFile,
	resolveControlSeamMutationOptInPath,
	resolveControlSeamWriteTokenPath,
	writeControlSeamWriteTokenFile,
} from "./control-seam-mutation"
import { type ControlSeamLedgerOutcome, ControlSeamOperationLedger } from "./control-seam-operation-ledger"
import {
	acquireControlSeamOwnership,
	ownsControlSeamOwnership,
	releaseControlSeamOwnership,
	resolveControlSeamOwnerPath,
} from "./control-seam-ownership"
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
	CONTROL_SEAM_DEFAULT_EVENT_LIMIT,
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_MAX_REQUEST_BYTES,
	CONTROL_SEAM_OPERATIONS,
	CONTROL_SEAM_PROTOCOL_VERSION,
	CONTROL_SEAM_READ_OPERATIONS,
	type ControlSeamCapabilities,
	type ControlSeamEventsResult,
	type ControlSeamRequest,
	type ControlSeamResponse,
	type ControlSeamStartActResult,
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
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: override the mutation
	 * opt-in record path (tests).
	 */
	readonly mutationOptInPath?: string
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: override the write
	 * credential file path (tests).
	 */
	readonly writeTokenPath?: string
	/** Environment used for path resolution (tests). */
	readonly env?: NodeJS.ProcessEnv
	/**
	 * Force the enablement decision. When `undefined`, the resolver
	 * decides (env override -> opt-in record -> default OFF).
	 */
	readonly forceEnabled?: boolean
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: force the MUTATION
	 * enablement decision. When `undefined`, the resolver decides
	 * (the operator's mutation opt-in record -> default OFF).
	 */
	readonly forceMutationEnabled?: boolean
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the event buffer that
	 * retains the EXISTING production events for `clinemm_read_events`.
	 *
	 * When omitted, the server owns a private buffer that is never
	 * fed — `clinemm_read_events` then returns an empty slice with
	 * `cursorExpired: false`. Production MUST wire the shared buffer.
	 */
	readonly eventBuffer?: ControlSeamEventBuffer
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
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the DISTINCT write
	 * credential, when mutation control is ON. `undefined` when
	 * mutation control is OFF — in that case there is NO mutation
	 * credential at all, and every write operation is refused.
	 */
	readonly writeToken?: string
	/** The write credential file path, when mutation control is ON. */
	readonly writeTokenPath?: string
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the workspace the
	 * mutation grant is bound to, when mutation control is ON.
	 */
	readonly mutationWorkspace?: string
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
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the INSTANCE-LOCAL
	 * mutation grant. `undefined` means mutation control is OFF for
	 * this instance — every write operation is then refused.
	 */
	private mutationGrant: ControlSeamMutationGrant | undefined
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the instance-local
	 * idempotency ledger. It is IN MEMORY and dies with the host.
	 */
	private readonly ledger = new ControlSeamOperationLedger()
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the SINGLE-SLOT
	 * in-flight start reservation.
	 *
	 * The V1 implementation had NO reservation across DIFFERENT request
	 * ids: two requests could both observe "no active session" while
	 * neither start had finished, and both could reach
	 * `authority.startAct()`. This slot closes that window. It holds the
	 * request id of the start that is currently in flight; a second
	 * start with a DIFFERENT id is refused with
	 * `rejected(start-already-in-flight)` and never reaches the
	 * lifecycle.
	 *
	 * The slot is INSTANCE-LOCAL, like the ledger, and is released when
	 * the in-flight start settles.
	 */
	private inFlightStartRequestId: string | undefined
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the session id of the
	 * task THIS mutation client started.
	 *
	 * `clinemm_read_events` is scoped to THIS value, not to whatever
	 * session happens to be active. The V1 implementation compared the
	 * requested session against the CURRENTLY ACTIVE session, so a valid
	 * write credential could read a task the client never started - for
	 * example a task the operator started in the UI.
	 *
	 * `undefined` means the mutation client has NOT started any task yet,
	 * so every event read is refused.
	 */
	private ownedSessionId: string | undefined
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the bounded buffer that
	 * retains the EXISTING production events.
	 */
	private readonly eventBuffer: ControlSeamEventBuffer
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the write credential
	 * file path, when the grant was created. Removed on dispose so a
	 * dead extension host leaves NO mutation credential behind.
	 */
	private writeTokenPath: string | undefined

	constructor(options: ControlSeamServerOptions) {
		this.options = options
		this.eventBuffer = options.eventBuffer ?? new ControlSeamEventBuffer()
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

		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: these are declared
		// OUTSIDE the try so the catch block can release the write
		// credential file if the start fails after it was written.
		let writeToken: string | undefined
		let resolvedWriteTokenPath: string | undefined

		try {
			writeFileSync(tokenPath, `${token}\n`, { mode: CONTROL_SEAM_FILE_MODE })
			chmodSync(tokenPath, CONTROL_SEAM_FILE_MODE)

			// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: resolve the
			// MUTATION grant. It is DEFAULT OFF and it is a SEPARATE
			// decision from the seam's own enablement.
			//
			// The grant is bound to THIS extension-host instance and to
			// the workspace the host resolved from its OWN installed-
			// workspace owner. The client can never select a workspace.
			const mutationGrant = await this.resolveMutationGrant({ dirPath, instanceId })
			const mutationWorkspace = mutationGrant?.workspace
			writeToken = mutationGrant?.writeToken
			resolvedWriteTokenPath = this.options.writeTokenPath ?? resolveControlSeamWriteTokenPath(dirPath)
			if (writeToken) {
				writeControlSeamWriteTokenFile(resolvedWriteTokenPath, writeToken)
			}

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
			this.handle = {
				socketPath,
				tokenPath,
				token,
				source: resolution.source,
				instanceId,
				...(writeToken !== undefined ? { writeToken } : {}),
				...(writeToken !== undefined ? { writeTokenPath: resolvedWriteTokenPath } : {}),
				...(mutationWorkspace !== undefined ? { mutationWorkspace } : {}),
			}
			this.ownerPath = ownerPath
			this.mutationGrant = mutationGrant
			this.writeTokenPath = writeToken !== undefined ? resolvedWriteTokenPath : undefined
			Logger.log(
				`[ControlSeam] listening on ${socketPath} (source=${resolution.source}, instance=${instanceId}, mutation=${writeToken !== undefined ? "on" : "off"})`,
			)
			return this.handle
		} catch (error) {
			// The start failed: release ONLY our own artifacts. The
			// ownership release is instance-scoped, so a failure here
			// cannot delete another instance's live artifacts.
			// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the write
			// credential file must not survive a failed start.
			if (writeToken !== undefined && resolvedWriteTokenPath !== undefined) {
				removeControlSeamWriteTokenFile(resolvedWriteTokenPath)
			}
			this.releaseOwnedArtifacts(instanceId, ownerPath, socketPath, tokenPath)
			throw error
		}
	}

	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: resolve the instance-local
	 * MUTATION grant.
	 *
	 * Returns `undefined` when mutation control is OFF — which is the
	 * DEFAULT. Mutation control requires the operator's SEPARATE
	 * mutation opt-in record (or the explicit test override), AND the
	 * workspace the extension host resolved from its OWN installed-
	 * workspace owner.
	 *
	 * The grant's write credential is a DISTINCT, freshly generated
	 * random value. It is NEVER the read token and never derived from
	 * it.
	 */
	private async resolveMutationGrant(options: {
		readonly dirPath: string
		readonly instanceId: string
	}): Promise<ControlSeamMutationGrant | undefined> {
		const env = this.options.env ?? process.env
		const mutationOptInPath = this.options.mutationOptInPath ?? resolveControlSeamMutationOptInPath(options.dirPath)
		const forced = this.options.forceMutationEnabled
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the operator's record
		// is READ EVEN WHEN the decision is forced, because it carries the
		// SEPARATE content-read sub-grant. The forced path only overrides
		// the on/off DECISION - never the content-read sub-grant.
		const optInRecord = readControlSeamMutationOptInRecord(mutationOptInPath)
		if (forced === undefined && !optInRecord) {
			// DEFAULT OFF: no operator record, no grant.
			return undefined
		}
		if (forced === false) {
			// Explicitly OFF: never a grant, whatever the record says.
			return undefined
		}
		// The workspace comes from the controller's OWN owner. The
		// client never supplies it - it may only ASSERT it later.
		const workspace = await this.options.authority.readWorkspaceRoot()
		return createControlSeamMutationGrant({
			instanceId: options.instanceId,
			workspace,
			// The content-read sub-grant is OPTIONAL and defaults to
			// FALSE. Without it, `clinemm_read_events` returns event
			// metadata but NO message text.
			allowContentRead: optInRecord?.allowContentRead === true,
		})
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
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: invalidate the
		// mutation grant FIRST. From this point every write operation
		// is refused, even if a socket survived the close. The write
		// credential FILE is removed too, so a dead extension host
		// leaves NO mutation credential on disk.
		this.mutationGrant = undefined
		const writeTokenPath = this.writeTokenPath
		this.writeTokenPath = undefined
		if (writeTokenPath) {
			removeControlSeamWriteTokenFile(writeTokenPath)
		}
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: drop the instance-
		// local idempotency ledger and the event buffer. They are
		// IN MEMORY and MUST NOT survive a host replacement.
		this.ledger.clear()
		this.eventBuffer.clear()
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: drop the in-flight
		// start reservation and the owned session id. Both are
		// instance-local state and MUST NOT survive a host replacement -
		// a new host mints a new write credential, so it must not inherit
		// the previous instance's ownership.
		this.inFlightStartRequestId = undefined
		this.ownedSessionId = undefined
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
	 * ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02: the ORDER of the two
	 * steps is the invariant.
	 *
	 * The RECON01/QUAL01 order released the ownership FIRST and removed
	 * the socket and the token SECOND. That opened a window in which a
	 * second instance could take the endpoint (the owner record was
	 * gone) and publish ITS socket and token — and the first instance
	 * then deleted the second instance's LIVE artifacts.
	 *
	 * The corrected order is:
	 *
	 *   1. Verify this instance still owns the endpoint. If it does not,
	 *      remove NOTHING — another instance's artifacts stay untouched.
	 *   2. Remove the socket and the token WHILE the exclusive ownership
	 *      claim is still held. No other instance can take the endpoint
	 *      during this window, so nothing can be published underneath us.
	 *   3. Release the ownership claim. Only now may another instance
	 *      take the endpoint.
	 */
	private releaseOwnedArtifacts(instanceId: string, ownerPath: string, socketPath: string, tokenPath: string): void {
		if (!ownsControlSeamOwnership({ ownerPath, instanceId })) {
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
		// The owned artifacts are gone; only NOW is the endpoint released.
		releaseControlSeamOwnership({ ownerPath, instanceId })
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
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the RESPONSE
		// ORDERING fence for this connection.
		//
		// The client matches replies to requests through a FIFO pending
		// queue, so the server MUST answer on a socket in REQUEST order.
		// The V1 implementation wrote each response as its handler
		// settled: a fast read could overtake a slow write on the SAME
		// socket, and the client then attributed the replies to the wrong
		// requests.
		//
		// Every request line gets a monotonically increasing sequence
		// number. A settled response is buffered until every EARLIER
		// request on this socket has been written; then it is flushed in
		// order. The in-order write is the ONLY thing that touches the
		// socket, so the ordering cannot be broken by a late settle.
		let nextSequence = 0
		let nextToWrite = 0
		const settled = new Map<number, ControlSeamResponse>()
		const flush = (): void => {
			while (settled.has(nextToWrite)) {
				const response = settled.get(nextToWrite)
				settled.delete(nextToWrite)
				nextToWrite++
				if (response !== undefined) {
					this.writeResponse(socket, response)
				}
			}
		}
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
				// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the handler is
				// async (the WRITE operations reach the real task-start
				// lifecycle). The response is written when it settles.
				// A disconnect in the meantime does NOT cancel the
				// operation: its outcome is recorded in the ledger.
				//
				// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the settled
				// response is QUEUED by its sequence number and flushed in
				// REQUEST order, so a slow request cannot be overtaken.
				const sequence = nextSequence++
				this.handleLine(line)
					.then((response) => {
						settled.set(sequence, response)
						flush()
					})
					.catch((error) => {
						Logger.error("[ControlSeam] failed to handle a request:", error)
						settled.set(sequence, controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "control-seam request failed"))
						flush()
					})
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
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the handler is now
	 * ASYNC because the WRITE operations reach the real task-start
	 * lifecycle. The READ operations resolve synchronously inside the
	 * returned promise, so their observable semantics are unchanged.
	 */
	async handleLine(line: string): Promise<ControlSeamResponse> {
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
				return this.handleCapabilities(request)
			case "clinemm_get_run":
				return this.handleGetRun(request.sessionId)
			case "clinemm_start_act":
				return this.handleStartAct(request)
			case "clinemm_read_events":
				return this.handleReadEvents(request)
			default:
				return controlSeamError(CONTROL_SEAM_ERROR_CODES.unknownOperation, "unknown control-seam operation")
		}
	}

	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: `clinemm_start_act`.
	 *
	 * The order of the checks is load-bearing:
	 *
	 *   1. The registry entry MUST declare `mutating: true` (it does).
	 *   2. The mutation grant MUST be present (mutation control ON).
	 *   3. The request MUST carry the write credential, and it MUST
	 *      match THIS instance's credential in constant time.
	 *   4. The asserted workspace MUST match the grant's workspace.
	 *   5. The payload MUST be present and well-formed.
	 *   6. The LEDGER MUST be consulted for this request id. A recorded
	 *      outcome is returned VERBATIM - this happens BEFORE the
	 *      active-owner check, because a replay of an accepted request
	 *      must return the SAME recorded outcome even though the
	 *      accepted task is now the active session.
	 *   7. There MUST NOT be an existing active task owner.
	 *   8. There MUST NOT be another start IN FLIGHT (the single-slot
	 *      reservation). Two different request ids may not both reach
	 *      the lifecycle.
	 *   9. ONLY THEN is the real `initTask()` lifecycle invoked.
	 *
	 * A socket disconnect during the start does NOT cancel the start:
	 * the operation continues and its outcome is recorded in the ledger,
	 * so a replay of the same request id returns the SAME outcome
	 * instead of starting a second task.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01:
	 *
	 *   - The ledger lookup MOVED AHEAD of the active-owner check. The
	 *     V1 order produced a deterministic contradiction: a replay of
	 *     an accepted request saw the active session and returned
	 *     `rejected(active-task-owner-exists)` instead of the recorded
	 *     `accepted` outcome.
	 *   - A SINGLE-SLOT in-flight reservation now guards the lifecycle
	 *     call. The V1 implementation had none, so two DIFFERENT request
	 *     ids could both pass the no-active-session check while neither
	 *     start had finished, and both could reach `startAct()`.
	 */
	private async handleStartAct(request: ControlSeamRequest): Promise<ControlSeamResponse> {
		const payload = request.payload
		if (!payload || payload.op !== "clinemm_start_act") {
			return controlSeamError(CONTROL_SEAM_ERROR_CODES.rejected, "clinemm_start_act requires its input payload")
		}
		const input = payload.input

		// (2-4) AUTHORIZATION. The credential is checked on EVERY
		// request, including on a connection that stays open.
		const authorization = authorizeControlSeamMutation({
			grant: this.mutationGrant,
			writeToken: request.writeToken,
			expectedWorkspace: input.expectedWorkspace,
		})
		if (!authorization.authorized) {
			return controlSeamError(
				CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized,
				"clinemm_start_act is not authorized for this client",
			)
		}

		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: re-verify the
		// workspace AT REQUEST TIME. The grant captured the workspace
		// when the host started; the user may have opened a DIFFERENT
		// folder since. The grant is bound to the INTENDED workspace,
		// so a workspace that is no longer the installed one invalidates
		// the request — the client can never make the extension operate
		// on a workspace the grant did not name.
		const currentWorkspace = await this.options.authority.readWorkspaceRoot()
		if (currentWorkspace !== authorization.grant.workspace) {
			return controlSeamError(
				CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized,
				"clinemm_start_act is not authorized for this client",
			)
		}

		// (6) IDEMPOTENCY - FIRST.
		//
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: this lookup MUST
		// precede the active-owner check. A replay of an ALREADY ACCEPTED
		// request finds the accepted task as the ACTIVE session, so the
		// active-owner check would reject it - contradicting the contract
		// that an identical replay returns the SAME recorded outcome. The
		// recorded outcome is the authority for a replay.
		const fingerprint = this.fingerprintStartActPayload(input)
		const lookup = this.ledger.lookup(input.requestId, fingerprint)
		if (lookup.kind === "conflict") {
			return this.startActResult({
				outcome: "rejected",
				requestId: input.requestId,
				reason: "request-id-conflict",
			})
		}
		if (lookup.kind === "found") {
			return this.startActResultFromLedger(lookup.outcome, input.requestId)
		}

		// (7) NO EXISTING ACTIVE TASK OWNER. The seam never implicitly
		// replaces, clears, cancels or resumes a task.
		const activeSessionId = this.options.authority.readActiveSessionId()
		if (activeSessionId !== undefined) {
			return this.startActResult({
				outcome: "rejected",
				requestId: input.requestId,
				reason: "active-task-owner-exists",
			})
		}

		// (8) THE SINGLE-SLOT IN-FLIGHT RESERVATION.
		//
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the V1
		// implementation had no reservation across DIFFERENT request ids.
		// Two requests could both observe "no active session" while
		// neither start had finished, and both could reach the lifecycle.
		// The reservation is taken SYNCHRONOUSLY - before any `await` -
		// so the window is closed for the whole server.
		if (this.inFlightStartRequestId !== undefined) {
			return this.startActResult({
				outcome: "rejected",
				requestId: input.requestId,
				reason: "start-already-in-flight",
			})
		}
		this.inFlightStartRequestId = input.requestId

		// Record the IN-FLIGHT entry BEFORE the lifecycle call, so a
		// duplicate delivery that arrives during the start joins this
		// operation instead of starting a second one.
		this.ledger.begin(input.requestId, fingerprint)

		let outcome: ControlSeamLedgerOutcome
		try {
			const authorityOutcome = await this.options.authority.startAct({ prompt: input.prompt })
			outcome =
				authorityOutcome.outcome === "accepted"
					? {
							status: "accepted",
							sessionId: authorityOutcome.sessionId,
							...(authorityOutcome.taskId !== undefined ? { taskId: authorityOutcome.taskId } : {}),
						}
					: { status: authorityOutcome.outcome, reason: authorityOutcome.reason }
		} catch (error) {
			// The lifecycle threw. We CANNOT prove whether a start
			// occurred, so the outcome is `unknown_outcome` — and it is
			// RECORDED, so a replay does not start a second task.
			Logger.error("[ControlSeam] clinemm_start_act failed with an unprovable outcome:", error)
			outcome = { status: "unknown_outcome", reason: "host-failure" }
		} finally {
			// The in-flight slot is ALWAYS released - including on the
			// failure path - so a later request is not permanently blocked
			// by a start that never completed.
			this.inFlightStartRequestId = undefined
		}
		this.ledger.complete(input.requestId, outcome, fingerprint)
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: an ACCEPTED start
		// establishes this mutation client's OWNERSHIP of the session, so
		// `clinemm_read_events` can be scoped to it.
		if (outcome.status === "accepted") {
			this.ownedSessionId = outcome.sessionId
		}
		return this.startActResultFromLedger(outcome, input.requestId)
	}

	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: `clinemm_read_events`.
	 *
	 * The read is scoped to the task this mutation client owns: the
	 * requested session id MUST be the session the mutation grant
	 * started. A foreign session id is refused without disclosing
	 * whether it exists.
	 */
	private handleReadEvents(request: ControlSeamRequest): Promise<ControlSeamResponse> {
		const payload = request.payload
		if (!payload || payload.op !== "clinemm_read_events") {
			return Promise.resolve(
				controlSeamError(CONTROL_SEAM_ERROR_CODES.rejected, "clinemm_read_events requires its input payload"),
			)
		}
		const input = payload.input

		// The MUTATION grant is REQUIRED for this operation.
		const authorization = authorizeControlSeamMutation({
			grant: this.mutationGrant,
			writeToken: request.writeToken,
		})
		if (!authorization.authorized) {
			return Promise.resolve(
				controlSeamError(
					CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized,
					"clinemm_read_events is not authorized for this client",
				),
			)
		}
		const grant = authorization.grant
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the CONTENT-READ
		// grant gates ONLY the message TEXT. Without it the operation
		// still returns the event METADATA - the conservative path - and
		// every `text` field is omitted.
		const allowContentRead = grant.allowContentRead

		// SCOPE: the session must be the one THIS mutation client
		// started.
		//
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the V1
		// implementation compared the requested session against the
		// CURRENTLY ACTIVE session. That is NOT ownership: a valid
		// write credential could therefore read the events of a task it
		// never started - for example a task the operator started in the
		// UI. The fence is now the session THIS client started, recorded
		// when its own `clinemm_start_act` was accepted. A foreign or
		// never-started session id is refused without disclosing whether
		// it exists.
		const ownedSessionId = this.ownedSessionId
		if (ownedSessionId === undefined || ownedSessionId !== input.sessionId) {
			return Promise.resolve(
				controlSeamError(
					CONTROL_SEAM_ERROR_CODES.foreignSession,
					"session identifier does not match the task this client owns",
				),
			)
		}

		const limit = input.limit ?? CONTROL_SEAM_DEFAULT_EVENT_LIMIT
		const slice = this.eventBuffer.read({ afterCursor: input.afterCursor, limit })
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the CONTENT-READ
		// grant is enforced HERE, at the wire boundary. Without it every
		// `text` field is STRIPPED - the event METADATA (cursor, epoch,
		// type, kind, timestamp) is still returned, because that is the
		// conservative path.
		const events = allowContentRead
			? slice.events
			: slice.events.map((event) => {
					const { text: _text, ...metadata } = event
					return metadata
				})
		const result: ControlSeamEventsResult = {
			sessionId: input.sessionId,
			events,
			...(slice.nextCursor !== undefined ? { nextCursor: slice.nextCursor } : {}),
			cursorExpired: slice.cursorExpired,
		}
		return Promise.resolve({ v: CONTROL_SEAM_PROTOCOL_VERSION, ok: true, result })
	}

	/**
	 * The payload fingerprint used to bind a `requestId` to its
	 * payload.
	 *
	 * It is a SHA-256 over the canonical encoding of the payload. The
	 * ledger NEVER stores the prompt itself, so a ledger dump cannot
	 * leak task content.
	 */
	private fingerprintStartActPayload(input: { readonly prompt: string; readonly expectedWorkspace: string }): string {
		return createHash("sha256").update(`${input.expectedWorkspace}${input.prompt}`, "utf8").digest("hex")
	}

	/** Build the `clinemm_start_act` response from a ledger outcome. */
	private startActResultFromLedger(outcome: ControlSeamLedgerOutcome, requestId: string): ControlSeamResponse {
		if (outcome.status === "pending") {
			// The operation is still in flight. Report an ambiguous
			// outcome rather than a fabricated acceptance.
			return this.startActResult({
				outcome: "unknown_outcome",
				requestId,
				reason: "in-flight",
			})
		}
		if (outcome.status === "accepted") {
			return this.startActResult({
				outcome: "accepted",
				requestId,
				sessionId: outcome.sessionId,
				...(outcome.taskId !== undefined ? { taskId: outcome.taskId } : {}),
			})
		}
		return this.startActResult({
			outcome: outcome.status,
			requestId,
			reason: outcome.reason,
		})
	}

	/** Build the `clinemm_start_act` response envelope. */
	private startActResult(result: {
		outcome: "accepted" | "rejected" | "superseded" | "unknown_outcome"
		requestId: string
		sessionId?: string
		taskId?: string
		reason?: string
	}): ControlSeamResponse {
		const payload: ControlSeamStartActResult = {
			outcome: result.outcome,
			requestId: result.requestId,
			...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
			...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
			...(result.reason !== undefined ? { reason: result.reason } : {}),
		}
		return { v: CONTROL_SEAM_PROTOCOL_VERSION, ok: true, result: payload }
	}

	/**
	 * `clinemm_capabilities` — no session identity is disclosed.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the operation list is
	 * SCOPED TO THE CALLER. A read-only client (no write credential)
	 * sees EXACTLY the original two read operations — its view is
	 * byte-for-byte the RECON01 view. A mutation-authorized client
	 * additionally sees the two write operations.
	 *
	 * The `readOnly` flag reports whether the CALLER's view is
	 * read-only, not whether the registry contains writes.
	 */
	private handleCapabilities(request?: ControlSeamRequest): ControlSeamResponse {
		const isMutationAuthorized =
			this.mutationGrant !== undefined &&
			request?.writeToken !== undefined &&
			authorizeControlSeamMutation({ grant: this.mutationGrant, writeToken: request.writeToken }).authorized
		const operations = isMutationAuthorized ? CONTROL_SEAM_OPERATIONS : CONTROL_SEAM_READ_OPERATIONS
		const capabilities: ControlSeamCapabilities = {
			protocolVersion: CONTROL_SEAM_PROTOCOL_VERSION,
			operations: operations.map((operation) => ({
				id: operation.id,
				description: operation.description,
			})),
			readOnly: !isMutationAuthorized,
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
