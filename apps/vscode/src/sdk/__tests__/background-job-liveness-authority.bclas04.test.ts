/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * BCLAS-04 — manager diagnostic identity distinguishes two managers
 * (LA2 POSITIVE).
 *
 * Mechanical invariant: when TWO `CommandJobManager` instances are
 * constructed, each receives a UNIQUE diagnostic identity token
 * (`M1`, `M2`, …). The capture seam records the per-instance token
 * on every load-bearing lifecycle event. The same identity helper
 * returns the same token for the same object reference (idempotent
 * lookup), and a different token for a different reference.
 *
 * This is the load-bearing discriminator for the LA2 hypothesis:
 * if the LIVE dump shows `managerInstance=M1` at `job_active_inserted`
 * and `managerInstance=M2` at the Q5 guard capture, the dump is
 * mechanical proof of a manager-instance split.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	getDiagnosticManagerId,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	type BackgroundJobLivenessAuthorityJobActiveInsertedRecord,
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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 / BCLAS-04", () => {
	it("two distinct managers carry distinct diagnostic identity tokens", () => {
		const managerA = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const managerB = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const tokenA = getDiagnosticManagerId(managerA)
		const tokenB = getDiagnosticManagerId(managerB)
		expect(tokenA).not.toBeNull()
		expect(tokenB).not.toBeNull()
		expect(tokenA).not.toBe(tokenB)
		// Idempotent lookup: same reference → same token.
		expect(getDiagnosticManagerId(managerA)).toBe(tokenA)
		expect(getDiagnosticManagerId(managerB)).toBe(tokenB)
	})

	it("a job started in managerA is recorded against tokenA; managerB sees nothing", async () => {
		const managerA = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const managerB = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const tokenA = getDiagnosticManagerId(managerA)
		const tokenB = getDiagnosticManagerId(managerB)
		expect(tokenA).not.toBeNull()
		expect(tokenB).not.toBeNull()
		if (!tokenA || !tokenB) return

		const start = await managerA.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(start.state).toBe("running")

		// Manager B's status lookup sees the same jobId but with
		// source="miss" — and the managerInstance token is B's,
		// not A's. This is the LA2 discriminator pattern: same
		// jobId, two different manager-instance tokens, one
		// contains the job and one does not.
		const statusB = await managerB.status({ jobId: start.jobId, waitMs: 0 })
		expect(statusB.ok).toBe(false)

		const records = getBackgroundJobLivenessAuthorityCaptureRecords()
		const inserts = records.filter(
			(r): r is BackgroundJobLivenessAuthorityJobActiveInsertedRecord =>
				r.event === "job_active_inserted" && r.jobId === start.jobId,
		)
		const lookups = records.filter(
			(r): r is BackgroundJobLivenessAuthorityJobStatusLookupRecord =>
				r.event === "job_status_lookup" && r.jobId === start.jobId,
		)
		expect(inserts.length).toBeGreaterThanOrEqual(1)
		expect(inserts.every((r) => r.managerInstance === tokenA)).toBe(true)
		expect(lookups.some((l) => l.managerInstance === tokenB && l.source === "miss")).toBe(true)
	})
})
