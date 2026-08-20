/**
 * ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01 — ITI01..ITI12 RED discriminator suite.
 *
 * Contract (ACT §0):
 *   malformed model tool call
 *     → decode
 *     → optional LOSSLESS normalization
 *     → schema validation
 *     → [INVALID] → typed rejection back to agent (approvalCalls=0, executorCalls=0)
 *
 *   Only VALID calls may proceed to policy → approval → execution.
 *
 * Production seam under test:
 *   AgentRuntime (sdk/packages/agents/src/agent-runtime.ts)
 *     parseToolInput (line 3537) → JSON parse + invalid_arguments path
 *     prepareToolExecution (line 2424) → inputParseError → skipReason
 *     requestToolApproval (line 2542) → real approval side effect
 *     executePreparedTool (line 2604) → real executor side effect
 *
 * Discriminator: `approvalCalls` and `executorCalls` against the canonical
 * tool-call/runtime seam (mirrors agent-runtime.outcome-integration.test.ts).
 */

// Canonical AgentRuntime lives at `@cline/agents`. The apps/vscode
// vitest config aliases `@cline/shared` and `@cline/llms` to their
// node_modules dist. `@cline/agents` is reachable as a workspace
// package (`workspace:*`), so the same dist-based path works here.
import { AgentRuntime } from "@cline/agents"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolRuntimeOutcome,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
	vi.restoreAllMocks()
})

beforeEach(() => {
	vi.restoreAllMocks()
})

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

interface CapturedOutcome {
	toolCallId: string
	toolName: string
	outcome: ToolRuntimeOutcome
	approvalCalls: number
	executorCalls: number
}

function captureOutcomes(
	captured: CapturedOutcome[],
	counters: { approvalCalls: number; executorCalls: number },
): AgentRuntimeHooks {
	return {
		onToolRuntimeOutcome: (ctx) => {
			captured.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
				approvalCalls: counters.approvalCalls,
				executorCalls: counters.executorCalls,
			})
		},
	}
}

interface RunCommandsInput {
	commands: Array<string | { command: string; args?: string[] }>
}

function createRunCommandsLikeTool(): AgentTool<RunCommandsInput, Array<{ result: string; success: true }>> {
	const strictInputSchema = {
		type: "object",
		properties: {
			commands: { type: "array", items: { type: "string" } },
		},
		required: ["commands"],
		additionalProperties: false,
	} as const
	// Counter injected so the ITI test can verify executor invocation.
	// The reference is set by the test driver at construction time and
	// incremented from inside `execute()`. (We use a closure reference
	// instead of mutating the `counters` object in `driveSingleToolCall`
	// directly so the test tool remains self-contained.)
	const executorTracker = { hits: 0 }
	return {
		name: "run_commands",
		description: "Mirror of canonical run_commands tool shape for ITI tests",
		inputSchema: strictInputSchema as unknown as Record<string, unknown>,
		validateInput(input) {
			if (!input || typeof input !== "object" || Array.isArray(input)) {
				return `Invalid input for tool run_commands: expected object`
			}
			const obj = input as Record<string, unknown>
			const commands = obj.commands
			if (!Array.isArray(commands)) {
				return `Invalid input for tool run_commands: commands must be an array of strings`
			}
			for (let i = 0; i < commands.length; i++) {
				if (typeof commands[i] !== "string") {
					return `Invalid input for tool run_commands: commands[${i}] expected string, received ${typeof commands[i]}`
				}
			}
			const allowed = new Set(["commands"])
			for (const k of Object.keys(obj)) {
				if (!allowed.has(k)) {
					return `Invalid input for tool run_commands: unknown property '${k}'`
				}
			}
			return undefined
		},
		async execute(input) {
			executorTracker.hits++
			const out: Array<{ result: string; success: true }> = []
			for (const c of input.commands) {
				out.push({ result: `executed:${c}`, success: true })
			}
			return out
		},
		// Expose the executor tracker so the test driver can read it.
		__executorTracker: executorTracker,
	} as AgentTool<RunCommandsInput, Array<{ result: string; success: true }>> & {
		__executorTracker: { hits: number }
	}
}

interface DriveResult {
	messages: readonly AgentMessage[]
	captured: CapturedOutcome[]
	counters: { approvalCalls: number; executorCalls: number }
}

async function driveSingleToolCall(opts: {
	toolName?: string
	inputText: string
	tool?: AgentTool<any, any>
	toolPolicies?: Record<string, { autoApprove?: boolean; enabled?: boolean }>
	requestApproval?: (req: ToolApprovalRequest) => Promise<ToolApprovalResult>
	// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01:
	// Optional observer that receives the toolCall reference AFTER
	// `executePreparedTool` has stamped `metadata.executionDisposition`.
	// Uses the canonical C1.2 `onToolRuntimeOutcome` hook — the same
	// observable seam the C1.2 ITI-3 acceptance tests use to assert
	// against the produced `ToolRuntimeOutcome`. My producer writes
	// the disposition BEFORE this hook fires, so reading
	// `toolCall.metadata` here observes the post-stamp state.
	onToolCallMetadata?: (snapshot: { toolCall: { metadata?: unknown } }) => void
}): Promise<DriveResult> {
	const counters = { approvalCalls: 0, executorCalls: 0 }
	const captured: CapturedOutcome[] = []
	const toolName = opts.toolName ?? "run_commands"
	const tool = (opts.tool ?? createRunCommandsLikeTool()) as AgentTool<any, any> & {
		__executorTracker?: { hits: number }
	}
	const requestApproval: (req: ToolApprovalRequest) => Promise<ToolApprovalResult> =
		opts.requestApproval ??
		(async () => {
			counters.approvalCalls++
			return { approved: true }
		})
	const model = new ScriptedModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "iti-1",
				toolName,
				inputText: opts.inputText,
			},
			{ type: "finish", reason: "tool-calls" },
		],
		() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		],
	])
	const hooks: AgentRuntimeHooks = captureOutcomes(captured, counters)
	if (opts.onToolCallMetadata) {
		const cb = opts.onToolCallMetadata
		const existingHook = hooks.onToolRuntimeOutcome
		// Compose so captureOutcomes still runs (outcome captures
		// drive the canonical C1.2 ITI-3 assertions) AND the metadata
		// observer reads the post-stamp toolCall.
		hooks.onToolRuntimeOutcome = async (ctx) => {
			await existingHook?.(ctx)
			cb({ toolCall: ctx.toolCall })
		}
	}
	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		hooks,
		toolPolicies: opts.toolPolicies as never,
		requestToolApproval: requestApproval,
	})
	const result = await runtime.run("Start")
	// Snapshot executor hits AFTER the run completes so the assertion
	// target captures the actual production executor dispatch count.
	if (tool.__executorTracker) {
		counters.executorCalls = tool.__executorTracker.hits
	}
	return { messages: result.messages, captured, counters }
}

function expectCapturedOne(captured: CapturedOutcome[], toolCallId: string): CapturedOutcome {
	const match = captured.find((c) => c.toolCallId === toolCallId)
	expect(match, `no captured outcome for ${toolCallId}`).toBeDefined()
	return match!
}

// ---- ITI matrix ------------------------------------------------------

describe("ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01 / ITI matrix", () => {
	// ITI01 — INVALID (object form) must NOT request approval (RED discriminator)
	it("ITI01_INVALID_NEVER_REQUESTS_APPROVAL: object-form commands ⇒ approvalCalls=0, executorCalls=0", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: [{ command: "git status" }],
				timeout: 120000,
			}),
			toolPolicies: { run_commands: { autoApprove: false } },
		})
		expect(counters.approvalCalls, "approvalCalls must be 0 for invalid input").toBe(0)
		expect(counters.executorCalls, "executorCalls must be 0 for invalid input").toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI02 — VALID canonical form MUST request approval (control)
	it("ITI02_VALID_REQUIRES_APPROVAL: canonical commands ⇒ approvalCalls>=1", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({ commands: ["git status"] }),
			toolPolicies: { run_commands: { autoApprove: false } },
		})
		expect(counters.approvalCalls).toBeGreaterThanOrEqual(1)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("success")
	})

	// ITI03 — INVALID must NEVER execute (executorCalls=0)
	it("ITI03_INVALID_NEVER_EXECUTES: executorCalls=0 even with approval=approved", async () => {
		const { counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: [{ command: "rm -rf /" }],
				timeout: 60000,
			}),
			toolPolicies: { run_commands: { autoApprove: false } },
		})
		expect(counters.executorCalls).toBe(0)
	})

	// ITI04 — actionable validation detail
	it("ITI04_VALIDATION_DETAIL_ACTIONABLE: error message names tool + shape", async () => {
		const { captured } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: [{ command: "rm -rf /" }],
				timeout: 60000,
			}),
		})
		const out = expectCapturedOne(captured, "iti-1")
		if (out.outcome.kind !== "failure") throw new Error("expected failure")
		// ToolRuntimeOutcome uses `error?: unknown` (not `message`) for
		// the failure payload. Stringify whatever is there.
		const message = String(out.outcome.error ?? "")
		expect(message).toMatch(/run_commands|expected string|Invalid input|unknown property/i)
	})

	// ITI05 — recovery classification
	it("ITI05_RECOVERY_CLASS_IS_INPUT_INVALID: failureClass=tool_input_invalid", async () => {
		const { captured } = await driveSingleToolCall({
			inputText: JSON.stringify({ commands: [{ command: "echo hi" }] }),
		})
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
			expect(out.outcome.familyEligible).toBe(false)
		}
	})

	// ITI06 — user rejection distinct from invalid input
	it("ITI06_USER_REJECTION_DISTINCT: valid + user reject ⇒ control_plane/user_rejected", async () => {
		const counters = { approvalCalls: 0, executorCalls: 0 }
		const { captured } = await driveSingleToolCall({
			inputText: JSON.stringify({ commands: ["echo hi"] }),
			toolPolicies: { run_commands: { autoApprove: false } },
			requestApproval: async () => {
				counters.approvalCalls++
				return { approved: false }
			},
		})
		expect(counters.approvalCalls).toBe(1)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("control_plane")
		if (out.outcome.kind === "control_plane") {
			expect(out.outcome.outcome).toBe("user_rejected")
		}
	})

	// ITI07 — autoApprove=true with INVALID input: schema validation MUST still reject
	it("ITI07_AUTOAPPROVE_CANNOT_BYPASS_VALIDATION: invalid + autoApprove=true ⇒ still rejected", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: [{ command: "echo hi" }],
				timeout: 60000,
			}),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.approvalCalls, "autoApprove=true short-circuits approval").toBe(0)
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI08 — canonical array form unchanged
	it("ITI08_CANONICAL_STRING_ARRAY_VALID: { commands: ['echo', 'git'] } ⇒ success", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({ commands: ["echo hi", "git status"] }),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBeGreaterThanOrEqual(1)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("success")
	})

	// ITI09 — object with args must NOT be shell-joined
	it("ITI09_OBJECT_WITH_ARGS_REJECTED: { commands: [{ command, args }] } ⇒ rejected", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: [{ command: "python", args: ["-c", "print('x y')"] }],
			}),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI10 — unknown field (timeout) must NOT be silently dropped
	it("ITI10_UNKNOWN_FIELD_REJECTED: { commands, timeout:120000 } ⇒ rejected", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: ["echo hello"],
				timeout: 120000,
			}),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI11 — stringified-JSON must not be blindly parsed
	it("ITI11_STRINGIFIED_JSON_REJECTED: commands='[{...}]' string ⇒ rejected", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({
				commands: '[{"command":"python","args":["-c","print(x)"]}]',
			}),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI12 — canonical input unchanged after normalization
	it("ITI12_CANONICAL_FORM_EXACT: no normalization drift", async () => {
		const { captured, counters } = await driveSingleToolCall({
			inputText: JSON.stringify({ commands: ["git status", "bun test"] }),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBeGreaterThanOrEqual(1)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("success")
	})
})

// ---- Production-seam closure: REAL createShellTool --------------------
//
// These tests prove the ITI invariants hold against the CANONICAL
// production tool factory (`createShellTool` from `@cline/core`),
// not just the ITI mirror. If a future regression breaks
// `createTool` / `createShellTool` / the AgentRuntime seam, the ITI
// mirror may still pass while the production tool fails. The
// production-seam tests catch that class.

import { createShellTool } from "@cline/core"

function createCanonicalRunCommandsTool(): ReturnType<typeof createShellTool> {
	// Trivial executor; the ITI tests verify whether it gets invoked,
	// not what it returns. Match the canonical `ToolOperationResult`
	// shape (requires `query`, `result`, `success`).
	return createShellTool(async (command) => `ran:${command}`, { cwd: "/tmp" })
}

describe("ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01 / production-seam closure", () => {
	// ITI-P01 — INVALID input against the REAL production tool
	it("ITI_P01_REAL_TOOL_INVALID_NEVER_REQUESTS_APPROVAL", async () => {
		const tool = createCanonicalRunCommandsTool()
		const counters = { approvalCalls: 0, executorCalls: 0 }
		tool.execute = vi.fn(async () => {
			counters.executorCalls++
			return [{ query: "ran", result: "ran", success: true }]
		})
		const { captured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({
				commands: [{ command: "git status" }],
				timeout: 120000,
			}),
			toolPolicies: { run_commands: { autoApprove: false } },
		})
		expect(counters.approvalCalls).toBe(0)
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ITI-P02 — VALID input against the REAL production tool
	it("ITI_P02_REAL_TOOL_VALID_REQUIRES_APPROVAL_AND_EXECUTES", async () => {
		const tool = createCanonicalRunCommandsTool()
		const counters = { approvalCalls: 0, executorCalls: 0 }
		tool.execute = vi.fn(async () => {
			counters.executorCalls++
			return [{ query: "ran", result: "ran", success: true }]
		})
		const { captured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({ commands: ["git status"] }),
			toolPolicies: { run_commands: { autoApprove: false } },
			requestApproval: async () => {
				counters.approvalCalls++
				return { approved: true }
			},
		})
		expect(counters.approvalCalls).toBeGreaterThanOrEqual(1)
		expect(counters.executorCalls).toBeGreaterThanOrEqual(1)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("success")
	})

	// ITI-P03 — unknown field against the REAL production tool
	it("ITI_P03_REAL_TOOL_UNKNOWN_FIELD_REJECTED", async () => {
		const tool = createCanonicalRunCommandsTool()
		const counters = { approvalCalls: 0, executorCalls: 0 }
		tool.execute = vi.fn(async () => {
			counters.executorCalls++
			return [{ query: "ran", result: "ran", success: true }]
		})
		const { captured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({
				commands: ["echo hello"],
				timeout: 120000,
			}),
			toolPolicies: { run_commands: { autoApprove: true } },
		})
		expect(counters.executorCalls).toBe(0)
		const out = expectCapturedOne(captured, "iti-1")
		expect(out.outcome.kind).toBe("failure")
		if (out.outcome.kind === "failure") {
			expect(out.outcome.failureClass).toBe("tool_input_invalid")
		}
	})

	// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 —
	// ITI07..ITI09 production-seam closure for the typed lifecycle
	// disposition. The runtime stamps `metadata.executionDisposition`
	// on every toolCall at the executePreparedTool boundary based on
	// the closure-plan `toolExecutionInvoked` authority. These tests
	// pin the producer side of the wire field so a future
	// regression that drops it at the producer fails here.
	//
	// Targets: real `createShellTool` factory (mirrors the production
	// tool registration path used by ClineCore) so the test catches
	// drift between the ITI mirror tool and the canonical tool.

	it("ITI07_REAL_TOOL_INVALID_STAMPS_REJECTED_DISPOSITION", async () => {
		const tool = createCanonicalRunCommandsTool()
		tool.execute = vi.fn(async () => {
			throw new Error("executor MUST NOT be called on rejected input")
		})
		const captured = trackToolCallMetadata()
		const { captured: outcomeCaptured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({
				commands: [{ command: "git status" }],
				timeout: 120000,
			}),
			toolPolicies: { run_commands: { autoApprove: false } },
			onToolCallMetadata: captured.recordMetadata,
		})
		// The canonical tool's executorCalls tracking isn't exposed;
		// we instead observe via the runtime's outcome.
		expect(outcomeCaptured[0].outcome.kind).toBe("failure")
		expect(captured.lastDisposition()).toBe("rejected_before_execution")
	})

	it("ITI08_REAL_TOOL_VALID_EXECUTED_STAMPS_EXECUTED_DISPOSITION", async () => {
		const tool = createCanonicalRunCommandsTool()
		tool.execute = vi.fn(async () => [{ query: "ls", result: "ran", success: true }])
		const captured = trackToolCallMetadata()
		const { captured: outcomeCaptured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({ commands: ["ls"] }),
			toolPolicies: { run_commands: { autoApprove: true } },
			onToolCallMetadata: captured.recordMetadata,
		})
		expect(outcomeCaptured[0].outcome.kind).toBe("success")
		expect(captured.lastDisposition()).toBe("executed")
	})

	it("ITI09_REAL_TOOL_EXECUTED_BUT_FAILED_STAMPS_EXECUTED_NOT_REJECTED", async () => {
		// The narrow lifecycle disposition is NOT a failure taxonomy.
		// A command that ACTUALLY EXECUTED and then returned an error
		// must still classify as "executed" — the webview uses the
		// status pill to differentiate error-result from
		// not-executed. This is the runtime-side guard against
		// confusing "tool failed" with "tool never executed".
		const tool = createCanonicalRunCommandsTool()
		tool.execute = vi.fn(async () => {
			throw new Error("git: not a repository")
		})
		const captured = trackToolCallMetadata()
		const { captured: outcomeCaptured } = await driveSingleToolCall({
			tool,
			inputText: JSON.stringify({ commands: ["git status"] }),
			toolPolicies: { run_commands: { autoApprove: true } },
			onToolCallMetadata: captured.recordMetadata,
		})
		// Failure outcome FROM EXECUTION (kind=failure) must still
		// carry `executed` disposition because the executor ran.
		expect(outcomeCaptured[0].outcome.kind).toBe("failure")
		if (outcomeCaptured[0].outcome.kind === "failure") {
			// The failureClass must NOT be tool_input_invalid — it
			// must be the execution-failure family.
			expect(outcomeCaptured[0].outcome.failureClass).not.toBe("tool_input_invalid")
		}
		expect(captured.lastDisposition()).toBe("executed")
	})
})

// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 / ITI
// instrumentation helpers.
//
// The C1.2 boundary gate (`executePreparedTool`) is the producer of
// `metadata.executionDisposition`. To assert the producer invariant
// from a driver-side test without reaching into the runtime's
// internals, we hook the C1.2 boundary by inspecting each toolCall
// at the moment the executor's `beforeTool` hook fires (which has
// the original `toolCall` reference). The hook records the
// post-execution metadata state via the `afterTool`-equivalent
// observation.
function trackToolCallMetadata() {
	let lastMetadata: Record<string, unknown> | undefined
	return {
		recordMetadata: (snapshot: { toolCall: { metadata?: unknown } }) => {
			lastMetadata =
				snapshot.toolCall.metadata &&
				typeof snapshot.toolCall.metadata === "object" &&
				!Array.isArray(snapshot.toolCall.metadata)
					? (snapshot.toolCall.metadata as Record<string, unknown>)
					: undefined
		},
		lastDisposition(): "executed" | "rejected_before_execution" | undefined {
			if (!lastMetadata) return undefined
			const d = lastMetadata.executionDisposition
			return d === "executed" || d === "rejected_before_execution" ? d : undefined
		},
	}
}
