/** @deprecated Import from `@cline/shared`; kept for compatibility. */
export {
	CLINE_DEFAULT_MODEL_ID,
	type ProviderLocalCli,
	resolveProviderLocalCli,
} from "@cline/shared";
export type {
	GetModelsForProviderOptions,
	ModelCollection,
	ModelIdAliasRule,
	ModelInfo,
	ModelInfo as CatalogModelInfo,
	ProviderCapability as CatalogProviderCapability,
	ProviderClient,
	ProviderInfo,
	ProviderModelFilter,
	ProviderProtocol,
} from "./models";
export {
	CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	fetchLiveProviderModels,
	fetchModelsDevProviderModels,
	fetchVercelTranscriptionModels,
	filterImageOutputModels,
	filterOpenAICodexModels,
	GENERATED_CLINE_RECOMMENDED_MODELS,
	getAllProviders,
	getGeneratedModelsForProvider,
	getGeneratedProviderModels,
	getModelOverridesForProvider,
	getModelsForProvider,
	getProvider,
	getProviderCollection,
	getProviderCollectionSync,
	getProviderIds,
	hasProvider,
	isCanonicalModelIdForAliasRules,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	preferCanonicalModelIds,
	registerModel,
	registerProvider,
	resetRegistry,
	sortModelsByReleaseDate,
	unregisterModel,
	unregisterProvider,
	VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
} from "./models";
export type {
	ApiHandler,
	ApiStreamChunk,
	BuiltInProviderId,
	ContentBlock,
	FileContent,
	HandlerFactory,
	HandlerModelInfo,
	ImageContent,
	LazyHandlerFactory,
	Message,
	MessageRole,
	MessageWithMetadata,
	ProviderCapability,
	ProviderConfig,
	ProviderId,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "./providers";
export {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	ClineFreeModelLimitError,
	ClineNotSubscribedError,
	ClineOrgIndividualInferenceSubscriptionError,
	ClinePassLimitError,
	classifyProviderError,
	createHandler,
	createHandlerAsync,
	extractClineFreeModelLimitResetTime,
	extractClinePassLimitMessage,
	getClineNotSubscribedMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	getClinePassSubscriptionUrl,
	getGeneratedModelsForRuntimeProvider,
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isBuiltInProviderId,
	isClineFreeModelLimitError,
	isClineFreeModelLimitMessage,
	isClineModelNotFoundMessage,
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionError,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitError,
	isClinePassLimitMessage,
	isProviderApiLine,
	isRegisteredHandlerAsync,
	isRetryableProviderError,
	isUnsupportedReasoningConfigurationError,
	normalizeProviderId,
	OLLAMA_DEFAULT_CONTEXT_WINDOW,
	type ProviderApiLine,
	registerAsyncHandler,
	registerHandler,
	resolveGatewayProviderRegistration,
	resolveGatewayProviderRegistrationSync,
	resolveProviderApiLineBaseUrl,
	type UnsupportedReasoningConfigurationDetails,
	UnsupportedReasoningConfigurationError,
} from "./providers";
export {
	type ProviderUsageCostDisplay,
	resolveProviderUsageCostDisplay,
	shouldShowProviderUsageCost,
} from "./providers/billing";
export { buildClineClientHeaders } from "./providers/cline-client-headers";
export type * from "./providers/gateway";
export { createGateway, DefaultGateway } from "./providers/gateway";
// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01):
// the MIDDLEWARE-OWNED PHYSICAL-REQUEST OCCUPANCY AUTHORITY and its reader.
//
// They are exported so a cross-package consumer can assert the authority's
// PROVENANCE against the PRODUCTION reader, without reaching into the
// package's internal paths.
export {
	buildPhysicalRequestOccupancy,
	PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY,
	PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE,
	type PhysicalRequestOccupancy,
	readPhysicalRequestOccupancy,
} from "./providers/middleware/retry-empty-response";
export { toGatewayModelCapabilities } from "./providers/model-capabilities";
export {
	BUILTIN_MODEL_OPERATION_CAPABILITIES,
	builtinProviderSupportsModelOperation,
	getBuiltinStreamingTranscriptionModels,
	providerManifestSupportsModelOperation,
	resolveModelOperation,
} from "./providers/model-operations";
export {
	type ModelToolSupportInput,
	providerManifestSupportsModelTool,
	providerOffersModelTool,
	supportsModelTool,
} from "./providers/model-tools";
// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01: the opt-in structural
// capture of the three request representation boundaries. DEFAULT OFF.
export type {
	PrefixForensicsRuntimeRequest,
	PrefixForensicsStage,
} from "./providers/prefix-forensics-capture";
export {
	_resetPrefixForensicsAttemptCountersForTests,
	recordPrefixForensics,
	recordPrefixForensicsRuntimeProjection,
} from "./providers/prefix-forensics-capture";
export { resolveProviderModelCatalogKeys } from "./providers/provider-keys";
// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2/A3): the
// SINGLE destination origin-authority resolver. The wire gate and the
// request-budget authority both use it, so they compare the recorded origin
// against the IDENTICAL destination authority.
export { buildReasoningOriginAuthority } from "./providers/reasoning-origin-authority";
export {
	type OpenAICodexRequestHeaderContext,
	type ProviderRequestHeaderClientContext,
	type ProviderRequestHeaderLayers,
	type ResolveProviderRequestHeadersInput,
	resolveProviderRequestHeaders,
} from "./providers/request-headers";
// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1): the
// RESOLVED TRANSPORT authority. The request-budget authority, the
// task-contract guard and the compaction trigger read the transport identity
// from here instead of guessing it from the model family.
export {
	type ResolvedTransportFacts,
	resolveEffectiveBaseUrl,
	resolveTransportFacts,
} from "./providers/resolved-transport";
export {
	type ClineProvider,
	type ClineProviderOptions,
	type ClineWebSearchInput,
	type ClineWebSearchOptions,
	type ClineWebSearchResult,
	createCline,
} from "./providers/vendors/cline";
export { LangfuseAttributesSpanProcessor } from "./services/LangfuseAttributesSpanProcessor";
export {
	disposeLangfuseTelemetry,
	type LangfuseTraceAttributes,
	withLangfuseTraceAttributes,
} from "./services/langfuse-telemetry";
export {
	type AudioTranscriptionRequest,
	type AudioTranscriptionResult,
	type AudioTranscriptionRoute,
	createStreamingAudioTranscriptionSession,
	DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
	resolveAudioTranscriptionRoute,
	type StreamingAudioTranscriptionSession,
	type StreamingAudioTranscriptionSessionRequest,
	transcribeAudio,
} from "./transcription";
