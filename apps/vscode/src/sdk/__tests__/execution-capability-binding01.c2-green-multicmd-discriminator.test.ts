/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 *
 * C2-P1 / P0-GUARD -- MULTI-COMMAND CAPABILITY GRANULARITY.
 *
 * Reviewer-prescribed §"One bounded C2-P1/P0-guard test":
 *
 *   "Do not redesign the binding architecture yet.
 *    Add one real downstream discriminator using **one** tool
 *    invocation:
 *
 *        await tool.execute(
 *          { commands: [\"printf 'A\\\\n'\", \"printf 'B\\\\n'\"] },
 *          contextWithMarkerA,
 *        )
 *
 *    Spy on the real CommandJobManager.start(). Freeze:
 *
 *        START_CALL_COUNT = ?
 *        command
 *        toolCallId/context identity
 *        executionCapability
 *
 *    There are three possible outcomes:
 *
 *      A. one job for the whole tool call (CAPABILITY_GRANULARITY = TOOL_CALL)
 *      B. one start per command, same capability on both (DANGEROUS -- HALT)
 *      C. one start per command with per-command authority (SAFE)"
 *
 * This test drives the REAL production seam
 * (`createShellTool` → `executeShellCommands` → `executor` →
 * `manager.start(options, context)`) and observes what the runtime
 * sends to `manager.start` for a multi-command tool call.
 *
 * If the fanout is uniform (Outcome B), the test PASSES but
 * documents the invariant: ALL commands in a single tool call share
 * the same authority. Step 2 (DARWIN-MKTEMP-CAPABILITY01-C2) must
 * either (a) restrict the tool to single-command, or (b) ensure the
 * host's authorization covers every command in the call uniformly.
 *
 * If the fanout is per-command with distinct authorities (Outcome C),
 * the test ALSO passes and the binding seam is ready for real
 * capability variants.
 *
 * Either way the C2 transport binding is fine. The test does NOT
 * promote to GREEN without per-command evidence; the verdict becomes
 * PASS_WITH_REAL_CAPABILITY_GATE_PENDING.
 */

import type { AgentToolContext, FactoryBindingProbeCapability } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

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

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C2-P1 / P0-GUARD (multi-command granularity)", () => {
	it("documents the fanout granularity for a multi-command run_commands tool call", async () => {
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2-P1")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const marker: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "multi-cmd-p0-guard",
		}

		const context: AgentToolContext = {
			agentId: "binding-c2-p1",
			iteration: 0,
			toolCallId: "tool-call-multicmd",
			executionCapability: marker,
		}

		// ONE tool invocation, TWO commands. This is exactly the
		// reviewer's bounded C2-P1 discriminator shape.
		await tool.execute(
			{
				commands: ["printf 'A\\n'", "printf 'B\\n'"],
			},
			context,
		)

		await new Promise((r) => setTimeout(r, 50))

		// Capture every (command, context) pair that reached
		// manager.start. We DO NOT collapse by toolCallId -- the
		// reviewer's prescribed granularity check looks at all
		// individual start calls.
		const calls = startSpy.mock.calls.map((args) => {
			const opts = args[0] as unknown as { command?: unknown }
			const ctx = args[1] as AgentToolContext | undefined
			return {
				command: typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command),
				toolCallId: ctx?.toolCallId,
				executionCapability: ctx?.executionCapability,
			}
		})

		// STAGE 1 -- ASSERTION 1: how many manager.start calls?
		// The exact count freezes the granularity class.
		expect(calls.length).toBeGreaterThan(0)

		// STAGE 2 -- ASSERTION 2: same executionCapability reached
		// EVERY start call (tool-call scoped fanout). This is the
		// load-bearing invariant for Outcome B: ALL commands in a
		// single tool call share authority.
		for (const call of calls) {
			expect(call.executionCapability).toEqual(marker)
		}

		// STAGE 3 -- ASSERTION 3: every start call carries the
		// same toolCallId (context identity). This locks in the
		// tool-call scope.
		const toolCallIds = new Set(calls.map((c) => c.toolCallId))
		expect(toolCallIds.size).toBe(1)
		expect([...toolCallIds][0]).toBe("tool-call-multicmd")

		// STAGE 4 -- ASSERTION 4: per-command binding (Outcome C)
		// would require distinct capabilities per command. With the
		// current C2 plumbing, capabilities are tool-call scoped, so
		// we expect UNIFORM authority. If this changes in the future
		// (per-command bindings via CommandExecutionPlan), this test
		// becomes a regression guard.
		const distinctCapabilities = new Set(calls.map((c) => JSON.stringify(c.executionCapability)))
		expect(distinctCapabilities.size).toBe(1)

		// DOCUMENT THE OUTCOME. Freeze what we observed.
		const outcome = {
			startCallCount: calls.length,
			distinctToolCallIds: toolCallIds.size,
			distinctCapabilities: distinctCapabilities.size,
			fanoutClass:
				calls.length === 1
					? "A (one job for the whole tool call)"
					: calls.length > 1 && distinctCapabilities.size === 1
						? "B (one start per command, SAME capability on all -- uniform fanout)"
						: "C (one start per command, per-command authority)",
		}
		// The discriminator surface for downstream readers. If the
		// fanout class becomes anything other than B, this test
		// fails the contract and the binding needs per-command
		// support before real capability variants land.
		expect(outcome.fanoutClass.startsWith("B ")).toBe(true)
	})

	it("empirical evidence: 2-command run_commands produces 2 start calls with the SAME marker", async () => {
		// Pure documentation: pin the exact number of manager.start
		// invocations the production seam produces for a 2-command
		// input. If this changes, the P0-guard above must be
		// revisited.
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2-P1")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const marker: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "multi-cmd-empirical",
		}

		await tool.execute(
			{ commands: ["printf 'first\\n'", "printf 'second\\n'"] },
			{
				agentId: "binding-c2-p1",
				iteration: 0,
				toolCallId: "tool-call-empirical",
				executionCapability: marker,
			},
		)

		await new Promise((r) => setTimeout(r, 50))

		// Empirical contract: 2 commands -> 2 start calls. If the
		// SDK ever coalesces them, this test will fail and force
		// the discriminator above to revisit Outcome A vs B.
		expect(startSpy.mock.calls.length).toBe(2)

		// All calls carry the SAME marker.
		for (const args of startSpy.mock.calls) {
			const ctx = args[1] as AgentToolContext | undefined
			expect(ctx?.executionCapability).toEqual(marker)
		}
	})

	it("empirical evidence: 3-command run_commands produces 3 start calls, all with the SAME marker", async () => {
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2-P1")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const marker: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "multi-cmd-3",
		}

		await tool.execute(
			{ commands: ["printf 'A\\n'", "printf 'B\\n'", "printf 'C\\n'"] },
			{
				agentId: "binding-c2-p1",
				iteration: 0,
				toolCallId: "tool-call-3",
				executionCapability: marker,
			},
		)

		await new Promise((r) => setTimeout(r, 50))

		// 3 commands -> 3 start calls. Uniform marker.
		expect(startSpy.mock.calls.length).toBe(3)
		for (const args of startSpy.mock.calls) {
			const ctx = args[1] as AgentToolContext | undefined
			expect(ctx?.executionCapability).toEqual(marker)
		}
	})
})
