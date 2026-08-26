/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 *
 * C1 RED -- drive the REAL production seam end-to-end and prove
 * that NO marker today reaches `CommandJobManager.start(...)`.
 *
 * Real production seam exercised:
 *   createShellTool (REAL, re-exported by the vitest stub from
 *                   @cline/core source)
 *     -> createVscodeShellExecutor (REAL host adapter in
 *         apps/vscode/src/sdk/vscode-run-commands-tool.ts)
 *       -> CommandJobManager.start (REAL host class in
 *           apps/vscode/src/sdk/command-job-manager.ts)
 *
 * The test sets `context.metadata.executionCapability` to a
 * zero-privilege synthetic marker, drives `tool.execute(input,
 * context)`, and observes what `CommandJobManager.start` was called
 * with (via vi.spyOn).
 *
 * Synthetic marker shape:
 *   { correlationId: string, marker: "factory-binding-probe" }
 *
 * The marker carries ZERO filesystem/network authority. It exists
 * only so we can observe what reached the seam.
 *
 * The RED assertion is:
 *   spy.mock.calls[0][0].executionCapability === undefined
 * because today's `createVscodeShellExecutor` does NOT read
 * `context.metadata.executionCapability`.
 */

import type { AgentToolContext } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { CommandJobManager, DEFAULT_EXECUTION_DEADLINE_MS, DEFAULT_WAIT_BUDGET_MS } from "../command-job-manager"
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

interface SyntheticMarker {
	readonly correlationId: string
	readonly marker: "factory-binding-probe"
}

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C1 RED", () => {
	it("RED: synthetic marker in context.metadata.executionCapability does NOT reach CommandJobManager.start today", async () => {
		const manager = new CommandJobManager({
			// Force no-sandbox path; this ACT is transport-only.
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C1")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const marker: SyntheticMarker = {
			correlationId: "invocation-A-correlation-1",
			marker: "factory-binding-probe",
		}

		const context: AgentToolContext = {
			agentId: "binding-c1",
			iteration: 0,
			toolCallId: "tool-call-A",
			metadata: { executionCapability: marker },
		}

		await tool.execute({ command: "printf 'c1-red\\\\n'" }, context)

		// Wait for any in-flight jobs to settle so the spy is
		// fully populated.
		await new Promise((r) => setImmediate(r))

		// THE RED ASSERTION
		//   Today, no marker-bearing field is forwarded into
		//   manager.start(...). The spy captured the actual options
		//   the production adapter passed.
		expect(startSpy).toHaveBeenCalled()
		const firstCallOptions = startSpy.mock.calls[0]?.[0] as unknown as Record<string, unknown> | undefined
		expect(firstCallOptions).toBeDefined()
		expect(firstCallOptions!["executionCapability"]).toBeUndefined()
	})

	it("RED: second invocation without a marker also sees no executionCapability (negative case)", async () => {
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C1")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const context: AgentToolContext = {
			agentId: "binding-c1",
			iteration: 0,
			toolCallId: "tool-call-B",
			// No executionCapability key.
			metadata: {},
		}

		await tool.execute({ command: "printf 'c1-red-negative\\\\n'" }, context)

		await new Promise((r) => setImmediate(r))

		expect(startSpy).toHaveBeenCalled()
		const firstCallOptions = startSpy.mock.calls[0]?.[0] as unknown as Record<string, unknown> | undefined
		expect(firstCallOptions).toBeDefined()
		expect(firstCallOptions!["executionCapability"]).toBeUndefined()
	})

	it("RED: sanity -- the test seam does not leak the synthetic marker across invocations", async () => {
		// Both invocations above used independent `CommandJobManager`
		// instances and independent tools. There is no global mutable
		// state. This test documents the harness isolation as part of
		// the RED evidence -- if either invocation observed a marker
		// (false-positive), the RED assumption collapses.
		const managerA = new CommandJobManager({ sandboxBackendResolver: async () => undefined })
		const managerB = new CommandJobManager({ sandboxBackendResolver: async () => undefined })
		const spyA = vi.spyOn(managerA, "start")
		const spyB = vi.spyOn(managerB, "start")

		const toolA = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C1")
			},
			commandJobManager: managerA,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }
		const toolB = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C1")
			},
			commandJobManager: managerB,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const markerA: SyntheticMarker = {
			correlationId: "A",
			marker: "factory-binding-probe",
		}

		await toolA.execute(
			{ command: "printf 'A\\\\n'" },
			{
				agentId: "binding-c1",
				iteration: 0,
				toolCallId: "tool-call-A",
				metadata: { executionCapability: markerA },
			},
		)
		await toolB.execute(
			{ command: "printf 'B\\\\n'" },
			{
				agentId: "binding-c1",
				iteration: 0,
				toolCallId: "tool-call-B",
				metadata: {},
			},
		)

		await new Promise((r) => setTimeout(r, 50))

		// Both spies saw a call; both saw no executionCapability.
		expect(spyA).toHaveBeenCalled()
		expect(spyB).toHaveBeenCalled()
		const optsA = (spyA.mock.calls[0]?.[0] ?? {}) as unknown as Record<string, unknown>
		const optsB = (spyB.mock.calls[0]?.[0] ?? {}) as unknown as Record<string, unknown>
		expect(optsA["executionCapability"]).toBeUndefined()
		expect(optsB["executionCapability"]).toBeUndefined()
	})
})

// Pin the constants so the test imports match the production wiring.
void DEFAULT_EXECUTION_DEADLINE_MS
void DEFAULT_WAIT_BUDGET_MS
