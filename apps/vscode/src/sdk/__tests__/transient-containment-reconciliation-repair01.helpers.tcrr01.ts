/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * — shared test helpers.
 *
 * These helpers are the ONLY place that knows how to drive the REAL
 * production `CommandJobManager` against the REAL production supervisor.
 * The focused suite imports them so the process-supervision harness is
 * NOT duplicated (the ACT explicitly forbids duplicating the NEPCR01
 * real-process infrastructure).
 */

import {
	type CommandJobLifecycleEvent,
	type CommandJobManager,
	CommandJobManager as RealCommandJobManager,
} from "../command-job-manager"
import { observeGroup, observeGroupLiveness, readDescendantPid } from "./natural-exit-pgid-observation-harness.nepcr01"

/**
 * A descendant that REDIRECTS its stdio away from the supervisor's pipes
 * does NOT hold the stdout pipe open. The supervisor's `exit` promise
 * (child `close` event) then resolves as soon as the ROOT exits, while
 * the descendant is still alive in the owned process group. This is the
 * load-bearing N1 shape.
 */
export const STDIO_REDIRECTED_DESCENDANT = (seconds: number) =>
	`( sleep ${seconds} </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )`

export type ReconciliationEvent = Extract<CommandJobLifecycleEvent, { event: "command_job_containment_reconciled" }>

export type ReconciliationSchedule = {
	readonly enabled?: boolean
	readonly maxAttempts?: number
	readonly horizonMs?: number
	readonly intervalMs?: number
}

export type RealRunResult = {
	readonly jobId: string
	readonly pgid: number | undefined
	readonly rootPid: number | undefined
	readonly descendantPid: number | undefined
	/** The manager's own production classification at finalize time. */
	readonly productionPostcondition: string | undefined
	/** The manager's own production terminal class at finalize time. */
	readonly productionTerminalState: string | undefined
	/** The READ-ONLY kernel-truth liveness immediately after finalize. */
	readonly immediateLiveness: "alive" | "gone" | "unknown"
	/** The READ-ONLY kernel-truth liveness after the descendant finished. */
	readonly laterLiveness: "alive" | "gone" | "unknown"
	/** True iff the descendant was positively identified IN the owned PGID. */
	readonly descendantIdentityVerified: boolean
	/** The lifecycle stream (read-only observation of production facts). */
	readonly events: CommandJobLifecycleEvent[]
	readonly reconciliation: ReconciliationEvent | undefined
	readonly containmentFailures: number
	readonly terminalCommits: number
}

/**
 * Build the REAL manager with the REAL supervisor and the REAL default
 * postcondition probe. Only the lifecycle sink is injected (read-only).
 */
export function buildRealManager(
	events: CommandJobLifecycleEvent[],
	overrides: { readonly containmentReconciliation?: ReconciliationSchedule } = {},
): CommandJobManager {
	// The experimental Seatbelt sandbox is disabled so the experiment
	// exercises the CLASSIC supervised path (the one the LIVE incident
	// used).
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	return new RealCommandJobManager({
		maxWaitBudgetMs: 5_000,
		maxExecutionDeadlineMs: 120_000,
		onCommandJobLifecycle: (e) => events.push(e),
		...(overrides.containmentReconciliation ? { containmentReconciliation: overrides.containmentReconciliation } : {}),
	})
}

/**
 * Drive the REAL manager through a natural shell exit and observe the
 * owned process group BEFORE and AFTER the descendant finishes.
 *
 * NOTHING about the supervision is injected: the manager spawns through
 * the production supervisor and classifies through the production
 * `defaultTerminalPostconditionProbe`.
 */
export async function runRealNaturalExit(opts: {
	readonly command: string
	readonly cwd: string
	readonly waitForDescendantMs: number
	readonly observeAfterMs: number
	readonly containmentReconciliation?: ReconciliationSchedule
}): Promise<RealRunResult> {
	const events: CommandJobLifecycleEvent[] = []
	const manager = buildRealManager(events, { containmentReconciliation: opts.containmentReconciliation })
	const started = await manager.start({
		command: opts.command,
		cwd: opts.cwd,
		waitBudgetMs: 5_000,
		executionDeadlineMs: 120_000,
	})
	const rootPid = started.process.pid
	const pgid = started.process.pgid
	const descendantPid = readDescendantPid(started.stdout)

	// Await the production terminal transition.
	await started.terminalPromise
	await new Promise((r) => setTimeout(r, 20))

	const immediate = observeGroup(pgid ?? -1, rootPid)
	const descendantIdentityVerified =
		typeof descendantPid === "number" && immediate.members.some((m) => m.pid === descendantPid && m.pgid === pgid)

	// Let the descendant finish naturally, then observe the group again.
	await new Promise((r) => setTimeout(r, opts.waitForDescendantMs))
	const later = observeGroup(pgid ?? -1, rootPid)

	const cleanupEvent = events.find((e) => e.event === "command_job_containment_failed")
	const commitEvent = events.find((e) => e.event === "command_job_terminal_committed")

	const result: { -readonly [K in keyof RealRunResult]: RealRunResult[K] } = {
		jobId: started.jobId,
		pgid,
		rootPid,
		descendantPid,
		productionPostcondition: events.find((e) => e.event === "command_job_primary_group_cleanup")?.postcondition,
		productionTerminalState: cleanupEvent?.jobState ?? commitEvent?.jobState,
		immediateLiveness: immediate.liveness,
		laterLiveness: later.liveness,
		descendantIdentityVerified,
		events,
		reconciliation: undefined,
		containmentFailures: events.filter((e) => e.event === "command_job_containment_failed").length,
		terminalCommits: events.filter((e) => e.event === "command_job_terminal_committed").length,
	}

	// Give the bounded reconciliation schedule a chance to observe the
	// group before the manager is torn down.
	await new Promise((r) => setTimeout(r, opts.observeAfterMs))
	result.reconciliation = events.find((e): e is ReconciliationEvent => e.event === "command_job_containment_reconciled")

	await manager.dispose("test_dispose").catch(() => {})
	return result
}

/**
 * Wait until the manager publishes a reconciliation event for `jobId`, or
 * the deadline elapses.
 */
export async function waitForReconciliation(
	events: CommandJobLifecycleEvent[],
	jobId: string,
	deadlineMs: number,
): Promise<ReconciliationEvent | undefined> {
	const startedAt = Date.now()
	for (;;) {
		const found = events.find(
			(e): e is ReconciliationEvent => e.event === "command_job_containment_reconciled" && e.jobId === jobId,
		)
		if (found) return found
		if (Date.now() - startedAt >= deadlineMs) return undefined
		await new Promise((r) => setTimeout(r, 25))
	}
}

export { observeGroup, observeGroupLiveness, readDescendantPid }
