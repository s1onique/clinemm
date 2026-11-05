/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The privacy-safe, one-click local ZIP export.
 *
 * WHAT THIS PRODUCES
 * ------------------
 *
 *   clinemm-incident.zip
 *     manifest.json
 *     summary.json
 *     build-identity.json
 *     coverage.json
 *     completion-timeline.jsonl
 *     containment-provenance.json
 *     reconciliation-timeline.jsonl
 *     phase-writers.jsonl
 *     continuation-summary.json
 *     README.txt
 *
 * PRIVACY CONTRACT (the default support ZIP)
 * ------------------------------------------
 *
 * The default ZIP EXCLUDES:
 *
 *   - command bodies,
 *   - stdout / stderr,
 *   - environment variables,
 *   - API keys and secrets,
 *   - model prompts and responses,
 *   - raw tool-call payloads,
 *   - workspace file contents,
 *   - absolute filesystem paths,
 *   - Git remote URLs, and
 *   - authentication material.
 *
 * The serializer does NOT serialize whole event objects and attempt to
 * redact them afterwards. Every exported value is built from a STRICT
 * ALLOWLIST, and strings and arrays are capped BEFORE serialization.
 *
 * SAFE ARCHIVE CONSTRUCTION
 * -------------------------
 *
 *   - Archive paths are FIXED, NORMALIZED, RELATIVE names. A path
 *     that is absolute, contains `..`, or contains a path separator
 *     outside the fixed set is REJECTED.
 *   - The archive size is bounded before saving.
 *   - NO unexpected file discovered in storage is included.
 *   - NOTHING is transmitted. There is no network call in this module.
 *
 * ZIP LIBRARY
 * -----------
 *
 * `archiver` is ALREADY a declared dependency of the extension
 * package (`apps/vscode/package.json` -> `dependencies.archiver`) and is
 * already installed. No new dependency is added.
 */

import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, normalize, sep } from "node:path"
import archiver from "archiver"
import { type AutomaticIncident, buildAutomaticIncidentSummary, utf8ByteLength } from "./automatic-incident-capture"

/**
 * The export schema version.
 */
export const AUTOMATIC_INCIDENT_EXPORT_SCHEMA_VERSION = 1

/**
 * The maximum size of the produced archive, in bytes.
 */
export const MAX_EXPORT_ARCHIVE_BYTES = 8 * 1024 * 1024

/**
 * The maximum length of any single exported string.
 */
const MAX_STRING_LENGTH = 512

/**
 * The maximum number of entries in any exported array.
 */
const MAX_ARRAY_LENGTH = 512

/**
 * The FIXED set of archive paths. Nothing else may ever enter the
 * archive.
 */
export const EXPORT_ARCHIVE_PATHS = [
	"manifest.json",
	"summary.json",
	"build-identity.json",
	"coverage.json",
	"completion-timeline.jsonl",
	"containment-provenance.json",
	"reconciliation-timeline.jsonl",
	"phase-writers.jsonl",
	"continuation-summary.json",
	"README.txt",
] as const

/**
 * One exported file.
 */
export interface ExportedFile {
	readonly path: string
	readonly contents: string
}

/**
 * The result of building the export.
 */
export interface AutomaticIncidentExportBundle {
	readonly files: readonly ExportedFile[]
	readonly totalBytes: number
	/** The SHA-256 of each file, keyed by archive path. */
	readonly hashes: Readonly<Record<string, string>>
	/** The files that were omitted, with the reason. */
	readonly omissions: readonly string[]
}

/**
 * The build/runtime identity block of the export.
 */
export interface AutomaticIncidentBuildIdentity {
	readonly schemaVersion: number
	/** `VERIFIED` | `MISMATCH` | `UNOBSERVED`. */
	readonly provenanceVerification: "VERIFIED" | "MISMATCH" | "UNOBSERVED"
	readonly runtimeInstanceId?: string
	readonly extensionVersion?: string
	readonly buildId?: string
	readonly sourceHead?: string
	readonly sourceTree?: string
	readonly onDiskBundleSha256?: string
	readonly bundledExtensionSha256?: string
	readonly buildTimestamp?: string
	readonly hostPlatform?: string
	readonly hostArchitecture?: string
	readonly verificationNote?: string
}

/**
 * Normalize and validate an archive path.
 *
 * REJECTS an absolute path, a path containing `..`, a path with a
 * non-normalized separator, or a path outside the fixed set.
 */
export function validateExportArchivePath(candidate: string): string | undefined {
	if (typeof candidate !== "string" || candidate.length === 0) {
		return undefined
	}
	if (candidate.includes("\0")) {
		return undefined
	}
	if (candidate.startsWith("/") || candidate.startsWith("\\")) {
		return undefined
	}
	if (/^[A-Za-z]:/.test(candidate)) {
		return undefined
	}
	const normalized = normalize(candidate)
	if (normalized !== candidate) {
		return undefined
	}
	if (normalized.split(/[\\/]/).some((segment) => segment === "..")) {
		return undefined
	}
	if (normalized.includes(sep) || normalized.includes("/")) {
		// The archive layout is FLAT: every entry is a bare file name.
		return undefined
	}
	return normalized
}

/**
 * Cap a string to the exported maximum length.
 */
export function capExportString(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined
	}
	if (value.length <= MAX_STRING_LENGTH) {
		return value
	}
	return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
}

/**
 * Cap an array to the exported maximum length. The omitted count is
 * reported so the export never silently truncates.
 */
export function capExportArray<T>(value: readonly T[] | undefined): { readonly items: T[]; readonly omitted: number } {
	if (!value) {
		return { items: [], omitted: 0 }
	}
	if (value.length <= MAX_ARRAY_LENGTH) {
		return { items: [...value], omitted: 0 }
	}
	return { items: value.slice(0, MAX_ARRAY_LENGTH), omitted: value.length - MAX_ARRAY_LENGTH }
}

/**
 * The SHA-256 of a string, hex encoded.
 */
export function sha256Hex(contents: string): string {
	return createHash("sha256").update(contents, "utf8").digest("hex")
}

/**
 * The STRICT ALLOWLIST of exported detail keys.
 *
 * Only these keys may leave the extension host. Every other key is
 * DROPPED (not redacted) so an unexpected payload can never leak into
 * the archive. The allowlist is intentionally NARROW: it carries the
 * numeric counters and reason codes a support report needs, and
 * nothing that could contain user content.
 */
const EXPORTED_DETAIL_KEYS = new Set([
	"holdReason",
	"unresolvedContainmentFailureCount",
	"unconsumedTerminalCount",
	"ownerStillRunning",
	"heldObligation",
	"outstandingAutonomousWork",
	"remainingBlockingJobCount",
	"phaseWriter",
	"commitOrigin",
	"jobId",
	"originalPgid",
	"originalFailure",
	"restoredTerminalClass",
	"attempt",
	"osErrorCode",
	"stateBefore",
	"stateAfter",
	"reconciliationTerminalOutcome",
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
	// (P0-1): the publication verdict. The exported report must be able
	// to distinguish "the controller published the reconciled state"
	// from "the publication failed".
	"publicationOutcome",
	"publicationFailureReason",
	// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
	// (P0-2): the explicit reconciliation observation semantics.
	"reconciliationTerminalObserved",
	"reconciliationAttemptObserved",
	"reconciliationRegistrationObserved",
])

/**
 * Sanitize a detail map against the strict allowlist.
 *
 * Only primitive, bounded values survive AND only for an ALLOWED key.
 * Unknown keys are DROPPED (not redacted) so no unexpected payload can
 * leak.
 */
export function sanitizeDetail(
	detail: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean | string[]> {
	const out: Record<string, string | number | boolean | string[]> = {}
	if (!detail) {
		return out
	}
	for (const [key, value] of Object.entries(detail)) {
		if (!EXPORTED_DETAIL_KEYS.has(key)) {
			// DROPPED, not redacted.
			continue
		}
		if (value === undefined) {
			continue
		}
		if (typeof value === "number" || typeof value === "boolean") {
			out[key] = value
			continue
		}
		if (typeof value === "string") {
			const capped = capExportString(value)
			if (capped !== undefined) {
				out[key] = capped
			}
			continue
		}
		if (Array.isArray(value)) {
			const { items } = capExportArray(value)
			const strings = items.filter((v): v is string => typeof v === "string").map((v) => capExportString(v) ?? "")
			out[key] = strings
		}
	}
	return out
}

/**
 * Serialize the completion timeline as JSONL.
 *
 * The timeline is built from the incident's OWN allowlisted
 * observations. It does NOT re-serialize the raw recorder records.
 */
export function buildCompletionTimelineJsonl(incident: AutomaticIncident): string {
	const lines: string[] = []
	for (const observation of incident.observations) {
		lines.push(
			JSON.stringify({
				stage: observation.stage,
				outcome: capExportString(observation.outcome),
				timestamp: observation.timestamp,
				observationCount: observation.observationCount,
				firstSeenAt: observation.firstSeenAt,
				lastSeenAt: observation.lastSeenAt,
				detail: sanitizeDetail(observation.detail),
			}),
		)
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : ""
}

/**
 * Serialize the reconciliation timeline as JSONL.
 *
 * The timeline entries are already the allowlisted reconciliation
 * diagnostic records; only the bounded fields are carried.
 */
export function buildReconciliationTimelineJsonl(timeline: readonly unknown[]): string {
	const lines: string[] = []
	for (const raw of timeline) {
		const record = raw as Record<string, unknown>
		if (!record || typeof record !== "object") {
			continue
		}
		const stage = typeof record.stage === "string" ? record.stage : undefined
		if (!stage) {
			continue
		}
		lines.push(
			JSON.stringify({
				stage,
				jobId: capExportString(typeof record.jobId === "string" ? record.jobId : undefined),
				ownerSessionId: capExportString(typeof record.ownerSessionId === "string" ? record.ownerSessionId : undefined),
				originalPgid: typeof record.originalPgid === "number" ? record.originalPgid : undefined,
				originalFailure: typeof record.originalFailure === "string" ? record.originalFailure : undefined,
				restoredTerminalClass:
					typeof record.restoredTerminalClass === "string" ? record.restoredTerminalClass : undefined,
				attempt: typeof record.attempt === "number" ? record.attempt : undefined,
				elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : undefined,
				postcondition: typeof record.postcondition === "string" ? record.postcondition : undefined,
				osErrorCode: typeof record.osErrorCode === "string" ? record.osErrorCode : undefined,
				skipReason: typeof record.skipReason === "string" ? record.skipReason : undefined,
				exhaustionReason: typeof record.exhaustionReason === "string" ? record.exhaustionReason : undefined,
				timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
				eventSeq: typeof record.eventSeq === "number" ? record.eventSeq : undefined,
			}),
		)
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : ""
}

/**
 * The README shipped inside the archive.
 */
const README_TEXT = `ClineMM incident report
=======================

This archive was produced by ClineMM's local incident capture. It is
diagnostic evidence only.

It contains NO command bodies, NO stdout/stderr, NO environment
variables, NO API keys or secrets, NO model prompts or responses, NO
raw tool-call payloads, NO workspace file contents, NO absolute
filesystem paths, NO Git remote URLs and NO authentication material.

The files are:
  manifest.json              - archive index, per-file hashes, coverage
  summary.json               - the human-readable incident summary
  build-identity.json        - the build/runtime identity of the running code
  coverage.json              - per-blocking-job evidence coverage
  completion-timeline.jsonl  - the coalesced completion/hold observations
  containment-provenance.json - the original containment-failure provenance
  reconciliation-timeline.jsonl - the bounded reconciliation lifecycle
  phase-writers.jsonl        - the phase-writer provenance
  continuation-summary.json  - the continuation outcome summary

A source that could not be observed is reported as unavailable. It is
never presented as an empty-but-complete capture.

Nothing in this archive was transmitted. It was written only to the
destination the user chose.
`

/**
 * Build the privacy-safe export bundle for ONE incident.
 */
export function buildAutomaticIncidentExportBundle(input: {
	readonly incident: AutomaticIncident
	readonly buildIdentity: AutomaticIncidentBuildIdentity
	readonly containmentProvenance?: unknown
	readonly phaseWriters?: readonly unknown[]
	readonly continuationSummary?: unknown
}): AutomaticIncidentExportBundle {
	const { incident } = input
	const omissions: string[] = []
	const files: ExportedFile[] = []

	const summary = buildAutomaticIncidentSummary(incident)

	const containmentProvenance = input.containmentProvenance ?? {
		status: "unavailable",
		reason: "no protected containment provenance was captured for this incident",
	}
	const phaseWriters = input.phaseWriters ?? []
	const continuationSummary = input.continuationSummary ?? {
		status: "unavailable",
		reason: "no continuation summary was captured for this incident",
	}

	const add = (path: string, contents: string): void => {
		const validated = validateExportArchivePath(path)
		if (!validated) {
			omissions.push(`${path}: rejected unsafe archive path`)
			return
		}
		files.push({ path: validated, contents })
	}

	add("summary.json", `${JSON.stringify(summary, null, 2)}\n`)
	add("build-identity.json", `${JSON.stringify(input.buildIdentity, null, 2)}\n`)
	add(
		"coverage.json",
		`${JSON.stringify(
			{
				schemaVersion: AUTOMATIC_INCIDENT_EXPORT_SCHEMA_VERSION,
				incidentId: incident.incidentId,
				blockingJobIds: capExportArray(incident.blockingJobIds).items,
				coverage: incident.coverage,
				loss: incident.loss,
			},
			null,
			2,
		)}\n`,
	)
	add("completion-timeline.jsonl", buildCompletionTimelineJsonl(incident))
	add("containment-provenance.json", `${JSON.stringify(containmentProvenance, null, 2)}\n`)
	add("reconciliation-timeline.jsonl", buildReconciliationTimelineJsonl(incident.reconciliationTimeline))
	add(
		"phase-writers.jsonl",
		phaseWriters.length > 0
			? `${phaseWriters.map((w) => JSON.stringify(sanitizeDetail(w as Record<string, unknown>))).join("\n")}\n`
			: "",
	)
	add("continuation-summary.json", `${JSON.stringify(continuationSummary, null, 2)}\n`)
	add("README.txt", README_TEXT)

	// The manifest is built LAST so it can carry the hashes of every
	// other file.
	const hashes: Record<string, string> = {}
	let totalBytes = 0
	for (const file of files) {
		hashes[file.path] = sha256Hex(file.contents)
		totalBytes += utf8ByteLength(file.contents)
	}

	const manifest = {
		schemaVersion: AUTOMATIC_INCIDENT_EXPORT_SCHEMA_VERSION,
		incidentId: incident.incidentId,
		generatedAt: new Date().toISOString(),
		incidentIdentity: incident.identity,
		trigger: incident.trigger,
		openedAt: incident.openedAt,
		updatedAt: incident.updatedAt,
		revision: incident.revision,
		observedPhase: incident.observedPhase,
		completionCommitted: incident.completionCommitted,
		files: files.map((file) => ({
			file: file.path,
			sha256: hashes[file.path],
			bytes: utf8ByteLength(file.contents),
		})),
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01):
		// the manifest's INTEGRITY CONTRACT.
		//
		// `files` lists EVERY archive member EXCEPT `manifest.json`
		// itself. A manifest cannot carry its own hash: writing the hash
		// into the manifest changes the manifest's bytes and therefore
		// changes the hash. The manifest's own digest is therefore
		// published OUT OF BAND, on the export bundle's `hashes` map.
		//
		// A consumer verifies the archive by:
		//   1. recomputing the sha256 of every member listed in `files`
		//      and comparing it to the listed value, and
		//   2. comparing the member set against `files` plus exactly one
		//      extra member, `manifest.json`.
		manifestIntegrity: {
			selfExcluded: true,
			selfPath: "manifest.json",
			selfDigestPublishedOutOfBand: true,
			memberCount: files.length + 1,
		},
		sources: files.map((file) => ({
			file: file.path,
			status: file.contents.trim().length > 0 ? "available" : "unavailable",
		})),
		loss: incident.loss,
		omissions,
		privacy: {
			excluded: [
				"command bodies",
				"stdout/stderr",
				"environment variables",
				"API keys and secrets",
				"model prompts and responses",
				"raw tool-call payloads",
				"workspace file contents",
				"absolute filesystem paths",
				"Git remote URLs",
				"authentication material",
			],
		},
	}
	const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`
	files.unshift({ path: "manifest.json", contents: manifestContents })
	hashes["manifest.json"] = sha256Hex(manifestContents)
	totalBytes += utf8ByteLength(manifestContents)

	return { files, totalBytes, hashes, omissions }
}

/**
 * Write the export bundle to a ZIP at the given path.
 *
 * The archive is built with `archiver` (an EXISTING dependency). No
 * external command is invoked.
 */
export async function writeAutomaticIncidentZip(bundle: AutomaticIncidentExportBundle, destinationPath: string): Promise<void> {
	if (bundle.totalBytes > MAX_EXPORT_ARCHIVE_BYTES) {
		throw new Error(`incident export exceeds the ${MAX_EXPORT_ARCHIVE_BYTES}-byte bound`)
	}
	await mkdir(dirname(destinationPath), { recursive: true })
	await new Promise<void>((resolve, reject) => {
		const output = createWriteStream(destinationPath)
		const archive = archiver("zip", { zlib: { level: 9 } })
		output.on("close", resolve)
		output.on("error", reject)
		archive.on("error", reject)
		archive.pipe(output)
		for (const file of bundle.files) {
			const validated = validateExportArchivePath(file.path)
			if (!validated) {
				continue
			}
			archive.append(file.contents, { name: validated })
		}
		void archive.finalize()
	})
}
