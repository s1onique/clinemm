/**
 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01 / REC integration tests
 *
 * File: apps/vscode/src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts
 *
 * Backend composition tests for the `CommandJobManager` →
 * `onRuntimeError` sink seam. The tracker's own unit tests live in
 * `task-telemetry-tracker.test.ts` (REC-01..REC-12); this file proves
 * the host composition:
 *
 *   CommandJobManager.cancel(jobId)
 *     -> terminateTree({ gracefulSignal: "SIGTERM", graceMs })
 *        -> TerminateTreeResult.epermDetected === true
 *     -> reportRuntimeError({ errorClass: "EPERM", source: "command-job-manager", correlationId: job.id })
 *     -> host sink (the SdkController's handleTaskRuntimeError closure)
 *        -> TaskTelemetryTracker.recordRuntimeError(incident)
 *        -> wire strip.runtimeErrorCount = N
 *
 * We use the public `spawnFactory` injection seam (review-correction04
 * in CommandJobManagerOptions) to drive a fake SupervisableShellProcess
 * whose `terminateTree` returns a deterministic EPERM result.
 *
 * Like `host-helper-pgid-adapter.test.ts`, we set
 * `CLINEMM_EXPERIMENTAL_SANDBOX=off` so the manager takes the legacy
 * direct-spawn path. Without this, the Seatbelt substrate is
 * unavailable in the vitest worker environment and the manager routes
 * through `backend.prepare()` which fails with `spawn_failed`.
 */

import type { SupervisableShellProcess } from "@cline/core"
import type { RuntimeErrorIncident } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"

interface FakeProcessOptions {
	readonly epermDetected: boolean
	readonly treeTerminated?: boolean
	readonly escalatedToKill?: boolean
}

function fakeShellProcess(opts: FakeProcessOptions): SupervisableShellProcess {
	const treeTerminated = opts.treeTerminated ?? !opts.epermDetected
	const escalatedToKill = opts.escalatedToKill ?? opts.epermDetected
	const pid = 90_000_000 + Math.floor(Math.random() * 9_000_000)
	const pgid = pid
	let exitResolve: ((value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		exitResolve = resolve
	})
	const emptySnap = () => ({ text: "", totalChars: 0, dropped: false })
	return {
		pid,
		pgid,
		exit,
		killTree: async () => {},
		terminateTree: async () => {
			exitResolve?.({ exitCode: null, signal: opts.epermDetected ? "SIGKILL" : "SIGTERM" })
			return {
				treeTerminated,
				escalatedToKill,
				epermDetected: opts.epermDetected,
			}
		},
		stdoutSnapshot: emptySnap,
		stderrSnapshot: emptySnap,
	}
}

describe("ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01 / CommandJobManager onRuntimeError composition", () => {
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

	it("REC-BE-01: epermDetected=true invokes onRuntimeError exactly once with EPERM class and command-job-manager source", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			expect(start.state).toBe("running")
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
			expect(incidents).toHaveLength(1)
			expect(incidents[0].errorClass).toBe("EPERM")
			expect(incidents[0].source).toBe("command-job-manager")
			expect(incidents[0].correlationId).toBe(start.jobId)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-02: epermDetected=false does NOT invoke onRuntimeError (clean direct termination)", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: false }),
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
			expect(incidents).toHaveLength(0)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-03: helper-recovery success does NOT suppress the onRuntimeError callback (EPERM still counted)", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			helperOwnedPgidProvider: {
				clientOpen: async () => ({ clientToken: "fake-client-token" }),
				registerOwned: async () => ({ jobToken: "fake-job-token" }),
				terminateOwned: async () => ({ ok: true, outcome: "TERMINATED_KILL" }),
				releaseOwned: async () => undefined,
				clientClose: async () => undefined,
			},
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
			expect(incidents).toHaveLength(1)
			expect(incidents[0].errorClass).toBe("EPERM")
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-04: two independent jobs each produce one independent EPERM incident", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const a = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const b = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: a.jobId })
			await manager.cancel({ jobId: b.jobId })
			expect(incidents).toHaveLength(2)
			const ids = new Set(incidents.map((i) => i.correlationId))
			expect(ids.size).toBe(2)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-05: idempotent cancel after first EPERM does NOT double-count", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: start.jobId })
			const second = await manager.cancel({ jobId: start.jobId })
			expect(second.ok).toBe(true)
			expect(incidents).toHaveLength(1)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-06: onRuntimeError sink that throws does NOT break the cancel flow", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: () => {
				throw new Error("simulated tracker bug")
			},
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-07: no onRuntimeError sink supplied → manager silently drops incidents", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-08: ordinary exit (no EPERM) does NOT increment — counter stays 0", async () => {
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sh -c 'exit 23'",
				cwd: process.cwd(),
				waitBudgetMs: 1000,
				executionDeadlineMs: 60_000,
			})
			await manager.status({ jobId: start.jobId, waitMs: 5_000 })
			expect(incidents).toHaveLength(0)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-09: clean direct termination (epermDetected=false) does NOT invoke onRuntimeError", async () => {
		// Pin the "EPERM is the ONLY trigger" invariant for future
		// refactors: terminateTree returning
		// `{ treeTerminated: true, escalatedToKill: false, epermDetected: false }`
		// must NOT produce an incident.
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: false, treeTerminated: true }),
			onRuntimeError: (i) => incidents.push(i),
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: start.jobId })
			expect(incidents).toHaveLength(0)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-10: end-to-end — fake-shell EPERM + tracker + wire strip = runtimeErrorCount = 1", async () => {
		// Full composition: prove the SdkController-style closure
		// (recordRuntimeError + post state) wires the structured
		// EPERM straight through to the wire strip.
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a", 1_700_000_000_000)
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: (i) => {
				incidents.push(i)
				tracker.recordRuntimeError(i)
			},
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: start.jobId })
			expect(incidents).toHaveLength(1)
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			const snap = tracker.get()
			expect(snap?.runtimeErrorCount).toBe(1)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-11: two sequential jobs under the SAME tracker → wire strip = runtimeErrorCount = 2", async () => {
		// Mirrors the production shape: one tracker bound to one
		// task; multiple jobs under it. The counter must accumulate.
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a", 1_700_000_000_000)
		const manager = new CommandJobManager({
			spawnFactory: () => fakeShellProcess({ epermDetected: true }),
			onRuntimeError: (i) => tracker.recordRuntimeError(i),
		})
		try {
			const a = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			const b = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: a.jobId })
			await manager.cancel({ jobId: b.jobId })
			expect(tracker.currentRuntimeErrorCount).toBe(2)
			const snap = tracker.get()
			expect(snap?.runtimeErrorCount).toBe(2)
		} finally {
			await manager.dispose()
		}
	})

	it("REC-BE-12: tracker bound to task A does NOT see EPERM from task B (task isolation at the manager→tracker boundary)", async () => {
		// A tracker is rebound to a new task (B). An EPERM under
		// task B must NOT pollute task A's wire strip — but
		// because the tracker is rebound BEFORE the EPERM
		// arrives, this test really verifies the clean-handoff
		// invariant: the tracker held by `manager.onRuntimeError`
		// is whatever closure it was given at construction time,
		// and `recordRuntimeError` updates the currently bound
		// task identity. This is the load-bearing seam for
		// TASK_ERROR_COUNTER_ISOLATION in the host.
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-A", 1_700_000_000_000)
		// task A's first incident
		tracker.recordRuntimeError({
			errorClass: "EPERM",
			source: "command-job-manager",
			correlationId: "job-a",
		})
		expect(tracker.currentRuntimeErrorCount).toBe(1)
		// Rebind to task B — counter must reset.
		tracker.startTask("task-B", 1_700_000_001_000)
		expect(tracker.currentRuntimeErrorCount).toBe(0)
		expect(tracker.get()?.runtimeErrorCount).toBeUndefined()
		// task B's incident
		tracker.recordRuntimeError({
			errorClass: "EPERM",
			source: "command-job-manager",
			correlationId: "job-b",
		})
		expect(tracker.currentRuntimeErrorCount).toBe(1)
		expect(tracker.get()?.runtimeErrorCount).toBe(1)
	})
})
