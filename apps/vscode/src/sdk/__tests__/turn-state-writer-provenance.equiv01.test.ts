/**
 * ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01
 *
 * Adversarial equivalence test between the OLD spread-based
 * algorithm and the NEW bounded-ring implementation. Runs a
 * deterministic 10,000-operation sequence against BOTH
 * implementations and compares every publicly observable
 * output (length, contents, getLatest, seq, findByPhase,
 * findByWriter).
 *
 * If both implementations agree on every step, conservation
 * is proven for that op sequence.
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
	type TurnStateWriterId,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import { describe, expect, it } from "vitest"

function makeOldBuffer() {
	let enabled = false
	let bufferSize = 256
	let records: readonly TurnStateWriterProvenanceRecord[] = []
	let seq = 0
	return {
		enable() {
			enabled = true
		},
		disable() {
			enabled = false
		},
		isEnabled() {
			return enabled
		},
		clear() {
			records = []
			seq = 0
		},
		setSize(n: number) {
			// OLD algorithm: single-line `bufferSize = size`. No
			// eviction. We replicate that here so the EQUIV test
			// exercises the OBSERVABLE contract delta on shrink
			// (NEW evicts on shrink, OLD does not). When shrink
			// happens, the OLD's subsequent append will (lazily)
			// trim via its own slice math on the next append.
			bufferSize = Math.max(0, Math.floor(n))
		},
		record(record: TurnStateWriterProvenanceRecord) {
			if (!enabled) return
			seq += 1
			const size = bufferSize
			if (size === 0) return
			const next = records.length < size ? [...records, record] : [...records.slice(records.length - size + 1), record]
			records = next
		},
		getRecords() {
			return records
		},
		getLatest() {
			return records.length === 0 ? undefined : records[records.length - 1]
		},
		getSeq() {
			return seq
		},
		findByPhase(predicate: (p: TurnStateWriterProvenanceRecord["committed"]["phase"]) => boolean) {
			return records.filter((r) => predicate(r.committed.phase))
		},
		findByWriter(writerId: TurnStateWriterId) {
			return records.filter((r) => r.writerId === writerId)
		},
	}
}

function makeRecord(
	seq: number,
	writerId: TurnStateWriterId,
	phase: TurnStateWriterProvenanceRecord["committed"]["phase"] = "streaming",
): TurnStateWriterProvenanceRecord {
	return {
		capturedAt: 10_000 + seq,
		writerId,
		previous: { phase: "idle", seq, anchorTs: 0 },
		requested: { phase, anchorTs: 0 },
		committed: { phase, seq: seq + 1, anchorTs: 0 },
	}
}

const WRITER_IDS: TurnStateWriterId[] = [
	"task-start-init-task",
	"controller-clear-task",
	"controller-cancel-task",
	"session-event-pending-prompt-submitted",
	"session-event-turn-complete-completed",
	"compaction-enter",
	"interaction-handle-mistake-limit",
	"followup-auto-continue-starting",
]

const PHASES: TurnStateWriterProvenanceRecord["committed"]["phase"][] = ["idle", "streaming", "resumable", "completed", "error"]

function mulberry32(seed: number) {
	let s = seed >>> 0
	return () => {
		s = (s + 0x6d2b79f5) >>> 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

describe("PROVHOT-EQUIV-01: 10,000-step deterministic adversarial equivalence (OLD vs NEW)", () => {
	it("produces identical public projections at every step across a mixed op stream", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		setTurnStateWriterProvenanceBufferSize(256)
		const old = makeOldBuffer()

		const rng = mulberry32(0xc0ffee)
		const N = 10_000
		let mismatches = 0
		let firstMismatch: { opIdx: number; op: string; old: unknown; cur: unknown } | null = null

		for (let op = 0; op < N; op++) {
			const r = rng()
			let opName = ""
			if (r < 0.45) {
				opName = "append"
				const rec = makeRecord(
					op,
					WRITER_IDS[Math.floor(rng() * WRITER_IDS.length)],
					PHASES[Math.floor(rng() * PHASES.length)],
				)
				old.record(rec)
				recordTurnStateWriterProvenance(rec)
			} else if (r < 0.55) {
				opName = "enable"
				old.enable()
				enableTurnStateWriterProvenanceDiagnostic()
			} else if (r < 0.65) {
				opName = "disable"
				old.disable()
				disableTurnStateWriterProvenanceDiagnostic()
			} else if (r < 0.75) {
				opName = "clear"
				old.clear()
				clearTurnStateWriterProvenanceDiagnostic()
			} else if (r < 0.9) {
				opName = "setSize"
				const sizes = [1, 2, 4, 8, 16, 64, 256, 0]
				const s = sizes[Math.floor(rng() * sizes.length)]
				old.setSize(s)
				setTurnStateWriterProvenanceBufferSize(s)
			} else {
				opName = "toggle"
				if (old.isEnabled()) {
					old.disable()
					disableTurnStateWriterProvenanceDiagnostic()
				} else {
					old.enable()
					enableTurnStateWriterProvenanceDiagnostic()
				}
			}
			const oldRecs = old.getRecords()
			const curRecs = getTurnStateWriterProvenanceRecords()
			const oldLatest = old.getLatest()
			const curLatest = getTurnStateWriterProvenanceLatest()

			const mismatch =
				oldRecs.length !== curRecs.length ||
				old.getSeq() !== getTurnStateWriterProvenanceSeq() ||
				old.isEnabled() !== isTurnStateWriterProvenanceDiagnosticEnabled() ||
				(oldLatest === undefined) !== (curLatest === undefined) ||
				(oldLatest && curLatest && oldLatest.capturedAt !== curLatest.capturedAt)
			if (mismatch) {
				mismatches++
				if (!firstMismatch) {
					firstMismatch = {
						opIdx: op,
						op: opName,
						old: { len: oldRecs.length, seq: old.getSeq(), latest: oldLatest?.capturedAt, enabled: old.isEnabled() },
						cur: {
							len: curRecs.length,
							seq: getTurnStateWriterProvenanceSeq(),
							latest: curLatest?.capturedAt,
							enabled: isTurnStateWriterProvenanceDiagnosticEnabled(),
						},
					}
				}
				continue
			}
			for (let i = 0; i < oldRecs.length; i++) {
				if (
					oldRecs[i].capturedAt !== curRecs[i].capturedAt ||
					oldRecs[i].writerId !== curRecs[i].writerId ||
					oldRecs[i].committed.phase !== curRecs[i].committed.phase
				) {
					mismatches++
					if (!firstMismatch) {
						firstMismatch = {
							opIdx: op,
							op: `${opName}:records[${i}]`,
							old: oldRecs[i].capturedAt,
							cur: curRecs[i].capturedAt,
						}
					}
					break
				}
			}
			const oldByPhase = old.findByPhase((p) => p === "streaming").map((r) => r.capturedAt)
			const curByPhase = findTurnStateWriterProvenanceByPhase((p) => p === "streaming").map((r) => r.capturedAt)
			if (oldByPhase.length !== curByPhase.length || oldByPhase.some((v, i) => v !== curByPhase[i])) {
				mismatches++
				if (!firstMismatch) {
					firstMismatch = { opIdx: op, op: `${opName}:findByPhase`, old: oldByPhase.length, cur: curByPhase.length }
				}
			}
			const oldByWriter = old.findByWriter("task-start-init-task").map((r) => r.capturedAt)
			const curByWriter = findTurnStateWriterProvenanceByWriter("task-start-init-task").map((r) => r.capturedAt)
			if (oldByWriter.length !== curByWriter.length || oldByWriter.some((v, i) => v !== curByWriter[i])) {
				mismatches++
				if (!firstMismatch) {
					firstMismatch = { opIdx: op, op: `${opName}:findByWriter`, old: oldByWriter.length, cur: curByWriter.length }
				}
			}
		}

		expect(mismatches, JSON.stringify(firstMismatch)).toBe(0)
	})
})
