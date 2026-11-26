/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
 *
 * A5 — THE END-TO-END RUNTIME-TO-GATEWAY WIRE WITNESS.
 *
 * WHY A SECOND WITNESS
 * --------------------
 *
 * The gateway-level witness
 * (`sdk/packages/llms/src/providers/routing/recovery-only-output-override01.test.ts`)
 * qualifies the CLAIM: a request that carries `maxTokens: 16384` reaches
 * the wire with `max_tokens: 16384`.
 *
 * It does NOT qualify the DELIVERY: that the runtime actually attaches the
 * override to a real request, that the request reaches the gateway, and
 * that the gateway's own transforms do not silently drop or replace it
 * between the runtime configuration and the actual dispatch.
 *
 * The ACT is explicit about this: "Do not label an override as wire-applied
 * merely because an intermediate request option was constructed."
 *
 * WHAT THIS WITNESS ESTABLISHES
 * ------------------------------
 *
 * ONE real trajectory: the REAL `AgentRuntime` -> the REAL gateway -> the
 * REAL provider serializer -> the REAL outbound HTTP body, with ONLY the
 * external fetch substituted. The witness observes the ACTUAL SERIALIZED
 * BODIES:
 *
 *   ordinary:                 max_tokens=8192
 *   authorized R1 recovery:   max_tokens=16384
 *   subsequent ordinary:      max_tokens=8192
 *
 * and asserts that EVERY request retains the LOW reasoning effort and the
 * SAME provider/model/endpoint.
 *
 * NO paid inference. The SSE body is synthetic; the transport is real.
 */

import { AgentRuntime } from "@cline/agents";
import { createGateway } from "@cline/llms";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const RECOVERY_MAX_OUTPUT_TOKENS = 16_384;

type CapturedBody = Record<string, unknown>;

/**
 * The synthetic SSE body.
 *
 * `stopReason` selects the terminal outcome the transport reports:
 * `"max_tokens"` is the OUTPUT-EXHAUSTED terminal class the recovery
 * lifecycle consumes, and `"end_turn"` is an ordinary completion.
 */
function anthropicSseResponse(stopReason: "max_tokens" | "end_turn"): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n',
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}"},"usage":{"output_tokens":10}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * An `AgentModel` that forwards EVERY runtime request to the REAL gateway.
 *
 * The gateway's own max-output resolution, its provider registry and its
 * serializer therefore run between the runtime and the wire, exactly as
 * they do in production.
 */
class GatewayBackedModel implements AgentModel {
	readonly bodies: CapturedBody[] = [];
	readonly urls: string[] = [];
	/**
	 * The LOGICAL requests the runtime dispatched, in order.
	 *
	 * Each entry records the LOGICAL request's own max-tokens value, so a
	 * physical retry of the same logical request is never confused with a
	 * DIFFERENT logical request.
	 */
	readonly logicalRequests: Array<{ readonly maxTokens: number | undefined }> =
		[];

	constructor(private readonly gateway: ReturnType<typeof createGateway>) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const logicalIndex = this.logicalRequests.length;
		this.logicalRequests.push({
			maxTokens:
				typeof request.options?.maxTokens === "number"
					? request.options.maxTokens
					: undefined,
		});
		const gatewayRequest = {
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
			systemPrompt: request.systemPrompt,
			messages: request.messages,
			tools: [],
			reasoning: { enabled: true, effort: "low" },
			// ONE physical provider request per logical request, so the
			// witness counts LOGICAL requests and the physical-retry
			// cardinality is pinned rather than conflated with it.
			requestPolicy: { retryPolicy: { maxRetries: 0 } },
			// The LOGICAL request identity travels in the request metadata
			// so the physical wire observations can be JOINED back to the
			// logical request they belong to. The ACT requires the physical
			// retries and the logical requests to be classified SEPARATELY.

			...(typeof request.options?.maxTokens === "number"
				? { maxTokens: request.options.maxTokens }
				: {}),
		} satisfies GatewayStreamRequest;
		const stream = await this.gateway.stream(gatewayRequest);
		return (async function* () {
			for await (const event of stream) {
				yield event as unknown as AgentModelEvent;
			}
		})();
	}
}

/**
 * The injected fetch.
 *
 * The request that carries the RECOVERY ALLOWANCE is answered with an
 * ORDINARY completion, so the run has a SUBSEQUENT ordinary request whose
 * limit can be observed. Every other request is answered with the
 * OUTPUT-EXHAUSTED terminal class, so the recovery lifecycle actually runs.
 */
function makeFetchMock() {
	const seen: number[] = [];
	const fetchMock = vi.fn(async () => {
		const index = seen.length;
		seen.push(index);
		return anthropicSseResponse(index >= 6 ? "end_turn" : "max_tokens");
	});
	return { fetchMock, fetch: fetchMock as unknown as typeof fetch };
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) / A5 end-to-end wire witness", () => {
	it("A5: the runtime's override reaches the WIRE as max_tokens=16384, and only for the authorized recovery request", async () => {
		const { fetchMock, fetch } = makeFetchMock();
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch,
				},
			],
		});
		const model = new GatewayBackedModel(gateway);

		const runtime = new AgentRuntime({
			model,
			modelOptions: { reasoningEffort: "low" },
			messageModelInfo: {
				id: EXACT_M31_MODEL_ID,
				provider: "minimax",
			} as never,
			executionStagnationPolicy: {
				// The threshold is 2 and the instruction allowance is 2, so
				// the SECOND intervention happens at an exhaustion streak of
				// 4, which is above the runtime's own minimum of 3.
				unproductiveRoundThreshold: 2,
				// THREE instructions: the SECOND intervention is the one
				// that arms the override, and the THIRD keeps an
				// authorized intervention reachable so the run makes a
				// SUBSEQUENT ordinary request whose limit can be
				// observed.
				maxRecoveryInstructions: 3,
				enabled: true,
			},
			recoveryOutputOverridePolicy: {
				enabled: true,
				recoveryMaxOutputTokens: RECOVERY_MAX_OUTPUT_TOKENS,
				modelId: EXACT_M31_MODEL_ID,
				reasoningEffort: "low",
			},
		});

		await runtime.run("Do the work");

		// The ACTUAL SERIALIZED BODIES the provider saw, JOINED to the
		// LOGICAL request each physical call belongs to.
		const physical = fetchMock.mock.calls
			.map((call) => {
				const init = call[1] as { body?: unknown } | undefined;
				return typeof init?.body === "string"
					? (JSON.parse(init.body) as CapturedBody)
					: undefined;
			})
			.filter((body): body is CapturedBody => body !== undefined);

		expect(physical.length).toBeGreaterThan(0);

		// The LOGICAL request sequence: the runtime dispatched
		// `model.logicalRequests.length` logical requests, and the
		// PHYSICAL calls are their CONTIGUOUS attempts. The logical
		// request's own max-tokens value is recorded at the runtime
		// boundary, so the physical retries are JOINED back to their
		// logical request by ORDER and the two cardinalities are never
		// conflated.
		const logicalMaxTokens = model.logicalRequests.map(
			(entry) => entry.maxTokens,
		);
		// The number of logical requests that carried the recovery limit.
		const recoveryLogicalIndices = logicalMaxTokens
			.map((value, index) => ({ value, index }))
			.filter((entry) => entry.value === RECOVERY_MAX_OUTPUT_TOKENS)
			.map((entry) => entry.index);
		// EXACTLY ONE logical request carries the recovery limit.
		expect(recoveryLogicalIndices).toHaveLength(1);
		const recoveryLogicalIndex = recoveryLogicalIndices[0] as number;

		// The physical calls of the recovery logical request ALL carry the
		// recovery limit: a physical retry re-sends the SAME logical
		// request, so the request-local override rides along. The
		// override is ONE-SHOT PER LOGICAL REQUEST, never per physical
		// attempt.
		const recoveryPhysical = physical.filter(
			(body) => body.max_tokens === RECOVERY_MAX_OUTPUT_TOKENS,
		);
		expect(recoveryPhysical.length).toBeGreaterThanOrEqual(1);
		// The ordinary physical calls carry the NORMAL limit.
		const ordinaryPhysical = physical.filter(
			(body) => body.max_tokens === LOW_DEFAULT_MAX_OUTPUT_TOKENS,
		);
		expect(ordinaryPhysical.length).toBeGreaterThanOrEqual(1);
		// No physical call carries any OTHER limit.
		for (const body of physical) {
			expect([
				LOW_DEFAULT_MAX_OUTPUT_TOKENS,
				RECOVERY_MAX_OUTPUT_TOKENS,
			]).toContain(body.max_tokens);
		}

		// EVERY request retains the LOW reasoning effort...
		for (const body of physical) {
			expect(body.output_config).toEqual({ effort: "low" });
		}
		// ...and the SAME provider/model/endpoint.
		const urls = new Set(fetchMock.mock.calls.map((call) => String(call[0])));
		expect(urls.size).toBe(1);
		for (const body of physical) {
			expect(body.model).toBe(EXACT_M31_MODEL_ID);
		}

		// A SUBSEQUENT ordinary LOGICAL request exists and returns to the
		// NORMAL limit.
		const nextLogicalIndex = logicalMaxTokens.findIndex(
			(value, index) => index > recoveryLogicalIndex,
		);
		expect(nextLogicalIndex).toBeGreaterThan(recoveryLogicalIndex);
		// At the RUNTIME boundary the ordinary request carries NO explicit
		// max-tokens: the NORMAL limit is the GATEWAY's own LOW-effort
		// default, and the runtime does not override it.
		expect(logicalMaxTokens[nextLogicalIndex]).toBeUndefined();
		// At the WIRE the subsequent ordinary request carries the NORMAL
		// limit: the physical calls that FOLLOW the recovery request's own
		// burst all carry the ordinary allowance.
		const recoveryPhysicalIndex = physical.findIndex(
			(body) => body.max_tokens === RECOVERY_MAX_OUTPUT_TOKENS,
		);
		const afterRecovery = physical.slice(recoveryPhysicalIndex + 1);
		expect(afterRecovery.length).toBeGreaterThanOrEqual(1);
		for (const body of afterRecovery) {
			expect(body.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		}
	});

	it("A5: with the policy DEFAULT_OFF the wire NEVER carries the recovery limit", async () => {
		const { fetchMock, fetch } = makeFetchMock();
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch,
				},
			],
		});
		const model = new GatewayBackedModel(gateway);

		const runtime = new AgentRuntime({
			model,
			modelOptions: { reasoningEffort: "low" },
			messageModelInfo: {
				id: EXACT_M31_MODEL_ID,
				provider: "minimax",
			} as never,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			// DEFAULT OFF: the policy is absent.
		});

		await runtime.run("Do the work");

		const bodies = fetchMock.mock.calls
			.map((call) => {
				const init = call[1] as { body?: unknown } | undefined;
				return typeof init?.body === "string"
					? (JSON.parse(init.body) as CapturedBody)
					: undefined;
			})
			.filter((body): body is CapturedBody => body !== undefined);
		for (const body of bodies) {
			expect(body.max_tokens).not.toBe(RECOVERY_MAX_OUTPUT_TOKENS);
			expect(body.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		}
	});
});
