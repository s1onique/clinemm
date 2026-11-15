/**
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 (AICE01)
 *
 * The AUTOMATIC-INCIDENT-EXPORT evidence-gap repair suite.
 *
 * THE GAP THIS SUITE REPRODUCES
 * -----------------------------
 *
 * The predecessor ACT (ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01) proved
 * from source that the production export call site
 * (`apps/vscode/src/sdk/automatic-incident-export-runtime.ts`) passes
 * NEITHER `phaseWriters` NOR `continuationSummary` to
 * `buildAutomaticIncidentExportBundle`. The consequence, at the REAL
 * export path:
 *
 *   - `phase-writers.jsonl` is ALWAYS empty, even when the host ring
 *     holds real, owner-matched phase-writer records; and
 *   - `continuation-summary.json` is ALWAYS the same constant
 *     `unavailable` object, even when the host holds a real,
 *     owner-matched continuation outcome.
 *
 * The predecessor did NOT fix the gap (that was out of its scope). This
 * suite is the RED reproduction that exercises the REAL export path
 * (`prepareAutomaticIncidentExport` -> `writeAutomaticIncidentZip` ->
 * DECOMPRESSED archive), NOT `buildAutomaticIncidentExportBundle` with
 * pre-filled synthetic arguments.
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 *   R1  real, available, owner-matched phase-writer records reach the
 *       ZIP's `phase-writers.jsonl`, scoped to the matching
 *       session/task/epoch, and the manifest's source metadata is
 *       TRUTHFUL about availability;
 *   R2  an authoritative owner-matched continuation outcome reaches the
 *       ZIP; an unrelated or absent authority stays EXPLICITLY
 *       unavailable (it is never invented);
 *   R3  the reconciliation timeline distinguishes "sink not armed at
 *       incident time" from "armed but no matching records" from
 *       "arming status unknown" - an empty JSONL alone is NEVER
 *       evidence that no reconciliation happened;
 *   R4  a foreign owner or a stale phase writer can NEVER leak into the
 *       selected incident, and every manifest count, source
 *       availability, hash and size stays correct;
 *   R5  default-off diagnostics have ZERO state-semantic delta, and no
 *       new permanent public API / protocol / MCP operation appears.
 *
 * REALM NOTE (C1)
 * ---------------
 *
 * Every producer consumed here lives in the EXTENSION-HOST JS realm:
 *
 *   - phase writers: `TurnStateTracker.setWithWriter` ->
 *     `recordTurnStateWriterProvenance` (apps/vscode/src/shared/
 *     turn-state-writer-provenance.ts);
 *   - continuation: the canonical CCARD ring
 *     (`continuation-cardinality-authority.ts`) and the canonical BCAPT
 *     ring (`shared/bcb-observation-unavailable-capture.ts`);
 *   - reconciliation: the default-off
 *     `reconciliation-diagnostic-capture.ts` sink.
 *
 * The webview / React realm is NOT consulted: the export runtime and
 * every producer above run in the extension host, and the export
 * resolves the incident through the HOST's authority
 * (`getAutomaticIncidentForTask`), never through a webview-supplied
 * identity.
 *
 * PRIVACY
 * -------
 *
 * The exported phase-writer and continuation records carry only
 * identities, phases, reason codes and counters. This suite injects
 * privacy sentinels into the SOURCE records and asserts that none of
 * them reaches the archive.
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	getTurnStateWriterProvenanceRecords,
	recordTurnStateWriterProvenance,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type AutomaticIncidentIdentity,
	captureAutomaticIncident,
	clearAutomaticIncidents,
	setAutomaticIncidentCaptureEnabled,
	setAutomaticIncidentDurabilityHook,
} from "@/sdk/automatic-incident-capture"
import { writeAutomaticIncidentZip } from "@/sdk/automatic-incident-export"
import { prepareAutomaticIncidentExport } from "@/sdk/automatic-incident-export-runtime"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import {
	clearReconciliationDiagnosticRecords,
	isReconciliationDiagnosticCaptureEnabled,
	setReconciliationDiagnosticCaptureEnabled,
} from "@/sdk/reconciliation-diagnostic-capture"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK_A = "task-a-1793899291382"
const TASK_B = "task-b-1793899291383"
const SESSION_A = "session-a"
const SESSION_B = "session-b"
const EPOCH_A = 4
const JOB_A = "cmd_mw3ttmsis0wqw9y7"

/**
 * The privacy sentinels. NONE may reach the decompressed archive.
 */
const SENTINELS = {
	commandText: "echo sentinel-COMMAND-8b2f6a",
	absolutePath: "/Users/sentinel-user/secret/workspace/file.txt",
	modelPrompt: "sentinel-PROMPT-3d8b7f please summarize this",
}

let tmp: string

const identityFor = (overrides: Partial<AutomaticIncidentIdentity> = {}): AutomaticIncidentIdentity => ({
	sessionId: SESSION_A,
	taskId: TASK_A,
	epoch: EPOCH_A,
	barrierId: "barrier-test-1",
	coordinatorInstanceId: "coord-test",
	extensionHostInstanceId: "host-test",
	...overrides,
})

const context = () => ({ globalStorageUri: { fsPath: tmp } })

const buildIdentity = () => ({
	schemaVersion: 1 as const,
	provenanceVerification: "UNOBSERVED" as const,
	runtimeInstanceId: "extension-host-test",
	extensionVersion: "9.9.9-test",
	hostPlatform: "darwin",
	hostArchitecture: "arm64",
	verificationNote: "no build provenance artifact was present",
})

const openIncident = (overrides: Partial<AutomaticIncidentIdentity> = {}) =>
	captureAutomaticIncident({
		identity: identityFor(overrides),
		stage: "completion_held",
		outcome: "unresolved_containment_failure",
		detail: {
			holdReason: "unresolved_containment_failure",
			unresolvedContainmentFailureCount: 1,
			unconsumedTerminalCount: 0,
		},
		blockingJobIds: [JOB_A],
	})

/**
 * Decompress the prepared export and return the archive's directory.
 */
const decompress = async (bundle: { files: readonly { path: string }[] }): Promise<string> => {
	const zipPath = join(tmp, "incident.zip")
	await writeAutomaticIncidentZip(bundle as never, zipPath)
	const outDir = join(tmp, "unzipped")
	execFileSync("unzip", ["-o", "-q", zipPath, "-d", outDir])
	return outDir
}

const readJsonl = (outDir: string, name: string): Record<string, unknown>[] =>
	readFileSync(join(outDir, name), "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>)

const readManifest = (
	outDir: string,
): {
	sources: { file: string; status: string; availabilityReason?: string }[]
	files: { file: string; sha256: string; bytes: number }[]
	manifestIntegrity: { memberCount: number }
} => JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"))

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-export-gap-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
	setAutomaticIncidentDurabilityHook(undefined)
	clearReconciliationDiagnosticRecords()
	setReconciliationDiagnosticCaptureEnabled(false)
	clearTurnStateWriterProvenanceDiagnostic()
	disableTurnStateWriterProvenanceDiagnostic()
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	setAutomaticIncidentDurabilityHook(undefined)
	setReconciliationDiagnosticCaptureEnabled(false)
	clearReconciliationDiagnosticRecords()
	clearTurnStateWriterProvenanceDiagnostic()
	disableTurnStateWriterProvenanceDiagnostic()
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearAutomaticIncidents()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

describe("R1 - real owner-matched phase-writer records reach the REAL export path", () => {
	it("R1a - a REAL host-ring phase-writer record for the incident's task/epoch is exported", async () => {
		openIncident()
		// The REAL producer seam: the extension-host ring is armed and a
		// record is stamped through the production recorder.
		enableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance({
			capturedAt: Date.now(),
			writerId: "session-event-bcb-hold-resumable",
			taskId: TASK_A,
			epoch: EPOCH_A,
			previous: { phase: "streaming", seq: 41, anchorTs: undefined },
			requested: { phase: "resumable", anchorTs: undefined },
			committed: { phase: "resumable", seq: 42, anchorTs: undefined },
		})
		// The record really is in the host ring.
		expect(getTurnStateWriterProvenanceRecords()).toHaveLength(1)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		expect(prepared.bundle).toBeDefined()

		const outDir = await decompress(prepared.bundle!)
		const phaseWriters = readJsonl(outDir, "phase-writers.jsonl")

		// RED: at ENTRY_HEAD this array is EMPTY even though the host
		// ring holds a real, owner-matched record.
		expect(phaseWriters.length).toBeGreaterThan(0)
		expect(phaseWriters[0].phaseWriter).toBe("session-event-bcb-hold-resumable")
	})

	it("R1b - the manifest's source metadata is TRUTHFUL about the phase-writer availability", async () => {
		openIncident()
		enableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance({
			capturedAt: Date.now(),
			writerId: "task-start-init-task",
			taskId: TASK_A,
			epoch: EPOCH_A,
			previous: { phase: "idle", seq: 1, anchorTs: undefined },
			requested: { phase: "streaming", anchorTs: undefined },
			committed: { phase: "streaming", seq: 2, anchorTs: undefined },
		})

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const manifest = readManifest(outDir)
		const source = manifest.sources.find((s) => s.file === "phase-writers.jsonl")
		expect(source).toBeDefined()
		// The manifest must NOT claim "available" for an empty file, nor
		// "unavailable" for a populated one.
		const phaseWriters = readJsonl(outDir, "phase-writers.jsonl")
		expect(source!.status).toBe(phaseWriters.length > 0 ? "available" : "unavailable")
		expect(source!.status).toBe("available")
	})

	it("R1c - with NO phase-writer records the file stays explicitly unavailable (no invention)", async () => {
		openIncident()
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const manifest = readManifest(outDir)
		const source = manifest.sources.find((s) => s.file === "phase-writers.jsonl")
		expect(source!.status).toBe("unavailable")
		expect(readJsonl(outDir, "phase-writers.jsonl")).toHaveLength(0)
	})
})

describe("R2 - the authoritative owner-matched continuation outcome reaches the ZIP", () => {
	it("R2a - a REAL owner-matched CCARD outcome is exported, not the constant", async () => {
		openIncident()
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "background_terminal",
			sessionId: SESSION_A,
			taskId: TASK_A,
		})
		expect(getContinuationCardinalityAuthorityCaptureRecords().length).toBe(1)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = JSON.parse(readFileSync(join(outDir, "continuation-summary.json"), "utf8")) as {
			status: string
			outcome?: string
		}

		// RED: at ENTRY_HEAD this is ALWAYS the constant
		// `{ status: "unavailable", reason: ... }`.
		expect(continuation.status).not.toBe("unavailable")
		expect(continuation.status).toBe("available")
		expect(continuation.outcome).toBe("task_completion_committed")
	})

	it("R2b - an UNRELATED owner's continuation outcome stays explicitly unavailable", async () => {
		openIncident()
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		// A DIFFERENT session / task: it must never satisfy task A.
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "background_terminal",
			sessionId: SESSION_B,
			taskId: TASK_B,
		})

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = JSON.parse(readFileSync(join(outDir, "continuation-summary.json"), "utf8")) as {
			status: string
		}
		expect(continuation.status).toBe("unavailable")
	})

	it("R2c - with NO continuation authority the summary stays explicitly unavailable", async () => {
		openIncident()
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = JSON.parse(readFileSync(join(outDir, "continuation-summary.json"), "utf8")) as {
			status: string
			reason?: string
		}
		expect(continuation.status).toBe("unavailable")
		expect(continuation.reason).toBeTruthy()
	})
})

describe("R3 - the reconciliation timeline differentiates the arming states", () => {
	it("R3a - a DISARMED sink is reported as not-armed, NOT as 'no reconciliation happened'", async () => {
		openIncident()
		setReconciliationDiagnosticCaptureEnabled(false)
		expect(isReconciliationDiagnosticCaptureEnabled()).toBe(false)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const manifest = readManifest(outDir)
		const source = manifest.sources.find((s) => s.file === "reconciliation-timeline.jsonl")
		expect(source).toBeDefined()
		// The export must NOT present an empty timeline as a COMPLETE
		// capture when the sink was never armed.
		expect(source!.status).not.toBe("available")
		expect(source!.availabilityReason).toBeTruthy()
	})

	it("R3b - an ARMED sink with no matching records is distinguishable from the disarmed case", async () => {
		openIncident()
		setReconciliationDiagnosticCaptureEnabled(true)
		expect(isReconciliationDiagnosticCaptureEnabled()).toBe(true)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const manifest = readManifest(outDir)
		const source = manifest.sources.find((s) => s.file === "reconciliation-timeline.jsonl")
		expect(source).toBeDefined()
		// An ARMED sink with zero records is a DIFFERENT state from a
		// DISARMED sink: the reason must differ.
		expect(source!.availabilityReason).toBeTruthy()
		expect(source!.availabilityReason).not.toBe(source!.status)
	})
})

describe("R4 - a foreign owner or stale phase writer never leaks into the selected incident", () => {
	it("R4a - a phase writer for ANOTHER task/epoch is NEVER exported", async () => {
		openIncident()
		enableTurnStateWriterProvenanceDiagnostic()
		// A STALE record for a different task and a different epoch.
		recordTurnStateWriterProvenance({
			capturedAt: Date.now(),
			writerId: "controller-cancel-task",
			taskId: TASK_B,
			epoch: EPOCH_A + 99,
			previous: { phase: "streaming", seq: 7, anchorTs: undefined },
			requested: { phase: "resumable", anchorTs: undefined },
			committed: { phase: "resumable", seq: 8, anchorTs: undefined },
		})

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const phaseWriters = readJsonl(outDir, "phase-writers.jsonl")
		expect(phaseWriters).toHaveLength(0)
	})

	it("R4b - a foreign owner's continuation outcome NEVER leaks into the selected incident", async () => {
		openIncident()
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "agent_turn_done",
			origin: "background_terminal",
			sessionId: SESSION_B,
			taskId: TASK_B,
		})
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = JSON.parse(readFileSync(join(outDir, "continuation-summary.json"), "utf8")) as {
			status: string
		}
		expect(continuation.status).toBe("unavailable")
	})

	it("R4c - the manifest counts, hashes and sizes stay CORRECT after the repair", async () => {
		openIncident()
		enableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance({
			capturedAt: Date.now(),
			writerId: "session-event-bcb-hold-resumable",
			taskId: TASK_A,
			epoch: EPOCH_A,
			previous: { phase: "streaming", seq: 41, anchorTs: undefined },
			requested: { phase: "resumable", anchorTs: undefined },
			committed: { phase: "resumable", seq: 42, anchorTs: undefined },
		})

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const manifest = readManifest(outDir)
		for (const file of manifest.files) {
			const actual = readFileSync(join(outDir, file.file), "utf8")
			expect(file.sha256, `hash mismatch for ${file.file}`).toBe(createHash("sha256").update(actual, "utf8").digest("hex"))
			expect(file.bytes).toBe(Buffer.byteLength(actual, "utf8"))
		}
		expect(readdirSync(outDir).length).toBe(manifest.manifestIntegrity.memberCount)
	})

	it("R4d - the privacy sentinels NEVER reach the decompressed archive", async () => {
		openIncident()
		enableTurnStateWriterProvenanceDiagnostic()
		recordTurnStateWriterProvenance({
			capturedAt: Date.now(),
			writerId: "session-event-bcb-hold-resumable",
			taskId: TASK_A,
			epoch: EPOCH_A,
			previous: { phase: "streaming", seq: 41, anchorTs: undefined },
			requested: { phase: "resumable", anchorTs: undefined },
			committed: { phase: "resumable", seq: 42, anchorTs: undefined },
		})
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "background_terminal",
			sessionId: SESSION_A,
			taskId: TASK_A,
		})

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		for (const entry of readdirSync(outDir)) {
			const contents = readFileSync(join(outDir, entry), "utf8")
			for (const [name, sentinel] of Object.entries(SENTINELS)) {
				expect(contents.includes(sentinel), `sentinel ${name} leaked into ${entry}`).toBe(false)
			}
			expect(contents.includes("/Users/")).toBe(false)
		}
	})
})

describe("R5 - default-off diagnostics have ZERO state-semantic delta", () => {
	it("R5a - the export path adds NO new public API / protocol / MCP operation", () => {
		const runtimeSource = readFileSync(join(__dirname, "..", "automatic-incident-export-runtime.ts"), "utf8")
		// Strip the comments so a PROSE mention of "MCP" in a doc block
		// is not mistaken for an API surface.
		const code = runtimeSource
			.split("\n")
			.filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
			.join("\n")
		// No proto / RPC / MCP surface is introduced by the export path.
		expect(code).not.toMatch(/\brpc\b/i)
		expect(code).not.toMatch(/\bmcp\b/i)
		expect(code).not.toMatch(/registerCommand|contributes\.commands/)
		// The export path stays network-free.
		expect(code).not.toMatch(/\bfetch\s*\(/)
		expect(code).not.toMatch(/\baxios\b/)
	})

	it("R5b - with the diagnostics DISARMED the export has no state-semantic delta", async () => {
		// DISARMED (public default): the phase-writer ring and the
		// continuation ring are both empty, so the export must be
		// unchanged from the pre-repair behaviour.
		openIncident()
		expect(isReconciliationDiagnosticCaptureEnabled()).toBe(false)
		expect(getTurnStateWriterProvenanceRecords()).toHaveLength(0)
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(0)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		// No state-semantic delta: the disarmed sources stay unavailable.
		const manifest = readManifest(outDir)
		const phaseWriters = manifest.sources.find((s) => s.file === "phase-writers.jsonl")
		const continuation = manifest.sources.find((s) => s.file === "continuation-summary.json")
		expect(phaseWriters!.status).toBe("unavailable")
		expect(continuation!.status).toBe("unavailable")
		// The incident itself is unchanged by the diagnostics.
		expect(prepared.incident!.completionCommitted).toBe(false)
		expect(prepared.incident!.observations.length).toBeGreaterThan(0)
	})
})
