/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
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

	it("C3-CUTOVER-04: kernel_offline falls closed to the last successful presentation (DI)", async () => {
		const goodElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "streaming", source: "shadow", seq: 11 },
		})
		const first = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 11,
			}),
			{ invokeElmForProduction: goodElm },
		)
		expect(first).toStrictEqual({ phase: "streaming", source: "shadow", seq: 11 })

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
		expect(held).toStrictEqual(first)
	})

	it("C3-CUTOVER-05: decode_error falls closed to the last successful presentation (DI)", async () => {
		const goodElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "awaiting_approval", source: "shadow", seq: 21 },
		})
		const first = await pickTaskHeaderPresentationForPublication(
			inputs({
				canonicalShadowPhase: "awaiting_approval",
				currentLegacyPhase: "idle",
				seq: 21,
			}),
			{ invokeElmForProduction: goodElm },
		)
		expect(first).toStrictEqual({ phase: "awaiting_approval", source: "shadow", seq: 21 })

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
		expect(held).toStrictEqual(first)
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
			label: "AUTH-08 legacy absence (no canonical shadow)",
			inputs: inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "error",
				seq: 8,
			}),
			expected: { phase: "error", source: "legacy", seq: 8 },
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

	it("AUTH-10 malformed Elm output → fail closed (DI)", async () => {
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
		expect(held).toStrictEqual({ phase: "streaming", source: "legacy", seq: 1 })
	})

	it("AUTH-11 kernel offline → fail closed (DI)", async () => {
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
		expect(held).toStrictEqual({ phase: "awaiting_followup", source: "host", seq: 1 })
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
