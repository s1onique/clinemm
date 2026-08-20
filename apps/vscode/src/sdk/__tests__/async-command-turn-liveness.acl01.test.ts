/**
 * ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01
 *
 * Bounded RED reproduction of the
 * `run_commands` background -> agent successor-seam defect.
 *
 * This ACT classifies:
 *   - the host-only projection reset (RTP00) as intact;
 *   - the executor terminal event -> agent wakeup as
 *     structurally missing (ACL02 RED, see companion
 *     `acl02-runtime-seam.c24-c-bridge.test.ts`);
 *   - the typed intent for FOREGROUND_DEFERRED vs
 *     INTENTIONALLY_DETACHED as structurally absent (ACL04,
 *     real-schema-pin).
 *
 * CORRECTION01 review notes (peer-reviewed):
 *
 *   - ACL04 was previously a self-referential dummy-object
 *     probe. That test was authored to pass rather than to
 *     prove anything about production. Replaced with a
 *     real `createShellTool(...).inputSchema` JSON-Schema
 *     traversal that pins the strict
 *     `additionalProperties: false` + missing `intent`
 *     field.
 *
 *   - ACL02 was previously a self-referential
 *     `onBackgroundStateChange` callback probe. That
 *     test passed without observing the agent, the
 *     runtime, or the scheduler. Replaced as a
 *     structural observation here; the deeper causal
 *     RED proof (counting `runTurn` invocations after
 *     bg-job terminal) lives in the companion
 *     `acl02-runtime-seam.c24-c-bridge.test.ts` under
 *     the dedicated c2-4-c bridge config.
 *
 *   - The model-facing `run_commands` tool description
 *     (the third byte of this ACT) explicitly tells the
 *     model to "redirect long-running commands to a
 *     tmp file." That classifies the contract as
 *     "model-owned polling" (Contract X). The user's
 *     live screenshot's `awaiting_followup` is the
 *     model legitimately emitting a text-only response
 *     after a RUNNING result, NOT a host that lost the
 *     job. ACL06 pins this contract observation.
 */

import { createShellTool } from "@cline/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

type ToolRunResult = Array<{ result: string }>

async function executeTool(
	tool: ReturnType<typeof createVscodeRunCommandsTool>,
	input: Parameters<typeof tool.execute>[0],
	context: Parameters<typeof tool.execute>[1],
): Promise<ToolRunResult> {
	return (await tool.execute(input, context)) as ToolRunResult
}

const mocks = vi.hoisted(() => ({
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const originalPlatform = process.platform
const originalEnv = { ...process.env }

afterEach(() => {
	vi.useRealTimers()
	Object.defineProperty(process, "platform", { value: originalPlatform })
	process.env = { ...originalEnv }
	mocks.getGlobalSettingsKey.mockReset()
	mocks.getGlobalSettingsKey.mockReturnValue("default")
})

const isPosix = process.platform !== "win32"
const sleepCmd = isPosix ? "/bin/sh -c 'sleep 5'" : "ping -n 5 127.0.0.1"
const fastCmd = isPosix ? "/bin/sh -c 'echo done'" : "cmd /c echo done"

async function waitForJobIdle(manager: CommandJobManager, jobId: string): Promise<void> {
	await manager.status({ jobId, waitMs: 10_000 })
	for (let i = 0; i < 200; i += 1) {
		if (manager.activeCount === 0) break
		await new Promise((r) => setTimeout(r, 50))
	}
}

// ===========================================================================
// ACL01 — RUNNING_JOB_MUST_NOT_BE_SILENTLY_ABANDONED
// ===========================================================================
// Real CommandJobManager + real `run_commands` tool. After
// the bg-job terminates asynchronously, the projection
// callback MUST flip back to `false`. This is the
// projection-only seam that was wired by
// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01. It is intact
// today; ACL01 confirms the projection reset still works.
//
describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL01", () => {
	it("RUNNING_JOB_MUST_NOT_BE_SILENTLY_ABANDONED - projection must reset when the background job terminates", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		const onBackgroundStateChange = vi.fn()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: [sleepCmd] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(typeof parsed.jobId).toBe("string")
			expect(parsed.jobId).toMatch(/^cmd_/)
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)
			expect(manager.activeCount).toBeGreaterThan(0)
			const jobId = parsed.jobId

			await waitForJobIdle(manager, jobId)
			expect(manager.activeCount).toBe(0)

			await new Promise((r) => setTimeout(r, 200))
			const calls = onBackgroundStateChange.mock.calls
			const sawTerminal = calls.some((args) => args[0] === false && args[1] === undefined)
			expect(sawTerminal).toBe(true)
		} finally {
			await manager.dispose()
		}
	})
})

// ===========================================================================
// ACL03 — NO_JOB_DONE_YIELDS_TO_USER (CPL conservation)
// ===========================================================================
// Control: fast command completes synchronously. No
// background orphan. The terminal stdout is returned to
// the agent inline. Conservation of
// COMPLETION-PROTOCOL-LIVENESS01.
//
describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL03", () => {
	it("NO_JOB_DONE_YIELDS_TO_USER - fast command completes synchronously, no orphaned job", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		const onBackgroundStateChange = vi.fn()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: [fastCmd] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result[0].result).toContain("done")
			expect(manager.activeCount).toBe(0)
		} finally {
			await manager.dispose()
		}
	})
})

// ===========================================================================
// ACL04 — INTENTIONAL_DETACH_TYPED_INTENT (REWRITTEN IN CORRECTION01)
// ===========================================================================
// Real-schema proof. The review of CORRECTION00 noted
// that the prior ACL04 inspected a self-authored dummy
// object and could not fail under any schema change.
//
// Real check here: build the production
// `createShellTool` and inspect the resulting
// `inputSchema` JSON Schema. The
// `additionalProperties: false` field is the
// load-bearing structural fact: there is no room for a
// typed `intent` field today. If a future change adds
// such a field (e.g. `properties.intent`), this test
// fails RED and the test author MUST update the
// dispatching contract accordingly.
//
// The test does NOT assert anything about runtime
// behavior. That is the job of the bigger picture; this
// is a TYPED-CONTRACT freeze.
//
describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL04", () => {
	it("INTENTIONAL_DETACH_TYPED_INTENT - production run_commands input schema has no typed intent field", () => {
		const tool = createShellTool(async () => "ok", {
			cwd: process.cwd(),
			bashTimeoutMs: 30_000,
		})
		expect(tool.name).toBe("run_commands")

		const schema = tool.inputSchema as Record<string, unknown>
		expect(schema.type).toBe("object")

		const properties = schema.properties as Record<string, unknown>
		expect(Object.keys(properties).sort()).toEqual(["commands"])

		const commands = properties.commands as Record<string, unknown>
		expect(commands.type).toBe("array")

		// The load-bearing assertion: the schema rejects all
		// fields except `commands`. A typed `intent` /
		// `detach` / `fire_and_forget` field is forbidden
		// by the schema itself.
		expect(schema.additionalProperties).toBe(false)
		expect((properties as Record<string, unknown>).intent).toBeUndefined()
		expect((properties as Record<string, unknown>).detach).toBeUndefined()
		expect((properties as Record<string, unknown>).fire_and_forget).toBeUndefined()
		expect((properties as Record<string, unknown>).background).toBeUndefined()
	})
})

// ===========================================================================
// ACL06 — TOOL_DESCRIPTION_CONTRACT (NEW IN CORRECTION01)
// ===========================================================================
// The model is told (by the tool's `description`) what
// to do for long-running commands. Inspect the
// production description verbatim and pin the contract:
//
//   "For long-running commands, run them in background
//    and redirect output to a tmp file that you can
//    read from later."
//
// This is "Contract X" (model-owned polling). The
// live screenshot — `run_commands → RUNNING → text
// response → awaiting_followup` — is the model
// EMITTING A TEXT RESPONSE because the tool
// description told it to redirect to a tmp file and
// move on. It is NOT the host losing the job.
//
// Future repair authoring MUST update both the schema
// AND this description, OR the description and the
// dispatch contract MUST be re-shaped so the new
// agreement is propagated to the model.
//
describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL06", () => {
	it("TOOL_DESCRIPTION_CONTRACT - production run_commands description tells the model how to handle long-running commands", () => {
		const tool = createShellTool(async () => "ok", {
			cwd: process.cwd(),
			bashTimeoutMs: 30_000,
		})
		expect(tool.name).toBe("run_commands")
		expect(typeof tool.description).toBe("string")

		// Load-bearing phrase in the contract.
		expect(tool.description).toContain("long-running")
		// Polling guidance (Contract X = model-owned).
		expect(tool.description).toMatch(/redirect.*tmp|poll|status/i)
		// The redirect-to-tmp-file contract is the
		// load-bearing sentence today.
		expect(tool.description).toContain("redirect output to a tmp file")
	})
})

// ===========================================================================
// ACL10 — TERMINAL_EVENT_CARDINALITY
// ===========================================================================
// Idempotence: `terminalPromise` resolves exactly once
// per job, regardless of how many `.then()` consumers
// are attached. This is the natural guard for any
// future successor-scheduling repair (Candidate B from
// ACT §29).
//
describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL10", () => {
	it("TERMINAL_EVENT_CARDINALITY - terminalPromise resolves exactly once per job", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		try {
			const result = await manager.start(
				{
					command: sleepCmd,
					cwd: process.cwd(),
					waitBudgetMs: 50,
					executionDeadlineMs: 30_000,
				},
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result.state).toBe("running")
			expect(result.terminalPromise).toBeDefined()

			let resolves = 0
			const onResolve = () => {
				resolves += 1
			}
			result.terminalPromise.then(onResolve)
			result.terminalPromise.then(() => {})
			result.terminalPromise.then(() => {})
			result.terminalPromise.then(() => {})

			await waitForJobIdle(manager, result.jobId)
			await result.terminalPromise

			for (let i = 0; i < 200; i += 1) {
				if (resolves >= 1) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(resolves).toBe(1)
		} finally {
			await manager.dispose()
		}
	})
})
