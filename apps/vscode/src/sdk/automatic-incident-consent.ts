/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The user-facing CONSENT and RETENTION controls for the automatic
 * incident capture.
 *
 * WHAT THE USER CAN CONTROL
 * -------------------------
 *
 *   1. DETAILED local diagnostics — OPT-IN. The MINIMAL capture is
 *      always armed; this flag only raises the DEPTH. It defaults to
 *      FALSE and is never assumed.
 *
 *   2. DELETE the retained incidents — always available, and it
 *      removes the artifacts from disk AND from memory. The export
 *      path NEVER deletes (dump != clear), but the explicit delete
 *      action does.
 *
 *   3. EXPORT — always available; the retained incidents are written
 *      to a destination the user chooses, and NOTHING is transmitted.
 *
 * NOTHING here performs a network call.
 */

import { rm } from "node:fs/promises"
import { join } from "node:path"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { clearAutomaticIncidents, getAutomaticIncidents } from "./automatic-incident-capture"
import {
	type AutomaticIncidentPersistenceContext,
	automaticIncidentDirectory,
	COMPLETION_INCIDENTS_DIR,
} from "./automatic-incident-persistence"

/**
 * Read the user's EXPLICIT opt-in to DETAILED local diagnostics.
 *
 * The default is FALSE. A read failure is reported honestly and
 * treated as "not opted in" — the detailed depth is never assumed.
 */
export async function readUserDetailedDiagnosticsOptIn(_context?: unknown): Promise<boolean> {
	try {
		const stateManager = StateManager.get()
		return stateManager.getGlobalStateKey("clineDetailedLocalDiagnosticsEnabled") === true
	} catch (error) {
		Logger.warn(
			`[AICE01] could not read the detailed-diagnostics opt-in: ${error instanceof Error ? error.message : String(error)}`,
		)
		return false
	}
}

/**
 * Persist the user's opt-in to DETAILED local diagnostics.
 */
export async function writeUserDetailedDiagnosticsOptIn(enabled: boolean): Promise<void> {
	try {
		StateManager.get().setGlobalState("clineDetailedLocalDiagnosticsEnabled", enabled)
	} catch (error) {
		Logger.warn(
			`[AICE01] could not persist the detailed-diagnostics opt-in: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Delete EVERY retained incident — from memory AND from disk.
 *
 * This is the explicit user action; it is distinct from the export,
 * which never deletes. The result reports how many incidents were
 * removed and how many artifacts could not be removed, so the UI can
 * be honest about a partial deletion.
 */
export async function deleteAllRetainedIncidents(context: AutomaticIncidentPersistenceContext): Promise<{
	readonly deletedCount: number
	readonly failedCount: number
}> {
	const incidents = getAutomaticIncidents()
	let deletedCount = 0
	let failedCount = 0
	for (const incident of incidents) {
		try {
			await rm(automaticIncidentDirectory(context, incident.incidentId), { recursive: true, force: true })
			deletedCount++
		} catch (error) {
			failedCount++
			Logger.warn(
				`[AICE01] could not delete the incident artifact ${incident.incidentId}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
	// The durable index is removed as well: it is a pointer to artifacts
	// that no longer exist.
	try {
		await rm(join(context.globalStorageUri.fsPath, COMPLETION_INCIDENTS_DIR, "index.json"), { force: true })
	} catch (error) {
		Logger.warn(`[AICE01] could not delete the incident index: ${error instanceof Error ? error.message : String(error)}`)
	}
	clearAutomaticIncidents()
	return { deletedCount, failedCount }
}
