/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * BCLAS-06 — process terminality discriminator (LA1).
 *
 * Mechanical invariant: when a `CommandJobManager` emits a lifecycle
 * event from the terminality-adjacent vocabulary
 * (`command_job_termination_started`, `command_job_primary_group_cleanup`,
 * `command_job_terminal_committed`, `command_job_residual_detected`,
 * `command_job_containment_failed`), the BJLA ring carries a
 * `process_terminality_record` whose `postcondition` field reflects
 * the production value verbatim — `"gone" | "alive" | "eperm" | "unknown" | null`.
 *
 * This is the load-bearing discriminator for the LA1 hypothesis:
 * if the LIVE dump shows `process_terminality_record` with
 * `eventName === "command_job_primary_group_cleanup"` and
 * `postcondition === "gone"` for the jobId AND no
 * `eventName === "command_job_terminal_committed"` event for the same
 * jobId during the dump window, the dump is mechanical proof of a
 * premature finalization (LA1 POSITIVE).
 *
 * Conversely, the absence of any `process_terminality_record` for a
 * jobId in the dump window, combined with the absence of the
 * `job_active_removed` event, is the LA1 NEGATIVE case (job never
 * went through the terminality code path during the dump window).
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	type BackgroundJobLivenessAuthorityProcessTerminalityRecord,
} from "../background-job-liveness-authority"
import { CommandJobManager } from "../command-job-manager"

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	setBackgroundJobLivenessAuthorityCaptureBufferSize(64)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
})

let supervisorPid = 140000

function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: ++supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(null)
			return {
				treeTerminated: true,
				pgidResolved: true,
				pgid: supervisorPid,
			}
		},
		getCompletionDetails: () => undefined,
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		hasExited: () => false,
		readonly: { on: () => {}, off: () => {} },
		stdin: { write: () => true, end: () => true },
	}) as unknown as SupervisableShellProcess
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 / BCLAS-06", () => {
	it("captures `process_terminality_record` for command_job_primary_group_cleanup with the production postcondition", async () => {
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5000,
			spawnFactory: () => fakeSupervisor(),
		})
		const start = await manager.start({
			command: "echo LA1",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 10000,
		})
		const jobId = start.jobId
		// Use the public cancel() path; it routes through finalize() and
		// emits `command_job_primary_group_cleanup` with the production
		// postcondition field. The manager runs the
		// terminalPostconditionProbe synchronously inside finalize() and
		// the verdict is one of "gone" | "alive" | "eperm" | "unknown"
		// depending on whether the test sandbox actually had a real
		// PGID. The diagnostic capture is verbatim.
		await manager.cancel({ jobId })
		const records = getBackgroundJobLivenessAuthorityCaptureRecords()
		const terminalityRecords = records.filter(
			(r): r is BackgroundJobLivenessAuthorityProcessTerminalityRecord =>
				r.event === "process_terminality_record" && r.jobId === jobId,
		)
		expect(terminalityRecords.length).toBeGreaterThan(0)
		const cleanupRecord = terminalityRecords.find(
			(r) => r.eventName === "command_job_primary_group_cleanup",
		)
		expect(cleanupRecord).toBeDefined()
		// The postcondition field is the production value verbatim.
		// On the IDE sandboxed shell the probe may surface "eperm";
		// on a non-sandboxed host it should be "gone". Either is a
		// valid verdict; the diagnostic capture is verbatim.
		expect(["gone", "alive", "eperm", "unknown"]).toContain(cleanupRecord!.postcondition)
		expect(cleanupRecord!.eventName).toBe("command_job_primary_group_cleanup")
		expect(cleanupRecord!.jobState).toBeDefined()
	})

	it("non-terminality lifecycle events do NOT produce a process_terminality_record (LA1 NEGATIVE when no terminality evidence)", async () => {
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5000,
			spawnFactory: () => fakeSupervisor(),
		})
		const start = await manager.start({
			command: "echo no-terminate",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 10000,
		})
		const jobId = start.jobId
		// A status lookup is NOT terminality-adjacent; it must NOT
		// produce a process_terminality_record. The status lookup
		// does produce a `job_status_lookup` record, which is a
		// separate event. Use a deadline (10s) well above the
		// status call so the deadline watchdog does NOT fire and
		// the job remains RUNNING while we query its status.
		// Use `waitMs: 0` to make the call strictly synchronous:
		// any wait > 0 races against the exitTransition promise,
		// which would short-circuit the LA1 NEGATIVE assertion.
		await manager.status({ jobId, waitMs: 0 })
		const records = getBackgroundJobLivenessAuthorityCaptureRecords()
		const terminalityRecords = records.filter(
			(r) => r.event === "process_terminality_record" && r.jobId === jobId,
		)
		expect(terminalityRecords).toHaveLength(0)
		// But the status lookup IS captured (LA4 discriminator).
		const statusRecords = records.filter((r) => r.event === "job_status_lookup" && r.jobId === jobId)
		expect(statusRecords).toHaveLength(1)
	})
})
