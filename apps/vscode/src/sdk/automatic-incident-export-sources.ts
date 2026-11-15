/**
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 (AICE01)
 *
 * The OWNER-SCOPED SOURCE JOIN for the automatic incident export.
 *
 * THE GAP THIS MODULE CLOSES
 * --------------------------
 *
 * The automatic incident export produces two evidence members that the
 * production export call site never populated:
 *
 *   - `phase-writers.jsonl` — the phase-writer provenance; and
 *   - `continuation-summary.json` — the continuation outcome summary.
 *
 * `buildAutomaticIncidentExportBundle` already accepts BOTH as inputs
 * and already defines their shapes. The ONE production export call site
 * (`automatic-incident-export-runtime.ts` -> `prepareAutomaticIncidentExport`)
 * simply never passed them, so the two members were STRUCTURALLY EMPTY
 * regardless of what the host had actually observed.
 *
 * WHY A JOIN, NOT A NEW INSTRUMENTATION SUBSYSTEM
 * ------------------------------------------------
 *
 * Every source this module reads is an EXISTING, bounded, host-realm
 * diagnostic ring that is ALREADY produced by the production seams:
 *
 *   | Source             | Producer                             | Ring                |
 *   |--------------------|--------------------------------------|---------------------|
 *   | phase writers      | `TurnStateTracker.setWithWriter`     | TSWPD host ring     |
 *   | continuation (CCARD)| the completion-authority seams        | CCARD host ring     |
 *   | continuation (BCAPT)| the BCB decision boundary             | BCAPT host ring     |
 *   | reconciliation      | TCRR01 -> the default-off sink        | incident timeline   |
 *
 * This module therefore REUSES existing data/capture facilities. It
 * adds NO recorder, NO recorder call site, NO protocol, NO public API
 * and NO MCP operation.
 *
 * REALM / OWNERSHIP
 * -----------------
 *
 * All four rings live in the EXTENSION-HOST JS realm:
 *
 *   - `apps/vscode/src/shared/turn-state-writer-provenance.ts` is
 *     stamped by `apps/vscode/src/sdk/turn-state-tracker.ts` (host);
 *   - `apps/vscode/src/sdk/continuation-cardinality-authority.ts` is
 *     stamped by the completion-authority seams (host);
 *   - `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts`
 *     is stamped by `sdk-session-event-coordinator.ts` (host);
 *   - `apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts` is
 *     stamped by `command-job-manager.ts` (host).
 *
 * The webview / React realm NEVER produces these records, so an export
 * that reads them in the extension host sees the SAME instances the
 * production seams wrote. No cross-realm transfer is required and none
 * is introduced.
 *
 * OWNER SCOPING
 * -------------
 *
 * A record joins an incident ONLY when its identity matches the
 * incident's causal identity:
 *
 *   - phase writers: `taskId` AND `epoch` must match (when the record
 *     carries them). A record that carries NEITHER is NOT joined:
 *     an unscoped record cannot be attributed to one incident.
 *   - continuation (CCARD): `sessionId` AND `taskId` must match.
 *   - continuation (BCAPT): `sessionId` AND `taskId` AND `epoch` must
 *     match.
 *
 * A record that does not match is DROPPED. It never leaks.
 *
 * HONESTY CONTRACT
 * ----------------
 *
 * Every source reports an EXPLICIT availability state. A source that
 * could not be observed is `unavailable` with a REASON. An empty
 * collection is NEVER presented as a complete capture:
 *
 *   - `not_armed`  — the diagnostic sink was DISARMED, so NO record
 *                    could have been produced. This is the state the
 *                    public default produces.
 *   - `no_matching_records` — the sink was ARMED, but no record
 *                    matched this incident's identity.
 *   - `unknown` — the arming state could not be established.
 *
 * The reconciliation arming state is read at EXPORT time. It is NOT
 * retro-fitted onto the incident: the export reports the arming state
 * it could observe, and it never claims to know whether the sink was
 * armed AT INCIDENT TIME when that cannot be established.
 *
 * PRIVACY
 * -------
 *
 * The joined records carry only identities, phases, reason codes and
 * counters. The export's own strict allowlist (`sanitizeDetail`)
 * remains the FINAL gate: a key that is not allowlisted is DROPPED,
 * not redacted.
 */

import { getBcbObservationUnavailableCaptureRecords } from "@shared/bcb-observation-unavailable-capture"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { getTurnStateWriterProvenanceRecords, type TurnStateWriterProvenanceRecord } from "@shared/turn-state-writer-provenance"
import type { AutomaticIncident } from "./automatic-incident-capture"
import { getContinuationCardinalityAuthorityCaptureRecords } from "./continuation-cardinality-authority"
import { isReconciliationDiagnosticCaptureEnabled } from "./reconciliation-diagnostic-capture"

/**
 * The CLOSED set of legitimate turn phases.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01 (P1):
 *
 * The export's privacy gate is a KEY allowlist: `commitOrigin` is an
 * allowlisted key, and the export assumed its VALUE was a bounded enum
 * member. That assumption was never enforced. A phase slot carrying
 * arbitrary text therefore reached `phase-writers.jsonl` verbatim.
 *
 * The value is now validated against this closed set BEFORE it is
 * exported. A value outside the set is DROPPED, so no
 * attacker-controlled text can reach the archive through a legitimate
 * key.
 */
const LEGITIMATE_TURN_PHASES: ReadonlySet<string> = new Set<string>([
	"idle",
	"streaming",
	"awaiting_approval",
	"awaiting_followup",
	"compacting",
	"completed",
	"error",
	"resumable",
])

/**
 * Export a phase value ONLY when it is a legitimate turn phase.
 *
 * Returns `undefined` for anything else, so the caller DROPS the field
 * instead of forwarding an unvalidated value.
 */
function exportSafePhase(phase: TurnPhase | string | undefined): string | undefined {
	if (typeof phase !== "string") {
		return undefined
	}
	return LEGITIMATE_TURN_PHASES.has(phase) ? phase : undefined
}

/**
 * The EXPLICIT availability state of one export source.
 *
 * - `available` — the source produced at least one JOINED record.
 * - `unavailable` — the source produced NO joined record. The reason
 *   names WHY, and the reason NEVER claims "nothing happened" when the
 *   truth is "the observer was not watching".
 */
export type AutomaticIncidentExportSourceAvailability = "available" | "unavailable"

/**
 * Why a source produced no joined record.
 *
 * - `not_armed` — the diagnostic sink was DISARMED. No record could
 *   have been produced. This is NOT evidence that no event occurred.
 * - `no_matching_records` — the sink was ARMED, but no record matched
 *   this incident's identity.
 * - `unknown` — the arming state could not be established.
 * - `no_identity` — the incident itself carries no usable identity.
 */
export type AutomaticIncidentExportUnavailableReason = "not_armed" | "no_matching_records" | "unknown" | "no_identity"

/**
 * One export source's availability, with its reason.
 */
export interface AutomaticIncidentExportSourceStatus {
	readonly availability: AutomaticIncidentExportSourceAvailability
	readonly reason?: AutomaticIncidentExportUnavailableReason
	readonly recordCount: number
}

/**
 * The joined phase-writer records, in the EXPORT's allowlisted shape.
 *
 * The keys are the export's allowlisted detail keys, so the export's
 * `sanitizeDetail` gate passes them through unchanged and DROPS every
 * key that is not allowlisted.
 */
export interface AutomaticIncidentExportPhaseWriter {
	readonly phaseWriter: string
	readonly commitOrigin?: string
	readonly taskId?: string
	readonly epoch?: number
	readonly previousPhase?: string
	readonly requestedPhase?: string
	readonly committedPhase?: string
	readonly capturedAt?: number
}

/**
 * The joined continuation outcome.
 *
 * The `outcome` is the AUTHORITATIVE recorded stage. It is never
 * synthesized: a continuation summary with no joined authority stays
 * `unavailable` with a reason.
 */
export interface AutomaticIncidentExportContinuationSummary {
	readonly status: AutomaticIncidentExportSourceAvailability
	readonly reason?: AutomaticIncidentExportUnavailableReason
	readonly outcome?: string
	readonly origin?: string
	readonly sessionId?: string
	readonly taskId?: string
	readonly epoch?: number
	readonly writerId?: string
	readonly committedPhase?: string
	readonly observedAt?: number
}

/**
 * The reconciliation timeline's availability classification.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01:
 *
 * The INCIDENT-TIME arming state is `unknown` unless it is actually
 * established. The incident does NOT record whether the diagnostic sink
 * was armed when it was opened, so `unknown` is the only truthful
 * value. The EXPORT-TIME arming state is reported SEPARATELY and
 * EXPLICITLY labeled, because it is a fact about the export moment and
 * not about the incident.
 *
 * The states are DISTINCT and are never collapsed:
 *
 *   - `unknown` — the incident-time arming was never established (the
 *     only honest value for an incident that recorded no timeline);
 *   - `available` — records WERE joined to this incident.
 */
export type AutomaticIncidentExportReconciliationAvailability = "available" | "unknown"

/**
 * The EXPORT-TIME arming state of the reconciliation sink.
 *
 * This is a fact about the EXPORT MOMENT. It is reported separately
 * from the incident-time availability and is NEVER used to explain why
 * an incident's historical evidence is absent.
 */
export type AutomaticIncidentExportArmingState = "armed" | "disarmed"

/**
 * The complete joined source set for ONE incident.
 */
export interface AutomaticIncidentExportSources {
	readonly phaseWriters: readonly AutomaticIncidentExportPhaseWriter[]
	readonly phaseWriterStatus: AutomaticIncidentExportSourceStatus
	readonly continuationSummary: AutomaticIncidentExportContinuationSummary
	/**
	 * The INCIDENT-TIME availability of the reconciliation timeline.
	 * `unknown` unless records were actually joined to this incident.
	 */
	readonly reconciliationAvailability: AutomaticIncidentExportReconciliationAvailability
	/**
	 * The EXPORT-TIME arming state of the reconciliation sink. Reported
	 * SEPARATELY: it is a fact about the export moment and is NEVER used
	 * to explain an incident's historical evidence.
	 */
	readonly reconciliationExportTimeArming: AutomaticIncidentExportArmingState
}

/**
 * Whether the incident's identity can be used for an owner-scoped join.
 */
function usableIdentity(incident: AutomaticIncident): boolean {
	const identity = incident.identity
	return (
		typeof identity.sessionId === "string" &&
		identity.sessionId !== "UNOBSERVED" &&
		typeof identity.taskId === "string" &&
		identity.taskId !== "UNOBSERVED" &&
		typeof identity.epoch === "number" &&
		identity.epoch !== ("UNOBSERVED" as unknown as number)
	)
}

/**
 * Join the host-ring phase-writer records to the incident.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01 (P0-1):
 *
 * The FIRST correction joined a record whose `epoch` was `undefined`,
 * on the grounds that an unscoped record could not be attributed to a
 * DIFFERENT epoch. That was wrong: an epoch-LESS record cannot be
 * attributed to THIS incident's epoch either, and attaching it to a
 * specific-epoch incident is exactly the cross-epoch misattribution
 * this ACT must not commit.
 *
 * The rule is now EXACT: a record joins ONLY when its `epoch` EQUALS the
 * incident's epoch. A record with no epoch never joins.
 */
function joinPhaseWriters(incident: AutomaticIncident): {
	records: AutomaticIncidentExportPhaseWriter[]
	status: AutomaticIncidentExportSourceStatus
} {
	const identity = incident.identity
	const taskId = typeof identity.taskId === "string" && identity.taskId !== "UNOBSERVED" ? identity.taskId : undefined
	const epoch = typeof identity.epoch === "number" ? identity.epoch : undefined
	if (!taskId || epoch === undefined) {
		return {
			records: [],
			status: { availability: "unavailable", reason: "no_identity", recordCount: 0 },
		}
	}
	const joined: AutomaticIncidentExportPhaseWriter[] = []
	for (const record of getTurnStateWriterProvenanceRecords()) {
		if (record.taskId !== taskId) {
			// A DIFFERENT task (or an unscoped record) never joins.
			continue
		}
		if (record.epoch !== epoch) {
			// ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01
			// (P0-1): EXACT epoch match. A record with NO epoch and a
			// record with a DIFFERENT epoch are BOTH unattributable to
			// this incident and are both dropped.
			continue
		}
		joined.push({
			phaseWriter: record.writerId,
			commitOrigin: exportSafePhase(record.committed.phase),
			taskId: record.taskId,
			epoch: record.epoch,
			previousPhase: exportSafePhase(record.previous.phase),
			requestedPhase: exportSafePhase(record.requested.phase),
			committedPhase: exportSafePhase(record.committed.phase),
			capturedAt: record.capturedAt,
		})
	}
	if (joined.length > 0) {
		return { records: joined, status: { availability: "available", recordCount: joined.length } }
	}
	return {
		records: [],
		status: { availability: "unavailable", reason: "no_matching_records", recordCount: 0 },
	}
}

/**
 * The CCARD stages that can constitute an incident's OUTCOME.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01 (P0-2):
 *
 * CCARD is a CYCLE recorder: it observes the whole lifecycle. Its
 * ENTER-only stages (`run_turn_started`, `execute_turn_prelude_enter`,
 * `terminal_committed`, `notify_consume_enter`, `wake_created`,
 * `pending_prompt_enqueued`, `pending_prompt_dequeued`,
 * `continuation_scheduled`, `task_started`, `continuation_started`) record
 * that something STARTED. They are NOT outcomes. Presenting one as the
 * incident's continuation outcome would misclassify a mid-flight
 * observation as a terminal verdict.
 *
 * Only the OUTCOME-bearing stages qualify.
 */
const AUTHORITATIVE_CONTINUATION_STAGES: ReadonlySet<string> = new Set<string>([
	"agent_turn_done",
	"submit_and_exit_seen",
	"task_completion_committed",
])

/**
 * The incident's temporal LOWER BOUND, in epoch milliseconds.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01 (P0-2):
 *
 * The CCARD record carries NO epoch. Session + task alone therefore do
 * NOT identify the incident: a task can run for several epochs, and the
 * ring retains records across them. The FIRST record that happens to
 * share the session/task is an ARBITRARY choice, not the incident's
 * outcome.
 *
 * The incident DOES carry a causal temporal anchor — `openedAt` — which
 * brackets the observations that belong to it. A record captured BEFORE
 * the incident opened belongs to an EARLIER epoch of the same task and
 * is dropped.
 *
 * There is deliberately NO upper bound: a continuation outcome is a
 * CONSEQUENCE of the hold, so it legitimately occurs AFTER the incident
 * opened. The upper-side discrimination is provided by the epoch match
 * (BCAPT) and by selecting the LATEST qualifying record (CCARD).
 *
 * Returns `undefined` when the anchor cannot be established.
 */
function incidentOpenedAtMs(incident: AutomaticIncident): number | undefined {
	const openedAt = Date.parse(incident.openedAt)
	return Number.isFinite(openedAt) ? openedAt : undefined
}

/**
 * Join the host-ring continuation records to the incident.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01 (P0-2):
 *
 * The CCARD ring is consulted FIRST: it is the canonical
 * completion-authority record and it carries the terminal stages. The
 * BCAPT ring is consulted SECOND: it carries the BCB decision boundary's
 * own outcome.
 *
 * A record must satisfy ALL of:
 *
 *   1. the incident's session AND task (the owner scope);
 *   2. the incident's EPOCH, when the record carries one (BCAPT always
 *      does; CCARD never does);
 *   3. the incident's temporal LOWER BOUND — the record must not have
 *      been captured BEFORE the incident opened (CCARD and BCAPT both
 *      carry a capture timestamp);
 *   4. for CCARD, an AUTHORITATIVE outcome stage; and
 *   5. for CCARD, the LATEST qualifying record is selected, so the
 *      summary names the incident's most recent outcome rather than an
 *      arbitrary early one.
 *
 * When no record satisfies all of them, the summary is explicitly
 * `unavailable` with the reason. An arbitrary first-match event is
 * NEVER presented as the incident's outcome.
 */
function joinContinuation(incident: AutomaticIncident): AutomaticIncidentExportContinuationSummary {
	const identity = incident.identity
	const sessionId =
		typeof identity.sessionId === "string" && identity.sessionId !== "UNOBSERVED" ? identity.sessionId : undefined
	const taskId = typeof identity.taskId === "string" && identity.taskId !== "UNOBSERVED" ? identity.taskId : undefined
	const epoch = typeof identity.epoch === "number" ? identity.epoch : undefined
	if (!sessionId || !taskId) {
		return { status: "unavailable", reason: "no_identity" }
	}
	const openedAt = incidentOpenedAtMs(incident)
	if (openedAt === undefined) {
		// Without a causal anchor the records cannot be attributed to
		// THIS incident, so no outcome may be claimed.
		return { status: "unavailable", reason: "no_identity" }
	}

	// CCARD — the canonical completion-authority record. The LATEST
	// qualifying record wins, so the summary names the incident's most
	// recent outcome.
	//
	// The ordering is by the ring's MONOTONIC `seq` first and the
	// capture timestamp second. `seq` is the ring's own ordering and is
	// strictly increasing even when two records land in the SAME
	// millisecond, so it resolves the tie that `at` alone cannot.
	let bestCcard:
		| {
				readonly seq: number
				readonly stage: string
				readonly origin: string
				readonly sessionId: string
				readonly taskId: string
				readonly at: number
		  }
		| undefined
	for (const record of getContinuationCardinalityAuthorityCaptureRecords()) {
		if (record.sessionId !== sessionId || record.taskId !== taskId) {
			continue
		}
		if (!AUTHORITATIVE_CONTINUATION_STAGES.has(record.stage)) {
			// An ENTER-only stage is not an outcome.
			continue
		}
		if (record.at < openedAt) {
			// Captured BEFORE the incident opened: it belongs to an
			// earlier epoch of the same task.
			continue
		}
		if (bestCcard === undefined || record.seq > bestCcard.seq) {
			bestCcard = {
				seq: record.seq,
				stage: record.stage,
				origin: record.origin,
				sessionId: record.sessionId,
				taskId: record.taskId,
				at: record.at,
			}
		}
	}
	if (bestCcard !== undefined) {
		return {
			status: "available",
			outcome: bestCcard.stage,
			origin: bestCcard.origin,
			sessionId: bestCcard.sessionId,
			taskId: bestCcard.taskId,
			observedAt: bestCcard.at,
		}
	}

	// BCAPT — the BCB decision boundary's own outcome. The LATEST
	// qualifying record wins.
	//
	// BCAPT's records carry NO per-record sequence, so the ring's own
	// POSITION is the tiebreaker: a later position is a later record,
	// even when two records share a capture millisecond.
	let bestBcapt:
		| {
				readonly writerId: string
				readonly sessionId: string
				readonly taskId: string
				readonly epoch: number
				readonly committedPhase: string | undefined
				readonly capturedAt: number
		  }
		| undefined
	let bestBcaptPosition = -1
	const bcaptRecords = getBcbObservationUnavailableCaptureRecords()
	for (let position = 0; position < bcaptRecords.length; position++) {
		const record = bcaptRecords[position]!
		if (record.sessionId !== sessionId || record.taskId !== taskId) {
			continue
		}
		if (epoch !== undefined && record.epoch !== epoch) {
			// A DIFFERENT epoch never joins.
			continue
		}
		if (record.capturedAt < openedAt) {
			// Captured BEFORE the incident opened.
			continue
		}
		if (bestBcapt === undefined || record.capturedAt > bestBcapt.capturedAt || position > bestBcaptPosition) {
			bestBcaptPosition = position
			bestBcapt = {
				writerId: record.writerId,
				sessionId: record.sessionId,
				taskId: record.taskId,
				epoch: record.epoch,
				committedPhase: exportSafePhase(record.committedPhase),
				capturedAt: record.capturedAt,
			}
		}
	}
	if (bestBcapt !== undefined) {
		return {
			status: "available",
			outcome: bestBcapt.writerId,
			origin: bestBcapt.writerId,
			sessionId: bestBcapt.sessionId,
			taskId: bestBcapt.taskId,
			epoch: bestBcapt.epoch,
			writerId: bestBcapt.writerId,
			committedPhase: bestBcapt.committedPhase,
			observedAt: bestBcapt.capturedAt,
		}
	}

	return { status: "unavailable", reason: "no_matching_records" }
}

/**
 * Classify the reconciliation timeline's INCIDENT-TIME availability.
 *
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION01:
 *
 * The FIRST correction read the sink's arming state AT EXPORT TIME and
 * reported `not_armed` / `no_matching_records` as if it described the
 * incident. That is a TEMPORAL ERROR: the sink may have been armed or
 * disarmed at any time between the incident and the export, and the
 * incident does not record the state it was in when it opened.
 *
 * The incident-time availability is therefore `unknown` unless records
 * were ACTUALLY joined to this incident. The export-time arming is
 * returned SEPARATELY and is never used to explain the absence of
 * historical evidence.
 */
function classifyReconciliation(incident: AutomaticIncident): AutomaticIncidentExportReconciliationAvailability {
	if (incident.reconciliationTimeline.length > 0) {
		return "available"
	}
	// The incident-time arming state was never established.
	return "unknown"
}

/**
 * Read the EXPORT-TIME arming state of the reconciliation sink.
 *
 * This is reported separately from the incident-time availability and
 * is NEVER used to explain why an incident's historical evidence is
 * absent.
 */
function readExportTimeArming(): AutomaticIncidentExportArmingState {
	return isReconciliationDiagnosticCaptureEnabled() ? "armed" : "disarmed"
}

/**
 * Join every export source to the incident.
 *
 * This is the ONLY join the production export path needs. It reads
 * EXISTING host rings; it creates no recorder and no protocol.
 */
export function joinAutomaticIncidentExportSources(incident: AutomaticIncident): AutomaticIncidentExportSources {
	const phase = joinPhaseWriters(incident)
	return {
		phaseWriters: phase.records,
		phaseWriterStatus: phase.status,
		continuationSummary: joinContinuation(incident),
		reconciliationAvailability: classifyReconciliation(incident),
		reconciliationExportTimeArming: readExportTimeArming(),
	}
}

/**
 * Re-export the record type for the test's convenience.
 */
export type { TurnStateWriterProvenanceRecord }
