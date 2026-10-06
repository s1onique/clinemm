/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
 *
 * Pure tests for the TaskHeader Elm runtime-shadow summary aggregator
 * (`summarizeTaskHeaderElmRuntimeShadowObservations` in
 * `apps/vscode/src/sdk/task-header-elm-shadow.ts`).
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The summary function is a pure fold of the observation ring; no
 *   shadowing, no re-implementation.
 *
 * Required test coverage (per ACT §C9):
 *
 *   SUM-01:
 *     empty ring
 *     -> all counters zero; evaluations = 0
 *   SUM-02:
 *     single MATCH
 *     -> matches=1, others=0, evaluations=1
 *   SUM-03:
 *     2 MATCH + 1 each of the 5 other classifications
 *     -> matches=2, mismatchPhase=1, mismatchSource=1,
 *        mismatchSeq=1, kernelOffline=1, decodeErrors=1,
 *        evaluations=7
 *   SUM-04:
 *     ring at capacity (push more than DEFAULT_RING_SIZE;
 *      oldest observation evicted)
 *     -> summary reflects RETAINED ring exactly
 *   SUM-05:
 *     classification is closed (no other tags allowed)
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	resetTaskHeaderElmRuntimeShadowForTests,
	setTaskHeaderElmRuntimeShadowBufferSize,
	setTaskHeaderElmRuntimeShadowSink,
	type TaskHeaderElmRuntimeShadowObservation,
	type TaskHeaderElmRuntimeShadowSink,
	summarizeTaskHeaderElmRuntimeShadowObservations,
} from "../task-header-elm-shadow"

class CapturingSink implements TaskHeaderElmRuntimeShadowSink {
	readonly captured: TaskHeaderElmRuntimeShadowObservation[] = []
	private cap = Number.POSITIVE_INFINITY

	push(observation: TaskHeaderElmRuntimeShadowObservation): void {
		this.captured.push(observation)
		while (this.captured.length > this.cap) {
			this.captured.shift()
		}
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

	setCapacity(capacity: number): void {
		this.cap = capacity
		while (this.captured.length > this.cap) {
			this.captured.shift()
		}
	}
}

function mkObs(classification: TaskHeaderElmRuntimeShadowObservation["classification"], seq: number): TaskHeaderElmRuntimeShadowObservation {
	return {
		capturedAt: seq,
		classification,
		ts: { phase: "idle", source: "shadow", seq },
		elm: { kind: "presentation", phase: "idle", source: "shadow", seq },
		inputs: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq,
			canonicalShadowObservedTurnSeq: seq,
		},
	}
}

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
	setTaskHeaderElmRuntimeShadowSink(null)
	setTaskHeaderElmRuntimeShadowBufferSize(8)
})

describe("ACT-CLINEMM-...-CORRECTION01 / SUM-01..05: summarizeTaskHeaderElmRuntimeShadowObservations", () => {
	it("SUM-01: empty ring -> all counters zero; evaluations = 0", () => {
		expect(summarizeTaskHeaderElmRuntimeShadowObservations([])).toEqual({
			evaluations: 0,
			matches: 0,
			mismatchPhase: 0,
			mismatchSource: 0,
			mismatchSeq: 0,
			kernelOffline: 0,
			decodeErrors: 0,
		})
	})

	it("SUM-02: single MATCH -> matches=1, others=0, evaluations=1", () => {
		const obs = [mkObs("MATCH", 1)]
		expect(summarizeTaskHeaderElmRuntimeShadowObservations(obs)).toEqual({
			evaluations: 1,
			matches: 1,
			mismatchPhase: 0,
			mismatchSource: 0,
			mismatchSeq: 0,
			kernelOffline: 0,
			decodeErrors: 0,
		})
	})

	it("SUM-03: 2 MATCH + 1 each of the 5 other classifications -> evaluations=7", () => {
		const obs: TaskHeaderElmRuntimeShadowObservation[] = [
			mkObs("MATCH", 1),
			mkObs("MATCH", 2),
			mkObs("MISMATCH_PHASE", 3),
			mkObs("MISMATCH_SOURCE", 4),
			mkObs("MISMATCH_SEQ", 5),
			mkObs("ELM_KERNEL_OFFLINE", 6),
			mkObs("ELM_DECODE_ERROR", 7),
		]
		expect(summarizeTaskHeaderElmRuntimeShadowObservations(obs)).toEqual({
			evaluations: 7,
			matches: 2,
			mismatchPhase: 1,
			mismatchSource: 1,
			mismatchSeq: 1,
			kernelOffline: 1,
			decodeErrors: 1,
		})
	})

	it("SUM-04: ring at capacity + eviction -> summary reflects the retained ring exactly", () => {
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		setTaskHeaderElmRuntimeShadowBufferSize(4)
		// Push 10 observations of mixed classifications.
		const plan: Array<TaskHeaderElmRuntimeShadowObservation["classification"]> = [
			"MATCH",
			"MATCH",
			"MISMATCH_PHASE",
			"MATCH",
			"MISMATCH_SOURCE",
			"ELM_KERNEL_OFFLINE",
			"MATCH",
			"MISMATCH_SEQ",
			"ELM_DECODE_ERROR",
			"MATCH",
		]
		for (let i = 0; i < plan.length; i++) {
			sink.push(mkObs(plan[i]!, i + 1))
		}
		expect(sink.size).toBe(4) // eviction kicked in
		const retained = sink.snapshot
		// Last 4 entries (indices 6..9): MATCH, MISMATCH_SEQ, ELM_DECODE_ERROR, MATCH
		expect(retained.map((o) => o.classification)).toEqual([
			"MATCH",
			"MISMATCH_SEQ",
			"ELM_DECODE_ERROR",
			"MATCH",
		])
		expect(summarizeTaskHeaderElmRuntimeShadowObservations(retained)).toEqual({
			evaluations: 4,
			matches: 2,
			mismatchPhase: 0,
			mismatchSource: 0,
			mismatchSeq: 1,
			kernelOffline: 0,
			decodeErrors: 1,
		})
	})

	it("SUM-05: a single MATCH + a ring-pushed buffer overflow does not double-count retained ones", () => {
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		setTaskHeaderElmRuntimeShadowBufferSize(2)
		sink.push(mkObs("MATCH", 1))
		sink.push(mkObs("MATCH", 2))
		sink.push(mkObs("MISMATCH_PHASE", 3))
		expect(sink.size).toBe(2)
		// Retained two are MATCH (seq=2) + MISMATCH_PHASE (seq=3)
		expect(sink.snapshot.map((o) => o.classification)).toEqual(["MATCH", "MISMATCH_PHASE"])
		expect(summarizeTaskHeaderElmRuntimeShadowObservations(sink.snapshot)).toEqual({
			evaluations: 2,
			matches: 1,
			mismatchPhase: 1,
			mismatchSource: 0,
			mismatchSeq: 0,
			kernelOffline: 0,
			decodeErrors: 0,
		})
	})
})
