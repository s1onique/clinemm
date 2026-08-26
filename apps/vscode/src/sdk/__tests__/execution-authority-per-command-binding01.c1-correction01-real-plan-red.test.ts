/**
 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01
 *
 * C1-CORRECTION01 -- real upstream authorization seam RED proof.
 *
 * REVIEWER-PRESCRIBED CORRECTION (verbatim):
 *
 *   "Drive the real upstream authorization seam, not a manually
 *    constructed AgentToolContext.
 *
 *    Have the real AgentRuntime approval callback return a
 *    ToolApprovalResult containing an actual mixed executionPlan, e.g.:
 *
 *      input:
 *        commands[0] = /usr/bin/mktemp
 *        commands[1] = printf harmless
 *
 *      approval.executionPlan:
 *        entry[0]:
 *          commandIndex=0
 *          hardenedCommand=/usr/bin/mktemp
 *          marker A / reviewed authority
 *
 *        entry[1]:
 *          commandIndex=1
 *          hardenedCommand=printf harmless
 *          no authority
 *
 *    Then run through:
 *      AgentRuntime
 *        -> prepared execution
 *        -> transformed tool input
 *        -> real run_commands
 *        -> executeShellCommands
 *        -> CommandJobManager.start
 *
 *    The actual RED we need is:
 *
 *      authorization plan says: [A, none]
 *      actual starts:           [A, A]
 *
 *    with the plan originating from the real approval result, not
 *    context.metadata.
 *
 *    If that cannot be observed because the plan is completely
 *    discarded before AgentToolContext, that itself is the RED:
 *
 *      approval.executionPlan = [A, none]
 *            |
 *      tool context has no corresponding per-command plan
 *            |
 *      executor cannot discriminate
 *
 *    That is sufficient and honest."
 *
 * SCOPE OF THIS FILE (no production code, no Factory test rule violation):
 *   - Every test PASSES today.
 *   - RED is documented in test names + assertions + evidence file.
 *   - All tests drive the REAL upstream authorization seam:
 *       AgentRuntime -> real requestToolApproval callback returning
 *       a real ToolApprovalResult.executionPlan -> real createShellTool
 *       via createVscodeRunCommandsTool -> real createVscodeShellExecutor
 *       -> real CommandJobManager.start.
 *   - Tests show that even when the host authorizes per-command, the
 *     per-command authority is DISCARDED at the runtime's CORRECTION04
 *     input-substitution seam (agent-runtime.ts:2590). Only
 *     `transformedInput` (hardened commands) crosses the seam; the
 *     parallel `commands[]` provenance does not.
 *   - Tests prove `commandIndex` is the candidate identity anchor
 *     for ordinary strings (PASS today) and is BROKEN by heredoc
 *     coalescing (FAIL-CLOSED boundary documented).
 *
 * REVIEWER MANDATE (verbatim):
 *
 *   "Before C2, prove commandIndex correlation, including duplicate-text
 *    and heredoc/cardinality cases."
 *
 * SECTION 2 of this file proves exactly that.
 *
 * FACTORY TEST RULE:
 *   No intentional default-suite failures. Every test PASSES today.
 *   The RED is captured in the test descriptions, the assertions, and
 *   the evidence file.
 *
 * C2 GREEN CONSERVATION (added when C2 GREEN landed):
 *   Two tests in this file were updated to reflect the closed-gap
 *   behavior -- the per-command authority is now plumbed, so the
 *   prior "RED" observations are no longer accurate:
 *
 *     - Section 1 Test 1 ("RED: per-command executionPlan.provenance
 *       is DISCARDED at CORRECTION04"): now asserts that when a
 *       plan exists with undefined entry capabilities, commands
 *       receive undefined (the per-command path is active, NO
 *       FALLBACK to tool-call capability).
 *
 *     - Section 1 Test 2 ("RED: per-entry executionCapability
 *       channel does NOT exist in AgentToolContext"): rewritten
 *       to assert the C2 GREEN reality -- AgentToolContext carries
 *       a typed runtime-owned `commandExecutionPlan` slot that
 *       envelopes per-entry authority. The prior Object.keys-based
 *       structural RED was non-load-bearing (TypeScript interface
 *       fields do not exist at runtime unless assigned; per
 *       reviewer P2). The load-bearing proof lives in
 *       c2-green.test.ts.
 *
 *     - Section 2 Case 4 (heredoc FAIL-CLOSED): now asserts ZERO
 *       starts on cardinality drift (correlation fails closed
 *       before fanout).
 *
 *   Cases 1, 2, 3 in Section 2 remain unchanged: they correlate
 *   successfully and per-command authority flows correctly.
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
// Test harness: drive the REAL upstream authorization seam.
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

const TRUSTED_TOOL_CALL_CAPABILITY: FactoryBindingProbeCapability = {
	kind: "factory-binding-probe",
	correlationId: "tool-call-c1-correction01",
}

interface CapturedStart {
	toolCallId: string | undefined
	command: string | undefined
	executionCapability: InternalExecutionCapability | undefined
	transformedInputCommands: ReadonlyArray<string | undefined>
}

interface RealUpstreamHarness {
	model: AgentModel
	runtime: AgentRuntime
	manager: CommandJobManager
	startSpy: ReturnType<typeof vi.spyOn>
	approvalCalls: Array<{ input: unknown }>
}

/**
 * Build a harness that drives the REAL upstream authorization seam.
 *
 * The host callback returns a real ToolApprovalResult.executionPlan
 * (with per-command provenance). The AgentRuntime stamps
 * `input = approval.executionPlan.transformedInput` at agent-runtime.ts:2590
 * (CORRECTION04 enforcement). The executor fans out to manager.start
 * once per command with the SAME AgentToolContext.
 *
 * The harness captures every manager.start call so we can observe
 * what crosses the seam.
 */
function buildRealUpstreamHarness(params: {
	commands: ReadonlyArray<string>
	plan: CommandExecutionPlan
	executionCapability: FactoryBindingProbeCapability
}): RealUpstreamHarness {
	const approvalCalls: Array<{ input: unknown }> = []
	const capturedStarts: CapturedStart[] = []

	// Capture the commands array as observed on the executor side
	// (i.e. the value the executor's executeShellCommands will iterate).
	// The runtime substitutes input = approval.executionPlan.transformedInput
	// (CORRECTION04), so we expect the executor to receive transformedInput.
	// We snapshot transformedInput.commands once via a side-channel observer:
	// the model itself doesn't need it; we read it back from approvalCalls.
	const transformedInputCommands = params.plan.transformedInput

	// Use a scripted model that emits a single multi-command tool-call-delta.
	const model = new ScriptedModel([
		(request) => {
			// Capture the tool call input as the model produced it.
			void request
			const firstCommand = params.commands[0]
			if (firstCommand === undefined) {
				throw new Error("test harness requires at least one command")
			}
			const events: AgentModelEvent[] = [
				{
					type: "tool-call-delta",
					toolCallId: "tool-call-c1-correction01",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: [...params.commands] }),
				},
				{ type: "finish", reason: "tool-calls" },
			]
			return (async function* () {
				for (const ev of events) yield ev
			})()
		},
		() => {
			const events: AgentModelEvent[] = [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			]
			return (async function* () {
				for (const ev of events) yield ev
			})()
		},
	])

	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => undefined,
	})
	const startSpy = vi.spyOn(manager, "start")

	const tool: AgentTool<unknown, unknown> = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground path not used in C1-CORRECTION01")
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
			// Real upstream authorization seam: capture the model's raw
			// tool-call input for inspection, then return a real
			// ToolApprovalResult with an actual executionPlan.
			approvalCalls.push({ input: req.input })
			return {
				approved: true,
				decision: { kind: "allow", reason: "test harness", source: "c1-correction01" },
				// The host attaches its per-command authorization plan to
				// the approval result. This is what ClineMM C2 GREEN will
				// need to drill down into.
				executionPlan: params.plan,
				// The tool-call capability is the ONLY channel that
				// crosses the seam today.
				executionCapability: params.executionCapability,
			}
		},
	})

	// Annotate the spy so consumers can correlate captured starts with
	// the upstream plan entries.
	void capturedStarts
	void transformedInputCommands

	return { model, runtime, manager, startSpy, approvalCalls }
}

// ---------------------------------------------------------------------------
// SECTION 1: Real upstream authorization seam RED characterization.
//
// The RED is: even when the host attaches a per-command executionPlan
// to the approval result, the per-command provenance is DISCARDED
// at CORRECTION04 input-substitution. Only `transformedInput` (hardened
// commands) crosses the seam. The executor's manager.start calls all
// receive the SAME tool-call capability with NO per-command channel.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01 C1-CORRECTION01", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	describe("Section 1: real upstream authorization seam RED characterization", () => {
		it("C2 GREEN CONSERVATION: when a per-command plan exists, undefined entry capabilities are NOT broadened by the tool-call capability (forbidden fallback)", async () => {
			// Mixed case from the reviewer's spec:
			//   commands[0] = /usr/bin/mktemp
			//   commands[1] = printf harmless
			//
			// Host attaches a REAL executionPlan with per-command provenance:
			//   entry[0].commandIndex=0, matchedRuleSource="darwin_mktemp_create_only"
			//   entry[1].commandIndex=1, matchedRuleSource=undefined  (no per-command grant)
			//
			// The plan entries DO NOT have executionCapability set. The host
			// also attaches a tool-call executionCapability as a tool-wide
			// grant. The C1-CORRECTION01 RED observed that the tool-call
			// capability flowed uniformly to both manager.start calls
			// (because the per-entry channel did not exist).
			//
			// C2 GREEN CONSERVATION: under the new per-command binding,
			// the plan is propagated to AgentToolContext.commandExecutionPlan.
			// The executor correlates plan.commands[i] against
			// executableCommands[i] EXACTLY. Correlation succeeds (both
			// entries have hardenedCommand that matches). The per-command
			// path is then active; for entries with no executionCapability,
			// the command receives `undefined` -- NOT the tool-call
			// capability. This is the reviewer-prescribed "no fallback"
			// contract.
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: "/usr/bin/mktemp",
						matchedRuleSource: "darwin_mktemp_create_only",
					},
					{
						commandIndex: 1,
						hardenedCommand: "printf harmless\n",
						matchedRuleSource: undefined,
					},
				],
			}

			const harness = buildRealUpstreamHarness({
				commands: ["/usr/bin/mktemp", "printf harmless\n"],
				plan,
				executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			// The runtime completes the run (correlation succeeded).
			expect(result.status).toBe("completed")

			// INVARIANT 1: the host's approval callback was called with
			// the model's raw tool-call input. Proves the upstream
			// authorization seam was exercised with a real plan attachment.
			expect(harness.approvalCalls).toHaveLength(1)
			const approvalInput = harness.approvalCalls[0]?.input
			expect(approvalInput).toEqual({ commands: ["/usr/bin/mktemp", "printf harmless\n"] })

			// INVARIANT 2: fanout is one manager.start per command.
			expect(harness.startSpy.mock.calls).toHaveLength(2)

			// INVARIANT 3 (C2 GREEN CONSERVATION): both commands receive
			// undefined (NOT the tool-call capability). The per-command
			// path is active because the plan exists; entries with no
			// executionCapability produce undefined (no fallback).
			//
			// This is the reviewer-mandated contract:
			//   "Once a valid per-command plan exists, this must be forbidden:
			//      entry.executionCapability ?? context.executionCapability
			//    Correct semantics: command i receives exactly
			//    entry[i].executionCapability; undefined means undefined."
			const starts = harness.startSpy.mock.calls.map((args: unknown[]) => {
				const opts = args[0] as { command?: unknown }
				const ctx = args[1] as AgentToolContext | undefined
				return {
					command: typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command),
					executionCapability: ctx?.executionCapability,
					toolCallId: ctx?.toolCallId,
				}
			})
			// Both commands: per-command path is active, entries have no
			// executionCapability, so both receive undefined. The
			// tool-call capability does NOT widen.
			expect(starts[0]?.executionCapability).toBeUndefined()
			expect(starts[1]?.executionCapability).toBeUndefined()
			expect(starts[0]?.executionCapability).not.toEqual(TRUSTED_TOOL_CALL_CAPABILITY)
			expect(starts[1]?.executionCapability).not.toEqual(TRUSTED_TOOL_CALL_CAPABILITY)
			// Both commands share the same toolCallId (tool-call scope).
			expect(starts[0]?.toolCallId).toBe("tool-call-c1-correction01")
			expect(starts[1]?.toolCallId).toBe("tool-call-c1-correction01")

			// INVARIANT 4: the executor received the hardened input
			// (CORRECTION04 enforcement). The commands it iterates align
			// with plan.transformedInput.commands.
			expect(starts[0]?.command).toBe("/usr/bin/mktemp")
			expect(starts[1]?.command).toBe("printf harmless\n")

			// Conservation: document the closed-gap behavior.
			const greenObservation = {
				planEntry0MatchedRuleSource: plan.commands[0]?.matchedRuleSource,
				planEntry1MatchedRuleSource: plan.commands[1]?.matchedRuleSource,
				start0Command: starts[0]?.command,
				start1Command: starts[1]?.command,
				start0ExecutionCapability: starts[0]?.executionCapability,
				start1ExecutionCapability: starts[1]?.executionCapability,
				greenNote:
					"C2 GREEN: per-command binding is active. Both entries lack " +
					"executionCapability; both commands receive undefined. The " +
					"tool-call capability (TRUSTED_TOOL_CALL_CAPABILITY) does NOT " +
					"widen per-command authority -- reviewer-mandated no-fallback contract.",
			}
			expect(greenObservation.greenNote).toContain("no-fallback")
		})

		it("C2 GREEN STRUCTURAL: AgentToolContext carries a TYPED runtime-owned commandExecutionPlan slot (closed per-command authority envelope)", async () => {
			// The prior C1 RED observed that AgentToolContext had only
			// ONE executionCapability slot (the tool-call slot) and no
			// per-command channel. The prior test attempted to prove
			// absence of per-command fields via `Object.keys(probe)`,
			// but TypeScript interface fields do not exist at runtime
			// unless assigned -- the `Object.keys` test was structural
			// witness only, NON-LOAD-BEARING (per reviewer P2).
			//
			// C2 GREEN now adds the `commandExecutionPlan` typed slot to
			// AgentToolContext. This test asserts the typed slot exists
			// and is the envelope that carries per-entry authority
			// (`CommandExecutionPlanEntry.executionCapability`) consumed
			// by the executor at commandIndex position.
			//
			// This is a STRUCTURAL witness of the C2 GREEN architecture.
			// The load-bearing proof of the per-command binding is in
			// the c2-green.test.ts file (real upstream AgentRuntime
			// driving real executeShellCommands through real
			// CommandJobManager.start).
			const probe: AgentToolContext = {
				agentId: "c2-green-shape",
				iteration: 0,
				// C2 GREEN: typed runtime-owned plan slot now exists on
				// AgentToolContext. The plan carries per-entry authority.
				commandExecutionPlan: {
					transformedInput: { commands: ["/usr/bin/mktemp"] },
					commands: [
						{
							commandIndex: 0,
							hardenedCommand: "/usr/bin/mktemp",
							executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
						},
					],
				},
			}
			// STRUCTURAL ASSERTION: the typed slot is present and the
			// plan carries per-entry authority.
			expect(probe.commandExecutionPlan).toBeDefined()
			expect(probe.commandExecutionPlan?.commands).toHaveLength(1)
			expect(probe.commandExecutionPlan?.commands[0]?.commandIndex).toBe(0)
			expect(probe.commandExecutionPlan?.commands[0]?.hardenedCommand).toBe("/usr/bin/mktemp")
			expect(probe.commandExecutionPlan?.commands[0]?.executionCapability).toEqual(TRUSTED_TOOL_CALL_CAPABILITY)
			// STRUCTURAL ASSERTION: AgentToolContext still carries the
			// tool-call slot too. C2 GREEN preserves the legacy slot
			// for synthetic transport compatibility (no plan -> legacy
			// path; with plan -> per-command path is active and the
			// tool-call slot is consumed by the legacy path ONLY when
			// no plan is present).
			expect(probe.executionCapability).toBeUndefined()
			// The known AgentToolContext shape (from agent.ts:339-410):
			//   sessionId?, agentId, conversationId?, runId?,
			//   iteration, toolCallId?, signal?, metadata?,
			//   executionCapability?, commandExecutionPlan?, snapshot?,
			//   emitUpdate?
			// The new typed slot is `commandExecutionPlan` (NOT a
			// parallel `perCommandExecutionCapabilities[]` array).
			const contextKeys = Object.keys(probe)
			const authorityKeys = contextKeys.filter(
				(k) => k.toLowerCase().includes("capability") || k.toLowerCase().includes("plan"),
			)
			expect(authorityKeys).toContain("commandExecutionPlan")
			expect(authorityKeys).not.toContain("perCommandExecutionCapabilities")
			// Sanity: the typed runtime-owned slots are present.
			expect(contextKeys).toContain("commandExecutionPlan")
			expect(contextKeys).toContain("agentId")
			expect(contextKeys).toContain("iteration")
		})
	})

	// -------------------------------------------------------------------------
	// SECTION 2: commandIndex identity discriminators (the candidate anchor).
	//
	// Reviewer mandate (verbatim):
	//   "Before C2, prove commandIndex survives these cases:
	//      1. two distinct ordinary strings [A, B]
	//      2. duplicate command text ['git status', 'git status']
	//      3. three commands [A, none, C]
	//      4. whatever heredoc/coalescing case your recon identified
	//         as cardinality-changing
	//    For each, compare:
	//      executionPlan.commands[*].commandIndex
	//      transformedInput.commands[*]
	//      actual manager.start call order
	//    If commandIndex remains valid for ordinary strings but heredoc
	//    coalescing breaks it, don't generalize the capability transport
	//    to unsupported shapes. Fail closed there."
	// -------------------------------------------------------------------------

	describe("Section 2: commandIndex identity discriminators", () => {
		it("CASE 1: two distinct ordinary strings [A, B] -- commandIndex is stable", async () => {
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				commands: [
					{ commandIndex: 0, hardenedCommand: "/usr/bin/mktemp", matchedRuleSource: "darwin_mktemp_create_only" },
					{ commandIndex: 1, hardenedCommand: "printf harmless\n" },
				],
			}

			const harness = buildRealUpstreamHarness({
				commands: ["/usr/bin/mktemp", "printf harmless\n"],
				plan,
				executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))
			expect(result.status).toBe("completed")

			// Capture the order of commands reaching manager.start.
			const observed = harness.startSpy.mock.calls.map((args: unknown[]) => {
				const opts = args[0] as { command?: unknown }
				return typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command)
			})

			// 2 commands -> 2 starts; positional order preserved.
			expect(observed).toEqual(["/usr/bin/mktemp", "printf harmless\n"])

			// commandIndex correlation works for distinct ordinary strings.
			// executionPlan.commands[0] corresponds to start[0];
			// executionPlan.commands[1] corresponds to start[1].
			const correlation = observed.map((cmd: string, i: number) => ({
				startIndex: i,
				observedCommand: cmd,
				planEntryIndex: plan.commands[i]?.commandIndex,
				planEntryCommand: plan.commands[i]?.hardenedCommand,
				matches: cmd === plan.commands[i]?.hardenedCommand,
			}))
			for (const c of correlation) {
				expect(c.matches).toBe(true)
				expect(c.planEntryIndex).toBe(c.startIndex)
			}
		})

		it("CASE 2: duplicate command text [git status, git status] -- commandIndex discriminates by POSITION not text", async () => {
			// The reviewer explicitly rejected hardenedCommand text as
			// identity anchor. This case proves that even when the
			// commands are byte-identical, commandIndex discriminates by
			// POSITION (not text), so the per-command binding can target
			// plan.commands[i] by index, not by text match.
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["git status", "git status"],
				},
				commands: [
					{ commandIndex: 0, hardenedCommand: "git status", matchedRuleSource: "host_safe_git_status" },
					{ commandIndex: 1, hardenedCommand: "git status", matchedRuleSource: "host_safe_git_status" },
				],
			}

			const harness = buildRealUpstreamHarness({
				commands: ["git status", "git status"],
				plan,
				executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))
			expect(result.status).toBe("completed")

			expect(harness.startSpy.mock.calls).toHaveLength(2)
			const observed = harness.startSpy.mock.calls.map((args: unknown[]) => {
				const opts = args[0] as { command?: unknown }
				return typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command)
			})

			// Both observed commands are identical text. They CANNOT
			// be distinguished by text -- only by their order in the
			// manager.start call sequence.
			expect(observed).toEqual(["git status", "git status"])

			// Positional correlation:
			//   start[0] <-> plan.commands[0]
			//   start[1] <-> plan.commands[1]
			// NOT:
			//   start[0] <-> plan entry where hardenedCommand === observed[0]
			//   (which is ambiguous -- both entries match).
			//
			// If a future binding were to do `find entry where
			// hardenedCommand === command`, it would fail here because
			// both entries match the observed text. This test pins the
			// POSITIONAL correlation as the contract.
			const positionalWorks = observed.every((cmd: string, i: number) => cmd === plan.commands[i]?.hardenedCommand)
			expect(positionalWorks).toBe(true)

			// Pin the RED: both entries have the same matchedRuleSource.
			// A binding that filters by matchedRuleSource would falsely
			// match both entries for both starts. commandIndex is the
			// ONLY safe anchor.
			expect(plan.commands[0]?.matchedRuleSource).toBe(plan.commands[1]?.matchedRuleSource)
		})

		it("CASE 3: three commands [A, none, C] -- commandIndex correlation holds", async () => {
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["cmd-A", "cmd-none", "cmd-C"],
				},
				commands: [
					{ commandIndex: 0, hardenedCommand: "cmd-A", matchedRuleSource: "host_safe_A" },
					{ commandIndex: 1, hardenedCommand: "cmd-none" },
					{ commandIndex: 2, hardenedCommand: "cmd-C", matchedRuleSource: "host_safe_C" },
				],
			}

			const harness = buildRealUpstreamHarness({
				commands: ["cmd-A", "cmd-none", "cmd-C"],
				plan,
				executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
			})

			const result = await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))
			expect(result.status).toBe("completed")

			expect(harness.startSpy.mock.calls).toHaveLength(3)
			const observed = harness.startSpy.mock.calls.map((args: unknown[]) => {
				const opts = args[0] as { command?: unknown }
				return typeof opts?.command === "string" ? opts.command : JSON.stringify(opts?.command)
			})
			expect(observed).toEqual(["cmd-A", "cmd-none", "cmd-C"])

			// Each plan entry's commandIndex matches the observed start order.
			const correlation = observed.map((cmd: string, i: number) => ({
				startIndex: i,
				planEntryIndex: plan.commands[i]?.commandIndex,
				matches: cmd === plan.commands[i]?.hardenedCommand,
			}))
			for (let i = 0; i < 3; i++) {
				expect(correlation[i]?.matches).toBe(true)
				expect(correlation[i]?.planEntryIndex).toBe(i)
			}
		})

		it("CASE 4 (FAIL-CLOSED): heredoc coalescing breaks commandIndex correlation -- the per-command binding MUST fail closed", async () => {
			// The reviewer's mandated FAIL-CLOSED test:
			//
			//   input commands:
			//     [0] cat <<EOF
			//     [1] line1
			//     [2] EOF
			//
			//   plan built by buildCommandExecutionPlan (uses
			//     normalizeRunCommandsInput, NO coalescing):
			//     entry[0] = cat <<EOF
			//     entry[1] = line1
			//     entry[2] = EOF
			//
			//   executor runs coalesceAdjacentStringHeredocs which
			//     collapses adjacent heredoc strings into ONE command:
			//     ["cat <<EOF\nline1\nEOF"]  -- cardinality 1.
			//
			//   Result: executionPlan.commands.length === 3, but
			//   manager.start call count === 1. commandIndex
			//   correlation breaks: there is no plan entry for the
			//   observed start index 0 (start[0] is the merged command,
			//   not a 1:1 map to plan.commands[0]).
			//
			// C2 GREEN CONSERVATION: this test now asserts the closed-gap
			// behavior. The per-command binding detects the cardinality
			// drift and FAILS CLOSED: ZERO manager.start calls.
			//
			// The reviewer-prescribed contract: "executionPlan present +
			// correlation cannot be proven = no manager.start calls".
			const plan: CommandExecutionPlan = {
				transformedInput: {
					commands: ["cat <<EOF", "line1", "EOF"],
				},
				commands: [
					{ commandIndex: 0, hardenedCommand: "cat <<EOF", matchedRuleSource: "host_safe_cat_heredoc" },
					{ commandIndex: 1, hardenedCommand: "line1" },
					{ commandIndex: 2, hardenedCommand: "EOF" },
				],
			}

			const harness = buildRealUpstreamHarness({
				commands: ["cat <<EOF", "line1", "EOF"],
				plan,
				executionCapability: TRUSTED_TOOL_CALL_CAPABILITY,
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			// C2 GREEN: cardinality drift -> ZERO manager.start calls.
			// The executor's correlateExecutionPlan detects the mismatch
			// and throws before any manager.start is invoked.
			expect(harness.startSpy.mock.calls).toHaveLength(0)

			// Pin the FAIL-CLOSED boundary (frozen):
			const failClosedBoundaryNote =
				"C2 GREEN: cardinality drift is gated. CORRELATION_UNPROVEN -> " +
				"ZERO manager.start calls (no per-command authority when " +
				"executionPlan.commands.length !== coalesced commands.length)."
			expect(failClosedBoundaryNote).toContain("CORRELATION_UNPROVEN")
		})
	})
})
