/**
 * ACT-CLINEMM-BCB-CAPTURE01
 *
 * Bounded read-only diagnostic capture for the BCB observation-unavailable
 * decision boundary at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3146-3194`.
 *
 * The prior RED01 / CORR01 chain (ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01)
 * identified the BCB writer as the live firing branch for the SEAM10 turn
 * but reported the cause of `canObserveHeldResults === false` as
 * `CAPTURE_INSUFFICIENT` — the recovered live bundle did NOT carry the
 * `liveTools()` value at the BCB writer firing moment. This module is the
 * bounded, DEFAULT_OFF, read-only diagnostic recommended by the prior ACT
 * to close that gap on a future live run.
 *
 * Trust binding:
 *   - Default off: enable/disable toggle is OFF in production. When
 *     disabled, `recordBcbObservationUnavailableCapture()` is a complete
 *     no-op so the production path semantics are unchanged (verified by
 *     BCAPT-EQUIV).
 *   - One user action: `cline.debug.toggleBcbObservationUnavailableCapture`
 *     flips the workspace-state flag.
 *   - One dump action: `cline.debug.dumpBcbObservationUnavailableCapture`
 *     serializes the ring to
 *     `<context.globalStorageUri.fsPath>/bcb-observation-unavailable-capture.jsonl`.
 *   - Bounded: ring buffer of 64 records (default), expandable via
 *     `setBcbObservationUnavailableCaptureBufferSize(n)` for tests.
 *   - Privacy-safe: NO prompt content, NO model output, NO tool args,
 *     NO turn body. The record only carries the four BCB predicate
 *     inputs that determine the writer + the evaluated liveTools() result
 *     (an array of opaque tool NAMES, not schemas/args) + correlation
 *     identity (sessionId, taskId, epoch, capturedAt).
 *   - Test-visible: `getRecords()`, `getLatest()`, `clear()` are exported.
 *   - Schema-evolution-safe: writerId values are a finite closed
 *     enum-style union (TS literal types). Adding a new writer
 *     requires extending the union AND adding the writer here.
 *
 * Halt-rule posture:
 *   H3 (changes task behavior): the capture is a single synchronous
 *       object construction with no I/O and bounded allocation,
 *       observable in Vitest.
 *   H4 (no protocol / public field): zero new wire fields, zero new
 *       React-side state, zero public API. Pure host-side diagnostic.
 *
 * REMOVAL_TRIGGER: first of (a) cause isolated, (b) capture insufficient
 * (successor counter design required), (c) successor evidence supersedes
 * it. On removal, this module + the runtime module + the production
 * recorder call + the registry entries + the package.json declarations +
 * the extension.ts handlers MUST be removed TOGETHER.
 */

import type { TurnPhase } from "./ExtensionMessage"

const DEFAULT_BUFFER_SIZE = 64

/**
 * The closed writerId union for the BCB observation-unavailable decision
 * boundary. Only the writers that the BCB decision may call are listed —
 * the coordinator's other writers are not in scope of this diagnostic.
 */
export type BcbObservationUnavailableWriterId =
	| "session-event-bcb-blocked-observation-unavailable"
	| "session-event-bcb-eligible-no-bcb-writer"
	| "unknown-bcb-capture-writer"

export interface BcbObservationUnavailableCaptureRecord {
	readonly capturedAt: number
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
	// BCB01 §0.1 second-conjunct eligibility
	readonly eligibleForCoalescedContinuation: boolean
	// Held-result ownership (DO NOT infer from runtimePendingToolCount)
	readonly unconsumedOwnedTerminalResultsForC10: number
	readonly ownedTerminalJobIdsForC10: readonly string[]
	// The other conjuncts of the BCB01 §0.1 invariant
	readonly outstandingAutonomousWork: boolean
	readonly ownerStillRunningForC10: boolean
	readonly heldObligationForC10: boolean
	readonly suppressOriginatingCompletion: boolean
	// The actual evaluated liveTools() result — preserve undefined vs defined distinction
	readonly liveToolsAvailable: boolean
	readonly liveToolsIncludesCommandStatus: boolean
	readonly liveToolsCount: number
	/** Raw tool-name list (opaque names, no schemas/args). */
	readonly liveToolsValue: readonly string[] | undefined
	// The tri-state canObserveHeldResults (true/false/null preserved)
	readonly canObserveHeldResults: boolean | null
	// Same-obligation idempotence guard
	readonly sameObligationAlreadyObservationUnavailable: boolean
	// The writer selected at the BCB decision point
	readonly writerId: BcbObservationUnavailableWriterId
	// Requested phase + committed phase at the seam
	readonly requestedPhase: TurnPhase | undefined
	readonly committedPhase: TurnPhase | undefined
}

// ============================================================================
// RING BUFFER (default off, bounded)
// ============================================================================

interface BcbCaptureBuffer {
	enabled: boolean
	capacity: number
	slot: Array<BcbObservationUnavailableCaptureRecord | undefined>
	head: number
	count: number
	seq: number
	__testAllocCount: number
	__testMaxSlotLen: number
}

const bcbCaptureBuffer: BcbCaptureBuffer = {
	enabled: false,
	capacity: DEFAULT_BUFFER_SIZE,
	slot: new Array(DEFAULT_BUFFER_SIZE),
	head: 0,
	count: 0,
	seq: 0,
	__testAllocCount: 0,
	__testMaxSlotLen: 0,
}

export function isBcbObservationUnavailableCaptureEnabled(): boolean {
	return bcbCaptureBuffer.enabled
}

export function enableBcbObservationUnavailableCapture(): void {
	bcbCaptureBuffer.enabled = true
}

export function disableBcbObservationUnavailableCapture(): void {
	bcbCaptureBuffer.enabled = false
}

export function setBcbObservationUnavailableCaptureBufferSize(size: number): void {
	const next = Math.max(0, Math.floor(size))
	if (next === bcbCaptureBuffer.capacity) {
		return
	}
	bcbCaptureBuffer.capacity = next
	const oldLen = bcbCaptureBuffer.slot.length
	const newSlot: Array<BcbObservationUnavailableCaptureRecord | undefined> = new Array(next)
	if (oldLen > 0 && bcbCaptureBuffer.count > 0 && next > 0) {
		const copyStart = Math.max(0, bcbCaptureBuffer.count - next)
		const copyCount = Math.min(bcbCaptureBuffer.count, next)
		for (let i = 0; i < copyCount; i++) {
			newSlot[i] = bcbCaptureBuffer.slot[(bcbCaptureBuffer.head + copyStart + i) % oldLen]
		}
		bcbCaptureBuffer.count = copyCount
		bcbCaptureBuffer.head = 0
	}
	bcbCaptureBuffer.slot = newSlot
	bcbCaptureBuffer.__testAllocCount += 1
	if (newSlot.length > bcbCaptureBuffer.__testMaxSlotLen) {
		bcbCaptureBuffer.__testMaxSlotLen = newSlot.length
	}
}

function materializeChronological(): readonly BcbObservationUnavailableCaptureRecord[] {
	const { slot, head, count, capacity } = bcbCaptureBuffer
	if (count === 0) {
		return []
	}
	const out: BcbObservationUnavailableCaptureRecord[] = new Array(count)
	const slotLen = slot.length || capacity
	for (let i = 0; i < count; i++) {
		const rec = slot[(head + i) % slotLen]
		if (rec !== undefined) {
			out[i] = rec
		}
	}
	return out
}

export function getBcbObservationUnavailableCaptureRecords(): readonly BcbObservationUnavailableCaptureRecord[] {
	return materializeChronological()
}

export function getBcbObservationUnavailableCaptureLatest(): BcbObservationUnavailableCaptureRecord | undefined {
	const { slot, head, count, capacity } = bcbCaptureBuffer
	if (count === 0) {
		return undefined
	}
	const slotLen = slot.length || capacity
	return slot[(head + count - 1) % slotLen]
}

export function getBcbObservationUnavailableCaptureSeq(): number {
	return bcbCaptureBuffer.seq
}

export function clearBcbObservationUnavailableCapture(): void {
	bcbCaptureBuffer.slot = new Array(bcbCaptureBuffer.capacity)
	bcbCaptureBuffer.head = 0
	bcbCaptureBuffer.count = 0
	bcbCaptureBuffer.seq = 0
}

/**
 * Record one BCB observation-unavailable decision record. The capture is
 * a single synchronous object construction with no I/O. When the
 * diagnostic is disabled this is a complete no-op (the production path
 * semantics are unchanged — verified by BCAPT-EQUIV).
 *
 * The writerId must be a closed BcbObservationUnavailableWriterId. This
 * is the canonical site where the BCB decision boundary's branches
 * (eligibility-no-bcb-writer, observation-unavailable, same-obligation
 * idempotence) report what they decided.
 */
export function recordBcbObservationUnavailableCapture(input: Omit<BcbObservationUnavailableCaptureRecord, "capturedAt">): void {
	if (!bcbCaptureBuffer.enabled) {
		return
	}
	const record: BcbObservationUnavailableCaptureRecord = {
		capturedAt: Date.now(),
		...input,
	}
	let { slot, head, count, capacity } = bcbCaptureBuffer
	if (slot.length !== capacity) {
		const oldLen = slot.length
		const newSlot: Array<BcbObservationUnavailableCaptureRecord | undefined> = new Array(capacity)
		if (oldLen > 0 && count > 0) {
			const copyStart = Math.max(0, count - capacity)
			const copyCount = Math.min(count, capacity)
			for (let i = 0; i < copyCount; i++) {
				newSlot[i] = slot[(head + copyStart + i) % oldLen] as BcbObservationUnavailableCaptureRecord
			}
			count = copyCount
		}
		slot = newSlot
		head = 0
		bcbCaptureBuffer.slot = slot
		bcbCaptureBuffer.head = head
		bcbCaptureBuffer.count = count
		bcbCaptureBuffer.__testAllocCount += 1
		if (slot.length > bcbCaptureBuffer.__testMaxSlotLen) {
			bcbCaptureBuffer.__testMaxSlotLen = slot.length
		}
	}
	if (slot.length > bcbCaptureBuffer.__testMaxSlotLen) {
		bcbCaptureBuffer.__testMaxSlotLen = slot.length
	}
	if (count < capacity) {
		slot[(head + count) % capacity] = record
		bcbCaptureBuffer.count = count + 1
	} else {
		slot[head] = record
		bcbCaptureBuffer.head = (head + 1) % capacity
	}
	bcbCaptureBuffer.seq += 1
}

/**
 * Find every record in the ring where the writerId matches. Pure
 * helper, intended for post-capture forensics; not used in any
 * synchronous mutation path.
 */
export function findBcbObservationUnavailableCaptureByWriter(
	writerId: BcbObservationUnavailableWriterId,
): readonly BcbObservationUnavailableCaptureRecord[] {
	return materializeChronological().filter((r) => r.writerId === writerId)
}

// ============================================================================
// TRANSACTIONAL-TEST-CONTROL SAFETY
// ============================================================================
// The diagnostic is intended to be used by Vitest tests that enable
// capture, trigger actions, then assert on the captured records. The
// helpers below extend the lifecycle:
//
//   beforeEach:
//     clearBcbObservationUnavailableCapture()
//     enableBcbObservationUnavailableCapture()
//
//   afterEach:
//     disableBcbObservationUnavailableCapture()
//
// In production the capture is never enabled; the production path
// never invokes `recordBcbObservationUnavailableCapture` so the buffer
// stays empty.

/**
 * For tests only: convenience to assert that the diagnostic is in the
 * exact default state (disabled + empty).
 */
export function isBcbObservationUnavailableCaptureInDefaultState(): boolean {
	return !bcbCaptureBuffer.enabled && bcbCaptureBuffer.count === 0 && bcbCaptureBuffer.seq === 0
}
