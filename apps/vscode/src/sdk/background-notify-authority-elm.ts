/**
 * ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY
 *
 * TypeScript adapter for the background-notify-authority Elm kernel.
 *
 * Architecture (per ACT §C2 / §C12):
 *
 *     raw host facts (already collected by the host scheduler)
 *       -> buildFactsJson(input)        (semantic Facts JSON)
 *       -> invokeElmKernel(factsJson)   (single Platform.worker port invocation)
 *       -> decodeDirective(...)         (fail-closed decode of `kind: "directive"`)
 *       -> typed ConsumeTerminalDecision value
 *
 * The TS authority at `BackgroundNotifyCoordinator.consumeTerminal`
 * is **NOT** changed in this ACT. The adapter is wired only into
 * the test surface and the diagnostic audit. Production callers
 * continue using the TS `consumeTerminal` method unchanged. The
 * next ACT (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-
 * CUTOVER`) is the explicit successor for the live cutover.
 *
 * C11 private-namespace isolation: mirrors the prior kernels'
 * pattern. NEVER mutates `globalThis.Elm`.
 *
 * The kernel-side asset ID is
 * `runtime-assets/background-notify-authority.js` (added to
 * `scripts/build_dogfood_vsix_lib.py` `_ELM_KERNELS` in this ACT).
 *
 * The C15 strict-typing invariant applies: the Elm kernel uses
 * `Decode.decodeString`, which calls `JSON.parse` on the inbound
 * payload before running the schema decoder. The TS adapter MUST
 * pre-serialize the facts through `JSON.stringify` and pass the
 * resulting JSON STRING to the kernel.
 */

import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// Public typed surface (the contract every caller must respect)
// ---------------------------------------------------------------------------

/**
 * Host-side facts about one terminal event. Mirrors the Elm
 * `Facts` record 1:1 (see `apps/vscode/elm/background-notify-
 * authority/src/Domain.elm`).
 */
export interface BackgroundNotifyAuthorityFactsInput {
	readonly jobId: string
	readonly terminalState: "exited" | "failed" | "aborted" | "killed" | "containment_failed" | "unknown"
	readonly isContainmentFailed: boolean
	readonly exitCode: number | null
	readonly reason: string | undefined
	readonly outputTail: string | undefined
	readonly activeOwnerSessionId: string | null
	readonly activeOwnerTaskId: string | null
	readonly markerSessionId: string | null
	readonly markerTaskId: string | null
	readonly remainingNotify: number
}

/**
 * The pure decision — 1:1 with both the Elm `ConsumeDecision` sum
 * AND the TS `ConsumeTerminalDecision` discriminated union in
 * `background-notify-coordinator.ts:109-114`. The TS adapter is
 * the boundary that maps the Elm-out wire shape to the TS
 * `ConsumeTerminalDecision` so the production caller can use
 * the decision directly.
 */
export type BackgroundNotifyAuthorityDecision =
	| { readonly kind: "no_marker" }
	| { readonly kind: "owner_mismatch" }
	| { readonly kind: "containment_no_wake"; readonly jobId: string }
	| { readonly kind: "held"; readonly jobId: string; readonly heldCount: number }
	| {
			readonly kind: "drained"
			readonly jobId: string
			readonly drainedCount: number
	  }

/**
 * Closed wire JSON for the inbound `Facts` payload. Mirrors
 * `Codec.factsDecoder` 1:1.
 */
export interface BackgroundNotifyAuthorityFactsJson {
	readonly version: 1
	readonly facts: {
		readonly jobId: string
		readonly terminalState: string
		readonly isContainmentFailed: boolean
		readonly exitCode: number
		readonly reason: string | null
		readonly outputTail: string | null
		readonly markerSessionId: string | null
		readonly markerTaskId: string | null
		readonly activeOwnerSessionId: string | null
		readonly activeOwnerTaskId: string | null
		readonly remainingNotify: number
	}
}

/**
 * What the audit call returns. The audit consumer treats every
 * non-`directive` outcome as `no_marker` (fail-closed). The
 * `directive` value carries the typed decision; the `summary`
 * is the diagnostic one-liner from the Elm `Main.elm`.
 */
export type BackgroundNotifyAuthorityElmAudit =
	| {
			readonly kind: "directive"
			readonly value: BackgroundNotifyAuthorityDecision
			readonly summary: string
	  }
	| {
			readonly kind: "decode_error"
			readonly reason: string
			readonly classification: "background_notify_authority_elm_decode_error"
	  }
	| {
			readonly kind: "kernel_offline"
			readonly classification: "background_notify_authority_elm_kernel_offline"
	  }
	| {
			readonly kind: "no_decision"
			readonly classification: "background_notify_authority_elm_no_decision"
	  }

// ---------------------------------------------------------------------------
// Facts JSON projection
// ---------------------------------------------------------------------------

/**
 * Project the host input into the closed wire JSON shape.
 *
 * The `exitCode: -1` sentinel encodes `Absent` per the
 * `Codec.decodeExitCode` contract. The TS adapter MUST clamp any
 * null / non-integer exit code to `-1` at the wire boundary.
 */
export function buildFactsJson(input: BackgroundNotifyAuthorityFactsInput): BackgroundNotifyAuthorityFactsJson {
	return {
		version: 1,
		facts: {
			jobId: input.jobId,
			terminalState: input.terminalState,
			isContainmentFailed: input.isContainmentFailed,
			exitCode: input.exitCode === null ? -1 : input.exitCode,
			reason: input.reason ?? null,
			outputTail: input.outputTail ?? null,
			markerSessionId: input.markerSessionId,
			markerTaskId: input.markerTaskId,
			activeOwnerSessionId: input.activeOwnerSessionId,
			activeOwnerTaskId: input.activeOwnerTaskId,
			remainingNotify: input.remainingNotify,
		},
	}
}

// ---------------------------------------------------------------------------
// Outbound decoder
// ---------------------------------------------------------------------------

interface OutboundMessage {
	readonly kind: string
	readonly decision?: {
		readonly kind?: string
		readonly jobId?: string
		readonly heldCount?: number
		readonly drainedCount?: number
	}
	readonly summary?: string
	readonly error?: string
}

function decodeDirective(out: unknown): BackgroundNotifyAuthorityElmAudit {
	if (out === null || typeof out !== "object") {
		return {
			kind: "decode_error",
			reason: "kernel emitted no outbound message (null/object)",
			classification: "background_notify_authority_elm_decode_error",
		}
	}
	const msg = out as OutboundMessage
	if (msg.kind === "directive") {
		const decisionValue = msg.decision
		if (decisionValue === null || typeof decisionValue !== "object" || typeof decisionValue.kind !== "string") {
			return {
				kind: "decode_error",
				reason: "directive message missing typed decision.kind",
				classification: "background_notify_authority_elm_decode_error",
			}
		}
		switch (decisionValue.kind) {
			case "no_marker":
				return {
					kind: "directive",
					value: { kind: "no_marker" },
					summary: msg.summary ?? "no_marker",
				}
			case "owner_mismatch":
				return {
					kind: "directive",
					value: { kind: "owner_mismatch" },
					summary: msg.summary ?? "owner_mismatch",
				}
			case "containment_no_wake":
				if (typeof decisionValue.jobId !== "string") {
					return {
						kind: "decode_error",
						reason: "containment_no_wake directive missing jobId",
						classification: "background_notify_authority_elm_decode_error",
					}
				}
				return {
					kind: "directive",
					value: { kind: "containment_no_wake", jobId: decisionValue.jobId },
					summary: msg.summary ?? `containment_no_wake:${decisionValue.jobId}`,
				}
			case "held":
				if (typeof decisionValue.jobId !== "string" || typeof decisionValue.heldCount !== "number") {
					return {
						kind: "decode_error",
						reason: "held directive missing jobId or heldCount",
						classification: "background_notify_authority_elm_decode_error",
					}
				}
				return {
					kind: "directive",
					value: {
						kind: "held",
						jobId: decisionValue.jobId,
						heldCount: decisionValue.heldCount,
					},
					summary: msg.summary ?? `held:${decisionValue.jobId}:${decisionValue.heldCount}`,
				}
			case "drained":
				if (typeof decisionValue.jobId !== "string" || typeof decisionValue.drainedCount !== "number") {
					return {
						kind: "decode_error",
						reason: "drained directive missing jobId or drainedCount",
						classification: "background_notify_authority_elm_decode_error",
					}
				}
				return {
					kind: "directive",
					value: {
						kind: "drained",
						jobId: decisionValue.jobId,
						drainedCount: decisionValue.drainedCount,
					},
					summary: msg.summary ?? `drained:${decisionValue.jobId}:${decisionValue.drainedCount}`,
				}
			default:
				return {
					kind: "decode_error",
					reason: `unknown decision kind: ${String(decisionValue.kind)}`,
					classification: "background_notify_authority_elm_decode_error",
				}
		}
	}
	if (msg.kind === "decode_error") {
		return {
			kind: "decode_error",
			reason: msg.error ?? "(missing error message)",
			classification: "background_notify_authority_elm_decode_error",
		}
	}
	if (msg.kind === "ready") {
		return {
			kind: "no_decision",
			classification: "background_notify_authority_elm_no_decision",
		}
	}
	return {
		kind: "decode_error",
		reason: `unknown outbound kind: ${String(msg.kind)}`,
		classification: "background_notify_authority_elm_decode_error",
	}
}

// ---------------------------------------------------------------------------
// Kernel loader (lazy, fail-closed)
// ---------------------------------------------------------------------------

export interface CompiledElmKernel {
	sendInbound(value: unknown): void
	recvOutbound(): unknown
}

let cachedKernel: CompiledElmKernel | null = null
let _kernelNamespace: Record<string, unknown> | null = null
let _kernelEvaluatedOnce = false
let _productionKernelPath: string | null = null

export const BACKGROUND_NOTIFY_AUTHORITY_ELM_RUNTIME_ASSET_ID = "runtime-assets/background-notify-authority.js" as const

export function defaultElmKernelPath(): string {
	const url = new URL("../../elm/background-notify-authority/vendor/background-notify-authority.js", import.meta.url)
	return url.pathname
}

export function setBackgroundNotifyAuthorityElmProductionKernelPath(path: string | null): void {
	_productionKernelPath = path
}

export function getBackgroundNotifyAuthorityElmProductionKernelPath(): string | null {
	return _productionKernelPath
}

export function resolveProductionKernelPath(): string {
	if (typeof _productionKernelPath === "string" && _productionKernelPath.length > 0) {
		return _productionKernelPath
	}
	return defaultElmKernelPath()
}

export type BackgroundNotifyAuthorityElmKernelStage =
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

export type BackgroundNotifyAuthorityElmKernelFailureClass =
	| "KERNEL_PATH_UNRESOLVED"
	| "KERNEL_FILE_MISSING"
	| "KERNEL_READ_FAILED"
	| "KERNEL_EVAL_FAILED"
	| "KERNEL_EXPORT_MISSING"
	| "KERNEL_MAIN_INIT_MISSING"
	| "KERNEL_APP_INIT_FAILED"
	| "KERNEL_PORTS_INVALID"

export interface BackgroundNotifyAuthorityElmKernelDiagnostic {
	readonly stage: BackgroundNotifyAuthorityElmKernelStage
	readonly failureClass: BackgroundNotifyAuthorityElmKernelFailureClass | null
	readonly assetId: typeof BACKGROUND_NOTIFY_AUTHORITY_ELM_RUNTIME_ASSET_ID
	readonly fileReadable: boolean | null
	readonly bundleByteSize: number | null
	readonly errorName: string | null
}

let _kernelDiagnostic: BackgroundNotifyAuthorityElmKernelDiagnostic = {
	stage: "not_attempted",
	failureClass: null,
	assetId: BACKGROUND_NOTIFY_AUTHORITY_ELM_RUNTIME_ASSET_ID,
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

export function getBackgroundNotifyAuthorityElmKernelDiagnostic(): BackgroundNotifyAuthorityElmKernelDiagnostic {
	return _kernelDiagnostic
}

export function resetBackgroundNotifyAuthorityElmKernelDiagnostic(): void {
	_kernelDiagnostic = {
		stage: "not_attempted",
		failureClass: null,
		assetId: BACKGROUND_NOTIFY_AUTHORITY_ELM_RUNTIME_ASSET_ID,
		fileReadable: null,
		bundleByteSize: null,
		errorName: null,
	}
}

interface ElmKernelPorts {
	readonly inbound: { send: (v: unknown) => void }
	readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
}

interface ElmKernelApp {
	readonly ports: ElmKernelPorts
}

interface ElmMainInit {
	readonly init: (flags: unknown) => ElmKernelApp
}

interface ElmNamespace {
	readonly Main?: ElmMainInit
}

interface ElmRoot {
	readonly Elm?: ElmNamespace
}

let _outboundListener: ((v: unknown) => void) | null = null
let _lastOutbound: unknown = null

function setLastOutbound(v: unknown): void {
	_lastOutbound = v
}

function loadCompiledElmKernel(): CompiledElmKernel | null {
	if (cachedKernel) return cachedKernel
	const root = _kernelNamespace as ElmRoot | null
	const main = root?.Elm?.Main
	if (!main) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_EXPORT_MISSING",
		}
		return null
	}
	let app: ElmKernelApp
	try {
		app = main.init({})
	} catch (err) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_APP_INIT_FAILED",
			errorName: errorNameOf(err),
		}
		Logger.error(`[background-notify-authority-elm] app init failed: ${errorNameOf(err)}`)
		return null
	}
	if (!app.ports || !app.ports.inbound || !app.ports.outbound) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_PORTS_INVALID",
		}
		return null
	}
	_outboundListener = setLastOutbound
	app.ports.outbound.subscribe(_outboundListener)
	_kernelDiagnostic = {
		..._kernelDiagnostic,
		stage: "ready",
		failureClass: null,
	}
	cachedKernel = {
		sendInbound(value: unknown): void {
			app.ports.inbound.send(value)
		},
		recvOutbound(): unknown {
			const v = _lastOutbound
			_lastOutbound = null
			return v
		},
	}
	return cachedKernel
}

/**
 * Evaluate the kernel bundle into a per-kernel namespace object.
 * NEVER mutates `globalThis`. Mirrors the TaskHeader pattern.
 */
export function ensureElmKernelEvaluated(kernelPath: string): boolean {
	if (_kernelEvaluatedOnce && _kernelNamespace) return true

	if (typeof kernelPath !== "string" || kernelPath.length === 0) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_PATH_UNRESOLVED",
		}
		Logger.error("[background-notify-authority-elm] kernel path could not be resolved (empty)")
		return false
	}
	_kernelDiagnostic = { ..._kernelDiagnostic, stage: "path_resolved" }

	let code: string
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		if (!fs.existsSync(kernelPath)) {
			_kernelDiagnostic = {
				..._kernelDiagnostic,
				stage: "failed",
				failureClass: "KERNEL_FILE_MISSING",
				fileReadable: false,
			}
			Logger.error(`[background-notify-authority-elm] kernel file missing: ${kernelPath}`)
			return false
		}
		const stat = fs.statSync(kernelPath)
		_kernelDiagnostic = { ..._kernelDiagnostic, bundleByteSize: stat.size }
		code = fs.readFileSync(kernelPath, "utf8") as string
		_kernelDiagnostic = { ..._kernelDiagnostic, fileReadable: true, stage: "file_read" }
	} catch (err) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_READ_FAILED",
			errorName: errorNameOf(err),
		}
		Logger.error(`[background-notify-authority-elm] kernel read failed: ${errorNameOf(err)}`)
		return false
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
		const evaluator = new Function("scope", `${code}; return this;`) as (
			scope: Record<string, unknown>,
		) => Record<string, unknown>
		const ns: Record<string, unknown> = {}
		evaluator.call(ns, ns)
		_kernelNamespace = ns
		_kernelDiagnostic = { ..._kernelDiagnostic, stage: "bundle_evaluated" }
	} catch (err) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_EVAL_FAILED",
			errorName: errorNameOf(err),
		}
		Logger.error(`[background-notify-authority-elm] kernel eval failed: ${errorNameOf(err)}`)
		return false
	}

	const root = _kernelNamespace as ElmRoot
	if (!root.Elm) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_EXPORT_MISSING",
		}
		return false
	}
	_kernelDiagnostic = { ..._kernelDiagnostic, stage: "exports_present" }

	const main = root.Elm.Main
	if (!main) {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_EXPORT_MISSING",
		}
		return false
	}
	if (typeof main.init !== "function") {
		_kernelDiagnostic = {
			..._kernelDiagnostic,
			stage: "failed",
			failureClass: "KERNEL_MAIN_INIT_MISSING",
		}
		return false
	}
	_kernelDiagnostic = { ..._kernelDiagnostic, stage: "main_init_present" }

	// Initialize the app eagerly so the ready message is observed.
	const app = loadCompiledElmKernel()
	if (!app) return false
	_kernelDiagnostic = { ..._kernelDiagnostic, stage: "app_initialized" }
	_kernelEvaluatedOnce = true
	return true
}

// ---------------------------------------------------------------------------
// Audit-only entry point
// ---------------------------------------------------------------------------

/**
 * Audit-only Elm invocation. Returns a typed
 * `BackgroundNotifyAuthorityElmAudit` for the test surface and the
 * diagnostic dump. The production caller is **NOT** supposed to
 * use this function in this ACT; the TS `consumeTerminal` method
 * remains the live authority. The next ACT
 * (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
 * is the explicit successor for the live cutover.
 *
 * The function:
 *  1. Serializes the input through `JSON.stringify` (C15).
 *  2. Invokes the kernel through the inbound port.
 *  3. Waits one microtask tick for the outbound message to land.
 *  4. Decodes the message and returns a typed audit value.
 */
export async function pickConsumeDecisionForAudit(
	input: BackgroundNotifyAuthorityFactsInput,
): Promise<BackgroundNotifyAuthorityElmAudit> {
	ensureElmKernelEvaluated(resolveProductionKernelPath())
	const kernel = loadCompiledElmKernel()
	if (!kernel) {
		return {
			kind: "kernel_offline",
			classification: "background_notify_authority_elm_kernel_offline",
		}
	}
	const wireValue = JSON.stringify(buildFactsJson(input))
	kernel.sendInbound(wireValue)
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	const out = kernel.recvOutbound()
	if (out === null) {
		return {
			kind: "no_decision",
			classification: "background_notify_authority_elm_no_decision",
		}
	}
	return decodeDirective(out)
}

/**
 * Fail-closed decision for the test/audit path. The production
 * caller is NOT supposed to use this in this ACT.
 */
export function failClosedNoMarker(): BackgroundNotifyAuthorityDecision {
	return { kind: "no_marker" }
}

let _kernelOfflineCounter = 0
let _decodeErrorCounter = 0

export function getBackgroundNotifyAuthorityElmAuthorityCounters(): {
	readonly kernelOffline: number
	readonly decodeError: number
} {
	return { kernelOffline: _kernelOfflineCounter, decodeError: _decodeErrorCounter }
}

export function resetBackgroundNotifyAuthorityElmAuthorityForTests(): void {
	_kernelOfflineCounter = 0
	_decodeErrorCounter = 0
}
