/**
 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01
 *
 * Test contract for the writer-provenance diagnostic. The capture is
 * purely additive — production semantics are unchanged when the
 * diagnostic is default-off. The tests pin:
 *
 *   WPROV01: diagnostic OFF => zero records, zero semantic effect on
 *            `TurnStateTracker.set()`.
 *   WPROV02: streaming mutation records exact writer + previous/new
 *            seq + writerId identity when enabled.
 *   WPROV03: compacting entry and the three restore paths carry
 *            distinct writer identities.
 *   WPROV04: a subsequent terminal/user-owned writer is independently
 *            visible in the same ring (no over-write, no coalescing).
 *   WPROV05: ring is bounded (default 256 records; older entries are
 *            FIFO-evicted; sized-down ring evicts the oldest).
 *   WPROV06: ordinary `set()` behavior remains byte/semantic-equivalent
 *            to `setWithWriter(phase, anchorTs, { writerId:
 *            "unknown-legacy-writer" })` when the diagnostic is
 *            disabled. When enabled, the legacy `set()` records the
 *            writer as `unknown-legacy-writer` (the explicit sentinel).
 *
 * This is a diagnostic test, NOT a product RED. The directive forbids
 * synthesizing these as production REDs.
 */

import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByPhase,
	findTurnStateWriterProvenanceByWriter,
	getTurnStateWriterProvenanceRecords,
	getTurnStateWriterProvenanceSeq,
	isTurnStateWriterProvenanceDiagnosticEnabled,
	setTurnStateWriterProvenanceBufferSize,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"

afterEach(() => {
	disableTurnStateWriterProvenanceDiagnostic()
	clearTurnStateWriterProvenanceDiagnostic()
	setTurnStateWriterProvenanceBufferSize(256)
})

describe("WPROV01: diagnostic OFF => zero records, zero semantic effect", () => {
	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV01.1: set() does NOT append when the diagnostic is disabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		tracker.set("idle")
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("WPROV01.2: setWithWriter() also does NOT append when the diagnostic is disabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
	})

	it("WPROV01.3: disabling after writes preserves the prior records", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		enableTurnStateWriterProvenanceDiagnostic()
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
		disableTurnStateWriterProvenanceDiagnostic()
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
	})
})

describe("WPROV02: streaming mutation records exact writer + previous/new seq + writerId", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV02.1: setWithWriter captures committed phase + seq + writerId", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const idleSeq = tracker.get().seq
		tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
			taskId: "task-1",
			epoch: minter.epoch,
		})
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(1)
		const r = records[0]!
		expect(r.writerId).toBe("task-start-init-task")
		expect(r.taskId).toBe("task-1")
		expect(r.epoch).toBe(minter.epoch)
		expect(r.previous.phase).toBe("idle")
		expect(r.previous.seq).toBe(idleSeq)
		expect(r.requested.phase).toBe("streaming")
		expect(r.committed.phase).toBe("streaming")
		expect(r.committed.seq).toBeGreaterThan(idleSeq)
	})

	it("WPROV02.2: anchorTs is captured and round-tripped", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("awaiting_approval", 4242, { writerId: "interaction-handle-tool-approval" })
		const r = getTurnStateWriterProvenanceRecords()[0]!
		expect(r.requested.anchorTs).toBe(4242)
		expect(r.committed.anchorTs).toBe(4242)
		expect(r.previous.anchorTs).toBeUndefined()
	})

	it("WPROV02.3: set() legacy alias records writerId=unknown-legacy-writer when enabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		const r = getTurnStateWriterProvenanceRecords()[0]!
		expect(r.writerId).toBe("unknown-legacy-writer")
		expect(r.committed.phase).toBe("streaming")
	})

	it("WPROV02.4: findTurnStateWriterProvenanceByWriter returns the matching subset", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		tracker.setWithWriter("error", undefined, { writerId: "controller-on-send-error" })
		const taskStart = findTurnStateWriterProvenanceByWriter("task-start-init-task")
		expect(taskStart.length).toBe(1)
		expect(taskStart[0]!.committed.phase).toBe("streaming")
		const clear = findTurnStateWriterProvenanceByWriter("controller-clear-task")
		expect(clear.length).toBe(1)
		expect(clear[0]!.committed.phase).toBe("idle")
	})

	it("WPROV02.5: findTurnStateWriterProvenanceByPhase returns the matching subset", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("streaming", undefined, { writerId: "controller-ask-response" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		const streaming = findTurnStateWriterProvenanceByPhase((p) => p === "streaming")
		expect(streaming.length).toBe(2)
		const writers = new Set(streaming.map((r) => r.writerId))
		expect(writers.has("task-start-init-task")).toBe(true)
		expect(writers.has("controller-ask-response")).toBe(true)
	})
})

describe("WPROV03: compacting entry and the three restore paths carry distinct writer identities", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV03.1: compaction-enter writes compacting; restore writes the resolved phase", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("compacting", 42, { writerId: "compaction-enter" })
		tracker.setWithWriter("idle", 42, { writerId: "compaction-restore-canonical-resolved" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(3)
		expect(records[0]!.writerId).toBe("task-start-init-task")
		expect(records[1]!.writerId).toBe("compaction-enter")
		expect(records[1]!.committed.phase).toBe("compacting")
		expect(records[1]!.committed.anchorTs).toBe(42)
		expect(records[2]!.writerId).toBe("compaction-restore-canonical-resolved")
		expect(records[2]!.committed.phase).toBe("idle")
	})

	it("WPROV03.2: compaction-restore-entry-preserve keeps the entry phase", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		tracker.setWithWriter("compacting", 7, { writerId: "compaction-enter" })
		tracker.setWithWriter("resumable", 7, { writerId: "compaction-restore-entry-preserve" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.map((r) => r.writerId)).toEqual([
			"controller-cancel-task",
			"compaction-enter",
			"compaction-restore-entry-preserve",
		])
	})

	it("WPROV03.3: compaction-restore-canonical-unavailable-preserve is distinct from the resolved branch", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("awaiting_approval", 9, { writerId: "interaction-handle-tool-approval" })
		tracker.setWithWriter("compacting", 9, { writerId: "compaction-enter" })
		tracker.setWithWriter("awaiting_approval", 9, {
			writerId: "compaction-restore-canonical-unavailable-preserve",
		})
		const records = getTurnStateWriterProvenanceRecords()
		expect(records[2]!.writerId).toBe("compaction-restore-canonical-unavailable-preserve")
		const restoreWriters = new Set(records.filter((r) => r.writerId.startsWith("compaction-restore")).map((r) => r.writerId))
		expect(restoreWriters.size).toBe(1)
		expect(restoreWriters.has("compaction-restore-canonical-unavailable-preserve")).toBe(true)
	})
})

describe("WPROV04: terminal/user-owned writer is independently visible", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV04.1: streaming to idle path records both writes distinctly", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "controller-ask-response" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(2)
		expect(records[0]!.committed.phase).toBe("streaming")
		expect(records[0]!.committed.seq).toBeLessThan(records[1]!.committed.seq)
		expect(records[1]!.committed.phase).toBe("idle")
		expect(records[1]!.previous.phase).toBe("streaming")
	})

	it("WPROV04.2: subsequent user-owned write survives even if a later stale streaming write happens", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		tracker.setWithWriter("streaming", undefined, { writerId: "unknown-legacy-writer" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.map((r) => r.writerId)).toEqual(["controller-clear-task", "unknown-legacy-writer"])
		expect(records[1]!.previous.phase).toBe("idle")
		expect(records[1]!.committed.phase).toBe("streaming")
	})
})

describe("WPROV05: ring is bounded (default 256; FIFO evict)", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV05.1: 256 records fit; the 257th evicts the oldest", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 256; i++) {
			tracker.setWithWriter("streaming", i, { writerId: "task-start-init-task" })
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(256)
		tracker.setWithWriter("streaming", 256, { writerId: "task-start-init-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(256)
		expect(records[0]!.requested.anchorTs).toBe(1)
		expect(records[records.length - 1]!.requested.anchorTs).toBe(256)
	})

	it("WPROV05.2: shrinking the buffer evicts the oldest", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 10; i++) {
			tracker.setWithWriter("streaming", i, { writerId: "task-start-init-task" })
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(10)
		setTurnStateWriterProvenanceBufferSize(3)
		tracker.setWithWriter("idle", 99, { writerId: "controller-clear-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(3)
		expect(records[records.length - 1]!.requested.anchorTs).toBe(99)
	})

	it("WPROV05.3: setting buffer size to 0 disables the ring entirely", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		setTurnStateWriterProvenanceBufferSize(0)
		tracker.setWithWriter("streaming", 1, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
	})
})

describe("WPROV06: set() byte/semantic-equivalent to setWithWriter(..., unknown-legacy-writer)", () => {
	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV06.1: phase/anchorTs/seq are identical between set() and setWithWriter()", () => {
		const minterA = new MessageIdMinter()
		const minterB = new MessageIdMinter()
		const tA = new TurnStateTracker(minterA)
		const tB = new TurnStateTracker(minterB)
		tA.set("streaming", 100)
		tB.setWithWriter("streaming", 100, { writerId: "unknown-legacy-writer" })
		expect(tA.get()).toEqual(tB.get())
	})

	it("WPROV06.2: listener fan-out is identical between set() and setWithWriter()", () => {
		const minterA = new MessageIdMinter()
		const minterB = new MessageIdMinter()
		const tA = new TurnStateTracker(minterA)
		const tB = new TurnStateTracker(minterB)
		const aPhases: string[] = []
		const bPhases: string[] = []
		tA.subscribe((p) => aPhases.push(p))
		tB.subscribe((p) => bPhases.push(p))
		tA.set("streaming")
		tA.set("idle")
		tB.setWithWriter("streaming", undefined, { writerId: "unknown-legacy-writer" })
		tB.setWithWriter("idle", undefined, { writerId: "unknown-legacy-writer" })
		expect(aPhases).toEqual(bPhases)
	})

	it("WPROV06.3: set() is a no-op on the ring buffer when disabled (WPROV01 contract)", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		tracker.set("idle")
		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
	})
})
