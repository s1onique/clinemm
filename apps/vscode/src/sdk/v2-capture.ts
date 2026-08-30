/**
 * V2 Command-Risk Approval Capture — opt-in JSONL observability.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01-CORRECTION01
 * ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01
 *
 * Observational-only: emits one JSONL record per code point to the path
 * configured by the `CLINEMM_CAPTURE_V2_PATH` environment variable.
 *
 * Contract:
 *   - Parent directory must exist (we do NOT create it).
 *   - Capture file may or may not already exist (append-only writes
 *     create it on first emit if missing — Node `appendFileSync`).
 *
 * Strict invariants (no exceptions):
 *
 *   1. capture disabled        -> zero state-semantic delta
 *   2. capture enabled but fs  -> zero approval-semantic delta
 *      write fails (write/append throws,
 *      EACCES, ENOSPC, ENOENT, etc.)
 *   3. capture throws anywhere -> swallowed at boundary,
 *                                 approval continues unchanged
 *
 * Privacy: we NEVER log the raw shell command, environment, cwd
 * contents, or arbitrary file contents. We log only:
 *
 *   - sha256(command)[0..12]  -> commandDigest
 *   - short ULID              -> correlationId
 *   - enums / boolean states  -> inside `data`
 *   - the canonical extension id, the helper binary basename, the
 *     helper platform, the parser protocol version, the parser parse
 *     status — all bounded, all non-sensitive.
 *
 * Code points (stable string identifiers):
 *
 *   approval.entry.v2                  (request scope)
 *   approval.authorization.v2          (request scope)
 *   extensionRoot.resolve.v2           (PROCESS scope — fires once
 *                                       per helper construction, not
 *                                       per request; carry scope tag,
 *                                       do NOT carry correlation)
 *   parserHelper.acquire-invoke.v2     (request scope; C2_3 collapsed)
 *   parserResult.validate.v2           (request scope; success path)
 *   commandRisk.structured.v2          (request scope)
 *   hostDecision.compose.v2            (request scope)
 *   approval.terminal.v2               (request scope; exactly once)
 *
 *   approval.ui.branch.v2              (request scope; ACT-CLINEMM-
 *                                       APPROVAL-SPECIMEN-CAPTURE-TOOL02
 *                                       fires unconditionally at entry
 *                                       of the manual-ask publishing
 *                                       branch, BEFORE onToolApprovalAsk
 *                                       and BEFORE appendAndEmit. Auto-
 *                                       approved/bypass requests MUST
 *                                       NOT fire this code point — the
 *                                       early `return { approved: true }`
 *                                       exits happen before this line.)
 *   approval.ui.published.v2           (request scope; ACT-CLINEMM-
 *                                       APPROVAL-SPECIMEN-CAPTURE-TOOL02
 *                                       fires only AFTER the ask
 *                                       message has been emitted via
 *                                       messages.appendAndEmit, with
 *                                       the same correlationId +
 *                                       commandDigest inherited from
 *                                       the ambient AsyncLocalStorage
 *                                       context. Tells the operator
 *                                       whether the card row was
 *                                       actually persisted.)
 *
 *   approval.sdk-controller.entry.v2   (request scope; ACT-CLINEMM-
 *                                       SEATBELT-YOLO-APPROVAL-FRICTION-
 *                                       RECON01-CORRECTION01 diagnostic.
 *                                       Fires at the ENTRY of the
 *                                       `evaluateCommandToolApproval`
 *                                       callback returned by
 *                                       `buildSdkControllerEvaluateCommandToolApproval`,
 *                                       BEFORE the isCommandTool early
 *                                       return and BEFORE the await on
 *                                       `resolveHostAuthorization`. Tells
 *                                       the operator whether the
 *                                       SdkController-owned callback was
 *                                       reached at all for this request.)
 *   approval.sdk-controller.authorization.v2
 *                                      (request scope; ACT-CLINEMM-
 *                                       SEATBELT-YOLO-APPROVAL-FRICTION-
 *                                       RECON01-CORRECTION01 diagnostic.
 *                                       Fires immediately AFTER the
 *                                       production `resolveHostAuthorization`
 *                                       closure returns and BEFORE the
 *                                       canonical composer consumes
 *                                       the authorization. Carries
 *                                       `sessionId`, the resolved
 *                                       `hostAuthorization.mode`, the
 *                                       LIVE `resolveExperimentalSandboxMode()`
 *                                       read, `mandatorySeatbelt`, and
 *                                       whether `pathAuthorityEvidence`
 *                                       was supplied — so the operator
 *                                       can distinguish authorization-
 *                                       resolution divergence from
 *                                       downstream composer mutation.
 *                                       Note: `sessionOverride` is
 *                                       intentionally NOT carried —
 *                                       capturing it would require
 *                                       restructuring the host's
 *                                       override seam just for
 *                                       diagnostics, which the per-ACT
 *                                       spec explicitly forbids.)
 *
 *   capture.attach.v1                  (PROCESS scope — fires once
 *                                       per extension-host startup
 *                                       when CLINEMM_CAPTURE_V2_PATH
 *                                       is set; carries
 *                                       runtimeInstanceId +
 *                                       clineVersion + repoHead
 *                                       so the capture tool can
 *                                       independently prove the
 *                                       current runtime is bound to
 *                                       the collector)
 *
 * If the helper returns null we cannot distinguish "binary missing"
 * from "spawn failed" from "validate failed" with the existing public
 * API of MvdanShHelper — and we will NOT add a diagnostic API to
 * `@cline/core` solely for this. The collapsed `acquire-invoke` code
 * point records that ambiguity honestly.
 *
 * ## Request-scope correlation (CORRECTION01)
 *
 * AsyncLocalStorage ties `correlationId` + `commandDigest` to a single
 * async approval request and propagates them through every code point
 * that fires inside `withV2CaptureContext()`. C0 establishes the
 * context; every downstream emitter reads it automatically via
 * `getV2CaptureContext()`. Process-scope events (C1) explicitly pass
 * `scope: "process"` and the emitter will use `"no-request"` for the
 * correlation fields rather than the ambient request context.
 *
 * This is the standard Node pattern for request-scoped state across
 * await boundaries (Node docs: `AsyncLocalStorage`). It avoids the
 * module-global mutable state that would race under overlapping
 * approval requests.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { appendFileSync } from "node:fs"
import { ulid } from "ulid"

const ENV_FLAG = "CLINEMM_CAPTURE_V2_PATH"

interface V2CaptureContext {
	correlationId: string
	commandDigest: string
}

const context = new AsyncLocalStorage<V2CaptureContext>()

let cachedPath: string | null | undefined

function resolveCapturePath(): string | null {
	if (cachedPath !== undefined) {
		return cachedPath
	}
	const raw = process.env[ENV_FLAG]
	if (typeof raw !== "string" || raw.length === 0) {
		cachedPath = null
		return null
	}
	cachedPath = raw
	return raw
}

/**
 * Append a single JSONL record. Never throws.
 *
 * Returns true if a record was emitted, false otherwise (capture
 * disabled, write failed, or path missing). The caller MUST treat
 * this as best-effort telemetry and not change behavior based on the
 * return value.
 */
function safeAppend(path: string, line: string): boolean {
	try {
		appendFileSync(path, line + "\n", { encoding: "utf8" })
		return true
	} catch {
		// Capture disabled / write failed. Do not surface.
		return false
	}
}

/**
 * SHA-256 of the normalized command, first 12 hex chars. Sufficient
 * for correlating records without ever logging the raw command text.
 *
 * Accepts unknown because the host adapter passes the tool input
 * snapshot (which is `unknown` by the type contract). Defensive
 * JSON.stringify; if it throws we record the literal "unhashable".
 */
function shortDigest(toolInput: unknown): string {
	try {
		const text = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput)
		const full = createHash("sha256").update(text).digest("hex")
		return full.slice(0, 12)
	} catch {
		return "unhashable"
	}
}

export interface V2CaptureRecord {
	correlationId: string
	commandDigest: string
	codePoint: string
	scope: "request" | "process"
	data: Record<string, unknown>
}

/**
 * Emit one record. By default reads correlationId + commandDigest
 * from the request-scoped AsyncLocalStorage set by C0. For
 * process-scope events (C1 / extensionRoot.resolve), pass an explicit
 * `scope: "process"` and the emitter will use `"no-request"` for the
 * correlation fields rather than the ambient request context.
 */
export function emitV2Capture(args: {
	codePoint: string
	scope?: "request" | "process"
	correlationId?: string
	commandDigest?: string
	data?: Record<string, unknown>
}): void {
	const path = resolveCapturePath()
	if (path === null) return

	const scope = args.scope ?? "request"
	let correlationId: string
	let commandDigest: string

	if (scope === "process") {
		// Deliberately NOT reading from the request context. C1 is a
		// process-scope event and would corrupt the per-request
		// correlation if it inherited the ambient context.
		correlationId = "no-request"
		commandDigest = "no-input"
	} else {
		const ambient = context.getStore()
		correlationId = args.correlationId ?? ambient?.correlationId ?? "no-correlation"
		commandDigest = args.commandDigest ?? ambient?.commandDigest ?? "no-input"
	}

	const record: V2CaptureRecord = {
		correlationId,
		commandDigest,
		codePoint: args.codePoint,
		scope,
		data: args.data ?? {},
	}

	let line: string
	try {
		line = JSON.stringify(record)
	} catch {
		// Circular references or BigInt are pathological here, but we
		// still must not throw out of the capture path.
		return
	}
	safeAppend(path, line)
}

/**
 * Mint a short correlation id for a single approval request.
 * Independent of any capture-path state so callers can use it even
 * when capture is disabled (no-op then).
 */
export function newV2CorrelationId(): string {
	try {
		return ulid().slice(-10)
	} catch {
		return Math.random().toString(36).slice(2, 12)
	}
}

/**
 * Compute the commandDigest for a given toolInput snapshot. Exposed
 * so all code points for one request share the same digest.
 */
export function v2CommandDigest(toolInput: unknown): string {
	return shortDigest(toolInput)
}

/**
 * Establish the request-scoped capture context for the duration of
 * `fn()`. Every `emitV2Capture({ scope: "request" })` call inside
 * `fn()` (and its async descendants) inherits this context's
 * correlationId + commandDigest automatically.
 *
 * MUST be called at the top of the request entry point (C0) so that
 * the async chain captures the context. The context ends when the
 * promise returned by `fn()` settles.
 */
export function withV2CaptureContext<T>(
	ctx: { correlationId: string; commandDigest: string },
	fn: () => Promise<T> | T,
): Promise<T> | T {
	return context.run(ctx, fn)
}

/**
 * Read the ambient capture context. Returns undefined when called
 * outside any `withV2CaptureContext`. Exposed for tests; production
 * callers should always go through `emitV2Capture` so the defaults
 * stay centralized.
 */
export function getV2CaptureContext(): { correlationId: string; commandDigest: string } | undefined {
	return context.getStore()
}

/**
 * Diagnostic-only. Returns whether capture is wired. Used by tests to
 * skip the assertions when the env flag is unset; never affects
 * production behavior.
 */
export function isV2CaptureEnabled(): boolean {
	return resolveCapturePath() !== null
}

/**
 * Test seam: reset the cached capture path so a test that flips the
 * env var between cases sees the new value. Never call from
 * production code.
 */
export function __resetV2CaptureForTests(): void {
	cachedPath = undefined
}

/**
 * ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01
 *
 * Emit one `capture.attach.v1` record to prove the instrumented
 * runtime path is active in the collector's view. This is the
 * attachment marker the capture tool uses to distinguish
 * "no approval events because no transaction ran" (Z1) from
 * "no approval events because the collector isn't bound to the
 * running extension" (Z3).
 *
 * The function is best-effort and never throws. When the env flag
 * is unset the call is a no-op (DEFAULT_OFF preserved).
 *
 * Carried identity (bounded, non-sensitive):
 *   - runtimeInstanceId   : short ULID, regenerated every call but
 *                           the operator is expected to call this
 *                           at most once per extension-host startup.
 *   - clineVersion        : `clineVersion` from package.json when
 *                           importable, else "UNAVAILABLE".
 *   - repoHead            : output of `git rev-parse HEAD` if a
 *                           `.git` is reachable from
 *                           `process.cwd()`, else "UNAVAILABLE".
 *
 * No command text, no environment, no cwd contents, no API keys.
 */
export function emitCaptureAttach(): void {
	const path = resolveCapturePath()
	if (path === null) return

	let clineVersion = "UNAVAILABLE"
	try {
		// Resolve at call time so a version-bumped package.json is
		// picked up after the next extension-host restart (no
		// build-time baking).
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pkg = require("../../package.json") as { version?: string }
		if (typeof pkg?.version === "string" && pkg.version.length > 0) {
			clineVersion = pkg.version
		}
	} catch {
		clineVersion = "UNAVAILABLE"
	}

	let repoHead = "UNAVAILABLE"
	try {
		// Synchronous exec is acceptable here because this fires
		// at most once per extension-host startup; failure must
		// never propagate.
		const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
		repoHead = execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
			timeout: 1000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
	} catch {
		repoHead = "UNAVAILABLE"
	}

	const record: V2CaptureRecord = {
		correlationId: "no-request",
		commandDigest: "no-input",
		codePoint: "capture.attach.v1",
		scope: "process",
		data: {
			runtimeInstanceId: newV2CorrelationId(),
			clineVersion,
			repoHead,
			emittedAt: new Date().toISOString(),
		},
	}

	let line: string
	try {
		line = JSON.stringify(record)
	} catch {
		return
	}
	safeAppend(path, line)
}
