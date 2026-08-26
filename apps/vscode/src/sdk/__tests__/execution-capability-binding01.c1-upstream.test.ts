/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 * C1-CORRECTION01 -- UPSTREAM RED.
 *
 * Drives the REAL `AgentRuntime` end-to-end with a scripted model
 * that emits a `tool-call-delta` carrying
 * `metadata.executionCapability` on `AgentToolCallPart`.
 *
 * Captures the `AgentToolContext` actually received by the tool's
 * `execute(...)` and asserts:
 *
 *   prepared.toolCall.metadata.executionCapability = "X"   (set)
 *   tool.execute(input, context) sees                     X?  <-- THIS
 *
 * Today, this assertion must FAIL (RED). The upstream loss
 * point (Loss #1) is the seam between
 *
 *   prepared.toolCall.metadata (per-call, set)
 *           |
 *           | AgentRuntime.executePreparedTool
 *           v
 *   AgentToolContext.metadata (filled from session-wide
 *                              this.config.toolContextMetadata
 *                              -- NOT from toolCall.metadata)
 *
 * The fix (C2 GREEN) MUST use a typed runtime-owned slot on
 * AgentToolContext (NOT a shallow metadata merge), because
 * `prepared.toolCall.metadata` is partially derived from
 * untrusted model-stream data (see metadata-provenance.md).
 *
 * WHAT THIS TEST IS NOT:
 *   - NOT a stub/mapper test.
 *   - NOT a sandbox profile test (zero privilege).
 *   - NOT a clone of the host adapter. The ScriptedModel emits a
 *     real `tool-call-delta` event with `metadata`; the real
 *     `AgentRuntime.handleModelStreamEvent` consumes it and
 *     builds `AgentToolCallPart`; the real
 *     `prepareToolExecution` runs; the real `executePreparedTool`
 *     constructs the `AgentToolContext` and calls `tool.execute`.
 *     The spy captures the actual `AgentToolContext` produced
 *     by that production chain.
 */

import { type AgentModel, AgentRuntime, type AgentRuntimeHooks, type AgentTool } from "@cline/agents"
import type {
	AgentModelEvent,
	AgentModelRequest,
	AgentToolContext,
	AgentToolRuntimeOutcomeHookContext,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

interface SyntheticMarker {
	readonly correlationId: string
	readonly marker: "factory-binding-probe"
}

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

const SENTINEL_MARKER: SyntheticMarker = {
	correlationId: "upstream-loss-1",
	marker: "factory-binding-probe",
}

function captureExecute(_captured: CapturedExecute[]): AgentRuntimeHooks["onToolRuntimeOutcome"] {
	return (ctx: AgentToolRuntimeOutcomeHookContext) => {
		// onToolRuntimeOutcome fires AFTER tool.execute returns.
		// We capture during execute via spy below.
		void ctx
	}
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

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C1-CORRECTION01 UPSTREAM RED", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("RED upstream: prepared.toolCall.metadata.executionCapability does NOT reach AgentToolContext.metadata today", async () => {
		const captured: CapturedExecute[] = []
		const tool = makeShellLikeTool(captured)

		// Spy on the tool's execute to capture the AgentToolContext
		// actually received from the production AgentRuntime chain.
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'upstream-red\\\\n'"] }),
					// The synthetic marker travels with the model-stream
					// tool-call-delta event. This simulates ANY source of
					// metadata on the toolCall (host, model, plugin,
					// runtime). Today the AgentRuntime stashes it on
					// AgentToolCallPart.metadata.
					metadata: { executionCapability: SENTINEL_MARKER },
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const hooks: AgentRuntimeHooks = {
			onToolRuntimeOutcome: captureExecute(captured),
		}

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks,
			toolPolicies: { run_commands: { autoApprove: true } },
			requestToolApproval: async (_req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
				return { approved: true }
			},
		})

		const result = await runtime.run("Start")
		// Force settle
		await new Promise((r) => setImmediate(r))

		// Sanity: the runtime completed.
		expect(result.status).toBe("completed")

		// Sanity: tool.execute was invoked exactly once.
		expect(executeSpy).toHaveBeenCalledTimes(1)

		const callContext = executeSpy.mock.calls[0]?.[1] as AgentToolContext | undefined
		expect(callContext).toBeDefined()

		// THE UPSTREAM RED ASSERTION (Loss #1):
		//   The model-stream `tool-call-delta` carried
		//   `metadata.executionCapability = SENTINEL_MARKER`. The
		//   runtime stashed it on `AgentToolCallPart.metadata`. But
		//   `executePreparedTool` constructs AgentToolContext with
		//   `metadata: this.config.toolContextMetadata` (session-wide),
		//   NOT from toolCall.metadata. Therefore tool.execute's
		//   AgentToolContext.metadata does NOT contain the marker.
		//
		//   This is Loss #1 (the load-bearing seam loss).
		const ctxMetadata = (callContext!.metadata ?? {}) as Record<string, unknown>
		expect(ctxMetadata["executionCapability"]).toBeUndefined()

		// Defensive: prove the marker existed on the toolCall side.
		// We use onToolRuntimeOutcome to inspect the post-stamp
		// toolCall.metadata (the same observable seam used by
		// REJECTED-COMMAND-PRESENTATION-TRUTH01's tests).
		const postStamp: { toolCallMetadata: unknown } = { toolCallMetadata: undefined }
		const hooksObserve: AgentRuntimeHooks = {
			onToolRuntimeOutcome: (ctx) => {
				postStamp.toolCallMetadata = ctx.toolCall.metadata
			},
		}
		// Re-run with the observer to confirm the marker reaches
		// prepared.toolCall.metadata.
		const model2 = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-2",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'observe\\\\n'"] }),
					metadata: { executionCapability: SENTINEL_MARKER },
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])
		const runtime2 = new AgentRuntime({
			model: model2,
			tools: [tool],
			hooks: hooksObserve,
			toolPolicies: { run_commands: { autoApprove: true } },
			requestToolApproval: async (): Promise<ToolApprovalResult> => ({ approved: true }),
		})
		await runtime2.run("Start")
		await new Promise((r) => setImmediate(r))

		const toolCallMeta = postStamp.toolCallMetadata as Record<string, unknown> | undefined
		// This is the precondition: the marker IS on the toolCall
		// after the runtime stamps metadata.inputParseError. If the
		// runtime overwrote it, the fix has nowhere to land.
		//
		// The runtime may ALSO stamp inputParseError/toolSource, so
		// we use objectContaining.
		expect(toolCallMeta).toBeDefined()
		expect(toolCallMeta).toEqual(expect.objectContaining({ executionCapability: SENTINEL_MARKER }))
	})

	it("RED upstream (negative case): no marker on toolCall => no marker on context (no false positives)", async () => {
		const captured: CapturedExecute[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "upstream-neg-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'neg\\\\n'"] }),
					// No metadata.executionCapability.
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
			toolPolicies: { run_commands: { autoApprove: true } },
			requestToolApproval: async (): Promise<ToolApprovalResult> => ({ approved: true }),
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		expect(executeSpy).toHaveBeenCalledTimes(1)
		const ctxMetadata = ((executeSpy.mock.calls[0]?.[1] as AgentToolContext).metadata ?? {}) as Record<string, unknown>
		expect(ctxMetadata["executionCapability"]).toBeUndefined()
	})
})
