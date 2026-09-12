/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 *
 * AF_UNIX server for the trusted host helper. One request, one
 * response, one closed connection. No filesystem I/O, no env reads,
 * no shell, no child processes, no TCP listener.
 *
 * Hard non-goals (deliberate structural absences):
 *   - No `child_process` import.
 *   - No `fs` import (LaunchAgent owns the socket fd via Sockets
 *     dict + launch_activate_socket()).
 *   - No `process.env.*` reads inside the request handler.
 *
 * Run via:
 *   bun tools/macos-host-helper/server.ts
 *   # or with explicit socket path:
 *   CLINEMM_HOST_HELPER_SOCKET=/abs/path/to.sock \
 *     bun tools/macos-host-helper/server.ts
 */

import { createServer, type Socket } from "node:net"

import {
	buildErrorResponse,
	dispatch,
	parseRequest,
	type ParsedRequest,
	type ResponseEnvelope,
} from "./protocol.ts"

const helperPid = process.pid
const helperUid =
	typeof process.getuid === "function" ? process.getuid() : -1

// =============================================================================
// Frame reader — single-shot, LF-terminated
// =============================================================================

function readOneFrame(sock: Socket): Promise<string | null> {
	return new Promise((resolve) => {
		let buf = ""
		let settled = false
		const finish = (value: string | null): void => {
			if (settled) return
			settled = true
			sock.removeListener("data", onData)
			sock.removeListener("error", onError)
			sock.removeListener("end", onEnd)
			sock.removeListener("close", onClose)
			sock.removeListener("timeout", onTimeout)
			resolve(value)
		}
		const onData = (chunk: Buffer): void => {
			if (settled) return
			buf += chunk.toString("utf8")
			const nlIdx = buf.indexOf("\n")
			if (nlIdx >= 0) {
				finish(buf.slice(0, nlIdx))
				return
			}
			if (buf.length > 4096) {
				finish(null)
				return
			}
		}
		const onError = (): void => finish(null)
		const onEnd = (): void => {
			if (buf.length > 0) finish(buf)
			else finish(null)
		}
		const onClose = (): void => finish(null)
		const onTimeout = (): void => finish(null)
		sock.on("data", onData)
		sock.on("error", onError)
		sock.once("end", onEnd)
		sock.once("close", onClose)
		sock.setTimeout(2_000)
		sock.once("timeout", onTimeout)
	})
}

// =============================================================================
// Per-connection lifecycle
// =============================================================================

async function handleConnection(
	sock: Socket,
	log: (line: string) => void,
): Promise<void> {
	let raw: string | null
	try {
		raw = await readOneFrame(sock)
	} catch {
		raw = null
	}

	if (raw === null) {
		writeAndClose(sock, buildErrorResponse("BAD_REQUEST"), log)
		return
	}

	const result = parseRequest(raw)
	if (!result.ok) {
		log(`reject: ${result.error} bytes=${raw.length}`)
		writeAndClose(sock, buildErrorResponse(errorCodePublic(result.error)), log)
		return
	}

	const response = dispatch(result.value, helperPid, helperUid)
	log(
		`ok: method=${result.value.method} request_id=${result.value.request_id}`,
	)
	writeAndClose(sock, response, log)
}

function errorCodePublic(parseError: string): string {
	switch (parseError) {
		case "BAD_JSON":
			return "BAD_JSON"
		case "UNSUPPORTED_VERSION":
			return "UNSUPPORTED_VERSION"
		case "MISSING_REQUEST_ID":
			return "MISSING_REQUEST_ID"
		case "OVERSIZE":
			return "OVERSIZE"
		case "EXEC_SHAPED_PAYLOAD":
			return "BAD_REQUEST"
		case "WRONG_TYPE":
			return "METHOD_NOT_ALLOWED"
		default:
			return "BAD_REQUEST"
	}
}

function writeAndClose(
	sock: Socket,
	env: ResponseEnvelope,
	log: (line: string) => void,
): void {
	const line = `${JSON.stringify(env)}\n`
	try {
		sock.end(line)
	} catch (cause) {
		log(`write_failed: ${(cause as Error).message}`)
		try {
			sock.destroy()
		} catch {
			/* best-effort */
		}
	}
}

// =============================================================================
// Server factory
// =============================================================================

export interface ServerOptions {
	readonly socketPath: string
	/**
	 * When the LaunchAgent launches the helper with the socket in its
	 * Sockets dict, this fd is the listening socket. When defined, we
	 * listen on it instead of binding a new path.
	 */
	readonly activatedFd?: number
	readonly log?: (line: string) => void
}

const logStderr = (line: string): void => {
	process.stderr.write(`[clinemm-host-helper] ${line}\n`)
}

export function createHelperServer(options: ServerOptions): {
	listen(): void
	close(): Promise<void>
} {
	const log = options.log ?? logStderr

	const server = createServer((sock: Socket) => {
		void handleConnection(sock, log)
	})

	const listen = (): void => {
		if (typeof options.activatedFd === "number") {
			;(server as unknown as { listen: (opts: unknown) => void }).listen({
				fd: options.activatedFd,
			})
			return
		}
		server.listen({ path: options.socketPath })
		// The LaunchAgent plist already enforces SockPathMode=0600 via
		// the Sockets dict. When the helper binds the socket itself
		// (test mode, manual `bun server.ts` invocations), Node
		// honours the umask and creates the inode group-readable. We
		// ratchet the mode down explicitly to 0600 so the auth-model
		// invariant (user-only) holds in BOTH paths.
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { chmodSync } = require("node:fs")
			chmodSync(options.socketPath, 0o600)
		} catch {
			/* best-effort: chmod may be denied on some volumes */
		}
	}

	const close = (): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()))
		})

	return { listen, close }
}

// =============================================================================
// Entrypoint
// =============================================================================

function resolveSocketPath(): string {
	const fromEnv = process.env.CLINEMM_HOST_HELPER_SOCKET
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv
	return `${process.env.HOME ?? "/tmp"}/.clinemm/host-helper.sock`
}

async function main(): Promise<void> {
	const socketPath = resolveSocketPath()
	const log: (line: string) => void = (line) =>
		process.stderr.write(`[clinemm-host-helper] ${line}\n`)

	log(`start pid=${helperPid} uid=${helperUid} socket=${socketPath}`)

	const handle = createHelperServer({ socketPath, log })
	handle.listen()

	const shutdown = (): void => {
		log("shutdown: draining")
		void handle
			.close()
			.then(() => process.exit(0))
			.catch((cause) => {
				log(`shutdown error: ${(cause as Error).message}`)
				process.exit(1)
			})
	}
	process.once("SIGTERM", shutdown)
	process.once("SIGINT", shutdown)
}

// Avoid running main() under vitest — the entrypoint guard checks
// that process.argv[1] points at this file.
const argv1 = process.argv[1] ?? ""
if (argv1.endsWith("server.ts") || argv1.endsWith("server.js")) {
	void main()
}

// Re-export for tests / external callers.
export type { ParsedRequest }

