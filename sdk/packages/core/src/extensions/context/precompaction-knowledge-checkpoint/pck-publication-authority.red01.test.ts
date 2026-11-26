/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — P0 RED.
 *
 * ============================================================================
 * THE CLAIMED DEFECT
 * ============================================================================
 *
 * `collectAuthorizedReferences()` computes the B' source authority, but the
 * production publication path does NOT use it: `executePckAttempt()` derives
 * the gate's reference authority from the CANONICAL history
 * (`canonicalReferences: observedReferences`), so a reference the B' binding
 * EXCLUDES is still admissible to the canonical gate.
 *
 * ============================================================================
 * WHAT THIS WITNESS EXERCISES
 * ============================================================================
 *
 * The REAL production B' attempt and publication path:
 *
 *   compaction decision
 *     -> B' selection (the real route)
 *     -> the real request construction
 *     -> the real transport (injected at the provider-handler boundary)
 *     -> the real PCK result validation
 *     -> the REAL publication gate
 *     -> the REAL installation decision
 *
 * The model returns an OTHERWISE ADMISSIBLE proposal that cites a reference
 * the B' binding EXCLUDES. If the canonical gate admits it, the authority
 * bypass is PROVEN.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import {
	buildProviderVisibleBindings,
	collectAuthorizedToolEventReferences,
} from "./provider-visible-binding";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const PARENT_SYSTEM_PROMPT = "You are a helpful coding assistant.";
const SYNTHETIC_TOOL_CALL_ID = "tool_call_r4";

/**
 * The canonical history.
 *
 * It contains a reasoning-only assistant message, a tool call with its
 * result, and a user message that the production projection MERGES into the
 * tool-result message (so its canonical id is dropped).
 */
function canonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_reasoning",
			content: [
				{
					type: "thinking",
					thinking: "the deployment lives under /etc/deploy",
					signature: "sig",
				},
			],
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
	// A trailing USER message. The production projection MERGES it into the
	// preceding tool-result message and DROPS its canonical id.
	messages.push({
		role: "user",
		id: "msg_merged_away",
		content: "the decisive evidence is recorded in the deployment manifest",
	} as unknown as MessageWithMetadata);
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
 * The proposal the model returns.
 *
 * `IMPLEMENTATION_INSPECTED` is NOT a deterministically establishable atom,
 * so the canonical interpreter bounds it at `model_reported`, and a
 * `model_reported` claim is admissible whenever the evidence does not
 * CONTRADICT it. The proposal is therefore OTHERWISE ADMISSIBLE — the only
 * thing that can reject it is the reference authority.
 */
function proposalFor(reference: string): string {
	return JSON.stringify({
		records: [
			{
				kind: "observation",
				assurance: "model_reported",
				status: "active",
				atom: "IMPLEMENTATION_INSPECTED",
				evidenceRefs: [reference],
			},
		],
	});
}

/**
 * Drive the REAL production seam and report what was INSTALLED.
 */
async function runSeam(
	proposal: string,
): Promise<{ readonly installed: boolean; readonly transcript: string }> {
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation(() => ({
		createMessage: vi.fn((systemPrompt: string) => {
			const isCheckpoint =
				systemPrompt === PARENT_SYSTEM_PROMPT ||
				systemPrompt.includes("WORKING-KNOWLEDGE CHECKPOINT");
			return (async function* () {
				yield {
					type: "text",
					id: "x-1",
					text: isCheckpoint ? proposal : "## Goal\ninspect",
				};
				yield { type: "done", id: "x-1", success: true };
			})();
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
	const messages = canonicalHistory();
	const parentProjection = new MessageBuilder().buildForApi(
		messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
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
		prepareApiMessages: async (msgs) => msgs,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			generate: async ({
				systemPrompt,
				request,
				signal,
				messages: msgs,
				tools,
			}) => {
				const handler = await createHandlerMock({ systemPrompt }).createMessage(
					systemPrompt,
					msgs ?? [{ role: "user", content: request }],
					tools,
				);
				let text = "";
				for await (const chunk of handler) {
					if (chunk.type === "text") {
						text += chunk.text;
					}
				}
				signal.throwIfAborted();
				return {
					text,
					reasoningChars: 0,
					usedTools: false,
					failed: false,
				};
			},
			decisionId: () => "decision-1",
			deadlineMs: () => 5_000,
		},
	});
	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: PARENT_SYSTEM_PROMPT,
		tools: [],
		messages,
		apiMessages: parentProjection as unknown as MessageWithMetadata[],
		model: outerModel,
	});
	const transcript = JSON.stringify(result?.messages ?? []);
	return {
		installed: transcript.includes("Working knowledge checkpoint"),
		transcript,
	};
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — P0 RED", () => {
	it("P0.1: the B' binding EXCLUDES the merged-away, reasoning-only and out-of-interval references", () => {
		const messages = canonicalHistory();
		const parentProjection = new MessageBuilder().buildForApi(
			messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		const providerMessages = parentProjection as unknown as {
			role: string;
			id?: string;
			content: unknown;
		}[];
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: messages,
			providerMessages,
			authorizedMessageCount: messages.length,
		});
		// The MERGED-AWAY reference: the projection dropped its id.
		const merged = bindings.get("id:msg_merged_away");
		expect(merged?.status).toBe("unresolved");
		expect(merged?.status === "unresolved" ? merged.reason : undefined).toBe(
			"absent",
		);
		// The REASONING-ONLY reference.
		const reasoning = bindings.get("id:msg_reasoning");
		expect(reasoning?.status).toBe("unresolved");
		expect(
			reasoning?.status === "unresolved" ? reasoning.reason : undefined,
		).toBe("private_reasoning");
		// The OUT-OF-INTERVAL reference (a bounded interval over a visible
		// reference). `msg_call` is at canonical index 2, so it falls outside
		// a one-message interval even though it IS visible.
		const bounded = buildProviderVisibleBindings({
			canonicalMessages: messages,
			providerMessages,
			authorizedMessageCount: 1,
		});
		const beyond = bounded.get("id:msg_call");
		expect(beyond?.status).toBe("unresolved");
		expect(beyond?.status === "unresolved" ? beyond.reason : undefined).toBe(
			"out_of_interval",
		);
	});

	it("P1.1: the tool-event RED — a COMPLETED tool event is AMBIGUOUS, so it can never be authorized", () => {
		const messages = canonicalHistory();
		const parentProjection = new MessageBuilder().buildForApi(
			messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: messages,
			providerMessages: parentProjection as unknown as {
				role: string;
				id?: string;
				content: unknown;
			}[],
			authorizedMessageCount: messages.length,
		});
		// A NORMAL completed tool event has ONE invocation and ONE result.
		// The binding collects BOTH positions together, so the caller sees
		// MORE THAN ONE position and rejects the event as `ambiguous`.
		const event = bindings.get(SYNTHETIC_TOOL_CALL_ID);
		expect(event?.status).toBe("unresolved");
		expect(event?.status === "unresolved" ? event.reason : undefined).toBe(
			"ambiguous",
		);
		// THE DEFECT: the decisive engineering evidence can NEVER be
		// authorized, so the B' route can never publish a tool-observed
		// record.
		expect(collectAuthorizedToolEventReferences(bindings)).not.toContain(
			SYNTHETIC_TOOL_CALL_ID,
		);
	});

	it("P0.2: the BYPASS — the canonical gate ADMITS a proposal citing a reference the B' binding EXCLUDES", async () => {
		// The MERGED-AWAY reference. It is EXCLUDED by the B' binding
		// (`absent`), but it IS in the canonical history, so the canonical
		// gate's membership check admits it.
		const merged = await runSeam(proposalFor("id:msg_merged_away"));
		// THE BYPASS: the record was ADMITTED and INSTALLED even though the
		// B' source authority excludes the reference it cites.
		expect(merged.installed).toBe(true);

		// The REASONING-ONLY reference.
		const reasoning = await runSeam(proposalFor("id:msg_reasoning"));
		expect(reasoning.installed).toBe(true);
	});

	it("P0.3: the BYPASS — a proposal citing BOTH an authorized and an unauthorized reference is admitted", async () => {
		const mixed = await runSeam(
			JSON.stringify({
				records: [
					{
						kind: "observation",
						assurance: "model_reported",
						status: "active",
						atom: "IMPLEMENTATION_INSPECTED",
						evidenceRefs: ["id:msg_task", "id:msg_merged_away"],
					},
				],
			}),
		);
		// THE BYPASS: the authorized reference does not launder the
		// unauthorized one.
		expect(mixed.installed).toBe(true);
	});
});
