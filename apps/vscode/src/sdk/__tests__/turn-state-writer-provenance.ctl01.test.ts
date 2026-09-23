/**
 * ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01
 *
 * Conservation tests for the bounded-ring replacement.
 * These pin the conservation gates from ACT \u00a72.3 / \u00a716.
 * Together with WPROV (existing) this set covers the entire
 * observable contract surface.
 */

import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByPhase,
	findTurnStateWriterProvenanceByWriter,
	getTurnStateWriterProvenanceLatest,
	getTurnStateWriterProvenanceRecords,
	getTurnStateWriterProvenanceSeq,
	isTurnStateWriterProvenanceDiagnosticEnabled,
	recordTurnStateWriterProvenance,
	setTurnStateWriterProvenanceBufferSize,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import { afterEach, describe, expect, it } from "vitest"

function makeRecord(
	seq: number,
	writerId: TurnStateWriterProvenanceRecord["writerId"] = "session-event-pending-prompt-submitted",
): TurnStateWriterProvenanceRecord {
	return {
		capturedAt: 1_000 + seq,
		writerId,
		previous: { phase: "idle", seq, anchorTs: 0 },
		requested: { phase: "streaming", anchorTs: 0 },
		committed: { phase: "streaming", seq: seq + 1, anchorTs: 0 },
	}
}

afterEach(() => {
	disableTurnStateWriterProvenanceDiagnostic()
	clearTurnStateWriterProvenanceDiagnostic()
	setTurnStateWriterProvenanceBufferSize(256)
})

describe("PROVHOT-CTL-01: disabled => no retained record", () => {
	it("the fast path remains a no-op", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(1))
		recordTurnStateWriterProvenance(makeRecord(2))
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
		expect(getTurnStateWriterProvenanceLatest()).toBeUndefined()
	})
})

describe("PROVHOT-CTL-02: enabled => one append = one record", () => {
	it("the simplest enabled path", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(1))
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
		expect(getTurnStateWriterProvenanceSeq()).toBe(1)
	})
})

describe("PROVHOT-CTL-03: capacity limit preserved", () => {
	it("default capacity 256", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		for (let i = 0; i < 500; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(256)
		expect(getTurnStateWriterProvenanceSeq()).toBe(500)
	})

	it("custom capacity 4", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(4)
		clearTurnStateWriterProvenanceDiagnostic()
		for (let i = 0; i < 10; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(4)
		expect(getTurnStateWriterProvenanceSeq()).toBe(10)
	})
})

describe("PROVHOT-CTL-04: chronological order preserved after wrap", () => {
	it("capacity 4: append 0..9 \u21d2 getRecords() returns [6,7,8,9]", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(4)
		clearTurnStateWriterProvenanceDiagnostic()
		const all: TurnStateWriterProvenanceRecord[] = []
		for (let i = 0; i < 10; i++) {
			const r = makeRecord(i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		const records = getTurnStateWriterProvenanceRecords()
		expect(records).toHaveLength(4)
		expect(records[0]).toBe(all[6])
		expect(records[1]).toBe(all[7])
		expect(records[2]).toBe(all[8])
		expect(records[3]).toBe(all[9])
	})
})

describe("PROVHOT-CTL-05/06: capacity = 0 and capacity = 1", () => {
	it("capacity = 0: seq increments but no records retained", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(0)
		clearTurnStateWriterProvenanceDiagnostic()
		for (let i = 0; i < 5; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(5)
		expect(getTurnStateWriterProvenanceLatest()).toBeUndefined()
	})

	it("capacity = 1: latest is the only retained record", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(1)
		clearTurnStateWriterProvenanceDiagnostic()
		const a = makeRecord(1)
		const b = makeRecord(2)
		recordTurnStateWriterProvenance(a)
		expect(getTurnStateWriterProvenanceLatest()).toBe(a)
		recordTurnStateWriterProvenance(b)
		expect(getTurnStateWriterProvenanceLatest()).toBe(b)
		expect(getTurnStateWriterProvenanceRecords()).toHaveLength(1)
	})
})

describe("PROVHOT-CTL-07: seq semantics preserved", () => {
	it("disabled \u21d2 seq stays 0", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(1))
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})

	it("enabled but capacity=0 \u21d2 seq still increments", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(0)
		clearTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(1))
		expect(getTurnStateWriterProvenanceSeq()).toBe(1)
		recordTurnStateWriterProvenance(makeRecord(2))
		expect(getTurnStateWriterProvenanceSeq()).toBe(2)
	})

	it("monotonic across enable/disable/clear cycles", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(1))
		recordTurnStateWriterProvenance(makeRecord(2))
		expect(getTurnStateWriterProvenanceSeq()).toBe(2)
		disableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(3))
		expect(getTurnStateWriterProvenanceSeq()).toBe(2)
		enableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance(makeRecord(4))
		expect(getTurnStateWriterProvenanceSeq()).toBe(3)
		clearTurnStateWriterProvenanceDiagnostic()
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})
})

describe("PROVHOT-CTL-08: clear / reset preserved", () => {
	it("clear empties records and resets seq; subsequent appends restart", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		for (let i = 0; i < 10; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(10)
		expect(getTurnStateWriterProvenanceSeq()).toBe(10)
		clearTurnStateWriterProvenanceDiagnostic()
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
		const r = makeRecord(1)
		recordTurnStateWriterProvenance(r)
		expect(getTurnStateWriterProvenanceRecords()).toHaveLength(1)
		expect(getTurnStateWriterProvenanceLatest()).toBe(r)
		expect(getTurnStateWriterProvenanceSeq()).toBe(1)
	})
})

describe("PROVHOT-CTL-09: enable / disable preserved", () => {
	it("enable flips the flag; disable flips it back; records are retained across both", () => {
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
		enableTurnStateWriterProvenanceDiagnostic()
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)
		disableTurnStateWriterProvenanceDiagnostic()
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		const a = makeRecord(1)
		recordTurnStateWriterProvenance(a)
		disableTurnStateWriterProvenanceDiagnostic()
		expect(getTurnStateWriterProvenanceRecords()).toHaveLength(1)
		expect(getTurnStateWriterProvenanceRecords()[0]).toBe(a)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})
})

describe("PROVHOT-CTL-10: getRecords returns chronological snapshot (newest at end)", () => {
	it("after wrap, the snapshot is oldest \u2192 newest", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(3)
		clearTurnStateWriterProvenanceDiagnostic()
		const a = makeRecord(1, "task-start-init-task")
		const b = makeRecord(2, "controller-clear-task")
		const c = makeRecord(3, "followup-auto-continue-starting")
		const d = makeRecord(4, "compaction-enter")
		const e = makeRecord(5, "interaction-handle-mistake-limit")
		for (const r of [a, b, c, d, e]) {
			recordTurnStateWriterProvenance(r)
		}
		const records = getTurnStateWriterProvenanceRecords()
		expect(records).toHaveLength(3)
		expect(records[0]).toBe(c)
		expect(records[1]).toBe(d)
		expect(records[2]).toBe(e)
		expect(getTurnStateWriterProvenanceLatest()).toBe(e)
	})
})

describe("PROVHOT-CTL-11: findByPhase and findByWriter honor chronological order", () => {
	it("findByPhase returns chronological matches", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		const r0 = makeRecord(0)
		const r1 = makeRecord(1)
		const r2: TurnStateWriterProvenanceRecord = {
			...makeRecord(2),
			committed: { phase: "idle", seq: 3, anchorTs: 0 },
			requested: { phase: "idle", anchorTs: 0 },
		}
		const r3 = makeRecord(3)
		recordTurnStateWriterProvenance(r0)
		recordTurnStateWriterProvenance(r1)
		recordTurnStateWriterProvenance(r2)
		recordTurnStateWriterProvenance(r3)
		const streamingMatches = findTurnStateWriterProvenanceByPhase((p) => p === "streaming")
		expect(streamingMatches).toHaveLength(3)
		expect(streamingMatches[0]).toBe(r0)
		expect(streamingMatches[2]).toBe(r3)
	})

	it("findByWriter returns chronological matches", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		const a = makeRecord(0, "task-start-init-task")
		const b = makeRecord(1, "controller-clear-task")
		const c = makeRecord(2, "task-start-init-task")
		recordTurnStateWriterProvenance(a)
		recordTurnStateWriterProvenance(b)
		recordTurnStateWriterProvenance(c)
		const matches = findTurnStateWriterProvenanceByWriter("task-start-init-task")
		expect(matches).toHaveLength(2)
		expect(matches[0]).toBe(a)
		expect(matches[1]).toBe(c)
	})
})

describe("PROVHOT-CTL-12: setSize preserves the existing records and updates capacity for subsequent appends", () => {
	it("shrink from 8 to 3 — existing 8 records remain; next append trims to 3", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(8)
		clearTurnStateWriterProvenanceDiagnostic()
		const all: TurnStateWriterProvenanceRecord[] = []
		for (let i = 0; i < 8; i++) {
			const r = makeRecord(i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		setTurnStateWriterProvenanceBufferSize(3)
		const records = getTurnStateWriterProvenanceRecords()
		// setSize is a no-op on the records array (matches the OLD
		// algorithm). All 8 records remain after the call. The
		// subsequent append will trim down to the new cap=3.
		expect(records).toHaveLength(8)
		expect(records[0]).toBe(all[0])
		expect(records[7]).toBe(all[7])
		const r8 = makeRecord(8)
		recordTurnStateWriterProvenance(r8)
		const records2 = getTurnStateWriterProvenanceRecords()
		expect(records2).toHaveLength(3)
		expect(records2[0]).toBe(all[6])
		expect(records2[1]).toBe(all[7])
		expect(records2[2]).toBe(r8)
	})

	it("grow from 4 to 16 — all 4 existing records retained; subsequent appends grow the ring up to 16", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(4)
		clearTurnStateWriterProvenanceDiagnostic()
		const all: TurnStateWriterProvenanceRecord[] = []
		for (let i = 0; i < 4; i++) {
			const r = makeRecord(i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		setTurnStateWriterProvenanceBufferSize(16)
		const records = getTurnStateWriterProvenanceRecords()
		expect(records).toHaveLength(4)
		expect(records[0]).toBe(all[0])
		expect(records[3]).toBe(all[3])
		for (let i = 4; i < 12; i++) {
			const r = makeRecord(i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		const records2 = getTurnStateWriterProvenanceRecords()
		expect(records2).toHaveLength(12)
		for (let i = 0; i < 12; i++) {
			expect(records2[i]).toBe(all[i])
		}
	})
})
