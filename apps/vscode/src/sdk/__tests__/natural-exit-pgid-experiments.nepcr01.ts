/**
 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01 (NEPCR01) — REAL-PROCESS
 * experiment driver.
 *
 * This module drives the REAL production `CommandJobManager` against the
 * REAL production supervisor (`spawnSupervisableShellCommand` from
 * `@cline/core`). NOTHING is injected:
 *
 *   - `spawnFactory` is NOT overridden  -> the real supervisor spawns.
 *   - `terminalPostconditionProbe` is NOT overridden -> the real
 *     `defaultTerminalPostconditionProbe` classifies.
 *
 * The only test-side additions are:
 *
 *   1. the READ-ONLY observation harness (separate module), used solely
 *      to record the kernel-truth group liveness AFTER the manager has
 *      already made its own classification, and
 *   2. a lifecycle-event sink, used solely to READ the production
 *      classification that the manager already published.
 *
 * WORKLOAD SHAPES
 * ---------------
 * The command shape matters because the production supervisor resolves its
 * `exit` promise on the child's `close` event — i.e. when the root process
 * has exited AND its stdio has drained. A descendant that INHERITS the
 * stdout pipe keeps that pipe open and therefore delays the exit
 * resolution until the descendant is gone; a descendant that REDIRECTS
 * its stdio away does not.
 *
 * That is exactly the boundary under investigation: the LIVE incident's
 * three natural-exit witnesses classified `alive` at finalize, which
 * requires the exit promise to resolve while the group is still alive.
 *
 * So the experiment matrix uses the stdio-redirected descendant (which
 * reproduces the LIVE shape) as the load-bearing case, and ALSO records
 * the stdio-inheriting variant to document why the two differ.
 */

import type { CommandJobLifecycleEvent, CommandJobManager } from "../command-job-manager"
import { CommandJobManager as RealCommandJobManager } from "../command-job-manager"
import {
	type GroupObservation,
	observeGroup,
	observeGroupUntilGone,
	readDescendantPid,
} from "./natural-exit-pgid-observation-harness.nepcr01"

export type ExperimentId = "N0" | "N1" | "N2" | "N3" | "C1" | "C2"

export type ExperimentRecord = {
	readonly experimentId: ExperimentId
	readonly evidenceClass: "REAL_PROCESS" | "REAL_PRODUCTION_SEAM"
	readonly description: string
	readonly command: string
	readonly jobId: string
	readonly rootPid: number | undefined
	readonly pgid: number | undefined
	readonly managerInstance: string
	readonly processStart: number
	readonly rootExitAtMs: number | undefined
	readonly supervisorExitResolutionAtMs: number | undefined
	readonly finalizeEnteredAtMs: number | undefined
	/** The PRODUCTION postcondition the manager classified. */
	readonly productionPostcondition: string | undefined
	/**
	 * The errno observed by the READ-ONLY harness at the finalize
	 * boundary. The production lifecycle event intentionally carries only
	 * the postcondition CLASS; the errno reaches the containment ledger
	 * (BJLA) through a separate capture. This field is the test-side
	 * read-only observation of the same errno, recorded AFTER the
	 * manager had already classified.
	 */
	readonly productionOsErrorCode: string | null | undefined
	readonly managerTerminalState: string | undefined
	readonly containmentFailed: string | undefined
	/** The READ-ONLY kernel-truth liveness at the finalize boundary. */
	readonly immediateObservation: GroupObservation
	readonly laterObservations: readonly GroupObservation[]
	readonly laterLiveness: "alive" | "gone" | "unknown"
	readonly descendantPid: number | undefined
	readonly descendantIdentityVerified: boolean
	readonly cleanupOutcome: "verified_absent" | "residual_observed" | "unknown"
	readonly result: string
	/** Bounded stdout/stderr tail for the report. */
	readonly stdoutTail: string
	readonly stderrTail: string
}

const MANAGER_INSTANCE_COUNTER = { n: 0 }

function nextManagerInstance(): string {
	MANAGER_INSTANCE_COUNTER.n += 1
	return `nepcr01-manager-${MANAGER_INSTANCE_COUNTER.n}`
}

/**
 * The production postcondition is published on the
 * `command_job_primary_group_cleanup` lifecycle event.
 */
function readProductionPostcondition(events: CommandJobLifecycleEvent[]): {
	postcondition?: string
	finalizeEntered?: number
} {
	for (const e of events) {
		if (e.event === "command_job_primary_group_cleanup") {
			// NOTE: the lifecycle event deliberately carries only the
			// POSTCONDITION CLASS. The underlying errno reaches the
			// containment ledger (BJLA) through a separate capture, not
			// through this event. The test-side READ-ONLY harness
			// records the errno independently.
			return {
				postcondition: e.postcondition,
				finalizeEntered: e.tsMs,
			}
		}
	}
	return {}
}

/**
 * Build the REAL manager with the REAL supervisor and the REAL default
 * postcondition probe. Only the lifecycle sink is injected (read-only).
 */
function buildRealManager(events: CommandJobLifecycleEvent[]): CommandJobManager {
	// The experimental Seatbelt sandbox is disabled so the experiment
	// exercises the CLASSIC supervised path (the one the LIVE incident
	// used). The seatbelt path would route the spawn through
	// `sandbox-exec`, which is unavailable in this substrate.
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	return new RealCommandJobManager({
		maxWaitBudgetMs: 5_000,
		maxExecutionDeadlineMs: 120_000,
		onCommandJobLifecycle: (e) => events.push(e),
	})
}

export type RunExperimentOptions = {
	readonly experimentId: ExperimentId
	readonly description: string
	readonly command: string
	readonly cwd: string
	/** "natural" | "cancel" | "deadline" */
	readonly termination: "natural" | "cancel" | "deadline"
	/** Observation window for the later group observations. */
	readonly observationWindowMs: number
	readonly waitBudgetMs: number
	readonly executionDeadlineMs: number
	/** For "cancel": how long to wait before requesting cancellation. */
	readonly cancelAfterMs?: number
	/** For "deadline": the execution deadline handed to the manager. */
	readonly deadlineMs?: number
}

/**
 * Run ONE real-process experiment end to end and return the bounded
 * observation record.
 */
export async function runExperiment(opts: RunExperimentOptions): Promise<ExperimentRecord> {
	const events: CommandJobLifecycleEvent[] = []
	const manager = buildRealManager(events)
	const managerInstance = nextManagerInstance()
	const processStart = Date.now()
	let supervisorExitResolutionAtMs: number | undefined

	const started = await manager.start({
		command: opts.command,
		cwd: opts.cwd,
		waitBudgetMs: opts.waitBudgetMs,
		executionDeadlineMs: opts.deadlineMs ?? opts.executionDeadlineMs,
	})

	const rootPid = started.process.pid
	const pgid = started.process.pgid

	// The supervisor's `exit` promise is the production completion
	// boundary. Record when it resolves (this is what drives
	// `finalize()`).
	const exitWatch = started.process.exit.then(
		(result) => {
			supervisorExitResolutionAtMs = Date.now()
			return result
		},
		() => {
			supervisorExitResolutionAtMs = Date.now()
			return undefined
		},
	)

	if (opts.termination === "cancel") {
		await new Promise((r) => setTimeout(r, opts.cancelAfterMs ?? 500))
		await manager.cancel({ jobId: started.jobId })
	}

	await exitWatch
	await started.terminalPromise

	const production = readProductionPostcondition(events)
	const immediateObservation = observeGroup(pgid ?? -1, rootPid)
	const { observations: laterObservations } = await observeGroupUntilGone(pgid ?? -1, rootPid, opts.observationWindowMs)
	const finalObservation = laterObservations[laterObservations.length - 1] ?? immediateObservation

	const stdoutTail = started.stdout.slice(-400)
	const descendantPid = readDescendantPid(started.stdout)

	// Positive proof of descendant identity + group membership: the
	// descendant must have been observed as a member of the ORIGINAL
	// pgid.
	let descendantIdentityVerified = false
	if (typeof descendantPid === "number") {
		descendantIdentityVerified = immediateObservation.members.some((m) => m.pid === descendantPid && m.pgid === pgid)
	}

	const terminalEvents = events.filter(
		(e) => e.event === "command_job_containment_failed" || e.event === "command_job_terminal_committed",
	)
	const containmentEvent = terminalEvents.find((e) => e.event === "command_job_containment_failed")
	const committedEvent = terminalEvents.find((e) => e.event === "command_job_terminal_committed")
	const managerTerminalState = containmentEvent?.jobState ?? committedEvent?.jobState ?? started.state
	const containmentFailed =
		containmentEvent && containmentEvent.event === "command_job_containment_failed"
			? containmentEvent.containmentFailed
			: undefined

	const cleanupOutcome: ExperimentRecord["cleanupOutcome"] =
		finalObservation.liveness === "gone"
			? "verified_absent"
			: finalObservation.liveness === "alive"
				? "residual_observed"
				: "unknown"

	const result = buildResult({
		productionPostcondition: production.postcondition,
		managerTerminalState,
		containmentFailed,
		laterLiveness: finalObservation.liveness,
	})

	void manager.dispose?.().catch(() => {})

	return {
		experimentId: opts.experimentId,
		evidenceClass: "REAL_PROCESS",
		description: opts.description,
		command: opts.command,
		jobId: started.jobId,
		rootPid,
		pgid,
		managerInstance,
		processStart,
		rootExitAtMs: undefined,
		supervisorExitResolutionAtMs,
		finalizeEnteredAtMs: production.finalizeEntered,
		productionPostcondition: production.postcondition,
		productionOsErrorCode: immediateObservation.osErrorCode,
		managerTerminalState,
		containmentFailed,
		immediateObservation,
		laterObservations,
		laterLiveness: finalObservation.liveness,
		descendantPid,
		descendantIdentityVerified,
		cleanupOutcome,
		result,
		stdoutTail,
		stderrTail: started.stderr.slice(-400),
	}
}

function buildResult(input: {
	productionPostcondition: string | undefined
	managerTerminalState: string | undefined
	containmentFailed: string | undefined
	laterLiveness: "alive" | "gone" | "unknown"
}): string {
	if (input.productionPostcondition === "gone") {
		return `CLEAN_TERMINAL (postcondition=gone, terminal=${input.managerTerminalState})`
	}
	if (input.productionPostcondition === undefined) {
		return "NO_POSTCONDITION_RECORDED"
	}
	if (input.laterLiveness === "gone") {
		return `NON_GONE_AT_FINALIZE_THEN_GONE (postcondition=${input.productionPostcondition}, containmentFailed=${input.containmentFailed})`
	}
	if (input.laterLiveness === "alive") {
		return `NON_GONE_AT_FINALIZE_AND_STILL_ALIVE (postcondition=${input.productionPostcondition}, containmentFailed=${input.containmentFailed})`
	}
	return `NON_GONE_AT_FINALIZE_LATER_UNKNOWN (postcondition=${input.productionPostcondition})`
}
