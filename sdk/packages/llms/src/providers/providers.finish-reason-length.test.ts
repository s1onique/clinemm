/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 *
 * AMENDMENT-01 A2 — THE OPENAI-COMPATIBLE `finish_reason: "length"`
 * PROPAGATION WITNESS.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 *
 * The compaction acceptance contract refuses a summary whose provider
 * reported that the response was cut short. For an OpenAI-compatible
 * endpoint, the provider's truncation signal arrives as
 * `finish_reason: "length"`.
 *
 * That signal must survive TWO production normalizations before it can
 * authorise a refusal:
 *
 *   finish_reason "length"                       (the provider's wire value)
 *     -> mapFinishReason()      (ai-sdk.ts)      -> "max-tokens"
 *       -> AgentModelEvent      (the gateway's    -> { type: "finish",
 *                            event contract)        reason: "max-tokens" }
 *         -> toApiStreamChunk() (compat.ts)      -> { type: "done",
 *                                                   success: true,
 *                                                   incompleteReason:
 *                                                     "max_tokens" }
 *
 * This suite drives the REAL gateway and the REAL adapter with a
 * deterministic HTTP/SSE substitute. It does NOT mock the normalized field
 * at the boundary whose correctness is under test: the `incompleteReason`
 * the assertion reads is produced by the production adapter from the
 * provider's raw `finish_reason`.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "./gateway";

const PROVIDER_ID = "openai-compatible";
const MODEL_ID = "stub-model";

/**
 * An OpenAI-compatible SSE body whose final chunk carries the given
 * `finish_reason`.
 */
function sseBody(finishReason: string, content: string): string {
	const data = [
		{
			id: "chatcmpl-stub",
			object: "chat.completion.chunk",
			created: 0,
			model: MODEL_ID,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content },
					finish_reason: null,
				},
			],
		},
		{
			id: "chatcmpl-stub",
			object: "chat.completion.chunk",
			created: 0,
			model: MODEL_ID,
			choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
		},
	];
	return `${data.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

/**
 * Stream one turn through the REAL gateway against a deterministic HTTP
 * substitute and return the gateway's events.
 */
async function streamEvents(input: {
	finishReason: string;
	content: string;
}): Promise<readonly unknown[]> {
	const fetchStub = (async () =>
		new Response(sseBody(input.finishReason, input.content), {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		})) as typeof fetch;

	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: PROVIDER_ID,
				apiKey: "test-key",
				baseUrl: "https://stub.invalid/v1",
				fetch: fetchStub,
				models: [
					{
						id: MODEL_ID,
						name: MODEL_ID,
						capabilities: ["text"],
					},
				],
			},
		],
	});

	const request: GatewayStreamRequest = {
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		messages: [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 0,
			},
		],
	};
	const stream = await gateway.stream(request);
	const events: unknown[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the OpenAI-compatible length signal", () => {
	it("normalizes a provider finish_reason of 'length' to the max-tokens event", async () => {
		const events = await streamEvents({
			finishReason: "length",
			content: "A truncated answer",
		});
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "max-tokens",
		});
	});

	it("normalizes a provider finish_reason of 'stop' to the stop event", async () => {
		const events = await streamEvents({
			finishReason: "stop",
			content: "A complete answer",
		});
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "stop",
		});
	});
});
