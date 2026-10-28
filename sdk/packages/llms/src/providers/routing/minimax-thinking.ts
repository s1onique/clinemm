import type {
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import { buildProviderAndAliasPatch, type ProviderOptionsPatch } from "./utils";

export const MINIMAX_THINKING_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		promptCache: {
			format: "anthropic-cache-control",
			routes: [{ matcher: "anthropic-compatible" }],
		},
		reasoning: {
			format: "minimax-thinking",
			routes: [
				{
					matcher: "model-id",
					modelId: "MiniMax-M3",
					requiredCapability: "reasoning",
				},
				// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01.
				// M3.1 shares the native Anthropic-compatible transport with M3
				// but requires reasoning and selects an effort instead of a
				// thinking toggle.
				{
					matcher: "model-id",
					modelId: "minimax-m3.1-flash",
					requiredCapability: "reasoning",
				},
				{
					matcher: "model-id",
					modelId: "minimax/minimax-m3.1-flash",
					requiredCapability: "reasoning",
				},
			],
		},
	},
	// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01.
	//
	// MiniMax M3.1-Flash REQUIRES reasoning and selects its effort through
	// the Anthropic-compatible `output_config.effort` field. It advertises
	// EFFORT-ONLY controls: no thinking toggle, and no "off" value, so a
	// disabled-thinking request is DETECTED as unsupported rather than
	// silently represented as reasoning-disabled.
	//
	// These are declared here because the shared catalog does not (yet)
	// publish the M3.1 generation. Without them an M3.1 request resolves to
	// an unregistered model with NO reasoning controls, and the requested
	// effort is dropped before transport.
	modelReasoningOptions: {
		"minimax-m3.1-flash": [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
		"minimax/minimax-m3.1-flash": [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
		// ACT-CLINEMM-M31-EXACT-MODEL-ID-WIRE-AUTHORITY01.
		//
		// MiniMax's own API model identifier for the M3.1 generation is the
		// CAPITALIZED `MiniMax-M3.1-Flash`. The provider-declared controls are
		// looked up by the EXACT model id string, so an uncatalogued model
		// selected with the official spelling resolved WITHOUT any reasoning
		// controls: no `reasoning` capability and no effort ladder. The
		// normalization boundary then dropped the requested effort before
		// transport, and the Anthropic-compatible body carried no
		// `output_config.effort` at all.
		//
		// The entry is provider-local and additive: the lower-case aliases
		// above keep working, and the OUTBOUND model id is untouched.
		"MiniMax-M3.1-Flash": [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
	},
};

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01.
 *
 * MiniMax M3.1-Flash requires reasoning and selects its effort through the
 * Anthropic-compatible `output_config.effort` field. The Anthropic AI SDK
 * serializes `providerOptions.anthropic.effort` into exactly that field, so
 * the effort is carried in the `anthropic` bucket.
 *
 * The `thinking.type` shape is kept for M3, whose native API expresses
 * "adaptive" and "disabled" through `thinking` and has no effort control.
 */
function buildMiniMaxEffortOptions(request: GatewayStreamRequest) {
	const effort = request.reasoning?.effort;
	if (!effort) {
		return undefined;
	}
	return { effort };
}

function buildMiniMaxThinkingOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return { thinking: { type: "adaptive" } };
	}
	if (request.reasoning?.enabled === false) {
		return { thinking: { type: "disabled" } };
	}
	return undefined;
}

function buildMiniMaxGatewayReasoningOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return { reasoning: { enabled: true } };
	}
	if (request.reasoning?.enabled === false) {
		return { reasoning: { exclude: true } };
	}
	return undefined;
}

export function buildMiniMaxThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	const thinking = buildMiniMaxThinkingOptions(request);
	const effort = buildMiniMaxEffortOptions(request);
	if (!thinking && !effort) {
		return undefined;
	}
	return {
		openaiCompatible: thinking ?? {},
		[request.providerId]: thinking ?? {},
		...(providerOptionsKey !== request.providerId
			? { [providerOptionsKey]: thinking ?? {} }
			: {}),
		// The effort travels in the `anthropic` bucket because the
		// Anthropic-compatible transport maps it to `output_config.effort`.
		anthropic: effort ?? {},
	};
}

export function buildMiniMaxGatewayReasoningProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	const reasoning = buildMiniMaxGatewayReasoningOptions(request);
	return reasoning
		? buildProviderAndAliasPatch({
				providerId: request.providerId,
				providerOptionsKey,
				bucketOptions: reasoning,
			})
		: undefined;
}
