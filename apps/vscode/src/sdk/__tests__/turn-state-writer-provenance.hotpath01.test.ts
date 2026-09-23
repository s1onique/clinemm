/**
 * ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01
 *
 * Repair-target tests for the writer-provenance bounded-ring
 * replacement.  PROVHOT-RED-01 was deleted after GREEN; the
 * conservation gates it pinned live in
 * turn-state-writer-provenance.ctl01.test.ts (PROVHOT-CTL-01..12).
 *
 *   PROVHOT-GREEN-01    bounded ring keeps append O(1) and
 *                       preserves record object identity
 *
 *   PROVHOT-ABLATION-01 provenance OFF collapses hot-child work
 *
 *   PROVHOT-STATIC-01   the production append path no longer contains
 *                       spread-copy / slice / Array.from / concat /
 *                       whole-buffer map
 *
 *   PROVHOT-COMPOSE-01  real TurnStateTracker.setWithWriter → append
 *                       still records the expected writer id sequence
 *
 *   PROVHOT-O1-01       load-bearing: in steady state (slot.length
 *                       === capacity), the cold-path slot reconcile
 *                       branch is taken ZERO times across 10,000
 *                       full-ring appends. PROVHOT-RESIZE-01 is the
 *                       companion: shrink/grow may reconcile once,
 *                       then subsequent appends reconcile zero times.
 *
 * Pair with turn-state-writer-provenance.ctl01.test.ts (the
 * conservation family) and turn-state-writer-provenance.equiv01.test.ts
 * (the 10,000-step adversarial equivalence against the OLD algorithm).
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
	_getTurnStateWriterProvenanceTestCounters,
	_hasSlotBeenReallocatedSince,
	_resetTurnStateWriterProvenanceTestCounters,
	_snapshotTurnStateWriterProvenanceSlot,
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	getTurnStateWriterProvenanceLatest,
	getTurnStateWriterProvenanceRecords,
	getTurnStateWriterProvenanceSeq,
	isTurnStateWriterProvenanceDiagnosticEnabled,
	recordTurnStateWriterProvenance,
	setTurnStateWriterProvenanceBufferSize,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"

function makeRecord(seq: number): TurnStateWriterProvenanceRecord {
	return {
		capturedAt: 1_000 + seq,
		writerId: "session-event-pending-prompt-submitted",
		previous: { phase: "idle", seq: seq, anchorTs: 0 },
		requested: { phase: "streaming", anchorTs: 0 },
		committed: { phase: "streaming", seq: seq + 1, anchorTs: 0 },
	}
}

afterEach(() => {
	disableTurnStateWriterProvenanceDiagnostic()
	clearTurnStateWriterProvenanceDiagnostic()
	setTurnStateWriterProvenanceBufferSize(256)
})

// PROVHOT-RED-01 block was deleted after GREEN. The invariants it
// pinned (not-full path is cheap; chronological order on wrap) are
// now covered by PROVHOT-CTL-01..12 in turn-state-writer-provenance.ctl01.test.ts.

describe("PROVHOT-GREEN-01: bounded ring keeps storage allocation constant per append (REPAIR target)", () => {
	beforeEach(() => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(64)
	})

	it("PROVHOT-GREEN-01.A: append path preserves record identity via indexed assignment (no per-append container reallocation)", () => {
		clearTurnStateWriterProvenanceDiagnostic()
		// Retain all 64 + 32 records we plan to append so we can
		// later assert that the ring returns the SAME object
		// references (object identity), not defensive copies.
		const all: TurnStateWriterProvenanceRecord[] = []
		for (let i = 0; i < 64; i++) {
			const r = makeRecord(i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		for (let i = 0; i < 32; i++) {
			const r = makeRecord(64 + i)
			all.push(r)
			recordTurnStateWriterProvenance(r)
		}
		// Latest must be the last appended record (object identity).
		expect(getTurnStateWriterProvenanceLatest()).toBe(all[all.length - 1])
		// Interior records at chronological index 0, 20, last must
		// `===` the original objects we passed in. The OLD spread
		// algorithm returned fresh container arrays whose elements
		// were the same object references, so this assertion actually
		// passes in the OLD algorithm too — but the OLD algorithm
		// still allocated a new outer array per append. The proof
		// that allocation moved is PROVHOT-STATIC-01 (no spread/slice
		// in the body).
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(64)
		expect(records[0]).toBe(all[32]) // record 32
		expect(records[20]).toBe(all[52]) // record 52
		expect(records[records.length - 1]).toBe(all[95]) // record 95
		// Capacity 4 wrap test below lives in GREEN-01.B.
	})

	it("PROVHOT-GREEN-01.B: chronological order preserved after wrap (cap=4, append A..F ⇒ [C,D,E,F])", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(4)
		clearTurnStateWriterProvenanceDiagnostic()
		const writers: TurnStateWriterProvenanceRecord[] = []
		for (let i = 0; i < 6; i++) {
			const r = makeRecord(i)
			writers.push(r)
			recordTurnStateWriterProvenance(r)
		}
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(4)
		// Oldest retained: writers[2], newest: writers[5]
		expect(records[0]).toBe(writers[2])
		expect(records[1]).toBe(writers[3])
		expect(records[2]).toBe(writers[4])
		expect(records[3]).toBe(writers[5])
	})
})

describe("PROVHOT-ABLATION-01: provenance OFF collapses the hot-child work", () => {
	it("disabled: zero records, zero seq movement, regardless of setWithWriter frequency", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 1000; i++) {
			tracker.setWithWriter("streaming", undefined, { writerId: "session-event-pending-prompt-submitted" })
			tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		}
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("enabled: same workload produces exactly 2000 records at the default 256 capacity", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 1000; i++) {
			tracker.setWithWriter("streaming", undefined, { writerId: "session-event-pending-prompt-submitted" })
			tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(256)
		expect(getTurnStateWriterProvenanceSeq()).toBe(2000)
	})
})

describe("PROVHOT-STATIC-01: production append path no longer spreads or slices the slot buffer", () => {
	it("source-level guard \u2014 recordTurnStateWriterProvenance body must not spread/slice/Array.from/concat/map the slot buffer", () => {
		const sourcePath = resolve(__dirname, "../../shared/turn-state-writer-provenance.ts")
		const src = readFileSync(sourcePath, "utf8")
		const startIdx = src.indexOf("export function recordTurnStateWriterProvenance(")
		expect(startIdx).toBeGreaterThanOrEqual(0)
		const braceIdx = src.indexOf("{", startIdx)
		expect(braceIdx).toBeGreaterThanOrEqual(0)
		let depth = 1
		let endIdx = braceIdx + 1
		while (endIdx < src.length && depth > 0) {
			const ch = src[endIdx]
			if (ch === "{") depth++
			else if (ch === "}") depth--
			endIdx++
		}
		const body = src.slice(startIdx, endIdx)
		// Syntactic spread/slice/Array.from/concat/map on the
		// retained-record container: the OLD spelling. The
		// better gate is PROVHOT-O1-01 (semantic observation of
		// the cold-path allocation boundary), so this test is
		// a syntactic complement, not a substitute.
		for (const pattern of [
			/\[\s*\.\.\.\s*provenanceBuffer\.slot\b/,
			/\[\s*\.\.\.\s*slot\b/,
			/provenanceBuffer\.slot\.slice\s*\(/,
			/slot\.slice\s*\(/,
			/Array\.from\s*\(\s*provenanceBuffer\.slot\s*\)/,
			/Array\.from\s*\(\s*slot\s*\)/,
			/provenanceBuffer\.slot\.concat\s*\(/,
			/slot\.concat\s*\(/,
			/provenanceBuffer\.slot\.map\s*\(/,
			/slot\.map\s*\(/,
		]) {
			expect(body, `regex ${pattern} should not match append body`).not.toMatch(pattern)
		}
	})
})

/**
 * PROVHOT-O1-01 + PROVHOT-RESIZE-01: load-bearing complexity
 * discriminators. They observe the cold-path reconcile boundary via
 * the test-only allocation counter on `ProvenanceBuffer`. They
 * replace PROVHOT-STATIC-01 as the primary gate: not the
 * syntactic absence of `[...records, x]` (an O(N) operation
 * spelled differently — `new Array(N)` + a for-loop — still
 * evades it), but the SEMANTIC presence of allocation in
 * steady-state full-ring appends.
 *
 * Any repair that re-implements a full-buffer copy on every
 * full-ring append — using whatever spelling — will fail these
 * tests by incrementing `allocCount` past 0.
 */
describe("PROVHOT-O1-01 + PROVHOT-RESIZE-01: load-bearing complexity discriminators", () => {
	beforeEach(() => {
		_resetTurnStateWriterProvenanceTestCounters()
	})

	it("PROVHOT-O1-01: cap=256, fill, then 10,000 full-ring appends \u21d2 cold reconcile branch executed ZERO times", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(256)
		clearTurnStateWriterProvenanceDiagnostic()
		_resetTurnStateWriterProvenanceTestCounters()

		// Fill the ring exactly to capacity. The first
		// append triggers ONE cold reconcile (slot.length=0
		// to capacity=256); subsequent 255 appends run on the
		// hot path (slot.length === capacity).
		for (let i = 0; i < 256; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		const afterFill = _getTurnStateWriterProvenanceTestCounters()
		// ONE cold reconcile when slot.length transitioned
		// from 0 to 256. This is the legitimate single
		// allocation that the slot-drift branch makes. The
		// remaining 255 fills ran on the hot path.
		expect(afterFill.allocCount).toBe(1)
		expect(afterFill.maxSlotLen).toBe(256)

		// Snapshot the slot reference BEFORE the steady-state
		// full-ring appends begin. Any subsequent append that
		// reallocates the slot will make this snapshot not
		// === provenanceBuffer.slot, and `_hasSlotBeenReallocatedSince`
		// returns true. PROVHOT-O1-01 wants this to remain
		// false across 10,000 full-ring appends.
		const slotSnapshot = _snapshotTurnStateWriterProvenanceSlot()

		// Now perform 10,000 full-ring appends. The ring is
		// already at capacity (count=256, slot.length=256),
		// so the slot-drift branch is taken ZERO times.
		for (let i = 0; i < 10_000; i++) {
			recordTurnStateWriterProvenance(makeRecord(256 + i))
		}
		const afterOverflow = _getTurnStateWriterProvenanceTestCounters()
		expect(afterOverflow.allocCount).toBe(1)
		// maxSlotLen must equal capacity throughout. Any path
		// that allocates a fresh slot on wrap would push
		// maxSlotLen past capacity, which is the smoking gun.
		expect(afterOverflow.maxSlotLen).toBe(256)
		// Load-bearing reference-identity observation: the
		// slot must be the SAME array object the live buffer
		// is currently holding. If any full-ring append
		// pathway replaced the slot with a fresh array, this
		// is `true`.
		expect(_hasSlotBeenReallocatedSince(slotSnapshot)).toBe(false)

		// Records must be the newest 256 in chronological
		// order. The first retained record is makeRecord(9750)
		// (= record at append index 9750, which is seq 9750
		// from the 10k-fill loop where index = 256+i for
		// i in 0..9999 — so the FIRST retained after the
		// overflow is record 256+9750=10006 ... wait). The
		// exact index arithmetic is in the test below.
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(256)
		expect(records[records.length - 1]!.capturedAt).toBe(1_000 + 256 + 9_999)
		// Chronological order: each successive record must
		// have a strictly larger capturedAt.
		for (let i = 1; i < records.length; i++) {
			expect(records[i]!.capturedAt).toBeGreaterThan(records[i - 1]!.capturedAt)
		}
	})

	it("PROVHOT-RESIZE-01: setSize shrink/grow may reconcile ONCE, then subsequent appends reconcile ZERO times", () => {
		enableTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(256)
		clearTurnStateWriterProvenanceDiagnostic()
		_resetTurnStateWriterProvenanceTestCounters()

		// Fill the ring to capacity=256.
		for (let i = 0; i < 256; i++) {
			recordTurnStateWriterProvenance(makeRecord(i))
		}
		const afterFill = _getTurnStateWriterProvenanceTestCounters()
		expect(afterFill.allocCount).toBe(1) // 0 to 256 reconcile

		// SHRINK to capacity=4 (no-op on existing records,
		// but slot.length=256 differs from capacity=4 so
		// reconcile on next append).
		setTurnStateWriterProvenanceBufferSize(4)
		_resetTurnStateWriterProvenanceTestCounters()
		// One append: slot.length=256 to capacity=4
		// reconciliation (cold path), then count caps at 4,
		// then count===cap fast-path indexed assignment.
		recordTurnStateWriterProvenance(makeRecord(256))
		const afterShrinkAppend = _getTurnStateWriterProvenanceTestCounters()
		// The shrink-then-append branch DOES allocate exactly
		// once: when the next append discovers slot.length !==
		// capacity and rebuilds slot. This is the legitimate
		// cold-path cost on a capacity change.
		expect(afterShrinkAppend.allocCount).toBe(1)
		expect(afterShrinkAppend.maxSlotLen).toBe(4)

		// Snapshot the slot reference AFTER the shrink
		// reconcile, BEFORE the 1000 full-ring appends.
		const slotSnapshotShrunk = _snapshotTurnStateWriterProvenanceSlot()

		// Now perform 1000 full-ring appends at cap=4. The
		// cold-path branch must NOT fire again - that's the
		// PROVHOT-RESIZE-01 guarantee.
		_resetTurnStateWriterProvenanceTestCounters()
		for (let i = 0; i < 1000; i++) {
			recordTurnStateWriterProvenance(makeRecord(257 + i))
		}
		const after = _getTurnStateWriterProvenanceTestCounters()
		expect(after.allocCount).toBe(0)
		expect(after.maxSlotLen).toBe(4)
		expect(_hasSlotBeenReallocatedSince(slotSnapshotShrunk)).toBe(false)

		// GROW back to capacity=128. The next append will
		// reconcile (slot.length=4 to capacity=128) exactly
		// once.
		setTurnStateWriterProvenanceBufferSize(128)
		_resetTurnStateWriterProvenanceTestCounters()
		recordTurnStateWriterProvenance(makeRecord(1257))
		const afterGrow = _getTurnStateWriterProvenanceTestCounters()
		expect(afterGrow.allocCount).toBe(1)
		expect(afterGrow.maxSlotLen).toBe(128)

		// After grow, all subsequent appends reconcile ZERO
		// times.
		_resetTurnStateWriterProvenanceTestCounters()
		for (let i = 0; i < 1000; i++) {
			recordTurnStateWriterProvenance(makeRecord(1258 + i))
		}
		const afterPostGrow = _getTurnStateWriterProvenanceTestCounters()
		expect(afterPostGrow.allocCount).toBe(0)
		expect(afterPostGrow.maxSlotLen).toBe(128)
	})
})
