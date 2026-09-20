/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * BCLAS-02 — legitimate finalize → snapshot loses job exactly once
 * (LA1 NEGATIVE).
 *
 * Mechanical invariant: when a job transitions from active to a
 * clean terminal class (`exited` / `deadline_exceeded` / `cancelled` /
 * `spawn_failed`), the BJLA capture seam records EXACTLY ONE
 * `job_active_removed` for that jobId, with `previousState="running"`
 * and the resolved `terminalState`. Subsequent lookups against the
 * same manager observe `source="terminal"` (or `source="miss"` if
 * the terminal map has already evicted) — never a SECOND
 * `job_active_removed` for the same jobId.
 *
 * The test is the GREEN baseline that proves the LA1 discriminator
 * can detect "premature removal" (multiple `job_active_removed`
 * events for the same jobId) vs "legitimate finalize" (exactly one).
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	type BackgroundJobLivenessAuthorityJobActiveRemovedRecord,
	type BackgroundJobLivenessAuthorityJobStatusLookupRecord,
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

let supervisorPid = 120000

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
			resolveExit(0)
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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 / BCLAS-02", () => {
	it("legitimate finalize emits exactly one job_active_removed with terminalState=cancelled", async () => {
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})

		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(start.state).toBe("running")

		await manager.cancel({ jobId: start.jobId })

		const records = getBackgroundJobLivenessAuthorityCaptureRecords()
		const removals = records.filter(
			(r): r is BackgroundJobLivenessAuthorityJobActiveRemovedRecord =>
				r.event === "job_active_removed" && r.jobId === start.jobId,
		)
		expect(removals).toHaveLength(1)
		expect(removals[0].previousState).toBe("running")
		expect(removals[0].terminalState).toBe("cancelled")
		expect(removals[0].reason).toBe("cancel")

		// Subsequent lookups see the terminal map (not active).
		const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (!status.ok) return

		const lookups = records.filter(
			(r): r is BackgroundJobLivenessAuthorityJobStatusLookupRecord =>
				r.event === "job_status_lookup" && r.jobId === start.jobId,
		)
		// At least one lookup was against `terminal` (post-cancel).
		// The pre-cancel `active` source bucket may or may not have
		// been observed by a status lookup in this test scenario
		// (the BCLAS-01 test exercises the `active` source path
		// explicitly; here we only assert the LA1 discriminator
		// invariants for the terminal transition).
		const terminalLookup = lookups.find((r) => r.source === "terminal")
		expect(terminalLookup).toBeDefined()
	})
})
