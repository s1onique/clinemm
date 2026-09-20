/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * BCLAS-01 — same manager start → snapshot sees job (LA2 NEGATIVE).
 *
 * Mechanical invariant: when a single `CommandJobManager` instance
 * inserts a job into `active` and a later status read is performed
 * against the SAME manager, the BJLA capture seam records matching
 * `managerInstance` for `job_active_inserted` and `job_status_lookup`,
 * AND the `job_status_lookup` record reports `source="active"`,
 * `returnedState="running"`.
 *
 * The test is the GREEN baseline that proves the LA2 discriminator
 * can distinguish "same manager" from "split manager". If this test
 * fails with capture ON, the diagnostic identity correlation is
 * broken (test seam defect, not production defect). If it fails with
 * capture OFF, the production path itself regressed (HALT).
 *
 * Uses the same fakeSupervisor pattern as
 * background-owner-correlation-q5-seam-zero-delta.bocorq5.test.ts
 * so no real shell is required.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	captureBackgroundJobLivenessAuthorityRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	getDiagnosticManagerId,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	type BackgroundJobLivenessAuthorityJobActiveInsertedRecord,
	type BackgroundJobLivenessAuthorityJobStatusLookupRecord,
} from "../background-job-liveness-authority"
import { CommandJobManager } from "../command-job-manager"

// Disable the experimental sandbox (mirrors the BOCOR tests).
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

let supervisorPid = 110000

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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 / BCLAS-01", () => {
	it("same manager start → snapshot sees job (active-map insert + status lookup correlate on managerInstance)", async () => {
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		// Force identity assignment BEFORE the start so the
		// diagnostic helper has the manager on file.
		const managerInstance = getDiagnosticManagerId(manager)
		expect(managerInstance).not.toBeNull()

		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(start.state).toBe("running")

		const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (!status.ok) return

		const records = getBackgroundJobLivenessAuthorityCaptureRecords()
		const inserted = records.find(
			(r): r is BackgroundJobLivenessAuthorityJobActiveInsertedRecord =>
				r.event === "job_active_inserted" && r.jobId === start.jobId,
		)
		const lookedUp = records.find(
			(r): r is BackgroundJobLivenessAuthorityJobStatusLookupRecord =>
				r.event === "job_status_lookup" && r.jobId === start.jobId,
		)
		expect(inserted).toBeDefined()
		expect(lookedUp).toBeDefined()
		if (!inserted || !lookedUp) return

		// BCLAS-01 invariant: same manager → same diagnostic token.
		expect(inserted.managerInstance).toBe(managerInstance)
		expect(lookedUp.managerInstance).toBe(managerInstance)
		// Status lookup identifies the source bucket AND the
		// returned state — the load-bearing discriminator for
		// LA1 (premature removal) and LA4 (status source split).
		expect(lookedUp.source).toBe("active")
		expect(lookedUp.returnedState).toBe("running")

		// Sanity: the helper is a complete no-op when capture is OFF
		// (verified exhaustively by BCLAS-05).
		await manager.cancel({ jobId: start.jobId })
		const finalStatus = await manager.status({ jobId: start.jobId, waitMs: 0 })
		expect(finalStatus.ok).toBe(true)
		if (finalStatus.ok) {
			expect(finalStatus.snapshot.state).not.toBe("running")
		}
	})

	it("capture helper is a no-op when the seam is OFF (default)", () => {
		setBackgroundJobLivenessAuthorityCaptureEnabled(false)
		clearBackgroundJobLivenessAuthorityCaptureRecords()
		captureBackgroundJobLivenessAuthorityRecord({
			event: "manager_constructed",
			capturedAt: Date.now(),
			managerInstance: "M-fake",
			hostInstance: null,
			source: null,
		})
		expect(getBackgroundJobLivenessAuthorityCaptureRecords()).toHaveLength(0)
	})
})
