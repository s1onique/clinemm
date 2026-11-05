/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The DIAGNOSTIC-ONLY observation surface for the TCRR01 bounded
 * late-reconciliation lifecycle.
 *
 * WHY THIS EXISTS
 * ---------------
 *
 * TCRR01 registers a bounded pending reconciliation, re-probes the
 * ORIGINAL owned PGID on a fixed schedule, and — on a fresh `gone` —
 * publishes `command_job_containment_reconciled`. Everything ELSE is
 * SILENT:
 *
 *   - the registration itself emits nothing,
 *   - each attempt emits nothing,
 *   - the exhaustion of the attempt budget / observation horizon
 *     DROPS the pending entry with no record at all.
 *
 * The 2026-11-05 LIVE incident could therefore not establish whether
 * the two blocking jobs' reconciliations had been REGISTERED, whether
 * they EXECUTED all scheduled attempts, whether they EXHAUSTED the
 * five-second observation window, whether they reached `gone`, whether
 * the reconciled controller state was PUBLISHED, or whether the
 * appropriate C10 RE-EVALUATION followed.
 *
 * THIS MODULE OBSERVES. IT DOES NOT REPAIR.
 *
 * HARD CONSTRAINTS (frozen by the ACT)
 * ------------------------------------
 *
 *   1. NO new `process.kill()`, signal-zero, shell `ps` or any other
 *      process-inspection call may originate here. The sink consumes
 *      ONLY the values TCRR01 already computed from its OWN scheduled
 *      probes.
 *   2. The reconciliation retry COUNT, TIMING and ELIGIBILITY are
 *      untouched. This module never schedules, cancels or reschedules
 *      a probe.
 *   3. Diagnostic recording must never modify `job.state`,
 *      `terminationFailed`, `pendingReconciliations`,
 *      `terminalTransition`, `backgroundCommandJobStates`, the C10
 *      marker or the Elm phase.
 *   4. A failure to record diagnostics must never interrupt process
 *      supervision: every capture entry point is wrapped so a sink
 *      throw is swallowed.
 *   5. The existing terminal lifecycle events are NOT reused for
 *      per-attempt telemetry — doing so would change consumer counts
 *      and terminal receipts. This is a SEPARATE, guarded sink.
 *
 * PRIVACY
 * -------
 *
 * The records carry identities, counters, verdicts, errno strings and
 * policy numbers. They NEVER carry command text, stdout/stderr, prompt
 * content or environment values.
 */

/**
 * The schema version of the reconciliation diagnostic records. Bumped
 * when the RECORD SHAPE changes (not when a stage is added).
 */
export const RECONCILIATION_DIAGNOSTIC_SCHEMA_VERSION = 1

/**
 * The diagnostic lifecycle stages of the bounded reconciliation.
 */
export type ReconciliationDiagnosticStage =
	| "reconciliation_registered"
	| "reconciliation_skipped"
	| "reconciliation_attempt"
	| "reconciliation_resolved"
	| "reconciliation_exhausted"
	| "reconciliation_cancelled"

/**
 * The DIAGNOSTIC CLASSIFICATION of a reconciliation's observed state.
 *
 * These are NOT canonical job states. They are support-facing
 * classifications derived from the observed diagnostic events.
 */
export type ReconciliationDiagnosticClassification =
	| "NOT_ELIGIBLE"
	| "DISABLED"
	| "REGISTERED"
	| "OBSERVING"
	| "RESOLVED_GONE"
	| "EXHAUSTED_NON_GONE"
	| "CAPACITY_EXCEEDED"
	| "DISPOSED"
	| "PUBLICATION_NOT_OBSERVED"
	| "REEVALUATION_NOT_OBSERVED"
	| "UNAVAILABLE_FROM_TRACE"

/**
 * The exact eligibility failures a registration can be skipped for.
 * These mirror the fail-closed rules in
 * `CommandJobManager.registerPendingContainmentReconciliation`.
 */
export type ReconciliationSkipReason =
	| "disabled"
	| "pgid_unset"
	| "job_id_missing"
	| "capacity_exceeded"
	| "not_a_restorable_terminal_class"

/**
 * One reconciliation diagnostic record.
 *
 * Every field is bounded and privacy-safe. `pgid` is the ORIGINAL
 * owned process-group identity — a numeric identity, never a command
 * or a path.
 */
export interface ReconciliationDiagnosticRecord {
	readonly schemaVersion: number
	/** Monotonic, process-wide, 1-based sequence. Orders the timeline. */
	readonly eventSeq: number
	/** ISO-8601 UTC timestamp. */
	readonly timestamp: string
	readonly stage: ReconciliationDiagnosticStage
	/** The job the reconciliation belongs to. */
	readonly jobId: string
	/** The launch-time owner session id, when known. */
	readonly ownerSessionId?: string
	/** The ORIGINAL owned PGID. `undefined` when it was never identified. */
	readonly originalPgid?: number
	/** The ORIGINAL containment-failure classification. */
	readonly originalFailure?: "substrate_alive" | "substrate_eperm" | "substrate_unknown" | "pgid_unset"
	/** The ORIGINAL intended terminal class the failure overwrote. */
	readonly restoredTerminalClass?: "exited" | "cancelled" | "deadline_exceeded"
	/** 1-based attempt index. */
	readonly attempt?: number
	/** Milliseconds since the reconciliation was registered. */
	readonly elapsedMs?: number
	/** The postcondition verdict the scheduled probe produced. */
	readonly postcondition?: "gone" | "alive" | "eperm" | "unknown"
	/** The OS errno that produced the verdict, when the probe threw. */
	readonly osErrorCode?: string | null
	/** Why the registration was skipped. */
	readonly skipReason?: ReconciliationSkipReason
	/** Why the reconciliation ended without a release. */
	readonly exhaustionReason?: "attempt_budget_exhausted" | "observation_horizon_exceeded"
	/** The bounded policy in force for this reconciliation. */
	readonly policy?: {
		readonly enabled: boolean
		readonly maxAttempts: number
		readonly horizonMs: number
		readonly intervalMs: number
	}
}

/**
 * The bounded in-memory ring. The events are ALSO persisted by the
 * incident capture manager; this ring exists so a reconciliation that
 * PRECEDES the first C10 hold can be joined to the incident when the
 * hold opens it.
 */
const DEFAULT_RING_CAPACITY = 512

let ringCapacity = DEFAULT_RING_CAPACITY
let ring: ReconciliationDiagnosticRecord[] = []
let seq = 0
let enabled = false

/**
 * Whether the reconciliation diagnostic sink is armed.
 *
 * The ACT requires the PUBLIC default to preserve a MINIMAL local
 * incident summary. The DETAILED forensic reconciliation timeline is
 * developer-grade and is therefore armed by the central dogfood
 * profile — never by a new env override matrix.
 */
export function isReconciliationDiagnosticCaptureEnabled(): boolean {
	return enabled
}

/**
 * Arm or disarm the reconciliation diagnostic sink. When disarmed,
 * every capture entry point is a complete no-op.
 */
export function setReconciliationDiagnosticCaptureEnabled(next: boolean): void {
	enabled = next
}

/**
 * Override the ring capacity (tests only).
 */
export function setReconciliationDiagnosticCaptureBufferSize(size: number): void {
	ringCapacity = Math.max(1, size)
}

/**
 * The retained reconciliation diagnostic records, oldest first.
 */
export function getReconciliationDiagnosticRecords(): readonly ReconciliationDiagnosticRecord[] {
	return ring
}

/**
 * Clear the ring (tests only). Never called by the dump/export path —
 * dump != clear.
 */
export function clearReconciliationDiagnosticRecords(): void {
	ring = []
	seq = 0
}

/**
 * Record one reconciliation diagnostic event.
 *
 * NEVER throws: a diagnostic sink failure must not interrupt process
 * supervision.
 */
export function captureReconciliationDiagnostic(
	input: Omit<ReconciliationDiagnosticRecord, "schemaVersion" | "eventSeq" | "timestamp">,
): void {
	if (!enabled) {
		return
	}
	try {
		seq += 1
		const record: ReconciliationDiagnosticRecord = {
			schemaVersion: RECONCILIATION_DIAGNOSTIC_SCHEMA_VERSION,
			eventSeq: seq,
			timestamp: new Date().toISOString(),
			...input,
		}
		ring.push(record)
		while (ring.length > ringCapacity) {
			ring.shift()
		}
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01):
		// forward the observation to the automatic incident manager so
		// the reconciliation lifecycle is preserved in the incident's
		// own timeline. The join is IDENTITY-CHECKED: a record for a
		// different job / owner is never attached to an incident.
		//
		// The import is LAZY so this diagnostic module never creates an
		// import cycle with the incident manager, and a capture failure
		// can never interrupt process supervision.
		void import("./automatic-incident-capture")
			.then((mod) => mod.joinReconciliationRecordsToIncidents([record]))
			.catch(() => {
				// A diagnostic sink failure MUST NOT interrupt supervision.
			})
	} catch {
		// A diagnostic sink failure MUST NOT interrupt supervision.
	}
}

/**
 * The diagnostic classification of a reconciliation, derived ONLY from
 * the observed records.
 *
 * The classification NEVER asserts current process liveness: an
 * exhausted observation horizon proves that the budget ran out, NOT
 * that the group is still alive.
 */
export function classifyReconciliation(
	records: readonly ReconciliationDiagnosticRecord[],
): ReconciliationDiagnosticClassification {
	if (records.length === 0) {
		return "UNAVAILABLE_FROM_TRACE"
	}
	const last = records[records.length - 1]
	switch (last.stage) {
		case "reconciliation_registered":
			return "REGISTERED"
		case "reconciliation_skipped":
			return last.skipReason === "disabled" ? "DISABLED" : "NOT_ELIGIBLE"
		case "reconciliation_attempt":
			return "OBSERVING"
		case "reconciliation_resolved":
			return "RESOLVED_GONE"
		case "reconciliation_exhausted":
			return "EXHAUSTED_NON_GONE"
		case "reconciliation_cancelled":
			return "DISPOSED"
		default:
			return "UNAVAILABLE_FROM_TRACE"
	}
}
