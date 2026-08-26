/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 *
 * C2 GREEN -- Upstream half: typed slot now crosses the seam.
 *
 * Drives the REAL `AgentRuntime` end-to-end with a scripted model
 * that emits a `tool-call-delta`. The host's `requestToolApproval`
 * callback returns an `InternalExecutionCapability` payload (the
 * trusted channel). The runtime captures it on `prepared` and
 * stamps it into `AgentToolContext.executionCapability` (the closed
 * typed slot).
 *
 * The test asserts:
 *   prepared.toolCall.metadata.executionCapability = X  (set by model)
 *   tool.execute(input, context).executionCapability = Y (set by host)
 *
 * where Y is what the HOST callback returned (the trusted source)
 * and X is what arrived via the model stream. The two are
 * intentionally different in the privilege-provenance discriminator
 * test (c2-green-discriminator.test.ts) but equal here.
 *
 * The real production seam (AgentRuntime -> handleModelStreamEvent ->
 * prepareToolExecution -> executePreparedTool -> tool.execute) is
 * exercised end-to-end via the @cline/agents dist.
 */

import { type AgentModel, AgentRuntime, type AgentRuntimeHooks, type AgentTool } from "@cline/agents"
import type {
	AgentModelEvent,
	AgentModelRequest,
	AgentToolContext,
	AgentToolRuntimeOutcomeHookContext,
	InternalExecutionCapability,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

interface CapturedExecute {
	toolCallId: string
	input: unknown
	context: AgentToolContext
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

const TRUSTED_MARKER: InternalExecutionCapability = {
	kind: "factory-binding-probe",
	correlationId: "upstream-c2-trusted-A",
}

function makeShellLikeTool(captured: CapturedExecute[]): AgentTool<unknown, unknown> {
	const tool: AgentTool<unknown, unknown> = {
		name: "run_commands",
		description: "synthetic",
		inputSchema: { type: "object" },
		async execute(input: unknown, context: AgentToolContext) {
			captured.push({ toolCallId: context.toolCallId ?? "<no-id>", input, context })
			return { output: [{ query: "ok", result: "ok", success: true }] }
		},
	}
	return tool
}

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C2 GREEN (upstream)", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("GREEN: host-supplied executionCapability crosses the seam into AgentToolContext.executionCapability", async () => {
		const captured: CapturedExecute[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'upstream-green\\n'"] }),
					// Note: the model emits a MALICIOUS metadata.executionCapability
					// here on purpose -- the discriminator test asserts this
					// does NOT reach AgentToolContext.executionCapability.
					// This test (positive) sets the model metadata to undefined
					// so the assertion is clean: only the host's callback
					// crosses the seam.
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const hooks: AgentRuntimeHooks = {
			onToolRuntimeOutcome: (ctx: AgentToolRuntimeOutcomeHookContext) => {
				void ctx
			},
		}

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks,
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async (_req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
				// The TRUSTED host channel: the runtime stamps this
				// into AgentToolContext.executionCapability.
				return { approved: true, executionCapability: TRUSTED_MARKER }
			},
		})

		const result = await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		expect(result.status).toBe("completed")
		expect(executeSpy).toHaveBeenCalledTimes(1)

		const ctx = executeSpy.mock.calls[0]?.[1] as AgentToolContext | undefined
		expect(ctx).toBeDefined()

		// THE GREEN ASSERTION:
		//   The typed slot now carries the host's trusted marker.
		expect(ctx!.executionCapability).toEqual(TRUSTED_MARKER)

		// The generic metadata bag is unchanged (session-wide).
		expect((ctx!.metadata ?? {})["executionCapability"]).toBeUndefined()
	})

	it("GREEN negative: host callback returns no executionCapability -> typed slot is undefined", async () => {
		const captured: CapturedExecute[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-neg-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'neg\\n'"] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async (): Promise<ToolApprovalResult> => {
				// No executionCapability.
				return { approved: true }
			},
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		expect(executeSpy).toHaveBeenCalledTimes(1)
		const ctx = executeSpy.mock.calls[0]?.[1] as AgentToolContext
		expect(ctx.executionCapability).toBeUndefined()
	})

	it("GREEN: host callback DENIES -> typed slot stays undefined (fail-closed)", async () => {
		// The fail-closed contract: when the host denies the call, the
		// runtime MUST NOT propagate any executionCapability forward.
		const captured: CapturedExecute[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-denied-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'denied\\n'"] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async (): Promise<ToolApprovalResult> => {
				// Deny with executionCapability set -- the runtime
				// MUST NOT stamp it because approval is denied.
				return {
					approved: false,
					reason: "host denied",
					decision: { kind: "deny", reason: "host denied", source: "test" },
					executionCapability: TRUSTED_MARKER,
				}
			},
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		// The runtime rejected the call, so tool.execute was NEVER
		// called. The executionCapability must not have leaked into
		// any other tool invocation either.
		expect(executeSpy).not.toHaveBeenCalled()
	})
})
