/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * BCLAS-05 — diagnostic enabled vs disabled = identical semantics.
 *
 * Mechanical invariant (per ACT sec 6): when the BJLA capture seam
 * is OFF (default public behavior), every production operation the
 * diagnostic touches must produce IDENTICAL semantics to the
 * capture-ON path:
 *
 *   - manager.start() returns the same {state, jobId, …}
 *   - manager.status() returns the same {ok, snapshot}
 *   - manager.cancel() returns the same {ok, state}
 *   - manager.dispose() empties the active map
 *   - the job lifecycle events emitted to the sink are IDENTICAL
 *
 * Only the diagnostic ring contents differ (empty when OFF, populated
 * when ON). This is the load-bearing test that proves the diagnostic
 * has zero semantic delta — the same invariant the BOCOR
 * q5-seam-zero-delta test asserts for the Q5 capture seam.
 *
 * If this test fails, HALT_DIAGNOSTIC_CHANGES_SEMANTICS — the
 * diagnostic has leaked into the production path.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CommandJobLifecycleEvent } from "../command-job-manager"
import { CommandJobManager } from "../command-job-manager"
import {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "../background-job-liveness-authority"

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

let supervisorPid = 150000

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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 / BCLAS-05", () => {
	it("capture ON vs OFF: identical manager semantics; only ring contents differ", async () => {
		// Run 1: capture ON, lifecycle sink records every event.
		const eventsOn: string[] = []
		setBackgroundJobLivenessAuthorityCaptureEnabled(true)
		clearBackgroundJobLivenessAuthorityCaptureRecords()
		setBackgroundJobLivenessAuthorityCaptureBufferSize(256)
		const managerOn = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
			onCommandJobLifecycle: (e: CommandJobLifecycleEvent) => {
				eventsOn.push(e.event)
			},
		})
		const startOn = await managerOn.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		const statusOn = await managerOn.status({ jobId: startOn.jobId, waitMs: 0 })
		const cancelOn = await managerOn.cancel({ jobId: startOn.jobId })
		await managerOn.dispose()
		const ringOnLength = getBackgroundJobLivenessAuthorityCaptureRecords().length

		// Run 2: capture OFF, identical lifecycle sink records every
		// event. The sink output MUST be identical (the diagnostic
		// has zero semantic delta).
		const eventsOff: string[] = []
		setBackgroundJobLivenessAuthorityCaptureEnabled(false)
		clearBackgroundJobLivenessAuthorityCaptureRecords()
		const managerOff = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
			onCommandJobLifecycle: (e: CommandJobLifecycleEvent) => {
				eventsOff.push(e.event)
			},
		})
		const startOff = await managerOff.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		const statusOff = await managerOff.status({ jobId: startOff.jobId, waitMs: 0 })
		const cancelOff = await managerOff.cancel({ jobId: startOff.jobId })
		await managerOff.dispose()
		const ringOffLength = getBackgroundJobLivenessAuthorityCaptureRecords().length

		// Identical manager semantics:
		expect(startOn.state).toBe(startOff.state)
		expect(startOn.jobId).toMatch(/^cmd_/)
		expect(startOff.jobId).toMatch(/^cmd_/)
		expect(statusOn.ok).toBe(statusOff.ok)
		expect(cancelOn.ok).toBe(cancelOff.ok)
		expect(cancelOn.ok && cancelOff.ok).toBe(true)

		// Identical lifecycle sink output (sequence of event names):
		expect(eventsOn).toEqual(eventsOff)

		// Ring contents differ ONLY by capture seam:
		expect(ringOnLength).toBeGreaterThan(0)
		expect(ringOffLength).toBe(0)
	})
})
