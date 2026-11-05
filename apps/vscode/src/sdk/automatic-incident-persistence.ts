/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The durable, bounded persistence for automatic incident capture.
 *
 * WHY THIS EXISTS
 * ---------------
 *
 * An incident that only lives in memory is lost the moment the
 * extension host goes away - and the 2026-11-05 LIVE incident is
 * exactly the case where the user could not reproduce the failure
 * after the fact. The ACT requires the incident to survive:
 *
 *   - a task switch,
 *   - a new active session,
 *   - the completion of another task,
 *   - an extension-host restart, and
 *   - ordinary recorder FIFO wrap.
 *
 * STORAGE LAYOUT
 * --------------
 *
 *   <globalStorage>/completion-incidents/
 *     index.json
 *     <incidentId>/
 *       incident.json
 *       evidence.json
 *       coverage.json
 *       build-identity.json
 *
 * The directory name is the INTERNALLY GENERATED incident id - never
 * raw user-supplied text.
 *
 * DURABILITY CONTRACT
 * -------------------
 *
 *   - Each checkpoint is written to a TEMPORARY SIBLING file and
 *     promoted with a rename. A crash before the rename leaves the
 *     previous good artifact intact.
 *   - An incident is NEVER marked persisted until the storage
 *     operation has SUCCEEDED.
 *   - A failed write is counted and reported; it NEVER affects task
 *     execution.
 *   - Recovery rejects incomplete / corrupt data and reports it
 *     honestly rather than silently presenting a partial artifact as
 *     complete.
 *
 * CONCURRENCY
 * -----------
 *
 * Writes are serialized PER INCIDENT so two snapshots for the same
 * incident can never overwrite each other out of order. Two separate
 * incidents may persist concurrently without mixing state.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type AutomaticIncident,
	MAX_INCIDENT_BYTES,
	MAX_RETAINED_ANOMALOUS_INCIDENTS,
	MAX_TOTAL_INCIDENT_BYTES,
	utf8ByteLength,
} from "./automatic-incident-capture"

/**
 * The directory name under the extension's global storage.
 */
export const COMPLETION_INCIDENTS_DIR = "completion-incidents"

/**
 * The index file name.
 */
const INDEX_FILE = "index.json"

/**
 * The incident schema version the persistence layer writes.
 */
export const INCIDENT_PERSISTENCE_SCHEMA_VERSION = 1

/**
 * The narrow structural type for the bits of `vscode.ExtensionContext`
 * this module touches. Mirrors the other diagnostic runtime contexts
 * structurally - this module does NOT import `vscode`.
 */
export interface AutomaticIncidentPersistenceContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

/**
 * One entry in the durable index.
 */
export interface AutomaticIncidentIndexEntry {
	readonly incidentId: string
	readonly taskId: string | undefined
	readonly sessionId: string | "UNOBSERVED"
	readonly epoch: number | "UNOBSERVED"
	readonly openedAt: string
	readonly updatedAt: string
	readonly revision: number
	readonly bytes: number
	readonly trigger: string
}

/**
 * The durable index.
 */
export interface AutomaticIncidentIndex {
	readonly schemaVersion: number
	readonly updatedAt: string
	readonly entries: readonly AutomaticIncidentIndexEntry[]
}

/**
 * The result of a persistence attempt.
 */
export interface AutomaticIncidentPersistResult {
	readonly succeeded: boolean
	readonly bytes: number
	readonly error?: string
}

/**
 * The per-incident write serialization chain. Each incident has its
 * own tail promise, so writes for DIFFERENT incidents proceed
 * concurrently while writes for the SAME incident are serialized.
 */
const writeTails = new Map<string, Promise<unknown>>()

/**
 * The root directory of the incident store.
 */
export function automaticIncidentsRoot(context: AutomaticIncidentPersistenceContext): string {
	return join(context.globalStorageUri.fsPath, COMPLETION_INCIDENTS_DIR)
}

/**
 * The directory of ONE incident.
 */
export function automaticIncidentDirectory(context: AutomaticIncidentPersistenceContext, incidentId: string): string {
	return join(automaticIncidentsRoot(context), incidentId)
}

/**
 * Write a file atomically: write to a temporary sibling, then rename
 * it over the target.
 *
 * The rename is the promotion point. Before it, the previous good
 * artifact is still intact; after it, the new one is.
 */
async function writeFileAtomic(path: string, contents: string): Promise<void> {
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	try {
		await writeFile(tmp, contents, "utf8")
		await rename(tmp, path)
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {})
		throw err
	}
}

/**
 * Read the persisted revision of an incident, if one is readable.
 *
 * Returns `undefined` when the artifact is absent or unreadable — an
 * absent artifact means "nothing has been persisted yet", NOT "the
 * stored revision is zero".
 */
async function readPersistedRevision(incidentPath: string): Promise<number | undefined> {
	try {
		const raw = await readFile(incidentPath, "utf8")
		const parsed = JSON.parse(raw) as { revision?: unknown }
		return typeof parsed?.revision === "number" ? parsed.revision : undefined
	} catch {
		return undefined
	}
}

/**
 * Persist ONE incident. The write is serialized per incident.
 *
 * NEVER throws: a persistence failure is reported in the result, never
 * thrown into the production path.
 */
export async function persistAutomaticIncident(
	context: AutomaticIncidentPersistenceContext,
	incident: AutomaticIncident,
	buildIdentity?: unknown,
): Promise<AutomaticIncidentPersistResult> {
	const previous = writeTails.get(incident.incidentId) ?? Promise.resolve()
	const chained = previous.then(() => writeIncidentNow(context, incident, buildIdentity))
	const tail = chained.catch(() => {})
	writeTails.set(incident.incidentId, tail)
	try {
		return await chained
	} finally {
		// Drop the chain entry when it is still the tail, so the map
		// does not grow without bound.
		if (writeTails.get(incident.incidentId) === tail) {
			writeTails.delete(incident.incidentId)
		}
	}
}

/**
 * The actual write. Called under the per-incident serialization.
 */
async function writeIncidentNow(
	context: AutomaticIncidentPersistenceContext,
	incident: AutomaticIncident,
	buildIdentity?: unknown,
): Promise<AutomaticIncidentPersistResult> {
	try {
		const dir = automaticIncidentDirectory(context, incident.incidentId)
		await mkdir(dir, { recursive: true })

		// ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01):
		// the MONOTONIC REVISION GUARD.
		//
		// The per-incident write chain serializes the writes that go
		// through THIS process, but a snapshot can still arrive out of
		// order (a caller may hand us an older snapshot after a newer
		// one was already written). The on-disk revision is read
		// BEFORE the write, and an older snapshot is REJECTED rather
		// than allowed to overwrite newer evidence.
		const incidentPath = join(dir, "incident.json")
		const existingRevision = await readPersistedRevision(incidentPath)
		if (existingRevision !== undefined && existingRevision > incident.revision) {
			return {
				succeeded: false,
				bytes: 0,
				error: `refused to overwrite a newer persisted revision (${existingRevision} > ${incident.revision})`,
			}
		}

		const incidentJson = JSON.stringify(incident, null, 2)
		const bytes = utf8ByteLength(incidentJson)
		if (bytes > MAX_INCIDENT_BYTES) {
			return {
				succeeded: false,
				bytes,
				error: `incident exceeds the ${MAX_INCIDENT_BYTES}-byte bound`,
			}
		}

		await writeFileAtomic(incidentPath, incidentJson)
		await writeFileAtomic(
			join(dir, "evidence.json"),
			JSON.stringify(
				{
					schemaVersion: INCIDENT_PERSISTENCE_SCHEMA_VERSION,
					incidentId: incident.incidentId,
					observations: incident.observations,
					reconciliationTimeline: incident.reconciliationTimeline,
				},
				null,
				2,
			),
		)
		await writeFileAtomic(
			join(dir, "coverage.json"),
			JSON.stringify(
				{ schemaVersion: INCIDENT_PERSISTENCE_SCHEMA_VERSION, coverage: incident.coverage, loss: incident.loss },
				null,
				2,
			),
		)
		await writeFileAtomic(
			join(dir, "build-identity.json"),
			JSON.stringify(
				buildIdentity ?? { schemaVersion: INCIDENT_PERSISTENCE_SCHEMA_VERSION, status: "UNOBSERVED" },
				null,
				2,
			),
		)

		await updateIndex(context, incident)
		return { succeeded: true, bytes }
	} catch (err) {
		return {
			succeeded: false,
			bytes: 0,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/**
 * Read the durable index. A missing or corrupt index is reported as
 * an empty index with an explicit flag - never as "nothing was ever
 * captured".
 */
export async function readAutomaticIncidentIndex(
	context: AutomaticIncidentPersistenceContext,
): Promise<{ readonly index: AutomaticIncidentIndex; readonly corrupt: boolean }> {
	const empty: AutomaticIncidentIndex = {
		schemaVersion: INCIDENT_PERSISTENCE_SCHEMA_VERSION,
		updatedAt: new Date(0).toISOString(),
		entries: [],
	}
	try {
		const raw = await readFile(join(automaticIncidentsRoot(context), INDEX_FILE), "utf8")
		const parsed = JSON.parse(raw) as AutomaticIncidentIndex
		if (!parsed || !Array.isArray(parsed.entries)) {
			return { index: empty, corrupt: true }
		}
		return { index: parsed, corrupt: false }
	} catch {
		return { index: empty, corrupt: false }
	}
}

/**
 * Update the durable index, applying the retention bounds.
 *
 * The oldest incident is evicted first.
 */
async function updateIndex(context: AutomaticIncidentPersistenceContext, incident: AutomaticIncident): Promise<void> {
	const root = automaticIncidentsRoot(context)
	await mkdir(root, { recursive: true })
	const { index } = await readAutomaticIncidentIndex(context)

	const entries: AutomaticIncidentIndexEntry[] = []
	for (const entry of index.entries) {
		if (entry.incidentId === incident.incidentId) {
			continue
		}
		entries.push(entry)
	}
	entries.push({
		incidentId: incident.incidentId,
		taskId: incident.identity.taskId === "UNOBSERVED" ? undefined : incident.identity.taskId,
		sessionId: incident.identity.sessionId,
		epoch: incident.identity.epoch,
		openedAt: incident.openedAt,
		updatedAt: incident.updatedAt,
		revision: incident.revision,
		bytes: utf8ByteLength(JSON.stringify(incident)),
		trigger: incident.trigger,
	})

	// Enforce the retention bound: at most
	// `MAX_RETAINED_ANOMALOUS_INCIDENTS` incidents are retained.
	while (entries.length > MAX_RETAINED_ANOMALOUS_INCIDENTS) {
		const evicted = entries.shift()
		if (evicted) {
			await rm(automaticIncidentDirectory(context, evicted.incidentId), { recursive: true, force: true }).catch(() => {})
		}
	}

	// Enforce the TOTAL byte bound, oldest first.
	let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
	while (total > MAX_TOTAL_INCIDENT_BYTES && entries.length > 1) {
		const evicted = entries.shift()
		if (!evicted) break
		total -= evicted.bytes
		await rm(automaticIncidentDirectory(context, evicted.incidentId), { recursive: true, force: true }).catch(() => {})
	}

	const next: AutomaticIncidentIndex = {
		schemaVersion: INCIDENT_PERSISTENCE_SCHEMA_VERSION,
		updatedAt: new Date().toISOString(),
		entries,
	}
	await writeFileAtomic(join(root, INDEX_FILE), JSON.stringify(next, null, 2))
}

/**
 * Restore every persisted incident.
 *
 * A corrupt or incomplete incident is SKIPPED and reported honestly -
 * it is never presented as a complete capture.
 */
export async function restoreAutomaticIncidents(
	context: AutomaticIncidentPersistenceContext,
): Promise<{ readonly incidents: AutomaticIncident[]; readonly corruptIncidentIds: readonly string[] }> {
	const incidents: AutomaticIncident[] = []
	const corruptIncidentIds: string[] = []
	try {
		const root = automaticIncidentsRoot(context)
		const entries = await readdir(root, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue
			}
			const dir = join(root, entry.name)
			try {
				const raw = await readFile(join(dir, "incident.json"), "utf8")
				const parsed = JSON.parse(raw) as AutomaticIncident
				if (!parsed || typeof parsed.incidentId !== "string" || !Array.isArray(parsed.observations)) {
					corruptIncidentIds.push(entry.name)
					continue
				}
				incidents.push(parsed)
			} catch {
				corruptIncidentIds.push(entry.name)
			}
		}
	} catch {
		// No incident store yet - nothing to restore.
	}
	return { incidents, corruptIncidentIds }
}

/**
 * Delete every retained incident artifact.
 */
export async function deleteAllAutomaticIncidents(context: AutomaticIncidentPersistenceContext): Promise<void> {
	await rm(automaticIncidentsRoot(context), { recursive: true, force: true }).catch(() => {})
}
