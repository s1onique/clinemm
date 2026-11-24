/**
 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01
 *
 * G1 — the GREEN companion for the PHYSICAL-REQUEST CARDINALITY repair.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The PCK's NO-AUTOMATIC-RETRY contract is enforced at the PHYSICAL
 * provider-request boundary:
 *
 *   A PCK request that fails at the provider boundary issues EXACTLY ONE
 *   physical provider request.
 *
 * The witness drives the REAL production transport (`createHandlerAsync` ->
 * the gateway -> `ai-sdk.ts` -> `streamText`) with a stubbed `fetch` and
 * counts the stub invocations. It does not re-implement the retry logic.
 *
 * ============================================================================
 * THE THREE AUTHORITIES THE REPAIR DISARMS
 * ============================================================================
 *
 *   1. `maxRetries` — the AI SDK's request-INITIATION retry.
 *   2. `streamRetries` — the AI SDK's POST-STREAM-START provider-error retry.
 *   3. `withEmptyResponseRetry()` — the empty-response / transient-network
 *      middleware.
 *
 * ============================================================================
 * WHAT IS PRESERVED
 * ============================================================================
 *
 * The ordinary working-agent and summarizer retries are UNTOUCHED: the
 * policy is request-scoped, and a request that does not assert it keeps the
 * transport's default retry budgets. The causal ablation (G1.4) proves the
 * GREEN result is caused by the policy and not by the harness.
 *
 * The isolated RED receipt of the same mechanism is
 * `pck-physical-request-cardinality.red01.test.ts`.
 */

import type { ProviderConfig } from "@cline/llms";
import { createHandlerAsync } from "@cline/llms";
import { describe, expect, it } from "vitest";
import { resolveSummarizerConfig } from "../compaction-shared";
import {
	applyPckInferencePolicy,
	PCK_INFERENCE_POLICY_ENV_VAR,
	QWEN_STRATA_V1_POLICY_ID,
	resolvePckInferencePolicy,
} from "./inference-policy";
import {
	applyPckPhysicalRequestPolicy,
	PCK_PHYSICAL_REQUEST_POLICY,
} from "./physical-request-policy";

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
 * The checkpoint's own configuration, WITHOUT any physical-request policy.
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
 * Drive ONE turn through the REAL production transport and count the
 * physical provider requests that reached the wire.
 *
 * The stub answers with a retryable server error, so every retry authority
 * that is armed fires. The count is therefore the number of physical
 * requests the transport actually made.
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

describe("ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — G1", () => {
	it("G1.1: the PCK request issues EXACTLY ONE physical provider request", async () => {
		const physicalRequests = await countPhysicalRequests({
			providerConfig: pckConfig(),
		});
		expect(physicalRequests).toBe(1);
	});

	it("G1.2: the policy holds for EVERY retryable failure class", async () => {
		// The cardinality must be ONE for every class, not merely for the
		// one observed first. The predecessor produced FOUR for each of
		// these.
		for (const failureStatus of [429, 500, 502, 503]) {
			const physicalRequests = await countPhysicalRequests({
				providerConfig: pckConfig(),
				failureStatus,
			});
			expect(physicalRequests).toBe(1);
		}
	});

	it("G1.3 CONSERVATION: an ORDINARY request keeps its retries", async () => {
		// The repair is request-scoped. A request that does NOT assert the
		// policy keeps the transport's default retry budgets, so the
		// ordinary working-agent and summarizer retries are preserved.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
		});
		expect(physicalRequests).toBeGreaterThan(1);
	});

	it("G1.4 NON-VACUITY: removing the policy RESTORES the defect", async () => {
		// The GREEN assertion above must be caused by the policy, not by
		// the test harness. Removing the policy must bring the cardinality
		// back.
		const withPolicy = await countPhysicalRequests({
			providerConfig: pckConfig(),
		});
		const withoutPolicy = await countPhysicalRequests({
			providerConfig: predecessorConfig(),
		});
		expect(withPolicy).toBe(1);
		expect(withoutPolicy).toBeGreaterThan(withPolicy);
	});

	it("G1.5: the policy NEVER mutates the configuration it was given", async () => {
		const original = predecessorConfig();
		const before = JSON.stringify(original);
		const applied = applyPckPhysicalRequestPolicy(original as never);
		// The source configuration is byte-identical.
		expect(JSON.stringify(original)).toBe(before);
		// The applied configuration is a DIFFERENT object.
		expect(applied).not.toBe(original);
		// And it carries the policy.
		expect((applied as { requestPolicy?: unknown }).requestPolicy).toEqual(
			PCK_PHYSICAL_REQUEST_POLICY,
		);
	});

	it("G1.6: the policy disarms ALL THREE retry authorities", async () => {
		// A partial disarm would leave a retry path open. The policy must
		// name all three explicitly.
		expect(PCK_PHYSICAL_REQUEST_POLICY.retryPolicy).toEqual({
			maxRetries: 0,
			streamRetries: 0,
			emptyResponseAttempts: 1,
		});
	});

	it("G1.7 SEAM: the PRODUCTION seam's configuration carries the policy", async () => {
		// The witness above exercises the policy APPLICATION. This one
		// exercises the PRODUCTION SEAM's own configuration construction:
		// the exact sequence `local-runtime-host.ts` runs —
		//
		//   resolveSummarizerConfig(...)
		//     -> resolvePckInferencePolicy(...)  [opt-in scoped]
		//     -> applyPckInferencePolicy(...)    [opt-in scoped]
		//     -> applyPckPhysicalRequestPolicy(...)  [ALWAYS]
		//     -> generateSummary(...)
		//
		// The seam must carry the physical-request policy UNCONDITIONALLY:
		// for every model, every provider and every operator, and
		// independently of whether the Qwen inference policy applied.
		const resolved = resolveSummarizerConfig({
			activeProviderConfig: predecessorConfig() as never,
		});
		// The inference policy does NOT apply without the opt-in.
		const inferenceResolution = resolvePckInferencePolicy({
			purpose: "pck",
			featureEnabled: true,
			effectiveProviderConfig: resolved,
			env: {},
		});
		expect(inferenceResolution.applied).toBe(false);
		const effective = inferenceResolution.applied
			? applyPckInferencePolicy(resolved, inferenceResolution.parameters)
			: resolved;
		// And the seam's physical-request policy applies anyway.
		const seamConfig = applyPckPhysicalRequestPolicy(effective);
		expect((seamConfig as { requestPolicy?: unknown }).requestPolicy).toEqual(
			PCK_PHYSICAL_REQUEST_POLICY,
		);
		// The seam's configuration drives the transport's cardinality.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: seamConfig as unknown as Record<string, unknown>,
		});
		expect(physicalRequests).toBe(1);
	});

	it("G1.8 SEAM: the policy coexists with the Qwen INFERENCE policy", async () => {
		// The two policies are INDEPENDENT channels on the SAME
		// configuration. The Qwen inference policy keeps its own opt-in
		// scope, and the physical-request policy is unaffected by it.
		const resolved = resolveSummarizerConfig({
			activeProviderConfig: predecessorConfig() as never,
		});
		const inferenceResolution = resolvePckInferencePolicy({
			purpose: "pck",
			featureEnabled: true,
			effectiveProviderConfig: resolved,
			env: { [PCK_INFERENCE_POLICY_ENV_VAR]: QWEN_STRATA_V1_POLICY_ID },
		});
		expect(inferenceResolution.applied).toBe(true);
		if (!inferenceResolution.applied) {
			throw new Error("the inference policy must apply");
		}
		const effective = applyPckInferencePolicy(
			resolved,
			inferenceResolution.parameters,
		);
		const seamConfig = applyPckPhysicalRequestPolicy(effective);
		// The inference policy is carried through untouched.
		expect(
			(seamConfig as { inferencePolicy?: unknown }).inferencePolicy,
		).toEqual({
			reasoningEffort: "none",
			responseFormat: { type: "json_object" },
			temperature: 0.1,
			maxTokens: 1024,
		});
		// And the physical-request policy is present as well.
		expect((seamConfig as { requestPolicy?: unknown }).requestPolicy).toEqual(
			PCK_PHYSICAL_REQUEST_POLICY,
		);
		// The cardinality is ONE either way.
		const physicalRequests = await countPhysicalRequests({
			providerConfig: seamConfig as unknown as Record<string, unknown>,
		});
		expect(physicalRequests).toBe(1);
	});
});
