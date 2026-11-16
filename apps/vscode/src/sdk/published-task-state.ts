/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01
 *
 * The controller-owned, bounded, immutable record of the LAST ELIGIBLE
 * HOST-SUBMITTED TaskHeader presentation.
 *
 * WHY THIS EXISTS
 *
 *   The 2026-11-16 incident showed that `running` (the SDK agent-turn
 *   mirror) and the ClineMM task-header phase are DIFFERENT facts. MCP
 *   needs to observe the header phase WITHOUT creating another
 *   task-state authority.
 *
 *   So this module does NOT compute a phase. It STORES a phase that the
 *   EXISTING authority already selected:
 *
 *     TurnStateTracker + canonical shadow
 *       -> pickTaskHeaderPresentationForPublication()   [Elm authority]
 *         -> ExtensionState.taskHeaderPresentation
 *           -> sendStateUpdate(state)                  [publication handoff]
 *             -> PublishedTaskStateStore.capture(...)   [THIS MODULE]
 *
 *   The capture happens ONLY AFTER the publication handoff succeeds, so
 *   a constructed-but-never-submitted snapshot is never observable.
 *
 * INVARIANTS
 *
 *   I1  EXACTLY ONE record per store. No history, no diagnostic queue.
 *   I2  The record is IMMUTABLE — `read()` returns a frozen copy, never
 *       a mutable reference into controller-owned state.
 *   I3  A capture whose `stateVersion` is NOT STRICTLY GREATER than the
 *       current record's `stateVersion` (same identity + same epoch) is
 *       REJECTED. This fences an out-of-order async publication.
 *   I4  `invalidate()` clears the record. A task clear / session
 *       replacement / epoch transition / controller disposal calls it,
 *       so an old record cannot be returned for the new active task.
 *   I5  A capture whose epoch is LOWER than the current record's epoch
 *       is REJECTED (a late publication from a previous epoch).
 *   I6  A capture for a DIFFERENT identity REPLACES the record (the
 *       owner changed) but does not resurrect an older publication for
 *       that identity — the version fence applies within an identity.
 *
 * SEQUENCE DOMAINS
 *
 *   `projection.seq` lives in the TurnState / presentation sequence
 *   domain. `stateVersion` lives in the ExtensionState publication
 *   sequence domain. They are DIFFERENT clocks and are NEVER compared
 *   against each other. Only `stateVersion` orders publications.
 */

import type { TaskHeaderPresentationProjection } from "@shared/ExtensionMessage"

/**
 * One immutable published TaskHeader projection, bound to the identity
 * and generation of the ExtensionState that carried it.
 */
export interface PublishedTaskState {
	/** The active session id at publication time. */
	readonly sessionId: string
	/** The active task id at publication time. */
	readonly taskId: string
	/** The conversation epoch of the submitted ExtensionState. */
	readonly epoch: number
	/** The `stateVersion` of the submitted ExtensionState. */
	readonly stateVersion: number
	/** The Elm-selected TaskHeader projection carried by that state. */
	readonly projection: TaskHeaderPresentationProjection
}

/** The frozen, immutable view of the current record. */
function freezeRecord(record: PublishedTaskState): PublishedTaskState {
	return Object.freeze({
		sessionId: record.sessionId,
		taskId: record.taskId,
		epoch: record.epoch,
		stateVersion: record.stateVersion,
		projection: Object.freeze({ ...record.projection }),
	})
}

/**
 * The bounded controller-owned store.
 *
 * ONE instance per controller. The store owns no timers, no listeners
 * and no I/O — it is a pure record holder with generation fencing.
 */
export class PublishedTaskStateStore {
	private record: PublishedTaskState | undefined

	/**
	 * The current record, or `undefined` when no eligible publication
	 * has been accepted.
	 *
	 * The returned value is a frozen copy — a consumer cannot mutate
	 * controller-owned state through it.
	 */
	read(): PublishedTaskState | undefined {
		return this.record
	}

	/**
	 * Accept a publication.
	 *
	 * Returns `true` when the record advanced, `false` when the capture
	 * was rejected (stale version, stale epoch, malformed input).
	 */
	capture(record: PublishedTaskState): boolean {
		if (!record || typeof record.sessionId !== "string" || record.sessionId.length === 0) {
			return false
		}
		if (typeof record.taskId !== "string" || record.taskId.length === 0) {
			return false
		}
		if (!Number.isFinite(record.epoch) || record.epoch < 0) {
			return false
		}
		if (!Number.isFinite(record.stateVersion) || record.stateVersion < 0) {
			return false
		}
		if (!record.projection || typeof record.projection.phase !== "string") {
			return false
		}
		if (!Number.isFinite(record.projection.seq) || record.projection.seq < 0) {
			return false
		}

		const current = this.record
		if (current) {
			const sameIdentity = current.sessionId === record.sessionId && current.taskId === record.taskId
			if (sameIdentity) {
				// I5: a publication from an OLDER epoch never wins.
				if (record.epoch < current.epoch) {
					return false
				}
				// I3: within one identity+epoch, only a STRICTLY newer
				// publication version advances the record. An equal or
				// older `stateVersion` is a stale/duplicate async
				// completion and is rejected.
				if (record.epoch === current.epoch && record.stateVersion <= current.stateVersion) {
					return false
				}
			}
		}

		this.record = freezeRecord(record)
		return true
	}

	/**
	 * Drop the record.
	 *
	 * Called at every ownership change: task clear, session replacement,
	 * epoch transition, controller disposal. After this, the store reads
	 * `undefined` until the next eligible publication.
	 */
	invalidate(): void {
		this.record = undefined
	}
}
