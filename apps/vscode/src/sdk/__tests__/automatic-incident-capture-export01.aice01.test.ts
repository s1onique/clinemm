/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The AUTOMATIC CAPTURE acceptance suite.
 *
 * RED-01 — "Incident evidence disappears before export".
 * RED-02 — "Reconciliation outcome unavailable".
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 * RED-01 reproduced at ENTRY_HEAD: the ONLY persisted artifact was the
 * flat CIFR checkpoint, written on task switch / deactivate. A C10
 * hold produced NO incident identity, NO incident-scoped directory and
 * NO exportable artifact.
 *
 * RED-02 reproduced at ENTRY_HEAD: the REAL TCRR01 manager registered a
 * pending reconciliation, probed the ORIGINAL owned PGID on its
 * bounded schedule and DROPPED the pending entry on exhaustion with
 * NO diagnostic emission whatsoever. The registration, the attempt
 * count, the last observed verdict, the exhaustion reason and the
 * original PGID were ALL unrecoverable.
 *
 * This suite now asserts the GREEN behavior:
 *
 *   G1  a C10 hold automatically creates ONE incident
 *   G2  repeated identical holds do not create duplicate incidents
 *   G3  different task/epoch identities never merge
 *   G5  reconciliation attempts and outcomes survive into the export
 *   G6  reconciliation exhaustion is distinguishable from current
 *       liveness
 *   G7  missing evidence is never classified as a successful
 *       observation
 *   G18 diagnostic capture disabled causes ZERO state-semantic delta
 *   G19 no new process signal or supervisor retry occurs
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 * `REAL_PRODUCTION_SEAM` for the manager: the REAL `CommandJobManager`
 * drives the REAL reconciliation schedule. Only the postcondition
 * probe is injected (the documented `terminalPostconditionProbe` seam)
 * so the fail-closed `alive`/`eperm` set is exercised
 * deterministically — the SAME seam the production TCRR01 suite uses.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type AutomaticIncidentIdentity,
	captureAutomaticIncident,
	clearAutomaticIncidents,
	getAutomaticIncidentForTask,
	getAutomaticIncidents,
	setAutomaticIncidentCaptureEnabled,
} from "@/sdk/automatic-incident-capture"
import { type CommandJobLifecycleEvent, CommandJobManager } from "@/sdk/command-job-manager"
import {
	clearReconciliationDiagnosticRecords,
	getReconciliationDiagnosticRecords,
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

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-capture-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
	setReconciliationDiagnosticCaptureEnabled(true)
	clearReconciliationDiagnosticRecords()
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	setReconciliationDiagnosticCaptureEnabled(false)
	clearAutomaticIncidents()
	clearReconciliationDiagnosticRecords()
	if (tmp) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

const identityFor = (overrides: Partial<AutomaticIncidentIdentity> = {}): AutomaticIncidentIdentity => ({
	sessionId: SESSION_A,
	taskId: TASK_A,
	epoch: 4,
	barrierId: "barrier-test-1",
	coordinatorInstanceId: "coord-test",
	extensionHostInstanceId: "host-test",
	...overrides,
})

describe("AICE01 G1/G2/G3 — the automatic incident capture", () => {
	it("G1 — a C10 hold automatically creates ONE incident", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 2, unconsumedTerminalCount: 1 },
			blockingJobIds: [JOB_A, JOB_B],
		})

		const incidents = getAutomaticIncidents()
		expect(incidents).toHaveLength(1)
		expect(incidents[0].identity.sessionId).toBe(SESSION_A)
		expect(incidents[0].identity.taskId).toBe(TASK_A)
		expect(incidents[0].identity.epoch).toBe(4)
		expect(incidents[0].blockingJobIds).toEqual([JOB_A, JOB_B])
		expect(incidents[0].trigger).toBe("completion_held")
	})

	it("G2 — repeated identical holds do NOT create duplicate incidents", () => {
		for (let i = 0; i < 50; i++) {
			captureAutomaticIncident({
				identity: identityFor(),
				stage: "completion_held",
				outcome: "unresolved_containment_failure",
				detail: { unresolvedContainmentFailureCount: 2, unconsumedTerminalCount: 1 },
				blockingJobIds: [JOB_A, JOB_B],
			})
		}
		const incidents = getAutomaticIncidents()
		expect(incidents).toHaveLength(1)
		// The identical decision is COALESCED into an occurrence count.
		const holdObservations = incidents[0].observations.filter((o) => o.stage === "completion_held")
		expect(holdObservations).toHaveLength(1)
		expect(holdObservations[0].observationCount).toBe(50)
		expect(holdObservations[0].firstSeenAt).toBeTruthy()
		expect(holdObservations[0].lastSeenAt).toBeTruthy()
	})

	it("G2 — a CHANGED blocking set is NOT coalesced away", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 2, unconsumedTerminalCount: 1 },
			blockingJobIds: [JOB_A, JOB_B],
		})
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1, unconsumedTerminalCount: 1 },
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidents()[0]
		const holdObservations = incident.observations.filter((o) => o.stage === "completion_held")
		expect(holdObservations).toHaveLength(2)
		// The LATEST computed blocking set is authoritative.
		expect(incident.blockingJobIds).toEqual([JOB_A])
	})

	it("G3 — different task / epoch / session identities NEVER merge", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			blockingJobIds: [JOB_A],
		})
		captureAutomaticIncident({
			identity: identityFor({ taskId: TASK_B, sessionId: SESSION_B, epoch: 1, barrierId: "barrier-test-2" }),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			blockingJobIds: [JOB_B],
		})
		captureAutomaticIncident({
			identity: identityFor({ epoch: 5, barrierId: "barrier-test-3" }),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			blockingJobIds: [JOB_A],
		})

		const incidents = getAutomaticIncidents()
		expect(incidents).toHaveLength(3)
		expect(new Set(incidents.map((i) => i.incidentId)).size).toBe(3)
		// The task-scoped lookup resolves exactly ONE incident.
		expect(getAutomaticIncidentForTask(TASK_A)?.identity.epoch).toBe(5)
		expect(getAutomaticIncidentForTask(TASK_B)?.identity.sessionId).toBe(SESSION_B)
	})
})

describe("AICE01 G5/G6 — the TCRR01 reconciliation lifecycle is observable", () => {
	it("G5/G6 — the REAL manager's registration, attempts and exhaustion are recoverable", async () => {
		// The experimental Seatbelt sandbox is disabled so the suite
		// exercises the CLASSIC supervised path — exactly what the
		// production TCRR01 suite does.
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const events: CommandJobLifecycleEvent[] = []
		const probeCalls: number[] = []

		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			maxExecutionDeadlineMs: 120_000,
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: (pgid) => {
				probeCalls.push(pgid)
				return { postcondition: "alive", osErrorCode: null }
			},
			containmentReconciliation: {
				enabled: true,
				maxAttempts: 3,
				horizonMs: 5_000,
				intervalMs: 5,
			},
		})

		try {
			const started = await manager.start({
				command: "( sleep 30 </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )",
				cwd: tmp,
				waitBudgetMs: 5_000,
				executionDeadlineMs: 120_000,
			})
			await started.terminalPromise
			await new Promise((r) => setTimeout(r, 300))

			// The reconciliation budget was exercised.
			expect(probeCalls.length).toBeGreaterThan(0)
			// It EXHAUSTED (the probe never returned `gone`).
			expect(events.find((e) => e.event === "command_job_containment_reconciled")).toBeUndefined()

			// --- The RECONCILIATION EVIDENCE IS NOW RECOVERABLE ---------
			const records = getReconciliationDiagnosticRecords()
			const registered = records.find((r) => r.stage === "reconciliation_registered")
			expect(registered, "the registration must be observable").toBeDefined()
			expect(registered?.jobId).toBe(started.jobId)
			expect(typeof registered?.originalPgid).toBe("number")
			expect(registered?.originalFailure).toBeDefined()
			expect(registered?.restoredTerminalClass).toBeDefined()
			expect(registered?.policy?.maxAttempts).toBe(3)

			const attempts = records.filter((r) => r.stage === "reconciliation_attempt")
			expect(attempts.length).toBeGreaterThan(0)
			expect(attempts[0].attempt).toBe(1)
			expect(attempts[0].originalPgid).toBe(registered?.originalPgid)

			const exhausted = records.find((r) => r.stage === "reconciliation_exhausted")
			expect(exhausted, "the exhaustion must be observable").toBeDefined()
			expect(exhausted?.exhaustionReason).toBe("attempt_budget_exhausted")
			expect(exhausted?.attempt).toBe(3)
			expect(exhausted?.originalPgid).toBe(registered?.originalPgid)

			// --- G19: NO NEW PROCESS SIGNAL / RETRY ---------------------
			// The probe cardinality is EXACTLY the bounded schedule: the
			// finalize probe plus the scheduled reconciliation attempts.
			// No diagnostic capture issued an additional probe.
			const scheduledAttempts = attempts.length
			expect(scheduledAttempts).toBeLessThanOrEqual(3)
			expect(probeCalls.length).toBe(scheduledAttempts + 1)

			// --- G6: exhaustion is NOT a liveness assertion ------------
			// The exhaustion record carries NO `postcondition` — the
			// budget ran out; the report must not claim the group is
			// alive.
			expect(exhausted?.postcondition).toBeUndefined()
		} finally {
			await manager.dispose("test_dispose").catch(() => {})
		}
	})

	it("G5 — a resolved reconciliation records the fresh `gone` and the restored terminal class", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const events: CommandJobLifecycleEvent[] = []
		let probes = 0
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			maxExecutionDeadlineMs: 120_000,
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => {
				probes += 1
				// The first probe (finalize) reports `alive`; the
				// scheduled reconciliation probe reports `gone`.
				return probes === 1
					? { postcondition: "alive", osErrorCode: null }
					: { postcondition: "gone", osErrorCode: "ESRCH" }
			},
			containmentReconciliation: { enabled: true, maxAttempts: 5, horizonMs: 5_000, intervalMs: 5 },
		})
		try {
			const started = await manager.start({
				command: "( sleep 30 </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )",
				cwd: tmp,
				waitBudgetMs: 5_000,
				executionDeadlineMs: 120_000,
			})
			await started.terminalPromise
			await new Promise((r) => setTimeout(r, 300))

			const records = getReconciliationDiagnosticRecords()
			const resolved = records.find((r) => r.stage === "reconciliation_resolved")
			expect(resolved, "the resolution must be observable").toBeDefined()
			expect(resolved?.postcondition).toBe("gone")
			expect(resolved?.osErrorCode).toBe("ESRCH")
			expect(resolved?.originalFailure).toBeDefined()
			expect(resolved?.restoredTerminalClass).toBe("exited")
			expect(resolved?.attempt).toBeGreaterThanOrEqual(1)
		} finally {
			await manager.dispose("test_dispose").catch(() => {})
		}
	})
})

describe("AICE01 G7/G18 — honesty and the diagnostic-off delta", () => {
	it("G7 — an unobserved reconciliation is never classified as successful", () => {
		captureAutomaticIncident({
			identity: identityFor(),
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { unresolvedContainmentFailureCount: 1, unconsumedTerminalCount: 1 },
			blockingJobIds: [JOB_A],
		})
		const incident = getAutomaticIncidents()[0]
		// The coverage starts UNOBSERVED, never "successful".
		expect(incident.coverage[0].reconciliationRegistration).toBe("NOT_OBSERVED")
		expect(incident.coverage[0].reconciliationTerminalOutcome).toBe("NOT_OBSERVED")
		expect(incident.coverage[0].controllerPublication).toBe("NOT_OBSERVED")
		expect(incident.coverage[0].c10Reevaluation).toBe("NOT_OBSERVED")
	})

	it("G18 — the diagnostic being OFF produces ZERO state-semantic delta", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const runWithDiagnostic = async (enabled: boolean) => {
			setAutomaticIncidentCaptureEnabled(enabled)
			setReconciliationDiagnosticCaptureEnabled(enabled)
			clearReconciliationDiagnosticRecords()
			const events: CommandJobLifecycleEvent[] = []
			let probes = 0
			const manager = new CommandJobManager({
				maxWaitBudgetMs: 5_000,
				maxExecutionDeadlineMs: 120_000,
				onCommandJobLifecycle: (e) => events.push(e),
				terminalPostconditionProbe: () => {
					probes += 1
					return { postcondition: "alive", osErrorCode: null }
				},
				containmentReconciliation: { enabled: true, maxAttempts: 2, horizonMs: 5_000, intervalMs: 5 },
			})
			try {
				const started = await manager.start({
					command: "( sleep 30 </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )",
					cwd: tmp,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 120_000,
				})
				await started.terminalPromise
				await new Promise((r) => setTimeout(r, 250))
				return {
					probeCount: probes,
					eventNames: events.map((e) => e.event).sort(),
					terminalState: events.find((e) => e.event === "command_job_containment_failed")?.jobState,
				}
			} finally {
				await manager.dispose("test_dispose").catch(() => {})
			}
		}

		const off = await runWithDiagnostic(false)
		const on = await runWithDiagnostic(true)
		expect(on.probeCount).toBe(off.probeCount)
		expect(on.eventNames).toEqual(off.eventNames)
		expect(on.terminalState).toBe(off.terminalState)
	})
})
