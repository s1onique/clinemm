import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	BasicLogger,
	GatewayConfig,
	GatewayModelDefinition,
	GatewayModelHandleOptions,
	GatewayModelSelection,
	GatewayProviderRegistration,
	GatewayStreamRequest,
	ITelemetryService,
	ReasoningEffort,
} from "@cline/shared";
import {
	estimateRequestInputTokens,
	ReasoningEffortSchema,
} from "@cline/shared";
import { toAsyncIterable } from "./async";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { UnsupportedReasoningConfigurationError } from "./errors";
import {
	getModelReasoningControls,
	modelMandatesReasoning,
} from "./model-facts";
import { providerManifestSupportsModelOperation } from "./model-operations";
import { providerManifestSupportsModelTool } from "./model-tools";
import { GatewayRegistry } from "./registry";
import { isPositiveFiniteNumber } from "./utils";

export type * from "@cline/shared";

export const DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS = 32_000;
const GATEWAY_OUTPUT_RESERVE_TOKENS = 1_024;

function mergeRequestMetadata(
	defaults: Record<string, unknown> | undefined,
	request: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!defaults && !request) {
		return undefined;
	}
	return {
		...(defaults ?? {}),
		...(request ?? {}),
	};
}

function normalizeReasoningBudgetTokens(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2 correction).
 *
 * The effort the caller requested, read from the raw model-request options.
 *
 * `options` is an untyped bag, so the value is read defensively: a
 * non-object `reasoning` or a non-string `effort` yields `undefined` rather
 * than throwing.
 */
function readRequestedReasoningEffort(
	options: Record<string, unknown> | undefined,
): string | undefined {
	const reasoning = options?.reasoning;
	if (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning)) {
		return undefined;
	}
	const effort = (reasoning as Record<string, unknown>).effort;
	return typeof effort === "string" ? effort : undefined;
}

function normalizeRequestedReasoning(
	value: unknown,
): GatewayStreamRequest["reasoning"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	const input = value as Record<string, unknown>;
	const parsedEffort = ReasoningEffortSchema.safeParse(input.effort);
	const disableReason: "none" | "unknown" | undefined =
		input.disableReason === "none" || input.disableReason === "unknown"
			? input.disableReason
			: undefined;
	const normalized = {
		enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
		effort: parsedEffort.success ? parsedEffort.data : undefined,
		budgetTokens: normalizeReasoningBudgetTokens(input.budgetTokens),
		// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2
		// correction): the recorded disable reason survives normalization.
		disableReason,
	};

	return normalized.enabled !== undefined ||
		normalized.effort !== undefined ||
		normalized.budgetTokens !== undefined ||
		normalized.disableReason !== undefined
		? normalized
		: undefined;
}

function mergeReasoningOptions(
	defaults: GatewayStreamRequest["reasoning"],
	legacy: GatewayStreamRequest["reasoning"],
	requested: GatewayStreamRequest["reasoning"],
): GatewayStreamRequest["reasoning"] {
	if (legacy?.enabled === false || requested?.enabled === false) {
		return { enabled: false };
	}

	const merged = {
		enabled: requested?.enabled ?? legacy?.enabled ?? defaults?.enabled,
		effort: requested?.effort ?? legacy?.effort ?? defaults?.effort,
		budgetTokens:
			requested?.budgetTokens ?? legacy?.budgetTokens ?? defaults?.budgetTokens,
		// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2
		// correction): the recorded disable reason is merged the same way
		// the other reasoning fields are, so a PERSISTED explicit `None`
		// (carried on the model handle's defaults) is not lost when the
		// per-request options carry only `thinking: false`.
		disableReason:
			requested?.disableReason ??
			legacy?.disableReason ??
			defaults?.disableReason,
	};
	if (
		merged.enabled === false &&
		(merged.effort !== undefined || merged.budgetTokens !== undefined)
	) {
		merged.enabled = undefined;
	}

	return Object.values(merged).some((value) => value !== undefined)
		? merged
		: undefined;
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2 correction).
 *
 * Attach the recorded disable reason to a merged reasoning request.
 *
 * The reason is attached ONLY when reasoning is actually disabled, so an
 * enablement never carries a disable reason. A disable with no recorded
 * reason keeps the pre-existing behavior: the model applies its own
 * default, exactly as before this correction.
 */
function withDisableReason(
	reasoning: GatewayStreamRequest["reasoning"],
	disableReason: "none" | "unknown",
): GatewayStreamRequest["reasoning"] {
	if (!reasoning || reasoning.enabled !== false) {
		return reasoning;
	}
	return { ...reasoning, disableReason };
}

export interface Gateway {
	registerProvider(registration: GatewayProviderRegistration): this;
	configureProvider(
		config: NonNullable<GatewayConfig["providerConfigs"]>[number],
	): this;
	listProviders(): ReturnType<GatewayRegistry["listProviders"]>;
	listModels(providerId?: string): ReturnType<GatewayRegistry["listModels"]>;
	createAgentModel(
		selection: GatewayModelSelection,
		options?: GatewayModelHandleOptions,
	): AgentModel;
	stream(
		request: GatewayStreamRequest,
	): Promise<AsyncIterable<AgentModelEvent>>;
}

class GatewayModelAdapter implements AgentModel {
	constructor(
		private readonly gateway: DefaultGateway,
		private readonly selection: GatewayModelSelection,
		private readonly defaults: GatewayModelHandleOptions | undefined,
	) {}

	stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		const defaultReasoning = normalizeRequestedReasoning(
			this.defaults?.reasoning,
		);
		const requestedReasoning = normalizeRequestedReasoning(
			request.options?.reasoning,
		);
		const thinking = request.options?.thinking;
		const reasoningEffort = request.options?.reasoningEffort;
		const thinkingBudgetTokens = request.options?.thinkingBudgetTokens;
		const parsedLegacyEffort = ReasoningEffortSchema.safeParse(reasoningEffort);
		const legacyEffort: ReasoningEffort | undefined = parsedLegacyEffort.success
			? parsedLegacyEffort.data
			: undefined;
		// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2
		// correction).
		//
		// The merged reasoning options lose the distinction between "the
		// user explicitly selected None" and "reasoning was disabled for some
		// other reason". The distinction is recovered HERE, from the raw
		// caller options, and carried on the request so the production
		// boundary can tell an explicit user selection apart from a derived
		// disable.
		//
		// An explicit `None` is either the structured `effort: "none"` (the
		// modern shape) or the legacy `reasoningEffort: "none"`. A
		// `thinking: false` on its own is NOT an explicit None selection: it
		// is what a disable looks like after it has been resolved, and it is
		// also what a caller sends when it wants the model's default.
		//
		// The MODEL HANDLE's default carries the PERSISTED provider-level
		// selection. A stale persisted `None` arrives that way — the
		// per-request options carry only `thinking: false` — so the handle
		// default is consulted as well. Without it a stale persisted `None`
		// would reach the production boundary as an anonymous disable and
		// would be silently replaced by the model's mandatory default.
		const explicitNoneSelected =
			readRequestedReasoningEffort(request.options) === "none" ||
			request.options?.reasoningEffort === "none" ||
			this.defaults?.reasoning?.disableReason === "none";
		const disableReason: "none" | "unknown" = explicitNoneSelected
			? "none"
			: "unknown";
		const legacyBudgetTokens =
			normalizeReasoningBudgetTokens(thinkingBudgetTokens);
		const legacyReasoning:
			| {
					enabled?: boolean;
					effort?: ReasoningEffort;
					budgetTokens?: number;
			  }
			| undefined =
			typeof thinking === "boolean" ||
			legacyEffort !== undefined ||
			legacyBudgetTokens !== undefined
				? {
						enabled: typeof thinking === "boolean" ? thinking : undefined,
						effort: legacyEffort,
						budgetTokens: legacyBudgetTokens,
					}
				: undefined;
		return this.gateway.stream({
			providerId: this.selection.providerId,
			modelId: this.selection.modelId ?? "",
			systemPrompt: request.systemPrompt,
			messages: request.messages,
			tools: this.defaults?.tools ?? request.tools,
			modelTools: this.defaults?.modelTools ?? request.modelTools,
			temperature:
				(request.options?.temperature as number | undefined) ??
				this.defaults?.temperature,
			maxTokens:
				(request.options?.maxTokens as number | undefined) ??
				this.defaults?.maxTokens,
			metadata: mergeRequestMetadata(
				this.defaults?.metadata,
				request.options?.metadata as Record<string, unknown> | undefined,
			),
			reasoning: withDisableReason(
				mergeReasoningOptions(
					defaultReasoning,
					legacyReasoning,
					requestedReasoning,
				),
				disableReason,
			),
			signal: request.signal ?? this.defaults?.signal,
		});
	}
}

export function resolveGatewayRequestMaxTokens(input: {
	requestedMaxTokens?: number;
	model: Pick<GatewayModelDefinition, "contextWindow" | "maxOutputTokens">;
	estimatedInputTokens: number;
	defaultMaxOutputTokens?: number;
	outputReserveTokens?: number;
	reasoningBudgetTokens?: number;
	onContextOverflow?: (details: {
		contextWindow: number;
		estimatedInputTokens: number;
		reserveTokens: number;
	}) => void;
}): number | undefined {
	const caps: number[] = [];
	if (isPositiveFiniteNumber(input.requestedMaxTokens)) {
		caps.push(Math.floor(input.requestedMaxTokens));
	} else {
		// Providers like Anthropic require max_tokens to exceed the thinking
		// budget, so an explicit reasoning budget lifts the synthesized default
		// (still clamped by model max output and remaining context below).
		const reasoningFloor = isPositiveFiniteNumber(input.reasoningBudgetTokens)
			? Math.floor(input.reasoningBudgetTokens) +
				(input.outputReserveTokens ?? GATEWAY_OUTPUT_RESERVE_TOKENS)
			: 0;
		const defaultMaxOutputTokens = Math.max(
			input.defaultMaxOutputTokens ?? DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS,
			reasoningFloor,
		);
		if (
			isPositiveFiniteNumber(input.model.maxOutputTokens) ||
			isPositiveFiniteNumber(input.model.contextWindow)
		) {
			caps.push(defaultMaxOutputTokens);
		}
	}

	if (isPositiveFiniteNumber(input.model.maxOutputTokens)) {
		caps.push(Math.floor(input.model.maxOutputTokens));
	}

	if (isPositiveFiniteNumber(input.model.contextWindow)) {
		const reserveTokens =
			input.outputReserveTokens ?? GATEWAY_OUTPUT_RESERVE_TOKENS;
		const remainingContext =
			input.model.contextWindow - input.estimatedInputTokens - reserveTokens;
		if (remainingContext <= 0) {
			input.onContextOverflow?.({
				contextWindow: input.model.contextWindow,
				estimatedInputTokens: input.estimatedInputTokens,
				reserveTokens,
			});
			return undefined;
		}
		caps.push(Math.floor(remainingContext));
	}

	if (caps.length === 0) {
		return undefined;
	}

	return Math.max(1, Math.floor(Math.min(...caps)));
}

export class DefaultGateway implements Gateway {
	private readonly registry: GatewayRegistry;
	private readonly logger: BasicLogger | undefined;
	private readonly telemetry: ITelemetryService | undefined;

	constructor(config: GatewayConfig = {}) {
		this.registry = new GatewayRegistry(config.fetch);
		this.logger = config.logger;
		this.telemetry = config.telemetry;

		if (config.builtins !== false) {
			const builtins = new Set(
				config.builtins ??
					BUILTIN_PROVIDER_REGISTRATIONS.map(
						(provider) => provider.manifest.id,
					),
			);
			for (const builtin of BUILTIN_PROVIDER_REGISTRATIONS) {
				if (builtins.has(builtin.manifest.id)) {
					this.registry.registerProvider(builtin);
				}
			}
		}

		for (const provider of config.providers ?? []) {
			this.registry.registerProvider(provider);
		}

		for (const providerConfig of config.providerConfigs ?? []) {
			this.registry.configureProvider(providerConfig);
		}
	}

	registerProvider(registration: GatewayProviderRegistration): this {
		this.registry.registerProvider(registration);
		return this;
	}

	configureProvider(
		config: NonNullable<GatewayConfig["providerConfigs"]>[number],
	): this {
		this.registry.configureProvider(config);
		return this;
	}

	listProviders() {
		return this.registry.listProviders();
	}

	listModels(providerId?: string) {
		return this.registry.listModels(providerId);
	}

	createAgentModel(
		selection: GatewayModelSelection,
		options?: GatewayModelHandleOptions,
	): AgentModel {
		return new GatewayModelAdapter(this, selection, options);
	}

	async stream(
		request: GatewayStreamRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const resolved = this.registry.resolveModel({
			providerId: request.providerId,
			modelId: request.modelId || undefined,
		});
		if (
			!providerManifestSupportsModelOperation(resolved.provider, resolved.model)
		) {
			throw new Error(
				`Provider "${resolved.provider.id}" does not support model "${resolved.model.id}" operation "${resolved.model.operation ?? "language"}" with its declared modalities.`,
			);
		}
		// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2
		// correction).
		//
		// The PRODUCTION BOUNDARY for the unsupported-reasoning-off
		// contract. It sits here, before the provider is created and before
		// any transport happens, because this is the last point at which the
		// resolved model's advertised controls and the caller's request are
		// both known.
		//
		// A request that EXPLICITLY disabled reasoning (`disableReason ===
		// "none"`, i.e. the user selected the `None` effort) on a model that
		// MANDATES reasoning is rejected with a typed error. The alternative
		// — silently dropping the reasoning intent and letting the model
		// apply its mandatory default — would run the request with a
		// reasoning policy the user did not select and give them no signal
		// that their selection was discarded.
		//
		// A disable WITHOUT an explicit user selection keeps the
		// pre-existing behavior: the model applies its own default.
		if (
			request.reasoning?.enabled === false &&
			request.reasoning.disableReason === "none" &&
			modelMandatesReasoning(resolved.model)
		) {
			const controls = getModelReasoningControls(
				resolved.model.reasoningOptions,
			);
			throw new UnsupportedReasoningConfigurationError({
				providerId: resolved.provider.id,
				modelId: resolved.model.id,
				efforts: controls?.efforts ?? [],
				supportsToggle: controls?.toggle ?? false,
			});
		}
		const unsupportedModelTools = [
			...new Set(
				(request.modelTools ?? [])
					.filter(
						(tool) =>
							!providerManifestSupportsModelTool(
								resolved.provider,
								resolved.model.id,
								tool.name,
							),
					)
					.map((tool) => tool.name),
			),
		];
		if (unsupportedModelTools.length > 0) {
			throw new Error(
				`Provider "${resolved.provider.id}" model "${resolved.model.id}" does not support model tool(s): ${unsupportedModelTools.join(", ")}.`,
			);
		}
		const providerRecord = await this.registry.createProvider(
			request.providerId,
		);
		const provider = await providerRecord.createProvider(providerRecord.config);
		const maxTokens = resolveGatewayRequestMaxTokens({
			requestedMaxTokens: request.maxTokens,
			model: resolved.model,
			estimatedInputTokens: estimateRequestInputTokens(request),
			reasoningBudgetTokens: request.reasoning?.budgetTokens,
			onContextOverflow: (details) => {
				this.logger?.log(
					"Estimated prompt tokens exceed model context window",
					{
						severity: "warn",
						providerId: resolved.provider.id,
						modelId: resolved.model.id,
						...details,
					},
				);
			},
		});
		const stream = await provider.stream(
			{
				...request,
				modelId: resolved.model.id,
				providerId: resolved.provider.id,
				maxTokens,
				defaultedMaxTokens:
					maxTokens !== undefined && !isPositiveFiniteNumber(request.maxTokens),
			},
			{
				provider: resolved.provider,
				model: resolved.model,
				config: providerRecord.config,
				signal: request.signal,
				logger: this.logger,
				telemetry: this.telemetry,
			},
		);

		return toAsyncIterable(stream);
	}
}

export function createGateway(config?: GatewayConfig): DefaultGateway {
	return new DefaultGateway(config);
}
