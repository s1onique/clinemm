/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 *
 * Protocol constants and the parse/dispatch pipeline for the trusted
 * host helper. The ACT exposes EXACTLY ONE method (`health`) over a
 * fixed request envelope (protocol v1). The parser fails closed at
 * every step and rejects any "exec-shaped" payload BEFORE we even
 * look at `method` — that is the structural anti-shell guarantee.
 *
 * Wire format (REQUEST v1):
 *   { "version": 1, "request_id": "...", "method": "health" }
 * Wire format (RESPONSE v1, ok):
 *   { "version": 1, "request_id": "...", "ok": true,
 *     "service": "clinemm-host-helper", "pid": <n>, "uid": <n> }
 * Wire format (RESPONSE v1, error):
 *   { "ok": false, "error": <token> }
 */

export const PROTOCOL_VERSION = 1 as const

/** The ONLY legal method in this ACT. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set<string>(["health"])

/** Maximum accepted request frame, in bytes. */
export const MAX_REQUEST_BYTES = 4096

/**
 * Fields whose presence in a request is treated as "exec-shaped"
 * and causes an immediate fail-closed rejection.
 */
export const FORBIDDEN_REQUEST_KEYS: ReadonlySet<string> = new Set<string>([
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
])

export interface ParsedRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "health"
}

export type ParseError =
	| "BAD_JSON"
	| "UNSUPPORTED_VERSION"
	| "MISSING_REQUEST_ID"
	| "OVERSIZE"
	| "EXEC_SHAPED_PAYLOAD"
	| "WRONG_TYPE"

export interface ParseOk {
	readonly ok: true
	readonly value: ParsedRequest
}
export interface ParseFail {
	readonly ok: false
	readonly error: ParseError
}
export type ParseResult = ParseOk | ParseFail

/**
 * Parse one raw frame string into a {@link ParsedRequest}. Order of
 * checks is load-bearing — first failure wins.
 *
 *   1. length cap (OVERSIZE)
 *   2. JSON.parse (BAD_JSON)
 *   3. typeof === "object" && not array && not null
 *   4. EXEC-shaped payload detection (any forbidden key)
 *   5. exact key set { version, request_id, method }
 *   6. version === 1 (UNSUPPORTED_VERSION)
 *   7. request_id is a non-empty string (MISSING_REQUEST_ID)
 *   8. method is "health" (everything else => WRONG_TYPE)
 */
export function parseRequest(raw: string): ParseResult {
	if (raw.length === 0) return { ok: false, error: "BAD_JSON" }
	if (raw.length > MAX_REQUEST_BYTES) return { ok: false, error: "OVERSIZE" }

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { ok: false, error: "BAD_JSON" }
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	const obj = parsed as Record<string, unknown>

	// (4) EXEC-shaped payload detection — BEFORE we look at anything else.
	for (const k of Object.keys(obj)) {
		if (FORBIDDEN_REQUEST_KEYS.has(k)) {
			return { ok: false, error: "EXEC_SHAPED_PAYLOAD" }
		}
	}

	// (5) Exact key set. Anything extra is treated as a structural shape mismatch.
	const allowedKeys = new Set(["version", "request_id", "method"])
	for (const k of Object.keys(obj)) {
		if (!allowedKeys.has(k)) return { ok: false, error: "WRONG_TYPE" }
	}

	if (obj.version !== PROTOCOL_VERSION) {
		return { ok: false, error: "UNSUPPORTED_VERSION" }
	}

	if (typeof obj.request_id !== "string" || obj.request_id.length === 0) {
		return { ok: false, error: "MISSING_REQUEST_ID" }
	}

	if (typeof obj.method !== "string" || obj.method.length === 0) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	if (!ALLOWED_METHODS.has(obj.method)) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	// Narrow the method to the literal union.
	if (obj.method !== "health") {
		return { ok: false, error: "WRONG_TYPE" }
	}

	return {
		ok: true,
		value: {
			version: 1,
			request_id: obj.request_id,
			method: "health",
		},
	}
}

export const SERVICE_NAME = "clinemm-host-helper" as const

export type ResponseEnvelope =
	| {
			readonly version: 1
			readonly request_id: string
			readonly ok: true
			readonly service: typeof SERVICE_NAME
			readonly pid: number
			readonly uid: number
	  }
	| {
			readonly ok: false
			readonly error: string
	  }

export function buildOkResponse(
	requestId: string,
	pidNum: number,
	uidNum: number,
): ResponseEnvelope {
	return {
		version: 1,
		request_id: requestId,
		ok: true,
		service: SERVICE_NAME,
		pid: pidNum,
		uid: uidNum,
	}
}

/** Map an internal ParseError to the wire-level `error` token. */
export function errorCodeFor(parseError: ParseError): string {
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
			// Generic token: don't teach adversaries what tripped.
			return "BAD_REQUEST"
		case "WRONG_TYPE":
			return "METHOD_NOT_ALLOWED"
	}
}

export function buildErrorResponse(error: string): ResponseEnvelope {
	return { ok: false, error }
}

/**
 * Dispatch a parsed request to a handler. The ACT exposes only
 * `health`; structured so successor ACTs can add methods without
 * touching the parser or wire format.
 */
export function dispatch(
	parsed: ParsedRequest,
	pidNum: number,
	uidNum: number,
): ResponseEnvelope {
	switch (parsed.method) {
		case "health":
			return buildOkResponse(parsed.request_id, pidNum, uidNum)
	}
}

