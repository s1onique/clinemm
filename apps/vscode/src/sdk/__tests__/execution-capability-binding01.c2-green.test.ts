/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 *
 * C2 GREEN -- Downstream half: typed slot now crosses the seam.
 *
 * Drives the REAL production chain end-to-end:
 *
 *   createShellTool (REAL, re-exported by the vitest stub from
 *                   @cline/core source)
 *     -> createVscodeShellExecutor (REAL host adapter in
 *         apps/vscode/src/sdk/vscode-run-commands-tool.ts)
 *       -> CommandJobManager.start (REAL host class in
 *           apps/vscode/src/sdk/command-job-manager.ts)
 *
 * The test sets `context.executionCapability` (the new CLOSED typed
 * slot -- NOT `context.metadata.executionCapability`) to the
 * synthetic marker, drives `tool.execute(input, context)`, and
 * asserts that `CommandJobManager.start(options, context)` was called
 * with the marker stamped onto the job record's
 * `executionCapability` field.
 *
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01-C2:
 * the C1 RED is now C2 GREEN. The same test that proved the seam
 * was missing now proves the seam is wired correctly through the
 * typed slot.
 */

import type { AgentToolContext, InternalExecutionCapability } from "@cline/shared"
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

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C2 GREEN (downstream)", () => {
	it("GREEN: typed-slot executionCapability in context DOES reach CommandJobManager.start(...)", async () => {
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const marker: InternalExecutionCapability = {
			kind: "factory-binding-probe",
			correlationId: "invocation-A-correlation-1",
		}

		const context: AgentToolContext = {
			agentId: "binding-c2",
			iteration: 0,
			toolCallId: "tool-call-A",
			// THE NEW TYPED SLOT, not metadata.
			executionCapability: marker,
		}

		await tool.execute({ command: "printf 'c2-green\\n'" }, context)

		await new Promise((r) => setImmediate(r))

		// THE GREEN ASSERTION: the marker-bearing typed slot reaches
		// the manager.start call (via the AgentToolContext argument).
		// The first arg (options) is the legacy start-command-job
		// payload; the second arg (context) carries the typed slot.
		// The manager copies context.executionCapability onto the
		// internal CommandJob record (NOT on the public snapshot,
		// per the CORRECTION02 P1 fix that removed it from public
		// surfaces before real capability variants land).
		expect(startSpy).toHaveBeenCalled()
		const callArgs = startSpy.mock.calls[0]
		expect(callArgs).toBeDefined()
		const ctxArg = callArgs?.[1] as AgentToolContext | undefined
		expect(ctxArg).toBeDefined()
		expect(ctxArg!.executionCapability).toEqual(marker)
	})

	it("GREEN negative: NO marker in context -> NO marker in manager.start options", async () => {
		const manager = new CommandJobManager({
			sandboxBackendResolver: async () => undefined,
		})
		const startSpy = vi.spyOn(manager, "start")

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const context: AgentToolContext = {
			agentId: "binding-c2",
			iteration: 0,
			toolCallId: "tool-call-B",
			// No executionCapability.
		}

		await tool.execute({ command: "printf 'c2-green-neg\\n'" }, context)

		await new Promise((r) => setImmediate(r))

		expect(startSpy).toHaveBeenCalled()
		const ctxArg = startSpy.mock.calls[0]?.[1] as AgentToolContext | undefined
		expect(ctxArg).toBeDefined()
		expect(ctxArg!.executionCapability).toBeUndefined()
	})

	it("GREEN: harness isolation -- two independent managers/tools see their own state", async () => {
		// The reviewer flagged the original C1 third test as harness
		// isolation, NOT concurrency. Same-runtime concurrency is in
		// the upstream test file (c2-green-upstream.test.ts). This
		// test remains a conservation witness.
		const managerA = new CommandJobManager({ sandboxBackendResolver: async () => undefined })
		const managerB = new CommandJobManager({ sandboxBackendResolver: async () => undefined })
		const spyA = vi.spyOn(managerA, "start")
		const spyB = vi.spyOn(managerB, "start")

		const toolA = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2")
			},
			commandJobManager: managerA,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }
		const toolB = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("foreground path not used in C2")
			},
			commandJobManager: managerB,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown> }

		const markerA: InternalExecutionCapability = {
			kind: "factory-binding-probe",
			correlationId: "A",
		}

		await toolA.execute(
			{ command: "printf 'A\\n'" },
			{
				agentId: "binding-c2",
				iteration: 0,
				toolCallId: "tool-call-A",
				executionCapability: markerA,
			},
		)
		await toolB.execute(
			{ command: "printf 'B\\n'" },
			{
				agentId: "binding-c2",
				iteration: 0,
				toolCallId: "tool-call-B",
				// No executionCapability on B.
			},
		)

		await new Promise((r) => setTimeout(r, 50))

		expect(spyA).toHaveBeenCalled()
		expect(spyB).toHaveBeenCalled()
		const ctxA = spyA.mock.calls[0]?.[1] as AgentToolContext
		const ctxB = spyB.mock.calls[0]?.[1] as AgentToolContext
		expect(ctxA.executionCapability).toEqual(markerA)
		expect(ctxB.executionCapability).toBeUndefined()
	})
})
