/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * Unit tests for the bounded Background Owner Correlation (BOCOR)
 * ring module. Mirrors the THSICAP / W carrier / TSWPD ring test
 * shape: bounded FIFO eviction, idempotent enable/disable, record
 * helper no-op when seam is OFF, ring reader returns inserted tuples
 * in order.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	captureBackgroundOwnerCorrelationRecord,
	clearBackgroundOwnerCorrelationCaptureRecords,
	getBackgroundOwnerCorrelationCaptureRecords,
	isBackgroundOwnerCorrelationCaptureEnabled,
	setBackgroundOwnerCorrelationCaptureBufferSize,
	setBackgroundOwnerCorrelationCaptureEnabled,
	type BackgroundOwnerCorrelationRecord,
} from "../background-owner-correlation"

const makeRecord = (overrides: Partial<BackgroundOwnerCorrelationRecord> = {}): BackgroundOwnerCorrelationRecord => ({
	event: "background_owner_correlation_decision",
	capturedAt: 12345,
	taskId: null,
	sessionEventSessionId: null,
	activeSessionId: "session-A",
	currentPhase: "streaming",
	candidatePhase: "awaiting_followup",
	guardAvailable: true,
	queriedOwnerSessionId: "session-A",
	guardResult: false,
	activeJobs: [
		{
			jobId: "cmd_abc",
			state: "running",
			ownerSessionId: "session-A",
		},
	],
	candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
	...overrides,
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01 / BOCOR ring", () => {
	beforeEach(() => {
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		setBackgroundOwnerCorrelationCaptureBufferSize(64)
	})

	afterEach(() => {
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		setBackgroundOwnerCorrelationCaptureBufferSize(64)
	})

	describe("seam default + flip", () => {
		it("starts OFF (fail-closed default)", () => {
			expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
		})

		it("setter flips the seam idempotently", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
			setBackgroundOwnerCorrelationCaptureEnabled(false)
			expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
		})
	})

	describe("capture helper is a complete no-op when the seam is OFF", () => {
		it("does not append when seam is OFF (default)", () => {
			captureBackgroundOwnerCorrelationRecord(makeRecord())
			expect(getBackgroundOwnerCorrelationCaptureRecords()).toHaveLength(0)
		})

		it("appends when seam is ON", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			captureBackgroundOwnerCorrelationRecord(makeRecord())
			expect(getBackgroundOwnerCorrelationCaptureRecords()).toHaveLength(1)
		})
	})

	describe("bounded FIFO eviction", () => {
		it("preserves insertion order up to the buffer size", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			setBackgroundOwnerCorrelationCaptureBufferSize(3)
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 1 }))
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 2 }))
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 3 }))
			const records = getBackgroundOwnerCorrelationCaptureRecords()
			expect(records).toHaveLength(3)
			expect(records.map((r) => r.capturedAt)).toEqual([1, 2, 3])
		})

		it("drops the oldest record when the ring is full", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			setBackgroundOwnerCorrelationCaptureBufferSize(2)
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 1 }))
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 2 }))
			captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 3 }))
			const records = getBackgroundOwnerCorrelationCaptureRecords()
			expect(records).toHaveLength(2)
			expect(records.map((r) => r.capturedAt)).toEqual([2, 3])
		})

		it("buffer size of 0 admits nothing", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			setBackgroundOwnerCorrelationCaptureBufferSize(0)
			captureBackgroundOwnerCorrelationRecord(makeRecord())
			expect(getBackgroundOwnerCorrelationCaptureRecords()).toHaveLength(0)
		})
	})

	describe("clear", () => {
		it("clears the ring (test-only helper; dump != clear)", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			captureBackgroundOwnerCorrelationRecord(makeRecord())
			captureBackgroundOwnerCorrelationRecord(makeRecord())
			expect(getBackgroundOwnerCorrelationCaptureRecords()).toHaveLength(2)
			clearBackgroundOwnerCorrelationCaptureRecords()
			expect(getBackgroundOwnerCorrelationCaptureRecords()).toHaveLength(0)
		})
	})

	describe("schema fidelity", () => {
		it("record survives round-trip through the helper API", () => {
			setBackgroundOwnerCorrelationCaptureEnabled(true)
			const record = makeRecord({
				taskId: "1789897019328_sn0k5",
				sessionEventSessionId: "session-EVT",
				activeSessionId: "session-A",
				guardResult: false,
				activeJobs: [
					{ jobId: "cmd_xyz", state: "running", ownerSessionId: undefined },
					{ jobId: "cmd_abc", state: "exited", ownerSessionId: "session-Z" },
				],
			})
			captureBackgroundOwnerCorrelationRecord(record)
			const read = getBackgroundOwnerCorrelationCaptureRecords()[0]
			expect(read).toEqual(record)
			expect(read.candidateWriterId).toBe("session-event-turn-complete-resumable-straggler-preserve")
		})
	})
})
