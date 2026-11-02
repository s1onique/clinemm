import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CallSettings } from "ai";
import {
	getModelReasoningControls,
	normalizeReasoningEffort,
} from "../model-facts";
import type { AiSdkProviderOptionsTarget } from "./provider-options-types";

export type AiSdkReasoning = NonNullable<CallSettings["reasoning"]>;

/**
 * The model a request targets and, when known, the AI SDK adapter it goes
 * through. The adapter is only needed to fit a level to the model's
 * advertised effort ladder.
 */
export interface PortableReasoningWire {
	adapter?: AiSdkProviderOptionsTarget;
	context: GatewayProviderContext;
}

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
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R3 adaptation).
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
 *
 * R3: upstream replaced this capability guard with a model-facts/capability
 * model. That upstream rewrite is ADAPTED here, not substituted: upstream has
 * no `NATIVE_REASONING_OPTION_PROVIDERS` set and no `minimax-thinking` format
 * check, so adopting it verbatim would silently change the MiniMax M3 None /
 * low wire behaviour that this fork's authority depends on. The fork guard is
 * therefore retained and the upstream model-facts adaptation is composed on
 * top of it.
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

/**
 * Adapters that put the top-level `reasoning` value on the request unchanged
 * (`@ai-sdk/openai-compatible` sends it as `reasoning_effort`). The other
 * adapters translate the portable level through their own per-model effort
 * maps, so the gateway leaves the level to them.
 */
const VERBATIM_REASONING_ADAPTERS = new Set<AiSdkProviderOptionsTarget>([
	"cline",
	"openai-compatible",
]);

/**
 * Snap a level to the model's advertised effort ladder when the adapter sends
 * it verbatim, since endpoints reject levels outside their ladder.
 */
function snapToAdvertisedEffort(
	level: AiSdkReasoning,
	wire: PortableReasoningWire,
): AiSdkReasoning {
	if (
		level === "none" ||
		level === "provider-default" ||
		!wire.adapter ||
		!VERBATIM_REASONING_ADAPTERS.has(wire.adapter)
	) {
		return level;
	}
	const efforts = getModelReasoningControls(
		wire.context.model.reasoningOptions,
	)?.efforts;
	if (!efforts?.length) {
		return level;
	}
	return normalizeReasoningEffort(level, efforts) ?? level;
}

/**
 * Adapters that turn "none" into the model's lowest thinking level, guessed
 * from the model id, instead of forwarding it. The guess can be a level the
 * model rejects.
 */
const LOWEST_LEVEL_DISABLE_ADAPTERS = new Set<AiSdkProviderOptionsTarget>([
	"google",
	"vertex",
]);

/**
 * Send a disable only to models that accept one: "none" when the catalog
 * advertises an off option (`none` or a toggle), and nothing when it does not,
 * so the model keeps its default. A model the catalog does not describe keeps
 * "none", except on adapters that would guess a level for it.
 */
function fitDisableToModel(
	wire: PortableReasoningWire,
): AiSdkReasoning | undefined {
	const controls = getModelReasoningControls(
		wire.context.model.reasoningOptions,
	);
	if (!controls) {
		return wire.adapter && LOWEST_LEVEL_DISABLE_ADAPTERS.has(wire.adapter)
			? undefined
			: "none";
	}
	return controls.supportsOff ? "none" : undefined;
}

/**
 * A model without known capabilities may reason, so only a capability list
 * that omits reasoning rules it out.
 */
function mayReason(context: GatewayProviderContext | undefined): boolean {
	const capabilities = context?.model.capabilities;
	return !capabilities || capabilities.includes("reasoning");
}

function resolvePortableLevel(
	request: GatewayStreamRequest,
	context: GatewayProviderContext | undefined,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	// R3: the fork's native-option guard runs FIRST and is authoritative. A
	// provider that owns a native reasoning option must keep the intent in the
	// request so the provider-option rules can encode it; delegating to the
	// portable top-level option would drop the requested effort.
	if (requiresNativeReasoningOption(request, context)) {
		return undefined;
	}
	if (reasoning.enabled === false) {
		// Adapters that forward the level verbatim (`reasoning_effort`) would
		// otherwise send nothing, leaving default-on reasoning models thinking.
		//
		// R3: the fork's `PORTABLE_REASONING_PROVIDERS` gate is retained —
		// only a provider whose portable top-level option actually carries a
		// reasoning level may be told "none". Upstream's `mayReason`
		// capability check is COMPOSED with it: a model whose catalog entry
		// omits the reasoning capability cannot be switched off, so the
		// disable is dropped there too.
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		if (!PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		return mayReason(context) ? "none" : undefined;
	}
	if (reasoning.effort) {
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		// R3: upstream no longer collapses "max" to "xhigh" here because the
		// adapter/effort-ladder fitting below handles it against the model's
		// ADVERTISED ladder. The fork's collapse is retained for the
		// non-fitting path so the fork's requested-vs-wire observability for
		// the "max" level is unchanged.
		return reasoning.effort;
	}
	return reasoning.enabled === true &&
		!NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)
		? "medium"
		: undefined;
}

/**
 * Resolve reasoning intent owned by the AI SDK's portable top-level option.
 * Pass `wire` to skip disabling reasoning on models known not to reason, and
 * to fit the level to the target model's advertised efforts.
 */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	wire?: PortableReasoningWire,
): AiSdkReasoning | undefined {
	const level = resolvePortableLevel(request, wire?.context);
	if (!level || !wire) {
		return level;
	}
	return level === "none"
		? fitDisableToModel(wire)
		: snapToAdvertisedEffort(level, wire);
}

/** Provider-option keys that carry a native reasoning control. */
const NATIVE_REASONING_CONTROL_KEYS = [
	"effort",
	"reasoning",
	"reasoningEffort",
	"think",
	"thinking",
	"thinkingConfig",
] as const;

export function hasNativeReasoningControls(
	providerOptions: Record<string, unknown>,
): boolean {
	return Object.values(providerOptions).some(
		(bucket) =>
			!!bucket &&
			typeof bucket === "object" &&
			NATIVE_REASONING_CONTROL_KEYS.some((key) => key in bucket),
	);
}

/**
 * The portable option applies only when no provider-option rule already
 * encodes reasoning natively (an exact budget, a native toggle), so a request
 * never carries both shapes.
 */
export function reconcilePortableReasoning(
	level: AiSdkReasoning | undefined,
	providerOptions: Record<string, unknown>,
): AiSdkReasoning | undefined {
	return hasNativeReasoningControls(providerOptions) ? undefined : level;
}

/**
 * Remove portable intent before provider options are composed. AI SDK ignores
 * top-level reasoning whenever reasoning controls also occur in providerOptions.
 * A disable or an exact budget is kept: providers with native toggles (GLM,
 * MiniMax, Kimi, OpenRouter) or budget fields still encode it, and
 * `reconcilePortableReasoning` then drops the portable value.
 */
export function withoutPortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): GatewayStreamRequest {
	if (request.reasoning?.enabled === false) {
		return request.reasoning.effort !== undefined ||
			request.reasoning.budgetTokens !== undefined
			? { ...request, reasoning: { enabled: false } }
			: request;
	}
	if (typeof request.reasoning?.budgetTokens === "number") {
		return request;
	}
	return resolvePortableReasoning(request, context ? { context } : undefined)
		? { ...request, reasoning: undefined }
		: request;
}
