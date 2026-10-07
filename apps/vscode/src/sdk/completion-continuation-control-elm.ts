/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C5 / C12)
 *
 * TypeScript adapter for the completion-continuation-control Elm kernel.
 *
 * Architecture (per ACT §C2 / §C12):
 *
 *     raw host facts (already collected by the host scheduler)
 *       -> buildFactsJson(input)        (semantic Facts JSON)
 *       -> invokeElmKernel(factsJson)   (single Platform.worker port invocation)
 *       -> decodeDirective(...)         (fail-closed decode of `kind: "directive"`)
 *       -> typed ContinuationDirective value
 *
 * C11 private-namespace isolation: mirrors the TaskHeader pattern
 * (`evaluator.call(namespace, namespace)`). NEVER mutates `globalThis.Elm`.
 *
 * The kernel-side asset ID is `runtime-assets/completion-continuation-control.js`
 * (added to `scripts/build_dogfood_vsix_lib.py` `_ELM_KERNELS` in this ACT).
 */

import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// Public typed shape (the contract every caller must respect)
// ---------------------------------------------------------------------------

/**
 * Capability projection produced by the host (TS) -- derives from the
 * actual resumed-turn tool registry per C3:
 *
 *   canObserveHeldResults = "command_status" in tool registry
 *   canRetryCompletion    = "submit_and_exit" in tool registry
 *
 * Tool names stay in TS. The Elm kernel only sees these two flags
 * (closed schema; C4).
 */
export interface ContinuationCapabilities {
	readonly canObserveHeldResults: boolean
	readonly canRetryCompletion: boolean
}

export interface CompletionContinuationControlFactsInput {
	readonly unconsumedCount: number
	readonly capabilities: ContinuationCapabilities
	readonly stalledNoProgress: boolean
	readonly sessionMatches: boolean
	readonly taskMatches: boolean
	readonly alreadyCommitted: boolean
}

/**
 * JSON shape on the wire -- Elm's `Codec.factsDecoder` consumes this
 * verbatim. Closed schema (C10 / C15); no extra fields allowed.
 */
export interface CompletionContinuationControlFactsJson {
	readonly unconsumedCount: number
	readonly observation: { readonly observeHeldResults: boolean; readonly retryCompletion: boolean }
	readonly completion: { readonly observeHeldResults: boolean; readonly retryCompletion: boolean }
	readonly stalledNoProgress: boolean
	readonly sessionMatches: boolean
	readonly taskMatches: boolean
	readonly alreadyCommitted: boolean
}

export type FailureReasonTag =
	| "observation_unavailable"
	| "retry_unavailable"
	| "stalled_no_progress"
	| "session_mismatch"
	| "task_mismatch"
	| "already_committed"
	| "malformed_facts"

export type ContinuationDirective =
	| { readonly completionStatus: "HELD"; readonly requiredAction: "observe_then_submit"; readonly tag: "observe_then_retry" }
	| {
			readonly completionStatus: "READY_TO_RETRY"
			readonly requiredAction: "retry_commission"
			readonly tag: "retry_completion"
	  }
	| { readonly completionStatus: "COMMITTED"; readonly requiredAction: "retry_commission"; readonly tag: "wait_for_host" }
	| {
			readonly completionStatus: "CANNOT_CONTINUE"
			readonly requiredAction: "fail_closed"
			readonly tag: "fail_closed"
			readonly failureReason: FailureReasonTag
	  }

export type CompletionContinuationControlElmDecision =
	| { readonly kind: "directive"; readonly value: ContinuationDirective }
	| {
			readonly kind: "decode_error"
			readonly reason: string
			readonly classification: "completion_continuation_control_elm_decode_error"
	  }
	| { readonly kind: "kernel_offline"; readonly classification: "completion_continuation_control_elm_kernel_offline" }

/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-ELM-PRODUCTION-WIRING:
 * The Elm-kernel invocation signature. Production seam uses the real
 * Elm kernel via `invokeElmKernel`; tests inject sentinels via this
 * seam for the C4/C7/C8 ablation.
 */
export type CompletionContinuationControlElmKernelInvoke = (
	factsJson: CompletionContinuationControlFactsJson,
) => Promise<CompletionContinuationControlElmDecision>

// ---------------------------------------------------------------------------
// Facts construction (pure; C9 -- no identity, no tool names, no role)
// ---------------------------------------------------------------------------

export function buildFactsJson(input: CompletionContinuationControlFactsInput): CompletionContinuationControlFactsJson {
	return {
		unconsumedCount: input.unconsumedCount,
		observation: {
			observeHeldResults: input.capabilities.canObserveHeldResults,
			retryCompletion: input.capabilities.canRetryCompletion,
		},
		completion: {
			observeHeldResults: input.capabilities.canObserveHeldResults,
			retryCompletion: input.capabilities.canRetryCompletion,
		},
		stalledNoProgress: input.stalledNoProgress,
		sessionMatches: input.sessionMatches,
		taskMatches: input.taskMatches,
		alreadyCommitted: input.alreadyCommitted,
	}
}

// ---------------------------------------------------------------------------
// Decoder (fail-closed; C13 / C15)
// ---------------------------------------------------------------------------

const DIRECTIVE_TAGS = new Set(["observe_then_retry", "retry_completion", "wait_for_host", "fail_closed"])
const FAILURE_REASONS: ReadonlySet<FailureReasonTag> = new Set([
	"observation_unavailable",
	"retry_unavailable",
	"stalled_no_progress",
	"session_mismatch",
	"task_mismatch",
	"already_committed",
	"malformed_facts",
])

export function decodeDirective(msg: unknown): CompletionContinuationControlElmDecision {
	if (typeof msg !== "object" || msg === null) {
		return {
			kind: "decode_error",
			reason: `expected object, got ${typeof msg}`,
			classification: "completion_continuation_control_elm_decode_error",
		}
	}
	const rec = msg as Record<string, unknown>
	switch (rec.kind) {
		case "ready":
			return {
				kind: "decode_error",
				reason: "kernel emitted `ready` (no directive payload)",
				classification: "completion_continuation_control_elm_decode_error",
			}
		case "directive": {
			const d = rec.directive
			if (typeof d !== "object" || d === null) {
				return {
					kind: "decode_error",
					reason: "directive payload missing or non-object",
					classification: "completion_continuation_control_elm_decode_error",
				}
			}
			const dr = d as Record<string, unknown>
			const tag = dr.tag
			if (typeof tag !== "string" || !DIRECTIVE_TAGS.has(tag)) {
				return {
					kind: "decode_error",
					reason: `unknown directive tag: ${String(tag)}`,
					classification: "completion_continuation_control_elm_decode_error",
				}
			}
			if (tag === "observe_then_retry") {
				return {
					kind: "directive",
					value: { completionStatus: "HELD", requiredAction: "observe_then_submit", tag: "observe_then_retry" },
				}
			}
			if (tag === "retry_completion") {
				return {
					kind: "directive",
					value: {
						completionStatus: "READY_TO_RETRY",
						requiredAction: "retry_commission",
						tag: "retry_completion",
					},
				}
			}
			if (tag === "wait_for_host") {
				return {
					kind: "directive",
					value: {
						completionStatus: "COMMITTED",
						requiredAction: "retry_commission",
						tag: "wait_for_host",
					},
				}
			}
			const reason = dr.reason
			if (typeof reason !== "string" || !FAILURE_REASONS.has(reason as FailureReasonTag)) {
				return {
					kind: "decode_error",
					reason: `missing or unknown fail_closed reason: ${String(reason)}`,
					classification: "completion_continuation_control_elm_decode_error",
				}
			}
			return {
				kind: "directive",
				value: {
					completionStatus: "CANNOT_CONTINUE",
					requiredAction: "fail_closed",
					tag: "fail_closed",
					failureReason: reason as FailureReasonTag,
				},
			}
		}
		case "decode_error":
			return {
				kind: "decode_error",
				reason: typeof rec.error === "string" ? rec.error : "kernel decode_error (no message)",
				classification: "completion_continuation_control_elm_decode_error",
			}
		default:
			return {
				kind: "decode_error",
				reason: `unknown outbound kind: ${String(rec.kind)}`,
				classification: "completion_continuation_control_elm_decode_error",
			}
	}
}

// ---------------------------------------------------------------------------
// Loader + production path wiring (C11 / C27)
// ---------------------------------------------------------------------------

export interface CompiledElmKernel {
	sendInbound(value: unknown): void
	recvOutbound(): unknown
}

let cachedKernel: CompiledElmKernel | null = null
let _kernelNamespace: Record<string, unknown> | null = null
let _kernelEvaluatedOnce = false
let _productionKernelPath: string | null = null

export const COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID = "runtime-assets/completion-continuation-control.js" as const

export function defaultElmKernelPath(): string {
	const url = new URL("../../elm/completion-continuation-control/vendor/completion-continuation-control.js", import.meta.url)
	return url.pathname
}

export function setCompletionContinuationControlElmProductionKernelPath(path: string | null): void {
	_productionKernelPath = path
}

export function getCompletionContinuationControlElmProductionKernelPath(): string | null {
	return _productionKernelPath
}

export function resolveProductionKernelPath(): string {
	if (typeof _productionKernelPath === "string" && _productionKernelPath.length > 0) {
		return _productionKernelPath
	}
	return defaultElmKernelPath()
}

export type CompletionContinuationControlElmKernelStage =
	| "not_attempted"
	| "path_resolved"
	| "file_read"
	| "bundle_evaluated"
	| "exports_present"
	| "main_init_present"
	| "app_initialized"
	| "ports_valid"
	| "ready"
	| "failed"

export type CompletionContinuationControlElmKernelFailureClass =
	| "KERNEL_PATH_UNRESOLVED"
	| "KERNEL_FILE_MISSING"
	| "KERNEL_READ_FAILED"
	| "KERNEL_EVAL_FAILED"
	| "KERNEL_EXPORT_MISSING"
	| "KERNEL_MAIN_INIT_MISSING"
	| "KERNEL_APP_INIT_FAILED"
	| "KERNEL_PORTS_INVALID"

export interface CompletionContinuationControlElmKernelDiagnostic {
	readonly stage: CompletionContinuationControlElmKernelStage
	readonly failureClass: CompletionContinuationControlElmKernelFailureClass | null
	readonly assetId: typeof COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID
	readonly fileReadable: boolean | null
	readonly bundleByteSize: number | null
	readonly errorName: string | null
}

let _kernelDiagnostic: CompletionContinuationControlElmKernelDiagnostic = {
	stage: "not_attempted",
	failureClass: null,
	assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
	fileReadable: null,
	bundleByteSize: null,
	errorName: null,
}

function errorNameOf(err: unknown): string {
	if (err instanceof Error && typeof err.name === "string" && err.name.length > 0) {
		return err.name
	}
	return "Error"
}

export function getCompletionContinuationControlElmKernelDiagnostic(): CompletionContinuationControlElmKernelDiagnostic {
	return _kernelDiagnostic
}

export function resetCompletionContinuationControlElmKernelDiagnostic(): void {
	_kernelDiagnostic = {
		stage: "not_attempted",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: null,
		bundleByteSize: null,
		errorName: null,
	}
}

interface ElmNamespace {
	readonly Main?: {
		readonly init: (flags: unknown) => {
			readonly ports: {
				readonly inbound: { send: (v: unknown) => void }
				readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
			}
		}
	}
}

/**
 * Evaluate the kernel bundle into a per-kernel namespace object.
 * NEVER mutates `globalThis`. Mirrors the proven TaskHeader pattern.
 */
export function ensureElmKernelEvaluated(kernelPath: string): boolean {
	if (_kernelEvaluatedOnce && _kernelNamespace) return true

	if (typeof kernelPath !== "string" || kernelPath.length === 0) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_PATH_UNRESOLVED",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: null,
			bundleByteSize: null,
			errorName: null,
		}
		Logger.error("[completion-continuation-control-elm] kernel path could not be resolved (empty)")
		return false
	}
	_kernelDiagnostic = {
		stage: "path_resolved",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: null,
		bundleByteSize: null,
		errorName: null,
	}

	let code: string
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		if (!fs.existsSync(kernelPath)) {
			_kernelDiagnostic = {
				stage: "failed",
				failureClass: "KERNEL_FILE_MISSING",
				assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
				fileReadable: false,
				bundleByteSize: null,
				errorName: null,
			}
			Logger.error("[completion-continuation-control-elm] kernel bundle missing at expected path")
			return false
		}
		code = fs.readFileSync(kernelPath, "utf8")
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_READ_FAILED",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: null,
			bundleByteSize: null,
			errorName: errorNameOf(err),
		}
		Logger.error(`[completion-continuation-control-elm] failed to read Elm kernel bundle: ${errorNameOf(err)}`)
		return false
	}
	if (typeof code !== "string" || code.length === 0) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_READ_FAILED",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: 0,
			errorName: null,
		}
		Logger.error("[completion-continuation-control-elm] kernel bundle is empty")
		return false
	}
	_kernelDiagnostic = {
		stage: "file_read",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}

	let namespace: Record<string, unknown>
	let kernelExports: ElmNamespace | null
	try {
		namespace = {}
		const evaluator = new Function("scope", code + "; return this;")
		evaluator.call(namespace, namespace)
		kernelExports = (namespace as { Elm?: ElmNamespace }).Elm ?? null
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_EVAL_FAILED",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: errorNameOf(err),
		}
		Logger.error(`[completion-continuation-control-elm] failed to evaluate Elm kernel bundle: ${errorNameOf(err)}`)
		return false
	}
	if (!kernelExports) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_EXPORT_MISSING",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: null,
		}
		Logger.error("[completion-continuation-control-elm] kernel bundle did not expose Elm after sandboxed evaluation")
		return false
	}
	_kernelDiagnostic = {
		stage: "exports_present",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}
	if (typeof kernelExports.Main?.init !== "function") {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_MAIN_INIT_MISSING",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: null,
		}
		Logger.error(
			"[completion-continuation-control-elm] kernel bundle did not expose Elm.Main.init after sandboxed evaluation",
		)
		return false
	}
	_kernelDiagnostic = {
		stage: "main_init_present",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}
	_kernelNamespace = kernelExports as Record<string, unknown>
	_kernelEvaluatedOnce = true
	return true
}

export function loadCompiledElmKernel(): CompiledElmKernel | null {
	if (cachedKernel) {
		_kernelDiagnostic = {
			stage: "ready",
			failureClass: null,
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: null,
		}
		return cachedKernel
	}
	const mod = _kernelNamespace as ElmNamespace | null
	if (!mod || typeof mod.Main?.init !== "function") return null

	let app: {
		readonly ports: {
			readonly inbound: { send: (v: unknown) => void }
			readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
		}
	} | null = null
	try {
		app = mod.Main.init({})
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_APP_INIT_FAILED",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: errorNameOf(err),
		}
		Logger.error(`[completion-continuation-control-elm] Main.init threw: ${errorNameOf(err)}`)
		return null
	}
	if (!app || !app.ports || !app.ports.inbound || !app.ports.outbound) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_PORTS_INVALID",
			assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: null,
		}
		Logger.error("[completion-continuation-control-elm] kernel app is missing inbound/outbound ports")
		return null
	}
	_kernelDiagnostic = {
		stage: "app_initialized",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: _kernelDiagnostic.fileReadable,
		bundleByteSize: _kernelDiagnostic.bundleByteSize,
		errorName: null,
	}
	let lastOutbound: unknown = null
	app.ports.outbound.subscribe((v: unknown) => {
		lastOutbound = v
	})
	cachedKernel = {
		sendInbound(value: unknown) {
			lastOutbound = null
			app!.ports.inbound.send(value)
		},
		recvOutbound() {
			return lastOutbound
		},
	}
	_kernelDiagnostic = {
		stage: "ports_valid",
		failureClass: null,
		assetId: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
		fileReadable: _kernelDiagnostic.fileReadable,
		bundleByteSize: _kernelDiagnostic.bundleByteSize,
		errorName: null,
	}
	return cachedKernel
}

export function resetElmKernelForTests(): void {
	cachedKernel = null
	_kernelNamespace = null
	_kernelEvaluatedOnce = false
	_productionKernelPath = null
	resetCompletionContinuationControlElmKernelDiagnostic()
}

// ---------------------------------------------------------------------------
// invokeElmKernel
// ---------------------------------------------------------------------------

/**
 * Invoke the compiled Elm kernel with the given semantic `Facts`,
 * returning a typed `CompletionContinuationControlElmDecision`.
 * Fail-closed (C13): on any failure we return a typed decision that
 * the caller MUST surface as `FailClosed MalformedFacts`.
 */
export async function invokeElmKernel(
	factsJson: CompletionContinuationControlFactsJson,
): Promise<CompletionContinuationControlElmDecision> {
	ensureElmKernelEvaluated(resolveProductionKernelPath())
	const kernel = loadCompiledElmKernel()
	if (!kernel) {
		return {
			kind: "kernel_offline",
			classification: "completion_continuation_control_elm_kernel_offline",
		}
	}
	// CRITICAL (C15): The Elm kernel uses `Decode.decodeString`, which
	// calls `JSON.parse` on the inbound payload before running the schema
	// decoder. We must therefore pass a JSON STRING (not a JS object)
	// to the inbound port. The kernel then parses the JSON and runs
	// strict `typeof` checks -- `{"true".boolean === true}` would have
	// leaked through if we passed the JS object directly.
	const wireValue = JSON.stringify(factsJson)
	kernel.sendInbound(wireValue)
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	const out = kernel.recvOutbound()
	if (out === null) {
		return {
			kind: "decode_error",
			reason: "kernel emitted no outbound message",
			classification: "completion_continuation_control_elm_decode_error",
		}
	}
	return decodeDirective(out)
}

// ---------------------------------------------------------------------------
// Production-side authority (C12 / C23)
// ---------------------------------------------------------------------------

let _kernelOfflineCounter = 0
let _decodeErrorCounter = 0

export function failClosedMalformedFacts(): ContinuationDirective {
	return {
		completionStatus: "CANNOT_CONTINUE",
		requiredAction: "fail_closed",
		tag: "fail_closed",
		failureReason: "malformed_facts",
	}
}

export async function pickContinuationDirectiveForPublication(
	input: CompletionContinuationControlFactsInput,
	options?: {
		readonly invokeElmForProduction?: CompletionContinuationControlElmKernelInvoke
	},
): Promise<ContinuationDirective> {
	const invoke = options?.invokeElmForProduction ?? invokeElmKernel
	const facts = buildFactsJson(input)
	let decision: CompletionContinuationControlElmDecision
	try {
		decision = await invoke(facts)
	} catch (err) {
		Logger.error(`[completion-continuation-control-elm] kernel threw: ${err instanceof Error ? err.message : String(err)}`)
		return failClosedMalformedFacts()
	}
	if (decision.kind === "directive") {
		return decision.value
	}
	if (decision.kind === "kernel_offline") {
		_kernelOfflineCounter += 1
		Logger.error(
			`[completion-continuation-control-elm] kernel offline (count=${_kernelOfflineCounter}): ${decision.classification}`,
		)
		return failClosedMalformedFacts()
	}
	_decodeErrorCounter += 1
	Logger.error(`[completion-continuation-control-elm] decode error (count=${_decodeErrorCounter}): ${decision.reason}`)
	return failClosedMalformedFacts()
}

export function getCompletionContinuationControlElmAuthorityCounters(): {
	readonly kernelOffline: number
	readonly decodeError: number
} {
	return { kernelOffline: _kernelOfflineCounter, decodeError: _decodeErrorCounter }
}

export function resetCompletionContinuationControlElmAuthorityForTests(): void {
	_kernelOfflineCounter = 0
	_decodeErrorCounter = 0
}
