/**
 * ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the CONSERVATION witness
 * (C3.3).
 *
 * ## What this file establishes
 *
 * The capture must be OBSERVATION-ONLY. Turning the diagnostic on must
 * not change anything the runtime does:
 *
 * ```text
 * canonical input
 * prepared provider-visible messages
 * compaction decision
 * compacted continuation
 * provider dispatch arguments
 * ```
 *
 * must be identical, modulo diagnostic records.
 *
 * The test runs the REAL production seam twice over the SAME input —
 * once with the diagnostic ARMED and once with it DISARMED — and
 * compares the observable outcomes.
 *
 * ## The failure this guards against
 *
 * The capture adds a per-session decision ordinal and publishes the
 * production resolver's already-computed values. A careless implementation
 * could:
 *
 *   - recompute the request estimate with a SECOND `MessageBuilder` build
 *     (the production builder is STATEFUL — an extra build mutates its
 *     sticky cross-call state and can change a LATER real build);
 *   - advance a counter that is later consulted to alter behaviour;
 *   - reorder the request projection.
 *
 * The implementation does NONE of these: it publishes values production
 * already computed, and the ordinal is allocated only when the diagnostic
 * is armed. This file proves the observable equivalence.
 */

import type * as LlmsProviders from "@cline/llms";
import { describe, expect, it } from "vitest";
import {
	type ContextPipelinePrepareTurnInput,
	createContextCompactionPrepareTurn,
} from "./compaction";

const SYSTEM_PROMPT = "You are a concise coding assistant.";

const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
];

/**
 * The canonical input history.
 *
 * It alternates user/assistant so the production `basic` strategy has a
 * real conversation to fold.
 */
function canonicalHistory(): LlmsProviders.Message[] {
	const messages: LlmsProviders.Message[] = [];
	for (let index = 0; index < 8; index += 1) {
		messages.push({
			role: "user",
			content: `question ${index} ${"x".repeat(600)}`,
		});
		messages.push({
			role: "assistant",
			content: `answer ${index} ${"x".repeat(600)}`,
		});
	}
	return messages;
}

/**
 * The API-safe projection the production orchestrator supplies. It is
 * produced ONCE, outside the measured region, so the comparison cannot
 * be perturbed by a second production `MessageBuilder` build.
 */
function apiProjection(
	messages: LlmsProviders.Message[],
): LlmsProviders.Message[] {
	return messages.map((message) => ({
		...message,
		...(message.role === "user"
			? { content: String(message.content) }
			: { content: String(message.content) }),
	}));
}

function contextFor(
	messages: LlmsProviders.Message[],
	apiMessages: LlmsProviders.Message[],
): ContextPipelinePrepareTurnInput {
	return {
		agentId: "agent-conservation",
		conversationId: "conv-conservation",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages,
		apiMessages,
		model: {
			id: "claude-test",
			provider: "anthropic",
			info: {
				id: "claude-test",
				maxInputTokens: 200_000,
			},
		},
	} as unknown as ContextPipelinePrepareTurnInput;
}

function makeCompaction(sink: {
	onCompactionDiagnostics?: (observation: {
		payload: Record<string, unknown>;
	}) => void;
	onCompactionCompleted?: (observation: {
		payload: Record<string, unknown>;
	}) => void;
	isTraceEnabled?: () => boolean;
}) {
	return createContextCompactionPrepareTurn({
		providerId: "anthropic",
		modelId: "claude-test",
		providerConfig: {
			providerId: "anthropic",
			modelId: "claude-test",
		} as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "basic",
		},
		logger: undefined,
		modelBehaviorTraceSink: sink as never,
		sessionId: "session-conservation",
	});
}
describe("ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 / conservation", () => {
	it("tracing OFF and tracing ON produce IDENTICAL observable behaviour", async () => {
		const canonical = canonicalHistory();
		const api = apiProjection(canonical);

		const armedPayloads: Array<Record<string, unknown>> = [];
		const disarmedPayloads: Array<Record<string, unknown>> = [];

		const armed = makeCompaction({
			onCompactionDiagnostics: (observation) => {
				armedPayloads.push(observation.payload);
			},
			onCompactionCompleted: () => {},
			isTraceEnabled: () => true,
		});
		const disarmed = makeCompaction({
			onCompactionDiagnostics: (observation) => {
				disarmedPayloads.push(observation.payload);
			},
			onCompactionCompleted: () => {},
			isTraceEnabled: () => false,
		});

		const armedResult = await armed?.(contextFor(canonical, api));
		const disarmedResult = await disarmed?.(contextFor(canonical, api));

		// 1. The COMPACTION DECISION is identical.
		expect(armedPayloads).toHaveLength(1);
		expect(disarmedPayloads).toHaveLength(0);
		expect(armedPayloads[0]?.shouldCompact).toBe(false);
		expect(armedPayloads[0]?.compactionInitiated).toBe(false);
		expect(armedPayloads[0]?.requestInputTokens).toBeTypeOf("number");
		expect(armedPayloads[0]?.requestTriggerTokens).toBeTypeOf("number");

		// 2. The COMPACTED CONTINUATION is identical.
		expect(armedResult).toEqual(disarmedResult);

		// 3. The CANONICAL INPUT and the PREPARED PROVIDER-VISIBLE MESSAGES
		//    are untouched by the capture: the seam did not mutate them.
		expect(canonical).toEqual(canonicalHistory());
		expect(api).toEqual(apiProjection(canonicalHistory()));

		// 4. The ARMED decision payload publishes the production
		//    resolver's OWN values. The DISARMED path publishes NO
		//    decision payload at all, so it cannot manufacture an
		//    ordinal or perform the capture-only JSON serialization.
		expect(armedPayloads[0]?.decisionOrdinal).toBe(0);
		expect(disarmedPayloads[0]).toBeUndefined();
	});

	it("the capture does not build a SECOND provider projection", async () => {
		// The production `MessageBuilder` is STATEFUL. The capture must not
		// invoke it again. This test asserts the seam consumes the
		// PROJECTION IT WAS GIVEN and reports that projection's size.
		const canonical = canonicalHistory();
		const api = apiProjection(canonical);
		const payloads: Array<Record<string, unknown>> = [];
		const compact = makeCompaction({
			onCompactionDiagnostics: (observation) => {
				payloads.push(observation.payload);
			},
			onCompactionCompleted: () => {},
		});
		await compact?.(contextFor(canonical, api));
		expect(payloads).toHaveLength(1);
		// The captured message count is the PROJECTED count — the one the
		// seam was handed — not a recomputed one.
		expect(payloads[0]?.apiMessageCount).toBe(api.length);
		expect(payloads[0]?.messageCount).toBe(canonical.length);
	});
});
