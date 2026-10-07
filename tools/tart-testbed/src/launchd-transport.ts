// =============================================================================
// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
//
// Real AF_UNIX transport for the launchd-backed Tart testbed runner.
// Speaks the existing clinemm-host-helper protocol v1: one LF-terminated
// JSON frame per connection, method `tart.testbed.run`, request body
// `{ version, request_id, method, spec }`.
//
// The helper itself accepts the semantic testbed intent; we never inject
// arbitrary argv into a request. This transport is the THINNEST possible
// AF_UNIX shim around the helper's wire protocol.
//
// Threading model: one round-trip per call(). Long-running RPCs (clone +
// run + IP poll + SSH + commands + copy + teardown) may take minutes —
// the timeout defaults to 10 minutes. The helper writes the
// response line once when the lifecycle is complete.
//
// SECURITY: this transport does NOT broaden the protocol surface. It only
// emits the `tart.testbed.run` envelope, and the host-helper enforces the
// closed schema + forbidden-key guard on its side.
// =============================================================================

import { createConnection, type Socket } from "node:net";
import { buildTartTestbedRunRequest } from "../../macos-host-helper/client.ts";
import type {
	HostHelperRequest,
	HostHelperResponse,
	HostHelperTransport,
} from "./launchd-backend.ts";

/**
 * Default per-call timeout (ms). The full Tart lifecycle
 * (clone → run → IP → SSH → commands → copy-out → teardown) can take
 * a few minutes on a real macOS guest; we default to 10 minutes to
 * match the existing launchd testbed convention.
 */
export const DEFAULT_LAUNCHD_RPC_TIMEOUT_MS = 10 * 60 * 1000;

export interface LaunchdHostHelperTransportOptions {
	readonly socketPath: string;
	/** Per-call timeout in ms. Default: 10 minutes. */
	readonly timeoutMs?: number;
}

/**
 * The real AF_UNIX transport. Wraps the helper's wire protocol in a
 * single `call()` seam that matches the `HostHelperTransport`
 * interface used by `LaunchdTestbedRunner`.
 */
export class LaunchdHostHelperTransport implements HostHelperTransport {
	readonly socketPath: string;
	readonly timeoutMs: number;

	constructor(opts: LaunchdHostHelperTransportOptions) {
		this.socketPath = opts.socketPath;
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_LAUNCHD_RPC_TIMEOUT_MS;
	}

	/**
	 * Send ONE tart.testbed.run RPC and return the helper's structured
	 * response. The helper owns the entire lifecycle.
	 *
	 * The wrapper translates the helper's wire envelope into the closed
	 * `HostHelperResponse<TResBody>` shape consumed by
	 * `LaunchdTestbedRunner`.
	 */
	async call<TReqBody, TResBody>(
		req: HostHelperRequest<TReqBody>,
	): Promise<HostHelperResponse<TResBody>> {
		if (req.method !== "tart.testbed.run") {
			return { ok: false, error: `METHOD_NOT_ALLOWED: ${req.method}` };
		}
		const helperResp = await sendTestbedRun(
			this.socketPath,
			req.requestId,
			req.body as unknown as Record<string, unknown>,
			this.timeoutMs,
		);
		if (!helperResp.ok) {
			return { ok: false, error: helperResp.error };
		}
		return { ok: true, result: helperResp.result as unknown as TResBody };
	}

	close(): void {
		// No persistent socket state; connection is per-call.
	}
}

// =============================================================================
// Internal wire-protocol helpers — one connection, one frame, one response.
// Matches the same protocol as `tools/macos-host-helper/client.ts` and
// the helper's protocol.ts parse pipeline.
// =============================================================================

async function sendTestbedRun(
	socketPath: string,
	requestId: string,
	spec: Record<string, unknown>,
	timeoutMs: number,
): Promise<HostHelperResponse<unknown>> {
	const sock: Socket = await connectOnce(socketPath, timeoutMs);
	try {
		// Use the typed builder from the helper-client library so the
		// anti-shell forbidden-keys guard applies.
		const frame = buildTartTestbedRunRequest(requestId, spec);
		if (frame.length === 0) {
			return { ok: false, error: "BAD_REQUEST" };
		}
		await writeFrame(sock, frame);
		const responseRaw = await readFrame(sock, timeoutMs);
		let parsed: unknown;
		try {
			parsed = JSON.parse(responseRaw);
		} catch {
			return { ok: false, error: "BAD_REQUEST" };
		}
		if (!isObject(parsed)) {
			return { ok: false, error: "BAD_REQUEST" };
		}
		if ((parsed as { ok?: unknown }).ok === true) {
			const result = (parsed as { result?: unknown }).result;
			if (result === undefined) {
				return { ok: false, error: "BAD_REQUEST" };
			}
			const echoed = (parsed as { request_id?: unknown }).request_id;
			if (typeof echoed !== "string" || echoed !== requestId) {
				throw new Error(
					`helper response request_id mismatch: sent='${requestId}' received='${typeof echoed === "string" ? echoed : "<missing>"}'`,
				);
			}
			return { ok: true, result };
		}
		if ((parsed as { ok?: unknown }).ok === false) {
			const errStr = (parsed as { error?: unknown }).error;
			if (typeof errStr === "string" && errStr.length > 0) {
				return { ok: false, error: errStr };
			}
			return { ok: false, error: "BAD_REQUEST" };
		}
		return { ok: false, error: "BAD_REQUEST" };
	} finally {
		try {
			sock.end();
		} catch {
			/* best-effort */
		}
	}
}

function connectOnce(path: string, timeoutMs: number): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const sock = createConnection(path, () => resolve(sock));
		sock.once("error", (err) => {
			try {
				sock.destroy();
			} catch {
				/* ignore */
			}
			reject(err);
		});
		const connectTimeoutMs = Math.max(5_000, Math.min(timeoutMs, 15_000));
		sock.setTimeout(connectTimeoutMs);
		sock.once("timeout", () => {
			try {
				sock.destroy();
			} catch {
				/* ignore */
			}
			reject(new Error("launchd helper connection timed out"));
		});
	});
}

function writeFrame(sock: Socket, frame: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sock.write(frame + "\n", (err) => {
			if (err !== undefined && err !== null) reject(err);
			else resolve();
		});
	});
}

function readFrame(sock: Socket, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("helper response timeout"));
		}, timeoutMs);
		const onData = (chunk: Buffer): void => {
			buf += chunk.toString("utf8");
			const i = buf.indexOf("\n");
			if (i >= 0) {
				cleanup();
				resolve(buf.slice(0, i));
				sock.end();
			}
		};
		const onError = (err: Error): void => {
			cleanup();
			reject(err);
		};
		const onEnd = (): void => {
			cleanup();
			if (buf.length > 0) resolve(buf);
			else reject(new Error("helper closed before responding"));
		};
		const cleanup = (): void => {
			clearTimeout(timer);
			sock.removeListener("data", onData);
			sock.removeListener("error", onError);
			sock.removeListener("end", onEnd);
		};
		sock.on("data", onData);
		sock.once("error", onError);
		sock.once("end", onEnd);
	});
}

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
