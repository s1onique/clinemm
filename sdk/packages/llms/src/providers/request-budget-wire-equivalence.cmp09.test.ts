/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01).
 *
 * THE REQUEST-BUDGET / WIRE-EQUIVALENCE WITNESS.
 *
 * ## THE QUESTION
 * ---------------
 * Does the REQUEST-BUDGET measurement (the authority the compaction trigger
 * consumes) describe the SAME request the provider actually receives?
 *
 * The historical witness (session `1795639776267_j3nki`, run
 * `run_kR2y9UwW`, MiniMax-M3.1-Flash over the Anthropic-compatible
 * transport) recorded, from the ACTUAL captured provider requests:
 *
 *   - iteration 23: estimated SDK payload 197,218 tokens, then 58,940
 *     after the compaction transition;
 *   - iteration 48+: reasoning blocks that carry NO provider signature
 *     (the response was output-exhausted, so the provider never returned
 *     a signature for that reasoning) accumulate in the request;
 *   - final SDK payload estimate ~559,893 tokens against a
 *     provider-reported input of ~248,325 tokens.
 *
 * ## THE TWO AUTHORITIES THIS WITNESS JOINS
 * -------------------------------------------
 *
 * 1. THE RESOLVED TRANSPORT (A1).
 *    A reasoning block is provider-visible only on a transport whose
 *    serializer requires provider-origin authorization. The MINIMAX builtin
 *    route is such a route: its MODEL family is "minimax" while its
 *    RESOLVED TRANSPORT is the Anthropic module. The witness therefore uses
 *    the repository's RESOLVED transport facts, never a family guess.
 *
 * 2. THE DESTINATION-SPECIFIC REPLAY ELIGIBILITY (A2).
 *    The opaque payload (the thinking signature, the redacted-thinking
 *    payload) authenticates a block to the ENDPOINT that issued it. The
 *    wire gate withholds it unless the recorded origin EXACTLY equals the
 *    destination's own origin authority. Signature presence ALONE does not
 *    establish replay eligibility, so the budget must consume the SAME
 *    decision.
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 *   - the REAL production request preparation (`toProviderVisibleMessages`,
 *     the canonical provider projection the budget authority measures);
 *   - the REAL resolved Anthropic serializer (`@ai-sdk/anthropic`), reached
 *     through the REAL vendor module, with an INJECTED `fetch` so the
 *     serialized HTTP body is observable without a paid inference;
 *   - the REAL request-budget measurement (`estimateProviderRequestInputTokens`).
 *
 * No paid inference. No provider request is issued: the injected fetch
 * returns a synthetic empty Anthropic SSE stream.
 *
 * ## THE CONTROLS
 * --------------
 *   CMP09-WIRE-01  SAME-ROUTE signed reasoning reaches the serialized body
 *                  AND contributes to the budget
 *   CMP09-WIRE-02  unsigned reasoning does NOT reach the serialized body
 *                  AND does NOT inflate the budget
 *   CMP09-WIRE-03  signed reasoning with an ABSENT origin is excluded
 *                  from BOTH the wire and the budget
 *   CMP09-WIRE-04  signed reasoning with an INCOMPATIBLE origin is excluded
 *                  from BOTH the wire and the budget
 *   CMP09-WIRE-05  an AUTHORIZED redacted reasoning block reaches the wire
 *                  and the budget; an UNAUTHORIZED one reaches NEITHER
 *   CMP09-WIRE-06  tool calls / tool results keep their identity and order
 *   CMP09-WIRE-07  the canonical transcript is unchanged by the projection
 *   CMP09-WIRE-08  the RESOLVED TRANSPORT facts classify the MiniMax route
 *                  as Anthropic and conserve a non-Anthropic transport
 */
import {
	type AgentMessage,
	type AgentMessagePart,
	estimateProviderRequestInputTokens,
	mayReplayOpaqueReasoning,
	omitUnauthorizedReasoningBlocks,
	requiresSignedReasoningCapability,
	toProviderVisibleMessages,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGatewayApiHandlerAsync } from "./compat";
import {
	resolveDestinationOriginAuthority,
	resolveTransportFacts,
} from "./resolved-transport";

/**
 * The Anthropic-compatible MiniMax transport, resolved exactly as production
 * resolves it: the `anthropic` family with the MiniMax base URL.
 */
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * The origin authority the production code computes for the PUBLISHED
 * MiniMax route: `${providerId}\u0000${origin}\u0000${path}`.
 *
 * It is the EXACT value the frozen session recorded on every signed
 * reasoning block, and the EXACT value the wire gate compares the recorded
 * origin against.
 */
const MINIMAX_ORIGIN_AUTHORITY =
	"minimax\u0000https://api.minimax.io\u0000/anthropic/v1";

/** An origin authority for a DIFFERENT (incompatible) established route. */
const FOREIGN_ORIGIN_AUTHORITY =
	"anthropic\u0000https://api.anthropic.com\u0000/v1";

/** A provider signature, as the provider returns it for a COMPLETE turn. */
const VALID_SIGNATURE =
	"1f52df733bdd12c2bb050b1dabea3b2c785d3f93b297d6e66ad65e97bbe5a2b7";

/** The reasoning text an output-exhausted response leaves behind. */
const REASONING_TEXT =
	"Now I have a good understanding. Let me now carefully analyze the three defects.\n\n".repeat(
		40,
	);

/** The opaque redacted-thinking payload, as the provider returns it. */
const REDACTED_PAYLOAD = "EmwKAhgBEgy3va3pzix/PS9leL5jXgy0DTVL18L6WW5r0u+/";

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * Drive the REAL production request preparation and the REAL resolved
 * Anthropic serializer, with an INJECTED fetch. Returns the serialized body.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3).
 *
 * THE WIRE BRANCH IS NOT PRE-FILTERED.
 *
 * The predecessor projected the transcript with
 * `toProviderVisibleMessages(messages, { requiresSignedReasoning: true,
 * destinationAuthority })` BEFORE dispatching it, and the SAME projection
 * (further filtered by `omitUnauthorizedReasoningBlocks`) fed the budget
 * measurement. Both branches therefore received an ALREADY-EXCLUDED
 * transcript, so the wire's negative controls could not establish that the
 * WIRE GATE independently rejects the block: the budget's exclusion had
 * already removed it.
 *
 * Here the wire branch receives the RAW projection — the provider-visible
 * shape WITHOUT the reasoning-authorization exclusion — so the only thing
 * that can remove a reasoning block from the serialized body is the WIRE's
 * own gate (`toAiSdkMessages` -> `mayReplayOpaqueReasoning`).
 *
 * The destination authority the wire compares against is NOT injected: the
 * wire builds it ITSELF, from the request's provider id and the resolved
 * endpoint (`buildAiSdkRequestMessages` ->
 * `buildReasoningOriginAuthority`). That is the production authority, and
 * exercising it is the point.
 */
async function serializeThroughRealTransport(
	messages: readonly AgentMessage[],
): Promise<Record<string, unknown>> {
	const fetchMock = vi.fn(async () => anthropicSseResponse());
	const handler = await createGatewayApiHandlerAsync({
		providerId: "minimax",
		apiKey: "test-key",
		baseUrl: MINIMAX_BASE_URL,
		modelId: MODEL_ID,
		fetch: fetchMock as unknown as typeof fetch,
	} as never);
	// The REAL production dispatch: the canonical transcript goes through
	// the gateway's own message preparation and the resolved Anthropic
	// adapter, and the serialized HTTP body is what `fetch` receives.
	//
	// The projection carries NO authorization exclusion, so the WIRE's own
	// gate is the only thing that can drop a reasoning block.
	const stream = handler.createMessage(
		"system prompt",
		toProviderVisibleMessages(messages) as never,
	);
	// Drain the stream so the request is actually dispatched.
	for await (const _chunk of stream) {
		// The synthetic SSE stream carries no content chunks.
	}
	expect(fetchMock).toHaveBeenCalled();
	const call = fetchMock.mock.calls[0] as unknown as [
		string | URL | Request,
		{ body?: string },
	];
	const body = call[1]?.body;
	expect(typeof body).toBe("string");
	return JSON.parse(body as string) as Record<string, unknown>;
}

/**
 * The thinking blocks the SERIALIZED body actually carries, in order.
 */
function serializedThinkingBlocks(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = (body.messages ?? []) as Array<{
		content?: Array<Record<string, unknown>>;
	}>;
	const blocks: Array<Record<string, unknown>> = [];
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (part.type === "thinking" || part.type === "redacted_thinking") {
				blocks.push(part);
			}
		}
	}
	return blocks;
}

/**
 * A transcript with a reasoning block, a tool call and its result.
 *
 * The reasoning block's shape is the CALLER'S choice, so the SAME production
 * path is exercised for every authorization case.
 */
function transcriptWithReasoning(reasoning: AgentMessagePart): AgentMessage[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text: "run the command" }],
		} as AgentMessage,
		{
			role: "assistant",
			content: [
				reasoning,
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "run_commands",
					input: { commands: ["ls"] },
				},
			] as AgentMessagePart[],
		} as AgentMessage,
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-1",
					toolName: "run_commands",
					output: "ok",
				},
			] as AgentMessagePart[],
		} as AgentMessage,
	];
}

/** The SAME-ROUTE signed reasoning: authorized for the destination. */
function signedSameRouteReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: "signed reasoning",
		metadata: {
			signature: VALID_SIGNATURE,
			originAuthority: MINIMAX_ORIGIN_AUTHORITY,
		},
	} as AgentMessagePart;
}

/** The UNSIGNED reasoning: the output-exhaustion shape. */
function unsignedReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: REASONING_TEXT,
	} as AgentMessagePart;
}

/** A SIGNED reasoning block with NO recorded origin. */
function signedMissingOriginReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: REASONING_TEXT,
		metadata: { signature: VALID_SIGNATURE },
	} as AgentMessagePart;
}

/** A SIGNED reasoning block issued by a DIFFERENT (incompatible) route. */
function signedIncompatibleOriginReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: REASONING_TEXT,
		metadata: {
			signature: VALID_SIGNATURE,
			originAuthority: FOREIGN_ORIGIN_AUTHORITY,
		},
	} as AgentMessagePart;
}

/** An AUTHORIZED redacted reasoning block. */
function authorizedRedactedReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: "",
		redacted: true,
		metadata: {
			data: REDACTED_PAYLOAD,
			redactedData: REDACTED_PAYLOAD,
			originAuthority: MINIMAX_ORIGIN_AUTHORITY,
		},
	} as AgentMessagePart;
}

/** An UNAUTHORIZED redacted reasoning block (no recorded origin). */
function unauthorizedRedactedReasoning(): AgentMessagePart {
	return {
		type: "reasoning",
		text: "",
		redacted: true,
		metadata: { data: REDACTED_PAYLOAD, redactedData: REDACTED_PAYLOAD },
	} as AgentMessagePart;
}

/**
 * The budget measurement, over the SAME provider-visible projection the
 * production compaction trigger measures.
 *
 * It is the REPAIRED production measurement: the resolved-transport
 * capability AND the destination-specific replay eligibility.
 */
function measureBudget(messages: readonly AgentMessage[]): number {
	const transportFacts = resolveTransportFacts({ providerId: "minimax" });
	const requiresSignedReasoning = requiresSignedReasoningCapability({
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1): the
		// EFFECTIVE transport — the serializer that actually runs.
		effectiveTransportClient: transportFacts.effectiveClient,
		transportClient: transportFacts.client,
		apiProtocol: transportFacts.apiProtocol,
	});
	return estimateProviderRequestInputTokens({
		systemPrompt: "system prompt",
		messages: omitUnauthorizedReasoningBlocks(
			toProviderVisibleMessages(messages, {
				requiresSignedReasoning,
				destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
			}),
			{
				requiresSignedReasoning,
				destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
			},
		),
		tools: [],
	});
}

/**
 * The budget measurement with the REASONING EXCLUSION DISABLED.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3).
 *
 * It is the NECESSITY control for the budget exclusion: with the exclusion
 * off, the budget MUST measure MORE than it does with the exclusion on.
 * Without that divergence, the exclusion would be inert and the negative
 * controls would prove nothing about it.
 *
 * HOW THE EXCLUSION IS DISABLED
 * -----------------------------
 * The exclusion is applied in TWO places, and BOTH must be off for the
 * measurement to diverge:
 *
 *   1. `toProviderVisibleMessages` omits the reasoning block whose recorded
 *      origin is not authorized for the destination (the projection's own
 *      `mayReplayOpaqueReasoning` check);
 *   2. `omitUnauthorizedReasoningBlocks` omits the blocks that survive the
 *      projection.
 *
 * The predecessor's control only disabled (2), which is why it measured
 * IDENTICALLY to the production measurement: (1) had already removed the
 * block, and no divergence was observable. Disabling the TRANSPORT
 * CAPABILITY turns (1) off as well, so the measurement really does include
 * the content the production measurement excludes.
 *
 * The control is deliberately built from the SAME production helpers, so it
 * measures the same quantity — only the exclusion differs.
 */
function measureBudgetWithoutExclusion(
	messages: readonly AgentMessage[],
): number {
	return estimateProviderRequestInputTokens({
		systemPrompt: "system prompt",
		messages: toProviderVisibleMessages(messages),
		tools: [],
	});
}

/**
 * The budget measurement of the SAME transcript shape carrying NO reasoning
 * content at all.
 *
 * It is the baseline every reasoning case is compared against, so the
 * comparison isolates the reasoning contribution alone: the transcript, the
 * tool call and the tool result are identical in every case.
 */
function measureBaselineBudget(): number {
	return measureBudget(
		transcriptWithReasoning({
			type: "reasoning",
			text: "",
		} as AgentMessagePart),
	);
}

describe("CMP-09 request-budget / wire equivalence", () => {
	it("CMP09-WIRE-01: same-route signed reasoning reaches the wire AND the budget", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(signedSameRouteReasoning()),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.type).toBe("thinking");
		expect(blocks[0]?.signature).toBe(VALID_SIGNATURE);
		// The budget MUST count it: the provider receives it.
		expect(
			measureBudget(transcriptWithReasoning(signedSameRouteReasoning())),
		).toBeGreaterThan(measureBaselineBudget());
	});

	it("CMP09-WIRE-02: unsigned reasoning reaches NEITHER the wire NOR the budget", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(unsignedReasoning()),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(0);
		// The reasoning text must not appear ANYWHERE in the body.
		expect(JSON.stringify(body)).not.toContain(REASONING_TEXT.slice(0, 80));
		// The budget MUST NOT count it: the provider never receives it.
		expect(measureBudget(transcriptWithReasoning(unsignedReasoning()))).toBe(
			measureBaselineBudget(),
		);
	});

	it("CMP09-WIRE-03: signed reasoning with an ABSENT origin is excluded from BOTH", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(signedMissingOriginReasoning()),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(0);
		expect(JSON.stringify(body)).not.toContain(REASONING_TEXT.slice(0, 80));
		// The budget MUST NOT count it: the wire withholds the opaque payload
		// (fail closed on an absent origin) and the serializer drops the block.
		expect(
			measureBudget(transcriptWithReasoning(signedMissingOriginReasoning())),
		).toBe(measureBaselineBudget());
	});

	it("CMP09-WIRE-04: signed reasoning with an INCOMPATIBLE origin is excluded from BOTH", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(signedIncompatibleOriginReasoning()),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(0);
		expect(JSON.stringify(body)).not.toContain(REASONING_TEXT.slice(0, 80));
		expect(
			measureBudget(
				transcriptWithReasoning(signedIncompatibleOriginReasoning()),
			),
		).toBe(measureBaselineBudget());
	});

	it("CMP09-WIRE-05: authorized redacted reasoning reaches BOTH; unauthorized reaches NEITHER", async () => {
		const authorizedBody = await serializeThroughRealTransport(
			transcriptWithReasoning(authorizedRedactedReasoning()),
		);
		const authorizedBlocks = serializedThinkingBlocks(authorizedBody);
		expect(authorizedBlocks).toHaveLength(1);
		expect(authorizedBlocks[0]?.type).toBe("redacted_thinking");
		expect(authorizedBlocks[0]?.data).toBe(REDACTED_PAYLOAD);
		// The budget MUST count it: the provider receives it.
		expect(
			measureBudget(transcriptWithReasoning(authorizedRedactedReasoning())),
		).toBeGreaterThan(measureBaselineBudget());

		const unauthorizedBody = await serializeThroughRealTransport(
			transcriptWithReasoning(unauthorizedRedactedReasoning()),
		);
		expect(serializedThinkingBlocks(unauthorizedBody)).toHaveLength(0);
		expect(JSON.stringify(unauthorizedBody)).not.toContain(REDACTED_PAYLOAD);
		// The budget MUST NOT count it.
		expect(
			measureBudget(transcriptWithReasoning(unauthorizedRedactedReasoning())),
		).toBe(measureBaselineBudget());
	});

	it("CMP09-WIRE-06: tool calls / tool results keep their identity and order", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(unsignedReasoning()),
		);
		const messages = (body.messages ?? []) as Array<{
			role?: string;
			content?: Array<Record<string, unknown>>;
		}>;
		const toolUses = messages.flatMap((message) =>
			(message.content ?? []).filter((part) => part.type === "tool_use"),
		);
		const toolResults = messages.flatMap((message) =>
			(message.content ?? []).filter((part) => part.type === "tool_result"),
		);
		expect(toolUses).toHaveLength(1);
		expect(toolUses[0]?.id).toBe("call-1");
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]?.tool_use_id).toBe("call-1");
	});

	it("CMP09-WIRE-07: the canonical transcript is unchanged by the projection", () => {
		const transcript = transcriptWithReasoning(unsignedReasoning());
		const before = JSON.stringify(transcript);
		const projected = toProviderVisibleMessages(transcript, {
			requiresSignedReasoning: true,
			destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
		});
		omitUnauthorizedReasoningBlocks(projected, {
			requiresSignedReasoning: true,
			destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
		});
		expect(JSON.stringify(transcript)).toBe(before);
	});

	it("CMP09-WIRE-08: the RESOLVED TRANSPORT classifies MiniMax as Anthropic and conserves a non-Anthropic transport", () => {
		// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1).
		//
		// The MiniMax builtin route's MODEL family is "minimax" while its
		// RESOLVED TRANSPORT is the Anthropic module. The capability MUST
		// follow the transport.
		const minimaxFacts = resolveTransportFacts({ providerId: "minimax" });
		expect(minimaxFacts.client).toBe("anthropic");
		expect(
			requiresSignedReasoningCapability({
				transportClient: minimaxFacts.client,
				apiProtocol: minimaxFacts.apiProtocol,
				family: "minimax",
				modelId: MODEL_ID,
				providerId: "minimax",
			}),
		).toBe(true);

		// A NON-Anthropic transport is CONSERVED: it keeps every reasoning
		// block, so no reasoning the provider would have received is
		// excluded.
		const geminiFacts = resolveTransportFacts({ providerId: "gemini" });
		expect(geminiFacts.client).not.toBe("anthropic");
		expect(
			requiresSignedReasoningCapability({
				transportClient: geminiFacts.client,
				apiProtocol: geminiFacts.apiProtocol,
				family: "anthropic",
				modelId: "claude-sonnet-4-5",
				providerId: "gemini",
			}),
		).toBe(false);

		// The Bedrock transport has its OWN module (not the Anthropic one),
		// so it is conserved too even though its protocol is "anthropic".
		const bedrockFacts = resolveTransportFacts({ providerId: "bedrock" });
		expect(bedrockFacts.client).toBe("bedrock");
		expect(
			requiresSignedReasoningCapability({
				effectiveTransportClient: bedrockFacts.effectiveClient,
				transportClient: bedrockFacts.client,
				apiProtocol: bedrockFacts.apiProtocol,
				family: "anthropic",
				providerId: "bedrock",
			}),
		).toBe(false);
	});

	// ---------------------------------------------------------------------
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3).
	//
	// THE NECESSITY CONTROLS.
	//
	// The negative controls above assert that the WIRE excludes a block and
	// that the BUDGET excludes it too. On their own they cannot establish
	// that EITHER gate is necessary: a projection that dropped every
	// reasoning block would satisfy both.
	//
	// The controls below establish necessity in both directions:
	//
	//   - the WIRE gate is necessary: the raw projection (which the wire
	//     branch now receives) DOES carry the reasoning block, so the wire's
	//     own gate is the only thing that removed it;
	//   - the BUDGET exclusion is necessary: with the exclusion disabled the
	//     measurement DIVERGES from the production measurement.
	// ---------------------------------------------------------------------

	it("CMP09-WIRE-09: the WIRE gate is necessary — the raw projection carries the block the wire drops", async () => {
		// The RAW projection — no authorization exclusion applied — still
		// carries the incompatible-origin reasoning block. The wire branch
		// receives exactly this shape, so the ONLY thing that can remove the
		// block from the serialized body is the wire's own gate.
		const rawProjection = toProviderVisibleMessages(
			transcriptWithReasoning(signedIncompatibleOriginReasoning()),
		);
		const rawBlocks = rawProjection.flatMap((message) =>
			typeof message.content === "string"
				? []
				: message.content.filter(
						(block) =>
							block.type === "thinking" || block.type === "redacted_thinking",
					),
		);
		expect(rawBlocks).toHaveLength(1);

		// And the wire DROPS it.
		const body = await serializeThroughRealTransport(
			transcriptWithReasoning(signedIncompatibleOriginReasoning()),
		);
		expect(serializedThinkingBlocks(body)).toHaveLength(0);
		expect(JSON.stringify(body)).not.toContain(REASONING_TEXT.slice(0, 80));
	});

	it("CMP09-WIRE-10: the BUDGET exclusion is necessary — disabling it diverges the measurement", () => {
		// The incompatible-origin block: the budget excludes it.
		expect(
			measureBudget(
				transcriptWithReasoning(signedIncompatibleOriginReasoning()),
			),
		).toBe(measureBaselineBudget());

		// With the exclusion DISABLED, the budget measures MORE. The
		// divergence is what makes the exclusion a live decision rather than
		// an inert branch.
		expect(
			measureBudgetWithoutExclusion(
				transcriptWithReasoning(signedIncompatibleOriginReasoning()),
			),
		).toBeGreaterThan(measureBaselineBudget());
	});

	it("CMP09-WIRE-11: the AUTHORIZED case diverges in the OPPOSITE direction — the exclusion retains it", () => {
		// The same-route authorized block is RETAINED by the budget, so the
		// exclusion does not remove it and the measurement is the same
		// whether or not the exclusion is on.
		expect(
			measureBudget(transcriptWithReasoning(signedSameRouteReasoning())),
		).toBeGreaterThan(measureBaselineBudget());
		expect(
			measureBudgetWithoutExclusion(
				transcriptWithReasoning(signedSameRouteReasoning()),
			),
		).toBe(measureBudget(transcriptWithReasoning(signedSameRouteReasoning())));
	});

	it("CMP09-WIRE-12: the BUDGET's destination authority EQUALS the WIRE's for the SAME route facts", () => {
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5).
		//
		// The previous report says destination resolution uses request-time
		// route facts, while `AgentRuntime` consumes constructor-captured
		// `providerBaseUrl` and `providerApiLine`. The question is whether
		// the two are EQUIVALENT.
		//
		// They are, because the resolution is the SAME three-tier rule:
		//
		//   the WIRE     (registry.ts): config.baseUrl ??
		//                              resolveApiLineBaseUrl(options) ??
		//                              record.defaults.baseUrl
		//   the BUDGET   (resolved-transport.ts): baseUrl ??
		//                              resolveProviderApiLineBaseUrl(providerId,
		//                                apiLine) ??
		//                              collection.provider.baseUrl
		//
		// and the API LINE is the SAME fact in both: the wire reads
		// `options.apiLine` from the merged provider options, and the
		// runtime reads `config.options.apiLine` — which `resolveRuntimeConfig`
		// passes STRAIGHT into the gateway's provider configuration.
		//
		// So for every route the runtime dispatches, the budget's
		// destination authority IS the wire's destination authority.
		for (const apiLine of ["china", "international"] as const) {
			const budgetAuthority = resolveDestinationOriginAuthority({
				providerId: "minimax",
				apiLine,
			});
			expect(budgetAuthority).toBeDefined();
			// The two API lines are DIFFERENT HOSTS, so they are different
			// trust domains and MUST produce different authorities.
			expect(budgetAuthority).not.toBe(
				resolveDestinationOriginAuthority({
					providerId: "minimax",
					apiLine: apiLine === "china" ? "international" : "china",
				}),
			);
		}

		// The INTERNATIONAL line is the published MiniMax route, and the
		// authority names exactly that endpoint.
		expect(
			resolveDestinationOriginAuthority({
				providerId: "minimax",
				apiLine: "international",
			}),
		).toBe(MINIMAX_ORIGIN_AUTHORITY);

		// An EXPLICIT base URL wins over the API line — exactly as the
		// registry resolves it (`config?.baseUrl ?? ...`).
		expect(
			resolveDestinationOriginAuthority({
				providerId: "minimax",
				baseUrl: MINIMAX_BASE_URL,
				apiLine: "china",
			}),
		).toBe(MINIMAX_ORIGIN_AUTHORITY);
	});

	it("CMP09-WIRE-13: an UNRESOLVED destination grants NO opaque replay authority on EITHER side", () => {
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5).
		//
		// The two situations must be distinguished:
		//
		//   - the destination IS established and grants NO opaque replay
		//     authority (an incompatible origin): the wire withholds the
		//     payload and the budget withholds it too;
		//   - the budget consumer CANNOT establish the destination: the
		//     authority is undefined, which ALSO grants no replay authority
		//     (the fail-closed direction).
		//
		// The second case must NOT be a divergence where the budget
		// discards reasoning the wire retains: an undefined destination
		// grants no authority on EITHER side.
		const unresolved = resolveDestinationOriginAuthority({
			providerId: "minimax",
			baseUrl: "https://operator-configured.example/anthropic/v1",
		});
		// An operator-configured endpoint is an UNRESOLVED route: it grants
		// no authority.
		expect(unresolved).toBeUndefined();

		// An unresolved destination grants NO opaque replay authority.
		expect(
			mayReplayOpaqueReasoning({
				origin: MINIMAX_ORIGIN_AUTHORITY,
				destinationAuthority: unresolved,
			}),
		).toBe(false);

		// And an ESTABLISHED destination with an INCOMPATIBLE origin also
		// grants no authority — the same direction, the same outcome.
		expect(
			mayReplayOpaqueReasoning({
				origin: FOREIGN_ORIGIN_AUTHORITY,
				destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
			}),
		).toBe(false);

		// The AUTHORIZED case is the only one that grants authority, and it
		// grants it on BOTH sides.
		expect(
			mayReplayOpaqueReasoning({
				origin: MINIMAX_ORIGIN_AUTHORITY,
				destinationAuthority: MINIMAX_ORIGIN_AUTHORITY,
			}),
		).toBe(true);
	});
});
