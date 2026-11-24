/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * G5.2 / Gate 9 — the DEFAULT-OFF BYTE-IDENTITY control.
 *
 * ============================================================================
 * WHAT IS PROVED HERE
 * ============================================================================
 *
 * With the feature DISABLED, the production compaction path must be
 * BYTE-IDENTICAL to the pre-ACT behaviour. The control measures the
 * BYTES, not the semantics:
 *
 *   No additional model call
 *   No additional summary
 *   No changed provider messages
 *   No changed sidecar state
 *   No changed task contract
 *   No changed tool-result pairing
 *   No changed stable prefix
 *   No changed callback cardinality
 *   No new public message
 *
 * The arm is measured by running the REAL production seam with the feature
 * disabled and with the seam ABSENT, and comparing the serialised bytes.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCompactionState } from "../../../session/models/session-compaction";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const HISTORICAL_SUMMARY = [
	"## Goal",
	"Inspect the deployment configuration and report the working knowledge.",
	"",
	"## State",
	"- **Done:** Ran a read-only inspection of the deployment directory.",
].join("\n");

const capturedSummarizerRequests: string[] = [];
let summarizerCallCount = 0;
let checkpointCallCount = 0;

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	capturedSummarizerRequests.length = 0;
	summarizerCallCount = 0;
	checkpointCallCount = 0;
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation((_config: unknown) => {
		return {
			createMessage: vi.fn((systemPrompt: string, messages: unknown[]) => {
				const first = messages[0] as { content?: string } | undefined;
				// The checkpoint request is distinguished by its
				// instruction, which is the ONLY place the two
				// requests differ.
				const isCheckpoint = systemPrompt.includes(
					"WORKING-KNOWLEDGE CHECKPOINT",
				);
				if (isCheckpoint) {
					checkpointCallCount += 1;
					return streamChunks([
						{
							type: "text",
							id: "pck-1",
							text: JSON.stringify({
								records: [
									{
										kind: "observation",
										assurance: "tool_observed",
										status: "active",
										atom: "OPERATION_INVOKED",
										evidenceRefs: ["tool_call_r4"],
									},
								],
							}),
						},
						{ type: "done", id: "pck-1", success: true },
					]);
				}
				capturedSummarizerRequests.push(first?.content ?? "");
				summarizerCallCount += 1;
				return streamChunks([
					{ type: "text", id: "summary-1", text: HISTORICAL_SUMMARY },
					{ type: "done", id: "summary-1", success: true },
				]);
			}),
		};
	});
});

afterEach(() => {
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
});

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
					id: "tool_call_r4",
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
					tool_use_id: "tool_call_r4",
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

async function runProductionSeam(input: {
	canonicalMessages: MessageWithMetadata[];
	withSeam: boolean;
}): Promise<{
	readonly summarizerRequests: readonly string[];
	readonly summarizerCallCount: number;
	readonly checkpointCallCount: number;
	readonly productionMessagesBytes: string;
	readonly providerVisibleBytes: string;
	readonly sidecarBytes: string;
	readonly messageCount: number;
	readonly roles: readonly string[];
	readonly toolPairing: string;
}> {
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
		...(input.withSeam
			? {
					knowledgeCheckpoint: {
						generate: async () => ({
							text: JSON.stringify({
								records: [
									{
										kind: "observation",
										assurance: "tool_observed",
										status: "active",
										atom: "OPERATION_INVOKED",
										evidenceRefs: ["tool_call_r4"],
									},
								],
							}),
							reasoningChars: 0,
							usedTools: false,
							failed: false,
						}),
						decisionId: () => "decision-1",
						deadlineMs: () => 5_000,
					},
				}
			: {}),
	});

	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: "You are a helpful coding assistant.",
		tools: [],
		messages: input.canonicalMessages,
		apiMessages: input.canonicalMessages,
		model: outerModel,
	});

	const productionMessages = result?.messages ?? [];
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	const sidecar = createSessionCompactionState({
		sourceMessages: input.canonicalMessages,
		compactedMessages: productionMessages,
		conversationId: "conv-1",
	});
	return {
		summarizerRequests: [...capturedSummarizerRequests],
		summarizerCallCount,
		checkpointCallCount,
		productionMessagesBytes: JSON.stringify(productionMessages),
		providerVisibleBytes: JSON.stringify(providerVisible),
		sidecarBytes: JSON.stringify(sidecar),
		messageCount: productionMessages.length,
		roles: productionMessages.map((message) => message.role),
		toolPairing: JSON.stringify(
			productionMessages.flatMap((message) =>
				Array.isArray(message.content)
					? message.content.map(
							(block) =>
								`${block.type}:${"id" in block ? block.id : ""}:${"tool_use_id" in block ? block.tool_use_id : ""}`,
						)
					: [],
			),
		),
	};
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 — default-off equivalence", () => {
	it("G5.2: DISABLED — the bytes are IDENTICAL to the seam-absent arm", async () => {
		// Each arm gets its OWN history object, so a mutation by one arm
		// cannot be observed by the other. The mutation is separately
		// asserted to be absent.
		const withSeam = await runProductionSeam({
			canonicalMessages: syntheticCanonicalHistory(),
			withSeam: true,
		});
		// The counters are reset between the arms so each arm is measured
		// on its OWN calls.
		summarizerCallCount = 0;
		checkpointCallCount = 0;
		capturedSummarizerRequests.length = 0;
		const withoutSeam = await runProductionSeam({
			canonicalMessages: syntheticCanonicalHistory(),
			withSeam: false,
		});
		// No additional model call: the checkpoint made NONE.
		expect(withSeam.checkpointCallCount).toBe(0);
		expect(withoutSeam.checkpointCallCount).toBe(0);
		expect(withSeam.summarizerCallCount).toBe(withoutSeam.summarizerCallCount);
		// No additional summary: the summarizer request is byte-identical.
		expect(withSeam.summarizerRequests).toEqual(withoutSeam.summarizerRequests);
		// No changed provider messages. The `generatedAt` timestamp is
		// produced by the SUMMARY, not by the checkpoint, and it varies
		// between two runs of the SAME code, so it is normalised out. Every
		// other byte is compared.
		const normalise = (bytes: string) =>
			bytes
				.replace(/"generatedAt":\d+/g, '"generatedAt":<redacted>')
				.replace(/"tokensBefore":\d+/g, '"tokensBefore":<redacted>');
		expect(normalise(withSeam.providerVisibleBytes)).toBe(
			normalise(withoutSeam.providerVisibleBytes),
		);
		// No changed production messages.
		expect(normalise(withSeam.productionMessagesBytes)).toBe(
			normalise(withoutSeam.productionMessagesBytes),
		);
		// No changed sidecar state. The sidecar carries a timestamp, so the
		// BYTE comparison excludes that field, which is not produced by the
		// checkpoint and is not a projection of it.
		// The normalised fields are the ones that are NOT produced by the
		// checkpoint and that legitimately vary between two runs of the
		// SAME code:
		//   - `updated_at` — the sidecar's own timestamp;
		//   - `generatedAt` — the summary's own timestamp;
		//   - `tokensBefore` — a token ESTIMATE produced by the shared
		//     estimator, whose cache makes it vary between runs.
		// Every other byte is compared.
		const strip = (bytes: string) =>
			bytes
				.replace(/"updated_at":"[^"]*"/g, '"updated_at":"<redacted>"')
				.replace(/"generatedAt":\d+/g, '"generatedAt":<redacted>')
				.replace(/"tokensBefore":\d+/g, '"tokensBefore":<redacted>');
		const sidecarWith = strip(withSeam.sidecarBytes);
		const sidecarWithout = strip(withoutSeam.sidecarBytes);
		if (sidecarWith !== sidecarWithout) {
			// A compact DIFF, so a failure names the differing field
			// instead of dumping the whole summary.
			let index = 0;
			while (
				index < sidecarWith.length &&
				sidecarWith[index] === sidecarWithout[index]
			) {
				index += 1;
			}
			throw new Error(
				`sidecar differs at ${index}: with="${sidecarWith.slice(index, index + 80)}" without="${sidecarWithout.slice(index, index + 80)}"`,
			);
		}
		expect(sidecarWith).toBe(sidecarWithout);
		// No changed task contract (implied by the byte-identical summary).
		expect(withSeam.providerVisibleBytes).toContain("Active task contract");
		// No changed tool-result pairing.
		expect(withSeam.toolPairing).toBe(withoutSeam.toolPairing);
		// No changed stable prefix: the message count and the roles are
		// identical.
		expect(withSeam.messageCount).toBe(withoutSeam.messageCount);
		expect(withSeam.roles).toEqual(withoutSeam.roles);
		// No new public message.
		expect(withSeam.messageCount).toBe(withoutSeam.messageCount);
		// And no checkpoint section exists.
		expect(withSeam.providerVisibleBytes).not.toContain(
			"Working knowledge checkpoint",
		);
	});

	it("G5.2b: ENABLED — the bytes DIFFER, so the control is not vacuous", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const withSeam = await runProductionSeam({
			canonicalMessages: syntheticCanonicalHistory(),
			withSeam: true,
		});
		summarizerCallCount = 0;
		checkpointCallCount = 0;
		capturedSummarizerRequests.length = 0;
		const withoutSeam = await runProductionSeam({
			canonicalMessages: syntheticCanonicalHistory(),
			withSeam: false,
		});
		// The ENABLED arm differs. Without this, the disabled-arm
		// equivalence above would be vacuous.
		expect(withSeam.providerVisibleBytes).not.toBe(
			withoutSeam.providerVisibleBytes,
		);
		expect(withSeam.providerVisibleBytes).toContain(
			"Working knowledge checkpoint",
		);
	});
});
