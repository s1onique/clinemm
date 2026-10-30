/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01-CORRECTION01
 * (TES-OUT-01-CORR01)
 *
 * P0 — `HALT_OBSERVER_EXECUTION_COUPLING`.
 *
 * The original ACT claimed the typed runtime-outcome observer is READ-ONLY
 * and therefore "can never influence tool execution". That claim was only
 * true of its RETURN VALUE. The production seam AWAITS every registered
 * hook:
 *
 *   AgentRuntime.executePreparedTool
 *     -> await this.notifyToolRuntimeOutcome(prepared.toolCall, runtimeOutcome)
 *        -> for (const hook of this.hooks.onToolRuntimeOutcome) await hook(...)
 *
 * and the host composed its telemetry observer like this:
 *
 *   onToolRuntimeOutcome: async (ctx) => {
 *     await existing?.(ctx)
 *     await observer(ctx)      // <-- unbounded, un-isolated
 *   }
 *
 * So a THROWING (or rejecting) telemetry observer propagates out of
 * `executePreparedTool` AFTER the tool already produced its outcome: the
 * tool-execution path is rejected, the run aborts, and the "read-only"
 * conservation claim is false.
 *
 * This suite is the bounded RED/GREEN witness:
 *
 *   - It drives the REAL `AgentRuntime` (no fake runtime, no stub seam).
 *   - It attaches the REAL composed hook produced by the REAL
 *     `SdkSessionConfigBuilder` (the exact production composition
 *     boundary under correction).
 *   - It asserts the tool result, the subsequent execution, and the runtime
 *     completion are UNCHANGED when the observer throws.
 *
 * Scope: no telemetry redesign, no broad recon. The correction is limited to
 * making the NEWLY ATTACHED host telemetry observer synchronous,
 * exception-isolated and non-blocking while preserving the existing hook
 * semantics.
 */
import { type AgentModel, AgentRuntime, type AgentRuntimeHooks } from "@cline/agents"
import type {
	AgentMessage,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	AgentToolResultPart,
	ToolRuntimeOutcome,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({})),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

vi.mock("../hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}))

// ---------------------------------------------------------------------------
// scripted model
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

function toolCallStep(toolCallId: string, toolName: string, input: unknown) {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		} as AgentModelEvent,
		{ type: "finish", reason: "tool-calls" } as AgentModelEvent,
	]
}

function textFinishStep() {
	return () => [{ type: "text-delta", text: "done" } as AgentModelEvent, { type: "finish", reason: "stop" } as AgentModelEvent]
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

function createEchoTool(): AgentTool<{ text: string }, { echoed: string }> {
	return {
		name: "echo",
		description: "Echoes input back",
		inputSchema: { type: "object" },
		async execute(input) {
			return { echoed: input.text }
		},
	}
}

function createThrowingTool(): AgentTool<{ text: string }, never> {
	return {
		name: "boom",
		description: "Throws",
		inputSchema: { type: "object" },
		async execute() {
			throw new Error("tool exploded")
		},
	}
}

// ---------------------------------------------------------------------------
// production composition helper
// ---------------------------------------------------------------------------

/**
 * Build the REAL composed `onToolRuntimeOutcome` hook the production
 * `SdkSessionConfigBuilder` attaches, then hand it to the REAL
 * `AgentRuntime` exactly as the SDK does.
 */
async function buildProductionHooks(opts: {
	observer: NonNullable<AgentRuntimeHooks["onToolRuntimeOutcome"]>
	existing?: NonNullable<AgentRuntimeHooks["onToolRuntimeOutcome"]>
}): Promise<AgentRuntimeHooks> {
	mocks.buildAgentHooks.mockReturnValueOnce(opts.existing ? { onToolRuntimeOutcome: opts.existing } : {})
	mocks.buildSessionConfig.mockResolvedValueOnce({ hooks: {} })

	const builder = new SdkSessionConfigBuilder({
		stateManager: {} as never,
		emitHookMessage: vi.fn(),
		onToolRuntimeOutcome: opts.observer,
	})
	const config = await builder.build({ cwd: "/workspace", mode: "act" })
	return (config.hooks ?? {}) as AgentRuntimeHooks
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

interface DriveResult {
	messages: readonly AgentMessage[]
	runError: unknown
}

async function drive(opts: {
	hooks: AgentRuntimeHooks
	// biome-ignore lint/suspicious/noExplicitAny: test tools have heterogeneous input/output shapes
	tools: AgentTool<any, any>[]
	toolCallId: string
	toolName: string
	input: unknown
}): Promise<DriveResult> {
	const model = new ScriptedModel([toolCallStep(opts.toolCallId, opts.toolName, opts.input), textFinishStep()])
	const runtime = new AgentRuntime({
		model,
		tools: opts.tools,
		hooks: opts.hooks,
		toolPolicies: { "*": { autoApprove: true } } as never,
	})
	try {
		const result = await runtime.run("Start")
		return { messages: result.messages, runError: undefined }
	} catch (error) {
		return { messages: [], runError: error }
	}
}

function toolResultMessages(messages: readonly AgentMessage[]): AgentToolResultPart[] {
	const results: AgentToolResultPart[] = []
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === "tool-result") {
				results.push(part)
			}
		}
	}
	return results
}

// ---------------------------------------------------------------------------
// suite
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01-CORRECTION01 / observer execution neutrality", () => {
	beforeEach(() => {
		mocks.buildSessionConfig.mockReset()
		mocks.buildAgentHooks.mockReset()
		mocks.buildAgentHooks.mockReturnValue({})
	})

	it("TESOUTCORR01-01 (RED): a throwing host observer must NOT change the tool result, the subsequent execution, or the runtime completion", async () => {
		const observer = vi.fn(() => {
			throw new Error("telemetry observer exploded")
		})
		const hooks = await buildProductionHooks({ observer })

		const { messages, runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-throw-1",
			toolName: "echo",
			input: { text: "hello" },
		})

		// The observer WAS invoked (the seam is wired).
		expect(observer).toHaveBeenCalledTimes(1)

		// The runtime MUST complete normally — a throwing read-only
		// observer can never abort the run.
		expect(runError).toBeUndefined()

		// The tool result MUST be the tool's own result.
		const results = toolResultMessages(messages)
		expect(results).toHaveLength(1)
		expect(results[0]?.toolCallId).toBe("call-throw-1")
		expect(JSON.stringify(results[0]?.output)).toContain("hello")
		expect(results[0]?.isError).not.toBe(true)
	})

	it("TESOUTCORR01-02: a rejecting (async) host observer must NOT change the tool result or the runtime completion", async () => {
		const observer = vi.fn(async () => {
			await Promise.reject(new Error("telemetry observer rejected"))
		})
		const hooks = await buildProductionHooks({ observer })

		const { messages, runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-throw-2",
			toolName: "echo",
			input: { text: "world" },
		})

		expect(observer).toHaveBeenCalledTimes(1)
		expect(runError).toBeUndefined()
		const results = toolResultMessages(messages)
		expect(results).toHaveLength(1)
		expect(JSON.stringify(results[0]?.output)).toContain("world")
		expect(results[0]?.isError).not.toBe(true)
	})

	it("TESOUTCORR01-03: a throwing host observer must NOT change the RUNTIME FAILURE classification or the tool error result", async () => {
		const observer = vi.fn(() => {
			throw new Error("telemetry observer exploded")
		})
		const hooks = await buildProductionHooks({ observer })

		const { messages, runError } = await drive({
			hooks,
			tools: [createThrowingTool()],
			toolCallId: "call-throw-3",
			toolName: "boom",
			input: { text: "x" },
		})

		expect(observer).toHaveBeenCalledTimes(1)
		expect(runError).toBeUndefined()
		const results = toolResultMessages(messages)
		expect(results).toHaveLength(1)
		expect(results[0]?.isError).toBe(true)
	})

	it("TESOUTCORR01-04: the EXISTING hook semantics are preserved — the existing hook still runs", async () => {
		const existing = vi.fn(async () => {})
		const observer = vi.fn(() => {
			throw new Error("telemetry observer exploded")
		})
		const hooks = await buildProductionHooks({ observer, existing })

		const { runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-throw-4",
			toolName: "echo",
			input: { text: "ok" },
		})

		// The pre-existing hook still runs — the correction must not
		// silently disable it.
		expect(existing).toHaveBeenCalledTimes(1)
		expect(runError).toBeUndefined()
	})

	it("TESOUTCORR01-05: the host telemetry observer is NOT awaited as a diagnostic operation (non-blocking)", async () => {
		let observerSettled = false
		const observer = vi.fn(() => {
			// A long-running observer must not extend the tool call.
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					observerSettled = true
					resolve()
				}, 50)
			})
		})
		const hooks = await buildProductionHooks({ observer })

		const started = Date.now()
		const { messages, runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-throw-5",
			toolName: "echo",
			input: { text: "fast" },
		})
		const elapsed = Date.now() - started

		expect(runError).toBeUndefined()
		const results = toolResultMessages(messages)
		expect(results).toHaveLength(1)
		// The runtime did NOT wait for the observer's promise to settle.
		expect(elapsed).toBeLessThan(50)
		expect(observerSettled).toBe(false)
	})

	it("TESOUTCORR01-06: the observer still receives the authoritative typed outcome (the typed projection is preserved)", async () => {
		const seen: ToolRuntimeOutcome[] = []
		const observer = vi.fn((ctx: { outcome: ToolRuntimeOutcome }) => {
			seen.push(ctx.outcome)
		})
		const hooks = await buildProductionHooks({ observer })

		const { runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-throw-6",
			toolName: "echo",
			input: { text: "typed" },
		})

		expect(runError).toBeUndefined()
		expect(seen).toHaveLength(1)
		expect(seen[0]?.kind).toBe("success")
		expect(seen[0]?.toolCallId).toBe("call-throw-6")
	})

	it("TESOUTCORR01-07: legacy TaskHeader conservation — the V1 mechanism strip is unchanged and the V2 projection still conserves against toolCalls", async () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-corr01", 1_700_000_000_000)

		// The host counts the canonical tool start (`content_start(tool)`).
		tracker.recordToolStartedWithIdentity("echo", "call-conserve-1")

		// The host's REAL observer wiring, exactly as `SdkController`
		// attaches it: the typed outcome joined on the runtime's own
		// `toolCallId`.
		const observer = vi.fn((ctx: { outcome: ToolRuntimeOutcome; toolCall: { toolCallId: string } }) => {
			tracker.recordToolRuntimeOutcome(ctx.outcome, ctx.toolCall.toolCallId)
		})
		const hooks = await buildProductionHooks({ observer })

		const { runError } = await drive({
			hooks,
			tools: [createEchoTool()],
			toolCallId: "call-conserve-1",
			toolName: "echo",
			input: { text: "conserve" },
		})

		expect(runError).toBeUndefined()
		expect(observer).toHaveBeenCalledTimes(1)

		const strip = tracker.get()
		// The V1 mechanism strip is UNCHANGED by the correction.
		expect(strip?.toolCalls).toBe(1)
		expect(strip?.mechanism).toBeDefined()
		// The V2 projection still conserves: succeeded + failed + pending
		// + unknown === toolCalls.
		const outcome = strip?.outcome
		expect(outcome).toBeDefined()
		const sum = (outcome?.succeeded ?? 0) + (outcome?.failed ?? 0) + (outcome?.pending ?? 0) + (outcome?.unknown ?? 0)
		expect(sum).toBe(strip?.toolCalls)
		expect(outcome?.succeeded).toBe(1)
	})
})
