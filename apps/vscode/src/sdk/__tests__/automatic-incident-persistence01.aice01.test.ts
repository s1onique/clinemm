/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The PERSISTENCE acceptance suite.
 *
 * RED-03 — "Restart loses the incident" — reproduced at ENTRY_HEAD:
 * the persisted artifact was a bare flat checkpoint with NO incident
 * identity, NO incident-scoped directory and NO export path.
 *
 * This suite now asserts the GREEN behavior:
 *
 *   G8   task switching preserves the incident
 *   G9   an extension-host restart restores the persisted incidents
 *   G10  storage bounds and explicit eviction counters are enforced
 *   G11  disk failure / corruption cannot change completion behavior
 *   A5   an older snapshot finishing late never overwrites a newer one
 *
 * The persistence is exercised against the REAL filesystem. The
 * "restart" is a genuine fresh manager over the SAME storage
 * directory — never a shared in-memory singleton.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	adoptPersistedIncident,
	captureAutomaticIncident,
	clearAutomaticIncidents,
	getAutomaticIncidentById,
	getAutomaticIncidents,
	setAutomaticIncidentCaptureEnabled,
} from "@/sdk/automatic-incident-capture"
import {
	automaticIncidentDirectory,
	COMPLETION_INCIDENTS_DIR,
	persistAutomaticIncident,
	readAutomaticIncidentIndex,
	restoreAutomaticIncidents,
} from "@/sdk/automatic-incident-persistence"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK_A = "task-a-1793899291382"
const SESSION_A = "session-a"

let tmp: string

const context = () => ({ globalStorageUri: { fsPath: tmp } })

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-persist-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	clearAutomaticIncidents()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

const openIncident = (taskId = TASK_A, sessionId = SESSION_A) =>
	captureAutomaticIncident({
		identity: {
			sessionId,
			taskId,
			epoch: 4,
			barrierId: `barrier-${taskId}`,
			coordinatorInstanceId: "coord-test",
			extensionHostInstanceId: "host-test",
		},
		stage: "completion_held",
		outcome: "unresolved_containment_failure",
		detail: { unresolvedContainmentFailureCount: 2, unconsumedTerminalCount: 1 },
		blockingJobIds: ["cmd_mw3ttmsis0wqw9y7", "cmd_mw3ump8m1o4iwiwj"],
	})

describe("AICE01 G9 — the incident survives an extension-host restart", () => {
	it("G9 — a persisted incident is restored by a FRESH manager over the SAME storage", async () => {
		const incident = openIncident()
		expect(incident).toBeDefined()
		const incidentId = incident?.incidentId ?? ""

		const persisted = await persistAutomaticIncident(context(), incident!)
		expect(persisted.succeeded).toBe(true)
		expect(persisted.bytes).toBeGreaterThan(0)

		// --- THE RESTART -------------------------------------------
		// The in-memory state is GONE, exactly as it would be after the
		// extension host exits.
		clearAutomaticIncidents()
		expect(getAutomaticIncidents()).toHaveLength(0)

		// A FRESH manager reads the SAME storage directory.
		const restored = await restoreAutomaticIncidents(context())
		expect(restored.corruptIncidentIds).toHaveLength(0)
		expect(restored.incidents).toHaveLength(1)
		expect(restored.incidents[0].incidentId).toBe(incidentId)
		expect(restored.incidents[0].identity.taskId).toBe(TASK_A)
		expect(restored.incidents[0].blockingJobIds).toEqual(["cmd_mw3ttmsis0wqw9y7", "cmd_mw3ump8m1o4iwiwj"])

		// The restored incident is addressable and adoptable.
		expect(adoptPersistedIncident(restored.incidents[0])).toBe(true)
		expect(getAutomaticIncidentById(incidentId)).toBeDefined()
	})

	it("G9 — the incident-scoped layout is created with the ACT's file set", async () => {
		const captured = openIncident()
		expect(captured).toBeDefined()
		const incident = captured!
		await persistAutomaticIncident(context(), incident)

		const root = join(tmp, COMPLETION_INCIDENTS_DIR)
		expect(existsSync(root)).toBe(true)
		expect(existsSync(join(root, "index.json"))).toBe(true)
		const incidentDir = automaticIncidentDirectory(context(), incident?.incidentId)
		expect(existsSync(incidentDir)).toBe(true)
		const files = readdirSync(incidentDir).sort()
		expect(files).toEqual(["build-identity.json", "coverage.json", "evidence.json", "incident.json"])
	})

	it("G8 — a task switch preserves the incident for the task being LEFT", async () => {
		const incidentA = openIncident(TASK_A, SESSION_A)
		await persistAutomaticIncident(context(), incidentA!)

		// The user switches to another task.
		const incidentB = openIncident("task-b", "session-b")
		await persistAutomaticIncident(context(), incidentB!)

		// Task A's incident is STILL addressable.
		const restored = await restoreAutomaticIncidents(context())
		const ids = restored.incidents.map((i) => i.incidentId).sort()
		expect(ids).toEqual([incidentA?.incidentId, incidentB?.incidentId].sort())
	})
})

describe("AICE01 G10/A5/A6 — bounds, ordering and failure handling", () => {
	it("G10 — the retained-incident bound is enforced and the oldest is evicted", async () => {
		for (let i = 0; i < 7; i++) {
			const incident = openIncident(`task-${i}`, `session-${i}`)
			await persistAutomaticIncident(context(), incident!)
		}
		const { index } = await readAutomaticIncidentIndex(context())
		expect(index.entries.length).toBeLessThanOrEqual(4)
		// The OLDEST was evicted: only the newest remain.
		const taskIds = index.entries.map((e) => e.taskId).sort()
		expect(taskIds).toEqual(["task-3", "task-4", "task-5", "task-6"])
	})

	it("A5 — an older snapshot finishing late NEVER overwrites a newer one", async () => {
		const captured = openIncident()
		expect(captured).toBeDefined()
		const incident = captured!
		const stale = { ...incident, revision: incident.revision, updatedAt: incident.updatedAt }
		const fresh = { ...incident, revision: incident.revision + 5 }

		// The stale snapshot arrives AFTER the fresh one.
		await persistAutomaticIncident(context(), fresh)
		await persistAutomaticIncident(context(), stale)

		const restored = await restoreAutomaticIncidents(context())
		expect(restored.incidents[0].revision).toBe(fresh.revision)
	})

	it("A5 — an adopted stale incident is REJECTED by the revision check", async () => {
		const captured = openIncident()
		expect(captured).toBeDefined()
		const incident = captured!
		const fresh = { ...incident, revision: incident.revision + 5 }
		expect(adoptPersistedIncident(fresh)).toBe(true)
		// The stale one cannot overwrite the newer in-memory state.
		expect(adoptPersistedIncident({ ...incident, revision: incident.revision })).toBe(false)
		expect(getAutomaticIncidentById(incident.incidentId)?.revision).toBe(fresh.revision)
	})

	it("A6 — a corrupt artifact is SKIPPED and reported honestly", async () => {
		const captured = openIncident()
		expect(captured).toBeDefined()
		const incident = captured!
		await persistAutomaticIncident(context(), incident)
		// Corrupt the artifact.
		writeFileSync(join(automaticIncidentDirectory(context(), incident?.incidentId), "incident.json"), "{ not json", "utf8")

		const restored = await restoreAutomaticIncidents(context())
		expect(restored.incidents).toHaveLength(0)
		expect(restored.corruptIncidentIds).toContain(incident.incidentId)
	})

	it("A6 — a write into a MISSING directory fails WITHOUT throwing", async () => {
		const incident = openIncident()
		const brokenContext = { globalStorageUri: { fsPath: join(tmp, "does", "not", "exist", "\0invalid") } }
		const result = await persistAutomaticIncident(brokenContext, incident!)
		// The failure is REPORTED, never thrown into the task path.
		expect(result.succeeded).toBe(false)
		expect(result.error).toBeTruthy()
	})

	it("A6 — a write into an unwritable path fails WITHOUT throwing", async () => {
		const incident = openIncident()
		// A path whose parent is a FILE, not a directory: `mkdir`
		// fails with ENOTDIR.
		writeFileSync(join(tmp, "blocker"), "x", "utf8")
		const blocked = { globalStorageUri: { fsPath: join(tmp, "blocker", "nested") } }
		const result = await persistAutomaticIncident(blocked, incident!)
		expect(result.succeeded).toBe(false)
		expect(result.error).toBeTruthy()
	})

	it("G11 — the persisted incident.json is parseable and carries the loss accounting", async () => {
		const captured = openIncident()
		expect(captured).toBeDefined()
		const incident = captured!
		await persistAutomaticIncident(context(), incident)
		const raw = readFileSync(join(automaticIncidentDirectory(context(), incident?.incidentId), "incident.json"), "utf8")
		const parsed = JSON.parse(raw)
		expect(parsed.incidentId).toBe(incident.incidentId)
		expect(parsed.loss).toBeDefined()
		expect(parsed.loss.loss).toBe(false)
		expect(parsed.coverage).toHaveLength(2)
	})
})
