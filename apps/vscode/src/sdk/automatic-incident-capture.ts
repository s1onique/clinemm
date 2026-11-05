/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The automatic, incident-scoped capture manager.
 *
 * THE DESIGN PRINCIPLE
 * ---------------------
 *
 *   "Capture evidence when the authoritative event occurs, not when
 *    the user eventually requests a dump."
 *
 * At ENTRY_HEAD the ONLY incident artifact was the CIFR in-memory
 * recorder plus its single flat checkpoint, and the checkpoint was
 * written ONLY on task switch / extension-host deactivate. This
 * module opens an INCIDENT at the authoritative completion-hold
 * boundary and keeps it - bounded, deduplicated and persistent - until
 * the user asks for it.
 *
 * WHAT THIS MODULE DOES NOT DO
 * -----------------------------
 *
 *   - It does NOT change any production state machine. It observes.
 *   - It does NOT change the C10 predicate, the Elm authority, the
 *     reconciliation retry policy, the containment semantics or the
 *     phase-writer selection.
 *   - It does NOT merge two incidents on `taskId` alone: the causal
 *     identity is `(sessionId, taskId, epoch, barrierId)`.
 *   - It does NOT fabricate a missing identity: an unobserved session
 *     or epoch stays `UNOBSERVED`.
 *
 * DEDUPLICATION
 * -------------
 *
 * A held C10 barrier can be re-evaluated hundreds of times. Repeated
 * reevaluations of unchanged predicates must not produce hundreds of
 * identical persisted snapshots. The dedup key is:
 *
 *   same causal identity + same stage + same evaluated outcome +
 *   same relevant blocking-set identity
 *
 * and the coalesced observation carries an occurrence COUNT plus the
 * FIRST and LAST timestamps.
 *
 * PRIVACY
 * -------
 *
 * The default public capture is MINIMAL: incident type, timestamps,
 * phase, reason codes, numeric counters, diagnostic coverage and
 * loss, and build/runtime identity. Raw commands, model content,
 * stdout/stderr, environment variables and tool payloads are NEVER
 * captured here.
 */

import type { TurnPhase } from "@shared/ExtensionMessage"

/**
 * The schema version of the persisted incident artifact. Bumped when
 * the on-disk SHAPE changes.
 */
export const AUTOMATIC_INCIDENT_SCHEMA_VERSION = 1

/**
 * The bound on retained ANOMALOUS incidents. The ACT's initial
 * proposed limit.
 */
export const MAX_RETAINED_ANOMALOUS_INCIDENTS = 4

/**
 * The per-incident byte bound, measured in ACTUAL UTF-8 BYTES.
 */
export const MAX_INCIDENT_BYTES = 2 * 1024 * 1024

/**
 * The total byte bound across all retained incidents.
 */
export const MAX_TOTAL_INCIDENT_BYTES = 12 * 1024 * 1024

/**
 * The bound on reconciliation JOBS recorded per incident.
 */
export const MAX_RECONCILIATION_JOBS_PER_INCIDENT = 128

/**
 * The bound on reconciliation ATTEMPTS recorded per job record.
 *
 * This is INDEPENDENT of TCRR01's own production retry cap: the
 * diagnostic bound never changes how many probes actually run.
 */
export const MAX_RECONCILIATION_ATTEMPTS_PER_JOB_RECORDED = 32

/**
 * The diagnostic capture stages the incident manager can record.
 */
export type AutomaticIncidentStage =
	| "completion_held"
	| "held_phase_published"
	| "stalled_no_progress"
	| "containment_failure_published"
	| "reconciliation_observed"
	| "controller_reconciliation_published"
	| "c10_reevaluated"
	| "completion_committed"

/**
 * The causal identity of an incident.
 *
 * `barrierId` is the EXISTING diagnostic barrier id (already minted by
 * the CIFR). It is used for lifecycle correlation ONLY and NEVER
 * enters a production state-machine decision.
 *
 * A missing identity stays `UNOBSERVED` - it is never synthesized
 * from the currently active UI.
 */
export interface AutomaticIncidentIdentity {
	readonly sessionId: string | "UNOBSERVED"
	readonly taskId: string | undefined | "UNOBSERVED"
	readonly epoch: number | "UNOBSERVED"
	readonly barrierId: string | "UNOBSERVED"
	/** The diagnostic-only coordinator instance id. */
	readonly coordinatorInstanceId: string | "UNOBSERVED"
	/** The diagnostic-only extension-host instance id. */
	readonly extensionHostInstanceId: string | "UNOBSERVED"
}

/**
 * One coalesced observation within an incident.
 */
export interface AutomaticIncidentObservation {
	readonly schemaVersion: number
	readonly stage: AutomaticIncidentStage
	readonly outcome: string
	readonly timestamp: string
	/** How many times this EXACT observation was seen. */
	readonly observationCount: number
	/** The first time this observation was seen. */
	readonly firstSeenAt: string
	/** The last time this observation was seen. */
	readonly lastSeenAt: string
	/**
	 * The dedup key that was in effect WHEN THIS OBSERVATION WAS
	 * RECORDED. It is stored (not recomputed) so a later change to the
	 * incident's blocking set cannot shift the key of an already
	 * recorded decision.
	 */
	readonly dedupKey: string
	/** The bounded, privacy-safe detail. */
	readonly detail: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>
}

/**
 * The per-incident coverage of the causal chain.
 *
 * Every field is an EXPLICIT observation state. A field is never
 * inferred from silence: an unobserved link is `NOT_OBSERVED`, not
 * "successful".
 */
export type AutomaticIncidentCoverageState = "OBSERVED" | "NOT_OBSERVED" | "EVIDENCE_LOST" | "NOT_APPLICABLE"

/**
 * The coverage of ONE final C10 blocking job.
 */
export interface AutomaticIncidentJobCoverage {
	readonly jobId: string
	readonly originalFailure: AutomaticIncidentCoverageState
	readonly terminalPublication: AutomaticIncidentCoverageState
	readonly reconciliationRegistration: AutomaticIncidentCoverageState
	readonly reconciliationAttempts: AutomaticIncidentCoverageState
	readonly reconciliationTerminalOutcome: AutomaticIncidentCoverageState
	readonly controllerPublication: AutomaticIncidentCoverageState
	readonly c10Reevaluation: AutomaticIncidentCoverageState
}

/**
 * The explicit loss accounting. Each counter names its SOURCE so two
 * counters that may overlap are never summed into a claim of "N
 * unique lost records".
 */
export interface AutomaticIncidentLoss {
	/** CIFR: capsules evicted by the global capsule cap. */
	readonly cifrEvictedCapsules: number
	/** CIFR: records evicted by the global record cap. */
	readonly cifrEvictedRecords: number
	/** CIFR: records dropped inside a capsule by the per-capsule ring. */
	readonly cifrCapsuleDroppedRecords: number
	/** CIFR: capsules dropped by the checkpoint byte bound. */
	readonly cifrCheckpointTruncatedCapsules: number
	/** CIFR: records dropped by the checkpoint byte bound. */
	readonly cifrCheckpointTruncatedRecords: number
	/** BJLA: protected-provenance eviction. */
	readonly bjlaProtectedProvenanceEvictions: number
	/** AICE01: observations dropped by this incident's own byte bound. */
	readonly incidentSnapshotTruncations: number
	/** AICE01: persistence failures observed while writing this incident. */
	readonly persistenceFailures: number
	/** AICE01: evidence omitted by the export serializer. */
	readonly exportOmissions: number
	/** True when ANY source reported a loss. */
	readonly loss: boolean
}

/**
 * The human-readable incident summary.
 *
 * The summary separates OBSERVATIONS from CONCLUSIONS. It never
 * asserts a root cause the evidence does not establish.
 */
export interface AutomaticIncidentSummary {
	readonly schemaVersion: number
	readonly incidentId: string
	readonly trigger: AutomaticIncidentStage
	readonly observedPhase: TurnPhase | "UNOBSERVED"
	readonly completionCommitted: "OBSERVED" | "UNOBSERVED"
	readonly hold: {
		readonly reason: string | "UNOBSERVED"
		readonly blockingJobCount: number | "UNOBSERVED"
		readonly unconsumedTerminalCount: number | "UNOBSERVED"
	}
	readonly reconciliation: {
		readonly registered: number
		readonly resolved: number
		readonly exhausted: number
		readonly unknown: number
	}
	readonly evidence: {
		readonly classification: "CAPTURE_SUFFICIENT" | "CAPTURE_INSUFFICIENT"
		readonly loss: boolean
	}
	/** The OBSERVED facts, stated as observations. */
	readonly observed: readonly string[]
	/** The facts the evidence does NOT establish. */
	readonly notEstablished: readonly string[]
}

/**
 * The in-memory incident record.
 */
export interface AutomaticIncident {
	readonly schemaVersion: number
	/** The diagnostic-only incident id. Minted ONCE per incident. */
	readonly incidentId: string
	readonly identity: AutomaticIncidentIdentity
	readonly openedAt: string
	readonly updatedAt: string
	/** The stage that OPENED the incident. */
	readonly trigger: AutomaticIncidentStage
	/** The monotonic revision. A later write with a lower revision is rejected. */
	readonly revision: number
	readonly observations: readonly AutomaticIncidentObservation[]
	/** The exact final blocking set, positionally stable. */
	readonly blockingJobIds: readonly string[]
	/** The per-blocking-job coverage. */
	readonly coverage: readonly AutomaticIncidentJobCoverage[]
	readonly loss: AutomaticIncidentLoss
	/** The observed phase, when a phase was published. */
	readonly observedPhase: TurnPhase | "UNOBSERVED"
	/** True once the completion committed. */
	readonly completionCommitted: boolean
	/** The retained reconciliation timeline (bounded). */
	readonly reconciliationTimeline: readonly unknown[]
}

/**
 * The number of UTF-8 bytes a string occupies. The ACT requires the
 * bounds to be enforced on ACTUAL BYTES, not JavaScript string
 * lengths (which count UTF-16 code units).
 */
export function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8")
}

/**
 * The diagnostic-only extension-host instance id. A fresh extension
 * host mints a fresh id; continuity between two hosts is NEVER
 * fabricated.
 */
let extensionHostInstanceId = "extension-host-unknown"

/**
 * Mint the extension-host instance id. Called once at activation.
 */
export function setAutomaticIncidentExtensionHostInstanceId(id: string): void {
	extensionHostInstanceId = id
}

/**
 * The current extension-host instance id.
 */
export function getAutomaticIncidentExtensionHostInstanceId(): string {
	return extensionHostInstanceId
}

/**
 * The diagnostic-only incident id counter.
 */
let incidentSeq = 0

/**
 * Mint a diagnostic-only incident id.
 *
 * The id is internally generated and SAFE: it never embeds raw
 * user-supplied text, so it can be used directly as a directory name.
 */
export function mintAutomaticIncidentId(): string {
	incidentSeq += 1
	return `incident-${Date.now().toString(36)}-${incidentSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The causal identity key. Two observations with the same key belong
 * to the SAME incident.
 *
 * `taskId` alone is NEVER sufficient - the session, the epoch and the
 * barrier id are all part of the key.
 */
export function automaticIncidentIdentityKey(identity: AutomaticIncidentIdentity): string {
	return [
		identity.sessionId,
		identity.taskId === undefined ? "(undefined)" : identity.taskId,
		identity.epoch,
		identity.barrierId,
	].join("|")
}

/**
 * The dedup key for an observation.
 *
 * The same causal identity + the same stage + the same evaluated
 * outcome + the same relevant blocking-set identity.
 */
function observationDedupKey(
	identityKey: string,
	stage: AutomaticIncidentStage,
	outcome: string,
	detail: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>,
	blockingJobIds: readonly string[],
): string {
	// The relevant blocking-set identity comes from BOTH the detail
	// map and the authoritative `blockingJobIds` field. The boundary
	// may supply the set in either place; the dedup key must reflect
	// the SET, not the field it happened to arrive in.
	const fromDetail = Array.isArray(detail.blockingJobIds) ? [...(detail.blockingJobIds as string[])].sort().join(",") : ""
	const fromField = [...blockingJobIds].sort().join(",")
	const blocking = fromDetail || fromField
	const owner = typeof detail.ownerSessionId === "string" ? detail.ownerSessionId : ""
	const unconsumed = typeof detail.unconsumedTerminalCount === "number" ? String(detail.unconsumedTerminalCount) : ""
	return `${identityKey}|${stage}|${outcome}|${blocking}|${owner}|${unconsumed}`
}

/**
 * The live incidents, keyed by their causal identity.
 */
const incidentsByIdentity = new Map<string, AutomaticIncident>()

/**
 * The incident id -> causal identity index.
 */
const incidentIdToIdentity = new Map<string, string>()

/**
 * The retained incident ids, oldest first.
 */
const incidentOrder: string[] = []

/**
 * The capture DEPTH.
 *
 * `minimal`  — the PUBLIC default. An incident is ALWAYS opened and
 *              durably persisted, but only the minimal, privacy-safe
 *              summary fields are retained: the causal identity, the
 *              stage/outcome verdicts, the blocking-set identity and
 *              the counters. This satisfies the ACT's requirement that
 *              the public build "automatically preserve a minimal local
 *              incident summary".
 *
 * `detailed` — the DEVELOPER depth, armed by the central dogfood
 *              profile or by the user's explicit opt-in to detailed
 *              local diagnostics. It additionally retains the per-key
 *              detail map and the reconciliation timeline.
 */
export type AutomaticIncidentCaptureMode = "minimal" | "detailed"

/**
 * Whether the capture is armed. When disarmed, every entry point is a
 * complete no-op and NO allocation happens.
 *
 * The capture is armed in EVERY build: the ACT requires the public
 * build to automatically preserve a minimal local incident summary.
 * The DEPTH, not the arming, is what the dogfood profile changes.
 */
let captureEnabled = false

/**
 * The current capture depth. The public default is `minimal`.
 */
let captureMode: AutomaticIncidentCaptureMode = "minimal"

/**
 * Whether the capture is armed.
 */
export function isAutomaticIncidentCaptureEnabled(): boolean {
	return captureEnabled
}

/**
 * The current capture depth.
 */
export function getAutomaticIncidentCaptureMode(): AutomaticIncidentCaptureMode {
	return captureMode
}

/**
 * Arm or disarm the capture.
 *
 * Disarming is a DIAGNOSTIC ABLATION seam only: the ACT requires the
 * capture to be armed in every build. The ablation suites use it to
 * prove the capture has ZERO state-semantic delta when disarmed.
 */
export function setAutomaticIncidentCaptureEnabled(enabled: boolean): void {
	captureEnabled = enabled
}

/**
 * Set the capture DEPTH.
 *
 * `minimal` is the public default; `detailed` is the developer depth.
 */
export function setAutomaticIncidentCaptureMode(mode: AutomaticIncidentCaptureMode): void {
	captureMode = mode
}

/**
 * Clear every retained incident (tests only). The export path NEVER
 * calls this - dump != clear.
 */
export function clearAutomaticIncidents(): void {
	incidentsByIdentity.clear()
	incidentIdToIdentity.clear()
	incidentOrder.length = 0
	incidentSeq = 0
}

/**
 * The input for one capture call.
 */
export interface AutomaticIncidentCaptureInput {
	readonly identity: AutomaticIncidentIdentity
	readonly stage: AutomaticIncidentStage
	readonly outcome: string
	/** The bounded, privacy-safe detail. */
	readonly detail?: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>
	/** The phase, when a phase was published. */
	readonly phase?: TurnPhase
	/** The exact blocking set, when the boundary computed one. */
	readonly blockingJobIds?: readonly string[]
	/** The reconciliation timeline record to append, when the boundary produced one. */
	readonly reconciliation?: unknown
}

/**
 * Open a NEW incident, or update the existing one for this causal
 * identity.
 *
 * The function returns the affected incident, or `undefined` when the
 * capture is disarmed.
 */
export function captureAutomaticIncident(input: AutomaticIncidentCaptureInput): AutomaticIncident | undefined {
	if (!captureEnabled) {
		return undefined
	}
	try {
		const identityKey = automaticIncidentIdentityKey(input.identity)
		const existing = incidentsByIdentity.get(identityKey)
		if (!existing) {
			return openIncident(identityKey, input)
		}
		return applyObservation(existing, input)
	} catch {
		// A diagnostic capture failure MUST NOT interrupt task
		// execution.
		return undefined
	}
}

/**
 * Open a new incident for the given causal identity.
 */
function openIncident(identityKey: string, input: AutomaticIncidentCaptureInput): AutomaticIncident {
	const incidentId = mintAutomaticIncidentId()
	const now = new Date().toISOString()
	const blocking = input.blockingJobIds ? [...input.blockingJobIds] : []
	const incident: AutomaticIncident = {
		schemaVersion: AUTOMATIC_INCIDENT_SCHEMA_VERSION,
		incidentId,
		identity: input.identity,
		openedAt: now,
		updatedAt: now,
		trigger: input.stage,
		revision: 1,
		observations: [],
		blockingJobIds: blocking,
		coverage: blocking.map((jobId) => emptyJobCoverage(jobId)),
		loss: emptyLoss(),
		observedPhase: input.phase ?? "UNOBSERVED",
		completionCommitted: input.stage === "completion_committed",
		reconciliationTimeline: [],
	}
	incidentsByIdentity.set(identityKey, incident)
	incidentIdToIdentity.set(incidentId, identityKey)
	incidentOrder.push(incidentId)
	enforceRetentionBounds()
	// The opening observation itself is recorded through the SAME
	// dedup path as every later observation.
	return applyObservation(incident, input)
}

/**
 * The MINIMAL detail allowlist — the PUBLIC capture depth.
 *
 * These are the counters and reason codes that make a minimal local
 * incident summary actionable, and NOTHING that could carry user
 * content. Every other key is DROPPED in the public build.
 */
const MINIMAL_DETAIL_KEYS = new Set([
	"holdReason",
	"unresolvedContainmentFailureCount",
	"unconsumedTerminalCount",
	"ownerStillRunning",
	"heldObligation",
	"remainingBlockingJobCount",
])

/**
 * Restrict an observation's detail to the CURRENT capture depth.
 *
 * In `detailed` mode the full (already privacy-safe) detail map is
 * retained. In `minimal` mode only the MINIMAL allowlist survives —
 * every other key is DROPPED, not redacted.
 */
function restrictDetailToCaptureMode(
	detail: AutomaticIncidentCaptureInput["detail"],
): Readonly<Record<string, string | number | boolean | readonly string[] | undefined>> {
	if (!detail) {
		return {}
	}
	if (captureMode === "detailed") {
		return detail
	}
	const out: Record<string, string | number | boolean | readonly string[] | undefined> = {}
	for (const [key, value] of Object.entries(detail)) {
		if (MINIMAL_DETAIL_KEYS.has(key)) {
			out[key] = value
		}
	}
	return out
}

/**
 * Apply one observation to an incident, coalescing an unchanged
 * decision into an occurrence count.
 */
function applyObservation(incident: AutomaticIncident, input: AutomaticIncidentCaptureInput): AutomaticIncident {
	const now = new Date().toISOString()
	const detail = restrictDetailToCaptureMode(input.detail)
	const identityKey = automaticIncidentIdentityKey(incident.identity)
	const blockingJobIds = input.blockingJobIds ? [...input.blockingJobIds] : incident.blockingJobIds
	const dedupKey = observationDedupKey(identityKey, input.stage, input.outcome, detail, blockingJobIds)

	// The stored observation carries the dedup key that was in effect
	// WHEN IT WAS RECORDED. Recomputing it later from the incident's
	// CURRENT blocking set would shift the key whenever the set
	// changes, which would break the coalescing of the unchanged
	// decision that preceded the change.
	const existingIndex = incident.observations.findIndex((o) => o.dedupKey === dedupKey)

	const observations = [...incident.observations]
	if (existingIndex >= 0) {
		const previous = observations[existingIndex]
		observations[existingIndex] = {
			...previous,
			observationCount: previous.observationCount + 1,
			lastSeenAt: now,
		}
	} else {
		observations.push({
			schemaVersion: AUTOMATIC_INCIDENT_SCHEMA_VERSION,
			stage: input.stage,
			outcome: input.outcome,
			timestamp: now,
			observationCount: 1,
			firstSeenAt: now,
			lastSeenAt: now,
			dedupKey,
			detail,
		})
	}

	// The blocking set is REPLACED when the boundary supplies one -
	// the latest computed set is the authoritative one.
	const merged = mergeCoverage(incident.coverage, blockingJobIds)
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01):
	// advance the per-job coverage from the OBSERVED boundary. A
	// coverage field is never inferred from silence: an unobserved
	// link stays `NOT_OBSERVED`.
	//
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
	// (P0-2 — EVIDENCE SEMANTICS): the coverage is advanced from the
	// ORIGINAL boundary detail, NOT from the depth-restricted copy.
	//
	// The detail restriction is a PRIVACY control: it limits what is
	// RETAINED in the exported observation. The coverage verdict is a
	// load-bearing PUBLIC field — the per-job coverage is retained in
	// BOTH the minimal and the detailed depth — so the semantic flags
	// that decide it must be readable at every depth. Restricting them
	// would make the coverage depend on the capture depth, which is
	// exactly the kind of depth-dependent evidence drift the
	// correction forbids.
	const coverage = advanceCoverage(merged, input.stage, input.detail ?? {})
	// The reconciliation timeline is DETAILED forensic evidence: it is
	// retained only in the `detailed` capture depth. The PUBLIC
	// (`minimal`) depth keeps the per-job coverage verdicts, which
	// carry the same reconciliation outcome without the per-attempt
	// forensic detail.
	const reconciliationTimeline =
		input.reconciliation === undefined || captureMode !== "detailed"
			? incident.reconciliationTimeline
			: [...incident.reconciliationTimeline, input.reconciliation]

	const updated: AutomaticIncident = {
		...incident,
		updatedAt: now,
		revision: incident.revision + 1,
		observations,
		blockingJobIds,
		coverage,
		observedPhase: input.phase ?? incident.observedPhase,
		completionCommitted: incident.completionCommitted || input.stage === "completion_committed",
		reconciliationTimeline,
	}
	incidentsByIdentity.set(automaticIncidentIdentityKey(incident.identity), updated)
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
	// (P0-4 — DURABILITY): the updated incident is made DURABLE at the
	// same boundary that observed it, so the persisted artifact can
	// never lag behind the in-memory snapshot.
	notifyDurability(updated)
	return updated
}

/**
 * An empty coverage entry for a blocking job.
 */
function emptyJobCoverage(jobId: string): AutomaticIncidentJobCoverage {
	return {
		jobId,
		originalFailure: "NOT_OBSERVED",
		terminalPublication: "NOT_OBSERVED",
		reconciliationRegistration: "NOT_OBSERVED",
		reconciliationAttempts: "NOT_OBSERVED",
		reconciliationTerminalOutcome: "NOT_OBSERVED",
		controllerPublication: "NOT_OBSERVED",
		c10Reevaluation: "NOT_OBSERVED",
	}
}

/**
 * An empty loss accounting.
 */
export function emptyLoss(): AutomaticIncidentLoss {
	return {
		cifrEvictedCapsules: 0,
		cifrEvictedRecords: 0,
		cifrCapsuleDroppedRecords: 0,
		cifrCheckpointTruncatedCapsules: 0,
		cifrCheckpointTruncatedRecords: 0,
		bjlaProtectedProvenanceEvictions: 0,
		incidentSnapshotTruncations: 0,
		persistenceFailures: 0,
		exportOmissions: 0,
		loss: false,
	}
}

/**
 * The COVERAGE FIELD each observation stage advances.
 *
 * A coverage field is an EXPLICIT observation state. It is advanced
 * ONLY when the corresponding authoritative boundary was actually
 * observed — never inferred from silence. An unobserved link stays
 * `NOT_OBSERVED`, which is exactly the honest answer.
 *
 * The job id is taken from the observation's `detail.jobId` when the
 * boundary reported one; otherwise the stage advances the coverage of
 * EVERY job in the current blocking set, because the stage is a
 * whole-incident boundary (the C10 hold, the C10 re-evaluation, the
 * completion commit).
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-2 — EVIDENCE SEMANTICS): `reconciliation_observed` is DELIBERATELY
 * ABSENT from this map. The pre-correction map routed it to
 * `reconciliationRegistration`, which advanced the registration field
 * for EVERY reconciliation observation — including a bare probe
 * attempt, which proves the reconciliation was already registered by
 * someone else, not that THIS boundary observed a registration. The
 * reconciliation stages now advance their fields explicitly, from the
 * observed `stage`.
 */
const STAGE_COVERAGE_FIELD: Readonly<Partial<Record<AutomaticIncidentStage, keyof AutomaticIncidentJobCoverage>>> = {
	containment_failure_published: "originalFailure",
	controller_reconciliation_published: "controllerPublication",
	c10_reevaluated: "c10Reevaluation",
}

/**
 * The stages that advance the TERMINAL PUBLICATION coverage.
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-2 — EVIDENCE SEMANTICS):
 *
 * The terminal publication is the JOB's own terminal state being
 * published. It is observed at exactly ONE stage: the production
 * boundary that publishes the job's terminal state.
 *
 * The PRE-CORRECTION set advanced `terminalPublication` to `OBSERVED`
 * on `completion_held`, `held_phase_published`, `stalled_no_progress`
 * and `completion_committed`. NONE of those observe the job's own
 * terminal-state publication: they are whole-incident / phase /
 * completion boundaries. Advancing the field on them was a
 * SYNTHETIC-TO-PROVEN promotion — the report could assert that a
 * blocking job's terminal state was published when the publication
 * was never observed.
 *
 * The ONLY stage that observes the job's terminal publication is
 * `containment_failure_published`.
 */
const TERMINAL_PUBLICATION_COVERAGE_STAGES: ReadonlySet<AutomaticIncidentStage> = new Set<AutomaticIncidentStage>([
	"containment_failure_published",
])

/**
 * Advance the coverage for ONE observation.
 *
 * The coverage is a MONOTONIC record of what was OBSERVED. A field
 * that was already `OBSERVED` stays `OBSERVED`; a field that was
 * `EVIDENCE_LOST` is not resurrected by a later observation, because
 * the loss is itself a permanent fact about the evidence.
 */
function advanceCoverage(
	coverage: readonly AutomaticIncidentJobCoverage[],
	stage: AutomaticIncidentStage,
	detail: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>,
): AutomaticIncidentJobCoverage[] {
	const field = STAGE_COVERAGE_FIELD[stage]
	const scopedJobId = typeof detail.jobId === "string" ? detail.jobId : undefined
	// The RECONCILIATION ATTEMPTS and the RECONCILIATION TERMINAL
	// OUTCOME are advanced by the reconciliation observation's own
	// outcome, which the boundary records in `detail`.
	//
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
	// (P0-2 — EVIDENCE SEMANTICS): the terminal outcome advances ONLY
	// when the boundary explicitly marked the observation as a
	// TERMINAL reconciliation stage. The PRE-CORRECTION code accepted
	// ANY non-empty `reconciliationTerminalOutcome` string — and the
	// join's fallback supplied the literal `"OBSERVED"` for every
	// record, including a registration or an ordinary probe attempt.
	// That turned "a reconciliation was registered" into "the
	// reconciliation reached a terminal outcome", which is exactly the
	// synthetic-to-proven promotion the evidence rules prohibit.
	const reconciliationTerminalObserved = detail.reconciliationTerminalObserved === true

	return coverage.map((entry) => {
		const inScope = scopedJobId === undefined ? true : entry.jobId === scopedJobId
		if (!inScope) {
			return entry
		}
		const next = { ...entry }
		const set = (key: keyof AutomaticIncidentJobCoverage, value: AutomaticIncidentCoverageState) => {
			if (next[key] === "EVIDENCE_LOST") {
				// A loss is permanent evidence.
				return
			}
			if (next[key] !== "OBSERVED") {
				next[key] = value
			}
		}
		if (field) {
			// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
			// (P0-1 — PUBLICATION ORDERING): the controller publication
			// field advances ONLY when the publication SUCCEEDED. A
			// recorded publication FAILURE is an observation of a
			// failure, not an observation of a publication, so the
			// field stays `NOT_OBSERVED`.
			if (field !== "controllerPublication" || detail.publicationOutcome === "controller_reconciliation_published") {
				set(field, "OBSERVED")
			}
		}
		if (TERMINAL_PUBLICATION_COVERAGE_STAGES.has(stage)) {
			set("terminalPublication", "OBSERVED")
		}
		if (stage === "reconciliation_observed") {
			// The attempts are observed only when the reconciliation
			// diagnostic actually reported an ATTEMPT. A registration
			// or a skip is NOT an attempt.
			if (detail.reconciliationAttemptObserved === true) {
				set("reconciliationAttempts", "OBSERVED")
			}
			// The terminal outcome is observed only when the
			// reconciliation actually reached a TERMINAL stage. A
			// registration or an ordinary probe attempt is NOT a
			// terminal outcome.
			if (reconciliationTerminalObserved) {
				set("reconciliationTerminalOutcome", "OBSERVED")
			}
			if (detail.reconciliationRegistrationObserved === true) {
				set("reconciliationRegistration", "OBSERVED")
			}
		}
		return next
	})
}

/**
 * Merge the coverage entries for the current blocking set.
 *
 * A job that is NO LONGER in the blocking set keeps its prior coverage
 * (it is still evidence), but the returned list is ordered by the
 * CURRENT blocking set so the exported coverage reads in the same
 * order as the blocking set.
 */
function mergeCoverage(
	prior: readonly AutomaticIncidentJobCoverage[],
	blockingJobIds: readonly string[],
): AutomaticIncidentJobCoverage[] {
	const byJob = new Map(prior.map((c) => [c.jobId, c]))
	const merged: AutomaticIncidentJobCoverage[] = []
	for (const jobId of blockingJobIds) {
		merged.push(byJob.get(jobId) ?? emptyJobCoverage(jobId))
	}
	// Retain the prior entries for jobs that left the blocking set.
	for (const entry of prior) {
		if (!blockingJobIds.includes(entry.jobId)) {
			merged.push(entry)
		}
	}
	return merged
}

/**
 * Enforce the retention bounds: at most
 * `MAX_RETAINED_ANOMALOUS_INCIDENTS` incidents are retained, and the
 * OLDEST incident is evicted first.
 */
function enforceRetentionBounds(): void {
	while (incidentOrder.length > MAX_RETAINED_ANOMALOUS_INCIDENTS) {
		const oldest = incidentOrder.shift()
		if (!oldest) break
		const identityKey = incidentIdToIdentity.get(oldest)
		if (identityKey !== undefined) {
			incidentsByIdentity.delete(identityKey)
			incidentIdToIdentity.delete(oldest)
		}
	}
}

/**
 * The retained incidents, oldest first.
 */
export function getAutomaticIncidents(): readonly AutomaticIncident[] {
	return incidentOrder
		.map((id) => {
			const key = incidentIdToIdentity.get(id)
			return key === undefined ? undefined : incidentsByIdentity.get(key)
		})
		.filter((i): i is AutomaticIncident => i !== undefined)
}

/**
 * The incident for a task, if one is retained.
 *
 * The host resolves the ACTIVE task's incident through this API; the
 * webview NEVER supplies an incident identity.
 */
export function getAutomaticIncidentForTask(taskId: string | undefined): AutomaticIncident | undefined {
	if (taskId === undefined) {
		return undefined
	}
	const matches = getAutomaticIncidents().filter((i) => i.identity.taskId === taskId)
	// The MOST RECENT incident for the task wins; the older ones stay
	// retained for the picker.
	return matches.length > 0 ? matches[matches.length - 1] : undefined
}

/**
 * The incident with the given id, if it is retained.
 */
export function getAutomaticIncidentById(incidentId: string): AutomaticIncident | undefined {
	const key = incidentIdToIdentity.get(incidentId)
	return key === undefined ? undefined : incidentsByIdentity.get(key)
}

/**
 * The incident that owns a SPECIFIC job under a SPECIFIC owner session.
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-1 — PUBLICATION IDENTITY):
 *
 * The pre-correction controller capture resolved the incident with
 * `getAutomaticIncidentForTask(this.task?.taskId)` — the ACTIVE task.
 * A reconciliation for task A that arrived while task B was active
 * was therefore attributed to task B's incident. That is a
 * CROSS-TASK ISOLATION violation, and it silently corrupted the
 * evidence of whichever task happened to be in the foreground.
 *
 * This resolver binds on the ORIGINAL identity the production event
 * carried: the owner session id and the job id. The job must be in the
 * incident's blocking set AND the incident's session must match the
 * event's owner session. Nothing about the ACTIVE task is consulted.
 */
export function getAutomaticIncidentForOwnerJob(input: {
	readonly ownerSessionId: string | undefined
	readonly jobId: string
}): AutomaticIncident | undefined {
	const { ownerSessionId, jobId } = input
	if (!jobId) {
		return undefined
	}
	const candidates = getAutomaticIncidents().filter((incident) => {
		// The job must be a member of the incident's blocking set.
		if (!incident.blockingJobIds.includes(jobId)) {
			return false
		}
		// The owner session must match when BOTH are known. An
		// incident with an UNOBSERVED session cannot claim ownership
		// of an event that names one.
		if (
			typeof ownerSessionId === "string" &&
			typeof incident.identity.sessionId === "string" &&
			ownerSessionId !== incident.identity.sessionId
		) {
			return false
		}
		return true
	})
	if (candidates.length === 0) {
		return undefined
	}
	// The MOST RECENT matching incident wins; the older ones stay
	// retained for the picker.
	return candidates[candidates.length - 1]
}

/**
 * Replace a retained incident with a persisted one (used by the
 * restore path). A persisted incident with a LOWER revision than the
 * in-memory one is rejected so a concurrent older write can never
 * overwrite newer evidence.
 */
export function adoptPersistedIncident(incident: AutomaticIncident): boolean {
	const identityKey = automaticIncidentIdentityKey(incident.identity)
	const existing = incidentsByIdentity.get(identityKey)
	if (existing && existing.revision > incident.revision) {
		return false
	}
	incidentsByIdentity.set(identityKey, incident)
	incidentIdToIdentity.set(incident.incidentId, identityKey)
	if (!incidentOrder.includes(incident.incidentId)) {
		incidentOrder.push(incident.incidentId)
	}
	enforceRetentionBounds()
	return true
}

/**
 * The number of reconciliation records already retained by an
 * incident. Used to keep the join idempotent.
 */
export function automaticIncidentReconciliationRecordCount(incident: AutomaticIncident): number {
	return incident.reconciliationTimeline.length
}

/**
 * The DURABILITY HOOK for the incident manager.
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-4 — DURABILITY):
 *
 * The reconciliation sink forwards observations into this manager
 * ASYNCHRONOUSLY. The pre-correction join updated the in-memory
 * incident but never persisted it, so a reconciliation exhaustion that
 * was the LAST relevant event before an extension-host crash left the
 * persisted incident WITHOUT that exhaustion outcome — the durable
 * artifact and the in-memory snapshot disagreed, and the durable one
 * (the export source) was the weaker.
 *
 * The manager therefore calls this hook after every state-changing
 * mutation. The hook is injected by the host (which owns the storage
 * context) so this module never imports the persistence layer and
 * never creates an import cycle.
 *
 * The hook is invoked with the UPDATED incident. It must never throw;
 * the manager swallows any error it raises.
 */
export type AutomaticIncidentDurabilityHook = (incident: AutomaticIncident) => void

let durabilityHook: AutomaticIncidentDurabilityHook | undefined

/**
 * Install the durability hook. Passing `undefined` removes it.
 */
export function setAutomaticIncidentDurabilityHook(hook: AutomaticIncidentDurabilityHook | undefined): void {
	durabilityHook = hook
}

/**
 * Invoke the durability hook for an updated incident.
 *
 * NEVER throws: a durability failure must not interrupt the caller.
 */
function notifyDurability(incident: AutomaticIncident): void {
	if (!durabilityHook) {
		return
	}
	try {
		durabilityHook(incident)
	} catch {
		// A durability failure MUST NOT interrupt the caller.
	}
}

/**
 * The reconciliation diagnostic stages that are TERMINAL.
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-2 — EVIDENCE SEMANTICS):
 *
 * Only these stages establish that the reconciliation REACHED a
 * terminal outcome. A registration, a skip and an ordinary probe
 * attempt are NOT terminal: the reconciliation was still in flight
 * (or never became eligible) when the attempt was recorded.
 */
const TERMINAL_RECONCILIATION_STAGES: ReadonlySet<string> = new Set<string>([
	"reconciliation_resolved",
	"reconciliation_exhausted",
	"reconciliation_cancelled",
])

/**
 * The reconciliation diagnostic stages that establish that an ATTEMPT
 * was actually made.
 */
const ATTEMPT_RECONCILIATION_STAGES: ReadonlySet<string> = new Set<string>(["reconciliation_attempt"])

/**
 * The reconciliation diagnostic stages that establish that a
 * RECONCILIATION WAS REGISTERED.
 */
const REGISTRATION_RECONCILIATION_STAGES: ReadonlySet<string> = new Set<string>(["reconciliation_registered"])

/**
 * Join reconciliation diagnostic records to the incidents they belong
 * to.
 *
 * A reconciliation record belongs to an incident when BOTH:
 *
 *   - the record's `jobId` is in the incident's blocking set, and
 *   - the record's `ownerSessionId` matches the incident's session
 *     (when both are known).
 *
 * A record for a DIFFERENT job, a DIFFERENT manager, or a DIFFERENT
 * owner is NEVER joined. This is the ACT's adversarial requirement A3
 * ("Reconciliation identity mismatch").
 *
 * Reconciliation observations can PRECEDE the first C10 hold. When
 * that happens, the record is retained in the reconciliation ring and
 * is joined to the incident when the hold opens it.
 *
 * The join is IDEMPOTENT: a record already present in the incident's
 * timeline is not appended again.
 *
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 * (P0-2 — EVIDENCE SEMANTICS):
 *
 * The recorder emits a `stage` field (see
 * `reconciliation-diagnostic-capture.ts`). The PRE-CORRECTION join
 * read `event` / `outcome` instead, so BOTH of its lookups fell
 * through to their fallbacks:
 *
 *   - `outcome` became the literal `"reconciliation_observed"`, and
 *   - `reconciliationTerminalOutcome` became the literal
 *     `"OBSERVED"`.
 *
 * The second fallback is the defect: it asserted a TERMINAL
 * reconciliation outcome for EVERY record, including a registration
 * or an ordinary probe attempt. The join now reads the `stage` field
 * and derives the observation semantics from it.
 */
export function joinReconciliationRecordsToIncidents(
	records: readonly {
		readonly eventSeq?: number
		readonly jobId?: string
		readonly ownerSessionId?: string
		readonly stage?: string
		readonly event?: string
		readonly attempt?: number
		readonly outcome?: string
		readonly reconciliationTerminalOutcome?: string
	}[],
): number {
	if (!captureEnabled) {
		return 0
	}
	let joined = 0
	for (const retainedIncident of getAutomaticIncidents()) {
		let incident = retainedIncident
		const sessionId = incident.identity.sessionId
		const blocking = new Set(incident.blockingJobIds)
		const alreadySeen = new Set(
			incident.reconciliationTimeline.map((raw) => {
				const record = raw as { eventSeq?: number; jobId?: string }
				return `${record.eventSeq ?? ""}|${record.jobId ?? ""}`
			}),
		)
		const additions: unknown[] = []
		const observedJobIds: string[] = []
		for (const record of records) {
			if (!record.jobId || !blocking.has(record.jobId)) {
				// A3: the record belongs to a DIFFERENT job. It is
				// NOT joined to this incident.
				continue
			}
			if (
				typeof record.ownerSessionId === "string" &&
				typeof sessionId === "string" &&
				record.ownerSessionId !== sessionId
			) {
				// A3/A4: the record belongs to a DIFFERENT owner.
				// It is NOT joined to this incident.
				continue
			}
			const key = `${record.eventSeq ?? ""}|${record.jobId}`
			if (alreadySeen.has(key)) {
				continue
			}
			alreadySeen.add(key)
			additions.push(record)
			if (!observedJobIds.includes(record.jobId)) {
				observedJobIds.push(record.jobId)
			}
		}
		if (additions.length === 0) {
			continue
		}
		joined += additions.length
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01):
		// record the reconciliation lifecycle as a REAL OBSERVATION, so
		// the per-job coverage advances from the observed boundary
		// instead of staying `NOT_OBSERVED`.
		//
		// The observation is emitted PER OBSERVED JOB, because the
		// coverage fields are per-job. A job that was not observed is
		// never advanced.
		//
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
		// (P0-2): the per-job observation aggregates EVERY record for
		// that job, so a terminal record is not hidden by the first
		// (non-terminal) record for the same job. The PRE-CORRECTION
		// code used `additions.find(...)`, which took the FIRST record
		// for the job and therefore DISCARDED the later exhaustion /
		// resolution evidence entirely.
		for (const jobId of observedJobIds) {
			const jobRecords = additions.filter((raw) => (raw as { jobId?: string }).jobId === jobId) as readonly {
				readonly eventSeq?: number
				readonly jobId?: string
				readonly stage?: string
				readonly event?: string
				readonly attempt?: number
				readonly outcome?: string
				readonly reconciliationTerminalOutcome?: string
			}[]
			const stages = jobRecords.map((r) => r.stage).filter((s): s is string => typeof s === "string")
			const terminalRecord = jobRecords.find(
				(r) => typeof r.stage === "string" && TERMINAL_RECONCILIATION_STAGES.has(r.stage),
			)
			const attemptObserved = jobRecords.some(
				(r) => typeof r.stage === "string" && ATTEMPT_RECONCILIATION_STAGES.has(r.stage),
			)
			const registrationObserved = jobRecords.some(
				(r) => typeof r.stage === "string" && REGISTRATION_RECONCILIATION_STAGES.has(r.stage),
			)
			const terminalOutcome =
				terminalRecord?.reconciliationTerminalOutcome ??
				terminalRecord?.outcome ??
				(terminalRecord?.stage ? terminalRecord.stage : undefined)
			const updated = applyObservation(incident, {
				identity: incident.identity,
				stage: "reconciliation_observed",
				// The outcome is the OBSERVED STAGE set — never a
				// synthesized "OBSERVED" verdict.
				outcome: stages.length > 0 ? stages.join(",") : "reconciliation_observed",
				detail: {
					jobId,
					attempt: Math.max(0, ...jobRecords.map((r) => (typeof r.attempt === "number" ? r.attempt : 0))),
					originalFailure: jobRecords[0]?.event ?? "UNKNOWN",
					// The terminal outcome is carried ONLY when a terminal
					// stage was actually observed. It is NEVER defaulted.
					...(terminalOutcome !== undefined ? { reconciliationTerminalOutcome: terminalOutcome } : {}),
					reconciliationTerminalObserved: terminalRecord !== undefined,
					reconciliationAttemptObserved: attemptObserved,
					reconciliationRegistrationObserved: registrationObserved,
				},
				blockingJobIds: incident.blockingJobIds,
			})
			incidentsByIdentity.set(automaticIncidentIdentityKey(incident.identity), updated)
			incident = updated
		}
		// The reconciliation timeline is appended EXACTLY ONCE per join,
		// carrying the raw records forward so the per-attempt forensic
		// detail is preserved.
		//
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
		// (P0-2 — PREVENT DUPLICATION OF JOINED RECORDS): the
		// PRE-CORRECTION code appended the FULL `additions` array once
		// PER OBSERVED JOB, so a two-job incident received every record
		// twice. The timeline is now appended once, after the
		// per-job observation loop.
		incident = {
			...incident,
			reconciliationTimeline: [...incident.reconciliationTimeline, ...additions],
		}
		incidentsByIdentity.set(automaticIncidentIdentityKey(incident.identity), incident)
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
		// (P0-4 — DURABILITY): the joined reconciliation evidence is made
		// DURABLE here. The pre-correction join left the persisted
		// artifact behind the in-memory snapshot, so a reconciliation
		// exhaustion that was the last relevant event before an
		// extension-host crash was LOST.
		notifyDurability(incident)
	}
	return joined
}

/**
 * Build the human-readable incident summary from the incident record.
 *
 * The summary states OBSERVATIONS and explicitly states what is NOT
 * established. It never asserts a root cause the evidence does not
 * support.
 */
export function buildAutomaticIncidentSummary(incident: AutomaticIncident): AutomaticIncidentSummary {
	const holdObservation = incident.observations.find((o) => o.stage === "completion_held")
	const blockingJobCount =
		typeof holdObservation?.detail?.unresolvedContainmentFailureCount === "number"
			? holdObservation.detail.unresolvedContainmentFailureCount
			: incident.blockingJobIds.length > 0
				? incident.blockingJobIds.length
				: "UNOBSERVED"
	const unconsumedTerminalCount =
		typeof holdObservation?.detail?.unconsumedTerminalCount === "number"
			? holdObservation.detail.unconsumedTerminalCount
			: "UNOBSERVED"
	const reason = typeof holdObservation?.outcome === "string" ? holdObservation.outcome : "UNOBSERVED"

	// The reconciliation counts are derived ONLY from the retained
	// reconciliation timeline. A job whose reconciliation was never
	// observed is COUNTED as unknown, never as "not exhausted".
	let registered = 0
	let resolved = 0
	let exhausted = 0
	let unknown = 0
	const seenJobs = new Set<string>()
	for (const raw of incident.reconciliationTimeline) {
		const record = raw as {
			stage?: string
			jobId?: string
			skipReason?: string
		}
		if (!record || typeof record.stage !== "string") {
			unknown += 1
			continue
		}
		if (record.stage === "reconciliation_registered") {
			registered += 1
			if (record.jobId) seenJobs.add(record.jobId)
		} else if (record.stage === "reconciliation_resolved") {
			resolved += 1
			if (record.jobId) seenJobs.add(record.jobId)
		} else if (record.stage === "reconciliation_exhausted") {
			exhausted += 1
			if (record.jobId) seenJobs.add(record.jobId)
		} else if (record.stage === "reconciliation_attempt") {
			// An attempt alone is not a terminal outcome.
			if (record.jobId) seenJobs.add(record.jobId)
		} else {
			unknown += 1
		}
	}
	for (const jobId of incident.blockingJobIds) {
		if (!seenJobs.has(jobId)) {
			unknown += 1
		}
	}

	const observed: string[] = []
	const notEstablished: string[] = []

	if (holdObservation) {
		observed.push(`A completion hold was observed (${reason}).`)
	} else {
		notEstablished.push("No completion hold observation was captured for this incident.")
	}
	if (incident.blockingJobIds.length > 0) {
		observed.push(`${incident.blockingJobIds.length} background job(s) were observed blocking completion.`)
	}
	observed.push(`The last observed host phase was ${incident.observedPhase}.`)
	if (incident.completionCommitted) {
		observed.push("The completion was observed committed.")
	} else {
		notEstablished.push("Whether the completion eventually committed was not observed.")
	}
	if (resolved > 0) {
		observed.push(`${resolved} reconciliation(s) were observed resolved on a fresh 'gone' observation.`)
	}
	if (exhausted > 0) {
		observed.push(`${exhausted} reconciliation(s) exhausted their observation budget without a fresh 'gone'.`)
	}
	if (unknown > 0) {
		notEstablished.push(`${unknown} blocking job(s) have no observed reconciliation terminal outcome.`)
	}
	notEstablished.push("Whether the original process groups are alive now was not established by this report.")

	const evidenceSufficient = incident.loss.loss === false && unknown === 0 && incident.coverage.length > 0
	return {
		schemaVersion: AUTOMATIC_INCIDENT_SCHEMA_VERSION,
		incidentId: incident.incidentId,
		trigger: incident.trigger,
		observedPhase: incident.observedPhase,
		completionCommitted: incident.completionCommitted ? "OBSERVED" : "UNOBSERVED",
		hold: {
			reason,
			blockingJobCount,
			unconsumedTerminalCount,
		},
		reconciliation: { registered, resolved, exhausted, unknown },
		evidence: {
			classification: evidenceSufficient ? "CAPTURE_SUFFICIENT" : "CAPTURE_INSUFFICIENT",
			loss: incident.loss.loss,
		},
		observed,
		notEstablished,
	}
}

/**
 * The incident's serialized size in ACTUAL UTF-8 BYTES.
 */
export function automaticIncidentByteLength(incident: AutomaticIncident): number {
	return utf8ByteLength(JSON.stringify(incident))
}

/**
 * Enforce the per-incident byte bound, dropping the OLDEST
 * INTERMEDIATE observations first and preserving the original and
 * terminal causal facts.
 *
 * The dropped count is recorded explicitly - an array is NEVER
 * silently truncated.
 */
export function enforceAutomaticIncidentByteBound(incident: AutomaticIncident): AutomaticIncident {
	if (automaticIncidentByteLength(incident) <= MAX_INCIDENT_BYTES) {
		return incident
	}
	let working = incident
	let truncations = 0
	while (automaticIncidentByteLength(working) > MAX_INCIDENT_BYTES && working.observations.length > 2) {
		// Drop the oldest INTERMEDIATE observation: index 0 is the
		// opening (original) fact and the LAST is the terminal fact.
		working = {
			...working,
			observations: working.observations.filter((_, index) => index !== 1),
		}
		truncations += 1
	}
	return {
		...working,
		loss: {
			...working.loss,
			incidentSnapshotTruncations: working.loss.incidentSnapshotTruncations + truncations,
			loss: true,
		},
	}
}
