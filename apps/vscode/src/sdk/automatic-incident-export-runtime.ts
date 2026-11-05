/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The extension-host export runtime.
 *
 * This module is the ONE place where the user-facing export is
 * assembled:
 *
 *   1. resolve the ACTIVE task's retained incident through the
 *      HOST's authority (never a webview-supplied incident id),
 *   2. read the CONSISTENT persisted snapshot,
 *   3. build the privacy-safe export bundle,
 *   4. open the native Save dialog, and
 *   5. write the single ZIP.
 *
 * NOTHING is transmitted. There is no network call in this module.
 *
 * FAILURE HONESTY
 * ---------------
 *
 *   - "Report saved" is NEVER displayed unless the ZIP write
 *     SUCCEEDED.
 *   - When no artifact can be written, the limitation is reported
 *     through the UI.
 *   - A storage failure never affects task execution.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type AutomaticIncident,
	buildAutomaticIncidentSummary,
	getAutomaticIncidentById,
	getAutomaticIncidentForTask,
	getAutomaticIncidents,
} from "./automatic-incident-capture"
import { readContainmentProvenanceForBlockingJobs } from "./automatic-incident-containment-provenance"
import {
	type AutomaticIncidentBuildIdentity,
	type AutomaticIncidentExportBundle,
	buildAutomaticIncidentExportBundle,
	writeAutomaticIncidentZip,
} from "./automatic-incident-export"
import {
	type AutomaticIncidentPersistenceContext,
	automaticIncidentDirectory,
	readAutomaticIncidentIndex,
} from "./automatic-incident-persistence"

/**
 * The result of preparing an export.
 */
export interface AutomaticIncidentExportPreparation {
	readonly ok: boolean
	/** The incident that will be exported, when one was resolved. */
	readonly incident?: AutomaticIncident
	/** The export bundle, when the incident was resolved. */
	readonly bundle?: AutomaticIncidentExportBundle
	/** The candidate incidents, for the picker. */
	readonly candidates: readonly AutomaticIncident[]
	/**
	 * Whether the exported incident was read from the PERSISTED
	 * artifact (as opposed to the in-memory snapshot).
	 */
	readonly persisted?: boolean
	/** Why the preparation failed. */
	readonly error?: string
}

/**
 * Resolve the incident the export should cover.
 *
 * The host resolves the ACTIVE task's incident through its own
 * authority. The webview never supplies an incident identity, and an
 * arbitrary path is never accepted.
 */
export function resolveAutomaticIncidentForExport(input: {
	readonly activeTaskId: string | undefined
	readonly requestedIncidentId?: string
}): AutomaticIncident | undefined {
	if (input.requestedIncidentId) {
		const byId = getAutomaticIncidentById(input.requestedIncidentId)
		if (byId) {
			return byId
		}
	}
	return getAutomaticIncidentForTask(input.activeTaskId)
}

/**
 * Read the CONSISTENT persisted snapshot of an incident.
 *
 * The persisted artifact is the authoritative export source: it is
 * the state that survived the task switch / restart. When it is
 * absent, the in-memory incident is used and the export records that
 * the source was the in-memory snapshot.
 */
export async function readPersistedAutomaticIncident(
	context: AutomaticIncidentPersistenceContext,
	incident: AutomaticIncident,
): Promise<{ readonly incident: AutomaticIncident; readonly persisted: boolean }> {
	try {
		const raw = await readFile(join(automaticIncidentDirectory(context, incident.incidentId), "incident.json"), "utf8")
		const parsed = JSON.parse(raw) as AutomaticIncident
		if (parsed && typeof parsed.incidentId === "string" && Array.isArray(parsed.observations)) {
			// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
			// (P0-4 — DURABILITY): an OLDER persisted revision must never
			// replace a NEWER in-memory snapshot.
			//
			// The pre-correction code returned the persisted artifact
			// unconditionally. A write that was still in flight (or a
			// write refused by the monotonic revision guard) could
			// therefore leave an OLDER snapshot on disk, and the export
			// — which reads the persisted artifact — would then export
			// the WEAKER evidence while the in-memory snapshot held
			// the newer one. The export is the user-facing artifact; it
			// must never be weaker than the live snapshot.
			if (typeof parsed.revision === "number" && parsed.revision < incident.revision) {
				return { incident, persisted: false }
			}
			return { incident: parsed, persisted: true }
		}
	} catch {
		// No persisted snapshot (or it is unreadable). The in-memory
		// incident is used; the export reports the source.
	}
	return { incident, persisted: false }
}

/**
 * Prepare the export for the active task.
 */
export async function prepareAutomaticIncidentExport(input: {
	readonly context: AutomaticIncidentPersistenceContext
	readonly activeTaskId: string | undefined
	readonly requestedIncidentId?: string
	readonly buildIdentity: AutomaticIncidentBuildIdentity
}): Promise<AutomaticIncidentExportPreparation> {
	const candidates = getAutomaticIncidents()
	const resolved = resolveAutomaticIncidentForExport({
		activeTaskId: input.activeTaskId,
		requestedIncidentId: input.requestedIncidentId,
	})
	if (!resolved) {
		return {
			ok: false,
			candidates,
			error:
				candidates.length > 0
					? "No retained incident matches the current task. Select one of the retained incidents."
					: "No retained incident is available for this task.",
		}
	}
	try {
		const { incident, persisted } = await readPersistedAutomaticIncident(input.context, resolved)
		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
		// (P0-3 — SOURCE-BOUND EXPORT): the containment-provenance block
		// is built from the REAL protected CFPR01 records, joined on the
		// incident's EXACT blocking job ids.
		//
		// The pre-correction code derived the block's availability from
		// the incident's OWN persistence (`persisted ? "available" :
		// "unavailable"`), which says nothing about whether the
		// protected containment records were retrieved. The report
		// therefore CLAIMED availability while carrying no source
		// evidence. The block is now read from the protected store; a
		// store that holds no records for the incident's blocking jobs
		// yields `UNAVAILABLE_FROM_TRACE`.
		const containmentProvenance = readContainmentProvenanceForBlockingJobs(incident.blockingJobIds)
		const bundle = buildAutomaticIncidentExportBundle({
			incident,
			buildIdentity: input.buildIdentity,
			containmentProvenance,
		})
		return { ok: true, incident, bundle, candidates, persisted }
	} catch (err) {
		return {
			ok: false,
			candidates,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/**
 * Write the prepared export to the chosen destination.
 */
export async function writeAutomaticIncidentExport(
	bundle: AutomaticIncidentExportBundle,
	destinationPath: string,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
	try {
		await writeAutomaticIncidentZip(bundle, destinationPath)
		return { ok: true }
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * A concise, privacy-safe PREVIEW of the export for the user.
 *
 * The preview states what is INCLUDED and what is EXCLUDED. It never
 * contains a sensitive value.
 */
export function buildAutomaticIncidentExportPreview(incident: AutomaticIncident): string {
	const summary = buildAutomaticIncidentSummary(incident)
	const lines: string[] = []
	lines.push(`Incident: ${summary.incidentId}`)
	lines.push(`Trigger: ${summary.trigger}`)
	lines.push(`Last observed phase: ${summary.observedPhase}`)
	lines.push(`Completion committed: ${summary.completionCommitted}`)
	if (typeof summary.hold.blockingJobCount === "number") {
		lines.push(`Blocking background jobs: ${summary.hold.blockingJobCount}`)
	}
	lines.push(
		`Reconciliation: ${summary.reconciliation.registered} registered, ${summary.reconciliation.resolved} resolved, ` +
			`${summary.reconciliation.exhausted} exhausted, ${summary.reconciliation.unknown} unknown`,
	)
	lines.push(`Evidence: ${summary.evidence.classification}${summary.evidence.loss ? " (with declared evidence loss)" : ""}`)
	lines.push("")
	lines.push("The report contains only diagnostic identities, counters, verdicts and build identity.")
	lines.push("It excludes command text, output, environment variables, secrets, model content and file contents.")
	lines.push("It is written only to the destination you choose. Nothing is uploaded.")
	return lines.join("\n")
}

/**
 * The HOST-ABSTRACTED dialog surface for the one-click export.
 *
 * The export flow is shared by the Command Palette entry point
 * (`cline.reportTaskProblem`, registered by `extension.ts`) and the
 * webview request handler. Both supply their OWN dialog callbacks so
 * neither layer has to reach for `vscode.commands.executeCommand`
 * (which the repository's lint rules forbid outside the VS Code
 * entry point) or for the `vscode` module directly (which the
 * standalone core cannot provide).
 */
export interface AutomaticIncidentExportDialogs {
	/**
	 * Show a MODAL confirmation carrying the privacy-safe preview.
	 * Returns the chosen action label, or `undefined` when the user
	 * dismissed the dialog.
	 */
	readonly confirm: (message: string, confirmLabel: string) => Promise<string | undefined>
	/**
	 * Open the NATIVE Save dialog. Returns the chosen destination path,
	 * or `undefined` when the user cancelled.
	 */
	readonly chooseDestination: (options: { readonly title: string; readonly defaultPath: string }) => Promise<string | undefined>
	/**
	 * Report a failure to the user.
	 */
	readonly reportError: (message: string) => void | Promise<void>
	/**
	 * Report a success to the user.
	 */
	readonly reportSuccess: (message: string) => void | Promise<void>
}

/**
 * The outcome of the one-click export flow.
 */
export type AutomaticIncidentExportOutcome =
	| { readonly status: "saved"; readonly destinationPath: string }
	| { readonly status: "cancelled" }
	| { readonly status: "no_incident"; readonly message: string }
	| { readonly status: "failed"; readonly message: string }

/**
 * Run the ONE-CLICK LOCAL EXPORT flow.
 *
 * The flow is:
 *
 *   1. resolve the ACTIVE task's retained incident through the HOST's
 *      authority (never a webview-supplied incident id),
 *   2. read the CONSISTENT persisted snapshot,
 *   3. show a concise privacy-safe preview and ask for confirmation,
 *   4. open the native Save dialog, and
 *   5. write the single ZIP.
 *
 * NOTHING is transmitted. There is no network call on this path.
 *
 * FAILURE HONESTY
 * ---------------
 *
 *   - The success message is emitted ONLY after the ZIP write
 *     SUCCEEDED.
 *   - When no artifact can be written, the limitation is reported
 *     through the UI.
 *   - A storage failure never affects task execution.
 */
export async function runAutomaticIncidentExport(input: {
	readonly context: AutomaticIncidentPersistenceContext
	readonly activeTaskId: string | undefined
	readonly buildIdentity: AutomaticIncidentBuildIdentity
	readonly dialogs: AutomaticIncidentExportDialogs
}): Promise<AutomaticIncidentExportOutcome> {
	try {
		const prepared = await prepareAutomaticIncidentExport({
			context: input.context,
			activeTaskId: input.activeTaskId,
			buildIdentity: input.buildIdentity,
		})
		if (!prepared.ok || !prepared.bundle || !prepared.incident) {
			const message = prepared.error ?? "No retained incident is available for this task."
			await input.dialogs.reportError(message)
			return { status: "no_incident", message }
		}

		const preview = buildAutomaticIncidentExportPreview(prepared.incident)
		const proceed = await input.dialogs.confirm(
			`ClineMM: Report Task Problem — ${prepared.incident.incidentId}. ${preview}`,
			"Save report",
		)
		if (proceed !== "Save report") {
			return { status: "cancelled" }
		}

		const destinationPath = await input.dialogs.chooseDestination({
			title: "Save ClineMM incident report",
			defaultPath: `clinemm-incident-${prepared.incident.incidentId}.zip`,
		})
		if (!destinationPath) {
			return { status: "cancelled" }
		}

		const written = await writeAutomaticIncidentExport(prepared.bundle, destinationPath)
		if (!written.ok) {
			const message = `the incident report could not be written: ${written.error ?? "unknown error"}`
			await input.dialogs.reportError(message)
			return { status: "failed", message }
		}

		await input.dialogs.reportSuccess(`incident report saved → ${destinationPath}`)
		return { status: "saved", destinationPath }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		await input.dialogs.reportError(`the incident report could not be produced: ${message}`)
		return { status: "failed", message }
	}
}

/**
 * The retained incident descriptors for the picker.
 */
export async function listAutomaticIncidentsForExport(context: AutomaticIncidentPersistenceContext): Promise<
	readonly {
		readonly incidentId: string
		readonly taskId: string | undefined
		readonly updatedAt: string
		readonly trigger: string
	}[]
> {
	const { index } = await readAutomaticIncidentIndex(context)
	return index.entries.map((entry) => ({
		incidentId: entry.incidentId,
		taskId: entry.taskId,
		updatedAt: entry.updatedAt,
		trigger: entry.trigger,
	}))
}
