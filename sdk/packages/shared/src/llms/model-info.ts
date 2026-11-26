/**
 * Model Information Types
 *
 * Zod schemas and inferred types for model capabilities, pricing,
 * and metadata. These live in shared so that agent types can reference
 * ModelInfo without depending on @cline/llms.
 */

import { z } from "zod";
import { ModelReasoningOptionSchema } from "./reasoning-options";

export const ApiFormatSchema = z.enum(["default", "openai-responses", "r1"]);

export type ApiFormat = z.infer<typeof ApiFormatSchema>;

export const ApiFormat = {
	DEFAULT: "default" as const,
	OPENAI_RESPONSES: "openai-responses" as const,
	R1: "r1" as const,
} as const;

export const ModelCapabilitySchema = z.enum([
	"images",
	"video",
	"tools",
	"streaming",
	"prompt-cache",
	"reasoning",
	"reasoning-effort",
	"computer-use",
	"global-endpoint",
	"structured_output",
	"temperature",
	"files",
]);

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ModelStatusSchema = z.enum([
	"active",
	"preview",
	"deprecated",
	"legacy",
]);

export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelPricingSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	cacheWrite: z.number().optional(),
	cacheRead: z.number().optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ThinkingConfigSchema = z.object({
	maxBudget: z.number().optional(),
	outputPrice: z.number().optional(),
	thinkingLevel: z.enum(["low", "high"]).optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

export const ModelMetadataSchema = z
	// Keep metadata open for catalog-defined facts while typing routing fields.
	.object({
		reasoningDefaultOn: z.boolean().optional(),
		/** Per-model wire protocol for gateways that serve multiple API formats. */
		apiProtocol: z
			.enum(["openai-chat", "openai-responses", "anthropic", "gemini"])
			.optional(),
	})
	.catchall(z.unknown());

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const ModelModalitySchema = z.enum([
	"text",
	"image",
	"audio",
	"video",
	"pdf",
]);

export type ModelModality = z.infer<typeof ModelModalitySchema>;

export const ModelModalitiesSchema = z.object({
	input: z.array(ModelModalitySchema),
	output: z.array(ModelModalitySchema),
});

export type ModelModalities = z.infer<typeof ModelModalitiesSchema>;

export type ChatModelModalities = {
	readonly input?: readonly ModelModality[];
	readonly output?: readonly ModelModality[];
};

/**
 * Returns whether a model can participate in a text chat turn.
 *
 * Missing modality metadata is treated as chat-compatible for backwards
 * compatibility. When a catalog does provide modalities, the model must both
 * accept text and produce text; dedicated transcription and media-generation
 * endpoints therefore stay available in the shared catalog without leaking
 * into chat model pickers.
 */
export function supportsChatModalities(
	modalities: ChatModelModalities | undefined,
): boolean {
	return (
		(modalities?.input === undefined || modalities.input.includes("text")) &&
		(modalities?.output === undefined || modalities.output.includes("text"))
	);
}

/**
 * Provider operation used to execute a model request.
 *
 * Modalities describe the values a model accepts and produces; they do not
 * identify the provider endpoint. Keeping the operation explicit prevents an
 * image-output model from being routed to a generic chat or compatible-image
 * endpoint merely because its catalog advertises an image modality.
 */
export const ModelOperationSchema = z.enum([
	"language",
	"image-generation",
	"speech-generation",
	"video-generation",
	"transcription",
	"realtime",
]);

export type ModelOperation = z.infer<typeof ModelOperationSchema>;

/** Voice input requires exactly audio input and text output. Model names and
 * operation labels cannot widen this to a multimodal realtime session. */
export function isTranscriptionModel(model: {
	modalities?: { input?: readonly string[]; output?: readonly string[] };
}): boolean {
	const input = model.modalities?.input;
	const output = model.modalities?.output;
	return (
		input?.length === 1 &&
		input[0] === "audio" &&
		output?.length === 1 &&
		output[0] === "text"
	);
}

export type ChatCompatibleModelDescriptor = {
	readonly operation?: ModelOperation;
	readonly modalities?: ChatModelModalities;
};

/**
 * Returns whether a model uses the language operation and supports a text chat
 * turn. Missing operation and modality metadata remain chat-compatible for
 * backwards compatibility, while any explicitly non-language operation is
 * excluded even when its modalities are absent.
 */
export function isChatCompatibleModel(
	model: ChatCompatibleModelDescriptor,
): boolean {
	return (
		(model.operation === undefined || model.operation === "language") &&
		supportsChatModalities(model.modalities)
	);
}

/**
 * Execution modes supported by a non-language model operation.
 *
 * The operation selects the provider transport; the mode describes how that
 * transport is consumed. Keeping this separate from generic model
 * capabilities prevents transcription-specific flags from spreading through
 * otherwise modality-agnostic clients.
 */
export const ModelOperationModeSchema = z.enum(["batch", "streaming"]);

export type ModelOperationMode = z.infer<typeof ModelOperationModeSchema>;

interface ImageOutputModelDescriptor {
	operation?: ModelOperation;
	modalities?: ModelModalities;
}

export function modelProducesImages(
	model: ImageOutputModelDescriptor,
): boolean {
	return (
		model.modalities?.input.includes("text") === true &&
		model.modalities.output.includes("image")
	);
}

export function usesImageGenerationOperation(
	model: ImageOutputModelDescriptor,
): boolean {
	return model.operation === "image-generation";
}

/**
 * Whether a model's capability metadata declares `capability`.
 *
 * Capability lists reach this check from sources of very different fidelity:
 * the generated catalog is complete, but host boundaries (VS Code's legacy
 * ModelInfo, user-authored overrides, dynamic provider listings) may carry
 * partial lists reconstructed from a handful of boolean flags. A missing or
 * empty list therefore carries no signal, and each check declares its own
 * default via `assumeWhenUnspecified` instead of treating absence as denial.
 *
 * Capability gates added by future model modes (audio, video, transcription,
 * …) should route through this helper rather than reading
 * `model.capabilities` directly, so the unspecified-list semantics stay
 * consistent across the codebase.
 */
export function modelHasCapability(
	model: { capabilities?: readonly string[] },
	capability: string,
	options?: { assumeWhenUnspecified?: boolean },
): boolean {
	const capabilities = model.capabilities;
	if (capabilities === undefined || capabilities.length === 0) {
		return options?.assumeWhenUnspecified ?? false;
	}
	return capabilities.includes(capability);
}

/**
 * Whether a model can receive function/tool definitions. Fails open when the
 * capability list is missing or empty (user-entered and dynamically
 * discovered models); a populated capability list without `tools` is
 * authoritative.
 */
export function modelSupportsToolCalling(model: {
	capabilities?: readonly string[];
}): boolean {
	return modelHasCapability(model, "tools", { assumeWhenUnspecified: true });
}

/**
 * Whether a model can receive image parts in a request. Fails open on the
 * same grounds as `modelSupportsToolCalling`: a host boundary that reports no
 * capabilities at all has not declared the model text-only, and stripping
 * images from a vision-capable model loses user content silently. A populated
 * list without `images` is authoritative.
 */
export function modelSupportsImageInput(model: {
	capabilities?: readonly string[];
}): boolean {
	return modelHasCapability(model, "images", { assumeWhenUnspecified: true });
}

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
 *
 * THE REASONING-AUTHORIZATION CAPABILITY.
 *
 * ## WHAT THIS IS
 * ---------------
 * Some transports REQUIRE provider-origin authorization for a reasoning
 * block: the block is only valid on the wire when it carries the provider's
 * signature. The Anthropic family is the canonical case. The resolved
 * Anthropic serializer OMITS an unsigned reasoning block from the serialized
 * request (it warns "unsupported reasoning metadata").
 *
 * A reasoning block that carries no signature is therefore NOT
 * provider-visible content on those transports, and the request-budget
 * authority must not measure it.
 *
 * ## WHY IT LIVES HERE
 * -------------------
 * The provider-visible projection and the request-budget authority live in
 * `@cline/shared`, and so does `ModelInfo`. The transports' own routing
 * authority lives in `@cline/llms`, which depends on `@cline/shared`. Putting
 * the predicate HERE lets BOTH consume ONE definition, so the projection and
 * the serializer can never drift apart.
 *
 * ## THE CLASSIFICATION (AMENDMENT-01 CORRECTION)
 * ----------------------------------------------
 * The capability is decided by the RESOLVED TRANSPORT — the transport
 * CLIENT the request is actually dispatched through — and never by a
 * model-name, model-family or provider-id substring guess.
 *
 * The previous implementation classified the MODEL FAMILY first and only
 * then consulted the API format. That inverted the authority: the family
 * is a property of the MODEL LINEAGE, while the requirement is a property
 * of the SERIALIZER that runs. The two disagree on exactly the routes that
 * matter:
 *
 *   - `family: "minimax"`, resolved transport `anthropic` -> the Anthropic
 *     serializer DOES drop an unsigned reasoning block, so the capability is
 *     TRUE. The family-first implementation answered FALSE.
 *   - `family: "anthropic"`, resolved transport `openai` -> the OpenAI
 *     serializer does NOT drop an unsigned reasoning block, so the
 *     capability is FALSE. The family-first implementation answered TRUE.
 *
 * Both answers were wrong, and the first one made the CMP-09 exclusion
 * UNREACHABLE on the real MiniMax builtin route (the MiniMax model family
 * is "minimax" while the MiniMax provider resolves to the Anthropic
 * transport), so the unsigned reasoning that the MiniMax serializer drops
 * was still counted by the budget.
 *
 * The RESOLVED TRANSPORT CLIENT is the repository's own published fact
 * (`ProviderInfo.client` — the `ProviderClient` the provider collection
 * resolves to, and the same value the gateway's transport factory is
 * selected by). It is a transport identity, not a lineage guess, so it
 * cannot disagree with the serializer that actually runs.
 *
 * The transport is resolved from the MODEL's declared wire protocol when the
 * catalog publishes one (`metadata.apiProtocol`, the per-model override for
 * gateways that serve multiple API formats), and from the PROVIDER's
 * resolved client otherwise.
 *
 * ## THE DEFAULT
 * --------------
 * `false`. A transport that is not positively established as the Anthropic
 * transport keeps every reasoning block, so every existing caller and every
 * non-Anthropic transport is bit-for-bit unchanged.
 */
export function requiresSignedReasoningCapability(input: {
	/**
	 * The RESOLVED transport client the request is dispatched through.
	 *
	 * This is the `ProviderClient` the provider resolves to. `"anthropic"`
	 * is the ONLY value that requires provider-origin authorization for a
	 * reasoning block, because the Anthropic AI SDK module is the only
	 * serializer that drops an unsigned reasoning block.
	 */
	transportClient?: string;
	/**
	 * The model's declared wire protocol, when the catalog publishes one.
	 *
	 * This is the PER-MODEL override for a gateway that serves several API
	 * formats. It is consulted only when the resolved transport client is
	 * not established.
	 */
	apiProtocol?: string;
	/**
	 * The model's declared API format, when the catalog publishes one.
	 *
	 * Retained for compatibility with the previous signature. `"anthropic"`
	 * names the Anthropic transport.
	 */
	apiFormat?: string;
	/** The model's declared family. NOT a transport identity. */
	family?: string;
	/** The model's id. NOT a transport identity. */
	modelId?: string;
	/** The provider id. NOT a transport identity. */
	providerId?: string;
}): boolean {
	// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1).
	//
	// The RESOLVED TRANSPORT is the authority. It is consulted FIRST and it
	// is decisive when it is established.
	const transportClient = normalizeCapabilityValue(input.transportClient);
	if (transportClient) {
		return transportClient === ANTHROPIC_TRANSPORT_CLIENT;
	}
	// The PER-MODEL wire protocol override, when the provider is a
	// multi-format gateway. This is a transport fact, not a lineage fact.
	const apiProtocol = normalizeCapabilityValue(input.apiProtocol);
	if (apiProtocol) {
		return apiProtocol === ANTHROPIC_TRANSPORT_CLIENT;
	}
	// The declared API format, when the catalog publishes one.
	const apiFormat = normalizeCapabilityValue(input.apiFormat);
	if (apiFormat) {
		return apiFormat === ANTHROPIC_TRANSPORT_CLIENT;
	}
	// NO ESTABLISHED TRANSPORT -> NO REQUIREMENT.
	//
	// The previous implementation fell back to the model FAMILY and then to
	// the model ID substring. Both are lineage guesses, and a lineage guess
	// CANNOT establish a serializer behavior: the MiniMax route proves it
	// ("minimax" family, Anthropic transport). Failing closed here keeps
	// the pre-existing behavior for every transport whose identity the
	// repository does not publish, and it never silently excludes a block
	// the provider would have received.
	return false;
}

/**
 * The transport client whose serializer requires provider-origin
 * authorization for a reasoning block.
 *
 * It is the ONLY Anthropic AI SDK module in the repository. The Bedrock
 * transport uses its own module (`vendors/bedrock`) and does NOT drop an
 * unsigned reasoning block, so it is deliberately NOT included here.
 */
const ANTHROPIC_TRANSPORT_CLIENT = "anthropic";

function normalizeCapabilityValue(
	value: string | undefined,
): string | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized ? normalized : undefined;
}

export const ModelInfoSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	maxTokens: z.number().optional(),
	contextWindow: z.number().optional(),
	maxInputTokens: z.number().optional(),
	capabilities: z.array(ModelCapabilitySchema).optional(),
	operation: ModelOperationSchema.optional(),
	operationModes: z.array(ModelOperationModeSchema).optional(),
	modalities: ModelModalitiesSchema.optional(),
	reasoningOptions: z.array(ModelReasoningOptionSchema).optional(),
	apiFormat: ApiFormatSchema.optional(),
	systemRole: z.enum(["system", "developer"]).optional(),
	temperature: z.number().optional(),
	pricing: ModelPricingSchema.optional(),
	thinkingConfig: ThinkingConfigSchema.optional(),
	status: ModelStatusSchema.optional(),
	deprecationNotice: z.string().optional(),
	replacedBy: z.string().optional(),
	releaseDate: z.string().optional(),
	deprecationDate: z.string().optional(),
	family: z.string().optional(),
	metadata: ModelMetadataSchema.optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
