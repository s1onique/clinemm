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
	const next = Boolean(enabled)
	// ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01):
	// the capture GENERATION advances every time the seam is ARMED, so
	// a dump can distinguish "capture was never armed in this process"
	// from "capture was armed and observed nothing". The generation is
	// diagnostic-only; it never feeds back into the runtime.
	if (next && !captureEnabled) {
		captureGeneration += 1
	}
	captureEnabled = next
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
// ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01)
// Protected provenance store.
//
// WHY THIS EXISTS
// ---------------
// The ordinary BJLA ring is a 256-record FIFO. A containment failure is
// classified ONCE, at the moment the manager evaluates the terminal
// postcondition. Every later unrelated lifecycle event pushes the ring
// forward. After 256 more events the ORIGINAL failure observation — the
// kernel verdict, the OS errno, the launch-time owner — has been
// EVICTED and is gone.
//
// When a later C10 completion barrier then holds on that job, the
// blocking set still names the job id, but the REASON the job is in the
// containment ledger is no longer recoverable from the dump.
//
// This store keeps the load-bearing evidence OUTSIDE the ordinary FIFO:
//
//   - the ORIGINAL `containment_failure_classified` observation, keyed
//     by exact jobId;
//   - the ASSOCIATED `containment_terminal_state_published` record,
//     but ONLY when the published state is `containment_failed`;
//   - the most recent NONEMPTY `containment_ledger_blocking_set`
//     snapshots, so the same dump can answer "was this job a blocker,
//     and for which session?".
//
// TRUST BOUNDING
// --------------
//   - Diagnostic ONLY. A protected record NEVER becomes production
//     authority: nothing reads it back into the runtime. It is a
//     write-only capture that is serialized by the dump.
//   - Default off. The store is fed exclusively by
//     `captureBackgroundJobLivenessAuthorityRecord`, which is a
//     complete no-op when `captureEnabled` is false. When disabled
//     there is NO protected-record insertion, NO map mutation, NO
//     identity allocation attributable to this feature, and NO
//     process or runtime-state change.
//   - Immutable observations. The ORIGINAL failure observation is
//     never overwritten by a later publication or an unrelated
//     lifecycle event. Null and unavailable fields are preserved
//     exactly as captured; nothing is reconstructed from later
//     runtime state.
//   - Bounded. Every collection has an explicit cap and an explicit
//     loss counter. A truncated capture is REPORTED, never presented
//     as complete.
//   - Read-only w.r.t. production. No process signal, no job state
//     mutation, no ownership change.
//
// REMOVAL_TRIGGER (per ACT sec 12): the first of
//   (1) the containment failure's root cause is isolated,
//   (2) the LIVE capture remains insufficient and this recorder cannot
//       safely close the gap,
//   (3) successor evidence supersedes the protected recorder.
// -----------------------------------------------------------------------------

/**
 * Schema version of the companion provenance artifact.
 *
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01
 * bumped this from 1 to 2 because the MEANING of the existing
 * `omittedBlockingJobIds` field changed:
 *
 *   - v1: `omittedBlockingJobIds` carried the EXACT, COMPLETE list of
 *     omitted identities (unbounded — a 10,000-id blocking set retained
 *     all 9,936 omitted identities).
 *   - v2: `omittedBlockingJobIds` carries at most
 *     `bounds.maxOmittedBlockingJobIds` (default 8) SAMPLED omitted
 *     identities. The accompanying `omittedBlockingJobCount` is EXACT,
 *     and `omittedBlockingJobIdsComplete` states whether the sample
 *     represents the full omitted set.
 *
 * The ORIGINAL `background-job-liveness-authority.jsonl` format is
 * UNCHANGED by this version bump — it is the COMPANION artifact schema
 * that advanced.
 */
export const BACKGROUND_JOB_LIVENESS_AUTHORITY_PROVENANCE_SCHEMA_VERSION = 2

/**
 * The availability classification of one required piece of evidence.
 *
 *   - `JOIN_COMPLETE`        — the record IS retained and the join
 *                               succeeded.
 *   - `JOIN_INCOMPLETE`      — the recorder can PROVE the record is
 *                               present but the join could not be
 *                               completed (e.g. a truncated blocking
 *                               set omitted the job id).
 *   - `UNAVAILABLE_FROM_TRACE` — the record is NOT retained and the
 *                               recorder cannot prove WHY (it was never
 *                               captured, or it was evicted and the
 *                               specific eviction is not attributable).
 */
export type BackgroundJobLivenessAuthorityProvenanceAvailability = "JOIN_COMPLETE" | "JOIN_INCOMPLETE" | "UNAVAILABLE_FROM_TRACE"

/**
 * The protected per-job provenance entry.
 *
 * `failureRecord` is the ORIGINAL immutable observation. It is null
 * only when the job never produced a containment-failure record (for
 * example a job that was published `containment_failed` without a
 * matching classification in this capture).
 */
export interface BackgroundJobLivenessAuthorityProvenanceJob {
	/** The exact job id — the join key for every other record. */
	readonly jobId: string
	/**
	 * The ORIGINAL `containment_failure_classified` observation,
	 * preserved exactly as captured. Null when unavailable.
	 */
	readonly failureRecord: BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord | null
	/**
	 * The ASSOCIATED `containment_terminal_state_published` record —
	 * retained ONLY when the published state was `containment_failed`.
	 * Null when unavailable.
	 */
	readonly terminalPublicationRecord: BackgroundJobLivenessAuthorityContainmentTerminalStatePublishedRecord | null
	/** When this protected entry was first created. */
	readonly capturedAt: number
}

// -----------------------------------------------------------------------------
// Bounded ring
// -----------------------------------------------------------------------------

const buffer: BackgroundJobLivenessAuthorityRecord[] = []
let bufferSize = DEFAULT_BUFFER_SIZE

/**
 * Append one record to the ring. Bounded FIFO eviction. No-op when
 * the capture seam is OFF (default).
 *
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01):
 * the protected provenance store is fed from this same seam, so it is
 * armed and disarmed together with the ring. The ordinary 256-record
 * FIFO is UNCHANGED — the protected store is a SEPARATE, independently
 * bounded collection.
 */
export function captureBackgroundJobLivenessAuthorityRecord(record: BackgroundJobLivenessAuthorityRecord): void {
	if (!captureEnabled) return
	buffer.push(record)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
	captureProvenanceRecord(record)
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

/**
 * A retained C10 blocking-set snapshot.
 *
 * The snapshot preserves the source identity of the original record.
 * It does NOT invent a task id or an epoch the original BJLA record
 * does not carry; the relationship to a task/epoch is UNOBSERVED.
 */
export interface BackgroundJobLivenessAuthorityProvenanceBlockingSet {
	/** The session whose jobs were in scope for the consultation. */
	readonly activeSessionId: string | null
	/** The boundary at which the set was computed. */
	readonly boundary: BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord["boundary"]
	/** The retained blocking job ids. */
	readonly blockingJobIds: readonly string[]
	/** The ownership class of each RETAINED job id, positionally aligned. */
	readonly blockingOwnershipClasses: readonly ContainmentOwnershipClass[]
	/** The denominator: total `containment_failed` entries observed. */
	readonly totalContainmentFailureEntries: number
	/** The number of entries excluded because their owner was foreign. */
	readonly foreignOwnerEntriesExcluded: number
	/** When this snapshot was captured. */
	readonly capturedAt: number
	/** True iff the original blocking set did not fit whole. */
	readonly truncated: boolean
	/** The number of blocking job ids in the ORIGINAL record. */
	readonly originalBlockingJobCount: number
	/** The number of blocking job ids actually RETAINED. */
	readonly retainedBlockingJobCount: number
	/**
	 * The EXACT number of job ids that were omitted by the size bound
	 * (`originalBlockingJobCount - retainedBlockingJobCount`). This count
	 * is ALWAYS exact, even when the omitted IDENTITIES are only sampled.
	 */
	readonly omittedBlockingJobCount: number
	/**
	 * A BOUNDED SAMPLE of the job ids that were omitted by the size
	 * bound.
	 *
	 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
	 * this array carries AT MOST `bounds.maxOmittedBlockingJobIds`
	 * (default 8) identities. It is NOT the complete omitted set unless
	 * `omittedBlockingJobIdsComplete` is true.
	 *
	 * The identities are REAL — they are taken verbatim from the omitted
	 * range of the original record. An identity is NEVER synthesized to
	 * fill a missing set.
	 */
	readonly omittedBlockingJobIds: readonly string[]
	/**
	 * Whether `omittedBlockingJobIds` represents the COMPLETE omitted
	 * set. True when every omitted identity is represented (including the
	 * non-truncated case, where there are zero omitted identities); false
	 * when the omitted identities are only SAMPLED.
	 */
	readonly omittedBlockingJobIdsComplete: boolean
	/**
	 * The lifecycle correlation to a task/epoch is NOT observable from
	 * the original BJLA record. The relationship is classified as
	 * unobserved rather than invented.
	 */
	readonly taskEpochCorrelation: "UNOBSERVED"
}

/**
 * The coverage classification for ONE retained blocking job.
 */
export interface BackgroundJobLivenessAuthorityProvenanceCoverage {
	/** The blocking job id. */
	readonly jobId: string
	/** The blocking-set snapshot this coverage entry was derived from. */
	readonly activeSessionId: string | null
	/** The boundary the blocking set was computed at. */
	readonly boundary: BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord["boundary"]
	/** The EXACT blocking-set membership this coverage entry describes. */
	readonly blockingJobIds: readonly string[]
	/** The ownership class of THIS blocking job, as classified by production. */
	readonly ownershipClass: ContainmentOwnershipClass
	/** Availability of the ORIGINAL failure record. */
	readonly failureRecordAvailability: BackgroundJobLivenessAuthorityProvenanceAvailability
	/** Availability of the controller terminal publication. */
	readonly terminalPublicationAvailability: BackgroundJobLivenessAuthorityProvenanceAvailability
	/**
	 * Availability of the blocking-set membership itself. When the
	 * blocking set was truncated, a job that was OMITTED is
	 * `JOIN_INCOMPLETE`, not `JOIN_COMPLETE`.
	 */
	readonly blockingSetMembershipAvailability: BackgroundJobLivenessAuthorityProvenanceAvailability
	/**
	 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01.
	 *
	 * WHERE this job's identity is retained:
	 *
	 *   - `RETAINED_PRINCIPAL` — the identity is in the snapshot's
	 *     retained principal blocking set.
	 *   - `OMITTED_SAMPLE`    — the identity was omitted by the size
	 *     bound but is still present in the BOUNDED omitted-id sample.
	 *   - `OMITTED_IDENTITY_DISCARDED` — the identity was omitted by
	 *     the size bound and is NO LONGER retained in any form. Only the
	 *     exact omitted COUNT survives for it.
	 */
	readonly blockingSetMembershipSource: "RETAINED_PRINCIPAL" | "OMITTED_SAMPLE" | "OMITTED_IDENTITY_DISCARDED"
	/** The originally observed postcondition, verbatim. Null when unavailable. */
	readonly postcondition: BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord["postcondition"] | null
	/** The originally observed OS errno, verbatim. Null when unavailable. */
	readonly osErrorCode: ContainmentOsErrorCode
	/** The structured failure reason, verbatim. Null when unavailable. */
	readonly containmentFailed: BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord["containmentFailed"] | null
	/** The launch-time owner session, verbatim. Null when unavailable. */
	readonly ownerSessionId: string | null
}

/**
 * The EXPLICIT retention-loss accounting. A truncated capture is
 * reported, never silently presented as complete.
 */
export interface BackgroundJobLivenessAuthorityProvenanceLoss {
	/** Protected JOB entries evicted by the protected-job capacity bound. */
	readonly protectedJobEvictions: number
	/** Individual protected RECORDS (failure / publication) evicted. */
	readonly protectedRecordEvictions: number
	/**
	 * Blocking-set snapshots evicted by the session capacity bound.
	 *
	 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
	 * this counter is reserved for evidence lost because of a DISTINCT
	 * session exceeding the capacity. Replacing an older observation for
	 * the SAME session is SUPERSESSION (counted separately below), NOT a
	 * distinct-session eviction.
	 */
	readonly blockingSetEvictions: number
	/**
	 * Blocking-set observations SUPERSEDED by a newer nonempty observation
	 * for the SAME session. A supersession is NOT a loss of a distinct
	 * session — the session itself remains retained with its latest
	 * evidence.
	 */
	readonly blockingSetSupersessions: number
	/** Blocking-set snapshots truncated by the per-set size bound. */
	readonly blockingSetTruncations: number
}

/**
 * The companion provenance artifact. This is the EXACT shape the dump
 * writes to `background-job-liveness-authority.provenance.json`.
 */
export interface BackgroundJobLivenessAuthorityProvenanceSnapshot {
	readonly schemaVersion: number
	/** Whether the capture seam was armed when the snapshot was taken. */
	readonly captureEnabled: boolean
	/**
	 * The capture GENERATION — a monotonically increasing counter that
	 * changes whenever the capture seam is (re-)armed. It lets an
	 * operator distinguish a capture-disabled or post-restart gap from
	 * a capture that simply observed nothing.
	 */
	readonly captureGeneration: number
	/** The protected per-job provenance entries, oldest first. */
	readonly protectedJobs: readonly BackgroundJobLivenessAuthorityProvenanceJob[]
	/** The retained blocking-set snapshots, oldest first. */
	readonly blockingSets: readonly BackgroundJobLivenessAuthorityProvenanceBlockingSet[]
	/** The per-blocking-job coverage classification. */
	readonly coverage: readonly BackgroundJobLivenessAuthorityProvenanceCoverage[]
	/** The explicit retention-loss accounting. */
	readonly loss: BackgroundJobLivenessAuthorityProvenanceLoss
	/** The bounds that were in force when the snapshot was taken. */
	readonly bounds: {
		readonly maxProtectedJobs: number
		readonly maxProtectedBlockingSessions: number
		readonly maxBlockingSetJobIds: number
		/**
		 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
		 * the bound on the OMITTED-identity SAMPLE carried by each
		 * retained blocking-set snapshot.
		 */
		readonly maxOmittedBlockingJobIds: number
	}
}

// -----------------------------------------------------------------------------
// Bounds
// -----------------------------------------------------------------------------

/**
 * How many protected JOB entries are retained. Generous for the last
 * four anomalous task captures' worth of containment failures, small
 * enough that the extension host cannot be exhausted.
 */
const DEFAULT_MAX_PROTECTED_JOBS = 128

/**
 * How many recent NONEMPTY blocking-set snapshots are retained.
 *
 * Matches the flight recorder's existing retention policy: the last
 * FOUR anomalous task captures are retained even after newer tasks
 * become active, so the incident under investigation is still present
 * at dump time.
 */
const DEFAULT_MAX_PROTECTED_BLOCKING_SESSIONS = 4

/**
 * How many blocking job ids a SINGLE retained blocking-set snapshot may
 * carry as its PRINCIPAL retained set. An unusually large set is
 * reported as TRUNCATED — never presented as complete.
 */
const DEFAULT_MAX_BLOCKING_SET_JOB_IDS = 64

/**
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01.
 *
 * How many OMITTED blocking job ids a single retained blocking-set
 * snapshot may carry as a SAMPLE.
 *
 * The predecessor retained EVERY omitted identity, which made the
 * protected store's identity payload UNBOUNDED: a 10,000-id blocking set
 * retained 64 principal identities plus 9,936 omitted identities. The
 * exact omitted COUNT is still reported; only the omitted IDENTITIES are
 * sampled, and `omittedBlockingJobIdsComplete` states honestly whether
 * the sample is the whole omitted set.
 */
const DEFAULT_MAX_OMITTED_BLOCKING_JOB_IDS = 8

/**
 * The protected provenance bounds. Every field is OPTIONAL so a test
 * can override only the bound it exercises; an omitted field keeps its
 * current value.
 */
export interface BackgroundJobLivenessAuthorityProvenanceBounds {
	readonly maxProtectedJobs?: number
	readonly maxProtectedBlockingSessions?: number
	readonly maxBlockingSetJobIds?: number
	readonly maxOmittedBlockingJobIds?: number
}

/**
 * The RESOLVED bounds — every field is always present. This is the
 * shape the store enforces against.
 */
interface ResolvedProvenanceBounds {
	maxProtectedJobs: number
	maxProtectedBlockingSessions: number
	maxBlockingSetJobIds: number
	maxOmittedBlockingJobIds: number
}

let provenanceBounds: ResolvedProvenanceBounds = {
	maxProtectedJobs: DEFAULT_MAX_PROTECTED_JOBS,
	maxProtectedBlockingSessions: DEFAULT_MAX_PROTECTED_BLOCKING_SESSIONS,
	maxBlockingSetJobIds: DEFAULT_MAX_BLOCKING_SET_JOB_IDS,
	maxOmittedBlockingJobIds: DEFAULT_MAX_OMITTED_BLOCKING_JOB_IDS,
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

interface ProtectedJobEntry {
	failureRecord: BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord | null
	terminalPublicationRecord: BackgroundJobLivenessAuthorityContainmentTerminalStatePublishedRecord | null
	capturedAt: number
}

/**
 * The protected job map, keyed by EXACT jobId.
 *
 * The Map preserves insertion order, which gives the deterministic
 * oldest-first eviction policy for free. There is NO tombstone map and
 * NO secondary index: an evicted job is removed entirely.
 */
const protectedJobs = new Map<string, ProtectedJobEntry>()

/**
 * The retained blocking-set snapshots, LEAST-recently-observed session
 * first. Bounded by `maxProtectedBlockingSessions` DISTINCT sessions.
 *
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
 * the collection is UNCHANGED in kind — one bounded array, no new map,
 * index or generic retention manager. What changed is the RETENTION
 * POLICY applied to it: ONE latest nonempty snapshot per DISTINCT
 * `activeSessionId`, ordered by most-recent observation.
 */
const protectedBlockingSets: BackgroundJobLivenessAuthorityProvenanceBlockingSet[] = []

const provenanceLoss = {
	protectedJobEvictions: 0,
	protectedRecordEvictions: 0,
	blockingSetEvictions: 0,
	blockingSetSupersessions: 0,
	blockingSetTruncations: 0,
}

/**
 * The session-identity key used for the DISTINCT-session retention
 * policy.
 *
 * The EXACT `activeSessionId` from the production record is used. A
 * null (unknown) session identity is preserved EXPLICITLY under a
 * dedicated key — it is never fabricated into another session's bucket
 * and never conflated with a real session identity.
 */
function blockingSetSessionKey(activeSessionId: string | null): string {
	return activeSessionId === null ? " __UNKNOWN_SESSION__" : `s:${activeSessionId}`
}

/**
 * The capture generation. Bumped every time the capture seam is
 * ARMED, so a dump can distinguish "capture was never armed" from
 * "capture was armed and observed nothing".
 */
let captureGeneration = 0

/**
 * Ensure a protected job entry exists for `jobId` without evicting
 * anything. Returns the entry.
 */
function ensureProtectedJobEntry(jobId: string, capturedAt: number): ProtectedJobEntry {
	const existing = protectedJobs.get(jobId)
	if (existing) return existing
	const entry: ProtectedJobEntry = { failureRecord: null, terminalPublicationRecord: null, capturedAt }
	protectedJobs.set(jobId, entry)
	return entry
}

/**
 * Apply the deterministic protected-job capacity bound.
 *
 * Policy: evict the OLDEST protected job entry (by insertion order)
 * until the store fits the bound. The NEWEST relevant evidence is
 * always preserved, and every eviction is counted explicitly.
 */
function enforceProtectedJobCapacity(): void {
	while (protectedJobs.size > provenanceBounds.maxProtectedJobs) {
		const oldestKey = protectedJobs.keys().next()
		if (oldestKey.done) break
		const evicted = protectedJobs.get(oldestKey.value)
		protectedJobs.delete(oldestKey.value)
		provenanceLoss.protectedJobEvictions += 1
		if (evicted?.failureRecord) {
			provenanceLoss.protectedRecordEvictions += 1
		}
		if (evicted?.terminalPublicationRecord) {
			provenanceLoss.protectedRecordEvictions += 1
		}
	}
}

/**
 * Retain a NONEMPTY blocking-set snapshot, bounded by size and by the
 * DISTINCT-session capacity.
 *
 * EMPTY blocking sets are NOT retained: they carry no membership and
 * therefore no provenance. This mirrors the flight recorder's
 * "anomalous only" policy.
 *
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
 *
 *   P0 — the OMITTED identities are a BOUNDED SAMPLE, not the whole
 *   omitted set. The exact omitted COUNT is preserved. The sample is
 *   flagged incomplete so a bounded sample is never described as the
 *   full omitted set.
 *
 *   P1 — retention is per DISTINCT session. A newer nonempty observation
 *   for an already-retained session REPLACES that session's previous
 *   snapshot (a SUPERSESSION) and moves the session to the
 *   most-recently-observed end. Only the arrival of an UNSEEN session
 *   beyond the capacity evicts the least-recently-observed distinct
 *   session.
 */
function retainBlockingSet(record: BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord): void {
	if (record.blockingJobIds.length === 0) return

	const originalCount = record.blockingJobIds.length
	const retainedCount = Math.min(originalCount, provenanceBounds.maxBlockingSetJobIds)
	const truncated = retainedCount < originalCount
	if (truncated) {
		provenanceLoss.blockingSetTruncations += 1
	}
	const retainedIds = record.blockingJobIds.slice(0, retainedCount)
	const retainedClasses = record.blockingOwnershipClasses.slice(0, retainedCount)
	// The EXACT omitted count, always.
	const omittedCount = originalCount - retainedCount
	// The BOUNDED omitted-identity sample. The identities are taken
	// verbatim from the omitted range — never synthesized.
	const omittedSample = truncated
		? record.blockingJobIds.slice(retainedCount, retainedCount + provenanceBounds.maxOmittedBlockingJobIds)
		: []

	const snapshot: BackgroundJobLivenessAuthorityProvenanceBlockingSet = {
		activeSessionId: record.activeSessionId,
		boundary: record.boundary,
		blockingJobIds: retainedIds,
		blockingOwnershipClasses: retainedClasses,
		totalContainmentFailureEntries: record.totalContainmentFailureEntries,
		foreignOwnerEntriesExcluded: record.foreignOwnerEntriesExcluded,
		capturedAt: record.capturedAt,
		truncated,
		originalBlockingJobCount: originalCount,
		retainedBlockingJobCount: retainedCount,
		omittedBlockingJobCount: omittedCount,
		omittedBlockingJobIds: omittedSample,
		omittedBlockingJobIdsComplete: omittedSample.length === omittedCount,
		taskEpochCorrelation: "UNOBSERVED",
	}

	// P1 — replace the SAME session's previous observation (supersession),
	// or append a previously unseen session.
	const sessionKey = blockingSetSessionKey(record.activeSessionId)
	const existingIndex = protectedBlockingSets.findIndex((s) => blockingSetSessionKey(s.activeSessionId) === sessionKey)
	if (existingIndex >= 0) {
		protectedBlockingSets.splice(existingIndex, 1)
		provenanceLoss.blockingSetSupersessions += 1
	}
	protectedBlockingSets.push(snapshot)

	// Only an insertion BEYOND the distinct-session capacity evicts the
	// least-recently-observed distinct session.
	while (protectedBlockingSets.length > provenanceBounds.maxProtectedBlockingSessions) {
		protectedBlockingSets.shift()
		provenanceLoss.blockingSetEvictions += 1
	}
}

/**
 * Feed the protected store from the capture seam.
 *
 * Called ONLY from `captureBackgroundJobLivenessAuthorityRecord`, i.e.
 * only when the capture seam is armed. The store never sees a record
 * while capture is OFF, so there is NO protected-record insertion, NO
 * map mutation and NO identity allocation attributable to this feature
 * in the default-off configuration.
 */
function captureProvenanceRecord(record: BackgroundJobLivenessAuthorityRecord): void {
	switch (record.event) {
		case "containment_failure_classified": {
			const entry = ensureProtectedJobEntry(record.jobId, record.capturedAt)
			// The ORIGINAL failure observation is never overwritten by a
			// later publication or an unrelated lifecycle event.
			if (!entry.failureRecord) {
				entry.failureRecord = record
			}
			enforceProtectedJobCapacity()
			return
		}
		case "containment_terminal_state_published": {
			// Only a `containment_failed` publication is associated with
			// a containment failure. A clean terminal publication is
			// NOT retained here — it is not containment provenance.
			if (record.publishedState !== "containment_failed") return
			const entry = ensureProtectedJobEntry(record.jobId, record.capturedAt)
			if (!entry.terminalPublicationRecord) {
				entry.terminalPublicationRecord = record
			}
			enforceProtectedJobCapacity()
			return
		}
		case "containment_ledger_blocking_set": {
			retainBlockingSet(record)
			return
		}
		default:
			return
	}
}

/**
 * Compute the per-blocking-job coverage classification.
 *
 * A coverage entry exists for EVERY blocking job named by a retained
 * blocking-set snapshot — including the jobs whose failure evidence is
 * missing. A missing record is reported as missing; it is NEVER
 * evidence of a successful cleanup.
 *
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01:
 * the coverage also carries the SAMPLED omitted identities, marked
 * `OMITTED_SAMPLE`, so an operator can tell a job whose identity is
 * still known from one whose identity was discarded entirely (the latter
 * is not enumerated at all — only the exact omitted COUNT survives).
 */
function computeCoverage(): BackgroundJobLivenessAuthorityProvenanceCoverage[] {
	const coverage: BackgroundJobLivenessAuthorityProvenanceCoverage[] = []
	for (const set of protectedBlockingSets) {
		for (let i = 0; i < set.blockingJobIds.length; i += 1) {
			const jobId = set.blockingJobIds[i]
			const ownershipClass = set.blockingOwnershipClasses[i] ?? "unknown_owner"
			const entry = protectedJobs.get(jobId)
			const failureRecord = entry?.failureRecord ?? null
			const publicationRecord = entry?.terminalPublicationRecord ?? null
			coverage.push({
				jobId,
				activeSessionId: set.activeSessionId,
				boundary: set.boundary,
				blockingJobIds: [...set.blockingJobIds],
				ownershipClass,
				failureRecordAvailability: failureRecord ? "JOIN_COMPLETE" : "UNAVAILABLE_FROM_TRACE",
				terminalPublicationAvailability: publicationRecord ? "JOIN_COMPLETE" : "UNAVAILABLE_FROM_TRACE",
				blockingSetMembershipAvailability: set.truncated ? "JOIN_INCOMPLETE" : "JOIN_COMPLETE",
				blockingSetMembershipSource: "RETAINED_PRINCIPAL",
				postcondition: failureRecord ? failureRecord.postcondition : null,
				osErrorCode: failureRecord ? failureRecord.osErrorCode : null,
				containmentFailed: failureRecord ? failureRecord.containmentFailed : null,
				ownerSessionId: failureRecord ? failureRecord.ownerSessionId : null,
			})
		}
		// The SAMPLED omitted identities are known, so they get a
		// coverage entry too — explicitly marked as OMITTED so a
		// partial retained set is never reported as complete.
		for (const jobId of set.omittedBlockingJobIds) {
			const entry = protectedJobs.get(jobId)
			const failureRecord = entry?.failureRecord ?? null
			const publicationRecord = entry?.terminalPublicationRecord ?? null
			coverage.push({
				jobId,
				activeSessionId: set.activeSessionId,
				boundary: set.boundary,
				blockingJobIds: [...set.blockingJobIds],
				ownershipClass: "unknown_owner",
				failureRecordAvailability: failureRecord ? "JOIN_COMPLETE" : "UNAVAILABLE_FROM_TRACE",
				terminalPublicationAvailability: publicationRecord ? "JOIN_COMPLETE" : "UNAVAILABLE_FROM_TRACE",
				blockingSetMembershipAvailability: "JOIN_INCOMPLETE",
				blockingSetMembershipSource: "OMITTED_SAMPLE",
				postcondition: failureRecord ? failureRecord.postcondition : null,
				osErrorCode: failureRecord ? failureRecord.osErrorCode : null,
				containmentFailed: failureRecord ? failureRecord.containmentFailed : null,
				ownerSessionId: failureRecord ? failureRecord.ownerSessionId : null,
			})
		}
	}
	return coverage
}

/**
 * Bounded, read-only view of the protected provenance store.
 *
 * The returned snapshot is a fresh object graph; mutating it cannot
 * affect the store. The dump serializes this and does NOT clear it
 * (dump != clear).
 */
export function getBackgroundJobLivenessAuthorityProvenanceSnapshot(): BackgroundJobLivenessAuthorityProvenanceSnapshot {
	const jobs: BackgroundJobLivenessAuthorityProvenanceJob[] = []
	for (const [jobId, entry] of protectedJobs) {
		jobs.push({
			jobId,
			failureRecord: entry.failureRecord,
			terminalPublicationRecord: entry.terminalPublicationRecord,
			capturedAt: entry.capturedAt,
		})
	}
	return {
		schemaVersion: BACKGROUND_JOB_LIVENESS_AUTHORITY_PROVENANCE_SCHEMA_VERSION,
		captureEnabled: captureEnabled,
		captureGeneration,
		protectedJobs: jobs,
		blockingSets: protectedBlockingSets.map((s) => ({ ...s })),
		coverage: computeCoverage(),
		loss: { ...provenanceLoss },
		bounds: { ...provenanceBounds },
	}
}

/**
 * Test-only: clear the protected provenance store. Production code
 * never calls this; the dump command does NOT clear the store (dump !=
 * clear contract).
 */
export function clearBackgroundJobLivenessAuthorityProvenanceStore(): void {
	protectedJobs.clear()
	protectedBlockingSets.length = 0
	provenanceLoss.protectedJobEvictions = 0
	provenanceLoss.protectedRecordEvictions = 0
	provenanceLoss.blockingSetEvictions = 0
	provenanceLoss.blockingSetSupersessions = 0
	provenanceLoss.blockingSetTruncations = 0
}

/**
 * Test-only: override the protected provenance bounds. Passing
 * `undefined` restores the production defaults. An omitted field keeps
 * its current value.
 */
export function setBackgroundJobLivenessAuthorityProvenanceBounds(
	bounds: BackgroundJobLivenessAuthorityProvenanceBounds | undefined,
): void {
	if (!bounds) {
		provenanceBounds = {
			maxProtectedJobs: DEFAULT_MAX_PROTECTED_JOBS,
			maxProtectedBlockingSessions: DEFAULT_MAX_PROTECTED_BLOCKING_SESSIONS,
			maxBlockingSetJobIds: DEFAULT_MAX_BLOCKING_SET_JOB_IDS,
			maxOmittedBlockingJobIds: DEFAULT_MAX_OMITTED_BLOCKING_JOB_IDS,
		}
	} else {
		provenanceBounds = {
			maxProtectedJobs: Math.max(0, Math.floor(bounds.maxProtectedJobs ?? provenanceBounds.maxProtectedJobs)),
			maxProtectedBlockingSessions: Math.max(
				0,
				Math.floor(bounds.maxProtectedBlockingSessions ?? provenanceBounds.maxProtectedBlockingSessions),
			),
			maxBlockingSetJobIds: Math.max(0, Math.floor(bounds.maxBlockingSetJobIds ?? provenanceBounds.maxBlockingSetJobIds)),
			maxOmittedBlockingJobIds: Math.max(
				0,
				Math.floor(bounds.maxOmittedBlockingJobIds ?? provenanceBounds.maxOmittedBlockingJobIds),
			),
		}
	}
	enforceProtectedJobCapacity()
	while (protectedBlockingSets.length > provenanceBounds.maxProtectedBlockingSessions) {
		protectedBlockingSets.shift()
		provenanceLoss.blockingSetEvictions += 1
	}
}
