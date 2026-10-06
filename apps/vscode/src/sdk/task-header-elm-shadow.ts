/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C5 / C8)
 *
 * TypeScript adapter for the TaskHeader presentation Elm kernel.
 *
 * Architecture:
 *
 *     raw host facts (already collected by `SdkController.getStateToPostToWebview`)
 *       └─> buildFacts(...)             ← semantic Facts, NOT wire fields
 *       └─> invokeElmKernel(factsJson)  ← single Platform.worker port invocation
 *       └─> decodePresentation(...)     ← fail-closed decode of `kind: "presentation"`
 *       └─> typed TaskHeaderPresentationProjection value
 *
 * The adapter is the THIN BRIDGE between TypeScript and the Elm kernel.
 * It must NEVER:
 *   * re-implement any of the four production rules (R1-R4);
 *   * modify session / task / control state;
 *   * mutate diagnostic refs;
 *   * emit backend telemetry;
 *   * add updater side effects;
 *   * reinterpret Elm decode errors as automatic presentation.
 *
 * During this ACT the existing TS production selector
 * (`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:
 *  selectTaskHeaderPresentation`) remains authoritative. Elm is
 * **differential only**.
 */

import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"

export interface TaskHeaderElmFactsJson {
	readonly canonicalShadowPhase: TurnPhase | null
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly canonicalShadowObservedTurnSeq: number | null
}

export interface TaskHeaderElmPresentationJson {
	readonly phase: TurnPhase
	readonly source: "host" | "shadow" | "legacy"
	readonly seq: number
}

export type TaskHeaderElmDecision =
	| {
			readonly kind: "presentation"
			readonly value: TaskHeaderPresentationProjection
	  }
	| {
			readonly kind: "decode_error"
			readonly reason: string
			readonly classification: "task_header_elm_decode_error"
	  }
	| {
			readonly kind: "kernel_offline"
			readonly classification: "task_header_elm_kernel_offline"
	  }

/**
 * Build the closed `Facts` JSON shape from the production TS selector's
 * input quadruple. No decision logic here.
 */
export function buildFactsJson(input: {
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly canonicalShadowObservedTurnSeq: number | undefined
}): TaskHeaderElmFactsJson {
	return {
		canonicalShadowPhase: input.canonicalShadowPhase ?? null,
		currentLegacyPhase: input.currentLegacyPhase,
		seq: input.seq,
		canonicalShadowObservedTurnSeq: input.canonicalShadowObservedTurnSeq ?? null,
	}
}

/**
 * Returns `true` for any string in the closed `TurnPhase` vocabulary
 * (mirror of `Domain.turnPhaseFromString` in Elm).
 */
export function isTurnPhase(s: unknown): s is TurnPhase {
	return (
		s === "idle" ||
		s === "streaming" ||
		s === "awaiting_approval" ||
		s === "awaiting_followup" ||
		s === "compacting" ||
		s === "completed" ||
		s === "error" ||
		s === "resumable"
	)
}

/**
 * Decode a single Elm outbound `Value` to a TS typed decision. Fail-closed.
 */
export function decodeOutMsg(msg: unknown): TaskHeaderElmDecision {
	if (typeof msg !== "object" || msg === null) {
		return {
			kind: "decode_error",
			reason: `expected object, got ${typeof msg}`,
			classification: "task_header_elm_decode_error",
		}
	}
	const rec = msg as Record<string, unknown>
	switch (rec.kind) {
		case "ready":
			return {
				kind: "decode_error",
				reason: "kernel emitted `ready` (no presentation payload)",
				classification: "task_header_elm_decode_error",
			}
		case "presentation": {
			const pres = rec.presentation
			if (typeof pres !== "object" || pres === null) {
				return {
					kind: "decode_error",
					reason: "presentation payload missing or non-object",
					classification: "task_header_elm_decode_error",
				}
			}
			const p = pres as Record<string, unknown>
			const phase = p.phase
			const source = p.source
			const seq = p.seq
			if (typeof phase !== "string" || !isTurnPhase(phase)) {
				return {
					kind: "decode_error",
					reason: `unknown phase tag: ${String(phase)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			if (source !== "host" && source !== "shadow" && source !== "legacy") {
				return {
					kind: "decode_error",
					reason: `unknown source tag: ${String(source)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			if (typeof seq !== "number" || !Number.isFinite(seq) || !Number.isInteger(seq)) {
				return {
					kind: "decode_error",
					reason: `seq must be a finite integer, got ${String(seq)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			return {
				kind: "presentation",
				value: { phase, source, seq },
			}
		}
		case "decode_error":
			return {
				kind: "decode_error",
				reason: typeof rec.error === "string" ? rec.error : "kernel decode_error (no message)",
				classification: "task_header_elm_decode_error",
			}
		default:
			return {
				kind: "decode_error",
				reason: `unknown outbound kind: ${String(rec.kind)}`,
				classification: "task_header_elm_decode_error",
			}
	}
}

export interface CompiledElmKernel {
	sendInbound(value: unknown): void
	recvOutbound(): unknown
}

let cachedKernel: CompiledElmKernel | null = null
const _cachedKernelBundleSig: string | null = null

/**
 * Resolve the absolute path to the compiled Elm kernel JS file.
 */
export function defaultElmKernelPath(): string {
	const url = new URL("../../elm/task-header-orchestration/vendor/task-header-orchestration.js", import.meta.url)
	return url.pathname
}

let _kernelEvaluatedOnce = false

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Sandboxed namespace the TaskHeader Elm kernel writes its `Elm`
 * exports into. Isolation from `globalThis.Elm` is the architectural
 * reason this seam is wired this way (see `ensureElmKernelEvaluated`
 * JSDoc); the completion-authority kernel already occupies
 * `globalThis.Elm`, so the TaskHeader kernel MUST NOT also write there
 * or its `_Platform_export` call crashes with
 * `_Debug_crash(6, 'Elm')` ("Your page is loading multiple Elm
 * scripts with a module named Elm").
 */
interface TaskHeaderElmNamespace {
	readonly Main?: {
		readonly init: (flags: unknown) => {
			readonly ports: {
				readonly inbound: { send: (v: unknown) => void }
				readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
			}
		}
	}
}
let _taskHeaderKernelNamespace: TaskHeaderElmNamespace | null = null

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Ensure the compiled TaskHeader Elm kernel bundle is loaded into a
 * SANDBOXED namespace object. Idempotent.
 *
 * Why sandboxed (the runtime-codec repair):
 *
 * The Elm0.19.2 IIFE pattern at the tail of every compiled kernel is
 * `(function(scope){...}(this))`. The IIFE's parameter `scope`
 * receives `this` from the outer call site, and `_Platform_export`
 * writes the kernel's `Elm` exports to `scope['Elm']`. The original
 * completion-authority loader evaluates with the outer wrapper function
 * in non-strict mode, so `this` resolves to `globalThis` and the
 * IIFE writes the kernel's exports to `globalThis.Elm.Main`. That is
 * fine for the FIRST kernel to load. The SECOND kernel's
 * `_Platform_export` call detects the existing `globalThis.Elm`,
 * walks `_Platform_mergeExportsProd` /
 * `_Platform_mergeExportsDebug`, and trips on `Main.init` —
 * `_Debug_crash(6, 'Elm')`. The TS wrapper around the
 * `evaluateBundleOnce` call swallows the throw, `globalThis.Elm`
 * remains pointing at the FIRST kernel, and `loadCompiledElmKernel`
 * then returns the FIRST kernel's `Elm.Main.init`, which decodes a
 * DIFFERENT message envelope. The 512/512 LIVE "Expecting an OBJECT
 * with a field named `tag`" decode errors are the completion-
 * authority's `Decode.field "tag"` failing on TaskHeader's flat
 * `Facts` quadruple — a fail-closed rejection of the wrong shape by
 * the WRONG kernel, masquerading as a TaskHeader decoder defect.
 *
 * The repair routes the TaskHeader kernel through a per-kernel
 * namespace object that is NEVER `globalThis`. We invoke the wrapper
 * via `evaluator.call(namespace, namespace)` so the outer `this` is
 * `namespace`; the IIFE then receives `namespace` as its `scope`
 * argument and writes `namespace.Elm = exports`. The captured
 * `namespace.Elm` is the TaskHeader kernel's exports — fully
 * isolated from any other kernel that may share the same process.
 *
 * Mechanism (matches the proven
 * `completion-authority-elm-replay.kernel.ts` shape, with the .call
 * binding the OUTER `this` to a private object instead of letting it
 * fall through to `globalThis`):
 *
 *   new Function("scope", code + "; return this;")
 *     .call(namespace, namespace)
 *     -> reads back `namespace.Elm` for `loadCompiledElmKernel`
 *
 * The appended `; return this;` sentinel runs AFTER the IIFE and
 * reads the wrapper's bound `thisArg`. With `.call(namespace, ...)`
 * that is `namespace` — and `namespace.Elm` is the kernel's exports.
 */
export function ensureElmKernelEvaluated(kernelPath: string): boolean {
	if (_kernelEvaluatedOnce && _taskHeaderKernelNamespace) return true
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		const code = fs.readFileSync(kernelPath, "utf8")
		const namespace: Record<string, unknown> = {}
		const evaluator = new Function("scope", code + "; return this;")
		evaluator.call(namespace, namespace)
		const kernelExports = (namespace as { Elm?: TaskHeaderElmNamespace }).Elm ?? null
		if (!kernelExports || typeof kernelExports.Main?.init !== "function") {
			Logger.error(
				"[task-header-elm-shadow] kernel bundle did not expose TaskHeaderElmNamespace.Elm.Main.init after sandboxed evaluation",
			)
			return false
		}
		_taskHeaderKernelNamespace = kernelExports
		_kernelEvaluatedOnce = true
		return true
	} catch (err) {
		Logger.error(`[task-header-elm-shadow] failed to load Elm kernel bundle: ${err}`)
		return false
	}
}

// Bump when the kernel bundle format changes; ensures stale evaluations
// are re-evaluated. Mirrors the completion-authority convention of
// gating the cache by path.
export const _TASK_HEADER_ELM_KERNEL_BUNDLE_SIG = "v2"

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Construct a fresh TaskHeader Elm app instance via
 * `Elm.Main.init({})` from the SANDBOXED namespace captured by
 * `ensureElmKernelEvaluated`.
 *
 * CRITICAL: this MUST read from `_taskHeaderKernelNamespace`, NOT
 * `globalThis.Elm`. Reading from `globalThis.Elm` is the production
 * bug — the completion-authority kernel already occupies that
 * namespace, so any value read there belongs to the completion-
 * authority kernel, not TaskHeader. See `ensureElmKernelEvaluated`
 * JSDoc for the full causal chain.
 */
export function loadCompiledElmKernel(): CompiledElmKernel | null {
	if (cachedKernel) return cachedKernel
	try {
		const mod = _taskHeaderKernelNamespace
		if (!mod || typeof mod.Main?.init !== "function") {
			return null
		}
		const app = mod.Main.init({})
		if (!app || !app.ports || !app.ports.inbound || !app.ports.outbound) {
			return null
		}
		let lastOutbound: unknown = null
		app.ports.outbound.subscribe((v: unknown) => {
			lastOutbound = v
		})
		cachedKernel = {
			sendInbound(value: unknown) {
				lastOutbound = null
				app.ports.inbound.send(value)
			},
			recvOutbound() {
				return lastOutbound
			},
		}
		return cachedKernel
	} catch {
		return null
	}
}

/**
 * Reset the module-scope caches. Test seam only.
 */
export function resetElmKernelForTests(): void {
	cachedKernel = null
	_taskHeaderKernelNamespace = null
	_kernelEvaluatedOnce = false
}

/**
 * Invoke the compiled Elm kernel with the given semantic `Facts`,
 * returning a typed `TaskHeaderElmDecision`. Fail-closed.
 */
export async function invokeElmKernel(factsJson: TaskHeaderElmFactsJson): Promise<TaskHeaderElmDecision> {
	ensureElmKernelEvaluated(defaultElmKernelPath())
	const kernel = loadCompiledElmKernel()
	if (!kernel) {
		return { kind: "kernel_offline", classification: "task_header_elm_kernel_offline" }
	}
	kernel.sendInbound(factsJson)
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	const out = kernel.recvOutbound()
	if (out === null) {
		return {
			kind: "decode_error",
			reason: "kernel emitted no outbound message",
			classification: "task_header_elm_decode_error",
		}
	}
	return decodeOutMsg(out)
}

// ============================================================================
// ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-RUNTIME-SHADOW-QUALIFICATION
//
// RUNTIME-SHADOW OBSERVER (production-side seam).
//
// The runtime shadow observer attaches to the SAME
// `selectTaskHeaderPresentation` call the SdkController publication block
// invokes at `apps/vscode/src/sdk/SdkController.ts:5883-5902`, and
// drives the proven Elm kernel against the SAME `Facts` quadruple
// the production TS selector consumes. The TS result remains the
// authoritative production return value in EVERY branch; the Elm
// result is captured into a bounded observation ring for differential
// verification only.
//
// Hard invariants:
//   - DEFAULT_OFF. The runtime shadow is disabled unless the dogfood
//     diagnostic profile (env-var gated) explicitly arms it.
//   - Fail-closed. `kernel_offline` / `decode_error` produce a
//     bounded observation; the publication return value is unchanged.
//   - Non-blocking. The shadow comparison runs synchronously after
//     the TS result is computed; it does NOT mutate state, write to
//     a wire field, or alter the returned `taskHeaderPresentation`.
//   - Privacy-safe. The observation ring carries only the bounded
//     semantic facts (TS / Elm projections + the four inputs);
//     never prompt text, model output, MCP contents, or file paths.
//   - Authority preservation. NO Elm decision can ever change the
//     returned TS projection. The comparison result is observe-only.
//
// REMOVAL_TRIGGER (per Factory doctrine on temporary diagnostics):
//   first successful LIVE shadow observation of MATCH across the
//   required semantic-phase matrix that authorizes TaskHeader
//   authority cutover (ORCHESTRATION03-AUTHORITY), OR
//   the first real semantic mismatch (TS != Elm on a real published
//   state) that identifies a contract defect, OR
//   CAPTURE_INSUFFICIENT.
// No quiet promotion to architecture. When cutover lands, REMOVE
// this observer together with the dogfood profile knob +
// `applyTaskHeaderElmRuntimeShadowDiagnosticProfile` +
// `runtime-assets/task-header-orchestration.js` staging + the wiring
// in `SdkController.ts` + the wiring in `extension.ts:activate`.
// ============================================================================

export type TaskHeaderElmRuntimeShadowClassification =
	| "MATCH"
	| "MISMATCH_PHASE"
	| "MISMATCH_SOURCE"
	| "MISMATCH_SEQ"
	| "ELM_KERNEL_OFFLINE"
	| "ELM_DECODE_ERROR"

export interface TaskHeaderElmRuntimeShadowObservation {
	readonly capturedAt: number
	readonly classification: TaskHeaderElmRuntimeShadowClassification
	readonly ts: {
		readonly phase: TurnPhase
		readonly source: "host" | "shadow" | "legacy"
		readonly seq: number
	}
	readonly elm:
		| {
				readonly kind: "presentation"
				readonly phase: TurnPhase
				readonly source: "host" | "shadow" | "legacy"
				readonly seq: number
		  }
		| { readonly kind: "kernel_offline" }
		| { readonly kind: "decode_error"; readonly reason: string }
	readonly inputs: {
		readonly canonicalShadowPhase: TurnPhase | null
		readonly currentLegacyPhase: TurnPhase
		readonly seq: number
		readonly canonicalShadowObservedTurnSeq: number | null
	}
}

/**
 * Classify a single TS-vs-Elm comparison into a bounded string. The
 * matcher compares ONLY the three semantic outputs the production
 * selector returns (`phase`, `source`, `seq`); it intentionally does
 * NOT compare wire encoding, object reference, or JSON-stringified
 * formatting.
 */
export function classifyTaskHeaderElmShadowComparison(
	ts: TaskHeaderPresentationProjection,
	elm: TaskHeaderElmDecision,
): TaskHeaderElmRuntimeShadowClassification {
	if (elm.kind === "kernel_offline") return "ELM_KERNEL_OFFLINE"
	if (elm.kind === "decode_error") return "ELM_DECODE_ERROR"
	if (ts.phase !== elm.value.phase) return "MISMATCH_PHASE"
	if (ts.source !== elm.value.source) return "MISMATCH_SOURCE"
	if (ts.seq !== elm.value.seq) return "MISMATCH_SEQ"
	return "MATCH"
}

// ----------------------------------------------------------------------------
// Bounded observation ring (test seam; default singleton)
// ----------------------------------------------------------------------------

export interface TaskHeaderElmRuntimeShadowSink {
	push(observation: TaskHeaderElmRuntimeShadowObservation): void
	readonly size: number
	readonly snapshot: readonly TaskHeaderElmRuntimeShadowObservation[]
	clear(): void
	/**
	 * Test seam — change the bounded ring capacity. Used by
	 * summary / report tests to force the eviction policy on
	 * small inputs. NOT consumed in production code paths.
	 */
	setCapacity?(capacity: number): void
}

const DEFAULT_RING_SIZE = 512

class ArrayRingSink implements TaskHeaderElmRuntimeShadowSink {
	private readonly buf: TaskHeaderElmRuntimeShadowObservation[] = []
	private cap: number = DEFAULT_RING_SIZE

	push(observation: TaskHeaderElmRuntimeShadowObservation): void {
		this.buf.push(observation)
		while (this.buf.length > this.cap) {
			this.buf.shift()
		}
	}

	get size(): number {
		return this.buf.length
	}

	get snapshot(): readonly TaskHeaderElmRuntimeShadowObservation[] {
		return this.buf
	}

	clear(): void {
		this.buf.length = 0
	}

	setCapacity(capacity: number): void {
		if (capacity < 1) {
			throw new Error(`setCapacity: capacity must be >= 1, got ${capacity}`)
		}
		this.cap = capacity
		while (this.buf.length > this.cap) {
			this.buf.shift()
		}
	}
}

// Module-instance invariant: the runtime state lives on `globalThis`
// under fixed symbols. This means the production bundle and the
// vitest direct import share the SAME state regardless of how the
// bundler resolves duplicate paths. Mirrors the completion-authority
// pattern in `completion-authority-elm-shadow.ts`.

const SHARED_GLOBAL_SINK_KEY = Symbol.for("__clineEmmTaskHeaderElmRuntimeShadowSink")
const SHARED_GLOBAL_ENABLED_KEY = Symbol.for("__clineEmmTaskHeaderElmRuntimeShadowEnabled")

function getOrInitSharedRingSink(): TaskHeaderElmRuntimeShadowSink {
	const g = globalThis as unknown as Record<symbol, TaskHeaderElmRuntimeShadowSink | undefined>
	let sink = g[SHARED_GLOBAL_SINK_KEY]
	if (!sink) {
		sink = new ArrayRingSink()
		g[SHARED_GLOBAL_SINK_KEY] = sink
	}
	return sink
}

function isRuntimeShadowEnabled(): boolean {
	const g = globalThis as unknown as Record<symbol, boolean | undefined>
	return g[SHARED_GLOBAL_ENABLED_KEY] === true
}

/**
 * Test seam — flips the runtime-shadow enabled state. Production
 * activation is performed by the central dogfood diagnostic profile
 * resolver (see `dogfood-diagnostic-profile.ts`); direct callers
 * MUST be limited to test fixtures and the activation helper itself.
 */
export function setTaskHeaderElmRuntimeShadowEnabled(enabled: boolean): void {
	const g = globalThis as unknown as Record<symbol, boolean | undefined>
	g[SHARED_GLOBAL_ENABLED_KEY] = enabled
}

export function isTaskHeaderElmRuntimeShadowEnabled(): boolean {
	return isRuntimeShadowEnabled()
}

/**
 * Test seam — overrides the default ring sink. Tests use this to
 * capture observations deterministically (the default global sink is
 * also reachable through `getTaskHeaderElmRuntimeShadowObservations`).
 */
export function setTaskHeaderElmRuntimeShadowSink(
	sink: TaskHeaderElmRuntimeShadowSink | null,
): TaskHeaderElmRuntimeShadowSink | null {
	const g = globalThis as unknown as Record<symbol, TaskHeaderElmRuntimeShadowSink | undefined>
	const prev = g[SHARED_GLOBAL_SINK_KEY] ?? null
	if (sink === null) {
		delete g[SHARED_GLOBAL_SINK_KEY]
	} else {
		g[SHARED_GLOBAL_SINK_KEY] = sink
	}
	return prev
}

export function getTaskHeaderElmRuntimeShadowSink(): TaskHeaderElmRuntimeShadowSink | null {
	const g = globalThis as unknown as Record<symbol, TaskHeaderElmRuntimeShadowSink | undefined>
	return g[SHARED_GLOBAL_SINK_KEY] ?? null
}

export function getTaskHeaderElmRuntimeShadowObservations(): readonly TaskHeaderElmRuntimeShadowObservation[] {
	const sink = getTaskHeaderElmRuntimeShadowSink() ?? getOrInitSharedRingSink()
	return sink.snapshot
}

export function clearTaskHeaderElmRuntimeShadowObservations(): void {
	const sink = getTaskHeaderElmRuntimeShadowSink() ?? getOrInitSharedRingSink()
	sink.clear()
}

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS:
 * Operator-facing alias for the Command Palette diagnostic's
 * "Reset Observations" action. Same semantic as
 * {@link clearTaskHeaderElmRuntimeShadowObservations}: clear the
 * bounded observation ring only. MUST NOT touch the enabled flag,
 * the TS presentation, the Elm kernel state, or any other
 * production state.
 */
export function resetTaskHeaderElmRuntimeShadowObservations(): void {
	clearTaskHeaderElmRuntimeShadowObservations()
}

export function getTaskHeaderElmRuntimeShadowBufferSize(): number {
	return DEFAULT_RING_SIZE
}

/**
 * Test seam — change the bounded ring capacity. Delegates to the
 * active sink's `setCapacity`. Used by summary / report tests to
 * force the eviction policy on small inputs.
 */
export function setTaskHeaderElmRuntimeShadowBufferSize(capacity: number): void {
	const sink = getTaskHeaderElmRuntimeShadowSink() ?? getOrInitSharedRingSink()
	if (typeof sink.setCapacity === "function") {
		sink.setCapacity(capacity)
	}
}

// ---------------------------------------------------------------------------
// Summary + report (Command Palette diagnostic surface)
// ---------------------------------------------------------------------------

export interface TaskHeaderElmRuntimeShadowSummary {
	readonly evaluations: number
	readonly matches: number
	readonly mismatchPhase: number
	readonly mismatchSource: number
	readonly mismatchSeq: number
	readonly kernelOffline: number
	readonly decodeErrors: number
}

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS:
 * Pure aggregator — fold the bounded observation ring into the
 * seven summary counters. The ring itself is the source of truth
 * (no parallel mutable counters); the summary is re-derivable on
 * every invocation.
 *
 * Counted classifications (closed set, mirrors the bounded
 * `TaskHeaderElmRuntimeShadowClassification` union):
 *   - MATCH                -> matches
 *   - MISMATCH_PHASE       -> mismatchPhase
 *   - MISMATCH_SOURCE      -> mismatchSource
 *   - MISMATCH_SEQ         -> mismatchSeq
 *   - ELM_KERNEL_OFFLINE   -> kernelOffline
 *   - ELM_DECODE_ERROR     -> decodeErrors
 *
 * `evaluations` is the total of all six counters — i.e. the number
 * of ring entries (post-eviction). This is the SAME number as
 * `observations.length`.
 */
export function summarizeTaskHeaderElmRuntimeShadowObservations(
	observations: readonly TaskHeaderElmRuntimeShadowObservation[],
): TaskHeaderElmRuntimeShadowSummary {
	let matches = 0
	let mismatchPhase = 0
	let mismatchSource = 0
	let mismatchSeq = 0
	let kernelOffline = 0
	let decodeErrors = 0
	for (const obs of observations) {
		switch (obs.classification) {
			case "MATCH":
				matches++
				break
			case "MISMATCH_PHASE":
				mismatchPhase++
				break
			case "MISMATCH_SOURCE":
				mismatchSource++
				break
			case "MISMATCH_SEQ":
				mismatchSeq++
				break
			case "ELM_KERNEL_OFFLINE":
				kernelOffline++
				break
			case "ELM_DECODE_ERROR":
				decodeErrors++
				break
		}
	}
	const evaluations = matches + mismatchPhase + mismatchSource + mismatchSeq + kernelOffline + decodeErrors
	return {
		evaluations,
		matches,
		mismatchPhase,
		mismatchSource,
		mismatchSeq,
		kernelOffline,
		decodeErrors,
	}
}

const REPORT_RECENT_OBSERVATIONS = 10

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS:
 * Pure formatter — produce the compact diagnostic report the
 * Command Palette surfaces. Includes the seven summary counters and
 * the most-recent bounded observations (last 10 by default; older
 * observations are elided in the tail with `…`).
 *
 * The report carries ONLY bounded semantic facts (TS projection,
 * Elm projection, classification, the four-input `Facts` quadruple)
 * — never prompt text, model output, MCP contents, or file paths.
 */
export function formatTaskHeaderElmRuntimeShadowReport(observations: readonly TaskHeaderElmRuntimeShadowObservation[]): string {
	const summary = summarizeTaskHeaderElmRuntimeShadowObservations(observations)
	const lines: string[] = []
	lines.push("Task Header Elm Runtime Shadow")
	lines.push("")
	lines.push(`evaluations:      ${summary.evaluations}`)
	lines.push(`matches:          ${summary.matches}`)
	lines.push(`mismatchPhase:    ${summary.mismatchPhase}`)
	lines.push(`mismatchSource:   ${summary.mismatchSource}`)
	lines.push(`mismatchSeq:      ${summary.mismatchSeq}`)
	lines.push(`kernelOffline:    ${summary.kernelOffline}`)
	lines.push(`decodeErrors:     ${summary.decodeErrors}`)
	if (observations.length > 0) {
		lines.push("")
		const tail = observations.slice(-REPORT_RECENT_OBSERVATIONS)
		const omitted = observations.length - tail.length
		// Label each retained observation with its 1-based position in
		// the ring's current view. The `seq` field inside the inputs
		// block carries the production-side seq so the operator can
		// reconcile the position with the actual turn sequence.
		let i = 1
		for (const obs of tail) {
			lines.push("")
			lines.push(`#${i}`)
			lines.push("inputs:")
			lines.push(`  canonicalShadowPhase:              ${obs.inputs.canonicalShadowPhase ?? "null"}`)
			lines.push(`  currentLegacyPhase:                ${obs.inputs.currentLegacyPhase}`)
			lines.push(`  seq:                               ${obs.inputs.seq}`)
			lines.push(`  canonicalShadowObservedTurnSeq:    ${obs.inputs.canonicalShadowObservedTurnSeq ?? "null"}`)
			lines.push("ts:")
			lines.push(`  phase:  ${obs.ts.phase}`)
			lines.push(`  source: ${obs.ts.source}`)
			lines.push(`  seq:    ${obs.ts.seq}`)
			lines.push("elm:")
			if (obs.elm.kind === "presentation") {
				lines.push("  presentation:")
				lines.push(`    phase:  ${obs.elm.phase}`)
				lines.push(`    source: ${obs.elm.source}`)
				lines.push(`    seq:    ${obs.elm.seq}`)
			} else if (obs.elm.kind === "kernel_offline") {
				lines.push("  kernel_offline")
			} else {
				lines.push("  decode_error:")
				lines.push(`    reason: ${obs.elm.reason}`)
			}
			lines.push("classification:")
			lines.push(`  ${obs.classification}`)
			i++
		}
		if (omitted > 0) {
			lines.push("")
			lines.push(`… ${omitted} older observation(s) omitted`)
		}
	}
	return lines.join("\n")
}

/**
 * Reset ALL runtime-shadow module seams (enabled flag + ring sink +
 * observations). Test seam only.
 */
export function resetTaskHeaderElmRuntimeShadowForTests(): void {
	setTaskHeaderElmRuntimeShadowEnabled(false)
	const g = globalThis as unknown as Record<symbol, TaskHeaderElmRuntimeShadowSink | boolean | undefined>
	delete g[SHARED_GLOBAL_SINK_KEY]
	delete g[SHARED_GLOBAL_ENABLED_KEY]
}

// ----------------------------------------------------------------------------
// Comparison seam (production invocation point)
// ----------------------------------------------------------------------------

/**
 * The production runtime-shadow comparison seam. Invoked at the
 * `SdkController.getStateToPostToWebview()` publication block
 * (`apps/vscode/src/sdk/SdkController.ts:5883-5902`) immediately
 * AFTER the production TS selector returns its authoritative
 * projection. The TS result is the production return value in EVERY
 * branch; the Elm result is captured into the bounded observation
 * ring for differential verification only.
 *
 * DEFAULT_OFF: when the dogfood diagnostic profile has not armed the
 * runtime-shadow flag, the function returns IMMEDIATELY without
 * invoking the kernel, comparing the results, or mutating any ring.
 * The returned TS projection is the same object the caller passed in
 * (no allocation, no transformation, no wire delta).
 *
 * Failure conservation: when the Elm kernel is offline, its decoder
 * rejects the inbound payload, or the kernel itself throws, the
 * observation still captures the TS projection + the bounded Elm
 * classification, and the returned TS projection is still the
 * production return value. There is no path through this function
 * that can change the production projection.
 *
 * Dependency injection (test seam): `invokeElmForProduction` lets
 * tests inject a fake Elm provider so they can drive deliberate
 * mismatch REDs without mutating global module state or
 * `globalThis.Elm`.
 */
export async function observeTaskHeaderElmRuntimeShadow(args: {
	readonly ts: TaskHeaderPresentationProjection
	readonly facts: TaskHeaderElmFactsJson
	readonly invokeElmForProduction?: (facts: TaskHeaderElmFactsJson) => Promise<TaskHeaderElmDecision>
}): Promise<TaskHeaderPresentationProjection> {
	const { ts, facts } = args
	if (!isRuntimeShadowEnabled()) {
		return ts
	}
	const sink = getTaskHeaderElmRuntimeShadowSink() ?? getOrInitSharedRingSink()
	let elmDecision: TaskHeaderElmDecision
	try {
		const invoke = args.invokeElmForProduction ?? invokeElmKernel
		elmDecision = await invoke(facts)
	} catch (err) {
		// The Elm runtime MUST be fail-closed; if it throws, we still
		// produce a bounded observation and keep the TS result as the
		// production return value.
		Logger.error(`[task-header-elm-runtime-shadow] kernel threw: ${err instanceof Error ? err.message : String(err)}`)
		const observation: TaskHeaderElmRuntimeShadowObservation = {
			capturedAt: Date.now(),
			classification: "ELM_DECODE_ERROR",
			ts: { phase: ts.phase, source: ts.source, seq: ts.seq },
			elm: {
				kind: "decode_error",
				reason: `kernel threw: ${err instanceof Error ? err.message : String(err)}`,
			},
			inputs: facts,
		}
		try {
			sink.push(observation)
		} catch {
			// never propagate
		}
		return ts
	}
	const classification = classifyTaskHeaderElmShadowComparison(ts, elmDecision)
	const observation: TaskHeaderElmRuntimeShadowObservation = {
		capturedAt: Date.now(),
		classification,
		ts: { phase: ts.phase, source: ts.source, seq: ts.seq },
		elm:
			elmDecision.kind === "presentation"
				? {
						kind: "presentation",
						phase: elmDecision.value.phase,
						source: elmDecision.value.source,
						seq: elmDecision.value.seq,
					}
				: elmDecision.kind === "kernel_offline"
					? { kind: "kernel_offline" }
					: { kind: "decode_error", reason: elmDecision.reason },
		inputs: facts,
	}
	try {
		sink.push(observation)
	} catch {
		// never propagate — the runtime shadow MUST NEVER alter the
		// production return value.
	}
	if (classification !== "MATCH") {
		Logger.warn(
			`[task-header-elm-runtime-shadow] ${classification}: ` +
				`ts=${JSON.stringify({ phase: ts.phase, source: ts.source, seq: ts.seq })} ` +
				`elm=${JSON.stringify(elmDecision)}`,
		)
	}
	return ts
}
