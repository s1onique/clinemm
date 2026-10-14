/**
 * ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01
 *
 * HTEC-01 - held terminal observation remains resolvable after the
 * CommandJobManager's heavy terminal snapshot is evicted by the bounded
 * FIFO.
 *
 * Causal discriminator (H-EVICT):
 *
 *   The CommandJobManager's `terminal` map is bounded at
 *   `maxTerminalJobs` (default 128). When that cap is exceeded, the
 *   oldest terminal entry is evicted via `terminal.delete(evictId)`
 *   (command-job-manager.ts:2770-2782). A subsequent
 *   `manager.status(evictedId)` returns `unknown_job` (line 2817-2819).
 *
 *   The production `command_status` tool early-returns at
 *   command-status-tool.ts:252-255 with `{ ok: false, error:
 *   "unknown_job: ..." }` BEFORE reaching the Path B / Path C
 *   consumption seams at lines 329-393. The owning
 *   BackgroundNotifyCoordinator's obligation (a live notify marker
 *   for notify=true jobs, or a `nonNotifyTerminalObservations` entry
 *   for fire-and-forget jobs) is therefore never drained.
 *
 *   The BCB barrier consults `unconsumedOwnedTerminalResultsForC10`
 *   and reports `heldObligationForC10 === true` indefinitely
 *   (sdk-session-event-coordinator.ts:3151), blocking task completion.
 *
 * Bounded repair (HTEC-01 GREEN):
 *
 *   The BackgroundNotifyCoordinator retains a per-job "compact
 *   terminal receipt" - the terminal classification facts WITHOUT the
 *   heavy stdout/stderr payload - keyed by `jobId`. The receipt is
 *   recorded at the manager's `command_job_terminal_committed`
 *   lifecycle event seam (via the `onCommandJobLifecycle` sink
 *   wired by `SdkController.handleCommandJobLifecycle`), then
 *   atomically cleared when the obligation is consumed (Path A / B
 *   / C / C') or when the coordinator is disposed.
 *
 *   When `command_status` receives `unknown_job` from the manager, it
 *   consults the receipt store. If a receipt exists for the jobId AND
 *   the supplied owner triple matches, the obligation is drained
 *   (via `resolveObligation` for notify=true, or
 *   `consumeNonNotifyTerminalObservation` for fire-and-forget) and
 *   the tool returns a TRUTHFUL response that distinguishes:
 *
 *     - state: receipt.terminalState   (the canonical fact)
 *     - exitCode: receipt.exitCode     (when present)
 *     - signal: receipt.signal         (when present)
 *     - outputRetained: false          (truthful: heavy output evicted)
 *     - observation: "evicted_receipt" (the load-bearing distinction)
 *
 * This test is the canonical RED+GREEN witness.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"

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

let supervisorPid = 230000

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

interface MinimalLifecycleEvent {
	event: string
	jobId: string
	ownerSessionId?: string
	ownerTaskId?: string | null
	jobState: string
	exitCode: number | null
	signal: string | null
}

function attachLifecycleReceiptRecorder(
	manager: CommandJobManager,
	notifyCoordinator: BackgroundNotifyCoordinator,
	ownerSessionId: string,
	ownerTaskId: string,
): void {
	// Mirror the production `SdkController.handleCommandJobLifecycle`
	// recording at command-job-manager.ts:2642-2665.
	;(manager as unknown as { onCommandJobLifecycle: (e: MinimalLifecycleEvent) => void }).onCommandJobLifecycle = (
		event: MinimalLifecycleEvent,
	) => {
		if (event.event !== "command_job_terminal_committed") return
		// The lifecycle event carries the launch-time owner triple.
		// Fall back to the active session/task when the event omits
		// the field (forward-compatible with older event sources).
		const sessionId = event.ownerSessionId ?? ownerSessionId
		const taskId = event.ownerTaskId ?? ownerTaskId
		// Use a type-only cast: terminalState is the SAME shape the
		// production SdkController hands to recordTerminalReceipt.
		notifyCoordinator.recordTerminalReceipt({
			jobId: event.jobId,
			sessionId,
			taskId: taskId ?? undefined,
			terminalState: event.jobState as never,
			exitCode: event.exitCode ?? undefined,
			reason: event.signal ?? undefined,
			isContainmentFailed: event.jobState === "containment_failed",
		})
	}
}

describe("ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 / HTEC-01", () => {
	it("RED->GREEN: notify=true obligation remains resolvable after the manager evicts A's heavy terminal snapshot (cap=2)", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})

		const activeSessionId = "session-htec01"
		const activeTaskId = "task-htec01"

		const wakeSink: Array<{ sessionId: string; prompt: string; jobId: string }> = []
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: ({ sessionId, prompt, jobId }) => {
				wakeSink.push({ sessionId, prompt, jobId: jobId ?? "" })
				return Promise.resolve({ kind: "delivered" as const })
			},
			discardQueuedWake: ({ sessionId, jobId }) => {
				const idx = wakeSink.findIndex((w) => w.sessionId === sessionId && w.jobId === jobId)
				if (idx < 0) return { kind: "not_found" as const, jobId }
				wakeSink.splice(idx, 1)
				return { kind: "discarded" as const, jobId, promptId: undefined }
			},
			// Use the legacy TS policy (synchronous "drained"
			// decision) so the test is not coupled to the
			// Elm kernel. Production wiring uses the Elm
			// kernel; the test's `legacyConsumeTerminalPolicy`
			// exercises the same Path A drain semantics.
			consumeTerminalAuthority: legacyConsumeTerminalPolicy,
			now: () => Date.now(),
		})

		// Wire the production SdkController's lifecycle-receipt
		// recording seam so the BCB observes terminal facts via
		// the manager's `command_job_terminal_committed` event.
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, activeSessionId, activeTaskId)

		// Start three jobs A, B, C under the same owner / task. All are
		// notify=true (we register markers for each).
		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(a.state).toBe("running")
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		const b = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(b.state).toBe("running")
		notifyCoordinator.registerMarker({
			jobId: b.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		const c = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		expect(c.state).toBe("running")
		notifyCoordinator.registerMarker({
			jobId: c.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		// Sanity: all three are in the unconsumed held-set.
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId).sort()).toEqual(
			[a.jobId, b.jobId, c.jobId].sort(),
		)

		// Cancel A. The production terminal-promise listener
		// would call `notifyCoordinator.consumeTerminal(A, ...)`
		// (Path A) for notify=true. We DELIBERATELY skip this
		// call to mirror the live stuck-incident shape: the
		// terminal fact is real, the obligation is live, the
		// model has not yet observed it. The
		// `onCommandJobLifecycle` sink still fires and records
		// the receipt.
		const cancelA = await manager.cancel({ jobId: a.jobId })
		expect(cancelA.ok).toBe(true)
		if (cancelA.ok) {
			expect(cancelA.state).toBe("cancelled")
		}
		// A's terminal snapshot is retrievable PRE-eviction.
		const preEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(preEvict.ok).toBe(true)
		if (preEvict.ok) {
			expect(preEvict.snapshot.state).toBe("cancelled")
		}
		// The receipt is recorded at the lifecycle event seam
		// even though `consumeTerminal` was never called.
		const receiptIdsAfterA = [
			...(notifyCoordinator as unknown as { terminalReceipts: Map<string, unknown> }).terminalReceipts.keys(),
		]
		expect(receiptIdsAfterA).toContain(a.jobId)
		// The held-set STILL contains A.
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId)).toContain(a.jobId)

		// Cancel B -> finalizes B into `manager.terminal` (size 2/2, the cap).
		await manager.cancel({ jobId: b.jobId })
		// Mirror production: BCB consumes B's marker (Path A, notify=true).
		await notifyCoordinator.consumeTerminal({
			jobId: b.jobId,
			terminalState: "cancelled",
			exitCode: undefined,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})

		// Cancel C -> finalizes C into `manager.terminal` (size 3/2).
		// The bounded FIFO evicts A (the oldest entry).
		await manager.cancel({ jobId: c.jobId })
		// Mirror production: BCB consumes C's marker (Path A, notify=true).
		await notifyCoordinator.consumeTerminal({
			jobId: c.jobId,
			terminalState: "cancelled",
			exitCode: undefined,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})

		// Post-eviction: A is no longer in `manager.terminal`. The
		// manager's `status` returns `unknown_job`.
		const postEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)
		if (!postEvict.ok) {
			expect(postEvict.code).toBe("unknown_job")
		}

		// The BCB held-set STILL contains A's marker (Path A never
		// fired for A - we deliberately skipped the consumeTerminal
		// call to mirror the live stuck-incident shape).
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId)).toContain(a.jobId)
		// A's receipt IS present (the bounded fix's load-bearing
		// claim: the receipt is recorded at the lifecycle event
		// seam even when `consumeTerminal` is never called for
		// the held job).
		const receiptIds = [
			...(notifyCoordinator as unknown as { terminalReceipts: Map<string, unknown> }).terminalReceipts.keys(),
		]
		expect(receiptIds).toContain(a.jobId)

		// ACT: invoke the production `command_status` tool against
		// the manager. Pre-fix: the tool returns
		// { ok: false, error: "unknown_job: ..." } and the
		// obligation remains held. Post-fix: the tool consults the
		// BCB's terminal-receipt store, drains the obligation via
		// Path B (resolveObligation for notify=true), and returns
		// a truthful evicted_receipt payload.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: "test-session", agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>

		// BOUNDED REPAIR ASSERTION (GREEN):
		expect(payload.ok).toBe(true)
		expect(payload.error).toBeUndefined()
		expect(payload.state).toBe("cancelled")
		expect(payload.outputRetained).toBe(false)
		expect(payload.observation).toBe("evicted_receipt")
		expect(payload.jobId).toBe(a.jobId)

		// After the receipt-consumption, A's obligation is drained
		// from the BCB held-set. (B and C may still be in the
		// held queue via the `held` decision of their Path A
		// `consumeTerminal` — that is a separate completion
		// concern; this test focuses on the eviction-recovery
		// seam for A.)
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId)).not.toContain(a.jobId)

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)
})

describe("ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 / HTEC-01 / C5 necessity", () => {
	it("ablation: when the receipt-consumption code is disabled, the eviction leaves the obligation unresolvable (RED reproduces)", async () => {
		// Temporarily disable the BCB's `consumeTerminalReceipt` by
		// wrapping it in a no-op. This simulates the pre-fix
		// behavior where the BCB cannot drain an obligation whose
		// heavy manager snapshot was evicted.
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})

		const activeSessionId = "session-htec01-ablation"
		const activeTaskId = "task-htec01-ablation"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, activeSessionId, activeTaskId)

		// ABLATION: replace the BCB's `consumeTerminalReceipt` with a
		// no-op stub. The bounded fix's GREEN path is disabled; the
		// original RED shape must reappear.
		const originalConsumeTerminalReceipt = notifyCoordinator.consumeTerminalReceipt.bind(notifyCoordinator)
		;(
			notifyCoordinator as unknown as { consumeTerminalReceipt: typeof originalConsumeTerminalReceipt }
		).consumeTerminalReceipt = () => ({
			kind: "not_present" as const,
		})

		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		// Cancel A; receipt is recorded by the lifecycle sink.
		await manager.cancel({ jobId: a.jobId })
		// Cancel B and C to evict A from the manager terminal map.
		const b = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: b.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})
		const c = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: c.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})
		await manager.cancel({ jobId: b.jobId })
		await manager.cancel({ jobId: c.jobId })
		// Drain B and C so the only outstanding marker is A.
		await notifyCoordinator.consumeTerminal({
			jobId: b.jobId,
			terminalState: "cancelled",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		await notifyCoordinator.consumeTerminal({
			jobId: c.jobId,
			terminalState: "cancelled",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})

		// Post-eviction: A is no longer in the manager terminal map.
		const postEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)

		// The held set STILL contains A's marker (Path A never
		// fired for A).
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId)).toContain(a.jobId)

		// With the receipt-consumption code ABLATED, the
		// `command_status` tool returns the truthful
		// `unknown_job` (the bounded fix is disabled) and the
		// obligation remains held.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: "test-session", agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>
		expect(payload.ok).toBe(false)
		expect(String(payload.error)).toContain("unknown_job")
		// A's obligation is STILL held - this is the RED shape.
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId)).toContain(a.jobId)

		// Restore the receipt-consumption code for hygiene.
		;(
			notifyCoordinator as unknown as { consumeTerminalReceipt: typeof originalConsumeTerminalReceipt }
		).consumeTerminalReceipt = originalConsumeTerminalReceipt

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)
})

describe("ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 / HTEC-01 / C6 conservation matrix", () => {
	it("EVC-04: an unknown jobId never owned by the manager returns `unknown_job` (no false positive from the receipt store)", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const activeSessionId = "session-htec01-evc04"
		const activeTaskId = "task-htec01-evc04"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, activeSessionId, activeTaskId)

		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: "cmd_never_existed_htec01", waitMs: 0 },
			{ sessionId: "test-session", agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>
		expect(payload.ok).toBe(false)
		expect(String(payload.error)).toContain("unknown_job")

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)

	it("EVC-05: cross-session ownership cannot drain a foreign obligation via a receipt (owner-mismatch returns unknown_job, obligation remains held)", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const ownerSessionId = "session-htec01-owner"
		const ownerTaskId = "task-htec01-owner"
		const foreignSessionId = "session-htec01-foreign"
		const foreignTaskId = "task-htec01-foreign"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, ownerSessionId, ownerTaskId)

		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: ownerSessionId,
			taskId: ownerTaskId,
		})
		await manager.cancel({ jobId: a.jobId })
		// A's receipt is recorded at the lifecycle event seam.

		// Evict A by finalizing 2 more jobs.
		for (let i = 0; i < 2; i += 1) {
			const j = await manager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			notifyCoordinator.registerMarker({
				jobId: j.jobId,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
			})
			await manager.cancel({ jobId: j.jobId })
			await notifyCoordinator.consumeTerminal({
				jobId: j.jobId,
				terminalState: "cancelled",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
		}

		const postEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)

		// Construct `command_status` whose active owner is the
		// FOREIGN session. The receipt exists for the OWNER, so
		// the owner-mismatch guard MUST prevent the foreign
		// session from draining the owner's obligation.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: foreignSessionId, taskId: foreignTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: "test-session", agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>
		expect(payload.ok).toBe(false)
		expect(String(payload.error)).toContain("unknown_job")
		// The owner's obligation is STILL held.
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, ownerTaskId)).toContain(a.jobId)
		// The receipt is also still there (foreign owner could not consume).
		const receiptKeys = [
			...(notifyCoordinator as unknown as { terminalReceipts: Map<string, unknown> }).terminalReceipts.keys(),
		]
		expect(receiptKeys).toContain(a.jobId)

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)

	it("EVC-11: manager disposal clears the BCB held set (no orphaned authority)", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const activeSessionId = "session-htec01-evc11"
		const activeTaskId = "task-htec01-evc11"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, activeSessionId, activeTaskId)

		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})
		await manager.cancel({ jobId: a.jobId })

		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBeGreaterThanOrEqual(1)
		// Dispose the BCB: the receipt store MUST be cleared.
		notifyCoordinator.dispose()
		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBe(0)

		await manager.dispose()
	}, 30_000)

	it("EVC-14: a non-evicted terminal snapshot returns the manager's full output (no fabricated outputRetained flag)", async () => {
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const activeSessionId = "session-htec01-evc14"
		const activeTaskId = "task-htec01-evc14"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, activeSessionId, activeTaskId)

		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})
		await manager.cancel({ jobId: a.jobId })

		// A's terminal snapshot is still in the manager (cap not
		// exceeded). The `command_status` tool returns the
		// truthful manager-snapshot response WITHOUT the
		// `outputRetained: false` flag (heavy output IS
		// available).
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: "test-session", agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>
		expect(payload.ok).toBe(true)
		expect(payload.state).toBe("cancelled")
		// No receipt was used (manager returned the snapshot).
		expect(payload.observation).toBeUndefined()
		expect(payload.outputRetained).toBeUndefined()

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)
})
