/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION02
 *
 * BOUNDED RUNTIME GUARD ADDITION.
 *
 * Reviewer of the CORRECTION01 commit observed that the typed-channel
 * separation is type-correct but lacks a runtime guard on the no-plan
 * branch:
 *
 *   "the correction introduces one new P0 at the runtime boundary.
 *
 *    However, look at the no-plan branch in executeShellCommands:
 *
 *      const perCommandContext: AgentToolContext =
 *        perCommandCaps !== null
 *          ? { ...context, executionCapability: undefined,
 *              perCommandExecutionCapability: perCommandCaps[i] }
 *          : context
 *
 *    When there is no correlated plan, the original context is forwarded
 *    unchanged. And AgentToolContext now legally contains:
 *      perCommandExecutionCapability?: InternalExecutionCapability
 *    including:
 *      filesystem-create-only
 *
 *    Then CommandJobManager.start() explicitly prioritizes that field:
 *      const jobExecutionCapability =
 *        context?.perCommandExecutionCapability !== undefined
 *          ? context.perCommandExecutionCapability
 *          : context?.executionCapability
 *
 *    So this is representable at runtime:
 *
 *      commandExecutionPlan = undefined
 *      context.perCommandExecutionCapability =
 *        filesystem-create-only(DARWIN_TEMP)
 *              ↓
 *      executeShellCommands
 *        perCommandCaps === null
 *        -> passes context unchanged
 *              ↓
 *      CommandJobManager.start
 *        -> consumes filesystem-create-only
 *
 *    That bypasses the exact invariant we need:
 *      Real authority requires a successfully correlated per-command
 *      execution plan."
 *
 * BOUNDED FIX (reviewer-prescribed, smallest change):
 *
 *   Add to the pre-fanout guard at the executor boundary:
 *
 *     if (perCommandCaps === null) {
 *       if (context.executionCapability !== undefined &&
 *           context.executionCapability.kind !== "factory-binding-probe") {
 *         throw new Error(
 *           "real_execution_capability_requires_per_command_plan",
 *         );
 *       }
 *
 *       if (context.perCommandExecutionCapability !== undefined) {
 *         throw new Error(
 *           "per_command_execution_capability_requires_correlated_plan",
 *         );
 *       }
 *     }
 *
 *   Note: the second condition rejects ANY
 *   perCommandExecutionCapability without a plan, including
 *   factory-binding-probe. The meaning of that field is specifically
 *   "derived from a correlated per-command plan", so there is no
 *   legitimate no-plan case.
 *
 * FROZEN INVARIANT:
 *   perCommandExecutionCapability present
 *   + no successfully correlated commandExecutionPlan
 *   = ZERO starts
 *
 * TEST SEAM:
 *
 *   The cleanest seam is to call `tool.execute(input, context)` on the
 *   production `createVscodeRunCommandsTool` with a forged
 *   `AgentToolContext`. The tool's `.execute` is a closure that calls
 *   `executeShellCommands(commands, { executor, cwd, context, ... })`.
 *   The runtime guard at the executor boundary fires before any
 *   `manager.start` call. ZERO starts means the guard fired.
 *
 *   The previous harness-based tests used the full AgentRuntime +
 *   ScriptedModel stack. For this test we bypass the harness and call
 *   the tool's `.execute` directly because:
 *     - We want to PROVE the runtime guard fires for a forged
 *       `perCommandExecutionCapability` -- a value that the
 *       AgentRuntime NEVER stamps on its own (so it cannot be forged
 *       via the harness's approval callback).
 *     - Direct `tool.execute` invocation is the deepest seam at
 *       which the new guard is observable.
 *     - We assert ZERO starts on the `CommandJobManager.start` spy
 *     (which would be called by the tool's underlying
 *      `createVscodeShellExecutor`).
 *
 * No new Seatbelt recon. No metadata architecture pass.
 */

import {
	type AgentTool,
	type AgentToolContext,
	type CommandExecutionPlan,
	type FactoryBindingProbeCapability,
	type FilesystemCreateOnlyCapability,
	type InternalExecutionCapability,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

const DARWIN_USER_TEMP_ROOT = "/var/folders/c_/T"

function capProbe(correlationId: string): FactoryBindingProbeCapability {
	return { kind: "factory-binding-probe", correlationId }
}

interface GuardHarness {
	tool: AgentTool<unknown, unknown>
	manager: CommandJobManager
	startSpy: ReturnType<typeof vi.spyOn>
}

/**
 * Builds a tool whose `execute` closure routes through the production
 * `executeShellCommands` -> `createVscodeShellExecutor` -> manager.start
 * path. We exercise the executor-boundary guard by calling
 * `tool.execute(input, context)` directly with various forged contexts.
 */
function buildGuardHarness(): GuardHarness {
	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => undefined,
	})
	const startSpy = vi.spyOn(manager, "start")

	const tool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground path not used in CORRECTION02")
		},
		commandJobManager: manager,
		vscodeTerminalExecutionMode: "backgroundExec",
		backgroundWaitBudgetMs: 5_000,
		backgroundExecutionDeadlineMs: 10_000,
	})

	return { tool, manager, startSpy }
}

interface CapturedStart {
	command: string | undefined
	executionCapability: InternalExecutionCapability | undefined
	perCommandExecutionCapability: InternalExecutionCapability | undefined
}

function captureStarts(startSpy: ReturnType<typeof vi.spyOn>): CapturedStart[] {
	return startSpy.mock.calls.map((args: unknown[]) => {
		const opts = args[0] as { command?: unknown }
		const ctx = args[1] as AgentToolContext | undefined
		return {
			command: typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command),
			executionCapability: ctx?.executionCapability,
			perCommandExecutionCapability: ctx?.perCommandExecutionCapability,
		}
	})
}

// ---------------------------------------------------------------------------
// REVIEWER-MANDATED DISCRIMINATORS
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION02 plan-required guard", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	// -------------------------------------------------------------------------
	// D1 (kept): no plan + filesystem-create-only forged into LEGACY field
	// -> ZERO starts. The legacy guard (real_execution_capability_requires_per_command_plan)
	// has been in place since the GUARD commit and remains in this CORRECTION02.
	// -------------------------------------------------------------------------
	describe("D1 (kept): no plan + filesystem-create-only via LEGACY field -> ZERO starts", () => {
		it("legacy executionCapability forged with filesystem-create-only -> ZERO starts (legacy guard fires)", async () => {
			const realCap: InternalExecutionCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}

			const { tool, startSpy } = buildGuardHarness()

			const forgedContext: AgentToolContext = {
				agentId: "test-agent",
				iteration: 0,
				// BYPASS type split (test only). The legacy field is
				// typed ToolCallExecutionCapability, so we cast through unknown.
				executionCapability: realCap as unknown as AgentToolContext["executionCapability"],
				// NO commandExecutionPlan -> legacy path triggered.
				// perCommandExecutionCapability undefined -> new guard does not fire here.
			}

			await expect(tool.execute({ commands: ["/usr/bin/mktemp"] }, forgedContext)).rejects.toThrow(
				/real_execution_capability_requires_per_command_plan/,
			)

			const starts = captureStarts(startSpy)
			expect(starts).toHaveLength(0)
		})
	})

	// -------------------------------------------------------------------------
	// D1b (NEW, reviewer-mandated): no plan + filesystem-create-only forged
	// into PER-COMMAND field -> ZERO starts. This is the P0 the
	// CORRECTION01 left open and the CORRECTION02 closes.
	// -------------------------------------------------------------------------
	describe("D1b (NEW): no plan + filesystem-create-only via PER-COMMAND field -> ZERO starts", () => {
		it("perCommandExecutionCapability forged with filesystem-create-only, no plan -> ZERO starts (new guard fires)", async () => {
			const realCap: InternalExecutionCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}

			const { tool, startSpy } = buildGuardHarness()

			const forgedContext: AgentToolContext = {
				agentId: "test-agent",
				iteration: 0,
				// BYPASS type split (test only). The per-command field
				// is typed InternalExecutionCapability so we don't need
				// a cast here -- but the GUARD requires it not arrive
				// without a plan.
				perCommandExecutionCapability: realCap,
				// NO commandExecutionPlan -> new guard must fire.
			}

			await expect(tool.execute({ commands: ["/usr/bin/mktemp"] }, forgedContext)).rejects.toThrow(
				/per_command_execution_capability_requires_correlated_plan/,
			)

			const starts = captureStarts(startSpy)
			// The new guard fires BEFORE the executor runs; the shell
			// executor never gets to call manager.start. Therefore ZERO
			// starts.
			expect(starts).toHaveLength(0)
		})

		it("perCommandExecutionCapability forged with factory-binding-probe, no plan -> ZERO starts (probe on per-command channel is also a forgery)", async () => {
			// Reviewer-prescribed: "the second condition should reject
			// ANY perCommandExecutionCapability without a plan, including
			// factory-binding-probe. The meaning of that field is
			// specifically 'derived from a correlated per-command plan',
			// so there is no legitimate no-plan case."
			const probe: InternalExecutionCapability = capProbe("correction02-d1b-probe-forgery")

			const { tool, startSpy } = buildGuardHarness()

			const forgedContext: AgentToolContext = {
				agentId: "test-agent",
				iteration: 0,
				perCommandExecutionCapability: probe,
				// NO commandExecutionPlan.
			}

			await expect(tool.execute({ commands: ["/usr/bin/mktemp"] }, forgedContext)).rejects.toThrow(
				/per_command_execution_capability_requires_correlated_plan/,
			)

			const starts = captureStarts(startSpy)
			expect(starts).toHaveLength(0)
		})
	})

	// -------------------------------------------------------------------------
	// Negative control (NEW, reviewer-mandated): no plan + executionCapability
	// = factory-binding-probe + perCommandExecutionCapability = undefined
	// -> legacy execution preserved.
	// -------------------------------------------------------------------------
	describe("Negative control: no plan + legacy probe -> legacy preserved", () => {
		it("no plan + factory probe -> ZERO starts (legacy path; per-command channel undefined)", async () => {
			// Negative control: when perCommandExecutionCapability is
			// undefined, neither guard fires. The legacy tool-call
			// capability flows through uniformly.
			const probe = capProbe("correction02-negative-control")

			const { tool, startSpy } = buildGuardHarness()

			const forgedContext: AgentToolContext = {
				agentId: "test-agent",
				iteration: 0,
				executionCapability: probe,
				// NO commandExecutionPlan -> legacy path.
				// perCommandExecutionCapability undefined.
			}

			await expect(
				tool.execute({ commands: ["/usr/bin/mktemp", "printf harmless\n"] }, forgedContext),
			).resolves.toBeDefined()

			const starts = captureStarts(startSpy)
			expect(starts.length).toBe(2)

			// Legacy channel carries the probe uniformly.
			for (const s of starts) {
				expect(s.executionCapability).toEqual(probe)
				// Per-command channel stays undefined on the legacy path.
				expect(s.perCommandExecutionCapability).toBeUndefined()
			}
		})
	})

	// -------------------------------------------------------------------------
	// Plan control (kept): valid correlated plan + entry[0].filesystem-create-only
	// -> job[0].perCommandExecutionCapability = fs-cap; job[1] = undefined.
	// The tool.execute with commandExecutionPlan routes through the
	// stamping logic in executeShellCommands which sets
	// perCommandExecutionCapability on the per-command context.
	// -------------------------------------------------------------------------
	describe("Plan control: valid correlated plan -> flows correctly on per-command channel", () => {
		it("plan [fs-create-only, undefined] -> start[0] real on per-command channel; start[1] undefined", async () => {
			const realCap: FilesystemCreateOnlyCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						matchedRuleSource: "darwin_mktemp_create_only",
						executionCapability: realCap,
					},
					{
						commandIndex: 1,
						hardenedCommand: "printf harmless\n",
						// executionCapability undefined.
					},
				],
			}

			const { tool, startSpy } = buildGuardHarness()

			await expect(
				tool.execute(
					{ commands: ["/usr/bin/mktemp", "printf harmless\n"] },
					{ agentId: "test-agent", iteration: 0, commandExecutionPlan: plan },
				),
			).resolves.toBeDefined()

			const starts = captureStarts(startSpy)
			expect(starts.length).toBe(2)

			// start[0]: real filesystem-create-only on per-command channel;
			//           legacy channel CLEARED.
			expect(starts[0]?.command).toBe("/usr/bin/mktemp")
			expect(starts[0]?.perCommandExecutionCapability).toEqual(realCap)
			expect(starts[0]?.executionCapability).toBeUndefined()

			// start[1]: both channels undefined.
			expect(starts[1]?.command).toBe("printf harmless\n")
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[1]?.executionCapability).toBeUndefined()
		})
	})

	// -------------------------------------------------------------------------
	// Frozen invariant regression test (NEW, reviewer-prescribed): any
	// non-undefined perCommandExecutionCapability without a correlated plan
	// yields ZERO starts. This is the broadest possible regression test.
	// -------------------------------------------------------------------------
	describe("Frozen invariant: perCommandExecutionCapability + no plan = ZERO starts", () => {
		it("rejects every legitimate-looking per-command capability kind without a plan", async () => {
			const allKinds: InternalExecutionCapability[] = [
				{ kind: "filesystem-create-only", roots: [DARWIN_USER_TEMP_ROOT] },
				capProbe("forgery-probe"),
				// Add new InternalExecutionCapability kinds here as the
				// union grows -- the invariant must hold for every kind.
			]

			for (const forged of allKinds) {
				const { tool, startSpy } = buildGuardHarness()

				const forgedContext: AgentToolContext = {
					agentId: "test-agent",
					iteration: 0,
					perCommandExecutionCapability: forged,
					// NO commandExecutionPlan.
				}

				await expect(tool.execute({ commands: ["/usr/bin/mktemp"] }, forgedContext)).rejects.toThrow(
					/per_command_execution_capability_requires_correlated_plan/,
				)

				const starts = captureStarts(startSpy)
				expect(starts, `kind=${forged.kind}`).toHaveLength(0)
			}
		})
	})
})
