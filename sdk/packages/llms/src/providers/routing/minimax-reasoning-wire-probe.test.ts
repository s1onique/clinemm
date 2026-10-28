/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R0) — PROBE.
 *
 * Establishes the ACTUAL wire-level reasoning configuration produced by the
 * production path for the four discriminator variants. This file is a PROBE,
 * not a claim: it prints what the code does today. The RED/GREEN witnesses
 * live in `minimax-reasoning-wire01.test.ts`.
 *
 * Production chain exercised (no re-implementation):
 *   GatewayStreamRequest.reasoning
 *     -> withoutPortableReasoning / normalizeReasoningRequest
 *     -> composeAiSdkProviderOptions (provider-option rules)
 *     -> AI SDK transport (providerOptions bucket -> serialized body)
 *
 * For the MiniMax direct route the transport is the Anthropic-compatible
 * adapter plus the `miniMaxThinkingDisabledMiddleware` /
 * `createMiniMaxThinkingFetch` shim, which is the only place where the
 * `thinking: { type: "disabled" }` control is turned into a wire body field.
 */
import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MINIMAX_THINKING_ROUTING_METADATA } from "./minimax-thinking";
import {
	resolvePortableReasoning,
	withoutPortableReasoning,
} from "./portable-reasoning";
import { composeAiSdkProviderOptions } from "./provider-options";
import { normalizeReasoningRequest } from "./reasoning-options";

/**
 * M3.1-Flash requires reasoning and defaults to `max` effort when omitted.
 * The production catalog has no entry for it, so the model advertises an
 * effort-only control set (no `toggle`, no `none`) — the shape a
 * mandatory-reasoning model exposes.
 */
const M31_EFFORT_OPTIONS: ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

/** M3 supports a thinking toggle (disabled is a valid native control). */
const M3_TOGGLE_OPTIONS: ModelReasoningOption[] = [{ type: "toggle" }];

function makeContext(options: {
	providerId: string;
	modelId: string;
	family?: string;
	reasoningOptions?: readonly ModelReasoningOption[];
	providerMetadata?: GatewayProviderContext["provider"]["metadata"];
	maxOutputTokens?: number;
}): GatewayProviderContext {
	return {
		provider: {
			id: options.providerId,
			name: options.providerId,
			defaultModelId: options.modelId,
			models: [
				{
					id: options.modelId,
					name: options.modelId,
					providerId: options.providerId,
					capabilities: ["text", "reasoning", "tools"],
				},
			],
			metadata: options.providerMetadata,
		},
		model: {
			id: options.modelId,
			name: options.modelId,
			providerId: options.providerId,
			capabilities: ["reasoning", "tools"],
			reasoningOptions: options.reasoningOptions,
			maxOutputTokens: options.maxOutputTokens ?? 32_000,
			metadata: options.family ? { family: options.family } : undefined,
		},
		config: { providerId: options.providerId },
	};
}

function makeRequest(
	overrides: Partial<GatewayStreamRequest> & {
		providerId: string;
		modelId: string;
	},
): GatewayStreamRequest {
	return {
		providerId: overrides.providerId,
		modelId: overrides.modelId,
		messages: [],
		reasoning: overrides.reasoning,
		maxTokens: overrides.maxTokens,
	};
}

/**
 * The observable reasoning configuration of one request, as the provider
 * would see it. Mirrors the ACT's R1 field vocabulary without recording any
 * prompt, tool argument or credential.
 */
function observe(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	const normalized = normalizeReasoningRequest(request, context);
	const providerOptions = composeAiSdkProviderOptions(request, context);
	const buckets = Object.fromEntries(
		Object.entries(providerOptions).map(([key, value]) => [
			key,
			JSON.parse(JSON.stringify(value)),
		]),
	);
	return {
		normalizedReasoning: normalized.reasoning,
		providerOptions: buckets,
	};
}

describe("PROBE MiniMax reasoning wire configuration", () => {
	it("TRACE: portable-reasoning stripping explains the missing effort", () => {
		const withEffort = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});
		const portable = resolvePortableReasoning(withEffort);
		const stripped = withoutPortableReasoning(withEffort);
		console.log(
			"TRACE portable:",
			JSON.stringify({ portable, after: stripped.reasoning }),
		);
		expect(stripped).toBeDefined();
	});

	it("D1: M3 direct, thinking disabled", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			family: "minimax",
			reasoningOptions: M3_TOGGLE_OPTIONS,
			providerMetadata: MINIMAX_THINKING_ROUTING_METADATA,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			reasoning: { enabled: false },
		});
		const observed = observe(request, context);
		console.log("D1 M3 disabled:", JSON.stringify(observed, null, 2));
		expect(observed.providerOptions).toBeDefined();
	});

	it("D2: M3.1 direct, thinking disabled (unsupported by the model)", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: false },
		});
		const observed = observe(request, context);
		console.log("D2 M3.1 disabled:", JSON.stringify(observed, null, 2));
		expect(observed.providerOptions).toBeDefined();
	});

	it("D3: M3.1 direct, explicit low effort", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});
		const observed = observe(request, context);
		console.log("D3 M3.1 low:", JSON.stringify(observed, null, 2));
		expect(observed.providerOptions).toBeDefined();
	});

	it("D3b: M3.1 direct, explicit max effort", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "max" },
		});
		const observed = observe(request, context);
		console.log("D3b M3.1 max:", JSON.stringify(observed, null, 2));
		expect(observed.providerOptions).toBeDefined();
	});

	it("D4: M3.1 through OpenRouter, thinking disabled", () => {
		const context = makeContext({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3.1-flash",
			reasoning: { enabled: false },
		});
		const observed = observe(request, context);
		console.log(
			"D4 M3.1 openrouter disabled:",
			JSON.stringify(observed, null, 2),
		);
		expect(observed.providerOptions).toBeDefined();
	});

	it("D4b: M3.1 through OpenRouter, explicit low effort", () => {
		const context = makeContext({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});
		const observed = observe(request, context);
		console.log("D4b M3.1 openrouter low:", JSON.stringify(observed, null, 2));
		expect(observed.providerOptions).toBeDefined();
	});
});
