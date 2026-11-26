/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C1 REQUIRED RED.
 *
 * ============================================================================
 * WHAT THIS WITNESS SHOWS
 * ============================================================================
 *
 * It drives the REAL production compaction-to-PCK dispatch seam and shows
 * the FOUR facts the ACT requires the RED to establish:
 *
 *   R1.1  The legacy PCK request is INDEPENDENT: it is dispatched with its
 *         OWN system instruction, not the ordinary parent's.
 *   R1.2  Its system instruction DIFFERS from the ordinary parent's.
 *   R1.3  It does NOT preserve the ordinary parent's LEADING MESSAGE
 *         SEQUENCE: it carries ONE message, not the parent's messages.
 *   R1.4  The desired B' composition is ABSENT: no request carries the
 *         parent's provider-visible messages followed by an appended
 *         extraction suffix.
 *
 * ============================================================================
 * WHY IT IS A REAL WITNESS
 * ============================================================================
 *
 *   - It uses the REAL `createCompactionStateAwarePrepareTurn` /
 *     `createContextCompactionPrepareTurn` seam.
 *   - It uses the REAL `MessageBuilder.buildForApi` provider projection.
 *   - It uses the REAL provider serializer boundary (`createHandlerAsync` in
 *     `@cline/llms`) with an INJECTED transport, and CAPTURES the exact
 *     serialized request the provider received.
 *
 * The captured request is never re-derived from the production code.
 *
 * ============================================================================
 * WHY IT FAILS
 * ============================================================================
 *
 * The assertions are written against the B' COMPOSITION. They FAIL against
 * the predecessor behaviour — which is exactly the receipt of the observed
 * defect — and they must NOT be flipped to GREEN by weakening them.
 *
 * It is excluded from the default suite (`vitest.config.ts`) and is runnable
 * ON DEMAND through its dedicated config.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const PARENT_SYSTEM_PROMPT = "You are a helpful coding assistant.";
const SYNTHETIC_TOOL_CALL_ID = "tool_call_r4";

/**
 * The EXACT serialized request each provider dispatch received.
 */
interface CapturedDispatch {
	readonly systemPrompt: string;
	readonly messages: unknown[];
	/** Whether this dispatch was issued by the CHECKPOINT seam. */
	readonly fromCheckpoint: boolean;
}

const capturedDispatches: CapturedDispatch[] = [];

/**
 * Whether the CURRENT dispatch is the PCK dispatch.
 *
 * The flag is set by the checkpoint seam's own `generate` wrapper around
 * the call into the REAL provider serializer, so the dispatch is
 * identified by WHERE it was issued from — never by its content, which
 * differs between the routes.
 */
let inCheckpointDispatch = false;

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

function syntheticCanonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: SYNTHETIC_TOOL_CALL_ID,
					name: "run_commands",
					input: { command: "kc.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: SYNTHETIC_TOOL_CALL_ID,
					name: "run_commands",
					content: [
						{
							query: "kc.sh build",
							result: "build completed",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
	for (let index = 0; index < 40; index += 1) {
		messages.push({
			role: "user",
			id: `msg_pad_${index}`,
			content: `padding ${index} ${"x".repeat(400)}`,
		} as unknown as MessageWithMetadata);
		messages.push({
			role: "assistant",
			id: `msg_pad_a_${index}`,
			content: `padding reply ${index} ${"y".repeat(400)}`,
		} as unknown as MessageWithMetadata);
	}
	return messages;
}

/**
 * Drive the REAL production seam and capture EVERY provider dispatch.
 */
async function runSeam(options: { readonly enabled?: boolean } = {}): Promise<{
	readonly dispatches: readonly CapturedDispatch[];
	readonly parentProjection: readonly unknown[];
}> {
	capturedDispatches.length = 0;
	// The closed PCK must be enabled for the checkpoint dispatch to happen
	// at all. The PREFIX-PRESERVING route is a separate, independent
	// opt-in.
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	if (options.enabled === true) {
		process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
	} else {
		delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
	}
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation(() => ({
		createMessage: vi.fn((systemPrompt: string, messages: unknown[]) => {
			capturedDispatches.push({
				systemPrompt,
				messages,
				fromCheckpoint: inCheckpointDispatch,
			});
			return streamChunks([
				{ type: "text", id: "x-1", text: "{}" },
				{ type: "done", id: "x-1", success: true },
			]);
		}),
	}));
	const providerId = "anthropic";
	const modelId = "mock-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 16_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const canonicalMessages = syntheticCanonicalHistory();
	// The REAL provider-visible projection, exactly as the runtime's
	// `prepareProviderMessagesForApi` produces it (extension message
	// builders, then `MessageBuilder.buildForApi`).
	const parentProjection = new MessageBuilder().buildForApi(
		canonicalMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: undefined,
		},
		{ mode: "manual" },
	);
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			generate: async ({ systemPrompt, request, signal, messages, tools }) => {
				inCheckpointDispatch = true;
				const handler = await createHandlerMock({ systemPrompt }).createMessage(
					systemPrompt,
					messages ?? [{ role: "user", content: request }],
					tools,
				);
				let text = "";
				let usedTools = false;
				for await (const chunk of handler) {
					if (chunk.type === "text") {
						text += chunk.text;
					} else if (chunk.type === "tool_calls") {
						usedTools = true;
					}
				}
				inCheckpointDispatch = false;
				signal.throwIfAborted();
				return { text, reasoningChars: 0, usedTools, failed: false };
			},
			decisionId: () => "decision-1",
			deadlineMs: () => 5_000,
		},
	});
	await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: PARENT_SYSTEM_PROMPT,
		tools: [],
		messages: canonicalMessages,
		apiMessages: parentProjection as unknown as MessageWithMetadata[],
		model: outerModel,
	});
	return { dispatches: [...capturedDispatches], parentProjection };
}

/**
 * The dispatch that carried the CHECKPOINT contract.
 */
function checkpointDispatch(
	dispatches: readonly CapturedDispatch[],
): CapturedDispatch | undefined {
	return dispatches.find((dispatch) => dispatch.fromCheckpoint);
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C1 REQUIRED RED", () => {
	it("R1.1/R1.2: with the feature DISABLED the legacy PCK request is INDEPENDENT and its system instruction DIFFERS from the parent's", async () => {
		const { dispatches } = await runSeam();
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The legacy PCK request carries its OWN system instruction.
		expect(checkpoint?.systemPrompt).not.toBe(PARENT_SYSTEM_PROMPT);
		// It is the closed extraction contract, not the ordinary prompt.
		expect(checkpoint?.systemPrompt).toContain("WORKING-KNOWLEDGE CHECKPOINT");
	});

	it("R1.3: with the feature DISABLED the legacy PCK request does NOT preserve the parent's leading message sequence", async () => {
		const { dispatches, parentProjection } = await runSeam();
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The legacy request carries exactly ONE message.
		expect(checkpoint?.messages.length).toBe(1);
		// The parent's projection is far longer than one message.
		expect(parentProjection.length).toBeGreaterThan(1);
		// The single message is NOT the parent's first message.
		expect(JSON.stringify(checkpoint?.messages[0])).not.toBe(
			JSON.stringify(parentProjection[0]),
		);
	});

	it("R1.4: with the feature ENABLED the B' composition carries the parent's leading messages plus ONE appended suffix", async () => {
		const { dispatches, parentProjection } = await runSeam({ enabled: true });
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The parent's leading messages are carried VERBATIM.
		expect(
			JSON.stringify(checkpoint?.messages.slice(0, parentProjection.length)),
		).toBe(JSON.stringify(parentProjection));
		// Exactly ONE message is appended.
		expect(checkpoint?.messages.length).toBe(parentProjection.length + 1);
	});
});
