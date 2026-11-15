/**
 * ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01-CORRECTION02 (CECC01)
 *
 * THE POST-OPEN CROSS-EPOCH CCARD ATTRIBUTION DISCRIMINATOR.
 *
 * THE FINDING THIS DISCRIMINATOR TESTS
 * ------------------------------------
 *
 * The CORRECTION01 export join accepts a CCARD continuation record when:
 *
 *   - its `sessionId` + `taskId` match the incident's owner scope, AND
 *   - its stage is an AUTHORITATIVE outcome stage, AND
 *   - it was captured at or after the incident's `openedAt`, AND
 *   - it has the highest `seq` among the qualifying records.
 *
 * A CCARD record carries NO epoch. An incident DOES carry an explicit
 * epoch (`identity.epoch`), and the incident's causal identity key is
 * `(sessionId, taskId, epoch, barrierId)`.
 *
 * The temporal lower bound (`>= openedAt`) excludes records captured
 * BEFORE the incident opened. It does NOT exclude records captured
 * AFTER the incident opened but in a LATER epoch of the same task:
 *
 *   t0  incident A opens at epoch 4
 *   t1  the task advances to epoch 5
 *   t2  CCARD records `task_completion_committed` in epoch 5
 *       (same session/task, no epoch on the record)
 *   t3  incident A is exported; the join can assign the epoch-5
 *       outcome to the epoch-4 incident
 *
 * The incident manager's task-based lookup
 * (`getAutomaticIncidentForTask`) returns the MOST RECENT retained
 * incident for the task, so a later epoch does NOT displace the earlier
 * incident, and the exported artifact names the epoch-4 incident.
 *
 * `Date.now()` is wall-clock time, not a monotonic causal sequence, so a
 * timestamp comparison cannot independently establish event ownership.
 *
 * WHAT THIS DISCRIMINATOR PROVES
 * ------------------------------
 *
 * The counterexample is exercised through the REAL selection path
 * (`prepareAutomaticIncidentExport` -> the decompressed archive), NOT
 * through a synthetic call into the join helper. It therefore answers
 * the review's question directly: can the epoch-5 outcome be presented
 * as the EXACT outcome of the epoch-4 incident?
 *
 * The requirement this suite asserts is the REVIEW's requirement: the
 * epoch-5 outcome must NOT be presented as an exact outcome of incident
 * A. The honest classification is a TASK-LEVEL post-open observation,
 * not an exact incident-level outcome. The exact-epoch BCAPT attribution
 * is PRESERVED.
 *
 * REALM NOTE
 * ----------
 *
 * Every producer consumed here lives in the EXTENSION-HOST JS realm. The
 * export resolves the incident through the HOST's authority, never
 * through a webview-supplied identity.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	clearBcbObservationUnavailableCapture,
	disableBcbObservationUnavailableCapture,
	enableBcbObservationUnavailableCapture,
	recordBcbObservationUnavailableCapture,
} from "@shared/bcb-observation-unavailable-capture"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type AutomaticIncidentIdentity,
	captureAutomaticIncident,
	clearAutomaticIncidents,
	getAutomaticIncidentForTask,
	setAutomaticIncidentCaptureEnabled,
	setAutomaticIncidentDurabilityHook,
} from "@/sdk/automatic-incident-capture"
import { writeAutomaticIncidentZip } from "@/sdk/automatic-incident-export"
import { prepareAutomaticIncidentExport } from "@/sdk/automatic-incident-export-runtime"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK = "task-cecc01-1793900000001"
const SESSION = "session-cecc01"
const EPOCH_A = 4
const EPOCH_B = 5
const JOB_A = "cmd_cecc01job"

let tmp: string

const identityFor = (epoch: number, barrierId: string): AutomaticIncidentIdentity => ({
	sessionId: SESSION,
	taskId: TASK,
	epoch,
	barrierId,
	coordinatorInstanceId: "coord-cecc01",
	extensionHostInstanceId: "host-cecc01",
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

/**
 * Open the epoch-A incident (the incident under export).
 */
const openIncidentA = () =>
	captureAutomaticIncident({
		identity: identityFor(EPOCH_A, "barrier-cecc01-epoch-4"),
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

interface ContinuationSummary {
	status: string
	reason?: string
	outcome?: string
	observedOutcome?: string
	epoch?: number
	attribution?: string
	scope?: string
}

const readContinuation = (outDir: string): ContinuationSummary =>
	JSON.parse(readFileSync(join(outDir, "continuation-summary.json"), "utf8")) as ContinuationSummary

/**
 * A BCAPT record with the full production shape. Only the identity
 * fields differ between the cases.
 */
const bcaptRecord = (epoch: number) =>
	recordBcbObservationUnavailableCapture({
		sessionId: SESSION,
		taskId: TASK,
		epoch,
		eligibleForCoalescedContinuation: true,
		unconsumedOwnedTerminalResultsForC10: 1,
		ownedTerminalJobIdsForC10: [JOB_A],
		outstandingAutonomousWork: false,
		ownerStillRunningForC10: false,
		heldObligationForC10: true,
		suppressOriginatingCompletion: false,
		liveToolsAvailable: true,
		liveToolsIncludesCommandStatus: false,
		liveToolsCount: 2,
		liveToolsValue: ["read_files", "run_commands"],
		canObserveHeldResults: false,
		sameObligationAlreadyObservationUnavailable: false,
		writerId: "session-event-bcb-blocked-observation-unavailable",
		requestedPhase: "error",
		committedPhase: "error",
	})

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cecc01-cross-epoch-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
	setAutomaticIncidentDurabilityHook(undefined)
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearBcbObservationUnavailableCapture()
	disableBcbObservationUnavailableCapture()
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	setAutomaticIncidentDurabilityHook(undefined)
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearBcbObservationUnavailableCapture()
	disableBcbObservationUnavailableCapture()
	clearAutomaticIncidents()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

describe("CECC01 - the post-open cross-epoch CCARD attribution discriminator", () => {
	it("CECC01-1 - the epoch-5 outcome is NOT presented as the epoch-4 incident's exact outcome", async () => {
		// t0: incident A opens at epoch 4.
		openIncidentA()
		const incidentA = getAutomaticIncidentForTask(TASK)!
		expect(incidentA.identity.epoch).toBe(EPOCH_A)

		// t1/t2: the task advances to epoch 5 and CCARD records an
		// authoritative outcome for the SAME session/task. The record
		// carries NO epoch — that is the structural fact under test.
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "background_terminal",
			sessionId: SESSION,
			taskId: TASK,
		})

		// t3: incident A is exported through the REAL selection path.
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		// The exported incident IS the epoch-4 incident.
		expect(prepared.incident?.incidentId).toBe(incidentA.incidentId)
		expect(prepared.incident?.identity.epoch).toBe(EPOCH_A)

		const outDir = await decompress(prepared.bundle!)
		const continuation = readContinuation(outDir)

		// The requirement: the epoch-5 outcome must NOT be presented as
		// an EXACT outcome of the epoch-4 incident.
		//
		// The record cannot establish the epoch, so the honest
		// classification is a TASK-LEVEL post-open observation. It must
		// NOT be reported as the incident's own exact outcome, and it
		// must NOT claim the incident's epoch.
		expect(continuation.outcome).toBeUndefined()
		expect(continuation.epoch).toBeUndefined()
		if (continuation.status === "available") {
			// It is still reported, but explicitly labeled as a
			// TASK-LEVEL observation rather than an incident outcome.
			expect(continuation.attribution).toBe("task_level_observation")
			expect(continuation.scope).toBe("task")
			// The observation itself is preserved under its own field.
			expect(continuation.observedOutcome).toBe("task_completion_committed")
		} else {
			// Otherwise it must be explicitly unavailable with a reason.
			expect(continuation.status).toBe("unavailable")
			expect(continuation.reason).toBeDefined()
		}
	})

	it("CECC01-2 - the pre-fix HEAD misattribution is REPRODUCED (RED witness, now inverted)", async () => {
		// This test documents the state of HEAD c86ac36c7: the epoch-5
		// outcome WAS (incorrectly) presented as the epoch-4 incident's
		// exact outcome. It was the RED witness for the finding.
		//
		// After CORRECTION02 the expectation is INVERTED: the same
		// counterexample now yields a TASK-LEVEL observation and no
		// incident outcome. The RED evidence for the pre-fix state is
		// preserved in the factory evidence bundle.
		openIncidentA()
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "background_terminal",
			sessionId: SESSION,
			taskId: TASK,
		})
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = readContinuation(outDir)
		// GREEN at CORRECTION02: the cross-epoch outcome is NOT the
		// incident's exact outcome.
		expect(continuation.outcome).toBeUndefined()
		expect(continuation.epoch).toBeUndefined()
		expect(continuation.attribution).toBe("task_level_observation")
		expect(continuation.scope).toBe("task")
		expect(continuation.observedOutcome).toBe("task_completion_committed")
	})

	it("CECC01-3 - the BCAPT exact-epoch attribution is PRESERVED", async () => {
		// The repair demotes CCARD only. BCAPT carries an epoch and is
		// compared EXACTLY against the incident's epoch, so it remains
		// an INCIDENT-EXACT attribution and keeps the epoch.
		openIncidentA()
		enableBcbObservationUnavailableCapture()
		bcaptRecord(EPOCH_A)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = readContinuation(outDir)
		expect(continuation.status).toBe("available")
		expect(continuation.attribution).toBe("incident_exact")
		expect(continuation.scope).toBe("incident")
		expect(continuation.outcome).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(continuation.epoch).toBe(EPOCH_A)
	})

	it("CECC01-4 - a BCAPT record from a DIFFERENT epoch never joins", async () => {
		// The exact-epoch discrimination is intact: an epoch-5 BCAPT
		// record cannot be attributed to the epoch-4 incident.
		openIncidentA()
		enableBcbObservationUnavailableCapture()
		bcaptRecord(EPOCH_B)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK,
			buildIdentity: buildIdentity(),
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const outDir = await decompress(prepared.bundle!)
		const continuation = readContinuation(outDir)
		expect(continuation.status).toBe("unavailable")
		expect(continuation.outcome).toBeUndefined()
		expect(continuation.epoch).toBeUndefined()
	})
})
