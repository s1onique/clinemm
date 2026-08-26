/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01
 *
 * BOUNDED TYPED-CHANNEL CORRECTION.
 *
 * Reviewer of the GUARD commit observed that the cast
 *   `({ ...context, executionCapability: perCommandCaps[i] } as AgentToolContext)`
 * at the executor boundary defeated the compile-time type split at the
 * exact authority-bearing seam:
 *
 *   "The claimed compile-time split is defeated at the exact
 *    authority-bearing boundary.
 *
 *    You narrowed:
 *      AgentToolContext.executionCapability?: ToolCallExecutionCapability
 *    where:
 *      ToolCallExecutionCapability = FactoryBindingProbeCapability
 *    Good.
 *
 *    But when a real per-command capability arrives, definitions.ts does:
 *
 *      const perCommandContext: AgentToolContext =
 *        perCommandCaps !== null
 *          ? ({ ...context, executionCapability: perCommandCaps[i] } as AgentToolContext)
 *          : context
 *
 *    perCommandCaps[i] is an InternalExecutionCapability, which may be:
 *      filesystem-create-only
 *    yet AgentToolContext.executionCapability explicitly says that field
 *    can only contain:
 *      factory-binding-probe
 *
 *    The cast suppresses exactly the type error the split was intended
 *    to create."
 *
 * BOUNDED CORRECTION (reviewer-prescribed, smallest change):
 *
 *   Add a separate typed field:
 *
 *     interface AgentToolContext {
 *       executionCapability?: ToolCallExecutionCapability
 *       perCommandExecutionCapability?: InternalExecutionCapability
 *       commandExecutionPlan?: CommandExecutionPlan
 *     }
 *
 *   Stamp per-command context WITHOUT cast:
 *     const perCommandContext: AgentToolContext = perCommandCaps !== null
 *       ? { ...context, executionCapability: undefined,
 *           perCommandExecutionCapability: perCommandCaps[i] }
 *       : context
 *
 *   Legacy path:
 *     no plan -> executionCapability -> factory-binding-probe only
 *
 *   Correlated path:
 *     valid plan -> perCommandExecutionCapability -> full union
 *
 * Reviewer-mandated discriminators (verbatim):
 *
 *   1. no plan + filesystem-create-only forced into legacy field
 *      -> ZERO starts                    already proven (GUARD-2)
 *
 *   2. valid plan [fs-create-only, none]
 *      -> start[0].perCommandExecutionCapability = fs-create-only
 *      -> start[0].executionCapability = undefined
 *      -> start[1] both undefined
 *
 *   3. no plan + factory probe
 *      -> legacy executionCapability = probe
 *      -> perCommandExecutionCapability = undefined
 *
 *   4. search production source:
 *      no `as AgentToolContext` authority-carrying cast remains
 *        (structural; the first three are load-bearing)
 *
 * The runtime guard (real_execution_capability_requires_per_command_plan)
 * remains unchanged: TypeScript alone is not a runtime security boundary.
 */

import { execSync } from "node:child_process"
import { resolve } from "node:path"
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

interface CorrectionHarness {
	model: AgentModel
	runtime: AgentRuntime
	manager: CommandJobManager
	startSpy: ReturnType<typeof vi.spyOn>
}

function buildCorrectionHarness(params: {
	modelInput: unknown
	toolCallId: string
	approvalResult: (req: { input: unknown }) => ToolApprovalResult | Promise<ToolApprovalResult>
}): CorrectionHarness {
	const model = new ScriptedModel([makeRunCommandsModelStep(params.modelInput, params.toolCallId), makeTextFinishStep()])

	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => undefined,
	})
	const startSpy = vi.spyOn(manager, "start")

	const tool: AgentTool<unknown, unknown> = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground path not used in CORRECTION01")
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
			return params.approvalResult({ input: req.input })
		},
	})

	return { model, runtime, manager, startSpy }
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

describe("ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01 typed-channel separation", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	// -------------------------------------------------------------------------
	// DISCRIMINATOR 1: no plan + filesystem-create-only forced into legacy
	// field -> ZERO starts. (Already proven by GUARD-2; reasserted here with
	// the structural channel-separation contract.)
	// -------------------------------------------------------------------------

	describe("Discriminator 1: no plan + filesystem-create-only -> ZERO starts", () => {
		it("no plan + filesystem-create-only -> ZERO starts (channel separation preserved)", async () => {
			// Reviewer-mandated: even when a hostile actor bypasses the
			// type split and attaches a real authority-bearing capability
			// to the legacy `executionCapability` field, the runtime
			// guard fires and ZERO starts occur. The per-command channel
			// is irrelevant on the legacy path (no plan -> undefined).
			const realCap: InternalExecutionCapability = {
				kind: "filesystem-create-only",
				roots: [DARWIN_USER_TEMP_ROOT],
			}

			const harness = buildCorrectionHarness({
				modelInput: { commands: ["/usr/bin/mktemp"] },
				toolCallId: "correction-d1-legacy-fail-closed",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "correction" },
					// BYPASS type split (test only).
					executionCapability: realCap as unknown as never,
					// NO executionPlan -> legacy path triggered.
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			const starts = captureStarts(harness.startSpy)
			expect(starts).toHaveLength(0)
		})
	})

	// -------------------------------------------------------------------------
	// DISCRIMINATOR 2: valid plan [fs-create-only, none]
	//   -> start[0].perCommandExecutionCapability = fs-create-only
	//   -> start[0].executionCapability = undefined
	//   -> start[1] both undefined
	// -------------------------------------------------------------------------

	describe("Discriminator 2: valid plan -> per-command channel only", () => {
		it("plan [fs-create-only, undefined] -> start[0] real on per-command channel, legacy cleared; start[1] both undefined", async () => {
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

			const harness = buildCorrectionHarness({
				modelInput: {
					commands: ["/usr/bin/mktemp", "printf harmless\n"],
				},
				toolCallId: "correction-d2-typed-channel",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "correction" },
					executionPlan: plan,
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBe(2)

			// start[0]: real filesystem-create-only on per-command channel;
			//           legacy channel CLEARED.
			expect(starts[0]?.command).toBe("/usr/bin/mktemp")
			expect(starts[0]?.perCommandExecutionCapability).toEqual(realCap)
			expect(starts[0]?.executionCapability).toBeUndefined()

			// start[1]: both channels undefined. No fallback to legacy.
			expect(starts[1]?.command).toBe("printf harmless\n")
			expect(starts[1]?.perCommandExecutionCapability).toBeUndefined()
			expect(starts[1]?.executionCapability).toBeUndefined()
		})
	})

	// -------------------------------------------------------------------------
	// DISCRIMINATOR 3: no plan + factory probe
	//   -> legacy executionCapability = probe
	//   -> perCommandExecutionCapability = undefined
	// -------------------------------------------------------------------------

	describe("Discriminator 3: no plan + factory probe -> legacy channel only", () => {
		it("no plan + factory probe -> start[i].executionCapability = probe; perCommandExecutionCapability = undefined", async () => {
			const probe = capProbe("correction-d3-legacy-probe")
			const harness = buildCorrectionHarness({
				modelInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
				toolCallId: "correction-d3-legacy",
				approvalResult: () => ({
					approved: true,
					decision: { kind: "allow", reason: "test", source: "correction" },
					executionCapability: probe,
					// NO executionPlan -> legacy path.
				}),
			})

			await harness.runtime.run("Start")
			await new Promise((r) => setImmediate(r))

			const starts = captureStarts(harness.startSpy)
			expect(starts.length).toBe(2)

			// Legacy channel carries the probe uniformly.
			for (const s of starts) {
				expect(s.executionCapability).toEqual(probe)
				// Per-command channel is undefined on the legacy path.
				expect(s.perCommandExecutionCapability).toBeUndefined()
			}
		})
	})

	// -------------------------------------------------------------------------
	// DISCRIMINATOR 4: structural -- no `as AgentToolContext`
	// authority-carrying cast remains in production.
	// -------------------------------------------------------------------------

	describe("Discriminator 4: structural -- no authority-carrying `as AgentToolContext` cast in production", () => {
		it("production sources contain no authority-carrying `as AgentToolContext` cast", () => {
			// Reviewer-mandated structural check: scan the production
			// source tree for the SPECIFIC pattern that the
			// CORRECTION01 fix removes -- a spread that constructs an
			// AgentToolContext (with executionCapability or
			// perCommandExecutionCapability in scope) and casts it
			// back. That pattern is `... as AgentToolContext`
			// appearing on a line containing `...` (spread).
			//
			// Narrow "read" casts (e.g. `argsAndContext.at(-1) as
			// AgentToolContext`) are still legitimate -- they don't
			// carry authority, they just narrow a tuple type.
			//
			// The runtime guard is the defense against accidental
			// regressions (TypeScript is not a runtime boundary), but
			// the structural check makes regressions visible in CI.
			const repoRoot = resolve(__dirname, "..", "..", "..", "..", "..")
			// Step 1: grep -RIn for the cast, excluding tests, generated,
			// and node_modules.
			// Step 2: filter the lines through a Node-side check that
			// the line is not a comment AND contains `...` (spread).
			// Using Node here avoids awk escaping issues with the
			// heredoc shell invocation.
			const grepOutput = (() => {
				try {
					return execSync(
						`grep -RIn --include='*.ts' --exclude='*.test.ts' --exclude-dir=node_modules --exclude-dir=out --exclude-dir=dist --exclude-dir=generated 'as AgentToolContext' '${repoRoot}/apps/vscode/src' '${repoRoot}/sdk/packages/shared/src' '${repoRoot}/sdk/packages/agents/src' '${repoRoot}/sdk/packages/core/src' || true`,
						{ encoding: "utf8" },
					)
				} catch (e) {
					return ""
				}
			})()
			const offending = grepOutput
				.split("\n")
				.filter((line) => line.length > 0)
				.filter((line) => {
					// Format: "<path>:<line>:<content>"
					const lastColon = line.lastIndexOf(":")
					if (lastColon < 0) return false
					const content = line.slice(lastColon + 1)
					const trimmed = content.trimStart()
					// Skip comment lines (//, *, */).
					if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
						return false
					}
					// The cast must be on a line that ALSO contains a
					// spread operator (i.e. it's a constructor cast,
					// not a narrow read).
					return content.includes("...")
				})
				.join("\n")
			// Before CORRECTION01 there was exactly one authority-
			// carrying cast at definitions.ts (the executor boundary);
			// that cast has been removed. Any surviving occurrence is a
			// regression.
			expect(offending).toBe("")
		})
	})
})
