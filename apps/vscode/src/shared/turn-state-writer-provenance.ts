/**
 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01
 *
 * Bounded writer-provenance diagnostic for the legacy `TurnStateTracker`.
 * The PTAD ring exposes the post-terminal authority split at the
 * push boundary, but the 64-record ring aged out the actual phase
 * mutation that wrote `legacyPhase=streaming` at `seq=6233` on the
 * LIVE build — there is no transition record showing who produced it.
 *
 * This module captures every legacy TurnState phase mutation, stamped
 * at the SINGLE mutation seam (TurnStateTracker.set), with a writer
 * identity drawn from the closed recon of every production caller
 * (see apps/vscode/src/sdk/turn-state-tracker.ts and the inventory at
 * .factory/epic-board.md).
 *
 * Trust binding (mirrors post-terminal-authority-diagnostic.ts):
 *   - Default off: enable/disable toggle is OFF in production. When
 *     disabled the capture is a complete no-op so production path
 *     semantics are unchanged (verified by WPROV01 + WPROV06).
 *   - One user action: `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`
 *     flips the workspace-state flag.
 *   - One dump action: `cline.debug.dumpTurnStateWriterProvenanceDiagnostic`
 *     serializes the ring to ~/.cline/data/turn-state-writer-provenance.jsonl.
 *   - Bounded: ring buffer with a bounded default (256 records —
 *     generous for sparse mutation-only recording; well within the
 *     budget needed to keep enough history for one full LIVE
 *     reproduction, which is the explicit ACT purpose).
 *   - Privacy-safe: NO prompt content, NO model output, NO tool args,
 *     NO turn body. The record only carries the phase value, the
 *     writer identity, the previous/committed seq+phase, and the
 *     capture timestamp. taskId is captured only when the caller
 *     supplies it (TurnStateTracker does not own task identity —
 *     optional, like post-terminal-authority-diagnostic.ts).
 *   - Test-visible: `get()`, `getLatest()`, `clear()` are exported.
 *   - Schema-evolution-safe: writerId values are a finite closed
 *     enum-style union (TS literal types). Adding a new writer
 *     requires extending the union AND adding the writer here, which
 *     is the explicit ACT design contract.
 *
 * Halt-rule posture:
 *   H3 (changes task behavior): capture is a single synchronous object
 *       construction with no I/O and bounded allocation, observable
 *       in Vitest.
 *   H4 (no protocol / public field): zero new wire fields, zero new
 *       React-side state, zero public API. Pure host-side diagnostic.
 */

import type { TurnPhase } from "./ExtensionMessage"

const DEFAULT_BUFFER_SIZE = 256

/**
 * Closed union of every production writer of the legacy TurnState.
 * Adding a new writer requires a TS-level extension here AND a new
 * tagging call at the writer site — this is the load-bearing
 * architectural invariant of ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-
 * PROVENANCE01: the writer-id set is small, finite, and explicit.
 *
 * The "unknown-legacy-writer" sentinel exists for defensive use at the
 * shared mutation seam when a caller does NOT tag the write. A
 * well-instrumented production build must produce ZERO unknown-legacy-
 * writer records; their presence is the diagnostic's own failure
 * surface.
 */
export type TurnStateWriterId =
	| "session-event-pending-prompt-submitted"
	| "session-event-turn-complete-error"
	| "session-event-turn-complete-completed"
	| "session-event-turn-complete-awaiting-followup"
	| "session-event-turn-complete-awaiting-followup-liveness"
	| "session-event-turn-complete-resumable-straggler-preserve"
	| "interaction-handle-mistake-limit"
	| "interaction-handle-tool-approval"
	| "interaction-resolve-tool-approval-message-response"
	| "interaction-resolve-tool-approval-yes-no"
	| "interaction-handle-ask-question"
	| "interaction-resolve-ask-question"
	| "interaction-resolve-mistake-limit"
	| "task-start-init-task"
	| "task-start-reinit-existing-task"
	| "task-control-resume-ask"
	| "task-control-resumable-ask"
	| "task-control-idle-fallback"
	| "mode-coordinator-mode-switch-resumable"
	| "compaction-enter"
	| "compaction-restore-entry-preserve"
	| "compaction-restore-canonical-unavailable-preserve"
	| "compaction-restore-canonical-resolved"
	| "followup-auto-continue-starting"
	| "followup-auto-continue-failed"
	| "followup-on-follow-up-abandoned"
	| "followup-on-resume-failed"
	| "controller-on-send-error"
	| "controller-emit-cline-auth-error"
	| "controller-emit-cline-balance-error"
	| "controller-cancel-task"
	| "controller-clear-task"
	| "controller-ask-response"
	| "controller-edit-message-and-regenerate"
	| "controller-epoch-transition-reseed"
	| "controller-restore-checkpoint"
	| "unknown-legacy-writer"

/**
 * Optional identity the caller may attach when it has the active
 * session / task id at the mutation site. The tracker itself does not
 * own task identity; the SdkController wraps the callback it hands
 * to the coordinators so it can stamp these fields synchronously at
 * every mutation. NEVER required by the diagnostic.
 */
export interface TurnStateWriterIdentity {
	readonly writerId: TurnStateWriterId
	readonly taskId?: string
	readonly epoch?: number
}

/**
 * One bounded record. Captured AT the moment of the legacy phase
 * mutation, AFTER the snapshot has been committed. The previous
 * snapshot (oldPhase/oldSeq/oldAnchorTs) is captured by the shared
 * seam BEFORE it overwrites the internal fields; the requested /
 * committed triple records the same call's intent and result.
 *
 * Canonical snapshot at request time is intentionally OMITTED in the
 * default record shape: sampling the canonical shadow here would
 * require the seam to reach into the wiring / AgentRuntime, which
 * would couple this module to the SDK transport. ACT §5 explicitly
 * authorizes `LIVE_UNOBSERVABLE` — leaving the canonical fields off
 * by default — and reserves `LIVE_OBSERVABLE` as a future, opt-in
 * extension once the writer identity is captured.
 */
export interface TurnStateWriterProvenanceRecord {
	readonly capturedAt: number
	readonly writerId: TurnStateWriterId

	readonly taskId?: string
	readonly epoch?: number

	readonly previous: {
		readonly phase: TurnPhase
		readonly seq: number
		readonly anchorTs: number | undefined
	}
	readonly requested: {
		readonly phase: TurnPhase
		readonly anchorTs: number | undefined
	}
	readonly committed: {
		readonly phase: TurnPhase
		readonly seq: number
		readonly anchorTs: number | undefined
	}
}

/**
 * Module-level bounded ring. Mirrors post-terminal-authority-
 * diagnostic.ts structurally so the production diagnostic modules
 * stay symmetric and discoverable.
 *
 * ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01:
 *
 * The internal representation is a circular ring (`slot[]`,
 * `head`, `count`) with constant-time append. The previous
 * implementation rebuilt a fresh array on every append via
 * `[...records, record]` / `[...records.slice(...), record]`,
 * which placed an O(capacity) copy on the hot `setWithWriter`
 * path (≈49% self-time under dogfood). The replacement moves
 * the O(capacity) cost onto the cold read path (`getRecords()`,
 * `findByPhase`, `findByWriter`, dump), where it is amortized
 * over operator-initiated diagnostic reads, not over every
 * turn-state write.
 *
 * The public projection (`getRecords()`) materializes a
 * chronological snapshot on demand. This snapshot is not
 * retained between calls; callers that need to retain a
 * chronological view can keep the returned array. The internal
 * `slot[]` is NEVER exposed — only the chronological
 * projection is.
 *
 * The `bufferSize` field is renamed internally to `capacity` to
 * match the ring semantics. External `setTurnStateWriterProvenanceBufferSize`
 * keeps the existing public name and semantics.
 */
interface ProvenanceBuffer {
	enabled: boolean
	capacity: number
	slot: Array<TurnStateWriterProvenanceRecord | undefined>
	head: number
	count: number
	seq: number
	/**
	 * Test-only allocation counter (PROVHOT-O1-01 / PROVHOT-RESIZE-01).
	 * Increments ONCE per slot-reconciliation in `record` and
	 * `getLatest` (cold-path allocations of a fresh slot buffer).
	 * Production code MUST NOT consult this field; it exists only
	 * so the regression test can observe the cold-path boundary.
	 *
	 * The counter is reset by `_resetTurnStateWriterProvenanceTestCounters`.
	 * @internal
	 */
	__testAllocCount: number
	/**
	 * Test-only wrapped-ring-overflow observation (PROVHOT-O1-01).
	 * Captures the maximum slot.length observed during the test run,
	 * to detect any path that exceeded `capacity` due to allocate-
	 * on-wrap. Production code MUST NOT consult this field.
	 * @internal
	 */
	__testMaxSlotLen: number
}

function emptyProvenanceBuffer(): ProvenanceBuffer {
	return {
		enabled: false,
		capacity: DEFAULT_BUFFER_SIZE,
		slot: [],
		head: 0,
		count: 0,
		seq: 0,
		__testAllocCount: 0,
		__testMaxSlotLen: 0,
	}
}

const provenanceBuffer: ProvenanceBuffer = emptyProvenanceBuffer()

/**
 * @internal
 * Reset the test-only allocation counter and the max-slot-length
 * observation. Tests call this in `beforeEach` so each test runs
 * against a clean counter.
 */
export function _resetTurnStateWriterProvenanceTestCounters(): void {
	provenanceBuffer.__testAllocCount = 0
	provenanceBuffer.__testMaxSlotLen = 0
}

/**
 * @internal
 * Returns:
 *   `{ allocCount, maxSlotLen }`
 * where `allocCount` is the number of cold-path slot reconciliations
 * observed during the test run, and `maxSlotLen` is the maximum
 * slot-length observed. Any append path that allocates a fresh slot
 * buffer increments `allocCount`; the maximum slot-length after any
 * append is captured in `maxSlotLen` for diagnosis.
 */
export function _getTurnStateWriterProvenanceTestCounters(): { allocCount: number; maxSlotLen: number } {
	return {
		allocCount: provenanceBuffer.__testAllocCount,
		maxSlotLen: provenanceBuffer.__testMaxSlotLen,
	}
}

/**
 * @internal
 * Snapshot the current slot reference. A subsequent call to
 * `_hasSlotBeenReallocatedSince(slot)` returns `true` if the slot
 * backing the live buffer has been replaced by a fresh array at
 * any point since. The hot-path steady-state MUST return `false`
 * across 10,000 full-ring appends; if it ever returns `true`, a
 * cold-path allocation has fired in steady state.
 */
export function _snapshotTurnStateWriterProvenanceSlot(): Array<TurnStateWriterProvenanceRecord | undefined> {
	return provenanceBuffer.slot
}

/**
 * @internal
 * Compares the current slot reference to the captured snapshot.
 * Returns `true` if `provenanceBuffer.slot !== snapshot` — i.e. the
 * slot was replaced by a fresh array at any point. Used by
 * PROVHOT-O1-01 to enforce the steady-state invariant that no
 * per-append allocation occurs once the slot has matched capacity.
 */
export function _hasSlotBeenReallocatedSince(snapshot: Array<TurnStateWriterProvenanceRecord | undefined>): boolean {
	return provenanceBuffer.slot !== snapshot
}

export function enableTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.enabled = true
}

export function disableTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.enabled = false
}

export function setTurnStateWriterProvenanceBufferSize(n: number): void {
	// ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01:
	// the OLD algorithm's `setSize` was a literal single-line setter
	// (`bufferSize = size`) that did NOT reallocate or evict. The
	// NEW implementation preserves that exact behavior — subsequent
	// appends honor the new capacity via the natural FIFO-trim path
	// inside `recordTurnStateWriterProvenance`. (Conservation of the
	// public contract is proven by PROVHOT-EQUIV-01.)
	provenanceBuffer.capacity = Math.max(0, Math.floor(n))
}

export function isTurnStateWriterProvenanceDiagnosticEnabled(): boolean {
	return provenanceBuffer.enabled
}

export function clearTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.slot = []
	provenanceBuffer.head = 0
	provenanceBuffer.count = 0
	provenanceBuffer.seq = 0
}

/**
 * Materialize the chronological projection of the ring. This is
 * the ONLY place that copies the retained records. Called by
 * the cold read paths (`getRecords`, `findByPhase`, `findByWriter`,
 * and the diagnostic dump) — never by the hot append path.
 *
 * If capacity is 0, returns an empty array. If count < capacity,
 * returns the first `count` slots in order. If count === capacity,
 * walks the ring from `head` and returns the wrapped sequence.
 */
function materializeChronological(): readonly TurnStateWriterProvenanceRecord[] {
	const slot = provenanceBuffer.slot
	const head = provenanceBuffer.head
	const count = provenanceBuffer.count
	const capacity = provenanceBuffer.capacity
	if (count === 0) {
		return []
	}
	// Cold read path. Walk the ring from `head` for `count` records.
	// If `count > capacity` (a `setSize` shrink followed by no
	// intervening append left more records than the new cap, which
	// matches the OLD algorithm's "setSize is a no-op" public
	// contract), this returns all `count` records — same as the
	// OLD reference. The chronology is preserved because the ring
	// was wrapped correctly during appends; the cold read does NOT
	// truncate, in order to match the OLD's observable semantics
	// (`setSize` is a no-op on retained records).
	const slotLen = slot.length || capacity
	const out: TurnStateWriterProvenanceRecord[] = new Array(count)
	for (let i = 0; i < count; i++) {
		out[i] = slot[(head + i) % slotLen] as TurnStateWriterProvenanceRecord
	}
	return out
}

/**
 * Append one record. No-op when the diagnostic is disabled (default).
 * Bounded FIFO trim when the ring is full: drop the oldest record.
 * The `seq` counter is independent of any wire field and is purely
 * a within-diagnostic monotonic id used by `getLatest()` callers.
 *
 * ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01:
 *
 * The hot path is TRUE O(1) once the physical slot matches
 * `capacity`. Steady state is:
 *
 *   slot.length === capacity  AND  count <= capacity
 *
 * ...and every append is then one indexed assignment plus two
 * integer updates. No allocations, no copies, no modulo on
 * `count`. The O(capacity) work moves to two cold paths:
 *
 *   1. The slot-drift reconcile, taken ONLY when `slot.length !==
 *      capacity` (which can only happen after `setSize` shrinks
 *      `capacity` below the slot length, since setSize is a no-op).
 *      This path runs ONCE per capacity change — not per append.
 *   2. The read path (`materializeChronological`), which is called
 *      only on `getRecords`, `findByPhase`, `findByWriter`, and the
 *      diagnostic dump (operator-initiated, not on every mutation).
 *
 * This function is the ONLY mutation point on the ring. Every other
 * helper either reads, enables/disables, or clears. Adding new
 * production writers does not require touching this function — only
 * extending the writerId union and instrumenting the writer site.
 */
export function recordTurnStateWriterProvenance(record: TurnStateWriterProvenanceRecord): void {
	if (!provenanceBuffer.enabled) {
		return
	}
	provenanceBuffer.seq += 1
	const capacity = provenanceBuffer.capacity
	if (capacity === 0) {
		return
	}
	let { slot, head, count } = provenanceBuffer
	// Hot-path invariant: in steady state slot.length === capacity.
	// The slot-drift branch fires only when a no-op setSize shrunk
	// capacity below the slot's physical length (or, symmetrically,
	// grew capacity above the slot's physical length). This is the
	// SINGLE allocation point on the append path. After it, slot is
	// freshly sized to `capacity` and the next append is hot.
	if (slot.length !== capacity) {
		const oldLen = slot.length
		const newSlot: Array<TurnStateWriterProvenanceRecord | undefined> = new Array(capacity)
		if (oldLen > 0 && count > 0) {
			const copyStart = Math.max(0, count - capacity)
			const copyCount = Math.min(count, capacity)
			for (let i = 0; i < copyCount; i++) {
				newSlot[i] = slot[(head + copyStart + i) % oldLen] as TurnStateWriterProvenanceRecord
			}
			count = copyCount
		}
		slot = newSlot
		head = 0
		provenanceBuffer.slot = slot
		provenanceBuffer.head = head
		provenanceBuffer.count = count
		// PROVHOT-O1-01 observation: a cold-path allocation
		// happened. Production code MUST NOT consult this counter;
		// only the test-only regression discriminator may.
		provenanceBuffer.__testAllocCount += 1
		if (slot.length > provenanceBuffer.__testMaxSlotLen) {
			provenanceBuffer.__testMaxSlotLen = slot.length
		}
	}
	// Steady-state maxSlotLen observation (cheap; one integer compare).
	if (slot.length > provenanceBuffer.__testMaxSlotLen) {
		provenanceBuffer.__testMaxSlotLen = slot.length
	}
	if (count < capacity) {
		// Ring not yet full. Write at the next free slot. Note: when
		// the slot was just reallocated by the slot-drift branch,
		// head is reset to 0 — so `(head + count) % capacity` reduces
		// to `count` modulo, and `head + count < capacity`, so this
		// is effectively an indexed assignment. Using `(head + count)
		// % capacity` instead of plain `count` keeps the formula
		// uniform with the wrap path below.
		slot[(head + count) % capacity] = record
		provenanceBuffer.count = count + 1
	} else {
		// Ring full. Overwrite the oldest record at `slot[head]` and
		// advance head. NO allocation, NO copy. This is the steady-
		// state hot path: one indexed assignment + one modulo + one
		// integer assignment.
		slot[head] = record
		provenanceBuffer.head = (head + 1) % capacity
	}
}

export function getTurnStateWriterProvenanceRecords(): readonly TurnStateWriterProvenanceRecord[] {
	return materializeChronological()
}

export function getTurnStateWriterProvenanceLatest(): TurnStateWriterProvenanceRecord | undefined {
	const { slot, head, count } = provenanceBuffer
	if (count === 0) {
		return undefined
	}
	// Cold read (mirror of materializeChronological). Returns the
	// most recently appended record, regardless of any setSize(0)
	// that may have followed — matches the OLD algorithm's
	// "setSize is a no-op on retained records" public contract.
	const slotLen = slot.length || provenanceBuffer.capacity
	return slot[(head + count - 1) % slotLen] as TurnStateWriterProvenanceRecord
}

export function getTurnStateWriterProvenanceSeq(): number {
	return provenanceBuffer.seq
}

/**
 * Find every record in the ring where the committed phase matches
 * the requested predicate. Pure helper, intended for post-capture
 * forensics; not used in any synchronous mutation path.
 */
export function findTurnStateWriterProvenanceByPhase(
	predicate: (phase: TurnPhase) => boolean,
): readonly TurnStateWriterProvenanceRecord[] {
	return materializeChronological().filter((r) => predicate(r.committed.phase))
}

/**
 * Find every record carrying the requested writerId. Pure helper.
 */
export function findTurnStateWriterProvenanceByWriter(writerId: TurnStateWriterId): readonly TurnStateWriterProvenanceRecord[] {
	return materializeChronological().filter((r) => r.writerId === writerId)
}
