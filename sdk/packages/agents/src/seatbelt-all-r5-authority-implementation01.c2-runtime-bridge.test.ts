/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * CORRECTION02 (AGENT_RUNTIME_TRANSPORT) --
 * Witness B.
 *
 * Reviewer disposition (2026-08-30) on CORRECTION01:
 *
 *   "The summary says 'real approval -> AgentToolContext.mandatorySeatbeltExecution
 *    -> CommandJobManager.start()' but the test actually does this:
 *
 *      const approval = evaluateCommandToolApproval(...)
 *      manager.start(..., {
 *          mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution,
 *      })
 *
 *    That is still manually connecting the two ends. It does NOT
 *    exercise the production bridge you added in agent-runtime.ts.
 *    The source changes may well be correct, but that file is
 *    body-suppressed in the digest and there is no executable
 *    witness traversing it."
 *
 * This test exercises the real production bridge end-to-end:
 *
 *   requestToolApproval (returns ToolApprovalResult with the flag)
 *     -> prepareToolExecution (captures the flag from approval)
 *     -> executePreparedTool (stamps the flag into AgentToolContext)
 *     -> tool.execute(input, context)  [executor DI seam]
 *     -> captured context.mandatorySeatbeltExecution
 *
 * The reviewer's hint: "Capture the context at the existing command
 * executor DI seam." `createRunCommandsTool(executor)` is exactly
 * that seam. The executor's mock captures the second argument of
 * `tool.execute(input, context)`, which is the AgentToolContext
 * passed into the executor. Asserting
 * `executor.mock.calls[0][1].mandatorySeatbeltExecution === true`
 * proves the real bridge carried the flag from the host's approval
 * callback into the executor's typed context.
 *
 * Two cases:
 *
 *   B1 REAL: the host's approval returns mandatorySeatbeltExecution=true
 *     (which is what `applySeatbeltAuthorityEnvelope` produces when
 *      Seatbelt is selected and the session override is "all"). The
 *     AgentRuntime drives a run_commands tool through the real bridge.
 *     The executor receives context.mandatorySeatbeltExecution=true.
 *
 *   B2 SPURIOUS: the host's approval returns approved=true with NO
 *     mandatorySeatbeltExecution field (the pre-fix behavior). The
 *     executor receives context.mandatorySeatbeltExecution=undefined.
 *     Proves the stamp does NOT carry a "true" by default -- it has
 *     to come from the trusted host-attached channel.
 */
import { describe, expect, it, vi } from "vitest"
import { AgentRuntime } from "./agent-runtime"
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ITelemetryService,
} from "@cline/shared"
import type { ToolApprovalResult } from "@cline/shared"

// Local ScriptedModel pattern (matches agent-runtime.command-policy.test.ts).
class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = []

	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) {
			throw new Error("No scripted model step available")
		}
		return toAsyncIterable(step(request))
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event
	}
}

function createTelemetryMock() {
	const capture = vi.fn()
	return {
		capture,
		telemetry: {
			capture,
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService,
	}
}

function createRunCommandsTool(executor: ReturnType<typeof vi.fn>): AgentTool {
	return {
		name: "run_commands",
		description: "Run shell commands",
		inputSchema: { type: "object" },
		execute: executor,
	} as unknown as AgentTool
}
describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C2 - Witness B runtime bridge", () => {
	it("B1 REAL: host approval with mandatorySeatbeltExecution=true reaches the executor's AgentToolContext", async () => {
		const executor = vi.fn(async () => ({ output: "ok" }))
		const tool = createRunCommandsTool(executor)

		// The trusted host-attached channel. The SdkController's
		// resolveHostAuthorization returns a ToolApprovalResult whose
		// `mandatorySeatbeltExecution` is the result of
		// `applySeatbeltAuthorityEnvelope` (CORRECTION02 producer).
		const requestToolApproval = vi.fn(
			async (): Promise<ToolApprovalResult> => ({
				approved: true,
				mandatorySeatbeltExecution: true,
			}),
		)

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_sb",
					toolName: "run_commands",
					input: { command: "/bin/echo hi", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		])

		const runtime = new AgentRuntime({
			sessionId: "sess_sb",
			agentId: "agent_sb",
			conversationId: "conv_sb",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		})

		await runtime.run("echo hi")

		expect(requestToolApproval).toHaveBeenCalledTimes(1)
		expect(executor).toHaveBeenCalledTimes(1)
		// The executor receives (input, context). Capture the context.
		const contextArg = executor.mock.calls[0]?.[1] as {
			mandatorySeatbeltExecution?: boolean
		}
		expect(contextArg).toBeDefined()
		expect(contextArg.mandatorySeatbeltExecution).toBe(true)
	})

	it("B2 SPURIOUS: host approval without the flag does NOT stamp it onto the executor's context", async () => {
		const executor = vi.fn(async () => ({ output: "ok" }))
		const tool = createRunCommandsTool(executor)

		const requestToolApproval = vi.fn(
			async (): Promise<ToolApprovalResult> => ({
				approved: true,
				// mandatorySeatbeltExecution: omitted by design (legacy
				// path; no Seatbelt envelope active).
			}),
		)

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_sb_legacy",
					toolName: "run_commands",
					input: { command: "/bin/echo hi", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		])

		const runtime = new AgentRuntime({
			sessionId: "sess_sb_legacy",
			agentId: "agent_sb",
			conversationId: "conv_sb_legacy",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		})

		await runtime.run("echo hi")

		expect(requestToolApproval).toHaveBeenCalledTimes(1)
		expect(executor).toHaveBeenCalledTimes(1)
		const contextArg = executor.mock.calls[0]?.[1] as {
			mandatorySeatbeltExecution?: boolean
		}
		expect(contextArg).toBeDefined()
		expect(contextArg.mandatorySeatbeltExecution).toBeUndefined()
	})
})