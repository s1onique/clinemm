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
 *   └── summary.json
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
	readonly status: "CAPTURE_SUFFICIENT" | "CAPTURE_INSUFFICIENT"
	readonly lastObservedPhase: string
	readonly lastPhaseWriter: string
	readonly lastBarrierOutcome: string
	readonly completionCommitted: boolean | "UNOBSERVED"
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

function toJsonl(rows: readonly unknown[]): string {
	return rows.map((row) => JSON.stringify(row)).join("\n")
}

/**
 * Build the bundle summary from the recorded causal facts.
 *
 * The summary is purely DERIVED from the records — there is no
 * inference from absence. If no record establishes a fact, the fact
 * is reported as `UNOBSERVED`.
 */
export function buildCompletionIncidentBundleSummary(
	records: readonly CompletionIncidentRecord[],
): CompletionIncidentBundleSummary {
	const notes: string[] = []
	// The last record that established a phase.
	const phaseRecord = [...records].reverse().find((r) => r.phase !== undefined)
	// The last record that reported a barrier outcome (the continuation
	// stage reports delivery outcomes, not barrier outcomes).
	const barrierRecord = [...records].reverse().find((r) => r.stage !== "continuation")
	// The last record that established a commit (or its withholding).
	const commitRecord = [...records].reverse().find((r) => r.outcome === "committed" || r.outcome === "withheld")

	const completionCommitted = commitRecord ? commitRecord.outcome === "committed" : ("UNOBSERVED" as const)

	const lastBarrierIdentity = barrierRecord?.markerIdentity
		? {
				sessionId: barrierRecord.markerIdentity.sessionId,
				taskId: barrierRecord.markerIdentity.taskId,
				epoch: barrierRecord.markerIdentity.epoch,
			}
		: ("UNOBSERVED" as const)

	if (completionCommitted === "UNOBSERVED") {
		notes.push("No completion commit or withhold was observed in the captured evidence.")
	}
	if (hasCompletionIncidentEvidenceLoss()) {
		notes.push("The recorder dropped evidence (see manifest.droppedRecords); the timeline may be incomplete.")
	}
	if (records.length === 0) {
		notes.push("No causal records were captured; the diagnostic may not have been enabled during the incident.")
	}

	const status: CompletionIncidentBundleSummary["status"] =
		records.length > 0 && completionCommitted !== "UNOBSERVED" ? "CAPTURE_SUFFICIENT" : "CAPTURE_INSUFFICIENT"

	return {
		status,
		lastObservedPhase: phaseRecord?.phase ?? UNOBSERVED,
		lastPhaseWriter: phaseRecord?.phaseWriter ?? UNOBSERVED,
		lastBarrierOutcome: barrierRecord?.outcome ?? UNOBSERVED,
		completionCommitted,
		lastBarrierIdentity,
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
	const summary = buildCompletionIncidentBundleSummary(records)
	await writeFile(join(bundleDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8")

	return bundleDir
}
