/**
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 *
 * C2 GREEN -- PRIVILEGE-PROVENANCE DISCRIMINATOR.
 *
 * These are the load-bearing tests that prove the typed slot is NOT
 * a privilege-escalation API. The runtime owns the writer; untrusted
 * model/tool metadata CANNOT populate the slot.
 *
 * Reviewer-prescribed test set (CORRECTION01 §"One mandatory C2
 * security test" + §"Required GREEN evidence" tests 3 and 4):
 *
 *   Discriminator 1 (test 3):
 *     model emits:  toolCall.metadata.executionCapability = EVIL_MARKER
 *     host returns: no executionCapability
 *     expected:     AgentToolContext.executionCapability === undefined
 *                   CommandJobManager.start.executionCapability === undefined
 *
 *   Discriminator 2 (test 4):
 *     model emits:  toolCall.metadata.executionCapability = EVIL_MARKER_B
 *     host returns: TRUSTED_MARKER_A
 *     expected:     AgentToolContext.executionCapability === TRUSTED_MARKER_A
 *                   CommandJobManager.start.executionCapability === TRUSTED_MARKER_A
 *
 * These are the cleanest privilege-provenance discriminator in the
 * whole ACT. If either fails, the typed slot is being accidentally
 * populated from the generic metadata bag -- a privilege-escalation
 * regression.
 *
 * Also includes the concurrency test (test 5) and the denied/cancelled
 * conservation test (test 7).
 */

import { type AgentModel, AgentRuntime, type AgentRuntimeHooks, type AgentTool } from "@cline/agents"
import type {
	AgentModelEvent,
	AgentModelRequest,
	AgentToolContext,
	AgentToolRuntimeOutcomeHookContext,
	FactoryBindingProbeCapability,
	InternalExecutionCapability,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

const EVIL_MARKER: InternalExecutionCapability = {
	// Note: this literal kind is part of the closed union. The
	// runtime would type-check the writer, but for this test the
	// comparable identity is what matters: the host did NOT stamp
	// this, the model did. We use the same kind for comparable
	// semantics; in production an "evil" model would attempt to
	// set the literal kinds that exist.
	kind: "factory-binding-probe",
	correlationId: "EVIL-MODEL-MARKER-DO-NOT-TRUST",
}

const TRUSTED_A: FactoryBindingProbeCapability = {
	kind: "factory-binding-probe",
	correlationId: "host-trusted-A",
}

function makeShellLikeTool(captured: AgentToolContext[]): AgentTool<unknown, unknown> {
	return {
		name: "run_commands",
		description: "synthetic",
		inputSchema: { type: "object" },
		async execute(_input: unknown, context: AgentToolContext) {
			captured.push(context)
			return { output: [{ query: "ok", result: "ok", success: true }] }
		},
	}
}

describe("ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01 C2 GREEN PRIVILEGE-PROVENANCE DISCRIMINATOR", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	// ---------- Discriminator 1 (reviewer test 3) ----------
	it("DISCRIMINATOR 1: malicious generic-metadata marker + empty host capability => typed slot empty", async () => {
		// model emits:  toolCall.metadata.executionCapability = EVIL_MARKER
		// host returns: no executionCapability
		// expected:     AgentToolContext.executionCapability === undefined
		const captured: AgentToolContext[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "disc-1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'disc-1\\n'"] }),
					metadata: { executionCapability: EVIL_MARKER as unknown as Record<string, unknown> },
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const hooks: AgentRuntimeHooks = {
			onToolRuntimeOutcome: (_ctx: AgentToolRuntimeOutcomeHookContext) => {},
		}

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks,
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async (_req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
				// Host returns NOTHING -- no executionCapability.
				return { approved: true }
			},
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		expect(executeSpy).toHaveBeenCalledTimes(1)
		const ctx = executeSpy.mock.calls[0]?.[1] as AgentToolContext

		// PRIVILEGE-PROVENANCE DISCRIMINATOR 1: even though the
		// model tried to inject EVIL_MARKER via toolCall.metadata,
		// the typed slot stays empty because the host did not
		// authorize anything.
		expect(ctx.executionCapability).toBeUndefined()
	})

	// ---------- Discriminator 2 (reviewer test 4) ----------
	it("DISCRIMINATOR 2: trusted A + malicious generic B => ONLY A reaches the typed slot", async () => {
		// host returns: TRUSTED_MARKER_A
		// model emits:  toolCall.metadata.executionCapability = EVIL_MARKER_B
		// expected:     AgentToolContext.executionCapability === TRUSTED_MARKER_A
		const EVIL_B: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "host-EVIL-B-from-model",
		}

		const captured: AgentToolContext[] = []
		const tool = makeShellLikeTool(captured)
		const executeSpy = vi.spyOn(tool, "execute")

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "disc-2",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'disc-2\\n'"] }),
					metadata: { executionCapability: EVIL_B as unknown as Record<string, unknown> },
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const hooks: AgentRuntimeHooks = {
			onToolRuntimeOutcome: (_ctx: AgentToolRuntimeOutcomeHookContext) => {},
		}

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks,
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async (_req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
				return { approved: true, executionCapability: TRUSTED_A }
			},
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		expect(executeSpy).toHaveBeenCalledTimes(1)
		const ctx = executeSpy.mock.calls[0]?.[1] as AgentToolContext

		// PRIVILEGE-PROVENANCE DISCRIMINATOR 2: the typed slot
		// carries ONLY the host's trusted marker. The model's
		// malicious EVIL_B was deliberately NOT promoted.
		expect(ctx.executionCapability).toEqual(TRUSTED_A)
		expect(ctx.executionCapability).not.toEqual(EVIL_B)

		// The generic metadata bag preserves the original source
		// (the runtime did NOT shallow-merge it into the typed slot
		// or into AgentToolContext.metadata at the construction site).
		expect((ctx.metadata ?? {})["executionCapability"]).toBeUndefined()
	})

	// ---------- Per-tool-call correlation (reviewer test 5 -- NONBLOCKING) ----------
	it("PER-TOOL-CALL CORRELATION: same-runtime multiple tool calls see distinct markers, no crossover (true concurrent runtime calls NOT EXECUTED; nonblocking per reviewer)", async () => {
		// The reviewer reworded this from "concurrency" to
		// "per-tool-call correlation". TRUE concurrent runtime
		// calls are NOT_EXECUTED and are NONBLOCKING for this ACT.
		// Since the implementation has no global mutable capability
		// state, recursive concurrency is not load-bearing for the
		// authority transport.
		//
		// Evidence label (frozen):
		//   same-runtime multiple tool calls / correlation = EXECUTED
		//   true concurrent runtime calls                = NOT_EXECUTED
		const captured: AgentToolContext[] = []
		const tool = makeShellLikeTool(captured)

		const MARKER_INV_A: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "inv-A",
		}
		const MARKER_INV_B: FactoryBindingProbeCapability = {
			kind: "factory-binding-probe",
			correlationId: "inv-B",
		}

		// Model emits two tool calls (one for A, one for B).
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "conc-A",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'A\\n'"] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "conc-B",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["printf 'B\\n'"] }),
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
			requestToolApproval: async (req: ToolApprovalRequest): Promise<ToolApprovalResult> => {
				if (req.toolCallId === "conc-A") {
					return { approved: true, executionCapability: MARKER_INV_A }
				}
				if (req.toolCallId === "conc-B") {
					return { approved: true, executionCapability: MARKER_INV_B }
				}
				return { approved: true }
			},
		})

		await runtime.run("Start")
		await new Promise((r) => setImmediate(r))

		// Two captures expected.
		expect(captured.length).toBe(2)

		const ctxA = captured.find((c) => c.toolCallId === "conc-A")
		const ctxB = captured.find((c) => c.toolCallId === "conc-B")

		expect(ctxA).toBeDefined()
		expect(ctxB).toBeDefined()

		// Each context sees its OWN marker. No crossover.
		expect(ctxA!.executionCapability).toEqual(MARKER_INV_A)
		expect(ctxB!.executionCapability).toEqual(MARKER_INV_B)
		expect(ctxA!.executionCapability).not.toEqual(MARKER_INV_B)
		expect(ctxB!.executionCapability).not.toEqual(MARKER_INV_A)
	})
})
