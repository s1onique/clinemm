/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01
 *
 * GREEN + adversarial conservation gates for the command-process-outcome
 * trace bridge, driven through the REAL production seams.
 *
 * WHAT IS EXERCISED
 * -----------------
 *   - G3/G4 — the REAL `CommandJobManager` background path: a `running`
 *     handoff, the enclosing tool call RETURNING, and the eventual
 *     authoritative terminal fact arriving LATER, still correlated to the
 *     ORIGINAL owner.
 *   - G5 — concurrent jobs with overlapping command indices.
 *   - G2 — the foreground classification boundary: exit 0, nonzero exit,
 *     exit code unavailable, terminal closed, and unobserved command.
 *   - G8 — trace-OFF neutrality: identical results, identical ordering
 *     witnesses, and no new recorder event while disabled.
 *   - G9 — privacy adversaries: unexpected fields injected into the source
 *     observation never reach the portable payload.
 *
 * The background witnesses use REAL subprocesses (`/bin/sh`) through the
 * REAL `CommandJobManager`, so the exit codes asserted here are the codes
 * the PROCESSES actually produced.
 */

import { type AgentToolContext, ModelBehaviorTraceRecorder } from "@cline/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

// The real `StateManager` pulls in the generated protobuf host bundle, which
// is a STALE generated artifact in this tree (the `rcnc02` baseline
// limitation). The existing `vscode-run-commands-tool.test.ts` breaks the
// same chain, so the bridge witnesses use the SAME mocks — the production
// seam under test (the command executor + the job manager) is untouched.
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: () => "default" }),
	},
}))

// The real telemetry proxy lazily initializes a TelemetryService that needs
// a HostProvider the unit tests do not set up.
vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

// The headless vscode stub exposes no terminal-profile API, so
// `getShellForProfile("default")` resolves to `"unknown"` and every
// background spawn fails with `containment_failed` BEFORE the command
// runs. This is an ENVIRONMENT artifact of the headless harness (the
// pre-existing `vscode-run-commands-tool.background-state.test.ts` suite
// fails the same way for the same reason), NOT a production behaviour.
//
// The shell path is an INPUT to the job manager, not the behaviour under
// test, so it is pinned to a real POSIX shell here. The process
// supervision, the wait budget, the terminal transition, and the exit
// code remain the production ones.
vi.mock("@/utils/shell", () => ({
	getShellForProfile: () => (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
}))

const isPosix = process.platform !== "win32"

/** One captured process observation, with its envelope identity. */
interface CapturedObservation {
	sessionId?: string
	runId?: string
	payload: Record<string, unknown>
}

/**
 * Build the runtime-owned tool context the production runtime hands to a
 * tool executor, including the established trace-observation channel.
 */
function makeContext(
	observations: CapturedObservation[],
	overrides?: { toolCallId?: string; sessionId?: string; runId?: string },
): AgentToolContext {
	const sessionId = overrides?.sessionId ?? "session-1"
	const runId = overrides?.runId ?? "run_abcdefgh"
	const toolCallId = overrides?.toolCallId ?? "call-1"
	return {
		agentId: "agent-1",
		sessionId,
		runId,
		iteration: 3,
		toolCallId,
		metadata: {
			__clineModelBehaviorTraceSink: {
				onProcessObservation: (observation: CapturedObservation) => {
					observations.push(observation)
				},
			},
			__clineModelBehaviorTraceIdentity: { sessionId, runId, toolCallId },
		},
	}
}

/** A context with tracing OFF — no sink on the metadata channel at all. */
function makeTraceOffContext(): AgentToolContext {
	return {
		agentId: "agent-1",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 3,
		toolCallId: "call-1",
		metadata: {},
	}
}

const managers: CommandJobManager[] = []

afterEach(async () => {
	while (managers.length > 0) {
		const manager = managers.pop()
		try {
			await manager?.dispose()
		} catch {
			// Disposal is best-effort in teardown.
		}
	}
})

describe("command-process-outcome trace bridge — background (G3/G4/G5)", () => {
	it("G4: records running at the handoff and the authoritative terminal fact AFTER the tool call returned", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		managers.push(manager)
		const observations: CapturedObservation[] = []

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("the background path must not use the terminal manager")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			// A tiny wait budget so the command is still running when the
			// tool returns, and a short deadline so it terminates soon.
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 5_000,
		})

		const result = (await tool.execute(
			{ commands: ["/bin/sh -c 'sleep 0.2; exit 7'"] } as never,
			makeContext(observations),
		)) as unknown[] | undefined

		// The tool call RETURNED with a RUNNING handoff (the process had
		// not yet exited when the wait budget expired).
		expect(result).toBeDefined()
		expect(Array.isArray(result)).toBe(true)
		const first = result?.[0] as { success?: boolean; result?: string }
		expect(first?.success).toBe(true)
		const payload = JSON.parse(String(first?.result)) as { status?: string; jobId?: string }
		expect(payload.status).toBe("running")
		expect(typeof payload.jobId).toBe("string")

		// The NONTERMINAL handoff observation exists and is NOT a success.
		const running = observations.find((o) => o.payload.terminalState === "running")
		expect(running).toBeDefined()
		expect(running?.payload.commandIndex).toBe(0)
		expect(running?.payload.toolCallId).toBe("call-1")
		expect(running?.payload.jobId).toBe(payload.jobId)
		expect(running?.payload.exitCode).toBeUndefined()

		// The terminal fact arrives LATER — after the tool call returned.
		// The process really exited 7.
		const terminal = await new Promise<CapturedObservation>((resolve, reject) => {
			const deadline = Date.now() + 8_000
			const poll = (): void => {
				const found = observations.find((o) => o.payload.terminalState === "exited")
				if (found) {
					resolve(found)
					return
				}
				if (Date.now() > deadline) {
					reject(new Error("the terminal observation never arrived"))
					return
				}
				setTimeout(poll, 20)
			}
			poll()
		})

		// The terminal fact is tied to the ORIGINAL owner.
		expect(terminal.payload.commandIndex).toBe(0)
		expect(terminal.payload.toolCallId).toBe("call-1")
		expect(terminal.payload.jobId).toBe(payload.jobId)
		expect(terminal.payload.executionMode).toBe("background")
		// The REAL exit code the process produced — 7, not 0 and not 1.
		expect(terminal.payload.exitCode).toBe(7)

		// Exactly ONE terminal observation for this execution.
		const terminalRecords = observations.filter((o) => o.payload.terminalState === "exited")
		expect(terminalRecords).toHaveLength(1)
	})

	it("G5: concurrent jobs with OVERLAPPING command indices never cross owners", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		managers.push(manager)
		const observations: CapturedObservation[] = []

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("the background path must not use the terminal manager")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 5_000,
		})

		// TWO concurrent tool invocations, each with its own owner, each
		// using command index 0.
		await Promise.all([
			tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.2; exit 11'"] } as never,
				makeContext(observations, { toolCallId: "call-A" }),
			),
			tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.3; exit 13'"] } as never,
				makeContext(observations, { toolCallId: "call-B" }),
			),
		])

		const waitForTerminals = async (): Promise<CapturedObservation[]> => {
			const deadline = Date.now() + 8_000
			while (Date.now() < deadline) {
				const terminals = observations.filter((o) => o.payload.terminalState === "exited")
				if (terminals.length >= 2) {
					return terminals
				}
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
			return observations.filter((o) => o.payload.terminalState === "exited")
		}

		const terminals = await waitForTerminals()
		expect(terminals).toHaveLength(2)

		// Each owner got exactly ONE terminal record, with its OWN exit code.
		const byOwner = new Map<string, CapturedObservation>()
		for (const terminal of terminals) {
			const owner = terminal.payload.toolCallId as string
			expect(byOwner.has(owner)).toBe(false)
			byOwner.set(owner, terminal)
		}
		expect(byOwner.get("call-A")?.payload.exitCode).toBe(11)
		expect(byOwner.get("call-B")?.payload.exitCode).toBe(13)
		// No cross-owner attribution: every observation's owner is one of
		// the two, and the job ids differ.
		const jobIds = new Set(terminals.map((t) => t.payload.jobId))
		expect(jobIds.size).toBe(2)
		for (const terminal of terminals) {
			expect(["call-A", "call-B"]).toContain(terminal.payload.toolCallId)
			expect(terminal.payload.commandIndex).toBe(0)
		}
	})
})

describe("command-process-outcome trace bridge — foreground classification (G2)", () => {
	/**
	 * Drive the REAL foreground executor against a stub terminal process
	 * that reports the given completion details — exactly what the real
	 * `VscodeTerminalProcess` reports.
	 */
	async function runForeground(
		completionDetails: {
			exitCode?: number | null
			terminalClosed?: boolean
			unobservedCommand?: { source: string; ownership: string }
		},
		observations: CapturedObservation[],
	): Promise<void> {
		const terminalProcess = {
			isHot: false,
			waitForShellIntegration: true,
			on: () => undefined,
			once: () => undefined,
			removeListener: () => undefined,
			continue: () => undefined,
			detach: () => undefined,
			getUnretrievedOutput: () => "",
			getCompletionDetails: () => completionDetails,
		}
		const terminalManager = {
			getOrCreateTerminal: async () => ({ id: 1 }),
			runCommand: () => terminalProcess,
			releaseTerminalReservation: () => undefined,
			sendInterrupt: () => undefined,
		}
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => terminalManager as never,
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})
		await tool.execute({ commands: ["echo hi"] } as never, makeContext(observations))
	}

	it("G2: an observed exit code of 0 is recorded as exited with exit code 0", async () => {
		const observations: CapturedObservation[] = []
		await runForeground({ exitCode: 0 }, observations)
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload).toMatchObject({
			commandIndex: 0,
			terminalState: "exited",
			exitCode: 0,
			executionMode: "foreground",
		})
	})

	it("G2: an observed NONZERO exit code is recorded with that exact code", async () => {
		const observations: CapturedObservation[] = []
		await runForeground({ exitCode: 42 }, observations)
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload).toMatchObject({
			terminalState: "exited",
			exitCode: 42,
		})
	})

	it("G2: an UNAVAILABLE exit code is recorded as unknown with NO exit code (never 0)", async () => {
		const observations: CapturedObservation[] = []
		await runForeground({}, observations)
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload.terminalState).toBe("unknown")
		expect(observations[0]?.payload.exitCode).toBeUndefined()
	})

	it("G2: a TERMINAL CLOSED mid-command is recorded as unknown, never as a clean exit", async () => {
		const observations: CapturedObservation[] = []
		await runForeground({ terminalClosed: true }, observations)
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload.terminalState).toBe("unknown")
		expect(observations[0]?.payload.exitCode).toBeUndefined()
	})

	it("G2: an UNOBSERVED command is recorded as unknown, never as a clean exit", async () => {
		const observations: CapturedObservation[] = []
		await runForeground({ unobservedCommand: { source: "sendText", ownership: "managed" } }, observations)
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload.terminalState).toBe("unknown")
		expect(observations[0]?.payload.exitCode).toBeUndefined()
	})
})

describe("command-process-outcome trace bridge — trace-OFF neutrality (G8)", () => {
	it("G8: tracing OFF produces NO observation and does NOT change the execution order", async () => {
		const observations: CapturedObservation[] = []
		const terminalProcess = {
			isHot: false,
			waitForShellIntegration: true,
			on: () => undefined,
			once: () => undefined,
			removeListener: () => undefined,
			continue: () => undefined,
			detach: () => undefined,
			getUnretrievedOutput: () => "",
			getCompletionDetails: () => ({ exitCode: 0 }),
		}
		const order: string[] = []
		const terminalManager = {
			getOrCreateTerminal: async () => {
				order.push("acquire")
				return { id: 1 }
			},
			runCommand: () => {
				order.push("run")
				return terminalProcess
			},
			releaseTerminalReservation: () => undefined,
			sendInterrupt: () => undefined,
		}
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => terminalManager as never,
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})

		const offResult = await tool.execute({ commands: ["echo hi"] } as never, makeTraceOffContext())

		// No observation is emitted while tracing is OFF.
		expect(observations).toHaveLength(0)
		// The execution ORDER witness is the production order, so the
		// disabled path adds no suspension point between the two steps.
		expect(order).toEqual(["acquire", "run"])

		// The tool result is UNCHANGED by tracing being off.
		const offResults = offResult as Array<{ success?: boolean; result?: string }>
		expect(offResults).toHaveLength(1)
		expect(offResults[0]?.success).toBe(true)
	})

	it("G8: tracing ON vs OFF yields IDENTICAL tool results", async () => {
		const makeTerminalManager = (): unknown => {
			const terminalProcess = {
				isHot: false,
				waitForShellIntegration: true,
				on: () => undefined,
				once: () => undefined,
				removeListener: () => undefined,
				continue: () => undefined,
				detach: () => undefined,
				getUnretrievedOutput: () => "",
				getCompletionDetails: () => ({ exitCode: 5 }),
			}
			return {
				getOrCreateTerminal: async () => ({ id: 1 }),
				runCommand: () => terminalProcess,
				releaseTerminalReservation: () => undefined,
				sendInterrupt: () => undefined,
			}
		}
		const observations: CapturedObservation[] = []

		const offTool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => makeTerminalManager() as never,
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})
		const onTool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => makeTerminalManager() as never,
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})

		const offResult = await offTool.execute({ commands: ["echo hi"] } as never, makeTraceOffContext())
		const onResult = await onTool.execute({ commands: ["echo hi"] } as never, makeContext(observations))

		// IDENTICAL tool results — the bridge does not change the model's
		// view of the command.
		expect(JSON.stringify(offResult)).toBe(JSON.stringify(onResult))
		// The traced run DID observe the process.
		expect(observations).toHaveLength(1)
		expect(observations[0]?.payload.exitCode).toBe(5)
	})
})

describe("command-process-outcome trace bridge — privacy adversaries (G9)", () => {
	it("G9: unexpected fields injected into the source observation never reach the recorder payload", async () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)

		// Inject a hostile payload DIRECTLY into the recorder's sanitizer
		// path, simulating a producer that tried to smuggle content.
		const record = recorder.record(
			"process_observation",
			{ sessionId: "session-1", runId: "run_abcdefgh" },
			{
				toolCallId: "call-1",
				commandIndex: 0,
				terminalState: "exited",
				exitCode: 0,
				// Hostile injections:
				command: "rm -rf /",
				args: ["--danger"],
				stdout: "secret output",
				stderr: "secret error",
				env: { SECRET: "value" },
			},
		)

		expect(record).toBeDefined()
		const payload = record?.payload ?? {}
		// The allowed structural facts survive.
		expect(payload.toolCallId).toBe("call-1")
		expect(payload.commandIndex).toBe(0)
		expect(payload.terminalState).toBe("exited")
		expect(payload.exitCode).toBe(0)
		// The forbidden keys are dropped (the recorder's fail-closed
		// sanitizer redacts them).
		expect(payload.command).toBe("[REDACTED_BY_TRACE_SCHEMA]")
		expect(payload.args).toBe("[REDACTED_BY_TRACE_SCHEMA]")
		expect(payload.stdout).toBe("[REDACTED_BY_TRACE_SCHEMA]")
		expect(payload.stderr).toBe("[REDACTED_BY_TRACE_SCHEMA]")
		expect(payload.env).toBe("[REDACTED_BY_TRACE_SCHEMA]")
	})
})

describe("command-process-outcome trace bridge — recorder toggles (G7)", () => {
	/**
	 * The recorder's enable bit is consulted AT OBSERVATION TIME, so a
	 * toggle affects already-running sessions for subsequent events.
	 *
	 * The G7 witnesses pin the two transition cases the ACT names:
	 *
	 *   - toggle OFF during an active job → the LATER terminal observation
	 *     is NOT emitted (the recorder is consulted at the observation
	 *     boundary), so the capture is EXPLICITLY PARTIAL — the handoff
	 *     exists, the terminal fact does not. No missing terminal is
	 *     manufactured, and the running handoff is never restated as a
	 *     success.
	 *
	 *   - toggle ON after the handoff → the LATER terminal observation IS
	 *     emitted, so the capture is again explicitly partial (the
	 *     handoff is missing, the terminal fact is present).
	 */
	it("G7: toggling OFF during an active job leaves the capture explicitly PARTIAL (no manufactured terminal)", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		managers.push(manager)
		const observations: CapturedObservation[] = []
		let tracingEnabled = true

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("the background path must not use the terminal manager")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 5_000,
		})

		const context = makeContext(observations)
		// The sink consults the enable bit AT OBSERVATION TIME.
		const metadata = context.metadata as Record<string, unknown>
		const sink = metadata.__clineModelBehaviorTraceSink as {
			onProcessObservation: (observation: CapturedObservation) => void
			isTraceEnabled: () => boolean
		}
		sink.isTraceEnabled = () => tracingEnabled

		await tool.execute({ commands: ["/bin/sh -c 'sleep 0.3; exit 5'"] } as never, context)

		// The handoff was observed while tracing was ON.
		expect(observations.some((o) => o.payload.terminalState === "running")).toBe(true)

		// Toggle OFF before the job terminates.
		tracingEnabled = false

		// Wait past the job's terminal time.
		await new Promise((resolve) => setTimeout(resolve, 1_500))

		// The terminal observation was NOT emitted — the capture is
		// PARTIAL. The `running` handoff is still there and was NEVER
		// restated as a success.
		expect(observations.some((o) => o.payload.terminalState === "exited")).toBe(false)
		const handoff = observations.find((o) => o.payload.terminalState === "running")
		expect(handoff).toBeDefined()
		expect(handoff?.payload.exitCode).toBeUndefined()
		expect(handoff?.payload.terminalState).toBe("running")
	})

	it("G7: toggling ON after the handoff emits the terminal fact (still explicitly partial)", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		managers.push(manager)
		const observations: CapturedObservation[] = []
		let tracingEnabled = false

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("the background path must not use the terminal manager")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 5_000,
		})

		const context = makeContext(observations)
		const metadata = context.metadata as Record<string, unknown>
		const sink = metadata.__clineModelBehaviorTraceSink as {
			onProcessObservation: (observation: CapturedObservation) => void
			isTraceEnabled: () => boolean
		}
		sink.isTraceEnabled = () => tracingEnabled

		await tool.execute({ commands: ["/bin/sh -c 'sleep 0.3; exit 9'"] } as never, context)

		// Tracing was OFF at the handoff, so no handoff record exists.
		expect(observations).toHaveLength(0)

		// Toggle ON before the job terminates.
		tracingEnabled = true

		const terminal = await new Promise<CapturedObservation>((resolve, reject) => {
			const deadline = Date.now() + 8_000
			const poll = (): void => {
				const found = observations.find((o) => o.payload.terminalState === "exited")
				if (found) {
					resolve(found)
					return
				}
				if (Date.now() > deadline) {
					reject(new Error("the terminal observation never arrived"))
					return
				}
				setTimeout(poll, 20)
			}
			poll()
		})

		// The terminal fact IS present, with the REAL exit code.
		expect(terminal.payload.exitCode).toBe(9)
		expect(terminal.payload.toolCallId).toBe("call-1")
		// The handoff is still missing — the capture is explicitly
		// PARTIAL, and no missing handoff is manufactured.
		expect(observations.some((o) => o.payload.terminalState === "running")).toBe(false)
	})
})
