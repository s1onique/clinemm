/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-3 — SOURCE-BOUND EXPORT)
 *
 * The SOURCE-BOUND containment-provenance reader for the incident ZIP.
 *
 * WHY THIS EXISTS
 * ---------------
 *
 * The pre-correction export assembled its `containment-provenance.json`
 * from a SINGLE boolean:
 *
 *   containmentProvenance: {
 *     status: persisted ? "available" : "unavailable"
 *   }
 *
 * where `persisted` meant "an automatic incident snapshot exists on
 * disk". That is NOT a statement about the CFPR01 protected
 * containment records at all. The incident snapshot and the protected
 * provenance store are DIFFERENT artifacts with DIFFERENT lifetimes:
 * the snapshot is written by the incident manager, the protected
 * records are written by the CFPR01 store in the background-job
 * liveness authority.
 *
 * The consequence was a report that CLAIMED to contain
 * `containment-provenance.json` with `status: "available"` while
 * carrying NO protected records — i.e. the report asserted the
 * availability of the evidence that justified the C10 hold without
 * containing that evidence.
 *
 * THE CONTRACT HERE
 * -----------------
 *
 *   1. The reader reads the REAL protected store.
 *   2. The join uses the EXACT blocking job ids of the incident.
 *   3. A job whose protected records are absent is reported
 *      `UNAVAILABLE_FROM_TRACE` — never "available".
 *   4. When NO blocking job has retained protected records, the whole
 *      block is `UNAVAILABLE_FROM_TRACE` with an explicit reason.
 *   5. Nothing is inferred from the incident's own persistence.
 *
 * PRIVACY
 * -------
 *
 * The protected records carry identities, verdicts, errno strings and
 * policy numbers. They NEVER carry command text, stdout/stderr, prompt
 * content or environment values. The exported block is built from an
 * explicit ALLOWLIST, not by serializing the source record wholesale.
 */

import {
	type BackgroundJobLivenessAuthorityProvenanceSnapshot,
	getBackgroundJobLivenessAuthorityProvenanceSnapshot,
} from "./background-job-liveness-authority"

/**
 * The schema version of the exported containment-provenance block.
 */
export const AUTOMATIC_INCIDENT_CONTAINMENT_PROVENANCE_SCHEMA_VERSION = 1

/**
 * The availability classification of ONE blocking job's protected
 * containment evidence.
 *
 *   - `JOIN_COMPLETE`        — the protected failure record AND the
 *                               associated terminal publication record
 *                               were both retained for this job.
 *   - `JOIN_INCOMPLETE`      — at least one of the two was retained;
 *                               the other is absent.
 *   - `UNAVAILABLE_FROM_TRACE` — neither record is retained. The
 *                               recorder cannot prove WHY (it was never
 *                               captured, or it was evicted).
 */
export type AutomaticIncidentContainmentJobAvailability = "JOIN_COMPLETE" | "JOIN_INCOMPLETE" | "UNAVAILABLE_FROM_TRACE"

/**
 * The exported per-job containment-provenance entry.
 */
export interface AutomaticIncidentContainmentProvenanceJob {
	readonly jobId: string
	readonly availability: AutomaticIncidentContainmentJobAvailability
	/** The kernel verdict on the owned process group, when retained. */
	readonly postcondition: string | null
	/** The OS errno behind the verdict, when retained. */
	readonly osErrorCode: string | null
	/** The structured containment failure reason, when retained. */
	readonly containmentFailed: string | null
	/** The launch-time owner session id, when retained. */
	readonly ownerSessionId: string | null
	/** The supervised process group's id, when retained. */
	readonly pgid: number | null
	/** The supervised root process's id, when retained. */
	readonly pid: number | null
	/** Whether the associated terminal publication record was retained. */
	readonly terminalPublicationRetained: boolean
	/** The published terminal state, when the publication was retained. */
	readonly publishedJobState: string | null
}

/**
 * The exported containment-provenance block.
 */
export interface AutomaticIncidentContainmentProvenance {
	readonly schemaVersion: number
	readonly status: "available" | "UNAVAILABLE_FROM_TRACE"
	/** The exact blocking job ids the join was performed against. */
	readonly requestedJobIds: readonly string[]
	/** The per-job join result. */
	readonly jobs: readonly AutomaticIncidentContainmentProvenanceJob[]
	/** Why the block is unavailable, when it is. */
	readonly reason?: string
	/** The explicit loss accounting carried by the protected store. */
	readonly loss?: Readonly<Record<string, number>>
}

/**
 * Read the REAL protected provenance store and join it to the
 * incident's EXACT blocking job ids.
 *
 * The store is read THROUGH the production reader
 * (`getBackgroundJobLivenessAuthorityProvenanceSnapshot`), so the
 * export can never claim the availability of evidence that the
 * production store does not actually hold.
 */
export function readContainmentProvenanceForBlockingJobs(
	blockingJobIds: readonly string[],
	readSnapshot: () => BackgroundJobLivenessAuthorityProvenanceSnapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot,
): AutomaticIncidentContainmentProvenance {
	const requested = [...blockingJobIds]
	if (requested.length === 0) {
		return {
			schemaVersion: AUTOMATIC_INCIDENT_CONTAINMENT_PROVENANCE_SCHEMA_VERSION,
			status: "UNAVAILABLE_FROM_TRACE",
			requestedJobIds: requested,
			jobs: [],
			reason: "the incident names no blocking job, so there is no protected containment evidence to join",
		}
	}

	let snapshot: BackgroundJobLivenessAuthorityProvenanceSnapshot
	try {
		snapshot = readSnapshot()
	} catch (error) {
		return {
			schemaVersion: AUTOMATIC_INCIDENT_CONTAINMENT_PROVENANCE_SCHEMA_VERSION,
			status: "UNAVAILABLE_FROM_TRACE",
			requestedJobIds: requested,
			jobs: [],
			reason: `the protected containment provenance store could not be read: ${
				error instanceof Error ? error.message : String(error)
			}`,
		}
	}

	const protectedByJobId = new Map(snapshot.protectedJobs.map((job) => [job.jobId, job]))
	const jobs: AutomaticIncidentContainmentProvenanceJob[] = []
	let completeCount = 0
	let incompleteCount = 0
	let unavailableCount = 0

	for (const jobId of requested) {
		const entry = protectedByJobId.get(jobId)
		const failure = entry?.failureRecord ?? null
		const publication = entry?.terminalPublicationRecord ?? null
		let availability: AutomaticIncidentContainmentJobAvailability
		if (failure && publication) {
			availability = "JOIN_COMPLETE"
			completeCount += 1
		} else if (failure || publication) {
			availability = "JOIN_INCOMPLETE"
			incompleteCount += 1
		} else {
			availability = "UNAVAILABLE_FROM_TRACE"
			unavailableCount += 1
		}
		jobs.push({
			jobId,
			availability,
			postcondition: failure?.postcondition ?? null,
			osErrorCode: failure?.osErrorCode ?? null,
			containmentFailed: failure?.containmentFailed ?? null,
			ownerSessionId: failure?.ownerSessionId ?? null,
			pgid: failure?.pgid ?? null,
			pid: failure?.pid ?? null,
			terminalPublicationRetained: publication !== null,
			publishedJobState: publication?.publishedState ?? null,
		})
	}

	if (completeCount === 0 && incompleteCount === 0) {
		// NO protected record was retained for ANY of the incident's
		// blocking jobs. The block is UNAVAILABLE — the report must
		// not claim that the source evidence was retrieved.
		return {
			schemaVersion: AUTOMATIC_INCIDENT_CONTAINMENT_PROVENANCE_SCHEMA_VERSION,
			status: "UNAVAILABLE_FROM_TRACE",
			requestedJobIds: requested,
			jobs,
			reason:
				"the protected containment provenance store retained no records for this incident's blocking jobs; " +
				"the original containment evidence is not available from this trace",
			loss: { ...snapshot.loss },
		}
	}

	return {
		schemaVersion: AUTOMATIC_INCIDENT_CONTAINMENT_PROVENANCE_SCHEMA_VERSION,
		status: "available",
		requestedJobIds: requested,
		jobs,
		reason:
			unavailableCount > 0
				? `${unavailableCount} of ${requested.length} blocking job(s) have no retained protected containment record`
				: undefined,
		loss: { ...snapshot.loss },
	}
}
