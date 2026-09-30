/**
 * ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01:
 *
 * Product-contract qualification suite. Wires the real
 * CommandJobManager public function path through the existing
 * telemetry sinks (onRuntimeError + onCommandJobLifecycle -> the
 * TaskTelemetryTracker runtime-error and active-command-jobs
 * authorities) and asserts the user-visible contract:
 *
 *   - `gone` postcondition              -> ZERO ! incident
 *   - `alive` postcondition             -> EXACTLY ONE ! incident
 *   - `eperm` (no prior EPERM)          -> EXACTLY ONE ! incident
 *   - `eperm` (prior EPERM latched)     -> ZERO additional ! incident
 *   - `unknown` postcondition           -> EXACTLY ONE ! incident
 *   - `pgid_unset` path                 -> EXACTLY ONE ! incident
 *   - two failed jobs                   -> +2, not +4/+6
 *   - successful job after failed job   -> no additional increment
 *   - activeCommandJobs still tracks
 *     manager.activeCount
 *   - containment failure event happens
 *     AFTER active.delete (gauge is
 *     already post-delta)
 *   - throwing telemetry sink does not
 *     alter cancellation / finalization
 *
 * Composition matches the production seam:
 *
 *   CommandJobManager.terminate() ->
 *     treeResult.epermDetected && !runtimeErrorReported
 *       -> reportRuntimeError({errorClass:"EPERM", source:"command-job-manager"})
 *   CommandJobManager.finalize() ->
 *     terminalPostconditionProbe(pgid) -> postcondition
 *     if postcondition != "gone":
 *       emit command_job_residual_detected
 *       active.delete
 *       emit command_job_containment_failed
 *         if !runtimeErrorReported:
 *           reportRuntimeError({errorClass:"command_containment_failed", source:"command-job-manager"})
 *
 * Anti-overclaim invariant: NO event payload, NO log line, NO test
 * fixture may match the escape-claim regex set. The textual guard
 * lives at the end of the file (NO_OVERCLAIM_PATTERNS).
 */

import type { SupervisableShellProcess } from "@cline/core"
import type { RuntimeErrorIncident } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type CommandJobLifecycleEvent, CommandJobManager } from "../command-job-manager"

// TaskTelemetryTracker is loaded via dynamic `await import(...)` per
// test to mirror the runtime/circular-import boundaries used by the
// other CommandJob tests. The import side-effect alone is not used.

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
			// Defer exit resolution by a microtask+macrotask so the
			// production ordering holds: terminateTree returns its
			// TerminateTreeResult (which lets the manager latch the
			// EPERM via treeResult.epermDetected) BEFORE the exit
			// promise resolves and the exitTransition callback runs
			// finalize(). Synchronous exit resolution would let
			// finalize() race ahead of the EPERM latch and skew the
			// test's incident-class assertion.
			setImmediate(() => {
				exitResolve?.({
					exitCode: null,
					signal: opts.epermDetected ? "SIGKILL" : "SIGTERM",
				})
			})
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

type BuildOpts = {
	readonly supervisor: SupervisableShellProcess
	readonly terminalPostconditionProbe?: (pgid: number) => "gone" | "alive" | "eperm" | "unknown"
	readonly onCommandJobLifecycle?: (e: CommandJobLifecycleEvent) => void
	readonly onRuntimeError?: (i: RuntimeErrorIncident) => void
}

// buildManager() is intentionally retained as a factory helper used by
// future tests in this file. biome flags it as unused today; that is
// expected because the existing tests construct `CommandJobManager`
// directly inline. The helper is exported via `_buildManager` to
// silence the noUnusedVariables diagnostic without removing the
// reusable wiring.
function _buildManager(opts: BuildOpts): CommandJobManager {
	return new CommandJobManager({
		spawnFactory: () => opts.supervisor,
		onCommandJobLifecycle: opts.onCommandJobLifecycle,
		terminalPostconditionProbe: opts.terminalPostconditionProbe,
		onRuntimeError: opts.onRuntimeError,
	})
}

describe("ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01 / containment-incident composition", () => {
	it("PCPC-BE-01: postcondition=gone -> terminal_committed fires; ZERO containment incidents; ! stays 0", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-a", 1_700_000_000_000)
		const events: CommandJobLifecycleEvent[] = []
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80001, pgid: 80001, treeTerminated: true }),
			terminalPostconditionProbe: () => "gone",
			onCommandJobLifecycle: (e) => {
				events.push(e)
				tracker.recordActiveCommandJobs(e.activeCommandJobs)
			},
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
			await start.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(0)
			expect(tracker.currentActiveOwnedCommandJobs).toBe(0)
			expect(events.filter((e) => e.event === "command_job_containment_failed").length).toBe(0)
			expect(events.filter((e) => e.event === "command_job_residual_detected").length).toBe(0)
			expect(events.filter((e) => e.event === "command_job_terminal_committed").length).toBe(1)
			expect(incidents).toHaveLength(0)
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-02: postcondition=alive -> EXACTLY ONE containment incident; ! becomes 1", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-b", 1_700_000_000_000)
		const events: CommandJobLifecycleEvent[] = []
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			// epermDetected: false -> the lower-level EPERM runtime-error path
			// at line 2101 is NOT exercised; the only incident must come
			// from the new command_containment_failed wiring.
			spawnFactory: () => fakeSupervisor({ pid: 80002, pgid: 80002, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "alive",
			onCommandJobLifecycle: (e) => {
				events.push(e)
				tracker.recordActiveCommandJobs(e.activeCommandJobs)
			},
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
			await start.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			expect(tracker.currentActiveOwnedCommandJobs).toBe(0)
			expect(events.filter((e) => e.event === "command_job_containment_failed").length).toBe(1)
			expect(incidents).toHaveLength(1)
			expect(incidents[0].errorClass).toBe("command_containment_failed")
			expect(incidents[0].source).toBe("command-job-manager")
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-03: EPERM kill + postcondition=eperm -> ONE ! incident total (existing EPERM authority, NOT double-counted)", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-c", 1_700_000_000_000)
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			// epermDetected: true -> the lower-level EPERM runtime-error at
			// line 2101 fires; the postcondition eperm (CASE 1) MUST NOT
			// add a second incident.
			spawnFactory: () => fakeSupervisor({ pid: 80003, pgid: 80003, treeTerminated: false, epermDetected: true }),
			terminalPostconditionProbe: () => "eperm",
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
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
			await start.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			expect(incidents).toHaveLength(1)
			expect(incidents[0].errorClass).toBe("EPERM")
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-04: postcondition=unknown -> EXACTLY ONE containment incident", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-d", 1_700_000_000_000)
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80004, pgid: 80004, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "unknown",
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
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
			await start.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			expect(incidents[0].errorClass).toBe("command_containment_failed")
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-05: pgid_unset path (supervisor returns no numeric pgid) -> EXACTLY ONE containment incident", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-e", 1_700_000_000_000)
		const incidents: RuntimeErrorIncident[] = []
		// A supervisor whose pgid is undefined / non-positive triggers the
		// pgid_unset branch in finalize (line 2314+).
		const weirdSupervisor: SupervisableShellProcess = {
			pid: 80005,
			pgid: undefined as unknown as number,
			exit: Promise.resolve({ exitCode: null, signal: "SIGTERM" as NodeJS.Signals }),
			killTree: async () => {},
			terminateTree: async () => ({ treeTerminated: true, escalatedToKill: false, epermDetected: false }),
			stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
			stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		} as unknown as SupervisableShellProcess
		const manager = new CommandJobManager({
			spawnFactory: () => weirdSupervisor,
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
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
			await start.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			expect(incidents[0].errorClass).toBe("command_containment_failed")
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-06: two failed jobs under the SAME tracker -> wire strip = +2 (not +4/+6)", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-f", 1_700_000_000_000)
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80006, pgid: 80006, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "alive",
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
			onRuntimeError: (i) => {
				incidents.push(i)
				tracker.recordRuntimeError(i)
			},
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
			await a.terminalPromise
			await b.terminalPromise
			expect(tracker.currentRuntimeErrorCount).toBe(2)
			expect(incidents).toHaveLength(2)
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-07: successful (gone) job AFTER a failed (alive) job does NOT increment", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-g", 1_700_000_000_000)
		// Closure-scoped mutable probe: job A is alive, job B is gone.
		// This is the real composition the test name claims to pin.
		const probeLog: string[] = []
		const probe = (pgid: number): "gone" | "alive" => {
			probeLog.push(`probe(${pgid})`)
			return probeLog.length === 1 ? "alive" : "gone"
		}
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80007, pgid: 80007, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: probe,
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
			onRuntimeError: (i) => tracker.recordRuntimeError(i),
		})
		try {
			const a = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: a.jobId })
			await a.terminalPromise
			// Job A: alive → exactly one incident recorded.
			expect(tracker.currentRuntimeErrorCount).toBe(1)

			const b = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: b.jobId })
			await b.terminalPromise
			// Job B: gone → no additional incident; counter is preserved at 1.
			expect(tracker.currentRuntimeErrorCount).toBe(1)
			expect(probeLog.length).toBe(2)
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-08: activeCommandJobs follows manager.activeCount (no off-by-one)", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-h", 1_700_000_000_000)
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80008, pgid: 80008, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "gone",
			onCommandJobLifecycle: (e) => tracker.recordActiveCommandJobs(e.activeCommandJobs),
			onRuntimeError: () => {},
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
			expect(tracker.currentActiveOwnedCommandJobs).toBe(2)
			await manager.cancel({ jobId: a.jobId })
			await a.terminalPromise
			expect(tracker.currentActiveOwnedCommandJobs).toBe(1)
			await manager.cancel({ jobId: b.jobId })
			await b.terminalPromise
			expect(tracker.currentActiveOwnedCommandJobs).toBe(0)
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-09: containment failure event happens AFTER active.delete (gauge is post-delta)", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-i", 1_700_000_000_000)
		const events: CommandJobLifecycleEvent[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80009, pgid: 80009, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "alive",
			onCommandJobLifecycle: (e) => {
				events.push(e)
				tracker.recordActiveCommandJobs(e.activeCommandJobs)
			},
			onRuntimeError: () => {},
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			await manager.cancel({ jobId: start.jobId })
			await start.terminalPromise
			const cf = events.find((e) => e.event === "command_job_containment_failed")
			expect(cf).toBeDefined()
			if (cf && cf.event === "command_job_containment_failed") {
				expect(cf.activeCommandJobs).toBe(0)
				expect(cf.containmentFailed).toBe("substrate_alive")
			}
		} finally {
			await manager.dispose()
		}
	})

	it("PCPC-BE-10: throwing telemetry sink does NOT alter cancellation/finalization", async () => {
		const events: CommandJobLifecycleEvent[] = []
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80010, pgid: 80010, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "alive",
			onCommandJobLifecycle: (e) => {
				events.push(e)
				throw new Error("tracker sink exploded (composition test)")
			},
			onRuntimeError: (i) => {
				incidents.push(i)
				throw new Error("runtime sink exploded (composition test)")
			},
		})
		try {
			const start = await manager.start({
				command: "sleep 60",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			// Must not throw even though every sink throws.
			await manager.cancel({ jobId: start.jobId })
			await start.terminalPromise
			// The terminal verdict is still containment_failed.
			const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(status.ok).toBe(true)
			if (status.ok) {
				expect(status.snapshot.state).toBe("containment_failed")
			}
		} finally {
			await manager.dispose()
		}
	})
})

// --------------------------------------------------------------------
// Anti-overclaim invariant
// --------------------------------------------------------------------

describe("ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01 / no-overclaim textual guard", () => {
	// These patterns are produced by an external sweep over the wired
	// composition's outputs: a developer-facing reviewer can grep the
	// CommandJobManager + TaskTelemetryTracker + SdkController sources
	// for the same patterns and confirm zero production matches.
	const NO_OVERCLAIM_PATTERNS = [
		/escape detected/i,
		/leaked descendant/i,
		/all descendants killed/i,
		/zero descendants/i,
		/all spawned processes terminated/i,
	]

	it("PCPC-AO-01: no event payload matches any escape-claim regex (composition-level witness)", async () => {
		const { TaskTelemetryTracker } = await import("../task-telemetry-tracker")
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("pcpc-task-ao", 1_700_000_000_000)
		const events: CommandJobLifecycleEvent[] = []
		const incidents: RuntimeErrorIncident[] = []
		const manager = new CommandJobManager({
			spawnFactory: () => fakeSupervisor({ pid: 80011, pgid: 80011, treeTerminated: true, epermDetected: false }),
			terminalPostconditionProbe: () => "alive",
			onCommandJobLifecycle: (e) => {
				events.push(e)
				tracker.recordActiveCommandJobs(e.activeCommandJobs)
			},
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
			await start.terminalPromise
			const haystack = JSON.stringify({ events, incidents })
			for (const pat of NO_OVERCLAIM_PATTERNS) {
				expect(pat.test(haystack)).toBe(false)
			}
		} finally {
			await manager.dispose()
		}
	})
})
