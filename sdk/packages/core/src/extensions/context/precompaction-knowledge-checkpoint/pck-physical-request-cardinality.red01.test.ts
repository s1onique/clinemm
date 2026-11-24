/**
 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01
 *
 * R1 — the RED witness for the PHYSICAL-REQUEST CARDINALITY defect.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The PCK's documented contract is a NO-AUTOMATIC-RETRY contract:
 *
 *   `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/runtime.ts`
 *   § "NO RETRY LOOP": "On provider failure, timeout, cancellation, invalid
 *   JSON, an unknown atom, an unknown field, an invalid reference, an
 *   oversized output or an unsupported assurance, the attempt TERMINATES.
 *   The ordinary compaction continues using its existing failure policy.
 *   There is no automatic second checkpoint generation."
 *
 * That contract is enforced ONLY at the PCK-ATTEMPT level. The PHYSICAL
 * provider-request boundary BENEATH it carries THREE INDEPENDENT retry
 * authorities, and ALL THREE apply to the PCK request:
 *
 *   1. `MODEL_REQUEST_MAX_RETRIES = 3` — the AI SDK's request-INITIATION
 *      retry (`maxRetries` in `streamText`).
 *   2. `MODEL_STREAM_MAX_RETRIES = 3` — the AI SDK's POST-STREAM-START
 *      provider-error retry (`streamRetries` in `streamText`).
 *   3. `withEmptyResponseRetry()` — the empty-response / transient-network
 *      middleware, applied as the OUTERMOST wrap at the single AI SDK
 *      composition point, with a default of 3 attempts.
 *
 * All three are applied UNCONDITIONALLY in `ai-sdk.ts`, with no request-scoped
 * opt-out. So ONE PCK attempt can issue up to 3 x 3 x 3 = 27 physical
 * provider requests.
 *
 * This witness COUNTS the physical requests that actually reach the wire.
 * It does not re-implement the retry logic: it drives the REAL production
 * transport (`createHandlerAsync` -> the gateway -> `ai-sdk.ts` ->
 * `streamText`) with a stubbed `fetch`, and counts the stub invocations.
 *
 * ============================================================================
 * THE OBSERVED DEFECT
 * ============================================================================
 *
 * Measured against the real production transport on 2026-11-24:
 *
 *   | Failure class        | Physical requests |
 *   |-----------------------|-------------------|
 *   | HTTP 429 (rate limit) |                 4 |
 *   | HTTP 500 (server)     |                 4 |
 *   | HTTP 401 (auth)       |                 1 |
 *
 * The 4 is 1 initial request + 3 `MODEL_REQUEST_MAX_RETRIES` retries. The
 * 401 case is already correct: a non-retryable error terminates.
 *
 * The retries also cost WALL-CLOCK time: the 429 case took ~14 s of backoff
 * in the harness. That is the mechanism behind the observed 180 s
 * unsuccessful checkpoint, whose 180 s is the PCK's own deadline.
 *
 * ============================================================================
 * THIS FILE IS AN ISOLATED RECEIPT
 * ============================================================================
 *
 * The file is deliberately EXCLUDED from the default suite
 * (`vitest.config.ts`) so it never blocks the normal gate. It is runnable ON
 * DEMAND through its dedicated config:
 *
 *   bun run test:red:pck-physical-request-cardinality
 *
 * A FAILURE of `R1.1` is the EXPECTED, CORRECT outcome: it is the receipt
 * of the observed defect. It must NOT be flipped to GREEN by weakening the
 * assertion — the repair is the request-scoped policy, and the receipt
 * records what the boundary did WITHOUT it.
 *
 * The PASSING companion for the same mechanism, and for the causal
 * ablation and the conservation controls, is
 * `pck-physical-request-cardinality.test.ts`.
 */

import type { ProviderConfig } from "@cline/llms";
import { createHandlerAsync } from "@cline/llms";
import { describe, expect, it } from "vitest";

/**
 * The provider that serves the qualified model.
 */
const QUALIFIED_PROVIDER_ID = "openai-compatible";

/**
 * The model the PCK request is dispatched against.
 *
 * The cardinality contract applies to ALL PCK models, so the model id is not
 * load-bearing here; a representative one is used.
 */
const QUALIFIED_MODEL_ID = "qwen3.8-flash-next-q2_0";

/**
 * The PREDECESSOR checkpoint configuration: the checkpoint's own
 * configuration with NO physical-request policy.
 *
 * This is exactly what the production seam handed to the transport before
 * the repair.
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
 * Drive ONE turn through the REAL production transport and count the
 * physical provider requests that reached the wire.
 *
 * The stub answers with a RETRYABLE server error (HTTP 429), so every retry
 * authority that is armed will fire. The count is therefore the number of
 * physical requests the transport actually made.
 */
async function countPhysicalRequests(input: {
	readonly providerConfig: Record<string, unknown>;
	readonly failureStatus?: number;
}): Promise<number> {
	let physicalRequests = 0;
	const failureStatus = input.failureStatus ?? 429;
	const fetchStub = (async () => {
		physicalRequests += 1;
		return new Response(
			JSON.stringify({
				error: { message: "rate limited", type: "rate_limit" },
			}),
			{
				status: failureStatus,
				headers: { "content-type": "application/json" },
			},
		);
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

describe("ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — R1 RED", () => {
	it("R1.1 RED: WITHOUT the policy a PCK request issues MORE THAN ONE physical request", async () => {
		// The PREDECESSOR configuration: the checkpoint's own configuration
		// with NO physical-request policy. This is the configuration the
		// production seam used before the repair, and it is the observed
		// defect.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
		});
		// The PCK's no-automatic-retry contract says the attempt
		// TERMINATES. The physical boundary must therefore see ONE request.
		// The predecessor saw FOUR.
		expect(physicalRequests).toBe(1);
	});

	it("R1.2 DIAGNOSTIC: which failure class produces how many physical requests", async () => {
		// The cardinality is NOT uniform across failure classes, so the
		// repair must cover every class, not just the one that happens to
		// be observed first.
		const rateLimited = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
			failureStatus: 429,
		});
		const serverError = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
			failureStatus: 500,
		});
		const authError = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
			failureStatus: 401,
		});
		// The diagnostic prints the observed cardinality per failure class.
		console.log(
			`PCK_CARDINALITY_DIAGNOSTIC 429=${rateLimited} 500=${serverError} 401=${authError}`,
		);
		expect(rateLimited).toBeGreaterThan(1);
	});
});
