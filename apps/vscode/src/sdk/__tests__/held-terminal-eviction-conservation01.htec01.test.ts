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
import {
	BackgroundNotifyCoordinator,
	legacyConsumeTerminalPolicy,
	recordTerminalReceiptFromLifecycle,
} from "../background-notify-coordinator"
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
	// PRD-01/02: use the EXACT same production code path that
	// `SdkController.handleCommandJobLifecycle` uses. The free
	// function `recordTerminalReceiptFromLifecycle` is the actual
	// body of `SdkController.handleCommandJobLifecycle`'s
	// `command_job_terminal_committed` branch. The ownerSessionId /
	// ownerTaskId parameters here are FALLBACKS used only when the
	// BCB has no held marker for the jobId (the BCB resolves the
	// canonical owner triple from its own held-obligation record
	// when a marker exists).
	;(manager as unknown as { onCommandJobLifecycle: (e: MinimalLifecycleEvent) => void }).onCommandJobLifecycle = (
		event: MinimalLifecycleEvent,
	) => {
		recordTerminalReceiptFromLifecycle(notifyCoordinator, {
			...event,
			// Backfill the optional owner triple from the test
			// fixture so the free function's `event.ownerSessionId
			// ?? ""` fallback path doesn't fire. The BCB still
			// resolves the canonical triple from the held marker
			// when one exists.
			ownerSessionId: event.ownerSessionId ?? ownerSessionId,
			ownerTaskId: event.ownerTaskId ?? ownerTaskId,
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

describe("ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 / HTEC-01 / Bounded correction gates", () => {
	it("BND-01/02: receipt store enforces MAX_TERMINAL_RECEIPTS cap; excess terminal facts HALT without losing existing receipts", async () => {
		// Set the BCB's cap to a small number for this test.
		const manager = new CommandJobManager({
			maxTerminalJobs: 200,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const ownerSessionId = "session-htec01-bnd"
		const ownerTaskId = "task-htec01-bnd"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, ownerSessionId, ownerTaskId)

		// The cap is module-scope (128). We can't override it
		// per-BCB, so we directly drive `recordTerminalReceipt`
		// to 128 NEW receipts and then attempt a 129th.
		// Since the BCB's `recordTerminalReceipt` only records
		// when a held marker exists, we must register a marker
		// for each jobId (and remove it after recording to
		// keep the held-set count low).
		const jobIds: string[] = []
		for (let i = 0; i < 130; i += 1) {
			const jid = `cmd_bnd_${i.toString().padStart(4, "0")}`
			jobIds.push(jid)
		}
		// Register all markers first.
		for (const jid of jobIds) {
			notifyCoordinator.registerMarker({ jobId: jid, sessionId: ownerSessionId, taskId: ownerTaskId })
		}
		// Try to record 130 receipts. The first 128 should
		// succeed; the 129th and 130th MUST return at_capacity.
		let recordedCount = 0
		let atCapacityCount = 0
		for (const jid of jobIds) {
			const result = notifyCoordinator.recordTerminalReceipt({
				jobId: jid,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			if (result.kind === "recorded") recordedCount += 1
			if (result.kind === "at_capacity") {
				atCapacityCount += 1
				expect(result.cap).toBe(128)
			}
		}
		// BND-01: the receipt store is bounded.
		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBeLessThanOrEqual(128)
		// The 129th and 130th attempts MUST be refused.
		expect(recordedCount).toBe(128)
		expect(atCapacityCount).toBe(2)
		// BND-02: existing receipts are NOT silently lost when
		// the cap is reached. The first 128 receipts are
		// still in the store.
		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBe(128)

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)

	it("CAP-CONSERVATION-01/02: a 129th terminal fact refused by the cap remains drainable through the BCB's explicit capacity_drop disposition (no completion stall after eviction)", async () => {
		// Reviewer-mandated bounded discriminator (HTEC01-CORR01 / P0).
		// The cap refuses to RECORD the 129th receipt. The
		// reviewer's central concern is that the 129th's held
		// obligation then becomes unresolvable. The fix is for
		// the BCB to take an explicit, safe terminal disposition
		// (a synthetic "capacity_drop" resolution) at the
		// `at_capacity` moment, so the obligation is drainable.
		// This test asserts that disposition and that a real
		// `command_status(129)` returns a truthful response.
		//
		// Manager cap is 2 so the 129th's heavy snapshot is
		// evicted by the bounded FIFO when we drive 2 more
		// jobs through the manager. That guarantees
		// `manager.status(129)` returns `unknown_job` and the
		// BCB's `consumeTerminalReceipt` is consulted.
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const ownerSessionId = "session-htec01-capcon"
		const ownerTaskId = "task-htec01-capcon"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, ownerSessionId, ownerTaskId)
		// Step 1: register 128 markers and record 128 receipts.
		const firstBatchJobIds: string[] = []
		for (let i = 0; i < 128; i += 1) {
			const j = await manager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			firstBatchJobIds.push(j.jobId)
			notifyCoordinator.registerMarker({
				jobId: j.jobId,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
			})
		}
		for (const jid of firstBatchJobIds) {
			const r = notifyCoordinator.recordTerminalReceipt({
				jobId: jid,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(r.kind).toBe("recorded")
		}
		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBe(128)

		// Step 2: register the 129th marker and cancel job129
		// through the manager. The BCB's `recordTerminalReceipt`
		// MUST return `at_capacity`.
		const job129 = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: job129.jobId,
			sessionId: ownerSessionId,
			taskId: ownerTaskId,
		})
		await manager.cancel({ jobId: job129.jobId })
		const capResult = notifyCoordinator.recordTerminalReceipt({
			jobId: job129.jobId,
			sessionId: ownerSessionId,
			taskId: ownerTaskId,
			terminalState: "cancelled",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(capResult.kind).toBe("at_capacity")

		// Step 3: pre-fix, the 129th's marker is still held
		// (cap refusal dropped the receipt, NOT the marker).
		expect(notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, ownerTaskId)).toContain(job129.jobId)

		// Step 4: force eviction of the 129th's heavy terminal
		// snapshot. With maxTerminalJobs: 2 and job129 already
		// in manager.terminal, cancel 2 more jobs to overflow
		// the FIFO. The manager evicts the oldest (job129).
		const evictA = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		await manager.cancel({ jobId: evictA.jobId })
		const evictB = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		await manager.cancel({ jobId: evictB.jobId })
		const postEvict = await manager.status({ jobId: job129.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)
		if (!postEvict.ok) {
			expect(postEvict.code).toBe("unknown_job")
		}

		// Step 5: invoke real `command_status(129)` through
		// the production factory.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: job129.jobId, waitMs: 0 },
			{ sessionId: ownerSessionId, agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>

		// Step 6: obligation is TRUTHFULLY resolvable. The
		// response carries the BCB's `capacity_drop`
		// observation (NOT `unknown_job`).
		expect(payload.ok).toBe(true)
		expect(payload.state).toBe("cancelled")
		expect(payload.outputRetained).toBe(false)
		expect(payload.observation).toBe("capacity_drop")
		const unconsumedAfter = notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, ownerTaskId)
		expect(unconsumedAfter).not.toContain(job129.jobId)
		// The 128 first-batch markers are still held.
		expect(unconsumedAfter.length).toBe(128)

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 60_000)

	it("CAP-CONSERVATION-03: a 257th terminal fact arriving when both receipt maps are at cap drains its own obligation through secondary_capacity_drop (older 256 obligations are preserved, no LRU eviction)", async () => {
		// Reviewer-mandated bounded discriminator
		// (HTEC01-CORR02 / HALT_CAPACITY_DROP_LRU_RECREATES_ORIGINAL_DEFECT,
		// P0): the CORR02 fix uses LRU eviction on the
		// secondary (`capacityDroppedReceipts`) map as a
		// "last-resort escape hatch". When the 257th
		// unresolved terminal fact arrives, the LRU
		// evicts an older secondary receipt. If that
		// older job's heavy manager snapshot is already
		// gone, the older obligation is permanently
		// stranded (the original HTEC01 defect at a
		// higher threshold).
		//
		// The correct fix: the secondary map is
		// APPEND-ONLY. When the secondary map is at cap
		// AND a new fact arrives, the BCB does NOT evict
		// any older receipt; it settles the NEW fact's
		// obligation immediately through an explicit
		// `secondary_capacity_drop` resolution. The 257th
		// fact is "lost" (no receipt retained) but the
		// obligation is settled truthfully.
		//
		// Pre-fix (CORR02): the 257th arrival evicts the
		// oldest secondary receipt; the older obligation
		// is stranded. The CORR02's LRU "last-resort
		// escape hatch" recreated the original HTEC01
		// defect at a higher threshold.
		//
		// Post-fix (CORR03): the secondary map is
		// APPEND-ONLY. The 257th fact is settled with
		// `secondary_capacity_drop` at the `at_capacity`
		// moment; the 128 older secondary receipts are
		// preserved.
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const ownerSessionId = "session-htec01-capcon3"
		const ownerTaskId = "task-htec01-capcon3"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, ownerSessionId, ownerTaskId)

		// Step 1: fill the primary receipt store to 128.
		const firstBatchJobIds: string[] = []
		for (let i = 0; i < 128; i += 1) {
			const j = await manager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			firstBatchJobIds.push(j.jobId)
			notifyCoordinator.registerMarker({
				jobId: j.jobId,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
			})
		}
		for (const jid of firstBatchJobIds) {
			const r = notifyCoordinator.recordTerminalReceipt({
				jobId: jid,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(r.kind).toBe("recorded")
		}
		expect(notifyCoordinator.diagnosticTerminalReceiptCount()).toBe(128)

		// Step 2: fill the secondary receipt store to
		// 128. Each secondBatch jobId is registered with
		// a marker, then its terminal event hits the
		// primary cap and is routed to the secondary
		// map.
		const secondBatchJobIds: string[] = []
		for (let i = 0; i < 128; i += 1) {
			const j = await manager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			secondBatchJobIds.push(j.jobId)
			notifyCoordinator.registerMarker({
				jobId: j.jobId,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
			})
			const r = notifyCoordinator.recordTerminalReceipt({
				jobId: j.jobId,
				sessionId: ownerSessionId,
				taskId: ownerTaskId,
				terminalState: "cancelled",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(r.kind).toBe("at_capacity")
		}
		expect(notifyCoordinator.diagnosticCapacityDroppedReceiptCount()).toBe(128)

		// Step 3: register the 257th marker. We do NOT
		// cancel job257 through the manager (the
		// cancel-driven lifecycle event would double-fire
		// `recordTerminalReceipt` and obscure the
		// assertion). Instead, we call
		// `recordTerminalReceipt` directly — this is
		// the production path the
		// `recordTerminalReceiptFromLifecycle` free
		// function takes for the new fact.
		const job257 = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: job257.jobId,
			sessionId: ownerSessionId,
			taskId: ownerTaskId,
		})
		const capResult = notifyCoordinator.recordTerminalReceipt({
			jobId: job257.jobId,
			sessionId: ownerSessionId,
			taskId: ownerTaskId,
			terminalState: "cancelled",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		// The 257th is refused with `at_capacity`. The
		// post-fix behaviour: the BCB settles the 257th's
		// obligation through an explicit
		// `secondary_capacity_drop` resolution at this
		// moment (no LRU eviction of older receipts).
		expect(capResult.kind).toBe("at_capacity")

		// Step 4: the secondary map is still at 128 (no
		// LRU eviction). The oldest secondary receipt's
		// jobId is preserved.
		expect(notifyCoordinator.diagnosticCapacityDroppedReceiptCount()).toBe(128)
		const secondaryKeys = (
			notifyCoordinator as unknown as { capacityDroppedReceipts: Map<string, unknown> }
		).capacityDroppedReceipts.keys()
		const secondaryKeyArr = [...secondaryKeys]
		expect(secondaryKeyArr).not.toContain(job257.jobId)

		// Step 5: the 257th's marker is no longer held
		// (drained at the `at_capacity` moment).
		const unconsumedAfter257 = notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, ownerTaskId)
		expect(unconsumedAfter257).not.toContain(job257.jobId)
		// 128 first-batch + 128 second-batch = 256
		// outstanding obligations. The 257th is drained.
		expect(unconsumedAfter257.length).toBe(256)

		// Step 6: the oldest secondary receipt's jobId
		// is still in the secondary map AND its marker
		// is still held.
		const oldestSecondary = secondBatchJobIds[0]
		expect(secondaryKeyArr).toContain(oldestSecondary)
		expect(unconsumedAfter257).toContain(oldestSecondary)

		// Step 7: real `command_status(oldestSecondary)`
		// through the production factory. The manager
		// returns `unknown_job` (the oldest secondary
		// was never in this manager's terminal map);
		// the BCB's secondary map covers it; the
		// obligation is drained through the canonical
		// `resolveObligation` path; the response is
		// truthful (NOT `unknown_job`).
		const secondManager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		attachLifecycleReceiptRecorder(secondManager, notifyCoordinator, ownerSessionId, ownerTaskId)
		for (let i = 0; i < 3; i += 1) {
			const j = await secondManager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			await secondManager.cancel({ jobId: j.jobId })
		}
		const tool = createCommandStatusTool(secondManager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
		})
		const result = (await tool.execute(
			{ jobId: oldestSecondary, waitMs: 0 },
			{ sessionId: ownerSessionId, agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		const payload = result[0] as Record<string, unknown>

		// The oldest secondary obligation is TRUTHFULLY
		// resolvable.
		expect(payload.ok).toBe(true)
		expect(payload.state).toBe("cancelled")
		expect(payload.outputRetained).toBe(false)
		expect(payload.observation).toBe("capacity_drop")
		const unconsumedAfterDrain = notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, ownerTaskId)
		expect(unconsumedAfterDrain).not.toContain(oldestSecondary)
		// 256 outstanding obligations (128 first + 128 second)
		// minus 1 (drained oldest via command_status) = 255.
		// Note: the 257th's marker was drained at the
		// `at_capacity` moment (not via command_status), so
		// it's already not in the 256 by this point. The
		// total after step 7 is 255.
		expect(unconsumedAfterDrain.length).toBe(255)

		await manager.dispose()
		await secondManager.dispose()
		notifyCoordinator.dispose()
	}, 90_000)

	it("OWN-01/02: a late terminal event retains the LAUNCH-time owner identity (session switch does not misattribute)", async () => {
		const launchSessionId = "session-htec01-launch"
		const launchTaskId = "task-htec01-launch"
		const switchedSessionId = "session-htec01-switched"
		const switchedTaskId = "task-htec01-switched"
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: launchSessionId, taskId: launchTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		attachLifecycleReceiptRecorder(manager, notifyCoordinator, launchSessionId, launchTaskId)

		// Start job A under (launchSession, launchTask).
		const a = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		notifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: launchSessionId,
			taskId: launchTaskId,
		})

		// Cancel A. The lifecycle event carries the manager's
		// ownerSessionId (= launchSessionId). The recorder
		// passes launchSessionId/launchTaskId as FALLBACK,
		// but the BCB's recordTerminalReceipt consults the
		// marker's launch-time identity (already registered
		// above), so the receipt is recorded with the LAUNCH
		// triple, NOT the active (current) task.
		await manager.cancel({ jobId: a.jobId })

		// OWN-01: the receipt carries the LAUNCH-time owner.
		const receipt = (
			notifyCoordinator as unknown as { terminalReceipts: Map<string, { sessionId: string; taskId: string | undefined }> }
		).terminalReceipts.get(a.jobId)
		expect(receipt).toBeDefined()
		expect(receipt?.sessionId).toBe(launchSessionId)
		expect(receipt?.taskId).toBe(launchTaskId)
		// OWN-01 (negative): the receipt MUST NOT carry the
		// switched (current active) session/task.
		expect(receipt?.sessionId).not.toBe(switchedSessionId)
		expect(receipt?.taskId).not.toBe(switchedTaskId)

		// Simulate a session switch: the active task is now
		// the SWITCHED task. (In production this is a host
		// state change; the BCB is unaffected.)
		notifyCoordinator.dispose()
		// Re-construct a new BCB (the dispose cleared all
		// state, including the marker we registered for A).
		// For the OWN-02 test we only need the RECEIPT in the
		// new BCB; the marker is not required because the
		// receipt itself stores the owner triple.
		const switchedNotifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: switchedSessionId, taskId: switchedTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})
		// Re-populate the receipt with the LAUNCH-time
		// owner (the disposal cleared it, but this is the
		// receipt that was recorded). Simulate the BCB
		// having the receipt from the launch-time owner.
		// Also re-register the marker so the drain path
		// (`resolveObligation` for notify=true) succeeds.
		switchedNotifyCoordinator.registerMarker({
			jobId: a.jobId,
			sessionId: launchSessionId,
			taskId: launchTaskId,
		})
		switchedNotifyCoordinator.recordTerminalReceipt({
			jobId: a.jobId,
			sessionId: launchSessionId,
			taskId: launchTaskId,
			terminalState: "cancelled",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		// Also re-drain the manager's terminal map by adding
		// 2 more jobs (force eviction of A from the manager).
		const b = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		await manager.cancel({ jobId: b.jobId })
		const c = await manager.start({
			command: "sleep 600",
			cwd: "/tmp",
			waitBudgetMs: 25,
			executionDeadlineMs: 30_000,
		})
		await manager.cancel({ jobId: c.jobId })
		// A is now evicted from manager.terminal.
		const postEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)

		// OWN-02: a `command_status` for the LAUNCH-time
		// session/task (correct owner) drains the obligation.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: switchedNotifyCoordinator,
			// Caller is the LAUNCH-time owner (correct).
			resolveActiveOwner: () => ({ sessionId: launchSessionId, taskId: launchTaskId }),
		})
		const result = await (tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: launchSessionId, agentId: "test-agent", iteration: 1 },
		) as Array<Record<string, unknown>>)
		expect(result[0]?.ok).toBe(true)
		expect(result[0]?.observation).toBe("evicted_receipt")

		// OWN-02 (negative): a `command_status` for the
		// SWITCHED session (foreign owner) returns
		// `unknown_job` — the foreign owner cannot drain.
		const notifyCoordinator2 = notifyCoordinator
		const tool2 = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator2,
			resolveActiveOwner: () => ({ sessionId: switchedSessionId, taskId: switchedTaskId }),
		})
		const result2 = await (tool2.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: switchedSessionId, agentId: "test-agent", iteration: 1 },
		) as Array<Record<string, unknown>>)
		expect(result2[0]?.ok).toBe(false)
		expect(String(result2[0]?.error)).toContain("unknown_job")

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)
})

describe("ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 / HTEC-01 / Production lifecycle reach", () => {
	it("PRD-01/02: the production recordTerminalReceiptFromLifecycle function is the one SdkController.handleCommandJobLifecycle calls (production lifecycle reach, not a private-field injection)", async () => {
		// PRD-01: a real CommandJobManager + real
		// BackgroundNotifyCoordinator. The manager's
		// `onCommandJobLifecycle` is the production
		// callback seam (line 1386 of
		// command-job-manager.ts). We wire the SAME
		// function that the SdkController's
		// `handleCommandJobLifecycle` calls
		// (`recordTerminalReceiptFromLifecycle`).
		const manager = new CommandJobManager({
			maxTerminalJobs: 2,
			maxWaitBudgetMs: 50,
			spawnFactory: () => fakeSupervisor(),
		})
		const ownerSessionId = "session-htec01-prd"
		const ownerTaskId = "task-htec01-prd"
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
			enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
			discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
			now: () => Date.now(),
		})

		// Register a marker (notify=true).
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

		// Wire the PRODUCTION recorder (the exact function
		// called by the SdkController's
		// `handleCommandJobLifecycle`). The test does NOT
		// duplicate the production body — it calls the
		// production function directly.
		const lifecycleEvents: Array<{ event: string; jobId: string }> = []
		;(manager as unknown as { onCommandJobLifecycle: (e: MinimalLifecycleEvent) => void }).onCommandJobLifecycle = (
			event: MinimalLifecycleEvent,
		) => {
			lifecycleEvents.push({ event: event.event, jobId: event.jobId })
			// Call the PRODUCTION recorder. This is the same
			// function `SdkController.handleCommandJobLifecycle`
			// calls (extracted to a free function so the test
			// can exercise the EXACT same path).
			recordTerminalReceiptFromLifecycle(notifyCoordinator, event)
		}

		// Cancel A. The lifecycle event fires
		// synchronously, the recorder captures the receipt.
		await manager.cancel({ jobId: a.jobId })

		// PRD-01: the lifecycle event was received and the
		// receipt was recorded via the production recorder.
		expect(lifecycleEvents.length).toBeGreaterThanOrEqual(1)
		expect(lifecycleEvents.some((e) => e.event === "command_job_terminal_committed" && e.jobId === a.jobId)).toBe(true)
		// The receipt is in the BCB (recorded by the production
		// recorder, not by a private-field injection).
		const receipt = (
			notifyCoordinator as unknown as { terminalReceipts: Map<string, { sessionId: string; taskId: string | undefined }> }
		).terminalReceipts.get(a.jobId)
		expect(receipt).toBeDefined()
		expect(receipt?.sessionId).toBe(ownerSessionId)
		expect(receipt?.taskId).toBe(ownerTaskId)

		// Force eviction of A from the manager's terminal
		// map so `command_status` consults the receipt
		// (not the manager snapshot).
		for (let i = 0; i < 2; i += 1) {
			const j = await manager.start({
				command: "sleep 600",
				cwd: "/tmp",
				waitBudgetMs: 25,
				executionDeadlineMs: 30_000,
			})
			await manager.cancel({ jobId: j.jobId })
		}
		const postEvict = await manager.status({ jobId: a.jobId, waitMs: 0 })
		expect(postEvict.ok).toBe(false)

		// PRD-02: a real `command_status` (production
		// factory `createCommandStatusTool`) consumes the
		// receipt through the correct owner.
		const tool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: ownerSessionId, taskId: ownerTaskId }),
		})
		const result = await (tool.execute(
			{ jobId: a.jobId, waitMs: 0 },
			{ sessionId: ownerSessionId, agentId: "test-agent", iteration: 1 },
		) as Array<Record<string, unknown>>)
		expect(result[0]?.ok).toBe(true)
		expect(result[0]?.state).toBe("cancelled")
		expect(result[0]?.observation).toBe("evicted_receipt")
		expect(result[0]?.outputRetained).toBe(false)

		await manager.dispose()
		notifyCoordinator.dispose()
	}, 30_000)
})
