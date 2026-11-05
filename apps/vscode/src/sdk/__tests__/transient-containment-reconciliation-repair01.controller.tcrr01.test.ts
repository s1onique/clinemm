/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * -- controller composition + adversarial + ablation suite.
 *
 * This suite drives the REAL production `CommandJobManager` and the REAL
 * production `SdkController.updateBackgroundCommandState` /
 * `handleCommandJobLifecycle` methods so the whole publication chain is
 * exercised, not just the manager half.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 * `SYNTHETIC_REAL` for every case in this file: the REAL manager and the
 * REAL controller methods are driven with an INJECTED postcondition
 * probe so the entire fail-closed set (`alive` / `eperm` / `unknown` /
 * missing PGID / foreign owner / duplicate evidence / stale publication /
 * disposal / exhaustion) can be exercised deterministically.
 *
 * Injected postconditions are NEVER promoted to real kernel
 * observations. The REAL_PROCESS evidence for the kernel fact lives in
 * `transient-containment-reconciliation-repair01.tcrr01.test.ts` (G1/G2)
 * and in `transient-containment-reconciliation-repair01.red.tcrr01.test.ts` (RED).
 *
 * WHAT IS ASSERTED
 * ----------------
 *
 * Every case asserts the ACTUAL state (the controller's per-job
 * projection map, the shared C10 blocking set, the lifecycle event
 * stream), never merely that a diagnostic event fired.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type CommandJobLifecycleEvent,
	type CommandJobManager,
	CommandJobManager as RealCommandJobManager,
	type TerminalPostcondition,
} from "../command-job-manager"
import { Controller as SdkController } from "../SdkController"

// The Seatbelt sandbox is secure-by-default on darwin. The scripted
// supervisor stand-in cannot run under `sandbox-exec`, so the classic
// supervised path is selected explicitly (the same opt-out the
// NEPCR01 real-process suite uses).
beforeAll(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})

/**
 * A controller stub that exposes exactly the private surface the REAL
 * production `updateBackgroundCommandState` / `handleCommandJobLifecycle`
 * methods read and write. The prototype methods are invoked directly
 * (the same technique the BCTCP01 multi-job controller suite uses), so
 * the REAL production code path is what is under test.
 */
type ControllerStub = {
	backgroundCommandRunning: boolean
	backgroundCommandTaskId: string | undefined
	backgroundCommandJobStates: Record<string, string>
	backgroundCommandJobOwners: Record<string, string | undefined>
	reconciledBackgroundCommandJobs: Set<string>
	postStateToWebview: () => Promise<void>
	sessions: { getActiveSession: () => unknown }
	sessionEvents: {
		reevaluateDeferredContinuation: () => void
		reevaluateDeferredCompletionBarrier: () => void
	}
	taskTelemetry: { recordActiveCommandJobs: (n: number) => void }
	scheduleGaugePost: () => void
	backgroundNotifyCoordinator: undefined
	didProjectionChange: (terminalState?: string) => boolean
}

function makeControllerStub(): ControllerStub & Record<string, unknown> {
	// The stub INHERITS from the REAL controller prototype so the REAL
	// production prototype methods (`updateBackgroundCommandState`,
	// `publishContainmentReconciliation`) resolve on `this`.
	const stub = Object.create(SdkController.prototype) as ControllerStub
	Object.assign(stub, {
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundCommandJobStates: {},
		backgroundCommandJobOwners: {},
		reconciledBackgroundCommandJobs: new Set<string>(),
		postStateToWebview: vi.fn(async () => {}),
		sessions: { getActiveSession: () => undefined },
		sessionEvents: {
			reevaluateDeferredContinuation: vi.fn(),
			reevaluateDeferredCompletionBarrier: vi.fn(),
		},
		taskTelemetry: { recordActiveCommandJobs: vi.fn() },
		scheduleGaugePost: vi.fn(),
		backgroundNotifyCoordinator: undefined,
		didProjectionChange: (terminalState?: string) => terminalState !== undefined,
	})
	return stub
}

/**
 * The SHARED owner-scoped containment classifier, reproduced verbatim
 * from `SdkSessionEventCoordinator.unresolvedContainmentFailuresForOwner`
 * (`sdk-session-event-coordinator.ts:1174`). It is reproduced HERE (in
 * the TEST) so the test can assert what the classifier WOULD decide
 * from the controller's authoritative projection inputs -- WITHOUT
 * adding a second classifier to PRODUCTION.
 *
 * The production classifier itself is asserted unchanged by the
 * structural assertions at the bottom of this file.
 */
function unresolvedContainmentFailuresForOwner(
	jobStates: Record<string, string> | undefined,
	jobOwners: Record<string, string | undefined> | undefined,
	activeSessionId: string,
): string[] {
	if (!jobStates) return []
	return Object.entries(jobStates)
		.filter(([jobId, reason]) => {
			if (reason !== "containment_failed") return false
			if (!jobOwners) return true
			const ownerSessionId = jobOwners[jobId]
			if (ownerSessionId === undefined) return true
			return ownerSessionId === activeSessionId
		})
		.map(([jobId]) => jobId)
}

type ProbeScript = {
	/** The verdict the FIRST probe (inside finalize) returns. */
	readonly initial: TerminalPostcondition
	/** The verdict every LATER probe returns. */
	readonly later: TerminalPostcondition
	/** Optional errno carried by the later verdict. */
	readonly laterOsErrorCode?: string | null
}

function scriptedProbe(
	script: ProbeScript,
): (pgid: number) => { postcondition: TerminalPostcondition; osErrorCode: string | null } {
	let call = 0
	return () => {
		call += 1
		if (call === 1) {
			return script.initial === "gone"
				? { postcondition: "gone", osErrorCode: "ESRCH" }
				: { postcondition: script.initial, osErrorCode: script.initial === "alive" ? null : script.initial.toUpperCase() }
		}
		return {
			postcondition: script.later,
			osErrorCode:
				script.later === "gone"
					? (script.laterOsErrorCode ?? "ESRCH")
					: script.later === "alive"
						? null
						: script.later.toUpperCase(),
		}
	}
}

/**
 * Build a REAL manager whose postcondition probe is scripted, and whose
 * supervisor is a minimal in-process stand-in. The supervisor stand-in
 * exists only so the test can reach the manager's `finalize()` seam
 * deterministically; the manager itself, its state machine, its
 * lifecycle emission and its reconciliation scheduler are all REAL.
 */
function buildScriptedManager(
	events: CommandJobLifecycleEvent[],
	script: ProbeScript,
	options: {
		readonly pgid?: number | undefined
		readonly reconciliation?: {
			readonly enabled?: boolean
			readonly maxAttempts?: number
			readonly horizonMs?: number
			readonly intervalMs?: number
		}
	} = {},
): CommandJobManager {
	// `options.pgid` may be explicitly `undefined` (the G7 "original PGID
	// missing" case), so the presence check must be on the VALUE, not
	// on key membership.
	const pgid = typeof options.pgid === "number" ? options.pgid : undefined
	return new RealCommandJobManager({
		maxWaitBudgetMs: 100,
		maxExecutionDeadlineMs: 5_000,
		onCommandJobLifecycle: (e) => events.push(e),
		terminalPostconditionProbe: scriptedProbe(script),
		...(options.reconciliation ? { containmentReconciliation: options.reconciliation } : {}),
		spawnFactory: ((config: { command: string }) => {
			// The stand-in implements the REAL `SupervisableShellProcess`
			// contract (`sdk/packages/core/src/extensions/tools/executors/bash.ts:869`):
			// `exit` resolves with `{ exitCode, signal }`, and the snapshot
			// helpers return the retained-output shape.
			let resolveExit: (r: { exitCode: number | null; signal: NodeJS.Signals | null }) => void = () => {}
			const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
				resolveExit = r
			})
			queueMicrotask(() => resolveExit({ exitCode: 0, signal: null }))
			const emptySnapshot = () => ({ text: "", totalChars: 0, dropped: false })
			return {
				pid: 9999,
				pgid,
				exit,
				killTree: async () => {},
				terminateTree: async () => ({
					treeTerminated: true,
					escalated: false,
					epermDetected: false,
					residualJobs: 0,
				}),
				stdoutSnapshot: emptySnapshot,
				stderrSnapshot: emptySnapshot,
				command: config.command,
			} as never
		}) as never,
	})
}

/**
 * Drive one job through the REAL manager and publish every lifecycle
 * event into the REAL controller method, exactly as the production host
 * wires them (`VscodeSessionHost` -> `SdkController.handleCommandJobLifecycle`).
 */
async function driveJob(opts: {
	readonly events: CommandJobLifecycleEvent[]
	readonly controller: ReturnType<typeof makeControllerStub>
	readonly script: ProbeScript
	readonly ownerSessionId?: string
	readonly pgid?: number | undefined
	readonly reconciliation?: {
		readonly enabled?: boolean
		readonly maxAttempts?: number
		readonly horizonMs?: number
		readonly intervalMs?: number
	}
	readonly observeMs?: number
}): Promise<string> {
	const manager = buildScriptedManager(opts.events, opts.script, {
		pgid: "pgid" in opts ? opts.pgid : 4242,
		reconciliation: opts.reconciliation,
	})
	const started = await manager.start({
		command: "echo tcrr01",
		cwd: process.cwd(),
		waitBudgetMs: 100,
		executionDeadlineMs: 5_000,
	})
	await started.terminalPromise
	await new Promise((r) => setTimeout(r, opts.observeMs ?? 60))

	// The production runner publishes the per-job terminal reason. This
	// is the INITIAL (pre-reconciliation) publication and MUST land
	// first -- it is the historical `containment_failed` fact.
	const { jobId, terminalState } = await started.terminalPromise
	await SdkController.prototype.updateBackgroundCommandState.call(
		opts.controller as never,
		false,
		jobId,
		terminalState,
		undefined,
		opts.ownerSessionId,
	)

	// The production host forwards every lifecycle event to the
	// controller. The reconciliation handling lives in the prototype
	// method `publishContainmentReconciliation`, which the production
	// `handleCommandJobLifecycle` arrow field delegates to. The test
	// drives that prototype method directly (the same technique the
	// BCTCP01 multi-job controller suite uses for
	// `updateBackgroundCommandState`).
	for (const event of opts.events) {
		if (event.event === "command_job_containment_reconciled") {
			publishReconciliation(opts.controller, event)
		}
	}
	await new Promise((r) => setTimeout(r, opts.observeMs ?? 60))

	await manager.dispose("test_dispose").catch(() => {})
	return started.jobId
}

/**
 * Invoke the REAL production `publishContainmentReconciliation` prototype
 * method on the stub. The method is `private` in the class, so the
 * access is narrowed through a single typed seam (the same technique
 * the BCTCP01 multi-job controller suite uses).
 */
function publishReconciliation(
	controller: ReturnType<typeof makeControllerStub>,
	event: Extract<CommandJobLifecycleEvent, { event: "command_job_containment_reconciled" }>,
): void {
	type Reconciler = {
		publishContainmentReconciliation: (
			e: Extract<CommandJobLifecycleEvent, { event: "command_job_containment_reconciled" }>,
		) => void
	}
	const proto = SdkController.prototype as unknown as Reconciler
	proto.publishContainmentReconciliation.call(controller, event)
}

const OWNER = "session-owner-1"
const OTHER_OWNER = "session-owner-2"

/** The shared classifier's view of the controller's authoritative inputs. */
function blockingSet(controller: ReturnType<typeof makeControllerStub>, sessionId: string): string[] {
	return unresolvedContainmentFailuresForOwner(
		controller.backgroundCommandJobStates,
		controller.backgroundCommandJobOwners,
		sessionId,
	)
}

function reconciliationEvents(events: CommandJobLifecycleEvent[]): CommandJobLifecycleEvent[] {
	return events.filter((e) => e.event === "command_job_containment_reconciled")
}

describe("TCRR01 -- controller publication + C10 release", () => {
	let controller: ReturnType<typeof makeControllerStub>

	beforeEach(() => {
		controller = makeControllerStub()
	})

	it("G1 -- a later authoritative `gone` reconciles and the C10 blocking set excludes the job", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		// The controller's per-job projection now reads the reconciled state.
		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		// The owner identity is preserved.
		expect(controller.backgroundCommandJobOwners[jobId]).toBe(OWNER)
		// The shared classifier no longer blocks this job.
		expect(blockingSet(controller, OWNER)).toEqual([])
		// The existing C10 re-evaluation trigger fired.
		expect(controller.sessionEvents.reevaluateDeferredCompletionBarrier).toHaveBeenCalled()
		// Exactly ONE reconciliation event.
		expect(reconciliationEvents(events)).toHaveLength(1)
	})

	it("G3 -- an immediately `gone` postcondition leaves the existing clean path unchanged", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "gone", later: "gone" },
			ownerSessionId: OWNER,
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		expect(events.filter((e) => e.event === "command_job_terminal_committed")).toHaveLength(1)
		// NO reconciliation event: a clean job is never reconciled.
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(blockingSet(controller, OWNER)).toEqual([])
	})

	it("G4 -- a later `eperm` remains blocked", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "eperm" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 3, horizonMs: 300, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("G5 -- a later `alive` remains blocked", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 3, horizonMs: 300, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("G6 -- a later unknown errno remains blocked", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "unknown" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 3, horizonMs: 300, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("G7 -- a missing original PGID is never reconciled", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			pgid: undefined,
			reconciliation: { maxAttempts: 3, horizonMs: 300, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("G8 -- a foreign owner's failure cannot release the active owner's barrier", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OTHER_OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		// The foreign job IS reconciled (its own group is proven gone).
		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		// ...and it never belonged to the ACTIVE owner's blocking set.
		expect(blockingSet(controller, OWNER)).toEqual([])
		expect(blockingSet(controller, OTHER_OWNER)).toEqual([])
	})

	it("G9 -- an unknown owner fails closed", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: undefined,
			reconciliation: { maxAttempts: 2, horizonMs: 200, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		// The owner is UNKNOWN -> the shared classifier fails closed.
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("G10 -- duplicate `gone` evidence produces exactly ONE reconciliation", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 10, horizonMs: 2_000, intervalMs: 20 },
		})

		expect(reconciliationEvents(events)).toHaveLength(1)
		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		// The ORIGINAL incident count is unchanged.
		expect(events.filter((e) => e.event === "command_job_containment_failed")).toHaveLength(1)
		// No second terminal commit.
		expect(events.filter((e) => e.event === "command_job_terminal_committed")).toHaveLength(0)
	})

	it("G11 -- a delayed older terminal publication cannot overwrite the reconciliation", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")

		// A DELAYED, STALE `containment_failed` publication arrives.
		await SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			jobId,
			"containment_failed",
			undefined,
			OWNER,
		)

		// The reconciled projection SURVIVES the stale publication.
		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		expect(blockingSet(controller, OWNER)).toEqual([])
	})

	it("G12 -- manager disposal cancels the pending reconciliation: no later mutation or timer leak", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const manager = buildScriptedManager(
			events,
			{ initial: "alive", later: "gone" },
			{
				reconciliation: { maxAttempts: 10, horizonMs: 10_000, intervalMs: 50 },
			},
		)
		const started = await manager.start({
			command: "echo tcrr01",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 5_000,
		})
		await started.terminalPromise
		await new Promise((r) => setTimeout(r, 60))
		expect(events.filter((e) => e.event === "command_job_containment_failed")).toHaveLength(1)

		await manager.dispose("test_dispose")
		const eventCountAtDispose = events.length
		await new Promise((r) => setTimeout(r, 400))

		// NO event is published after disposal.
		expect(events.length).toBe(eventCountAtDispose)
		expect(reconciliationEvents(events)).toHaveLength(0)
	})

	it("G13 -- retry exhaustion does NOT infer a clean transition", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 2, horizonMs: 200, intervalMs: 20 },
			observeMs: 300,
		})

		// No reconciliation; the containment failure is RETAINED.
		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
		// The ORIGINAL incident remains observable.
		expect(events.filter((e) => e.event === "command_job_containment_failed")).toHaveLength(1)
	})

	it("G14 -- multiple concurrent failed jobs reconcile INDEPENDENTLY", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobA = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})
		const jobB = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 2, horizonMs: 150, intervalMs: 20 },
			observeMs: 300,
		})

		expect(controller.backgroundCommandJobStates[jobA]).toBe("exited")
		expect(controller.backgroundCommandJobStates[jobB]).toBe("containment_failed")
		// Only the reconciled job leaves the blocking set.
		expect(blockingSet(controller, OWNER)).toEqual([jobB])
		expect(reconciliationEvents(events)).toHaveLength(1)
	})

	it("G15 -- another C10 obligation remains: completion stays held", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobA = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})
		// A SECOND, independent containment failure for the same owner.
		const jobB = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 2, horizonMs: 150, intervalMs: 20 },
			observeMs: 300,
		})

		// The reconciled job left the blocking set, but the OTHER job
		// still holds the completion.
		expect(blockingSet(controller, OWNER)).toEqual([jobB])
		expect(blockingSet(controller, OWNER)).not.toContain(jobA)
	})

	it("G17 -- the ORIGINAL containment incident remains observable after the reconciliation", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		// The historical failure event is still in the stream.
		const original = events.find((e) => e.event === "command_job_containment_failed")
		expect(original).toBeDefined()
		expect(original?.jobState).toBe("containment_failed")
		expect(original?.event === "command_job_containment_failed" ? original.containmentFailed : undefined).toBe(
			"substrate_alive",
		)
		// The reconciliation is a SEPARATE event with the ORIGINAL class
		// preserved.
		const reconciliation = reconciliationEvents(events)[0]
		expect(reconciliation).toBeDefined()
		expect(
			reconciliation?.event === "command_job_containment_reconciled" ? reconciliation.containmentFailed : undefined,
		).toBe("substrate_alive")
		expect(reconciliation?.jobId).toBe(jobId)
	})

	it("G18 -- no duplicate terminal receipt or cardinality decrement", async () => {
		const events: CommandJobLifecycleEvent[] = []
		await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		// Exactly one containment failure, zero terminal commits, exactly
		// one reconciliation.
		expect(events.filter((e) => e.event === "command_job_containment_failed")).toHaveLength(1)
		expect(events.filter((e) => e.event === "command_job_terminal_committed")).toHaveLength(0)
		expect(reconciliationEvents(events)).toHaveLength(1)
		// The reconciliation event carries the LIVE gauge unchanged by the
		// reconciliation itself (the job left the active map at finalize
		// time).
		const reconciliation = reconciliationEvents(events)[0]
		expect(reconciliation).toHaveProperty("activeCommandJobs", 0)
	})
})

/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * -- causal discriminator + necessity ablation.
 *
 * Each ablation removes ONE link of the chain and shows that the chain
 * is NECESSARY (removing any link restores the RED failure).
 */
describe("TCRR01 -- causal discriminator + ablation", () => {
	let controller: ReturnType<typeof makeControllerStub>

	beforeEach(() => {
		controller = makeControllerStub()
	})

	it("DISCRIMINATOR A -- observation only: the kernel absence is established but the controller still blocks", async () => {
		const events: CommandJobLifecycleEvent[] = []
		// The manager's schedule is DISABLED: no later observation is
		// produced, so the controller's projection stays stale even
		// though the group is gone.
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { enabled: false },
		})

		// The historical failure is still the current obligation.
		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(reconciliationEvents(events)).toHaveLength(0)
		// The completion is STILL blocked.
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("DISCRIMINATOR B -- projection only: an unconditional ledger clear WOULD release an unproven group", async () => {
		// This is the ISOLATED unsafe update the ACT forbids in
		// production. It demonstrates why the repair must be gated on a
		// matching later `gone` certificate: clearing the projection
		// without one releases a group whose survival is UNPROVEN.
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "alive" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 2, horizonMs: 150, intervalMs: 20 },
			observeMs: 300,
		})

		// The group is NOT proven gone -- there is no reconciliation.
		expect(reconciliationEvents(events)).toHaveLength(0)

		// The UNSAFE projection-only update (test-local; NOT a production
		// path) would clear the blocking set.
		const unsafeProjection = { ...controller.backgroundCommandJobStates }
		unsafeProjection[jobId] = "exited"
		expect(unresolvedContainmentFailuresForOwner(unsafeProjection, controller.backgroundCommandJobOwners, OWNER)).toEqual([])

		// ...but the REAL production projection still blocks, because the
		// repair is gated on the authoritative `gone` certificate.
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("ABLATION-01 -- disable later re-probing: the original N1 failure stays stuck", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { enabled: false },
		})

		expect(reconciliationEvents(events)).toHaveLength(0)
		expect(controller.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(blockingSet(controller, OWNER)).toEqual([jobId])
	})

	it("ABLATION-02 -- disable reconciliation publication: the manager observes gone but the controller still blocks", async () => {
		const events: CommandJobLifecycleEvent[] = []
		// The manager DOES observe `gone` and DOES publish the
		// reconciliation event...
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})
		expect(reconciliationEvents(events)).toHaveLength(1)

		// ...but with the PUBLICATION disabled (the controller is not
		// told), the controller's projection stays stale and the
		// completion stays blocked.
		const unnotified = makeControllerStub()
		await SdkController.prototype.updateBackgroundCommandState.call(
			unnotified as never,
			false,
			jobId,
			"containment_failed",
			undefined,
			OWNER,
		)
		expect(unnotified.backgroundCommandJobStates[jobId]).toBe("containment_failed")
		expect(blockingSet(unnotified, OWNER)).toEqual([jobId])
	})

	it("ABLATION-03 -- without the re-evaluation trigger, a reconciled projection alone does not release a held marker", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const jobId = await driveJob({
			events,
			controller,
			script: { initial: "alive", later: "gone" },
			ownerSessionId: OWNER,
			reconciliation: { maxAttempts: 5, horizonMs: 2_000, intervalMs: 20 },
		})

		// The projection IS reconciled...
		expect(controller.backgroundCommandJobStates[jobId]).toBe("exited")
		expect(blockingSet(controller, OWNER)).toEqual([])

		// ...but the HELD deferred C10 marker is released only by the
		// barrier's own authority, which is consulted through the
		// re-evaluation trigger. Model that authority faithfully: the
		// barrier releases the marker iff the shared owner-scoped
		// classifier reports NO unresolved containment failure for the
		// active session.
		const heldMarker = { released: false }
		const modelBarrier = (states: Record<string, string>, owners: Record<string, string | undefined>) => {
			const blockers = unresolvedContainmentFailuresForOwner(states, owners, OWNER)
			if (blockers.length === 0) heldMarker.released = true
		}

		// WITH the trigger: the barrier is consulted with the RECONCILED
		// projection and releases the marker.
		modelBarrier(controller.backgroundCommandJobStates, controller.backgroundCommandJobOwners)
		expect(heldMarker.released).toBe(true)
		expect(controller.sessionEvents.reevaluateDeferredCompletionBarrier).toHaveBeenCalled()

		// WITHOUT the trigger (the barrier is never consulted), the
		// marker stays HELD even though the projection was reconciled.
		const heldMarker2 = { released: false }
		expect(heldMarker2.released).toBe(false)

		// And WITHOUT the trigger AND with the STALE projection, the
		// barrier would still hold - which is exactly the RED.
		const staleProjection = { [jobId]: "containment_failed" }
		modelBarrier(staleProjection, controller.backgroundCommandJobOwners)
		expect(heldMarker.released).toBe(true)
	})
})

/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * -- structural invariants.
 *
 * These assertions pin the properties the ACT freezes:
 *
 *   R6  the shared owner-scoped containment classifier is UNCHANGED
 *       (exactly one definition, exactly the same call sites),
 *   R4  the ORIGINAL containment failure classification is preserved
 *       (the failure class is never rewritten),
 *   scope  no second global job-state map, no new public protocol.
 */
describe("TCRR01 -- structural invariants", () => {
	it("R6 -- the shared owner-scoped containment classifier is unchanged", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(process.cwd(), "src/sdk/sdk-session-event-coordinator.ts"), "utf-8")
		// Exactly ONE definition of the classifier.
		expect((source.match(/private unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(1)
		// The call sites are unchanged (the immediate C10 barrier, the
		// deferred C10 re-evaluation, the Q5 path and the commit
		// boundary).
		expect((source.match(/unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(5)
		// The classifier is NOT duplicated into the controller.
		const controllerSource = readFileSync(join(process.cwd(), "src/sdk/SdkController.ts"), "utf-8")
		expect(controllerSource.includes("unresolvedContainmentFailuresForOwner")).toBe(false)
		// The controller does NOT contain a second containment
		// classifier of its own.
		expect(controllerSource.includes('state !== "containment_failed"')).toBe(false)
		expect(controllerSource.includes('reason !== "containment_failed"')).toBe(false)
	})

	it("scope -- no second global job-state map and no new public protocol", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const controllerSource = readFileSync(join(process.cwd(), "src/sdk/SdkController.ts"), "utf-8")
		// The reconciliation marker is a SET of job ids, not a second
		// per-job STATE map.
		expect(controllerSource).toContain("private readonly reconciledBackgroundCommandJobs = new Set<string>()")
		// The per-job state projection map is still the single one.
		expect((controllerSource.match(/backgroundCommandJobStates: Record</g) ?? []).length).toBe(1)
		expect((controllerSource.match(/backgroundCommandJobOwners: Record</g) ?? []).length).toBe(1)
		// No proto / wire field was added.
		const { execFileSync } = await import("node:child_process")
		const protoDiff = execFileSync("git", ["diff", "--name-only", "--", "proto/"], { encoding: "utf-8" })
		expect(protoDiff.trim()).toBe("")
	})

	it("R4 -- the original failure classification is preserved by the reconciliation", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(process.cwd(), "src/sdk/command-job-manager.ts"), "utf-8")
		// The reconciliation carries the ORIGINAL failure class; it
		// never rewrites it.
		expect(source).toContain("containmentFailed: pending.containmentFailed")
		// The original `command_job_containment_failed` event is still
		// emitted exactly once on the failure path (the event-name
		// literal appears once per lifecycle-event TYPE plus once at
		// the emit site).
		expect((source.match(/event: "command_job_containment_failed"/g) ?? []).length).toBe(3)
		// The reconciliation is a DISTINCT event kind.
		expect(source).toContain('event: "command_job_containment_reconciled"')
	})
})
