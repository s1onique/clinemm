/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-CORRECTION01-FAILURE-CACHE-SCOPE
 *
 * C3 / C4 / C13 — Authority cutover RED witness for the
 * TaskHeader presentation publication seam.
 *
 * EVIDENCE CLASSIFICATION: REAL_PRODUCTION_SEAM.
 *
 * The test exercises the ACTUAL production TaskHeader projection
 * seam reachable through the extracted production-side authority
 * helper `pickTaskHeaderPresentationForPublication(inputs)` in
 * `apps/vscode/src/sdk/task-header-elm-authority.ts`. The helper is
 * the SOLE production presentation authority for the Elm kernel.
 *
 * Pre-cutover witness (TS selector + Elm comparison shadow):
 *   Elm decision != TS decision   (injected seam only)
 *   production result == TS
 *
 * Post-cutover expectation (Elm sole authority):
 *   production result == Elm (via real invokeElmKernel or DI)
 *
 * CORRECTION01-FAILURE-CACHE-SCOPE:
 *   The "hold last good" policy was REMOVED. On any failure
 *   (`kernel_offline`, `decode_error`, or synchronous throw), the
 *   helper returns the bounded sentinel
 *   `{ phase: "idle", source: "host", seq: inputs.seq }`
 *   using the CURRENT input.seq. The tests below were rewritten
 *   to assert that the bounded sentinel is used and the previous
 *   `seq` is NOT carried over (seq-preservation invariant).
 */

import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it } from "vitest"
import { pickTaskHeaderPresentationForPublication, resetTaskHeaderElmAuthorityForTests } from "../task-header-elm-authority"
import { invokeElmKernel, type TaskHeaderElmDecision, type TaskHeaderElmFactsJson } from "../task-header-elm-shadow"

function inputs(opts: {
	canonicalShadowPhase: TurnPhase | undefined
	currentLegacyPhase: TurnPhase
	seq: number
	canonicalShadowObservedTurnSeq?: number
}): {
	canonicalShadowPhase: TurnPhase | undefined
	currentLegacyPhase: TurnPhase
	seq: number
	canonicalShadowObservedTurnSeq: number | undefined
} {
	return {
		canonicalShadowPhase: opts.canonicalShadowPhase,
		currentLegacyPhase: opts.currentLegacyPhase,
		seq: opts.seq,
		canonicalShadowObservedTurnSeq: opts.canonicalShadowObservedTurnSeq,
	}
}
describe("ACT-CLINEMM-...-ORCHESTRATION03-AUTHORITY / C3 RED witness — authority switch pinned", () => {
	it("C3-CUTOVER-01: the production seam drives the Elm kernel and returns the Elm projection (DI)", async () => {
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "streaming", source: "shadow", seq: 99 },
		})
		const result = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 1,
			}),
			{ invokeElmForProduction: fakeElm },
		)
		expect(result).toStrictEqual({ phase: "streaming", source: "shadow", seq: 99 })
	})

	it("C3-CUTOVER-02: production seam does not silently fall back to TS when Elm differs (DI)", async () => {
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "compacting", source: "host", seq: 7 },
		})
		const result = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 7,
			}),
			{ invokeElmForProduction: fakeElm },
		)
		expect(result).toStrictEqual({ phase: "compacting", source: "host", seq: 7 })
	})

	it("C3-CUTOVER-04: kernel_offline falls closed to the bounded sentinel with CURRENT seq (DI)", async () => {
		// First publish a successful Elm result to populate the previous
		// cache (CORRECTION01: this cached state is now inert; the
		// helper will NOT carry it forward).
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 11,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "streaming", source: "shadow", seq: 11 },
				}),
			},
		)

		// Now simulate a kernel_offline failure at a different seq.
		const offlineElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "kernel_offline",
			classification: "task_header_elm_kernel_offline",
		})
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 12,
			}),
			{ invokeElmForProduction: offlineElm },
		)
		// CORRECTION01: bounded sentinel with the CURRENT input.seq,
		// NOT the held `phase: "streaming", source: "shadow", seq: 11`.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 12 })
	})

	it("C3-CUTOVER-05: decode_error falls closed to the bounded sentinel with CURRENT seq (DI)", async () => {
		// First publish a successful Elm result to populate the previous
		// cache (CORRECTION01: this cached state is now inert; the
		// helper will NOT carry it forward).
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "awaiting_approval",
				currentLegacyPhase: "idle",
				seq: 21,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "awaiting_approval", source: "shadow", seq: 21 },
				}),
			},
		)

		// Now simulate a decode_error at a different seq.
		const badElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "decode_error",
			reason: "synthetic-decode-error",
			classification: "task_header_elm_decode_error",
		})
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 22,
			}),
			{ invokeElmForProduction: badElm },
		)
		// CORRECTION01: bounded sentinel with the CURRENT input.seq.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 22 })
	})

	it("C3-CUTOVER-06: no cached presentation yet + kernel offline -> bounded idle host sentinel (DI)", async () => {
		const offlineElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "kernel_offline",
			classification: "task_header_elm_kernel_offline",
		})
		const result = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
			{ invokeElmForProduction: offlineElm },
		)
		expect(result).toStrictEqual({ phase: "idle", source: "host", seq: 1 })
	})

	it("C3-CUTOVER-07: no cached presentation yet + decode_error -> bounded idle host sentinel (DI)", async () => {
		const badElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "decode_error",
			reason: "synthetic",
			classification: "task_header_elm_decode_error",
		})
		const result = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
				seq: 5,
			}),
			{ invokeElmForProduction: badElm },
		)
		expect(result).toStrictEqual({ phase: "idle", source: "host", seq: 5 })
	})
})

beforeEach(() => {
	resetTaskHeaderElmAuthorityForTests()
})
describe("ACT-CLINEMM-...-ORCHESTRATION03-AUTHORITY / C13 authority test matrix — REAL production seam, REAL invokeElmKernel", () => {
	const realInvokeCases: ReadonlyArray<{
		label: string
		inputs: ReturnType<typeof inputs>
		expected: TaskHeaderPresentationProjection
	}> = [
		{
			label: "AUTH-01 idle (legacy absence)",
			inputs: inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
			expected: { phase: "idle", source: "legacy", seq: 1 },
		},
		{
			label: "AUTH-02 streaming (legacy)",
			inputs: inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "streaming",
				seq: 2,
			}),
			expected: { phase: "streaming", source: "legacy", seq: 2 },
		},
		{
			label: "AUTH-03 completed (legacy)",
			inputs: inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "completed",
				seq: 3,
			}),
			expected: { phase: "completed", source: "legacy", seq: 3 },
		},
		{
			label: "AUTH-04 host compaction override",
			inputs: inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "compacting",
				seq: 4,
			}),
			expected: { phase: "compacting", source: "host", seq: 4 },
		},
		{
			label: "AUTH-05 host awaiting followup",
			inputs: inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "awaiting_followup",
				seq: 5,
			}),
			expected: { phase: "awaiting_followup", source: "host", seq: 5 },
		},
		{
			label: "AUTH-06 canonical shadow accepted (fresh stamp)",
			inputs: inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 6,
				canonicalShadowObservedTurnSeq: 6,
			}),
			expected: { phase: "streaming", source: "shadow", seq: 6 },
		},
		{
			label: "AUTH-07 UNBOUND canonical demoted to legacy",
			inputs: inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 7,
			}),
			expected: { phase: "streaming", source: "legacy", seq: 7 },
		},
		{
			label: "AUTH-08 legacy absence (no canonical shadow) + error legacy -> R2.5 host authority (PTBPC01)",
			inputs: inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "error",
				seq: 8,
			}),
			// ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01:
			// the R2.5 Elm policy correction extends host authority
			// to `error` and `resumable`. The host's `error` write
			// wins over the absence-fallback, source=host (parallel
			// to R1's `compacting` and R2's `awaiting_followup`).
			expected: { phase: "error", source: "host", seq: 8 },
		},
		{
			label: "AUTH-09 seq preservation",
			inputs: inputs({
				canonicalShadowPhase: "awaiting_approval",
				currentLegacyPhase: "idle",
				seq: 9999,
				canonicalShadowObservedTurnSeq: 9999,
			}),
			expected: { phase: "awaiting_approval", source: "shadow", seq: 9999 },
		},
	]

	for (const tc of realInvokeCases) {
		it(`${tc.label} → result == Elm`, async () => {
			const result = await pickTaskHeaderPresentationForPublication(tc.inputs)
			expect(result).toStrictEqual(tc.expected)
		})
	}

	it("AUTH-10 malformed Elm output → bounded sentinel with CURRENT seq (DI)", async () => {
		// CORRECTION01: cache is gone. The previous successful result is
		// NOT carried forward. The bounded sentinel uses the CURRENT
		// input.seq.
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "streaming", source: "legacy", seq: 1 },
				}),
			},
		)
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 2,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "decode_error",
					reason: "synthetic-malformed",
					classification: "task_header_elm_decode_error",
				}),
			},
		)
		// CORRECTION01: NOT `phase: "streaming", source: "legacy", seq: 1`.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 2 })
	})

	it("AUTH-11 kernel offline → bounded sentinel with CURRENT seq (DI)", async () => {
		// CORRECTION01: cache is gone. The bounded sentinel uses the
		// CURRENT input.seq.
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "awaiting_followup", source: "host", seq: 1 },
				}),
			},
		)
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 2,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "kernel_offline",
					classification: "task_header_elm_kernel_offline",
				}),
			},
		)
		// CORRECTION01: NOT `phase: "awaiting_followup", source: "host", seq: 1`.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 2 })
	})

	it("AUTH-12 synchronous kernel throw → bounded sentinel with CURRENT seq (DI)", async () => {
		// CORRECTION01: synchronous throws are treated like offline/
		// decode — bounded sentinel with the CURRENT input.seq, never
		// the held last-successful cache.
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 100,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "awaiting_approval", source: "shadow", seq: 100 },
				}),
			},
		)
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 101,
			}),
			{
				invokeElmForProduction: async () => {
					throw new Error("synthetic-kernel-throw")
				},
			},
		)
		// CORRECTION01: NOT `phase: "awaiting_approval", source: "shadow", seq: 100`.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 101 })
	})

	it("CORR01-LEAK-01: success in session A then failure in fresh session B MUST NOT leak A's phase/source (DI)", async () => {
		// Simulate task/session boundary: the helper is published
		// against two logically independent inputs (no production
		// taskId; the test script models "fresh session" via different
		// canonical/legacy inputs). CORRECTION01 invariant:
		// the previous successful result MUST NOT bleed into a
		// subsequent failure result.
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "compacting",
				currentLegacyPhase: "streaming",
				seq: 50,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "compacting", source: "host", seq: 50 },
				}),
			},
		)
		// Fresh task/session: simulate authority failure.
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 51,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "kernel_offline",
					classification: "task_header_elm_kernel_offline",
				}),
			},
		)
		// The phase/source MUST be the sentinel (`idle`/`host`), NOT
		// `compacting`/`host` from the previous successful publish.
		expect(held.phase).toBe("idle")
		expect(held.source).toBe("host")
		expect(held.seq).toBe(51)
	})

	it("CORR01-SEQ-01: success seq=N, then failure seq=N+1 → emitted seq MUST be N+1 (DI)", async () => {
		// CORRECTION01 invariant: seq preservation under failure.
		// The bounded sentinel takes the CURRENT input.seq, NOT the
		// held last-successful seq.
		await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 7,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "presentation",
					value: { phase: "streaming", source: "shadow", seq: 7 },
				}),
			},
		)
		const held = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
				seq: 8,
			}),
			{
				invokeElmForProduction: async () => ({
					kind: "decode_error",
					reason: "synthetic-decode-error",
					classification: "task_header_elm_decode_error",
				}),
			},
		)
		// The seq MUST be 8, the phase/source MUST be the sentinel.
		expect(held).toStrictEqual({ phase: "idle", source: "host", seq: 8 })
	})
})

describe("ACT-CLINEMM-...-ORCHESTRATION03-AUTHORITY / AUTH-13 contract guard", () => {
	it("AUTH-13: production helper never reads from `globalThis.Elm`", async () => {
		const priorElm = (globalThis as { Elm?: unknown }).Elm
		;(globalThis as { Elm?: unknown }).Elm = {
			Main: {
				init: () => {
					throw new Error("globalThis.Elm must not be touched")
				},
			},
		}
		try {
			const result = await invokeElmKernel({
				canonicalShadowPhase: null,
				currentLegacyPhase: "idle",
				seq: 1,
				canonicalShadowObservedTurnSeq: null,
			} satisfies TaskHeaderElmFactsJson)
			expect(result.kind === "presentation" || result.kind === "kernel_offline").toBe(true)
		} finally {
			;(globalThis as { Elm?: unknown }).Elm = priorElm
		}
	})
})
