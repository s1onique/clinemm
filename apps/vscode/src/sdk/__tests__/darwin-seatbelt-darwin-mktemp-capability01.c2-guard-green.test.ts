/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
 *
 * C2 GUARD -- type split + runtime guard.
 *
 * Reviewer-prescribed scope (verbatim):
 *
 *   Today this legacy path remains intentionally supported:
 *     no commandExecutionPlan -> context.executionCapability
 *     -> every command in run_commands.
 *
 *   That's currently harmless because InternalExecutionCapability
 *   contains only the zero-authority
 *   { kind: 'factory-binding-probe', correlationId: string }.
 *
 *   But the planned Darwin ACT will widen the same union with
 *   something like:
 *   { kind: 'filesystem-create-only', roots: readonly string[] }
 *
 *   At that moment the existing legacy tool-call channel becomes
 *   capable, by type, of transporting real filesystem authority.
 *
 *   Then this would be representable:
 *     ToolApprovalResult.executionCapability =
 *       filesystem-create-only(DARWIN_TEMP)
 *     executionPlan = absent
 *     run_commands: ['/usr/bin/mktemp', 'arbitrary second command']
 *     -> both jobs receive real create-only authority
 *
 *   That would resurrect exactly the fanout problem we just repaired.
 *
 *   Classification: CURRENT CODE: safe (only synthetic marker).
 *   NEXT UNION WIDENING WITHOUT GUARD: P0 -- real authority can
 *   enter tool-call legacy fanout.
 *
 *   So make this the first acceptance condition of Darwin C2.
 *
 * Required RED/GREEN matrix (verbatim):
 *
 *   no plan + factory-binding-probe     -> legacy behavior PASS
 *   no plan + filesystem-create-only    -> ZERO starts / fail closed
 *   valid plan [fs-create-only, none]    -> job[0] real, job[1] none
 *
 * Implementation contract:
 *
 *   1. Type split (compile-time defense):
 *      - ToolCallExecutionCapability = factory-binding-probe only
 *      - ToolApprovalResult.executionCapability: ToolCallExecutionCapability
 *      - AgentToolContext.executionCapability:   ToolCallExecutionCapability
 *      - PreparedToolExecution.executionCapability: ToolCallExecutionCapability
 *      - InternalExecutionCapability = full union (factory-binding-probe
 *        + filesystem-create-only)
 *      - CommandExecutionPlanEntry.executionCapability: InternalExecutionCapability
 *
 *   2. Runtime guard (actual security boundary):
 *      Before legacy fanout, if no plan is present AND
 *      context.executionCapability.kind !== "factory-binding-probe"
 *      AND context.executionCapability !== undefined, throw
 *      `real_execution_capability_requires_per_command_plan`
 *      BEFORE any manager.start call.
 *
 * DRIVING SEAM (same as C2 GREEN):
 *   AgentRuntime (real) -> requestToolApproval (real callback
 *   returning real ToolApprovalResult with executionPlan +
 *   executionCapability) -> real createShellTool via
 *   createVscodeRunCommandsTool -> real executeShellCommands ->
 *   real CommandJobManager.start.
 *
 * FACTORY TEST RULE:
 *   Every test PASSES today (no intentional default-suite failures).
 *   All assertions are production-observed through the real seam.
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
	FilesystemCreateOnlyCapability,
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

// Canonical Darwin user temp root (per already-proven ACT evidence).
// Mirrored here so the test file is self-contained.
const DARWIN_USER_TEMP_ROOT = "/var/folders/c_/T"

function capProbe(correlationId: string): FactoryBindingProbeCapability {
	return { kind: "factory-binding-probe", correlationId }
}

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

interface GuardHarness {
	model: AgentModel
	runtime: AgentRuntime
	manager: CommandJobManager
	startSpy: ReturnType<typeof vi.spyOn>
	approvalCalls: Array<{ input: unknown }>
}

function buildGuardHarness(params: {
	modelInput: unknown
	toolCallId: string
	approvalResult: (req: { input: unknown }) => ToolApprovalResult | Promise<ToolApprovalResult>
}): GuardHarness {
	const approvalCalls: Array<{ input: unknown }> = []

	const model = new ScriptedModel([makeRunCommandsModelStep(params.modelInput, params.toolCallId), makeTextFinishStep()])

	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => undefined,
	})
	const startSpy = vi.spyOn(manager, "start")

	const tool: AgentTool<unknown, unknown> = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground path not used in C2 GUARD")
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
	// Per-command channel captured so tests assert the typed-channel-
	// separation contract: real authority flows here, never on
	// executionCapability.
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
// SECTION 1: legacy path MUST allow factory-binding-probe (regression guard).
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	describe("Section 1: legacy path still allows synthetic probe", () => {
		it("GUARD-1: no plan + factory-binding-probe -> legacy behavior (PASS)", async () => {
			// Required RED/GREEN: legacy synthetic probe must still
			// flow uniformly to all starts when no plan is present.
			const toolCallCap = capProbe("legacy-probe")
			const harness = buildGuardHarness({
				modelInput: { commands: ["/usr/bin/mktemp"] },
				toolCallId: "guard-1-legacy-probe",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					executionCapability: toolCallCap,
					// NO executionPlan -> legacy path.
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
	// SECTION 2: GUARD -- legacy path MUST fail closed when a real
	// authority-bearing capability is attached without a per-command plan.
	//
	// This is the load-bearing security boundary for the Darwin Seatbelt
	// capability ACT. The runtime guard in executeShellCommands enforces:
	//   no plan + non-probe capability
	//   -> throw real_execution_capability_requires_per_command_plan.
	//
	// The TypeScript type split makes this scenario impossible to construct
	// through the type-safe path; the test simulates the bypass via a
	// typed assertion (the test IS the bypass attempt).
	// -------------------------------------------------------------------------

	describe("Section 2: legacy path FAIL-CLOSED when real authority is attached", () => {
		it("GUARD-2: no plan + filesystem-create-only -> ZERO starts / fail closed", async () => {
			// Required RED/GREEN: legacy tool-call channel must REJECT
			// real authority-bearing capabilities because the channel
			// is tool-call-wide (cannot scope to per-command without a
			// plan). On detection: throw
			// `real_execution_capability_requires_per_command_plan`
			// before any manager.start call.
			//
			// The runtime guard fires at executeShellCommands BEFORE
			// Promise.all, so the runtime never invokes manager.start
			// for any command.
			//
			// We bypass the TypeScript type split here because the
			// test is intentionally validating the runtime defense
			// layer (TypeScript alone is not a security boundary,
			// per reviewer). In production, the only writers are the
			// host's policy callback and the runtime itself; neither
			// can attach filesystem-create-only to the legacy
			// channel at compile time.
			const realCap: InternalExecutionCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}

			const harness = buildGuardHarness({
				modelInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				toolCallId: "guard-2-fail-closed",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					// BYPASS the type split (test only):
					// in production this assignment is a TypeScript
					// error because ToolApprovalResult.executionCapability
					// is restricted to factory-binding-probe.
					executionCapability: realCap as unknown as never,
					// NO executionPlan -> legacy path triggered.
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			// The runtime should fail closed. The actual manager.start
			// calls are ZERO because the guard throws before fanout.
			// (The runtime run resolves to "completed" because the
			// model emits a follow-up text-delta after the tool
			// failure; the load-bearing assertion is the ZERO starts,
			// which is the FAIL-CLOSED boundary. This matches the
			// proven C2 GREEN test pattern in
			// execution-authority-per-command-binding01.c1-correction01
			// --real-plan-red.test.ts > CASE 4.)
			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(0)
		})

		it("GUARD-2-NEGATIVE: no plan + no executionCapability -> legacy behavior preserved (PASS)", async () => {
			// Negative control: when no capability is attached at all,
			// the legacy path should still execute (no fanout guard fires).
			const harness = buildGuardHarness({
				modelInput: { commands: ["echo hello"] },
				toolCallId: "guard-2-negative",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					// No executionCapability, no executionPlan.
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBeGreaterThan(0)
			for (const s of starts) {
				expect(s.executionCapability).toBeUndefined()
			}
		})
	})

	// -------------------------------------------------------------------------
	// SECTION 3: GUARD -- per-command path carries real authority correctly.
	// -------------------------------------------------------------------------

	describe("Section 3: per-command path carries real authority", () => {
		it("GUARD-3: plan [filesystem-create-only, undefined] -> job[0] real, job[1] none", async () => {
			// Required RED/GREEN: when a valid correlated plan exists,
			// the real authority-bearing capability flows ONLY to the
			// entry it was attached to. Sibling entries receive
			// undefined (no fallback).
			//
			// This is the headline test for the Darwin Seatbelt
			// capability: the /usr/bin/mktemp entry gets real
			// filesystem-create-only(roots=[DARWIN_USER_TEMP_ROOT]),
			// the printf sibling gets no create-only authority (and
			// the Seatbelt profile will reject its filesystem writes).
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
						// executionCapability undefined means undefined.
					},
				],
			}

			const harness = buildGuardHarness({
				modelInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				toolCallId: "guard-3-real-on-entry",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					// NO tool-call executionCapability (none needed
					// when per-command plan is present; the legacy
					// channel is bypassed).
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBe(2)

			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01:
			// Real authority flows through the typed per-command
			// channel only -- NEVER via executionCapability. The
			// legacy channel is CLEARED when a plan is present.
			//
			// Job 0: real filesystem-create-only capability on
			// the per-command channel; legacy channel cleared.
			expect(starts[0]?.command).toBe("/usr/bin/mktemp")
			expect(starts[0]?.perCommandExecutionCapability).toEqual(realCap)
			expect(starts[0]?.executionCapability).toBeUndefined()

			// Job 1: NO capability on either channel -- no fallback
			// to tool-call slot, no fallback to per-command entry[1]
			// which is undefined.
			expect(starts[1]?.command).toBe("printf harmless\n")
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[1]?.executionCapability).toBeUndefined()
		})

		it("GUARD-4: plan with two real entries -> both flow to their respective jobs", async () => {
			// Companion test: when TWO entries both have real
			// authority (e.g. two mktemp calls in different
			// subdirectories), both flow correctly. The discriminator
			// is positional (commandIndex), not text-based.
			const realCapA: FilesystemCreateOnlyCapability = {
				kind: "filesystem-create-only",
				roots: ["/var/folders/c_/T/dir_a"],
			}
			const realCapB: FilesystemCreateOnlyCapability = {
				kind: "filesystem-create-only",
				roots: ["/var/folders/c_/T/dir_b"],
			}
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["/usr/bin/mktemp", "/usr/bin/mktemp"],
				},
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						executionCapability: realCapA,
					},
					{
						commandIndex: 1,
						hardenedCommand: "/usr/bin/mktemp",
						executionCapability: realCapB,
					},
				],
			}

			const harness = buildGuardHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "/usr/bin/mktemp"] },
				toolCallId: "guard-4-two-real",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					executionPlan: plan,
				}),
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			expect(result.status).toBe("completed")
			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBe(2)

			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01:
			// Positional binding on the typed per-command channel:
			// even though both commands have identical text, the
			// capability flows by commandIndex. The legacy channel
			// is CLEARED.
			expect(starts[0]?.perCommandExecutionCapability).toEqual(realCapA)
			expect(starts[1]?.perCommandExecutionCapability).toEqual(realCapB)
			expect(starts[0]?.executionCapability).toBeUndefined()
			expect(starts[1]?.executionCapability).toBeUndefined()
		})
	})

	// -------------------------------------------------------------------------
	// SECTION 4: GUARD -- real capability still rejected on correlation
	// failure (no bypass).
	// -------------------------------------------------------------------------

	describe("Section 4: real capability still fails closed on correlation failure", () => {
		it("GUARD-5: plan with filesystem-create-only but mismatch -> ZERO starts", async () => {
			// Even when the entry has REAL authority, a cardinality
			// mismatch (reorder with equal cardinality, length drift,
			// hardenedCommand inequality) must still produce ZERO
			// starts. The correlation guard fires BEFORE the
			// real-capability flow.
			const realCap: FilesystemCreateOnlyCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}
			const plan: CommandExecutionPlan = {
				transformedInput: { commands: ["B", "A"] }, // plan order [A,B]
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "A",
						executionCapability: realCap,
					},
					{
						commandIndex: 1,
						hardenedCommand: "B",
						executionCapability: realCap,
					},
				],
			}

			const harness = buildGuardHarness({
				modelInput: { commands: ["B", "A"] }, // model emits [B,A]
				toolCallId: "guard-5-real-mismatch",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "guard" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(0)
		})
	})
})
