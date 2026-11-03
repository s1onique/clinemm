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
	| BackgroundJobLivenessAuthorityJobCancellationRequestedRecord
	| BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord
	| BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord
	| BackgroundJobLivenessAuthorityContainmentTerminalStatePublishedRecord

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

/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01:
 *
 * Captured at the REQUEST BOUNDARY of every cancellation — BEFORE
 * `CommandJobManager.terminate()` mutates any state. The `requestOrigin`
 * is THREADED by the production caller as an internal-only second
 * argument (see `CancelCommandJobOptions.origin`,
 * `CommandJobManager.dispose(origin?)`). It is NEVER inferred from
 * `new Error().stack`.
 *
 * The `firstWriterWins` field is true iff this request initiated the
 * termination (i.e. it was the FIRST caller). A subsequent cancel
 * arriving after the deadline fired would observe `firstWriterWins=false`
 * because the FIRST-WRITER-WINS latch on `job.terminationPromise` would
 * already be set. That invariant is preserved so a single LIVE cycle
 * produces exactly ONE authoritative request-origin record, matching
 * the cardinality invariant in ACT sec 13.
 *
 * Allowed `requestOrigin` values (frozen by recon — see
 * 03-cancellation-authority-map.md):
 *
 *   "background_cancel_rpc"  — public cancelBackgroundCommand gRPC path
 *   "manager_dispose"        — CommandJobManager.dispose() iterate-active loop
 *   "extension_shutdown"     — host.dispose via lifecycle.dispose via controller.dispose
 *   "command_deadline"       — deadline timer fired inside manager.start
 *   "caller_abort_signal"    — caller's AbortSignal aborted inside manager.start
 *   "other:<bounded id>"     — bounded escape hatch (e.g. "other:test")
 *
 * INTERNAL ONLY — never enters proto / webview / public API.
 */
export interface BackgroundJobLivenessAuthorityJobCancellationRequestedRecord {
	readonly event: "job_cancellation_requested"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly jobId: string
	/**
	 * Explicit caller identity, threaded by the production caller as
	 * an internal-only option. Never inferred from a stack trace.
	 */
	readonly requestOrigin: string
	/**
	 * Session/task correlation when the caller passed it through.
	 * Null when the caller has no session/task binding (e.g.
	 * deadline timer).
	 */
	readonly sessionId: string | null
	readonly taskId: string | null
	readonly currentState: CommandJobState
	/**
	 * True iff THIS request initiated the termination. A subsequent
	 * cancel arriving after the deadline/previous-cancel fired would
	 * observe `firstWriterWins=false` (gated by `job.terminationPromise`).
	 * The cardinality invariant is that exactly ONE primary
	 * `job_cancellation_requested` per LIVE cycle has `firstWriterWins=true`.
	 */
	readonly firstWriterWins: boolean
}

// -----------------------------------------------------------------------------
// ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 (CLCR01)
//
// Containment-ledger causal evidence.
//
// The three records below close the specific gaps the containment
// ledger recon identified. They EXTEND the EXISTING BJLA capture —
// they are NOT a new telemetry system. Every field is an
// ALREADY-EVALUATED production value: no additional process signals,
// no state-changing probes, no new protocol fields.
//
// The gap they close:
//
//   BEFORE                                   AFTER
//   ---------------------------------------  --------------------------------
//   C10 hold captures a COUNT of blockers    the EXACT blocking jobId set
//   owner scope is implicit in the count     an EXPLICIT ownership class
//   postcondition is a bare category         the category AND the OS errno
//   pid present on one adjacent record       pid present ON the failure
//   terminal publication unexplained         the publication is captured
// -----------------------------------------------------------------------------

/**
 * The OS errno that produced a containment postcondition verdict.
 *
 * Mirrors the macOS `kill(2)` contract:
 *   - `ESRCH` — the process/group was NOT FOUND.
 *   - `EPERM` — the probe was DENIED (Seatbelt / privilege).
 *   - `null`  — the probe SUCCEEDED (rc=0): the group EXISTS and the
 *                probe was permitted (the group survived cleanup).
 *   - `undefined` — no errno was available (no probe ran, or the
 *                   probe seam did not supply one).
 */
export type ContainmentOsErrorCode = string | null | undefined

/**
 * The ownership classification of a containment-failure entry
 * relative to the session that consulted it.
 *
 * These are the FOUR cases the owner-scoped classifier distinguishes:
 *
 *   - `matching_owner`  — the entry's recorded owner session id EQUALS
 *                          the consulting session id. BLOCKS.
 *   - `foreign_owner`   — the entry's recorded owner session id is a
 *                          DIFFERENT session. Does NOT block.
 *   - `unknown_owner`   — the entry exists but no owner was ever
 *                          recorded. BLOCKS (fail closed).
 *   - `owner_map_absent` — the owner map is not wired at all, so the
 *                          entry cannot be proven foreign. BLOCKS
 *                          (fail closed).
 */
export type ContainmentOwnershipClass = "matching_owner" | "foreign_owner" | "unknown_owner" | "owner_map_absent"

/**
 * ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 (CLCR01).
 *
 * Captured at the CONTAINMENT BOUNDARY — the exact moment the
 * manager classifies a job's terminalization as `containment_failed`.
 *
 * This is the per-job ROOT CAUSE record. It carries everything needed
 * to join the C10 blocker back to the original cleanup outcome:
 * the job id, the owner session, the process identity (pid/pgid), the
 * manager identity, the kernel verdict, the OS errno behind that
 * verdict, and the structured failure reason.
 *
 * It deliberately does NOT carry any prompt content, command text, or
 * model output.
 */
export interface BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord {
	readonly event: "containment_failure_classified"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	readonly jobId: string
	/**
	 * The LAUNCH-TIME owner session id (`CommandJob.ownerSessionId`).
	 * `null` when the job carried no owner — the classifier treats
	 * that as an UNKNOWN owner and fails closed.
	 */
	readonly ownerSessionId: string | null
	/** The root PID of the supervised process. `null` when unresolvable. */
	readonly pid: number | null
	/** The primary owned process group id. `null` when unresolvable. */
	readonly pgid: number | null
	/**
	 * The kernel verdict on the primary owned process group:
	 * `gone` | `alive` | `eperm` | `unknown`. `null` when no probe
	 * ran (no PGID resolvable).
	 */
	readonly postcondition: "gone" | "alive" | "eperm" | "unknown" | null
	/**
	 * The OS errno behind the verdict. `ESRCH` (not found), `EPERM`
	 * (probe denied), `null` (probe permitted — the group exists),
	 * `undefined` (no errno available).
	 */
	readonly osErrorCode: ContainmentOsErrorCode
	/**
	 * The structured failure reason latched on the job:
	 * `pgid_unset` | `substrate_alive` | `substrate_eperm` |
	 * `substrate_unknown`.
	 */
	readonly containmentFailed: "pgid_unset" | "substrate_alive" | "substrate_eperm" | "substrate_unknown"
	/** The terminal state the job was overwritten with. */
	readonly jobState: "containment_failed"
}

/**
 * ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 (CLCR01).
 *
 * Captured at the C10 COMPLETION HOLD boundary — the point where the
 * completion barrier is held by unresolved containment failures.
 *
 * This is the JOIN record. It names the EXACT blocking job id set
 * (previously only a COUNT was captured) and the OWNERSHIP
 * CLASSIFICATION of each blocker, so an operator can tell:
 *
 *   - which of the ledger entries actually held the completion, and
 *   - for each, whether it blocked because it MATCHED the active
 *     session, because its owner was UNKNOWN, or because the owner
 *     map was not wired at all.
 *
 * The per-blocker ownership classes are recorded as parallel arrays
 * positionally aligned with `blockingJobIds` (index i of
 * `blockingOwnershipClasses` describes index i of `blockingJobIds`).
 */
export interface BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord {
	readonly event: "containment_ledger_blocking_set"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	/**
	 * The session whose jobs were in scope for the consultation.
	 */
	readonly activeSessionId: string | null
	/**
	 * The EXACT set of job ids whose containment failure was
	 * unresolved AND blocking at this boundary. Empty when the
	 * completion was not held by containment.
	 */
	readonly blockingJobIds: readonly string[]
	/**
	 * The ownership classification of each blocker, positionally
	 * aligned with `blockingJobIds`.
	 */
	readonly blockingOwnershipClasses: readonly ContainmentOwnershipClass[]
	/**
	 * The total number of `containment_failed` entries observed in the
	 * authority input, regardless of ownership. This is the DENOMINATOR
	 * the blocking set is a subset of — it distinguishes "43 entries
	 * exist, 7 of which are owned by this session" from "43 entries
	 * exist and all 43 block".
	 */
	readonly totalContainmentFailureEntries: number
	/**
	 * The number of entries excluded because their owner was a
	 * DIFFERENT session (proved foreign).
	 */
	readonly foreignOwnerEntriesExcluded: number
	/**
	 * The boundary at which the set was computed. One of:
	 *   - `c10_completion_attempt`   — the immediate C10 barrier
	 *   - `deferred_c10_reevaluation` — the deferred C10 re-evaluation
	 *   - `q5_deferred_handoff`      — the Q5 deferred-handoff path
	 *   - `commit_boundary`           — the final admission revalidation
	 */
	readonly boundary: "c10_completion_attempt" | "deferred_c10_reevaluation" | "q5_deferred_handoff" | "commit_boundary"
}

/**
 * ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 (CLCR01).
 *
 * Captured at the CONTROLLER'S TERMINAL-STATE PUBLICATION seam — the
 * point where `SdkController.updateBackgroundCommandState` writes the
 * per-job terminal reason into `backgroundCommandJobStates` (the map
 * the C10 classifier reads).
 *
 * This is the LINK record: it establishes WHY the controller retained
 * `containment_failed`, and which owner session the entry is filed
 * under. Without it the ledger shows a blocker with no provenance.
 */
export interface BackgroundJobLivenessAuthorityContainmentTerminalStatePublishedRecord {
	readonly event: "containment_terminal_state_published"
	readonly capturedAt: number
	readonly managerInstance: string | null
	readonly hostInstance: string | null
	/** The job id (the key in the controller's terminal-state map). */
	readonly jobId: string
	/**
	 * The published terminal reason. `containment_failed` is the
	 * load-bearing value; the other terminal reasons are recorded too
	 * so the ledger can prove a CLEAN terminal was NOT what blocked.
	 */
	readonly publishedState:
		| "running"
		| "exited"
		| "cancelled"
		| "deadline_exceeded"
		| "spawn_failed"
		| "containment_failed"
		| "terminal"
	/**
	 * The owner session id the entry was filed under. `null` when the
	 * owner was never recorded (UNKNOWN owner → the classifier fails
	 * closed).
	 */
	readonly ownerSessionId: string | null
	/**
	 * Whether the published state is a containment failure — the
	 * boolean form of the predicate the C10 classifier applies.
	 */
	readonly isContainmentFailure: boolean
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
