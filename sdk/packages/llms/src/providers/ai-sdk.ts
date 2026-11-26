import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
	AgentMessage,
	AgentModelEvent,
	AgentModelFinishReason,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
	GeneratedMedia,
	ImageMediaValidationFailure,
	ImageMediaValidationSuccess,
	MediaBudgetState,
	ModelToolExecution,
	ModelToolName,
	ProviderErrorClass,
} from "@cline/shared";
import {
	type AiSdkFormatterMessage,
	type AiSdkFormatterPart,
	captureSdkError,
	createMediaBudgetState,
	formatMessagesForAiSdk,
	GeneratedMediaSchema,
	generatedMediaModalityFromMediaType,
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the
	// metadata key that carries the PREPARATION identity to the provider
	// seam, so the AI SDK stage can be grouped with the other stages of
	// the SAME request.
	MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY,
	modelProducesImages,
	modelSupportsToolCalling,
	parseJsonStream,
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3): the metadata
	// key the origin authority travels under. It is the SHARED constant, so
	// the wire and the request-budget authority read the same field.
	REASONING_ORIGIN_AUTHORITY_KEY,
	sanitizeSurrogates,
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3): the SHARED
	// replay-eligibility authority. The wire gate delegates to it, so the
	// wire and the request-budget authority consume ONE policy.
	mayReplayOpaqueReasoning as sharedMayReplayOpaqueReasoning,
	usesImageGenerationOperation,
	validateAndReserveBase64Media,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "@cline/shared";
import {
	type CallSettings,
	generateImage,
	jsonSchema,
	NoSuchToolError,
	stepCountIs,
	streamText,
	type ToolSet,
	wrapLanguageModel,
} from "ai";
import { nanoid } from "nanoid";
import type { AiSdkTelemetryDecision } from "../services/langfuse-telemetry";
import {
	createStreamErrorTelemetry,
	isTimeoutReason,
} from "../services/stream-error-telemetry";
import { wrapFetchForAimlapiAttribution } from "./aimlapi/attribution";
import {
	classifyProviderError,
	isRetryableBeyondSdkRetries,
} from "./error-classification";
import { extractErrorMessage } from "./format";
// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01):
// the reader for the middleware-owned PHYSICAL-REQUEST OCCUPANCY authority.
import {
	createRetryEmptyResponseMiddleware,
	type PhysicalRequestOccupancy,
	readPhysicalRequestOccupancy,
} from "./middleware/retry-empty-response";
import {
	isAnthropicCompatibleModel,
	isCerebrasProvider,
	modelSupportsImageInput,
	resolveModelFamily,
} from "./model-facts";
// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01: the opt-in structural
// capture of the AI SDK prompt representation. DEFAULT OFF.
import { recordPrefixForensics } from "./prefix-forensics-capture";
import {
	recordProviderRequestCapture,
	wrapFetchForProviderRequestCapture,
} from "./provider-request-capture";
// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION03: the
// repository's PUBLISHED BUILTIN ROUTES, which are the only routes whose
// reasoning origin authority may be established.
import { isPublishedBuiltinRoute } from "./published-routes";
import {
	appendRequestId,
	extractResponseRequestId,
	findRequestIdHeader,
} from "./response-request-id";
import {
	applyPromptCacheToLastTextPart,
	shouldApplyPromptCache,
} from "./routing/anthropic-compatible";
import {
	applyBedrockCachePointToLastUserMessage,
	shouldApplyBedrockCachePoint,
} from "./routing/bedrock-cache-point";
import {
	reconcilePortableReasoning,
	resolvePortableReasoning,
} from "./routing/portable-reasoning";
import {
	type AiSdkProviderOptionsTarget,
	composeAiSdkProviderOptions,
} from "./routing/provider-options";
// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01: the opt-in
// NUMERIC usage observation. DEFAULT OFF.
import { recordUsageObservability } from "./usage-observability-capture";
import type {
	AiSdkStreamPart,
	AiSdkStreamResult,
	AiSdkStreamTotalUsage,
	AiSdkStreamUsage,
	BuiltModelTools,
	ProviderFactoryResult,
	ProviderGeneratedMedia,
} from "./vendors/types";

interface GatewayNormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokenCount?: number;
	totalCost?: number;
	/**
	 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
	 *
	 * The PHYSICAL-REQUEST OCCUPANCY AUTHORITY — the middleware-owned fact
	 * about the CONTEXT OCCUPANCY of the ONE request whose prompt occupied
	 * the provider's context window.
	 *
	 * `inputTokens` above is the AGGREGATE EXPENDITURE: the production retry
	 * middleware sums the usage of every PHYSICAL ATTEMPT of the turn, because
	 * the provider billed every one of them. That is the correct BILLING
	 * quantity and it is preserved unchanged.
	 *
	 * This field is the CONTEXT-BUDGET authority's quantity, and it is
	 * THREE-VALUED:
	 *
	 *   "single"  ONE physical attempt — the aggregate IS the occupancy;
	 *   "known"   the SERVED attempt's own prompt size is the occupancy;
	 *   "unknown" the aggregate covers an UNKNOWN number of requests, so it
	 *             establishes NO request's occupancy. The authority is
	 *             DENIED and the consumer must NOT fall back to the
	 *             aggregate.
	 *
	 * It is ABSENT when no authority was established at all (for example a
	 * usage record that did not pass through the retry middleware). It is
	 * NEVER synthesized from the aggregate and NEVER derived by dividing the
	 * aggregate by an assumed attempt count.
	 */
	requestOccupancy?: PhysicalRequestOccupancy;
}
type ProviderModuleKind = AiSdkProviderOptionsTarget;
type ImageGenerationInput = string | Uint8Array | ArrayBuffer;
type ImageGenerationPrompt =
	| string
	| {
			images: ImageGenerationInput[];
			text?: string;
	  };

function normalizeImageGenerationInput(
	part: Extract<AgentMessage["content"][number], { type: "image" }>,
): ImageGenerationInput {
	if (part.image instanceof URL) {
		return part.image.href;
	}
	if (typeof part.image !== "string") {
		return part.image;
	}
	if (part.image.startsWith("http://") || part.image.startsWith("https://")) {
		return part.image;
	}
	const validation = validateImageMedia(part.mediaType, part.image);
	if (!validation.ok) {
		throw new Error(validation.message);
	}
	return `data:${validation.mediaType};base64,${validation.base64}`;
}

function normalizeGeneratedImageInput(
	part: Extract<AgentMessage["content"][number], { type: "media" }>,
): ImageGenerationInput | undefined {
	if (part.media.modality !== "image") return undefined;
	switch (part.media.source.type) {
		case "url":
			return part.media.source.url;
		case "artifact":
			return undefined;
		case "base64": {
			const validation = validateImageMedia(
				part.media.mediaType,
				part.media.source.data,
			);
			return validation.ok
				? `data:${validation.mediaType};base64,${validation.base64}`
				: undefined;
		}
	}
}

function resolveImageGenerationPrompt(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): ImageGenerationPrompt {
	let latestUserMessageIndex = -1;
	for (let index = request.messages.length - 1; index >= 0; index -= 1) {
		if (request.messages[index]?.role === "user") {
			latestUserMessageIndex = index;
			break;
		}
	}
	if (latestUserMessageIndex < 0) {
		throw new Error("Image generation requires a text prompt or input image");
	}

	const message = request.messages[latestUserMessageIndex];
	if (!message || message.role !== "user") {
		throw new Error("Image generation requires a text prompt or input image");
	}
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	const supportsImageInput =
		context.model.modalities?.input.includes("image") === true;
	if (supportsImageInput) {
		const explicitImages = message.content
			.filter((part) => part.type === "image")
			.map(normalizeImageGenerationInput);
		if (explicitImages.length > 0) {
			return {
				images: explicitImages,
				...(text ? { text } : {}),
			};
		}
	}
	if (!text) {
		throw new Error("Image generation requires a text prompt or input image");
	}
	if (!supportsImageInput) {
		return text;
	}

	// Only infer an edit from the immediately preceding assistant turn. Looking
	// farther back can silently turn a new generation request into an edit of a
	// stale image from an unrelated part of the conversation.
	const previousMessage = request.messages[latestUserMessageIndex - 1];
	if (previousMessage?.role === "assistant") {
		const firstGeneratedImage = previousMessage.content.find(
			(part) =>
				part.type === "image" ||
				(part.type === "media" && part.media.modality === "image"),
		);
		if (firstGeneratedImage?.type === "image") {
			return {
				text,
				images: [normalizeImageGenerationInput(firstGeneratedImage)],
			};
		}
		if (firstGeneratedImage?.type === "media") {
			const input = normalizeGeneratedImageInput(firstGeneratedImage);
			if (input) return { text, images: [input] };
		}
	}
	return text;
}

type GeneratedImageExtraction =
	| { kind: "accepted"; image: ImageMediaValidationSuccess }
	| { kind: "rejected"; error: ImageMediaValidationFailure }
	| { kind: "unsupported" };

function toGeneratedImageMedia(
	image: ImageMediaValidationSuccess,
): GeneratedMedia {
	return {
		id: `media_${nanoid()}`,
		modality: "image",
		mediaType: image.mediaType,
		source: { type: "base64", data: image.base64 },
		sizeBytes: image.decodedBytes,
	};
}

function extractGeneratedImage(
	file: unknown,
	budgetState: MediaBudgetState,
): GeneratedImageExtraction {
	if (!file || typeof file !== "object") return { kind: "unsupported" };
	const record = file as Record<string, unknown>;
	if (
		typeof record.mediaType !== "string" ||
		!record.mediaType.startsWith("image/") ||
		typeof record.base64 !== "string"
	) {
		return { kind: "unsupported" };
	}
	// Generated images use the same bounded media envelope as attachments and
	// persisted history. Accepting an image that hydration later drops would
	// make the live and replayed assistant transcripts disagree.
	const validation = validateAndReserveImageMedia(
		record.mediaType,
		record.base64,
		{},
		budgetState,
	);
	if (!validation.ok) {
		return { kind: "rejected", error: validation };
	}
	return { kind: "accepted", image: validation };
}

type ProjectedMediaNormalization =
	| { ok: true; media: GeneratedMedia }
	| { ok: false; error: string };

function normalizeProjectedModelToolMedia(
	candidate: ProviderGeneratedMedia,
	budgetState: MediaBudgetState,
): ProjectedMediaNormalization {
	if (candidate.modality === "image" && candidate.source.type === "base64") {
		const extracted = extractGeneratedImage(
			{
				base64: candidate.source.data,
				mediaType: candidate.mediaType,
			},
			budgetState,
		);
		if (extracted.kind === "accepted") {
			return { ok: true, media: toGeneratedImageMedia(extracted.image) };
		}
		return {
			ok: false,
			error:
				extracted.kind === "rejected"
					? extracted.error.message
					: "Model tool returned unsupported image media",
		};
	}

	let source = candidate.source;
	let sizeBytes: number | undefined;
	if (candidate.source.type === "base64") {
		const validation = validateAndReserveBase64Media(
			candidate.source.data,
			{},
			budgetState,
		);
		if (!validation.ok) {
			return { ok: false, error: validation.message };
		}
		source = { type: "base64", data: validation.base64 };
		sizeBytes = validation.decodedBytes;
	}

	const media = {
		...candidate,
		id: `media_${nanoid()}`,
		source,
		...(sizeBytes !== undefined ? { sizeBytes } : {}),
	};
	const parsed = GeneratedMediaSchema.safeParse(media);
	return parsed.success
		? { ok: true, media: parsed.data }
		: { ok: false, error: "Model tool returned invalid generated media" };
}

interface ActiveProjectedModelToolCall {
	toolName: ModelToolName;
	input?: unknown;
	execution: ModelToolExecution;
}

interface ProjectedModelToolResult {
	media: GeneratedMedia[];
	activityOutput: unknown;
}

function summarizeProjectedMedia(media: readonly GeneratedMedia[]): unknown {
	return {
		generatedMediaCount: media.length,
		mediaTypes: media.map((item) => item.mediaType),
		byteLength: media.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
	};
}

export function buildAiSdkStreamConfig(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Partial<CallSettings> {
	// R3: upstream composes the adapter-aware resolution here. The fork's
	// MiniMax native-option guard is retained inside `resolvePortableReasoning`
	// (see routing/portable-reasoning.ts), so the upstream call shape is safe
	// to adopt without changing the MiniMax wire behaviour.
	const reasoning = resolvePortableReasoning(request, { context });
	return {
		...(request.maxTokens !== undefined
			? { maxOutputTokens: request.maxTokens }
			: {}),
		temperature: request.temperature,
		...(reasoning ? { reasoning } : {}),
	};
}

function buildProviderModelTools(
	provider: ProviderFactoryResult,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): BuiltModelTools | undefined {
	if (!request.modelTools?.length) {
		return undefined;
	}

	const requestedNames = [
		...new Set(request.modelTools.map((tool) => tool.name)),
	];
	if (!provider.buildModelTools) {
		throw new Error(
			`Provider adapter for "${context.provider.id}" does not implement requested model tool(s): ${requestedNames.join(", ")}.`,
		);
	}

	const modelTools = provider.buildModelTools(request.modelTools);
	const missingNames = requestedNames.filter(
		(toolName) => !Object.hasOwn(modelTools, toolName),
	);
	if (missingNames.length > 0) {
		throw new Error(
			`Provider adapter for "${context.provider.id}" did not build requested model tool(s): ${missingNames.join(", ")}.`,
		);
	}

	return modelTools;
}

function toAiSdkModelToolSet(
	modelTools: BuiltModelTools | undefined,
): ToolSet | undefined {
	if (!modelTools) return undefined;
	const entries = Object.entries(modelTools).flatMap(([name, adapter]) =>
		adapter ? [[name, adapter.tool] as const] : [],
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildAiSdkRequestMessages(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	systemPrompt?: string,
) {
	const aiMessages = toAiSdkMessages(request.messages, systemPrompt, {
		includeReasoning: shouldIncludeReasoningHistory(request, context),
		// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02 (A1):
		// the destination authority is REQUIRED and is established here, at
		// the single request-construction boundary. A caller that cannot
		// establish it gets no opaque replay authority.
		destinationAuthority: buildReasoningOriginAuthority({
			providerId: request.providerId,
			baseUrl: context.config.baseUrl,
		}),
		supportedInputModalities:
			context.model.modalities?.input ??
			(context.model.capabilities
				? modelSupportsImageInput(context)
					? ["text", "image"]
					: ["text"]
				: undefined),
	}) as Array<Record<string, unknown>>;

	if (shouldApplyBedrockCachePoint(request, context)) {
		applyBedrockCachePointToLastUserMessage(aiMessages);
		return aiMessages;
	}

	if (!shouldApplyPromptCache(request, context)) {
		return aiMessages;
	}

	const includeAnthropic = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});

	for (let i = aiMessages.length - 1; i >= 0; i--) {
		if (aiMessages[i]?.role === "user") {
			applyPromptCacheToLastTextPart(
				aiMessages[i],
				request.providerId,
				includeAnthropic,
			);
			break;
		}
	}

	return aiMessages;
}

function resolveStickySession(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
):
	| {
			transport: "json-body" | "header";
			field: string;
			value: string;
	  }
	| undefined {
	const stickySession = context.provider.metadata?.stickySession;
	if (!stickySession) {
		return undefined;
	}
	const metadata = request.metadata;
	const value =
		metadata && typeof metadata === "object"
			? metadata[stickySession.metadataKey]
			: undefined;
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	return {
		transport: stickySession.transport,
		field: stickySession.field,
		value: trimmed,
	};
}

type FetchBodyText =
	| { source: "init-body"; text: string }
	| { request: Request; source: "request"; text: string };

async function bodyTextFromFetchInput(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<FetchBodyText | undefined> {
	const body = init?.body;
	if (body === null) {
		return undefined;
	}
	if (typeof body === "string") {
		return { source: "init-body", text: body };
	}
	if (body instanceof URLSearchParams) {
		return { source: "init-body", text: body.toString() };
	}
	if (body instanceof ArrayBuffer) {
		return { source: "init-body", text: Buffer.from(body).toString("utf8") };
	}
	if (ArrayBuffer.isView(body)) {
		return {
			source: "init-body",
			text: Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString(
				"utf8",
			),
		};
	}
	if (body !== undefined) {
		return undefined;
	}
	if (input instanceof Request) {
		try {
			return {
				request: input,
				source: "request",
				text: await input.clone().text(),
			};
		} catch {
			return undefined;
		}
	}
	return undefined;
}

async function injectJsonBodyStickySession(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	stickySession: { field: string; value: string },
): Promise<Parameters<typeof fetch>> {
	const bodyText = await bodyTextFromFetchInput(input, init);
	if (!bodyText?.text.trim().startsWith("{")) {
		return [input, init];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText.text);
	} catch {
		return [input, init];
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return [input, init];
	}
	const body = parsed as Record<string, unknown>;
	const existingValue = body[stickySession.field];
	if (typeof existingValue !== "string" || !existingValue.trim()) {
		body[stickySession.field] = stickySession.value;
	}
	const nextBody = JSON.stringify(body);
	if (bodyText.source === "init-body") {
		return [input, { ...init, body: nextBody }];
	}
	return [new Request(bodyText.request, { body: nextBody }), init];
}

function injectHeaderStickySession(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	stickySession: { field: string; value: string },
): Parameters<typeof fetch> {
	const headers = new Headers(
		input instanceof Request ? input.headers : undefined,
	);
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value);
	});
	if (!headers.get(stickySession.field)?.trim()) {
		headers.set(stickySession.field, stickySession.value);
	}
	return [input, { ...init, headers }];
}

function wrapFetchForStickySession(
	baseFetch: typeof fetch | undefined,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): typeof fetch | undefined {
	const stickySession = resolveStickySession(request, context);
	if (!stickySession) {
		return baseFetch;
	}
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const sessionFetch = (async (input, init) => {
		const [nextInput, nextInit] =
			stickySession.transport === "json-body"
				? await injectJsonBodyStickySession(input, init, stickySession)
				: injectHeaderStickySession(input, init, stickySession);
		return delegate(nextInput, nextInit);
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(
			sessionFetch as typeof fetch & {
				preconnect?: (...args: unknown[]) => unknown;
			}
		).preconnect = delegateWithPreconnect.preconnect.bind(delegate);
	}
	return sessionFetch;
}

function shouldIncludeReasoningHistory(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return !isCerebrasProvider(request, context);
}

async function resolveGatewayAiSdkTelemetry(
	providerId: string,
	request: GatewayStreamRequest,
): Promise<AiSdkTelemetryDecision> {
	try {
		const runtime = await import("../services/langfuse-telemetry");
		return await runtime.resolveAiSdkTelemetry(
			providerId,
			resolveTraceSamplingKey(request),
		);
	} catch {
		return { isEnabled: false };
	}
}

/**
 * Whole-task sampling key: prefer the session/task id so every request in a
 * task gets the same sampling decision and traces stay complete.
 */
function resolveTraceSamplingKey(
	request: GatewayStreamRequest,
): string | undefined {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? (request.metadata as Record<string, unknown>)
			: {};
	for (const key of ["sessionId", "conversationId", "distinctId"]) {
		const value = metadata[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

async function withAiSdkLangfuseTraceContext<T>(
	enabled: boolean,
	request: GatewayStreamRequest,
	callback: () => T | Promise<T>,
): Promise<T> {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
		: undefined;
	const distinctId =
		typeof metadata.distinctId === "string" ? metadata.distinctId : undefined;
	const sessionId =
		typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;

	if (!enabled) {
		return await callback();
	}

	// Operator env tags/metadata are merged inside the runtime, which also
	// skips propagation when nothing at all is set.
	const runtime = await import("../services/langfuse-telemetry");
	return await runtime.withLangfuseTraceAttributes(
		true,
		{
			...(distinctId ? { userId: distinctId } : {}),
			...(sessionId ? { sessionId } : {}),
			...(tags?.length ? { tags } : {}),
			metadata: {
				...(typeof metadata.conversationId === "string"
					? { conversationId: metadata.conversationId }
					: {}),
				...(typeof metadata.runId === "string"
					? { runId: metadata.runId }
					: {}),
			},
		},
		callback,
	);
}

function buildAiSdkRuntimeContext(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	const requestMetadata = request.metadata;
	const metadata =
		requestMetadata && typeof requestMetadata === "object"
			? requestMetadata
			: {};
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
		: undefined;
	const distinctId =
		typeof metadata.distinctId === "string" ? metadata.distinctId : undefined;

	return {
		// `distinctId` is Cline's canonical identity field. Langfuse's data
		// model calls the same value `userId`, so expose both in runtime
		// context and explicitly map distinctId to Langfuse's userId below.
		...(distinctId ? { distinctId, userId: distinctId } : {}),
		...(typeof metadata.sessionId === "string"
			? { sessionId: metadata.sessionId }
			: {}),
		...(typeof metadata.clientName === "string"
			? { clientName: metadata.clientName }
			: {}),
		...(typeof metadata.clientVersion === "string"
			? { clientVersion: metadata.clientVersion }
			: {}),
		...(typeof metadata.clineCoreVersion === "string"
			? { clineCoreVersion: metadata.clineCoreVersion }
			: {}),
		...(tags && tags.length > 0 ? { tags } : {}),
		// Keep Cline correlation fields available even when the integration
		// does not promote them to first-class Langfuse fields.
		...(typeof metadata.conversationId === "string"
			? { conversationId: metadata.conversationId }
			: {}),
		...(typeof metadata.runId === "string" ? { runId: metadata.runId } : {}),
		...(typeof metadata.agentId === "string"
			? { agentId: metadata.agentId }
			: {}),
		...(typeof metadata.modelRequestId === "string"
			? { modelRequestId: metadata.modelRequestId }
			: {}),
		...(typeof metadata.iteration === "number"
			? { iteration: metadata.iteration }
			: {}),
		providerId: request.providerId,
		modelId: request.modelId,
		resolvedModelId: context.model.id,
	};
}

function toAiSdkMessages(
	messages: readonly AgentMessage[],
	systemPrompt: string | undefined,
	options: {
		includeReasoning?: boolean;
		supportedInputModalities?: readonly string[];
		/**
		 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02 (A1).
		 *
		 * The ORIGIN AUTHORITY of the request the messages are replayed
		 * into (the provider id plus the effective route).
		 *
		 * It is REQUIRED: an opaque reasoning payload may only be replayed
		 * when the destination's authority is positively established. There
		 * is deliberately no permissive fallback — a caller that cannot
		 * establish the destination identity gets NO opaque replay authority.
		 *
		 * The VALUE may be `undefined`, which is how an UNRESOLVED
		 * destination route (no base URL, an invalid base URL, or a
		 * credential-bearing base URL) is represented. An unresolved
		 * destination grants NO replay authority.
		 */
		destinationAuthority: string | undefined;
	},
) {
	const includeReasoning = options?.includeReasoning ?? true;
	const normalizedMessages: AiSdkFormatterMessage[] = [];

	for (const message of messages) {
		const content: AiSdkFormatterPart[] = [];
		let skippedReasoning = false;
		for (const part of message.content) {
			if (part.type === "text") {
				content.push({ type: "text", text: sanitizeSurrogates(part.text) });
				continue;
			}

			if (part.type === "reasoning") {
				if (!includeReasoning) {
					skippedReasoning = true;
					continue;
				}
				const metadata = part.metadata as Record<string, unknown> | undefined;
				// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01.
				//
				// The ORIGIN boundary for opaque provider-owned reasoning
				// metadata.
				//
				// The Anthropic thinking signature and the redacted-thinking
				// payload are ISSUED BY one endpoint and authenticate a block to
				// it. Replaying them to a DIFFERENT origin would disclose one
				// endpoint's opaque metadata to another.
				//
				// The issuing provider is recorded WITH the payload when it is
				// extracted (see `extractReasoningMetadata`). When that origin
				// is KNOWN and differs from the request's provider, the opaque
				// metadata is withheld. The reasoning TEXT is preserved — it is
				// not opaque.
				//
				// When the origin is UNKNOWN (no recorded origin), the metadata
				// is replayed: the absence of origin information is not evidence
				// of a cross-origin replay, and dropping it would silently lose
				// a provider-required signature.
				const origin = metadata?.[REASONING_METADATA_ORIGIN_KEY];
				const sameOrigin = mayReplayOpaqueReasoning({
					origin,
					destinationAuthority: options.destinationAuthority,
				});
				const signature = sameOrigin ? metadata?.signature : undefined;
				const redactedData = sameOrigin ? metadata?.redactedData : undefined;
				content.push({
					type: "reasoning",
					text: sanitizeSurrogates(part.text),
					...(typeof signature === "string" || typeof redactedData === "string"
						? {
								providerOptions: {
									anthropic: {
										...(typeof signature === "string" ? { signature } : {}),
										...(typeof redactedData === "string"
											? { redactedData }
											: {}),
									},
								},
							}
						: {}),
				});
				continue;
			}

			if (part.type === "file") {
				content.push({
					type: "file",
					path: part.path,
					content: part.content,
				});
				continue;
			}

			if (part.type === "image") {
				content.push({
					type: "image",
					image: part.image,
					mediaType: part.mediaType,
				});
				continue;
			}

			if (part.type === "media") {
				content.push({ type: "media", media: part.media });
				continue;
			}

			if (part.type === "tool-call") {
				const metadata = part.metadata as Record<string, unknown> | undefined;
				const thoughtSignature =
					metadata?.thoughtSignature ??
					metadata?.signature ??
					metadata?.thought_signature;
				content.push({
					type: "tool-call",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input,
					...(typeof thoughtSignature === "string"
						? {
								providerOptions: {
									google: { thoughtSignature },
								},
							}
						: {}),
				});
				continue;
			}

			if (part.type === "tool-result") {
				content.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output: part.output,
					isError: part.isError ?? false,
				});
			}
		}

		// A message left empty only because its reasoning was dropped is
		// omitted entirely instead of forwarded as an empty turn.
		const emptiedByDroppedReasoning = !includeReasoning && skippedReasoning;
		if (content.length > 0) {
			normalizedMessages.push({ role: message.role, content });
		} else if (
			!emptiedByDroppedReasoning &&
			(message.role === "user" || message.role === "assistant")
		) {
			normalizedMessages.push({ role: message.role, content: "" });
		}
	}

	return formatMessagesForAiSdk(systemPrompt, normalizedMessages, {
		assistantToolCallArgKey: "input",
		supportedInputModalities: options?.supportedInputModalities,
	});
}

function toAiSdkTools(request: GatewayStreamRequest): ToolSet | undefined {
	if (!request.tools?.length) {
		return undefined;
	}

	// No validate callback on purpose: schema validation belongs to the tools
	// themselves (core executors validate with lenient union schemas that
	// accept common weak-model shapes like a bare string for a string[]
	// property). Rejecting here would return an error to the model without
	// the tool's own input handling ever seeing the call.
	const tools: ToolSet = {};
	for (const definition of request.tools) {
		tools[definition.name] = {
			description: definition.description,
			inputSchema: jsonSchema(
				normalizeAiSdkToolInputSchema(definition.inputSchema),
			),
		};
	}
	return tools;
}

function mergeAiSdkTools(
	runtimeTools: ToolSet | undefined,
	providerTools: ToolSet | undefined,
): ToolSet | undefined {
	// Runtime tools carry the caller's executor contract, so they retain
	// ownership when a provider happens to register the same public name.
	const tools = {
		...(providerTools ?? {}),
		...(runtimeTools ?? {}),
	};
	return Object.keys(tools).length > 0 ? tools : undefined;
}

function hasAiSdkTool(tools: ToolSet | undefined, toolName: string): boolean {
	return tools !== undefined && Object.hasOwn(tools, toolName);
}

interface RepairableToolCall {
	toolCallId: string;
	toolName: string;
	input: string;
}

/**
 * Last-chance repair for tool calls whose arguments are not valid JSON
 * (truncated payloads, single quotes, unescaped newlines — common with
 * weaker models). Runs the raw argument text through the shared jsonrepair
 * strategies; unknown tool names and already-valid JSON are not repairable
 * here, and returning null preserves the AI SDK's original error behavior.
 */
export async function repairMalformedToolCall<T extends RepairableToolCall>({
	toolCall,
	error,
}: {
	toolCall: T;
	error: unknown;
}): Promise<T | null> {
	if (NoSuchToolError.isInstance(error)) {
		return null;
	}
	if (typeof toolCall.input !== "string" || toolCall.input.trim() === "") {
		return null;
	}
	try {
		JSON.parse(toolCall.input);
		// Valid JSON means the failure was a schema mismatch, not a parse
		// error. That is left to the tool executor's own lenient union
		// schemas; there is nothing to repair here.
		return null;
	} catch {
		// Not valid JSON — attempt repair below.
	}
	const repaired = parseJsonStream(toolCall.input);
	if (repaired === toolCall.input || typeof repaired === "string") {
		return null;
	}
	return { ...toolCall, input: JSON.stringify(repaired) };
}

function normalizeAiSdkToolInputSchema(
	inputSchema: Record<string, unknown>,
): Record<string, unknown> {
	if (inputSchema.type === "object") {
		return inputSchema;
	}

	return {
		type: "object",
		...inputSchema,
	};
}

function providerDisablesExternalToolExecution(
	context: GatewayProviderContext,
): boolean {
	return context.provider.capabilities?.includes("provider-tools") ?? false;
}

function mergeToolCallMetadata(
	current: unknown,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	if (!current || typeof current !== "object" || Array.isArray(current)) {
		return patch;
	}
	return {
		...(current as Record<string, unknown>),
		...patch,
	};
}

function buildToolCallMetadata(input: {
	metadata: unknown;
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
}): Record<string, unknown> {
	return mergeToolCallMetadata(input.metadata, {
		toolSource: {
			providerId: input.request.providerId,
			modelId: input.request.modelId,
			executionMode: providerDisablesExternalToolExecution(input.context)
				? "provider"
				: "runtime",
		},
	});
}

function buildRecoverableToolErrorMetadata(input: {
	part: AiSdkStreamPart;
	errorMessage: string;
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	toolName: string;
}): Record<string, unknown> {
	return buildToolCallMetadata({
		metadata: mergeToolCallMetadata(extractGoogleThoughtMetadata(input.part), {
			inputParseError: `Tool call ${input.toolName} was rejected before execution: ${input.errorMessage}`,
			aiSdkToolError: input.errorMessage,
		}),
		request: input.request,
		context: input.context,
	});
}

function resolveAiSdkSystemPrompt(
	request: GatewayStreamRequest,
): string | undefined {
	return request.providerId === "openai-codex"
		? undefined
		: request.systemPrompt;
}

function mapFinishReason(value: unknown): AgentModelFinishReason {
	// Consume the AI SDK unified reason; raw provider values belong in diagnostics.
	switch (value) {
		case "stop":
			return "stop";
		case "tool-calls":
			return "tool-calls";
		case "length":
			return "max-tokens";
		case "content-filter":
			return "content-filter";
		case "error":
			return "error";
		default:
			return "unknown";
	}
}

function getUsageValue(
	usage: Record<string, unknown>,
	...keys: string[]
): number {
	for (const key of keys) {
		const value = usage[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (
			typeof value === "string" &&
			value.trim().length > 0 &&
			Number.isFinite(Number(value))
		) {
			return Number(value);
		}
	}
	return 0;
}

function getNumericValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (
		typeof value === "string" &&
		value.trim().length > 0 &&
		Number.isFinite(Number(value))
	) {
		return Number(value);
	}
	return undefined;
}

function getNestedUsageValue(
	usage: Record<string, unknown>,
	...path: string[]
): number {
	let current: unknown = usage;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return 0;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return getNumericValue(current) ?? 0;
}

/**
 * AI SDK request-start retries (`maxRetries`) handle transient failures before
 * streaming begins, with backoff that honors `retry-after` headers. Provider
 * error parts received after streaming starts use `streamRetries` instead.
 *
 * Exhausted request-start retries (`RetryError`) and terminal stream error parts
 * do not trigger the agent's whole-turn retry, so the retry budgets do not
 * multiply. See `captureStreamError` and `isRetryableBeyondSdkRetries`.
 */
const MODEL_REQUEST_MAX_RETRIES = 3;
const MODEL_STREAM_MAX_RETRIES = 3;

type UsagePath = readonly [string] | readonly [string, string];

/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * The REASONING BREAKDOWN paths, in authority order.
 *
 * The AI SDK's own contract (`LanguageModelV4Usage`) states that
 * `outputTokens.total` is "the total number of output (completion) tokens
 * used" and that `outputTokens.text` and `outputTokens.reasoning` are its
 * PARTS. The flat shape the AI SDK v4 core exposes to the application
 * (`asLanguageModelUsage`) is therefore:
 *
 *   outputTokens        = total (reasoning-INCLUSIVE)
 *   outputTokenDetails  = { textTokens, reasoningTokens }
 *
 * The reasoning breakdown is read from the SDK's STRUCTURED fields first
 * (they are the SDK's own, correctly scoped, per-attempt authority), and only
 * then from the raw provider payload.
 *
 * `thinking_tokens` is the Anthropic Messages contract's own name for the
 * reasoning breakdown. It is the native spelling of the same field that the
 * OpenAI-family names spell `reasoning_tokens`, so it belongs in the same
 * authority list — NOT as an extension of the vocabulary alone, but because
 * the Anthropic-native name is what the resolved `@ai-sdk/anthropic` adapter
 * itself reads (`usage.output_tokens_details?.thinking_tokens`).
 */
const REASONING_TOKEN_PATHS: UsagePath[] = [
	// The AI SDK's structured breakdown (authoritative, per-attempt scoped).
	["outputTokenDetails", "reasoningTokens"],
	["outputTokens", "reasoning"],
	// Raw provider payloads.
	["output_tokens_details", "reasoning_tokens"],
	["output_tokens_details", "thinking_tokens"],
	["completion_tokens_details", "reasoning_tokens"],
	["reasoningTokens"],
	["reasoning_tokens"],
];

/**
 * The VISIBLE (text-only) output paths, in authority order.
 *
 * When the SDK could resolve the breakdown, it already computed the visible
 * remainder (`outputTokens.text` = total - reasoning). That value IS the
 * visible output: it needs no subtraction, and it is scoped to exactly the
 * attempts the total covers. Reading it is what keeps a MULTI-ATTEMPT total
 * (the retry middleware sums `outputTokens.total` across physical requests)
 * from being reduced by a SINGLE attempt's reasoning.
 */
const VISIBLE_OUTPUT_TOKEN_PATHS: UsagePath[] = [
	["outputTokenDetails", "textTokens"],
	["outputTokens", "text"],
];

function getUsageValueByPath(source: unknown, path: UsagePath): number {
	let current: unknown = source;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return 0;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return getNumericValue(current) ?? 0;
}

/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * A usage value that is PRESENT — including an explicit ZERO — as opposed to
 * an absent one.
 *
 * The distinction is load-bearing: an explicit zero is the provider stating
 * "this metric is zero", while an absent value is "this provider does not
 * report this metric". Optional zero versus absent metrics must survive the
 * normalization unchanged.
 */
function resolveUsageValue(
	sources: unknown[],
	paths: UsagePath[],
): { present: boolean; value: number } {
	for (const source of sources) {
		for (const path of paths) {
			const raw = getUsageValueByPath(source, path);
			if (raw > 0) {
				return { present: true, value: raw };
			}
			// An explicit zero is present, not absent: report it as such so
			// the caller can distinguish "reported as zero" from "not
			// reported at all".
			const direct = getUsageValueByPathDefined(source, path);
			if (direct !== undefined) {
				return { present: true, value: 0 };
			}
		}
	}
	return { present: false, value: 0 };
}

/**
 * Reads a usage value at `path`, returning `undefined` only when the field is
 * ABSENT (not merely zero).
 */
function getUsageValueByPathDefined(
	source: unknown,
	path: UsagePath,
): number | undefined {
	let current: unknown = source;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return getNumericValue(current);
}

function extractProviderNestedUsage(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const providerMetadata = value as Record<string, unknown>;
	for (const nestedValue of Object.values(providerMetadata)) {
		if (!nestedValue || typeof nestedValue !== "object") {
			continue;
		}

		const nestedMetadata = nestedValue as Record<string, unknown>;
		if (nestedMetadata.usage && typeof nestedMetadata.usage === "object") {
			return nestedMetadata.usage as Record<string, unknown>;
		}
	}

	return undefined;
}

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
 *
 * Merge two provider-metadata records, with the SECOND taking precedence
 * within each provider's namespace.
 *
 * `providerMetadata` is `Record<string, JSONObject>` keyed by the OWNING
 * provider's name, so the namespaces are independent: merging them keeps
 * every namespace intact and never lets one provider's namespace overwrite
 * another's.
 */
function mergeProviderMetadata(base: unknown, overlay: unknown): unknown {
	if (!base || typeof base !== "object") {
		return overlay;
	}
	if (!overlay || typeof overlay !== "object") {
		return base;
	}
	const baseRecord = base as Record<string, unknown>;
	const overlayRecord = overlay as Record<string, unknown>;
	const merged: Record<string, unknown> = { ...baseRecord };
	for (const [namespace, value] of Object.entries(overlayRecord)) {
		const existing = baseRecord[namespace];
		merged[namespace] =
			existing &&
			typeof existing === "object" &&
			value &&
			typeof value === "object"
				? {
						...(existing as Record<string, unknown>),
						...(value as Record<string, unknown>),
					}
				: value;
	}
	return merged;
}

function calculateUsageCostFromPricing(
	usage: Omit<GatewayNormalizedUsage, "totalCost">,
	pricingValue: unknown,
): number | undefined {
	if (!pricingValue || typeof pricingValue !== "object") {
		return undefined;
	}

	const pricing = pricingValue as Record<string, unknown>;
	const inputPrice = getNumericValue(pricing.input);
	const outputPrice = getNumericValue(pricing.output);

	if (inputPrice === undefined || outputPrice === undefined) {
		return undefined;
	}

	const cacheReadPrice = getNumericValue(pricing.cacheRead) ?? 0;
	const cacheWritePrice =
		getNumericValue(pricing.cacheWrite) ?? inputPrice * 1.25;
	const billableInputTokens = Math.max(
		0,
		usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
	);

	return (
		(billableInputTokens / 1_000_000) * inputPrice +
		(usage.outputTokens / 1_000_000) * outputPrice +
		(usage.cacheReadTokens / 1_000_000) * cacheReadPrice +
		(usage.cacheWriteTokens / 1_000_000) * cacheWritePrice
	);
}

/**
 * Normalizes usage from various provider formats into a standard structure.
 * Accepts both AI SDK's normalized shapes (AiSdkStreamTotalUsage, AiSdkStreamUsage)
 * and raw provider responses. Handles multiple naming conventions (camelCase vs snake_case),
 * extracts costs from provider-specific fields, and falls back to pricing-based calculation.
 * Provider-reported billed cost takes precedence over market cost so gateway discounts
 * are reflected in user-facing totals. Market cost remains a fallback when no billed
 * cost is available.
 *
 * @param usageValue - AI SDK normalized usage or raw provider response object
 * @param providerMetadata - Provider-specific metadata for cost extraction
 * @param pricingValue - Fallback pricing config (per 1M tokens) when no explicit cost found
 */
export function normalizeUsage(
	usageValue:
		| AiSdkStreamUsage
		| AiSdkStreamTotalUsage
		| Record<string, unknown>
		| undefined,
	providerMetadata?: unknown,
	pricingValue?: unknown,
	selection?: Pick<GatewayStreamRequest, "providerId" | "modelId">,
): GatewayNormalizedUsage {
	const usage =
		usageValue && typeof usageValue === "object"
			? (usageValue as Record<string, unknown>)
			: {};
	const providerUsage = extractProviderNestedUsage(providerMetadata);
	const providerMetadataRecord =
		providerMetadata && typeof providerMetadata === "object"
			? (providerMetadata as Record<string, unknown>)
			: {};
	const gatewayMetadata =
		providerMetadataRecord.gateway &&
		typeof providerMetadataRecord.gateway === "object"
			? (providerMetadataRecord.gateway as Record<string, unknown>)
			: {};
	const rawUsage =
		usage.raw && typeof usage.raw === "object"
			? (usage.raw as Record<string, unknown>)
			: usage;
	const upstreamInferenceCost =
		getNumericValue(
			(rawUsage.cost_details as Record<string, unknown> | undefined)
				?.upstream_inference_cost,
		) ?? getNumericValue(rawUsage.upstream_inference_cost);
	const marketCost =
		getNumericValue(rawUsage.market_cost) ??
		getNumericValue(rawUsage.marketCost) ??
		getNumericValue(gatewayMetadata.marketCost);
	const baseCost =
		getNumericValue(rawUsage.cost) ?? getNumericValue(gatewayMetadata.cost);
	const hasExplicitCost =
		marketCost !== undefined ||
		baseCost !== undefined ||
		upstreamInferenceCost !== undefined;
	const isByokUsage =
		rawUsage.is_byok === true ||
		rawUsage.isByok === true ||
		gatewayMetadata.is_byok === true ||
		gatewayMetadata.isByok === true;
	const shouldAddUpstreamCost =
		isByokUsage &&
		baseCost !== undefined &&
		upstreamInferenceCost !== undefined;
	const costOrUpstream =
		baseCost !== undefined && baseCost > 0
			? baseCost
			: (upstreamInferenceCost ?? baseCost);
	const billedCost = shouldAddUpstreamCost
		? baseCost + upstreamInferenceCost
		: costOrUpstream;
	const totalCost =
		billedCost !== undefined && billedCost !== 0
			? billedCost
			: (marketCost ?? billedCost);
	const normalizedUsage = {
		inputTokens:
			getNestedUsageValue(usage, "inputTokens", "total") ||
			getUsageValue(usage, "inputTokens", "input_tokens", "prompt_tokens") ||
			getUsageValue(rawUsage, "promptTokenCount", "prompt_token_count"),
		outputTokens:
			getNestedUsageValue(usage, "outputTokens", "total") ||
			getUsageValue(
				usage,
				"outputTokens",
				"output_tokens",
				"completion_tokens",
			) ||
			getUsageValue(rawUsage, "candidatesTokenCount", "candidates_token_count"),
		cacheReadTokens:
			getNestedUsageValue(usage, "inputTokens", "cacheRead") ||
			getNestedUsageValue(usage, "inputTokenDetails", "cacheReadTokens") ||
			getUsageValue(
				usage,
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			) ||
			getNestedUsageValue(usage, "prompt_tokens_details", "cached_tokens") ||
			getNestedUsageValue(rawUsage, "prompt_tokens_details", "cached_tokens") ||
			getUsageValue(rawUsage, "cachedContentTokenCount") ||
			getUsageValue(
				providerUsage ?? {},
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			),
		cacheWriteTokens:
			getNestedUsageValue(usage, "inputTokens", "cacheWrite") ||
			getNestedUsageValue(usage, "inputTokenDetails", "cacheWriteTokens") ||
			getNestedUsageValue(
				usage,
				"prompt_tokens_details",
				"cache_write_tokens",
			) ||
			getUsageValue(
				usage,
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			) ||
			getNestedUsageValue(
				rawUsage,
				"prompt_tokens_details",
				"cache_write_tokens",
			) ||
			getUsageValue(
				rawUsage,
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			) ||
			getUsageValue(
				providerUsage ?? {},
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			),
	};
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3.1).
	//
	// THE RAW PAYLOAD'S SCOPE IS THE ATTEMPT COUNT'S SCOPE.
	//
	// The `raw` payload describes ONE physical attempt. The SDK's structured
	// fields describe exactly the attempts the reported output total covers.
	//
	// For a MULTI-ATTEMPT aggregate those two scopes DIFFER: the production
	// retry middleware aggregates the discarded attempts' usage into the
	// emitted finish part and keeps the SERVED attempt's raw payload, so
	// reading a reasoning count out of that raw payload attributes ONE
	// attempt's reasoning to the WHOLE aggregate:
	//
	//   attempt 1: total 900, reasoning 800
	//   attempt 2: total 900, reasoning UNREPORTED
	//   served:    total 900, reasoning 700
	//
	// The aggregate's reasoning was NEVER established (attempt 2 reported
	// none), but the raw payload made the normalizer report 700 as the
	// aggregate's reasoning — and the visible output as the remainder, which
	// claims the whole aggregate's output was visible.
	//
	// So the raw payload is consulted ONLY when the usage covers a SINGLE
	// physical attempt. For a multi-attempt aggregate the raw payload is
	// EXCLUDED from the breakdown resolution, and the aggregate's own
	// structured breakdown — which the middleware established or omitted —
	// is the authority.
	//
	// The PROVIDER'S NESTED USAGE METADATA is excluded for the same reason:
	// `providerMetadata.<provider>.usage` is the SERVED attempt's own usage
	// payload, so it carries the same one-attempt scope as `usage.raw`.
	//
	// The attempt count is an OBSERVED fact (the middleware-owned occupancy
	// authority), never an assumption.
	const occupancyAuthority = readPhysicalRequestOccupancy(providerMetadata);
	const observedAttemptCount = occupancyAuthority?.attemptCount;
	const usageCoversManyAttempts =
		observedAttemptCount !== undefined && observedAttemptCount > 1;
	const breakdownSources = usageCoversManyAttempts
		? [usage]
		: [usage, rawUsage, providerUsage ?? {}];
	// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
	//
	// The reasoning breakdown is resolved from the SDK's STRUCTURED fields
	// first (the SDK's own per-attempt authority), then from the raw
	// provider payload. The raw payload describes ONE physical attempt; the
	// SDK's structured fields describe exactly the attempts the reported
	// output total covers.
	const reasoningResolution = resolveUsageValue(
		breakdownSources,
		REASONING_TOKEN_PATHS,
	);
	const reasoningTokenCount = reasoningResolution.value;
	//
	// The VISIBLE output, when the SDK could resolve the breakdown. The SDK
	// computes `outputTokens.text = total - reasoning`, so this value already
	// excludes the reasoning and needs no further subtraction. Using it is
	// what keeps a MULTI-ATTEMPT total from being reduced by a single
	// attempt's reasoning.
	const visibleOutputResolution = resolveUsageValue(
		breakdownSources,
		VISIBLE_OUTPUT_TOKEN_PATHS,
	);
	const pricing = pricingValue as Record<string, unknown> | undefined;
	// Cline's included models have no per-request charge, even when the
	// response includes the upstream inference or market cost.
	const includedClineUsage =
		selection?.providerId === "cline-pass" ||
		(selection?.providerId === "cline" &&
			(selection.modelId.startsWith("cline-pass/") ||
				selection.modelId.startsWith("cline-free/") ||
				selection.modelId.endsWith(":free") ||
				(pricing?.input === 0 &&
					pricing?.output === 0 &&
					(pricing.cacheRead ?? 0) === 0 &&
					(pricing.cacheWrite ?? 0) === 0)));
	const resolvedTotalCost = includedClineUsage
		? 0
		: totalCost !== undefined
			? totalCost
			: hasExplicitCost
				? undefined
				: calculateUsageCostFromPricing(normalizedUsage, pricingValue);

	//
	// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
	//
	// The OUTPUT TOTAL is the provider's own count. Under the AI SDK's
	// contract it INCLUDES the reasoning tokens:
	//
	//     outputTokens.total = outputTokens.text + outputTokens.reasoning
	//
	// so the visible output is the remainder, never an addition. The
	// conservation law this normalization upholds is therefore:
	//
	//     visible output + reasoning == output total
	//
	// Two ways to reach it:
	//
	//   1. The SDK resolved the breakdown and published the visible
	//      remainder itself (`outputTokenDetails.textTokens` /
	//      `outputTokens.text`). That value is authoritative AND is scoped
	//      to exactly the attempts the total covers, so it is used as-is.
	//
	//   2. The SDK could not resolve the breakdown (the provider reports
	//      the reasoning only in the raw payload, and the resolved
	//      `@ai-sdk/anthropic` adapter drops the OPENING frame's
	//      `output_tokens_details`). The reasoning is then a SUBSET of the
	//      reported total and is subtracted from it — but never below zero,
	//      and never below the reasoning that is actually accounted for.
	//
	// The reasoning count is reported separately in either case, so every
	// downstream consumer (session totals, telemetry, Harbor's
	// n_output_tokens) books the reasoning once, as its own count, and not
	// also as part of "output".
	//
	// Cost above is computed from the PRE-subtraction output total, since
	// reasoning tokens are still billed at the output rate.
	const outputTotal = normalizedUsage.outputTokens;
	const visibleOutput = visibleOutputResolution.present
		? visibleOutputResolution.value
		: Math.max(0, outputTotal - reasoningTokenCount);

	//
	// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
	//
	// The PHYSICAL-REQUEST OCCUPANCY AUTHORITY, carried by the production
	// retry middleware alongside the aggregate.
	//
	// It is read from the finish part's `providerMetadata`, under the
	// middleware-owned `cline` namespace. It is NEVER read from the usage
	// record's `raw` payload: the resolved `@ai-sdk/anthropic` adapter sets
	// `raw` to the PROVIDER'S OWN raw usage payload, so a provider-supplied
	// field could otherwise establish the occupancy authority.
	//
	// It is NEVER derived from the aggregate: no division by an assumed
	// attempt count, no subtraction of cached tokens, no inference from the
	// output side.
	//
	// The authority is THREE-VALUED, and the distinction is what forbids the
	// aggregate fallback:
	//
	//   "single"  ONE physical attempt — the aggregate IS the occupancy;
	//   "known"   the SERVED attempt's own prompt size is the occupancy;
	//   "unknown" the aggregate covers an UNKNOWN number of requests, so it
	//             establishes NO request's occupancy. The authority is
	//             DENIED.
	//
	// The authority was read ABOVE, where the breakdown's scope needed it.

	//
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3.2).
	//
	// AN EXPLICIT ZERO IS PUBLISHED; AN ABSENT VALUE IS NOT.
	//
	// The predecessor published the reasoning count only when it was
	// POSITIVE, so an explicitly reported ZERO — the provider stating "this
	// response carried no reasoning tokens" — was indistinguishable from a
	// provider that does not report the metric at all.
	//
	// `resolveUsageValue` already distinguishes the two (it reports PRESENCE
	// separately from the value, and an explicit zero IS present), so the
	// publication uses the validated presence rather than the value's
	// magnitude. The absence stays absent, and the explicit zero survives.
	return {
		...normalizedUsage,
		outputTokens: visibleOutput,
		...(reasoningResolution.present ? { reasoningTokenCount } : {}),
		...(typeof resolvedTotalCost === "number"
			? { totalCost: resolvedTotalCost }
			: {}),
		...(occupancyAuthority !== undefined
			? { requestOccupancy: occupancyAuthority }
			: {}),
	};
}

/**
 * Suppress unhandled rejections from AI SDK stream promises (usage, finishReason, etc.)
 * that reject with NoOutputGeneratedError when the stream encounters an error.
 *
 * The AI SDK's streamText result exposes lazy promise getters (finishReason, totalUsage,
 * steps, text, usage, etc.) backed by internal DelayedPromise instances. When the stream
 * errors with 0 recorded steps, the flush callback rejects all of them. We must access
 * each getter to obtain the promise and attach a no-op rejection handler before Bun/Node
 * surfaces them as unhandled rejections.
 */
function suppressDanglingStreamPromises(
	stream: AiSdkStreamResult | undefined,
): void {
	if (!stream) return;
	const noop = () => {};
	const suppress = (val: unknown) => {
		if (val && typeof (val as Promise<unknown>).catch === "function") {
			(val as Promise<unknown>).catch(noop);
		}
	};

	// Access known lazy promise getters on the AI SDK StreamTextResult object.
	const s = stream as Record<string, unknown>;

	// Catch-all for any remaining promise-valued own properties.
	for (const key of Object.keys(stream)) {
		try {
			suppress(s[key]);
		} catch {
			// ignore
		}
	}
}

/**
 * The GOOGLE / VERTEX thought metadata carried by a stream part.
 *
 * `thoughtSignature` is the opaque signature the Gemini family attaches to
 * a thought block. It travels in `providerMetadata.google` /
 * `providerMetadata.vertex`.
 *
 * This is the ORIGINAL extraction scope. It is deliberately kept SEPARATE
 * from the Anthropic reasoning metadata (below): the Google/Vertex thought
 * signature is a TOOL-CALL-scoped concept (it authorises the continuation
 * of a tool call), while the Anthropic signature is a REASONING-BLOCK-scoped
 * concept (it authenticates a thinking block).
 */
function extractGoogleThoughtMetadata(
	part: AiSdkStreamPart,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {};

	if (typeof part.thoughtSignature === "string") {
		metadata.thoughtSignature = part.thoughtSignature;
	}
	if (typeof part.thought_signature === "string") {
		metadata.thought_signature = part.thought_signature;
	}

	const providerMetadata =
		part.providerMetadata && typeof part.providerMetadata === "object"
			? (part.providerMetadata as Record<string, unknown>)
			: undefined;
	const googleMetadata =
		providerMetadata?.google && typeof providerMetadata.google === "object"
			? (providerMetadata.google as Record<string, unknown>)
			: undefined;
	const vertexMetadata =
		providerMetadata?.vertex && typeof providerMetadata.vertex === "object"
			? (providerMetadata.vertex as Record<string, unknown>)
			: undefined;

	if (
		typeof metadata.thoughtSignature !== "string" &&
		typeof (
			googleMetadata?.thoughtSignature ?? vertexMetadata?.thoughtSignature
		) === "string"
	) {
		metadata.thoughtSignature =
			googleMetadata?.thoughtSignature ?? vertexMetadata?.thoughtSignature;
	}
	if (
		typeof metadata.thought_signature !== "string" &&
		typeof googleMetadata?.thought_signature === "string"
	) {
		metadata.thought_signature = googleMetadata.thought_signature;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02.
 *
 * The metadata key that records the ORIGIN AUTHORITY of an opaque
 * provider-owned reasoning payload.
 *
 * It is the SAME key the production persistence codec preserves
 * (`agent-message-codec.ts`, `ThinkingContent.originAuthority`), so the
 * authority travels with the payload through accumulation, persistence and
 * restoration without a second representation.
 *
 * It is READ ONLY by the outbound conversion. It is never sent to a
 * provider: the outbound conversion consumes it and does not forward it.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3): the value is the
 * SHARED constant (`REASONING_ORIGIN_AUTHORITY_KEY`), not a local copy, so
 * the wire and the request-budget authority read the SAME field by
 * construction.
 */
const REASONING_METADATA_ORIGIN_KEY = REASONING_ORIGIN_AUTHORITY_KEY;

/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02.
 *
 * The ORIGIN AUTHORITY of a provider endpoint.
 *
 * The opaque reasoning payloads (the Anthropic thinking signature and the
 * redacted-thinking payload) authenticate a block to the ENDPOINT that
 * issued them. A provider id alone does NOT establish a trust domain: two
 * endpoints can share one provider id (a regional or self-hosted endpoint,
 * a gateway, a proxy) while being entirely distinct trust domains.
 *
 * The authority therefore identifies BOTH:
 *
 *   - the provider id, and
 *   - the EFFECTIVE endpoint (the resolved base URL), when one is known.
 *
 * CREDENTIAL FREEDOM (A2). The authority is PERSISTED alongside the
 * payload, so it must never carry a credential. The repository's provider
 * configuration contract places credentials in `apiKey` / `apiKeyResolver` /
 * `apiKeyEnv` / `headers` — NEVER in the base URL — but the base URL is
 * still SYNTACTICALLY capable of carrying one (the configuration schema
 * accepts any `z.string().url()`, including user information, query
 * strings and fragments). The route identity is therefore built ONLY from
 * the URL components that are provably credential-free and provably
 * route-identity, and a URL that carries any other component produces NO
 * authority at all (fail closed) rather than a value that would either
 * leak a credential or silently drop an identity-bearing component.
 *
 * ABSENCE IS EXPLICIT (A1). The authority is `string | undefined`, and
 * `undefined` means "this route is UNRESOLVED". There is deliberately no
 * nonempty sentinel: a sentinel would make two DIFFERENT unresolved routes
 * compare EQUAL and would grant replay authority across a boundary that was
 * never established.
 *
 * The two parts are joined with a separator that cannot occur in either,
 * so the composite cannot be forged by moving characters between them.
 */
function buildReasoningOriginAuthority(input: {
	providerId: string;
	baseUrl: string | undefined;
}): string | undefined {
	// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02 (A2).
	//
	// The EFFECTIVE ROUTE, not merely the logical provider id and not the
	// unresolved configuration value:
	//
	//   - `context.config.baseUrl` is the RESOLVED endpoint. The registry
	//     resolves it as `config.baseUrl ?? apiLineBaseUrl ??
	//     registration.defaults.baseUrl`, so the API-line variant (for
	//     example MiniMax's China vs international endpoint) is already
	//     applied.
	//   - The full base URL is used, INCLUDING its PATH, because two
	//     endpoints can share a hostname and differ only by path, and a
	//     different path can be a different trust domain. The Anthropic
	//     adapter builds its effective request URL as
	//     `${baseURL}/messages`, so the base URL's path IS part of the
	//     route.
	//   - Only trailing slashes are normalized, so `/v1` and `/v1/` are the
	//     same route while `/v1` and `/v2` are not.
	//
	// CREDENTIAL EXCLUSION. The URL is parsed and then INSPECTED; a URL
	// that carries ANY of the following produces NO authority:
	//
	//   - USER INFORMATION (`https://user:secret@host/...`) — a
	//     credential. It is not route identity, and stripping it would
	//     make two different effective routes indistinguishable.
	//   - a QUERY STRING (`?api_key=...`) — the canonical credential
	//     carrier in a URL. It cannot be told apart from route identity
	//     by shape, so it is refused rather than persisted or stripped.
	//   - a FRAGMENT (`#...`) — never transmitted to the server, so it
	//     cannot be route identity, and it may carry a credential.
	//   - a URL that does not parse — an invalid endpoint, and therefore
	//     an unresolved route.
	//
	// The PATH is RETAINED IN FULL for an ESTABLISHED route, because it is
	// route identity under this repository's configuration contract
	// (credentials travel in `apiKey` and `headers`, never in the path).
	// Retaining it is what keeps a same-host / different-path pair two
	// DISTINCT routes.
	//
	// ESTABLISHMENT IS THE GATE (CORRECTION03). The authority is established
	// ONLY for an EXACT match against the repository's PUBLISHED BUILTIN
	// ROUTES (the builtin spec's default base URL and its per-API-line base
	// URLs). An UNESTABLISHED route — an operator-configured base URL, a
	// self-hosted or proxied endpoint, an extension-registered provider —
	// has NO published fact behind it, so it is WITHHELD authority: it
	// produces NO authority at all, and nothing about it (host, path, or a
	// credential in either) can reach the persisted record.
	//
	// LIMITATION (stated explicitly): route identity establishes the ROUTE
	// that issued a payload. It does NOT by itself prove every account-,
	// model- or conversation-level compatibility condition that a provider
	// may require.
	const providerId = input.providerId?.trim();
	if (!providerId) {
		return undefined;
	}
	const rawBaseUrl = input.baseUrl?.trim();
	if (!rawBaseUrl) {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(rawBaseUrl);
	} catch {
		// An INVALID endpoint is an UNRESOLVED route, not a route.
		return undefined;
	}
	if (url.username.length > 0 || url.password.length > 0) {
		return undefined;
	}
	if (url.search.length > 0) {
		return undefined;
	}
	if (url.hash.length > 0) {
		return undefined;
	}
	const origin = url.origin;
	if (!origin || origin === "null") {
		return undefined;
	}
	// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION03.
	//
	// ESTABLISHMENT IS THE GATE. The authority is established ONLY for an
	// EXACT match against the repository's PUBLISHED BUILTIN ROUTES (the
	// builtin spec's default base URL and its per-API-line base URLs).
	//
	// An UNESTABLISHED route — an operator-configured base URL, a
	// self-hosted or proxied endpoint, an extension-registered provider —
	// has NO published fact behind it. Its path is operator-supplied and
	// may carry a secret, and there is no published statement that the
	// path is route identity rather than a credential. Such a route is
	// therefore WITHHELD authority: it produces NO authority at all, so
	// nothing about it — not the host, not the path, not a credential in
	// either — reaches the persisted record.
	//
	// A PUBLISHED route, by contrast, IS established by the repository:
	// its paths are the repository's own (deployment ids, API versions),
	// never operator-placed secrets. Its COMPLETE route identity is
	// therefore preserved, including the FULL path, because the path is
	// what keeps a same-host / different-path pair two DISTINCT routes.
	if (!isPublishedBuiltinRoute({ providerId, baseUrl: rawBaseUrl })) {
		return undefined;
	}
	const path = url.pathname.replace(/\/+$/, "");
	return `${providerId}\u0000${origin}\u0000${path}`;
}

/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02.
 *
 * Whether an opaque reasoning payload may be replayed to a destination.
 *
 * The policy is FAIL-CLOSED:
 *
 *   - the recorded origin must be PRESENT and well formed, and
 *   - it must EXACTLY equal the destination's origin authority.
 *
 * A missing or malformed origin does NOT grant replay authority: absence of
 * provenance is not evidence of compatibility, and granting it would
 * disclose one endpoint's opaque metadata to another.
 *
 * The reasoning TEXT is never gated by this — only the opaque payload is.
 */
/**
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3).
 *
 * The wire gate DELEGATES to the SHARED replay-eligibility authority.
 *
 * This function previously carried a LOCAL COPY of the policy. Its own
 * docstring already said the policy was "EXTRACTED" into
 * `@cline/shared`'s `llms/reasoning-replay-eligibility.ts` and that "the wire
 * gate now delegates here" — but the code did not: the local copy was still
 * the one the wire consulted, and the shared module was reachable only from
 * the request-budget authority.
 *
 * Two copies of a SECURITY policy can drift, and the request-budget
 * authority consumes the SHARED one. A drift would let the budget exclude a
 * block the wire actually carries (or vice versa), which is exactly the
 * authority mismatch this authority exists to prevent.
 *
 * The policy itself is UNCHANGED — the local copy and the shared module
 * implement the SAME fail-closed rule. Only the LOCATION changed: the
 * shared module is now the single implementation, and this delegation makes
 * that true in the code rather than only in the documentation.
 */
function mayReplayOpaqueReasoning(input: {
	origin: unknown;
	destinationAuthority: string | undefined;
}): boolean {
	return sharedMayReplayOpaqueReasoning(input);
}

/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01.
 *
 * The provider-owned reasoning METADATA carried by a REASONING stream part.
 *
 * Two families exist and BOTH are required for reasoning continuity:
 *
 *   - GOOGLE / VERTEX `thoughtSignature` — the opaque signature the Gemini
 *     family attaches to a thought block. It travels in
 *     `providerMetadata.google` / `providerMetadata.vertex`.
 *   - ANTHROPIC `signature` / `redactedData` — the opaque signature the
 *     Anthropic family attaches to a thinking block. It travels in
 *     `providerMetadata.anthropic`.
 *
 * The Anthropic family is the Anthropic-COMPATIBLE transport too, so the
 * MiniMax M3 / M3.1 Flash routes deliver their thinking signature through
 * this bucket.
 *
 * The metadata is OPAQUE and PROVIDER-OWNED: it is carried verbatim, it is
 * never synthesized, and it is never carried across a provider transition
 * (the outbound conversion reads it per provider bucket).
 *
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01 (A2): this
 * extractor is used ONLY on the REASONING path. The tool-call path and the
 * recoverable-tool-error path keep the original Google/Vertex-only scope,
 * so the Anthropic opaque reasoning metadata is not broadened into
 * unrelated tool-call or error records.
 */
function extractReasoningMetadata(
	part: AiSdkStreamPart,
	issuingAuthority?: string,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {};

	const providerMetadata =
		part.providerMetadata && typeof part.providerMetadata === "object"
			? (part.providerMetadata as Record<string, unknown>)
			: undefined;
	const anthropicMetadata =
		providerMetadata?.anthropic &&
		typeof providerMetadata.anthropic === "object"
			? (providerMetadata.anthropic as Record<string, unknown>)
			: undefined;

	// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01: the Anthropic
	// thinking-block signature and the redacted-thinking payload.
	//
	// These are carried verbatim under the SAME key names the outbound
	// conversion reads (`metadata.signature` / `metadata.redactedData`), so
	// the round trip needs no provider-specific branch at the send boundary.
	if (
		typeof metadata.signature !== "string" &&
		typeof anthropicMetadata?.signature === "string"
	) {
		metadata.signature = anthropicMetadata.signature;
	}
	if (
		typeof metadata.redactedData !== "string" &&
		typeof anthropicMetadata?.redactedData === "string"
	) {
		metadata.redactedData = anthropicMetadata.redactedData;
	}

	// The Google/Vertex thought signature is COMPOSED from the shared
	// extractor rather than re-implemented, so the two extraction
	// implementations cannot drift apart.
	const googleMetadata = extractGoogleThoughtMetadata(part);
	if (googleMetadata) {
		Object.assign(metadata, googleMetadata);
	}

	// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01.
	//
	// The ORIGIN of the opaque metadata.
	//
	// The Anthropic thinking signature and the redacted-thinking payload
	// are ISSUED BY one endpoint and authenticate a block to it. Replaying
	// them to a DIFFERENT origin discloses one endpoint's opaque metadata
	// to another, so the issuing provider is recorded WITH the metadata and
	// the outbound conversion checks it before replaying.
	//
	// The origin is recorded only when the metadata actually carries an
	// Anthropic opaque payload, and it is recorded under a ClineMM-owned
	// key, so it never alters the provider's own metadata shape.
	if (
		issuingAuthority !== undefined &&
		(typeof metadata.signature === "string" ||
			typeof metadata.redactedData === "string")
	) {
		metadata[REASONING_METADATA_ORIGIN_KEY] = issuingAuthority;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * A stream error captured while the raw provider error object is still in
 * hand: the flattened display message plus its classification. Both are
 * derived here because the structure needed to classify does not survive
 * `extractErrorMessage`.
 */
interface CapturedStreamError {
	error: unknown;
	phase:
		| "stream_callback"
		| "stream_part"
		| "stream_read"
		| "result"
		| "request_start"
		| "timeout";
	message: string;
	errorClass: ProviderErrorClass;
	/**
	 * Whether the agent loop's turn-level retry may re-run this turn, decided
	 * while the structured error is still in hand and forwarded as
	 * `errorRetryable` on the `finish` event (the flattened message the agent
	 * loop receives cannot carry it). Transient by the AI SDK's own typed
	 * `isRetryable` flag, except that request-start RetryErrors and terminal
	 * stream error parts have already spent the SDK's retry budget. The
	 * turn-level retry must not multiply those attempts.
	 */
	retryable: boolean;
	/**
	 * This layer already recorded `sdk.error` telemetry for the failure.
	 * Forwarded as `errorReported` on the `finish` event so the agent loop
	 * does not report the same failure a second time.
	 */
	reported?: boolean;
	requestId?: string;
	baseMessage: string;
}

function captureStreamError(
	error: unknown,
	phase: CapturedStreamError["phase"] = "stream_callback",
): CapturedStreamError {
	const requestId = extractResponseRequestId(error);
	const baseMessage = extractErrorMessage(error);
	return {
		error,
		phase,
		message: appendRequestId(baseMessage, requestId),
		baseMessage,
		...(requestId ? { requestId } : {}),
		errorClass: classifyProviderError(error),
		// Error parts reaching the consumer have exhausted AI SDK stream recovery.
		// Do not multiply its retry budget in the agent's whole-turn retry loop.
		retryable:
			phase !== "stream_callback" &&
			phase !== "stream_part" &&
			isRetryableBeyondSdkRetries(error),
	};
}

async function* emitAiSdkEvents(
	stream: AiSdkStreamResult,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	pricingValue?: unknown,
	capturedError?: { current: CapturedStreamError | undefined },
	modelToolAdapters?: BuiltModelTools,
	reportError?: (error: CapturedStreamError) => Promise<void>,
): AsyncIterable<AgentModelEvent> {
	const emittedToolCallIds = new Set<string>();
	let finishReason: unknown;
	let requestId: string | undefined;
	let streamError: CapturedStreamError | undefined;
	let finishUsage: unknown;
	let finishProviderMetadata: unknown;
	let streamAborted = false;
	let sawVisibleContent = false;
	const mediaBudget = createMediaBudgetState();
	const rejectedMediaErrors: string[] = [];
	const activeProjectedModelToolCalls = new Map<
		string,
		ActiveProjectedModelToolCall
	>();
	const projectedModelToolResults = new Map<string, ProjectedModelToolResult>();
	const pendingProjectedModelToolOutputs = new Map<string, unknown>();
	const projectedModelToolErrors = new Map<string, string>();
	// Tool calls the provider executed inside this inference request (e.g. the
	// Claude Code CLI's own tools). They surface as observational activity and
	// must never enter AgentRuntime's local execution/approval loop. Result and
	// error parts are matched by ID because some providers omit the
	// providerExecuted flag on the result half of the pair.
	const observationalProviderToolCallIds = new Set<string>();

	try {
		if (stream.fullStream) {
			for await (const part of stream.fullStream) {
				if (part.type === "start-step") {
					requestId = undefined;
					continue;
				}
				if (part.type === "finish-step") {
					requestId = findRequestIdHeader(part.response?.headers);
					//
					// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01
					// CORRECTION-01).
					//
					// The `finish-step` part is the ONE part that carries the MODEL's
					// own `providerMetadata` — the AI SDK's own `finish` part does not
					// carry it at all.
					//
					// That matters because the production retry middleware stamps the
					// MIDDLEWARE-OWNED PHYSICAL-REQUEST OCCUPANCY AUTHORITY into the
					// model's finish part's `providerMetadata` (under the `cline`
					// namespace), and that stamp is what distinguishes the AGGREGATE
					// expenditure from the CONTEXT OCCUPANCY. It must be captured here
					// or the authority is silently lost.
					if (part.providerMetadata !== undefined) {
						finishProviderMetadata = mergeProviderMetadata(
							finishProviderMetadata,
							part.providerMetadata,
						);
					}
					continue;
				}
				if (part.type === "text-delta") {
					const text =
						(part.textDelta as string | undefined) ??
						(part.text as string | undefined) ??
						(part.delta as string | undefined);
					if (text) {
						sawVisibleContent = true;
						yield { type: "text-delta", text };
					}
					continue;
				}

				if (part.type === "reasoning-delta" || part.type === "reasoning") {
					const text =
						(part.textDelta as string | undefined) ??
						(part.text as string | undefined) ??
						(part.reasoning as string | undefined) ??
						(part.delta as string | undefined) ??
						"";
					// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01.
					//
					// The Anthropic family streams a thinking block's SIGNATURE
					// as a SEPARATE event whose text is EMPTY. The resolved
					// `@ai-sdk/anthropic` surfaces it as a `reasoning-delta`
					// with `delta: ""` and the signature in
					// `providerMetadata.anthropic`.
					//
					// Dropping such an event (the previous `if (text)` guard)
					// discarded the signature, so the accumulated reasoning part
					// carried no signature and the NEXT request serialized the
					// reasoning WITHOUT one. The Anthropic serializer then
					// emitted `unsupported reasoning metadata` and DROPPED the
					// reasoning block from the request entirely.
					//
					// A metadata-bearing reasoning event is therefore FORWARDED
					// even when its text is empty, so the provider-owned metadata
					// survives to the accumulated reasoning part. An event with
					// neither text nor metadata remains a no-op.
					const metadata = extractReasoningMetadata(
						part,
						buildReasoningOriginAuthority({
							providerId: request.providerId,
							baseUrl: context.config.baseUrl,
						}),
					);
					if (text || metadata) {
						if (text) {
							sawVisibleContent = true;
						}
						// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01.
						//
						// The provider's reasoning BLOCK identity. The resolved
						// AI SDK's `reasoning-delta` part carries the provider's
						// content-block id (the Anthropic content block index),
						// which is what distinguishes two independently signed
						// thinking blocks inside ONE assistant turn.
						//
						// Without it the runtime merges adjacent reasoning deltas
						// into a single part, so two signed blocks collapse into
						// one and only the LAST signature survives — the other
						// signature is silently lost.
						const blockId = typeof part.id === "string" ? part.id : undefined;
						yield {
							type: "reasoning-delta",
							text,
							metadata,
							...(blockId !== undefined ? { blockId } : {}),
						};
					}
					continue;
				}

				if (part.type === "file") {
					const extracted = extractGeneratedImage(part.file, mediaBudget);
					if (extracted.kind === "accepted") {
						sawVisibleContent = true;
						yield {
							type: "media",
							media: toGeneratedImageMedia(extracted.image),
						};
						continue;
					}
					if (extracted.kind === "rejected") {
						rejectedMediaErrors.push(extracted.error.message);
						continue;
					}
					// Preserve non-image model files on the generic event path.
					const file = part.file as
						| { base64?: string; mediaType?: string }
						| undefined;
					const data = file?.base64;
					if (typeof data === "string" && data.length > 0) {
						const mediaType = file?.mediaType ?? "application/octet-stream";
						const validation = validateAndReserveBase64Media(
							data,
							{},
							mediaBudget,
						);
						if (!validation.ok) {
							rejectedMediaErrors.push(validation.message);
							continue;
						}
						sawVisibleContent = true;
						yield {
							type: "media",
							media: {
								id: `media_${nanoid()}`,
								modality: generatedMediaModalityFromMediaType(mediaType),
								mediaType,
								source: { type: "base64", data: validation.base64 },
								sizeBytes: validation.decodedBytes,
							},
						};
					}
					continue;
				}

				if (part.type === "tool-call") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					// Provider-executed tools complete inside this inference request. They
					// must not enter AgentRuntime's local execution/approval loop. The same
					// applies to provider-defined client tools: streamText executes those
					// and continues the internal model step before returning control.
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" call is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						const execution =
							part.providerExecuted === true ? "provider" : "client";
						if (adapter?.projectResult) {
							activeProjectedModelToolCalls.set(toolCallId, {
								toolName: modelTool.name,
								input: part.input ?? part.args,
								execution,
							});
						}
						yield {
							type: "tool-call-delta",
							toolCallId,
							toolName: modelTool.name,
							execution,
							input: part.input ?? part.args,
						};
						continue;
					}
					if (part.providerExecuted === true) {
						const toolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined) ??
							`provider_tool_${nanoid()}`;
						observationalProviderToolCallIds.add(toolCallId);
						sawVisibleContent = true;
						yield {
							type: "tool-call-delta",
							toolCallId,
							toolName,
							execution: "provider",
							input: part.input ?? part.args,
						};
						continue;
					}
					sawVisibleContent = true;
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`;
					emittedToolCallIds.add(toolCallId);
					const input = (part.input ?? part.args ?? {}) as unknown;
					const inputText =
						typeof input === "string" ? input : JSON.stringify(input);
					yield {
						type: "tool-call-delta",
						toolCallId,
						toolName,
						input: typeof input === "string" ? undefined : input,
						inputText,
						metadata: buildToolCallMetadata({
							metadata: extractGoogleThoughtMetadata(part),
							request,
							context,
						}),
					};
					continue;
				}

				if (part.type === "tool-result") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" result is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						if (adapter?.projectResult) {
							if (part.preliminary !== true) {
								if (!activeProjectedModelToolCalls.has(toolCallId)) {
									throw new Error(
										`Model tool "${modelTool.name}" returned a result without a matching call`,
									);
								}
								// Provider SDKs can repeat a terminal tool result. Buffer the
								// latest value and validate it once so duplicates neither emit
								// duplicate media nor consume the aggregate media budget twice.
								pendingProjectedModelToolOutputs.set(
									toolCallId,
									part.output ?? part.result,
								);
								projectedModelToolErrors.delete(toolCallId);
							}
							continue;
						}
						if (part.preliminary !== true) {
							yield {
								type: "tool-result",
								toolCallId,
								toolName: modelTool.name,
								execution:
									part.providerExecuted === true ? "provider" : "client",
								input: part.input ?? part.args,
								output: part.output ?? part.result,
							};
						}
						continue;
					}
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined);
					if (
						part.providerExecuted === true ||
						(toolCallId && observationalProviderToolCallIds.has(toolCallId))
					) {
						if (part.preliminary !== true) {
							sawVisibleContent = true;
							yield {
								type: "tool-result",
								toolCallId: toolCallId ?? `provider_tool_${nanoid()}`,
								toolName,
								execution: "provider",
								input: part.input ?? part.args,
								output: part.output ?? part.result,
							};
						}
						continue;
					}
				}

				if (part.type === "tool-error") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" error is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						if (adapter?.projectResult) {
							pendingProjectedModelToolOutputs.delete(toolCallId);
							projectedModelToolErrors.set(
								toolCallId,
								`Model tool "${modelTool.name}" failed: ${extractErrorMessage(part.error)}`,
							);
							continue;
						}
						yield {
							type: "tool-result",
							toolCallId,
							toolName: modelTool.name,
							execution: part.providerExecuted === true ? "provider" : "client",
							input: part.input ?? part.args,
							output: { error: extractErrorMessage(part.error) },
							isError: true,
						};
						continue;
					}
					{
						const errorToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						if (
							part.providerExecuted === true ||
							(errorToolCallId &&
								observationalProviderToolCallIds.has(errorToolCallId))
						) {
							yield {
								type: "tool-result",
								toolCallId: errorToolCallId ?? `provider_tool_${nanoid()}`,
								toolName,
								execution: "provider",
								input: part.input ?? part.args,
								output: { error: extractErrorMessage(part.error) },
								isError: true,
							};
							continue;
						}
					}
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`;
					const alreadyEmitted = emittedToolCallIds.has(toolCallId);
					emittedToolCallIds.add(toolCallId);
					const input = (part.input ?? part.args ?? {}) as unknown;
					const inputText =
						typeof input === "string" ? input : JSON.stringify(input);
					const errorMessage =
						part.error === undefined
							? "Tool input was rejected by the model adapter"
							: extractErrorMessage(part.error);
					yield {
						type: "tool-call-delta",
						toolCallId,
						toolName,
						input: alreadyEmitted
							? undefined
							: typeof input === "string"
								? undefined
								: input,
						inputText: alreadyEmitted ? undefined : inputText,
						metadata: buildRecoverableToolErrorMetadata({
							part,
							errorMessage,
							request,
							context,
							toolName,
						}),
					};
					continue;
				}

				if (part.type === "finish") {
					finishUsage = part.usage ?? part.totalUsage;
					//
					// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01
					// CORRECTION-01): the metadata is MERGED, not replaced.
					//
					// The `finish-step` part already contributed the MODEL's own
					// `providerMetadata` — which is where the middleware-owned
					// PHYSICAL-REQUEST OCCUPANCY AUTHORITY travels. Replacing it
					// here would drop that authority on the floor.
					if (part.providerMetadata !== undefined) {
						finishProviderMetadata = mergeProviderMetadata(
							finishProviderMetadata,
							part.providerMetadata,
						);
					}
					finishReason = part.finishReason;
				}

				if (part.type === "error") {
					streamError =
						capturedError?.current ??
						captureStreamError(part.error, "stream_part");
					break;
				}

				if (part.type === "abort") {
					streamAborted = true;
					if (isTimeoutReason(part.reason)) {
						streamError =
							capturedError?.current ??
							captureStreamError(part.reason, "timeout");
					}
					break;
				}
			}
		} else if (stream.textStream) {
			for await (const text of stream.textStream) {
				yield { type: "text-delta", text };
			}
		}
	} catch (error) {
		// Prefer the real provider error from onError over the generic
		// NoOutputGeneratedError the AI SDK throws when 0 steps are recorded.
		streamError =
			capturedError?.current ?? captureStreamError(error, "stream_read");
	}

	if (!streamError) {
		for (const [toolCallId, output] of pendingProjectedModelToolOutputs) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			const adapter = active ? modelToolAdapters?.[active.toolName] : undefined;
			if (!active || !adapter?.projectResult) continue;
			try {
				const projection = adapter.projectResult(output);
				const media: GeneratedMedia[] = [];
				const errors: string[] = [];
				for (const candidate of projection.media) {
					const normalized = normalizeProjectedModelToolMedia(
						candidate,
						mediaBudget,
					);
					if (normalized.ok) media.push(normalized.media);
					else errors.push(normalized.error);
				}
				if (media.length === 0) {
					projectedModelToolErrors.set(
						toolCallId,
						errors[0] ??
							`Model tool "${active.toolName}" returned no supported media`,
					);
					continue;
				}
				projectedModelToolResults.set(toolCallId, {
					media,
					activityOutput:
						projection.activityOutput ?? summarizeProjectedMedia(media),
				});
				projectedModelToolErrors.delete(toolCallId);
			} catch (error) {
				projectedModelToolErrors.set(toolCallId, extractErrorMessage(error));
			}
		}
	}

	if (!streamError && !streamAborted) {
		for (const toolCallId of activeProjectedModelToolCalls.keys()) {
			if (
				!projectedModelToolResults.has(toolCallId) &&
				!projectedModelToolErrors.has(toolCallId)
			) {
				const active = activeProjectedModelToolCalls.get(toolCallId);
				projectedModelToolErrors.set(
					toolCallId,
					`Model tool "${active?.toolName ?? "unknown"}" completed without a final result`,
				);
			}
		}
	}

	if (!streamError) {
		for (const [toolCallId, projection] of projectedModelToolResults) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			if (!active) continue;
			sawVisibleContent = true;
			for (const media of projection.media) {
				yield { type: "media", media };
			}
			yield {
				type: "tool-result",
				toolCallId,
				toolName: active.toolName,
				execution: active.execution,
				input: active.input,
				output: projection.activityOutput,
			};
		}
		for (const [toolCallId, error] of projectedModelToolErrors) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			if (!active) continue;
			yield {
				type: "tool-result",
				toolCallId,
				toolName: active.toolName,
				execution: active.execution,
				input: active.input,
				output: { error },
				isError: true,
			};
		}
		if (
			!sawVisibleContent &&
			(projectedModelToolErrors.size > 0 || rejectedMediaErrors.length > 0)
		) {
			streamError = captureStreamError(
				new Error(
					projectedModelToolErrors.values().next().value ??
						rejectedMediaErrors[0] ??
						"Model returned no supported media",
				),
			);
		}
	}

	// Prefer stream.usage (has raw cost data) over finish part usage.
	// stream.usage may be undefined in mocked/test scenarios, fall back to finish part + its providerMetadata.
	let usageToEmit: unknown;
	let metadataToUse: unknown;
	if (streamError) {
		usageToEmit = finishUsage;
		metadataToUse = finishProviderMetadata;
	} else if (stream.usage) {
		try {
			usageToEmit = await stream.usage;
		} catch (error) {
			if (!streamError) {
				streamError =
					capturedError?.current ?? captureStreamError(error, "result");
			}
			usageToEmit = finishUsage;
			metadataToUse = finishProviderMetadata;
		}
	} else {
		usageToEmit = finishUsage;
		metadataToUse = finishProviderMetadata;
	}

	//
	// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
	//
	// The finish part's `providerMetadata` carries the MIDDLEWARE-OWNED
	// PHYSICAL-REQUEST OCCUPANCY AUTHORITY. It must reach the normalizer on
	// EVERY path, including the `stream.usage` path where the usage is
	// preferred over the finish part's own usage: the two carry DIFFERENT
	// facts (the aggregate expenditure versus the occupancy authority), and
	// dropping the metadata would silently drop the occupancy authority.
	//
	// The finish part's metadata is MERGED with whatever the usage path
	// supplied, so the provider's own metadata (used for cost extraction) is
	// preserved exactly.
	if (finishProviderMetadata !== undefined) {
		metadataToUse = mergeProviderMetadata(
			metadataToUse,
			finishProviderMetadata,
		);
	}

	if (usageToEmit) {
		const normalizedUsage = normalizeUsage(
			usageToEmit,
			metadataToUse,
			pricingValue,
			request,
		);
		// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01: the
		// opt-in NUMERIC usage observation. DEFAULT OFF. It correlates the
		// provider's RAW numeric usage, the AI SDK's normalized usage and
		// ClineMM's final normalized usage under the physical request
		// identity, so a reader can attribute a number to the link that
		// lost or distorted it. NUMERIC ALLOWLIST ONLY: no transcript, no
		// reasoning text, no response body, no credential, no signature.
		//
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6).
		//
		// THE SCOPE IS STATED, NOT INFERRED BY THE READER.
		//
		// The usage emitted here is the SDK's `stream.usage`, which the
		// production retry middleware has already AGGREGATED over the
		// turn's physical attempts. It is therefore the TURN AGGREGATE — the
		// BILLING quantity — and it must not be readable as ONE physical
		// request's usage.
		//
		// The scope is derived from an OBSERVED fact: the middleware-owned
		// occupancy authority's attempt count. One attempt means the usage
		// describes ONE physical request; several mean it is the turn's
		// aggregate. When the authority is absent the scope is left
		// unstated rather than guessed.
		const observedAttemptCount =
			readPhysicalRequestOccupancy(metadataToUse)?.attemptCount;
		const observedUsageScope =
			observedAttemptCount === undefined
				? undefined
				: observedAttemptCount === 1
					? ("physical-attempt" as const)
					: ("turn-aggregate" as const);
		//
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4).
		//
		// THE IDENTITY IS THE LOGICAL MODEL REQUEST, NOT A PHYSICAL
		// ATTEMPT.
		//
		// `request.metadata.modelRequestId` is the runtime's LOGICAL model
		// request identity. The production retry middleware re-dials that
		// SAME request internally, so every physical attempt of the turn
		// shares ONE `modelRequestId`. Presenting it as a physical attempt
		// identity asserts a correlation that does not exist.
		//
		// The PHYSICAL attempt count IS established (the middleware-owned
		// occupancy authority), so it is recorded as the observed
		// cardinality — and it is left UNKNOWN when the authority
		// established none.
		//
		// The SERVED OCCUPANCY is independently distinguishable: it is the
		// occupancy authority's established measurement, published under its
		// own scope so a reader can tell it apart from both the aggregate
		// expenditure and the individual attempt's usage.
		const observedOccupancy = readPhysicalRequestOccupancy(metadataToUse);
		const servedOccupancy =
			observedOccupancy?.state === "known" &&
			typeof observedOccupancy.value === "number"
				? observedOccupancy.value
				: undefined;
		recordUsageObservability({
			providerId: request.providerId,
			modelId: request.modelId,
			sessionId: request.metadata?.sessionId as string | undefined,
			modelRequestId: request.metadata?.modelRequestId as string | undefined,
			iteration: request.metadata?.iteration as number | undefined,
			raw:
				usageToEmit && typeof usageToEmit === "object"
					? (usageToEmit as Record<string, unknown>).raw
					: undefined,
			sdkUsage: usageToEmit,
			clineUsage: normalizedUsage,
			usageScope: observedUsageScope,
			...(observedAttemptCount !== undefined ? { observedAttemptCount } : {}),
			...(servedOccupancy !== undefined ? { servedOccupancy } : {}),
		});
		yield {
			type: "usage",
			usage: normalizedUsage,
		};
	}

	if (streamError) await reportError?.(streamError);

	const finishRequestId = requestId ?? streamError?.requestId;
	yield {
		type: "finish",
		reason: streamError ? "error" : mapFinishReason(finishReason),
		...(finishRequestId ? { requestId: finishRequestId } : {}),
		error: streamError?.message,
		errorClass: streamError?.errorClass,
		errorRetryable: streamError?.retryable,
		errorReported: streamError?.reported,
	};
}

async function createProviderModule(
	kind: ProviderModuleKind,
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	switch (kind) {
		case "cline": {
			const { createClineProviderModule } = await import("./vendors/cline");
			return createClineProviderModule(config, context);
		}
		case "openai": {
			const { createOpenAIProviderModule } = await import("./vendors/openai");
			return createOpenAIProviderModule(config, context);
		}
		case "openai-compatible": {
			const { createOpenAICompatibleProviderModule } = await import(
				"./vendors/openai-compatible"
			);
			return createOpenAICompatibleProviderModule(config, context);
		}
		case "anthropic": {
			const { createAnthropicProviderModule } = await import(
				"./vendors/anthropic"
			);
			return createAnthropicProviderModule(config, context);
		}
		case "google": {
			const { createGoogleProviderModule } = await import("./vendors/google");
			return createGoogleProviderModule(config, context);
		}
		case "vertex": {
			const { createVertexProviderModule } = await import("./vendors/vertex");
			return createVertexProviderModule(config, context);
		}
		case "bedrock": {
			const { createBedrockProviderModule } = await import("./vendors/bedrock");
			return createBedrockProviderModule(config);
		}
		case "mistral": {
			const { createMistralProviderModule } = await import("./vendors/mistral");
			return createMistralProviderModule(config);
		}
		case "claude-code": {
			const { createClaudeCodeProviderModule } = await import(
				"./vendors/community"
			);
			return createClaudeCodeProviderModule(config);
		}
		case "openai-codex": {
			const { createOpenAICodexProviderModule } = await import(
				"./vendors/community"
			);
			return createOpenAICodexProviderModule(config);
		}
		case "opencode": {
			const { createOpenCodeProviderModule } = await import(
				"./vendors/community"
			);
			return createOpenCodeProviderModule(config);
		}
		case "dify": {
			const { createDifyProviderModule } = await import("./vendors/community");
			return createDifyProviderModule(config);
		}
		case "ollama": {
			const { createOllamaProviderModule } = await import("./vendors/ollama");
			return createOllamaProviderModule(config, context);
		}
		case "sapaicore": {
			const { createSapAiCoreProviderModule } = await import(
				"./vendors/community"
			);
			return createSapAiCoreProviderModule(config);
		}
	}
}

/**
 * Wrap a vendor-constructed model with the transient-failure retry
 * middleware (empty responses + pre-content network interruptions).
 *
 * All-empty turns (no text, no reasoning, no tool call) are a cross-provider
 * phenomenon: production telemetry shows them on hosted backends (openrouter,
 * cline, generic OpenAI-compatible endpoints), not just local Ollama. An
 * empty assistant turn is a hard failure in the agent runtime ("Model
 * returned empty response"), so a single transient flake kills the task.
 * The same telemetry shows mid-stream network deaths (UND_ERR_SOCKET,
 * body/headers timeouts, ECONNRESET) as the dominant network-class run
 * killer — the AI SDK's own retry covers only request initiation, so once a
 * stream has started nothing else retries. Retrying here — the one
 * composition point every AI SDK vendor flows through — turns those flakes
 * into non-events while leaving the runtime's loud failure in place for
 * models that are persistently empty or connections that are truly down.
 *
 * Applied as the *outermost* wrap so each retry re-runs the vendor's full
 * request pipeline, including any vendor-level middleware attached inside
 * `provider.operations.language(...)`. Vendors opt out or tune attempts through
 * `ProviderFactoryResult.retryEmptyResponses`.
 */
export function withEmptyResponseRetry(
	model: unknown,
	retryEmptyResponses: ProviderFactoryResult["retryEmptyResponses"],
	logger: GatewayProviderContext["logger"],
	/**
	 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01.
	 *
	 * The request-scoped attempt budget for the middleware.
	 *
	 * `1` means the middleware makes a SINGLE attempt: an all-empty turn and
	 * a mid-stream network interruption before any output both terminate the
	 * request instead of being re-dialed. `undefined` keeps the middleware's
	 * own default budget.
	 */
	emptyResponseAttempts?: number,
): unknown {
	if (retryEmptyResponses === false) {
		return model;
	}
	if (emptyResponseAttempts !== undefined) {
		return wrapLanguageModel({
			model: model as LanguageModelV4,
			middleware: createRetryEmptyResponseMiddleware({
				...(retryEmptyResponses ?? {}),
				maxAttempts: emptyResponseAttempts,
				logger,
			}),
		});
	}
	return wrapLanguageModel({
		model: model as LanguageModelV4,
		middleware: createRetryEmptyResponseMiddleware({
			...retryEmptyResponses,
			logger,
		}),
	});
}

function createAiSdkProvider(
	defaultKind: ProviderModuleKind,
): GatewayProviderFactory {
	return async (config) => ({
		async *stream(request, context) {
			// Multi-protocol HTTP gateways declare model adapters in models.dev.
			// Keep native and local CLI transports authoritative for their models.
			const kind = resolveModelProviderKind(defaultKind, context);
			const log = context.logger;
			let stream: AiSdkStreamResult | undefined;
			const capturedError: { current: CapturedStreamError | undefined } = {
				current: undefined,
			};
			let recordTraceError: ((error: unknown) => Promise<void>) | undefined;
			let getAiSdkCallId: (() => string | undefined) | undefined;
			let reportedError: CapturedStreamError | undefined;
			const reportError = async (
				captured: CapturedStreamError,
				operation = "provider.stream",
			) => {
				if (reportedError === captured) return;
				// Explicit user/steering cancellation is not a provider failure.
				if (
					request.signal?.aborted &&
					!isTimeoutReason(request.signal.reason) &&
					!isTimeoutReason(captured.error)
				)
					return;
				reportedError = captured;
				const runtimeContext = buildAiSdkRuntimeContext(request, context);
				const correlation = Object.fromEntries(
					[
						"runId",
						"agentId",
						"sessionId",
						"conversationId",
						"modelRequestId",
						"iteration",
					].flatMap((key) =>
						runtimeContext[key] === undefined
							? []
							: [[key, runtimeContext[key]]],
					),
				);
				if (log?.error) {
					log.error("[ai-sdk] provider error", {
						...correlation,
						providerId: request.providerId,
						error: captured.error,
						severity: "error",
					});
				} else {
					log?.log(`[ai-sdk] provider error: ${captured.message}`, {
						providerId: request.providerId,
						severity: "error",
					});
				}
				captured.reported = captureSdkError(context.telemetry, {
					component: "llms",
					operation,
					error: captured.error,
					errorMessage: captured.baseMessage,
					severity: "error",
					handled: true,
					context: {
						...correlation,
						aiSdkCallId: getAiSdkCallId?.(),
						errorPhase: captured.phase,
						errorTurnRetryable: captured.retryable,
						providerId: request.providerId,
						modelId: request.modelId,
						providerKind: kind,
						requestId: captured.requestId,
					},
				});
				await recordTraceError?.(captured.error);
			};
			try {
				const provider = await createProviderModule(
					kind,
					{
						...config,
						fetch: wrapFetchForAimlapiAttribution(
							wrapFetchForStickySession(
								wrapFetchForProviderRequestCapture(config.fetch, request),
								request,
								context,
							),
							request.providerId,
						),
					},
					context,
				);
				const composedProviderOptions = composeAiSdkProviderOptions(
					request,
					context,
					kind,
				);
				const googleImageProviderKey =
					kind === "google"
						? "google"
						: kind === "vertex"
							? "vertex"
							: undefined;
				const providerOptions =
					context.provider.metadata?.imageTransport === "openrouter" &&
					modelProducesImages(context.model)
						? {
								...composedProviderOptions,
								openrouter: {
									...((composedProviderOptions[
										request.providerId as keyof typeof composedProviderOptions
									] ??
										composedProviderOptions.openaiCompatible ??
										{}) as Record<string, unknown>),
									// OpenRouter-compatible image generation uses chat
									// completions under the hood and requires explicit output
									// modalities.
									modalities: ["image", "text"],
								},
							}
						: googleImageProviderKey !== undefined &&
								modelProducesImages(context.model) &&
								!usesImageGenerationOperation(context.model)
							? {
									...composedProviderOptions,
									[googleImageProviderKey]: {
										...((composedProviderOptions[googleImageProviderKey] ??
											{}) as Record<string, unknown>),
										responseModalities: ["TEXT", "IMAGE"],
									},
								}
							: composedProviderOptions;
				const modelOperation = context.model.operation ?? "language";
				if (
					modelOperation !== "language" &&
					modelOperation !== "image-generation"
				) {
					throw new Error(
						`Provider "${context.provider.id}" does not implement the "${modelOperation}" model operation`,
					);
				}
				if (usesImageGenerationOperation(context.model)) {
					if (!provider.operations.imageGeneration) {
						throw new Error(
							`Provider "${context.provider.id}" does not support image generation models`,
						);
					}
					const prompt = resolveImageGenerationPrompt(request, context);
					recordProviderRequestCapture({
						stage: "ai_sdk_prompt",
						request,
						payload: {
							operation: "generate_image",
							prompt:
								typeof prompt === "string"
									? prompt
									: {
											text: prompt.text,
											imageCount: prompt.images.length,
										},
							providerOptions,
						},
					});
					const result = await generateImage({
						model: provider.operations.imageGeneration(
							context.model.id,
						) as never,
						prompt,
						abortSignal: request.signal,
						providerOptions: providerOptions as never,
					});
					let emittedImages = 0;
					let rejectedImageError: string | undefined;
					const mediaBudget = createMediaBudgetState();
					for (const file of result.images) {
						const extracted = extractGeneratedImage(file, mediaBudget);
						if (extracted.kind === "rejected") {
							rejectedImageError = extracted.error.message;
							continue;
						}
						if (extracted.kind !== "accepted") continue;
						emittedImages += 1;
						yield {
							type: "media",
							media: toGeneratedImageMedia(extracted.image),
						};
					}
					if (emittedImages === 0) {
						throw new Error(
							rejectedImageError ?? "Image model returned no supported images",
						);
					}
					if (result.usage) {
						yield {
							type: "usage",
							usage: normalizeUsage(
								result.usage as Record<string, unknown>,
								result.providerMetadata,
								context.model.metadata?.pricing,
								request,
							),
						};
					}
					yield { type: "finish", reason: "stop" };
					return;
				}
				const streamTelemetry = createStreamErrorTelemetry(
					await resolveGatewayAiSdkTelemetry(config.providerId, request),
				);
				const aiSdkTelemetry = streamTelemetry.telemetry;
				recordTraceError = streamTelemetry.recordError;
				getAiSdkCallId = streamTelemetry.getCallId;
				const externalToolExecutionDisabled =
					providerDisablesExternalToolExecution(context);
				const toolCallingDisabled =
					externalToolExecutionDisabled ||
					!modelSupportsToolCalling(context.model);
				const runtimeTools = toolCallingDisabled
					? undefined
					: toAiSdkTools(request);
				const activeModelTools = toolCallingDisabled
					? []
					: (request.modelTools ?? []).filter(
							(tool) => !hasAiSdkTool(runtimeTools, tool.name),
						);
				const modelToolRequest = {
					...request,
					modelTools: activeModelTools,
				};
				const modelToolAdapters = buildProviderModelTools(
					provider,
					modelToolRequest,
					context,
				);
				const modelTools = toAiSdkModelToolSet(modelToolAdapters);
				const tools = mergeAiSdkTools(runtimeTools, modelTools);
				const systemPrompt = resolveAiSdkSystemPrompt(request);
				// ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01:
				//
				// The request-scoped PHYSICAL-REQUEST budget.
				//
				// The transport has THREE independent retry authorities, and
				// this is the ONE place all three are armed. A request that
				// asserts a policy gets the policy's budgets; every other
				// request keeps the defaults, so the ordinary working-agent
				// and summarizer retries are preserved exactly.
				const retryPolicy = request.requestPolicy?.retryPolicy;
				const requestMaxRetries =
					retryPolicy?.maxRetries ?? MODEL_REQUEST_MAX_RETRIES;
				const streamMaxRetries =
					retryPolicy?.streamRetries ?? MODEL_STREAM_MAX_RETRIES;
				const emptyResponseAttempts =
					retryPolicy?.emptyResponseAttempts ?? undefined;
				const useSystemOption =
					typeof systemPrompt === "string" && systemPrompt.trim().length > 0;
				const messagesSystemPrompt = useSystemOption ? undefined : systemPrompt;
				const messages = buildAiSdkRequestMessages(
					request,
					context,
					messagesSystemPrompt,
				);
				// R3: upstream resolves reasoning once, after provider options are
				// known, and reconciles it against the native reasoning controls
				// already present in the provider options. This is upstream's
				// composition of provider-option rules with portable reasoning.
				//
				// R1 is preserved because the fork's MiniMax native-option guard
				// lives INSIDE `resolvePortableReasoning`: for a MiniMax request
				// the portable level resolves to undefined, so the Anthropic
				// bucket's `output_config.effort` remains the single owner of
				// the requested effort, and the `reconcilePortableReasoning`
				// pass cannot reintroduce a competing portable level.
				const portableReasoning = reconcilePortableReasoning(
					resolvePortableReasoning(request, { adapter: kind, context }),
					providerOptions,
				);
				// Reasoning is decided once above, after provider options are known.
				const { reasoning: _configReasoning, ...requestConfig } =
					provider.buildStreamConfig
						? provider.buildStreamConfig(request, context)
						: buildAiSdkStreamConfig(request, context);
				recordProviderRequestCapture({
					stage: "ai_sdk_prompt",
					request,
					payload: {
						messages,
						...(useSystemOption ? { system: systemPrompt } : {}),
						tools,
						providerOptions,
						...requestConfig,
						...(portableReasoning ? { reasoning: portableReasoning } : {}),
					},
				});
				// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01: the AI SDK
				// prompt representation (stage B). This is the adapter's OWN
				// view, AFTER `buildAiSdkRequestMessages()` and the final tool
				// conversion — so a difference that first appears here is
				// attributable to the ADAPTER, not to the runtime.
				recordPrefixForensics({
					stage: "ai_sdk_prompt",
					messages,
					...(useSystemOption ? { system: systemPrompt } : {}),
					...(tools !== undefined ? { tools } : {}),
					sessionId: request.metadata?.sessionId as string | undefined,
					// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02:
					// the PREPARATION identity, so this stage can be grouped
					// with the runtime-projection and wire stages of the SAME
					// request. It travels in the request metadata under the
					// established wire-reasoning correlation key.
					preparationRequestId: request.metadata?.[
						MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY
					] as string | undefined,
					providerAttemptId: request.metadata?.modelRequestId as
						| string
						| undefined,
					iteration: request.metadata?.iteration as number | undefined,
					providerId: request.providerId,
					modelId: request.modelId,
				});
				stream = await withAiSdkLangfuseTraceContext(
					aiSdkTelemetry.isEnabled,
					request,
					() =>
						streamText({
							model: withEmptyResponseRetry(
								provider.operations.language(context.model.id),
								provider.retryEmptyResponses,
								context.logger,
								emptyResponseAttempts,
							) as never,
							messages: messages as never,
							// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT:
							// Project the (base + extension rules +
							// brand-gated trusted continuation) prompt
							// through AI SDK v7's canonical privileged
							// channel: top-level `instructions`.
							//
							// AI SDK v7 `standardizePrompt` rejects
							// `role:"system"` inside `messages[]` unless
							// `allowSystemInMessages: true` (which we
							// deliberately do NOT set, per C13). The
							// producer side already strips
							// `role:"system"` entries from
							// `messages[]`; the privileged channel here
							// is `instructions`, NOT `system` (legacy
							// alias). Using `instructions` aligns with
							// AI SDK's v7 contract and surfaces the
							// privileged payload as `instructions` on
							// every `streamText`-derived telemetry
							// event.
							...(useSystemOption ? { instructions: systemPrompt } : {}),
							...(tools ? { tools } : {}),
							abortSignal: request.signal,
							maxRetries: requestMaxRetries,
							experimental_repairToolCall: repairMalformedToolCall as never,
							telemetry: {
								...aiSdkTelemetry,
								functionId: "cline-agent-turn",
								includeRuntimeContext: {
									distinctId: true,
									userId: true,
									sessionId: true,
									clientName: true,
									clientVersion: true,
									clineCoreVersion: true,
									tags: true,
									conversationId: true,
									runId: true,
									agentId: true,
									modelRequestId: true,
									iteration: true,
									providerId: true,
									modelId: true,
									resolvedModelId: true,
								},
							},
							runtimeContext: buildAiSdkRuntimeContext(request, context),
							providerOptions: providerOptions as never,
							...(provider.executesModelTools && activeModelTools.length
								? { stopWhen: stepCountIs(8) }
								: {}),
							...requestConfig,
							streamRetries: streamMaxRetries,
							...(portableReasoning ? { reasoning: portableReasoning } : {}),
							onLanguageModelCallStart: () => {
								capturedError.current = undefined;
							},
							onError: ({ error: streamError }) => {
								const captured = captureStreamError(streamError);
								capturedError.current = captured;
								streamTelemetry.captureError(streamError);
							},
							onAbort: async ({ reason }) => {
								if (!isTimeoutReason(reason)) return;
								const captured = captureStreamError(reason, "timeout");
								capturedError.current = captured;
								await reportError(captured);
							},
						}) as unknown as AiSdkStreamResult,
				);

				// Suppress dangling promise rejections (finishReason, totalUsage, steps, etc.)
				// BEFORE iterating. The AI SDK rejects these DelayedPromises inside the stream's
				// flush callback, which runs during iteration, so we must attach .catch() handlers
				// upfront or Bun/Node will surface them as unhandled rejections.
				suppressDanglingStreamPromises(stream);

				yield* emitAiSdkEvents(
					stream,
					modelToolRequest,
					context,
					context.model.metadata?.pricing,
					capturedError,
					modelToolAdapters,
					reportError,
				);
			} catch (error) {
				suppressDanglingStreamPromises(stream);
				// Prefer the real provider error captured in onError over the generic
				// NoOutputGeneratedError that the AI SDK throws when 0 steps are recorded.
				const captured =
					capturedError.current ?? captureStreamError(error, "request_start");
				await reportError(captured, "provider.create_or_stream");
				yield {
					type: "finish",
					reason: "error",
					error: captured.message,
					errorClass: captured.errorClass,
					errorRetryable: captured.retryable,
					errorReported: captured.reported,
				};
			}
		},
	});
}

function resolveModelProviderKind(
	defaultKind: ProviderModuleKind,
	context: GatewayProviderContext,
): ProviderModuleKind {
	if (
		defaultKind !== "openai-compatible" ||
		!context.provider.metadata?.routing?.modelApiProtocol
	)
		return defaultKind;
	switch (context.model.metadata?.apiProtocol) {
		case "openai-responses":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "gemini":
			return "google";
		default:
			return defaultKind;
	}
}

export const createOpenAIProvider = createAiSdkProvider("openai");
export const createClineProvider = createAiSdkProvider("cline");
export const createOpenAICompatibleProvider =
	createAiSdkProvider("openai-compatible");
export const createAnthropicProvider = createAiSdkProvider("anthropic");
export const createGoogleProvider = createAiSdkProvider("google");
export const createVertexProvider = createAiSdkProvider("vertex");
export const createBedrockProvider = createAiSdkProvider("bedrock");
export const createMistralProvider = createAiSdkProvider("mistral");
export const createClaudeCodeProvider = createAiSdkProvider("claude-code");
export const createOpenAICodexProvider = createAiSdkProvider("openai-codex");
export const createOpenCodeProvider = createAiSdkProvider("opencode");
export const createDifyProvider = createAiSdkProvider("dify");
export const createOllamaProvider = createAiSdkProvider("ollama");
export const createSapAiCoreProvider = createAiSdkProvider("sapaicore");
