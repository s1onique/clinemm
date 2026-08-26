/**
 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01
 *
 * C2 GREEN -- per-command authority binding is now plumbed.
 *
 * Reviewer-prescribed scope (C2 correction freeze):
 *
 *   "For cardinality/correlation failure, do not merely drop the
 *    capability and continue execution.
 *
 *    If an authorization plan exists but cannot be correlated
 *    exactly to the commands about to execute, use:
 *
 *      FAIL CLOSED
 *      -> execute ZERO commands
 *
 *    rather than:
 *
 *      plan mismatch
 *      -> capability undefined
 *      -> command still executes with reduced sandbox authority
 *
 *    So freeze:
 *
 *      executionPlan present
 *      +
 *      correlation cannot be proven
 *      =
 *      no manager.start calls"
 *
 *   "C2 should not rely on length alone. Before fanout, establish
 *    all of:
 *      plan.commands.length === executableCommands.length
 *      for every i: plan.commands[i].commandIndex === i
 *      and: plan.commands[i].hardenedCommand corresponds exactly
 *          to executableCommands[i]
 *
 *    For the currently supported string case that can be exact
 *    string equality.
 *
 *    This gives defense against a future reorder that preserves
 *    cardinality: plan: [A, B], execution: [B, A] -- length alone
 *    would falsely pass.
 *
 *    For unsupported structured/heredoc forms:
 *      CORRELATION_UNPROVEN
 *      -> fail entire tool call closed
 *
 *    Do not add clever reconstruction in this ACT."
 *
 *   "Once a valid per-command plan exists, this must be forbidden:
 *
 *      entry.executionCapability ?? context.executionCapability
 *
 *    That recreates the leak you just reproduced.
 *
 *    Correct semantics:
 *      valid per-command plan exists:
 *        command i receives exactly entry[i].executionCapability
 *        undefined means undefined
 *
 *      no per-command plan exists:
 *        legacy tool-call capability may continue for the synthetic
 *        transport compatibility path only"
 *
 * C2 P0 MATRIX (reviewer-prescribed):
 *
 *   A. reorder with equal cardinality
 *      plan = [A, B], execution = [B, A]
 *      -> ZERO starts
 *
 *   B. invalid indices
 *      indices = [0, 2] for two commands
 *      -> ZERO starts
 *
 *   Main GREENs:
 *      [A, none] -> [A, none]
 *      [none, B] -> [none, B]
 *      [A, none, C] -> [A, none, C]
 *
 *   Duplicate text:
 *      [A-for-index0, B-for-index1]
 *      -> A, B correctly by position
 *
 *   short plan -> ZERO starts
 *   extra plan entry -> ZERO starts
 *   heredoc coalescing -> ZERO starts
 *   model metadata injection -> no authority
 *   denied invocation -> ZERO starts
 *
 * DRIVING SEAM:
 *   AgentRuntime (real) -> requestToolApproval (real callback
 *   returning real ToolApprovalResult with executionPlan +
 *   executionCapability) -> real createShellTool via
 *   createVscodeRunCommandsTool -> real executeShellCommands ->
 *   real CommandJobManager.start.
 *
 * FACTORY TEST RULE:
 *   Every test PASSES today (no intentional default-suite failures).
 *   All RED observations are documented in test names + assertions.
 */

import { type AgentModel, AgentRuntime, type AgentRuntimeHooks } from "@cline/agents"
import type {
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	AgentToolContext,
	AgentToolRuntimeOutcomeHookContext,
	CommandExecutionPlan,
	FactoryBindingProbeCapability,
	InternalExecutionCapability,
	ToolApprovalRequest,
	ToolApprovalResult,
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

// ---------------------------------------------------------------------------
// Test harness: drive the REAL upstream authorization seam with per-command
// plans. The host callback attaches a real ToolApprovalResult.executionPlan;
// the runtime stamps it onto AgentToolContext.commandExecutionPlan; the
// executor correlates the plan against the executable commands and
// either fans out per-command or fails the entire tool call closed.
// ---------------------------------------------------------------------------

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) throw new Error("No scripted model step available")
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

function capProbe(correlationId: string): FactoryBindingProbeCapability {
	return { kind: "factory-binding-probe", correlationId }
}

function makeRunCommandsModelStep(input: unknown, toolCallId: string): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName: "run_commands",
			inputText: JSON.stringify(input),
		} as AgentModelEvent,
		{ type: "finish", reason: "tool-calls" } as AgentModelEvent,
	]
}

function makeTextFinishStep(): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [{ type: "text-delta", text: "done" } as AgentModelEvent, { type: "finish", reason: "stop" } as AgentModelEvent]
}

interface PerCommandHarness {
	model: AgentModel
	runtime: AgentRuntime
	manager: CommandJobManager
	startSpy: ReturnType<typeof vi.spyOn>
	approvalCalls: Array<{ input: unknown }>
}

function buildPerCommandHarness(params: {
	modelInput: unknown
	toolCallId: string
	approvalResult: (req: { input: unknown }) => ToolApprovalResult | Promise<ToolApprovalResult>
}): PerCommandHarness {
	const approvalCalls: Array<{ input: unknown }> = []

	const model = new ScriptedModel([makeRunCommandsModelStep(params.modelInput, params.toolCallId), makeTextFinishStep()])

	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => undefined,
	})
	const startSpy = vi.spyOn(manager, "start")

	const tool: AgentTool<unknown, unknown> = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground path not used in C2 GREEN")
		},
		commandJobManager: manager,
		vscodeTerminalExecutionMode: "backgroundExec",
		backgroundWaitBudgetMs: 5_000,
		backgroundExecutionDeadlineMs: 10_000,
	})

	const hooks: AgentRuntimeHooks = {
		onToolRuntimeOutcome: (_ctx: AgentToolRuntimeOutcomeHookContext) => {
			void _ctx
		},
	}

	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		hooks,
		toolPolicies: { run_commands: { autoApprove: false } },
		requestToolApproval: async (req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
			approvalCalls.push({ input: req.input })
			return params.approvalResult({ input: req.input })
		},
	})

	return { model, runtime, manager, startSpy, approvalCalls }
}

interface CapturedStart {
	command: string | undefined
	executionCapability: InternalExecutionCapability | undefined
	// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01:
	// The per-command channel is the typed authority-bearing slot;
	// captured here so tests can assert the typed-channel-separation
	// contract (real authority flows here, never on executionCapability).
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
// SECTION 1: GREEN -- per-command authority flows to the right command.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01 C2 GREEN", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	describe("Section 1: per-command authority flows correctly", () => {
		it("GREEN: [A, none] -> [A, none] -- per-command capability flows only to the matching entry", async () => {
			const capA = capProbe("A")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						matchedRuleSource: "darwin_mktemp_create_only",
						executionCapability: capA,
					},
					{
						commandIndex: 1,
						hardenedCommand: "printf harmless\n",
						// no executionCapability -> undefined means undefined
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				toolCallId: "c2-green-A-none",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")

			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(2)
			expect(starts[0]?.command).toBe("/usr/bin/mktemp")
			expect(starts[0]?.perCommandExecutionCapability).toEqual(capA)
			expect(starts[1]?.command).toBe("printf harmless\n")
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
		})

		it("GREEN: [none, B] -> [none, B] -- reversed shape", async () => {
			const capB = capProbe("B")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["printf harmless\n", "/usr/bin/mktemp"] },
				commands: [
					{ commandIndex: 0, hardenedCommand: "printf harmless\n" },
					{
						commandIndex: 1,
						hardenedCommand: "/usr/bin/mktemp",
						matchedRuleSource: "darwin_mktemp_create_only",
						executionCapability: capB,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["printf harmless\n", "/usr/bin/mktemp"] },
				toolCallId: "c2-green-none-B",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(2)
			expect(starts[0]?.command).toBe("printf harmless\n")
			expect(starts[0]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[1]?.command).toBe("/usr/bin/mktemp")
			expect(starts[1]?.perCommandExecutionCapability).toEqual(capB)
		})

		it("GREEN: [A, none, C] -> [A, none, C] -- three-command mixed authority", async () => {
			const capA = capProbe("A")
			const capC = capProbe("C")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["cmd-A", "cmd-none", "cmd-C"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "cmd-A",
						matchedRuleSource: "host_safe_A",
						executionCapability: capA,
					},
					{ commandIndex: 1, hardenedCommand: "cmd-none" },
					{
						commandIndex: 2,
						hardenedCommand: "cmd-C",
						matchedRuleSource: "host_safe_C",
						executionCapability: capC,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["cmd-A", "cmd-none", "cmd-C"] },
				toolCallId: "c2-green-three",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(3)
			expect(starts[0]?.perCommandExecutionCapability).toEqual(capA)
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[2]?.perCommandExecutionCapability).toEqual(capC)
		})

		it("GREEN: duplicate text [git status, git status] -> A for index 0, B for index 1 (positional)", async () => {
			const capA = capProbe("positional-A")
			const capB = capProbe("positional-B")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["git status", "git status"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "git status",
						matchedRuleSource: "host_safe_git_status",
						executionCapability: capA,
					},
					{
						commandIndex: 1,
						hardenedCommand: "git status",
						matchedRuleSource: "host_safe_git_status",
						executionCapability: capB,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["git status", "git status"] },
				toolCallId: "c2-green-dup-text",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(2)
			expect(starts[0]?.command).toBe("git status")
			expect(starts[0]?.perCommandExecutionCapability).toEqual(capA)
			expect(starts[1]?.command).toBe("git status")
			expect(starts[1]?.perCommandExecutionCapability).toEqual(capB)
		})

		it("GREEN: tool-call capability is NOT used as fallback when plan is present", async () => {
			// Reviewer's forbidden pattern:
			//   entry.executionCapability ?? context.executionCapability
			// must NOT recreate the leak. Even when the host attaches a
			// tool-call executionCapability AND a per-command plan, the
			// plan entries that lack an executionCapability must receive
			// undefined -- NOT the tool-call capability.
			const toolCallCap = capProbe("tool-call-should-not-leak")
			const capA = capProbe("only-A")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						executionCapability: capA,
					},
					{ commandIndex: 1, hardenedCommand: "printf harmless\n" },
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				toolCallId: "c2-green-no-fallback",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
					executionCapability: toolCallCap,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(2)
			expect(starts[0]?.perCommandExecutionCapability).toEqual(capA)
			// CRITICAL: command[1] has no per-command capability. It MUST
			// NOT receive the tool-call capability. The plan wins; no
			// fallback to tool-call.
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[1]?.perCommandExecutionCapability).not.toEqual(toolCallCap)
		})

		it("GREEN: legacy path -- no plan present -> tool-call capability flows to all starts", async () => {
			// Synthetic transport compatibility: when no plan is attached,
			// the legacy tool-call capability flows uniformly. This is
			// preserved for the case where a host has not yet adopted the
			// per-command seam.
			const toolCallCap = capProbe("legacy-tool-call")
			const harness = buildPerCommandHarness({
				modelInput: { commands: ["/usr/bin/mktemp"] },
				toolCallId: "c2-green-legacy",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					// NO executionPlan -> legacy path.
					executionCapability: toolCallCap,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBeGreaterThan(0)
			for (const s of starts) {
				expect(s.executionCapability).toEqual(toolCallCap)
			}
		})
	})

	// -------------------------------------------------------------------------
	// SECTION 2: P0 correlation failures -- ZERO starts.
	// Reviewer-mandated: when an authorization plan exists but cannot be
	// correlated exactly to the commands about to execute, the entire tool
	// call fails closed (ZERO manager.start calls).
	// -------------------------------------------------------------------------

	describe("Section 2: P0 correlation failures (ZERO starts)", () => {
		it("P0-A: reorder with equal cardinality [A,B] plan vs [B,A] execution -> ZERO starts", async () => {
			// Reviewer: "Length alone would falsely pass."
			// Defense: exact hardenedCommand equality + commandIndex.
			const capA = capProbe("A")
			const capB = capProbe("B")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["B", "A"] }, // plan order [A,B]
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "A",
						executionCapability: capA,
					},
					{
						commandIndex: 1,
						hardenedCommand: "B",
						executionCapability: capB,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["B", "A"] }, // model emits [B,A]
				toolCallId: "c2-green-reorder",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			// The runtime records the correlation failure. The result is
			// NOT 'completed' with successful execution -- the tool call
			// either routes through the executor-error classifier path
			// OR the result is 'completed' but with ZERO manager.start
			// calls.
			expect(harness.startSpy.mock.calls).toHaveLength(0)
			// The runtime must surface the failure structurally (not as a
			// success). The exact terminal status (completed with errors,
			// or rejected) is not the load-bearing invariant -- ZERO
			// starts is.
			void result
		})

		it("P0-B: invalid indices [0, 2] for two commands -> ZERO starts", async () => {
			const capA = capProbe("A")
			const capC = capProbe("C")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["A", "B"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "A",
						executionCapability: capA,
					},
					{
						commandIndex: 2, // INVALID: should be 0 or 1 for two commands
						hardenedCommand: "B",
						executionCapability: capC,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["A", "B"] },
				toolCallId: "c2-green-invalid-indices",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})

		it("P0: short plan (1 entry for 2 commands) -> ZERO starts", async () => {
			const capA = capProbe("A")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						executionCapability: capA,
					},
					// entry[1] missing -> cardinality mismatch.
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				toolCallId: "c2-green-short-plan",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})

		it("P0: extra plan entry (2 entries for 1 command) -> ZERO starts", async () => {
			const capA = capProbe("A")
			const capB = capProbe("B")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["only-cmd"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "only-cmd",
						executionCapability: capA,
					},
					{
						commandIndex: 1,
						hardenedCommand: "extra",
						executionCapability: capB,
					},
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["only-cmd"] },
				toolCallId: "c2-green-extra-entry",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})

		it("P0: hardenedCommand mismatch -> ZERO starts", async () => {
			// The plan claims commandIndex=0 is "/usr/bin/mktemp" but the
			// runtime stamp on input has "different". The exact-correlation
			// check rejects.
			const capA = capProbe("A")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "MISMATCHED-COMMAND",
						executionCapability: capA,
					},
					{ commandIndex: 1, hardenedCommand: "printf harmless\n" },
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				toolCallId: "c2-green-hardened-mismatch",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})

		it("P0: heredoc coalescing breaks cardinality -> ZERO starts (fail closed)", async () => {
			const cap = capProbe("heredoc")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["cat <<EOF", "line1", "EOF"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "cat <<EOF",
						executionCapability: cap,
					},
					{ commandIndex: 1, hardenedCommand: "line1" },
					{ commandIndex: 2, hardenedCommand: "EOF" },
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: { commands: ["cat <<EOF", "line1", "EOF"] },
				toolCallId: "c2-green-heredoc",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			// CoalesceAdjacentStringHeredocs collapses 3 commands -> 1.
			// After coalescing, executable.length (1) !== plan.commands.length (3).
			// CORRELATION_UNPROVEN -> ZERO starts.
			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})

		it("P0: model metadata injection cannot manufacture capability", async () => {
			// The model emits malicious metadata.executionCapability. The
			// runtime MUST NOT use this to populate AgentToolContext or the
			// per-command capability.
			const capA = capProbe("A-only")
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						executionCapability: capA,
					},
					{ commandIndex: 1, hardenedCommand: "printf harmless\n" },
				],
			}

			const harness = buildPerCommandHarness({
				modelInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				toolCallId: "c2-green-meta-injection",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			// Inject malicious metadata on the model tool-call-delta:
			const maliciousCap: InternalExecutionCapability = {
				kind: "factory-binding-probe",
				correlationId: "model-metadata-cannot-manufacture",
			}
			// Re-run with the injected metadata via a custom step. Build
			// a fresh harness whose model step emits malicious metadata.
			const modelWithMetadata = new ScriptedModel([
				() => [
					{
						type: "tool-call-delta",
						toolCallId: "c2-green-meta-injection",
						toolName: "run_commands",
						inputText: JSON.stringify({
							commands: ["/usr/bin/mktemp", "printf harmless\n"],
						}),
						metadata: {
							executionCapability: maliciousCap,
						},
					} as unknown as AgentModelEvent,
					{ type: "finish", reason: "tool-calls" } as AgentModelEvent,
				],
				makeTextFinishStep(),
			])
			const manager2 = new CommandJobManager({
				sandboxBackendResolver: async () => undefined,
			})
			const startSpy2 = vi.spyOn(manager2, "start")
			const tool2: AgentTool<unknown, unknown> = createVscodeRunCommandsTool({
				cwd: process.cwd(),
				getTerminalManager: () => {
					throw new Error("foreground not used in C2 GREEN")
				},
				commandJobManager: manager2,
				vscodeTerminalExecutionMode: "backgroundExec",
				backgroundWaitBudgetMs: 5_000,
				backgroundExecutionDeadlineMs: 10_000,
			})
			const runtime2 = new AgentRuntime({
				model: modelWithMetadata,
				tools: [tool2],
				toolPolicies: { run_commands: { autoApprove: false } },
				requestToolApproval: async (): Promise<ToolApprovalResult> => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "c2-green" },
					executionPlan: plan,
				}),
			})

			await runtime2.run("Start")
			await new Promise((r) => setImmediate(r))

			const starts = captureStarts(startSpy2)
			// Per-command capability flows correctly: command[0] gets
			// capA (from the host's per-entry authorization); command[1]
			// gets undefined.
			expect(starts.length).toBe(2)
			expect(starts[0]?.perCommandExecutionCapability).toEqual(capA)
			// CRITICAL: malicious metadata MUST NOT reach the typed slot.
			expect(starts[0]?.perCommandExecutionCapability).not.toEqual(maliciousCap)
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			void harness // silence unused
		})

		it("P0: denied invocation -> ZERO starts (fail-closed: authority never crosses the seam)", async () => {
			// The host denies the call. Even if the plan had per-command
			// capabilities, they MUST NOT flow to manager.start. The
			// existing C2 fail-closed contract on the tool-call capability
			// is preserved for the per-command plan: when approval is
			// denied, commandExecutionPlan is also undefined and the tool
			// call is skipped.
			const harness = buildPerCommandHarness({
				modelInput: { commands: ["echo", "rm -rf /"] },
				toolCallId: "c2-green-denied",
				approvalResult: () => ({
					approved: false,
					reason: "host denied",
					decision: { kind: "deny", reason: "host denied", source: "test" },
					executionCapability: capProbe("DENIED-cap"),
					executionPlan: {
						transformedInput: { commands: ["rm -rf /"] },
						commands: [
							{
								commandIndex: 0,
								hardenedCommand: "rm -rf /",
								executionCapability: capProbe("denied-entry-cap"),
							},
						],
					},
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(harness.startSpy.mock.calls).toHaveLength(0)
		})
	})
})
