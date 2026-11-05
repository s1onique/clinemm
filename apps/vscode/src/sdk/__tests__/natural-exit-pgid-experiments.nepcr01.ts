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

import { spawnSupervisableShellCommand } from "@cline/core"
import type { CommandJobLifecycleEvent, CommandJobManager } from "../command-job-manager"
import { CommandJobManager as RealCommandJobManager } from "../command-job-manager"
import {
	type GroupObservation,
	observeGroup,
	observeGroupUntilGone,
	observeSignalCapability,
	readDescendantPid,
	type SignalCapability,
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
	/**
	 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01-CORRECTION01 (P0-1):
	 * the timestamp at which the host requested the termination (cancel
	 * request or deadline expiry). `undefined` for natural exits.
	 */
	readonly terminationRequestedAtMs: number | undefined
	/**
	 * CORRECTION01 (P0-1): the timestamp at which the owned process group
	 * was FIRST observed `gone` by the READ-ONLY harness. `undefined` when
	 * the group was never observed gone within the observation window.
	 */
	readonly groupGoneAtMs: number | undefined
	/**
	 * CORRECTION01 (P0-1): the elapsed time from the termination REQUEST
	 * to the group's observed disappearance. This is the ONLY quantity
	 * that can distinguish "the supervisor terminated the group" from
	 * "the workload finished on its own".
	 */
	readonly terminationToGoneMs: number | undefined
	/**
	 * CORRECTION01 (P0-1): the PRODUCTION supervisor's own termination
	 * verdict, read from the `command_job_primary_group_probe` lifecycle
	 * event (its `probeResult` is derived from the supervisor's
	 * `TerminateTreeResult.treeTerminated`). `undefined` when the event
	 * was not emitted (a natural exit performs no group termination).
	 */
	readonly supervisorTerminationProbe: "gone" | "alive" | "eperm" | "unknown" | undefined
	/**
	 * CORRECTION01 (P0-1): the timestamp of the supervisor's termination
	 * probe event, when one was emitted.
	 */
	readonly supervisorTerminationProbeAtMs: number | undefined
	/**
	 * CORRECTION01 (P0-1): whether this substrate can deliver a real
	 * termination signal to a foreign process group. Termination-efficacy
	 * claims are only permitted on a `signal_capable` substrate.
	 */
	readonly signalCapability: SignalCapability
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
	// CORRECTION01 (P0-1): the substrate's ability to deliver a real
	// termination signal to a foreign process group. Measured ONCE per
	// process; every termination-efficacy claim is gated on it.
	const signalCapability = observeSignalCapability()
	// CORRECTION01 (P0-1): the timestamp at which the host requested the
	// termination (cancel request). The deadline path is recorded by the
	// manager's own `command_job_termination_started` event, captured
	// below from the lifecycle stream.
	let terminationRequestedAtMs: number | undefined

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
		terminationRequestedAtMs = Date.now()
		await manager.cancel({ jobId: started.jobId })
	}

	await exitWatch
	await started.terminalPromise

	const production = readProductionPostcondition(events)
	const immediateObservation = observeGroup(pgid ?? -1, rootPid)
	const { observations: laterObservations } = await observeGroupUntilGone(pgid ?? -1, rootPid, opts.observationWindowMs)
	const finalObservation = laterObservations[laterObservations.length - 1] ?? immediateObservation

	// CORRECTION01 (P0-1): the PRODUCTION supervisor's own termination
	// verdict. `command_job_primary_group_probe` is emitted by
	// `runTerminationSequence()` with `probeResult` derived from the
	// supervisor's `TerminateTreeResult.treeTerminated` — it is the
	// production authority on whether the termination actually worked.
	const terminationProbeEvent = events.find((e) => e.event === "command_job_primary_group_probe")
	const supervisorTerminationProbe =
		terminationProbeEvent && terminationProbeEvent.event === "command_job_primary_group_probe"
			? terminationProbeEvent.probeResult
			: undefined
	const supervisorTerminationProbeAtMs =
		terminationProbeEvent && terminationProbeEvent.event === "command_job_primary_group_probe"
			? terminationProbeEvent.tsMs
			: undefined

	// CORRECTION01 (P0-1): the deadline path never goes through the
	// test-side cancel call, so its request time comes from the
	// manager's OWN `command_job_termination_started` event.
	if (opts.termination === "deadline" && terminationRequestedAtMs === undefined) {
		const terminationStarted = events.find((e) => e.event === "command_job_termination_started")
		if (terminationStarted && terminationStarted.event === "command_job_termination_started") {
			terminationRequestedAtMs = terminationStarted.tsMs
		}
	}

	// CORRECTION01 (P0-1): the timestamp at which the group was FIRST
	// observed gone, and the elapsed time from the termination request to
	// that disappearance. This interval is what distinguishes "the
	// supervisor terminated the group" from "the workload ended by
	// itself" — the latter is bounded below by the workload's own
	// lifetime, which is far longer than any termination grace window.
	const goneObservation = laterObservations.find((o) => o.liveness === "gone")
	const groupGoneAtMs = goneObservation?.atMs
	const terminationToGoneMs =
		typeof terminationRequestedAtMs === "number" && typeof groupGoneAtMs === "number"
			? groupGoneAtMs - terminationRequestedAtMs
			: undefined

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
		terminationRequestedAtMs,
		groupGoneAtMs,
		terminationToGoneMs,
		supervisorTerminationProbe,
		supervisorTerminationProbeAtMs,
		signalCapability,
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

/**
 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01-CORRECTION01 (P0-2).
 *
 * ONE OBSERVED REAPING-RACE WITNESS.
 *
 * A witness is a REAL production execution in which:
 *
 *   1. the production supervisor's `exit` promise resolves (the
 *      production completion boundary — the very promise the
 *      `CommandJobManager` consumes),
 *   2. the owned process group is STILL PRESENT at that instant
 *      (the kernel has not yet completed the group teardown),
 *   3. the group has NO surviving live member (so there is nothing to
 *      protect — this is a REAP artifact, not a surviving descendant),
 *   4. and the group then disappears WITHOUT any intervention.
 *
 * WHY THE WITNESS IS TAKEN AT THE SUPERVISOR BOUNDARY
 * ----------------------------------------------------
 *
 * The production `CommandJobManager` attaches its exit transition
 * AFTER several awaits (spawn, helper registration, lifecycle
 * emission), so its own probe lands a few milliseconds LATER than the
 * supervisor's exit boundary. Measured on this host, the group is
 * reaped 3-7ms after the supervisor's exit promise resolves, so the
 * manager's probe usually lands AFTER the teardown and observes
 * `gone`.
 *
 * The mechanism under investigation is precisely the gap between the
 * supervisor's exit boundary and the kernel's group teardown. The
 * witness therefore probes AT that boundary — using the REAL
 * production supervisor (`spawnSupervisableShellCommand`), the REAL
 * production spawn shape, and the REAL production exit promise. No
 * process supervision is simulated and no execution seam is replaced;
 * only the READ-ONLY probe is moved to the boundary it is meant to
 * characterise.
 */
export type ReapingRaceWitnessRecord = {
	readonly jobId: string
	readonly pgid: number | undefined
	readonly rootPid: number | undefined
	readonly supervisorExitResolutionAtMs: number
	/** The production postcondition AT the supervisor exit boundary. */
	readonly boundaryPostcondition: "gone" | "alive" | "eperm" | "unknown"
	readonly boundaryOsErrorCode: string | null
	/** The kernel-truth liveness at the boundary. */
	readonly boundaryLiveness: "alive" | "gone" | "unknown"
	readonly boundaryMemberCount: number
	/** Live (non-zombie) members at the boundary. MUST be 0. */
	readonly liveMemberCountAtBoundary: number
	/** The group disappears on its own afterwards. */
	readonly laterLiveness: "alive" | "gone" | "unknown"
	readonly groupGoneAtMs: number | undefined
	readonly cleanupOutcome: "verified_absent" | "residual_observed" | "unknown"
	readonly observationTimeline: readonly {
		readonly atMs: number
		readonly liveness: string
		readonly osErrorCode: string | null
		readonly memberCount: number
	}[]
}

let witnessCounter = 0

/**
 * Run ONE reaping-race witness trial against the REAL production
 * supervisor and return the observation (which may or may not exhibit
 * the race — the race is probabilistic).
 */
export async function runReapingRaceWitnessTrial(cwd: string): Promise<ReapingRaceWitnessRecord> {
	// The REAL production supervisor. No seam is replaced.
	const supervisor = spawnSupervisableShellCommand({
		executable: "/bin/bash",
		args: ["-lc", "true"],
		cwd,
		input: "",
	} as unknown as Parameters<typeof spawnSupervisableShellCommand>[0])

	const rootPid = supervisor.pid
	const pgid = supervisor.pgid
	witnessCounter += 1
	const jobId = `nepcr01-reaping-witness-${witnessCounter}`

	// Probe at the PRODUCTION exit boundary: the `.then()` continuation
	// is the same microtask turn in which the manager's own transition
	// runs, so this measures the boundary, not some later moment.
	const boundary = await supervisor.exit.then(() => {
		const probe = observeGroup(pgid ?? -1, rootPid)
		return {
			atMs: Date.now(),
			probe,
		}
	})

	// Let the kernel finish the teardown, WITHOUT intervening.
	const { observations } = await observeGroupUntilGone(pgid ?? -1, rootPid, 2_000)
	const finalObservation = observations[observations.length - 1] ?? boundary.probe
	// The FIRST observation that reports `gone`. The boundary probe
	// itself may already report `gone` (the group can be reaped within
	// the same millisecond), so the elapsed window is measured from the
	// boundary timestamp and is legitimately 0 in that case.
	const goneObservation = observations.find((o) => o.liveness === "gone")

	const liveMemberCountAtBoundary = boundary.probe.members.filter((m) => !m.stat.startsWith("Z")).length

	return {
		jobId,
		pgid,
		rootPid,
		supervisorExitResolutionAtMs: boundary.atMs,
		boundaryPostcondition:
			boundary.probe.liveness === "gone" ? "gone" : boundary.probe.liveness === "alive" ? "alive" : "eperm",
		boundaryOsErrorCode: boundary.probe.osErrorCode,
		boundaryLiveness: boundary.probe.liveness,
		boundaryMemberCount: boundary.probe.members.length,
		liveMemberCountAtBoundary,
		laterLiveness: finalObservation.liveness,
		groupGoneAtMs: goneObservation?.atMs,
		cleanupOutcome:
			finalObservation.liveness === "gone"
				? "verified_absent"
				: finalObservation.liveness === "alive"
					? "residual_observed"
					: "unknown",
		observationTimeline: observations.map((o) => ({
			atMs: o.atMs,
			liveness: o.liveness,
			osErrorCode: o.osErrorCode,
			memberCount: o.members.length,
		})),
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
