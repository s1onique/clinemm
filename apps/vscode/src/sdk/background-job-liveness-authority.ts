/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * Bounded diagnostic capture for the CommandJobManager lifecycle.
 * Captures load-bearing lifecycle events with diagnostic-only object
 * identities (M1, M2, ...; H1, H2, ...) so a single dump can
 * mechanically classify the LIVE occurrence of the
 * "manager-active-empty vs UI-still-running" contradiction as
 * LA1..LA6 (see 06-diagnostic-design.md).
 *
 * Trust binding (mirrors BOCOR / TSWPD / THSICAP / W carrier):
 *   - Default off: the module-level captureEnabled seam starts
 *     false. When disabled, every record is a complete no-op so the
 *     production path semantics are unchanged.
 *   - One user action: the dogfood diagnostic profile resolver
 *     (dogfood-diagnostic-profile.ts) flips the seam at extension
 *     activation in dogfood. There is NO separate env-var, NO
 *     workspace toggle, NO webview surface.
 *   - One dump action: cline.debug.dumpBackgroundJobLivenessAuthority
 *     serializes the bounded ring to
 *     <globalStorageUri>/background-job-liveness-authority.jsonl. The
 *     dump is unconditional so an operator can inspect whatever was
 *     captured even after the diagnostic is disabled.
 *   - Bounded: appends to a FIFO ring (default 256 records — generous
 *     for one full manager lifetime with many job inserts/lookups).
 *   - Privacy-safe: no prompt content, no model output, no tool args,
 *     no turn body. The record only carries the lifecycle identity
 *     tuple (managerInstance / hostInstance / jobId / ownerSessionId
 *     / state / pid / pgid) and the capture timestamp.
 *   - Read-only: never mutates the production state shape. Zero new
 *     wire fields, zero React-side state, zero public API.
 *
 * REMOVAL_TRIGGER (per ACT sec 30):
 *   first successful LIVE classification AND qualification of the
 *   bounded repair (PASS_CASE_*) - OR - CAPTURE_INSUFFICIENT - OR -
 *   better evidence supersedes it.
 *   No quiet promotion to architecture.
 */

import type { CommandJobLifecycleEvent, CommandJobState } from "./command-job-manager"

const DEFAULT_BUFFER_SIZE = 256

// -----------------------------------------------------------------------------
// Diagnostic-only object identities
//
// These IDs are CORRELATION TOKENS ONLY. They NEVER enter wire / proto /
// webview state. They are assigned by the ring module itself; production
// callers consult the helpers `getDiagnosticManagerId(manager)` and
// `getDiagnosticHostId(host)` and attach the returned strings to records at
// the seam. No other code reads or writes the identity maps.
// -----------------------------------------------------------------------------

const managerIds = new WeakMap<object, number>()
const hostIds = new WeakMap<object, number>()
let nextManagerId = 1
let nextHostId = 1

/**
 * Module-level capture seam. The dogfood diagnostic profile resolver
 * sets this once at extension activation; production capture consults
 * ONLY this seam - the env var is read in exactly ONE place (the
 * resolver).
 */
let captureEnabled = false

export function isBackgroundJobLivenessAuthorityCaptureEnabled(): boolean {
	return captureEnabled
}

export function setBackgroundJobLivenessAuthorityCaptureEnabled(enabled: boolean): void {
	captureEnabled = Boolean(enabled)
}

/**
 * Return a stable diagnostic identity string for a manager object.
 *
 * Diagnostic-only correlation token. NEVER projected to wire / proto
 * / webview state. Allocation is gated by the capture seam: when the
 * seam is OFF, no map mutation, no allocation.
 */
export function getDiagnosticManagerId(manager: object | undefined | null): string | null {
	if (!captureEnabled) return null
	if (!manager) return null
	let id = managerIds.get(manager)
	if (id === undefined) {
		id = nextManagerId++
		managerIds.set(manager, id)
	}
	return `M${id}`
}

/**
 * Return a stable diagnostic identity string for a host object.
 *
 * Diagnostic-only correlation token. Allocation gated by the capture
 * seam (see getDiagnosticManagerId).
 */
export function getDiagnosticHostId(host: object | undefined | null): string | null {
	if (!captureEnabled) return null
	if (!host) return null
	let id = hostIds.get(host)
	if (id === undefined) {
		id = nextHostId++
		hostIds.set(host, id)
	}
	return `H${id}`
}

// -----------------------------------------------------------------------------
// Record types
// -----------------------------------------------------------------------------

/**
 * Discriminated union of every record the diagnostic captures.
 *
 * Each record carries an `event` discriminator and a `capturedAt`
 * timestamp. The optional fields are populated per the table in
 * 06-diagnostic-design.md §4 / §5.
 */
export type BackgroundJobLivenessAuthorityRecord =
	| BackgroundJobLivenessAuthorityManagerConstructedRecord
	| BackgroundJobLivenessAuthorityManagerDisposeBeginRecord
	| BackgroundJobLivenessAuthorityManagerDisposeEndRecord
	| BackgroundJobLivenessAuthorityJobActiveInsertedRecord
	| BackgroundJobLivenessAuthorityJobActiveRemovedRecord
	| BackgroundJobLivenessAuthorityProcessTerminalityRecord
	| BackgroundJobLivenessAuthorityJobStatusLookupRecord
	| BackgroundJobLivenessAuthorityJobCancelLookupRecord
	| BackgroundJobLivenessAuthorityBackgroundStateChangePublishedRecord
	| BackgroundJobLivenessAuthorityJobLifecycleEventPublishedRecord

export interface BackgroundJobLivenessAuthorityManagerConstructedRecord {
	readonly event: "manager_constructed"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly source: string | null
}

export interface BackgroundJobLivenessAuthorityManagerDisposeBeginRecord {
	readonly event: "manager_dispose_begin"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly activeJobIdsBeforeDispose: readonly string[]
	readonly reason: string | null
}

export interface BackgroundJobLivenessAuthorityManagerDisposeEndRecord {
	readonly event: "manager_dispose_end"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly activeJobIdsAfterDispose: readonly string[]
}

export interface BackgroundJobLivenessAuthorityJobActiveInsertedRecord {
	readonly event: "job_active_inserted"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly taskId: string | null
	readonly jobId: string
	readonly ownerSessionId: string | null
	readonly state: CommandJobState
	readonly pid: number | null
	readonly pgid: number | null
}

export interface BackgroundJobLivenessAuthorityJobActiveRemovedRecord {
	readonly event: "job_active_removed"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly jobId: string
	readonly previousState: CommandJobState
	readonly terminalState: CommandJobState
	readonly reason: string | null
	readonly pid: number | null
	readonly pgid: number | null
}

/**
 * LA1 discriminator: the bounded terminality invariant for a single
 * job. Captured ONLY when the underlying lifecycle event carries one
 * of the kernel-terminality or terminality-adjacent event names listed
 * below. The `postcondition` field is the actual production verdict
 * from `command_job_primary_group_cleanup` (one of
 * "gone" | "alive" | "eperm" | "unknown"). It is `null` for events
 * that do not carry a postcondition.
 *
 * Mechanical classification (see
 * .factory/evidence/.../15-causal-classification.txt):
 *   - LA1 POSITIVE iff `eventName === "command_job_terminal_committed"`
 *     AND `postcondition === "gone"` is observed OR
 *     `eventName === "command_job_residual_detected" |
 *      "command_job_containment_failed"` is observed for the job.
 *   - LA1 NEGATIVE iff `eventName === "command_job_terminal_committed"`
 *     is NOT observed for the jobId during the dump window.
 *
 * The full terminality-adjacent eventName vocabulary is defined by
 * `CommandJobLifecycleEvent["event"]` in command-job-manager.ts.
 */
export interface BackgroundJobLivenessAuthorityProcessTerminalityRecord {
	readonly event: "process_terminality_record"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly jobId: string
	/**
	 * One of the lifecycle events that carry process-terminality
	 * semantics:
	 *   - command_job_termination_started
	 *   - command_job_primary_group_cleanup
	 *   - command_job_terminal_committed
	 *   - command_job_residual_detected
	 *   - command_job_containment_failed
	 */
	readonly eventName:
		| "command_job_termination_started"
		| "command_job_primary_group_cleanup"
		| "command_job_terminal_committed"
		| "command_job_residual_detected"
		| "command_job_containment_failed"
	readonly postcondition: "gone" | "alive" | "eperm" | "unknown" | null
	readonly jobState: CommandJobState
	readonly pgid: number | null
}

export interface BackgroundJobLivenessAuthorityJobStatusLookupRecord {
	readonly event: "job_status_lookup"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly jobId: string
	/**
	 * Where the manager found (or did not find) the job:
	 *   active  — `this.active.get(jobId)` returned a CommandJob
	 *   terminal — `this.terminal.get(jobId)` returned a CommandJob
	 *   miss    — neither map contained jobId
	 */
	readonly source: "active" | "terminal" | "miss"
	readonly returnedState: CommandJobState | null
}

export interface BackgroundJobLivenessAuthorityJobCancelLookupRecord {
	readonly event: "job_cancel_lookup"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly jobId: string
	readonly found: boolean
	readonly state: CommandJobState | null
}

export interface BackgroundJobLivenessAuthorityBackgroundStateChangePublishedRecord {
	readonly event: "background_state_change_published"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly running: boolean
	readonly jobId: string | null
}

export interface BackgroundJobLivenessAuthorityJobLifecycleEventPublishedRecord {
	readonly event: "job_lifecycle_event_published"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly eventName: CommandJobLifecycleEvent["event"]
	readonly jobId: string
}

// -----------------------------------------------------------------------------
// Bounded ring
// -----------------------------------------------------------------------------

const buffer: BackgroundJobLivenessAuthorityRecord[] = []
let bufferSize = DEFAULT_BUFFER_SIZE

/**
 * Append one record to the ring. Bounded FIFO eviction. No-op when
 * the capture seam is OFF (default).
 */
export function captureBackgroundJobLivenessAuthorityRecord(record: BackgroundJobLivenessAuthorityRecord): void {
	if (!captureEnabled) return
	buffer.push(record)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
}

/**
 * Bounded ring reader. Returns a frozen view; consumers must not
 * mutate.
 */
export function getBackgroundJobLivenessAuthorityCaptureRecords(): readonly BackgroundJobLivenessAuthorityRecord[] {
	return buffer
}

/**
 * Test-only: clear the ring. Production code never calls this; the
 * dump command does NOT clear the ring (matches the BOCOR dump !=
 * clear contract so an accidental first dump does not destroy
 * evidence).
 */
export function clearBackgroundJobLivenessAuthorityCaptureRecords(): void {
	buffer.length = 0
}

/**
 * Test-only: override the ring buffer size. Mirrors the BOCOR
 * buffer-size setter.
 */
export function setBackgroundJobLivenessAuthorityCaptureBufferSize(size: number): void {
	const clamped = Math.max(0, Math.floor(size))
	bufferSize = clamped
	if (buffer.length > bufferSize) {
		buffer.length = bufferSize
	}
}
