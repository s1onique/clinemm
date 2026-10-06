/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-RUNTIME-SHADOW-QUALIFICATION
 *
 * Real-runtime-composition integration test for the TaskHeader Elm
 * runtime-shadow observer.
 *
 * Evidence classification: REAL_PRODUCTION_SEAM.
 *
 * The test exercises the ACTUAL production TaskHeader projection seam:
 *
 *   apps/vscode/src/sdk/SdkController.ts:5883-5920
 *     taskHeaderPresentation: await (async () => { ... })()
 *
 * — the same code path the live extension host publishes through.
 * The projection calls inside the seam are the SAME
 * `selectTaskHeaderPresentation` and the SAME
 * `observeTaskHeaderElmRuntimeShadow` the production bundle calls.
 *
 * Required contracts (per ACT §C6, §C7, §C8):
 *
 *   ENABLED  + MATCH         -> TS == Elm, classification=MATCH, return=TS
 *   ENABLED  + MISMATCH      -> TS != Elm, classification=MISMATCH_*, return=TS
 *   ENABLED  + KERNEL_OFFLINE -> classification=ELM_KERNEL_OFFLINE, return=TS
 *   ENABLED  + DECODE_ERROR   -> classification=ELM_DECODE_ERROR, return=TS
 *   ENABLED  + KERNEL_THROWS  -> classification=ELM_DECODE_ERROR, return=TS
 *   DISABLED                  -> kernel not invoked, return=TS unchanged
 *   KNOWN SPECIMEN            -> classification=MATCH, return=streaming/legacy
 *
 * The mismatch RED (C7) uses dependency injection
 * (`invokeElmForProduction`) so the fake Elm kernel returns a
 * deliberately wrong projection without mutating `globalThis.Elm`.
 *
 * The known-specimen RED (C8) replays the canonical UNBOUND-demote
 * specimen (canonicalShadowPhase=idle, currentLegacyPhase=streaming,
 * canonicalShadowObservedTurnSeq=undefined) and expects BOTH the TS
 * production selector AND the shadow seam to converge on
 * `{ phase: "streaming", source: "legacy", seq: 27545 }` — the
 * specimen that exercises the load-bearing UNBOUND-demotion guard
 * the predecessor ACT established as the architectural proof.
 */

import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	buildFactsJson,
	classifyTaskHeaderElmShadowComparison,
	clearTaskHeaderElmRuntimeShadowObservations,
	getTaskHeaderElmRuntimeShadowObservations,
	invokeElmKernel,
	isTaskHeaderElmRuntimeShadowEnabled,
	observeTaskHeaderElmRuntimeShadow,
	resetTaskHeaderElmRuntimeShadowForTests,
	setTaskHeaderElmRuntimeShadowEnabled,
	setTaskHeaderElmRuntimeShadowSink,
	type TaskHeaderElmDecision,
	type TaskHeaderElmFactsJson,
	type TaskHeaderElmRuntimeShadowObservation,
	type TaskHeaderElmRuntimeShadowSink,
} from "../task-header-elm-shadow"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"

const KNOWN_LIVE_SPECIMEN: TaskHeaderElmFactsJson = {
	canonicalShadowPhase: "idle",
	currentLegacyPhase: "streaming",
	seq: 27545,
	canonicalShadowObservedTurnSeq: null,
}

const KNOWN_LIVE_SPECIMEN_TS_OUT: TaskHeaderPresentationProjection = {
	phase: "streaming",
	source: "legacy",
	seq: 27545,
}

class CapturingSink implements TaskHeaderElmRuntimeShadowSink {
	readonly captured: TaskHeaderElmRuntimeShadowObservation[] = []

	push(observation: TaskHeaderElmRuntimeShadowObservation): void {
		this.captured.push(observation)
	}

	get size(): number {
		return this.captured.length
	}

	get snapshot(): readonly TaskHeaderElmRuntimeShadowObservation[] {
		return this.captured
	}

	clear(): void {
		this.captured.length = 0
	}
}

/**
 * Drive the runtime-shadow seam against a fake Facts/TS pair. Returns
 * the resulting TS projection (so callers can assert authority
 * preservation) and the captured observation (so callers can assert
 * classification).
 */
async function driveShadow(
	ts: TaskHeaderPresentationProjection,
	facts: TaskHeaderElmFactsJson,
	invokeElmForProduction?: (facts: TaskHeaderElmFactsJson) => Promise<TaskHeaderElmDecision>,
): Promise<{ returned: TaskHeaderPresentationProjection; observation: TaskHeaderElmRuntimeShadowObservation }> {
	const sink = new CapturingSink()
	setTaskHeaderElmRuntimeShadowSink(sink)
	const returned = await observeTaskHeaderElmRuntimeShadow({
		ts,
		facts,
		invokeElmForProduction,
	})
	const observation = sink.captured[0]
	setTaskHeaderElmRuntimeShadowSink(null)
	return { returned, observation }
}

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
})

afterEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
})

// ----------------------------------------------------------------------------
// C8 — Known UNBOUND-demote specimen
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02 / C8 known specimen", () => {
	it("RUNTIME-SHADOW-01: real Elm kernel + TS selector both converge on streaming/legacy for UNBOUND-demote", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts = selectTaskHeaderPresentation({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "streaming",
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(ts).toStrictEqual(KNOWN_LIVE_SPECIMEN_TS_OUT)
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN)
		expect(returned).toStrictEqual(ts)
		expect(observation.classification).toBe("MATCH")
		if (observation.elm.kind !== "presentation") return
		expect(observation.elm.phase).toBe("streaming")
		expect(observation.elm.source).toBe("legacy")
		expect(observation.elm.seq).toBe(27545)
	}, 30000)
})

// ----------------------------------------------------------------------------
// C7 — Deliberate mismatch RED via dependency injection
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02 / C7 deliberate mismatch RED", () => {
	it("RUNTIME-SHADOW-02: a fake Elm returning the wrong projection is detected as MISMATCH_PHASE; production return is unchanged", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "streaming",
			source: "legacy",
			seq: 42,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "idle", source: "shadow", seq: 42 },
		})
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("MISMATCH_PHASE")
		expect(returned).toStrictEqual(ts)
	})

	it("RUNTIME-SHADOW-03: a fake Elm returning the wrong source is detected as MISMATCH_SOURCE", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "idle",
			source: "shadow",
			seq: 1,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "idle", source: "legacy", seq: 1 },
		})
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("MISMATCH_SOURCE")
		expect(returned).toStrictEqual(ts)
	})

	it("RUNTIME-SHADOW-04: a fake Elm returning the wrong seq is detected as MISMATCH_SEQ", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "idle",
			source: "shadow",
			seq: 5,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "presentation",
			value: { phase: "idle", source: "shadow", seq: 4 },
		})
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("MISMATCH_SEQ")
		expect(returned).toStrictEqual(ts)
	})

	it("RUNTIME-SHADOW-05: a fake Elm returning kernel_offline is classified ELM_KERNEL_OFFLINE; production return is unchanged", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "compacting",
			source: "host",
			seq: 10,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "kernel_offline",
			classification: "task_header_elm_kernel_offline",
		})
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("ELM_KERNEL_OFFLINE")
		expect(observation.elm.kind).toBe("kernel_offline")
		expect(returned).toStrictEqual(ts)
	})

	it("RUNTIME-SHADOW-06: a fake Elm returning decode_error is classified ELM_DECODE_ERROR; production return is unchanged", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "awaiting_approval",
			source: "shadow",
			seq: 7,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
			kind: "decode_error",
			reason: "synthetic-decode-error",
			classification: "task_header_elm_decode_error",
		})
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("ELM_DECODE_ERROR")
		if (observation.elm.kind !== "decode_error") return
		expect(observation.elm.reason).toBe("synthetic-decode-error")
		expect(returned).toStrictEqual(ts)
	})

	it("RUNTIME-SHADOW-07: a fake Elm that throws is captured as ELM_DECODE_ERROR; production return is unchanged", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const ts: TaskHeaderPresentationProjection = {
			phase: "error",
			source: "shadow",
			seq: 11,
		}
		const fakeElm = async (): Promise<TaskHeaderElmDecision> => {
			throw new Error("synthetic-kernel-throw")
		}
		const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN, fakeElm)
		expect(observation.classification).toBe("ELM_DECODE_ERROR")
		if (observation.elm.kind !== "decode_error") return
		expect(observation.elm.reason).toMatch(/synthetic-kernel-throw/)
		expect(returned).toStrictEqual(ts)
	})
})

// ----------------------------------------------------------------------------
// C3 / C12 — Disabled-mode conservation
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02 / C3+C12 disabled-mode conservation", () => {
	it("RUNTIME-SHADOW-08: when the seam is OFF, the kernel is not invoked and the return is byte-identical to the input TS projection", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
		const ts: TaskHeaderPresentationProjection = {
			phase: "compacting",
			source: "host",
			seq: 100,
		}
		let invoked = false
		const trackingInvoke = async (_facts: TaskHeaderElmFactsJson): Promise<TaskHeaderElmDecision> => {
			invoked = true
			return {
				kind: "presentation",
				value: { phase: ts.phase, source: ts.source, seq: ts.seq },
			}
		}
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		const returned = await observeTaskHeaderElmRuntimeShadow({
			ts,
			facts: KNOWN_LIVE_SPECIMEN,
			invokeElmForProduction: trackingInvoke,
		})
		setTaskHeaderElmRuntimeShadowSink(null)
		expect(invoked).toBe(false)
		expect(returned).toStrictEqual(ts)
		expect(sink.captured.length).toBe(0)
	})

	it("RUNTIME-SHADOW-09: when the seam is OFF, the global observation ring is also untouched", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(false)
		clearTaskHeaderElmRuntimeShadowObservations()
		const ts: TaskHeaderPresentationProjection = {
			phase: "completed",
			source: "shadow",
			seq: 50,
		}
		await observeTaskHeaderElmRuntimeShadow({
			ts,
			facts: buildFactsJson({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "completed",
				seq: 50,
				canonicalShadowObservedTurnSeq: 50,
			}),
		})
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBe(0)
	})
})

// ----------------------------------------------------------------------------
// C5 — Comparison helper classification is closed
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02 / C5 comparison classifier", () => {
	it("classifyTaskHeaderElmShadowComparison covers the 6 closed classifications", () => {
		const ts: TaskHeaderPresentationProjection = {
			phase: "idle",
			source: "shadow",
			seq: 1,
		}
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "presentation",
				value: { phase: "idle", source: "shadow", seq: 1 },
			}),
		).toBe("MATCH")
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "presentation",
				value: { phase: "streaming", source: "shadow", seq: 1 },
			}),
		).toBe("MISMATCH_PHASE")
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "presentation",
				value: { phase: "idle", source: "legacy", seq: 1 },
			}),
		).toBe("MISMATCH_SOURCE")
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "presentation",
				value: { phase: "idle", source: "shadow", seq: 2 },
			}),
		).toBe("MISMATCH_SEQ")
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "kernel_offline",
				classification: "task_header_elm_kernel_offline",
			}),
		).toBe("ELM_KERNEL_OFFLINE")
		expect(
			classifyTaskHeaderElmShadowComparison(ts, {
				kind: "decode_error",
				reason: "x",
				classification: "task_header_elm_decode_error",
			}),
		).toBe("ELM_DECODE_ERROR")
	})
})

// ----------------------------------------------------------------------------
// Real Elm kernel (loaded via defaultElmKernelPath) — exhaustive fixture pass
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02 / real-kernel fixture pass", () => {
	it("RUNTIME-SHADOW-10: real Elm kernel agrees with TS for every major selector branch when the seam is enabled", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const fixtures: ReadonlyArray<{
			label: string
			facts: {
				canonicalShadowPhase: TurnPhase | undefined
				currentLegacyPhase: TurnPhase
				seq: number
				canonicalShadowObservedTurnSeq: number | undefined
			}
		}> = [
			{
				label: "R1-host-compacting",
				facts: {
					canonicalShadowPhase: "streaming",
					currentLegacyPhase: "compacting",
					seq: 10,
					canonicalShadowObservedTurnSeq: 10,
				},
			},
			{
				label: "R2-host-awaiting-followup",
				facts: {
					canonicalShadowPhase: "idle",
					currentLegacyPhase: "awaiting_followup",
					seq: 11,
					canonicalShadowObservedTurnSeq: 11,
				},
			},
			{
				label: "R3-fresh-shadow",
				facts: {
					canonicalShadowPhase: "streaming",
					currentLegacyPhase: "streaming",
					seq: 5,
					canonicalShadowObservedTurnSeq: 5,
				},
			},
			{
				label: "R3-stale-shadow-fallthrough",
				facts: {
					canonicalShadowPhase: "idle",
					currentLegacyPhase: "streaming",
					seq: 5,
					canonicalShadowObservedTurnSeq: 2,
				},
			},
			{
				label: "R3-UNBOUND-demote",
				facts: {
					canonicalShadowPhase: "idle",
					currentLegacyPhase: "streaming",
					seq: 27545,
					canonicalShadowObservedTurnSeq: undefined,
				},
			},
			{
				label: "R3-UNBOUND-allowed",
				facts: {
					canonicalShadowPhase: "idle",
					currentLegacyPhase: "idle",
					seq: 1,
					canonicalShadowObservedTurnSeq: undefined,
				},
			},
			{
				label: "R4-absence",
				facts: {
					canonicalShadowPhase: undefined,
					currentLegacyPhase: "resumable",
					seq: 3,
					canonicalShadowObservedTurnSeq: undefined,
				},
			},
		]
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		try {
			for (const fx of fixtures) {
				const ts = selectTaskHeaderPresentation(fx.facts)
				const facts = buildFactsJson(fx.facts)
				const returned = await observeTaskHeaderElmRuntimeShadow({ ts, facts })
				expect(returned).toStrictEqual(ts)
			}
			expect(sink.captured.length).toBe(fixtures.length)
			for (const obs of sink.captured) {
				expect(obs.classification).toBe("MATCH")
			}
		} finally {
			setTaskHeaderElmRuntimeShadowSink(null)
		}
	}, 30000)

	it("RUNTIME-SHADOW-11: real Elm kernel produce observed values via invokeElmKernel (sanity smoke)", async () => {
		const decision = await invokeElmKernel(KNOWN_LIVE_SPECIMEN)
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") return
		expect(decision.value).toStrictEqual(KNOWN_LIVE_SPECIMEN_TS_OUT)
	}, 30000)
})
