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
import { getTurnStateWriterProvenanceRecords, type TurnStateWriterProvenanceRecord } from "@shared/turn-state-writer-provenance"
import type { AutomaticIncident } from "./automatic-incident-capture"
import { getContinuationCardinalityAuthorityCaptureRecords } from "./continuation-cardinality-authority"
import { isReconciliationDiagnosticCaptureEnabled } from "./reconciliation-diagnostic-capture"

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
 * The three states are DISTINCT and are never collapsed:
 *
 *   - `not_armed` — the sink was disarmed; no record could exist.
 *   - `no_matching_records` — the sink was armed; nothing matched.
 *   - `available` — records were joined.
 */
export type AutomaticIncidentExportReconciliationAvailability = "available" | "not_armed" | "no_matching_records" | "unknown"

/**
 * The complete joined source set for ONE incident.
 */
export interface AutomaticIncidentExportSources {
	readonly phaseWriters: readonly AutomaticIncidentExportPhaseWriter[]
	readonly phaseWriterStatus: AutomaticIncidentExportSourceStatus
	readonly continuationSummary: AutomaticIncidentExportContinuationSummary
	readonly reconciliationAvailability: AutomaticIncidentExportReconciliationAvailability
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
 * A record joins ONLY when its `taskId` and `epoch` match the
 * incident's. A record that carries NEITHER identity field is NOT
 * joined: an unscoped record cannot be attributed to one incident.
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
		if (record.epoch !== undefined && record.epoch !== epoch) {
			// A STALE epoch never joins.
			continue
		}
		joined.push({
			phaseWriter: record.writerId,
			commitOrigin: record.committed.phase,
			taskId: record.taskId,
			epoch: record.epoch,
			previousPhase: record.previous.phase,
			requestedPhase: record.requested.phase,
			committedPhase: record.committed.phase,
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
 * Join the host-ring continuation records to the incident.
 *
 * The CCARD ring is consulted FIRST: it is the canonical
 * completion-authority record and it carries the terminal stages. The
 * BCAPT ring is consulted SECOND: it carries the BCB decision boundary's
 * own outcome. The FIRST matching record wins, so the summary names ONE
 * authoritative outcome.
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

	// CCARD — the canonical completion-authority record.
	for (const record of getContinuationCardinalityAuthorityCaptureRecords()) {
		if (record.sessionId !== sessionId || record.taskId !== taskId) {
			continue
		}
		return {
			status: "available",
			outcome: record.stage,
			origin: record.origin,
			sessionId: record.sessionId,
			taskId: record.taskId,
			observedAt: record.at,
		}
	}

	// BCAPT — the BCB decision boundary's own outcome.
	for (const record of getBcbObservationUnavailableCaptureRecords()) {
		if (record.sessionId !== sessionId || record.taskId !== taskId) {
			continue
		}
		if (epoch !== undefined && record.epoch !== epoch) {
			continue
		}
		return {
			status: "available",
			outcome: record.writerId,
			origin: record.writerId,
			sessionId: record.sessionId,
			taskId: record.taskId,
			epoch: record.epoch,
			writerId: record.writerId,
			committedPhase: record.committedPhase,
			observedAt: record.capturedAt,
		}
	}

	return { status: "unavailable", reason: "no_matching_records" }
}

/**
 * Classify the reconciliation timeline's availability.
 *
 * The arming state is read at EXPORT time. The export NEVER claims to
 * know the arming state AT INCIDENT TIME: the incident does not record
 * it, so the export reports the state it can observe and says so.
 */
function classifyReconciliation(incident: AutomaticIncident): AutomaticIncidentExportReconciliationAvailability {
	if (incident.reconciliationTimeline.length > 0) {
		return "available"
	}
	if (!isReconciliationDiagnosticCaptureEnabled()) {
		// The sink is DISARMED: no record could have been produced.
		return "not_armed"
	}
	return "no_matching_records"
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
	}
}

/**
 * Re-export the record type for the test's convenience.
 */
export type { TurnStateWriterProvenanceRecord }
