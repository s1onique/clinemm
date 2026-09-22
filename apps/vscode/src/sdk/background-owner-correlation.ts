/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * Bounded diagnostic capture for the Q5 done-without-completion
 * decision boundary in sdk-session-event-coordinator.ts. Captures
 * the LIVE ownership tuple (jobId, ownerSessionId, active session
 * id, guard result) at the single decision seam so the next
 * recurrence of the Working->Your turn failure can be classified
 * as OC1 (producer stamp defect), OC2 (active-session identity
 * drift), OC3 (guard unavailable), or contradiction against the
 * synthetic model.
 *
 * Trust binding (mirrors the TSWPD / THSICAP pattern):
 *   - Default off: the module-level captureEnabled seam starts
 *     false. When disabled, every record is a complete no-op so
 *     the production path semantics are unchanged.
 *   - One user action: the dogfood diagnostic profile resolver
 *     (dogfood-diagnostic-profile.ts) flips the seam at extension
 *     activation in dogfood. There is NO separate env-var, NO
 *     workspace toggle, NO webview surface.
 *   - One dump action: cline.debug.dumpBackgroundOwnerCorrelation
 *     serializes the bounded ring to
 *     <globalStorageUri>/background-owner-correlation.jsonl. The
 *     dump is unconditional so an operator can inspect whatever was
 *     captured even after the diagnostic is disabled.
 *   - Bounded: appends to a FIFO ring (default 64 records - generous
 *     for one decision-boundary observation per done-without-
 *     completion turn, small enough to keep memory bounded).
 *   - Privacy-safe: no prompt content, no model output, no tool args,
 *     no turn body. The record only carries the identity tuple
 *     (jobId / sessionId / guard / writerId) and the capture
 *     timestamp.
 *   - Read-only: never mutates the production state shape. Zero new
 *     wire fields, zero React-side state, zero public API.
 *
 * REMOVAL_TRIGGER (per ACT sec 37, mirrors THSICAP / W carrier):
 *   first successful LIVE binding of the LIVE cause (OC1/OC2/OC3)
 *   AND qualification of the bounded repair (PASS_CASE_*) - OR -
 *   CAPTURE_INSUFFICIENT - OR - better evidence supersedes it.
 *   No quiet promotion to architecture.
 */

import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import type { CommandJobState } from "./command-job-manager"

const DEFAULT_BUFFER_SIZE = 64

/**
 * Minimal internal record of one job currently held in the active
 * CommandJobManager.active map. Mirrors the read-only diagnostic
 * snapshot contract (no execution capability, no PGID, no shell -
 * identity only).
 */
export interface BackgroundOwnerCorrelationActiveJob {
	readonly jobId: string
	readonly state: CommandJobState
	readonly ownerSessionId: string | undefined
}

/**
 * Single decision-boundary observation. Captured once per
 * done-without-completion event for which the Q5 composition
 * seam evaluates the guard. The schema is frozen: adding a field
 * is a breaking change for the post-capture correlation tests.
 *
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 adds
 * `managerInstance` and `hostInstance` as OPTIONAL diagnostic-only
 * fields (additive — existing schema remains valid). They are
 * populated only when the BJLA capture seam is ON.
 */
export interface BackgroundOwnerCorrelationRecord {
	readonly event: "background_owner_correlation_decision"
	readonly capturedAt: number
	readonly taskId: string | null
	readonly sessionEventSessionId: string | null
	readonly activeSessionId: string | null
	readonly currentPhase: "streaming"
	readonly candidatePhase: "awaiting_followup"
	/**
	 * true when the production SdkController wired the
	 * hasRunningBackgroundJobForOwner option into the coordinator.
	 * Tests that omit the option (per the BCAFG01 / ACAS01
	 * precedent) report false so the synthetic evidence matches
	 * the production wiring matrix.
	 */
	readonly guardAvailable: boolean
	/**
	 * The exact session id queried against the guard. Mirrors
	 * activeSession.sessionId at decision time; recorded as a
	 * distinct field so a future correlation can prove identity
	 * equality without re-deriving the value from
	 * activeSessionId.
	 */
	readonly queriedOwnerSessionId: string | null
	readonly guardResult: boolean | null
	readonly activeJobs: readonly BackgroundOwnerCorrelationActiveJob[]
	/**
	 * Always the canonical Q5 else-branch writerId. Recorded here
	 * (in addition to the TSWPD record) so a single BOCOR dump is
	 * self-describing without joining to a separate TSWPD dump.
	 */
	readonly candidateWriterId: TurnStateWriterId
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
	 * BJLA diagnostic-only correlation token for the manager
	 * instance the guard consulted at the Q5 boundary. `null` when
	 * the BJLA capture seam is OFF (default public behavior).
	 */
	readonly managerInstance?: string | null
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
	 * BJLA diagnostic-only correlation token for the host instance
	 * the guard consulted at the Q5 boundary. `null` when the BJLA
	 * capture seam is OFF (default public behavior).
	 */
	readonly hostInstance?: string | null
	/**
	 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01:
	 * Count of queued prompts in PendingPromptsController for the
	 * active session at the Q5 boundary. `undefined` when the new
	 * `getPendingPromptCount` option is not wired (pre-ACT tests).
	 */
	readonly pendingPromptCount?: number
	/**
	 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01:
	 * Availability-aware `PendingPromptCountRead` discriminated
	 * union read at the Q5 boundary. Carries the full
	 * `{ available, count? }` shape so the BOCOR diagnostic can
	 * distinguish "queue known to be empty" from "queue mirror
	 * not yet initialized" — critical for diagnosing
	 * PROVISIONAL_FAIL_OPEN_RISK regressions in the Hub transport.
	 */
	readonly pendingPromptCountRead?: {
		available: boolean
		count?: number
	}
	/**
	 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01:
	 * `true` when the Q5 reader got `{ available: false }` from
	 * the pending-prompt authority (Hub session not yet mirrored).
	 * Always `false` for LocalRuntimeHost (which is unconditionally
	 * available). Drives the same deferred-continuation marker
	 * path as `pendingPromptCount > 0`.
	 */
	readonly pendingPromptAuthorityUnknown?: boolean
	/**
	 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01:
	 * Count of active BackgroundNotifyCoordinator markers for
	 * (activeSessionId, taskId) at the Q5 boundary. `undefined`
	 * when the new `getActiveNotifyCount` option is not wired.
	 */
	readonly activeNotifyCount?: number
	/**
	 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01:
	 * The combined `outstandingAutonomousWork` predicate evaluated
	 * at the Q5 boundary. `true` means the Q5 seam defers (no
	 * awaiting_followup commit); `false` means the Q5 seam commits
	 * awaiting_followup (genuine operator handoff).
	 */
	readonly outstandingAutonomousWork?: boolean
}

const buffer: BackgroundOwnerCorrelationRecord[] = []
let bufferSize = DEFAULT_BUFFER_SIZE

/**
 * Module-level capture seam. The dogfood diagnostic profile
 * resolver sets this once at extension activation; production
 * capture consults ONLY this seam - the env var is read in
 * exactly ONE place (the resolver).
 */
let captureEnabled = false

export function isBackgroundOwnerCorrelationCaptureEnabled(): boolean {
	return captureEnabled
}

export function setBackgroundOwnerCorrelationCaptureEnabled(enabled: boolean): void {
	captureEnabled = Boolean(enabled)
}

/**
 * Append one record to the ring. Bounded FIFO eviction. No-op
 * when the capture seam is OFF (default).
 */
export function captureBackgroundOwnerCorrelationRecord(record: BackgroundOwnerCorrelationRecord): void {
	if (!captureEnabled) return
	buffer.push(record)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
}

/**
 * Bounded ring reader. Returns a frozen view; consumers must
 * not mutate.
 */
export function getBackgroundOwnerCorrelationCaptureRecords(): readonly BackgroundOwnerCorrelationRecord[] {
	return buffer
}

/**
 * Test-only: clear the ring. Production code never calls this;
 * the dump command does NOT clear the ring (matches the W-carrier
 * / TSWPD dump != clear contract so an accidental first dump does
 * not destroy evidence).
 */
export function clearBackgroundOwnerCorrelationCaptureRecords(): void {
	buffer.length = 0
}

/**
 * Test-only: override the ring buffer size. Mirrors the TSWPD /
 * THSICAP buffer-size setter.
 */
export function setBackgroundOwnerCorrelationCaptureBufferSize(size: number): void {
	const clamped = Math.max(0, Math.floor(size))
	bufferSize = clamped
	if (buffer.length > bufferSize) {
		buffer.length = bufferSize
	}
}
