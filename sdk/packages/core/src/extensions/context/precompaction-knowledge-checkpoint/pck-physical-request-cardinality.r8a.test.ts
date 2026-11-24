/**
 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — A02b-R8a
 *
 * The BOUNDED FOLLOW-UP witnesses for the two retry authorities the
 * predecessor's GREEN suite did NOT exercise.
 *
 * ============================================================================
 * THE GAP THIS FILE CLOSES
 * ============================================================================
 *
 * The predecessor's GREEN suite drove the REAL production transport with
 * synthetic HTTP failures at the REQUEST-INITIATION boundary:
 *
 *     [429, 500, 502, 503]
 *
 * Every one of those exercises the `maxRetries` authority. NONE of them
 * exercises:
 *
 *   1. the POST-STREAM-START authority (`streamRetries`), and
 *   2. the EMPTY-RESPONSE authority (`emptyResponseAttempts`).
 *
 * The review also established an AI SDK subtlety that makes the gap
 * load-bearing: in AI SDK v7 (`ai@7.0.159`), `streamRetries: 0` disables
 * AUTOMATIC stream retries but STILL permits a CALLBACK-DIRECTED retry when
 * `onError` returns `{ retry: true }`. So `streamRetries: 0` alone does not
 * prove the post-stream-start authority is disarmed.
 *
 * This file therefore proves the contract EMPIRICALLY for each authority:
 *
 *   - the authority is DISARMED when the PCK policy is applied, AND
 *   - the authority is LIVE when the policy is removed (the retry-POSITIVE
 *     CONTROL), so the disarm assertion is not vacuous.
 *
 * ============================================================================
 * WHAT IT DOES NOT CLAIM
 * ============================================================================
 *
 * It does not claim installed-live qualification. The witnesses are
 * `SYNTHETIC_REAL`: they drive the REAL production transport with synthetic
 * wire responses.
 */

import type { ProviderConfig } from "@cline/llms";
import { createHandlerAsync } from "@cline/llms";
import { describe, expect, it } from "vitest";
import {
	applyPckPhysicalRequestPolicy,
	PCK_PHYSICAL_REQUEST_POLICY,
} from "./physical-request-policy";

const QUALIFIED_PROVIDER_ID = "openai-compatible";
const QUALIFIED_MODEL_ID = "qwen3.8-flash-next-q2_0";

/**
 * The checkpoint's configuration WITHOUT any physical-request policy.
 *
 * This is the PREDECESSOR configuration: exactly what the production seam
 * handed to the transport before the repair.
 */
function predecessorConfig(): Record<string, unknown> {
	return {
		providerId: QUALIFIED_PROVIDER_ID,
		modelId: QUALIFIED_MODEL_ID,
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 1024,
		thinking: false,
	};
}

/**
 * The checkpoint's configuration as the PRODUCTION seam now builds it.
 */
function pckConfig(): Record<string, unknown> {
	return applyPckPhysicalRequestPolicy(
		predecessorConfig() as never,
	) as unknown as Record<string, unknown>;
}

/**
 * ONE SSE response body that OPENS a stream and then fails.
 *
 * The stream starts (the HTTP response is 200 and the first SSE frame is
 * delivered), and THEN the provider emits an error part. That is the
 * POST-STREAM-START failure class: the `maxRetries` authority cannot cover
 * it, because the request was already initiated successfully.
 */
function postStreamStartErrorSse(): string {
	return [
		`data: ${JSON.stringify({
			id: "chatcmpl-stream-error",
			object: "chat.completion.chunk",
			created: 1,
			model: QUALIFIED_MODEL_ID,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "partial" },
					finish_reason: null,
				},
			],
		})}`,
		"",
		`data: ${JSON.stringify({
			error: { message: "upstream stream failure", type: "server_error" },
		})}`,
		"",
		"data: [DONE]",
		"",
	].join("\n");
}

/**
 * ONE SSE response body that OPENS a stream and then delivers NOTHING.
 *
 * The stream opens, the HTTP response is 200, and no content frame arrives.
 * That is the EMPTY-RESPONSE class the empty-response middleware exists to
 * recover from.
 */
function emptyResponseSse(): string {
	return ["data: [DONE]", ""].join("\n");
}

/**
 * Drive ONE turn through the REAL production transport and count the
 * physical provider requests that reached the wire.
 *
 * The stub answers with the supplied SSE body for EVERY request, so the
 * count is the number of physical requests the transport actually made.
 */
async function countPhysicalRequests(input: {
	readonly providerConfig: Record<string, unknown>;
	readonly body: string;
}): Promise<number> {
	let physicalRequests = 0;
	const fetchStub = (async () => {
		physicalRequests += 1;
		return new Response(input.body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	const handler = await createHandlerAsync({
		...(input.providerConfig as unknown as ProviderConfig),
		fetch: fetchStub,
	});
	// The request is EXPECTED to fail; the count is the observation.
	try {
		for await (const _chunk of handler.createMessage("system prompt", [
			{ role: "user", content: "checkpoint request" },
		])) {
			// drain whatever the transport emits
		}
	} catch {
		// The failure is the point of the witness.
	}
	return physicalRequests;
}

describe("ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — A02b-R8a", () => {
	it("R8a.1: a POST-STREAM-START failure issues EXACTLY ONE physical request", async () => {
		const physicalRequests = await countPhysicalRequests({
			providerConfig: pckConfig(),
			body: postStreamStartErrorSse(),
		});
		expect(physicalRequests).toBe(1);
	});

	it("R8a.2 CONTROL: the post-stream-start authority IS LIVE without the policy", async () => {
		// The retry-POSITIVE CONTROL. If this were NOT greater than one, the
		// R8a.1 assertion would be VACUOUS: the transport would never retry
		// a post-stream-start failure in the first place, and the policy
		// would have nothing to disarm.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
			body: postStreamStartErrorSse(),
		});
		expect(physicalRequests).toBeGreaterThan(1);
	});

	it("R8a.3: an EMPTY response issues EXACTLY ONE physical request", async () => {
		const physicalRequests = await countPhysicalRequests({
			providerConfig: pckConfig(),
			body: emptyResponseSse(),
		});
		expect(physicalRequests).toBe(1);
	});

	it("R8a.4 CONTROL: the empty-response authority IS LIVE without the policy", async () => {
		// The retry-POSITIVE CONTROL for the empty-response middleware.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
			body: emptyResponseSse(),
		});
		expect(physicalRequests).toBeGreaterThan(1);
	});

	it("R8a.5: BOTH remaining authorities are disarmed together", async () => {
		// The combined case: the PCK request must issue exactly one
		// physical request for the post-stream-start failure class AND for
		// the empty-response class.
		for (const body of [postStreamStartErrorSse(), emptyResponseSse()]) {
			const physicalRequests = await countPhysicalRequests({
				providerConfig: pckConfig(),
				body,
			});
			expect(physicalRequests).toBe(1);
		}
	});

	it("R8a.6 CONSERVATION: an ORDINARY request keeps BOTH authorities", async () => {
		// The repair is request-scoped. A request that does NOT assert the
		// policy keeps the transport's default retry budgets for the two
		// authorities the predecessor's suite did not cover.
		for (const body of [postStreamStartErrorSse(), emptyResponseSse()]) {
			const physicalRequests = await countPhysicalRequests({
				providerConfig: predecessorConfig(),
				body,
			});
			expect(physicalRequests).toBeGreaterThan(1);
		}
	});

	it("R8a.7: the policy STILL names all three authorities explicitly", async () => {
		// The declaration is unchanged by this follow-up: the policy still
		// names the request-initiation authority, the post-stream-start
		// authority and the empty-response authority.
		expect(PCK_PHYSICAL_REQUEST_POLICY.retryPolicy).toEqual({
			maxRetries: 0,
			streamRetries: 0,
			emptyResponseAttempts: 1,
		});
	});

	it("R8a.8: the policy NEVER mutates the configuration it was given", async () => {
		const original = predecessorConfig();
		const before = JSON.stringify(original);
		const applied = applyPckPhysicalRequestPolicy(original as never);
		expect(JSON.stringify(original)).toBe(before);
		expect(applied).not.toBe(original);
	});
});
