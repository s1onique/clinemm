/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * The NUMERIC usage observation: DEFAULT-OFF, allowlist-only, and
 * failure-isolated discriminators.
 *
 * NO LIVE PROVIDER CALL. The capture is exercised directly and through the
 * REAL gateway with a controlled fetch replacement at the external network
 * boundary.
 */

import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GatewayStreamRequest } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway";
import {
	isUsageObservabilityEnabled,
	readRawNumericUsage,
	recordUsageObservability,
} from "./usage-observability-capture";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const OBSERVABILITY_ENV = "CLINEMM_USAGE_OBSERVABILITY";
const OBSERVABILITY_DIR_ENV = "CLINEMM_USAGE_OBSERVABILITY_DIR";

let captureDir: string;

beforeEach(() => {
	captureDir = mkdtempSync(join(tmpdir(), "cline-usage-obs-"));
	process.env[OBSERVABILITY_DIR_ENV] = captureDir;
	delete process.env[OBSERVABILITY_ENV];
});

afterEach(() => {
	delete process.env[OBSERVABILITY_ENV];
	delete process.env[OBSERVABILITY_DIR_ENV];
	rmSync(captureDir, { recursive: true, force: true });
});

function readCaptures(): Array<Record<string, unknown>> {
	if (!existsSync(captureDir)) {
		return [];
	}
	return readdirSync(captureDir)
		.filter((name) => name.endsWith(".usage-observability.json"))
		.map(
			(name) =>
				JSON.parse(readFileSync(join(captureDir, name), "utf8")) as Record<
					string,
					unknown
				>,
		);
}

describe("ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01 — numeric usage observation", () => {
	it("is DISABLED by default and writes nothing", () => {
		expect(isUsageObservabilityEnabled()).toBe(false);
		recordUsageObservability({
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			raw: { input_tokens: 10, output_tokens: 900 },
		});
		expect(readCaptures()).toHaveLength(0);
	});

	it("is armed ONLY by the exact value 1", () => {
		for (const value of ["0", "true", "yes", "", "  "]) {
			process.env[OBSERVABILITY_ENV] = value;
			expect(isUsageObservabilityEnabled()).toBe(false);
		}
		process.env[OBSERVABILITY_ENV] = "1";
		expect(isUsageObservabilityEnabled()).toBe(true);
	});

	it("captures the raw provider numbers, the SDK numbers and the ClineMM numbers", () => {
		process.env[OBSERVABILITY_ENV] = "1";
		recordUsageObservability({
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			sessionId: "session-1",
			modelRequestId: "attempt-1",
			iteration: 3,
			raw: {
				input_tokens: 10,
				output_tokens: 900,
				output_tokens_details: { thinking_tokens: 800 },
			},
			sdkUsage: { inputTokens: 10, outputTokens: 900 },
			clineUsage: {
				inputTokens: 10,
				outputTokens: 100,
				reasoningTokenCount: 800,
			},
		});

		const captures = readCaptures();
		expect(captures).toHaveLength(1);
		const capture = captures[0];
		expect(capture.providerId).toBe("minimax");
		expect(capture.modelId).toBe("MiniMax-M3.1-Flash");
		expect(capture.sessionId).toBe("session-1");
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the
		// identity is the LOGICAL MODEL REQUEST id. It is NOT a physical
		// attempt id: the retry middleware re-dials the same logical
		// request, so every physical attempt of the turn shares it.
		expect(capture.modelRequestId).toBe("attempt-1");
		// No PHYSICAL attempt identity is established at this boundary, so
		// none is claimed.
		expect(capture.physicalAttemptId).toBeUndefined();
		expect(capture.iteration).toBe(3);

		// The RAW provider numbers, by name.
		const raw = capture.rawProviderUsage as Array<{
			field: string;
			value: number;
			parent?: string;
		}>;
		expect(raw).toContainEqual({ field: "input_tokens", value: 10 });
		expect(raw).toContainEqual({ field: "output_tokens", value: 900 });
		expect(raw).toContainEqual({
			field: "thinking_tokens",
			value: 800,
			parent: "output_tokens_details",
		});

		// The SDK's normalized numbers.
		expect(capture.sdkUsage).toMatchObject({
			inputTokens: 10,
			outputTokens: 900,
		});
		// ClineMM's final normalized numbers.
		expect(capture.clineUsage).toMatchObject({
			inputTokens: 10,
			outputTokens: 100,
			reasoningTokenCount: 800,
		});
	});

	it("reads ONLY allowlisted numeric fields and never a non-numeric one", () => {
		const raw = readRawNumericUsage({
			input_tokens: 10,
			output_tokens: 900,
			// NOT on the allowlist: never read.
			secret_api_key: "sk-should-never-appear",
			model: "MiniMax-M3.1-Flash",
			// A stringified number is NOT coerced into a number.
			prompt_tokens: "1234",
			output_tokens_details: { thinking_tokens: 800 },
		});
		expect(raw).toContainEqual({ field: "input_tokens", value: 10 });
		expect(raw).toContainEqual({ field: "output_tokens", value: 900 });
		expect(raw).toContainEqual({
			field: "thinking_tokens",
			value: 800,
			parent: "output_tokens_details",
		});
		// The stringified number is skipped, not coerced.
		expect(raw.some((entry) => entry.field === "prompt_tokens")).toBe(false);
		// The non-allowlisted fields are never read at all.
		expect(JSON.stringify(raw)).not.toContain("should-never-appear");
		expect(JSON.stringify(raw)).not.toContain("MiniMax");
	});

	it("correlates the physical request identity through the REAL gateway", async () => {
		process.env[OBSERVABILITY_ENV] = "1";
		const body = [
			`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0,"output_tokens_details":{"thinking_tokens":800}}}}\n\n`,
			`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
			`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}\n\n`,
			`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
			`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":900}}\n\n`,
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		].join("");
		const fetchImpl = (async () =>
			new Response(body, {
				headers: { "content-type": "text/event-stream" },
			})) as unknown as typeof fetch;

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
		const request: GatewayStreamRequest = {
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			messages: [
				{
					id: "user_1",
					role: "user" as const,
					content: [{ type: "text" as const, text: "hello" }],
					createdAt: 1,
				},
			],
			reasoning: { enabled: true, effort: "low" },
			metadata: {
				sessionId: "session-obs",
				runId: "run-obs",
				iteration: 2,
				modelRequestId: "attempt-obs",
			},
		};

		const stream = await gateway.stream(request);
		for await (const _event of stream) {
			// Drain the stream so the usage seam runs.
		}

		const captures = readCaptures();
		expect(captures).toHaveLength(1);
		const capture = captures[0];
		expect(capture.providerId).toBe("minimax");
		expect(capture.modelId).toBe("MiniMax-M3.1-Flash");
		expect(capture.sessionId).toBe("session-obs");
		expect(capture.modelRequestId).toBe("attempt-obs");
		expect(capture.physicalAttemptId).toBeUndefined();
		expect(capture.iteration).toBe(2);
		// The provider's own numbers are observable...
		const raw = capture.rawProviderUsage as Array<{
			field: string;
			value: number;
		}>;
		expect(raw).toContainEqual({ field: "output_tokens", value: 900 });
		// ...and the final ClineMM numbers conserve them.
		expect(capture.clineUsage).toMatchObject({
			outputTokens: 100,
			reasoningTokenCount: 800,
		});
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6): the SCOPE
		// is stated. ONE physical attempt was observed, so the recorded usage
		// describes that physical request — and a reader can tell it apart
		// from a turn aggregate.
		expect(capture.usageScope).toBe("physical-attempt");
	});

	it("never lets a capture failure change execution or accounting", () => {
		process.env[OBSERVABILITY_ENV] = "1";
		// Point the capture at a path that cannot be created.
		process.env[OBSERVABILITY_DIR_ENV] = "/dev/null/impossible";
		expect(() =>
			recordUsageObservability({
				providerId: "minimax",
				raw: { output_tokens: 900 },
				clineUsage: { outputTokens: 100 },
			}),
		).not.toThrow();
	});

	it("states the scope so an aggregate is never read as one physical request's usage", () => {
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6).
		//
		// The scope is stated verbatim by the caller and recorded verbatim by
		// the capture. A turn AGGREGATE is therefore distinguishable from a
		// single physical request's usage, which is the distinction the ACT
		// requires: the two are different quantities (the billing total
		// versus one request's own consumption).
		process.env[OBSERVABILITY_ENV] = "1";
		recordUsageObservability({
			providerId: "minimax",
			modelRequestId: "attempt-obs",
			raw: { output_tokens: 2700 },
			clineUsage: { outputTokens: 2700 },
			usageScope: "turn-aggregate",
		});
		const captures = readCaptures();
		const aggregate = captures.find(
			(capture) => capture.usageScope === "turn-aggregate",
		);
		expect(aggregate).toBeDefined();
		expect(aggregate?.modelRequestId).toBe("attempt-obs");
		expect(aggregate?.clineUsage?.outputTokens).toBe(2700);
	});

	it("A4: a REAL three-attempt turn records TRUTHFUL scopes, not a physical-attempt identity", async () => {
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4).
		//
		// The predecessor's record carried the raw provider usage, the SDK
		// usage and the normalized usage under ONE scope, and used the
		// LOGICAL model request id as a PHYSICAL attempt id.
		//
		// This drives the REAL gateway with the REAL retry middleware over
		// a controlled fetch: three physical attempts, the first two EMPTY
		// (the retry trigger) and the third served.
		process.env[OBSERVABILITY_ENV] = "1";
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			const empty = calls < 3;
			const body = [
				`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`,
				empty
					? ""
					: `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
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
		const request: GatewayStreamRequest = {
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
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
				sessionId: "session-a4",
				runId: "run-a4",
				iteration: 1,
				modelRequestId: "logical-request-1",
			},
		} as unknown as GatewayStreamRequest;

		const stream = await gateway.stream(request);
		for await (const _event of stream) {
			// Drain the stream so the usage seam runs.
		}
		expect(calls).toBe(3);

		const captures = readCaptures();
		expect(captures).toHaveLength(1);
		const capture = captures[0]!;

		// THE AGGREGATE IS NOT READ AS ONE PHYSICAL REQUEST'S USAGE.
		expect(capture.usageScope).toBe("turn-aggregate");

		// THE IDENTITY IS THE LOGICAL MODEL REQUEST, NOT A PHYSICAL ATTEMPT.
		// The retry middleware re-dials the SAME logical request, so the
		// three physical attempts share ONE id — presenting it as a
		// physical attempt id would assert a correlation that does not
		// exist.
		expect(capture.modelRequestId).toBe("logical-request-1");
		expect(capture.physicalAttemptId).toBeUndefined();

		// THE PHYSICAL ATTEMPT COUNT IS OBSERVED, AND THE RAW PAYLOAD'S
		// SCOPE IS THE SERVED ATTEMPT — never the aggregate's.
		expect(capture.observedAttemptCount).toBe(3);
		expect(capture.rawUsageScope).toBe("served-attempt");
	});
});
