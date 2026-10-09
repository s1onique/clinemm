/**
 * ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION
 *
 * TypeScript adapter for the deferred-completion-barrier E3.1
 * Elm kernel.
 *
 * Architecture (per ACT §C2 / §C6 / §C12):
 *
 *     raw host facts (collected at the consult point)
 *       -> buildFactsJson(input)
 *       -> invokeElmKernel(factsJson)
 *       -> decodeBarrierDirective(...)
 *       -> typed BarrierDirective value
 *
 * C11 private-namespace isolation: mirrors the prior kernels'
 * pattern. NEVER mutates `globalThis.Elm`.
 *
 * The kernel-side asset ID is
 * `runtime-assets/deferred-completion-barrier.js`.
 *
 * The C15 strict-typing invariant applies: the Elm kernel uses
 * `Decode.decodeString`, which calls `JSON.parse` on the inbound
 * payload before running the schema decoder. The TS adapter MUST
 * pre-serialize the facts through `JSON.stringify` and pass the
 * resulting JSON STRING to the kernel.
 */

import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// Public typed surface
// ---------------------------------------------------------------------------

/**
 * Host-side facts about one E3.1 post-await consult point. Mirrors
 * the Elm `Facts` record 1:1 (see
 * `apps/vscode/elm/deferred-completion-barrier/src/Domain.elm`).
 */
export interface DeferredCompletionBarrierFactsInput {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly markerSessionId: string
	readonly markerTaskId: string | undefined
	readonly markerEpoch: number
	readonly currentEpoch: number
	readonly continuationSessionEpoch: string
	readonly lastContinuationSessionEpoch: string | undefined
	readonly currentHeldSetSorted: readonly string[]
	readonly priorHeldSetSorted: readonly string[] | undefined
	readonly heldJobCount: number
	readonly liveMarkerPresent: boolean
}

/**
 * The pure decision — 1:1 with the Elm `BarrierDirective` sum.
 */
export type DeferredCompletionBarrierDirective =
	| { readonly kind: "permit_enqueue"; readonly mustClearRearm: boolean }
	| { readonly kind: "suppress_duplicate" }
	| { readonly kind: "preserve_barrier" }
	| {
			readonly kind: "reject_stale_identity"
			readonly reason: "marker_absent" | "session_mismatch" | "task_mismatch" | "epoch_mismatch"
	  }

/**
 * What the consult returns. The producer treats every
 * non-`directive` outcome as `ElmUnavailable_UsePredecessor` (the
 * full TS predecessor path). The `directive` value carries the
 * typed decision; the `summary` is the diagnostic one-liner from
 * the Elm `Main.elm`.
 */
export type DeferredCompletionBarrierElmConsult =
	| {
			readonly kind: "directive"
			readonly value: DeferredCompletionBarrierDirective
			readonly summary: string
			readonly requestId: string | null
	  }
	| {
			readonly kind: "decode_error"
			readonly reason: string
			readonly classification: "deferred_completion_barrier_elm_decode_error"
			readonly requestId: string | null
	  }
	| {
			readonly kind: "kernel_offline"
			readonly classification: "deferred_completion_barrier_elm_kernel_offline"
	  }
	| {
			readonly kind: "no_decision"
			readonly classification: "deferred_completion_barrier_elm_no_decision"
	  }

/**
 * Kernel-side runtime asset id. MUST match the `_ELM_KERNELS`
 * entry in `scripts/build_dogfood_vsix_lib.py`.
 */
export const DEFERRED_COMPLETION_BARRIER_ELM_RUNTIME_ASSET_ID = "runtime-assets/deferred-completion-barrier.js"

// ---------------------------------------------------------------------------
// Facts JSON projection
// ---------------------------------------------------------------------------

export interface DeferredCompletionBarrierFactsJson {
	readonly version: 1
	readonly requestId: string | null
	readonly facts: {
		readonly sessionId: string
		readonly taskId: string | null
		readonly markerSessionId: string
		readonly markerTaskId: string | null
		readonly markerEpoch: number
		readonly currentEpoch: number
		readonly continuationSessionEpoch: string
		readonly lastContinuationSessionEpoch: string | null
		readonly currentHeldSetSorted: readonly string[]
		readonly priorHeldSetSorted: readonly string[] | null
		readonly heldJobCount: number
		readonly liveMarkerPresent: boolean
	}
}

/**
 * Project the host input into the closed wire JSON shape.
 */
export function buildDeferredCompletionBarrierFactsJson(
	input: DeferredCompletionBarrierFactsInput,
	requestId: string | null = null,
): DeferredCompletionBarrierFactsJson {
	return {
		version: 1,
		requestId,
		facts: {
			sessionId: input.sessionId,
			taskId: input.taskId ?? null,
			markerSessionId: input.markerSessionId,
			markerTaskId: input.markerTaskId ?? null,
			markerEpoch: input.markerEpoch,
			currentEpoch: input.currentEpoch,
			continuationSessionEpoch: input.continuationSessionEpoch,
			lastContinuationSessionEpoch: input.lastContinuationSessionEpoch ?? null,
			currentHeldSetSorted: input.currentHeldSetSorted.slice().sort(),
			priorHeldSetSorted: input.priorHeldSetSorted === undefined ? null : input.priorHeldSetSorted.slice().sort(),
			heldJobCount: input.heldJobCount,
			liveMarkerPresent: input.liveMarkerPresent,
		},
	}
}

// ---------------------------------------------------------------------------
// Kernel loader (mirrors the prior kernels' pattern)
// ---------------------------------------------------------------------------

interface ElmKernelHandle {
	sendInbound: (jsonString: string) => void
	recvOutbound: () => unknown
}

let _kernelInstance: ElmKernelHandle | null = null
let _kernelLoadAttempted = false
let _kernelLoadError: string | null = null

function loadCompiledElmKernel(): ElmKernelHandle | null {
	if (_kernelInstance) {
		return _kernelInstance
	}
	if (_kernelLoadAttempted && _kernelLoadError) {
		return null
	}
	_kernelLoadAttempted = true
	// Evaluate the bundle in a controlled scope so the kernel's
	// `Elm.Main` global does not collide with other kernels.
	// Mirrors `ensureElmKernelEvaluated` in
	// apps/vscode/src/sdk/completion-continuation-control-elm.ts.
	const path = require("node:path") as typeof import("node:path")
	const fs = require("node:fs") as typeof import("node:fs")
	const candidatePaths = [
		path.resolve(__dirname, "..", "..", "elm", "deferred-completion-barrier", "vendor", "deferred-completion-barrier.js"),
	]
	let code: string | null = null
	for (const candidate of candidatePaths) {
		if (fs.existsSync(candidate)) {
			try {
				code = fs.readFileSync(candidate, "utf-8")
				break
			} catch {
				code = null
			}
		}
	}
	if (code === null) {
		_kernelLoadError = "Elm kernel bundle not found at any candidate path"
		return null
	}
	let namespace: Record<string, unknown>
	try {
		namespace = {}
		const evaluator = new Function("scope", `${code}; return this;`)
		evaluator.call(namespace, namespace)
	} catch (err) {
		_kernelLoadError = err instanceof Error ? err.message : String(err)
		return null
	}
	const kernelExports = (namespace as { Elm?: Record<string, unknown> }).Elm ?? null
	if (!kernelExports) {
		_kernelLoadError = "Elm namespace not exposed by the kernel bundle"
		return null
	}
	const mainModule = kernelExports.Main as
		| {
				readonly init?: (flags: unknown) => {
					readonly ports: {
						readonly inbound: { send: (v: unknown) => void }
						readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
					}
				}
		  }
		| undefined
	if (!mainModule || typeof mainModule.init !== "function") {
		_kernelLoadError = "Elm.Main.init not exposed by the kernel bundle"
		return null
	}
	let app: ReturnType<NonNullable<typeof mainModule.init>> | null = null
	try {
		app = mainModule.init({})
	} catch (err) {
		_kernelLoadError = err instanceof Error ? err.message : String(err)
		return null
	}
	if (!app || !app.ports || !app.ports.inbound || !app.ports.outbound) {
		_kernelLoadError = "Elm kernel app is missing inbound/outbound ports"
		return null
	}
	let lastOutbound: unknown = null
	app.ports.outbound.subscribe((v: unknown) => {
		lastOutbound = v
	})
	_kernelInstance = {
		sendInbound(value: unknown) {
			lastOutbound = null
			app?.ports.inbound.send(value)
		},
		recvOutbound() {
			return lastOutbound
		},
	}
	return _kernelInstance
}

export function getDeferredCompletionBarrierElmKernelDiagnostic(): {
	readonly loaded: boolean
	readonly error: string | null
} {
	if (_kernelInstance) {
		return { loaded: true, error: null }
	}
	if (!_kernelLoadAttempted) {
		return { loaded: false, error: null }
	}
	return { loaded: false, error: _kernelLoadError }
}

export function resetDeferredCompletionBarrierElmKernelForTests(): void {
	_kernelInstance = null
	_kernelLoadAttempted = false
	_kernelLoadError = null
}

// ---------------------------------------------------------------------------
// Outbound decoder
// ---------------------------------------------------------------------------

interface OutboundMessage {
	readonly kind: string
	readonly directive?: {
		readonly kind?: string
		readonly mustClearRearm?: boolean
		readonly reason?: string
	}
	readonly error?: string
	readonly requestId?: string | null
}

/**
 * Decode a typed `DeferredCompletionBarrierDirective` from the
 * outbound JSON. Fail-closed: any unknown `kind` becomes
 * `decode_error` (C13 invariant).
 */
function decodeBarrierDirective(out: OutboundMessage): DeferredCompletionBarrierElmConsult {
	if (out.kind !== "directive" || !out.directive) {
		return {
			kind: "decode_error",
			reason: `outbound kind=${out.kind} (expected "directive")`,
			classification: "deferred_completion_barrier_elm_decode_error",
			requestId: out.requestId ?? null,
		}
	}
	const d = out.directive
	switch (d.kind) {
		case "permit_enqueue":
			return {
				kind: "directive",
				value: {
					kind: "permit_enqueue",
					mustClearRearm: d.mustClearRearm === true,
				},
				summary: "permit_enqueue",
				requestId: out.requestId ?? null,
			}
		case "suppress_duplicate":
			return {
				kind: "directive",
				value: { kind: "suppress_duplicate" },
				summary: "suppress_duplicate",
				requestId: out.requestId ?? null,
			}
		case "preserve_barrier":
			return {
				kind: "directive",
				value: { kind: "preserve_barrier" },
				summary: "preserve_barrier",
				requestId: out.requestId ?? null,
			}
		case "reject_stale_identity": {
			const reason = d.reason
			if (
				reason === "marker_absent" ||
				reason === "session_mismatch" ||
				reason === "task_mismatch" ||
				reason === "epoch_mismatch"
			) {
				return {
					kind: "directive",
					value: { kind: "reject_stale_identity", reason },
					summary: `reject_stale_identity:${reason}`,
					requestId: out.requestId ?? null,
				}
			}
			return {
				kind: "decode_error",
				reason: `unknown reject_stale_identity reason=${reason}`,
				classification: "deferred_completion_barrier_elm_decode_error",
				requestId: out.requestId ?? null,
			}
		}
		default:
			return {
				kind: "decode_error",
				reason: `unknown directive kind=${d.kind}`,
				classification: "deferred_completion_barrier_elm_decode_error",
				requestId: out.requestId ?? null,
			}
	}
}

// ---------------------------------------------------------------------------
// Production consult
// ---------------------------------------------------------------------------

let _kernelOfflineCounter = 0
let _decodeErrorCounter = 0

/**
 * Invoke the compiled Elm kernel with the given semantic facts.
 * Returns a typed `DeferredCompletionBarrierElmConsult`. The
 * caller MUST treat every non-`directive` outcome as
 * `ElmUnavailable_UsePredecessor` and run the original TS
 * predecessor path (C4 conservation).
 */
export async function consultDeferredCompletionBarrierElmKernel(
	input: DeferredCompletionBarrierFactsInput,
	options?: {
		readonly invokeForProduction?: (facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>
		readonly requestId?: string | null
	},
): Promise<DeferredCompletionBarrierElmConsult> {
	const requestId = options?.requestId ?? null
	const invoke = options?.invokeForProduction ?? defaultInvokeElmKernel
	const facts = buildDeferredCompletionBarrierFactsJson(input, requestId)
	try {
		const result = await invoke(facts)
		// C13: every non-directive outcome is a fail-closed
		// signal. The `directive` outcome is the SOLE path
		// through which Elm can authorize an effect.
		// `defaultInvokeElmKernel` runs the decoder before
		// returning; a custom `invokeForProduction` is expected
		// to also run the decoder OR to return a non-`directive`
		// outcome (kernel_offline / decode_error / no_decision).
		return result
	} catch (err) {
		Logger.error(`[deferred-completion-barrier-elm] kernel threw: ${err instanceof Error ? err.message : String(err)}`)
		_decodeErrorCounter += 1
		return {
			kind: "decode_error",
			reason: err instanceof Error ? err.message : String(err),
			classification: "deferred_completion_barrier_elm_decode_error",
			requestId,
		}
	}
}

async function defaultInvokeElmKernel(facts: DeferredCompletionBarrierFactsJson): Promise<DeferredCompletionBarrierElmConsult> {
	const kernel = loadCompiledElmKernel()
	if (!kernel) {
		_kernelOfflineCounter += 1
		Logger.error(`[deferred-completion-barrier-elm] kernel offline (count=${_kernelOfflineCounter})`)
		return {
			kind: "kernel_offline",
			classification: "deferred_completion_barrier_elm_kernel_offline",
		}
	}
	// C15: pre-serialize to a JSON string so the kernel's
	// `Decode.decodeString` parses it and the strict-typing
	// checks fire.
	const wireValue = JSON.stringify(facts)
	kernel.sendInbound(wireValue)
	// Wait one event-loop tick for the Platform.worker to flush
	// the outbound port. The same pattern is used by every prior
	// SEAM kernel.
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	const out = kernel.recvOutbound() as OutboundMessage | null
	if (out === null) {
		_decodeErrorCounter += 1
		return {
			kind: "no_decision",
			classification: "deferred_completion_barrier_elm_no_decision",
		}
	}
	return decodeBarrierDirective(out)
}

export function getDeferredCompletionBarrierElmAuthorityCounters(): {
	readonly kernelOffline: number
	readonly decodeError: number
} {
	return { kernelOffline: _kernelOfflineCounter, decodeError: _decodeErrorCounter }
}

export function resetDeferredCompletionBarrierElmAuthorityForTests(): void {
	_kernelOfflineCounter = 0
	_decodeErrorCounter = 0
}
