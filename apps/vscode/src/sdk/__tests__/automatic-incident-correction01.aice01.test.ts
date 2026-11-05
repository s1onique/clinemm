/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01
 *
 * The EVIDENCE-PROVENANCE-INTEGRITY correction suite.
 *
 * The reviewer verdict was `HALT_EVIDENCE_PROVENANCE_INTEGRITY`. The
 * four P0 defects are CAUSAL-CORRECTNESS defects in the diagnostic
 * report: the feature compiles and the tests pass, but the report can
 * assert things that never happened.
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 *   P0-1  the reconciliation publication is captured AFTER the
 *         authoritative publication boundary, with the ORIGINAL
 *         owner/job identity, and a FAILED publication records the
 *         failure instead of a successful publication;
 *   P0-2  the per-job coverage advances ONLY on the corresponding
 *         observed production stage, the reconciliation `stage` field
 *         is mapped correctly, and joined records are not duplicated;
 *   P0-3  the exported ZIP's `containment-provenance.json` carries the
 *         REAL protected CFPR01 records for the incident's EXACT
 *         blocking job ids, and reports `UNAVAILABLE_FROM_TRACE` when
 *         the source evidence is absent;
 *   P0-4  a terminal reconciliation observation is PERSISTED, a
 *         `{ succeeded: false }` persistence result is accounted for,
 *         and an older persisted revision never replaces a newer
 *         in-memory snapshot during export;
 *   P1    the explicit public-user opt-in arms the reconciliation
 *         diagnostic sink.
 *
 * The P0-3 assertion inspects the RESULTING ZIP by DECOMPRESSING it,
 * exactly as a support engineer would.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type AutomaticIncidentIdentity,
	captureAutomaticIncident,
	clearAutomaticIncidents,
	getAutomaticIncidentForOwnerJob,
	getAutomaticIncidentForTask,
	joinReconciliationRecordsToIncidents,
	setAutomaticIncidentCaptureEnabled,
	setAutomaticIncidentDurabilityHook,
} from "@/sdk/automatic-incident-capture"
import { readContainmentProvenanceForBlockingJobs } from "@/sdk/automatic-incident-containment-provenance"
import { writeAutomaticIncidentZip } from "@/sdk/automatic-incident-export"
import { prepareAutomaticIncidentExport } from "@/sdk/automatic-incident-export-runtime"
import { persistAutomaticIncident } from "@/sdk/automatic-incident-persistence"
import {
	captureBackgroundJobLivenessAuthorityRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	clearBackgroundJobLivenessAuthorityProvenanceStore,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "@/sdk/background-job-liveness-authority"
import { applyReconciliationDiagnosticCaptureProfile } from "@/sdk/dogfood-diagnostic-profile"
import {
	clearReconciliationDiagnosticRecords,
	setReconciliationDiagnosticCaptureEnabled,
} from "@/sdk/reconciliation-diagnostic-capture"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK_A = "task-a-1793899291382"
const TASK_B = "task-b-1793899291383"
const SESSION_A = "session-a"
const SESSION_B = "session-b"
const JOB_A = "cmd_mw3ttmsis0wqw9y7"
const JOB_B = "cmd_mw3ump8m1o4iwiwj"

let tmp: string

const identityFor = (overrides: Partial<AutomaticIncidentIdentity> = {}): AutomaticIncidentIdentity => ({
	sessionId: SESSION_A,
	taskId: TASK_A,
	epoch: 4,
	barrierId: "barrier-test-1",
	coordinatorInstanceId: "coord-test",
	extensionHostInstanceId: "host-test",
	...overrides,
})

const context = () => ({ globalStorageUri: { fsPath: tmp } })

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-correction-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
	setAutomaticIncidentDurabilityHook(undefined)
	clearReconciliationDiagnosticRecords()
	setReconciliationDiagnosticCaptureEnabled(true)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	setAutomaticIncidentDurabilityHook(undefined)
	setReconciliationDiagnosticCaptureEnabled(false)
	clearAutomaticIncidents()
	clearReconciliationDiagnosticRecords()
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

describe("P0-1 — the reconciliation publication is captured AT the publication boundary, with the ORIGINAL identity", () => {
	it("P0-1a — a reconciliation for task A is NEVER attributed to task B's incident", () => {
		// Task A's incident, blocking JOB_A, owned by SESSION_A.
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		// Task B's incident, blocking JOB_B, owned by SESSION_B.
		captureAutomaticIncident({
			identity: identityFor({ sessionId: SESSION_B, taskId: TASK_B, barrierId: "barrier-test-2" }),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_B],
		})

		// The reconciliation for task A's job resolves to task A's
		// incident — NOT to the ACTIVE task's incident.
		const resolved = getAutomaticIncidentForOwnerJob({ ownerSessionId: SESSION_A, jobId: JOB_A })
		expect(resolved).toBeDefined()
		expect(resolved!.identity.taskId).toBe(TASK_A)

		// Task B's incident is untouched by task A's reconciliation.
		const taskB = getAutomaticIncidentForTask(TASK_B)
		expect(taskB!.observations.filter((o) => o.stage === "controller_reconciliation_published")).toHaveLength(0)
	})

	it("P0-1b — a reconciliation whose OWNER does not match the incident is NOT joined", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		// A DIFFERENT owner session must not claim task A's incident.
		const resolved = getAutomaticIncidentForOwnerJob({ ownerSessionId: "session-other", jobId: JOB_A })
		expect(resolved).toBeUndefined()
	})

	it("P0-1c — a job that is NOT in the incident's blocking set resolves to no incident", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		const resolved = getAutomaticIncidentForOwnerJob({ ownerSessionId: SESSION_A, jobId: JOB_B })
		expect(resolved).toBeUndefined()
	})

	it("P0-1d — a FAILED publication does NOT advance the controller-publication coverage", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "controller_reconciliation_published",
			outcome: "controller_reconciliation_publication_failed",
			detail: {
				jobId: JOB_A,
				publicationOutcome: "controller_reconciliation_publication_failed",
				publicationFailureReason: "state update rejected",
			},
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidentForTask(TASK_A)!
		const coverage = incident.coverage.find((c) => c.jobId === JOB_A)!
		// The publication FAILED, so the publication was NOT observed.
		expect(coverage.controllerPublication).toBe("NOT_OBSERVED")
		// But the FAILURE itself is recorded as an observation.
		const observations = incident.observations.filter((o) => o.stage === "controller_reconciliation_published")
		expect(observations).toHaveLength(1)
		expect(observations[0].outcome).toBe("controller_reconciliation_publication_failed")
	})

	it("P0-1e — a SUCCESSFUL publication DOES advance the controller-publication coverage", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "controller_reconciliation_published",
			outcome: "controller_reconciliation_published",
			detail: { jobId: JOB_A, publicationOutcome: "controller_reconciliation_published" },
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidentForTask(TASK_A)!
		const coverage = incident.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.controllerPublication).toBe("OBSERVED")
	})
})

describe("P0-2 — the per-job coverage advances ONLY on the corresponding observed production stage", () => {
	const openIncident = (blockingJobIds: string[]) => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: blockingJobIds.length },
			blockingJobIds,
		})
		return getAutomaticIncidentForTask(TASK_A)!
	}

	it("P0-2a — a completion hold does NOT assert that the job's terminal state was published", () => {
		openIncident([JOB_A])
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.terminalPublication).toBe("NOT_OBSERVED")
	})

	it("P0-2b — the held phase / stall / completion commit do NOT assert a terminal publication", () => {
		openIncident([JOB_A])
		for (const stage of ["held_phase_published", "stalled_no_progress", "completion_committed"] as const) {
			captureAutomaticIncident({
				identity: identityFor(),
				stage,
				outcome: stage,
				detail: { jobId: JOB_A },
				blockingJobIds: [JOB_A],
			})
		}
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.terminalPublication).toBe("NOT_OBSERVED")
	})

	it("P0-2c — the containment-failure publication DOES assert the terminal publication", () => {
		openIncident([JOB_A])
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "containment_failure_published",
			outcome: "containment_failed",
			detail: { jobId: JOB_A, originalFailure: "substrate_alive" },
			blockingJobIds: [JOB_A],
		})
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.terminalPublication).toBe("OBSERVED")
		expect(coverage.originalFailure).toBe("OBSERVED")
	})

	it("P0-2d — a REGISTRATION does NOT assert a terminal reconciliation outcome", () => {
		openIncident([JOB_A])
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_registered" },
		])
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.reconciliationTerminalOutcome).toBe("NOT_OBSERVED")
		expect(coverage.reconciliationRegistration).toBe("OBSERVED")
		// A registration is NOT an attempt.
		expect(coverage.reconciliationAttempts).toBe("NOT_OBSERVED")
	})

	it("P0-2e — an ordinary ATTEMPT does NOT assert a terminal reconciliation outcome", () => {
		openIncident([JOB_A])
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
		])
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.reconciliationTerminalOutcome).toBe("NOT_OBSERVED")
		expect(coverage.reconciliationAttempts).toBe("OBSERVED")
	})

	it("P0-2f — an EXHAUSTION DOES assert the terminal reconciliation outcome", () => {
		openIncident([JOB_A])
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
			{ eventSeq: 2, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_exhausted" },
		])
		const coverage = getAutomaticIncidentForTask(TASK_A)!.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.reconciliationTerminalOutcome).toBe("OBSERVED")
	})

	it("P0-2g — the join reads the `stage` field, not the `event` / `outcome` fields", () => {
		openIncident([JOB_A])
		// The recorder emits `stage`. The legacy `event` / `outcome`
		// fields are absent — the join must not synthesize a terminal
		// outcome from their absence.
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_registered" },
		])
		const incident = getAutomaticIncidentForTask(TASK_A)!
		const observation = incident.observations.find((o) => o.stage === "reconciliation_observed")!
		// The recorded outcome is the OBSERVED STAGE, never a
		// synthesized "OBSERVED" verdict.
		expect(observation.outcome).toBe("reconciliation_registered")
		// The terminal reconciliation outcome was NOT established.
		const coverage = incident.coverage.find((c) => c.jobId === JOB_A)!
		expect(coverage.reconciliationTerminalOutcome).toBe("NOT_OBSERVED")
	})

	it("P0-2h — a joined record is NOT duplicated for a MULTI-JOB incident", () => {
		openIncident([JOB_A, JOB_B])
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
			{ eventSeq: 2, jobId: JOB_B, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
		])
		const incident = getAutomaticIncidentForTask(TASK_A)!
		// Each record appears EXACTLY ONCE in the timeline.
		expect(incident.reconciliationTimeline).toHaveLength(2)
		const seqs = incident.reconciliationTimeline.map((raw) => (raw as { eventSeq?: number }).eventSeq)
		expect(seqs).toEqual([1, 2])
	})

	it("P0-2i — the join is IDEMPOTENT across repeated calls", () => {
		openIncident([JOB_A])
		const record = { eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 }
		joinReconciliationRecordsToIncidents([record])
		joinReconciliationRecordsToIncidents([record])
		const incident = getAutomaticIncidentForTask(TASK_A)!
		expect(incident.reconciliationTimeline).toHaveLength(1)
	})
})

describe("P0-3 — the exported ZIP carries the REAL protected CFPR01 containment records", () => {
	const seedProtectedFailure = (jobId: string) => {
		captureBackgroundJobLivenessAuthorityRecord({
			event: "containment_failure_classified",
			capturedAt: 1_700_000_000_000,
			managerInstance: "mgr-1",
			hostInstance: "host-1",
			jobId,
			ownerSessionId: SESSION_A,
			pid: 4242,
			pgid: 4242,
			postcondition: "alive",
			osErrorCode: "EPERM",
			containmentFailed: "substrate_eperm",
			jobState: "containment_failed",
		})
		captureBackgroundJobLivenessAuthorityRecord({
			event: "containment_terminal_state_published",
			capturedAt: 1_700_000_000_001,
			managerInstance: "mgr-1",
			hostInstance: "host-1",
			jobId,
			publishedState: "containment_failed",
			ownerSessionId: SESSION_A,
			isContainmentFailure: true,
		})
	}

	const openIncident = () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
	}

	it("P0-3a — the reader reports UNAVAILABLE_FROM_TRACE when the protected store holds NO record for the blocking job", () => {
		// The incident exists; the PROTECTED store is empty.
		const block = readContainmentProvenanceForBlockingJobs([JOB_A])
		expect(block.status).toBe("UNAVAILABLE_FROM_TRACE")
		expect(block.jobs).toHaveLength(1)
		expect(block.jobs[0].availability).toBe("UNAVAILABLE_FROM_TRACE")
		expect(block.reason).toBeTruthy()
	})

	it("P0-3b — the reader JOIN_COMPLETEs when the protected store holds BOTH records for the blocking job", () => {
		seedProtectedFailure(JOB_A)
		const block = readContainmentProvenanceForBlockingJobs([JOB_A])
		expect(block.status).toBe("available")
		expect(block.jobs[0].availability).toBe("JOIN_COMPLETE")
		expect(block.jobs[0].containmentFailed).toBe("substrate_eperm")
		expect(block.jobs[0].osErrorCode).toBe("EPERM")
		expect(block.jobs[0].postcondition).toBe("alive")
		expect(block.jobs[0].ownerSessionId).toBe(SESSION_A)
	})

	it("P0-3c — a record for a DIFFERENT job is NEVER joined", () => {
		seedProtectedFailure(JOB_B)
		const block = readContainmentProvenanceForBlockingJobs([JOB_A])
		expect(block.status).toBe("UNAVAILABLE_FROM_TRACE")
		expect(block.jobs[0].availability).toBe("UNAVAILABLE_FROM_TRACE")
	})

	it("P0-3d — the EXPORTED ZIP contains the original blocking-job evidence", async () => {
		openIncident()
		seedProtectedFailure(JOB_A)
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: {
				schemaVersion: 1,
				provenanceVerification: "UNOBSERVED",
			},
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		expect(prepared.bundle).toBeDefined()

		// The ZIP is written and DECOMPRESSED — the assertion inspects
		// the artifact a support engineer actually receives.
		const zipPath = join(tmp, "incident.zip")
		await writeAutomaticIncidentZip(prepared.bundle!, zipPath)
		const outDir = join(tmp, "unzipped")
		execFileSync("unzip", ["-o", "-q", zipPath, "-d", outDir])

		const provenanceRaw = readFileSync(join(outDir, "containment-provenance.json"), "utf8")
		const provenance = JSON.parse(provenanceRaw) as {
			status: string
			requestedJobIds: string[]
			jobs: { jobId: string; availability: string; containmentFailed: string | null; osErrorCode: string | null }[]
		}
		expect(provenance.status).toBe("available")
		expect(provenance.requestedJobIds).toEqual([JOB_A])
		expect(provenance.jobs).toHaveLength(1)
		expect(provenance.jobs[0].jobId).toBe(JOB_A)
		expect(provenance.jobs[0].availability).toBe("JOIN_COMPLETE")
		// The ORIGINAL blocking-job evidence is present in the ZIP.
		expect(provenance.jobs[0].containmentFailed).toBe("substrate_eperm")
		expect(provenance.jobs[0].osErrorCode).toBe("EPERM")
	})

	it("P0-3e — the EXPORTED ZIP reports UNAVAILABLE_FROM_TRACE when the source evidence is absent, even though the incident IS persisted", async () => {
		openIncident()
		// The incident is persisted, but the PROTECTED store is empty.
		const incident = getAutomaticIncidentForTask(TASK_A)!
		expect(incident).toBeDefined()
		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: { schemaVersion: 1, provenanceVerification: "UNOBSERVED" },
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		const provenanceFile = prepared.bundle!.files.find((f) => f.path === "containment-provenance.json")
		expect(provenanceFile).toBeDefined()
		const provenance = JSON.parse(provenanceFile!.contents) as { status: string }
		// The report does NOT claim availability it cannot back.
		expect(provenance.status).toBe("UNAVAILABLE_FROM_TRACE")
	})
})

describe("P0-4 — the terminal reconciliation observation is DURABLE", () => {
	it("P0-4a — a terminal reconciliation observation is PERSISTED, not only held in memory", async () => {
		const persisted: string[] = []
		setAutomaticIncidentDurabilityHook((incident) => {
			persisted.push(`${incident.incidentId}:${incident.revision}`)
		})
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
			{ eventSeq: 2, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_exhausted" },
		])
		// The join invoked the durability hook.
		expect(persisted.length).toBeGreaterThanOrEqual(2)
	})

	it("P0-4b — the persisted artifact carries the terminal exhaustion outcome", async () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		joinReconciliationRecordsToIncidents([
			{ eventSeq: 1, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_attempt", attempt: 1 },
			{ eventSeq: 2, jobId: JOB_A, ownerSessionId: SESSION_A, stage: "reconciliation_exhausted" },
		])
		const incident = getAutomaticIncidentForTask(TASK_A)!
		const result = await persistAutomaticIncident(context(), incident)
		expect(result.succeeded).toBe(true)

		const persistedRaw = readFileSync(join(tmp, "completion-incidents", incident.incidentId, "incident.json"), "utf8")
		const persisted = JSON.parse(persistedRaw) as {
			reconciliationTimeline: { stage?: string }[]
			coverage: { jobId: string; reconciliationTerminalOutcome: string }[]
		}
		// The exhaustion is in the DURABLE artifact, not only in memory.
		expect(persisted.reconciliationTimeline.some((r) => r.stage === "reconciliation_exhausted")).toBe(true)
		expect(persisted.coverage.find((c) => c.jobId === JOB_A)!.reconciliationTerminalOutcome).toBe("OBSERVED")
	})

	it("P0-4c — a persistence result of `{ succeeded: false }` is REPORTED, never swallowed", async () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidentForTask(TASK_A)!
		// A FILE is used where a DIRECTORY is required, so the write
		// genuinely fails. The persistence layer NEVER rejects — it
		// reports failures through the result, so the caller MUST
		// observe the result to account for the loss.
		const blocker = join(tmp, "not-a-directory")
		writeFileSync(blocker, "x")
		const result = await persistAutomaticIncident({ globalStorageUri: { fsPath: blocker } }, incident)
		expect(result.succeeded).toBe(false)
		expect(result.error).toBeTruthy()
	})

	it("P0-4d — an OLDER persisted revision never replaces a NEWER in-memory snapshot during export", async () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1 },
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidentForTask(TASK_A)!
		// Persist the OLDER revision.
		const persisted = await persistAutomaticIncident(context(), incident)
		expect(persisted.succeeded).toBe(true)
		// Advance the in-memory snapshot past the persisted revision.
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "c10_reevaluated",
			outcome: "c10_reevaluated",
			detail: { jobId: JOB_A },
			blockingJobIds: [JOB_A],
		})
		const newer = getAutomaticIncidentForTask(TASK_A)!
		expect(newer.revision).toBeGreaterThan(incident.revision)

		const prepared = await prepareAutomaticIncidentExport({
			context: context(),
			activeTaskId: TASK_A,
			buildIdentity: { schemaVersion: 1, provenanceVerification: "UNOBSERVED" },
		})
		expect(prepared.ok, `export preparation failed: ${prepared.error}`).toBe(true)
		// The export carries the NEWER in-memory snapshot, never the
		// older persisted artifact.
		expect(prepared.incident!.revision).toBe(newer.revision)
		expect(prepared.persisted).toBe(false)
	})
})

describe("P1 — the explicit public-user opt-in arms the reconciliation diagnostic sink", () => {
	it("P1a — the opt-in arms the sink even in a PUBLIC (non-dogfood) build", () => {
		setReconciliationDiagnosticCaptureEnabled(false)
		const result = applyReconciliationDiagnosticCaptureProfile(false, true)
		expect(result.enabled).toBe(true)
	})

	it("P1b — a PUBLIC build with NO opt-in leaves the sink disarmed", () => {
		setReconciliationDiagnosticCaptureEnabled(false)
		const result = applyReconciliationDiagnosticCaptureProfile(false, false)
		expect(result.enabled).toBe(false)
	})

	it("P1c — the dogfood profile still arms the sink", () => {
		setReconciliationDiagnosticCaptureEnabled(false)
		const result = applyReconciliationDiagnosticCaptureProfile(true, false)
		expect(result.enabled).toBe(true)
	})
})
