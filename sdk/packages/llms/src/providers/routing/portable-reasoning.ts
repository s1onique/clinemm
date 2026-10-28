import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CallSettings } from "ai";

export type AiSdkReasoning = NonNullable<CallSettings["reasoning"]>;

const PORTABLE_REASONING_PROVIDERS = new Set([
	"anthropic",
	"bedrock",
	"deepseek",
	"fireworks",
	"gemini",
	"google",
	"groq",
	"openai-native",
	"openai-codex",
	"ollama",
	"vertex",
	"xai",
]);

const NON_PORTABLE_REASONING_PROVIDERS = new Set([
	"claude-code",
	"dify",
	"mistral",
	"opencode",
	"sapaicore",
]);

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01.
 *
 * Providers whose reasoning controls travel as a NATIVE provider option (a
 * `reasoning` object in `providerOptions`, not the AI SDK's portable
 * top-level `reasoning` field) must keep the reasoning intent inside the
 * request so the provider-option rules can encode it.
 *
 * The AI SDK's portable top-level `reasoning` option is NOT equivalent for
 * these transports:
 *
 *   - OpenAI-compatible / OpenRouter transports ignore it, so the effort is
 *     dropped and the provider applies its own default.
 *   - The Anthropic-compatible transport interprets it as "reasoning on" and
 *     substitutes a fixed thinking budget, discarding the requested effort.
 *
 * Both were observed at the serialized-request boundary, so the loss is
 * silent: the request still reaches the provider, but with a DIFFERENT
 * reasoning policy than the one that was requested.
 *
 * This set names the providers that own a native reasoning option. It is a
 * provider-capability fact, so it lives next to the other provider-capability
 * sets rather than inside the rule table.
 */
const NATIVE_REASONING_OPTION_PROVIDERS = new Set([
	"minimax",
	"minimax-cn",
	"minimax-cn-coding-plan",
	"minimax-coding-plan",
	"openrouter",
]);

/**
 * Whether the reasoning intent for this request must survive into provider
 * options instead of being delegated to the AI SDK's portable top-level
 * `reasoning` option.
 */
function requiresNativeReasoningOption(
	request: GatewayStreamRequest,
	context: GatewayProviderContext | undefined,
): boolean {
	if (NATIVE_REASONING_OPTION_PROVIDERS.has(request.providerId)) {
		return true;
	}
	// A provider that declares the MiniMax thinking format encodes reasoning
	// through MiniMax's own native shape (a thinking toggle, plus an
	// `output_config.effort` for the M3.1 generation). The Anthropic AI SDK's
	// portable top-level `reasoning` option would instead be interpreted as
	// "reasoning on" and replaced by a fixed thinking budget, discarding the
	// requested effort.
	//
	// The `anthropic-thinking` and `glm-thinking` formats are NOT listed here:
	// those transports implement the portable top-level option natively, so
	// delegating to it remains correct for them.
	return (
		context?.provider.metadata?.routing?.reasoning?.format ===
		"minimax-thinking"
	);
}

/** Resolve reasoning intent owned by the AI SDK's portable top-level option. */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	if (requiresNativeReasoningOption(request, context)) {
		return undefined;
	}
	const fullySupported = PORTABLE_REASONING_PROVIDERS.has(request.providerId);
	if (reasoning.enabled === false) {
		return fullySupported ? "none" : undefined;
	}
	if (typeof reasoning.budgetTokens === "number") {
		return undefined;
	}
	if (reasoning.effort) {
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		return reasoning.effort === "max" ? "xhigh" : reasoning.effort;
	}
	return reasoning.enabled === true &&
		!NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)
		? "medium"
		: undefined;
}

/**
 * Remove portable intent before provider options are composed. AI SDK ignores
 * top-level reasoning whenever reasoning controls also occur in providerOptions.
 */
export function withoutPortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): GatewayStreamRequest {
	const normalizedRequest =
		request.reasoning?.enabled === false &&
		(request.reasoning.effort !== undefined ||
			request.reasoning.budgetTokens !== undefined)
			? { ...request, reasoning: { enabled: false } }
			: request;
	return resolvePortableReasoning(normalizedRequest, context)
		? { ...normalizedRequest, reasoning: undefined }
		: normalizedRequest;
}
