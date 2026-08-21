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
 */
interface ProvenanceBuffer {
	enabled: boolean
	bufferSize: number
	records: readonly TurnStateWriterProvenanceRecord[]
	seq: number
}

function emptyProvenanceBuffer(): ProvenanceBuffer {
	return {
		enabled: false,
		bufferSize: DEFAULT_BUFFER_SIZE,
		records: [],
		seq: 0,
	}
}

const provenanceBuffer: ProvenanceBuffer = emptyProvenanceBuffer()

export function enableTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.enabled = true
}

export function disableTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.enabled = false
}

export function setTurnStateWriterProvenanceBufferSize(n: number): void {
	const size = Math.max(0, Math.floor(n))
	provenanceBuffer.bufferSize = size
}

export function isTurnStateWriterProvenanceDiagnosticEnabled(): boolean {
	return provenanceBuffer.enabled
}

export function clearTurnStateWriterProvenanceDiagnostic(): void {
	provenanceBuffer.records = []
	provenanceBuffer.seq = 0
}

/**
 * Append one record. No-op when the diagnostic is disabled (default).
 * Bounded FIFO trim when the ring is full: drop the oldest record.
 * The `seq` counter is independent of any wire field and is purely
 * a within-diagnostic monotonic id used by `getLatest()` callers.
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
	const size = provenanceBuffer.bufferSize
	if (size === 0) {
		return
	}
	const next =
		provenanceBuffer.records.length < size
			? [...provenanceBuffer.records, record]
			: [...provenanceBuffer.records.slice(provenanceBuffer.records.length - size + 1), record]
	provenanceBuffer.records = next
}

export function getTurnStateWriterProvenanceRecords(): readonly TurnStateWriterProvenanceRecord[] {
	return provenanceBuffer.records
}

export function getTurnStateWriterProvenanceLatest(): TurnStateWriterProvenanceRecord | undefined {
	const records = provenanceBuffer.records
	return records.length === 0 ? undefined : records[records.length - 1]
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
	return provenanceBuffer.records.filter((r) => predicate(r.committed.phase))
}

/**
 * Find every record carrying the requested writerId. Pure helper.
 */
export function findTurnStateWriterProvenanceByWriter(writerId: TurnStateWriterId): readonly TurnStateWriterProvenanceRecord[] {
	return provenanceBuffer.records.filter((r) => r.writerId === writerId)
}
