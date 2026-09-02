import { estimateRequestInputTokens } from "@cline/shared";
import {
	captureCompactionBudgetEmergency,
	captureCompactionExecuted,
	captureCompactionSkipped,
	type TelemetryCompactionStrategy,
} from "../../services/telemetry/core-events";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import type {
	CoreCompactionConfig,
	CoreCompactionContext,
	CoreCompactionMode,
	CoreCompactionResult,
	CoreCompactionStrategy,
	CoreSessionConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import { runAgenticCompaction } from "./agentic-compaction";
import { runBasicCompaction } from "./basic-compaction";
import {
	applyUserContextCeiling,
	COMPACTION_TRIGGER_RATIO,
	createTokenEstimator,
	DEFAULT_MAX_INPUT_TOKENS,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	DEFAULT_TARGET_RATIO,
	normalizeUserContextCeiling,
	resolveEffectiveMaxInputTokens,
} from "./compaction-shared";

export interface ContextPipelinePrepareTurnInput {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: CoreCompactionContext["messages"];
	apiMessages: CoreCompactionContext["messages"];
	abortSignal: AbortSignal;
	systemPrompt: string;
	tools: unknown[];
	model: CoreCompactionContext["model"];
	/**
	 * Set by the runtime when the provider rejected the previous request as
	 * exceeding the model's context window. Forces a compaction regardless of
	 * the token-estimate trigger (the estimate just proved wrong) and uses the
	 * deterministic basic strategy — recovery must not depend on another
	 * successful LLM request.
	 */
	overflowRecovery?: boolean;
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export interface ContextPipelinePrepareTurnResult {
	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	 * (tenth-pass): `messages` is INTENTIONALLY OPTIONAL at the
	 * type level. The post-fix runtime contract has three
	 * return shapes from `prepareTurn`:
	 *
	 *   1. `undefined`  — no return at all (no producer-side
	 *                     W publication possible, used in the
	 *                     pre-fix compact path before the
	 *                     producer-cadence GREEN).
	 *   2. `{ messages, systemPrompt?, currentWorkingContext-
	 *        Estimate? }` — projection in progress; downstream
	 *        at agent-runtime.ts:2319-2324 replaces the
	 *        upstream `request` with the projected shape.
	 *   3. `{ currentWorkingContextEstimate }` — metadata-
	 *        only return; `messages` and `systemPrompt` are
	 *        intentionally NOT set. Downstream falls through
	 *        the projection branches (`next === request`,
	 *        semantic conservation) but reads W from the
	 *        result.
	 *
	 * The optionality reflects the actual contract; making
	 * it required (as it was pre-tenth-pass) forces a type
	 * lie on the metadata-only return and would require
	 * either a runtime cast or a structural-subtype
	 * helper. Type-level optionality is the cleanest
	 * expression of the contract.
	 */
	messages?: CoreCompactionContext["messages"];
	/**
	 * Same: optional for the metadata-only return path.
	 * Downstream at agent-runtime.ts:2323 only replaces the
	 * upstream `request.systemPrompt` when
	 * `result.systemPrompt !== undefined`, so a metadata-only
	 * return preserves the upstream systemPrompt by construction.
	 */
	systemPrompt?: string;
	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01:
	 * working-context authority published at the prepare-turn seam.
	 * Computed from the FINAL returned request shape (systemPrompt +
	 * messages + tools) by CANONICAL_W_ESTIMATOR, NOT from the
	 * pre-compaction `shouldCompact()` inputs. Independent of provider
	 * billing / input accounting (structural provider-usage non-
	 * interference via TokenEstimatedRequest). Optional at the type
	 * level for back-compat with hosts that have not yet been
	 * upgraded; the state-aware wrapper always publishes W when the
	 * upstream `compact` returned a result.
	 */
	currentWorkingContextEstimate?: number;
}

export type ContextPipelinePrepareTurn = (
	context: ContextPipelinePrepareTurnInput,
) => Promise<ContextPipelinePrepareTurnResult | undefined>;

type EstimateMessageTokens = ReturnType<typeof createTokenEstimator>;

type BuiltinCompactionStrategyOptions = {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	compaction: CoreCompactionConfig | undefined;
	estimateMessageTokens: EstimateMessageTokens;
	logger: Pick<CoreSessionConfig, "logger">["logger"];
};

type BuiltinCompactionStrategyRunner = (
	options: BuiltinCompactionStrategyOptions,
) =>
	| Promise<CoreCompactionResult | undefined>
	| CoreCompactionResult
	| undefined;

export interface ContextCompactionPrepareTurnOptions {
	mode?: CoreCompactionMode;
	manualTargetRatio?: number;
}

const LONG_CONVERSATION_TARGET_RATIO = 0.5;

function isCompactionCancellation(
	error: unknown,
	abortSignal: AbortSignal,
): boolean {
	if (abortSignal.aborted) {
		return true;
	}
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "AgentRuntimeAbortError")
	);
}

function describeCompactionError(error: unknown): Record<string, unknown> {
	return error instanceof Error
		? { errorName: error.name, errorMessage: error.message }
		: { errorMessage: String(error) };
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

function summarizeToolResults(messages: CoreCompactionContext["messages"]): {
	toolResultCount: number;
	toolResultSerializedChars: number;
	maxToolResultSerializedChars: number;
} {
	let toolResultCount = 0;
	let toolResultSerializedChars = 0;
	let maxToolResultSerializedChars = 0;
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const size = safeJsonSize(block.content);
			toolResultCount += 1;
			toolResultSerializedChars += size;
			maxToolResultSerializedChars = Math.max(
				maxToolResultSerializedChars,
				size,
			);
		}
	}
	return {
		toolResultCount,
		toolResultSerializedChars,
		maxToolResultSerializedChars,
	};
}

const BUILTIN_COMPACTION_STRATEGIES = {
	basic: ({ context, estimateMessageTokens, logger }) =>
		runBasicCompaction({
			context,
			estimateMessageTokens,
			logger,
		}),
	agentic: ({
		context,
		providerConfig,
		compaction,
		estimateMessageTokens,
		logger,
	}) =>
		runAgenticCompaction({
			context,
			providerConfig,
			summarizer: compaction?.summarizer,
			preserveRecentTokens: Math.min(
				compaction?.preserveRecentTokens ?? DEFAULT_PRESERVE_RECENT_TOKENS,
				context.budget.messages.targetTokens,
			),
			estimateMessageTokens,
			logger,
		}),
} satisfies Record<CoreCompactionStrategy, BuiltinCompactionStrategyRunner>;

function resolveManualMessageTargetTokens(input: {
	messageInputTokens: number;
	messageTriggerTokens: number;
	manualTargetRatio: number | undefined;
}): number {
	const ratio =
		typeof input.manualTargetRatio === "number" &&
		Number.isFinite(input.manualTargetRatio)
			? input.manualTargetRatio
			: 0.5;
	const targetRatio = Math.min(0.95, Math.max(0.05, ratio));
	return Math.max(
		1,
		Math.floor(
			Math.min(
				input.messageTriggerTokens,
				input.messageInputTokens * targetRatio,
			),
		),
	);
}

function resolveAutoRequestTargetTokens(input: {
	maxInputTokens: number;
	modelMaxTokens?: number;
	triggerTokens: number;
	messagePairCount: number;
}): number {
	const targetTokens =
		input.messagePairCount >= 5 &&
		typeof input.modelMaxTokens === "number" &&
		Number.isFinite(input.modelMaxTokens) &&
		input.modelMaxTokens < input.maxInputTokens
			? Math.floor(input.maxInputTokens * LONG_CONVERSATION_TARGET_RATIO)
			: Math.floor(input.triggerTokens * DEFAULT_TARGET_RATIO);
	const triggerCeiling = Math.max(1, input.triggerTokens - 1);
	return Math.max(
		1,
		Math.min(targetTokens, input.maxInputTokens, triggerCeiling),
	);
}

function translateRequestBudgetToMessages(
	requestTokens: number,
	overheadTokens: number,
): number {
	return Math.max(1, Math.floor(requestTokens - overheadTokens));
}

function countUserAssistantPairs(
	messages: CoreCompactionContext["messages"],
): number {
	let pairs = 0;
	let hasPendingUser = false;
	for (const message of messages) {
		if (message.role === "user") {
			hasPendingUser = true;
		} else if (message.role === "assistant" && hasPendingUser) {
			pairs += 1;
			hasPendingUser = false;
		}
	}
	return pairs;
}

/**
 * Build the `prepareTurn` callback used by the agent runtime to compact the
 * transcript before each model request.
 *
 * Telemetry: emits `task.compaction_executed` on a successful compaction and
 * `task.compaction_skipped` when the configured strategy returns `undefined`.
 * Telemetry is keyed by `config.sessionId` (falling back to the per-turn
 * `conversationId`) and tagged with `provider` / `modelId`.
 *
 * Known gap: compactions performed via plugin `registerMessageBuilder()` or
 * via the `beforeModel` runtime hook bypass this wrapper entirely, so they
 * do not emit compaction telemetry. If we want coverage there too, the
 * plugin/hook pipelines must be instrumented separately.
 */
export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "compaction"
		| "logger"
		| "telemetry"
		| "sessionId"
	>,
	options: ContextCompactionPrepareTurnOptions = {},
):
	| ((
			context: ContextPipelinePrepareTurnInput,
	  ) => Promise<ContextPipelinePrepareTurnResult | undefined>)
	| undefined {
	const userCompaction = config.compaction;
	if (userCompaction?.enabled !== true) {
		return undefined;
	}

	const providerConfig =
		config.providerConfig ??
		({
			providerId: config.providerId,
			modelId: config.modelId,
		} as ProviderConfig);
	const estimateMessageTokens = createTokenEstimator();
	const strategy = userCompaction?.strategy ?? "agentic";
	const runBuiltinStrategy = BUILTIN_COMPACTION_STRATEGIES[strategy];
	const mode = options.mode ?? "auto";
	const telemetryStrategy: TelemetryCompactionStrategy = userCompaction?.compact
		? "custom"
		: strategy;
	// ACT-CLINEMM-USER-CONTEXT-CEILING01: user-controlled operating ceiling.
	// Sanitized once per `prepareTurn` so the per-turn closure works against a
	// trusted positive integer (or undefined for Auto). The canonical
	// resolver output (NOT the raw model metadata) is what the ceiling caps.
	const sanitizedUserContextCeiling = normalizeUserContextCeiling(
		userCompaction?.userContextCeiling,
	);

	return async (context) => {
		const effectiveMode: CoreCompactionMode = context.overflowRecovery
			? "overflow_recovery"
			: mode;
		const apiMessageTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const requestInputTokens = estimateRequestInputTokens({
			systemPrompt: context.systemPrompt,
			messages: context.apiMessages,
			tools: context.tools,
		});
		const messageInputTokens = context.messages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const requestOverheadTokens = Math.max(
			0,
			requestInputTokens - apiMessageTokens,
		);
		const maxInputTokens =
			applyUserContextCeiling(
				resolveEffectiveMaxInputTokens({
					maxInputTokens: context.model.info?.maxInputTokens,
					contextWindow: context.model.info?.contextWindow,
				}),
				sanitizedUserContextCeiling,
			) ?? DEFAULT_MAX_INPUT_TOKENS;
		const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
		const messageTriggerTokens = translateRequestBudgetToMessages(
			requestTriggerTokens,
			requestOverheadTokens,
		);
		const shouldCompact = requestInputTokens >= requestTriggerTokens;
		config.logger?.debug("Context compaction diagnostics", {
			mode: effectiveMode,
			strategy,
			iteration: context.iteration,
			providerId: config.providerId,
			modelId: config.modelId,
			requestInputTokens,
			apiMessageTokens,
			messageInputTokens,
			requestOverheadTokens,
			maxInputTokens,
			requestTriggerTokens,
			messageTriggerTokens,
			thresholdRatio: COMPACTION_TRIGGER_RATIO,
			shouldCompact,
			// ACT-CLINEMM-USER-CONTEXT-CEILING01: surface whether the trigger is
			// operating under a user-configured ceiling; undefined = Auto.
			userContextCeiling: sanitizedUserContextCeiling,
			messageCount: context.messages.length,
			apiMessageCount: context.apiMessages.length,
			apiMessagesJsonChars: safeJsonSize(context.apiMessages),
			...summarizeToolResults(context.apiMessages),
		});
		if (effectiveMode === "auto" && !shouldCompact) {
			return undefined;
		}
		let requestTargetTokens: number;
		let messageTargetTokens: number;
		if (effectiveMode === "auto") {
			requestTargetTokens = resolveAutoRequestTargetTokens({
				maxInputTokens,
				modelMaxTokens: context.model.info?.maxTokens,
				triggerTokens: requestTriggerTokens,
				messagePairCount: countUserAssistantPairs(context.messages),
			});
			messageTargetTokens = translateRequestBudgetToMessages(
				requestTargetTokens,
				requestOverheadTokens,
			);
		} else {
			messageTargetTokens = resolveManualMessageTargetTokens({
				messageInputTokens,
				messageTriggerTokens,
				manualTargetRatio: options.manualTargetRatio,
			});
			requestTargetTokens = requestOverheadTokens + messageTargetTokens;
		}

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			mode: effectiveMode,
			abortSignal: context.abortSignal,
			budget: {
				request: {
					inputTokens: requestInputTokens,
					maxInputTokens,
					triggerTokens: requestTriggerTokens,
					targetTokens: requestTargetTokens,
					overheadTokens: requestOverheadTokens,
					thresholdRatio: COMPACTION_TRIGGER_RATIO,
					utilizationRatio:
						maxInputTokens > 0 ? requestInputTokens / maxInputTokens : 0,
				},
				messages: {
					inputTokens: messageInputTokens,
					triggerTokens: messageTriggerTokens,
					targetTokens: messageTargetTokens,
				},
			},
		};

		const statusReason =
			effectiveMode === "manual"
				? "manual_compaction"
				: effectiveMode === "overflow_recovery"
					? "overflow_recovery_compaction"
					: "auto_compaction";
		const noticePrefix =
			effectiveMode === "manual"
				? ""
				: effectiveMode === "overflow_recovery"
					? "overflow-recovery-"
					: "auto-";
		context.emitStatusNotice?.(`${noticePrefix}compacting`, {
			kind: statusReason,
			reason: statusReason,
			phase: "started",
			iteration: context.iteration,
			triggerTokens: requestTriggerTokens,
			targetTokens: requestTargetTokens,
			maxInputTokens,
			messageTargetTokens,
		});

		const beforeMessageCount = context.messages.length;
		const startedAt = Date.now();

		const builtinOptions = {
			context: compactionContext,
			providerConfig: {
				...providerConfig,
				abortSignal: context.abortSignal,
			},
			compaction: userCompaction,
			estimateMessageTokens,
			logger: config.logger,
		};
		let executedStrategy = telemetryStrategy;
		let result: CoreCompactionResult | undefined;
		if (effectiveMode === "overflow_recovery") {
			// The provider already rejected the request, so recovery must end
			// deterministically: the agentic strategy's own summarizer call could
			// overflow the same window (its input budgeting trusts the same
			// estimator that just undercounted). A custom compactor gets first
			// shot — it sees mode "overflow_recovery" and owns its transcript
			// invariants — but its result is held to the same bar basic
			// compaction aims for: strictly smaller than the input (the runtime
			// refuses to retry with a request that is not smaller) AND within
			// the recovery token target. A marginal shrink would spend the
			// run's single retry on a request that still cannot fit. On throw,
			// decline, or an insufficient result, basic compaction runs so
			// recovery never depends on another successful LLM request.
			if (userCompaction?.compact) {
				try {
					result = await userCompaction.compact(compactionContext);
				} catch (error) {
					if (isCompactionCancellation(error, context.abortSignal)) {
						throw error;
					}
					config.logger?.log(
						"Custom compaction failed during overflow recovery; falling back to basic compaction",
						{
							severity: "warn",
							...describeCompactionError(error),
						},
					);
					result = undefined;
				}
				if (result?.messages) {
					const customMessageTokens = result.messages.reduce(
						(total: number, message) => total + estimateMessageTokens(message),
						0,
					);
					// The full acceptance bar, covering every degenerate size: a
					// non-empty transcript (an empty one erases the request being
					// retried), strictly smaller than the input (the runtime
					// refuses a retry that is not smaller), and within the
					// recovery token target (a marginal shrink spends the run's
					// single retry on a request that still cannot fit). Both size
					// comparisons use the token estimator rather than serialized
					// length so they are expressed in the same unit as the target.
					const acceptable =
						result.messages.length > 0 &&
						customMessageTokens < messageInputTokens &&
						customMessageTokens <= messageTargetTokens;
					if (!acceptable) {
						config.logger?.log(
							"Custom compaction did not produce an acceptable overflow-recovery transcript; falling back to basic compaction",
							{
								severity: "warn",
								customMessageCount: result.messages.length,
								customMessageTokens,
								messageTargetTokens,
							},
						);
						result = undefined;
					}
				}
			}
			if (!result?.messages) {
				executedStrategy = "basic";
				result = await BUILTIN_COMPACTION_STRATEGIES.basic(builtinOptions);
			}
		} else if (userCompaction?.compact) {
			result = await userCompaction.compact(compactionContext);
		} else {
			try {
				result = await runBuiltinStrategy(builtinOptions);
			} catch (error) {
				if (
					strategy !== "agentic" ||
					isCompactionCancellation(error, context.abortSignal)
				) {
					throw error;
				}
				config.logger?.log(
					"Agentic compaction failed; falling back to basic compaction",
					{
						severity: "warn",
						...describeCompactionError(error),
					},
				);
				executedStrategy = "basic";
				result = await BUILTIN_COMPACTION_STRATEGIES.basic(builtinOptions);
			}
		}

		const durationMs = Date.now() - startedAt;
		// Telemetry identity: surface the agent/conversation passed into the
		// prepareTurn so multi-agent runs can attribute compactions correctly.
		// `sessionId` is the host-owned session id (ulid). We fall back to the
		// conversation id when no sessionId is supplied (e.g. ad-hoc callers).
		const telemetryUlid = config.sessionId ?? context.conversationId;
		const telemetryIdentity = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId ?? undefined,
		};

		if (result?.messages) {
			const afterMessageTokens = result.messages.reduce(
				(total: number, message) => total + estimateMessageTokens(message),
				0,
			);
			const afterRequestTokens = requestOverheadTokens + afterMessageTokens;
			config.logger?.log("Context compaction completed", {
				severity: "info",
				strategy: executedStrategy,
				maxInputTokens,
				messageInputTokens,
				apiInputTokens: apiMessageTokens,
				requestInputTokens,
				requestOverheadTokens,
				afterMessageTokens,
				afterRequestTokens,
				tokensSaved: requestInputTokens - afterRequestTokens,
				utilizationBefore: `${((requestInputTokens / maxInputTokens) * 100).toFixed(1)}%`,
				utilizationAfter: `${((afterRequestTokens / maxInputTokens) * 100).toFixed(1)}%`,
				thresholdTrigger: `${(COMPACTION_TRIGGER_RATIO * 100).toFixed(1)}%`,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			} as Record<string, unknown>);
			context.emitStatusNotice?.(`${noticePrefix}compacted`, {
				kind: statusReason,
				reason: statusReason,
				phase: "completed",
				iteration: context.iteration,
				tokensBefore: requestInputTokens,
				tokensAfter: afterRequestTokens,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				maxInputTokens,
			});
			captureCompactionExecuted(config.telemetry, {
				ulid: telemetryUlid,
				strategy: executedStrategy,
				mode: effectiveMode,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
				tokensBefore: requestInputTokens,
				tokensAfter: afterRequestTokens,
				tokensSaved: requestInputTokens - afterRequestTokens,
				triggerTokens: requestTriggerTokens,
				maxInputTokens,
				thresholdRatio: COMPACTION_TRIGGER_RATIO,
				durationMs,
				// Matches the field name used by other TASK telemetry helpers
				// (e.g. captureTaskCompleted, captureToolUsage).
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
			if (
				result.budget &&
				(result.budget.actionCount > 0 || result.budget.warningCount > 0)
			) {
				captureCompactionBudgetEmergency(config.telemetry, {
					ulid: telemetryUlid,
					strategy: executedStrategy,
					mode: effectiveMode,
					policyIntent: result.budget.policyIntent,
					actionCount: result.budget.actionCount,
					warningCount: result.budget.warningCount,
					liveTailHandling: result.budget.liveTailHandling,
					provider: config.providerId,
					modelId: config.modelId,
					...telemetryIdentity,
				});
				context.emitStatusNotice?.("compaction-budget-adjusted", {
					kind: "compaction_budget_emergency",
					reason: "compaction_budget_emergency",
					iteration: context.iteration,
					policyIntent: result.budget.policyIntent,
					actionCount: result.budget.actionCount,
					warningCount: result.budget.warningCount,
				});
			}
		} else {
			context.emitStatusNotice?.(`${noticePrefix}compaction-skipped`, {
				kind: statusReason,
				reason: statusReason,
				phase: "skipped",
				iteration: context.iteration,
				maxInputTokens,
			});
			captureCompactionSkipped(config.telemetry, {
				ulid: telemetryUlid,
				strategy: executedStrategy,
				mode: effectiveMode,
				reason: "no_result",
				tokensBefore: requestInputTokens,
				triggerTokens: requestTriggerTokens,
				maxInputTokens,
				thresholdRatio: COMPACTION_TRIGGER_RATIO,
				durationMs,
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		}

		return result;
	};
}

export function createCompactionStateAwarePrepareTurn(input: {
	compact?: ContextPipelinePrepareTurn;
	getState?: () => SessionCompactionState | undefined;
	/**
	 * Persist a freshly-computed compaction state. `sourceMessages` are the
	 * exact canonical messages the state's source-prefix hash was computed
	 * over; hosts must validate projection against these rather than a
	 * separately derived transcript, which can legally differ mid-turn and
	 * spuriously reject the write.
	 */
	saveState?: (
		state: SessionCompactionState,
		sourceMessages: CoreCompactionContext["messages"],
	) => void | Promise<void>;
}): ContextPipelinePrepareTurn {
	return async (context) => {
		const existingState = input.getState?.();
		const projectedMessages = existingState
			? projectSessionCompactionState(existingState, context.messages)
			: undefined;
		if (existingState && projectedMessages) {
			// Re-compaction intentionally starts from the compacted projection plus
			// canonical tail. This keeps automatic turns bounded without rebuilding a
			// full-transcript summary every turn; manual `/compact` is the path for a
			// fresh summary from canonical history.
			const result = input.compact
				? await input.compact({
						...context,
						messages: projectedMessages,
						apiMessages: projectedMessages,
					})
				: undefined;
			if (result?.messages) {
				const systemPrompt = result.systemPrompt ?? existingState.system_prompt;
				const nextState = createSessionCompactionState({
					sourceMessages: context.messages,
					compactedMessages: result.messages,
					conversationId: context.conversationId,
					systemPrompt,
				});
				await input.saveState?.(nextState, context.messages);
				return publishWorkingContextEstimate(result.messages, systemPrompt ?? context.systemPrompt, context.tools);
			}
			const projectedSystemPrompt = result?.systemPrompt ?? existingState.system_prompt;
			return publishWorkingContextEstimate(projectedMessages, projectedSystemPrompt ?? context.systemPrompt, context.tools);
		}
		const result = input.compact ? await input.compact(context) : undefined;
		if (result?.messages) {
			const nextState = createSessionCompactionState({
				sourceMessages: context.messages,
				compactedMessages: result.messages,
				conversationId: context.conversationId,
				systemPrompt: result.systemPrompt,
			});
			await input.saveState?.(nextState, context.messages);
			return publishWorkingContextEstimate(result.messages, result.systemPrompt ?? context.systemPrompt, context.tools);
		}
		// No-compaction branch (producer-cadence GREEN;
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 tenth-pass). The upstream
		// `compact` returned either `undefined` (no
		// compaction needed) or a result without
		// `messages` (compactor decided not to rewrite).
		// In both cases there is no projection to transport,
		// but the prepare-turn result MUST still carry the
		// authoritative `currentWorkingContextEstimate` so
		// the producer publishes W on every successful
		// prepare-turn, regardless of whether compaction
		// rewrote messages.
		//
		// The return uses a metadata-only helper to avoid
		// two downstream projection branches at agent-
		// runtime.ts:2319-2324: `if (result.messages)`
		// triggers cloneMessages, and `if (result.system-
		// Prompt !== undefined)` triggers replacement.
		// Setting either field — even with content-equal
		// values — would shift `next !== request` and break
		// the no-op projection invariant. The metadata-
		// only helper sets ONLY `currentWorkingContext-
		// Estimate`, so downstream falls through both
		// branches and `next === request` (semantic
		// conservation).
		//
		// saveState is NOT called here. Durable compaction
		// artifact cadence remains compactions-only by
		// design, the architectural separation enforced
		// in the ninth-pass HALT_DEFAULT_SUITE_RED
		// resolution.
		//
		// NO_COMPACTION_REQUEST_SEMANTICS_DELTA = ZERO
		// (P1_1 control asserted in compaction.working-
		// context-authority-publish.test.ts:176).
		return publishWorkingContextEstimateMetadataOnly(
			context.messages,
			context.systemPrompt,
			context.tools,
		);
	};
}

/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01:
 * Publish currentWorkingContextEstimate on a prepared-turn result
 * by feeding the FINAL returned request shape (systemPrompt +
 * messages + tools) into CANONICAL_W_ESTIMATOR. The estimator is
 * `estimateRequestInputTokens` (sdk/packages/shared/src/llms/
 * tokens.ts:47); the input contract is TokenEstimatedRequest
 * (systemPrompt + messages + tools) — no provider-usage slots —
 * so the result is structurally independent of billing/input
 * accounting.
 *
 * The W estimate must come from the FINAL returned shape, NOT
 * from the pre-compaction values used at `shouldCompact()` in
 * createContextPipelinePrepareTurn. The two semantics are
 * different: shouldCompact triggers against the pre-compaction
 * shape; W_after is the post-preparation occupancy for the next
 * provider request.
 */
function publishWorkingContextEstimate(
	messages: CoreCompactionContext["messages"],
	systemPrompt: string,
	tools: readonly unknown[],
): ContextPipelinePrepareTurnResult {
	return {
		messages,
		systemPrompt,
		currentWorkingContextEstimate: estimateRequestInputTokens({
			systemPrompt,
			messages,
			tools,
		}),
	};
}

/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * producer-cadence GREEN (tenth-pass):
 *
 *   Returns a metadata-only prepare-turn result carrying
 *   `currentWorkingContextEstimate` for the FINAL request shape
 *   WITHOUT populating `messages` or `systemPrompt`. The
 *   downstream consumer at sdk/packages/agents/src/agent-
 *   runtime.ts:2303-2325 distinguishes:
 *
 *     result === undefined
 *       → no projection; use original `request`
 *
 *     result.messages !== undefined
 *       → projection; cloneMessages(result.messages)
 *         replaces `request.messages`
 *
 *     result.systemPrompt !== undefined
 *       → projection; result.systemPrompt replaces
 *         `request.systemPrompt`
 *
 *   So returning a result with `messages` or `systemPrompt`
 *   set — even when those values are content-equal to the
 *   input — would trigger the projection branch and:
 *
 *     (1) clone `messages` (new array reference, same
 *         content) — semantic delta: any downstream
 *         reference-equality observation fails.
 *
 *     (2) replace `systemPrompt` (new value, content-equal
 *         if input is unchanged) — semantic delta: any
 *         reference-equality on systemPrompt fails.
 *
 *   The metadata-only return avoids both: the result is
 *   defined (so downstream skips the `!result` early return)
 *   but neither `messages` nor `systemPrompt` is set, so
 *   `next === request` (semantic conservation preserved).
 *
 *   W publication cadence = every prepareTurn. Save-state
 *   cadence = real compactions only (unchanged).
 *
 *   NO_COMPACTION_REQUEST_SEMANTICS_DELTA = ZERO
 *   (P1_1 control asserted in
 *    compaction.working-context-authority-publish.test.ts:176).
 */
function publishWorkingContextEstimateMetadataOnly(
	messages: CoreCompactionContext["messages"],
	systemPrompt: string,
	tools: readonly unknown[],
): ContextPipelinePrepareTurnResult {
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// tenth-pass: this metadata-only return sets ONLY
	// `currentWorkingContextEstimate`; `messages` and
	// `systemPrompt` are intentionally NOT populated. The
	// `ContextPipelinePrepareTurnResult` type now declares
	// `messages` and `systemPrompt` as OPTIONAL (per
	// tenth-pass interface revision), so this return value
	// satisfies the contract directly.
	//
	// The runtime value matches the
	//   `Pick<ContextPipelinePrepareTurnResult,
	//     "currentWorkingContextEstimate">`
	// shape; downstream at agent-runtime.ts:2319 / :2323
	// only reads `result.messages` / `result.systemPrompt`
	// when they are defined, so the metadata-only return
	// is a valid no-op projection signal (semantically
	// equivalent to the pre-fix `return undefined` for
	// projection purposes, but publishes W on every
	// prepareTurn for the producer-cadence invariant).
	return {
		currentWorkingContextEstimate: estimateRequestInputTokens({
			systemPrompt,
			messages,
			tools,
		}),
	};
}
