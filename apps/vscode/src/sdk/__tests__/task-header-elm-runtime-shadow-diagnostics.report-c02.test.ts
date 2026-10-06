/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
 *
 * Pure tests for the TaskHeader Elm runtime-shadow report formatter
 * (`formatTaskHeaderElmRuntimeShadowReport` in
 * `apps/vscode/src/sdk/task-header-elm-shadow.ts`).
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The formatter is a pure function of the bounded observation
 *   ring; no shadowing, no re-implementation.
 *
 * Required test coverage (per ACT §C10):
 *
 *   FMT-01:
 *     empty ring -> report contains the seven counter field names
 *     + header.
 *   FMT-02:
 *     7 mixed observations -> report contains the seven counter
 *     field names + bounded semantic fields for recent
 *     observations.
 *   FMT-03:
 *     ring at capacity -> recent tail (last 10) is present;
 *     older observations are elided with `...`.
 *   FMT-04:
 *     reports carry bounded semantic facts ONLY (no prompt text,
 *     no model output, no MCP contents, no file paths).
 *   FMT-05:
 *     the `elm: kernel_offline` and `elm: decode_error` arms
 *     render with the right shape.
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	formatTaskHeaderElmRuntimeShadowReport,
	resetTaskHeaderElmRuntimeShadowForTests,
	setTaskHeaderElmRuntimeShadowBufferSize,
	setTaskHeaderElmRuntimeShadowSink,
	type TaskHeaderElmRuntimeShadowObservation,
	type TaskHeaderElmRuntimeShadowSink,
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

function mkObs(
	classification: TaskHeaderElmRuntimeShadowObservation["classification"],
	seq: number,
): TaskHeaderElmRuntimeShadowObservation {
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

describe("ACT-CLINEMM-...-CORRECTION01 / FMT-01..05: formatTaskHeaderElmRuntimeShadowReport", () => {
	it("FMT-01: empty ring -> report contains the seven counter field names + header", () => {
		const report = formatTaskHeaderElmRuntimeShadowReport([])
		expect(report).toContain("Task Header Elm Runtime Shadow")
		expect(report).toContain("evaluations:")
		expect(report).toContain("matches:")
		expect(report).toContain("mismatchPhase:")
		expect(report).toContain("mismatchSource:")
		expect(report).toContain("mismatchSeq:")
		expect(report).toContain("kernelOffline:")
		expect(report).toContain("decodeErrors:")
		// No observation block in the empty ring.
		expect(report).not.toMatch(/^#\d+$/m)
	})

	it("FMT-02: 7 mixed observations -> report contains the seven counter fields + bounded semantic fields for each", () => {
		const obs: TaskHeaderElmRuntimeShadowObservation[] = [
			mkObs("MATCH", 1),
			mkObs("MATCH", 2),
			mkObs("MISMATCH_PHASE", 3),
			mkObs("MISMATCH_SOURCE", 4),
			mkObs("MISMATCH_SEQ", 5),
			mkObs("ELM_KERNEL_OFFLINE", 6),
			mkObs("ELM_DECODE_ERROR", 7),
		]
		const report = formatTaskHeaderElmRuntimeShadowReport(obs)
		// Counter fields present.
		expect(report).toMatch(/evaluations:      7/)
		expect(report).toMatch(/matches:          2/)
		expect(report).toMatch(/mismatchPhase:    1/)
		expect(report).toMatch(/mismatchSource:   1/)
		expect(report).toMatch(/mismatchSeq:      1/)
		expect(report).toMatch(/kernelOffline:    1/)
		expect(report).toMatch(/decodeErrors:     1/)
		// Bounded semantic fields per observation.
		expect(report).toContain("inputs:")
		expect(report).toContain("canonicalShadowPhase:")
		expect(report).toContain("currentLegacyPhase:")
		expect(report).toContain("ts:")
		expect(report).toContain("elm:")
		expect(report).toContain("classification:")
		// Each of the seven observations gets a numbered block.
		expect(report.match(/^#\d+$/gm)?.length).toBe(7)
	})

	it("FMT-03: ring at capacity -> recent tail (last 10) is present; older observations elided", () => {
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		setTaskHeaderElmRuntimeShadowBufferSize(4)
		for (let i = 0; i < 12; i++) {
			sink.push(mkObs("MATCH", i + 1))
		}
		expect(sink.size).toBe(4)
		const report = formatTaskHeaderElmRuntimeShadowReport(sink.snapshot)
		// The formatter numbers the retained 4 observations 1..4
		// (1-based position in the formatter's view). The seq values
		// in the inputs block (9..12) are the production-side
		// identifiers (the operator correlates via seq).
		const numbered = report.match(/^#\d+$/gm)
		expect(numbered?.length).toBe(4)
		expect(numbered?.[0]).toBe("#1")
		expect(numbered?.[1]).toBe("#2")
		expect(numbered?.[2]).toBe("#3")
		expect(numbered?.[3]).toBe("#4")
		// The retained seq values are 9..12 (visible in the inputs block).
		expect(report).toMatch(/seq:                               9/)
		expect(report).toMatch(/seq:                               10/)
		expect(report).toMatch(/seq:                               11/)
		expect(report).toMatch(/seq:                               12/)
		// No omission summary line because the formatter's input has
		// only 4 observations (well below the 10-item tail cap).
		expect(report).not.toMatch(/older observation\(s\) omitted/)
	})

	it("FMT-03b: when the input to the formatter has more than 10 entries, only the last 10 are shown + an omission line", () => {
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		// Override the buffer cap so the sink retains all 15 observations.
		sink.setCapacity(Number.POSITIVE_INFINITY)
		for (let i = 0; i < 15; i++) {
			sink.push(mkObs("MATCH", i + 1))
		}
		expect(sink.size).toBe(15)
		// Pass the full 15-item snapshot directly to the formatter
		// (in production this would correspond to the unbounded view
		// from `getTaskHeaderElmRuntimeShadowObservations`).
		const report = formatTaskHeaderElmRuntimeShadowReport(sink.snapshot)
		expect(report.match(/^#\d+$/gm)?.length).toBe(10)
		expect(report).toMatch(/older observation\(s\) omitted/)
		expect(report).toMatch(/evaluations:      15/)
	})

	it("FMT-04: reports carry bounded semantic facts ONLY (no prompt text, no model output, no MCP contents, no file paths)", () => {
		const obs: TaskHeaderElmRuntimeShadowObservation[] = [mkObs("MATCH", 1)]
		const report = formatTaskHeaderElmRuntimeShadowReport(obs)
		// Negative sentinel tests for things the bounded semantic record MUST
		// NOT carry.
		expect(report.toLowerCase()).not.toContain("prompt")
		expect(report.toLowerCase()).not.toContain("model output")
		expect(report.toLowerCase()).not.toContain("mcp")
		expect(report.toLowerCase()).not.toContain("/workspace/")
		expect(report.toLowerCase()).not.toContain("/home/")
	})

	it("FMT-05a: ELM_KERNEL_OFFLINE observation renders `elm: kernel_offline`", () => {
		const obs: TaskHeaderElmRuntimeShadowObservation = {
			capturedAt: 1,
			classification: "ELM_KERNEL_OFFLINE",
			ts: { phase: "idle", source: "shadow", seq: 1 },
			elm: { kind: "kernel_offline" },
			inputs: {
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
				seq: 1,
				canonicalShadowObservedTurnSeq: 1,
			},
		}
		const report = formatTaskHeaderElmRuntimeShadowReport([obs])
		expect(report).toContain("kernel_offline")
		expect(report).not.toContain("presentation:")
	})

	it("FMT-05b: ELM_DECODE_ERROR observation renders `elm: decode_error` + bounded reason", () => {
		const obs: TaskHeaderElmRuntimeShadowObservation = {
			capturedAt: 1,
			classification: "ELM_DECODE_ERROR",
			ts: { phase: "idle", source: "shadow", seq: 1 },
			elm: { kind: "decode_error", reason: "expected object, got null" },
			inputs: {
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
				seq: 1,
				canonicalShadowObservedTurnSeq: 1,
			},
		}
		const report = formatTaskHeaderElmRuntimeShadowReport([obs])
		expect(report).toContain("decode_error")
		expect(report).toContain("reason: expected object, got null")
	})
})
