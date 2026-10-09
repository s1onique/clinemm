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

interface PendingRequest {
	readonly resolve: (outbound: unknown) => void
	readonly reject: (err: Error) => void
	readonly timer: ReturnType<typeof setTimeout> | null
}

interface ElmKernelHandle {
	sendInbound: (jsonString: string) => void
	/**
	 * Pending-request map keyed by `requestId`. The adapter owns
	 * the map; the kernel only reads / writes through the
	 * `sendInbound` surface. The outbound subscription is owned
	 * by the loader (registered in `loadCompiledElmKernel`); the
	 * per-requestId dispatch is internal to the adapter.
	 */
	pending: Map<string, PendingRequest>
}

let _kernelInstance: ElmKernelHandle | null = null
let _kernelLoadAttempted = false
let _kernelLoadError: string | null = null
let _productionKernelPath: string | null = null

/**
 * ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER (REVIEWER P1):
 * the production activator sets this BEFORE the first consult.
 * When set, the loader reads the staged runtime asset from the
 * packaged extension (the canonical VSIX path). When null, the
 * loader falls back to the source-tree vendor path (test/dev
 * mode).
 */
export function setDeferredCompletionBarrierElmProductionKernelPath(path: string | null): void {
	_productionKernelPath = path
}

export function getDeferredCompletionBarrierElmProductionKernelPath(): string | null {
	return _productionKernelPath
}

/**
 * ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER (REVIEWER P0):
 * unique request ID generator. The adapter generates a fresh
 * opaque token for EVERY consult; the Elm kernel echoes the
 * token back on the outbound message; the pending-map
 * dispatch routes the response to the matching resolver
 * only. A missing-token or token-mismatched response is
 * dropped (the caller's consult will resolve via its own
 * timeout, not by stealing another request's response).
 */
let _requestIdCounter = 0
function nextRequestId(): string {
	_requestIdCounter = (Date.now() * 1000 + _requestIdCounter + 1) % 0x7fffffff
	return `dcb-${_requestIdCounter.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`
}

/**
 * REVIEWER P1: bounded response timeout. The production
 * consults do NOT use a deadline — the production consult
 * blocks on the pending map resolver, which only fires on
 * the matched response or on coordinator disposal. A
 * bounded timeout may be added in the cutover ACT as a test
 * guard (per ACT §C1: "A bounded timeout may be used as a
 * test guard. Do not promote an arbitrary 50 ms test
 * deadline to a production SLA.").
 */

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
	// ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER (REVIEWER P1):
	// the candidate paths now cover BOTH the source-tree vendor
	// (test/back-door load) AND the installed VSIX runtime-assets
	// path (production load). The production activator sets
	// `_productionKernelPath` via `setDeferredCompletionBarrierElmProductionKernelPath`
	// BEFORE the first consult; that path is the canonical
	// resolution for the packaged extension. The source-tree
	// candidate is a fallback for dev-mode and test runs.
	const candidatePaths = [
		_productionKernelPath,
		path.resolve(__dirname, "..", "..", "elm", "deferred-completion-barrier", "vendor", "deferred-completion-barrier.js"),
	].filter((p): p is string => typeof p === "string" && p.length > 0)
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
	// ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER (REVIEWER P0):
	// the adapter owns a per-requestId pending map; the kernel
	// only emits via `outbound.subscribe`. The handler routes
	// each outbound message to the resolver keyed by the
	// echoed `requestId`. Two concurrent consults cannot swap
	// responses because each resolver fires only when its
	// specific requestId arrives.
	const pending = new Map<string, PendingRequest>()
	app.ports.outbound.subscribe((v: unknown) => {
		// C4 conservation: a `ready` message has no requestId
		// and no pending entry. It is informational only and
		// is silently dropped (the kernel confirms init).
		if (v === null || typeof v !== "object") return
		const msg = v as { readonly kind?: string; readonly requestId?: unknown }
		if (msg.kind === "ready") return
		const requestId = typeof msg.requestId === "string" ? msg.requestId : null
		if (requestId === null) {
			// REVIEWER P0: the Elm kernel echoes correlation
			// identifiers; the TS transport MUST enforce
			// correlation. An outbound message with a missing
			// requestId is a contract violation — the
			// requestId is required for any consult that has
			// a non-direct response shape.
			return
		}
		const entry = pending.get(requestId)
		if (!entry) return
		pending.delete(requestId)
		if (entry.timer !== null) clearTimeout(entry.timer)
		entry.resolve(v)
	})
	_kernelInstance = {
		sendInbound(value: unknown) {
			app?.ports.inbound.send(value)
		},
		pending,
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
	_productionKernelPath = null
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
 * ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER (REVIEWER P1):
 * strict public-adapter boundary validator. Runs on EVERY
 * consult result — including custom `invokeForProduction` —
 * to enforce the closed directive schema. Unknown kinds,
 * missing required fields (e.g. `mustClearRearm` on a
 * `permit_enqueue`), and wrong `requestId` echoes are
 * rejected as `decode_error` BEFORE the result leaves the
 * adapter. The prior substrate was too permissive (a custom
 * invoke could return any shape; the default decoder coerced
 * missing `mustClearRearm` to `false`).
 */
function validateConsultResult(
	result: DeferredCompletionBarrierElmConsult,
	expectedRequestId: string | null,
): DeferredCompletionBarrierElmConsult {
	if (result.kind !== "directive") {
		// Non-directive outcomes (kernel_offline / decode_error /
		// no_decision) are accepted as-is.
		return result
	}
	// Strict requestId echo: the directive's requestId MUST
	// match the expected requestId. A mismatch is a contract
	// violation; the directive cannot be honored.
	if (result.requestId !== expectedRequestId) {
		_decodeErrorCounter += 1
		return {
			kind: "decode_error",
			reason: `directive requestId=${String(result.requestId)} does not match expected=${String(expectedRequestId)}`,
			classification: "deferred_completion_barrier_elm_decode_error",
			requestId: expectedRequestId,
		}
	}
	// Strict value-kind validation: every directive variant
	// has a closed shape. The default decoder already validates
	// most cases; this is a second-pass guard for the custom
	// `invokeForProduction` path.
	const v = result.value
	switch (v.kind) {
		case "permit_enqueue":
			// `mustClearRearm` MUST be an actual boolean (not
			// coerced from undefined). The default decoder uses
			// `=== true` which collapses undefined to false;
			// the strict validator enforces a real boolean.
			if (typeof (v as { mustClearRearm: unknown }).mustClearRearm !== "boolean") {
				_decodeErrorCounter += 1
				return {
					kind: "decode_error",
					reason: "permit_enqueue directive missing boolean mustClearRearm",
					classification: "deferred_completion_barrier_elm_decode_error",
					requestId: expectedRequestId,
				}
			}
			return result
		case "suppress_duplicate":
		case "preserve_barrier":
			return result
		case "reject_stale_identity": {
			const reason = (v as { reason: unknown }).reason
			if (
				reason !== "marker_absent" &&
				reason !== "session_mismatch" &&
				reason !== "task_mismatch" &&
				reason !== "epoch_mismatch"
			) {
				_decodeErrorCounter += 1
				return {
					kind: "decode_error",
					reason: `reject_stale_identity directive has invalid reason=${String(reason)}`,
					classification: "deferred_completion_barrier_elm_decode_error",
					requestId: expectedRequestId,
				}
			}
			return result
		}
		default:
			_decodeErrorCounter += 1
			return {
				kind: "decode_error",
				reason: `unknown directive kind=${String((v as { kind: unknown }).kind)}`,
				classification: "deferred_completion_barrier_elm_decode_error",
				requestId: expectedRequestId,
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
	const requestId = facts.requestId
	if (requestId === null) {
		// REVIEWER P0: the production consult MUST generate a
		// unique requestId and pass it through the wire. A
		// null requestId at the default-invoke seam is a
		// programming error (the public
		// `consultDeferredCompletionBarrierElmKernel` wrapper
		// always sets one).
		_decodeErrorCounter += 1
		return {
			kind: "decode_error",
			reason: "consult produced null requestId; cannot correlate response",
			classification: "deferred_completion_barrier_elm_decode_error",
			requestId: null,
		}
	}
	// C15: pre-serialize to a JSON string so the kernel's
	// `Decode.decodeString` parses it and the strict-typing
	// checks fire.
	const wireValue = JSON.stringify(facts)
	// REVIEWER P0: register a per-requestId pending resolver
	// BEFORE sending the inbound payload. The Elm kernel will
	// emit the outbound message on the next event-loop tick;
	// the pending map dispatches it to this consult's resolver
	// only. A second concurrent consult with a different
	// requestId will register a separate pending entry and
	// will not see this consult's response.
	const response = await new Promise<unknown>((resolve, reject) => {
		const entry: PendingRequest = {
			resolve,
			reject,
			timer: null,
		}
		kernel.pending.set(requestId, entry)
		try {
			kernel.sendInbound(wireValue)
		} catch (err) {
			kernel.pending.delete(requestId)
			reject(err instanceof Error ? err : new Error(String(err)))
		}
	})
	const out = response as OutboundMessage | null
	if (out === null) {
		_decodeErrorCounter += 1
		return {
			kind: "no_decision",
			classification: "deferred_completion_barrier_elm_no_decision",
		}
	}
	return decodeBarrierDirective(out)
}

/**
 * Public consult entry point. Generates a unique `requestId`
 * (when one is not supplied), invokes the kernel, runs the
 * result through the strict public-adapter boundary
 * validator, and returns a typed
 * `DeferredCompletionBarrierElmConsult`.
 *
 * REVIEWER P0: every consult has its own opaque `requestId`;
 * the kernel echoes it; the adapter's pending-map dispatch
 * routes the response to the matching resolver only.
 *
 * REVIEWER P1: every result passes through
 * `validateConsultResult` which enforces the closed
 * directive schema (including mandatory `mustClearRearm`).
 * A custom `invokeForProduction` cannot bypass fail-closed.
 */
export async function consultDeferredCompletionBarrierElmKernel(
	input: DeferredCompletionBarrierFactsInput,
	options?: {
		readonly invokeForProduction?: (facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>
		readonly requestId?: string | null
	},
): Promise<DeferredCompletionBarrierElmConsult> {
	const requestId = options?.requestId ?? nextRequestId()
	const invoke = options?.invokeForProduction ?? defaultInvokeElmKernel
	const facts = buildDeferredCompletionBarrierFactsJson(input, requestId)
	try {
		const result = await invoke(facts)
		// REVIEWER P1: every result passes through the strict
		// public-adapter boundary validator. A custom
		// `invokeForProduction` cannot bypass fail-closed.
		return validateConsultResult(result, requestId)
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
