/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 *
 * Adversarial conservation tests for the trusted host helper.
 * Uses bun:test (no vitest, no @vscode host).
 *
 * Run via:
 *   bun test tools/macos-host-helper/server.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createConnection, type Socket } from "node:net"

import {
	ALLOWED_METHODS,
	buildErrorResponse,
	buildOkResponse,
	dispatch,
	errorCodeFor,
	FORBIDDEN_REQUEST_KEYS,
	MAX_REQUEST_BYTES,
	METHOD_REQUIRED_KEYS,
	parseRequest,
	type ParsedRequest,
	type ResponseEnvelope,
} from "./protocol.ts"
import { createHelperServer } from "./server.ts"

// =============================================================================
// Pure-function protocol tests
// =============================================================================

describe("ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01 protocol", () => {
	it("parses a valid health request", () => {
		const r = parseRequest(
			JSON.stringify({ version: 1, request_id: "abc-123", method: "health" }),
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value.version).toBe(1)
			expect(r.value.request_id).toBe("abc-123")
			expect(r.value.method).toBe("health")
		}
	})

	it("rejects malformed JSON with BAD_JSON", () => {
		const r = parseRequest("{not json")
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("BAD_JSON")
	})

	it("rejects empty input with BAD_JSON", () => {
		const r = parseRequest("")
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("BAD_JSON")
	})

	it("rejects non-object JSON (array) with WRONG_TYPE", () => {
		const r = parseRequest(JSON.stringify([1, 2, 3]))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("WRONG_TYPE")
	})

	it("rejects null JSON with WRONG_TYPE", () => {
		const r = parseRequest("null")
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("WRONG_TYPE")
	})

	it("rejects unsupported protocol version with UNSUPPORTED_VERSION", () => {
		const r = parseRequest(
			JSON.stringify({ version: 2, request_id: "x", method: "health" }),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("UNSUPPORTED_VERSION")
	})

	it("rejects missing request_id with MISSING_REQUEST_ID", () => {
		const r = parseRequest(JSON.stringify({ version: 1, method: "health" }))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("MISSING_REQUEST_ID")
	})

	it("rejects empty-string request_id with MISSING_REQUEST_ID", () => {
		const r = parseRequest(
			JSON.stringify({ version: 1, request_id: "", method: "health" }),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("MISSING_REQUEST_ID")
	})

	it("rejects wrong-type request_id with MISSING_REQUEST_ID", () => {
		const r = parseRequest(
			JSON.stringify({ version: 1, request_id: 42, method: "health" }),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("MISSING_REQUEST_ID")
	})

	it("rejects unknown method with WRONG_TYPE (-> METHOD_NOT_ALLOWED)", () => {
		const r = parseRequest(
			JSON.stringify({ version: 1, request_id: "x", method: "exec" }),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("WRONG_TYPE")
		expect(errorCodeFor(r.error)).toBe("METHOD_NOT_ALLOWED")
	})

	it("rejects extra/unknown keys with WRONG_TYPE/UNKNOWN_FIELD", () => {
		// PROBE01: the parser distinguishes WRONG_TYPE (bad method /
		// bad version / non-object) from UNKNOWN_FIELD (extra key not
		// on the per-method allow-list). Both map to BAD_REQUEST on
		// the wire; the test accepts either internal classification.
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "health",
				unexpected: true,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(["WRONG_TYPE", "UNKNOWN_FIELD"]).toContain(r.error)
	})

	it.each([
		"command",
		"argv",
		"shell",
		"exec",
		"script",
		"spawn",
		"cmd",
		"cmdline",
		"path",
		"file",
	])("rejects exec-shaped payload via key '%s'", (k) => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "health",
				[k]: "rm -rf /",
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.error).toBe("EXEC_SHAPED_PAYLOAD")
			// Wire-level rejection is intentionally generic.
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects oversize request (frame > MAX_REQUEST_BYTES) with OVERSIZE", () => {
		const big = "x".repeat(MAX_REQUEST_BYTES + 1)
		const r = parseRequest(big)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe("OVERSIZE")
	})

	it("accepts a frame at exactly the size cap", () => {
		const padding = "x".repeat(100)
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: padding,
				method: "health",
			}),
		)
		expect(r.ok).toBe(true)
	})
})

// =============================================================================
// Dispatcher tests (handler-level, not over the wire)
// =============================================================================

describe("dispatch", () => {
	it("health returns the fixed ok envelope shape", () => {
		const parsed: ParsedRequest = {
			version: 1,
			request_id: "corr-1",
			method: "health",
		}
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: the
		// ok envelope now also carries build_id,
		// active_client_count, and active_job_count so the operator
		// can prove a NEW generation started.
		const env = dispatch(parsed, 1234, 501, "build-id-test", 0, 0)
		expect(env).toEqual({
			version: 1,
			request_id: "corr-1",
			ok: true,
			service: "clinemm-host-helper",
			pid: 1234,
			uid: 501,
			build_id: "build-id-test",
			active_client_count: 0,
			active_job_count: 0,
		})
	})
})

describe("envelope builders", () => {
	it("buildOkResponse echoes request_id and uses literal service name", () => {
		const env = buildOkResponse("abc", 7, 8)
		if (env.ok) {
			expect(env.service).toBe("clinemm-host-helper")
			expect(env.request_id).toBe("abc")
			expect(env.pid).toBe(7)
			expect(env.uid).toBe(8)
		} else {
			throw new Error("expected ok envelope")
		}
	})
	it("buildErrorResponse is minimal and lacks sensitive fields", () => {
		const env: ResponseEnvelope = buildErrorResponse("METHOD_NOT_ALLOWED")
		expect(env).toEqual({ ok: false, error: "METHOD_NOT_ALLOWED" })
		const keys = Object.keys(env)
		expect(keys).toEqual(["ok", "error"])
	})
})

// =============================================================================
// End-to-end AF_UNIX server tests
// =============================================================================

interface ProbeResult {
	readonly response: ResponseEnvelope
	readonly raw: string
}

function probe(
	socketPath: string,
	body: object | string,
	timeoutMs = 5_000,
): Promise<ProbeResult> {
	const raw = typeof body === "string" ? body : JSON.stringify(body) + "\n"
	return new Promise<ProbeResult>((resolve, reject) => {
		const sock: Socket = createConnection(socketPath, () => {
			sock.write(raw)
		})
		let buf = ""
		const finish = (err: Error | null, value?: ProbeResult): void => {
			sock.removeAllListeners()
			if (err) reject(err)
			else resolve(value as ProbeResult)
		}
		sock.setTimeout(timeoutMs)
		sock.once("timeout", () => finish(new Error(`probe timeout`)))
		sock.once("error", (err) => finish(err))
		sock.on("data", (chunk: Buffer) => {
			buf += chunk.toString("utf8")
			const nlIdx = buf.indexOf("\n")
			if (nlIdx >= 0) {
				const slice = buf.slice(0, nlIdx)
				try {
					const parsed = JSON.parse(slice) as ResponseEnvelope
					finish(null, { response: parsed, raw: slice })
				} catch (cause) {
					finish(new Error(`malformed JSON from server: ${(cause as Error).message}`))
				}
			}
		})
		sock.once("end", () => {
			if (buf.length === 0) finish(new Error("server closed before response"))
		})
	})
}

describe("AF_UNIX end-to-end probe", () => {
	let tmpRoot: string
	let socketPath: string
	let handle: { listen: () => void; close: () => Promise<void> }

	beforeEach(async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-act-trusted-host-helper-"))
		socketPath = join(tmpRoot, "helper.sock")
		handle = createHelperServer({ socketPath })
		handle.listen()
		await new Promise((r) => setTimeout(r, 50))
	})

	afterEach(async () => {
		await handle.close()
		try {
			rmSync(tmpRoot, { recursive: true, force: true })
		} catch {
			/* best-effort */
		}
	})

	it("health round-trip succeeds and correlates request_id", async () => {
		const probeResult = await probe(socketPath, {
			version: 1,
			request_id: "end-to-end-corr-1",
			method: "health",
		})
		expect(probeResult.response.ok).toBe(true)
		if (probeResult.response.ok) {
			expect(probeResult.response.request_id).toBe("end-to-end-corr-1")
			expect(probeResult.response.service).toBe("clinemm-host-helper")
			expect(probeResult.response.pid).toBe(process.pid)
			expect(typeof probeResult.response.uid).toBe("number")
			expect(probeResult.response.version).toBe(1)
		}
	})

	it("returns METHOD_NOT_ALLOWED for unknown method", async () => {
		const probeResult = await probe(socketPath, {
			version: 1,
			request_id: "x",
			method: "exec",
		})
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("METHOD_NOT_ALLOWED")
		}
	})

	it("returns BAD_REQUEST for exec-shaped payload (command field)", async () => {
		const probeResult = await probe(socketPath, {
			version: 1,
			request_id: "x",
			method: "health",
			command: "rm -rf /",
		})
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("BAD_REQUEST")
		}
	})

	it("returns BAD_JSON for malformed JSON", async () => {
		// LF-terminated wire frame; the bytes are NOT valid JSON.
		const probeResult = await probe(socketPath, "{not-json\n")
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("BAD_JSON")
		}
	})

	it("returns BAD_REQUEST when the client sends no LF terminator", async () => {
		// Wire format mandates LF-terminated frames. The server's
		// frame reader waits for LF; if the client never sends one
		// and the server's per-connection timeout fires, the server
		// emits BAD_REQUEST (fail-closed).
		const probeResult = await probe(socketPath, "still no terminator", 5_000)
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("BAD_REQUEST")
		}
	})

	it("returns UNSUPPORTED_VERSION for protocol v2", async () => {
		const probeResult = await probe(socketPath, {
			version: 2,
			request_id: "x",
			method: "health",
		})
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("UNSUPPORTED_VERSION")
		}
	})

	it("returns MISSING_REQUEST_ID for missing id", async () => {
		const probeResult = await probe(socketPath, {
			version: 1,
			method: "health",
		})
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("MISSING_REQUEST_ID")
		}
	})

	it("returns OVERSIZE for an oversized LF-terminated frame", async () => {
		// Send a frame of (MAX_REQUEST_BYTES + 1) chars followed by LF.
		// The server's frame reader must reject frames larger than
		// MAX_REQUEST_BYTES BEFORE attempting JSON.parse.
		const big = "x".repeat(MAX_REQUEST_BYTES + 1) + "\n"
		const probeResult = await probe(socketPath, big)
		expect(probeResult.response.ok).toBe(false)
		if (!probeResult.response.ok) {
			expect(probeResult.response.error).toBe("OVERSIZE")
		}
	})
})

// =============================================================================
// PROBE01: tests for the new testbed.run-installed-vsix-smoke method.
// =============================================================================

describe("PROBE01: testbed.run-installed-vsix-smoke protocol", () => {
	const SAMPLE_HEAD = "0123456789abcdef0123456789abcdef01234567"
	const SAMPLE_SHA = "a".repeat(64)
	const SAMPLE_PATH = "/Users/s1onique/dist/clinemm-4.1.16-fa66f7a62.vsix"

	it("accepts a valid testbed envelope", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "testbed-1",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: SAMPLE_PATH,
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value.method).toBe("testbed.run-installed-vsix-smoke")
			expect(r.value.subject_head).toBe(SAMPLE_HEAD)
			expect(r.value.vsix_sha256).toBe(SAMPLE_SHA)
			expect(r.value.vsix_path).toBe(SAMPLE_PATH)
		}
	})

	it("rejects a testbed envelope missing subject_head", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				vsix_path: SAMPLE_PATH,
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with non-hex subject_head", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: "not-hex",
				vsix_path: SAMPLE_PATH,
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with malformed vsix_sha256 (wrong length)", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: SAMPLE_PATH,
				vsix_sha256: "abc",
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with relative vsix_path", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: "relative/path.vsix",
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with vsix_path traversal '..'", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: "/etc/../etc/passwd.vsix",
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with vsix_path missing .vsix ext", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: "/Users/s1onique/dist/clinemm.zip",
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with vsix_path that is /etc/passwd", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: "/etc/passwd",
				vsix_sha256: SAMPLE_SHA,
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("rejects a testbed envelope with extra/unknown keys", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD,
				vsix_path: SAMPLE_PATH,
				vsix_sha256: SAMPLE_SHA,
				command: "rm -rf /",
			}),
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			// `command` is a forbidden key from ACT-01 anti-shell.
			expect(errorCodeFor(r.error)).toBe("BAD_REQUEST")
		}
	})

	it("lower-cases hex fields for canonical downstream use", () => {
		const r = parseRequest(
			JSON.stringify({
				version: 1,
				request_id: "x",
				method: "testbed.run-installed-vsix-smoke",
				subject_head: SAMPLE_HEAD.toUpperCase(),
				vsix_path: SAMPLE_PATH,
				vsix_sha256: SAMPLE_SHA.toUpperCase(),
			}),
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value.subject_head).toBe(SAMPLE_HEAD.toLowerCase())
			expect(r.value.vsix_sha256).toBe(SAMPLE_SHA.toLowerCase())
		}
	})

	it("METHOD_REQUIRED_KEYS exposes the testbed envelope", () => {
		const required = METHOD_REQUIRED_KEYS["testbed.run-installed-vsix-smoke"]
		expect(required).toBeDefined()
		expect(required?.has("subject_head")).toBe(true)
		expect(required?.has("vsix_path")).toBe(true)
		expect(required?.has("vsix_sha256")).toBe(true)
	})

	it("ALLOWED_METHODS includes both methods", () => {
		expect(ALLOWED_METHODS.has("health")).toBe(true)
		expect(ALLOWED_METHODS.has("testbed.run-installed-vsix-smoke")).toBe(true)
	})
})


