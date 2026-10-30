/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 (R1/R2) — wire-reasoning
 * correlation witness.
 *
 * PURPOSE
 * -------
 * Establish that ONE opt-in JSONL trace can authoritatively LINK the
 * REQUESTED MiniMax reasoning settings to the SERIALIZED provider wire
 * controls — with an EXACT join, and WITHOUT enabling or duplicating the
 * full provider-request capture.
 *
 * Boundaries under test, in order:
 *
 *   1. Agent-side request identity (the minted `requestId` in the request
 *      metadata).
 *   2. The REAL gateway (registry resolution + reasoning normalization).
 *   3. The REAL `@ai-sdk/anthropic` transport, with a controlled fetch
 *      replacement ONLY at the external network boundary.
 *   4. The wire-observer seam — where the SERIALIZED body exists.
 *
 * WHAT MUST HOLD
 * --------------
 *   - The observer is invoked for a request that carries a `requestId`, and
 *     the observation carries that EXACT `requestId`.
 *   - The observation's sanitized wire controls agree with the REAL
 *     serialized body (`output_config.effort === "low"` for M3.1 Flash).
 *   - TWO requests produce TWO observations, joined by DISTINCT
 *     `requestId`s — never by timestamp or array adjacency.
 *   - The observation contains NO prompt, message, tool-argument, or
 *     credential material.
 *   - The full provider-request capture stays OFF: `CLINE_CAPTURE_WIRE` /
 *     `CLINE_CAPTURE_PROVIDER_REQUEST` remain unset.
 *
 * NO PROMPT TEXT, CREDENTIAL OR REASONING CONTENT IS RETAINED. The
 * observation keeps only the reasoning-relevant keys of the serialized body.
 */
import type {
	GatewayStreamRequest,
	ModelBehaviorWireReasoningObservation,
} from "@cline/shared";
import {
	MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY,
	registerModelBehaviorWireReasoningObserver,
	unregisterModelBehaviorWireReasoningObserver,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

/** The exact official MiniMax M3.1 API model identifier. */
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/** The requested reasoning effort under test. */
const REQUESTED_EFFORT = "low";

/**
 * A distinctive prompt marker.
 *
 * The assertion that the observation retains no prompt material must use a
 * marker that cannot occur by accident inside a schema key (a short word
 * like "hi" DOES occur inside "wireThinkingMode").
 */
const PROMPT_MARKER = "PROMPT-CONTENT-MUST-NOT-LEAK";

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function makeFetchMock() {
	const fetchMock = vi.fn(async () => anthropicSseResponse());
	return {
		fetchMock,
		fetch: fetchMock as unknown as typeof fetch,
	};
}

function makeGateway(fetchImpl?: typeof fetch) {
	return createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				...(fetchImpl ? { fetch: fetchImpl } : {}),
			},
		],
	});
}

function makeMessages() {
	return [
		{
			id: "user_1",
			role: "user" as const,
			content: [{ type: "text" as const, text: PROMPT_MARKER }],
			createdAt: 1,
		},
	];
}

function makeRequest(requestId: string): GatewayStreamRequest {
	return {
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		messages: makeMessages(),
		reasoning: { enabled: true, effort: REQUESTED_EFFORT },
		metadata: {
			[MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY]: requestId,
			sessionId: "session-wire-1",
			runId: "run-wire-1",
			iteration: 1,
		},
	};
}

/**
 * Drive the REAL gateway through the REAL Anthropic-compatible transport and
 * capture the serialized HTTP body.
 */
async function captureGatewayBody(
	fetchImpl: typeof fetch,
	request: GatewayStreamRequest,
): Promise<Record<string, unknown> | undefined> {
	const gateway = makeGateway(fetchImpl);
	const stream = await gateway.stream(request);
	for await (const _event of stream) {
		// drain
	}
	const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(
		-1,
	)?.[1];
	return typeof init?.body === "string"
		? (JSON.parse(init.body) as Record<string, unknown>)
		: undefined;
}

afterEach(() => {
	unregisterModelBehaviorWireReasoningObserver();
});

describe("MiniMax M3.1 wire-reasoning correlation", () => {
	it("R1: the observer sees the EXACT requestId and the REAL serialized effort", async () => {
		const observations: ModelBehaviorWireReasoningObservation[] = [];
		const unregister = registerModelBehaviorWireReasoningObserver(
			(observation) => observations.push(observation),
		);

		const { fetch, fetchMock } = makeFetchMock();
		const request = makeRequest("req-wire-1");
		const body = await captureGatewayBody(fetch, request);

		// The REAL serialized body carries the requested effort.
		expect(body?.output_config).toMatchObject({ effort: REQUESTED_EFFORT });

		// The observer was invoked for this request's HTTP attempt(s).
		expect(observations.length).toBeGreaterThanOrEqual(1);
		const observation = observations[0];
		// The join is EXACT: the minted requestId round-trips.
		expect(observation?.requestId).toBe("req-wire-1");
		expect(observation?.providerId).toBe("minimax");
		expect(observation?.modelId).toBe(EXACT_M31_MODEL_ID);
		// The sanitized wire controls agree with the REAL body.
		expect(observation?.wireReasoningEffort).toBeUndefined();
		expect(observation?.wireOutputConfigEffort).toBe(REQUESTED_EFFORT);
		// The identity travels with the observation.
		expect(observation?.sessionId).toBe("session-wire-1");
		expect(observation?.runId).toBe("run-wire-1");
		// Every attempt of ONE request carries the SAME requestId and a
		// DISTINCT 1-based attempt ordinal.
		expect(observations.every((o) => o.requestId === "req-wire-1")).toBe(true);
		expect(observations.map((o) => o.attempt)).toEqual(
			observations.map((_o, index) => index + 1),
		);
		// No prompt / message / credential material is retained.
		expect(JSON.stringify(observation)).not.toContain("test-key");
		expect(JSON.stringify(observation)).not.toContain(PROMPT_MARKER);

		unregister();
		expect(fetchMock).toHaveBeenCalled();
	});

	it("R2: TWO requests produce TWO observations joined by DISTINCT requestIds", async () => {
		const observations: ModelBehaviorWireReasoningObservation[] = [];
		const unregister = registerModelBehaviorWireReasoningObserver(
			(observation) => observations.push(observation),
		);

		const { fetch, fetchMock } = makeFetchMock();
		const first = makeRequest("req-wire-a");
		first.metadata = { ...(first.metadata ?? {}), iteration: 1 };
		const second = makeRequest("req-wire-b");
		second.metadata = { ...(second.metadata ?? {}), iteration: 2 };

		const firstBody = await captureGatewayBody(fetch, first);
		const secondBody = await captureGatewayBody(fetch, second);

		expect(firstBody?.output_config).toMatchObject({
			effort: REQUESTED_EFFORT,
		});
		expect(secondBody?.output_config).toMatchObject({
			effort: REQUESTED_EFFORT,
		});
		expect(fetchMock).toHaveBeenCalled();

		// TWO logical requests produced observations, joined by their DISTINCT
		// requestIds — never by timestamp or array adjacency.
		const requestIds = observations.map((o) => o.requestId);
		expect(new Set(requestIds)).toEqual(new Set(["req-wire-a", "req-wire-b"]));
		// Each request's attempts are numbered from 1.
		for (const requestId of ["req-wire-a", "req-wire-b"]) {
			const attempts = observations
				.filter((o) => o.requestId === requestId)
				.map((o) => o.attempt);
			expect(attempts).toEqual(attempts.map((_a, index) => index + 1));
		}
		// Both requests agree on the serialized effort.
		for (const observation of observations) {
			expect(observation.wireOutputConfigEffort).toBe(REQUESTED_EFFORT);
		}
		// The per-request iteration is carried through the metadata.
		expect(
			observations.find((o) => o.requestId === "req-wire-a")?.iteration,
		).toBe(1);
		expect(
			observations.find((o) => o.requestId === "req-wire-b")?.iteration,
		).toBe(2);

		unregister();
	});

	it("R3: the full provider-request capture stays OFF", async () => {
		const observations: ModelBehaviorWireReasoningObservation[] = [];
		const unregister = registerModelBehaviorWireReasoningObserver(
			(observation) => observations.push(observation),
		);

		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined();
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined();

		const { fetch } = makeFetchMock();
		await captureGatewayBody(fetch, makeRequest("req-wire-capture-off"));

		// The wire observer still fired — it is INDEPENDENT of the full
		// provider-request capture.
		expect(observations.length).toBeGreaterThanOrEqual(1);
		expect(
			observations.every((o) => o.requestId === "req-wire-capture-off"),
		).toBe(true);

		unregister();
	});
});
