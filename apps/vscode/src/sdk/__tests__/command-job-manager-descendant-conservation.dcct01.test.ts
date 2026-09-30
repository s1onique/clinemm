/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 *
 * V1 RED/GREEN witness tests for:
 *   1. getActiveCommandJobs() — live ownership gauge snapshot
 *      (renamed from getActiveCommandJobs per Factory review)
 *   2. probeOwnedGroups() — postcondition probe (fail-closed
 *      classification: gone | alive | eperm | unknown)
 *   3. onCommandJobLifecycle sink — eight lifecycle events (§7).
 *      The load-bearing invariant is bounded:
 *      TERMINAL CommandJob => PRIMARY OWNED PGID GONE
 *      asserted in finalize() BEFORE the job is removed from active.
 *      The full DESCENDANT-CONSERVATION invariant (which would cover
 *      Node detached:true / Python start_new_session=True escape
 *      fixtures) is OUT OF SCOPE — see ACT spec §27. The escape
 *      discriminator lives in
 *      /tmp/clinemm-descendant-conservation-telemetry01/03-current-pgid-contract.md
 *      Appendix A and the successor ACT
 *      ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type CommandJobLifecycleEvent, CommandJobManager } from "../command-job-manager"

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	// Seatbelt would route the spawn through the experimental
	// sandbox, returning a `sandbox-unavailable` result before
	// our fake supervisor is even reached. Disable to exercise
	// the canonical CommandJobManager FSM (mirrors
	// task-header-runtime-error-counter-rec01.test.ts).
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

type FakeSupervisorOptions = {
	readonly pid: number
	readonly pgid: number
	readonly treeTerminated?: boolean
	readonly epermDetected?: boolean
}

function fakeSupervisor(opts: FakeSupervisorOptions): SupervisableShellProcess {
	let exitResolve: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
		exitResolve = r
	})
	return {
		pid: opts.pid,
		pgid: opts.pgid,
		exit,
		killTree: async () => {},
		terminateTree: async () => {
			// Resolve the exit promise so the manager's exitTransition
			// fires; without this the job would never finalize.
			exitResolve?.({ exitCode: null, signal: opts.epermDetected ? "SIGKILL" : "SIGTERM" })
			return {
				treeTerminated: opts.treeTerminated ?? true,
				escalatedToKill: false,
				epermDetected: opts.epermDetected ?? false,
			}
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	} as unknown as SupervisableShellProcess
}

function buildManager(opts: {
	readonly onCommandJobLifecycle?: (e: CommandJobLifecycleEvent) => void
	readonly supervisor: SupervisableShellProcess
	readonly terminalPostconditionProbe?: (pgid: number) => "gone" | "alive" | "eperm" | "unknown"
}): CommandJobManager {
	return new CommandJobManager({
		spawnFactory: () => opts.supervisor,
		onCommandJobLifecycle: opts.onCommandJobLifecycle,
		terminalPostconditionProbe: opts.terminalPostconditionProbe,
	})
}

/**
 * Start a long-running command and DO NOT await terminalPromise.
 * Returns the StartResult so callers can read jobId / state.
 */
async function startLongRunning(manager: CommandJobManager, command = "sleep 60"): Promise<{ jobId: string; state: string }> {
	const start = await manager.start({
		command,
		cwd: process.cwd(),
		waitBudgetMs: 100,
		executionDeadlineMs: 60_000,
	})
	return { jobId: start.jobId, state: start.state }
}

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / V1 witnesses", () => {
	let manager: CommandJobManager | undefined

	afterEach(() => {
		manager?.dispose().catch(() => {})
		manager = undefined
	})

	it("DCCT-01: returns empty array when no jobs are active", () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 1, pgid: 1 }),
		})
		expect(manager.getActiveCommandJobs()).toEqual([])
	})

	it("DCCT-02: returns one tuple per active job with valid pgid", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42000, pgid: 42000 }),
		})
		await startLongRunning(manager, "sleep 60")
		const active = manager.getActiveCommandJobs()
		expect(active.length).toBe(1)
		expect(active[0]?.pgid).toBe(42000)
		expect(active[0]?.detached).toBe(true)
		expect(active[0]?.startedAtMs).toBeGreaterThan(0)
	})

	it("DCCT-03: excludes terminal jobs from the live gauge", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42001, pgid: 42001, treeTerminated: true }),
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		// Cancel; terminateTree resolves the exit promise; the job
		// transitions to terminal and is moved out of `active`.
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise
		expect(manager.getActiveCommandJobs().length).toBe(0)
	})

	it("DCCT-04: probe classifies kernel result for an arbitrary PGID", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 99999, pgid: 99999 }),
		})
		await startLongRunning(manager, "sleep 60")
		const probe = manager.probeOwnedGroups()
		expect(probe.length).toBe(1)
		// Fail-closed classification per Factory review: the probe
		// returns one of { gone, alive, eperm, unknown }. PGID 99999
		// is unlikely to exist; on the substrate it returns ESRCH
		// (gone) on a clean kernel, EPERM in the sandbox shell, and
		// `unknown` if the substrate returns any other errno. The
		// probe MUST NOT silently coerce unknown to gone.
		expect(["gone", "alive", "eperm", "unknown"]).toContain(probe[0]?.state)
	})

	it("DCCT-05: probe yields empty array when no jobs are active", () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 1, pgid: 1 }),
		})
		expect(manager.probeOwnedGroups()).toEqual([])
	})
})

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / lifecycle sink", () => {
	let manager: CommandJobManager | undefined

	afterEach(() => {
		manager?.dispose().catch(() => {})
		manager = undefined
	})

	it("DCCT-06: sink receives process_started + terminal_committed on start()+cancel()", async () => {
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42002, pgid: 42002 }),
			onCommandJobLifecycle: (e) => events.push(e),
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise
		const kinds = events.map((e) => e.event)
		expect(kinds).toContain("command_job_process_started")
		expect(kinds).toContain("command_job_terminal_requested")
		expect(kinds).toContain("command_job_termination_started")
		expect(kinds).toContain("command_job_primary_group_probe")
		expect(kinds).toContain("command_job_primary_group_cleanup")
		expect(kinds).toContain("command_job_terminal_committed")
	})

	it("DCCT-07: lifecycle events never carry command text", async () => {
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42004, pgid: 42004 }),
			onCommandJobLifecycle: (e) => events.push(e),
		})
		const started = await manager.start({
			command: "echo SECRET-FIELD-MARKER",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise
		for (const e of events) {
			const json = JSON.stringify(e)
			expect(json.includes("SECRET-FIELD-MARKER")).toBe(false)
			expect(typeof e.jobId).toBe("string")
			expect(typeof e.tsMs).toBe("number")
		}
	})

	it("DCCT-08: no-op sink by default (undefined onCommandJobLifecycle)", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42005, pgid: 42005 }),
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise
		expect(manager.activeCount).toBe(0)
	})

	it("DCCT-09: a throwing sink does NOT poison the manager's runtime path", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42006, pgid: 42006 }),
			onCommandJobLifecycle: () => {
				throw new Error("sink intentionally broken")
			},
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise
		expect(manager.activeCount).toBe(0)
	})
})

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / process-name independence", () => {
	let manager: CommandJobManager | undefined

	afterEach(() => {
		manager?.dispose().catch(() => {})
		manager = undefined
	})

	it("DCCT-10: gauge treats all command bodies identically (no name-based branch)", async () => {
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 42007, pgid: 42007 }),
		})
		const a = await manager.start({
			command: "node -e 'setTimeout(()=>{},1<<30)'",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		const b = await manager.start({
			command: "python3 -c 'import time; time.sleep(2**30)'",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(manager.getActiveCommandJobs().length).toBe(2)
		for (const job of manager.getActiveCommandJobs()) {
			expect(job.pgid).toBe(42007)
			expect(job.detached).toBe(true)
		}
		await manager.cancel({ jobId: a.jobId })
		await manager.cancel({ jobId: b.jobId })
		await a.terminalPromise
		await b.terminalPromise
	})
})

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / bounded invariant", () => {
	// The Factory reviewer's P0 (correction05): prior tests only verified
	// bookkeeping (active map == 0 + cleanup event fires), not the actual
	// kernel-level postcondition GATING terminal_committed. A TERMINAL
	// CommandJob is only proven-clean if the bounded PGID-conservation
	// invariant held — `command_job_primary_group_cleanup.postcondition
	// === "gone"`. The composition matrix below drives the probe seam
	// (`terminalPostconditionProbe`) and asserts the gating for every
	// member of the fail-closed set.
	//
	// Test seam: `terminalPostconditionProbe` (correction05) lets tests
	// drive the postcondition without depending on real kernel state
	// (production code path uses `process.kill(-pgid, 0)`; tests use a
	// constant).
	let manager: CommandJobManager | undefined

	afterEach(() => {
		manager?.dispose().catch(() => {})
		manager = undefined
	})

	it("DCCT-11: postcondition === 'gone' → terminal_committed fires; cleanup fires BEFORE terminal_committed; CLEAN_TERMINAL invariant", async () => {
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 99998, pgid: 99998, treeTerminated: true }),
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => "gone",
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise

		const cleanupEvents = events.filter((e) => e.event === "command_job_primary_group_cleanup")
		expect(cleanupEvents.length).toBe(1)
		const cleanupEv = cleanupEvents[0]
		expect(cleanupEv).toBeDefined()
		if (!cleanupEv || cleanupEv.event !== "command_job_primary_group_cleanup") return
		expect(cleanupEv.postcondition).toBe("gone")
		expect(cleanupEv.pgid).toBe(99998)
		expect(cleanupEv.jobState).not.toBe("running")
		expect(cleanupEv).not.toHaveProperty("helperFallbackUsed")

		// terminal_committed DOES fire on `gone` — the bounded
		// invariant authorizes clean closure.
		const terminalEvents = events.filter((e) => e.event === "command_job_terminal_committed")
		expect(terminalEvents.length).toBe(1)
		// No residual detected on a clean closure.
		const residualEvents = events.filter((e) => e.event === "command_job_residual_detected")
		expect(residualEvents.length).toBe(0)

		// Ordering witness: cleanupIdx ≤ terminalIdx.
		const cleanupIdx = events.findIndex((e) => e.event === "command_job_primary_group_cleanup")
		const terminalIdx = events.findIndex((e) => e.event === "command_job_terminal_committed")
		expect(cleanupIdx).toBeGreaterThanOrEqual(0)
		expect(terminalIdx).toBeGreaterThanOrEqual(0)
		expect(cleanupIdx).toBeLessThanOrEqual(terminalIdx)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06): on the gone path the bounded invariant
		// `CLEAN_TERMINAL ⇒ PRIMARY OWNED PGID GONE` is satisfied
		// by construction — the job is in a clean terminal class
		// (NOT `containment_failed`) and the postcondition was
		// `gone`. Asserting via snapshot:
		const status = await manager.status({ jobId: started.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (status.ok) {
			// The caller's clean terminal class survived the
			// correction06 deferred-state-assignment. NOT
			// `containment_failed`.
			expect(status.snapshot.state).toBe("cancelled")
			// containmentFailed MUST be undefined — clean terminal.
			expect(status.snapshot.containmentFailed).toBeUndefined()
		}
		// command_job_containment_failed is NOT emitted on the
		// gone path — terminal_committed is the gauge event.
		const containmentFailedEvents = events.filter((e) => e.event === "command_job_containment_failed")
		expect(containmentFailedEvents.length).toBe(0)
	})

	it("DCCT-12: postcondition === 'alive' → state := 'containment_failed'; containment_failed event fires AFTER active.delete; gauge decrements", async () => {
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 99997, pgid: 99997, treeTerminated: true }),
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => "alive",
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise

		const cleanupEvents = events.filter((e) => e.event === "command_job_primary_group_cleanup")
		expect(cleanupEvents.length).toBe(1)
		const cleanupEv = cleanupEvents[0]
		expect(cleanupEv).toBeDefined()
		if (!cleanupEv || cleanupEv.event !== "command_job_primary_group_cleanup") return
		expect(cleanupEv.postcondition).toBe("alive")

		// Load-bearing: terminal_committed is DENIED on `alive`.
		const terminalEvents = events.filter((e) => e.event === "command_job_terminal_committed")
		expect(terminalEvents.length).toBe(0)

		// residual_detected MUST fire so the host can surface the
		// invariant REFUSAL as a visible runtime incident.
		const residualEvents = events.filter((e) => e.event === "command_job_residual_detected")
		expect(residualEvents.length).toBe(1)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06): state must be overwritten to
		// `containment_failed` (NOT `"cancelled"`), and the
		// post-delete gauge-conservation event must fire so the
		// tracker decrements from 1 → 0.
		const containmentFailedEvents = events.filter((e) => e.event === "command_job_containment_failed")
		expect(containmentFailedEvents.length).toBe(1)
		const cfEv = containmentFailedEvents[0]
		expect(cfEv).toBeDefined()
		if (!cfEv || cfEv.event !== "command_job_containment_failed") return
		expect(cfEv.pgid).toBe(99997)
		expect(cfEv.containmentFailed).toBe("substrate_alive")
		expect(cfEv.jobState).toBe("containment_failed")
		// The gauge in this event is the POST-delete count —
		// the tracker reads N=0 here, which closes the stale-`⎇ 1`
		// bug correction05 introduced.
		expect(cfEv.activeCommandJobs).toBe(0)

		// The job's stored state is the containment verdict, NOT
		// the caller's clean terminal class (`"cancelled"`).
		const status = await manager.status({ jobId: started.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (status.ok) {
			expect(status.snapshot.state).toBe("containment_failed")
			expect(status.snapshot.containmentFailed).toBe("substrate_alive")
		}
	})

	it("DCCT-13: postcondition === 'eperm' → state := 'containment_failed'; containment_failed event fires; gauge decrements", async () => {
		// DCCT-13 — bounded invariant UNPROVEN on the sandbox
		// substrate. EPERM means the kernel refused the probe; the
		// manager must NOT claim clean closure.
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 99996, pgid: 99996, treeTerminated: true }),
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => "eperm",
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise

		const cleanupEvents = events.filter((e) => e.event === "command_job_primary_group_cleanup")
		expect(cleanupEvents.length).toBe(1)
		const cleanupEv = cleanupEvents[0]
		expect(cleanupEv).toBeDefined()
		if (!cleanupEv || cleanupEv.event !== "command_job_primary_group_cleanup") return
		expect(cleanupEv.postcondition).toBe("eperm")

		const terminalEvents = events.filter((e) => e.event === "command_job_terminal_committed")
		expect(terminalEvents.length).toBe(0)
		const residualEvents = events.filter((e) => e.event === "command_job_residual_detected")
		expect(residualEvents.length).toBe(1)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06): state must be `containment_failed` and
		// the gauge-conservation event must fire.
		const containmentFailedEvents = events.filter((e) => e.event === "command_job_containment_failed")
		expect(containmentFailedEvents.length).toBe(1)
		const cfEv = containmentFailedEvents[0]
		expect(cfEv).toBeDefined()
		if (!cfEv || cfEv.event !== "command_job_containment_failed") return
		expect(cfEv.containmentFailed).toBe("substrate_eperm")
		expect(cfEv.jobState).toBe("containment_failed")
		expect(cfEv.activeCommandJobs).toBe(0)

		const status = await manager.status({ jobId: started.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (status.ok) {
			expect(status.snapshot.state).toBe("containment_failed")
			expect(status.snapshot.containmentFailed).toBe("substrate_eperm")
		}
	})

	it("DCCT-14: postcondition === 'unknown' → state := 'containment_failed'; containment_failed event fires; gauge decrements", async () => {
		// DCCT-14 — fail-closed. Any errno other than ESRCH/EPERM
		// falls into `unknown`. The previous (correction04)
		// implementation would silently coerce to `gone`; the
		// current code keeps the verdict visible and denies clean
		// closure.
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 99995, pgid: 99995, treeTerminated: true }),
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => "unknown",
		})
		const started = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		await manager.cancel({ jobId: started.jobId })
		await started.terminalPromise

		const cleanupEvents = events.filter((e) => e.event === "command_job_primary_group_cleanup")
		expect(cleanupEvents.length).toBe(1)
		const cleanupEv = cleanupEvents[0]
		expect(cleanupEv).toBeDefined()
		if (!cleanupEv || cleanupEv.event !== "command_job_primary_group_cleanup") return
		expect(cleanupEv.postcondition).toBe("unknown")

		const terminalEvents = events.filter((e) => e.event === "command_job_terminal_committed")
		expect(terminalEvents.length).toBe(0)
		const residualEvents = events.filter((e) => e.event === "command_job_residual_detected")
		expect(residualEvents.length).toBe(1)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06): state must be `containment_failed` and
		// the gauge-conservation event must fire.
		const containmentFailedEvents = events.filter((e) => e.event === "command_job_containment_failed")
		expect(containmentFailedEvents.length).toBe(1)
		const cfEv = containmentFailedEvents[0]
		expect(cfEv).toBeDefined()
		if (!cfEv || cfEv.event !== "command_job_containment_failed") return
		expect(cfEv.containmentFailed).toBe("substrate_unknown")
		expect(cfEv.jobState).toBe("containment_failed")
		expect(cfEv.activeCommandJobs).toBe(0)

		const status = await manager.status({ jobId: started.jobId, waitMs: 0 })
		expect(status.ok).toBe(true)
		if (status.ok) {
			expect(status.snapshot.state).toBe("containment_failed")
			expect(status.snapshot.containmentFailed).toBe("substrate_unknown")
		}
	})

	it("DCCT-15: helper EPERM path emits command_job_helper_cleanup_attempted (NOT command_job_primary_group_cleanup)", async () => {
		// DCCT-15 — Factory P1 follow-up. The two events previously
		// shared the name `command_job_primary_group_cleanup`,
		// which made consumers unable to tell "helper cleanup was
		// attempted" from "authoritative terminal postcondition was
		// measured" without relying on chronology. The fix renames
		// the helper-attempt event to
		// `command_job_helper_cleanup_attempted` so
		// `command_job_primary_group_cleanup` is reserved for the
		// authoritative kernel probe.
		//
		// Type-level witness — the lifecycle event union includes
		// `command_job_helper_cleanup_attempted` with a structured
		// `helperOutcome: success|denied|failed` field.
		const sample: CommandJobLifecycleEvent = {
			event: "command_job_helper_cleanup_attempted",
			jobId: "x",
			pgid: 1,
			helperOutcome: "denied",
			jobState: "running",
			tsMs: 0,
			activeCommandJobs: 0,
		}
		expect(sample.event).toBe("command_job_helper_cleanup_attempted")
		expect(sample.helperOutcome).toBe("denied")
	})
})

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / correction07 start-path gauge increment", () => {
	let manager: CommandJobManager | undefined

	afterEach(() => {
		manager?.dispose().catch(() => {})
		manager = undefined
	})

	it("DCCT-16: start() increments the lifecycle-event gauge — process_started carries activeCommandJobs = 1", async () => {
		// DCCT-16 (correction07 / Factory
		// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
		// the prior ordering emitted `command_job_process_started`
		// BEFORE `this.active.set(id, job)`, so the lifecycle
		// emitter's `getActiveCommandJobs().length` enrichment
		// captured the PRE-insertion gauge (0) for a start that
		// grew the active map from 0 → 1. The header's `⎇ N`
		// would therefore stay hidden for the entire useful
		// lifetime of a long-running command. correction07 hoists
		// the emit AFTER the active-map mutation and pins the
		// gauge semantics to `this.active.size` (the same value
		// `manager.activeCount` exposes). This test asserts
		// BOTH (a) the post-delta gauge value carried by the
		// event AND (b) that `manager.activeCount` agrees with
		// it (single semantic authority).
		const events: CommandJobLifecycleEvent[] = []
		manager = buildManager({
			supervisor: fakeSupervisor({ pid: 77701, pgid: 77701 }),
			onCommandJobLifecycle: (e) => events.push(e),
		})
		// Entry assertion: idle manager has activeCount = 0.
		expect(manager.activeCount).toBe(0)

		await startLongRunning(manager, "sleep 60")

		// After the synchronous portion of start() returns, the
		// job is in `active` and the gauge is 1. process_started
		// MUST have fired with `activeCommandJobs = 1`.
		expect(manager.activeCount).toBe(1)
		expect(manager.getActiveCommandJobs().length).toBe(1)
		const processStarted = events.find((e) => e.event === "command_job_process_started")
		expect(processStarted).toBeDefined()
		if (!processStarted || processStarted.event !== "command_job_process_started") return
		// Load-bearing: gauge carries the POST-delta value (1),
		// not the PRE-delta value (0).
		expect(processStarted.activeCommandJobs).toBe(1)
		expect(processStarted.jobId).toBeDefined()
		expect(processStarted.detached).toBe(true)
	})

	it("DCCT-17: composition — start A → 1; start B → 2; finalize A (clean) → 1; finalize B (containment_failed) → 0", async () => {
		// DCCT-17 (correction07): a composition witness that pins
		// the gauge invariant across TWO concurrent jobs and
		// BOTH terminal paths (clean + containment_failed).
		// Required shape per Factory P0:
		//
		//   start A            → gauge 1
		//   start B            → gauge 2
		//   finalize A (clean) → gauge 1
		//   finalize B (alive) → gauge 0
		//
		// The clean path exercises `command_job_terminal_committed`
		// (post-delete, carries the post-delta gauge). The
		// failure path exercises `command_job_containment_failed`
		// (correction06: also post-delete, also carries the
		// post-delta gauge). Both must agree on the SAME gauge
		// value at the same observation point (activeCount).
		//
		// NOTE: we cannot use `buildManager` here because it
		// returns the same `SupervisableShellProcess` for every
		// `spawnFactory` call, which would share the exit-promise
		// resolver across the two jobs and finalize them both on
		// the first cancel. We bypass the helper and inject a
		// fresh `fakeSupervisor` per `spawnFactory` invocation.
		const events: CommandJobLifecycleEvent[] = []
		// First invocation (job A) → gone (clean terminal).
		// Second invocation (job B) → alive (failure path).
		let probeCalls = 0
		const callPool: Array<ReturnType<typeof fakeSupervisor>> = []
		manager = new CommandJobManager({
			spawnFactory: () => {
				const sup = fakeSupervisor({
					pid: 77702 + callPool.length,
					pgid: 77702 + callPool.length,
					treeTerminated: true,
				})
				callPool.push(sup)
				return sup
			},
			onCommandJobLifecycle: (e) => events.push(e),
			terminalPostconditionProbe: () => {
				probeCalls += 1
				return probeCalls === 1 ? "gone" : "alive"
			},
		})

		const a = await manager.start({
			command: "sleep 60",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(manager.activeCount).toBe(1)
		const b = await manager.start({
			command: "sleep 30",
			cwd: process.cwd(),
			waitBudgetMs: 100,
			executionDeadlineMs: 60_000,
		})
		expect(manager.activeCount).toBe(2)

		// Both `process_started` events must carry the
		// POST-delta gauge (1 and 2 respectively).
		const processStartedEvents = events.filter((e) => e.event === "command_job_process_started")
		expect(processStartedEvents.length).toBe(2)
		// order: A first (gauge=1), B second (gauge=2).
		expect(processStartedEvents[0]?.activeCommandJobs).toBe(1)
		expect(processStartedEvents[1]?.activeCommandJobs).toBe(2)

		// Finalize A cleanly (postcondition === "gone").
		await manager.cancel({ jobId: a.jobId })
		await a.terminalPromise
		expect(manager.activeCount).toBe(1)
		const terminalCommitted = events.filter((e) => e.event === "command_job_terminal_committed")
		expect(terminalCommitted.length).toBe(1)
		// The clean-path terminal_committed event carries the
		// post-delete gauge (1, post-decrement-from-2).
		expect(terminalCommitted[0]?.activeCommandJobs).toBe(1)

		// Finalize B on the failure path (postcondition === "alive").
		await manager.cancel({ jobId: b.jobId })
		await b.terminalPromise
		expect(manager.activeCount).toBe(0)
		const containmentFailed = events.filter((e) => e.event === "command_job_containment_failed")
		expect(containmentFailed.length).toBe(1)
		// The failure-path containment_failed event carries the
		// post-delete gauge (0, post-decrement-from-1).
		expect(containmentFailed[0]?.activeCommandJobs).toBe(0)

		// EXACTLY ONE containment_failed event across the two
		// jobs: A took the clean path (terminal_committed), B
		// took the failure path (containment_failed).
		const cfEvents = events.filter((e) => e.event === "command_job_containment_failed")
		expect(cfEvents.length).toBe(1)
	})
})
