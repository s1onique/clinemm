/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
 * (correction01 / Factory HALT_MULTI_JOB_RUNNER_COMPOSITION):
 *
 * Genuine RUNNER -> CONTROLLER composition. The Factory reviewer
 * demanded ONE test that wires the real runner's
 * `onBackgroundStateChange` callback to the real
 * `SdkController.prototype.updateBackgroundCommandState`, starts
 * J1 + J2 via real `tool.execute(...)`, terminalizes J1 via real
 * `manager.cancel(...)`, and asserts:
 *
 *   projection[J1]    = cancelled
 *   projection[J2]    = running
 *   backgroundCommandRunning = true
 *   backgroundCommandTaskId  = J2
 *   manager.status(J2).state  = running
 *
 * then terminalizes J2 and asserts:
 *
 *   projection[J2]    = terminal reason
 *   backgroundCommandRunning = false
 *   backgroundCommandTaskId  = undefined
 *
 * This is the bounded P0 composition proof. Earlier tests
 * (BCTCP-CTL-MULTI-01..05) drive the controller seam directly;
 * BCTCP-RUNNER-MULTI-01..04 exercise the runner seam in
 * isolation. THIS test closes the gap by exercising the full
 * producer -> bridge -> consumer composition in ONE test.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommandJobManager } from "../command-job-manager"
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

vi.mock("@/services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

vi.mock("@/services/telemetry/TelemetryService", () => ({
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

// Fake supervisor (matches the runner-seam harness).
let supervisorPidCounter = 900000

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

// Real `SdkController.prototype.updateBackgroundCommandState` driven by the
// runner's callbacks (no controller seam stub). The minimum fields the
// method consults.
function makeControllerSubject(): {
	backgroundCommandRunning: boolean
	backgroundCommandTaskId: string | undefined
	backgroundCommandJobStates: Record<string, string>
	postStateToWebview: () => Promise<void>
	sessions: { getActiveSession: () => unknown }
	sessionEvents: { reevaluateDeferredContinuation: () => void }
} {
	return {
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundCommandJobStates: {},
		postStateToWebview: vi.fn(async () => {}),
		sessions: { getActiveSession: () => undefined },
		sessionEvents: { reevaluateDeferredContinuation: vi.fn() },
	}
}
describe(
	"ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 / runner->controller composition (correction01 round 2)",
	() => {
		beforeEach(() => {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		})
		afterEach(() => {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		})

		it(
			"BCTCP-RUNNER-COMPOSITION-01 real runner callbacks drive real SdkController.updateBackgroundCommandState end-to-end (J1 cancel + J2 stays running -> J1=cancelled / J2=running / scalar=true / taskId=J2; then J2 cancel -> scalar=false / taskId=undefined)",
			async () => {
				const manager = new CommandJobManager({
					maxWaitBudgetMs: 5_000,
					maxExecutionDeadlineMs: 60_000,
					spawnFactory: () => {
						const handle = fakeSupervisor()
						return handle.supervisor
					},
				})
				const subject = makeControllerSubject()
				// Bind the runner callback to the REAL
				// SdkController.prototype.updateBackgroundCommandState
				// -- the production wiring (see SdkController.ts:1457).
				const tool = createVscodeRunCommandsTool({
					cwd: process.cwd(),
					getTerminalManager: () => {
						throw new Error("foreground not used")
					},
					vscodeTerminalExecutionMode: "backgroundExec",
					commandJobManager: manager,
					backgroundWaitBudgetMs: 50,
					backgroundExecutionDeadlineMs: 60_000,
					onBackgroundStateChange: (
						running: boolean,
						jobId: string | undefined,
						terminalState?: Parameters<SdkController["updateBackgroundCommandState"]>[2],
					) => {
						SdkController.prototype.updateBackgroundCommandState.call(
							// biome-ignore lint/suspicious/noExplicitAny: test seam (private surface used in prod)
							subject as any,
							running,
							jobId,
							terminalState,
						)
					},
				})

				try {
					const startJob = async (): Promise<string> => {
						const result = await tool.execute(
							{ commands: ["/bin/sh -c 'sleep 30'"] },
							{ agentId: "test-agent", conversationId: "conv-1", iteration: 1 },
						)
						const arr = Array.isArray(result) ? (result as Array<{ result: string }>) : []
						const parsed = JSON.parse(arr[0]?.result ?? "{}")
						expect(parsed.status).toBe("running")
						return parsed.jobId as string
					}
					const jobId1 = await startJob()
					const jobId2 = await startJob()

					// After both starts: per-job map has BOTH entries
					// (the start-side invariant the Factory reviewer demanded).
					expect(subject.backgroundCommandJobStates[jobId1]).toBe("running")
					expect(subject.backgroundCommandJobStates[jobId2]).toBe("running")
					expect(subject.backgroundCommandRunning).toBe(true)
					expect(subject.backgroundCommandTaskId).toBe(jobId2) // last started

					// Terminalize J1 via the public cancel() seam.
					await manager.cancel({
						jobId: jobId1,
						origin: "other:bctcp-runner-composition-01",
					})
					await sleep(50)

					// Per-job terminal: J1 flipped, J2 still running.
					expect(subject.backgroundCommandJobStates[jobId1]).toBe("cancelled")
					expect(subject.backgroundCommandJobStates[jobId2]).toBe("running")
					// Scalar still true because J2 is alive.
					expect(subject.backgroundCommandRunning).toBe(true)
					// Active taskId points at J2.
					expect(subject.backgroundCommandTaskId).toBe(jobId2)
					// Manager (the authority) confirms J2 is RUNNING.
					const j2Status = await manager.status({ jobId: jobId2, waitMs: 0 })
					expect(j2Status.ok).toBe(true)
					if (j2Status.ok) {
						expect(j2Status.snapshot.state).toBe("running")
					}

					// Terminalize J2: the >0->0 cardinal transition.
					await manager.cancel({
						jobId: jobId2,
						origin: "other:bctcp-runner-composition-01",
					})
					await sleep(50)

					// Per-job terminal: J2 flipped. Both jobs now terminal.
					expect(subject.backgroundCommandJobStates[jobId1]).toBe("cancelled")
					expect(subject.backgroundCommandJobStates[jobId2]).toBe("cancelled")
					// Scalar flips to false (no more "running" entries).
					expect(subject.backgroundCommandRunning).toBe(false)
					// Active taskId is undefined (no running jobs).
					expect(subject.backgroundCommandTaskId).toBe(undefined)
				} finally {
					await manager.dispose()
				}
			},
		)
	},
)
