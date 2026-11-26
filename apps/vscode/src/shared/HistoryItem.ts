import type { CloudSessionStatus } from "./cloud/cloud-sessions"
import type { TaskDurationWaitingReason } from "./ExtensionMessage"

export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean

	modelId?: string
	/**
	 * Provider id the task ran on (from the SDK session record). Absent for
	 * tasks recorded before this field existed and for legacy imports —
	 * cost-display consumers treat an absent provider as "show", since
	 * there is nothing to key suppression on.
	 */
	apiProvider?: string
	isLegacy?: boolean
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01:
	 *
	 * The profileId bound to this task at the moment of last binding
	 * write. Persisted in HistoryItem.metadata (canonical seam per
	 * recon §4.1) so resume restores the same profile. The field is
	 * OPTIONAL: tasks bound before Model Profiles V1 (and legacy
	 * imports) carry no value and fall back to defaultProfileId, then
	 * to legacy current-configuration behavior.
	 *
	 * The mapping is implemented in
	 *   apps/vscode/src/sdk/profile-store/session-binding.ts
	 * which is the single writer/reader of this field.
	 */
	activeProfileId?: string

	/** "cloud" for Cline Cloud sessions; absent/"local" for tasks run in this workspace. */
	executionTarget?: "local" | "cloud"
	cloudStatus?: CloudSessionStatus
	cloudRepoUrl?: string
	cloudBranch?: string
	/** True when cloud usage came from an authoritative remote runtime snapshot. */
	cloudUsageAvailable?: boolean
	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01: the persisted
	 * ACTIVE / WAITING / UNKNOWN duration accounting for this task.
	 *
	 * OPTIONAL. Its ABSENCE means "this task was recorded without
	 * authoritative duration accounting" — a legacy task, or a task
	 * recorded before the accounting existed. Consumers MUST render
	 * "unavailable" in that case and MUST NOT represent the absence as
	 * zero active time.
	 *
	 * Only the ACCUMULATED TOTALS and the wall-clock anchor are
	 * persisted. Process-local MONOTONIC timestamps are deliberately
	 * NOT persisted: they are not transferable across processes and
	 * would fabricate continuity across a restart.
	 */
	duration?: TaskDurationPersistence
}

/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01: the persisted form
 * of the duration accounting.
 *
 * It carries the three accumulated totals plus the phase the task was
 * in when the record was written, so a recovery can restore the
 * accounting coherently. An interval that was OPEN when the record was
 * written is accounted to its own category (the totals already include
 * it), and the restored accounting re-opens an interval in that
 * category so the task does not silently stop being accounted for.
 */
export type TaskDurationPersistence = {
	/** Time during which the agent was progressing automatically (ms). */
	activeMs: number
	/** Time during which automatic progression required human input (ms). */
	waitingMs: number
	/** Time that could not be classified from authoritative evidence (ms). */
	unknownMs: number
	/** The phase the task was in when the record was written. */
	phase: "active" | "waiting" | "unknown" | "terminal"
	/** Why the task was waiting, when it was waiting. */
	waitingReason?: TaskDurationWaitingReason
	/** Whether the accounting covered every observed interval. */
	coverage: "complete" | "partial"
}
