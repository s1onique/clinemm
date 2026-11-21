/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION05 — the THREE-STAGE
 * IDENTITY contract at the REAL agent-runtime seam.
 *
 * ## THE DEFECT (P0, capture contract — NOT a cache diagnosis)
 * --------------------------------------------------------------
 * The analyzer makes FIVE identities mandatory on BOTH sides of a comparison:
 * cohort, session, iteration, preparation and attempt. Three of the five are
 * produced by the RUNTIME, so the runtime must carry the session identity on
 * EVERY stage — otherwise stage A is permanently unusable and every
 * authoritative comparison is refused.
 *
 * The two provider-bound stages DO carry it:
 *
 *   stage B `ai_sdk_prompt`  -> `request.metadata?.sessionId`
 *   stage C `wire_request`   -> `request.metadata?.sessionId`
 *
 * but stage A `runtime_projection` did NOT:
 *
 *   recordPrefixForensicsRuntimeProjection(request, {
 *       preparationRequestId: ...,
 *       providerAttemptId: ...,
 *       iteration: ...,          // <- no sessionId
 *   })
 *
 * The runtime already HAS the session identity — `this.config.sessionId`, the
 * very same value it puts into `request.metadata.sessionId` for stages B and C
 * — and it is already reachable through
 * `this.modelBehaviorTraceIdentity().sessionId`, which the SAME call site uses
 * for the other two identities.
 *
 * ## WHAT THIS WITNESS PROVES
 * ---------------------------
 * The REAL `AgentRuntime`, driven with a scripted model, must arm the forensic
 * capture and hand the runtime-projection stage a NON-EMPTY session identity —
 * so the stage is groupable with stages B and C of the SAME request.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

// The production agent runtime imports `@cline/llms` at module scope, and the
// shared barrel evaluates `agents/types.ts`, which calls `z.object(...)` at
// module scope. This package's unit-test vitest config does not pre-bundle
// zod, so the llms gateway is stubbed — exactly as the sibling
// `agent-runtime.model-behavior-trace.test.ts` does. The witness still drives
// the REAL agent runtime; only the provider gateway construction is stubbed
// (this witness supplies its own scripted `AgentModel`).
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
	recordPrefixForensicsRuntimeProjection: vi.fn(),
}));

import { recordPrefixForensicsRuntimeProjection } from "@cline/llms";
import { createAgentRuntime } from "./agent-runtime";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

interface TestTool {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown> };
	execute: (input: Record<string, unknown>) => Promise<{ output: string }>;
}

function makeRecordingTool(name: string, calls: string[]): TestTool {
	return {
		name,
		description: `test tool ${name}`,
		inputSchema: { type: "object", properties: {} },
		execute: async (input: Record<string, unknown>) => {
			calls.push(`${name}:${String(input.value ?? "")}`);
			return { output: `ok:${name}` };
		},
	};
}

function toolCallStep(
	toolName: string,
	toolCallId: string,
	value: string,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			index: 0,
			input: { value },
		} as unknown as AgentModelEvent,
		{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
	];
}

/** The identity the runtime handed to the runtime-projection capture. */
function capturedRuntimeProjectionIdentity(): {
	sessionId?: string;
	preparationRequestId?: string;
	providerAttemptId?: string;
	iteration?: number;
} {
	const mock = vi.mocked(recordPrefixForensicsRuntimeProjection);
	expect(mock).toHaveBeenCalled();
	const last = mock.mock.calls[mock.mock.calls.length - 1];
	const identity = last?.[1] as
		| {
				sessionId?: string;
				preparationRequestId?: string;
				providerAttemptId?: string;
				iteration?: number;
		  }
		| undefined;
	return identity ?? {};
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION05 — the three-stage identity", () => {
	it("STAGE-01: the runtime-projection capture carries a NON-EMPTY session identity", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
		});

		await runtime.execute("do the thing");

		const identity = capturedRuntimeProjectionIdentity();
		// The session identity is MANDATORY for the analyzer's lineage gate.
		// Without it the stage is ungroupable and every authoritative
		// comparison is refused — which is a CAPTURE-CONTRACT defect, not a
		// cache diagnosis.
		expect(identity.sessionId).toBe("session-1");
	});

	it("STAGE-02: the runtime-projection capture carries ALL FIVE mandatory identities", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
		});

		await runtime.execute("do the thing");

		const identity = capturedRuntimeProjectionIdentity();
		// The identities the analyzer's lineage gate makes mandatory on BOTH
		// sides of a comparison. The cohort is minted by the capture writer
		// itself, so it is not part of this call.
		//
		// Each identity is asserted as PRESENT and non-empty: an ABSENT
		// identity is exactly what defeats the lineage gate, so
		// `expect(x?.trim()).not.toBe("")` would pass for `undefined`.
		expect(identity.sessionId).toBeDefined();
		expect(identity.sessionId?.trim()).not.toBe("");
		expect(identity.preparationRequestId).toBeDefined();
		expect(identity.preparationRequestId?.trim()).not.toBe("");
		expect(identity.providerAttemptId).toBeDefined();
		expect(identity.providerAttemptId?.trim()).not.toBe("");
		expect(identity.iteration).toBeGreaterThanOrEqual(1);
	});

	it("STAGE-03: the runtime-projection session identity MATCHES the provider-bound stages", async () => {
		// The runtime puts the SAME session id into the request metadata it
		// hands to the provider layer. That metadata is what stages B
		// (`ai_sdk_prompt`) and C (`wire_request`) read as
		// `request.metadata?.sessionId` — the gateway promotes
		// `request.options.metadata` into `request.metadata` before the
		// provider seam.
		//
		// If stage A carried a DIFFERENT value, the three stages of one
		// request would land in three different bundles and the whole
		// comparison would collapse.
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		let observedMetadataSessionId: string | undefined;
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				(request: AgentModelRequest) => {
					const options = request.options as
						| { metadata?: Record<string, unknown> }
						| undefined;
					observedMetadataSessionId = options?.metadata?.sessionId as
						| string
						| undefined;
					return [
						{
							type: "tool-call-delta",
							toolCallId: "tc-1",
							toolName: "read_file",
							index: 0,
							input: { value: "alpha" },
						} as unknown as AgentModelEvent,
						{
							type: "finish",
							reason: "tool_use",
						} as unknown as AgentModelEvent,
					];
				},
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
		});

		await runtime.execute("do the thing");

		const identity = capturedRuntimeProjectionIdentity();
		// The value stages B and C read is present...
		expect(observedMetadataSessionId).toBe("session-1");
		// ...and stage A now carries the SAME one.
		expect(identity.sessionId).toBe(observedMetadataSessionId);
	});
});
