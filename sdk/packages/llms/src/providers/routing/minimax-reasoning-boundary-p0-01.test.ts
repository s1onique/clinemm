/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01 — boundary discriminator.
 *
 * This suite is a DIAGNOSTIC, not a gate: it OBSERVES each boundary of the
 * reasoning-continuity chain and reports what each one carries. It exists to
 * establish the EARLIEST boundary at which provider-required reasoning
 * information becomes missing.
 *
 * Boundaries observed, in order:
 *
 *   1. RAW RESPONSE      — the Anthropic-protocol SSE bytes.
 *   2. SDK STREAM       — the resolved `@ai-sdk/anthropic` stream parts.
 *   3. TRANSLATOR       — the ClineMM `AgentModelEvent`s the gateway emits.
 *   4. RUNTIME ACCUM.   — the accumulated assistant reasoning part.
 *   5. OUTBOUND CONV.   — the AI SDK prompt parts.
 *   6. HTTP REQUEST     — the serialized Anthropic body.
 *
 * The reported evidence is STRUCTURAL: the presence and the digest of the
 * synthetic values. No real reasoning, signature, prompt or credential is
 * involved.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const SYNTHETIC_SIGNATURE = "synthetic-opaque-signature-aa11bb22";
const SYNTHETIC_REASONING = "SYNTHETIC-REASONING-BLOCK-TEXT";

function sse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n',
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${SYNTHETIC_REASONING}"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${SYNTHETIC_SIGNATURE}"}}\n\n`,
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

describe("reasoning continuity boundary discriminator", () => {
	it("observes each boundary of the reasoning chain", async () => {
		// ---- BOUNDARY 1+2: the raw SDK stream parts. ----
		const provider = createAnthropic({
			apiKey: "test-key",
			baseURL: "https://api.minimax.io/anthropic/v1",
			fetch: (async () => sse()) as unknown as typeof fetch,
		});
		const model = provider("MiniMax-M3.1-Flash");
		const sdkStream = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			maxOutputTokens: 128,
			includeRawChunks: false,
		} as never);
		const sdkParts: Array<Record<string, unknown>> = [];
		for await (const part of sdkStream.stream) {
			sdkParts.push(part as unknown as Record<string, unknown>);
		}
		const reasoningDeltas = sdkParts.filter(
			(part) => part.type === "reasoning-delta",
		);
		const signatureBearing = reasoningDeltas.filter((part) => {
			const metadata = part.providerMetadata as
				| Record<string, Record<string, unknown>>
				| undefined;
			return typeof metadata?.anthropic?.signature === "string";
		});
		const emptyTextSignatureParts = signatureBearing.filter(
			(part) => part.delta === "",
		);

		// ---- BOUNDARY 3: the ClineMM translator's events. ----
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: "https://api.minimax.io/anthropic/v1",
					fetch: (async () => sse()) as unknown as typeof fetch,
				},
			],
		});
		const events: AgentModelEvent[] = [];
		for await (const event of await gateway.stream({
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 1,
				},
			],
			reasoning: { enabled: true, effort: "low" },
		})) {
			events.push(event);
		}
		const reasoningEvents = events.filter(
			(event) => event.type === "reasoning-delta",
		);
		const eventsWithSignature = reasoningEvents.filter((event) => {
			const metadata = event.metadata as
				| Record<string, Record<string, unknown>>
				| undefined;
			return typeof metadata?.signature === "string";
		});

		const report = {
			boundary2_sdkReasoningDeltaCount: reasoningDeltas.length,
			boundary2_sdkSignatureBearingCount: signatureBearing.length,
			boundary2_sdkEmptyTextSignaturePartCount: emptyTextSignatureParts.length,
			boundary3_translatorReasoningEventCount: reasoningEvents.length,
			boundary3_translatorEventsWithAnthropicSignature:
				eventsWithSignature.length,
			boundary3_translatorTotalText: reasoningEvents
				.map((event) => (event.type === "reasoning-delta" ? event.text : ""))
				.join(""),
		};
		// eslint-disable-next-line no-console
		console.log("BOUNDARY_REPORT", JSON.stringify(report, null, 2));

		// The SDK DOES deliver the signature, in an EMPTY-TEXT part.
		expect(reasoningDeltas.length).toBeGreaterThanOrEqual(2);
		expect(signatureBearing.length).toBeGreaterThanOrEqual(1);
		expect(emptyTextSignatureParts.length).toBeGreaterThanOrEqual(1);
		// The translator forwards the reasoning TEXT...
		expect(report.boundary3_translatorTotalText).toContain(SYNTHETIC_REASONING);
		// ...AND the provider-owned signature (ACT-CLINEMM-PROVIDER-
		// REASONING-CONTINUITY-P0-01). Before the repair this was 0: the
		// translator dropped the empty-text signature-bearing event and
		// never read `providerMetadata.anthropic.signature`.
		expect(report.boundary3_translatorEventsWithAnthropicSignature).toBe(1);
	});
});
