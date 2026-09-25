/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
 *
 * GREEN: H1 bounded repair. For notify-owned active jobs,
 * `command_status(J, waitMs > 0)` returns state=running with a
 * structured `notification: "pending"` payload, does NOT block
 * through the terminal transition, and does NOT fire
 * resolveObligation. The wake is the sole terminal-completion
 * authority.
 *
 * Conservation:
 *   - non-notify command_status(waitMs>0): unchanged
 *   - non-notify command_status(waitMs==0): unchanged
 *   - notify command_status(waitMs==0): unchanged
 *   - notify-owned active waitMs>0: state=running, no marker drain,
 *     wake fires exactly once
 *
 * The GREEN-01 test exercises the real
 * `createCommandStatusTool` + `CommandJobManager.start` +
 * `BackgroundNotifyCoordinator` integration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: () => undefined,
		log: () => undefined,
		warn: () => undefined,
		debug: () => undefined,
		info: () => undefined,
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: () => undefined,
		}),
	},
}))

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

interface WakeSinkEntry {
	sessionId: string
	prompt: string
	id: string
}

class TestWakeSink {
	public readonly queued: WakeSinkEntry[] = []
	private nextId = 0
	// Fire-and-forget mirror of SdkController.ts:738.
	enqueue(input: { sessionId: string; prompt: string }): void {
		const id = `wake_${++this.nextId}`
		this.queued.push({ sessionId: input.sessionId, prompt: input.prompt, id })
	}
	countForSession(sessionId: string): number {
		return this.queued.filter((q) => q.sessionId === sessionId).length
	}
	discardByJobId(sessionId: string, jobId: string): boolean {
		const idx = this.queued.findIndex(
			(q) =>
				q.sessionId === sessionId &&
				q.prompt.startsWith("A background command you asked to be notified about has reached a terminal state.") &&
				q.prompt.includes(`\nJob: ${jobId}\n`),
		)
		if (idx < 0) {
			return false
		}
		this.queued.splice(idx, 1)
		return true
	}
}

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / BNCA-GREEN-01 (H1 repair)", () => {
	const activeSessionId = "sess-bnca-green-01"
	const activeTaskId = "task-bnca-green-01"
	const ctxFor = (): { sessionId: string; agentId: string; iteration: number } => ({
		sessionId: activeSessionId,
		agentId: "test-agent",
		iteration: 1,
	})

	it("BNCA-GREEN-01a: notify-owned active J + waitMs>0 -> command_status returns immediately, suppresses Path B, wake owns completion", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 16,
			maxExecutionDeadlineMs: 30_000,
			maxWaitBudgetMs: 60_000,
		})
		const wakeSink = new TestWakeSink()
		let now = 0
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: ({ sessionId, prompt }) =>
				Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
			discardQueuedWake: ({ sessionId, jobId }) => {
				const removed = wakeSink.discardByJobId(sessionId, jobId)
				return removed
					? { kind: "discarded" as const, jobId, promptId: undefined }
					: { kind: "not_found" as const, jobId }
			},
			now: () => ++now,
		})

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})

		// Start a real background job that sleeps for ~3 seconds.
		const start = await manager.start({
			command: "/bin/sh -c 'sleep 3; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		expect(start.state).toBe("running")

		// Register the marker (mirror run_commands's notify-on-completion path).
		notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})
		// Attach the per-job wake listener (mirror of the listener at
		// vscode-run-commands-tool.ts:808). This is what fires
		// consumeTerminal when the job exits.
		start.terminalPromise.then(async () => {
			const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
			if (!status.ok) {
				return
			}
			const snapshot = status.snapshot
			notifyCoordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: snapshot.state,
				exitCode: snapshot.exitCode,
				reason: snapshot.signal,
				isContainmentFailed: snapshot.state === "containment_failed",
				outputTail: snapshot.stdout?.slice(-1024),
			})
		})
		expect(notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId)).toBe(1)

		// Run command_status with waitMs>0 BEFORE the job exits.
		const t0 = Date.now()
		const result = (await statusTool.execute({ jobId: start.jobId, waitMs: 30_000 }, ctxFor())) as Array<
			Record<string, unknown>
		>
		const elapsedMs = Date.now() - t0

		// H1 contract: command_status returns IMMEDIATELY (well before
		// the 30s budget) with state=running and notification=pending.
		expect(elapsedMs).toBeLessThan(2_000)
		expect(result).toHaveLength(1)
		const out = result[0] as Record<string, unknown>
		expect(out.ok).toBe(true)
		expect(out.state).toBe("running")
		expect(out.notification).toBe("pending")
		expect(out.jobId).toBe(start.jobId)
		// Marker is NOT drained (Path B suppressed).
		expect(notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId)).toBe(1)

		// Now wait for the job to exit and Path A to fire.
		for (let i = 0; i < 60; i += 1) {
			if (manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		expect(manager.activeCount).toBe(0)

		// Wait for the listener to call consumeTerminal.
		// The listener fires from terminalPromise.then async; we need
		// a microtask hop.
		for (let i = 0; i < 50; i += 1) {
			if (wakeSink.countForSession(activeSessionId) >= 1) break
			await new Promise((r) => setTimeout(r, 50))
		}
		// Wake fired exactly once.
		expect(wakeSink.countForSession(activeSessionId)).toBe(1)
		expect(notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId)).toBe(0)

		// Now a SECOND command_status call (waitMs==0) on the
		// already-terminal job: marker is gone, behavior unchanged
		// from the original baseline.
		const result2 = (await statusTool.execute({ jobId: start.jobId, waitMs: 0 }, ctxFor())) as Array<Record<string, unknown>>
		const out2 = result2[0] as Record<string, unknown>
		expect(out2.state).not.toBe("running")

		notifyCoordinator.dispose()
		await manager.dispose()
	}, 30_000)

	it("BNCA-GREEN-01b: NON-notify active J + waitMs>0 -> existing blocking behavior unchanged", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 16,
			maxExecutionDeadlineMs: 30_000,
			maxWaitBudgetMs: 60_000,
		})
		const wakeSink = new TestWakeSink()
		let now = 0
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: ({ sessionId, prompt }) =>
				Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
			now: () => ++now,
		})

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})

		// NO marker registration (notify=false equivalent).
		const start = await manager.start({
			command: "/bin/sh -c 'exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		expect(start.state).toBe("running")

		// Wait for the job to exit.
		for (let i = 0; i < 50; i += 1) {
			if (manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}

		// command_status(waitMs>0) on a NON-notify job: blocks if
		// still running, otherwise returns immediately with state.
		const result = (await statusTool.execute({ jobId: start.jobId, waitMs: 5_000 }, ctxFor())) as Array<
			Record<string, unknown>
		>
		const out = result[0] as Record<string, unknown>
		// Existing behavior: returns the terminal state.
		expect(out.ok).toBe(true)
		expect(out.state).not.toBe("running")
		// No wake (no notify ownership).
		expect(wakeSink.countForSession(activeSessionId)).toBe(0)
		// No notification field (only set when H1 short-circuits).
		expect(out.notification).toBeUndefined()

		notifyCoordinator.dispose()
		await manager.dispose()
	}, 30_000)

	it("BNCA-GREEN-01c: notify-owned active J + waitMs==0 -> existing non-blocking behavior unchanged", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 16,
			maxExecutionDeadlineMs: 30_000,
			maxWaitBudgetMs: 60_000,
		})
		const wakeSink = new TestWakeSink()
		let now = 0
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: ({ sessionId, prompt }) =>
				Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
			now: () => ++now,
		})

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})

		const start = await manager.start({
			command: "/bin/sh -c 'sleep 5; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		expect(start.state).toBe("running")
		notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		// waitMs==0 returns immediately. Marker is preserved (state=running,
		// resolveObligation NOT fired). Wake still pending.
		const result = (await statusTool.execute({ jobId: start.jobId, waitMs: 0 }, ctxFor())) as Array<Record<string, unknown>>
		const out = result[0] as Record<string, unknown>
		expect(out.ok).toBe(true)
		expect(out.state).toBe("running")
		// H1 only fires for waitMs>0; waitMs==0 path is unchanged.
		expect(out.notification).toBeUndefined()
		expect(notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId)).toBe(1)

		notifyCoordinator.dispose()
		await manager.dispose()
	}, 30_000)
})
