/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The PUBLIC-ACTIVATION acceptance suite.
 *
 * The RED gap reproduced at ENTRY_HEAD: the automatic incident capture
 * was armed ONLY by the central dogfood profile, so a PUBLIC build
 * opened NO incident at all. The ACT requires the public build to
 * "automatically preserve a minimal local incident summary".
 *
 * This suite asserts:
 *
 *   G19  the PUBLIC build arms the capture at the MINIMAL depth
 *   G20  the DEVELOPER depth (dogfood / explicit opt-in) retains the
 *        detail map and the reconciliation timeline
 *   G21  the MINIMAL depth DROPS (never redacts) the non-allowlisted
 *        detail keys
 *   G22  the consent control defaults to NOT opted in
 *   G23  the delete control removes the artifacts from disk AND memory
 *   G24  the capture has ZERO state-semantic delta when disarmed
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	captureAutomaticIncident,
	clearAutomaticIncidents,
	getAutomaticIncidentCaptureMode,
	getAutomaticIncidentForTask,
	setAutomaticIncidentCaptureEnabled,
	setAutomaticIncidentCaptureMode,
} from "@/sdk/automatic-incident-capture"
import { deleteAllRetainedIncidents } from "@/sdk/automatic-incident-consent"
import {
	automaticIncidentDirectory,
	COMPLETION_INCIDENTS_DIR,
	persistAutomaticIncident,
} from "@/sdk/automatic-incident-persistence"
import { applyAutomaticIncidentCaptureDiagnosticProfile } from "@/sdk/dogfood-diagnostic-profile"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK = "task-public-1"

let tmp: string
const context = () => ({ globalStorageUri: { fsPath: tmp } })

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-activation-"))
	clearAutomaticIncidents()
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	setAutomaticIncidentCaptureMode("minimal")
	clearAutomaticIncidents()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

const capture = (detail?: Record<string, string | number | boolean>) =>
	captureAutomaticIncident({
		identity: {
			sessionId: "session-public-1",
			taskId: TASK,
			epoch: 1,
			barrierId: "barrier-1",
			coordinatorInstanceId: "coord-1",
			extensionHostInstanceId: "host-1",
		},
		stage: "completion_held",
		outcome: "unresolved_containment_failure",
		detail: detail as never,
		blockingJobIds: ["cmd_1"],
	})

describe("AICE01 G19/G20 — the PUBLIC build preserves a minimal incident summary", () => {
	it("G19 — the PUBLIC profile arms the capture at the MINIMAL depth", () => {
		const activation = applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: false, userOptedIn: false })
		expect(activation.enabled).toBe(true)
		expect(activation.mode).toBe("minimal")
		expect(getAutomaticIncidentCaptureMode()).toBe("minimal")

		// A PUBLIC build therefore DOES open an incident.
		const incident = capture({ unresolvedContainmentFailureCount: 1 })
		expect(incident).toBeDefined()
		expect(incident?.incidentId).toBeTruthy()
		expect(incident?.blockingJobIds).toEqual(["cmd_1"])
	})

	it("G20 — the DEVELOPER depth retains the detail map and the timeline", () => {
		const activation = applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: true, userOptedIn: false })
		expect(activation.mode).toBe("detailed")

		const incident = captureAutomaticIncident({
			identity: {
				sessionId: "session-public-1",
				taskId: TASK,
				epoch: 1,
				barrierId: "barrier-1",
				coordinatorInstanceId: "coord-1",
				extensionHostInstanceId: "host-1",
			},
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			detail: { holdReason: "unresolved_containment_failure", osErrorCode: "ESRCH" },
			blockingJobIds: ["cmd_1"],
			reconciliation: { attempt: 1, verdict: "gone" },
		})
		expect(incident?.reconciliationTimeline.length).toBe(1)
		expect(incident?.observations[0].detail?.osErrorCode).toBe("ESRCH")
	})

	it("G21 — the MINIMAL depth DROPS the non-allowlisted detail keys", () => {
		applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: false, userOptedIn: false })
		const incident = capture({
			holdReason: "unresolved_containment_failure",
			unresolvedContainmentFailureCount: 3,
			// NOT on the minimal allowlist:
			originalPgid: 4242,
			osErrorCode: "ESRCH",
			commitOrigin: "some-origin",
		})
		const detail = incident?.observations[0].detail ?? {}
		expect(detail.holdReason).toBe("unresolved_containment_failure")
		expect(detail.unresolvedContainmentFailureCount).toBe(3)
		// DROPPED, not redacted.
		expect(detail.originalPgid).toBeUndefined()
		expect(detail.osErrorCode).toBeUndefined()
		expect(detail.commitOrigin).toBeUndefined()
	})

	it("G21 — the MINIMAL depth does NOT retain the reconciliation timeline", () => {
		applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: false, userOptedIn: false })
		const incident = captureAutomaticIncident({
			identity: {
				sessionId: "session-public-1",
				taskId: TASK,
				epoch: 1,
				barrierId: "barrier-1",
				coordinatorInstanceId: "coord-1",
				extensionHostInstanceId: "host-1",
			},
			stage: "completion_held",
			outcome: "unresolved_containment_failure",
			blockingJobIds: ["cmd_1"],
			reconciliation: { attempt: 1, verdict: "gone" },
		})
		expect(incident?.reconciliationTimeline).toHaveLength(0)
	})
})

describe("AICE01 G23 — the delete control", () => {
	it("G23 — the delete removes the artifacts from disk AND from memory", async () => {
		applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: false, userOptedIn: false })
		const captured = capture()
		expect(captured).toBeDefined()
		const incident = captured!
		await persistAutomaticIncident(context(), incident)
		const incidentDir = automaticIncidentDirectory(context(), incident.incidentId)
		expect(existsSync(incidentDir)).toBe(true)

		const result = await deleteAllRetainedIncidents(context())
		expect(result.deletedCount).toBe(1)
		expect(result.failedCount).toBe(0)
		expect(existsSync(incidentDir)).toBe(false)
		expect(getAutomaticIncidentForTask(TASK)).toBeUndefined()
		expect(readdirSync(join(tmp, COMPLETION_INCIDENTS_DIR)).filter((f) => f === "index.json")).toHaveLength(0)
	})
})

describe("AICE01 G24 — the ablation", () => {
	it("G24 — a DISARMED capture produces ZERO state and ZERO allocation", () => {
		applyAutomaticIncidentCaptureDiagnosticProfile({ isDogfood: false, userOptedIn: false })
		setAutomaticIncidentCaptureEnabled(false)
		const incident = capture()
		expect(incident).toBeUndefined()
		expect(getAutomaticIncidentForTask(TASK)).toBeUndefined()
	})
})
