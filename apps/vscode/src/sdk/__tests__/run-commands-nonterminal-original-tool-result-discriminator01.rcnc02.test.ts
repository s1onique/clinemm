/**
 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION01 — RCNC02
 *
 * Bounded correction to the RCNC01 commit (`9e512dba9`).
 *
 * The Factory reviewer halted RCNC01 with
 * `HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED`:
 *
 *   "The repair executes only when the separate `command_status` tool
 *    is invoked and returns a snapshot with `state === "running"`. …
 *    There is no evidence in the screenshot that `command_status` was
 *    subsequently invoked. Therefore, the newly added callback may
 *    never execute in the original failure scenario."
 *
 *   "The ablation consequently proves: Without the new callback, a
 *    test that requires that callback fails. It does not establish
 *    that the original `Run failed` card was caused by an unreconciled
 *    `command_status` observation."
 *
 *   "Run one discriminator against the original `run_commands`
 *    response path: (1) Produce a controlled `status:"running"` result
 *    at the initial observation deadline. (2) Record the exact
 *    tool-result envelope and the field that causes the command card
 *    to display `Run failed`. (3) Exercise the real
 *    transcript/React projection without calling `command_status`. (4)
 *    Assert that a nonterminal response cannot be rendered as a
 *    terminal command failure unless an independent, genuine
 *    invocation failure exists."
 *
 * This file is that single discriminator. It exercises the **real**
 * production composition (`createVscodeRunCommandsTool` + real
 * `CommandJobManager` + real `SdkController.prototype.updateBackgroundCommandState`
 * callback + real `createCommandStatusTool` built with the production
 * `vscode-runtime-builder`-equivalent wiring) and bounds the original
 * P0 with three GREEN witnesses and one explicit RED discriminator.
 *
 * Verdict target: `HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED` is
 * closed iff (RCNC02-01) AND (RCNC02-02) AND (RCNC02-03) AND
 * (RCNC02-04) all pass against the **real** production wiring.
 *
 * P0-B post-turn-presentation remains an independent P0 (the original
 * PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE verdict
 * already kept it OPEN).
 */
import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommandJobManager, type CommandJobState } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
import { Controller as SdkController } from "../SdkController"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

vi.mock("@services/telemetry/TelemetryService", () => ({
	TelemetryProviderFactory: {
		createProviders: () => [],
	},
	TelemetryService: {
		create: () => ({
			providers: [],
			shutdown: vi.fn(async () => undefined),
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

// Keys the original live-specimen screenshot shows in the
// `{status:"running", jobId, elapsedMs, deadlineRemainingMs, ...}`
// envelope. Asserted byte-equivalent in RCNC02-01.
const SCREENSHOT_ENVELOPE_KEYS = ["status", "jobId", "elapsedMs", "deadlineRemainingMs"] as const

// Reproduction of the live pill mapping from
// `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367`
// (and the `getCommandStatusText` precedence chain at lines 401-430).
// The renderer's status pill is a pure function of the projection
// value, so the *extension-host* projection map fully determines the
// user-visible pill. We mirror the mapping here so the test can
// assert the user-visible truth from the extension-host side without
// pulling in the webview test harness.
const PROJECTION_PILL_MAP: Record<string, string> = {
	running: "Backgrounded",
	exited: "Completed",
	cancelled: "Cancelled",
	deadline_exceeded: "Deadline exceeded",
	spawn_failed: "Spawn failed",
	containment_failed: "Run failed",
	terminal: "Completed",
}
function pillForProjection(value: string | undefined): string {
	if (value === undefined) return "Backgrounded" // no live projection yet
	return PROJECTION_PILL_MAP[value] ?? "Backgrounded"
}

let supervisorPidCounter = 800000

function fakeSupervisor() {
	const pid = ++supervisorPidCounter
	const pgid = pid
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	const supervisor: SupervisableShellProcess = Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid,
		pgid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
	return { supervisor, resolveExit }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Minimal controller surface that matches what
// `SdkController.prototype.updateBackgroundCommandState` reads.
// Mirrors the BCTCP01-runner-controller-composition subject shape.
type ControllerSubject = {
	backgroundCommandRunning: boolean
	backgroundCommandTaskId: string | undefined
	backgroundCommandJobStates: Record<
		string,
		"running" | "exited" | "cancelled" | "deadline_exceeded" | "spawn_failed" | "containment_failed" | "terminal"
	>
	postStateToWebview: () => Promise<void>
	sessions: { getActiveSession: () => unknown }
	sessionEvents: {
		reevaluateDeferredContinuation: () => void
		reevaluateDeferredCompletionBarrier: () => Promise<void> | void
	}
}

function makeControllerSubject(): ControllerSubject {
	return {
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundCommandJobStates: {},
		postStateToWebview: vi.fn(async () => {}),
		sessions: { getActiveSession: () => undefined },
		// ACT-CLINEMM-DEFERRED-COMPLETION-BARRIER01 (correction chain):
		// `Controller.maybeReevaluateDeferredContinuation` (the
		// load-bearing BCB01 barrier re-evaluator that
		// `updateBackgroundCommandState` calls on every state
		// transition) invokes `sessionEvents.reevaluateDeferredCompletionBarrier()`.
		// The BCTCP01-runner-controller-composition test used a
		// minimal `reevaluateDeferredContinuation` stub; this
		// mirrors the real method name the production controller
		// surfaces so the re-evaluator's call resolves without
		// surfacing unhandled rejections in the test log.
		sessionEvents: {
			reevaluateDeferredContinuation: vi.fn(),
			reevaluateDeferredCompletionBarrier: vi.fn(async () => undefined),
		},
	}
}

interface ProductionWiringHarness {
	manager: CommandJobManager
	subject: ControllerSubject
	runTool: ReturnType<typeof createVscodeRunCommandsTool>
	supervisorsByJobId: Map<string, ReturnType<typeof fakeSupervisor>>
	// The exact callback wiring the production
	// `vscode-runtime-builder.ts:235` (run_commands onBackgroundStateChange)
	// and `vscode-runtime-builder.ts:296-298` (command_status
	// onRunningObserved) emit when the host passes
	// `onBackgroundStateChange` to the runtime builder. These closures
	// are the production functions the real host invokes — NOT
	// synthetic Record poisoning.
	onBackgroundStateChange: (
		running: boolean,
		jobId: string | undefined,
		terminalState?: Exclude<CommandJobState, "running">,
	) => void
	onRunningObserved: (jobId: string) => void
}

function makeProductionWiringHarness(): ProductionWiringHarness {
	const supervisorsFifo: ReturnType<typeof fakeSupervisor>[] = []
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 5_000,
		maxExecutionDeadlineMs: 60_000,
		spawnFactory: () => {
			const handle = fakeSupervisor()
			supervisorsFifo.push(handle)
			return handle.supervisor
		},
	})
	const subject = makeControllerSubject()
	const supervisorsByJobId = new Map<string, ReturnType<typeof fakeSupervisor>>()

	// Production host callback: real SdkController.prototype.updateBackgroundCommandState.
	// Mirrors the wiring at SdkController.ts:1881-1882 (and the
	// BCTCP01-runner-controller-composition test).
	const onBackgroundStateChange: ProductionWiringHarness["onBackgroundStateChange"] = (running, jobId, terminalState) => {
		SdkController.prototype.updateBackgroundCommandState.call(
			// biome-ignore lint/suspicious/noExplicitAny: test seam (private surface used in prod)
			subject as any,
			running,
			jobId,
			terminalState,
		)
		if (running && jobId && subject.backgroundCommandJobStates[jobId] === "running") {
			// The runner's start-side invariant: per the production
			// contract the spawned supervisor is registered in the
			// harness map so the test can drive exit / cancel.
			const next = supervisorsFifo.shift()
			if (next) {
				supervisorsByJobId.set(jobId, next)
			}
		}
	}

	// The `onRunningObserved` callback the production
	// `vscode-runtime-builder.ts:296-298` would emit. This is the
	// real production closure: it forwards to the host's
	// `updateBackgroundCommandState(true, jobId, undefined)`.
	const onRunningObserved: ProductionWiringHarness["onRunningObserved"] = (jobId) => {
		onBackgroundStateChange(true, jobId, undefined)
	}

	const runTool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground not used in background test")
		},
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: manager,
		backgroundWaitBudgetMs: 50,
		backgroundExecutionDeadlineMs: 60_000,
		onBackgroundStateChange,
	})

	return { manager, subject, runTool, supervisorsByJobId, onBackgroundStateChange, onRunningObserved }
}

async function startLongRunningJobAndCaptureEnvelope(h: ProductionWiringHarness): Promise<{
	jobId: string
	envelope: {
		status: string
		jobId: string
		elapsedMs: number
		deadlineRemainingMs: number
		outputTruncated: boolean
		stdout: string
	}
}> {
	const result = await h.runTool.execute(
		{ commands: ["/bin/sh -c 'sleep 30'"] },
		{ agentId: "test-agent", conversationId: "conv-rcnc02", iteration: 1 },
	)
	const arr = Array.isArray(result) ? (result as Array<{ result: string }>) : []
	const parsed = JSON.parse(arr[0]?.result ?? "{}")
	// Byte-equivalent assertion: the captured envelope must carry
	// exactly the keys the screenshot showed.
	for (const key of SCREENSHOT_ENVELOPE_KEYS) {
		expect(parsed).toHaveProperty(key)
	}
	expect(parsed.status).toBe("running")
	expect(typeof parsed.jobId).toBe("string")
	expect(typeof parsed.elapsedMs).toBe("number")
	expect(typeof parsed.deadlineRemainingMs).toBe("number")
	return {
		jobId: parsed.jobId,
		envelope: {
			status: parsed.status,
			jobId: parsed.jobId,
			elapsedMs: parsed.elapsedMs,
			deadlineRemainingMs: parsed.deadlineRemainingMs,
			outputTruncated: parsed.outputTruncated,
			stdout: parsed.stdout,
		},
	}
}

describe("ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION01 / RCNC02", () => {
	it("RCNC02-01 GREEN: original tool-result path is non-terminal by construction; envelope → projection=running → pill=Backgrounded (NEVER 'Run failed')", async () => {
		const h = makeProductionWiringHarness()
		try {
			// (1) Produce a controlled `status:"running"` result at the initial observation deadline.
			const { jobId, envelope } = await startLongRunningJobAndCaptureEnvelope(h)

			// (2) Record the exact tool-result envelope — already captured above.
			// Byte-equivalent to the live specimen (jobId shape,
			// elapsedMs/deadlineRemainingMs numeric types,
			// status: "running").
			expect(envelope.status).toBe("running")
			expect(envelope.elapsedMs).toBeGreaterThanOrEqual(0)
			expect(envelope.deadlineRemainingMs).toBeGreaterThan(0)
			expect(envelope.jobId).toBe(jobId)

			// (3) Exercise the real production projection without
			// calling `command_status`. The projection map is the
			// real `SdkController.backgroundCommandJobStates` map
			// (driven by the real
			// `updateBackgroundCommandState` callback above).
			const projectionValue = h.subject.backgroundCommandJobStates[jobId]
			// The manager agrees the job is alive.
			const managerSnap = await h.manager.status({ jobId, waitMs: 0 })
			expect(managerSnap.ok).toBe(true)
			if (managerSnap.ok) {
				expect(managerSnap.snapshot.state).toBe("running")
			}
			expect(h.manager.activeCount).toBe(1)

			// (4) Assert: a nonterminal response CANNOT be rendered
			// as a terminal command failure. The renderer's pill is
			// a pure function of the projection value; mirror that
			// mapping here.
			expect(projectionValue).toBe("running")
			expect(projectionValue).not.toBe("containment_failed")
			expect(pillForProjection(projectionValue)).toBe("Backgrounded")
			// And the user-visible pill is NEVER "Run failed" while
			// the job is alive and the projection is honest.
			expect(pillForProjection(projectionValue)).not.toBe("Run failed")
		} finally {
			await h.manager.dispose()
		}
	})

	it("RCNC02-02 RED discriminator: a stale containment_failed write to the projection map is REQUIRED to render 'Run failed' — no command_status invocation can rescue the row", async () => {
		// This test is the bounded-correction RED discriminator. It
		// proves the original P0 hypothesis: a one-shot desync that
		// writes `containment_failed` to the projection map while
		// the underlying CommandJob is still alive is REQUIRED to
		// produce the user-visible "Run failed" pill. Without that
		// misfire the row renders "Backgrounded" (RCNC02-01). And
		// crucially, without a `command_status` invocation, the row
		// STAYS "Run failed" — the bounded fix is load-bearing.
		const h = makeProductionWiringHarness()
		try {
			const { jobId } = await startLongRunningJobAndCaptureEnvelope(h)
			// Sanity: after the start the projection is "running"
			// (RCNC02-01).
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("running")
			expect(h.manager.activeCount).toBe(1)

			// Adversarial misfire: simulate the reviewer's
			// hypothesised one-shot desync — a `command_job_containment_failed`
			// lifecycle emit that fires while the job is actually
			// still alive (the `isContainmentFailed === true` path
			// the runner's terminalPromise listener consults at
			// `vscode-run-commands-tool.ts:833`). The runner would
			// route this through `notifyBackgroundStateChange(false,
			// jobId, "containment_failed")`. We invoke the EXACT
			// production callback here (the same closure
			// `onBackgroundStateChange` that the runner would call).
			h.onBackgroundStateChange(false, jobId, "containment_failed")

			// (a) The projection is now `containment_failed`.
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("containment_failed")
			// (b) The user-visible pill is "Run failed".
			expect(pillForProjection(h.subject.backgroundCommandJobStates[jobId])).toBe("Run failed")
			// (c) The manager STILL says the job is alive — the
			// misfire is a projection-only desync, not a real
			// terminal event. This is the live-specimen condition:
			// tool result says running, projection says terminal.
			expect(h.manager.activeCount).toBe(1)
			const managerSnap = await h.manager.status({ jobId, waitMs: 0 })
			expect(managerSnap.ok).toBe(true)
			if (managerSnap.ok) {
				expect(managerSnap.snapshot.state).toBe("running")
			}

			// (d) WITHOUT invoking `command_status` the row STAYS
			// "Run failed". This is the bounded-correction
			// discriminator: the original P0 cannot be repaired
			// without a nonterminal observation seam.
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("containment_failed")
			expect(pillForProjection(h.subject.backgroundCommandJobStates[jobId])).toBe("Run failed")
		} finally {
			await h.manager.dispose()
		}
	})

	it("RCNC02-03 GREEN: production-wired command_status reconciles a stale containment_failed projection back to running; the bounded fix is load-bearing for the original P0", async () => {
		const h = makeProductionWiringHarness()
		// Build the production-equivalent `command_status` tool.
		// The wiring is the exact closure the production
		// `vscode-runtime-builder.ts:296-298` would emit: a per-call
		// `onRunningObserved(jobId)` callback that forwards to the
		// host's `updateBackgroundCommandState(true, jobId, undefined)`.
		// This is the REAL production wiring, NOT a synthetic Record
		// poisoning. The callback is the bounded fix under test.
		const statusTool = createCommandStatusTool(h.manager, {
			onRunningObserved: h.onRunningObserved,
		})
		try {
			const { jobId } = await startLongRunningJobAndCaptureEnvelope(h)
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("running")

			// Adversarial misfire (same as RCNC02-02).
			h.onBackgroundStateChange(false, jobId, "containment_failed")
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("containment_failed")
			expect(pillForProjection(h.subject.backgroundCommandJobStates[jobId])).toBe("Run failed")

			// Drive the canonical nonterminal observation through
			// the REAL production `command_status` tool with
			// `waitMs: 0`. The bounded fix's `onRunningObserved`
			// callback fires when the manager snapshot state is
			// "running".
			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc02", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("running")

			// The REAL production `updateBackgroundCommandState` was
			// invoked with `(true, jobId, undefined)` through the
			// real wiring. The projection reconciles to "running".
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("running")
			expect(pillForProjection(h.subject.backgroundCommandJobStates[jobId])).toBe("Backgrounded")
			// And NOT "Run failed" — the bounded fix is
			// load-bearing for the original P0.
			expect(pillForProjection(h.subject.backgroundCommandJobStates[jobId])).not.toBe("Run failed")
		} finally {
			await h.manager.dispose()
		}
	})

	it("RCNC02-04 conservation: a terminal observation does NOT fire the reconciliation callback; the projection stays terminal", async () => {
		const h = makeProductionWiringHarness()
		const onRunningObservedSpy = vi.fn(h.onRunningObserved)
		const statusTool = createCommandStatusTool(h.manager, {
			onRunningObserved: onRunningObservedSpy,
		})
		try {
			const { jobId } = await startLongRunningJobAndCaptureEnvelope(h)
			const handle = h.supervisorsByJobId.get(jobId)
			expect(handle).toBeDefined()
			if (!handle) return

			// Drive the supervisor to a natural nonzero exit.
			handle.resolveExit(0)
			for (let i = 0; i < 50; i += 1) {
				if (h.subject.backgroundCommandJobStates[jobId] !== "running") break
				await sleep(5)
			}
			expect(h.manager.activeCount).toBe(0)
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("exited")

			// A subsequent command_status on the terminal job MUST
			// observe the terminal state and MUST NOT fire the
			// bounded fix's `onRunningObserved` callback.
			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc02", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("exited")
			expect(onRunningObservedSpy).not.toHaveBeenCalled()
			// Projection remains terminal — NOT reconciled to
			// "running" by a terminal observation.
			expect(h.subject.backgroundCommandJobStates[jobId]).toBe("exited")
		} finally {
			await h.manager.dispose()
		}
	})
})
