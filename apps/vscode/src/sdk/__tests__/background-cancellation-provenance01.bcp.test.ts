/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01
 *
 * BCP — Background Cancellation Provenance.
 *
 * Mechanical invariants for the `job_cancellation_requested` capture
 * seam at the REQUEST BOUNDARY (BEFORE `CommandJobManager.terminate()`
 * mutates any state).
 *
 * The events captured here MUST be deterministic: exactly ONE primary
 * record per LIVE cycle, with `requestOrigin` populated by the threaded
 * caller identity (NEVER inferred from stack traces). Capture is OFF by
 * default; the helper is a complete no-op when capture is OFF so the
 * production semantics are unchanged.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type BackgroundJobLivenessAuthorityJobCancellationRequestedRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "../background-job-liveness-authority"
import { CommandJobManager } from "../command-job-manager"

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	setBackgroundJobLivenessAuthorityCaptureBufferSize(128)
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

let supervisorPid = 200000

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

function requestRecords(): BackgroundJobLivenessAuthorityJobCancellationRequestedRecord[] {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r): r is BackgroundJobLivenessAuthorityJobCancellationRequestedRecord => r.event === "job_cancellation_requested",
	)
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01 / BCP-01", () => {
	it("captures background_cancel_rpc at the request boundary of commandJobManager.cancel({origin:'background_cancel_rpc'})", async () => {
		// The VscodeSessionHost.cancelBackgroundCommand chain threads
		// `origin: "background_cancel_rpc"` into commandJobManager.cancel().
		// The public cancel() seam records the request boundary BEFORE
		// this.terminate() mutates state.
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			spawnFactory: () => fakeSupervisor(),
		})
		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(start.state).toBe("running")

		const result = await manager.cancel({ jobId: start.jobId, origin: "background_cancel_rpc" })
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.state).toBe("cancelled")

		const reqs = requestRecords()
		const matching = reqs.filter((r) => r.jobId === start.jobId)
		expect(matching).toHaveLength(1)
		expect(matching[0].requestOrigin).toBe("background_cancel_rpc")
		expect(matching[0].currentState).toBe("running")
		expect(matching[0].firstWriterWins).toBe(true)
		expect(matching[0].managerInstance).toBeTruthy()
	})
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01 / BCP-02", () => {
	it("captures extension_shutdown for every job terminated by the dispose loop", async () => {
		// The VscodeSessionHost.dispose chain calls
		// commandJobManager.dispose("extension_shutdown"), which
		// records the request boundary for each active job with the
		// threaded origin label.
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			spawnFactory: () => fakeSupervisor(),
		})
		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		const b = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(a.state).toBe("running")
		expect(b.state).toBe("running")

		await manager.dispose("extension_shutdown")

		const reqs = requestRecords()
		const aReqs = reqs.filter((r) => r.jobId === a.jobId)
		const bReqs = reqs.filter((r) => r.jobId === b.jobId)
		expect(aReqs).toHaveLength(1)
		expect(bReqs).toHaveLength(1)
		expect(aReqs[0].requestOrigin).toBe("extension_shutdown")
		expect(bReqs[0].requestOrigin).toBe("extension_shutdown")
		expect(aReqs[0].firstWriterWins).toBe(true)
		expect(bReqs[0].firstWriterWins).toBe(true)
	})
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01 / BCP-03", () => {
	it("captures command_deadline when the watchdog timer fires", async () => {
		// Build a supervisor that does NOT resolve the exit promise on
		// terminateTree, so the deadline timer can fire while the job
		// is still in the `running` state (which is the production
		// shape for the LIVE specimen).
		let resolveExit: (code: number | null) => void = () => {}
		const exitPromise = new Promise<number | null>((resolve) => {
			resolveExit = resolve
		})
		const supervisor: SupervisableShellProcess = Object.freeze({
			exit: exitPromise as unknown as Promise<never>,
			pid: 300001,
			pgid: 300002,
			killTree: async () => {},
			terminateTree: async () => ({
				treeTerminated: true,
				pgidResolved: true,
				pgid: 300002,
			}),
			getCompletionDetails: () => undefined,
			stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
			stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
			hasExited: () => false,
			readonly: { on: () => {}, off: () => {} },
			stdin: { write: () => true, end: () => true },
		}) as unknown as SupervisableShellProcess

		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			spawnFactory: () => supervisor,
		})
		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 50,
		})
		expect(start.state).toBe("running")
		// Wait for the deadline watchdog to fire.
		await new Promise((r) => setTimeout(r, 250))

		const reqs = requestRecords()
		const matching = reqs.filter((r) => r.jobId === start.jobId)
		expect(matching).toHaveLength(1)
		expect(matching[0].requestOrigin).toBe("command_deadline")
		expect(matching[0].firstWriterWins).toBe(true)
	})
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01 / BCP-04", () => {
	it("capture OFF produces identical termination semantics", async () => {
		setBackgroundJobLivenessAuthorityCaptureEnabled(false)

		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			spawnFactory: () => fakeSupervisor(),
		})
		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		const result = await manager.cancel({ jobId: start.jobId, origin: "background_cancel_rpc" })
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.state).toBe("cancelled")

		// With capture OFF, the ring is empty — no records produced.
		expect(getBackgroundJobLivenessAuthorityCaptureRecords()).toHaveLength(0)

		// The terminal state is still `cancelled` — semantics unchanged.
		const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (status.ok) {
			expect(status.snapshot.state).toBe("cancelled")
		}
	})
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01 / BCP-05", () => {
	it("exactly one primary request-origin record per LIVE cycle (FIRST-WRITER-WINS + idempotent cancel)", async () => {
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 5_000,
			spawnFactory: () => fakeSupervisor(),
		})
		const start = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(start.state).toBe("running")

		// First cancel — should be the writer.
		await manager.cancel({ jobId: start.jobId, origin: "background_cancel_rpc" })
		// Second cancel — same jobId; production cancel() is
		// idempotent: when `job.state !== "running"` it returns early
		// WITHOUT reaching the request-boundary capture. This is the
		// correct cardinality invariant — exactly ONE primary
		// request per LIVE cycle.
		await manager.cancel({ jobId: start.jobId, origin: "background_cancel_rpc" })

		const reqs = requestRecords()
		const matching = reqs.filter((r) => r.jobId === start.jobId)
		const primaryWriters = matching.filter((r) => r.firstWriterWins)
		expect(primaryWriters).toHaveLength(1)
		expect(primaryWriters[0].requestOrigin).toBe("background_cancel_rpc")
	})
})
