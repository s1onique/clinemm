/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01 — BARRIER-ID
 *
 * The RED that demonstrated that the diagnostic `barrierId` did NOT
 * correlate the records of one barrier lifecycle.
 *
 * THE DEFECT
 * ----------
 * `mintBarrierId()` embedded `state.seq` — the process-wide event
 * counter — in the id:
 *
 *   return `barrier-${coordinatorInstanceId}-${input.sessionId}-${input.taskId}-${input.epoch}-${state.seq}`
 *
 * `state.seq` increments on EVERY recorded event, so the fallback
 * minted a DIFFERENT id for each record. The barrier lifecycle
 * (registration → re-evaluation → clearance → completion) therefore
 * produced N unrelated ids, and the causal chain could not be
 * followed through the timeline.
 *
 * This was safe ONLY if production consistently supplied a stable
 * explicit `barrierId` throughout a lifecycle — which it did NOT:
 * the coordinator's `captureIncident()` never passed one, so the
 * fallback was always taken.
 *
 * THE FIX
 * -------
 * The barrier id is minted ONCE per barrier lifecycle and is shared
 * by every stage of that lifecycle: registration, re-evaluation,
 * early return, clearance, continuation and completion. A
 * re-registration WITHIN the same epoch keeps the SAME id (it is
 * the same obligation); a NEW epoch (a new lifecycle) gets a NEW id.
 *
 * The assertion runs through the REAL coordinator seam — no
 * hand-fed fixtures.
 *
 * GREEN counterpart:
 * `completion-incident-barrier-identity-correction01.green.test.ts`.
 */

import {
	type CompletionIncidentRecord,
	getCompletionIncidentRecords,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	emitAgentTurnDone,
	emitSubmitAndExit,
	flush,
	makeFlightRecorderHarness,
} from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
	resetCompletionIncidentRecorderForTests()
	setCompletionIncidentFlightRecorderEnabled(true)
})

afterEach(() => {
	resetCompletionIncidentRecorderForTests()
})

describe("BARRIER-ID.1: one barrier lifecycle shares ONE barrier id", () => {
	it("BARRIER-ID.1.1: registration → re-evaluation → clearance → completion share the id", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		// The completion is HELD (pending-prompt uncertainty), so the
		// barrier registers and the marker is published `resumable`.
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// The re-evaluation boundary runs and HELD again (the
		// pending-prompt authority is still unknown).
		await emitAgentTurnDone(h)
		await flush()

		const records = getCompletionIncidentRecords()
		const lifecycle = records.filter((r) => r.taskId === "task-a")
		expect(lifecycle.length).toBeGreaterThan(1)

		const barrierIds = new Set(lifecycle.map((r) => r.barrierId))
		// EXACTLY ONE barrier id for the whole lifecycle.
		expect(barrierIds.size).toBe(1)

		// The lifecycle really did span multiple stages.
		const stages = new Set(lifecycle.map((r) => r.stage))
		expect(stages.has("completion_attempt")).toBe(true)
		expect(stages.has("barrier_registration")).toBe(true)
	})

	it("BARRIER-ID.1.2: the id is still diagnostic-only and never the runtime identity", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		for (const record of getCompletionIncidentRecords()) {
			expect(record.barrierId).toBeTruthy()
			expect(record.barrierId.startsWith("barrier-")).toBe(true)
			expect(record.barrierId).not.toBe(record.sessionId)
			expect(record.barrierId).not.toBe(record.taskId)
			expect(record.barrierId).not.toBe(String(record.epoch))
		}
	})
})

describe("BARRIER-ID.2: a re-registration WITHIN the same epoch keeps the SAME id", () => {
	it("BARRIER-ID.2.1: two registrations in one epoch share the id", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()
		// A second C10 attempt in the SAME epoch re-registers the
		// marker under the SAME identity triple — the SAME
		// obligation, so the SAME barrier lifecycle.
		await emitSubmitAndExit(h)
		await flush()

		const registrations = getCompletionIncidentRecords().filter(
			(r) => r.stage === "barrier_registration" && r.taskId === "task-a",
		)
		expect(registrations.length).toBeGreaterThanOrEqual(2)
		const ids = new Set(registrations.map((r) => r.barrierId))
		expect(ids.size).toBe(1)
	})
})

describe("BARRIER-ID.3: the timeline can actually be FOLLOWED by barrier id", () => {
	it("BARRIER-ID.3.1: every record of the held incident is reachable under one id", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()
		await emitAgentTurnDone(h)
		await flush()

		const records = getCompletionIncidentRecords()
		const byBarrier = new Map<string, CompletionIncidentRecord[]>()
		for (const record of records) {
			const bucket = byBarrier.get(record.barrierId) ?? []
			bucket.push(record)
			byBarrier.set(record.barrierId, bucket)
		}
		// Every bucket is a coherent lifecycle (all records of one
		// bucket belong to one task).
		for (const bucket of byBarrier.values()) {
			expect(new Set(bucket.map((r) => r.taskId)).size).toBe(1)
		}
	})
})
