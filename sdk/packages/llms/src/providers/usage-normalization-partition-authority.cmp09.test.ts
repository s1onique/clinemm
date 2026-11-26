/**
 * ACT-CLINEMM-CMP09-FINAL-BOUNDED-CORRECTION-01.
 *
 * THE USAGE SCOPE AND THE FINAL NORMALIZATION PARTITION VALIDITY.
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 * The REAL production chain: the REAL gateway over the REAL Anthropic-
 * shaped transport, the REAL production retry middleware, the REAL
 * normalizer (`normalizeUsage`) and the REAL partition-validation authority
 * the middleware uses.
 *
 * ## THE TWO CONTROLS
 * --------------------
 *   A1  THE USAGE SCOPE IS NOT THE PHYSICAL CARDINALITY. A transient
 *       network interruption is a PHYSICAL attempt that carries NO usage,
 *       so the reported usage still describes ONE attempt and the
 *       attempt-scoped raw payload stays IN SCOPE. The valid breakdown must
 *       survive, and no usage may be fabricated for the interrupted
 *       attempt.
 *   A2  THE FINAL NORMALIZATION MUST PUBLISH ONLY A VALID PARTITION. An
 *       invalid breakdown is denied, the authoritative total is never
 *       corrupted, and an invalid metric never becomes an EXPLICIT ZERO.
 *
 * No provider request leaves the machine. No paid inference.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { normalizeUsage } from "./ai-sdk";
import { createGateway } from "./gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * A successful Anthropic-shaped response whose reasoning breakdown is
 * reported ONLY through the raw payload (the opening `message_start`
 * frame), which is the shape the resolved `@ai-sdk/anthropic` adapter
 * DROPS on the way to the structured fields.
 */
function sseWithRawReasoning(): Response {
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${MODEL_ID}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0,"output_tokens_details":{"reasoning_tokens":800}}}}\n\n`,
		`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":900}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * An EMPTY response (the retry trigger) that DOES report a reasoning
 * breakdown through the raw payload. It is a USAGE-BEARING discarded
 * attempt: the middleware aggregates its usage.
 */
function sseEmptyWithRawReasoning(): Response {
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${MODEL_ID}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0,"output_tokens_details":{"reasoning_tokens":800}}}}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":900}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * A response whose BODY DIES mid-stream, before any finish part: the
 * transport shape the production middleware classifies as a transient
 * network interruption.
 */
function sseThatDiesMidStream(): Response {
	const cause = Object.assign(new Error("other side closed"), {
		name: "SocketError",
		code: "UND_ERR_SOCKET",
	});
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				new TextEncoder().encode(
					`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${MODEL_ID}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`,
				),
			);
		},
		pull(controller) {
			controller.error(new TypeError("terminated", { cause }));
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function makeRequest(): GatewayStreamRequest {
	return {
		providerId: "minimax",
		modelId: MODEL_ID,
		messages: [
			{
				id: "user_1",
				role: "user",
				content: [{ type: "text", text: "hello" }],
				createdAt: 1,
			},
		],
		reasoning: { enabled: false },
		requestPolicy: {
			retryPolicy: {
				maxRetries: 0,
				streamRetries: 0,
				emptyResponseAttempts: 3,
			},
		},
		metadata: {
			sessionId: "session-final-correction",
			runId: "run-final-correction",
			iteration: 1,
		},
	} as unknown as GatewayStreamRequest;
}

describe("ACT-CLINEMM-CMP09-FINAL-BOUNDED-CORRECTION-01 — usage scope vs physical cardinality", () => {
	it("A1: an INTERRUPTED attempt keeps the served attempt's valid breakdown IN SCOPE", async () => {
		// Physical attempt 1: transient network interruption, NO finish usage.
		// Physical attempt 2: successful, output total 900, reasoning 800
		// reported through the established raw-only provider representation.
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return calls === 1 ? sseThatDiesMidStream() : sseWithRawReasoning();
		}) as unknown as typeof fetch;

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const stream = await gateway.stream(makeRequest());
		const usages: Array<Record<string, unknown>> = [];
		for await (const event of stream) {
			if (event.type === "usage") {
				usages.push(
					(event as unknown as { usage: Record<string, unknown> }).usage,
				);
			}
		}

		// TWO physical attempts really happened.
		expect(calls).toBe(2);
		expect(usages).toHaveLength(1);

		const usage = usages[0]!;
		const occupancy = usage.requestOccupancy as {
			state: string;
			attemptCount?: number;
			usageAttemptCount?: number;
			value?: number;
		};

		// THE PHYSICAL CARDINALITY is TWO: the interrupted attempt is a
		// physical attempt.
		expect(occupancy.attemptCount).toBe(2);
		// THE USAGE SCOPE is ONE: the interrupted attempt carried NO usage,
		// so the reported usage describes exactly ONE attempt.
		expect(occupancy.usageAttemptCount).toBe(1);

		// NO USAGE IS FABRICATED FOR THE INTERRUPTED ATTEMPT: the reported
		// expenditure is the SERVED attempt's own output total.
		expect(usage.outputTokens).toBe(100);
		// ... and the reasoning is the served attempt's own.
		expect(usage.reasoningTokenCount).toBe(800);
		// The valid breakdown is CONSERVED: 100 visible + 800 reasoning
		// reconstructs the provider's reported output total of 900.
		expect(
			(usage.outputTokens as number) + (usage.reasoningTokenCount as number),
		).toBe(900);

		// THE SERVED OCCUPANCY IS CONSERVED: the established measurement is
		// published and the request is NOT the aggregate's.
		expect(occupancy.state).toBe("known");
		expect(occupancy.value).toBe(10);
	});

	it("A1: an aggregate still NEVER reacquires a constituent's raw reasoning", async () => {
		// Two USAGE-BEARING attempts: the first reports reasoning 800, the
		// second reports NONE. The aggregate's reasoning was never
		// established, so the served attempt's raw payload must not be read
		// as the aggregate's own breakdown.
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			if (calls === 1) {
				// The FIRST attempt is EMPTY (the retry trigger) but DOES
				// report a breakdown: it is a USAGE-BEARING discarded
				// attempt.
				return sseEmptyWithRawReasoning();
			}
			// The SERVED attempt reports NO reasoning breakdown.
			const body = [
				`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"${MODEL_ID}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`,
				`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
				`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n`,
				`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
				`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":900}}\n\n`,
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			].join("");
			return new Response(body, {
				headers: { "content-type": "text/event-stream" },
			});
		}) as unknown as typeof fetch;

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const stream = await gateway.stream(makeRequest());
		const usages: Array<Record<string, unknown>> = [];
		for await (const event of stream) {
			if (event.type === "usage") {
				usages.push(
					(event as unknown as { usage: Record<string, unknown> }).usage,
				);
			}
		}

		expect(calls).toBe(2);
		const usage = usages[0]!;
		const occupancy = usage.requestOccupancy as {
			attemptCount?: number;
			usageAttemptCount?: number;
		};
		// BOTH attempts are physical AND usage-bearing.
		expect(occupancy.attemptCount).toBe(2);
		expect(occupancy.usageAttemptCount).toBe(2);
		// The aggregate's reasoning was NEVER established: it must not be
		// read from the served attempt's raw payload.
		expect(usage.reasoningTokenCount).toBeUndefined();
	});
});

describe("ACT-CLINEMM-CMP09-FINAL-BOUNDED-CORRECTION-01 — final normalization partition validity", () => {
	it("A2: only a VALID partition is published", () => {
		// The reviewer's six shapes, through the REAL normalizer.
		const invalid = [
			// 100 + 700 != 900
			{
				inputTokens: 10,
				outputTokens: 900,
				outputTokenDetails: { textTokens: 100, reasoningTokens: 700 },
			},
			// the reasoning exceeds the total
			{
				inputTokens: 10,
				outputTokens: 900,
				outputTokenDetails: { reasoningTokens: 1000 },
			},
			// a negative part
			{
				inputTokens: 10,
				outputTokens: 900,
				outputTokenDetails: { reasoningTokens: -1 },
			},
		];
		for (const usage of invalid) {
			const normalized = normalizeUsage(usage as never);
			// The AUTHORITATIVE TOTAL is never corrupted.
			expect(normalized.outputTokens).toBe(900);
			// The INVALID breakdown is not published...
			expect(normalized.reasoningTokenCount).toBeUndefined();
			// ... and an invalid metric never becomes an EXPLICIT ZERO.
			expect("reasoningTokenCount" in normalized).toBe(false);
		}
	});

	it("A2: an EXPLICIT ZERO and an ABSENT metric stay distinct", () => {
		// The provider stating "this response carried no reasoning tokens".
		const explicitZero = normalizeUsage({
			inputTokens: 10,
			outputTokens: 900,
			outputTokenDetails: { reasoningTokens: 0 },
		} as never);
		expect(explicitZero.reasoningTokenCount).toBe(0);
		expect(explicitZero.outputTokens).toBe(900);

		// A provider that does not report the metric at all.
		const absent = normalizeUsage({
			inputTokens: 10,
			outputTokens: 900,
		} as never);
		expect(absent.reasoningTokenCount).toBeUndefined();
		expect("reasoningTokenCount" in absent).toBe(false);
	});

	it("A2: a VALID partition is published and reconstructs the total", () => {
		const normalized = normalizeUsage({
			inputTokens: 10,
			outputTokens: 900,
			outputTokenDetails: { textTokens: 100, reasoningTokens: 800 },
		} as never);
		expect(normalized.outputTokens).toBe(100);
		expect(normalized.reasoningTokenCount).toBe(800);
		expect(
			(normalized.outputTokens as number) +
				(normalized.reasoningTokenCount as number),
		).toBe(900);
	});

	it("A2: a COMPLETE aggregate partition survives, an INCOMPLETE one stays incomplete", () => {
		// A COMPLETE aggregate: every attempt reports the same breakdown, so
		// the aggregate's partition IS established.
		const complete = normalizeUsage({
			inputTokens: 30,
			outputTokens: 2700,
			outputTokenDetails: { textTokens: 300, reasoningTokens: 2400 },
		} as never);
		expect(complete.outputTokens).toBe(300);
		expect(complete.reasoningTokenCount).toBe(2400);

		// An INCOMPLETE aggregate: the total is established, the breakdown is
		// not. The total is conserved and no breakdown is manufactured.
		const incomplete = normalizeUsage({
			inputTokens: 30,
			outputTokens: 2700,
			outputTokenDetails: {},
		} as never);
		expect(incomplete.outputTokens).toBe(2700);
		expect(incomplete.reasoningTokenCount).toBeUndefined();
	});
});
