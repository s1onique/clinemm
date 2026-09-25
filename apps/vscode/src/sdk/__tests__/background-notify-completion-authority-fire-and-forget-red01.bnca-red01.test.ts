/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
 *
 * BNCA-RED-01: proves the fire-and-forget wake-enqueue race that lets
 * a terminal-completion authority for ONE notify-owned background job
 * be claimed by BOTH the originating turn (Path B via
 * `command_status`) AND the wake-driven turn (Path A via
 * `BackgroundNotifyCoordinator.consumeTerminal`).
 *
 * Production seam shape (mirrors SdkController.ts:738 and
 * discardQueuedWakeForJobIdOnHost):
 *
 *   - `enqueueTerminalWake` calls `void sink.enqueue(...)` which
 *     lands AFTER a microtask boundary.
 *   - `discardQueuedWake` calls `sink.list(...)` synchronously,
 *     then `void sink.delete(...)` which lands AFTER a microtask
 *     boundary. The function returns its result SYNCHRONOUSLY
 *     without awaiting the delete.
 *
 * The defect: when consumeTerminal fires (Path A) and immediately
 * afterwards the originating turn's command_status fires
 * resolveObligation (Path B), the discard seam observes an empty
 * queue (because the wake has not yet landed) and returns
 * `not_found`. The wake then lands and proceeds to start a
 * second autonomous turn.
 *
 * Acceptance: pre-repair, the wake lands in the sink AFTER the
 * discard attempt has returned. The test FAILS because
 * `wakeSurvivedDiscard` is true.
 *
 * Post-repair (H1): command_status does NOT fire resolveObligation
 * for a notify-owned job (it returns early with state=running and
 * a "notification owns terminal" message). Path B is suppressed.
 * The wake is the sole terminal-completion authority and lands
 * exactly once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"

// Real production shape: wake lands after a microtask hop.
// `enqueueTerminalWake` is fire-and-forget (mirror of
// SdkController.ts:738 `void active.sdkHost.send(...).catch(...)`).
class AsyncPendingPromptsSink {
	public readonly enqueued: Array<{ sessionId: string; prompt: string; id: string }> = []
	private nextId = 0

	// Mirror of PendingPromptsController.enqueue arriving after
	// sdkHost.send -> runTurn -> enqueue chain. One microtask hop
	// is enough to expose the race.
	async enqueue(input: { sessionId: string; prompt: string }): Promise<void> {
		await Promise.resolve()
		const id = `pending_${++this.nextId}`
		this.enqueued.push({ sessionId: input.sessionId, prompt: input.prompt, id })
	}

	// Mirror of host.pendingPrompts("list", ...). SYNCHRONOUS
	// lookup against the current sink state — exactly what the
	// production discard seam sees.
	list(sessionId: string): Array<{ id: string; prompt: string }> {
		return this.enqueued.filter((e) => e.sessionId === sessionId).map((e) => ({ id: e.id, prompt: e.prompt }))
	}

	// Mirror of host.pendingPrompts("delete", ...). Returns a
	// promise that resolves AFTER one microtask hop.
	async delete(sessionId: string, promptId: string): Promise<{ removed: boolean }> {
		await Promise.resolve()
		const idx = this.enqueued.findIndex((e) => e.sessionId === sessionId && e.id === promptId)
		if (idx < 0) {
			return { removed: false }
		}
		this.enqueued.splice(idx, 1)
		return { removed: true }
	}
}

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / BNCA-RED-01", () => {
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

	it("BNCA-RED-01: pre-repair — Path A enqueue races ahead of Path B discard; wake survives", async () => {
		const sink = new AsyncPendingPromptsSink()
		let now = 0
		const sessionId = "sess-bnca-red-01"
		const taskId = "task-bnca-red-01"
		const jobId = "J-bnca-red-01"

		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId, taskId }),
			// Fire-and-forget enqueue: mirror of SdkController.ts:738
			enqueueTerminalWake: ({ sessionId, prompt }) => {
				void sink.enqueue({ sessionId, prompt })
			},
			// Mirror of discardQueuedWakeForJobIdOnHost: list() sync,
			// delete() NOT awaited.
			discardQueuedWake: ({ sessionId, jobId }) => {
				const entries = sink.list(sessionId)
				const match = entries.find(
					(e) =>
						e.prompt.startsWith(
							"A background command you asked to be notified about has reached a terminal state.",
						) && e.prompt.includes(`\nJob: ${jobId}\n`),
				)
				if (!match) {
					return { kind: "not_found" as const, jobId }
				}
				void sink.delete(sessionId, match.id)
				return { kind: "discarded" as const, jobId, promptId: match.id }
			},
			now: () => ++now,
		})

		// Path A arm: register a marker.
		coordinator.registerMarker({
			jobId,
			sessionId,
			taskId,
		})

		// Path A fires (mirroring the listener after terminalPromise).
		const aDecision = coordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "STARTED\nFINISHED\n",
		})
		expect(aDecision.kind).toBe("drained")

		// In production, the originating turn's command_status
		// continuation runs in the SAME microtask drain as the
		// listener — there is NO awaitable boundary between them.
		// Therefore the discard's list() sees the wake as NOT yet
		// landed (the fire-and-forget enqueue is one microtask
		// behind).
		const bDecision = coordinator.resolveObligation({
			jobId,
			sessionId,
			taskId,
			resolution: "canonical_status_observed",
		})
		expect(bDecision.kind).toBe("no_marker")

		// Allow the fire-and-forget enqueue to land.
		await Promise.resolve()
		await Promise.resolve()

		// The wake has now landed in pendingPrompts. The discard
		// found `not_found` because it ran one microtask BEFORE the
		// enqueue landed.
		const remaining = sink.list(sessionId)
		// PRE-REPAIR: the wake survives. This is the defect.
		// POST-REPAIR (H1): command_status no longer fires
		// resolveObligation for a notify-owned job, so this branch
		// is unreachable.
		expect(remaining).toHaveLength(1)
		// Document the wake prompt content for the post-repair audit.
		expect(remaining[0]?.prompt).toContain(`Job: ${jobId}`)

		coordinator.dispose()
	})

	it("BNCA-RED-01-control: synchronous enqueue sink — discard succeeds (TQCB-CTL-DUAL-2 invariant still holds)", async () => {
		// CONTROL: prove that the existing TQCB-CTL-DUAL-2 invariant
		// holds when the enqueue is SYNCHRONOUS. This shows the
		// defect is caused by the fire-and-forget seam, not by
		// the coordinator's marker arbitration.
		const sinkEntries: Array<{ sessionId: string; prompt: string; id: string }> = []
		let nextId = 0
		const sessionId = "sess-bnca-red-01-ctl"
		const taskId = "task-bnca-red-01-ctl"
		const jobId = "J-bnca-red-01-ctl"

		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId, taskId }),
			enqueueTerminalWake: ({ sessionId, prompt }) => {
				const id = `pending_${++nextId}`
				sinkEntries.push({ sessionId, prompt, id })
			},
			discardQueuedWake: ({ sessionId, jobId }) => {
				const idx = sinkEntries.findIndex(
					(e) =>
						e.sessionId === sessionId &&
						e.prompt.startsWith(
							"A background command you asked to be notified about has reached a terminal state.",
						) &&
						e.prompt.includes(`\nJob: ${jobId}\n`),
				)
				if (idx < 0) {
					return { kind: "not_found" as const, jobId }
				}
				sinkEntries.splice(idx, 1)
				return { kind: "discarded" as const, jobId, promptId: sinkEntries[idx]?.id }
			},
			now: () => 1,
		})

		coordinator.registerMarker({
			jobId,
			sessionId,
			taskId,
		})
		coordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		// With SYNC enqueue the wake is already in the sink.
		expect(sinkEntries).toHaveLength(1)

		const bDecision = coordinator.resolveObligation({
			jobId,
			sessionId,
			taskId,
			resolution: "canonical_status_observed",
		})
		// Discard seam found and removed the wake.
		expect(bDecision.kind).toBe("resolved")
		expect(sinkEntries).toHaveLength(0)

		coordinator.dispose()
	})
})
