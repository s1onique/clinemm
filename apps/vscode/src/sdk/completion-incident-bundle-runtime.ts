/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01
 *
 * The ONE-command incident-bundle export.
 *
 * `cline.debug.dumpCompletionIncidentBundle` writes a self-contained
 * evidence bundle:
 *
 *   completion-incident-<timestamp>/
 *   ├── manifest.json
 *   ├── barrier-timeline.jsonl
 *   ├── turn-state-writers.jsonl
 *   ├── continuation-events.jsonl
 *   ├── completion-authority.jsonl
 *   ├── header-selection.jsonl
 *   ├── summary.json              (bundle-wide OVERVIEW)
 *   └── incident-summaries.json   (ONE summary per retained incident)
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * `summary.json` is an OVERVIEW and NEVER asserts a single
 * incident's outcome. The per-incident conclusions live in
 * `incident-summaries.json`: one independent summary per retained
 * task capsule. An unrelated task's completion can never satisfy
 * another incident's terminality.
 *
 * REUSE, NOT DUPLICATION
 * ----------------------
 * The bundle does NOT re-collect anything. Every file is built from
 * the EXISTING recorders' read APIs:
 *
 *   - `barrier-timeline.jsonl`   ← the causal flight recorder
 *   - `turn-state-writers.jsonl` ← `@shared/turn-state-writer-provenance`
 *   - `continuation-events.jsonl`← `@shared/bcb-observation-unavailable-capture`
 *                                   + `@/sdk/continuation-cardinality-authority`
 *   - `completion-authority.jsonl`← the causal flight recorder's
 *                                   `completion_authority` stage
 *   - `header-selection.jsonl`   ← `@/sdk/task-header-selector-input-capture`
 *
 * HONESTY RULES
 * -------------
 *   1. A source that is UNAVAILABLE (diagnostic never enabled,
 *      recorder empty) is reported in the manifest as `unavailable` —
 *      never silently omitted.
 *   2. The summary NEVER infers a missing transition from silence.
 *      A value that the evidence does not establish is `UNOBSERVED`.
 *   3. Dropped / evicted records are reported explicitly in the
 *      manifest, so a truncated capture is never presented as
 *      complete.
 *
 * PRIVACY
 * -------
 * The bundle carries identities, predicate values, counts and phase
 * names. It never carries prompt text, credentials, command output,
 * tool arguments, or raw provider payloads.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getBcbObservationUnavailableCaptureRecords } from "@shared/bcb-observation-unavailable-capture"
import {
	COMPLETION_INCIDENT_SCHEMA_VERSION,
	type CompletionIncidentRecord,
	getCompletionIncidentCapsules,
	getCompletionIncidentRecorderStats,
	getCompletionIncidentRecords,
	hasCompletionIncidentEvidenceLoss,
	isCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { getTurnStateWriterProvenanceRecords } from "@shared/turn-state-writer-provenance"
import { getContinuationCardinalityAuthorityCaptureRecords } from "./continuation-cardinality-authority"
import { getTaskHeaderSelectorInputRecords } from "./task-header-selector-input-capture"

/**
 * Narrow structural type for the bits of `vscode.ExtensionContext` the
 * bundle dump touches. Mirrors the other diagnostic runtime contexts
 * structurally — this module does NOT import `vscode` for type
 * information.
 */
export interface CompletionIncidentBundleContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

/**
 * The extension identity the manifest reports. Supplied by the caller
 * (extension.ts owns the version/commit lookup) so this module stays
 * free of `vscode` imports.
 */
export interface CompletionIncidentBundleIdentity {
	readonly extensionVersion: string
	readonly sourceCommit: string | undefined
	readonly captureProfiles: readonly string[]
}

export interface CompletionIncidentBundleManifest {
	readonly schemaVersion: number
	readonly generatedAt: string
	readonly extensionVersion: string
	readonly sourceCommit: string | undefined
	readonly captureProfiles: readonly string[]
	readonly includedSessions: readonly string[]
	readonly includedTaskIds: readonly (string | undefined)[]
	readonly recorderCoverage: {
		readonly flightRecorderEnabled: boolean
		readonly capsuleCount: number
		readonly recordCount: number
		readonly anomalousCapsules: readonly (string | undefined)[]
	}
	readonly droppedRecords: {
		readonly evictedCapsules: number
		readonly evictedRecords: number
		readonly capsuleDroppedRecords: number
		/**
		 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
		 * Capsules dropped by CHECKPOINT TRUNCATION. The persisted
		 * checkpoint is a bounded artifact; when it exceeded its byte
		 * bound the oldest capsules were dropped. That is EVIDENCE
		 * LOSS and it is reported explicitly.
		 */
		readonly checkpointTruncatedCapsules: number
		/** Records dropped by checkpoint truncation. */
		readonly checkpointTruncatedRecords: number
		readonly failedCheckpoints: number
		readonly evidenceLoss: boolean
	}
	readonly sources: readonly {
		readonly file: string
		readonly recorder: string
		readonly status: "available" | "unavailable"
		readonly recordCount: number
	}[]
}

export interface CompletionIncidentBundleSummary {
	/**
	 * The causal identity of the incident this summary describes.
	 *
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Every summary is scoped to ONE incident. `taskId` identifies
	 * the incident's task capsule. `UNOBSERVED` is used only for the
	 * bundle-wide overview, which is NOT an incident conclusion.
	 */
	readonly taskId: string | undefined | "UNOBSERVED"
	/**
	 * The DIAGNOSTIC barrier id of the completion lifecycle this
	 * summary describes.
	 *
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
	 * A task can go through SEVERAL completion lifecycles. Each
	 * lifecycle is a distinct barrier obligation, keyed by
	 * `(sessionId, taskId, epoch)`. The `barrierId` identifies WHICH
	 * lifecycle the summary describes, so two summaries for the SAME
	 * task are never confused with one another.
	 *
	 * `UNOBSERVED` only for the bundle-wide overview, which is NOT an
	 * incident conclusion.
	 */
	readonly barrierId: string | "UNOBSERVED"
	/**
	 * The epoch of the completion lifecycle this summary describes.
	 *
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
	 * The epoch is the lifecycle discriminator WITHIN a task. It
	 * travels with the summary so an operator can see WHICH attempt
	 * concluded and which one is still open.
	 */
	readonly epoch: number | "UNOBSERVED"
	/**
	 * The capture verdict for THIS incident.
	 *
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Three EXPLICIT states:
	 *   - `CAPTURE_SUFFICIENT`   — this incident's own records
	 *     establish a terminal outcome AND the capture was not lossy.
	 *   - `CAPTURE_INSUFFICIENT` — this incident's own records do NOT
	 *     establish a terminal outcome (the incident is unresolved).
	 *   - `CAPTURE_EVIDENCE_LOST` — the capture for this incident was
	 *     lossy, so the evidence CANNOT establish the outcome. This
	 *     is explicitly distinct from "the incident did not finish":
	 *     we do not know.
	 */
	readonly status: "CAPTURE_SUFFICIENT" | "CAPTURE_INSUFFICIENT" | "CAPTURE_EVIDENCE_LOST"
	readonly lastObservedPhase: string
	readonly lastPhaseWriter: string
	readonly lastBarrierOutcome: string
	readonly completionCommitted: boolean | "UNOBSERVED"
	/**
	 * Whether the evidence for THIS incident was lossy.
	 *
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * A lossy capture is NEVER `CAPTURE_SUFFICIENT` — the evidence
	 * does not establish the incident's outcome.
	 */
	readonly evidenceLoss: boolean
	readonly lastBarrierIdentity:
		| {
				readonly sessionId: string
				readonly taskId: string | undefined
				readonly epoch: number
		  }
		| "UNOBSERVED"
	readonly notes: readonly string[]
}

/**
 * The value reported when the evidence does not establish a fact.
 * The summary MUST NOT infer a missing transition from silence.
 */
const UNOBSERVED = "UNOBSERVED"

/**
 * The stages that are ACTUAL barrier stages.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * `continuation` records DELIVERY outcomes (the bounded coalesced
 * continuation was delivered / rejected / suppressed), not barrier
 * outcomes. The previous summary used `stage !== "continuation"` as
 * its barrier-stage filter, which meant an arbitrary non-continuation
 * record (for example a `completion_attempt` "not_held") could be
 * reported as `lastBarrierOutcome`. The barrier stage set is now
 * EXPLICIT.
 */
const BARRIER_STAGES = new Set([
	"completion_attempt",
	"barrier_registration",
	"barrier_reevaluation",
	"early_return",
	"marker_clearance",
	"completion_authority",
])

function isBarrierStage(stage: string): boolean {
	return BARRIER_STAGES.has(stage)
}

function toJsonl(rows: readonly unknown[]): string {
	return rows.map((row) => JSON.stringify(row)).join("\n")
}

/**
 * Group the records into COMPLETION LIFECYCLES, keyed by the
 * diagnostic barrier id.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
 * The previous implementation grouped by `taskId` ONLY. That is
 * too coarse: a SINGLE task can go through SEVERAL completion
 * lifecycles (each a distinct barrier obligation, keyed by
 * `(sessionId, taskId, epoch)`), and a task-scoped group mixes them.
 *
 * Consider one task:
 *
 *   epoch 10 → the completion COMMITs
 *   epoch 11 → the completion is HELD
 *
 * Grouping by task produced ONE summary that selected the LAST
 * commit/withhold anywhere in the task — so the held epoch 11
 * inherited epoch 10's `committed` outcome. That is the SAME
 * wrong-terminal-outcome defect CORRECTION01 fixed ACROSS tasks,
 * reintroduced WITHIN one task.
 *
 * The barrier id is the LIFECYCLE key. It is minted by the recorder
 * and is stable across the whole lifecycle (registration →
 * re-evaluation → clearance → completion) while a NEW epoch mints
 * a NEW id. Records without a barrier id fall back to the task key
 * so a malformed capture still groups deterministically instead of
 * collapsing every record into one bucket.
 */
function groupRecordsByLifecycle(records: readonly CompletionIncidentRecord[]): Map<string, CompletionIncidentRecord[]> {
	const grouped = new Map<string, CompletionIncidentRecord[]>()
	for (const record of records) {
		const key = record.barrierId || `task:${record.taskId ?? "(none)"}`
		const bucket = grouped.get(key)
		if (bucket) {
			bucket.push(record)
		} else {
			grouped.set(key, [record])
		}
	}
	return grouped
}

/**
 * Build ONE LIFECYCLE-scoped summary from the records of ONE
 * completion lifecycle.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The summary is scoped to the incident's OWN records. Another
 * task's completion can never satisfy this incident's terminality.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
 * The summary is scoped to ONE completion LIFECYCLE. Another
 * lifecycle of the SAME task can never satisfy this lifecycle's
 * terminality either. The `records` passed in are already the
 * lifecycle's OWN records, so every fact below is derived from a
 * single barrier obligation.
 */
function buildIncidentSummary(
	taskId: string | undefined,
	records: readonly CompletionIncidentRecord[],
	options: { readonly evidenceLoss: boolean },
): CompletionIncidentBundleSummary {
	const notes: string[] = []
	// The last record that established a phase.
	const phaseRecord = [...records].reverse().find((r) => r.phase !== undefined)
	// The last record from an ACTUAL barrier stage. A continuation
	// delivery outcome is not a barrier outcome.
	const barrierRecord = [...records].reverse().find((r) => isBarrierStage(r.stage))
	// The last record that established a commit (or its withholding).
	//
	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
	// This lookup is scoped to THIS lifecycle's records only, so a
	// commit from an EARLIER lifecycle of the same task can never
	// satisfy this lifecycle's terminality.
	const commitRecord = [...records].reverse().find((r) => r.outcome === "committed" || r.outcome === "withheld")

	const completionCommitted = commitRecord ? commitRecord.outcome === "committed" : ("UNOBSERVED" as const)

	const lastBarrierIdentity = barrierRecord?.markerIdentity
		? {
				sessionId: barrierRecord.markerIdentity.sessionId,
				taskId: barrierRecord.markerIdentity.taskId,
				epoch: barrierRecord.markerIdentity.epoch,
			}
		: ("UNOBSERVED" as const)

	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
	// The lifecycle identity travels WITH the summary. The barrier id
	// is the diagnostic lifecycle key; the epoch is the lifecycle
	// discriminator within the task.
	const barrierId = records.find((r) => r.barrierId)?.barrierId ?? UNOBSERVED
	const epoch = records.length > 0 ? records[records.length - 1]?.epoch : ("UNOBSERVED" as const)

	if (completionCommitted === "UNOBSERVED") {
		notes.push("No completion commit or withhold was observed in this incident's captured evidence.")
	}
	if (options.evidenceLoss) {
		notes.push("The recorder dropped evidence (see manifest.droppedRecords); this incident's timeline may be incomplete.")
	}
	if (records.length === 0) {
		notes.push(
			"No causal records were captured for this incident; the diagnostic may not have been enabled during the incident.",
		)
	}

	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	// Sufficiency is CONSERVATIVE and the loss is EXPLICIT:
	//   1. a lossy capture is `CAPTURE_EVIDENCE_LOST` — the evidence
	//      cannot establish the outcome (we do not know);
	//   2. otherwise the incident's OWN records must establish a
	//      terminal outcome (`CAPTURE_SUFFICIENT`);
	//   3. otherwise the incident is `CAPTURE_INSUFFICIENT`.
	// A lossy capture NEVER asserts sufficiency.
	const status: CompletionIncidentBundleSummary["status"] = options.evidenceLoss
		? "CAPTURE_EVIDENCE_LOST"
		: records.length > 0 && completionCommitted !== "UNOBSERVED"
			? "CAPTURE_SUFFICIENT"
			: "CAPTURE_INSUFFICIENT"

	return {
		taskId,
		barrierId,
		epoch,
		status,
		lastObservedPhase: phaseRecord?.phase ?? UNOBSERVED,
		lastPhaseWriter: phaseRecord?.phaseWriter ?? UNOBSERVED,
		lastBarrierOutcome: barrierRecord?.outcome ?? UNOBSERVED,
		completionCommitted,
		evidenceLoss: options.evidenceLoss,
		lastBarrierIdentity,
		notes,
	}
}

/**
 * Build an INDEPENDENT summary for EVERY retained completion
 * LIFECYCLE.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The previous implementation produced ONE bundle-wide summary that
 * searched across ALL retained task records. With task A held and
 * task B completed, that summary selected task B's `committed`
 * record and reported `{ status: "CAPTURE_SUFFICIENT",
 * completionCommitted: true }` — telling the wrong story about task
 * A's unresolved incident.
 *
 * Each retained incident now gets its own summary. An unrelated
 * task's completion can never satisfy another incident's
 * terminality.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
 * The grouping is now by COMPLETION LIFECYCLE (`barrierId`), not by
 * task. A task that went through several completion attempts now
 * yields one summary PER attempt, and each attempt keeps its OWN
 * terminal outcome. A later lifecycle never inherits an earlier
 * lifecycle's commit.
 */
export function buildCompletionIncidentBundleSummaries(
	records: readonly CompletionIncidentRecord[],
): CompletionIncidentBundleSummary[] {
	const grouped = groupRecordsByLifecycle(records)
	const summaries: CompletionIncidentBundleSummary[] = []
	for (const [, lifecycleRecords] of grouped) {
		// The task id is taken from the RECORDS, not from the group
		// key: the group key is the lifecycle's barrier id, and a
		// task-less capsule still reports `taskId: undefined`.
		const taskId = lifecycleRecords.find((r) => r.taskId !== undefined)?.taskId
		summaries.push(
			buildIncidentSummary(taskId, lifecycleRecords, {
				evidenceLoss: hasCompletionIncidentEvidenceLoss(),
			}),
		)
	}
	return summaries
}

/**
 * Build the BUNDLE-WIDE OVERVIEW.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * This is an OVERVIEW, never an incident conclusion. It does NOT
 * select another task's completion as "the" outcome, and it does
 * not claim terminality. The per-incident conclusions live in
 * `buildCompletionIncidentBundleSummaries()`.
 */
export function buildCompletionIncidentBundleSummary(
	records: readonly CompletionIncidentRecord[],
): CompletionIncidentBundleSummary {
	const notes: string[] = []
	const perIncident = buildCompletionIncidentBundleSummaries(records)
	const evidenceLoss = hasCompletionIncidentEvidenceLoss()

	// The overview reports the AGGREGATE facts only. It never picks
	// one incident's completion as the bundle's outcome.
	const phaseRecord = [...records].reverse().find((r) => r.phase !== undefined)
	const barrierRecord = [...records].reverse().find((r) => isBarrierStage(r.stage))

	if (perIncident.length === 0) {
		notes.push("No causal records were captured; the diagnostic may not have been enabled during the incident.")
	} else {
		notes.push(
			`This is a bundle-wide OVERVIEW of ${perIncident.length} retained incident(s); it does not assert any single incident's outcome.`,
		)
		for (const incident of perIncident) {
			notes.push(
				`Incident ${incident.taskId ?? "(none)"} (epoch ${String(incident.epoch)}): status=${incident.status}, completionCommitted=${String(incident.completionCommitted)}, lastBarrierOutcome=${incident.lastBarrierOutcome}.`,
			)
		}
	}
	if (evidenceLoss) {
		notes.push("The recorder dropped evidence (see manifest.droppedRecords); the timeline may be incomplete.")
	}

	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	// The overview's verdict mirrors the incidents': a lossy capture
	// is explicitly `CAPTURE_EVIDENCE_LOST`, and the bundle is only
	// `CAPTURE_SUFFICIENT` when EVERY retained incident is.
	const status: CompletionIncidentBundleSummary["status"] = evidenceLoss
		? "CAPTURE_EVIDENCE_LOST"
		: perIncident.length > 0 && perIncident.every((i) => i.status === "CAPTURE_SUFFICIENT")
			? "CAPTURE_SUFFICIENT"
			: "CAPTURE_INSUFFICIENT"

	return {
		taskId: UNOBSERVED,
		// The overview spans EVERY retained lifecycle, so it has no
		// single lifecycle identity of its own.
		barrierId: UNOBSERVED,
		epoch: UNOBSERVED,
		status,
		lastObservedPhase: phaseRecord?.phase ?? UNOBSERVED,
		lastPhaseWriter: phaseRecord?.phaseWriter ?? UNOBSERVED,
		lastBarrierOutcome: barrierRecord?.outcome ?? UNOBSERVED,
		// The overview NEVER asserts a completion commit.
		completionCommitted: "UNOBSERVED",
		evidenceLoss,
		lastBarrierIdentity: barrierRecord?.markerIdentity
			? {
					sessionId: barrierRecord.markerIdentity.sessionId,
					taskId: barrierRecord.markerIdentity.taskId,
					epoch: barrierRecord.markerIdentity.epoch,
				}
			: ("UNOBSERVED" as const),
		notes,
	}
}

/**
 * Resolve the source commit for the manifest, when available.
 *
 * An installed VSIX commonly has no `.git` in the extension directory,
 * so this returns `undefined` rather than fabricating an identity.
 * The manifest reports `sourceCommit: undefined` in that case — the
 * field is INFORMATIONAL and its absence is honest.
 *
 * This NEVER throws and NEVER blocks the dump on a slow git call.
 */
export function resolveSourceCommitForIncidentBundle(): string | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("node:child_process") as typeof import("node:child_process")
		const head = cp
			.execSync("git rev-parse HEAD", {
				cwd: __dirname,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			})
			.trim()
		return head.length > 0 ? head : undefined
	} catch {
		return undefined
	}
}

/**
 * Write the incident bundle to `<globalStorageUri>/completion-incident-<timestamp>/`.
 *
 * The dump is unconditional (an operator must always be able to
 * inspect whatever was captured) and NEVER clears the recorders
 * (dump != clear).
 *
 * Returns the absolute path of the bundle directory.
 */
export async function dumpCompletionIncidentBundle(
	context: CompletionIncidentBundleContext,
	identity: CompletionIncidentBundleIdentity,
): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const bundleDir = join(context.globalStorageUri.fsPath, `completion-incident-${timestamp}`)
	await mkdir(bundleDir, { recursive: true })

	const records = getCompletionIncidentRecords()
	const capsules = getCompletionIncidentCapsules()
	const stats = getCompletionIncidentRecorderStats()

	// --- barrier-timeline.jsonl (the causal flight recorder) --------------
	const timelineFile = "barrier-timeline.jsonl"
	await writeFile(join(bundleDir, timelineFile), toJsonl(records), "utf8")

	// --- turn-state-writers.jsonl (existing TSWPD recorder) ---------------
	const writers = getTurnStateWriterProvenanceRecords()
	const writersFile = "turn-state-writers.jsonl"
	await writeFile(join(bundleDir, writersFile), toJsonl(writers), "utf8")

	// --- continuation-events.jsonl (existing CCARD + BCAPT recorders) -----
	const continuationEvents = [
		...getContinuationCardinalityAuthorityCaptureRecords(),
		...getBcbObservationUnavailableCaptureRecords(),
	]
	const continuationFile = "continuation-events.jsonl"
	await writeFile(join(bundleDir, continuationFile), toJsonl(continuationEvents), "utf8")

	// --- completion-authority.jsonl (the authority stage of the timeline) -
	const authority = records.filter((r) => r.stage === "completion_authority")
	const authorityFile = "completion-authority.jsonl"
	await writeFile(join(bundleDir, authorityFile), toJsonl(authority), "utf8")

	// --- header-selection.jsonl (existing header-selector capture) -------
	const headerSelection = getTaskHeaderSelectorInputRecords()
	const headerFile = "header-selection.jsonl"
	await writeFile(join(bundleDir, headerFile), toJsonl(headerSelection), "utf8")

	// --- manifest.json ----------------------------------------------------
	const includedSessions = [...new Set(records.map((r) => r.sessionId))].sort()
	const includedTaskIds = [...new Set(records.map((r) => r.taskId))]
	const manifest: CompletionIncidentBundleManifest = {
		schemaVersion: COMPLETION_INCIDENT_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		extensionVersion: identity.extensionVersion,
		sourceCommit: identity.sourceCommit,
		captureProfiles: identity.captureProfiles,
		includedSessions,
		includedTaskIds,
		recorderCoverage: {
			flightRecorderEnabled: isCompletionIncidentFlightRecorderEnabled(),
			capsuleCount: capsules.length,
			recordCount: records.length,
			anomalousCapsules: capsules.filter((c) => c.anomalous).map((c) => c.taskId),
		},
		droppedRecords: {
			evictedCapsules: stats.evictedCapsules,
			evictedRecords: stats.evictedRecords,
			capsuleDroppedRecords: stats.capsuleDroppedRecords,
			checkpointTruncatedCapsules: stats.checkpointTruncatedCapsules,
			checkpointTruncatedRecords: stats.checkpointTruncatedRecords,
			failedCheckpoints: stats.failedCheckpoints,
			evidenceLoss: hasCompletionIncidentEvidenceLoss(),
		},
		sources: [
			{
				file: timelineFile,
				recorder: "completion-incident-flight-recorder",
				status: records.length > 0 ? "available" : "unavailable",
				recordCount: records.length,
			},
			{
				file: writersFile,
				recorder: "turn-state-writer-provenance",
				status: writers.length > 0 ? "available" : "unavailable",
				recordCount: writers.length,
			},
			{
				file: continuationFile,
				recorder: "continuation-cardinality-authority + bcb-observation-unavailable-capture",
				status: continuationEvents.length > 0 ? "available" : "unavailable",
				recordCount: continuationEvents.length,
			},
			{
				file: authorityFile,
				recorder: "completion-incident-flight-recorder (completion_authority stage)",
				status: authority.length > 0 ? "available" : "unavailable",
				recordCount: authority.length,
			},
			{
				file: headerFile,
				recorder: "task-header-selector-input-capture",
				status: headerSelection.length > 0 ? "available" : "unavailable",
				recordCount: headerSelection.length,
			},
		],
	}
	await writeFile(join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")

	// --- summary.json -----------------------------------------------------
	// The bundle-wide OVERVIEW. It never asserts a single incident's
	// outcome.
	const summary = buildCompletionIncidentBundleSummary(records)
	await writeFile(join(bundleDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8")

	// --- incident-summaries.json -----------------------------------------
	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	// ONE INDEPENDENT SUMMARY PER RETAINED INCIDENT. An unrelated
	// task's completion can never satisfy another incident's
	// terminality — which is the whole point of retaining the
	// evidence across task switches.
	const incidentSummaries = buildCompletionIncidentBundleSummaries(records)
	await writeFile(join(bundleDir, "incident-summaries.json"), JSON.stringify(incidentSummaries, null, 2), "utf8")

	return bundleDir
}
