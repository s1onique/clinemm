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

/**
 * Resolve the absolute path to the compiled Elm kernel JS file.
 */
export function defaultElmKernelPath(): string {
	const url = new URL("../elm/task-header-orchestration/vendor/task-header-orchestration.js", import.meta.url)
	return url.pathname
}

let _kernelEvaluatedOnce = false

/**
 * Ensure the compiled Elm kernel bundle is loaded into `globalThis.Elm`.
 * Idempotent.
 *
 * Mirrors `completion-authority-elm-replay.kernel.ts > evaluateBundleOnce`.
 */
export function ensureElmKernelEvaluated(kernelPath: string): boolean {
	if (_kernelEvaluatedOnce && (globalThis as any).Elm) return true
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		const code = fs.readFileSync(kernelPath, "utf8")
		const evaluator = new Function(code + "; return this.Elm;")
		evaluator()
		_kernelEvaluatedOnce = true
		return true
	} catch {
		return false
	}
}

/**
 * Construct a fresh Elm app instance via `Elm.Main.init({})`.
 */
export function loadCompiledElmKernel(): CompiledElmKernel | null {
	if (cachedKernel) return cachedKernel
	try {
		const mod = (globalThis as any).Elm
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
 * Reset the module-scope cache. Test seam only.
 */
export function resetElmKernelForTests(): void {
	cachedKernel = null
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
